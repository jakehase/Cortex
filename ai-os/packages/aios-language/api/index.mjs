export {
  COMPILE_STATUSES,
  createPermissionBoundaryManifest,
  createScopeAuditManifest,
  createCompileResult,
  normalizeKernelJobDescriptor,
  validateKernelJobDescriptor,
} from "./compile-result.mjs";

export {
  RUNTIME_STATUSES,
  createRuntimeResult,
  summarizeRuntimeResult,
} from "./runtime-result.mjs";

export {
  DEFAULT_BOUNDARY,
  FAILURE_STATES,
  HEALTH_STATUSES,
  LIFECYCLE_COMMANDS,
  LIFECYCLE_MODES,
  NEXT_ACTION_TYPES,
  SCHEDULE_STRATEGIES,
  TIMELINE_KINDS,
  TRUST_LEVELS,
  buildTruthBoundaryAnalytics,
  classifyTruthClaim,
  createTruthBoundaryHandoff,
  exportTruthBoundaryReport,
  mergeTruthBoundaries,
  normalizeLifecycleControls,
  normalizeOperationalHealth,
  normalizeTruthBoundary,
  snapshotTruthBoundary,
  summarizeLifecycleControls,
  summarizeOperationalHealth,
  summarizeTruthBoundary,
} from "./truth-boundary.mjs";

import { createCompileResult } from "./compile-result.mjs";
import { createRuntimeResult, summarizeRuntimeResult } from "./runtime-result.mjs";
import { createTruthBoundaryHandoff } from "./truth-boundary.mjs";

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function selectJobId(input, compileResult) {
  return cleanText(input.jobId)
    || cleanText(input.runtime?.jobId)
    || compileResult.jobs[0]?.id
    || null;
}

function buildDefaultRuntimeReceipt(job) {
  return {
    adapter: job?.adapter ?? "local",
    status: "accepted",
    receiptId: job ? `${job.id}:local-receipt` : "local-receipt",
    tenantId: job?.requestContract?.tenantId,
    workspaceId: job?.requestContract?.workspaceId,
    role: job?.accessPolicy?.defaultRole,
    permissions: job?.accessPolicy?.permissions,
    externalWrite: false,
  };
}

function buildDefaultCommandOutcomes(job) {
  return asArray(job?.persistedState?.commands).map((command) => ({
    id: command.id,
    idempotencyKey: command.idempotencyKey,
    status: command.status === "pending" || command.status === "queued" ? "succeeded" : command.status,
    replayed: command.status === "pending" || command.status === "queued",
    recoverable: command.replayable,
    message: command.status === "pending" || command.status === "queued"
      ? "Default local runtime replay completed from persisted command ledger."
      : null,
  }));
}

function buildDefaultRuntimeReceipts(job) {
  const receipts = new Set(["adapter-receipt"]);
  if (job?.accessPolicy?.audit?.required) receipts.add("audit-handoff");
  if (asArray(job?.persistedState?.commands).length > 0) receipts.add("command-ledger");
  if (job?.statusHandoff?.requiredRuntimeReceipts?.includes("truth-review")) receipts.add("truth-review");
  return [...receipts];
}

function summarizeRestartAudit(compileResult, runtimeResult) {
  const compileSummary = compileResult.restartAuditSummary ?? {};
  const scopeAudit = runtimeResult.scopeAudit ?? {};
  return {
    ready: Boolean(compileSummary.readyForRuntime) && Boolean(scopeAudit.ready),
    manifestId: scopeAudit.manifest?.manifestId ?? compileSummary.manifests?.[0]?.manifestId ?? null,
    restartDecision: scopeAudit.manifest?.restartDecision ?? compileSummary.manifests?.[0]?.restartDecision ?? null,
    replayJobCount: compileSummary.replayJobCount ?? 0,
    operatorReviewJobCount: compileSummary.operatorReviewJobCount ?? 0,
    openRequiredCheckpointCount: compileSummary.openRequiredCheckpointCount ?? 0,
    requiredRuntimeReceiptCount: compileSummary.requiredRuntimeReceiptCount ?? 0,
    missingRuntimeReceipts: scopeAudit.missingReceipts ?? [],
    missingRuntimePermissions: scopeAudit.missingPermissions ?? [],
    restartMatches: scopeAudit.restartMatches ?? true,
  };
}

function summarizePermissionBoundary(compileResult, runtimeResult) {
  const compileSummary = compileResult.permissionBoundarySummary ?? {};
  const runtimeBoundary = runtimeResult.permissionBoundary ?? {};
  const decisions = asArray(compileSummary.decisions);
  const blockingDecisions = decisions.filter((decision) => decision.state === "blocked");
  const reviewDecisions = decisions.filter((decision) => decision.state === "review");
  const runtimeDecision = runtimeBoundary.decision ?? {};
  const missingReceipts = asArray(runtimeBoundary.missingReceipts);
  const missingPermissions = asArray(runtimeBoundary.missingPermissions);

  return {
    ready: blockingDecisions.length === 0 && runtimeBoundary.accepted !== false,
    compileAllowedJobCount: compileSummary.allowedJobCount ?? 0,
    compileReviewJobCount: compileSummary.reviewJobCount ?? reviewDecisions.length,
    compileBlockedJobCount: compileSummary.blockedJobCount ?? blockingDecisions.length,
    runtimeAccepted: runtimeBoundary.accepted ?? true,
    runtimeDecisionState: cleanText(runtimeDecision.state) || "unavailable",
    runtimeDecisionReason: cleanText(runtimeDecision.reason) || "manifest-not-compiled",
    runtimeNextAction: cleanText(runtimeDecision.nextAction) || "operator-review",
    manifestId: runtimeBoundary.manifest?.manifestId ?? decisions[0]?.manifestId ?? null,
    tenantId: runtimeBoundary.manifest?.tenantId ?? null,
    workspaceId: runtimeBoundary.manifest?.workspaceId ?? null,
    roleAccepted: runtimeBoundary.roleAccepted ?? true,
    scopeAccepted: runtimeBoundary.scopeAccepted ?? true,
    externalWriteAccepted: runtimeBoundary.externalWriteAccepted ?? true,
    missingReceipts,
    missingPermissions,
    decisions,
  };
}

export function createAIOSLanguageContract(input = {}) {
  const compileResult = createCompileResult(input.compile ?? input);
  const jobId = selectJobId(input, compileResult);
  const compileJob = compileResult.jobs.find((job) => job.id === jobId) ?? compileResult.jobs[0] ?? null;
  const statusHandoff = compileResult.statusHandoffs.find((handoff) => handoff.jobId === compileJob?.id)
    ?? compileResult.statusHandoffs[0]
    ?? null;
  const runtimeInput = input.runtime && typeof input.runtime === "object" ? input.runtime : {};
  const runtimeResult = createRuntimeResult({
    compileResult,
    jobId,
    statusHandoff,
    adapterReceipt: runtimeInput.adapterReceipt ?? runtimeInput.receipt ?? buildDefaultRuntimeReceipt(compileJob),
    runtimeScope: runtimeInput.runtimeScope ?? runtimeInput.scope,
    commandOutcomes: runtimeInput.commandOutcomes ?? runtimeInput.commands ?? buildDefaultCommandOutcomes(compileJob),
    runtimeReceipts: runtimeInput.runtimeReceipts ?? runtimeInput.receipts ?? buildDefaultRuntimeReceipts(compileJob),
    events: runtimeInput.events,
    errors: runtimeInput.errors,
    rollback: runtimeInput.rollback,
    outputs: runtimeInput.outputs,
  });
  const truthHandoff = createTruthBoundaryHandoff(compileResult.truthBoundary, {
    id: compileResult.sourceHash || "aios-language-contract",
    reviewer: statusHandoff?.auditTarget || "runtime",
  });
  const diagnostics = [
    ...asArray(compileResult.diagnostics),
    ...runtimeResult.errors.map((error) => ({
      severity: error.recoverable ? "warning" : "error",
      code: error.code,
      message: error.message,
      path: "$.runtime",
    })),
  ];

  return {
    contractKind: "aios.language.contract.v1",
    ok: compileResult.ok && runtimeResult.ok && truthHandoff.exportReady,
    compile: compileResult,
    runtime: runtimeResult,
    truthHandoff,
    statusHandoff,
    diagnostics,
    summary: {
      compileStatus: compileResult.status,
      runtimeStatus: runtimeResult.status,
      truthStatus: compileResult.truthSummary.status,
      healthStatus: runtimeResult.operationalHealthSummary.status,
      jobCount: compileResult.jobs.length,
      capabilityCount: compileResult.capabilityManifest.length,
      handoffId: runtimeResult.statusHandoffReceipt.handoffId,
      recoveryStatus: runtimeResult.recoveryStatus,
      exportReady: runtimeResult.exportSummary.readyForExport && truthHandoff.exportReady,
      restartAudit: summarizeRestartAudit(compileResult, runtimeResult),
      permissionBoundary: summarizePermissionBoundary(compileResult, runtimeResult),
    },
  };
}

export function selfCheckAIOSLanguageSurface() {
  const contract = createAIOSLanguageContract({
    sourceHash: "self-check",
    jobs: [{
      id: "self-check-job",
      name: "self-check",
      adapter: "local",
      action: "inspect",
      capabilities: ["kernel.inspect"],
      verifierContracts: ["self check completed"],
      request: {
        workflow: "self-check",
        clientRequestId: "self-check-request",
        tenantId: "local",
        workspaceId: "default",
      },
      accessPolicy: {
        roles: ["runtime-adapter"],
        permissions: ["kernel.inspect"],
      },
      persistedState: {
        commands: [{
          id: "self-check-command",
          name: "runtime.inspect",
          idempotencyKey: "self-check-command",
          status: "succeeded",
        }],
      },
      truthBoundary: {
        claims: [{
          text: "AI OS language surface can compile and consume a local runtime handoff.",
          level: "observed",
          verified: true,
        }],
      },
      operationalHealth: {
        checks: [{ name: "surface import", ok: true }],
      },
    }],
  });

  return {
    ok: contract.ok,
    contractKind: contract.contractKind,
    compileStatus: contract.summary.compileStatus,
    runtimeStatus: contract.summary.runtimeStatus,
    truthStatus: contract.summary.truthStatus,
    handoffId: contract.summary.handoffId,
    restartAuditReady: contract.summary.restartAudit.ready,
    permissionBoundaryReady: contract.summary.permissionBoundary.ready,
    permissionBoundaryDecision: contract.summary.permissionBoundary.runtimeDecisionState,
    diagnosticCount: contract.diagnostics.length,
  };
}
