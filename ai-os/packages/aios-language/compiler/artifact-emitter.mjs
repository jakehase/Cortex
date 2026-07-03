import { compileMailchimpJobDescriptor } from "./job-descriptor-compiler.mjs";
import { emitMailchimpDiagnostics } from "./diagnostic-emitter.mjs";
import { emitMailchimpMetadata } from "./metadata-emitter.mjs";

function compileIfNeeded(source, options) {
  if (source?.kind === "aios.kernelJobDescriptor") return source;
  return compileMailchimpJobDescriptor(source, options);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function stableArtifactId(jobId, name, payload) {
  const text = stableStringify({ jobId, name, payload });
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `artifact_mailchimp_${name.replace(/[^a-zA-Z0-9]/g, "_")}_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function byteSize(payload) {
  return JSON.stringify(payload).length;
}

function artifactRecord(jobId, name, mediaType, payload, options = {}) {
  const artifactId = stableArtifactId(jobId, name, payload);
  return {
    id: artifactId,
    name,
    mediaType,
    role: options.role || "runtime-contract",
    writeMode: "in-memory",
    externalWrite: false,
    sizeBytes: byteSize(payload),
    contentHash: artifactId.split("_").at(-1),
    payload,
    handoff: {
      target: options.target || "aios-runtime",
      required: options.required !== false,
      recoveryAction: options.recoveryAction || "regenerate-artifact",
      idempotencyKey: `${jobId}:${name}:${artifactId}`
    },
    truthBoundary: {
      source: "artifact-emitter",
      deterministic: true,
      externalMailchimpStateVerified: false
    }
  };
}

function summarizeArtifacts(artifacts, diagnostics) {
  const required = artifacts.filter((artifact) => artifact.handoff.required);
  const diagnosticCounts = diagnostics.counts || { bySeverity: {} };
  const restartSafeArtifacts = artifacts.filter((artifact) => artifact.payload?.restartSemantics?.replaySafe === true);
  const permissionBoundary = diagnostics.permissionBoundary || {};
  const permissionBoundaryArtifact = artifacts.find((artifact) => artifact.name === "permission-boundary.json");
  const lifecycleArtifact = artifacts.find((artifact) => artifact.name === "lifecycle-controls.json");
  const lifecycleOperatorControlsArtifact = artifacts.find((artifact) => artifact.name === "lifecycle-operator-controls.json");
  const providerServiceArtifact = artifacts.find((artifact) => artifact.name === "provider-service-handoff.json");
  const providerReleaseReadinessArtifact = artifacts.find((artifact) => artifact.name === "provider-release-readiness.json");
  const runtimeReleaseDecisionArtifact = artifacts.find((artifact) => artifact.name === "runtime-release-decision.json");
  const statusRecoveryBundleArtifact = artifacts.find((artifact) => artifact.name === "status-recovery-bundle.json");
  const dryRunAnalyticsExportArtifact = artifacts.find((artifact) => artifact.name === "dry-run-analytics-export.json");
  const previewAcceptanceArtifact = artifacts.find((artifact) => artifact.name === "preview-acceptance.json");
  const clientWorkflowArtifact = artifacts.find((artifact) => artifact.name === "client-workflow.json");
  const clientRuntimeAdoptionArtifact = artifacts.find((artifact) => artifact.name === "client-runtime-adoption.json");
  const clientCommandLeasesArtifact = artifacts.find((artifact) => artifact.name === "client-command-leases.json");
  const clientCommandLeaseReplayArtifact = artifacts.find((artifact) => artifact.name === "client-command-lease-replay.json");
  const commandLeaseReplayExportArtifact = artifacts.find((artifact) => artifact.name === "command-lease-replay-export.json");
  const tenantAuditHandoffArtifact = artifacts.find((artifact) => artifact.name === "tenant-audit-handoff.json");
  const tenantBoundaryMatrixArtifact = artifacts.find((artifact) => artifact.name === "tenant-boundary-matrix.json");
  const operationalRunbookArtifact = artifacts.find((artifact) => artifact.name === "operational-runbook.json");
  const lifecycleControls = lifecycleArtifact?.payload || diagnostics.lifecycleControls || {};
  const lifecycleOperatorControls = lifecycleOperatorControlsArtifact?.payload
    || lifecycleControls.operatorControls
    || diagnostics.lifecycleOperatorControls
    || {};
  const providerService = providerServiceArtifact?.payload || diagnostics.providerServiceContract || {};
  const providerReleaseReadiness = providerReleaseReadinessArtifact?.payload || diagnostics.providerReleaseReadiness || {};
  const runtimeReleaseDecision = runtimeReleaseDecisionArtifact?.payload || diagnostics.runtimeReleaseDecision || {};
  const statusRecoveryBundle = statusRecoveryBundleArtifact?.payload || diagnostics.statusRecoveryBundle || {};
  const clientWorkflow = clientWorkflowArtifact?.payload || diagnostics.clientWorkflow || {};
  const clientRuntimeAdoption = clientRuntimeAdoptionArtifact?.payload || diagnostics.clientRuntimeAdoption || {};
  const clientCommandLeases = clientCommandLeasesArtifact?.payload || diagnostics.clientCommandLeases || {};
  const clientCommandLeaseReplay = clientCommandLeaseReplayArtifact?.payload || diagnostics.clientCommandLeaseReplay || {};
  const commandLeaseReplayExport = commandLeaseReplayExportArtifact?.payload || diagnostics.commandLeaseReplayExport || {};
  const tenantAuditHandoff = tenantAuditHandoffArtifact?.payload || diagnostics.tenantAuditHandoff || {};
  const tenantBoundaryMatrix = tenantBoundaryMatrixArtifact?.payload || diagnostics.tenantBoundaryMatrix || {};
  const operationalRunbook = operationalRunbookArtifact?.payload || {};
  return {
    count: artifacts.length,
    requiredCount: required.length,
    totalBytes: artifacts.reduce((sum, artifact) => sum + artifact.sizeBytes, 0),
    names: artifacts.map((artifact) => artifact.name),
    restartSafeArtifactCount: restartSafeArtifacts.length,
    permissionBoundaryReady: permissionBoundary.safeBoundary === true
      && Boolean(permissionBoundaryArtifact?.payload?.isolationKey),
    permissionBoundaryStatus: permissionBoundary.status || "unknown",
    tenantIsolationKey: permissionBoundary.isolationKey || null,
    lifecycleControlsReady: lifecycleControls.schemaVersion === "aios.mailchimp.lifecycle-controls-artifact.v1"
      && Boolean(lifecycleControls.nextAction),
    lifecycleOperatorControlsReady: lifecycleOperatorControls.schemaVersion === "aios.mailchimp.lifecycle-operator-controls-artifact.v1"
      && Boolean(lifecycleOperatorControls.stateKey)
      && Boolean(lifecycleOperatorControls.nextAction),
    lifecycleOperatorControlsStatus: lifecycleOperatorControls.status || "unknown",
    lifecycleOperatorControlsNextAction: lifecycleOperatorControls.nextAction || null,
    lifecycleOperatorControlsStateKey: lifecycleOperatorControls.stateKey || null,
    lifecycleRuntimeStartBlocked: lifecycleOperatorControls.runtimeStart?.enabled === false,
    lifecycleOperatorHoldActive: lifecycleOperatorControls.operatorHold?.active === true
      && !lifecycleOperatorControls.operatorHold?.releasedAt,
    lifecycleDisabledRequiredActions: lifecycleOperatorControls.capabilityControls?.disabledRequiredActions || [],
    providerServiceReady: providerService.schemaVersion === "aios.mailchimp.provider-service-handoff.v1"
      && providerService.externalHandoff?.ready === true,
    clientWorkflowReady: clientWorkflow.schemaVersion === "aios.mailchimp.client-workflow-artifact.v1"
      && Boolean(clientWorkflow.explainNextStep?.action),
    clientRuntimeAdoptionReady: clientRuntimeAdoption.schemaVersion === "aios.mailchimp.client-runtime-adoption-artifact.v1"
      && Boolean(clientRuntimeAdoption.adoptionId)
      && clientRuntimeAdoption.restartSemantics?.externalWritesPerformed === false,
    clientRuntimeAdoptionStatus: clientRuntimeAdoption.status || "unknown",
    clientRuntimeReady: clientRuntimeAdoption.readyForClientRuntime === true,
    clientRuntimeAdoptionNextAction: clientRuntimeAdoption.nextAction || null,
    clientRuntimeMissingStateKeys: clientRuntimeAdoption.missingStateKeys || [],
    clientRuntimePendingAckKeys: clientRuntimeAdoption.commandAck?.pendingKeys || [],
    previewAcceptanceReceiptReady: previewAcceptanceArtifact?.payload?.acceptanceReceipt?.schemaVersion === "aios.mailchimp.preview-acceptance-receipt.v1"
      && Boolean(previewAcceptanceArtifact.payload.acceptanceReceipt.acceptanceToken)
      && previewAcceptanceArtifact.payload.acceptanceReceipt.restartSemantics?.externalWritesPerformed === false,
    previewAcceptanceReceiptStatus: previewAcceptanceArtifact?.payload?.acceptanceReceipt?.status || "unknown",
    previewAcceptanceReceiptNextAction: previewAcceptanceArtifact?.payload?.acceptanceReceipt?.nextAction || null,
    previewAcceptanceReceiptToken: previewAcceptanceArtifact?.payload?.acceptanceReceipt?.acceptanceToken || null,
    clientCommandLeasesReady: clientCommandLeases.schemaVersion === "aios.mailchimp.client-command-leases-artifact.v1"
      && Boolean(clientCommandLeases.resumeToken)
      && Array.isArray(clientCommandLeases.leases),
    clientCommandLeaseStatus: clientCommandLeases.leaseStatus || "unknown",
    clientCommandAckRequired: clientCommandLeases.ack?.required === true || clientCommandLeases.ackRequired === true,
    clientCommandLeaseCount: clientCommandLeases.leases?.length || 0,
    clientCommandLeaseReplayReady: clientCommandLeaseReplay.schemaVersion === "aios.mailchimp.client-command-lease-replay-artifact.v1"
      && clientCommandLeaseReplay.replay?.safe !== false
      && Boolean(clientCommandLeaseReplay.resumeToken),
    clientCommandLeaseReplayStatus: clientCommandLeaseReplay.status || "unknown",
    clientCommandLeaseReplayBlockingCount: clientCommandLeaseReplay.counts?.blocking || 0,
    clientCommandLeaseReplayAckCount: clientCommandLeaseReplay.ack?.requiredCount || 0,
    commandLeaseReplayExportReady: commandLeaseReplayExport.schemaVersion === "aios.mailchimp.command-lease-replay-export-artifact.v1"
      && commandLeaseReplayExport.exportReady === true
      && Boolean(commandLeaseReplayExport.resumeToken),
    commandLeaseReplayExportStatus: commandLeaseReplayExport.status || "unknown",
    commandLeaseReplayExportNextAction: commandLeaseReplayExport.nextAction || null,
    commandLeaseReplayExportBlockingCount: commandLeaseReplayExport.counters?.blocking || 0,
    commandLeaseReplayExportAckRequired: commandLeaseReplayExport.ack?.required === true,
    commandLeaseReplayExportResumeToken: commandLeaseReplayExport.resumeToken || null,
    tenantAuditHandoffReady: tenantAuditHandoff.schemaVersion === "aios.mailchimp.tenant-audit-handoff-artifact.v1"
      && tenantAuditHandoff.safeBoundary === true
      && Boolean(tenantAuditHandoff.isolationKey),
    tenantAuditHandoffStatus: tenantAuditHandoff.status || "unknown",
    tenantBoundaryMatrixReady: tenantBoundaryMatrix.schemaVersion === "aios.mailchimp.tenant-boundary-matrix-artifact.v1"
      && tenantBoundaryMatrix.exportReady === true
      && Boolean(tenantBoundaryMatrix.isolationKey),
    tenantBoundaryMatrixStatus: tenantBoundaryMatrix.status || "unknown",
    tenantBoundaryMatrixNextAction: tenantBoundaryMatrix.audit?.nextAction || null,
    tenantBoundaryMatrixBlockedJobs: tenantBoundaryMatrix.exportSummary?.blockedJobIds || [],
    tenantBoundaryMatrixApprovalJobs: tenantBoundaryMatrix.exportSummary?.approvalJobIds || [],
    tenantBoundaryMatrixMissingScopes: tenantBoundaryMatrix.exportSummary?.missingScopes || [],
    tenantBoundaryMatrixHistorySnapshots: tenantBoundaryMatrix.historySnapshots?.length || 0,
    tenantBoundaryMatrixTimelineEvents: tenantBoundaryMatrix.analytics?.timelineEvents || 0,
    operationalRunbookReady: operationalRunbook.schemaVersion === "aios.mailchimp.operational-runbook-artifact.v1"
      && Boolean(operationalRunbook.nextAction)
      && Array.isArray(operationalRunbook.steps),
    operationalRunbookState: operationalRunbook.state || "unknown",
    operationalRunbookOwner: operationalRunbook.owner || "unknown",
    operationalRunbookNextAction: operationalRunbook.nextAction || null,
    operationalRunbookBlockers: operationalRunbook.counters?.blockers || 0,
    operationalRunbookWarnings: operationalRunbook.counters?.warnings || 0,
    operationalRunbookRetryable: operationalRunbook.retry?.retryable === true,
    operationalRunbookNextBackoffMs: operationalRunbook.retry?.nextBackoffMs || 0,
    tenantAuditBlockedJobs: tenantAuditHandoff.permissions?.blockedJobIds?.length || 0,
    tenantAuditApprovalJobs: tenantAuditHandoff.permissions?.approvalJobIds?.length || 0,
    tenantAuditMissingScopes: tenantAuditHandoff.permissions?.missing?.length || 0,
    clientWorkflowStatus: clientWorkflow.status || "unknown",
    clientWorkflowAction: clientWorkflow.explainNextStep?.action || clientWorkflow.primaryAction || null,
    providerServiceStatus: providerService.status || "unknown",
    providerService: providerService.providerService || null,
    providerSyncHandoffReady: providerService.syncMetadata?.syncHandoffReady === true,
    unnegotiatedProviderCapabilities: providerService.capabilityNegotiation?.unnegotiated || [],
    providerReleaseReadinessReady: providerReleaseReadiness.schemaVersion === "aios.mailchimp.provider-release-readiness-artifact.v1"
      && providerReleaseReadiness.ready === true
      && Boolean(providerReleaseReadiness.nextAction),
    providerReleaseReadinessStatus: providerReleaseReadiness.status || "unknown",
    providerReleaseReadinessNextAction: providerReleaseReadiness.nextAction || null,
    providerReleaseReadinessBlockedJobs: providerReleaseReadiness.validationSummary?.blockedJobIds || [],
    providerReleaseReadinessMissingCapabilities: providerReleaseReadiness.capabilityNegotiation?.missing || [],
    runtimeReleaseDecisionReady: runtimeReleaseDecision.schemaVersion === "aios.mailchimp.runtime-release-decision-artifact.v1"
      && Boolean(runtimeReleaseDecision.releaseToken)
      && Boolean(runtimeReleaseDecision.nextAction)
      && runtimeReleaseDecision.restartSemantics?.externalWritesPerformed === false,
    runtimeReleaseState: runtimeReleaseDecision.state || "unknown",
    runtimeReleaseNextAction: runtimeReleaseDecision.nextAction || null,
    runtimeReleaseToken: runtimeReleaseDecision.releaseToken || null,
    runtimeReleaseBlockedGateIds: runtimeReleaseDecision.clientPatch?.runtimeReleaseBlockedGateIds || [],
    runtimeReleaseWaitingGateIds: runtimeReleaseDecision.clientPatch?.runtimeReleaseWaitingGateIds || [],
    statusRecoveryBundleReady: statusRecoveryBundle.schemaVersion === "aios.mailchimp.status-recovery-bundle-artifact.v1"
      && Boolean(statusRecoveryBundle.resume?.resumeToken)
      && Boolean(statusRecoveryBundle.nextAction)
      && Array.isArray(statusRecoveryBundle.checkpoints)
      && statusRecoveryBundle.restartSemantics?.externalWritesPerformed === false,
    statusRecoveryState: statusRecoveryBundle.state || "unknown",
    statusRecoveryNextAction: statusRecoveryBundle.nextAction || null,
    statusRecoveryResumeToken: statusRecoveryBundle.resume?.resumeToken || null,
    statusRecoveryBlockedCheckpoints: statusRecoveryBundle.blocking?.missingRequiredCheckpoints || [],
    statusRecoveryReadyForRuntimeResume: statusRecoveryBundle.readyForRuntimeResume === true,
    dryRunAnalyticsExportReady: dryRunAnalyticsExportArtifact?.payload?.schemaVersion === "aios.mailchimp.dry-run-analytics-export-artifact.v1"
      && dryRunAnalyticsExportArtifact.payload.exportReady === true
      && Boolean(dryRunAnalyticsExportArtifact.payload.nextAction),
    dryRunAnalyticsExportStatus: dryRunAnalyticsExportArtifact?.payload?.status || "unknown",
    dryRunAnalyticsExportNextAction: dryRunAnalyticsExportArtifact?.payload?.nextAction || null,
    dryRunAnalyticsExportHistorySnapshots: dryRunAnalyticsExportArtifact?.payload?.counters?.historySnapshots || 0,
    dryRunAnalyticsExportTimelineEvents: dryRunAnalyticsExportArtifact?.payload?.counters?.timelineEvents || 0,
    dryRunAnalyticsExportBlockers: dryRunAnalyticsExportArtifact?.payload?.exportSummary?.blockerCodes || [],
    dryRunAnalyticsExportWarnings: dryRunAnalyticsExportArtifact?.payload?.exportSummary?.warningCodes || [],
    lifecycleStatus: lifecycleControls.status || "unknown",
    runtimeStartEnabled: lifecycleControls.runtimeStart?.enabled === true,
    schedulePaused: lifecycleControls.schedule?.paused === true,
    failureStateMode: diagnostics.failureState?.mode || "unknown",
    retryableFailureCount: diagnostics.failureState?.summary?.retryable || 0,
    nextRetryBackoffMs: diagnostics.failureState?.nextRetry?.backoffMs || 0,
    statusRevision: diagnostics.statusLedger?.statusRevision || null,
    blocked: (diagnosticCounts.bySeverity?.error || 0) > 0,
    nextAction: (diagnosticCounts.bySeverity?.error || 0) > 0
      ? diagnostics.recovery?.nextAction || "repair-before-artifact-handoff"
      : "publish-in-memory-artifacts"
  };
}

function buildOperationalRunbookArtifact(metadata, diagnostics, assembled = {}) {
  const failureState = diagnostics.failureState || {};
  const lifecycle = assembled.lifecycleControls || diagnostics.lifecycleControls || {};
  const providerService = assembled.providerServiceHandoff || diagnostics.providerServiceContract || {};
  const tenantAudit = assembled.tenantAuditHandoff || diagnostics.tenantAuditHandoff || {};
  const clientWorkflow = assembled.clientWorkflow || diagnostics.clientWorkflow || {};
  const clientCommandLeases = assembled.clientCommandLeases || diagnostics.clientCommandLeases || {};
  const clientCommandLeaseReplay = assembled.clientCommandLeaseReplay || diagnostics.clientCommandLeaseReplay || {};
  const health = metadata.health || {};
  const diagnosticErrors = diagnostics.counts?.bySeverity?.error || 0;
  const diagnosticWarnings = diagnostics.counts?.bySeverity?.warning || 0;
  const failureQueue = Array.isArray(failureState.queue) ? failureState.queue : [];
  const retryableFailures = failureState.summary?.retryable || failureQueue.filter((item) => item.retryable).length;
  const blockingFailures = failureState.summary?.blocking || failureQueue.filter((item) => item.blocksRuntimeStart).length;
  const providerBlocked = providerService.externalHandoff?.ready === false
    || providerService.status === "blocked"
    || providerService.status === "unhealthy";
  const tenantBlocked = tenantAudit.safeBoundary === false || tenantAudit.status === "blocked";
  const lifecycleBlocked = lifecycle.runtimeStartEnabled === false
    || lifecycle.status === "blocked"
    || lifecycle.summary?.blockedControls > 0;
  const commandLeaseBlocked = clientCommandLeaseReplay.counts?.blocking > 0
    || clientCommandLeases.counts?.blocking > 0;
  const workflowBlocked = clientWorkflow.status === "blocked"
    || clientWorkflow.validationSummary?.blocked > 0;
  const degraded = health.degradedMode === true
    || failureState.adapterHandoff?.degradedMode === true
    || retryableFailures > 0
    || diagnosticWarnings > 0;
  const state = diagnosticErrors > 0
    || blockingFailures > 0
    || providerBlocked
    || tenantBlocked
    || lifecycleBlocked
    || commandLeaseBlocked
    || workflowBlocked
    ? "blocked"
    : degraded
      ? "degraded"
      : "ready";
  const owner = tenantBlocked || lifecycleBlocked || workflowBlocked
    ? "operator"
    : providerBlocked || retryableFailures > 0
      ? "adapter"
      : diagnosticErrors > 0
        ? "runtime"
        : "runtime";
  const steps = [
    {
      id: "diagnostics",
      state: diagnosticErrors > 0 ? "blocked" : diagnosticWarnings > 0 ? "degraded" : "ready",
      owner: diagnosticErrors > 0 ? "runtime" : "operator",
      action: diagnosticErrors > 0
        ? diagnostics.recovery?.nextAction || "repair-diagnostics-before-handoff"
        : diagnosticWarnings > 0
          ? "review-diagnostic-warnings"
          : "publish-diagnostics",
      reason: diagnosticErrors > 0
        ? "diagnostics contain blocking errors"
        : diagnosticWarnings > 0
          ? "diagnostics contain warnings"
          : "diagnostics are ready",
      artifactNames: ["diagnostics.json"],
      retryable: false,
    },
    {
      id: "failure-state",
      state: blockingFailures > 0
        ? "blocked"
        : retryableFailures > 0
          ? "retryable"
          : "ready",
      owner: retryableFailures > 0 ? "adapter" : "runtime",
      action: failureState.adapterHandoff?.nextAction
        || failureState.nextRetry?.nextAction
        || diagnostics.recovery?.nextAction
        || "handoff-to-runtime-adapter",
      reason: blockingFailures > 0
        ? "failure queue contains runtime blockers"
        : retryableFailures > 0
          ? "failure queue can retry after deterministic backoff"
          : "failure queue is empty or non-blocking",
      artifactNames: ["failure-state.json", "command-journal.json", "status-snapshot.json"],
      retryable: retryableFailures > 0 && blockingFailures === 0,
    },
    {
      id: "provider-service",
      state: providerBlocked
        ? "blocked"
        : providerService.status === "review"
          ? "degraded"
          : "ready",
      owner: "adapter",
      action: providerService.clientPatch?.nextAction
        || providerService.nextAction
        || "repair-provider-service-handoff",
      reason: providerBlocked
        ? "provider service handoff is not ready for external adapter release"
        : "provider service handoff can be persisted",
      artifactNames: ["provider-service-handoff.json"],
      retryable: providerService.syncMetadata?.syncHandoffReady === false
        || providerService.externalHandoff?.ready === false,
    },
    {
      id: "tenant-audit",
      state: tenantBlocked
        ? "blocked"
        : tenantAudit.status === "needs-approval"
          ? "waiting"
          : "ready",
      owner: "operator",
      action: tenantAudit.handoff?.nextAction || "append-audit-before-runtime-release",
      reason: tenantBlocked
        ? "tenant audit handoff blocks release"
        : tenantAudit.status === "needs-approval"
          ? "tenant audit handoff is waiting for approval"
          : "tenant audit handoff is ready",
      artifactNames: ["tenant-audit-handoff.json", "permission-boundary.json"],
      retryable: false,
    },
    {
      id: "lifecycle-controls",
      state: lifecycleBlocked
        ? "blocked"
        : lifecycle.status === "waiting" || lifecycle.schedule?.paused === true
          ? "waiting"
          : "ready",
      owner: "operator",
      action: lifecycle.nextAction || "refresh-lifecycle-controls",
      reason: lifecycleBlocked
        ? "lifecycle controls disable runtime start"
        : lifecycle.schedule?.paused === true
          ? "lifecycle schedule is paused"
          : "lifecycle controls are exportable",
      artifactNames: ["lifecycle-controls.json"],
      retryable: lifecycle.schedule?.paused === true,
    },
    {
      id: "client-workflow",
      state: workflowBlocked
        ? "blocked"
        : clientWorkflow.validationSummary?.pending > 0
          ? "waiting"
          : "ready",
      owner: "operator",
      action: clientWorkflow.explainNextStep?.action || clientWorkflow.primaryAction || "refresh-client-workflow",
      reason: workflowBlocked
        ? "client workflow validation blocks handoff"
        : clientWorkflow.validationSummary?.pending > 0
          ? "client workflow has pending validation"
          : "client workflow is ready",
      artifactNames: ["client-workflow.json", "preview-acceptance.json"],
      retryable: false,
    },
    {
      id: "client-command-leases",
      state: commandLeaseBlocked
        ? "blocked"
        : clientCommandLeaseReplay.ack?.required === true || clientCommandLeases.ack?.required === true
          ? "waiting"
          : "ready",
      owner: "operator",
      action: clientCommandLeaseReplay.primaryAction
        || clientCommandLeases.primaryAction
        || "refresh-client-command-leases",
      reason: commandLeaseBlocked
        ? "client command leases block runtime start"
        : clientCommandLeaseReplay.ack?.required === true || clientCommandLeases.ack?.required === true
          ? "client command lease acknowledgement is required"
          : "client command leases are replay-safe",
      artifactNames: ["client-command-leases.json", "client-command-lease-replay.json"],
      retryable: commandLeaseBlocked === false && clientCommandLeaseReplay.replay?.safe !== false,
    },
  ];
  const blockers = steps.filter((step) => step.state === "blocked");
  const warnings = steps.filter((step) => ["degraded", "waiting", "retryable"].includes(step.state));
  const nextStep = blockers[0] || warnings[0] || steps.at(-1);
  const nextRetryBackoffMs = (failureState.nextRetry?.backoffMs || health.retry?.backoffMs || 0)
    || (steps.some((step) => step.retryable) ? 0 : 0);

  return {
    schemaVersion: "aios.mailchimp.operational-runbook-artifact.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    status: diagnostics.status,
    state,
    owner,
    nextAction: nextStep?.action || diagnostics.recovery?.nextAction || "handoff-to-runtime-adapter",
    degradedMode: state === "degraded" || degraded,
    retry: {
      retryable: retryableFailures > 0 || steps.some((step) => step.retryable),
      retryableFailures,
      nextBackoffMs,
      policy: retryableFailures > 0 ? "bounded-adapter-retry" : "manual-or-not-needed"
    },
    counters: {
      blockers: blockers.length,
      warnings: warnings.length,
      steps: steps.length,
      diagnosticErrors,
      diagnosticWarnings,
      failureQueue: failureQueue.length,
      retryableFailures,
      blockingFailures,
      disabledLifecycleControls: lifecycle.summary?.disabledControls || 0,
      blockedCommandLeases: clientCommandLeaseReplay.counts?.blocking || clientCommandLeases.counts?.blocking || 0
    },
    steps,
    clientPatch: {
      operationalRunbookState: state,
      operationalRunbookOwner: owner,
      operationalRunbookNextAction: nextStep?.action || diagnostics.recovery?.nextAction || "handoff-to-runtime-adapter",
      operationalRunbookRetryable: retryableFailures > 0,
      operationalRunbookNextBackoffMs: nextRetryBackoffMs
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-operational-runbook-job-id",
      resumeFromJobId: metadata.jobId,
      externalWritesPerformed: false
    }
  };
}

function buildClientWorkflowArtifact(metadata, diagnostics) {
  const workflow = metadata.clientWorkflow || diagnostics.clientWorkflow || {};
  const validationItems = Array.isArray(workflow.validationItems) ? workflow.validationItems : [];
  const validationSummary = workflow.validationSummary || {};
  const tenant = workflow.tenant || {};
  const statePatch = workflow.statePatch || diagnostics.clientWorkflow?.statePatch || {};
  const explainNextStep = workflow.explainNextStep || diagnostics.clientWorkflow?.explainNextStep || {};

  return {
    schemaVersion: "aios.mailchimp.client-workflow-artifact.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    status: workflow.status || diagnostics.status,
    phase: workflow.phase || diagnostics.clientWorkflow?.phase || "preflight",
    severity: workflow.severity || diagnostics.clientWorkflow?.severity || "info",
    banner: workflow.banner || diagnostics.clientWorkflow?.banner || "Mailchimp setup is ready for preview.",
    primaryAction: workflow.primaryAction || explainNextStep.action || diagnostics.recovery?.nextAction,
    tenant: {
      tenantId: tenant.tenantId || diagnostics.permissionBoundary?.tenantId || "tenant.local",
      workspaceId: tenant.workspaceId || diagnostics.permissionBoundary?.workspaceId || "workspace.local",
      isolationKey: tenant.isolationKey || diagnostics.permissionBoundary?.isolationKey || null,
      safeBoundary: tenant.safeBoundary === true || diagnostics.permissionBoundary?.safeBoundary === true,
      missingRoles: tenant.missingRoles || diagnostics.permissionBoundary?.missingRoles || [],
      deniedScopes: tenant.deniedScopes || diagnostics.permissionBoundary?.deniedScopes || []
    },
    validationSummary: {
      total: validationSummary.total || validationItems.length,
      accepted: validationSummary.accepted || validationItems.filter((item) => item.status === "accepted").length,
      blocked: validationSummary.blocked || validationItems.filter((item) => item.status === "blocked").length,
      pending: validationSummary.pending || validationItems.filter((item) => item.status === "pending" || item.status === "needs-operator-action").length,
      required: validationSummary.required || validationItems.filter((item) => item.required).length,
      blockingDiagnostics: validationSummary.blockingDiagnostics || diagnostics.counts?.bySeverity?.error || 0,
      warningDiagnostics: validationSummary.warningDiagnostics || diagnostics.counts?.bySeverity?.warning || 0
    },
    validationItems: validationItems.map((item) => ({
      id: item.id,
      label: item.label,
      status: item.status,
      required: item.required === true,
      nextAction: item.nextAction,
      evidence: item.evidence || {}
    })),
    preview: workflow.preview || {
      readyForPreview: metadata.preview?.readyForPreview === true,
      readyForRuntimeStart: metadata.preview?.readyForRuntimeStart === true,
      acceptanceToken: metadata.preview?.acceptance?.acceptanceToken || null,
      acceptanceStatus: metadata.preview?.acceptance?.status || "unknown"
    },
    lifecycle: workflow.lifecycle || {
      status: metadata.lifecycle?.status || "unknown",
      runtimeStartEnabled: metadata.lifecycle?.runtimeStartEnabled === true,
      nextAction: metadata.lifecycle?.nextAction || diagnostics.recovery?.nextAction
    },
    explainNextStep: {
      action: explainNextStep.action || workflow.primaryAction || diagnostics.recovery?.nextAction || "handoff-to-runtime-adapter",
      reason: explainNextStep.reason || "workflow-ready",
      resumeToken: explainNextStep.resumeToken || diagnostics.statusLedger?.resumeToken || null,
      statusRevision: explainNextStep.statusRevision || diagnostics.statusLedger?.statusRevision || null,
      isolationKey: explainNextStep.isolationKey || tenant.isolationKey || diagnostics.permissionBoundary?.isolationKey || null
    },
    clientPatch: {
      ...statePatch,
      workflowStatus: workflow.status || diagnostics.status,
      workflowPhase: workflow.phase || diagnostics.clientWorkflow?.phase || "preflight",
      primaryAction: workflow.primaryAction || explainNextStep.action || diagnostics.recovery?.nextAction,
      validationBlocked: validationSummary.blocked || 0,
      validationPending: validationSummary.pending || 0
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-scoped-workflow-id",
      resumeFromWorkflowId: statePatch.scopedWorkflowId || statePatch.idempotencyKey || null,
      externalWritesPerformed: false
    }
  };
}

function buildClientRuntimeAdoptionArtifact(metadata, diagnostics) {
  const adoption = metadata.clientRuntimeAdoption
    || metadata.health?.clientRuntimeAdoption
    || diagnostics.clientRuntimeAdoption
    || {};
  const commandAck = adoption.commandAck || {};
  const resume = adoption.resume || {};
  const missingStateKeys = normalizeArtifactList(adoption.missingStateKeys);
  const pendingAckKeys = normalizeArtifactList(commandAck.pendingKeys);
  const status = adoption.status
    || (missingStateKeys.length > 0
      ? "blocked"
      : pendingAckKeys.length > 0
        ? "waiting-for-client"
        : "ready");
  const adoptionId = adoption.adoptionId
    || `${metadata.jobId}:client-runtime-adoption:${status}`.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const readyForClientRuntime = adoption.readyForClientRuntime === true
    && missingStateKeys.length === 0
    && pendingAckKeys.length === 0;
  const nextAction = adoption.nextAction
    || (missingStateKeys.length > 0
      ? "hydrate-mailchimp-client-runtime-state"
      : pendingAckKeys.length > 0
        ? "acknowledge-mailchimp-client-command"
        : "handoff-to-runtime-adapter");

  return {
    schemaVersion: "aios.mailchimp.client-runtime-adoption-artifact.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    adoptionId,
    status,
    readyForClientRuntime,
    nextAction,
    requiredClientState: normalizeArtifactList(adoption.requiredClientState),
    providedStateKeys: normalizeArtifactList(adoption.providedStateKeys),
    missingStateKeys,
    resume: {
      resumeToken: resume.resumeToken || diagnostics.statusLedger?.resumeToken || null,
      statusRevision: resume.statusRevision || diagnostics.statusLedger?.statusRevision || null,
      ready: resume.ready === true
    },
    commandAck: {
      required: commandAck.required === true,
      requiredKeys: normalizeArtifactList(commandAck.requiredKeys),
      acknowledgedKeys: normalizeArtifactList(commandAck.acknowledgedKeys),
      pendingKeys: pendingAckKeys,
      ready: commandAck.ready === true
    },
    validationSummary: adoption.validationSummary || {
      requiredStateKeys: normalizeArtifactList(adoption.requiredClientState).length,
      missingStateKeys: missingStateKeys.length,
      pendingAckKeys: pendingAckKeys.length,
      diagnosticIds: adoption.diagnosticIds || [],
      readyChecks: [
        adoption.previewAvailable !== false,
        missingStateKeys.length === 0,
        pendingAckKeys.length === 0,
        resume.ready === true
      ].filter(Boolean).length
    },
    clientPatch: {
      ...(adoption.clientPatch || {}),
      clientRuntimeAdoptionArtifact: "client-runtime-adoption.json",
      clientRuntimeAdoptionStatus: status,
      clientRuntimeReady: readyForClientRuntime,
      clientRuntimeAdoptionNextAction: nextAction,
      clientRuntimeAdoptionId: adoptionId
    },
    restartSemantics: {
      replaySafe: adoption.restartSemantics?.replaySafe !== false,
      duplicateCommandPolicy: adoption.restartSemantics?.duplicateCommandPolicy
        || "dedupe-by-client-runtime-adoption-id",
      resumeFromAdoptionId: adoption.restartSemantics?.resumeFromAdoptionId || adoptionId,
      externalWritesPerformed: false
    }
  };
}

function buildProviderServiceHandoffArtifact(metadata, diagnostics) {
  const providerSummary = metadata.providerService || {};
  const diagnosticContract = diagnostics.providerServiceContract || {};
  const syncMetadata = providerSummary.syncMetadata || diagnosticContract.syncMetadata || {};
  const capabilityNegotiation = providerSummary.capabilityNegotiation || diagnosticContract.capabilityNegotiation || {};
  const externalHandoff = providerSummary.externalHandoff || diagnosticContract.externalHandoff || {};
  const unnegotiated = Array.isArray(capabilityNegotiation.unnegotiated)
    ? capabilityNegotiation.unnegotiated
    : [];
  const syncMounts = Array.isArray(syncMetadata.providerSyncMounts)
    ? syncMetadata.providerSyncMounts
    : [];
  const status = providerSummary.status || diagnosticContract.status || "unknown";
  const handoffReady = externalHandoff.ready === true
    && status === "ready"
    && syncMetadata.syncHandoffReady !== false
    && unnegotiated.length === 0;

  return {
    schemaVersion: "aios.mailchimp.provider-service-handoff.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    status,
    providerService: providerSummary.providerService || diagnosticContract.providerService || "mailchimp-marketing-api",
    supported: providerSummary.supported === true || diagnosticContract.serviceSupported === true,
    diagnosticIds: providerSummary.diagnosticIds || diagnosticContract.diagnosticIds || [],
    syncMetadata: {
      syncRequired: syncMetadata.syncRequired === true,
      serviceScopes: syncMetadata.serviceScopes || [],
      declaredScopes: syncMetadata.declaredScopes || [],
      defaultScopesApplied: syncMetadata.defaultScopesApplied === true,
      providerSyncMounts: syncMounts,
      syncHandoffReady: syncMetadata.syncHandoffReady === true
    },
    capabilityNegotiation: {
      required: capabilityNegotiation.required || [],
      negotiated: capabilityNegotiation.negotiated || [],
      unnegotiated,
      writeActions: capabilityNegotiation.writeActions || [],
      approvalActions: capabilityNegotiation.approvalActions || [],
      complete: unnegotiated.length === 0
    },
    externalHandoff: {
      target: externalHandoff.target || providerSummary.providerService || "mailchimp-marketing-api",
      required: externalHandoff.required === true,
      ready: handoffReady,
      idempotencyKey: externalHandoff.idempotencyKey || `${metadata.jobId}:mailchimp-provider-service`
    },
    clientPatch: {
      providerServiceStatus: status,
      providerServiceReady: handoffReady,
      providerSyncReady: syncMetadata.syncHandoffReady === true,
      capabilityNegotiationReady: unnegotiated.length === 0,
      nextAction: providerSummary.clientState?.nextAction
        || diagnosticContract.nextAction
        || "handoff-to-runtime-adapter"
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-provider-service-handoff-key",
      resumeFromProviderHandoff: externalHandoff.idempotencyKey || null,
      externalWritesPerformed: false
    }
  };
}

function buildProviderReleaseReadinessArtifact(metadata, diagnostics, providerServiceHandoff) {
  const source = metadata.providerReleaseContract
    || metadata.dryRun?.providerReleaseContract
    || metadata.exports?.summary?.providerReleaseContract
    || diagnostics.providerReleaseReadiness
    || {};
  const validationSource = source.validationSummary || {};
  const gatesSource = source.releaseGates || {};
  const handoffSource = source.externalHandoff || providerServiceHandoff.externalHandoff || {};
  const syncSource = source.sync || providerServiceHandoff.syncMetadata || {};
  const capabilitySource = source.capabilityNegotiation || providerServiceHandoff.capabilityNegotiation || {};
  const missingCapabilities = normalizeArtifactList(
    capabilitySource.missing
      || capabilitySource.unnegotiated
      || providerServiceHandoff.capabilityNegotiation?.unnegotiated,
  );
  const blockedJobIds = normalizeArtifactList(validationSource.blockedJobIds);
  const waitingJobIds = normalizeArtifactList(validationSource.waitingJobIds);
  const healthErrorCodes = normalizeArtifactList(validationSource.healthErrorCodes);
  const syncReady = syncSource.ready === true
    || syncSource.syncHandoffReady === true
    || providerServiceHandoff.syncMetadata?.syncHandoffReady === true;
  const providerHealthy = gatesSource.providerHealthy === true
    || (providerServiceHandoff.status === "ready" && providerServiceHandoff.externalHandoff?.ready === true);
  const capabilitiesReady = gatesSource.capabilitiesReady === true
    || (missingCapabilities.length === 0 && providerServiceHandoff.capabilityNegotiation?.complete === true);
  const lifecycleReady = gatesSource.lifecycleReady !== false
    && diagnostics.lifecycleOperatorControls?.runtimeStart?.enabled !== false;
  const tenantReady = gatesSource.tenantReady !== false
    && diagnostics.tenantAuditHandoff?.safeBoundary !== false
    && diagnostics.permissionBoundary?.safeBoundary !== false;
  const blockers = [
    ...(providerHealthy ? [] : ["provider-health"]),
    ...(syncReady ? [] : ["provider-sync"]),
    ...(capabilitiesReady ? [] : ["capability-negotiation"]),
    ...(lifecycleReady ? [] : ["lifecycle-release-gate"]),
    ...(tenantReady ? [] : ["tenant-audit-boundary"]),
    ...blockedJobIds.map((jobId) => `job:${jobId}`),
  ];
  const status = source.state
    || source.status
    || (blockers.length > 0
      ? "blocked"
      : waitingJobIds.length > 0
        ? "waiting"
        : "ready");
  const nextAction = source.nextAction
    || (blockers.includes("provider-health")
      ? providerServiceHandoff.clientPatch?.nextAction || "repair-provider-service-handoff"
      : blockers.includes("provider-sync")
        ? "refresh-provider-sync-before-release"
        : blockers.includes("capability-negotiation")
          ? "negotiate-provider-capabilities"
          : blockers.includes("lifecycle-release-gate")
            ? diagnostics.lifecycleOperatorControls?.nextAction || "repair-lifecycle-settings"
            : blockers.includes("tenant-audit-boundary")
              ? diagnostics.tenantAuditHandoff?.handoff?.nextAction || "resolve-tenant-permission-boundary"
              : waitingJobIds.length > 0
                ? "collect-approval-before-provider-release"
                : "release-provider-handoff");
  const ready = source.ready === true || (status === "ready" && blockers.length === 0);
  const releaseContractId = source.id
    || source.clientPatch?.providerReleaseContractId
    || `${metadata.jobId}:provider-release-readiness`;

  return {
    schemaVersion: "aios.mailchimp.provider-release-readiness-artifact.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    releaseContractId,
    status,
    ready,
    nextAction,
    service: source.service || providerServiceHandoff.providerService || "mailchimp-marketing-api",
    externalHandoff: {
      state: handoffSource.state || (providerServiceHandoff.externalHandoff?.ready === true ? "ready" : "blocked"),
      handoffId: handoffSource.handoffId || providerServiceHandoff.externalHandoff?.idempotencyKey || null,
      releaseCommandId: handoffSource.releaseCommandId || null,
      idempotencyKey: providerServiceHandoff.externalHandoff?.idempotencyKey || handoffSource.idempotencyKey || releaseContractId,
      adapterStatusResumeCursors: normalizeArtifactList(handoffSource.adapterStatusResumeCursors),
      checkpointKeys: normalizeArtifactList(handoffSource.checkpointKeys),
      dryRunOnly: handoffSource.dryRunOnly !== false,
      externalWritesPerformed: false
    },
    sync: {
      ready: syncReady,
      contractId: syncSource.contractId || null,
      cursor: syncSource.cursor || null,
      mode: syncSource.mode || "push",
      handoffMode: syncSource.handoffMode || "adapter",
      requiredFacts: normalizeArtifactList(syncSource.requiredFacts),
      requiredProviderCapabilities: normalizeArtifactList(syncSource.requiredProviderCapabilities || capabilitySource.required)
    },
    capabilityNegotiation: {
      decision: capabilitySource.decision || (capabilitiesReady ? "ready" : "missing-capabilities"),
      ready: capabilitiesReady,
      requested: normalizeArtifactList(capabilitySource.requested || capabilitySource.required),
      missing: missingCapabilities,
      rows: Array.isArray(capabilitySource.rows)
        ? capabilitySource.rows.map((row) => ({
          capability: row.capability,
          negotiated: row.negotiated === true,
          source: row.source || "provider"
        }))
        : normalizeArtifactList(capabilitySource.required).map((capability) => ({
          capability,
          negotiated: !missingCapabilities.includes(capability),
          source: "provider"
        }))
    },
    releaseGates: {
      providerHealthy,
      syncReady,
      capabilitiesReady,
      lifecycleReady,
      tenantReady,
      lifecycleGateId: gatesSource.lifecycleGateId || null,
      lifecycleGateState: gatesSource.lifecycleGateState || diagnostics.lifecycleOperatorControls?.status || "unknown",
      tenantIsolationKey: gatesSource.tenantIsolationKey || diagnostics.tenantAuditHandoff?.isolationKey || diagnostics.permissionBoundary?.isolationKey || null
    },
    validationSummary: {
      blocked: validationSource.blocked || blockers.length,
      warnings: validationSource.warnings || waitingJobIds.length,
      blockers,
      blockedJobIds,
      waitingJobIds,
      healthErrorCodes,
      healthWarningCodes: normalizeArtifactList(validationSource.healthWarningCodes),
      missingCapabilities
    },
    clientPatch: {
      ...(source.clientPatch || {}),
      providerReleaseContractArtifact: "provider-release-readiness.json",
      providerReleaseContractId: releaseContractId,
      providerReleaseState: status,
      providerReleaseReady: ready,
      providerReleaseNextAction: nextAction,
      providerReleaseMissingCapabilities: missingCapabilities,
      providerReleaseBlockedJobIds: blockedJobIds,
      providerReleaseWaitingJobIds: waitingJobIds
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-provider-release-contract-id",
      resumeFromProviderReleaseContract: releaseContractId,
      externalWritesPerformed: false
    }
  };
}

function buildRuntimeReleaseDecisionArtifact(metadata, diagnostics, assembled = {}) {
  const source = metadata.runtimeReleaseDecision
    || metadata.dryRun?.runtimeReleaseDecision
    || metadata.exports?.summary?.runtimeReleaseDecision
    || diagnostics.runtimeReleaseDecision
    || {};
  const providerRelease = assembled.providerReleaseReadiness
    || diagnostics.providerReleaseReadiness
    || {};
  const lifecycleControls = assembled.lifecycleOperatorControls
    || diagnostics.lifecycleOperatorControls
    || {};
  const tenantAudit = assembled.tenantAuditHandoff
    || diagnostics.tenantAuditHandoff
    || {};
  const previewAcceptance = assembled.previewAcceptance
    || {};
  const commandLeaseReplay = assembled.commandLeaseReplayExport
    || diagnostics.commandLeaseReplayExport
    || {};
  const blockedGateIds = normalizeArtifactList(
    source.clientPatch?.runtimeReleaseBlockedGateIds
      || source.blockedGateIds
      || source.blockers,
  );
  const waitingGateIds = normalizeArtifactList(
    source.clientPatch?.runtimeReleaseWaitingGateIds
      || source.waitingGateIds
      || source.waitingOn,
  );
  const gates = source.gates || {};
  const releaseRows = Array.isArray(source.rows)
    ? source.rows
    : [
      {
        id: "lifecycle-runtime-start",
        state: gates.lifecycleRuntimeStartEnabled === true || lifecycleControls.runtimeStart?.enabled === true ? "ready" : "blocked",
        owner: "operator",
        nextAction: lifecycleControls.nextAction || "repair-lifecycle-settings",
      },
      {
        id: "provider-release-readiness",
        state: gates.providerReady === true || providerRelease.ready === true ? "ready" : "blocked",
        owner: "adapter",
        nextAction: providerRelease.nextAction || "repair-provider-release-readiness",
      },
      {
        id: "tenant-audit-boundary",
        state: gates.tenantReady === true || tenantAudit.safeBoundary === true && tenantAudit.status === "ready" ? "ready" : "blocked",
        owner: "operator",
        nextAction: tenantAudit.handoff?.nextAction || "resolve-tenant-permission-boundary",
      },
      {
        id: "preview-acceptance",
        state: gates.acceptanceReady === true || previewAcceptance.acceptanceReceipt?.readyForRuntimeStart === true ? "ready" : "waiting",
        owner: "operator",
        nextAction: previewAcceptance.acceptanceReceipt?.nextAction || "request-operator-acceptance",
      },
      {
        id: "client-command-lease-replay",
        state: gates.commandLeasesReady === true || commandLeaseReplay.exportReady === true ? "ready" : "waiting",
        owner: "runtime",
        nextAction: commandLeaseReplay.nextAction || "refresh-command-lease-replay-export",
      },
    ];
  const blockedRows = releaseRows.filter((row) => row.state === "blocked");
  const waitingRows = releaseRows.filter((row) => row.state === "waiting");
  const state = source.state
    || (blockedRows.length > 0
      ? "blocked"
      : waitingRows.length > 0
        ? "waiting"
        : providerRelease.ready === true
          ? "ready"
          : "review");
  const ready = source.ready === true || state === "ready";
  const releaseToken = source.releaseToken
    || source.clientPatch?.runtimeReleaseToken
    || metadata.exports?.summary?.runtimeReleaseToken
    || `${metadata.jobId}:runtime-release-decision`;
  const nextAction = source.nextAction
    || source.clientPatch?.runtimeReleaseNextAction
    || (ready
      ? "release-runtime-handoff"
      : blockedRows[0]?.nextAction
        || waitingRows[0]?.nextAction
        || diagnostics.recovery?.nextAction
        || "review-runtime-release-decision");

  return {
    schemaVersion: "aios.mailchimp.runtime-release-decision-artifact.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    releaseToken,
    state,
    ready,
    accepted: source.accepted === true || previewAcceptance.acceptanceReceipt?.accepted === true,
    visibleStatus: source.visibleStatus || (ready ? "runtime-release-ready" : state === "waiting" ? "runtime-release-waiting" : "runtime-release-blocked"),
    nextAction,
    owner: source.owner || blockedRows[0]?.owner || waitingRows[0]?.owner || "runtime",
    releaseCommand: {
      commandId: source.releaseCommand?.commandId || source.releaseCommandId || source.clientPatch?.runtimeReleaseCommandId || null,
      enabled: ready,
      idempotencyKey: source.releaseCommand?.idempotencyKey || null,
      externalWritesPerformed: false,
      dryRunOnly: true,
    },
    gates: {
      lifecycleRuntimeStartEnabled: gates.lifecycleRuntimeStartEnabled === true || lifecycleControls.runtimeStart?.enabled === true,
      providerReady: gates.providerReady === true || providerRelease.ready === true,
      tenantReady: gates.tenantReady === true || tenantAudit.safeBoundary === true && tenantAudit.status === "ready",
      acceptanceReady: gates.acceptanceReady === true || previewAcceptance.acceptanceReceipt?.readyForRuntimeStart === true,
      commandLeasesReady: gates.commandLeasesReady === true || commandLeaseReplay.exportReady === true,
      replayExportReady: gates.replayExportReady === true || commandLeaseReplay.exportReady === true,
    },
    counters: {
      rows: source.counters?.rows || releaseRows.length,
      blocked: source.counters?.blocked || blockedRows.length || blockedGateIds.length,
      waiting: source.counters?.waiting || waitingRows.length || waitingGateIds.length,
      ready: source.counters?.ready || releaseRows.filter((row) => row.state === "ready").length,
      blockedJobs: source.counters?.blockedJobs || providerRelease.validationSummary?.blockedJobIds?.length || 0,
      waitingJobs: source.counters?.waitingJobs || providerRelease.validationSummary?.waitingJobIds?.length || 0,
    },
    rows: releaseRows.map((row) => ({
      id: row.id,
      state: row.state || "unknown",
      owner: row.owner || "runtime",
      nextAction: row.nextAction || nextAction,
      detail: row.detail || "",
      commandId: row.commandId || null,
      blockingCodes: normalizeArtifactList(row.blockingCodes),
    })),
    blockers: blockedGateIds.length > 0
      ? blockedGateIds
      : blockedRows.flatMap((row) => normalizeArtifactList(row.blockingCodes).length > 0 ? normalizeArtifactList(row.blockingCodes) : [row.id]),
    waitingOn: waitingGateIds.length > 0 ? waitingGateIds : waitingRows.map((row) => row.id),
    clientPatch: {
      ...(source.clientPatch || {}),
      runtimeReleaseDecisionArtifact: "runtime-release-decision.json",
      runtimeReleaseState: state,
      runtimeReleaseReady: ready,
      runtimeReleaseToken: releaseToken,
      runtimeReleaseNextAction: nextAction,
      runtimeReleaseCommandId: source.releaseCommand?.commandId || source.releaseCommandId || null,
      runtimeReleaseBlockedGateIds: blockedGateIds.length > 0 ? blockedGateIds : blockedRows.map((row) => row.id),
      runtimeReleaseWaitingGateIds: waitingGateIds.length > 0 ? waitingGateIds : waitingRows.map((row) => row.id),
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: source.restartSemantics?.duplicateCommandPolicy || "dedupe-by-runtime-release-token",
      resumeFromReleaseToken: source.restartSemantics?.resumeFromReleaseToken || releaseToken,
      externalWritesPerformed: false,
    },
  };
}

function normalizeArtifactList(value) {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  return [...new Set(source.map((item) => String(item ?? "").trim()).filter(Boolean))].sort();
}

function buildTenantBoundaryMatrixArtifact(metadata, diagnostics, tenantAuditHandoff) {
  const source = metadata.tenantBoundaryMatrix
    || metadata.dryRun?.tenantBoundaryMatrix
    || metadata.exports?.summary?.tenantBoundaryMatrix
    || diagnostics.tenantBoundaryMatrix
    || {};
  const rows = Array.isArray(source.rows) && source.rows.length > 0
    ? source.rows
    : (tenantAuditHandoff.rows || []).map((row) => ({
      sequence: row.sequence,
      jobId: row.jobId,
      operation: row.operation,
      boundaryState: row.status === "blocked"
        ? "blocked"
        : row.status === "approval-hold"
          ? "approval-required"
          : "ready",
      permissionDecision: row.permissionDecision,
      safeForAdapterRelease: row.status === "audit-ready",
      tenantId: row.tenantId || tenantAuditHandoff.scope?.tenantId,
      workspaceId: row.workspaceId || tenantAuditHandoff.scope?.workspaceId,
      actorId: row.actorId || tenantAuditHandoff.actor?.id,
      missingScopes: row.missingScopes || [],
      auditRef: row.auditRef,
      checkpointKey: row.checkpointKey,
      replayCursor: row.replayCursor,
      adapterStatusResumeCursor: row.adapterStatusResumeCursor,
      nextAction: row.nextAction,
    }));
  const blockedRows = rows.filter((row) => row.boundaryState === "blocked" || row.status === "blocked");
  const approvalRows = rows.filter((row) => row.boundaryState === "approval-required" || row.status === "approval-hold");
  const readyRows = rows.filter((row) => row.boundaryState === "ready" || row.status === "audit-ready");
  const missingScopes = normalizeArtifactList(
    source.clientPatch?.tenantBoundaryMissingScopes
      || source.permissions?.missing
      || rows.flatMap((row) => row.missingScopes || []),
  );
  const auditRefs = normalizeArtifactList(
    source.audit?.auditRefs
      || source.handoff?.auditRefs
      || rows.map((row) => row.auditRef),
  );
  const resumeCursors = normalizeArtifactList(
    source.audit?.resumeCursors
      || source.handoff?.resumeCursors
      || rows.map((row) => row.adapterStatusResumeCursor),
  );
  const status = source.status
    || (blockedRows.length > 0
      ? "blocked"
      : approvalRows.length > 0
        ? "needs-approval"
        : "ready");
  const nextAction = source.audit?.nextAction
    || source.clientPatch?.tenantBoundaryNextAction
    || tenantAuditHandoff.handoff?.nextAction
    || (status === "blocked"
      ? "resolve-tenant-permission-boundary"
      : status === "needs-approval"
        ? "collect-tenant-approval"
        : "append-audit-before-runtime-release");
  const isolationKey = source.isolationKey || tenantAuditHandoff.isolationKey || `${metadata.jobId}:tenant-boundary`;
  const exportReady = source.exportReady === true
    || (
      status === "ready"
      && tenantAuditHandoff.safeBoundary === true
      && blockedRows.length === 0
      && missingScopes.length === 0
      && auditRefs.length > 0
    );
  const historySnapshots = [
    {
      id: `${isolationKey}:matrix-start`,
      sequence: 1,
      type: "tenant-boundary-matrix-start",
      status: tenantAuditHandoff.status || "unknown",
      isolationKey,
      rowCount: rows.length,
    },
    ...rows.map((row, index) => ({
      id: `${isolationKey}:row:${row.jobId || index + 1}`,
      sequence: index + 2,
      type: "tenant-boundary-row",
      jobId: row.jobId || metadata.jobId,
      boundaryState: row.boundaryState || row.status || "unknown",
      permissionDecision: row.permissionDecision || "unknown",
      auditRef: row.auditRef || null,
      nextAction: row.nextAction || nextAction,
    })),
    {
      id: `${isolationKey}:matrix-finish:${status}`,
      sequence: rows.length + 2,
      type: "tenant-boundary-matrix-finish",
      status,
      exportReady,
      nextAction,
      blockedJobIds: blockedRows.map((row) => row.jobId).filter(Boolean),
      approvalJobIds: approvalRows.map((row) => row.jobId).filter(Boolean),
    },
  ];

  return {
    schemaVersion: "aios.mailchimp.tenant-boundary-matrix-artifact.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    status,
    exportReady,
    isolationKey,
    policyVersion: source.policyVersion || tenantAuditHandoff.scope?.policyVersion || "1",
    scope: tenantAuditHandoff.scope || source.scope || {},
    actor: tenantAuditHandoff.actor || source.actor || {},
    counters: {
      rows: source.counters?.rows || rows.length,
      ready: source.counters?.ready || readyRows.length,
      blocked: source.counters?.blocked || blockedRows.length,
      approvalRequired: source.counters?.approvalRequired || approvalRows.length,
      missingScopes: source.counters?.missingScopes || missingScopes.length,
      auditRefs: source.counters?.auditRefs || auditRefs.length,
      resumeCursors: source.counters?.resumeCursors || resumeCursors.length,
    },
    rows: rows.map((row, index) => ({
      sequence: row.sequence || index + 1,
      jobId: row.jobId || metadata.jobId,
      operation: row.operation || null,
      boundaryState: row.boundaryState || row.status || "unknown",
      permissionDecision: row.permissionDecision || "unknown",
      safeForAdapterRelease: row.safeForAdapterRelease === true,
      auditRef: row.auditRef || null,
      checkpointKey: row.checkpointKey || null,
      replayCursor: row.replayCursor || null,
      adapterStatusResumeCursor: row.adapterStatusResumeCursor || null,
      missingScopes: normalizeArtifactList(row.missingScopes),
      nextAction: row.nextAction || nextAction
    })),
    audit: {
      appendMode: source.audit?.appendMode || tenantAuditHandoff.handoff?.auditAppendMode || "local-before-adapter-release",
      auditRefs,
      resumeCursors,
      externalWritesPerformed: false,
      nextAction
    },
    analytics: {
      counters: {
        blockedRatio: rows.length > 0 ? blockedRows.length / rows.length : 0,
        approvalRatio: rows.length > 0 ? approvalRows.length / rows.length : 0,
        readyRatio: rows.length > 0 ? readyRows.length / rows.length : 0,
      },
      historySnapshotIds: historySnapshots.map((snapshot) => snapshot.id),
      timelineEvents: historySnapshots.length,
    },
    historySnapshots,
    exportSummary: {
      format: "aios.mailchimp.tenant-boundary-matrix-export.v1",
      status,
      exportReady,
      isolationKey,
      blockedJobIds: blockedRows.map((row) => row.jobId).filter(Boolean).sort(),
      approvalJobIds: approvalRows.map((row) => row.jobId).filter(Boolean).sort(),
      missingScopes,
      auditRefs,
      resumeCursors,
      nextAction,
    },
    clientPatch: {
      ...(source.clientPatch || {}),
      tenantBoundaryMatrixArtifact: "tenant-boundary-matrix.json",
      tenantBoundaryStatus: status,
      tenantBoundaryReady: exportReady,
      tenantBoundaryBlockedJobs: blockedRows.map((row) => row.jobId).filter(Boolean).sort(),
      tenantBoundaryApprovalJobs: approvalRows.map((row) => row.jobId).filter(Boolean).sort(),
      tenantBoundaryMissingScopes: missingScopes,
      tenantBoundaryNextAction: nextAction
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-tenant-boundary-isolation-key",
      resumeFromIsolationKey: isolationKey,
      externalWritesPerformed: false
    }
  };
}

function buildTenantAuditHandoffArtifact(metadata, diagnostics) {
  const source = metadata.tenantAuditHandoff
    || metadata.dryRun?.tenantAuditHandoff
    || metadata.exports?.summary?.tenantAuditHandoff
    || diagnostics.tenantAuditHandoff
    || {};
  const permissionBoundary = diagnostics.permissionBoundary || {};
  const tenant = source.scope || source.tenant || {};
  const permissions = source.permissions || {};
  const validation = Array.isArray(source.validation)
    ? source.validation
    : [];
  const rows = Array.isArray(source.rows)
    ? source.rows
    : [];
  const blockedRows = rows.filter((row) => row.status === "blocked");
  const approvalRows = rows.filter((row) => row.status === "approval-hold");
  const missingScopes = normalizeArtifactList(permissions.missing || permissionBoundary.missingScopes || permissionBoundary.deniedScopes);
  const blockedJobIds = normalizeArtifactList(permissions.blockedJobIds || blockedRows.map((row) => row.jobId));
  const approvalJobIds = normalizeArtifactList(permissions.approvalJobIds || approvalRows.map((row) => row.jobId));
  const isolationKey = source.isolationKey
    || permissionBoundary.isolationKey
    || `${metadata.jobId}:tenant-audit`;
  const safeBoundary = source.safeBoundary === true
    || (permissionBoundary.safeBoundary === true && blockedJobIds.length === 0 && missingScopes.length === 0);
  const status = source.status
    || (blockedJobIds.length > 0 || safeBoundary === false
      ? "blocked"
      : approvalJobIds.length > 0
        ? "needs-approval"
        : "ready");
  const nextAction = source.handoff?.nextAction
    || permissionBoundary.nextAction
    || (status === "blocked"
      ? "resolve-tenant-permission-boundary"
      : status === "needs-approval"
        ? "collect-tenant-approval"
        : "append-audit-before-runtime-release");

  return {
    schemaVersion: "aios.mailchimp.tenant-audit-handoff-artifact.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    status,
    safeBoundary,
    isolationKey,
    actor: {
      id: source.actor?.id || permissionBoundary.actorId || "",
      roles: normalizeArtifactList(source.actor?.roles || permissionBoundary.roles),
      privileged: source.actor?.privileged === true || permissionBoundary.privilegedRole === true
    },
    scope: {
      tenantId: tenant.tenantId || tenant.tenant || permissionBoundary.tenantId || "tenant.local",
      workspaceId: tenant.workspaceId || tenant.workspace || permissionBoundary.workspaceId || "workspace.local",
      source: tenant.source || permissionBoundary.source || "artifact-emitter",
      policyVersion: tenant.policyVersion || permissionBoundary.policyVersion || "1"
    },
    permissions: {
      granted: normalizeArtifactList(permissions.granted || permissionBoundary.grantedScopes || permissionBoundary.grantedPermissions),
      missing: missingScopes,
      blockedJobIds,
      approvalJobIds
    },
    rows: rows.map((row, index) => ({
      sequence: row.sequence || index + 1,
      jobId: row.jobId || metadata.jobId,
      operation: row.operation || null,
      status: row.status || "unknown",
      permissionDecision: row.permissionDecision || "unknown",
      auditRef: row.auditRef || `${metadata.jobId}:tenant-audit:${index + 1}`,
      checkpointKey: row.checkpointKey || null,
      replayCursor: row.replayCursor || null,
      adapterStatusResumeCursor: row.adapterStatusResumeCursor || null,
      nextAction: row.nextAction || nextAction
    })),
    handoff: {
      required: true,
      externalWritesPerformed: false,
      auditAppendMode: source.handoff?.auditAppendMode || "local-before-adapter-release",
      auditRefs: normalizeArtifactList(source.handoff?.auditRefs || rows.map((row) => row.auditRef)),
      resumeCursors: normalizeArtifactList(source.handoff?.resumeCursors || rows.map((row) => row.adapterStatusResumeCursor)),
      nextAction
    },
    validation: validation.length > 0
      ? validation
      : [
        {
          code: "artifact.tenant-audit.boundary",
          status: safeBoundary ? "pass" : "fail",
          detail: safeBoundary
            ? "Tenant audit handoff can be appended before runtime release."
            : "Tenant audit handoff is blocked by the tenant permission boundary."
        },
        {
          code: "artifact.tenant-audit.scopes",
          status: missingScopes.length === 0 ? "pass" : "fail",
          detail: missingScopes.length === 0
            ? "No missing tenant audit scopes were reported."
            : `Missing tenant audit scopes: ${missingScopes.join(", ")}.`
        }
      ],
    clientPatch: {
      tenantAuditStatus: status,
      tenantAuditReady: safeBoundary && status === "ready",
      tenantAuditIsolationKey: isolationKey,
      tenantAuditNextAction: nextAction,
      tenantAuditBlockedJobs: blockedJobIds,
      tenantAuditApprovalJobs: approvalJobIds
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-tenant-audit-isolation-key",
      resumeFromIsolationKey: isolationKey,
      externalWritesPerformed: false
    }
  };
}

function buildClientCommandLeasesArtifact(metadata, diagnostics) {
  const leaseSummary = metadata.clientCommandLeases || metadata.health?.clientCommandLeases || {};
  const diagnosticLeases = diagnostics.clientCommandLeases || {};
  const leases = Array.isArray(leaseSummary.leases)
    ? leaseSummary.leases
    : Array.isArray(diagnosticLeases.leases)
      ? diagnosticLeases.leases
      : [];
  const primaryLease = leases.find((lease) => lease.id === leaseSummary.primaryLeaseId)
    || leases.find((lease) => lease.id === diagnosticLeases.primaryLeaseId)
    || leases[0]
    || null;
  const ackKeys = leaseSummary.ackKeys || diagnosticLeases.clientAck?.ackKeys || [];
  const ackRequired = leaseSummary.ackRequired === true || diagnosticLeases.clientAck?.required === true;

  return {
    schemaVersion: "aios.mailchimp.client-command-leases-artifact.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    status: leaseSummary.status || diagnosticLeases.status || diagnostics.status,
    leaseStatus: leaseSummary.leaseStatus || diagnosticLeases.leaseStatus || "unknown",
    primaryLeaseId: primaryLease?.id || null,
    primaryAction: leaseSummary.primaryAction
      || diagnosticLeases.primaryAction
      || primaryLease?.nextAction
      || diagnostics.recovery?.nextAction
      || "handoff-to-runtime-adapter",
    resumeToken: leaseSummary.resumeToken
      || diagnosticLeases.clientAck?.resumeToken
      || `${metadata.jobId}:client-command-leases`,
    ack: {
      required: ackRequired,
      requiredCount: leaseSummary.ackRequiredCount || diagnosticLeases.ackRequiredCount || 0,
      keys: ackKeys,
      nextAckKey: primaryLease?.ackKey || ackKeys[0] || null,
      resumeFromLeaseId: primaryLease?.id || null
    },
    counts: {
      total: leases.length,
      visible: leaseSummary.visibleCount || diagnosticLeases.visibleCount || leases.filter((lease) => lease.clientVisible).length,
      blocking: leaseSummary.blockingCount || diagnosticLeases.blockingCount || leases.filter((lease) => lease.blocksRuntimeStart).length,
      ackRequired: leaseSummary.ackRequiredCount || diagnosticLeases.ackRequiredCount || leases.filter((lease) => lease.ackRequired).length
    },
    leases: leases.map((lease) => ({
      id: lease.id,
      commandId: lease.commandId,
      status: lease.status,
      reason: lease.reason,
      nextAction: lease.nextAction,
      ackRequired: lease.ackRequired === true,
      ackKey: lease.ackKey || null,
      clientVisible: lease.clientVisible === true,
      blocksRuntimeStart: lease.blocksRuntimeStart === true,
      scheduleWindow: lease.scheduleWindow,
      scope: lease.scope || {},
      retryable: lease.retryPolicy?.retryable === true || lease.retryable === true,
      backoffMs: lease.retryPolicy?.backoffMs || lease.backoffMs || 0
    })),
    clientPatch: {
      ...(leaseSummary.clientPatch || {}),
      commandLeaseStatus: leaseSummary.leaseStatus || diagnosticLeases.leaseStatus || "unknown",
      commandLeaseId: primaryLease?.id || null,
      commandAckRequired: ackRequired,
      commandAckKey: primaryLease?.ackKey || ackKeys[0] || null,
      commandLeaseResumeToken: leaseSummary.resumeToken || diagnosticLeases.clientAck?.resumeToken || null
    },
    restartSemantics: leaseSummary.restartSemantics || diagnosticLeases.restartSemantics || {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-command-lease-key",
      externalWritesPerformed: false,
      resumeFromLeaseId: primaryLease?.id || null
    }
  };
}

function buildClientCommandLeaseReplayArtifact(metadata, diagnostics, clientCommandLeases) {
  const replaySource = metadata.clientCommandLeaseReplay
    || metadata.dryRun?.clientCommandLeaseReplay
    || diagnostics.clientCommandLeaseReplay
    || {};
  const leaseSource = Array.isArray(replaySource.leases) && replaySource.leases.length > 0
    ? replaySource.leases
    : clientCommandLeases.leases;
  const leases = Array.isArray(leaseSource) ? leaseSource : [];
  const blockingLeases = leases.filter((lease) => lease.blocksRuntimeStart === true || lease.status === "blocked");
  const ackLeases = leases.filter((lease) => lease.ackRequired === true || lease.ack?.required === true);
  const replayReadyLeases = leases.filter((lease) => (
    lease.replay?.replayCursor
    || lease.replayCursor
    || lease.statusProjection?.restartSafe === true
  ));
  const status = replaySource.status
    || (blockingLeases.length > 0
      ? "blocked"
      : ackLeases.length > 0
        ? "waiting-for-client-ack"
        : leases.length === replayReadyLeases.length
          ? "ready"
          : "review");
  const resumeToken = replaySource.resumeToken
    || clientCommandLeases.resumeToken
    || `${metadata.jobId}:client-command-lease-replay`;
  const primaryLease = leases.find((lease) => lease.id === replaySource.primaryLeaseId)
    || blockingLeases[0]
    || ackLeases[0]
    || leases[0]
    || null;
  const ackKeys = replaySource.ack?.keys
    || ackLeases.map((lease) => lease.ackKey || lease.ack?.nextAckKey).filter(Boolean);
  const replayRows = leases.map((lease) => ({
    leaseId: lease.id,
    jobId: lease.jobId || null,
    commandId: lease.commandId || null,
    status: lease.status || "unknown",
    visibleStatus: lease.visibleStatus || lease.statusProjection?.visible || lease.status || "unknown",
    nextAction: lease.nextAction || "review-client-command-lease",
    ackRequired: lease.ackRequired === true || lease.ack?.required === true,
    ackKey: lease.ackKey || lease.ack?.nextAckKey || null,
    blocksRuntimeStart: lease.blocksRuntimeStart === true,
    replayCursor: lease.replay?.replayCursor || lease.replayCursor || null,
    replayDecision: lease.replay?.replayDecision || lease.replayDecision || "return-existing-status",
    idempotencyKey: lease.replay?.idempotencyKey || lease.idempotencyKey || null,
    checkpointKey: lease.replay?.checkpointKey || lease.checkpointKey || null,
    ledgerKey: lease.replay?.ledgerKey || lease.ledgerKey || null,
    retryable: lease.retryPolicy?.retryable === true || lease.retryable === true,
    nextBackoffMs: lease.retryPolicy?.nextBackoffMs || lease.retryPolicy?.backoffMs || lease.backoffMs || 0
  }));
  const replaySafe = blockingLeases.length === 0
    && replayRows.every((row) => row.replayCursor || leases.length === 0)
    && replayRows.every((row) => row.idempotencyKey || row.ackRequired || leases.length === 0);

  return {
    schemaVersion: "aios.mailchimp.client-command-lease-replay-artifact.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    status,
    ready: status === "ready" || status === "review",
    resumeToken,
    primaryLeaseId: primaryLease?.id || null,
    primaryAction: replaySource.primaryAction
      || primaryLease?.nextAction
      || clientCommandLeases.primaryAction
      || diagnostics.recovery?.nextAction
      || "review-client-command-lease-replay",
    ack: {
      required: replaySource.ack?.required === true || ackLeases.length > 0,
      requiredCount: replaySource.ack?.requiredCount || ackLeases.length,
      keys: ackKeys,
      nextAckKey: replaySource.ack?.nextAckKey || ackKeys[0] || null,
      resumeFromLeaseId: primaryLease?.id || null
    },
    counts: {
      total: leases.length,
      blocking: replaySource.counts?.blocking || blockingLeases.length,
      ackRequired: replaySource.counts?.ackRequired || ackLeases.length,
      replayReady: replaySource.counts?.replayReady || replayReadyLeases.length,
      restartUnsafe: replaySource.counts?.restartUnsafe
        || replayRows.filter((row) => !row.replayCursor && leases.length > 0).length
    },
    replay: {
      safe: replaySource.restartSemantics?.replaySafe !== false && replaySafe,
      duplicateCommandPolicy: replaySource.restartSemantics?.duplicateCommandPolicy
        || "dedupe-by-client-command-lease-key",
      onColdRestart: replaySource.restartSemantics?.onColdRestart
        || (ackLeases.length > 0 ? "resume-client-command-ack" : "reload-command-lease-ledger"),
      onDuplicateCommand: replaySource.restartSemantics?.onDuplicateCommand || "return-existing-command-lease",
      externalWritesPerformed: false
    },
    rows: replayRows,
    clientPatch: {
      ...(replaySource.clientPatch || {}),
      commandLeaseReplayStatus: status,
      commandLeaseReplayReady: replaySafe,
      commandLeaseReplayResumeToken: resumeToken,
      commandLeaseReplayPrimaryLeaseId: primaryLease?.id || null,
      commandLeaseReplayAckRequired: ackLeases.length > 0,
      commandLeaseReplayAckKey: ackKeys[0] || null,
      runtimeStartBlockedByCommandLease: blockingLeases.length > 0
    },
    restartSemantics: {
      replaySafe,
      duplicateCommandPolicy: replaySource.restartSemantics?.duplicateCommandPolicy
        || "dedupe-by-client-command-lease-key",
      resumeFromLeaseId: primaryLease?.id || null,
      resumeToken,
      externalWritesPerformed: false
    }
  };
}

function buildCommandLeaseReplayExportArtifact(metadata, diagnostics, clientCommandLeaseReplay) {
  const source = metadata.commandLeaseReplayExport
    || metadata.dryRun?.commandLeaseReplayExport
    || metadata.exports?.summary?.commandLeaseReplayExport
    || diagnostics.commandLeaseReplayExport
    || {};
  const rows = Array.isArray(clientCommandLeaseReplay.rows)
    ? clientCommandLeaseReplay.rows
    : [];
  const blockingRows = rows.filter((row) => row.blocksRuntimeStart === true || row.status === "blocked");
  const ackRows = rows.filter((row) => row.ackRequired === true);
  const replayReadyRows = rows.filter((row) => row.replayCursor && row.idempotencyKey);
  const restartUnsafeRows = rows.filter((row) => !row.replayCursor && rows.length > 0);
  const retryableRows = rows.filter((row) => row.retryable === true);
  const nextBackoffMs = retryableRows
    .map((row) => row.nextBackoffMs)
    .filter((delayMs) => Number.isFinite(delayMs) && delayMs >= 0)
    .sort((left, right) => left - right)[0] ?? 0;
  const exportReady = source.exportReady === true
    || (
      clientCommandLeaseReplay.ready === true
      && clientCommandLeaseReplay.replay?.safe !== false
      && blockingRows.length === 0
      && restartUnsafeRows.length === 0
    );
  const ackKeys = source.ack?.keys
    || clientCommandLeaseReplay.ack?.keys
    || ackRows.map((row) => row.ackKey).filter(Boolean);
  const nextAction = source.nextAction
    || (exportReady
      ? "publish-command-lease-replay-summary"
      : blockingRows[0]?.nextAction
        || ackRows[0]?.nextAction
        || clientCommandLeaseReplay.primaryAction
        || diagnostics.recovery?.nextAction
        || "refresh-client-command-lease-replay");

  return {
    schemaVersion: "aios.mailchimp.command-lease-replay-export-artifact.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    status: source.status || clientCommandLeaseReplay.status,
    ready: clientCommandLeaseReplay.ready === true,
    exportReady,
    resumeToken: source.resumeToken || clientCommandLeaseReplay.resumeToken || `${metadata.jobId}:command-lease-replay-export`,
    primaryLeaseId: source.primaryLeaseId || clientCommandLeaseReplay.primaryLeaseId || null,
    primaryAction: source.primaryAction || clientCommandLeaseReplay.primaryAction || nextAction,
    nextAction,
    ack: {
      required: source.ack?.required === true || clientCommandLeaseReplay.ack?.required === true || ackRows.length > 0,
      requiredCount: source.ack?.requiredCount || clientCommandLeaseReplay.ack?.requiredCount || ackRows.length,
      nextAckKey: source.ack?.nextAckKey || clientCommandLeaseReplay.ack?.nextAckKey || ackKeys[0] || null,
      keys: ackKeys,
      jobIds: source.ack?.jobIds || [...new Set(ackRows.map((row) => row.jobId).filter(Boolean))].sort()
    },
    counters: {
      total: source.counters?.total || rows.length,
      blocking: source.counters?.blocking || blockingRows.length,
      ackRequired: source.counters?.ackRequired || ackRows.length,
      replayReady: source.counters?.replayReady || replayReadyRows.length,
      restartUnsafe: source.counters?.restartUnsafe || restartUnsafeRows.length,
      retryable: source.counters?.retryable || retryableRows.length
    },
    jobIds: {
      blocking: source.jobIds?.blocking || [...new Set(blockingRows.map((row) => row.jobId).filter(Boolean))].sort(),
      ackRequired: source.jobIds?.ackRequired || [...new Set(ackRows.map((row) => row.jobId).filter(Boolean))].sort(),
      replayReady: source.jobIds?.replayReady || [...new Set(replayReadyRows.map((row) => row.jobId).filter(Boolean))].sort()
    },
    replay: {
      safe: exportReady,
      resumeCursors: source.replay?.resumeCursors || rows.map((row) => row.replayCursor).filter(Boolean),
      idempotencyKeys: source.replay?.idempotencyKeys || rows.map((row) => row.idempotencyKey).filter(Boolean),
      decisions: source.replay?.decisions || rows.reduce((counts, row) => {
        const decision = row.replayDecision || "return-existing-status";
        counts[decision] = (counts[decision] ?? 0) + 1;
        return counts;
      }, {}),
      nextBackoffMs: source.replay?.nextBackoffMs || nextBackoffMs
    },
    rows: rows.map((row) => ({
      leaseId: row.leaseId,
      jobId: row.jobId,
      commandId: row.commandId,
      status: row.status,
      visibleStatus: row.visibleStatus,
      nextAction: row.nextAction,
      ackRequired: row.ackRequired === true,
      blocksRuntimeStart: row.blocksRuntimeStart === true,
      replayCursor: row.replayCursor,
      replayDecision: row.replayDecision,
      restartSafe: Boolean(row.replayCursor && (row.idempotencyKey || row.ackRequired === true)),
      retryable: row.retryable === true,
      nextBackoffMs: row.nextBackoffMs || 0
    })),
    clientPatch: {
      commandLeaseReplayExportReady: exportReady,
      commandLeaseReplayExportStatus: source.status || clientCommandLeaseReplay.status,
      commandLeaseReplayExportResumeToken: source.resumeToken || clientCommandLeaseReplay.resumeToken || null,
      commandLeaseReplayExportNextAction: nextAction,
      commandLeaseReplayExportAckRequired: ackRows.length > 0 || clientCommandLeaseReplay.ack?.required === true,
      commandLeaseReplayExportBlockingCount: blockingRows.length
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-command-lease-replay-export-token",
      resumeToken: source.resumeToken || clientCommandLeaseReplay.resumeToken || null,
      externalWritesPerformed: false
    }
  };
}

function buildDryRunAnalyticsExportArtifact(metadata, diagnostics, assembled = {}) {
  const source = metadata.dryRun?.dryRunAnalyticsExport
    || metadata.exports?.summary?.dryRunAnalyticsExport
    || metadata.analytics?.dryRunAnalyticsExport
    || diagnostics.dryRunAnalyticsExport
    || {};
  const analyticsSource = metadata.analytics || metadata.dryRun?.analytics || diagnostics.analytics || {};
  const tenantBoundary = source.tenantBoundary
    || metadata.dryRun?.tenantBoundaryMatrix
    || metadata.exports?.summary?.tenantBoundaryMatrix
    || diagnostics.tenantBoundaryMatrix
    || assembled.tenantBoundaryMatrix
    || {};
  const commandLeaseReplay = source.commandLeaseReplay
    || metadata.commandLeaseReplayExport
    || metadata.dryRun?.commandLeaseReplayExport
    || diagnostics.commandLeaseReplayExport
    || assembled.commandLeaseReplayExport
    || {};
  const providerRelease = metadata.providerReleaseContract
    || metadata.dryRun?.providerReleaseContract
    || metadata.exports?.summary?.providerReleaseContract
    || diagnostics.providerReleaseReadiness
    || assembled.providerReleaseReadiness
    || {};
  const lifecycle = metadata.lifecycle || diagnostics.lifecycleOperatorControls || assembled.lifecycleOperatorControls || {};
  const historySnapshots = Array.isArray(source.historySnapshots)
    ? source.historySnapshots
    : Array.isArray(source.history?.snapshots)
      ? source.history.snapshots
      : [];
  const historySnapshotIds = normalizeArtifactList(
    source.exportSummary?.historySnapshotIds
      || source.history?.snapshotIds
      || analyticsSource.historySnapshotIds
      || metadata.exports?.summary?.historySnapshotIds,
  );
  const timelineSource = Array.isArray(source.timeline) ? source.timeline : [];
  const blockerCodes = normalizeArtifactList(source.exportSummary?.blockerCodes || source.blockerCodes);
  const warningCodes = normalizeArtifactList(source.exportSummary?.warningCodes || source.warningCodes);
  const tenantBlockedJobs = normalizeArtifactList(
    source.clientPatch?.dryRunAnalyticsBlockedJobs
      || tenantBoundary.exportSummary?.blockedJobIds
      || tenantBoundary.clientPatch?.tenantBoundaryBlockedJobs,
  );
  const tenantApprovalJobs = normalizeArtifactList(
    source.clientPatch?.dryRunAnalyticsApprovalJobs
      || tenantBoundary.exportSummary?.approvalJobIds
      || tenantBoundary.clientPatch?.tenantBoundaryApprovalJobs,
  );
  const providerMissingCapabilities = normalizeArtifactList(
    providerRelease.capabilityNegotiation?.missing
      || providerRelease.validationSummary?.missingCapabilities,
  );
  const exportReady = source.exportReady === true
    || (
      providerRelease.ready === true
      && tenantBoundary.exportReady !== false
      && commandLeaseReplay.exportReady !== false
      && blockerCodes.length === 0
      && tenantBlockedJobs.length === 0
    );
  const status = source.status
    || (exportReady
      ? "ready"
      : blockerCodes.length > 0 || tenantBlockedJobs.length > 0 || providerRelease.status === "blocked"
        ? "blocked"
        : warningCodes.length > 0 || tenantApprovalJobs.length > 0
          ? "waiting"
          : "review");
  const nextAction = source.nextAction
    || (exportReady
      ? "publish-dry-run-analytics-export"
      : tenantBlockedJobs.length > 0
        ? tenantBoundary.audit?.nextAction || "resolve-tenant-permission-boundary"
        : providerRelease.ready !== true
          ? providerRelease.nextAction || "repair-provider-release-readiness"
          : commandLeaseReplay.exportReady === false
            ? commandLeaseReplay.nextAction || "refresh-command-lease-replay-export"
            : "review-dry-run-analytics-export");
  const timeline = timelineSource.length > 0
    ? timelineSource.map((entry, index) => ({
      sequence: entry.sequence || index + 1,
      phase: entry.phase || entry.type || "analytics",
      status: entry.status || status,
      event: entry.event || entry.type || "dry-run-analytics-event",
      nextAction: entry.nextAction || nextAction,
      exportReady: entry.exportReady === true,
    }))
    : [
      {
        sequence: 1,
        phase: "artifact-emitter",
        status,
        event: "dry-run-analytics-artifact-built",
        nextAction,
        exportReady,
      },
    ];

  return {
    schemaVersion: "aios.mailchimp.dry-run-analytics-export-artifact.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    reportId: source.reportId || metadata.exports?.summary?.reportId || metadata.jobId,
    planId: source.planId || metadata.exports?.summary?.planId || metadata.jobId,
    status,
    exportReady,
    nextAction,
    counters: {
      ...(source.counters || {}),
      jobsTotal: source.counters?.jobsTotal || analyticsSource.counters?.jobsTotal || 0,
      jobsBlocked: source.counters?.jobsBlocked || analyticsSource.counters?.jobsBlocked || tenantBlockedJobs.length,
      jobsDegraded: source.counters?.jobsDegraded || analyticsSource.counters?.jobsDegraded || tenantApprovalJobs.length,
      actionableErrors: source.counters?.actionableErrors || blockerCodes.length + warningCodes.length,
      historySnapshots: source.counters?.historySnapshots || historySnapshots.length || historySnapshotIds.length,
      timelineEvents: source.counters?.timelineEvents || timeline.length,
      blockerCodes: source.counters?.blockerCodes || blockerCodes.length,
      warningCodes: source.counters?.warningCodes || warningCodes.length,
      providerMissingCapabilities: providerMissingCapabilities.length,
      tenantBlockedJobs: tenantBlockedJobs.length,
      tenantApprovalJobs: tenantApprovalJobs.length,
    },
    readiness: {
      admitted: source.readiness?.admitted === true || metadata.exports?.summary?.accepted === true,
      operationalHealthReady: source.readiness?.operationalHealthReady === true,
      providerReleaseReady: providerRelease.ready === true,
      tenantBoundaryReady: tenantBoundary.exportReady === true || tenantBoundary.safeBoundary === true,
      commandLeaseReplayReady: commandLeaseReplay.exportReady === true || commandLeaseReplay.ready === true,
      runtimeStartEnabled: source.readiness?.runtimeStartEnabled === true
        || lifecycle.runtimeStart?.enabled === true
        || lifecycle.runtimeStartEnabled === true,
    },
    providerService: source.providerService || {
      status: providerRelease.status || "unknown",
      nextAction: providerRelease.nextAction || null,
      missingCapabilities: providerMissingCapabilities,
    },
    tenantBoundary: source.tenantBoundary || {
      status: tenantBoundary.status || "unknown",
      exportReady: tenantBoundary.exportReady === true,
      isolationKey: tenantBoundary.isolationKey || null,
      nextAction: tenantBoundary.audit?.nextAction || null,
      blockedJobIds: tenantBlockedJobs,
      approvalJobIds: tenantApprovalJobs,
    },
    commandLeaseReplay: source.commandLeaseReplay || {
      status: commandLeaseReplay.status || "unknown",
      exportReady: commandLeaseReplay.exportReady === true,
      resumeToken: commandLeaseReplay.resumeToken || null,
      nextAction: commandLeaseReplay.nextAction || null,
    },
    historySnapshots,
    timeline,
    exportSummary: {
      format: "aios.mailchimp.dry-run-analytics-summary.v1",
      status,
      exportReady,
      nextAction,
      blockerCodes,
      warningCodes,
      historySnapshotIds,
      timelineEventIds: source.exportSummary?.timelineEventIds || timeline.map((entry) => `${metadata.jobId}:${entry.sequence}:${entry.phase}`),
      externalWritesPerformed: false,
    },
    clientPatch: {
      ...(source.clientPatch || {}),
      dryRunAnalyticsExportArtifact: "dry-run-analytics-export.json",
      dryRunAnalyticsExportStatus: status,
      dryRunAnalyticsExportReady: exportReady,
      dryRunAnalyticsExportNextAction: nextAction,
      dryRunAnalyticsHistorySnapshots: historySnapshots.length || historySnapshotIds.length,
      dryRunAnalyticsTimelineEvents: timeline.length,
      dryRunAnalyticsBlockedJobs: tenantBlockedJobs,
      dryRunAnalyticsApprovalJobs: tenantApprovalJobs,
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-dry-run-analytics-report-id",
      resumeFromReportId: source.reportId || metadata.exports?.summary?.reportId || metadata.jobId,
      externalWritesPerformed: false,
    },
  };
}

function buildLifecycleControlsArtifact(metadata, diagnostics) {
  const lifecycle = metadata.lifecycle || {};
  const diagnosticLifecycle = diagnostics.lifecycleControls || {};
  const operatorControls = lifecycle.operatorControls
    || diagnosticLifecycle.operatorControls
    || diagnostics.lifecycleOperatorControls
    || {};
  const controls = Array.isArray(lifecycle.controls)
    ? lifecycle.controls
    : Array.isArray(operatorControls.controls)
      ? operatorControls.controls
      : [];
  const blockedControls = controls.filter((control) => control.status === "blocked");
  const disabledControls = controls.filter((control) => control.enabled !== true);

  return {
    schemaVersion: "aios.mailchimp.lifecycle-controls-artifact.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    status: lifecycle.status || diagnosticLifecycle.status || diagnostics.status,
    nextAction: lifecycle.nextAction || diagnosticLifecycle.nextAction || diagnostics.recovery?.nextAction,
    previewEnabled: lifecycle.previewEnabled === true || diagnosticLifecycle.preview?.enabled === true,
    runtimeStartEnabled: lifecycle.runtimeStartEnabled === true || diagnosticLifecycle.runtimeStart?.enabled === true,
    capabilityEnableControlsVisible: lifecycle.capabilityEnableControlsVisible === true,
    operatorControlsStateKey: operatorControls.stateKey || null,
    operatorControlsStatus: operatorControls.status || "unknown",
    operatorControlsNextAction: operatorControls.nextAction || null,
    controls: controls.map((control) => ({
      id: control.id,
      label: control.label,
      status: control.status,
      enabled: control.enabled === true,
      required: control.required === true,
      disableReason: control.disableReason || null,
      nextAction: control.nextAction
    })),
    disabledActions: lifecycle.disabledActions || {
      required: diagnosticLifecycle.capabilityControls?.disabledRequiredActions || [],
      write: diagnosticLifecycle.capabilityControls?.disabledWriteActions || [],
      all: diagnosticLifecycle.capabilityControls?.disabledActions || []
    },
    schedule: lifecycle.schedule || diagnosticLifecycle.schedule || {},
    summary: {
      totalControls: controls.length,
      blockedControls: blockedControls.length,
      disabledControls: disabledControls.length,
      disabledRequiredActions: lifecycle.disabledActions?.required?.length
        || diagnosticLifecycle.capabilityControls?.disabledRequiredActions?.length
        || 0,
      schedulePaused: lifecycle.schedule?.paused === true || diagnosticLifecycle.schedule?.paused === true
    },
    clientPatch: {
      ...(operatorControls.clientPatch || {}),
      ...(lifecycle.statePatch || {}),
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-lifecycle-state-key",
      resumeFromLifecycleAction: lifecycle.nextAction || diagnosticLifecycle.nextAction || null,
      externalWritesPerformed: false
    }
  };
}

function buildLifecycleOperatorControlsArtifact(metadata, diagnostics, lifecycleControls) {
  const lifecycle = metadata.lifecycle || {};
  const source = lifecycle.operatorControls
    || diagnostics.lifecycleOperatorControls
    || diagnostics.lifecycleControls?.operatorControls
    || {};
  const stateKey = source.stateKey
    || lifecycleControls.operatorControlsStateKey
    || `${metadata.jobId}:lifecycle-operator-controls`;
  const validationSummary = source.validationSummary || {};
  const controls = Array.isArray(source.controls)
    ? source.controls
    : Array.isArray(lifecycleControls.controls)
      ? lifecycleControls.controls
      : [];
  const blockedControls = controls.filter((control) => control.status === "blocked" || control.enabled === false);
  const pendingControls = controls.filter((control) => ["waiting", "paused", "pending"].includes(control.status));
  const disabledRequiredActions = source.capabilityControls?.disabledRequiredActions
    || lifecycleControls.disabledActions?.required
    || [];
  const status = source.status
    || (blockedControls.length > 0 || disabledRequiredActions.length > 0
      ? "blocked"
      : pendingControls.length > 0 || validationSummary.warnings > 0
        ? "waiting"
        : "ready");
  const nextAction = source.nextAction
    || lifecycleControls.operatorControlsNextAction
    || (disabledRequiredActions.length > 0
      ? "enable-required-mailchimp-actions"
      : status === "waiting"
        ? "resume-lifecycle-controls"
        : lifecycleControls.nextAction || diagnostics.recovery?.nextAction || "handoff-to-runtime-adapter");
  const runtimeStartEnabled = source.runtimeStart?.enabled === true
    || lifecycleControls.runtimeStartEnabled === true && status === "ready";

  return {
    schemaVersion: "aios.mailchimp.lifecycle-operator-controls-artifact.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    stateKey,
    status,
    nextAction,
    validationSummary: {
      total: validationSummary.total || controls.length,
      blocked: validationSummary.blocked || blockedControls.length,
      warnings: validationSummary.warnings || pendingControls.length,
      schedulePaused: validationSummary.schedulePaused === true || source.schedule?.paused === true,
      operatorHoldActive: validationSummary.operatorHoldActive === true
        || (source.operatorHold?.active === true && !source.operatorHold?.releasedAt),
      blockedJobIds: validationSummary.blockedJobIds || [],
      approvalJobIds: validationSummary.approvalJobIds || [],
      issueCodes: validationSummary.issueCodes || [],
      disabledActions: validationSummary.disabledActions || source.capabilityControls?.disabledActions || []
    },
    runtimeStart: {
      enabled: runtimeStartEnabled,
      acceptedStatus: source.runtimeStart?.acceptedStatus || diagnostics.status,
      commandId: source.runtimeStart?.commandId || null
    },
    capabilityControls: {
      enabledActions: source.capabilityControls?.enabledActions || [],
      disabledActions: source.capabilityControls?.disabledActions || lifecycleControls.disabledActions?.all || [],
      disabledRequiredActions,
      disabledWriteActions: source.capabilityControls?.disabledWriteActions || lifecycleControls.disabledActions?.write || []
    },
    schedule: {
      ...(lifecycleControls.schedule || {}),
      ...(source.schedule || {})
    },
    operatorHold: source.operatorHold || {
      active: false,
      reason: "",
      releasedBy: "",
      releasedAt: ""
    },
    controls: controls.map((control) => ({
      id: control.id,
      label: control.label,
      status: control.status,
      enabled: control.enabled === true,
      required: control.required === true,
      disableReason: control.disableReason || null,
      nextAction: control.nextAction || nextAction
    })),
    clientPatch: {
      ...(source.clientPatch || {}),
      lifecycleControlsArtifact: "lifecycle-controls.json",
      lifecycleOperatorControlsStatus: status,
      lifecycleOperatorControlsNextAction: nextAction,
      lifecycleOperatorControlsStateKey: stateKey,
      runtimeStartEnabled,
      schedulePaused: source.schedule?.paused === true || lifecycleControls.schedule?.paused === true,
      disabledRequiredActions
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-lifecycle-operator-controls-state-key",
      resumeFromStateKey: stateKey,
      externalWritesPerformed: false
    }
  };
}

function buildPreviewAcceptanceArtifact(metadata, diagnostics) {
  const preview = metadata.preview || {};
  const acceptance = preview.acceptance || metadata.exports?.previewAcceptance || {};
  const receiptSource = preview.acceptanceReceipt
    || acceptance.receipt
    || metadata.dryRun?.acceptancePreview?.receipt
    || metadata.exports?.summary?.acceptanceReceipt
    || {};
  const validation = acceptance.validationSummary || {};
  const checklist = Array.isArray(acceptance.checklist) ? acceptance.checklist : [];
  const blockedItems = checklist.filter((item) => item.status === "blocked");
  const pendingItems = checklist.filter((item) => item.status === "pending" || item.status === "needs-operator-action");
  const blockingDiagnostics = validation.blockingDiagnostics || diagnostics.counts?.bySeverity?.error || 0;
  const warningDiagnostics = validation.warningDiagnostics || diagnostics.counts?.bySeverity?.warning || 0;
  const acceptedCount = validation.accepted || checklist.filter((item) => item.status === "accepted").length;
  const requiredCount = validation.required || checklist.filter((item) => item.required).length;
  const blockedCount = validation.blocked || blockedItems.length;
  const pendingCount = validation.pending || pendingItems.length;
  const receiptStatus = receiptSource.status
    || (blockedCount > 0 || blockingDiagnostics > 0
      ? "blocked"
      : pendingCount > 0
        ? "waiting"
        : acceptance.status === "accepted" || preview.status === "accepted" || acceptedCount >= requiredCount
          ? "accepted"
          : "ready");
  const receiptToken = receiptSource.acceptanceToken
    || acceptance.acceptanceToken
    || metadata.exports?.summary?.previewAcceptanceToken
    || `${metadata.jobId}:preview-acceptance`;
  const receiptId = receiptSource.id || `${metadata.jobId}:preview-acceptance:${receiptStatus}`;
  const receiptNextAction = receiptSource.nextAction
    || acceptance.nextStep
    || (receiptStatus === "blocked"
      ? "repair-preview-acceptance-blockers"
      : receiptStatus === "waiting"
        ? "collect-preview-acceptance-inputs"
        : receiptStatus === "accepted"
          ? "release-runtime-handoff"
          : "request-operator-acceptance");
  const receiptValidationRows = Array.isArray(receiptSource.validationRows)
    ? receiptSource.validationRows
    : [
      {
        code: "artifact.preview-acceptance.diagnostics",
        status: blockingDiagnostics > 0 ? "fail" : warningDiagnostics > 0 ? "pending" : "pass",
        owner: "runtime",
        nextAction: blockingDiagnostics > 0 ? "repair-preview-acceptance-blockers" : "request-operator-acceptance",
        detail: blockingDiagnostics > 0
          ? "Blocking diagnostics prevent preview acceptance."
          : warningDiagnostics > 0
            ? "Warning diagnostics should be reviewed before preview acceptance."
            : "Diagnostics do not block preview acceptance."
      },
      {
        code: "artifact.preview-acceptance.checklist",
        status: blockedCount > 0 ? "fail" : pendingCount > 0 ? "pending" : "pass",
        owner: "operator",
        nextAction: blockedCount > 0 ? "review-preview-checklist" : pendingCount > 0 ? "collect-preview-acceptance-inputs" : "release-runtime-handoff",
        detail: blockedCount > 0
          ? "Checklist contains blocked preview items."
          : pendingCount > 0
            ? "Checklist contains pending preview items."
            : "Checklist is accepted or ready."
      }
    ];

  return {
    schemaVersion: "aios.mailchimp.preview-acceptance-artifact.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    status: acceptance.status || preview.status || diagnostics.status,
    acceptanceToken: acceptance.acceptanceToken || null,
    previewEnabled: acceptance.previewEnabled === true || preview.readyForPreview === true,
    runtimeStartEnabledAfterAcceptance: acceptance.runtimeStartEnabledAfterAcceptance === true
      || preview.readyForRuntimeStart === true,
    validationSummary: {
      total: validation.total || checklist.length,
      required: requiredCount,
      accepted: acceptedCount,
      blocked: blockedCount,
      pending: pendingCount,
      warningDiagnostics,
      blockingDiagnostics,
      receiptStatus,
      receiptReady: receiptStatus === "accepted" || receiptStatus === "ready"
    },
    checklist: checklist.map((item) => ({
      id: item.id,
      label: item.label,
      status: item.status,
      required: item.required === true,
      nextAction: item.nextAction,
      evidence: item.evidence || {}
    })),
    clientPatch: acceptance.clientPatch || {},
    acceptanceReceipt: {
      schemaVersion: "aios.mailchimp.preview-acceptance-receipt.v1",
      id: receiptId,
      acceptanceToken: receiptToken,
      status: receiptStatus,
      accepted: receiptStatus === "accepted",
      readyForRuntimeStart: receiptStatus === "accepted"
        && (acceptance.runtimeStartEnabledAfterAcceptance === true || preview.readyForRuntimeStart === true),
      nextAction: receiptNextAction,
      validationSummary: receiptSource.validationSummary || {
        total: receiptValidationRows.length,
        passed: receiptValidationRows.filter((row) => row.status === "pass").length,
        blocked: receiptValidationRows.filter((row) => row.status === "fail").length,
        pending: receiptValidationRows.filter((row) => row.status === "pending").length,
        blockedJobIds: validation.blockedJobIds || [],
        degradedJobIds: validation.degradedJobIds || [],
        missingInputNames: validation.missingInputNames || []
      },
      validationRows: receiptValidationRows,
      clientPatch: {
        ...(receiptSource.clientPatch || {}),
        previewAcceptanceReceiptId: receiptId,
        previewAcceptanceToken: receiptToken,
        previewAcceptanceReceiptStatus: receiptStatus,
        previewAcceptanceNextAction: receiptNextAction
      },
      restartSemantics: {
        replaySafe: receiptSource.restartSemantics?.replaySafe !== false,
        duplicateCommandPolicy: receiptSource.restartSemantics?.duplicateCommandPolicy || "dedupe-by-preview-acceptance-token",
        resumeFromAcceptanceToken: receiptSource.restartSemantics?.resumeFromAcceptanceToken || receiptToken,
        externalWritesPerformed: false
      }
    },
    explainNextStep: preview.explainNextStep || {
      action: receiptNextAction || acceptance.nextStep || diagnostics.recovery?.nextAction || "handoff-to-runtime-adapter",
      reason: blockedItems.length > 0
        ? "preview-blocked"
        : pendingItems.length > 0
          ? "operator-action-pending"
          : "preview-accepted",
      resumeToken: receiptToken || metadata.exports?.summary?.resumeToken || diagnostics.statusLedger?.resumeToken || null,
      statusRevision: metadata.exports?.summary?.statusRevision || diagnostics.statusLedger?.statusRevision || null
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-acceptance-token",
      resumeFromAcceptanceToken: receiptToken,
      externalWritesPerformed: false
    }
  };
}

function buildPersistedCommandJournal(job, diagnostics) {
  const commandPlan = diagnostics.recoveryCommands || {};
  const commands = Array.isArray(commandPlan.commands) ? commandPlan.commands : [];
  return {
    schemaVersion: "aios.mailchimp.command-journal.v1",
    jobId: job.id,
    status: diagnostics.status,
    resumeToken: diagnostics.statusLedger?.resumeToken || `${job.id}:${diagnostics.status}`,
    statusRevision: diagnostics.statusLedger?.statusRevision || `${job.id}:${diagnostics.status}`,
    cursor: commandPlan.restartCursor || {
      commandId: commands[0]?.id || null,
      nextAction: diagnostics.recovery?.nextAction || "handoff-to-runtime-adapter",
      statusOnResume: diagnostics.status
    },
    commands: commands.map((command) => ({
      id: command.id,
      command: command.command,
      status: command.status,
      order: command.order,
      required: command.required,
      blocksRuntimeStart: command.blocksRuntimeStart,
      nextAction: command.nextAction,
      scope: command.scope,
      idempotencyKey: command.idempotencyKey,
      replayPolicy: command.replayPolicy,
      retryPolicy: command.retryPolicy || {
        retryable: false,
        backoffMs: 0,
        maxAttempts: 0,
        nextAction: command.nextAction,
        failureClass: "unknown"
      },
      completedByAdapter: command.completedByAdapter === true
    })),
    replay: {
      safe: commandPlan.replaySafe !== false,
      duplicateCommandPolicy: commandPlan.duplicateCommandPolicy || "dedupe-by-idempotency-key",
      externalWritesPerformed: false
    }
  };
}

function buildPersistedStatusSnapshot(job, diagnostics, metadata) {
  const ledger = diagnostics.statusLedger || {};
  const health = metadata.health || {};
  return {
    schemaVersion: "aios.mailchimp.persisted-status.v1",
    provider: "mailchimp",
    jobId: job.id,
    task: job.task,
    status: diagnostics.status,
    runtimeAdapter: metadata.runtimeAdapter,
    statusRevision: ledger.statusRevision || `${job.id}:${diagnostics.status}`,
    readinessStatus: ledger.readinessStatus || metadata.runtime?.readinessStatus || diagnostics.status,
    resumeToken: ledger.resumeToken || health.statusHandoff?.idempotencyKey || `${job.id}:${diagnostics.status}`,
    acceptedForRuntime: ledger.acceptedForRuntime === true,
    acceptedForClientPreview: ledger.acceptedForClientPreview !== false,
    canStartRuntime: ledger.canStartRuntime === true,
    persistedAtPhase: ledger.persistedAtPhase || "compile-recovery",
    healthLevel: health.level || "unknown",
    degradedMode: health.degradedMode === true,
    blockingDiagnosticCount: ledger.blockingDiagnosticCount || diagnostics.counts?.bySeverity?.error || 0,
    warningDiagnosticCount: ledger.warningDiagnosticCount || diagnostics.counts?.bySeverity?.warning || 0,
    failureState: {
      mode: diagnostics.failureState?.mode || "unknown",
      queueLength: diagnostics.failureState?.summary?.total || 0,
      blocking: diagnostics.failureState?.summary?.blocking || 0,
      retryable: diagnostics.failureState?.summary?.retryable || 0,
      nextRetry: diagnostics.failureState?.nextRetry || null,
      adapterHandoff: diagnostics.failureState?.adapterHandoff || null
    },
    restartSafe: ledger.restartSafe || {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-idempotency-key",
      resumeFromCommandId: null,
      resumeAction: diagnostics.recovery?.nextAction || "handoff-to-runtime-adapter",
      externalWritesPerformed: false
    }
  };
}

function buildPersistedState(job, diagnostics, metadata) {
  const requiredActions = diagnostics.nextActions.filter((action) => action.required);
  const health = metadata.health || {};
  const commandJournal = buildPersistedCommandJournal(job, diagnostics);
  const statusSnapshot = buildPersistedStatusSnapshot(job, diagnostics, metadata);
  const previewAcceptance = buildPreviewAcceptanceArtifact(metadata, diagnostics);
  const clientWorkflow = buildClientWorkflowArtifact(metadata, diagnostics);
  const clientRuntimeAdoption = buildClientRuntimeAdoptionArtifact(metadata, diagnostics);
  const lifecycleControls = buildLifecycleControlsArtifact(metadata, diagnostics);
  const providerServiceHandoff = buildProviderServiceHandoffArtifact(metadata, diagnostics);
  const providerReleaseReadiness = buildProviderReleaseReadinessArtifact(metadata, diagnostics, providerServiceHandoff);
  const tenantAuditHandoff = buildTenantAuditHandoffArtifact(metadata, diagnostics);
  const tenantBoundaryMatrix = buildTenantBoundaryMatrixArtifact(metadata, diagnostics, tenantAuditHandoff);
  const clientCommandLeases = buildClientCommandLeasesArtifact(metadata, diagnostics);
  const clientCommandLeaseReplay = buildClientCommandLeaseReplayArtifact(metadata, diagnostics, clientCommandLeases);
  const commandLeaseReplayExport = buildCommandLeaseReplayExportArtifact(metadata, diagnostics, clientCommandLeaseReplay);
  const lifecycleOperatorControls = buildLifecycleOperatorControlsArtifact(metadata, diagnostics, lifecycleControls);
  const runtimeReleaseDecision = buildRuntimeReleaseDecisionArtifact(metadata, diagnostics, {
    providerReleaseReadiness,
    tenantAuditHandoff,
    previewAcceptance,
    commandLeaseReplayExport,
    lifecycleOperatorControls
  });
  const dryRunAnalyticsExport = buildDryRunAnalyticsExportArtifact(metadata, diagnostics, {
    tenantBoundaryMatrix,
    commandLeaseReplayExport,
    providerReleaseReadiness,
    lifecycleOperatorControls
  });
  const operationalRunbook = buildOperationalRunbookArtifact(metadata, diagnostics, {
    lifecycleControls,
    providerServiceHandoff,
    tenantAuditHandoff,
    clientWorkflow,
    clientCommandLeases,
    clientCommandLeaseReplay
  });
  return {
    kind: "aios.mailchimp.persistedRuntimeState",
    schemaVersion: "aios.mailchimp.persisted-state.v1",
    provider: "mailchimp",
    jobId: job.id,
    task: job.task,
    status: diagnostics.status,
    runtimeAdapter: metadata.runtimeAdapter,
    idempotencyKey: health.statusHandoff?.idempotencyKey
      || diagnostics.clientWorkflow?.statePatch?.idempotencyKey
      || `${job.id}:${diagnostics.status}`,
    resumeToken: statusSnapshot.resumeToken,
    statusRevision: statusSnapshot.statusRevision,
    clientState: diagnostics.clientWorkflow?.statePatch || {},
    clientWorkflow: {
      artifactName: "client-workflow.json",
      status: clientWorkflow.status,
      phase: clientWorkflow.phase,
      primaryAction: clientWorkflow.primaryAction,
      validationSummary: clientWorkflow.validationSummary,
      nextAction: clientWorkflow.explainNextStep.action,
      scopedWorkflowId: clientWorkflow.clientPatch.scopedWorkflowId || null,
      tenantIsolationKey: clientWorkflow.tenant.isolationKey || null
    },
    clientRuntimeAdoption: {
      artifactName: "client-runtime-adoption.json",
      adoptionId: clientRuntimeAdoption.adoptionId,
      status: clientRuntimeAdoption.status,
      readyForClientRuntime: clientRuntimeAdoption.readyForClientRuntime,
      nextAction: clientRuntimeAdoption.nextAction,
      missingStateKeys: clientRuntimeAdoption.missingStateKeys,
      pendingAckKeys: clientRuntimeAdoption.commandAck.pendingKeys,
      resumeToken: clientRuntimeAdoption.resume.resumeToken
    },
    lifecycleState: metadata.lifecycle || {},
    statusRecovery: {
      artifactName: "status-recovery-bundle.json",
      state: metadata.statusRecovery?.state || diagnostics.statusRecoveryBundle?.state || "unknown",
      readyForRuntimeResume: metadata.statusRecovery?.readyForRuntimeResume === true,
      nextAction: metadata.statusRecovery?.nextAction
        || diagnostics.statusRecoveryBundle?.nextAction
        || diagnostics.recovery?.nextAction,
      resumeToken: metadata.statusRecovery?.resume?.resumeToken
        || diagnostics.statusRecoveryBundle?.resume?.resumeToken
        || statusSnapshot.resumeToken,
      statusRevision: metadata.statusRecovery?.resume?.statusRevision
        || diagnostics.statusRecoveryBundle?.resume?.statusRevision
        || statusSnapshot.statusRevision,
      missingRequiredCheckpoints: metadata.statusRecovery?.blocking?.missingRequiredCheckpoints
        || diagnostics.statusRecoveryBundle?.blocking?.missingRequiredCheckpoints
        || []
    },
    statusSnapshot,
    commandJournal,
    failureState: diagnostics.failureState || {
      schemaVersion: "aios.mailchimp.failure-state.v1",
      provider: "mailchimp",
      jobId: job.id,
      status: diagnostics.status,
      mode: "unknown",
      queue: [],
      summary: {
        total: 0,
        blocking: 0,
        retryable: 0,
        nonRetryable: 0,
        errorDiagnostics: 0,
        warningDiagnostics: 0
      },
      nextRetry: null,
      adapterHandoff: null
    },
    providerServiceHandoff: {
      artifactName: "provider-service-handoff.json",
      status: providerServiceHandoff.status,
      providerService: providerServiceHandoff.providerService,
      handoffReady: providerServiceHandoff.externalHandoff.ready,
      idempotencyKey: providerServiceHandoff.externalHandoff.idempotencyKey,
      syncHandoffReady: providerServiceHandoff.syncMetadata.syncHandoffReady,
      unnegotiatedCapabilities: providerServiceHandoff.capabilityNegotiation.unnegotiated,
      nextAction: providerServiceHandoff.clientPatch.nextAction
    },
    providerReleaseReadiness: {
      artifactName: "provider-release-readiness.json",
      releaseContractId: providerReleaseReadiness.releaseContractId,
      status: providerReleaseReadiness.status,
      ready: providerReleaseReadiness.ready,
      nextAction: providerReleaseReadiness.nextAction,
      syncReady: providerReleaseReadiness.sync.ready,
      lifecycleReady: providerReleaseReadiness.releaseGates.lifecycleReady,
      tenantReady: providerReleaseReadiness.releaseGates.tenantReady,
      capabilitiesReady: providerReleaseReadiness.releaseGates.capabilitiesReady,
      missingCapabilities: providerReleaseReadiness.capabilityNegotiation.missing,
      blockedJobIds: providerReleaseReadiness.validationSummary.blockedJobIds,
      waitingJobIds: providerReleaseReadiness.validationSummary.waitingJobIds
    },
    runtimeReleaseDecision: {
      artifactName: "runtime-release-decision.json",
      releaseToken: runtimeReleaseDecision.releaseToken,
      state: runtimeReleaseDecision.state,
      ready: runtimeReleaseDecision.ready,
      accepted: runtimeReleaseDecision.accepted,
      visibleStatus: runtimeReleaseDecision.visibleStatus,
      nextAction: runtimeReleaseDecision.nextAction,
      owner: runtimeReleaseDecision.owner,
      releaseCommandId: runtimeReleaseDecision.releaseCommand.commandId,
      blockedGateIds: runtimeReleaseDecision.clientPatch.runtimeReleaseBlockedGateIds,
      waitingGateIds: runtimeReleaseDecision.clientPatch.runtimeReleaseWaitingGateIds
    },
    tenantAuditHandoff: {
      artifactName: "tenant-audit-handoff.json",
      status: tenantAuditHandoff.status,
      safeBoundary: tenantAuditHandoff.safeBoundary,
      isolationKey: tenantAuditHandoff.isolationKey,
      tenantId: tenantAuditHandoff.scope.tenantId,
      workspaceId: tenantAuditHandoff.scope.workspaceId,
      blockedJobIds: tenantAuditHandoff.permissions.blockedJobIds,
      approvalJobIds: tenantAuditHandoff.permissions.approvalJobIds,
      missingScopes: tenantAuditHandoff.permissions.missing,
      nextAction: tenantAuditHandoff.handoff.nextAction
    },
    tenantBoundaryMatrix: {
      artifactName: "tenant-boundary-matrix.json",
      status: tenantBoundaryMatrix.status,
      exportReady: tenantBoundaryMatrix.exportReady,
      isolationKey: tenantBoundaryMatrix.isolationKey,
      nextAction: tenantBoundaryMatrix.audit.nextAction,
      blockedJobIds: tenantBoundaryMatrix.exportSummary.blockedJobIds,
      approvalJobIds: tenantBoundaryMatrix.exportSummary.approvalJobIds,
      missingScopes: tenantBoundaryMatrix.exportSummary.missingScopes,
      historySnapshotIds: tenantBoundaryMatrix.analytics.historySnapshotIds
    },
    clientCommandLeases: {
      artifactName: "client-command-leases.json",
      status: clientCommandLeases.leaseStatus,
      primaryLeaseId: clientCommandLeases.primaryLeaseId,
      primaryAction: clientCommandLeases.primaryAction,
      resumeToken: clientCommandLeases.resumeToken,
      ackRequired: clientCommandLeases.ack.required,
      ackRequiredCount: clientCommandLeases.ack.requiredCount,
      nextAckKey: clientCommandLeases.ack.nextAckKey
    },
    clientCommandLeaseReplay: {
      artifactName: "client-command-lease-replay.json",
      status: clientCommandLeaseReplay.status,
      ready: clientCommandLeaseReplay.ready,
      replaySafe: clientCommandLeaseReplay.replay.safe,
      primaryLeaseId: clientCommandLeaseReplay.primaryLeaseId,
      primaryAction: clientCommandLeaseReplay.primaryAction,
      resumeToken: clientCommandLeaseReplay.resumeToken,
      ackRequired: clientCommandLeaseReplay.ack.required,
      ackRequiredCount: clientCommandLeaseReplay.ack.requiredCount,
      blockingCount: clientCommandLeaseReplay.counts.blocking,
      nextAckKey: clientCommandLeaseReplay.ack.nextAckKey
    },
    operationalRunbook: {
      artifactName: "operational-runbook.json",
      state: operationalRunbook.state,
      owner: operationalRunbook.owner,
      nextAction: operationalRunbook.nextAction,
      retryable: operationalRunbook.retry.retryable,
      nextBackoffMs: operationalRunbook.retry.nextBackoffMs,
      blockers: operationalRunbook.counters.blockers,
      warnings: operationalRunbook.counters.warnings
    },
    dryRunAnalyticsExport: {
      artifactName: "dry-run-analytics-export.json",
      status: dryRunAnalyticsExport.status,
      exportReady: dryRunAnalyticsExport.exportReady,
      nextAction: dryRunAnalyticsExport.nextAction,
      historySnapshots: dryRunAnalyticsExport.counters.historySnapshots,
      timelineEvents: dryRunAnalyticsExport.counters.timelineEvents,
      blockerCodes: dryRunAnalyticsExport.exportSummary.blockerCodes,
      warningCodes: dryRunAnalyticsExport.exportSummary.warningCodes
    },
    health: {
      level: health.level || "unknown",
      degradedMode: health.degradedMode === true,
      degradedReasons: health.degradedReasons || [],
      retry: health.retry || {
        retryable: false,
        backoffMs: 0,
        maxAttempts: 0,
        nextAction: diagnostics.recovery?.nextAction || "emit-diagnostics",
        reason: "metadata-health-missing"
      }
    },
    recoveryCursor: {
      nextAction: commandJournal.cursor.nextAction || diagnostics.recovery?.nextAction || "handoff-to-runtime-adapter",
      commandId: commandJournal.cursor.commandId,
      failureId: diagnostics.failureState?.adapterHandoff?.resumeFromFailureId || null,
      resumeToken: statusSnapshot.resumeToken,
      requiredActionIds: requiredActions.map((action) => action.id),
      requiredArtifactNames: [
        "job-descriptor.json",
        "runtime-handoff.json",
        "diagnostics.json",
      "permission-boundary.json",
      "runtime-release-decision.json",
      "provider-release-readiness.json",
      "tenant-audit-handoff.json",
      "tenant-boundary-matrix.json",
      "dry-run-analytics-export.json",
      "client-command-leases.json",
        "client-command-lease-replay.json",
        "operational-runbook.json",
        "metadata.json",
        "failure-state.json"
      ]
    },
    adapterRecovery: {
      schemaVersion: "aios.mailchimp.adapter-recovery.v1",
      queueArtifact: "failure-state.json",
      commandJournalArtifact: "command-journal.json",
      clientCommandLeasesArtifact: "client-command-leases.json",
      commandLeaseResumeToken: clientCommandLeases.resumeToken,
      clientCommandLeaseReplayArtifact: "client-command-lease-replay.json",
      commandLeaseReplayResumeToken: clientCommandLeaseReplay.resumeToken,
      commandLeaseReplaySafe: clientCommandLeaseReplay.replay.safe,
      operationalRunbookArtifact: "operational-runbook.json",
      operationalRunbookState: operationalRunbook.state,
      operationalRunbookNextAction: operationalRunbook.nextAction,
      dryRunAnalyticsExportArtifact: "dry-run-analytics-export.json",
      dryRunAnalyticsExportReady: dryRunAnalyticsExport.exportReady,
      dryRunAnalyticsExportStatus: dryRunAnalyticsExport.status,
      dryRunAnalyticsExportNextAction: dryRunAnalyticsExport.nextAction,
      runtimeReleaseDecisionArtifact: "runtime-release-decision.json",
      runtimeReleaseReady: runtimeReleaseDecision.ready,
      runtimeReleaseState: runtimeReleaseDecision.state,
      runtimeReleaseNextAction: runtimeReleaseDecision.nextAction,
      runtimeReleaseToken: runtimeReleaseDecision.releaseToken,
      statusSnapshotArtifact: "status-snapshot.json",
      retryable: diagnostics.failureState?.summary?.retryable || 0,
      blocking: diagnostics.failureState?.summary?.blocking || 0,
      nextRetry: diagnostics.failureState?.nextRetry || null,
      degradedMode: diagnostics.failureState?.adapterHandoff?.degradedMode === true,
      nextAction: diagnostics.failureState?.adapterHandoff?.nextAction
        || commandJournal.cursor.nextAction
        || runtimeReleaseDecision.nextAction
        || providerReleaseReadiness.nextAction
        || clientCommandLeases.primaryAction
        || diagnostics.recovery?.nextAction
        || "handoff-to-runtime-adapter"
    },
    previewAcceptance: {
      artifactName: "preview-acceptance.json",
      status: previewAcceptance.status,
      acceptanceToken: previewAcceptance.acceptanceToken,
      previewEnabled: previewAcceptance.previewEnabled,
      runtimeStartEnabledAfterAcceptance: previewAcceptance.runtimeStartEnabledAfterAcceptance,
      validationSummary: previewAcceptance.validationSummary,
      nextAction: previewAcceptance.explainNextStep.action,
      receipt: {
        id: previewAcceptance.acceptanceReceipt.id,
        status: previewAcceptance.acceptanceReceipt.status,
        acceptanceToken: previewAcceptance.acceptanceReceipt.acceptanceToken,
        accepted: previewAcceptance.acceptanceReceipt.accepted,
        readyForRuntimeStart: previewAcceptance.acceptanceReceipt.readyForRuntimeStart,
        nextAction: previewAcceptance.acceptanceReceipt.nextAction,
        validationSummary: previewAcceptance.acceptanceReceipt.validationSummary
      }
    },
    lifecycleControls: {
      artifactName: "lifecycle-controls.json",
      status: metadata.lifecycle?.status || diagnostics.lifecycleControls?.status || "unknown",
      nextAction: metadata.lifecycle?.nextAction || diagnostics.lifecycleControls?.nextAction || diagnostics.recovery?.nextAction,
      runtimeStartEnabled: metadata.lifecycle?.runtimeStartEnabled === true,
      previewEnabled: metadata.lifecycle?.previewEnabled === true,
      schedule: metadata.lifecycle?.schedule || diagnostics.lifecycleControls?.schedule || {},
      disabledActions: metadata.lifecycle?.disabledActions || {},
      operatorControlsArtifact: "lifecycle-operator-controls.json",
      operatorControlsStatus: lifecycleOperatorControls.status,
      operatorControlsNextAction: lifecycleOperatorControls.nextAction,
      operatorControlsStateKey: lifecycleOperatorControls.stateKey,
      disabledRequiredActions: lifecycleOperatorControls.capabilityControls.disabledRequiredActions
    },
    lifecycleOperatorControls: {
      artifactName: "lifecycle-operator-controls.json",
      status: lifecycleOperatorControls.status,
      nextAction: lifecycleOperatorControls.nextAction,
      stateKey: lifecycleOperatorControls.stateKey,
      runtimeStartEnabled: lifecycleOperatorControls.runtimeStart.enabled,
      schedulePaused: lifecycleOperatorControls.schedule?.paused === true,
      operatorHoldActive: lifecycleOperatorControls.operatorHold?.active === true
        && !lifecycleOperatorControls.operatorHold?.releasedAt,
      disabledRequiredActions: lifecycleOperatorControls.capabilityControls.disabledRequiredActions,
      validationSummary: lifecycleOperatorControls.validationSummary
    },
    restartSemantics: {
      replaySafe: true,
      externalWritesPerformed: false,
      resumeFrom: commandJournal.cursor.commandId || requiredActions[0]?.id || "runtime-handoff",
      statusRevision: statusSnapshot.statusRevision,
      duplicateCommandPolicy: commandJournal.replay.duplicateCommandPolicy
    },
    truthBoundary: {
      source: "artifact-emitter",
      deterministic: true,
      externalMailchimpStateVerified: false
    }
  };
}

function buildStatusRecoveryBundleArtifact(metadata, diagnostics, persistedState) {
  const summary = metadata.statusRecovery || {};
  const diagnosticBundle = diagnostics.statusRecoveryBundle || {};
  const resume = summary.resume || diagnosticBundle.resume || {};
  const blocking = summary.blocking || diagnosticBundle.blocking || {};
  const checkpoints = Array.isArray(summary.checkpoints) && summary.checkpoints.length > 0
    ? summary.checkpoints
    : Array.isArray(diagnosticBundle.checkpoints)
      ? diagnosticBundle.checkpoints
      : [];
  const missingRequired = Array.isArray(blocking.missingRequiredCheckpoints)
    ? blocking.missingRequiredCheckpoints
    : checkpoints
      .filter((checkpoint) => checkpoint.required && checkpoint.ready !== true)
      .map((checkpoint) => checkpoint.phase);
  const state = missingRequired.length > 0
    ? "blocked"
    : summary.state || diagnosticBundle.state || "unknown";
  const nextAction = summary.nextAction
    || diagnosticBundle.nextAction
    || persistedState.recoveryCursor?.nextAction
    || diagnostics.recovery?.nextAction
    || "repair-status-recovery";
  const resumeToken = resume.resumeToken
    || persistedState.resumeToken
    || diagnostics.statusLedger?.resumeToken
    || `${metadata.jobId}:${state}`;
  const statusRevision = resume.statusRevision
    || persistedState.statusRevision
    || diagnostics.statusLedger?.statusRevision
    || `${metadata.jobId}:${state}`;
  const readyForRuntimeResume = summary.readyForRuntimeResume === true
    && missingRequired.length === 0
    && state === "ready";

  return {
    schemaVersion: "aios.mailchimp.status-recovery-bundle-artifact.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    state,
    readyForRuntimeResume,
    nextAction: readyForRuntimeResume ? "handoff-to-runtime-adapter" : nextAction,
    resume: {
      resumeToken,
      statusRevision,
      statusOnResume: resume.statusOnResume || diagnostics.status,
      resumeFromCommandId: resume.resumeFromCommandId || persistedState.commandJournal?.cursor?.commandId || null,
      resumeFromLeaseId: resume.resumeFromLeaseId || persistedState.commandLeaseResumeToken || null,
      resumeFromFailureId: resume.resumeFromFailureId || diagnostics.failureState?.adapterHandoff?.resumeFromFailureId || null
    },
    checkpoints: checkpoints.map((checkpoint, index) => ({
      order: index + 1,
      phase: checkpoint.phase,
      required: checkpoint.required === true,
      ready: checkpoint.ready === true,
      cursor: checkpoint.cursor || null,
      nextAction: checkpoint.nextAction || nextAction
    })),
    counters: {
      commands: summary.counters?.commands || diagnosticBundle.counters?.commands || persistedState.commandJournal?.commands?.length || 0,
      leases: summary.counters?.leases || diagnosticBundle.counters?.leases || 0,
      failureQueue: summary.counters?.failureQueue || diagnosticBundle.counters?.failureQueue || diagnostics.failureState?.summary?.total || 0,
      blockingCommands: summary.counters?.blockingCommands || diagnosticBundle.counters?.blockingCommands || 0,
      blockingLeases: summary.counters?.blockingLeases || diagnosticBundle.counters?.blockingLeases || 0,
      retryableFailures: summary.counters?.retryableFailures || diagnosticBundle.counters?.retryableFailures || 0,
      missingRequiredCheckpoints: missingRequired.length
    },
    blocking: {
      commandIds: blocking.commandIds || [],
      leaseIds: blocking.leaseIds || [],
      missingRequiredCheckpoints: missingRequired,
      adapterMode: blocking.adapterMode || diagnostics.failureState?.mode || "unknown"
    },
    clientPatch: {
      ...(summary.clientPatch || diagnosticBundle.clientPatch || {}),
      statusRecoveryArtifact: "status-recovery-bundle.json",
      statusRecoveryState: state,
      statusRecoveryReady: readyForRuntimeResume,
      statusRecoveryNextAction: readyForRuntimeResume ? "handoff-to-runtime-adapter" : nextAction,
      statusRecoveryResumeToken: resumeToken,
      statusRecoveryRevision: statusRevision
    },
    restartSemantics: {
      replaySafe: summary.restartSemantics?.replaySafe === true
        || diagnosticBundle.restartSemantics?.replaySafe === true,
      duplicateCommandPolicy: summary.restartSemantics?.duplicateCommandPolicy
        || diagnosticBundle.restartSemantics?.duplicateCommandPolicy
        || persistedState.restartSemantics?.duplicateCommandPolicy
        || "dedupe-by-idempotency-key",
      staleStatusPolicy: summary.restartSemantics?.staleStatusPolicy
        || diagnosticBundle.restartSemantics?.staleStatusPolicy
        || persistedState.statusSnapshot?.restartSafe?.staleStatusPolicy
        || {},
      externalWritesPerformed: false
    }
  };
}

export function emitMailchimpArtifacts(source = {}, options = {}) {
  const job = compileIfNeeded(source, options);
  const diagnostics = emitMailchimpDiagnostics(job, options);
  const metadata = emitMailchimpMetadata(job, options);
  const runtimeHandoff = job.contracts?.runtimeHandoffPlan || {};
  const persistedState = buildPersistedState(job, diagnostics, metadata);
  const statusRecoveryBundle = buildStatusRecoveryBundleArtifact(metadata, diagnostics, persistedState);
  const previewAcceptance = buildPreviewAcceptanceArtifact(metadata, diagnostics);
  const clientWorkflow = buildClientWorkflowArtifact(metadata, diagnostics);
  const clientRuntimeAdoption = buildClientRuntimeAdoptionArtifact(metadata, diagnostics);
  const lifecycleControls = buildLifecycleControlsArtifact(metadata, diagnostics);
  const providerServiceHandoff = buildProviderServiceHandoffArtifact(metadata, diagnostics);
  const providerReleaseReadiness = buildProviderReleaseReadinessArtifact(metadata, diagnostics, providerServiceHandoff);
  const tenantAuditHandoff = buildTenantAuditHandoffArtifact(metadata, diagnostics);
  const tenantBoundaryMatrix = buildTenantBoundaryMatrixArtifact(metadata, diagnostics, tenantAuditHandoff);
  const clientCommandLeases = buildClientCommandLeasesArtifact(metadata, diagnostics);
  const clientCommandLeaseReplay = buildClientCommandLeaseReplayArtifact(metadata, diagnostics, clientCommandLeases);
  const commandLeaseReplayExport = buildCommandLeaseReplayExportArtifact(metadata, diagnostics, clientCommandLeaseReplay);
  const lifecycleOperatorControls = buildLifecycleOperatorControlsArtifact(metadata, diagnostics, lifecycleControls);
  const runtimeReleaseDecision = buildRuntimeReleaseDecisionArtifact(metadata, diagnostics, {
    providerReleaseReadiness,
    tenantAuditHandoff,
    previewAcceptance,
    commandLeaseReplayExport,
    lifecycleOperatorControls
  });
  const dryRunAnalyticsExport = buildDryRunAnalyticsExportArtifact(metadata, diagnostics, {
    tenantBoundaryMatrix,
    commandLeaseReplayExport,
    providerReleaseReadiness,
    lifecycleOperatorControls
  });
  const operationalRunbook = buildOperationalRunbookArtifact(metadata, diagnostics, {
    lifecycleControls,
    providerServiceHandoff,
    tenantAuditHandoff,
    clientWorkflow,
    clientCommandLeases,
    clientCommandLeaseReplay
  });
  const exportSummary = {
    ...(metadata.exports?.summary || {}),
      schemaVersion: "aios.mailchimp.export-summary.v1",
      resumeToken: metadata.exports?.summary?.resumeToken
        || commandLeaseReplayExport.resumeToken
        || statusRecoveryBundle.resume.resumeToken
        || persistedState.resumeToken,
      statusRecoveryBundleArtifact: "status-recovery-bundle.json",
      statusRecoveryState: statusRecoveryBundle.state,
      statusRecoveryReady: statusRecoveryBundle.readyForRuntimeResume,
      statusRecoveryNextAction: statusRecoveryBundle.nextAction,
      statusRecoveryResumeToken: statusRecoveryBundle.resume.resumeToken,
      statusRecoveryBlockedCheckpoints: statusRecoveryBundle.blocking.missingRequiredCheckpoints,
      previewAcceptanceArtifact: "preview-acceptance.json",
      clientWorkflowArtifact: "client-workflow.json",
      previewAcceptanceStatus: previewAcceptance.status,
    previewAcceptanceToken: previewAcceptance.acceptanceToken,
    previewAcceptanceReceiptId: previewAcceptance.acceptanceReceipt.id,
    previewAcceptanceReceiptStatus: previewAcceptance.acceptanceReceipt.status,
    previewAcceptanceReceiptToken: previewAcceptance.acceptanceReceipt.acceptanceToken,
    previewAcceptanceReceiptNextAction: previewAcceptance.acceptanceReceipt.nextAction,
    previewAcceptanceReadyForRuntimeStart: previewAcceptance.acceptanceReceipt.readyForRuntimeStart,
    previewReady: previewAcceptance.previewEnabled,
    runtimeStartEnabledAfterAcceptance: previewAcceptance.runtimeStartEnabledAfterAcceptance,
    lifecycleControlsArtifact: "lifecycle-controls.json",
    lifecycleStatus: lifecycleControls.status,
    lifecycleRuntimeStartEnabled: lifecycleControls.runtimeStartEnabled,
    lifecycleSchedulePaused: lifecycleControls.schedule?.paused === true,
    lifecycleOperatorControlsArtifact: "lifecycle-operator-controls.json",
    lifecycleOperatorControlsReady: lifecycleOperatorControls.status === "ready",
    lifecycleOperatorControlsStatus: lifecycleOperatorControls.status,
    lifecycleOperatorControlsNextAction: lifecycleOperatorControls.nextAction,
    lifecycleOperatorControlsStateKey: lifecycleOperatorControls.stateKey,
    lifecycleDisabledRequiredActions: lifecycleOperatorControls.capabilityControls.disabledRequiredActions,
    providerServiceArtifact: "provider-service-handoff.json",
    providerServiceStatus: providerServiceHandoff.status,
    providerServiceReady: providerServiceHandoff.externalHandoff.ready,
      providerReleaseReadinessArtifact: "provider-release-readiness.json",
      providerReleaseReadinessStatus: providerReleaseReadiness.status,
      providerReleaseReadinessReady: providerReleaseReadiness.ready,
      providerReleaseReadinessNextAction: providerReleaseReadiness.nextAction,
      providerReleaseReadinessMissingCapabilities: providerReleaseReadiness.capabilityNegotiation.missing,
      providerReleaseReadinessBlockedJobs: providerReleaseReadiness.validationSummary.blockedJobIds,
      runtimeReleaseDecisionArtifact: "runtime-release-decision.json",
      runtimeReleaseState: runtimeReleaseDecision.state,
      runtimeReleaseReady: runtimeReleaseDecision.ready,
      runtimeReleaseNextAction: runtimeReleaseDecision.nextAction,
      runtimeReleaseToken: runtimeReleaseDecision.releaseToken,
      runtimeReleaseBlockedGateIds: runtimeReleaseDecision.clientPatch.runtimeReleaseBlockedGateIds,
      runtimeReleaseWaitingGateIds: runtimeReleaseDecision.clientPatch.runtimeReleaseWaitingGateIds,
      providerSyncHandoffReady: providerServiceHandoff.syncMetadata.syncHandoffReady,
      unnegotiatedProviderCapabilities: providerServiceHandoff.capabilityNegotiation.unnegotiated,
      clientWorkflowStatus: clientWorkflow.status,
      clientWorkflowAction: clientWorkflow.explainNextStep.action,
      clientRuntimeAdoptionArtifact: "client-runtime-adoption.json",
      clientRuntimeAdoptionStatus: clientRuntimeAdoption.status,
      clientRuntimeReady: clientRuntimeAdoption.readyForClientRuntime,
      clientRuntimeAdoptionNextAction: clientRuntimeAdoption.nextAction,
      clientRuntimeAdoptionId: clientRuntimeAdoption.adoptionId,
      clientCommandLeasesArtifact: "client-command-leases.json",
      clientCommandLeaseStatus: clientCommandLeases.leaseStatus,
      clientCommandAckRequired: clientCommandLeases.ack.required,
      clientCommandLeaseResumeToken: clientCommandLeases.resumeToken,
      clientCommandLeaseReplayArtifact: "client-command-lease-replay.json",
      clientCommandLeaseReplayStatus: clientCommandLeaseReplay.status,
      clientCommandLeaseReplayReady: clientCommandLeaseReplay.ready,
      clientCommandLeaseReplaySafe: clientCommandLeaseReplay.replay.safe,
      clientCommandLeaseReplayResumeToken: clientCommandLeaseReplay.resumeToken,
      clientCommandLeaseReplayAckRequired: clientCommandLeaseReplay.ack.required,
      commandLeaseReplayExportArtifact: "command-lease-replay-export.json",
      commandLeaseReplayExportReady: commandLeaseReplayExport.exportReady,
      commandLeaseReplayExportStatus: commandLeaseReplayExport.status,
      commandLeaseReplayExportNextAction: commandLeaseReplayExport.nextAction,
      commandLeaseReplayExportResumeToken: commandLeaseReplayExport.resumeToken,
      commandLeaseReplayExportBlockingCount: commandLeaseReplayExport.counters.blocking,
      commandLeaseReplayExportAckRequired: commandLeaseReplayExport.ack.required,
      operationalRunbookArtifact: "operational-runbook.json",
      operationalRunbookState: operationalRunbook.state,
      operationalRunbookOwner: operationalRunbook.owner,
      operationalRunbookNextAction: operationalRunbook.nextAction,
      operationalRunbookRetryable: operationalRunbook.retry.retryable,
      operationalRunbookNextBackoffMs: operationalRunbook.retry.nextBackoffMs,
      operationalRunbookBlockers: operationalRunbook.counters.blockers,
      operationalRunbookWarnings: operationalRunbook.counters.warnings,
      tenantAuditHandoffArtifact: "tenant-audit-handoff.json",
      tenantAuditHandoffStatus: tenantAuditHandoff.status,
      tenantAuditHandoffReady: tenantAuditHandoff.safeBoundary === true && tenantAuditHandoff.status === "ready",
      tenantAuditIsolationKey: tenantAuditHandoff.isolationKey,
      tenantAuditNextAction: tenantAuditHandoff.handoff.nextAction,
      tenantBoundaryMatrixArtifact: "tenant-boundary-matrix.json",
      tenantBoundaryMatrixStatus: tenantBoundaryMatrix.status,
      tenantBoundaryMatrixReady: tenantBoundaryMatrix.exportReady,
      tenantBoundaryMatrixNextAction: tenantBoundaryMatrix.audit.nextAction,
      tenantBoundaryMatrixHistorySnapshotIds: tenantBoundaryMatrix.analytics.historySnapshotIds,
      tenantBoundaryMatrixBlockedJobs: tenantBoundaryMatrix.exportSummary.blockedJobIds,
      tenantBoundaryMatrixApprovalJobs: tenantBoundaryMatrix.exportSummary.approvalJobIds,
      dryRunAnalyticsExportArtifact: "dry-run-analytics-export.json",
      dryRunAnalyticsExportReady: dryRunAnalyticsExport.exportReady,
      dryRunAnalyticsExportStatus: dryRunAnalyticsExport.status,
      dryRunAnalyticsExportNextAction: dryRunAnalyticsExport.nextAction,
      dryRunAnalyticsExportHistorySnapshotIds: dryRunAnalyticsExport.exportSummary.historySnapshotIds,
      dryRunAnalyticsExportTimelineEventIds: dryRunAnalyticsExport.exportSummary.timelineEventIds,
      validationSummary: previewAcceptance.validationSummary,
      acceptanceReceipt: {
        id: previewAcceptance.acceptanceReceipt.id,
        status: previewAcceptance.acceptanceReceipt.status,
        token: previewAcceptance.acceptanceReceipt.acceptanceToken,
        nextAction: previewAcceptance.acceptanceReceipt.nextAction,
        readyForRuntimeStart: previewAcceptance.acceptanceReceipt.readyForRuntimeStart
      },
    nextAction: tenantAuditHandoff.safeBoundary === false
      ? tenantAuditHandoff.handoff.nextAction
      : tenantBoundaryMatrix.exportReady === false
      ? tenantBoundaryMatrix.audit.nextAction
      : commandLeaseReplayExport.exportReady === false
      ? commandLeaseReplayExport.nextAction
      : dryRunAnalyticsExport.exportReady === false
      ? dryRunAnalyticsExport.nextAction
      : lifecycleOperatorControls.status === "blocked"
      ? lifecycleOperatorControls.nextAction
      : runtimeReleaseDecision.ready === false
      ? runtimeReleaseDecision.nextAction
      : providerReleaseReadiness.ready === false
      ? providerReleaseReadiness.nextAction
      : providerServiceHandoff.externalHandoff.ready === false
      ? providerServiceHandoff.clientPatch.nextAction
      : clientRuntimeAdoption.readyForClientRuntime === false
      ? clientRuntimeAdoption.nextAction
      : lifecycleControls.nextAction || previewAcceptance.explainNextStep.action
  };
  const artifacts = [
    artifactRecord(job.id, "job-descriptor.json", "application/vnd.aios.mailchimp.job+json", job, {
      role: "kernel-job-descriptor",
      target: "kernel",
      recoveryAction: "recompile-job-descriptor"
    }),
    artifactRecord(job.id, "runtime-handoff.json", "application/vnd.aios.mailchimp.runtime-handoff+json", runtimeHandoff, {
      role: "adapter-status-handoff",
      target: job.runtimeAdapter?.id || "mailchimp.campaignRuntimeAdapter",
      recoveryAction: "refresh-runtime-handoff"
    }),
    artifactRecord(job.id, "diagnostics.json", "application/vnd.aios.mailchimp.diagnostics+json", diagnostics, {
      role: "operator-diagnostics",
      target: "operator-console",
      required: diagnostics.counts.bySeverity.error > 0,
      recoveryAction: diagnostics.recovery.nextAction
    }),
    artifactRecord(job.id, "failure-state.json", "application/vnd.aios.mailchimp.failure-state+json", diagnostics.failureState || {}, {
      role: "adapter-failure-retry-queue",
      target: job.runtimeAdapter?.id || "mailchimp.campaignRuntimeAdapter",
      required: true,
      recoveryAction: diagnostics.failureState?.adapterHandoff?.nextAction || diagnostics.recovery.nextAction
    }),
    artifactRecord(job.id, "permission-boundary.json", "application/vnd.aios.mailchimp.permission-boundary+json", diagnostics.permissionBoundary || {}, {
      role: "tenant-permission-boundary",
      target: job.runtimeAdapter?.id || "mailchimp.campaignRuntimeAdapter",
      required: true,
      recoveryAction: diagnostics.permissionBoundary?.nextAction || "repair-permission-boundary"
    }),
    artifactRecord(job.id, "provider-service-handoff.json", "application/vnd.aios.mailchimp.provider-service-handoff+json", providerServiceHandoff, {
      role: "provider-service-handoff",
      target: job.runtimeAdapter?.id || "mailchimp.campaignRuntimeAdapter",
      required: true,
      recoveryAction: providerServiceHandoff.clientPatch.nextAction || "repair-provider-service-handoff"
    }),
    artifactRecord(job.id, "provider-release-readiness.json", "application/vnd.aios.mailchimp.provider-release-readiness+json", providerReleaseReadiness, {
      role: "provider-release-readiness",
      target: "client-runtime",
      required: true,
      recoveryAction: providerReleaseReadiness.nextAction || "repair-provider-release-readiness"
    }),
    artifactRecord(job.id, "runtime-release-decision.json", "application/vnd.aios.mailchimp.runtime-release-decision+json", runtimeReleaseDecision, {
      role: "client-runtime-release-decision",
      target: "client-runtime",
      required: true,
      recoveryAction: runtimeReleaseDecision.nextAction || "review-runtime-release-decision"
    }),
    artifactRecord(job.id, "tenant-audit-handoff.json", "application/vnd.aios.mailchimp.tenant-audit-handoff+json", tenantAuditHandoff, {
      role: "tenant-audit-handoff",
      target: "runtime-audit-log",
      required: true,
      recoveryAction: tenantAuditHandoff.handoff.nextAction || "repair-tenant-audit-handoff"
    }),
    artifactRecord(job.id, "tenant-boundary-matrix.json", "application/vnd.aios.mailchimp.tenant-boundary-matrix+json", tenantBoundaryMatrix, {
      role: "tenant-boundary-export-matrix",
      target: "client-preview",
      required: true,
      recoveryAction: tenantBoundaryMatrix.audit.nextAction || "repair-tenant-boundary-matrix"
    }),
    artifactRecord(job.id, "metadata.json", "application/vnd.aios.mailchimp.metadata+json", metadata, {
      role: "compile-metadata",
      target: "toolchain-health",
      recoveryAction: "regenerate-metadata"
    }),
    artifactRecord(job.id, "persisted-state.json", "application/vnd.aios.mailchimp.persisted-state+json", persistedState, {
      role: "restart-safe-runtime-state",
      target: "runtime-state-store",
      required: true,
      recoveryAction: persistedState.recoveryCursor.nextAction
    }),
    artifactRecord(job.id, "command-journal.json", "application/vnd.aios.mailchimp.command-journal+json", persistedState.commandJournal, {
      role: "restart-command-journal",
      target: "runtime-state-store",
      required: true,
      recoveryAction: persistedState.commandJournal.cursor.nextAction
    }),
    artifactRecord(job.id, "status-snapshot.json", "application/vnd.aios.mailchimp.persisted-status+json", persistedState.statusSnapshot, {
      role: "restart-status-snapshot",
      target: "runtime-state-store",
      required: true,
      recoveryAction: persistedState.statusSnapshot.restartSafe.resumeAction
    }),
    artifactRecord(job.id, "status-recovery-bundle.json", "application/vnd.aios.mailchimp.status-recovery-bundle+json", statusRecoveryBundle, {
      role: "runtime-status-recovery-bundle",
      target: job.runtimeAdapter?.id || "mailchimp.campaignRuntimeAdapter",
      required: true,
      recoveryAction: statusRecoveryBundle.nextAction || "repair-status-recovery"
    }),
    artifactRecord(job.id, "preview-acceptance.json", "application/vnd.aios.mailchimp.preview-acceptance+json", previewAcceptance, {
      role: "client-preview-acceptance",
      target: "client-preview",
      required: true,
      recoveryAction: previewAcceptance.explainNextStep.action
    }),
    artifactRecord(job.id, "client-workflow.json", "application/vnd.aios.mailchimp.client-workflow+json", clientWorkflow, {
      role: "client-workflow-status",
      target: "client-preview",
      required: true,
      recoveryAction: clientWorkflow.explainNextStep.action || "refresh-client-workflow"
    }),
    artifactRecord(job.id, "client-runtime-adoption.json", "application/vnd.aios.mailchimp.client-runtime-adoption+json", clientRuntimeAdoption, {
      role: "client-runtime-adoption",
      target: "client-runtime",
      required: true,
      recoveryAction: clientRuntimeAdoption.nextAction || "refresh-client-runtime-adoption"
    }),
    artifactRecord(job.id, "client-command-leases.json", "application/vnd.aios.mailchimp.client-command-leases+json", clientCommandLeases, {
      role: "client-runtime-command-leases",
      target: "client-runtime",
      required: true,
      recoveryAction: clientCommandLeases.primaryAction || "refresh-client-command-leases"
    }),
    artifactRecord(job.id, "client-command-lease-replay.json", "application/vnd.aios.mailchimp.client-command-lease-replay+json", clientCommandLeaseReplay, {
      role: "client-runtime-command-lease-replay",
      target: "runtime-state-store",
      required: true,
      recoveryAction: clientCommandLeaseReplay.primaryAction || "refresh-client-command-lease-replay"
    }),
    artifactRecord(job.id, "command-lease-replay-export.json", "application/vnd.aios.mailchimp.command-lease-replay-export+json", commandLeaseReplayExport, {
      role: "client-runtime-command-lease-replay-export",
      target: "client-preview",
      required: true,
      recoveryAction: commandLeaseReplayExport.nextAction || "refresh-command-lease-replay-export"
    }),
    artifactRecord(job.id, "operational-runbook.json", "application/vnd.aios.mailchimp.operational-runbook+json", operationalRunbook, {
      role: "operator-health-runbook",
      target: "operator-console",
      required: true,
      recoveryAction: operationalRunbook.nextAction || "refresh-operational-runbook"
    }),
    artifactRecord(job.id, "dry-run-analytics-export.json", "application/vnd.aios.mailchimp.dry-run-analytics-export+json", dryRunAnalyticsExport, {
      role: "dry-run-analytics-export",
      target: "operator-console",
      required: true,
      recoveryAction: dryRunAnalyticsExport.nextAction || "refresh-dry-run-analytics-export"
    }),
    artifactRecord(job.id, "lifecycle-controls.json", "application/vnd.aios.mailchimp.lifecycle-controls+json", lifecycleControls, {
      role: "client-lifecycle-controls",
      target: "client-preview",
      required: true,
      recoveryAction: lifecycleControls.nextAction || "refresh-lifecycle-controls"
    }),
    artifactRecord(job.id, "lifecycle-operator-controls.json", "application/vnd.aios.mailchimp.lifecycle-operator-controls+json", lifecycleOperatorControls, {
      role: "client-lifecycle-operator-controls",
      target: "client-preview",
      required: true,
      recoveryAction: lifecycleOperatorControls.nextAction || "refresh-lifecycle-operator-controls"
    }),
    artifactRecord(job.id, "export-summary.json", "application/vnd.aios.mailchimp.export-summary+json", exportSummary, {
      role: "client-preview-summary",
      target: "client-preview",
      required: true,
      recoveryAction: exportSummary.nextAction || "refresh-export-summary"
    })
  ];
  const summary = summarizeArtifacts(artifacts, diagnostics);

  return {
    kind: "aios.mailchimp.artifactEmission",
    provider: "mailchimp",
    jobId: job.id,
    task: job.task,
    status: summary.blocked ? "blocked" : diagnostics.status,
    artifacts,
    summary,
    handoffManifest: artifacts.map((artifact) => ({
      id: artifact.id,
      name: artifact.name,
      role: artifact.role,
      target: artifact.handoff.target,
      required: artifact.handoff.required,
      sizeBytes: artifact.sizeBytes,
      contentHash: artifact.contentHash,
      idempotencyKey: artifact.handoff.idempotencyKey
    })),
    persistedState: {
      artifactName: "persisted-state.json",
      idempotencyKey: persistedState.idempotencyKey,
      resumeToken: persistedState.resumeToken,
      statusRevision: persistedState.statusRevision,
      restartSemantics: persistedState.restartSemantics,
      recoveryCursor: persistedState.recoveryCursor,
      adapterRecovery: persistedState.adapterRecovery,
      failureStateArtifact: "failure-state.json",
      permissionBoundaryArtifact: "permission-boundary.json",
      tenantIsolationKey: diagnostics.permissionBoundary?.isolationKey || null,
      tenantAuditHandoffArtifact: "tenant-audit-handoff.json",
      tenantAuditHandoffReady: tenantAuditHandoff.safeBoundary === true && tenantAuditHandoff.status === "ready",
      tenantAuditIsolationKey: tenantAuditHandoff.isolationKey,
      tenantAuditNextAction: tenantAuditHandoff.handoff.nextAction,
      tenantBoundaryMatrixArtifact: "tenant-boundary-matrix.json",
      tenantBoundaryMatrixReady: tenantBoundaryMatrix.exportReady,
      tenantBoundaryMatrixStatus: tenantBoundaryMatrix.status,
      tenantBoundaryMatrixNextAction: tenantBoundaryMatrix.audit.nextAction,
      tenantBoundaryMatrixHistorySnapshotIds: tenantBoundaryMatrix.analytics.historySnapshotIds,
      providerServiceHandoffArtifact: "provider-service-handoff.json",
      providerServiceHandoffReady: providerServiceHandoff.externalHandoff.ready,
      providerServiceHandoffKey: providerServiceHandoff.externalHandoff.idempotencyKey,
      providerReleaseReadinessArtifact: "provider-release-readiness.json",
      providerReleaseReadinessReady: providerReleaseReadiness.ready,
      providerReleaseReadinessStatus: providerReleaseReadiness.status,
      providerReleaseReadinessNextAction: providerReleaseReadiness.nextAction,
      providerReleaseReadinessMissingCapabilities: providerReleaseReadiness.capabilityNegotiation.missing,
      runtimeReleaseDecisionArtifact: "runtime-release-decision.json",
      runtimeReleaseReady: runtimeReleaseDecision.ready,
      runtimeReleaseState: runtimeReleaseDecision.state,
      runtimeReleaseNextAction: runtimeReleaseDecision.nextAction,
      runtimeReleaseToken: runtimeReleaseDecision.releaseToken,
      runtimeReleaseBlockedGateIds: runtimeReleaseDecision.clientPatch.runtimeReleaseBlockedGateIds,
      runtimeReleaseWaitingGateIds: runtimeReleaseDecision.clientPatch.runtimeReleaseWaitingGateIds,
      commandJournalArtifact: "command-journal.json",
      statusSnapshotArtifact: "status-snapshot.json",
      statusRecoveryBundleArtifact: "status-recovery-bundle.json",
      statusRecoveryState: statusRecoveryBundle.state,
      statusRecoveryReady: statusRecoveryBundle.readyForRuntimeResume,
      statusRecoveryNextAction: statusRecoveryBundle.nextAction,
      statusRecoveryResumeToken: statusRecoveryBundle.resume.resumeToken,
      previewAcceptanceArtifact: "preview-acceptance.json",
      clientWorkflowArtifact: "client-workflow.json",
      clientWorkflowStatus: clientWorkflow.status,
      clientWorkflowAction: clientWorkflow.explainNextStep.action,
      clientRuntimeAdoptionArtifact: "client-runtime-adoption.json",
      clientRuntimeAdoptionStatus: clientRuntimeAdoption.status,
      clientRuntimeReady: clientRuntimeAdoption.readyForClientRuntime,
      clientRuntimeAdoptionNextAction: clientRuntimeAdoption.nextAction,
      clientRuntimeAdoptionId: clientRuntimeAdoption.adoptionId,
      clientCommandLeasesArtifact: "client-command-leases.json",
      clientCommandLeaseStatus: clientCommandLeases.leaseStatus,
      clientCommandAckRequired: clientCommandLeases.ack.required,
      commandLeaseResumeToken: clientCommandLeases.resumeToken,
      clientCommandLeaseReplayArtifact: "client-command-lease-replay.json",
      clientCommandLeaseReplayStatus: clientCommandLeaseReplay.status,
      clientCommandLeaseReplayReady: clientCommandLeaseReplay.ready,
      commandLeaseReplayResumeToken: clientCommandLeaseReplay.resumeToken,
      commandLeaseReplayExportArtifact: "command-lease-replay-export.json",
      commandLeaseReplayExportReady: commandLeaseReplayExport.exportReady,
      commandLeaseReplayExportNextAction: commandLeaseReplayExport.nextAction,
      operationalRunbookArtifact: "operational-runbook.json",
      operationalRunbookState: operationalRunbook.state,
      operationalRunbookNextAction: operationalRunbook.nextAction,
      operationalRunbookRetryable: operationalRunbook.retry.retryable,
      operationalRunbookNextBackoffMs: operationalRunbook.retry.nextBackoffMs,
      dryRunAnalyticsExportArtifact: "dry-run-analytics-export.json",
      dryRunAnalyticsExportReady: dryRunAnalyticsExport.exportReady,
      dryRunAnalyticsExportStatus: dryRunAnalyticsExport.status,
      dryRunAnalyticsExportNextAction: dryRunAnalyticsExport.nextAction,
      previewAcceptanceToken: previewAcceptance.acceptanceToken,
      lifecycleControlsArtifact: "lifecycle-controls.json",
      lifecycleStatus: lifecycleControls.status,
      lifecycleRuntimeStartEnabled: lifecycleControls.runtimeStartEnabled,
      lifecycleOperatorControlsArtifact: "lifecycle-operator-controls.json",
      lifecycleOperatorControlsStatus: lifecycleOperatorControls.status,
      lifecycleOperatorControlsNextAction: lifecycleOperatorControls.nextAction,
      lifecycleOperatorControlsStateKey: lifecycleOperatorControls.stateKey,
      lifecycleDisabledRequiredActions: lifecycleOperatorControls.capabilityControls.disabledRequiredActions
    },
    recovery: {
      nextAction: summary.nextAction,
      requiredArtifactNames: artifacts
        .filter((artifact) => artifact.handoff.required)
        .map((artifact) => artifact.name)
    },
    truthBoundary: {
      source: "artifact-emitter",
      deterministic: true,
      externalWrites: false,
      externalMailchimpStateVerified: false
    }
  };
}

export function assertMailchimpArtifactsReady(emission) {
  const artifacts = emission?.artifacts || [];
  const requiredMissingPayload = artifacts
    .filter((artifact) => artifact.handoff?.required && artifact.payload == null)
    .map((artifact) => artifact.name);
  const permissionBoundaryArtifact = artifacts.find((artifact) => artifact.name === "permission-boundary.json");
  const failureStateArtifact = artifacts.find((artifact) => artifact.name === "failure-state.json");
  const previewAcceptanceArtifact = artifacts.find((artifact) => artifact.name === "preview-acceptance.json");
  const clientWorkflowArtifact = artifacts.find((artifact) => artifact.name === "client-workflow.json");
  const clientRuntimeAdoptionArtifact = artifacts.find((artifact) => artifact.name === "client-runtime-adoption.json");
  const clientCommandLeasesArtifact = artifacts.find((artifact) => artifact.name === "client-command-leases.json");
  const clientCommandLeaseReplayArtifact = artifacts.find((artifact) => artifact.name === "client-command-lease-replay.json");
  const commandLeaseReplayExportArtifact = artifacts.find((artifact) => artifact.name === "command-lease-replay-export.json");
  const operationalRunbookArtifact = artifacts.find((artifact) => artifact.name === "operational-runbook.json");
  const dryRunAnalyticsExportArtifact = artifacts.find((artifact) => artifact.name === "dry-run-analytics-export.json");
  const lifecycleControlsArtifact = artifacts.find((artifact) => artifact.name === "lifecycle-controls.json");
  const lifecycleOperatorControlsArtifact = artifacts.find((artifact) => artifact.name === "lifecycle-operator-controls.json");
  const exportSummaryArtifact = artifacts.find((artifact) => artifact.name === "export-summary.json");
  const providerServiceArtifact = artifacts.find((artifact) => artifact.name === "provider-service-handoff.json");
  const providerReleaseReadinessArtifact = artifacts.find((artifact) => artifact.name === "provider-release-readiness.json");
  const runtimeReleaseDecisionArtifact = artifacts.find((artifact) => artifact.name === "runtime-release-decision.json");
  const statusRecoveryBundleArtifact = artifacts.find((artifact) => artifact.name === "status-recovery-bundle.json");
  const tenantAuditHandoffArtifact = artifacts.find((artifact) => artifact.name === "tenant-audit-handoff.json");
  const tenantBoundaryMatrixArtifact = artifacts.find((artifact) => artifact.name === "tenant-boundary-matrix.json");
  const permissionBoundaryReady = Boolean(permissionBoundaryArtifact?.payload?.isolationKey)
    && permissionBoundaryArtifact.payload?.schemaVersion === "aios.mailchimp.permission-boundary.v1";
  const failureStateReady = failureStateArtifact?.payload?.schemaVersion === "aios.mailchimp.failure-state.v1"
    && Array.isArray(failureStateArtifact.payload.queue)
    && failureStateArtifact.payload.adapterHandoff?.nextAction;
  const previewAcceptanceReady = previewAcceptanceArtifact?.payload?.schemaVersion === "aios.mailchimp.preview-acceptance-artifact.v1"
    && Boolean(previewAcceptanceArtifact.payload.acceptanceToken)
    && Array.isArray(previewAcceptanceArtifact.payload.checklist)
    && previewAcceptanceArtifact.payload.acceptanceReceipt?.schemaVersion === "aios.mailchimp.preview-acceptance-receipt.v1"
    && Boolean(previewAcceptanceArtifact.payload.acceptanceReceipt?.acceptanceToken)
    && previewAcceptanceArtifact.payload.acceptanceReceipt?.restartSemantics?.externalWritesPerformed === false;
  const clientWorkflowReady = clientWorkflowArtifact?.payload?.schemaVersion === "aios.mailchimp.client-workflow-artifact.v1"
    && Boolean(clientWorkflowArtifact.payload.explainNextStep?.action)
    && Array.isArray(clientWorkflowArtifact.payload.validationItems);
  const clientRuntimeAdoptionReady = clientRuntimeAdoptionArtifact?.payload?.schemaVersion === "aios.mailchimp.client-runtime-adoption-artifact.v1"
    && Boolean(clientRuntimeAdoptionArtifact.payload.adoptionId)
    && Boolean(clientRuntimeAdoptionArtifact.payload.nextAction)
    && clientRuntimeAdoptionArtifact.payload.restartSemantics?.externalWritesPerformed === false;
  const clientCommandLeasesReady = clientCommandLeasesArtifact?.payload?.schemaVersion === "aios.mailchimp.client-command-leases-artifact.v1"
    && Boolean(clientCommandLeasesArtifact.payload.resumeToken)
    && Array.isArray(clientCommandLeasesArtifact.payload.leases);
  const clientCommandLeaseReplayReady = clientCommandLeaseReplayArtifact?.payload?.schemaVersion === "aios.mailchimp.client-command-lease-replay-artifact.v1"
    && Boolean(clientCommandLeaseReplayArtifact.payload.resumeToken)
    && Array.isArray(clientCommandLeaseReplayArtifact.payload.rows)
    && clientCommandLeaseReplayArtifact.payload.replay?.externalWritesPerformed === false;
  const commandLeaseReplayExportReady = commandLeaseReplayExportArtifact?.payload?.schemaVersion === "aios.mailchimp.command-lease-replay-export-artifact.v1"
    && Boolean(commandLeaseReplayExportArtifact.payload.resumeToken)
    && Array.isArray(commandLeaseReplayExportArtifact.payload.rows)
    && commandLeaseReplayExportArtifact.payload.restartSemantics?.externalWritesPerformed === false
    && Boolean(commandLeaseReplayExportArtifact.payload.nextAction);
  const operationalRunbookReady = operationalRunbookArtifact?.payload?.schemaVersion === "aios.mailchimp.operational-runbook-artifact.v1"
    && Boolean(operationalRunbookArtifact.payload.nextAction)
    && Array.isArray(operationalRunbookArtifact.payload.steps)
    && operationalRunbookArtifact.payload.restartSemantics?.externalWritesPerformed === false;
  const dryRunAnalyticsExportReady = dryRunAnalyticsExportArtifact?.payload?.schemaVersion === "aios.mailchimp.dry-run-analytics-export-artifact.v1"
    && Boolean(dryRunAnalyticsExportArtifact.payload.nextAction)
    && Array.isArray(dryRunAnalyticsExportArtifact.payload.timeline)
    && Array.isArray(dryRunAnalyticsExportArtifact.payload.exportSummary?.historySnapshotIds)
    && dryRunAnalyticsExportArtifact.payload.restartSemantics?.externalWritesPerformed === false;
  const lifecycleControlsReady = lifecycleControlsArtifact?.payload?.schemaVersion === "aios.mailchimp.lifecycle-controls-artifact.v1"
    && Boolean(lifecycleControlsArtifact.payload.nextAction)
    && Array.isArray(lifecycleControlsArtifact.payload.controls);
  const lifecycleOperatorControlsReady = lifecycleOperatorControlsArtifact?.payload?.schemaVersion === "aios.mailchimp.lifecycle-operator-controls-artifact.v1"
    && Boolean(lifecycleOperatorControlsArtifact.payload.stateKey)
    && Boolean(lifecycleOperatorControlsArtifact.payload.nextAction)
    && Array.isArray(lifecycleOperatorControlsArtifact.payload.controls)
    && lifecycleOperatorControlsArtifact.payload.restartSemantics?.externalWritesPerformed === false;
  const providerServiceReady = providerServiceArtifact?.payload?.schemaVersion === "aios.mailchimp.provider-service-handoff.v1"
    && Boolean(providerServiceArtifact.payload.externalHandoff?.idempotencyKey)
    && Array.isArray(providerServiceArtifact.payload.capabilityNegotiation?.unnegotiated);
  const providerReleaseReadinessReady = providerReleaseReadinessArtifact?.payload?.schemaVersion === "aios.mailchimp.provider-release-readiness-artifact.v1"
    && Boolean(providerReleaseReadinessArtifact.payload.releaseContractId)
    && Boolean(providerReleaseReadinessArtifact.payload.nextAction)
    && Array.isArray(providerReleaseReadinessArtifact.payload.capabilityNegotiation?.missing)
    && providerReleaseReadinessArtifact.payload.externalHandoff?.externalWritesPerformed === false
    && providerReleaseReadinessArtifact.payload.restartSemantics?.externalWritesPerformed === false;
  const runtimeReleaseDecisionReady = runtimeReleaseDecisionArtifact?.payload?.schemaVersion === "aios.mailchimp.runtime-release-decision-artifact.v1"
    && Boolean(runtimeReleaseDecisionArtifact.payload.releaseToken)
    && Boolean(runtimeReleaseDecisionArtifact.payload.nextAction)
    && Array.isArray(runtimeReleaseDecisionArtifact.payload.rows)
    && runtimeReleaseDecisionArtifact.payload.releaseCommand?.externalWritesPerformed === false
    && runtimeReleaseDecisionArtifact.payload.restartSemantics?.externalWritesPerformed === false;
  const statusRecoveryBundleReady = statusRecoveryBundleArtifact?.payload?.schemaVersion === "aios.mailchimp.status-recovery-bundle-artifact.v1"
    && Boolean(statusRecoveryBundleArtifact.payload.resume?.resumeToken)
    && Boolean(statusRecoveryBundleArtifact.payload.nextAction)
    && Array.isArray(statusRecoveryBundleArtifact.payload.checkpoints)
    && statusRecoveryBundleArtifact.payload.restartSemantics?.externalWritesPerformed === false;
  const tenantAuditHandoffReady = tenantAuditHandoffArtifact?.payload?.schemaVersion === "aios.mailchimp.tenant-audit-handoff-artifact.v1"
    && Boolean(tenantAuditHandoffArtifact.payload.isolationKey)
    && tenantAuditHandoffArtifact.payload.handoff?.externalWritesPerformed === false
    && Array.isArray(tenantAuditHandoffArtifact.payload.validation)
    && Boolean(tenantAuditHandoffArtifact.payload.handoff?.nextAction);
  const tenantBoundaryMatrixReady = tenantBoundaryMatrixArtifact?.payload?.schemaVersion === "aios.mailchimp.tenant-boundary-matrix-artifact.v1"
    && Boolean(tenantBoundaryMatrixArtifact.payload.isolationKey)
    && tenantBoundaryMatrixArtifact.payload.audit?.externalWritesPerformed === false
    && Array.isArray(tenantBoundaryMatrixArtifact.payload.rows)
    && Array.isArray(tenantBoundaryMatrixArtifact.payload.historySnapshots)
    && Boolean(tenantBoundaryMatrixArtifact.payload.exportSummary?.nextAction);
  const exportSummaryReady = exportSummaryArtifact?.payload?.schemaVersion === "aios.mailchimp.export-summary.v1"
    && Boolean(exportSummaryArtifact.payload.resumeToken)
    && exportSummaryArtifact.payload.previewAcceptanceArtifact === "preview-acceptance.json"
    && Boolean(exportSummaryArtifact.payload.previewAcceptanceReceiptToken)
    && exportSummaryArtifact.payload.lifecycleOperatorControlsArtifact === "lifecycle-operator-controls.json"
    && exportSummaryArtifact.payload.providerServiceArtifact === "provider-service-handoff.json"
    && exportSummaryArtifact.payload.providerReleaseReadinessArtifact === "provider-release-readiness.json"
    && exportSummaryArtifact.payload.runtimeReleaseDecisionArtifact === "runtime-release-decision.json"
    && exportSummaryArtifact.payload.tenantAuditHandoffArtifact === "tenant-audit-handoff.json"
    && exportSummaryArtifact.payload.tenantBoundaryMatrixArtifact === "tenant-boundary-matrix.json";

  return {
    ok: emission?.provider === "mailchimp"
      && artifacts.some((artifact) => artifact.name === "persisted-state.json")
      && artifacts.some((artifact) => artifact.name === "command-journal.json")
      && artifacts.some((artifact) => artifact.name === "status-snapshot.json")
      && permissionBoundaryReady
    && failureStateReady
    && providerServiceReady
    && providerReleaseReadinessReady
    && runtimeReleaseDecisionReady
    && statusRecoveryBundleReady
    && tenantAuditHandoffReady
    && tenantBoundaryMatrixReady
      && previewAcceptanceReady
      && clientWorkflowReady
    && clientRuntimeAdoptionReady
    && clientCommandLeasesReady
    && clientCommandLeaseReplayReady
      && commandLeaseReplayExportReady
    && operationalRunbookReady
    && dryRunAnalyticsExportReady
      && lifecycleControlsReady
      && lifecycleOperatorControlsReady
      && exportSummaryReady
      && artifacts.length >= 15
      && requiredMissingPayload.length === 0,
    artifactCount: artifacts.length,
    requiredMissingPayload,
    persistedStateReady: artifacts.some((artifact) => artifact.name === "persisted-state.json"),
    commandJournalReady: artifacts.some((artifact) => artifact.name === "command-journal.json"),
    statusSnapshotReady: artifacts.some((artifact) => artifact.name === "status-snapshot.json"),
    permissionBoundaryReady,
    failureStateReady,
    providerServiceReady,
    providerReleaseReadinessReady,
    runtimeReleaseDecisionReady,
    statusRecoveryBundleReady,
    tenantAuditHandoffReady,
    tenantBoundaryMatrixReady,
    previewAcceptanceReady,
    clientWorkflowReady,
    clientRuntimeAdoptionReady,
    clientCommandLeasesReady,
    clientCommandLeaseReplayReady,
    commandLeaseReplayExportReady,
    operationalRunbookReady,
    dryRunAnalyticsExportReady,
    lifecycleControlsReady,
    lifecycleOperatorControlsReady,
    exportSummaryReady,
    nextAction: requiredMissingPayload.length
      ? "regenerate-required-artifacts"
      : permissionBoundaryReady === false
        ? "regenerate-permission-boundary-artifact"
        : failureStateReady === false
          ? "regenerate-failure-state-artifact"
          : providerServiceReady === false
            ? "regenerate-provider-service-handoff-artifact"
            : providerReleaseReadinessReady === false
              ? "regenerate-provider-release-readiness-artifact"
            : runtimeReleaseDecisionReady === false
              ? "regenerate-runtime-release-decision-artifact"
            : statusRecoveryBundleReady === false
              ? "regenerate-status-recovery-bundle-artifact"
            : tenantAuditHandoffReady === false
              ? "regenerate-tenant-audit-handoff-artifact"
            : tenantBoundaryMatrixReady === false
              ? "regenerate-tenant-boundary-matrix-artifact"
            : previewAcceptanceReady === false
            ? "regenerate-preview-acceptance-artifact"
            : clientWorkflowReady === false
              ? "regenerate-client-workflow-artifact"
            : clientRuntimeAdoptionReady === false
              ? "regenerate-client-runtime-adoption-artifact"
            : clientCommandLeasesReady === false
              ? "regenerate-client-command-leases-artifact"
            : clientCommandLeaseReplayReady === false
              ? "regenerate-client-command-lease-replay-artifact"
            : commandLeaseReplayExportReady === false
              ? "regenerate-command-lease-replay-export-artifact"
            : operationalRunbookReady === false
              ? "regenerate-operational-runbook-artifact"
            : dryRunAnalyticsExportReady === false
              ? "regenerate-dry-run-analytics-export-artifact"
            : lifecycleControlsReady === false
              ? "regenerate-lifecycle-controls-artifact"
            : lifecycleOperatorControlsReady === false
              ? "regenerate-lifecycle-operator-controls-artifact"
              : exportSummaryReady
                ? emission?.recovery?.nextAction
                : "regenerate-export-summary-artifact"
  };
}
