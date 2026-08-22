import { createHash } from "node:crypto";

export const AIOS_PROVIDER_WORKFLOW_SCHEMA = "aios.provider-workflow.v1";
export const AIOS_PROVIDER_WORKFLOW_RESULT_SCHEMA = "aios.provider-workflow-result.v1";

export const PROVIDER_WORKFLOWS = Object.freeze({
  "research-synthesis": Object.freeze({
    id: "research-synthesis",
    title: "Grounded research synthesis",
    purpose: "Retrieve canonical context and synthesize a concise evidence-backed answer.",
    synthesisInstruction: "Synthesize the retrieved evidence into a concise internal research note. Separate observed facts from inference and mention conflicts or missing evidence.",
  }),
  "contradiction-review": Object.freeze({
    id: "contradiction-review",
    title: "Contradiction and stale-claim review",
    purpose: "Retrieve relevant records and identify contradictions, stale claims, or unresolved uncertainty.",
    synthesisInstruction: "Review the retrieved evidence for contradictions, stale claims, and unresolved uncertainty. Prefer explicit corrections and current canonical records. Return an internal audit note.",
  }),
  "implementation-brief": Object.freeze({
    id: "implementation-brief",
    title: "Grounded implementation brief",
    purpose: "Retrieve project truth and turn it into a bounded implementation brief without taking external action.",
    synthesisInstruction: "Turn the retrieved evidence into a bounded internal implementation brief with objective, in-scope surfaces, acceptance checks, blockers, and a truth boundary. Do not claim execution occurred.",
  }),
});

function stableClone(value) {
  if (Array.isArray(value)) return value.map(stableClone);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableClone(value[key])]));
  }
  return value;
}

export function stableHash(value) {
  return createHash("sha256").update(JSON.stringify(stableClone(value))).digest("hex");
}

function sourceString(value) {
  const safe = String(value)
    .replace(/\\/g, "/")
    .replace(/"/g, "'")
    .replace(/#/g, "number ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ");
  return `"${safe}"`;
}

function safeJobToken(value) {
  const token = String(value).replace(/[^a-zA-Z0-9]/g, " ").split(/\s+/).filter(Boolean)
    .map((part, index) => index === 0 ? part.toLowerCase() : `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join("");
  return token || "providerWorkflow";
}

export function workflowDefinition(workflowId) {
  const definition = PROVIDER_WORKFLOWS[String(workflowId)];
  if (!definition) throw new Error(`Unknown provider workflow: ${workflowId}`);
  return definition;
}

export function renderProviderReadSource({ workflowId, query, provider = "cortex", nResults = 5 } = {}) {
  workflowDefinition(workflowId);
  const job = `${safeJobToken(workflowId)}Read`;
  return `# Generated recurring provider workflow read phase.\njob ${job} {\n  capability provider.${provider}.read: read @external;\n  memory providerArtifacts: persistent;\n  step recall uses provider.read(provider: ${sourceString(provider)}, query: ${sourceString(query)}, n_results: ${Math.max(1, Math.min(50, Number(nResults) || 5))}) writes [providerArtifacts] -> recallReceipt recover halt;\n  verify provider read artifact exists;\n  truth providerReadState: source=\"provider-result-artifact\", confidence=\"observed\";\n  rollback retain_artifacts;\n}\n`;
}

export function renderProviderComputeSource({ workflowId, query, retrievedEvidence, provider = "cortex", model = "tinyllama", responseMode = "default", maxEvidenceChars = 16_000 } = {}) {
  const definition = workflowDefinition(workflowId);
  const evidence = JSON.stringify(stableClone(retrievedEvidence ?? null)).slice(0, Math.max(1000, Number(maxEvidenceChars) || 16_000));
  const evidenceHash = stableHash(retrievedEvidence ?? null);
  const prompt = [
    definition.synthesisInstruction,
    `Original request: ${String(query)}`,
    `Retrieved evidence hash: ${evidenceHash}`,
    "Retrieved evidence (provider response, internal use only):",
    evidence,
  ].join("\n\n");
  const job = `${safeJobToken(workflowId)}Compute`;
  return `# Generated recurring provider workflow synthesis phase.\njob ${job} {\n  capability provider.${provider}.compute: compute @external;\n  memory providerArtifacts: persistent;\n  step synthesize uses provider.compute(provider: ${sourceString(provider)}, prompt: ${sourceString(prompt)}, model: ${sourceString(model)}, response_mode: ${sourceString(responseMode)}) writes [providerArtifacts] -> computeReceipt recover halt;\n  verify provider compute artifact exists;\n  truth providerComputeState: source=\"provider-result-artifact\", confidence=\"observed\";\n  rollback retain_artifacts;\n}\n`;
}

export function renderBlockedWriteProbe({ provider = "cortex" } = {}) {
  return `# Controlled negative probe: this source must never compile.\njob blockedProviderWrite {\n  capability provider.${provider}.write: write @external;\n  step publish uses provider.write(provider: ${sourceString(provider)}, body: \"forbidden\") -> receipt recover halt;\n  verify receipt exists;\n  truth writeState: source=\"provider\", confidence=\"observed\";\n  rollback halt;\n}\n`;
}

export function compactWorkflowLedgerEntry(result = {}) {
  return Object.freeze({
    schemaVersion: AIOS_PROVIDER_WORKFLOW_RESULT_SCHEMA,
    runId: result.runId,
    workflowId: result.workflowId,
    status: result.status,
    claimStatus: result.claimStatus,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    durationMs: result.durationMs,
    queryHash: result.queryHash,
    provenanceHash: result.provenanceHash,
    readResponseStatus: result.read?.responseStatus ?? null,
    computeResponseStatus: result.compute?.responseStatus ?? null,
    outputBoundary: result.boundary?.outputBoundary ?? null,
    externalWrites: result.boundary?.externalWrites ?? null,
    recoveryStatus: result.recovery?.status ?? null,
    policyDenialObserved: result.policyDenial?.observed === true,
    friction: Object.freeze([...(result.friction ?? [])]),
    metrics: result.metrics,
    artifactRoot: result.artifactRoot,
  });
}
