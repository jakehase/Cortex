import { createHash } from "node:crypto";

import { compileLanguageSource } from "./api/compiler-api.mjs";
import {
  buildProviderAccessContract,
  normalizeProviderPolicy,
  providerOperationFromSyscall,
} from "./runtime/provider-read-compute.mjs";
import {
  AIOS_CANONICAL_COMPILER,
  AIOS_CANONICAL_GRAMMAR,
  AIOS_CANONICAL_LANGUAGE_VERSION,
  AIOS_CANONICAL_SOURCE_EXTENSION,
  AIOS_V1_RUNTIME_OPERATIONS,
} from "./governance/version-freeze.mjs";

export {
  AIOS_CANONICAL_COMPILER,
  AIOS_CANONICAL_GRAMMAR,
  AIOS_CANONICAL_LANGUAGE_VERSION,
  AIOS_CANONICAL_SOURCE_EXTENSION,
} from "./governance/version-freeze.mjs";

const CANONICAL_RUNTIME_OPERATIONS = new Set(AIOS_V1_RUNTIME_OPERATIONS);

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function stableClone(value) {
  if (Array.isArray(value)) return value.map(stableClone);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableClone(value[key])]));
  }
  return value;
}

function canonicalDiagnostic(severity, code, message, path = "$") {
  return Object.freeze({ severity, code, message, path });
}

function runtimeOperation(adapter = "") {
  const normalized = String(adapter).trim();
  return CANONICAL_RUNTIME_OPERATIONS.has(normalized) ? normalized : null;
}

function sourceJobForContract(ast, contract) {
  return (ast?.jobs ?? []).find((job) => job.name === contract.sourceName || contract.id.endsWith(`.${job.name}`)) ?? null;
}

function emitRuntimeJob(contract, sourceJob, context, providerAccess) {
  const adapters = contract.adapterHandoff?.adapters ?? [];
  const syscalls = adapters.map((adapter, index) => ({
    id: adapter.step || `step-${index + 1}`,
    op: runtimeOperation(adapter.adapter),
    args: stableClone(adapter.input ?? {}),
    reads: [...(adapter.reads ?? [])],
    writes: [...(adapter.writes ?? [])],
    recovery: adapter.recovery ?? sourceJob?.rollback?.strategy ?? "halt",
  }));
  const truthBoundaries = contract.verifier?.truthBoundaries ?? [];
  const hasProviderTransport = providerAccess.grants.length > 0;

  return Object.freeze({
    schemaVersion: "aios.language-job.v1",
    id: contract.id,
    name: contract.sourceName ?? sourceJob?.name ?? contract.id,
    title: `AIOS language job: ${contract.sourceName ?? contract.id}`,
    source: Object.freeze({
      language: AIOS_CANONICAL_LANGUAGE_VERSION,
      grammar: AIOS_CANONICAL_GRAMMAR,
      compiler: AIOS_CANONICAL_COMPILER,
      path: context.sourceName,
      hash: context.sourceHash,
    }),
    boundary: Object.freeze({
      mode: hasProviderTransport ? "capability-gated-read-compute" : "internal-only",
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      externalWrites: hasProviderTransport,
      externalTransportEffect: hasProviderTransport ? "network-post" : "none",
      resultStorageExternalWrites: false,
      remoteSideEffects: hasProviderTransport ? "not_observable" : "none",
      providerAccess: hasProviderTransport,
      outputBoundary: "internal-artifact-only",
    }),
    capabilities: Object.freeze([...(contract.capabilities ?? [])]),
    memory: Object.freeze([...(contract.memory ?? [])]),
    syscalls: Object.freeze(syscalls),
    verifierContracts: Object.freeze([...(contract.verifier?.contracts ?? [])]),
    truthBoundary: Object.freeze({
      required: true,
      claims: Object.freeze([...truthBoundaries]),
    }),
    recovery: Object.freeze({
      strategy: sourceJob?.rollback?.strategy ?? "halt",
      target: sourceJob?.rollback?.target ?? null,
      stepRecovery: Object.freeze(syscalls.map((syscall) => ({ step: syscall.id, action: syscall.recovery }))),
    }),
    handoff: Object.freeze({
      providers: Object.freeze([...(contract.adapterHandoff?.providers ?? [])]),
      external: contract.adapterHandoff?.external === true,
      externalWrites: hasProviderTransport,
      externalTransportEffect: hasProviderTransport ? "network-post" : "none",
      resultStorageExternalWrites: false,
      lifecycle: contract.lifecycle ?? null,
    }),
    providerAccess,
  });
}

export function compileCanonicalAiosSource(source = "", options = {}) {
  const text = String(source ?? "");
  const sourceName = String(options.sourceName ?? options.fileName ?? "inline.aios");
  const sourceHash = sha256(text);
  const tenantId = String(options.tenantId ?? options.tenant ?? "openclaw-local");
  const workspaceId = String(options.workspaceId ?? options.workspace ?? "default");
  const providerPolicy = normalizeProviderPolicy(options.providerPolicy ?? {});
  const diagnostics = [];

  if (!sourceName.endsWith(AIOS_CANONICAL_SOURCE_EXTENSION)) {
    diagnostics.push(canonicalDiagnostic(
      "error",
      "AIOS_CANONICAL_SOURCE_EXTENSION",
      `Canonical AIOS source must use the ${AIOS_CANONICAL_SOURCE_EXTENSION} extension.`,
      "$.sourceName",
    ));
  }

  const compiled = compileLanguageSource(text, {
    ...options,
    sourceName,
    fileName: sourceName,
    tenantId,
    workspaceId,
    allowedProviders: options.allowedProviders ?? ["runtime", "kernel", "process", "internal", "provider"],
    deniedProviders: options.deniedProviders ?? [],
    acceptedProviderContracts: options.acceptedProviderContracts
      ?? (providerPolicy.enabled ? ["runtime"] : []),
    acceptProviderContract: options.acceptProviderContract ?? providerPolicy.enabled,
  });

  diagnostics.push(...(compiled.diagnostics?.diagnostics ?? []));
  const contracts = compiled.kernel?.contracts ?? [];
  const providerAccessByContract = new Map();

  if (contracts.length === 0) {
    diagnostics.push(canonicalDiagnostic("error", "AIOS_CANONICAL_NO_JOBS", "Source must compile to at least one kernel job.", "$.jobs"));
  }

  for (const contract of contracts) {
    const providerAccess = buildProviderAccessContract({
      policy: providerPolicy,
      capabilities: contract.capabilities ?? [],
      adapters: contract.adapterHandoff?.adapters ?? [],
      tenantId,
      workspaceId,
    });
    providerAccessByContract.set(contract.id, providerAccess);
    const externalCapabilities = (contract.capabilities ?? []).filter((capability) => capability.boundary === "external");
    const grantedCapabilities = new Set(providerAccess.grants.map((grant) => grant.capability));
    const ungrantedExternalCapabilities = externalCapabilities.filter((capability) => !grantedCapabilities.has(capability.name));
    if (ungrantedExternalCapabilities.length > 0) {
      diagnostics.push(canonicalDiagnostic(
        "error",
        "AIOS_CANONICAL_EXTERNAL_EFFECT_BLOCKED",
        `Job ${contract.id} requests an external capability outside the gated provider read/compute policy.`,
        `$.jobs.${contract.id}.boundary`,
      ));
    }
    for (const violation of providerAccess.violations) {
      diagnostics.push(canonicalDiagnostic(
        "error",
        violation.code,
        `Job ${contract.id} provider operation is blocked: ${violation.provider ?? "unknown-provider"}/${violation.operation ?? "unknown-operation"}.`,
        `$.jobs.${contract.id}.providerAccess`,
      ));
    }
    if ((contract.capabilities ?? []).length === 0) {
      diagnostics.push(canonicalDiagnostic("error", "AIOS_CANONICAL_CAPABILITY_REQUIRED", `Job ${contract.id} must declare a capability.`, `$.jobs.${contract.id}.capabilities`));
    }
    if ((contract.verifier?.contracts ?? []).length === 0) {
      diagnostics.push(canonicalDiagnostic("error", "AIOS_CANONICAL_VERIFIER_REQUIRED", `Job ${contract.id} must declare a verifier.`, `$.jobs.${contract.id}.verifier`));
    }
    if ((contract.verifier?.truthBoundaries ?? []).length === 0) {
      diagnostics.push(canonicalDiagnostic("error", "AIOS_CANONICAL_TRUTH_REQUIRED", `Job ${contract.id} must declare a truth boundary.`, `$.jobs.${contract.id}.truthBoundary`));
    }
    for (const adapter of contract.adapterHandoff?.adapters ?? []) {
      if (!runtimeOperation(adapter.adapter)) {
        diagnostics.push(canonicalDiagnostic(
          "error",
          "AIOS_CANONICAL_RUNTIME_ADAPTER_BLOCKED",
          `Adapter ${adapter.adapter} is not an internal kernel/process operation.`,
          `$.jobs.${contract.id}.steps.${adapter.step ?? "unknown"}`,
        ));
      }
      if (providerOperationFromSyscall(adapter.adapter)
        && !providerAccess.grants.some((grant) => grant.syscall === adapter.adapter)) {
        diagnostics.push(canonicalDiagnostic(
          "error",
          "AIOS_CANONICAL_PROVIDER_GRANT_REQUIRED",
          `Adapter ${adapter.adapter} has no matching provider capability grant.`,
          `$.jobs.${contract.id}.steps.${adapter.step ?? "unknown"}`,
        ));
      }
    }
  }

  if (compiled.status?.exportReady !== true || compiled.restartStatus?.exportReady !== true) {
    diagnostics.push(canonicalDiagnostic(
      "error",
      "AIOS_CANONICAL_EXPORT_NOT_READY",
      `Compiler status is ${compiled.status?.state ?? "unknown"}; source is not ready for runtime export.`,
      "$.compiler.status",
    ));
  }

  const blockingDiagnostics = diagnostics.filter((diagnostic) => String(diagnostic.severity).toLowerCase() === "error");
  const ok = blockingDiagnostics.length === 0;
  const context = { sourceName, sourceHash, tenantId, workspaceId };
  const jobs = ok
    ? contracts.map((contract) => emitRuntimeJob(
      contract,
      sourceJobForContract(compiled.ast, contract),
      context,
      providerAccessByContract.get(contract.id),
    ))
    : [];
  const providerGrantCount = [...providerAccessByContract.values()]
    .reduce((count, access) => count + access.grants.length, 0);

  return Object.freeze({
    ok,
    protocol: AIOS_CANONICAL_COMPILER,
    language: Object.freeze({
      version: AIOS_CANONICAL_LANGUAGE_VERSION,
      grammar: AIOS_CANONICAL_GRAMMAR,
      sourceExtension: AIOS_CANONICAL_SOURCE_EXTENSION,
    }),
    source: Object.freeze({ name: sourceName, hash: sourceHash, bytes: Buffer.byteLength(text, "utf8") }),
    boundary: Object.freeze({
      mode: providerGrantCount > 0 ? "capability-gated-read-compute" : "internal-only",
      tenantId,
      workspaceId,
      externalWrites: providerGrantCount > 0,
      externalTransportEffect: providerGrantCount > 0 ? "network-post" : "none",
      resultStorageExternalWrites: false,
      remoteSideEffects: providerGrantCount > 0 ? "not_observable" : "none",
      runtimeReplacement: false,
      providerGrantCount,
      outputBoundary: "internal-artifact-only",
    }),
    status: Object.freeze({
      state: ok ? "ready" : "blocked",
      exportReady: ok,
      jobCount: jobs.length,
      diagnosticCount: diagnostics.length,
      blockingDiagnosticCount: blockingDiagnostics.length,
      nextAction: ok ? "run-compiled-language-job" : "resolve-language-diagnostics",
    }),
    diagnostics: Object.freeze(diagnostics),
    jobs: Object.freeze(jobs),
    compilerEvidence: Object.freeze({
      frontendProtocol: compiled.protocol,
      frontendStatus: compiled.status,
      restartStatus: compiled.restartStatus,
      boundary: compiled.boundary,
      kernelContractCount: contracts.length,
    }),
  });
}

export function assertCanonicalAiosReady() {
  const source = `job canonicalHealth {
  capability aios.status: read @internal;
  memory artifacts: persistent;
  step inspect uses kernel.artifact.status() reads [artifacts] -> status recover halt;
  verify status exists;
  truth artifactState: source="artifact-root", confidence="observed";
  rollback retain_artifacts;
}`;
  const compiled = compileCanonicalAiosSource(source, { sourceName: "canonical-health.aios" });
  return Object.freeze({
    ok: compiled.ok && compiled.jobs.length === 1 && compiled.jobs[0].syscalls[0]?.op === "kernel.artifact.status",
    protocol: compiled.protocol,
    status: compiled.status,
  });
}
