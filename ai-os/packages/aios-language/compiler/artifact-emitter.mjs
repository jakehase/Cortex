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
  const lifecycleRunControlArtifact = artifacts.find((artifact) => artifact.name === "lifecycle-run-control.json");
  const providerServiceArtifact = artifacts.find((artifact) => artifact.name === "provider-service-handoff.json");
  const providerSyncCheckpointArtifact = artifacts.find((artifact) => artifact.name === "provider-sync-checkpoint.json");
  const providerExportReadinessArtifact = artifacts.find((artifact) => artifact.name === "provider-export-readiness.json");
  const providerCallbackHandoffArtifact = artifacts.find((artifact) => artifact.name === "provider-callback-handoff.json");
  const providerReleaseReadinessArtifact = artifacts.find((artifact) => artifact.name === "provider-release-readiness.json");
  const providerIntegrationHandoffArtifact = artifacts.find((artifact) => artifact.name === "provider-integration-handoff.json");
  const providerIntegrationExecutionTicketArtifact = artifacts.find((artifact) => artifact.name === "provider-integration-execution-ticket.json");
  const runtimeReleaseDecisionArtifact = artifacts.find((artifact) => artifact.name === "runtime-release-decision.json");
  const runtimeReleaseControlsArtifact = artifacts.find((artifact) => artifact.name === "runtime-release-controls.json");
  const statusRecoveryBundleArtifact = artifacts.find((artifact) => artifact.name === "status-recovery-bundle.json");
  const restartCheckpointManifestArtifact = artifacts.find((artifact) => artifact.name === "restart-checkpoint-manifest.json");
  const restartReplayLedgerArtifact = artifacts.find((artifact) => artifact.name === "restart-replay-ledger.json");
  const persistedStatusEnvelopeArtifact = artifacts.find((artifact) => artifact.name === "persisted-status-envelope.json");
  const runtimeStatusReplayCursorArtifact = artifacts.find((artifact) => artifact.name === "runtime-status-replay-cursor.json");
  const dryRunAnalyticsExportArtifact = artifacts.find((artifact) => artifact.name === "dry-run-analytics-export.json");
  const diagnosticExportLedgerArtifact = artifacts.find((artifact) => artifact.name === "diagnostic-export-ledger.json");
  const previewExportReadinessArtifact = artifacts.find((artifact) => artifact.name === "preview-export-readiness.json");
  const previewAcceptanceArtifact = artifacts.find((artifact) => artifact.name === "preview-acceptance.json");
  const previewAcceptancePacketArtifact = artifacts.find((artifact) => artifact.name === "preview-acceptance-packet.json");
  const previewReleaseTicketArtifact = artifacts.find((artifact) => artifact.name === "preview-release-ticket.json");
  const previewHandoffArtifact = artifacts.find((artifact) => artifact.name === "preview-handoff.json");
  const previewReadinessManifestArtifact = artifacts.find((artifact) => artifact.name === "preview-readiness-manifest.json");
  const clientWorkflowArtifact = artifacts.find((artifact) => artifact.name === "client-workflow.json");
  const clientRuntimeAdoptionArtifact = artifacts.find((artifact) => artifact.name === "client-runtime-adoption.json");
  const clientRuntimeSettingsArtifact = artifacts.find((artifact) => artifact.name === "client-runtime-settings.json");
  const settingsRolloutGateArtifact = artifacts.find((artifact) => artifact.name === "settings-rollout-gate.json");
  const clientStatusHandoffArtifact = artifacts.find((artifact) => artifact.name === "client-status-handoff.json");
  const clientCommandLeasesArtifact = artifacts.find((artifact) => artifact.name === "client-command-leases.json");
  const clientCommandLeaseReplayArtifact = artifacts.find((artifact) => artifact.name === "client-command-lease-replay.json");
  const clientCommandLeaseReplayHandoffArtifact = artifacts.find((artifact) => artifact.name === "client-command-lease-replay-handoff.json");
  const commandLeaseReplayExportArtifact = artifacts.find((artifact) => artifact.name === "command-lease-replay-export.json");
  const tenantAuditHandoffArtifact = artifacts.find((artifact) => artifact.name === "tenant-audit-handoff.json");
  const permissionGrantPlanArtifact = artifacts.find((artifact) => artifact.name === "permission-grant-plan.json");
  const tenantPermissionEnforcementArtifact = artifacts.find((artifact) => artifact.name === "tenant-permission-enforcement.json");
  const tenantBoundaryPostureArtifact = artifacts.find((artifact) => artifact.name === "tenant-boundary-posture.json");
  const tenantBoundaryMatrixArtifact = artifacts.find((artifact) => artifact.name === "tenant-boundary-matrix.json");
  const runtimeBoundaryExecutionTicketArtifact = artifacts.find((artifact) => artifact.name === "runtime-boundary-execution-ticket.json");
  const operationalRunbookArtifact = artifacts.find((artifact) => artifact.name === "operational-runbook.json");
  const clientRemediationPacketArtifact = artifacts.find((artifact) => artifact.name === "client-remediation-packet.json");
  const clientReadinessBriefArtifact = artifacts.find((artifact) => artifact.name === "client-readiness-brief.json");
  const serviceLevelObjectiveArtifact = artifacts.find((artifact) => artifact.name === "service-level-objectives.json");
  const operationalHealthReportArtifact = artifacts.find((artifact) => artifact.name === "operational-health-report.json");
  const operationalIncidentExportArtifact = artifacts.find((artifact) => artifact.name === "operational-incident-export.json");
  const lifecycleControls = lifecycleArtifact?.payload || diagnostics.lifecycleControls || {};
  const lifecycleOperatorControls = lifecycleOperatorControlsArtifact?.payload
    || lifecycleControls.operatorControls
    || diagnostics.lifecycleOperatorControls
    || {};
  const lifecycleRunControl = lifecycleRunControlArtifact?.payload
    || lifecycleControls.runControlArtifact
    || diagnostics.lifecycleRunControl
    || diagnostics.lifecycleControls?.runControl
    || {};
  const providerService = providerServiceArtifact?.payload || diagnostics.providerServiceContract || {};
  const providerSyncCheckpoint = providerSyncCheckpointArtifact?.payload || diagnostics.providerSyncCheckpoint || {};
  const providerExportReadiness = providerExportReadinessArtifact?.payload || diagnostics.providerExportReadiness || {};
  const providerCallbackHandoff = providerCallbackHandoffArtifact?.payload || diagnostics.providerCallbackHandoff || {};
  const providerReleaseReadiness = providerReleaseReadinessArtifact?.payload || diagnostics.providerReleaseReadiness || {};
  const providerIntegrationHandoff = providerIntegrationHandoffArtifact?.payload || {};
  const providerIntegrationExecutionTicket = providerIntegrationExecutionTicketArtifact?.payload
    || diagnostics.providerIntegrationExecutionTicket
    || {};
  const runtimeReleaseDecision = runtimeReleaseDecisionArtifact?.payload || diagnostics.runtimeReleaseDecision || {};
  const runtimeReleaseControls = runtimeReleaseControlsArtifact?.payload || diagnostics.runtimeReleaseControls || {};
  const statusRecoveryBundle = statusRecoveryBundleArtifact?.payload || diagnostics.statusRecoveryBundle || {};
  const restartCheckpointManifest = restartCheckpointManifestArtifact?.payload || diagnostics.restartCheckpointManifest || {};
  const restartReplayLedger = restartReplayLedgerArtifact?.payload || diagnostics.restartReplayLedger || {};
  const persistedStatusEnvelope = persistedStatusEnvelopeArtifact?.payload || diagnostics.persistedStatusEnvelope || {};
  const runtimeStatusReplayCursor = runtimeStatusReplayCursorArtifact?.payload
    || diagnostics.runtimeStatusReplayCursor
    || {};
  const clientWorkflow = clientWorkflowArtifact?.payload || diagnostics.clientWorkflow || {};
  const previewHandoff = previewHandoffArtifact?.payload || diagnostics.previewHandoff || {};
  const clientRuntimeAdoption = clientRuntimeAdoptionArtifact?.payload || diagnostics.clientRuntimeAdoption || {};
  const clientRuntimeSettings = clientRuntimeSettingsArtifact?.payload || diagnostics.clientRuntimeSettings || {};
  const settingsRolloutGate = settingsRolloutGateArtifact?.payload || diagnostics.settingsRolloutGate || {};
  const clientStatusHandoff = clientStatusHandoffArtifact?.payload || diagnostics.clientStatusHandoff || {};
  const clientCommandLeases = clientCommandLeasesArtifact?.payload || diagnostics.clientCommandLeases || {};
  const clientCommandLeaseReplay = clientCommandLeaseReplayArtifact?.payload || diagnostics.clientCommandLeaseReplay || {};
  const clientCommandLeaseReplayHandoff = clientCommandLeaseReplayHandoffArtifact?.payload
    || diagnostics.clientCommandLeaseReplayHandoff
    || {};
  const commandLeaseReplayExport = commandLeaseReplayExportArtifact?.payload || diagnostics.commandLeaseReplayExport || {};
  const tenantAuditHandoff = tenantAuditHandoffArtifact?.payload || diagnostics.tenantAuditHandoff || {};
  const permissionGrantPlan = permissionGrantPlanArtifact?.payload || diagnostics.permissionGrantPlan || {};
  const tenantPermissionEnforcement = tenantPermissionEnforcementArtifact?.payload
    || diagnostics.tenantPermissionEnforcement
    || {};
  const tenantBoundaryPosture = tenantBoundaryPostureArtifact?.payload || diagnostics.tenantBoundaryPosture || {};
  const tenantBoundaryMatrix = tenantBoundaryMatrixArtifact?.payload || diagnostics.tenantBoundaryMatrix || {};
  const runtimeBoundaryExecutionTicket = runtimeBoundaryExecutionTicketArtifact?.payload
    || diagnostics.runtimeBoundaryExecutionTicket
    || {};
  const operationalRunbook = operationalRunbookArtifact?.payload || {};
  const clientRemediationPacket = clientRemediationPacketArtifact?.payload || diagnostics.clientRemediationPacket || {};
  const clientReadinessBrief = clientReadinessBriefArtifact?.payload || {};
  const serviceLevelObjectives = serviceLevelObjectiveArtifact?.payload || diagnostics.serviceLevelObjectives || {};
  const operationalHealthReport = operationalHealthReportArtifact?.payload || diagnostics.operationalHealthReport || {};
  const operationalIncidentExport = operationalIncidentExportArtifact?.payload
    || diagnostics.operationalIncidentExport
    || {};
  const previewExportReadiness = previewExportReadinessArtifact?.payload
    || diagnostics.previewExportReadiness
    || {};
  const previewAcceptancePacket = previewAcceptancePacketArtifact?.payload
    || diagnostics.previewAcceptancePacket
    || {};
  const previewReleaseTicket = previewReleaseTicketArtifact?.payload || {};
  const previewReadinessManifest = previewReadinessManifestArtifact?.payload
    || diagnostics.previewReadinessManifest
    || {};
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
    lifecycleRunControlReady: lifecycleRunControl.schemaVersion === "aios.mailchimp.lifecycle-run-control-artifact.v1"
      && Boolean(lifecycleRunControl.controlKey)
      && lifecycleRunControl.restartSemantics?.externalWritesPerformed === false,
    lifecycleRunControlStatus: lifecycleRunControl.status || "unknown",
    lifecycleRunControlNextAction: lifecycleRunControl.nextAction || null,
    lifecycleRunControlMode: lifecycleRunControl.mode?.requested || lifecycleRunControl.requestedMode || null,
    lifecycleRunControlFreezeActive: lifecycleRunControl.freezeWindow?.active === true
      || Boolean(lifecycleRunControl.activeFreezeWindow),
    lifecycleRunControlConcurrencyExceeded: lifecycleRunControl.concurrency?.exceeded === true,
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
    clientRuntimeSettingsReady: clientRuntimeSettings.schemaVersion === "aios.mailchimp.client-runtime-settings-artifact.v1"
      && Boolean(clientRuntimeSettings.settingsRevision)
      && clientRuntimeSettings.restartSemantics?.externalWritesPerformed === false,
    clientRuntimeSettingsStatus: clientRuntimeSettings.status || "unknown",
    clientRuntimeSettingsRevision: clientRuntimeSettings.settingsRevision || null,
    clientRuntimeSettingsNextAction: clientRuntimeSettings.nextAction || null,
    clientRuntimeSettingsMissingKeys: clientRuntimeSettings.missingRequiredSettings || [],
    settingsRolloutGateReady: settingsRolloutGate.schemaVersion === "aios.mailchimp.settings-rollout-gate-artifact.v1"
      && Boolean(settingsRolloutGate.rolloutKey)
      && Array.isArray(settingsRolloutGate.checkpoints)
      && settingsRolloutGate.restartSemantics?.externalWritesPerformed === false,
    settingsRolloutGateStatus: settingsRolloutGate.status || "unknown",
    settingsRolloutGateRuntimeReady: settingsRolloutGate.readyForRuntimeStart === true,
    settingsRolloutGateNextAction: settingsRolloutGate.nextAction || null,
    settingsRolloutGateNextGateId: settingsRolloutGate.nextGateId || null,
    settingsRolloutBlockedGateIds: settingsRolloutGate.clientPatch?.mailchimpSettingsRolloutBlockedGateIds || [],
    clientStatusHandoffReady: clientStatusHandoff.schemaVersion === "aios.mailchimp.client-status-handoff-artifact.v1"
      && Boolean(clientStatusHandoff.route?.idempotencyKey)
      && clientStatusHandoff.restartSemantics?.externalWritesPerformed === false,
    clientStatusHandoffStatus: clientStatusHandoff.status || "unknown",
    clientStatusHandoffVisibleStatus: clientStatusHandoff.visibleStatus || "unknown",
    clientStatusHandoffReadyForClient: clientStatusHandoff.readyForClient === true,
    clientStatusHandoffReadyForRuntime: clientStatusHandoff.readyForRuntime === true,
    clientStatusHandoffRouteId: clientStatusHandoff.route?.routeId || null,
    clientStatusHandoffNextAction: clientStatusHandoff.nextAction || null,
    clientStatusHandoffPendingAckKeys: clientStatusHandoff.commandAck?.pendingKeys || [],
    previewAcceptanceReceiptReady: previewAcceptanceArtifact?.payload?.acceptanceReceipt?.schemaVersion === "aios.mailchimp.preview-acceptance-receipt.v1"
      && Boolean(previewAcceptanceArtifact.payload.acceptanceReceipt.acceptanceToken)
      && previewAcceptanceArtifact.payload.acceptanceReceipt.restartSemantics?.externalWritesPerformed === false,
    previewAcceptanceReceiptStatus: previewAcceptanceArtifact?.payload?.acceptanceReceipt?.status || "unknown",
    previewAcceptanceReceiptNextAction: previewAcceptanceArtifact?.payload?.acceptanceReceipt?.nextAction || null,
    previewAcceptanceReceiptToken: previewAcceptanceArtifact?.payload?.acceptanceReceipt?.acceptanceToken || null,
    previewAcceptancePacketReady: previewAcceptancePacket.schemaVersion === "aios.mailchimp.preview-acceptance-packet-artifact.v1"
      && Boolean(previewAcceptancePacket.acceptanceToken)
      && Boolean(previewAcceptancePacket.routePayload?.idempotencyKey)
      && Array.isArray(previewAcceptancePacket.checkpoints)
      && previewAcceptancePacket.restartSemantics?.externalWritesPerformed === false,
    previewAcceptancePacketStatus: previewAcceptancePacket.status || "unknown",
    previewAcceptancePacketNextAction: previewAcceptancePacket.nextAction || null,
    previewAcceptancePacketRuntimeReady: previewAcceptancePacket.readyForRuntimeStart === true,
    previewAcceptancePacketBlocked: previewAcceptancePacket.validationSummary?.blocked || 0,
    previewAcceptancePacketPending: previewAcceptancePacket.validationSummary?.pending || 0,
    previewReleaseTicketReady: previewReleaseTicket.schemaVersion === "aios.mailchimp.preview-release-ticket-artifact.v1"
      && Boolean(previewReleaseTicket.ticketKey)
      && Boolean(previewReleaseTicket.routePayload?.idempotencyKey)
      && Array.isArray(previewReleaseTicket.rows)
      && previewReleaseTicket.restartSemantics?.externalWritesPerformed === false,
    previewReleaseTicketStatus: previewReleaseTicket.status || "unknown",
    previewReleaseTicketRuntimeReady: previewReleaseTicket.readyForRuntimeRelease === true,
    previewReleaseTicketNextAction: previewReleaseTicket.nextAction || null,
    previewReleaseTicketBlockedRows: previewReleaseTicket.validationSummary?.blockedRowIds || [],
    previewReleaseTicketWaitingRows: previewReleaseTicket.validationSummary?.waitingRowIds || [],
    previewReleaseTicketResumeToken: previewReleaseTicket.resumeToken || null,
    previewHandoffReady: previewHandoff.schemaVersion === "aios.mailchimp.preview-handoff-artifact.v1"
      && Boolean(previewHandoff.routePayload?.idempotencyKey)
      && Boolean(previewHandoff.acceptance?.token)
      && previewHandoff.restartSemantics?.externalWritesPerformed === false,
    previewHandoffStatus: previewHandoff.status || "unknown",
    previewHandoffRouteId: previewHandoff.routeId || null,
    previewHandoffNextAction: previewHandoff.nextAction || previewHandoff.primaryAction || null,
    previewHandoffReadyForAcceptance: previewHandoff.readyForAcceptance === true,
    previewHandoffReadyForRuntimeStart: previewHandoff.readyForRuntimeStart === true,
    previewHandoffBlockedGateIds: previewHandoff.acceptance?.blockedGateIds || [],
    previewHandoffPendingGateIds: previewHandoff.acceptance?.pendingGateIds || [],
    previewReadinessManifestReady: previewReadinessManifest.schemaVersion === "aios.mailchimp.preview-readiness-manifest-artifact.v1"
      && Boolean(previewReadinessManifest.route?.idempotencyKey)
      && Array.isArray(previewReadinessManifest.sections)
      && previewReadinessManifest.restartSemantics?.externalWritesPerformed === false,
    previewReadinessManifestStatus: previewReadinessManifest.status || "unknown",
    previewReadinessManifestVisibleStatus: previewReadinessManifest.visibleStatus || "unknown",
    previewReadinessManifestReadyForPreview: previewReadinessManifest.readyForClientPreview === true,
    previewReadinessManifestReadyForRuntime: previewReadinessManifest.readyForRuntimeStart === true,
    previewReadinessManifestNextAction: previewReadinessManifest.nextAction || null,
    previewReadinessManifestRouteId: previewReadinessManifest.route?.routeId || null,
    previewReadinessManifestBlockedSections: previewReadinessManifest.validationSummary?.blockedSectionIds || [],
    previewReadinessManifestPendingSections: previewReadinessManifest.validationSummary?.pendingSectionIds || [],
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
    clientCommandLeaseReplayHandoffReady: clientCommandLeaseReplayHandoff.schemaVersion === "aios.mailchimp.client-command-lease-replay-handoff-artifact.v1"
      && Boolean(clientCommandLeaseReplayHandoff.routePayload?.idempotencyKey)
      && Boolean(clientCommandLeaseReplayHandoff.resumeToken)
      && Array.isArray(clientCommandLeaseReplayHandoff.rows)
      && clientCommandLeaseReplayHandoff.restartSemantics?.externalWritesPerformed === false,
    clientCommandLeaseReplayHandoffStatus: clientCommandLeaseReplayHandoff.status || "unknown",
    clientCommandLeaseReplayHandoffRouteId: clientCommandLeaseReplayHandoff.routeId || null,
    clientCommandLeaseReplayHandoffReadyForRuntime: clientCommandLeaseReplayHandoff.readyForRuntime === true,
    clientCommandLeaseReplayHandoffNextAction: clientCommandLeaseReplayHandoff.nextAction || null,
    clientCommandLeaseReplayHandoffBlockedLeaseIds: clientCommandLeaseReplayHandoff.validationSummary?.blockedLeaseIds || [],
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
    permissionGrantPlanReady: permissionGrantPlan.schemaVersion === "aios.mailchimp.permission-grant-plan-artifact.v1"
      && permissionGrantPlan.readyForAudit === true
      && permissionGrantPlan.restartSemantics?.externalWritesPerformed === false,
    permissionGrantPlanStatus: permissionGrantPlan.status || "unknown",
    permissionGrantPlanNextAction: permissionGrantPlan.nextAction || null,
    permissionGrantPlanBlockingCount: permissionGrantPlan.summary?.blocking || 0,
    permissionGrantPlanCommandCount: permissionGrantPlan.summary?.total || 0,
    permissionGrantPlanAuditCommandId: permissionGrantPlan.auditHandoff?.commandId || null,
    tenantPermissionEnforcementReady: tenantPermissionEnforcement.schemaVersion === "aios.mailchimp.tenant-permission-enforcement-artifact.v1"
      && Boolean(tenantPermissionEnforcement.enforcementKey)
      && tenantPermissionEnforcement.restartSemantics?.externalWritesPerformed === false,
    tenantPermissionEnforcementStatus: tenantPermissionEnforcement.status || "unknown",
    tenantPermissionEnforcementNextAction: tenantPermissionEnforcement.nextAction || null,
    tenantPermissionAuditReady: tenantPermissionEnforcement.audit?.ready === true,
    tenantPermissionBlockedDecisions: tenantPermissionEnforcement.counters?.blocked || 0,
    tenantBoundaryPostureReady: tenantBoundaryPosture.schemaVersion === "aios.mailchimp.tenant-boundary-posture-artifact.v1"
      && Boolean(tenantBoundaryPosture.postureKey)
      && tenantBoundaryPosture.auditHandoff?.externalWritesPerformed === false
      && tenantBoundaryPosture.restartSemantics?.externalWritesPerformed === false,
    tenantBoundaryPostureStatus: tenantBoundaryPosture.status || "unknown",
    tenantBoundaryPostureNextAction: tenantBoundaryPosture.nextAction || null,
    tenantBoundarySafeForRuntime: tenantBoundaryPosture.safeForRuntime === true,
    tenantBoundarySafeForAuditAppend: tenantBoundaryPosture.safeForAuditAppend === true,
    tenantBoundaryPostureDriftFlags: tenantBoundaryPosture.counters?.driftFlags || 0,
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
    runtimeBoundaryExecutionTicketReady: runtimeBoundaryExecutionTicket.schemaVersion === "aios.mailchimp.runtime-boundary-execution-ticket-artifact.v1"
      && Boolean(runtimeBoundaryExecutionTicket.ticketKey)
      && Array.isArray(runtimeBoundaryExecutionTicket.rows)
      && runtimeBoundaryExecutionTicket.auditHandoff?.externalWritesPerformed === false
      && runtimeBoundaryExecutionTicket.restartSemantics?.externalWritesPerformed === false,
    runtimeBoundaryExecutionTicketStatus: runtimeBoundaryExecutionTicket.status || "unknown",
    runtimeBoundaryExecutionTicketKey: runtimeBoundaryExecutionTicket.ticketKey || null,
    runtimeBoundaryExecutionTicketNextAction: runtimeBoundaryExecutionTicket.nextAction || null,
    runtimeBoundaryExecutionTicketReadyForRelease: runtimeBoundaryExecutionTicket.readyForRuntimeRelease === true,
    runtimeBoundaryExecutionTicketBlockedJobs: runtimeBoundaryExecutionTicket.clientPatch?.runtimeBoundaryTicketBlockedJobs || [],
    runtimeBoundaryExecutionTicketWaitingJobs: runtimeBoundaryExecutionTicket.clientPatch?.runtimeBoundaryTicketWaitingJobs || [],
    runtimeBoundaryExecutionTicketReleaseBlockedGates: runtimeBoundaryExecutionTicket.releaseGate?.blockedGateIds || [],
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
    clientRemediationPacketReady: clientRemediationPacket.schemaVersion === "aios.mailchimp.client-remediation-packet-artifact.v1"
      && Boolean(clientRemediationPacket.route?.idempotencyKey)
      && Array.isArray(clientRemediationPacket.steps)
      && clientRemediationPacket.restartSemantics?.externalWritesPerformed === false,
    clientRemediationPacketStatus: clientRemediationPacket.status || "unknown",
    clientRemediationPacketVisibleStatus: clientRemediationPacket.visibleStatus || "unknown",
    clientRemediationPacketReadyForClient: clientRemediationPacket.readyForClient === true,
    clientRemediationPacketReadyForRuntime: clientRemediationPacket.readyForRuntime === true,
    clientRemediationPacketNextAction: clientRemediationPacket.nextAction || null,
    clientRemediationPacketRouteId: clientRemediationPacket.route?.routeId || null,
    clientRemediationPacketBlocking: clientRemediationPacket.counters?.blocking || 0,
    clientRemediationPacketWaiting: clientRemediationPacket.counters?.waiting || 0,
    clientReadinessBriefReady: clientReadinessBrief.schemaVersion === "aios.mailchimp.client-readiness-brief-artifact.v1"
      && Boolean(clientReadinessBrief.route?.idempotencyKey)
      && Array.isArray(clientReadinessBrief.sections)
      && clientReadinessBrief.restartSemantics?.externalWritesPerformed === false,
    clientReadinessBriefStatus: clientReadinessBrief.status || "unknown",
    clientReadinessBriefVisibleStatus: clientReadinessBrief.visibleStatus || "unknown",
    clientReadinessBriefReadyForPreview: clientReadinessBrief.readyForClientPreview === true,
    clientReadinessBriefReadyForRuntime: clientReadinessBrief.readyForRuntimeStart === true,
    clientReadinessBriefNextAction: clientReadinessBrief.nextAction || null,
    clientReadinessBriefRouteId: clientReadinessBrief.route?.routeId || null,
    clientReadinessBriefBlockingSections: clientReadinessBrief.validationSummary?.blockingSectionIds || [],
    clientReadinessBriefPendingSections: clientReadinessBrief.validationSummary?.pendingSectionIds || [],
    serviceLevelObjectiveExportReady: serviceLevelObjectives.schemaVersion === "aios.mailchimp.service-level-objective-export-artifact.v1"
      && Boolean(serviceLevelObjectives.resumeToken)
      && Array.isArray(serviceLevelObjectives.rows)
      && serviceLevelObjectives.restartSemantics?.externalWritesPerformed === false,
    serviceLevelObjectiveStatus: serviceLevelObjectives.status || "unknown",
    serviceLevelObjectiveHealth: serviceLevelObjectives.healthLevel || "unknown",
    serviceLevelObjectiveReadyForRuntimeRelease: serviceLevelObjectives.readyForRuntimeRelease === true,
    serviceLevelObjectiveNextAction: serviceLevelObjectives.nextAction || null,
    serviceLevelObjectiveBreaches: serviceLevelObjectives.counters?.breached || 0,
    serviceLevelObjectiveBlocking: serviceLevelObjectives.counters?.blocking || 0,
    operationalHealthReportReady: operationalHealthReport.schemaVersion === "aios.mailchimp.operational-health-report-artifact.v1"
      && Boolean(operationalHealthReport.reportId)
      && Array.isArray(operationalHealthReport.rows)
      && operationalHealthReport.restartSemantics?.externalWritesPerformed === false,
    operationalHealthReportStatus: operationalHealthReport.status || "unknown",
    operationalHealthReportLevel: operationalHealthReport.healthLevel || "unknown",
    operationalHealthReportNextAction: operationalHealthReport.nextAction || null,
    operationalHealthReportRowCount: operationalHealthReport.rows?.length || 0,
    operationalHealthReportBlockingRows: operationalHealthReport.counters?.blocking || 0,
    operationalHealthReportRetryableRows: operationalHealthReport.counters?.retryable || 0,
    operationalHealthReportExportReady: operationalHealthReport.exportReady === true,
    operationalHealthReportResumeToken: operationalHealthReport.resumeToken || null,
    operationalIncidentExportReady: operationalIncidentExport.schemaVersion === "aios.mailchimp.operational-incident-export-artifact.v1"
      && Boolean(operationalIncidentExport.resumeToken)
      && Array.isArray(operationalIncidentExport.rows)
      && operationalIncidentExport.restartSemantics?.externalWritesPerformed === false,
    operationalIncidentExportStatus: operationalIncidentExport.status || "unknown",
    operationalIncidentExportNextAction: operationalIncidentExport.nextAction || null,
    operationalIncidentExportRows: operationalIncidentExport.rows?.length || 0,
    operationalIncidentExportBlocking: operationalIncidentExport.counters?.blocking || 0,
    operationalIncidentExportRetryable: operationalIncidentExport.counters?.retryable || 0,
    operationalIncidentExportResumeToken: operationalIncidentExport.resumeToken || null,
    tenantAuditBlockedJobs: tenantAuditHandoff.permissions?.blockedJobIds?.length || 0,
    tenantAuditApprovalJobs: tenantAuditHandoff.permissions?.approvalJobIds?.length || 0,
    tenantAuditMissingScopes: tenantAuditHandoff.permissions?.missing?.length || 0,
    clientWorkflowStatus: clientWorkflow.status || "unknown",
    clientWorkflowAction: clientWorkflow.explainNextStep?.action || clientWorkflow.primaryAction || null,
    providerServiceStatus: providerService.status || "unknown",
    providerService: providerService.providerService || null,
    providerSyncHandoffReady: providerService.syncMetadata?.syncHandoffReady === true,
    providerSyncCheckpointReady: providerSyncCheckpoint.ready === true,
    providerSyncCheckpointStatus: providerSyncCheckpoint.status || "unknown",
    providerSyncCheckpointNextAction: providerSyncCheckpoint.nextAction || null,
    providerSyncCheckpointMissingAckMounts: providerSyncCheckpoint.missingAckMounts || [],
    providerSyncCheckpointMissingWatermarkMounts: providerSyncCheckpoint.missingWatermarkMounts || [],
    providerExportReadinessReady: providerExportReadiness.schemaVersion === "aios.mailchimp.provider-export-readiness-artifact.v1"
      && Boolean(providerExportReadiness.exportKey)
      && Boolean(providerExportReadiness.routePayload?.idempotencyKey)
      && Array.isArray(providerExportReadiness.rows)
      && providerExportReadiness.restartSemantics?.externalWritesPerformed === false,
    providerExportReadinessStatus: providerExportReadiness.status || "unknown",
    providerExportReady: providerExportReadiness.exportReady === true,
    providerExportNextAction: providerExportReadiness.nextAction || null,
    providerExportResumeToken: providerExportReadiness.resumeToken || null,
    providerExportBlockedRows: providerExportReadiness.validationSummary?.blockedRowIds || [],
    providerExportWaitingRows: providerExportReadiness.validationSummary?.waitingRowIds || [],
    providerCallbackHandoffReady: providerCallbackHandoff.schemaVersion === "aios.mailchimp.provider-callback-handoff-artifact.v1"
      && Boolean(providerCallbackHandoff.callbackKey)
      && Boolean(providerCallbackHandoff.routePayload?.idempotencyKey)
      && providerCallbackHandoff.restartSemantics?.externalWritesPerformed === false,
    providerCallbackStatus: providerCallbackHandoff.status || "unknown",
    providerCallbackReady: providerCallbackHandoff.ready === true,
    providerCallbackNextAction: providerCallbackHandoff.nextAction || null,
    providerCallbackResumeToken: providerCallbackHandoff.resumeToken || null,
    providerCallbackMissingEvents: providerCallbackHandoff.events?.missing || [],
    unnegotiatedProviderCapabilities: providerService.capabilityNegotiation?.unnegotiated || [],
    providerReleaseReadinessReady: providerReleaseReadiness.schemaVersion === "aios.mailchimp.provider-release-readiness-artifact.v1"
      && providerReleaseReadiness.ready === true
      && Boolean(providerReleaseReadiness.nextAction),
    providerReleaseReadinessStatus: providerReleaseReadiness.status || "unknown",
    providerReleaseReadinessNextAction: providerReleaseReadiness.nextAction || null,
    providerReleaseReadinessBlockedJobs: providerReleaseReadiness.validationSummary?.blockedJobIds || [],
    providerReleaseReadinessMissingCapabilities: providerReleaseReadiness.capabilityNegotiation?.missing || [],
    providerIntegrationHandoffReady: providerIntegrationHandoff.schemaVersion === "aios.mailchimp.provider-integration-handoff-artifact.v1"
      && Boolean(providerIntegrationHandoff.integrationKey)
      && Array.isArray(providerIntegrationHandoff.gates)
      && providerIntegrationHandoff.restartSemantics?.externalWritesPerformed === false,
    providerIntegrationHandoffStatus: providerIntegrationHandoff.status || "unknown",
    providerIntegrationRuntimeReady: providerIntegrationHandoff.readyForRuntime === true,
    providerIntegrationHandoffNextAction: providerIntegrationHandoff.nextAction || null,
    providerIntegrationHandoffNextGateId: providerIntegrationHandoff.nextGateId || null,
    providerIntegrationBlockedGateIds: providerIntegrationHandoff.validationSummary?.blockedGateIds || [],
    providerIntegrationWaitingGateIds: providerIntegrationHandoff.validationSummary?.waitingGateIds || [],
    providerIntegrationExecutionTicketReady: providerIntegrationExecutionTicket.schemaVersion === "aios.mailchimp.provider-integration-execution-ticket-artifact.v1"
      && Boolean(providerIntegrationExecutionTicket.ticketKey)
      && Boolean(providerIntegrationExecutionTicket.routePayload?.idempotencyKey)
      && Array.isArray(providerIntegrationExecutionTicket.gates)
      && providerIntegrationExecutionTicket.restartSemantics?.externalWritesPerformed === false,
    providerIntegrationExecutionTicketStatus: providerIntegrationExecutionTicket.status || "unknown",
    providerIntegrationExecutionTicketRuntimeReady: providerIntegrationExecutionTicket.readyForRuntimeRelease === true,
    providerIntegrationExecutionTicketNextAction: providerIntegrationExecutionTicket.nextAction || null,
    providerIntegrationExecutionTicketResumeCursor: providerIntegrationExecutionTicket.resumeCursor || null,
    providerIntegrationExecutionTicketBlockedGates: providerIntegrationExecutionTicket.validationSummary?.blockedGateIds || [],
    providerIntegrationExecutionTicketWaitingGates: providerIntegrationExecutionTicket.validationSummary?.waitingGateIds || [],
    runtimeReleaseDecisionReady: runtimeReleaseDecision.schemaVersion === "aios.mailchimp.runtime-release-decision-artifact.v1"
      && Boolean(runtimeReleaseDecision.releaseToken)
      && Boolean(runtimeReleaseDecision.nextAction)
      && runtimeReleaseDecision.restartSemantics?.externalWritesPerformed === false,
    runtimeReleaseState: runtimeReleaseDecision.state || "unknown",
    runtimeReleaseNextAction: runtimeReleaseDecision.nextAction || null,
    runtimeReleaseToken: runtimeReleaseDecision.releaseToken || null,
    runtimeReleaseBlockedGateIds: runtimeReleaseDecision.clientPatch?.runtimeReleaseBlockedGateIds || [],
    runtimeReleaseWaitingGateIds: runtimeReleaseDecision.clientPatch?.runtimeReleaseWaitingGateIds || [],
    runtimeReleaseControlsReady: runtimeReleaseControls.schemaVersion === "aios.mailchimp.runtime-release-controls-artifact.v1"
      && Boolean(runtimeReleaseControls.releaseKey)
      && Array.isArray(runtimeReleaseControls.rows)
      && runtimeReleaseControls.restartSemantics?.externalWritesPerformed === false,
    runtimeReleaseControlsStatus: runtimeReleaseControls.status || "unknown",
    runtimeReleaseControlsReadyForRuntimeStart: runtimeReleaseControls.readyForRuntimeStart === true,
    runtimeReleaseControlsNextAction: runtimeReleaseControls.nextAction || null,
    runtimeReleaseControlsNextGateId: runtimeReleaseControls.nextGateId || null,
    runtimeReleaseControlsBlockedGateIds: runtimeReleaseControls.clientPatch?.runtimeReleaseBlockedGateIds || [],
    runtimeReleaseControlsWaitingGateIds: runtimeReleaseControls.clientPatch?.runtimeReleaseWaitingGateIds || [],
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
    restartCheckpointManifestReady: restartCheckpointManifest.schemaVersion === "aios.mailchimp.restart-checkpoint-manifest-artifact.v1"
      && Boolean(restartCheckpointManifest.resumeToken)
      && Array.isArray(restartCheckpointManifest.checkpoints)
      && restartCheckpointManifest.restartSemantics?.externalWritesPerformed === false,
    restartCheckpointStatus: restartCheckpointManifest.status || "unknown",
    restartCheckpointReadyForColdRestart: restartCheckpointManifest.readyForColdRestart === true,
    restartCheckpointNextAction: restartCheckpointManifest.nextAction || null,
    restartCheckpointMissingRequired: restartCheckpointManifest.blocking?.missingRequiredCheckpoints || [],
    restartReplayLedgerReady: restartReplayLedger.schemaVersion === "aios.mailchimp.restart-replay-ledger-artifact.v1"
      && Boolean(restartReplayLedger.resumeToken)
      && Array.isArray(restartReplayLedger.rows)
      && restartReplayLedger.restartSemantics?.externalWritesPerformed === false,
    restartReplayLedgerStatus: restartReplayLedger.status || "unknown",
    restartReplayLedgerNextAction: restartReplayLedger.nextAction || null,
    restartReplayLedgerUnsafeRows: restartReplayLedger.counters?.unsafe || 0,
    restartReplayLedgerAckRequired: restartReplayLedger.counters?.ackRequired || 0,
    persistedStatusEnvelopeReady: persistedStatusEnvelope.schemaVersion === "aios.mailchimp.persisted-status-envelope-artifact.v1"
      && Boolean(persistedStatusEnvelope.resumeToken)
      && Boolean(persistedStatusEnvelope.statusRevision)
      && Array.isArray(persistedStatusEnvelope.rows)
      && persistedStatusEnvelope.restartSemantics?.externalWritesPerformed === false,
    persistedStatusEnvelopeStatus: persistedStatusEnvelope.status || "unknown",
    persistedStatusEnvelopeNextAction: persistedStatusEnvelope.nextAction || null,
    persistedStatusEnvelopeBlockedCommands: persistedStatusEnvelope.blocking?.commandIds || [],
    persistedStatusEnvelopeUnsafeCommands: persistedStatusEnvelope.blocking?.unsafeCommandIds || [],
    runtimeStatusReplayCursorReady: runtimeStatusReplayCursor.schemaVersion === "aios.mailchimp.runtime-status-replay-cursor-artifact.v1"
      && Boolean(runtimeStatusReplayCursor.replayCursor)
      && Boolean(runtimeStatusReplayCursor.resumeToken)
      && Array.isArray(runtimeStatusReplayCursor.rows)
      && runtimeStatusReplayCursor.restartSemantics?.externalWritesPerformed === false,
    runtimeStatusReplayCursorStatus: runtimeStatusReplayCursor.status || "unknown",
    runtimeStatusReplayCursorNextAction: runtimeStatusReplayCursor.nextAction || null,
    runtimeStatusReplayCursorResumeToken: runtimeStatusReplayCursor.resumeToken || null,
    runtimeStatusReplayCursorBlockedJobs: runtimeStatusReplayCursor.blocking?.blockedJobIds || [],
    runtimeStatusReplayCursorWaitingJobs: runtimeStatusReplayCursor.blocking?.waitingJobIds || [],
    runtimeStatusReplayCursorUnsafeJobs: runtimeStatusReplayCursor.blocking?.unsafeJobIds || [],
    dryRunAnalyticsExportReady: dryRunAnalyticsExportArtifact?.payload?.schemaVersion === "aios.mailchimp.dry-run-analytics-export-artifact.v1"
      && dryRunAnalyticsExportArtifact.payload.exportReady === true
      && Boolean(dryRunAnalyticsExportArtifact.payload.nextAction),
    dryRunAnalyticsExportStatus: dryRunAnalyticsExportArtifact?.payload?.status || "unknown",
    dryRunAnalyticsExportNextAction: dryRunAnalyticsExportArtifact?.payload?.nextAction || null,
    dryRunAnalyticsExportHistorySnapshots: dryRunAnalyticsExportArtifact?.payload?.counters?.historySnapshots || 0,
    dryRunAnalyticsExportTimelineEvents: dryRunAnalyticsExportArtifact?.payload?.counters?.timelineEvents || 0,
    dryRunAnalyticsExportBlockers: dryRunAnalyticsExportArtifact?.payload?.exportSummary?.blockerCodes || [],
    dryRunAnalyticsExportWarnings: dryRunAnalyticsExportArtifact?.payload?.exportSummary?.warningCodes || [],
    dryRunReportingStateReady: dryRunAnalyticsExportArtifact?.payload?.reportingState?.schemaVersion === "aios.mailchimp.dry-run-reporting-state.v1"
      && Boolean(dryRunAnalyticsExportArtifact.payload.reportingState.reportingCursor)
      && dryRunAnalyticsExportArtifact.payload.reportingState.restartSemantics?.externalWritesPerformed === false,
    dryRunReportingStateStatus: dryRunAnalyticsExportArtifact?.payload?.reportingState?.status || "unknown",
    dryRunReportingStateNextAction: dryRunAnalyticsExportArtifact?.payload?.reportingState?.nextAction || null,
    dryRunReportingCursor: dryRunAnalyticsExportArtifact?.payload?.reportingState?.reportingCursor || null,
    dryRunReportingBlockedRows: dryRunAnalyticsExportArtifact?.payload?.reportingState?.counters?.blockedRows || 0,
    dryRunReportingWaitingRows: dryRunAnalyticsExportArtifact?.payload?.reportingState?.counters?.waitingRows || 0,
    runtimeExportWatermarkReady: dryRunAnalyticsExportArtifact?.payload?.runtimeExportWatermark?.schemaVersion === "aios.mailchimp.runtime-export-watermark-artifact.v1"
      && Boolean(dryRunAnalyticsExportArtifact.payload.runtimeExportWatermark.cursor)
      && dryRunAnalyticsExportArtifact.payload.runtimeExportWatermark.restartSemantics?.externalWritesPerformed === false,
    runtimeExportWatermarkStatus: dryRunAnalyticsExportArtifact?.payload?.runtimeExportWatermark?.status || "unknown",
    runtimeExportWatermarkNextAction: dryRunAnalyticsExportArtifact?.payload?.runtimeExportWatermark?.nextAction || null,
    runtimeExportWatermarkCursor: dryRunAnalyticsExportArtifact?.payload?.runtimeExportWatermark?.cursor || null,
    runtimeExportWatermarkDedupeKey: dryRunAnalyticsExportArtifact?.payload?.runtimeExportWatermark?.dedupeKey || null,
    runtimeExportWatermarkBlockedJobs: dryRunAnalyticsExportArtifact?.payload?.runtimeExportWatermark?.exportSummary?.blockedJobIds || [],
    runtimeExportWatermarkWaitingJobs: dryRunAnalyticsExportArtifact?.payload?.runtimeExportWatermark?.exportSummary?.waitingJobIds || [],
    diagnosticExportLedgerReady: diagnosticExportLedgerArtifact?.payload?.schemaVersion === "aios.mailchimp.diagnostic-export-ledger-artifact.v1"
      && diagnosticExportLedgerArtifact.payload.exportReady === true
      && Boolean(diagnosticExportLedgerArtifact.payload.resumeToken),
    diagnosticExportLedgerStatus: diagnosticExportLedgerArtifact?.payload?.status || "unknown",
    diagnosticExportLedgerNextAction: diagnosticExportLedgerArtifact?.payload?.nextAction || null,
    diagnosticExportLedgerRows: diagnosticExportLedgerArtifact?.payload?.rows?.length || 0,
    diagnosticExportLedgerBlockedRows: diagnosticExportLedgerArtifact?.payload?.counters?.blockedRows || 0,
    previewExportReadinessReady: previewExportReadiness.schemaVersion === "aios.mailchimp.preview-export-readiness-artifact.v1"
      && Boolean(previewExportReadiness.resumeToken)
      && Array.isArray(previewExportReadiness.rows)
      && previewExportReadiness.restartSemantics?.externalWritesPerformed === false,
    previewExportReadinessStatus: previewExportReadiness.status || "unknown",
    previewExportReady: previewExportReadiness.exportReady === true || previewExportReadiness.ready === true,
    previewExportRuntimeStartReady: previewExportReadiness.readyForRuntimeStart === true,
    previewExportNextAction: previewExportReadiness.nextAction || null,
    previewExportBlockedRows: previewExportReadiness.exportSummary?.blockedRowIds || [],
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
      : operationalHealthReport.status === "blocked"
        ? operationalHealthReport.nextAction || "repair-operational-health"
      : "publish-in-memory-artifacts"
  };
}

function normalizeReportRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row, index) => ({
    id: row.id || `health-row-${String(index + 1).padStart(2, "0")}`,
    order: row.order || index + 1,
    phase: row.phase || "operational-health",
    status: row.status || "ready",
    healthLevel: row.healthLevel || (row.status === "blocked" ? "unhealthy" : row.status === "degraded" ? "degraded" : "healthy"),
    owner: row.owner || "runtime",
    nextAction: row.nextAction || "handoff-to-runtime-adapter",
    retryable: row.retryable === true,
    blocksRuntimeStart: row.blocksRuntimeStart === true,
    evidence: row.evidence || {}
  }));
}

function buildProviderExportReadinessArtifact(metadata, diagnostics, assembled = {}) {
  const source = diagnostics.providerExportReadiness || metadata.providerExportReadiness || {};
  const providerService = assembled.providerServiceHandoff || diagnostics.providerServiceContract || {};
  const providerSync = assembled.providerSyncCheckpoint || diagnostics.providerSyncCheckpoint || {};
  const releaseControls = assembled.runtimeReleaseControls || diagnostics.runtimeReleaseControls || {};
  const rows = Array.isArray(source.rows) && source.rows.length
    ? source.rows
    : [
      {
        id: "provider-service",
        label: "Mailchimp provider service",
        status: providerService.status || "unknown",
        ready: providerService.externalHandoff?.ready === true,
        nextAction: providerService.nextAction || providerService.clientPatch?.nextAction || "repair-provider-service-handoff",
        evidence: {
          providerService: providerService.providerService || null,
          externalHandoffReady: providerService.externalHandoff?.ready === true
        }
      },
      {
        id: "provider-sync",
        label: "Mailchimp provider sync checkpoint",
        status: providerSync.status || "unknown",
        ready: providerSync.ready === true,
        nextAction: providerSync.nextAction || "repair-provider-sync-checkpoint",
        evidence: {
          resumeToken: providerSync.resumeToken || null,
          missingAckMounts: providerSync.missingAckMounts || [],
          missingWatermarkMounts: providerSync.missingWatermarkMounts || []
        }
      },
      {
        id: "runtime-release",
        label: "Mailchimp runtime release controls",
        status: releaseControls.status || "unknown",
        ready: releaseControls.readyForRuntimeStart === true,
        nextAction: releaseControls.nextAction || "repair-provider-release-controls",
        evidence: {
          releaseKey: releaseControls.releaseKey || null,
          blockedGateIds: releaseControls.clientPatch?.runtimeReleaseBlockedGateIds || []
        }
      }
    ];
  const blockedRows = rows.filter((row) => row.status === "blocked" || row.ready === false && row.id !== "status-ledger");
  const waitingRows = rows.filter((row) => row.ready === false && !blockedRows.includes(row));
  const exportReady = source.exportReady === true
    && blockedRows.length === 0
    && waitingRows.length === 0;
  const status = blockedRows.length > 0
    ? "blocked"
    : waitingRows.length > 0 || exportReady === false
      ? "needs-operator-action"
      : "ready";
  const nextRow = blockedRows[0] || waitingRows[0] || null;
  const exportKey = source.exportKey
    || `${diagnostics.jobId || metadata.jobId || "mailchimp"}:${providerService.providerService || "mailchimp-marketing-api"}:provider-export`
      .replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const resumeToken = source.resumeToken
    || diagnostics.statusLedger?.resumeToken
    || `${exportKey}:resume`;
  const routePayload = {
    routeId: "mailchimp.provider-export-readiness",
    providerService: source.providerService || providerService.providerService || "mailchimp-marketing-api",
    exportKey,
    resumeToken,
    statusRevision: source.statusRevision || diagnostics.statusLedger?.statusRevision || null,
    idempotencyKey: source.externalHandoff?.idempotencyKey
      || `${exportKey}:${source.statusRevision || diagnostics.statusLedger?.statusRevision || "unrevisioned"}`
        .replace(/[^a-zA-Z0-9_.:-]/g, "_"),
    dryRunOnly: true
  };

  return {
    schemaVersion: "aios.mailchimp.provider-export-readiness-artifact.v1",
    provider: "mailchimp",
    jobId: diagnostics.jobId || metadata.jobId || null,
    providerService: routePayload.providerService,
    status,
    exportReady,
    readyForRuntime: exportReady,
    exportKey,
    resumeToken,
    nextAction: nextRow?.nextAction || source.nextAction || (exportReady ? "publish-provider-export-readiness" : "refresh-provider-export-status"),
    rows: rows.map((row, index) => ({
      id: row.id || `provider-export-row-${String(index + 1).padStart(2, "0")}`,
      order: row.order || index + 1,
      label: row.label || row.id || "Provider export row",
      status: row.ready === true ? "ready" : row.status || "needs-operator-action",
      ready: row.ready === true,
      nextAction: row.nextAction || "refresh-provider-export-status",
      evidence: row.evidence || {}
    })),
    validationSummary: {
      total: rows.length,
      ready: rows.filter((row) => row.ready).length,
      blocked: blockedRows.length,
      waiting: waitingRows.length,
      blockedRowIds: blockedRows.map((row) => row.id),
      waitingRowIds: waitingRows.map((row) => row.id)
    },
    routePayload,
    externalHandoff: {
      target: source.externalHandoff?.target || providerService.externalHandoff?.target || routePayload.providerService,
      required: source.externalHandoff?.required !== false,
      ready: exportReady,
      idempotencyKey: routePayload.idempotencyKey,
      externalWritesPerformed: false
    },
    clientPatch: {
      ...(source.clientPatch || {}),
      providerExportReadinessStatus: status,
      providerExportReady: exportReady,
      providerExportNextAction: nextRow?.nextAction || source.nextAction || (exportReady ? "publish-provider-export-readiness" : "refresh-provider-export-status"),
      providerExportBlockedRows: blockedRows.map((row) => row.id),
      providerExportWaitingRows: waitingRows.map((row) => row.id),
      providerExportResumeToken: resumeToken
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-provider-export-key",
      resumeToken,
      externalWritesPerformed: false
    }
  };
}

function buildProviderCallbackHandoffArtifact(metadata, diagnostics, assembled = {}) {
  const source = diagnostics.providerCallbackHandoff || metadata.providerCallbackHandoff || {};
  const providerService = assembled.providerServiceHandoff || diagnostics.providerServiceContract || {};
  const rows = Array.isArray(source.rows) ? source.rows : [];
  const blockedRows = rows.filter((row) => row.status === "blocked");
  const waitingRows = rows.filter((row) => row.ready === false && row.status !== "blocked");
  const ready = source.ready === true
    && blockedRows.length === 0
    && waitingRows.length === 0;
  const status = blockedRows.length
    ? "blocked"
    : waitingRows.length
      ? "needs-operator-action"
      : ready
        ? "ready"
        : source.status || "needs-operator-action";
  const callbackKey = source.callbackKey
    || `${diagnostics.jobId || metadata.jobId || "mailchimp"}:${providerService.providerService || "mailchimp-marketing-api"}:provider-callback`
      .replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const resumeToken = source.resumeToken
    || diagnostics.statusLedger?.resumeToken
    || `${callbackKey}:resume`;
  const routePayload = {
    ...(source.routePayload || {}),
    routeId: source.routePayload?.routeId || "mailchimp.provider-callback-handoff",
    providerService: source.providerService || providerService.providerService || "mailchimp-marketing-api",
    callbackKey,
    resumeToken,
    statusRevision: source.routePayload?.statusRevision || diagnostics.statusLedger?.statusRevision || null,
    idempotencyKey: source.routePayload?.idempotencyKey
      || `${callbackKey}:${diagnostics.statusLedger?.statusRevision || "unrevisioned"}`
        .replace(/[^a-zA-Z0-9_.:-]/g, "_"),
    dryRunOnly: true
  };

  return {
    schemaVersion: "aios.mailchimp.provider-callback-handoff-artifact.v1",
    provider: "mailchimp",
    jobId: diagnostics.jobId || metadata.jobId || null,
    providerService: routePayload.providerService,
    status,
    ready,
    callbackKey,
    resumeToken,
    endpoint: {
      endpointId: source.endpoint?.endpointId || null,
      signingSecretRef: source.endpoint?.signingSecretRef || null,
      ready: source.endpoint?.ready === true
    },
    events: {
      required: source.events?.required || [],
      acknowledged: source.events?.acknowledged || [],
      missing: source.events?.missing || []
    },
    rows: rows.map((row, index) => ({
      id: row.id || `provider-callback-row-${String(index + 1).padStart(2, "0")}`,
      order: row.order || index + 1,
      label: row.label || row.id || "Provider callback row",
      status: row.ready === true ? "ready" : row.status || "needs-operator-action",
      ready: row.ready === true,
      nextAction: row.nextAction || source.nextAction || "repair-mailchimp-callback-handoff",
      evidence: row.evidence || {}
    })),
    validationSummary: {
      total: rows.length,
      ready: rows.filter((row) => row.ready).length,
      blocked: blockedRows.length,
      waiting: waitingRows.length,
      blockedRowIds: blockedRows.map((row) => row.id),
      waitingRowIds: waitingRows.map((row) => row.id)
    },
    routePayload,
    clientPatch: {
      ...(source.clientPatch || {}),
      providerCallbackStatus: status,
      providerCallbackReady: ready,
      providerCallbackNextAction: source.nextAction || (ready ? "handoff-to-runtime-adapter" : "repair-mailchimp-callback-handoff"),
      providerCallbackResumeToken: resumeToken
    },
    restartSemantics: {
      ...(source.restartSemantics || {}),
      replaySafe: true,
      duplicateCommandPolicy: source.restartSemantics?.duplicateCommandPolicy || "dedupe-by-provider-callback-key",
      resumeToken,
      externalWritesPerformed: false
    },
    nextAction: source.nextAction || (ready ? "handoff-to-runtime-adapter" : "repair-mailchimp-callback-handoff")
  };
}

function buildOperationalHealthReportArtifact(metadata, diagnostics, assembled = {}) {
  const health = metadata.health || {};
  const incidents = metadata.operationalIncidents || health.operationalIncidents || diagnostics.operationalIncidents || {};
  const incidentRows = Array.isArray(incidents.incidents) ? incidents.incidents : [];
  const runbook = assembled.operationalRunbook || {};
  const serviceLevelObjectives = assembled.serviceLevelObjectiveExport || metadata.serviceLevelObjectives || {};
  const clientRemediation = assembled.clientRemediationPacket || metadata.clientRemediation || {};
  const failureState = diagnostics.failureState || {};
  const lifecycleControls = assembled.lifecycleControls || diagnostics.lifecycleControls || {};
  const providerService = assembled.providerServiceHandoff || metadata.providerService || {};
  const providerSync = assembled.providerSyncCheckpoint || metadata.providerSyncCheckpoint || {};
  const runtimeReleaseControls = assembled.runtimeReleaseControls || metadata.runtimeReleaseControls || {};
  const exportSummary = metadata.exports?.summary || {};
  const statusLedger = diagnostics.statusLedger || {};
  const sourceRows = normalizeReportRows([
    {
      id: "diagnostics",
      phase: "compile-diagnostics",
      status: (diagnostics.counts?.bySeverity?.error || 0) > 0
        ? "blocked"
        : (diagnostics.counts?.bySeverity?.warning || 0) > 0
          ? "degraded"
          : "ready",
      owner: (diagnostics.counts?.bySeverity?.error || 0) > 0 ? "runtime" : "operator",
      nextAction: diagnostics.recovery?.nextAction || "publish-diagnostics",
      retryable: false,
      blocksRuntimeStart: (diagnostics.counts?.bySeverity?.error || 0) > 0,
      evidence: {
        errors: diagnostics.counts?.bySeverity?.error || 0,
        warnings: diagnostics.counts?.bySeverity?.warning || 0,
        actionCount: diagnostics.recovery?.requiredActionCount || 0
      }
    },
    {
      id: "adapter-failure-state",
      phase: "adapter-recovery",
      status: failureState.mode === "blocked"
        ? "blocked"
        : failureState.mode === "degraded"
          ? "degraded"
          : "ready",
      owner: "adapter",
      nextAction: failureState.adapterHandoff?.nextAction
        || failureState.nextRetry?.nextAction
        || diagnostics.recovery?.nextAction
        || "handoff-to-runtime-adapter",
      retryable: (failureState.summary?.retryable || 0) > 0,
      blocksRuntimeStart: failureState.mode === "blocked" || (failureState.summary?.blocking || 0) > 0,
      evidence: {
        queueLength: failureState.summary?.total || 0,
        retryable: failureState.summary?.retryable || 0,
        blocking: failureState.summary?.blocking || 0,
        nextBackoffMs: failureState.nextRetry?.backoffMs || 0
      }
    },
    {
      id: "operational-incidents",
      phase: "incident-queue",
      status: incidents.status || "ready",
      owner: incidents.nextOwner || "operator",
      nextAction: incidents.nextAction || diagnostics.recovery?.nextAction || "handoff-to-runtime-adapter",
      retryable: (incidents.counts?.retryable || incidents.summary?.retryable || 0) > 0,
      blocksRuntimeStart: (incidents.counts?.blocking || incidents.summary?.blocking || 0) > 0,
      evidence: {
        total: incidents.counts?.total || incidents.incidentCount || incidentRows.length,
        blocking: incidents.counts?.blocking || incidents.summary?.blocking || 0,
        clientVisible: incidents.counts?.clientVisible || incidents.summary?.clientVisible || 0,
        providerVisible: incidents.counts?.providerVisible || incidents.summary?.providerVisible || 0
      }
    },
    {
      id: "provider-handoff",
      phase: "provider-service",
      status: providerService.status || "unknown",
      owner: "adapter",
      nextAction: providerService.nextAction || providerService.clientPatch?.nextAction || "repair-provider-service-handoff",
      retryable: providerService.externalHandoff?.ready === false || providerSync.ready === false,
      blocksRuntimeStart: providerService.status === "blocked" || providerService.externalHandoff?.ready === false,
      evidence: {
        providerService: providerService.providerService || null,
        serviceReady: providerService.externalHandoff?.ready === true,
        syncReady: providerSync.ready === true,
        syncStatus: providerSync.status || "unknown"
      }
    },
    {
      id: "runtime-release",
      phase: "release-controls",
      status: runtimeReleaseControls.status || "unknown",
      owner: "operator",
      nextAction: runtimeReleaseControls.nextAction || "review-runtime-release-controls",
      retryable: runtimeReleaseControls.status === "needs-operator-action",
      blocksRuntimeStart: runtimeReleaseControls.status === "blocked"
        || runtimeReleaseControls.readyForRuntimeStart === false,
      evidence: {
        readyForRuntimeStart: runtimeReleaseControls.readyForRuntimeStart === true,
        nextGateId: runtimeReleaseControls.nextGateId || null,
        blockedGateIds: runtimeReleaseControls.clientPatch?.runtimeReleaseBlockedGateIds
          || runtimeReleaseControls.blocking?.blockedGateIds
          || []
      }
    },
    {
      id: "service-level-objectives",
      phase: "slo",
      status: serviceLevelObjectives.status || "unknown",
      healthLevel: serviceLevelObjectives.healthLevel || "unknown",
      owner: "operator",
      nextAction: serviceLevelObjectives.nextAction || "review-mailchimp-service-level-objective",
      retryable: serviceLevelObjectives.retry?.retryable === true,
      blocksRuntimeStart: (serviceLevelObjectives.counters?.blocking || 0) > 0
        || serviceLevelObjectives.readyForRuntimeRelease === false,
      evidence: {
        breached: serviceLevelObjectives.counters?.breached || 0,
        blocking: serviceLevelObjectives.counters?.blocking || 0,
        readyForRuntimeRelease: serviceLevelObjectives.readyForRuntimeRelease === true
      }
    },
    {
      id: "client-remediation",
      phase: "client-runtime",
      status: clientRemediation.status || "unknown",
      owner: "client-runtime",
      nextAction: clientRemediation.nextAction || "refresh-client-remediation-packet",
      retryable: false,
      blocksRuntimeStart: (clientRemediation.counters?.blocking || 0) > 0
        || clientRemediation.readyForRuntime === false,
      evidence: {
        routeId: clientRemediation.route?.routeId || null,
        blocking: clientRemediation.counters?.blocking || 0,
        waiting: clientRemediation.counters?.waiting || 0,
        readyForClient: clientRemediation.readyForClient === true
      }
    },
    {
      id: "operator-runbook",
      phase: "operator-runbook",
      status: runbook.state || runbook.status || "unknown",
      owner: runbook.owner || "operator",
      nextAction: runbook.nextAction || "refresh-operational-runbook",
      retryable: runbook.retry?.retryable === true,
      blocksRuntimeStart: (runbook.counters?.blockers || 0) > 0,
      evidence: {
        blockers: runbook.counters?.blockers || 0,
        warnings: runbook.counters?.warnings || 0,
        retryableFailures: runbook.retry?.retryableFailures || 0
      }
    }
  ]);
  const blockingRows = sourceRows.filter((row) => row.blocksRuntimeStart || row.status === "blocked");
  const degradedRows = sourceRows.filter((row) => row.status === "degraded" || row.status === "needs-operator-action");
  const retryableRows = sourceRows.filter((row) => row.retryable);
  const status = blockingRows.length > 0
    ? "blocked"
    : degradedRows.length > 0 || retryableRows.length > 0 || health.degradedMode === true
      ? "degraded"
      : "ready";
  const nextRow = blockingRows[0] || retryableRows[0] || degradedRows[0] || sourceRows[0];
  const resumeToken = exportSummary.resumeToken
    || statusLedger.resumeToken
    || `${metadata.jobId}:operational-health:${status}`.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const statusRevision = exportSummary.statusRevision
    || statusLedger.statusRevision
    || `${metadata.jobId}:${status}`;

  return {
    schemaVersion: "aios.mailchimp.operational-health-report-artifact.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    reportId: `${metadata.jobId}:operational-health-report:${statusRevision}`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
    status,
    healthLevel: blockingRows.length > 0 ? "unhealthy" : status === "degraded" ? "degraded" : "healthy",
    exportReady: blockingRows.length === 0,
    readyForRuntimeStart: blockingRows.length === 0
      && serviceLevelObjectives.readyForRuntimeRelease !== false
      && runtimeReleaseControls.readyForRuntimeStart !== false,
    nextAction: nextRow?.nextAction || health.retry?.nextAction || "handoff-to-runtime-adapter",
    resumeToken,
    statusRevision,
    counters: {
      rows: sourceRows.length,
      blocking: blockingRows.length,
      degraded: degradedRows.length,
      retryable: retryableRows.length,
      clientVisibleIncidents: incidents.counts?.clientVisible || incidents.summary?.clientVisible || 0,
      providerVisibleIncidents: incidents.counts?.providerVisible || incidents.summary?.providerVisible || 0
    },
    rows: sourceRows,
    exportSummary: {
      artifactName: "operational-health-report.json",
      blockingRowIds: blockingRows.map((row) => row.id),
      degradedRowIds: degradedRows.map((row) => row.id),
      retryableRowIds: retryableRows.map((row) => row.id),
      latestSnapshotId: metadata.history?.latestSnapshotId || null,
      timelineRowId: metadata.history?.reportingTimeline?.latestRowId || null,
      externalWritesPerformed: false
    },
    clientPatch: {
      operationalHealthReportArtifact: "operational-health-report.json",
      operationalHealthReportStatus: status,
      operationalHealthReportLevel: blockingRows.length > 0 ? "unhealthy" : status === "degraded" ? "degraded" : "healthy",
      operationalHealthReportNextAction: nextRow?.nextAction || health.retry?.nextAction || "handoff-to-runtime-adapter",
      operationalHealthReportBlocking: blockingRows.length,
      operationalHealthReportRetryable: retryableRows.length,
      operationalHealthReportResumeToken: resumeToken
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-operational-health-report-revision",
      resumeToken,
      statusRevision,
      externalWritesPerformed: false
    }
  };
}

function buildOperationalIncidentExportArtifact(metadata, diagnostics, assembled = {}) {
  const incidents = diagnostics.operationalIncidents || {};
  const failureState = diagnostics.failureState || {};
  const statusLedger = diagnostics.statusLedger || {};
  const healthReport = assembled.operationalHealthReport || {};
  const incidentRows = Array.isArray(incidents.incidents) ? incidents.incidents : [];
  const failureRows = Array.isArray(failureState.queue) ? failureState.queue : [];
  const rows = [
    ...incidentRows.map((incident, index) => ({
      id: incident.id || `incident-${String(index + 1).padStart(2, "0")}`,
      order: index + 1,
      source: "operational-incident-queue",
      jobId: incident.jobId || metadata.jobId,
      code: incident.code || incident.reason || "operational.incident",
      status: incident.status || (incident.handoff?.blocksRuntimeStart ? "blocked" : "degraded"),
      severity: incident.severity || (incident.handoff?.blocksRuntimeStart ? "error" : "warning"),
      owner: incident.owner || "operator",
      nextAction: incident.nextAction || incidents.nextAction || "review-operational-incident",
      retryable: incident.retry?.retryable === true,
      blocksRuntimeStart: incident.handoff?.blocksRuntimeStart === true || incident.status === "blocked",
      clientVisible: incident.clientVisible === true,
      providerVisible: incident.providerVisible === true,
      resumeCursor: incident.handoff?.resumeCursor || statusLedger.resumeToken || null,
      evidence: incident.evidence || {}
    })),
    ...failureRows.map((failure, index) => ({
      id: failure.id || `failure-${String(index + 1).padStart(2, "0")}`,
      order: incidentRows.length + index + 1,
      source: "adapter-failure-state",
      jobId: failure.jobId || metadata.jobId,
      code: failure.code || "adapter.failure",
      status: failure.status || failureState.mode || "degraded",
      severity: failure.blocking === true || failure.status === "blocked" ? "error" : "warning",
      owner: "runtime-adapter",
      nextAction: failure.nextAction || failure.retry?.nextAction || failureState.adapterHandoff?.nextAction || "review-adapter-failure",
      retryable: failure.retry?.retryable === true,
      blocksRuntimeStart: failure.blocking === true || failure.status === "blocked",
      clientVisible: failure.clientVisible === true,
      providerVisible: true,
      resumeCursor: failure.retry?.resumeCursor || failureState.adapterHandoff?.resumeFromFailureId || statusLedger.resumeToken || null,
      evidence: {
        failureClass: failure.failureClass || failure.retry?.failureClass || null,
        attempts: failure.retry?.attempts || 0,
        backoffMs: failure.retry?.backoffMs || 0
      }
    }))
  ].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const blocking = rows.filter((row) => row.blocksRuntimeStart || row.status === "blocked");
  const retryable = rows.filter((row) => row.retryable);
  const clientVisible = rows.filter((row) => row.clientVisible);
  const providerVisible = rows.filter((row) => row.providerVisible);
  const nextRow = blocking[0] || retryable[0] || rows[0] || null;
  const status = blocking.length > 0
    ? "blocked"
    : rows.length > 0 || healthReport.status === "degraded"
      ? "degraded"
      : "ready";
  const resumeToken = incidents.resumeToken
    || healthReport.resumeToken
    || statusLedger.resumeToken
    || `${metadata.jobId}:operational-incidents:${status}`.replace(/[^a-zA-Z0-9_.:-]/g, "_");

  return {
    schemaVersion: "aios.mailchimp.operational-incident-export-artifact.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    status,
    exportReady: blocking.length === 0,
    resumeToken,
    statusRevision: healthReport.statusRevision || statusLedger.statusRevision || `${metadata.jobId}:${status}`,
    nextAction: nextRow?.nextAction || incidents.nextAction || healthReport.nextAction || "handoff-to-runtime-adapter",
    rows,
    counters: {
      rows: rows.length,
      blocking: blocking.length,
      retryable: retryable.length,
      clientVisible: clientVisible.length,
      providerVisible: providerVisible.length,
      failures: failureRows.length,
      incidents: incidentRows.length
    },
    exportSummary: {
      blockingRowIds: blocking.map((row) => row.id),
      retryableRowIds: retryable.map((row) => row.id),
      ownerBuckets: rows.reduce((counts, row) => {
        counts[row.owner] = (counts[row.owner] || 0) + 1;
        return counts;
      }, {}),
      nextRowId: nextRow?.id || null
    },
    clientPatch: {
      operationalIncidentExportStatus: status,
      operationalIncidentExportReady: blocking.length === 0,
      operationalIncidentExportNextAction: nextRow?.nextAction || incidents.nextAction || healthReport.nextAction || "handoff-to-runtime-adapter",
      operationalIncidentExportBlockingRows: blocking.map((row) => row.id),
      operationalIncidentExportResumeToken: resumeToken
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-operational-incident-row-id",
      resumeToken,
      externalWritesPerformed: false
    }
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

function buildClientRemediationPacketArtifact(metadata, diagnostics) {
  const summary = metadata.clientRemediation || diagnostics.clientRemediationPacket || {};
  const route = summary.route || {};
  const steps = Array.isArray(summary.steps) ? summary.steps : [];
  const blocking = steps.filter((step) => step.status === "blocked");
  const waiting = steps.filter((step) => step.status === "waiting");
  const status = summary.status
    || (blocking.length > 0
      ? "blocked"
      : waiting.length > 0
        ? "needs-operator-action"
        : "ready");
  const resumeToken = route.resumeToken
    || diagnostics.statusLedger?.resumeToken
    || metadata.exports?.summary?.resumeToken
    || `${metadata.jobId}:client-remediation:${status}`.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const statusRevision = route.statusRevision
    || diagnostics.statusLedger?.statusRevision
    || metadata.exports?.summary?.statusRevision
    || `${metadata.jobId}:${status}`;
  const routeId = route.routeId
    || `${metadata.jobId}:client-remediation:${status}`.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const nextStep = steps.find((step) => step.id === summary.nextStepId)
    || blocking[0]
    || waiting[0]
    || steps[0]
    || null;

  return {
    schemaVersion: "aios.mailchimp.client-remediation-packet-artifact.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    status,
    visibleStatus: summary.visibleStatus || status,
    readyForClient: summary.readyForClient === true,
    readyForRuntime: summary.readyForRuntime === true,
    nextAction: summary.nextAction || nextStep?.nextAction || "handoff-to-runtime-adapter",
    route: {
      routeId,
      idempotencyKey: route.idempotencyKey || `${routeId}:${statusRevision}:${resumeToken}`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      target: route.target || "client-runtime",
      resumeToken,
      statusRevision
    },
    counters: {
      steps: summary.counters?.steps || steps.length,
      blocking: summary.counters?.blocking || blocking.length,
      waiting: summary.counters?.waiting || waiting.length,
      clientVisibleIncidents: summary.counters?.clientVisibleIncidents || 0,
      runtimeBlockingIncidents: summary.counters?.runtimeBlockingIncidents || 0
    },
    groups: summary.groups || {
      missingStateKeys: [],
      pendingAckKeys: [],
      missingSettings: [],
      blockedGateIds: []
    },
    steps: steps.map((step, index) => ({
      id: step.id || `${routeId}:step:${String(index + 1).padStart(2, "0")}`,
      order: index + 1,
      kind: step.kind || "remediation-step",
      status: step.status || "ready",
      owner: step.owner || "client-runtime",
      nextAction: step.nextAction || summary.nextAction || "handoff-to-runtime-adapter"
    })),
    clientPatch: {
      ...(summary.clientPatch || {}),
      clientRemediationArtifact: "client-remediation-packet.json",
      clientRemediationStatus: status,
      clientRemediationNextAction: summary.nextAction || nextStep?.nextAction || "handoff-to-runtime-adapter",
      clientRemediationRouteId: routeId,
      clientRemediationResumeToken: resumeToken,
      clientRemediationStatusRevision: statusRevision
    },
    restartSemantics: {
      replaySafe: summary.restartSemantics?.replaySafe !== false,
      duplicateCommandPolicy: summary.restartSemantics?.duplicateCommandPolicy || "dedupe-by-client-remediation-route",
      resumeToken,
      statusRevision,
      resumeFromStepId: nextStep?.id || null,
      externalWritesPerformed: false
    }
  };
}

function buildServiceLevelObjectiveExportArtifact(metadata, diagnostics) {
  const summary = metadata.serviceLevelObjectives || diagnostics.serviceLevelObjectives || {};
  const objectives = Array.isArray(summary.objectives) ? summary.objectives : [];
  const breaches = Array.isArray(summary.breaches) ? summary.breaches : [];
  const blocking = breaches.filter((breach) => breach.blocksRuntimeRelease === true);
  const status = summary.status
    || (blocking.length > 0
      ? "blocked"
      : breaches.length > 0
        ? "degraded"
        : "ready");
  const resumeToken = diagnostics.statusLedger?.resumeToken
    || metadata.exports?.summary?.resumeToken
    || `${metadata.jobId}:service-level-objectives:${status}`.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const rows = objectives.map((objective, index) => {
    const breach = breaches.find((item) => item.objectiveId === objective.id) || null;
    return {
      id: `${metadata.jobId}:slo-export:${String(index + 1).padStart(2, "0")}:${objective.id}`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      order: index + 1,
      objectiveId: objective.id,
      label: objective.label,
      status: objective.status || (breach ? "breached" : "satisfied"),
      owner: objective.owner || breach?.owner || "runtime",
      observed: objective.observed,
      target: objective.target,
      unit: objective.unit,
      breachId: breach?.id || null,
      blocksRuntimeRelease: breach?.blocksRuntimeRelease === true,
      nextAction: breach?.nextAction || objective.nextAction || summary.nextAction || "handoff-to-runtime-adapter"
    };
  });
  const nextRow = rows.find((row) => row.blocksRuntimeRelease)
    || rows.find((row) => row.status === "breached")
    || null;

  return {
    schemaVersion: "aios.mailchimp.service-level-objective-export-artifact.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    status,
    healthLevel: summary.healthLevel || (status === "ready" ? "healthy" : status === "blocked" ? "unhealthy" : "degraded"),
    exportReady: status !== "blocked" && blocking.length === 0,
    readyForRuntimeRelease: summary.readyForRuntimeRelease === true && blocking.length === 0,
    resumeToken,
    nextAction: nextRow?.nextAction || summary.nextAction || "handoff-to-runtime-adapter",
    nextBreachId: nextRow?.breachId || summary.nextBreachId || null,
    counters: {
      objectives: rows.length,
      satisfied: rows.filter((row) => row.status === "satisfied").length,
      breached: breaches.length,
      blocking: blocking.length,
      retryable: summary.counters?.retryable || 0
    },
    rows,
    exportSummary: {
      artifactName: "service-level-objectives.json",
      rowIds: rows.map((row) => row.id),
      breachIds: breaches.map((breach) => breach.id).filter(Boolean),
      blockingBreachIds: blocking.map((breach) => breach.id).filter(Boolean),
      externalWritesPerformed: false
    },
    clientPatch: {
      ...(summary.clientPatch || {}),
      serviceLevelObjectiveArtifact: "service-level-objectives.json",
      serviceLevelObjectiveExportStatus: status,
      serviceLevelObjectiveExportReady: status !== "blocked" && blocking.length === 0,
      serviceLevelObjectiveExportNextAction: nextRow?.nextAction || summary.nextAction || "handoff-to-runtime-adapter"
    },
    restartSemantics: {
      replaySafe: summary.restartSemantics?.replaySafe !== false,
      duplicateCommandPolicy: summary.restartSemantics?.duplicateCommandPolicy || "dedupe-by-service-level-objective-export",
      resumeToken,
      resumeFromBreachId: nextRow?.breachId || summary.restartSemantics?.resumeFromBreachId || null,
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

function buildClientRuntimeSettingsArtifact(metadata, diagnostics) {
  const settings = metadata.clientRuntimeSettings
    || diagnostics.clientRuntimeSettings
    || {};
  const controls = settings.controls || {};
  const missingRequiredSettings = normalizeArtifactList(settings.missingRequiredSettings);
  const status = settings.status
    || (missingRequiredSettings.length > 0
      ? "needs-operator-action"
      : settings.readyForClientRuntime === true
        ? "ready"
        : "waiting-for-client");
  const settingsRevision = settings.settingsRevision
    || `${metadata.jobId}:client-runtime-settings:${status}`.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const nextAction = settings.nextAction
    || (missingRequiredSettings.length > 0
      ? "hydrate-mailchimp-client-runtime-settings"
      : settings.revisionAccepted === false
        ? "accept-mailchimp-client-settings"
        : "handoff-to-runtime-adapter");

  return {
    schemaVersion: "aios.mailchimp.client-runtime-settings-artifact.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    status,
    settingsRevision,
    acceptedSettingsRevision: settings.acceptedSettingsRevision || null,
    revisionAccepted: settings.revisionAccepted !== false,
    readyForClientRuntime: settings.readyForClientRuntime === true
      && missingRequiredSettings.length === 0
      && settings.revisionAccepted !== false,
    requiredSettingKeys: normalizeArtifactList(settings.requiredSettingKeys),
    providedSettingKeys: normalizeArtifactList(settings.providedSettingKeys),
    missingRequiredSettings,
    effectiveSettings: settings.effectiveSettings || {},
    controls: {
      previewEnabled: controls.previewEnabled === true,
      runtimeStartEnabled: controls.runtimeStartEnabled === true,
      schedulePaused: controls.schedulePaused === true,
      scheduleWindow: controls.scheduleWindow || "runtime",
      scheduleSupported: controls.scheduleSupported !== false,
      runtimeStartBlocked: controls.runtimeStartBlocked === true
    },
    adoption: {
      adoptionId: settings.adoption?.adoptionId || metadata.clientRuntimeAdoption?.adoptionId || null,
      status: settings.adoption?.status || metadata.clientRuntimeAdoption?.status || "unknown",
      readyForClientRuntime: settings.adoption?.readyForClientRuntime === true
        || metadata.clientRuntimeAdoption?.readyForClientRuntime === true,
      missingStateKeys: normalizeArtifactList(settings.adoption?.missingStateKeys || metadata.clientRuntimeAdoption?.missingStateKeys),
      pendingAckKeys: normalizeArtifactList(settings.adoption?.pendingAckKeys || metadata.clientRuntimeAdoption?.commandAck?.pendingKeys)
    },
    validationSummary: settings.validationSummary || {
      missingRequiredSettings: missingRequiredSettings.length,
      revisionAccepted: settings.revisionAccepted !== false,
      diagnosticIds: settings.diagnosticIds || []
    },
    clientPatch: {
      ...(settings.clientPatch || {}),
      clientRuntimeSettingsArtifact: "client-runtime-settings.json",
      mailchimpClientSettingsStatus: status,
      mailchimpClientSettingsRevision: settingsRevision,
      mailchimpClientSettingsNextAction: nextAction
    },
    restartSemantics: {
      replaySafe: settings.restartSemantics?.replaySafe !== false,
      duplicateCommandPolicy: settings.restartSemantics?.duplicateCommandPolicy
        || "dedupe-by-client-settings-revision",
      resumeFromSettingsRevision: settings.restartSemantics?.resumeFromSettingsRevision || settingsRevision,
      externalWritesPerformed: false
    },
    nextAction
  };
}

function buildSettingsRolloutGateArtifact(metadata, diagnostics, clientRuntimeSettings) {
  const gate = metadata.settingsRolloutGate
    || diagnostics.settingsRolloutGate
    || {};
  const checkpoints = Array.isArray(gate.checkpoints) ? gate.checkpoints : [];
  const blockedCheckpoints = checkpoints.filter((checkpoint) => checkpoint.ready !== true);
  const settingsRevision = gate.settingsRevision
    || clientRuntimeSettings.settingsRevision
    || `${metadata.jobId}:settings-rollout`;
  const rolloutKey = gate.rolloutKey
    || `${metadata.jobId}:settings-rollout:${settingsRevision}:${gate.rolloutWindow || "runtime"}`
      .replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const readyForRuntimeStart = gate.readyForRuntimeStart === true
    && blockedCheckpoints.length === 0
    && clientRuntimeSettings.readyForClientRuntime === true;
  const status = gate.status
    || (readyForRuntimeStart ? "ready" : "blocked");
  const nextAction = gate.nextAction
    || blockedCheckpoints[0]?.nextAction
    || clientRuntimeSettings.nextAction
    || "accept-mailchimp-client-settings";

  return {
    schemaVersion: "aios.mailchimp.settings-rollout-gate-artifact.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    status,
    readyForRuntimeStart,
    rolloutKey,
    settingsRevision,
    acknowledgedRevision: gate.acknowledgedRevision || clientRuntimeSettings.acceptedSettingsRevision || null,
    revisionAcknowledged: gate.revisionAcknowledged !== false,
    rolloutWindow: gate.rolloutWindow || clientRuntimeSettings.controls?.scheduleWindow || "runtime",
    enabled: gate.enabled !== false,
    held: gate.held === true,
    nextAction,
    nextGateId: gate.nextGateId || blockedCheckpoints[0]?.gateId || null,
    checkpoints: checkpoints.map((checkpoint, index) => ({
      id: checkpoint.id || `${metadata.jobId}.settingsRollout.${String(index + 1).padStart(2, "0")}`,
      gateId: checkpoint.gateId || checkpoint.id || `settings-rollout-${index + 1}`,
      order: checkpoint.order || index + 1,
      label: checkpoint.label || checkpoint.gateId || "Settings rollout gate",
      state: checkpoint.state || (checkpoint.ready ? "ready" : "blocked"),
      ready: checkpoint.ready === true,
      required: checkpoint.required !== false,
      nextAction: checkpoint.nextAction || nextAction,
      diagnosticCode: checkpoint.diagnosticCode || "client.settings.rollout.held",
      evidence: checkpoint.evidence || {}
    })),
    counters: {
      total: gate.counters?.total || checkpoints.length,
      ready: gate.counters?.ready || checkpoints.filter((checkpoint) => checkpoint.ready).length,
      blocked: gate.counters?.blocked || blockedCheckpoints.length
    },
    clientPatch: {
      ...(gate.clientPatch || {}),
      settingsRolloutGateArtifact: "settings-rollout-gate.json",
      mailchimpSettingsRolloutStatus: status,
      mailchimpSettingsRolloutReady: readyForRuntimeStart,
      mailchimpSettingsRolloutKey: rolloutKey,
      mailchimpSettingsRolloutNextAction: nextAction,
      mailchimpSettingsRolloutNextGateId: gate.nextGateId || blockedCheckpoints[0]?.gateId || null,
      mailchimpSettingsRolloutBlockedGateIds: gate.clientPatch?.mailchimpSettingsRolloutBlockedGateIds
        || blockedCheckpoints.map((checkpoint) => checkpoint.gateId).filter(Boolean)
    },
    restartSemantics: {
      replaySafe: gate.restartSemantics?.replaySafe !== false,
      duplicateCommandPolicy: gate.restartSemantics?.duplicateCommandPolicy || "dedupe-by-settings-rollout-key",
      resumeFromRolloutKey: gate.restartSemantics?.resumeFromRolloutKey || rolloutKey,
      externalWritesPerformed: false
    }
  };
}

function buildClientStatusHandoffArtifact(metadata, diagnostics) {
  const handoff = metadata.clientStatusHandoff
    || diagnostics.clientStatusHandoff
    || {};
  const route = handoff.route || {};
  const ledger = handoff.statusLedger || {};
  const commandAck = handoff.commandAck || {};
  const blocking = handoff.blocking || {};
  const pendingAckKeys = normalizeArtifactList(commandAck.pendingKeys);
  const status = handoff.status
    || (blocking.runtimeBlocked
      ? "blocked"
      : pendingAckKeys.length > 0 || ledger.revisionAccepted === false
        ? "waiting-for-client"
        : "ready");
  const statusId = handoff.statusId
    || `${metadata.jobId}:client-status:${status}:${ledger.statusRevision || "missing"}`
      .replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const routeId = route.routeId
    || `${metadata.jobId}:client-status-route`.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const nextAction = handoff.nextAction
    || (blocking.resumeMissing
      ? "restore-mailchimp-runtime-resume-token"
      : blocking.staleRevision
        ? "refresh-mailchimp-client-status"
        : pendingAckKeys.length > 0
          ? "acknowledge-mailchimp-client-command"
          : "handoff-to-runtime-adapter");

  return {
    schemaVersion: "aios.mailchimp.client-status-handoff-artifact.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    statusId,
    status,
    visibleStatus: handoff.visibleStatus || status,
    readyForClient: handoff.readyForClient === true,
    readyForRuntime: handoff.readyForRuntime === true,
    nextAction,
    route: {
      routeId,
      method: route.method || "PATCH",
      path: route.path || `/mailchimp/jobs/${metadata.jobId}/client-status`,
      idempotencyKey: route.idempotencyKey || `${routeId}:${ledger.statusRevision || "missing"}`
        .replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      bodyShape: route.bodyShape || {
        statusRevision: "string",
        acceptedStatusRevision: "string",
        acknowledgedCommandKeys: "array",
        resumeToken: "string"
      }
    },
    statusLedger: {
      resumeToken: ledger.resumeToken || diagnostics.statusLedger?.resumeToken || null,
      statusRevision: ledger.statusRevision || diagnostics.statusLedger?.statusRevision || null,
      acceptedStatusRevision: ledger.acceptedStatusRevision || null,
      revisionAccepted: ledger.revisionAccepted !== false,
      readinessStatus: ledger.readinessStatus || diagnostics.status,
      visibleStatus: ledger.visibleStatus || handoff.visibleStatus || status
    },
    commandAck: {
      required: commandAck.required === true || pendingAckKeys.length > 0,
      requiredKeys: normalizeArtifactList(commandAck.requiredKeys),
      pendingKeys: pendingAckKeys,
      acknowledgedKeys: normalizeArtifactList(commandAck.acknowledgedKeys),
      ready: pendingAckKeys.length === 0
    },
    blocking: {
      runtimeBlocked: blocking.runtimeBlocked === true,
      resumeMissing: blocking.resumeMissing === true,
      staleRevision: blocking.staleRevision === true,
      pendingAckKeys,
      missingStateKeys: normalizeArtifactList(blocking.missingStateKeys),
      missingRequiredSettings: normalizeArtifactList(blocking.missingRequiredSettings)
    },
    validationSummary: {
      pendingAckKeys: pendingAckKeys.length,
      missingStateKeys: normalizeArtifactList(blocking.missingStateKeys).length,
      missingRequiredSettings: normalizeArtifactList(blocking.missingRequiredSettings).length,
      revisionAccepted: ledger.revisionAccepted !== false,
      diagnosticIds: handoff.diagnosticIds || []
    },
    clientPatch: {
      ...(handoff.clientPatch || {}),
      clientStatusHandoffArtifact: "client-status-handoff.json",
      mailchimpClientStatusId: statusId,
      mailchimpClientVisibleStatus: handoff.visibleStatus || status,
      mailchimpClientStatusNextAction: nextAction,
      mailchimpClientStatusReady: handoff.readyForClient === true,
      mailchimpClientRuntimeReady: handoff.readyForRuntime === true
    },
    restartSemantics: {
      replaySafe: handoff.restartSemantics?.replaySafe !== false,
      duplicateCommandPolicy: handoff.restartSemantics?.duplicateCommandPolicy
        || "dedupe-by-client-status-route-id",
      resumeFromStatusId: handoff.restartSemantics?.resumeFromStatusId || statusId,
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

function buildProviderSyncCheckpointArtifact(metadata, diagnostics, providerServiceHandoff) {
  const source = metadata.providerSyncCheckpoint || diagnostics.providerSyncCheckpoint || {};
  const rows = Array.isArray(source.rows)
    ? source.rows
    : Array.isArray(source.checkpointRows)
      ? source.checkpointRows
      : [];
  const missingAckMounts = normalizeArtifactList(source.missingAckMounts);
  const missingWatermarkMounts = normalizeArtifactList(source.missingWatermarkMounts);
  const missingHandoffMounts = normalizeArtifactList(source.missingHandoffMounts);
  const status = source.status
    || (missingHandoffMounts.length > 0
      ? "blocked"
      : missingAckMounts.length > 0 || missingWatermarkMounts.length > 0
        ? "needs-operator-action"
        : "ready");
  const ready = source.ready === true
    || (status === "ready" && rows.every((row) => row.ready === true));
  const nextAction = source.nextAction
    || (missingHandoffMounts.length > 0
      ? "declare-provider-sync-handoff"
      : missingAckMounts.length > 0
        ? "acknowledge-mailchimp-provider-sync"
        : missingWatermarkMounts.length > 0
          ? "restore-mailchimp-sync-watermark"
          : "handoff-to-runtime-adapter");
  const resumeToken = source.resumeToken
    || `${metadata.jobId}:provider-sync:${status}`.replace(/[^a-zA-Z0-9_.:-]/g, "_");

  return {
    schemaVersion: "aios.mailchimp.provider-sync-checkpoint-artifact.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    providerService: source.providerService
      || providerServiceHandoff.providerService
      || "mailchimp-marketing-api",
    status,
    ready,
    syncRequired: source.syncRequired === true
      || providerServiceHandoff.syncMetadata?.syncRequired === true,
    nextAction,
    resumeToken,
    idempotencyKey: source.idempotencyKey
      || `${providerServiceHandoff.externalHandoff?.idempotencyKey || metadata.jobId}:sync-checkpoint`,
    rows: rows.map((row, index) => ({
      order: index + 1,
      name: row.name,
      syncDirection: row.syncDirection || "local-only",
      capability: row.capability || null,
      externalHandoff: row.externalHandoff || "not-required",
      ackKey: row.ackKey || `${metadata.jobId}:provider-sync:${row.name || index}`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      acknowledged: row.acknowledged === true,
      watermark: row.watermark || null,
      ready: row.ready === true,
      nextAction: row.nextAction || nextAction
    })),
    missingAckMounts,
    missingWatermarkMounts,
    missingHandoffMounts,
    counters: {
      total: rows.length,
      ready: rows.filter((row) => row.ready === true).length,
      missingAck: missingAckMounts.length,
      missingWatermark: missingWatermarkMounts.length,
      missingHandoff: missingHandoffMounts.length
    },
    diagnosticIds: source.diagnosticIds || [],
    clientPatch: {
      ...(source.clientPatch || {}),
      providerSyncCheckpointArtifact: "provider-sync-checkpoint.json",
      providerSyncCheckpointStatus: status,
      providerSyncCheckpointReady: ready,
      providerSyncCheckpointNextAction: nextAction
    },
    restartSemantics: {
      replaySafe: source.restartSemantics?.replaySafe !== false,
      duplicateCommandPolicy: source.restartSemantics?.duplicateCommandPolicy
        || "dedupe-by-provider-sync-ack-key",
      resumeFromAckKey: source.restartSemantics?.resumeFromAckKey
        || rows.find((row) => row.ready !== true)?.ackKey
        || null,
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

function buildProviderIntegrationHandoffArtifact(
  metadata,
  diagnostics,
  providerServiceHandoff,
  providerSyncCheckpoint,
  providerReleaseReadiness
) {
  const source = metadata.providerIntegrationHandoff
    || metadata.dryRun?.providerIntegrationHandoff
    || metadata.exports?.summary?.providerIntegrationHandoff
    || diagnostics.providerIntegrationHandoff
    || {};
  const credentialLease = metadata.providerCredentialLease
    || metadata.dryRun?.providerCredentialLease
    || diagnostics.providerCredentialLease
    || {};
  const serviceReady = providerServiceHandoff.externalHandoff?.ready === true;
  const syncReady = providerSyncCheckpoint.ready === true
    && providerSyncCheckpoint.missingAckMounts.length === 0
    && providerSyncCheckpoint.missingWatermarkMounts.length === 0
    && providerSyncCheckpoint.missingHandoffMounts.length === 0;
  const releaseReady = providerReleaseReadiness.ready === true;
  const missingCapabilities = normalizeArtifactList(
    providerReleaseReadiness.capabilityNegotiation?.missing
      || providerServiceHandoff.capabilityNegotiation?.unnegotiated
  );
  const blockedJobIds = normalizeArtifactList(providerReleaseReadiness.validationSummary?.blockedJobIds);
  const waitingJobIds = normalizeArtifactList(providerReleaseReadiness.validationSummary?.waitingJobIds);
  const credentialBlockedScopes = normalizeArtifactList(
    credentialLease.blockedScopes
      || source.credentialLease?.blockedScopes
      || []
  );
  const credentialWaitingScopes = normalizeArtifactList(
    credentialLease.waitingScopes
      || source.credentialLease?.waitingScopes
      || []
  );
  const credentialReady = credentialLease.ready === true
    || source.credentialLease?.ready === true
    || (credentialBlockedScopes.length === 0 && credentialWaitingScopes.length === 0);
  const gateRows = [
    {
      gateId: "provider-service",
      state: serviceReady ? "ready" : "blocked",
      required: true,
      nextAction: serviceReady
        ? "continue-provider-integration"
        : providerServiceHandoff.clientPatch?.nextAction || providerServiceHandoff.nextAction || "repair-provider-service-handoff",
      evidence: {
        providerService: providerServiceHandoff.providerService,
        handoffKey: providerServiceHandoff.externalHandoff?.idempotencyKey || null,
        serviceScopes: providerServiceHandoff.syncMetadata?.serviceScopes || []
      }
    },
    {
      gateId: "provider-sync",
      state: syncReady ? "ready" : providerSyncCheckpoint.status === "blocked" ? "blocked" : "waiting",
      required: providerSyncCheckpoint.syncRequired === true,
      nextAction: syncReady
        ? "continue-provider-integration"
        : providerSyncCheckpoint.nextAction || "refresh-provider-sync-checkpoint",
      evidence: {
        resumeToken: providerSyncCheckpoint.resumeToken,
        missingAckMounts: providerSyncCheckpoint.missingAckMounts,
        missingWatermarkMounts: providerSyncCheckpoint.missingWatermarkMounts,
        missingHandoffMounts: providerSyncCheckpoint.missingHandoffMounts
      }
    },
    {
      gateId: "provider-credential-lease",
      state: credentialReady ? "ready" : credentialBlockedScopes.length > 0 ? "blocked" : "waiting",
      required: providerServiceHandoff.externalHandoff?.required === true,
      nextAction: credentialReady
        ? "continue-provider-integration"
        : credentialBlockedScopes.length > 0
          ? "repair-provider-credential-lease"
          : "collect-provider-credential-consent",
      evidence: {
        blockedScopes: credentialBlockedScopes,
        waitingScopes: credentialWaitingScopes,
        resumeCursor: credentialLease.resumeCursor || source.credentialLease?.resumeCursor || null
      }
    },
    {
      gateId: "provider-release-readiness",
      state: releaseReady ? "ready" : providerReleaseReadiness.status === "blocked" ? "blocked" : "waiting",
      required: true,
      nextAction: releaseReady
        ? "release-provider-handoff"
        : providerReleaseReadiness.nextAction || "repair-provider-release-readiness",
      evidence: {
        releaseContractId: providerReleaseReadiness.releaseContractId,
        blockedJobIds,
        waitingJobIds,
        missingCapabilities
      }
    }
  ];
  const requiredBlocked = gateRows.filter((gate) => gate.required && gate.state === "blocked");
  const requiredWaiting = gateRows.filter((gate) => gate.required && gate.state === "waiting");
  const status = requiredBlocked.length > 0
    ? "blocked"
    : requiredWaiting.length > 0
      ? "needs-operator-action"
      : "ready";
  const nextGate = requiredBlocked[0] || requiredWaiting[0] || gateRows.find((gate) => gate.state !== "ready") || null;
  const resumeToken = source.resumeToken
    || providerSyncCheckpoint.resumeToken
    || providerReleaseReadiness.externalHandoff?.handoffId
    || `${metadata.jobId}:provider-integration:${status}`.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const integrationKey = source.integrationKey
    || `${metadata.jobId}:${providerServiceHandoff.providerService}:${resumeToken}`.replace(/[^a-zA-Z0-9_.:-]/g, "_");

  return {
    schemaVersion: "aios.mailchimp.provider-integration-handoff-artifact.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    integrationKey,
    providerService: providerServiceHandoff.providerService,
    status,
    readyForRuntime: status === "ready",
    nextAction: nextGate?.nextAction || providerReleaseReadiness.nextAction || "release-provider-handoff",
    nextGateId: nextGate?.gateId || null,
    resumeToken,
    gates: gateRows,
    capabilityNegotiation: {
      requested: providerReleaseReadiness.capabilityNegotiation?.requested
        || providerServiceHandoff.capabilityNegotiation?.required
        || [],
      missing: missingCapabilities,
      complete: missingCapabilities.length === 0
    },
    sync: {
      ready: syncReady,
      checkpointArtifact: "provider-sync-checkpoint.json",
      resumeToken: providerSyncCheckpoint.resumeToken,
      missingAckMounts: providerSyncCheckpoint.missingAckMounts,
      missingWatermarkMounts: providerSyncCheckpoint.missingWatermarkMounts
    },
    externalHandoff: {
      target: providerServiceHandoff.externalHandoff?.target || providerServiceHandoff.providerService,
      required: providerServiceHandoff.externalHandoff?.required === true,
      ready: status === "ready",
      idempotencyKey: providerServiceHandoff.externalHandoff?.idempotencyKey || integrationKey,
      releaseCommandId: providerReleaseReadiness.externalHandoff?.releaseCommandId || null,
      externalWritesPerformed: false
    },
    validationSummary: {
      total: gateRows.length,
      ready: gateRows.filter((gate) => gate.state === "ready").length,
      blocked: requiredBlocked.length,
      waiting: requiredWaiting.length,
      blockedGateIds: requiredBlocked.map((gate) => gate.gateId),
      waitingGateIds: requiredWaiting.map((gate) => gate.gateId),
      blockedJobIds,
      waitingJobIds,
      missingCapabilities,
      credentialBlockedScopes,
      credentialWaitingScopes
    },
    clientPatch: {
      ...(source.clientPatch || {}),
      providerIntegrationHandoffArtifact: "provider-integration-handoff.json",
      providerIntegrationKey: integrationKey,
      providerIntegrationStatus: status,
      providerIntegrationReady: status === "ready",
      providerIntegrationNextAction: nextGate?.nextAction || providerReleaseReadiness.nextAction || "release-provider-handoff",
      providerIntegrationNextGateId: nextGate?.gateId || null,
      providerIntegrationBlockedGateIds: requiredBlocked.map((gate) => gate.gateId),
      providerIntegrationWaitingGateIds: requiredWaiting.map((gate) => gate.gateId)
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-provider-integration-key",
      resumeToken,
      resumeFromGateId: nextGate?.gateId || null,
      externalWritesPerformed: false
    }
  };
}

function buildProviderIntegrationExecutionTicketArtifact(metadata, diagnostics, providerIntegrationHandoff) {
  const source = metadata.providerIntegrationExecutionTicket
    || metadata.dryRun?.providerIntegrationExecutionTicket
    || diagnostics.providerIntegrationExecutionTicket
    || {};
  const sourceGates = Array.isArray(source.gates) && source.gates.length
    ? source.gates
    : providerIntegrationHandoff.gates || [];
  const sourceOperations = Array.isArray(source.operations) ? source.operations : [];
  const gates = sourceGates.map((gate, index) => ({
    gateId: gate.gateId || gate.id || `provider-integration-gate-${String(index + 1).padStart(2, "0")}`,
    order: gate.order || index + 1,
    label: gate.label || gate.gateId || gate.id || "Provider integration gate",
    owner: gate.owner || "runtime-adapter",
    state: gate.state || (gate.ready === true ? "ready" : "blocked"),
    required: gate.required !== false,
    nextAction: gate.nextAction || providerIntegrationHandoff.nextAction || "repair-provider-integration-handoff",
    evidence: gate.evidence || {}
  }));
  const operations = sourceOperations.map((operation, index) => ({
    sequence: operation.sequence || index + 1,
    jobId: operation.jobId || metadata.jobId,
    operation: operation.operation || "mailchimp-provider-operation",
    ticketState: operation.ticketState || operation.state || "ready",
    dryRunJobStatus: operation.dryRunJobStatus || "unknown",
    adapterStatusResumeCursor: operation.adapterStatusResumeCursor || null,
    idempotencyKey: operation.idempotencyKey || null,
    checkpointKey: operation.checkpointKey || null,
    nextAction: operation.nextAction || providerIntegrationHandoff.nextAction || "release-provider-execution-ticket"
  }));
  const blockedGates = gates.filter((gate) => gate.required && gate.state === "blocked");
  const waitingGates = gates.filter((gate) => gate.required && ["waiting", "needs-operator-action"].includes(gate.state));
  const blockedOperations = operations.filter((operation) => operation.ticketState === "blocked");
  const waitingOperations = operations.filter((operation) => ["waiting", "needs-operator-action"].includes(operation.ticketState));
  const status = blockedGates.length > 0 || blockedOperations.length > 0 || providerIntegrationHandoff.status === "blocked"
    ? "blocked"
    : waitingGates.length > 0 || waitingOperations.length > 0 || providerIntegrationHandoff.status === "needs-operator-action"
      ? "needs-operator-action"
      : "ready";
  const nextAction = blockedGates[0]?.nextAction
    || blockedOperations[0]?.nextAction
    || waitingGates[0]?.nextAction
    || waitingOperations[0]?.nextAction
    || providerIntegrationHandoff.nextAction
    || "release-provider-execution-ticket";
  const resumeCursor = source.resumeCursor
    || providerIntegrationHandoff.resumeToken
    || `${metadata.jobId}:provider-integration-execution:${status}`.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const ticketKey = source.id
    || source.ticketKey
    || `${providerIntegrationHandoff.integrationKey || metadata.jobId}:${resumeCursor}:execution-ticket`
      .replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const releaseCommandId = source.command?.id
    || source.releaseCommandId
    || `${ticketKey}:release-command`.replace(/[^a-zA-Z0-9_.:-]/g, "_");

  return {
    schemaVersion: "aios.mailchimp.provider-integration-execution-ticket-artifact.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    ticketKey,
    providerService: providerIntegrationHandoff.providerService || "mailchimp-marketing-api",
    status,
    ready: status === "ready",
    readyForRuntimeRelease: status === "ready" && providerIntegrationHandoff.readyForRuntime === true,
    nextAction,
    resumeCursor,
    releaseCommandId,
    sourceIntegrationKey: providerIntegrationHandoff.integrationKey || null,
    sourceHandoffArtifact: "provider-integration-handoff.json",
    gates,
    operations,
    routePayload: {
      routeId: "mailchimp.provider.integration.execution",
      idempotencyKey: providerIntegrationHandoff.externalHandoff?.idempotencyKey || ticketKey,
      resumeCursor,
      ticketKey,
      releaseCommandId,
      dryRunOnly: true
    },
    validationSummary: {
      totalGates: gates.length,
      readyGates: gates.filter((gate) => gate.state === "ready").length,
      blockedGateIds: blockedGates.map((gate) => gate.gateId),
      waitingGateIds: waitingGates.map((gate) => gate.gateId),
      blockedJobIds: blockedOperations.map((operation) => operation.jobId),
      waitingJobIds: waitingOperations.map((operation) => operation.jobId),
      commandIds: [releaseCommandId],
      resumeCursors: [resumeCursor, ...operations.map((operation) => operation.adapterStatusResumeCursor)]
        .filter(Boolean)
        .sort()
    },
    clientPatch: {
      ...(source.clientPatch || {}),
      providerIntegrationExecutionTicketArtifact: "provider-integration-execution-ticket.json",
      providerIntegrationExecutionTicketKey: ticketKey,
      providerIntegrationExecutionTicketStatus: status,
      providerIntegrationExecutionTicketReady: status === "ready",
      providerIntegrationExecutionTicketNextAction: nextAction,
      providerIntegrationExecutionTicketResumeCursor: resumeCursor,
      providerIntegrationExecutionTicketBlockedGates: blockedGates.map((gate) => gate.gateId),
      providerIntegrationExecutionTicketWaitingGates: waitingGates.map((gate) => gate.gateId)
    },
    restartSemantics: {
      replaySafe: status !== "blocked",
      duplicateCommandPolicy: "dedupe-by-provider-integration-execution-ticket",
      resumeCursor,
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

function buildRuntimeReleaseControlsArtifact(metadata, diagnostics, assembled = {}) {
  const source = metadata.runtimeReleaseControls || diagnostics.runtimeReleaseControls || {};
  const runtimeReleaseDecision = assembled.runtimeReleaseDecision || {};
  const lifecycleOperatorControls = assembled.lifecycleOperatorControls || {};
  const providerReleaseReadiness = assembled.providerReleaseReadiness || {};
  const commandLeaseReplayExport = assembled.commandLeaseReplayExport || {};
  const gates = Array.isArray(source.gates) ? source.gates : [];
  const blockedGates = gates.filter((gate) => gate.state === "blocked");
  const waitingGates = gates.filter((gate) => gate.state === "waiting" || gate.state === "held");
  const releaseKey = source.releaseKey
    || runtimeReleaseDecision.releaseToken
    || `${metadata.jobId}:runtime-release-controls:${source.status || "unknown"}`
      .replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const ready = source.readyForRuntimeStart === true
    && runtimeReleaseDecision.ready !== false
    && blockedGates.length === 0
    && waitingGates.length === 0;
  const status = source.status
    || (blockedGates.length > 0
      ? "blocked"
      : waitingGates.length > 0
        ? "needs-operator-action"
        : ready
          ? "ready"
          : "review");
  const nextGate = gates.find((gate) => gate.gateId === source.nextGateId)
    || blockedGates[0]
    || waitingGates[0]
    || null;
  const nextAction = ready
    ? "handoff-to-runtime-adapter"
    : source.nextAction
      || nextGate?.nextAction
      || runtimeReleaseDecision.nextAction
      || diagnostics.recovery?.nextAction
      || "review-runtime-release-controls";
  const rows = gates.map((gate, index) => ({
    id: gate.id || `${releaseKey}:gate:${index + 1}`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
    gateId: gate.gateId,
    order: gate.order || index + 1,
    label: gate.label,
    owner: gate.owner || "runtime",
    state: gate.state || "unknown",
    ready: gate.ready === true,
    required: gate.required === true,
    held: gate.held === true,
    acknowledged: gate.acknowledged === true,
    nextAction: gate.nextAction || nextAction,
    evidence: gate.evidence || {}
  }));

  return {
    schemaVersion: "aios.mailchimp.runtime-release-controls-artifact.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    status,
    readyForRuntimeStart: ready,
    acceptedForRuntime: source.acceptedForRuntime === true,
    releaseKey,
    releaseToken: runtimeReleaseDecision.releaseToken || releaseKey,
    nextAction,
    nextGateId: source.nextGateId || nextGate?.gateId || null,
    controlPlane: {
      lifecycleStatus: lifecycleOperatorControls.status || source.lifecycle?.status || "unknown",
      lifecycleRuntimeStartEnabled: lifecycleOperatorControls.runtimeStart?.enabled === true
        || source.lifecycle?.runtimeStartEnabled === true,
      providerReleaseReady: providerReleaseReadiness.ready === true,
      commandLeaseReplayReady: commandLeaseReplayExport.exportReady === true,
      runtimeReleaseDecisionReady: runtimeReleaseDecision.ready === true
    },
    counters: {
      total: source.counters?.total || rows.length,
      ready: source.counters?.ready || rows.filter((row) => row.ready).length,
      blocked: source.counters?.blocked || blockedGates.length,
      waiting: source.counters?.waiting || waitingGates.length,
      held: source.counters?.held || rows.filter((row) => row.held).length
    },
    rows,
    clientPatch: {
      ...(source.clientPatch || {}),
      runtimeReleaseControlsArtifact: "runtime-release-controls.json",
      runtimeReleaseControlsStatus: status,
      runtimeReleaseControlsReady: ready,
      runtimeReleaseControlsNextAction: nextAction,
      runtimeReleaseControlsNextGateId: source.nextGateId || nextGate?.gateId || null,
      runtimeReleaseBlockedGateIds: normalizeArtifactList(
        source.clientPatch?.runtimeReleaseBlockedGateIds || blockedGates.map((gate) => gate.gateId)
      ),
      runtimeReleaseWaitingGateIds: normalizeArtifactList(
        source.clientPatch?.runtimeReleaseWaitingGateIds || waitingGates.map((gate) => gate.gateId)
      ),
      runtimeReleaseKey: releaseKey
    },
    restartSemantics: source.restartSemantics || {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-runtime-release-control-key",
      resumeFromReleaseKey: releaseKey,
      externalWritesPerformed: false
    }
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

function buildPermissionGrantPlanArtifact(metadata, diagnostics, tenantAuditHandoff) {
  const source = diagnostics.permissionGrantPlan
    || metadata.permissionGrantPlan
    || metadata.exports?.permissionGrantPlan
    || {};
  const commands = Array.isArray(source.commands) ? source.commands : [];
  const blockingCommands = commands.filter((command) => command.blocksRuntimeStart === true || command.status === "blocked");
  const retryableCommands = commands.filter((command) => command.retryPolicy?.retryable === true);
  const auditCommand = commands.find((command) => command.kind === "audit-append") || null;
  const readyForAudit = source.safeBoundary === true
    && tenantAuditHandoff.safeBoundary === true
    && blockingCommands.length === 0
    && Boolean(auditCommand?.id);
  const status = source.status
    || (blockingCommands.length > 0
      ? "blocked"
      : readyForAudit
        ? "ready"
        : "waiting");
  const nextAction = source.nextAction
    || blockingCommands[0]?.action
    || (readyForAudit ? "append-tenant-permission-audit" : tenantAuditHandoff.handoff?.nextAction)
    || "repair-permission-grant-plan";
  const planId = `${metadata.jobId}:${source.isolationKey || tenantAuditHandoff.isolationKey || "tenant-boundary"}:permission-grants`
    .replace(/[^a-zA-Z0-9_.:-]/g, "_");

  return {
    schemaVersion: "aios.mailchimp.permission-grant-plan-artifact.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    planId,
    status,
    readyForAudit,
    safeBoundary: source.safeBoundary === true && tenantAuditHandoff.safeBoundary === true,
    isolationKey: source.isolationKey || tenantAuditHandoff.isolationKey || null,
    tenantId: source.tenantId || tenantAuditHandoff.scope?.tenantId || "tenant.local",
    workspaceId: source.workspaceId || tenantAuditHandoff.scope?.workspaceId || "workspace.local",
    nextAction,
    commands: commands.map((command, index) => ({
      id: command.id || `${planId}:command:${index + 1}`,
      order: command.order || index + 1,
      kind: command.kind || "permission-command",
      target: command.target || "",
      owner: command.owner || "operator",
      action: command.action || nextAction,
      status: command.status || "waiting",
      required: command.required === true,
      blocksRuntimeStart: command.blocksRuntimeStart === true,
      reason: command.reason || "permission-boundary",
      scope: command.scope || {},
      idempotencyKey: command.idempotencyKey || `${planId}:${command.kind || "command"}:${index + 1}`,
      retryPolicy: command.retryPolicy || {
        retryable: false,
        backoffMs: 0,
        maxAttempts: 0,
        failureClass: "permission-boundary"
      }
    })),
    summary: {
      total: source.summary?.total || commands.length,
      blocking: source.summary?.blocking || blockingCommands.length,
      roleGrants: source.summary?.roleGrants || commands.filter((command) => command.kind === "role-grant").length,
      scopePrunes: source.summary?.scopePrunes || commands.filter((command) => command.kind === "scope-prune").length,
      auditAppends: source.summary?.auditAppends || commands.filter((command) => command.kind === "audit-append").length,
      retryable: source.summary?.retryable || retryableCommands.length
    },
    auditHandoff: {
      commandId: auditCommand?.id || null,
      auditAppendMode: tenantAuditHandoff.handoff?.auditAppendMode || "local-before-adapter-release",
      auditRef: tenantAuditHandoff.handoff?.auditRefs?.[0] || `${metadata.jobId}:permission-grant-plan`,
      ready: readyForAudit,
      externalWritesPerformed: false
    },
    blockedCommandIds: blockingCommands.map((command) => command.id).filter(Boolean),
    retryableCommandIds: retryableCommands.map((command) => command.id).filter(Boolean),
    clientPatch: {
      ...(source.clientPatch || {}),
      permissionGrantPlanArtifact: "permission-grant-plan.json",
      permissionGrantPlanStatus: status,
      permissionGrantPlanReady: readyForAudit,
      permissionGrantPlanNextAction: nextAction,
      permissionGrantBlockingCount: blockingCommands.length,
      permissionGrantCommandIds: commands.map((command) => command.id).filter(Boolean)
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-permission-grant-command-id",
      resumeFromCommandId: source.restartSemantics?.resumeFromCommandId
        || blockingCommands[0]?.id
        || auditCommand?.id
        || null,
      externalWritesPerformed: false
    }
  };
}

function buildTenantPermissionEnforcementArtifact(metadata, diagnostics, permissionGrantPlan, tenantAuditHandoff) {
  const source = metadata.tenantPermissionEnforcement
    || metadata.health?.tenantPermissionEnforcement
    || diagnostics.tenantPermissionEnforcement
    || {};
  const decisions = Array.isArray(source.decisions) ? source.decisions : [];
  const blockedDecisions = decisions.filter((decision) => (
    decision.blocksRuntimeStart === true
    || decision.status === "blocked"
  ));
  const retryableDecisions = decisions.filter((decision) => decision.retryable === true);
  const audit = source.audit || {};
  const status = source.status
    || (blockedDecisions.length > 0
      ? "blocked"
      : audit.ready === true || permissionGrantPlan.readyForAudit === true
        ? "ready"
        : permissionGrantPlan.status || "needs-operator-action");
  const enforcementKey = source.enforcementKey
    || `${metadata.jobId}:${source.isolationKey || tenantAuditHandoff.isolationKey || "tenant.local_workspace.local"}:${status}`
      .replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const nextAction = source.nextAction
    || blockedDecisions[0]?.action
    || permissionGrantPlan.nextAction
    || tenantAuditHandoff.handoff?.nextAction
    || "resolve-tenant-permission-boundary";
  const auditReady = audit.ready === true
    || permissionGrantPlan.readyForAudit === true
    || tenantAuditHandoff.safeBoundary === true && blockedDecisions.length === 0;

  return {
    schemaVersion: "aios.mailchimp.tenant-permission-enforcement-artifact.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    status,
    enforcementKey,
    safeBoundary: source.safeBoundary === true || tenantAuditHandoff.safeBoundary === true,
    isolationKey: source.isolationKey || tenantAuditHandoff.isolationKey || null,
    tenantId: source.tenantId || tenantAuditHandoff.scope?.tenantId || "tenant.local",
    workspaceId: source.workspaceId || tenantAuditHandoff.scope?.workspaceId || "workspace.local",
    nextAction,
    audit: {
      required: audit.required === true || permissionGrantPlan.auditHandoff?.ready === true,
      ready: auditReady,
      commandIds: normalizeArtifactList(audit.commandIds || permissionGrantPlan.auditHandoff?.commandId),
      diagnosticIds: normalizeArtifactList(audit.diagnosticIds || source.diagnosticIds),
      appendAction: audit.appendAction || "append-tenant-permission-audit",
      externalWritesPerformed: false
    },
    decisions: decisions.map((decision, index) => ({
      order: index + 1,
      commandId: decision.commandId || `${enforcementKey}:decision:${index + 1}`,
      kind: decision.kind || "permission-decision",
      target: decision.target || "",
      owner: decision.owner || "operator",
      action: decision.action || nextAction,
      status: decision.status || status,
      required: decision.required === true,
      blocksRuntimeStart: decision.blocksRuntimeStart === true,
      retryable: decision.retryable === true,
      backoffMs: decision.backoffMs || 0,
      idempotencyKey: decision.idempotencyKey || `${enforcementKey}:${decision.kind || "decision"}:${index + 1}`
        .replace(/[^a-zA-Z0-9_.:-]/g, "_")
    })),
    counters: {
      decisions: source.counters?.decisions || source.counters?.commands || decisions.length,
      blocked: source.counters?.blocked || blockedDecisions.length,
      retryable: source.counters?.retryable || retryableDecisions.length,
      missingRoles: source.counters?.missingRoles || 0,
      deniedScopes: source.counters?.deniedScopes || 0,
      diagnostics: source.counters?.diagnostics || audit.diagnosticIds?.length || 0
    },
    clientPatch: {
      ...(source.clientPatch || {}),
      tenantPermissionEnforcementArtifact: "tenant-permission-enforcement.json",
      tenantPermissionEnforcementStatus: status,
      tenantPermissionEnforcementKey: enforcementKey,
      tenantPermissionNextAction: nextAction,
      tenantPermissionAuditReady: auditReady,
      tenantPermissionBlocked: source.counters?.blocked || blockedDecisions.length
    },
    restartSemantics: {
      replaySafe: source.restartSemantics?.replaySafe !== false,
      duplicateCommandPolicy: source.restartSemantics?.duplicateCommandPolicy
        || "dedupe-by-tenant-permission-enforcement-key",
      resumeFromEnforcementKey: source.restartSemantics?.resumeFromEnforcementKey || enforcementKey,
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

function buildClientCommandLeaseReplayHandoffArtifact(metadata, diagnostics, clientCommandLeaseReplay, commandLeaseReplayExport) {
  const source = metadata.clientCommandLeaseReplayHandoff
    || metadata.dryRun?.clientCommandLeaseReplayHandoff
    || diagnostics.clientCommandLeaseReplayHandoff
    || {};
  const rows = Array.isArray(source.rows)
    ? source.rows
    : Array.isArray(clientCommandLeaseReplay.rows)
      ? clientCommandLeaseReplay.rows
      : [];
  const blockedRows = rows.filter((row) => row.blocksRuntimeStart === true || row.status === "blocked");
  const ackRows = rows.filter((row) => row.ackRequired === true);
  const unsafeRows = rows.filter((row) => row.restartSafe === false || (!row.replayCursor && rows.length > 0));
  const exportReady = commandLeaseReplayExport.exportReady === true;
  const readyForRuntime = source.readyForRuntime === true
    || (
      exportReady
      && blockedRows.length === 0
      && unsafeRows.length === 0
      && clientCommandLeaseReplay.replay?.safe !== false
    );
  const status = source.status
    || (blockedRows.length > 0
      ? "blocked"
      : ackRows.length > 0
        ? "waiting-for-client-ack"
        : readyForRuntime
          ? "ready"
          : "review");
  const nextAction = source.nextAction
    || (status === "blocked"
      ? blockedRows[0]?.nextAction || "repair-command-lease-before-runtime-start"
      : status === "waiting-for-client-ack"
        ? ackRows[0]?.nextAction || "acknowledge-command-lease"
        : readyForRuntime
          ? "resume-command-lease-replay"
          : commandLeaseReplayExport.nextAction || clientCommandLeaseReplay.primaryAction || "refresh-client-command-lease-replay");
  const resumeToken = source.resumeToken
    || commandLeaseReplayExport.resumeToken
    || clientCommandLeaseReplay.resumeToken
    || `${metadata.jobId}:client-command-lease-replay-handoff`;
  const routeId = source.routeId
    || source.routePayload?.routeId
    || `${metadata.jobId}:command-lease-replay-handoff:${status}`.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const primaryLeaseId = source.primaryLeaseId
    || commandLeaseReplayExport.primaryLeaseId
    || clientCommandLeaseReplay.primaryLeaseId
    || rows[0]?.leaseId
    || null;
  const ackKeys = source.ack?.keys
    || commandLeaseReplayExport.ack?.keys
    || clientCommandLeaseReplay.ack?.keys
    || ackRows.map((row) => row.ackKey).filter(Boolean);

  return {
    schemaVersion: "aios.mailchimp.client-command-lease-replay-handoff-artifact.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    routeId,
    status,
    readyForClient: status !== "blocked",
    readyForRuntime,
    resumeToken,
    primaryLeaseId,
    nextAction,
    ack: {
      required: source.ack?.required === true
        || commandLeaseReplayExport.ack?.required === true
        || ackRows.length > 0,
      keys: ackKeys,
      nextAckKey: source.ack?.nextAckKey
        || commandLeaseReplayExport.ack?.nextAckKey
        || clientCommandLeaseReplay.ack?.nextAckKey
        || ackKeys[0]
        || null,
      requiredCount: source.ack?.requiredCount
        || commandLeaseReplayExport.ack?.requiredCount
        || clientCommandLeaseReplay.ack?.requiredCount
        || ackRows.length
    },
    routePayload: {
      ...(source.routePayload || {}),
      routeId,
      resumeToken,
      primaryLeaseId,
      idempotencyKey: source.routePayload?.idempotencyKey
        || `${metadata.jobId}:${routeId}:${resumeToken}`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      externalWritesPerformed: false
    },
    validationSummary: {
      ...(source.validationSummary || {}),
      total: rows.length,
      blocked: blockedRows.length,
      waitingForAck: ackRows.length,
      restartUnsafe: unsafeRows.length,
      ready: rows.filter((row) => row.restartSafe === true).length,
      blockedLeaseIds: source.validationSummary?.blockedLeaseIds
        || blockedRows.map((row) => row.leaseId).filter(Boolean),
      ackLeaseIds: source.validationSummary?.ackLeaseIds
        || ackRows.map((row) => row.leaseId).filter(Boolean),
      unsafeLeaseIds: source.validationSummary?.unsafeLeaseIds
        || unsafeRows.map((row) => row.leaseId).filter(Boolean)
    },
    rows: rows.map((row) => ({
      leaseId: row.leaseId,
      jobId: row.jobId,
      commandId: row.commandId,
      status: row.status,
      visibleStatus: row.visibleStatus,
      nextAction: row.nextAction,
      ackRequired: row.ackRequired === true,
      ackKey: row.ackKey || null,
      blocksRuntimeStart: row.blocksRuntimeStart === true,
      replayCursor: row.replayCursor || null,
      replayDecision: row.replayDecision || "return-existing-status",
      idempotencyKey: row.idempotencyKey || null,
      restartSafe: row.restartSafe === true
    })),
    clientPatch: {
      ...(source.clientPatch || {}),
      commandLeaseReplayHandoffStatus: status,
      commandLeaseReplayHandoffRouteId: routeId,
      commandLeaseReplayHandoffReady: readyForRuntime,
      commandLeaseReplayHandoffNextAction: nextAction,
      commandLeaseReplayResumeToken: resumeToken,
      commandLeaseReplayAckRequired: ackRows.length > 0 || commandLeaseReplayExport.ack?.required === true,
      commandLeaseReplayBlockedLeaseIds: blockedRows.map((row) => row.leaseId).filter(Boolean)
    },
    restartSemantics: {
      replaySafe: readyForRuntime,
      duplicateCommandPolicy: source.restartSemantics?.duplicateCommandPolicy
        || "dedupe-by-command-lease-replay-handoff-route",
      resumeToken,
      resumeFromLeaseId: primaryLeaseId,
      externalWritesPerformed: false
    }
  };
}

function buildTenantBoundaryPostureArtifact(metadata, diagnostics, tenantPermissionEnforcement) {
  const source = metadata.tenantBoundaryPosture
    || metadata.exports?.tenantBoundaryPosture
    || diagnostics.tenantBoundaryPosture
    || {};
  const runtimeGate = source.runtimeGate || {};
  const auditHandoff = source.auditHandoff || {};
  const drift = source.drift || {};
  const status = source.status
    || (runtimeGate.blocksRuntimeStart === true
      ? "blocked"
      : auditHandoff.ready === true
        ? "ready"
        : tenantPermissionEnforcement.status || "needs-operator-action");
  const postureKey = source.postureKey
    || `${metadata.jobId}:${source.isolationKey || tenantPermissionEnforcement.isolationKey || "tenant.local_workspace.local"}:${status}`
      .replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const driftRows = [
    {
      id: "explicit-boundary",
      status: drift.explicitBoundary === true ? "ready" : "waiting",
      nextAction: drift.explicitBoundary === true ? "handoff-to-runtime-adapter" : "declare-workspace-tenant-boundary"
    },
    {
      id: "isolation",
      status: drift.isolationDrift === true ? "blocked" : "ready",
      nextAction: drift.isolationDrift === true ? "isolate-mailchimp-tenant-workspace" : "handoff-to-runtime-adapter"
    },
    {
      id: "roles",
      status: drift.roleDrift === true ? "blocked" : "ready",
      nextAction: drift.roleDrift === true ? "grant-required-workspace-role" : "handoff-to-runtime-adapter"
    },
    {
      id: "scopes",
      status: drift.scopeDrift === true ? "blocked" : "ready",
      nextAction: drift.scopeDrift === true ? "remove-denied-mailchimp-scope" : "handoff-to-runtime-adapter"
    },
    {
      id: "audit",
      status: auditHandoff.ready === true ? "ready" : "waiting",
      nextAction: auditHandoff.ready === true ? "handoff-to-runtime-adapter" : auditHandoff.appendAction || "append-tenant-permission-audit"
    }
  ];
  const blockedRows = driftRows.filter((row) => row.status === "blocked");
  const waitingRows = driftRows.filter((row) => row.status === "waiting");

  return {
    schemaVersion: "aios.mailchimp.tenant-boundary-posture-artifact.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    status,
    postureKey,
    isolationKey: source.isolationKey || tenantPermissionEnforcement.isolationKey || null,
    tenantId: source.tenantId || tenantPermissionEnforcement.tenantId || "tenant.local",
    workspaceId: source.workspaceId || tenantPermissionEnforcement.workspaceId || "workspace.local",
    safeForRuntime: source.safeForRuntime === true && blockedRows.length === 0,
    safeForAuditAppend: source.safeForAuditAppend === true || auditHandoff.ready === true,
    nextAction: blockedRows[0]?.nextAction
      || waitingRows[0]?.nextAction
      || source.nextAction
      || tenantPermissionEnforcement.nextAction
      || "handoff-to-runtime-adapter",
    rows: driftRows,
    drift: {
      explicitBoundary: drift.explicitBoundary === true,
      isolationDrift: drift.isolationDrift === true,
      roleDrift: drift.roleDrift === true,
      scopeDrift: drift.scopeDrift === true,
      auditDrift: drift.auditDrift === true,
      missingRoles: normalizeArtifactList(drift.missingRoles),
      deniedScopes: normalizeArtifactList(drift.deniedScopes),
      diagnosticIds: normalizeArtifactList(source.diagnosticIds || drift.diagnosticIds)
    },
    runtimeGate: {
      blocksRuntimeStart: blockedRows.length > 0 || runtimeGate.blocksRuntimeStart === true,
      blockedDecisionIds: normalizeArtifactList(runtimeGate.blockedDecisionIds),
      waitingDecisionIds: normalizeArtifactList(runtimeGate.waitingDecisionIds),
      retryableDecisionIds: normalizeArtifactList(runtimeGate.retryableDecisionIds)
    },
    auditHandoff: {
      commandId: auditHandoff.commandId || tenantPermissionEnforcement.audit?.commandIds?.[0] || null,
      ready: auditHandoff.ready === true || tenantPermissionEnforcement.audit?.ready === true,
      appendAction: auditHandoff.appendAction || "append-tenant-permission-audit",
      idempotencyKey: auditHandoff.idempotencyKey || `${postureKey}:audit`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      externalWritesPerformed: false
    },
    counters: {
      rows: driftRows.length,
      blocked: blockedRows.length,
      waiting: waitingRows.length,
      driftFlags: [
        drift.isolationDrift,
        drift.roleDrift,
        drift.scopeDrift,
        drift.auditDrift
      ].filter(Boolean).length
    },
    clientPatch: {
      ...(source.clientPatch || {}),
      tenantBoundaryPostureArtifact: "tenant-boundary-posture.json",
      tenantBoundaryPostureStatus: status,
      tenantBoundaryPostureKey: postureKey,
      tenantBoundaryPostureNextAction: blockedRows[0]?.nextAction || waitingRows[0]?.nextAction || source.nextAction || "handoff-to-runtime-adapter",
      tenantBoundarySafeForRuntime: source.safeForRuntime === true && blockedRows.length === 0,
      tenantBoundarySafeForAudit: source.safeForAuditAppend === true || auditHandoff.ready === true
    },
    restartSemantics: {
      replaySafe: source.restartSemantics?.replaySafe !== false,
      duplicateCommandPolicy: source.restartSemantics?.duplicateCommandPolicy || "dedupe-by-tenant-boundary-posture-key",
      resumeFromPostureKey: source.restartSemantics?.resumeFromPostureKey || postureKey,
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
  const sourceRuntimeExportWatermark = source.runtimeExportWatermark
    || source.exportWatermark
    || metadata.dryRun?.runtimeExportWatermark
    || metadata.analytics?.runtimeExportWatermark
    || diagnostics.runtimeExportWatermark
    || {};
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
  const sourceReportingState = source.reportingState
    || source.reporting
    || metadata.dryRun?.reportingState
    || metadata.analytics?.reportingState
    || diagnostics.reportingState
    || {};
  const reportingState = buildDryRunAnalyticsReportingState({
    metadata,
    source,
    status,
    exportReady,
    nextAction,
    historySnapshots,
    historySnapshotIds,
    timeline,
    blockerCodes,
    warningCodes,
    tenantBlockedJobs,
    tenantApprovalJobs,
    sourceReportingState,
  });
  const runtimeExportWatermark = buildDryRunRuntimeExportWatermarkArtifact({
    metadata,
    source,
    sourceRuntimeExportWatermark,
    reportingState,
    status,
    exportReady,
    nextAction,
    historySnapshots,
    historySnapshotIds,
    timeline,
    blockerCodes,
    warningCodes,
    tenantBlockedJobs,
    tenantApprovalJobs,
  });

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
      reportingRows: reportingState.counters.historySnapshots
        + reportingState.counters.timelineEvents
        + reportingState.counters.exportRows,
      reportingBlockedRows: reportingState.counters.blockedRows,
      reportingWaitingRows: reportingState.counters.waitingRows,
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
    reportingState,
    runtimeExportWatermark,
    reportDigest: reportingState.digest,
    exportSummary: {
      format: "aios.mailchimp.dry-run-analytics-summary.v1",
      status,
      exportReady,
      nextAction,
      blockerCodes,
      warningCodes,
      historySnapshotIds,
      timelineEventIds: source.exportSummary?.timelineEventIds || timeline.map((entry) => `${metadata.jobId}:${entry.sequence}:${entry.phase}`),
      reportingStateId: reportingState.id,
      reportingCursor: reportingState.reportingCursor,
      reportingStatus: reportingState.status,
      reportingReady: reportingState.exportReady,
      reportingNextAction: reportingState.nextAction,
      runtimeExportWatermarkId: runtimeExportWatermark.id,
      runtimeExportCursor: runtimeExportWatermark.cursor,
      runtimeExportReady: runtimeExportWatermark.exportReady,
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
      dryRunReportingStateId: reportingState.id,
      dryRunReportingStateStatus: reportingState.status,
      dryRunReportingStateReady: reportingState.exportReady,
      dryRunReportingStateNextAction: reportingState.nextAction,
      dryRunReportingCursor: reportingState.reportingCursor,
      dryRunRuntimeExportWatermarkId: runtimeExportWatermark.id,
      dryRunRuntimeExportWatermarkStatus: runtimeExportWatermark.status,
      dryRunRuntimeExportWatermarkReady: runtimeExportWatermark.exportReady,
      dryRunRuntimeExportWatermarkNextAction: runtimeExportWatermark.nextAction,
      dryRunRuntimeExportWatermarkCursor: runtimeExportWatermark.cursor,
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-dry-run-analytics-report-id",
      resumeFromReportId: source.reportId || metadata.exports?.summary?.reportId || metadata.jobId,
      reportingCursor: reportingState.reportingCursor,
      runtimeExportCursor: runtimeExportWatermark.cursor,
      externalWritesPerformed: false,
    },
  };
}

function buildDryRunRuntimeExportWatermarkArtifact(context) {
  const {
    metadata,
    source,
    sourceRuntimeExportWatermark,
    reportingState,
    status,
    exportReady,
    nextAction,
    historySnapshots,
    historySnapshotIds,
    timeline,
    blockerCodes,
    warningCodes,
    tenantBlockedJobs,
    tenantApprovalJobs,
  } = context;
  const historyIds = historySnapshotIds.length > 0
    ? historySnapshotIds
    : historySnapshots.map((snapshot) => snapshot.id).filter(Boolean);
  const timelineEventIds = source.exportSummary?.timelineEventIds
    || timeline.map((entry) => `${metadata.jobId}:${entry.sequence}:${entry.phase}`);
  const blockedHistoryIds = normalizeArtifactList(
    sourceRuntimeExportWatermark.partitions?.find((partition) => partition.name === "history")?.blockedRefs
      || reportingState.historyIndex?.blockedSnapshotIds,
  );
  const waitingHistoryIds = normalizeArtifactList(
    sourceRuntimeExportWatermark.partitions?.find((partition) => partition.name === "history")?.waitingRefs
      || reportingState.historyIndex?.waitingSnapshotIds,
  );
  const blockedTimelineIds = normalizeArtifactList(
    sourceRuntimeExportWatermark.partitions?.find((partition) => partition.name === "timeline")?.blockedRefs
      || reportingState.timelineIndex?.failedEventRefs,
  );
  const waitingTimelineIds = normalizeArtifactList(
    sourceRuntimeExportWatermark.partitions?.find((partition) => partition.name === "timeline")?.waitingRefs
      || reportingState.timelineIndex?.waitingEventRefs,
  );
  const watermarkStatus = sourceRuntimeExportWatermark.status
    || (blockedHistoryIds.length > 0 || blockedTimelineIds.length > 0 || blockerCodes.length > 0
      ? "blocked"
      : waitingHistoryIds.length > 0 || waitingTimelineIds.length > 0 || warningCodes.length > 0
        ? "waiting"
        : exportReady
          ? "ready"
          : status);
  const watermarkReady = sourceRuntimeExportWatermark.exportReady === true
    || (watermarkStatus === "ready" && reportingState.exportReady === true);
  const watermarkNextAction = sourceRuntimeExportWatermark.nextAction
    || (watermarkReady
      ? "publish-runtime-export-watermark"
      : blockedHistoryIds.length > 0
        ? "review-dry-run-history-snapshots"
        : blockedTimelineIds.length > 0
          ? "review-failed-dry-run-timeline"
          : nextAction || "review-runtime-export-watermark");
  const highWatermarks = {
    ...(sourceRuntimeExportWatermark.highWatermarks || {}),
    latestHistorySnapshotId: sourceRuntimeExportWatermark.highWatermarks?.latestHistorySnapshotId
      || historyIds.at(-1)
      || null,
    latestTimelineEventId: sourceRuntimeExportWatermark.highWatermarks?.latestTimelineEventId
      || timelineEventIds.at(-1)
      || null,
    reportingCursor: sourceRuntimeExportWatermark.highWatermarks?.reportingCursor
      || reportingState.reportingCursor,
  };
  const cursor = sourceRuntimeExportWatermark.cursor
    || sourceRuntimeExportWatermark.id
    || stableArtifactId(metadata.jobId, "runtime-export-watermark", {
      status: watermarkStatus,
      highWatermarks,
      blockerCodes,
      warningCodes,
    });
  const dedupeKey = sourceRuntimeExportWatermark.dedupeKey
    || stableArtifactId(metadata.jobId, "runtime-export-dedupe", {
      cursor,
      latestHistorySnapshotId: highWatermarks.latestHistorySnapshotId,
      latestTimelineEventId: highWatermarks.latestTimelineEventId,
    });
  const partitions = Array.isArray(sourceRuntimeExportWatermark.partitions)
    ? sourceRuntimeExportWatermark.partitions
    : [
      {
        name: "history",
        status: blockedHistoryIds.length > 0 ? "blocked" : waitingHistoryIds.length > 0 ? "waiting" : "ready",
        cursor: highWatermarks.latestHistorySnapshotId,
        rows: historyIds.length,
        blockedRefs: blockedHistoryIds,
        waitingRefs: waitingHistoryIds,
        nextAction: blockedHistoryIds.length > 0 || waitingHistoryIds.length > 0
          ? "review-dry-run-history-snapshots"
          : "retain-history-snapshots",
      },
      {
        name: "timeline",
        status: blockedTimelineIds.length > 0 ? "blocked" : waitingTimelineIds.length > 0 ? "waiting" : "ready",
        cursor: highWatermarks.latestTimelineEventId,
        rows: timelineEventIds.length,
        blockedRefs: blockedTimelineIds,
        waitingRefs: waitingTimelineIds,
        nextAction: blockedTimelineIds.length > 0
          ? "review-failed-dry-run-timeline"
          : waitingTimelineIds.length > 0
            ? "review-waiting-dry-run-timeline"
            : "retain-dry-run-timeline",
      },
      {
        name: "analytics",
        status,
        cursor: reportingState.reportingCursor,
        rows: timelineEventIds.length,
        blockedRefs: blockerCodes,
        waitingRefs: warningCodes,
        nextAction,
      },
    ];

  return {
    schemaVersion: "aios.mailchimp.runtime-export-watermark-artifact.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    reportId: source.reportId || metadata.exports?.summary?.reportId || metadata.jobId,
    planId: source.planId || metadata.exports?.summary?.planId || metadata.jobId,
    id: cursor,
    status: watermarkStatus,
    exportReady: watermarkReady,
    nextAction: watermarkNextAction,
    cursor,
    dedupeKey,
    highWatermarks,
    partitions,
    counters: {
      ...(sourceRuntimeExportWatermark.counters || {}),
      historySnapshots: historyIds.length,
      timelineEvents: timelineEventIds.length,
      partitions: partitions.length,
      blockedPartitions: partitions.filter((partition) => partition.status === "blocked").length,
      waitingPartitions: partitions.filter((partition) => partition.status === "waiting").length,
      blockerCodes: blockerCodes.length,
      warningCodes: warningCodes.length,
      blockedJobs: tenantBlockedJobs.length,
      waitingJobs: tenantApprovalJobs.length,
    },
    exportSummary: {
      format: "aios.mailchimp.runtime-export-watermark-summary.v1",
      status: watermarkStatus,
      exportReady: watermarkReady,
      nextAction: watermarkNextAction,
      cursor,
      dedupeKey,
      partitionStatuses: partitions.reduce((summary, partition) => {
        summary[partition.name] = partition.status;
        return summary;
      }, {}),
      blockedJobIds: tenantBlockedJobs,
      waitingJobIds: tenantApprovalJobs,
      externalWritesPerformed: false,
    },
    clientPatch: {
      ...(sourceRuntimeExportWatermark.clientPatch || {}),
      dryRunRuntimeExportWatermarkId: cursor,
      dryRunRuntimeExportWatermarkStatus: watermarkStatus,
      dryRunRuntimeExportWatermarkReady: watermarkReady,
      dryRunRuntimeExportWatermarkNextAction: watermarkNextAction,
      dryRunRuntimeExportWatermarkCursor: cursor,
      dryRunRuntimeExportBlockedJobs: tenantBlockedJobs,
      dryRunRuntimeExportWaitingJobs: tenantApprovalJobs,
    },
    restartSemantics: {
      replaySafe: watermarkStatus !== "blocked",
      duplicateCommandPolicy: "dedupe-by-runtime-export-watermark",
      cursor,
      externalWritesPerformed: false,
    },
  };
}

function buildDryRunAnalyticsReportingState(context) {
  const {
    metadata,
    source,
    status,
    exportReady,
    nextAction,
    historySnapshots,
    historySnapshotIds,
    timeline,
    blockerCodes,
    warningCodes,
    tenantBlockedJobs,
    tenantApprovalJobs,
    sourceReportingState,
  } = context;
  const historyIds = historySnapshotIds.length > 0
    ? historySnapshotIds
    : historySnapshots.map((snapshot) => snapshot.id).filter(Boolean);
  const timelineEventIds = source.exportSummary?.timelineEventIds
    || timeline.map((entry) => `${metadata.jobId}:${entry.sequence}:${entry.phase}`);
  const sourceCounters = sourceReportingState.counters || {};
  const blockedHistoryIds = normalizeArtifactList(
    sourceReportingState.historyIndex?.blockedSnapshotIds
      || sourceReportingState.clientPatch?.dryRunReportingBlockedSnapshots,
  );
  const waitingHistoryIds = normalizeArtifactList(
    sourceReportingState.historyIndex?.waitingSnapshotIds
      || sourceReportingState.clientPatch?.dryRunReportingWaitingSnapshots,
  );
  const blockedTimelineIds = normalizeArtifactList(sourceReportingState.timelineIndex?.failedEventRefs);
  const waitingTimelineIds = normalizeArtifactList(sourceReportingState.timelineIndex?.waitingEventRefs);
  const exportRows = [
    {
      key: "history-snapshots",
      status: blockedHistoryIds.length > 0 ? "blocked" : waitingHistoryIds.length > 0 ? "waiting" : "ready",
      count: historyIds.length,
      nextAction: blockedHistoryIds.length > 0 || waitingHistoryIds.length > 0
        ? "review-dry-run-history-snapshots"
        : "retain-dry-run-history-snapshots",
    },
    {
      key: "timeline-events",
      status: blockedTimelineIds.length > 0 ? "blocked" : waitingTimelineIds.length > 0 ? "waiting" : "ready",
      count: timeline.length,
      nextAction: blockedTimelineIds.length > 0 || waitingTimelineIds.length > 0
        ? "review-dry-run-timeline-events"
        : "retain-dry-run-timeline-events",
    },
    {
      key: "analytics-export",
      status,
      count: timelineEventIds.length,
      nextAction,
    },
  ];
  const blockedRows = exportRows.filter((row) => row.status === "blocked");
  const waitingRows = exportRows.filter((row) => row.status === "waiting");
  const reportingStatus = sourceReportingState.status
    || (blockedRows.length > 0 || blockerCodes.length > 0 || tenantBlockedJobs.length > 0
      ? "blocked"
      : waitingRows.length > 0 || warningCodes.length > 0 || tenantApprovalJobs.length > 0
        ? "waiting"
        : exportReady
          ? "ready"
          : "review");
  const reportingNextAction = sourceReportingState.nextAction
    || (reportingStatus === "ready"
      ? "publish-dry-run-reporting-state"
      : blockedRows[0]?.nextAction
        || waitingRows[0]?.nextAction
        || nextAction
        || "review-dry-run-reporting-state");
  const reportingCursor = sourceReportingState.reportingCursor
    || sourceReportingState.exportSummary?.reportingCursor
    || stableArtifactId(metadata.jobId, "dry-run-reporting-cursor", {
      status: reportingStatus,
      historyIds,
      timelineEventIds,
    });
  const id = sourceReportingState.id
    || stableArtifactId(metadata.jobId, "dry-run-reporting-state", {
      status: reportingStatus,
      reportingCursor,
    });
  return {
    schemaVersion: "aios.mailchimp.dry-run-reporting-state.v1",
    id,
    reportId: source.reportId || metadata.exports?.summary?.reportId || metadata.jobId,
    planId: source.planId || metadata.exports?.summary?.planId || metadata.jobId,
    status: reportingStatus,
    exportReady: sourceReportingState.exportReady === true || reportingStatus === "ready",
    nextAction: reportingNextAction,
    reportingCursor,
    digest: {
      ...(sourceReportingState.digest || {}),
      status: reportingStatus,
      nextAction: reportingNextAction,
      latestSnapshotId: sourceReportingState.historyIndex?.latestSnapshotId
        || historyIds.at(-1)
        || null,
      blockerCodes: blockerCodes.length,
      warningCodes: warningCodes.length,
      tenantBlockedJobs,
      tenantApprovalJobs,
    },
    counters: {
      historySnapshots: sourceCounters.historySnapshots || historyIds.length,
      timelineEvents: sourceCounters.jobTimelineEvents
        || sourceCounters.timelineEvents
        || timeline.length,
      exportRows: sourceCounters.exportRows || exportRows.length,
      blockedRows: sourceCounters.blockedRows
        || blockedRows.length
        || blockedHistoryIds.length
        || blockedTimelineIds.length
        || blockerCodes.length,
      waitingRows: sourceCounters.waitingRows
        || waitingRows.length
        || waitingHistoryIds.length
        || waitingTimelineIds.length
        || warningCodes.length,
    },
    historyIndex: {
      ...(sourceReportingState.historyIndex || {}),
      snapshotIds: sourceReportingState.historyIndex?.snapshotIds || historyIds,
      latestSnapshotId: sourceReportingState.historyIndex?.latestSnapshotId || historyIds.at(-1) || null,
      blockedSnapshotIds: blockedHistoryIds,
      waitingSnapshotIds: waitingHistoryIds,
    },
    timelineIndex: {
      ...(sourceReportingState.timelineIndex || {}),
      timelineEventIds,
      failedEventRefs: blockedTimelineIds,
      waitingEventRefs: waitingTimelineIds,
      exportRows: sourceReportingState.timelineIndex?.exportRows || exportRows,
    },
    exportSummary: {
      format: "aios.mailchimp.dry-run-reporting-state-summary.v1",
      status: reportingStatus,
      exportReady: sourceReportingState.exportReady === true || reportingStatus === "ready",
      nextAction: reportingNextAction,
      reportingCursor,
      historySnapshotIds: historyIds,
      timelineEventIds,
      blockerCodes,
      warningCodes,
      externalWritesPerformed: false,
    },
    restartSemantics: {
      replaySafe: reportingStatus !== "blocked",
      onRestart: "rebuild-dry-run-reporting-state-from-artifact",
      onDuplicateCommand: "return-existing-dry-run-reporting-state",
      reportingCursor,
      externalWritesPerformed: false,
    },
  };
}

function buildDiagnosticExportLedgerArtifact(metadata, diagnostics) {
  const source = diagnostics.exportLedger
    || metadata.diagnosticExportLedger
    || metadata.exports?.diagnosticExportLedger
    || {};
  const rows = Array.isArray(source.rows) ? source.rows : [];
  const historySnapshots = Array.isArray(source.historySnapshots)
    ? source.historySnapshots
    : Array.isArray(metadata.history?.snapshots)
      ? metadata.history.snapshots.filter((snapshot) => String(snapshot.phase || "").startsWith("diagnostic-export-"))
      : [];
  const blockedRows = rows.filter((row) => row.status === "blocked");
  const waitingRows = rows.filter((row) => (
    row.status === "waiting"
    || row.status === "retryable"
    || row.status === "needs-operator-action"
  ));
  const exportReady = source.exportReady === true
    && blockedRows.length === 0
    && source.restartSemantics?.externalWritesPerformed !== true;
  const status = source.status
    || (blockedRows.length > 0 ? "blocked" : waitingRows.length > 0 ? "waiting" : "ready");
  const nextAction = source.nextAction
    || (exportReady
      ? "publish-diagnostic-export-ledger"
      : blockedRows[0]?.nextAction || waitingRows[0]?.nextAction || "repair-diagnostic-export-ledger");
  const resumeToken = source.resumeToken
    || metadata.diagnosticExportLedger?.resumeToken
    || metadata.exports?.summary?.resumeToken
    || `${metadata.jobId}:${status}`;
  const statusRevision = source.statusRevision
    || metadata.diagnosticExportLedger?.statusRevision
    || metadata.exports?.summary?.statusRevision
    || `${metadata.jobId}:${status}`;

  return {
    schemaVersion: "aios.mailchimp.diagnostic-export-ledger-artifact.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    status,
    exportReady,
    nextAction,
    resumeToken,
    statusRevision,
    rows: rows.map((row, index) => ({
      id: row.id || `${metadata.jobId}:diagnostic-export-row:${index + 1}`,
      order: row.order || index + 1,
      phase: row.phase || "diagnostic-export",
      status: row.status || status,
      source: row.source || "diagnostic-emitter",
      nextAction: row.nextAction || nextAction,
      counters: row.counters || {}
    })),
    counters: {
      ...(source.counters || {}),
      rows: rows.length,
      blockedRows: blockedRows.length,
      waitingRows: waitingRows.length,
      historySnapshots: historySnapshots.length,
      diagnostics: source.counters?.diagnostics || diagnostics.counts?.total || 0,
      errors: source.counters?.errors || diagnostics.counts?.bySeverity?.error || 0,
      warnings: source.counters?.warnings || diagnostics.counts?.bySeverity?.warning || 0
    },
    historySnapshots,
    exportSummary: {
      format: "aios.mailchimp.diagnostic-export-ledger-summary.v1",
      artifactName: "diagnostic-export-ledger.json",
      status,
      exportReady,
      nextAction,
      rowIds: rows.map((row) => row.id).filter(Boolean),
      blockerCodes: source.exportSummary?.blockerCodes || [],
      warningCodes: source.exportSummary?.warningCodes || [],
      historySnapshotIds: source.exportSummary?.historySnapshotIds
        || historySnapshots.map((snapshot) => snapshot.id).filter(Boolean),
      externalWritesPerformed: false
    },
    clientPatch: {
      ...(source.clientPatch || {}),
      diagnosticExportLedgerArtifact: "diagnostic-export-ledger.json",
      diagnosticExportLedgerReady: exportReady,
      diagnosticExportLedgerStatus: status,
      diagnosticExportLedgerNextAction: nextAction,
      diagnosticExportLedgerResumeToken: resumeToken,
      diagnosticExportLedgerRevision: statusRevision,
      diagnosticExportLedgerRows: rows.length
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-diagnostic-export-ledger-revision",
      resumeToken,
      statusRevision,
      externalWritesPerformed: false
    }
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

function buildLifecycleRunControlArtifact(metadata, diagnostics, lifecycleControls, lifecycleOperatorControls) {
  const source = diagnostics.lifecycleControls?.runControl
    || lifecycleControls.runControl
    || {};
  const freezeWindows = Array.isArray(source.freezeWindows) ? source.freezeWindows : [];
  const activeFreezeWindow = source.activeFreezeWindow || null;
  const concurrency = source.concurrency || {};
  const supportedModes = Array.isArray(source.supportedModes) ? source.supportedModes : ["manual", "immediate", "windowed"];
  const requestedMode = source.requestedMode || "manual";
  const modeSupported = supportedModes.includes(requestedMode);
  const controlKey = `${metadata.jobId}:run-control:${requestedMode}:${source.status || "unknown"}`
    .replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const rows = [
    {
      id: "run-control-mode",
      status: modeSupported ? "ready" : "blocked",
      required: true,
      nextAction: modeSupported
        ? "return-existing-run-control-mode"
        : "select-supported-mailchimp-run-control-mode",
      evidence: { requestedMode, supportedModes }
    },
    {
      id: "run-control-freeze-window",
      status: activeFreezeWindow ? "waiting" : "ready",
      required: false,
      nextAction: activeFreezeWindow
        ? "wait-for-mailchimp-run-control-window"
        : "return-existing-freeze-window-state",
      evidence: {
        activeFreezeWindowId: activeFreezeWindow?.id || null,
        freezeWindowCount: freezeWindows.length,
        now: source.now || null
      }
    },
    {
      id: "run-control-concurrency",
      status: concurrency.exceeded === true ? "blocked" : "ready",
      required: true,
      nextAction: concurrency.exceeded === true
        ? "reduce-mailchimp-runtime-concurrency"
        : "return-existing-run-control-concurrency",
      evidence: {
        requested: concurrency.requested || 0,
        max: concurrency.max || 0
      }
    }
  ];
  const blockedRows = rows.filter((row) => row.status === "blocked");
  const waitingRows = rows.filter((row) => row.status === "waiting");
  const status = lifecycleOperatorControls.status === "blocked" || blockedRows.length > 0
    ? "blocked"
    : waitingRows.length > 0
      ? "needs-operator-action"
      : source.status || "ready";
  const ready = status === "ready"
    && source.ready === true
    && lifecycleOperatorControls.runtimeStart?.enabled === true;
  const nextAction = ready
    ? lifecycleOperatorControls.nextAction || "handoff-to-runtime-adapter"
    : blockedRows[0]?.nextAction
      || waitingRows[0]?.nextAction
      || source.nextAction
      || lifecycleOperatorControls.nextAction
      || "review-mailchimp-run-control";

  return {
    schemaVersion: "aios.mailchimp.lifecycle-run-control-artifact.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    controlKey,
    status,
    ready,
    nextAction,
    mode: {
      requested: requestedMode,
      supported: supportedModes,
      supportedForRuntimeStart: modeSupported
    },
    freezeWindow: {
      active: Boolean(activeFreezeWindow),
      activeWindow: activeFreezeWindow,
      windows: freezeWindows,
      now: source.now || null
    },
    concurrency,
    rows,
    validationSummary: {
      total: rows.length,
      blocked: blockedRows.length,
      waiting: waitingRows.length,
      blockedRowIds: blockedRows.map((row) => row.id),
      waitingRowIds: waitingRows.map((row) => row.id),
      operatorControlsStatus: lifecycleOperatorControls.status || "unknown"
    },
    clientPatch: {
      lifecycleRunControlArtifact: "lifecycle-run-control.json",
      lifecycleRunControlKey: controlKey,
      lifecycleRunControlStatus: status,
      lifecycleRunControlReady: ready,
      lifecycleRunControlNextAction: nextAction,
      lifecycleRunControlFreezeWindowId: activeFreezeWindow?.id || null,
      lifecycleRunControlConcurrencyExceeded: concurrency.exceeded === true
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-lifecycle-run-control-key",
      resumeFromControlKey: controlKey,
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
  const clientRuntimeSettings = buildClientRuntimeSettingsArtifact(metadata, diagnostics);
  const settingsRolloutGate = buildSettingsRolloutGateArtifact(metadata, diagnostics, clientRuntimeSettings);
  const clientStatusHandoff = buildClientStatusHandoffArtifact(metadata, diagnostics);
  const lifecycleControls = buildLifecycleControlsArtifact(metadata, diagnostics);
  const providerServiceHandoff = buildProviderServiceHandoffArtifact(metadata, diagnostics);
  const providerSyncCheckpoint = buildProviderSyncCheckpointArtifact(metadata, diagnostics, providerServiceHandoff);
  const providerReleaseReadiness = buildProviderReleaseReadinessArtifact(metadata, diagnostics, providerServiceHandoff);
  const providerIntegrationHandoff = buildProviderIntegrationHandoffArtifact(
    metadata,
    diagnostics,
    providerServiceHandoff,
    providerSyncCheckpoint,
    providerReleaseReadiness
  );
  const providerCallbackHandoff = buildProviderCallbackHandoffArtifact(metadata, diagnostics, {
    providerServiceHandoff
  });
  const providerIntegrationExecutionTicket = buildProviderIntegrationExecutionTicketArtifact(
    metadata,
    diagnostics,
    providerIntegrationHandoff
  );
  const tenantAuditHandoff = buildTenantAuditHandoffArtifact(metadata, diagnostics);
  const permissionGrantPlan = buildPermissionGrantPlanArtifact(metadata, diagnostics, tenantAuditHandoff);
  const tenantPermissionEnforcement = buildTenantPermissionEnforcementArtifact(
    metadata,
    diagnostics,
    permissionGrantPlan,
    tenantAuditHandoff
  );
  const tenantBoundaryMatrix = buildTenantBoundaryMatrixArtifact(metadata, diagnostics, tenantAuditHandoff);
  const clientCommandLeases = buildClientCommandLeasesArtifact(metadata, diagnostics);
  const clientCommandLeaseReplay = buildClientCommandLeaseReplayArtifact(metadata, diagnostics, clientCommandLeases);
  const commandLeaseReplayExport = buildCommandLeaseReplayExportArtifact(metadata, diagnostics, clientCommandLeaseReplay);
  const clientCommandLeaseReplayHandoff = buildClientCommandLeaseReplayHandoffArtifact(
    metadata,
    diagnostics,
    clientCommandLeaseReplay,
    commandLeaseReplayExport
  );
  const lifecycleOperatorControls = buildLifecycleOperatorControlsArtifact(metadata, diagnostics, lifecycleControls);
  const lifecycleRunControl = buildLifecycleRunControlArtifact(
    metadata,
    diagnostics,
    lifecycleControls,
    lifecycleOperatorControls
  );
  const runtimeReleaseDecision = buildRuntimeReleaseDecisionArtifact(metadata, diagnostics, {
    providerReleaseReadiness,
    tenantAuditHandoff,
    previewAcceptance,
    commandLeaseReplayExport,
    lifecycleOperatorControls
  });
  const runtimeReleaseControls = buildRuntimeReleaseControlsArtifact(metadata, diagnostics, {
    runtimeReleaseDecision,
    providerReleaseReadiness,
    commandLeaseReplayExport,
    lifecycleOperatorControls
  });
  const providerExportReadiness = buildProviderExportReadinessArtifact(metadata, diagnostics, {
    providerServiceHandoff,
    providerSyncCheckpoint,
    runtimeReleaseControls
  });
  const dryRunAnalyticsExport = buildDryRunAnalyticsExportArtifact(metadata, diagnostics, {
    tenantBoundaryMatrix,
    commandLeaseReplayExport,
    clientCommandLeaseReplayHandoff,
    providerReleaseReadiness,
    lifecycleOperatorControls
  });
  const diagnosticExportLedger = buildDiagnosticExportLedgerArtifact(metadata, diagnostics);
  const operationalRunbook = buildOperationalRunbookArtifact(metadata, diagnostics, {
    lifecycleControls,
    providerServiceHandoff,
    tenantAuditHandoff,
    clientWorkflow,
    clientCommandLeases,
    clientCommandLeaseReplay
  });
  const clientRemediationPacket = buildClientRemediationPacketArtifact(metadata, diagnostics);
  const serviceLevelObjectiveExport = buildServiceLevelObjectiveExportArtifact(metadata, diagnostics);
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
    clientRuntimeSettings: {
      artifactName: "client-runtime-settings.json",
      settingsRevision: clientRuntimeSettings.settingsRevision,
      status: clientRuntimeSettings.status,
      readyForClientRuntime: clientRuntimeSettings.readyForClientRuntime,
      nextAction: clientRuntimeSettings.nextAction,
      missingRequiredSettings: clientRuntimeSettings.missingRequiredSettings,
      revisionAccepted: clientRuntimeSettings.revisionAccepted,
      scheduleWindow: clientRuntimeSettings.controls.scheduleWindow
    },
    settingsRolloutGate: {
      artifactName: "settings-rollout-gate.json",
      status: settingsRolloutGate.status,
      readyForRuntimeStart: settingsRolloutGate.readyForRuntimeStart,
      rolloutKey: settingsRolloutGate.rolloutKey,
      settingsRevision: settingsRolloutGate.settingsRevision,
      nextAction: settingsRolloutGate.nextAction,
      nextGateId: settingsRolloutGate.nextGateId,
      blockedGateIds: settingsRolloutGate.clientPatch.mailchimpSettingsRolloutBlockedGateIds
    },
    clientStatusHandoff: {
      artifactName: "client-status-handoff.json",
      statusId: clientStatusHandoff.statusId,
      status: clientStatusHandoff.status,
      visibleStatus: clientStatusHandoff.visibleStatus,
      routeId: clientStatusHandoff.route.routeId,
      routeIdempotencyKey: clientStatusHandoff.route.idempotencyKey,
      readyForClient: clientStatusHandoff.readyForClient,
      readyForRuntime: clientStatusHandoff.readyForRuntime,
      nextAction: clientStatusHandoff.nextAction,
      statusRevision: clientStatusHandoff.statusLedger.statusRevision,
      pendingAckKeys: clientStatusHandoff.commandAck.pendingKeys
    },
    runtimeReleaseControls: {
      artifactName: "runtime-release-controls.json",
      status: runtimeReleaseControls.status,
      readyForRuntimeStart: runtimeReleaseControls.readyForRuntimeStart,
      releaseKey: runtimeReleaseControls.releaseKey,
      releaseToken: runtimeReleaseControls.releaseToken,
      nextAction: runtimeReleaseControls.nextAction,
      nextGateId: runtimeReleaseControls.nextGateId,
      blockedGateIds: runtimeReleaseControls.clientPatch.runtimeReleaseBlockedGateIds,
      waitingGateIds: runtimeReleaseControls.clientPatch.runtimeReleaseWaitingGateIds
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
    restartCheckpoints: {
      artifactName: "restart-checkpoint-manifest.json",
      status: metadata.restartCheckpoints?.status || diagnostics.restartCheckpointManifest?.status || "unknown",
      readyForColdRestart: metadata.restartCheckpoints?.readyForColdRestart === true
        || diagnostics.restartCheckpointManifest?.readyForColdRestart === true,
      nextAction: metadata.restartCheckpoints?.nextAction
        || diagnostics.restartCheckpointManifest?.nextAction
        || metadata.statusRecovery?.nextAction
        || diagnostics.recovery?.nextAction,
      resumeToken: metadata.restartCheckpoints?.resumeToken
        || diagnostics.restartCheckpointManifest?.resumeToken
        || metadata.statusRecovery?.resume?.resumeToken
        || diagnostics.statusLedger?.resumeToken,
      statusRevision: metadata.restartCheckpoints?.statusRevision
        || diagnostics.restartCheckpointManifest?.statusRevision
        || metadata.statusRecovery?.resume?.statusRevision
        || diagnostics.statusLedger?.statusRevision,
      missingRequiredCheckpoints: metadata.restartCheckpoints?.blocking?.missingRequiredCheckpoints
        || diagnostics.restartCheckpointManifest?.blocking?.missingRequiredCheckpoints
        || []
    },
    statusSnapshot,
    persistedStatusEnvelope: {
      artifactName: "persisted-status-envelope.json",
      status: diagnostics.persistedStatusEnvelope?.status || diagnostics.status,
      readyForRuntimeResume: diagnostics.persistedStatusEnvelope?.readyForRuntimeResume === true,
      readyForClientStatus: diagnostics.persistedStatusEnvelope?.readyForClientStatus !== false,
      resumeToken: diagnostics.persistedStatusEnvelope?.resumeToken || statusSnapshot.resumeToken,
      statusRevision: diagnostics.persistedStatusEnvelope?.statusRevision || statusSnapshot.statusRevision,
      nextAction: diagnostics.persistedStatusEnvelope?.nextAction
        || diagnostics.recovery?.nextAction
        || statusSnapshot.restartSafe.resumeAction,
      blockedCommandIds: diagnostics.persistedStatusEnvelope?.blocking?.commandIds || [],
      unsafeCommandIds: diagnostics.persistedStatusEnvelope?.blocking?.unsafeCommandIds || [],
      restartSemantics: diagnostics.persistedStatusEnvelope?.restartSemantics || statusSnapshot.restartSafe
    },
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
    providerIntegrationHandoff: {
      artifactName: "provider-integration-handoff.json",
      integrationKey: providerIntegrationHandoff.integrationKey,
      status: providerIntegrationHandoff.status,
      readyForRuntime: providerIntegrationHandoff.readyForRuntime,
      nextAction: providerIntegrationHandoff.nextAction,
      nextGateId: providerIntegrationHandoff.nextGateId,
      resumeToken: providerIntegrationHandoff.resumeToken,
      blockedGateIds: providerIntegrationHandoff.validationSummary.blockedGateIds,
      waitingGateIds: providerIntegrationHandoff.validationSummary.waitingGateIds,
      missingCapabilities: providerIntegrationHandoff.validationSummary.missingCapabilities
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
    permissionGrantPlan: {
      artifactName: "permission-grant-plan.json",
      planId: permissionGrantPlan.planId,
      status: permissionGrantPlan.status,
      readyForAudit: permissionGrantPlan.readyForAudit,
      nextAction: permissionGrantPlan.nextAction,
      commandCount: permissionGrantPlan.summary.total,
      blockingCount: permissionGrantPlan.summary.blocking,
      retryableCount: permissionGrantPlan.summary.retryable,
      auditCommandId: permissionGrantPlan.auditHandoff.commandId,
      blockedCommandIds: permissionGrantPlan.blockedCommandIds
    },
    tenantPermissionEnforcement: {
      artifactName: "tenant-permission-enforcement.json",
      enforcementKey: tenantPermissionEnforcement.enforcementKey,
      status: tenantPermissionEnforcement.status,
      readyForAudit: tenantPermissionEnforcement.audit.ready,
      nextAction: tenantPermissionEnforcement.nextAction,
      blockedDecisions: tenantPermissionEnforcement.counters.blocked,
      retryableDecisions: tenantPermissionEnforcement.counters.retryable,
      auditCommandIds: tenantPermissionEnforcement.audit.commandIds,
      resumeFromEnforcementKey: tenantPermissionEnforcement.restartSemantics.resumeFromEnforcementKey
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
    clientRemediationPacket: {
      artifactName: "client-remediation-packet.json",
      status: clientRemediationPacket.status,
      visibleStatus: clientRemediationPacket.visibleStatus,
      readyForClient: clientRemediationPacket.readyForClient,
      readyForRuntime: clientRemediationPacket.readyForRuntime,
      routeId: clientRemediationPacket.route.routeId,
      nextAction: clientRemediationPacket.nextAction,
      blocking: clientRemediationPacket.counters.blocking,
      waiting: clientRemediationPacket.counters.waiting,
      resumeToken: clientRemediationPacket.route.resumeToken,
      statusRevision: clientRemediationPacket.route.statusRevision
    },
    serviceLevelObjectives: {
      artifactName: "service-level-objectives.json",
      status: serviceLevelObjectiveExport.status,
      healthLevel: serviceLevelObjectiveExport.healthLevel,
      readyForRuntimeRelease: serviceLevelObjectiveExport.readyForRuntimeRelease,
      nextAction: serviceLevelObjectiveExport.nextAction,
      breachCount: serviceLevelObjectiveExport.counters.breached,
      blockingCount: serviceLevelObjectiveExport.counters.blocking,
      resumeToken: serviceLevelObjectiveExport.resumeToken
    },
    dryRunAnalyticsExport: {
      artifactName: "dry-run-analytics-export.json",
      status: dryRunAnalyticsExport.status,
      exportReady: dryRunAnalyticsExport.exportReady,
      nextAction: dryRunAnalyticsExport.nextAction,
      historySnapshots: dryRunAnalyticsExport.counters.historySnapshots,
      timelineEvents: dryRunAnalyticsExport.counters.timelineEvents,
      blockerCodes: dryRunAnalyticsExport.exportSummary.blockerCodes,
      warningCodes: dryRunAnalyticsExport.exportSummary.warningCodes,
      reportingStateId: dryRunAnalyticsExport.reportingState.id,
      reportingStateStatus: dryRunAnalyticsExport.reportingState.status,
      reportingStateReady: dryRunAnalyticsExport.reportingState.exportReady,
      reportingCursor: dryRunAnalyticsExport.reportingState.reportingCursor,
      reportingBlockedRows: dryRunAnalyticsExport.reportingState.counters.blockedRows,
      reportingWaitingRows: dryRunAnalyticsExport.reportingState.counters.waitingRows
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
        "settings-rollout-gate.json",
      "permission-boundary.json",
      "permission-grant-plan.json",
      "runtime-release-decision.json",
      "provider-release-readiness.json",
      "tenant-audit-handoff.json",
      "tenant-boundary-matrix.json",
      "dry-run-analytics-export.json",
      "client-command-leases.json",
      "client-command-lease-replay.json",
        "restart-checkpoint-manifest.json",
        "operational-runbook.json",
        "client-remediation-packet.json",
        "service-level-objectives.json",
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
      clientRemediationPacketArtifact: "client-remediation-packet.json",
      clientRemediationStatus: clientRemediationPacket.status,
      clientRemediationRouteId: clientRemediationPacket.route.routeId,
      clientRemediationNextAction: clientRemediationPacket.nextAction,
      serviceLevelObjectiveArtifact: "service-level-objectives.json",
      serviceLevelObjectiveStatus: serviceLevelObjectiveExport.status,
      serviceLevelObjectiveReadyForRuntimeRelease: serviceLevelObjectiveExport.readyForRuntimeRelease,
      serviceLevelObjectiveNextAction: serviceLevelObjectiveExport.nextAction,
      dryRunAnalyticsExportArtifact: "dry-run-analytics-export.json",
      dryRunAnalyticsExportReady: dryRunAnalyticsExport.exportReady,
      dryRunAnalyticsExportStatus: dryRunAnalyticsExport.status,
      dryRunAnalyticsExportNextAction: dryRunAnalyticsExport.nextAction,
      dryRunReportingStateId: dryRunAnalyticsExport.reportingState.id,
      dryRunReportingStateReady: dryRunAnalyticsExport.reportingState.exportReady,
      dryRunReportingStateStatus: dryRunAnalyticsExport.reportingState.status,
      dryRunReportingStateNextAction: dryRunAnalyticsExport.reportingState.nextAction,
      dryRunReportingCursor: dryRunAnalyticsExport.reportingState.reportingCursor,
      permissionGrantPlanArtifact: "permission-grant-plan.json",
      permissionGrantPlanReady: permissionGrantPlan.readyForAudit,
      permissionGrantPlanStatus: permissionGrantPlan.status,
      permissionGrantPlanNextAction: permissionGrantPlan.nextAction,
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

function buildPreviewHandoffArtifact(metadata, diagnostics, previewAcceptance, clientWorkflow) {
  const source = metadata.previewHandoff || diagnostics.previewHandoff || {};
  const gates = Array.isArray(source.gates) ? source.gates : [];
  const blockedGateIds = source.acceptance?.blockedGateIds
    || gates.filter((gate) => gate.status === "blocked").map((gate) => gate.id);
  const pendingGateIds = source.acceptance?.pendingGateIds
    || gates.filter((gate) => gate.status === "needs-operator-action").map((gate) => gate.id);
  const status = source.status
    || (blockedGateIds.length > 0
      ? "blocked"
      : pendingGateIds.length > 0
        ? "needs-operator-action"
        : "ready");
  const routeId = source.routeId
    || `${metadata.jobId}:preview-route:${metadata.clientWorkflow?.tenant?.isolationKey || "tenant.local_workspace.local"}:${status}`
      .replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const acceptanceToken = source.acceptance?.token
    || previewAcceptance.acceptanceToken
    || `${routeId}:acceptance`.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const nextAction = source.primaryAction
    || source.explainNextStep?.action
    || clientWorkflow.explainNextStep?.action
    || previewAcceptance.explainNextStep?.action
    || "handoff-to-runtime-adapter";

  return {
    schemaVersion: "aios.mailchimp.preview-handoff-artifact.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    routeId,
    status,
    visible: source.visible === true,
    readyForAcceptance: source.readyForAcceptance === true && blockedGateIds.length === 0,
    readyForRuntimeStart: source.readyForRuntimeStart === true
      && blockedGateIds.length === 0
      && pendingGateIds.length === 0,
    nextAction,
    acceptance: {
      required: source.acceptance?.required !== false,
      token: acceptanceToken,
      status: source.acceptance?.status || previewAcceptance.status || "unknown",
      nextAction: source.acceptance?.nextAction || nextAction,
      requiredGateIds: source.acceptance?.requiredGateIds || gates.filter((gate) => gate.required).map((gate) => gate.id),
      blockedGateIds,
      pendingGateIds,
      receiptId: previewAcceptance.acceptanceReceipt?.id || null,
      receiptStatus: previewAcceptance.acceptanceReceipt?.status || "unknown",
      receiptReadyForRuntimeStart: previewAcceptance.acceptanceReceipt?.readyForRuntimeStart === true
    },
    routePayload: source.routePayload || {
      method: "POST",
      path: `/mailchimp/jobs/${metadata.jobId}/preview/acceptance`,
      idempotencyKey: acceptanceToken,
      bodyShape: {
        acceptanceToken: "string",
        statusRevision: "string",
        isolationKey: "string",
        accepted: "boolean"
      }
    },
    validationSummary: source.validationSummary || {
      total: gates.length,
      accepted: gates.filter((gate) => gate.status === "accepted").length,
      blocked: blockedGateIds.length,
      pending: pendingGateIds.length,
      required: gates.filter((gate) => gate.required).length,
      blockingDiagnostics: diagnostics.counts?.bySeverity?.error || 0,
      warningDiagnostics: diagnostics.counts?.bySeverity?.warning || 0
    },
    gates: gates.map((gate) => ({
      id: gate.id,
      label: gate.label,
      status: gate.status,
      required: gate.required === true,
      nextAction: gate.nextAction,
      evidence: gate.evidence || {}
    })),
    clientPatch: {
      ...(source.clientPatch || {}),
      previewHandoffArtifact: "preview-handoff.json",
      previewHandoffRouteId: routeId,
      previewHandoffStatus: status,
      previewHandoffAcceptanceToken: acceptanceToken,
      previewHandoffNextAction: nextAction,
      previewHandoffBlockedGateIds: blockedGateIds,
      previewHandoffPendingGateIds: pendingGateIds
    },
    restartSemantics: {
      replaySafe: source.restartSemantics?.replaySafe !== false,
      duplicateCommandPolicy: source.restartSemantics?.duplicateCommandPolicy
        || "dedupe-by-preview-handoff-token",
      resumeFromRouteId: source.restartSemantics?.resumeFromRouteId || routeId,
      externalWritesPerformed: false
    },
    truthBoundary: {
      source: "artifact-emitter",
      deterministic: true,
      externalMailchimpStateVerified: false,
      externalWritesPerformed: false
    }
  };
}

function buildPreviewAcceptancePacketArtifact(metadata, diagnostics, previewAcceptance, previewHandoff, previewExportReadiness, runtimeReleaseControls) {
  const source = diagnostics.previewAcceptancePacket || metadata.previewAcceptancePacket || {};
  const checkpoints = Array.isArray(source.checkpoints) ? source.checkpoints : [];
  const blockedCheckpoints = checkpoints.filter((checkpoint) => (checkpoint.blockedIds || []).length > 0);
  const pendingCheckpoints = checkpoints.filter((checkpoint) => (checkpoint.pendingIds || []).length > 0);
  const status = source.status
    || (blockedCheckpoints.length > 0
      ? "blocked"
      : pendingCheckpoints.length > 0
        ? "needs-operator-action"
        : "ready");
  const acceptanceToken = source.acceptanceToken
    || previewHandoff.acceptance?.token
    || previewAcceptance.acceptanceReceipt?.acceptanceToken
    || previewAcceptance.acceptanceToken
    || `${metadata.jobId}:preview-acceptance-packet:${status}`.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const routeId = source.routeId
    || previewHandoff.routeId
    || `${metadata.jobId}:preview-acceptance-packet-route`.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const readyForAcceptance = source.readyForAcceptance === true
    || (previewHandoff.readyForAcceptance === true
      && previewExportReadiness.readyForClientPreview === true
      && blockedCheckpoints.length === 0);
  const readyForRuntimeStart = source.readyForRuntimeStart === true
    || (readyForAcceptance
      && previewHandoff.readyForRuntimeStart === true
      && previewExportReadiness.readyForRuntimeStart === true
      && runtimeReleaseControls.readyForRuntimeStart === true
      && pendingCheckpoints.length === 0);
  const nextAction = source.nextAction
    || blockedCheckpoints[0]?.nextAction
    || pendingCheckpoints[0]?.nextAction
    || previewExportReadiness.nextAction
    || previewHandoff.nextAction
    || previewAcceptance.acceptanceReceipt?.nextAction
    || "accept-mailchimp-preview";

  return {
    schemaVersion: "aios.mailchimp.preview-acceptance-packet-artifact.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    status,
    routeId,
    acceptanceToken,
    readyForAcceptance,
    readyForRuntimeStart,
    nextAction,
    statusLedger: {
      resumeToken: source.statusLedger?.resumeToken
        || previewExportReadiness.resumeToken
        || diagnostics.statusLedger?.resumeToken
        || metadata.exports?.summary?.resumeToken
        || `${metadata.jobId}:${status}`,
      statusRevision: source.statusLedger?.statusRevision
        || previewExportReadiness.statusRevision
        || diagnostics.statusLedger?.statusRevision
        || metadata.exports?.summary?.statusRevision
        || `${metadata.jobId}:${status}`,
      visibleStatus: source.statusLedger?.visibleStatus || status,
      restartSafe: source.statusLedger?.restartSafe === true
    },
    routePayload: {
      method: source.routePayload?.method || previewHandoff.routePayload?.method || "POST",
      path: source.routePayload?.path || previewHandoff.routePayload?.path || `/mailchimp/jobs/${metadata.jobId}/preview/acceptance`,
      idempotencyKey: source.routePayload?.idempotencyKey || acceptanceToken,
      bodyShape: source.routePayload?.bodyShape || {
        acceptanceToken: "string",
        statusRevision: "string",
        resumeToken: "string",
        accepted: "boolean",
        acceptedGateIds: "array",
        acknowledgedExportRowIds: "array"
      }
    },
    validationSummary: {
      ...(source.validationSummary || {}),
      blocked: source.validationSummary?.blocked || blockedCheckpoints.length,
      pending: source.validationSummary?.pending || pendingCheckpoints.length,
      blockingDiagnostics: source.validationSummary?.blockingDiagnostics || diagnostics.counts?.bySeverity?.error || 0,
      warningDiagnostics: source.validationSummary?.warningDiagnostics || diagnostics.counts?.bySeverity?.warning || 0
    },
    checkpoints: checkpoints.map((checkpoint, index) => ({
      order: index + 1,
      id: checkpoint.id,
      status: checkpoint.status || "unknown",
      ready: checkpoint.ready === true,
      blockedIds: checkpoint.blockedIds || [],
      pendingIds: checkpoint.pendingIds || [],
      nextAction: checkpoint.nextAction || nextAction
    })),
    clientPatch: {
      ...(source.clientPatch || {}),
      previewAcceptancePacketArtifact: "preview-acceptance-packet.json",
      previewAcceptancePacketReady: readyForAcceptance,
      previewAcceptanceRuntimeReady: readyForRuntimeStart,
      previewAcceptancePacketStatus: status,
      previewAcceptancePacketNextAction: nextAction,
      previewAcceptanceToken: acceptanceToken
    },
    explainNextStep: source.explainNextStep || {
      action: nextAction,
      reason: status === "blocked"
        ? "preview-acceptance-packet-blocked"
        : status === "needs-operator-action"
          ? "preview-acceptance-packet-waiting"
          : "preview-acceptance-packet-ready",
      resumeToken: source.statusLedger?.resumeToken || previewExportReadiness.resumeToken || null,
      statusRevision: source.statusLedger?.statusRevision || previewExportReadiness.statusRevision || null,
      routeId
    },
    restartSemantics: {
      replaySafe: source.restartSemantics?.replaySafe !== false,
      duplicateCommandPolicy: source.restartSemantics?.duplicateCommandPolicy
        || "dedupe-by-preview-acceptance-packet-token",
      resumeFromAcceptanceToken: source.restartSemantics?.resumeFromAcceptanceToken || acceptanceToken,
      externalWritesPerformed: false
    },
    truthBoundary: {
      source: "artifact-emitter",
      deterministic: true,
      externalMailchimpStateVerified: false,
      externalWritesPerformed: false
    }
  };
}

function buildPreviewReleaseTicketArtifact(metadata, diagnostics, previewAcceptancePacket, runtimeReleaseControls) {
  const source = diagnostics.previewReleaseTicket || metadata.previewReleaseTicket || {};
  const lifecycleControls = diagnostics.lifecycleControls || {};
  const statusLedger = diagnostics.statusLedger || {};
  const verifierGate = source.verifierRuntimeReleaseGate || diagnostics.verifierRuntimeReleaseGate || {};
  const releaseKey = runtimeReleaseControls.releaseKey || source.releaseKey || `${metadata.jobId}:runtime-release`;
  const ticketKey = source.ticketKey
    || `${metadata.jobId}:preview-release:${previewAcceptancePacket.acceptanceToken || "unaccepted"}:${releaseKey}`
      .replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const resumeToken = source.resumeToken
    || previewAcceptancePacket.statusLedger?.resumeToken
    || statusLedger.resumeToken
    || `${ticketKey}:resume`;
  const statusRevision = source.statusRevision
    || previewAcceptancePacket.statusLedger?.statusRevision
    || statusLedger.statusRevision
    || `${metadata.jobId}:preview-release:unrevisioned`;
  const rows = Array.isArray(source.rows) && source.rows.length
    ? source.rows
    : [
      {
        id: "preview-acceptance",
        label: "Mailchimp preview acceptance",
        status: previewAcceptancePacket.readyForAcceptance === true ? "ready" : previewAcceptancePacket.status || "waiting",
        ready: previewAcceptancePacket.readyForAcceptance === true,
        required: true,
        nextAction: previewAcceptancePacket.readyForAcceptance === true
          ? "handoff-to-runtime-adapter"
          : previewAcceptancePacket.nextAction || "accept-mailchimp-preview",
        code: previewAcceptancePacket.readyForAcceptance === true
          ? "preview.release.ticket.acceptance.ready"
          : "preview.release.ticket.acceptance.blocked",
        evidence: {
          acceptanceToken: previewAcceptancePacket.acceptanceToken || null,
          blocked: previewAcceptancePacket.validationSummary?.blocked || 0,
          pending: previewAcceptancePacket.validationSummary?.pending || 0
        }
      },
      {
        id: "runtime-release-controls",
        label: "Mailchimp runtime release controls",
        status: runtimeReleaseControls.readyForRuntimeStart === true ? "ready" : runtimeReleaseControls.status || "waiting",
        ready: runtimeReleaseControls.readyForRuntimeStart === true,
        required: true,
        nextAction: runtimeReleaseControls.readyForRuntimeStart === true
          ? "handoff-to-runtime-adapter"
          : runtimeReleaseControls.nextAction || "enable-mailchimp-runtime-start-control",
        code: runtimeReleaseControls.readyForRuntimeStart === true
          ? "preview.release.ticket.runtime.ready"
          : "preview.release.ticket.runtime.blocked",
        evidence: {
          releaseKey,
          blockedGateIds: runtimeReleaseControls.clientPatch?.runtimeReleaseBlockedGateIds || [],
          waitingGateIds: runtimeReleaseControls.clientPatch?.runtimeReleaseWaitingGateIds || []
        }
      },
      {
        id: "status-ledger",
        label: "Mailchimp status ledger",
        status: statusLedger.resumeToken && statusLedger.statusRevision ? "ready" : "waiting",
        ready: Boolean(statusLedger.resumeToken && statusLedger.statusRevision),
        required: true,
        nextAction: statusLedger.resumeToken && statusLedger.statusRevision
          ? "handoff-to-runtime-adapter"
          : "refresh-mailchimp-client-status",
        code: statusLedger.resumeToken && statusLedger.statusRevision
          ? "preview.release.ticket.status.ready"
          : "preview.release.ticket.status.blocked",
        evidence: {
          resumeToken: statusLedger.resumeToken || null,
          statusRevision: statusLedger.statusRevision || null
        }
      },
      {
        id: "verifier-runtime-release",
        label: "Mailchimp verifier runtime release gate",
        status: verifierGate.status || (lifecycleControls.status === "ready" ? "ready" : "waiting"),
        ready: verifierGate.readyForRuntimeRelease === true || lifecycleControls.blocksRuntimeHandoff === false,
        required: lifecycleControls.blocksRuntimeHandoff === true || verifierGate.readyForRuntimeRelease === false,
        nextAction: verifierGate.nextAction || lifecycleControls.nextAction || "evaluate-candidate-before-runtime-handoff",
        code: verifierGate.readyForRuntimeRelease === true || lifecycleControls.blocksRuntimeHandoff === false
          ? "preview.release.ticket.verifier.ready"
          : "preview.release.ticket.verifier.blocked",
        evidence: {
          gateId: verifierGate.gateId || null,
          lifecycleStatus: lifecycleControls.status || "unknown",
          lifecycleSchedule: lifecycleControls.schedule?.window || lifecycleControls.schedule || null
        }
      }
    ];
  const normalizedRows = rows.map((row, index) => ({
    order: row.order || index + 1,
    id: row.id || `preview-release-row-${String(index + 1).padStart(2, "0")}`,
    label: row.label || row.id || "Preview release row",
    status: row.ready === true ? "ready" : row.status || "waiting",
    ready: row.ready === true,
    required: row.required !== false,
    nextAction: row.nextAction || "refresh-preview-release-ticket",
    code: row.code || "preview.release.ticket.row",
    evidence: row.evidence || {}
  }));
  const blockedRows = normalizedRows.filter((row) => row.required && row.status === "blocked");
  const waitingRows = normalizedRows.filter((row) => row.required && row.ready === false && row.status !== "blocked");
  const readyForRuntimeRelease = source.readyForRuntimeRelease === true
    || (blockedRows.length === 0
      && waitingRows.length === 0
      && previewAcceptancePacket.readyForRuntimeStart === true
      && runtimeReleaseControls.readyForRuntimeStart === true);
  const status = blockedRows.length
    ? "blocked"
    : waitingRows.length
      ? "needs-operator-action"
      : readyForRuntimeRelease
        ? "ready"
        : source.status || "waiting";
  const nextRow = blockedRows[0] || waitingRows[0] || null;
  const nextAction = nextRow?.nextAction
    || source.nextAction
    || (readyForRuntimeRelease ? "release-mailchimp-preview-to-runtime" : "refresh-preview-release-ticket");

  return {
    schemaVersion: "aios.mailchimp.preview-release-ticket-artifact.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    status,
    ticketKey,
    releaseKey,
    acceptanceToken: previewAcceptancePacket.acceptanceToken || null,
    readyForRuntimeRelease,
    nextAction,
    resumeToken,
    statusRevision,
    rows: normalizedRows,
    validationSummary: {
      total: normalizedRows.length,
      ready: normalizedRows.filter((row) => row.ready).length,
      blocked: blockedRows.length,
      waiting: waitingRows.length,
      blockedRowIds: blockedRows.map((row) => row.id),
      waitingRowIds: waitingRows.map((row) => row.id)
    },
    routePayload: {
      method: source.routePayload?.method || "POST",
      path: source.routePayload?.path || `/mailchimp/jobs/${metadata.jobId}/preview/release`,
      idempotencyKey: source.routePayload?.idempotencyKey || `${ticketKey}:${statusRevision}`
        .replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      bodyShape: source.routePayload?.bodyShape || {
        ticketKey: "string",
        acceptanceToken: "string",
        releaseKey: "string",
        resumeToken: "string",
        statusRevision: "string"
      }
    },
    clientPatch: {
      ...(source.clientPatch || {}),
      previewReleaseTicketArtifact: "preview-release-ticket.json",
      previewReleaseTicketKey: ticketKey,
      previewReleaseTicketStatus: status,
      previewReleaseTicketReady: readyForRuntimeRelease,
      previewReleaseTicketNextAction: nextAction,
      previewReleaseTicketBlockedRows: blockedRows.map((row) => row.id),
      previewReleaseTicketWaitingRows: waitingRows.map((row) => row.id),
      previewReleaseTicketResumeToken: resumeToken
    },
    restartSemantics: {
      replaySafe: source.restartSemantics?.replaySafe !== false,
      duplicateCommandPolicy: source.restartSemantics?.duplicateCommandPolicy
        || "dedupe-by-preview-release-ticket-key",
      resumeToken,
      resumeFromTicketKey: source.restartSemantics?.resumeFromTicketKey || ticketKey,
      externalWritesPerformed: false
    },
    truthBoundary: {
      source: "artifact-emitter",
      deterministic: true,
      externalMailchimpStateVerified: false,
      externalWritesPerformed: false
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

function buildRestartCheckpointManifestArtifact(metadata, diagnostics, persistedState, statusRecoveryBundle) {
  const source = metadata.restartCheckpoints || diagnostics.restartCheckpointManifest || {};
  const checkpoints = Array.isArray(source.checkpoints) ? source.checkpoints : [];
  const missingRequired = source.blocking?.missingRequiredCheckpoints
    || checkpoints
      .filter((checkpoint) => checkpoint.required && checkpoint.ready !== true)
      .map((checkpoint) => checkpoint.phase);
  const resumeToken = source.resumeToken
    || statusRecoveryBundle.resume?.resumeToken
    || persistedState.resumeToken
    || diagnostics.statusLedger?.resumeToken
    || `${metadata.jobId}:${diagnostics.status}`;
  const statusRevision = source.statusRevision
    || statusRecoveryBundle.resume?.statusRevision
    || persistedState.statusRevision
    || diagnostics.statusLedger?.statusRevision
    || `${metadata.jobId}:${diagnostics.status}`;
  const readyForColdRestart = source.readyForColdRestart === true
    && missingRequired.length === 0
    && statusRecoveryBundle.readyForRuntimeResume === true;
  const status = readyForColdRestart
    ? "ready"
    : missingRequired.length > 0
      ? "blocked"
      : source.status || "waiting";
  const nextAction = readyForColdRestart
    ? "handoff-to-runtime-adapter"
    : source.nextAction
      || statusRecoveryBundle.nextAction
      || diagnostics.recovery?.nextAction
      || "repair-restart-checkpoints";

  return {
    schemaVersion: "aios.mailchimp.restart-checkpoint-manifest-artifact.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    status,
    readyForColdRestart,
    resumeToken,
    statusRevision,
    nextAction,
    counters: {
      checkpoints: source.counters?.checkpoints || checkpoints.length,
      required: source.counters?.required || checkpoints.filter((checkpoint) => checkpoint.required).length,
      ready: source.counters?.ready || checkpoints.filter((checkpoint) => checkpoint.ready).length,
      restartSafe: source.counters?.restartSafe || checkpoints.filter((checkpoint) => checkpoint.restartSafe).length,
      missingRequired: missingRequired.length,
      commands: source.counters?.commands || persistedState.commandJournal?.commands?.length || 0,
      leases: source.counters?.leases || diagnostics.clientCommandLeases?.leases?.length || 0,
      failures: source.counters?.failures || diagnostics.failureState?.summary?.total || 0
    },
    checkpoints: checkpoints.map((checkpoint, index) => ({
      order: checkpoint.order || index + 1,
      phase: checkpoint.phase,
      source: checkpoint.source || "runtime-state-store",
      required: checkpoint.required === true,
      ready: checkpoint.ready === true,
      restartSafe: checkpoint.restartSafe === true,
      cursor: checkpoint.cursor || null,
      revision: checkpoint.revision || null,
      replayPolicy: checkpoint.replayPolicy || "dedupe-by-idempotency-key",
      nextAction: checkpoint.nextAction || nextAction
    })),
    blocking: {
      missingRequiredCheckpoints: missingRequired,
      commandIds: source.blocking?.commandIds || [],
      leaseIds: source.blocking?.leaseIds || [],
      failureIds: source.blocking?.failureIds || []
    },
    exportSummary: {
      format: "aios.mailchimp.restart-checkpoint-export.v1",
      status,
      readyForColdRestart,
      resumeToken,
      statusRevision,
      missingRequiredCheckpoints: missingRequired,
      nextAction,
      externalWritesPerformed: false
    },
    clientPatch: {
      ...(source.clientPatch || {}),
      restartCheckpointManifestArtifact: "restart-checkpoint-manifest.json",
      restartCheckpointStatus: status,
      restartCheckpointReady: readyForColdRestart,
      restartCheckpointNextAction: nextAction,
      restartCheckpointResumeToken: resumeToken,
      restartCheckpointRevision: statusRevision,
      restartCheckpointMissing: missingRequired
    },
    restartSemantics: {
      replaySafe: readyForColdRestart,
      duplicateCommandPolicy: source.restartSemantics?.duplicateCommandPolicy
        || persistedState.restartSemantics?.duplicateCommandPolicy
        || "dedupe-by-idempotency-key",
      resumeFromCommandId: source.restartSemantics?.resumeFromCommandId || persistedState.commandJournal?.cursor?.commandId || null,
      resumeFromLeaseId: source.restartSemantics?.resumeFromLeaseId || diagnostics.clientCommandLeases?.clientAck?.resumeFromLeaseId || null,
      resumeFromFailureId: source.restartSemantics?.resumeFromFailureId || diagnostics.failureState?.adapterHandoff?.resumeFromFailureId || null,
      externalWritesPerformed: false,
      staleStatusPolicy: source.restartSemantics?.staleStatusPolicy || statusRecoveryBundle.restartSemantics?.staleStatusPolicy || {}
    }
  };
}

function buildRestartReplayLedgerArtifact(metadata, diagnostics, persistedState, restartCheckpointManifest) {
  const source = metadata.restartReplay || diagnostics.restartReplayLedger || {};
  const rows = Array.isArray(source.rows) ? source.rows : [];
  const unsafeRows = rows.filter((row) => row.replaySafe !== true);
  const ackRows = rows.filter((row) => row.requiresAck === true);
  const blockedRows = rows.filter((row) => row.blocksRuntimeStart === true || row.status === "blocked");
  const resumeToken = source.resumeToken
    || restartCheckpointManifest.resumeToken
    || persistedState.resumeToken
    || diagnostics.statusLedger?.resumeToken
    || `${metadata.jobId}:restart-replay:${source.status || diagnostics.status}`;
  const statusRevision = source.statusRevision
    || restartCheckpointManifest.statusRevision
    || persistedState.statusRevision
    || diagnostics.statusLedger?.statusRevision
    || `${metadata.jobId}:${source.status || diagnostics.status}:${rows.length}`;
  const replayReady = source.replayReady === true
    && unsafeRows.length === 0
    && restartCheckpointManifest.readyForColdRestart === true;
  const status = replayReady
    ? "ready"
    : unsafeRows.length > 0 || restartCheckpointManifest.status === "blocked"
      ? "blocked"
      : ackRows.length > 0
        ? "waiting-for-client"
        : source.status || "degraded";
  const nextRow = unsafeRows[0] || ackRows[0] || blockedRows[0] || rows[0] || null;
  const nextAction = replayReady
    ? "handoff-to-runtime-adapter"
    : source.nextAction
      || nextRow?.nextAction
      || restartCheckpointManifest.nextAction
      || "repair-restart-replay-ledger";

  return {
    schemaVersion: "aios.mailchimp.restart-replay-ledger-artifact.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    status,
    replayReady,
    resumeToken,
    statusRevision,
    nextAction,
    rows: rows.map((row, index) => ({
      order: row.order || index + 1,
      id: row.id || `${metadata.jobId}:restart-replay:${String(index + 1).padStart(2, "0")}`,
      kind: row.kind || "replay-row",
      sourceId: row.sourceId || null,
      status: row.status || "unknown",
      replaySafe: row.replaySafe === true,
      replayPolicy: row.replayPolicy || source.duplicatePolicy?.defaultPolicy || "dedupe-by-idempotency-key",
      cursor: row.cursor || null,
      nextAction: row.nextAction || nextAction,
      requiresAck: row.requiresAck === true,
      blocksRuntimeStart: row.blocksRuntimeStart === true,
      retryable: row.retryable === true
    })),
    counters: {
      rows: source.counters?.rows || rows.length,
      commands: source.counters?.commands || rows.filter((row) => row.kind === "recovery-command").length,
      leases: source.counters?.leases || rows.filter((row) => row.kind === "client-command-lease").length,
      failures: source.counters?.failures || rows.filter((row) => row.kind === "adapter-failure").length,
      unsafe: source.counters?.unsafe || unsafeRows.length,
      ackRequired: source.counters?.ackRequired || ackRows.length,
      blocked: source.counters?.blocked || blockedRows.length,
      retryable: source.counters?.retryable || rows.filter((row) => row.retryable).length
    },
    exportSummary: {
      artifactName: "restart-replay-ledger.json",
      status,
      replayReady,
      resumeToken,
      statusRevision,
      unsafeRowIds: unsafeRows.map((row) => row.id).filter(Boolean),
      ackRequiredRowIds: ackRows.map((row) => row.id).filter(Boolean),
      nextAction,
      externalWritesPerformed: false
    },
    clientPatch: {
      ...(source.clientPatch || {}),
      restartReplayLedgerArtifact: "restart-replay-ledger.json",
      restartReplayStatus: status,
      restartReplayReady: replayReady,
      restartReplayNextAction: nextAction,
      restartReplayResumeToken: resumeToken,
      restartReplayRevision: statusRevision
    },
    restartSemantics: {
      replaySafe: replayReady || unsafeRows.length === 0,
      duplicateCommandPolicy: source.restartSemantics?.duplicateCommandPolicy
        || persistedState.restartSemantics?.duplicateCommandPolicy
        || "dedupe-by-idempotency-key",
      staleStatusPolicy: source.restartSemantics?.staleStatusPolicy
        || persistedState.statusSnapshot?.restartSafe?.staleStatusPolicy
        || {},
      externalWritesPerformed: false
    }
  };
}

function buildPersistedStatusEnvelopeArtifact(metadata, diagnostics, persistedState) {
  const source = diagnostics.persistedStatusEnvelope || {};
  const rows = Array.isArray(source.rows) ? source.rows : [];
  const blockedRows = rows.filter((row) => row.status === "blocked" || row.blocksRuntimeStart === true);
  const waitingRows = rows.filter((row) => row.status === "waiting");
  const unsafeRows = rows.filter((row) => row.restartSafe === false);
  const status = source.status || (
    blockedRows.length > 0
      ? "blocked"
      : waitingRows.length > 0
        ? "waiting"
        : "ready"
  );
  const resumeToken = source.resumeToken
    || persistedState.resumeToken
    || diagnostics.statusLedger?.resumeToken
    || `${metadata.jobId}:persisted-status:${status}`.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const statusRevision = source.statusRevision
    || persistedState.statusRevision
    || diagnostics.statusLedger?.statusRevision
    || `${metadata.jobId}:${status}:persisted-status`.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const readyForRuntimeResume = source.readyForRuntimeResume === true
    && status === "ready"
    && unsafeRows.length === 0;
  const nextAction = source.nextAction
    || blockedRows[0]?.nextAction
    || waitingRows[0]?.nextAction
    || persistedState.recoveryCursor?.nextAction
    || diagnostics.recovery?.nextAction
    || "refresh-persisted-status-envelope";

  return {
    schemaVersion: "aios.mailchimp.persisted-status-envelope-artifact.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    status,
    compilerStatus: source.compilerStatus || diagnostics.status,
    runtimeAdapter: source.runtimeAdapter || metadata.runtimeAdapter,
    readyForRuntimeResume,
    readyForClientStatus: source.readyForClientStatus !== false && status !== "blocked",
    visibleStatus: source.visibleStatus || diagnostics.statusHandoff?.visibleStatus || status,
    resumeToken,
    statusRevision,
    persistedAtPhase: source.persistedAtPhase || diagnostics.statusLedger?.persistedAtPhase || "compile-recovery",
    nextAction: readyForRuntimeResume ? "handoff-to-runtime-adapter" : nextAction,
    rows: rows.map((row, index) => ({
      order: row.order || index + 1,
      commandId: row.commandId || null,
      command: row.command || "runtime-status-command",
      status: row.status || "unknown",
      commandStatus: row.commandStatus || "unknown",
      required: row.required === true,
      blocksRuntimeStart: row.blocksRuntimeStart === true,
      nextAction: row.nextAction || nextAction,
      idempotencyKey: row.idempotencyKey || null,
      resumeCursor: row.resumeCursor || null,
      leaseId: row.leaseId || null,
      ackRequired: row.ackRequired === true,
      ackKey: row.ackKey || null,
      restartSafe: row.restartSafe === true,
      owner: row.owner || "runtime-adapter",
      failureClass: row.failureClass || null
    })),
    counters: {
      rows: source.counters?.rows || rows.length,
      ready: source.counters?.ready || rows.filter((row) => row.status === "ready").length,
      waiting: source.counters?.waiting || waitingRows.length,
      blocked: source.counters?.blocked || blockedRows.length,
      restartUnsafe: source.counters?.restartUnsafe || unsafeRows.length,
      ackRequired: source.counters?.ackRequired || rows.filter((row) => row.ackRequired).length,
      retryableFailures: source.counters?.retryableFailures || diagnostics.failureState?.summary?.retryable || 0
    },
    blocking: {
      commandIds: source.blocking?.commandIds || blockedRows.map((row) => row.commandId).filter(Boolean),
      waitingCommandIds: source.blocking?.waitingCommandIds || waitingRows.map((row) => row.commandId).filter(Boolean),
      unsafeCommandIds: source.blocking?.unsafeCommandIds || unsafeRows.map((row) => row.commandId).filter(Boolean),
      failureMode: source.blocking?.failureMode || diagnostics.failureState?.mode || "unknown",
      failureQueueLength: source.blocking?.failureQueueLength || diagnostics.failureState?.summary?.total || 0
    },
    routePayload: source.routePayload || {
      method: "PUT",
      path: `/mailchimp/jobs/${metadata.jobId}/status-envelope`,
      idempotencyKey: `${metadata.jobId}:${statusRevision}:${resumeToken}`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      bodyShape: {
        statusRevision: "string",
        resumeToken: "string",
        rows: "array",
        restartSemantics: "object"
      }
    },
    exportSummary: {
      artifactName: "persisted-status-envelope.json",
      status,
      readyForRuntimeResume,
      resumeToken,
      statusRevision,
      blockedCommandIds: source.blocking?.commandIds || blockedRows.map((row) => row.commandId).filter(Boolean),
      unsafeCommandIds: source.blocking?.unsafeCommandIds || unsafeRows.map((row) => row.commandId).filter(Boolean),
      nextAction: readyForRuntimeResume ? "handoff-to-runtime-adapter" : nextAction,
      externalWritesPerformed: false
    },
    clientPatch: {
      ...(source.clientPatch || {}),
      persistedStatusEnvelopeArtifact: "persisted-status-envelope.json",
      persistedStatusEnvelopeStatus: status,
      persistedStatusEnvelopeReady: readyForRuntimeResume,
      persistedStatusEnvelopeNextAction: readyForRuntimeResume ? "handoff-to-runtime-adapter" : nextAction,
      persistedStatusEnvelopeResumeToken: resumeToken,
      persistedStatusEnvelopeRevision: statusRevision
    },
    restartSemantics: {
      replaySafe: readyForRuntimeResume,
      duplicateCommandPolicy: source.restartSemantics?.duplicateCommandPolicy || "dedupe-by-status-envelope-revision",
      resumeFromCommandId: source.restartSemantics?.resumeFromCommandId || rows[0]?.commandId || null,
      staleStatusPolicy: source.restartSemantics?.staleStatusPolicy
        || persistedState.statusSnapshot?.restartSafe?.staleStatusPolicy
        || {},
      externalWritesPerformed: false
    },
    truthBoundary: {
      source: "artifact-emitter",
      deterministic: true,
      externalMailchimpStateVerified: false,
      externalWritesPerformed: false
    }
  };
}

function buildRuntimeStatusReplayCursorArtifact(metadata, diagnostics, persistedState, persistedStatusEnvelope, restartReplayLedger) {
  const source = diagnostics.runtimeStatusReplayCursor || {};
  const replayRows = Array.isArray(source.rows)
    ? source.rows
    : Array.isArray(restartReplayLedger.rows)
      ? restartReplayLedger.rows.map((row, index) => ({
        order: index + 1,
        jobId: row.jobId || metadata.jobId,
        operation: row.operation || "mailchimp-runtime-status",
        status: row.status || restartReplayLedger.status || "unknown",
        replayCursor: row.replayCursor || row.resumeCursor || restartReplayLedger.resumeToken,
        checkpointKey: row.checkpointKey || persistedState.statusSnapshot?.checkpointKey || null,
        ledgerKey: row.ledgerKey || persistedState.commandJournal?.ledgerKey || null,
        adapterStatusResumeCursor: row.adapterStatusResumeCursor || row.resumeCursor || null,
        idempotencyKey: row.idempotencyKey || null,
        nextCommandId: row.commandId || null,
        replayDecision: row.replayAction || restartReplayLedger.nextAction || "return-existing-status",
        replaySafe: row.restartSafe !== false && row.unsafe !== true,
        blocked: row.status === "blocked",
        waiting: row.status === "waiting" || row.status === "needs-operator-action",
        nextAction: row.nextAction || restartReplayLedger.nextAction || "return-existing-status",
        commandIds: row.commandId ? [row.commandId] : []
      }))
      : [];
  const blockedRows = replayRows.filter((row) => row.blocked || row.status === "blocked");
  const waitingRows = replayRows.filter((row) => row.waiting || row.status === "waiting");
  const unsafeRows = replayRows.filter((row) => row.replaySafe === false);
  const status = source.status || (
    blockedRows.length > 0
      ? "blocked"
      : waitingRows.length > 0
        ? "waiting"
        : "ready"
  );
  const replayCursor = source.replayCursor
    || persistedState.runtimeStatusReplayCursor?.replayCursor
    || restartReplayLedger.resumeToken
    || persistedStatusEnvelope.resumeToken
    || persistedState.resumeToken;
  const resumeToken = source.resumeToken
    || persistedState.runtimeStatusReplayCursor?.resumeToken
    || persistedStatusEnvelope.resumeToken
    || persistedState.resumeToken
    || replayCursor;
  const statusRevision = source.statusRevision
    || persistedStatusEnvelope.statusRevision
    || persistedState.statusRevision
    || `${metadata.jobId}:${status}:runtime-status-replay`;
  const readyForRestart = source.readyForRestart === true
    || (status !== "blocked" && unsafeRows.length === 0 && Boolean(replayCursor));
  const readyForRuntimeRelease = readyForRestart
    && persistedStatusEnvelope.readyForRuntimeResume !== false
    && blockedRows.length === 0;
  const nextAction = source.nextAction
    || blockedRows[0]?.nextAction
    || waitingRows[0]?.nextAction
    || persistedStatusEnvelope.nextAction
    || restartReplayLedger.nextAction
    || "handoff-to-runtime-adapter";

  return {
    schemaVersion: "aios.mailchimp.runtime-status-replay-cursor-artifact.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    status,
    replayCursor,
    resumeToken,
    statusRevision,
    readyForRestart,
    readyForRuntimeRelease,
    nextAction: readyForRuntimeRelease ? "handoff-to-runtime-adapter" : nextAction,
    rows: replayRows.map((row, index) => ({
      order: row.order || index + 1,
      jobId: row.jobId || metadata.jobId,
      operation: row.operation || "mailchimp-runtime-status",
      status: row.status || "unknown",
      reason: row.reason || null,
      replayCursor: row.replayCursor || replayCursor,
      checkpointKey: row.checkpointKey || null,
      ledgerKey: row.ledgerKey || null,
      adapterStatusResumeCursor: row.adapterStatusResumeCursor || null,
      clientResumeToken: row.clientResumeToken || null,
      idempotencyKey: row.idempotencyKey || null,
      nextCommandId: row.nextCommandId || null,
      replayDecision: row.replayDecision || "return-existing-status",
      replaySafe: row.replaySafe !== false,
      blocked: row.blocked === true,
      waiting: row.waiting === true,
      nextAction: row.nextAction || nextAction,
      commandIds: row.commandIds || []
    })),
    counters: {
      rows: replayRows.length,
      blocked: blockedRows.length,
      waiting: waitingRows.length,
      unsafe: unsafeRows.length,
      replayable: replayRows.filter((row) => row.replaySafe !== false).length
    },
    blocking: {
      blockedJobIds: blockedRows.map((row) => row.jobId).filter(Boolean),
      waitingJobIds: waitingRows.map((row) => row.jobId).filter(Boolean),
      unsafeJobIds: unsafeRows.map((row) => row.jobId).filter(Boolean)
    },
    routePayload: source.routePayload || {
      method: "PUT",
      path: `/mailchimp/jobs/${metadata.jobId}/runtime-status-replay-cursor`,
      idempotencyKey: `${metadata.jobId}:${statusRevision}:${resumeToken}`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      bodyShape: {
        replayCursor: "string",
        resumeToken: "string",
        statusRevision: "string",
        rows: "array",
        restartSemantics: "object"
      }
    },
    clientPatch: {
      ...(source.clientPatch || {}),
      runtimeStatusReplayCursorArtifact: "runtime-status-replay-cursor.json",
      runtimeStatusReplayCursorStatus: status,
      runtimeStatusReplayCursorReady: readyForRestart,
      runtimeStatusReplayCursorNextAction: readyForRuntimeRelease ? "handoff-to-runtime-adapter" : nextAction,
      runtimeStatusReplayBlockedJobs: blockedRows.map((row) => row.jobId).filter(Boolean),
      runtimeStatusReplayWaitingJobs: waitingRows.map((row) => row.jobId).filter(Boolean)
    },
    restartSemantics: {
      replaySafe: readyForRestart,
      duplicateCommandPolicy: source.restartSemantics?.duplicateCommandPolicy
        || "dedupe-by-runtime-status-replay-cursor",
      onColdRestart: source.restartSemantics?.onColdRestart || "load-runtime-status-replay-cursor",
      onDuplicateCommand: source.restartSemantics?.onDuplicateCommand || "return-existing-runtime-status",
      externalWritesPerformed: false
    },
    truthBoundary: {
      source: "artifact-emitter",
      deterministic: true,
      externalMailchimpStateVerified: false,
      externalWritesPerformed: false
    }
  };
}

function buildPreviewExportReadinessArtifact(metadata, diagnostics) {
  const source = metadata.previewExportReadiness || diagnostics.previewExportReadiness || {};
  const rows = Array.isArray(source.rows) ? source.rows : [];
  const blockedRows = rows.filter((row) => row.status === "blocked");
  const waitingRows = rows.filter((row) => row.status === "waiting" || row.status === "needs-operator-action");
  const status = source.status
    || (blockedRows.length > 0
      ? "blocked"
      : waitingRows.length > 0
        ? "needs-operator-action"
        : "ready");
  const exportReady = (source.exportReady === true || source.ready === true)
    && blockedRows.length === 0
    && source.restartSemantics?.externalWritesPerformed !== true;
  const resumeToken = source.resumeToken
    || metadata.exports?.summary?.resumeToken
    || diagnostics.statusLedger?.resumeToken
    || `${metadata.jobId}:preview-export:${status}`.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const nextRow = blockedRows[0] || waitingRows[0] || rows.find((row) => row.status !== "ready") || null;

  return {
    schemaVersion: "aios.mailchimp.preview-export-readiness-artifact.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    status,
    ready: exportReady,
    exportReady,
    readyForClientPreview: source.readyForClientPreview === true,
    readyForRuntimeStart: source.readyForRuntimeStart === true,
    acceptanceToken: source.acceptanceToken || metadata.preview?.acceptance?.acceptanceToken || null,
    routeId: source.routeId || metadata.previewHandoff?.routeId || null,
    resumeToken,
    statusRevision: source.statusRevision
      || metadata.exports?.summary?.statusRevision
      || diagnostics.statusLedger?.statusRevision
      || `${metadata.jobId}:${status}`,
    nextAction: nextRow?.nextAction
      || source.nextAction
      || (exportReady ? "publish-preview-export-readiness" : "repair-preview-export-readiness"),
    validationSummary: {
      ...(source.validationSummary || {}),
      total: source.validationSummary?.total || rows.length,
      blocked: source.validationSummary?.blocked || blockedRows.length,
      waiting: source.validationSummary?.waiting || waitingRows.length
    },
    rows: rows.map((row) => ({
      id: row.id,
      order: row.order,
      phase: row.phase,
      status: row.status,
      nextAction: row.nextAction,
      counters: row.counters || {}
    })),
    exportSummary: {
      artifactName: "preview-export-readiness.json",
      rowIds: source.exportSummary?.rowIds || rows.map((row) => row.id),
      blockedRowIds: source.exportSummary?.blockedRowIds || blockedRows.map((row) => row.id),
      waitingRowIds: source.exportSummary?.waitingRowIds || waitingRows.map((row) => row.id),
      historySnapshotIds: source.exportSummary?.historySnapshotIds || [],
      externalWritesPerformed: false
    },
    clientPatch: {
      ...(source.clientPatch || {}),
      previewExportReadinessArtifact: "preview-export-readiness.json",
      previewExportReadinessArtifactReady: exportReady,
      previewExportReadinessArtifactStatus: status,
      previewExportReadinessArtifactNextAction: nextRow?.nextAction || source.nextAction || "publish-preview-export-readiness"
    },
    restartSemantics: source.restartSemantics || {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-preview-export-readiness-revision",
      resumeToken,
      externalWritesPerformed: false
    }
  };
}

function buildPreviewReadinessManifestArtifact(metadata, diagnostics, assembled = {}) {
  const previewAcceptance = assembled.previewAcceptance || {};
  const previewAcceptancePacket = assembled.previewAcceptancePacket || {};
  const previewHandoff = assembled.previewHandoff || {};
  const previewExportReadiness = assembled.previewExportReadiness || {};
  const clientReadinessBrief = assembled.clientReadinessBrief || {};
  const runtimeReleaseControls = assembled.runtimeReleaseControls || {};
  const statusLedger = diagnostics.statusLedger || {};
  const routeId = `${metadata.jobId}:preview-readiness-manifest`.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const resumeToken = previewExportReadiness.resumeToken
    || clientReadinessBrief.route?.resumeToken
    || metadata.exports?.summary?.resumeToken
    || statusLedger.resumeToken
    || `${metadata.jobId}:preview-readiness`.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const statusRevision = previewExportReadiness.statusRevision
    || clientReadinessBrief.route?.statusRevision
    || metadata.exports?.summary?.statusRevision
    || statusLedger.statusRevision
    || `${metadata.jobId}:preview-readiness`;
  const sourceSections = [
    {
      id: "acceptance",
      label: "Preview acceptance",
      status: previewAcceptancePacket.status || previewAcceptance.status || "unknown",
      readyForClientPreview: previewAcceptancePacket.readyForClient !== false
        && Boolean(previewAcceptance.acceptanceToken || previewAcceptancePacket.acceptanceToken),
      readyForRuntimeStart: previewAcceptancePacket.readyForRuntimeStart === true,
      nextAction: previewAcceptancePacket.nextAction
        || previewAcceptance.nextAction
        || "accept-preview-before-runtime-start",
      artifactNames: ["preview-acceptance.json", "preview-acceptance-packet.json"],
      evidence: {
        acceptanceToken: previewAcceptancePacket.acceptanceToken || previewAcceptance.acceptanceToken || null,
        pending: previewAcceptancePacket.validationSummary?.pending || previewAcceptance.validationSummary?.pending || 0,
        blocked: previewAcceptancePacket.validationSummary?.blocked || previewAcceptance.validationSummary?.blocked || 0
      }
    },
    {
      id: "preview-handoff",
      label: "Client preview handoff",
      status: previewHandoff.status || "unknown",
      readyForClientPreview: previewHandoff.readyForAcceptance === true || previewHandoff.readyForClient === true,
      readyForRuntimeStart: previewHandoff.readyForRuntimeStart === true,
      nextAction: previewHandoff.nextAction || previewHandoff.primaryAction || "refresh-preview-handoff",
      artifactNames: ["preview-handoff.json"],
      evidence: {
        routeId: previewHandoff.routeId || null,
        blockedGateIds: previewHandoff.acceptance?.blockedGateIds || [],
        pendingGateIds: previewHandoff.acceptance?.pendingGateIds || []
      }
    },
    {
      id: "preview-export",
      label: "Preview export readiness",
      status: previewExportReadiness.status || "unknown",
      readyForClientPreview: previewExportReadiness.readyForClientPreview === true
        || previewExportReadiness.exportReady === true,
      readyForRuntimeStart: previewExportReadiness.readyForRuntimeStart === true,
      nextAction: previewExportReadiness.nextAction || "refresh-preview-export-readiness",
      artifactNames: ["preview-export-readiness.json"],
      evidence: {
        blockedRowIds: previewExportReadiness.exportSummary?.blockedRowIds || [],
        waitingRowIds: previewExportReadiness.exportSummary?.waitingRowIds || [],
        rowCount: previewExportReadiness.rows?.length || 0
      }
    },
    {
      id: "runtime-release",
      label: "Runtime release controls",
      status: runtimeReleaseControls.status || "unknown",
      readyForClientPreview: runtimeReleaseControls.status !== "blocked",
      readyForRuntimeStart: runtimeReleaseControls.readyForRuntimeStart === true,
      nextAction: runtimeReleaseControls.nextAction || "refresh-runtime-release-controls",
      artifactNames: ["runtime-release-controls.json"],
      evidence: {
        nextGateId: runtimeReleaseControls.nextGateId || null,
        blockedGateIds: runtimeReleaseControls.blocking?.blockedGateIds
          || runtimeReleaseControls.clientPatch?.runtimeReleaseBlockedGateIds
          || [],
        waitingGateIds: runtimeReleaseControls.blocking?.waitingGateIds
          || runtimeReleaseControls.clientPatch?.runtimeReleaseWaitingGateIds
          || []
      }
    },
    {
      id: "client-readiness",
      label: "Client readiness brief",
      status: clientReadinessBrief.status || "unknown",
      readyForClientPreview: clientReadinessBrief.readyForClientPreview === true,
      readyForRuntimeStart: clientReadinessBrief.readyForRuntimeStart === true,
      nextAction: clientReadinessBrief.nextAction || "refresh-client-readiness-brief",
      artifactNames: ["client-readiness-brief.json"],
      evidence: {
        routeId: clientReadinessBrief.route?.routeId || null,
        blockedSectionIds: clientReadinessBrief.validationSummary?.blockingSectionIds || [],
        pendingSectionIds: clientReadinessBrief.validationSummary?.pendingSectionIds || []
      }
    }
  ];
  const sections = sourceSections.map((section, index) => ({
    ...section,
    order: index + 1,
    status: section.readyForRuntimeStart
      ? "ready"
      : section.status === "blocked" || section.evidence.blocked > 0
        ? "blocked"
        : section.readyForClientPreview
          ? "needs-operator-action"
          : section.status || "unknown"
  }));
  const blockedSections = sections.filter((section) => section.status === "blocked");
  const pendingSections = sections.filter((section) => (
    section.status === "needs-operator-action" || section.status === "waiting"
  ));
  const nextSection = blockedSections[0] || pendingSections[0] || sections.find((section) => !section.readyForRuntimeStart) || null;
  const status = blockedSections.length > 0
    ? "blocked"
    : pendingSections.length > 0
      ? "needs-operator-action"
      : "ready";

  return {
    schemaVersion: "aios.mailchimp.preview-readiness-manifest-artifact.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    status,
    visibleStatus: status === "ready"
      ? "mailchimp-preview-ready"
      : status === "blocked"
        ? "mailchimp-preview-blocked"
        : "mailchimp-preview-waiting",
    readyForClientPreview: blockedSections.length === 0
      && sections.every((section) => section.readyForClientPreview),
    readyForRuntimeStart: blockedSections.length === 0
      && pendingSections.length === 0
      && sections.every((section) => section.readyForRuntimeStart),
    nextAction: nextSection?.nextAction || "handoff-to-runtime-adapter",
    nextSectionId: nextSection?.id || null,
    route: {
      routeId,
      target: "client-preview",
      resumeToken,
      statusRevision,
      idempotencyKey: `${routeId}:${statusRevision}:${resumeToken}`.replace(/[^a-zA-Z0-9_.:-]/g, "_")
    },
    validationSummary: {
      total: sections.length,
      ready: sections.filter((section) => section.status === "ready").length,
      blocked: blockedSections.length,
      pending: pendingSections.length,
      blockedSectionIds: blockedSections.map((section) => section.id),
      pendingSectionIds: pendingSections.map((section) => section.id)
    },
    sections,
    clientPatch: {
      previewReadinessManifestArtifact: "preview-readiness-manifest.json",
      previewReadinessManifestStatus: status,
      previewReadinessManifestRouteId: routeId,
      previewReadinessManifestNextAction: nextSection?.nextAction || "handoff-to-runtime-adapter",
      previewReadinessManifestReadyForPreview: blockedSections.length === 0
        && sections.every((section) => section.readyForClientPreview),
      previewReadinessManifestReadyForRuntimeStart: blockedSections.length === 0
        && pendingSections.length === 0
        && sections.every((section) => section.readyForRuntimeStart)
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-preview-readiness-route",
      resumeToken,
      statusRevision,
      resumeFromSectionId: nextSection?.id || null,
      externalWritesPerformed: false
    },
    truthBoundary: {
      source: "artifact-emitter",
      deterministic: true,
      externalMailchimpStateVerified: false,
      externalWritesPerformed: false
    }
  };
}

function buildClientReadinessBriefArtifact(metadata, diagnostics, assembled = {}) {
  const previewAcceptance = assembled.previewAcceptance || {};
  const previewAcceptancePacket = assembled.previewAcceptancePacket || {};
  const previewHandoff = assembled.previewHandoff || {};
  const previewExportReadiness = assembled.previewExportReadiness || {};
  const clientWorkflow = assembled.clientWorkflow || {};
  const clientRuntimeAdoption = assembled.clientRuntimeAdoption || {};
  const clientRuntimeSettings = assembled.clientRuntimeSettings || {};
  const settingsRolloutGate = assembled.settingsRolloutGate || {};
  const clientStatusHandoff = assembled.clientStatusHandoff || {};
  const runtimeReleaseControls = assembled.runtimeReleaseControls || {};
  const operationalHealthReport = assembled.operationalHealthReport || {};
  const clientRemediationPacket = assembled.clientRemediationPacket || {};
  const statusLedger = diagnostics.statusLedger || {};
  const routeId = `${metadata.jobId}:client-readiness-brief`.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const resumeToken = statusLedger.resumeToken
    || metadata.exports?.summary?.resumeToken
    || operationalHealthReport.resumeToken
    || previewExportReadiness.resumeToken
    || `${metadata.jobId}:client-readiness`.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const statusRevision = statusLedger.statusRevision
    || metadata.exports?.summary?.statusRevision
    || operationalHealthReport.statusRevision
    || previewExportReadiness.statusRevision
    || `${metadata.jobId}:${diagnostics.status || "unknown"}`;
  const sectionRows = [
    {
      id: "preview-acceptance",
      label: "Preview acceptance",
      status: previewAcceptancePacket.status || previewAcceptance.status || "unknown",
      readyForClientPreview: previewAcceptancePacket.readyForAcceptance === true
        || previewHandoff.readyForAcceptance === true,
      readyForRuntimeStart: previewAcceptancePacket.readyForRuntimeStart === true
        && previewHandoff.readyForRuntimeStart === true,
      nextAction: previewAcceptancePacket.nextAction
        || previewHandoff.nextAction
        || previewAcceptance.explainNextStep?.action
        || "accept-preview",
      routeId: previewAcceptancePacket.routeId || previewHandoff.routeId || null,
      token: previewAcceptancePacket.acceptanceToken || previewAcceptance.acceptanceToken || null,
      counters: {
        blocked: previewAcceptancePacket.validationSummary?.blocked
          || previewHandoff.validationSummary?.blocked
          || previewAcceptance.validationSummary?.blocked
          || 0,
        pending: previewAcceptancePacket.validationSummary?.pending
          || previewHandoff.validationSummary?.pending
          || previewAcceptance.validationSummary?.pending
          || 0
      }
    },
    {
      id: "client-workflow",
      label: "Client workflow",
      status: clientWorkflow.status || "unknown",
      readyForClientPreview: clientWorkflow.preview?.readyForPreview === true
        || clientWorkflow.validationSummary?.blocked === 0,
      readyForRuntimeStart: clientWorkflow.validationSummary?.blocked === 0
        && clientWorkflow.validationSummary?.pending === 0,
      nextAction: clientWorkflow.explainNextStep?.action
        || clientWorkflow.primaryAction
        || "refresh-client-workflow",
      routeId: clientWorkflow.clientPatch?.scopedWorkflowId || null,
      token: clientWorkflow.explainNextStep?.resumeToken || null,
      counters: {
        blocked: clientWorkflow.validationSummary?.blocked || 0,
        pending: clientWorkflow.validationSummary?.pending || 0
      }
    },
    {
      id: "runtime-adoption",
      label: "Runtime adoption",
      status: clientRuntimeAdoption.status || "unknown",
      readyForClientPreview: clientRuntimeAdoption.readyForClientRuntime === true
        || clientRuntimeAdoption.status === "waiting-for-client",
      readyForRuntimeStart: clientRuntimeAdoption.readyForClientRuntime === true,
      nextAction: clientRuntimeAdoption.nextAction || "refresh-client-runtime-adoption",
      routeId: clientRuntimeAdoption.adoptionId || null,
      token: clientRuntimeAdoption.resume?.resumeToken || null,
      counters: {
        blocked: clientRuntimeAdoption.missingStateKeys?.length || 0,
        pending: clientRuntimeAdoption.commandAck?.pendingKeys?.length || 0
      }
    },
    {
      id: "runtime-settings",
      label: "Runtime settings",
      status: clientRuntimeSettings.status || "unknown",
      readyForClientPreview: clientRuntimeSettings.revisionAccepted !== false,
      readyForRuntimeStart: clientRuntimeSettings.readyForClientRuntime === true
        && settingsRolloutGate.readyForRuntimeStart === true,
      nextAction: settingsRolloutGate.nextAction
        || clientRuntimeSettings.nextAction
        || "accept-mailchimp-client-settings",
      routeId: settingsRolloutGate.rolloutKey || clientRuntimeSettings.settingsRevision || null,
      token: clientRuntimeSettings.settingsRevision || null,
      counters: {
        blocked: clientRuntimeSettings.missingRequiredSettings?.length
          || settingsRolloutGate.counters?.blocked
          || 0,
        pending: clientRuntimeSettings.revisionAccepted === false ? 1 : 0
      }
    },
    {
      id: "status-handoff",
      label: "Status handoff",
      status: clientStatusHandoff.status || "unknown",
      readyForClientPreview: clientStatusHandoff.readyForClient === true,
      readyForRuntimeStart: clientStatusHandoff.readyForRuntime === true,
      nextAction: clientStatusHandoff.nextAction || "refresh-mailchimp-client-status",
      routeId: clientStatusHandoff.route?.routeId || null,
      token: clientStatusHandoff.statusLedger?.resumeToken || null,
      counters: {
        blocked: clientStatusHandoff.blocking?.runtimeBlocked === true ? 1 : 0,
        pending: clientStatusHandoff.commandAck?.pendingKeys?.length || 0
      }
    },
    {
      id: "runtime-release",
      label: "Runtime release",
      status: runtimeReleaseControls.status || "unknown",
      readyForClientPreview: runtimeReleaseControls.status !== "blocked",
      readyForRuntimeStart: runtimeReleaseControls.readyForRuntimeStart === true,
      nextAction: runtimeReleaseControls.nextAction || "review-runtime-release-controls",
      routeId: runtimeReleaseControls.releaseKey || null,
      token: runtimeReleaseControls.releaseToken || null,
      counters: {
        blocked: runtimeReleaseControls.clientPatch?.runtimeReleaseBlockedGateIds?.length
          || runtimeReleaseControls.blocking?.blockedGateIds?.length
          || 0,
        pending: runtimeReleaseControls.clientPatch?.runtimeReleaseWaitingGateIds?.length
          || runtimeReleaseControls.blocking?.waitingGateIds?.length
          || 0
      }
    },
    {
      id: "operational-health",
      label: "Operational health",
      status: operationalHealthReport.status || "unknown",
      readyForClientPreview: clientRemediationPacket.readyForClient === true
        || operationalHealthReport.exportReady === true,
      readyForRuntimeStart: operationalHealthReport.readyForRuntimeStart === true
        && clientRemediationPacket.readyForRuntime === true,
      nextAction: clientRemediationPacket.nextAction
        || operationalHealthReport.nextAction
        || "refresh-operational-health-report",
      routeId: clientRemediationPacket.route?.routeId || operationalHealthReport.reportId || null,
      token: clientRemediationPacket.route?.resumeToken || operationalHealthReport.resumeToken || null,
      counters: {
        blocked: clientRemediationPacket.counters?.blocking
          || operationalHealthReport.counters?.blocking
          || 0,
        pending: clientRemediationPacket.counters?.waiting
          || operationalHealthReport.counters?.degraded
          || 0
      }
    },
    {
      id: "preview-export",
      label: "Preview export",
      status: previewExportReadiness.status || "unknown",
      readyForClientPreview: previewExportReadiness.readyForClientPreview === true
        || previewExportReadiness.exportReady === true,
      readyForRuntimeStart: previewExportReadiness.readyForRuntimeStart === true,
      nextAction: previewExportReadiness.nextAction || "refresh-preview-export-readiness",
      routeId: previewExportReadiness.routeId || null,
      token: previewExportReadiness.resumeToken || null,
      counters: {
        blocked: previewExportReadiness.validationSummary?.blocked
          || previewExportReadiness.exportSummary?.blockedRowIds?.length
          || 0,
        pending: previewExportReadiness.validationSummary?.waiting
          || previewExportReadiness.exportSummary?.waitingRowIds?.length
          || 0
      }
    }
  ];
  const blockingSections = sectionRows.filter((section) => section.counters.blocked > 0 || section.status === "blocked");
  const pendingSections = sectionRows.filter((section) => section.counters.pending > 0
    || section.status === "needs-operator-action"
    || section.status === "waiting-for-client");
  const readyForClientPreview = blockingSections.length === 0
    && sectionRows.every((section) => section.readyForClientPreview === true);
  const readyForRuntimeStart = readyForClientPreview
    && pendingSections.length === 0
    && sectionRows.every((section) => section.readyForRuntimeStart === true);
  const nextSection = blockingSections[0]
    || pendingSections[0]
    || sectionRows.find((section) => section.readyForRuntimeStart !== true)
    || sectionRows[0];
  const status = blockingSections.length > 0
    ? "blocked"
    : pendingSections.length > 0 || readyForRuntimeStart === false
      ? "needs-operator-action"
      : "ready";

  return {
    schemaVersion: "aios.mailchimp.client-readiness-brief-artifact.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    status,
    visibleStatus: status === "ready"
      ? "mailchimp-preview-ready"
      : status === "blocked"
        ? "mailchimp-preview-blocked"
        : "mailchimp-preview-needs-review",
    readyForClientPreview,
    readyForRuntimeStart,
    nextAction: nextSection?.nextAction || "handoff-to-runtime-adapter",
    nextSectionId: nextSection?.id || null,
    route: {
      routeId,
      method: "GET",
      path: `/mailchimp/jobs/${metadata.jobId}/client-readiness`,
      idempotencyKey: `${routeId}:${statusRevision}:${resumeToken}`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      resumeToken,
      statusRevision
    },
    validationSummary: {
      total: sectionRows.length,
      ready: sectionRows.filter((section) => section.readyForClientPreview && section.readyForRuntimeStart).length,
      blocked: blockingSections.length,
      pending: pendingSections.length,
      blockingSectionIds: blockingSections.map((section) => section.id),
      pendingSectionIds: pendingSections.map((section) => section.id)
    },
    sections: sectionRows.map((section, index) => ({
      order: index + 1,
      ...section
    })),
    clientPatch: {
      clientReadinessBriefArtifact: "client-readiness-brief.json",
      clientReadinessBriefStatus: status,
      clientReadinessBriefVisibleStatus: status === "ready"
        ? "mailchimp-preview-ready"
        : status === "blocked"
          ? "mailchimp-preview-blocked"
          : "mailchimp-preview-needs-review",
      clientReadinessBriefRouteId: routeId,
      clientReadinessBriefNextAction: nextSection?.nextAction || "handoff-to-runtime-adapter",
      clientReadinessBriefNextSectionId: nextSection?.id || null,
      clientReadinessReadyForPreview: readyForClientPreview,
      clientReadinessReadyForRuntimeStart: readyForRuntimeStart
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-client-readiness-brief-route",
      resumeToken,
      statusRevision,
      resumeFromSectionId: nextSection?.id || null,
      externalWritesPerformed: false
    }
  };
}

function buildRuntimeBoundaryExecutionTicketArtifact(metadata, diagnostics, assembled = {}) {
  const tenantBoundaryMatrix = assembled.tenantBoundaryMatrix
    || metadata.tenantBoundaryMatrix
    || metadata.dryRun?.tenantBoundaryMatrix
    || diagnostics.tenantBoundaryMatrix
    || {};
  const tenantAuditHandoff = assembled.tenantAuditHandoff
    || metadata.tenantAuditHandoff
    || diagnostics.tenantAuditHandoff
    || {};
  const runtimeReleaseControls = assembled.runtimeReleaseControls
    || metadata.runtimeReleaseControls
    || diagnostics.runtimeReleaseControls
    || {};
  const operationalHealthReport = assembled.operationalHealthReport
    || metadata.operationalHealthReport
    || diagnostics.operationalHealthReport
    || {};
  const matrixRows = Array.isArray(tenantBoundaryMatrix.rows) ? tenantBoundaryMatrix.rows : [];
  const blockedJobIds = new Set(
    normalizeArtifactList(
      tenantBoundaryMatrix.exportSummary?.blockedJobIds
        || tenantBoundaryMatrix.clientPatch?.tenantBoundaryBlockedJobs
        || tenantAuditHandoff.permissions?.blockedJobIds
        || []
    )
  );
  const approvalJobIds = new Set(
    normalizeArtifactList(
      tenantBoundaryMatrix.exportSummary?.approvalJobIds
        || tenantBoundaryMatrix.clientPatch?.tenantBoundaryApprovalJobs
        || tenantAuditHandoff.permissions?.approvalJobIds
        || []
    )
  );
  const releaseBlockedGateIds = normalizeArtifactList(
    runtimeReleaseControls.clientPatch?.runtimeReleaseBlockedGateIds
      || runtimeReleaseControls.blocking?.blockedGateIds
      || []
  );
  const releaseWaitingGateIds = normalizeArtifactList(
    runtimeReleaseControls.clientPatch?.runtimeReleaseWaitingGateIds
      || runtimeReleaseControls.blocking?.waitingGateIds
      || []
  );
  const healthBlocked = operationalHealthReport.status === "blocked"
    || (operationalHealthReport.counters?.blocking || 0) > 0;
  const releaseReady = runtimeReleaseControls.readyForRuntimeStart === true
    && releaseBlockedGateIds.length === 0
    && healthBlocked === false;
  const rows = matrixRows.map((row, index) => {
    const blocked = blockedJobIds.has(row.jobId) || row.boundaryState === "blocked";
    const waiting = blocked === false && (
      approvalJobIds.has(row.jobId)
        || row.boundaryState === "approval-required"
        || releaseWaitingGateIds.length > 0
        || releaseReady === false
    );
    const ticketState = blocked
      ? "blocked"
      : waiting
        ? "waiting"
        : "ready";
    const ticketId = `${metadata.jobId}:runtime-boundary-ticket:${row.jobId}:${row.auditRef || index + 1}`
      .replace(/[^a-zA-Z0-9_.:-]/g, "_");
    return {
      sequence: index + 1,
      ticketId,
      jobId: row.jobId,
      operation: row.operation || null,
      state: ticketState,
      permissionDecision: row.permissionDecision || "unknown",
      boundaryState: row.boundaryState || "unknown",
      safeForAdapterRelease: ticketState === "ready" && row.safeForAdapterRelease === true && releaseReady,
      tenantId: row.tenantId || tenantBoundaryMatrix.scope?.tenantId || tenantAuditHandoff.scope?.tenantId || null,
      workspaceId: row.workspaceId || tenantBoundaryMatrix.scope?.workspaceId || tenantAuditHandoff.scope?.workspaceId || null,
      actorId: row.actorId || tenantBoundaryMatrix.actor?.id || tenantAuditHandoff.actor?.id || null,
      isolationKey: tenantBoundaryMatrix.isolationKey || tenantAuditHandoff.isolationKey || null,
      auditRef: row.auditRef || null,
      checkpointKey: row.checkpointKey || null,
      replayCursor: row.replayCursor || null,
      adapterStatusResumeCursor: row.adapterStatusResumeCursor || null,
      commandIds: normalizeArtifactList(row.commandIds || []),
      missingScopes: normalizeArtifactList(row.missingScopes || []),
      blockers: [
        ...(blocked ? ["tenant-boundary"] : []),
        ...(row.tenantMatches === false ? ["tenant-mismatch"] : []),
        ...(row.workspaceMatches === false ? ["workspace-mismatch"] : []),
        ...(normalizeArtifactList(row.missingScopes || []).map((scope) => `missing-scope:${scope}`)),
        ...(releaseBlockedGateIds.map((gateId) => `release-gate:${gateId}`)),
        ...(healthBlocked ? ["operational-health"] : [])
      ],
      waiters: [
        ...(approvalJobIds.has(row.jobId) || row.boundaryState === "approval-required" ? ["tenant-approval"] : []),
        ...(releaseWaitingGateIds.map((gateId) => `release-gate:${gateId}`)),
        ...(releaseReady === false && releaseBlockedGateIds.length === 0 ? ["runtime-release-controls"] : [])
      ],
      nextAction: blocked
        ? row.nextAction || "resolve-tenant-permission-boundary"
        : waiting
          ? row.nextAction || runtimeReleaseControls.nextAction || "collect-tenant-approval"
          : "release-runtime-boundary-ticket"
    };
  });
  const blockedRows = rows.filter((row) => row.state === "blocked");
  const waitingRows = rows.filter((row) => row.state === "waiting");
  const readyRows = rows.filter((row) => row.state === "ready");
  const status = blockedRows.length > 0
    ? "blocked"
    : waitingRows.length > 0
      ? "waiting"
      : "ready";
  const ticketKey = `${metadata.jobId}:runtime-boundary:${tenantBoundaryMatrix.id || tenantAuditHandoff.id || "local"}:${status}`
    .replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const nextRow = blockedRows[0] || waitingRows[0] || readyRows[0] || null;

  return {
    schemaVersion: "aios.mailchimp.runtime-boundary-execution-ticket-artifact.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    ticketKey,
    sourceMatrixId: tenantBoundaryMatrix.id || null,
    sourceAuditHandoffId: tenantAuditHandoff.id || null,
    status,
    readyForRuntimeRelease: status === "ready"
      && releaseReady
      && tenantBoundaryMatrix.safeBoundary !== false
      && tenantBoundaryMatrix.exportReady !== false,
    readyForAuditAppend: status !== "blocked" && Boolean(tenantBoundaryMatrix.isolationKey || tenantAuditHandoff.isolationKey),
    nextAction: nextRow?.nextAction || "release-runtime-boundary-ticket",
    isolationKey: tenantBoundaryMatrix.isolationKey || tenantAuditHandoff.isolationKey || null,
    rows,
    releaseGate: {
      ready: releaseReady,
      status: runtimeReleaseControls.status || "unknown",
      releaseKey: runtimeReleaseControls.releaseKey || null,
      blockedGateIds: releaseBlockedGateIds,
      waitingGateIds: releaseWaitingGateIds
    },
    auditHandoff: {
      mode: tenantBoundaryMatrix.audit?.appendMode || tenantAuditHandoff.handoff?.auditAppendMode || "local-before-adapter-release",
      externalWritesPerformed: false,
      auditRefs: normalizeArtifactList(rows.map((row) => row.auditRef).filter(Boolean)),
      resumeCursors: normalizeArtifactList(rows.map((row) => row.adapterStatusResumeCursor).filter(Boolean))
    },
    counters: {
      rows: rows.length,
      ready: readyRows.length,
      waiting: waitingRows.length,
      blocked: blockedRows.length,
      releaseBlockedGates: releaseBlockedGateIds.length,
      releaseWaitingGates: releaseWaitingGateIds.length
    },
    clientPatch: {
      runtimeBoundaryExecutionTicketArtifact: "runtime-boundary-execution-ticket.json",
      runtimeBoundaryTicketKey: ticketKey,
      runtimeBoundaryTicketStatus: status,
      runtimeBoundaryTicketReady: status === "ready" && releaseReady,
      runtimeBoundaryTicketNextAction: nextRow?.nextAction || "release-runtime-boundary-ticket",
      runtimeBoundaryTicketBlockedJobs: blockedRows.map((row) => row.jobId),
      runtimeBoundaryTicketWaitingJobs: waitingRows.map((row) => row.jobId)
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-runtime-boundary-ticket-key",
      resumeToken: ticketKey,
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
  const restartCheckpointManifest = buildRestartCheckpointManifestArtifact(metadata, diagnostics, persistedState, statusRecoveryBundle);
  const restartReplayLedger = buildRestartReplayLedgerArtifact(metadata, diagnostics, persistedState, restartCheckpointManifest);
  const persistedStatusEnvelope = buildPersistedStatusEnvelopeArtifact(metadata, diagnostics, persistedState);
  const runtimeStatusReplayCursor = buildRuntimeStatusReplayCursorArtifact(
    metadata,
    diagnostics,
    persistedState,
    persistedStatusEnvelope,
    restartReplayLedger
  );
  const previewAcceptance = buildPreviewAcceptanceArtifact(metadata, diagnostics);
  const clientWorkflow = buildClientWorkflowArtifact(metadata, diagnostics);
  const previewHandoff = buildPreviewHandoffArtifact(metadata, diagnostics, previewAcceptance, clientWorkflow);
  const clientRuntimeAdoption = buildClientRuntimeAdoptionArtifact(metadata, diagnostics);
  const clientRuntimeSettings = buildClientRuntimeSettingsArtifact(metadata, diagnostics);
  const settingsRolloutGate = buildSettingsRolloutGateArtifact(metadata, diagnostics, clientRuntimeSettings);
  const clientStatusHandoff = buildClientStatusHandoffArtifact(metadata, diagnostics);
  const lifecycleControls = buildLifecycleControlsArtifact(metadata, diagnostics);
  const providerServiceHandoff = buildProviderServiceHandoffArtifact(metadata, diagnostics);
  const providerSyncCheckpoint = buildProviderSyncCheckpointArtifact(metadata, diagnostics, providerServiceHandoff);
  const providerReleaseReadiness = buildProviderReleaseReadinessArtifact(metadata, diagnostics, providerServiceHandoff);
  const providerIntegrationHandoff = buildProviderIntegrationHandoffArtifact(
    metadata,
    diagnostics,
    providerServiceHandoff,
    providerSyncCheckpoint,
    providerReleaseReadiness
  );
  const tenantAuditHandoff = buildTenantAuditHandoffArtifact(metadata, diagnostics);
  const permissionGrantPlan = buildPermissionGrantPlanArtifact(metadata, diagnostics, tenantAuditHandoff);
  const tenantPermissionEnforcement = buildTenantPermissionEnforcementArtifact(
    metadata,
    diagnostics,
    permissionGrantPlan,
    tenantAuditHandoff
  );
  const tenantBoundaryPosture = buildTenantBoundaryPostureArtifact(
    metadata,
    diagnostics,
    tenantPermissionEnforcement
  );
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
  const runtimeReleaseControls = buildRuntimeReleaseControlsArtifact(metadata, diagnostics, {
    runtimeReleaseDecision,
    providerReleaseReadiness,
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
    previewHandoff,
    clientCommandLeases,
    clientCommandLeaseReplay
  });
  const serviceLevelObjectiveExport = buildServiceLevelObjectiveExportArtifact(metadata, diagnostics);
  const previewExportReadiness = buildPreviewExportReadinessArtifact(metadata, diagnostics);
  const clientRemediationPacket = buildClientRemediationPacketArtifact(metadata, diagnostics);
  const operationalHealthReport = buildOperationalHealthReportArtifact(metadata, diagnostics, {
    lifecycleControls,
    providerServiceHandoff,
    providerSyncCheckpoint,
    runtimeReleaseControls,
    operationalRunbook,
    serviceLevelObjectiveExport,
    clientRemediationPacket
  });
  const operationalIncidentExport = buildOperationalIncidentExportArtifact(metadata, diagnostics, {
    operationalHealthReport
  });
  const previewAcceptancePacket = buildPreviewAcceptancePacketArtifact(
    metadata,
    diagnostics,
    previewAcceptance,
    previewHandoff,
    previewExportReadiness,
    runtimeReleaseControls
  );
  const previewReleaseTicket = buildPreviewReleaseTicketArtifact(
    metadata,
    diagnostics,
    previewAcceptancePacket,
    runtimeReleaseControls
  );
  const clientReadinessBrief = buildClientReadinessBriefArtifact(metadata, diagnostics, {
    previewAcceptance,
    previewAcceptancePacket,
    previewHandoff,
    previewExportReadiness,
    clientWorkflow,
    clientRuntimeAdoption,
    clientRuntimeSettings,
    settingsRolloutGate,
    clientStatusHandoff,
    runtimeReleaseControls,
    operationalHealthReport,
    clientRemediationPacket
  });
  const previewReadinessManifest = buildPreviewReadinessManifestArtifact(metadata, diagnostics, {
    previewAcceptance,
    previewAcceptancePacket,
    previewHandoff,
    previewExportReadiness,
    clientReadinessBrief,
    runtimeReleaseControls
  });
  const runtimeBoundaryExecutionTicket = buildRuntimeBoundaryExecutionTicketArtifact(metadata, diagnostics, {
    tenantBoundaryMatrix,
    tenantAuditHandoff,
    runtimeReleaseControls,
    operationalHealthReport
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
      restartCheckpointManifestArtifact: "restart-checkpoint-manifest.json",
      restartCheckpointStatus: restartCheckpointManifest.status,
      restartCheckpointReady: restartCheckpointManifest.readyForColdRestart,
      restartCheckpointNextAction: restartCheckpointManifest.nextAction,
      restartCheckpointResumeToken: restartCheckpointManifest.resumeToken,
      restartCheckpointMissingRequired: restartCheckpointManifest.blocking.missingRequiredCheckpoints,
      restartReplayLedgerArtifact: "restart-replay-ledger.json",
      restartReplayStatus: restartReplayLedger.status,
      restartReplayReady: restartReplayLedger.replayReady,
      restartReplayNextAction: restartReplayLedger.nextAction,
      restartReplayResumeToken: restartReplayLedger.resumeToken,
      restartReplayUnsafeRows: restartReplayLedger.counters.unsafe,
      persistedStatusEnvelopeArtifact: "persisted-status-envelope.json",
      persistedStatusEnvelopeStatus: persistedStatusEnvelope.status,
      persistedStatusEnvelopeReady: persistedStatusEnvelope.readyForRuntimeResume,
      persistedStatusEnvelopeNextAction: persistedStatusEnvelope.nextAction,
      persistedStatusEnvelopeResumeToken: persistedStatusEnvelope.resumeToken,
      persistedStatusEnvelopeBlockedCommands: persistedStatusEnvelope.blocking.commandIds,
      persistedStatusEnvelopeUnsafeCommands: persistedStatusEnvelope.blocking.unsafeCommandIds,
      runtimeStatusReplayCursorArtifact: "runtime-status-replay-cursor.json",
      runtimeStatusReplayCursorStatus: runtimeStatusReplayCursor.status,
      runtimeStatusReplayCursorReady: runtimeStatusReplayCursor.readyForRestart,
      runtimeStatusReplayCursorNextAction: runtimeStatusReplayCursor.nextAction,
      runtimeStatusReplayCursorResumeToken: runtimeStatusReplayCursor.resumeToken,
      runtimeStatusReplayCursorBlockedJobs: runtimeStatusReplayCursor.blocking.blockedJobIds,
      runtimeStatusReplayCursorWaitingJobs: runtimeStatusReplayCursor.blocking.waitingJobIds,
      runtimeStatusReplayCursorUnsafeJobs: runtimeStatusReplayCursor.blocking.unsafeJobIds,
      previewAcceptanceArtifact: "preview-acceptance.json",
      previewAcceptancePacketArtifact: "preview-acceptance-packet.json",
      previewAcceptancePacketStatus: previewAcceptancePacket.status,
      previewAcceptancePacketReady: previewAcceptancePacket.readyForAcceptance,
      previewAcceptancePacketRuntimeReady: previewAcceptancePacket.readyForRuntimeStart,
      previewAcceptancePacketNextAction: previewAcceptancePacket.nextAction,
      previewReleaseTicketArtifact: "preview-release-ticket.json",
      previewReleaseTicketStatus: previewReleaseTicket.status,
      previewReleaseTicketReady: previewReleaseTicket.readyForRuntimeRelease,
      previewReleaseTicketNextAction: previewReleaseTicket.nextAction,
      previewReleaseTicketKey: previewReleaseTicket.ticketKey,
      previewReleaseTicketBlockedRows: previewReleaseTicket.validationSummary.blockedRowIds,
      previewReleaseTicketWaitingRows: previewReleaseTicket.validationSummary.waitingRowIds,
      previewHandoffArtifact: "preview-handoff.json",
      clientWorkflowArtifact: "client-workflow.json",
      previewAcceptanceStatus: previewAcceptance.status,
    previewAcceptanceToken: previewAcceptance.acceptanceToken,
    previewAcceptanceReceiptId: previewAcceptance.acceptanceReceipt.id,
    previewAcceptanceReceiptStatus: previewAcceptance.acceptanceReceipt.status,
    previewAcceptanceReceiptToken: previewAcceptance.acceptanceReceipt.acceptanceToken,
    previewAcceptanceReceiptNextAction: previewAcceptance.acceptanceReceipt.nextAction,
    previewAcceptanceReadyForRuntimeStart: previewAcceptance.acceptanceReceipt.readyForRuntimeStart,
    previewHandoffStatus: previewHandoff.status,
    previewHandoffReadyForAcceptance: previewHandoff.readyForAcceptance,
    previewHandoffReadyForRuntimeStart: previewHandoff.readyForRuntimeStart,
    previewHandoffRouteId: previewHandoff.routeId,
    previewHandoffNextAction: previewHandoff.nextAction,
    previewHandoffAcceptanceToken: previewHandoff.acceptance.token,
    previewHandoffBlockedGateIds: previewHandoff.acceptance.blockedGateIds,
    previewHandoffPendingGateIds: previewHandoff.acceptance.pendingGateIds,
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
    lifecycleRunControlArtifact: "lifecycle-run-control.json",
    lifecycleRunControlReady: lifecycleRunControl.ready,
    lifecycleRunControlStatus: lifecycleRunControl.status,
    lifecycleRunControlNextAction: lifecycleRunControl.nextAction,
    lifecycleRunControlKey: lifecycleRunControl.controlKey,
    lifecycleRunControlFreezeActive: lifecycleRunControl.freezeWindow.active,
    lifecycleRunControlConcurrencyExceeded: lifecycleRunControl.concurrency.exceeded === true,
    providerServiceArtifact: "provider-service-handoff.json",
    providerServiceStatus: providerServiceHandoff.status,
    providerServiceReady: providerServiceHandoff.externalHandoff.ready,
      providerIntegrationHandoffArtifact: "provider-integration-handoff.json",
      providerIntegrationHandoffStatus: providerIntegrationHandoff.status,
      providerIntegrationHandoffReady: providerIntegrationHandoff.readyForRuntime,
      providerIntegrationHandoffNextAction: providerIntegrationHandoff.nextAction,
      providerIntegrationHandoffNextGateId: providerIntegrationHandoff.nextGateId,
      providerIntegrationBlockedGateIds: providerIntegrationHandoff.validationSummary.blockedGateIds,
      providerIntegrationWaitingGateIds: providerIntegrationHandoff.validationSummary.waitingGateIds,
      providerIntegrationExecutionTicketArtifact: "provider-integration-execution-ticket.json",
      providerIntegrationExecutionTicketStatus: providerIntegrationExecutionTicket.status,
      providerIntegrationExecutionTicketReady: providerIntegrationExecutionTicket.readyForRuntimeRelease,
      providerIntegrationExecutionTicketNextAction: providerIntegrationExecutionTicket.nextAction,
      providerIntegrationExecutionTicketResumeCursor: providerIntegrationExecutionTicket.resumeCursor,
      providerIntegrationExecutionTicketBlockedGates: providerIntegrationExecutionTicket.validationSummary.blockedGateIds,
      providerIntegrationExecutionTicketWaitingGates: providerIntegrationExecutionTicket.validationSummary.waitingGateIds,
      providerSyncCheckpointArtifact: "provider-sync-checkpoint.json",
      providerSyncCheckpointStatus: providerSyncCheckpoint.status,
      providerSyncCheckpointReady: providerSyncCheckpoint.ready,
      providerSyncCheckpointNextAction: providerSyncCheckpoint.nextAction,
      providerSyncCheckpointMissingAckMounts: providerSyncCheckpoint.missingAckMounts,
      providerSyncCheckpointMissingWatermarkMounts: providerSyncCheckpoint.missingWatermarkMounts,
      providerExportReadinessArtifact: "provider-export-readiness.json",
      providerExportReadinessStatus: providerExportReadiness.status,
      providerExportReady: providerExportReadiness.exportReady,
      providerExportNextAction: providerExportReadiness.nextAction,
      providerExportResumeToken: providerExportReadiness.resumeToken,
      providerExportBlockedRows: providerExportReadiness.validationSummary.blockedRowIds,
      providerExportWaitingRows: providerExportReadiness.validationSummary.waitingRowIds,
      providerCallbackHandoffArtifact: "provider-callback-handoff.json",
      providerCallbackStatus: providerCallbackHandoff.status,
      providerCallbackReady: providerCallbackHandoff.ready,
      providerCallbackNextAction: providerCallbackHandoff.nextAction,
      providerCallbackResumeToken: providerCallbackHandoff.resumeToken,
      providerCallbackMissingEvents: providerCallbackHandoff.events.missing,
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
      runtimeReleaseControlsArtifact: "runtime-release-controls.json",
      runtimeReleaseControlsStatus: runtimeReleaseControls.status,
      runtimeReleaseControlsReady: runtimeReleaseControls.readyForRuntimeStart,
      runtimeReleaseControlsNextAction: runtimeReleaseControls.nextAction,
      runtimeReleaseControlsNextGateId: runtimeReleaseControls.nextGateId,
      runtimeReleaseControlsReleaseKey: runtimeReleaseControls.releaseKey,
      runtimeReleaseControlsBlockedGateIds: runtimeReleaseControls.clientPatch.runtimeReleaseBlockedGateIds,
      runtimeReleaseControlsWaitingGateIds: runtimeReleaseControls.clientPatch.runtimeReleaseWaitingGateIds,
      providerSyncHandoffReady: providerServiceHandoff.syncMetadata.syncHandoffReady,
      unnegotiatedProviderCapabilities: providerServiceHandoff.capabilityNegotiation.unnegotiated,
      clientWorkflowStatus: clientWorkflow.status,
      clientWorkflowAction: clientWorkflow.explainNextStep.action,
      clientRuntimeAdoptionArtifact: "client-runtime-adoption.json",
      clientRuntimeAdoptionStatus: clientRuntimeAdoption.status,
      clientRuntimeReady: clientRuntimeAdoption.readyForClientRuntime,
      clientRuntimeAdoptionNextAction: clientRuntimeAdoption.nextAction,
      clientRuntimeAdoptionId: clientRuntimeAdoption.adoptionId,
      clientRuntimeSettingsArtifact: "client-runtime-settings.json",
      clientRuntimeSettingsStatus: clientRuntimeSettings.status,
      clientRuntimeSettingsReady: clientRuntimeSettings.readyForClientRuntime,
      clientRuntimeSettingsRevision: clientRuntimeSettings.settingsRevision,
      clientRuntimeSettingsNextAction: clientRuntimeSettings.nextAction,
      settingsRolloutGateArtifact: "settings-rollout-gate.json",
      settingsRolloutGateStatus: settingsRolloutGate.status,
      settingsRolloutGateReady: settingsRolloutGate.readyForRuntimeStart,
      settingsRolloutGateNextAction: settingsRolloutGate.nextAction,
      settingsRolloutGateNextGateId: settingsRolloutGate.nextGateId,
      settingsRolloutBlockedGateIds: settingsRolloutGate.clientPatch.mailchimpSettingsRolloutBlockedGateIds,
      clientStatusHandoffArtifact: "client-status-handoff.json",
      clientStatusHandoffStatus: clientStatusHandoff.status,
      clientStatusHandoffVisibleStatus: clientStatusHandoff.visibleStatus,
      clientStatusHandoffReadyForClient: clientStatusHandoff.readyForClient,
      clientStatusHandoffReadyForRuntime: clientStatusHandoff.readyForRuntime,
      clientStatusHandoffRouteId: clientStatusHandoff.route.routeId,
      clientStatusHandoffNextAction: clientStatusHandoff.nextAction,
      clientStatusHandoffPendingAckKeys: clientStatusHandoff.commandAck.pendingKeys,
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
      clientCommandLeaseReplayHandoffArtifact: "client-command-lease-replay-handoff.json",
      clientCommandLeaseReplayHandoffStatus: clientCommandLeaseReplayHandoff.status,
      clientCommandLeaseReplayHandoffReady: clientCommandLeaseReplayHandoff.readyForRuntime,
      clientCommandLeaseReplayHandoffRouteId: clientCommandLeaseReplayHandoff.routeId,
      clientCommandLeaseReplayHandoffNextAction: clientCommandLeaseReplayHandoff.nextAction,
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
      serviceLevelObjectiveArtifact: "service-level-objectives.json",
      serviceLevelObjectiveExportReady: serviceLevelObjectiveExport.exportReady,
      serviceLevelObjectiveStatus: serviceLevelObjectiveExport.status,
      serviceLevelObjectiveHealth: serviceLevelObjectiveExport.healthLevel,
      serviceLevelObjectiveNextAction: serviceLevelObjectiveExport.nextAction,
      serviceLevelObjectiveBreaches: serviceLevelObjectiveExport.counters.breached,
      serviceLevelObjectiveBlocking: serviceLevelObjectiveExport.counters.blocking,
      operationalHealthReportArtifact: "operational-health-report.json",
      operationalHealthReportReady: operationalHealthReport.exportReady,
      operationalHealthReportStatus: operationalHealthReport.status,
      operationalHealthReportLevel: operationalHealthReport.healthLevel,
      operationalHealthReportNextAction: operationalHealthReport.nextAction,
      operationalHealthReportResumeToken: operationalHealthReport.resumeToken,
      operationalHealthReportBlockingRows: operationalHealthReport.counters.blocking,
      operationalHealthReportRetryableRows: operationalHealthReport.counters.retryable,
      operationalIncidentExportArtifact: "operational-incident-export.json",
      operationalIncidentExportReady: operationalIncidentExport.exportReady,
      operationalIncidentExportStatus: operationalIncidentExport.status,
      operationalIncidentExportNextAction: operationalIncidentExport.nextAction,
      operationalIncidentExportResumeToken: operationalIncidentExport.resumeToken,
      operationalIncidentExportBlockingRows: operationalIncidentExport.exportSummary.blockingRowIds,
      operationalIncidentExportRetryableRows: operationalIncidentExport.exportSummary.retryableRowIds,
      clientReadinessBriefArtifact: "client-readiness-brief.json",
      clientReadinessBriefStatus: clientReadinessBrief.status,
      clientReadinessBriefVisibleStatus: clientReadinessBrief.visibleStatus,
      clientReadinessBriefReadyForPreview: clientReadinessBrief.readyForClientPreview,
      clientReadinessBriefReadyForRuntimeStart: clientReadinessBrief.readyForRuntimeStart,
      clientReadinessBriefNextAction: clientReadinessBrief.nextAction,
      clientReadinessBriefRouteId: clientReadinessBrief.route.routeId,
      clientReadinessBriefBlockingSections: clientReadinessBrief.validationSummary.blockingSectionIds,
      clientReadinessBriefPendingSections: clientReadinessBrief.validationSummary.pendingSectionIds,
      tenantAuditHandoffArtifact: "tenant-audit-handoff.json",
      tenantAuditHandoffStatus: tenantAuditHandoff.status,
      tenantAuditHandoffReady: tenantAuditHandoff.safeBoundary === true && tenantAuditHandoff.status === "ready",
      tenantAuditIsolationKey: tenantAuditHandoff.isolationKey,
      tenantAuditNextAction: tenantAuditHandoff.handoff.nextAction,
      permissionGrantPlanArtifact: "permission-grant-plan.json",
      permissionGrantPlanStatus: permissionGrantPlan.status,
      permissionGrantPlanReady: permissionGrantPlan.readyForAudit,
      permissionGrantPlanNextAction: permissionGrantPlan.nextAction,
      permissionGrantPlanBlockingCount: permissionGrantPlan.summary.blocking,
      tenantPermissionEnforcementArtifact: "tenant-permission-enforcement.json",
      tenantPermissionEnforcementStatus: tenantPermissionEnforcement.status,
      tenantPermissionEnforcementReady: tenantPermissionEnforcement.audit.ready,
      tenantPermissionEnforcementKey: tenantPermissionEnforcement.enforcementKey,
      tenantPermissionEnforcementNextAction: tenantPermissionEnforcement.nextAction,
      tenantPermissionBlockedDecisions: tenantPermissionEnforcement.counters.blocked,
      tenantBoundaryPostureArtifact: "tenant-boundary-posture.json",
      tenantBoundaryPostureStatus: tenantBoundaryPosture.status,
      tenantBoundaryPostureReady: tenantBoundaryPosture.safeForRuntime,
      tenantBoundaryPostureKey: tenantBoundaryPosture.postureKey,
      tenantBoundaryPostureNextAction: tenantBoundaryPosture.nextAction,
      tenantBoundaryPostureDriftFlags: tenantBoundaryPosture.counters.driftFlags,
      tenantBoundaryMatrixArtifact: "tenant-boundary-matrix.json",
      tenantBoundaryMatrixStatus: tenantBoundaryMatrix.status,
      tenantBoundaryMatrixReady: tenantBoundaryMatrix.exportReady,
      tenantBoundaryMatrixNextAction: tenantBoundaryMatrix.audit.nextAction,
      tenantBoundaryMatrixHistorySnapshotIds: tenantBoundaryMatrix.analytics.historySnapshotIds,
      tenantBoundaryMatrixBlockedJobs: tenantBoundaryMatrix.exportSummary.blockedJobIds,
      tenantBoundaryMatrixApprovalJobs: tenantBoundaryMatrix.exportSummary.approvalJobIds,
      runtimeBoundaryExecutionTicketArtifact: "runtime-boundary-execution-ticket.json",
      runtimeBoundaryExecutionTicketStatus: runtimeBoundaryExecutionTicket.status,
      runtimeBoundaryExecutionTicketReady: runtimeBoundaryExecutionTicket.readyForRuntimeRelease,
      runtimeBoundaryExecutionTicketNextAction: runtimeBoundaryExecutionTicket.nextAction,
      runtimeBoundaryExecutionTicketKey: runtimeBoundaryExecutionTicket.ticketKey,
      runtimeBoundaryExecutionTicketBlockedJobs: runtimeBoundaryExecutionTicket.clientPatch.runtimeBoundaryTicketBlockedJobs,
      runtimeBoundaryExecutionTicketWaitingJobs: runtimeBoundaryExecutionTicket.clientPatch.runtimeBoundaryTicketWaitingJobs,
      dryRunAnalyticsExportArtifact: "dry-run-analytics-export.json",
      dryRunAnalyticsExportReady: dryRunAnalyticsExport.exportReady,
      dryRunAnalyticsExportStatus: dryRunAnalyticsExport.status,
      dryRunAnalyticsExportNextAction: dryRunAnalyticsExport.nextAction,
      dryRunAnalyticsExportHistorySnapshotIds: dryRunAnalyticsExport.exportSummary.historySnapshotIds,
      dryRunAnalyticsExportTimelineEventIds: dryRunAnalyticsExport.exportSummary.timelineEventIds,
      dryRunReportingStateId: dryRunAnalyticsExport.reportingState.id,
      dryRunReportingStateStatus: dryRunAnalyticsExport.reportingState.status,
      dryRunReportingStateReady: dryRunAnalyticsExport.reportingState.exportReady,
      dryRunReportingStateNextAction: dryRunAnalyticsExport.reportingState.nextAction,
      dryRunReportingCursor: dryRunAnalyticsExport.reportingState.reportingCursor,
      dryRunReportingBlockedRows: dryRunAnalyticsExport.reportingState.counters.blockedRows,
      dryRunReportingWaitingRows: dryRunAnalyticsExport.reportingState.counters.waitingRows,
      diagnosticExportLedgerArtifact: "diagnostic-export-ledger.json",
      diagnosticExportLedgerReady: diagnosticExportLedger.exportReady,
      diagnosticExportLedgerStatus: diagnosticExportLedger.status,
      diagnosticExportLedgerNextAction: diagnosticExportLedger.nextAction,
      diagnosticExportLedgerResumeToken: diagnosticExportLedger.resumeToken,
      diagnosticExportLedgerRows: diagnosticExportLedger.rows.length,
      previewExportReadinessArtifact: "preview-export-readiness.json",
      previewExportReadinessReady: previewExportReadiness.exportReady,
      previewExportReadinessStatus: previewExportReadiness.status,
      previewExportReadinessNextAction: previewExportReadiness.nextAction,
      previewExportReadinessResumeToken: previewExportReadiness.resumeToken,
      previewExportReadinessBlockedRows: previewExportReadiness.exportSummary.blockedRowIds,
      previewReadinessManifestArtifact: "preview-readiness-manifest.json",
      previewReadinessManifestStatus: previewReadinessManifest.status,
      previewReadinessManifestReadyForPreview: previewReadinessManifest.readyForClientPreview,
      previewReadinessManifestReadyForRuntimeStart: previewReadinessManifest.readyForRuntimeStart,
      previewReadinessManifestNextAction: previewReadinessManifest.nextAction,
      previewReadinessManifestRouteId: previewReadinessManifest.route.routeId,
      validationSummary: previewAcceptance.validationSummary,
      previewHandoff: {
        artifact: "preview-handoff.json",
        status: previewHandoff.status,
        routeId: previewHandoff.routeId,
        nextAction: previewHandoff.nextAction,
        readyForAcceptance: previewHandoff.readyForAcceptance,
        readyForRuntimeStart: previewHandoff.readyForRuntimeStart,
        blockedGateIds: previewHandoff.acceptance.blockedGateIds,
        pendingGateIds: previewHandoff.acceptance.pendingGateIds
      },
      acceptanceReceipt: {
        id: previewAcceptance.acceptanceReceipt.id,
        status: previewAcceptance.acceptanceReceipt.status,
        token: previewAcceptance.acceptanceReceipt.acceptanceToken,
        nextAction: previewAcceptance.acceptanceReceipt.nextAction,
        readyForRuntimeStart: previewAcceptance.acceptanceReceipt.readyForRuntimeStart
      },
    nextAction: tenantAuditHandoff.safeBoundary === false
      ? tenantAuditHandoff.handoff.nextAction
      : tenantPermissionEnforcement.audit.ready === false
      ? tenantPermissionEnforcement.nextAction
      : tenantBoundaryMatrix.exportReady === false
      ? tenantBoundaryMatrix.audit.nextAction
      : commandLeaseReplayExport.exportReady === false
      ? commandLeaseReplayExport.nextAction
      : dryRunAnalyticsExport.exportReady === false
      ? dryRunAnalyticsExport.nextAction
      : diagnosticExportLedger.exportReady === false
      ? diagnosticExportLedger.nextAction
      : operationalHealthReport.status === "blocked"
      ? operationalHealthReport.nextAction
      : lifecycleOperatorControls.status === "blocked"
      ? lifecycleOperatorControls.nextAction
      : runtimeReleaseDecision.ready === false
      ? runtimeReleaseDecision.nextAction
      : runtimeReleaseControls.readyForRuntimeStart === false
      ? runtimeReleaseControls.nextAction
      : providerReleaseReadiness.ready === false
      ? providerReleaseReadiness.nextAction
      : providerSyncCheckpoint.ready === false
      ? providerSyncCheckpoint.nextAction
      : providerServiceHandoff.externalHandoff.ready === false
      ? providerServiceHandoff.clientPatch.nextAction
      : clientRuntimeSettings.readyForClientRuntime === false
      ? clientRuntimeSettings.nextAction
      : settingsRolloutGate.readyForRuntimeStart === false
      ? settingsRolloutGate.nextAction
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
    artifactRecord(job.id, "provider-sync-checkpoint.json", "application/vnd.aios.mailchimp.provider-sync-checkpoint+json", providerSyncCheckpoint, {
      role: "provider-sync-checkpoint",
      target: "runtime-state-store",
      required: true,
      recoveryAction: providerSyncCheckpoint.nextAction || "refresh-provider-sync-checkpoint"
    }),
    artifactRecord(job.id, "provider-export-readiness.json", "application/vnd.aios.mailchimp.provider-export-readiness+json", providerExportReadiness, {
      role: "provider-export-readiness",
      target: "client-runtime",
      required: true,
      recoveryAction: providerExportReadiness.nextAction || "refresh-provider-export-status"
    }),
    artifactRecord(job.id, "provider-callback-handoff.json", "application/vnd.aios.mailchimp.provider-callback-handoff+json", providerCallbackHandoff, {
      role: "provider-callback-handoff",
      target: "runtime-state-store",
      required: true,
      recoveryAction: providerCallbackHandoff.nextAction || "repair-mailchimp-callback-handoff"
    }),
    artifactRecord(job.id, "provider-release-readiness.json", "application/vnd.aios.mailchimp.provider-release-readiness+json", providerReleaseReadiness, {
      role: "provider-release-readiness",
      target: "client-runtime",
      required: true,
      recoveryAction: providerReleaseReadiness.nextAction || "repair-provider-release-readiness"
    }),
    artifactRecord(job.id, "provider-integration-handoff.json", "application/vnd.aios.mailchimp.provider-integration-handoff+json", providerIntegrationHandoff, {
      role: "provider-integration-handoff",
      target: "client-runtime",
      required: true,
      recoveryAction: providerIntegrationHandoff.nextAction || "repair-provider-integration-handoff"
    }),
    artifactRecord(job.id, "provider-integration-execution-ticket.json", "application/vnd.aios.mailchimp.provider-integration-execution-ticket+json", providerIntegrationExecutionTicket, {
      role: "provider-integration-execution-ticket",
      target: "client-runtime",
      required: true,
      recoveryAction: providerIntegrationExecutionTicket.nextAction || "repair-provider-integration-execution-ticket"
    }),
    artifactRecord(job.id, "runtime-release-decision.json", "application/vnd.aios.mailchimp.runtime-release-decision+json", runtimeReleaseDecision, {
      role: "client-runtime-release-decision",
      target: "client-runtime",
      required: true,
      recoveryAction: runtimeReleaseDecision.nextAction || "review-runtime-release-decision"
    }),
    artifactRecord(job.id, "runtime-release-controls.json", "application/vnd.aios.mailchimp.runtime-release-controls+json", runtimeReleaseControls, {
      role: "client-runtime-release-controls",
      target: "client-runtime",
      required: true,
      recoveryAction: runtimeReleaseControls.nextAction || "review-runtime-release-controls"
    }),
    artifactRecord(job.id, "tenant-audit-handoff.json", "application/vnd.aios.mailchimp.tenant-audit-handoff+json", tenantAuditHandoff, {
      role: "tenant-audit-handoff",
      target: "runtime-audit-log",
      required: true,
      recoveryAction: tenantAuditHandoff.handoff.nextAction || "repair-tenant-audit-handoff"
    }),
    artifactRecord(job.id, "permission-grant-plan.json", "application/vnd.aios.mailchimp.permission-grant-plan+json", permissionGrantPlan, {
      role: "tenant-permission-grant-plan",
      target: "operator-console",
      required: true,
      recoveryAction: permissionGrantPlan.nextAction || "repair-permission-grant-plan"
    }),
    artifactRecord(job.id, "tenant-permission-enforcement.json", "application/vnd.aios.mailchimp.tenant-permission-enforcement+json", tenantPermissionEnforcement, {
      role: "tenant-permission-enforcement",
      target: "runtime-audit-log",
      required: true,
      recoveryAction: tenantPermissionEnforcement.nextAction || "repair-tenant-permission-enforcement"
    }),
    artifactRecord(job.id, "tenant-boundary-posture.json", "application/vnd.aios.mailchimp.tenant-boundary-posture+json", tenantBoundaryPosture, {
      role: "tenant-boundary-runtime-posture",
      target: "client-runtime",
      required: true,
      recoveryAction: tenantBoundaryPosture.nextAction || "repair-tenant-boundary-posture"
    }),
    artifactRecord(job.id, "tenant-boundary-matrix.json", "application/vnd.aios.mailchimp.tenant-boundary-matrix+json", tenantBoundaryMatrix, {
      role: "tenant-boundary-export-matrix",
      target: "client-preview",
      required: true,
      recoveryAction: tenantBoundaryMatrix.audit.nextAction || "repair-tenant-boundary-matrix"
    }),
    artifactRecord(job.id, "runtime-boundary-execution-ticket.json", "application/vnd.aios.mailchimp.runtime-boundary-execution-ticket+json", runtimeBoundaryExecutionTicket, {
      role: "runtime-boundary-execution-ticket",
      target: job.runtimeAdapter?.id || "mailchimp.campaignRuntimeAdapter",
      required: true,
      recoveryAction: runtimeBoundaryExecutionTicket.nextAction || "repair-runtime-boundary-execution-ticket"
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
    artifactRecord(job.id, "persisted-status-envelope.json", "application/vnd.aios.mailchimp.persisted-status-envelope+json", persistedStatusEnvelope, {
      role: "restart-status-envelope",
      target: "runtime-state-store",
      required: true,
      recoveryAction: persistedStatusEnvelope.nextAction || "refresh-persisted-status-envelope"
    }),
    artifactRecord(job.id, "runtime-status-replay-cursor.json", "application/vnd.aios.mailchimp.runtime-status-replay-cursor+json", runtimeStatusReplayCursor, {
      role: "runtime-status-replay-cursor",
      target: "runtime-state-store",
      required: true,
      recoveryAction: runtimeStatusReplayCursor.nextAction || "refresh-runtime-status-replay-cursor"
    }),
    artifactRecord(job.id, "status-recovery-bundle.json", "application/vnd.aios.mailchimp.status-recovery-bundle+json", statusRecoveryBundle, {
      role: "runtime-status-recovery-bundle",
      target: job.runtimeAdapter?.id || "mailchimp.campaignRuntimeAdapter",
      required: true,
      recoveryAction: statusRecoveryBundle.nextAction || "repair-status-recovery"
    }),
    artifactRecord(job.id, "restart-checkpoint-manifest.json", "application/vnd.aios.mailchimp.restart-checkpoint-manifest+json", restartCheckpointManifest, {
      role: "runtime-restart-checkpoint-manifest",
      target: "runtime-state-store",
      required: true,
      recoveryAction: restartCheckpointManifest.nextAction || "repair-restart-checkpoints"
    }),
    artifactRecord(job.id, "restart-replay-ledger.json", "application/vnd.aios.mailchimp.restart-replay-ledger+json", restartReplayLedger, {
      role: "runtime-restart-replay-ledger",
      target: "runtime-state-store",
      required: true,
      recoveryAction: restartReplayLedger.nextAction || "repair-restart-replay-ledger"
    }),
    artifactRecord(job.id, "preview-acceptance.json", "application/vnd.aios.mailchimp.preview-acceptance+json", previewAcceptance, {
      role: "client-preview-acceptance",
      target: "client-preview",
      required: true,
      recoveryAction: previewAcceptance.explainNextStep.action
    }),
    artifactRecord(job.id, "preview-acceptance-packet.json", "application/vnd.aios.mailchimp.preview-acceptance-packet+json", previewAcceptancePacket, {
      role: "client-preview-acceptance-packet",
      target: "client-preview",
      required: true,
      recoveryAction: previewAcceptancePacket.nextAction || "refresh-preview-acceptance-packet"
    }),
    artifactRecord(job.id, "preview-release-ticket.json", "application/vnd.aios.mailchimp.preview-release-ticket+json", previewReleaseTicket, {
      role: "client-preview-release-ticket",
      target: "client-runtime",
      required: true,
      recoveryAction: previewReleaseTicket.nextAction || "refresh-preview-release-ticket"
    }),
    artifactRecord(job.id, "preview-handoff.json", "application/vnd.aios.mailchimp.preview-handoff+json", previewHandoff, {
      role: "client-preview-route-handoff",
      target: "client-preview",
      required: true,
      recoveryAction: previewHandoff.nextAction || "refresh-preview-handoff"
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
    artifactRecord(job.id, "client-runtime-settings.json", "application/vnd.aios.mailchimp.client-runtime-settings+json", clientRuntimeSettings, {
      role: "client-runtime-settings",
      target: "client-runtime",
      required: true,
      recoveryAction: clientRuntimeSettings.nextAction || "refresh-client-runtime-settings"
    }),
    artifactRecord(job.id, "settings-rollout-gate.json", "application/vnd.aios.mailchimp.settings-rollout-gate+json", settingsRolloutGate, {
      role: "client-runtime-settings-rollout-gate",
      target: "client-runtime",
      required: true,
      recoveryAction: settingsRolloutGate.nextAction || "refresh-settings-rollout-gate"
    }),
    artifactRecord(job.id, "client-status-handoff.json", "application/vnd.aios.mailchimp.client-status-handoff+json", clientStatusHandoff, {
      role: "client-runtime-status-handoff",
      target: "client-runtime",
      required: true,
      recoveryAction: clientStatusHandoff.nextAction || "refresh-mailchimp-client-status"
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
    artifactRecord(job.id, "client-command-lease-replay-handoff.json", "application/vnd.aios.mailchimp.client-command-lease-replay-handoff+json", clientCommandLeaseReplayHandoff, {
      role: "client-runtime-command-lease-replay-handoff",
      target: "client-runtime",
      required: true,
      recoveryAction: clientCommandLeaseReplayHandoff.nextAction || "refresh-command-lease-replay-handoff"
    }),
    artifactRecord(job.id, "operational-runbook.json", "application/vnd.aios.mailchimp.operational-runbook+json", operationalRunbook, {
      role: "operator-health-runbook",
      target: "operator-console",
      required: true,
      recoveryAction: operationalRunbook.nextAction || "refresh-operational-runbook"
    }),
    artifactRecord(job.id, "client-remediation-packet.json", "application/vnd.aios.mailchimp.client-remediation-packet+json", clientRemediationPacket, {
      role: "client-runtime-remediation-packet",
      target: "client-runtime",
      required: true,
      recoveryAction: clientRemediationPacket.nextAction || "refresh-client-remediation-packet"
    }),
    artifactRecord(job.id, "service-level-objectives.json", "application/vnd.aios.mailchimp.service-level-objectives+json", serviceLevelObjectiveExport, {
      role: "service-level-objective-export",
      target: "operator-console",
      required: true,
      recoveryAction: serviceLevelObjectiveExport.nextAction || "refresh-service-level-objectives"
    }),
    artifactRecord(job.id, "operational-health-report.json", "application/vnd.aios.mailchimp.operational-health-report+json", operationalHealthReport, {
      role: "operational-health-export",
      target: "operator-console",
      required: true,
      recoveryAction: operationalHealthReport.nextAction || "refresh-operational-health-report"
    }),
    artifactRecord(job.id, "operational-incident-export.json", "application/vnd.aios.mailchimp.operational-incident-export+json", operationalIncidentExport, {
      role: "operational-incident-export",
      target: "operator-console",
      required: true,
      recoveryAction: operationalIncidentExport.nextAction || "refresh-operational-incident-export"
    }),
    artifactRecord(job.id, "client-readiness-brief.json", "application/vnd.aios.mailchimp.client-readiness-brief+json", clientReadinessBrief, {
      role: "client-readiness-brief",
      target: "client-preview",
      required: true,
      recoveryAction: clientReadinessBrief.nextAction || "refresh-client-readiness-brief"
    }),
    artifactRecord(job.id, "dry-run-analytics-export.json", "application/vnd.aios.mailchimp.dry-run-analytics-export+json", dryRunAnalyticsExport, {
      role: "dry-run-analytics-export",
      target: "operator-console",
      required: true,
      recoveryAction: dryRunAnalyticsExport.nextAction || "refresh-dry-run-analytics-export"
    }),
    artifactRecord(job.id, "diagnostic-export-ledger.json", "application/vnd.aios.mailchimp.diagnostic-export-ledger+json", diagnosticExportLedger, {
      role: "diagnostic-export-ledger",
      target: "operator-console",
      required: true,
      recoveryAction: diagnosticExportLedger.nextAction || "refresh-diagnostic-export-ledger"
    }),
    artifactRecord(job.id, "preview-export-readiness.json", "application/vnd.aios.mailchimp.preview-export-readiness+json", previewExportReadiness, {
      role: "client-preview-export-readiness",
      target: "client-preview",
      required: true,
      recoveryAction: previewExportReadiness.nextAction || "refresh-preview-export-readiness"
    }),
    artifactRecord(job.id, "preview-readiness-manifest.json", "application/vnd.aios.mailchimp.preview-readiness-manifest+json", previewReadinessManifest, {
      role: "client-preview-readiness-manifest",
      target: "client-preview",
      required: true,
      recoveryAction: previewReadinessManifest.nextAction || "refresh-preview-readiness-manifest"
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
    artifactRecord(job.id, "lifecycle-run-control.json", "application/vnd.aios.mailchimp.lifecycle-run-control+json", lifecycleRunControl, {
      role: "client-lifecycle-run-control",
      target: "client-preview",
      required: true,
      recoveryAction: lifecycleRunControl.nextAction || "refresh-lifecycle-run-control"
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
      persistedStatusEnvelopeArtifact: "persisted-status-envelope.json",
      persistedStatusEnvelopeStatus: persistedStatusEnvelope.status,
      persistedStatusEnvelopeReady: persistedStatusEnvelope.readyForRuntimeResume,
      persistedStatusEnvelopeNextAction: persistedStatusEnvelope.nextAction,
      persistedStatusEnvelopeResumeToken: persistedStatusEnvelope.resumeToken,
      persistedStatusEnvelopeRevision: persistedStatusEnvelope.statusRevision,
      runtimeStatusReplayCursorArtifact: "runtime-status-replay-cursor.json",
      runtimeStatusReplayCursorStatus: runtimeStatusReplayCursor.status,
      runtimeStatusReplayCursorReady: runtimeStatusReplayCursor.readyForRestart,
      runtimeStatusReplayCursorNextAction: runtimeStatusReplayCursor.nextAction,
      runtimeStatusReplayCursorResumeToken: runtimeStatusReplayCursor.resumeToken,
      runtimeStatusReplayCursorRevision: runtimeStatusReplayCursor.statusRevision,
      failureStateArtifact: "failure-state.json",
      permissionBoundaryArtifact: "permission-boundary.json",
      tenantIsolationKey: diagnostics.permissionBoundary?.isolationKey || null,
      permissionGrantPlanArtifact: "permission-grant-plan.json",
      permissionGrantPlanReady: permissionGrantPlan.readyForAudit,
      permissionGrantPlanStatus: permissionGrantPlan.status,
      permissionGrantPlanNextAction: permissionGrantPlan.nextAction,
      tenantPermissionEnforcementArtifact: "tenant-permission-enforcement.json",
      tenantPermissionEnforcementReady: tenantPermissionEnforcement.audit.ready,
      tenantPermissionEnforcementStatus: tenantPermissionEnforcement.status,
      tenantPermissionEnforcementKey: tenantPermissionEnforcement.enforcementKey,
      tenantPermissionEnforcementNextAction: tenantPermissionEnforcement.nextAction,
      tenantAuditHandoffArtifact: "tenant-audit-handoff.json",
      tenantAuditHandoffReady: tenantAuditHandoff.safeBoundary === true && tenantAuditHandoff.status === "ready",
      tenantAuditIsolationKey: tenantAuditHandoff.isolationKey,
      tenantAuditNextAction: tenantAuditHandoff.handoff.nextAction,
      tenantBoundaryMatrixArtifact: "tenant-boundary-matrix.json",
      tenantBoundaryMatrixReady: tenantBoundaryMatrix.exportReady,
      tenantBoundaryMatrixStatus: tenantBoundaryMatrix.status,
      tenantBoundaryMatrixNextAction: tenantBoundaryMatrix.audit.nextAction,
      tenantBoundaryMatrixHistorySnapshotIds: tenantBoundaryMatrix.analytics.historySnapshotIds,
      runtimeBoundaryExecutionTicketArtifact: "runtime-boundary-execution-ticket.json",
      runtimeBoundaryExecutionTicketReady: runtimeBoundaryExecutionTicket.readyForRuntimeRelease,
      runtimeBoundaryExecutionTicketStatus: runtimeBoundaryExecutionTicket.status,
      runtimeBoundaryExecutionTicketKey: runtimeBoundaryExecutionTicket.ticketKey,
      runtimeBoundaryExecutionTicketNextAction: runtimeBoundaryExecutionTicket.nextAction,
      providerServiceHandoffArtifact: "provider-service-handoff.json",
      providerServiceHandoffReady: providerServiceHandoff.externalHandoff.ready,
      providerServiceHandoffKey: providerServiceHandoff.externalHandoff.idempotencyKey,
      providerSyncCheckpointArtifact: "provider-sync-checkpoint.json",
      providerSyncCheckpointReady: providerSyncCheckpoint.ready,
      providerSyncCheckpointStatus: providerSyncCheckpoint.status,
      providerSyncCheckpointNextAction: providerSyncCheckpoint.nextAction,
      providerSyncCheckpointResumeToken: providerSyncCheckpoint.resumeToken,
      providerSyncCheckpointMissingAckMounts: providerSyncCheckpoint.missingAckMounts,
      providerSyncCheckpointMissingWatermarkMounts: providerSyncCheckpoint.missingWatermarkMounts,
      providerReleaseReadinessArtifact: "provider-release-readiness.json",
      providerReleaseReadinessReady: providerReleaseReadiness.ready,
      providerReleaseReadinessStatus: providerReleaseReadiness.status,
      providerReleaseReadinessNextAction: providerReleaseReadiness.nextAction,
      providerReleaseReadinessMissingCapabilities: providerReleaseReadiness.capabilityNegotiation.missing,
      providerIntegrationHandoffArtifact: "provider-integration-handoff.json",
      providerIntegrationHandoffReady: providerIntegrationHandoff.readyForRuntime,
      providerIntegrationHandoffStatus: providerIntegrationHandoff.status,
      providerIntegrationHandoffNextAction: providerIntegrationHandoff.nextAction,
      providerIntegrationHandoffNextGateId: providerIntegrationHandoff.nextGateId,
      providerIntegrationBlockedGateIds: providerIntegrationHandoff.validationSummary.blockedGateIds,
      providerIntegrationWaitingGateIds: providerIntegrationHandoff.validationSummary.waitingGateIds,
      providerIntegrationExecutionTicketArtifact: "provider-integration-execution-ticket.json",
      providerIntegrationExecutionTicketReady: providerIntegrationExecutionTicket.readyForRuntimeRelease,
      providerIntegrationExecutionTicketStatus: providerIntegrationExecutionTicket.status,
      providerIntegrationExecutionTicketNextAction: providerIntegrationExecutionTicket.nextAction,
      providerIntegrationExecutionTicketResumeCursor: providerIntegrationExecutionTicket.resumeCursor,
      providerIntegrationExecutionTicketBlockedGates: providerIntegrationExecutionTicket.validationSummary.blockedGateIds,
      providerIntegrationExecutionTicketWaitingGates: providerIntegrationExecutionTicket.validationSummary.waitingGateIds,
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
      restartCheckpointManifestArtifact: "restart-checkpoint-manifest.json",
      restartCheckpointReady: restartCheckpointManifest.readyForColdRestart,
      restartCheckpointStatus: restartCheckpointManifest.status,
      restartCheckpointNextAction: restartCheckpointManifest.nextAction,
      restartCheckpointResumeToken: restartCheckpointManifest.resumeToken,
      restartCheckpointMissingRequired: restartCheckpointManifest.blocking.missingRequiredCheckpoints,
      restartReplayLedgerArtifact: "restart-replay-ledger.json",
      restartReplayReady: restartReplayLedger.replayReady,
      restartReplayStatus: restartReplayLedger.status,
      restartReplayNextAction: restartReplayLedger.nextAction,
      restartReplayResumeToken: restartReplayLedger.resumeToken,
      restartReplayUnsafeRows: restartReplayLedger.counters.unsafe,
      persistedStatusEnvelopeArtifact: "persisted-status-envelope.json",
      persistedStatusEnvelopeStatus: persistedStatusEnvelope.status,
      persistedStatusEnvelopeReady: persistedStatusEnvelope.readyForRuntimeResume,
      persistedStatusEnvelopeNextAction: persistedStatusEnvelope.nextAction,
      persistedStatusEnvelopeResumeToken: persistedStatusEnvelope.resumeToken,
      persistedStatusEnvelopeBlockedCommands: persistedStatusEnvelope.blocking.commandIds,
      persistedStatusEnvelopeUnsafeCommands: persistedStatusEnvelope.blocking.unsafeCommandIds,
      previewAcceptanceArtifact: "preview-acceptance.json",
      previewReleaseTicketArtifact: "preview-release-ticket.json",
      previewReleaseTicketStatus: previewReleaseTicket.status,
      previewReleaseTicketReady: previewReleaseTicket.readyForRuntimeRelease,
      previewReleaseTicketKey: previewReleaseTicket.ticketKey,
      previewReleaseTicketNextAction: previewReleaseTicket.nextAction,
      previewReleaseTicketResumeToken: previewReleaseTicket.resumeToken,
      previewHandoffArtifact: "preview-handoff.json",
      previewHandoffStatus: previewHandoff.status,
      previewHandoffRouteId: previewHandoff.routeId,
      previewHandoffNextAction: previewHandoff.nextAction,
      previewHandoffReadyForAcceptance: previewHandoff.readyForAcceptance,
      previewHandoffReadyForRuntimeStart: previewHandoff.readyForRuntimeStart,
      clientWorkflowArtifact: "client-workflow.json",
      clientWorkflowStatus: clientWorkflow.status,
      clientWorkflowAction: clientWorkflow.explainNextStep.action,
      clientRuntimeAdoptionArtifact: "client-runtime-adoption.json",
      clientRuntimeAdoptionStatus: clientRuntimeAdoption.status,
      clientRuntimeReady: clientRuntimeAdoption.readyForClientRuntime,
      clientRuntimeAdoptionNextAction: clientRuntimeAdoption.nextAction,
      clientRuntimeAdoptionId: clientRuntimeAdoption.adoptionId,
      clientStatusHandoffArtifact: "client-status-handoff.json",
      clientStatusHandoffStatus: clientStatusHandoff.status,
      clientStatusHandoffVisibleStatus: clientStatusHandoff.visibleStatus,
      clientStatusHandoffReadyForClient: clientStatusHandoff.readyForClient,
      clientStatusHandoffReadyForRuntime: clientStatusHandoff.readyForRuntime,
      clientStatusHandoffRouteId: clientStatusHandoff.route.routeId,
      clientStatusHandoffNextAction: clientStatusHandoff.nextAction,
      clientCommandLeasesArtifact: "client-command-leases.json",
      clientCommandLeaseStatus: clientCommandLeases.leaseStatus,
      clientCommandAckRequired: clientCommandLeases.ack.required,
      commandLeaseResumeToken: clientCommandLeases.resumeToken,
      clientCommandLeaseReplayArtifact: "client-command-lease-replay.json",
      clientCommandLeaseReplayStatus: clientCommandLeaseReplay.status,
      clientCommandLeaseReplayReady: clientCommandLeaseReplay.ready,
      commandLeaseReplayResumeToken: clientCommandLeaseReplay.resumeToken,
      clientCommandLeaseReplayHandoffArtifact: "client-command-lease-replay-handoff.json",
      clientCommandLeaseReplayHandoffStatus: clientCommandLeaseReplayHandoff.status,
      clientCommandLeaseReplayHandoffReady: clientCommandLeaseReplayHandoff.readyForRuntime,
      clientCommandLeaseReplayHandoffRouteId: clientCommandLeaseReplayHandoff.routeId,
      clientCommandLeaseReplayHandoffNextAction: clientCommandLeaseReplayHandoff.nextAction,
      commandLeaseReplayExportArtifact: "command-lease-replay-export.json",
      commandLeaseReplayExportReady: commandLeaseReplayExport.exportReady,
      commandLeaseReplayExportNextAction: commandLeaseReplayExport.nextAction,
      operationalRunbookArtifact: "operational-runbook.json",
      operationalRunbookState: operationalRunbook.state,
      operationalRunbookNextAction: operationalRunbook.nextAction,
      operationalRunbookRetryable: operationalRunbook.retry.retryable,
      operationalRunbookNextBackoffMs: operationalRunbook.retry.nextBackoffMs,
      clientRemediationPacketArtifact: "client-remediation-packet.json",
      clientRemediationPacketStatus: clientRemediationPacket.status,
      clientRemediationPacketRouteId: clientRemediationPacket.route.routeId,
      clientRemediationPacketNextAction: clientRemediationPacket.nextAction,
      clientRemediationPacketResumeToken: clientRemediationPacket.route.resumeToken,
      serviceLevelObjectiveArtifact: "service-level-objectives.json",
      serviceLevelObjectiveStatus: serviceLevelObjectiveExport.status,
      serviceLevelObjectiveReadyForRuntimeRelease: serviceLevelObjectiveExport.readyForRuntimeRelease,
      serviceLevelObjectiveNextAction: serviceLevelObjectiveExport.nextAction,
      operationalHealthReportArtifact: "operational-health-report.json",
      operationalHealthReportStatus: operationalHealthReport.status,
      operationalHealthReportLevel: operationalHealthReport.healthLevel,
      operationalHealthReportNextAction: operationalHealthReport.nextAction,
      operationalHealthReportResumeToken: operationalHealthReport.resumeToken,
      operationalHealthReportBlockingRows: operationalHealthReport.counters.blocking,
      operationalHealthReportRetryableRows: operationalHealthReport.counters.retryable,
      operationalIncidentExportArtifact: "operational-incident-export.json",
      operationalIncidentExportStatus: operationalIncidentExport.status,
      operationalIncidentExportReady: operationalIncidentExport.exportReady,
      operationalIncidentExportNextAction: operationalIncidentExport.nextAction,
      operationalIncidentExportResumeToken: operationalIncidentExport.resumeToken,
      operationalIncidentExportBlockingRows: operationalIncidentExport.exportSummary.blockingRowIds,
      operationalIncidentExportRetryableRows: operationalIncidentExport.exportSummary.retryableRowIds,
      clientReadinessBriefArtifact: "client-readiness-brief.json",
      clientReadinessBriefStatus: clientReadinessBrief.status,
      clientReadinessBriefVisibleStatus: clientReadinessBrief.visibleStatus,
      clientReadinessBriefReadyForPreview: clientReadinessBrief.readyForClientPreview,
      clientReadinessBriefReadyForRuntimeStart: clientReadinessBrief.readyForRuntimeStart,
      clientReadinessBriefNextAction: clientReadinessBrief.nextAction,
      clientReadinessBriefRouteId: clientReadinessBrief.route.routeId,
      dryRunAnalyticsExportArtifact: "dry-run-analytics-export.json",
      dryRunAnalyticsExportReady: dryRunAnalyticsExport.exportReady,
      dryRunAnalyticsExportStatus: dryRunAnalyticsExport.status,
      dryRunAnalyticsExportNextAction: dryRunAnalyticsExport.nextAction,
      diagnosticExportLedgerArtifact: "diagnostic-export-ledger.json",
      diagnosticExportLedgerReady: diagnosticExportLedger.exportReady,
      diagnosticExportLedgerStatus: diagnosticExportLedger.status,
      diagnosticExportLedgerNextAction: diagnosticExportLedger.nextAction,
      diagnosticExportLedgerRows: diagnosticExportLedger.rows.length,
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
  const previewAcceptancePacketArtifact = artifacts.find((artifact) => artifact.name === "preview-acceptance-packet.json");
  const previewReleaseTicketArtifact = artifacts.find((artifact) => artifact.name === "preview-release-ticket.json");
  const previewHandoffArtifact = artifacts.find((artifact) => artifact.name === "preview-handoff.json");
  const clientWorkflowArtifact = artifacts.find((artifact) => artifact.name === "client-workflow.json");
  const clientRuntimeAdoptionArtifact = artifacts.find((artifact) => artifact.name === "client-runtime-adoption.json");
  const clientRuntimeSettingsArtifact = artifacts.find((artifact) => artifact.name === "client-runtime-settings.json");
  const settingsRolloutGateArtifact = artifacts.find((artifact) => artifact.name === "settings-rollout-gate.json");
  const clientStatusHandoffArtifact = artifacts.find((artifact) => artifact.name === "client-status-handoff.json");
  const clientCommandLeasesArtifact = artifacts.find((artifact) => artifact.name === "client-command-leases.json");
  const clientCommandLeaseReplayArtifact = artifacts.find((artifact) => artifact.name === "client-command-lease-replay.json");
  const clientCommandLeaseReplayHandoffArtifact = artifacts.find((artifact) => artifact.name === "client-command-lease-replay-handoff.json");
  const commandLeaseReplayExportArtifact = artifacts.find((artifact) => artifact.name === "command-lease-replay-export.json");
  const operationalRunbookArtifact = artifacts.find((artifact) => artifact.name === "operational-runbook.json");
  const clientRemediationPacketArtifact = artifacts.find((artifact) => artifact.name === "client-remediation-packet.json");
  const serviceLevelObjectiveArtifact = artifacts.find((artifact) => artifact.name === "service-level-objectives.json");
  const operationalHealthReportArtifact = artifacts.find((artifact) => artifact.name === "operational-health-report.json");
  const operationalIncidentExportArtifact = artifacts.find((artifact) => artifact.name === "operational-incident-export.json");
  const clientReadinessBriefArtifact = artifacts.find((artifact) => artifact.name === "client-readiness-brief.json");
  const dryRunAnalyticsExportArtifact = artifacts.find((artifact) => artifact.name === "dry-run-analytics-export.json");
  const diagnosticExportLedgerArtifact = artifacts.find((artifact) => artifact.name === "diagnostic-export-ledger.json");
  const previewExportReadinessArtifact = artifacts.find((artifact) => artifact.name === "preview-export-readiness.json");
  const previewReadinessManifestArtifact = artifacts.find((artifact) => artifact.name === "preview-readiness-manifest.json");
  const lifecycleControlsArtifact = artifacts.find((artifact) => artifact.name === "lifecycle-controls.json");
  const lifecycleOperatorControlsArtifact = artifacts.find((artifact) => artifact.name === "lifecycle-operator-controls.json");
  const lifecycleRunControlArtifact = artifacts.find((artifact) => artifact.name === "lifecycle-run-control.json");
  const exportSummaryArtifact = artifacts.find((artifact) => artifact.name === "export-summary.json");
  const providerServiceArtifact = artifacts.find((artifact) => artifact.name === "provider-service-handoff.json");
  const providerSyncCheckpointArtifact = artifacts.find((artifact) => artifact.name === "provider-sync-checkpoint.json");
  const providerExportReadinessArtifact = artifacts.find((artifact) => artifact.name === "provider-export-readiness.json");
  const providerReleaseReadinessArtifact = artifacts.find((artifact) => artifact.name === "provider-release-readiness.json");
  const runtimeReleaseDecisionArtifact = artifacts.find((artifact) => artifact.name === "runtime-release-decision.json");
  const runtimeReleaseControlsArtifact = artifacts.find((artifact) => artifact.name === "runtime-release-controls.json");
  const statusRecoveryBundleArtifact = artifacts.find((artifact) => artifact.name === "status-recovery-bundle.json");
  const restartCheckpointManifestArtifact = artifacts.find((artifact) => artifact.name === "restart-checkpoint-manifest.json");
  const restartReplayLedgerArtifact = artifacts.find((artifact) => artifact.name === "restart-replay-ledger.json");
  const persistedStatusEnvelopeArtifact = artifacts.find((artifact) => artifact.name === "persisted-status-envelope.json");
  const runtimeStatusReplayCursorArtifact = artifacts.find((artifact) => artifact.name === "runtime-status-replay-cursor.json");
  const tenantAuditHandoffArtifact = artifacts.find((artifact) => artifact.name === "tenant-audit-handoff.json");
  const permissionGrantPlanArtifact = artifacts.find((artifact) => artifact.name === "permission-grant-plan.json");
  const tenantPermissionEnforcementArtifact = artifacts.find((artifact) => artifact.name === "tenant-permission-enforcement.json");
  const tenantBoundaryPostureArtifact = artifacts.find((artifact) => artifact.name === "tenant-boundary-posture.json");
  const tenantBoundaryMatrixArtifact = artifacts.find((artifact) => artifact.name === "tenant-boundary-matrix.json");
  const runtimeBoundaryExecutionTicketArtifact = artifacts.find((artifact) => artifact.name === "runtime-boundary-execution-ticket.json");
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
  const previewAcceptancePacketReady = previewAcceptancePacketArtifact?.payload?.schemaVersion === "aios.mailchimp.preview-acceptance-packet-artifact.v1"
    && Boolean(previewAcceptancePacketArtifact.payload.acceptanceToken)
    && Boolean(previewAcceptancePacketArtifact.payload.routePayload?.idempotencyKey)
    && Array.isArray(previewAcceptancePacketArtifact.payload.checkpoints)
    && Boolean(previewAcceptancePacketArtifact.payload.nextAction)
    && previewAcceptancePacketArtifact.payload.restartSemantics?.externalWritesPerformed === false;
  const previewReleaseTicketReady = previewReleaseTicketArtifact?.payload?.schemaVersion === "aios.mailchimp.preview-release-ticket-artifact.v1"
    && Boolean(previewReleaseTicketArtifact.payload.ticketKey)
    && Boolean(previewReleaseTicketArtifact.payload.routePayload?.idempotencyKey)
    && Boolean(previewReleaseTicketArtifact.payload.nextAction)
    && Array.isArray(previewReleaseTicketArtifact.payload.rows)
    && Array.isArray(previewReleaseTicketArtifact.payload.validationSummary?.blockedRowIds)
    && previewReleaseTicketArtifact.payload.restartSemantics?.externalWritesPerformed === false;
  const previewHandoffReady = previewHandoffArtifact?.payload?.schemaVersion === "aios.mailchimp.preview-handoff-artifact.v1"
    && Boolean(previewHandoffArtifact.payload.routePayload?.idempotencyKey)
    && Boolean(previewHandoffArtifact.payload.acceptance?.token)
    && Array.isArray(previewHandoffArtifact.payload.gates)
    && previewHandoffArtifact.payload.restartSemantics?.externalWritesPerformed === false;
  const clientWorkflowReady = clientWorkflowArtifact?.payload?.schemaVersion === "aios.mailchimp.client-workflow-artifact.v1"
    && Boolean(clientWorkflowArtifact.payload.explainNextStep?.action)
    && Array.isArray(clientWorkflowArtifact.payload.validationItems);
  const clientRuntimeAdoptionReady = clientRuntimeAdoptionArtifact?.payload?.schemaVersion === "aios.mailchimp.client-runtime-adoption-artifact.v1"
    && Boolean(clientRuntimeAdoptionArtifact.payload.adoptionId)
    && Boolean(clientRuntimeAdoptionArtifact.payload.nextAction)
    && clientRuntimeAdoptionArtifact.payload.restartSemantics?.externalWritesPerformed === false;
  const clientRuntimeSettingsReady = clientRuntimeSettingsArtifact?.payload?.schemaVersion === "aios.mailchimp.client-runtime-settings-artifact.v1"
    && Boolean(clientRuntimeSettingsArtifact.payload.settingsRevision)
    && Boolean(clientRuntimeSettingsArtifact.payload.nextAction)
    && clientRuntimeSettingsArtifact.payload.restartSemantics?.externalWritesPerformed === false;
  const settingsRolloutGateReady = settingsRolloutGateArtifact?.payload?.schemaVersion === "aios.mailchimp.settings-rollout-gate-artifact.v1"
    && Boolean(settingsRolloutGateArtifact.payload.rolloutKey)
    && Boolean(settingsRolloutGateArtifact.payload.nextAction)
    && Array.isArray(settingsRolloutGateArtifact.payload.checkpoints)
    && settingsRolloutGateArtifact.payload.restartSemantics?.externalWritesPerformed === false;
  const clientStatusHandoffReady = clientStatusHandoffArtifact?.payload?.schemaVersion === "aios.mailchimp.client-status-handoff-artifact.v1"
    && Boolean(clientStatusHandoffArtifact.payload.statusId)
    && Boolean(clientStatusHandoffArtifact.payload.route?.idempotencyKey)
    && Boolean(clientStatusHandoffArtifact.payload.nextAction)
    && clientStatusHandoffArtifact.payload.restartSemantics?.externalWritesPerformed === false;
  const clientCommandLeasesReady = clientCommandLeasesArtifact?.payload?.schemaVersion === "aios.mailchimp.client-command-leases-artifact.v1"
    && Boolean(clientCommandLeasesArtifact.payload.resumeToken)
    && Array.isArray(clientCommandLeasesArtifact.payload.leases);
  const clientCommandLeaseReplayReady = clientCommandLeaseReplayArtifact?.payload?.schemaVersion === "aios.mailchimp.client-command-lease-replay-artifact.v1"
    && Boolean(clientCommandLeaseReplayArtifact.payload.resumeToken)
    && Array.isArray(clientCommandLeaseReplayArtifact.payload.rows)
    && clientCommandLeaseReplayArtifact.payload.replay?.externalWritesPerformed === false;
  const clientCommandLeaseReplayHandoffReady = clientCommandLeaseReplayHandoffArtifact?.payload?.schemaVersion === "aios.mailchimp.client-command-lease-replay-handoff-artifact.v1"
    && Boolean(clientCommandLeaseReplayHandoffArtifact.payload.routePayload?.idempotencyKey)
    && Boolean(clientCommandLeaseReplayHandoffArtifact.payload.resumeToken)
    && Array.isArray(clientCommandLeaseReplayHandoffArtifact.payload.rows)
    && clientCommandLeaseReplayHandoffArtifact.payload.restartSemantics?.externalWritesPerformed === false;
  const commandLeaseReplayExportReady = commandLeaseReplayExportArtifact?.payload?.schemaVersion === "aios.mailchimp.command-lease-replay-export-artifact.v1"
    && Boolean(commandLeaseReplayExportArtifact.payload.resumeToken)
    && Array.isArray(commandLeaseReplayExportArtifact.payload.rows)
    && commandLeaseReplayExportArtifact.payload.restartSemantics?.externalWritesPerformed === false
    && Boolean(commandLeaseReplayExportArtifact.payload.nextAction);
  const operationalRunbookReady = operationalRunbookArtifact?.payload?.schemaVersion === "aios.mailchimp.operational-runbook-artifact.v1"
    && Boolean(operationalRunbookArtifact.payload.nextAction)
    && Array.isArray(operationalRunbookArtifact.payload.steps)
    && operationalRunbookArtifact.payload.restartSemantics?.externalWritesPerformed === false;
  const clientRemediationPacketReady = clientRemediationPacketArtifact?.payload?.schemaVersion === "aios.mailchimp.client-remediation-packet-artifact.v1"
    && Boolean(clientRemediationPacketArtifact.payload.route?.idempotencyKey)
    && Array.isArray(clientRemediationPacketArtifact.payload.steps)
    && clientRemediationPacketArtifact.payload.restartSemantics?.externalWritesPerformed === false;
  const serviceLevelObjectiveReady = serviceLevelObjectiveArtifact?.payload?.schemaVersion === "aios.mailchimp.service-level-objective-export-artifact.v1"
    && Boolean(serviceLevelObjectiveArtifact.payload.resumeToken)
    && Boolean(serviceLevelObjectiveArtifact.payload.nextAction)
    && Array.isArray(serviceLevelObjectiveArtifact.payload.rows)
    && serviceLevelObjectiveArtifact.payload.restartSemantics?.externalWritesPerformed === false;
  const operationalHealthReportReady = operationalHealthReportArtifact?.payload?.schemaVersion === "aios.mailchimp.operational-health-report-artifact.v1"
    && Boolean(operationalHealthReportArtifact.payload.reportId)
    && Boolean(operationalHealthReportArtifact.payload.resumeToken)
    && Boolean(operationalHealthReportArtifact.payload.nextAction)
    && Array.isArray(operationalHealthReportArtifact.payload.rows)
    && operationalHealthReportArtifact.payload.restartSemantics?.externalWritesPerformed === false;
  const operationalIncidentExportReady = operationalIncidentExportArtifact?.payload?.schemaVersion === "aios.mailchimp.operational-incident-export-artifact.v1"
    && Boolean(operationalIncidentExportArtifact.payload.resumeToken)
    && Boolean(operationalIncidentExportArtifact.payload.nextAction)
    && Array.isArray(operationalIncidentExportArtifact.payload.rows)
    && operationalIncidentExportArtifact.payload.restartSemantics?.externalWritesPerformed === false;
  const clientReadinessBriefReady = clientReadinessBriefArtifact?.payload?.schemaVersion === "aios.mailchimp.client-readiness-brief-artifact.v1"
    && Boolean(clientReadinessBriefArtifact.payload.route?.idempotencyKey)
    && Boolean(clientReadinessBriefArtifact.payload.nextAction)
    && Array.isArray(clientReadinessBriefArtifact.payload.sections)
    && Array.isArray(clientReadinessBriefArtifact.payload.validationSummary?.blockingSectionIds)
    && clientReadinessBriefArtifact.payload.restartSemantics?.externalWritesPerformed === false;
  const dryRunAnalyticsExportReady = dryRunAnalyticsExportArtifact?.payload?.schemaVersion === "aios.mailchimp.dry-run-analytics-export-artifact.v1"
    && Boolean(dryRunAnalyticsExportArtifact.payload.nextAction)
    && Array.isArray(dryRunAnalyticsExportArtifact.payload.timeline)
    && Array.isArray(dryRunAnalyticsExportArtifact.payload.exportSummary?.historySnapshotIds)
    && dryRunAnalyticsExportArtifact.payload.reportingState?.schemaVersion === "aios.mailchimp.dry-run-reporting-state.v1"
    && Boolean(dryRunAnalyticsExportArtifact.payload.reportingState.reportingCursor)
    && Array.isArray(dryRunAnalyticsExportArtifact.payload.reportingState.exportSummary?.historySnapshotIds)
    && dryRunAnalyticsExportArtifact.payload.reportingState.restartSemantics?.externalWritesPerformed === false
    && dryRunAnalyticsExportArtifact.payload.runtimeExportWatermark?.schemaVersion === "aios.mailchimp.runtime-export-watermark-artifact.v1"
    && Boolean(dryRunAnalyticsExportArtifact.payload.runtimeExportWatermark.cursor)
    && Boolean(dryRunAnalyticsExportArtifact.payload.runtimeExportWatermark.dedupeKey)
    && Array.isArray(dryRunAnalyticsExportArtifact.payload.runtimeExportWatermark.partitions)
    && dryRunAnalyticsExportArtifact.payload.runtimeExportWatermark.restartSemantics?.externalWritesPerformed === false
    && dryRunAnalyticsExportArtifact.payload.restartSemantics?.externalWritesPerformed === false;
  const diagnosticExportLedgerReady = diagnosticExportLedgerArtifact?.payload?.schemaVersion === "aios.mailchimp.diagnostic-export-ledger-artifact.v1"
    && Boolean(diagnosticExportLedgerArtifact.payload.resumeToken)
    && Boolean(diagnosticExportLedgerArtifact.payload.nextAction)
    && Array.isArray(diagnosticExportLedgerArtifact.payload.rows)
    && Array.isArray(diagnosticExportLedgerArtifact.payload.historySnapshots)
    && diagnosticExportLedgerArtifact.payload.restartSemantics?.externalWritesPerformed === false;
  const previewExportReadinessReady = previewExportReadinessArtifact?.payload?.schemaVersion === "aios.mailchimp.preview-export-readiness-artifact.v1"
    && Boolean(previewExportReadinessArtifact.payload.resumeToken)
    && Boolean(previewExportReadinessArtifact.payload.nextAction)
    && Array.isArray(previewExportReadinessArtifact.payload.rows)
    && previewExportReadinessArtifact.payload.restartSemantics?.externalWritesPerformed === false;
  const previewReadinessManifestReady = previewReadinessManifestArtifact?.payload?.schemaVersion === "aios.mailchimp.preview-readiness-manifest-artifact.v1"
    && Boolean(previewReadinessManifestArtifact.payload.route?.idempotencyKey)
    && Boolean(previewReadinessManifestArtifact.payload.nextAction)
    && Array.isArray(previewReadinessManifestArtifact.payload.sections)
    && Array.isArray(previewReadinessManifestArtifact.payload.validationSummary?.blockedSectionIds)
    && previewReadinessManifestArtifact.payload.restartSemantics?.externalWritesPerformed === false;
  const lifecycleControlsReady = lifecycleControlsArtifact?.payload?.schemaVersion === "aios.mailchimp.lifecycle-controls-artifact.v1"
    && Boolean(lifecycleControlsArtifact.payload.nextAction)
    && Array.isArray(lifecycleControlsArtifact.payload.controls);
  const lifecycleOperatorControlsReady = lifecycleOperatorControlsArtifact?.payload?.schemaVersion === "aios.mailchimp.lifecycle-operator-controls-artifact.v1"
    && Boolean(lifecycleOperatorControlsArtifact.payload.stateKey)
    && Boolean(lifecycleOperatorControlsArtifact.payload.nextAction)
    && Array.isArray(lifecycleOperatorControlsArtifact.payload.controls)
    && lifecycleOperatorControlsArtifact.payload.restartSemantics?.externalWritesPerformed === false;
  const lifecycleRunControlReady = lifecycleRunControlArtifact?.payload?.schemaVersion === "aios.mailchimp.lifecycle-run-control-artifact.v1"
    && Boolean(lifecycleRunControlArtifact.payload.controlKey)
    && Boolean(lifecycleRunControlArtifact.payload.nextAction)
    && Array.isArray(lifecycleRunControlArtifact.payload.rows)
    && lifecycleRunControlArtifact.payload.restartSemantics?.externalWritesPerformed === false;
  const providerServiceReady = providerServiceArtifact?.payload?.schemaVersion === "aios.mailchimp.provider-service-handoff.v1"
    && Boolean(providerServiceArtifact.payload.externalHandoff?.idempotencyKey)
    && Array.isArray(providerServiceArtifact.payload.capabilityNegotiation?.unnegotiated);
  const providerSyncCheckpointReady = providerSyncCheckpointArtifact?.payload?.schemaVersion === "aios.mailchimp.provider-sync-checkpoint-artifact.v1"
    && Boolean(providerSyncCheckpointArtifact.payload.resumeToken)
    && Boolean(providerSyncCheckpointArtifact.payload.nextAction)
    && Array.isArray(providerSyncCheckpointArtifact.payload.rows)
    && providerSyncCheckpointArtifact.payload.restartSemantics?.externalWritesPerformed === false;
  const providerExportReadinessReady = providerExportReadinessArtifact?.payload?.schemaVersion === "aios.mailchimp.provider-export-readiness-artifact.v1"
    && Boolean(providerExportReadinessArtifact.payload.exportKey)
    && Boolean(providerExportReadinessArtifact.payload.routePayload?.idempotencyKey)
    && Boolean(providerExportReadinessArtifact.payload.nextAction)
    && Array.isArray(providerExportReadinessArtifact.payload.rows)
    && providerExportReadinessArtifact.payload.restartSemantics?.externalWritesPerformed === false;
  const providerCallbackHandoffReady = providerCallbackHandoffArtifact?.payload?.schemaVersion === "aios.mailchimp.provider-callback-handoff-artifact.v1"
    && Boolean(providerCallbackHandoffArtifact.payload.callbackKey)
    && Boolean(providerCallbackHandoffArtifact.payload.routePayload?.idempotencyKey)
    && Boolean(providerCallbackHandoffArtifact.payload.resumeToken)
    && Array.isArray(providerCallbackHandoffArtifact.payload.rows)
    && providerCallbackHandoffArtifact.payload.restartSemantics?.externalWritesPerformed === false;
  const providerReleaseReadinessReady = providerReleaseReadinessArtifact?.payload?.schemaVersion === "aios.mailchimp.provider-release-readiness-artifact.v1"
    && Boolean(providerReleaseReadinessArtifact.payload.releaseContractId)
    && Boolean(providerReleaseReadinessArtifact.payload.nextAction)
    && Array.isArray(providerReleaseReadinessArtifact.payload.capabilityNegotiation?.missing)
    && providerReleaseReadinessArtifact.payload.externalHandoff?.externalWritesPerformed === false
    && providerReleaseReadinessArtifact.payload.restartSemantics?.externalWritesPerformed === false;
  const providerIntegrationHandoffReady = providerIntegrationHandoffArtifact?.payload?.schemaVersion === "aios.mailchimp.provider-integration-handoff-artifact.v1"
    && Boolean(providerIntegrationHandoffArtifact.payload.integrationKey)
    && Boolean(providerIntegrationHandoffArtifact.payload.nextAction)
    && Array.isArray(providerIntegrationHandoffArtifact.payload.gates)
    && Array.isArray(providerIntegrationHandoffArtifact.payload.validationSummary?.blockedGateIds)
    && providerIntegrationHandoffArtifact.payload.externalHandoff?.externalWritesPerformed === false
    && providerIntegrationHandoffArtifact.payload.restartSemantics?.externalWritesPerformed === false;
  const providerIntegrationExecutionTicketReady = providerIntegrationExecutionTicketArtifact?.payload?.schemaVersion === "aios.mailchimp.provider-integration-execution-ticket-artifact.v1"
    && Boolean(providerIntegrationExecutionTicketArtifact.payload.ticketKey)
    && Boolean(providerIntegrationExecutionTicketArtifact.payload.nextAction)
    && Boolean(providerIntegrationExecutionTicketArtifact.payload.routePayload?.idempotencyKey)
    && Array.isArray(providerIntegrationExecutionTicketArtifact.payload.gates)
    && Array.isArray(providerIntegrationExecutionTicketArtifact.payload.validationSummary?.blockedGateIds)
    && providerIntegrationExecutionTicketArtifact.payload.restartSemantics?.externalWritesPerformed === false;
  const runtimeReleaseDecisionReady = runtimeReleaseDecisionArtifact?.payload?.schemaVersion === "aios.mailchimp.runtime-release-decision-artifact.v1"
    && Boolean(runtimeReleaseDecisionArtifact.payload.releaseToken)
    && Boolean(runtimeReleaseDecisionArtifact.payload.nextAction)
    && Array.isArray(runtimeReleaseDecisionArtifact.payload.rows)
    && runtimeReleaseDecisionArtifact.payload.releaseCommand?.externalWritesPerformed === false
    && runtimeReleaseDecisionArtifact.payload.restartSemantics?.externalWritesPerformed === false;
  const runtimeReleaseControlsReady = runtimeReleaseControlsArtifact?.payload?.schemaVersion === "aios.mailchimp.runtime-release-controls-artifact.v1"
    && Boolean(runtimeReleaseControlsArtifact.payload.releaseKey)
    && Boolean(runtimeReleaseControlsArtifact.payload.nextAction)
    && Array.isArray(runtimeReleaseControlsArtifact.payload.rows)
    && runtimeReleaseControlsArtifact.payload.restartSemantics?.externalWritesPerformed === false;
  const statusRecoveryBundleReady = statusRecoveryBundleArtifact?.payload?.schemaVersion === "aios.mailchimp.status-recovery-bundle-artifact.v1"
    && Boolean(statusRecoveryBundleArtifact.payload.resume?.resumeToken)
    && Boolean(statusRecoveryBundleArtifact.payload.nextAction)
    && Array.isArray(statusRecoveryBundleArtifact.payload.checkpoints)
    && statusRecoveryBundleArtifact.payload.restartSemantics?.externalWritesPerformed === false;
  const restartCheckpointManifestReady = restartCheckpointManifestArtifact?.payload?.schemaVersion === "aios.mailchimp.restart-checkpoint-manifest-artifact.v1"
    && Boolean(restartCheckpointManifestArtifact.payload.resumeToken)
    && Boolean(restartCheckpointManifestArtifact.payload.nextAction)
    && Array.isArray(restartCheckpointManifestArtifact.payload.checkpoints)
    && restartCheckpointManifestArtifact.payload.restartSemantics?.externalWritesPerformed === false;
  const restartReplayLedgerReady = restartReplayLedgerArtifact?.payload?.schemaVersion === "aios.mailchimp.restart-replay-ledger-artifact.v1"
    && Boolean(restartReplayLedgerArtifact.payload.resumeToken)
    && Boolean(restartReplayLedgerArtifact.payload.nextAction)
    && Array.isArray(restartReplayLedgerArtifact.payload.rows)
    && restartReplayLedgerArtifact.payload.restartSemantics?.externalWritesPerformed === false;
  const persistedStatusEnvelopeReady = persistedStatusEnvelopeArtifact?.payload?.schemaVersion === "aios.mailchimp.persisted-status-envelope-artifact.v1"
    && Boolean(persistedStatusEnvelopeArtifact.payload.resumeToken)
    && Boolean(persistedStatusEnvelopeArtifact.payload.statusRevision)
    && Boolean(persistedStatusEnvelopeArtifact.payload.nextAction)
    && Array.isArray(persistedStatusEnvelopeArtifact.payload.rows)
    && persistedStatusEnvelopeArtifact.payload.restartSemantics?.externalWritesPerformed === false;
  const runtimeStatusReplayCursorReady = runtimeStatusReplayCursorArtifact?.payload?.schemaVersion === "aios.mailchimp.runtime-status-replay-cursor-artifact.v1"
    && Boolean(runtimeStatusReplayCursorArtifact.payload.replayCursor)
    && Boolean(runtimeStatusReplayCursorArtifact.payload.resumeToken)
    && Boolean(runtimeStatusReplayCursorArtifact.payload.nextAction)
    && Array.isArray(runtimeStatusReplayCursorArtifact.payload.rows)
    && runtimeStatusReplayCursorArtifact.payload.restartSemantics?.externalWritesPerformed === false;
  const tenantAuditHandoffReady = tenantAuditHandoffArtifact?.payload?.schemaVersion === "aios.mailchimp.tenant-audit-handoff-artifact.v1"
    && Boolean(tenantAuditHandoffArtifact.payload.isolationKey)
    && tenantAuditHandoffArtifact.payload.handoff?.externalWritesPerformed === false
    && Array.isArray(tenantAuditHandoffArtifact.payload.validation)
    && Boolean(tenantAuditHandoffArtifact.payload.handoff?.nextAction);
  const permissionGrantPlanReady = permissionGrantPlanArtifact?.payload?.schemaVersion === "aios.mailchimp.permission-grant-plan-artifact.v1"
    && Boolean(permissionGrantPlanArtifact.payload.planId)
    && Array.isArray(permissionGrantPlanArtifact.payload.commands)
    && Boolean(permissionGrantPlanArtifact.payload.nextAction)
    && permissionGrantPlanArtifact.payload.auditHandoff?.externalWritesPerformed === false
    && permissionGrantPlanArtifact.payload.restartSemantics?.externalWritesPerformed === false;
  const tenantPermissionEnforcementReady = tenantPermissionEnforcementArtifact?.payload?.schemaVersion === "aios.mailchimp.tenant-permission-enforcement-artifact.v1"
    && Boolean(tenantPermissionEnforcementArtifact.payload.enforcementKey)
    && Array.isArray(tenantPermissionEnforcementArtifact.payload.decisions)
    && tenantPermissionEnforcementArtifact.payload.audit?.externalWritesPerformed === false
    && tenantPermissionEnforcementArtifact.payload.restartSemantics?.externalWritesPerformed === false;
  const tenantBoundaryPostureReady = tenantBoundaryPostureArtifact?.payload?.schemaVersion === "aios.mailchimp.tenant-boundary-posture-artifact.v1"
    && Boolean(tenantBoundaryPostureArtifact.payload.postureKey)
    && Array.isArray(tenantBoundaryPostureArtifact.payload.rows)
    && tenantBoundaryPostureArtifact.payload.auditHandoff?.externalWritesPerformed === false
    && tenantBoundaryPostureArtifact.payload.restartSemantics?.externalWritesPerformed === false;
  const tenantBoundaryMatrixReady = tenantBoundaryMatrixArtifact?.payload?.schemaVersion === "aios.mailchimp.tenant-boundary-matrix-artifact.v1"
    && Boolean(tenantBoundaryMatrixArtifact.payload.isolationKey)
    && tenantBoundaryMatrixArtifact.payload.audit?.externalWritesPerformed === false
    && Array.isArray(tenantBoundaryMatrixArtifact.payload.rows)
    && Array.isArray(tenantBoundaryMatrixArtifact.payload.historySnapshots)
    && Boolean(tenantBoundaryMatrixArtifact.payload.exportSummary?.nextAction);
  const runtimeBoundaryExecutionTicketReady = runtimeBoundaryExecutionTicketArtifact?.payload?.schemaVersion === "aios.mailchimp.runtime-boundary-execution-ticket-artifact.v1"
    && Boolean(runtimeBoundaryExecutionTicketArtifact.payload.ticketKey)
    && Boolean(runtimeBoundaryExecutionTicketArtifact.payload.nextAction)
    && Array.isArray(runtimeBoundaryExecutionTicketArtifact.payload.rows)
    && runtimeBoundaryExecutionTicketArtifact.payload.auditHandoff?.externalWritesPerformed === false
    && runtimeBoundaryExecutionTicketArtifact.payload.restartSemantics?.externalWritesPerformed === false;
  const exportSummaryReady = exportSummaryArtifact?.payload?.schemaVersion === "aios.mailchimp.export-summary.v1"
    && Boolean(exportSummaryArtifact.payload.resumeToken)
    && exportSummaryArtifact.payload.previewAcceptanceArtifact === "preview-acceptance.json"
    && exportSummaryArtifact.payload.previewAcceptancePacketArtifact === "preview-acceptance-packet.json"
    && exportSummaryArtifact.payload.previewReleaseTicketArtifact === "preview-release-ticket.json"
    && exportSummaryArtifact.payload.previewHandoffArtifact === "preview-handoff.json"
    && Boolean(exportSummaryArtifact.payload.previewAcceptanceReceiptToken)
    && exportSummaryArtifact.payload.lifecycleOperatorControlsArtifact === "lifecycle-operator-controls.json"
    && exportSummaryArtifact.payload.lifecycleRunControlArtifact === "lifecycle-run-control.json"
    && exportSummaryArtifact.payload.providerServiceArtifact === "provider-service-handoff.json"
    && exportSummaryArtifact.payload.providerSyncCheckpointArtifact === "provider-sync-checkpoint.json"
    && exportSummaryArtifact.payload.providerExportReadinessArtifact === "provider-export-readiness.json"
    && exportSummaryArtifact.payload.providerCallbackHandoffArtifact === "provider-callback-handoff.json"
    && exportSummaryArtifact.payload.providerReleaseReadinessArtifact === "provider-release-readiness.json"
    && exportSummaryArtifact.payload.providerIntegrationHandoffArtifact === "provider-integration-handoff.json"
    && exportSummaryArtifact.payload.providerIntegrationExecutionTicketArtifact === "provider-integration-execution-ticket.json"
    && exportSummaryArtifact.payload.runtimeReleaseDecisionArtifact === "runtime-release-decision.json"
    && exportSummaryArtifact.payload.runtimeReleaseControlsArtifact === "runtime-release-controls.json"
    && exportSummaryArtifact.payload.restartReplayLedgerArtifact === "restart-replay-ledger.json"
    && exportSummaryArtifact.payload.persistedStatusEnvelopeArtifact === "persisted-status-envelope.json"
    && exportSummaryArtifact.payload.runtimeStatusReplayCursorArtifact === "runtime-status-replay-cursor.json"
    && exportSummaryArtifact.payload.clientRuntimeSettingsArtifact === "client-runtime-settings.json"
    && exportSummaryArtifact.payload.settingsRolloutGateArtifact === "settings-rollout-gate.json"
    && exportSummaryArtifact.payload.clientStatusHandoffArtifact === "client-status-handoff.json"
    && exportSummaryArtifact.payload.tenantAuditHandoffArtifact === "tenant-audit-handoff.json"
    && exportSummaryArtifact.payload.permissionGrantPlanArtifact === "permission-grant-plan.json"
    && exportSummaryArtifact.payload.tenantPermissionEnforcementArtifact === "tenant-permission-enforcement.json"
    && exportSummaryArtifact.payload.tenantBoundaryPostureArtifact === "tenant-boundary-posture.json"
    && exportSummaryArtifact.payload.tenantBoundaryMatrixArtifact === "tenant-boundary-matrix.json"
    && exportSummaryArtifact.payload.runtimeBoundaryExecutionTicketArtifact === "runtime-boundary-execution-ticket.json"
    && exportSummaryArtifact.payload.serviceLevelObjectiveArtifact === "service-level-objectives.json"
    && exportSummaryArtifact.payload.operationalHealthReportArtifact === "operational-health-report.json"
    && exportSummaryArtifact.payload.operationalIncidentExportArtifact === "operational-incident-export.json"
    && exportSummaryArtifact.payload.clientReadinessBriefArtifact === "client-readiness-brief.json"
    && exportSummaryArtifact.payload.diagnosticExportLedgerArtifact === "diagnostic-export-ledger.json"
    && exportSummaryArtifact.payload.previewExportReadinessArtifact === "preview-export-readiness.json";

  return {
    ok: emission?.provider === "mailchimp"
      && artifacts.some((artifact) => artifact.name === "persisted-state.json")
      && artifacts.some((artifact) => artifact.name === "command-journal.json")
      && artifacts.some((artifact) => artifact.name === "status-snapshot.json")
      && permissionBoundaryReady
    && failureStateReady
    && providerServiceReady
    && providerSyncCheckpointReady
    && providerExportReadinessReady
    && providerCallbackHandoffReady
    && providerReleaseReadinessReady
    && providerIntegrationHandoffReady
    && providerIntegrationExecutionTicketReady
    && runtimeReleaseDecisionReady
    && runtimeReleaseControlsReady
    && statusRecoveryBundleReady
    && restartCheckpointManifestReady
    && restartReplayLedgerReady
    && persistedStatusEnvelopeReady
    && runtimeStatusReplayCursorReady
    && tenantAuditHandoffReady
    && permissionGrantPlanReady
    && tenantPermissionEnforcementReady
    && tenantBoundaryPostureReady
    && tenantBoundaryMatrixReady
    && runtimeBoundaryExecutionTicketReady
    && previewAcceptanceReady
    && previewAcceptancePacketReady
    && previewReleaseTicketReady
    && previewHandoffReady
      && clientWorkflowReady
    && clientRuntimeAdoptionReady
    && clientRuntimeSettingsReady
    && settingsRolloutGateReady
    && clientStatusHandoffReady
    && clientCommandLeasesReady
    && clientCommandLeaseReplayReady
    && clientCommandLeaseReplayHandoffReady
      && commandLeaseReplayExportReady
    && operationalRunbookReady
    && clientRemediationPacketReady
    && serviceLevelObjectiveReady
    && operationalHealthReportReady
    && operationalIncidentExportReady
    && clientReadinessBriefReady
    && dryRunAnalyticsExportReady
    && diagnosticExportLedgerReady
    && previewExportReadinessReady
    && previewReadinessManifestReady
      && lifecycleControlsReady
      && lifecycleOperatorControlsReady
      && lifecycleRunControlReady
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
    providerSyncCheckpointReady,
    providerExportReadinessReady,
    providerCallbackHandoffReady,
    providerReleaseReadinessReady,
    providerIntegrationHandoffReady,
    providerIntegrationExecutionTicketReady,
    runtimeReleaseDecisionReady,
    runtimeReleaseControlsReady,
    statusRecoveryBundleReady,
    restartCheckpointManifestReady,
    restartReplayLedgerReady,
    persistedStatusEnvelopeReady,
    runtimeStatusReplayCursorReady,
    tenantAuditHandoffReady,
    permissionGrantPlanReady,
    tenantPermissionEnforcementReady,
    tenantBoundaryPostureReady,
    tenantBoundaryMatrixReady,
    runtimeBoundaryExecutionTicketReady,
    previewAcceptanceReady,
    previewAcceptancePacketReady,
    previewReleaseTicketReady,
    previewHandoffReady,
    clientWorkflowReady,
    clientRuntimeAdoptionReady,
    clientRuntimeSettingsReady,
    settingsRolloutGateReady,
    clientStatusHandoffReady,
    clientCommandLeasesReady,
    clientCommandLeaseReplayReady,
    clientCommandLeaseReplayHandoffReady,
    commandLeaseReplayExportReady,
    operationalRunbookReady,
    clientRemediationPacketReady,
    serviceLevelObjectiveReady,
    operationalHealthReportReady,
    operationalIncidentExportReady,
    clientReadinessBriefReady,
    dryRunAnalyticsExportReady,
    diagnosticExportLedgerReady,
    previewExportReadinessReady,
    previewReadinessManifestReady,
    lifecycleControlsReady,
    lifecycleOperatorControlsReady,
    lifecycleRunControlReady,
    exportSummaryReady,
    nextAction: requiredMissingPayload.length
      ? "regenerate-required-artifacts"
      : permissionBoundaryReady === false
        ? "regenerate-permission-boundary-artifact"
        : failureStateReady === false
          ? "regenerate-failure-state-artifact"
          : providerServiceReady === false
          ? "regenerate-provider-service-handoff-artifact"
            : providerSyncCheckpointReady === false
              ? "regenerate-provider-sync-checkpoint-artifact"
            : providerExportReadinessReady === false
              ? "regenerate-provider-export-readiness-artifact"
            : providerCallbackHandoffReady === false
              ? "regenerate-provider-callback-handoff-artifact"
            : providerReleaseReadinessReady === false
              ? "regenerate-provider-release-readiness-artifact"
            : providerIntegrationHandoffReady === false
              ? "regenerate-provider-integration-handoff-artifact"
            : providerIntegrationExecutionTicketReady === false
              ? "regenerate-provider-integration-execution-ticket-artifact"
            : runtimeReleaseDecisionReady === false
              ? "regenerate-runtime-release-decision-artifact"
            : runtimeReleaseControlsReady === false
              ? "regenerate-runtime-release-controls-artifact"
            : statusRecoveryBundleReady === false
              ? "regenerate-status-recovery-bundle-artifact"
            : restartCheckpointManifestReady === false
              ? "regenerate-restart-checkpoint-manifest-artifact"
            : restartReplayLedgerReady === false
              ? "regenerate-restart-replay-ledger-artifact"
            : tenantAuditHandoffReady === false
              ? "regenerate-tenant-audit-handoff-artifact"
            : permissionGrantPlanReady === false
              ? "regenerate-permission-grant-plan-artifact"
            : tenantPermissionEnforcementReady === false
              ? "regenerate-tenant-permission-enforcement-artifact"
            : tenantBoundaryPostureReady === false
              ? "regenerate-tenant-boundary-posture-artifact"
            : tenantBoundaryMatrixReady === false
              ? "regenerate-tenant-boundary-matrix-artifact"
            : runtimeBoundaryExecutionTicketReady === false
              ? "regenerate-runtime-boundary-execution-ticket-artifact"
            : previewAcceptanceReady === false
            ? "regenerate-preview-acceptance-artifact"
            : previewAcceptancePacketReady === false
              ? "regenerate-preview-acceptance-packet-artifact"
            : previewReleaseTicketReady === false
              ? "regenerate-preview-release-ticket-artifact"
            : previewHandoffReady === false
              ? "regenerate-preview-handoff-artifact"
            : clientWorkflowReady === false
              ? "regenerate-client-workflow-artifact"
            : clientRuntimeAdoptionReady === false
              ? "regenerate-client-runtime-adoption-artifact"
            : clientRuntimeSettingsReady === false
              ? "regenerate-client-runtime-settings-artifact"
            : settingsRolloutGateReady === false
              ? "regenerate-settings-rollout-gate-artifact"
            : clientStatusHandoffReady === false
              ? "regenerate-client-status-handoff-artifact"
            : clientCommandLeasesReady === false
              ? "regenerate-client-command-leases-artifact"
            : clientCommandLeaseReplayReady === false
              ? "regenerate-client-command-lease-replay-artifact"
            : clientCommandLeaseReplayHandoffReady === false
              ? "regenerate-client-command-lease-replay-handoff-artifact"
            : commandLeaseReplayExportReady === false
              ? "regenerate-command-lease-replay-export-artifact"
            : operationalRunbookReady === false
              ? "regenerate-operational-runbook-artifact"
            : clientRemediationPacketReady === false
              ? "regenerate-client-remediation-packet-artifact"
            : serviceLevelObjectiveReady === false
              ? "regenerate-service-level-objective-artifact"
            : operationalHealthReportReady === false
              ? "regenerate-operational-health-report-artifact"
            : operationalIncidentExportReady === false
              ? "regenerate-operational-incident-export-artifact"
            : dryRunAnalyticsExportReady === false
              ? "regenerate-dry-run-analytics-export-artifact"
            : diagnosticExportLedgerReady === false
              ? "regenerate-diagnostic-export-ledger-artifact"
            : previewExportReadinessReady === false
              ? "regenerate-preview-export-readiness-artifact"
            : previewReadinessManifestReady === false
              ? "regenerate-preview-readiness-manifest-artifact"
            : lifecycleControlsReady === false
              ? "regenerate-lifecycle-controls-artifact"
            : lifecycleOperatorControlsReady === false
              ? "regenerate-lifecycle-operator-controls-artifact"
            : lifecycleRunControlReady === false
              ? "regenerate-lifecycle-run-control-artifact"
              : exportSummaryReady
                ? emission?.recovery?.nextAction
                : "regenerate-export-summary-artifact"
  };
}
