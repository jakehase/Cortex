export const surfaceId = "aios_audit-recovery_notifier-record_080";
export const surfaceGroup = "audit-recovery";
export const surfaceName = "notifier-record";

const REQUIRED_ACKNOWLEDGEMENTS = [
  'operator-confirmed-recipient',
  'operator-reviewed-preview',
  'operator-accepts-audit-record'
];

const CLIENT_STATE_KEYS = [
  'draft',
  'validation',
  'preview',
  'acceptance',
  'handoff'
];

const TERMINAL_PERSISTED_STATUSES = [
  'dispatch-ready',
  'dispatch-recorded',
  'proof-persisted'
];

const RESTART_SAFE_STATUSES = [
  'not-persisted',
  'draft-restored',
  'awaiting-acceptance',
  'dispatch-ready',
  'dispatch-scheduled',
  'dispatch-paused',
  'dispatch-disabled',
  'dispatch-blocked',
  'provider-contract-blocked',
  'boundary-blocked',
  'permission-blocked',
  'degraded-dispatch-ready',
  'dispatch-recorded',
  'proof-persisted'
];

const DISPATCH_ROLES = [
  'audit-recovery-admin',
  'audit-recovery-dispatcher',
  'tenant-audit-operator'
];

const DISPATCH_PERMISSIONS = [
  'audit-recovery:notifier-record:dispatch',
  'audit-recovery:notifier-record:write',
  'kernel:notifier-record:dispatch'
];

const RETRYABLE_FAILURE_CODES = [
  'dispatcher_timeout',
  'dispatcher_unavailable',
  'proof_store_unavailable',
  'rate_limited',
  'transport_error'
];

const TERMINAL_FAILURE_CODES = [
  'recipient_rejected',
  'proof_integrity_failed',
  'tenant_boundary_rejected',
  'workspace_boundary_rejected',
  'unauthorized_dispatch'
];

const DEFAULT_RETRY_BACKOFF_MS = [5000, 15000, 45000, 120000];
const OPERATIONAL_HEALTH_STATUSES = ['available', 'degraded', 'unavailable', 'disabled'];
const FAILURE_STATES = ['none', 'retryable', 'retry-delayed', 'retry-exhausted', 'terminal', 'unknown'];
const LIFECYCLE_MODES = ['enabled', 'paused', 'disabled'];
const SCHEDULING_MODES = ['immediate', 'scheduled', 'manual'];
const HANDOFF_INTENTS = ['continue-review', 'resume-dispatch', 'open-proof', 'escalate-health', 'hold-lifecycle'];
const LIFECYCLE_COMMANDS = ['enable', 'disable', 'pause', 'resume', 'schedule', 'reschedule', 'cancel-schedule', 'set-manual'];
const LIFECYCLE_COMMAND_ALIASES = {
  enable: 'enable',
  enabled: 'enable',
  'turn-on': 'enable',
  disable: 'disable',
  disabled: 'disable',
  'turn-off': 'disable',
  pause: 'pause',
  paused: 'pause',
  hold: 'pause',
  resume: 'resume',
  unpause: 'resume',
  schedule: 'schedule',
  scheduled: 'schedule',
  reschedule: 'reschedule',
  'update-schedule': 'reschedule',
  'cancel-schedule': 'cancel-schedule',
  unschedule: 'cancel-schedule',
  'set-manual': 'set-manual',
  manual: 'set-manual'
};
const MAX_SCHEDULE_DELAY_MS = 7 * 24 * 60 * 60 * 1000;
const PROVIDER_SERVICE_ROLES = ['state-store', 'notification-dispatcher', 'proof-store', 'external-handoff'];
const PROVIDER_REQUIRED_CAPABILITIES = {
  'state-store': ['persist-draft', 'restore-draft', 'idempotent-write'],
  'notification-dispatcher': ['dispatch-notification', 'idempotency-key', 'recipient-manifest'],
  'proof-store': ['persist-proof', 'integrity-envelope', 'audit-partition'],
  'external-handoff': ['resume-token', 'handoff-state']
};
const PROVIDER_OPTIONAL_CAPABILITIES = {
  'state-store': ['sync-cursor', 'lifecycle-command-log'],
  'notification-dispatcher': ['delivery-receipt', 'retry-backoff-hint'],
  'proof-store': ['proof-receipt', 'retention-policy'],
  'external-handoff': ['handoff-lease', 'client-consumption-receipt']
};
const PROVIDER_CONTRACT_VERSIONS = ['notifier-record-provider-v1'];
const PROVIDER_SYNC_STALE_MS = 15 * 60 * 1000;
const HANDOFF_LEASE_MS = 30 * 60 * 1000;
const PROVIDER_BOUNDARY_SCOPE_MODES = ['inherit-request-scope', 'tenant-workspace-bound', 'shared-hosted-kernel'];
const PROVIDER_SHARED_SCOPE_CAPABILITY = {
  'state-store': 'audit-partition',
  'notification-dispatcher': 'recipient-manifest',
  'proof-store': 'audit-partition',
  'external-handoff': 'handoff-state'
};
const COMMAND_OPERATION_ALIASES = {
  'apply-lifecycle': ['apply-lifecycle', 'apply-notifier-record-lifecycle', 'notifier-record-lifecycle', 'lifecycle'],
  'persist-state': ['persist-state', 'persist-notifier-record-state', 'notifier-record-state', 'save-draft', 'restore-draft'],
  dispatch: ['dispatch', 'dispatch-notifier-record', 'notifier-record-dispatch', 'notification-dispatch'],
  'persist-proof': ['persist-proof', 'persist-notifier-record-proof', 'notifier-record-proof', 'proof-persist', 'persist-audit-proof']
};
const COMMAND_OPERATION_ROUTES = {
  'apply-lifecycle': '/kernel/audit-recovery/notifier-record/lifecycle',
  'persist-state': '/kernel/audit-recovery/notifier-record/state',
  dispatch: '/kernel/audit-recovery/notifier-record/dispatch',
  'persist-proof': '/kernel/audit-recovery/notifier-record/proof'
};
const COMMAND_OPERATION_PAYLOAD_CONTRACTS = {
  'apply-lifecycle': 'NotifierRecordLifecycleCommandRequestV1',
  'persist-state': 'NotifierRecordPersistStateRequestV1',
  dispatch: 'NotifierRecordDispatchRequestV1',
  'persist-proof': 'NotifierRecordProofPersistRequestV1'
};

function asIsoTimestamp(value, fallback) {
  if (typeof value !== 'string' || value.trim() === '') return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function asNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function uniqueStrings(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(asNonEmptyString).filter(Boolean))];
}

function countBy(items, resolveKey) {
  return items.reduce((counts, item) => {
    const key = asNonEmptyString(resolveKey(item)) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function uniqueStringsFromHeader(value) {
  if (Array.isArray(value)) return uniqueStrings(value);
  if (typeof value !== 'string') return [];
  return uniqueStrings(value.split(','));
}

function asNonNegativeInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return fallback;
  return Math.floor(numeric);
}

function asPositiveInteger(value, fallback = null) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.floor(numeric);
}

function asBoolean(value, fallback = false) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return fallback;
}

function asPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    const normalized = asNonEmptyString(value);
    if (normalized) return normalized;
  }
  return null;
}

function normalizeLifecycleCommandName(value) {
  const requested = asNonEmptyString(value);
  if (!requested) return null;
  return LIFECYCLE_COMMAND_ALIASES[requested] || null;
}

function normalizeCommandOperation(command) {
  const commandId = firstNonEmptyString(command.commandId, command.id);
  const action = firstNonEmptyString(command.action, command.command, command.name);
  const route = asNonEmptyString(command.route);
  const payloadContract = firstNonEmptyString(command.payloadContract, command.contract);
  const candidates = uniqueStrings([command.operation, command.kind, action, commandId])
    .map((value) => value.toLowerCase());

  for (const [operation, aliases] of Object.entries(COMMAND_OPERATION_ALIASES)) {
    if (candidates.some((candidate) => candidate === operation || candidate.endsWith(`:${operation}`) || aliases.includes(candidate))) {
      return operation;
    }
  }

  for (const [operation, operationRoute] of Object.entries(COMMAND_OPERATION_ROUTES)) {
    if (route === operationRoute || (route && route.endsWith(operationRoute))) {
      return operation;
    }
  }

  for (const [operation, contract] of Object.entries(COMMAND_OPERATION_PAYLOAD_CONTRACTS)) {
    if (payloadContract === contract) {
      return operation;
    }
  }

  return null;
}

function commandLedgerHasOperation(persistedState, operation) {
  return persistedState.completedCommandOperations.includes(operation)
    || persistedState.completedCommandIds.some((commandId) => commandId.endsWith(`:${operation}`));
}

function normalizeOperationalStatus(value, fallback = 'available') {
  const requested = asNonEmptyString(value);
  if (!requested) return { status: fallback, requestedStatus: null, valid: true };
  const status = requested.toLowerCase();
  return OPERATIONAL_HEALTH_STATUSES.includes(status)
    ? { status, requestedStatus: requested, valid: true }
    : { status: fallback, requestedStatus: requested, valid: false };
}

function normalizeRetryBackoffHint(source, retryCount) {
  const retryBackoffMs = asPositiveInteger(source.retryBackoffMs ?? source.backoffMs ?? source.retryDelayMs, null);
  const retryBackoffSchedule = Array.isArray(source.retryBackoffScheduleMs)
    ? source.retryBackoffScheduleMs.map((value) => asPositiveInteger(value, null)).filter(Boolean)
    : DEFAULT_RETRY_BACKOFF_MS;
  const selectedBackoffMs = retryBackoffMs
    || retryBackoffSchedule[Math.min(retryCount, retryBackoffSchedule.length - 1)]
    || DEFAULT_RETRY_BACKOFF_MS[DEFAULT_RETRY_BACKOFF_MS.length - 1];

  return {
    contract: 'NotifierRecordRetryBackoffHintV1',
    source: retryBackoffMs ? 'provider-hint' : 'kernel-default-schedule',
    retryBackoffMs: selectedBackoffMs,
    scheduleMs: retryBackoffSchedule,
    attemptOrdinal: retryCount + 1
  };
}

function normalizeRequestContext(input) {
  const request = asPlainObject(input.request);
  const headers = asPlainObject(request.headers);
  const clientState = asPlainObject(input.clientState);
  const actor = asNonEmptyString(input.actor) || asNonEmptyString(request.actor) || asNonEmptyString(clientState.actor);
  const sessionId = asNonEmptyString(input.sessionId) || asNonEmptyString(request.sessionId) || asNonEmptyString(headers['x-aios-session']);
  const traceId = asNonEmptyString(input.traceId) || asNonEmptyString(request.traceId) || asNonEmptyString(headers['x-aios-trace']);
  const sourceRoute = asNonEmptyString(input.sourceRoute) || asNonEmptyString(request.route) || '/kernel/audit-recovery/notifier-record';

  return {
    actor,
    sessionId,
    traceId,
    sourceRoute,
    clientStateVersion: asNonEmptyString(clientState.version) || 'notifier-record-client-state-v1',
    requestedStep: asNonEmptyString(input.requestedStep) || asNonEmptyString(request.step) || asNonEmptyString(clientState.step) || 'draft',
    visiblePanels: uniqueStrings(clientState.visiblePanels).filter((panel) => CLIENT_STATE_KEYS.includes(panel))
  };
}

function normalizeBoundaryContext(input, persistedState) {
  const request = asPlainObject(input.request);
  const headers = asPlainObject(request.headers);
  const clientState = asPlainObject(input.clientState);
  const clientBoundary = asPlainObject(clientState.boundary);
  const persistedBoundary = asPlainObject(persistedState.boundary);
  const tenantId = firstNonEmptyString(
    input.tenantId,
    request.tenantId,
    headers['x-aios-tenant'],
    clientBoundary.tenantId,
    persistedBoundary.tenantId
  );
  const workspaceId = firstNonEmptyString(
    input.workspaceId,
    request.workspaceId,
    headers['x-aios-workspace'],
    clientBoundary.workspaceId,
    persistedBoundary.workspaceId
  );
  const roles = uniqueStrings([
    ...uniqueStrings(input.roles),
    ...uniqueStrings(request.roles),
    ...uniqueStrings(clientBoundary.roles),
    ...uniqueStringsFromHeader(headers['x-aios-roles'])
  ]);
  const permissions = uniqueStrings([
    ...uniqueStrings(input.permissions),
    ...uniqueStrings(request.permissions),
    ...uniqueStrings(clientBoundary.permissions),
    ...uniqueStringsFromHeader(headers['x-aios-permissions'])
  ]);
  const explicitAllowedWorkspaceIds = uniqueStrings([
    ...uniqueStrings(input.allowedWorkspaceIds),
    ...uniqueStrings(request.allowedWorkspaceIds),
    ...uniqueStrings(clientBoundary.allowedWorkspaceIds),
    ...uniqueStringsFromHeader(headers['x-aios-allowed-workspaces'])
  ]);
  const allowedWorkspaceIds = explicitAllowedWorkspaceIds.length > 0
    ? explicitAllowedWorkspaceIds
    : uniqueStrings([workspaceId]);
  const roleAllowsDispatch = roles.some((role) => DISPATCH_ROLES.includes(role));
  const permissionAllowsDispatch = permissions.some((permission) => DISPATCH_PERMISSIONS.includes(permission));

  return {
    contract: 'NotifierRecordBoundaryContextV1',
    tenantId,
    workspaceId,
    roles,
    permissions,
    allowedWorkspaceIds,
    explicitWorkspaceAllowList: explicitAllowedWorkspaceIds.length > 0,
    persistedTenantId: persistedBoundary.tenantId,
    persistedWorkspaceId: persistedBoundary.workspaceId,
    dispatchAllowed: Boolean(roleAllowsDispatch || permissionAllowsDispatch),
    auditHandoffAllowed: Boolean(tenantId && workspaceId && allowedWorkspaceIds.includes(workspaceId)),
    isolationMode: tenantId && workspaceId ? 'tenant-workspace-bound' : 'unbound',
    requiredDispatchRoles: DISPATCH_ROLES,
    requiredDispatchPermissions: DISPATCH_PERMISSIONS
  };
}

function buildProviderBoundaryPolicy({ provider, role, capabilities, boundaryContext }) {
  const providerBoundary = asPlainObject(provider.boundary);
  const requestedScopeMode = firstNonEmptyString(provider.scopeMode, providerBoundary.scopeMode);
  const scopeMode = PROVIDER_BOUNDARY_SCOPE_MODES.includes(requestedScopeMode)
    ? requestedScopeMode
    : 'inherit-request-scope';
  const providerTenantId = firstNonEmptyString(provider.tenantId, providerBoundary.tenantId);
  const providerWorkspaceId = firstNonEmptyString(provider.workspaceId, providerBoundary.workspaceId);
  const providerAllowedTenantIds = uniqueStrings([
    ...uniqueStrings(provider.allowedTenantIds),
    ...uniqueStrings(providerBoundary.allowedTenantIds)
  ]);
  const providerAllowedWorkspaceIds = uniqueStrings([
    ...uniqueStrings(provider.allowedWorkspaceIds),
    ...uniqueStrings(providerBoundary.allowedWorkspaceIds)
  ]);
  const sharedScopeCapability = PROVIDER_SHARED_SCOPE_CAPABILITY[role];
  const allowAllTenants = asBoolean(provider.allowAllTenants ?? providerBoundary.allowAllTenants, false);
  const allowAllWorkspaces = asBoolean(provider.allowAllWorkspaces ?? providerBoundary.allowAllWorkspaces, false);
  const requestedSharedScope = scopeMode === 'shared-hosted-kernel';
  const sharedScopeAllowed = requestedSharedScope
    && Boolean(sharedScopeCapability && capabilities.includes(sharedScopeCapability))
    && (allowAllTenants || providerAllowedTenantIds.includes(boundaryContext.tenantId))
    && (allowAllWorkspaces || providerAllowedWorkspaceIds.includes(boundaryContext.workspaceId));
  const providerTenantMismatch = Boolean(
    providerTenantId
    && boundaryContext.tenantId
    && providerTenantId !== boundaryContext.tenantId
    && !sharedScopeAllowed
  );
  const providerWorkspaceMismatch = Boolean(
    providerWorkspaceId
    && boundaryContext.workspaceId
    && providerWorkspaceId !== boundaryContext.workspaceId
    && !sharedScopeAllowed
  );
  const tenantAllowListDenied = Boolean(
    boundaryContext.tenantId
    && providerAllowedTenantIds.length > 0
    && !providerAllowedTenantIds.includes(boundaryContext.tenantId)
    && !allowAllTenants
  );
  const workspaceAllowListDenied = Boolean(
    boundaryContext.workspaceId
    && providerAllowedWorkspaceIds.length > 0
    && !providerAllowedWorkspaceIds.includes(boundaryContext.workspaceId)
    && !allowAllWorkspaces
  );
  const sharedScopeCapabilityMissing = requestedSharedScope && !capabilities.includes(sharedScopeCapability);
  const boundaryIssues = [
    providerTenantMismatch ? { code: 'provider_tenant_mismatch', expected: boundaryContext.tenantId, actual: providerTenantId } : null,
    providerWorkspaceMismatch ? { code: 'provider_workspace_mismatch', expected: boundaryContext.workspaceId, actual: providerWorkspaceId } : null,
    tenantAllowListDenied ? { code: 'provider_tenant_not_allowed', expected: boundaryContext.tenantId, allowedValues: providerAllowedTenantIds } : null,
    workspaceAllowListDenied ? { code: 'provider_workspace_not_allowed', expected: boundaryContext.workspaceId, allowedValues: providerAllowedWorkspaceIds } : null,
    sharedScopeCapabilityMissing ? { code: 'provider_shared_scope_capability_missing', requiredCapability: sharedScopeCapability } : null
  ].filter(Boolean);
  const effectiveTenantId = sharedScopeAllowed ? boundaryContext.tenantId : providerTenantId || boundaryContext.tenantId;
  const effectiveWorkspaceId = sharedScopeAllowed ? boundaryContext.workspaceId : providerWorkspaceId || boundaryContext.workspaceId;
  const requestScopeBound = Boolean(boundaryContext.tenantId && boundaryContext.workspaceId);
  const boundaryMismatch = boundaryIssues.length > 0;

  return {
    contract: 'NotifierRecordProviderBoundaryPolicyV1',
    role,
    requestedScopeMode,
    scopeMode,
    requestScopeBound,
    tenantId: effectiveTenantId,
    workspaceId: effectiveWorkspaceId,
    providerTenantId,
    providerWorkspaceId,
    allowedTenantIds: providerAllowedTenantIds,
    allowedWorkspaceIds: providerAllowedWorkspaceIds,
    allowAllTenants,
    allowAllWorkspaces,
    sharedScopeCapability,
    sharedScopeAllowed,
    boundaryMismatch,
    boundaryIssues,
    decision: !requestScopeBound
      ? 'hold-unbound-request-scope'
      : boundaryMismatch
        ? 'reject-provider-boundary'
        : sharedScopeAllowed
          ? 'allow-shared-hosted-kernel-provider'
          : providerTenantId || providerWorkspaceId
            ? 'allow-provider-bound-scope'
            : 'inherit-request-scope',
    handoffScope: {
      tenantId: effectiveTenantId,
      workspaceId: effectiveWorkspaceId,
      proofPartition: `/kernel/audit-recovery/notifier-record/proof/${effectiveTenantId || 'unbound'}/${effectiveWorkspaceId || 'unbound'}`
    }
  };
}

function normalizePersistedState(input, generatedAt) {
  const persisted = asPlainObject(input.persistedState);
  const snapshot = asPlainObject(persisted.snapshot);
  const boundary = asPlainObject(persisted.boundary || snapshot.boundary);
  const hasPersistedInput = Object.keys(persisted).length > 0 || Object.keys(snapshot).length > 0;
  const commandLog = Array.isArray(persisted.commandLog) ? persisted.commandLog : [];
  const recordedCommands = commandLog
    .map((command, index) => ({ command: asPlainObject(command), index }))
    .filter(({ command }) => asNonEmptyString(command.commandId) || asNonEmptyString(command.id));
  const lastCommand = recordedCommands[recordedCommands.length - 1];
  const commandLedger = recordedCommands.map(({ command, index }) => {
    const commandId = firstNonEmptyString(command.commandId, command.id);
    const idempotencyKey = asNonEmptyString(command.idempotencyKey);
    const status = (firstNonEmptyString(command.status, command.result) || 'observed').toLowerCase();
    const action = firstNonEmptyString(command.action, command.command, command.name);
    const operation = normalizeCommandOperation(command);
    const completed = ['completed', 'succeeded', 'success', 'recorded', 'persisted'].includes(status);
    const replayKey = idempotencyKey || (operation && commandId ? `${operation}:${commandId}` : null);

    return {
      contract: 'NotifierRecordRecoveredCommandLedgerEntryV1',
      sequence: asNonNegativeInteger(command.sequence ?? command.index, index + 1),
      commandId,
      idempotencyKey,
      replayKey,
      action,
      operation,
      status,
      completed,
      replaySafe: Boolean(replayKey),
      capturedAt: asIsoTimestamp(command.capturedAt || command.completedAt || command.generatedAt || command.at, null)
    };
  });
  const completedCommandIds = uniqueStrings(commandLedger.filter((entry) => entry.completed).map((entry) => entry.commandId));
  const completedIdempotencyKeys = uniqueStrings(commandLedger.filter((entry) => entry.completed).map((entry) => entry.idempotencyKey));
  const completedCommandOperations = uniqueStrings(commandLedger.filter((entry) => entry.completed).map((entry) => entry.operation));
  const completedOperationReplayKeys = uniqueStrings(commandLedger.filter((entry) => entry.completed).map((entry) => entry.replayKey));
  const status = firstNonEmptyString(persisted.status, snapshot.status, persisted.lastKnownStatus)
    || (hasPersistedInput ? 'draft-restored' : 'not-persisted');
  const version = firstNonEmptyString(persisted.version, snapshot.version) || 'notifier-record-persisted-state-v1';

  return {
    version,
    status,
    recovered: Boolean(hasPersistedInput || persisted.recovered || persisted.restored),
    recoveredAt: generatedAt,
    snapshotRecordId: firstNonEmptyString(snapshot.recordId, persisted.recordId),
    snapshotSeverity: firstNonEmptyString(snapshot.severity, persisted.severity),
    snapshotRecoveryAction: firstNonEmptyString(snapshot.recoveryAction, persisted.recoveryAction),
    boundary: {
      tenantId: firstNonEmptyString(boundary.tenantId, snapshot.tenantId, persisted.tenantId),
      workspaceId: firstNonEmptyString(boundary.workspaceId, snapshot.workspaceId, persisted.workspaceId),
      handoffTarget: firstNonEmptyString(boundary.handoffTarget, snapshot.handoffTarget, persisted.handoffTarget)
    },
    snapshotAccepted: Boolean(snapshot.accepted || persisted.accepted),
    snapshotAcknowledgements: uniqueStrings(snapshot.acknowledgements || persisted.acknowledgements),
    lastCommandId: lastCommand ? firstNonEmptyString(lastCommand.command.commandId, lastCommand.command.id) : null,
    lastCommandStatus: lastCommand ? firstNonEmptyString(lastCommand.command.status, lastCommand.command.result) : null,
    commandLedger,
    completedCommandIds,
    completedIdempotencyKeys,
    completedCommandOperations,
    completedOperationReplayKeys,
    terminal: TERMINAL_PERSISTED_STATUSES.includes(status),
    commandCount: commandLog.length
  };
}

function normalizeOperationalHealth(input, persistedState, generatedAt) {
  const request = asPlainObject(input.request);
  const source = {
    ...asPlainObject(request.operationalHealth),
    ...asPlainObject(input.operationalHealth)
  };
  const lastFailure = asPlainObject(source.lastFailure || input.lastFailure);
  const failureCode = firstNonEmptyString(
    source.failureCode,
    lastFailure.code,
    persistedState.lastCommandStatus === 'failed' ? 'transport_error' : null
  );
  const retryCount = asNonNegativeInteger(source.retryCount ?? input.retryCount ?? lastFailure.retryCount, 0);
  const maxRetryAttempts = Math.max(1, asNonNegativeInteger(source.maxRetryAttempts ?? input.maxRetryAttempts, 4));
  const retryAfter = asIsoTimestamp(source.retryAfter || lastFailure.retryAfter, null);
  const dispatcherStatusInput = firstNonEmptyString(source.dispatcherStatus, source.notifierStatus);
  const proofStoreStatusInput = firstNonEmptyString(source.proofStoreStatus, source.auditStoreStatus);
  const dispatcherHealth = normalizeOperationalStatus(dispatcherStatusInput, 'available');
  const proofStoreHealth = normalizeOperationalStatus(proofStoreStatusInput, 'available');
  const dispatcherStatus = dispatcherHealth.status;
  const proofStoreStatus = proofStoreHealth.status;
  const dispatcherHealthy = dispatcherStatus !== 'unavailable' && dispatcherStatus !== 'degraded' && dispatcherStatus !== 'disabled';
  const proofStoreHealthy = proofStoreStatus !== 'unavailable' && proofStoreStatus !== 'disabled';
  const terminalFailure = TERMINAL_FAILURE_CODES.includes(failureCode);
  const knownRetryableFailure = Boolean(failureCode) && RETRYABLE_FAILURE_CODES.includes(failureCode);
  const retryableFailure = knownRetryableFailure && retryCount < maxRetryAttempts;
  const retryBackoffHint = normalizeRetryBackoffHint(source, retryCount);
  const backoffMs = retryableFailure ? retryBackoffHint.retryBackoffMs : 0;
  const generatedMs = new Date(generatedAt).getTime();
  const retryAfterMs = retryAfter ? new Date(retryAfter).getTime() : null;
  const computedRetryAt = retryableFailure && !retryAfter
    ? new Date(generatedMs + backoffMs).toISOString()
    : retryAfter;
  const computedRetryMs = computedRetryAt ? new Date(computedRetryAt).getTime() : null;
  const retryWindowOpen = retryableFailure && (!Number.isFinite(computedRetryMs) || computedRetryMs <= generatedMs);
  const retryDelayed = retryableFailure && Number.isFinite(computedRetryMs) && computedRetryMs > generatedMs;
  const retryExhausted = Boolean(failureCode) && knownRetryableFailure && retryCount >= maxRetryAttempts;
  const unknownFailure = Boolean(failureCode) && !knownRetryableFailure && !terminalFailure;
  const degradedMode = Boolean(source.degradedMode)
    || dispatcherStatus === 'degraded'
    || (!proofStoreHealthy && dispatcherHealthy);
  const circuitOpen = Boolean(source.circuitOpen)
    || dispatcherStatus === 'disabled'
    || dispatcherStatus === 'unavailable'
    || terminalFailure
    || retryExhausted
    || unknownFailure;
  const failureState = terminalFailure
    ? 'terminal'
    : retryExhausted
      ? 'retry-exhausted'
      : retryDelayed
        ? 'retry-delayed'
        : retryableFailure
          ? 'retryable'
          : unknownFailure
            ? 'unknown'
            : 'none';
  const validationIssues = [
    dispatcherHealth.valid ? null : { code: 'dispatcher_status_invalid', field: 'operationalHealth.dispatcherStatus', severity: 'error', actual: dispatcherHealth.requestedStatus, allowedValues: OPERATIONAL_HEALTH_STATUSES },
    proofStoreHealth.valid ? null : { code: 'proof_store_status_invalid', field: 'operationalHealth.proofStoreStatus', severity: 'error', actual: proofStoreHealth.requestedStatus, allowedValues: OPERATIONAL_HEALTH_STATUSES },
    failureCode && unknownFailure ? { code: 'failure_code_unknown', field: 'operationalHealth.failureCode', severity: 'error', actual: failureCode, retryableFailureCodes: RETRYABLE_FAILURE_CODES, terminalFailureCodes: TERMINAL_FAILURE_CODES } : null,
    retryAfter && Number.isFinite(retryAfterMs) && retryAfterMs < generatedMs && retryableFailure ? { code: 'retry_after_elapsed', field: 'operationalHealth.retryAfter', severity: 'warning', retryAfter } : null
  ].filter(Boolean);
  const actionableErrors = [];

  if (dispatcherStatus === 'disabled') {
    actionableErrors.push({
      code: 'dispatcher_disabled',
      severity: 'error',
      owner: 'kernel-notification-dispatcher',
      action: 'enable an approved dispatcher before retrying hosted-kernel handoff'
    });
  }

  if (dispatcherStatus === 'unavailable') {
    actionableErrors.push({
      code: 'dispatcher_unavailable',
      severity: 'error',
      owner: 'kernel-notification-dispatcher',
      action: 'restore dispatcher or route notification through approved fallback channel'
    });
  } else if (dispatcherStatus === 'degraded') {
    actionableErrors.push({
      code: 'dispatcher_degraded',
      severity: 'warning',
      owner: 'kernel-notification-dispatcher',
      action: 'continue with idempotent dispatch and preserve retry envelope'
    });
  }

  if (!proofStoreHealthy) {
    actionableErrors.push({
      code: proofStoreStatus === 'disabled' ? 'proof_store_disabled' : 'proof_store_unavailable',
      severity: dispatcherHealthy ? 'warning' : 'error',
      owner: 'kernel-audit-proof-store',
      action: 'dispatch can be staged, but proof persistence must be retried before closure'
    });
  }

  if (terminalFailure) {
    actionableErrors.push({
      code: failureCode,
      severity: 'error',
      owner: 'tenant-audit-operator',
      action: 'revise notifier record before retrying dispatch'
    });
  } else if (retryableFailure) {
    actionableErrors.push({
      code: failureCode,
      severity: retryDelayed ? 'info' : 'warning',
      owner: 'kernel-retry-scheduler',
      action: retryDelayed
        ? 'wait until retryAt before replaying the same idempotency key'
        : 'retry dispatch with same idempotency key after computed backoff'
    });
  } else if (retryExhausted) {
    actionableErrors.push({
      code: 'retry_budget_exhausted',
      severity: 'error',
      owner: 'tenant-audit-operator',
      action: 'escalate failed notification and choose a new recovery route'
    });
  } else if (unknownFailure) {
    actionableErrors.push({
      code: 'failure_code_unknown',
      severity: 'error',
      owner: 'kernel-notification-dispatcher',
      action: 'map failure to a retryable or terminal notifier-record failure code before continuing'
    });
  }

  return {
    contract: 'NotifierRecordOperationalHealthV1',
    checkedAt: generatedAt,
    dispatcherStatus,
    proofStoreStatus,
    degradedMode,
    circuitOpen,
    retryableFailure,
    terminalFailure,
    failureCode,
    failureMessage: firstNonEmptyString(source.failureMessage, lastFailure.message),
    retryCount,
    maxRetryAttempts,
    retryBudgetRemaining: Math.max(0, maxRetryAttempts - retryCount),
    retryAfter,
    retryAt: computedRetryAt,
    retryWindowOpen,
    retryDelayed,
    nextBackoffMs: backoffMs,
    retryBackoffHint,
    failureState: {
      contract: 'NotifierRecordFailureStateV1',
      state: failureState,
      allowedStates: FAILURE_STATES,
      code: failureCode,
      retryable: retryableFailure,
      terminal: terminalFailure,
      retryExhausted,
      unknown: unknownFailure,
      attempts: retryCount,
      maxAttempts: maxRetryAttempts,
      nextAttemptAt: computedRetryAt,
      retryWindowOpen,
      circuitBreakerReason: circuitOpen
        ? dispatcherStatus === 'disabled' || dispatcherStatus === 'unavailable'
          ? `dispatcher_${dispatcherStatus}`
          : terminalFailure
            ? 'terminal_failure'
            : retryExhausted
              ? 'retry_budget_exhausted'
              : unknownFailure
                ? 'unknown_failure_code'
                : 'operator_requested_circuit_open'
        : null
    },
    retryPolicy: retryableFailure
      ? retryDelayed ? 'wait-for-retry-window' : 'same-idempotency-key-with-backoff'
      : circuitOpen
        ? 'operator-escalation-required'
        : 'no-retry-required',
    validationIssues,
    actionableErrors
  };
}

function normalizeLifecycleControls(input, generatedAt) {
  const request = asPlainObject(input.request);
  const clientState = asPlainObject(input.clientState);
  const source = {
    ...asPlainObject(clientState.lifecycleSettings),
    ...asPlainObject(clientState.lifecycle),
    ...asPlainObject(request.lifecycleSettings),
    ...asPlainObject(request.lifecycle),
    ...asPlainObject(input.lifecycleSettings),
    ...asPlainObject(input.lifecycle)
  };
  const requestedMode = firstNonEmptyString(source.mode, source.status, input.lifecycleMode);
  let mode = LIFECYCLE_MODES.includes(requestedMode) ? requestedMode : 'enabled';
  const requestedSchedulingMode = firstNonEmptyString(source.schedulingMode, source.scheduleMode, input.schedulingMode);
  let schedulingMode = SCHEDULING_MODES.includes(requestedSchedulingMode) ? requestedSchedulingMode : 'immediate';
  const requestedCommand = firstNonEmptyString(source.command, source.lifecycleCommand, source.action, input.lifecycleCommand);
  const lifecycleCommand = normalizeLifecycleCommandName(requestedCommand);
  const commandReason = firstNonEmptyString(source.commandReason, source.reason, source.disableReason, source.pausedReason);
  const generatedMs = new Date(generatedAt).getTime();
  let scheduledAt = asIsoTimestamp(source.scheduledAt || source.dispatchAt || input.scheduledAt, null);
  const holdUntil = asIsoTimestamp(source.holdUntil || source.notBefore || input.holdUntil, null);
  const expiresAt = asIsoTimestamp(source.expiresAt || source.scheduleExpiresAt || input.expiresAt, null);
  const previousMode = LIFECYCLE_MODES.includes(source.previousMode) ? source.previousMode : null;
  const previousSchedulingMode = SCHEDULING_MODES.includes(source.previousSchedulingMode) ? source.previousSchedulingMode : null;
  const validationIssues = [];

  if (requestedMode && !LIFECYCLE_MODES.includes(requestedMode)) {
    validationIssues.push({ code: 'lifecycle_mode_invalid', field: 'lifecycle.mode', severity: 'error', allowedValues: LIFECYCLE_MODES });
  }
  if (requestedCommand && !lifecycleCommand) {
    validationIssues.push({ code: 'lifecycle_command_invalid', field: 'lifecycle.command', severity: 'error', allowedValues: LIFECYCLE_COMMANDS });
  }
  if (requestedSchedulingMode && !SCHEDULING_MODES.includes(requestedSchedulingMode)) {
    validationIssues.push({ code: 'scheduling_mode_invalid', field: 'lifecycle.schedulingMode', severity: 'error', allowedValues: SCHEDULING_MODES });
  }
  if (lifecycleCommand === 'enable' || lifecycleCommand === 'resume') {
    mode = 'enabled';
  } else if (lifecycleCommand === 'pause') {
    mode = 'paused';
  } else if (lifecycleCommand === 'disable') {
    mode = 'disabled';
  }
  if (lifecycleCommand === 'schedule' || lifecycleCommand === 'reschedule') {
    schedulingMode = 'scheduled';
    if (mode === 'disabled') {
      validationIssues.push({ code: 'schedule_while_disabled', field: 'lifecycle.command', severity: 'error' });
    } else {
      mode = 'enabled';
    }
  } else if (lifecycleCommand === 'cancel-schedule') {
    schedulingMode = 'immediate';
    scheduledAt = null;
  } else if (lifecycleCommand === 'set-manual') {
    schedulingMode = 'manual';
    scheduledAt = null;
  }
  const scheduleCandidates = [scheduledAt, holdUntil]
    .filter(Boolean)
    .map((timestamp) => ({ timestamp, ms: new Date(timestamp).getTime() }))
    .filter((candidate) => Number.isFinite(candidate.ms));
  const nextEligibleAt = scheduleCandidates.length > 0
    ? scheduleCandidates.reduce((latest, candidate) => (candidate.ms > latest.ms ? candidate : latest)).timestamp
    : null;
  const nextEligibleMs = nextEligibleAt ? new Date(nextEligibleAt).getTime() : null;
  const expiresMs = expiresAt ? new Date(expiresAt).getTime() : null;
  const scheduleActive = Number.isFinite(nextEligibleMs) && nextEligibleMs > generatedMs;
  const scheduleExpired = Number.isFinite(expiresMs) && expiresMs < generatedMs;
  if (mode === 'disabled' && !commandReason) {
    validationIssues.push({ code: 'lifecycle_disable_reason_missing', field: 'lifecycle.disableReason', severity: 'warning' });
  }
  if ((lifecycleCommand === 'disable' || lifecycleCommand === 'pause') && !commandReason) {
    validationIssues.push({ code: 'lifecycle_command_reason_missing', field: 'lifecycle.commandReason', severity: 'warning', command: lifecycleCommand });
  }
  if (schedulingMode === 'scheduled' && !scheduledAt) {
    validationIssues.push({ code: 'scheduled_dispatch_time_missing', field: 'lifecycle.scheduledAt', severity: 'error' });
  }
  if (scheduleExpired) {
    validationIssues.push({ code: 'schedule_window_expired', field: 'lifecycle.expiresAt', severity: 'error', expiresAt });
  }
  if (Number.isFinite(nextEligibleMs) && nextEligibleMs - generatedMs > MAX_SCHEDULE_DELAY_MS) {
    validationIssues.push({ code: 'schedule_window_too_far', field: 'lifecycle.scheduledAt', severity: 'error', maxDelayMs: MAX_SCHEDULE_DELAY_MS });
  }

  const dispatchEnabled = mode === 'enabled' && !scheduleExpired;
  const proofPersistenceEnabled = asBoolean(source.proofPersistenceEnabled ?? source.proofEnabled, true);
  const commandBlockers = validationIssues
    .filter((issue) => issue.severity === 'error' && ['lifecycle.command', 'lifecycle.mode', 'lifecycle.schedulingMode', 'lifecycle.scheduledAt', 'lifecycle.expiresAt'].includes(issue.field))
    .map((issue) => issue.code);
  const commandAccepted = Boolean(lifecycleCommand) && commandBlockers.length === 0;
  const nextOperatorAction = commandAccepted
    ? lifecycleCommand === 'schedule' || lifecycleCommand === 'reschedule'
      ? 'wait-for-scheduled-dispatch'
      : lifecycleCommand === 'pause' || lifecycleCommand === 'disable' || lifecycleCommand === 'set-manual'
        ? 'hold-dispatch'
        : 'resume-dispatch'
    : lifecycleCommand
      ? 'revise-lifecycle-command'
      : dispatchEnabled
        ? scheduleActive ? 'wait-for-scheduled-dispatch' : 'dispatch-available'
        : mode === 'paused' ? 'resume-lifecycle' : 'enable-lifecycle';
  const lifecycleCommandState = {
    contract: 'NotifierRecordLifecycleCommandStateV1',
    requestedCommand,
    command: lifecycleCommand,
    accepted: commandAccepted,
    previousMode,
    previousSchedulingMode,
    effectiveMode: mode,
    effectiveSchedulingMode: schedulingMode,
    scheduledAt,
    holdUntil,
    expiresAt,
    reason: commandReason,
    requiresOperatorReason: lifecycleCommand === 'pause' || lifecycleCommand === 'disable',
    commandBlockers,
    nextOperatorAction,
    auditEvent: lifecycleCommand
      ? `${surfaceId}:lifecycle:${lifecycleCommand}:${mode}:${schedulingMode}`
      : `${surfaceId}:lifecycle:settings:${mode}:${schedulingMode}`,
    proofIntent: lifecycleCommand
      ? commandAccepted ? 'persist-lifecycle-command-proof' : 'persist-rejected-lifecycle-command-proof'
      : 'persist-lifecycle-settings-proof'
  };

  return {
    contract: 'NotifierRecordLifecycleControlsV1',
    mode,
    enabled: dispatchEnabled,
    dispatchEnabled,
    proofPersistenceEnabled,
    schedulingMode,
    scheduledAt,
    holdUntil,
    expiresAt,
    nextEligibleAt,
    scheduleActive,
    scheduleExpired,
    operatorOverride: asBoolean(source.operatorOverride, false),
    disableReason: firstNonEmptyString(source.disableReason, source.reason),
    pausedReason: mode === 'paused' ? firstNonEmptyString(source.pausedReason, source.reason) : null,
    lifecycleCommand: lifecycleCommandState,
    nextOperatorAction,
    commandPolicy: dispatchEnabled
      ? scheduleActive ? 'defer-until-scheduled-window' : 'commands-enabled'
      : mode === 'paused' ? 'operator-resume-required' : 'operator-enable-required',
    validationIssues
  };
}

function normalizeClientHandoffState(input, persistedState, generatedAt) {
  const request = asPlainObject(input.request);
  const clientState = asPlainObject(input.clientState);
  const source = {
    ...asPlainObject(clientState.handoff),
    ...asPlainObject(clientState.workflowHandoff),
    ...asPlainObject(request.handoff),
    ...asPlainObject(request.workflowHandoff),
    ...asPlainObject(input.handoff),
    ...asPlainObject(input.workflowHandoff)
  };
  const requestedIntent = firstNonEmptyString(source.intent, source.requestedIntent, source.action);
  const intent = HANDOFF_INTENTS.includes(requestedIntent) ? requestedIntent : 'continue-review';
  const persistedHandoffTarget = firstNonEmptyString(persistedState.boundary.handoffTarget);
  const requestedTarget = firstNonEmptyString(source.target, source.requestedTarget, persistedHandoffTarget);
  const previousStatus = firstNonEmptyString(source.previousStatus, source.lastStatus, persistedState.status);
  const lastSeenAt = asIsoTimestamp(source.lastSeenAt || source.viewedAt || source.updatedAt, null);
  const acknowledgedAt = asIsoTimestamp(source.acknowledgedAt || source.operatorAcknowledgedAt, null);
  const resumeToken = firstNonEmptyString(source.resumeToken, source.handoffToken)
    || `${surfaceId}:${persistedState.snapshotRecordId || 'pending-record-id'}:${intent}`;
  const sourcePanel = CLIENT_STATE_KEYS.includes(source.sourcePanel) ? source.sourcePanel : null;
  const returnPanel = CLIENT_STATE_KEYS.includes(source.returnPanel) ? source.returnPanel : null;
  const clientConsumed = asBoolean(source.clientConsumed ?? source.consumed, false);
  const validationIssues = [];

  if (requestedIntent && !HANDOFF_INTENTS.includes(requestedIntent)) {
    validationIssues.push({
      code: 'handoff_intent_invalid',
      field: 'clientState.handoff.intent',
      severity: 'warning',
      allowedValues: HANDOFF_INTENTS
    });
  }
  if (lastSeenAt && acknowledgedAt && new Date(acknowledgedAt).getTime() < new Date(lastSeenAt).getTime()) {
    validationIssues.push({
      code: 'handoff_acknowledgement_stale',
      field: 'clientState.handoff.acknowledgedAt',
      severity: 'warning',
      lastSeenAt,
      acknowledgedAt
    });
  }

  return {
    contract: 'NotifierRecordClientHandoffStateV1',
    intent,
    requestedTarget,
    previousStatus,
    resumeToken,
    sourcePanel,
    returnPanel,
    lastSeenAt,
    acknowledgedAt,
    clientConsumed,
    generatedAt,
    validationIssues
  };
}

function normalizeProviderDescriptor(source, role, generatedAt, boundaryContext) {
  const provider = typeof source === 'string' ? { providerId: source } : asPlainObject(source);
  const requiredCapabilities = PROVIDER_REQUIRED_CAPABILITIES[role] || [];
  const optionalCapabilities = PROVIDER_OPTIONAL_CAPABILITIES[role] || [];
  const explicitProvider = typeof source === 'string' || Object.keys(provider).length > 0;
  const capabilities = uniqueStrings([
    ...uniqueStrings(provider.capabilities),
    ...uniqueStrings(provider.supportedCapabilities),
    ...(explicitProvider ? [] : requiredCapabilities)
  ]);
  const missingCapabilities = requiredCapabilities.filter((capability) => !capabilities.includes(capability));
  const acceptedCapabilities = capabilities.filter((capability) => requiredCapabilities.includes(capability) || optionalCapabilities.includes(capability));
  const unsupportedCapabilities = uniqueStrings(provider.requestedCapabilities)
    .filter((capability) => !capabilities.includes(capability));
  const enabled = provider.enabled === undefined ? true : asBoolean(provider.enabled, true);
  const health = firstNonEmptyString(provider.health, provider.status) || (enabled ? 'available' : 'disabled');
  const requestedContractVersion = firstNonEmptyString(provider.contractVersion, provider.versionContract, provider.protocolVersion);
  const contractVersion = PROVIDER_CONTRACT_VERSIONS.includes(requestedContractVersion)
    ? requestedContractVersion
    : 'notifier-record-provider-v1';
  const unsupportedContractVersion = Boolean(requestedContractVersion && !PROVIDER_CONTRACT_VERSIONS.includes(requestedContractVersion));
  const localRevision = firstNonEmptyString(provider.localRevision, provider.revision, provider.version);
  const remoteRevision = firstNonEmptyString(provider.remoteRevision, provider.syncedRevision, provider.providerRevision);
  const cursor = firstNonEmptyString(provider.cursor, provider.syncCursor, provider.checkpoint);
  const lastSyncedAt = asIsoTimestamp(provider.lastSyncedAt || provider.syncedAt, null);
  const nextSyncAfter = asIsoTimestamp(provider.nextSyncAfter || provider.syncAfter, null);
  const lastSyncedMs = lastSyncedAt ? new Date(lastSyncedAt).getTime() : null;
  const generatedMs = new Date(generatedAt).getTime();
  const syncAgeMs = Number.isFinite(lastSyncedMs) ? Math.max(0, generatedMs - lastSyncedMs) : null;
  const stale = asBoolean(provider.stale, false)
    || (localRevision && remoteRevision && localRevision !== remoteRevision)
    || Boolean(syncAgeMs !== null && syncAgeMs > PROVIDER_SYNC_STALE_MS);
  const boundaryPolicy = buildProviderBoundaryPolicy({ provider, role, capabilities, boundaryContext });
  const available = enabled
    && health !== 'unavailable'
    && health !== 'disabled'
    && boundaryPolicy.requestScopeBound
    && !boundaryPolicy.boundaryMismatch
    && missingCapabilities.length === 0;
  const handshakeRoute = firstNonEmptyString(provider.handshakeRoute, provider.negotiateRoute)
    || `/kernel/audit-recovery/notifier-record/providers/${role}/negotiate`;
  const receiptRoute = firstNonEmptyString(provider.receiptRoute, provider.callbackRoute)
    || `/kernel/audit-recovery/notifier-record/providers/${role}/receipt`;

  return {
    contract: 'NotifierRecordProviderDescriptorV1',
    role,
    providerId: firstNonEmptyString(provider.providerId, provider.id, provider.name) || `hosted-kernel-${role}`,
    serviceRoute: firstNonEmptyString(provider.serviceRoute, provider.route) || `/kernel/audit-recovery/notifier-record/providers/${role}`,
    handshakeRoute,
    receiptRoute,
    contractVersion,
    requestedContractVersion,
    unsupportedContractVersion,
    health,
    enabled,
    available,
    requiredCapabilities,
    optionalCapabilities,
    capabilities,
    acceptedCapabilities,
    unsupportedCapabilities,
    missingCapabilities,
    boundary: {
      tenantId: boundaryPolicy.tenantId,
      workspaceId: boundaryPolicy.workspaceId,
      boundaryMismatch: boundaryPolicy.boundaryMismatch,
      decision: boundaryPolicy.decision,
      scopeMode: boundaryPolicy.scopeMode,
      sharedScopeAllowed: boundaryPolicy.sharedScopeAllowed,
      handoffScope: boundaryPolicy.handoffScope,
      issues: boundaryPolicy.boundaryIssues
    },
    boundaryPolicy,
    sync: {
      contract: 'NotifierRecordProviderSyncMetadataV1',
      cursor,
      localRevision,
      remoteRevision,
      lastSyncedAt,
      nextSyncAfter,
      syncAgeMs,
      staleAfterMs: PROVIDER_SYNC_STALE_MS,
      stale,
      syncRequired: stale || !cursor || !lastSyncedAt,
      checkedAt: generatedAt
    }
  };
}

function buildProviderCapabilityNegotiation({ descriptors, requiredRoles, clientHandoffState, generatedAt }) {
  const descriptorByRole = Object.fromEntries(descriptors.map((descriptor) => [descriptor.role, descriptor]));
  const requiredCapabilitySet = uniqueStrings(requiredRoles.flatMap((role) => PROVIDER_REQUIRED_CAPABILITIES[role] || []));
  const requiredSyncRoles = descriptors
    .filter((descriptor) => requiredRoles.includes(descriptor.role) && descriptor.sync.syncRequired)
    .map((descriptor) => descriptor.role);
  const boundaryBlockedRoles = descriptors
    .filter((descriptor) => requiredRoles.includes(descriptor.role) && descriptor.boundaryPolicy.boundaryMismatch)
    .map((descriptor) => descriptor.role);
  const blockingRoles = requiredRoles
    .filter((role) => {
      const descriptor = descriptorByRole[role];
      return !descriptor || !descriptor.available || descriptor.sync.syncRequired;
    });
  const handoffLeaseExpiresAt = new Date(new Date(generatedAt).getTime() + HANDOFF_LEASE_MS).toISOString();
  const serviceHandshakes = descriptors.map((descriptor) => ({
    contract: 'NotifierRecordProviderHandshakeV1',
    role: descriptor.role,
    providerId: descriptor.providerId,
    route: descriptor.handshakeRoute,
    method: 'PATCH',
    payloadContract: 'NotifierRecordProviderHandshakeRequestV1',
    required: requiredRoles.includes(descriptor.role),
    contractVersion: descriptor.contractVersion,
    requestedCapabilities: uniqueStrings([
      ...descriptor.requiredCapabilities,
      ...descriptor.optionalCapabilities
    ]),
    acceptedCapabilities: descriptor.acceptedCapabilities,
    missingCapabilities: descriptor.missingCapabilities,
    unsupportedCapabilities: descriptor.unsupportedCapabilities,
    syncRequired: descriptor.sync.syncRequired,
    syncCursor: descriptor.sync.cursor,
    boundary: descriptor.boundary,
    boundaryDecision: descriptor.boundaryPolicy.decision,
    boundaryIssues: descriptor.boundaryPolicy.boundaryIssues,
    idempotencyKey: `${surfaceId}:${descriptor.boundary.tenantId || 'unbound'}:${descriptor.boundary.workspaceId || 'unbound'}:${descriptor.role}:negotiate:${clientHandoffState.resumeToken}`
  }));
  const handoffState = blockingRoles.length > 0
    ? boundaryBlockedRoles.length > 0
      ? 'boundary-blocked'
      : requiredSyncRoles.length > 0 && blockingRoles.every((role) => requiredSyncRoles.includes(role))
      ? 'sync-before-handoff'
      : 'blocked'
    : 'remote-ready';

  return {
    contract: 'NotifierRecordProviderCapabilityNegotiationV1',
    negotiatedAt: generatedAt,
    contractVersions: PROVIDER_CONTRACT_VERSIONS,
    requiredCapabilitySet,
    requiredSyncRoles,
    boundaryBlockedRoles,
    blockingRoles,
    syncBarrierRequired: requiredSyncRoles.length > 0,
    boundaryBarrierRequired: boundaryBlockedRoles.length > 0,
    handoffState,
    handoffLease: {
      contract: 'NotifierRecordExternalHandoffLeaseV1',
      resumeToken: clientHandoffState.resumeToken,
      leaseMs: HANDOFF_LEASE_MS,
      expiresAt: handoffLeaseExpiresAt,
      consumed: clientHandoffState.clientConsumed
    },
    serviceHandshakes
  };
}

function normalizeProviderContracts(input, boundaryContext, lifecycleControls, clientHandoffState, generatedAt) {
  const request = asPlainObject(input.request);
  const clientState = asPlainObject(input.clientState);
  const source = {
    ...asPlainObject(clientState.providerContracts),
    ...asPlainObject(clientState.providers),
    ...asPlainObject(request.providerContracts),
    ...asPlainObject(request.providers),
    ...asPlainObject(input.providerContracts),
    ...asPlainObject(input.providers)
  };
  const roleAliases = {
    'state-store': ['state-store', 'stateStore', 'persistedStateStore'],
    'notification-dispatcher': ['notification-dispatcher', 'notificationDispatcher', 'dispatcher'],
    'proof-store': ['proof-store', 'proofStore', 'auditProofStore'],
    'external-handoff': ['external-handoff', 'externalHandoff', 'handoffProvider']
  };
  const descriptors = PROVIDER_SERVICE_ROLES.map((role) => {
    const alias = roleAliases[role].find((key) => source[key] !== undefined);
    return normalizeProviderDescriptor(alias ? source[alias] : {}, role, generatedAt, boundaryContext);
  });
  const descriptorByRole = Object.fromEntries(descriptors.map((descriptor) => [descriptor.role, descriptor]));
  const requiredRoles = lifecycleControls.proofPersistenceEnabled
    ? ['state-store', 'notification-dispatcher', 'proof-store']
    : ['state-store', 'notification-dispatcher'];
  const syncRequiredRoles = descriptors.filter((descriptor) => descriptor.sync.syncRequired).map((descriptor) => descriptor.role);
  const capabilityNegotiation = buildProviderCapabilityNegotiation({ descriptors, requiredRoles, clientHandoffState, generatedAt });
  const unavailableRoles = requiredRoles.filter((role) => !descriptorByRole[role].available);
  const boundaryBlockedRoles = capabilityNegotiation.boundaryBlockedRoles;
  const blockedRoles = uniqueStrings([
    ...unavailableRoles,
    ...capabilityNegotiation.requiredSyncRoles,
    ...boundaryBlockedRoles
  ]);
  const externalHandoff = descriptorByRole['external-handoff'];
  const externalHandoffState = {
    contract: 'NotifierRecordExternalHandoffStateV1',
    providerId: externalHandoff.providerId,
    route: externalHandoff.serviceRoute,
    intent: clientHandoffState.intent,
    resumeToken: clientHandoffState.resumeToken,
    state: externalHandoff.available
      ? clientHandoffState.clientConsumed ? 'client-consumed' : 'ready'
      : 'local-only',
    negotiationState: capabilityNegotiation.handoffState,
    handoffLease: capabilityNegotiation.handoffLease,
    receiptRoute: externalHandoff.receiptRoute,
    syncRequired: externalHandoff.sync.syncRequired,
    boundaryDecision: externalHandoff.boundaryPolicy.decision,
    boundaryIssues: externalHandoff.boundaryPolicy.boundaryIssues,
    missingCapabilities: externalHandoff.missingCapabilities,
    blockingRoles: capabilityNegotiation.blockingRoles,
    checkedAt: generatedAt
  };
  const validationIssues = descriptors.flatMap((descriptor) => {
    const issues = [];
    if (descriptor.unsupportedContractVersion) {
      issues.push({ code: 'provider_contract_version_unsupported', field: `providerContracts.${descriptor.role}.contractVersion`, severity: 'error', role: descriptor.role, requestedContractVersion: descriptor.requestedContractVersion, allowedValues: PROVIDER_CONTRACT_VERSIONS });
    }
    if (descriptor.boundary.boundaryMismatch) {
      for (const boundaryIssue of descriptor.boundaryPolicy.boundaryIssues) {
        issues.push({
          code: boundaryIssue.code,
          field: `providerContracts.${descriptor.role}.boundary`,
          severity: 'error',
          role: descriptor.role,
          decision: descriptor.boundaryPolicy.decision,
          expected: boundaryIssue.expected,
          actual: boundaryIssue.actual,
          allowedValues: boundaryIssue.allowedValues,
          requiredCapability: boundaryIssue.requiredCapability
        });
      }
    }
    if (requiredRoles.includes(descriptor.role) && descriptor.missingCapabilities.length > 0) {
      issues.push({ code: 'provider_capability_missing', field: `providerContracts.${descriptor.role}.capabilities`, severity: 'error', role: descriptor.role, missingCapabilities: descriptor.missingCapabilities });
    }
    if (requiredRoles.includes(descriptor.role) && !descriptor.enabled) {
      issues.push({ code: 'provider_disabled', field: `providerContracts.${descriptor.role}.enabled`, severity: 'error', role: descriptor.role });
    }
    if (requiredRoles.includes(descriptor.role) && descriptor.health === 'unavailable') {
      issues.push({ code: 'provider_unavailable', field: `providerContracts.${descriptor.role}.health`, severity: 'error', role: descriptor.role });
    }
    if (requiredRoles.includes(descriptor.role) && descriptor.sync.syncRequired) {
      issues.push({ code: 'provider_sync_barrier_required', field: `providerContracts.${descriptor.role}.sync`, severity: 'warning', role: descriptor.role, cursor: descriptor.sync.cursor });
    }
    if (descriptor.sync.stale) {
      issues.push({ code: 'provider_sync_stale', field: `providerContracts.${descriptor.role}.sync`, severity: requiredRoles.includes(descriptor.role) ? 'warning' : 'info', role: descriptor.role });
    }
    return issues;
  });

  return {
    contract: 'NotifierRecordProviderContractsV1',
    negotiatedAt: generatedAt,
    requiredRoles,
    unavailableRoles,
    blockedRoles,
    boundaryBlockedRoles,
    ready: blockedRoles.length === 0,
    syncRequiredRoles,
    capabilityNegotiation,
    descriptors,
    descriptorByRole,
    externalHandoffState,
    validationIssues
  };
}

function normalizeEvidence(input) {
  const source = Array.isArray(input.evidence) ? input.evidence : [];
  return source
    .map((item, index) => {
      if (typeof item === 'string') {
        const label = item.trim();
        return label ? { id: `evidence-${index + 1}`, label, kind: 'operator-note', index } : null;
      }

      if (!item || typeof item !== 'object') {
        return null;
      }

      const id = asNonEmptyString(item.id) || asNonEmptyString(item.uri) || `evidence-${index + 1}`;
      const label = asNonEmptyString(item.label) || asNonEmptyString(item.title) || id;
      const kind = asNonEmptyString(item.kind) || asNonEmptyString(item.type) || 'audit-artifact';
      const uri = asNonEmptyString(item.uri);
      const capturedAt = asIsoTimestamp(item.capturedAt, null);
      const tenantId = asNonEmptyString(item.tenantId);
      const workspaceId = asNonEmptyString(item.workspaceId);

      return { id, label, kind, uri, capturedAt, tenantId, workspaceId, index };
    })
    .filter(Boolean);
}

function normalizeRecipients(input) {
  const source = Array.isArray(input.recipients) ? input.recipients : [];
  return source
    .map((recipient, index) => {
      if (typeof recipient === 'string') {
        return { id: recipient.trim(), channel: 'audit-inbox', label: recipient.trim(), index };
      }

      if (!recipient || typeof recipient !== 'object') {
        return null;
      }

      const id = asNonEmptyString(recipient.id) || asNonEmptyString(recipient.address);
      const channel = asNonEmptyString(recipient.channel) || 'audit-inbox';
      const label = asNonEmptyString(recipient.label) || id;
      const tenantId = asNonEmptyString(recipient.tenantId);
      const workspaceId = asNonEmptyString(recipient.workspaceId);
      return id ? { id, channel, label, tenantId, workspaceId, index } : null;
    })
    .filter(Boolean);
}

function normalizeMailchimpDispatchContext(input, persistedState, generatedAt) {
  const request = asPlainObject(input.request);
  const product = asPlainObject(input.product);
  const source = {
    ...asPlainObject(product.mailchimp),
    ...asPlainObject(request.mailchimp),
    ...asPlainObject(input.mailchimp)
  };
  const campaign = asPlainObject(source.campaign);
  const audience = asPlainObject(source.audience);
  const persistedSnapshot = asPlainObject(persistedState.raw?.snapshot);
  const campaignId = firstNonEmptyString(
    source.campaignId,
    campaign.campaignId,
    campaign.id,
    persistedSnapshot.mailchimpCampaignId
  );
  const audienceId = firstNonEmptyString(
    source.audienceId,
    source.listId,
    audience.audienceId,
    audience.listId,
    audience.id,
    persistedSnapshot.mailchimpAudienceId
  );
  const templateId = firstNonEmptyString(source.templateId, asPlainObject(source.template).templateId, persistedSnapshot.mailchimpTemplateId);
  const sendAt = asIsoTimestamp(source.sendAt || source.scheduledAt || campaign.sendAt || campaign.scheduledAt, null);
  const archiveUrl = firstNonEmptyString(source.archiveUrl, campaign.archiveUrl, persistedSnapshot.mailchimpArchiveUrl);
  const generatedMs = new Date(generatedAt).getTime();
  const sendAtMs = sendAt ? new Date(sendAt).getTime() : null;
  const dispatchHold = Number.isFinite(sendAtMs) && sendAtMs > generatedMs;
  const present = Boolean(source.enabled === true || campaignId || audienceId || templateId || sendAt || archiveUrl);
  const validationIssues = [];

  if (present && !campaignId) validationIssues.push({ code: 'mailchimp_campaign_id_missing', field: 'mailchimp.campaignId', severity: 'error' });
  if (present && !audienceId) validationIssues.push({ code: 'mailchimp_audience_id_missing', field: 'mailchimp.audienceId', severity: 'error' });
  if (source.sendAt || source.scheduledAt || campaign.sendAt || campaign.scheduledAt) {
    if (!sendAt) validationIssues.push({ code: 'mailchimp_send_at_invalid', field: 'mailchimp.sendAt', severity: 'error' });
  }

  return {
    contract: 'NotifierRecordMailchimpDispatchContextV1',
    present,
    campaignId,
    audienceId,
    templateId,
    archiveUrl,
    sendAt,
    dispatchHold,
    nextEligibleAt: dispatchHold ? sendAt : null,
    idempotencyScope: present && campaignId && audienceId
      ? `mailchimp:${audienceId}:${campaignId}`
      : null,
    persistedStatePatch: present ? {
      mailchimpCampaignId: campaignId,
      mailchimpAudienceId: audienceId,
      mailchimpTemplateId: templateId,
      mailchimpArchiveUrl: archiveUrl,
      mailchimpSendAt: sendAt
    } : null,
    proofRefs: [
      campaignId ? `mailchimp:campaign:${campaignId}` : null,
      audienceId ? `mailchimp:audience:${audienceId}` : null,
      templateId ? `mailchimp:template:${templateId}` : null,
      archiveUrl
    ].filter(Boolean),
    validationIssues
  };
}

function buildMailchimpDispatchAnalytics({ mailchimpDispatchContext, readiness, acceptance, generatedAt, historySnapshots }) {
  if (!mailchimpDispatchContext.present) {
    return {
      contract: 'NotifierRecordMailchimpDispatchAnalyticsV1',
      present: false,
      status: 'not-applicable',
      counters: {
        campaignBound: 0,
        audienceBound: 0,
        templateBound: 0,
        proofRefCount: 0,
        validationIssueCount: 0,
        sendWindowHoldActive: 0,
        acceptedForDispatch: acceptance.acceptedForDispatch ? 1 : 0
      },
      historySnapshot: null,
      exportRowPatch: {},
      reportingPatch: {},
      exportBatch: null
    };
  }

  const blocked = mailchimpDispatchContext.validationIssues.some((issue) => issue.severity === 'error');
  const status = blocked
    ? 'blocked'
    : mailchimpDispatchContext.dispatchHold
      ? 'send-window-held'
      : acceptance.acceptedForDispatch && readiness.canDispatch
        ? 'dispatch-ready'
        : acceptance.acceptedForDispatch
          ? 'accepted'
          : 'awaiting-acceptance';
  const priorMailchimpSnapshots = historySnapshots.filter((snapshot) => snapshot.source === 'mailchimp-dispatch-runtime');
  const historySnapshot = {
    contract: 'NotifierRecordHistorySnapshotV1',
    sequence: historySnapshots.reduce((max, snapshot) => Math.max(max, snapshot.sequence), 0) + 2,
    status,
    event: 'mailchimp-dispatch-context-computed',
    capturedAt: generatedAt,
    actor: null,
    recordId: mailchimpDispatchContext.idempotencyScope,
    issueCount: mailchimpDispatchContext.validationIssues.length,
    blockingIssueCount: mailchimpDispatchContext.validationIssues.filter((issue) => issue.severity === 'error').length,
    recipientCount: 0,
    evidenceCount: mailchimpDispatchContext.proofRefs.length,
    retryCount: 0,
    source: 'mailchimp-dispatch-runtime',
    campaignId: mailchimpDispatchContext.campaignId,
    audienceId: mailchimpDispatchContext.audienceId,
    nextEligibleAt: mailchimpDispatchContext.nextEligibleAt
  };
  const exportRowPatch = {
    mailchimpPresent: true,
    mailchimpStatus: status,
    mailchimpCampaignId: mailchimpDispatchContext.campaignId,
    mailchimpAudienceId: mailchimpDispatchContext.audienceId,
    mailchimpTemplateId: mailchimpDispatchContext.templateId,
    mailchimpSendAt: mailchimpDispatchContext.sendAt,
    mailchimpArchiveUrl: mailchimpDispatchContext.archiveUrl,
    mailchimpProofRefCount: mailchimpDispatchContext.proofRefs.length,
    mailchimpDispatchHold: mailchimpDispatchContext.dispatchHold,
    mailchimpIdempotencyScope: mailchimpDispatchContext.idempotencyScope
  };

  return {
    contract: 'NotifierRecordMailchimpDispatchAnalyticsV1',
    present: true,
    status,
    counters: {
      campaignBound: mailchimpDispatchContext.campaignId ? 1 : 0,
      audienceBound: mailchimpDispatchContext.audienceId ? 1 : 0,
      templateBound: mailchimpDispatchContext.templateId ? 1 : 0,
      proofRefCount: mailchimpDispatchContext.proofRefs.length,
      validationIssueCount: mailchimpDispatchContext.validationIssues.length,
      sendWindowHoldActive: mailchimpDispatchContext.dispatchHold ? 1 : 0,
      acceptedForDispatch: acceptance.acceptedForDispatch ? 1 : 0,
      priorRuntimeSnapshotCount: priorMailchimpSnapshots.length
    },
    historySnapshot,
    exportRowPatch,
    reportingPatch: {
      mailchimpStatus: status,
      mailchimpCampaignId: mailchimpDispatchContext.campaignId,
      mailchimpAudienceId: mailchimpDispatchContext.audienceId,
      mailchimpDispatchHold: mailchimpDispatchContext.dispatchHold,
      mailchimpNextEligibleAt: mailchimpDispatchContext.nextEligibleAt
    },
    exportBatch: {
      name: 'notifier-record-mailchimp-dispatch',
      route: '/kernel/audit-recovery/notifier-record/analytics/mailchimp-dispatch',
      method: 'PUT',
      payloadContract: 'NotifierRecordMailchimpDispatchAnalyticsV1',
      idempotencyKey: `${surfaceId}:${mailchimpDispatchContext.idempotencyScope || 'unbound-mailchimp'}:mailchimp-dispatch:${generatedAt}`,
      rows: [{
        generatedAt,
        status,
        ...exportRowPatch,
        proofRefs: mailchimpDispatchContext.proofRefs,
        persistedStatePatch: mailchimpDispatchContext.persistedStatePatch
      }]
    }
  };
}

function buildMailchimpDispatchHandoffGate({
  mailchimpDispatchContext,
  evidence,
  boundaryAuthorization,
  providerContracts,
  lifecycleControls,
  clientHandoffState,
  generatedAt
}) {
  if (!mailchimpDispatchContext.present) {
    return {
      contract: 'NotifierRecordMailchimpDispatchHandoffGateV1',
      present: false,
      status: 'not-applicable',
      dispatchAllowed: true,
      proofRefsSatisfied: true,
      providerHandoffReady: true,
      blockers: [],
      nextAction: null,
      routeContract: null
    };
  }

  const evidenceRefs = new Set(evidence.flatMap((item) => [
    item.id,
    item.uri,
    item.label,
    item.kind === 'audit-artifact' ? item.id : null
  ].filter(Boolean)));
  const missingProofRefs = mailchimpDispatchContext.proofRefs
    .filter((ref) => !evidenceRefs.has(ref));
  const providerHandoffReady = providerContracts.externalHandoffState.state === 'ready'
    || providerContracts.externalHandoffState.state === 'client-consumed'
    || providerContracts.capabilityNegotiation.handoffState === 'remote-ready';
  const providerSyncBlocked = providerContracts.capabilityNegotiation.syncBarrierRequired;
  const boundaryBlocked = !boundaryAuthorization.authorizedForDispatch;
  const lifecycleBlocked = !lifecycleControls.dispatchEnabled || lifecycleControls.scheduleActive;
  const proofRefsSatisfied = missingProofRefs.length === 0;
  const blockers = [
    boundaryBlocked ? {
      code: 'mailchimp_dispatch_boundary_blocked',
      severity: 'error',
      field: 'boundaryAuthorization',
      reason: boundaryAuthorization.deniedReasons[0] || boundaryAuthorization.decision
    } : null,
    lifecycleBlocked ? {
      code: lifecycleControls.scheduleActive
        ? 'mailchimp_dispatch_lifecycle_scheduled'
        : 'mailchimp_dispatch_lifecycle_disabled',
      severity: lifecycleControls.scheduleActive ? 'warning' : 'error',
      field: 'lifecycleControls',
      reason: lifecycleControls.nextEligibleAt || lifecycleControls.commandPolicy
    } : null,
    !proofRefsSatisfied ? {
      code: 'mailchimp_dispatch_proof_refs_missing',
      severity: 'error',
      field: 'evidence',
      missingProofRefs
    } : null,
    !providerContracts.ready ? {
      code: 'mailchimp_dispatch_provider_contract_blocked',
      severity: 'error',
      field: 'providerContracts',
      blockedRoles: providerContracts.blockedRoles
    } : null,
    providerSyncBlocked ? {
      code: 'mailchimp_dispatch_provider_sync_required',
      severity: 'warning',
      field: 'providerContracts.capabilityNegotiation',
      requiredSyncRoles: providerContracts.capabilityNegotiation.requiredSyncRoles
    } : null,
    !providerHandoffReady ? {
      code: 'mailchimp_dispatch_external_handoff_not_ready',
      severity: 'error',
      field: 'providerContracts.externalHandoffState',
      state: providerContracts.externalHandoffState.state,
      negotiationState: providerContracts.externalHandoffState.negotiationState
    } : null
  ].filter(Boolean);
  const hardBlockers = blockers.filter((blocker) => blocker.severity === 'error');
  const status = hardBlockers.length
    ? 'blocked'
    : mailchimpDispatchContext.dispatchHold
      ? 'held-for-send-window'
      : providerSyncBlocked
        ? 'sync-before-dispatch'
        : 'ready';
  const dispatchAllowed = status === 'ready';
  const nextAction = dispatchAllowed
    ? {
        action: 'dispatch-mailchimp-notification',
        route: '/kernel/audit-recovery/notifier-record/dispatch/mailchimp',
        method: 'POST',
        reason: 'Mailchimp dispatch scope, proof refs, provider handoff, and lifecycle gates are ready.'
      }
    : status === 'held-for-send-window'
      ? {
          action: 'wait-for-mailchimp-send-window',
          route: '/kernel/audit-recovery/notifier-record/lifecycle',
          method: 'GET',
          reason: mailchimpDispatchContext.nextEligibleAt
        }
      : providerSyncBlocked
        ? {
            action: 'sync-provider-before-mailchimp-dispatch',
            route: providerContracts.externalHandoffState.route,
            method: 'PATCH',
            reason: providerContracts.capabilityNegotiation.requiredSyncRoles.join(',')
          }
        : {
            action: 'repair-mailchimp-dispatch-handoff',
            route: '/kernel/audit-recovery/notifier-record/preview',
            method: 'PATCH',
            reason: hardBlockers[0]?.code || blockers[0]?.code || 'mailchimp_dispatch_blocked'
          };

  return {
    contract: 'NotifierRecordMailchimpDispatchHandoffGateV1',
    present: true,
    checkedAt: generatedAt,
    status,
    dispatchAllowed,
    proofRefsSatisfied,
    missingProofRefs,
    boundaryDecision: boundaryAuthorization.decision,
    lifecycleMode: lifecycleControls.mode,
    lifecycleNextEligibleAt: lifecycleControls.nextEligibleAt,
    providerHandoffReady,
    providerHandoffState: providerContracts.externalHandoffState.state,
    providerNegotiationState: providerContracts.capabilityNegotiation.handoffState,
    providerSyncBlocked,
    clientResumeToken: clientHandoffState.resumeToken,
    idempotencyScope: mailchimpDispatchContext.idempotencyScope,
    proofPartition: boundaryAuthorization.proofPartition.route,
    blockers,
    blockerCodes: blockers.map((blocker) => blocker.code),
    nextAction,
    routeContract: {
      route: nextAction.route,
      method: nextAction.method,
      enabled: dispatchAllowed,
      disabledReasons: dispatchAllowed ? [] : blockers.map((blocker) => blocker.code),
      bodyContract: 'NotifierRecordMailchimpDispatchHandoffRequestV1',
      body: {
        campaignId: mailchimpDispatchContext.campaignId,
        audienceId: mailchimpDispatchContext.audienceId,
        templateId: mailchimpDispatchContext.templateId,
        idempotencyScope: mailchimpDispatchContext.idempotencyScope,
        resumeToken: clientHandoffState.resumeToken,
        proofRefs: mailchimpDispatchContext.proofRefs,
        proofPartition: boundaryAuthorization.proofPartition.route
      }
    }
  };
}

function buildBoundaryAuthorization({ recipients, evidence, requestContext, boundaryContext, persistedState, generatedAt }) {
  const recipientBoundaryViolations = recipients.flatMap((recipient) => {
    const violations = [];
    if (recipient.tenantId && boundaryContext.tenantId && recipient.tenantId !== boundaryContext.tenantId) {
      violations.push({ kind: 'recipient', id: recipient.id, code: 'recipient_tenant_mismatch', expected: boundaryContext.tenantId, actual: recipient.tenantId });
    }
    if (recipient.workspaceId && boundaryContext.workspaceId && recipient.workspaceId !== boundaryContext.workspaceId) {
      violations.push({ kind: 'recipient', id: recipient.id, code: 'recipient_workspace_mismatch', expected: boundaryContext.workspaceId, actual: recipient.workspaceId });
    }
    return violations;
  });
  const evidenceBoundaryViolations = evidence.flatMap((item) => {
    const violations = [];
    if (item.tenantId && boundaryContext.tenantId && item.tenantId !== boundaryContext.tenantId) {
      violations.push({ kind: 'evidence', id: item.id, code: 'evidence_tenant_mismatch', expected: boundaryContext.tenantId, actual: item.tenantId });
    }
    if (item.workspaceId && boundaryContext.workspaceId && item.workspaceId !== boundaryContext.workspaceId) {
      violations.push({ kind: 'evidence', id: item.id, code: 'evidence_workspace_mismatch', expected: boundaryContext.workspaceId, actual: item.workspaceId });
    }
    return violations;
  });
  const persistedBoundaryViolations = [
    persistedState.boundary.tenantId && boundaryContext.tenantId && persistedState.boundary.tenantId !== boundaryContext.tenantId
      ? { kind: 'persisted-state', id: persistedState.snapshotRecordId || 'persisted-state', code: 'persisted_tenant_mismatch', expected: boundaryContext.tenantId, actual: persistedState.boundary.tenantId }
      : null,
    persistedState.boundary.workspaceId && boundaryContext.workspaceId && persistedState.boundary.workspaceId !== boundaryContext.workspaceId
      ? { kind: 'persisted-state', id: persistedState.snapshotRecordId || 'persisted-state', code: 'persisted_workspace_mismatch', expected: boundaryContext.workspaceId, actual: persistedState.boundary.workspaceId }
      : null
  ].filter(Boolean);
  const missingScope = [
    boundaryContext.tenantId ? null : 'tenant_missing',
    boundaryContext.workspaceId ? null : 'workspace_missing'
  ].filter(Boolean);
  const workspaceDenied = Boolean(boundaryContext.workspaceId && !boundaryContext.allowedWorkspaceIds.includes(boundaryContext.workspaceId));
  const deniedReasons = [
    ...missingScope,
    ...(workspaceDenied ? ['workspace_not_allowed'] : []),
    ...(boundaryContext.dispatchAllowed ? [] : ['dispatch_permission_missing']),
    ...persistedBoundaryViolations.map((violation) => violation.code),
    ...recipientBoundaryViolations.map((violation) => violation.code),
    ...evidenceBoundaryViolations.map((violation) => violation.code)
  ];
  const scopeBound = Boolean(boundaryContext.tenantId && boundaryContext.workspaceId && !workspaceDenied);
  const tenantIsolated = scopeBound && persistedBoundaryViolations.length === 0 && recipientBoundaryViolations.length === 0 && evidenceBoundaryViolations.length === 0;
  const dispatchAuthorized = tenantIsolated && boundaryContext.dispatchAllowed;

  return {
    contract: 'NotifierRecordBoundaryAuthorizationV1',
    evaluatedAt: generatedAt,
    actor: requestContext.actor,
    tenantId: boundaryContext.tenantId,
    workspaceId: boundaryContext.workspaceId,
    scopeStatus: tenantIsolated ? 'tenant-workspace-isolated' : scopeBound ? 'scope-conflict' : 'scope-unbound',
    decision: dispatchAuthorized ? 'allow-dispatch' : tenantIsolated ? 'allow-review-only' : 'deny-boundary',
    authorizedForPersist: tenantIsolated,
    authorizedForDispatch: dispatchAuthorized,
    authorizedForProof: dispatchAuthorized && boundaryContext.auditHandoffAllowed,
    auditHandoffAllowed: dispatchAuthorized && boundaryContext.auditHandoffAllowed,
    dispatchAllowedByRoleOrPermission: boundaryContext.dispatchAllowed,
    explicitWorkspaceAllowList: boundaryContext.explicitWorkspaceAllowList,
    allowedWorkspaceIds: boundaryContext.allowedWorkspaceIds,
    deniedReasons,
    boundaryViolations: [
      ...persistedBoundaryViolations,
      ...recipientBoundaryViolations,
      ...evidenceBoundaryViolations
    ],
    proofPartition: {
      tenantId: boundaryContext.tenantId,
      workspaceId: boundaryContext.workspaceId,
      route: `/kernel/audit-recovery/notifier-record/proof/${boundaryContext.tenantId || 'unbound'}/${boundaryContext.workspaceId || 'unbound'}`
    }
  };
}

function summarizeValidation({ recordId, severity, recipients, evidence, recoveryAction, requestContext, boundaryContext, boundaryAuthorization, persistedState, lifecycleControls, clientHandoffState, providerContracts, mailchimpDispatchContext, mailchimpDispatchGate }) {
  const issues = [];
  if (!recordId) issues.push({ code: 'record_id_missing', field: 'recordId', severity: 'error' });
  if (!severity) issues.push({ code: 'severity_missing', field: 'severity', severity: 'error' });
  if (recipients.length === 0) issues.push({ code: 'recipient_missing', field: 'recipients', severity: 'error' });
  if (evidence.length === 0) issues.push({ code: 'evidence_missing', field: 'evidence', severity: 'warning' });
  if (!recoveryAction) issues.push({ code: 'recovery_action_missing', field: 'recoveryAction', severity: 'warning' });
  if (!requestContext.actor) issues.push({ code: 'actor_missing', field: 'actor', severity: 'warning' });
  if (!requestContext.sessionId) issues.push({ code: 'session_missing', field: 'sessionId', severity: 'warning' });
  if (!boundaryContext.tenantId) issues.push({ code: 'tenant_missing', field: 'tenantId', severity: 'error' });
  if (!boundaryContext.workspaceId) issues.push({ code: 'workspace_missing', field: 'workspaceId', severity: 'error' });
  if (boundaryContext.workspaceId && !boundaryContext.allowedWorkspaceIds.includes(boundaryContext.workspaceId)) {
    issues.push({ code: 'workspace_not_allowed', field: 'workspaceId', severity: 'error' });
  }
  if (!boundaryContext.dispatchAllowed) {
    issues.push({ code: 'dispatch_permission_missing', field: 'permissions', severity: 'error' });
  }
  for (const deniedReason of boundaryAuthorization.deniedReasons) {
    if (!issues.some((issue) => issue.code === deniedReason)) {
      issues.push({ code: deniedReason, field: 'boundaryAuthorization', severity: 'error' });
    }
  }
  if (persistedState.boundary.tenantId && boundaryContext.tenantId && persistedState.boundary.tenantId !== boundaryContext.tenantId) {
    issues.push({ code: 'persisted_tenant_mismatch', field: 'tenantId', severity: 'error' });
  }
  if (persistedState.boundary.workspaceId && boundaryContext.workspaceId && persistedState.boundary.workspaceId !== boundaryContext.workspaceId) {
    issues.push({ code: 'persisted_workspace_mismatch', field: 'workspaceId', severity: 'error' });
  }
  for (const issue of lifecycleControls.validationIssues) {
    issues.push(issue);
  }
  for (const issue of clientHandoffState.validationIssues) {
    issues.push(issue);
  }
  for (const issue of providerContracts.validationIssues) {
    issues.push(issue);
  }
  for (const issue of mailchimpDispatchContext?.validationIssues || []) {
    issues.push(issue);
  }
  for (const blocker of mailchimpDispatchGate?.blockers || []) {
    issues.push({
      code: blocker.code,
      field: blocker.field || 'mailchimpDispatchGate',
      severity: blocker.severity,
      reason: blocker.reason,
      missingProofRefs: blocker.missingProofRefs,
      blockedRoles: blocker.blockedRoles,
      requiredSyncRoles: blocker.requiredSyncRoles
    });
  }
  if (mailchimpDispatchContext?.dispatchHold) {
    issues.push({
      code: 'mailchimp_campaign_send_window_pending',
      field: 'mailchimp.sendAt',
      severity: 'warning',
      nextEligibleAt: mailchimpDispatchContext.nextEligibleAt
    });
  }

  for (const recipient of recipients) {
    if (recipient.tenantId && boundaryContext.tenantId && recipient.tenantId !== boundaryContext.tenantId) {
      issues.push({ code: 'recipient_tenant_mismatch', field: 'recipients', severity: 'error', recipientId: recipient.id });
    }
    if (recipient.workspaceId && boundaryContext.workspaceId && recipient.workspaceId !== boundaryContext.workspaceId) {
      issues.push({ code: 'recipient_workspace_mismatch', field: 'recipients', severity: 'error', recipientId: recipient.id });
    }
  }

  for (const item of evidence) {
    if (item.tenantId && boundaryContext.tenantId && item.tenantId !== boundaryContext.tenantId) {
      issues.push({ code: 'evidence_tenant_mismatch', field: 'evidence', severity: 'error', evidenceId: item.id });
    }
    if (item.workspaceId && boundaryContext.workspaceId && item.workspaceId !== boundaryContext.workspaceId) {
      issues.push({ code: 'evidence_workspace_mismatch', field: 'evidence', severity: 'error', evidenceId: item.id });
    }
  }

  return {
    valid: !issues.some((issue) => issue.severity === 'error'),
    issueCount: issues.length,
    blockingIssueCount: issues.filter((issue) => issue.severity === 'error').length,
    issues
  };
}

function resolveRecoveredDraft({ input, persistedState }) {
  return {
    recordId: firstNonEmptyString(input.recordId, input.auditRecordId, persistedState.snapshotRecordId),
    severity: firstNonEmptyString(input.severity, persistedState.snapshotSeverity),
    title: asNonEmptyString(input.title),
    summary: asNonEmptyString(input.summary),
    recoveryAction: firstNonEmptyString(input.recoveryAction, persistedState.snapshotRecoveryAction),
    accepted: input.accepted === undefined ? persistedState.snapshotAccepted : Boolean(input.accepted),
    acknowledgements: uniqueStrings(input.acknowledgements).length > 0
      ? uniqueStrings(input.acknowledgements)
      : persistedState.snapshotAcknowledgements
  };
}

function buildPreview({ recordId, severity, title, summary, recipients, evidence, generatedAt, requestContext, boundaryContext }) {
  const previewLines = [
    `[${severity || 'unclassified'}] ${title || 'Audit recovery notification'}`,
    summary || 'No operator summary provided.',
    `Record: ${recordId || 'pending-record-id'}`,
    `Tenant/workspace: ${boundaryContext.tenantId || 'unbound'} / ${boundaryContext.workspaceId || 'unbound'}`,
    `Recipients: ${recipients.map((recipient) => `${recipient.label} via ${recipient.channel}`).join(', ') || 'none'}`,
    `Evidence items: ${evidence.length}`,
    `Requested by: ${requestContext.actor || 'unassigned-operator'}`,
    `Session: ${requestContext.sessionId || 'not-bound'}`,
    `Generated: ${generatedAt}`
  ];

  return {
    format: 'text/plain',
    headline: previewLines[0],
    body: previewLines.join('\n'),
    recipientCount: recipients.length,
    evidenceCount: evidence.length
  };
}

function buildAcceptance({ accepted, acknowledgements, validation, requestContext, persistedState }) {
  const missingAcknowledgements = REQUIRED_ACKNOWLEDGEMENTS.filter((ack) => !acknowledgements.includes(ack));
  const acceptedForDispatch = Boolean(accepted) && validation.valid && missingAcknowledgements.length === 0;
  const preservedTerminalDispatch = persistedState.terminal && validation.valid;

  return {
    acceptedForDispatch: acceptedForDispatch || preservedTerminalDispatch,
    acceptedByOperator: Boolean(accepted),
    acceptedBy: acceptedForDispatch || preservedTerminalDispatch ? requestContext.actor : null,
    acceptedSessionId: acceptedForDispatch || preservedTerminalDispatch ? requestContext.sessionId : null,
    preservedTerminalDispatch,
    requiredAcknowledgements: REQUIRED_ACKNOWLEDGEMENTS,
    receivedAcknowledgements: acknowledgements,
    missingAcknowledgements,
    blockedReasons: [
      ...validation.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.code),
      ...missingAcknowledgements.map((ack) => `missing_ack:${ack}`),
      ...(accepted || preservedTerminalDispatch ? [] : ['operator_acceptance_missing'])
    ]
  };
}

function buildRestartSafeReadiness({ acceptance, validation, generatedAt, persistedState, operationalHealth, lifecycleControls, providerContracts, boundaryAuthorization, mailchimpDispatchContext, mailchimpDispatchGate }) {
  let status = 'needs-revision';
  if (acceptance.acceptedForDispatch) {
    if (persistedState.status === 'proof-persisted') {
      status = 'proof-persisted';
    } else if (persistedState.status === 'dispatch-recorded') {
      status = 'dispatch-recorded';
    } else if (!lifecycleControls.dispatchEnabled) {
      status = lifecycleControls.mode === 'paused' ? 'dispatch-paused' : 'dispatch-disabled';
    } else if (lifecycleControls.scheduleActive) {
      status = 'dispatch-scheduled';
    } else if (mailchimpDispatchContext?.dispatchHold) {
      status = 'dispatch-scheduled';
    } else if (operationalHealth.circuitOpen) {
      status = 'dispatch-blocked';
    } else if (operationalHealth.retryDelayed) {
      status = 'dispatch-blocked';
    } else if (!boundaryAuthorization.authorizedForDispatch) {
      status = boundaryAuthorization.decision === 'deny-boundary' ? 'boundary-blocked' : 'permission-blocked';
    } else if (!providerContracts.ready) {
      status = 'provider-contract-blocked';
    } else if (mailchimpDispatchGate?.present && !mailchimpDispatchGate.dispatchAllowed) {
      status = mailchimpDispatchGate.status === 'held-for-send-window'
        ? 'dispatch-scheduled'
        : mailchimpDispatchGate.status === 'sync-before-dispatch'
          ? 'provider-contract-blocked'
          : 'dispatch-blocked';
    } else if (operationalHealth.degradedMode) {
      status = 'degraded-dispatch-ready';
    } else {
      status = 'ready';
    }
  } else if (validation.valid) {
    status = 'awaiting-acceptance';
  }

  return {
    status,
    persistedStatus: persistedState.status || 'not-persisted',
    restartSafe: persistedState.recovered ? validation.valid || validation.blockingIssueCount === 0 : true,
    recoveredFromState: persistedState.recovered,
    canPreview: true,
    canAccept: validation.valid && !persistedState.terminal,
    canDispatch: acceptance.acceptedForDispatch && boundaryAuthorization.authorizedForDispatch && lifecycleControls.dispatchEnabled && !lifecycleControls.scheduleActive && !mailchimpDispatchContext?.dispatchHold && (mailchimpDispatchGate?.dispatchAllowed !== false) && !operationalHealth.circuitOpen && !operationalHealth.retryDelayed && providerContracts.ready && persistedState.status !== 'dispatch-recorded' && persistedState.status !== 'proof-persisted',
    lifecycleMode: lifecycleControls.mode,
    dispatchEnabled: lifecycleControls.dispatchEnabled,
    scheduledDispatch: lifecycleControls.scheduleActive || Boolean(mailchimpDispatchContext?.dispatchHold),
    nextEligibleAt: mailchimpDispatchContext?.nextEligibleAt || lifecycleControls.nextEligibleAt,
    degradedMode: operationalHealth.degradedMode,
    circuitOpen: operationalHealth.circuitOpen,
    retryableFailure: operationalHealth.retryableFailure,
    retryWindowOpen: operationalHealth.retryWindowOpen,
    retryDelayed: operationalHealth.retryDelayed,
    retryAt: operationalHealth.retryAt,
    nextBackoffMs: operationalHealth.nextBackoffMs,
    failureState: operationalHealth.failureState.state,
    boundaryAuthorizationDecision: boundaryAuthorization.decision,
    boundaryScopeStatus: boundaryAuthorization.scopeStatus,
    boundaryDeniedReasons: boundaryAuthorization.deniedReasons,
    providerContractsReady: providerContracts.ready,
    mailchimpDispatchContext,
    mailchimpDispatchGate,
    blockedProviderRoles: providerContracts.blockedRoles,
    boundaryBlockedProviderRoles: providerContracts.boundaryBlockedRoles,
    unavailableProviderRoles: providerContracts.unavailableRoles,
    providerSyncRequiredRoles: providerContracts.syncRequiredRoles,
    providerNegotiationState: providerContracts.capabilityNegotiation.handoffState,
    checkedAt: generatedAt
  };
}

function buildPersistedStateEnvelope({ recordId, severity, title, summary, recoveryAction, recipients, evidence, generatedAt, requestContext, persistedState, boundaryContext, boundaryAuthorization, validation, acceptance, readiness, operationalHealth, lifecycleControls, providerContracts, clientHandoffState, uiReview }) {
  const stateKey = recordId
    ? `${surfaceId}:state:${boundaryContext.tenantId || 'unbound'}:${boundaryContext.workspaceId || 'unbound'}:${recordId}`
    : `${surfaceId}:state:${boundaryContext.tenantId || 'unbound'}:${boundaryContext.workspaceId || 'unbound'}:pending`;
  const canonicalStatus = RESTART_SAFE_STATUSES.includes(readiness.status)
    ? readiness.status
    : validation.valid ? 'awaiting-acceptance' : 'draft-restored';
  const terminal = TERMINAL_PERSISTED_STATUSES.includes(canonicalStatus) || persistedState.terminal;
  const restoreMode = terminal
    ? 'terminal-read-only'
    : persistedState.recovered
      ? readiness.canDispatch ? 'resume-dispatch' : 'resume-review'
      : 'new-draft';
  const blockedRecoveryCodes = uniqueStrings([
    ...validation.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.code),
    ...boundaryAuthorization.deniedReasons,
    ...(operationalHealth.circuitOpen ? ['operational_circuit_open'] : []),
    ...(operationalHealth.retryDelayed ? ['retry_window_not_open'] : []),
    ...operationalHealth.validationIssues.filter((issue) => issue.severity === 'error').map((issue) => issue.code),
    ...providerContracts.blockedRoles.map((role) => `provider:${role}`)
  ]);
  const replayGuards = {
    contract: 'NotifierRecordPersistedReplayGuardsV1',
    completedCommandIds: persistedState.completedCommandIds,
    completedIdempotencyKeys: persistedState.completedIdempotencyKeys,
    completedCommandOperations: persistedState.completedCommandOperations,
    completedOperationReplayKeys: persistedState.completedOperationReplayKeys,
    lastCommandId: persistedState.lastCommandId,
    lastCommandStatus: persistedState.lastCommandStatus,
    preserveTerminalStatus: terminal,
    rejectDispatchReplay: terminal || commandLedgerHasOperation(persistedState, 'dispatch'),
    rejectProofReplay: canonicalStatus === 'proof-persisted' || commandLedgerHasOperation(persistedState, 'persist-proof'),
    allowDraftOverwrite: !terminal && boundaryAuthorization.authorizedForPersist,
    allowLifecycleOverwrite: !terminal && boundaryAuthorization.authorizedForPersist,
    recoveredOperationSemantics: {
      contract: 'NotifierRecordRecoveredOperationReplaySemanticsV1',
      recognizedOperations: Object.keys(COMMAND_OPERATION_ALIASES),
      dispatchCompleted: commandLedgerHasOperation(persistedState, 'dispatch'),
      proofCompleted: commandLedgerHasOperation(persistedState, 'persist-proof'),
      statePersisted: commandLedgerHasOperation(persistedState, 'persist-state'),
      lifecycleApplied: commandLedgerHasOperation(persistedState, 'apply-lifecycle')
    }
  };
  const recoveryPaths = [
    {
      contract: 'NotifierRecordRecoveryPathV1',
      path: 'restore-draft',
      enabled: !terminal,
      nextStatus: validation.valid ? 'awaiting-acceptance' : 'draft-restored',
      route: '/kernel/audit-recovery/notifier-record/state',
      method: 'PUT'
    },
    {
      contract: 'NotifierRecordRecoveryPathV1',
      path: 'resume-dispatch',
      enabled: readiness.canDispatch && !replayGuards.rejectDispatchReplay,
      nextStatus: readiness.status,
      route: '/kernel/audit-recovery/notifier-record/dispatch',
      method: 'POST'
    },
    {
      contract: 'NotifierRecordRecoveryPathV1',
      path: 'open-proof',
      enabled: terminal,
      nextStatus: canonicalStatus,
      route: '/kernel/audit-recovery/notifier-record/proof',
      method: 'GET'
    },
    {
      contract: 'NotifierRecordRecoveryPathV1',
      path: 'negotiate-providers',
      enabled: !providerContracts.ready && !terminal,
      nextStatus: 'provider-contract-blocked',
      route: '/kernel/audit-recovery/notifier-record/providers',
      method: 'PATCH'
    }
  ];

  return {
    contract: 'NotifierRecordPersistedStateEnvelopeV1',
    version: persistedState.version,
    stateKey,
    generatedAt,
    status: canonicalStatus,
    previousStatus: persistedState.status,
    restartSafe: readiness.restartSafe && !blockedRecoveryCodes.includes('tenant_missing') && !blockedRecoveryCodes.includes('workspace_missing'),
    recovered: persistedState.recovered,
    restoreMode,
    terminal,
    revisionSeed: `${stateKey}:${canonicalStatus}:${persistedState.commandCount}:${acceptance.acceptedForDispatch ? 'accepted' : 'pending'}`,
    statusSemantics: {
      contract: 'NotifierRecordRestartSafeStatusSemanticsV1',
      readOnly: terminal,
      canResumeReview: !terminal,
      canResumeDispatch: readiness.canDispatch && !replayGuards.rejectDispatchReplay,
      canPersistProof: acceptance.acceptedForDispatch && !replayGuards.rejectProofReplay,
      visibleStatus: canonicalStatus,
      operatorAction: uiReview.nextAction.action
    },
    snapshot: {
      contract: 'NotifierRecordPersistedSnapshotV1',
      surfaceId,
      recordId,
      severity: severity || 'unclassified',
      title,
      summary,
      recoveryAction,
      tenantId: boundaryContext.tenantId,
      workspaceId: boundaryContext.workspaceId,
      recipients: recipients.map((recipient) => ({ id: recipient.id, channel: recipient.channel, label: recipient.label })),
      evidence: evidence.map((item) => ({ id: item.id, kind: item.kind, label: item.label, uri: item.uri || null })),
      accepted: acceptance.acceptedForDispatch,
      acknowledgements: acceptance.receivedAcknowledgements,
      readinessStatus: readiness.status,
      lifecycleMode: lifecycleControls.mode,
      schedulingMode: lifecycleControls.schedulingMode,
      handoffIntent: clientHandoffState.intent,
      resumeToken: clientHandoffState.resumeToken,
      traceId: requestContext.traceId,
      actor: requestContext.actor,
      generatedAt
    },
    replayGuards,
    recoveredCommandLedger: persistedState.commandLedger,
    recoveryPaths,
    blockedRecoveryCodes
  };
}

function commandDisabledReason(commandName, { acceptance, readiness, persistedState, operationalHealth, lifecycleControls, providerContracts, boundaryAuthorization }) {
  if (commandName === 'apply-lifecycle' && !lifecycleControls.lifecycleCommand.command) return 'lifecycle-command-missing';
  if (commandName === 'apply-lifecycle' && !lifecycleControls.lifecycleCommand.accepted) return 'lifecycle-command-invalid';
  if (commandName === 'apply-lifecycle' && !boundaryAuthorization.authorizedForPersist) return 'boundary-authorization-denied';
  if (commandName === 'apply-lifecycle' && providerContracts.boundaryBlockedRoles.includes('state-store')) return 'provider-boundary-policy-blocked';
  if (commandName === 'apply-lifecycle' && !providerContracts.descriptorByRole['state-store'].available) return 'state-store-provider-unavailable';
  if (commandName === 'apply-lifecycle' && persistedState.status === 'proof-persisted') return 'proof-already-persisted';
  if (commandName === 'apply-lifecycle' && persistedState.terminal) return 'terminal-state-read-only';
  if (commandName === 'persist-state' && readiness.status === 'proof-persisted') return 'proof-already-persisted';
  if (commandName === 'persist-state' && !boundaryAuthorization.authorizedForPersist) return 'boundary-authorization-denied';
  if (commandName === 'persist-state' && providerContracts.boundaryBlockedRoles.includes('state-store')) return 'provider-boundary-policy-blocked';
  if (commandName === 'persist-state' && !providerContracts.descriptorByRole['state-store'].available) return 'state-store-provider-unavailable';
  if (commandName === 'persist-state' && persistedState.terminal) return 'terminal-state-read-only';
  if (commandName === 'dispatch' && !acceptance.acceptedForDispatch) return 'operator-acceptance-required';
  if (commandName === 'dispatch' && !boundaryAuthorization.authorizedForDispatch) return boundaryAuthorization.decision === 'allow-review-only' ? 'dispatch-permission-missing' : 'boundary-authorization-denied';
  if (commandName === 'dispatch' && !lifecycleControls.dispatchEnabled) return lifecycleControls.mode === 'paused' ? 'lifecycle-paused' : 'lifecycle-disabled';
  if (commandName === 'dispatch' && lifecycleControls.scheduleActive) return 'scheduled-window-not-open';
  if (commandName === 'dispatch' && operationalHealth.circuitOpen) return 'operational-circuit-open';
  if (commandName === 'dispatch' && operationalHealth.retryDelayed) return 'retry-window-not-open';
  if (commandName === 'dispatch' && providerContracts.boundaryBlockedRoles.length > 0) return 'provider-boundary-policy-blocked';
  if (commandName === 'dispatch' && !providerContracts.descriptorByRole['notification-dispatcher'].available) return 'notification-dispatcher-provider-unavailable';
  if (commandName === 'dispatch' && providerContracts.blockedRoles.length > 0) return providerContracts.syncRequiredRoles.length > 0 ? 'provider-sync-barrier-required' : 'provider-contract-blocked';
  if (commandName === 'dispatch' && persistedState.status === 'dispatch-recorded') return 'dispatch-already-recorded';
  if (commandName === 'dispatch' && persistedState.status === 'proof-persisted') return 'proof-already-persisted';
  if (commandName === 'dispatch' && commandLedgerHasOperation(persistedState, 'dispatch')) return 'dispatch-replay-already-completed';
  if (commandName === 'persist-proof' && !acceptance.acceptedForDispatch) return 'operator-acceptance-required';
  if (commandName === 'persist-proof' && !boundaryAuthorization.authorizedForProof) return boundaryAuthorization.decision === 'allow-review-only' ? 'dispatch-permission-missing' : 'boundary-authorization-denied';
  if (commandName === 'persist-proof' && !lifecycleControls.proofPersistenceEnabled) return 'proof-persistence-disabled';
  if (commandName === 'persist-proof' && lifecycleControls.scheduleActive) return 'scheduled-window-not-open';
  if (commandName === 'persist-proof' && operationalHealth.circuitOpen) return 'operational-circuit-open';
  if (commandName === 'persist-proof' && operationalHealth.retryDelayed) return 'retry-window-not-open';
  if (commandName === 'persist-proof' && providerContracts.boundaryBlockedRoles.length > 0) return 'provider-boundary-policy-blocked';
  if (commandName === 'persist-proof' && !providerContracts.descriptorByRole['proof-store'].available) return 'proof-store-provider-unavailable';
  if (commandName === 'persist-proof' && providerContracts.blockedRoles.length > 0) return providerContracts.syncRequiredRoles.length > 0 ? 'provider-sync-barrier-required' : 'provider-contract-blocked';
  if (commandName === 'persist-proof' && operationalHealth.proofStoreStatus === 'unavailable') return 'proof-store-unavailable';
  if (commandName === 'persist-proof' && operationalHealth.proofStoreStatus === 'disabled') return 'proof-store-disabled';
  if (commandName === 'persist-proof' && persistedState.status === 'proof-persisted') return 'proof-already-persisted';
  if (commandName === 'persist-proof' && commandLedgerHasOperation(persistedState, 'persist-proof')) return 'proof-replay-already-completed';
  return null;
}

function buildIdempotentCommands({ recordId, severity, title, summary, recoveryAction, recipients, evidence, generatedAt, requestContext, acceptance, readiness, persistedState, persistedStateEnvelope, boundaryContext, boundaryAuthorization, operationalHealth, lifecycleControls, providerContracts, validation, preview, uiReview }) {
  const commandScope = recordId || 'pending-record-id';
  const boundaryScope = `${boundaryContext.tenantId || 'unbound-tenant'}:${boundaryContext.workspaceId || 'unbound-workspace'}`;
  const recipientManifest = recipients.map((recipient) => ({
    id: recipient.id,
    channel: recipient.channel,
    label: recipient.label,
    tenantId: recipient.tenantId || boundaryContext.tenantId,
    workspaceId: recipient.workspaceId || boundaryContext.workspaceId
  }));
  const evidenceManifest = evidence.map((item) => ({
    id: item.id,
    kind: item.kind,
    label: item.label,
    uri: item.uri || null,
    capturedAt: item.capturedAt,
    tenantId: item.tenantId || boundaryContext.tenantId,
    workspaceId: item.workspaceId || boundaryContext.workspaceId
  }));
  const proofManifest = {
    contract: 'NotifierRecordCommandProofManifestV1',
    surfaceId,
    recordId,
    generatedAt,
    traceId: requestContext.traceId,
    tenantId: boundaryContext.tenantId,
    workspaceId: boundaryContext.workspaceId,
    validationStatus: validation.valid ? 'valid' : 'invalid',
    acceptanceStatus: acceptance.acceptedForDispatch ? 'accepted' : 'pending',
    readinessStatus: readiness.status,
    previewHashSource: preview.body,
    evidenceIds: evidenceManifest.map((item) => item.id),
    recipientIds: recipientManifest.map((recipient) => recipient.id),
    requiredAcknowledgements: acceptance.requiredAcknowledgements,
    receivedAcknowledgements: acceptance.receivedAcknowledgements,
    blockingIssueCodes: validation.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.code),
    operationalMode: operationalHealth.degradedMode ? 'degraded' : 'normal',
    retryPolicy: operationalHealth.retryPolicy,
    failureState: operationalHealth.failureState.state,
    retryAt: operationalHealth.retryAt,
    retryWindowOpen: operationalHealth.retryWindowOpen,
    lifecycleMode: lifecycleControls.mode,
    commandPolicy: lifecycleControls.commandPolicy,
    lifecycleCommand: lifecycleControls.lifecycleCommand.command,
    lifecycleCommandAccepted: lifecycleControls.lifecycleCommand.accepted,
    lifecycleNextOperatorAction: lifecycleControls.nextOperatorAction,
    providerContractStatus: providerContracts.ready ? 'ready' : 'blocked',
    providerIds: providerContracts.descriptors.map((descriptor) => descriptor.providerId),
    providerBlockedRoles: providerContracts.blockedRoles,
    providerBoundaryBlockedRoles: providerContracts.boundaryBlockedRoles,
    providerSyncRequiredRoles: providerContracts.syncRequiredRoles,
    providerNegotiationState: providerContracts.capabilityNegotiation.handoffState,
    externalHandoffState: providerContracts.externalHandoffState.state,
    boundaryAuthorization: {
      decision: boundaryAuthorization.decision,
      scopeStatus: boundaryAuthorization.scopeStatus,
      deniedReasons: boundaryAuthorization.deniedReasons,
      proofPartition: boundaryAuthorization.proofPartition
    },
    uiReviewStatus: uiReview ? uiReview.reviewStatus : 'not-computed',
    nextAction: uiReview ? uiReview.nextAction.action : null
  };
  const base = {
    surfaceId,
    recordId,
    tenantId: boundaryContext.tenantId,
    workspaceId: boundaryContext.workspaceId,
    traceId: requestContext.traceId,
    sessionId: requestContext.sessionId,
    generatedAt,
    previousCommandId: persistedState.lastCommandId,
    previousCommandStatus: persistedState.lastCommandStatus,
    persistedStateKey: persistedStateEnvelope.stateKey,
    persistedStateRevisionSeed: persistedStateEnvelope.revisionSeed,
    restartSafeStatus: persistedStateEnvelope.status,
    replayGuards: persistedStateEnvelope.replayGuards,
    retryPolicy: operationalHealth.retryPolicy,
    retryCount: operationalHealth.retryCount,
    retryAfter: operationalHealth.retryAfter,
    retryAt: operationalHealth.retryAt,
    retryWindowOpen: operationalHealth.retryWindowOpen,
    failureState: operationalHealth.failureState.state,
    nextBackoffMs: operationalHealth.nextBackoffMs,
    operationalMode: operationalHealth.degradedMode ? 'degraded' : 'normal',
    lifecycleMode: lifecycleControls.mode,
    commandPolicy: lifecycleControls.commandPolicy,
    nextEligibleAt: lifecycleControls.nextEligibleAt,
    boundary: {
      contract: 'NotifierRecordCommandBoundaryV1',
      tenantId: boundaryContext.tenantId,
      workspaceId: boundaryContext.workspaceId,
      isolationMode: boundaryContext.isolationMode,
      allowedWorkspaceIds: boundaryContext.allowedWorkspaceIds,
      dispatchAllowed: boundaryContext.dispatchAllowed,
      auditHandoffAllowed: boundaryContext.auditHandoffAllowed,
      authorizationDecision: boundaryAuthorization.decision,
      authorizationScopeStatus: boundaryAuthorization.scopeStatus,
      deniedReasons: boundaryAuthorization.deniedReasons,
      proofPartition: boundaryAuthorization.proofPartition
    },
    auditProjection: {
      contract: 'NotifierRecordCommandAuditProjectionV1',
      actor: requestContext.actor,
      sourceRoute: requestContext.sourceRoute,
      severity: severity || 'unclassified',
      recipientCount: recipients.length,
      evidenceCount: evidence.length,
      blockingIssueCount: validation.blockingIssueCount,
      acceptedForDispatch: acceptance.acceptedForDispatch,
      recoveredFromState: readiness.recoveredFromState,
      restartSafe: readiness.restartSafe,
      lifecycleCommand: lifecycleControls.lifecycleCommand.command,
      lifecycleCommandAccepted: lifecycleControls.lifecycleCommand.accepted,
      lifecycleNextOperatorAction: lifecycleControls.nextOperatorAction
    },
    proofManifest
  };
  const lifecycleCommandEnabled = Boolean(lifecycleControls.lifecycleCommand.command)
    && lifecycleControls.lifecycleCommand.accepted
    && boundaryAuthorization.authorizedForPersist
    && providerContracts.descriptorByRole['state-store'].available
    && persistedStateEnvelope.replayGuards.allowLifecycleOverwrite;
  const stateEnabled = persistedStateEnvelope.replayGuards.allowDraftOverwrite && boundaryAuthorization.authorizedForPersist && providerContracts.descriptorByRole['state-store'].available;
  const dispatchEnabled = readiness.canDispatch && !persistedStateEnvelope.replayGuards.rejectDispatchReplay;
  const proofEnabled = acceptance.acceptedForDispatch && boundaryAuthorization.authorizedForProof && lifecycleControls.proofPersistenceEnabled && !lifecycleControls.scheduleActive && !operationalHealth.circuitOpen && !operationalHealth.retryDelayed && providerContracts.ready && providerContracts.descriptorByRole['proof-store'].available && !['unavailable', 'disabled'].includes(operationalHealth.proofStoreStatus) && !persistedStateEnvelope.replayGuards.rejectProofReplay;

  return [
    {
      ...base,
      commandId: `${surfaceId}:${commandScope}:apply-lifecycle`,
      idempotencyKey: `${surfaceId}:${boundaryScope}:${commandScope}:lifecycle:${lifecycleControls.lifecycleCommand.command || 'none'}:${lifecycleControls.mode}:${lifecycleControls.schedulingMode}`,
      action: 'apply-notifier-record-lifecycle',
      route: '/kernel/audit-recovery/notifier-record/lifecycle',
      method: 'PATCH',
      payloadContract: 'NotifierRecordLifecycleCommandRequestV1',
      replayPolicy: 'same-key-replaces-lifecycle-settings',
      enabled: lifecycleCommandEnabled,
      disabledReason: lifecycleCommandEnabled ? null : commandDisabledReason('apply-lifecycle', { acceptance, readiness, persistedState, operationalHealth, lifecycleControls, providerContracts, boundaryAuthorization }),
      payload: {
        contract: 'NotifierRecordLifecycleCommandRequestV1',
        lifecycleCommand: lifecycleControls.lifecycleCommand,
        lifecycleControls,
        persistedStateEnvelope,
        boundary: base.boundary,
        validationIssueCodes: lifecycleControls.validationIssues.map((issue) => issue.code),
        nextOperatorAction: lifecycleControls.nextOperatorAction,
        stateStoreContract: providerContracts.descriptorByRole['state-store']
      }
    },
    {
      ...base,
      commandId: `${surfaceId}:${commandScope}:persist-state`,
      idempotencyKey: `${surfaceId}:${boundaryScope}:${commandScope}:persist-state:${readiness.status}`,
      action: 'persist-notifier-record-state',
      route: '/kernel/audit-recovery/notifier-record/state',
      method: 'PUT',
      payloadContract: 'NotifierRecordPersistStateRequestV1',
      replayPolicy: 'same-key-replaces-draft',
      enabled: stateEnabled,
      disabledReason: stateEnabled ? null : commandDisabledReason('persist-state', { acceptance, readiness, persistedState, operationalHealth, lifecycleControls, providerContracts, boundaryAuthorization }),
      payload: {
        contract: 'NotifierRecordPersistStateRequestV1',
        persistedStateEnvelope,
        draft: { recordId, severity, title, summary, recoveryAction },
        recipients: recipientManifest,
        evidence: evidenceManifest,
        validation,
        acceptance,
        readiness,
        preview,
        uiReview,
        boundaryAuthorization,
        lifecycleControls,
        operationalHealth,
        persistedState,
        providerContract: providerContracts.descriptorByRole['state-store']
      }
    },
    {
      ...base,
      commandId: `${surfaceId}:${commandScope}:dispatch`,
      idempotencyKey: `${surfaceId}:${boundaryScope}:${commandScope}:dispatch:${acceptance.acceptedForDispatch ? 'accepted' : 'blocked'}`,
      action: 'dispatch-notifier-record',
      route: '/kernel/audit-recovery/notifier-record/dispatch',
      method: 'POST',
      payloadContract: 'NotifierRecordDispatchRequestV1',
      replayPolicy: 'same-key-returns-existing-dispatch',
      enabled: dispatchEnabled,
      disabledReason: dispatchEnabled ? null : commandDisabledReason('dispatch', { acceptance, readiness, persistedState, operationalHealth, lifecycleControls, providerContracts, boundaryAuthorization }),
      payload: {
        contract: 'NotifierRecordDispatchRequestV1',
        notification: {
          recordId,
          severity: severity || 'unclassified',
          title: title || 'Audit recovery notification',
          summary: summary || 'No operator summary provided.',
          recoveryAction,
          previewBody: preview.body
        },
        recipients: recipientManifest,
        boundary: base.boundary,
        idempotencyKey: `${surfaceId}:${boundaryScope}:${commandScope}:dispatch:${acceptance.acceptedForDispatch ? 'accepted' : 'blocked'}`,
        proofRequired: lifecycleControls.proofPersistenceEnabled,
        persistedStateEnvelope: {
          stateKey: persistedStateEnvelope.stateKey,
          status: persistedStateEnvelope.status,
          revisionSeed: persistedStateEnvelope.revisionSeed,
          replayGuards: persistedStateEnvelope.replayGuards
        },
        providerContract: providerContracts.descriptorByRole['notification-dispatcher'],
        retryPolicy: operationalHealth.retryPolicy,
        retryAfter: operationalHealth.retryAfter,
        retryAt: operationalHealth.retryAt,
        retryWindowOpen: operationalHealth.retryWindowOpen,
        nextBackoffMs: operationalHealth.nextBackoffMs,
        failureState: operationalHealth.failureState
      }
    },
    {
      ...base,
      commandId: `${surfaceId}:${commandScope}:persist-proof`,
      idempotencyKey: `${surfaceId}:${boundaryScope}:${commandScope}:proof:${readiness.status}`,
      action: 'persist-notifier-record-proof',
      route: '/kernel/audit-recovery/notifier-record/proof',
      method: 'PUT',
      payloadContract: 'NotifierRecordProofPersistRequestV1',
      replayPolicy: 'same-key-returns-existing-proof',
      enabled: proofEnabled,
      disabledReason: proofEnabled ? null : commandDisabledReason('persist-proof', { acceptance, readiness, persistedState, operationalHealth, lifecycleControls, providerContracts, boundaryAuthorization }),
      payload: {
        contract: 'NotifierRecordProofPersistRequestV1',
        proofManifest,
        persistedStateEnvelope,
        previewHashSource: preview.body,
        evidence: evidenceManifest,
        validationStatus: proofManifest.validationStatus,
        acceptanceStatus: proofManifest.acceptanceStatus,
        readinessStatus: readiness.status,
        reportingPartition: {
          tenantId: boundaryAuthorization.proofPartition.tenantId,
          workspaceId: boundaryAuthorization.proofPartition.workspaceId,
          generatedDate: generatedAt.slice(0, 10)
        },
        providerContract: providerContracts.descriptorByRole['proof-store']
      }
    }
  ];
}

function buildClientStepHandoff(step, { workflowHandoff, clientHandoffState, providerContracts }) {
  const externalState = providerContracts.externalHandoffState;
  const requestedTargetMatched = Boolean(
    clientHandoffState.requestedTarget
    && (
      clientHandoffState.requestedTarget === workflowHandoff.target
      || clientHandoffState.requestedTarget === externalState.providerId
      || clientHandoffState.requestedTarget === externalState.route
    )
  );
  const selectedPanel = clientHandoffState.returnPanel
    || workflowHandoff.clientWorkflow.nextPanel
    || validationPanelForIntent(clientHandoffState.intent, step.handoffState === 'dispatch-ready');
  const resumeRoute = externalState.state === 'ready'
    ? externalState.route
    : workflowHandoff.route;

  return {
    contract: 'NotifierRecordUserVisibleWorkflowStepV1',
    intent: clientHandoffState.intent,
    requestedTarget: clientHandoffState.requestedTarget,
    requestedTargetMatched,
    resolvedTarget: workflowHandoff.target,
    resumeToken: workflowHandoff.resumeToken,
    sourcePanel: clientHandoffState.sourcePanel,
    returnPanel: clientHandoffState.returnPanel,
    nextPanel: selectedPanel,
    primaryAction: workflowHandoff.clientWorkflow.primaryAction,
    banner: workflowHandoff.clientWorkflow.banner,
    route: resumeRoute,
    method: workflowHandoff.method,
    consumed: clientHandoffState.clientConsumed,
    externalHandoff: {
      providerId: externalState.providerId,
      state: externalState.state,
      route: externalState.route,
      receiptRoute: externalState.receiptRoute,
      negotiationState: externalState.negotiationState,
      syncRequired: externalState.syncRequired,
      boundaryDecision: externalState.boundaryDecision,
      boundaryIssues: externalState.boundaryIssues,
      blockingRoles: externalState.blockingRoles
    }
  };
}

function withClientWorkflowStep(step, context) {
  return {
    ...step,
    clientWorkflow: buildClientStepHandoff(step, context)
  };
}

function buildTerminalHandoffStep({ readiness, requestContext, boundaryContext, operationalHealth, providerContracts, workflowHandoff, clientHandoffState }) {
  const openProof = clientHandoffState.intent === 'open-proof'
    || readiness.status === 'proof-persisted'
    || readiness.status === 'dispatch-recorded';
  const action = readiness.status === 'proof-persisted'
    ? 'open-persisted-proof'
    : openProof
      ? 'open-dispatch-proof'
      : 'review-dispatch-record';
  const step = {
    action,
    method: 'GET',
    route: '/kernel/audit-recovery/notifier-record/proof',
    payloadContract: 'NotifierRecordProofEnvelope',
    handoffState: readiness.status,
    traceId: requestContext.traceId,
    tenantId: boundaryContext.tenantId,
    workspaceId: boundaryContext.workspaceId,
    proofStoreStatus: operationalHealth.proofStoreStatus,
    providerContractStatus: providerContracts.ready ? 'ready' : 'blocked',
    externalHandoffState: providerContracts.externalHandoffState.state
  };

  return withClientWorkflowStep(step, { workflowHandoff, clientHandoffState, providerContracts });
}

function buildNextSteps({ acceptance, validation, recipients, requestContext, boundaryContext, boundaryAuthorization, operationalHealth, lifecycleControls, providerContracts, readiness, workflowHandoff, clientHandoffState }) {
  if (boundaryAuthorization.decision === 'deny-boundary') {
    return [
      withClientWorkflowStep({
        action: 'resolve-boundary-authorization',
        method: 'PATCH',
        route: '/kernel/audit-recovery/notifier-record/boundary',
        payloadContract: 'NotifierRecordBoundaryAuthorization',
        handoffState: 'boundary-blocked',
        traceId: requestContext.traceId,
        tenantId: boundaryContext.tenantId,
        workspaceId: boundaryContext.workspaceId,
        scopeStatus: boundaryAuthorization.scopeStatus,
        deniedReasons: boundaryAuthorization.deniedReasons,
        boundaryViolations: boundaryAuthorization.boundaryViolations
      }, { workflowHandoff, clientHandoffState, providerContracts })
    ];
  }

  if (operationalHealth.actionableErrors.some((error) => error.severity === 'error')) {
    return [
      withClientWorkflowStep({
        action: 'resolve-operational-health',
        method: 'POST',
        route: '/kernel/audit-recovery/notifier-record/health/escalation',
        payloadContract: 'NotifierRecordOperationalHealth',
        handoffState: operationalHealth.retryableFailure ? 'retry-scheduled' : 'operator-escalation-required',
        traceId: requestContext.traceId,
        tenantId: boundaryContext.tenantId,
        workspaceId: boundaryContext.workspaceId,
        retryPolicy: operationalHealth.retryPolicy,
        retryAfter: operationalHealth.retryAfter,
        nextBackoffMs: operationalHealth.nextBackoffMs,
        actionableErrors: operationalHealth.actionableErrors
      }, { workflowHandoff, clientHandoffState, providerContracts })
    ];
  }

  if (acceptance.acceptedForDispatch && operationalHealth.retryDelayed) {
    return [
      withClientWorkflowStep({
        action: 'wait-for-retry-window',
        method: 'POST',
        route: '/kernel/audit-recovery/notifier-record/dispatch',
        payloadContract: 'NotifierRecordDispatchRetryWindow',
        handoffState: 'retry-window-not-open',
        traceId: requestContext.traceId,
        tenantId: boundaryContext.tenantId,
        workspaceId: boundaryContext.workspaceId,
        retryPolicy: operationalHealth.retryPolicy,
        retryAt: operationalHealth.retryAt,
        retryAfter: operationalHealth.retryAfter,
        nextBackoffMs: operationalHealth.nextBackoffMs,
        failureState: operationalHealth.failureState
      }, { workflowHandoff, clientHandoffState, providerContracts })
    ];
  }

  if (acceptance.acceptedForDispatch && ['dispatch-recorded', 'proof-persisted'].includes(readiness.status)) {
    return [
      buildTerminalHandoffStep({ readiness, requestContext, boundaryContext, operationalHealth, providerContracts, workflowHandoff, clientHandoffState })
    ];
  }

  if (acceptance.acceptedForDispatch && (!lifecycleControls.dispatchEnabled || lifecycleControls.scheduleActive)) {
    return [
      withClientWorkflowStep({
        action: lifecycleControls.scheduleActive ? 'wait-for-scheduled-dispatch' : 'update-lifecycle-controls',
        method: 'PATCH',
        route: '/kernel/audit-recovery/notifier-record/lifecycle',
        payloadContract: 'NotifierRecordLifecycleControls',
        handoffState: lifecycleControls.scheduleActive ? 'dispatch-scheduled' : lifecycleControls.mode === 'paused' ? 'dispatch-paused' : 'dispatch-disabled',
        traceId: requestContext.traceId,
        tenantId: boundaryContext.tenantId,
        workspaceId: boundaryContext.workspaceId,
        lifecycleMode: lifecycleControls.mode,
        commandPolicy: lifecycleControls.commandPolicy,
        nextEligibleAt: lifecycleControls.nextEligibleAt,
        lifecycleCommand: lifecycleControls.lifecycleCommand,
        nextOperatorAction: lifecycleControls.nextOperatorAction,
        disableReason: lifecycleControls.disableReason,
        pausedReason: lifecycleControls.pausedReason
      }, { workflowHandoff, clientHandoffState, providerContracts })
    ];
  }

  if (acceptance.acceptedForDispatch && !providerContracts.ready) {
    return [
      withClientWorkflowStep({
        action: 'negotiate-provider-contracts',
        method: 'PATCH',
        route: '/kernel/audit-recovery/notifier-record/providers',
        payloadContract: 'NotifierRecordProviderContracts',
        handoffState: 'provider-contract-blocked',
        traceId: requestContext.traceId,
        tenantId: boundaryContext.tenantId,
        workspaceId: boundaryContext.workspaceId,
        blockedRoles: providerContracts.blockedRoles,
        boundaryBlockedRoles: providerContracts.boundaryBlockedRoles,
        unavailableRoles: providerContracts.unavailableRoles,
        syncRequiredRoles: providerContracts.syncRequiredRoles,
        negotiationState: providerContracts.capabilityNegotiation.handoffState,
        serviceHandshakes: providerContracts.capabilityNegotiation.serviceHandshakes,
        validationIssueCodes: providerContracts.validationIssues.map((issue) => issue.code)
      }, { workflowHandoff, clientHandoffState, providerContracts })
    ];
  }

  if (acceptance.acceptedForDispatch) {
    return [
      withClientWorkflowStep({
        action: 'dispatch-notification',
        method: 'POST',
        route: '/kernel/audit-recovery/notifier-record/dispatch',
        payloadContract: 'NotifierRecordDispatchRequest',
        handoffState: 'dispatch-ready',
        traceId: requestContext.traceId,
        tenantId: boundaryContext.tenantId,
        workspaceId: boundaryContext.workspaceId,
        recipientIds: recipients.map((recipient) => recipient.id),
        operationalMode: operationalHealth.degradedMode ? 'degraded' : 'normal',
        retryPolicy: operationalHealth.retryPolicy
      }, { workflowHandoff, clientHandoffState, providerContracts }),
      withClientWorkflowStep({
        action: 'persist-proof',
        method: 'POST',
        route: '/kernel/audit-recovery/notifier-record/proof',
        payloadContract: 'NotifierRecordProofEnvelope',
        handoffState: 'proof-ready',
        traceId: requestContext.traceId,
        tenantId: boundaryContext.tenantId,
        workspaceId: boundaryContext.workspaceId,
        proofStoreStatus: operationalHealth.proofStoreStatus
      }, { workflowHandoff, clientHandoffState, providerContracts })
    ];
  }

  return [
    withClientWorkflowStep({
      action: 'resolve-validation',
      method: 'PATCH',
      route: '/kernel/audit-recovery/notifier-record',
      payloadContract: 'NotifierRecordDraft',
      handoffState: 'draft-needs-input',
      traceId: requestContext.traceId,
      tenantId: boundaryContext.tenantId,
      workspaceId: boundaryContext.workspaceId,
      requiredFields: validation.issues.map((issue) => issue.field)
    }, { workflowHandoff, clientHandoffState, providerContracts }),
    withClientWorkflowStep({
      action: 'collect-acceptance',
      method: 'POST',
      route: '/kernel/audit-recovery/notifier-record/acceptance',
      payloadContract: 'NotifierRecordAcceptance',
      handoffState: 'acceptance-needs-operator',
      traceId: requestContext.traceId,
      tenantId: boundaryContext.tenantId,
      workspaceId: boundaryContext.workspaceId,
      missingAcknowledgements: acceptance.missingAcknowledgements
    }, { workflowHandoff, clientHandoffState, providerContracts })
  ];
}

function buildUiReviewContract({ recordId, severity, preview, acceptance, readiness, validation, requestContext, boundaryContext, boundaryAuthorization, persistedState, operationalHealth, lifecycleControls, providerContracts, clientHandoffState, generatedAt }) {
  const issueBuckets = validation.issues.reduce((buckets, issue) => {
    const severityKey = issue.severity || 'info';
    buckets[severityKey] = [...(buckets[severityKey] || []), issue.code];
    return buckets;
  }, {});
  const providerIssueRoles = [...new Set(providerContracts.validationIssues.map((issue) => issue.role).filter(Boolean))];
  const previewReady = Boolean(recordId && severity && preview.recipientCount > 0 && boundaryContext.tenantId && boundaryContext.workspaceId);
  const acceptanceReady = acceptance.acceptedForDispatch || (validation.valid && acceptance.missingAcknowledgements.length === 0);
  const validationSummary = {
    contract: 'NotifierRecordValidationSummaryV1',
    valid: validation.valid,
    issueCount: validation.issueCount,
    blockingIssueCount: validation.blockingIssueCount,
    warningIssueCount: validation.issues.filter((issue) => issue.severity === 'warning').length,
    issueCodesBySeverity: issueBuckets,
    firstBlockingIssue: validation.issues.find((issue) => issue.severity === 'error') || null,
    boundaryIssueCodes: validation.issues
      .filter((issue) => ['tenantId', 'workspaceId', 'permissions', 'boundaryAuthorization'].includes(issue.field))
      .map((issue) => issue.code),
    boundaryAuthorization: {
      decision: boundaryAuthorization.decision,
      scopeStatus: boundaryAuthorization.scopeStatus,
      deniedReasons: boundaryAuthorization.deniedReasons
    },
    providerIssueRoles
  };
  const previewChecklist = [
    { key: 'record-id', label: 'Record id', state: recordId ? 'complete' : 'blocked', value: recordId || null },
    { key: 'severity', label: 'Severity', state: severity ? 'complete' : 'blocked', value: severity || 'unclassified' },
    { key: 'recipient-manifest', label: 'Recipients', state: preview.recipientCount > 0 ? 'complete' : 'blocked', count: preview.recipientCount },
    { key: 'evidence-manifest', label: 'Evidence', state: preview.evidenceCount > 0 ? 'complete' : 'warning', count: preview.evidenceCount },
    { key: 'tenant-workspace-boundary', label: 'Tenant/workspace', state: boundaryAuthorization.authorizedForPersist ? 'complete' : 'blocked', tenantId: boundaryContext.tenantId, workspaceId: boundaryContext.workspaceId, decision: boundaryAuthorization.decision }
  ];
  const acceptanceChecklist = acceptance.requiredAcknowledgements.map((acknowledgement) => ({
    acknowledgement,
    state: acceptance.receivedAcknowledgements.includes(acknowledgement) ? 'complete' : 'blocked',
    required: true
  }));
  const blockerCodes = [
    ...validation.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.code),
    ...acceptance.missingAcknowledgements.map((acknowledgement) => `missing_ack:${acknowledgement}`),
    ...(operationalHealth.circuitOpen ? ['operational_circuit_open'] : []),
    ...(operationalHealth.retryDelayed ? ['retry_window_not_open'] : []),
    ...operationalHealth.validationIssues.filter((issue) => issue.severity === 'error').map((issue) => issue.code),
    ...boundaryAuthorization.deniedReasons.map((reason) => `boundary:${reason}`),
    ...(!lifecycleControls.dispatchEnabled && acceptance.acceptedForDispatch ? ['lifecycle_dispatch_disabled'] : []),
    ...(lifecycleControls.scheduleActive && acceptance.acceptedForDispatch ? ['dispatch_scheduled'] : []),
    ...(!providerContracts.ready && acceptance.acceptedForDispatch ? ['provider_contracts_blocked'] : [])
  ];
  const nextAction = !validation.valid
    ? boundaryAuthorization.decision === 'deny-boundary'
      ? { action: 'resolve-boundary-authorization', panel: 'validation', route: '/kernel/audit-recovery/notifier-record/boundary', method: 'PATCH', reason: boundaryAuthorization.scopeStatus }
      : { action: 'resolve-validation', panel: 'validation', route: '/kernel/audit-recovery/notifier-record', method: 'PATCH', reason: 'blocking-validation-issues' }
    : !acceptance.acceptedForDispatch
      ? { action: 'collect-acceptance', panel: 'acceptance', route: '/kernel/audit-recovery/notifier-record/acceptance', method: 'POST', reason: acceptance.missingAcknowledgements.length > 0 ? 'missing-required-acknowledgements' : 'operator-acceptance-missing' }
      : operationalHealth.circuitOpen
        ? { action: 'resolve-operational-health', panel: 'validation', route: '/kernel/audit-recovery/notifier-record/health/escalation', method: 'POST', reason: 'operational-circuit-open' }
        : operationalHealth.retryDelayed
          ? { action: 'wait-for-retry-window', panel: 'handoff', route: '/kernel/audit-recovery/notifier-record/dispatch', method: 'POST', reason: operationalHealth.failureState.circuitBreakerReason || 'retry-window-not-open', retryAt: operationalHealth.retryAt }
        : !lifecycleControls.dispatchEnabled || lifecycleControls.scheduleActive
          ? { action: lifecycleControls.scheduleActive ? 'wait-for-schedule' : 'update-lifecycle', panel: 'handoff', route: '/kernel/audit-recovery/notifier-record/lifecycle', method: 'PATCH', reason: lifecycleControls.commandPolicy }
          : !providerContracts.ready
            ? { action: 'negotiate-providers', panel: 'handoff', route: '/kernel/audit-recovery/notifier-record/providers', method: 'PATCH', reason: 'provider-contracts-not-ready' }
            : readiness.canDispatch
              ? { action: 'dispatch-notification', panel: 'handoff', route: '/kernel/audit-recovery/notifier-record/dispatch', method: 'POST', reason: 'dispatch-ready' }
              : { action: 'open-proof', panel: 'handoff', route: '/kernel/audit-recovery/notifier-record/proof', method: 'PUT', reason: readiness.status };
  const routePayloadContracts = [
    {
      contract: 'NotifierRecordReviewRoutePayloadV1',
      route: '/kernel/audit-recovery/notifier-record/preview',
      method: 'GET',
      panel: 'preview',
      payloadContract: 'NotifierRecordPreviewSummaryV1',
      ready: previewReady,
      requiredClientFields: ['recordKey', 'previewSummary', 'previewChecklist'],
      missingClientFields: previewChecklist.filter((item) => item.state === 'blocked').map((item) => item.key)
    },
    {
      contract: 'NotifierRecordReviewRoutePayloadV1',
      route: '/kernel/audit-recovery/notifier-record/validation',
      method: 'PATCH',
      panel: 'validation',
      payloadContract: 'NotifierRecordValidationSummaryV1',
      ready: validation.valid,
      requiredClientFields: ['validationSummary.issueCodesBySeverity', 'validationSummary.boundaryAuthorization'],
      missingClientFields: validation.valid ? [] : validation.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.field)
    },
    {
      contract: 'NotifierRecordReviewRoutePayloadV1',
      route: '/kernel/audit-recovery/notifier-record/acceptance',
      method: 'POST',
      panel: 'acceptance',
      payloadContract: 'NotifierRecordAcceptanceSummaryV1',
      ready: acceptanceReady,
      requiredClientFields: ['acceptanceSummary.checklist', 'acceptanceSummary.acceptedForDispatch'],
      missingClientFields: acceptance.missingAcknowledgements.map((acknowledgement) => `acknowledgements.${acknowledgement}`)
    },
    {
      contract: 'NotifierRecordReviewRoutePayloadV1',
      route: readiness.canDispatch ? '/kernel/audit-recovery/notifier-record/dispatch' : nextAction.route,
      method: readiness.canDispatch ? 'POST' : nextAction.method,
      panel: 'handoff',
      payloadContract: 'NotifierRecordReadinessSummaryV1',
      ready: readiness.canDispatch,
      requiredClientFields: ['readinessSummary.status', 'readinessSummary.canDispatch', 'nextAction'],
      missingClientFields: blockerCodes
    }
  ];
  const decisionTrace = [
    {
      contract: 'NotifierRecordReviewDecisionTraceEntryV1',
      step: 'validation',
      state: validation.valid ? 'passed' : 'blocked',
      reason: validation.valid ? 'no-blocking-validation-issues' : 'blocking-validation-issues',
      route: '/kernel/audit-recovery/notifier-record/validation',
      issueCodes: validation.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.code)
    },
    {
      contract: 'NotifierRecordReviewDecisionTraceEntryV1',
      step: 'preview',
      state: previewReady ? 'ready' : 'incomplete',
      reason: previewReady ? 'preview-has-bound-record-recipient-and-scope' : 'preview-missing-record-recipient-or-scope',
      route: '/kernel/audit-recovery/notifier-record/preview',
      issueCodes: previewChecklist.filter((item) => item.state === 'blocked').map((item) => item.key)
    },
    {
      contract: 'NotifierRecordReviewDecisionTraceEntryV1',
      step: 'acceptance',
      state: acceptance.acceptedForDispatch ? 'accepted' : acceptanceReady ? 'acknowledged' : 'blocked',
      reason: acceptance.acceptedForDispatch ? 'operator-accepted-dispatch' : acceptance.missingAcknowledgements.length > 0 ? 'missing-required-acknowledgements' : 'operator-acceptance-missing',
      route: '/kernel/audit-recovery/notifier-record/acceptance',
      issueCodes: acceptance.missingAcknowledgements.map((acknowledgement) => `missing_ack:${acknowledgement}`)
    },
    {
      contract: 'NotifierRecordReviewDecisionTraceEntryV1',
      step: 'readiness',
      state: readiness.canDispatch ? 'dispatch-ready' : readiness.status,
      reason: nextAction.reason,
      route: nextAction.route,
      issueCodes: blockerCodes
    }
  ];
  const clientPanelStates = CLIENT_STATE_KEYS.map((panel) => {
    const routeContract = routePayloadContracts.find((candidate) => candidate.panel === panel);
    return {
      contract: 'NotifierRecordClientPanelStateV1',
      panel,
      active: panel === nextAction.panel || requestContext.requestedStep === panel,
      visible: requestContext.visiblePanels.length === 0 || requestContext.visiblePanels.includes(panel),
      ready: routeContract ? routeContract.ready : panel === 'draft' ? Boolean(recordId || preview.recipientCount > 0) : readiness.canDispatch,
      route: routeContract ? routeContract.route : clientHandoffState.requestedTarget,
      method: routeContract ? routeContract.method : 'GET',
      disabledReason: routeContract && !routeContract.ready
        ? routeContract.missingClientFields[0] || nextAction.reason
        : null
    };
  });
  const reviewPacket = {
    contract: 'NotifierRecordRouteReviewPacketV1',
    generatedAt,
    recordKey: recordId ? `${surfaceId}:${recordId}` : `${surfaceId}:pending`,
    requestedStep: requestContext.requestedStep,
    nextAction,
    routePayloadContracts,
    decisionTrace,
    clientPanelStates,
    validation: {
      valid: validation.valid,
      blockingIssueCount: validation.blockingIssueCount,
      warningIssueCount: validation.issues.filter((issue) => issue.severity === 'warning').length
    },
    preview: {
      ready: previewReady,
      headline: preview.headline,
      recipientCount: preview.recipientCount,
      evidenceCount: preview.evidenceCount
    },
    acceptance: {
      ready: acceptanceReady,
      acceptedForDispatch: acceptance.acceptedForDispatch,
      missingAcknowledgements: acceptance.missingAcknowledgements
    },
    readiness: {
      status: readiness.status,
      canDispatch: readiness.canDispatch,
      restartSafe: readiness.restartSafe,
      providerContractsReady: readiness.providerContractsReady
    }
  };

  return {
    contract: 'NotifierRecordUiPreviewAcceptanceReviewV1',
    generatedAt,
    recordKey: recordId ? `${surfaceId}:${recordId}` : `${surfaceId}:pending`,
    reviewStatus: blockerCodes.length > 0
      ? 'blocked'
      : acceptance.acceptedForDispatch
        ? readiness.canDispatch ? 'dispatch-ready' : readiness.status
        : previewReady ? 'ready-for-operator-acceptance' : 'draft-incomplete',
    previewReady,
    acceptanceReady,
    proofReady: acceptance.acceptedForDispatch && readiness.status !== 'proof-persisted' && lifecycleControls.proofPersistenceEnabled,
    readOnly: persistedState.terminal,
    requestedStep: requestContext.requestedStep,
    handoffIntent: clientHandoffState.intent,
    previewSummary: {
      contract: 'NotifierRecordPreviewSummaryV1',
      headline: preview.headline,
      format: preview.format,
      recipientCount: preview.recipientCount,
      evidenceCount: preview.evidenceCount,
      tenantId: boundaryContext.tenantId,
      workspaceId: boundaryContext.workspaceId
    },
    validationSummary,
    acceptanceSummary: {
      contract: 'NotifierRecordAcceptanceSummaryV1',
      acceptedForDispatch: acceptance.acceptedForDispatch,
      acceptedByOperator: acceptance.acceptedByOperator,
      acceptedBy: acceptance.acceptedBy,
      missingAcknowledgements: acceptance.missingAcknowledgements,
      checklist: acceptanceChecklist
    },
    readinessSummary: {
      contract: 'NotifierRecordReadinessSummaryV1',
      status: readiness.status,
      canPreview: readiness.canPreview,
      canAccept: readiness.canAccept,
      canDispatch: readiness.canDispatch,
      restartSafe: readiness.restartSafe,
      providerContractsReady: readiness.providerContractsReady,
      retryPolicy: operationalHealth.retryPolicy,
      nextEligibleAt: lifecycleControls.nextEligibleAt,
      blockedProviderRoles: providerContracts.blockedRoles,
      boundaryBlockedProviderRoles: providerContracts.boundaryBlockedRoles,
      unavailableProviderRoles: providerContracts.unavailableRoles,
      providerNegotiationState: providerContracts.capabilityNegotiation.handoffState
    },
    previewChecklist,
    routePayloadContracts,
    decisionTrace,
    clientPanelStates,
    reviewPacket,
    blockerCodes,
    nextAction
  };
}

function buildClientState({ recordId, severity, recipients, evidence, requestContext, validation, acceptance, readiness, persistedState, persistedStateEnvelope, boundaryContext, boundaryAuthorization, operationalHealth, lifecycleControls, providerContracts, analyticsExports, workflowHandoff, clientHandoffState, uiReview }) {
  const currentPanel = workflowHandoff.clientWorkflow.nextPanel;
  const visiblePanels = requestContext.visiblePanels.length > 0
    ? requestContext.visiblePanels
    : ['draft', 'validation', 'preview', currentPanel];

  return {
    version: requestContext.clientStateVersion,
    currentPanel,
    requestedStep: requestContext.requestedStep,
    visiblePanels: [...new Set(visiblePanels)],
    draftKey: recordId ? `${surfaceId}:${recordId}` : `${surfaceId}:pending`,
    persistedStateKey: recordId ? `${surfaceId}:state:${recordId}` : `${surfaceId}:state:pending`,
    boundary: {
      tenantId: boundaryContext.tenantId,
      workspaceId: boundaryContext.workspaceId,
      isolationMode: boundaryContext.isolationMode,
      dispatchAllowed: boundaryContext.dispatchAllowed,
      auditHandoffAllowed: boundaryContext.auditHandoffAllowed,
      authorizationDecision: boundaryAuthorization.decision,
      scopeStatus: boundaryAuthorization.scopeStatus,
      deniedReasons: boundaryAuthorization.deniedReasons,
      proofPartition: boundaryAuthorization.proofPartition
    },
    recovery: {
      recoveredFromState: persistedState.recovered,
      persistedStatus: readiness.persistedStatus,
      restartSafeStatus: persistedStateEnvelope.status,
      restoreMode: persistedStateEnvelope.restoreMode,
      stateKey: persistedStateEnvelope.stateKey,
      revisionSeed: persistedStateEnvelope.revisionSeed,
      lastCommandId: persistedState.lastCommandId,
      commandCount: persistedState.commandCount,
      completedCommandOperations: persistedState.completedCommandOperations,
      completedOperationReplayKeys: persistedState.completedOperationReplayKeys,
      terminal: persistedStateEnvelope.terminal,
      replayGuards: persistedStateEnvelope.replayGuards,
      recoveryPaths: persistedStateEnvelope.recoveryPaths.map((path) => ({
        path: path.path,
        enabled: path.enabled,
        nextStatus: path.nextStatus,
        route: path.route,
        method: path.method
      })),
      blockedRecoveryCodes: persistedStateEnvelope.blockedRecoveryCodes
    },
    operationalHealth: {
      dispatcherStatus: operationalHealth.dispatcherStatus,
      proofStoreStatus: operationalHealth.proofStoreStatus,
      degradedMode: operationalHealth.degradedMode,
      circuitOpen: operationalHealth.circuitOpen,
      retryableFailure: operationalHealth.retryableFailure,
      retryDelayed: operationalHealth.retryDelayed,
      retryWindowOpen: operationalHealth.retryWindowOpen,
      retryAt: operationalHealth.retryAt,
      retryBudgetRemaining: operationalHealth.retryBudgetRemaining,
      nextBackoffMs: operationalHealth.nextBackoffMs,
      failureState: operationalHealth.failureState,
      validationIssueCodes: operationalHealth.validationIssues.map((issue) => issue.code),
      actionableErrorCodes: operationalHealth.actionableErrors.map((error) => error.code)
    },
    lifecycle: {
      mode: lifecycleControls.mode,
      dispatchEnabled: lifecycleControls.dispatchEnabled,
      proofPersistenceEnabled: lifecycleControls.proofPersistenceEnabled,
      schedulingMode: lifecycleControls.schedulingMode,
      nextEligibleAt: lifecycleControls.nextEligibleAt,
      scheduleActive: lifecycleControls.scheduleActive,
      commandPolicy: lifecycleControls.commandPolicy,
      lifecycleCommand: lifecycleControls.lifecycleCommand,
      nextOperatorAction: lifecycleControls.nextOperatorAction,
      validationIssueCodes: lifecycleControls.validationIssues.map((issue) => issue.code)
    },
    providerContracts: {
      contract: providerContracts.contract,
      ready: providerContracts.ready,
      requiredRoles: providerContracts.requiredRoles,
      blockedRoles: providerContracts.blockedRoles,
      boundaryBlockedRoles: providerContracts.boundaryBlockedRoles,
      unavailableRoles: providerContracts.unavailableRoles,
      syncRequiredRoles: providerContracts.syncRequiredRoles,
      capabilityNegotiation: providerContracts.capabilityNegotiation,
      providers: providerContracts.descriptors.map((descriptor) => ({
        role: descriptor.role,
        providerId: descriptor.providerId,
        health: descriptor.health,
        available: descriptor.available,
        contractVersion: descriptor.contractVersion,
        acceptedCapabilities: descriptor.acceptedCapabilities,
        missingCapabilities: descriptor.missingCapabilities,
        syncRequired: descriptor.sync.syncRequired,
        boundaryDecision: descriptor.boundaryPolicy.decision,
        boundaryIssues: descriptor.boundaryPolicy.boundaryIssues
      })),
      externalHandoffState: providerContracts.externalHandoffState
    },
    handoff: {
      contract: clientHandoffState.contract,
      intent: clientHandoffState.intent,
      target: workflowHandoff.target,
      route: workflowHandoff.route,
      method: workflowHandoff.method,
      resumeToken: workflowHandoff.resumeToken,
      requestedTarget: clientHandoffState.requestedTarget,
      externalProviderId: providerContracts.externalHandoffState.providerId,
      externalProviderState: providerContracts.externalHandoffState.state,
      externalProviderRoute: providerContracts.externalHandoffState.route,
      externalReceiptRoute: providerContracts.externalHandoffState.receiptRoute,
      previousStatus: clientHandoffState.previousStatus,
      nextPanel: workflowHandoff.clientWorkflow.nextPanel,
      banner: workflowHandoff.clientWorkflow.banner,
      primaryAction: workflowHandoff.clientWorkflow.primaryAction,
      staleAcknowledgement: clientHandoffState.validationIssues.some((issue) => issue.code === 'handoff_acknowledgement_stale'),
      clientConsumed: clientHandoffState.clientConsumed,
      generatedAt: clientHandoffState.generatedAt
    },
    review: {
      contract: uiReview.contract,
      status: uiReview.reviewStatus,
      previewReady: uiReview.previewReady,
      acceptanceReady: uiReview.acceptanceReady,
      proofReady: uiReview.proofReady,
      readOnly: uiReview.readOnly,
      nextAction: uiReview.nextAction,
      blockerCodes: uiReview.blockerCodes,
      validationSummary: uiReview.validationSummary,
      acceptanceSummary: uiReview.acceptanceSummary,
      readinessSummary: uiReview.readinessSummary,
      previewChecklist: uiReview.previewChecklist,
      routePayloadContracts: uiReview.routePayloadContracts,
      decisionTrace: uiReview.decisionTrace,
      clientPanelStates: uiReview.clientPanelStates,
      reviewPacket: uiReview.reviewPacket
    },
    reporting: analyticsExports
      ? {
          statusBucket: analyticsExports.reportingState.statusBucket,
          dashboardKey: analyticsExports.reportingState.dashboardKey,
          needsAttention: analyticsExports.reportingState.needsAttention,
          exportReady: analyticsExports.reportingState.exportReady,
          stalled: analyticsExports.reportingState.stalled,
          lastHistoryStatus: analyticsExports.reportingState.lastHistoryStatus,
          mailchimp: analyticsExports.reportingState.mailchimp,
          timeline: analyticsExports.timeline.map((stage) => ({
            key: stage.key,
            state: stage.state
          }))
        }
      : null,
    summary: {
      severity: severity || 'unclassified',
      recipientCount: recipients.length,
      evidenceCount: evidence.length,
      blockingIssueCount: validation.blockingIssueCount,
      historySnapshotCount: analyticsExports ? analyticsExports.counters.historySnapshotCount : 0,
      enabledCommandCount: analyticsExports ? analyticsExports.counters.enabledCommandCount : 0,
      acceptedForDispatch: acceptance.acceptedForDispatch,
      status: readiness.status,
      restartSafe: readiness.restartSafe
    }
  };
}

function buildWorkflowHandoff({ recordId, recipients, evidence, requestContext, acceptance, readiness, generatedAt, idempotentCommands, boundaryContext, boundaryAuthorization, operationalHealth, lifecycleControls, providerContracts, clientHandoffState }) {
  const dispatchTarget = acceptance.acceptedForDispatch
    ? !boundaryAuthorization.authorizedForDispatch
      ? 'operator-boundary-review'
      : !providerContracts.ready
      ? 'kernel-provider-contract-negotiator'
      : operationalHealth.circuitOpen
      ? 'operator-health-escalation'
      : operationalHealth.retryDelayed
      ? 'kernel-retry-scheduler'
      : !lifecycleControls.dispatchEnabled || lifecycleControls.scheduleActive
      ? 'operator-lifecycle-controls'
      : readiness.status === 'dispatch-recorded' || readiness.status === 'proof-persisted'
      ? 'kernel-audit-proof-store'
      : 'kernel-notification-dispatcher'
    : 'operator-review-workbench';
  const enabledCommands = idempotentCommands.filter((command) => command.enabled);
  const handoffResumeToken = recordId && clientHandoffState.resumeToken.includes(':pending-record-id:')
    ? `${surfaceId}:${recordId}:${clientHandoffState.intent}`
    : clientHandoffState.resumeToken;
  const nextPanel = dispatchTarget === 'operator-review-workbench'
    ? validationPanelForIntent(clientHandoffState.intent, acceptance.acceptedForDispatch)
    : dispatchTarget === 'operator-lifecycle-controls'
      ? 'handoff'
      : dispatchTarget === 'operator-boundary-review'
        ? 'validation'
      : dispatchTarget === 'operator-health-escalation'
        ? 'validation'
        : 'handoff';
  const primaryAction = dispatchTarget === 'operator-review-workbench'
    ? acceptance.acceptedByOperator ? 'complete-required-acknowledgements' : 'review-and-accept'
    : dispatchTarget === 'operator-lifecycle-controls'
      ? lifecycleControls.scheduleActive ? 'view-scheduled-dispatch' : 'update-lifecycle-controls'
      : dispatchTarget === 'operator-boundary-review'
        ? 'resolve-boundary-authorization'
      : dispatchTarget === 'kernel-provider-contract-negotiator'
        ? 'negotiate-provider-contracts'
      : dispatchTarget === 'operator-health-escalation'
        ? 'resolve-operational-health'
      : dispatchTarget === 'kernel-retry-scheduler'
        ? 'wait-for-retry-window'
        : readiness.status === 'dispatch-recorded'
          ? 'persist-proof'
          : 'dispatch-notification';
  const banner = operationalHealth.circuitOpen
    ? 'Dispatch is blocked until operational health is restored.'
    : operationalHealth.retryDelayed
      ? `Retry is scheduled for ${operationalHealth.retryAt}.`
    : dispatchTarget === 'operator-boundary-review'
      ? 'Dispatch is blocked by tenant or workspace authorization boundaries.'
    : !providerContracts.ready
      ? 'Dispatch is blocked until provider contracts negotiate required capabilities.'
    : lifecycleControls.scheduleActive
      ? `Dispatch is scheduled for ${lifecycleControls.nextEligibleAt}.`
      : !lifecycleControls.dispatchEnabled && acceptance.acceptedForDispatch
        ? 'Dispatch is held by lifecycle controls.'
        : acceptance.acceptedForDispatch
          ? 'Notifier record is ready for hosted-kernel handoff.'
          : 'Operator review is required before dispatch.';

  return {
    contract: 'NotifierRecordWorkflowHandoffV1',
    target: dispatchTarget,
    status: readiness.status,
    route: dispatchTarget === 'kernel-provider-contract-negotiator'
      ? '/kernel/audit-recovery/notifier-record/providers'
      : dispatchTarget === 'operator-boundary-review'
      ? '/kernel/audit-recovery/notifier-record/boundary'
      : acceptance.acceptedForDispatch && (!lifecycleControls.dispatchEnabled || lifecycleControls.scheduleActive)
      ? '/kernel/audit-recovery/notifier-record/lifecycle'
      : dispatchTarget === 'kernel-retry-scheduler'
      ? '/kernel/audit-recovery/notifier-record/dispatch'
      : acceptance.acceptedForDispatch && readiness.status === 'dispatch-recorded'
      ? '/kernel/audit-recovery/notifier-record/proof'
      : acceptance.acceptedForDispatch
        ? '/kernel/audit-recovery/notifier-record/dispatch'
        : '/kernel/audit-recovery/notifier-record/review',
    method: dispatchTarget === 'kernel-provider-contract-negotiator'
      ? 'PATCH'
      : dispatchTarget === 'operator-boundary-review'
      ? 'PATCH'
      : acceptance.acceptedForDispatch && (!lifecycleControls.dispatchEnabled || lifecycleControls.scheduleActive)
      ? 'PATCH'
      : dispatchTarget === 'kernel-retry-scheduler'
      ? 'POST'
      : acceptance.acceptedForDispatch && readiness.status === 'dispatch-recorded'
        ? 'PUT'
        : acceptance.acceptedForDispatch ? 'POST' : 'PATCH',
    generatedAt,
    resumeToken: handoffResumeToken,
    clientWorkflow: {
      contract: 'NotifierRecordClientWorkflowHandoffV1',
      intent: clientHandoffState.intent,
      previousStatus: clientHandoffState.previousStatus,
      requestedTarget: clientHandoffState.requestedTarget,
      nextPanel,
      primaryAction,
      banner,
      sourcePanel: clientHandoffState.sourcePanel,
      returnPanel: clientHandoffState.returnPanel,
      clientConsumed: clientHandoffState.clientConsumed,
      visibleCommandIds: enabledCommands.map((command) => command.commandId),
      validationIssueCodes: clientHandoffState.validationIssues.map((issue) => issue.code)
    },
    trace: {
      traceId: requestContext.traceId,
      sessionId: requestContext.sessionId,
      actor: requestContext.actor,
      sourceRoute: requestContext.sourceRoute
    },
    boundary: {
      tenantId: boundaryContext.tenantId,
      workspaceId: boundaryContext.workspaceId,
      isolationMode: boundaryContext.isolationMode,
      allowedWorkspaceIds: boundaryContext.allowedWorkspaceIds,
      dispatchAllowed: boundaryContext.dispatchAllowed,
      auditHandoffAllowed: boundaryContext.auditHandoffAllowed,
      authorizationDecision: boundaryAuthorization.decision,
      authorizationScopeStatus: boundaryAuthorization.scopeStatus,
      deniedReasons: boundaryAuthorization.deniedReasons
    },
    providerContracts: {
      ready: providerContracts.ready,
      blockedRoles: providerContracts.blockedRoles,
      boundaryBlockedRoles: providerContracts.boundaryBlockedRoles,
      unavailableRoles: providerContracts.unavailableRoles,
      syncRequiredRoles: providerContracts.syncRequiredRoles,
      negotiationState: providerContracts.capabilityNegotiation.handoffState,
      externalHandoffState: providerContracts.externalHandoffState
    },
    payload: {
      surfaceId,
      recordId,
      tenantId: boundaryContext.tenantId,
      workspaceId: boundaryContext.workspaceId,
      recipientIds: recipients.map((recipient) => recipient.id),
      evidenceIds: evidence.map((item) => item.id),
      acceptedForDispatch: acceptance.acceptedForDispatch,
      resumeToken: handoffResumeToken,
      idempotencyKeys: enabledCommands.map((command) => command.idempotencyKey),
      operationalMode: operationalHealth.degradedMode ? 'degraded' : 'normal',
      retryPolicy: operationalHealth.retryPolicy,
      retryAt: operationalHealth.retryAt,
      retryWindowOpen: operationalHealth.retryWindowOpen,
      failureState: operationalHealth.failureState,
      lifecycleMode: lifecycleControls.mode,
      commandPolicy: lifecycleControls.commandPolicy,
      lifecycleCommand: lifecycleControls.lifecycleCommand.command,
      lifecycleCommandAccepted: lifecycleControls.lifecycleCommand.accepted,
      lifecycleNextOperatorAction: lifecycleControls.nextOperatorAction,
      nextEligibleAt: lifecycleControls.nextEligibleAt,
      providerContractStatus: providerContracts.ready ? 'ready' : 'blocked',
      providerBlockedRoles: providerContracts.blockedRoles,
      providerBoundaryBlockedRoles: providerContracts.boundaryBlockedRoles,
      providerIds: providerContracts.descriptors.map((descriptor) => descriptor.providerId),
      providerNegotiationState: providerContracts.capabilityNegotiation.handoffState,
      externalHandoffState: providerContracts.externalHandoffState.state,
      boundaryAuthorizationDecision: boundaryAuthorization.decision,
      boundaryDeniedReasons: boundaryAuthorization.deniedReasons,
      proofPartition: boundaryAuthorization.proofPartition,
      actionableErrorCodes: operationalHealth.actionableErrors.map((error) => error.code)
    }
  };
}

function validationPanelForIntent(intent, acceptedForDispatch) {
  if (acceptedForDispatch) return 'handoff';
  if (intent === 'open-proof' || intent === 'resume-dispatch') return 'acceptance';
  if (intent === 'escalate-health') return 'validation';
  return 'draft';
}

function normalizeHistorySnapshots(input, generatedAt) {
  const persisted = asPlainObject(input.persistedState);
  const commandLog = Array.isArray(persisted.commandLog) ? persisted.commandLog : [];
  const candidateGroups = [
    input.historySnapshots,
    input.history,
    input.timeline,
    persisted.historySnapshots,
    persisted.history,
    persisted.timeline
  ];
  const snapshots = candidateGroups.find((group) => Array.isArray(group)) || [];
  const normalizedSnapshots = snapshots
    .map((snapshot, index) => {
      if (typeof snapshot === 'string') {
        const event = snapshot.trim();
        return event
          ? {
              contract: 'NotifierRecordHistorySnapshotV1',
              sequence: index + 1,
              status: 'noted',
              event,
              capturedAt: generatedAt,
              actor: null,
              recordId: null,
              issueCount: 0,
              blockingIssueCount: 0,
              recipientCount: 0,
              evidenceCount: 0,
              retryCount: 0,
              source: 'operator-history'
            }
          : null;
      }

      const item = asPlainObject(snapshot);
      if (Object.keys(item).length === 0) return null;

      return {
        contract: 'NotifierRecordHistorySnapshotV1',
        sequence: asNonNegativeInteger(item.sequence ?? item.index, index + 1),
        status: firstNonEmptyString(item.status, item.state, item.readiness) || 'observed',
        event: firstNonEmptyString(item.event, item.action, item.label) || 'notifier-record-observed',
        capturedAt: asIsoTimestamp(item.capturedAt || item.generatedAt || item.at, generatedAt),
        actor: asNonEmptyString(item.actor),
        recordId: firstNonEmptyString(item.recordId, item.auditRecordId),
        issueCount: asNonNegativeInteger(item.issueCount, 0),
        blockingIssueCount: asNonNegativeInteger(item.blockingIssueCount, 0),
        recipientCount: asNonNegativeInteger(item.recipientCount, 0),
        evidenceCount: asNonNegativeInteger(item.evidenceCount, 0),
        retryCount: asNonNegativeInteger(item.retryCount, 0),
        source: firstNonEmptyString(item.source, item.kind) || 'operator-history'
      };
    })
    .filter(Boolean);
  const nextSequence = normalizedSnapshots.reduce((max, snapshot) => Math.max(max, snapshot.sequence), 0) + 1;
  const commandSnapshots = commandLog
    .map((command, index) => ({ command: asPlainObject(command), index }))
    .filter(({ command }) => Object.keys(command).length > 0)
    .map(({ command, index }) => ({
      contract: 'NotifierRecordHistorySnapshotV1',
      sequence: nextSequence + index,
      status: firstNonEmptyString(command.status, command.result) || 'command-observed',
      event: firstNonEmptyString(command.action, command.command, command.commandId, command.id) || 'command-observed',
      capturedAt: asIsoTimestamp(command.capturedAt || command.completedAt || command.generatedAt || command.at, generatedAt),
      actor: asNonEmptyString(command.actor),
      recordId: firstNonEmptyString(command.recordId, command.auditRecordId),
      issueCount: asNonNegativeInteger(command.issueCount, 0),
      blockingIssueCount: asNonNegativeInteger(command.blockingIssueCount, 0),
      recipientCount: asNonNegativeInteger(command.recipientCount, 0),
      evidenceCount: asNonNegativeInteger(command.evidenceCount, 0),
      retryCount: asNonNegativeInteger(command.retryCount, 0),
      source: 'persisted-command-log',
      commandId: firstNonEmptyString(command.commandId, command.id),
      idempotencyKey: asNonEmptyString(command.idempotencyKey)
    }));

  return [...normalizedSnapshots, ...commandSnapshots]
    .sort((left, right) => left.sequence - right.sequence);
}

function stageState({ complete, blocked, active }) {
  if (blocked) return 'blocked';
  if (complete) return 'complete';
  return active ? 'active' : 'pending';
}

function buildAnalyticsExports({ recordId, severity, recipients, evidence, requestContext, validation, acceptance, readiness, persistedState, boundaryContext, boundaryAuthorization, operationalHealth, lifecycleControls, providerContracts, mailchimpDispatchContext, generatedAt, idempotentCommands, workflowHandoff, historySnapshots }) {
  const warningIssueCount = validation.issues.filter((issue) => issue.severity === 'warning').length;
  const enabledCommands = idempotentCommands.filter((command) => command.enabled);
  const disabledCommands = idempotentCommands.filter((command) => !command.enabled);
  const historicalRetryCount = historySnapshots.reduce((total, snapshot) => total + snapshot.retryCount, 0);
  const commandStateCounts = countBy(idempotentCommands, (command) => command.enabled ? 'enabled' : command.disabledReason || 'disabled');
  const recipientChannelCounts = countBy(recipients, (recipient) => recipient.channel);
  const evidenceKindCounts = countBy(evidence, (item) => item.kind);
  const historyStatusCounts = countBy(historySnapshots, (snapshot) => snapshot.status);
  const historySourceCounts = countBy(historySnapshots, (snapshot) => snapshot.source);
  const providerHealthCounts = countBy(providerContracts.descriptors, (descriptor) => descriptor.health);
  const issueSeverityCounts = countBy(validation.issues, (issue) => issue.severity);
  const lastHistorySnapshot = historySnapshots[historySnapshots.length - 1] || null;
  const lastSnapshotMs = lastHistorySnapshot ? new Date(lastHistorySnapshot.capturedAt).getTime() : null;
  const generatedMs = new Date(generatedAt).getTime();
  const historyAgeMs = Number.isFinite(lastSnapshotMs) ? Math.max(0, generatedMs - lastSnapshotMs) : null;
  const runtimeSequence = historySnapshots.reduce((max, snapshot) => Math.max(max, snapshot.sequence), 0) + 1;
  const runtimeSnapshot = {
    contract: 'NotifierRecordHistorySnapshotV1',
    sequence: runtimeSequence,
    status: readiness.status,
    event: acceptance.acceptedForDispatch ? 'dispatch-readiness-computed' : 'operator-review-computed',
    capturedAt: generatedAt,
    actor: requestContext.actor,
    recordId,
    issueCount: validation.issueCount,
    blockingIssueCount: validation.blockingIssueCount,
    recipientCount: recipients.length,
    evidenceCount: evidence.length,
    retryCount: operationalHealth.retryCount,
    source: 'runtime-projection'
  };
  const mailchimpAnalytics = buildMailchimpDispatchAnalytics({
    mailchimpDispatchContext,
    readiness,
    acceptance,
    generatedAt,
    historySnapshots
  });
  const history = [
    ...historySnapshots,
    runtimeSnapshot,
    ...(mailchimpAnalytics.historySnapshot ? [mailchimpAnalytics.historySnapshot] : [])
  ];
  const boundaryBlocked = boundaryAuthorization.decision === 'deny-boundary' || (acceptance.acceptedForDispatch && !boundaryAuthorization.authorizedForDispatch);
  const blocked = validation.blockingIssueCount > 0 || boundaryBlocked || operationalHealth.circuitOpen || operationalHealth.retryDelayed || (!lifecycleControls.dispatchEnabled && acceptance.acceptedForDispatch) || (acceptance.acceptedForDispatch && !providerContracts.ready);
  const exportable = Boolean(recordId && boundaryContext.tenantId && boundaryContext.workspaceId);
  const timeline = [
    {
      key: 'draft',
      label: 'Draft',
      state: stageState({ complete: Boolean(recordId && severity), blocked: false, active: !recordId || !severity }),
      at: generatedAt
    },
    {
      key: 'validation',
      label: 'Validation',
      state: stageState({ complete: validation.valid, blocked: validation.blockingIssueCount > 0, active: !validation.valid }),
      issueCount: validation.issueCount,
      blockingIssueCount: validation.blockingIssueCount,
      at: generatedAt
    },
    {
      key: 'acceptance',
      label: 'Acceptance',
      state: stageState({ complete: acceptance.acceptedForDispatch, blocked: validation.blockingIssueCount > 0, active: validation.valid && !acceptance.acceptedForDispatch }),
      missingAcknowledgementCount: acceptance.missingAcknowledgements.length,
      at: generatedAt
    },
    {
      key: 'dispatch',
      label: 'Dispatch',
      state: stageState({ complete: ['dispatch-recorded', 'proof-persisted'].includes(readiness.status), blocked, active: readiness.canDispatch }),
      target: workflowHandoff.target,
      enabledCommandCount: enabledCommands.length,
      at: generatedAt
    },
    {
      key: 'lifecycle',
      label: 'Lifecycle',
      state: stageState({ complete: lifecycleControls.dispatchEnabled && !lifecycleControls.scheduleActive, blocked: !lifecycleControls.dispatchEnabled, active: lifecycleControls.scheduleActive }),
      mode: lifecycleControls.mode,
      schedulingMode: lifecycleControls.schedulingMode,
      commandPolicy: lifecycleControls.commandPolicy,
      nextEligibleAt: lifecycleControls.nextEligibleAt,
      validationIssueCount: lifecycleControls.validationIssues.length,
      at: generatedAt
    },
    {
      key: 'proof',
      label: 'Proof',
      state: stageState({ complete: readiness.status === 'proof-persisted', blocked: operationalHealth.proofStoreStatus === 'unavailable', active: acceptance.acceptedForDispatch && readiness.status !== 'proof-persisted' }),
      proofStoreStatus: operationalHealth.proofStoreStatus,
      at: generatedAt
    },
    {
      key: 'providers',
      label: 'Providers',
      state: stageState({ complete: providerContracts.ready, blocked: !providerContracts.ready, active: providerContracts.syncRequiredRoles.length > 0 }),
      blockedRoles: providerContracts.blockedRoles,
      boundaryBlockedRoles: providerContracts.boundaryBlockedRoles,
      unavailableRoles: providerContracts.unavailableRoles,
      syncRequiredRoles: providerContracts.syncRequiredRoles,
      negotiationState: providerContracts.capabilityNegotiation.handoffState,
      externalHandoffState: providerContracts.externalHandoffState.state,
      at: generatedAt
    },
    {
      key: 'mailchimp',
      label: 'Mailchimp',
      state: stageState({
        complete: mailchimpAnalytics.present && ['dispatch-ready', 'accepted'].includes(mailchimpAnalytics.status),
        blocked: mailchimpAnalytics.status === 'blocked',
        active: mailchimpAnalytics.present && mailchimpAnalytics.status === 'send-window-held'
      }),
      status: mailchimpAnalytics.status,
      campaignId: mailchimpDispatchContext?.campaignId || null,
      audienceId: mailchimpDispatchContext?.audienceId || null,
      nextEligibleAt: mailchimpDispatchContext?.nextEligibleAt || null,
      proofRefCount: mailchimpAnalytics.counters.proofRefCount,
      at: generatedAt
    }
  ];
  const counters = {
    contract: 'NotifierRecordAnalyticsCountersV1',
    recipientCount: recipients.length,
    evidenceCount: evidence.length,
    acknowledgementCount: acceptance.receivedAcknowledgements.length,
    missingAcknowledgementCount: acceptance.missingAcknowledgements.length,
    validationIssueCount: validation.issueCount,
    blockingIssueCount: validation.blockingIssueCount,
    warningIssueCount,
    enabledCommandCount: enabledCommands.length,
    retryCount: operationalHealth.retryCount,
    historicalRetryCount,
    retryBudgetRemaining: operationalHealth.retryBudgetRemaining,
    retryDelayed: operationalHealth.retryDelayed ? 1 : 0,
    retryWindowOpen: operationalHealth.retryWindowOpen ? 1 : 0,
    operationalHealthIssueCount: operationalHealth.validationIssues.length,
    historySnapshotCount: history.length,
    terminalHistorySnapshotCount: history.filter((snapshot) => TERMINAL_PERSISTED_STATUSES.includes(snapshot.status)).length,
    actionableErrorCount: operationalHealth.actionableErrors.length,
    recoveredCommandCount: persistedState.commandCount,
    lifecycleIssueCount: lifecycleControls.validationIssues.length,
    lifecycleCommandRequested: lifecycleControls.lifecycleCommand.command ? 1 : 0,
    lifecycleCommandAccepted: lifecycleControls.lifecycleCommand.accepted ? 1 : 0,
    lifecycleCommandBlocked: lifecycleControls.lifecycleCommand.commandBlockers.length > 0 ? 1 : 0,
    scheduledDispatchActive: lifecycleControls.scheduleActive ? 1 : 0,
    recoveredDispatchCompleted: commandLedgerHasOperation(persistedState, 'dispatch') ? 1 : 0,
    recoveredProofCompleted: commandLedgerHasOperation(persistedState, 'persist-proof') ? 1 : 0,
    recoveredStatePersisted: commandLedgerHasOperation(persistedState, 'persist-state') ? 1 : 0,
    recoveredLifecycleApplied: commandLedgerHasOperation(persistedState, 'apply-lifecycle') ? 1 : 0,
    mailchimpPresent: mailchimpAnalytics.present ? 1 : 0,
    mailchimpCampaignBound: mailchimpAnalytics.counters.campaignBound,
    mailchimpAudienceBound: mailchimpAnalytics.counters.audienceBound,
    mailchimpTemplateBound: mailchimpAnalytics.counters.templateBound,
    mailchimpProofRefCount: mailchimpAnalytics.counters.proofRefCount,
    mailchimpValidationIssueCount: mailchimpAnalytics.counters.validationIssueCount,
    mailchimpSendWindowHoldActive: mailchimpAnalytics.counters.sendWindowHoldActive,
    providerUnavailableRoleCount: providerContracts.unavailableRoles.length,
    providerBlockedRoleCount: providerContracts.blockedRoles.length,
    providerBoundaryBlockedRoleCount: providerContracts.boundaryBlockedRoles.length,
    providerSyncRequiredRoleCount: providerContracts.syncRequiredRoles.length,
    boundaryDeniedReasonCount: boundaryAuthorization.deniedReasons.length,
    boundaryViolationCount: boundaryAuthorization.boundaryViolations.length,
    disabledCommandCount: disabledCommands.length,
    recipientChannelCounts,
    evidenceKindCounts,
    historyStatusCounts,
    historySourceCounts,
    providerHealthCounts,
    issueSeverityCounts
  };
  const statusBucket = blocked
    ? 'blocked'
    : readiness.status === 'proof-persisted'
      ? 'closed'
      : acceptance.acceptedForDispatch
        ? 'handoff-ready'
        : validation.valid
          ? 'awaiting-operator'
          : 'drafting';

  return {
    contract: 'NotifierRecordAnalyticsExportsV1',
    generatedAt,
    counters,
    history,
    timeline,
    reportingState: {
      contract: 'NotifierRecordReportingStateV1',
      statusBucket,
      dashboardKey: `${surfaceId}:${boundaryContext.tenantId || 'unbound'}:${boundaryContext.workspaceId || 'unbound'}:${statusBucket}`,
      severity: severity || 'unclassified',
      readinessStatus: readiness.status,
      operationalMode: operationalHealth.degradedMode ? 'degraded' : 'normal',
      failureState: operationalHealth.failureState.state,
      retryAt: operationalHealth.retryAt,
      retryWindowOpen: operationalHealth.retryWindowOpen,
      lifecycleMode: lifecycleControls.mode,
      commandPolicy: lifecycleControls.commandPolicy,
      lifecycleCommand: lifecycleControls.lifecycleCommand.command,
      lifecycleNextOperatorAction: lifecycleControls.nextOperatorAction,
      providerContractStatus: providerContracts.ready ? 'ready' : 'blocked',
      providerNegotiationState: providerContracts.capabilityNegotiation.handoffState,
      providerBlockedRoles: providerContracts.blockedRoles,
      providerBoundaryBlockedRoles: providerContracts.boundaryBlockedRoles,
      boundaryAuthorizationDecision: boundaryAuthorization.decision,
      boundaryScopeStatus: boundaryAuthorization.scopeStatus,
      providerSyncRequired: providerContracts.syncRequiredRoles.length > 0,
      mailchimp: mailchimpAnalytics.reportingPatch,
      owner: blocked ? 'tenant-audit-operator' : workflowHandoff.target,
      needsAttention: blocked || lifecycleControls.validationIssues.length > 0 || acceptance.missingAcknowledgements.length > 0 || warningIssueCount > 0,
      exportReady: exportable,
      historyAgeMs,
      lastHistoryStatus: lastHistorySnapshot ? lastHistorySnapshot.status : null,
      lastHistorySource: lastHistorySnapshot ? lastHistorySnapshot.source : null,
      stalled: Boolean(historyAgeMs !== null && historyAgeMs > 24 * 60 * 60 * 1000 && !TERMINAL_PERSISTED_STATUSES.includes(readiness.status)),
      commandStateCounts
    },
    exportSummary: {
      contract: 'NotifierRecordExportSummaryV1',
      exportKey: `${surfaceId}:${recordId || 'pending-record-id'}:${generatedAt}`,
      partition: {
        tenantId: boundaryContext.tenantId,
        workspaceId: boundaryContext.workspaceId,
        generatedDate: generatedAt.slice(0, 10)
      },
      row: {
        surfaceId,
        recordId,
        severity: severity || 'unclassified',
        status: readiness.status,
        statusBucket,
        recipientCount: recipients.length,
        evidenceCount: evidence.length,
        validationIssueCount: validation.issueCount,
        blockingIssueCount: validation.blockingIssueCount,
        acceptedForDispatch: acceptance.acceptedForDispatch,
        recoveredFromState: readiness.recoveredFromState,
        retryCount: operationalHealth.retryCount,
        retryPolicy: operationalHealth.retryPolicy,
        failureState: operationalHealth.failureState.state,
        retryAt: operationalHealth.retryAt,
        retryWindowOpen: operationalHealth.retryWindowOpen,
        lifecycleMode: lifecycleControls.mode,
        commandPolicy: lifecycleControls.commandPolicy,
        lifecycleCommand: lifecycleControls.lifecycleCommand.command,
        lifecycleCommandAccepted: lifecycleControls.lifecycleCommand.accepted,
        lifecycleNextOperatorAction: lifecycleControls.nextOperatorAction,
        nextEligibleAt: lifecycleControls.nextEligibleAt,
        handoffTarget: workflowHandoff.target,
        providerContractStatus: providerContracts.ready ? 'ready' : 'blocked',
        providerNegotiationState: providerContracts.capabilityNegotiation.handoffState,
        providerBlockedRoles: providerContracts.blockedRoles,
        providerBoundaryBlockedRoles: providerContracts.boundaryBlockedRoles,
        boundaryAuthorizationDecision: boundaryAuthorization.decision,
        boundaryDeniedReasons: boundaryAuthorization.deniedReasons,
        providerUnavailableRoles: providerContracts.unavailableRoles,
        providerSyncRequiredRoles: providerContracts.syncRequiredRoles,
        ...mailchimpAnalytics.exportRowPatch,
        traceId: requestContext.traceId,
        actor: requestContext.actor,
        generatedAt
      },
      enabledCommandIds: enabledCommands.map((command) => command.commandId),
      actionableErrorCodes: operationalHealth.actionableErrors.map((error) => error.code),
      mailchimp: mailchimpAnalytics.present ? mailchimpAnalytics.exportRowPatch : null
    },
    exportBatches: {
      contract: 'NotifierRecordAnalyticsExportBatchesV1',
      ready: exportable,
      blockedReason: exportable ? null : 'record-tenant-workspace-required',
      destinations: [
        {
          name: 'notifier-record-counters',
          route: '/kernel/audit-recovery/notifier-record/analytics/counters',
          method: 'PUT',
          payloadContract: 'NotifierRecordAnalyticsCountersV1',
          idempotencyKey: `${surfaceId}:${boundaryContext.tenantId || 'unbound'}:${boundaryContext.workspaceId || 'unbound'}:${recordId || 'pending-record-id'}:counters:${generatedAt}`,
          rows: [
            {
              recordId,
              generatedAt,
              statusBucket,
              readinessStatus: readiness.status,
              ...counters
            }
          ]
        },
        {
          name: 'notifier-record-history',
          route: '/kernel/audit-recovery/notifier-record/analytics/history',
          method: 'PUT',
          payloadContract: 'NotifierRecordHistorySnapshotV1',
          idempotencyKey: `${surfaceId}:${boundaryContext.tenantId || 'unbound'}:${boundaryContext.workspaceId || 'unbound'}:${recordId || 'pending-record-id'}:history:${history.length}`,
          rows: history.map((snapshot) => ({
            ...snapshot,
            tenantId: boundaryContext.tenantId,
            workspaceId: boundaryContext.workspaceId,
            surfaceId
          }))
        },
        {
          name: 'notifier-record-timeline',
          route: '/kernel/audit-recovery/notifier-record/analytics/timeline',
          method: 'PUT',
          payloadContract: 'NotifierRecordTimelineStageV1',
          idempotencyKey: `${surfaceId}:${boundaryContext.tenantId || 'unbound'}:${boundaryContext.workspaceId || 'unbound'}:${recordId || 'pending-record-id'}:timeline:${generatedAt}`,
          rows: timeline.map((stage) => ({
            ...stage,
            recordId,
            tenantId: boundaryContext.tenantId,
            workspaceId: boundaryContext.workspaceId,
            statusBucket
          }))
        },
        ...(mailchimpAnalytics.exportBatch ? [mailchimpAnalytics.exportBatch] : [])
      ]
    }
  };
}

function buildRuntimeAdoptionPacket({
  recordId,
  requestContext,
  validation,
  acceptance,
  readiness,
  boundaryAuthorization,
  operationalHealth,
  lifecycleControls,
  providerContracts,
  workflowHandoff,
  clientHandoffState,
  analyticsExports,
  nextSteps,
  idempotentCommands,
  generatedAt
}) {
  const enabledCommands = idempotentCommands.filter((command) => command.enabled);
  const blockedCommands = idempotentCommands.filter((command) => !command.enabled);
  const dispatchCommand = enabledCommands.find((command) => command.payloadContract === 'NotifierRecordDispatchRequestV1') || null;
  const proofCommand = enabledCommands.find((command) => command.payloadContract === 'NotifierRecordProofPersistRequestV1') || null;
  const primaryStep = nextSteps[0] || null;
  const exportReady = analyticsExports.exportBatches.ready && analyticsExports.reportingState.exportReady;
  const providerReadyForHandoff = providerContracts.ready
    && providerContracts.externalHandoffState.negotiationState === 'remote-ready';
  const clientCanAdopt = Boolean(
    requestContext.sessionId
    && workflowHandoff.resumeToken
    && clientHandoffState.validationIssues.length === 0
    && !clientHandoffState.clientConsumed
  );
  const blockedReasons = uniqueStrings([
    ...validation.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.code),
    ...boundaryAuthorization.deniedReasons.map((reason) => `boundary:${reason}`),
    ...operationalHealth.actionableErrors.filter((error) => error.severity === 'error').map((error) => error.code),
    ...blockedCommands.map((command) => command.disabledReason),
    ...providerContracts.blockedRoles.map((role) => `provider:${role}`),
    ...providerContracts.boundaryBlockedRoles.map((role) => `provider-boundary:${role}`),
    ...clientHandoffState.validationIssues.map((issue) => issue.code),
    lifecycleControls.scheduleActive ? 'dispatch-scheduled' : null,
    !lifecycleControls.dispatchEnabled && acceptance.acceptedForDispatch ? 'dispatch-disabled' : null
  ]);
  const adoptionState = !clientCanAdopt
    ? 'client-repair-required'
    : blockedReasons.length > 0
      ? 'blocked'
      : acceptance.acceptedForDispatch && readiness.canDispatch && dispatchCommand
        ? 'dispatch-adoptable'
        : acceptance.acceptedForDispatch && proofCommand
          ? 'proof-adoptable'
          : validation.valid
            ? 'review-adoptable'
            : 'draft-adoptable';

  return {
    contract: 'NotifierRecordRuntimeAdoptionPacketV1',
    generatedAt,
    recordKey: recordId ? `${surfaceId}:${recordId}` : `${surfaceId}:pending`,
    state: adoptionState,
    canAdopt: clientCanAdopt && blockedReasons.length === 0,
    sessionId: requestContext.sessionId,
    traceId: requestContext.traceId,
    requestedStep: requestContext.requestedStep,
    handoff: {
      intent: clientHandoffState.intent,
      target: workflowHandoff.target,
      route: workflowHandoff.route,
      method: workflowHandoff.method,
      resumeToken: workflowHandoff.resumeToken,
      previousStatus: clientHandoffState.previousStatus,
      nextPanel: workflowHandoff.clientWorkflow.nextPanel,
      primaryAction: workflowHandoff.clientWorkflow.primaryAction,
      banner: workflowHandoff.clientWorkflow.banner,
      requestedTarget: clientHandoffState.requestedTarget,
      requestedTargetMatched: !clientHandoffState.requestedTarget
        || clientHandoffState.requestedTarget === workflowHandoff.target
        || clientHandoffState.requestedTarget === workflowHandoff.route,
      consumed: clientHandoffState.clientConsumed
    },
    runtimeState: {
      readinessStatus: readiness.status,
      acceptanceReady: acceptance.acceptedForDispatch,
      validationValid: validation.valid,
      boundaryDecision: boundaryAuthorization.decision,
      retryWindowOpen: operationalHealth.retryWindowOpen,
      lifecycleMode: lifecycleControls.mode,
      dispatchEnabled: lifecycleControls.dispatchEnabled,
      scheduleActive: lifecycleControls.scheduleActive,
      providerReady: providerContracts.ready,
      providerReadyForHandoff,
      providerNegotiationState: providerContracts.externalHandoffState.negotiationState,
      exportReady
    },
    exportSummary: {
      exportKey: analyticsExports.exportSummary.exportKey,
      dashboardKey: analyticsExports.reportingState.dashboardKey,
      statusBucket: analyticsExports.reportingState.statusBucket,
      ready: exportReady,
      batchCount: analyticsExports.exportBatches.destinations.length,
      blockedReason: analyticsExports.exportBatches.blockedReason
    },
    commandAdoption: {
      enabledCommandCount: enabledCommands.length,
      blockedCommandCount: blockedCommands.length,
      visibleCommandIds: enabledCommands.map((command) => command.commandId),
      dispatchCommandId: dispatchCommand?.commandId || null,
      proofCommandId: proofCommand?.commandId || null,
      disabledReasons: uniqueStrings(blockedCommands.map((command) => command.disabledReason)).slice(0, 10)
    },
    nextAction: primaryStep ? {
      action: primaryStep.action,
      route: primaryStep.route,
      method: primaryStep.method,
      payloadContract: primaryStep.payloadContract,
      handoffState: primaryStep.handoffState,
      clientWorkflow: primaryStep.clientWorkflow
    } : {
      action: workflowHandoff.clientWorkflow.primaryAction,
      route: workflowHandoff.route,
      method: workflowHandoff.method,
      payloadContract: 'NotifierRecordWorkflowHandoff',
      handoffState: readiness.status,
      clientWorkflow: workflowHandoff.clientWorkflow
    },
    blockedReasons: blockedReasons.slice(0, 16),
    routeContract: {
      route: '/kernel/audit-recovery/notifier-record/runtime/adopt',
      method: 'PATCH',
      requestSchema: 'NotifierRecordRuntimeAdoptionRequestV1',
      responseSchema: 'NotifierRecordRuntimeAdoptionPacketV1',
      idempotencyKey: `${surfaceId}:${recordId || 'pending-record-id'}:${workflowHandoff.resumeToken}:runtime-adoption`
    }
  };
}

function buildOperatorDispatchDecision({
  recordId,
  requestContext,
  boundaryContext,
  boundaryAuthorization,
  preview,
  uiReview,
  acceptance,
  readiness,
  operationalHealth,
  lifecycleControls,
  providerContracts,
  persistedStateEnvelope,
  idempotentCommands,
  workflowHandoff,
  clientHandoffState,
  analyticsExports,
  nextSteps,
  generatedAt
}) {
  const enabledCommands = idempotentCommands.filter((command) => command.enabled);
  const disabledCommands = idempotentCommands.filter((command) => !command.enabled);
  const dispatchCommand = idempotentCommands.find((command) => command.payloadContract === 'NotifierRecordDispatchRequestV1') || null;
  const proofCommand = idempotentCommands.find((command) => command.payloadContract === 'NotifierRecordProofPersistRequestV1') || null;
  const persistStateCommand = idempotentCommands.find((command) => command.payloadContract === 'NotifierRecordPersistStateRequestV1') || null;
  const primaryStep = nextSteps[0] || {
    action: uiReview.nextAction.action,
    route: uiReview.nextAction.route,
    method: uiReview.nextAction.method,
    payloadContract: 'NotifierRecordRouteReviewPacketV1',
    handoffState: readiness.status
  };
  const blockingReasons = uniqueStrings([
    ...uiReview.blockerCodes,
    ...disabledCommands.map((command) => command.disabledReason),
    ...boundaryAuthorization.deniedReasons.map((reason) => `boundary:${reason}`),
    ...providerContracts.blockedRoles.map((role) => `provider:${role}`),
    ...providerContracts.boundaryBlockedRoles.map((role) => `provider-boundary:${role}`),
    ...providerContracts.unavailableRoles.map((role) => `provider-unavailable:${role}`),
    ...operationalHealth.actionableErrors
      .filter((error) => error.severity === 'error')
      .map((error) => error.code)
  ]);
  const dispatchReady = Boolean(
    acceptance.acceptedForDispatch
    && readiness.canDispatch
    && dispatchCommand
    && dispatchCommand.enabled
    && boundaryAuthorization.authorizedForDispatch
    && providerContracts.ready
  );
  const proofReady = Boolean(
    acceptance.acceptedForDispatch
    && proofCommand
    && proofCommand.enabled
    && lifecycleControls.proofPersistenceEnabled
    && boundaryAuthorization.authorizedForProof
  );
  const previewAcceptable = Boolean(
    preview.recipientCount > 0
    && uiReview.previewReady
    && uiReview.acceptanceReady
    && !persistedStateEnvelope.terminal
  );
  const retryBlocked = operationalHealth.retryDelayed || operationalHealth.circuitOpen;
  const decision = dispatchReady
    ? 'dispatch-ready'
    : proofReady && readiness.status === 'dispatch-recorded'
      ? 'proof-ready'
      : retryBlocked
        ? 'retry-held'
        : !acceptance.acceptedForDispatch
          ? previewAcceptable ? 'awaiting-operator-acceptance' : 'draft-blocked'
          : !providerContracts.ready
            ? 'provider-blocked'
            : !lifecycleControls.dispatchEnabled || lifecycleControls.scheduleActive
              ? 'lifecycle-held'
              : boundaryAuthorization.decision === 'deny-boundary'
                ? 'boundary-blocked'
                : 'operator-action-required';
  const selectedCommand = dispatchReady
    ? dispatchCommand
    : proofReady
      ? proofCommand
      : persistStateCommand;

  return {
    contract: 'NotifierRecordOperatorDispatchDecisionV1',
    generatedAt,
    decision,
    recordKey: recordId ? `${surfaceId}:${recordId}` : `${surfaceId}:pending`,
    traceId: requestContext.traceId,
    tenantId: boundaryContext.tenantId,
    workspaceId: boundaryContext.workspaceId,
    route: selectedCommand ? selectedCommand.route : primaryStep.route,
    method: selectedCommand ? selectedCommand.method : primaryStep.method,
    payloadContract: selectedCommand ? selectedCommand.payloadContract : primaryStep.payloadContract,
    commandId: selectedCommand ? selectedCommand.commandId : null,
    idempotencyKey: selectedCommand ? selectedCommand.idempotencyKey : null,
    canSubmit: Boolean(selectedCommand && selectedCommand.enabled && ['dispatch-ready', 'proof-ready'].includes(decision)),
    previewGate: {
      ready: uiReview.previewReady,
      acceptable: previewAcceptable,
      recipientCount: preview.recipientCount,
      evidenceCount: preview.evidenceCount,
      missingClientFields: uiReview.routePayloadContracts
        .filter((contract) => contract.panel === 'preview' || contract.panel === 'acceptance')
        .flatMap((contract) => contract.missingClientFields)
    },
    acceptanceGate: {
      acceptedForDispatch: acceptance.acceptedForDispatch,
      acceptedByOperator: acceptance.acceptedByOperator,
      missingAcknowledgements: acceptance.missingAcknowledgements,
      blockedReasons: acceptance.blockedReasons
    },
    dispatchGate: {
      readinessStatus: readiness.status,
      canDispatch: readiness.canDispatch,
      restartSafe: readiness.restartSafe,
      retryWindowOpen: operationalHealth.retryWindowOpen,
      retryAt: operationalHealth.retryAt,
      nextBackoffMs: operationalHealth.nextBackoffMs,
      failureState: operationalHealth.failureState.state
    },
    lifecycleGate: {
      mode: lifecycleControls.mode,
      dispatchEnabled: lifecycleControls.dispatchEnabled,
      scheduleActive: lifecycleControls.scheduleActive,
      nextEligibleAt: lifecycleControls.nextEligibleAt,
      nextOperatorAction: lifecycleControls.nextOperatorAction
    },
    providerGate: {
      ready: providerContracts.ready,
      negotiationState: providerContracts.capabilityNegotiation.handoffState,
      blockedRoles: providerContracts.blockedRoles,
      boundaryBlockedRoles: providerContracts.boundaryBlockedRoles,
      unavailableRoles: providerContracts.unavailableRoles,
      syncRequiredRoles: providerContracts.syncRequiredRoles,
      externalHandoffState: providerContracts.externalHandoffState.state
    },
    boundaryGate: {
      decision: boundaryAuthorization.decision,
      scopeStatus: boundaryAuthorization.scopeStatus,
      authorizedForDispatch: boundaryAuthorization.authorizedForDispatch,
      authorizedForProof: boundaryAuthorization.authorizedForProof,
      deniedReasons: boundaryAuthorization.deniedReasons
    },
    commandPlan: {
      enabledCommandIds: enabledCommands.map((command) => command.commandId),
      disabledCommands: disabledCommands.map((command) => ({
        commandId: command.commandId,
        action: command.action,
        disabledReason: command.disabledReason
      })),
      recoveredOperationSemantics: persistedStateEnvelope.replayGuards.recoveredOperationSemantics,
      terminalReadOnly: persistedStateEnvelope.terminal
    },
    handoff: {
      target: workflowHandoff.target,
      route: workflowHandoff.route,
      resumeToken: workflowHandoff.resumeToken,
      intent: clientHandoffState.intent,
      nextPanel: workflowHandoff.clientWorkflow.nextPanel,
      primaryAction: workflowHandoff.clientWorkflow.primaryAction
    },
    analytics: {
      statusBucket: analyticsExports.reportingState.statusBucket,
      needsAttention: analyticsExports.reportingState.needsAttention,
      exportReady: analyticsExports.reportingState.exportReady,
      dashboardKey: analyticsExports.reportingState.dashboardKey
    },
    blockingReasons,
    nextStep: {
      action: primaryStep.action,
      route: primaryStep.route,
      method: primaryStep.method,
      payloadContract: primaryStep.payloadContract,
      handoffState: primaryStep.handoffState
    }
  };
}

export function describeNotifierRecordSurface(input = {}) {
  const now = new Date().toISOString();
  const generatedAt = asIsoTimestamp(input.now, now);
  const requestContext = normalizeRequestContext(input);
  const persistedState = normalizePersistedState(input, generatedAt);
  const boundaryContext = normalizeBoundaryContext(input, persistedState);
  const lifecycleControls = normalizeLifecycleControls(input, generatedAt);
  const clientHandoffState = normalizeClientHandoffState(input, persistedState, generatedAt);
  const providerContracts = normalizeProviderContracts(input, boundaryContext, lifecycleControls, clientHandoffState, generatedAt);
  const mailchimpDispatchContext = normalizeMailchimpDispatchContext(input, persistedState, generatedAt);
  const recoveredDraft = resolveRecoveredDraft({ input, persistedState });
  const { recordId, severity, title, summary, recoveryAction } = recoveredDraft;
  const evidence = normalizeEvidence(input);
  const recipients = normalizeRecipients(input);
  const boundaryAuthorization = buildBoundaryAuthorization({ recipients, evidence, requestContext, boundaryContext, persistedState, generatedAt });
  const mailchimpDispatchGate = buildMailchimpDispatchHandoffGate({
    mailchimpDispatchContext,
    evidence,
    boundaryAuthorization,
    providerContracts,
    lifecycleControls,
    clientHandoffState,
    generatedAt
  });
  const acknowledgements = recoveredDraft.acknowledgements;
  const validation = summarizeValidation({ recordId, severity, recipients, evidence, recoveryAction, requestContext, boundaryContext, boundaryAuthorization, persistedState, lifecycleControls, clientHandoffState, providerContracts, mailchimpDispatchContext, mailchimpDispatchGate });
  const operationalHealth = normalizeOperationalHealth(input, persistedState, generatedAt);
  const preview = buildPreview({ recordId, severity, title, summary, recipients, evidence, generatedAt, requestContext, boundaryContext });
  const acceptance = buildAcceptance({ accepted: recoveredDraft.accepted, acknowledgements, validation, requestContext, persistedState });
  const readiness = buildRestartSafeReadiness({ acceptance, validation, generatedAt, persistedState, operationalHealth, lifecycleControls, providerContracts, boundaryAuthorization, mailchimpDispatchContext, mailchimpDispatchGate });
  const uiReview = buildUiReviewContract({ recordId, severity, preview, acceptance, readiness, validation, requestContext, boundaryContext, boundaryAuthorization, persistedState, operationalHealth, lifecycleControls, providerContracts, clientHandoffState, generatedAt });
  const persistedStateEnvelope = buildPersistedStateEnvelope({ recordId, severity, title, summary, recoveryAction, recipients, evidence, generatedAt, requestContext, persistedState, boundaryContext, boundaryAuthorization, validation, acceptance, readiness, operationalHealth, lifecycleControls, providerContracts, clientHandoffState, uiReview });
  const idempotentCommands = buildIdempotentCommands({ recordId, severity, title, summary, recoveryAction, recipients, evidence, generatedAt, requestContext, acceptance, readiness, persistedState, persistedStateEnvelope, boundaryContext, boundaryAuthorization, operationalHealth, lifecycleControls, providerContracts, validation, preview, uiReview });
  const workflowHandoff = buildWorkflowHandoff({ recordId, recipients, evidence, requestContext, acceptance, readiness, generatedAt, idempotentCommands, boundaryContext, boundaryAuthorization, operationalHealth, lifecycleControls, providerContracts, clientHandoffState });
  const historySnapshots = normalizeHistorySnapshots(input, generatedAt);
  const analyticsExports = buildAnalyticsExports({ recordId, severity, recipients, evidence, requestContext, validation, acceptance, readiness, persistedState, boundaryContext, boundaryAuthorization, operationalHealth, lifecycleControls, providerContracts, mailchimpDispatchContext, generatedAt, idempotentCommands, workflowHandoff, historySnapshots });
  const nextSteps = buildNextSteps({ acceptance, validation, recipients, requestContext, boundaryContext, boundaryAuthorization, operationalHealth, lifecycleControls, providerContracts, readiness, workflowHandoff, clientHandoffState });
  const runtimeAdoptionPacket = buildRuntimeAdoptionPacket({
    recordId,
    requestContext,
    validation,
    acceptance,
    readiness,
    boundaryAuthorization,
    operationalHealth,
    lifecycleControls,
    providerContracts,
    workflowHandoff,
    clientHandoffState,
    analyticsExports,
    nextSteps,
    idempotentCommands,
    generatedAt
  });
  const operatorDispatchDecision = buildOperatorDispatchDecision({
    recordId,
    requestContext,
    boundaryContext,
    boundaryAuthorization,
    preview,
    uiReview,
    acceptance,
    readiness,
    operationalHealth,
    lifecycleControls,
    providerContracts,
    persistedStateEnvelope,
    idempotentCommands,
    workflowHandoff,
    clientHandoffState,
    analyticsExports,
    nextSteps,
    generatedAt
  });
  const clientState = buildClientState({ recordId, severity, recipients, evidence, requestContext, validation, acceptance, readiness, persistedState, persistedStateEnvelope, boundaryContext, boundaryAuthorization, operationalHealth, lifecycleControls, providerContracts, analyticsExports, workflowHandoff, clientHandoffState, uiReview });
  clientState.runtimeAdoption = {
    contract: runtimeAdoptionPacket.contract,
    state: runtimeAdoptionPacket.state,
    canAdopt: runtimeAdoptionPacket.canAdopt,
    route: runtimeAdoptionPacket.routeContract.route,
    method: runtimeAdoptionPacket.routeContract.method,
    handoff: runtimeAdoptionPacket.handoff,
    runtimeState: runtimeAdoptionPacket.runtimeState,
    exportSummary: runtimeAdoptionPacket.exportSummary,
    commandAdoption: runtimeAdoptionPacket.commandAdoption,
    nextAction: runtimeAdoptionPacket.nextAction,
    blockedReasons: runtimeAdoptionPacket.blockedReasons
  };
  const operationallyBlocked = operationalHealth.actionableErrors.some((error) => error.severity === 'error');
  const lifecycleBlocked = acceptance.acceptedForDispatch && !lifecycleControls.dispatchEnabled;
  const providerBlocked = acceptance.acceptedForDispatch && !providerContracts.ready;

  return {
    ok: validation.valid && !operationallyBlocked && !lifecycleBlocked && !providerBlocked,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'NotifierRecordPreviewAcceptanceV1',
    dataContracts: {
      NotifierRecordDraft: {
        required: ['recordId', 'severity', 'recipients'],
        optional: ['title', 'summary', 'recoveryAction', 'evidence', 'accepted', 'acknowledgements']
      },
      NotifierRecordAcceptance: {
        required: ['accepted', 'acknowledgements'],
        requiredAcknowledgements: REQUIRED_ACKNOWLEDGEMENTS
      },
      NotifierRecordRuntimeContext: {
        required: ['sourceRoute'],
        optional: ['actor', 'sessionId', 'traceId', 'requestedStep', 'clientState']
      },
      NotifierRecordBoundaryContext: {
        required: ['tenantId', 'workspaceId'],
        optional: ['roles', 'permissions', 'allowedWorkspaceIds'],
        dispatchRoles: DISPATCH_ROLES,
        dispatchPermissions: DISPATCH_PERMISSIONS,
        isolationSemantics: ['tenant-workspace-bound', 'unbound']
      },
      NotifierRecordBoundaryAuthorization: {
        required: ['contract', 'evaluatedAt', 'tenantId', 'workspaceId', 'scopeStatus', 'decision', 'authorizedForPersist', 'authorizedForDispatch', 'authorizedForProof', 'deniedReasons', 'boundaryViolations', 'proofPartition'],
        decisions: ['allow-dispatch', 'allow-review-only', 'deny-boundary'],
        scopeStatuses: ['tenant-workspace-isolated', 'scope-conflict', 'scope-unbound']
      },
      NotifierRecordPersistedState: {
        required: ['version', 'status'],
        optional: ['snapshot', 'commandLog', 'lastKnownStatus', 'boundary', 'commandLedger', 'completedCommandIds', 'completedIdempotencyKeys', 'completedCommandOperations', 'completedOperationReplayKeys'],
        restartSemantics: TERMINAL_PERSISTED_STATUSES
      },
      NotifierRecordPersistedStateEnvelope: {
        required: ['contract', 'version', 'stateKey', 'generatedAt', 'status', 'previousStatus', 'restartSafe', 'recovered', 'restoreMode', 'terminal', 'revisionSeed', 'statusSemantics', 'snapshot', 'replayGuards', 'recoveredCommandLedger', 'recoveryPaths', 'blockedRecoveryCodes'],
        restartSafeStatuses: RESTART_SAFE_STATUSES,
        restoreModes: ['new-draft', 'resume-review', 'resume-dispatch', 'terminal-read-only'],
        consumedBy: ['clientState.recovery', 'idempotentCommands[].payload', 'proof.persistedStateEnvelope']
      },
      NotifierRecordPersistedReplayGuards: {
        required: ['contract', 'completedCommandIds', 'completedIdempotencyKeys', 'completedCommandOperations', 'completedOperationReplayKeys', 'preserveTerminalStatus', 'rejectDispatchReplay', 'rejectProofReplay', 'allowDraftOverwrite', 'allowLifecycleOverwrite', 'recoveredOperationSemantics'],
        semantics: ['same-idempotency-key-returns-existing-dispatch', 'terminal-status-is-read-only', 'draft-overwrite-denied-after-proof']
      },
      NotifierRecordRecoveryPath: {
        required: ['contract', 'path', 'enabled', 'nextStatus', 'route', 'method'],
        paths: ['restore-draft', 'resume-dispatch', 'open-proof', 'negotiate-providers']
      },
      NotifierRecordRecoveredCommandLedgerEntry: {
        required: ['contract', 'sequence', 'commandId', 'status', 'completed', 'replaySafe'],
        optional: ['idempotencyKey', 'replayKey', 'action', 'operation', 'capturedAt'],
        operations: Object.keys(COMMAND_OPERATION_ALIASES)
      },
      NotifierRecordRecoveredOperationReplaySemantics: {
        required: ['contract', 'recognizedOperations', 'dispatchCompleted', 'proofCompleted', 'statePersisted', 'lifecycleApplied'],
        operations: Object.keys(COMMAND_OPERATION_ALIASES),
        semantics: 'recovered command logs are matched by operation, route, payload contract, action, and command id before replay is allowed'
      },
      NotifierRecordIdempotentCommand: {
        required: ['commandId', 'idempotencyKey', 'action', 'route', 'method', 'payloadContract', 'payload', 'proofManifest', 'auditProjection', 'replayPolicy', 'enabled', 'tenantId', 'workspaceId'],
        optional: ['disabledReason', 'retryAfter', 'nextBackoffMs', 'persistedStateKey', 'persistedStateRevisionSeed', 'restartSafeStatus', 'replayGuards']
      },
      NotifierRecordLifecycleCommandRequest: {
        required: ['contract', 'lifecycleCommand', 'lifecycleControls', 'persistedStateEnvelope', 'boundary', 'validationIssueCodes', 'nextOperatorAction', 'stateStoreContract'],
        commands: LIFECYCLE_COMMANDS,
        replaySemantics: 'same-key-replaces-lifecycle-settings'
      },
      NotifierRecordPersistStateRequest: {
        required: ['contract', 'persistedStateEnvelope', 'draft', 'recipients', 'evidence', 'validation', 'acceptance', 'readiness', 'preview', 'uiReview', 'lifecycleControls', 'operationalHealth', 'persistedState', 'providerContract']
      },
      NotifierRecordDispatchRequest: {
        required: ['contract', 'notification', 'recipients', 'boundary', 'idempotencyKey', 'proofRequired', 'persistedStateEnvelope', 'providerContract', 'retryPolicy']
      },
      NotifierRecordProofPersistRequest: {
        required: ['contract', 'proofManifest', 'persistedStateEnvelope', 'previewHashSource', 'evidence', 'validationStatus', 'acceptanceStatus', 'readinessStatus', 'reportingPartition', 'providerContract']
      },
      NotifierRecordCommandProofManifest: {
        required: ['contract', 'surfaceId', 'recordId', 'generatedAt', 'traceId', 'tenantId', 'workspaceId', 'validationStatus', 'acceptanceStatus', 'readinessStatus', 'previewHashSource', 'evidenceIds', 'recipientIds', 'blockingIssueCodes', 'operationalMode', 'retryPolicy', 'lifecycleMode', 'commandPolicy', 'providerContractStatus', 'providerBlockedRoles', 'providerBoundaryBlockedRoles', 'providerNegotiationState', 'boundaryAuthorization', 'uiReviewStatus', 'nextAction']
      },
      NotifierRecordWorkflowHandoff: {
        required: ['contract', 'target', 'status', 'route', 'method', 'resumeToken', 'clientWorkflow', 'boundary', 'payload']
      },
      NotifierRecordClientHandoffState: {
        required: ['contract', 'intent', 'resumeToken', 'previousStatus', 'generatedAt', 'validationIssues'],
        optional: ['requestedTarget', 'sourcePanel', 'returnPanel', 'lastSeenAt', 'acknowledgedAt'],
        handoffIntents: HANDOFF_INTENTS
      },
      NotifierRecordClientWorkflowHandoff: {
        required: ['contract', 'intent', 'nextPanel', 'primaryAction', 'banner', 'visibleCommandIds', 'validationIssueCodes']
      },
      NotifierRecordUserVisibleWorkflowStep: {
        required: ['contract', 'intent', 'resolvedTarget', 'resumeToken', 'nextPanel', 'primaryAction', 'banner', 'route', 'method', 'externalHandoff'],
        optional: ['requestedTarget', 'requestedTargetMatched', 'sourcePanel', 'returnPanel'],
        consumedBy: ['nextSteps[].clientWorkflow', 'clientState.handoff']
      },
      NotifierRecordRuntimeAdoptionPacket: {
        required: ['contract', 'generatedAt', 'recordKey', 'state', 'canAdopt', 'handoff', 'runtimeState', 'exportSummary', 'commandAdoption', 'nextAction', 'blockedReasons', 'routeContract'],
        states: ['client-repair-required', 'blocked', 'dispatch-adoptable', 'proof-adoptable', 'review-adoptable', 'draft-adoptable'],
        consumedBy: ['clientState.runtimeAdoption', 'hosted-kernel route loaders', 'external handoff clients']
      },
      NotifierRecordUiPreviewAcceptanceReview: {
        required: ['contract', 'generatedAt', 'recordKey', 'reviewStatus', 'previewReady', 'acceptanceReady', 'proofReady', 'readOnly', 'previewSummary', 'validationSummary', 'acceptanceSummary', 'readinessSummary', 'previewChecklist', 'routePayloadContracts', 'decisionTrace', 'clientPanelStates', 'reviewPacket', 'blockerCodes', 'nextAction'],
        reviewStatuses: ['blocked', 'dispatch-ready', 'ready-for-operator-acceptance', 'draft-incomplete', ...TERMINAL_PERSISTED_STATUSES],
        consumedBy: ['clientState.review', 'persist-state payload', 'command proof manifest', 'proof.uiReview']
      },
      NotifierRecordRouteReviewPacket: {
        required: ['contract', 'generatedAt', 'recordKey', 'requestedStep', 'nextAction', 'routePayloadContracts', 'decisionTrace', 'clientPanelStates', 'validation', 'preview', 'acceptance', 'readiness'],
        consumedBy: ['clientState.review.reviewPacket', 'hosted-kernel route loaders', 'external handoff clients'],
        routePayloadContracts: ['NotifierRecordPreviewSummaryV1', 'NotifierRecordValidationSummaryV1', 'NotifierRecordAcceptanceSummaryV1', 'NotifierRecordReadinessSummaryV1']
      },
      NotifierRecordReviewRoutePayload: {
        required: ['contract', 'route', 'method', 'panel', 'payloadContract', 'ready', 'requiredClientFields', 'missingClientFields'],
        panels: CLIENT_STATE_KEYS,
        methods: ['GET', 'PATCH', 'POST', 'PUT']
      },
      NotifierRecordReviewDecisionTraceEntry: {
        required: ['contract', 'step', 'state', 'reason', 'route', 'issueCodes'],
        steps: ['validation', 'preview', 'acceptance', 'readiness'],
        semantics: 'ordered explanation for why the hosted-kernel selected nextAction'
      },
      NotifierRecordClientPanelState: {
        required: ['contract', 'panel', 'active', 'visible', 'ready', 'route', 'method', 'disabledReason'],
        panels: CLIENT_STATE_KEYS,
        consumedBy: ['clientState.review.clientPanelStates']
      },
      NotifierRecordValidationSummary: {
        required: ['contract', 'valid', 'issueCount', 'blockingIssueCount', 'warningIssueCount', 'issueCodesBySeverity', 'firstBlockingIssue', 'boundaryIssueCodes', 'providerIssueRoles']
      },
      NotifierRecordAcceptanceSummary: {
        required: ['contract', 'acceptedForDispatch', 'acceptedByOperator', 'missingAcknowledgements', 'checklist']
      },
      NotifierRecordReadinessSummary: {
        required: ['contract', 'status', 'canPreview', 'canAccept', 'canDispatch', 'restartSafe', 'providerContractsReady', 'retryPolicy', 'blockedProviderRoles', 'boundaryBlockedProviderRoles', 'unavailableProviderRoles', 'providerNegotiationState']
      },
      NotifierRecordOperationalHealth: {
        required: ['contract', 'dispatcherStatus', 'proofStoreStatus', 'degradedMode', 'circuitOpen', 'retryPolicy', 'failureState', 'retryWindowOpen', 'validationIssues', 'actionableErrors'],
        optional: ['failureCode', 'failureMessage', 'retryCount', 'maxRetryAttempts', 'retryAfter', 'retryAt', 'nextBackoffMs', 'retryBackoffHint'],
        statuses: OPERATIONAL_HEALTH_STATUSES,
        retryableFailureCodes: RETRYABLE_FAILURE_CODES,
        terminalFailureCodes: TERMINAL_FAILURE_CODES
      },
      NotifierRecordFailureState: {
        required: ['contract', 'state', 'allowedStates', 'retryable', 'terminal', 'retryExhausted', 'unknown', 'attempts', 'maxAttempts', 'retryWindowOpen'],
        optional: ['code', 'nextAttemptAt', 'circuitBreakerReason'],
        states: FAILURE_STATES
      },
      NotifierRecordRetryBackoffHint: {
        required: ['contract', 'source', 'retryBackoffMs', 'scheduleMs', 'attemptOrdinal'],
        sources: ['provider-hint', 'kernel-default-schedule']
      },
      NotifierRecordDispatchRetryWindow: {
        required: ['retryPolicy', 'retryAt', 'retryWindowOpen', 'nextBackoffMs', 'failureState'],
        route: '/kernel/audit-recovery/notifier-record/dispatch',
        semantics: 'same idempotency key is held until retryAt when retryWindowOpen is false'
      },
      NotifierRecordOperatorDispatchDecision: {
        required: ['contract', 'generatedAt', 'decision', 'recordKey', 'route', 'method', 'payloadContract', 'canSubmit', 'previewGate', 'acceptanceGate', 'dispatchGate', 'lifecycleGate', 'providerGate', 'boundaryGate', 'commandPlan', 'handoff', 'blockingReasons', 'nextStep'],
        decisions: ['dispatch-ready', 'proof-ready', 'retry-held', 'awaiting-operator-acceptance', 'draft-blocked', 'provider-blocked', 'lifecycle-held', 'boundary-blocked', 'operator-action-required'],
        consumedBy: ['clientState.handoff', 'hosted-kernel route loaders', 'operator dispatch console', 'proof envelope']
      },
      NotifierRecordLifecycleControls: {
        required: ['contract', 'mode', 'dispatchEnabled', 'proofPersistenceEnabled', 'schedulingMode', 'commandPolicy', 'lifecycleCommand', 'nextOperatorAction', 'validationIssues'],
        optional: ['scheduledAt', 'holdUntil', 'expiresAt', 'nextEligibleAt', 'disableReason', 'pausedReason'],
        lifecycleModes: LIFECYCLE_MODES,
        schedulingModes: SCHEDULING_MODES,
        lifecycleCommands: LIFECYCLE_COMMANDS,
        maxScheduleDelayMs: MAX_SCHEDULE_DELAY_MS
      },
      NotifierRecordLifecycleCommandState: {
        required: ['contract', 'requestedCommand', 'command', 'accepted', 'effectiveMode', 'effectiveSchedulingMode', 'commandBlockers', 'nextOperatorAction', 'auditEvent', 'proofIntent'],
        optional: ['previousMode', 'previousSchedulingMode', 'scheduledAt', 'holdUntil', 'expiresAt', 'reason'],
        commandAliases: Object.keys(LIFECYCLE_COMMAND_ALIASES)
      },
      NotifierRecordMailchimpDispatchContext: {
        required: ['contract', 'present', 'campaignId', 'audienceId', 'dispatchHold', 'nextEligibleAt', 'idempotencyScope', 'validationIssues'],
        optional: ['templateId', 'archiveUrl', 'sendAt', 'persistedStatePatch', 'proofRefs']
      },
      NotifierRecordMailchimpDispatchAnalytics: {
        required: ['contract', 'present', 'status', 'counters', 'exportRowPatch', 'reportingPatch'],
        optional: ['historySnapshot', 'exportBatch'],
        statuses: ['not-applicable', 'blocked', 'send-window-held', 'dispatch-ready', 'accepted', 'awaiting-acceptance'],
        consumedBy: ['analyticsExports.counters', 'analyticsExports.history', 'analyticsExports.exportSummary', 'clientState.reporting']
      },
      NotifierRecordMailchimpDispatchHandoffGate: {
        required: ['contract', 'present', 'status', 'dispatchAllowed', 'proofRefsSatisfied', 'providerHandoffReady', 'blockers', 'nextAction', 'routeContract'],
        statuses: ['not-applicable', 'blocked', 'held-for-send-window', 'sync-before-dispatch', 'ready'],
        consumedBy: ['validation.issues', 'readiness.mailchimpDispatchGate', 'proof.mailchimpDispatchGate']
      },
      NotifierRecordProviderContracts: {
        required: ['contract', 'negotiatedAt', 'requiredRoles', 'blockedRoles', 'boundaryBlockedRoles', 'unavailableRoles', 'ready', 'syncRequiredRoles', 'capabilityNegotiation', 'descriptors', 'externalHandoffState', 'validationIssues'],
        serviceRoles: PROVIDER_SERVICE_ROLES,
        requiredCapabilities: PROVIDER_REQUIRED_CAPABILITIES,
        optionalCapabilities: PROVIDER_OPTIONAL_CAPABILITIES
      },
      NotifierRecordProviderDescriptor: {
        required: ['contract', 'role', 'providerId', 'serviceRoute', 'handshakeRoute', 'receiptRoute', 'contractVersion', 'health', 'enabled', 'available', 'requiredCapabilities', 'optionalCapabilities', 'capabilities', 'acceptedCapabilities', 'missingCapabilities', 'boundary', 'boundaryPolicy', 'sync']
      },
      NotifierRecordProviderBoundaryPolicy: {
        required: ['contract', 'role', 'scopeMode', 'requestScopeBound', 'tenantId', 'workspaceId', 'allowedTenantIds', 'allowedWorkspaceIds', 'sharedScopeAllowed', 'boundaryMismatch', 'boundaryIssues', 'decision', 'handoffScope'],
        scopeModes: PROVIDER_BOUNDARY_SCOPE_MODES,
        decisions: ['inherit-request-scope', 'allow-provider-bound-scope', 'allow-shared-hosted-kernel-provider', 'hold-unbound-request-scope', 'reject-provider-boundary']
      },
      NotifierRecordProviderCapabilityNegotiation: {
        required: ['contract', 'negotiatedAt', 'contractVersions', 'requiredCapabilitySet', 'requiredSyncRoles', 'boundaryBlockedRoles', 'blockingRoles', 'syncBarrierRequired', 'boundaryBarrierRequired', 'handoffState', 'handoffLease', 'serviceHandshakes'],
        handoffStates: ['remote-ready', 'sync-before-handoff', 'boundary-blocked', 'blocked']
      },
      NotifierRecordProviderHandshake: {
        required: ['contract', 'role', 'providerId', 'route', 'method', 'payloadContract', 'required', 'contractVersion', 'requestedCapabilities', 'acceptedCapabilities', 'missingCapabilities', 'syncRequired', 'boundary', 'boundaryDecision', 'boundaryIssues', 'idempotencyKey']
      },
      NotifierRecordExternalHandoffLease: {
        required: ['contract', 'resumeToken', 'leaseMs', 'expiresAt', 'consumed']
      },
      NotifierRecordProviderSyncMetadata: {
        required: ['contract', 'syncRequired', 'checkedAt'],
        optional: ['cursor', 'localRevision', 'remoteRevision', 'lastSyncedAt', 'nextSyncAfter', 'syncAgeMs', 'staleAfterMs']
      },
      NotifierRecordExternalHandoffState: {
        required: ['contract', 'providerId', 'route', 'intent', 'resumeToken', 'state', 'negotiationState', 'handoffLease', 'receiptRoute', 'syncRequired', 'boundaryDecision', 'boundaryIssues', 'missingCapabilities', 'blockingRoles', 'checkedAt']
      },
      NotifierRecordAnalyticsCounters: {
        required: ['contract', 'recipientCount', 'evidenceCount', 'validationIssueCount', 'blockingIssueCount', 'enabledCommandCount', 'historySnapshotCount'],
        groupedCounters: ['recipientChannelCounts', 'evidenceKindCounts', 'historyStatusCounts', 'historySourceCounts', 'providerHealthCounts', 'issueSeverityCounts']
      },
      NotifierRecordHistorySnapshot: {
        required: ['contract', 'sequence', 'status', 'event', 'capturedAt', 'issueCount', 'blockingIssueCount', 'source'],
        sources: ['operator-history', 'persisted-command-log', 'runtime-projection']
      },
      NotifierRecordExportSummary: {
        required: ['contract', 'exportKey', 'partition', 'row', 'enabledCommandIds', 'actionableErrorCodes']
      },
      NotifierRecordAnalyticsExportBatches: {
        required: ['contract', 'ready', 'blockedReason', 'destinations'],
        destinations: ['notifier-record-counters', 'notifier-record-history', 'notifier-record-timeline', 'notifier-record-mailchimp-dispatch']
      },
      NotifierRecordReportingState: {
        required: ['contract', 'statusBucket', 'dashboardKey', 'readinessStatus', 'owner', 'needsAttention', 'exportReady'],
        optional: ['historyAgeMs', 'lastHistoryStatus', 'lastHistorySource', 'stalled', 'commandStateCounts', 'mailchimp']
      },
      NotifierRecordProofEnvelope: {
        required: ['surfaceId', 'recordId', 'generatedAt', 'validation', 'acceptance', 'readiness', 'uiReview', 'operatorDispatchDecision', 'boundaryContext', 'boundaryAuthorization', 'clientState', 'workflowHandoff', 'clientHandoffState', 'persistedState', 'persistedStateEnvelope', 'idempotentCommands', 'operationalHealth', 'lifecycleControls', 'providerContracts', 'analyticsCounters', 'exportSummary', 'analyticsExportBatches']
      }
    },
    requestContext,
    boundaryContext,
    boundaryAuthorization,
    clientState,
    record: {
      recordId,
      severity,
      title,
      summary,
      recoveryAction,
      recipients,
      evidence
    },
    preview,
    uiReview,
    acceptance,
    readiness,
    operatorDispatchDecision,
    operationalHealth,
    lifecycleControls,
    providerContracts,
    mailchimpDispatchContext,
    mailchimpDispatchGate,
    clientHandoffState,
    persistedState,
    persistedStateEnvelope,
    idempotentCommands,
    validation,
    analytics: analyticsExports,
    runtimeAdoptionPacket,
    nextSteps,
    workflowHandoff,
    proof: {
      surfaceId,
      recordId,
      generatedAt,
      previewHashSource: preview.body,
      validationStatus: validation.valid ? 'valid' : 'invalid',
      acceptanceStatus: acceptance.acceptedForDispatch ? 'accepted' : 'pending',
      traceId: requestContext.traceId,
      sessionId: requestContext.sessionId,
      actor: requestContext.actor,
      tenantId: boundaryContext.tenantId,
      workspaceId: boundaryContext.workspaceId,
      isolationMode: boundaryContext.isolationMode,
      dispatchAllowed: boundaryContext.dispatchAllowed,
      auditHandoffAllowed: boundaryContext.auditHandoffAllowed,
      authorizationDecision: boundaryAuthorization.decision,
      authorizationScopeStatus: boundaryAuthorization.scopeStatus,
      boundaryDeniedReasons: boundaryAuthorization.deniedReasons,
      proofPartition: boundaryAuthorization.proofPartition,
      operationalMode: operationalHealth.degradedMode ? 'degraded' : 'normal',
      circuitOpen: operationalHealth.circuitOpen,
      retryPolicy: operationalHealth.retryPolicy,
      failureState: operationalHealth.failureState.state,
      retryAt: operationalHealth.retryAt,
      retryWindowOpen: operationalHealth.retryWindowOpen,
      lifecycleMode: lifecycleControls.mode,
      lifecycleCommandPolicy: lifecycleControls.commandPolicy,
      lifecycleCommand: lifecycleControls.lifecycleCommand,
      lifecycleNextOperatorAction: lifecycleControls.nextOperatorAction,
      nextEligibleAt: lifecycleControls.nextEligibleAt,
      mailchimpDispatchContext,
      mailchimpDispatchGate,
      providerContractStatus: providerContracts.ready ? 'ready' : 'blocked',
      providerNegotiationState: providerContracts.capabilityNegotiation.handoffState,
      runtimeAdoption: {
        contract: runtimeAdoptionPacket.contract,
        state: runtimeAdoptionPacket.state,
        canAdopt: runtimeAdoptionPacket.canAdopt,
        route: runtimeAdoptionPacket.routeContract.route,
        method: runtimeAdoptionPacket.routeContract.method,
        blockedReasons: runtimeAdoptionPacket.blockedReasons,
        nextAction: runtimeAdoptionPacket.nextAction.action
      },
      uiReviewStatus: uiReview.reviewStatus,
      uiNextAction: uiReview.nextAction,
      blockedProviderRoles: providerContracts.blockedRoles,
      boundaryBlockedProviderRoles: providerContracts.boundaryBlockedRoles,
      unavailableProviderRoles: providerContracts.unavailableRoles,
      providerSyncRequiredRoles: providerContracts.syncRequiredRoles,
      providerCapabilityNegotiation: providerContracts.capabilityNegotiation,
      externalHandoffState: providerContracts.externalHandoffState,
      actionableErrorCodes: operationalHealth.actionableErrors.map((error) => error.code),
      evidenceCount: evidence.length,
      clientStateKey: clientState.draftKey,
      persistedStateKey: clientState.persistedStateKey,
      persistedStateEnvelope,
      recoveredFromState: readiness.recoveredFromState,
      restartSafeStatus: readiness.status,
      operationalHealth,
      lifecycleControls,
      providerContracts,
      clientHandoffState,
      operatorDispatchDecision,
      analyticsCounters: analyticsExports.counters,
      uiReview,
      reportingState: analyticsExports.reportingState,
      exportSummary: analyticsExports.exportSummary,
      analyticsExportBatches: analyticsExports.exportBatches,
      timeline: analyticsExports.timeline,
      enabledCommandIds: idempotentCommands.filter((command) => command.enabled).map((command) => command.commandId),
      handoffTarget: workflowHandoff.target,
      handoffResumeToken: workflowHandoff.resumeToken,
      handoffPrimaryAction: workflowHandoff.clientWorkflow.primaryAction,
      dispatchDecision: operatorDispatchDecision.decision,
      dispatchDecisionRoute: operatorDispatchDecision.route
    },
    evidence
  };
}

export default describeNotifierRecordSurface;
