export const surfaceId = "aios_package-sdk_sdk-types_098";
export const surfaceGroup = "package-sdk";
export const surfaceName = "sdk-types";

const CONTRACT_VERSION = 1;
const STATUS_PRECEDENCE = new Map([
  ['missing-state', 0],
  ['cold-start', 1],
  ['ready', 2],
  ['recovering', 3],
  ['degraded', 4],
  ['failed', 5]
]);
const HOSTED_KERNEL_PERMISSIONS = new Set([
  'kernel:read',
  'kernel:recover',
  'kernel:configure',
  'workspace:read',
  'workspace:write',
  'audit:emit'
]);
const COMMAND_PERMISSION_REQUIREMENTS = new Map([
  ['kernel.status.describe', ['kernel:read']],
  ['kernel.recovery.resume', ['kernel:recover', 'workspace:read']],
  ['kernel.lifecycle.enable', ['kernel:configure', 'audit:emit']],
  ['kernel.lifecycle.disable', ['kernel:configure', 'audit:emit']],
  ['kernel.lifecycle.schedule', ['kernel:configure', 'audit:emit']],
  ['kernel.settings.update', ['kernel:configure', 'audit:emit']],
  ['workspace.state.read', ['workspace:read']],
  ['workspace.state.write', ['workspace:write', 'audit:emit']]
]);
const COMMAND_EFFECTS = new Map([
  ['kernel.status.describe', { intent: 'read-kernel-status', mutatesWorkspace: false, emitsAudit: true, requiresHealthyKernel: false }],
  ['kernel.recovery.resume', { intent: 'resume-hosted-kernel-recovery', mutatesWorkspace: false, emitsAudit: true, requiresHealthyKernel: false }],
  ['kernel.lifecycle.enable', { intent: 'enable-hosted-kernel-dispatch', mutatesWorkspace: false, emitsAudit: true, requiresHealthyKernel: false }],
  ['kernel.lifecycle.disable', { intent: 'disable-hosted-kernel-dispatch', mutatesWorkspace: false, emitsAudit: true, requiresHealthyKernel: false }],
  ['kernel.lifecycle.schedule', { intent: 'schedule-hosted-kernel-lifecycle', mutatesWorkspace: false, emitsAudit: true, requiresHealthyKernel: false }],
  ['kernel.settings.update', { intent: 'update-hosted-kernel-settings', mutatesWorkspace: false, emitsAudit: true, requiresHealthyKernel: false }],
  ['workspace.state.read', { intent: 'read-workspace-state', mutatesWorkspace: false, emitsAudit: true, requiresHealthyKernel: true }],
  ['workspace.state.write', { intent: 'write-workspace-state', mutatesWorkspace: true, emitsAudit: true, requiresHealthyKernel: true }]
]);
const HEALTH_STALE_AFTER_MS = 90_000;
const HEALTH_FAILED_AFTER_MS = 300_000;
const MAX_RETRY_ATTEMPTS = 5;
const RETRY_BACKOFF_BASE_MS = 1_000;
const RETRY_BACKOFF_MAX_MS = 60_000;
const MAX_LEDGER_KEYS = 250;
const MAX_RECOVERY_CHECKPOINTS = 32;
const MAX_WORKSPACE_STATE_OPERATIONS = 100;
const MAX_ANALYTICS_HISTORY_SNAPSHOTS = 24;
const MAX_ANALYTICS_TIMELINE_EVENTS = 40;
const ANALYTICS_REPORT_SEVERITY_ORDER = new Map([
  ['info', 0],
  ['warning', 1],
  ['error', 2]
]);
const ANALYTICS_ALERT_THRESHOLDS = {
  failedCommands: { warning: 1, error: 3 },
  expiredLeases: { warning: 1, error: 5 },
  blockedCommands: { warning: 1, error: 3 },
  staleProviders: { warning: 1, error: 2 },
  degradedSignals: { warning: 1, error: 3 },
  failureRatio: { warning: 0.01, error: 0.05 },
  blockedRatio: { warning: 0.02, error: 0.1 },
  providerStaleRatio: { warning: 0.25, error: 0.75 }
};
const COMMAND_LEASE_EXPIRES_AFTER_MS = 120_000;
const MIN_HEALTH_PROBE_INTERVAL_MS = 5_000;
const MAX_HEALTH_PROBE_INTERVAL_MS = 900_000;
const MAX_LIFECYCLE_SCHEDULE_HORIZON_MS = 30 * 24 * 60 * 60 * 1_000;
const CLIENT_REQUEST_STALE_AFTER_MS = 30_000;
const CLIENT_HANDOFF_ACK_EXPIRES_AFTER_MS = 300_000;
const WORKSPACE_STATE_OPERATION_TYPES = new Set(['set', 'merge', 'delete', 'increment']);
const TRANSIENT_FAILURE_CODES = new Set([
  'audit-sink-unavailable',
  'ledger-write-timeout',
  'snapshot-lock-timeout',
  'workspace-state-contention'
]);
const FAILURE_CODE_POLICIES = new Map([
  ['audit-sink-unavailable', {
    category: 'dependency-unavailable',
    dependency: 'audit',
    transient: true,
    severity: 'warning',
    routeIntent: 'hosted-kernel.audit.restore-sink',
    operatorAction: 'Restore the audit sink or switch the workspace to a healthy audit sink before dispatch.',
    blocksWrites: true,
    blocksReads: false,
    degradedMode: 'audit-required-read-only',
    retryBaseMs: 2_000,
    retryMaxMs: 45_000,
    maxAttempts: 5
  }],
  ['ledger-write-timeout', {
    category: 'persistence-timeout',
    dependency: 'ledger',
    transient: true,
    severity: 'warning',
    routeIntent: 'hosted-kernel.ledger.retry-append',
    operatorAction: 'Retry ledger append with the same scoped command key; refresh replay cursor if the retry window expires.',
    blocksWrites: true,
    blocksReads: false,
    degradedMode: 'ledger-append-paused',
    retryBaseMs: 1_000,
    retryMaxMs: 60_000,
    maxAttempts: 5
  }],
  ['snapshot-lock-timeout', {
    category: 'contention',
    dependency: 'recovery',
    transient: true,
    severity: 'warning',
    routeIntent: 'hosted-kernel.recovery.retry-snapshot-lock',
    operatorAction: 'Retry after the snapshot lock backoff and keep the current recovery checkpoint pinned.',
    blocksWrites: false,
    blocksReads: false,
    degradedMode: 'recovery-lock-backoff',
    retryBaseMs: 1_500,
    retryMaxMs: 30_000,
    maxAttempts: 4
  }],
  ['workspace-state-contention', {
    category: 'state-conflict',
    dependency: 'workspace-state',
    transient: true,
    severity: 'warning',
    routeIntent: 'hosted-kernel.workspace-state.retry-conflict',
    operatorAction: 'Re-read workspace state, verify expectedRevision, then retry the command with the same idempotency key.',
    blocksWrites: true,
    blocksReads: false,
    degradedMode: 'workspace-write-contention',
    retryBaseMs: 1_000,
    retryMaxMs: 20_000,
    maxAttempts: 4
  }],
  ['provider-contract-rejected', {
    category: 'contract-mismatch',
    dependency: 'provider',
    transient: false,
    severity: 'error',
    routeIntent: 'hosted-kernel.provider.review-contract',
    operatorAction: 'Review the provider schema version and required capabilities before replaying the command.',
    blocksWrites: true,
    blocksReads: true,
    degradedMode: 'provider-contract-blocked',
    retryBaseMs: RETRY_BACKOFF_BASE_MS,
    retryMaxMs: RETRY_BACKOFF_MAX_MS,
    maxAttempts: 0
  }]
]);
const PROVIDER_SERVICE_TYPES = new Set([
  'hosted-kernel',
  'audit',
  'ledger',
  'workspace-state',
  'lifecycle',
  'recovery'
]);
const DEFAULT_SERVICE_CAPABILITIES = new Map([
  ['hosted-kernel', ['audit.write', 'ledger.append', 'status.read', 'workspace.read']],
  ['audit', ['audit.write']],
  ['ledger', ['ledger.append', 'ledger.replay']],
  ['workspace-state', ['workspace.read', 'workspace.write']],
  ['lifecycle', ['lifecycle.read', 'lifecycle.write']],
  ['recovery', ['recovery.resume', 'ledger.replay']]
]);
const COMMAND_CAPABILITY_REQUIREMENTS = new Map([
  ['kernel.status.describe', ['status.read', 'audit.write']],
  ['kernel.recovery.resume', ['recovery.resume', 'ledger.replay', 'audit.write']],
  ['kernel.lifecycle.enable', ['lifecycle.write', 'audit.write']],
  ['kernel.lifecycle.disable', ['lifecycle.write', 'audit.write']],
  ['kernel.lifecycle.schedule', ['lifecycle.write', 'audit.write']],
  ['kernel.settings.update', ['lifecycle.write', 'audit.write']],
  ['workspace.state.read', ['workspace.read', 'audit.write']],
  ['workspace.state.write', ['workspace.write', 'ledger.append', 'audit.write']]
]);
const PROVIDER_SYNC_STALE_AFTER_MS = 180_000;
const PROVIDER_SYNC_LEASE_EXPIRES_AFTER_MS = 10 * 60_000;
const PROVIDER_HANDOFF_ACK_EXPIRES_AFTER_MS = 5 * 60_000;
const TENANT_POLICY_KEYS = new Set([
  'roleBindings',
  'roles',
  'grants',
  'defaultRoleBindings',
  'defaultRoles',
  'workspaceDefaults',
  'defaults',
  'denyBindings',
  'deniedPermissions',
  'permissionDenyBindings',
  'denies',
  'workspaces'
]);
const RECOVERY_CHECKPOINT_PHASES = new Set([
  'boot',
  'hydrate-state',
  'replay-ledger',
  'resume-command',
  'dispatch',
  'commit',
  'ack',
  'complete'
]);
const RECOVERY_CHECKPOINT_STATUSES = new Set(['pending', 'completed', 'failed', 'skipped']);

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asIsoTimestamp(value, fallback) {
  if (typeof value !== 'string') {
    return fallback;
  }
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? new Date(millis).toISOString() : fallback;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function checksum(value) {
  const text = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function asTrimmedString(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function asNonNegativeInteger(value, fallback = 0) {
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function asBoundedInteger(value, fallback, min, max) {
  const candidate = asNonNegativeInteger(value, fallback);
  return Math.min(max, Math.max(min, candidate));
}

function elapsedMsSince(timestamp, now) {
  const start = Date.parse(timestamp);
  const end = Date.parse(now);
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;
}

function normalizeHealthProbes(value, now) {
  const probes = asObject(value);
  const ledgerHeartbeatAt = asIsoTimestamp(probes.ledgerHeartbeatAt, null);
  const auditHeartbeatAt = asIsoTimestamp(probes.auditHeartbeatAt, null);
  const workspaceHeartbeatAt = asIsoTimestamp(probes.workspaceHeartbeatAt, null);
  const lastProbeAt = asIsoTimestamp(probes.lastProbeAt, ledgerHeartbeatAt || auditHeartbeatAt || workspaceHeartbeatAt || now);
  const degradedReasons = [];

  for (const [name, timestamp] of [
    ['ledger', ledgerHeartbeatAt],
    ['audit', auditHeartbeatAt],
    ['workspace', workspaceHeartbeatAt]
  ]) {
    if (!timestamp) {
      degradedReasons.push(`${name}-health-missing`);
    } else if (elapsedMsSince(timestamp, now) >= HEALTH_FAILED_AFTER_MS) {
      degradedReasons.push(`${name}-health-failed`);
    } else if (elapsedMsSince(timestamp, now) >= HEALTH_STALE_AFTER_MS) {
      degradedReasons.push(`${name}-health-stale`);
    }
  }

  return {
    lastProbeAt,
    ledgerHeartbeatAt,
    auditHeartbeatAt,
    workspaceHeartbeatAt,
    degradedReasons,
    healthy: degradedReasons.length === 0
  };
}

function lifecycleTransitionDueState(at, now) {
  const atMs = Date.parse(at);
  const nowMs = Date.parse(now);
  if (!Number.isFinite(atMs) || !Number.isFinite(nowMs)) {
    return 'invalid';
  }
  if (atMs <= nowMs) {
    return 'due-now';
  }
  if (atMs - nowMs > MAX_LIFECYCLE_SCHEDULE_HORIZON_MS) {
    return 'outside-retention-window';
  }
  return 'scheduled';
}

function buildLifecycleTransitionWindow(schedule, now) {
  const transitions = [
    schedule.disableAt ? {
      type: 'scheduled-disable',
      command: 'kernel.lifecycle.disable',
      at: schedule.disableAt,
      effect: 'disable-dispatch',
      blocksDispatch: true
    } : null,
    schedule.resumeAt ? {
      type: 'scheduled-resume',
      command: 'kernel.lifecycle.enable',
      at: schedule.resumeAt,
      effect: 'enable-dispatch',
      blocksDispatch: false
    } : null,
    schedule.pauseUntil ? {
      type: 'pause-expires',
      command: 'kernel.lifecycle.enable',
      at: schedule.pauseUntil,
      effect: 'resume-from-pause',
      blocksDispatch: false
    } : null,
    schedule.nextHealthProbeAt ? {
      type: 'scheduled-health-probe',
      command: 'kernel.status.describe',
      at: schedule.nextHealthProbeAt,
      effect: 'refresh-health-probes',
      blocksDispatch: false
    } : null
  ].filter(Boolean).map((transition) => ({
    ...transition,
    dueState: lifecycleTransitionDueState(transition.at, now),
    dueInMs: Math.max(0, elapsedMsSince(now, transition.at)),
    overdueMs: Math.max(0, elapsedMsSince(transition.at, now)),
    routeIntent: `hosted-kernel.lifecycle.${transition.type}`,
    proof: checksum({ transition, now })
  }));
  const ordered = transitions.sort((left, right) => Date.parse(left.at) - Date.parse(right.at) || left.type.localeCompare(right.type));
  const actionable = ordered.filter((transition) => transition.dueState === 'due-now' || transition.dueState === 'scheduled');
  const findings = [
    ...ordered.filter((transition) => transition.dueState === 'outside-retention-window').map((transition) => ({
      code: 'lifecycle-transition-outside-retention-window',
      severity: 'warning',
      message: `${transition.type} is more than 30 days in the future and should be refreshed before dispatch relies on it.`
    })),
    ...(schedule.disableAt && schedule.resumeAt && Date.parse(schedule.disableAt) === Date.parse(schedule.resumeAt) ? [{
      code: 'lifecycle-transition-collision',
      severity: 'error',
      message: 'Lifecycle disableAt and resumeAt cannot target the same instant.'
    }] : [])
  ];

  return {
    type: 'hosted-kernel.lifecycle-transition-window.v1',
    generatedAt: now,
    transitions: ordered,
    nextTransition: actionable[0] || null,
    dueTransitions: ordered.filter((transition) => transition.dueState === 'due-now'),
    scheduledTransitions: ordered.filter((transition) => transition.dueState === 'scheduled'),
    blockedWindows: ordered
      .filter((transition) => transition.blocksDispatch)
      .map((transition) => ({
        startsAt: transition.at,
        endsAt: schedule.resumeAt || schedule.pauseUntil,
        reason: transition.type,
        proof: checksum({ transition, resumeAt: schedule.resumeAt, pauseUntil: schedule.pauseUntil })
      })),
    findings,
    proof: checksum({ ordered, now })
  };
}

function normalizeLifecycleSchedule(value, now) {
  const schedule = asObject(value);
  const pauseUntil = asIsoTimestamp(schedule.pauseUntil || schedule.disabledUntil, null);
  const resumeAt = asIsoTimestamp(schedule.resumeAt || schedule.enableAt, pauseUntil);
  const disableAt = asIsoTimestamp(schedule.disableAt, null);
  const nextHealthProbeAt = asIsoTimestamp(schedule.nextHealthProbeAt, now);
  const healthProbeIntervalMs = asBoundedInteger(
    schedule.healthProbeIntervalMs || schedule.probeIntervalMs,
    HEALTH_STALE_AFTER_MS,
    MIN_HEALTH_PROBE_INTERVAL_MS,
    MAX_HEALTH_PROBE_INTERVAL_MS
  );
  const findings = [];

  if (schedule.healthProbeIntervalMs !== undefined && healthProbeIntervalMs !== schedule.healthProbeIntervalMs) {
    findings.push({
      code: 'health-probe-interval-adjusted',
      severity: 'warning',
      message: `healthProbeIntervalMs must be between ${MIN_HEALTH_PROBE_INTERVAL_MS} and ${MAX_HEALTH_PROBE_INTERVAL_MS}.`
    });
  }

  if (pauseUntil && Date.parse(pauseUntil) <= Date.parse(now)) {
    findings.push({
      code: 'pause-until-expired',
      severity: 'warning',
      message: 'Lifecycle pauseUntil is in the past and will not block dispatch.'
    });
  }

  if (disableAt && resumeAt && Date.parse(disableAt) >= Date.parse(resumeAt)) {
    findings.push({
      code: 'invalid-disable-resume-window',
      severity: 'error',
      message: 'Lifecycle disableAt must be before resumeAt when both are supplied.'
    });
  }
  const transitionWindow = buildLifecycleTransitionWindow({
    pauseUntil,
    resumeAt,
    disableAt,
    nextHealthProbeAt,
    healthProbeIntervalMs
  }, now);

  return {
    pauseUntil,
    resumeAt,
    disableAt,
    nextHealthProbeAt,
    healthProbeIntervalMs,
    transitionWindow,
    findings: [...findings, ...transitionWindow.findings]
  };
}

function normalizeLifecycleSettings(value, now) {
  const settings = asObject(value);
  const schedule = normalizeLifecycleSchedule(settings.schedule || settings.lifecycleSchedule, now);
  const disabled = settings.enabled === false || settings.disabled === true;
  const pausedUntil = schedule.pauseUntil && Date.parse(schedule.pauseUntil) > Date.parse(now);
  const scheduledDisableActive = schedule.disableAt
    && Date.parse(schedule.disableAt) <= Date.parse(now)
    && (!schedule.resumeAt || Date.parse(schedule.resumeAt) > Date.parse(now));
  const mode = disabled || scheduledDisableActive ? 'disabled' : pausedUntil ? 'paused' : 'enabled';
  const readOnly = settings.readOnly === true || mode !== 'enabled';
  const allowedWhileDisabled = Array.isArray(settings.allowedWhileDisabled)
    ? [...new Set(settings.allowedWhileDisabled.filter((type) => COMMAND_EFFECTS.has(type)))]
    : ['kernel.status.describe', 'kernel.lifecycle.enable', 'kernel.settings.update'];
  const revision = asTrimmedString(settings.revision || settings.settingsRevision, checksum({
    enabled: !disabled,
    readOnly,
    schedule: {
      pauseUntil: schedule.pauseUntil,
      resumeAt: schedule.resumeAt,
      disableAt: schedule.disableAt,
      healthProbeIntervalMs: schedule.healthProbeIntervalMs
    }
  }));

  return {
    version: 1,
    mode,
    enabled: mode === 'enabled',
    readOnly,
    revision,
    reason: asTrimmedString(settings.reason, disabled ? 'operator-disabled' : scheduledDisableActive ? 'scheduled-disable' : pausedUntil ? 'scheduled-pause' : null),
    allowedWhileDisabled,
    schedule,
    validationFindings: schedule.findings,
    proof: checksum({
      mode,
      readOnly,
      revision,
      allowedWhileDisabled,
      schedule
    })
  };
}

function lifecycleNextAction(settings, now) {
  const dueTransition = settings.schedule.transitionWindow?.dueTransitions?.find((transition) => transition.type !== 'scheduled-health-probe');
  if (dueTransition) {
    return {
      type: dueTransition.type,
      dueAt: dueTransition.at,
      command: dueTransition.command,
      reason: dueTransition.effect,
      routeIntent: dueTransition.routeIntent,
      proof: checksum({ transition: dueTransition, revision: settings.revision })
    };
  }

  if (settings.mode === 'disabled') {
    return {
      type: 'await-enable-command',
      dueAt: settings.schedule.resumeAt,
      command: 'kernel.lifecycle.enable',
      reason: settings.reason || 'operator-disabled',
      proof: checksum({ mode: settings.mode, revision: settings.revision, command: 'kernel.lifecycle.enable' })
    };
  }

  if (settings.mode === 'paused') {
    return {
      type: 'resume-scheduled-dispatch',
      dueAt: settings.schedule.resumeAt || settings.schedule.pauseUntil,
      command: 'kernel.lifecycle.enable',
      reason: settings.reason || 'scheduled-pause',
      proof: checksum({ mode: settings.mode, dueAt: settings.schedule.resumeAt || settings.schedule.pauseUntil })
    };
  }

  if (settings.schedule.disableAt && Date.parse(settings.schedule.disableAt) > Date.parse(now)) {
    return {
      type: 'disable-at-scheduled-time',
      dueAt: settings.schedule.disableAt,
      command: 'kernel.lifecycle.disable',
      reason: 'scheduled-disable',
      proof: checksum({ mode: settings.mode, dueAt: settings.schedule.disableAt })
    };
  }

  return {
    type: 'probe-health',
    dueAt: settings.schedule.nextHealthProbeAt,
    command: 'kernel.status.describe',
    reason: 'scheduled-health-probe',
    proof: checksum({ mode: settings.mode, dueAt: settings.schedule.nextHealthProbeAt, interval: settings.schedule.healthProbeIntervalMs })
  };
}

function buildLifecycleTransitionReceipt(command, currentSettings, proposedSettings, changedFields, now) {
  const transitionWindow = proposedSettings.schedule.transitionWindow;
  const nextTransition = transitionWindow.nextTransition;
  const receipt = {
    type: 'hosted-kernel.lifecycle-transition-receipt.v1',
    commandType: command.type,
    generatedAt: now,
    previousRevision: currentSettings.revision,
    proposedRevision: proposedSettings.revision,
    lifecycleModeBefore: currentSettings.mode,
    lifecycleModeAfter: proposedSettings.mode,
    immediateEffect: proposedSettings.mode !== currentSettings.mode || changedFields.some((change) => change.field === 'readOnly')
      ? 'mode-or-readonly-updated'
      : changedFields.length
        ? 'settings-updated'
        : 'no-effective-change',
    nextTransition: nextTransition ? {
      type: nextTransition.type,
      at: nextTransition.at,
      dueState: nextTransition.dueState,
      command: nextTransition.command,
      routeIntent: nextTransition.routeIntent,
      proof: nextTransition.proof
    } : null,
    dueTransitions: transitionWindow.dueTransitions.map((transition) => ({
      type: transition.type,
      at: transition.at,
      command: transition.command,
      routeIntent: transition.routeIntent,
      proof: transition.proof
    })),
    blockedWindows: transitionWindow.blockedWindows,
    changedFields: changedFields.map((change) => change.field),
    auditSubject: `${command.scope.tenantId}/${command.scope.workspaceId}/${command.type}`,
    routeIntent: 'hosted-kernel.lifecycle.transition-receipt'
  };

  return {
    ...receipt,
    proof: checksum(receipt)
  };
}

function lifecycleGateForCommand(settings, command) {
  const alwaysAllowed = command.type === 'kernel.status.describe' || command.type === 'kernel.lifecycle.enable';
  const allowedByException = settings.allowedWhileDisabled.includes(command.type);
  const blocked = settings.mode !== 'enabled' && !alwaysAllowed && !allowedByException;
  const readOnlyBlocked = settings.readOnly && COMMAND_EFFECTS.get(command.type)?.mutatesWorkspace === true;

  return {
    mode: settings.mode,
    settingsRevision: settings.revision,
    dispatchEnabled: settings.mode === 'enabled',
    commandAllowed: !blocked && !readOnlyBlocked,
    readOnly: settings.readOnly,
    blockedReason: blocked
      ? `lifecycle-${settings.mode}`
      : readOnlyBlocked
        ? 'lifecycle-read-only'
        : null,
    nextAction: lifecycleNextAction(settings, command.issuedAt),
    proof: checksum({
      commandType: command.type,
      mode: settings.mode,
      readOnly: settings.readOnly,
      revision: settings.revision
    })
  };
}

function changedLifecycleFields(current, proposed) {
  const comparisons = [
    ['mode', current.mode, proposed.mode],
    ['enabled', current.enabled, proposed.enabled],
    ['readOnly', current.readOnly, proposed.readOnly],
    ['reason', current.reason, proposed.reason],
    ['allowedWhileDisabled', current.allowedWhileDisabled.join('|'), proposed.allowedWhileDisabled.join('|')],
    ['schedule.pauseUntil', current.schedule.pauseUntil, proposed.schedule.pauseUntil],
    ['schedule.resumeAt', current.schedule.resumeAt, proposed.schedule.resumeAt],
    ['schedule.disableAt', current.schedule.disableAt, proposed.schedule.disableAt],
    ['schedule.nextHealthProbeAt', current.schedule.nextHealthProbeAt, proposed.schedule.nextHealthProbeAt],
    ['schedule.healthProbeIntervalMs', current.schedule.healthProbeIntervalMs, proposed.schedule.healthProbeIntervalMs]
  ];

  return comparisons
    .filter(([, before, after]) => before !== after)
    .map(([field, before, after]) => ({ field, before, after }));
}

function invalidLifecycleCommandAllowList(payload) {
  const allowed = Array.isArray(payload.allowedWhileDisabled) ? payload.allowedWhileDisabled : [];
  return [...new Set(allowed
    .filter((type) => typeof type !== 'string' || !COMMAND_EFFECTS.has(type.trim()))
    .map((type) => String(type).trim() || '<empty>'))].sort();
}

function lifecyclePatchForCommand(command, currentSettings, now) {
  const payload = asObject(command.payload);
  const currentSchedule = currentSettings.schedule || {};

  if (command.type === 'kernel.lifecycle.enable') {
    return {
      enabled: true,
      disabled: false,
      readOnly: payload.readOnly === true,
      reason: asTrimmedString(payload.reason, 'operator-enabled'),
      allowedWhileDisabled: Array.isArray(payload.allowedWhileDisabled)
        ? payload.allowedWhileDisabled
        : currentSettings.allowedWhileDisabled,
      schedule: {
        ...currentSchedule,
        pauseUntil: null,
        resumeAt: asIsoTimestamp(payload.resumeAt || payload.enableAt, now),
        nextHealthProbeAt: asIsoTimestamp(payload.nextHealthProbeAt, now)
      }
    };
  }

  if (command.type === 'kernel.lifecycle.disable') {
    return {
      enabled: false,
      disabled: true,
      readOnly: true,
      reason: asTrimmedString(payload.reason, 'operator-disabled'),
      allowedWhileDisabled: Array.isArray(payload.allowedWhileDisabled)
        ? payload.allowedWhileDisabled
        : currentSettings.allowedWhileDisabled,
      schedule: {
        ...currentSchedule,
        pauseUntil: asIsoTimestamp(payload.pauseUntil || payload.disabledUntil, currentSchedule.pauseUntil),
        resumeAt: asIsoTimestamp(payload.resumeAt || payload.enableAt, currentSchedule.resumeAt),
        disableAt: asIsoTimestamp(payload.disableAt, currentSchedule.disableAt),
        nextHealthProbeAt: asIsoTimestamp(payload.nextHealthProbeAt, currentSchedule.nextHealthProbeAt || now)
      }
    };
  }

  if (command.type === 'kernel.lifecycle.schedule') {
    const schedulePayload = asObject(payload.schedule || payload.lifecycleSchedule);
    return {
      enabled: currentSettings.enabled,
      disabled: currentSettings.mode === 'disabled',
      readOnly: currentSettings.readOnly,
      reason: asTrimmedString(payload.reason, currentSettings.reason),
      allowedWhileDisabled: currentSettings.allowedWhileDisabled,
      schedule: {
        ...currentSchedule,
        ...schedulePayload
      }
    };
  }

  if (command.type === 'kernel.settings.update') {
    const settingsPayload = asObject(payload.settings || payload.lifecycleSettings);
    const schedulePayload = asObject(settingsPayload.schedule || settingsPayload.lifecycleSchedule);
    const {
      revision,
      proof,
      validationFindings,
      version,
      ...currentMutableSettings
    } = currentSettings;
    return {
      ...currentMutableSettings,
      ...settingsPayload,
      schedule: {
        ...currentSchedule,
        ...schedulePayload
      },
      ...(settingsPayload.revision || settingsPayload.settingsRevision ? { revision: settingsPayload.revision || settingsPayload.settingsRevision } : {})
    };
  }

  return null;
}

function buildLifecycleCommandPlan(command, currentSettings, now) {
  const patch = lifecyclePatchForCommand(command, currentSettings, now);
  if (!patch) {
    return null;
  }

  const proposed = normalizeLifecycleSettings(patch, now);
  const changedFields = changedLifecycleFields(currentSettings, proposed);
  const invalidAllowList = invalidLifecycleCommandAllowList(asObject(command.payload.settings || command.payload.lifecycleSettings || command.payload));
  const validationFindings = [
    ...proposed.validationFindings,
    ...(invalidAllowList.length ? [{
      code: 'invalid-allowed-while-disabled-command',
      severity: 'error',
      message: `allowedWhileDisabled contains unsupported command types: ${invalidAllowList.join(', ')}.`
    }] : []),
    ...(changedFields.length ? [] : [{
      code: 'no-effective-lifecycle-change',
      severity: 'warning',
      message: `${command.type} does not change lifecycle settings from the current revision.`
    }])
  ];
  const nextActionAfterCommit = lifecycleNextAction(proposed, now);
  const transitionReceipt = buildLifecycleTransitionReceipt(command, currentSettings, proposed, changedFields, now);
  const auditEvent = {
    type: 'hosted-kernel.lifecycle-settings.commit',
    commandType: command.type,
    previousRevision: currentSettings.revision,
    proposedRevision: proposed.revision,
    changedFields: changedFields.map((change) => change.field),
    routeIntent: 'hosted-kernel.lifecycle.commit-settings',
    proof: checksum({
      commandType: command.type,
      previousRevision: currentSettings.revision,
      proposedRevision: proposed.revision,
      changedFields
    })
  };

  return {
    type: 'hosted-kernel.lifecycle-command-plan.v1',
    commandType: command.type,
    generatedAt: now,
    commitRequired: changedFields.length > 0,
    previous: {
      mode: currentSettings.mode,
      enabled: currentSettings.enabled,
      readOnly: currentSettings.readOnly,
      reason: currentSettings.reason,
      revision: currentSettings.revision,
      schedule: currentSettings.schedule,
      proof: currentSettings.proof
    },
    proposed: {
      mode: proposed.mode,
      enabled: proposed.enabled,
      readOnly: proposed.readOnly,
      reason: proposed.reason,
      revision: proposed.revision,
      allowedWhileDisabled: proposed.allowedWhileDisabled,
      schedule: proposed.schedule,
      transitionWindow: proposed.schedule.transitionWindow,
      proof: proposed.proof
    },
    changedFields,
    validationFindings,
    nextActionAfterCommit,
    transitionReceipt,
    auditEvent,
    proof: checksum({
      commandType: command.type,
      currentRevision: currentSettings.revision,
      proposedRevision: proposed.revision,
      changedFields,
      nextActionAfterCommit,
      transitionReceipt
    })
  };
}

function failurePolicyForCode(code, failure) {
  const source = asObject(failure);
  const configured = FAILURE_CODE_POLICIES.get(code) || {};
  const dependency = asTrimmedString(source.dependency || source.service || configured.dependency, 'hosted-kernel');
  const category = asTrimmedString(source.category || configured.category, 'unclassified-failure');
  const routeIntent = asTrimmedString(source.routeIntent || configured.routeIntent, 'hosted-kernel.failure.operator-handoff');
  const operatorAction = asTrimmedString(
    source.operatorAction || source.action || configured.operatorAction,
    'Inspect the hosted-kernel failure details and decide whether replay is safe.'
  );
  const transient = source.transient === true || (source.transient !== false && (configured.transient === true || TRANSIENT_FAILURE_CODES.has(code)));

  return {
    category,
    dependency,
    transient,
    severity: source.severity === 'warning' || source.severity === 'error'
      ? source.severity
      : configured.severity || (transient ? 'warning' : 'error'),
    routeIntent,
    operatorAction,
    blocksWrites: source.blocksWrites === true || configured.blocksWrites === true || (!transient && code !== null),
    blocksReads: source.blocksReads === true || configured.blocksReads === true,
    degradedMode: asTrimmedString(source.degradedMode || configured.degradedMode, transient ? `${dependency}-retry-backoff` : `${dependency}-operator-handoff`),
    retryBaseMs: asBoundedInteger(source.retryBaseMs, configured.retryBaseMs || RETRY_BACKOFF_BASE_MS, 250, RETRY_BACKOFF_MAX_MS),
    retryMaxMs: asBoundedInteger(source.retryMaxMs, configured.retryMaxMs || RETRY_BACKOFF_MAX_MS, 1_000, RETRY_BACKOFF_MAX_MS),
    maxAttempts: asBoundedInteger(source.maxRetryAttempts ?? source.maxAttempts, configured.maxAttempts ?? MAX_RETRY_ATTEMPTS, 0, MAX_RETRY_ATTEMPTS)
  };
}

function normalizeFailureState(value, now) {
  const failure = asObject(value);
  const code = asTrimmedString(failure.code, null);
  const lastFailureAt = asIsoTimestamp(failure.lastFailureAt || failure.at, code ? now : null);
  const policy = failurePolicyForCode(code, failure);
  const retryAttempts = asNonNegativeInteger(failure.retryAttempts, asNonNegativeInteger(failure.attempts, 0));
  const transient = code ? policy.transient : false;
  const maxAttempts = code ? policy.maxAttempts : MAX_RETRY_ATTEMPTS;
  const retryable = Boolean(code && transient && retryAttempts < maxAttempts);

  return {
    type: 'hosted-kernel-failure-state.v1',
    code,
    message: asTrimmedString(failure.message, code ? 'Hosted kernel command failed before completion.' : null),
    lastFailureAt,
    retryAttempts,
    category: code ? policy.category : null,
    dependency: code ? policy.dependency : null,
    severity: code ? policy.severity : 'info',
    transient,
    retryable,
    degradedMode: code ? policy.degradedMode : null,
    routeIntent: code ? policy.routeIntent : null,
    operatorAction: code ? policy.operatorAction : null,
    blocksWrites: Boolean(code && policy.blocksWrites),
    blocksReads: Boolean(code && policy.blocksReads),
    retry: {
      attempts: retryAttempts,
      maxAttempts,
      remainingAttempts: Math.max(0, maxAttempts - retryAttempts),
      baseMs: policy.retryBaseMs,
      maxMs: policy.retryMaxMs
    },
    proof: checksum({ code, lastFailureAt, retryAttempts, policy })
  };
}

function retryBackoffForFailure(failureState, now) {
  if (!failureState.retryable) {
    return {
      retryable: false,
      retryAfterMs: 0,
      nextRetryAt: null,
      attempt: failureState.retryAttempts,
      maxAttempts: failureState.retry?.maxAttempts ?? MAX_RETRY_ATTEMPTS,
      budgetRemaining: failureState.retry?.remainingAttempts ?? 0,
      retryWindow: null
    };
  }

  const retryAfterMs = Math.min(
    failureState.retry?.maxMs ?? RETRY_BACKOFF_MAX_MS,
    (failureState.retry?.baseMs ?? RETRY_BACKOFF_BASE_MS) * (2 ** failureState.retryAttempts)
  );
  const lastFailureMillis = Date.parse(failureState.lastFailureAt || now);
  const nextRetryAt = new Date((Number.isFinite(lastFailureMillis) ? lastFailureMillis : Date.parse(now)) + retryAfterMs).toISOString();
  const retryWindow = {
    openedAt: failureState.lastFailureAt || now,
    nextRetryAt,
    expiresAfterAttempt: failureState.retry?.maxAttempts ?? MAX_RETRY_ATTEMPTS,
    routeIntent: failureState.routeIntent || 'hosted-kernel.failure.retry'
  };

  return {
    retryable: true,
    retryAfterMs,
    nextRetryAt,
    attempt: failureState.retryAttempts + 1,
    maxAttempts: failureState.retry?.maxAttempts ?? MAX_RETRY_ATTEMPTS,
    budgetRemaining: Math.max(0, (failureState.retry?.maxAttempts ?? MAX_RETRY_ATTEMPTS) - failureState.retryAttempts - 1),
    retryWindow,
    proof: checksum({ failureState, retryAfterMs, nextRetryAt, retryWindow })
  };
}

function buildFailureRemediationContract({ failureState, retryBackoff, now, status }) {
  if (!failureState.code) {
    return {
      type: 'hosted-kernel.failure-remediation.v1',
      active: false,
      generatedAt: now,
      status,
      actionRequired: false,
      routeIntent: null,
      dependency: null,
      summary: 'No hosted-kernel failure remediation is active.',
      retry: retryBackoff,
      proof: checksum({ active: false, status, now })
    };
  }

  const retryable = retryBackoff.retryable;
  const commandGate = {
    readsAllowed: !failureState.blocksReads,
    writesAllowed: !failureState.blocksWrites && retryable,
    allowedCommands: failureState.blocksReads
      ? ['kernel.status.describe', 'kernel.recovery.resume']
      : failureState.blocksWrites
        ? ['kernel.status.describe', 'workspace.state.read', 'kernel.recovery.resume']
        : ['kernel.status.describe', 'workspace.state.read', 'workspace.state.write', 'kernel.recovery.resume']
  };
  const contract = {
    type: 'hosted-kernel.failure-remediation.v1',
    active: true,
    generatedAt: now,
    status,
    failureCode: failureState.code,
    category: failureState.category,
    dependency: failureState.dependency,
    severity: retryable ? 'warning' : failureState.severity,
    transient: failureState.transient,
    actionRequired: !retryable,
    degradedMode: failureState.degradedMode,
    routeIntent: retryable ? 'hosted-kernel.failure.retry' : failureState.routeIntent,
    operatorAction: retryable
      ? `Retry ${failureState.code} at ${retryBackoff.nextRetryAt} before escalating to ${failureState.routeIntent}.`
      : failureState.operatorAction,
    commandGate,
    retry: retryBackoff,
    auditSubject: `${failureState.dependency}:${failureState.code}`,
    summary: retryable
      ? `${failureState.code} is retryable with ${retryBackoff.budgetRemaining} retry attempt(s) remaining.`
      : `${failureState.code} requires operator action through ${failureState.routeIntent}.`
  };

  return {
    ...contract,
    proof: checksum(contract)
  };
}

function actionableErrorForRecovery({ status, boundary, command, failureState, retryBackoff, health, providerNegotiation }) {
  if (!boundary.allowed) {
    return {
      code: `sdk-types.${boundary.denialReason}`,
      severity: 'error',
      retryable: false,
      message: `Command ${command.type} cannot run in workspace ${boundary.workspaceId}.`,
      action: boundary.denialReason === 'missing-permission'
        ? `Grant ${boundary.missingPermissions.join(', ')} to ${boundary.actorId} or use a narrower command.`
        : 'Check the tenant/workspace scope before replaying this command.',
      proof: checksum({ boundary, commandType: command.type })
    };
  }

  if (failureState.code) {
    return {
      code: `sdk-types.${failureState.code}`,
      severity: retryBackoff.retryable ? 'warning' : 'error',
      retryable: retryBackoff.retryable,
      message: failureState.message,
      action: retryBackoff.retryable
        ? `Retry after ${retryBackoff.retryAfterMs}ms with idempotency key ${command.idempotencyKey}.`
        : failureState.operatorAction || 'Stop automatic replay and hand off the failure to operator recovery.',
      category: failureState.category,
      dependency: failureState.dependency,
      routeIntent: retryBackoff.retryable ? 'hosted-kernel.failure.retry' : failureState.routeIntent,
      degradedMode: failureState.degradedMode,
      retryWindow: retryBackoff.retryWindow,
      proof: checksum({ failureState, retryBackoff, commandKey: command.idempotencyKey })
    };
  }

  if (providerNegotiation && !providerNegotiation.ready) {
    return {
      code: `sdk-types.${providerNegotiation.denialReason}`,
      severity: providerNegotiation.externalHandoff.required ? 'warning' : 'error',
      retryable: providerNegotiation.sync.stale,
      message: `No active provider satisfies ${providerNegotiation.requiredCapabilities.join(', ')} for ${command.type}.`,
      action: providerNegotiation.externalHandoff.required
        ? `Hand off to ${providerNegotiation.externalHandoff.target} with provider sync cursor ${providerNegotiation.externalHandoff.syncCursor}.`
        : `Register or enable a provider with ${providerNegotiation.requiredCapabilities.join(', ')} before replaying this command.`,
      proof: checksum({
        providerNegotiation,
        commandKey: command.idempotencyKey,
        scopeKey: command.scope.scopeKey
      })
    };
  }

  if (status === 'degraded' || health.degradedReasons.length) {
    return {
      code: 'sdk-types.degraded-health',
      severity: status === 'failed' ? 'error' : 'warning',
      retryable: true,
      message: 'Hosted kernel health is degraded for this workspace command.',
      action: `Refresh health probes for ${health.degradedReasons.join(', ') || 'kernel dependencies'} before promoting to ready.`,
      proof: checksum({ status, health, commandKey: command.idempotencyKey })
    };
  }

  return null;
}

function healthDependencyFromReason(reason) {
  const dependency = asTrimmedString(reason, '').split('-health-')[0];
  return dependency || 'hosted-kernel';
}

function buildOperationalHealthPlan({ status, health, failureState, retryBackoff, lifecycleSettings, providerRegistry, now }) {
  const degradedReasons = [...new Set(health.degradedReasons)].sort();
  const failureRemediation = buildFailureRemediationContract({ failureState, retryBackoff, now, status });
  const failedDependencies = [...new Set(degradedReasons
    .filter((reason) => reason.endsWith('-failed'))
    .map(healthDependencyFromReason))].sort();
  const staleDependencies = [...new Set(degradedReasons
    .filter((reason) => reason.endsWith('-stale') || reason.endsWith('-missing'))
    .map(healthDependencyFromReason))].sort();
  const staleProviders = providerRegistry.providers
    .filter((provider) => provider.syncStale)
    .map((provider) => ({
      providerId: provider.providerId,
      service: provider.service,
      lastSyncedAt: provider.lastSyncedAt,
      syncCursor: provider.syncCursor,
      capabilities: provider.capabilities,
      proof: provider.proof
    }));
  const nextProbeBaseMs = Date.parse(health.lastProbeAt || now);
  const nextProbeAt = asIsoTimestamp(
    lifecycleSettings.schedule.nextHealthProbeAt,
    new Date((Number.isFinite(nextProbeBaseMs) ? nextProbeBaseMs : Date.parse(now)) + lifecycleSettings.schedule.healthProbeIntervalMs).toISOString()
  );
  const probeActions = degradedReasons.map((reason) => {
    const dependency = healthDependencyFromReason(reason);
    const terminal = reason.endsWith('-failed');
    return {
      type: terminal ? 'replace-or-recover-dependency' : 'refresh-health-probe',
      dependency,
      reason,
      routeIntent: terminal ? 'hosted-kernel.health.recover-dependency' : 'hosted-kernel.health.refresh-probe',
      dueAt: terminal ? now : nextProbeAt,
      blocksWrites: dependency === 'workspace' || dependency === 'ledger' || terminal,
      proof: checksum({ dependency, reason, terminal, nextProbeAt })
    };
  });
  const providerSyncActions = staleProviders.map((provider) => ({
    type: 'refresh-provider-sync',
    providerId: provider.providerId,
    service: provider.service,
    routeIntent: 'hosted-kernel.provider.refresh-sync',
    dueAt: now,
    syncCursor: provider.syncCursor,
    proof: checksum({ providerId: provider.providerId, syncCursor: provider.syncCursor, lastSyncedAt: provider.lastSyncedAt })
  }));
  const retryAction = failureState.code
    ? {
      type: retryBackoff.retryable ? 'schedule-failure-retry' : 'handoff-terminal-failure',
      failureCode: failureState.code,
      category: failureState.category,
      dependency: failureState.dependency,
      retryable: retryBackoff.retryable,
      dueAt: retryBackoff.nextRetryAt,
      attempt: retryBackoff.attempt,
      maxAttempts: retryBackoff.maxAttempts,
      budgetRemaining: retryBackoff.budgetRemaining,
      routeIntent: failureRemediation.routeIntent,
      degradedMode: failureRemediation.degradedMode,
      operatorAction: failureRemediation.operatorAction,
      commandGate: failureRemediation.commandGate,
      proof: checksum({ failureState, retryBackoff, remediationProof: failureRemediation.proof })
    }
    : null;
  const writeSuspended = failedDependencies.length > 0
    || staleDependencies.includes('ledger')
    || staleDependencies.includes('workspace')
    || failureRemediation.commandGate?.writesAllowed === false
    || (failureState.code && !retryBackoff.retryable);
  const readSuspended = failedDependencies.includes('workspace') || failureRemediation.commandGate?.readsAllowed === false;
  const mode = failedDependencies.length || (failureState.code && !retryBackoff.retryable)
    ? 'terminal-recovery'
    : degradedReasons.length || staleProviders.length || failureState.code
      ? 'degraded-remediation'
      : 'nominal';
  const plan = {
    type: 'hosted-kernel.operational-health-plan.v1',
    generatedAt: now,
    status,
    mode,
    healthy: mode === 'nominal',
    degradedReasons,
    failedDependencies,
    staleDependencies,
    staleProviders,
    nextProbeAt,
    writeSuspended,
    readSuspended,
    failureRemediation,
    allowedDuringDegraded: failureRemediation.active
      ? failureRemediation.commandGate.allowedCommands
      : readSuspended ? ['kernel.status.describe'] : ['kernel.status.describe', 'workspace.state.read'],
    actions: [...probeActions, ...providerSyncActions, ...(retryAction ? [retryAction] : [])],
    operatorSummary: mode === 'nominal'
      ? 'Hosted-kernel dependencies are current and command processing can proceed.'
      : writeSuspended
        ? failureRemediation.active
          ? failureRemediation.summary
          : 'Workspace writes are suspended until failed dependencies or terminal failures are recovered.'
        : 'Hosted-kernel is degraded; reads may continue while probes or provider sync are refreshed.'
  };

  return {
    ...plan,
    proof: checksum(plan)
  };
}

function normalizeScope(source = {}, payload = {}) {
  const rawScope = asObject(source.scope);
  const payloadScope = asObject(payload.scope);
  const tenantId = asTrimmedString(rawScope.tenantId, asTrimmedString(payloadScope.tenantId, 'tenant:default'));
  const workspaceId = asTrimmedString(rawScope.workspaceId, asTrimmedString(payloadScope.workspaceId, 'workspace:default'));
  const actorId = asTrimmedString(rawScope.actorId, asTrimmedString(payloadScope.actorId, 'actor:system'));

  return {
    tenantId,
    workspaceId,
    actorId,
    scopeKey: checksum({ tenantId, workspaceId })
  };
}

function normalizePermissions(value) {
  const permissions = Array.isArray(value) ? value : [];
  return [...new Set(permissions
    .filter((permission) => typeof permission === 'string')
    .map((permission) => permission.trim())
    .filter((permission) => HOSTED_KERNEL_PERMISSIONS.has(permission)))]
    .sort();
}

function actorBindingKeys(actorId) {
  return ['*', 'actor:*', actorId];
}

function permissionsForActor(bindings, actorId) {
  const normalized = asObject(bindings);
  return actorBindingKeys(actorId).flatMap((key) => normalizePermissions(normalized[key]));
}

function normalizeRoleBindings(value) {
  const bindings = asObject(value);
  return Object.keys(bindings).sort().reduce((normalized, actorId) => {
    const actorPermissions = normalizePermissions(bindings[actorId]);
    if (actorPermissions.length) {
      normalized[actorId] = actorPermissions;
    }
    return normalized;
  }, {});
}

function normalizeBoundaryPolicy(value) {
  const policy = asObject(value);
  const roleBindings = normalizeRoleBindings(policy.roleBindings || policy.roles || policy.grants);
  const defaultRoleBindings = normalizeRoleBindings(
    policy.defaultRoleBindings
    || policy.defaultRoles
    || policy.workspaceDefaults
    || policy.defaults
  );
  const denyBindings = normalizeRoleBindings(
    policy.denyBindings
    || policy.deniedPermissions
    || policy.permissionDenyBindings
    || policy.denies
  );

  return {
    roleBindings,
    defaultRoleBindings,
    denyBindings,
    proof: checksum({ roleBindings, defaultRoleBindings, denyBindings })
  };
}

function workspaceMapForTenant(tenant) {
  const explicitWorkspaces = asObject(tenant.workspaces);
  if (Object.keys(explicitWorkspaces).length) {
    return explicitWorkspaces;
  }

  return Object.keys(tenant).sort().reduce((workspaces, key) => {
    if (!TENANT_POLICY_KEYS.has(key)) {
      workspaces[key] = tenant[key];
    }
    return workspaces;
  }, {});
}

function permissionGrantsForScope(tenant, workspace, actorId) {
  const sources = [
    ['tenant-default', permissionsForActor(tenant.defaultRoleBindings, actorId)],
    ['tenant-role', permissionsForActor(tenant.roleBindings, actorId)],
    ['workspace-default', permissionsForActor(workspace.defaultRoleBindings, actorId)],
    ['workspace-role', permissionsForActor(workspace.roleBindings, actorId)]
  ];

  return sources.flatMap(([source, permissions]) => permissions.map((permission) => ({ source, permission })));
}

function permissionDeniesForScope(tenant, workspace, actorId) {
  const sources = [
    ['tenant-deny', permissionsForActor(tenant.denyBindings, actorId)],
    ['workspace-deny', permissionsForActor(workspace.denyBindings, actorId)]
  ];

  return sources.flatMap(([source, permissions]) => permissions.map((permission) => ({ source, permission })));
}

function summarizePermissionSources(entries) {
  return entries.reduce((summary, entry) => {
    summary[entry.permission] = [...new Set([...(summary[entry.permission] || []), entry.source])].sort();
    return summary;
  }, {});
}

function normalizeWorkspaceScopes(value, fallbackScope) {
  const scopes = asObject(value);
  const normalized = {};
  for (const tenantId of Object.keys(scopes).sort()) {
    const tenant = asObject(scopes[tenantId]);
    const tenantPolicy = normalizeBoundaryPolicy(tenant);
    const workspaces = workspaceMapForTenant(tenant);
    const normalizedWorkspaces = {};
    for (const workspaceId of Object.keys(workspaces).sort()) {
      const workspace = asObject(workspaces[workspaceId]);
      const workspacePolicy = normalizeBoundaryPolicy(workspace);
      normalizedWorkspaces[workspaceId] = {
        status: typeof workspace.status === 'string' && workspace.status === 'suspended' ? 'suspended' : 'active',
        roleBindings: workspacePolicy.roleBindings,
        defaultRoleBindings: workspacePolicy.defaultRoleBindings,
        denyBindings: workspacePolicy.denyBindings,
        auditSink: asTrimmedString(workspace.auditSink, null),
        permissionPolicyProof: workspacePolicy.proof
      };
    }
    if (Object.keys(normalizedWorkspaces).length) {
      normalized[tenantId] = {
        roleBindings: tenantPolicy.roleBindings,
        defaultRoleBindings: tenantPolicy.defaultRoleBindings,
        denyBindings: tenantPolicy.denyBindings,
        permissionPolicyProof: tenantPolicy.proof,
        workspaces: normalizedWorkspaces
      };
    }
  }
  const hasConfiguredScopes = Object.keys(normalized).length > 0;

  if (!hasConfiguredScopes && !normalized[fallbackScope.tenantId]?.workspaces?.[fallbackScope.workspaceId]) {
    normalized[fallbackScope.tenantId] = normalized[fallbackScope.tenantId] || {
      roleBindings: {},
      defaultRoleBindings: {},
      denyBindings: {},
      permissionPolicyProof: checksum({ fallback: true, tenantId: fallbackScope.tenantId }),
      workspaces: {}
    };
    normalized[fallbackScope.tenantId].workspaces[fallbackScope.workspaceId] = {
      status: 'active',
      roleBindings: {
        [fallbackScope.actorId]: ['audit:emit', 'kernel:read', 'workspace:read']
      },
      defaultRoleBindings: {},
      denyBindings: {},
      auditSink: null,
      permissionPolicyProof: checksum({ fallback: true, workspaceId: fallbackScope.workspaceId })
    };
  }

  return normalized;
}

function resolveWorkspaceBoundary(workspaceScopes, scope, commandType) {
  const tenant = workspaceScopes[scope.tenantId];
  const workspace = tenant?.workspaces?.[scope.workspaceId];
  const required = COMMAND_PERMISSION_REQUIREMENTS.get(commandType) || ['kernel:read'];
  const tenantKnown = Boolean(tenant);
  const workspaceKnown = Boolean(workspace);
  const suspended = workspace?.status === 'suspended';
  const grantEntries = workspaceKnown ? permissionGrantsForScope(tenant, workspace, scope.actorId) : [];
  const denyEntries = workspaceKnown ? permissionDeniesForScope(tenant, workspace, scope.actorId) : [];
  const denied = [...new Set(denyEntries.map((entry) => entry.permission))].sort();
  const granted = [...new Set(grantEntries.map((entry) => entry.permission))]
    .filter((permission) => !denied.includes(permission))
    .sort();
  const explicitlyDeniedRequired = required.filter((permission) => denied.includes(permission));
  const missing = required.filter((permission) => !granted.includes(permission));
  const allowed = tenantKnown && workspaceKnown && !suspended && missing.length === 0;
  const denialReason = allowed
    ? null
    : !tenantKnown
      ? 'unknown-tenant'
      : !workspaceKnown
        ? 'unknown-workspace'
        : suspended
          ? 'workspace-suspended'
          : explicitlyDeniedRequired.length
            ? 'permission-explicitly-denied'
            : 'missing-permission';
  const auditSink = workspace?.auditSink || `audit://${scope.tenantId}/${scope.workspaceId}`;
  const boundary = {
    type: 'hosted-kernel-permission-boundary.v1',
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    actorId: scope.actorId,
    scopeKey: scope.scopeKey,
    tenantKnown,
    workspaceKnown,
    workspaceStatus: workspace?.status || 'missing',
    requiredPermissions: required,
    grantedPermissions: granted,
    deniedPermissions: denied,
    missingPermissions: missing,
    explicitlyDeniedRequired,
    grantSources: summarizePermissionSources(grantEntries),
    denySources: summarizePermissionSources(denyEntries),
    inheritedFromTenant: grantEntries.some((entry) => entry.source.startsWith('tenant-')),
    defaultGrantApplied: grantEntries.some((entry) => entry.source.endsWith('default')),
    allowed,
    denialReason,
    auditSink,
    auditHandoff: {
      required: !allowed,
      sink: auditSink,
      reason: denialReason,
      routeIntent: 'hosted-kernel.permission-boundary.audit',
      subject: `${scope.tenantId}/${scope.workspaceId}/${scope.actorId}`,
      evidence: {
        commandType,
        requiredPermissions: required,
        missingPermissions: missing,
        explicitlyDeniedRequired
      }
    }
  };

  return {
    ...boundary,
    proof: checksum(boundary)
  };
}

function normalizeCommand(command = {}, now) {
  const source = asObject(command);
  const type = typeof source.type === 'string' && source.type.trim() ? source.type.trim() : 'kernel.status.describe';
  const payload = asObject(source.payload);
  const scope = normalizeScope(source, payload);
  const idempotencyKey = typeof source.idempotencyKey === 'string' && source.idempotencyKey.trim()
    ? source.idempotencyKey.trim()
    : checksum({ type, payload, scopeKey: scope.scopeKey });

  return {
    type,
    idempotencyKey,
    issuedAt: asIsoTimestamp(source.issuedAt, now),
    payload,
    scope,
    restartSafe: source.restartSafe !== false
  };
}

function normalizeTraceContext(value, command, now) {
  const trace = asObject(value);
  const correlationId = asTrimmedString(trace.correlationId, asTrimmedString(trace.traceId, command.idempotencyKey));
  const spanId = asTrimmedString(trace.spanId, checksum({ correlationId, commandKey: command.idempotencyKey, issuedAt: command.issuedAt }));
  const parentSpanId = asTrimmedString(trace.parentSpanId, null);

  return {
    correlationId,
    spanId,
    parentSpanId,
    sampled: trace.sampled !== false,
    issuedAt: asIsoTimestamp(trace.issuedAt, now)
  };
}

function normalizeWorkspaceStatePath(value, fallback) {
  const path = asTrimmedString(value, fallback);
  if (!path) {
    return null;
  }
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const segments = normalized.split('/').filter(Boolean);
  const valid = segments.length > 0 && segments.every((segment) => (
    !segment.includes('..') && !segment.includes('#') && !segment.includes('?')
  ));
  return valid ? `/${segments.join('/')}` : null;
}

function normalizeWorkspaceStateOperations(command) {
  const payload = asObject(command.payload);
  const explicitOperations = Array.isArray(payload.operations) ? payload.operations : [];
  const patchOperations = Object.keys(asObject(payload.patch)).sort().map((path) => ({
    op: 'set',
    path,
    value: payload.patch[path],
    source: 'patch'
  }));
  const rawOperations = explicitOperations.length ? explicitOperations : patchOperations;
  const operations = rawOperations.map((operation, index) => {
    const source = asObject(operation);
    const requestedOp = asTrimmedString(source.op || source.type, 'set');
    const op = WORKSPACE_STATE_OPERATION_TYPES.has(requestedOp) ? requestedOp : 'set';
    const validOperationType = WORKSPACE_STATE_OPERATION_TYPES.has(requestedOp);
    const path = normalizeWorkspaceStatePath(source.path || source.key, `/state/${index + 1}`);
    const expectsRevision = asTrimmedString(source.expectedRevision || source.ifRevision, null);

    return {
      index,
      op,
      requestedOp,
      path,
      valueChecksum: op === 'delete' ? null : checksum(source.value ?? null),
      source: asTrimmedString(source.source, explicitOperations.length ? 'operations' : 'patch'),
      expectsRevision,
      valid: Boolean(path) && validOperationType,
      proof: checksum({
        index,
        requestedOp,
        path,
        value: source.value ?? null,
        expectsRevision
      })
    };
  });
  const readPaths = Array.isArray(payload.paths)
    ? payload.paths.map((path, index) => normalizeWorkspaceStatePath(path, `/state/${index + 1}`)).filter(Boolean)
    : [];
  const writePaths = operations.map((operation) => operation.path).filter(Boolean);
  const mode = command.type === 'workspace.state.write'
    ? 'write'
    : command.type === 'workspace.state.read'
      ? 'read'
      : 'none';

  return {
    type: 'hosted-kernel.workspace-state-plan.v1',
    mode,
    expectedRevision: asTrimmedString(payload.expectedRevision || payload.ifRevision, null),
    readPaths: [...new Set(readPaths.length ? readPaths : mode === 'read' ? ['/'] : [])].sort(),
    writePaths: [...new Set(writePaths)].sort(),
    operations,
    operationCount: operations.length,
    exceedsLimit: operations.length > MAX_WORKSPACE_STATE_OPERATIONS,
    invalidOperationIndexes: operations.filter((operation) => !operation.valid).map((operation) => operation.index),
    invalidOperationTypes: [...new Set(operations
      .filter((operation) => !WORKSPACE_STATE_OPERATION_TYPES.has(operation.requestedOp))
      .map((operation) => operation.requestedOp))].sort(),
    conflictKey: checksum({
      scopeKey: command.scope.scopeKey,
      mode,
      readPaths,
      writePaths,
      expectedRevision: asTrimmedString(payload.expectedRevision || payload.ifRevision, null)
    })
  };
}

function validateCommandPayload(command, recovery) {
  const findings = [];
  const effect = COMMAND_EFFECTS.get(command.type);
  const workspaceStatePlan = normalizeWorkspaceStateOperations(command);
  const lifecycleCommandPlan = recovery.lifecycleCommandPlan;

  if (!effect) {
    findings.push({
      code: 'unknown-command-type',
      severity: 'error',
      message: `Command ${command.type} is not part of the hosted-kernel SDK command contract.`
    });
  }

  if (command.type === 'workspace.state.write') {
    const operations = Array.isArray(command.payload.operations) ? command.payload.operations : [];
    const patch = asObject(command.payload.patch);
    if (operations.length === 0 && Object.keys(patch).length === 0) {
      findings.push({
        code: 'missing-write-intent',
        severity: 'error',
        message: 'workspace.state.write requires payload.operations or payload.patch.'
      });
    }
    if (workspaceStatePlan.exceedsLimit) {
      findings.push({
        code: 'too-many-workspace-state-operations',
        severity: 'error',
        message: `workspace.state.write supports at most ${MAX_WORKSPACE_STATE_OPERATIONS} operations per command.`
      });
    }
    if (workspaceStatePlan.invalidOperationIndexes.length) {
      findings.push({
        code: 'invalid-workspace-state-path',
        severity: 'error',
        message: `workspace.state.write contains invalid operation paths at indexes ${workspaceStatePlan.invalidOperationIndexes.join(', ')}.`
      });
    }
    if (workspaceStatePlan.invalidOperationTypes.length) {
      findings.push({
        code: 'invalid-workspace-state-operation',
        severity: 'error',
        message: `workspace.state.write contains unsupported operations: ${workspaceStatePlan.invalidOperationTypes.join(', ')}.`
      });
    }
    if (!workspaceStatePlan.expectedRevision && workspaceStatePlan.operations.some((operation) => !operation.expectsRevision)) {
      findings.push({
        code: 'missing-workspace-state-revision',
        severity: 'warning',
        message: 'workspace.state.write should include expectedRevision on the payload or each operation for conflict-safe commits.'
      });
    }
  }

  if (command.type === 'workspace.state.read' && workspaceStatePlan.readPaths.length === 0) {
    findings.push({
      code: 'missing-workspace-state-read-path',
      severity: 'warning',
      message: 'workspace.state.read should include payload.paths; defaulting to the workspace root.'
    });
  }

  if (command.type === 'kernel.recovery.resume' && !asTrimmedString(command.payload.replayCursor, recovery.commandLedger.replayCursor)) {
    findings.push({
      code: 'missing-replay-cursor',
      severity: 'warning',
      message: 'kernel.recovery.resume should include payload.replayCursor for deterministic replay.'
    });
  }

  if (command.type === 'kernel.settings.update') {
    const settingsPayload = asObject(command.payload.settings || command.payload.lifecycleSettings);
    const proposedSettings = normalizeLifecycleSettings(settingsPayload, command.issuedAt);
    if (Object.keys(settingsPayload).length === 0) {
      findings.push({
        code: 'missing-settings-payload',
        severity: 'error',
        message: 'kernel.settings.update requires payload.settings or payload.lifecycleSettings.'
      });
    }
    findings.push(...proposedSettings.validationFindings);
  }

  if (command.type === 'kernel.lifecycle.schedule') {
    const schedulePayload = asObject(command.payload.schedule || command.payload.lifecycleSchedule);
    const proposedSchedule = normalizeLifecycleSchedule(schedulePayload, command.issuedAt);
    if (Object.keys(schedulePayload).length === 0) {
      findings.push({
        code: 'missing-lifecycle-schedule',
        severity: 'error',
        message: 'kernel.lifecycle.schedule requires payload.schedule.'
      });
    }
    findings.push(...proposedSchedule.findings);
  }

  if (lifecycleCommandPlan) {
    const existingCodes = new Set(findings.map((finding) => finding.code));
    findings.push(...lifecycleCommandPlan.validationFindings.filter((finding) => !existingCodes.has(finding.code)));
  }

  if (command.type === 'kernel.lifecycle.disable' && !asTrimmedString(command.payload.reason, null)) {
    findings.push({
      code: 'missing-disable-reason',
      severity: 'warning',
      message: 'kernel.lifecycle.disable should include payload.reason for audit handoff.'
    });
  }

  if (recovery.degradedMode.readOnly && effect?.mutatesWorkspace) {
    findings.push({
      code: 'degraded-mode-read-only',
      severity: 'error',
      message: `Command ${command.type} mutates workspace state while the hosted kernel is degraded.`
    });
  }

  if (!recovery.lifecycle.commandAllowed) {
    findings.push({
      code: recovery.lifecycle.blockedReason,
      severity: 'error',
      message: `Command ${command.type} is blocked by hosted-kernel lifecycle mode ${recovery.lifecycle.mode}.`
    });
  }

  if (!recovery.providerNegotiation.ready) {
    findings.push({
      code: recovery.providerNegotiation.denialReason,
      severity: recovery.providerNegotiation.externalHandoff.required ? 'warning' : 'error',
      message: `Command ${command.type} cannot use the selected hosted-kernel provider contract.`
    });
  }

  return findings;
}

function normalizeProviderCapabilities(value, fallback = []) {
  const capabilities = Array.isArray(value) ? value : fallback;
  return [...new Set(capabilities
    .filter((capability) => typeof capability === 'string')
    .map((capability) => capability.trim())
    .filter(Boolean))]
    .sort();
}

function normalizeProviderEndpoint(value, providerId, now) {
  const provider = asObject(value);
  const service = PROVIDER_SERVICE_TYPES.has(provider.service)
    ? provider.service
    : PROVIDER_SERVICE_TYPES.has(provider.type)
      ? provider.type
      : 'hosted-kernel';
  const id = asTrimmedString(provider.providerId || provider.id || provider.name, providerId);
  const status = provider.status === 'disabled' || provider.enabled === false
    ? 'disabled'
    : provider.status === 'maintenance' || provider.maintenance === true
      ? 'maintenance'
      : 'active';
  const lastSyncedAt = asIsoTimestamp(provider.lastSyncedAt || provider.syncedAt, now);
  const syncAgeMs = elapsedMsSince(lastSyncedAt, now);
  const capabilities = normalizeProviderCapabilities(provider.capabilities, DEFAULT_SERVICE_CAPABILITIES.get(service) || []);
  const handoffUri = asTrimmedString(provider.handoffUri || provider.externalHandoffUri || provider.url, null);
  const syncLeaseExpiresAt = asIsoTimestamp(
    provider.syncLeaseExpiresAt || provider.leaseExpiresAt,
    new Date(Date.parse(lastSyncedAt) + PROVIDER_SYNC_LEASE_EXPIRES_AFTER_MS).toISOString()
  );
  const syncLeaseExpired = Date.parse(syncLeaseExpiresAt) <= Date.parse(now);
  const authority = asTrimmedString(provider.authority || provider.serviceAuthority, service === 'hosted-kernel' ? 'kernel-local' : `provider:${service}`);

  return {
    providerId: id,
    service,
    status,
    capabilities,
    lastSyncedAt,
    syncAgeMs,
    syncCursor: asTrimmedString(provider.syncCursor || provider.cursor, checksum({ id, service, lastSyncedAt })),
    syncStale: syncAgeMs >= PROVIDER_SYNC_STALE_AFTER_MS,
    syncLeaseExpiresAt,
    syncLeaseExpired,
    externalHandoffUri: handoffUri,
    authority,
    schemaVersion: asTrimmedString(provider.schemaVersion || provider.contract, `${service}.provider.v1`),
    proof: checksum({ id, service, status, capabilities, lastSyncedAt, handoffUri, syncLeaseExpiresAt, authority })
  };
}

function providerServiceContract(provider, { requiredCapabilities, command, registryCursor, boundary, now }) {
  const missingCapabilities = requiredCapabilities.filter((capability) => !provider.capabilities.includes(capability));
  const statusEligible = provider.status === 'active';
  const syncEligible = !provider.syncLeaseExpired;
  const eligible = statusEligible && syncEligible && missingCapabilities.length === 0;
  const denialReason = eligible
    ? null
    : !statusEligible
      ? `provider-${provider.status}`
      : !syncEligible
        ? 'provider-sync-lease-expired'
        : 'provider-capability-missing';
  const handoffTarget = provider.externalHandoffUri || boundary.auditSink;
  const contract = {
    type: 'hosted-kernel.provider-service-contract.v1',
    providerId: provider.providerId,
    service: provider.service,
    schemaVersion: provider.schemaVersion,
    authority: provider.authority,
    commandType: command.type,
    status: provider.status,
    eligible,
    denialReason,
    requiredCapabilities,
    grantedCapabilities: provider.capabilities,
    missingCapabilities,
    sync: {
      registryCursor,
      providerCursor: provider.syncCursor,
      lastSyncedAt: provider.lastSyncedAt,
      ageMs: provider.syncAgeMs,
      stale: provider.syncStale,
      leaseExpiresAt: provider.syncLeaseExpiresAt,
      leaseExpired: provider.syncLeaseExpired,
      refreshRequired: provider.syncStale || provider.syncLeaseExpired
    },
    externalHandoff: {
      supported: Boolean(provider.externalHandoffUri),
      target: handoffTarget,
      routeIntent: 'hosted-kernel.provider.external-handoff',
      ackExpiresAt: new Date(Date.parse(now) + PROVIDER_HANDOFF_ACK_EXPIRES_AFTER_MS).toISOString(),
      payload: {
        commandType: command.type,
        scopeKey: command.scope.scopeKey,
        registryCursor,
        providerCursor: provider.syncCursor,
        requiredCapabilities,
        missingCapabilities
      }
    },
    auditSubject: `${command.scope.tenantId}/${command.scope.workspaceId}/${provider.providerId}`,
    routeIntent: eligible
      ? 'hosted-kernel.provider.dispatch'
      : provider.syncStale || provider.syncLeaseExpired
        ? 'hosted-kernel.provider.refresh-sync'
        : 'hosted-kernel.provider.review-contract'
  };

  return {
    ...contract,
    proof: checksum(contract)
  };
}

function normalizeProviderRegistry(value, now) {
  const source = asObject(value);
  const rawProviders = Array.isArray(source.providers)
    ? source.providers
    : Array.isArray(source.endpoints)
      ? source.endpoints
      : Array.isArray(value)
        ? value
        : [];
  const providers = rawProviders.map((provider, index) => (
    normalizeProviderEndpoint(provider, `provider:${index + 1}`, now)
  ));
  const effectiveProviders = providers.length
    ? providers
    : [normalizeProviderEndpoint({
      id: 'provider:hosted-kernel-default',
      service: 'hosted-kernel',
      capabilities: ['audit.write', 'ledger.append', 'ledger.replay', 'lifecycle.read', 'lifecycle.write', 'recovery.resume', 'status.read', 'workspace.read', 'workspace.write']
    }, 'provider:hosted-kernel-default', now)];
  const active = effectiveProviders.filter((provider) => provider.status === 'active');
  const syncCursor = asTrimmedString(source.syncCursor || source.cursor, checksum(effectiveProviders.map((provider) => provider.syncCursor)));

  return {
    version: 1,
    syncCursor,
    lastSyncedAt: asIsoTimestamp(source.lastSyncedAt || source.syncedAt, active[0]?.lastSyncedAt || now),
    providers: effectiveProviders.sort((left, right) => left.providerId.localeCompare(right.providerId)),
    activeProviderIds: active.map((provider) => provider.providerId).sort(),
    staleProviderIds: effectiveProviders.filter((provider) => provider.syncStale).map((provider) => provider.providerId).sort(),
    expiredSyncLeaseProviderIds: effectiveProviders.filter((provider) => provider.syncLeaseExpired).map((provider) => provider.providerId).sort(),
    serviceSummary: Object.keys(countBy(effectiveProviders.map((provider) => provider.service))).sort().map((service) => ({
      service,
      providers: effectiveProviders.filter((provider) => provider.service === service).map((provider) => provider.providerId).sort(),
      activeProviders: effectiveProviders.filter((provider) => provider.service === service && provider.status === 'active').map((provider) => provider.providerId).sort(),
      capabilities: [...new Set(effectiveProviders
        .filter((provider) => provider.service === service)
        .flatMap((provider) => provider.capabilities))].sort()
    })),
    proof: checksum({ syncCursor, providers: effectiveProviders })
  };
}

function negotiateProviderCapabilities(providerRegistry, command, boundary, now = command.issuedAt) {
  const requestedProviderId = asTrimmedString(command.payload.providerId || command.payload.serviceProviderId, null);
  const requiredCapabilities = COMMAND_CAPABILITY_REQUIREMENTS.get(command.type) || ['status.read'];
  const candidateContracts = providerRegistry.providers
    .filter((provider) => !requestedProviderId || provider.providerId === requestedProviderId)
    .map((provider) => providerServiceContract(provider, {
      requiredCapabilities,
      command,
      registryCursor: providerRegistry.syncCursor,
      boundary,
      now
    }));
  const eligibleContracts = candidateContracts.filter((contract) => contract.eligible);
  const selectedContract = eligibleContracts[0] || null;
  const selected = selectedContract
    ? providerRegistry.providers.find((provider) => provider.providerId === selectedContract.providerId)
    : null;
  const requestedKnown = !requestedProviderId || providerRegistry.providers.some((provider) => provider.providerId === requestedProviderId);
  const missingCapabilities = selectedContract ? [] : requiredCapabilities.filter((capability) => (
    !candidateContracts.some((contract) => contract.status === 'active' && contract.grantedCapabilities.includes(capability))
  ));
  const syncLeaseExpired = candidateContracts.some((contract) => contract.sync.leaseExpired);
  const denialReason = selected
    ? null
    : !requestedKnown
      ? 'provider-not-registered'
      : missingCapabilities.length
        ? 'provider-capability-missing'
        : syncLeaseExpired
          ? 'provider-sync-lease-expired'
        : 'provider-not-active';
  const handoffContract = candidateContracts.find((contract) => contract.externalHandoff.supported)
    || candidateContracts[0]
    || null;
  const externalHandoff = selected || !boundary.allowed
    ? { required: false, reason: null, target: null, syncCursor: providerRegistry.syncCursor }
    : {
      required: true,
      reason: denialReason,
      target: handoffContract?.externalHandoff.target || boundary.auditSink,
      syncCursor: providerRegistry.syncCursor,
      ackExpiresAt: handoffContract?.externalHandoff.ackExpiresAt || new Date(Date.parse(now) + PROVIDER_HANDOFF_ACK_EXPIRES_AFTER_MS).toISOString(),
      contractProof: handoffContract?.proof || null,
      payload: {
        ...(handoffContract?.externalHandoff.payload || {}),
        denialReason,
        requestedProviderId,
        scopedCommandKey: checksum({ key: command.idempotencyKey, scopeKey: command.scope.scopeKey })
      }
    };

  return {
    type: 'hosted-kernel-provider-capability-negotiation.v1',
    ready: Boolean(selected),
    selectedProviderId: selected?.providerId || null,
    requestedProviderId,
    requiredCapabilities,
    grantedCapabilities: selected?.capabilities || [],
    missingCapabilities,
    denialReason,
    serviceContracts: candidateContracts,
    selectedServiceContract: selectedContract,
    sync: {
      registryCursor: providerRegistry.syncCursor,
      providerCursor: selected?.syncCursor || null,
      lastSyncedAt: selected?.lastSyncedAt || providerRegistry.lastSyncedAt,
      stale: Boolean(selected?.syncStale || providerRegistry.staleProviderIds.length),
      leaseExpiresAt: selected?.syncLeaseExpiresAt || null,
      leaseExpired: Boolean(selected?.syncLeaseExpired || providerRegistry.expiredSyncLeaseProviderIds?.length),
      refreshRequired: Boolean(selected?.syncStale || selected?.syncLeaseExpired || providerRegistry.staleProviderIds.length)
    },
    externalHandoff,
    proof: checksum({ commandType: command.type, requestedProviderId, selected, requiredCapabilities, candidateContracts, externalHandoff })
  };
}

function buildIntegrationEffects(command, recovery, traceContext, validation) {
  const effect = COMMAND_EFFECTS.get(command.type) || {
    intent: 'unknown-hosted-kernel-command',
    mutatesWorkspace: false,
    emitsAudit: true,
    requiresHealthyKernel: true
  };
  const blocked = validation.some((finding) => finding.severity === 'error') || !recovery.boundary.allowed || recovery.status === 'failed' || !recovery.lifecycle.commandAllowed || !recovery.providerNegotiation.ready;
  const auditProof = checksum({
    surfaceId,
    commandType: command.type,
    scopedCommandKey: recovery.scopedCommandKey,
    disposition: recovery.idempotentDisposition,
    boundary: recovery.boundary.auditSink,
    provider: recovery.providerNegotiation.selectedProviderId,
    trace: traceContext
  });
  const workspaceStatePlan = normalizeWorkspaceStateOperations(command);
  const lifecycleCommandPlan = recovery.lifecycleCommandPlan
    ? {
      ...recovery.lifecycleCommandPlan,
      commitRequired: recovery.lifecycleCommandPlan.commitRequired && !blocked,
      proof: checksum({
        planProof: recovery.lifecycleCommandPlan.proof,
        blocked,
        scopedCommandKey: recovery.scopedCommandKey
      })
    }
    : null;

  return {
    dispatchable: !blocked && !recovery.degradedMode.readOnly,
    blocked,
    intent: effect.intent,
    mutatesWorkspace: effect.mutatesWorkspace,
    requiresHealthyKernel: effect.requiresHealthyKernel,
    appendLedgerEntry: recovery.commandLedger.appendOnAccept,
    emitAuditRecord: effect.emitsAudit ? {
      sink: recovery.boundary.auditSink,
      type: 'hosted-kernel.command.dispatch',
      proof: auditProof,
      trace: traceContext
    } : null,
    requiredAcks: [
      ...(recovery.commandLedger.appendOnAccept ? ['command-ledger-append'] : []),
      ...(effect.emitsAudit ? ['audit-record-emit'] : []),
      ...(recovery.providerNegotiation.ready ? ['provider-capability-ack'] : ['provider-handoff-ack']),
      ...(recovery.providerNegotiation.sync.refreshRequired ? ['provider-sync-refresh'] : []),
      ...(lifecycleCommandPlan?.commitRequired ? ['lifecycle-settings-commit'] : []),
      ...(effect.mutatesWorkspace ? ['workspace-state-commit'] : [])
    ],
    workspaceStatePlan: workspaceStatePlan.mode === 'none'
      ? null
      : {
        ...workspaceStatePlan,
        commitRequired: effect.mutatesWorkspace && !blocked,
        conflictDetection: {
          required: effect.mutatesWorkspace,
          expectedRevision: workspaceStatePlan.expectedRevision,
          conflictKey: workspaceStatePlan.conflictKey,
          writePaths: workspaceStatePlan.writePaths
        },
        proof: checksum({
          scopedCommandKey: recovery.scopedCommandKey,
          mode: workspaceStatePlan.mode,
          readPaths: workspaceStatePlan.readPaths,
          writePaths: workspaceStatePlan.writePaths,
          operations: workspaceStatePlan.operations,
          blocked
        })
      },
    provider: {
      ...recovery.providerNegotiation,
      dispatchContract: recovery.providerNegotiation.selectedServiceContract,
      handoffContractProof: recovery.providerNegotiation.externalHandoff.contractProof || null
    },
    lifecycleCommandPlan,
    lifecycle: {
      mode: recovery.lifecycle.mode,
      settingsRevision: recovery.lifecycle.settingsRevision,
      nextAction: recovery.lifecycle.nextAction,
      proof: recovery.lifecycle.proof
    },
    resumeFrom: recovery.idempotentDisposition === 'pending-expired' || recovery.idempotentDisposition === 'pending'
      ? {
        replayCursor: recovery.commandLedger.replayCursor,
        ledgerEntry: recovery.commandLedger.entry,
        recoveryCheckpoint: recovery.recoveryJournal.resumePlan.checkpointId
      }
      : recovery.recoveryJournal.resumePlan.required && recovery.recoveryJournal.resumePlan.idempotent
        ? {
          replayCursor: recovery.recoveryJournal.resumePlan.resumeCursor,
          ledgerEntry: recovery.commandLedger.entry,
          recoveryCheckpoint: recovery.recoveryJournal.resumePlan.checkpointId,
          phase: recovery.recoveryJournal.resumePlan.phase,
          actions: recovery.recoveryJournal.resumePlan.actions,
          proof: recovery.recoveryJournal.resumePlan.proof
        }
        : null,
    recoveryResumePlan: recovery.recoveryJournal.resumePlan
  };
}

function restartStatusForClient(recovery, preview) {
  if (recovery.status === 'failed' || recovery.recoveryJournal.resumePlan.restartStatus === 'failed') {
    return 'restart-blocked';
  }
  if (recovery.recoveryJournal.resumePlan.required && recovery.recoveryJournal.resumePlan.idempotent) {
    return 'restart-resumable';
  }
  if (preview.acceptance.decision === 'reuse-ledger-disposition') {
    return 'restart-replayed';
  }
  if (preview.acceptance.decision === 'accept') {
    return 'restart-ready';
  }
  return 'restart-waiting';
}

function buildRestartStatusContract(recovery, integration, preview, issuedAt) {
  const contract = {
    type: 'hosted-kernel.restart-status.v1',
    generatedAt: issuedAt,
    status: restartStatusForClient(recovery, preview),
    kernelStatus: recovery.status,
    restartSafe: recovery.restartSafe,
    idempotentDisposition: recovery.idempotentDisposition,
    scopedCommandKey: recovery.scopedCommandKey,
    resumeFrom: integration.resumeFrom,
    resumePlan: {
      required: recovery.recoveryJournal.resumePlan.required,
      restartStatus: recovery.recoveryJournal.resumePlan.restartStatus,
      resumeCursor: recovery.recoveryJournal.resumePlan.resumeCursor,
      checkpointId: recovery.recoveryJournal.resumePlan.checkpointId,
      phase: recovery.recoveryJournal.resumePlan.phase,
      actions: recovery.recoveryJournal.resumePlan.actions,
      proof: recovery.recoveryJournal.resumePlan.proof
    },
    requiredAcks: integration.requiredAcks,
    visibleDecision: preview.acceptance.decision
  };

  return {
    ...contract,
    proof: checksum(contract)
  };
}

function summarizeValidationFindings(validation, recovery, integration) {
  const counts = validation.reduce((summary, finding) => {
    const severity = finding.severity === 'error' || finding.severity === 'warning' ? finding.severity : 'info';
    summary[severity] += 1;
    return summary;
  }, { error: 0, warning: 0, info: 0 });
  const blockingCodes = [
    ...validation.filter((finding) => finding.severity === 'error').map((finding) => finding.code),
    ...(!recovery.boundary.allowed ? [recovery.boundary.denialReason] : []),
    ...(!recovery.lifecycle.commandAllowed ? [recovery.lifecycle.blockedReason] : []),
    ...(!recovery.providerNegotiation.ready && !recovery.providerNegotiation.externalHandoff.required ? [recovery.providerNegotiation.denialReason] : [])
  ].filter(Boolean);
  const warningCodes = [
    ...validation.filter((finding) => finding.severity === 'warning').map((finding) => finding.code),
    ...(recovery.degradedMode.active ? recovery.degradedMode.reasons : []),
    ...(!recovery.providerNegotiation.ready && recovery.providerNegotiation.externalHandoff.required ? [recovery.providerNegotiation.denialReason] : [])
  ].filter(Boolean);

  return {
    ready: integration.dispatchable && counts.error === 0,
    counts,
    blockingCodes: [...new Set(blockingCodes)].sort(),
    warningCodes: [...new Set(warningCodes)].sort(),
    highestSeverity: counts.error ? 'error' : counts.warning || warningCodes.length ? 'warning' : 'ok',
    proof: checksum({ counts, blockingCodes, warningCodes, dispatchable: integration.dispatchable })
  };
}

function readinessChecksForCommand(recovery, integration, validationSummary) {
  const checks = [
    {
      code: 'workspace-boundary',
      ready: recovery.boundary.allowed,
      message: recovery.boundary.allowed
        ? `Workspace ${recovery.boundary.workspaceId} accepts this actor and command scope.`
        : `Workspace boundary denied this command: ${recovery.boundary.denialReason}.`,
      evidence: recovery.boundary.proof || checksum(recovery.boundary)
    },
    {
      code: 'lifecycle-gate',
      ready: recovery.lifecycle.commandAllowed,
      message: recovery.lifecycle.commandAllowed
        ? `Lifecycle mode ${recovery.lifecycle.mode} allows the command.`
        : `Lifecycle mode ${recovery.lifecycle.mode} blocks the command.`,
      evidence: recovery.lifecycle.proof
    },
    {
      code: 'provider-capabilities',
      ready: recovery.providerNegotiation.ready,
      message: recovery.providerNegotiation.ready
        ? `Provider ${recovery.providerNegotiation.selectedProviderId} grants required capabilities.`
        : `Provider capability negotiation is not ready: ${recovery.providerNegotiation.denialReason}.`,
      evidence: recovery.providerNegotiation.proof
    },
    {
      code: 'validation',
      ready: validationSummary.counts.error === 0,
      message: validationSummary.counts.error === 0
        ? 'Command payload passed hosted-kernel validation.'
        : `Command payload has ${validationSummary.counts.error} blocking validation finding(s).`,
      evidence: validationSummary.proof
    },
    {
      code: 'integration-dispatch',
      ready: integration.dispatchable,
      message: integration.dispatchable
        ? 'Command can be dispatched through the hosted-kernel integration path.'
        : 'Command is not dispatchable from the current hosted-kernel state.',
      evidence: checksum({
        dispatchable: integration.dispatchable,
        blocked: integration.blocked,
        requiredAcks: integration.requiredAcks
      })
    }
  ];

  return {
    ready: checks.every((check) => check.ready),
    checks,
    blockedBy: checks.filter((check) => !check.ready).map((check) => check.code),
    proof: checksum(checks)
  };
}

function nextStepContractsForCommand(command, recovery, integration, validationSummary, readiness) {
  if (recovery.actionableError) {
    return [{
      type: recovery.actionableError.retryable ? 'schedule-retry' : 'surface-actionable-error',
      label: recovery.actionableError.retryable ? 'Schedule retry' : 'Show recovery action',
      routeIntent: 'hosted-kernel.recovery.action',
      method: 'POST',
      commandType: command.type,
      body: {
        scopedCommandKey: recovery.scopedCommandKey,
        retryBackoff: recovery.retryBackoff,
        error: recovery.actionableError
      },
      proof: recovery.actionableError.proof
    }];
  }

  if (recovery.providerNegotiation.externalHandoff.required) {
    return [{
      type: 'external-provider-handoff',
      label: 'Hand off to provider',
      routeIntent: 'hosted-kernel.provider.handoff',
      method: 'POST',
      commandType: command.type,
      body: {
        scopedCommandKey: recovery.scopedCommandKey,
        target: recovery.providerNegotiation.externalHandoff.target,
        syncCursor: recovery.providerNegotiation.externalHandoff.syncCursor,
        ackExpiresAt: recovery.providerNegotiation.externalHandoff.ackExpiresAt,
        requiredCapabilities: recovery.providerNegotiation.requiredCapabilities,
        providerContractProof: recovery.providerNegotiation.externalHandoff.contractProof,
        handoffPayload: recovery.providerNegotiation.externalHandoff.payload
      },
      proof: recovery.providerNegotiation.proof
    }];
  }

  if (!readiness.ready) {
    return [{
      type: 'resolve-readiness-blockers',
      label: 'Resolve readiness blockers',
      routeIntent: 'hosted-kernel.readiness.review',
      method: 'GET',
      commandType: command.type,
      body: {
        scopedCommandKey: recovery.scopedCommandKey,
        blockedBy: readiness.blockedBy,
        blockingCodes: validationSummary.blockingCodes
      },
      proof: readiness.proof
    }];
  }

  return [{
    type: recovery.commandLedger.appendOnAccept ? 'accept-command' : 'return-ledger-disposition',
    label: recovery.commandLedger.appendOnAccept ? 'Accept command' : 'Use ledger result',
    routeIntent: recovery.commandLedger.appendOnAccept ? 'hosted-kernel.command.accept' : 'hosted-kernel.command.ledger-result',
    method: recovery.commandLedger.appendOnAccept ? 'POST' : 'GET',
    commandType: command.type,
    body: {
      scopedCommandKey: recovery.scopedCommandKey,
      ledgerAppend: recovery.commandLedger.appendOnAccept,
      requiredAcks: integration.requiredAcks,
      resumeFrom: integration.resumeFrom
    },
    proof: checksum({
      scopedCommandKey: recovery.scopedCommandKey,
      disposition: recovery.idempotentDisposition,
      requiredAcks: integration.requiredAcks
    })
  }];
}

function routeSegment(value) {
  return encodeURIComponent(asTrimmedString(value, 'unknown').replaceAll('/', ':'));
}

function routePathForCommand(command, recovery, suffix) {
  const base = [
    '/hosted-kernel',
    'tenants',
    routeSegment(command.scope.tenantId),
    'workspaces',
    routeSegment(command.scope.workspaceId),
    'commands',
    routeSegment(recovery.scopedCommandKey)
  ].join('/');

  return `${base}/${suffix}`;
}

function buildPreviewRouteContracts({
  command,
  recovery,
  integration,
  validationSummary,
  readiness,
  nextSteps,
  acceptanceDecision,
  issuedAt
}) {
  const baseBody = {
    scopedCommandKey: recovery.scopedCommandKey,
    commandType: command.type,
    idempotencyKey: command.idempotencyKey,
    scopeKey: command.scope.scopeKey
  };
  const acceptanceToken = checksum({
    decision: acceptanceDecision,
    scopedCommandKey: recovery.scopedCommandKey,
    requiredAcks: integration.requiredAcks,
    ledgerAppend: recovery.commandLedger.appendOnAccept,
    readinessProof: readiness.proof
  });
  const routes = [
    {
      name: 'preview',
      routeIntent: 'hosted-kernel.command.preview',
      method: 'GET',
      path: routePathForCommand(command, recovery, 'preview'),
      enabled: true,
      request: {
        query: {
          trace: 'optional trace correlation id',
          includeValidation: true
        }
      },
      response: {
        contract: 'hosted-kernel.command-preview.v1',
        includes: ['display', 'acceptance', 'readiness', 'validationSummary', 'effects', 'nextSteps', 'routeContracts']
      }
    },
    {
      name: 'acceptance',
      routeIntent: acceptanceDecision === 'reuse-ledger-disposition'
        ? 'hosted-kernel.command.ledger-result'
        : 'hosted-kernel.command.accept',
      method: acceptanceDecision === 'reuse-ledger-disposition' ? 'GET' : 'POST',
      path: routePathForCommand(command, recovery, acceptanceDecision === 'reuse-ledger-disposition' ? 'ledger-result' : 'accept'),
      enabled: acceptanceDecision === 'accept' || acceptanceDecision === 'reuse-ledger-disposition',
      request: {
        body: {
          ...baseBody,
          acceptanceToken,
          requiredAcks: integration.requiredAcks
        }
      },
      response: {
        contract: 'hosted-kernel-command-acceptance.v1',
        dispatchable: integration.dispatchable,
        ledgerAppendOnAccept: recovery.commandLedger.appendOnAccept,
        emitsAuditRecord: Boolean(integration.emitAuditRecord)
      }
    },
    {
      name: 'readiness',
      routeIntent: 'hosted-kernel.readiness.review',
      method: 'GET',
      path: routePathForCommand(command, recovery, 'readiness'),
      enabled: !readiness.ready,
      request: {
        query: {
          blockedBy: readiness.blockedBy.join(',')
        }
      },
      response: {
        contract: 'hosted-kernel-command-readiness.v1',
        ready: readiness.ready,
        blockedBy: readiness.blockedBy,
        checks: readiness.checks.map((check) => ({
          code: check.code,
          ready: check.ready,
          evidence: check.evidence
        }))
      }
    },
    {
      name: 'validation-summary',
      routeIntent: 'hosted-kernel.validation.summary',
      method: 'GET',
      path: routePathForCommand(command, recovery, 'validation-summary'),
      enabled: validationSummary.highestSeverity !== 'ok',
      request: {
        query: {
          highestSeverity: validationSummary.highestSeverity
        }
      },
      response: {
        contract: 'hosted-kernel-command-validation-summary.v1',
        counts: validationSummary.counts,
        blockingCodes: validationSummary.blockingCodes,
        warningCodes: validationSummary.warningCodes
      }
    }
  ];
  const nextStepRoutes = nextSteps.map((step, index) => ({
    name: `next-step:${index + 1}`,
    routeIntent: step.routeIntent,
    method: step.method,
    path: routePathForCommand(command, recovery, `next-steps/${routeSegment(step.type)}`),
    enabled: true,
    request: {
      body: {
        ...baseBody,
        ...step.body
      }
    },
    response: {
      contract: 'hosted-kernel-explainable-next-steps.v1',
      stepType: step.type,
      label: step.label,
      proof: step.proof
    }
  }));
  const contract = {
    type: 'hosted-kernel.preview-route-contracts.v1',
    generatedAt: issuedAt,
    acceptanceToken,
    primaryRouteIntent: routes.find((route) => route.enabled && route.name === 'acceptance')?.routeIntent
      || nextStepRoutes[0]?.routeIntent
      || 'hosted-kernel.command.preview',
    routes: [...routes, ...nextStepRoutes],
    validationBadges: [
      ...(validationSummary.counts.error ? [{ severity: 'error', count: validationSummary.counts.error, codes: validationSummary.blockingCodes }] : []),
      ...(validationSummary.counts.warning || validationSummary.warningCodes.length
        ? [{ severity: 'warning', count: validationSummary.counts.warning, codes: validationSummary.warningCodes }]
        : [])
    ],
    auditEnvelope: {
      sink: recovery.boundary.auditSink,
      traceRequired: true,
      proofRequired: true,
      scopedCommandKey: recovery.scopedCommandKey
    }
  };

  return {
    ...contract,
    proof: checksum(contract)
  };
}

function normalizeClientRequestState(value, command, recovery, traceContext, issuedAt) {
  const source = asObject(value);
  const requestId = asTrimmedString(
    source.requestId || source.id,
    checksum({ scopedCommandKey: recovery.scopedCommandKey, traceId: traceContext.correlationId })
  );
  const sessionId = asTrimmedString(source.sessionId || source.clientSessionId, checksum({
    actorId: command.scope.actorId,
    workspaceId: command.scope.workspaceId,
    traceId: traceContext.correlationId
  }));
  const createdAt = asIsoTimestamp(source.createdAt || source.startedAt, command.issuedAt);
  const lastSeenAt = asIsoTimestamp(source.lastSeenAt || source.updatedAt || source.seenAt, issuedAt);
  const requestAgeMs = elapsedMsSince(createdAt, issuedAt);
  const idleMs = elapsedMsSince(lastSeenAt, issuedAt);
  const preferredRouteIntent = asTrimmedString(source.routeIntent || source.preferredRouteIntent, null);

  return {
    type: 'hosted-kernel.client-request-state.v1',
    requestId,
    sessionId,
    clientName: asTrimmedString(source.clientName || source.name, 'aios-sdk-client'),
    routeIntent: preferredRouteIntent || 'hosted-kernel.command.preview',
    createdAt,
    lastSeenAt,
    requestAgeMs,
    idleMs,
    stale: idleMs >= CLIENT_REQUEST_STALE_AFTER_MS,
    resumable: command.restartSafe && recovery.restartSafe,
    resumeToken: checksum({
      requestId,
      sessionId,
      scopedCommandKey: recovery.scopedCommandKey,
      traceId: traceContext.correlationId
    }),
    proof: checksum({ requestId, sessionId, createdAt, lastSeenAt, scopedCommandKey: recovery.scopedCommandKey })
  };
}

function normalizeClientAckStatus(value) {
  const status = asTrimmedString(value, 'pending').toLowerCase();
  if (['complete', 'completed', 'committed', 'acknowledged', 'acked', 'ok'].includes(status)) {
    return 'completed';
  }
  if (['failed', 'error', 'rejected'].includes(status)) {
    return 'failed';
  }
  if (['expired', 'timed-out', 'timeout'].includes(status)) {
    return 'expired';
  }
  if (['blocked', 'waiting'].includes(status)) {
    return 'blocked';
  }
  return 'pending';
}

function normalizeClientAckRecords(source, issuedAt) {
  const raw = asObject(source);
  const ackMaps = [raw.acknowledgements, raw.acknowledgments, raw.acks, raw.ackLedger].map(asObject);
  const mappedRecords = ackMaps.flatMap((ackMap) => (
    Object.keys(ackMap).sort().map((ack) => ({
      ...asObject(ackMap[ack]),
      ack
    }))
  ));
  const listedRecords = [
    ...(Array.isArray(raw.acknowledgements) ? raw.acknowledgements : []),
    ...(Array.isArray(raw.acknowledgments) ? raw.acknowledgments : []),
    ...(Array.isArray(raw.acks) ? raw.acks : []),
    ...(Array.isArray(raw.ackLedger) ? raw.ackLedger : [])
  ];

  return [...mappedRecords, ...listedRecords]
    .map((record, index) => {
      const item = typeof record === 'string' ? { ack: record, status: 'completed' } : asObject(record);
      const ack = asTrimmedString(item.ack || item.type || item.name, null);
      if (!ack) {
        return null;
      }
      const receivedAt = asIsoTimestamp(item.receivedAt || item.acknowledgedAt || item.completedAt || item.updatedAt, issuedAt);
      const expiresAt = asIsoTimestamp(item.expiresAt || item.leaseExpiresAt, null);
      const expired = expiresAt ? Date.parse(expiresAt) <= Date.parse(issuedAt) : false;
      const status = expired ? 'expired' : normalizeClientAckStatus(item.status || item.state);
      const normalized = {
        type: 'hosted-kernel.client-ack-record.v1',
        ack,
        status,
        receivedAt,
        expiresAt,
        sequence: asNonNegativeInteger(item.sequence, index + 1),
        actorId: asTrimmedString(item.actorId, null),
        receiptProof: asTrimmedString(item.receiptProof || item.proof, null)
      };

      return {
        ...normalized,
        proof: checksum(normalized)
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.ack.localeCompare(right.ack) || right.sequence - left.sequence);
}

function latestAckRecord(records, ack) {
  return records
    .filter((record) => record.ack === ack)
    .sort((left, right) => right.sequence - left.sequence || Date.parse(right.receivedAt) - Date.parse(left.receivedAt))[0] || null;
}

function buildClientAckProgress({ source, integration, clientRequest, recovery, issuedAt }) {
  const records = normalizeClientAckRecords(source, issuedAt);
  const requiredAcks = integration.requiredAcks;
  const acks = requiredAcks.map((ack) => {
    const record = latestAckRecord(records, ack);
    const expiresAt = record?.expiresAt || new Date(Date.parse(issuedAt) + CLIENT_HANDOFF_ACK_EXPIRES_AFTER_MS).toISOString();
    const status = record
      ? record.status
      : integration.dispatchable
        ? 'pending'
        : 'blocked';
    const ackState = {
      ack,
      required: true,
      status,
      receivedAt: record?.receivedAt || null,
      expiresAt,
      routeIntent: status === 'completed'
        ? 'hosted-kernel.client-ack.receipt'
        : status === 'failed' || status === 'expired'
          ? 'hosted-kernel.client-ack.reconcile'
          : 'hosted-kernel.client-ack.await',
      receiptProof: record?.receiptProof || record?.proof || null
    };

    return {
      ...ackState,
      proof: checksum({
        ackState,
        requestId: clientRequest.requestId,
        scopedCommandKey: recovery.scopedCommandKey
      })
    };
  });
  const counts = normalizeCounterMap(countBy(acks.map((ack) => ack.status)));
  const incomplete = acks.filter((ack) => ack.status !== 'completed');
  const progress = {
    type: 'hosted-kernel.client-ack-progress.v1',
    generatedAt: issuedAt,
    requestId: clientRequest.requestId,
    sessionId: clientRequest.sessionId,
    requiredCount: requiredAcks.length,
    completedCount: counts.completed || 0,
    pendingCount: counts.pending || 0,
    blockedCount: counts.blocked || 0,
    failedCount: counts.failed || 0,
    expiredCount: counts.expired || 0,
    readyToFinalize: requiredAcks.length > 0 && incomplete.length === 0,
    routeIntent: incomplete.some((ack) => ack.status === 'failed' || ack.status === 'expired')
      ? 'hosted-kernel.client-ack.reconcile'
      : incomplete.length
        ? 'hosted-kernel.client-ack.await'
        : 'hosted-kernel.command.finalize',
    acks,
    observedReceipts: records,
    nextRequiredAck: incomplete[0]?.ack || null
  };

  return {
    ...progress,
    proof: checksum(progress)
  };
}

function buildClientWorkflowHandoff({ source, command, recovery, integration, preview, traceContext, issuedAt }) {
  const clientRequest = normalizeClientRequestState(source, command, recovery, traceContext, issuedAt);
  const nextStep = preview.nextSteps[0] || null;
  const ackProgress = buildClientAckProgress({ source, integration, clientRequest, recovery, issuedAt });
  const pendingAcks = ackProgress.acks.filter((ack) => ack.status !== 'completed');
  const visibleStatus = preview.acceptance.decision === 'accept'
    ? ackProgress.failedCount || ackProgress.expiredCount
      ? 'ack-reconciliation-required'
      : ackProgress.pendingCount || ackProgress.blockedCount
        ? 'awaiting-client-acks'
        : 'ready-to-dispatch'
    : preview.acceptance.decision === 'reuse-ledger-disposition'
      ? 'ledger-result-ready'
      : preview.acceptance.decision === 'handoff'
        ? 'handoff-required'
        : recovery.actionableError
          ? 'recovery-action-required'
          : 'blocked';
  const workflowAction = nextStep
    ? {
      type: nextStep.type,
      label: nextStep.label,
      routeIntent: nextStep.routeIntent,
      method: nextStep.method,
      commandType: nextStep.commandType,
      resumable: clientRequest.resumable,
      body: {
        ...nextStep.body,
        requestId: clientRequest.requestId,
        sessionId: clientRequest.sessionId,
        resumeToken: clientRequest.resumeToken,
        ackProgressProof: ackProgress.proof,
        nextRequiredAck: ackProgress.nextRequiredAck,
        traceId: traceContext.correlationId
      },
      proof: checksum({
        nextStepProof: nextStep.proof,
        requestId: clientRequest.requestId,
        resumeToken: clientRequest.resumeToken,
        ackProgressProof: ackProgress.proof
      })
    }
    : null;

  const contract = {
    type: 'hosted-kernel.client-workflow-handoff.v1',
    generatedAt: issuedAt,
    request: clientRequest,
    visibleStatus,
    routeIntent: workflowAction?.routeIntent || clientRequest.routeIntent,
    display: {
      title: preview.display.title,
      summary: preview.display.summary,
      severity: preview.validationSummary.highestSeverity
    },
    pendingAcks,
    ackProgress,
    workflowAction,
    routeContracts: {
      primaryRouteIntent: preview.routeContracts.primaryRouteIntent,
      routes: preview.routeContracts.routes.map((route) => ({
        name: route.name,
        routeIntent: route.routeIntent,
        method: route.method,
        path: route.path,
        enabled: route.enabled
      })),
      proof: preview.routeContracts.proof
    },
    externalTarget: recovery.providerNegotiation.externalHandoff.required
      ? recovery.providerNegotiation.externalHandoff.target
      : null,
    auditLink: {
      sink: recovery.boundary.auditSink,
      traceId: traceContext.correlationId,
      commandProof: recovery.scopedCommandKey,
      envelopeProofRequired: true
    },
    userVisibleHandoff: {
      status: visibleStatus,
      nextRequiredAck: ackProgress.nextRequiredAck,
      completedAcks: ackProgress.completedCount,
      requiredAcks: ackProgress.requiredCount,
      routeIntent: ackProgress.routeIntent,
      proof: ackProgress.proof
    }
  };

  return {
    ...contract,
    proof: checksum(contract)
  };
}

function buildCommandPreviewContract(command, recovery, traceContext, validation, integration, issuedAt) {
  const validationSummary = summarizeValidationFindings(validation, recovery, integration);
  const readiness = readinessChecksForCommand(recovery, integration, validationSummary);
  const acceptanceDecision = readiness.ready
    ? recovery.commandLedger.appendOnAccept
      ? 'accept'
      : 'reuse-ledger-disposition'
    : recovery.providerNegotiation.externalHandoff.required
      ? 'handoff'
      : 'block';
  const nextSteps = nextStepContractsForCommand(command, recovery, integration, validationSummary, readiness);
  const routeContracts = buildPreviewRouteContracts({
    command,
    recovery,
    integration,
    validationSummary,
    readiness,
    nextSteps,
    acceptanceDecision,
    issuedAt
  });
  const preview = {
    type: 'hosted-kernel.command-preview.v1',
    generatedAt: issuedAt,
    display: {
      title: command.type,
      status: acceptanceDecision,
      summary: readiness.ready
        ? `Ready to ${acceptanceDecision === 'accept' ? 'accept and dispatch' : 'serve from ledger'} for ${command.scope.workspaceId}.`
        : `Requires ${nextSteps[0]?.label || 'operator action'} before dispatch.`
    },
    acceptance: {
      decision: acceptanceDecision,
      dispatchable: integration.dispatchable,
      restartSafe: recovery.restartSafe,
      idempotentDisposition: recovery.idempotentDisposition,
      requiredAcks: integration.requiredAcks,
      ledgerAppendOnAccept: recovery.commandLedger.appendOnAccept,
      proof: checksum({
        decision: acceptanceDecision,
        scopedCommandKey: recovery.scopedCommandKey,
        requiredAcks: integration.requiredAcks,
        disposition: recovery.idempotentDisposition
      })
    },
    readiness,
    validationSummary,
    effects: {
      intent: integration.intent,
      mutatesWorkspace: integration.mutatesWorkspace,
      emitsAuditRecord: Boolean(integration.emitAuditRecord),
      providerId: recovery.providerNegotiation.selectedProviderId,
      providerServiceContract: recovery.providerNegotiation.selectedServiceContract
        ? {
          providerId: recovery.providerNegotiation.selectedServiceContract.providerId,
          service: recovery.providerNegotiation.selectedServiceContract.service,
          schemaVersion: recovery.providerNegotiation.selectedServiceContract.schemaVersion,
          routeIntent: recovery.providerNegotiation.selectedServiceContract.routeIntent,
          sync: recovery.providerNegotiation.selectedServiceContract.sync,
          proof: recovery.providerNegotiation.selectedServiceContract.proof
        }
        : null,
      providerHandoff: recovery.providerNegotiation.externalHandoff.required
        ? {
          target: recovery.providerNegotiation.externalHandoff.target,
          ackExpiresAt: recovery.providerNegotiation.externalHandoff.ackExpiresAt,
          contractProof: recovery.providerNegotiation.externalHandoff.contractProof,
          proof: recovery.providerNegotiation.proof
        }
        : null,
      lifecycleMode: recovery.lifecycle.mode,
      lifecycleCommandPlan: integration.lifecycleCommandPlan
        ? {
          commandType: integration.lifecycleCommandPlan.commandType,
          commitRequired: integration.lifecycleCommandPlan.commitRequired,
          previousRevision: integration.lifecycleCommandPlan.previous.revision,
          proposedRevision: integration.lifecycleCommandPlan.proposed.revision,
          changedFields: integration.lifecycleCommandPlan.changedFields.map((change) => change.field),
          nextActionAfterCommit: integration.lifecycleCommandPlan.nextActionAfterCommit,
          transitionReceipt: integration.lifecycleCommandPlan.transitionReceipt,
          proof: integration.lifecycleCommandPlan.proof
        }
        : null,
      traceId: traceContext.correlationId,
      workspaceStatePlan: integration.workspaceStatePlan
        ? {
          mode: integration.workspaceStatePlan.mode,
          operationCount: integration.workspaceStatePlan.operationCount,
          readPaths: integration.workspaceStatePlan.readPaths,
          writePaths: integration.workspaceStatePlan.writePaths,
          conflictKey: integration.workspaceStatePlan.conflictKey,
          proof: integration.workspaceStatePlan.proof
        }
        : null
    },
    nextSteps,
    routeContracts
  };

  return {
    ...preview,
    proof: checksum(preview)
  };
}

function normalizeLedgerEntry(value, status, now) {
  const source = typeof value === 'string'
    ? { idempotencyKey: value }
    : asObject(value);
  const idempotencyKey = asTrimmedString(source.idempotencyKey || source.key || source.commandKey, null);
  const scopeKey = asTrimmedString(source.scopeKey, null);
  const commandType = asTrimmedString(source.commandType || source.type, 'unknown');
  const persistedStatus = asTrimmedString(source.status, status);
  const sequence = asNonNegativeInteger(source.sequence, 0);
  const updatedAt = asIsoTimestamp(source.updatedAt || source.completedAt || source.failedAt || source.startedAt, now);

  if (!idempotencyKey) {
    return null;
  }

  const scopedKey = asTrimmedString(source.scopedCommandKey, scopeKey ? checksum({ key: idempotencyKey, scopeKey }) : idempotencyKey);
  const leaseStartedAt = asIsoTimestamp(source.leaseStartedAt || source.startedAt, persistedStatus === 'pending' ? updatedAt : null);
  const leaseAgeMs = leaseStartedAt ? elapsedMsSince(leaseStartedAt, now) : 0;
  const leaseExpired = persistedStatus === 'pending' && leaseAgeMs >= COMMAND_LEASE_EXPIRES_AFTER_MS;

  return {
    idempotencyKey,
    scopedCommandKey: scopedKey,
    scopeKey,
    commandType,
    status: persistedStatus,
    sequence,
    updatedAt,
    leaseStartedAt,
    leaseExpired,
    resultChecksum: asTrimmedString(source.resultChecksum, null),
    failureCode: asTrimmedString(source.failureCode || source.code, null),
    auditProof: asTrimmedString(source.auditProof || source.proof, checksum({
      idempotencyKey,
      scopedKey,
      status: persistedStatus,
      sequence,
      updatedAt
    }))
  };
}

function compactLedgerEntries(entries) {
  return entries
    .sort((left, right) => {
      if (right.sequence !== left.sequence) {
        return right.sequence - left.sequence;
      }
      return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    })
    .slice(0, MAX_LEDGER_KEYS)
    .sort((left, right) => left.sequence - right.sequence || left.scopedCommandKey.localeCompare(right.scopedCommandKey));
}

function normalizeCommandLedger(value, now) {
  const source = asObject(value);
  const rawEntries = [
    ...(Array.isArray(source.entries) ? source.entries : []),
    ...(Array.isArray(source.completed) ? source.completed.map((entry) => ({ ...asObject(entry), idempotencyKey: typeof entry === 'string' ? entry : asObject(entry).idempotencyKey, status: 'completed' })) : []),
    ...(Array.isArray(source.pending) ? source.pending.map((entry) => ({ ...asObject(entry), idempotencyKey: typeof entry === 'string' ? entry : asObject(entry).idempotencyKey, status: 'pending' })) : []),
    ...(Array.isArray(source.failed) ? source.failed.map((entry) => ({ ...asObject(entry), idempotencyKey: typeof entry === 'string' ? entry : asObject(entry).idempotencyKey, status: 'failed' })) : [])
  ];
  const byScopedKey = new Map();

  for (const rawEntry of rawEntries) {
    const entry = normalizeLedgerEntry(rawEntry, asObject(rawEntry).status || 'pending', now);
    if (!entry) {
      continue;
    }
    const previous = byScopedKey.get(entry.scopedCommandKey);
    if (!previous || entry.sequence >= previous.sequence || Date.parse(entry.updatedAt) >= Date.parse(previous.updatedAt)) {
      byScopedKey.set(entry.scopedCommandKey, entry);
    }
  }

  const entries = compactLedgerEntries([...byScopedKey.values()]);
  const completed = entries.filter((entry) => entry.status === 'completed').map((entry) => entry.scopedCommandKey);
  const pending = entries.filter((entry) => entry.status === 'pending').map((entry) => entry.scopedCommandKey);
  const failed = entries.filter((entry) => entry.status === 'failed').map((entry) => entry.scopedCommandKey);
  const expiredPending = entries.filter((entry) => entry.leaseExpired).map((entry) => entry.scopedCommandKey);
  const highWatermark = entries.reduce((max, entry) => Math.max(max, entry.sequence), asNonNegativeInteger(source.highWatermark, 0));

  return {
    highWatermark,
    replayCursor: asTrimmedString(source.replayCursor, highWatermark ? `ledger:${highWatermark}` : 'ledger:0'),
    completed,
    pending,
    failed,
    expiredPending,
    entries,
    compaction: {
      retained: entries.length,
      dropped: Math.max(0, rawEntries.length - entries.length),
      maxRetained: MAX_LEDGER_KEYS
    }
  };
}

function normalizeRecoveryCheckpoint(value, index, now) {
  const source = asObject(value);
  const sequence = asNonNegativeInteger(source.sequence, index + 1);
  const requestedPhase = asTrimmedString(source.phase || source.step, 'replay-ledger');
  const requestedStatus = asTrimmedString(source.status || source.disposition, 'pending');
  const phase = RECOVERY_CHECKPOINT_PHASES.has(requestedPhase) ? requestedPhase : 'replay-ledger';
  const status = RECOVERY_CHECKPOINT_STATUSES.has(requestedStatus) ? requestedStatus : 'pending';
  const capturedAt = asIsoTimestamp(source.capturedAt || source.updatedAt || source.at, now);
  const replayCursor = asTrimmedString(source.replayCursor || source.cursor, `ledger:${sequence}`);
  const scopedCommandKey = asTrimmedString(source.scopedCommandKey || source.commandKey, null);
  const restartSafe = source.restartSafe === false || status === 'failed' ? false : true;

  return {
    type: 'hosted-kernel.recovery-checkpoint.v1',
    checkpointId: asTrimmedString(source.checkpointId || source.id, checksum({ sequence, phase, replayCursor, scopedCommandKey })),
    sequence,
    phase,
    requestedPhase,
    status,
    requestedStatus,
    capturedAt,
    replayCursor,
    scopedCommandKey,
    restartSafe,
    failureCode: asTrimmedString(source.failureCode || source.code, null),
    providerCursor: asTrimmedString(source.providerCursor || source.syncCursor, null),
    stateChecksum: asTrimmedString(source.stateChecksum || source.checksum, null),
    proof: asTrimmedString(source.proof, checksum({
      sequence,
      phase,
      status,
      capturedAt,
      replayCursor,
      scopedCommandKey,
      restartSafe
    }))
  };
}

function compactRecoveryCheckpoints(checkpoints) {
  const byId = new Map();
  for (const checkpoint of checkpoints) {
    if (!checkpoint) {
      continue;
    }
    const previous = byId.get(checkpoint.checkpointId);
    if (!previous || checkpoint.sequence >= previous.sequence || Date.parse(checkpoint.capturedAt) >= Date.parse(previous.capturedAt)) {
      byId.set(checkpoint.checkpointId, checkpoint);
    }
  }

  return [...byId.values()]
    .sort((left, right) => right.sequence - left.sequence || Date.parse(right.capturedAt) - Date.parse(left.capturedAt))
    .slice(0, MAX_RECOVERY_CHECKPOINTS)
    .sort((left, right) => left.sequence - right.sequence || left.checkpointId.localeCompare(right.checkpointId));
}

function buildRecoveryJournal(value, { commandLedger, recovery, health, failureState, now }) {
  const source = asObject(value);
  const rawCheckpoints = [
    ...(Array.isArray(source.checkpoints) ? source.checkpoints : []),
    ...(Array.isArray(source.journal) ? source.journal : []),
    ...(Array.isArray(source.entries) ? source.entries : [])
  ];
  const ledgerResumeCheckpoints = commandLedger.entries
    .filter((entry) => entry.status === 'pending' || entry.leaseExpired)
    .map((entry) => ({
      checkpointId: `ledger:${entry.scopedCommandKey}`,
      phase: entry.leaseExpired ? 'replay-ledger' : 'resume-command',
      status: 'pending',
      sequence: entry.sequence,
      replayCursor: commandLedger.replayCursor,
      scopedCommandKey: entry.scopedCommandKey,
      capturedAt: entry.updatedAt,
      restartSafe: true,
      providerCursor: source.providerCursor
    }));
  const checkpoints = compactRecoveryCheckpoints([
    ...rawCheckpoints.map((checkpoint, index) => normalizeRecoveryCheckpoint(checkpoint, index, now)),
    ...ledgerResumeCheckpoints.map((checkpoint, index) => normalizeRecoveryCheckpoint(checkpoint, rawCheckpoints.length + index, now))
  ]);
  const completed = checkpoints.filter((checkpoint) => checkpoint.status === 'completed');
  const pending = checkpoints.filter((checkpoint) => checkpoint.status === 'pending');
  const failed = checkpoints.filter((checkpoint) => checkpoint.status === 'failed');
  const latestCompleted = completed.at(-1) || null;
  const nextPending = pending.find((checkpoint) => checkpoint.restartSafe) || pending[0] || null;
  const terminalFailure = failed.find((checkpoint) => !checkpoint.restartSafe) || null;
  const invalidCheckpoints = checkpoints.filter((checkpoint) => (
    checkpoint.requestedPhase !== checkpoint.phase || checkpoint.requestedStatus !== checkpoint.status
  ));
  const recoveryRequired = Boolean(
    recovery.required
    || nextPending
    || terminalFailure
    || commandLedger.expiredPending.length
    || !health.healthy
    || failureState.code
  );
  const restartStatus = terminalFailure
    ? 'failed'
    : nextPending || commandLedger.expiredPending.length
      ? 'recovering'
      : recoveryRequired
        ? 'degraded'
        : 'ready';
  const resumeCursor = asTrimmedString(
    source.resumeCursor || recovery.resumeCursor,
    nextPending?.replayCursor || latestCompleted?.replayCursor || commandLedger.replayCursor
  );
  const resumePlan = {
    type: 'hosted-kernel.recovery-resume-plan.v1',
    required: recoveryRequired,
    restartStatus,
    resumeCursor,
    checkpointId: nextPending?.checkpointId || null,
    phase: nextPending?.phase || (recoveryRequired ? 'replay-ledger' : 'complete'),
    scopedCommandKey: nextPending?.scopedCommandKey || commandLedger.expiredPending[0] || null,
    idempotent: Boolean(nextPending || commandLedger.expiredPending.length),
    actions: [
      ...(terminalFailure ? ['handoff-failed-recovery-checkpoint'] : []),
      ...(nextPending ? [`resume-${nextPending.phase}`] : []),
      ...(commandLedger.expiredPending.length ? ['reclaim-expired-command-leases'] : []),
      ...(!health.healthy ? ['refresh-health-before-dispatch'] : []),
      ...(failureState.code ? ['apply-failure-retry-policy'] : [])
    ]
  };

  return {
    type: 'hosted-kernel.recovery-journal.v1',
    generatedAt: now,
    checkpoints,
    retained: checkpoints.length,
    dropped: Math.max(0, rawCheckpoints.length + ledgerResumeCheckpoints.length - checkpoints.length),
    maxRetained: MAX_RECOVERY_CHECKPOINTS,
    completedCheckpointId: latestCompleted?.checkpointId || null,
    pendingCheckpointIds: pending.map((checkpoint) => checkpoint.checkpointId),
    failedCheckpointIds: failed.map((checkpoint) => checkpoint.checkpointId),
    invalidCheckpointIds: invalidCheckpoints.map((checkpoint) => checkpoint.checkpointId),
    resumePlan: {
      ...resumePlan,
      proof: checksum(resumePlan)
    },
    proof: checksum({ checkpoints, resumePlan, invalidCheckpointIds: invalidCheckpoints.map((checkpoint) => checkpoint.checkpointId) })
  };
}

function countBy(values) {
  return values.reduce((counts, value) => {
    const key = asTrimmedString(value, 'unknown');
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function normalizeCounterMap(value) {
  return Object.keys(asObject(value)).sort().reduce((normalized, key) => {
    const count = asNonNegativeInteger(asObject(value)[key], null);
    if (count !== null) {
      normalized[key] = count;
    }
    return normalized;
  }, {});
}

function counterDelta(current = {}, previous = {}) {
  const keys = [...new Set([...Object.keys(current), ...Object.keys(previous)])].sort();
  return keys.reduce((delta, key) => {
    const change = asNonNegativeInteger(current[key], 0) - asNonNegativeInteger(previous[key], 0);
    if (change !== 0) {
      delta[key] = change;
    }
    return delta;
  }, {});
}

function buildAnalyticsTrendSummary(history, currentSnapshot) {
  const previous = history
    .filter((snapshot) => snapshot.snapshotId !== currentSnapshot.snapshotId)
    .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt))[0] || null;
  const previousCounters = previous?.counters || {};
  const currentCounters = currentSnapshot.counters;
  const commandDelta = currentCounters.commandsTotal - asNonNegativeInteger(previousCounters.commandsTotal, 0);
  const failedDelta = currentCounters.failedCommands - asNonNegativeInteger(previousCounters.failedCommands, 0);
  const expiredLeaseDelta = currentCounters.expiredLeases - asNonNegativeInteger(previousCounters.expiredLeases, 0);
  const degradedSignalDelta = currentCounters.degradedSignals - asNonNegativeInteger(previousCounters.degradedSignals, 0);
  const blockedDelta = currentCounters.blockedCommands - asNonNegativeInteger(previousCounters.blockedCommands, 0);
  const recoverableDelta = currentCounters.recoverableCommands - asNonNegativeInteger(previousCounters.recoverableCommands, 0);
  const first = history[0] || currentSnapshot;
  const windowDurationMs = elapsedMsSince(first.capturedAt, currentSnapshot.capturedAt);

  return {
    type: 'hosted-kernel.analytics-trend-summary.v1',
    currentSnapshotId: currentSnapshot.snapshotId,
    previousSnapshotId: previous?.snapshotId || null,
    windowStartAt: first.capturedAt,
    windowEndAt: currentSnapshot.capturedAt,
    windowDurationMs,
    deltas: {
      commandsTotal: commandDelta,
      failedCommands: failedDelta,
      expiredLeases: expiredLeaseDelta,
      degradedSignals: degradedSignalDelta,
      blockedCommands: blockedDelta,
      recoverableCommands: recoverableDelta,
      statusCounts: counterDelta(currentCounters.statusCounts, previousCounters.statusCounts),
      commandTypeCounts: counterDelta(currentCounters.commandTypeCounts, previousCounters.commandTypeCounts),
      lifecycleModeCounts: counterDelta(currentCounters.lifecycleModeCounts, previousCounters.lifecycleModeCounts),
      providerServiceCounts: counterDelta(currentCounters.providerServiceCounts, previousCounters.providerServiceCounts),
      providerStatusCounts: counterDelta(currentCounters.providerStatusCounts, previousCounters.providerStatusCounts),
      readinessCounts: counterDelta(currentCounters.readinessCounts, previousCounters.readinessCounts),
      requiredActionCounts: counterDelta(currentCounters.requiredActionCounts, previousCounters.requiredActionCounts)
    },
    rates: {
      commandsPerMinute: windowDurationMs > 0 ? Number(((currentCounters.commandsTotal / windowDurationMs) * 60_000).toFixed(3)) : 0,
      failureRatio: currentCounters.commandsTotal > 0 ? Number((currentCounters.failedCommands / currentCounters.commandsTotal).toFixed(4)) : 0,
      expiredLeaseRatio: currentCounters.pendingLeases > 0 ? Number((currentCounters.expiredLeases / currentCounters.pendingLeases).toFixed(4)) : 0,
      blockedRatio: currentCounters.commandsTotal > 0 ? Number((currentCounters.blockedCommands / currentCounters.commandsTotal).toFixed(4)) : 0,
      providerStaleRatio: currentCounters.providersTotal > 0 ? Number((currentCounters.staleProviders / currentCounters.providersTotal).toFixed(4)) : 0
    },
    direction: failedDelta > 0 || expiredLeaseDelta > 0 || degradedSignalDelta > 0 || blockedDelta > 0
      ? 'worsening'
      : recoverableDelta > 0
        ? 'recovering'
        : commandDelta > 0
          ? 'active'
          : 'stable'
  };
}

function buildAnalyticsReportingState({ context, currentSnapshot, trendSummary, timeline, exportRows, alertSummary, timelineRollup }) {
  const blockingEvents = timeline.filter((event) => event.severity === 'error');
  const warningEvents = timeline.filter((event) => event.severity === 'warning');
  const openIncidents = [
    ...blockingEvents.map((event) => ({
      type: event.type,
      subject: event.subject,
      openedAt: event.at,
      severity: event.severity,
      proof: event.proof
    })),
    ...(context.operationalHealth.writeSuspended ? [{
      type: 'operational.write-suspended',
      subject: context.operationalHealth.mode,
      openedAt: context.now,
      severity: 'error',
      proof: context.operationalHealth.proof
    }] : []),
    ...(context.operationalHealth.failureRemediation?.actionRequired ? [{
      type: 'failure.remediation-required',
      subject: context.operationalHealth.failureRemediation.auditSubject,
      openedAt: context.now,
      severity: context.operationalHealth.failureRemediation.severity,
      proof: context.operationalHealth.failureRemediation.proof
    }] : []),
    ...alertSummary.alerts
      .filter((alert) => alert.severity === 'error')
      .map((alert) => ({
        type: 'analytics.alert',
        subject: alert.metric,
        openedAt: context.now,
        severity: alert.severity,
        proof: alert.proof
      }))
  ];
  const routeIntents = [
    ...(context.health.degradedReasons.length ? ['hosted-kernel.health.refresh-probe'] : []),
    ...(context.providerRegistry.staleProviderIds.length ? ['hosted-kernel.provider.refresh-sync'] : []),
    ...(context.failureState.code ? [context.operationalHealth.failureRemediation.routeIntent] : []),
    ...(context.operationalHealth.writeSuspended ? ['hosted-kernel.readiness.review'] : []),
    ...alertSummary.routeIntents
  ];

  return {
    type: 'hosted-kernel.analytics-reporting-state.v1',
    generatedAt: context.now,
    status: context.status,
    health: blockingEvents.length || context.operationalHealth.writeSuspended || alertSummary.highestSeverity === 'error'
      ? 'attention-required'
      : warningEvents.length || alertSummary.highestSeverity === 'warning'
        ? 'watch'
        : 'nominal',
    openIncidentCount: openIncidents.length,
    warningEventCount: warningEvents.length,
    timelineEventCount: timelineRollup.eventCount,
    timelineHighestSeverity: timelineRollup.highestSeverity,
    openIncidents,
    routeIntents: [...new Set(routeIntents)].sort(),
    alertSummary,
    exportReadiness: {
      ready: exportRows.length > 0,
      rowCount: exportRows.length,
      snapshotId: currentSnapshot.snapshotId,
      replayCursor: context.commandLedger.replayCursor,
      proof: checksum({ exportRows, snapshotId: currentSnapshot.snapshotId, replayCursor: context.commandLedger.replayCursor })
    },
    trendDirection: trendSummary.direction,
    proof: checksum({
      status: context.status,
      incidents: openIncidents,
      routeIntents,
      trendDirection: trendSummary.direction,
      alertProof: alertSummary.proof,
      timelineProof: timelineRollup.proof
    })
  };
}

function normalizeAnalyticsSnapshot(value) {
  const source = asObject(value);
  const capturedAt = asIsoTimestamp(source.capturedAt || source.generatedAt || source.at, null);
  if (!capturedAt) {
    return null;
  }
  const counters = asObject(source.counters);
  const statusCounts = asObject(counters.statusCounts || source.statusCounts);
  const commandTypeCounts = asObject(counters.commandTypeCounts || source.commandTypeCounts);

  return {
    type: 'hosted-kernel.analytics-snapshot.v1',
    snapshotId: asTrimmedString(source.snapshotId || source.id, checksum({ capturedAt, counters })),
    capturedAt,
    status: asTrimmedString(source.status, 'unknown'),
    sequence: asNonNegativeInteger(source.sequence, 0),
    counters: {
      commandsTotal: asNonNegativeInteger(counters.commandsTotal, 0),
      statusCounts: normalizeCounterMap(statusCounts),
      commandTypeCounts: normalizeCounterMap(commandTypeCounts),
      pendingLeases: asNonNegativeInteger(counters.pendingLeases, 0),
      expiredLeases: asNonNegativeInteger(counters.expiredLeases, 0),
      failedCommands: asNonNegativeInteger(counters.failedCommands, 0),
      blockedCommands: asNonNegativeInteger(counters.blockedCommands, 0),
      recoverableCommands: asNonNegativeInteger(counters.recoverableCommands, 0),
      actionRequiredSignals: asNonNegativeInteger(counters.actionRequiredSignals, 0),
      providersTotal: asNonNegativeInteger(counters.providersTotal, 0),
      activeProviders: asNonNegativeInteger(counters.activeProviders, 0),
      staleProviders: asNonNegativeInteger(counters.staleProviders, 0),
      degradedSignals: asNonNegativeInteger(counters.degradedSignals, 0),
      lifecycleModeCounts: normalizeCounterMap(counters.lifecycleModeCounts || source.lifecycleModeCounts),
      providerServiceCounts: normalizeCounterMap(counters.providerServiceCounts || source.providerServiceCounts),
      providerStatusCounts: normalizeCounterMap(counters.providerStatusCounts || source.providerStatusCounts),
      readinessCounts: normalizeCounterMap(counters.readinessCounts || source.readinessCounts),
      requiredActionCounts: normalizeCounterMap(counters.requiredActionCounts || source.requiredActionCounts)
    },
    proof: asTrimmedString(source.proof, checksum({ capturedAt, counters, status: source.status }))
  };
}

function compactAnalyticsHistory(snapshots) {
  const byId = new Map();
  for (const snapshot of snapshots) {
    if (!snapshot) {
      continue;
    }
    const previous = byId.get(snapshot.snapshotId);
    if (!previous || Date.parse(snapshot.capturedAt) >= Date.parse(previous.capturedAt)) {
      byId.set(snapshot.snapshotId, snapshot);
    }
  }
  return [...byId.values()]
    .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt))
    .slice(0, MAX_ANALYTICS_HISTORY_SNAPSHOTS)
    .sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt));
}

function buildAnalyticsTimeline({ now, status, commandLedger, health, failureState, lifecycleSettings, providerRegistry, recoveryJournal, operationalHealth }) {
  const ledgerEvents = commandLedger.entries.map((entry) => ({
    at: entry.updatedAt,
    type: `command.${entry.status}`,
    subject: entry.commandType,
    summary: `${entry.commandType} ${entry.status} at ledger sequence ${entry.sequence}.`,
    severity: entry.status === 'failed' ? 'error' : entry.leaseExpired ? 'warning' : 'info',
    proof: entry.auditProof
  }));
  const healthEvents = health.degradedReasons.map((reason) => ({
    at: health.lastProbeAt || now,
    type: 'health.degraded',
    subject: reason,
    summary: `Hosted-kernel health reported ${reason}.`,
    severity: reason.endsWith('-failed') ? 'error' : 'warning',
    proof: checksum({ reason, health })
  }));
  const providerEvents = providerRegistry.staleProviderIds.map((providerId) => ({
    at: providerRegistry.lastSyncedAt,
    type: 'provider.sync-stale',
    subject: providerId,
    summary: `Provider ${providerId} has stale synchronization metadata.`,
    severity: 'warning',
    proof: providerRegistry.proof
  }));
  const lifecycleEvent = {
    at: now,
    type: 'lifecycle.mode',
    subject: lifecycleSettings.mode,
    summary: `Lifecycle mode is ${lifecycleSettings.mode}.`,
    severity: lifecycleSettings.mode === 'enabled' ? 'info' : 'warning',
    proof: lifecycleSettings.proof
  };
  const failureEvent = failureState.code
    ? [{
      at: failureState.lastFailureAt || now,
      type: 'failure.state',
      subject: failureState.code,
      summary: failureState.retryable ? `Failure ${failureState.code} is retryable.` : `Failure ${failureState.code} requires operator recovery.`,
      severity: failureState.retryable ? 'warning' : 'error',
      proof: checksum(failureState)
    }]
    : [];
  const recoveryEvents = (recoveryJournal?.checkpoints || []).map((checkpoint) => ({
    at: checkpoint.capturedAt,
    type: `recovery.${checkpoint.status}`,
    subject: checkpoint.phase,
    summary: `Recovery checkpoint ${checkpoint.checkpointId} is ${checkpoint.status} in phase ${checkpoint.phase}.`,
    severity: checkpoint.status === 'failed' ? 'error' : checkpoint.status === 'pending' ? 'warning' : 'info',
    proof: checkpoint.proof
  }));
  const actionEvents = (operationalHealth?.actions || []).map((action) => ({
    at: action.dueAt || now,
    type: `action.${action.type}`,
    subject: action.routeIntent,
    summary: `Operational action ${action.type} is routed to ${action.routeIntent}.`,
    severity: action.blocksWrites || action.type === 'handoff-terminal-failure' ? 'error' : 'warning',
    proof: action.proof
  }));

  return [...ledgerEvents, ...healthEvents, ...providerEvents, lifecycleEvent, ...failureEvent, ...recoveryEvents, ...actionEvents]
    .filter((event) => asIsoTimestamp(event.at, null))
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
    .slice(0, MAX_ANALYTICS_TIMELINE_EVENTS)
    .map((event, index) => ({
      ...event,
      index,
      status,
      eventId: checksum({ index, event })
    }));
}

function metricRowsFromCounterMap({ prefix, counters, snapshotId, capturedAt, dimensions = {}, severity = 'info', unit = 'count' }) {
  return Object.keys(counters).sort().map((name) => {
    const value = counters[name];
    return {
      metric: `${prefix}.${name}`,
      value,
      unit,
      snapshotId,
      capturedAt,
      dimensions: {
        ...dimensions,
        name
      },
      severity,
      proof: checksum({ prefix, name, value, snapshotId, dimensions })
    };
  });
}

function highestAnalyticsSeverity(values) {
  return values.reduce((highest, severity) => (
    (ANALYTICS_REPORT_SEVERITY_ORDER.get(severity) || 0) > (ANALYTICS_REPORT_SEVERITY_ORDER.get(highest) || 0)
      ? severity
      : highest
  ), 'info');
}

function classifyAnalyticsAlert(metric, value, dimensions = {}) {
  const threshold = ANALYTICS_ALERT_THRESHOLDS[metric];
  if (!threshold) {
    return null;
  }
  const severity = value >= threshold.error
    ? 'error'
    : value >= threshold.warning
      ? 'warning'
      : 'info';

  if (severity === 'info') {
    return null;
  }

  return {
    metric,
    value,
    severity,
    dimensions,
    threshold: {
      warning: threshold.warning,
      error: threshold.error
    },
    routeIntent: severity === 'error'
      ? 'hosted-kernel.analytics.escalate'
      : 'hosted-kernel.analytics.watch',
    proof: checksum({ metric, value, severity, dimensions, threshold })
  };
}

function buildAnalyticsAlertSummary(currentCounters, trendSummary, context) {
  const candidates = [
    ['failedCommands', currentCounters.failedCommands, { family: 'commands' }],
    ['expiredLeases', currentCounters.expiredLeases, { family: 'leases' }],
    ['blockedCommands', currentCounters.blockedCommands, { family: 'commands' }],
    ['staleProviders', currentCounters.staleProviders, { family: 'providers' }],
    ['degradedSignals', currentCounters.degradedSignals, { family: 'health' }],
    ['failureRatio', trendSummary.rates.failureRatio, { family: 'ratios' }],
    ['blockedRatio', trendSummary.rates.blockedRatio, { family: 'ratios' }],
    ['providerStaleRatio', trendSummary.rates.providerStaleRatio, { family: 'ratios' }]
  ];
  const alerts = candidates
    .map(([metric, value, dimensions]) => classifyAnalyticsAlert(metric, value, {
      ...dimensions,
      surfaceId,
      status: context.status,
      lifecycleMode: context.lifecycleSettings.mode
    }))
    .filter(Boolean);
  const blockingAlertMetrics = alerts.filter((alert) => alert.severity === 'error').map((alert) => alert.metric).sort();

  return {
    type: 'hosted-kernel.analytics-alert-summary.v1',
    generatedAt: context.now,
    alertCount: alerts.length,
    highestSeverity: highestAnalyticsSeverity(alerts.map((alert) => alert.severity)),
    blockingAlertMetrics,
    watchAlertMetrics: alerts.filter((alert) => alert.severity === 'warning').map((alert) => alert.metric).sort(),
    routeIntents: [...new Set(alerts.map((alert) => alert.routeIntent))].sort(),
    alerts,
    proof: checksum({ alerts, status: context.status, lifecycleMode: context.lifecycleSettings.mode })
  };
}

function buildAnalyticsTimelineRollup(timeline) {
  const severityCounts = normalizeCounterMap(countBy(timeline.map((event) => event.severity)));
  const typeCounts = normalizeCounterMap(countBy(timeline.map((event) => event.type)));
  const subjectCounts = normalizeCounterMap(countBy(timeline.map((event) => event.subject)));
  const firstEventAt = timeline.length
    ? timeline.reduce((first, event) => (Date.parse(event.at) < Date.parse(first) ? event.at : first), timeline[0].at)
    : null;
  const lastEventAt = timeline.length
    ? timeline.reduce((last, event) => (Date.parse(event.at) > Date.parse(last) ? event.at : last), timeline[0].at)
    : null;
  const routeSubjects = timeline
    .filter((event) => event.type.startsWith('action.'))
    .map((event) => event.subject);

  return {
    type: 'hosted-kernel.analytics-timeline-rollup.v1',
    eventCount: timeline.length,
    firstEventAt,
    lastEventAt,
    highestSeverity: highestAnalyticsSeverity(timeline.map((event) => event.severity)),
    severityCounts,
    typeCounts,
    subjectCounts,
    routeSubjects: [...new Set(routeSubjects)].sort(),
    proof: checksum({ severityCounts, typeCounts, subjectCounts, firstEventAt, lastEventAt })
  };
}

function buildAnalyticsCounterCards(currentCounters, trendSummary, alertSummary, currentSnapshot) {
  const cardDefinitions = [
    ['commands', 'Commands', currentCounters.commandsTotal, trendSummary.deltas.commandsTotal, 'commandsTotal'],
    ['failed', 'Failed', currentCounters.failedCommands, trendSummary.deltas.failedCommands, 'failedCommands'],
    ['blocked', 'Blocked', currentCounters.blockedCommands, trendSummary.deltas.blockedCommands, 'blockedCommands'],
    ['recoverable', 'Recoverable', currentCounters.recoverableCommands, trendSummary.deltas.recoverableCommands, 'recoverableCommands'],
    ['providers', 'Providers', currentCounters.providersTotal, currentCounters.staleProviders, 'staleProviders'],
    ['degraded', 'Degraded Signals', currentCounters.degradedSignals, trendSummary.deltas.degradedSignals, 'degradedSignals']
  ];
  const alertByMetric = new Map(alertSummary.alerts.map((alert) => [alert.metric, alert]));

  return cardDefinitions.map(([cardId, label, value, delta, alertMetric]) => {
    const alert = alertByMetric.get(alertMetric) || null;
    const card = {
      type: 'hosted-kernel.analytics-counter-card.v1',
      cardId,
      label,
      value,
      delta,
      severity: alert?.severity || (delta > 0 && ['failed', 'blocked', 'degraded'].includes(cardId) ? 'warning' : 'info'),
      snapshotId: currentSnapshot.snapshotId,
      alertProof: alert?.proof || null
    };

    return {
      ...card,
      proof: checksum(card)
    };
  });
}

function buildAnalyticsExportViews({ exportRows, timeline, currentSnapshot, context, alertSummary, timelineRollup, counterCards }) {
  const rowsBySeverity = exportRows.reduce((summary, row) => {
    summary[row.severity] = (summary[row.severity] || 0) + 1;
    return summary;
  }, {});
  const metricFamilies = [...new Set(exportRows.map((row) => row.metric.split('.')[0]))].sort();
  const timelineRows = timeline.map((event) => ({
    eventId: event.eventId,
    at: event.at,
    type: event.type,
    subject: event.subject,
    severity: event.severity,
    status: event.status,
    proof: event.proof
  }));
  const jsonlPreview = exportRows.slice(0, 10).map((row) => stableStringify({
    metric: row.metric,
    value: row.value,
    unit: row.unit,
    capturedAt: row.capturedAt,
    severity: row.severity,
    dimensions: row.dimensions,
    proof: row.proof
  }));
  const views = {
    type: 'hosted-kernel.analytics-export-views.v1',
    generatedAt: context.now,
    snapshotId: currentSnapshot.snapshotId,
    replayCursor: context.commandLedger.replayCursor,
    metricFamilies,
    rowsBySeverity: normalizeCounterMap(rowsBySeverity),
    alertCount: alertSummary.alertCount,
    timelineEventCount: timelineRows.length,
    cards: counterCards,
    timelineRows,
    jsonlPreview,
    manifestDimensions: {
      surfaceId,
      status: context.status,
      lifecycleMode: context.lifecycleSettings.mode,
      providerRegistryCursor: context.providerRegistry.syncCursor,
      ledgerReplayCursor: context.commandLedger.replayCursor,
      timelineHighestSeverity: timelineRollup.highestSeverity,
      alertHighestSeverity: alertSummary.highestSeverity
    }
  };

  return {
    ...views,
    proof: checksum(views)
  };
}

function buildHostedKernelAnalytics(value, context) {
  const source = asObject(value);
  const ledgerEntries = context.commandLedger.entries;
  const statusCounts = normalizeCounterMap(countBy(ledgerEntries.map((entry) => entry.status)));
  const commandTypeCounts = normalizeCounterMap(countBy(ledgerEntries.map((entry) => entry.commandType)));
  const providerServiceCounts = normalizeCounterMap(countBy(context.providerRegistry.providers.map((provider) => provider.service)));
  const providerStatusCounts = normalizeCounterMap(countBy(context.providerRegistry.providers.map((provider) => provider.status)));
  const requiredActionCounts = normalizeCounterMap(countBy(context.operationalHealth.actions.map((action) => action.type)));
  const lifecycleModeCounts = normalizeCounterMap(countBy([context.lifecycleSettings.mode]));
  const readinessCounts = normalizeCounterMap({
    ready: context.operationalHealth.healthy ? 1 : 0,
    degraded: context.operationalHealth.mode === 'degraded-remediation' ? 1 : 0,
    blocked: context.operationalHealth.writeSuspended || context.status === 'failed' ? 1 : 0,
    recovering: context.status === 'recovering' ? 1 : 0
  });
  const currentCounters = {
    commandsTotal: ledgerEntries.length,
    statusCounts,
    commandTypeCounts,
    pendingLeases: context.commandLedger.pending.length,
    expiredLeases: context.commandLedger.expiredPending.length,
    failedCommands: context.commandLedger.failed.length,
    blockedCommands: context.commandLedger.failed.length + context.commandLedger.expiredPending.length + (context.operationalHealth.writeSuspended ? 1 : 0),
    recoverableCommands: context.commandLedger.pending.length + context.commandLedger.expiredPending.length + (context.retryBackoff.retryable ? 1 : 0),
    actionRequiredSignals: context.operationalHealth.actions.length + (context.recoveryJournal?.resumePlan?.required ? 1 : 0),
    providersTotal: context.providerRegistry.providers.length,
    activeProviders: context.providerRegistry.activeProviderIds.length,
    staleProviders: context.providerRegistry.staleProviderIds.length,
    degradedSignals: context.health.degradedReasons.length + (context.failureState.code ? 1 : 0),
    lifecycleModeCounts,
    providerServiceCounts,
    providerStatusCounts,
    readinessCounts,
    requiredActionCounts
  };
  const currentSnapshot = {
    type: 'hosted-kernel.analytics-snapshot.v1',
    snapshotId: checksum({
      at: context.now,
      sequence: context.sequence,
      highWatermark: context.commandLedger.highWatermark,
      counters: currentCounters
    }),
    capturedAt: context.now,
    status: context.status,
    sequence: context.sequence,
    counters: currentCounters
  };
  currentSnapshot.proof = checksum(currentSnapshot);

  const previousSnapshots = [
    ...(Array.isArray(source.history) ? source.history : []),
    ...(Array.isArray(source.snapshots) ? source.snapshots : [])
  ].map(normalizeAnalyticsSnapshot);
  const history = compactAnalyticsHistory([...previousSnapshots, currentSnapshot]);
  const timeline = buildAnalyticsTimeline(context);
  const trendSummary = buildAnalyticsTrendSummary(history, currentSnapshot);
  const exportRows = [
    ['commands.total', currentCounters.commandsTotal, 'count', 'info'],
    ['commands.pending', currentCounters.pendingLeases, 'count', currentCounters.pendingLeases ? 'warning' : 'info'],
    ['commands.failed', currentCounters.failedCommands, 'count', currentCounters.failedCommands ? 'error' : 'info'],
    ['commands.blocked', currentCounters.blockedCommands, 'count', currentCounters.blockedCommands ? 'error' : 'info'],
    ['commands.recoverable', currentCounters.recoverableCommands, 'count', currentCounters.recoverableCommands ? 'warning' : 'info'],
    ['leases.expired', currentCounters.expiredLeases, 'count', currentCounters.expiredLeases ? 'warning' : 'info'],
    ['providers.total', currentCounters.providersTotal, 'count', 'info'],
    ['providers.active', currentCounters.activeProviders, 'count', 'info'],
    ['providers.stale', currentCounters.staleProviders, 'count', currentCounters.staleProviders ? 'warning' : 'info'],
    ['health.degradedSignals', currentCounters.degradedSignals, 'count', currentCounters.degradedSignals ? 'warning' : 'info'],
    ['actions.requiredSignals', currentCounters.actionRequiredSignals, 'count', currentCounters.actionRequiredSignals ? 'warning' : 'info'],
    ['trend.commandsTotal.delta', trendSummary.deltas.commandsTotal, 'count', 'info'],
    ['trend.failedCommands.delta', trendSummary.deltas.failedCommands, 'count', trendSummary.deltas.failedCommands > 0 ? 'error' : 'info'],
    ['trend.expiredLeases.delta', trendSummary.deltas.expiredLeases, 'count', trendSummary.deltas.expiredLeases > 0 ? 'warning' : 'info'],
    ['trend.degradedSignals.delta', trendSummary.deltas.degradedSignals, 'count', trendSummary.deltas.degradedSignals > 0 ? 'warning' : 'info'],
    ['trend.blockedCommands.delta', trendSummary.deltas.blockedCommands, 'count', trendSummary.deltas.blockedCommands > 0 ? 'error' : 'info'],
    ['rate.commandsPerMinute', trendSummary.rates.commandsPerMinute, 'per-minute', 'info'],
    ['ratio.failure', trendSummary.rates.failureRatio, 'ratio', trendSummary.rates.failureRatio > 0 ? 'warning' : 'info'],
    ['ratio.expiredLease', trendSummary.rates.expiredLeaseRatio, 'ratio', trendSummary.rates.expiredLeaseRatio > 0 ? 'warning' : 'info'],
    ['ratio.blocked', trendSummary.rates.blockedRatio, 'ratio', trendSummary.rates.blockedRatio > 0 ? 'error' : 'info'],
    ['ratio.providerStale', trendSummary.rates.providerStaleRatio, 'ratio', trendSummary.rates.providerStaleRatio > 0 ? 'warning' : 'info']
  ].map(([metric, value, unit, severity]) => ({
    metric,
    value,
    unit,
    snapshotId: currentSnapshot.snapshotId,
    capturedAt: currentSnapshot.capturedAt,
    dimensions: {
      surfaceId,
      status: context.status,
      lifecycleMode: context.lifecycleSettings.mode
    },
    severity,
    proof: checksum({ metric, value, unit, severity, snapshotId: currentSnapshot.snapshotId, status: context.status })
  }));
  exportRows.push(
    ...metricRowsFromCounterMap({
      prefix: 'commands.byStatus',
      counters: currentCounters.statusCounts,
      snapshotId: currentSnapshot.snapshotId,
      capturedAt: currentSnapshot.capturedAt,
      dimensions: { surfaceId, status: context.status },
      severity: 'info'
    }),
    ...metricRowsFromCounterMap({
      prefix: 'commands.byType',
      counters: currentCounters.commandTypeCounts,
      snapshotId: currentSnapshot.snapshotId,
      capturedAt: currentSnapshot.capturedAt,
      dimensions: { surfaceId, status: context.status },
      severity: 'info'
    }),
    ...metricRowsFromCounterMap({
      prefix: 'providers.byService',
      counters: currentCounters.providerServiceCounts,
      snapshotId: currentSnapshot.snapshotId,
      capturedAt: currentSnapshot.capturedAt,
      dimensions: { surfaceId },
      severity: 'info'
    }),
    ...metricRowsFromCounterMap({
      prefix: 'actions.byType',
      counters: currentCounters.requiredActionCounts,
      snapshotId: currentSnapshot.snapshotId,
      capturedAt: currentSnapshot.capturedAt,
      dimensions: { surfaceId, status: context.status },
      severity: Object.keys(currentCounters.requiredActionCounts).length ? 'warning' : 'info'
    })
  );
  const alertSummary = buildAnalyticsAlertSummary(currentCounters, trendSummary, context);
  const timelineRollup = buildAnalyticsTimelineRollup(timeline);
  const counterCards = buildAnalyticsCounterCards(currentCounters, trendSummary, alertSummary, currentSnapshot);
  exportRows.push(
    ...metricRowsFromCounterMap({
      prefix: 'readiness.byState',
      counters: currentCounters.readinessCounts,
      snapshotId: currentSnapshot.snapshotId,
      capturedAt: currentSnapshot.capturedAt,
      dimensions: { surfaceId, status: context.status },
      severity: currentCounters.readinessCounts.blocked ? 'error' : currentCounters.readinessCounts.degraded ? 'warning' : 'info'
    }),
    ...metricRowsFromCounterMap({
      prefix: 'lifecycle.byMode',
      counters: currentCounters.lifecycleModeCounts,
      snapshotId: currentSnapshot.snapshotId,
      capturedAt: currentSnapshot.capturedAt,
      dimensions: { surfaceId, status: context.status },
      severity: context.lifecycleSettings.mode === 'enabled' ? 'info' : 'warning'
    }),
    ...metricRowsFromCounterMap({
      prefix: 'providers.byStatus',
      counters: currentCounters.providerStatusCounts,
      snapshotId: currentSnapshot.snapshotId,
      capturedAt: currentSnapshot.capturedAt,
      dimensions: { surfaceId },
      severity: currentCounters.staleProviders ? 'warning' : 'info'
    }),
    ...metricRowsFromCounterMap({
      prefix: 'timeline.bySeverity',
      counters: timelineRollup.severityCounts,
      snapshotId: currentSnapshot.snapshotId,
      capturedAt: currentSnapshot.capturedAt,
      dimensions: { surfaceId, status: context.status },
      severity: timelineRollup.highestSeverity
    }),
    ...metricRowsFromCounterMap({
      prefix: 'alerts.bySeverity',
      counters: normalizeCounterMap(countBy(alertSummary.alerts.map((alert) => alert.severity))),
      snapshotId: currentSnapshot.snapshotId,
      capturedAt: currentSnapshot.capturedAt,
      dimensions: { surfaceId, status: context.status },
      severity: alertSummary.highestSeverity
    })
  );
  const exportViews = buildAnalyticsExportViews({
    exportRows,
    timeline,
    currentSnapshot,
    context,
    alertSummary,
    timelineRollup,
    counterCards
  });
  const exportManifest = {
    type: 'hosted-kernel.analytics-export-manifest.v1',
    generatedAt: context.now,
    snapshotId: currentSnapshot.snapshotId,
    replayCursor: context.commandLedger.replayCursor,
    formats: ['json', 'jsonl-metrics', 'timeline-json', 'dashboard-cards'],
    rowCount: exportRows.length,
    timelineEventCount: timeline.length,
    alertCount: alertSummary.alertCount,
    metricFamilies: exportViews.metricFamilies,
    includesTrendDeltas: true,
    proof: checksum({
      exportRows,
      timelineCount: timeline.length,
      alertSummary,
      exportViewsProof: exportViews.proof,
      snapshotId: currentSnapshot.snapshotId
    })
  };
  const reportingState = buildAnalyticsReportingState({
    context,
    currentSnapshot,
    trendSummary,
    timeline,
    exportRows,
    alertSummary,
    timelineRollup
  });
  const report = {
    type: 'hosted-kernel.analytics-report.v1',
    generatedAt: context.now,
    status: context.status,
    ledgerReplayCursor: context.commandLedger.replayCursor,
    historyWindow: {
      retained: history.length,
      maxRetained: MAX_ANALYTICS_HISTORY_SNAPSHOTS,
      firstCapturedAt: history[0]?.capturedAt || currentSnapshot.capturedAt,
      lastCapturedAt: history.at(-1)?.capturedAt || currentSnapshot.capturedAt
    },
    exportReady: true,
    exportSummary: {
      type: 'hosted-kernel.analytics-export-summary.v1',
      format: 'jsonl-ready-metrics',
      rows: exportRows,
      manifest: exportManifest,
      dimensions: {
        surfaceId,
        status: context.status,
        lifecycleMode: context.lifecycleSettings.mode,
        providerRegistryCursor: context.providerRegistry.syncCursor,
        ledgerReplayCursor: context.commandLedger.replayCursor
      },
      proof: checksum({ exportRows, cursor: context.commandLedger.replayCursor, status: context.status })
    },
    trendSummary,
    alertSummary,
    timelineRollup,
    counterCards,
    exportViews,
    reportingState,
    proof: checksum({ currentSnapshot, history, timeline, trendSummary, alertSummary, timelineRollup, counterCards, exportViews, reportingState })
  };

  return {
    version: 1,
    currentSnapshot,
    history,
    counters: currentCounters,
    timeline,
    trendSummary,
    alertSummary,
    timelineRollup,
    counterCards,
    reportingState,
    exportManifest,
    exportViews,
    report,
    proof: checksum({ currentSnapshot, history, timeline, trendSummary, alertSummary, timelineRollup, counterCards, exportViews, reportingState, report })
  };
}

export function shapePersistedKernelState(snapshot = {}, options = {}) {
  const now = asIsoTimestamp(options.now, new Date().toISOString());
  const source = asObject(snapshot);
  const prior = source.contractVersion === CONTRACT_VERSION && source.surfaceId === surfaceId
    ? source
    : asObject(source.persistedKernelState || source.state);
  const boot = asObject(prior.boot);
  const recovery = asObject(prior.recovery);
  const commandLedger = normalizeCommandLedger(prior.commandLedger, now);
  const requestedScope = normalizeScope(asObject(options.command), asObject(options.command?.payload));
  const rawStatus = typeof prior.status === 'string' ? prior.status : '';
  const status = STATUS_PRECEDENCE.has(rawStatus) ? rawStatus : 'cold-start';
  const sequence = Number.isSafeInteger(prior.sequence) && prior.sequence >= 0 ? prior.sequence : 0;
  const recoveredFrom = typeof recovery.recoveredFrom === 'string' ? recovery.recoveredFrom : null;
  const lastPersistedAt = asIsoTimestamp(prior.lastPersistedAt, now);
  const workspaceScopes = normalizeWorkspaceScopes(prior.workspaceScopes || prior.tenants, requestedScope);
  const health = normalizeHealthProbes(prior.health || prior.healthProbes, now);
  const failureState = normalizeFailureState(prior.failureState || prior.lastFailure, now);
  const lifecycleSettings = normalizeLifecycleSettings(prior.lifecycleSettings || prior.settings?.lifecycle, now);
  const providerRegistry = normalizeProviderRegistry(prior.providerRegistry || prior.providers || prior.integrations?.providers, now);
  const recoveryJournal = buildRecoveryJournal(prior.recoveryJournal || recovery.journal || recovery, {
    commandLedger,
    recovery,
    health,
    failureState,
    now
  });
  const restartStatus = recoveryJournal.resumePlan.restartStatus;
  const shapedStatus = restartStatus === 'failed'
    ? 'failed'
    : restartStatus === 'recovering' && (status === 'ready' || status === 'cold-start' || status === 'degraded')
      ? 'recovering'
      : status === 'ready' && !health.healthy
    ? 'degraded'
    : status === 'ready' && failureState.code && !failureState.retryable
      ? 'failed'
      : restartStatus === 'degraded' && status === 'ready'
        ? 'degraded'
        : status;
  const retryBackoff = retryBackoffForFailure(failureState, now);
  const operationalHealth = buildOperationalHealthPlan({
    status: shapedStatus,
    health,
    failureState,
    retryBackoff,
    lifecycleSettings,
    providerRegistry,
    now
  });

  const shaped = {
    contractVersion: CONTRACT_VERSION,
    surfaceId,
    status: shapedStatus,
    sequence,
    lastPersistedAt,
    boot: {
      bootId: typeof boot.bootId === 'string' && boot.bootId ? boot.bootId : checksum({ surfaceId, now, sequence }),
      startedAt: asIsoTimestamp(boot.startedAt, now)
    },
    recovery: {
      required: recoveryJournal.resumePlan.required || shapedStatus === 'recovering' || shapedStatus === 'degraded' || shapedStatus === 'failed' || !health.healthy || Boolean(failureState.code),
      recoveredFrom,
      lastRecoveryAt: asIsoTimestamp(recovery.lastRecoveryAt, recoveredFrom ? now : null),
      resumeCursor: recoveryJournal.resumePlan.resumeCursor,
      restartStatus: recoveryJournal.resumePlan.restartStatus,
      journalProof: recoveryJournal.proof,
      resumePlanProof: recoveryJournal.resumePlan.proof
    },
    recoveryJournal,
    health,
    failureState,
    retryBackoff,
    failureRemediation: operationalHealth.failureRemediation,
    operationalHealth,
    commandLedger,
    lifecycleSettings,
    lifecycleNextAction: lifecycleNextAction(lifecycleSettings, now),
    providerRegistry,
    workspaceScopes,
    analytics: buildHostedKernelAnalytics(prior.analytics || prior.analyticsHistory || prior.reports?.analytics, {
      now,
      status: shapedStatus,
      sequence,
      commandLedger,
      health,
      failureState,
      retryBackoff,
      lifecycleSettings,
      providerRegistry,
      recoveryJournal,
      operationalHealth
    })
  };

  return {
    ...shaped,
    stateChecksum: checksum(shaped)
  };
}

export function recoverKernelStatus(persistedState = {}, command = {}) {
  const issuedAt = asIsoTimestamp(command.issuedAt, new Date().toISOString());
  const activeCommand = normalizeCommand(command, issuedAt);
  const state = shapePersistedKernelState(persistedState, { now: activeCommand.issuedAt, command: activeCommand });
  const scope = activeCommand.scope;
  const boundary = resolveWorkspaceBoundary(state.workspaceScopes, scope, activeCommand.type);
  const scopedCommandKey = checksum({ key: activeCommand.idempotencyKey, scopeKey: scope.scopeKey });
  const commandLedgerEntry = state.commandLedger.entries.find((entry) => (
    entry.scopedCommandKey === scopedCommandKey
    || (entry.idempotencyKey === activeCommand.idempotencyKey && (!entry.scopeKey || entry.scopeKey === scope.scopeKey))
  )) || null;
  const alreadyCompleted = commandLedgerEntry?.status === 'completed';
  const alreadyPending = commandLedgerEntry?.status === 'pending';
  const alreadyFailed = commandLedgerEntry?.status === 'failed';
  const pendingLeaseExpired = alreadyPending && commandLedgerEntry.leaseExpired;
  const idempotentDisposition = alreadyCompleted
    ? 'completed'
    : pendingLeaseExpired
      ? 'pending-expired'
      : alreadyPending
        ? 'pending'
        : alreadyFailed
          ? 'failed'
          : 'new';
  let status = state.status;
  const recoveryActions = [];
  const retryBackoff = state.retryBackoff || retryBackoffForFailure(state.failureState, activeCommand.issuedAt);
  const operationalHealth = state.operationalHealth || buildOperationalHealthPlan({
    status,
    health: state.health,
    failureState: state.failureState,
    retryBackoff,
    lifecycleSettings: state.lifecycleSettings,
    providerRegistry: state.providerRegistry,
    now: activeCommand.issuedAt
  });
  const lifecycle = lifecycleGateForCommand(state.lifecycleSettings, activeCommand);
  const lifecycleCommandPlan = buildLifecycleCommandPlan(activeCommand, state.lifecycleSettings, activeCommand.issuedAt);
  const providerNegotiation = negotiateProviderCapabilities(state.providerRegistry, activeCommand, boundary, activeCommand.issuedAt);

  if (!boundary.allowed) {
    status = 'failed';
    recoveryActions.push('deny-cross-boundary-command');
    recoveryActions.push('handoff-denial-to-audit');
  } else if (!lifecycle.commandAllowed) {
    status = 'ready';
    recoveryActions.push('block-command-by-lifecycle-settings');
    recoveryActions.push(lifecycle.nextAction.type);
  } else if (!providerNegotiation.ready) {
    status = providerNegotiation.externalHandoff.required ? 'degraded' : 'failed';
    recoveryActions.push('negotiate-hosted-kernel-provider-capabilities');
    recoveryActions.push(providerNegotiation.externalHandoff.required ? 'handoff-command-to-external-provider' : 'block-command-for-provider-contract');
  } else if (alreadyCompleted) {
    status = 'ready';
    recoveryActions.push('return-prior-command-result');
  } else if (pendingLeaseExpired) {
    status = 'recovering';
    recoveryActions.push('reclaim-expired-command-lease');
    recoveryActions.push('replay-command-from-ledger-cursor');
  } else if (alreadyPending) {
    status = 'recovering';
    recoveryActions.push('resume-pending-command');
  } else if (alreadyFailed) {
    status = retryBackoff.retryable ? 'degraded' : 'failed';
    recoveryActions.push(retryBackoff.retryable ? 'schedule-command-retry' : 'halt-exhausted-command-retry');
  } else if (state.recoveryJournal.resumePlan.restartStatus === 'failed') {
    status = 'failed';
    recoveryActions.push('handoff-failed-recovery-checkpoint');
    recoveryActions.push(...state.recoveryJournal.resumePlan.actions);
  } else if (state.recoveryJournal.resumePlan.restartStatus === 'recovering') {
    status = 'recovering';
    recoveryActions.push('resume-persisted-recovery-checkpoint');
    recoveryActions.push(...state.recoveryJournal.resumePlan.actions);
  } else if (!state.health.healthy) {
    status = state.health.degradedReasons.some((reason) => reason.endsWith('-failed')) ? 'failed' : 'degraded';
    recoveryActions.push('refresh-hosted-kernel-health-probes');
    recoveryActions.push(status === 'failed' ? 'block-command-until-health-recovers' : 'serve-degraded-status');
  } else if (state.failureState.code) {
    status = retryBackoff.retryable ? 'recovering' : 'failed';
    recoveryActions.push(retryBackoff.retryable ? 'schedule-failure-retry' : 'handoff-terminal-failure');
  } else if (state.recovery.required) {
    status = state.status === 'failed' ? 'failed' : 'recovering';
    recoveryActions.push('replay-persisted-kernel-state');
  } else {
    recoveryActions.push('accept-new-idempotent-command');
  }

  const actionableError = actionableErrorForRecovery({
    status,
    boundary,
    command: activeCommand,
    failureState: state.failureState,
    retryBackoff,
    health: state.health,
    providerNegotiation
  });

  return {
    status,
    restartSafe: activeCommand.restartSafe && status !== 'failed' && boundary.allowed && state.health.healthy && state.recoveryJournal.resumePlan.restartStatus !== 'failed',
    idempotentDisposition,
    scopedCommandKey,
    commandLedger: {
      highWatermark: state.commandLedger.highWatermark,
      replayCursor: state.commandLedger.replayCursor,
      entry: commandLedgerEntry,
      leaseExpired: pendingLeaseExpired,
      nextSequence: state.commandLedger.highWatermark + 1,
      appendOnAccept: alreadyCompleted || alreadyPending || alreadyFailed ? null : {
        idempotencyKey: activeCommand.idempotencyKey,
        scopedCommandKey,
        scopeKey: scope.scopeKey,
        commandType: activeCommand.type,
        status: 'pending',
        sequence: state.commandLedger.highWatermark + 1,
        leaseStartedAt: activeCommand.issuedAt,
        auditProof: checksum({
          action: 'append-pending-command',
          scopedCommandKey,
          sequence: state.commandLedger.highWatermark + 1,
          boundary: boundary.auditSink
        })
      }
    },
    boundary,
    retryBackoff,
    failureRemediation: operationalHealth.failureRemediation,
    operationalHealth,
    recoveryJournal: state.recoveryJournal,
    lifecycle,
    lifecycleCommandPlan,
    providerNegotiation,
    degradedMode: {
      type: 'hosted-kernel-degraded-mode.v1',
      active: status === 'degraded' || operationalHealth.mode === 'degraded-remediation',
      reasons: [
        ...operationalHealth.degradedReasons,
        ...(operationalHealth.failureRemediation?.active ? [operationalHealth.failureRemediation.degradedMode] : []),
        ...(!providerNegotiation.ready ? [providerNegotiation.denialReason] : [])
      ],
      mode: operationalHealth.mode,
      readOnly: (status === 'degraded' || operationalHealth.writeSuspended) && activeCommand.type !== 'kernel.status.describe',
      readSuspended: operationalHealth.readSuspended,
      writeSuspended: operationalHealth.writeSuspended,
      allowedCommands: status === 'degraded' || operationalHealth.mode !== 'nominal'
        ? operationalHealth.allowedDuringDegraded
        : [],
      nextProbeAt: operationalHealth.nextProbeAt,
      planProof: operationalHealth.proof
    },
    actionableError,
    recoveryActions
  };
}

export function createHostedKernelCommandEnvelope(input = {}) {
  const issuedAt = asIsoTimestamp(input.now || input.issuedAt, new Date().toISOString());
  const command = normalizeCommand(input.command, issuedAt);
  const persistedState = shapePersistedKernelState(input.state || input.persistedKernelState || input, { now: issuedAt, command });
  const recovery = recoverKernelStatus(persistedState, command);
  const traceContext = normalizeTraceContext(input.trace || input.traceContext || command.payload.trace, command, issuedAt);
  const validation = validateCommandPayload(command, recovery);
  const integration = buildIntegrationEffects(command, recovery, traceContext, validation);
  const preview = buildCommandPreviewContract(command, recovery, traceContext, validation, integration, issuedAt);
  const restartStatus = buildRestartStatusContract(recovery, integration, preview, issuedAt);
  const clientRuntime = buildClientWorkflowHandoff({
    source: input.clientRuntime || input.client || input.request,
    command,
    recovery,
    integration,
    preview,
    traceContext,
    issuedAt
  });
  const envelope = {
    contractVersion: CONTRACT_VERSION,
    type: 'hosted-kernel.command-envelope.v1',
    surfaceId,
    issuedAt,
    command: {
      type: command.type,
      idempotencyKey: command.idempotencyKey,
      scopedCommandKey: recovery.scopedCommandKey,
      restartSafe: recovery.restartSafe,
      payload: command.payload
    },
    scope: {
      tenantId: command.scope.tenantId,
      workspaceId: command.scope.workspaceId,
      actorId: command.scope.actorId,
      scopeKey: command.scope.scopeKey,
      boundary: recovery.boundary
    },
    traceContext,
    recovery: {
      status: recovery.status,
      restartSafe: recovery.restartSafe,
      idempotentDisposition: recovery.idempotentDisposition,
      actions: recovery.recoveryActions,
      retryBackoff: recovery.retryBackoff,
      failureRemediation: recovery.failureRemediation,
      operationalHealth: recovery.operationalHealth,
      lifecycle: recovery.lifecycle,
      lifecycleCommandPlan: recovery.lifecycleCommandPlan,
      providerNegotiation: recovery.providerNegotiation,
      degradedMode: recovery.degradedMode,
      actionableError: recovery.actionableError,
      recoveryJournal: recovery.recoveryJournal,
      restartStatus
    },
    ledger: recovery.commandLedger,
    validation,
    validationSummary: preview.validationSummary,
    readiness: preview.readiness,
    preview,
    restartStatus,
    clientRuntime,
    integration
  };

  return {
    ...envelope,
    proof: checksum(envelope),
    ok: preview.acceptance.decision === 'accept' || preview.acceptance.decision === 'reuse-ledger-disposition'
  };
}

export function describeSdkTypesSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const issuedAt = asIsoTimestamp(now, new Date().toISOString());
  const command = normalizeCommand(input.command, issuedAt);
  const persistedState = shapePersistedKernelState(input, { now: issuedAt, command });
  const recovery = recoverKernelStatus(persistedState, command);
  const commandEnvelope = createHostedKernelCommandEnvelope({
    ...input,
    now: issuedAt,
    command,
    state: persistedState
  });
  const auditRecord = {
    surfaceId,
    contractVersion: CONTRACT_VERSION,
    stateChecksum: persistedState.stateChecksum,
    commandEnvelopeProof: commandEnvelope.proof,
    clientRuntimeProof: commandEnvelope.clientRuntime.proof,
    commandKey: command.idempotencyKey,
    scopedCommandKey: recovery.scopedCommandKey,
    tenantId: command.scope.tenantId,
    workspaceId: command.scope.workspaceId,
    actorId: command.scope.actorId,
    boundaryAllowed: recovery.boundary.allowed,
    denialReason: recovery.boundary.denialReason,
    auditSink: recovery.boundary.auditSink,
    recoveryStatus: recovery.status,
    restartSafe: recovery.restartSafe,
    ledgerHighWatermark: recovery.commandLedger.highWatermark,
    ledgerReplayCursor: recovery.commandLedger.replayCursor,
    ledgerDisposition: recovery.idempotentDisposition,
    ledgerAppendOnAccept: recovery.commandLedger.appendOnAccept,
    health: persistedState.health,
    failureState: persistedState.failureState,
    failureRemediation: persistedState.failureRemediation,
    operationalHealth: persistedState.operationalHealth,
    recoveryJournal: {
      proof: persistedState.recoveryJournal.proof,
      retained: persistedState.recoveryJournal.retained,
      pendingCheckpointIds: persistedState.recoveryJournal.pendingCheckpointIds,
      failedCheckpointIds: persistedState.recoveryJournal.failedCheckpointIds,
      resumePlan: persistedState.recoveryJournal.resumePlan
    },
    restartStatus: commandEnvelope.restartStatus,
    lifecycleSettings: persistedState.lifecycleSettings,
    lifecycleNextAction: persistedState.lifecycleNextAction,
    lifecycleGate: recovery.lifecycle,
    lifecycleCommandPlan: recovery.lifecycleCommandPlan,
    providerRegistry: {
      syncCursor: persistedState.providerRegistry.syncCursor,
      lastSyncedAt: persistedState.providerRegistry.lastSyncedAt,
      activeProviderIds: persistedState.providerRegistry.activeProviderIds,
      staleProviderIds: persistedState.providerRegistry.staleProviderIds,
      expiredSyncLeaseProviderIds: persistedState.providerRegistry.expiredSyncLeaseProviderIds,
      serviceSummary: persistedState.providerRegistry.serviceSummary,
      proof: persistedState.providerRegistry.proof
    },
    providerNegotiation: {
      ...recovery.providerNegotiation,
      serviceContracts: recovery.providerNegotiation.serviceContracts.map((contract) => ({
        providerId: contract.providerId,
        service: contract.service,
        eligible: contract.eligible,
        denialReason: contract.denialReason,
        routeIntent: contract.routeIntent,
        missingCapabilities: contract.missingCapabilities,
        sync: contract.sync,
        proof: contract.proof
      }))
    },
    externalHandoff: recovery.providerNegotiation.externalHandoff,
    analytics: {
      proof: persistedState.analytics.proof,
      counters: persistedState.analytics.counters,
      currentSnapshot: persistedState.analytics.currentSnapshot,
      historyWindow: persistedState.analytics.report.historyWindow,
      trendSummary: persistedState.analytics.trendSummary,
      alertSummary: persistedState.analytics.alertSummary,
      timelineRollup: persistedState.analytics.timelineRollup,
      counterCards: persistedState.analytics.counterCards,
      reportingState: persistedState.analytics.reportingState,
      exportManifest: persistedState.analytics.exportManifest,
      exportViews: persistedState.analytics.exportViews,
      exportSummary: persistedState.analytics.report.exportSummary,
      timelineEventCount: persistedState.analytics.timeline.length
    },
    workspaceStatePlan: commandEnvelope.integration.workspaceStatePlan
      ? {
        mode: commandEnvelope.integration.workspaceStatePlan.mode,
        commitRequired: commandEnvelope.integration.workspaceStatePlan.commitRequired,
        expectedRevision: commandEnvelope.integration.workspaceStatePlan.expectedRevision,
        operationCount: commandEnvelope.integration.workspaceStatePlan.operationCount,
        readPaths: commandEnvelope.integration.workspaceStatePlan.readPaths,
        writePaths: commandEnvelope.integration.workspaceStatePlan.writePaths,
        conflictDetection: commandEnvelope.integration.workspaceStatePlan.conflictDetection,
        proof: commandEnvelope.integration.workspaceStatePlan.proof
      }
      : null,
    lifecycleSettingsCommit: commandEnvelope.integration.lifecycleCommandPlan
      ? {
        commandType: commandEnvelope.integration.lifecycleCommandPlan.commandType,
        commitRequired: commandEnvelope.integration.lifecycleCommandPlan.commitRequired,
        previousRevision: commandEnvelope.integration.lifecycleCommandPlan.previous.revision,
        proposedRevision: commandEnvelope.integration.lifecycleCommandPlan.proposed.revision,
        changedFields: commandEnvelope.integration.lifecycleCommandPlan.changedFields,
        nextActionAfterCommit: commandEnvelope.integration.lifecycleCommandPlan.nextActionAfterCommit,
        transitionReceipt: commandEnvelope.integration.lifecycleCommandPlan.transitionReceipt,
        auditEvent: commandEnvelope.integration.lifecycleCommandPlan.auditEvent,
        proof: commandEnvelope.integration.lifecycleCommandPlan.proof
      }
      : null,
    clientRuntime: {
      proof: commandEnvelope.clientRuntime.proof,
      requestId: commandEnvelope.clientRuntime.request.requestId,
      sessionId: commandEnvelope.clientRuntime.request.sessionId,
      routeIntent: commandEnvelope.clientRuntime.routeIntent,
      visibleStatus: commandEnvelope.clientRuntime.visibleStatus,
      resumable: commandEnvelope.clientRuntime.request.resumable,
      stale: commandEnvelope.clientRuntime.request.stale,
      pendingAcks: commandEnvelope.clientRuntime.pendingAcks.map((ack) => ({
        ack: ack.ack,
        status: ack.status,
        expiresAt: ack.expiresAt,
        proof: ack.proof
      })),
      ackProgress: {
        proof: commandEnvelope.clientRuntime.ackProgress.proof,
        routeIntent: commandEnvelope.clientRuntime.ackProgress.routeIntent,
        requiredCount: commandEnvelope.clientRuntime.ackProgress.requiredCount,
        completedCount: commandEnvelope.clientRuntime.ackProgress.completedCount,
        pendingCount: commandEnvelope.clientRuntime.ackProgress.pendingCount,
        blockedCount: commandEnvelope.clientRuntime.ackProgress.blockedCount,
        failedCount: commandEnvelope.clientRuntime.ackProgress.failedCount,
        expiredCount: commandEnvelope.clientRuntime.ackProgress.expiredCount,
        readyToFinalize: commandEnvelope.clientRuntime.ackProgress.readyToFinalize,
        nextRequiredAck: commandEnvelope.clientRuntime.ackProgress.nextRequiredAck
      },
      userVisibleHandoff: commandEnvelope.clientRuntime.userVisibleHandoff,
      workflowAction: commandEnvelope.clientRuntime.workflowAction
        ? {
          type: commandEnvelope.clientRuntime.workflowAction.type,
          routeIntent: commandEnvelope.clientRuntime.workflowAction.routeIntent,
          method: commandEnvelope.clientRuntime.workflowAction.method,
          resumable: commandEnvelope.clientRuntime.workflowAction.resumable,
          proof: commandEnvelope.clientRuntime.workflowAction.proof
        }
        : null,
      routeContracts: {
        proof: commandEnvelope.clientRuntime.routeContracts.proof,
        primaryRouteIntent: commandEnvelope.clientRuntime.routeContracts.primaryRouteIntent,
        routes: commandEnvelope.clientRuntime.routeContracts.routes
      },
      externalTarget: commandEnvelope.clientRuntime.externalTarget
    },
    retryBackoff: recovery.retryBackoff,
    failureRemediation: recovery.failureRemediation,
    operationalHealth: recovery.operationalHealth,
    actionableError: recovery.actionableError,
    preview: {
      proof: commandEnvelope.preview.proof,
      decision: commandEnvelope.preview.acceptance.decision,
      readinessReady: commandEnvelope.preview.readiness.ready,
      blockedBy: commandEnvelope.preview.readiness.blockedBy,
      validationSummary: commandEnvelope.preview.validationSummary,
      nextSteps: commandEnvelope.preview.nextSteps,
      routeContracts: {
        proof: commandEnvelope.preview.routeContracts.proof,
        primaryRouteIntent: commandEnvelope.preview.routeContracts.primaryRouteIntent,
        validationBadges: commandEnvelope.preview.routeContracts.validationBadges,
        routeCount: commandEnvelope.preview.routeContracts.routes.length
      }
    }
  };

  return {
    ok: true,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: issuedAt,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: {
      version: CONTRACT_VERSION,
      hostedKernelState: 'persisted-kernel-state.v1',
      commandEnvelope: 'idempotent-command.v1',
      restartStatus: 'restart-safe-status.v1',
      workspaceScope: 'tenant-workspace-scope.v1',
      permissionBoundary: 'hosted-kernel-permission-boundary.v1',
      auditHandoff: 'tenant-audit-handoff.v1',
      healthProbe: 'hosted-kernel-health-probe.v1',
      failureState: 'hosted-kernel-failure-state.v1',
      actionableError: 'hosted-kernel-actionable-error.v1',
      retryBackoff: 'hosted-kernel-retry-backoff.v1',
      failureRemediation: 'hosted-kernel.failure-remediation.v1',
      recoveryJournal: 'hosted-kernel.recovery-journal.v1',
      recoveryCheckpoint: 'hosted-kernel.recovery-checkpoint.v1',
      recoveryResumePlan: 'hosted-kernel.recovery-resume-plan.v1',
      degradedMode: 'hosted-kernel-degraded-mode.v1',
      operationalHealthPlan: 'hosted-kernel.operational-health-plan.v1',
      lifecycleSettings: 'hosted-kernel-lifecycle-settings.v1',
      lifecycleGate: 'hosted-kernel-lifecycle-gate.v1',
      lifecycleSchedule: 'hosted-kernel-lifecycle-schedule.v1',
      lifecycleTransitionWindow: 'hosted-kernel.lifecycle-transition-window.v1',
      lifecycleCommandPlan: 'hosted-kernel.lifecycle-command-plan.v1',
      lifecycleTransitionReceipt: 'hosted-kernel.lifecycle-transition-receipt.v1',
      lifecycleSettingsCommit: 'hosted-kernel.lifecycle-settings.commit',
      nextAction: 'hosted-kernel-next-action.v1',
      providerRegistry: 'hosted-kernel-provider-registry.v1',
      providerServiceContract: 'hosted-kernel.provider-service-contract.v1',
      providerCapabilityNegotiation: 'hosted-kernel-provider-capability-negotiation.v1',
      providerSyncMetadata: 'hosted-kernel-provider-sync-metadata.v1',
      externalProviderHandoff: 'hosted-kernel-external-provider-handoff.v1',
      commandLedger: 'restart-safe-command-ledger.v1',
      commandLease: 'hosted-kernel-command-lease.v1',
      traceContext: 'hosted-kernel-trace-context.v1',
      commandValidation: 'hosted-kernel-command-validation.v1',
      commandValidationSummary: 'hosted-kernel-command-validation-summary.v1',
      commandPreview: 'hosted-kernel-command-preview.v1',
      commandAcceptance: 'hosted-kernel-command-acceptance.v1',
      commandReadiness: 'hosted-kernel-command-readiness.v1',
      explainableNextSteps: 'hosted-kernel-explainable-next-steps.v1',
      previewRouteContracts: 'hosted-kernel.preview-route-contracts.v1',
      clientRequestState: 'hosted-kernel.client-request-state.v1',
      clientAckRecord: 'hosted-kernel.client-ack-record.v1',
      clientAckProgress: 'hosted-kernel.client-ack-progress.v1',
      clientWorkflowHandoff: 'hosted-kernel.client-workflow-handoff.v1',
      clientRuntimeRouteIntent: 'hosted-kernel.client-runtime-route-intent.v1',
      restartStatusContract: 'hosted-kernel.restart-status.v1',
      dispatchIntegration: 'hosted-kernel-dispatch-integration.v1',
      workspaceStatePlan: 'hosted-kernel-workspace-state-plan.v1',
      workspaceStateConflictDetection: 'hosted-kernel-workspace-state-conflict-detection.v1',
      analyticsSnapshot: 'hosted-kernel.analytics-snapshot.v1',
      analyticsHistory: 'hosted-kernel.analytics-history.v1',
      analyticsTimeline: 'hosted-kernel.analytics-timeline.v1',
      analyticsReport: 'hosted-kernel.analytics-report.v1',
      analyticsExportSummary: 'hosted-kernel.analytics-export-summary.v1',
      analyticsExportManifest: 'hosted-kernel.analytics-export-manifest.v1',
      analyticsTrendSummary: 'hosted-kernel.analytics-trend-summary.v1',
      analyticsReportingState: 'hosted-kernel.analytics-reporting-state.v1',
      analyticsAlertSummary: 'hosted-kernel.analytics-alert-summary.v1',
      analyticsTimelineRollup: 'hosted-kernel.analytics-timeline-rollup.v1',
      analyticsCounterCard: 'hosted-kernel.analytics-counter-card.v1',
      analyticsExportViews: 'hosted-kernel.analytics-export-views.v1'
    },
    state: persistedState,
    command,
    commandEnvelope,
    recovery,
    audit: auditRecord,
    evidence: [
      ...(Array.isArray(input.evidence) ? input.evidence : []),
      {
        type: 'sdk-types.command-envelope-shaped',
        at: issuedAt,
        proof: commandEnvelope.proof,
        scopeKey: command.scope.scopeKey,
        dispatchable: commandEnvelope.integration.dispatchable,
        lifecycleMode: recovery.lifecycle.mode,
        nextAction: recovery.lifecycle.nextAction,
        selectedProviderId: recovery.providerNegotiation.selectedProviderId,
        providerSync: recovery.providerNegotiation.sync,
        providerServiceContracts: recovery.providerNegotiation.serviceContracts,
        selectedProviderServiceContract: recovery.providerNegotiation.selectedServiceContract,
        externalHandoff: recovery.providerNegotiation.externalHandoff,
        recoveryJournal: persistedState.recoveryJournal,
        restartStatus: commandEnvelope.restartStatus,
        failureRemediation: recovery.failureRemediation,
        operationalHealth: recovery.operationalHealth,
        analyticsCounters: persistedState.analytics.counters,
        analyticsReport: persistedState.analytics.report,
        analyticsTimeline: persistedState.analytics.timeline,
        workspaceStatePlan: commandEnvelope.integration.workspaceStatePlan,
        lifecycleCommandPlan: commandEnvelope.integration.lifecycleCommandPlan,
        acceptance: commandEnvelope.preview.acceptance,
        clientRuntime: commandEnvelope.clientRuntime,
        readiness: commandEnvelope.preview.readiness,
        validationSummary: commandEnvelope.preview.validationSummary,
        nextSteps: commandEnvelope.preview.nextSteps,
        routeContracts: commandEnvelope.preview.routeContracts,
        validation: commandEnvelope.validation
      },
      ...(commandEnvelope.integration.lifecycleCommandPlan ? [{
        type: 'sdk-types.lifecycle-command-plan-shaped',
        at: issuedAt,
        proof: commandEnvelope.integration.lifecycleCommandPlan.proof,
        scopeKey: command.scope.scopeKey,
        commandType: command.type,
        commitRequired: commandEnvelope.integration.lifecycleCommandPlan.commitRequired,
        previousRevision: commandEnvelope.integration.lifecycleCommandPlan.previous.revision,
        proposedRevision: commandEnvelope.integration.lifecycleCommandPlan.proposed.revision,
        changedFields: commandEnvelope.integration.lifecycleCommandPlan.changedFields,
        nextActionAfterCommit: commandEnvelope.integration.lifecycleCommandPlan.nextActionAfterCommit,
        transitionReceipt: commandEnvelope.integration.lifecycleCommandPlan.transitionReceipt,
        auditEvent: commandEnvelope.integration.lifecycleCommandPlan.auditEvent,
        validationFindings: commandEnvelope.integration.lifecycleCommandPlan.validationFindings
      }] : []),
      {
        type: 'sdk-types.operational-health-plan-shaped',
        at: issuedAt,
        proof: recovery.operationalHealth.proof,
        scopeKey: command.scope.scopeKey,
        status: recovery.status,
        mode: recovery.operationalHealth.mode,
        writeSuspended: recovery.operationalHealth.writeSuspended,
        readSuspended: recovery.operationalHealth.readSuspended,
        nextProbeAt: recovery.operationalHealth.nextProbeAt,
        failureRemediation: recovery.failureRemediation,
        actions: recovery.operationalHealth.actions,
        allowedDuringDegraded: recovery.operationalHealth.allowedDuringDegraded
      },
      {
        type: 'sdk-types.recovery-journal-shaped',
        at: issuedAt,
        proof: persistedState.recoveryJournal.proof,
        scopeKey: command.scope.scopeKey,
        restartStatus: persistedState.recoveryJournal.resumePlan.restartStatus,
        resumeCursor: persistedState.recoveryJournal.resumePlan.resumeCursor,
        checkpointId: persistedState.recoveryJournal.resumePlan.checkpointId,
        retained: persistedState.recoveryJournal.retained,
        pendingCheckpointIds: persistedState.recoveryJournal.pendingCheckpointIds,
        failedCheckpointIds: persistedState.recoveryJournal.failedCheckpointIds,
        actions: persistedState.recoveryJournal.resumePlan.actions
      },
      {
        type: 'sdk-types.persisted-state-shaped',
        at: issuedAt,
        proof: checksum(auditRecord),
        scopeKey: command.scope.scopeKey,
        audit: auditRecord
      },
      {
        type: 'sdk-types.client-workflow-handoff-shaped',
        at: issuedAt,
        proof: commandEnvelope.clientRuntime.proof,
        scopeKey: command.scope.scopeKey,
        requestId: commandEnvelope.clientRuntime.request.requestId,
        sessionId: commandEnvelope.clientRuntime.request.sessionId,
        visibleStatus: commandEnvelope.clientRuntime.visibleStatus,
        routeIntent: commandEnvelope.clientRuntime.routeIntent,
        userVisibleHandoff: commandEnvelope.clientRuntime.userVisibleHandoff,
        workflowAction: commandEnvelope.clientRuntime.workflowAction,
        routeContracts: commandEnvelope.clientRuntime.routeContracts,
        ackProgress: commandEnvelope.clientRuntime.ackProgress,
        pendingAcks: commandEnvelope.clientRuntime.pendingAcks,
        auditLink: commandEnvelope.clientRuntime.auditLink
      },
      {
        type: 'sdk-types.analytics-export-ready',
        at: issuedAt,
        proof: persistedState.analytics.report.proof,
        scopeKey: command.scope.scopeKey,
        counters: persistedState.analytics.counters,
        historyWindow: persistedState.analytics.report.historyWindow,
        alertSummary: persistedState.analytics.alertSummary,
        timelineRollup: persistedState.analytics.timelineRollup,
        counterCards: persistedState.analytics.counterCards,
        exportSummary: persistedState.analytics.report.exportSummary,
        exportViews: persistedState.analytics.exportViews,
        timeline: persistedState.analytics.timeline
      }
    ]
  };
}

export default describeSdkTypesSurface;
