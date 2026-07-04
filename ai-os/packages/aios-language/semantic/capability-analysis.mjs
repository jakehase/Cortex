import { inferAiosTypeHints } from "./type-hints.mjs";

const WRITE_ACTION_PATTERN = /create|update|schedule|send|delete|archive/i;

function compactString(value) {
  return String(value ?? "").trim();
}

function toArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function freezeArray(items) {
  return Object.freeze(items.map((item) => Object.freeze(item)));
}

function getJobs(input = {}) {
  if (Array.isArray(input.jobs)) return input.jobs;
  if (Array.isArray(input.ast?.jobs)) return input.ast.jobs;
  return [];
}

function firstString(...values) {
  for (const value of values) {
    const text = compactString(value);
    if (text) return text;
  }
  return "";
}

function stableContractToken(prefix, parts) {
  const body = parts.map(compactString).filter(Boolean).join(":");
  return `${prefix}:${body || "anonymous"}`;
}

function normalizePermission(value) {
  return compactString(value).toLowerCase();
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function inferMailchimpScopes(action) {
  if (action.startsWith("campaign.")) return action.includes("read")
    ? ["mailchimp:campaigns:read"]
    : action.includes("schedule")
      ? ["mailchimp:campaigns:schedule"]
      : ["mailchimp:campaigns:write"];
  if (action.startsWith("audience.segment.")) return ["mailchimp:segments:read"];
  if (action.startsWith("audience.")) return ["mailchimp:lists:read"];
  if (action.startsWith("template.")) return ["mailchimp:templates:read"];
  if (action.startsWith("report.")) return ["mailchimp:reports:read"];
  return [];
}

function requiredPermissionForAction(action) {
  if (action.startsWith("campaign.") && /schedule|send/.test(action)) return "mailchimp.campaigns.approve_send";
  if (action.startsWith("campaign.") && WRITE_ACTION_PATTERN.test(action)) return "mailchimp.campaigns.write";
  if (action.startsWith("campaign.")) return "mailchimp.campaigns.read";
  if (action.startsWith("audience.segment.")) return WRITE_ACTION_PATTERN.test(action) ? "mailchimp.segments.write" : "mailchimp.segments.read";
  if (action.startsWith("audience.")) return WRITE_ACTION_PATTERN.test(action) ? "mailchimp.lists.write" : "mailchimp.lists.read";
  if (action.startsWith("template.")) return WRITE_ACTION_PATTERN.test(action) ? "mailchimp.templates.write" : "mailchimp.templates.read";
  if (action.startsWith("report.")) return "mailchimp.reports.read";
  return "";
}

function normalizeRuntimePrincipal(job = {}, typeJob = {}) {
  const persistedState = typeJob.persistedState || {};
  const tenantBoundary = typeJob.tenantBoundary || {};
  const boundaryHealth = typeJob.boundaryHealth || {};
  const runtimeReadiness = typeJob.runtimeReadiness || typeJob.contract?.runtimeReadiness || {};
  const clientWorkflow = typeJob.clientRuntimeAdoption?.workflow || {};
  const permissionBoundary = typeJob.scope?.permissionBoundary || {};
  const permissionPosture = typeJob.permissionPosture || typeJob.contract?.permissionPosture || typeJob.boundaryHealth?.permissionPosture || typeJob.scope?.permissionPosture || {};
  const runtimeScope = typeJob.scope?.runtimeScope || {};
  const clientState = job.clientState || job.requestState || {};
  const roles = [
    ...toArray(job.roles),
    ...toArray(clientState.roles),
    ...toArray(job.actor?.roles),
    ...toArray(tenantBoundary.roles),
  ].map(normalizePermission).filter(Boolean).sort();
  const permissions = [
    ...toArray(job.permissions),
    ...toArray(clientState.permissions),
    ...toArray(job.actor?.permissions),
    ...toArray(tenantBoundary.permissions),
  ].map(normalizePermission).filter(Boolean).sort();

  return Object.freeze({
    tenantId: firstString(clientState.tenantId, job.tenantId, tenantBoundary.tenantId, persistedState.tenantId, runtimeScope.tenantId),
    workspaceId: firstString(clientState.workspaceId, job.workspaceId, tenantBoundary.workspaceId, persistedState.workspaceId, runtimeScope.workspaceId),
    actorId: firstString(clientState.userId, clientState.actorId, job.actor?.id, job.userId, tenantBoundary.actorId),
    requestId: firstString(clientState.requestId, job.requestId, persistedState.requestId),
    roles: freezeArray([...new Set(roles)]),
    permissions: freezeArray([...new Set(permissions)]),
    acceptedActions: freezeArray(toArray(clientState.acceptedActions || job.acceptedActions).map(compactString).filter(Boolean).sort()),
    rejectedActions: freezeArray(toArray(clientState.rejectedActions || job.rejectedActions).map(compactString).filter(Boolean).sort()),
    statusChannel: firstString(clientState.statusChannel, job.statusChannel, tenantBoundary.statusChannel, persistedState.statusChannel),
    restartToken: compactString(persistedState.restartToken),
    statusSnapshotKey: compactString(persistedState.statusSnapshotKey),
    adapterStatusSnapshotState: compactString(persistedState.adapterStatusSnapshotState || "not-required"),
    adapterStatusSnapshotRows: persistedState.adapterStatusSnapshotRows || freezeArray([]),
    blockedAdapterStatusSnapshotRows: persistedState.blockedAdapterStatusSnapshotRows || freezeArray([]),
    providerSyncReadiness: typeJob.providerSyncReadiness || typeJob.contract?.providerSyncReadiness || {},
    providerSyncScopeRows: freezeArray(toArray(typeJob.scope?.providerSyncContract?.rows)),
    segmentSyncReceiptReadiness: typeJob.segmentSyncReceiptReadiness || typeJob.contract?.segmentSyncReceiptReadiness || {},
    segmentSyncReceiptRows: freezeArray(toArray(typeJob.segmentSyncReceiptReadiness?.rows || typeJob.contract?.segmentSyncReceiptReadiness?.rows || typeJob.scope?.segmentSyncReceipts?.rows)),
    providerBudgetReadiness: typeJob.providerBudgetReadiness || typeJob.contract?.providerBudgetReadiness || {},
    providerBudgetRows: freezeArray(toArray(typeJob.providerBudgetReadiness?.rows || typeJob.contract?.providerBudgetReadiness?.rows || typeJob.scope?.providerBudget?.rows)),
    providerCallbackReadiness: typeJob.providerCallbackReadiness || typeJob.contract?.providerCallbackReadiness || {},
    providerCallbackRows: freezeArray(toArray(typeJob.providerCallbackReadiness?.rows || typeJob.contract?.providerCallbackReadiness?.rows || typeJob.scope?.providerCallback?.rows)),
    providerEventSubscriptionReadiness: typeJob.providerEventSubscriptionReadiness || typeJob.contract?.providerEventSubscriptionReadiness || {},
    providerEventSubscriptionRows: freezeArray(toArray(typeJob.providerEventSubscriptionReadiness?.rows || typeJob.contract?.providerEventSubscriptionReadiness?.rows || typeJob.scope?.providerEventSubscriptions?.rows)),
    providerMaintenanceReadiness: typeJob.providerMaintenanceReadiness || typeJob.contract?.providerMaintenanceReadiness || {},
    providerMaintenanceRows: freezeArray(toArray(typeJob.providerMaintenanceReadiness?.rows || typeJob.contract?.providerMaintenanceReadiness?.rows || typeJob.scope?.providerMaintenance?.rows)),
    providerExportBoundaryReadiness: typeJob.providerExportBoundaryReadiness || typeJob.contract?.providerExportBoundaryReadiness || {},
    providerExportBoundaryRows: freezeArray(toArray(typeJob.providerExportBoundaryReadiness?.rows || typeJob.contract?.providerExportBoundaryReadiness?.rows || typeJob.scope?.exportRows)),
    providerExportBoundaryBlockedRows: freezeArray(toArray(typeJob.providerExportBoundaryReadiness?.blockedRows || typeJob.contract?.providerExportBoundaryReadiness?.blockedRows)),
    providerExportPublication: typeJob.providerExportBoundaryReadiness?.publication || typeJob.contract?.providerExportBoundaryReadiness?.publication || typeJob.scope?.publicationManifest || {},
    publicationReceiptReadiness: typeJob.publicationReceiptReadiness || typeJob.contract?.publicationReceiptReadiness || typeJob.scope?.publicationReceipts || {},
    publicationReceiptRows: freezeArray(toArray(typeJob.publicationReceiptReadiness?.rows || typeJob.contract?.publicationReceiptReadiness?.rows || typeJob.scope?.publicationReceipts?.rows)),
    publicationReceiptBlockedRows: freezeArray(toArray(typeJob.publicationReceiptReadiness?.blockedRows || typeJob.contract?.publicationReceiptReadiness?.blockedRows || typeJob.scope?.publicationReceipts?.blockedRows)),
    publicationReceiptPendingRows: freezeArray(toArray(typeJob.publicationReceiptReadiness?.pendingRows || typeJob.contract?.publicationReceiptReadiness?.pendingRows || typeJob.scope?.publicationReceipts?.pendingRows)),
    settingsAdoptionReadiness: typeJob.settingsAdoptionReadiness || typeJob.contract?.settingsAdoptionReadiness || {},
    settingsAdoptionRows: freezeArray(toArray(typeJob.settingsAdoptionReadiness?.rows || typeJob.contract?.settingsAdoptionReadiness?.rows || typeJob.scope?.settingsAdoption?.rows)),
    lifecycleGateReadiness: typeJob.lifecycleGateReadiness || typeJob.contract?.lifecycleGateReadiness || {},
    lifecycleGateRows: freezeArray(toArray(typeJob.lifecycleGateReadiness?.rows || typeJob.contract?.lifecycleGateReadiness?.rows || typeJob.scope?.lifecycleGates?.rows)),
    lifecycleOverrideReceiptRows: freezeArray(toArray(typeJob.lifecycleGateReadiness?.overrideReceiptRows || typeJob.contract?.lifecycleGateReadiness?.overrideReceiptRows)),
    lifecycleOverrideReceiptBlockedRows: freezeArray(toArray(typeJob.lifecycleGateReadiness?.blockedOverrideReceiptRows || typeJob.contract?.lifecycleGateReadiness?.blockedOverrideReceiptRows)),
    providerLeases: persistedState.providerLeases || freezeArray([]),
    persistedRecoveryLedger: persistedState.persistedRecoveryLedger || typeJob.recoveryCommandGraph?.persistedRecoveryLedger || null,
    resumptionJournal: persistedState.resumptionJournal || null,
    resumptionJournalRows: freezeArray(toArray(persistedState.resumptionJournal?.rows)),
    resumptionJournalBlockedRows: freezeArray(toArray(persistedState.resumptionJournal?.blockedRows)),
    resumptionJournalReplayableRows: freezeArray(toArray(persistedState.resumptionJournal?.replayableRows)),
    recoveryCheckpointReadiness: typeJob.recoveryCheckpointReadiness || typeJob.contract?.recoveryCheckpointReadiness || {},
    recoveryCheckpointRows: freezeArray(toArray(
      typeJob.recoveryCheckpointReadiness?.rows
        || persistedState.recoveryCheckpointRows
        || persistedState.recoveryCheckpointManifest?.rows
    )),
    recoveryCheckpointBlockedRows: freezeArray(toArray(
      typeJob.recoveryCheckpointReadiness?.blockedRows
        || persistedState.blockedRecoveryCheckpointRows
        || persistedState.recoveryCheckpointManifest?.blockedRows
    )),
    recoveryCheckpointReplayableRows: freezeArray(toArray(
      typeJob.recoveryCheckpointReadiness?.replayableRows
        || persistedState.replayableRecoveryCheckpointRows
        || persistedState.recoveryCheckpointManifest?.replayableRows
    )),
    persistedRecoveryCommands: freezeArray(toArray(
      persistedState.persistedRecoveryLedger?.commands
        || typeJob.recoveryCommandGraph?.persistedRecoveryLedger?.replayableCommands
        || typeJob.recoveryCommandGraph?.commands
    )),
    tenantBoundaryStatus: tenantBoundary.violations?.length > 0 ? "violated" : "ready",
    adapterStatusReadiness: typeJob.adapterStatusReadiness || typeJob.contract?.adapterStatusReadiness || {},
    adapterHandoffReadiness: typeJob.adapterHandoffReadiness || typeJob.contract?.adapterHandoffReadiness || {},
    adapterHandoffRows: freezeArray(toArray(typeJob.adapterHandoffReadiness?.rows || typeJob.contract?.adapterHandoffReadiness?.rows)),
    adapterHandoffReceiptReadiness: typeJob.adapterHandoffReceiptReadiness || typeJob.contract?.adapterHandoffReceiptReadiness || {},
    adapterHandoffReceiptRows: freezeArray(toArray(typeJob.adapterHandoffReceiptReadiness?.rows || typeJob.contract?.adapterHandoffReceiptReadiness?.rows || typeJob.scope?.adapterHandoffReceipts?.rows)),
    adapterHandoffReceiptBlockedRows: freezeArray(toArray(typeJob.adapterHandoffReceiptReadiness?.blockedRows || typeJob.contract?.adapterHandoffReceiptReadiness?.blockedRows || typeJob.scope?.adapterHandoffReceipts?.blockedRows)),
    workspaceBoundaryReadiness: typeJob.workspaceBoundaryReadiness || typeJob.contract?.workspaceBoundaryReadiness || {},
    workspaceBoundaryRows: freezeArray(toArray(typeJob.workspaceBoundaryReadiness?.rows || typeJob.contract?.workspaceBoundaryReadiness?.rows)),
    workspaceBoundaryQuarantinedRows: freezeArray(toArray(typeJob.workspaceBoundaryReadiness?.quarantinedRows || typeJob.contract?.workspaceBoundaryReadiness?.quarantinedRows)),
    operationIdentityRegistry: typeJob.operationIdentityRegistry || {},
    operationIdentities: freezeArray(toArray(typeJob.operationIdentityRegistry?.rows)),
    clientWorkflow: Object.freeze({
      state: compactString(clientWorkflow.clientWorkflowState || "not-provided"),
      commands: freezeArray(toArray(clientWorkflow.clientWorkflowCommands)),
      blockedCommands: freezeArray(toArray(clientWorkflow.blockedWorkflowCommands)),
      readyCommands: freezeArray(toArray(clientWorkflow.readyWorkflowCommands)),
    }),
    previewDecisionReadiness: clientWorkflow.previewDecisionReadiness || runtimeReadiness.previewDecision || {},
    previewDecisionRows: freezeArray(toArray(clientWorkflow.previewDecisionReadiness?.rows || runtimeReadiness.previewDecision?.rows)),
    previewDecisionBlockedRows: freezeArray(toArray(clientWorkflow.previewDecisionReadiness?.blockedRows || runtimeReadiness.previewDecision?.blockedRows)),
    previewDecisionAcceptanceRows: freezeArray(toArray(clientWorkflow.previewDecisionReadiness?.acceptanceRows || runtimeReadiness.previewDecision?.acceptanceRows)),
    previewAcceptanceReceiptReadiness: typeJob.previewAcceptanceReceiptReadiness
      || clientWorkflow.previewAcceptanceReceiptReadiness
      || runtimeReadiness.previewAcceptanceReceipts
      || {},
    previewAcceptanceReceiptRows: freezeArray(toArray(
      typeJob.previewAcceptanceReceiptReadiness?.rows
        || clientWorkflow.previewAcceptanceReceiptReadiness?.rows
        || runtimeReadiness.previewAcceptanceReceipts?.rows
    )),
    previewAcceptanceReceiptBlockedRows: freezeArray(toArray(
      typeJob.previewAcceptanceReceiptReadiness?.blockedRows
        || clientWorkflow.previewAcceptanceReceiptReadiness?.blockedRows
        || runtimeReadiness.previewAcceptanceReceipts?.blockedRows
    )),
    previewAcceptanceReceiptMissingRows: freezeArray(toArray(
      typeJob.previewAcceptanceReceiptReadiness?.missingRows
        || clientWorkflow.previewAcceptanceReceiptReadiness?.missingRows
        || runtimeReadiness.previewAcceptanceReceipts?.missingRows
    )),
    previewActionPlanReadiness: typeJob.previewActionPlanReadiness
      || clientWorkflow.previewActionPlanReadiness
      || runtimeReadiness.previewActionPlan
      || typeJob.contract?.previewActionPlanReadiness
      || {},
    previewActionPlanRows: freezeArray(toArray(
      typeJob.previewActionPlanReadiness?.rows
        || clientWorkflow.previewActionPlanReadiness?.rows
        || runtimeReadiness.previewActionPlan?.rows
        || typeJob.contract?.previewActionPlanReadiness?.rows
        || typeJob.scope?.previewActionPlan?.rows
    )),
    previewActionPlanBlockedRows: freezeArray(toArray(
      typeJob.previewActionPlanReadiness?.blockedRows
        || clientWorkflow.previewActionPlanReadiness?.blockedRows
        || runtimeReadiness.previewActionPlan?.blockedRows
        || typeJob.contract?.previewActionPlanReadiness?.blockedRows
        || typeJob.scope?.previewActionPlan?.blockedRows
    )),
    previewActionPlanAcceptanceRows: freezeArray(toArray(
      typeJob.previewActionPlanReadiness?.acceptanceRows
        || clientWorkflow.previewActionPlanReadiness?.acceptanceRows
        || runtimeReadiness.previewActionPlan?.acceptanceRows
        || typeJob.contract?.previewActionPlanReadiness?.acceptanceRows
        || typeJob.scope?.previewActionPlan?.acceptanceRows
    )),
    previewRuntimeHandoffReadiness: typeJob.previewRuntimeHandoffReadiness
      || typeJob.contract?.previewRuntimeHandoffReadiness
      || {},
    previewRuntimeHandoffRows: freezeArray(toArray(
      typeJob.previewRuntimeHandoffReadiness?.rows
        || typeJob.contract?.previewRuntimeHandoffReadiness?.rows
        || typeJob.persistedState?.previewRuntimeHandoffRows
        || typeJob.scope?.previewRuntimeHandoff?.rows
    )),
    previewRuntimeHandoffBlockedRows: freezeArray(toArray(
      typeJob.previewRuntimeHandoffReadiness?.blockedRows
        || typeJob.contract?.previewRuntimeHandoffReadiness?.blockedRows
        || typeJob.persistedState?.blockedPreviewRuntimeHandoffRows
        || typeJob.scope?.previewRuntimeHandoff?.blockedRows
    )),
    clientCommandReceiptReadiness: typeJob.clientCommandReceiptReadiness
      || clientWorkflow.clientCommandReceiptReadiness
      || runtimeReadiness.clientCommandReceipts
      || {},
    clientCommandReceiptRows: freezeArray(toArray(
      typeJob.clientCommandReceiptReadiness?.rows
        || clientWorkflow.clientCommandReceiptReadiness?.rows
        || typeJob.persistedState?.clientCommandReceipts
    )),
    clientCommandReceiptBlockedRows: freezeArray(toArray(
      typeJob.clientCommandReceiptReadiness?.blockedRows
        || clientWorkflow.clientCommandReceiptReadiness?.blockedRows
        || typeJob.persistedState?.blockedClientCommandReceipts
    )),
    permissionBoundary,
    permissionPosture,
    boundaryHealth,
    runtimeReadiness,
  });
}

function workflowCommandsForAction(action, principal = {}, usageRecord = { steps: new Set() }) {
  const rawSteps = usageRecord.steps instanceof Set ? [...usageRecord.steps] : toArray(usageRecord.steps);
  const steps = new Set(rawSteps.map(compactString).filter(Boolean));
  return toArray(principal.clientWorkflow?.commands).filter((command) => {
    const capability = compactString(command.capability);
    const stepName = compactString(command.stepName);
    return capability === action || (stepName && steps.has(stepName));
  });
}

function createCapabilityWorkflowGate(action, principal = {}, usageRecord = { steps: new Set() }) {
  const commands = workflowCommandsForAction(action, principal, usageRecord);
  const previewDecision = findPreviewDecisionRow(action, principal, usageRecord);
  const previewReceipt = findPreviewAcceptanceReceiptRow(action, principal, usageRecord);
  const commandReceipt = findClientCommandReceiptRow(action, principal, usageRecord);
  const globalBlocked = toArray(principal.clientWorkflow?.blockedCommands).filter((command) => {
    const capability = compactString(command.capability);
    const stepName = compactString(command.stepName);
    return !capability && !stepName;
  });
  const relevant = commands.length > 0 ? commands : globalBlocked;
  const blocked = relevant.filter((command) => command.state === "blocked" || command.state === "needs-input" || command.userVisible?.blocking === true);
  const ready = relevant.filter((command) => command.state === "ready" || command.state === "runnable");
  const previewBlocked = previewDecision?.state === "blocked";
  const previewWaiting = previewDecision?.state === "ready-for-acceptance" || previewDecision?.state === "needs-client-runtime";
  const receiptBlocked = ["rejected", "expired"].includes(compactString(previewReceipt?.state));
  const receiptWaiting = ["missing", "pending", "needs-acceptance"].includes(compactString(previewReceipt?.state))
    || principal.previewAcceptanceReceiptReadiness?.state === "needs-acceptance";
  const commandReceiptBlocked = compactString(commandReceipt?.state) === "blocked";
  const state = previewBlocked || blocked.length > 0
    ? "blocked"
    : commandReceiptBlocked
      ? "client-command-receipt-blocked"
    : receiptBlocked
      ? "preview-acceptance-blocked"
      : receiptWaiting
        ? "needs-preview-acceptance-receipt"
    : previewWaiting
      ? "needs-preview-acceptance"
      : ready.length > 0
      ? "ready"
      : principal.clientWorkflow?.state === "blocked"
        ? "blocked-global"
        : "not-required";

  return Object.freeze({
    protocol: "aios.capability.client-workflow-gate.v1",
    action,
    state,
    acceptedForAdapter: state === "ready" || state === "not-required",
    commands: freezeArray(relevant.map((command) => ({
      command: compactString(command.command),
      commandId: compactString(command.commandId),
      phase: compactString(command.phase),
      state: compactString(command.state),
      nextCommand: compactString(command.nextCommand || command.command),
      reason: compactString(command.reason),
      statusChannel: compactString(command.statusChannel),
      statusSnapshotKey: compactString(command.statusSnapshotKey),
      idempotencyKey: compactString(command.idempotencyKey),
    }))),
    blockedCommands: freezeArray(blocked.map((command) => ({
      command: compactString(command.command),
      nextCommand: compactString(command.nextCommand || command.command),
      reason: compactString(command.reason),
    }))),
    previewDecision: previewDecision ? Object.freeze({
      rowId: compactString(previewDecision.rowId),
      state: compactString(previewDecision.state),
      lane: compactString(previewDecision.lane),
      command: compactString(previewDecision.command),
      nextCommand: compactString(previewDecision.nextCommand || previewDecision.command || "observe"),
      acceptanceToken: compactString(previewDecision.acceptanceToken),
      missing: freezeArray(toArray(previewDecision.missing).map(compactString).filter(Boolean)),
      userVisible: previewDecision.userVisible || Object.freeze({
        label: action,
        blocking: previewBlocked,
        summary: "",
      }),
    }) : null,
    previewAcceptanceReceipt: previewReceipt ? Object.freeze({
      rowId: compactString(previewReceipt.rowId),
      state: compactString(previewReceipt.state),
      receiptToken: compactString(previewReceipt.receiptToken),
      acceptanceToken: compactString(previewReceipt.acceptanceToken),
      acceptedBy: compactString(previewReceipt.acceptedBy),
      acceptedAt: compactString(previewReceipt.acceptedAt),
      expiresAt: compactString(previewReceipt.expiresAt),
      missing: freezeArray(toArray(previewReceipt.missing).map(compactString).filter(Boolean)),
      nextCommand: compactString(previewReceipt.nextCommand || "accept_scope_preview_row"),
    }) : null,
    clientCommandReceipt: commandReceipt ? Object.freeze({
      rowId: compactString(commandReceipt.rowId),
      command: compactString(commandReceipt.command),
      commandId: compactString(commandReceipt.commandId),
      phase: compactString(commandReceipt.phase),
      state: compactString(commandReceipt.state),
      receiptToken: compactString(commandReceipt.receiptToken),
      receiptStatus: compactString(commandReceipt.receiptStatus),
      acceptedAt: compactString(commandReceipt.acceptedAt),
      expiresAt: compactString(commandReceipt.expiresAt),
      missing: freezeArray(toArray(commandReceipt.missing).map(compactString).filter(Boolean)),
      nextCommand: compactString(commandReceipt.nextCommand || "attach_client_command_receipt"),
    }) : null,
    readyCommands: freezeArray(ready.map((command) => ({
      command: compactString(command.command),
      commandId: compactString(command.commandId),
      nextCommand: compactString(command.nextCommand || command.command),
    }))),
    nextCommand: receiptBlocked || receiptWaiting
      ? previewReceipt?.nextCommand || principal.previewAcceptanceReceiptReadiness?.nextStep?.command || "accept_scope_preview_row"
      : commandReceiptBlocked
      ? commandReceipt.nextCommand || principal.clientCommandReceiptReadiness?.nextStep?.command || "attach_client_command_receipt"
      : previewBlocked || previewWaiting
      ? previewDecision.nextCommand || previewDecision.command || "resolve_scope_preview"
      : blocked[0]?.nextCommand || ready[0]?.nextCommand || "observe",
  });
}

function findScopeBoundaryCapability(action, principal = {}) {
  return toArray(principal.permissionBoundary?.capabilities)
    .find((capability) => compactString(capability.action) === action) || null;
}

function findPermissionPostureRow(action, principal = {}) {
  return toArray(principal.permissionPosture?.rows)
    .find((row) => compactString(row.action) === action) || null;
}

function findAdapterStatusForAction(action, principal = {}, usageRecord = { steps: new Set() }) {
  const latest = toArray(principal.adapterStatusReadiness?.latestByCapability);
  const steps = new Set([...usageRecord.steps].map(compactString).filter(Boolean));
  return latest.find((row) => compactString(row.capability) === action)
    || latest.find((row) => steps.has(compactString(row.stepName)))
    || null;
}

function findSnapshotRowForAction(action, principal = {}, usageRecord = { steps: new Set() }) {
  const steps = new Set([...usageRecord.steps].map(compactString).filter(Boolean));
  const rows = [
    ...toArray(principal.adapterStatusSnapshotRows),
    ...toArray(principal.blockedAdapterStatusSnapshotRows),
  ];
  return rows.find((row) => compactString(row.capability) === action)
    || rows.find((row) => steps.has(compactString(row.stepName)))
    || null;
}

function findProviderSyncScopeRow(action, principal = {}) {
  return toArray(principal.providerSyncScopeRows)
    .find((row) => compactString(row.action) === action) || null;
}

function findSegmentSyncReceiptRow(action, principal = {}) {
  return toArray(principal.segmentSyncReceiptRows)
    .find((row) => compactString(row.action) === action) || null;
}

function findProviderBudgetRow(action, principal = {}) {
  return toArray(principal.providerBudgetRows)
    .find((row) => compactString(row.action) === action) || null;
}

function findProviderCallbackRow(action, principal = {}) {
  return toArray(principal.providerCallbackRows)
    .find((row) => compactString(row.action) === action) || null;
}

function findProviderEventSubscriptionRow(action, principal = {}) {
  return toArray(principal.providerEventSubscriptionRows)
    .find((row) => compactString(row.action) === action) || null;
}

function findProviderMaintenanceRow(action, principal = {}) {
  return toArray(principal.providerMaintenanceRows)
    .find((row) => compactString(row.action) === action) || null;
}

function findProviderExportBoundaryRow(action, principal = {}) {
  return toArray(principal.providerExportBoundaryRows)
    .find((row) => compactString(row.action) === action)
    || toArray(principal.providerExportBoundaryBlockedRows)
      .find((row) => compactString(row.action) === action)
    || null;
}

function findProviderExportPublicationRow(action, principal = {}) {
  const publication = principal.providerExportPublication || {};
  return toArray(publication.publishableRows)
    .find((row) => compactString(row.action) === action)
    || toArray(publication.blockedRows)
      .find((row) => compactString(row.action) === action)
    || null;
}

function findSettingsAdoptionRow(action, principal = {}) {
  return toArray(principal.settingsAdoptionRows)
    .find((row) => compactString(row.action) === action) || null;
}

function findLifecycleGateRow(action, principal = {}) {
  return toArray(principal.lifecycleGateRows)
    .find((row) => compactString(row.action) === action) || null;
}

function findAdapterHandoffRow(action, principal = {}) {
  return toArray(principal.adapterHandoffRows)
    .find((row) => compactString(row.action) === action) || null;
}

function findAdapterHandoffReceiptRow(action, principal = {}, usageRecord = { steps: new Set() }) {
  const steps = new Set([...(usageRecord.steps instanceof Set ? usageRecord.steps : new Set(toArray(usageRecord.steps)))]
    .map(compactString)
    .filter(Boolean));
  const rows = [
    ...toArray(principal.adapterHandoffReceiptRows),
    ...toArray(principal.adapterHandoffReceiptBlockedRows),
  ];
  return rows.find((row) => compactString(row.action) === action)
    || rows.find((row) => steps.has(compactString(row.stepName)))
    || null;
}

function findWorkspaceBoundaryRow(action, principal = {}) {
  return toArray(principal.workspaceBoundaryRows)
    .find((row) => compactString(row.action) === action)
    || toArray(principal.workspaceBoundaryQuarantinedRows)
      .find((row) => compactString(row.action) === action)
    || null;
}

function findOperationIdentity(action, principal = {}, usageRecord = { steps: new Set() }) {
  const steps = new Set([...(usageRecord.steps instanceof Set ? usageRecord.steps : new Set(toArray(usageRecord.steps)))]
    .map(compactString)
    .filter(Boolean));
  return toArray(principal.operationIdentities)
    .find((row) => compactString(row.action) === action)
    || toArray(principal.operationIdentities)
      .find((row) => toArray(row.stepNames).some((stepName) => steps.has(compactString(stepName))))
    || null;
}

function findPersistedRecoveryCommand(action, principal = {}, usageRecord = { steps: new Set() }) {
  const steps = new Set([...(usageRecord.steps instanceof Set ? usageRecord.steps : new Set(toArray(usageRecord.steps)))]
    .map(compactString)
    .filter(Boolean));
  const commands = toArray(principal.persistedRecoveryCommands);
  return commands.find((command) => compactString(command.capability) === action)
    || commands.find((command) => steps.has(compactString(command.stepName)))
    || commands.find((command) => !command.capability && !command.stepName && compactString(command.phase) === "runtime-handoff")
    || null;
}

function findResumptionJournalRow(action, principal = {}, usageRecord = { steps: new Set() }) {
  const steps = new Set([...(usageRecord.steps instanceof Set ? usageRecord.steps : new Set(toArray(usageRecord.steps)))]
    .map(compactString)
    .filter(Boolean));
  const rows = [
    ...toArray(principal.resumptionJournalRows),
    ...toArray(principal.resumptionJournalBlockedRows),
    ...toArray(principal.resumptionJournalReplayableRows),
  ];
  return rows.find((row) => compactString(row.capability) === action)
    || rows.find((row) => steps.has(compactString(row.stepName)))
    || rows.find((row) => !row.capability && !row.stepName && compactString(row.phase) === "adapter")
    || null;
}

function findRecoveryCheckpointRow(action, principal = {}, usageRecord = { steps: new Set() }) {
  const steps = new Set([...(usageRecord.steps instanceof Set ? usageRecord.steps : new Set(toArray(usageRecord.steps)))]
    .map(compactString)
    .filter(Boolean));
  const rows = [
    ...toArray(principal.recoveryCheckpointBlockedRows),
    ...toArray(principal.recoveryCheckpointRows),
    ...toArray(principal.recoveryCheckpointReplayableRows),
  ];
  return rows.find((row) => compactString(row.action) === action)
    || rows.find((row) => toArray(row.stepNames).some((stepName) => steps.has(compactString(stepName))))
    || null;
}

function findPreviewDecisionRow(action, principal = {}, usageRecord = { steps: new Set() }) {
  const steps = new Set([...(usageRecord.steps instanceof Set ? usageRecord.steps : new Set(toArray(usageRecord.steps)))]
    .map(compactString)
    .filter(Boolean));
  const rows = [
    ...toArray(principal.previewDecisionRows),
    ...toArray(principal.previewDecisionBlockedRows),
    ...toArray(principal.previewDecisionAcceptanceRows),
  ];
  return rows.find((row) => compactString(row.name) === action)
    || rows.find((row) => steps.has(compactString(row.name)))
    || null;
}

function findPreviewAcceptanceReceiptRow(action, principal = {}, usageRecord = { steps: new Set() }) {
  const steps = new Set([...(usageRecord.steps instanceof Set ? usageRecord.steps : new Set(toArray(usageRecord.steps)))]
    .map(compactString)
    .filter(Boolean));
  const rows = [
    ...toArray(principal.previewAcceptanceReceiptRows),
    ...toArray(principal.previewAcceptanceReceiptBlockedRows),
    ...toArray(principal.previewAcceptanceReceiptMissingRows),
  ];
  return rows.find((row) => compactString(row.name) === action)
    || rows.find((row) => steps.has(compactString(row.name)))
    || null;
}

function findPreviewRuntimeHandoffRow(action, principal = {}, usageRecord = { steps: new Set() }) {
  const steps = new Set([...(usageRecord.steps instanceof Set ? usageRecord.steps : new Set(toArray(usageRecord.steps)))]
    .map(compactString)
    .filter(Boolean));
  const rows = [
    ...toArray(principal.previewRuntimeHandoffRows),
    ...toArray(principal.previewRuntimeHandoffBlockedRows),
  ];
  return rows.find((row) => compactString(row.name) === action || compactString(row.capability) === action)
    || rows.find((row) => steps.has(compactString(row.name)) || steps.has(compactString(row.stepName)))
    || null;
}

function findPreviewActionPlanRow(action, principal = {}, usageRecord = { steps: new Set() }) {
  const steps = new Set([...(usageRecord.steps instanceof Set ? usageRecord.steps : new Set(toArray(usageRecord.steps)))]
    .map(compactString)
    .filter(Boolean));
  const rows = [
    ...toArray(principal.previewActionPlanBlockedRows),
    ...toArray(principal.previewActionPlanAcceptanceRows),
    ...toArray(principal.previewActionPlanRows),
  ];
  return rows.find((row) => compactString(row.name) === action || compactString(row.capability) === action)
    || rows.find((row) => steps.has(compactString(row.name)) || steps.has(compactString(row.stepName)))
    || null;
}

function findClientCommandReceiptRow(action, principal = {}, usageRecord = { steps: new Set() }) {
  const steps = new Set([...(usageRecord.steps instanceof Set ? usageRecord.steps : new Set(toArray(usageRecord.steps)))]
    .map(compactString)
    .filter(Boolean));
  const rows = [
    ...toArray(principal.clientCommandReceiptRows),
    ...toArray(principal.clientCommandReceiptBlockedRows),
  ];
  return rows.find((row) => compactString(row.capability) === action)
    || rows.find((row) => steps.has(compactString(row.stepName)))
    || rows.find((row) => !row.capability && !row.stepName && compactString(row.phase) === "adapter-handoff")
    || null;
}

function createCapabilityStatusReconciliation(action, principal = {}, usageRecord = { steps: new Set() }) {
  const readiness = principal.adapterStatusReadiness || {};
  const row = findAdapterStatusForAction(action, principal, usageRecord);
  const snapshotRow = findSnapshotRowForAction(action, principal, usageRecord);
  const failures = toArray(readiness.failures).filter((failure) => {
    return compactString(failure.capability) === action || usageRecord.steps?.has?.(compactString(failure.stepName));
  });
  const state = failures.length > 0
    ? compactString(failures[0].state || "failed")
    : snapshotRow?.missing?.length > 0 || snapshotRow?.persisted === false
      ? "snapshot-blocked"
    : row?.state === "succeeded"
      ? "succeeded"
      : row?.state === "pending"
        ? "pending"
        : readiness.state === "needs-status-snapshot"
          ? "missing-status"
          : readiness.state === "waiting-adapter"
            ? "pending"
            : readiness.state === "blocked"
              ? "failed"
              : row
                ? compactString(row.state || "unknown")
                : "unobserved";
  const terminal = ["succeeded", "failed", "timed-out", "cancelled"].includes(state);

  return Object.freeze({
    protocol: "aios.capability.status-reconciliation.v1",
    action,
    state,
    terminal,
    acceptedForRetry: ["failed", "timed-out", "missing-status", "snapshot-blocked", "unobserved"].includes(state),
    acceptedForAdapter: !["failed", "timed-out", "cancelled", "missing-status", "snapshot-blocked"].includes(state),
    statusChannel: compactString(readiness.statusChannel || principal.statusChannel),
    statusSnapshotKey: compactString(snapshotRow?.statusSnapshotKey || row?.statusSnapshotKey || readiness.statusSnapshotKey || principal.statusSnapshotKey),
    providerRequestId: compactString(row?.providerRequestId),
    idempotencyKey: compactString(snapshotRow?.idempotencyKey || row?.idempotencyKey),
    snapshotRowKey: compactString(snapshotRow?.rowKey),
    snapshotMissing: freezeArray(toArray(snapshotRow?.missing).map(compactString).filter(Boolean)),
    retryAfterMs: Number.isFinite(Number(row?.retryAfterMs)) ? Number(row.retryAfterMs) : 0,
    message: compactString(failures[0]?.message || row?.message),
    nextCommand: failures[0]?.nextCommand
      || (state === "snapshot-blocked" ? snapshotRow?.nextCommand || "materialize_adapter_status_snapshot" : "")
      || (state === "missing-status" ? "load_adapter_status_snapshot" : "")
      || (state === "pending" ? "poll_adapter_status_channel" : "")
      || (state === "failed" ? "inspect_adapter_failure" : "")
      || (state === "unobserved" && readiness.counters?.expected > 0 ? "load_adapter_status_snapshot" : "observe"),
  });
}

function createBoundaryDecision(action, provider, principal, capability = {}) {
  const scopedBoundary = findScopeBoundaryCapability(action, principal);
  const postureRow = findPermissionPostureRow(action, principal);
  const workspaceBoundary = findWorkspaceBoundaryRow(action, principal);
  const workspaceQuarantined = workspaceBoundary?.state === "quarantined"
    || toArray(workspaceBoundary?.blockedBy).length > 0
    || principal.workspaceBoundaryReadiness?.state === "quarantined";
  if (scopedBoundary) {
    const leaseRecovery = scopedBoundary.leaseRecovery || null;
    return Object.freeze({
      requiredPermission: compactString(scopedBoundary.requiredPermission),
      permissionKnown: Boolean(scopedBoundary.requiredPermission),
      permissionGranted: !toArray(scopedBoundary.reasons).some((reason) => compactString(reason).startsWith("missing-permission:")),
      tenantIsolated: !toArray(scopedBoundary.reasons).some((reason) => [
        "missing-tenant",
        "missing-workspace",
        "tenant-mismatch",
        "workspace-mismatch",
      ].includes(compactString(reason))),
      tenantId: principal.tenantId,
      workspaceId: principal.workspaceId,
      actorId: principal.actorId,
      permissionLease: scopedBoundary.permissionLease || null,
      leaseRecovery,
      leaseRequired: scopedBoundary.leaseRequired === true,
      leaseState: toArray(scopedBoundary.reasons).some((reason) => compactString(reason).includes("permission-lease"))
        ? "blocked"
        : scopedBoundary.leaseRequired === true
          ? "ready"
          : "not-required",
      workspaceBoundary: workspaceBoundary ? Object.freeze({
        rowId: compactString(workspaceBoundary.rowId),
        state: compactString(workspaceBoundary.state),
        transferToken: compactString(workspaceBoundary.transferToken),
        approvalState: compactString(workspaceBoundary.approvalState || workspaceBoundary.approval?.state || "not-required"),
        blockedBy: freezeArray(toArray(workspaceBoundary.blockedBy).map(compactString).filter(Boolean)),
        nextCommand: compactString(workspaceBoundary.nextCommand || principal.workspaceBoundaryReadiness?.nextStep?.command || "observe"),
      }) : null,
      permissionPosture: postureRow ? Object.freeze({
        rowId: compactString(postureRow.rowId),
        state: compactString(postureRow.state),
        fingerprint: compactString(principal.permissionPosture?.fingerprint),
        grantedByRole: postureRow.grantedByRole === true,
        explicitGrant: postureRow.explicitGrant === true,
        leaseState: compactString(postureRow.leaseState || "not-required"),
        nextCommand: compactString(postureRow.nextCommand || "observe"),
      }) : null,
      decision: scopedBoundary.decision === "allow" && !workspaceQuarantined && !postureRow?.state?.endsWith?.("blocked") ? "allow" : "hold",
      reasons: freezeArray([
        ...toArray(scopedBoundary.reasons).map(compactString).filter(Boolean),
        postureRow && postureRow.state !== "covered" && `permission-posture:${postureRow.state}`,
        workspaceQuarantined && "workspace-boundary-quarantined",
        ...toArray(workspaceBoundary?.blockedBy).map((reason) => `workspace:${reason}`),
      ].filter(Boolean)),
      source: "scope-permission-boundary",
    });
  }

  const requiredPermission = compactString(capability.permission || capability.requiredPermission || requiredPermissionForAction(action));
  const explicitGrant = toArray(capability.grants || capability.permissions).map(normalizePermission).filter(Boolean);
  const available = new Set([
    ...principal.permissions,
    ...explicitGrant,
    ...principal.roles.map((role) => `role:${role}`),
  ]);
  const sameTenant = firstString(capability.tenantId, principal.tenantId) === principal.tenantId;
  const sameWorkspace = firstString(capability.workspaceId, principal.workspaceId) === principal.workspaceId;
  const permissionKnown = Boolean(requiredPermission) && (principal.permissions.length > 0 || explicitGrant.length > 0 || principal.roles.length > 0);
  const permissionGranted = !permissionKnown || available.has(normalizePermission(requiredPermission)) || available.has("mailchimp.*") || available.has("admin");
  const tenantIsolated = provider !== "mailchimp" || (Boolean(principal.tenantId) && Boolean(principal.workspaceId) && sameTenant && sameWorkspace);
  const providerLease = toArray(principal.providerLeases).find((lease) => lease.capability === action) || null;
  const leaseRequired = provider === "mailchimp" && WRITE_ACTION_PATTERN.test(action) && capability.requiresLease !== false;
  const leaseReady = !leaseRequired || providerLease?.leaseState === "ready";
  const leaseRecovery = leaseRequired ? Object.freeze({
    protocol: "aios.capability.permission-lease-recovery.v1",
    action,
    requiredPermission,
    state: leaseReady ? "ready" : "blocked",
    ready: leaseReady,
    reasons: freezeArray(leaseReady ? [] : ["missing"]),
    nextCommand: leaseReady ? "observe" : "refresh_mailchimp_permission_lease",
    retryAfterMs: leaseReady ? 0 : 1000,
    backoff: Object.freeze({
      strategy: leaseReady ? "none" : "bounded-refresh",
      baseDelayMs: leaseReady ? 0 : 1000,
      maxDelayMs: leaseReady ? 0 : 60000,
      jitter: !leaseReady,
    }),
    handoff: Object.freeze({
      statusChannel: compactString(principal.statusChannel),
      leaseToken: compactString(providerLease?.lease?.token),
      expiresAt: compactString(providerLease?.lease?.expiresAt),
      refreshCommand: leaseReady ? "observe" : "refresh_mailchimp_permission_lease",
    }),
  }) : null;

  return Object.freeze({
    requiredPermission,
    permissionKnown,
    permissionGranted,
    tenantIsolated,
    tenantId: principal.tenantId,
    workspaceId: principal.workspaceId,
    actorId: principal.actorId,
    permissionLease: providerLease?.lease || null,
    leaseRecovery,
    leaseRequired,
    leaseState: leaseRequired ? providerLease?.leaseState || "blocked" : "not-required",
    workspaceBoundary: workspaceBoundary ? Object.freeze({
      rowId: compactString(workspaceBoundary.rowId),
      state: compactString(workspaceBoundary.state),
      transferToken: compactString(workspaceBoundary.transferToken),
      approvalState: compactString(workspaceBoundary.approvalState || workspaceBoundary.approval?.state || "not-required"),
      blockedBy: freezeArray(toArray(workspaceBoundary.blockedBy).map(compactString).filter(Boolean)),
      nextCommand: compactString(workspaceBoundary.nextCommand || principal.workspaceBoundaryReadiness?.nextStep?.command || "observe"),
    }) : null,
    decision: tenantIsolated && permissionGranted && leaseReady && !workspaceQuarantined ? "allow" : "hold",
    reasons: freezeArray([
      !tenantIsolated && "tenant-workspace-boundary-missing",
      workspaceQuarantined && "workspace-boundary-quarantined",
      ...toArray(workspaceBoundary?.blockedBy).map((reason) => `workspace:${reason}`),
      permissionKnown && !permissionGranted && requiredPermission && `missing-permission:${requiredPermission}`,
      leaseRequired && !leaseReady && "missing-permission-lease",
    ].filter(Boolean)),
    source: "capability-analysis",
  });
}

function collectStepUsage(job = {}) {
  const usage = new Map();
  for (const step of toArray(job.steps)) {
    const stepName = compactString(step.name || step.id || "step");
    const capabilityRefs = toArray(step.capability || step.capabilities || step.requiresCapability).map(compactString).filter(Boolean);
    for (const capabilityName of capabilityRefs) {
      const current = usage.get(capabilityName) || { reads: new Set(), writes: new Set(), steps: new Set() };
      for (const memoryName of toArray(step.memoryReads || step.reads)) current.reads.add(compactString(memoryName));
      for (const memoryName of toArray(step.memoryWrites || step.writes || step.output)) current.writes.add(compactString(memoryName));
      current.steps.add(stepName);
      usage.set(capabilityName, current);
    }
  }
  return usage;
}

function createCapabilityAcceptanceState(capability = {}, action, principal = {}, requiresApproval = false) {
  const acceptance = capability.acceptance || capability.approval || capability.operatorApproval || {};
  const acceptedActions = new Set(toArray(principal.acceptedActions).map(compactString).filter(Boolean));
  const rejectedActions = new Set(toArray(principal.rejectedActions).map(compactString).filter(Boolean));
  const evidenceRefs = toArray(
    acceptance.evidence
      || acceptance.evidenceRefs
      || capability.evidence
      || capability.verifierEvidence
  ).map(compactString).filter(Boolean).sort();
  const acceptedBy = firstString(acceptance.acceptedBy, acceptance.approvedBy, capability.acceptedBy, capability.approvedBy);
  const acceptedAt = firstString(acceptance.acceptedAt, acceptance.approvedAt, capability.acceptedAt, capability.approvedAt);
  const rejectedBy = firstString(acceptance.rejectedBy, capability.rejectedBy);
  const rejectedAt = firstString(acceptance.rejectedAt, capability.rejectedAt);
  const expiresAt = firstString(acceptance.expiresAt, capability.acceptanceExpiresAt);
  const explicitState = compactString(acceptance.state || capability.acceptanceState).toLowerCase();
  const token = firstString(
    acceptance.token,
    acceptance.acceptanceToken,
    capability.acceptanceToken,
    requiresApproval ? stableContractToken("accept", [principal.tenantId, principal.workspaceId, principal.requestId, action]) : ""
  );
  const rejected = explicitState === "rejected" || acceptance.rejected === true || rejectedActions.has(action);
  const accepted = !rejected && (
    explicitState === "accepted"
      || acceptance.accepted === true
      || acceptance.approved === true
      || acceptedActions.has(action)
      || (Boolean(acceptedBy) && Boolean(acceptedAt))
  );
  const missing = [
    requiresApproval && !accepted && !rejected && !acceptedBy && "acceptedBy",
    requiresApproval && !accepted && !rejected && !acceptedAt && "acceptedAt",
    requiresApproval && !accepted && !rejected && evidenceRefs.length === 0 && "evidence",
  ].filter(Boolean);
  const state = !requiresApproval
    ? "not-required"
    : rejected
      ? "rejected"
      : accepted
        ? "accepted"
        : "pending";

  return Object.freeze({
    protocol: "aios.capability.operator-acceptance.v1",
    required: requiresApproval,
    state,
    accepted: state === "accepted" || state === "not-required",
    token,
    acceptedBy,
    acceptedAt,
    rejectedBy,
    rejectedAt,
    expiresAt,
    evidenceRefs: freezeArray(evidenceRefs),
    missing: freezeArray(missing),
    nextCommand: state === "rejected"
      ? "revise_or_cancel_provider_action"
      : state === "pending"
        ? "collect_verifier_evidence"
        : "observe",
    userVisible: Object.freeze({
      label: state === "not-required"
        ? "No operator approval required"
        : state === "accepted"
          ? "Operator approval accepted"
          : state === "rejected"
            ? "Operator approval rejected"
            : "Operator approval required",
      blocking: state === "pending" || state === "rejected",
      evidenceRequired: requiresApproval && evidenceRefs.length === 0,
    }),
  });
}

function createCapabilityHealthProfile(action, provider, principal, boundaryDecision, effects, requiresApproval, acceptance = null, statusReconciliation = null, workflowGate = null, adapterHandoffRow = null, operationIdentity = null, providerBudgetRow = null, providerCallbackRow = null, providerExportBoundaryRow = null, providerMaintenanceRow = null, providerEventSubscriptionRow = null, adapterHandoffReceiptRow = null, recoveryCheckpointRow = null) {
  const held = boundaryDecision.decision === "hold";
  const externalWrite = effects.externalWrite;
  const hasStatusSnapshot = Boolean(principal.statusSnapshotKey);
  const retryable = !held && externalWrite;
  const backoffSeed = action.includes("schedule") || action.includes("send") ? 5000 : 1000;
  const approvalPending = requiresApproval && acceptance?.state === "pending";
  const approvalRejected = requiresApproval && acceptance?.state === "rejected";
  const providerFailed = ["failed", "timed-out", "cancelled"].includes(statusReconciliation?.state);
  const providerMissing = statusReconciliation?.state === "missing-status";
  const snapshotBlocked = statusReconciliation?.state === "snapshot-blocked";
  const workflowBlocked = workflowGate?.state === "blocked" || workflowGate?.state === "blocked-global" || workflowGate?.state === "needs-preview-acceptance";
  const clientCommandReceiptBlocked = workflowGate?.state === "client-command-receipt-blocked";
  const handoffBlocked = adapterHandoffRow?.state === "blocked";
  const handoffWaiting = adapterHandoffRow?.state === "waiting";
  const handoffReceiptBlocked = adapterHandoffReceiptRow?.state === "blocked";
  const handoffReceiptAccepted = adapterHandoffReceiptRow?.state === "accepted";
  const providerBudgetBlocked = providerBudgetRow?.state === "blocked";
  const providerBudgetThrottled = providerBudgetRow?.state === "degraded" || providerBudgetRow?.state === "throttled";
  const providerCallbackBlocked = providerCallbackRow?.state === "blocked";
  const providerCallbackPending = providerCallbackRow?.state === "pending-verification";
  const providerEventSubscriptionBlocked = providerEventSubscriptionRow?.state === "blocked" || providerEventSubscriptionRow?.state === "missing-subscription";
  const providerEventSubscriptionPending = providerEventSubscriptionRow?.state === "pending";
  const providerMaintenanceBlocked = providerMaintenanceRow?.state === "blocked";
  const providerMaintenanceDegraded = providerMaintenanceRow?.state === "degraded";
  const providerServiceUnavailable = toArray(providerMaintenanceRow?.blockedBy)
    .some((reason) => compactString(reason).startsWith("provider-service-"));
  const providerServiceDegraded = providerMaintenanceRow?.serviceWindow?.state === "degraded";
  const providerExportBlocked = providerExportBoundaryRow?.exportable === false
    || providerExportBoundaryRow?.state === "blocked"
    || toArray(providerExportBoundaryRow?.blockedBy).length > 0;
  const providerExportRetryable = providerExportBoundaryRow?.retryable === true;
  const operationMissing = provider === "mailchimp" && externalWrite && !operationIdentity;
  const operationBlocked = operationIdentity?.state === "blocked" || toArray(operationIdentity?.missing).length > 0;
  const recoveryCheckpointBlocked = recoveryCheckpointRow?.state === "blocked" || toArray(recoveryCheckpointRow?.missing).length > 0;
  const recoveryCheckpointWaiting = recoveryCheckpointRow?.state === "waiting-adapter";
  const recoveryCheckpointReplayable = recoveryCheckpointRow?.safeToReplay === true || recoveryCheckpointRow?.state === "replayable";
  const leaseBlocked = toArray(boundaryDecision.reasons).some((reason) => compactString(reason).includes("permission-lease"));
  const workspaceBlocked = toArray(boundaryDecision.reasons).some((reason) => compactString(reason).includes("workspace-boundary"));
  const leaseRecovery = boundaryDecision.leaseRecovery || null;
  const leaseRefreshReady = leaseBlocked && leaseRecovery?.state === "blocked";

  return Object.freeze({
    protocol: "aios.capability.health-profile.v1",
    state: held || approvalRejected || providerFailed || workflowBlocked || clientCommandReceiptBlocked || leaseBlocked || handoffBlocked || handoffReceiptBlocked || providerBudgetBlocked || providerCallbackBlocked || providerEventSubscriptionBlocked || providerMaintenanceBlocked || providerExportBlocked || operationMissing || operationBlocked || recoveryCheckpointBlocked
      ? "blocked"
      : providerMissing || snapshotBlocked || handoffWaiting || providerBudgetThrottled || providerCallbackPending || providerEventSubscriptionPending || providerMaintenanceDegraded || recoveryCheckpointWaiting
        ? "degraded-status-missing"
      : approvalPending
        ? "waiting-for-approval"
        : externalWrite
          ? hasStatusSnapshot ? "adapter-ready" : "degraded-no-status-snapshot"
          : "healthy",
    degradedMode: operationMissing || operationBlocked
      ? "operation-identity"
      : recoveryCheckpointBlocked
        ? "recovery-checkpoint"
      : leaseBlocked
      ? "permission-lease-refresh"
      : workspaceBlocked
        ? "workspace-boundary-quarantine"
      : handoffBlocked
        ? "adapter-handoff-manifest"
      : handoffReceiptBlocked
        ? "adapter-handoff-receipt"
      : providerBudgetBlocked || providerBudgetThrottled
        ? "provider-budget"
      : providerCallbackBlocked || providerCallbackPending
        ? "provider-callback"
      : providerEventSubscriptionBlocked || providerEventSubscriptionPending
        ? "provider-event-subscription"
      : providerMaintenanceBlocked || providerMaintenanceDegraded
        ? "provider-maintenance"
      : providerExportBlocked
        ? "provider-export-boundary"
      : clientCommandReceiptBlocked
        ? "client-command-receipt"
      : held || approvalRejected || providerFailed || workflowBlocked
      ? "boundary-review"
      : snapshotBlocked
        ? "adapter-status-snapshot-materialization"
      : recoveryCheckpointWaiting
        ? "recovery-checkpoint-waiting"
      : providerMissing
        ? "adapter-status-reconciliation"
      : externalWrite && !hasStatusSnapshot
        ? "status-snapshot-required"
        : "none",
    statusSnapshotKey: principal.statusSnapshotKey,
    recoveryCheckpoint: recoveryCheckpointRow ? Object.freeze({
      rowId: compactString(recoveryCheckpointRow.rowId),
      action: compactString(recoveryCheckpointRow.action),
      state: compactString(recoveryCheckpointRow.state),
      commandId: compactString(recoveryCheckpointRow.commandId),
      replayKey: compactString(recoveryCheckpointRow.replayKey),
      safeToReplay: recoveryCheckpointReplayable,
      missing: freezeArray(toArray(recoveryCheckpointRow.missing).map(compactString).filter(Boolean)),
      nextCommand: compactString(recoveryCheckpointRow.nextCommand || "observe"),
    }) : null,
    adapterHandoffReceipt: adapterHandoffReceiptRow ? Object.freeze({
      action: compactString(adapterHandoffReceiptRow.action),
      state: compactString(adapterHandoffReceiptRow.state),
      commandId: compactString(adapterHandoffReceiptRow.commandId),
      receiptToken: compactString(adapterHandoffReceiptRow.receiptToken),
      providerRequestId: compactString(adapterHandoffReceiptRow.providerRequestId),
      statusSnapshotKey: compactString(adapterHandoffReceiptRow.statusSnapshotKey),
      accepted: handoffReceiptAccepted,
      missing: freezeArray(toArray(adapterHandoffReceiptRow.missing).map(compactString).filter(Boolean)),
      nextCommand: compactString(adapterHandoffReceiptRow.nextCommand || "observe"),
    }) : null,
    providerBudget: providerBudgetRow ? Object.freeze({
      action: compactString(providerBudgetRow.action),
      state: compactString(providerBudgetRow.state),
      budgetId: compactString(providerBudgetRow.budgetId),
      remaining: providerBudgetRow.remaining ?? null,
      resetAt: compactString(providerBudgetRow.resetAt),
      retryAfterMs: Number(providerBudgetRow.retryAfterMs) || 0,
      nextCommand: compactString(providerBudgetRow.nextCommand || "observe"),
      blockedBy: freezeArray(toArray(providerBudgetRow.blockedBy).map(compactString).filter(Boolean)),
    }) : null,
    providerCallback: providerCallbackRow ? Object.freeze({
      action: compactString(providerCallbackRow.action),
      state: compactString(providerCallbackRow.state),
      callbackId: compactString(providerCallbackRow.callbackId),
      endpointUrl: compactString(providerCallbackRow.endpointUrl),
      verificationState: compactString(providerCallbackRow.verificationState),
      retryAfterMs: Number(providerCallbackRow.retryAfterMs) || 0,
      missing: freezeArray(toArray(providerCallbackRow.missing).map(compactString).filter(Boolean)),
      nextCommand: compactString(providerCallbackRow.nextCommand || "observe"),
    }) : null,
    providerEventSubscription: providerEventSubscriptionRow ? Object.freeze({
      action: compactString(providerEventSubscriptionRow.action),
      state: compactString(providerEventSubscriptionRow.state),
      subscriptionId: compactString(providerEventSubscriptionRow.subscriptionId),
      callbackId: compactString(providerEventSubscriptionRow.callbackId),
      callbackState: compactString(providerEventSubscriptionRow.callbackState || "not-required"),
      requiredEvents: freezeArray(toArray(providerEventSubscriptionRow.requiredEvents).map(compactString).filter(Boolean)),
      missingEvents: freezeArray(toArray(providerEventSubscriptionRow.missingEvents).map(compactString).filter(Boolean)),
      retryAfterMs: Number(providerEventSubscriptionRow.retryAfterMs) || 0,
      nextCommand: compactString(providerEventSubscriptionRow.nextCommand || "observe"),
    }) : null,
    providerMaintenance: providerMaintenanceRow ? Object.freeze({
      action: compactString(providerMaintenanceRow.action),
      state: compactString(providerMaintenanceRow.state),
      windowId: compactString(providerMaintenanceRow.windowId),
      startsAt: compactString(providerMaintenanceRow.startsAt),
      endsAt: compactString(providerMaintenanceRow.endsAt),
      retryAfterMs: Number(providerMaintenanceRow.retryAfterMs) || 0,
      serviceWindow: providerMaintenanceRow.serviceWindow ? Object.freeze({
        serviceWindowId: compactString(providerMaintenanceRow.serviceWindow.serviceWindowId),
        state: compactString(providerMaintenanceRow.serviceWindow.state || "available"),
        severity: compactString(providerMaintenanceRow.serviceWindow.severity),
        blocksReads: providerMaintenanceRow.serviceWindow.blocksReads === true,
        blocksWrites: providerMaintenanceRow.serviceWindow.blocksWrites === true,
        nextCommand: compactString(providerMaintenanceRow.serviceWindow.nextCommand || providerMaintenanceRow.nextCommand || "observe"),
      }) : null,
      blockedBy: freezeArray(toArray(providerMaintenanceRow.blockedBy).map(compactString).filter(Boolean)),
      nextCommand: compactString(providerMaintenanceRow.nextCommand || "observe"),
    }) : null,
    providerExportBoundary: providerExportBoundaryRow ? Object.freeze({
      action: compactString(providerExportBoundaryRow.action),
      state: compactString(providerExportBoundaryRow.state),
      laneKey: compactString(providerExportBoundaryRow.laneKey),
      exportable: providerExportBoundaryRow.exportable === true,
      boundaryFingerprint: compactString(providerExportBoundaryRow.boundaryFingerprint),
      retryable: providerExportRetryable,
      blockedBy: freezeArray(toArray(providerExportBoundaryRow.blockedBy).map(compactString).filter(Boolean)),
      missing: freezeArray(toArray(providerExportBoundaryRow.missing).map(compactString).filter(Boolean)),
      nextCommand: compactString(providerExportBoundaryRow.nextCommand || "repair_provider_export_boundary"),
    }) : null,
    operationIdentity: operationIdentity ? Object.freeze({
      operationId: compactString(operationIdentity.operationId),
      state: compactString(operationIdentity.state),
      commandId: compactString(operationIdentity.commandId),
      idempotencyKey: compactString(operationIdentity.idempotencyKey),
      statusSnapshotKey: compactString(operationIdentity.statusSnapshotKey),
      checkpointKey: compactString(operationIdentity.checkpointKey),
      missing: freezeArray(toArray(operationIdentity.missing).map(compactString).filter(Boolean)),
      nextCommand: compactString(operationIdentity.nextCommand || "observe"),
    }) : null,
    retry: Object.freeze({
      retryable: retryable || leaseRefreshReady,
      strategy: leaseRefreshReady ? leaseRecovery.backoff?.strategy || "bounded-refresh" : held ? "manual-resolution" : retryable ? "exponential-backoff" : "none",
      baseDelayMs: leaseRefreshReady ? leaseRecovery.backoff?.baseDelayMs || leaseRecovery.retryAfterMs || 1000 : retryable ? backoffSeed : 0,
      maxDelayMs: leaseRefreshReady ? leaseRecovery.backoff?.maxDelayMs || 60000 : retryable ? Math.max(backoffSeed * 6, 30000) : 0,
      retryableStatuses: freezeArray(leaseRefreshReady ? ["permission-lease-refresh"] : retryable ? ["429", "500", "502", "503", "504", "adapter-timeout"] : []),
      leaseRecovery,
    }),
    actionableError: operationMissing || operationBlocked
      ? Object.freeze({
        code: "aios.capability.operation_identity_blocked",
        message: `Capability "${action}" needs a typed restart-safe operation identity before Mailchimp adapter handoff.`,
        nextCommand: operationIdentity?.nextCommand || "attach_recovery_status_handoff",
        reasons: operationIdentity?.missing || freezeArray(["missing-operation-identity"]),
        operationId: compactString(operationIdentity?.operationId),
      })
      : leaseBlocked
      ? Object.freeze({
        code: "aios.capability.permission_lease_invalid",
        message: `Capability "${action}" needs an active workspace permission lease before Mailchimp adapter handoff.`,
        nextCommand: leaseRecovery?.nextCommand || "refresh_mailchimp_permission_lease",
        reasons: freezeArray(toArray(boundaryDecision.reasons).filter((reason) => compactString(reason).includes("permission-lease"))),
        leaseToken: compactString(boundaryDecision.permissionLease?.token),
        retryAfterMs: leaseRecovery?.retryAfterMs ?? 0,
      })
      : workspaceBlocked
      ? Object.freeze({
        code: "aios.capability.workspace_boundary_quarantined",
        message: `Capability "${action}" is quarantined by tenant/workspace boundary approval requirements.`,
        nextCommand: boundaryDecision.workspaceBoundary?.nextCommand || "collect_workspace_boundary_approval",
        reasons: freezeArray(toArray(boundaryDecision.reasons).filter((reason) => compactString(reason).includes("workspace"))),
        transferToken: compactString(boundaryDecision.workspaceBoundary?.transferToken),
      })
      : providerBudgetBlocked
      ? Object.freeze({
        code: "aios.capability.provider_budget_blocked",
        message: `Capability "${action}" is blocked by Mailchimp provider budget state.`,
        nextCommand: providerBudgetRow?.nextCommand || "wait_for_provider_budget_reset",
        reasons: freezeArray(toArray(providerBudgetRow?.blockedBy).map(compactString).filter(Boolean)),
        retryAfterMs: providerBudgetRow?.retryAfterMs ?? 0,
        budgetId: compactString(providerBudgetRow?.budgetId),
      })
      : providerCallbackBlocked
      ? Object.freeze({
        code: "aios.capability.provider_callback_blocked",
        message: `Capability "${action}" needs verified Mailchimp callback endpoint state before adapter handoff.`,
        nextCommand: providerCallbackRow?.nextCommand || "attach_provider_callback_endpoint",
        reasons: freezeArray(toArray(providerCallbackRow?.missing).map(compactString).filter(Boolean)),
        callbackId: compactString(providerCallbackRow?.callbackId),
      })
      : providerCallbackPending
      ? Object.freeze({
        code: "aios.capability.provider_callback_pending",
        message: `Capability "${action}" is waiting for Mailchimp callback endpoint verification.`,
        nextCommand: providerCallbackRow?.nextCommand || "verify_provider_callback_endpoint",
        reasons: freezeArray(["provider-callback-pending"]),
        retryAfterMs: providerCallbackRow?.retryAfterMs ?? 0,
        callbackId: compactString(providerCallbackRow?.callbackId),
      })
      : providerEventSubscriptionBlocked
      ? Object.freeze({
        code: "aios.capability.provider_event_subscription_blocked",
        message: `Capability "${action}" needs Mailchimp provider event subscriptions before adapter handoff.`,
        nextCommand: providerEventSubscriptionRow?.nextCommand || "subscribe_provider_events",
        reasons: freezeArray(toArray(providerEventSubscriptionRow?.missingEvents).map((event) => `missing-event:${event}`)),
        subscriptionId: compactString(providerEventSubscriptionRow?.subscriptionId),
        callbackId: compactString(providerEventSubscriptionRow?.callbackId),
      })
      : providerEventSubscriptionPending
      ? Object.freeze({
        code: "aios.capability.provider_event_subscription_pending",
        message: `Capability "${action}" is waiting for Mailchimp provider event subscription confirmation.`,
        nextCommand: providerEventSubscriptionRow?.nextCommand || "poll_provider_event_subscription",
        reasons: freezeArray(["provider-event-subscription-pending"]),
        retryAfterMs: providerEventSubscriptionRow?.retryAfterMs ?? 0,
        subscriptionId: compactString(providerEventSubscriptionRow?.subscriptionId),
      })
      : providerMaintenanceBlocked
      ? Object.freeze({
        code: "aios.capability.provider_maintenance_blocked",
        message: `Capability "${action}" is blocked by a Mailchimp provider maintenance window.`,
        nextCommand: providerMaintenanceRow?.nextCommand || "wait_for_provider_maintenance_window",
        reasons: freezeArray(toArray(providerMaintenanceRow?.blockedBy).map(compactString).filter(Boolean)),
        retryAfterMs: providerMaintenanceRow?.retryAfterMs ?? 0,
        windowId: compactString(providerMaintenanceRow?.windowId),
      })
      : providerExportBlocked
      ? Object.freeze({
        code: "aios.capability.provider_export_boundary_blocked",
        message: `Capability "${action}" has a blocked provider export boundary lane.`,
        nextCommand: providerExportBoundaryRow?.nextCommand || "repair_provider_export_boundary",
        reasons: freezeArray(toArray(providerExportBoundaryRow?.blockedBy).map(compactString).filter(Boolean)),
        laneKey: compactString(providerExportBoundaryRow?.laneKey),
        retryable: providerExportRetryable,
      })
      : workflowBlocked
      ? Object.freeze({
        code: workflowGate?.state === "needs-preview-acceptance"
          ? "aios.capability.preview_acceptance_required"
          : "aios.capability.workflow_handoff_blocked",
        message: workflowGate?.state === "needs-preview-acceptance"
          ? `Capability "${action}" is waiting on scope preview acceptance before Mailchimp adapter handoff.`
          : `Capability "${action}" is waiting on client workflow handoff command "${workflowGate.nextCommand}".`,
        nextCommand: workflowGate.nextCommand || "resolve_runtime_readiness",
        reasons: workflowGate?.state === "needs-preview-acceptance"
          ? freezeArray(["preview-acceptance-required"])
          : freezeArray(workflowGate.blockedCommands?.map((command) => command.reason || command.command).filter(Boolean) || ["client-workflow-blocked"]),
      })
      : providerFailed
      ? Object.freeze({
        code: "aios.capability.adapter_status_failed",
        message: `Capability "${action}" has a terminal adapter status of "${statusReconciliation.state}".`,
        nextCommand: statusReconciliation.nextCommand || "inspect_adapter_failure",
        reasons: freezeArray([statusReconciliation.message || statusReconciliation.state].filter(Boolean)),
      })
      : snapshotBlocked
        ? Object.freeze({
          code: "aios.capability.adapter_status_snapshot_blocked",
          message: `Capability "${action}" needs its adapter status row materialized into the restart snapshot.`,
          nextCommand: statusReconciliation.nextCommand || "materialize_adapter_status_snapshot",
          reasons: statusReconciliation.snapshotMissing?.length > 0 ? statusReconciliation.snapshotMissing : freezeArray(["adapter-status-snapshot-blocked"]),
        })
      : held
      ? Object.freeze({
        code: "aios.capability.boundary_hold",
        message: `Capability "${action}" is held by tenant/workspace or permission boundary checks.`,
        nextCommand: "resolve_boundary_hold",
        reasons: boundaryDecision.reasons,
      })
      : approvalRejected
        ? Object.freeze({
          code: "aios.capability.operator_rejected",
          message: `Capability "${action}" was rejected by operator acceptance controls.`,
          nextCommand: "revise_or_cancel_provider_action",
          reasons: freezeArray(["operator-acceptance-rejected"]),
        })
      : handoffBlocked
        ? Object.freeze({
          code: "aios.capability.adapter_handoff_manifest_blocked",
          message: `Capability "${action}" is blocked by the adapter handoff manifest.`,
          nextCommand: adapterHandoffRow?.command || "resolve_adapter_handoff_manifest",
          reasons: adapterHandoffRow?.blockedBy || freezeArray(["adapter-handoff-blocked"]),
        })
      : externalWrite && !hasStatusSnapshot
        ? Object.freeze({
          code: "aios.capability.status_snapshot_missing",
          message: `Capability "${action}" needs a status snapshot key before adapter handoff can be restart-safe.`,
          nextCommand: "attach_status_snapshot_store",
          reasons: freezeArray(["missing-status-snapshot-key"]),
        })
        : null,
  });
}

function createCapabilityLifecycleControls(capability = {}, action, provider, principal, boundaryDecision, health, effects, acceptance = null, statusReconciliation = null, workflowGate = null, adapterHandoffRow = null, providerBudgetRow = null, settingsAdoptionRow = null, providerCallbackRow = null, providerExportBoundaryRow = null, providerMaintenanceRow = null, providerExportPublicationRow = null, lifecycleGateRow = null, providerEventSubscriptionRow = null) {
  const schedule = capability.schedule || capability.scheduling || {};
  const requestedMode = compactString(capability.mode || capability.lifecycleMode || "enabled");
  const externalWrite = effects.externalWrite === true;
  const hold = boundaryDecision.decision === "hold";
  const leaseBlocked = toArray(boundaryDecision.reasons).some((reason) => compactString(reason).includes("permission-lease"));
  const leaseRecovery = boundaryDecision.leaseRecovery || null;
  const approvalBlocked = acceptance?.state === "pending" || acceptance?.state === "rejected";
  const scheduleRequested = action.includes("schedule") || Boolean(schedule.at || schedule.window || schedule.cron);
  const scheduleWindow = compactString(schedule.window || capability.scheduleWindow || "");
  const scheduleAt = compactString(schedule.at || capability.scheduleAt || "");
  const settingsBlocked = settingsAdoptionRow?.state === "blocked";
  const settingsDisabled = settingsAdoptionRow?.state === "disabled";
  const settingsPatchRequired = settingsAdoptionRow?.state === "patch-required";
  const lifecycleBlocked = lifecycleGateRow?.state === "blocked" || lifecycleGateRow?.state === "disabled";
  const lifecycleGated = lifecycleGateRow?.state === "gated";
  const overrideReceipt = lifecycleGateRow?.overrideReceipt || {};
  const lifecycleReceiptBlocked = overrideReceipt.required === true
    && (["missing", "pending", "rejected", "revoked", "expired"].includes(compactString(overrideReceipt.state))
      || overrideReceipt.expired === true);
  const marketingConsent = lifecycleGateRow?.marketingConsent || {};
  const consentBlocked = marketingConsent.required === true
    && (compactString(marketingConsent.state) !== "granted" || marketingConsent.expired === true);
  const providerCallbackBlocked = providerCallbackRow?.state === "blocked";
  const providerCallbackPending = providerCallbackRow?.state === "pending-verification";
  const providerEventSubscriptionBlocked = providerEventSubscriptionRow?.state === "blocked" || providerEventSubscriptionRow?.state === "missing-subscription";
  const providerEventSubscriptionPending = providerEventSubscriptionRow?.state === "pending";
  const providerMaintenanceBlocked = providerMaintenanceRow?.state === "blocked";
  const providerMaintenanceDegraded = providerMaintenanceRow?.state === "degraded";
  const providerServiceUnavailable = toArray(providerMaintenanceRow?.blockedBy)
    .some((reason) => compactString(reason).startsWith("provider-service-"));
  const providerServiceDegraded = providerMaintenanceRow?.serviceWindow?.state === "degraded";
  const providerExportBlocked = providerExportBoundaryRow?.exportable === false
    || providerExportBoundaryRow?.state === "blocked"
    || toArray(providerExportBoundaryRow?.blockedBy).length > 0;
  const providerPublicationBlocked = compactString(providerExportPublicationRow?.state) === "blocked"
    || toArray(providerExportPublicationRow?.blockedBy).length > 0
    || principal.providerExportPublication?.state === "blocked";
  const publicationReceiptBlocked = principal.publicationReceiptReadiness?.state === "blocked"
    || toArray(principal.publicationReceiptBlockedRows).length > 0;
  const publicationReceiptPending = ["pending", "pending-receipt", "needs-receipt"].includes(compactString(principal.publicationReceiptReadiness?.state))
    || toArray(principal.publicationReceiptPendingRows).length > 0;
  const disableReasons = [
    requestedMode === "disabled" && "capability-disabled",
    hold && "boundary-hold",
    leaseBlocked && "permission-lease-blocked",
    acceptance?.state === "rejected" && "operator-acceptance-rejected",
    ["failed", "timed-out", "cancelled"].includes(statusReconciliation?.state) && "adapter-status-terminal",
    statusReconciliation?.state === "snapshot-blocked" && "adapter-status-snapshot-blocked",
    statusReconciliation?.state === "missing-status" && "adapter-status-missing",
    workflowGate?.state === "needs-preview-acceptance" && "preview-acceptance-required",
    workflowGate?.acceptedForAdapter === false && workflowGate?.state !== "needs-preview-acceptance" && "client-workflow-blocked",
    adapterHandoffRow?.state === "blocked" && "adapter-handoff-manifest-blocked",
    providerBudgetRow?.state === "blocked" && "provider-budget-blocked",
    providerCallbackBlocked && "provider-callback-blocked",
    providerCallbackPending && "provider-callback-pending",
    providerEventSubscriptionBlocked && "provider-event-subscription-blocked",
    providerEventSubscriptionPending && "provider-event-subscription-pending",
    providerMaintenanceBlocked && "provider-maintenance-blocked",
    providerServiceUnavailable && "provider-service-unavailable",
    providerExportBlocked && "provider-export-boundary-blocked",
    providerPublicationBlocked && "provider-export-publication-blocked",
    publicationReceiptBlocked && "provider-publication-receipt-blocked",
    publicationReceiptPending && "provider-publication-receipt-pending",
    lifecycleReceiptBlocked && "lifecycle-command-receipt-blocked",
    consentBlocked && "marketing-consent-blocked",
    lifecycleBlocked && "mailchimp-lifecycle-gate-blocked",
    settingsBlocked && "mailchimp-settings-blocked",
    settingsDisabled && "mailchimp-settings-disabled",
    provider === "mailchimp" && externalWrite && health.operationIdentity?.state === "blocked" && "operation-identity-blocked",
    provider === "mailchimp" && externalWrite && !health.operationIdentity && "missing-operation-identity",
    externalWrite && !principal.statusChannel && "missing-status-channel",
    externalWrite && !principal.requestId && "missing-request-id",
    scheduleRequested && !scheduleAt && !scheduleWindow && "missing-schedule-window",
  ].filter(Boolean);
  const enableAdapter = provider === "mailchimp"
    && disableReasons.length === 0
    && approvalBlocked === false
    && health.degradedMode === "none"
    && adapterHandoffRow?.state !== "blocked"
    && adapterHandoffRow?.state !== "waiting"
    && (externalWrite ? Boolean(principal.statusSnapshotKey) : true);

  return Object.freeze({
    protocol: "aios.capability.lifecycle-controls.v1",
    mode: requestedMode === "disabled" ? "disabled" : disableReasons.length > 0 ? "disabled" : "enabled",
    controls: Object.freeze({
      enableRuntime: disableReasons.length === 0,
      enablePreview: true,
      enableAdapterHandoff: enableAdapter,
      enableRetry: health.retry?.retryable === true && !hold,
      enableManifestQueue: adapterHandoffRow?.queueable === true,
      enableLeaseRefresh: leaseBlocked && Boolean(leaseRecovery?.nextCommand),
      enableProviderThrottle: providerBudgetRow?.state === "degraded" || providerBudgetRow?.state === "throttled",
      enableProviderCallbackVerification: providerCallbackBlocked || providerCallbackPending,
      enableProviderEventSubscription: providerEventSubscriptionBlocked || providerEventSubscriptionPending,
      enableProviderMaintenanceDeferral: providerMaintenanceBlocked || providerMaintenanceDegraded,
      enableProviderServiceRecovery: providerServiceUnavailable || providerServiceDegraded,
      enableProviderExport: provider === "mailchimp" && !providerExportBlocked && !providerPublicationBlocked,
      enableProviderPublication: provider === "mailchimp" && !providerExportBlocked && !providerPublicationBlocked && !publicationReceiptBlocked && !publicationReceiptPending && principal.providerExportPublication?.acceptedForExport === true,
      enableMarketingConsentCollection: consentBlocked,
      enableLifecycleGateRepair: lifecycleBlocked,
      enableLifecycleCommandReceipt: lifecycleReceiptBlocked,
      enableLifecycleGateCommand: lifecycleGated && disableReasons.length === 0,
      enableSettingsPatch: settingsPatchRequired && disableReasons.length === 0,
      enableScheduling: scheduleRequested && disableReasons.length === 0,
      requireOperatorApproval: effects.operatorApprovalRequired === true,
      operatorAcceptanceSatisfied: acceptance?.accepted === true,
      requireBoundaryResolution: hold,
      requirePermissionLeaseRefresh: leaseBlocked,
      requireProviderCallbackVerification: providerCallbackBlocked || providerCallbackPending,
      requireProviderEventSubscription: providerEventSubscriptionBlocked || providerEventSubscriptionPending,
      requireProviderMaintenanceClearance: providerMaintenanceBlocked,
      requireProviderServiceRecovery: providerServiceUnavailable,
      requireProviderExportBoundaryRepair: providerExportBlocked,
      requireProviderPublicationRepair: providerPublicationBlocked,
      requireProviderPublicationReceipt: publicationReceiptBlocked || publicationReceiptPending,
      requireLifecycleCommandReceipt: lifecycleReceiptBlocked,
      requireMarketingConsent: consentBlocked,
      requireLifecycleGateRepair: lifecycleBlocked,
    }),
    settingsValidation: freezeArray(disableReasons.map((reason) => ({
      setting: reason === "permission-lease-blocked" ? "permissionLease" : reason === "provider-budget-blocked" ? "providerBudget" : reason === "provider-service-unavailable" ? "providerServiceWindow" : reason === "lifecycle-command-receipt-blocked" ? "lifecycleCommandReceipt" : reason === "marketing-consent-blocked" ? "marketingConsent" : reason.startsWith("mailchimp-settings") ? "mailchimpSettings" : reason.startsWith("missing-schedule") ? "schedule" : reason.startsWith("missing-status") ? "statusChannel" : reason.startsWith("missing-request") ? "requestId" : reason.startsWith("operator") ? "operatorAcceptance" : "boundary",
      reason,
      severity: reason === "capability-disabled" || reason === "mailchimp-settings-disabled" ? "info" : "error",
    }))),
    scheduling: Object.freeze({
      requested: scheduleRequested,
      at: scheduleAt,
      window: scheduleWindow,
      timezone: compactString(schedule.timezone || capability.timezone || "UTC"),
      nextAction: !scheduleRequested
        ? "observe"
        : disableReasons.length > 0
        ? "repair_scheduling_settings"
          : effects.operatorApprovalRequired
            ? "collect_verifier_evidence"
            : "queue_provider_schedule",
    }),
    leaseRefresh: Object.freeze({
      required: leaseBlocked,
      command: leaseRecovery?.nextCommand || (leaseBlocked ? "refresh_mailchimp_permission_lease" : "observe"),
      retryAfterMs: leaseRecovery?.retryAfterMs ?? 0,
      strategy: leaseRecovery?.backoff?.strategy || "none",
      statusChannel: leaseRecovery?.handoff?.statusChannel || principal.statusChannel,
      leaseToken: leaseRecovery?.handoff?.leaseToken || boundaryDecision.permissionLease?.token || "",
    }),
    providerBudget: Object.freeze({
      state: compactString(providerBudgetRow?.state || "not-required"),
      budgetId: compactString(providerBudgetRow?.budgetId),
      remaining: providerBudgetRow?.remaining ?? null,
      retryAfterMs: providerBudgetRow?.retryAfterMs ?? 0,
      resetAt: compactString(providerBudgetRow?.resetAt),
      nextCommand: compactString(providerBudgetRow?.nextCommand || "observe"),
      blockedBy: freezeArray(toArray(providerBudgetRow?.blockedBy).map(compactString).filter(Boolean)),
    }),
    providerCallback: Object.freeze({
      state: compactString(providerCallbackRow?.state || "not-required"),
      callbackId: compactString(providerCallbackRow?.callbackId),
      endpointUrl: compactString(providerCallbackRow?.endpointUrl),
      verificationState: compactString(providerCallbackRow?.verificationState),
      retryAfterMs: providerCallbackRow?.retryAfterMs ?? 0,
      missing: freezeArray(toArray(providerCallbackRow?.missing).map(compactString).filter(Boolean)),
      nextCommand: compactString(providerCallbackRow?.nextCommand || "observe"),
    }),
    providerEventSubscription: Object.freeze({
      state: compactString(providerEventSubscriptionRow?.state || "not-required"),
      subscriptionId: compactString(providerEventSubscriptionRow?.subscriptionId),
      callbackId: compactString(providerEventSubscriptionRow?.callbackId),
      callbackState: compactString(providerEventSubscriptionRow?.callbackState || "not-required"),
      requiredEvents: freezeArray(toArray(providerEventSubscriptionRow?.requiredEvents).map(compactString).filter(Boolean)),
      subscribedEvents: freezeArray(toArray(providerEventSubscriptionRow?.subscribedEvents).map(compactString).filter(Boolean)),
      missingEvents: freezeArray(toArray(providerEventSubscriptionRow?.missingEvents).map(compactString).filter(Boolean)),
      retryAfterMs: providerEventSubscriptionRow?.retryAfterMs ?? 0,
      nextCommand: compactString(providerEventSubscriptionRow?.nextCommand || "observe"),
    }),
    providerMaintenance: Object.freeze({
      state: compactString(providerMaintenanceRow?.state || "not-required"),
      windowId: compactString(providerMaintenanceRow?.windowId),
      startsAt: compactString(providerMaintenanceRow?.startsAt),
      endsAt: compactString(providerMaintenanceRow?.endsAt),
      retryAfterMs: providerMaintenanceRow?.retryAfterMs ?? 0,
      serviceWindow: providerMaintenanceRow?.serviceWindow ? Object.freeze({
        serviceWindowId: compactString(providerMaintenanceRow.serviceWindow.serviceWindowId),
        state: compactString(providerMaintenanceRow.serviceWindow.state || "available"),
        severity: compactString(providerMaintenanceRow.serviceWindow.severity),
        startsAt: compactString(providerMaintenanceRow.serviceWindow.startsAt),
        endsAt: compactString(providerMaintenanceRow.serviceWindow.endsAt),
        blocksReads: providerMaintenanceRow.serviceWindow.blocksReads === true,
        blocksWrites: providerMaintenanceRow.serviceWindow.blocksWrites === true,
        reason: compactString(providerMaintenanceRow.serviceWindow.reason),
        nextCommand: compactString(providerMaintenanceRow.serviceWindow.nextCommand || providerMaintenanceRow.nextCommand || "observe"),
      }) : null,
      blockedBy: freezeArray(toArray(providerMaintenanceRow?.blockedBy).map(compactString).filter(Boolean)),
      nextCommand: compactString(providerMaintenanceRow?.nextCommand || "observe"),
    }),
    providerExportBoundary: Object.freeze({
      state: compactString(providerExportBoundaryRow?.state || "not-required"),
      laneKey: compactString(providerExportBoundaryRow?.laneKey),
      exportable: providerExportBoundaryRow ? providerExportBoundaryRow.exportable === true : true,
      boundaryFingerprint: compactString(providerExportBoundaryRow?.boundaryFingerprint),
      retryable: providerExportBoundaryRow?.retryable === true,
      blockedBy: freezeArray(toArray(providerExportBoundaryRow?.blockedBy).map(compactString).filter(Boolean)),
      missing: freezeArray(toArray(providerExportBoundaryRow?.missing).map(compactString).filter(Boolean)),
      nextCommand: compactString(providerExportBoundaryRow?.nextCommand || "observe"),
    }),
    providerPublication: Object.freeze({
      state: compactString(providerExportPublicationRow?.state || principal.providerExportPublication?.state || "not-required"),
      publicationId: compactString(principal.providerExportPublication?.publicationId),
      rowId: compactString(providerExportPublicationRow?.rowId),
      laneKey: compactString(providerExportPublicationRow?.laneKey),
      manifestKey: compactString(providerExportPublicationRow?.manifestKey),
      boundaryFingerprint: compactString(providerExportPublicationRow?.boundaryFingerprint),
      acceptedForExport: principal.providerExportPublication?.acceptedForExport === true,
      blockedBy: freezeArray(toArray(providerExportPublicationRow?.blockedBy).map(compactString).filter(Boolean)),
      receiptState: compactString(principal.publicationReceiptReadiness?.state || "not-required"),
      acceptedForProviderHandoff: principal.publicationReceiptReadiness?.acceptedForProviderHandoff === true,
      receiptRows: freezeArray(toArray(principal.publicationReceiptRows).map((row) => ({
        rowId: compactString(row.rowId),
        destinationId: compactString(row.destinationId),
        state: compactString(row.state),
        receiptId: compactString(row.receiptId),
        providerAckId: compactString(row.providerAckId),
        nextCommand: compactString(row.nextCommand || "observe"),
      }))),
      blockedReceiptRows: freezeArray(toArray(principal.publicationReceiptBlockedRows).map((row) => ({
        rowId: compactString(row.rowId),
        destinationId: compactString(row.destinationId),
        state: compactString(row.state),
        missing: freezeArray(toArray(row.missing).map(compactString).filter(Boolean)),
        nextCommand: compactString(row.nextCommand || "repair_scope_publication_receipt"),
      }))),
      nextCommand: compactString(providerExportPublicationRow?.nextCommand || principal.providerExportPublication?.nextStep?.command || "observe"),
    }),
    lifecycleGate: Object.freeze({
      state: compactString(lifecycleGateRow?.state || "not-required"),
      mode: compactString(lifecycleGateRow?.mode || "enabled"),
      acceptedForAdapter: lifecycleGateRow ? lifecycleGateRow.acceptedForAdapter === true : true,
      missing: freezeArray(toArray(lifecycleGateRow?.missing).map(compactString).filter(Boolean)),
      nextCommand: compactString(lifecycleGateRow?.nextCommand || "observe"),
      sendLock: lifecycleGateRow?.sendLock || Object.freeze({ locked: false, token: "", reason: "" }),
      scheduling: lifecycleGateRow?.scheduling || Object.freeze({ requested: false, at: "", window: "", timezone: "UTC" }),
      overrideReceipt: Object.freeze({
        required: overrideReceipt.required === true,
        command: compactString(overrideReceipt.command),
        state: compactString(overrideReceipt.state || "not-required"),
        receiptToken: compactString(overrideReceipt.receiptToken),
        acceptedBy: compactString(overrideReceipt.acceptedBy),
        acceptedAt: compactString(overrideReceipt.acceptedAt),
        expiresAt: compactString(overrideReceipt.expiresAt),
        expired: overrideReceipt.expired === true,
        statusChannel: compactString(overrideReceipt.statusChannel || principal.statusChannel),
        nextCommand: compactString(overrideReceipt.nextCommand || "observe"),
      }),
      marketingConsent: Object.freeze({
        required: marketingConsent.required === true,
        state: compactString(marketingConsent.state || "not-required"),
        consentId: compactString(marketingConsent.consentId),
        audienceId: compactString(marketingConsent.audienceId),
        segmentId: compactString(marketingConsent.segmentId),
        source: compactString(marketingConsent.source),
        grantedAt: compactString(marketingConsent.grantedAt),
        expiresAt: compactString(marketingConsent.expiresAt),
        expired: marketingConsent.expired === true,
        statusChannel: compactString(marketingConsent.statusChannel || principal.statusChannel),
        nextCommand: compactString(marketingConsent.nextCommand || "observe"),
      }),
    }),
    settingsAdoption: Object.freeze({
      state: compactString(settingsAdoptionRow?.state || "not-required"),
      changedFields: freezeArray(toArray(settingsAdoptionRow?.changedFields).map(compactString).filter(Boolean)),
      missing: freezeArray(toArray(settingsAdoptionRow?.missing).map(compactString).filter(Boolean)),
      nextCommand: compactString(settingsAdoptionRow?.nextCommand || "observe"),
      statusChannel: compactString(settingsAdoptionRow?.statusChannel || principal.statusChannel),
    }),
    nextAction: leaseBlocked
      ? leaseRecovery?.nextCommand || "refresh_mailchimp_permission_lease"
      : providerBudgetRow?.state === "blocked"
        ? providerBudgetRow.nextCommand || "wait_for_provider_budget_reset"
      : providerCallbackBlocked || providerCallbackPending
        ? providerCallbackRow.nextCommand || "verify_provider_callback_endpoint"
      : providerEventSubscriptionBlocked || providerEventSubscriptionPending
        ? providerEventSubscriptionRow.nextCommand || "subscribe_provider_events"
      : providerMaintenanceBlocked || providerMaintenanceDegraded
        ? providerMaintenanceRow.nextCommand || "wait_for_provider_maintenance_window"
      : providerExportBlocked
        ? providerExportBoundaryRow.nextCommand || "repair_provider_export_boundary"
      : providerPublicationBlocked
        ? providerExportPublicationRow?.nextCommand || principal.providerExportPublication?.nextStep?.command || "repair_scope_analytics_export"
      : publicationReceiptBlocked
        ? principal.publicationReceiptReadiness?.nextStep?.command || "repair_scope_publication_receipt"
      : publicationReceiptPending
        ? principal.publicationReceiptReadiness?.nextStep?.command || "attach_scope_publication_receipt"
      : lifecycleReceiptBlocked
        ? overrideReceipt.nextCommand || "attach_mailchimp_lifecycle_command_receipt"
      : consentBlocked
        ? marketingConsent.nextCommand || "collect_marketing_consent"
      : lifecycleBlocked
        ? lifecycleGateRow.nextCommand || "repair_mailchimp_lifecycle_controls"
      : lifecycleGated
        ? lifecycleGateRow.nextCommand || "queue_provider_schedule"
      : settingsBlocked
        ? settingsAdoptionRow.nextCommand || "repair_mailchimp_settings"
      : settingsDisabled
        ? settingsAdoptionRow.nextCommand || "observe"
      : hold
      ? "resolve_boundary_hold"
      : ["failed", "timed-out", "cancelled"].includes(statusReconciliation?.state)
        ? statusReconciliation.nextCommand || "inspect_adapter_failure"
      : statusReconciliation?.state === "snapshot-blocked"
          ? statusReconciliation.nextCommand || "materialize_adapter_status_snapshot"
      : statusReconciliation?.state === "missing-status"
          ? "load_adapter_status_snapshot"
          : adapterHandoffRow?.state === "blocked" || adapterHandoffRow?.state === "waiting"
            ? adapterHandoffRow.command || "resolve_adapter_handoff_manifest"
          : workflowGate?.acceptedForAdapter === false
            ? workflowGate.nextCommand || "resolve_runtime_readiness"
          : disableReasons.length > 0
            ? "repair_capability_settings"
            : settingsPatchRequired
              ? settingsAdoptionRow.nextCommand || "apply_mailchimp_settings_patch"
            : acceptance?.state === "rejected"
              ? "revise_or_cancel_provider_action"
              : effects.operatorApprovalRequired
                ? "hold_for_operator"
                : externalWrite
                  ? "queue_adapter_handoff"
                  : "observe",
  });
}

function normalizeProviderSyncResources(capability = {}, action) {
  const explicit = toArray(capability.syncResources || capability.providerResources || capability.resources)
    .map((resource) => {
      if (typeof resource === "string") {
        return Object.freeze({
          type: resource.includes(":") ? resource.split(":")[0] : "resource",
          id: resource.includes(":") ? resource.split(":").slice(1).join(":") : resource,
        });
      }
      return Object.freeze({
        type: compactString(resource.type || resource.kind || resource.name || "resource"),
        id: compactString(resource.id || resource.resourceId || resource.externalId || resource.name || ""),
      });
    })
    .filter((resource) => resource.type || resource.id);

  if (explicit.length > 0) return explicit;
  if (action.startsWith("campaign.")) return [Object.freeze({ type: "campaign", id: compactString(capability.campaignId || capability.externalId) })];
  if (action.startsWith("audience.segment.")) return [Object.freeze({ type: "segment", id: compactString(capability.segmentId || capability.externalId) })];
  if (action.startsWith("audience.")) return [Object.freeze({ type: "audience", id: compactString(capability.audienceId || capability.listId || capability.externalId) })];
  if (action.startsWith("template.")) return [Object.freeze({ type: "template", id: compactString(capability.templateId || capability.externalId) })];
  if (action.startsWith("report.")) return [Object.freeze({ type: "report", id: compactString(capability.reportId || capability.externalId) })];
  return [];
}

function createCapabilityProviderSyncContract(capability = {}, action, provider, principal, lifecycle, health, effects, scopeSyncRow = null) {
  const sync = capability.sync || capability.providerSync || capability.syncMetadata || {};
  const providerManaged = provider === "mailchimp";
  const externalWrite = effects.externalWrite === true;
  const resources = normalizeProviderSyncResources(capability, action);
  const resourceFingerprint = resources
    .map((resource) => `${resource.type}:${resource.id || "pending"}`)
    .sort()
    .join("|");
  const baseToken = stableContractToken("sync", [
    provider,
    principal.tenantId,
    principal.workspaceId,
    principal.requestId,
    action,
    resourceFingerprint,
  ]);
  const watermarkKey = firstString(sync.watermarkKey, capability.watermarkKey, scopeSyncRow?.watermarkKey, providerManaged ? `${baseToken}:watermark` : "");
  const checkpointKey = firstString(sync.checkpointKey, capability.checkpointKey, scopeSyncRow?.checkpointKey, providerManaged ? `${baseToken}:checkpoint` : "");
  const cursor = firstString(sync.cursor, sync.nextCursor, capability.cursor, scopeSyncRow?.cursor);
  const objectRef = firstString(
    sync.objectRef,
    sync.externalObjectRef,
    capability.externalObjectRef,
    scopeSyncRow?.objectRef,
    resources.length === 1 && resources[0].id ? `${resources[0].type}:${resources[0].id}` : ""
  );
  const direction = compactString(sync.direction || capability.syncDirection || (externalWrite ? "push-pull" : "pull"));
  const requestedMode = compactString(sync.mode || capability.syncMode || (providerManaged ? "watermarked" : "none"));
  const validation = [
    providerManaged && !principal.tenantId && "missing-tenant",
    providerManaged && !principal.workspaceId && "missing-workspace",
    providerManaged && externalWrite && !principal.requestId && "missing-request-id",
    providerManaged && externalWrite && !watermarkKey && "missing-watermark-key",
    providerManaged && externalWrite && !checkpointKey && "missing-checkpoint-key",
    providerManaged && resources.some((resource) => !resource.id) && "pending-provider-resource-id",
    providerManaged && scopeSyncRow?.state === "blocked" && "scope-provider-sync-blocked",
    providerManaged && lifecycle?.controls?.enableAdapterHandoff === false && "adapter-handoff-disabled",
    providerManaged && lifecycle?.controls?.requirePermissionLeaseRefresh === true && "permission-lease-blocked",
  ].filter(Boolean);
  const state = !providerManaged
    ? "not-applicable"
    : validation.some((reason) => reason !== "pending-provider-resource-id")
      ? "blocked"
      : resources.some((resource) => !resource.id) || !cursor
        ? "needs-provider-confirmation"
        : externalWrite
          ? "checkpoint-ready"
          : "watermark-ready";

  return Object.freeze({
    protocol: "aios.capability.provider-sync.v1",
    provider,
    action,
    mode: providerManaged ? requestedMode : "none",
    direction,
    state,
    externalWrite,
    resources: freezeArray(resources.map((resource) => ({
      type: resource.type,
      id: resource.id,
      stableRef: `${resource.type}:${resource.id || "pending"}`,
    }))),
    metadata: Object.freeze({
      watermarkKey,
      checkpointKey,
      cursor,
      objectRef,
      statusSnapshotKey: principal.statusSnapshotKey,
      statusChannel: principal.statusChannel,
      requestId: principal.requestId,
      leaseRefreshCommand: lifecycle?.leaseRefresh?.command || "observe",
      leaseRetryAfterMs: lifecycle?.leaseRefresh?.retryAfterMs ?? 0,
      providerCallbackState: lifecycle?.providerCallback?.state || "not-required",
      providerCallbackId: lifecycle?.providerCallback?.callbackId || "",
      providerCallbackNextCommand: lifecycle?.providerCallback?.nextCommand || "observe",
      lastSyncedAt: firstString(sync.lastSyncedAt, capability.lastSyncedAt),
      scopeSyncState: compactString(scopeSyncRow?.state || "not-provided"),
      scopeSyncNextCommand: compactString(scopeSyncRow?.nextCommand || ""),
      maxAgeMs: positiveInteger(sync.maxAgeMs ?? capability.syncMaxAgeMs, 0),
    }),
    validation: freezeArray(validation.map((reason) => ({
      reason,
      severity: reason === "pending-provider-resource-id" ? "warning" : "error",
    }))),
    nextCommand: state === "blocked"
      ? "repair_provider_sync_metadata"
      : state === "needs-provider-confirmation"
        ? "confirm_provider_resource_state"
        : externalWrite
          ? "persist_provider_checkpoint"
          : "observe",
    health: Object.freeze({
      restartSafe: !providerManaged || (!externalWrite || (Boolean(watermarkKey) && Boolean(checkpointKey))),
      adapterAccepted: lifecycle?.controls?.enableAdapterHandoff === true && health?.state !== "blocked",
      degradedMode: validation.length > 0 ? "provider-sync-validation" : "none",
      leaseRefreshRequired: lifecycle?.leaseRefresh?.required === true,
      scopeAccepted: !scopeSyncRow || scopeSyncRow.state !== "blocked",
    }),
  });
}

function createCapabilityContract(capability = {}, usage, principal) {
  const action = compactString(capability.name || capability.scope || "capability");
  const boundary = compactString(capability.boundary || "internal");
  const provider = action.startsWith("campaign.") || action.startsWith("audience.") || action.startsWith("template.") || action.startsWith("report.")
    ? "mailchimp"
    : compactString(capability.provider || "local");
  const scopes = toArray(capability.scopes || capability.serviceScopes || inferMailchimpScopes(action)).map(compactString).filter(Boolean).sort();
  const writesExternal = boundary === "external" || WRITE_ACTION_PATTERN.test(action);
  const requiresApproval = writesExternal && WRITE_ACTION_PATTERN.test(action);
  const acceptance = createCapabilityAcceptanceState(capability, action, principal, requiresApproval);
  const usageRecord = usage.get(action) || { reads: new Set(), writes: new Set(), steps: new Set() };
  const boundaryDecision = createBoundaryDecision(action, provider, principal, capability);
  const statusReconciliation = createCapabilityStatusReconciliation(action, principal, usageRecord);
  const workflowGate = createCapabilityWorkflowGate(action, principal, usageRecord);
  const previewActionPlan = findPreviewActionPlanRow(action, principal, usageRecord);
  const previewRuntimeHandoff = findPreviewRuntimeHandoffRow(action, principal, usageRecord);
  const adapterHandoffRow = findAdapterHandoffRow(action, principal);
  const adapterHandoffReceiptRow = findAdapterHandoffReceiptRow(action, principal, usageRecord);
  const operationIdentity = findOperationIdentity(action, principal, usageRecord);
  const persistedRecoveryCommand = findPersistedRecoveryCommand(action, principal, usageRecord);
  const resumptionJournalRow = findResumptionJournalRow(action, principal, usageRecord);
  const recoveryCheckpointRow = findRecoveryCheckpointRow(action, principal, usageRecord);
  const providerBudgetRow = findProviderBudgetRow(action, principal);
  const providerCallbackRow = findProviderCallbackRow(action, principal);
  const providerEventSubscriptionRow = findProviderEventSubscriptionRow(action, principal);
  const providerMaintenanceRow = findProviderMaintenanceRow(action, principal);
  const providerExportBoundaryRow = findProviderExportBoundaryRow(action, principal);
  const providerExportPublicationRow = findProviderExportPublicationRow(action, principal);
  const settingsAdoptionRow = findSettingsAdoptionRow(action, principal);
  const lifecycleGateRow = findLifecycleGateRow(action, principal);
  const effects = Object.freeze({
    externalWrite: writesExternal,
    requiredApproval: requiresApproval && acceptance.accepted !== true,
    operatorApprovalRequired: requiresApproval && acceptance.accepted !== true,
    operatorAcceptanceState: acceptance.state,
    operatorAcceptanceToken: acceptance.token,
    reads: freezeArray([...usageRecord.reads].filter(Boolean).sort()),
    writes: freezeArray([...usageRecord.writes].filter(Boolean).sort()),
    steps: freezeArray([...usageRecord.steps].sort()),
  });
  const health = createCapabilityHealthProfile(action, provider, principal, boundaryDecision, effects, requiresApproval, acceptance, statusReconciliation, workflowGate, adapterHandoffRow, operationIdentity, providerBudgetRow, providerCallbackRow, providerExportBoundaryRow, providerMaintenanceRow, providerEventSubscriptionRow, adapterHandoffReceiptRow, recoveryCheckpointRow);
  const lifecycle = createCapabilityLifecycleControls(capability, action, provider, principal, boundaryDecision, health, effects, acceptance, statusReconciliation, workflowGate, adapterHandoffRow, providerBudgetRow, settingsAdoptionRow, providerCallbackRow, providerExportBoundaryRow, providerMaintenanceRow, providerExportPublicationRow, lifecycleGateRow, providerEventSubscriptionRow);
  const providerSyncScopeRow = findProviderSyncScopeRow(action, principal);
  const segmentSyncReceiptRow = findSegmentSyncReceiptRow(action, principal);
  const statusState = boundaryDecision.decision === "hold"
    ? "held-for-boundary-review"
    : acceptance.state === "rejected"
      ? "operator-rejected"
    : ["failed", "timed-out", "cancelled"].includes(statusReconciliation.state)
      ? "adapter-status-failed"
    : statusReconciliation.state === "missing-status"
      ? "adapter-status-missing"
    : effects.operatorApprovalRequired
      ? "awaiting-operator-approval"
      : writesExternal
        ? "ready-for-provider-handoff"
        : "local-ready";
  const providerSync = createCapabilityProviderSyncContract(capability, action, provider, principal, lifecycle, health, effects, providerSyncScopeRow);

  return Object.freeze({
    action,
    provider,
    boundary,
    serviceScopes: freezeArray(scopes),
    risk: requiresApproval ? action.includes("schedule") || action.includes("send") ? "high" : "medium" : "low",
    effects,
    boundaryDecision,
    statusReconciliation,
    acceptance,
    health,
    lifecycle,
    workflowGate,
    providerSync,
    segmentSyncReceipt: segmentSyncReceiptRow ? Object.freeze({
      rowId: compactString(segmentSyncReceiptRow.rowId),
      action: compactString(segmentSyncReceiptRow.action),
      state: compactString(segmentSyncReceiptRow.state),
      audienceId: compactString(segmentSyncReceiptRow.audienceId),
      segmentId: compactString(segmentSyncReceiptRow.segmentId),
      receiptToken: compactString(segmentSyncReceiptRow.receiptToken),
      providerRequestId: compactString(segmentSyncReceiptRow.providerRequestId),
      checkpointKey: compactString(segmentSyncReceiptRow.checkpointKey),
      cursor: compactString(segmentSyncReceiptRow.cursor),
      missing: freezeArray(toArray(segmentSyncReceiptRow.missing).map(compactString).filter(Boolean)),
      acceptedForAdapter: compactString(segmentSyncReceiptRow.state) === "accepted",
      nextCommand: compactString(segmentSyncReceiptRow.nextCommand || "observe"),
    }) : null,
    operationIdentity,
    recoveryCheckpoint: recoveryCheckpointRow ? Object.freeze({
      rowId: compactString(recoveryCheckpointRow.rowId),
      action: compactString(recoveryCheckpointRow.action),
      state: compactString(recoveryCheckpointRow.state),
      commandId: compactString(recoveryCheckpointRow.commandId),
      replayKey: compactString(recoveryCheckpointRow.replayKey),
      safeToReplay: recoveryCheckpointRow.safeToReplay === true,
      missing: freezeArray(toArray(recoveryCheckpointRow.missing).map(compactString).filter(Boolean)),
      nextCommand: compactString(recoveryCheckpointRow.nextCommand || "observe"),
    }) : null,
    audit: Object.freeze({
      event: provider === "mailchimp" ? "mailchimp.capability.boundary_decision" : "runtime.capability.boundary_decision",
      tenantId: principal.tenantId,
      workspaceId: principal.workspaceId,
      actorId: principal.actorId,
      requestId: principal.requestId,
      statusChannel: principal.statusChannel,
      statusSnapshotKey: principal.statusSnapshotKey,
      adapterStatusState: statusReconciliation.state,
      adapterStatusNextCommand: statusReconciliation.nextCommand,
      providerCallbackState: lifecycle.providerCallback?.state || "not-required",
      providerCallbackId: lifecycle.providerCallback?.callbackId || "",
      providerCallbackNextCommand: lifecycle.providerCallback?.nextCommand || "observe",
      providerEventSubscriptionState: lifecycle.providerEventSubscription?.state || "not-required",
      providerEventSubscriptionId: lifecycle.providerEventSubscription?.subscriptionId || "",
      providerEventSubscriptionNextCommand: lifecycle.providerEventSubscription?.nextCommand || "observe",
      providerMaintenanceState: lifecycle.providerMaintenance?.state || "not-required",
      providerMaintenanceWindowId: lifecycle.providerMaintenance?.windowId || "",
      providerServiceWindowId: lifecycle.providerMaintenance?.serviceWindow?.serviceWindowId || "",
      providerServiceState: lifecycle.providerMaintenance?.serviceWindow?.state || "available",
      providerServiceNextCommand: lifecycle.providerMaintenance?.serviceWindow?.nextCommand || lifecycle.providerMaintenance?.nextCommand || "observe",
      providerMaintenanceRetryAfterMs: lifecycle.providerMaintenance?.retryAfterMs ?? 0,
      providerMaintenanceNextCommand: lifecycle.providerMaintenance?.nextCommand || "observe",
      providerExportBoundaryState: lifecycle.providerExportBoundary?.state || "not-required",
      providerExportLaneKey: lifecycle.providerExportBoundary?.laneKey || "",
      providerExportBoundaryFingerprint: lifecycle.providerExportBoundary?.boundaryFingerprint || "",
      providerExportBoundaryNextCommand: lifecycle.providerExportBoundary?.nextCommand || "observe",
      providerPublicationState: lifecycle.providerPublication?.state || "not-required",
      providerPublicationId: lifecycle.providerPublication?.publicationId || "",
      providerPublicationNextCommand: lifecycle.providerPublication?.nextCommand || "observe",
      lifecycleGateState: lifecycle.lifecycleGate?.state || "not-required",
      lifecycleGateMode: lifecycle.lifecycleGate?.mode || "enabled",
      lifecycleGateNextCommand: lifecycle.lifecycleGate?.nextCommand || "observe",
      lifecycleOverrideReceiptState: lifecycle.lifecycleGate?.overrideReceipt?.state || "not-required",
      lifecycleOverrideReceiptCommand: lifecycle.lifecycleGate?.overrideReceipt?.command || "",
      lifecycleOverrideReceiptToken: lifecycle.lifecycleGate?.overrideReceipt?.receiptToken || "",
      lifecycleOverrideReceiptNextCommand: lifecycle.lifecycleGate?.overrideReceipt?.nextCommand || "observe",
      marketingConsentState: lifecycle.lifecycleGate?.marketingConsent?.state || "not-required",
      marketingConsentId: lifecycle.lifecycleGate?.marketingConsent?.consentId || "",
      marketingConsentNextCommand: lifecycle.lifecycleGate?.marketingConsent?.nextCommand || "observe",
      requiredPermission: boundaryDecision.requiredPermission,
      decision: boundaryDecision.decision,
      reasons: boundaryDecision.reasons,
      decisionSource: boundaryDecision.source,
      permissionLeaseState: boundaryDecision.leaseState,
      permissionLeaseToken: boundaryDecision.permissionLease?.token || "",
      permissionLeaseRetryAfterMs: boundaryDecision.leaseRecovery?.retryAfterMs ?? 0,
      permissionLeaseNextCommand: boundaryDecision.leaseRecovery?.nextCommand || "",
      permissionPostureState: boundaryDecision.permissionPosture?.state || "not-provided",
      permissionPostureFingerprint: boundaryDecision.permissionPosture?.fingerprint || "",
      permissionPostureNextCommand: boundaryDecision.permissionPosture?.nextCommand || "",
      permissionPostureGrantedByRole: boundaryDecision.permissionPosture?.grantedByRole === true,
      permissionPostureExplicitGrant: boundaryDecision.permissionPosture?.explicitGrant === true,
      workspaceBoundaryState: boundaryDecision.workspaceBoundary?.state || "not-provided",
      workspaceTransferToken: boundaryDecision.workspaceBoundary?.transferToken || "",
      workspaceBoundaryNextCommand: boundaryDecision.workspaceBoundary?.nextCommand || "",
      lifecycleMode: lifecycle.mode,
      lifecycleNextAction: lifecycle.nextAction,
      operatorAcceptanceState: acceptance.state,
      operatorAcceptanceToken: acceptance.token,
      syncState: providerSync.state,
      syncWatermarkKey: providerSync.metadata.watermarkKey,
      syncCheckpointKey: providerSync.metadata.checkpointKey,
      syncLeaseRefreshCommand: providerSync.metadata.leaseRefreshCommand,
      syncLeaseRetryAfterMs: providerSync.metadata.leaseRetryAfterMs,
      syncScopeState: providerSync.metadata.scopeSyncState,
      syncScopeNextCommand: providerSync.metadata.scopeSyncNextCommand,
      providerBudgetState: lifecycle.providerBudget.state,
      providerBudgetRetryAfterMs: lifecycle.providerBudget.retryAfterMs,
      providerBudgetNextCommand: lifecycle.providerBudget.nextCommand,
      settingsAdoptionState: lifecycle.settingsAdoption.state,
      settingsAdoptionNextCommand: lifecycle.settingsAdoption.nextCommand,
      settingsChangedFields: lifecycle.settingsAdoption.changedFields,
      operationId: operationIdentity?.operationId || "",
      operationState: operationIdentity?.state || "not-provided",
      operationNextCommand: operationIdentity?.nextCommand || "",
      persistedRecoveryCommandId: persistedRecoveryCommand?.commandId || "",
      persistedRecoveryReplayKey: persistedRecoveryCommand?.replayKey || "",
      persistedRecoveryState: persistedRecoveryCommand?.state || "not-provided",
      persistedRecoverySafeToReplay: persistedRecoveryCommand?.safeToReplay === true,
      resumptionJournalState: resumptionJournalRow?.state || "not-provided",
      resumptionJournalRowId: resumptionJournalRow?.rowId || "",
      resumptionJournalReplayKey: resumptionJournalRow?.replayKey || "",
      resumptionJournalSafeToReplay: resumptionJournalRow?.safeToReplay === true,
      resumptionJournalNextCommand: resumptionJournalRow?.nextCommand || "",
      recoveryCheckpointState: recoveryCheckpointRow?.state || "not-provided",
      recoveryCheckpointRowId: recoveryCheckpointRow?.rowId || "",
      recoveryCheckpointReplayKey: recoveryCheckpointRow?.replayKey || "",
      recoveryCheckpointSafeToReplay: recoveryCheckpointRow?.safeToReplay === true,
      recoveryCheckpointNextCommand: recoveryCheckpointRow?.nextCommand || "",
      adapterHandoffState: adapterHandoffRow?.state || "not-provided",
      adapterHandoffCommand: adapterHandoffRow?.command || "",
      adapterHandoffReceiptState: adapterHandoffReceiptRow?.state || "not-required",
      adapterHandoffReceiptToken: adapterHandoffReceiptRow?.receiptToken || "",
      adapterHandoffReceiptNextCommand: adapterHandoffReceiptRow?.nextCommand || "",
      workflowState: workflowGate.state,
      workflowNextCommand: workflowGate.nextCommand,
      clientCommandReceiptState: workflowGate.clientCommandReceipt?.state || "not-required",
      clientCommandReceiptCommandId: workflowGate.clientCommandReceipt?.commandId || "",
      clientCommandReceiptToken: workflowGate.clientCommandReceipt?.receiptToken || "",
      clientCommandReceiptNextCommand: workflowGate.clientCommandReceipt?.nextCommand || "",
      previewDecisionState: workflowGate.previewDecision?.state || "not-provided",
      previewDecisionNextCommand: workflowGate.previewDecision?.nextCommand || "",
      previewAcceptanceToken: workflowGate.previewDecision?.acceptanceToken || "",
      previewAcceptanceReceiptState: workflowGate.previewAcceptanceReceipt?.state || "not-required",
      previewAcceptanceReceiptToken: workflowGate.previewAcceptanceReceipt?.receiptToken || "",
      previewAcceptanceReceiptNextCommand: workflowGate.previewAcceptanceReceipt?.nextCommand || "",
      previewActionPlanState: previewActionPlan?.state || principal.previewActionPlanReadiness?.state || "not-required",
      previewActionPlanCommand: previewActionPlan?.command || principal.previewActionPlanReadiness?.nextStep?.command || "",
      previewActionPlanAcceptedForAdapter: previewActionPlan?.acceptedForAdapter === true,
      previewRuntimeHandoffState: previewRuntimeHandoff?.state || principal.previewRuntimeHandoffReadiness?.state || "not-required",
      previewRuntimeHandoffCommandId: previewRuntimeHandoff?.commandId || "",
      previewRuntimeHandoffNextCommand: previewRuntimeHandoff?.nextCommand || principal.previewRuntimeHandoffReadiness?.nextStep?.command || "",
      previewRuntimeHandoffAcceptedForAdapter: previewRuntimeHandoff?.acceptedForAdapter === true,
    }),
    handoff: Object.freeze({
      adapter: provider === "mailchimp" ? "mailchimp.campaignRuntimeAdapter" : "runtime",
      statusState,
      recoveryCommand: statusReconciliation.nextCommand && statusReconciliation.nextCommand !== "observe"
        ? statusReconciliation.nextCommand
        : lifecycle.nextAction === "queue_adapter_handoff" ? "retry_same_idempotency_key" : lifecycle.nextAction,
      retry: health.retry,
      statusReconciliation,
      operatorAcceptance: acceptance,
      recoveryCheckpoint: recoveryCheckpointRow ? Object.freeze({
        state: compactString(recoveryCheckpointRow.state),
        replayKey: compactString(recoveryCheckpointRow.replayKey),
        safeToReplay: recoveryCheckpointRow.safeToReplay === true,
        nextCommand: compactString(recoveryCheckpointRow.nextCommand || "observe"),
      }) : null,
      workflowGate,
      previewActionPlan: previewActionPlan ? Object.freeze({
        rowId: compactString(previewActionPlan.rowId),
        state: compactString(previewActionPlan.state),
        command: compactString(previewActionPlan.command || previewActionPlan.nextCommand || "observe"),
        acceptedForRuntime: previewActionPlan.acceptedForRuntime === true,
        acceptedForAdapter: previewActionPlan.acceptedForAdapter === true,
        acceptanceToken: compactString(previewActionPlan.acceptanceToken),
        receiptToken: compactString(previewActionPlan.receiptToken),
        commandId: compactString(previewActionPlan.commandId),
        missing: freezeArray(toArray(previewActionPlan.missing).map(compactString).filter(Boolean)),
        userVisible: previewActionPlan.userVisible || null,
      }) : null,
      previewRuntimeHandoff: previewRuntimeHandoff ? Object.freeze({
        rowId: compactString(previewRuntimeHandoff.rowId),
        state: compactString(previewRuntimeHandoff.state),
        acceptedForRuntime: previewRuntimeHandoff.acceptedForRuntime === true,
        acceptedForAdapter: previewRuntimeHandoff.acceptedForAdapter === true,
        commandId: compactString(previewRuntimeHandoff.commandId),
        acceptanceToken: compactString(previewRuntimeHandoff.acceptanceToken),
        receiptToken: compactString(previewRuntimeHandoff.receiptToken),
        missing: freezeArray(toArray(previewRuntimeHandoff.missing).map(compactString).filter(Boolean)),
        nextCommand: compactString(previewRuntimeHandoff.nextCommand || "observe"),
      }) : null,
      previewAcceptanceReceipt: workflowGate.previewAcceptanceReceipt,
      clientCommandReceipt: workflowGate.clientCommandReceipt,
      adapterHandoff: adapterHandoffRow || null,
      adapterHandoffReceipt: adapterHandoffReceiptRow || null,
      operationIdentity,
      persistedRecoveryCommand,
      resumptionJournalRow,
      providerSync,
      providerSyncScopeRow,
      segmentSyncReceipt: segmentSyncReceiptRow || null,
      providerBudget: lifecycle.providerBudget,
      providerCallback: lifecycle.providerCallback,
      providerEventSubscription: lifecycle.providerEventSubscription,
      providerMaintenance: lifecycle.providerMaintenance,
      providerExportBoundary: lifecycle.providerExportBoundary,
      providerPublication: lifecycle.providerPublication,
      lifecycleGate: lifecycle.lifecycleGate,
      settingsAdoption: lifecycle.settingsAdoption,
      permissionLease: boundaryDecision.permissionLease,
    }),
  });
}

function createCapabilityOperationalReport(contracts = [], diagnostics = []) {
  const blocked = contracts.filter((contract) => contract.health.state === "blocked");
  const degraded = contracts.filter((contract) => contract.health.degradedMode !== "none" && contract.health.state !== "blocked");
  const retryable = contracts.filter((contract) => contract.health.retry.retryable);
  const disabled = contracts.filter((contract) => contract.lifecycle?.mode === "disabled");
  const pendingAcceptance = contracts.filter((contract) => contract.acceptance?.state === "pending");
  const rejectedAcceptance = contracts.filter((contract) => contract.acceptance?.state === "rejected");
  const syncBlocked = contracts.filter((contract) => contract.providerSync?.state === "blocked");
  const syncPending = contracts.filter((contract) => contract.providerSync?.state === "needs-provider-confirmation");
  const syncScopeBlocked = contracts.filter((contract) => contract.providerSync?.metadata?.scopeSyncState === "blocked");
  const workflowBlocked = contracts.filter((contract) => contract.workflowGate?.acceptedForAdapter === false);
  const workflowReady = contracts.filter((contract) => contract.workflowGate?.state === "ready");
  const statusFailures = contracts.filter((contract) => ["failed", "timed-out", "cancelled"].includes(contract.statusReconciliation?.state));
  const statusMissing = contracts.filter((contract) => contract.statusReconciliation?.state === "missing-status");
  const statusSnapshotBlocked = contracts.filter((contract) => contract.statusReconciliation?.state === "snapshot-blocked");
  const leaseBlocked = contracts.filter((contract) => contract.lifecycle?.controls?.requirePermissionLeaseRefresh === true);
  const settingsBlocked = contracts.filter((contract) => contract.lifecycle?.settingsAdoption?.state === "blocked");
  const settingsPatchRequired = contracts.filter((contract) => contract.lifecycle?.settingsAdoption?.state === "patch-required");
  const persistedRecoveryCommands = contracts.map((contract) => contract.handoff?.persistedRecoveryCommand).filter(Boolean);
  const blockedPersistedRecovery = persistedRecoveryCommands.filter((command) => command.state === "blocked" || command.safeToReplay === false);
  const replayablePersistedRecovery = persistedRecoveryCommands.filter((command) => command.safeToReplay === true);

  return Object.freeze({
    protocol: "aios.capability.operational-report.v1",
    state: blocked.length > 0 ? "blocked" : degraded.length > 0 ? "degraded" : "healthy",
    acceptedForAdapter: blocked.length === 0
      && degraded.length === 0
      && pendingAcceptance.length === 0
      && rejectedAcceptance.length === 0
      && diagnostics.every((diagnostic) => diagnostic.level !== "error"),
    acceptedForPreview: true,
    acceptance: Object.freeze({
      pending: freezeArray(pendingAcceptance.map((contract) => ({
        action: contract.action,
        token: contract.acceptance.token,
        missing: contract.acceptance.missing,
        nextCommand: contract.acceptance.nextCommand,
      }))),
      rejected: freezeArray(rejectedAcceptance.map((contract) => ({
        action: contract.action,
        token: contract.acceptance.token,
        rejectedBy: contract.acceptance.rejectedBy,
        rejectedAt: contract.acceptance.rejectedAt,
        nextCommand: contract.acceptance.nextCommand,
      }))),
    }),
    blockedCapabilities: freezeArray(blocked.map((contract) => ({
      action: contract.action,
      nextCommand: contract.health.actionableError?.nextCommand || "resolve_actionable_errors",
      reasons: contract.boundaryDecision.reasons,
    }))),
    degradedCapabilities: freezeArray(degraded.map((contract) => ({
      action: contract.action,
      mode: contract.health.degradedMode,
      nextCommand: contract.lifecycle?.nextAction || contract.health.actionableError?.nextCommand || "observe",
    }))),
    disabledCapabilities: freezeArray(disabled.map((contract) => ({
      action: contract.action,
      nextAction: contract.lifecycle?.nextAction || "repair_capability_settings",
      settingsValidation: contract.lifecycle?.settingsValidation || freezeArray([]),
      settingsAdoption: contract.lifecycle?.settingsAdoption || null,
      scheduling: contract.lifecycle?.scheduling || null,
    }))),
    permissionLeases: Object.freeze({
      blocked: freezeArray(leaseBlocked.map((contract) => ({
        action: contract.action,
        token: contract.boundaryDecision?.permissionLease?.token || "",
        state: contract.boundaryDecision?.leaseState || "blocked",
        nextCommand: contract.lifecycle?.nextAction || contract.boundaryDecision?.leaseRecovery?.nextCommand || "refresh_mailchimp_permission_lease",
        retryAfterMs: contract.boundaryDecision?.leaseRecovery?.retryAfterMs ?? 0,
        strategy: contract.boundaryDecision?.leaseRecovery?.backoff?.strategy || "bounded-refresh",
        reasons: freezeArray(toArray(contract.boundaryDecision?.reasons).filter((reason) => compactString(reason).includes("permission-lease"))),
      }))),
      active: freezeArray(contracts
        .filter((contract) => contract.boundaryDecision?.leaseState === "ready")
        .map((contract) => ({
          action: contract.action,
          token: contract.boundaryDecision?.permissionLease?.token || "",
          expiresAt: contract.boundaryDecision?.permissionLease?.expiresAt || "",
          retryAfterMs: contract.boundaryDecision?.leaseRecovery?.retryAfterMs ?? 0,
        }))),
    }),
    retryBackoff: freezeArray(retryable.map((contract) => ({
      action: contract.action,
      strategy: contract.health.retry.strategy,
      baseDelayMs: contract.health.retry.baseDelayMs,
      maxDelayMs: contract.health.retry.maxDelayMs,
      statuses: contract.health.retry.retryableStatuses,
    }))),
    persistedRecovery: Object.freeze({
      state: blockedPersistedRecovery.length > 0
        ? "blocked"
        : replayablePersistedRecovery.length > 0
          ? "replayable"
          : persistedRecoveryCommands.length > 0
            ? "waiting"
            : "not-required",
      commandLedgerKeys: freezeArray([...new Set(persistedRecoveryCommands.map((command) => command.commandLedgerKey).filter(Boolean))]),
      replayableCommands: freezeArray(replayablePersistedRecovery.map((command) => ({
        commandId: command.commandId,
        replayKey: command.replayKey,
        command: command.command,
        phase: command.phase,
        capability: command.capability,
        stepName: command.stepName,
        replayPolicy: command.replayPolicy,
      }))),
      blockedCommands: freezeArray(blockedPersistedRecovery.map((command) => ({
        commandId: command.commandId,
        command: command.command,
        phase: command.phase,
        capability: command.capability,
        stepName: command.stepName,
        nextCommand: command.nextCommand,
        blockedBy: command.blockedBy,
      }))),
      counters: Object.freeze({
        commands: persistedRecoveryCommands.length,
        replayable: replayablePersistedRecovery.length,
        blocked: blockedPersistedRecovery.length,
      }),
    }),
    providerSync: Object.freeze({
      blocked: freezeArray(syncBlocked.map((contract) => ({
        action: contract.action,
        nextCommand: contract.providerSync.nextCommand,
        validation: contract.providerSync.validation,
      }))),
      needsConfirmation: freezeArray(syncPending.map((contract) => ({
        action: contract.action,
        resources: contract.providerSync.resources,
        nextCommand: contract.providerSync.nextCommand,
      }))),
      checkpointKeys: freezeArray([...new Set(contracts.map((contract) => contract.providerSync?.metadata?.checkpointKey).filter(Boolean))]),
      watermarkKeys: freezeArray([...new Set(contracts.map((contract) => contract.providerSync?.metadata?.watermarkKey).filter(Boolean))]),
      scopeBlocked: freezeArray(syncScopeBlocked.map((contract) => ({
        action: contract.action,
        state: contract.providerSync.metadata.scopeSyncState,
        nextCommand: contract.providerSync.metadata.scopeSyncNextCommand || contract.providerSync.nextCommand,
      }))),
    }),
    settingsAdoption: Object.freeze({
      blocked: freezeArray(settingsBlocked.map((contract) => ({
        action: contract.action,
        missing: contract.lifecycle.settingsAdoption.missing,
        nextCommand: contract.lifecycle.settingsAdoption.nextCommand,
      }))),
      patchRequired: freezeArray(settingsPatchRequired.map((contract) => ({
        action: contract.action,
        changedFields: contract.lifecycle.settingsAdoption.changedFields,
        nextCommand: contract.lifecycle.settingsAdoption.nextCommand,
      }))),
      states: freezeArray([...new Set(contracts.map((contract) => contract.lifecycle?.settingsAdoption?.state).filter(Boolean))]),
    }),
    clientWorkflow: Object.freeze({
      blocked: freezeArray(workflowBlocked.map((contract) => ({
        action: contract.action,
        state: contract.workflowGate.state,
        nextCommand: contract.workflowGate.nextCommand,
        blockedCommands: contract.workflowGate.blockedCommands,
      }))),
      ready: freezeArray(workflowReady.map((contract) => ({
        action: contract.action,
        nextCommand: contract.workflowGate.nextCommand,
        readyCommands: contract.workflowGate.readyCommands,
      }))),
    }),
    adapterStatus: Object.freeze({
      failures: freezeArray(statusFailures.map((contract) => ({
        action: contract.action,
        state: contract.statusReconciliation.state,
        message: contract.statusReconciliation.message,
        nextCommand: contract.statusReconciliation.nextCommand,
      }))),
      missing: freezeArray(statusMissing.map((contract) => ({
        action: contract.action,
        statusSnapshotKey: contract.statusReconciliation.statusSnapshotKey,
        nextCommand: contract.statusReconciliation.nextCommand,
      }))),
      snapshotBlocked: freezeArray(statusSnapshotBlocked.map((contract) => ({
        action: contract.action,
        statusSnapshotKey: contract.statusReconciliation.statusSnapshotKey,
        snapshotRowKey: contract.statusReconciliation.snapshotRowKey,
        missing: contract.statusReconciliation.snapshotMissing,
        nextCommand: contract.statusReconciliation.nextCommand,
      }))),
    }),
    operatorActionQueue: createCapabilityOperatorActionQueue(contracts, diagnostics),
  });
}

function createCapabilityOperatorActionQueue(contracts = [], diagnostics = []) {
  const rows = [];
  const pushRow = (contract, lane, state, nextCommand, detail, priority, extra = {}) => {
    rows.push(Object.freeze({
      action: contract.action,
      provider: contract.provider,
      lane,
      state,
      priority,
      nextCommand,
      detail,
      idempotencyKey: compactString(extra.idempotencyKey || contract.effects?.operatorAcceptanceToken || ""),
      statusChannel: compactString(extra.statusChannel || contract.audit?.statusChannel || ""),
      statusSnapshotKey: compactString(extra.statusSnapshotKey || contract.audit?.statusSnapshotKey || ""),
      requiredPermission: compactString(contract.boundaryDecision?.requiredPermission || ""),
      acceptanceToken: compactString(contract.acceptance?.token || ""),
      retry: extra.retry || null,
      sync: extra.sync || null,
    }));
  };

  for (const contract of toArray(contracts)) {
    if (contract.boundaryDecision?.decision === "hold") {
      const leaseReasons = toArray(contract.boundaryDecision?.reasons).filter((reason) => compactString(reason).includes("permission-lease"));
      pushRow(
        contract,
        leaseReasons.length > 0 ? "permission-lease" : "boundary",
        "blocked",
        leaseReasons.length > 0 ? contract.boundaryDecision?.leaseRecovery?.nextCommand || "refresh_mailchimp_permission_lease" : contract.health?.actionableError?.nextCommand || "resolve_boundary_hold",
        leaseReasons.join(", ") || toArray(contract.boundaryDecision?.reasons).join(", ") || "boundary hold",
        10,
        {
          sync: leaseReasons.length > 0 ? Object.freeze({
            state: contract.boundaryDecision?.leaseState || "blocked",
            leaseToken: contract.boundaryDecision?.permissionLease?.token || "",
            expiresAt: contract.boundaryDecision?.permissionLease?.expiresAt || "",
            retryAfterMs: contract.boundaryDecision?.leaseRecovery?.retryAfterMs ?? 0,
            strategy: contract.boundaryDecision?.leaseRecovery?.backoff?.strategy || "bounded-refresh",
          }) : null,
        }
      );
      continue;
    }

    if (contract.acceptance?.state === "rejected") {
      pushRow(
        contract,
        "acceptance",
        "blocked",
        "revise_or_cancel_provider_action",
        "operator acceptance rejected",
        9
      );
      continue;
    }

    if (contract.acceptance?.state === "pending") {
      pushRow(
        contract,
        "acceptance",
        "waiting",
        contract.acceptance.nextCommand || "collect_verifier_evidence",
        toArray(contract.acceptance.missing).join(", ") || "operator acceptance pending",
        8
      );
    }

    if (contract.lifecycle?.mode === "disabled") {
      pushRow(
        contract,
        ["failed", "timed-out", "cancelled", "missing-status"].includes(contract.statusReconciliation?.state) ? "adapter-status" : "lifecycle",
        "blocked",
        contract.lifecycle.nextAction || "repair_capability_settings",
        contract.statusReconciliation?.message
          || toArray(contract.lifecycle.settingsValidation).map((item) => item.reason).join(", ")
          || "lifecycle disabled",
        7
      );
    }

    if (contract.providerSync?.state === "blocked") {
      pushRow(
        contract,
        "provider-sync",
        "blocked",
        contract.providerSync.nextCommand || "repair_provider_sync_metadata",
        toArray(contract.providerSync.validation).map((item) => item.reason).join(", ") || "provider sync metadata blocked",
        6,
        {
          sync: Object.freeze({
            state: contract.providerSync.state,
            checkpointKey: contract.providerSync.metadata?.checkpointKey || "",
            watermarkKey: contract.providerSync.metadata?.watermarkKey || "",
          }),
        }
      );
    } else if (contract.providerSync?.state === "needs-provider-confirmation") {
      pushRow(
        contract,
        "provider-sync",
        "waiting",
        contract.providerSync.nextCommand || "confirm_provider_resource_state",
        "provider resource identity needs confirmation",
        4,
        {
          sync: Object.freeze({
            state: contract.providerSync.state,
            resources: contract.providerSync.resources,
          }),
        }
      );
    }

    if (contract.workflowGate?.acceptedForAdapter === false) {
      pushRow(
        contract,
        "client-workflow",
        "blocked",
        contract.workflowGate.nextCommand || "resolve_runtime_readiness",
        toArray(contract.workflowGate.blockedCommands).map((command) => command.reason || command.command).join(", ") || "client workflow handoff blocked",
        8
      );
    }

    if (contract.health?.state === "degraded-no-status-snapshot") {
      pushRow(
        contract,
        "status",
        "degraded",
        "attach_status_snapshot_store",
        "status snapshot key is required for restart-safe adapter handoff",
        5
      );
    }

    if (contract.lifecycle?.controls?.enableAdapterHandoff === true) {
      pushRow(
        contract,
        "handoff",
        "ready",
        "queue_adapter_handoff",
        contract.providerSync?.state === "checkpoint-ready" ? "provider checkpoint ready" : "adapter handoff ready",
        1,
        {
          idempotencyKey: contract.effects?.operatorAcceptanceToken,
          retry: contract.health?.retry || null,
          sync: Object.freeze({
            state: contract.providerSync?.state || "not-applicable",
            checkpointKey: contract.providerSync?.metadata?.checkpointKey || "",
            watermarkKey: contract.providerSync?.metadata?.watermarkKey || "",
          }),
        }
      );
    } else if (contract.health?.retry?.retryable === true) {
      pushRow(
        contract,
        "retry",
        "ready",
        "retry_same_idempotency_key",
        "retryable provider operation",
        3,
        { retry: contract.health.retry }
      );
    }
  }

  const diagnosticRows = toArray(diagnostics)
    .filter((diagnostic) => diagnostic.level === "error")
    .map((diagnostic, index) => Object.freeze({
      action: compactString(diagnostic.capabilityName || diagnostic.code || `diagnostic:${index + 1}`),
      provider: "diagnostic",
      lane: "diagnostic",
      state: "blocked",
      priority: 11,
      nextCommand: compactString(diagnostic.nextCommand || "resolve_capability_diagnostic"),
      detail: compactString(diagnostic.message),
      idempotencyKey: "",
      statusChannel: "",
      statusSnapshotKey: "",
      requiredPermission: "",
      acceptanceToken: "",
      retry: null,
      sync: null,
    }));
  const queue = [...rows, ...diagnosticRows]
    .sort((left, right) => right.priority - left.priority || left.action.localeCompare(right.action) || left.lane.localeCompare(right.lane));
  const blocked = queue.filter((row) => row.state === "blocked");
  const waiting = queue.filter((row) => row.state === "waiting");
  const ready = queue.filter((row) => row.state === "ready");

  return Object.freeze({
    protocol: "aios.capability.operator-action-queue.v1",
    state: blocked.length > 0 ? "blocked" : waiting.length > 0 ? "waiting" : ready.length > 0 ? "ready" : "empty",
    acceptedForAdapter: blocked.length === 0 && waiting.length === 0,
    nextCommand: blocked[0]?.nextCommand || waiting[0]?.nextCommand || ready[0]?.nextCommand || "observe",
    rows: freezeArray(queue),
    summary: Object.freeze({
      total: queue.length,
      blocked: blocked.length,
      waiting: waiting.length,
      ready: ready.length,
      degraded: queue.filter((row) => row.state === "degraded").length,
      mailchimpRows: queue.filter((row) => row.provider === "mailchimp").length,
    }),
  });
}

function createCapabilityAnalyticsSnapshot(jobName, principal = {}, contracts = [], diagnostics = [], scopeSnapshot = {}) {
  const mailchimpContracts = contracts.filter((contract) => contract.provider === "mailchimp");
  const scopeExportRows = toArray(scopeSnapshot.exportRows);
  const scopeExportHistory = scopeSnapshot.exportHistory || {};
  const staleHistoryRows = toArray(scopeExportHistory.staleRows);
  const blockedHistoryRows = toArray(scopeExportHistory.blockedRows);
  const blockedScopeRows = scopeExportRows.filter((row) => row.exportable === false || toArray(row.blockedBy).length > 0);
  const scopeRowsByAction = new Map(scopeExportRows.map((row) => [compactString(row.action), row]));
  const byDecision = mailchimpContracts.reduce((counts, contract) => {
    const decision = contract.boundaryDecision?.decision || "unknown";
    counts[decision] = (counts[decision] || 0) + 1;
    return counts;
  }, {});
  const byRisk = contracts.reduce((counts, contract) => {
    const risk = contract.risk || "unknown";
    counts[risk] = (counts[risk] || 0) + 1;
    return counts;
  }, {});
  const holdReasons = new Map();
  const providerHandoffRows = mailchimpContracts.map((contract, index) => {
    const lifecycle = contract.lifecycle || {};
    const boundaryDecision = contract.boundaryDecision || {};
    const providerSync = contract.providerSync || {};
    const workflowGate = contract.workflowGate || {};
    const statusReconciliation = contract.statusReconciliation || {};
    const providerExportBoundary = lifecycle.providerExportBoundary || {};
    const providerPublication = lifecycle.providerPublication || {};
    const providerMaintenance = lifecycle.providerMaintenance || {};
    const providerCallback = lifecycle.providerCallback || {};
    const providerEventSubscription = lifecycle.providerEventSubscription || {};
    const settingsAdoption = lifecycle.settingsAdoption || {};
    const lifecycleGate = lifecycle.lifecycleGate || {};
    const blockers = [
      ...toArray(boundaryDecision.reasons).map(compactString).filter(Boolean),
      lifecycle.mode === "disabled" && "lifecycle-disabled",
      lifecycle.controls?.enableAdapterHandoff !== true && "adapter-handoff-disabled",
      workflowGate.acceptedForAdapter === false && "client-workflow-blocked",
      providerSync.state === "blocked" && "provider-sync-blocked",
      providerSync.metadata?.scopeSyncState === "blocked" && "scope-sync-blocked",
      providerCallback.state === "blocked" && "provider-callback-blocked",
      providerEventSubscription.state === "blocked" && "provider-event-subscription-blocked",
      providerMaintenance.state === "blocked" && "provider-maintenance-blocked",
      providerExportBoundary.exportable === false && "provider-export-boundary-blocked",
      providerPublication.state === "blocked" && "provider-publication-blocked",
      providerPublication.receiptState === "blocked" && "provider-publication-receipt-blocked",
      settingsAdoption.state === "blocked" && "settings-adoption-blocked",
      ["blocked", "disabled"].includes(lifecycleGate.state) && "lifecycle-gate-blocked",
      lifecycle.controls?.requireLifecycleCommandReceipt === true && "lifecycle-command-receipt-required",
      lifecycle.controls?.requireMarketingConsent === true && "marketing-consent-required",
      contract.operationIdentity?.state === "blocked" && "operation-identity-blocked",
      contract.recoveryCheckpoint?.state === "blocked" && "recovery-checkpoint-blocked",
      ["failed", "timed-out", "cancelled"].includes(statusReconciliation.state) && "adapter-status-terminal",
      statusReconciliation.state === "snapshot-blocked" && "adapter-status-snapshot-blocked",
      statusReconciliation.state === "missing-status" && "adapter-status-missing",
      contract.acceptance?.state === "rejected" && "operator-acceptance-rejected",
    ].filter(Boolean);
    const waiting = [
      providerSync.state === "needs-provider-confirmation" && "provider-sync-confirmation",
      providerCallback.state === "pending-verification" && "provider-callback-verification",
      providerEventSubscription.state === "pending" && "provider-event-subscription",
      providerMaintenance.state === "degraded" && "provider-maintenance",
      providerPublication.receiptState && ["pending", "pending-receipt", "needs-receipt"].includes(providerPublication.receiptState) && "provider-publication-receipt",
      workflowGate.state === "ready" && "client-workflow-ready",
      statusReconciliation.state === "pending" && "adapter-status-pending",
      contract.acceptance?.state === "pending" && "operator-acceptance",
      settingsAdoption.state === "patch-required" && "settings-patch",
      lifecycleGate.state === "gated" && "lifecycle-gate",
    ].filter(Boolean);
    const ready = blockers.length === 0
      && waiting.length === 0
      && lifecycle.controls?.enableAdapterHandoff === true
      && providerSync.state !== "blocked";
    const state = blockers.length > 0
      ? "blocked"
      : ready
        ? "ready"
        : waiting.length > 0
          ? "waiting"
          : "preview";
    const nextCommand = blockers.length > 0
      ? lifecycle.nextAction || contract.health?.actionableError?.nextCommand || workflowGate.nextCommand || statusReconciliation.nextCommand || "resolve_provider_handoff"
      : waiting.length > 0
        ? providerSync.nextCommand
          || providerCallback.nextCommand
          || providerEventSubscription.nextCommand
          || providerPublication.blockedReceiptRows?.[0]?.nextCommand
          || workflowGate.nextCommand
          || statusReconciliation.nextCommand
          || "observe_provider_handoff"
        : ready
          ? "queue_adapter_handoff"
          : lifecycle.nextAction || "continue_preview";

    return Object.freeze({
      rowId: stableContractToken("provider-handoff-readiness", [
        principal.tenantId,
        principal.workspaceId,
        principal.requestId,
        contract.action,
      ]),
      index,
      action: contract.action,
      provider: contract.provider,
      state,
      phase: blockers.some((reason) => reason.includes("permission") || reason.includes("lease"))
        ? "permission"
        : blockers.some((reason) => reason.includes("publication") || reason.includes("export"))
          ? "analytics-export"
          : blockers.some((reason) => reason.includes("status"))
            ? "adapter-status"
            : blockers.some((reason) => reason.includes("workflow") || reason.includes("acceptance"))
              ? "client-acceptance"
              : waiting.length > 0
                ? "provider-confirmation"
                : ready
                  ? "adapter-handoff"
                  : "preview",
      readyForAdapter: ready,
      exportable: providerExportBoundary.exportable === true && !["blocked", "missing", "stale"].includes(scopeRowsByAction.get(contract.action)?.state),
      nextCommand,
      statusChannel: compactString(contract.audit?.statusChannel || principal.statusChannel),
      statusSnapshotKey: compactString(contract.audit?.statusSnapshotKey || principal.statusSnapshotKey),
      requestId: compactString(contract.audit?.requestId || principal.requestId),
      blockedBy: freezeArray([...new Set(blockers)].sort()),
      waitingOn: freezeArray([...new Set(waiting)].sort()),
      requiredPermission: compactString(boundaryDecision.requiredPermission),
      permissionLeaseState: compactString(boundaryDecision.leaseState || "not-required"),
      providerSyncState: compactString(providerSync.state || "not-applicable"),
      workflowState: compactString(workflowGate.state || "not-required"),
      adapterStatusState: compactString(statusReconciliation.state || "unobserved"),
      publicationState: compactString(providerPublication.state || "not-required"),
      publicationReceiptState: compactString(providerPublication.receiptState || "not-required"),
    });
  });
  const providerHandoffBlocked = providerHandoffRows.filter((row) => row.state === "blocked");
  const providerHandoffWaiting = providerHandoffRows.filter((row) => row.state === "waiting");
  const providerHandoffReady = providerHandoffRows.filter((row) => row.state === "ready");

  for (const contract of mailchimpContracts) {
    for (const reason of toArray(contract.boundaryDecision?.reasons)) {
      const key = compactString(reason);
      if (key) holdReasons.set(key, (holdReasons.get(key) || 0) + 1);
    }
  }

  return Object.freeze({
    protocol: "aios.capability.analytics-snapshot.v1",
    jobName: compactString(jobName || "anonymous"),
    tenantId: principal.tenantId,
    workspaceId: principal.workspaceId,
    actorId: principal.actorId,
    state: diagnostics.some((diagnostic) => diagnostic.level === "error")
      ? "blocked"
      : mailchimpContracts.some((contract) => contract.health?.degradedMode !== "none")
        ? "degraded"
        : "healthy",
    counters: Object.freeze({
      totalCapabilities: contracts.length,
      mailchimpCapabilities: mailchimpContracts.length,
      externalWrites: contracts.filter((contract) => contract.effects.externalWrite).length,
      approvals: contracts.filter((contract) => contract.effects.requiredApproval).length,
      held: mailchimpContracts.filter((contract) => contract.boundaryDecision?.decision === "hold").length,
      permissionLeaseBlocked: mailchimpContracts.filter((contract) => contract.lifecycle?.controls?.requirePermissionLeaseRefresh === true).length,
      permissionLeaseReady: mailchimpContracts.filter((contract) => contract.boundaryDecision?.leaseState === "ready").length,
      permissionPostureBlocked: mailchimpContracts.filter((contract) => contract.boundaryDecision?.permissionPosture?.state?.endsWith?.("blocked")).length,
      permissionPostureCovered: mailchimpContracts.filter((contract) => contract.boundaryDecision?.permissionPosture?.state === "covered").length,
      permissionPostureGrantBlocked: mailchimpContracts.filter((contract) => contract.boundaryDecision?.permissionPosture?.state === "grant-blocked").length,
      permissionPostureLeaseBlocked: mailchimpContracts.filter((contract) => contract.boundaryDecision?.permissionPosture?.state === "lease-blocked").length,
      permissionPostureIdentityBlocked: mailchimpContracts.filter((contract) => contract.boundaryDecision?.permissionPosture?.state === "identity-blocked").length,
      scopeSourcedDecisions: mailchimpContracts.filter((contract) => contract.boundaryDecision?.source === "scope-permission-boundary").length,
      degraded: contracts.filter((contract) => contract.health?.degradedMode !== "none").length,
      retryable: contracts.filter((contract) => contract.health?.retry?.retryable).length,
      syncBlocked: mailchimpContracts.filter((contract) => contract.providerSync?.state === "blocked").length,
      syncPending: mailchimpContracts.filter((contract) => contract.providerSync?.state === "needs-provider-confirmation").length,
      syncCheckpointReady: mailchimpContracts.filter((contract) => contract.providerSync?.state === "checkpoint-ready").length,
      syncScopeBlocked: mailchimpContracts.filter((contract) => contract.providerSync?.metadata?.scopeSyncState === "blocked").length,
      adapterStatusFailures: mailchimpContracts.filter((contract) => ["failed", "timed-out", "cancelled"].includes(contract.statusReconciliation?.state)).length,
      adapterStatusMissing: mailchimpContracts.filter((contract) => contract.statusReconciliation?.state === "missing-status").length,
      adapterStatusSnapshotBlocked: mailchimpContracts.filter((contract) => contract.statusReconciliation?.state === "snapshot-blocked").length,
      adapterStatusSucceeded: mailchimpContracts.filter((contract) => contract.statusReconciliation?.state === "succeeded").length,
      workflowBlocked: mailchimpContracts.filter((contract) => contract.workflowGate?.acceptedForAdapter === false).length,
      workflowReady: mailchimpContracts.filter((contract) => contract.workflowGate?.state === "ready").length,
      operationIdentityRows: mailchimpContracts.filter((contract) => contract.operationIdentity).length,
      operationIdentityBlocked: mailchimpContracts.filter((contract) => contract.operationIdentity?.state === "blocked" || contract.health?.degradedMode === "operation-identity").length,
      providerExportBoundaryBlocked: mailchimpContracts.filter((contract) => contract.lifecycle?.providerExportBoundary?.state === "blocked" || contract.lifecycle?.providerExportBoundary?.exportable === false).length,
      providerExportBoundaryReady: mailchimpContracts.filter((contract) => contract.lifecycle?.providerExportBoundary?.exportable === true).length,
      providerExportBoundaryRetryable: mailchimpContracts.filter((contract) => contract.lifecycle?.providerExportBoundary?.retryable === true).length,
      providerPublicationBlocked: mailchimpContracts.filter((contract) => contract.lifecycle?.providerPublication?.state === "blocked" || toArray(contract.lifecycle?.providerPublication?.blockedBy).length > 0).length,
      providerPublicationReady: mailchimpContracts.filter((contract) => contract.lifecycle?.providerPublication?.acceptedForExport === true).length,
      providerPublicationReceiptBlocked: mailchimpContracts.filter((contract) => contract.lifecycle?.providerPublication?.receiptState === "blocked").length,
      providerPublicationReceiptPending: mailchimpContracts.filter((contract) => ["pending", "pending-receipt", "needs-receipt"].includes(contract.lifecycle?.providerPublication?.receiptState)).length,
      providerPublicationReceiptAccepted: mailchimpContracts.filter((contract) => contract.lifecycle?.providerPublication?.acceptedForProviderHandoff === true).length,
      providerHandoffRows: providerHandoffRows.length,
      providerHandoffBlocked: providerHandoffBlocked.length,
      providerHandoffWaiting: providerHandoffWaiting.length,
      providerHandoffReady: providerHandoffReady.length,
      scopeExportRows: scopeExportRows.length,
      blockedScopeExportRows: blockedScopeRows.length,
      scopeExportableRows: scopeExportRows.filter((row) => row.exportable === true).length,
      staleScopeHistoryRows: staleHistoryRows.length,
      blockedScopeHistoryRows: blockedHistoryRows.length,
      scopeExportDestinations: toArray(scopeExportHistory.destinations).length,
      errors: diagnostics.filter((diagnostic) => diagnostic.level === "error").length,
      warnings: diagnostics.filter((diagnostic) => diagnostic.level === "warning").length,
    }),
    decisions: Object.freeze(byDecision),
    risk: Object.freeze(byRisk),
    holdReasons: freezeArray([...holdReasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason))),
    timeline: freezeArray(mailchimpContracts.map((contract, index) => ({
      index,
      action: contract.action,
      decision: contract.boundaryDecision?.decision || "unknown",
      source: contract.boundaryDecision?.source || "unknown",
      risk: contract.risk,
      health: contract.health?.state || "unknown",
      statusState: contract.handoff?.statusState || "",
      adapterStatusState: contract.statusReconciliation?.state || "unobserved",
      adapterStatusNextCommand: contract.statusReconciliation?.nextCommand || "observe",
      workflowState: contract.workflowGate?.state || "not-required",
      workflowNextCommand: contract.workflowGate?.nextCommand || "observe",
      previewDecisionState: contract.workflowGate?.previewDecision?.state || "not-provided",
      previewDecisionNextCommand: contract.workflowGate?.previewDecision?.nextCommand || "",
      previewAcceptanceToken: contract.workflowGate?.previewDecision?.acceptanceToken || "",
      previewAcceptanceReceiptState: contract.workflowGate?.previewAcceptanceReceipt?.state || "not-required",
      previewAcceptanceReceiptToken: contract.workflowGate?.previewAcceptanceReceipt?.receiptToken || "",
      previewAcceptanceReceiptNextCommand: contract.workflowGate?.previewAcceptanceReceipt?.nextCommand || "",
      adapterHandoffState: contract.handoff?.adapterHandoff?.state || "not-provided",
      adapterHandoffCommand: contract.handoff?.adapterHandoff?.command || "",
      syncState: contract.providerSync?.state || "not-applicable",
      syncScopeState: contract.providerSync?.metadata?.scopeSyncState || "not-provided",
      permissionLeaseState: contract.boundaryDecision?.leaseState || "not-required",
      permissionLeaseToken: contract.boundaryDecision?.permissionLease?.token || "",
      permissionLeaseRetryAfterMs: contract.boundaryDecision?.leaseRecovery?.retryAfterMs ?? 0,
      permissionLeaseNextCommand: contract.boundaryDecision?.leaseRecovery?.nextCommand || "",
      permissionPostureState: contract.boundaryDecision?.permissionPosture?.state || "not-provided",
      permissionPostureNextCommand: contract.boundaryDecision?.permissionPosture?.nextCommand || "",
      permissionPostureFingerprint: contract.boundaryDecision?.permissionPosture?.fingerprint || "",
      operationId: contract.operationIdentity?.operationId || "",
      operationState: contract.operationIdentity?.state || "not-provided",
      operationNextCommand: contract.operationIdentity?.nextCommand || "observe",
      syncCheckpointKey: contract.providerSync?.metadata?.checkpointKey || "",
      scopeExportRowId: scopeRowsByAction.get(contract.action)?.rowId || "",
      scopeExportState: scopeRowsByAction.get(contract.action)?.state || "missing",
      scopeExportable: scopeRowsByAction.get(contract.action)?.exportable === true,
      providerExportLaneKey: contract.lifecycle?.providerExportBoundary?.laneKey || scopeRowsByAction.get(contract.action)?.laneKey || "",
      providerExportBoundaryFingerprint: contract.lifecycle?.providerExportBoundary?.boundaryFingerprint || scopeRowsByAction.get(contract.action)?.boundaryFingerprint || "",
      providerExportBoundaryState: contract.lifecycle?.providerExportBoundary?.state || "not-required",
      providerExportBoundaryRetryable: contract.lifecycle?.providerExportBoundary?.retryable === true,
      providerPublicationState: contract.lifecycle?.providerPublication?.state || "not-required",
      providerPublicationId: contract.lifecycle?.providerPublication?.publicationId || "",
      providerPublicationNextCommand: contract.lifecycle?.providerPublication?.nextCommand || "observe",
      providerPublicationReceiptState: contract.lifecycle?.providerPublication?.receiptState || "not-required",
      providerPublicationReceiptAccepted: contract.lifecycle?.providerPublication?.acceptedForProviderHandoff === true,
      nextCommand: contract.handoff?.recoveryCommand || contract.health?.actionableError?.nextCommand || "observe",
      requiredPermission: contract.boundaryDecision?.requiredPermission || "",
      reasons: contract.boundaryDecision?.reasons || freezeArray([]),
    }))),
    providerHandoffReadiness: Object.freeze({
      protocol: "aios.capability.provider-handoff-readiness.v1",
      state: providerHandoffBlocked.length > 0
        ? "blocked"
        : providerHandoffWaiting.length > 0
          ? "waiting"
          : providerHandoffReady.length > 0 && providerHandoffReady.length === providerHandoffRows.length
            ? "ready"
            : providerHandoffRows.length > 0
              ? "preview"
              : "not-required",
      acceptedForPreview: true,
      acceptedForAdapter: providerHandoffRows.length > 0
        && providerHandoffBlocked.length === 0
        && providerHandoffWaiting.length === 0
        && providerHandoffReady.length === providerHandoffRows.length,
      rows: freezeArray(providerHandoffRows),
      blockedRows: freezeArray(providerHandoffBlocked),
      waitingRows: freezeArray(providerHandoffWaiting),
      readyRows: freezeArray(providerHandoffReady),
      counters: Object.freeze({
        rows: providerHandoffRows.length,
        blocked: providerHandoffBlocked.length,
        waiting: providerHandoffWaiting.length,
        ready: providerHandoffReady.length,
        exportable: providerHandoffRows.filter((row) => row.exportable === true).length,
      }),
      nextCommand: providerHandoffBlocked[0]?.nextCommand
        || providerHandoffWaiting[0]?.nextCommand
        || providerHandoffReady[0]?.nextCommand
        || "observe",
    }),
    scopeLineage: Object.freeze({
      protocol: "aios.capability.scope-lineage.v1",
      state: blockedScopeRows.length > 0
        || blockedHistoryRows.length > 0
        ? "blocked"
        : staleHistoryRows.length > 0
          ? "stale"
        : scopeExportRows.length > 0
          ? "linked"
          : "missing",
      acceptedForProviderExport: blockedScopeRows.length === 0
        && blockedHistoryRows.length === 0
        && staleHistoryRows.length === 0
        && scopeExportHistory.acceptedForExport !== false,
      scopeState: compactString(scopeSnapshot.historySnapshot?.state || scopeSnapshot.status || "unknown"),
      exportHistoryState: compactString(scopeExportHistory.state || "not-provided"),
      exportHistoryNextCommand: compactString(scopeExportHistory.nextCommand || "observe"),
      exportDestinations: freezeArray(toArray(scopeExportHistory.destinations).map((destination) => ({
        destinationId: compactString(destination.destinationId),
        name: compactString(destination.name),
        format: compactString(destination.format),
        enabled: destination.enabled !== false,
        requireFreshSnapshot: destination.requireFreshSnapshot !== false,
        maxAgeMs: Number(destination.maxAgeMs) || 0,
        statusChannel: compactString(destination.statusChannel),
        nextCommand: compactString(destination.nextCommand || "publish_scope_analytics_export"),
      }))),
      historyRows: freezeArray(toArray(scopeExportHistory.rows).map((row) => ({
        rowId: compactString(row.rowId),
        jobName: compactString(row.jobName),
        state: compactString(row.state),
        fingerprint: compactString(row.fingerprint),
        capturedAt: compactString(row.capturedAt),
        observedAt: compactString(row.observedAt),
        ageMs: Number(row.ageMs) || 0,
        stale: row.stale === true,
        exportRows: Number(row.exportRows) || 0,
        exportableRows: Number(row.exportableRows) || 0,
        blockedRows: Number(row.blockedRows) || 0,
        nextCommand: compactString(row.nextCommand || "observe"),
      }))),
      scopeExportRows: freezeArray(scopeExportRows.map((row) => ({
        rowId: row.rowId,
        action: row.action,
        provider: row.provider,
        state: row.state,
        exportable: row.exportable === true,
        statusChannel: row.statusChannel,
        statusSnapshotKey: row.statusSnapshotKey,
        restartToken: row.restartToken,
        adapterStatusState: row.adapterStatusState,
        permissionLeaseState: row.permissionLeaseState,
        nextCommand: row.nextCommand,
        blockedBy: row.blockedBy || freezeArray([]),
      }))),
      blockedRows: freezeArray(blockedScopeRows.map((row) => ({
        rowId: row.rowId,
        action: row.action,
        blockedBy: row.blockedBy || freezeArray([]),
        nextCommand: row.nextCommand,
      }))),
      staleRows: freezeArray(staleHistoryRows.map((row) => ({
        rowId: compactString(row.rowId),
        jobName: compactString(row.jobName),
        ageMs: Number(row.ageMs) || 0,
        nextCommand: compactString(row.nextCommand || "refresh_scope_analytics_snapshot"),
      }))),
      nextCommand: blockedScopeRows[0]?.nextCommand
        || blockedHistoryRows[0]?.nextCommand
        || staleHistoryRows[0]?.nextCommand
        || scopeExportHistory.nextCommand
        || "publish_capability_scope_lineage",
    }),
    runtimeReadiness: Object.freeze({
      state: compactString(principal.runtimeReadiness?.state || "not-provided"),
      acceptedForAdapter: principal.runtimeReadiness?.acceptedForAdapter === true,
      nextCommand: compactString(principal.runtimeReadiness?.nextStep?.command || ""),
    }),
  });
}

function createCapabilityAnalyticsExport(jobAnalyses = [], diagnostics = []) {
  const snapshots = toArray(jobAnalyses).map((job) => job.analyticsSnapshot).filter(Boolean);
  const contracts = toArray(jobAnalyses).flatMap((job) => job.contracts || []);
  const scopeLineage = snapshots.map((snapshot) => snapshot.scopeLineage).filter(Boolean);
  const scopeRows = scopeLineage.flatMap((lineage) => lineage.scopeExportRows || []);
  const blockedScopeRows = scopeLineage.flatMap((lineage) => lineage.blockedRows || []);
  const staleScopeRows = scopeLineage.flatMap((lineage) => lineage.staleRows || []);
  const scopeHistoryRows = scopeLineage.flatMap((lineage) => lineage.historyRows || []);
  const exportDestinations = scopeLineage.flatMap((lineage) => lineage.exportDestinations || []);
  const providerHandoffSnapshots = snapshots.map((snapshot) => snapshot.providerHandoffReadiness).filter(Boolean);
  const providerHandoffRows = providerHandoffSnapshots.flatMap((snapshot) => snapshot.rows || []);
  const providerHandoffBlocked = providerHandoffSnapshots.flatMap((snapshot) => snapshot.blockedRows || []);
  const providerHandoffWaiting = providerHandoffSnapshots.flatMap((snapshot) => snapshot.waitingRows || []);
  const providerHandoffReady = providerHandoffSnapshots.flatMap((snapshot) => snapshot.readyRows || []);
  const held = contracts.filter((contract) => contract.boundaryDecision?.decision === "hold");
  const statusFailures = contracts.filter((contract) => ["failed", "timed-out", "cancelled"].includes(contract.statusReconciliation?.state));
  const statusMissing = contracts.filter((contract) => contract.statusReconciliation?.state === "missing-status");
  const statusSnapshotBlocked = contracts.filter((contract) => contract.statusReconciliation?.state === "snapshot-blocked");
  const workflowBlocked = contracts.filter((contract) => contract.workflowGate?.acceptedForAdapter === false);
  const actionQueues = toArray(jobAnalyses).map((job) => job.operationalReport?.operatorActionQueue).filter(Boolean);
  const workflowHandoffs = toArray(jobAnalyses).map((job) => job.workflowHandoff).filter(Boolean);
  const leaseBlocked = contracts.filter((contract) => contract.lifecycle?.controls?.requirePermissionLeaseRefresh === true);
  const providerExportBlocked = contracts.filter((contract) => contract.lifecycle?.providerExportBoundary?.state === "blocked" || contract.lifecycle?.providerExportBoundary?.exportable === false);

  return Object.freeze({
    protocol: "aios.capability.analytics-export.v1",
    state: diagnostics.some((diagnostic) => diagnostic.level === "error")
      ? "blocked"
      : contracts.some((contract) => contract.health?.degradedMode !== "none")
        ? "degraded"
        : "healthy",
    exportReady: diagnostics.every((diagnostic) => diagnostic.level !== "error"),
    snapshots: freezeArray(snapshots),
    counters: Object.freeze({
      jobs: snapshots.length,
      capabilities: contracts.length,
      mailchimpCapabilities: contracts.filter((contract) => contract.provider === "mailchimp").length,
      heldCapabilities: held.length,
      permissionLeaseBlocked: leaseBlocked.length,
      permissionLeaseReady: contracts.filter((contract) => contract.boundaryDecision?.leaseState === "ready").length,
      permissionPostureBlocked: contracts.filter((contract) => contract.boundaryDecision?.permissionPosture?.state?.endsWith?.("blocked")).length,
      permissionPostureCovered: contracts.filter((contract) => contract.boundaryDecision?.permissionPosture?.state === "covered").length,
      permissionPostureGrantBlocked: contracts.filter((contract) => contract.boundaryDecision?.permissionPosture?.state === "grant-blocked").length,
      permissionPostureLeaseBlocked: contracts.filter((contract) => contract.boundaryDecision?.permissionPosture?.state === "lease-blocked").length,
      permissionPostureIdentityBlocked: contracts.filter((contract) => contract.boundaryDecision?.permissionPosture?.state === "identity-blocked").length,
      scopeSourcedDecisions: contracts.filter((contract) => contract.boundaryDecision?.source === "scope-permission-boundary").length,
      degradedCapabilities: contracts.filter((contract) => contract.health?.degradedMode !== "none").length,
      retryableCapabilities: contracts.filter((contract) => contract.health?.retry?.retryable).length,
      adapterStatusFailures: contracts.filter((contract) => ["failed", "timed-out", "cancelled"].includes(contract.statusReconciliation?.state)).length,
      adapterStatusMissing: contracts.filter((contract) => contract.statusReconciliation?.state === "missing-status").length,
      adapterStatusSnapshotBlocked: statusSnapshotBlocked.length,
      operatorQueueRows: actionQueues.reduce((count, queue) => count + (queue.summary?.total ?? 0), 0),
      operatorQueueBlocked: actionQueues.reduce((count, queue) => count + (queue.summary?.blocked ?? 0), 0),
      workflowHandoffRows: workflowHandoffs.reduce((count, handoff) => count + (handoff.summary?.rows ?? 0), 0),
      workflowHandoffBlocked: workflowHandoffs.reduce((count, handoff) => count + (handoff.summary?.blocked ?? 0), 0),
      workflowHandoffReady: workflowHandoffs.reduce((count, handoff) => count + (handoff.summary?.ready ?? 0), 0),
      workflowBlocked: workflowBlocked.length,
      workflowReady: contracts.filter((contract) => contract.workflowGate?.state === "ready").length,
      operationIdentityRows: contracts.filter((contract) => contract.operationIdentity).length,
      operationIdentityBlocked: contracts.filter((contract) => contract.operationIdentity?.state === "blocked" || contract.health?.degradedMode === "operation-identity").length,
      providerExportBoundaryBlocked: providerExportBlocked.length,
      providerExportBoundaryReady: contracts.filter((contract) => contract.lifecycle?.providerExportBoundary?.exportable === true).length,
      providerExportBoundaryRetryable: contracts.filter((contract) => contract.lifecycle?.providerExportBoundary?.retryable === true).length,
      providerPublicationBlocked: contracts.filter((contract) => contract.lifecycle?.providerPublication?.state === "blocked" || toArray(contract.lifecycle?.providerPublication?.blockedBy).length > 0).length,
      providerPublicationReady: contracts.filter((contract) => contract.lifecycle?.providerPublication?.acceptedForExport === true).length,
      providerPublicationReceiptBlocked: contracts.filter((contract) => contract.lifecycle?.providerPublication?.receiptState === "blocked").length,
      providerPublicationReceiptPending: contracts.filter((contract) => ["pending", "pending-receipt", "needs-receipt"].includes(contract.lifecycle?.providerPublication?.receiptState)).length,
      providerPublicationReceiptAccepted: contracts.filter((contract) => contract.lifecycle?.providerPublication?.acceptedForProviderHandoff === true).length,
      providerHandoffRows: providerHandoffRows.length,
      providerHandoffBlocked: providerHandoffBlocked.length,
      providerHandoffWaiting: providerHandoffWaiting.length,
      providerHandoffReady: providerHandoffReady.length,
      scopeExportRows: scopeRows.length,
      blockedScopeExportRows: blockedScopeRows.length,
      staleScopeHistoryRows: staleScopeRows.length,
      scopeHistoryRows: scopeHistoryRows.length,
      exportDestinations: exportDestinations.length,
      scopeLinkedJobs: scopeLineage.filter((lineage) => lineage.state === "linked").length,
      diagnostics: diagnostics.length,
    }),
    scopeLineage: Object.freeze({
      protocol: "aios.capability.scope-lineage-export.v1",
      state: blockedScopeRows.length > 0
        ? "blocked"
        : staleScopeRows.length > 0
          ? "stale"
        : scopeRows.length > 0
          ? "linked"
          : "missing",
      acceptedForProviderExport: blockedScopeRows.length === 0 && staleScopeRows.length === 0,
      rows: freezeArray(scopeRows),
      blockedRows: freezeArray(blockedScopeRows),
      staleRows: freezeArray(staleScopeRows),
      historyRows: freezeArray(scopeHistoryRows),
      exportDestinations: freezeArray(exportDestinations),
      statusChannels: freezeArray([...new Set(scopeRows.map((row) => row.statusChannel).filter(Boolean))]),
      statusSnapshotKeys: freezeArray([...new Set(scopeRows.map((row) => row.statusSnapshotKey).filter(Boolean))]),
      restartTokens: freezeArray([...new Set(scopeRows.map((row) => row.restartToken).filter(Boolean))]),
      nextCommand: blockedScopeRows[0]?.nextCommand
        || staleScopeRows[0]?.nextCommand
        || scopeLineage.find((lineage) => lineage.nextCommand && lineage.nextCommand !== "observe")?.nextCommand
        || "publish_capability_scope_lineage",
    }),
    providerHandoffReadiness: Object.freeze({
      protocol: "aios.capability.provider-handoff-readiness-export.v1",
      state: providerHandoffBlocked.length > 0
        ? "blocked"
        : providerHandoffWaiting.length > 0
          ? "waiting"
          : providerHandoffReady.length > 0 && providerHandoffReady.length === providerHandoffRows.length
            ? "ready"
            : providerHandoffRows.length > 0
              ? "preview"
              : "not-required",
      acceptedForAdapter: providerHandoffRows.length > 0
        && providerHandoffBlocked.length === 0
        && providerHandoffWaiting.length === 0
        && providerHandoffReady.length === providerHandoffRows.length,
      rows: freezeArray(providerHandoffRows),
      blockedRows: freezeArray(providerHandoffBlocked),
      waitingRows: freezeArray(providerHandoffWaiting),
      readyRows: freezeArray(providerHandoffReady),
      statusChannels: freezeArray([...new Set(providerHandoffRows.map((row) => row.statusChannel).filter(Boolean))]),
      statusSnapshotKeys: freezeArray([...new Set(providerHandoffRows.map((row) => row.statusSnapshotKey).filter(Boolean))]),
      nextCommand: providerHandoffBlocked[0]?.nextCommand
        || providerHandoffWaiting[0]?.nextCommand
        || providerHandoffReady[0]?.nextCommand
        || "observe",
    }),
    heldCapabilities: freezeArray(held.map((contract) => ({
      action: contract.action,
      provider: contract.provider,
      requiredPermission: contract.boundaryDecision?.requiredPermission || "",
      permissionLease: contract.boundaryDecision?.permissionLease || null,
      reasons: contract.boundaryDecision?.reasons || freezeArray([]),
      nextCommand: contract.health?.actionableError?.nextCommand || contract.handoff?.recoveryCommand || "resolve_boundary_hold",
    }))),
    permissionLeases: Object.freeze({
      blocked: freezeArray(leaseBlocked.map((contract) => ({
        action: contract.action,
        token: contract.boundaryDecision?.permissionLease?.token || "",
        state: contract.boundaryDecision?.leaseState || "blocked",
        nextCommand: contract.lifecycle?.nextAction || "refresh_mailchimp_permission_lease",
        retryAfterMs: contract.boundaryDecision?.leaseRecovery?.retryAfterMs ?? 0,
        strategy: contract.boundaryDecision?.leaseRecovery?.backoff?.strategy || "bounded-refresh",
      }))),
      ready: freezeArray(contracts
        .filter((contract) => contract.boundaryDecision?.leaseState === "ready")
        .map((contract) => ({
          action: contract.action,
          token: contract.boundaryDecision?.permissionLease?.token || "",
          expiresAt: contract.boundaryDecision?.permissionLease?.expiresAt || "",
          retryAfterMs: contract.boundaryDecision?.leaseRecovery?.retryAfterMs ?? 0,
        }))),
    }),
    adapterStatus: Object.freeze({
      failures: freezeArray(statusFailures.map((contract) => ({
        action: contract.action,
        state: contract.statusReconciliation.state,
        message: contract.statusReconciliation.message,
        nextCommand: contract.statusReconciliation.nextCommand,
      }))),
      missing: freezeArray(statusMissing.map((contract) => ({
        action: contract.action,
        statusSnapshotKey: contract.statusReconciliation.statusSnapshotKey,
        nextCommand: contract.statusReconciliation.nextCommand,
      }))),
      snapshotBlocked: freezeArray(statusSnapshotBlocked.map((contract) => ({
        action: contract.action,
        statusSnapshotKey: contract.statusReconciliation.statusSnapshotKey,
        snapshotRowKey: contract.statusReconciliation.snapshotRowKey,
        missing: contract.statusReconciliation.snapshotMissing,
        nextCommand: contract.statusReconciliation.nextCommand,
      }))),
    }),
    clientWorkflow: Object.freeze({
      blocked: freezeArray(workflowBlocked.map((contract) => ({
        action: contract.action,
        nextCommand: contract.workflowGate.nextCommand,
        blockedCommands: contract.workflowGate.blockedCommands,
      }))),
      ready: freezeArray(contracts
        .filter((contract) => contract.workflowGate?.state === "ready")
        .map((contract) => ({
          action: contract.action,
          nextCommand: contract.workflowGate.nextCommand,
          readyCommands: contract.workflowGate.readyCommands,
        }))),
    }),
    operationIdentities: freezeArray(contracts
      .filter((contract) => contract.operationIdentity)
      .map((contract) => ({
        action: contract.action,
        operationId: contract.operationIdentity.operationId,
        state: contract.operationIdentity.state,
        commandId: contract.operationIdentity.commandId,
        nextCommand: contract.operationIdentity.nextCommand,
        missing: contract.operationIdentity.missing || freezeArray([]),
      }))),
    timeline: freezeArray(snapshots
      .flatMap((snapshot) => snapshot.timeline.map((event) => ({ ...event, jobName: snapshot.jobName })))
      .sort((left, right) => left.jobName.localeCompare(right.jobName) || left.index - right.index)),
    operatorActionQueues: freezeArray(actionQueues.map((queue, index) => ({
      index,
      state: queue.state,
      nextCommand: queue.nextCommand,
      summary: queue.summary,
    }))),
    workflowHandoffs: freezeArray(workflowHandoffs.map((handoff, index) => ({
      index,
      jobName: handoff.jobName,
      state: handoff.state,
      nextCommand: handoff.nextStep?.command || "observe",
      summary: handoff.summary,
    }))),
  });
}

function createCapabilityWorkflowHandoff(job = {}, principal = {}, contracts = [], diagnostics = []) {
  const jobName = compactString(job.name || "anonymous");
  const rows = toArray(contracts).map((contract, index) => {
    const lifecycle = contract.lifecycle || {};
    const workflowGate = contract.workflowGate || {};
    const statusReconciliation = contract.statusReconciliation || {};
    const providerSync = contract.providerSync || {};
    const acceptance = contract.acceptance || {};
    const boundaryDecision = contract.boundaryDecision || {};
    const blockedReasons = [
      ...toArray(boundaryDecision.reasons).map(compactString).filter(Boolean),
      workflowGate.acceptedForAdapter === false && "client-workflow-blocked",
      lifecycle.mode === "disabled" && "lifecycle-disabled",
      providerSync.state === "blocked" && "provider-sync-blocked",
      acceptance.state === "pending" && "operator-acceptance-pending",
      acceptance.state === "rejected" && "operator-acceptance-rejected",
      ["failed", "timed-out", "cancelled"].includes(statusReconciliation.state) && "adapter-status-terminal",
      statusReconciliation.state === "snapshot-blocked" && "adapter-status-snapshot-blocked",
      statusReconciliation.state === "missing-status" && "adapter-status-missing",
    ].filter(Boolean);
    const readyForAdapter = contract.provider === "mailchimp"
      && lifecycle.controls?.enableAdapterHandoff === true
      && blockedReasons.length === 0
      && providerSync.state !== "needs-provider-confirmation";
    const waiting = blockedReasons.length === 0 && (
      providerSync.state === "needs-provider-confirmation"
      || statusReconciliation.state === "pending"
      || workflowGate.state === "ready"
      || acceptance.state === "pending"
    );
    const state = blockedReasons.length > 0
      ? "blocked"
      : readyForAdapter
        ? "ready"
        : waiting
          ? "waiting"
          : contract.provider === "mailchimp"
            ? "preview"
            : "not-required";
    const nextCommand = blockedReasons.length > 0
      ? lifecycle.nextAction || contract.health?.actionableError?.nextCommand || workflowGate.nextCommand || statusReconciliation.nextCommand || "resolve_capability_handoff"
      : readyForAdapter
        ? "queue_adapter_handoff"
        : providerSync.state === "needs-provider-confirmation"
          ? providerSync.nextCommand || "confirm_provider_resource_state"
        : workflowGate.state === "ready"
          ? workflowGate.nextCommand || "run_client_workflow_command"
        : statusReconciliation.state === "pending"
          ? "poll_adapter_status_channel"
          : "observe";

    return Object.freeze({
      index,
      action: contract.action,
      provider: contract.provider,
      state,
      command: nextCommand,
      commandId: stableContractToken("workflow", [
        principal.tenantId,
        principal.workspaceId,
        principal.requestId,
        contract.action,
        nextCommand,
      ]),
      enabled: state === "ready" || state === "waiting",
      blocking: state === "blocked",
      phase: readyForAdapter
        ? "adapter-handoff"
        : blockedReasons.some((reason) => reason.includes("lease"))
          ? "permission-lease"
          : blockedReasons.some((reason) => reason.includes("status"))
            ? "adapter-status"
            : blockedReasons.some((reason) => reason.includes("sync"))
              ? "provider-sync"
              : blockedReasons.some((reason) => reason.includes("operator"))
                ? "operator-acceptance"
                : blockedReasons.length > 0
                  ? "repair"
                  : "preview",
      reason: blockedReasons[0] || (readyForAdapter ? "Mailchimp capability is accepted for adapter handoff." : "Capability can remain in preview until runtime needs it."),
      blockedBy: freezeArray([...new Set(blockedReasons)].sort()),
      userVisible: Object.freeze({
        label: readyForAdapter
          ? `Queue ${contract.action}`
          : blockedReasons.length > 0
            ? `Resolve ${contract.action}`
            : `Preview ${contract.action}`,
        blocking: state === "blocked",
        handoff: contract.provider === "mailchimp" ? "mailchimp-adapter" : "runtime",
      }),
      runtime: Object.freeze({
        tenantId: compactString(principal.tenantId),
        workspaceId: compactString(principal.workspaceId),
        actorId: compactString(principal.actorId),
        requestId: compactString(principal.requestId),
        statusChannel: compactString(principal.statusChannel),
        statusSnapshotKey: compactString(principal.statusSnapshotKey),
        idempotencyKey: compactString(contract.audit?.requestId),
        restartToken: compactString(principal.restartToken),
      }),
      status: Object.freeze({
        adapterStatusState: compactString(statusReconciliation.state || "unobserved"),
        adapterStatusNextCommand: compactString(statusReconciliation.nextCommand || "observe"),
        workflowState: compactString(workflowGate.state || "not-required"),
        workflowNextCommand: compactString(workflowGate.nextCommand || "observe"),
        syncState: compactString(providerSync.state || "not-applicable"),
        permissionLeaseState: compactString(boundaryDecision.leaseState || "not-required"),
        acceptanceState: compactString(acceptance.state || "not-required"),
      }),
    });
  }).sort((left, right) => {
    if (left.blocking !== right.blocking) return left.blocking ? -1 : 1;
    if (left.state !== right.state) return left.state.localeCompare(right.state);
    return left.action.localeCompare(right.action);
  });
  const blocked = rows.filter((row) => row.state === "blocked");
  const waiting = rows.filter((row) => row.state === "waiting");
  const ready = rows.filter((row) => row.state === "ready");
  const errorDiagnostics = toArray(diagnostics).filter((diagnostic) => diagnostic.level === "error");

  return Object.freeze({
    protocol: "aios.capability.workflow-handoff.v1",
    jobName,
    state: errorDiagnostics.length > 0 || blocked.length > 0
      ? "blocked"
      : ready.length > 0
        ? "ready"
        : waiting.length > 0
          ? "waiting"
          : rows.length > 0
            ? "preview"
            : "empty",
    acceptedForPreview: true,
    acceptedForRuntime: errorDiagnostics.length === 0 && blocked.length === 0,
    acceptedForAdapter: errorDiagnostics.length === 0 && blocked.length === 0 && ready.length > 0 && ready.length === contracts.filter((contract) => contract.provider === "mailchimp").length,
    rows: freezeArray(rows),
    blockedRows: freezeArray(blocked),
    waitingRows: freezeArray(waiting),
    readyRows: freezeArray(ready),
    summary: Object.freeze({
      rows: rows.length,
      blocked: blocked.length,
      waiting: waiting.length,
      ready: ready.length,
      preview: rows.filter((row) => row.state === "preview").length,
      diagnostics: errorDiagnostics.length,
    }),
    nextStep: Object.freeze({
      command: blocked[0]?.command
        || waiting[0]?.command
        || ready[0]?.command
        || "observe",
      reason: blocked.length > 0
        ? "Capability workflow handoff has blocking Mailchimp runtime requirements."
        : waiting.length > 0
          ? "Capability workflow handoff is waiting on provider or client confirmation."
          : ready.length > 0
            ? "Capability workflow handoff is ready to queue adapter work."
            : "No provider workflow handoff is required.",
    }),
  });
}

function analyzeJobCapabilities(job = {}, typeJob) {
  const usage = collectStepUsage(job);
  const principal = normalizeRuntimePrincipal(job, typeJob);
  const contracts = toArray(job.capabilities)
    .map((capability) => createCapabilityContract(capability, usage, principal))
    .sort((left, right) => left.action.localeCompare(right.action));
  const diagnostics = [];
  const referenced = new Set([...usage.keys()]);
  const declared = new Set(contracts.map((contract) => contract.action));

  for (const capabilityName of referenced) {
    if (!declared.has(capabilityName)) {
      diagnostics.push(Object.freeze({
        level: "error",
        code: "aios.capability.reference_missing_contract",
        message: `Capability "${capabilityName}" is referenced by a step but has no contract.`,
        jobName: job.name,
        capabilityName,
      }));
    }
  }

  for (const contract of contracts) {
    if (contract.provider === "mailchimp" && contract.serviceScopes.length === 0) {
      diagnostics.push(Object.freeze({
        level: "warning",
        code: "aios.capability.mailchimp_scope_inferred_empty",
        message: `Mailchimp capability "${contract.action}" has no service scope mapping.`,
        jobName: job.name,
        capabilityName: contract.action,
      }));
    }

    if (contract.boundaryDecision.decision === "hold") {
      diagnostics.push(Object.freeze({
        level: "error",
        code: "aios.capability.boundary_hold",
        message: `Capability "${contract.action}" is held by tenant/workspace or permission boundary checks.`,
        jobName: job.name,
        capabilityName: contract.action,
        reasons: contract.boundaryDecision.reasons,
      }));
    }

    if (contract.health.actionableError && contract.health.actionableError.code !== "aios.capability.boundary_hold") {
      diagnostics.push(Object.freeze({
        level: "warning",
        code: contract.health.actionableError.code,
        message: contract.health.actionableError.message,
        jobName: job.name,
        capabilityName: contract.action,
        nextCommand: contract.health.actionableError.nextCommand,
      }));
    }

    for (const setting of toArray(contract.lifecycle?.settingsValidation)) {
      if (setting.severity === "error") {
        diagnostics.push(Object.freeze({
          level: "error",
          code: "aios.capability.lifecycle_setting_invalid",
          message: `Capability "${contract.action}" has invalid lifecycle setting "${setting.setting}": ${setting.reason}.`,
          jobName: job.name,
          capabilityName: contract.action,
          setting: setting.setting,
          reason: setting.reason,
          nextCommand: contract.lifecycle?.nextAction || "repair_capability_settings",
        }));
      }
    }

    if (contract.lifecycle?.providerCallback?.state === "blocked") {
      diagnostics.push(Object.freeze({
        level: "error",
        code: "aios.capability.provider_callback_blocked",
        message: `Capability "${contract.action}" has incomplete provider callback endpoint state.`,
        jobName: job.name,
        capabilityName: contract.action,
        callbackId: contract.lifecycle.providerCallback.callbackId,
        missing: contract.lifecycle.providerCallback.missing,
        nextCommand: contract.lifecycle.providerCallback.nextCommand,
      }));
    } else if (contract.lifecycle?.providerCallback?.state === "pending-verification") {
      diagnostics.push(Object.freeze({
        level: "warning",
        code: "aios.capability.provider_callback_pending",
        message: `Capability "${contract.action}" is waiting for provider callback endpoint verification.`,
        jobName: job.name,
        capabilityName: contract.action,
        callbackId: contract.lifecycle.providerCallback.callbackId,
        retryAfterMs: contract.lifecycle.providerCallback.retryAfterMs,
        nextCommand: contract.lifecycle.providerCallback.nextCommand,
      }));
    }

    for (const validation of toArray(contract.providerSync?.validation)) {
      if (validation.severity === "error") {
        diagnostics.push(Object.freeze({
          level: "error",
          code: "aios.capability.provider_sync_invalid",
          message: `Capability "${contract.action}" has invalid provider sync metadata: ${validation.reason}.`,
          jobName: job.name,
          capabilityName: contract.action,
          reason: validation.reason,
          nextCommand: contract.providerSync?.nextCommand || "repair_provider_sync_metadata",
        }));
      }
    }
  }
  const workflowHandoff = createCapabilityWorkflowHandoff(job, principal, contracts, diagnostics);

  return Object.freeze({
    jobName: compactString(job.name || typeJob?.jobName || "anonymous"),
    principal,
    status: diagnostics.some((diagnostic) => diagnostic.level === "error") ? "invalid" : "analyzed",
    contracts: freezeArray(contracts),
    auditHandoff: createCapabilityAuditHandoff(contracts, principal),
    operationalReport: createCapabilityOperationalReport(contracts, diagnostics),
    workflowHandoff,
    analyticsSnapshot: createCapabilityAnalyticsSnapshot(job.name || typeJob?.jobName, principal, contracts, diagnostics, typeJob?.scope || {}),
    diagnostics: freezeArray(diagnostics),
    summary: summarizeCapabilityContracts(contracts, diagnostics),
  });
}

export function createCapabilityAuditHandoff(contracts = [], principal = {}) {
  const auditEvents = toArray(contracts).map((contract) => contract.audit);
  return Object.freeze({
    protocol: "aios.capability.audit-handoff.v1",
    tenantId: compactString(principal.tenantId),
    workspaceId: compactString(principal.workspaceId),
    actorId: compactString(principal.actorId),
    statusChannel: compactString(principal.statusChannel),
    acceptedForAdapter: toArray(contracts).every((contract) => {
      return contract.boundaryDecision?.decision === "allow" && contract.acceptance?.accepted !== false;
    }),
    statusSnapshotKeys: freezeArray([...new Set(toArray(contracts).map((contract) => contract.audit?.statusSnapshotKey).filter(Boolean))]),
    events: freezeArray(auditEvents),
    heldCapabilities: freezeArray(toArray(contracts)
      .filter((contract) => contract.boundaryDecision?.decision === "hold")
      .map((contract) => ({
        action: contract.action,
        reasons: contract.boundaryDecision.reasons,
        requiredPermission: contract.boundaryDecision.requiredPermission,
      }))),
  });
}

export function analyzeAiosCapabilities(input = {}) {
  const jobs = getJobs(input);
  const typeHints = input.typeHints || inferAiosTypeHints(input);
  const jobAnalyses = jobs.map((job, index) => analyzeJobCapabilities(job, typeHints.jobs?.[index]));
  const diagnostics = [
    ...(typeHints.diagnostics || []),
    ...jobAnalyses.flatMap((job) => job.diagnostics),
  ];

  return Object.freeze({
    protocol: "aios.semantic.capability-analysis.v1",
    status: diagnostics.some((diagnostic) => diagnostic.level === "error") ? "blocked" : "analyzed",
    typeHints,
    jobs: freezeArray(jobAnalyses),
    diagnostics: freezeArray(diagnostics),
    analyticsExport: createCapabilityAnalyticsExport(jobAnalyses, diagnostics),
    summary: summarizeAiosCapabilities(jobAnalyses, diagnostics),
  });
}

export function summarizeCapabilityContracts(contracts = [], diagnostics = []) {
  return Object.freeze({
    total: contracts.length,
    externalWrites: contracts.filter((contract) => contract.effects.externalWrite).length,
    approvalRequired: contracts.filter((contract) => contract.effects.requiredApproval).length,
    mailchimp: contracts.filter((contract) => contract.provider === "mailchimp").length,
    highRisk: contracts.filter((contract) => contract.risk === "high").length,
    heldByBoundary: contracts.filter((contract) => contract.boundaryDecision?.decision === "hold").length,
    permissionLeaseBlocked: contracts.filter((contract) => contract.lifecycle?.controls?.requirePermissionLeaseRefresh === true).length,
    permissionLeaseReady: contracts.filter((contract) => contract.boundaryDecision?.leaseState === "ready").length,
    permissionPostureBlocked: contracts.filter((contract) => contract.boundaryDecision?.permissionPosture?.state?.endsWith?.("blocked")).length,
    permissionPostureCovered: contracts.filter((contract) => contract.boundaryDecision?.permissionPosture?.state === "covered").length,
    permissionPostureGrantBlocked: contracts.filter((contract) => contract.boundaryDecision?.permissionPosture?.state === "grant-blocked").length,
    permissionPostureLeaseBlocked: contracts.filter((contract) => contract.boundaryDecision?.permissionPosture?.state === "lease-blocked").length,
    permissionPostureIdentityBlocked: contracts.filter((contract) => contract.boundaryDecision?.permissionPosture?.state === "identity-blocked").length,
    workspaceBoundaryQuarantined: contracts.filter((contract) => toArray(contract.boundaryDecision?.reasons).some((reason) => compactString(reason).includes("workspace-boundary"))).length,
    scopeSourcedDecisions: contracts.filter((contract) => contract.boundaryDecision?.source === "scope-permission-boundary").length,
    degraded: contracts.filter((contract) => contract.health?.degradedMode !== "none").length,
    disabled: contracts.filter((contract) => contract.lifecycle?.mode === "disabled").length,
    schedulable: contracts.filter((contract) => contract.lifecycle?.controls?.enableScheduling).length,
    retryable: contracts.filter((contract) => contract.health?.retry?.retryable).length,
    adapterStatusFailures: contracts.filter((contract) => ["failed", "timed-out", "cancelled"].includes(contract.statusReconciliation?.state)).length,
    adapterStatusMissing: contracts.filter((contract) => contract.statusReconciliation?.state === "missing-status").length,
    adapterStatusSnapshotBlocked: contracts.filter((contract) => contract.statusReconciliation?.state === "snapshot-blocked").length,
    adapterStatusSucceeded: contracts.filter((contract) => contract.statusReconciliation?.state === "succeeded").length,
    syncBlocked: contracts.filter((contract) => contract.providerSync?.state === "blocked").length,
    syncScopeBlocked: contracts.filter((contract) => contract.providerSync?.metadata?.scopeSyncState === "blocked").length,
    syncPendingConfirmation: contracts.filter((contract) => contract.providerSync?.state === "needs-provider-confirmation").length,
    syncCheckpointReady: contracts.filter((contract) => contract.providerSync?.state === "checkpoint-ready").length,
    segmentSyncReceiptBlocked: contracts.filter((contract) => contract.segmentSyncReceipt?.state === "blocked").length,
    segmentSyncReceiptPending: contracts.filter((contract) => contract.segmentSyncReceipt?.state === "pending").length,
    segmentSyncReceiptAccepted: contracts.filter((contract) => contract.segmentSyncReceipt?.state === "accepted").length,
    providerBudgetBlocked: contracts.filter((contract) => contract.lifecycle?.providerBudget?.state === "blocked").length,
    providerBudgetThrottled: contracts.filter((contract) => ["degraded", "throttled"].includes(contract.lifecycle?.providerBudget?.state)).length,
    providerCallbackBlocked: contracts.filter((contract) => contract.lifecycle?.providerCallback?.state === "blocked").length,
    providerCallbackPending: contracts.filter((contract) => contract.lifecycle?.providerCallback?.state === "pending-verification").length,
    providerCallbackReady: contracts.filter((contract) => contract.lifecycle?.providerCallback?.state === "verified").length,
    providerEventSubscriptionBlocked: contracts.filter((contract) => ["blocked", "missing-subscription"].includes(contract.lifecycle?.providerEventSubscription?.state)).length,
    providerEventSubscriptionPending: contracts.filter((contract) => contract.lifecycle?.providerEventSubscription?.state === "pending").length,
    providerEventSubscriptionReady: contracts.filter((contract) => contract.lifecycle?.providerEventSubscription?.state === "subscribed").length,
    providerMaintenanceBlocked: contracts.filter((contract) => contract.lifecycle?.providerMaintenance?.state === "blocked").length,
    providerMaintenanceDegraded: contracts.filter((contract) => contract.lifecycle?.providerMaintenance?.state === "degraded").length,
    providerServiceUnavailable: contracts.filter((contract) => toArray(contract.lifecycle?.providerMaintenance?.blockedBy)
      .some((reason) => compactString(reason).startsWith("provider-service-"))).length,
    providerServiceDegraded: contracts.filter((contract) => contract.lifecycle?.providerMaintenance?.serviceWindow?.state === "degraded").length,
    providerExportBoundaryBlocked: contracts.filter((contract) => contract.lifecycle?.providerExportBoundary?.state === "blocked" || contract.lifecycle?.providerExportBoundary?.exportable === false).length,
    providerExportBoundaryReady: contracts.filter((contract) => contract.lifecycle?.providerExportBoundary?.exportable === true).length,
    providerExportBoundaryRetryable: contracts.filter((contract) => contract.lifecycle?.providerExportBoundary?.retryable === true).length,
    providerPublicationBlocked: contracts.filter((contract) => contract.lifecycle?.providerPublication?.state === "blocked" || toArray(contract.lifecycle?.providerPublication?.blockedBy).length > 0).length,
    providerPublicationReady: contracts.filter((contract) => contract.lifecycle?.providerPublication?.acceptedForExport === true).length,
    providerPublicationReceiptBlocked: contracts.filter((contract) => contract.lifecycle?.providerPublication?.receiptState === "blocked").length,
    providerPublicationReceiptPending: contracts.filter((contract) => ["pending", "pending-receipt", "needs-receipt"].includes(contract.lifecycle?.providerPublication?.receiptState)).length,
    providerPublicationReceiptAccepted: contracts.filter((contract) => contract.lifecycle?.providerPublication?.acceptedForProviderHandoff === true).length,
    settingsAdoptionBlocked: contracts.filter((contract) => contract.lifecycle?.settingsAdoption?.state === "blocked").length,
    settingsAdoptionPatchRequired: contracts.filter((contract) => contract.lifecycle?.settingsAdoption?.state === "patch-required").length,
    settingsAdoptionDisabled: contracts.filter((contract) => contract.lifecycle?.settingsAdoption?.state === "disabled").length,
    lifecycleGateBlocked: contracts.filter((contract) => ["blocked", "disabled"].includes(contract.lifecycle?.lifecycleGate?.state)).length,
    lifecycleGateGated: contracts.filter((contract) => contract.lifecycle?.lifecycleGate?.state === "gated").length,
    lifecycleGateScheduled: contracts.filter((contract) => contract.lifecycle?.lifecycleGate?.scheduling?.requested === true).length,
    lifecycleCommandReceiptBlocked: contracts.filter((contract) => contract.lifecycle?.controls?.requireLifecycleCommandReceipt === true).length,
    marketingConsentRequired: contracts.filter((contract) => contract.lifecycle?.lifecycleGate?.marketingConsent?.required === true).length,
    marketingConsentBlocked: contracts.filter((contract) => contract.lifecycle?.controls?.requireMarketingConsent === true).length,
    marketingConsentExpired: contracts.filter((contract) => contract.lifecycle?.lifecycleGate?.marketingConsent?.expired === true).length,
    workflowBlocked: contracts.filter((contract) => contract.workflowGate?.acceptedForAdapter === false).length,
    workflowReady: contracts.filter((contract) => contract.workflowGate?.state === "ready").length,
    previewRuntimeHandoffRows: contracts.filter((contract) => contract.handoff?.previewRuntimeHandoff).length,
    previewRuntimeHandoffBlocked: contracts.filter((contract) => contract.handoff?.previewRuntimeHandoff && contract.handoff.previewRuntimeHandoff.acceptedForAdapter !== true).length,
    previewRuntimeHandoffReady: contracts.filter((contract) => contract.handoff?.previewRuntimeHandoff?.acceptedForAdapter === true).length,
    adapterHandoffReceiptRows: contracts.filter((contract) => contract.handoff?.adapterHandoffReceipt).length,
    adapterHandoffReceiptBlocked: contracts.filter((contract) => contract.handoff?.adapterHandoffReceipt?.state === "blocked").length,
    adapterHandoffReceiptAccepted: contracts.filter((contract) => contract.handoff?.adapterHandoffReceipt?.state === "accepted").length,
    clientCommandReceiptBlocked: contracts.filter((contract) => contract.workflowGate?.state === "client-command-receipt-blocked").length,
    clientCommandReceipts: contracts.filter((contract) => contract.workflowGate?.clientCommandReceipt).length,
    previewAcceptanceReceipts: contracts.filter((contract) => contract.workflowGate?.previewAcceptanceReceipt).length,
    previewAcceptanceReceiptBlocked: contracts.filter((contract) => ["rejected", "expired"].includes(contract.workflowGate?.previewAcceptanceReceipt?.state)).length,
    previewAcceptanceReceiptMissing: contracts.filter((contract) => ["missing", "pending"].includes(contract.workflowGate?.previewAcceptanceReceipt?.state)).length,
    operationIdentityRows: contracts.filter((contract) => contract.operationIdentity).length,
    operationIdentityBlocked: contracts.filter((contract) => contract.operationIdentity?.state === "blocked" || contract.health?.degradedMode === "operation-identity").length,
    persistedRecoveryCommands: contracts.filter((contract) => contract.handoff?.persistedRecoveryCommand).length,
    persistedRecoveryReplayable: contracts.filter((contract) => contract.handoff?.persistedRecoveryCommand?.safeToReplay === true).length,
    persistedRecoveryBlocked: contracts.filter((contract) => contract.handoff?.persistedRecoveryCommand?.state === "blocked" || contract.handoff?.persistedRecoveryCommand?.safeToReplay === false).length,
    resumptionJournalRows: contracts.filter((contract) => contract.handoff?.resumptionJournalRow).length,
    resumptionJournalReplayable: contracts.filter((contract) => contract.handoff?.resumptionJournalRow?.safeToReplay === true || contract.handoff?.resumptionJournalRow?.state === "replayable").length,
    resumptionJournalBlocked: contracts.filter((contract) => contract.handoff?.resumptionJournalRow?.state === "blocked").length,
    recoveryCheckpointRows: contracts.filter((contract) => contract.recoveryCheckpoint).length,
    recoveryCheckpointReplayable: contracts.filter((contract) => contract.recoveryCheckpoint?.safeToReplay === true || contract.recoveryCheckpoint?.state === "replayable").length,
    recoveryCheckpointBlocked: contracts.filter((contract) => contract.recoveryCheckpoint?.state === "blocked" || contract.health?.degradedMode === "recovery-checkpoint").length,
    workflowHandoffBlocked: contracts.filter((contract) => contract.lifecycle?.mode === "disabled" || contract.workflowGate?.acceptedForAdapter === false).length,
    workflowHandoffReady: contracts.filter((contract) => contract.lifecycle?.controls?.enableAdapterHandoff === true).length,
    pendingAcceptance: contracts.filter((contract) => contract.acceptance?.state === "pending").length,
    rejectedAcceptance: contracts.filter((contract) => contract.acceptance?.state === "rejected").length,
    diagnostics: diagnostics.length,
  });
}

export function summarizeAiosCapabilities(jobAnalyses = [], diagnostics = []) {
  const contracts = toArray(jobAnalyses).flatMap((job) => job.contracts || []);
  return Object.freeze({
    jobs: jobAnalyses.length,
    capabilities: contracts.length,
    mailchimpCapabilities: contracts.filter((contract) => contract.provider === "mailchimp").length,
    externalWrites: contracts.filter((contract) => contract.effects.externalWrite).length,
    approvals: contracts.filter((contract) => contract.effects.requiredApproval).length,
    acceptedApprovals: contracts.filter((contract) => contract.acceptance?.state === "accepted").length,
    pendingApprovals: contracts.filter((contract) => contract.acceptance?.state === "pending").length,
    rejectedApprovals: contracts.filter((contract) => contract.acceptance?.state === "rejected").length,
    heldByBoundary: contracts.filter((contract) => contract.boundaryDecision?.decision === "hold").length,
    permissionLeaseBlocked: contracts.filter((contract) => contract.lifecycle?.controls?.requirePermissionLeaseRefresh === true).length,
    permissionLeaseReady: contracts.filter((contract) => contract.boundaryDecision?.leaseState === "ready").length,
    permissionPostureBlocked: contracts.filter((contract) => contract.boundaryDecision?.permissionPosture?.state?.endsWith?.("blocked")).length,
    permissionPostureCovered: contracts.filter((contract) => contract.boundaryDecision?.permissionPosture?.state === "covered").length,
    permissionPostureGrantBlocked: contracts.filter((contract) => contract.boundaryDecision?.permissionPosture?.state === "grant-blocked").length,
    permissionPostureLeaseBlocked: contracts.filter((contract) => contract.boundaryDecision?.permissionPosture?.state === "lease-blocked").length,
    permissionPostureIdentityBlocked: contracts.filter((contract) => contract.boundaryDecision?.permissionPosture?.state === "identity-blocked").length,
    workspaceBoundaryQuarantined: contracts.filter((contract) => toArray(contract.boundaryDecision?.reasons).some((reason) => compactString(reason).includes("workspace-boundary"))).length,
    scopeSourcedDecisions: contracts.filter((contract) => contract.boundaryDecision?.source === "scope-permission-boundary").length,
    degradedCapabilities: contracts.filter((contract) => contract.health?.degradedMode !== "none").length,
    disabledCapabilities: contracts.filter((contract) => contract.lifecycle?.mode === "disabled").length,
    schedulableCapabilities: contracts.filter((contract) => contract.lifecycle?.controls?.enableScheduling).length,
    retryableCapabilities: contracts.filter((contract) => contract.health?.retry?.retryable).length,
    adapterStatusFailures: contracts.filter((contract) => ["failed", "timed-out", "cancelled"].includes(contract.statusReconciliation?.state)).length,
    adapterStatusMissing: contracts.filter((contract) => contract.statusReconciliation?.state === "missing-status").length,
    adapterStatusSnapshotBlocked: contracts.filter((contract) => contract.statusReconciliation?.state === "snapshot-blocked").length,
    adapterStatusSucceeded: contracts.filter((contract) => contract.statusReconciliation?.state === "succeeded").length,
    providerSyncBlocked: contracts.filter((contract) => contract.providerSync?.state === "blocked").length,
    providerSyncScopeBlocked: contracts.filter((contract) => contract.providerSync?.metadata?.scopeSyncState === "blocked").length,
    providerSyncPending: contracts.filter((contract) => contract.providerSync?.state === "needs-provider-confirmation").length,
    providerSyncCheckpointReady: contracts.filter((contract) => contract.providerSync?.state === "checkpoint-ready").length,
    segmentSyncReceiptBlocked: contracts.filter((contract) => contract.segmentSyncReceipt?.state === "blocked").length,
    segmentSyncReceiptPending: contracts.filter((contract) => contract.segmentSyncReceipt?.state === "pending").length,
    segmentSyncReceiptAccepted: contracts.filter((contract) => contract.segmentSyncReceipt?.state === "accepted").length,
    providerBudgetBlocked: contracts.filter((contract) => contract.lifecycle?.providerBudget?.state === "blocked").length,
    providerBudgetThrottled: contracts.filter((contract) => ["degraded", "throttled"].includes(contract.lifecycle?.providerBudget?.state)).length,
    providerCallbackBlocked: contracts.filter((contract) => contract.lifecycle?.providerCallback?.state === "blocked").length,
    providerCallbackPending: contracts.filter((contract) => contract.lifecycle?.providerCallback?.state === "pending-verification").length,
    providerCallbackReady: contracts.filter((contract) => contract.lifecycle?.providerCallback?.state === "verified").length,
    providerEventSubscriptionBlocked: contracts.filter((contract) => ["blocked", "missing-subscription"].includes(contract.lifecycle?.providerEventSubscription?.state)).length,
    providerEventSubscriptionPending: contracts.filter((contract) => contract.lifecycle?.providerEventSubscription?.state === "pending").length,
    providerEventSubscriptionReady: contracts.filter((contract) => contract.lifecycle?.providerEventSubscription?.state === "subscribed").length,
    providerMaintenanceBlocked: contracts.filter((contract) => contract.lifecycle?.providerMaintenance?.state === "blocked").length,
    providerMaintenanceDegraded: contracts.filter((contract) => contract.lifecycle?.providerMaintenance?.state === "degraded").length,
    providerServiceUnavailable: contracts.filter((contract) => toArray(contract.lifecycle?.providerMaintenance?.blockedBy)
      .some((reason) => compactString(reason).startsWith("provider-service-"))).length,
    providerServiceDegraded: contracts.filter((contract) => contract.lifecycle?.providerMaintenance?.serviceWindow?.state === "degraded").length,
    providerExportBoundaryBlocked: contracts.filter((contract) => contract.lifecycle?.providerExportBoundary?.state === "blocked" || contract.lifecycle?.providerExportBoundary?.exportable === false).length,
    providerExportBoundaryReady: contracts.filter((contract) => contract.lifecycle?.providerExportBoundary?.exportable === true).length,
    providerExportBoundaryRetryable: contracts.filter((contract) => contract.lifecycle?.providerExportBoundary?.retryable === true).length,
    providerPublicationBlocked: contracts.filter((contract) => contract.lifecycle?.providerPublication?.state === "blocked" || toArray(contract.lifecycle?.providerPublication?.blockedBy).length > 0).length,
    providerPublicationReady: contracts.filter((contract) => contract.lifecycle?.providerPublication?.acceptedForExport === true).length,
    providerPublicationReceiptBlocked: contracts.filter((contract) => contract.lifecycle?.providerPublication?.receiptState === "blocked").length,
    providerPublicationReceiptPending: contracts.filter((contract) => ["pending", "pending-receipt", "needs-receipt"].includes(contract.lifecycle?.providerPublication?.receiptState)).length,
    providerPublicationReceiptAccepted: contracts.filter((contract) => contract.lifecycle?.providerPublication?.acceptedForProviderHandoff === true).length,
    settingsAdoptionBlocked: contracts.filter((contract) => contract.lifecycle?.settingsAdoption?.state === "blocked").length,
    settingsAdoptionPatchRequired: contracts.filter((contract) => contract.lifecycle?.settingsAdoption?.state === "patch-required").length,
    settingsAdoptionDisabled: contracts.filter((contract) => contract.lifecycle?.settingsAdoption?.state === "disabled").length,
    lifecycleGateBlocked: contracts.filter((contract) => ["blocked", "disabled"].includes(contract.lifecycle?.lifecycleGate?.state)).length,
    lifecycleGateGated: contracts.filter((contract) => contract.lifecycle?.lifecycleGate?.state === "gated").length,
    lifecycleGateScheduled: contracts.filter((contract) => contract.lifecycle?.lifecycleGate?.scheduling?.requested === true).length,
    lifecycleCommandReceiptBlocked: contracts.filter((contract) => contract.lifecycle?.controls?.requireLifecycleCommandReceipt === true).length,
    marketingConsentRequired: contracts.filter((contract) => contract.lifecycle?.lifecycleGate?.marketingConsent?.required === true).length,
    marketingConsentBlocked: contracts.filter((contract) => contract.lifecycle?.controls?.requireMarketingConsent === true).length,
    marketingConsentExpired: contracts.filter((contract) => contract.lifecycle?.lifecycleGate?.marketingConsent?.expired === true).length,
    workflowBlockedCapabilities: contracts.filter((contract) => contract.workflowGate?.acceptedForAdapter === false).length,
    workflowReadyCapabilities: contracts.filter((contract) => contract.workflowGate?.state === "ready").length,
    clientCommandReceiptBlockedCapabilities: contracts.filter((contract) => contract.workflowGate?.state === "client-command-receipt-blocked").length,
    clientCommandReceiptCapabilities: contracts.filter((contract) => contract.workflowGate?.clientCommandReceipt).length,
    adapterHandoffReceiptBlockedCapabilities: contracts.filter((contract) => contract.handoff?.adapterHandoffReceipt?.state === "blocked").length,
    adapterHandoffReceiptAcceptedCapabilities: contracts.filter((contract) => contract.handoff?.adapterHandoffReceipt?.state === "accepted").length,
    previewAcceptanceReceipts: contracts.filter((contract) => contract.workflowGate?.previewAcceptanceReceipt).length,
    previewAcceptanceReceiptBlocked: contracts.filter((contract) => ["rejected", "expired"].includes(contract.workflowGate?.previewAcceptanceReceipt?.state)).length,
    previewAcceptanceReceiptMissing: contracts.filter((contract) => ["missing", "pending"].includes(contract.workflowGate?.previewAcceptanceReceipt?.state)).length,
    operationIdentityRows: contracts.filter((contract) => contract.operationIdentity).length,
    operationIdentityBlocked: contracts.filter((contract) => contract.operationIdentity?.state === "blocked" || contract.health?.degradedMode === "operation-identity").length,
    persistedRecoveryCommands: contracts.filter((contract) => contract.handoff?.persistedRecoveryCommand).length,
    persistedRecoveryReplayable: contracts.filter((contract) => contract.handoff?.persistedRecoveryCommand?.safeToReplay === true).length,
    persistedRecoveryBlocked: contracts.filter((contract) => contract.handoff?.persistedRecoveryCommand?.state === "blocked" || contract.handoff?.persistedRecoveryCommand?.safeToReplay === false).length,
    resumptionJournalRows: contracts.filter((contract) => contract.handoff?.resumptionJournalRow).length,
    resumptionJournalReplayable: contracts.filter((contract) => contract.handoff?.resumptionJournalRow?.safeToReplay === true || contract.handoff?.resumptionJournalRow?.state === "replayable").length,
    resumptionJournalBlocked: contracts.filter((contract) => contract.handoff?.resumptionJournalRow?.state === "blocked").length,
    recoveryCheckpointRows: contracts.filter((contract) => contract.recoveryCheckpoint).length,
    recoveryCheckpointReplayable: contracts.filter((contract) => contract.recoveryCheckpoint?.safeToReplay === true || contract.recoveryCheckpoint?.state === "replayable").length,
    recoveryCheckpointBlocked: contracts.filter((contract) => contract.recoveryCheckpoint?.state === "blocked" || contract.health?.degradedMode === "recovery-checkpoint").length,
    workflowHandoffBlockedJobs: toArray(jobAnalyses).filter((job) => job.workflowHandoff?.state === "blocked").length,
    workflowHandoffReadyJobs: toArray(jobAnalyses).filter((job) => job.workflowHandoff?.state === "ready").length,
    workflowHandoffRows: toArray(jobAnalyses).reduce((count, job) => count + (job.workflowHandoff?.summary?.rows ?? 0), 0),
    diagnostics: diagnostics.length,
    readyForEffectAnalysis: diagnostics.every((diagnostic) => diagnostic.level !== "error"),
  });
}
