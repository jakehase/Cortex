import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeProviderPolicy, providerPolicyDigest } from "./provider-read-compute.mjs";

export const AIOS_VERIFIER_EVIDENCE_SCHEMA = "aios.verifier-evidence.v2";
export const AIOS_VERIFIER_ID = "aios-bound-claim-verifier.v1";
export const AIOS_EVIDENCE_MAX_AGE_MS = 15 * 60 * 1000;
export const AIOS_EVIDENCE_MAX_CLOCK_SKEW_MS = 60 * 1000;

const MODULE_PATH = fileURLToPath(import.meta.url);
const AI_OS_ROOT = path.resolve(path.dirname(MODULE_PATH), "../../..");
const VERIFIER_ENTRY_PATH = path.join(AI_OS_ROOT, "apps", "aios-verifier.mjs");
const CLI_ENTRY_PATH = path.join(AI_OS_ROOT, "apps", "aios-cli.mjs");

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function digestJson(value) {
  return createHash("sha256").update(typeof value === "string" ? value : stableJson(value)).digest("hex");
}

export function digestFile(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function currentVerifierIdentity() {
  return Object.freeze({
    id: AIOS_VERIFIER_ID,
    entrypoint: "apps/aios-verifier.mjs",
    entrypointSha256: digestFile(VERIFIER_ENTRY_PATH),
    bindingModule: "packages/aios-language/runtime/claim-evidence.mjs",
    bindingModuleSha256: digestFile(MODULE_PATH),
    cli: "apps/aios-cli.mjs",
    cliSha256: digestFile(CLI_ENTRY_PATH),
    node: process.version,
  });
}

function canonicalTimestamp(value) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : null;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function withinRoot(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  return resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${path.sep}`);
}

function checkedJsonFile(root, candidate) {
  if (typeof candidate !== "string" || !withinRoot(root, candidate)) return null;
  try {
    const stat = fs.lstatSync(candidate);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    return readJson(candidate);
  } catch {
    return null;
  }
}

function providerArtifactCheck({ artifactRoot, job, runProof, operation = null }) {
  const expectedOperations = (Array.isArray(job?.syscalls) ? job.syscalls : [])
    .map((entry) => entry?.op)
    .filter((op) => op === "provider.read" || op === "provider.compute")
    .filter((op) => operation === null || op === `provider.${operation}`);
  const observed = Array.isArray(runProof?.syscallResults) ? runProof.syscallResults : [];
  const failures = [];

  if (expectedOperations.length === 0) failures.push("no_matching_provider_syscall_declared");
  for (const op of expectedOperations) {
    const receipt = observed.find((entry) => entry?.op === op);
    const resultPath = receipt?.output?.resultPath;
    const artifact = checkedJsonFile(artifactRoot, resultPath);
    if (receipt?.ok !== true || !artifact) {
      failures.push(`${op}:missing_or_unreadable_result_artifact`);
      continue;
    }
    if (receipt.output.outputBoundary !== "internal-artifact-only"
        || receipt.output.externalWrites !== true
        || receipt.output.externalTransportEffect !== "network-post"
        || receipt.output.resultStorageExternalWrites !== false
        || receipt.output.remoteSideEffects !== "not_observable") {
      failures.push(`${op}:effect_boundary_invalid`);
    }
    if (receipt.output.resultHash !== digestJson(artifact)) failures.push(`${op}:result_hash_invalid`);
  }
  return {
    ok: failures.length === 0,
    expectedOperations,
    failures,
  };
}

function evaluateVerifierContracts({ artifactRoot, job, runProof }) {
  const contracts = Array.isArray(job?.verifierContracts) ? job.verifierContracts : [];
  if (contracts.length === 0) {
    return {
      checks: [],
      errors: [{ code: "AIOS_JOB_VERIFIER_CONTRACT_REQUIRED" }],
    };
  }

  const checks = [];
  const errors = [];
  for (const rawContract of contracts) {
    const contract = typeof rawContract === "string" ? rawContract.trim().toLowerCase() : "";
    let result = null;
    if (contract === "status exists") {
      const row = (runProof?.syscallResults ?? []).find((entry) => entry?.op === "kernel.artifact.status");
      result = {
        ok: row?.ok === true && row?.output && typeof row.output === "object",
        failures: row?.ok === true && row?.output && typeof row.output === "object" ? [] : ["status_result_missing"],
      };
    } else if (/^provider (?:result )?artifacts exist$/.test(contract)) {
      result = providerArtifactCheck({ artifactRoot, job, runProof });
    } else if (contract === "provider read artifact exists") {
      result = providerArtifactCheck({ artifactRoot, job, runProof, operation: "read" });
    } else if (contract === "provider compute artifact exists") {
      result = providerArtifactCheck({ artifactRoot, job, runProof, operation: "compute" });
    } else {
      errors.push({ code: "AIOS_JOB_VERIFIER_CONTRACT_UNSUPPORTED", contract: rawContract ?? null });
      continue;
    }

    const check = {
      name: `job_verifier_contract:${contract}`,
      ok: result.ok,
      failures: result.failures,
    };
    checks.push(check);
    if (!result.ok) errors.push({ code: "AIOS_JOB_VERIFIER_CONTRACT_FAILED", contract, failures: result.failures });
  }
  return { checks, errors };
}

function recomputeBootProofHash(bootProof) {
  return digestJson({
    route: bootProof.route,
    operatorRequest: bootProof.operatorRequest,
    artifactRoot: bootProof.artifactRoot,
    tenantBoundary: bootProof.tenantBoundary,
    lifecycleSettings: bootProof.lifecycleSettings,
    providerContract: bootProof.providerContract,
    kernelContracts: bootProof.kernelContracts,
    artifactLayout: bootProof.artifactLayout,
    hostedBoot: bootProof.hostedBoot,
  });
}

function recomputeRunProofHash(runProof) {
  return digestJson({
    packetType: "aios.run.proof",
    route: runProof.route,
    operatorRequest: runProof.operatorRequest,
    artifactRoot: runProof.artifactRoot,
    process: runProof.process,
    job: runProof.job,
    lifecycleSettings: runProof.lifecycleSettings,
    providerContract: runProof.providerContract,
    providerPolicy: runProof.providerPolicy,
    kernelMediation: runProof.kernelMediation,
    restartSafety: runProof.restartSafety,
    analytics: runProof.analytics,
    processIndex: runProof.processIndex,
    lifecycle: runProof.lifecycle,
    syscallResults: runProof.syscallResults,
  });
}

function recomputeProcessRecordHash(record) {
  return digestJson({
    processId: record.processId,
    job: record.job,
    state: record.state,
    route: record.route,
    operatorRequest: record.operatorRequest,
    lifecycleSettings: record.lifecycleSettings,
    providerContract: record.providerContract,
    providerPolicy: record.providerPolicy,
    lifecycle: record.lifecycle,
    syscallResults: record.syscallResults,
  });
}

function expectedBinding({ artifactRoot, job, bootProof, runProof, providerPolicy, tenantBoundary }) {
  const normalizedPolicy = normalizeProviderPolicy(providerPolicy);
  return Object.freeze({
    artifactRoot: path.resolve(artifactRoot),
    tenantId: tenantBoundary?.tenantId ?? null,
    tenantBoundaryHash: tenantBoundary?.boundaryHash ?? null,
    workspaceId: job?.boundary?.workspaceId ?? null,
    jobHash: digestJson(job),
    sourceHash: job?.source?.hash ?? null,
    verifierContractsDigest: digestJson(job?.verifierContracts ?? []),
    processId: runProof?.process?.id ?? null,
    bootProofHash: bootProof?.proofHash ?? null,
    bootProofDigest: digestJson(bootProof),
    runProofHash: runProof?.proofHash ?? null,
    runProofDigest: digestJson(runProof),
    providerPolicyDigest: providerPolicyDigest(normalizedPolicy),
  });
}

function addError(errors, code, condition, details = {}) {
  if (!condition) errors.push({ code, ...details });
}

function validateCore({ artifactRoot, job, bootProof, runProof, providerPolicy, tenantBoundary, now = new Date() }) {
  const errors = [];
  const resolvedRoot = path.resolve(artifactRoot);
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now));
  const bootAt = canonicalTimestamp(bootProof?.generatedAt);
  const runAt = canonicalTimestamp(runProof?.generatedAt);
  let processCompletedAt = null;
  const expected = expectedBinding({ artifactRoot: resolvedRoot, job, bootProof, runProof, providerPolicy, tenantBoundary });

  addError(errors, "AIOS_BOOT_PROOF_TYPE_INVALID", bootProof?.packetType === "aios.boot.proof");
  addError(errors, "AIOS_BOOT_PROOF_NOT_GREEN", bootProof?.ok === true);
  addError(errors, "AIOS_BOOT_PROOF_ROOT_MISMATCH", path.resolve(String(bootProof?.artifactRoot ?? "")) === resolvedRoot);
  addError(errors, "AIOS_BOOT_PROOF_HASH_INVALID", bootProof?.proofHash === recomputeBootProofHash(bootProof ?? {}));
  addError(errors, "AIOS_BOOT_TENANT_MISMATCH", bootProof?.tenantBoundary?.tenantId === tenantBoundary?.tenantId);
  addError(errors, "AIOS_BOOT_TENANT_HASH_MISMATCH", bootProof?.tenantBoundary?.boundaryHash === tenantBoundary?.boundaryHash);

  addError(errors, "AIOS_RUN_PROOF_TYPE_INVALID", runProof?.packetType === "aios.run.proof");
  addError(errors, "AIOS_RUN_PROOF_NOT_GREEN", runProof?.ok === true);
  addError(errors, "AIOS_RUN_PROOF_ROOT_MISMATCH", path.resolve(String(runProof?.artifactRoot ?? "")) === resolvedRoot);
  addError(errors, "AIOS_RUN_PROOF_HASH_INVALID", runProof?.proofHash === recomputeRunProofHash(runProof ?? {}));
  addError(errors, "AIOS_RUN_JOB_MISMATCH", runProof?.job?.hash === expected.jobHash, {
    expectedJobHash: expected.jobHash,
    actualJobHash: runProof?.job?.hash ?? null,
  });
  addError(errors, "AIOS_RUN_PROCESS_NOT_COMPLETED", runProof?.process?.state === "completed");
  addError(errors, "AIOS_RUN_PROCESS_ID_MISSING", typeof runProof?.process?.id === "string" && runProof.process.id.length > 0);
  addError(errors, "AIOS_RUN_TENANT_MISMATCH", runProof?.operatorRequest?.operatorScope?.tenantId === tenantBoundary?.tenantId);
  addError(errors, "AIOS_RUN_POLICY_MISMATCH", runProof?.providerPolicy?.digest === expected.providerPolicyDigest, {
    expectedPolicyDigest: expected.providerPolicyDigest,
    actualPolicyDigest: runProof?.providerPolicy?.digest ?? null,
  });
  if ((job?.providerAccess?.grants?.length ?? 0) > 0) {
    addError(errors, "AIOS_JOB_POLICY_MISMATCH", job.providerAccess.policyDigest === expected.providerPolicyDigest);
  }

  const processPath = runProof?.process?.recordPath;
  addError(errors, "AIOS_RUN_PROCESS_RECORD_OUTSIDE_ROOT", typeof processPath === "string" && withinRoot(resolvedRoot, processPath));
  if (typeof processPath === "string" && withinRoot(resolvedRoot, processPath) && fs.existsSync(processPath)) {
    try {
      const record = readJson(processPath);
      addError(errors, "AIOS_RUN_PROCESS_RECORD_ID_MISMATCH", record.processId === runProof.process.id);
      addError(errors, "AIOS_RUN_PROCESS_RECORD_JOB_MISMATCH", record.job?.hash === expected.jobHash);
      addError(errors, "AIOS_RUN_PROCESS_RECORD_STATE_INVALID", record.state === "completed");
      addError(errors, "AIOS_RUN_PROCESS_RECORD_HASH_INVALID",
        record.recordHash === runProof.process.recordHash && record.recordHash === recomputeProcessRecordHash(record));
      const completionTimes = (Array.isArray(record.lifecycle) ? record.lifecycle : [])
        .filter((entry) => entry?.state === "completed")
        .map((entry) => canonicalTimestamp(entry?.at))
        .filter((value) => value !== null);
      processCompletedAt = completionTimes.length > 0 ? Math.max(...completionTimes) : null;
      addError(errors, "AIOS_RUN_PROCESS_COMPLETION_TIMESTAMP_MISSING", processCompletedAt !== null);
    } catch (error) {
      errors.push({ code: "AIOS_RUN_PROCESS_RECORD_INVALID", message: error.message });
    }
  } else {
    errors.push({ code: "AIOS_RUN_PROCESS_RECORD_MISSING", processPath: processPath ?? null });
  }

  addError(errors, "AIOS_BOOT_TIMESTAMP_INVALID", bootAt !== null);
  addError(errors, "AIOS_RUN_TIMESTAMP_INVALID", runAt !== null);
  if (bootAt !== null && runAt !== null) addError(errors, "AIOS_EVIDENCE_ORDER_INVALID", bootAt <= runAt);
  if (processCompletedAt !== null && runAt !== null) {
    addError(errors, "AIOS_RUN_PROCESS_COMPLETION_ORDER_INVALID", processCompletedAt <= runAt);
  }
  if (Number.isFinite(nowMs) && bootAt !== null) {
    addError(errors, "AIOS_BOOT_EVIDENCE_FROM_FUTURE", bootAt <= nowMs + AIOS_EVIDENCE_MAX_CLOCK_SKEW_MS);
    addError(errors, "AIOS_BOOT_EVIDENCE_STALE", nowMs - bootAt <= AIOS_EVIDENCE_MAX_AGE_MS, {
      ageMs: nowMs - bootAt,
      maximumAgeMs: AIOS_EVIDENCE_MAX_AGE_MS,
    });
  }
  if (Number.isFinite(nowMs) && runAt !== null) {
    addError(errors, "AIOS_RUN_EVIDENCE_FROM_FUTURE", runAt <= nowMs + AIOS_EVIDENCE_MAX_CLOCK_SKEW_MS);
    addError(errors, "AIOS_RUN_EVIDENCE_STALE", nowMs - runAt <= AIOS_EVIDENCE_MAX_AGE_MS, {
      ageMs: nowMs - runAt,
      maximumAgeMs: AIOS_EVIDENCE_MAX_AGE_MS,
    });
  }

  if (Number.isFinite(nowMs) && processCompletedAt !== null) {
    addError(errors, "AIOS_RUN_PROCESS_COMPLETION_FROM_FUTURE", processCompletedAt <= nowMs + AIOS_EVIDENCE_MAX_CLOCK_SKEW_MS);
    addError(errors, "AIOS_RUN_PROCESS_COMPLETION_STALE", nowMs - processCompletedAt <= AIOS_EVIDENCE_MAX_AGE_MS, {
      ageMs: nowMs - processCompletedAt,
      maximumAgeMs: AIOS_EVIDENCE_MAX_AGE_MS,
    });
  }

  const verifierContracts = evaluateVerifierContracts({ artifactRoot: resolvedRoot, job, runProof });
  errors.push(...verifierContracts.errors);

  return {
    errors,
    binding: expected,
    bootAt,
    runAt,
    processCompletedAt,
    nowMs,
    verifierChecks: verifierContracts.checks,
  };
}

function evidenceChecks(core) {
  return core.errors.length === 0
    ? [
      { name: "exact_job_run_tenant_policy_binding", ok: true },
      ...core.verifierChecks,
    ]
    : core.errors.map((error) => ({ name: error.code, ok: false, details: error }));
}

export function createBoundVerifierEvidence({
  artifactRoot,
  job,
  bootProof,
  runProof,
  providerPolicy,
  tenantBoundary,
  now = new Date(),
} = {}) {
  const core = validateCore({ artifactRoot, job, bootProof, runProof, providerPolicy, tenantBoundary, now });
  const generatedAt = (now instanceof Date ? now : new Date(now)).toISOString();
  const checks = evidenceChecks(core);
  return Object.freeze({
    schemaVersion: AIOS_VERIFIER_EVIDENCE_SCHEMA,
    packetType: "aios.verifier.evidence",
    ok: core.errors.length === 0,
    status: core.errors.length === 0 ? "green" : "red",
    generatedAt,
    verifier: currentVerifierIdentity(),
    binding: core.binding,
    checks,
    evidence: [{ kind: "current_artifact_replay", bindingDigest: digestJson(core.binding) }],
    truthBoundary: "This local replay validates fresh bound artifact integrity and the supported job verifier contracts listed in checks. Executable hashes detect version drift; this packet is not a cryptographic signature against a principal who can rewrite both source and artifacts.",
  });
}

export function validateBoundVerifierEvidence({
  artifactRoot,
  job,
  bootProof,
  runProof,
  verifierEvidence,
  providerPolicy,
  tenantBoundary,
  now = new Date(),
} = {}) {
  const core = validateCore({ artifactRoot, job, bootProof, runProof, providerPolicy, tenantBoundary, now });
  const errors = [...core.errors];
  const verifierAt = canonicalTimestamp(verifierEvidence?.generatedAt);
  const identity = currentVerifierIdentity();
  const expectedChecks = evidenceChecks(core);

  addError(errors, "AIOS_VERIFIER_SCHEMA_INVALID", verifierEvidence?.schemaVersion === AIOS_VERIFIER_EVIDENCE_SCHEMA);
  addError(errors, "AIOS_VERIFIER_PACKET_TYPE_INVALID", verifierEvidence?.packetType === "aios.verifier.evidence");
  addError(errors, "AIOS_VERIFIER_NOT_GREEN", verifierEvidence?.ok === true && verifierEvidence?.status === "green");
  addError(errors, "AIOS_VERIFIER_IDENTITY_MISMATCH", stableJson(verifierEvidence?.verifier) === stableJson(identity), {
    expectedVerifier: identity,
    actualVerifier: verifierEvidence?.verifier ?? null,
  });
  addError(errors, "AIOS_VERIFIER_BINDING_MISMATCH", stableJson(verifierEvidence?.binding) === stableJson(core.binding), {
    expectedBinding: core.binding,
    actualBinding: verifierEvidence?.binding ?? null,
  });
  addError(errors, "AIOS_VERIFIER_CHECKS_INVALID",
    Array.isArray(verifierEvidence?.checks)
      && verifierEvidence.checks.length > 0
      && verifierEvidence.checks.every((check) => check?.ok === true));
  addError(errors, "AIOS_VERIFIER_CHECKS_MISMATCH", stableJson(verifierEvidence?.checks) === stableJson(expectedChecks), {
    expectedChecks,
    actualChecks: verifierEvidence?.checks ?? null,
  });
  addError(errors, "AIOS_VERIFIER_TIMESTAMP_INVALID", verifierAt !== null);
  if (core.runAt !== null && verifierAt !== null) addError(errors, "AIOS_VERIFIER_ORDER_INVALID", core.runAt <= verifierAt);
  if (Number.isFinite(core.nowMs) && verifierAt !== null) {
    addError(errors, "AIOS_VERIFIER_FROM_FUTURE", verifierAt <= core.nowMs + AIOS_EVIDENCE_MAX_CLOCK_SKEW_MS);
    addError(errors, "AIOS_VERIFIER_STALE", core.nowMs - verifierAt <= AIOS_EVIDENCE_MAX_AGE_MS, {
      ageMs: core.nowMs - verifierAt,
      maximumAgeMs: AIOS_EVIDENCE_MAX_AGE_MS,
    });
  }

  return Object.freeze({
    ok: errors.length === 0,
    errors: Object.freeze(errors),
    binding: core.binding,
    verifier: identity,
    observedAt: (now instanceof Date ? now : new Date(now)).toISOString(),
  });
}
