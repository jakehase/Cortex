export const surfaceId = "aios_kernel-lifecycle_kill-quarantine_009";
export const surfaceGroup = "kernel-lifecycle";
export const surfaceName = "kill-quarantine";

const TERMINAL_STATUSES = new Set(['killed', 'terminated', 'exited']);
const QUARANTINE_REASONS = new Set(['policy_violation', 'runaway_process', 'operator_request', 'integrity_risk']);
const DEFAULT_REASON = 'operator_request';
const ACTIVE_QUARANTINE_STATES = new Set(['scheduled-quarantine', 'awaiting-quarantine-ack', 'quarantine-acknowledged', 'kill-dispatched']);
const FINAL_QUARANTINE_STATES = new Set(['blocked', 'completed', 'cancelled']);
const KNOWN_QUARANTINE_STATES = new Set([...ACTIVE_QUARANTINE_STATES, ...FINAL_QUARANTINE_STATES]);
const LEGACY_QUARANTINE_STATE_ALIASES = new Map([
  ['scheduled', 'scheduled-quarantine'],
  ['quarantined', 'awaiting-quarantine-ack'],
  ['awaiting_ack', 'awaiting-quarantine-ack'],
  ['acknowledged', 'quarantine-acknowledged'],
  ['dispatching', 'kill-dispatched'],
  ['killing', 'kill-dispatched'],
  ['failed', 'blocked'],
  ['done', 'completed']
]);
const KILL_QUARANTINE_ROLES = new Set(['kernel_admin', 'tenant_admin', 'incident_responder']);
const KILL_QUARANTINE_GLOBAL_ROLES = new Set(['kernel_admin']);
const KILL_QUARANTINE_SCOPED_ROLES = new Set(['tenant_admin', 'incident_responder']);
const KILL_QUARANTINE_PERMISSIONS = new Set([
  'kernel.kill',
  'kernel.kill_quarantine',
  'kernel.lifecycle.kill_quarantine'
]);
const RETRYABLE_BLOCK_REASONS = new Set(['no_live_targets', 'kernel_scope_requires_tenant_or_workspace']);
const MAX_RETRY_DELAY_MS = 30000;
const DEFAULT_ACK_TIMEOUT_MS = 120000;
const MAX_ACK_TIMEOUT_MS = 600000;
const DEFAULT_DISPATCH_DELAY_MS = 0;
const MAX_DISPATCH_DELAY_MS = 300000;
const DEFAULT_HEARTBEAT_STALE_MS = 45000;
const MAX_HEARTBEAT_STALE_MS = 900000;
const DEFAULT_MAX_TARGETS = 64;
const MAX_TARGETS_PER_REQUEST = 256;
const MAX_HISTORY_SNAPSHOTS = 25;
const CANCEL_ACTIVE_WHEN_DISABLED_DEFAULT = true;
const MAX_PERSISTED_RECOVERY_AGE_MS = 24 * 60 * 60 * 1000;
const KILL_QUARANTINE_EXPORT_COLUMNS = [
  { key: 'generatedAt', type: 'datetime' },
  { key: 'kernelId', type: 'string' },
  { key: 'requestId', type: 'string' },
  { key: 'operatorId', type: 'string' },
  { key: 'verdict', type: 'string' },
  { key: 'command', type: 'string' },
  { key: 'state', type: 'string' },
  { key: 'reason', type: 'string' },
  { key: 'targetCount', type: 'integer' },
  { key: 'requestedCount', type: 'integer' },
  { key: 'validationErrors', type: 'integer' },
  { key: 'validationWarnings', type: 'integer' },
  { key: 'healthStatus', type: 'string' },
  { key: 'blockReason', type: 'string' },
  { key: 'providerFailureCode', type: 'string' },
  { key: 'failedTargetCount', type: 'integer' },
  { key: 'retryAfterMs', type: 'integer' },
  { key: 'providerState', type: 'string' },
  { key: 'nextAction', type: 'string' },
  { key: 'requiresOperatorAck', type: 'boolean' },
  { key: 'ackAccepted', type: 'boolean' },
  { key: 'pendingTimerAt', type: 'datetime' },
  { key: 'reportSeverity', type: 'string' }
];
const DEGRADED_MODE_POLICIES = new Set(['allow', 'manual_review', 'block_dispatch']);
const KILL_QUARANTINE_BASE_CAPABILITIES = [
  'kill-quarantine.stage',
  'kill-quarantine.sync-state',
  'kill-quarantine.audit-proof'
];
const KILL_QUARANTINE_ACK_CAPABILITY = 'kill-quarantine.operator-ack';
const KILL_QUARANTINE_SCHEDULE_CAPABILITY = 'kill-quarantine.schedule';
const KILL_QUARANTINE_DISPATCH_CAPABILITY = 'kill-quarantine.dispatch-kill';
const PROVIDER_BLOCKING_STATUSES = new Set(['rejected', 'failed', 'faulted', 'conflict']);
const PROVIDER_ACTIVE_STATUSES = new Set(['accepted', 'queued', 'leased', 'in_progress', 'completed']);
const ACK_ELIGIBLE_STATES = new Set(['awaiting-quarantine-ack', 'quarantine-acknowledged']);
const PROVIDER_RETRYABLE_FAILURE_CODES = new Set([
  'provider_external_state_blocked',
  'provider_lease_expired',
  'provider_sync_stale',
  'provider_state_not_actionable',
  'provider_dispatch_failure'
]);
const PROVIDER_DISPATCH_RETRYABLE_CODES = new Set([
  'dispatch_timeout',
  'handoff_timeout',
  'lease_expired',
  'provider_unavailable',
  'rate_limited',
  'stale_revision',
  'target_lock_conflict',
  'transient_network'
]);
const PROVIDER_DISPATCH_TERMINAL_CODES = new Set([
  'permission_denied',
  'policy_rejected',
  'quarantine_not_found',
  'target_integrity_mismatch',
  'target_not_found'
]);
const DEFAULT_PROVIDER_CAPABILITIES = [
  ...KILL_QUARANTINE_BASE_CAPABILITIES,
  KILL_QUARANTINE_ACK_CAPABILITY,
  KILL_QUARANTINE_SCHEDULE_CAPABILITY,
  KILL_QUARANTINE_DISPATCH_CAPABILITY
];

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asString(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizePid(value) {
  if (Number.isInteger(value) && value >= 0) return String(value);
  if (typeof value === 'string' && value.trim()) return value.trim();
  return '';
}

function uniqueNormalizedPids(values) {
  const seen = new Set();
  const pids = [];
  for (const value of Array.isArray(values) ? values : []) {
    const pid = normalizePid(value);
    if (pid && !seen.has(pid)) {
      seen.add(pid);
      pids.push(pid);
    }
  }
  return pids;
}

function normalizeRequestedPidClaims(values) {
  const rawValues = Array.isArray(values) ? values : [];
  const seen = new Set();
  const requestedPids = [];
  const duplicatePids = [];
  const invalidPidClaims = [];

  rawValues.forEach((value, index) => {
    const pid = normalizePid(value);
    if (!pid) {
      invalidPidClaims.push({
        index,
        type: Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value,
        value: value === undefined ? null : value
      });
      return;
    }
    if (seen.has(pid)) {
      duplicatePids.push(pid);
      return;
    }
    seen.add(pid);
    requestedPids.push(pid);
  });

  return {
    contract: 'hosted-kernel.kill-quarantine.requested-pids.v1',
    explicit: Array.isArray(values),
    rawCount: rawValues.length,
    normalizedCount: requestedPids.length,
    requestedPids,
    duplicatePids,
    invalidPidClaims,
    duplicateCount: duplicatePids.length,
    invalidCount: invalidPidClaims.length,
    normalized: duplicatePids.length > 0 || invalidPidClaims.length > 0
  };
}

function samePidSet(left, right) {
  const leftPids = uniqueNormalizedPids(left);
  const rightPids = uniqueNormalizedPids(right);
  if (leftPids.length !== rightPids.length) return false;
  const rightSet = new Set(rightPids);
  return leftPids.every((pid) => rightSet.has(pid));
}

function normalizeProcess(rawProcess, index) {
  const process = asRecord(rawProcess);
  const pid = normalizePid(process.pid ?? process.id ?? index);
  const status = asString(process.status, 'running').toLowerCase();
  return {
    pid,
    command: asString(process.command ?? process.name, 'unknown'),
    status,
    tenantId: asString(process.tenantId ?? process.tenant ?? process.workspaceTenantId, ''),
    workspaceId: asString(process.workspaceId ?? process.workspace ?? process.projectId, ''),
    quarantinable: !TERMINAL_STATUSES.has(status),
    lastHeartbeatAt: asString(process.lastHeartbeatAt ?? process.heartbeatAt, null),
    exitCode: Number.isInteger(process.exitCode) ? process.exitCode : null
  };
}

function normalizeStringList(values) {
  const seen = new Set();
  const normalized = [];
  for (const value of Array.isArray(values) ? values : []) {
    const item = asString(value, '');
    if (item && !seen.has(item)) {
      seen.add(item);
      normalized.push(item);
    }
  }
  return normalized;
}

function normalizeBoundaryIds(...values) {
  const ids = [];
  for (const value of values) {
    if (Array.isArray(value)) {
      ids.push(...value.map((item) => asString(asRecord(item).id ?? item, '')));
    } else {
      ids.push(asString(asRecord(value).id ?? value, ''));
    }
  }
  return normalizeStringList(ids);
}

function asNonNegativeInteger(value, fallback = 0) {
  if (Number.isInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= 0) return parsed;
  }
  return fallback;
}

function asBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'enabled'].includes(normalized)) return true;
    if (['false', '0', 'no', 'disabled'].includes(normalized)) return false;
  }
  return fallback;
}

function clampNonNegativeInteger(value, fallback, max) {
  const parsed = asNonNegativeInteger(value, fallback);
  return Math.min(parsed, max);
}

function parseTimeMs(value) {
  const normalized = asString(value, '');
  if (!normalized) return null;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeKillQuarantineControls(input, now) {
  const clientState = asRecord(input.clientState);
  const kernel = asRecord(input.kernel);
  const lifecycleState = asRecord(clientState.kernelLifecycle);
  const kernelLifecycle = asRecord(kernel.lifecycle);
  const configured = asRecord(
    input.killQuarantineSettings
      ?? input.lifecycleSettings
      ?? lifecycleState.killQuarantineSettings
      ?? kernelLifecycle.killQuarantineSettings
  );
  const killRequest = asRecord(input.killRequest);
  const requestControls = asRecord(killRequest.controls ?? input.controls);
  const scheduleAt = asString(
    requestControls.scheduleAt
      ?? requestControls.scheduledFor
      ?? killRequest.scheduleAt
      ?? configured.scheduleAt
      ?? configured.scheduledFor,
    ''
  );
  const scheduleAtMs = parseTimeMs(scheduleAt);
  const nowMs = parseTimeMs(now) ?? Date.now();
  const enabled = asBoolean(requestControls.enabled ?? killRequest.enabled ?? configured.enabled, true);
  const maxTargets = clampNonNegativeInteger(
    requestControls.maxTargets ?? configured.maxTargets,
    DEFAULT_MAX_TARGETS,
    MAX_TARGETS_PER_REQUEST
  );
  const maxTargetsRaw = requestControls.maxTargets ?? configured.maxTargets;
  const ackTimeoutMs = clampNonNegativeInteger(
    requestControls.ackTimeoutMs ?? configured.ackTimeoutMs,
    DEFAULT_ACK_TIMEOUT_MS,
    MAX_ACK_TIMEOUT_MS
  );
  const dispatchDelayMs = clampNonNegativeInteger(
    requestControls.dispatchDelayMs ?? configured.dispatchDelayMs,
    DEFAULT_DISPATCH_DELAY_MS,
    MAX_DISPATCH_DELAY_MS
  );
  const heartbeatStaleMs = clampNonNegativeInteger(
    requestControls.heartbeatStaleMs ?? configured.heartbeatStaleMs,
    DEFAULT_HEARTBEAT_STALE_MS,
    MAX_HEARTBEAT_STALE_MS
  );
  const requestedDegradedMode = asString(
    requestControls.degradedMode ?? requestControls.degradedModePolicy ?? configured.degradedMode,
    'allow'
  ).toLowerCase();
  const requireAck = asBoolean(
    requestControls.requireAck ?? requestControls.requireQuarantineAck ?? configured.requireAck,
    true
  );
  const cancelActiveWhenDisabled = asBoolean(
    requestControls.cancelActiveWhenDisabled ?? configured.cancelActiveWhenDisabled,
    CANCEL_ACTIVE_WHEN_DISABLED_DEFAULT
  );
  const scheduleValid = !scheduleAt || scheduleAtMs !== null;
  const scheduled = Boolean(scheduleAt && scheduleValid);
  const scheduleDue = scheduled ? scheduleAtMs <= nowMs : true;
  const controlIssues = [
    !enabled
      ? {
          code: 'kill_quarantine_disabled',
          field: 'killQuarantineSettings.enabled',
          severity: 'error',
          action: cancelActiveWhenDisabled ? 'cancel-active-quarantine' : 'hold-active-quarantine',
          message: 'Lifecycle settings disabled kill quarantine.'
        }
      : null,
    maxTargets === 0 || maxTargetsRaw === 0 || maxTargetsRaw === '0'
      ? {
          code: 'target_limit_zero',
          field: 'killQuarantineSettings.maxTargets',
          severity: 'error',
          action: 'raise-max-targets-before-quarantine',
          message: 'Lifecycle settings set kill-quarantine maxTargets to zero.'
        }
      : null,
    !scheduleValid
      ? {
          code: 'invalid_quarantine_schedule',
          field: 'killRequest.scheduleAt',
          severity: 'error',
          action: 'repair-schedule-timestamp',
          message: 'Scheduled kill quarantine must use an ISO-compatible timestamp.'
        }
      : null,
    scheduled && scheduleDue
      ? {
          code: 'scheduled_window_due',
          field: 'killRequest.scheduleAt',
          severity: 'info',
          action: 'continue-due-scheduled-quarantine',
          message: 'Scheduled kill quarantine is due and can continue.'
        }
      : null,
    scheduled && !scheduleDue
      ? {
          code: 'scheduled_window_pending',
          field: 'killRequest.scheduleAt',
          severity: 'info',
          action: 'wait-until-scheduled-window',
          message: 'Scheduled kill quarantine is waiting for its configured window.'
        }
      : null
  ].filter(Boolean);

  return {
    contract: 'hosted-kernel.kill-quarantine.controls.v2',
    enabled,
    disabledReason: enabled ? null : asString(requestControls.disabledReason ?? configured.disabledReason, 'kill_quarantine_disabled_by_settings'),
    cancelActiveWhenDisabled,
    requireAck,
    ackTimeoutMs,
    dispatchDelayMs,
    heartbeatStaleMs,
    degradedMode: DEGRADED_MODE_POLICIES.has(requestedDegradedMode) ? requestedDegradedMode : 'allow',
    maxTargets,
    scheduleAt: scheduleAt || null,
    scheduleValid,
    scheduleDue,
    scheduleDelayMs: scheduled && !scheduleDue ? scheduleAtMs - nowMs : 0,
    scheduled,
    issueCount: controlIssues.length,
    errors: controlIssues.filter((issue) => issue.severity === 'error').map((issue) => issue.code),
    warnings: controlIssues.filter((issue) => issue.severity === 'warning').map((issue) => issue.code),
    events: controlIssues,
    source: Object.keys(requestControls).length > 0 ? 'request' : Object.keys(configured).length > 0 ? 'settings' : 'defaults'
  };
}

function normalizeKillQuarantineAttempt(input) {
  const killRequest = asRecord(input.killRequest);
  const retry = asRecord(killRequest.retry ?? input.retry);
  const attempt = asNonNegativeInteger(
    killRequest.attempt ?? input.attempt ?? retry.attempt ?? retry.count,
    0
  );
  const baseDelayMs = asNonNegativeInteger(retry.baseDelayMs ?? input.baseRetryDelayMs, 1000);
  const retryAfterMs = Math.min(MAX_RETRY_DELAY_MS, baseDelayMs * (2 ** Math.min(attempt, 5)));

  return {
    attempt,
    baseDelayMs,
    retryAfterMs,
    nextAttempt: attempt + 1
  };
}

function normalizeKillQuarantineAck(input, { requestId, intent, persisted, controls }) {
  const killRequest = asRecord(input.killRequest);
  const clientState = asRecord(input.clientState);
  const lifecycleState = asRecord(clientState.kernelLifecycle);
  const ack = asRecord(
    killRequest.ack
      ?? killRequest.quarantineAck
      ?? input.quarantineAck
      ?? lifecycleState.killQuarantineAck
  );
  const explicitConfirm = ack.confirmed ?? ack.confirm ?? ack.acknowledged ?? killRequest.acknowledgeQuarantine;
  const present = Object.keys(ack).length > 0 || explicitConfirm !== undefined;
  const confirmed = asBoolean(explicitConfirm, false);
  const ackRequestId = asString(ack.requestId ?? killRequest.ackRequestId, '');
  const ackTargetPids = uniqueNormalizedPids(ack.targetPids ?? ack.pids ?? killRequest.ackPids);
  const requestMatches = !ackRequestId || ackRequestId === requestId || ackRequestId === persisted.requestId;
  const targetsMatch = ackTargetPids.length === 0
    || samePidSet(ackTargetPids, intent.targetPids)
    || samePidSet(ackTargetPids, persisted.targetPids);
  const stateEligible = persisted.active && ACK_ELIGIBLE_STATES.has(persisted.state);
  const dispatchAfterMs = controls.dispatchDelayMs;
  const accepted = Boolean(
    present
      && confirmed
      && controls.requireAck
      && controls.scheduleDue
      && stateEligible
      && requestMatches
      && targetsMatch
  );
  const issues = [];
  if (present && !confirmed) issues.push('ack_not_confirmed');
  if (present && !controls.requireAck) issues.push('ack_not_required');
  if (present && !controls.scheduleDue) issues.push('scheduled_window_not_due');
  if (present && !stateEligible) issues.push('no_staged_quarantine_to_ack');
  if (present && !requestMatches) issues.push('ack_request_mismatch');
  if (present && !targetsMatch) issues.push('ack_target_mismatch');

  return {
    contract: 'hosted-kernel.kill-quarantine.operator-ack.v1',
    present,
    confirmed,
    accepted,
    requestId: ackRequestId || persisted.requestId || requestId,
    operatorNote: asString(ack.note ?? ack.operatorNote, ''),
    targetPids: ackTargetPids,
    stateEligible,
    dispatchAfterMs,
    issues
  };
}

function toIsoOrNull(ms) {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function deriveKillQuarantineClock({ now, persisted, controls }) {
  const nowMs = parseTimeMs(now) ?? Date.now();
  const stagedAtMs = parseTimeMs(persisted.updatedAt ?? persisted.recoveredAt);
  const acknowledgedAtMs = parseTimeMs(persisted.acknowledgedAt);
  const dispatchedAtMs = parseTimeMs(persisted.dispatchedAt);
  const ackBaseMs = stagedAtMs ?? nowMs;
  const ackDeadlineMs = controls.requireAck && persisted.active && persisted.state === 'awaiting-quarantine-ack'
    ? ackBaseMs + controls.ackTimeoutMs
    : null;
  const dispatchBaseMs = acknowledgedAtMs ?? stagedAtMs ?? nowMs;
  const dispatchDueMs = persisted.active && persisted.state === 'quarantine-acknowledged'
    ? dispatchBaseMs + controls.dispatchDelayMs
    : null;
  const ackExpired = Boolean(ackDeadlineMs !== null && nowMs > ackDeadlineMs);
  const dispatchDue = Boolean(dispatchDueMs !== null && nowMs >= dispatchDueMs);
  const pendingTimer = ackDeadlineMs !== null
    ? ackDeadlineMs
    : dispatchDueMs !== null
      ? dispatchDueMs
      : controls.scheduled && !controls.scheduleDue
        ? nowMs + controls.scheduleDelayMs
        : null;

  return {
    contract: 'hosted-kernel.kill-quarantine.clock.v1',
    now,
    persistedState: persisted.present ? persisted.state : null,
    stagedAt: toIsoOrNull(stagedAtMs),
    acknowledgedAt: toIsoOrNull(acknowledgedAtMs),
    dispatchedAt: toIsoOrNull(dispatchedAtMs),
    ackDeadlineAt: toIsoOrNull(ackDeadlineMs),
    ackExpired,
    ackTimeoutMs: controls.requireAck ? controls.ackTimeoutMs : null,
    dispatchDueAt: toIsoOrNull(dispatchDueMs),
    dispatchDue,
    dispatchDelayMs: dispatchDueMs !== null ? controls.dispatchDelayMs : null,
    pendingTimerAt: toIsoOrNull(pendingTimer),
    pendingTimerMs: pendingTimer !== null ? Math.max(0, pendingTimer - nowMs) : null,
    overdueMs: ackExpired && ackDeadlineMs !== null
      ? nowMs - ackDeadlineMs
      : dispatchDue && dispatchDueMs !== null
        ? nowMs - dispatchDueMs
        : 0
  };
}

function dispatchDueAtForCommand({ now, controls, recoveryCommand, quarantineClock }) {
  if (recoveryCommand.command === 'acknowledge-quarantine') {
    const nowMs = parseTimeMs(now) ?? Date.now();
    return toIsoOrNull(nowMs + controls.dispatchDelayMs);
  }
  return quarantineClock.dispatchDueAt;
}

function normalizeWorkspaceBoundary(input, kernel) {
  const killRequest = asRecord(input.killRequest);
  const request = asRecord(input.request);
  const workspace = asRecord(input.workspace);
  const tenant = asRecord(input.tenant);
  const kernelWorkspace = asRecord(kernel.workspace);
  const kernelTenant = asRecord(kernel.tenant);
  const workspaceId = asString(
    killRequest.workspaceId ?? input.workspaceId ?? request.workspaceId ?? workspace.id ?? kernel.workspaceId ?? kernelWorkspace.id,
    ''
  );
  const tenantId = asString(
    killRequest.tenantId ?? input.tenantId ?? request.tenantId ?? tenant.id ?? kernel.tenantId ?? kernelTenant.id,
    ''
  );

  return {
    workspaceId,
    tenantId,
    boundaryId: `${tenantId || 'tenant:unknown'}:${workspaceId || 'workspace:unknown'}`,
    scoped: Boolean(workspaceId || tenantId)
  };
}

function normalizeOperatorGrants(input) {
  const operator = asRecord(input.operator);
  const auth = asRecord(input.auth);
  const principal = asRecord(input.principal);
  const operatorGrants = asRecord(operator.grants);
  const authGrants = asRecord(auth.grants);
  const principalGrants = asRecord(principal.grants);
  const roles = normalizeStringList([
    ...normalizeStringList(operator.roles),
    ...normalizeStringList(auth.roles),
    ...normalizeStringList(principal.roles),
    asString(operator.role, ''),
    asString(auth.role, ''),
    asString(principal.role, '')
  ]);
  const permissions = normalizeStringList([
    ...normalizeStringList(operator.permissions),
    ...normalizeStringList(auth.permissions),
    ...normalizeStringList(principal.permissions),
    ...normalizeStringList(operatorGrants.permissions),
    ...normalizeStringList(authGrants.permissions),
    ...normalizeStringList(principalGrants.permissions)
  ]);
  const tenantIds = normalizeBoundaryIds(
    operator.tenantId,
    auth.tenantId,
    principal.tenantId,
    operator.tenantIds,
    auth.tenantIds,
    principal.tenantIds,
    operatorGrants.tenantId,
    authGrants.tenantId,
    principalGrants.tenantId,
    operatorGrants.tenantIds,
    authGrants.tenantIds,
    principalGrants.tenantIds,
    operatorGrants.tenants,
    authGrants.tenants,
    principalGrants.tenants
  );
  const workspaceIds = normalizeBoundaryIds(
    operator.workspaceId,
    auth.workspaceId,
    principal.workspaceId,
    operator.workspaceIds,
    auth.workspaceIds,
    principal.workspaceIds,
    operatorGrants.workspaceId,
    authGrants.workspaceId,
    principalGrants.workspaceId,
    operatorGrants.workspaceIds,
    authGrants.workspaceIds,
    principalGrants.workspaceIds,
    operatorGrants.workspaces,
    authGrants.workspaces,
    principalGrants.workspaces
  );

  return {
    roles,
    permissions,
    tenantIds,
    workspaceIds,
    hasBoundaryClaims: tenantIds.length > 0 || workspaceIds.length > 0,
    authorizedRole: roles.find((role) => KILL_QUARANTINE_ROLES.has(role)) ?? null,
    authorizedPermission: permissions.find((permission) => KILL_QUARANTINE_PERMISSIONS.has(permission)) ?? null
  };
}

function normalizeProviderStatusName(value) {
  const normalized = asString(value, 'unknown').toLowerCase().replace(/[\s-]+/g, '_');
  return normalized;
}

function normalizeProviderFailureTargets(values, inheritedCode, inheritedRetryable) {
  return (Array.isArray(values) ? values : [])
    .map((value) => {
      const target = asRecord(value);
      const code = normalizeProviderStatusName(target.code ?? target.errorCode ?? inheritedCode);
      const pid = normalizePid(target.pid ?? target.id ?? target.processId);
      if (!pid) return null;
      return {
        pid,
        code,
        retryable: asBoolean(
          target.retryable,
          inheritedRetryable || PROVIDER_DISPATCH_RETRYABLE_CODES.has(code)
        ),
        terminal: PROVIDER_DISPATCH_TERMINAL_CODES.has(code),
        message: asString(target.message ?? target.reason, ''),
        action: asString(target.action ?? target.nextAction, '')
      };
    })
    .filter(Boolean);
}

function normalizeProviderDispatchFailure(providerReport) {
  const failure = asRecord(
    providerReport.failure
      ?? providerReport.lastFailure
      ?? providerReport.dispatchFailure
      ?? providerReport.error
  );
  const code = normalizeProviderStatusName(
    failure.code
      ?? failure.errorCode
      ?? providerReport.failureCode
      ?? providerReport.errorCode
      ?? providerReport.reason
  );
  const rawRetryAfterMs = failure.retryAfterMs ?? failure.retryDelayMs ?? providerReport.retryAfterMs;
  const hasRetryAfter = rawRetryAfterMs !== undefined && rawRetryAfterMs !== null && rawRetryAfterMs !== '';
  const targetFailures = normalizeProviderFailureTargets(
    failure.targets
      ?? failure.failedTargets
      ?? providerReport.failedTargets
      ?? providerReport.targetFailures,
    code,
    asBoolean(failure.retryable ?? providerReport.retryable, PROVIDER_DISPATCH_RETRYABLE_CODES.has(code))
  );
  const present = Object.keys(failure).length > 0
    || code !== 'unknown'
    || targetFailures.length > 0
    || asString(providerReport.failureId ?? providerReport.errorId, '');
  const retryable = present && asBoolean(
    failure.retryable ?? providerReport.retryable,
    PROVIDER_DISPATCH_RETRYABLE_CODES.has(code) || targetFailures.some((target) => target.retryable)
  );
  const terminal = present && Boolean(
    PROVIDER_DISPATCH_TERMINAL_CODES.has(code)
      || targetFailures.some((target) => target.terminal)
      || asBoolean(failure.terminal ?? providerReport.terminal, false)
  );

  return {
    contract: 'hosted-kernel.kill-quarantine.provider-dispatch-failure.v1',
    present: Boolean(present),
    code: present ? code : null,
    message: present ? asString(failure.message ?? providerReport.errorMessage ?? providerReport.message, '') : '',
    failureId: present ? asString(failure.id ?? providerReport.failureId ?? providerReport.errorId, '') : '',
    retryable,
    terminal,
    retryAfterMs: hasRetryAfter ? Math.min(MAX_RETRY_DELAY_MS, asNonNegativeInteger(rawRetryAfterMs, 0)) : null,
    targetFailures,
    failedPids: targetFailures.map((target) => target.pid),
    action: present
      ? asString(
          failure.action ?? failure.nextAction ?? providerReport.failureAction,
          retryable ? 'retry-provider-dispatch-after-backoff' : 'repair-provider-dispatch-failure'
        )
      : null
  };
}

function normalizeProviderServiceState(input, configuredProvider) {
  const clientState = asRecord(input.clientState);
  const lifecycleState = asRecord(clientState.kernelLifecycle);
  const providerReport = asRecord(
    input.killQuarantineProviderReport
      ?? input.providerReport
      ?? configuredProvider.report
      ?? configuredProvider.serviceState
      ?? configuredProvider.externalState
      ?? lifecycleState.killQuarantineProviderReport
      ?? lifecycleState.killQuarantineProviderSync
  );
  const status = normalizeProviderStatusName(
    providerReport.status
      ?? providerReport.state
      ?? providerReport.providerState
      ?? providerReport.handoffStatus
  );
  const acknowledgedRevision = asString(
    providerReport.acknowledgedRevision
      ?? providerReport.providerDesiredRevision
      ?? providerReport.desiredRevision
      ?? providerReport.revision,
    ''
  );
  const acceptedAt = asString(providerReport.acceptedAt ?? providerReport.acknowledgedAt ?? providerReport.lastSyncedAt, null);
  const leaseExpiresAt = asString(providerReport.leaseExpiresAt ?? providerReport.lockExpiresAt, null);
  const issues = normalizeStringList(providerReport.issues ?? providerReport.errors);
  const present = Object.keys(providerReport).length > 0;
  const blocking = present && PROVIDER_BLOCKING_STATUSES.has(status);
  const dispatchFailure = normalizeProviderDispatchFailure(providerReport);

  return {
    contract: 'hosted-kernel.kill-quarantine.provider-state.v1',
    present,
    status: present ? status : 'unknown',
    active: present && PROVIDER_ACTIVE_STATUSES.has(status),
    blocking,
    blockingReason: blocking ? asString(providerReport.reason ?? providerReport.errorCode, status) : null,
    receiptId: asString(providerReport.receiptId ?? providerReport.handoffReceiptId ?? providerReport.id, ''),
    externalRequestId: asString(providerReport.externalRequestId ?? providerReport.providerRequestId, ''),
    acknowledgedRevision,
    acceptedAt,
    completedAt: asString(providerReport.completedAt, null),
    leaseExpiresAt,
    cursor: asString(providerReport.cursor ?? providerReport.syncCursor, ''),
    owner: asString(providerReport.owner ?? providerReport.providerOwner, ''),
    issues,
    dispatchFailure
  };
}

function normalizeKillQuarantineProvider(input, controls) {
  const kernel = asRecord(input.kernel);
  const lifecycle = asRecord(kernel.lifecycle);
  const configuredProvider = asRecord(
    input.killQuarantineProvider
      ?? input.integrationProvider
      ?? asRecord(input.provider).killQuarantine
      ?? lifecycle.killQuarantineProvider
      ?? lifecycle.provider
  );
  const explicit = Object.keys(configuredProvider).length > 0;
  const advertised = normalizeStringList([
    ...normalizeStringList(configuredProvider.capabilities),
    ...normalizeStringList(configuredProvider.advertisedCapabilities),
    ...normalizeStringList(asRecord(configuredProvider.contract).capabilities),
    ...normalizeStringList(asRecord(configuredProvider.serviceContract).capabilities)
  ]);
  const implied = [
    asBoolean(configuredProvider.canStageQuarantine ?? configuredProvider.stageQuarantine, !explicit)
      ? 'kill-quarantine.stage'
      : '',
    asBoolean(configuredProvider.canSyncState ?? configuredProvider.syncState, !explicit)
      ? 'kill-quarantine.sync-state'
      : '',
    asBoolean(configuredProvider.canEmitAuditProof ?? configuredProvider.auditProof, !explicit)
      ? 'kill-quarantine.audit-proof'
      : '',
    asBoolean(configuredProvider.canAcknowledge ?? configuredProvider.operatorAck, !explicit)
      ? KILL_QUARANTINE_ACK_CAPABILITY
      : '',
    asBoolean(configuredProvider.canSchedule ?? configuredProvider.schedule, !explicit)
      ? KILL_QUARANTINE_SCHEDULE_CAPABILITY
      : '',
    asBoolean(configuredProvider.canDispatchKill ?? configuredProvider.dispatchKill, !explicit)
      ? KILL_QUARANTINE_DISPATCH_CAPABILITY
      : ''
  ];
  const capabilities = normalizeStringList(explicit ? [...advertised, ...implied] : DEFAULT_PROVIDER_CAPABILITIES);
  const required = normalizeStringList([
    ...KILL_QUARANTINE_BASE_CAPABILITIES,
    controls.requireAck ? KILL_QUARANTINE_ACK_CAPABILITY : '',
    controls.scheduled ? KILL_QUARANTINE_SCHEDULE_CAPABILITY : '',
    !controls.requireAck ? KILL_QUARANTINE_DISPATCH_CAPABILITY : ''
  ]);
  const capabilitySet = new Set(capabilities);
  const missing = required.filter((capability) => !capabilitySet.has(capability));
  const externalState = normalizeProviderServiceState(input, configuredProvider);

  return {
    id: asString(configuredProvider.id ?? configuredProvider.providerId, explicit ? 'external-kill-quarantine-provider' : 'hosted-kernel-provider'),
    name: asString(configuredProvider.name, explicit ? 'External kill-quarantine provider' : 'Hosted kernel provider'),
    mode: asString(configuredProvider.mode ?? configuredProvider.type, explicit ? 'external' : 'hosted'),
    endpoint: asString(configuredProvider.endpoint ?? configuredProvider.url, ''),
    explicit,
    capabilities,
    requiredCapabilities: required,
    missingCapabilities: missing,
    contractVersion: asString(configuredProvider.contractVersion ?? asRecord(configuredProvider.contract).version, 'hosted-kernel.kill-quarantine.provider.v1'),
    ready: missing.length === 0,
    syncCursor: asString(configuredProvider.syncCursor ?? configuredProvider.cursor ?? configuredProvider.lastSyncCursor, ''),
    lastSyncedAt: asString(configuredProvider.lastSyncedAt ?? configuredProvider.syncedAt, null),
    externalState
  };
}

function buildProviderOperationalHealth({ provider, controls, quarantineClock }) {
  const externalState = provider.externalState;
  const dispatchFailure = externalState.dispatchFailure;
  const nowMs = parseTimeMs(quarantineClock.now) ?? Date.now();
  const leaseExpiresMs = parseTimeMs(externalState.leaseExpiresAt);
  const acceptedAtMs = parseTimeMs(externalState.acceptedAt);
  const lastSyncedMs = parseTimeMs(provider.lastSyncedAt) ?? acceptedAtMs;
  const syncStaleMs = Math.max(controls.ackTimeoutMs, controls.heartbeatStaleMs);
  const syncAgeMs = lastSyncedMs === null ? null : Math.max(0, nowMs - lastSyncedMs);
  const leaseExpired = Boolean(leaseExpiresMs !== null && nowMs > leaseExpiresMs);
  const syncStale = Boolean(
    provider.explicit
      && externalState.present
      && !externalState.completedAt
      && syncAgeMs !== null
      && syncAgeMs > syncStaleMs
  );
  const stateNotActionable = Boolean(
    externalState.present
      && !externalState.active
      && !externalState.blocking
      && externalState.status !== 'unknown'
  );
  const issues = [];

  if (!provider.ready) {
    issues.push({
      code: 'provider_capabilities_missing',
      severity: 'error',
      retryable: false,
      message: 'Provider is missing required kill-quarantine capabilities.',
      action: `configure provider capabilities: ${provider.missingCapabilities.join(', ')}`,
      missingCapabilities: provider.missingCapabilities
    });
  }
  if (externalState.blocking) {
    issues.push({
      code: 'provider_external_state_blocked',
      severity: 'error',
      retryable: true,
      message: 'Provider reported a blocking external kill-quarantine state.',
      action: 'resolve the provider handoff state and replay with the same idempotency key',
      providerStatus: externalState.status,
      providerReason: externalState.blockingReason,
      providerIssues: externalState.issues
    });
  }
  if (leaseExpired) {
    issues.push({
      code: 'provider_lease_expired',
      severity: 'error',
      retryable: true,
      message: 'Provider lease expired before kill-quarantine dispatch could be proven current.',
      action: 'reacquire provider lease before dispatching kill',
      leaseExpiresAt: externalState.leaseExpiresAt
    });
  }
  if (syncStale) {
    issues.push({
      code: 'provider_sync_stale',
      severity: controls.degradedMode === 'block_dispatch' ? 'error' : 'warning',
      retryable: true,
      message: 'Provider sync is stale for the active kill-quarantine handoff.',
      action: 'refresh provider sync before continuing kill quarantine',
      syncAgeMs,
      syncStaleMs
    });
  }
  if (stateNotActionable) {
    issues.push({
      code: 'provider_state_not_actionable',
      severity: 'warning',
      retryable: true,
      message: 'Provider state is present but not currently actionable for dispatch.',
      action: 'wait for provider acceptance or refresh provider state',
      providerStatus: externalState.status
    });
  }
  if (dispatchFailure.present) {
    issues.push({
      code: 'provider_dispatch_failure',
      severity: dispatchFailure.terminal || controls.degradedMode === 'block_dispatch' ? 'error' : 'warning',
      retryable: dispatchFailure.retryable,
      message: dispatchFailure.message || 'Provider reported a kill-quarantine dispatch failure.',
      action: dispatchFailure.action,
      providerFailureCode: dispatchFailure.code,
      providerFailureId: dispatchFailure.failureId || null,
      failedPids: dispatchFailure.failedPids,
      targetFailures: dispatchFailure.targetFailures,
      retryAfterMs: dispatchFailure.retryAfterMs
    });
  }

  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
  const retryable = issues.some((issue) => issue.retryable);
  const issueRetryAfterMs = issues
    .map((issue) => issue.retryAfterMs)
    .filter((value) => Number.isInteger(value) && value >= 0);
  const retryAfterMs = retryable
    ? Math.min(
        MAX_RETRY_DELAY_MS,
        Math.max(controls.heartbeatStaleMs, quarantineClock.pendingTimerMs ?? 0, ...issueRetryAfterMs, 1000)
      )
    : null;

  return {
    contract: 'hosted-kernel.kill-quarantine.provider-health.v1',
    status: errorCount > 0 ? 'failed' : warningCount > 0 ? 'degraded' : 'healthy',
    ok: errorCount === 0,
    degraded: warningCount > 0,
    retryable,
    retryAfterMs,
    errorCount,
    warningCount,
    lease: {
      expiresAt: externalState.leaseExpiresAt,
      expired: leaseExpired
    },
    syncFreshness: {
      lastSyncedAt: provider.lastSyncedAt || externalState.acceptedAt,
      ageMs: syncAgeMs,
      staleAfterMs: syncStaleMs,
      stale: syncStale
    },
    dispatchFailure,
    issues
  };
}

function normalizePersistedStateName(rawState) {
  const rawName = asString(rawState.state ?? rawState.status ?? rawState.phase, '');
  const normalizedName = rawName.toLowerCase().replace(/\s+/g, '-');
  const aliased = LEGACY_QUARANTINE_STATE_ALIASES.get(normalizedName) ?? normalizedName;
  const valid = KNOWN_QUARANTINE_STATES.has(aliased);
  const issues = [];
  if (!rawName) issues.push('persisted_state_missing');
  if (rawName && !valid) issues.push('persisted_state_unknown');
  if (rawName && valid && aliased !== rawName) issues.push('persisted_state_migrated');

  return {
    state: valid ? aliased : '',
    rawState: rawName || null,
    valid,
    migrated: Boolean(rawName && valid && aliased !== rawName),
    issues
  };
}

function targetPidsFromTargetRows(values) {
  const pids = [];
  for (const row of Array.isArray(values) ? values : []) {
    const target = asRecord(row);
    const pid = normalizePid(target.pid ?? target.id ?? target.processId);
    if (pid) pids.push(pid);
  }
  return pids;
}

function targetPidsFromFingerprint(value) {
  const fingerprint = asString(value, '');
  if (!fingerprint || fingerprint === 'no-targets') return [];
  return fingerprint.split(',').map(normalizePid).filter(Boolean);
}

function normalizePersistedTargetPids(rawState) {
  const handoff = asRecord(rawState.handoff);
  const handoffPayload = asRecord(handoff.payload);
  const providerSync = asRecord(rawState.providerSync ?? rawState.sync);
  const candidates = [
    { source: 'targetPids', pids: uniqueNormalizedPids(rawState.targetPids) },
    { source: 'pids', pids: uniqueNormalizedPids(rawState.pids) },
    { source: 'targets', pids: targetPidsFromTargetRows(rawState.targets) },
    { source: 'targetProcesses', pids: targetPidsFromTargetRows(rawState.targetProcesses) },
    { source: 'handoff.payload.targetPids', pids: uniqueNormalizedPids(handoffPayload.targetPids) },
    { source: 'providerSync.targetPids', pids: uniqueNormalizedPids(providerSync.targetPids) },
    { source: 'providerSync.targetFingerprint', pids: targetPidsFromFingerprint(providerSync.targetFingerprint ?? rawState.targetFingerprint) }
  ];
  const selected = candidates.find((candidate) => candidate.pids.length > 0) ?? { source: null, pids: [] };
  const issues = [];
  if (!selected.source) issues.push('persisted_targets_missing');
  if (selected.source && selected.source !== 'targetPids') issues.push('persisted_targets_recovered_from_legacy_shape');

  return {
    targetPids: selected.pids,
    source: selected.source,
    recovered: Boolean(selected.source && selected.source !== 'targetPids'),
    issues
  };
}

function normalizePersistedTimestampField(rawState, field, aliases) {
  for (const key of [field, ...aliases]) {
    const value = asString(rawState[key], null);
    if (!value) continue;
    if (parseTimeMs(value) === null) {
      return {
        value,
        source: key,
        valid: false,
        recovered: key !== field,
        issue: `${field}_invalid`
      };
    }
    return {
      value,
      source: key,
      valid: true,
      recovered: key !== field,
      issue: key !== field ? `${field}_recovered_from_${key}` : null
    };
  }

  return {
    value: null,
    source: null,
    valid: true,
    recovered: false,
    issue: null
  };
}

function normalizePersistedTimestamps(rawState) {
  const fields = {
    acknowledgedAt: normalizePersistedTimestampField(rawState, 'acknowledgedAt', ['ackAt', 'operatorAcknowledgedAt']),
    dispatchedAt: normalizePersistedTimestampField(rawState, 'dispatchedAt', ['dispatchAt', 'killDispatchedAt']),
    completedAt: normalizePersistedTimestampField(rawState, 'completedAt', ['finishedAt', 'closedAt']),
    updatedAt: normalizePersistedTimestampField(rawState, 'updatedAt', ['lastUpdatedAt', 'modifiedAt', 'timestamp'])
  };
  const issues = Object.entries(fields)
    .flatMap(([field, result]) => {
      if (!result.issue) return [];
      return [{
        code: result.issue,
        field,
        source: result.source,
        valid: result.valid
      }];
    });

  return {
    acknowledgedAt: fields.acknowledgedAt.value,
    dispatchedAt: fields.dispatchedAt.value,
    completedAt: fields.completedAt.value,
    updatedAt: fields.updatedAt.value,
    sources: Object.fromEntries(Object.entries(fields).map(([field, result]) => [field, result.source])),
    recoveredFields: Object.entries(fields)
      .filter(([, result]) => result.recovered)
      .map(([field]) => field),
    invalidFields: Object.entries(fields)
      .filter(([, result]) => !result.valid)
      .map(([field]) => field),
    issues
  };
}

function normalizePersistedIdempotency(rawState) {
  const command = asString(rawState.command ?? rawState.lastCommand ?? rawState.action, '');
  const previousIdempotencyKey = asString(rawState.idempotencyKey ?? rawState.restartToken ?? rawState.recoveryToken, '');
  const restartToken = asString(rawState.restartToken ?? rawState.recoveryToken ?? rawState.idempotencyKey, '');
  const issues = [];
  if (!previousIdempotencyKey && command) issues.push('persisted_idempotency_key_missing');
  if (!rawState.restartToken && (rawState.recoveryToken || rawState.idempotencyKey)) {
    issues.push('persisted_restart_token_recovered');
  }

  return {
    command,
    restartToken,
    previousIdempotencyKey,
    issues,
    source: rawState.restartToken
      ? 'restartToken'
      : rawState.recoveryToken
        ? 'recoveryToken'
        : rawState.idempotencyKey
          ? 'idempotencyKey'
          : null
  };
}

function evaluatePersistedKillQuarantineTruth({
  rawState,
  normalizedState,
  persistedKernelId,
  kernelId,
  persistedTargetPids,
  persistedTimestamps,
  persistedIdempotency,
  now
}) {
  const nowMs = parseTimeMs(now) ?? Date.now();
  const updatedAtMs = parseTimeMs(persistedTimestamps.updatedAt);
  const completedAtMs = parseTimeMs(persistedTimestamps.completedAt);
  const acknowledgedAtMs = parseTimeMs(persistedTimestamps.acknowledgedAt);
  const dispatchedAtMs = parseTimeMs(persistedTimestamps.dispatchedAt);
  const present = Boolean(
    Object.keys(rawState).length > 0 ||
      normalizedState.rawState ||
      persistedTargetPids.length > 0 ||
      persistedIdempotency.previousIdempotencyKey
  );
  const kernelMatches = persistedKernelId === kernelId;
  const stateKnown = normalizedState.valid && Boolean(normalizedState.state);
  const timestampParseable = persistedTimestamps.invalidFields.length === 0;
  const updatedAtPresent = Boolean(persistedTimestamps.updatedAt);
  const updatedAtParseable = updatedAtMs !== null;
  const ageMs = updatedAtParseable ? Math.max(0, nowMs - updatedAtMs) : null;
  const futureUpdatedAt = updatedAtParseable && updatedAtMs > nowMs + 60_000;
  const staleActiveState = Boolean(
    ACTIVE_QUARANTINE_STATES.has(normalizedState.state) &&
      ageMs !== null &&
      ageMs > MAX_PERSISTED_RECOVERY_AGE_MS
  );
  const completedBeforeDispatch = completedAtMs !== null && dispatchedAtMs !== null && completedAtMs < dispatchedAtMs;
  const dispatchedBeforeAck = dispatchedAtMs !== null && acknowledgedAtMs !== null && dispatchedAtMs < acknowledgedAtMs;
  const targetProofRequired = ACTIVE_QUARANTINE_STATES.has(normalizedState.state);
  const targetProofPresent = !targetProofRequired || persistedTargetPids.length > 0;
  const restartTokenPresent = Boolean(
    persistedIdempotency.restartToken ||
      persistedIdempotency.previousIdempotencyKey ||
      !ACTIVE_QUARANTINE_STATES.has(normalizedState.state)
  );
  const failures = normalizeStringList([
    !present ? 'persisted_state_absent' : '',
    present && !kernelMatches ? 'persisted_kernel_mismatch' : '',
    present && !stateKnown ? 'persisted_state_not_replayable' : '',
    present && !timestampParseable ? 'persisted_timestamp_invalid' : '',
    present && !updatedAtPresent ? 'persisted_updated_at_missing' : '',
    present && updatedAtPresent && !updatedAtParseable ? 'persisted_updated_at_invalid' : '',
    present && futureUpdatedAt ? 'persisted_updated_at_in_future' : '',
    present && staleActiveState ? 'persisted_active_state_stale' : '',
    present && !targetProofPresent ? 'persisted_active_targets_missing' : '',
    present && !restartTokenPresent ? 'persisted_restart_token_missing' : '',
    present && completedBeforeDispatch ? 'persisted_completed_before_dispatch' : '',
    present && dispatchedBeforeAck ? 'persisted_dispatched_before_ack' : ''
  ]);
  const blockingFailures = failures.filter((failure) => failure !== 'persisted_state_absent');
  const trustedForReplay = present && blockingFailures.length === 0;
  const trustLevel = !present
    ? 'absent'
    : trustedForReplay
      ? normalizedState.migrated || persistedIdempotency.source !== 'restartToken'
        ? 'trusted-after-compatibility-recovery'
        : 'trusted'
      : kernelMatches
        ? 'untrusted-same-kernel'
        : 'foreign-state';

  return {
    contract: 'hosted-kernel.kill-quarantine.persisted-state-truth.v1',
    present,
    kernelMatches,
    stateKnown,
    timestampParseable,
    updatedAtPresent,
    updatedAtParseable,
    ageMs,
    maxReplayAgeMs: MAX_PERSISTED_RECOVERY_AGE_MS,
    futureUpdatedAt,
    staleActiveState,
    targetProofPresent,
    restartTokenPresent,
    timelineOrderValid: !completedBeforeDispatch && !dispatchedBeforeAck,
    trustedForReplay,
    trustLevel,
    failures,
    blockingFailures,
    replayDisposition: !present
      ? 'cold-start'
      : trustedForReplay
        ? 'replay-authoritative-state'
        : kernelMatches
          ? 'quarantine-and-repair-persisted-state-before-replay'
          : 'ignore-foreign-persisted-state',
    repairAction: trustedForReplay
      ? 'retain-persisted-state'
      : !kernelMatches
        ? 'ignore-state-for-requested-kernel'
        : staleActiveState
          ? 'expire-or-reconcile-stale-active-quarantine'
          : 'repair-persisted-kill-quarantine-state'
  };
}

function classifyProcessBoundary(process, boundary) {
  const tenantRequired = Boolean(boundary.tenantId);
  const workspaceRequired = Boolean(boundary.workspaceId);
  const tenantKnown = Boolean(process.tenantId);
  const workspaceKnown = Boolean(process.workspaceId);
  const tenantMatches = !tenantRequired || process.tenantId === boundary.tenantId;
  const workspaceMatches = !workspaceRequired || process.workspaceId === boundary.workspaceId;
  const missingClaims = normalizeStringList([
    tenantRequired && !tenantKnown ? 'tenantId' : '',
    workspaceRequired && !workspaceKnown ? 'workspaceId' : ''
  ]);
  const mismatchedClaims = normalizeStringList([
    tenantRequired && tenantKnown && !tenantMatches ? 'tenantId' : '',
    workspaceRequired && workspaceKnown && !workspaceMatches ? 'workspaceId' : ''
  ]);
  const allowed = missingClaims.length === 0 && mismatchedClaims.length === 0;

  return {
    pid: process.pid,
    tenantId: process.tenantId || null,
    workspaceId: process.workspaceId || null,
    allowed,
    missingClaims,
    mismatchedClaims,
    reason: allowed
      ? 'within_boundary'
      : missingClaims.length > 0
        ? 'target_boundary_unproven'
        : 'target_boundary_mismatch'
  };
}

function processWithinBoundary(process, boundary) {
  return classifyProcessBoundary(process, boundary).allowed;
}

function buildBoundaryAccessContract({ boundary, grants, processes, intent }) {
  const globalRole = grants.roles.find((role) => KILL_QUARANTINE_GLOBAL_ROLES.has(role)) ?? null;
  const scopedRole = grants.roles.find((role) => KILL_QUARANTINE_SCOPED_ROLES.has(role)) ?? null;
  const tenantClaimed = !boundary.tenantId || grants.tenantIds.includes(boundary.tenantId);
  const workspaceClaimed = !boundary.workspaceId || grants.workspaceIds.includes(boundary.workspaceId);
  const permissionGrant = grants.authorizedPermission;
  const grantScopeRequired = Boolean(scopedRole && !globalRole && !permissionGrant);
  const grantScopeSatisfied = !grantScopeRequired
    || !grants.hasBoundaryClaims
    || (tenantClaimed && workspaceClaimed);
  const processByPid = new Map(processes.map((process) => [process.pid, process]));
  const boundaryCandidateProcesses = intent.requestedPids.length > 0
    ? intent.requestedPids.map((pid) => processByPid.get(pid)).filter(Boolean)
    : processes;
  const requestedBoundaryRows = boundaryCandidateProcesses
    .map((process) => classifyProcessBoundary(process, boundary));
  const unprovenPids = requestedBoundaryRows
    .filter((row) => row.reason === 'target_boundary_unproven')
    .map((row) => row.pid);
  const mismatchedPids = requestedBoundaryRows
    .filter((row) => row.reason === 'target_boundary_mismatch')
    .map((row) => row.pid);
  const errors = normalizeStringList([
    boundary.scoped ? '' : 'boundary_missing',
    grantScopeSatisfied ? '' : 'operator_boundary_claim_mismatch',
    unprovenPids.length > 0 ? 'target_boundary_unproven' : '',
    mismatchedPids.length > 0 ? 'target_boundary_mismatch' : ''
  ]);

  return {
    contract: 'hosted-kernel.kill-quarantine.boundary-access.v1',
    boundary,
    principalScope: {
      mode: globalRole
        ? 'global-role'
        : permissionGrant
          ? 'permission'
          : scopedRole
            ? 'scoped-role'
            : 'unscoped',
      role: globalRole ?? scopedRole,
      permission: permissionGrant,
      tenantIds: grants.tenantIds,
      workspaceIds: grants.workspaceIds,
      hasBoundaryClaims: grants.hasBoundaryClaims,
      grantScopeRequired,
      grantScopeSatisfied
    },
    targetScope: {
      requestedBoundaryRows,
      unprovenPids,
      mismatchedPids,
      outOfScopePids: intent.outOfScopePids,
      acceptedPids: intent.targetPids
    },
    allowed: errors.length === 0,
    errors,
    auditLabel: errors.length === 0
      ? 'tenant_workspace_boundary_verified'
      : `tenant_workspace_boundary_blocked:${errors.join('+')}`
  };
}

function authorizeKillQuarantine({ operatorId, grants, boundary }) {
  const hasGrant = Boolean(grants.authorizedRole || grants.authorizedPermission);
  const serviceOperator = operatorId === 'system' && !grants.roles.length && !grants.permissions.length;
  const scopedSystemRecovery = serviceOperator && boundary.scoped;
  const scopedRoleNeedsBoundary = grants.authorizedRole
    && KILL_QUARANTINE_SCOPED_ROLES.has(grants.authorizedRole)
    && !boundary.scoped;
  if (hasGrant || scopedSystemRecovery) {
    if (scopedRoleNeedsBoundary && !grants.authorizedPermission) {
      return {
        allowed: false,
        mode: 'denied',
        role: grants.authorizedRole,
        permission: null,
        reason: 'scoped_operator_requires_tenant_or_workspace'
      };
    }
    return {
      allowed: true,
      mode: grants.authorizedPermission ? 'permission' : grants.authorizedRole ? 'role' : 'system-scoped-recovery',
      role: grants.authorizedRole,
      permission: grants.authorizedPermission,
      reason: null
    };
  }

  return {
    allowed: false,
    mode: 'denied',
    role: null,
    permission: null,
    reason: 'operator_missing_kill_quarantine_grant'
  };
}

function normalizePersistedKillQuarantineState(input, { now, kernelId }) {
  const clientState = asRecord(input.clientState);
  const lifecycleState = asRecord(clientState.kernelLifecycle);
  const stateCandidates = [
    input.persistedKillQuarantine,
    input.persistedState,
    lifecycleState.killQuarantine,
    asRecord(asRecord(input.kernel).lifecycle).killQuarantine
  ];
  const rawState = stateCandidates.map(asRecord).find((state) => Object.keys(state).length > 0) ?? {};
  const normalizedState = normalizePersistedStateName(rawState);
  const state = normalizedState.state;
  const persistedKernelId = asString(rawState.kernelId, kernelId);
  const persistedTargets = normalizePersistedTargetPids(rawState);
  const persistedTargetPids = persistedTargets.targetPids;
  const persistedTimestamps = normalizePersistedTimestamps(rawState);
  const persistedIdempotency = normalizePersistedIdempotency(rawState);
  const dispatchedAt = persistedTimestamps.dispatchedAt;
  const acknowledgedAt = persistedTimestamps.acknowledgedAt;
  const completedAt = persistedTimestamps.completedAt;
  const updatedAt = persistedTimestamps.updatedAt;
  const requestId = asString(rawState.requestId, '');
  const restartToken = persistedIdempotency.restartToken;
  const recoveryTruth = evaluatePersistedKillQuarantineTruth({
    rawState,
    normalizedState,
    persistedKernelId,
    kernelId,
    persistedTargetPids,
    persistedTimestamps,
    persistedIdempotency,
    now
  });
  const stateBelongsToKernel = persistedKernelId === kernelId && recoveryTruth.trustedForReplay;
  const active = stateBelongsToKernel && ACTIVE_QUARANTINE_STATES.has(state);
  const final = stateBelongsToKernel && FINAL_QUARANTINE_STATES.has(state);
  const previousControls = asRecord(rawState.controls);
  const previousOperatorAck = asRecord(rawState.operatorAck);
  const shapeIssues = normalizeStringList([
    ...persistedTargets.issues,
    ...persistedTimestamps.issues.map((issue) => issue.code),
    ...persistedIdempotency.issues
  ]);

  return {
    contract: 'hosted-kernel.kill-quarantine.persisted-state.v1',
    present: Boolean(requestId || state || persistedTargetPids.length > 0),
    active,
    final,
    state,
    rawState: normalizedState.rawState,
    stateValid: normalizedState.valid,
    stateMigrated: normalizedState.migrated,
    stateIssues: normalizedState.issues,
    recoveryTruth,
    trustedForReplay: recoveryTruth.trustedForReplay,
    trustLevel: recoveryTruth.trustLevel,
    replayDisposition: recoveryTruth.replayDisposition,
    activeSuppressedByRecoveryTrust: Boolean(
      recoveryTruth.present &&
        persistedKernelId === kernelId &&
        ACTIVE_QUARANTINE_STATES.has(state) &&
        !recoveryTruth.trustedForReplay
    ),
    shapeIssues,
    shapeRecovered: Boolean(
      normalizedState.migrated
        || persistedTargets.recovered
        || persistedTimestamps.recoveredFields.length > 0
        || persistedIdempotency.source && persistedIdempotency.source !== 'restartToken'
    ),
    targetSource: persistedTargets.source,
    timestampSources: persistedTimestamps.sources,
    recoveredFields: normalizeStringList([
      normalizedState.migrated ? 'state' : '',
      persistedTargets.recovered ? 'targetPids' : '',
      ...persistedTimestamps.recoveredFields,
      persistedIdempotency.source && persistedIdempotency.source !== 'restartToken' ? 'restartToken' : ''
    ]),
    invalidTimestampFields: persistedTimestamps.invalidFields,
    requestId,
    kernelId: persistedKernelId,
    targetPids: persistedTargetPids,
    reason: asString(rawState.reason, DEFAULT_REASON),
    operatorId: asString(rawState.operatorId, 'system'),
    acknowledgedAt,
    dispatchedAt,
    completedAt,
    updatedAt,
    restartToken,
    restartSafeStatus: asString(rawState.restartSafeStatus, state || null),
    previousIdempotencyKey: persistedIdempotency.previousIdempotencyKey,
    previousCommand: persistedIdempotency.command,
    controls: {
      requireAck: previousControls.requireAck === undefined ? null : asBoolean(previousControls.requireAck, false),
      ackTimeoutMs: previousControls.ackTimeoutMs === undefined ? null : asNonNegativeInteger(previousControls.ackTimeoutMs, 0),
      dispatchDelayMs: previousControls.dispatchDelayMs === undefined ? null : asNonNegativeInteger(previousControls.dispatchDelayMs, 0),
      maxTargets: previousControls.maxTargets === undefined ? null : asNonNegativeInteger(previousControls.maxTargets, 0),
      scheduleAt: asString(previousControls.scheduleAt, null)
    },
    operatorAck: Object.keys(previousOperatorAck).length > 0
      ? {
          accepted: asBoolean(previousOperatorAck.accepted, false),
          requestId: asString(previousOperatorAck.requestId, ''),
          confirmed: asBoolean(previousOperatorAck.confirmed, false),
          issues: normalizeStringList(previousOperatorAck.issues)
        }
      : null,
    recoveredAt: active ? now : null
  };
}

function deriveRecoveryCommand({ accepted, requestId, reason, operatorId, intent, persisted, controls, operatorAck, quarantineClock }) {
  const sameRequest = persisted.requestId === requestId;
  const sameTargets = samePidSet(persisted.targetPids, intent.targetPids);
  const resumable = persisted.active && sameTargets;
  const duplicate = resumable && sameRequest;
  const supersedesActive = accepted && persisted.active && (!sameRequest || !sameTargets);

  if (!controls.enabled && controls.cancelActiveWhenDisabled && persisted.active) {
    return {
      command: 'cancel-quarantine',
      idempotencyKey: `kill-quarantine:cancel:${persisted.requestId}:${controls.disabledReason}`,
      recovery: 'cancel-active-quarantine-disabled-by-settings',
      restartSafeStatus: 'cancelled-by-lifecycle-settings',
      persistedState: 'cancelled'
    };
  }

  if (!accepted) {
    if (quarantineClock.ackExpired && persisted.active) {
      return {
        command: 'expire-quarantine',
        idempotencyKey: `kill-quarantine:expire:${persisted.requestId}`,
        recovery: 'expire-stale-quarantine',
        restartSafeStatus: 'blocked-stale-ack-timeout',
        persistedState: 'blocked'
      };
    }
    return {
      command: 'block',
      idempotencyKey: `kill-quarantine:block:${requestId}`,
      recovery: persisted.active ? 'preserve-active-quarantine' : 'none',
      restartSafeStatus: persisted.active ? 'active-quarantine-preserved' : 'blocked-no-live-targets',
      persistedState: persisted.active ? persisted.state : 'blocked'
    };
  }

  if (duplicate) {
    if (persisted.state === 'quarantine-acknowledged' && quarantineClock.dispatchDue) {
      return {
        command: 'dispatch-kill',
        idempotencyKey: `kill-quarantine:dispatch:${persisted.requestId}:${persisted.targetPids.join(',')}`,
        recovery: 'delayed-dispatch-due',
        restartSafeStatus: 'kill-dispatched',
        persistedState: 'kill-dispatched'
      };
    }
    if (operatorAck.accepted) {
      return {
        command: controls.dispatchDelayMs > 0 ? 'acknowledge-quarantine' : 'dispatch-kill',
        idempotencyKey: `kill-quarantine:dispatch:${persisted.requestId}:${persisted.targetPids.join(',')}`,
        recovery: 'operator-acknowledged-existing-quarantine',
        restartSafeStatus: controls.dispatchDelayMs > 0 ? 'quarantine-acknowledged' : 'kill-dispatched',
        persistedState: controls.dispatchDelayMs > 0 ? 'quarantine-acknowledged' : 'kill-dispatched'
      };
    }
    return {
      command: persisted.state === 'kill-dispatched' ? 'observe-kill' : 'resume-quarantine',
      idempotencyKey: `kill-quarantine:resume:${persisted.requestId}`,
      recovery: 'reattach-existing-request',
      restartSafeStatus: persisted.state,
      persistedState: persisted.state
    };
  }

  if (resumable) {
    if (persisted.state === 'quarantine-acknowledged' && quarantineClock.dispatchDue) {
      return {
        command: 'dispatch-kill',
        idempotencyKey: `kill-quarantine:dispatch:${persisted.requestId}:${persisted.targetPids.join(',')}`,
        recovery: 'delayed-dispatch-due-equivalent-targets',
        restartSafeStatus: 'kill-dispatched',
        persistedState: 'kill-dispatched'
      };
    }
    if (operatorAck.accepted) {
      return {
        command: controls.dispatchDelayMs > 0 ? 'acknowledge-quarantine' : 'dispatch-kill',
        idempotencyKey: `kill-quarantine:dispatch:${persisted.requestId}:${persisted.targetPids.join(',')}`,
        recovery: 'operator-acknowledged-equivalent-targets',
        restartSafeStatus: controls.dispatchDelayMs > 0 ? 'quarantine-acknowledged' : 'kill-dispatched',
        persistedState: controls.dispatchDelayMs > 0 ? 'quarantine-acknowledged' : 'kill-dispatched'
      };
    }
    return {
      command: 'resume-quarantine',
      idempotencyKey: `kill-quarantine:resume:${persisted.requestId}`,
      recovery: 'reattach-equivalent-targets',
      restartSafeStatus: persisted.state,
      persistedState: persisted.state
    };
  }

  if (controls.scheduled && !controls.scheduleDue) {
    return {
      command: supersedesActive ? 'supersede-and-schedule-quarantine' : 'schedule-quarantine',
      idempotencyKey: `kill-quarantine:schedule:${requestId}:${controls.scheduleAt}:${intent.targetPids.join(',')}`,
      recovery: supersedesActive ? 'supersede-active-request' : 'scheduled-request',
      restartSafeStatus: 'scheduled-quarantine',
      persistedState: 'scheduled-quarantine'
    };
  }

  return {
    command: supersedesActive ? 'supersede-and-stage-quarantine' : 'stage-quarantine',
    idempotencyKey: `kill-quarantine:stage:${requestId}:${intent.targetPids.join(',')}:${reason}:${operatorId}`,
    recovery: supersedesActive ? 'supersede-active-request' : 'new-request',
    restartSafeStatus: 'awaiting-quarantine-ack',
    persistedState: 'awaiting-quarantine-ack'
  };
}

function buildPersistedKillQuarantineState({ now, kernelId, requestId, reason, operatorId, intent, persisted, recoveryCommand, controls, operatorAck }) {
  if (recoveryCommand.command === 'cancel-quarantine') {
    return {
      ...persisted,
      contract: 'hosted-kernel.kill-quarantine.persisted-state.v1',
      kernelId,
      state: 'cancelled',
      command: recoveryCommand.command,
      idempotencyKey: recoveryCommand.idempotencyKey,
      reason: persisted.reason || reason,
      operatorId,
      completedAt: now,
      updatedAt: now,
      recoveredAt: now,
      restartToken: recoveryCommand.idempotencyKey,
      restartSafeStatus: recoveryCommand.restartSafeStatus,
      cancellation: {
        contract: 'hosted-kernel.kill-quarantine.cancellation.v1',
        cancelledAt: now,
        cancelledBy: operatorId,
        reason: controls.disabledReason,
        source: controls.source,
        previousState: persisted.state || persisted.rawState,
        previousRequestId: persisted.requestId || requestId,
        targetPids: persisted.targetPids.length > 0 ? persisted.targetPids : intent.targetPids
      },
      controls: {
        requireAck: controls.requireAck,
        ackTimeoutMs: controls.ackTimeoutMs,
        dispatchDelayMs: controls.dispatchDelayMs,
        heartbeatStaleMs: controls.heartbeatStaleMs,
        degradedMode: controls.degradedMode,
        maxTargets: controls.maxTargets,
        scheduleAt: controls.scheduleAt,
        scheduleDue: controls.scheduleDue,
        enabled: controls.enabled,
        disabledReason: controls.disabledReason,
        cancelActiveWhenDisabled: controls.cancelActiveWhenDisabled
      },
      operatorAck: operatorAck.present
        ? {
            contract: operatorAck.contract,
            accepted: operatorAck.accepted,
            requestId: operatorAck.requestId,
            confirmed: operatorAck.confirmed,
            targetPids: operatorAck.targetPids,
            operatorNote: operatorAck.operatorNote || null,
            issues: operatorAck.issues
          }
        : null
    };
  }

  if (recoveryCommand.command === 'expire-quarantine') {
    return {
      ...persisted,
      contract: 'hosted-kernel.kill-quarantine.persisted-state.v1',
      kernelId,
      state: 'blocked',
      command: recoveryCommand.command,
      idempotencyKey: recoveryCommand.idempotencyKey,
      completedAt: now,
      updatedAt: now,
      recoveredAt: now,
      restartToken: recoveryCommand.idempotencyKey,
      restartSafeStatus: recoveryCommand.restartSafeStatus,
      controls: {
        requireAck: controls.requireAck,
        ackTimeoutMs: controls.ackTimeoutMs,
        dispatchDelayMs: controls.dispatchDelayMs,
        heartbeatStaleMs: controls.heartbeatStaleMs,
        degradedMode: controls.degradedMode,
        maxTargets: controls.maxTargets,
        scheduleAt: controls.scheduleAt,
        scheduleDue: controls.scheduleDue
      },
      operatorAck: operatorAck.present
        ? {
            contract: operatorAck.contract,
            accepted: operatorAck.accepted,
            requestId: operatorAck.requestId,
            confirmed: operatorAck.confirmed,
            targetPids: operatorAck.targetPids,
            operatorNote: operatorAck.operatorNote || null,
            issues: operatorAck.issues
          }
        : null
    };
  }

  if (recoveryCommand.command === 'block' && persisted.active) {
    return {
      ...persisted,
      contract: 'hosted-kernel.kill-quarantine.persisted-state.v1',
      command: recoveryCommand.command,
      idempotencyKey: recoveryCommand.idempotencyKey,
      recoveredAt: now,
      restartSafeStatus: recoveryCommand.restartSafeStatus
    };
  }

  const base = recoveryCommand.command === 'resume-quarantine' || recoveryCommand.command === 'observe-kill'
    || recoveryCommand.command === 'acknowledge-quarantine' || recoveryCommand.command === 'dispatch-kill'
    ? persisted
    : {};
  const acked = recoveryCommand.command === 'acknowledge-quarantine' || recoveryCommand.command === 'dispatch-kill';

  return {
    ...base,
    contract: 'hosted-kernel.kill-quarantine.persisted-state.v1',
    requestId: recoveryCommand.command === 'resume-quarantine' || recoveryCommand.command === 'observe-kill'
      || recoveryCommand.command === 'acknowledge-quarantine' || recoveryCommand.command === 'dispatch-kill'
      ? persisted.requestId
      : requestId,
    kernelId,
    state: recoveryCommand.persistedState,
    command: recoveryCommand.command,
    idempotencyKey: recoveryCommand.idempotencyKey,
    reason,
    operatorId,
    targetPids: intent.targetPids,
    acknowledgedAt: acked ? now : base.acknowledgedAt ?? null,
    dispatchedAt: recoveryCommand.command === 'dispatch-kill' ? now : base.dispatchedAt ?? null,
    completedAt: base.completedAt ?? null,
    updatedAt: now,
    recoveredAt: persisted.active ? now : null,
    restartToken: recoveryCommand.idempotencyKey,
    restartSafeStatus: recoveryCommand.restartSafeStatus,
    shapeRecovered: persisted.shapeRecovered,
    shapeIssues: persisted.shapeIssues,
    recoveredFields: persisted.recoveredFields,
    targetSource: persisted.targetSource,
    timestampSources: persisted.timestampSources,
    invalidTimestampFields: persisted.invalidTimestampFields,
    controls: {
      requireAck: controls.requireAck,
      ackTimeoutMs: controls.ackTimeoutMs,
      dispatchDelayMs: controls.dispatchDelayMs,
      heartbeatStaleMs: controls.heartbeatStaleMs,
      degradedMode: controls.degradedMode,
      maxTargets: controls.maxTargets,
      scheduleAt: controls.scheduleAt,
      scheduleDue: controls.scheduleDue
    },
    operatorAck: operatorAck.present
      ? {
          contract: operatorAck.contract,
          accepted: operatorAck.accepted,
          requestId: operatorAck.requestId,
          confirmed: operatorAck.confirmed,
          targetPids: operatorAck.targetPids,
          operatorNote: operatorAck.operatorNote || null,
          issues: operatorAck.issues
        }
      : null
  };
}

function normalizeKillIntent(input, processes, boundary) {
  const killRequest = asRecord(input.killRequest);
  const pidClaims = normalizeRequestedPidClaims(killRequest.pids);
  const requestedPids = pidClaims.requestedPids;
  const explicitProcessSelection = pidClaims.explicit || killRequest.scope === 'processes';
  const targetAll = killRequest.scope === 'kernel' || (!explicitProcessSelection && requestedPids.length === 0);
  const processByPid = new Map(processes.map((process) => [process.pid, process]));
  const scopedProcesses = processes.filter((process) => processWithinBoundary(process, boundary));
  const targets = targetAll
    ? scopedProcesses.filter((process) => process.quarantinable)
    : requestedPids.map((pid) => processByPid.get(pid))
        .filter((process) => process && processWithinBoundary(process, boundary) && process.quarantinable);
  const outOfScopePids = targetAll
    ? processes.filter((process) => !processWithinBoundary(process, boundary)).map((process) => process.pid)
    : requestedPids.filter((pid) => {
        const process = processByPid.get(pid);
        return process && !processWithinBoundary(process, boundary);
      });

  return {
    scope: targetAll ? 'kernel' : 'processes',
    requestedPids,
    requestedPidClaims: pidClaims,
    requestedRawCount: pidClaims.rawCount,
    duplicateRequestedPids: pidClaims.duplicatePids,
    invalidPidClaims: pidClaims.invalidPidClaims,
    boundary,
    targetPids: targets.map((process) => process.pid),
    missingPids: targetAll ? [] : requestedPids.filter((pid) => !processByPid.has(pid)),
    outOfScopePids,
    skippedPids: targetAll
      ? scopedProcesses.filter((process) => !process.quarantinable).map((process) => process.pid)
      : requestedPids.filter((pid) => {
          const process = processByPid.get(pid);
          return processByPid.has(pid) && processWithinBoundary(process, boundary) && !process.quarantinable;
        })
  };
}

function normalizeReason(input) {
  const requestedReason = asString(asRecord(input.killRequest).reason ?? input.reason, DEFAULT_REASON);
  return QUARANTINE_REASONS.has(requestedReason) ? requestedReason : DEFAULT_REASON;
}

function buildValidationReport({ kernelId, requestedReason, boundary, boundaryAccess, intent, authorization, controls, provider, providerHealth, persisted, operatorAck, quarantineClock }) {
  const issues = [];
  if (kernelId === 'hosted-kernel:unknown') {
    issues.push({
      code: 'kernel_id_missing',
      field: 'kernelId',
      severity: 'error',
      message: 'Hosted-kernel kill quarantine requires a concrete kernel id.'
    });
  }
  if (requestedReason && !QUARANTINE_REASONS.has(requestedReason)) {
    issues.push({
      code: 'reason_normalized',
      field: 'killRequest.reason',
      severity: 'warning',
      message: `Unsupported quarantine reason was normalized to ${DEFAULT_REASON}.`
    });
  }
  if (!boundary.scoped) {
    issues.push({
      code: 'kernel_scope_unbounded',
      field: 'killRequest.scope',
      severity: 'error',
      message: 'Hosted-kernel kill quarantine must include a tenantId or workspaceId boundary.'
    });
  }
  if (!authorization.allowed) {
    issues.push({
      code: authorization.reason,
      field: 'operator',
      severity: 'error',
      message: 'Operator lacks a kill-quarantine role or permission for this boundary.'
    });
  }
  if (boundaryAccess.errors.includes('operator_boundary_claim_mismatch')) {
    issues.push({
      code: 'operator_boundary_claim_mismatch',
      field: 'operator.grants',
      severity: 'error',
      message: 'Scoped operator grants do not include the requested tenant/workspace boundary.',
      tenantId: boundary.tenantId || null,
      workspaceId: boundary.workspaceId || null
    });
  }
  if (boundaryAccess.targetScope.unprovenPids.length > 0) {
    issues.push({
      code: 'target_boundary_unproven',
      field: 'processes',
      severity: 'error',
      message: 'Some requested process rows are missing tenant/workspace claims required to prove boundary isolation.',
      pids: boundaryAccess.targetScope.unprovenPids
    });
  }
  if (boundaryAccess.targetScope.mismatchedPids.length > 0) {
    issues.push({
      code: 'target_boundary_mismatch',
      field: 'processes',
      severity: 'error',
      message: 'Some requested process rows belong to a different tenant/workspace boundary.',
      pids: boundaryAccess.targetScope.mismatchedPids
    });
  }
  if (!controls.enabled) {
    issues.push({
      code: 'kill_quarantine_disabled',
      field: 'killQuarantineSettings.enabled',
      severity: 'error',
      message: 'Hosted-kernel kill quarantine is disabled by lifecycle settings.',
      disabledReason: controls.disabledReason,
      cancelActiveWhenDisabled: controls.cancelActiveWhenDisabled
    });
  }
  if (controls.maxTargets === 0) {
    issues.push({
      code: 'target_limit_zero',
      field: 'killQuarantineSettings.maxTargets',
      severity: 'error',
      message: 'Hosted-kernel kill quarantine cannot target processes while maxTargets is zero.'
    });
  }
  if (!controls.scheduleValid) {
    issues.push({
      code: 'invalid_quarantine_schedule',
      field: 'killRequest.scheduleAt',
      severity: 'error',
      message: 'Scheduled kill quarantine requires an ISO-compatible scheduleAt timestamp.'
    });
  }
  if (intent.targetPids.length > controls.maxTargets) {
    issues.push({
      code: 'target_limit_exceeded',
      field: 'killRequest.pids',
      severity: 'error',
      message: `Kill quarantine target count exceeds the configured limit of ${controls.maxTargets}.`,
      limit: controls.maxTargets,
      targetCount: intent.targetPids.length
    });
  }
  if (intent.requestedPidClaims.explicit && intent.requestedRawCount > 0 && intent.requestedPids.length === 0) {
    issues.push({
      code: 'requested_pids_empty_after_normalization',
      field: 'killRequest.pids',
      severity: 'error',
      message: 'Explicit kill-quarantine process ids did not contain any usable pid values.',
      invalidPidClaims: intent.invalidPidClaims
    });
  }
  if (intent.invalidPidClaims.length > 0) {
    issues.push({
      code: 'requested_pids_invalid',
      field: 'killRequest.pids',
      severity: intent.requestedPids.length > 0 ? 'warning' : 'error',
      message: 'Some requested process id entries were ignored because they were blank or not pid-like values.',
      invalidPidClaims: intent.invalidPidClaims
    });
  }
  if (intent.duplicateRequestedPids.length > 0) {
    issues.push({
      code: 'requested_pids_deduplicated',
      field: 'killRequest.pids',
      severity: 'warning',
      message: 'Duplicate requested process ids were collapsed before kill-quarantine targeting.',
      duplicatePids: intent.duplicateRequestedPids
    });
  }
  if (intent.missingPids.length > 0) {
    issues.push({
      code: 'requested_pids_missing',
      field: 'killRequest.pids',
      severity: 'warning',
      message: 'Some requested process ids were not present in the hosted-kernel process table.',
      pids: intent.missingPids
    });
  }
  if (intent.outOfScopePids.length > 0) {
    issues.push({
      code: 'requested_pids_out_of_scope',
      field: 'killRequest.pids',
      severity: 'error',
      message: 'Some requested process ids are outside the tenant/workspace boundary.',
      pids: intent.outOfScopePids
    });
  }
  if (!provider.ready) {
    issues.push({
      code: 'provider_capabilities_missing',
      field: 'killQuarantineProvider.capabilities',
      severity: 'error',
      message: 'Kill-quarantine provider is missing required service capabilities.',
      missingCapabilities: provider.missingCapabilities
    });
  }
  if (provider.externalState.blocking) {
    issues.push({
      code: 'provider_external_state_blocked',
      field: 'killQuarantineProvider.report.status',
      severity: 'error',
      message: 'Kill-quarantine provider reported a blocking external handoff state.',
      providerStatus: provider.externalState.status,
      providerReason: provider.externalState.blockingReason,
      providerIssues: provider.externalState.issues
    });
  }
  for (const providerIssue of providerHealth.issues) {
    if (['provider_capabilities_missing', 'provider_external_state_blocked'].includes(providerIssue.code)) continue;
    issues.push({
      code: providerIssue.code,
      field: 'killQuarantineProvider.report',
      severity: providerIssue.severity,
      message: providerIssue.message,
      action: providerIssue.action,
      retryable: providerIssue.retryable,
      providerStatus: provider.externalState.status,
      providerHealthStatus: providerHealth.status,
      providerFailureCode: providerIssue.providerFailureCode ?? null,
      failedPids: providerIssue.failedPids ?? [],
      targetFailures: providerIssue.targetFailures ?? [],
      retryAfterMs: providerHealth.retryAfterMs
    });
  }
  if (persisted.present && persisted.kernelId === kernelId && persisted.stateIssues.length > 0) {
    issues.push({
      code: persisted.stateValid ? 'persisted_state_recovered' : 'persisted_state_unrecognized',
      field: 'persistence.killQuarantine.state',
      severity: persisted.stateValid ? 'warning' : 'error',
      message: persisted.stateValid
        ? `Persisted kill-quarantine state was recovered as ${persisted.state}.`
        : 'Persisted kill-quarantine state is not recognized and cannot be replayed safely.',
      rawState: persisted.rawState,
      recoveredState: persisted.state || null,
      stateIssues: persisted.stateIssues
    });
  }
  if (persisted.present && persisted.kernelId === kernelId && persisted.shapeIssues.length > 0) {
    const invalidShape = persisted.invalidTimestampFields.length > 0;
    issues.push({
      code: invalidShape ? 'persisted_state_shape_invalid' : 'persisted_state_shape_recovered',
      field: 'persistence.killQuarantine',
      severity: invalidShape ? 'error' : 'warning',
      message: invalidShape
        ? 'Persisted kill-quarantine state has invalid timestamp fields and cannot be replayed safely.'
        : 'Persisted kill-quarantine state was replayed from a compatible legacy/provider shape.',
      shapeIssues: persisted.shapeIssues,
      recoveredFields: persisted.recoveredFields,
      targetSource: persisted.targetSource,
      timestampSources: persisted.timestampSources,
      invalidTimestampFields: persisted.invalidTimestampFields
    });
  }
  if (persisted.present && persisted.kernelId === kernelId && !persisted.trustedForReplay) {
    issues.push({
      code: 'persisted_state_untrusted_for_replay',
      field: 'persistence.killQuarantine',
      severity: 'error',
      message: 'Persisted kill-quarantine state failed recovery truth checks and will not be replayed as an active quarantine.',
      trustLevel: persisted.trustLevel,
      replayDisposition: persisted.replayDisposition,
      recoveryFailures: persisted.recoveryTruth.blockingFailures,
      repairAction: persisted.recoveryTruth.repairAction
    });
  }
  if (operatorAck.present && !provider.capabilities.includes(KILL_QUARANTINE_DISPATCH_CAPABILITY)) {
    issues.push({
      code: 'provider_dispatch_missing_after_ack',
      field: 'killQuarantineProvider.capabilities',
      severity: 'error',
      message: 'Acknowledged kill quarantine requires provider dispatch capability.',
      missingCapabilities: [KILL_QUARANTINE_DISPATCH_CAPABILITY]
    });
  }
  if (operatorAck.present && operatorAck.issues.length > 0) {
    issues.push({
      code: 'operator_ack_not_actionable',
      field: 'killRequest.ack',
      severity: operatorAck.accepted ? 'warning' : 'error',
      message: 'Operator quarantine acknowledgment cannot be applied to the current hosted-kernel kill workflow.',
      ackIssues: operatorAck.issues
    });
  }
  if (quarantineClock.ackExpired) {
    issues.push({
      code: 'stale_quarantine_ack_timeout',
      field: 'persistence.killQuarantine.updatedAt',
      severity: 'error',
      message: 'Persisted kill quarantine exceeded the operator acknowledgment timeout and must be expired before kill dispatch.',
      ackDeadlineAt: quarantineClock.ackDeadlineAt,
      overdueMs: quarantineClock.overdueMs
    });
  }

  return {
    ok: !issues.some((issue) => issue.severity === 'error'),
    errorCount: issues.filter((issue) => issue.severity === 'error').length,
    warningCount: issues.filter((issue) => issue.severity === 'warning').length,
    issues
  };
}

function classifyTargetHealth(process, nowMs, heartbeatStaleMs) {
  const heartbeatMs = parseTimeMs(process.lastHeartbeatAt);
  const terminal = TERMINAL_STATUSES.has(process.status);
  const ageMs = heartbeatMs === null ? null : Math.max(0, nowMs - heartbeatMs);
  const heartbeatState = terminal
    ? 'terminal'
    : heartbeatMs === null
      ? 'missing'
      : ageMs > heartbeatStaleMs
        ? 'stale'
        : 'fresh';
  const degraded = heartbeatState === 'missing' || heartbeatState === 'stale';
  const action = terminal
    ? 'remove-terminal-target'
    : heartbeatState === 'missing'
      ? 'refresh-process-discovery-before-dispatch'
      : heartbeatState === 'stale'
        ? 'confirm-live-heartbeat-before-dispatch'
        : 'quarantine-target-ready';

  return {
    pid: process.pid,
    command: process.command,
    status: process.status,
    heartbeatState,
    lastHeartbeatAt: process.lastHeartbeatAt,
    heartbeatAgeMs: ageMs,
    heartbeatStaleMs,
    degraded,
    action
  };
}

function buildRetryAdvisory({ accepted, blockReason, attempt, controls, degradedReasons, providerHealth }) {
  if (blockReason === 'active_quarantine_cancelled_by_settings') {
    return {
      contract: 'hosted-kernel.kill-quarantine.retry-advisory.v1',
      retryable: false,
      retryAfterMs: null,
      nextAttempt: null,
      backoff: null,
      reason: blockReason,
      action: 'enable-kill-quarantine-before-new-request'
    };
  }

  const retryableBlock = !accepted && RETRYABLE_BLOCK_REASONS.has(blockReason);
  const retryableProviderFailure = !accepted && PROVIDER_RETRYABLE_FAILURE_CODES.has(blockReason);
  const degradedReview = accepted
    && controls.degradedMode === 'manual_review'
    && degradedReasons.length > 0;
  const blockedDispatch = accepted
    && controls.degradedMode === 'block_dispatch'
    && degradedReasons.length > 0;
  const retryable = Boolean(retryableBlock || retryableProviderFailure || degradedReview || blockedDispatch);
  const retryAfterMs = retryableBlock
    ? attempt.retryAfterMs
    : retryableProviderFailure
      ? Math.max(providerHealth.retryAfterMs ?? 0, attempt.retryAfterMs)
    : retryable
      ? Math.min(MAX_RETRY_DELAY_MS, Math.max(controls.heartbeatStaleMs, attempt.retryAfterMs))
      : null;

  return {
    contract: 'hosted-kernel.kill-quarantine.retry-advisory.v1',
    retryable,
    retryAfterMs,
    nextAttempt: retryable ? attempt.nextAttempt : null,
    backoff: retryable
      ? {
          attempt: attempt.attempt,
          nextAttempt: attempt.nextAttempt,
          baseDelayMs: attempt.baseDelayMs,
          cappedDelayMs: retryAfterMs
        }
      : null,
    reason: retryableBlock
      ? blockReason
      : retryableProviderFailure
        ? blockReason
      : blockedDispatch
        ? 'degraded_targets_block_dispatch'
        : degradedReview
          ? 'degraded_targets_manual_review'
          : null,
    action: retryableBlock
      ? 'retry-after-backoff'
      : retryableProviderFailure
        ? providerHealth.issues.find((issue) => issue.code === blockReason)?.action ?? 'refresh-provider-state-before-retry'
      : blockedDispatch
        ? 'refresh-heartbeats-before-kill-dispatch'
        : degradedReview
          ? 'review-degraded-targets-before-continuing'
          : null
  };
}

function buildOperationalHealth({ accepted, processes, intent, persisted, blockReason, attempt, controls, providerHealth, quarantineClock }) {
  const nowMs = parseTimeMs(quarantineClock.now) ?? Date.now();
  const targetSet = new Set(intent.targetPids);
  const targetProcesses = processes.filter((process) => targetSet.has(process.pid));
  const targetHealth = targetProcesses.map((process) => classifyTargetHealth(process, nowMs, controls.heartbeatStaleMs));
  const staleHeartbeatPids = targetProcesses
    .filter((process) => {
      const heartbeatMs = parseTimeMs(process.lastHeartbeatAt);
      return process.status === 'running' && (heartbeatMs === null || nowMs - heartbeatMs > controls.heartbeatStaleMs);
    })
    .map((process) => process.pid);
  const terminalRequestedPids = intent.skippedPids;
  const degradedReasons = normalizeStringList([
    staleHeartbeatPids.length > 0 ? 'target_heartbeat_stale_or_missing' : '',
    providerHealth.degraded ? 'provider_health_degraded' : '',
    !providerHealth.ok ? 'provider_health_failed' : '',
    providerHealth.dispatchFailure.present ? 'provider_dispatch_failure' : '',
    intent.missingPids.length > 0 ? 'requested_pids_missing' : '',
    intent.outOfScopePids.length > 0 ? 'requested_pids_out_of_scope' : '',
    persisted.active && !accepted ? 'active_quarantine_preserved' : ''
  ]);
  const degraded = Boolean(
    degradedReasons.length > 0
  );
  const retryAdvisory = buildRetryAdvisory({ accepted, blockReason, attempt, controls, degradedReasons, providerHealth });
  const dispatchBlockedByDegradedMode = accepted
    && controls.degradedMode === 'block_dispatch'
    && degraded;
  const status = accepted
    ? dispatchBlockedByDegradedMode
      ? 'degraded_dispatch_blocked'
      : degraded
      ? 'degraded'
      : 'healthy'
    : retryAdvisory.retryable
      ? 'retryable_failure'
      : 'failed';

  return {
    contract: 'hosted-kernel.kill-quarantine.operational-health.v1',
    status,
    degraded,
    degradedMode: {
      policy: controls.degradedMode,
      dispatchBlocked: dispatchBlockedByDegradedMode,
      manualReviewRequired: accepted && controls.degradedMode === 'manual_review' && degraded,
      reasons: degradedReasons
    },
    retryable: retryAdvisory.retryable,
    retryAfterMs: retryAdvisory.retryAfterMs,
    nextAttempt: retryAdvisory.nextAttempt,
    retryAdvisory,
    providerHealth,
    targetHealth,
    checks: {
      processTablePresent: processes.length > 0,
      targetCount: intent.targetPids.length,
      settingsEnabled: controls.enabled,
      scheduleDue: controls.scheduleDue,
      targetLimit: controls.maxTargets,
      heartbeatStaleMs: controls.heartbeatStaleMs,
      staleHeartbeatPids,
      terminalRequestedPids,
      providerOk: providerHealth.ok,
      providerHealthStatus: providerHealth.status,
      recoveredActiveQuarantine: Boolean(persisted.active),
      persistedState: persisted.present ? persisted.state : null
    }
  };
}

function actionForValidationIssue(issue) {
  if (issue.action) return issue.action;
  if (issue.code === 'operator_missing_kill_quarantine_grant') {
    return 'grant kernel.kill_quarantine or run as an authorized incident responder';
  }
  if (issue.code === 'kernel_scope_unbounded') return 'retry with tenantId or workspaceId';
  if (issue.code === 'scoped_operator_requires_tenant_or_workspace') return 'retry with a tenantId or workspaceId boundary';
  if (issue.code === 'operator_boundary_claim_mismatch') return 'switch to a boundary covered by the operator grants';
  if (issue.code === 'target_boundary_unproven') return 'refresh process discovery with tenantId and workspaceId claims';
  if (issue.code === 'target_boundary_mismatch') return 'remove process ids outside the requested boundary';
  if (issue.code === 'kill_quarantine_disabled') return 'enable kill quarantine in lifecycle settings before retrying';
  if (issue.code === 'target_limit_zero') return 'raise lifecycle maxTargets before retrying kill quarantine';
  if (issue.code === 'invalid_quarantine_schedule') return 'retry with a valid scheduleAt timestamp or remove scheduling';
  if (issue.code === 'target_limit_exceeded') return `reduce targets to ${issue.limit} or raise the lifecycle target limit`;
  if (issue.code === 'requested_pids_empty_after_normalization') return 'submit at least one non-empty process id or use scope=kernel intentionally';
  if (issue.code === 'requested_pids_invalid') return 'remove blank or non-pid entries from killRequest.pids';
  if (issue.code === 'requested_pids_deduplicated') return 'persist the normalized unique process id list before retrying';
  if (issue.code === 'requested_pids_out_of_scope') return 'remove out-of-scope process ids or switch to the owning boundary';
  if (issue.code === 'provider_capabilities_missing') {
    return `configure provider capabilities: ${issue.missingCapabilities.join(', ')}`;
  }
  if (issue.code === 'provider_dispatch_missing_after_ack') {
    return `configure provider capability: ${KILL_QUARANTINE_DISPATCH_CAPABILITY}`;
  }
  if (issue.code === 'provider_external_state_blocked') {
    return 'resolve the provider handoff state before replaying kill quarantine';
  }
  if (issue.code === 'provider_lease_expired') {
    return 'reacquire provider lease before dispatching kill';
  }
  if (issue.code === 'provider_sync_stale') {
    return 'refresh provider sync before continuing kill quarantine';
  }
  if (issue.code === 'provider_state_not_actionable') {
    return 'wait for provider acceptance or refresh provider state';
  }
  if (issue.code === 'provider_dispatch_failure') {
    return issue.action ?? 'repair provider dispatch failure before replaying kill quarantine';
  }
  if (issue.code === 'persisted_state_unrecognized') {
    return 'repair or clear the persisted kill-quarantine state before replaying the command';
  }
  if (issue.code === 'persisted_state_recovered') {
    return 'persist the recovered kill-quarantine state name before the next restart';
  }
  if (issue.code === 'persisted_state_shape_recovered') {
    return 'persist the canonical kill-quarantine state shape before the next restart';
  }
  if (issue.code === 'persisted_state_shape_invalid') {
    return 'repair invalid persisted kill-quarantine timestamps before replaying the command';
  }
  if (issue.code === 'persisted_state_untrusted_for_replay') {
    return issue.repairAction ?? 'repair persisted kill-quarantine state before replaying the command';
  }
  if (issue.code === 'stale_quarantine_ack_timeout') {
    return 'expire the stale quarantine and submit a fresh kill-quarantine request';
  }
  if (issue.code === 'operator_ack_not_actionable') {
    return `retry acknowledgment after resolving: ${issue.ackIssues.join(', ')}`;
  }
  return 'correct the request and retry';
}

function buildActionableErrors({ accepted, blockReason, validation, health, intent, authorization }) {
  if (accepted) return [];
  const errors = validation.issues
    .filter((issue) => issue.severity === 'error')
    .map((issue) => ({
      code: issue.code,
      field: issue.field,
      message: issue.message,
      action: actionForValidationIssue(issue),
      providerFailureCode: issue.providerFailureCode ?? null,
      failedPids: issue.failedPids ?? []
    }));

  if (blockReason === 'no_live_targets') {
    errors.push({
      code: 'no_live_targets',
      field: intent.scope === 'kernel' ? 'killRequest.scope' : 'killRequest.pids',
      message: 'No live hosted-kernel processes were eligible for quarantine.',
      action: intent.skippedPids.length > 0
        ? 'refresh the process table and omit terminal processes'
        : 'retry after process discovery reports live targets'
    });
  }

  return errors.map((error) => ({
    ...error,
    retryable: health.retryable,
    retryAfterMs: health.retryable ? health.retryAfterMs : null
  }));
}

function buildAuditProof({ now, kernelId, requestId, reason, operatorId, intent, authorization, boundaryAccess, quarantineClock }) {
  return {
    proofType: 'kernel.kill_quarantine.v1',
    surfaceId,
    issuedAt: now,
    kernelId,
    requestId,
    reason,
    operatorId,
    authorization,
    boundaryAccess,
    boundary: intent.boundary,
    scope: intent.scope,
    targetPids: intent.targetPids,
    missingPids: intent.missingPids,
    outOfScopePids: intent.outOfScopePids,
    skippedPids: intent.skippedPids,
    timers: quarantineClock,
    invariant: authorization.allowed && boundaryAccess.allowed && intent.targetPids.length > 0 ? 'quarantine_before_kill' : 'deny_before_quarantine'
  };
}

function buildProviderServiceContract({ now, accepted, kernelId, requestId, reason, intent, boundaryAccess, provider, providerHealth, controls, recoveryCommand, persistedKillQuarantine, operatorAck, quarantineClock }) {
  const dispatchDueAt = dispatchDueAtForCommand({ now, controls, recoveryCommand, quarantineClock });
  const targetFingerprint = intent.targetPids.join(',');
  const desiredRevision = [
    kernelId,
    requestId,
    persistedKillQuarantine.state,
    targetFingerprint || 'no-targets'
  ].join(':');
  const externalState = provider.externalState;
  const providerRevisionAcknowledged = Boolean(
    externalState.acknowledgedRevision
      && externalState.acknowledgedRevision === desiredRevision
  );
  const providerReceiptCurrent = Boolean(
    providerRevisionAcknowledged
      && externalState.receiptId
      && !externalState.blocking
  );
  const syncAction = !provider.ready
    ? 'negotiate-provider-capabilities'
    : externalState.blocking
      ? 'resolve-provider-block'
      : recoveryCommand.command === 'cancel-quarantine'
        ? 'publish-cancelled-state'
      : providerReceiptCurrent
        ? 'retain-provider-receipt'
        : accepted
          ? 'publish-desired-revision'
          : persistedKillQuarantine.state === 'blocked'
            ? 'publish-blocked-state'
            : 'hold-provider-sync';
  const handoffState = accepted
    ? providerReceiptCurrent && recoveryCommand.command === 'resume-quarantine'
      ? 'provider-receipt-current'
      : recoveryCommand.command === 'dispatch-kill'
      ? 'dispatching-kill'
      : recoveryCommand.command === 'acknowledge-quarantine'
        ? 'acknowledged-dispatch-pending'
        : recoveryCommand.command === 'observe-kill'
      ? 'observing-dispatched-kill'
      : controls.scheduled && !controls.scheduleDue
        ? 'scheduled'
        : controls.requireAck
          ? 'awaiting-provider-ack'
          : 'ready-for-provider-dispatch'
    : recoveryCommand.command === 'cancel-quarantine'
      ? 'cancelled'
      : 'blocked';

  return {
    contract: provider.contractVersion,
    provider: {
      id: provider.id,
      name: provider.name,
      mode: provider.mode,
      endpoint: provider.endpoint || null,
      explicit: provider.explicit
    },
    negotiation: {
      ready: provider.ready,
      requiredCapabilities: provider.requiredCapabilities,
      advertisedCapabilities: provider.capabilities,
      missingCapabilities: provider.missingCapabilities,
      health: providerHealth,
      externalState: {
        present: externalState.present,
        status: externalState.status,
        active: externalState.active,
        blocking: externalState.blocking,
        blockingReason: externalState.blockingReason,
        receiptId: externalState.receiptId || null,
        externalRequestId: externalState.externalRequestId || null,
        dispatchFailure: externalState.dispatchFailure
      }
    },
    sync: {
      resource: `kernel/${kernelId}/kill-quarantine/${requestId}`,
      desiredRevision,
      cursor: externalState.cursor || provider.syncCursor || desiredRevision,
      lastSyncedAt: provider.lastSyncedAt,
      pending: !providerReceiptCurrent && (accepted || persistedKillQuarantine.state === 'blocked'),
      action: syncAction,
      sourceUpdatedAt: persistedKillQuarantine.updatedAt ?? now,
      state: persistedKillQuarantine.state,
      targetFingerprint,
      timers: quarantineClock,
      providerAcknowledgedRevision: externalState.acknowledgedRevision || null,
      providerRevisionAcknowledged,
      providerReceiptCurrent,
      receiptId: externalState.receiptId || null,
      externalRequestId: externalState.externalRequestId || null,
      acceptedAt: externalState.acceptedAt,
      leaseExpiresAt: externalState.leaseExpiresAt,
      providerIssues: externalState.issues
        .concat(externalState.dispatchFailure.present ? [`dispatch_failure:${externalState.dispatchFailure.code}`] : []),
      dispatchFailure: externalState.dispatchFailure
    },
    health: providerHealth,
    handoff: {
      state: handoffState,
      channel: provider.endpoint ? 'provider-endpoint' : 'kernel-lifecycle-bus',
      topic: `kernel.lifecycle.kill-quarantine.${handoffState}`,
      syncAction,
      receiptCurrent: providerReceiptCurrent,
      requiresAck: accepted
        && controls.requireAck
        && !['observe-kill', 'acknowledge-quarantine', 'dispatch-kill'].includes(recoveryCommand.command),
      dispatchAfterMs: accepted && (operatorAck.accepted || !controls.requireAck) ? controls.dispatchDelayMs : null,
      dueAt: recoveryCommand.command === 'acknowledge-quarantine'
        ? dispatchDueAt
        : recoveryCommand.command === 'resume-quarantine'
          ? quarantineClock.pendingTimerAt
          : null,
      payload: {
        kernelId,
        requestId,
        reason,
        boundaryId: intent.boundary.boundaryId,
        boundaryAccess: {
          contract: boundaryAccess.contract,
          allowed: boundaryAccess.allowed,
          auditLabel: boundaryAccess.auditLabel,
          principalScope: boundaryAccess.principalScope,
          targetScope: boundaryAccess.targetScope
        },
        targetPids: intent.targetPids,
        idempotencyKey: recoveryCommand.idempotencyKey,
        restartSafeStatus: recoveryCommand.restartSafeStatus,
        timers: quarantineClock,
        operatorAck: operatorAck.present
          ? {
              accepted: operatorAck.accepted,
              requestId: operatorAck.requestId,
              confirmed: operatorAck.confirmed,
              note: operatorAck.operatorNote || null
            }
          : null,
        providerExpectation: {
          desiredRevision,
          currentReceiptId: externalState.receiptId || null,
          currentExternalRequestId: externalState.externalRequestId || null,
          requireRevisionAck: accepted,
          syncAction,
          healthStatus: providerHealth.status,
          retryableFailure: providerHealth.retryable,
          retryAfterMs: providerHealth.retryAfterMs,
          dispatchFailure: externalState.dispatchFailure.present
            ? {
                code: externalState.dispatchFailure.code,
                failedPids: externalState.dispatchFailure.failedPids,
                retryable: externalState.dispatchFailure.retryable,
                retryAfterMs: externalState.dispatchFailure.retryAfterMs
              }
            : null
        }
      }
    }
  };
}

function buildPersistenceRecoveryPlan({
  now,
  accepted,
  kernelId,
  requestId,
  persisted,
  persistedKillQuarantine,
  recoveryCommand,
  providerService,
  quarantineClock,
  validation
}) {
  const samePersistedRequest = persisted.present && persisted.requestId === persistedKillQuarantine.requestId;
  const samePersistedState = samePersistedRequest
    && persisted.state === persistedKillQuarantine.state
    && samePidSet(persisted.targetPids, persistedKillQuarantine.targetPids);
  const terminalWrite = FINAL_QUARANTINE_STATES.has(persistedKillQuarantine.state);
  const replayable = accepted
    || recoveryCommand.command === 'expire-quarantine'
    || recoveryCommand.command === 'cancel-quarantine'
    || (recoveryCommand.command === 'block' && persisted.active);
  const writeMode = !persisted.present
    ? 'create'
    : samePersistedState && recoveryCommand.command === 'resume-quarantine'
      ? 'touch'
      : samePersistedRequest
        ? 'update'
        : persisted.active
          ? 'supersede'
          : 'create-revision';
  const compareAndSwap = {
    expectedRequestId: persisted.present ? persisted.requestId || null : null,
    expectedState: persisted.present ? persisted.state || null : null,
    expectedRestartToken: persisted.restartToken || persisted.previousIdempotencyKey || null,
    expectedUpdatedAt: persisted.updatedAt || null,
    required: Boolean(persisted.present && persisted.kernelId === kernelId)
  };
  const stateShape = {
    contract: persistedKillQuarantine.contract ?? 'hosted-kernel.kill-quarantine.persisted-state.v1',
    schemaVersion: 1,
    kernelId,
    requestId: persistedKillQuarantine.requestId,
    state: persistedKillQuarantine.state,
    restartSafeStatus: persistedKillQuarantine.restartSafeStatus,
    targetPids: persistedKillQuarantine.targetPids,
    reason: persistedKillQuarantine.reason,
    operatorId: persistedKillQuarantine.operatorId,
    updatedAt: persistedKillQuarantine.updatedAt,
    completedAt: persistedKillQuarantine.completedAt ?? null,
    acknowledgedAt: persistedKillQuarantine.acknowledgedAt ?? null,
    dispatchedAt: persistedKillQuarantine.dispatchedAt ?? null,
    restartToken: persistedKillQuarantine.restartToken,
    providerDesiredRevision: providerService.sync.desiredRevision,
    providerCursor: providerService.sync.cursor,
    pendingTimerAt: quarantineClock.pendingTimerAt,
    recoveredFields: persistedKillQuarantine.recoveredFields ?? [],
    targetSource: persistedKillQuarantine.targetSource ?? null,
    timestampSources: persistedKillQuarantine.timestampSources ?? {}
  };
  const replayPolicy = {
    command: recoveryCommand.command,
    idempotencyKey: recoveryCommand.idempotencyKey,
    replayable,
    duplicateSafe: Boolean(recoveryCommand.idempotencyKey && recoveryCommand.idempotencyKey === persisted.restartToken),
    dropIfFinal: terminalWrite && recoveryCommand.command !== 'expire-quarantine',
    retryAfterMs: accepted ? quarantineClock.pendingTimerMs : null,
    blockedByValidation: validation.errorCount > 0 ? validation.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.code) : []
  };

  return {
    contract: 'hosted-kernel.kill-quarantine.recovery-plan.v1',
    generatedAt: now,
    kernelId,
    requestId,
    writeMode,
    safeToPersist: replayable && validation.errorCount === 0
      || recoveryCommand.command === 'expire-quarantine'
      || recoveryCommand.command === 'cancel-quarantine',
    recoveryPath: recoveryCommand.recovery,
    restartSafeStatus: recoveryCommand.restartSafeStatus,
    previous: persisted.present
      ? {
          requestId: persisted.requestId,
          kernelId: persisted.kernelId,
          state: persisted.state || null,
          rawState: persisted.rawState,
          stateValid: persisted.stateValid,
          stateMigrated: persisted.stateMigrated,
          shapeRecovered: persisted.shapeRecovered,
          shapeIssues: persisted.shapeIssues,
          recoveredFields: persisted.recoveredFields,
          targetSource: persisted.targetSource,
          timestampSources: persisted.timestampSources,
          invalidTimestampFields: persisted.invalidTimestampFields,
          targetPids: persisted.targetPids,
          restartToken: persisted.restartToken || null,
          updatedAt: persisted.updatedAt
        }
      : null,
    compareAndSwap,
    replayPolicy,
    dedupe: {
      primaryKey: recoveryCommand.idempotencyKey,
      requestKey: `kill-quarantine:request:${kernelId}:${persistedKillQuarantine.requestId}`,
      targetKey: `kill-quarantine:targets:${kernelId}:${persistedKillQuarantine.targetPids.join(',') || 'none'}`,
      providerRevision: providerService.sync.desiredRevision
    },
    stateShape,
    journalEntry: {
      at: now,
      command: recoveryCommand.command,
      recovery: recoveryCommand.recovery,
      fromState: persisted.present ? persisted.state || persisted.rawState : null,
      toState: persistedKillQuarantine.state,
      providerState: providerService.handoff.state,
      validationOk: validation.ok,
      timer: quarantineClock.pendingTimerAt,
      recoveredFields: persisted.recoveredFields,
      shapeIssues: persisted.shapeIssues
    }
  };
}

function buildNextLifecycleAction({ accepted, recoveryCommand, controls, persistedKillQuarantine, health, actionableErrors, operatorAck, quarantineClock }) {
  const dispatchDueAt = dispatchDueAtForCommand({
    now: quarantineClock.now,
    controls,
    recoveryCommand,
    quarantineClock
  });

  if (!accepted) {
    if (recoveryCommand.command === 'cancel-quarantine') {
      return {
        action: 'quarantine-cancelled-by-settings',
        state: persistedKillQuarantine.state,
        label: controls.cancelActiveWhenDisabled ? 'active-quarantine-cancelled' : 'active-quarantine-held',
        dueAt: null,
        retryAfterMs: null,
        requiresOperatorAck: false,
        disabledReason: controls.disabledReason,
        timers: quarantineClock
      };
    }
    return {
      action: 'blocked',
      state: persistedKillQuarantine.state,
      label: actionableErrors[0]?.action ?? 'correct-request-and-retry',
      dueAt: null,
      retryAfterMs: health.retryAfterMs,
      requiresOperatorAck: false,
      timers: quarantineClock
    };
  }

  if (recoveryCommand.command === 'schedule-quarantine' || recoveryCommand.command === 'supersede-and-schedule-quarantine') {
    return {
      action: 'await-scheduled-quarantine-window',
      state: 'scheduled-quarantine',
      label: 'wait-until-scheduled-window',
      dueAt: controls.scheduleAt,
      retryAfterMs: controls.scheduleDelayMs,
      requiresOperatorAck: false,
      timers: quarantineClock
    };
  }

  if (recoveryCommand.command === 'observe-kill') {
    return {
      action: 'observe-kill-completion',
      state: persistedKillQuarantine.state,
      label: 'observe-dispatched-kill',
      dueAt: null,
      retryAfterMs: null,
      requiresOperatorAck: false,
      timers: quarantineClock
    };
  }

  if (health.degradedMode.dispatchBlocked) {
    return {
      action: 'refresh-target-health-before-dispatch',
      state: persistedKillQuarantine.state,
      label: 'refresh-heartbeats-before-kill-dispatch',
      dueAt: null,
      retryAfterMs: health.retryAfterMs,
      requiresOperatorAck: false,
      timers: quarantineClock,
      degradedReasons: health.degradedMode.reasons
    };
  }

  if (health.degradedMode.manualReviewRequired) {
    return {
      action: 'review-degraded-targets-before-dispatch',
      state: persistedKillQuarantine.state,
      label: 'review-degraded-targets-before-continuing',
      dueAt: null,
      retryAfterMs: health.retryAfterMs,
      requiresOperatorAck: controls.requireAck && !operatorAck.accepted,
      ackTimeoutMs: controls.requireAck ? controls.ackTimeoutMs : null,
      timers: quarantineClock,
      degradedReasons: health.degradedMode.reasons
    };
  }

  if (recoveryCommand.command === 'dispatch-kill' || recoveryCommand.command === 'acknowledge-quarantine') {
    return {
      action: recoveryCommand.command === 'dispatch-kill' ? 'dispatch-kill-now' : 'dispatch-kill-after-delay',
      state: persistedKillQuarantine.state,
      label: recoveryCommand.command === 'dispatch-kill' ? 'dispatch-kill-now' : 'dispatch-after-ack-delay',
      dueAt: recoveryCommand.command === 'acknowledge-quarantine' ? dispatchDueAt : null,
      retryAfterMs: recoveryCommand.command === 'acknowledge-quarantine' ? operatorAck.dispatchAfterMs : null,
      requiresOperatorAck: false,
      ackRequestId: operatorAck.requestId,
      timers: quarantineClock
    };
  }

  return {
    action: controls.requireAck ? 'confirm-quarantine-then-kill' : 'dispatch-after-quarantine-delay',
    state: persistedKillQuarantine.state,
    label: controls.requireAck ? 'confirm-quarantine-then-kill' : 'auto-dispatch-after-quarantine',
    dueAt: controls.requireAck ? quarantineClock.ackDeadlineAt : controls.scheduleAt,
    retryAfterMs: controls.requireAck ? null : controls.dispatchDelayMs,
    requiresOperatorAck: controls.requireAck,
    ackTimeoutMs: controls.requireAck ? controls.ackTimeoutMs : null,
    timers: quarantineClock
  };
}

function summarizeValidationForPreview(validation) {
  const errorCodes = [];
  const warningCodes = [];
  const fields = [];

  for (const issue of validation.issues) {
    if (issue.severity === 'error') errorCodes.push(issue.code);
    if (issue.severity === 'warning') warningCodes.push(issue.code);
    if (issue.field && !fields.includes(issue.field)) fields.push(issue.field);
  }

  return {
    contract: 'hosted-kernel.kill-quarantine.validation-summary.v1',
    ok: validation.ok,
    errorCount: validation.errorCount,
    warningCount: validation.warningCount,
    errorCodes,
    warningCodes,
    affectedFields: fields,
    headline: validation.ok
      ? warningCodes.length > 0
        ? 'Kill quarantine is accepted with warnings.'
        : 'Kill quarantine is accepted.'
      : 'Kill quarantine is blocked until validation errors are corrected.'
  };
}

function buildPreviewTargetRows({ processes, intent }) {
  const processByPid = new Map(processes.map((process) => [process.pid, process]));
  return intent.targetPids.map((pid) => {
    const process = processByPid.get(pid);
    return {
      pid,
      command: process?.command ?? 'unknown',
      status: process?.status ?? 'unknown',
      tenantId: process?.tenantId || null,
      workspaceId: process?.workspaceId || null,
      quarantineAction: 'stage-before-kill'
    };
  });
}

function buildReadinessGates({ accepted, authorization, boundaryAccess, controls, provider, providerHealth, intent, validation, health }) {
  const gates = [
    {
      key: 'authorization',
      label: 'Operator authorization',
      status: authorization.allowed ? 'ready' : 'blocked',
      detail: authorization.allowed ? authorization.mode : authorization.reason
    },
    {
      key: 'boundary',
      label: 'Tenant/workspace boundary',
      status: boundaryAccess.allowed ? 'ready' : 'blocked',
      detail: boundaryAccess.allowed ? boundaryAccess.auditLabel : boundaryAccess.errors.join(', ')
    },
    {
      key: 'settings',
      label: 'Lifecycle settings',
      status: controls.enabled && controls.scheduleValid ? 'ready' : 'blocked',
      detail: controls.enabled ? controls.source : controls.disabledReason
    },
    {
      key: 'provider',
      label: 'Provider capability contract',
      status: provider.ready && providerHealth.ok ? 'ready' : 'blocked',
      detail: provider.ready
        ? providerHealth.ok
          ? provider.contractVersion
          : providerHealth.issues.find((issue) => issue.severity === 'error')?.code ?? providerHealth.status
        : provider.missingCapabilities.join(', ')
    },
    {
      key: 'targets',
      label: 'Eligible hosted-kernel targets',
      status: intent.targetPids.length > 0 && intent.outOfScopePids.length === 0 ? 'ready' : 'blocked',
      detail: `${intent.targetPids.length} eligible target${intent.targetPids.length === 1 ? '' : 's'}`
    },
    {
      key: 'validation',
      label: 'Request validation',
      status: validation.ok ? 'ready' : 'blocked',
      detail: `${validation.errorCount} errors, ${validation.warningCount} warnings`
    }
  ];

  return {
    contract: 'hosted-kernel.kill-quarantine.readiness.v1',
    status: accepted
      ? health.degraded
        ? 'ready_with_warnings'
        : 'ready'
      : health.retryable
        ? 'retryable_blocked'
        : 'blocked',
    ready: accepted,
    degraded: health.degraded,
    gates,
    blockedGates: gates.filter((gate) => gate.status === 'blocked').map((gate) => gate.key)
  };
}

function buildExplainableNextSteps({ accepted, recoveryCommand, controls, nextLifecycleAction, actionableErrors, providerService, health }) {
  if (!accepted) {
    return actionableErrors.length > 0
      ? actionableErrors.map((error, index) => ({
          order: index + 1,
          action: error.action,
          reason: error.message,
          code: error.code,
          field: error.field,
          retryable: error.retryable,
          retryAfterMs: error.retryAfterMs
        }))
      : [{
          order: 1,
          action: 'review-target-processes',
          reason: 'No accepted kill-quarantine action was produced.',
          code: 'kill_quarantine_not_accepted',
          field: 'killRequest',
          retryable: false,
          retryAfterMs: null
        }];
  }

  if (recoveryCommand.command === 'observe-kill') {
    return [{
      order: 1,
      action: 'observe-kill-completion',
      reason: 'The persisted quarantine already dispatched kill and only needs completion observation.',
      code: 'observe_dispatched_kill',
      field: 'persistence.state',
      retryable: false,
      retryAfterMs: null
    }];
  }

  if (nextLifecycleAction.action === 'refresh-target-health-before-dispatch') {
    return [{
      order: 1,
      action: 'refresh-heartbeats-before-kill-dispatch',
      reason: 'One or more target processes have stale or missing heartbeats and degraded mode blocks kill dispatch.',
      code: 'degraded_targets_block_dispatch',
      field: 'processes.lastHeartbeatAt',
      retryable: true,
      retryAfterMs: health.retryAfterMs,
      degradedReasons: health.degradedMode.reasons
    }];
  }

  if (nextLifecycleAction.action === 'review-degraded-targets-before-dispatch') {
    return [{
      order: 1,
      action: 'review-degraded-targets-before-continuing',
      reason: 'One or more target processes are degraded and lifecycle policy requires manual review before continuing.',
      code: 'degraded_targets_manual_review',
      field: 'killQuarantineSettings.degradedMode',
      retryable: true,
      retryAfterMs: health.retryAfterMs,
      degradedReasons: health.degradedMode.reasons
    }];
  }

  if (recoveryCommand.command === 'dispatch-kill' || recoveryCommand.command === 'acknowledge-quarantine') {
    return [{
      order: 1,
      action: nextLifecycleAction.action,
      reason: recoveryCommand.command === 'dispatch-kill'
        ? 'Operator acknowledgment matched the staged quarantine and kill dispatch can proceed immediately.'
        : 'Operator acknowledgment matched the staged quarantine and dispatch is waiting for the configured delay.',
      code: recoveryCommand.command === 'dispatch-kill' ? 'operator_ack_dispatch_ready' : 'operator_ack_dispatch_delayed',
      field: 'killRequest.ack',
      retryable: recoveryCommand.command === 'acknowledge-quarantine',
      retryAfterMs: nextLifecycleAction.retryAfterMs,
      handoffTopic: providerService.handoff.topic
    }];
  }


  if (nextLifecycleAction.action === 'await-scheduled-quarantine-window') {
    return [{
      order: 1,
      action: 'wait-until-scheduled-window',
      reason: `Quarantine is scheduled for ${controls.scheduleAt}.`,
      code: 'scheduled_quarantine_window',
      field: 'killRequest.scheduleAt',
      retryable: true,
      retryAfterMs: controls.scheduleDelayMs
    }];
  }

  return [{
    order: 1,
    action: controls.requireAck ? 'confirm-quarantine-then-kill' : 'dispatch-after-quarantine-delay',
    reason: controls.requireAck
      ? 'Provider must acknowledge quarantine before kill dispatch is allowed.'
      : 'Provider can dispatch kill after staging quarantine and delay controls are satisfied.',
    code: controls.requireAck ? 'operator_ack_required' : 'auto_dispatch_ready',
    field: 'killQuarantineSettings.requireAck',
    retryable: false,
    retryAfterMs: controls.requireAck ? null : controls.dispatchDelayMs,
    handoffTopic: providerService.handoff.topic
  }];
}

function buildPreviewAcceptanceContract({
  accepted,
  kernelId,
  requestId,
  operatorId,
  intent,
  controls,
  validation,
  readiness,
  health,
  recoveryCommand,
  persistedKillQuarantine,
  nextLifecycleAction,
  operatorAck,
  providerService
}) {
  const blockingIssues = validation.issues
    .filter((issue) => issue.severity === 'error')
    .map((issue) => ({
      code: issue.code,
      field: issue.field,
      message: issue.message
    }));
  const missingAcknowledgment = Boolean(
    accepted
      && controls.requireAck
      && nextLifecycleAction.requiresOperatorAck
      && !operatorAck.accepted
  );
  const disabledReason = !accepted
    ? recoveryCommand.command === 'cancel-quarantine'
      ? 'active_quarantine_cancelled_by_settings'
      : blockingIssues[0]?.code ?? 'kill_quarantine_blocked'
    : missingAcknowledgment
      ? null
      : nextLifecycleAction.action === 'await-scheduled-quarantine-window'
        ? 'scheduled_window_not_due'
        : health.degradedMode.dispatchBlocked
          ? 'degraded_targets_block_dispatch'
          : health.degradedMode.manualReviewRequired
            ? 'degraded_targets_manual_review'
        : null;
  const acceptEnabled = Boolean(
    accepted
      && readiness.ready
      && !health.degradedMode.dispatchBlocked
      && !health.degradedMode.manualReviewRequired
      && (!controls.scheduled || controls.scheduleDue)
      && nextLifecycleAction.action !== 'await-scheduled-quarantine-window'
  );
  const ackSubmitPayload = missingAcknowledgment
    ? {
        contract: 'hosted-kernel.kill-quarantine.acceptance-submit.v1',
        kernelId,
        requestId,
        operatorId,
        ack: {
          confirmed: true,
          requestId,
          targetPids: intent.targetPids
        }
      }
    : null;
  const routePayload = {
    contract: 'hosted-kernel.kill-quarantine.route-payload.v1',
    route: nextLifecycleAction.action === 'dispatch-kill-now'
      ? 'kernel.lifecycle.kill-dispatch'
      : 'kernel.lifecycle.kill-quarantine',
    params: {
      kernelId,
      requestId,
      boundaryId: intent.boundary.boundaryId,
      targetPids: intent.targetPids
    },
    providerTopic: providerService.handoff.topic,
    providerState: providerService.handoff.state,
    idempotencyKey: recoveryCommand.idempotencyKey
  };

  return {
    contract: 'hosted-kernel.kill-quarantine.preview-acceptance.v1',
    enabled: acceptEnabled,
    accepted,
    state: nextLifecycleAction.state,
    action: nextLifecycleAction.action,
    command: recoveryCommand.command,
    disabledReason,
    requiresOperatorAck: missingAcknowledgment,
    requiresHealthRefresh: Boolean(accepted && health.degradedMode.dispatchBlocked),
    requiresManualReview: Boolean(accepted && health.degradedMode.manualReviewRequired),
    requiresScheduleWait: Boolean(accepted && controls.scheduled && !controls.scheduleDue),
    cancellation: recoveryCommand.command === 'cancel-quarantine'
      ? {
          contract: 'hosted-kernel.kill-quarantine.cancellation-preview.v1',
          enabled: true,
          reason: controls.disabledReason,
          previousRequestId: persistedKillQuarantine.requestId,
          targetPids: persistedKillQuarantine.targetPids,
          action: 'publish-cancelled-state'
        }
      : null,
    dueAt: nextLifecycleAction.dueAt,
    retryAfterMs: nextLifecycleAction.retryAfterMs,
    blockingIssues,
    blockedGateKeys: readiness.blockedGates,
    ackSubmitPayload,
    routePayload
  };
}

function buildRoutePreviewModel({
  accepted,
  validationSummary,
  readiness,
  previewAcceptance,
  nextSteps,
  nextLifecycleAction,
  health,
  intent,
  providerService
}) {
  const blocked = !accepted;
  const primaryStep = nextSteps[0] ?? null;
  const ctaKind = blocked
    ? health.retryable ? 'retry' : 'repair'
    : previewAcceptance.requiresOperatorAck
      ? 'operator-ack'
      : previewAcceptance.requiresScheduleWait
        ? 'wait'
        : previewAcceptance.requiresHealthRefresh
          ? 'refresh-health'
          : previewAcceptance.requiresManualReview
            ? 'manual-review'
            : nextLifecycleAction.action === 'dispatch-kill-now'
              ? 'dispatch'
              : 'continue';
  const blockingCode = previewAcceptance.blockingIssues[0]?.code
    ?? previewAcceptance.disabledReason
    ?? null;
  const bannerTone = blocked
    ? 'critical'
    : validationSummary.warningCount > 0 || health.degraded
      ? 'warning'
      : 'success';
  const validationChips = [
    ...validationSummary.errorCodes.map((code) => ({ code, tone: 'critical', kind: 'error' })),
    ...validationSummary.warningCodes.map((code) => ({ code, tone: 'warning', kind: 'warning' }))
  ];

  return {
    contract: 'hosted-kernel.kill-quarantine.route-preview-model.v1',
    status: blocked
      ? health.retryable ? 'retryable-blocked' : 'blocked'
      : previewAcceptance.requiresScheduleWait
        ? 'scheduled'
        : previewAcceptance.requiresOperatorAck
          ? 'awaiting-operator-ack'
          : previewAcceptance.enabled
            ? 'actionable'
            : 'pending',
    banner: {
      tone: bannerTone,
      title: blocked ? 'Kill quarantine blocked' : 'Kill quarantine preview ready',
      message: primaryStep?.reason ?? validationSummary.headline,
      code: primaryStep?.code ?? blockingCode
    },
    cta: {
      kind: ctaKind,
      action: primaryStep?.action ?? previewAcceptance.action,
      enabled: previewAcceptance.enabled || previewAcceptance.requiresOperatorAck || previewAcceptance.requiresHealthRefresh || previewAcceptance.requiresManualReview,
      disabledReason: previewAcceptance.enabled ? null : blockingCode,
      dueAt: previewAcceptance.dueAt,
      retryAfterMs: previewAcceptance.retryAfterMs ?? health.retryAfterMs
    },
    validation: {
      ...validationSummary,
      chips: validationChips,
      firstBlockingIssue: previewAcceptance.blockingIssues[0] ?? null
    },
    readiness: {
      status: readiness.status,
      ready: readiness.ready,
      blockedGateKeys: readiness.blockedGates,
      gates: readiness.gates.map((gate) => ({
        key: gate.key,
        label: gate.label,
        status: gate.status,
        detail: gate.detail,
        actionable: gate.status === 'blocked'
      }))
    },
    navigation: {
      route: previewAcceptance.routePayload.route,
      providerTopic: previewAcceptance.routePayload.providerTopic,
      providerState: previewAcceptance.routePayload.providerState,
      params: previewAcceptance.routePayload.params
    },
    targetSummary: {
      boundaryId: intent.boundary.boundaryId,
      scope: intent.scope,
      requestedCount: intent.requestedPids.length,
      requestedRawCount: intent.requestedRawCount,
      acceptedCount: intent.targetPids.length,
      skippedCount: intent.skippedPids.length,
      missingCount: intent.missingPids.length,
      outOfScopeCount: intent.outOfScopePids.length,
      duplicateRequestedCount: intent.duplicateRequestedPids.length,
      invalidRequestedCount: intent.invalidPidClaims.length
    },
    provider: {
      handoffState: providerService.handoff.state,
      handoffTopic: providerService.handoff.topic,
      receiptCurrent: providerService.handoff.receiptCurrent,
      desiredRevision: providerService.sync.desiredRevision
    }
  };
}

function buildKillQuarantinePreviewContract({
  accepted,
  kernelId,
  requestId,
  reason,
  operatorId,
  processes,
  intent,
  authorization,
  boundaryAccess,
  controls,
  provider,
  providerHealth,
  providerService,
  validation,
  health,
  recoveryCommand,
  persistedKillQuarantine,
  nextLifecycleAction,
  actionableErrors,
  operatorAck
}) {
  const validationSummary = summarizeValidationForPreview(validation);
  const readiness = buildReadinessGates({ accepted, authorization, boundaryAccess, controls, provider, providerHealth, intent, validation, health });
  const nextSteps = buildExplainableNextSteps({
    accepted,
    recoveryCommand,
    controls,
    nextLifecycleAction,
    actionableErrors,
    providerService,
    health
  });
  const previewAcceptance = buildPreviewAcceptanceContract({
    accepted,
    kernelId,
    requestId,
    operatorId,
    intent,
    controls,
    validation,
    readiness,
    health,
    recoveryCommand,
    persistedKillQuarantine,
    nextLifecycleAction,
    operatorAck,
    providerService
  });
  const routePreview = buildRoutePreviewModel({
    accepted,
    validationSummary,
    readiness,
    previewAcceptance,
    nextSteps,
    nextLifecycleAction,
    health,
    intent,
    providerService
  });

  return {
    contract: 'hosted-kernel.kill-quarantine.preview.v1',
    kernelId,
    requestId,
    operatorId,
    accepted,
    verdict: accepted ? 'accepted_for_quarantine' : 'blocked_before_quarantine',
    reason,
    title: accepted ? 'Preview quarantine before kill' : 'Preview blocked kill quarantine',
    validationSummary,
    readiness,
    targets: {
      scope: intent.scope,
      boundary: intent.boundary,
      boundaryAccess,
      requestedCount: intent.requestedPids.length,
      requestedRawCount: intent.requestedRawCount,
      acceptedCount: intent.targetPids.length,
      duplicateRequestedPids: intent.duplicateRequestedPids,
      invalidPidClaims: intent.invalidPidClaims,
      missingPids: intent.missingPids,
      outOfScopePids: intent.outOfScopePids,
      skippedPids: intent.skippedPids,
      rows: buildPreviewTargetRows({ processes, intent })
    },
    acceptance: {
      command: recoveryCommand.command,
      state: persistedKillQuarantine.state,
      idempotencyKey: recoveryCommand.idempotencyKey,
      restartSafeStatus: recoveryCommand.restartSafeStatus,
      contract: previewAcceptance.contract,
      enabled: previewAcceptance.enabled,
      disabledReason: previewAcceptance.disabledReason,
      requiresOperatorAck: nextLifecycleAction.requiresOperatorAck,
      requiresHealthRefresh: previewAcceptance.requiresHealthRefresh,
      requiresManualReview: previewAcceptance.requiresManualReview,
      requiresScheduleWait: previewAcceptance.requiresScheduleWait,
      cancellation: previewAcceptance.cancellation,
      ackTimeoutMs: nextLifecycleAction.ackTimeoutMs ?? null,
      dueAt: nextLifecycleAction.dueAt,
      retryAfterMs: nextLifecycleAction.retryAfterMs,
      blockedGateKeys: previewAcceptance.blockedGateKeys,
      blockingIssues: previewAcceptance.blockingIssues,
      ackSubmitPayload: previewAcceptance.ackSubmitPayload,
      routePayload: previewAcceptance.routePayload
    },
    operatorAck: {
      contract: operatorAck.contract,
      present: operatorAck.present,
      accepted: operatorAck.accepted,
      requestId: operatorAck.requestId,
      issues: operatorAck.issues
    },
    provider: {
      ready: provider.ready,
      healthStatus: providerHealth.status,
      retryable: providerHealth.retryable,
      retryAfterMs: providerHealth.retryAfterMs,
      issues: providerHealth.issues,
      dispatchFailure: providerHealth.dispatchFailure.present ? providerHealth.dispatchFailure : null,
      id: provider.id,
      mode: provider.mode,
      handoffState: providerService.handoff.state,
      handoffTopic: providerService.handoff.topic,
      desiredRevision: providerService.sync.desiredRevision
    },
    routePreview,
    nextSteps,
    primaryAction: nextSteps[0]?.action ?? 'review-kill-quarantine-request'
  };
}

function normalizeKillQuarantineWorkflowRequest(input) {
  const killRequest = asRecord(input.killRequest);
  const clientState = asRecord(input.clientState);
  const lifecycleState = asRecord(clientState.kernelLifecycle);
  const previousWorkflow = asRecord(lifecycleState.killQuarantineWorkflow);
  const workflow = asRecord(
    killRequest.workflow
      ?? input.workflow
      ?? input.clientWorkflow
      ?? previousWorkflow
  );

  return {
    contract: 'hosted-kernel.kill-quarantine.workflow-request.v1',
    correlationId: asString(
      workflow.correlationId
        ?? killRequest.correlationId
        ?? input.correlationId
        ?? previousWorkflow.correlationId,
      ''
    ),
    sourceRoute: asString(workflow.sourceRoute ?? workflow.from ?? previousWorkflow.sourceRoute, 'kernel.process-table'),
    returnRoute: asString(workflow.returnRoute ?? workflow.to ?? previousWorkflow.returnRoute, 'kernel.lifecycle.kill-quarantine'),
    panel: asString(workflow.panel ?? previousWorkflow.panel, 'kill-quarantine'),
    focusPid: normalizePid(workflow.focusPid ?? killRequest.focusPid ?? previousWorkflow.focusPid),
    intent: asString(workflow.intent ?? killRequest.intent, 'kill-quarantine')
  };
}

function buildWorkflowHandoffContract({
  now,
  accepted,
  kernelId,
  requestId,
  operatorId,
  workflowRequest,
  intent,
  controls,
  validation,
  health,
  recoveryCommand,
  persistedKillQuarantine,
  providerService,
  preview,
  nextLifecycleAction,
  actionableErrors,
  operatorAck
}) {
  const blocked = !accepted;
  const requiresAck = Boolean(accepted && nextLifecycleAction.requiresOperatorAck);
  const dispatchReady = accepted && nextLifecycleAction.action === 'dispatch-kill-now';
  const scheduled = accepted && nextLifecycleAction.action === 'await-scheduled-quarantine-window';
  const correlationId = workflowRequest.correlationId || `${kernelId}:${requestId}`;
  const routeName = blocked
    ? workflowRequest.sourceRoute
    : dispatchReady
      ? 'kernel.lifecycle.kill-dispatch'
      : workflowRequest.returnRoute;
  const routeState = blocked
    ? 'blocked'
    : scheduled
      ? 'scheduled'
      : requiresAck
        ? 'awaiting-operator-ack'
        : dispatchReady
          ? 'dispatch-ready'
          : persistedKillQuarantine.state;
  const primaryCta = blocked
    ? {
        kind: health.retryable ? 'retry' : 'repair',
        label: actionableErrors[0]?.action ?? 'review-kill-quarantine-request',
        enabled: health.retryable,
        disabledReason: health.retryable ? null : actionableErrors[0]?.code ?? 'kill_quarantine_blocked'
      }
    : nextLifecycleAction.action === 'refresh-target-health-before-dispatch'
      ? {
          kind: 'health-refresh',
          label: nextLifecycleAction.label,
          enabled: true,
          disabledReason: null,
          retryAfterMs: nextLifecycleAction.retryAfterMs
        }
      : nextLifecycleAction.action === 'review-degraded-targets-before-dispatch'
        ? {
            kind: 'manual-review',
            label: nextLifecycleAction.label,
            enabled: true,
            disabledReason: null,
            retryAfterMs: nextLifecycleAction.retryAfterMs
          }
    : requiresAck
      ? {
          kind: 'operator-ack',
          label: 'confirm-quarantine-then-kill',
          enabled: true,
          disabledReason: null
        }
      : dispatchReady
        ? {
            kind: 'dispatch',
            label: 'dispatch-kill-now',
            enabled: true,
            disabledReason: null
          }
        : {
            kind: scheduled ? 'wait' : 'continue',
            label: nextLifecycleAction.label,
            enabled: !scheduled,
            disabledReason: scheduled ? 'scheduled_window_not_due' : null
          };

  return {
    contract: 'hosted-kernel.kill-quarantine.workflow-handoff.v1',
    generatedAt: now,
    correlationId,
    requestId,
    kernelId,
    operatorId,
    status: blocked
      ? health.retryable
        ? 'retryable_blocked'
        : 'blocked'
      : dispatchReady
        ? 'dispatch_ready'
        : requiresAck
          ? 'awaiting_operator_ack'
          : scheduled
            ? 'scheduled'
            : 'quarantine_staged',
    sourceRoute: workflowRequest.sourceRoute,
    route: {
      name: routeName,
      panel: workflowRequest.panel,
      state: routeState,
      params: {
        kernelId,
        requestId,
        boundaryId: intent.boundary.boundaryId,
        targetPids: intent.targetPids,
        focusPid: workflowRequest.focusPid || intent.targetPids[0] || null
      }
    },
    primaryCta,
    banner: {
      tone: blocked ? 'critical' : validation.warningCount > 0 || health.degraded ? 'warning' : 'success',
      title: blocked ? 'Kernel kill blocked' : preview.title,
      message: blocked
        ? actionableErrors[0]?.message ?? 'Kill quarantine is blocked before provider handoff.'
        : preview.nextSteps[0]?.reason ?? 'Kill quarantine is ready for the next lifecycle step.'
    },
    clientStatePatch: {
      activeKernelId: kernelId,
      activeKillQuarantineRequestId: requestId,
      killQuarantinePanel: workflowRequest.panel,
      killQuarantineRoute: routeName,
      killQuarantineWorkflowStatus: routeState,
      killQuarantineCorrelationId: correlationId,
      killQuarantinePrimaryAction: nextLifecycleAction.action
    },
    providerHandoff: {
      topic: providerService.handoff.topic,
      state: providerService.handoff.state,
      dueAt: providerService.handoff.dueAt,
      desiredRevision: providerService.sync.desiredRevision,
      idempotencyKey: recoveryCommand.idempotencyKey
    },
    proofRefs: {
      auditProofType: 'kernel.kill_quarantine.v1',
      previewContract: preview.contract,
      validationContract: preview.validationSummary.contract,
      providerContract: providerService.contract,
      persistedState: persistedKillQuarantine.state,
      operatorAckContract: operatorAck.contract
    }
  };
}

function buildClientRuntimeHandoffEnvelope({
  now,
  accepted,
  kernelId,
  requestId,
  operatorId,
  workflowRequest,
  intent,
  validation,
  health,
  recoveryCommand,
  persistedKillQuarantine,
  providerService,
  preview,
  nextLifecycleAction,
  workflowHandoff,
  operatorAck
}) {
  const blocked = !accepted;
  const handoffId = `${workflowHandoff.correlationId}:${recoveryCommand.idempotencyKey}`;
  const queueStatus = blocked
    ? health.retryable ? 'retryable-blocked' : 'blocked'
    : nextLifecycleAction.requiresOperatorAck
      ? 'waiting-for-operator-ack'
      : nextLifecycleAction.action === 'dispatch-kill-now'
        ? 'ready-to-dispatch'
        : nextLifecycleAction.action === 'await-scheduled-quarantine-window'
          ? 'scheduled'
          : 'active';
  const requestMutation = blocked
    ? null
    : nextLifecycleAction.requiresOperatorAck
      ? {
          contract: 'hosted-kernel.kill-quarantine.client-mutation.v1',
          method: 'POST',
          route: 'kernel.lifecycle.kill-quarantine.ack',
          idempotencyKey: `${recoveryCommand.idempotencyKey}:ack-submit`,
          body: preview.acceptance.ackSubmitPayload
        }
      : nextLifecycleAction.action === 'dispatch-kill-now'
        ? {
            contract: 'hosted-kernel.kill-quarantine.client-mutation.v1',
            method: 'POST',
            route: 'kernel.lifecycle.kill-dispatch',
            idempotencyKey: recoveryCommand.idempotencyKey,
            body: {
              kernelId,
              requestId: persistedKillQuarantine.requestId,
              targetPids: persistedKillQuarantine.targetPids,
              providerRevision: providerService.sync.desiredRevision
            }
          }
        : null;
  const routeTransition = {
    contract: 'hosted-kernel.kill-quarantine.route-transition.v1',
    from: workflowRequest.sourceRoute,
    to: workflowHandoff.route.name,
    panel: workflowHandoff.route.panel,
    state: workflowHandoff.route.state,
    focusPid: workflowHandoff.route.params.focusPid,
    replaceHistory: blocked,
    preserveSelection: !blocked,
    params: workflowHandoff.route.params
  };
  const queueItem = {
    contract: 'hosted-kernel.kill-quarantine.workflow-queue-item.v1',
    handoffId,
    queuedAt: now,
    status: queueStatus,
    requestId: persistedKillQuarantine.requestId,
    kernelId,
    operatorId,
    command: recoveryCommand.command,
    idempotencyKey: recoveryCommand.idempotencyKey,
    state: persistedKillQuarantine.state,
    nextAction: nextLifecycleAction.action,
    dueAt: nextLifecycleAction.dueAt ?? providerService.handoff.dueAt ?? null,
    retryAfterMs: nextLifecycleAction.retryAfterMs ?? health.retryAfterMs,
    targetPids: intent.targetPids,
    providerTopic: providerService.handoff.topic,
    providerState: providerService.handoff.state,
    validationOk: validation.ok,
    errorCount: validation.errorCount,
    warningCount: validation.warningCount
  };

  return {
    contract: 'hosted-kernel.kill-quarantine.client-runtime-handoff.v1',
    generatedAt: now,
    handoffId,
    correlationId: workflowHandoff.correlationId,
    status: queueStatus,
    terminal: blocked || recoveryCommand.command === 'observe-kill',
    accepted,
    routeTransition,
    queueItem,
    requestMutation,
    optimisticClientPatch: {
      activeKernelId: kernelId,
      activeKillQuarantineRequestId: persistedKillQuarantine.requestId,
      killQuarantineWorkflowStatus: workflowHandoff.route.state,
      killQuarantineHandoffId: handoffId,
      killQuarantineProviderTopic: providerService.handoff.topic,
      killQuarantinePendingMutation: requestMutation
        ? {
            route: requestMutation.route,
            idempotencyKey: requestMutation.idempotencyKey,
            method: requestMutation.method
          }
        : null,
      killQuarantineLastOperatorAck: operatorAck.present
        ? {
            accepted: operatorAck.accepted,
            requestId: operatorAck.requestId,
            issues: operatorAck.issues
          }
        : null
    },
    proofRefs: {
      previewContract: preview.contract,
      providerDesiredRevision: providerService.sync.desiredRevision,
      persistedStateContract: persistedKillQuarantine.contract,
      recoveryPlanKey: recoveryCommand.idempotencyKey
    }
  };
}

function normalizeCounterRecord(value) {
  const counters = {};
  for (const [key, count] of Object.entries(asRecord(value))) {
    const counterKey = asString(key, '');
    if (counterKey) counters[counterKey] = asNonNegativeInteger(count, 0);
  }
  return counters;
}

function mergeCounterIncrements(base, increments) {
  const counters = normalizeCounterRecord(base);
  for (const [key, increment] of Object.entries(increments)) {
    const counterKey = asString(key, '');
    if (counterKey) counters[counterKey] = asNonNegativeInteger(counters[counterKey], 0) + asNonNegativeInteger(increment, 0);
  }
  return counters;
}

function normalizeHistorySnapshots(values) {
  return (Array.isArray(values) ? values : [])
    .map((snapshot) => asRecord(snapshot))
    .filter((snapshot) => Object.keys(snapshot).length > 0)
    .slice(-MAX_HISTORY_SNAPSHOTS);
}

function csvEscape(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function exportValueForColumn(row, column) {
  const value = row[column.key];
  if (column.type === 'integer') return asNonNegativeInteger(value, 0);
  if (column.type === 'boolean') return Boolean(value);
  return value === undefined || value === null ? '' : String(value);
}

function buildTypedExportRow(row) {
  return Object.fromEntries(
    KILL_QUARANTINE_EXPORT_COLUMNS.map((column) => [column.key, exportValueForColumn(row, column)])
  );
}

function buildExportPayload(row) {
  const typedRow = buildTypedExportRow(row);
  const csvHeaders = KILL_QUARANTINE_EXPORT_COLUMNS.map((column) => column.key);
  const csvRow = csvHeaders.map((key) => csvEscape(typedRow[key]));

  return {
    contract: 'hosted-kernel.kill-quarantine.export.v2',
    formats: ['json', 'ndjson', 'csv'],
    schema: KILL_QUARANTINE_EXPORT_COLUMNS,
    summary: typedRow,
    json: typedRow,
    ndjsonLine: JSON.stringify(typedRow),
    csvHeaders,
    csvRow,
    csvLine: csvRow.join(',')
  };
}

function incrementRollup(rollup, key, value = 1) {
  const rollupKey = asString(key, 'unknown');
  rollup[rollupKey] = asNonNegativeInteger(rollup[rollupKey], 0) + value;
}

function summarizeHistoryWindow(history) {
  const rollups = {
    verdicts: {},
    commands: {},
    states: {},
    health: {},
    reasons: {},
    blockReasons: {},
    nextActions: {}
  };
  const first = history[0] ?? null;
  const latest = history.at(-1) ?? null;

  for (const snapshot of history) {
    incrementRollup(rollups.verdicts, snapshot.verdict);
    incrementRollup(rollups.commands, snapshot.command);
    incrementRollup(rollups.states, snapshot.state);
    incrementRollup(rollups.health, snapshot.healthStatus);
    incrementRollup(rollups.reasons, snapshot.reason);
    if (snapshot.blockReason) incrementRollup(rollups.blockReasons, snapshot.blockReason);
    incrementRollup(rollups.nextActions, snapshot.nextAction);
  }

  return {
    contract: 'hosted-kernel.kill-quarantine.history-window.v1',
    retainedLimit: MAX_HISTORY_SNAPSHOTS,
    depth: history.length,
    firstAt: first?.at ?? null,
    latestAt: latest?.at ?? null,
    latestRequestId: latest?.requestId ?? null,
    latestState: latest?.state ?? null,
    rollups
  };
}

function compactValidationCodes(validation) {
  const codes = [];
  for (const issue of validation.issues) {
    if (issue.code && !codes.includes(issue.code)) codes.push(issue.code);
  }
  return codes;
}

function buildTimelineEvent({ at, phase, state, label, severity = 'info', payload = {} }) {
  return {
    at: at || null,
    phase,
    state,
    label,
    severity,
    payload
  };
}

function incrementNestedRollup(rollup, bucket, key, value = 1) {
  const bucketKey = asString(bucket, 'unknown');
  if (!rollup[bucketKey]) rollup[bucketKey] = {};
  incrementRollup(rollup[bucketKey], key, value);
}

function buildTimelineReportingState({ now, timeline, quarantineClock }) {
  const nowMs = parseTimeMs(now) ?? Date.now();
  const phaseCounts = {};
  const severityCounts = {};
  const overdue = [];
  const futureDue = [];

  for (const event of timeline) {
    incrementRollup(phaseCounts, event.phase);
    incrementRollup(severityCounts, event.severity);
    const eventMs = parseTimeMs(event.at);
    if (eventMs === null) continue;
    if (eventMs < nowMs && ['ack-deadline', 'provider-dispatch', 'next-action'].includes(event.phase)) {
      overdue.push({
        phase: event.phase,
        state: event.state,
        at: event.at,
        overdueMs: nowMs - eventMs
      });
    } else if (eventMs >= nowMs) {
      futureDue.push({
        phase: event.phase,
        state: event.state,
        at: event.at,
        dueInMs: eventMs - nowMs
      });
    }
  }

  futureDue.sort((left, right) => left.dueInMs - right.dueInMs);
  overdue.sort((left, right) => right.overdueMs - left.overdueMs);

  return {
    contract: 'hosted-kernel.kill-quarantine.timeline-reporting.v1',
    generatedAt: now,
    eventCount: timeline.length,
    phaseCounts,
    severityCounts,
    nextDue: futureDue[0] ?? null,
    overdue,
    overdueCount: overdue.length,
    ackDeadline: {
      at: quarantineClock.ackDeadlineAt,
      expired: quarantineClock.ackExpired,
      overdueMs: quarantineClock.ackExpired ? quarantineClock.overdueMs : 0
    }
  };
}

function buildHistoryReportSummary({ history, exportRows, latestSeverity, timelineReporting }) {
  const rollups = {
    severity: {},
    severityByState: {},
    providerFailures: {},
    ack: {},
    timers: {}
  };
  const historyRows = Array.isArray(history) ? history : [];
  const first = historyRows[0] ?? null;
  const latest = historyRows.at(-1) ?? null;

  for (const row of exportRows) {
    const severity = asString(row.reportSeverity, 'info');
    incrementRollup(rollups.severity, severity);
    incrementNestedRollup(rollups.severityByState, row.state, severity);
    if (row.providerFailureCode) incrementRollup(rollups.providerFailures, row.providerFailureCode);
    incrementRollup(rollups.ack, row.requiresOperatorAck ? 'required' : 'not_required');
    if (row.ackAccepted) incrementRollup(rollups.ack, 'accepted');
    incrementRollup(rollups.timers, row.pendingTimerAt ? 'pending' : 'none');
  }

  return {
    contract: 'hosted-kernel.kill-quarantine.history-report-summary.v1',
    rowCount: exportRows.length,
    firstGeneratedAt: first?.at ?? null,
    latestGeneratedAt: latest?.at ?? null,
    latestRequestId: latest?.requestId ?? null,
    latestSeverity,
    retainedLimit: MAX_HISTORY_SNAPSHOTS,
    rollups,
    timeline: timelineReporting
  };
}

function buildCsvDocument(headers, rows) {
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((key) => csvEscape(row[key])).join(','))
  ].join('\n');
}

function buildKillQuarantineAnalytics({
  now,
  accepted,
  kernelId,
  requestId,
  reason,
  operatorId,
  clientState,
  intent,
  validation,
  health,
  recoveryCommand,
  persisted,
  persistedKillQuarantine,
  providerService,
  providerHealth,
  nextLifecycleAction,
  blockReason,
  operatorAck,
  quarantineClock
}) {
  const lifecycleState = asRecord(clientState.kernelLifecycle);
  const previousAnalytics = asRecord(lifecycleState.killQuarantineAnalytics);
  const previousCounters = normalizeCounterRecord(previousAnalytics.counters);
  const validationCodes = compactValidationCodes(validation);
  const requiresOperatorAck = Boolean(accepted && nextLifecycleAction.requiresOperatorAck);
  const pendingTimerAt = quarantineClock.pendingTimerAt ?? nextLifecycleAction.dueAt ?? null;
  const timerState = quarantineClock.ackExpired
    ? 'ack_expired'
    : pendingTimerAt
      ? 'timer_pending'
      : 'no_timer';
  const reportSeverity = validation.errorCount > 0 || quarantineClock.ackExpired
    ? 'error'
    : validation.warningCount > 0 || providerHealth.warningCount > 0
      ? 'warning'
      : 'info';
  const transitionKey = `${persisted.present ? persisted.state || 'none' : 'none'}>${persistedKillQuarantine.state || 'unknown'}`;
  const increments = {
    requests: 1,
    accepted: accepted ? 1 : 0,
    blocked: accepted ? 0 : 1,
    warnings: validation.warningCount,
    errors: validation.errorCount,
    'targets.requested': intent.requestedPids.length,
    'targets.requestedRaw': intent.requestedRawCount,
    'targets.accepted': intent.targetPids.length,
    'targets.skipped': intent.skippedPids.length,
    'targets.missing': intent.missingPids.length,
    'targets.outOfScope': intent.outOfScopePids.length,
    'targets.duplicates': intent.duplicateRequestedPids.length,
    'targets.invalidClaims': intent.invalidPidClaims.length,
    'ack.required': requiresOperatorAck ? 1 : 0,
    'ack.present': operatorAck.present ? 1 : 0,
    'timer.pending': pendingTimerAt ? 1 : 0,
    'timer.expired': quarantineClock.ackExpired ? 1 : 0,
    [`command.${recoveryCommand.command}`]: 1,
    [`state.${persistedKillQuarantine.state || 'unknown'}`]: 1,
    [`transition.${transitionKey}`]: 1,
    [`health.${health.status}`]: 1,
    [`providerHealth.${providerHealth.status}`]: 1,
    [`reason.${reason}`]: 1,
    [`provider.${providerService.handoff.state}`]: 1,
    [`nextAction.${nextLifecycleAction.action}`]: 1,
    [`timerState.${timerState}`]: 1,
    [`reportSeverity.${reportSeverity}`]: 1
  };
  if (providerHealth.dispatchFailure.present) {
    increments['provider.dispatchFailures'] = 1;
    increments[`provider.dispatchFailure.${providerHealth.dispatchFailure.code}`] = 1;
    increments['provider.failedTargets'] = providerHealth.dispatchFailure.failedPids.length;
  }
  if (blockReason) increments[`block.${blockReason}`] = 1;
  if (operatorAck.present) increments[`ack.${operatorAck.accepted ? 'accepted' : 'rejected'}`] = 1;
  for (const code of validationCodes) increments[`validation.${code}`] = 1;

  const snapshot = {
    contract: 'hosted-kernel.kill-quarantine.history-snapshot.v1',
    at: now,
    kernelId,
    requestId,
    operatorId,
    verdict: accepted ? 'accepted_for_quarantine' : 'blocked_before_quarantine',
    command: recoveryCommand.command,
    state: persistedKillQuarantine.state,
    reason,
    targetCount: intent.targetPids.length,
    requestedCount: intent.requestedPids.length,
    requestedRawCount: intent.requestedRawCount,
    skippedCount: intent.skippedPids.length,
    missingCount: intent.missingPids.length,
    outOfScopeCount: intent.outOfScopePids.length,
    validation: {
      ok: validation.ok,
      errorCount: validation.errorCount,
      warningCount: validation.warningCount,
      codes: validationCodes
    },
    healthStatus: health.status,
    providerHealthStatus: providerHealth.status,
    providerHealthIssues: providerHealth.issues.map((issue) => issue.code),
    providerDispatchFailure: providerHealth.dispatchFailure.present
      ? {
          code: providerHealth.dispatchFailure.code,
          failureId: providerHealth.dispatchFailure.failureId || null,
          retryable: providerHealth.dispatchFailure.retryable,
          retryAfterMs: providerHealth.dispatchFailure.retryAfterMs,
          failedPids: providerHealth.dispatchFailure.failedPids,
          targetFailures: providerHealth.dispatchFailure.targetFailures
        }
      : null,
    blockReason: blockReason || null,
    providerState: providerService.handoff.state,
    nextAction: nextLifecycleAction.action,
    pendingTimerAt,
    transition: {
      from: persisted.present ? persisted.state || null : null,
      to: persistedKillQuarantine.state,
      key: transitionKey,
      recovered: Boolean(persisted.active)
    },
    targets: {
      requested: intent.requestedPids.length,
      requestedRaw: intent.requestedRawCount,
      accepted: intent.targetPids.length,
      skipped: intent.skippedPids.length,
      missing: intent.missingPids.length,
      outOfScope: intent.outOfScopePids.length,
      duplicateRequested: intent.duplicateRequestedPids.length,
      invalidClaims: intent.invalidPidClaims.length
    },
    ack: {
      present: operatorAck.present,
      accepted: operatorAck.accepted,
      required: requiresOperatorAck,
      issues: operatorAck.issues
    }
  };
  const previousHistory = normalizeHistorySnapshots([
    ...normalizeHistorySnapshots(asRecord(previousAnalytics).history),
    ...normalizeHistorySnapshots(lifecycleState.killQuarantineHistory)
  ]);
  const history = normalizeHistorySnapshots([
    ...previousHistory.filter((entry) => entry.requestId !== requestId || entry.command !== recoveryCommand.command),
    snapshot
  ]);
  const historyWindow = summarizeHistoryWindow(history);
  const timeline = [
    buildTimelineEvent({
      at: now,
      phase: 'request',
      state: accepted ? 'accepted' : 'blocked',
      label: accepted ? 'Kill quarantine request accepted' : 'Kill quarantine request blocked',
      severity: accepted ? 'info' : 'error',
      payload: { requestId, targetCount: intent.targetPids.length, blockReason: blockReason || null }
    }),
    persisted.active
      ? buildTimelineEvent({
          at: persisted.updatedAt ?? persisted.recoveredAt,
          phase: 'recovery',
          state: persisted.state,
          label: 'Recovered active persisted quarantine',
          payload: { recoveredFromRequestId: persisted.requestId }
        })
      : null,
    quarantineClock.ackDeadlineAt
      ? buildTimelineEvent({
          at: quarantineClock.ackDeadlineAt,
          phase: 'ack-deadline',
          state: quarantineClock.ackExpired ? 'expired' : 'pending',
          label: quarantineClock.ackExpired ? 'Operator acknowledgment timed out' : 'Operator acknowledgment deadline',
          severity: quarantineClock.ackExpired ? 'error' : 'info',
          payload: { overdueMs: quarantineClock.overdueMs }
        })
      : null,
    operatorAck.present
      ? buildTimelineEvent({
          at: now,
          phase: 'operator-ack',
          state: operatorAck.accepted ? 'accepted' : 'rejected',
          label: operatorAck.accepted ? 'Operator acknowledgment accepted' : 'Operator acknowledgment rejected',
          severity: operatorAck.accepted ? 'info' : 'warning',
          payload: { issues: operatorAck.issues, requestId: operatorAck.requestId }
        })
      : null,
    providerService.handoff.dueAt
      ? buildTimelineEvent({
          at: providerService.handoff.dueAt,
          phase: 'provider-dispatch',
          state: providerService.handoff.state,
          label: 'Provider dispatch due',
          payload: { topic: providerService.handoff.topic }
        })
      : null,
    providerHealth.issues.length > 0
      ? buildTimelineEvent({
          at: now,
          phase: 'provider-health',
          state: providerHealth.status,
          label: providerHealth.ok ? 'Provider health degraded' : 'Provider health failed',
          severity: providerHealth.ok ? 'warning' : 'error',
          payload: {
            issues: providerHealth.issues.map((issue) => issue.code),
            retryable: providerHealth.retryable,
            retryAfterMs: providerHealth.retryAfterMs
          }
        })
      : null,
    buildTimelineEvent({
      at: nextLifecycleAction.dueAt,
      phase: 'next-action',
      state: nextLifecycleAction.state,
      label: nextLifecycleAction.label,
      severity: accepted ? 'info' : 'warning',
      payload: { action: nextLifecycleAction.action, retryAfterMs: nextLifecycleAction.retryAfterMs }
    })
  ].filter(Boolean);
  const timelineReporting = buildTimelineReportingState({ now, timeline, quarantineClock });
  increments['timeline.events'] = timelineReporting.eventCount;
  increments['timeline.overdue'] = timelineReporting.overdueCount;
  const counters = mergeCounterIncrements(previousCounters, increments);
  const exportRow = {
    generatedAt: now,
    kernelId,
    requestId,
    operatorId,
    verdict: snapshot.verdict,
    command: recoveryCommand.command,
    state: persistedKillQuarantine.state,
    reason,
    targetCount: snapshot.targetCount,
    requestedCount: snapshot.requestedCount,
    validationErrors: validation.errorCount,
    validationWarnings: validation.warningCount,
    healthStatus: health.status,
    blockReason: blockReason || '',
    providerFailureCode: providerHealth.dispatchFailure.present ? providerHealth.dispatchFailure.code : '',
    failedTargetCount: providerHealth.dispatchFailure.failedPids.length,
    retryAfterMs: health.retryAfterMs ?? providerHealth.retryAfterMs ?? 0,
    providerState: providerService.handoff.state,
    nextAction: nextLifecycleAction.action,
    requiresOperatorAck,
    ackAccepted: operatorAck.accepted,
    pendingTimerAt,
    reportSeverity
  };
  const exportPayload = buildExportPayload(exportRow);
  const exportHistory = history.map((entry) => buildTypedExportRow({
    generatedAt: entry.at,
    kernelId: entry.kernelId,
    requestId: entry.requestId,
    operatorId: entry.operatorId,
    verdict: entry.verdict,
    command: entry.command,
    state: entry.state,
    reason: entry.reason,
    targetCount: entry.targetCount,
    requestedCount: entry.requestedCount,
    validationErrors: asRecord(entry.validation).errorCount,
    validationWarnings: asRecord(entry.validation).warningCount,
    healthStatus: entry.healthStatus,
    blockReason: entry.blockReason || '',
    providerFailureCode: asRecord(entry.providerDispatchFailure).code || '',
    failedTargetCount: Array.isArray(asRecord(entry.providerDispatchFailure).failedPids)
      ? asRecord(entry.providerDispatchFailure).failedPids.length
      : 0,
    retryAfterMs: asRecord(entry.providerDispatchFailure).retryAfterMs ?? 0,
    providerState: entry.providerState,
    nextAction: entry.nextAction,
    requiresOperatorAck: asRecord(entry.ack).required,
    ackAccepted: asRecord(entry.ack).accepted,
    pendingTimerAt: entry.pendingTimerAt,
    reportSeverity: entry.blockReason
      ? 'error'
      : asRecord(entry.validation).warningCount > 0 || entry.providerHealthStatus === 'degraded'
        ? 'warning'
        : 'info'
  }));
  const reportSummary = buildHistoryReportSummary({
    history,
    exportRows: exportHistory,
    latestSeverity: reportSeverity,
    timelineReporting
  });

  return {
    contract: 'hosted-kernel.kill-quarantine.analytics.v1',
    generatedAt: now,
    counters,
    previousRequestCount: asNonNegativeInteger(previousCounters.requests, 0),
    snapshot,
    history,
    historyWindow,
    timeline,
    export: {
      ...exportPayload,
      historyRows: exportHistory,
      historyNdjson: exportHistory.map((row) => JSON.stringify(row)),
      historyCsv: buildCsvDocument(exportPayload.csvHeaders, exportHistory),
      reportSummary,
      manifest: {
        generatedAt: now,
        rowCount: exportHistory.length,
        latestRequestId: requestId,
        schemaVersion: exportPayload.contract,
        retainedLimit: MAX_HISTORY_SNAPSHOTS,
        severity: reportSeverity,
        overdueTimelineEvents: timelineReporting.overdueCount
      }
    },
    reporting: {
      status: accepted ? 'reportable' : 'blocked_reportable',
      severity: exportPayload.summary.reportSeverity,
      rollupKey: `${kernelId}:${persistedKillQuarantine.state || recoveryCommand.command}`,
      latestHistoryAt: history.at(-1)?.at ?? now,
      historyDepth: history.length,
      countersUpdated: Object.keys(increments).filter((key) => increments[key] > 0),
      window: historyWindow,
      reportSummary,
      timelineState: {
        timerState,
        pendingTimerAt,
        nextAction: nextLifecycleAction.action,
        transition: transitionKey,
        providerState: providerService.handoff.state,
        metrics: timelineReporting
      }
    }
  };
}

export function describeKillQuarantineSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const kernel = asRecord(input.kernel);
  const request = asRecord(input.request);
  const clientState = asRecord(input.clientState);
  const processes = (Array.isArray(input.processes) ? input.processes : [])
    .map(normalizeProcess)
    .filter((process) => process.pid);
  const kernelId = asString(input.kernelId ?? kernel.id, 'hosted-kernel:unknown');
  const requestId = asString(input.requestId ?? request.id, `kill-quarantine:${kernelId}:${now}`);
  const operatorId = asString(input.operatorId ?? asRecord(input.operator).id, 'system');
  const requestedReason = asString(asRecord(input.killRequest).reason ?? input.reason, '');
  const reason = normalizeReason(input);
  const boundary = normalizeWorkspaceBoundary(input, kernel);
  const grants = normalizeOperatorGrants(input);
  const authorization = authorizeKillQuarantine({ operatorId, grants, boundary });
  const intent = normalizeKillIntent(input, processes, boundary);
  const boundaryAccess = buildBoundaryAccessContract({ boundary, grants, processes, intent });
  const workflowRequest = normalizeKillQuarantineWorkflowRequest(input);
  const controls = normalizeKillQuarantineControls(input, now);
  const provider = normalizeKillQuarantineProvider(input, controls);
  const boundarySafe = boundaryAccess.allowed;
  const persisted = normalizePersistedKillQuarantineState(input, { now, kernelId });
  const operatorAck = normalizeKillQuarantineAck(input, { requestId, intent, persisted, controls });
  const quarantineClock = deriveKillQuarantineClock({ now, persisted, controls });
  const providerHealth = buildProviderOperationalHealth({ provider, controls, quarantineClock });
  const providerHealthBlockReason = providerHealth.issues.find((issue) => issue.severity === 'error')?.code ?? null;
  const providerDispatchReady = provider.capabilities.includes(KILL_QUARANTINE_DISPATCH_CAPABILITY);
  const persistedStateReplayable = !persisted.present || persisted.kernelId !== kernelId || persisted.stateValid;
  const accepted = Boolean(
    kernelId !== 'hosted-kernel:unknown'
      && authorization.allowed
      && controls.enabled
      && controls.scheduleValid
      && provider.ready
      && !provider.externalState.blocking
      && providerHealth.ok
      && persistedStateReplayable
      && boundarySafe
      && boundaryAccess.allowed
      && intent.outOfScopePids.length === 0
      && intent.targetPids.length > 0
      && intent.targetPids.length <= controls.maxTargets
      && !quarantineClock.ackExpired
      && (!operatorAck.present || operatorAck.accepted)
      && (!operatorAck.present || providerDispatchReady)
  );
  const recoveryCommand = deriveRecoveryCommand({
    accepted,
    requestId,
    reason,
    operatorId,
    intent,
    persisted,
    controls,
    operatorAck,
    quarantineClock
  });
  const persistedKillQuarantine = buildPersistedKillQuarantineState({
    now,
    kernelId,
    requestId,
    reason,
    operatorId,
    intent,
    persisted,
    recoveryCommand,
    controls,
    operatorAck
  });
  const auditProof = buildAuditProof({ now, kernelId, requestId, reason, operatorId, intent, authorization, boundaryAccess, quarantineClock });
  const blockReason = authorization.allowed
    ? boundaryAccess.allowed
      ? intent.outOfScopePids.length > 0
        ? 'requested_pids_out_of_scope'
        : !controls.enabled
          ? recoveryCommand.command === 'cancel-quarantine'
            ? 'active_quarantine_cancelled_by_settings'
            : 'kill_quarantine_disabled'
          : !controls.scheduleValid
            ? 'invalid_quarantine_schedule'
            : !provider.ready
              ? 'provider_capabilities_missing'
              : provider.externalState.blocking
                ? 'provider_external_state_blocked'
                : providerHealthBlockReason
                  ? providerHealthBlockReason
                  : !persistedStateReplayable
                    ? 'persisted_state_unrecognized'
                    : intent.targetPids.length > controls.maxTargets
                      ? 'target_limit_exceeded'
                      : operatorAck.present && !providerDispatchReady
                        ? 'provider_dispatch_missing_after_ack'
                      : operatorAck.present && !operatorAck.accepted
                        ? 'operator_ack_not_actionable'
                        : quarantineClock.ackExpired
                          ? 'stale_quarantine_ack_timeout'
                          : intent.targetPids.length > 0
                            ? null
                            : 'no_live_targets'
      : boundaryAccess.errors[0] === 'boundary_missing'
        ? 'kernel_scope_requires_tenant_or_workspace'
        : boundaryAccess.errors[0]
    : authorization.reason;
  const attempt = normalizeKillQuarantineAttempt(input);
  const validation = buildValidationReport({
    kernelId,
    requestedReason,
    boundary,
    boundaryAccess,
    intent,
    authorization,
    controls,
    provider,
    providerHealth,
    persisted,
    operatorAck,
    quarantineClock
  });
  const health = buildOperationalHealth({
    accepted,
    processes,
    intent,
    persisted,
    blockReason,
    attempt,
    controls,
    providerHealth,
    quarantineClock
  });
  const actionableErrors = buildActionableErrors({
    accepted,
    blockReason,
    validation,
    health,
    intent,
    authorization
  });
  const nextLifecycleAction = buildNextLifecycleAction({
    accepted,
    recoveryCommand,
    controls,
    persistedKillQuarantine,
    health,
    actionableErrors,
    operatorAck,
    quarantineClock
  });
  const providerService = buildProviderServiceContract({
    now,
    accepted,
    kernelId,
    requestId,
    reason,
    intent,
    boundaryAccess,
    provider,
    providerHealth,
    controls,
    recoveryCommand,
    persistedKillQuarantine,
    operatorAck,
    quarantineClock
  });
  const persistenceRecovery = buildPersistenceRecoveryPlan({
    now,
    accepted,
    kernelId,
    requestId,
    persisted,
    persistedKillQuarantine,
    recoveryCommand,
    providerService,
    quarantineClock,
    validation
  });
  const preview = buildKillQuarantinePreviewContract({
    accepted,
    kernelId,
    requestId,
    reason,
    operatorId,
    processes,
    intent,
    authorization,
    boundaryAccess,
    controls,
    provider,
    providerHealth,
    providerService,
    validation,
    health,
    recoveryCommand,
    persistedKillQuarantine,
    nextLifecycleAction,
    actionableErrors,
    operatorAck
  });
  const workflowHandoff = buildWorkflowHandoffContract({
    now,
    accepted,
    kernelId,
    requestId,
    operatorId,
    workflowRequest,
    intent,
    controls,
    validation,
    health,
    recoveryCommand,
    persistedKillQuarantine,
    providerService,
    preview,
    nextLifecycleAction,
    actionableErrors,
    operatorAck
  });
  const runtimeHandoff = buildClientRuntimeHandoffEnvelope({
    now,
    accepted,
    kernelId,
    requestId,
    operatorId,
    workflowRequest,
    intent,
    validation,
    health,
    recoveryCommand,
    persistedKillQuarantine,
    providerService,
    preview,
    nextLifecycleAction,
    workflowHandoff,
    operatorAck
  });
  const analytics = buildKillQuarantineAnalytics({
    now,
    accepted,
    kernelId,
    requestId,
    reason,
    operatorId,
    clientState,
    intent,
    validation,
    health,
    recoveryCommand,
    persisted,
    persistedKillQuarantine,
    providerService,
    providerHealth,
    nextLifecycleAction,
    blockReason,
    operatorAck,
    quarantineClock
  });
  const nextClientState = {
    ...clientState,
    kernelLifecycle: {
      ...asRecord(clientState.kernelLifecycle),
      killQuarantine: persistedKillQuarantine,
      killQuarantineBoundaryAccess: boundaryAccess,
      killQuarantineRecovery: persistenceRecovery,
      killQuarantineClock: quarantineClock,
      killQuarantineProviderSync: providerService.sync,
      killQuarantineProviderHealth: providerHealth,
      killQuarantineAnalytics: {
        contract: analytics.contract,
        generatedAt: analytics.generatedAt,
        counters: analytics.counters,
        reporting: analytics.reporting,
        historyWindow: analytics.historyWindow,
        export: analytics.export
      },
      killQuarantineReporting: {
        contract: 'hosted-kernel.kill-quarantine.reporting-state.v1',
        generatedAt: analytics.generatedAt,
        status: analytics.reporting.status,
        severity: analytics.reporting.severity,
        rollupKey: analytics.reporting.rollupKey,
        timelineState: analytics.reporting.timelineState,
        historyWindow: analytics.historyWindow,
        exportManifest: analytics.export.manifest
      },
      killQuarantineWorkflow: workflowHandoff,
      killQuarantineRuntimeHandoff: runtimeHandoff,
      killQuarantineWorkflowQueue: normalizeHistorySnapshots([
        ...normalizeHistorySnapshots(asRecord(clientState.kernelLifecycle).killQuarantineWorkflowQueue),
        runtimeHandoff.queueItem
      ]),
      killQuarantineHistory: analytics.history,
      killQuarantineTimeline: analytics.timeline,
      killQuarantineAck: operatorAck.present
        ? {
            contract: operatorAck.contract,
            accepted: operatorAck.accepted,
            requestId: operatorAck.requestId,
            issues: operatorAck.issues,
            nextAction: nextLifecycleAction.action
          }
        : asRecord(asRecord(clientState.kernelLifecycle).killQuarantineAck),
      killQuarantinePreview: {
        requestId: preview.requestId,
        verdict: preview.verdict,
        routePreview: preview.routePreview,
        readiness: preview.readiness,
        validationSummary: preview.validationSummary,
        acceptance: {
          contract: preview.acceptance.contract,
          enabled: preview.acceptance.enabled,
          disabledReason: preview.acceptance.disabledReason,
          requiresOperatorAck: preview.acceptance.requiresOperatorAck,
          requiresScheduleWait: preview.acceptance.requiresScheduleWait,
          cancellation: preview.acceptance.cancellation,
          dueAt: preview.acceptance.dueAt,
          retryAfterMs: preview.acceptance.retryAfterMs,
          ackSubmitPayload: preview.acceptance.ackSubmitPayload,
          routePayload: preview.acceptance.routePayload
        },
        runtimeHandoff: {
          contract: runtimeHandoff.contract,
          handoffId: runtimeHandoff.handoffId,
          status: runtimeHandoff.status,
          routeTransition: runtimeHandoff.routeTransition,
          requestMutation: runtimeHandoff.requestMutation,
          queueItem: runtimeHandoff.queueItem
        },
        primaryAction: preview.primaryAction,
        nextSteps: preview.nextSteps
      },
      ...workflowHandoff.clientStatePatch,
      ...runtimeHandoff.optimisticClientPatch
    }
  };

  return {
    ok: accepted,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'hosted-kernel.kill-quarantine.v1',
    request: {
      id: requestId,
      kernelId,
      operatorId,
      reason,
      boundary,
      authorization: {
        allowed: authorization.allowed,
        mode: authorization.mode,
        role: authorization.role,
        permission: authorization.permission
      },
      boundaryAccess,
      scope: intent.scope,
      requestedPids: intent.requestedPids,
      requestedPidClaims: intent.requestedPidClaims
    },
    runtime: {
      quarantineRequired: accepted,
      killAllowedAfterQuarantineAck: accepted
        && controls.requireAck
        && controls.scheduleDue
        && ['acknowledge-quarantine', 'dispatch-kill'].includes(recoveryCommand.command),
      blockReason,
      health,
      validation,
      preview,
      workflowHandoff,
      runtimeHandoff,
      controls,
      boundaryAccess,
      operatorAck,
      provider: providerService,
      timers: quarantineClock,
      analytics,
      persistenceRecovery,
      nextAction: nextLifecycleAction,
      failureState: accepted
        ? null
        : {
            reason: blockReason,
            retryable: health.retryable,
            retryAfterMs: health.retryAfterMs,
            attempt: attempt.attempt,
            nextAttempt: health.nextAttempt,
            errors: actionableErrors,
            providerHealth
          },
      command: recoveryCommand.command,
      idempotencyKey: recoveryCommand.idempotencyKey,
      restartSafeStatus: recoveryCommand.restartSafeStatus,
      recoveredFromPersistedState: Boolean(persisted.active),
      targetProcesses: processes.filter((process) => intent.targetPids.includes(process.pid)),
      requestedPidClaims: intent.requestedPidClaims,
      duplicateRequestedPids: intent.duplicateRequestedPids,
      invalidPidClaims: intent.invalidPidClaims,
      missingPids: intent.missingPids,
      outOfScopePids: intent.outOfScopePids,
      skippedPids: intent.skippedPids
    },
    persistence: {
      contract: 'hosted-kernel.kill-quarantine.persistence.v1',
      command: recoveryCommand.command,
      recovery: recoveryCommand.recovery,
      idempotencyKey: recoveryCommand.idempotencyKey,
      previous: persisted.present
        ? {
            requestId: persisted.requestId,
            state: persisted.state,
            rawState: persisted.rawState,
            stateValid: persisted.stateValid,
            stateMigrated: persisted.stateMigrated,
            kernelId: persisted.kernelId,
            targetPids: persisted.targetPids,
            updatedAt: persisted.updatedAt,
            restartToken: persisted.restartToken || null
          }
        : null,
      next: persistedKillQuarantine,
      recoveryPlan: persistenceRecovery
    },
    integration: {
      provider: providerService.provider,
      contract: providerService.contract,
      negotiation: providerService.negotiation,
      sync: providerService.sync,
      externalHandoff: providerService.handoff
    },
    client: {
      state: nextClientState,
      handoff: {
        title: accepted
          ? recoveryCommand.command === 'dispatch-kill'
            ? 'Kernel kill dispatch ready'
            : recoveryCommand.command === 'acknowledge-quarantine'
              ? 'Kernel quarantine acknowledged'
              : 'Kernel kill staged for quarantine'
          : 'Kernel kill blocked',
        action: accepted
          ? recoveryCommand.command === 'observe-kill'
            ? 'observe-dispatched-kill'
            : recoveryCommand.command === 'dispatch-kill' || recoveryCommand.command === 'acknowledge-quarantine'
              ? nextLifecycleAction.action
              : 'confirm-quarantine-then-kill'
          : actionableErrors[0]?.action ?? (authorization.allowed
              ? 'review-target-processes'
              : 'request-kill-quarantine-permission'),
        message: accepted
          ? recoveryCommand.command === 'resume-quarantine'
            ? `Recovered quarantine request ${persisted.requestId}; continue before kill.`
            : recoveryCommand.command === 'dispatch-kill'
              ? `Operator acknowledged quarantine ${persistedKillQuarantine.requestId}; dispatch kill now.`
              : recoveryCommand.command === 'acknowledge-quarantine'
                ? `Operator acknowledged quarantine ${persistedKillQuarantine.requestId}; dispatch after configured delay.`
                : `Quarantine ${intent.targetPids.length} live process${intent.targetPids.length === 1 ? '' : 'es'} before kill.`
          : actionableErrors[0]?.message ?? (authorization.allowed
              ? 'No live hosted-kernel processes were eligible inside the requested tenant/workspace boundary.'
              : 'Operator is not allowed to kill-quarantine hosted-kernel processes in this tenant/workspace boundary.'),
        boundary,
        blockReason,
        healthStatus: health.status,
        retryAfterMs: health.retryAfterMs,
        nextAction: nextLifecycleAction,
        operatorAck,
        externalHandoff: providerService.handoff,
        workflowHandoff,
        runtimeHandoff,
        providerSync: providerService.sync,
        persistenceRecovery,
        preview,
        routePreview: preview.routePreview,
        analytics: {
          counters: analytics.counters,
          latestSnapshot: analytics.snapshot,
          historyWindow: analytics.historyWindow,
          timeline: analytics.timeline,
          export: analytics.export,
          reporting: analytics.reporting
        },
        readiness: preview.readiness,
        validationSummary: preview.validationSummary,
        nextSteps: preview.nextSteps,
        errors: actionableErrors,
        requestId: persistedKillQuarantine.requestId
      }
    },
    audit: {
      ...auditProof,
      command: recoveryCommand.command,
      idempotencyKey: recoveryCommand.idempotencyKey,
      restartSafeStatus: recoveryCommand.restartSafeStatus,
      healthStatus: health.status,
      validationOk: validation.ok,
      controls,
      timers: quarantineClock,
      operatorAck,
      provider: {
        id: provider.id,
        ready: provider.ready,
        health: providerHealth,
        missingCapabilities: provider.missingCapabilities,
        desiredRevision: providerService.sync.desiredRevision,
        handoffState: providerService.handoff.state
      },
      preview: {
        contract: preview.contract,
        verdict: preview.verdict,
        routePreview: {
          contract: preview.routePreview.contract,
          status: preview.routePreview.status,
          cta: preview.routePreview.cta,
          blockedGateKeys: preview.routePreview.readiness.blockedGateKeys,
          validationChips: preview.routePreview.validation.chips,
          navigation: preview.routePreview.navigation
        },
        readinessStatus: preview.readiness.status,
        primaryAction: preview.primaryAction,
        validationSummary: preview.validationSummary,
        acceptance: {
          contract: preview.acceptance.contract,
          enabled: preview.acceptance.enabled,
          disabledReason: preview.acceptance.disabledReason,
          requiresOperatorAck: preview.acceptance.requiresOperatorAck,
          route: preview.acceptance.routePayload.route
        },
        acceptedCount: preview.targets.acceptedCount
      },
      analytics: {
        contract: analytics.contract,
        counters: analytics.counters,
        snapshot: analytics.snapshot,
        reporting: analytics.reporting,
        export: analytics.export
      },
      nextAction: nextLifecycleAction,
      workflowHandoff,
      runtimeHandoff,
      persistenceRecovery,
      failureCodes: actionableErrors.map((error) => error.code),
      recoveredFromRequestId: persisted.active ? persisted.requestId : null
    },
    evidence: [
      ...(Array.isArray(input.evidence) ? input.evidence : []),
      {
        ...auditProof,
        command: recoveryCommand.command,
        idempotencyKey: recoveryCommand.idempotencyKey,
        restartSafeStatus: recoveryCommand.restartSafeStatus,
        healthStatus: health.status,
        validation,
        preview,
        controls,
        operatorAck,
        provider: providerService,
        providerHealth,
        workflowHandoff,
        runtimeHandoff,
        analytics,
        persistenceRecovery,
        nextAction: nextLifecycleAction,
        failureState: accepted
          ? null
          : {
              reason: blockReason,
              retryable: health.retryable,
              retryAfterMs: health.retryAfterMs,
              errors: actionableErrors,
              providerHealth
            },
        recoveredFromRequestId: persisted.active ? persisted.requestId : null
      }
    ]
  };
}

export default describeKillQuarantineSurface;
