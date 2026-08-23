#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AIOS_PROVIDER_WORKFLOW_RESULT_SCHEMA,
  compactWorkflowLedgerEntry,
  renderBlockedWriteProbe,
  renderProviderComputeSource,
  renderProviderReadSource,
  stableHash,
  workflowDefinition,
} from "../packages/aios-language/workflows/provider-dogfood.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = path.join(root, "apps", "aios-cli.mjs");
const verifierCli = path.join(root, "apps", "aios-verifier.mjs");
const defaultPolicy = path.join(root, "kernel", "policy", "provider-read-compute.json");

function parseArgs(tokens) {
  const flags = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = tokens[index + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }
  return flags;
}

function insideRoot(candidate, label) {
  const resolved = path.resolve(candidate);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error(`${label} must stay inside ${root}`);
  return resolved;
}

function parseJsonOutput(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return null;
  try { return JSON.parse(trimmed); } catch {}
  const start = trimmed.lastIndexOf("\n{");
  if (start >= 0) return JSON.parse(trimmed.slice(start + 1));
  throw new Error(`Command returned non-JSON output: ${trimmed.slice(0, 500)}`);
}

function runCli(args, { expectFailure = false } = {}) {
  const execution = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const output = parseJsonOutput(execution.stdout || execution.stderr);
  if (!expectFailure && execution.status !== 0) {
    throw new Error(`AIOS CLI failed (${execution.status}): ${JSON.stringify(output)}`);
  }
  if (expectFailure && execution.status === 0) throw new Error("Controlled policy-denial probe unexpectedly succeeded.");
  return { status: execution.status, output };
}

function runVerifier(args) {
  const execution = spawnSync(process.execPath, [verifierCli, ...args], { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const output = parseJsonOutput(execution.stdout || execution.stderr);
  if (execution.status !== 0 || output?.ok !== true) {
    throw new Error(`AIOS verifier failed (${execution.status}): ${JSON.stringify(output)}`);
  }
  return output;
}

function providerReceipt(runPacket, operation) {
  const row = (runPacket?.syscallResults ?? []).find((entry) => entry.op === `provider.${operation}` && entry.ok === true);
  if (!row?.output?.resultPath) throw new Error(`Missing provider.${operation} result receipt.`);
  return row.output;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function fileHash(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function appendLedger(ledgerPath, entry) {
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.appendFileSync(ledgerPath, `${JSON.stringify(entry)}\n`, "utf8");
}

export function executeProviderWorkflow(options = {}) {
  const definition = workflowDefinition(options.workflowId);
  const query = String(options.query ?? "").trim();
  if (!query) throw new Error("A non-empty query is required.");
  const runId = String(options.runId ?? `${definition.id}-${new Date().toISOString().replace(/[-:.TZ]/g, "")}`);
  const artifactRoot = insideRoot(options.artifactRoot, "artifact root");
  const policyPath = insideRoot(options.policyPath ?? defaultPolicy, "provider policy");
  const ledgerPath = insideRoot(options.ledgerPath ?? path.join(root, "artifacts", "provider-workflow-dogfood", "ledger.jsonl"), "ledger");
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  fs.mkdirSync(path.join(artifactRoot, "sources"), { recursive: true });

  const contract = {
    schemaVersion: "aios.provider-workflow.contract.v1",
    runId,
    workflow: definition,
    queryHash: stableHash(query),
    provider: options.provider ?? "cortex",
    model: options.model ?? "tinyllama",
    policyPath,
    boundary: {
      outputBoundary: "internal-artifact-only",
      externalWrites: true,
      externalTransportEffect: "network-post",
      resultStorageExternalWrites: false,
      remoteSideEffects: "not_observable",
      runtimeReplacement: false,
    },
    phases: ["read", "compute", "recovery-reuse", "policy-denial", "verify", "claim"],
  };
  fs.writeFileSync(path.join(artifactRoot, "workflow-contract.json"), `${JSON.stringify(contract, null, 2)}\n`);

  const readRoot = path.join(artifactRoot, "phases", "read");
  const readSourcePath = path.join(artifactRoot, "sources", "01-read.aios");
  fs.writeFileSync(readSourcePath, renderProviderReadSource({ workflowId: definition.id, query, provider: contract.provider }));
  const readCompile = runCli(["compile", readSourcePath, "--artifact-root", readRoot, "--workspace", "provider-dogfood", "--provider-policy", policyPath]).output;
  runCli(["boot", "--artifact-root", readRoot]);
  const readRun = runCli(["run", readCompile.jobPaths[0], "--artifact-root", readRoot, "--provider-policy", policyPath]).output;
  const readReceipt = providerReceipt(readRun, "read");
  const readArtifact = readJson(readReceipt.resultPath);

  const computeRoot = path.join(artifactRoot, "phases", "compute");
  const computeSourcePath = path.join(artifactRoot, "sources", "02-compute.aios");
  fs.writeFileSync(computeSourcePath, renderProviderComputeSource({
    workflowId: definition.id,
    query,
    retrievedEvidence: readArtifact.response.body,
    provider: contract.provider,
    model: contract.model,
  }));
  const computeCompile = runCli(["compile", computeSourcePath, "--artifact-root", computeRoot, "--workspace", "provider-dogfood", "--provider-policy", policyPath]).output;
  runCli(["boot", "--artifact-root", computeRoot]);
  const computeRun = runCli(["run", computeCompile.jobPaths[0], "--artifact-root", computeRoot, "--provider-policy", policyPath]).output;
  const computeReceipt = providerReceipt(computeRun, "compute");
  const computeArtifact = readJson(computeReceipt.resultPath);
  const recoveryRun = runCli(["run", computeCompile.jobPaths[0], "--artifact-root", computeRoot, "--provider-policy", policyPath]).output;

  const denialRoot = path.join(artifactRoot, "phases", "policy-denial");
  const denialSourcePath = path.join(artifactRoot, "sources", "03-blocked-write.aios");
  fs.writeFileSync(denialSourcePath, renderBlockedWriteProbe({ provider: contract.provider }));
  const denial = runCli(["compile", denialSourcePath, "--artifact-root", denialRoot, "--workspace", "provider-dogfood", "--provider-policy", policyPath], { expectFailure: true });
  const denialDiagnostics = denial.output?.diagnostics ?? denial.output?.details?.diagnostics ?? [];
  const denialCodes = denialDiagnostics.map((entry) => entry.code);

  const checks = [
    { id: "read-http-200", ok: readReceipt.responseStatus === 200 },
    { id: "compute-http-200", ok: computeReceipt.responseStatus === 200 },
    { id: "read-internal-artifact", ok: readReceipt.outputBoundary === "internal-artifact-only" && readReceipt.resultStorageExternalWrites === false && fs.existsSync(readReceipt.resultPath) },
    { id: "compute-internal-artifact", ok: computeReceipt.outputBoundary === "internal-artifact-only" && computeReceipt.resultStorageExternalWrites === false && fs.existsSync(computeReceipt.resultPath) },
    { id: "retrieval-fed-synthesis", ok: readArtifact.response.body != null && fs.readFileSync(computeSourcePath, "utf8").includes(stableHash(readArtifact.response.body)) },
    { id: "restart-safe-reuse", ok: recoveryRun.restartSafety?.status === "completed_record_reused" },
    { id: "provider-write-denied", ok: denial.status !== 0 && denialCodes.includes("AIOS_CANONICAL_EXTERNAL_EFFECT_BLOCKED") },
    { id: "external-posts-reported", ok: [readReceipt, computeReceipt].every((receipt) => receipt.externalWrites === true && receipt.externalTransportEffect === "network-post") },
    { id: "remote-effects-not-overclaimed", ok: [readArtifact, computeArtifact].every((artifact) => artifact.boundary.remoteSideEffects === "not_observable") },
  ];
  const verifier = {
    schemaVersion: "aios.provider-workflow.verifier.v1",
    ok: checks.every((check) => check.ok),
    status: checks.every((check) => check.ok) ? "green" : "red",
    evidence: {
      checks,
      readResult: { path: readReceipt.resultPath, hash: fileHash(readReceipt.resultPath), bodyHash: readArtifact.response.bodyHash },
      computeResult: { path: computeReceipt.resultPath, hash: fileHash(computeReceipt.resultPath), bodyHash: computeArtifact.response.bodyHash },
      recoveryStatus: recoveryRun.restartSafety?.status ?? null,
      denialCodes,
    },
    boundary: contract.boundary,
  };
  fs.mkdirSync(path.join(computeRoot, "reports"), { recursive: true });
  const workflowCheckPath = path.join(computeRoot, "reports", "workflow-checks.json");
  fs.writeFileSync(workflowCheckPath, `${JSON.stringify(verifier, null, 2)}\n`);
  if (!verifier.ok) throw new Error(`Workflow verifier failed: ${JSON.stringify(checks.filter((check) => !check.ok))}`);
  const trustedVerifier = runVerifier([
    "--job", computeCompile.jobPaths[0],
    "--artifact-root", computeRoot,
    "--provider-policy", policyPath,
  ]);
  const claim = runCli(["claim", computeCompile.jobPaths[0], "--artifact-root", computeRoot, "--provider-policy", policyPath]).output;

  const completedAt = new Date().toISOString();
  const result = {
    schemaVersion: AIOS_PROVIDER_WORKFLOW_RESULT_SCHEMA,
    runId,
    workflowId: definition.id,
    status: "green",
    claimStatus: claim.claimStatus,
    startedAt,
    completedAt,
    durationMs: Date.now() - startedMs,
    queryHash: stableHash(query),
    provenanceHash: stableHash({ read: readArtifact.response.bodyHash, compute: computeArtifact.response.bodyHash, contract }),
    artifactRoot,
    read: { ...readReceipt, bodyHash: readArtifact.response.bodyHash },
    compute: { ...computeReceipt, bodyHash: computeArtifact.response.bodyHash },
    recovery: { status: recoveryRun.restartSafety?.status ?? null, processId: recoveryRun.processId },
    policyDenial: { observed: denial.status !== 0, exitCode: denial.status, diagnosticCodes: denialCodes },
    boundary: contract.boundary,
    verifier: { path: trustedVerifier.verifierPath, workflowCheckPath, checks, binding: trustedVerifier.binding },
    claim: {
      path: claim.claimPath,
      subject: claim.subject,
      scope: claim.claimScope,
      workflowChecksBoundSeparately: workflowCheckPath,
    },
    friction: options.frictionCode ? [{ code: options.frictionCode, detail: String(options.frictionDetail ?? "") }] : [],
    metrics: {
      providerCalls: 2,
      successfulProviderCalls: 2,
      modeledManualSteps: 8,
      observedRunnerCommands: 1,
      modeledGlueStepReduction: 0.875,
      glueMetricKind: "estimated-from-workflow-command-model",
    },
  };
  const resultPath = path.join(artifactRoot, "workflow-result.json");
  fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  const ledgerEntry = compactWorkflowLedgerEntry(result);
  appendLedger(ledgerPath, ledgerEntry);
  return { ...result, resultPath, ledgerPath };
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  try {
    const output = executeProviderWorkflow({
      workflowId: flags.workflow,
      query: flags.query,
      runId: flags["run-id"],
      artifactRoot: flags["artifact-root"],
      policyPath: flags["provider-policy"],
      ledgerPath: flags.ledger,
      provider: flags.provider,
      model: flags.model,
      frictionCode: flags.friction,
      frictionDetail: flags["friction-detail"],
    });
    console.log(JSON.stringify(output, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message, stack: error.stack }, null, 2));
    process.exitCode = 1;
  }
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) main();
