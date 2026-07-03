export const surfaceId = "aios_capability-security_approval-requirement_013";
export const surfaceGroup = "capability-security";
export const surfaceName = "approval-requirement";

const APPROVAL_STATES = new Set(['required', 'approved', 'denied', 'expired', 'bypassed']);
const RISK_LEVELS = new Set(['low', 'medium', 'high', 'critical']);
const APPROVAL_MODES = new Set(['monitor', 'enforce', 'lockdown']);
const LIFECYCLE_COMMANDS = new Set(['enable', 'disable', 'schedule-review', 'clear-schedule']);
const WORKFLOW_INTENTS = new Set(['review', 'approve', 'deny', 'export', 'handoff', 'monitor']);
const PROVIDER_SYNC_MODES = new Set(['manual', 'pull', 'push', 'bidirectional']);
const DECISION_OUTCOMES = new Set(['approve', 'deny']);
const EXTERNAL_HANDOFF_STATES = new Set(['queued', 'sent', 'acknowledged', 'failed', 'cancelled']);
const RECOVERY_JOURNAL_STATUSES = new Set(['started', 'recovered', 'degraded', 'blocked', 'discarded']);
const OPERATIONAL_INCIDENT_STATES = new Set(['open', 'mitigating', 'resolved', 'ignored']);
const OPERATIONAL_ROUTE_KINDS = new Set(['decision', 'audit', 'export', 'handoff', 'provider']);
const PROVIDER_CAPABILITIES = new Set([
  'approval-events:read',
  'approval-decisions:write',
  'approval-receipts:write',
  'audit-proof:write',
  'tenant-boundary:enforce',
  'lifecycle-state:sync',
  'external-handoff:create',
  'approval-export:stream'
]);
const ROLE_PERMISSIONS = {
  viewer: ['approval:review'],
  reviewer: ['approval:review', 'approval:handoff'],
  approver: ['approval:review', 'approval:approve', 'approval:deny', 'approval:handoff'],
  auditor: ['approval:review', 'approval:export', 'approval:audit'],
  owner: ['approval:review', 'approval:approve', 'approval:deny', 'approval:export', 'approval:handoff', 'approval:audit', 'tenant:cross-scope']
};
const INTENT_PERMISSIONS = {
  review: 'approval:review',
  approve: 'approval:approve',
  deny: 'approval:deny',
  export: 'approval:export',
  handoff: 'approval:handoff',
  monitor: 'approval:review'
};

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeState(value) {
  const state = String(value || 'required').toLowerCase();
  return APPROVAL_STATES.has(state) ? state : 'required';
}

function normalizeRisk(value) {
  const risk = String(value || 'medium').toLowerCase();
  return RISK_LEVELS.has(risk) ? risk : 'medium';
}

function normalizeStringList(value) {
  return asArray(value)
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function uniqueSortedStrings(value) {
  return [...new Set(normalizeStringList(value))].sort();
}

function normalizeProviderCapabilities(value) {
  return normalizeStringList(value)
    .map((capability) => capability.toLowerCase())
    .filter((capability, index, capabilities) => (
      PROVIDER_CAPABILITIES.has(capability) && capabilities.indexOf(capability) === index
    ))
    .sort();
}

function normalizeProviderEndpoint(endpoint = {}, fallbackKind) {
  return {
    kind: endpoint.kind || fallbackKind,
    url: endpoint.url || endpoint.href || null,
    method: String(endpoint.method || 'POST').toUpperCase(),
    requiresReceipt: normalizeBoolean(endpoint.requiresReceipt, true),
    timeoutMs: normalizePositiveInteger(endpoint.timeoutMs, 5000)
  };
}

function normalizeProviderContract(contract = {}, now) {
  const sync = contract.sync || contract.syncMetadata || {};
  const handoff = contract.handoff || contract.externalHandoff || {};
  const syncMode = String(sync.mode || contract.syncMode || 'manual').toLowerCase();
  const capabilities = normalizeProviderCapabilities(
    contract.capabilities || contract.supportedCapabilities || contract.features
  );
  const defaultCapabilities = capabilities.length
    ? capabilities
    : ['approval-events:read', 'audit-proof:write'];

  return {
    schema: 'aios.capabilitySecurity.approvalRequirement.providerContract.v1',
    providerId: contract.providerId || contract.id || 'hosted-kernel-local-provider',
    serviceName: contract.serviceName || contract.name || 'AI OS hosted approval provider',
    contractVersion: contract.contractVersion || contract.version || 'v1',
    supportedCapabilities: defaultCapabilities,
    sync: {
      mode: PROVIDER_SYNC_MODES.has(syncMode) ? syncMode : 'manual',
      cursor: sync.cursor || sync.syncCursor || null,
      lastSyncedAt: sync.lastSyncedAt || sync.syncedAt || null,
      expectedCheckpointId: sync.expectedCheckpointId || contract.expectedCheckpointId || null,
      staleAfterMinutes: normalizePositiveInteger(sync.staleAfterMinutes, 60)
    },
    endpoints: {
      decision: normalizeProviderEndpoint(contract.decisionEndpoint || contract.decision || {}, 'decision'),
      audit: normalizeProviderEndpoint(contract.auditEndpoint || contract.audit || {}, 'audit'),
      export: normalizeProviderEndpoint(contract.exportEndpoint || contract.export || {}, 'export'),
      handoff: normalizeProviderEndpoint(handoff.endpoint || handoff, 'handoff')
    },
    externalHandoff: {
      enabled: normalizeBoolean(handoff.enabled, Boolean(handoff.endpoint || handoff.url)),
      target: handoff.target || handoff.service || contract.externalHandoffTarget || null,
      correlationId: handoff.correlationId || contract.correlationId || null,
      returnRoute: handoff.returnRoute || contract.returnRoute || null
    },
    receivedAt: contract.receivedAt || now
  };
}

function normalizeApprovalEvent(event = {}, index = 0, now) {
  const state = normalizeState(event.state || event.decision);
  const requestedAt = event.requestedAt || event.at || now;
  const resolvedAt = event.resolvedAt || (state === 'approved' || state === 'denied' ? requestedAt : null);
  const approver = event.approver || event.approvedBy || event.deniedBy || null;

  return {
    id: event.id || `${surfaceName}-approval-${index + 1}`,
    capability: event.capability || event.capabilityId || 'unknown-capability',
    tenantId: event.tenantId || event.workspaceId || 'default',
    workspaceId: event.workspaceId || event.workspace || event.projectId || event.tenantWorkspaceId || 'default',
    requester: event.requester || event.requestedBy || 'unknown-requester',
    state,
    risk: normalizeRisk(event.risk || event.riskLevel),
    reason: event.reason || event.justification || null,
    requestedAt,
    resolvedAt,
    approver,
    exportable: event.exportable !== false
  };
}

function buildApprovalCounters(events) {
  return events.reduce((counters, event) => {
    counters.total += 1;
    counters.byState[event.state] = (counters.byState[event.state] || 0) + 1;
    counters.byRisk[event.risk] = (counters.byRisk[event.risk] || 0) + 1;
    counters.byCapability[event.capability] = (counters.byCapability[event.capability] || 0) + 1;
    if (event.state === 'required' && event.risk !== 'low') counters.pendingRiskReviews += 1;
    if (event.state === 'approved' && !event.approver) counters.approvalsMissingActor += 1;
    if (event.state === 'bypassed') counters.bypasses += 1;
    return counters;
  }, {
    total: 0,
    byState: {},
    byRisk: {},
    byCapability: {},
    pendingRiskReviews: 0,
    approvalsMissingActor: 0,
    bypasses: 0
  });
}

function buildHistorySnapshots(events, now) {
  const tenants = new Map();
  for (const event of events) {
    const current = tenants.get(event.tenantId) || {
      tenantId: event.tenantId,
      activeRequirements: 0,
      approved: 0,
      denied: 0,
      highestRisk: 'low',
      lastChangedAt: event.requestedAt
    };
    if (event.state === 'required') current.activeRequirements += 1;
    if (event.state === 'approved') current.approved += 1;
    if (event.state === 'denied') current.denied += 1;
    if (riskRank(event.risk) > riskRank(current.highestRisk)) current.highestRisk = event.risk;
    current.lastChangedAt = event.resolvedAt || event.requestedAt || current.lastChangedAt;
    tenants.set(event.tenantId, current);
  }
  return {
    generatedAt: now,
    tenantSnapshots: [...tenants.values()].sort((a, b) => a.tenantId.localeCompare(b.tenantId)),
    retainedEventCount: events.length
  };
}

function riskRank(risk) {
  return { low: 1, medium: 2, high: 3, critical: 4 }[risk] || 0;
}

function normalizeBoolean(value, fallback = true) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  return !['false', '0', 'off', 'disabled', 'no'].includes(String(value).toLowerCase());
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeNonNegativeInteger(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseTimestamp(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function commandAgeMinutes(command, now) {
  const requestedAt = parseTimestamp(command.requestedAt);
  const evaluatedAt = parseTimestamp(now);
  if (requestedAt === null || evaluatedAt === null || evaluatedAt < requestedAt) return null;
  return Math.floor((evaluatedAt - requestedAt) / 60000);
}

function validateLifecycleCommand(command, settings, now) {
  const findings = [];
  const ageMinutes = commandAgeMinutes(command, now);
  const scheduledForMs = parseTimestamp(command.scheduledFor);
  const evaluatedAtMs = parseTimestamp(now);
  const isGlobalTarget = command.capability === '*';

  if (command.action === 'unknown') {
    findings.push({ code: 'unknown-command', severity: 'error' });
  }
  if (ageMinutes !== null && ageMinutes > settings.commandWindowMinutes) {
    findings.push({
      code: 'command-window-expired',
      severity: 'error',
      ageMinutes,
      allowedMinutes: settings.commandWindowMinutes
    });
  }
  if (['disable', 'clear-schedule'].includes(command.action) && !command.reason) {
    findings.push({ code: 'lifecycle-reason-required', severity: 'error' });
  }
  if (command.action === 'enable' && isGlobalTarget && settings.enabled === false) {
    findings.push({ code: 'settings-disabled-global-enable-rejected', severity: 'error' });
  }
  if (command.action === 'schedule-review') {
    if (!command.scheduledFor || scheduledForMs === null) {
      findings.push({ code: 'schedule-review-time-required', severity: 'error' });
    } else if (evaluatedAtMs !== null && scheduledForMs < evaluatedAtMs) {
      findings.push({ code: 'schedule-review-in-past', severity: 'error' });
    }
    if (!command.reason) {
      findings.push({ code: 'schedule-review-reason-required', severity: 'warning' });
    }
  }
  if (command.action === 'disable' && isGlobalTarget && settings.approvalMode === 'lockdown') {
    findings.push({ code: 'lockdown-global-disable-rejected', severity: 'error' });
  }

  return {
    ok: findings.every((finding) => finding.severity !== 'error'),
    findings
  };
}

function normalizeApprovalSettings(settings = {}) {
  const approvalMode = String(settings.approvalMode || settings.mode || 'enforce').toLowerCase();
  const requireApproverForRisks = asArray(settings.requireApproverForRisks)
    .map((risk) => normalizeRisk(risk))
    .filter((risk, index, risks) => risks.indexOf(risk) === index);
  const tenantBoundary = settings.tenantBoundary || settings.workspaceBoundary || {};

  return {
    enabled: normalizeBoolean(settings.enabled, true),
    approvalMode: APPROVAL_MODES.has(approvalMode) ? approvalMode : 'enforce',
    requireApproverForRisks: requireApproverForRisks.length ? requireApproverForRisks : ['high', 'critical'],
    maxPendingCritical: normalizePositiveInteger(settings.maxPendingCritical, 0),
    reviewCadenceHours: normalizePositiveInteger(settings.reviewCadenceHours, 24),
    commandWindowMinutes: normalizePositiveInteger(settings.commandWindowMinutes, 30),
    disabledCapabilities: asArray(settings.disabledCapabilities).map(String).filter(Boolean).sort(),
    tenantBoundary: {
      requireExplicitTenantGrant: normalizeBoolean(tenantBoundary.requireExplicitTenantGrant, true),
      allowCrossTenantReview: normalizeBoolean(tenantBoundary.allowCrossTenantReview, false),
      requireExplicitWorkspaceGrant: normalizeBoolean(tenantBoundary.requireExplicitWorkspaceGrant, true),
      allowCrossWorkspaceReview: normalizeBoolean(tenantBoundary.allowCrossWorkspaceReview, false),
      defaultTenantIds: uniqueSortedStrings(tenantBoundary.defaultTenantIds || settings.defaultTenantIds),
      blockedTenantIds: uniqueSortedStrings(tenantBoundary.blockedTenantIds || settings.blockedTenantIds),
      defaultWorkspaceIds: uniqueSortedStrings(tenantBoundary.defaultWorkspaceIds || settings.defaultWorkspaceIds),
      blockedWorkspaceIds: uniqueSortedStrings(tenantBoundary.blockedWorkspaceIds || settings.blockedWorkspaceIds)
    },
    scheduledReviews: asArray(settings.scheduledReviews).map((review, index) => ({
      id: review.id || `${surfaceName}-scheduled-review-${index + 1}`,
      tenantId: review.tenantId || review.workspaceId || 'default',
      capability: review.capability || review.capabilityId || '*',
      scheduledFor: review.scheduledFor || review.at || null,
      reason: review.reason || null
    }))
  };
}

function normalizeScheduledReview(review = {}, index = 0) {
  return {
    id: review.id || `${surfaceName}-recovered-review-${index + 1}`,
    tenantId: review.tenantId || review.workspaceId || 'default',
    capability: review.capability || review.capabilityId || '*',
    scheduledFor: review.scheduledFor || review.at || null,
    reason: review.reason || null
  };
}

function commandPersistenceKey(command) {
  return [
    command.id,
    command.action,
    command.tenantId,
    command.capability,
    command.scheduledFor || '',
    command.reason || ''
  ].map(String).join('::');
}

function normalizeCommandLedgerEntry(entry = {}, index = 0, now) {
  const action = String(entry.action || entry.command || '').toLowerCase();
  const status = String(entry.status || entry.state || 'applied').toLowerCase();
  const normalized = normalizeLifecycleCommand(entry, index, entry.requestedAt || entry.at || now);
  return {
    key: entry.key || entry.commandKey || commandPersistenceKey(normalized),
    id: normalized.id,
    action: LIFECYCLE_COMMANDS.has(action) ? action : normalized.action,
    tenantId: normalized.tenantId,
    capability: normalized.capability,
    status: ['applied', 'rejected', 'skipped'].includes(status) ? status : 'applied',
    accepted: entry.accepted !== false && !['rejected', 'skipped'].includes(status),
    appliedAt: entry.appliedAt || entry.completedAt || entry.requestedAt || now,
    reasonCode: entry.reasonCode || null
  };
}

function normalizeRecoveryJournalEntry(entry = {}, index = 0, now) {
  const status = String(entry.status || entry.state || 'started').toLowerCase();
  return {
    id: entry.id || entry.recoveryId || `${surfaceName}-recovery-${index + 1}`,
    checkpointId: entry.checkpointId || entry.checkpoint || null,
    status: RECOVERY_JOURNAL_STATUSES.has(status) ? status : 'started',
    observedAt: entry.observedAt || entry.at || entry.recoveredAt || now,
    reasonCode: entry.reasonCode || entry.reason || null,
    commandKey: entry.commandKey || entry.key || null,
    routeImpact: entry.routeImpact || 'none'
  };
}

function collectPersistedRecoveryFindings(value, rawLifecycle, rawLedger, commandLedger, now) {
  const findings = [];
  const checkpointedAtMs = parseTimestamp(value.checkpointedAt || value.generatedAt);
  const evaluatedAtMs = parseTimestamp(now);
  const rawLedgerKeys = rawLedger.map((entry, index) => (
    entry.key || entry.commandKey || commandPersistenceKey(normalizeLifecycleCommand(entry, index, now))
  ));
  const duplicateCommandKeys = rawLedgerKeys
    .filter((key, index, keys) => keys.indexOf(key) !== index)
    .filter((key, index, keys) => keys.indexOf(key) === index)
    .sort();
  const invalidScheduledReviewIds = asArray(rawLifecycle.scheduledReviews)
    .map((review, index) => normalizeScheduledReview(review, index))
    .filter((review) => !review.scheduledFor || parseTimestamp(review.scheduledFor) === null)
    .map((review) => review.id);
  const unknownReadiness = !['unknown', 'ready', 'needs-review', 'blocked'].includes(
    String(value.lastReadinessStatus || value.readinessStatus || 'unknown').toLowerCase()
  );

  if (!value.checkpointId && !value.id && (value.lifecycle || value.lastKnownLifecycle || rawLedger.length)) {
    findings.push({ code: 'checkpoint-id-missing', severity: 'warning', routeImpact: 'refresh-checkpoint' });
  }
  if (checkpointedAtMs !== null && evaluatedAtMs !== null && checkpointedAtMs > evaluatedAtMs) {
    findings.push({ code: 'checkpoint-from-future', severity: 'error', routeImpact: 'block-recovered-writes' });
  }
  if (unknownReadiness) {
    findings.push({ code: 'unknown-readiness-status', severity: 'warning', routeImpact: 'recompute-readiness' });
  }
  if (duplicateCommandKeys.length) {
    findings.push({
      code: 'duplicate-command-ledger-entries',
      severity: 'info',
      routeImpact: 'dedupe-command-ledger',
      duplicateCommandKeys
    });
  }
  if (invalidScheduledReviewIds.length) {
    findings.push({
      code: 'invalid-scheduled-review-discarded',
      severity: 'warning',
      routeImpact: 'refresh-schedule',
      reviewIds: invalidScheduledReviewIds
    });
  }
  if (commandLedger.some((entry) => entry.status === 'rejected')) {
    findings.push({ code: 'recovered-rejected-command-receipts', severity: 'info', routeImpact: 'surface-command-history' });
  }

  return {
    findings,
    duplicateCommandKeys,
    invalidScheduledReviewIds
  };
}

function normalizePersistedApprovalState(value = {}, now) {
  const rawLifecycle = value.lifecycle || value.lastKnownLifecycle || {};
  const rawLedger = asArray(value.commandLedger || value.appliedCommands || rawLifecycle.commandLedger);
  const commandLedger = rawLedger
    .map((entry, index) => normalizeCommandLedgerEntry(entry, index, now))
    .filter((entry, index, entries) => entries.findIndex((candidate) => candidate.key === entry.key) === index)
    .slice(-100);
  const appliedCommandKeys = new Set(
    commandLedger
      .filter((entry) => entry.status === 'applied' || entry.status === 'rejected')
      .map((entry) => entry.key)
  );
  const recoveryDiagnostics = collectPersistedRecoveryFindings(value, rawLifecycle, rawLedger, commandLedger, now);
  const recoveryJournal = asArray(value.recoveryJournal || value.recovery?.journal || rawLifecycle.recoveryJournal)
    .map((entry, index) => normalizeRecoveryJournalEntry(entry, index, now))
    .slice(-50);
  const recovered = Boolean(value.checkpointId || value.lifecycle || value.lastKnownLifecycle || rawLedger.length);
  const recoveryBlocked = recoveryDiagnostics.findings.some((finding) => finding.severity === 'error');

  return {
    schema: 'aios.capabilitySecurity.approvalRequirement.persistedState.v1',
    checkpointId: value.checkpointId || value.id || `${surfaceName}-checkpoint-empty`,
    checkpointedAt: value.checkpointedAt || value.generatedAt || null,
    recoveredAt: now,
    recovered,
    restartCount: normalizePositiveInteger(value.restartCount, 0),
    lastReadinessStatus: value.lastReadinessStatus || value.readinessStatus || 'unknown',
    recovery: {
      schema: 'aios.capabilitySecurity.approvalRequirement.persistedRecovery.v1',
      status: !recovered
        ? 'cold-start'
        : recoveryBlocked
          ? 'blocked'
          : recoveryDiagnostics.findings.some((finding) => finding.severity === 'warning')
            ? 'degraded'
            : 'recovered',
      canResumeLifecycle: recovered && !recoveryBlocked,
      findings: recoveryDiagnostics.findings,
      duplicateCommandKeys: recoveryDiagnostics.duplicateCommandKeys,
      invalidScheduledReviewIds: recoveryDiagnostics.invalidScheduledReviewIds,
      journal: recoveryJournal,
      lastJournalStatus: recoveryJournal[recoveryJournal.length - 1]?.status || null
    },
    lifecycle: {
      enabled: normalizeBoolean(rawLifecycle.enabled, true),
      disabledCapabilities: asArray(rawLifecycle.disabledCapabilities).map(String).filter(Boolean).sort(),
      scheduledReviews: asArray(rawLifecycle.scheduledReviews)
        .map(normalizeScheduledReview)
        .filter((review) => review.scheduledFor && parseTimestamp(review.scheduledFor) !== null),
      commandLedger,
      appliedCommandKeys: [...appliedCommandKeys].sort()
    }
  };
}

function normalizeClientRequest(request = {}, now, clientState = {}) {
  const intent = String(request.intent || request.action || 'review').toLowerCase();
  const stateSelectionIds = asArray(
    clientState.draftSelectionIds
      || clientState.selectedApprovalIds
      || clientState.selection?.approvalIds
      || clientState.selection?.selectedApprovalIds
  );
  const stateCapabilities = asArray(
    clientState.draftCapabilities
      || clientState.selectedCapabilities
      || clientState.selection?.capabilities
      || clientState.selection?.selectedCapabilities
  );
  const requestedApprovalIds = asArray(request.approvalIds || request.selectedApprovalIds)
    .map(String)
    .filter(Boolean);
  const clientCapabilities = asArray(request.capabilities || request.selectedCapabilities)
    .map(String)
    .filter(Boolean);
  const roles = normalizeStringList(request.roles || request.actorRoles).map((role) => role.toLowerCase());
  const explicitPermissions = normalizeStringList(request.permissions || request.actorPermissions);
  const allowedTenantIds = normalizeStringList(
    request.allowedTenantIds
      || request.tenantScope
      || request.tenantGrants
  );
  const allowedWorkspaceIds = normalizeStringList(
    request.allowedWorkspaceIds
      || request.workspaceScope
      || request.workspaceGrants
  );

  return {
    schema: 'aios.capabilitySecurity.approvalRequirement.request.v1',
    id: request.id || request.requestId || clientState.requestId || `${surfaceName}-request-${now}`,
    route: request.route || request.routeMount || clientState.route || clientState.currentRoute || '/capability-security/approval-requirement',
    intent: WORKFLOW_INTENTS.has(intent) ? intent : 'review',
    actor: request.actor || request.userId || request.operator || clientState.actor || 'unknown-operator',
    tenantId: request.tenantId || request.workspaceId || clientState.tenantId || clientState.workspaceId || 'default',
    workspaceId: request.workspaceId || request.projectId || clientState.workspaceId || clientState.projectId || 'default',
    selectedApprovalIds: [...new Set(requestedApprovalIds.length ? requestedApprovalIds : stateSelectionIds.map(String).filter(Boolean))],
    selectedCapabilities: [...new Set((clientCapabilities.length ? clientCapabilities : stateCapabilities).map(String).filter(Boolean))].sort(),
    actorRoles: [...new Set(roles)].sort(),
    actorPermissions: [...new Set(explicitPermissions)].sort(),
    allowedTenantIds: [...new Set(allowedTenantIds)].sort(),
    allowedWorkspaceIds: [...new Set(allowedWorkspaceIds)].sort(),
    boundaryMode: String(request.boundaryMode || request.scopeMode || 'tenant').toLowerCase() === 'global' ? 'global' : 'tenant',
    returnTo: request.returnTo || request.returnUrl || clientState.returnTo || clientState.returnRoute || null,
    submittedAt: request.submittedAt || request.at || now,
    requiresReceipt: normalizeBoolean(request.requiresReceipt, true)
  };
}

function normalizeClientRuntimeState(state = {}, request, now) {
  const routeHistory = asArray(state.routeHistory || state.history)
    .map((entry, index) => ({
      id: entry.id || `${request.id}-route-${index + 1}`,
      route: entry.route || entry.path || request.route,
      routeState: entry.routeState || entry.state || 'unknown',
      at: entry.at || entry.updatedAt || now
    }))
    .slice(-10);
  const pendingReceiptIds = normalizeStringList(state.pendingReceiptIds || state.receiptDraftIds);
  const acknowledgedBlockingCodes = normalizeStringList(
    state.acknowledgedBlockingCodes || state.acknowledgedBlockers || state.dismissedBlockingCodes
  ).sort();
  const staleSelectionIds = normalizeStringList(state.staleSelectionIds || state.invalidSelectionIds);

  return {
    schema: 'aios.capabilitySecurity.approvalRequirement.clientRuntimeState.v1',
    sessionId: state.sessionId || state.clientSessionId || `${request.id}-session`,
    requestId: request.id,
    actor: request.actor,
    tenantId: request.tenantId,
    route: state.route || state.currentRoute || request.route,
    currentStep: state.currentStep || state.step || 'review-selection',
    routeHistory,
    draftSelectionIds: normalizeStringList(state.draftSelectionIds || state.selectedApprovalIds || request.selectedApprovalIds),
    draftCapabilities: normalizeStringList(state.draftCapabilities || state.selectedCapabilities || request.selectedCapabilities).sort(),
    pendingReceiptIds,
    acknowledgedBlockingCodes,
    staleSelectionIds,
    lastSeenCheckpointId: state.lastSeenCheckpointId || state.checkpointId || null,
    lastProviderCorrelationId: state.lastProviderCorrelationId || state.providerCorrelationId || null,
    handoffReturnRoute: state.handoffReturnRoute || state.returnRoute || request.returnTo,
    dirty: normalizeBoolean(state.dirty || state.hasUnsavedChanges, pendingReceiptIds.length > 0 || staleSelectionIds.length > 0),
    observedAt: state.observedAt || state.updatedAt || now
  };
}

function normalizeDecisionOutcome(value, fallback) {
  const outcome = String(value || fallback || '').toLowerCase();
  if (outcome === 'approved') return 'approve';
  if (outcome === 'denied') return 'deny';
  return DECISION_OUTCOMES.has(outcome) ? outcome : null;
}

function normalizeApprovalDecisionDraft(decision = {}, index = 0, request, now) {
  const outcome = normalizeDecisionOutcome(decision.decision || decision.outcome || decision.action, request.intent);
  const approvalId = decision.approvalId || decision.id || decision.eventId || null;
  return {
    schema: 'aios.capabilitySecurity.approvalRequirement.decisionDraft.v1',
    receiptId: decision.receiptId || decision.proofId || `${request.id}-decision-${index + 1}`,
    approvalId,
    tenantId: decision.tenantId || decision.workspaceId || request.tenantId,
    capability: decision.capability || decision.capabilityId || null,
    outcome,
    actor: decision.actor || decision.approver || decision.denier || request.actor,
    reason: decision.reason || decision.justification || null,
    decidedAt: decision.decidedAt || decision.at || now,
    providerReceiptId: decision.providerReceiptId || decision.externalReceiptId || null,
    proof: {
      source: decision.proof?.source || decision.source || 'hosted-kernel-workflow',
      checksum: decision.proof?.checksum || decision.checksum || null,
      evidenceIds: normalizeStringList(decision.proof?.evidenceIds || decision.evidenceIds),
      requiresProviderReceipt: normalizeBoolean(decision.requiresProviderReceipt, request.requiresReceipt)
    }
  };
}

function buildDecisionReceiptPlan(
  events,
  request,
  selection,
  tenantBoundary,
  providerNegotiation,
  operationalHealth,
  decisionsInput,
  now
) {
  const selectedEvents = events.filter((event) => selection.selectedApprovalIds.includes(event.id));
  const selectedById = new Map(selectedEvents.map((event) => [event.id, event]));
  const decisionIntent = DECISION_OUTCOMES.has(request.intent) ? request.intent : null;
  const drafts = asArray(decisionsInput)
    .map((decision, index) => normalizeApprovalDecisionDraft(decision, index, request, now));
  const draftIds = new Set(drafts.map((draft) => draft.approvalId).filter(Boolean));
  const missingDraftApprovalIds = decisionIntent
    ? selection.selectedApprovalIds.filter((approvalId) => !draftIds.has(approvalId))
    : [];
  const unexpectedDrafts = drafts
    .filter((draft) => !selectedById.has(draft.approvalId))
    .map((draft) => draft.approvalId || draft.receiptId);
  const duplicateDraftApprovalIds = drafts
    .map((draft) => draft.approvalId)
    .filter((approvalId, index, approvalIds) => approvalId && approvalIds.indexOf(approvalId) !== index);
  const mismatchedOutcomeApprovalIds = decisionIntent
    ? drafts
      .filter((draft) => draft.outcome !== decisionIntent)
      .map((draft) => draft.approvalId || draft.receiptId)
    : [];
  const unresolvedRequiredIds = selectedEvents
    .filter((event) => event.state === 'required')
    .map((event) => event.id);
  const nonSubmittableApprovalIds = selectedEvents
    .filter((event) => event.state !== 'required')
    .map((event) => event.id);
  const missingActorApprovalIds = drafts
    .filter((draft) => !draft.actor || draft.actor === 'unknown-operator')
    .map((draft) => draft.approvalId || draft.receiptId);
  const missingReasonApprovalIds = drafts
    .filter((draft) => !draft.reason)
    .map((draft) => draft.approvalId || draft.receiptId);
  const receiptRows = drafts.map((draft) => {
    const event = selectedById.get(draft.approvalId);
    return {
      receiptId: draft.receiptId,
      approvalId: draft.approvalId,
      tenantId: event?.tenantId || draft.tenantId,
      capability: event?.capability || draft.capability,
      requestedOutcome: draft.outcome,
      actor: draft.actor,
      decidedAt: draft.decidedAt,
      providerReceiptId: draft.providerReceiptId,
      proof: draft.proof,
      valid: Boolean(
        event
        && event.state === 'required'
        && draft.outcome === decisionIntent
        && draft.actor
        && draft.reason
      )
    };
  });
  const blockers = [
    ...(decisionIntent && selection.selectedCount === 0 ? ['empty-decision-selection'] : []),
    ...(missingDraftApprovalIds.length ? ['decision-draft-missing-for-selected-approval'] : []),
    ...(unexpectedDrafts.length ? ['decision-draft-outside-selection'] : []),
    ...(duplicateDraftApprovalIds.length ? ['duplicate-decision-draft'] : []),
    ...(mismatchedOutcomeApprovalIds.length ? ['decision-outcome-mismatch'] : []),
    ...(nonSubmittableApprovalIds.length ? ['selected-approval-not-open'] : []),
    ...(missingActorApprovalIds.length ? ['decision-actor-required'] : []),
    ...(missingReasonApprovalIds.length ? ['decision-reason-required'] : []),
    ...(!tenantBoundary.permitted ? ['tenant-boundary-blocked'] : []),
    ...(!providerNegotiation.canSubmitDecision && decisionIntent ? ['provider-decision-route-blocked'] : []),
    ...(!operationalHealth.routeGates.canSubmitDecision && decisionIntent ? ['operational-decision-route-blocked'] : [])
  ];

  return {
    schema: 'aios.capabilitySecurity.approvalRequirement.decisionReceiptPlan.v1',
    generatedAt: now,
    intent: request.intent,
    decisionIntent,
    required: Boolean(decisionIntent),
    submittable: Boolean(decisionIntent) && blockers.length === 0,
    selectedOpenApprovalIds: unresolvedRequiredIds,
    expectedReceiptCount: decisionIntent ? selection.selectedApprovalIds.length : 0,
    receivedDraftCount: drafts.length,
    validDraftCount: receiptRows.filter((row) => row.valid).length,
    blockers: [...new Set(blockers)].sort(),
    draftValidation: {
      missingDraftApprovalIds,
      unexpectedDrafts,
      duplicateDraftApprovalIds: [...new Set(duplicateDraftApprovalIds)].sort(),
      mismatchedOutcomeApprovalIds,
      nonSubmittableApprovalIds,
      missingActorApprovalIds,
      missingReasonApprovalIds
    },
    providerSubmission: {
      endpointUrl: providerNegotiation.handoffEnvelope.receiptEndpoint,
      auditEndpointUrl: providerNegotiation.handoffEnvelope.auditEndpoint,
      requiresProviderReceipt: request.requiresReceipt,
      providerId: providerNegotiation.providerId,
      correlationId: providerNegotiation.externalHandoffState.correlationId,
      routeReady: providerNegotiation.canSubmitDecision && operationalHealth.routeGates.canSubmitDecision
    },
    receiptRows
  };
}

function normalizeExternalHandoffRecord(record = {}, index = 0, request, now) {
  const state = String(record.state || record.status || 'queued').toLowerCase();
  const attemptCount = normalizeNonNegativeInteger(record.attemptCount || record.attempts, 0);
  return {
    id: record.id || record.handoffId || `${request.id}-handoff-${index + 1}`,
    requestId: record.requestId || request.id,
    providerId: record.providerId || null,
    correlationId: record.correlationId || record.traceId || null,
    target: record.target || record.destination || null,
    state: EXTERNAL_HANDOFF_STATES.has(state) ? state : 'queued',
    queuedAt: record.queuedAt || record.createdAt || record.at || now,
    lastAttemptAt: record.lastAttemptAt || record.sentAt || null,
    acknowledgedAt: record.acknowledgedAt || record.ackAt || null,
    attemptCount,
    maxAttempts: normalizePositiveInteger(record.maxAttempts, 3),
    errorCode: record.errorCode || record.code || null,
    returnRoute: record.returnRoute || record.returnTo || request.returnTo || null
  };
}

function buildExternalHandoffQueue(request, selection, providerNegotiation, operationalHealth, handoffInput, now) {
  const handoffSource = handoffInput || {};
  const records = asArray(handoffSource.records || handoffSource.queue || handoffSource.attempts)
    .map((record, index) => normalizeExternalHandoffRecord(record, index, request, now));
  const matchingRecords = records.filter((record) => (
    record.requestId === request.id
    || record.correlationId === providerNegotiation.externalHandoffState.correlationId
  ));
  const openRecords = matchingRecords.filter((record) => ['queued', 'failed'].includes(record.state));
  const exhaustedRecords = openRecords.filter((record) => record.attemptCount >= record.maxAttempts);
  const handoffRequired = providerNegotiation.externalHandoffState.required;
  const providerReady = providerNegotiation.externalHandoffState.ready && operationalHealth.routeGates.canHandoff;
  const selectedApprovalIds = selection.selectedApprovalIds;
  const canDispatch = handoffRequired
    && providerReady
    && selectedApprovalIds.length > 0
    && exhaustedRecords.length === 0;
  const blockers = [
    ...(!handoffRequired ? ['external-handoff-not-requested'] : []),
    ...(selectedApprovalIds.length === 0 ? ['external-handoff-empty-selection'] : []),
    ...(!providerNegotiation.externalHandoffState.ready ? ['external-handoff-provider-not-ready'] : []),
    ...(!operationalHealth.routeGates.canHandoff ? ['external-handoff-route-blocked'] : []),
    ...(exhaustedRecords.length ? ['external-handoff-attempts-exhausted'] : [])
  ];
  const pendingDispatch = canDispatch && !matchingRecords.some((record) => record.state === 'sent' || record.state === 'acknowledged');

  return {
    schema: 'aios.capabilitySecurity.approvalRequirement.externalHandoffQueue.v1',
    generatedAt: now,
    required: handoffRequired,
    dispatchable: canDispatch,
    pendingDispatch,
    providerId: providerNegotiation.providerId,
    correlationId: providerNegotiation.externalHandoffState.correlationId,
    target: providerNegotiation.externalHandoffState.target,
    endpointUrl: providerNegotiation.externalHandoffState.endpointUrl,
    returnRoute: providerNegotiation.externalHandoffState.returnRoute,
    selectedApprovalIds,
    stateCounts: EXTERNAL_HANDOFF_STATES.size
      ? Object.fromEntries([...EXTERNAL_HANDOFF_STATES].map((state) => [
        state,
        matchingRecords.filter((record) => record.state === state).length
      ]))
      : {},
    blockers: [...new Set(blockers)].sort(),
    nextDispatch: pendingDispatch ? {
      requestId: request.id,
      providerId: providerNegotiation.providerId,
      correlationId: providerNegotiation.externalHandoffState.correlationId,
      selectedApprovalIds,
      target: providerNegotiation.externalHandoffState.target,
      endpointUrl: providerNegotiation.externalHandoffState.endpointUrl,
      returnRoute: providerNegotiation.externalHandoffState.returnRoute,
      receiptRequired: request.requiresReceipt
    } : null,
    exhaustedRecordIds: exhaustedRecords.map((record) => record.id),
    records: matchingRecords
  };
}

function buildRequestSelection(events, request) {
  const approvalIds = new Set(request.selectedApprovalIds);
  const capabilities = new Set(request.selectedCapabilities);
  const selectedEvents = events.filter((event) => {
    const matchesApproval = approvalIds.size === 0 || approvalIds.has(event.id);
    const matchesCapability = capabilities.size === 0 || capabilities.has(event.capability);
    const matchesTenant = request.tenantId === '*' || event.tenantId === request.tenantId;
    const matchesWorkspace = request.workspaceId === '*' || event.workspaceId === request.workspaceId;
    return matchesApproval && matchesCapability && matchesTenant && matchesWorkspace;
  });
  const missingApprovalIds = request.selectedApprovalIds
    .filter((approvalId) => !events.some((event) => event.id === approvalId));
  const scopedOutApprovalIds = request.selectedApprovalIds
    .filter((approvalId) => events.some((event) => event.id === approvalId))
    .filter((approvalId) => !selectedEvents.some((event) => event.id === approvalId));

  return {
    schema: 'aios.capabilitySecurity.approvalRequirement.selection.v1',
    selectedCount: selectedEvents.length,
    selectedApprovalIds: selectedEvents.map((event) => event.id),
    missingApprovalIds,
    scopedOutApprovalIds,
    highestSelectedRisk: selectedEvents.reduce((highest, event) => (
      riskRank(event.risk) > riskRank(highest) ? event.risk : highest
    ), 'low'),
    containsBypass: selectedEvents.some((event) => event.state === 'bypassed'),
    containsUnresolvedCritical: selectedEvents.some((event) => event.state === 'required' && event.risk === 'critical')
  };
}

function deriveActorPermissions(request) {
  const permissions = new Set(request.actorPermissions);
  for (const role of request.actorRoles) {
    for (const permission of ROLE_PERMISSIONS[role] || []) permissions.add(permission);
  }
  if (permissions.size === 0) permissions.add('approval:review');
  return permissions;
}

function buildTenantPermissionBoundary(events, request, selection, settings, now) {
  const actorPermissions = deriveActorPermissions(request);
  const intentPermission = INTENT_PERMISSIONS[request.intent] || 'approval:review';
  const eventTenantIds = [...new Set(events.map((event) => event.tenantId))].sort();
  const eventWorkspaceIds = [...new Set(events.map((event) => event.workspaceId))].sort();
  const selectedEvents = events.filter((event) => selection.selectedApprovalIds.includes(event.id));
  const selectedTenantIds = [...new Set(selectedEvents.map((event) => event.tenantId))].sort();
  const selectedWorkspaceIds = [...new Set(selectedEvents.map((event) => event.workspaceId))].sort();
  const configuredTenants = request.allowedTenantIds.length
    ? request.allowedTenantIds
    : settings.tenantBoundary.defaultTenantIds;
  const configuredWorkspaces = request.allowedWorkspaceIds.length
    ? request.allowedWorkspaceIds
    : settings.tenantBoundary.defaultWorkspaceIds;
  const scopeTenants = configuredTenants.length ? configuredTenants : [request.tenantId].filter((tenantId) => tenantId !== '*');
  const scopeWorkspaces = configuredWorkspaces.length
    ? configuredWorkspaces
    : [request.workspaceId].filter((workspaceId) => workspaceId !== '*');
  const allowedTenantIds = request.boundaryMode === 'global' && actorPermissions.has('tenant:cross-scope')
    ? eventTenantIds
    : [...new Set(scopeTenants)].sort();
  const allowedWorkspaceIds = request.boundaryMode === 'global' && actorPermissions.has('tenant:cross-scope')
    ? eventWorkspaceIds
    : [...new Set(scopeWorkspaces)].sort();
  const allowedTenantSet = new Set(allowedTenantIds);
  const allowedWorkspaceSet = new Set(allowedWorkspaceIds);
  const blockedTenantSet = new Set(settings.tenantBoundary.blockedTenantIds);
  const blockedWorkspaceSet = new Set(settings.tenantBoundary.blockedWorkspaceIds);
  const selectedOutOfScope = selectedEvents
    .filter((event) => (
      !allowedTenantSet.has(event.tenantId)
      || !allowedWorkspaceSet.has(event.workspaceId)
      || blockedTenantSet.has(event.tenantId)
      || blockedWorkspaceSet.has(event.workspaceId)
    ))
    .map((event) => ({
      approvalId: event.id,
      tenantId: event.tenantId,
      workspaceId: event.workspaceId,
      capability: event.capability,
      reason: blockedTenantSet.has(event.tenantId)
        ? 'tenant-blocked-by-policy'
        : blockedWorkspaceSet.has(event.workspaceId)
          ? 'workspace-blocked-by-policy'
          : !allowedTenantSet.has(event.tenantId)
            ? 'tenant-not-granted-to-actor'
            : 'workspace-not-granted-to-actor'
    }));
  const crossTenantRequested = request.tenantId === '*' || selectedTenantIds.length > 1 || request.boundaryMode === 'global';
  const crossWorkspaceRequested = request.workspaceId === '*' || selectedWorkspaceIds.length > 1 || request.boundaryMode === 'global';
  const missingPermission = !actorPermissions.has(intentPermission);
  const crossTenantBlocked = crossTenantRequested
    && !settings.tenantBoundary.allowCrossTenantReview
    && !actorPermissions.has('tenant:cross-scope');
  const crossWorkspaceBlocked = crossWorkspaceRequested
    && !settings.tenantBoundary.allowCrossWorkspaceReview
    && !actorPermissions.has('tenant:cross-scope');
  const explicitGrantMissing = settings.tenantBoundary.requireExplicitTenantGrant
    && allowedTenantIds.length === 0
    && eventTenantIds.length > 0;
  const explicitWorkspaceGrantMissing = settings.tenantBoundary.requireExplicitWorkspaceGrant
    && allowedWorkspaceIds.length === 0
    && eventWorkspaceIds.length > 0;
  const scopedOutSelections = selection.scopedOutApprovalIds.map((approvalId) => {
    const event = events.find((candidate) => candidate.id === approvalId);
    return {
      approvalId,
      tenantId: event?.tenantId || null,
      workspaceId: event?.workspaceId || null,
      capability: event?.capability || null,
      reason: 'request-scope-filtered-approval'
    };
  });
  const denialReasons = [
    ...(missingPermission ? ['missing-intent-permission'] : []),
    ...(crossTenantBlocked ? ['cross-tenant-review-blocked'] : []),
    ...(crossWorkspaceBlocked ? ['cross-workspace-review-blocked'] : []),
    ...(explicitGrantMissing ? ['explicit-tenant-grant-required'] : []),
    ...(explicitWorkspaceGrantMissing ? ['explicit-workspace-grant-required'] : []),
    ...(selectedOutOfScope.length ? ['selected-approval-out-of-tenant-scope'] : []),
    ...(scopedOutSelections.length ? ['selected-approval-filtered-by-request-scope'] : [])
  ];

  return {
    schema: 'aios.capabilitySecurity.approvalRequirement.tenantBoundary.v1',
    generatedAt: now,
    actor: request.actor,
    intent: request.intent,
    intentPermission,
    actorRoles: request.actorRoles,
    actorPermissions: [...actorPermissions].sort(),
    requestedTenantId: request.tenantId,
    requestedWorkspaceId: request.workspaceId,
    boundaryMode: request.boundaryMode,
    allowedTenantIds,
    allowedWorkspaceIds,
    blockedTenantIds: settings.tenantBoundary.blockedTenantIds,
    blockedWorkspaceIds: settings.tenantBoundary.blockedWorkspaceIds,
    selectedTenantIds,
    selectedWorkspaceIds,
    observedTenantIds: eventTenantIds,
    observedWorkspaceIds: eventWorkspaceIds,
    selectedOutOfScope: [...selectedOutOfScope, ...scopedOutSelections],
    crossTenantRequested,
    crossWorkspaceRequested,
    crossTenantAllowed: !crossTenantBlocked,
    crossWorkspaceAllowed: !crossWorkspaceBlocked,
    permitted: denialReasons.length === 0,
    denialReasons,
    auditHandoff: {
      evidenceType: 'tenant-permission-boundary',
      subject: request.actor,
      scope: {
        tenantIds: allowedTenantIds,
        workspaceIds: allowedWorkspaceIds
      },
      selectedApprovalIds: selection.selectedApprovalIds,
      deniedApprovalIds: [...selectedOutOfScope, ...scopedOutSelections].map((entry) => entry.approvalId),
      reasons: denialReasons
    }
  };
}

function requiredProviderCapabilitiesForRequest(request, selection, lifecycle) {
  const required = new Set(['approval-events:read', 'audit-proof:write']);
  if (request.intent === 'approve' || request.intent === 'deny') {
    required.add('approval-decisions:write');
    required.add('approval-receipts:write');
    required.add('tenant-boundary:enforce');
  }
  if (request.intent === 'export') required.add('approval-export:stream');
  if (request.intent === 'handoff') required.add('external-handoff:create');
  if (lifecycle.recoveredFromCheckpoint || lifecycle.commandReceipts.length > 0) {
    required.add('lifecycle-state:sync');
  }
  if (selection.containsUnresolvedCritical || selection.containsBypass) {
    required.add('tenant-boundary:enforce');
    required.add('approval-receipts:write');
  }
  return [...required].sort();
}

function buildProviderNegotiation(
  providerContract,
  request,
  selection,
  tenantBoundary,
  readiness,
  lifecycle,
  persistedState,
  exportSummary,
  now
) {
  const supported = new Set(providerContract.supportedCapabilities);
  const requiredCapabilities = requiredProviderCapabilitiesForRequest(request, selection, lifecycle);
  const missingCapabilities = requiredCapabilities.filter((capability) => !supported.has(capability));
  const syncAgeMinutes = providerContract.sync.lastSyncedAt
    ? commandAgeMinutes({ requestedAt: providerContract.sync.lastSyncedAt }, now)
    : null;
  const syncStale = syncAgeMinutes !== null && syncAgeMinutes > providerContract.sync.staleAfterMinutes;
  const checkpointMismatch = Boolean(
    providerContract.sync.expectedCheckpointId
    && lifecycle.recoveredFromCheckpoint
    && providerContract.sync.expectedCheckpointId !== persistedState.checkpointId
  );
  const canWriteDecision = supported.has('approval-decisions:write')
    && supported.has('approval-receipts:write')
    && supported.has('tenant-boundary:enforce')
    && Boolean(providerContract.endpoints.decision.url)
    && missingCapabilities.length === 0;
  const canStreamExport = supported.has('approval-export:stream')
    && exportSummary.rows > 0
    && Boolean(providerContract.endpoints.export.url)
    && missingCapabilities.length === 0;
  const externalHandoffRequired = request.intent === 'handoff' || Boolean(request.returnTo);
  const externalHandoffReady = !externalHandoffRequired
    || (
      providerContract.externalHandoff.enabled
      && supported.has('external-handoff:create')
      && providerContract.endpoints.handoff.url
    );
  const blockedReasons = [
    ...(missingCapabilities.length ? ['provider-capability-gap'] : []),
    ...(syncStale ? ['provider-sync-stale'] : []),
    ...(checkpointMismatch ? ['provider-checkpoint-mismatch'] : []),
    ...(!externalHandoffReady ? ['external-handoff-unavailable'] : [])
  ];

  return {
    schema: 'aios.capabilitySecurity.approvalRequirement.providerNegotiation.v1',
    generatedAt: now,
    providerId: providerContract.providerId,
    serviceName: providerContract.serviceName,
    contractVersion: providerContract.contractVersion,
    requiredCapabilities,
    supportedCapabilities: providerContract.supportedCapabilities,
    missingCapabilities,
    negotiated: blockedReasons.length === 0,
    blockedReasons,
    syncMetadata: {
      mode: providerContract.sync.mode,
      cursor: providerContract.sync.cursor,
      lastSyncedAt: providerContract.sync.lastSyncedAt,
      syncAgeMinutes,
      staleAfterMinutes: providerContract.sync.staleAfterMinutes,
      stale: syncStale,
      expectedCheckpointId: providerContract.sync.expectedCheckpointId,
      recoveredCheckpointId: persistedState.checkpointId,
      checkpointMismatch,
      lifecycleCommandLedgerSize: lifecycle.commandLedger.length
    },
    externalHandoffState: {
      required: externalHandoffRequired,
      enabled: providerContract.externalHandoff.enabled,
      ready: externalHandoffReady,
      target: providerContract.externalHandoff.target,
      correlationId: providerContract.externalHandoff.correlationId || `${request.id}:${selection.selectedCount}`,
      returnRoute: providerContract.externalHandoff.returnRoute || request.returnTo,
      endpointKind: providerContract.endpoints.handoff.kind,
      endpointUrl: providerContract.endpoints.handoff.url
    },
    serviceRoutes: {
      decisionEndpointReady: Boolean(providerContract.endpoints.decision.url && canWriteDecision),
      auditEndpointReady: Boolean(providerContract.endpoints.audit.url && supported.has('audit-proof:write')),
      exportEndpointReady: Boolean(providerContract.endpoints.export.url && canStreamExport),
      handoffEndpointReady: Boolean(providerContract.endpoints.handoff.url && externalHandoffReady)
    },
    canSubmitDecision: canWriteDecision && tenantBoundary.permitted && readiness.status !== 'blocked',
    canExport: canStreamExport && tenantBoundary.permitted && readiness.status !== 'blocked',
    handoffEnvelope: {
      providerId: providerContract.providerId,
      requestId: request.id,
      actor: request.actor,
      tenantId: request.tenantId,
      selectedApprovalIds: selection.selectedApprovalIds,
      highestSelectedRisk: selection.highestSelectedRisk,
      receiptEndpoint: providerContract.endpoints.decision.url,
      auditEndpoint: providerContract.endpoints.audit.url,
      returnTo: providerContract.externalHandoff.returnRoute || request.returnTo
    }
  };
}

function normalizeOperationalProbe(probe = {}, now) {
  const status = String(probe.status || probe.state || 'unknown').toLowerCase();
  return {
    id: probe.id || probe.checkId || `${surfaceName}-health-probe`,
    target: probe.target || probe.endpointKind || 'provider',
    status: ['ok', 'degraded', 'failed', 'timeout', 'unknown'].includes(status) ? status : 'unknown',
    checkedAt: probe.checkedAt || probe.at || now,
    consecutiveFailures: normalizeNonNegativeInteger(probe.consecutiveFailures || probe.failures, 0),
    latencyMs: normalizeNonNegativeInteger(probe.latencyMs || probe.durationMs, 0),
    errorCode: probe.errorCode || probe.code || null,
    message: probe.message || probe.error || null
  };
}

function normalizeOperationalIncident(incident = {}, index = 0, now) {
  const state = String(incident.state || incident.status || 'open').toLowerCase();
  const routeKind = String(incident.routeKind || incident.route || incident.target || 'provider').toLowerCase();
  return {
    id: incident.id || incident.incidentId || `${surfaceName}-incident-${index + 1}`,
    state: OPERATIONAL_INCIDENT_STATES.has(state) ? state : 'open',
    routeKind: OPERATIONAL_ROUTE_KINDS.has(routeKind) ? routeKind : 'provider',
    severity: ['info', 'warning', 'error', 'critical'].includes(String(incident.severity).toLowerCase())
      ? String(incident.severity).toLowerCase()
      : 'error',
    code: incident.code || incident.errorCode || `${routeKind}-operational-incident`,
    message: incident.message || incident.summary || null,
    openedAt: incident.openedAt || incident.createdAt || incident.at || now,
    lastObservedAt: incident.lastObservedAt || incident.updatedAt || incident.observedAt || now,
    retryAfterMs: normalizeNonNegativeInteger(incident.retryAfterMs || incident.cooldownMs, 0),
    operatorAction: incident.operatorAction || incident.action || 'inspect-provider-incident',
    affectsWrites: normalizeBoolean(incident.affectsWrites, true),
    affectsExports: normalizeBoolean(incident.affectsExports, routeKind === 'export' || routeKind === 'provider'),
    affectsHandoff: normalizeBoolean(incident.affectsHandoff, routeKind === 'handoff' || routeKind === 'provider'),
    suppressRoute: normalizeBoolean(incident.suppressRoute || incident.blockRoute, state !== 'resolved')
  };
}

function buildRetryBackoff(probes, providerNegotiation, now) {
  const failureCount = probes.reduce((total, probe) => (
    total + (['failed', 'timeout'].includes(probe.status) ? Math.max(1, probe.consecutiveFailures) : 0)
  ), providerNegotiation.syncMetadata.stale ? 1 : 0);
  const attempt = Math.min(6, failureCount);
  const retryAfterMs = failureCount === 0 ? 0 : Math.min(300000, 1000 * (2 ** attempt));
  const retryAtMs = Date.parse(now);

  return {
    schema: 'aios.capabilitySecurity.approvalRequirement.retryBackoff.v1',
    retryable: failureCount > 0,
    failureCount,
    attempt,
    strategy: failureCount > 0 ? 'exponential-capped' : 'none',
    retryAfterMs,
    retryAt: failureCount > 0 && Number.isFinite(retryAtMs)
      ? new Date(retryAtMs + retryAfterMs).toISOString()
      : null,
    resetCondition: 'successful-provider-health-probe-and-fresh-sync'
  };
}

function incidentAppliesToRequiredRoute(incident, requiredRouteEndpoints) {
  if (incident.state === 'resolved' || incident.state === 'ignored' || !incident.suppressRoute) return false;
  if (incident.routeKind === 'provider') return Object.values(requiredRouteEndpoints).some(Boolean);
  return Boolean(requiredRouteEndpoints[incident.routeKind]);
}

function buildActionableError(code, severity, message, action, details = {}) {
  return {
    code,
    severity,
    message,
    action,
    retryable: Boolean(details.retryable),
    retryAfterMs: details.retryAfterMs || 0,
    routeImpact: details.routeImpact || 'review-only',
    evidence: details.evidence || {}
  };
}

function buildOperationalHealth(providerContract, providerNegotiation, readiness, lifecycle, request, healthInput, now) {
  const healthSource = Array.isArray(healthInput) ? { probes: healthInput } : healthInput || {};
  const probeInput = Array.isArray(healthInput)
    ? healthInput
    : healthSource.probes || healthSource.checks || healthSource.healthChecks;
  const writesDecision = request.intent === 'approve' || request.intent === 'deny';
  const exportsProof = request.intent === 'export';
  const handsOffExternally = request.intent === 'handoff' || Boolean(request.returnTo);
  const probes = asArray(probeInput)
    .map((probe) => normalizeOperationalProbe(probe, now));
  const incidents = asArray(healthSource.incidents || healthSource.failures || healthSource.errors)
    .map((incident, index) => normalizeOperationalIncident(incident, index, now));
  const observedProbeFailures = probes.filter((probe) => ['failed', 'timeout'].includes(probe.status));
  const observedProbeDegraded = probes.filter((probe) => probe.status === 'degraded' || probe.status === 'unknown');
  const requiredRouteEndpoints = {
    decision: writesDecision,
    export: exportsProof,
    handoff: handsOffExternally,
    audit: request.requiresReceipt && (writesDecision || exportsProof || handsOffExternally)
  };
  const unavailableEndpoints = Object.entries(requiredRouteEndpoints)
    .filter(([kind, required]) => required && !providerNegotiation.serviceRoutes[`${kind}EndpointReady`])
    .map(([kind]) => kind);
  const blockingIncidents = incidents.filter((incident) => incidentAppliesToRequiredRoute(incident, requiredRouteEndpoints));
  const degradedIncidents = incidents.filter((incident) => (
    !blockingIncidents.includes(incident)
    && incident.state !== 'resolved'
    && incident.state !== 'ignored'
  ));
  const incidentRetryAfterMs = blockingIncidents
    .map((incident) => incident.retryAfterMs)
    .filter((retryAfterMs) => retryAfterMs > 0)
    .sort((a, b) => a - b)[0] || 0;
  const providerBlocked = providerNegotiation.blockedReasons.length > 0;
  const routeHardBlocked = readiness.status === 'blocked'
    || !lifecycle.enabled
    || unavailableEndpoints.length > 0
    || blockingIncidents.some((incident) => incident.severity === 'error' || incident.severity === 'critical');
  const retryBackoff = buildRetryBackoff(probes, providerNegotiation, now);
  const effectiveRetryBackoff = incidentRetryAfterMs > retryBackoff.retryAfterMs
    ? {
      ...retryBackoff,
      retryable: true,
      retryAfterMs: incidentRetryAfterMs,
      retryAt: Number.isFinite(Date.parse(now)) ? new Date(Date.parse(now) + incidentRetryAfterMs).toISOString() : null,
      resetCondition: 'incident-resolved-and-provider-health-probe-succeeds'
    }
    : retryBackoff;
  const failureReasons = [
    ...observedProbeFailures.map((probe) => probe.errorCode || `${probe.target}-probe-${probe.status}`),
    ...unavailableEndpoints.map((kind) => `${kind}-endpoint-unavailable`),
    ...blockingIncidents.map((incident) => incident.code),
    ...(providerNegotiation.syncMetadata.stale ? ['provider-sync-stale'] : []),
    ...providerNegotiation.blockedReasons
  ];
  const degradedReasons = [
    ...observedProbeDegraded.map((probe) => probe.errorCode || `${probe.target}-probe-${probe.status}`),
    ...degradedIncidents.map((incident) => incident.code),
    ...(readiness.status === 'needs-review' ? ['readiness-needs-review'] : []),
    ...(lifecycle.scheduleState.overdueCount > 0 ? ['scheduled-review-overdue'] : [])
  ];
  const status = routeHardBlocked || observedProbeFailures.length > 0
    ? 'failed'
    : providerBlocked || degradedReasons.length > 0
      ? 'degraded'
      : 'healthy';
  const degradedMode = status === 'healthy'
    ? 'none'
    : status === 'degraded'
      ? 'guarded-review'
      : 'read-only';
  const actionableErrors = [
    ...unavailableEndpoints.map((kind) => buildActionableError(
      `${kind}-endpoint-unavailable`,
      'error',
      `The ${kind} route cannot submit because the provider endpoint is unavailable or missing required capabilities.`,
      kind === 'audit' ? 'restore-audit-proof-endpoint' : `restore-${kind}-endpoint`,
      { retryable: true, retryAfterMs: effectiveRetryBackoff.retryAfterMs, routeImpact: `${kind}-blocked` }
    )),
    ...observedProbeFailures.map((probe) => buildActionableError(
      probe.errorCode || `${probe.target}-probe-${probe.status}`,
      'error',
      probe.message || `Operational probe for ${probe.target} reported ${probe.status}.`,
      'retry-provider-health-check',
      { retryable: true, retryAfterMs: effectiveRetryBackoff.retryAfterMs, routeImpact: 'provider-write-blocked', evidence: probe }
    )),
    ...blockingIncidents.map((incident) => buildActionableError(
      incident.code,
      incident.severity,
      incident.message || `Operational incident ${incident.id} suppresses the ${incident.routeKind} route.`,
      incident.operatorAction,
      {
        retryable: true,
        retryAfterMs: effectiveRetryBackoff.retryAfterMs,
        routeImpact: `${incident.routeKind}-blocked`,
        evidence: {
          incidentId: incident.id,
          state: incident.state,
          routeKind: incident.routeKind,
          openedAt: incident.openedAt,
          lastObservedAt: incident.lastObservedAt
        }
      }
    )),
    ...(providerNegotiation.syncMetadata.stale ? [buildActionableError(
      'provider-sync-stale',
      'warning',
      'Provider sync metadata is older than the configured stale window.',
      'refresh-provider-sync-cursor',
      { retryable: true, retryAfterMs: effectiveRetryBackoff.retryAfterMs, routeImpact: 'provider-negotiation-degraded' }
    )] : [])
  ];
  const circuitBreaker = {
    schema: 'aios.capabilitySecurity.approvalRequirement.operationalCircuitBreaker.v1',
    state: blockingIncidents.length
      ? 'open'
      : degradedIncidents.length || observedProbeDegraded.length
        ? 'half-open'
        : 'closed',
    blockedRouteKinds: [...new Set(blockingIncidents.map((incident) => incident.routeKind))].sort(),
    degradedRouteKinds: [...new Set(degradedIncidents.map((incident) => incident.routeKind))].sort(),
    openIncidentIds: blockingIncidents.map((incident) => incident.id).sort(),
    operatorActions: [...new Set(blockingIncidents.map((incident) => incident.operatorAction))].sort(),
    retryAfterMs: effectiveRetryBackoff.retryAfterMs
  };
  const routeBlockedByIncident = (kind) => (
    circuitBreaker.blockedRouteKinds.includes('provider')
    || circuitBreaker.blockedRouteKinds.includes(kind)
  );

  return {
    schema: 'aios.capabilitySecurity.approvalRequirement.operationalHealth.v1',
    generatedAt: now,
    status,
    degradedMode,
    healthy: status === 'healthy',
    failureState: {
      active: status === 'failed',
      reasons: [...new Set(failureReasons)].sort(),
      firstReason: failureReasons[0] || null,
      providerId: providerContract.providerId,
      readinessStatus: readiness.status,
      lifecycleEnabled: lifecycle.enabled
    },
    validation: {
      ok: actionableErrors.every((error) => error.severity !== 'error'),
      probeCount: probes.length,
      failedProbeCount: observedProbeFailures.length,
      degradedProbeCount: observedProbeDegraded.length,
      openIncidentCount: blockingIncidents.length,
      degradedIncidentCount: degradedIncidents.length,
      unavailableEndpoints,
      providerNegotiated: providerNegotiation.negotiated
    },
    retryBackoff: effectiveRetryBackoff,
    circuitBreaker,
    degradedReasons: [...new Set(degradedReasons)].sort(),
    actionableErrors,
    routeGates: {
      canReview: lifecycle.enabled && readiness.status !== 'blocked',
      canSubmitDecision: status !== 'failed'
        && providerNegotiation.canSubmitDecision
        && !routeBlockedByIncident('decision')
        && !routeBlockedByIncident('audit')
        && unavailableEndpoints.includes('decision') === false,
      canExport: status !== 'failed'
        && providerNegotiation.canExport
        && !routeBlockedByIncident('export')
        && !routeBlockedByIncident('audit')
        && unavailableEndpoints.includes('export') === false,
      canHandoff: status !== 'failed'
        && providerNegotiation.externalHandoffState.ready
        && !routeBlockedByIncident('handoff')
        && !routeBlockedByIncident('audit')
        && unavailableEndpoints.includes('handoff') === false
    },
    providerEndpoints: {
      decisionTimeoutMs: providerContract.endpoints.decision.timeoutMs,
      auditTimeoutMs: providerContract.endpoints.audit.timeoutMs,
      exportTimeoutMs: providerContract.endpoints.export.timeoutMs,
      handoffTimeoutMs: providerContract.endpoints.handoff.timeoutMs
    },
    probes,
    incidents
  };
}

function validateApprovalSettings(settings) {
  const findings = [];
  if (!settings.enabled && settings.approvalMode !== 'monitor') {
    findings.push({
      code: 'disabled-enforcement-mode',
      severity: 'warning',
      message: 'Approval enforcement is disabled while approvalMode is not monitor.'
    });
  }
  if (settings.approvalMode === 'lockdown' && !settings.requireApproverForRisks.includes('critical')) {
    findings.push({
      code: 'lockdown-critical-approver-gap',
      severity: 'error',
      message: 'Lockdown mode must require an approver for critical risk approvals.'
    });
  }
  if (settings.maxPendingCritical === 0) {
    findings.push({
      code: 'critical-pending-block',
      severity: 'info',
      message: 'Critical approvals cannot remain pending without an explicit lifecycle action.'
    });
  }
  return {
    ok: findings.every((finding) => finding.severity !== 'error'),
    findings
  };
}

function normalizeLifecycleCommand(command = {}, index = 0, now) {
  const action = String(command.action || command.command || '').toLowerCase();
  return {
    id: command.id || `${surfaceName}-command-${index + 1}`,
    action: LIFECYCLE_COMMANDS.has(action) ? action : 'unknown',
    tenantId: command.tenantId || command.workspaceId || 'default',
    capability: command.capability || command.capabilityId || '*',
    actor: command.actor || command.requestedBy || 'system',
    reason: command.reason || command.justification || null,
    requestedAt: command.requestedAt || command.at || now,
    scheduledFor: command.scheduledFor || command.reviewAt || null
  };
}

function buildLifecycleCapabilityControls(events, enabled, disabledCapabilities, scheduledReviews, now) {
  const disabledCapabilitySet = new Set(disabledCapabilities);
  const capabilityNames = [...new Set([
    ...events.map((event) => event.capability),
    ...disabledCapabilities,
    ...scheduledReviews
      .filter((review) => review.capability && review.capability !== '*')
      .map((review) => review.capability)
  ])].sort();
  const scheduledByCapability = new Map();
  for (const review of scheduledReviews) {
    const key = `${review.tenantId}::${review.capability}`;
    const bucket = scheduledByCapability.get(key) || [];
    bucket.push(review);
    scheduledByCapability.set(key, bucket);
  }
  const scheduleCollisions = [...scheduledByCapability.entries()]
    .filter(([, reviews]) => reviews.length > 1)
    .map(([key, reviews]) => {
      const [tenantId, capability] = key.split('::');
      return {
        tenantId,
        capability,
        reviewIds: reviews.map((review) => review.id).sort(),
        earliestScheduledFor: reviews
          .map((review) => review.scheduledFor)
          .sort((a, b) => String(a).localeCompare(String(b)))[0] || null
      };
    })
    .sort((left, right) => left.tenantId.localeCompare(right.tenantId) || left.capability.localeCompare(right.capability));
  const capabilityStates = capabilityNames.map((capability) => {
    const capabilityEvents = events.filter((event) => event.capability === capability);
    const openEvents = capabilityEvents.filter((event) => event.state === 'required');
    const matchingReviews = scheduledReviews.filter((review) => review.capability === capability || review.capability === '*');
    const pendingReviews = matchingReviews.filter((review) => {
      const scheduledForMs = parseTimestamp(review.scheduledFor);
      const nowMs = parseTimestamp(now);
      return scheduledForMs !== null && nowMs !== null && scheduledForMs > nowMs;
    });
    const overdueReviews = matchingReviews.filter((review) => {
      const scheduledForMs = parseTimestamp(review.scheduledFor);
      const nowMs = parseTimestamp(now);
      return scheduledForMs !== null && nowMs !== null && scheduledForMs <= nowMs;
    });
    const blockedByLifecycle = !enabled || disabledCapabilitySet.has(capability);
    const highestOpenRisk = openEvents.reduce((highest, event) => (
      riskRank(event.risk) > riskRank(highest) ? event.risk : highest
    ), 'low');
    const state = blockedByLifecycle
      ? !enabled ? 'globally-disabled' : 'capability-disabled'
      : overdueReviews.length
        ? 'review-overdue'
        : openEvents.some((event) => event.risk === 'critical')
          ? 'critical-open'
          : 'active';

    return {
      capability,
      state,
      enabled: !blockedByLifecycle,
      disabledReason: !enabled
        ? 'approval-requirement-disabled'
        : disabledCapabilitySet.has(capability)
          ? 'capability-disabled-by-lifecycle'
          : null,
      openApprovalIds: openEvents.map((event) => event.id).sort(),
      openApprovalCount: openEvents.length,
      blockedOpenApprovalIds: blockedByLifecycle ? openEvents.map((event) => event.id).sort() : [],
      highestOpenRisk,
      pendingReviewIds: pendingReviews.map((review) => review.id).sort(),
      overdueReviewIds: overdueReviews.map((review) => review.id).sort(),
      nextReviewAt: pendingReviews
        .map((review) => review.scheduledFor)
        .sort((a, b) => String(a).localeCompare(String(b)))[0] || null,
      nextLifecycleAction: blockedByLifecycle && openEvents.length
        ? 'enable-capability-before-decision'
        : overdueReviews.length
          ? 'run-scheduled-review'
          : openEvents.length
            ? 'review-open-approvals'
            : 'monitor'
    };
  });

  return {
    schema: 'aios.capabilitySecurity.approvalRequirement.lifecycleCapabilityControls.v1',
    generatedAt: now,
    capabilityStates,
    disabledOpenApprovalIds: capabilityStates.flatMap((state) => state.blockedOpenApprovalIds).sort(),
    disabledOpenCapabilityCount: capabilityStates.filter((state) => state.blockedOpenApprovalIds.length > 0).length,
    scheduleCollisions,
    scheduleCollisionCount: scheduleCollisions.length
  };
}

function buildLifecycleControls(settings, commands, now, persistedState, events = []) {
  const canResumeRecoveredLifecycle = !persistedState.recovered || persistedState.recovery.canResumeLifecycle;
  let enabled = persistedState.recovered && canResumeRecoveredLifecycle ? persistedState.lifecycle.enabled : settings.enabled;
  if (settings.enabled === false) enabled = false;
  const disabledCapabilities = new Set([
    ...(canResumeRecoveredLifecycle ? persistedState.lifecycle.disabledCapabilities : []),
    ...settings.disabledCapabilities
  ]);
  const scheduledReviews = [
    ...(canResumeRecoveredLifecycle ? persistedState.lifecycle.scheduledReviews : []),
    ...settings.scheduledReviews
  ];
  const commandLedger = new Map(
    persistedState.lifecycle.commandLedger.map((entry) => [entry.key, entry])
  );
  const receipts = commands.map((command) => {
    const commandKey = commandPersistenceKey(command);
    const priorReceipt = commandLedger.get(commandKey);
    if (priorReceipt) {
      return {
        ...command,
        commandKey,
        accepted: priorReceipt.accepted,
        status: priorReceipt.status === 'rejected'
          ? 'already-rejected'
          : priorReceipt.status === 'skipped'
            ? 'already-skipped'
            : 'already-applied',
        idempotentReplay: true,
        appliedAt: priorReceipt.appliedAt,
        reasonCode: priorReceipt.reasonCode
      };
    }
    if (!canResumeRecoveredLifecycle) {
      const skipped = {
        ...command,
        commandKey,
        accepted: false,
        status: 'skipped',
        appliedAt: now,
        reasonCode: 'persisted-recovery-blocked',
        validationFindings: persistedState.recovery.findings
      };
      commandLedger.set(commandKey, normalizeCommandLedgerEntry(skipped, commandLedger.size, now));
      return skipped;
    }
    const commandValidation = validateLifecycleCommand(command, settings, now);
    if (!commandValidation.ok) {
      const rejected = {
        ...command,
        commandKey,
        accepted: false,
        status: 'rejected',
        reasonCode: commandValidation.findings.find((finding) => finding.severity === 'error')?.code || 'command-rejected',
        validationFindings: commandValidation.findings
      };
      commandLedger.set(commandKey, normalizeCommandLedgerEntry(rejected, commandLedger.size, now));
      return rejected;
    }
    if (command.action === 'disable' && command.capability === '*') enabled = false;
    if (command.action === 'disable' && command.capability !== '*') disabledCapabilities.add(command.capability);
    if (command.action === 'enable' && command.capability === '*') enabled = true;
    if (command.action === 'enable' && command.capability !== '*') disabledCapabilities.delete(command.capability);
    if (command.action === 'schedule-review') {
      const review = {
        id: `${command.id}-review`,
        tenantId: command.tenantId,
        capability: command.capability,
        scheduledFor: command.scheduledFor || now,
        reason: command.reason
      };
      const hasReview = scheduledReviews.some((scheduled) => (
        scheduled.id === review.id
        || (scheduled.tenantId === review.tenantId
          && scheduled.capability === review.capability
          && String(scheduled.scheduledFor) === String(review.scheduledFor))
      ));
      if (!hasReview) scheduledReviews.push(review);
    }
    if (command.action === 'clear-schedule') {
      for (let index = scheduledReviews.length - 1; index >= 0; index -= 1) {
        const review = scheduledReviews[index];
        const capabilityMatches = command.capability === '*' || review.capability === command.capability;
        if (review.tenantId === command.tenantId && capabilityMatches) scheduledReviews.splice(index, 1);
      }
    }
    const applied = {
      ...command,
      commandKey,
      accepted: true,
      status: 'applied',
      appliedAt: now,
      validationFindings: commandValidation.findings
    };
    commandLedger.set(commandKey, normalizeCommandLedgerEntry(applied, commandLedger.size, now));
    return applied;
  });
  const rejectedReceipts = receipts.filter((receipt) => receipt.status === 'rejected');
  const skippedReceipts = receipts.filter((receipt) => receipt.status === 'skipped' || receipt.status === 'already-skipped');
  const replayedReceipts = receipts.filter((receipt) => receipt.idempotentReplay);
  const statusCounts = receipts.reduce((counts, receipt) => {
    counts[receipt.status] = (counts[receipt.status] || 0) + 1;
    return counts;
  }, {});
  const pendingScheduledReviews = scheduledReviews
    .filter((review) => parseTimestamp(review.scheduledFor) !== null && String(review.scheduledFor) > String(now));
  const overdueScheduledReviews = scheduledReviews
    .filter((review) => parseTimestamp(review.scheduledFor) !== null && String(review.scheduledFor) <= String(now));
  const capabilityControls = buildLifecycleCapabilityControls(
    events,
    enabled,
    [...disabledCapabilities].sort(),
    scheduledReviews,
    now
  );

  return {
    enabled,
    disabledCapabilities: [...disabledCapabilities].sort(),
    scheduledReviews: scheduledReviews
      .filter((review) => review.scheduledFor)
      .filter((review, index, reviews) => reviews.findIndex((candidate) => candidate.id === review.id) === index)
      .sort((a, b) => String(a.scheduledFor).localeCompare(String(b.scheduledFor))),
    commandReceipts: receipts,
    commandLedger: [...commandLedger.values()].slice(-100),
    commandValidation: {
      schema: 'aios.capabilitySecurity.approvalRequirement.lifecycleCommandValidation.v1',
      rejectedCount: rejectedReceipts.length,
      rejectedCommandIds: rejectedReceipts.map((receipt) => receipt.id),
      reasonCodes: [...new Set(rejectedReceipts.map((receipt) => receipt.reasonCode).filter(Boolean))].sort(),
      warnings: receipts
        .flatMap((receipt) => asArray(receipt.validationFindings)
          .filter((finding) => finding.severity === 'warning')
          .map((finding) => ({
            commandId: receipt.id,
            code: finding.code
          })))
    },
    commandOutcomes: {
      schema: 'aios.capabilitySecurity.approvalRequirement.lifecycleCommandOutcomes.v1',
      statusCounts,
      appliedCommandKeys: receipts
        .filter((receipt) => receipt.status === 'applied' || receipt.status === 'already-applied')
        .map((receipt) => receipt.commandKey)
        .sort(),
      rejectedCommandKeys: receipts
        .filter((receipt) => receipt.status === 'rejected' || receipt.status === 'already-rejected')
        .map((receipt) => receipt.commandKey)
        .sort(),
      skippedCommandKeys: skippedReceipts.map((receipt) => receipt.commandKey).sort(),
      replayedCommandKeys: replayedReceipts.map((receipt) => receipt.commandKey).sort(),
      replayedRejectedCommandIds: replayedReceipts
        .filter((receipt) => receipt.status === 'already-rejected')
        .map((receipt) => receipt.id)
        .sort(),
      blockedByRecovery: !canResumeRecoveredLifecycle
    },
    scheduleState: {
      schema: 'aios.capabilitySecurity.approvalRequirement.scheduleState.v1',
      pendingCount: pendingScheduledReviews.length,
      overdueCount: overdueScheduledReviews.length,
      collisionCount: capabilityControls.scheduleCollisionCount,
      nextReviewAt: pendingScheduledReviews
        .map((review) => review.scheduledFor)
        .sort((a, b) => String(a).localeCompare(String(b)))[0] || null,
      overdueReviewIds: overdueScheduledReviews.map((review) => review.id),
      scheduleCollisions: capabilityControls.scheduleCollisions
    },
    capabilityControls,
    recoveredFromCheckpoint: persistedState.recovered,
    recoveryState: {
      schema: 'aios.capabilitySecurity.approvalRequirement.lifecycleRecoveryState.v1',
      checkpointId: persistedState.checkpointId,
      recovered: persistedState.recovered,
      persistedRecoveryStatus: persistedState.recovery.status,
      canResumeRecoveredLifecycle,
      recoveryFindingCodes: persistedState.recovery.findings.map((finding) => finding.code),
      discardedPersistedScheduleIds: canResumeRecoveredLifecycle ? [] : persistedState.lifecycle.scheduledReviews.map((review) => review.id),
      commandWriteMode: canResumeRecoveredLifecycle ? 'read-write' : 'audit-only'
    },
    idempotentReplayCount: replayedReceipts.length
  };
}

function buildPersistenceCheckpoint(settings, lifecycle, readiness, now) {
  return {
    schema: 'aios.capabilitySecurity.approvalRequirement.persistenceCheckpoint.v1',
    checkpointId: `${surfaceName}-checkpoint-${now}`,
    checkpointedAt: now,
    lastReadinessStatus: readiness.status,
    lifecycle: {
      enabled: lifecycle.enabled,
      disabledCapabilities: lifecycle.disabledCapabilities,
      scheduledReviews: lifecycle.scheduledReviews,
      commandLedger: lifecycle.commandLedger,
      commandValidation: lifecycle.commandValidation,
      commandOutcomes: lifecycle.commandOutcomes,
      recoveryState: lifecycle.recoveryState,
      scheduleState: lifecycle.scheduleState,
      capabilityControls: lifecycle.capabilityControls
    },
    recoveryJournalEntry: {
      id: `${surfaceName}-recovery-${now}`,
      checkpointId: `${surfaceName}-checkpoint-${now}`,
      status: readiness.status === 'blocked'
        ? 'blocked'
        : lifecycle.recoveryState.canResumeRecoveredLifecycle
          ? 'recovered'
          : 'degraded',
      observedAt: now,
      reasonCode: readiness.reasons[0] || lifecycle.recoveryState.recoveryFindingCodes[0] || null,
      routeImpact: lifecycle.recoveryState.commandWriteMode === 'audit-only' ? 'block-lifecycle-writes' : 'none'
    },
    settingsShape: {
      approvalMode: settings.approvalMode,
      requireApproverForRisks: settings.requireApproverForRisks,
      maxPendingCritical: settings.maxPendingCritical,
      reviewCadenceHours: settings.reviewCadenceHours,
      commandWindowMinutes: settings.commandWindowMinutes
    }
  };
}

function buildRestartSafety(persistedState, lifecycle, readiness, requestSelection, now) {
  const replayedCommandIds = lifecycle.commandReceipts
    .filter((receipt) => receipt.idempotentReplay)
    .map((receipt) => receipt.id);
  const selectedMissingAfterRecovery = requestSelection.missingApprovalIds.length > 0;
  const recoveryBlocked = persistedState.recovery.status === 'blocked' || lifecycle.commandOutcomes.blockedByRecovery;
  const status = recoveryBlocked
    ? 'checkpoint-recovery-blocked'
    : !lifecycle.enabled
    ? 'recovered-blocked'
    : readiness.status === 'blocked'
      ? 'recovered-needs-operator'
      : selectedMissingAfterRecovery
        ? 'selection-needs-refresh'
        : 'restart-safe';

  return {
    schema: 'aios.capabilitySecurity.approvalRequirement.restartSafety.v1',
    generatedAt: now,
    status,
    recoveredFromCheckpoint: persistedState.recovered,
    checkpointId: persistedState.checkpointId,
    checkpointedAt: persistedState.checkpointedAt,
    replayedCommandIds,
    idempotentReplayCount: replayedCommandIds.length,
    recoveryFindings: persistedState.recovery.findings,
    commandWriteMode: lifecycle.recoveryState.commandWriteMode,
    blockedCommandKeys: lifecycle.commandOutcomes.skippedCommandKeys,
    canReuseClientSelection: !selectedMissingAfterRecovery && !['recovered-blocked', 'checkpoint-recovery-blocked'].includes(status),
    routeRefreshRequired: status !== 'restart-safe',
    reason: status === 'restart-safe'
      ? 'persisted-lifecycle-and-selection-are-current'
      : status
  };
}

function buildNextAction(events, counters, settings, validation, lifecycle, now) {
  const criticalPending = events.filter((event) => event.state === 'required' && event.risk === 'critical');
  const missingActor = events.find((event) => event.state === 'approved' && !event.approver);
  const overdueSchedule = lifecycle.scheduledReviews.find((review) => String(review.scheduledFor) <= String(now));
  const disabledOpenCapability = lifecycle.capabilityControls.capabilityStates
    .find((state) => state.blockedOpenApprovalIds.length > 0);
  const scheduleCollision = lifecycle.capabilityControls.scheduleCollisions[0];

  if (lifecycle.commandValidation.rejectedCount > 0) {
    return {
      type: 'fix-lifecycle-command',
      priority: 'high',
      reason: lifecycle.commandValidation.reasonCodes[0] || 'lifecycle-command-rejected',
      commandId: lifecycle.commandValidation.rejectedCommandIds[0]
    };
  }
  if (!validation.ok) {
    return { type: 'fix-settings', priority: 'critical', reason: validation.findings[0].code };
  }
  if (!lifecycle.enabled) {
    return { type: 'enable-approval-requirement', priority: 'high', reason: 'approval-controls-disabled' };
  }
  if (disabledOpenCapability) {
    return {
      type: 'enable-capability-before-decision',
      priority: riskRank(disabledOpenCapability.highestOpenRisk) >= riskRank('high') ? 'high' : 'medium',
      reason: disabledOpenCapability.disabledReason,
      capability: disabledOpenCapability.capability,
      approvalId: disabledOpenCapability.blockedOpenApprovalIds[0],
      count: disabledOpenCapability.blockedOpenApprovalIds.length
    };
  }
  if (scheduleCollision) {
    return {
      type: 'dedupe-scheduled-review',
      priority: 'medium',
      reason: 'lifecycle-schedule-collision',
      tenantId: scheduleCollision.tenantId,
      capability: scheduleCollision.capability,
      scheduleIds: scheduleCollision.reviewIds
    };
  }
  if (criticalPending.length > settings.maxPendingCritical) {
    return {
      type: 'resolve-critical-approval',
      priority: 'critical',
      approvalId: criticalPending[0].id,
      count: criticalPending.length
    };
  }
  if (missingActor && settings.requireApproverForRisks.includes(missingActor.risk)) {
    return { type: 'attach-approver-proof', priority: 'high', approvalId: missingActor.id };
  }
  if (overdueSchedule) {
    return { type: 'run-scheduled-review', priority: 'medium', scheduleId: overdueSchedule.id };
  }
  if (counters.pendingRiskReviews > 0) {
    return { type: 'review-pending-risk', priority: 'medium', count: counters.pendingRiskReviews };
  }
  return { type: 'none', priority: 'low', reason: 'approval-requirement-controls-current' };
}

function buildTimeline(events) {
  return events
    .flatMap((event) => {
      const requested = {
        at: event.requestedAt,
        type: 'approval_requested',
        approvalId: event.id,
        capability: event.capability,
        tenantId: event.tenantId,
        risk: event.risk
      };
      if (!event.resolvedAt) return [requested];
      return [requested, {
        at: event.resolvedAt,
        type: `approval_${event.state}`,
        approvalId: event.id,
        capability: event.capability,
        tenantId: event.tenantId,
        approver: event.approver
      }];
    })
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

function dateBucket(value) {
  return String(value || '').slice(0, 10) || 'undated';
}

function ageHoursSince(value, now) {
  const startedAt = Date.parse(value);
  const endedAt = Date.parse(now);
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt < startedAt) return null;
  return Math.round((endedAt - startedAt) / 3600000);
}

function durationHoursBetween(start, end) {
  const startedAt = Date.parse(start);
  const endedAt = Date.parse(end);
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt < startedAt) return null;
  return Math.round((endedAt - startedAt) / 3600000);
}

function incrementCounter(target, key, amount = 1) {
  target[key] = (target[key] || 0) + amount;
}

function buildApprovalAnalyticsReport(events, counters, timeline, exportSummary, settings, lifecycle, now) {
  const byTenant = {};
  const openedByDay = {};
  const resolvedByDay = {};
  const openAgeBuckets = { under4h: 0, under24h: 0, under72h: 0, over72h: 0, unknown: 0 };
  const resolutionDurations = [];
  const riskReviewQueue = [];

  for (const event of events) {
    const tenant = byTenant[event.tenantId] || {
      total: 0,
      open: 0,
      resolved: 0,
      bypasses: 0,
      approvalsMissingActor: 0,
      highestRisk: 'low',
      capabilities: {}
    };
    tenant.total += 1;
    incrementCounter(tenant.capabilities, event.capability);
    if (event.state === 'required') tenant.open += 1;
    if (event.resolvedAt) tenant.resolved += 1;
    if (event.state === 'bypassed') tenant.bypasses += 1;
    if (event.state === 'approved' && !event.approver) tenant.approvalsMissingActor += 1;
    if (riskRank(event.risk) > riskRank(tenant.highestRisk)) tenant.highestRisk = event.risk;
    byTenant[event.tenantId] = tenant;

    incrementCounter(openedByDay, dateBucket(event.requestedAt));
    if (event.resolvedAt) incrementCounter(resolvedByDay, dateBucket(event.resolvedAt));

    if (event.state === 'required') {
      const ageHours = ageHoursSince(event.requestedAt, now);
      if (ageHours === null) openAgeBuckets.unknown += 1;
      else if (ageHours < 4) openAgeBuckets.under4h += 1;
      else if (ageHours < 24) openAgeBuckets.under24h += 1;
      else if (ageHours < 72) openAgeBuckets.under72h += 1;
      else openAgeBuckets.over72h += 1;
      if (settings.requireApproverForRisks.includes(event.risk)) {
        riskReviewQueue.push({
          approvalId: event.id,
          tenantId: event.tenantId,
          capability: event.capability,
          risk: event.risk,
          ageHours
        });
      }
    }

    const durationHours = durationHoursBetween(event.requestedAt, event.resolvedAt);
    if (durationHours !== null) resolutionDurations.push(durationHours);
  }

  const sortedDurations = [...resolutionDurations].sort((a, b) => a - b);
  const averageResolutionHours = sortedDurations.length
    ? Math.round(sortedDurations.reduce((sum, value) => sum + value, 0) / sortedDurations.length)
    : null;
  const p95ResolutionHours = sortedDurations.length
    ? sortedDurations[Math.min(sortedDurations.length - 1, Math.ceil(sortedDurations.length * 0.95) - 1)]
    : null;
  const timelineMarkers = timeline.slice(-10).map((entry) => ({
    at: entry.at,
    type: entry.type,
    approvalId: entry.approvalId,
    tenantId: entry.tenantId,
    capability: entry.capability
  }));

  return {
    schema: 'aios.capabilitySecurity.approvalRequirement.analyticsReport.v1',
    generatedAt: now,
    healthCounters: {
      totalEvents: counters.total,
      openRequirements: counters.byState.required || 0,
      highOrCriticalOpen: events.filter((event) => (
        event.state === 'required' && (event.risk === 'high' || event.risk === 'critical')
      )).length,
      approvalsMissingActor: counters.approvalsMissingActor,
      bypasses: counters.bypasses,
      disabledCapabilityCount: lifecycle.disabledCapabilities.length,
      scheduledReviewCount: lifecycle.scheduledReviews.length,
      disabledOpenApprovalCount: lifecycle.capabilityControls.disabledOpenApprovalIds.length,
      scheduleCollisionCount: lifecycle.capabilityControls.scheduleCollisionCount
    },
    byTenant: Object.fromEntries(Object.entries(byTenant).sort(([left], [right]) => left.localeCompare(right))),
    openedByDay,
    resolvedByDay,
    openAgeBuckets,
    resolutionSla: {
      observedResolvedCount: sortedDurations.length,
      averageResolutionHours,
      p95ResolutionHours,
      reviewCadenceHours: settings.reviewCadenceHours,
      breachingReviewCadenceCount: sortedDurations.filter((value) => value > settings.reviewCadenceHours).length
    },
    riskReviewQueue: riskReviewQueue
      .sort((a, b) => riskRank(b.risk) - riskRank(a.risk) || (b.ageHours || 0) - (a.ageHours || 0))
      .slice(0, 20),
    exportManifest: {
      schema: exportSummary.schema,
      generatedAt: exportSummary.generatedAt,
      rows: exportSummary.rows,
      redactions: exportSummary.redactions,
      columns: exportSummary.columns,
      readyForExport: exportSummary.rows > 0,
      summaryFields: Object.keys(exportSummary.totals).sort()
    },
    timelineMarkers
  };
}

function buildExportSummary(events, counters, now) {
  const exportableEvents = events.filter((event) => event.exportable);
  return {
    schema: 'aios.capabilitySecurity.approvalRequirement.export.v1',
    generatedAt: now,
    rows: exportableEvents.length,
    columns: ['id', 'tenantId', 'capability', 'requester', 'state', 'risk', 'requestedAt', 'resolvedAt', 'approver', 'reason'],
    redactions: events.length - exportableEvents.length,
    totals: {
      approvals: counters.byState.approved || 0,
      denials: counters.byState.denied || 0,
      openRequirements: counters.byState.required || 0,
      bypasses: counters.bypasses
    }
  };
}

function buildApprovalPreview(events, lifecycle, now) {
  const disabledCapabilities = new Set(lifecycle.disabledCapabilities);
  const rows = events
    .filter((event) => event.state === 'required' || event.state === 'bypassed')
    .sort((a, b) => riskRank(b.risk) - riskRank(a.risk) || String(a.requestedAt).localeCompare(String(b.requestedAt)))
    .slice(0, 8)
    .map((event) => {
      const blockedByLifecycle = !lifecycle.enabled || disabledCapabilities.has(event.capability);
      return {
        approvalId: event.id,
        tenantId: event.tenantId,
        capability: event.capability,
        risk: event.risk,
        state: event.state,
        requestedAt: event.requestedAt,
        previewLabel: `${event.capability} ${event.risk} approval`,
        operatorHint: blockedByLifecycle ? 'Lifecycle controls currently block this capability.' : 'Review approval proof before enabling access.',
        requiresHumanAcceptance: event.risk === 'high' || event.risk === 'critical' || event.state === 'bypassed',
        blockedByLifecycle
      };
    });

  return {
    schema: 'aios.capabilitySecurity.approvalRequirement.preview.v1',
    generatedAt: now,
    empty: rows.length === 0,
    rows
  };
}

function buildAcceptanceSummary(events, counters, settings, lifecycle, tenantBoundary) {
  const missingRequiredApprovers = events
    .filter((event) => event.state === 'approved' && !event.approver && settings.requireApproverForRisks.includes(event.risk))
    .map((event) => event.id);
  const criticalPending = events
    .filter((event) => event.state === 'required' && event.risk === 'critical')
    .map((event) => event.id);
  const disabledOpenApprovalIds = lifecycle.capabilityControls.disabledOpenApprovalIds;
  const blockers = [];
  if (!lifecycle.enabled) blockers.push({ code: 'lifecycle-disabled', message: 'Approval lifecycle controls must be enabled before acceptance.' });
  if (disabledOpenApprovalIds.length) {
    blockers.push({
      code: 'capability-disabled-with-open-approvals',
      message: 'Open approval requirements exist for capabilities disabled by lifecycle controls.',
      approvalIds: disabledOpenApprovalIds,
      capabilityStates: lifecycle.capabilityControls.capabilityStates
        .filter((state) => state.blockedOpenApprovalIds.length > 0)
        .map((state) => ({
          capability: state.capability,
          disabledReason: state.disabledReason,
          blockedOpenApprovalIds: state.blockedOpenApprovalIds,
          nextLifecycleAction: state.nextLifecycleAction
        }))
    });
  }
  if (lifecycle.capabilityControls.scheduleCollisionCount > 0) {
    blockers.push({
      code: 'lifecycle-schedule-collision',
      message: 'Multiple scheduled reviews target the same tenant and capability.',
      scheduleCollisions: lifecycle.capabilityControls.scheduleCollisions
    });
  }
  if (lifecycle.recoveryState && !lifecycle.recoveryState.canResumeRecoveredLifecycle) {
    blockers.push({
      code: 'persisted-recovery-blocked',
      message: 'Persisted approval state failed recovery checks, so lifecycle writes are audit-only until a fresh checkpoint is stored.',
      reasons: lifecycle.recoveryState.recoveryFindingCodes
    });
  }
  if (criticalPending.length > settings.maxPendingCritical) {
    blockers.push({
      code: 'critical-pending-limit',
      message: 'Critical pending approvals exceed the configured acceptance limit.',
      approvalIds: criticalPending
    });
  }
  if (missingRequiredApprovers.length) {
    blockers.push({
      code: 'missing-required-approver',
      message: 'Accepted approval decisions require named approver proof for configured risks.',
      approvalIds: missingRequiredApprovers
    });
  }
  if (tenantBoundary && !tenantBoundary.permitted) {
    blockers.push({
      code: 'tenant-permission-boundary',
      message: 'The approval request crosses tenant or permission boundaries that require an explicit grant.',
      approvalIds: tenantBoundary.selectedOutOfScope.map((entry) => entry.approvalId),
      reasons: tenantBoundary.denialReasons
    });
  }

  return {
    schema: 'aios.capabilitySecurity.approvalRequirement.acceptance.v1',
    accepted: blockers.length === 0,
    blocked: blockers.length > 0,
    blockers,
    acknowledgements: {
      approvalEventsReviewed: counters.total,
      bypassesDisclosed: counters.bypasses,
      disabledCapabilities: lifecycle.disabledCapabilities.length,
      disabledOpenApprovals: lifecycle.capabilityControls.disabledOpenApprovalIds.length,
      scheduleCollisions: lifecycle.capabilityControls.scheduleCollisionCount
    }
  };
}

function buildReadiness(settingsValidation, counters, lifecycle, acceptance) {
  const warnings = settingsValidation.findings.filter((finding) => finding.severity === 'warning').length;
  const errors = settingsValidation.findings.filter((finding) => finding.severity === 'error').length + acceptance.blockers.length;
  const status = errors > 0 ? 'blocked' : warnings > 0 || counters.pendingRiskReviews > 0 ? 'needs-review' : 'ready';
  return {
    schema: 'aios.capabilitySecurity.approvalRequirement.readiness.v1',
    status,
    canServeRoutes: status !== 'blocked',
    canAutoAcceptLowRisk: lifecycle.enabled && status !== 'blocked',
    score: Math.max(0, 100 - (errors * 35) - (warnings * 10) - (counters.pendingRiskReviews * 5) - (counters.bypasses * 10)),
    reasons: [
      ...settingsValidation.findings.map((finding) => finding.code),
      ...acceptance.blockers.map((blocker) => blocker.code),
      ...(counters.pendingRiskReviews ? ['pending-risk-reviews'] : []),
      ...(counters.bypasses ? ['bypasses-present'] : [])
    ]
  };
}

function buildValidationSummary(settingsValidation, acceptance, preview) {
  const findings = [
    ...settingsValidation.findings.map((finding) => ({
      source: 'settings',
      code: finding.code,
      severity: finding.severity,
      message: finding.message
    })),
    ...acceptance.blockers.map((blocker) => ({
      source: 'acceptance',
      code: blocker.code,
      severity: 'error',
      message: blocker.message,
      approvalIds: blocker.approvalIds || []
    }))
  ];
  return {
    schema: 'aios.capabilitySecurity.approvalRequirement.validationSummary.v1',
    ok: findings.every((finding) => finding.severity !== 'error'),
    counts: {
      errors: findings.filter((finding) => finding.severity === 'error').length,
      warnings: findings.filter((finding) => finding.severity === 'warning').length,
      info: findings.filter((finding) => finding.severity === 'info').length,
      previewRows: preview.rows.length
    },
    findings
  };
}

function buildExplainableNextSteps(nextAction, acceptance, readiness, preview) {
  const steps = [];
  if (nextAction.type !== 'none') {
    steps.push({
      id: 'primary-next-action',
      action: nextAction.type,
      priority: nextAction.priority,
      reason: nextAction.reason || nextAction.approvalId || 'derived-from-approval-state',
      approvalId: nextAction.approvalId || null
    });
  }
  for (const blocker of acceptance.blockers) {
    steps.push({
      id: `resolve-${blocker.code}`,
      action: 'resolve-acceptance-blocker',
      priority: 'critical',
      reason: blocker.code,
      approvalIds: blocker.approvalIds || []
    });
  }
  if (readiness.status === 'ready' && preview.rows.length === 0) {
    steps.push({
      id: 'continue-monitoring',
      action: 'monitor-approval-requirements',
      priority: 'low',
      reason: 'no-open-approval-preview-rows'
    });
  }
  return {
    schema: 'aios.capabilitySecurity.approvalRequirement.nextSteps.v1',
    readyState: readiness.status,
    steps
  };
}

function buildClientPreviewAcceptanceContract(
  request,
  selection,
  preview,
  acceptance,
  readiness,
  validationSummary,
  decisionReceiptPlan,
  externalHandoffQueue,
  operationalHealth,
  now
) {
  const selectedApprovalIds = new Set(selection.selectedApprovalIds);
  const validationCodes = new Set(validationSummary.findings.map((finding) => finding.code));
  const routeActions = [
    {
      id: 'review-selection',
      label: 'Review',
      intent: 'review',
      enabled: operationalHealth.routeGates.canReview,
      disabledReason: operationalHealth.routeGates.canReview ? null : 'review-route-blocked'
    },
    {
      id: `${request.intent}-decision`,
      label: request.intent === 'deny' ? 'Deny selected' : 'Approve selected',
      intent: request.intent,
      enabled: decisionReceiptPlan.required && decisionReceiptPlan.submittable,
      disabledReason: decisionReceiptPlan.required && !decisionReceiptPlan.submittable
        ? decisionReceiptPlan.blockers[0] || 'decision-not-submittable'
        : null
    },
    {
      id: 'export-proof',
      label: 'Export proof',
      intent: 'export',
      enabled: request.intent === 'export' && operationalHealth.routeGates.canExport && validationSummary.ok,
      disabledReason: request.intent === 'export' && !operationalHealth.routeGates.canExport
        ? 'export-route-blocked'
        : null
    },
    {
      id: 'handoff-provider',
      label: 'Handoff',
      intent: 'handoff',
      enabled: externalHandoffQueue.required && externalHandoffQueue.dispatchable,
      disabledReason: externalHandoffQueue.required && !externalHandoffQueue.dispatchable
        ? externalHandoffQueue.blockers[0] || 'external-handoff-not-dispatchable'
        : null
    }
  ];
  const previewCards = preview.rows.map((row) => {
    const selected = selectedApprovalIds.has(row.approvalId);
    const blockedReason = row.blockedByLifecycle
      ? 'lifecycle-blocked'
      : selected && selection.missingApprovalIds.includes(row.approvalId)
        ? 'selection-missing-approval'
        : null;
    return {
      approvalId: row.approvalId,
      title: row.previewLabel,
      tenantId: row.tenantId,
      capability: row.capability,
      risk: row.risk,
      state: row.state,
      selected,
      selectable: !row.blockedByLifecycle && readiness.status !== 'blocked',
      requiresHumanAcceptance: row.requiresHumanAcceptance,
      blockedReason,
      userVisibleHint: blockedReason
        ? `This approval cannot be accepted because ${blockedReason}.`
        : row.operatorHint
    };
  });
  const acceptanceChecklist = [
    {
      id: 'operator-selection-reviewed',
      label: 'Selection reviewed',
      required: request.intent === 'approve' || request.intent === 'deny',
      complete: selection.selectedCount > 0 && selection.missingApprovalIds.length === 0,
      evidence: selection.selectedApprovalIds
    },
    {
      id: 'tenant-boundary-accepted',
      label: 'Tenant boundary accepted',
      required: true,
      complete: !validationCodes.has('tenant-permission-boundary'),
      evidence: validationSummary.findings
        .filter((finding) => finding.code === 'tenant-permission-boundary')
        .flatMap((finding) => finding.approvalIds || [])
    },
    {
      id: 'decision-receipts-ready',
      label: 'Decision receipts ready',
      required: decisionReceiptPlan.required,
      complete: !decisionReceiptPlan.required || decisionReceiptPlan.submittable,
      evidence: decisionReceiptPlan.receiptRows.map((row) => row.receiptId)
    },
    {
      id: 'provider-route-ready',
      label: 'Provider route ready',
      required: request.intent !== 'review' && request.intent !== 'monitor',
      complete: operationalHealth.status !== 'failed',
      evidence: operationalHealth.actionableErrors.map((error) => error.code)
    }
  ];
  const readinessChecks = [
    {
      id: 'validation-summary',
      status: validationSummary.ok ? 'pass' : 'fail',
      count: validationSummary.counts.errors,
      summary: validationSummary.ok ? 'No blocking validation findings.' : 'Blocking validation findings must be resolved.'
    },
    {
      id: 'acceptance',
      status: acceptance.accepted ? 'pass' : 'fail',
      count: acceptance.blockers.length,
      summary: acceptance.accepted ? 'Acceptance blockers cleared.' : 'Acceptance blockers are present.'
    },
    {
      id: 'operational-health',
      status: operationalHealth.status === 'failed' ? 'fail' : operationalHealth.status === 'degraded' ? 'warn' : 'pass',
      count: operationalHealth.actionableErrors.length,
      summary: operationalHealth.failureState.firstReason || operationalHealth.degradedReasons[0] || 'Provider routes healthy.'
    }
  ];

  return {
    schema: 'aios.capabilitySecurity.approvalRequirement.clientPreviewAcceptance.v1',
    generatedAt: now,
    requestId: request.id,
    route: request.route,
    intent: request.intent,
    selectedApprovalIds: selection.selectedApprovalIds,
    selectedCount: selection.selectedCount,
    readyForUserAcceptance: readiness.status !== 'blocked'
      && acceptance.accepted
      && acceptanceChecklist.every((item) => !item.required || item.complete),
    previewCards,
    acceptanceChecklist,
    readinessChecks,
    routeActions,
    validationDigest: {
      ok: validationSummary.ok,
      errorCount: validationSummary.counts.errors,
      warningCount: validationSummary.counts.warnings,
      firstBlockingCode: validationSummary.findings.find((finding) => finding.severity === 'error')?.code || null
    },
    nextClientRoute: routeActions.find((action) => action.enabled)?.id || 'resolve-blockers'
  };
}

function buildWorkflowHandoff(
  request,
  selection,
  nextAction,
  acceptance,
  readiness,
  lifecycle,
  preview,
  tenantBoundary,
  providerNegotiation,
  operationalHealth,
  decisionReceiptPlan,
  externalHandoffQueue,
  now
) {
  const selectedPreviewRows = preview.rows
    .filter((row) => selection.selectedApprovalIds.includes(row.approvalId));
  const blockedReason = acceptance.blockers[0]?.code
    || (!lifecycle.enabled ? 'lifecycle-disabled' : null)
    || (!tenantBoundary.permitted ? 'tenant-permission-boundary' : null)
    || (operationalHealth.failureState.active ? operationalHealth.failureState.firstReason : null)
    || (!providerNegotiation.negotiated ? providerNegotiation.blockedReasons[0] : null)
    || (decisionReceiptPlan.required && !decisionReceiptPlan.submittable ? decisionReceiptPlan.blockers[0] : null)
    || (externalHandoffQueue.required && !externalHandoffQueue.dispatchable ? externalHandoffQueue.blockers[0] : null)
    || (selection.missingApprovalIds.length ? 'selection-missing-approvals' : null);
  const canSubmitDecision = lifecycle.enabled
    && readiness.status !== 'blocked'
    && tenantBoundary.permitted
    && providerNegotiation.canSubmitDecision
    && operationalHealth.routeGates.canSubmitDecision
    && decisionReceiptPlan.submittable
    && selection.selectedCount > 0
    && selection.missingApprovalIds.length === 0
    && (request.intent === 'approve' || request.intent === 'deny');
  const canExport = request.intent === 'export'
    && readiness.status !== 'blocked'
    && tenantBoundary.permitted
    && providerNegotiation.canExport
    && operationalHealth.routeGates.canExport
    && selection.selectedCount > 0;
  const canHandoff = request.intent === 'handoff'
    && readiness.status !== 'blocked'
    && tenantBoundary.permitted
    && externalHandoffQueue.dispatchable
    && selection.selectedCount > 0;
  const routeState = blockedReason
    ? 'blocked'
    : canSubmitDecision || canExport
      ? 'ready-for-submit'
      : canHandoff
        ? 'ready-for-handoff'
        : 'review';

  return {
    schema: 'aios.capabilitySecurity.approvalRequirement.workflowHandoff.v1',
    generatedAt: now,
    requestId: request.id,
    route: request.route,
    routeState,
    actor: request.actor,
    tenantId: request.tenantId,
    intent: request.intent,
    canSubmitDecision,
    canExport,
    canHandoff,
    blockedReason,
    primaryAction: canSubmitDecision
      ? `${request.intent}-selected-approvals`
      : canExport
        ? 'export-selected-approval-proof'
        : canHandoff
          ? 'handoff-selected-approvals'
          : nextAction.type,
    receiptRequired: request.requiresReceipt,
    returnTo: request.returnTo,
    handoffPayload: {
      selectedApprovalIds: selection.selectedApprovalIds,
      selectedPreviewRows,
      highestSelectedRisk: selection.highestSelectedRisk,
      containsBypass: selection.containsBypass,
      containsUnresolvedCritical: selection.containsUnresolvedCritical,
      tenantBoundary: {
        permitted: tenantBoundary.permitted,
        allowedTenantIds: tenantBoundary.allowedTenantIds,
        selectedOutOfScope: tenantBoundary.selectedOutOfScope,
        denialReasons: tenantBoundary.denialReasons
      },
      provider: {
        providerId: providerNegotiation.providerId,
        negotiated: providerNegotiation.negotiated,
        missingCapabilities: providerNegotiation.missingCapabilities,
        syncMetadata: providerNegotiation.syncMetadata,
        externalHandoffState: providerNegotiation.externalHandoffState,
        serviceRoutes: providerNegotiation.serviceRoutes,
        handoffEnvelope: providerNegotiation.handoffEnvelope
      },
      operationalHealth: {
        status: operationalHealth.status,
        degradedMode: operationalHealth.degradedMode,
        failureState: operationalHealth.failureState,
        retryBackoff: operationalHealth.retryBackoff,
        actionableErrors: operationalHealth.actionableErrors,
        routeGates: operationalHealth.routeGates
      },
      decisionReceiptPlan: {
        schema: decisionReceiptPlan.schema,
        required: decisionReceiptPlan.required,
        submittable: decisionReceiptPlan.submittable,
        expectedReceiptCount: decisionReceiptPlan.expectedReceiptCount,
        receivedDraftCount: decisionReceiptPlan.receivedDraftCount,
        validDraftCount: decisionReceiptPlan.validDraftCount,
        blockers: decisionReceiptPlan.blockers,
        providerSubmission: decisionReceiptPlan.providerSubmission,
        receiptRows: decisionReceiptPlan.receiptRows
      },
      externalHandoffQueue: {
        schema: externalHandoffQueue.schema,
        required: externalHandoffQueue.required,
        dispatchable: externalHandoffQueue.dispatchable,
        pendingDispatch: externalHandoffQueue.pendingDispatch,
        correlationId: externalHandoffQueue.correlationId,
        target: externalHandoffQueue.target,
        endpointUrl: externalHandoffQueue.endpointUrl,
        returnRoute: externalHandoffQueue.returnRoute,
        stateCounts: externalHandoffQueue.stateCounts,
        blockers: externalHandoffQueue.blockers,
        nextDispatch: externalHandoffQueue.nextDispatch,
        exhaustedRecordIds: externalHandoffQueue.exhaustedRecordIds
      }
    },
    userVisibleMessage: blockedReason
      ? `Approval workflow is blocked by ${blockedReason}.`
      : `Approval workflow is ${routeState} for ${selection.selectedCount} selected approval events.`
  };
}

function buildClientRuntimeTransition(
  clientRuntimeState,
  request,
  selection,
  restartSafety,
  workflowHandoff,
  clientPreviewAcceptance,
  decisionReceiptPlan,
  externalHandoffQueue,
  persistenceCheckpoint,
  now
) {
  const acknowledged = new Set(clientRuntimeState.acknowledgedBlockingCodes);
  const activeBlockingCodes = [
    workflowHandoff.blockedReason,
    ...decisionReceiptPlan.blockers,
    ...externalHandoffQueue.blockers,
    ...(restartSafety.routeRefreshRequired ? [restartSafety.reason] : [])
  ].filter(Boolean);
  const newlyVisibleBlockingCodes = activeBlockingCodes
    .filter((code, index, codes) => codes.indexOf(code) === index && !acknowledged.has(code))
    .sort();
  const staleSelectedIds = selection.missingApprovalIds
    .filter((approvalId, index, approvalIds) => approvalIds.indexOf(approvalId) === index)
    .sort();
  const retainedSelectionIds = selection.selectedApprovalIds
    .filter((approvalId) => !staleSelectedIds.includes(approvalId));
  const shouldClearSelection = restartSafety.routeRefreshRequired || workflowHandoff.blockedReason === 'selection-missing-approvals';
  const nextRoute = workflowHandoff.canSubmitDecision
    ? 'submit-decision-receipts'
    : workflowHandoff.canExport
      ? 'stream-approval-proof-export'
      : workflowHandoff.canHandoff
        ? 'dispatch-external-handoff'
        : clientPreviewAcceptance.nextClientRoute;
  const pendingClientEffects = [
    ...(shouldClearSelection ? ['clear-stale-selection'] : []),
    ...(decisionReceiptPlan.submittable ? ['persist-decision-draft-receipts'] : []),
    ...(externalHandoffQueue.pendingDispatch ? ['enqueue-provider-handoff-dispatch'] : []),
    ...(newlyVisibleBlockingCodes.length ? ['surface-unacknowledged-blockers'] : []),
    ...(persistenceCheckpoint.checkpointId !== clientRuntimeState.lastSeenCheckpointId ? ['store-latest-checkpoint-id'] : [])
  ];

  return {
    schema: 'aios.capabilitySecurity.approvalRequirement.clientRuntimeTransition.v1',
    generatedAt: now,
    sessionId: clientRuntimeState.sessionId,
    requestId: request.id,
    from: {
      route: clientRuntimeState.route,
      step: clientRuntimeState.currentStep,
      selectedApprovalIds: clientRuntimeState.draftSelectionIds,
      pendingReceiptIds: clientRuntimeState.pendingReceiptIds,
      lastSeenCheckpointId: clientRuntimeState.lastSeenCheckpointId,
      lastProviderCorrelationId: clientRuntimeState.lastProviderCorrelationId
    },
    to: {
      route: request.route,
      routeState: workflowHandoff.routeState,
      step: nextRoute,
      selectedApprovalIds: shouldClearSelection ? retainedSelectionIds : selection.selectedApprovalIds,
      checkpointId: persistenceCheckpoint.checkpointId,
      providerCorrelationId: externalHandoffQueue.correlationId || workflowHandoff.handoffPayload.provider.externalHandoffState.correlationId,
      returnRoute: externalHandoffQueue.returnRoute || workflowHandoff.returnTo || clientRuntimeState.handoffReturnRoute
    },
    selectionState: {
      selectedCount: selection.selectedCount,
      retainedSelectionIds,
      staleSelectedIds,
      missingApprovalIds: selection.missingApprovalIds,
      clearSelectionRequired: shouldClearSelection
    },
    blockerState: {
      activeBlockingCodes: [...new Set(activeBlockingCodes)].sort(),
      acknowledgedBlockingCodes: clientRuntimeState.acknowledgedBlockingCodes,
      newlyVisibleBlockingCodes,
      requiresUserAcknowledgement: newlyVisibleBlockingCodes.length > 0
    },
    workflowEffects: {
      pendingClientEffects,
      canResumeWithoutRefresh: restartSafety.canReuseClientSelection && !shouldClearSelection,
      shouldPersistCheckpoint: pendingClientEffects.includes('store-latest-checkpoint-id'),
      shouldPersistReceiptDrafts: pendingClientEffects.includes('persist-decision-draft-receipts'),
      shouldDispatchHandoff: pendingClientEffects.includes('enqueue-provider-handoff-dispatch'),
      dirtyAfterTransition: pendingClientEffects.length > 0
    },
    userVisibleHandoff: {
      message: workflowHandoff.userVisibleMessage,
      primaryAction: workflowHandoff.primaryAction,
      nextRoute,
      receiptRequired: workflowHandoff.receiptRequired,
      returnTo: workflowHandoff.returnTo,
      providerTarget: externalHandoffQueue.target,
      providerCorrelationId: externalHandoffQueue.correlationId
    }
  };
}

export function describeApprovalRequirementSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const persistedState = normalizePersistedApprovalState(input.persistedState || input.stateSnapshot || {}, now);
  const rawClientRuntimeState = input.clientState || input.clientRuntimeState || input.runtimeState || {};
  const clientRequest = normalizeClientRequest(input.request || input.clientRequest || {}, now, rawClientRuntimeState);
  const clientRuntimeState = normalizeClientRuntimeState(rawClientRuntimeState, clientRequest, now);
  const providerContract = normalizeProviderContract(input.providerContract || input.provider || input.serviceContract || {}, now);
  const settings = normalizeApprovalSettings(input.settings || input.policy || {});
  const settingsValidation = validateApprovalSettings(settings);
  const lifecycleCommands = asArray(input.lifecycleCommands || input.commands)
    .map((command, index) => normalizeLifecycleCommand(command, index, now));
  const approvalEvents = asArray(input.approvals || input.approvalEvents)
    .map((event, index) => normalizeApprovalEvent(event, index, now));
  const counters = buildApprovalCounters(approvalEvents);
  const history = buildHistorySnapshots(approvalEvents, now);
  const timeline = buildTimeline(approvalEvents);
  const exportSummary = buildExportSummary(approvalEvents, counters, now);
  const lifecycle = buildLifecycleControls(settings, lifecycleCommands, now, persistedState, approvalEvents);
  const analyticsReport = buildApprovalAnalyticsReport(
    approvalEvents,
    counters,
    timeline,
    exportSummary,
    settings,
    lifecycle,
    now
  );
  const nextAction = buildNextAction(approvalEvents, counters, settings, settingsValidation, lifecycle, now);
  const preview = buildApprovalPreview(approvalEvents, lifecycle, now);
  const requestSelection = buildRequestSelection(approvalEvents, clientRequest);
  const tenantBoundary = buildTenantPermissionBoundary(approvalEvents, clientRequest, requestSelection, settings, now);
  const acceptance = buildAcceptanceSummary(approvalEvents, counters, settings, lifecycle, tenantBoundary);
  const readiness = buildReadiness(settingsValidation, counters, lifecycle, acceptance);
  const providerNegotiation = buildProviderNegotiation(
    providerContract,
    clientRequest,
    requestSelection,
    tenantBoundary,
    readiness,
    lifecycle,
    persistedState,
    exportSummary,
    now
  );
  const operationalHealth = buildOperationalHealth(
    providerContract,
    providerNegotiation,
    readiness,
    lifecycle,
    clientRequest,
    input.operationalHealth || input.health || input.healthChecks || {},
    now
  );
  const decisionReceiptPlan = buildDecisionReceiptPlan(
    approvalEvents,
    clientRequest,
    requestSelection,
    tenantBoundary,
    providerNegotiation,
    operationalHealth,
    input.decisions || input.decisionDrafts || input.receipts || [],
    now
  );
  const externalHandoffQueue = buildExternalHandoffQueue(
    clientRequest,
    requestSelection,
    providerNegotiation,
    operationalHealth,
    input.externalHandoff || input.handoffState || input.handoffQueue || {},
    now
  );
  const validationSummary = buildValidationSummary(settingsValidation, acceptance, preview);
  const explainableNextSteps = buildExplainableNextSteps(nextAction, acceptance, readiness, preview);
  const clientPreviewAcceptance = buildClientPreviewAcceptanceContract(
    clientRequest,
    requestSelection,
    preview,
    acceptance,
    readiness,
    validationSummary,
    decisionReceiptPlan,
    externalHandoffQueue,
    operationalHealth,
    now
  );
  const workflowHandoff = buildWorkflowHandoff(
    clientRequest,
    requestSelection,
    nextAction,
    acceptance,
    readiness,
    lifecycle,
    preview,
    tenantBoundary,
    providerNegotiation,
    operationalHealth,
    decisionReceiptPlan,
    externalHandoffQueue,
    now
  );
  const restartSafety = buildRestartSafety(persistedState, lifecycle, readiness, requestSelection, now);
  const persistenceCheckpoint = buildPersistenceCheckpoint(settings, lifecycle, readiness, now);
  const clientRuntimeTransition = buildClientRuntimeTransition(
    clientRuntimeState,
    clientRequest,
    requestSelection,
    restartSafety,
    workflowHandoff,
    clientPreviewAcceptance,
    decisionReceiptPlan,
    externalHandoffQueue,
    persistenceCheckpoint,
    now
  );

  return {
    ok: validationSummary.ok,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'aios.capabilitySecurity.approvalRequirement.v1',
    state: {
      settings,
      settingsValidation,
      lifecycle,
      nextAction,
      persistedState,
      preview,
      acceptance,
      readiness,
      restartSafety,
      validationSummary,
      explainableNextSteps,
      clientPreviewAcceptance,
      clientRequest,
      clientRuntimeState,
      clientRuntimeTransition,
      requestSelection,
      tenantBoundary,
      providerContract,
      providerNegotiation,
      operationalHealth,
      decisionReceiptPlan,
      externalHandoffQueue,
      workflowHandoff,
      approvalEvents,
      counters,
      history,
      timeline,
      exportSummary,
      analyticsReport,
      persistenceCheckpoint,
      reporting: {
        pendingRiskReviews: counters.pendingRiskReviews,
        approvalsMissingActor: counters.approvalsMissingActor,
        needsSecurityAttention: counters.pendingRiskReviews > 0 || counters.bypasses > 0,
        readinessStatus: readiness.status,
        acceptanceBlocked: acceptance.blocked,
        previewRowCount: preview.rows.length,
        clientPreviewReadyForAcceptance: clientPreviewAcceptance.readyForUserAcceptance,
        clientPreviewSelectedCount: clientPreviewAcceptance.selectedCount,
        clientPreviewNextRoute: clientPreviewAcceptance.nextClientRoute,
        clientPreviewBlockingCode: clientPreviewAcceptance.validationDigest.firstBlockingCode,
        clientPreviewEnabledActionCount: clientPreviewAcceptance.routeActions.filter((action) => action.enabled).length,
        clientRuntimeSessionId: clientRuntimeState.sessionId,
        clientRuntimeDirty: clientRuntimeState.dirty,
        clientRuntimeNextRoute: clientRuntimeTransition.to.step,
        clientRuntimePendingEffects: clientRuntimeTransition.workflowEffects.pendingClientEffects,
        clientRuntimeRequiresAcknowledgement: clientRuntimeTransition.blockerState.requiresUserAcknowledgement,
        clientRuntimeStaleSelectionCount: clientRuntimeTransition.selectionState.staleSelectedIds.length,
        workflowRouteState: workflowHandoff.routeState,
        workflowCanSubmitDecision: workflowHandoff.canSubmitDecision,
        workflowBlockedReason: workflowHandoff.blockedReason,
        providerId: providerNegotiation.providerId,
        providerNegotiated: providerNegotiation.negotiated,
        providerMissingCapabilities: providerNegotiation.missingCapabilities,
        providerSyncMode: providerNegotiation.syncMetadata.mode,
        providerSyncStale: providerNegotiation.syncMetadata.stale,
        providerExternalHandoffReady: providerNegotiation.externalHandoffState.ready,
        externalHandoffRequired: externalHandoffQueue.required,
        externalHandoffDispatchable: externalHandoffQueue.dispatchable,
        externalHandoffPendingDispatch: externalHandoffQueue.pendingDispatch,
        externalHandoffBlockers: externalHandoffQueue.blockers,
        externalHandoffQueuedCount: externalHandoffQueue.stateCounts.queued || 0,
        externalHandoffFailedCount: externalHandoffQueue.stateCounts.failed || 0,
        externalHandoffAcknowledgedCount: externalHandoffQueue.stateCounts.acknowledged || 0,
        providerDecisionEndpointReady: providerNegotiation.serviceRoutes.decisionEndpointReady,
        providerExportEndpointReady: providerNegotiation.serviceRoutes.exportEndpointReady,
        operationalHealthStatus: operationalHealth.status,
        operationalDegradedMode: operationalHealth.degradedMode,
        operationalFailureActive: operationalHealth.failureState.active,
        operationalFailureReasons: operationalHealth.failureState.reasons,
        operationalRetryable: operationalHealth.retryBackoff.retryable,
        operationalRetryAfterMs: operationalHealth.retryBackoff.retryAfterMs,
        operationalActionableErrorCodes: operationalHealth.actionableErrors.map((error) => error.code),
        operationalCanSubmitDecision: operationalHealth.routeGates.canSubmitDecision,
        operationalCanExport: operationalHealth.routeGates.canExport,
        decisionReceiptRequired: decisionReceiptPlan.required,
        decisionReceiptSubmittable: decisionReceiptPlan.submittable,
        decisionReceiptBlockers: decisionReceiptPlan.blockers,
        decisionReceiptExpectedCount: decisionReceiptPlan.expectedReceiptCount,
        decisionReceiptValidDraftCount: decisionReceiptPlan.validDraftCount,
        tenantBoundaryPermitted: tenantBoundary.permitted,
        tenantBoundaryDenialReasons: tenantBoundary.denialReasons,
        selectedOutOfScopeApprovalCount: tenantBoundary.selectedOutOfScope.length,
        restartSafetyStatus: restartSafety.status,
        restartRouteRefreshRequired: restartSafety.routeRefreshRequired,
        restartCommandWriteMode: restartSafety.commandWriteMode,
        restartBlockedCommandCount: restartSafety.blockedCommandKeys.length,
        persistedRecoveryStatus: persistedState.recovery.status,
        persistedRecoveryFindingCodes: persistedState.recovery.findings.map((finding) => finding.code),
        persistedRecoveryCanResumeLifecycle: persistedState.recovery.canResumeLifecycle,
        persistedRecoveryDuplicateCommandCount: persistedState.recovery.duplicateCommandKeys.length,
        lifecycleRecoveredFromCheckpoint: lifecycle.recoveredFromCheckpoint,
        lifecycleRecoveryCommandWriteMode: lifecycle.recoveryState.commandWriteMode,
        lifecycleRecoveryFindingCodes: lifecycle.recoveryState.recoveryFindingCodes,
        idempotentReplayCount: lifecycle.idempotentReplayCount,
        idempotentReplayedRejectedCommandCount: lifecycle.commandOutcomes.replayedRejectedCommandIds.length,
        lifecycleSkippedCommandCount: lifecycle.commandOutcomes.skippedCommandKeys.length,
        lifecycleCommandStatusCounts: lifecycle.commandOutcomes.statusCounts,
        lifecycleRejectedCommandCount: lifecycle.commandValidation.rejectedCount,
        lifecycleRejectedCommandReasons: lifecycle.commandValidation.reasonCodes,
        lifecycleCommandWarningCount: lifecycle.commandValidation.warnings.length,
        lifecyclePendingScheduleCount: lifecycle.scheduleState.pendingCount,
        lifecycleOverdueScheduleCount: lifecycle.scheduleState.overdueCount,
        lifecycleScheduleCollisionCount: lifecycle.scheduleState.collisionCount,
        lifecycleNextReviewAt: lifecycle.scheduleState.nextReviewAt,
        lifecycleDisabledOpenApprovalCount: lifecycle.capabilityControls.disabledOpenApprovalIds.length,
        lifecycleDisabledOpenCapabilityCount: lifecycle.capabilityControls.disabledOpenCapabilityCount,
        lifecycleCapabilityStates: lifecycle.capabilityControls.capabilityStates.map((state) => ({
          capability: state.capability,
          state: state.state,
          openApprovalCount: state.openApprovalCount,
          nextLifecycleAction: state.nextLifecycleAction
        })),
        latestTimelineAt: timeline.length ? timeline[timeline.length - 1].at : now,
        analyticsOpenRequirementCount: analyticsReport.healthCounters.openRequirements,
        analyticsHighOrCriticalOpenCount: analyticsReport.healthCounters.highOrCriticalOpen,
        analyticsOpenOver72hCount: analyticsReport.openAgeBuckets.over72h,
        analyticsExportReady: analyticsReport.exportManifest.readyForExport,
        analyticsExportRows: analyticsReport.exportManifest.rows,
        analyticsResolutionP95Hours: analyticsReport.resolutionSla.p95ResolutionHours,
        analyticsReviewCadenceBreaches: analyticsReport.resolutionSla.breachingReviewCadenceCount,
        analyticsTimelineMarkerCount: analyticsReport.timelineMarkers.length
      }
    },
    clientContract: {
      schema: 'aios.capabilitySecurity.approvalRequirement.client.v1',
      routeMount: '/capability-security/approval-requirement',
      previewSchema: preview.schema,
      acceptanceSchema: acceptance.schema,
      readinessSchema: readiness.schema,
      validationSummarySchema: validationSummary.schema,
      nextStepsSchema: explainableNextSteps.schema,
      clientPreviewAcceptanceSchema: clientPreviewAcceptance.schema,
      requestSchema: clientRequest.schema,
      clientRuntimeStateSchema: clientRuntimeState.schema,
      clientRuntimeTransitionSchema: clientRuntimeTransition.schema,
      selectionSchema: requestSelection.schema,
      tenantBoundarySchema: tenantBoundary.schema,
      workflowHandoffSchema: workflowHandoff.schema,
      providerContractSchema: providerContract.schema,
      providerNegotiationSchema: providerNegotiation.schema,
      externalHandoffQueueSchema: externalHandoffQueue.schema,
      operationalHealthSchema: operationalHealth.schema,
      retryBackoffSchema: operationalHealth.retryBackoff.schema,
      decisionReceiptPlanSchema: decisionReceiptPlan.schema,
      restartSafetySchema: restartSafety.schema,
      persistenceCheckpointSchema: persistenceCheckpoint.schema,
      persistedRecoverySchema: persistedState.recovery.schema,
      lifecycleRecoveryStateSchema: lifecycle.recoveryState.schema,
      lifecycleCommandOutcomesSchema: lifecycle.commandOutcomes.schema,
      analyticsReportSchema: analyticsReport.schema,
      lifecycleCommandValidationSchema: 'aios.capabilitySecurity.approvalRequirement.lifecycleCommandValidation.v1',
      scheduleStateSchema: 'aios.capabilitySecurity.approvalRequirement.scheduleState.v1',
      workflowRouteState: workflowHandoff.routeState,
      clientPreviewAcceptance,
      clientRuntimeState,
      clientRuntimeTransition,
      providerId: providerNegotiation.providerId,
      providerNegotiated: providerNegotiation.negotiated,
      providerMissingCapabilities: providerNegotiation.missingCapabilities,
      providerBlockedReasons: providerNegotiation.blockedReasons,
      providerSyncMetadata: providerNegotiation.syncMetadata,
      providerExternalHandoffState: providerNegotiation.externalHandoffState,
      externalHandoffQueue: {
        required: externalHandoffQueue.required,
        dispatchable: externalHandoffQueue.dispatchable,
        pendingDispatch: externalHandoffQueue.pendingDispatch,
        correlationId: externalHandoffQueue.correlationId,
        target: externalHandoffQueue.target,
        stateCounts: externalHandoffQueue.stateCounts,
        blockers: externalHandoffQueue.blockers,
        nextDispatch: externalHandoffQueue.nextDispatch,
        exhaustedRecordIds: externalHandoffQueue.exhaustedRecordIds
      },
      providerServiceRoutes: providerNegotiation.serviceRoutes,
      operationalHealthStatus: operationalHealth.status,
      operationalDegradedMode: operationalHealth.degradedMode,
      operationalFailureState: operationalHealth.failureState,
      operationalValidation: operationalHealth.validation,
      operationalRetryBackoff: operationalHealth.retryBackoff,
      operationalActionableErrors: operationalHealth.actionableErrors,
      operationalRouteGates: operationalHealth.routeGates,
      decisionReceiptRequired: decisionReceiptPlan.required,
      decisionReceiptSubmittable: decisionReceiptPlan.submittable,
      decisionReceiptBlockers: decisionReceiptPlan.blockers,
      decisionDraftValidation: decisionReceiptPlan.draftValidation,
      decisionProviderSubmission: decisionReceiptPlan.providerSubmission,
      decisionReceiptRows: decisionReceiptPlan.receiptRows,
      tenantBoundaryPermitted: tenantBoundary.permitted,
      allowedTenantIds: tenantBoundary.allowedTenantIds,
      boundaryDeniedApprovalIds: tenantBoundary.selectedOutOfScope.map((entry) => entry.approvalId),
      restartSafetyStatus: restartSafety.status,
      routeRefreshRequired: restartSafety.routeRefreshRequired,
      restartCommandWriteMode: restartSafety.commandWriteMode,
      restartRecoveryFindings: restartSafety.recoveryFindings,
      lifecycleRecoveryState: lifecycle.recoveryState,
      lifecycleCommandOutcomes: lifecycle.commandOutcomes,
      persistedRecoveryStatus: persistedState.recovery.status,
      persistedRecoveryFindings: persistedState.recovery.findings,
      rejectedLifecycleCommands: lifecycle.commandValidation.rejectedCommandIds,
      rejectedLifecycleReasons: lifecycle.commandValidation.reasonCodes,
      lifecycleCommandWarnings: lifecycle.commandValidation.warnings,
      lifecycleCapabilityControlsSchema: lifecycle.capabilityControls.schema,
      lifecycleCapabilityControls: lifecycle.capabilityControls,
      pendingScheduledReviews: lifecycle.scheduleState.pendingCount,
      overdueScheduledReviews: lifecycle.scheduleState.overdueCount,
      scheduleCollisionCount: lifecycle.scheduleState.collisionCount,
      nextScheduledReviewAt: lifecycle.scheduleState.nextReviewAt,
      exportReady: analyticsReport.exportManifest.readyForExport,
      exportRows: analyticsReport.exportManifest.rows,
      openAgeBuckets: analyticsReport.openAgeBuckets,
      riskReviewQueueCount: analyticsReport.riskReviewQueue.length,
      userVisibleMessage: workflowHandoff.userVisibleMessage,
      recommendedRefreshReason: workflowHandoff.blockedReason
        || (restartSafety.routeRefreshRequired ? restartSafety.reason : null)
        || explainableNextSteps.steps[0]?.reason
        || 'approval-requirement-controls-current'
    },
    audit: {
      proofType: 'approval-requirement-lifecycle-settings-analytics-history-export-preview-acceptance-readiness-client-workflow-persistence-restart-recovery-command-outcomes-tenant-boundary-provider-negotiation-operational-health-decision-receipts-external-handoff-queue',
      eventCount: counters.total,
      lifecycleCommandCount: lifecycle.commandReceipts.length,
      acceptedLifecycleCommandCount: lifecycle.commandReceipts.filter((receipt) => receipt.accepted).length,
      rejectedLifecycleCommandCount: lifecycle.commandValidation.rejectedCount,
      rejectedLifecycleCommandReasons: lifecycle.commandValidation.reasonCodes,
      lifecycleCommandWarningCount: lifecycle.commandValidation.warnings.length,
      lifecycleCommandOutcomes: lifecycle.commandOutcomes,
      lifecycleRecoveryState: lifecycle.recoveryState,
      lifecycleScheduleState: lifecycle.scheduleState,
      lifecycleCapabilityControls: lifecycle.capabilityControls,
      idempotentLifecycleCommandCount: lifecycle.idempotentReplayCount,
      nextActionType: nextAction.type,
      readinessStatus: readiness.status,
      restartSafetyStatus: restartSafety.status,
      recoveredFromCheckpoint: persistedState.recovered,
      persistedRecoveryStatus: persistedState.recovery.status,
      persistedRecoveryFindings: persistedState.recovery.findings,
      persistenceCheckpointId: persistenceCheckpoint.checkpointId,
      persistenceRecoveryJournalEntry: persistenceCheckpoint.recoveryJournalEntry,
      acceptanceAccepted: acceptance.accepted,
      previewRowCount: preview.rows.length,
      validationErrorCount: validationSummary.counts.errors,
      clientPreviewAcceptanceSchema: clientPreviewAcceptance.schema,
      clientPreviewReadyForAcceptance: clientPreviewAcceptance.readyForUserAcceptance,
      clientPreviewNextRoute: clientPreviewAcceptance.nextClientRoute,
      clientPreviewReadinessChecks: clientPreviewAcceptance.readinessChecks,
      clientPreviewAcceptanceChecklist: clientPreviewAcceptance.acceptanceChecklist,
      clientRuntimeStateSchema: clientRuntimeState.schema,
      clientRuntimeTransitionSchema: clientRuntimeTransition.schema,
      clientRuntimeSessionId: clientRuntimeState.sessionId,
      clientRuntimeObservedAt: clientRuntimeState.observedAt,
      clientRuntimePendingEffects: clientRuntimeTransition.workflowEffects.pendingClientEffects,
      clientRuntimeNextRoute: clientRuntimeTransition.to.step,
      clientRuntimeRequiresAcknowledgement: clientRuntimeTransition.blockerState.requiresUserAcknowledgement,
      clientRuntimeNewBlockingCodes: clientRuntimeTransition.blockerState.newlyVisibleBlockingCodes,
      clientRuntimeClearsSelection: clientRuntimeTransition.selectionState.clearSelectionRequired,
      requestIntent: clientRequest.intent,
      selectedApprovalCount: requestSelection.selectedCount,
      tenantBoundaryPermitted: tenantBoundary.permitted,
      tenantBoundaryDenialReasons: tenantBoundary.denialReasons,
      tenantBoundaryAuditHandoff: tenantBoundary.auditHandoff,
      providerId: providerNegotiation.providerId,
      providerContractVersion: providerNegotiation.contractVersion,
      providerNegotiated: providerNegotiation.negotiated,
      providerBlockedReasons: providerNegotiation.blockedReasons,
      providerMissingCapabilities: providerNegotiation.missingCapabilities,
      providerSyncMetadata: providerNegotiation.syncMetadata,
      providerExternalHandoffState: providerNegotiation.externalHandoffState,
      providerHandoffEnvelope: providerNegotiation.handoffEnvelope,
      externalHandoffQueue: {
        required: externalHandoffQueue.required,
        dispatchable: externalHandoffQueue.dispatchable,
        pendingDispatch: externalHandoffQueue.pendingDispatch,
        correlationId: externalHandoffQueue.correlationId,
        target: externalHandoffQueue.target,
        stateCounts: externalHandoffQueue.stateCounts,
        blockers: externalHandoffQueue.blockers,
        nextDispatch: externalHandoffQueue.nextDispatch,
        exhaustedRecordIds: externalHandoffQueue.exhaustedRecordIds
      },
      operationalHealthStatus: operationalHealth.status,
      operationalDegradedMode: operationalHealth.degradedMode,
      operationalFailureState: operationalHealth.failureState,
      operationalValidation: operationalHealth.validation,
      operationalRetryBackoff: operationalHealth.retryBackoff,
      operationalActionableErrorCodes: operationalHealth.actionableErrors.map((error) => error.code),
      operationalRouteGates: operationalHealth.routeGates,
      decisionReceiptRequired: decisionReceiptPlan.required,
      decisionReceiptSubmittable: decisionReceiptPlan.submittable,
      decisionReceiptBlockers: decisionReceiptPlan.blockers,
      decisionReceiptExpectedCount: decisionReceiptPlan.expectedReceiptCount,
      decisionReceiptReceivedDraftCount: decisionReceiptPlan.receivedDraftCount,
      decisionReceiptValidDraftCount: decisionReceiptPlan.validDraftCount,
      decisionProviderSubmission: decisionReceiptPlan.providerSubmission,
      workflowRouteState: workflowHandoff.routeState,
      workflowCanSubmitDecision: workflowHandoff.canSubmitDecision,
      exportSchema: exportSummary.schema,
      analyticsReportSchema: analyticsReport.schema,
      analyticsExportRows: analyticsReport.exportManifest.rows,
      analyticsOpenOver72hCount: analyticsReport.openAgeBuckets.over72h,
      analyticsRiskQueueCount: analyticsReport.riskReviewQueue.length,
      analyticsP95ResolutionHours: analyticsReport.resolutionSla.p95ResolutionHours,
      evidenceCount: asArray(input.evidence).length
    },
    evidence: asArray(input.evidence)
  };
}

export default describeApprovalRequirementSurface;
