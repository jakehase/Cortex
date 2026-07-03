export const surfaceId = "aios_scheduler_priority-policy_052";
export const surfaceGroup = "scheduler";
export const surfaceName = "priority-policy";

const DEFAULT_POLICY = Object.freeze({
  maxAttempts: 4,
  staleAfterMs: 10 * 60 * 1000,
  degradedQueueDepth: 250,
  unhealthyQueueDepth: 1000,
  retryBaseMs: 750,
  retryMaxMs: 30_000,
  healthRecoveryWindowMs: 2 * 60 * 1000,
  sustainedFailureWindow: 3,
  laneWeights: Object.freeze({
    critical: 100,
    high: 75,
    normal: 50,
    low: 25,
    background: 10
  })
});

const ACTIONABLE_ERROR = Object.freeze({
  MISSING_TASK_ID: 'Provide task.id so scheduler decisions can be audited and retried safely.',
  INVALID_LANE: 'Use one of: critical, high, normal, low, background.',
  INVALID_ATTEMPTS: 'Use a non-negative integer attempt count.',
  EXHAUSTED_RETRIES: 'Move the task to failed state or manually requeue after operator review.',
  STALE_TASK: 'Refresh heartbeat/createdAt or lower priority before requeueing stale work.',
  KERNEL_BACKPRESSURE: 'Throttle producers or drain active work before accepting more low-priority tasks.',
  SCHEDULER_PAUSED: 'Resume scheduler intake before dispatching queued work.',
  QUEUE_DEGRADED: 'Prefer critical/high lanes and delay background work until queue depth falls.',
  QUEUE_UNHEALTHY: 'Stop dispatching new work, drain the queue, and verify worker health.',
  NO_ACTIVE_WORKERS: 'Start at least one scheduler worker before dispatch.',
  POLICY_DISABLED: 'Enable the scheduler policy before dispatching queued work.',
  LIFECYCLE_PAUSED: 'Resume scheduler lifecycle controls before dispatch.',
  DRAIN_MODE: 'Finish drain mode or manually approve critical dispatch only.',
  MANUAL_DISPATCH_REQUIRED: 'Use an operator-approved dispatch command for manual scheduling mode.',
  LANE_DISABLED: 'Re-enable this lane or move the task to an enabled lane.',
  DISPATCH_BATCH_LIMIT: 'Increase maxDispatchBatch or wait for the next scheduler tick.',
  CONCURRENCY_LIMIT: 'Wait for active work to finish or increase maxConcurrentTasks.',
  CLIENT_REQUEST_BINDING_REQUIRED: 'Attach a stable client requestId before handing this scheduler batch to runtime.',
  CLIENT_SESSION_BINDING_REQUIRED: 'Attach a stable client sessionId before handing this scheduler batch to runtime.',
  CLIENT_CHANNEL_UNSUPPORTED: 'Use one of the supported client handoff channels: interactive, api, automation, system.',
  CLIENT_HANDOFF_MODE_UNSUPPORTED: 'Use one of the supported client handoff modes: inline, deferred, external.',
  CLIENT_RESUME_TOKEN_MISMATCH: 'Refresh the scheduler handoff state before acknowledging this client workflow.',
  CLIENT_HANDOFF_TARGET_REQUIRED: 'Attach a stable external handoff target before routing scheduler work out of the hosted kernel.',
  TENANT_BINDING_REQUIRED: 'Attach a stable tenantId before evaluating hosted-kernel scheduler work.',
  WORKSPACE_SCOPE_REQUIRED: 'Attach a workspaceId that is inside the scheduler boundary contract.',
  TENANT_SCOPE_VIOLATION: 'Move the task to the active tenant boundary or evaluate it in a separate scheduler batch.',
  WORKSPACE_SCOPE_VIOLATION: 'Move the task to an allowed workspace or expand the workspace boundary explicitly.',
  ROLE_DISPATCH_FORBIDDEN: 'Grant a scheduler dispatch permission for this lane or keep the task blocked for operator review.',
  AUDIT_HANDOFF_REQUIRED: 'Attach an audit handoff sink before dispatching scoped scheduler work.',
  HANDOFF_ACK_REQUIRED: 'Acknowledge the scheduler handoff before committing this externally routed dispatch batch.',
  HEALTH_INCIDENT_OPEN: 'Keep dispatch blocked, drain active work, and verify worker recovery before accepting more scheduler work.',
  HEALTH_RECOVERY_COOLDOWN: 'Wait for the recovery cooldown window to pass before resuming automatic dispatch.',
  DEGRADED_MODE_ACTIVE: 'Limit dispatch to priority lanes and keep background work held until scheduler health stabilizes.',
  PERSISTED_STATE_INVALID: 'Discard the corrupt scheduler checkpoint or repair it before replaying lifecycle commands.',
  PERSISTED_STATE_STALE: 'Refresh scheduler checkpoint from the hosted-kernel store before automatic dispatch.',
  PERSISTED_DISPATCH_ACK_PENDING: 'Reconcile the previous dispatch watermark before creating a new hosted-kernel handoff.',
  IDEMPOTENT_COMMAND_REPLAY: 'Do not apply this lifecycle command again; return the persisted scheduler status to the caller.',
  PROVIDER_HEARTBEAT_STALE: 'Refresh hosted-kernel scheduler provider heartbeat before accepting more dispatch work.',
  PROVIDER_FAILURE_BUDGET_EXHAUSTED: 'Keep dispatch blocked until the provider reports a successful scheduler health check.',
  PROVIDER_RETRY_BACKOFF_ACTIVE: 'Wait for the provider retry-after window before attempting another scheduler dispatch handoff.',
  PROVIDER_INCIDENT_OPEN: 'Close or acknowledge the hosted-kernel provider incident before resuming automatic dispatch.',
  PROVIDER_PROTOCOL_UNSUPPORTED: 'Use a hosted-kernel scheduler provider protocol supported by this priority-policy surface.',
  PROVIDER_REQUIRED_CAPABILITY_MISSING: 'Negotiate all required scheduler provider capabilities before accepting dispatch handoff.',
  PROVIDER_SYNC_CURSOR_REQUIRED: 'Attach a stable sync cursor before the provider receives scheduler dispatch state.',
  PROVIDER_SYNC_EPOCH_REGRESSION: 'Refresh provider sync metadata from the latest hosted-kernel scheduler checkpoint.',
  PROVIDER_EXTERNAL_LEASE_REQUIRED: 'Attach an active external handoff lease before routing scheduler work outside the hosted kernel.',
  PROVIDER_EXTERNAL_LEASE_EXPIRED: 'Renew the external handoff lease before dispatching this scheduler batch.',
  ACCEPTANCE_ACTOR_REQUIRED: 'Attach acceptedBy when explicitly accepting scheduler preview tasks.',
  ACCEPTANCE_TIMESTAMP_INVALID: 'Use an ISO timestamp for acceptedAt or omit it so the hosted kernel can stamp acceptance.'
});

const LIFECYCLE_STATES = Object.freeze(['running', 'paused', 'draining', 'disabled']);
const DISPATCH_MODES = Object.freeze(['automatic', 'manual', 'disabled']);
const LIFECYCLE_COMMANDS = Object.freeze(['enable', 'disable', 'pause', 'resume', 'drain', 'hold-background', 'release-lanes']);
const CLIENT_CHANNELS = Object.freeze(['interactive', 'api', 'automation', 'system']);
const CLIENT_HANDOFF_MODES = Object.freeze(['inline', 'deferred', 'external']);
const ROLE_PERMISSIONS = Object.freeze({
  admin: Object.freeze(['scheduler.dispatch:any', 'scheduler.audit:write']),
  operator: Object.freeze(['scheduler.dispatch:critical', 'scheduler.dispatch:high', 'scheduler.dispatch:normal', 'scheduler.audit:write']),
  worker: Object.freeze(['scheduler.dispatch:normal', 'scheduler.dispatch:low', 'scheduler.dispatch:background']),
  viewer: Object.freeze([])
});
const PROVIDER_CAPABILITIES = Object.freeze([
  'priority.decisions.v1',
  'scheduler.health.v1',
  'scheduler.lifecycle-controls.v1',
  'scheduler.sync-metadata.v1',
  'external-handoff.v1'
]);
const PROVIDER_PROTOCOLS = Object.freeze([
  'aios.scheduler.provider.v1',
  'aios.scheduler.provider.v1beta'
]);
const PROVIDER_REQUIRED_CAPABILITIES = Object.freeze([
  'priority.decisions.v1',
  'scheduler.sync-metadata.v1'
]);

function clampNumber(value, fallback, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function optionalInteger(value, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.trunc(Math.min(max, Math.max(min, value)));
}

function toEpochMs(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizePolicy(inputPolicy = {}) {
  const laneWeights = {
    ...DEFAULT_POLICY.laneWeights,
    ...(inputPolicy.laneWeights && typeof inputPolicy.laneWeights === 'object' ? inputPolicy.laneWeights : {})
  };

  return {
    maxAttempts: Math.trunc(clampNumber(inputPolicy.maxAttempts, DEFAULT_POLICY.maxAttempts, 1, 12)),
    staleAfterMs: Math.trunc(clampNumber(inputPolicy.staleAfterMs, DEFAULT_POLICY.staleAfterMs, 1_000, 86_400_000)),
    degradedQueueDepth: Math.trunc(clampNumber(inputPolicy.degradedQueueDepth, DEFAULT_POLICY.degradedQueueDepth, 1, 50_000)),
    unhealthyQueueDepth: Math.trunc(clampNumber(inputPolicy.unhealthyQueueDepth, DEFAULT_POLICY.unhealthyQueueDepth, 1, 100_000)),
    retryBaseMs: Math.trunc(clampNumber(inputPolicy.retryBaseMs, DEFAULT_POLICY.retryBaseMs, 50, 60_000)),
    retryMaxMs: Math.trunc(clampNumber(inputPolicy.retryMaxMs, DEFAULT_POLICY.retryMaxMs, 100, 300_000)),
    healthRecoveryWindowMs: Math.trunc(clampNumber(
      inputPolicy.healthRecoveryWindowMs,
      DEFAULT_POLICY.healthRecoveryWindowMs,
      1_000,
      3_600_000
    )),
    sustainedFailureWindow: Math.trunc(clampNumber(
      inputPolicy.sustainedFailureWindow,
      DEFAULT_POLICY.sustainedFailureWindow,
      1,
      12
    )),
    laneWeights
  };
}

function normalizeLifecycleCommand(command) {
  if (typeof command !== 'string') return null;
  const normalized = command.trim().toLowerCase();
  return LIFECYCLE_COMMANDS.includes(normalized) ? normalized : null;
}

function readObject(...candidates) {
  return candidates.find((candidate) => candidate && typeof candidate === 'object' && !Array.isArray(candidate)) || {};
}

function normalizePersistedSchedulerState(input = {}, policy, nowMs, now) {
  const recoveryInput = input.recovery && typeof input.recovery === 'object' ? input.recovery : {};
  const persisted = readObject(
    input.persistedState,
    input.schedulerState,
    input.checkpoint,
    recoveryInput.persistedState,
    recoveryInput.checkpoint
  );
  const hasCheckpoint = Object.keys(persisted).length > 0;
  const restoredAt = trimmedString(persisted.restoredAt || persisted.persistedAt || persisted.generatedAt);
  const restoredAtMs = restoredAt ? toEpochMs(restoredAt, null) : null;
  const staleMs = restoredAtMs === null ? null : Math.max(0, nowMs - restoredAtMs);
  const rawLifecycleState = trimmedString(persisted.lifecycleState || persisted.state);
  const rawDispatchMode = trimmedString(persisted.dispatchMode);
  const lifecycleState = LIFECYCLE_STATES.includes(rawLifecycleState) ? rawLifecycleState : null;
  const dispatchMode = DISPATCH_MODES.includes(rawDispatchMode) ? rawDispatchMode : null;
  const disabledLanes = uniqueValidLanes(persisted.disabledLanes, policy);
  const appliedCommandIds = normalizeStringList(persisted.appliedCommandIds || persisted.commandIds);
  const commandLedger = Array.isArray(persisted.commandLedger) ? persisted.commandLedger.slice(-20) : [];
  const pendingDispatches = normalizePersistedDispatchWatermarks(persisted, nowMs, policy);
  const incomingCommandId = trimmedString(
    input.commandId
      || input.lifecycleCommandId
      || input.request?.commandId
      || input.settings?.commandId
      || recoveryInput.commandId
  );
  const incomingCommand = normalizeLifecycleCommand(input.lifecycleCommand || input.command || input.settings?.command);
  const replayedCommand = Boolean(incomingCommandId && appliedCommandIds.includes(incomingCommandId));
  const validationCodes = [];

  if (hasCheckpoint && rawLifecycleState && !lifecycleState) validationCodes.push('PERSISTED_STATE_INVALID');
  if (hasCheckpoint && rawDispatchMode && !dispatchMode) validationCodes.push('PERSISTED_STATE_INVALID');
  if (hasCheckpoint && Array.isArray(persisted.disabledLanes) && disabledLanes.length !== persisted.disabledLanes.length) {
    validationCodes.push('PERSISTED_STATE_INVALID');
  }
  if (hasCheckpoint && staleMs !== null && staleMs > 24 * 60 * 60 * 1000) validationCodes.push('PERSISTED_STATE_STALE');
  if (pendingDispatches.some((dispatch) => dispatch.recoveryState === 'ack_overdue')) {
    validationCodes.push('PERSISTED_DISPATCH_ACK_PENDING');
  }
  if (replayedCommand) validationCodes.push('IDEMPOTENT_COMMAND_REPLAY');

  return {
    schemaVersion: 1,
    contractKind: 'scheduler.priority-policy.persisted-state.v1',
    generatedAt: now,
    recovered: hasCheckpoint,
    restartStatus: !hasCheckpoint
      ? 'cold_start'
      : replayedCommand
        ? 'replay_ignored'
        : validationCodes.some((code) => code === 'PERSISTED_STATE_INVALID' || code === 'PERSISTED_STATE_STALE')
          ? 'recovery_action_required'
          : 'recovered',
    checkpoint: {
      stateEpoch: Math.trunc(clampNumber(persisted.stateEpoch, 0, 0, 1_000_000_000)),
      restoredAt,
      staleMs,
      lifecycleState,
      dispatchMode,
      disabledLanes,
      maxConcurrentTasks: optionalInteger(persisted.maxConcurrentTasks, 0, 100_000),
      maxDispatchBatch: optionalInteger(persisted.maxDispatchBatch, 1, 10_000),
      inFlightTasks: optionalInteger(persisted.inFlightTasks, 0, 100_000),
      lastAckToken: trimmedString(persisted.lastAckToken || persisted.providerAckToken),
      lastResumeToken: trimmedString(persisted.lastResumeToken || persisted.clientResumeToken),
      lastDispatchWatermark: trimmedString(persisted.lastDispatchWatermark || persisted.dispatchWatermark),
      pendingDispatches
    },
    command: {
      commandId: incomingCommandId,
      command: incomingCommand,
      replayed: replayedCommand,
      appliedCommandIds,
      ledger: commandLedger.filter((entry) => entry && typeof entry === 'object').map((entry, index) => ({
        ordinal: index + 1,
        commandId: trimmedString(entry.commandId || entry.id),
        command: normalizeLifecycleCommand(entry.command),
        appliedAt: trimmedString(entry.appliedAt || entry.generatedAt),
        lifecycleState: LIFECYCLE_STATES.includes(entry.lifecycleState) ? entry.lifecycleState : null
      }))
    },
    validation: {
      state: validationCodes.filter((code) => code !== 'IDEMPOTENT_COMMAND_REPLAY').length === 0 ? 'valid' : 'action_required',
      issueCount: validationCodes.length,
      issues: validationCodes.map((code) => ({
        scope: 'persisted_state',
        code,
        action: ACTIONABLE_ERROR[code] || 'Inspect scheduler checkpoint recovery before dispatch.'
      }))
    }
  };
}

function normalizePersistedDispatchWatermarks(persisted, nowMs, policy) {
  const rawDispatches = Array.isArray(persisted.pendingDispatches)
    ? persisted.pendingDispatches
    : persisted.dispatchWatermark && typeof persisted.dispatchWatermark === 'object'
      ? [persisted.dispatchWatermark]
      : [];

  return rawDispatches
    .filter((dispatch) => dispatch && typeof dispatch === 'object')
    .slice(-10)
    .map((dispatch, index) => {
      const issuedAt = trimmedString(dispatch.issuedAt || dispatch.persistedAt || dispatch.generatedAt);
      const issuedAtMs = issuedAt ? toEpochMs(issuedAt, null) : null;
      const ageMs = issuedAtMs === null ? null : Math.max(0, nowMs - issuedAtMs);
      const acknowledgedAt = trimmedString(dispatch.acknowledgedAt || dispatch.ackedAt);
      const ackToken = trimmedString(dispatch.ackToken || dispatch.providerAckToken || dispatch.watermark);
      const taskIds = normalizeStringList(dispatch.taskIds || dispatch.dispatchableTaskIds);
      const acknowledged = dispatch.acknowledged === true || Boolean(acknowledgedAt);
      const ackOverdue = !acknowledged && ageMs !== null && ageMs > policy.staleAfterMs;

      return {
        ordinal: index + 1,
        dispatchId: trimmedString(dispatch.dispatchId || dispatch.id) || ackToken,
        ackToken,
        clientResumeToken: trimmedString(dispatch.clientResumeToken || dispatch.resumeToken),
        taskIds,
        issuedAt,
        ageMs,
        acknowledged,
        acknowledgedAt,
        recoveryState: acknowledged
          ? 'acknowledged'
          : ackOverdue
            ? 'ack_overdue'
            : 'awaiting_ack'
      };
    });
}

function uniqueValidLanes(lanes, policy) {
  if (!Array.isArray(lanes)) return [];
  return [...new Set(lanes.filter((lane) => (
    typeof lane === 'string' && Object.prototype.hasOwnProperty.call(policy.laneWeights, lane)
  )))];
}

function settingIssue(field, value, reason, action = 'Correct this lifecycle setting before relying on scheduler dispatch output.') {
  return {
    field,
    value,
    reason,
    code: 'INVALID_SETTING',
    action
  };
}

function normalizeBoundedIntegerSetting(value, fallback, min, max, field, issues) {
  if (value === undefined || value === null) return Math.trunc(fallback);
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    issues.push(settingIssue(field, value, `Use an integer from ${min} through ${max}.`));
    return Math.trunc(fallback);
  }
  if (value < min || value > max) {
    issues.push(settingIssue(field, value, `Value was clamped into the supported range ${min}-${max}.`));
  }
  return Math.trunc(clampNumber(value, fallback, min, max));
}

function lifecycleStateAfterCommand(command, configuredState) {
  if (command === 'enable' || command === 'resume') return 'running';
  if (command === 'disable') return 'disabled';
  if (command === 'pause') return 'paused';
  if (command === 'drain') return 'draining';
  return configuredState;
}

function disabledLanesAfterCommand(command, disabledLanes) {
  if (command === 'hold-background') return [...new Set([...disabledLanes, 'background'])];
  if (command === 'release-lanes') return [];
  return disabledLanes;
}

function commandWarningsFor(command, configuredState, configuredMode, inFlightTasks) {
  const warnings = [];

  if (!command) return warnings;
  if (command === 'resume' && configuredState === 'disabled') {
    warnings.push({
      code: 'RESUME_FROM_DISABLED',
      action: 'Use enable when moving scheduler lifecycle from disabled to running.'
    });
  }
  if (command === 'disable' && inFlightTasks > 0) {
    warnings.push({
      code: 'DISABLE_WITH_INFLIGHT_WORK',
      action: 'Prefer drain before disable when hosted-kernel work is still in flight.'
    });
  }
  if (command === 'drain' && configuredMode === 'automatic') {
    warnings.push({
      code: 'DRAIN_WITH_AUTOMATIC_DISPATCH',
      action: 'Switch dispatchMode to manual when starting a controlled scheduler drain.'
    });
  }
  return warnings;
}

function normalizeControls(input = {}, policy, persistedState = null) {
  const settings = input.settings && typeof input.settings === 'object' ? input.settings : {};
  const scheduler = input.scheduler && typeof input.scheduler === 'object' ? input.scheduler : {};
  const health = input.health && typeof input.health === 'object' ? input.health : {};
  const requestedCommand = normalizeLifecycleCommand(input.lifecycleCommand || input.command || settings.command);
  const command = persistedState?.command.replayed ? null : requestedCommand;
  const settingErrors = [];
  const configuredState = typeof settings.lifecycleState === 'string' && LIFECYCLE_STATES.includes(settings.lifecycleState)
    ? settings.lifecycleState
    : settings.enabled === false || input.enabled === false
      ? 'disabled'
      : persistedState?.checkpoint.lifecycleState || 'running';
  const configuredMode = typeof settings.dispatchMode === 'string' && DISPATCH_MODES.includes(settings.dispatchMode)
    ? settings.dispatchMode
    : persistedState?.checkpoint.dispatchMode || 'automatic';

  if (settings.lifecycleState && !LIFECYCLE_STATES.includes(settings.lifecycleState)) {
    settingErrors.push(settingIssue('lifecycleState', settings.lifecycleState, `Use one of: ${LIFECYCLE_STATES.join(', ')}.`));
  }
  if (settings.dispatchMode && !DISPATCH_MODES.includes(settings.dispatchMode)) {
    settingErrors.push(settingIssue('dispatchMode', settings.dispatchMode, `Use one of: ${DISPATCH_MODES.join(', ')}.`));
  }
  if ((input.lifecycleCommand || input.command || settings.command) && !requestedCommand) {
    settingErrors.push(settingIssue(
      'command',
      input.lifecycleCommand || input.command || settings.command,
      `Use one of: ${LIFECYCLE_COMMANDS.join(', ')}.`
    ));
  }

  const disabledLaneInput = Array.isArray(settings.disabledLanes)
    ? settings.disabledLanes
    : persistedState?.checkpoint.disabledLanes || [];
  const disabledLanes = uniqueValidLanes(disabledLaneInput, policy);
  if (!Array.isArray(settings.disabledLanes) && settings.disabledLanes !== undefined) {
    settingErrors.push(settingIssue('disabledLanes', settings.disabledLanes, 'Use an array of supported scheduler lane names.'));
  }
  if (disabledLaneInput.length !== disabledLanes.length) {
    settingErrors.push(settingIssue(
      'disabledLanes',
      disabledLaneInput,
      `Use only supported lanes: ${Object.keys(policy.laneWeights).join(', ')}.`
    ));
  }

  const commandDisabledLanes = disabledLanesAfterCommand(command, disabledLanes);
  const lifecycleState = lifecycleStateAfterCommand(command, configuredState);
  const dispatchMode = lifecycleState === 'disabled'
    ? 'disabled'
    : configuredMode;
  const inFlightTasks = normalizeBoundedIntegerSetting(
    scheduler.inFlightTasks ?? health.inFlightTasks ?? settings.inFlightTasks,
    persistedState?.checkpoint.inFlightTasks ?? 0,
    0,
    100_000,
    'inFlightTasks',
    settingErrors
  );
  const maxConcurrentTasks = normalizeBoundedIntegerSetting(
    settings.maxConcurrentTasks,
    persistedState?.checkpoint.maxConcurrentTasks ?? 100,
    0,
    100_000,
    'maxConcurrentTasks',
    settingErrors
  );
  const maxDispatchBatch = normalizeBoundedIntegerSetting(
    settings.maxDispatchBatch,
    persistedState?.checkpoint.maxDispatchBatch ?? 50,
    1,
    10_000,
    'maxDispatchBatch',
    settingErrors
  );
  const concurrencyRemaining = Math.max(0, maxConcurrentTasks - inFlightTasks);
  const dispatchApproved = input.dispatchApproved === true || settings.dispatchApproved === true;
  const enabled = lifecycleState !== 'disabled' && dispatchMode !== 'disabled';
  const commandStatus = persistedState?.command.replayed ? 'replay_ignored' : command ? 'applied' : 'not_requested';
  const commandId = persistedState?.command.commandId || null;
  const commandWarnings = commandWarningsFor(command, configuredState, configuredMode, inFlightTasks);
  const nextAction = settingErrors.length > 0
    ? 'repair_invalid_lifecycle_settings'
    : !enabled
      ? 'enable_scheduler_policy'
      : lifecycleState === 'paused'
        ? 'resume_scheduler_lifecycle'
        : lifecycleState === 'draining'
          ? 'finish_scheduler_drain'
          : dispatchMode === 'manual' && !dispatchApproved
            ? 'approve_manual_dispatch'
            : commandDisabledLanes.length > 0
              ? 'review_disabled_scheduler_lanes'
              : 'evaluate_priority_dispatch';
  const lifecycleContract = {
    schemaVersion: 1,
    contractKind: 'scheduler.priority-policy.lifecycle-controls.v1',
    configured: {
      lifecycleState: configuredState,
      dispatchMode: configuredMode,
      disabledLanes
    },
    effective: {
      enabled,
      lifecycleState,
      dispatchMode,
      disabledLanes: commandDisabledLanes,
      maxConcurrentTasks,
      maxDispatchBatch,
      inFlightTasks,
      concurrencyRemaining
    },
    command: {
      requested: requestedCommand,
      applied: command,
      commandId,
      status: commandStatus,
      warnings: commandWarnings
    },
    validation: {
      state: settingErrors.length === 0 ? 'valid' : 'action_required',
      issueCount: settingErrors.length,
      issues: settingErrors
    },
    nextAction
  };

  return {
    enabled,
    lifecycleState,
    dispatchMode,
    command,
    disabledLanes: commandDisabledLanes,
    maxConcurrentTasks,
    maxDispatchBatch,
    inFlightTasks,
    concurrencyRemaining,
    dispatchApproved,
    commandStatus,
    commandId,
    settingErrors,
    commandWarnings,
    nextAction,
    lifecycleContract
  };
}

function normalizeTask(task = {}, nowMs, policy) {
  const lane = typeof task.lane === 'string' ? task.lane : 'normal';
  const attempts = Number.isInteger(task.attempts) ? task.attempts : 0;
  const createdAtMs = toEpochMs(task.createdAt || task.enqueuedAt, nowMs);
  const ageMs = Math.max(0, nowMs - createdAtMs);
  const errors = [];

  if (!task.id || typeof task.id !== 'string') errors.push('MISSING_TASK_ID');
  if (!Object.prototype.hasOwnProperty.call(policy.laneWeights, lane)) errors.push('INVALID_LANE');
  if (!Number.isInteger(task.attempts || 0) || attempts < 0) errors.push('INVALID_ATTEMPTS');
  if (attempts >= policy.maxAttempts) errors.push('EXHAUSTED_RETRIES');
  if (ageMs > policy.staleAfterMs && lane !== 'critical') errors.push('STALE_TASK');

  return {
    id: typeof task.id === 'string' ? task.id : null,
    lane,
    attempts,
    ageMs,
    weight: policy.laneWeights[lane] || policy.laneWeights.normal,
    errors
  };
}

function normalizeHostedKernelHealthSignal(input = {}, policy, nowMs, now) {
  const healthInput = input.health && typeof input.health === 'object' ? input.health : input;
  const schedulerInput = input.scheduler && typeof input.scheduler === 'object' ? input.scheduler : {};
  const providerInput = readObject(
    input.providerHealth,
    healthInput.provider,
    schedulerInput.provider,
    input.provider?.health,
    input.runtime?.providerHealth
  );
  const lastHeartbeatAt = trimmedString(
    providerInput.lastHeartbeatAt
      || providerInput.heartbeatAt
      || healthInput.lastHeartbeatAt
      || schedulerInput.lastHeartbeatAt
  );
  const lastSuccessAt = trimmedString(
    providerInput.lastSuccessAt
      || providerInput.lastHealthyAt
      || providerInput.lastOkAt
      || healthInput.lastSuccessAt
  );
  const retryAfterAt = trimmedString(providerInput.retryAfterAt || healthInput.retryAfterAt);
  const heartbeatAgeMs = lastHeartbeatAt ? Math.max(0, nowMs - toEpochMs(lastHeartbeatAt, nowMs)) : null;
  const successAgeMs = lastSuccessAt ? Math.max(0, nowMs - toEpochMs(lastSuccessAt, nowMs)) : null;
  const retryAfterMs = retryAfterAt
    ? Math.max(0, toEpochMs(retryAfterAt, nowMs) - nowMs)
    : Math.trunc(clampNumber(providerInput.retryAfterMs ?? healthInput.retryAfterMs, 0, 0, policy.retryMaxMs));
  const consecutiveFailures = Math.trunc(clampNumber(
    providerInput.consecutiveFailures ?? healthInput.consecutiveFailures,
    0,
    0,
    1_000
  ));
  const incidentState = trimmedString(providerInput.incidentState || healthInput.incidentState) || 'clear';
  const failureBudgetRemaining = optionalInteger(
    providerInput.failureBudgetRemaining ?? healthInput.failureBudgetRemaining,
    0,
    1_000
  );
  const validationCodes = [];

  if (heartbeatAgeMs !== null && heartbeatAgeMs > policy.staleAfterMs) validationCodes.push('PROVIDER_HEARTBEAT_STALE');
  if (successAgeMs !== null && successAgeMs > policy.healthRecoveryWindowMs && consecutiveFailures > 0) {
    validationCodes.push('PROVIDER_FAILURE_BUDGET_EXHAUSTED');
  }
  if (failureBudgetRemaining === 0 || consecutiveFailures >= policy.sustainedFailureWindow) {
    validationCodes.push('PROVIDER_FAILURE_BUDGET_EXHAUSTED');
  }
  if (retryAfterMs > 0) validationCodes.push('PROVIDER_RETRY_BACKOFF_ACTIVE');
  if (['open', 'active', 'ack_required'].includes(incidentState)) validationCodes.push('PROVIDER_INCIDENT_OPEN');

  const uniqueCodes = [...new Set(validationCodes)];
  const severity = uniqueCodes.some((code) => (
    code === 'PROVIDER_INCIDENT_OPEN' || code === 'PROVIDER_FAILURE_BUDGET_EXHAUSTED'
  ))
    ? 'failure'
    : uniqueCodes.length > 0
      ? 'degraded'
      : 'normal';

  return {
    schemaVersion: 1,
    contractKind: 'scheduler.priority-policy.hosted-kernel-health-signal.v1',
    generatedAt: now,
    state: severity,
    lastHeartbeatAt,
    lastSuccessAt,
    heartbeatAgeMs,
    successAgeMs,
    consecutiveFailures,
    failureBudgetRemaining,
    retryAfterMs,
    retryAfterAt: retryAfterMs > 0 ? retryAfterAt || new Date(nowMs + retryAfterMs).toISOString() : null,
    incidentState,
    validation: {
      state: uniqueCodes.length === 0 ? 'valid' : 'action_required',
      issueCount: uniqueCodes.length,
      issues: uniqueCodes.map((code) => ({
        scope: 'provider_health',
        code,
        action: ACTIONABLE_ERROR[code] || 'Repair hosted-kernel provider health before scheduler dispatch.'
      }))
    }
  };
}

function evaluateSchedulerHealth(input = {}, policy, controls = null, nowMs = Date.now(), now = new Date(nowMs).toISOString()) {
  const healthInput = input.health && typeof input.health === 'object' ? input.health : input;
  const schedulerInput = input.scheduler && typeof input.scheduler === 'object' ? input.scheduler : {};
  const queueDepth = Math.trunc(clampNumber(healthInput.queueDepth ?? schedulerInput.queueDepth, 0, 0, 100_000));
  const activeWorkers = Math.trunc(clampNumber(healthInput.activeWorkers ?? schedulerInput.activeWorkers, 0, 0, 10_000));
  const acceptingWork = healthInput.acceptingWork !== false && schedulerInput.acceptingWork !== false && (!controls || controls.enabled);
  const providerSignal = normalizeHostedKernelHealthSignal(input, policy, nowMs, now);
  const healthErrors = [];

  if (!acceptingWork) healthErrors.push('SCHEDULER_PAUSED');
  if (queueDepth >= policy.unhealthyQueueDepth) healthErrors.push('QUEUE_UNHEALTHY');
  else if (queueDepth >= policy.degradedQueueDepth) healthErrors.push('QUEUE_DEGRADED');
  if (queueDepth > 0 && activeWorkers === 0) healthErrors.push('NO_ACTIVE_WORKERS');
  if (providerSignal.state === 'failure') {
    healthErrors.push(...providerSignal.validation.issues.map((issue) => issue.code));
  }
  if (providerSignal.state === 'degraded' && !healthErrors.includes('QUEUE_DEGRADED')) {
    healthErrors.push('QUEUE_DEGRADED');
  }

  const state = healthErrors.some((error) => (
    error === 'QUEUE_UNHEALTHY'
      || error === 'NO_ACTIVE_WORKERS'
      || error === 'PROVIDER_INCIDENT_OPEN'
      || error === 'PROVIDER_FAILURE_BUDGET_EXHAUSTED'
  ))
    ? 'unhealthy'
    : healthErrors.length > 0
      ? 'degraded'
      : 'healthy';

  return {
    state,
    degraded: state !== 'healthy',
    acceptingWork,
    queueDepth,
    activeWorkers,
    lifecycleState: controls ? controls.lifecycleState : 'running',
    dispatchMode: controls ? controls.dispatchMode : 'automatic',
    providerSignal,
    errors: healthErrors.map((code) => ({
      code,
      action: ACTIONABLE_ERROR[code] || 'Inspect hosted-kernel scheduler health before dispatch.'
    }))
  };
}

function retryBackoffFor(task, policy, nowMs) {
  if (task.errors.includes('EXHAUSTED_RETRIES')) {
    return { retryable: false, nextRetryAt: null, backoffMs: null };
  }

  const exponentialMs = policy.retryBaseMs * (2 ** Math.max(0, task.attempts));
  const backoffMs = Math.min(policy.retryMaxMs, exponentialMs);
  return {
    retryable: task.errors.length === 0 || task.errors.every((error) => error === 'STALE_TASK'),
    backoffMs,
    nextRetryAt: new Date(nowMs + backoffMs).toISOString()
  };
}

function rankTask(task, health) {
  const healthPenalty = health.state === 'healthy' ? 0 : health.state === 'degraded' ? 15 : 35;
  const staleBoost = task.errors.includes('STALE_TASK') ? -20 : 0;
  const retryPenalty = task.attempts * 8;
  return Math.max(0, task.weight - healthPenalty - retryPenalty + staleBoost);
}

function controlFailuresForTask(task, controls) {
  const failures = [];
  if (!controls.enabled) failures.push('POLICY_DISABLED');
  if (controls.lifecycleState === 'paused') failures.push('LIFECYCLE_PAUSED');
  if (controls.lifecycleState === 'draining' && task.lane !== 'critical') failures.push('DRAIN_MODE');
  if (controls.dispatchMode === 'manual' && !controls.dispatchApproved) failures.push('MANUAL_DISPATCH_REQUIRED');
  if (controls.disabledLanes.includes(task.lane)) failures.push('LANE_DISABLED');
  return failures;
}

function decorateFailures(failureCodes) {
  return failureCodes.map((code) => ({
    code,
    action: ACTIONABLE_ERROR[code] || 'Inspect scheduler state and retry with corrected task metadata.'
  }));
}

function applySchedulingControls(decisions, controls, health, operationalHealth = null) {
  let remainingBatch = controls.maxDispatchBatch;
  let remainingConcurrency = controls.concurrencyRemaining;

  return decisions.map((decision) => {
    const failureCodes = decision.failures.map((failure) => failure.code);
    let dispatchable = failureCodes.length === 0 && health.state !== 'unhealthy';

    if (dispatchable && operationalHealth) {
      if (operationalHealth.dispatchGate === 'blocked') {
        failureCodes.push('HEALTH_INCIDENT_OPEN');
        dispatchable = false;
      } else if (operationalHealth.dispatchGate === 'cooldown') {
        failureCodes.push('HEALTH_RECOVERY_COOLDOWN');
        dispatchable = false;
      } else if (
        operationalHealth.dispatchGate === 'priority_only'
        && !operationalHealth.degradedMode.allowedLanes.includes(decision.lane)
      ) {
        failureCodes.push('DEGRADED_MODE_ACTIVE');
        dispatchable = false;
      }
    }
    if (dispatchable && remainingBatch <= 0) {
      failureCodes.push('DISPATCH_BATCH_LIMIT');
      dispatchable = false;
    }
    if (dispatchable && remainingConcurrency <= 0) {
      failureCodes.push('CONCURRENCY_LIMIT');
      dispatchable = false;
    }
    if (dispatchable) {
      remainingBatch -= 1;
      remainingConcurrency -= 1;
    }

    return {
      ...decision,
      state: failureCodes.length > 0 ? 'needs_action' : 'ready',
      dispatchable,
      failures: decorateFailures(failureCodes)
    };
  });
}

function summarizeFailures(decisions) {
  return decisions.reduce((counts, decision) => {
    for (const failure of decision.failures) {
      counts[failure.code] = (counts[failure.code] || 0) + 1;
    }
    return counts;
  }, {});
}

function buildLaneCounters(decisions, policy) {
  const laneCounters = Object.fromEntries(Object.keys(policy.laneWeights).map((lane) => [lane, {
    total: 0,
    dispatchable: 0,
    blocked: 0,
    needsAction: 0,
    retryable: 0,
    averagePriorityScore: 0,
    maxAttempts: 0,
    oldestTaskAgeMs: 0,
    failureCodes: {}
  }]));

  for (const decision of decisions) {
    const lane = laneCounters[decision.lane] ? decision.lane : 'normal';
    const laneCounter = laneCounters[lane];
    laneCounter.total += 1;
    laneCounter.dispatchable += decision.dispatchable ? 1 : 0;
    laneCounter.blocked += decision.dispatchable ? 0 : 1;
    laneCounter.needsAction += decision.state === 'needs_action' ? 1 : 0;
    laneCounter.retryable += decision.retry.retryable ? 1 : 0;
    laneCounter.averagePriorityScore += decision.priorityScore;
    laneCounter.maxAttempts = Math.max(laneCounter.maxAttempts, decision.attempts);
    laneCounter.oldestTaskAgeMs = Math.max(laneCounter.oldestTaskAgeMs, decision.taskAgeMs);
    for (const failure of decision.failures) {
      laneCounter.failureCodes[failure.code] = (laneCounter.failureCodes[failure.code] || 0) + 1;
    }
  }

  return Object.fromEntries(Object.entries(laneCounters).map(([lane, counters]) => [lane, {
    ...counters,
    averagePriorityScore: counters.total > 0 ? Math.round(counters.averagePriorityScore / counters.total) : 0,
    dispatchableRatio: counters.total > 0 ? Number((counters.dispatchable / counters.total).toFixed(3)) : 1
  }]));
}

function buildFailureHotspots(decisions) {
  const hotspotsByCode = new Map();

  for (const decision of decisions) {
    for (const failure of decision.failures) {
      const current = hotspotsByCode.get(failure.code) || {
        code: failure.code,
        count: 0,
        lanes: new Set(),
        taskIds: [],
        action: failure.action
      };
      current.count += 1;
      current.lanes.add(decision.lane);
      if (decision.taskId && current.taskIds.length < 8) current.taskIds.push(decision.taskId);
      hotspotsByCode.set(failure.code, current);
    }
  }

  return [...hotspotsByCode.values()]
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
    .slice(0, 10)
    .map((hotspot) => ({
      code: hotspot.code,
      count: hotspot.count,
      lanes: [...hotspot.lanes].sort(),
      sampleTaskIds: hotspot.taskIds,
      action: hotspot.action
    }));
}

function buildAnalytics(decisions, health, policy, boundaryContract = null, operationalHealth = null, auditHandoffContract = null) {
  const counters = {
    total: decisions.length,
    dispatchable: 0,
    blocked: 0,
    needsAction: 0,
    byLane: {},
    byState: {},
    byFailureCode: summarizeFailures(decisions)
  };
  let priorityScoreTotal = 0;
  let highestPriorityScore = 0;

  for (const decision of decisions) {
    priorityScoreTotal += decision.priorityScore;
    highestPriorityScore = Math.max(highestPriorityScore, decision.priorityScore);
    counters.byLane[decision.lane] = (counters.byLane[decision.lane] || 0) + 1;
    counters.byState[decision.state] = (counters.byState[decision.state] || 0) + 1;
    if (decision.dispatchable) counters.dispatchable += 1;
    else counters.blocked += 1;
    if (decision.state === 'needs_action') counters.needsAction += 1;
  }

  return {
    counters,
    score: {
      averagePriorityScore: decisions.length > 0 ? Math.round(priorityScoreTotal / decisions.length) : 0,
      highestPriorityScore
    },
    lanes: buildLaneCounters(decisions, policy),
    retry: {
      retryable: decisions.filter((decision) => decision.retry.retryable).length,
      delayed: decisions.filter((decision) => decision.retry.nextRetryAt).length,
      exhausted: decisions.filter((decision) => (
        decision.failures.some((failure) => failure.code === 'EXHAUSTED_RETRIES')
      )).length
    },
    failureHotspots: buildFailureHotspots(decisions),
    queue: {
      healthState: health.state,
      degraded: health.degraded,
      queueDepth: health.queueDepth,
      activeWorkers: health.activeWorkers,
      providerHealthState: health.providerSignal.state,
      providerConsecutiveFailures: health.providerSignal.consecutiveFailures,
      providerRetryAfterMs: health.providerSignal.retryAfterMs,
      providerIncidentState: health.providerSignal.incidentState,
      lifecycleState: health.lifecycleState,
      dispatchMode: health.dispatchMode,
      operationalState: operationalHealth ? operationalHealth.state : 'unknown',
      dispatchGate: operationalHealth ? operationalHealth.dispatchGate : 'unknown',
      nextHealthCheckAt: operationalHealth ? operationalHealth.retry.nextHealthCheckAt : null,
      dispatchableRatio: decisions.length > 0
        ? Number((counters.dispatchable / decisions.length).toFixed(3))
        : 1
    },
    boundary: boundaryContract
      ? {
          validationState: boundaryContract.validation.state,
          tenantId: boundaryContract.scope.tenantId,
          workspaceId: boundaryContract.scope.workspaceId,
          scopedWorkspaceCount: boundaryContract.scope.allowedWorkspaceIds.length,
          permissionCheckRequired: boundaryContract.actor.requirePermissionCheck,
          auditHandoffReady: boundaryContract.audit.handoffReady,
          auditCommitReady: auditHandoffContract ? auditHandoffContract.commit.ready : boundaryContract.audit.handoffReady,
          auditManifestRows: auditHandoffContract ? auditHandoffContract.manifest.totalRows : 0,
          auditUnscopedReadyRows: auditHandoffContract ? auditHandoffContract.manifest.unscopedReadyRows : 0,
          isolatedDecisionCount: decisions.filter((decision) => decision.boundary?.isolated).length
        }
      : {
          validationState: 'unknown',
          tenantId: null,
          workspaceId: null,
          scopedWorkspaceCount: 0,
          permissionCheckRequired: false,
          auditHandoffReady: false,
          auditCommitReady: false,
          auditManifestRows: 0,
          auditUnscopedReadyRows: 0,
          isolatedDecisionCount: 0
        }

  };
}

function normalizeHistorySnapshot(snapshot = {}, fallbackIndex = 0) {
  const generatedAt = typeof snapshot.generatedAt === 'string' ? snapshot.generatedAt : null;
  const analytics = snapshot.analytics && typeof snapshot.analytics === 'object' ? snapshot.analytics : {};
  const counters = analytics.counters && typeof analytics.counters === 'object' ? analytics.counters : snapshot;
  const queue = analytics.queue && typeof analytics.queue === 'object' ? analytics.queue : snapshot;

  return {
    sequence: Number.isInteger(snapshot.sequence) ? snapshot.sequence : fallbackIndex,
    generatedAt,
    healthState: typeof queue.healthState === 'string'
      ? queue.healthState
      : typeof snapshot.healthState === 'string'
        ? snapshot.healthState
        : 'unknown',
    queueDepth: Math.trunc(clampNumber(queue.queueDepth, snapshot.queueDepth || 0, 0, 100_000)),
    dispatchable: Math.trunc(clampNumber(counters.dispatchable, snapshot.dispatchable || 0, 0, 100_000)),
    blocked: Math.trunc(clampNumber(counters.blocked, snapshot.blocked || 0, 0, 100_000)),
    needsAction: Math.trunc(clampNumber(counters.needsAction, snapshot.needsAction || 0, 0, 100_000))
  };
}

function buildHistory(inputHistory, currentSnapshot) {
  const previous = Array.isArray(inputHistory) ? inputHistory : [];
  const normalized = previous
    .slice(-12)
    .map((snapshot, index) => normalizeHistorySnapshot(snapshot, index + 1));
  const snapshots = [
    ...normalized,
    {
      ...currentSnapshot,
      sequence: normalized.length + 1
    }
  ];
  const prior = snapshots.length > 1 ? snapshots[snapshots.length - 2] : null;

  return {
    snapshots,
    latest: snapshots[snapshots.length - 1],
    trend: prior
      ? {
          queueDepthDelta: currentSnapshot.queueDepth - prior.queueDepth,
          dispatchableDelta: currentSnapshot.dispatchable - prior.dispatchable,
          blockedDelta: currentSnapshot.blocked - prior.blocked,
          needsActionDelta: currentSnapshot.needsAction - prior.needsAction
        }
      : {
          queueDepthDelta: 0,
          dispatchableDelta: 0,
          blockedDelta: 0,
          needsActionDelta: 0
        }
  };
}

function classifyHistoryTrend(history) {
  const snapshots = history.snapshots;
  const first = snapshots[0] || history.latest;
  const latest = history.latest;
  const queueDepthDelta = latest.queueDepth - first.queueDepth;
  const blockedDelta = latest.blocked - first.blocked;
  const dispatchableDelta = latest.dispatchable - first.dispatchable;
  const pressure = latest.healthState === 'unhealthy' || blockedDelta > 0 || queueDepthDelta > 0
    ? 'rising'
    : latest.healthState === 'healthy' && blockedDelta < 0 && queueDepthDelta <= 0
      ? 'clearing'
      : 'stable';

  return {
    state: pressure,
    windowSize: snapshots.length,
    queueDepthDelta,
    blockedDelta,
    dispatchableDelta,
    latestHealthState: latest.healthState,
    evidence: {
      firstSequence: first.sequence,
      latestSequence: latest.sequence,
      latestNeedsAction: latest.needsAction
    }
  };
}

function buildOperationalHealthContract(health, history, controls, policy, nowMs, now) {
  const recentSnapshots = history.snapshots.slice(-policy.sustainedFailureWindow);
  const unhealthyCount = recentSnapshots.filter((snapshot) => snapshot.healthState === 'unhealthy').length;
  const degradedCount = recentSnapshots.filter((snapshot) => snapshot.healthState === 'degraded').length;
  const sustainedUnhealthy = unhealthyCount >= policy.sustainedFailureWindow;
  const sustainedDegraded = degradedCount + unhealthyCount >= policy.sustainedFailureWindow;
  const previousSnapshot = history.snapshots.length > 1 ? history.snapshots[history.snapshots.length - 2] : null;
  const recoveringFromFailure = health.state === 'healthy'
    && previousSnapshot
    && ['unhealthy', 'degraded'].includes(previousSnapshot.healthState);
  const cooldownUntilMs = recoveringFromFailure ? nowMs + policy.healthRecoveryWindowMs : null;
  const failureCodes = [];

  if (sustainedUnhealthy || health.state === 'unhealthy') failureCodes.push('HEALTH_INCIDENT_OPEN');
  else if (recoveringFromFailure) failureCodes.push('HEALTH_RECOVERY_COOLDOWN');
  else if (sustainedDegraded || health.state === 'degraded') failureCodes.push('DEGRADED_MODE_ACTIVE');
  for (const issue of health.providerSignal.validation.issues) {
    if (!failureCodes.includes(issue.code)) failureCodes.push(issue.code);
  }

  const dispatchGate = failureCodes.includes('HEALTH_INCIDENT_OPEN')
    || failureCodes.includes('PROVIDER_INCIDENT_OPEN')
    || failureCodes.includes('PROVIDER_FAILURE_BUDGET_EXHAUSTED')
    ? 'blocked'
    : failureCodes.includes('HEALTH_RECOVERY_COOLDOWN') || failureCodes.includes('PROVIDER_RETRY_BACKOFF_ACTIVE')
      ? 'cooldown'
    : failureCodes.includes('DEGRADED_MODE_ACTIVE')
      || failureCodes.includes('PROVIDER_HEARTBEAT_STALE')
        ? 'priority_only'
        : controls.enabled
          ? 'open'
          : 'closed';
  const allowedLanes = dispatchGate === 'priority_only'
    ? ['critical', 'high']
    : dispatchGate === 'blocked' || dispatchGate === 'cooldown' || dispatchGate === 'closed'
      ? []
      : Object.keys(policy.laneWeights);
  const blockedLanes = Object.keys(policy.laneWeights).filter((lane) => !allowedLanes.includes(lane));
  const providerRetryAfterMs = health.providerSignal.retryAfterMs || 0;
  const retryAfterMs = providerRetryAfterMs > 0
    ? providerRetryAfterMs
    : dispatchGate === 'blocked'
    ? Math.min(policy.retryMaxMs, Math.max(policy.retryBaseMs, health.queueDepth * 10))
    : dispatchGate === 'cooldown'
      ? policy.healthRecoveryWindowMs
      : dispatchGate === 'priority_only'
        ? policy.retryBaseMs
        : 0;

  return {
    schemaVersion: 1,
    contractKind: 'scheduler.priority-policy.operational-health.v1',
    generatedAt: now,
    state: dispatchGate === 'open'
      ? 'normal'
      : dispatchGate === 'priority_only'
        ? 'degraded_mode'
        : dispatchGate === 'cooldown'
          ? 'recovery_cooldown'
          : 'failure_state',
    dispatchGate,
    sustained: {
      windowSize: policy.sustainedFailureWindow,
      unhealthyCount,
      degradedCount,
      sustainedUnhealthy,
      sustainedDegraded
    },
    retry: {
      retryAfterMs,
      nextHealthCheckAt: retryAfterMs > 0 ? new Date(nowMs + retryAfterMs).toISOString() : now,
      cooldownUntil: cooldownUntilMs === null ? null : new Date(cooldownUntilMs).toISOString()
    },
    providerHealth: {
      state: health.providerSignal.state,
      lastHeartbeatAt: health.providerSignal.lastHeartbeatAt,
      lastSuccessAt: health.providerSignal.lastSuccessAt,
      heartbeatAgeMs: health.providerSignal.heartbeatAgeMs,
      successAgeMs: health.providerSignal.successAgeMs,
      consecutiveFailures: health.providerSignal.consecutiveFailures,
      failureBudgetRemaining: health.providerSignal.failureBudgetRemaining,
      retryAfterMs: health.providerSignal.retryAfterMs,
      incidentState: health.providerSignal.incidentState,
      validationState: health.providerSignal.validation.state
    },
    degradedMode: {
      active: dispatchGate === 'priority_only',
      allowedLanes,
      blockedLanes,
      backgroundHeld: blockedLanes.includes('background')
    },
    validation: {
      state: failureCodes.length === 0 ? 'valid' : 'action_required',
      issueCount: failureCodes.length,
      issues: failureCodes.map((code) => ({
        scope: 'operational_health',
        code,
        action: ACTIONABLE_ERROR[code] || 'Stabilize scheduler health before dispatch.'
      }))
    }
  };
}

function buildTimeline(decisions, health, now) {
  const events = [
    {
      at: now,
      type: 'scheduler_health',
      state: health.state,
      queueDepth: health.queueDepth,
      activeWorkers: health.activeWorkers
    },
    {
      at: now,
      type: 'provider_health',
      state: health.providerSignal.state,
      consecutiveFailures: health.providerSignal.consecutiveFailures,
      retryAfterMs: health.providerSignal.retryAfterMs,
      incidentState: health.providerSignal.incidentState,
      issueCodes: health.providerSignal.validation.issues.map((issue) => issue.code)
    }
  ];

  for (const decision of decisions) {
    events.push({
      at: now,
      type: decision.dispatchable ? 'task_ready' : 'task_blocked',
      taskId: decision.taskId,
      lane: decision.lane,
      tenantId: decision.boundary ? decision.boundary.tenantId : null,
      workspaceId: decision.boundary ? decision.boundary.workspaceId : null,
      boundaryIsolated: decision.boundary ? decision.boundary.isolated : null,
      priorityScore: decision.priorityScore,
      failureCodes: decision.failures.map((failure) => failure.code)
    });
  }

  return {
    reportState: health.state === 'unhealthy'
      ? 'blocked'
      : decisions.some((decision) => decision.state === 'needs_action')
        ? 'attention_required'
        : 'ready',
    eventCount: events.length,
    events
  };
}

function buildReportingState(analytics, history, timeline, operationalHealth) {
  const trend = classifyHistoryTrend(history);
  const severity = operationalHealth.dispatchGate === 'blocked' || analytics.queue.healthState === 'unhealthy'
    ? 'critical'
    : operationalHealth.dispatchGate === 'cooldown' || analytics.counters.needsAction > 0
      ? 'attention'
      : operationalHealth.dispatchGate === 'priority_only' || trend.state === 'rising'
        ? 'watch'
        : 'normal';
  const dominantFailure = analytics.failureHotspots[0] || null;

  return {
    schemaVersion: 1,
    contractKind: 'scheduler.priority-policy.reporting.v1',
    severity,
    reportState: timeline.reportState,
    trend,
    headline: dominantFailure
      ? `${dominantFailure.code} affects ${dominantFailure.count} scheduler decision(s)`
      : `${analytics.counters.dispatchable} scheduler decision(s) ready for dispatch`,
    counters: {
      evaluatedTasks: analytics.counters.total,
      dispatchable: analytics.counters.dispatchable,
      blocked: analytics.counters.blocked,
      needsAction: analytics.counters.needsAction,
      retryable: analytics.retry.retryable,
      exhaustedRetries: analytics.retry.exhausted
    },
    exportTargets: [
      {
        id: 'ops-summary',
        format: 'json',
        includes: ['summary', 'queue', 'trend', 'failureHotspots']
      },
      {
        id: 'decision-ledger',
        format: 'table',
        includes: ['decisionColumns', 'decisionRows']
      }
    ],
    sections: [
      {
        id: 'queue-health',
        state: analytics.queue.healthState,
        metric: analytics.queue.queueDepth,
        label: 'Queue depth'
      },
      {
        id: 'dispatch-readiness',
        state: analytics.counters.dispatchable > 0 ? 'ready' : 'blocked',
        metric: analytics.queue.dispatchableRatio,
        label: 'Dispatchable ratio'
      },
      {
        id: 'failure-hotspots',
        state: dominantFailure ? 'attention_required' : 'clear',
        metric: dominantFailure ? dominantFailure.count : 0,
        label: dominantFailure ? dominantFailure.code : 'No failure hotspot'
      }
    ]
  };
}

function buildExport(
  decisions,
  analytics,
  history,
  reportingState,
  now,
  readinessContract = null,
  clientRuntimeContract = null,
  boundaryContract = null,
  operationalHealth = null,
  persistenceContract = null,
  providerContract = null,
  auditHandoffContract = null
) {
  return {
    schemaVersion: 1,
    generatedAt: now,
    summary: {
      surfaceId,
      evaluatedTasks: analytics.counters.total,
      dispatchable: analytics.counters.dispatchable,
      blocked: analytics.counters.blocked,
      needsAction: analytics.counters.needsAction,
      healthState: analytics.queue.healthState,
      operationalHealthState: operationalHealth ? operationalHealth.state : 'unknown',
      dispatchGate: operationalHealth ? operationalHealth.dispatchGate : 'unknown',
      nextHealthCheckAt: operationalHealth ? operationalHealth.retry.nextHealthCheckAt : null,
      providerHealthState: operationalHealth ? operationalHealth.providerHealth.state : 'unknown',
      providerIncidentState: operationalHealth ? operationalHealth.providerHealth.incidentState : 'unknown',
      providerRetryAfterMs: operationalHealth ? operationalHealth.providerHealth.retryAfterMs : 0,
      providerValidationState: providerContract ? providerContract.validation.state : 'unknown',
      providerProtocolSupported: providerContract ? providerContract.provider.protocolSupported : false,
      providerSyncState: providerContract ? providerContract.sync.state : 'unknown',
      providerExternalHandoffState: providerContract ? providerContract.serviceContract.externalHandoff.state : 'unknown',
      providerHandoffEnvelopeState: providerContract ? providerContract.handoffEnvelope.state : 'unknown',
      queueDepth: analytics.queue.queueDepth,
      lifecycleState: analytics.queue.lifecycleState,
      dispatchMode: analytics.queue.dispatchMode,
      dispatchableRatio: analytics.queue.dispatchableRatio,
      historySnapshots: history.snapshots.length,
      reportingSeverity: reportingState.severity,
      reportingHeadline: reportingState.headline,
      historyTrendState: reportingState.trend.state,
      dominantFailureCode: analytics.failureHotspots[0] ? analytics.failureHotspots[0].code : null,
      previewState: readinessContract ? readinessContract.preview.state : 'not_requested',
      acceptanceState: readinessContract ? readinessContract.acceptance.state : 'not_requested',
      validationState: readinessContract ? readinessContract.validation.state : 'unknown',
      reviewBannerState: readinessContract ? readinessContract.reviewContract.banner.state : 'unknown',
      reviewPrimaryAction: readinessContract ? readinessContract.reviewContract.controls.primaryAction.command : 'unknown',
      reviewCanDispatch: readinessContract ? readinessContract.reviewContract.controls.canDispatch : false,
      reviewCanAcceptSelection: readinessContract ? readinessContract.reviewContract.controls.canAcceptSelection : false,
      nextStepCount: readinessContract ? readinessContract.nextSteps.length : 0,
      clientBindingState: clientRuntimeContract ? clientRuntimeContract.binding.state : 'unknown',
      clientHandoffState: clientRuntimeContract ? clientRuntimeContract.handoff.state : 'not_requested',
      clientDirective: clientRuntimeContract ? clientRuntimeContract.handoff.userVisibleDirective : 'none',
      clientWorkflowState: clientRuntimeContract ? clientRuntimeContract.workflow.state : 'unknown',
      clientWorkflowAction: clientRuntimeContract ? clientRuntimeContract.workflow.action : 'none',
      clientHandoffAckRequired: clientRuntimeContract ? clientRuntimeContract.workflow.requiresClientAck : false,
      clientDispatchManifestCount: clientRuntimeContract ? clientRuntimeContract.workflow.dispatchManifest.length : 0,
      boundaryValidationState: boundaryContract ? boundaryContract.validation.state : 'unknown',
      tenantId: boundaryContract ? boundaryContract.scope.tenantId : null,
      workspaceId: boundaryContract ? boundaryContract.scope.workspaceId : null,
      auditHandoffReady: boundaryContract ? boundaryContract.audit.handoffReady : false,
      auditCommitReady: auditHandoffContract ? auditHandoffContract.commit.ready : false,
      auditManifestRows: auditHandoffContract ? auditHandoffContract.manifest.totalRows : 0,
      auditUnscopedReadyRows: auditHandoffContract ? auditHandoffContract.manifest.unscopedReadyRows : 0,
      auditRouteAction: auditHandoffContract ? auditHandoffContract.sink.routeAction : 'unknown',
      restartSafeStatus: persistenceContract ? persistenceContract.restartSafeStatus : 'unknown',
      recoveredState: persistenceContract ? persistenceContract.recovered : false,
      commandStatus: persistenceContract ? persistenceContract.idempotency.commandStatus : 'unknown',
      pendingDispatchCount: persistenceContract ? persistenceContract.recovery.pendingDispatchCount : 0,
      ackOverdueDispatchCount: persistenceContract ? persistenceContract.recovery.ackOverdueDispatchCount : 0,
      dispatchWatermarkState: persistenceContract ? persistenceContract.idempotency.dispatchWatermarkState : 'unknown',
      checkpointMutation: persistenceContract ? persistenceContract.checkpointCommit.mutation : 'unknown',
      checkpointRouteAction: persistenceContract ? persistenceContract.checkpointCommit.routeAction : 'unknown',
      checkpointNextEpoch: persistenceContract ? persistenceContract.checkpointCommit.nextEpoch : null,
      lifecycleValidationState: readinessContract ? readinessContract.readiness.lifecycleValidationState : 'unknown',
      lifecycleNextAction: readinessContract ? readinessContract.readiness.lifecycleNextAction : 'unknown'
    },
    decisionColumns: [
      'taskId',
      'lane',
      'tenantId',
      'workspaceId',
      'priorityScore',
      'attempts',
      'taskAgeMs',
      'state',
      'dispatchable',
      'boundaryIsolated',
      'failureCodes',
      'nextRetryAt'
    ],
    decisionRows: decisions.map((decision) => ({
      taskId: decision.taskId,
      lane: decision.lane,
      tenantId: decision.boundary ? decision.boundary.tenantId : null,
      workspaceId: decision.boundary ? decision.boundary.workspaceId : null,
      priorityScore: decision.priorityScore,
      attempts: decision.attempts,
      taskAgeMs: decision.taskAgeMs,
      state: decision.state,
      dispatchable: decision.dispatchable,
      boundaryIsolated: decision.boundary ? decision.boundary.isolated : null,
      failureCodes: decision.failures.map((failure) => failure.code),
      nextRetryAt: decision.retry.nextRetryAt
    })),
    laneCounters: analytics.lanes,
    failureHotspots: analytics.failureHotspots,
    reporting: reportingState,
    readiness: readinessContract
      ? {
          contractKind: readinessContract.contractKind,
          previewState: readinessContract.preview.state,
          acceptanceState: readinessContract.acceptance.state,
          validationState: readinessContract.validation.state,
          readyForDispatch: readinessContract.readiness.readyForDispatch,
          nextSteps: readinessContract.nextSteps.map((step) => step.label),
          review: {
            contractKind: readinessContract.reviewContract.contractKind,
            banner: readinessContract.reviewContract.banner,
            controls: readinessContract.reviewContract.controls,
            acceptancePayload: readinessContract.reviewContract.acceptancePayload,
            previewList: readinessContract.reviewContract.previewList,
            routeContext: readinessContract.reviewContract.routeContext
          }
      }
      : null,
    lifecycleControls: readinessContract ? readinessContract.lifecycleControls : null,
    boundary: boundaryContract
      ? {
          contractKind: boundaryContract.contractKind,
          validationState: boundaryContract.validation.state,
          tenantId: boundaryContract.scope.tenantId,
          workspaceId: boundaryContract.scope.workspaceId,
          allowedTenantIds: boundaryContract.scope.allowedTenantIds,
          allowedWorkspaceIds: boundaryContract.scope.allowedWorkspaceIds,
          auditRequired: boundaryContract.audit.required,
          auditHandoffReady: boundaryContract.audit.handoffReady,
          auditCorrelationId: boundaryContract.audit.correlationId
        }
      : null,
    auditHandoff: auditHandoffContract
      ? {
          contractKind: auditHandoffContract.contractKind,
          validationState: auditHandoffContract.validation.state,
          sink: auditHandoffContract.sink,
          commit: auditHandoffContract.commit,
          manifest: {
            totalRows: auditHandoffContract.manifest.totalRows,
            readyRows: auditHandoffContract.manifest.readyRows,
            blockedRows: auditHandoffContract.manifest.blockedRows,
            unscopedReadyRows: auditHandoffContract.manifest.unscopedReadyRows,
            tenantIds: auditHandoffContract.manifest.tenantIds,
            workspaceIds: auditHandoffContract.manifest.workspaceIds,
            rows: auditHandoffContract.manifest.rows
          },
          issues: auditHandoffContract.validation.issues
        }
      : null,
    operationalHealth: operationalHealth
      ? {
          contractKind: operationalHealth.contractKind,
          state: operationalHealth.state,
          dispatchGate: operationalHealth.dispatchGate,
          sustained: operationalHealth.sustained,
          retry: operationalHealth.retry,
          providerHealth: operationalHealth.providerHealth,
          degradedMode: operationalHealth.degradedMode,
          validationState: operationalHealth.validation.state,
          issues: operationalHealth.validation.issues
        }
      : null,
    providerService: providerContract
      ? {
          contractKind: providerContract.serviceContract.contractKind,
          validationState: providerContract.validation.state,
          protocol: providerContract.provider.protocol,
          protocolSupported: providerContract.provider.protocolSupported,
          contractVersion: providerContract.provider.contractVersion,
          requiredCapabilities: providerContract.provider.requiredCapabilities,
          missingRequiredCapabilities: providerContract.provider.missingRequiredCapabilities,
          syncState: providerContract.sync.state,
          cursorRequired: providerContract.serviceContract.sync.cursorRequired,
          minimumSourceEpoch: providerContract.sync.minimumSourceEpoch,
          externalHandoff: providerContract.serviceContract.externalHandoff,
          handoffEnvelope: providerContract.handoffEnvelope,
          issues: providerContract.validation.issues
        }
      : null,
    clientRuntime: clientRuntimeContract
      ? {
          contractKind: clientRuntimeContract.contractKind,
          bindingState: clientRuntimeContract.binding.state,
          channel: clientRuntimeContract.binding.channel,
          route: clientRuntimeContract.binding.route,
          handoffState: clientRuntimeContract.handoff.state,
          directive: clientRuntimeContract.handoff.userVisibleDirective,
          resumeToken: clientRuntimeContract.handoff.resumeToken,
          workflowState: clientRuntimeContract.workflow.state,
          workflowAction: clientRuntimeContract.workflow.action,
          requiresClientAck: clientRuntimeContract.workflow.requiresClientAck,
          dispatchManifestCount: clientRuntimeContract.workflow.dispatchManifest.length,
          blockedManifestCount: clientRuntimeContract.workflow.blockedManifest.length,
          validationState: clientRuntimeContract.validation.state
        }
      : null,
    persistence: persistenceContract
      ? {
          contractKind: persistenceContract.contractKind,
          restartSafeStatus: persistenceContract.restartSafeStatus,
          recovered: persistenceContract.recovered,
          recoveryValidationState: persistenceContract.recovery.validationState,
          commandStatus: persistenceContract.idempotency.commandStatus,
          replayedCommand: persistenceContract.idempotency.replayed,
          pendingDispatchCount: persistenceContract.recovery.pendingDispatchCount,
          ackOverdueDispatchCount: persistenceContract.recovery.ackOverdueDispatchCount,
          dispatchWatermarkState: persistenceContract.idempotency.dispatchWatermarkState,
          writeRequired: persistenceContract.writeIntent.required,
          writeReason: persistenceContract.writeIntent.reason,
          checkpointMutation: persistenceContract.checkpointCommit.mutation,
          checkpointRouteAction: persistenceContract.checkpointCommit.routeAction,
          checkpointIdempotencyKey: persistenceContract.checkpointCommit.idempotencyKey,
          restartStatusSnapshot: persistenceContract.restartStatusSnapshot,
          checkpointCommit: persistenceContract.checkpointCommit,
          nextCheckpoint: persistenceContract.nextCheckpoint
        }
      : null
  };
}

function normalizeCapabilityList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((capability) => (
    typeof capability === 'string' && capability.trim().length > 0
  )).map((capability) => capability.trim()))];
}

function normalizeProviderServiceContract(
  providerInput,
  serviceInput,
  syncInput,
  targetService,
  requestedCapabilities,
  acceptedCapabilities,
  rejectedCapabilities,
  dispatchableDecisions,
  controls,
  nowMs,
  now
) {
  const rawProtocol = trimmedString(providerInput.protocol || serviceInput.protocol) || 'aios.scheduler.provider.v1';
  const requiredCapabilities = normalizeCapabilityList(
    serviceInput.requiredCapabilities
      || providerInput.requiredCapabilities
      || PROVIDER_REQUIRED_CAPABILITIES
  );
  const missingRequiredCapabilities = requiredCapabilities.filter((capability) => (
    !acceptedCapabilities.includes(capability)
  ));
  const minimumSourceEpoch = optionalInteger(
    syncInput.minimumSourceEpoch ?? serviceInput.minimumSourceEpoch ?? providerInput.minimumSourceEpoch,
    0,
    1_000_000_000
  );
  const sourceEpoch = optionalInteger(syncInput.sourceEpoch, 0, 1_000_000_000) || 0;
  const requireSyncCursor = syncInput.requireCursor === true
    || serviceInput.requireSyncCursor === true
    || dispatchableDecisions.length > 0;
  const cursor = trimmedString(syncInput.cursor);
  const leaseInput = readObject(
    serviceInput.externalHandoff,
    providerInput.externalHandoff,
    serviceInput.handoffLease,
    providerInput.handoffLease
  );
  const externalRouteRequested = leaseInput.required === true
    || leaseInput.enabled === true
    || controls.dispatchMode === 'manual'
    || dispatchableDecisions.some((decision) => decision.boundary?.isolated === false);
  const leaseId = trimmedString(leaseInput.leaseId || leaseInput.id);
  const leaseTarget = trimmedString(leaseInput.target || leaseInput.targetService || leaseInput.uri);
  const leaseExpiresAt = trimmedString(leaseInput.expiresAt || leaseInput.expireAt);
  const leaseExpiresAtMs = leaseExpiresAt ? toEpochMs(leaseExpiresAt, null) : null;
  const leaseExpired = leaseExpiresAtMs !== null && leaseExpiresAtMs <= nowMs;
  const validationCodes = [];

  if (!PROVIDER_PROTOCOLS.includes(rawProtocol)) validationCodes.push('PROVIDER_PROTOCOL_UNSUPPORTED');
  if (missingRequiredCapabilities.length > 0 || rejectedCapabilities.some((capability) => (
    requiredCapabilities.includes(capability)
  ))) {
    validationCodes.push('PROVIDER_REQUIRED_CAPABILITY_MISSING');
  }
  if (requireSyncCursor && !cursor) validationCodes.push('PROVIDER_SYNC_CURSOR_REQUIRED');
  if (sourceEpoch < minimumSourceEpoch) validationCodes.push('PROVIDER_SYNC_EPOCH_REGRESSION');
  if (externalRouteRequested && (!leaseId || !leaseTarget)) validationCodes.push('PROVIDER_EXTERNAL_LEASE_REQUIRED');
  if (externalRouteRequested && leaseExpired) validationCodes.push('PROVIDER_EXTERNAL_LEASE_EXPIRED');

  const uniqueCodes = [...new Set(validationCodes)];

  return {
    schemaVersion: 1,
    contractKind: 'scheduler.priority-policy.provider-service-contract.v1',
    generatedAt: now,
    service: {
      targetService,
      protocol: rawProtocol,
      protocolSupported: PROVIDER_PROTOCOLS.includes(rawProtocol),
      contractVersion: trimmedString(serviceInput.contractVersion || providerInput.contractVersion) || 'v1',
      route: trimmedString(serviceInput.route || providerInput.route) || 'scheduler.priority-policy.provider-handoff'
    },
    capabilities: {
      supported: [...PROVIDER_CAPABILITIES],
      requested: requestedCapabilities,
      accepted: acceptedCapabilities,
      rejected: rejectedCapabilities,
      required: requiredCapabilities,
      missingRequired: missingRequiredCapabilities,
      negotiationState: uniqueCodes.includes('PROVIDER_REQUIRED_CAPABILITY_MISSING') ? 'incomplete' : 'negotiated'
    },
    sync: {
      cursor,
      sourceEpoch,
      minimumSourceEpoch,
      cursorRequired: requireSyncCursor,
      state: uniqueCodes.some((code) => code.startsWith('PROVIDER_SYNC_')) ? 'action_required' : 'ready'
    },
    externalHandoff: {
      required: externalRouteRequested,
      state: !externalRouteRequested
        ? 'not_required'
        : uniqueCodes.includes('PROVIDER_EXTERNAL_LEASE_EXPIRED')
          ? 'lease_expired'
          : uniqueCodes.includes('PROVIDER_EXTERNAL_LEASE_REQUIRED')
            ? 'lease_required'
            : 'lease_active',
      leaseId,
      target: leaseTarget,
      expiresAt: leaseExpiresAt,
      expiresInMs: leaseExpiresAtMs === null ? null : Math.max(0, leaseExpiresAtMs - nowMs)
    },
    validation: {
      state: uniqueCodes.length === 0 ? 'valid' : 'action_required',
      issueCount: uniqueCodes.length,
      issues: uniqueCodes.map((code) => ({
        scope: 'provider_service',
        code,
        action: ACTIONABLE_ERROR[code] || 'Repair scheduler provider service contract before dispatch handoff.'
      }))
    }
  };
}

function buildProviderHandoffEnvelope(providerContract, decisions, now) {
  const readyDecisions = decisions.filter((decision) => decision.dispatchable);
  const blockedDecisions = decisions.filter((decision) => !decision.dispatchable);
  const externalHandoff = providerContract.serviceContract.externalHandoff;
  const capabilityIssues = providerContract.validation.issues.filter((issue) => (
    issue.code === 'PROVIDER_REQUIRED_CAPABILITY_MISSING'
      || issue.code === 'PROVIDER_PROTOCOL_UNSUPPORTED'
  ));
  const syncIssues = providerContract.validation.issues.filter((issue) => (
    issue.code === 'PROVIDER_SYNC_CURSOR_REQUIRED'
      || issue.code === 'PROVIDER_SYNC_EPOCH_REGRESSION'
  ));
  const leaseIssues = providerContract.validation.issues.filter((issue) => (
    issue.code === 'PROVIDER_EXTERNAL_LEASE_REQUIRED'
      || issue.code === 'PROVIDER_EXTERNAL_LEASE_EXPIRED'
  ));
  const envelopeState = providerContract.validation.state !== 'valid'
    ? 'contract_action_required'
    : providerContract.handoff.state === 'ready_for_handoff'
      ? externalHandoff.required
        ? 'external_handoff_ready'
        : 'hosted_kernel_handoff_ready'
      : providerContract.handoff.state;

  return {
    schemaVersion: 1,
    contractKind: 'scheduler.priority-policy.provider-handoff-envelope.v1',
    generatedAt: now,
    state: envelopeState,
    route: providerContract.serviceContract.service.route,
    targetService: providerContract.provider.targetService,
    payloadKind: providerContract.handoff.payloadKind,
    idempotencyKey: providerContract.handoff.idempotencyKey,
    capabilityNegotiation: {
      state: providerContract.serviceContract.capabilities.negotiationState,
      accepted: providerContract.provider.acceptedCapabilities,
      rejected: providerContract.provider.rejectedCapabilities,
      required: providerContract.provider.requiredCapabilities,
      missingRequired: providerContract.provider.missingRequiredCapabilities,
      issueCount: capabilityIssues.length
    },
    syncMetadata: {
      state: providerContract.sync.state,
      cursor: providerContract.sync.cursor,
      sourceEpoch: providerContract.sync.sourceEpoch,
      minimumSourceEpoch: providerContract.sync.minimumSourceEpoch,
      ackToken: providerContract.sync.ackToken,
      requiresAck: providerContract.sync.requiresAck,
      lagMs: providerContract.sync.lagMs,
      issueCount: syncIssues.length
    },
    externalHandoff: {
      required: externalHandoff.required,
      state: externalHandoff.state,
      target: externalHandoff.target,
      leaseId: externalHandoff.leaseId,
      expiresAt: externalHandoff.expiresAt,
      expiresInMs: externalHandoff.expiresInMs,
      issueCount: leaseIssues.length
    },
    manifest: {
      readyCount: readyDecisions.length,
      blockedCount: blockedDecisions.length,
      readyTaskIds: readyDecisions.map((decision) => decision.taskId).filter(Boolean),
      blockedTaskIds: blockedDecisions.map((decision) => decision.taskId).filter(Boolean),
      laneCounts: readyDecisions.reduce((counts, decision) => {
        counts[decision.lane] = (counts[decision.lane] || 0) + 1;
        return counts;
      }, {})
    }
  };
}

function providerGateFailureCodes(providerContract) {
  if (providerContract.validation.state !== 'valid') {
    return providerContract.validation.issues.map((issue) => issue.code);
  }
  if (providerContract.handoff.state === 'blocked_by_provider_contract') {
    return ['PROVIDER_REQUIRED_CAPABILITY_MISSING'];
  }
  return [];
}

function applyProviderServiceGate(decisions, providerContract) {
  const failureCodes = [...new Set(providerGateFailureCodes(providerContract))];
  if (failureCodes.length === 0) return decisions;

  return decisions.map((decision) => {
    if (!decision.dispatchable) return decision;
    const mergedCodes = [
      ...decision.failures.map((failure) => failure.code),
      ...failureCodes
    ];

    return {
      ...decision,
      state: 'needs_action',
      dispatchable: false,
      failures: decorateFailures([...new Set(mergedCodes)])
    };
  });
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item) => (
    typeof item === 'string' && item.trim().length > 0
  )).map((item) => item.trim()))];
}

function trimmedString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeBoundaryContract(input = {}, now) {
  const tenantInput = input.tenant && typeof input.tenant === 'object' ? input.tenant : {};
  const workspaceInput = input.workspace && typeof input.workspace === 'object' ? input.workspace : {};
  const boundaryInput = input.boundary && typeof input.boundary === 'object' ? input.boundary : {};
  const actorInput = input.actor && typeof input.actor === 'object' ? input.actor : {};
  const auditInput = input.audit && typeof input.audit === 'object' ? input.audit : {};
  const tenantId = trimmedString(boundaryInput.tenantId || tenantInput.id || tenantInput.tenantId || input.tenantId);
  const workspaceId = trimmedString(boundaryInput.workspaceId || workspaceInput.id || workspaceInput.workspaceId || input.workspaceId);
  const allowedTenantIds = normalizeStringList(boundaryInput.allowedTenantIds || tenantInput.allowedTenantIds);
  const allowedWorkspaceIds = normalizeStringList(boundaryInput.allowedWorkspaceIds || workspaceInput.allowedWorkspaceIds);
  const roles = normalizeStringList(actorInput.roles || boundaryInput.roles);
  const explicitPermissions = normalizeStringList(actorInput.permissions || boundaryInput.permissions);
  const rolePermissions = roles.flatMap((role) => ROLE_PERMISSIONS[role] || []);
  const permissions = [...new Set([...explicitPermissions, ...rolePermissions])];
  const requirePermissionCheck = boundaryInput.enforcePermissions === true
    || roles.length > 0
    || explicitPermissions.length > 0;
  const requireTenantBinding = boundaryInput.requireTenantBinding !== false;
  const requireWorkspaceBinding = boundaryInput.requireWorkspaceBinding === true || allowedWorkspaceIds.length > 0;
  const requireAuditHandoff = boundaryInput.requireAuditHandoff === true || auditInput.required === true;
  const auditSink = trimmedString(auditInput.sink || auditInput.target || boundaryInput.auditSink);
  const validationCodes = [];

  if (requireTenantBinding && !tenantId) validationCodes.push('TENANT_BINDING_REQUIRED');
  if (requireWorkspaceBinding && !workspaceId) validationCodes.push('WORKSPACE_SCOPE_REQUIRED');
  if (tenantId && allowedTenantIds.length > 0 && !allowedTenantIds.includes(tenantId)) {
    validationCodes.push('TENANT_SCOPE_VIOLATION');
  }
  if (workspaceId && allowedWorkspaceIds.length > 0 && !allowedWorkspaceIds.includes(workspaceId)) {
    validationCodes.push('WORKSPACE_SCOPE_VIOLATION');
  }
  if (requireAuditHandoff && !auditSink) validationCodes.push('AUDIT_HANDOFF_REQUIRED');

  return {
    schemaVersion: 1,
    contractKind: 'scheduler.priority-policy.boundary.v1',
    generatedAt: now,
    scope: {
      tenantId,
      workspaceId,
      allowedTenantIds,
      allowedWorkspaceIds,
      requireTenantBinding,
      requireWorkspaceBinding
    },
    actor: {
      actorId: trimmedString(actorInput.id || actorInput.actorId || boundaryInput.actorId),
      roles,
      permissions,
      requirePermissionCheck
    },
    audit: {
      required: requireAuditHandoff,
      sink: auditSink,
      correlationId: trimmedString(auditInput.correlationId || boundaryInput.correlationId || input.requestId),
      handoffReady: !requireAuditHandoff || Boolean(auditSink)
    },
    validation: {
      state: validationCodes.length === 0 ? 'valid' : 'action_required',
      issueCount: validationCodes.length,
      issues: validationCodes.map((code) => ({
        scope: 'boundary',
        code,
        action: ACTIONABLE_ERROR[code] || 'Repair scheduler boundary contract before dispatch.'
      }))
    }
  };
}

function hasLaneDispatchPermission(boundaryContract, lane) {
  const permissions = boundaryContract.actor.permissions;
  return permissions.includes('scheduler.dispatch:any') || permissions.includes(`scheduler.dispatch:${lane}`);
}

function taskBoundaryFailures(rawTask, boundaryContract) {
  const taskTenantId = trimmedString(rawTask.tenantId || rawTask.tenant?.id || rawTask.scope?.tenantId);
  const taskWorkspaceId = trimmedString(rawTask.workspaceId || rawTask.workspace?.id || rawTask.scope?.workspaceId);
  const effectiveTenantId = taskTenantId || boundaryContract.scope.tenantId;
  const effectiveWorkspaceId = taskWorkspaceId || boundaryContract.scope.workspaceId;
  const failures = [];

  if (boundaryContract.scope.requireTenantBinding && !effectiveTenantId) failures.push('TENANT_BINDING_REQUIRED');
  if (boundaryContract.scope.requireWorkspaceBinding && !effectiveWorkspaceId) failures.push('WORKSPACE_SCOPE_REQUIRED');
  if (effectiveTenantId && boundaryContract.scope.tenantId && effectiveTenantId !== boundaryContract.scope.tenantId) {
    failures.push('TENANT_SCOPE_VIOLATION');
  }
  if (
    effectiveWorkspaceId
    && boundaryContract.scope.allowedWorkspaceIds.length > 0
    && !boundaryContract.scope.allowedWorkspaceIds.includes(effectiveWorkspaceId)
  ) {
    failures.push('WORKSPACE_SCOPE_VIOLATION');
  }
  if (
    boundaryContract.actor.requirePermissionCheck
    && !hasLaneDispatchPermission(boundaryContract, typeof rawTask.lane === 'string' ? rawTask.lane : 'normal')
  ) {
    failures.push('ROLE_DISPATCH_FORBIDDEN');
  }
  if (boundaryContract.audit.required && !boundaryContract.audit.handoffReady) failures.push('AUDIT_HANDOFF_REQUIRED');

  return {
    tenantId: effectiveTenantId,
    workspaceId: effectiveWorkspaceId,
    isolated: failures.length === 0,
    failureCodes: [...new Set(failures)]
  };
}

function buildAuditScopeToken(boundaryContract, decision, providerContract, clientRuntimeContract) {
  return [
    surfaceId,
    boundaryContract.audit.correlationId || 'no-correlation',
    decision.boundary?.tenantId || 'no-tenant',
    decision.boundary?.workspaceId || 'no-workspace',
    decision.taskId || 'no-task',
    providerContract.sync.ackToken || 'no-provider-ack',
    clientRuntimeContract.binding.requestId || 'no-request'
  ].join(':');
}

function buildAuditHandoffContract(decisions, boundaryContract, providerContract, clientRuntimeContract, now) {
  const scopedRows = decisions.map((decision, index) => {
    const failureCodes = decision.failures.map((failure) => failure.code);
    const scopeToken = buildAuditScopeToken(boundaryContract, decision, providerContract, clientRuntimeContract);
    const auditState = decision.dispatchable && decision.boundary?.isolated
      ? 'ready'
      : failureCodes.some((code) => (
        code === 'TENANT_BINDING_REQUIRED'
          || code === 'WORKSPACE_SCOPE_REQUIRED'
          || code === 'TENANT_SCOPE_VIOLATION'
          || code === 'WORKSPACE_SCOPE_VIOLATION'
          || code === 'ROLE_DISPATCH_FORBIDDEN'
          || code === 'AUDIT_HANDOFF_REQUIRED'
      ))
        ? 'blocked_by_boundary'
        : decision.dispatchable
          ? 'ready_unscoped'
          : 'blocked_by_scheduler';

    return {
      ordinal: index + 1,
      taskId: decision.taskId,
      lane: decision.lane,
      tenantId: decision.boundary ? decision.boundary.tenantId : null,
      workspaceId: decision.boundary ? decision.boundary.workspaceId : null,
      isolated: decision.boundary ? decision.boundary.isolated : false,
      dispatchable: decision.dispatchable,
      auditState,
      scopeToken,
      failureCodes
    };
  });
  const readyRows = scopedRows.filter((row) => row.dispatchable);
  const blockedRows = scopedRows.filter((row) => !row.dispatchable);
  const unscopedReadyRows = readyRows.filter((row) => row.auditState !== 'ready');
  const validationCodes = [];

  if (boundaryContract.audit.required && !boundaryContract.audit.handoffReady) {
    validationCodes.push('AUDIT_HANDOFF_REQUIRED');
  }
  if (unscopedReadyRows.length > 0) {
    validationCodes.push('WORKSPACE_SCOPE_VIOLATION');
  }

  const uniqueCodes = [...new Set(validationCodes)];
  const commitReady = uniqueCodes.length === 0
    && (!boundaryContract.audit.required || boundaryContract.audit.handoffReady)
    && unscopedReadyRows.length === 0;

  return {
    schemaVersion: 1,
    contractKind: 'scheduler.priority-policy.audit-handoff.v1',
    generatedAt: now,
    sink: {
      required: boundaryContract.audit.required,
      ready: boundaryContract.audit.handoffReady,
      target: boundaryContract.audit.sink,
      correlationId: boundaryContract.audit.correlationId,
      routeAction: boundaryContract.audit.handoffReady
        ? 'scheduler.priority-policy.audit-handoff'
        : 'scheduler.priority-policy.bind-audit-sink'
    },
    commit: {
      ready: commitReady,
      mode: commitReady && readyRows.length > 0
        ? 'append_before_dispatch'
        : uniqueCodes.length > 0
          ? 'blocked_until_audit_scope_valid'
          : 'observe_only',
      providerAckToken: providerContract.sync.ackToken,
      clientResumeToken: clientRuntimeContract.handoff.resumeToken,
      idempotencyKey: [
        surfaceId,
        'audit',
        boundaryContract.audit.correlationId || 'no-correlation',
        providerContract.sync.ackToken || 'no-provider-ack',
        readyRows.map((row) => row.taskId).filter(Boolean).join(',') || 'no-ready-tasks'
      ].join(':')
    },
    manifest: {
      totalRows: scopedRows.length,
      readyRows: readyRows.length,
      blockedRows: blockedRows.length,
      unscopedReadyRows: unscopedReadyRows.length,
      tenantIds: [...new Set(scopedRows.map((row) => row.tenantId).filter(Boolean))],
      workspaceIds: [...new Set(scopedRows.map((row) => row.workspaceId).filter(Boolean))],
      rows: scopedRows.slice(0, 50)
    },
    validation: {
      state: uniqueCodes.length === 0 ? 'valid' : 'action_required',
      issueCount: uniqueCodes.length,
      issues: uniqueCodes.map((code) => ({
        scope: 'audit_handoff',
        code,
        action: ACTIONABLE_ERROR[code] || 'Repair scheduler audit handoff before dispatch.'
      }))
    }
  };
}

function buildClientTaskReference(decision, state) {
  return {
    taskId: decision.taskId,
    lane: decision.lane,
    state,
    priorityScore: decision.priorityScore,
    tenantId: decision.boundary ? decision.boundary.tenantId : null,
    workspaceId: decision.boundary ? decision.boundary.workspaceId : null,
    failureCodes: decision.failures.map((failure) => failure.code),
    nextRetryAt: decision.retry.nextRetryAt
  };
}

function normalizeClientHandoffAck(clientInput, requestInput, runtimeInput) {
  const ackInput = readObject(
    runtimeInput.handoffAck,
    runtimeInput.ack,
    clientInput.handoffAck,
    clientInput.ack,
    requestInput.handoffAck,
    requestInput.ack
  );

  return {
    acknowledged: ackInput.acknowledged === true || runtimeInput.handoffAcknowledged === true,
    acknowledgedAt: trimmedString(ackInput.acknowledgedAt || ackInput.at),
    acknowledgedBy: trimmedString(ackInput.acknowledgedBy || ackInput.by || clientInput.actorId || requestInput.actorId),
    resumeToken: trimmedString(
      ackInput.resumeToken
        || runtimeInput.resumeToken
        || clientInput.resumeToken
        || requestInput.resumeToken
    ),
    providerAckToken: trimmedString(ackInput.providerAckToken || ackInput.ackToken || runtimeInput.providerAckToken),
    acceptedTaskIds: normalizeStringList(ackInput.acceptedTaskIds || ackInput.taskIds),
    requiresAck: ackInput.required === true || runtimeInput.requireHandoffAck === true || clientInput.requireHandoffAck === true
  };
}

function clientWorkflowActionFor(handoffState, handoffMode, readyCount, blockedCount) {
  if (handoffState === 'client_handoff_ready') {
    return handoffMode === 'external' ? 'route-external-dispatch' : 'present-dispatch-ready-batch';
  }
  if (handoffState === 'client_contract_invalid') return 'bind-client-runtime';
  if (handoffState === 'blocked_by_provider_contract') return 'repair-provider-service-contract';
  if (handoffState === 'scheduler_disabled') return 'enable-scheduler-policy';
  if (handoffState === 'blocked_by_operational_health') return 'inspect-health-incident';
  if (handoffState === 'waiting_for_health_recovery') return 'wait-health-cooldown';
  if (handoffState === 'scheduler_unhealthy') return 'inspect-workers';
  if (blockedCount > 0) return 'review-scheduler-actions';
  if (readyCount === 0) return 'wait-for-schedulable-work';
  return 'review-scheduler-handoff';
}

function normalizeClientRuntimeContract(input = {}, controls, health, decisions, providerContract, now) {
  const clientInput = input.client && typeof input.client === 'object' ? input.client : {};
  const requestInput = input.request && typeof input.request === 'object' ? input.request : {};
  const runtimeInput = input.runtime && typeof input.runtime === 'object' ? input.runtime : {};
  const workflowInput = input.workflow && typeof input.workflow === 'object' ? input.workflow : {};
  const rawChannel = trimmedString(clientInput.channel || requestInput.channel || runtimeInput.channel) || 'system';
  const rawHandoffMode = trimmedString(clientInput.handoffMode || requestInput.handoffMode || runtimeInput.handoffMode)
    || (controls.dispatchMode === 'manual' ? 'deferred' : 'inline');
  const channel = CLIENT_CHANNELS.includes(rawChannel) ? rawChannel : 'system';
  const handoffMode = CLIENT_HANDOFF_MODES.includes(rawHandoffMode) ? rawHandoffMode : 'inline';
  const requestId = trimmedString(requestInput.id || requestInput.requestId || clientInput.requestId || input.requestId);
  const sessionId = trimmedString(requestInput.sessionId || clientInput.sessionId || runtimeInput.sessionId || input.sessionId);
  const actorId = trimmedString(requestInput.actorId || clientInput.actorId || runtimeInput.actorId);
  const workflowId = trimmedString(workflowInput.id || workflowInput.workflowId || clientInput.workflowId || requestInput.workflowId);
  const route = trimmedString(requestInput.route || clientInput.route || runtimeInput.route) || 'scheduler.priority-policy';
  const requireRequestBinding = clientInput.requireRequestBinding === true || requestInput.requireBinding === true;
  const requireSessionBinding = clientInput.requireSessionBinding === true || runtimeInput.requireSessionBinding === true;
  const explicitHandoffTarget = trimmedString(clientInput.handoffTarget || runtimeInput.handoffTarget);
  const readyTaskRefs = decisions
    .filter((decision) => decision.dispatchable)
    .map((decision) => buildClientTaskReference(decision, 'ready'));
  const blockedTaskRefs = decisions
    .filter((decision) => !decision.dispatchable)
    .map((decision) => buildClientTaskReference(decision, 'blocked'));
  const readyTaskIds = readyTaskRefs.map((task) => task.taskId).filter(Boolean);
  const blockedTaskIds = blockedTaskRefs.map((task) => task.taskId).filter(Boolean);
  const validationCodes = [];

  if (requireRequestBinding && !requestId) validationCodes.push('CLIENT_REQUEST_BINDING_REQUIRED');
  if (requireSessionBinding && !sessionId) validationCodes.push('CLIENT_SESSION_BINDING_REQUIRED');
  if (!CLIENT_CHANNELS.includes(rawChannel)) validationCodes.push('CLIENT_CHANNEL_UNSUPPORTED');
  if (!CLIENT_HANDOFF_MODES.includes(rawHandoffMode)) validationCodes.push('CLIENT_HANDOFF_MODE_UNSUPPORTED');
  if (handoffMode === 'external' && !explicitHandoffTarget) validationCodes.push('CLIENT_HANDOFF_TARGET_REQUIRED');

  const providerBlockedByOperationalHealth = [
    'blocked_by_operational_health',
    'waiting_for_health_recovery',
    'blocked_by_provider_contract'
  ].includes(providerContract.handoff.state);
  const resumeToken = [
    surfaceId,
    route,
    requestId || 'anonymous-request',
    sessionId || 'anonymous-session',
    providerContract.handoff.idempotencyKey
  ].join(':');
  const ack = normalizeClientHandoffAck(clientInput, requestInput, runtimeInput);
  const requiresAck = ack.requiresAck || handoffMode === 'external';

  if (ack.resumeToken && ack.resumeToken !== resumeToken) validationCodes.push('CLIENT_RESUME_TOKEN_MISMATCH');
  if (requiresAck && readyTaskIds.length > 0 && !ack.acknowledged) validationCodes.push('HANDOFF_ACK_REQUIRED');

  const handoffReady = providerContract.handoff.state === 'ready_for_handoff'
    && health.state !== 'unhealthy'
    && controls.enabled
    && validationCodes.length === 0
    && readyTaskIds.length > 0;
  const handoffState = validationCodes.length > 0
    ? 'client_contract_invalid'
    : !controls.enabled
      ? 'scheduler_disabled'
      : providerBlockedByOperationalHealth
        ? providerContract.handoff.state
      : health.state === 'unhealthy'
        ? 'scheduler_unhealthy'
        : readyTaskIds.length > 0
          ? 'client_handoff_ready'
          : blockedTaskIds.length > 0
            ? 'client_action_required'
            : 'idle';
  const workflowAction = clientWorkflowActionFor(handoffState, handoffMode, readyTaskIds.length, blockedTaskIds.length);
  const dispatchManifest = readyTaskRefs.map((task, index) => ({
    ordinal: index + 1,
    ...task,
    route,
    handoffMode,
    requiresClientAck: requiresAck,
    providerAckToken: providerContract.sync.ackToken
  }));

  return {
    schemaVersion: 1,
    contractKind: 'scheduler.priority-policy.client-runtime.v1',
    generatedAt: now,
    binding: {
      state: validationCodes.length === 0 ? 'valid' : 'action_required',
      requestId,
      sessionId,
      actorId,
      workflowId,
      route,
      channel,
      handoffMode,
      requireRequestBinding,
      requireSessionBinding
    },
    handoff: {
      state: handoffState,
      ready: handoffReady,
      target: explicitHandoffTarget || providerContract.provider.targetService,
      resumeToken,
      providerAckToken: providerContract.sync.ackToken,
      dispatchableTaskIds: readyTaskIds,
      blockedTaskIds,
      userVisibleDirective: handoffReady
        ? 'present_dispatch_ready_batch'
        : validationCodes.length > 0
          ? 'repair_client_binding'
          : providerBlockedByOperationalHealth
            ? providerContract.handoff.state === 'blocked_by_provider_contract'
              ? 'present_provider_contract_action'
              : 'present_operational_health_action'
          : blockedTaskIds.length > 0
            ? 'present_scheduler_actions'
            : 'wait_for_schedulable_work'
    },
    workflow: {
      state: handoffReady ? 'handoff_ready' : validationCodes.length > 0 ? 'handoff_blocked' : 'waiting',
      action: workflowAction,
      routeAction: `scheduler.priority-policy.${workflowAction}`,
      requiresClientAck: requiresAck,
      ack: {
        acknowledged: ack.acknowledged,
        acknowledgedAt: ack.acknowledgedAt,
        acknowledgedBy: ack.acknowledgedBy,
        resumeTokenMatched: ack.resumeToken ? ack.resumeToken === resumeToken : null,
        providerAckMatched: ack.providerAckToken ? ack.providerAckToken === providerContract.sync.ackToken : null,
        acceptedTaskIds: ack.acceptedTaskIds,
        missingAck: requiresAck && readyTaskIds.length > 0 && !ack.acknowledged
      },
      dispatchManifest,
      blockedManifest: blockedTaskRefs.slice(0, 25),
      handoffPayload: {
        requestId,
        sessionId,
        workflowId,
        route,
        channel,
        handoffMode,
        target: explicitHandoffTarget || providerContract.provider.targetService,
        resumeToken,
        providerAckToken: providerContract.sync.ackToken,
        dispatchableCount: readyTaskIds.length,
        blockedCount: blockedTaskIds.length
      }
    },
    validation: {
      state: validationCodes.length === 0 ? 'valid' : 'action_required',
      issueCount: validationCodes.length,
      issues: validationCodes.map((code) => ({
        scope: 'client_runtime',
        code,
        action: ACTIONABLE_ERROR[code] || 'Repair client runtime binding before dispatch handoff.'
      }))
    }
  };
}

function normalizeProviderContract(input = {}, controls, health, policy, decisions, now, boundaryContract = null, operationalHealth = null) {
  const providerInput = input.provider && typeof input.provider === 'object' ? input.provider : {};
  const serviceInput = input.service && typeof input.service === 'object' ? input.service : {};
  const syncInput = input.sync && typeof input.sync === 'object'
    ? input.sync
    : providerInput.sync && typeof providerInput.sync === 'object'
      ? providerInput.sync
      : {};
  const requestedCapabilities = normalizeCapabilityList(
    providerInput.requestedCapabilities || input.requestedCapabilities
  );
  const acceptedCapabilities = requestedCapabilities.length > 0
    ? requestedCapabilities.filter((capability) => PROVIDER_CAPABILITIES.includes(capability))
    : [...PROVIDER_CAPABILITIES];
  const rejectedCapabilities = requestedCapabilities.filter((capability) => (
    !PROVIDER_CAPABILITIES.includes(capability)
  ));
  const dispatchableDecisions = decisions.filter((decision) => decision.dispatchable);
  const blockedDecisions = decisions.filter((decision) => !decision.dispatchable);
  const watermarkMs = toEpochMs(syncInput.watermark || syncInput.lastAppliedAt, null);
  const nowMs = toEpochMs(now, Date.now());
  const syncLagMs = watermarkMs === null ? null : Math.max(0, nowMs - watermarkMs);
  const targetService = typeof serviceInput.name === 'string' && serviceInput.name.trim()
    ? serviceInput.name.trim()
    : typeof providerInput.name === 'string' && providerInput.name.trim()
      ? providerInput.name.trim()
      : 'hosted-kernel-scheduler';
  const serviceContract = normalizeProviderServiceContract(
    providerInput,
    serviceInput,
    syncInput,
    targetService,
    requestedCapabilities,
    acceptedCapabilities,
    rejectedCapabilities,
    dispatchableDecisions,
    controls,
    nowMs,
    now
  );
  const operationalGate = operationalHealth ? operationalHealth.dispatchGate : 'open';
  const handoffState = !controls.enabled
    ? 'disabled'
    : serviceContract.validation.state !== 'valid'
      ? 'blocked_by_provider_contract'
      : operationalGate === 'blocked'
      ? 'blocked_by_operational_health'
      : operationalGate === 'cooldown'
        ? 'waiting_for_health_recovery'
        : controls.dispatchMode === 'manual' && !controls.dispatchApproved
          ? 'awaiting_manual_approval'
          : health.state === 'unhealthy'
            ? 'blocked_by_scheduler_health'
            : dispatchableDecisions.length > 0
              ? 'ready_for_handoff'
              : blockedDecisions.length > 0
                ? 'blocked_by_task_contract'
                : 'idle';
  const firstDispatchable = dispatchableDecisions[0] || null;
  const idempotencySource = [
    surfaceId,
    targetService,
    boundaryContract ? boundaryContract.scope.tenantId || 'no-tenant' : 'no-boundary',
    boundaryContract ? boundaryContract.scope.workspaceId || 'no-workspace' : 'no-workspace',
    syncInput.cursor || 'no-cursor',
    firstDispatchable ? firstDispatchable.taskId : 'no-task',
    decisions.length
  ].join(':');

  const providerContract = {
    schemaVersion: 1,
    provider: {
      targetService,
      protocol: serviceContract.service.protocol,
      protocolSupported: serviceContract.service.protocolSupported,
      contractVersion: serviceContract.service.contractVersion,
      supportedCapabilities: [...PROVIDER_CAPABILITIES],
      acceptedCapabilities,
      rejectedCapabilities,
      requiredCapabilities: serviceContract.capabilities.required,
      missingRequiredCapabilities: serviceContract.capabilities.missingRequired,
      negotiated: rejectedCapabilities.length === 0 && serviceContract.validation.state === 'valid'
    },
    serviceContract,
    sync: {
      cursor: serviceContract.sync.cursor,
      sourceEpoch: serviceContract.sync.sourceEpoch,
      minimumSourceEpoch: serviceContract.sync.minimumSourceEpoch,
      lastAppliedAt: typeof syncInput.lastAppliedAt === 'string' ? syncInput.lastAppliedAt : null,
      watermark: typeof syncInput.watermark === 'string' ? syncInput.watermark : null,
      lagMs: syncLagMs,
      state: serviceContract.sync.state,
      requiresAck: dispatchableDecisions.length > 0,
      ackToken: dispatchableDecisions.length > 0 ? idempotencySource : null
    },
    handoff: {
      state: handoffState,
      payloadKind: 'priority-decision-batch',
      idempotencyKey: idempotencySource,
      dispatchableTaskIds: dispatchableDecisions.map((decision) => decision.taskId).filter(Boolean),
      blockedTaskIds: blockedDecisions.map((decision) => decision.taskId).filter(Boolean),
      maxDispatchBatch: controls.maxDispatchBatch,
      concurrencyRemaining: controls.concurrencyRemaining,
      laneWeights: policy.laneWeights,
      operationalHealth: operationalHealth
        ? {
            state: operationalHealth.state,
            dispatchGate: operationalHealth.dispatchGate,
            nextHealthCheckAt: operationalHealth.retry.nextHealthCheckAt,
            providerHealthState: operationalHealth.providerHealth.state,
            providerIncidentState: operationalHealth.providerHealth.incidentState,
            allowedLanes: operationalHealth.degradedMode.allowedLanes,
            blockedLanes: operationalHealth.degradedMode.blockedLanes
          }
        : null,
      boundary: boundaryContract
        ? {
            tenantId: boundaryContract.scope.tenantId,
            workspaceId: boundaryContract.scope.workspaceId,
            allowedWorkspaceIds: boundaryContract.scope.allowedWorkspaceIds,
            auditRequired: boundaryContract.audit.required,
            auditSink: boundaryContract.audit.sink,
            auditCorrelationId: boundaryContract.audit.correlationId,
            validationState: boundaryContract.validation.state
          }
        : null
    },
    validation: {
      state: serviceContract.validation.state,
      issueCount: serviceContract.validation.issueCount,
      issues: serviceContract.validation.issues
    }
  };
  providerContract.handoffEnvelope = buildProviderHandoffEnvelope(providerContract, decisions, now);
  return providerContract;
}

function normalizeAcceptanceInput(input = {}) {
  const acceptanceInput = input.acceptance && typeof input.acceptance === 'object' ? input.acceptance : {};
  const previewInput = input.preview && typeof input.preview === 'object' ? input.preview : {};
  const acceptedTaskIds = Array.isArray(acceptanceInput.acceptedTaskIds)
    ? acceptanceInput.acceptedTaskIds
    : Array.isArray(input.acceptedTaskIds)
      ? input.acceptedTaskIds
      : [];
  const rejectedTaskIds = Array.isArray(acceptanceInput.rejectedTaskIds)
    ? acceptanceInput.rejectedTaskIds
    : Array.isArray(input.rejectedTaskIds)
      ? input.rejectedTaskIds
      : [];

  return {
    requested: input.preview === true || previewInput.enabled === true || acceptanceInput.requested === true,
    acceptedTaskIds: [...new Set(acceptedTaskIds.filter((taskId) => typeof taskId === 'string' && taskId.trim()).map((taskId) => taskId.trim()))],
    rejectedTaskIds: [...new Set(rejectedTaskIds.filter((taskId) => typeof taskId === 'string' && taskId.trim()).map((taskId) => taskId.trim()))],
    acceptedBy: typeof acceptanceInput.acceptedBy === 'string' && acceptanceInput.acceptedBy.trim()
      ? acceptanceInput.acceptedBy.trim()
      : null,
    acceptedAt: typeof acceptanceInput.acceptedAt === 'string' ? acceptanceInput.acceptedAt : null,
    requireExplicitAcceptance: acceptanceInput.requireExplicitAcceptance === true,
    maxPreviewItems: Math.trunc(clampNumber(previewInput.maxItems ?? acceptanceInput.maxPreviewItems, 5, 1, 25))
  };
}

function summarizeValidationIssues(issues) {
  const scopes = {};
  const blockingCodes = new Set([
    'CLIENT_REQUEST_BINDING_REQUIRED',
    'CLIENT_SESSION_BINDING_REQUIRED',
    'TENANT_BINDING_REQUIRED',
    'WORKSPACE_SCOPE_REQUIRED',
    'TENANT_SCOPE_VIOLATION',
    'WORKSPACE_SCOPE_VIOLATION',
    'ROLE_DISPATCH_FORBIDDEN',
    'AUDIT_HANDOFF_REQUIRED',
    'HEALTH_INCIDENT_OPEN',
    'HEALTH_RECOVERY_COOLDOWN',
    'PERSISTED_STATE_INVALID',
    'PERSISTED_STATE_STALE',
    'PERSISTED_DISPATCH_ACK_PENDING',
    'CLIENT_RESUME_TOKEN_MISMATCH',
    'CLIENT_HANDOFF_TARGET_REQUIRED',
    'HANDOFF_ACK_REQUIRED',
    'PROVIDER_INCIDENT_OPEN',
    'PROVIDER_FAILURE_BUDGET_EXHAUSTED',
    'PROVIDER_RETRY_BACKOFF_ACTIVE',
    'PROVIDER_PROTOCOL_UNSUPPORTED',
    'PROVIDER_REQUIRED_CAPABILITY_MISSING',
    'PROVIDER_SYNC_CURSOR_REQUIRED',
    'PROVIDER_SYNC_EPOCH_REGRESSION',
    'PROVIDER_EXTERNAL_LEASE_REQUIRED',
    'PROVIDER_EXTERNAL_LEASE_EXPIRED',
    'ACCEPTANCE_ACTOR_REQUIRED',
    'ACCEPTANCE_TIMESTAMP_INVALID',
    'UNKNOWN_OR_BLOCKED_ACCEPTED_TASK',
    'READY_TASK_REJECTED'
  ]);

  for (const issue of issues) {
    const scope = issue.scope || 'unknown';
    const current = scopes[scope] || {
      scope,
      issueCount: 0,
      blockingCount: 0,
      codes: {},
      sampleTaskIds: []
    };
    current.issueCount += 1;
    if (blockingCodes.has(issue.code)) current.blockingCount += 1;
    current.codes[issue.code] = (current.codes[issue.code] || 0) + 1;
    if (issue.taskId && current.sampleTaskIds.length < 5 && !current.sampleTaskIds.includes(issue.taskId)) {
      current.sampleTaskIds.push(issue.taskId);
    }
    scopes[scope] = current;
  }

  return {
    blockingIssueCount: Object.values(scopes).reduce((count, scope) => count + scope.blockingCount, 0),
    scopes: Object.values(scopes).sort((a, b) => b.issueCount - a.issueCount || a.scope.localeCompare(b.scope))
  };
}

function acceptedDispatchManifest(acceptance, dispatchableDecisions, acceptanceRequired) {
  const acceptedIdSet = new Set(acceptance.acceptedTaskIds);
  const rejectedIdSet = new Set(acceptance.rejectedTaskIds);
  const selected = dispatchableDecisions.filter((decision) => {
    if (!decision.taskId || rejectedIdSet.has(decision.taskId)) return false;
    return acceptanceRequired ? acceptedIdSet.has(decision.taskId) : true;
  });

  return selected.map((decision, index) => ({
    ordinal: index + 1,
    taskId: decision.taskId,
    lane: decision.lane,
    tenantId: decision.boundary ? decision.boundary.tenantId : null,
    workspaceId: decision.boundary ? decision.boundary.workspaceId : null,
    priorityScore: decision.priorityScore,
    providerAckRequired: true,
    auditScope: decision.boundary?.isolated ? 'tenant_workspace' : 'unscoped'
  }));
}

function buildNextStepContract(nextSteps, readinessState) {
  return {
    schemaVersion: 1,
    contractKind: 'scheduler.priority-policy.next-step-actions.v1',
    activeStep: nextSteps[0]
      ? {
          ...nextSteps[0],
          routeAction: `scheduler.priority-policy.${nextSteps[0].command}`,
          userVisible: true
        }
      : {
          code: 'NO_ACTION_REQUIRED',
          label: readinessState.readyForDispatch ? 'Ready for dispatch' : 'No scheduler action available',
          command: readinessState.readyForDispatch ? 'dispatch' : 'noop',
          routeAction: readinessState.readyForDispatch ? 'scheduler.priority-policy.dispatch' : 'scheduler.priority-policy.noop',
          userVisible: readinessState.readyForDispatch
        },
    actions: nextSteps.map((step, index) => ({
      ...step,
      ordinal: index + 1,
      routeAction: `scheduler.priority-policy.${step.command}`,
      userVisible: true
    }))
  };
}

function buildPreviewReviewContract(
  acceptance,
  previewItems,
  dispatchableDecisions,
  blockedDecisions,
  validationSummary,
  nextStepContract,
  readyForDispatch,
  acceptanceRequired,
  clientRuntimeContract,
  providerContract,
  boundaryContract,
  operationalHealth,
  auditHandoffContract
) {
  const selectableItems = previewItems.filter((item) => item.dispatchable);
  const blockedItems = previewItems.filter((item) => !item.dispatchable);
  const alreadyAccepted = new Set(acceptance.acceptedTaskIds);
  const rejected = new Set(acceptance.rejectedTaskIds);
  const defaultAcceptTaskIds = acceptanceRequired
    ? selectableItems
        .filter((item) => item.taskId && !rejected.has(item.taskId))
        .map((item) => item.taskId)
    : dispatchableDecisions.map((decision) => decision.taskId).filter(Boolean);
  const primaryAction = readyForDispatch
    ? {
        state: 'enabled',
        command: 'dispatch',
        label: 'Dispatch accepted tasks',
        routeAction: 'scheduler.priority-policy.dispatch'
      }
    : nextStepContract.activeStep.command === 'noop'
      ? {
          state: 'hidden',
          command: 'noop',
          label: 'No scheduler action available',
          routeAction: 'scheduler.priority-policy.noop'
        }
      : {
          state: validationSummary.blockingIssueCount > 0 ? 'blocked' : 'enabled',
          command: nextStepContract.activeStep.command,
          label: nextStepContract.activeStep.label,
          routeAction: nextStepContract.activeStep.routeAction
        };
  const bannerState = validationSummary.blockingIssueCount > 0
    ? 'blocking'
    : operationalHealth.dispatchGate === 'priority_only'
      ? 'degraded'
      : readyForDispatch
        ? 'ready'
        : selectableItems.length > 0
          ? 'review_required'
          : 'empty';
  const bannerMessage = bannerState === 'ready'
    ? `${defaultAcceptTaskIds.length} accepted scheduler task(s) are ready for hosted-kernel dispatch.`
    : bannerState === 'blocking'
      ? `${validationSummary.blockingIssueCount} blocking scheduler issue(s) must be resolved before dispatch.`
      : bannerState === 'degraded'
        ? 'Scheduler is in degraded mode; only priority lanes can be dispatched.'
        : bannerState === 'review_required'
          ? 'Review and accept ready preview tasks before dispatch.'
          : 'No dispatchable scheduler tasks are available in this preview.';

  return {
    schemaVersion: 1,
    contractKind: 'scheduler.priority-policy.preview-review.v1',
    banner: {
      state: bannerState,
      message: bannerMessage,
      blockingIssueCount: validationSummary.blockingIssueCount,
      operationalGate: operationalHealth.dispatchGate
    },
    controls: {
      acceptanceRequired,
      canAcceptSelection: selectableItems.length > 0 && validationSummary.blockingIssueCount === 0,
      canDispatch: readyForDispatch,
      primaryAction,
      secondaryActions: nextStepContract.actions
        .filter((step) => step.command !== primaryAction.command)
        .slice(0, 4)
    },
    acceptancePayload: {
      routeAction: 'scheduler.priority-policy.accept-ready-tasks',
      acceptedBy: acceptance.acceptedBy,
      acceptedAt: acceptance.acceptedAt,
      defaultAcceptedTaskIds: defaultAcceptTaskIds,
      currentAcceptedTaskIds: acceptance.acceptedTaskIds,
      rejectedTaskIds: acceptance.rejectedTaskIds,
      proofRequired: acceptanceRequired,
      proofFields: ['acceptedBy', 'acceptedTaskIds', 'proofToken']
    },
    previewList: {
      selectableCount: selectableItems.length,
      blockedCount: blockedItems.length,
      hiddenReadyCount: Math.max(0, dispatchableDecisions.length - selectableItems.length),
      hiddenBlockedCount: Math.max(0, blockedDecisions.length - blockedItems.length),
      items: previewItems.map((item) => ({
        ...item,
        selectable: item.dispatchable && !rejected.has(item.taskId),
        selected: item.taskId ? alreadyAccepted.has(item.taskId) : false,
        userVisibleState: item.dispatchable ? 'ready_to_accept' : 'blocked',
        routeAction: item.dispatchable
          ? 'scheduler.priority-policy.accept-task'
          : 'scheduler.priority-policy.review-task-blocker'
      }))
    },
    routeContext: {
      clientRoute: clientRuntimeContract.binding.route,
      clientWorkflowAction: clientRuntimeContract.workflow.action,
      providerHandoffState: providerContract.handoff.state,
      providerAckToken: providerContract.sync.ackToken,
      tenantId: boundaryContract.scope.tenantId,
      workspaceId: boundaryContract.scope.workspaceId,
      auditCorrelationId: boundaryContract.audit.correlationId,
      auditRouteAction: auditHandoffContract.sink.routeAction,
      auditCommitReady: auditHandoffContract.commit.ready
    }
  };
}

function buildReadinessContract(
  input,
  controls,
  health,
  decisions,
  providerContract,
  clientRuntimeContract,
  boundaryContract,
  operationalHealth,
  persistedState,
  auditHandoffContract,
  now
) {
  const acceptance = normalizeAcceptanceInput(input);
  const dispatchableDecisions = decisions.filter((decision) => decision.dispatchable);
  const blockedDecisions = decisions.filter((decision) => !decision.dispatchable);
  const dispatchableIds = dispatchableDecisions.map((decision) => decision.taskId).filter(Boolean);
  const unknownAcceptedIds = acceptance.acceptedTaskIds.filter((taskId) => !dispatchableIds.includes(taskId));
  const explicitlyRejectedReadyIds = acceptance.rejectedTaskIds.filter((taskId) => dispatchableIds.includes(taskId));
  const acceptedReadyCount = acceptance.acceptedTaskIds.filter((taskId) => dispatchableIds.includes(taskId)).length;
  const acceptanceRequired = acceptance.requireExplicitAcceptance || controls.dispatchMode === 'manual';
  const hasAcceptance = acceptanceRequired ? acceptedReadyCount > 0 : dispatchableIds.length > 0;
  const acceptanceTimestampMs = acceptance.acceptedAt ? toEpochMs(acceptance.acceptedAt, null) : null;
  const acceptedReadyTaskIds = acceptance.acceptedTaskIds.filter((taskId) => dispatchableIds.includes(taskId));
  const validationIssues = [
    ...controls.settingErrors.map((error) => ({
      scope: 'controls',
      code: error.code,
      field: error.field,
      action: error.action
    })),
    ...health.errors.map((error) => ({
      scope: 'scheduler_health',
      code: error.code,
      action: error.action
    })),
    ...operationalHealth.validation.issues.map((issue) => issue),
    ...blockedDecisions.flatMap((decision) => decision.failures.map((failure) => ({
      scope: 'task',
      taskId: decision.taskId,
      code: failure.code,
      action: failure.action
    }))),
    ...unknownAcceptedIds.map((taskId) => ({
      scope: 'acceptance',
      taskId,
      code: 'UNKNOWN_OR_BLOCKED_ACCEPTED_TASK',
      action: 'Accept only task ids that are present and dispatchable in the current preview.'
    })),
    ...explicitlyRejectedReadyIds.map((taskId) => ({
      scope: 'acceptance',
      taskId,
      code: 'READY_TASK_REJECTED',
      action: 'Remove the task from rejectedTaskIds or leave it blocked for operator review.'
    })),
    ...(acceptanceRequired && acceptedReadyTaskIds.length > 0 && !acceptance.acceptedBy
      ? [{
          scope: 'acceptance',
          code: 'ACCEPTANCE_ACTOR_REQUIRED',
          action: ACTIONABLE_ERROR.ACCEPTANCE_ACTOR_REQUIRED
        }]
      : []),
    ...(acceptance.acceptedAt && acceptanceTimestampMs === null
      ? [{
          scope: 'acceptance',
          code: 'ACCEPTANCE_TIMESTAMP_INVALID',
          action: ACTIONABLE_ERROR.ACCEPTANCE_TIMESTAMP_INVALID
        }]
      : []),
    ...clientRuntimeContract.validation.issues
      .map((issue) => issue),
    ...providerContract.validation.issues
      .map((issue) => issue),
    ...boundaryContract.validation.issues,
    ...auditHandoffContract.validation.issues,
    ...persistedState.validation.issues
      .filter((issue) => issue.code !== 'IDEMPOTENT_COMMAND_REPLAY')
  ];
  const readyForDispatch = controls.enabled
    && health.state !== 'unhealthy'
    && dispatchableIds.length > 0
    && hasAcceptance
    && clientRuntimeContract.validation.state === 'valid'
    && providerContract.validation.state === 'valid'
    && boundaryContract.validation.state === 'valid'
    && auditHandoffContract.validation.state === 'valid'
    && auditHandoffContract.commit.ready
    && persistedState.validation.state === 'valid'
    && !['blocked', 'cooldown', 'closed'].includes(operationalHealth.dispatchGate)
    && unknownAcceptedIds.length === 0
    && explicitlyRejectedReadyIds.length === 0
    && (!acceptanceRequired || acceptedReadyTaskIds.length === 0 || Boolean(acceptance.acceptedBy))
    && (!acceptance.acceptedAt || acceptanceTimestampMs !== null);
  const previewItems = decisions.slice(0, acceptance.maxPreviewItems).map((decision, index) => ({
    ordinal: index + 1,
    taskId: decision.taskId,
    lane: decision.lane,
    tenantId: decision.boundary ? decision.boundary.tenantId : null,
    workspaceId: decision.boundary ? decision.boundary.workspaceId : null,
    priorityScore: decision.priorityScore,
    state: decision.state,
    dispatchable: decision.dispatchable,
    boundaryIsolated: decision.boundary ? decision.boundary.isolated : null,
    failureCodes: decision.failures.map((failure) => failure.code),
    nextRetryAt: decision.retry.nextRetryAt
  }));
  const nextSteps = [];

  if (!controls.enabled) {
    nextSteps.push({ code: 'ENABLE_POLICY', label: 'Enable scheduler policy', command: 'enable' });
  } else if (operationalHealth.dispatchGate === 'blocked') {
    nextSteps.push({ code: 'RESTORE_OPERATIONAL_HEALTH', label: 'Restore scheduler operational health', command: 'inspect-health-incident' });
  } else if (operationalHealth.dispatchGate === 'cooldown') {
    nextSteps.push({ code: 'WAIT_FOR_HEALTH_COOLDOWN', label: 'Wait for scheduler recovery cooldown', command: 'wait-health-cooldown' });
  } else if (health.state === 'unhealthy') {
    nextSteps.push({ code: 'RESTORE_HEALTH', label: 'Restore scheduler health', command: 'inspect-workers' });
  }
  if (operationalHealth.dispatchGate === 'priority_only') {
    nextSteps.push({ code: 'KEEP_DEGRADED_MODE', label: 'Dispatch priority lanes only', command: 'hold-background' });
  }
  if (dispatchableIds.length === 0 && blockedDecisions.length > 0) {
    nextSteps.push({ code: 'REPAIR_TASKS', label: 'Repair blocked task contracts', command: 'review-failures' });
  }
  if (acceptanceRequired && acceptedReadyCount === 0 && dispatchableIds.length > 0) {
    nextSteps.push({ code: 'ACCEPT_PREVIEW', label: 'Accept one or more ready preview tasks', command: 'accept-ready-tasks' });
  }
  if (acceptanceRequired && acceptedReadyTaskIds.length > 0 && !acceptance.acceptedBy) {
    nextSteps.push({ code: 'ATTACH_ACCEPTANCE_ACTOR', label: 'Attach preview acceptance actor', command: 'attach-acceptance-actor' });
  }
  if (acceptance.acceptedAt && acceptanceTimestampMs === null) {
    nextSteps.push({ code: 'REPAIR_ACCEPTANCE_TIMESTAMP', label: 'Repair preview acceptance timestamp', command: 'repair-acceptance-timestamp' });
  }
  if (clientRuntimeContract.validation.state !== 'valid') {
    nextSteps.push({ code: 'REPAIR_CLIENT_BINDING', label: 'Repair client request binding', command: 'bind-client-runtime' });
  }
  if (providerContract.validation.state !== 'valid') {
    nextSteps.push({ code: 'REPAIR_PROVIDER_CONTRACT', label: 'Repair provider service contract', command: 'repair-provider-contract' });
  }
  if (boundaryContract.validation.state !== 'valid') {
    nextSteps.push({ code: 'REPAIR_BOUNDARY', label: 'Repair tenant workspace boundary', command: 'bind-scheduler-boundary' });
  }
  if (auditHandoffContract.validation.state !== 'valid' || !auditHandoffContract.commit.ready) {
    nextSteps.push({ code: 'REPAIR_AUDIT_HANDOFF', label: 'Bind scheduler audit handoff', command: 'bind-audit-handoff' });
  }
  if (persistedState.validation.state !== 'valid') {
    nextSteps.push({ code: 'REPAIR_PERSISTED_STATE', label: 'Repair scheduler checkpoint', command: 'reload-scheduler-checkpoint' });
  }
  if (readyForDispatch) {
    nextSteps.push({ code: 'DISPATCH_READY_BATCH', label: 'Dispatch accepted ready tasks', command: 'dispatch' });
  }
  const acceptedDispatch = acceptedDispatchManifest(acceptance, dispatchableDecisions, acceptanceRequired);
  const acceptedDispatchIds = acceptedDispatch.map((item) => item.taskId);
  const validationSummary = summarizeValidationIssues(validationIssues);
  const readinessState = {
    readyForDispatch,
    acceptedDispatchCount: acceptedDispatch.length,
    validationBlockingIssueCount: validationSummary.blockingIssueCount
  };
  const acceptanceProofToken = [
    surfaceId,
    boundaryContract.scope.tenantId || 'no-tenant',
    boundaryContract.scope.workspaceId || 'no-workspace',
    clientRuntimeContract.binding.requestId || 'no-request',
    providerContract.sync.ackToken || 'no-ack',
    acceptedDispatchIds.join(',') || 'no-accepted-tasks'
  ].join(':');
  const nextStepContract = buildNextStepContract(nextSteps, readinessState);
  const reviewContract = buildPreviewReviewContract(
    acceptance,
    previewItems,
    dispatchableDecisions,
    blockedDecisions,
    validationSummary,
    nextStepContract,
    readyForDispatch,
    acceptanceRequired,
    clientRuntimeContract,
    providerContract,
    boundaryContract,
    operationalHealth,
    auditHandoffContract
  );

  return {
    schemaVersion: 1,
    contractKind: 'scheduler.priority-policy.preview-acceptance.v1',
    generatedAt: now,
    preview: {
      requested: acceptance.requested,
      state: dispatchableIds.length > 0 ? 'ready_items_available' : blockedDecisions.length > 0 ? 'blocked_items_only' : 'empty',
      maxItems: acceptance.maxPreviewItems,
      summary: {
        dispatchableCount: dispatchableIds.length,
        blockedCount: blockedDecisions.length,
        topReadyTaskId: dispatchableIds[0] || null,
        topBlockedTaskId: blockedDecisions[0] ? blockedDecisions[0].taskId : null,
        lanesWithReadyWork: [...new Set(dispatchableDecisions.map((decision) => decision.lane))],
        lanesWithBlockedWork: [...new Set(blockedDecisions.map((decision) => decision.lane))]
      },
      items: previewItems
    },
    acceptance: {
      state: !acceptanceRequired
        ? 'not_required'
        : acceptedReadyCount > 0 && unknownAcceptedIds.length === 0 && explicitlyRejectedReadyIds.length === 0
          ? 'accepted'
          : 'awaiting_acceptance',
      required: acceptanceRequired,
      acceptedBy: acceptance.acceptedBy,
      acceptedAt: acceptance.acceptedAt,
      acceptedTaskIds: acceptance.acceptedTaskIds,
      rejectedTaskIds: acceptance.rejectedTaskIds,
      acceptedReadyCount,
      acceptedDispatchCount: acceptedDispatch.length,
      acceptedDispatchTaskIds: acceptedDispatchIds,
      acceptedDispatch,
      proofToken: acceptanceProofToken,
      commitMode: readyForDispatch ? 'commit_ready' : acceptanceRequired ? 'operator_acceptance_required' : 'preview_only',
      unknownAcceptedIds,
      rejectedReadyTaskIds: explicitlyRejectedReadyIds,
      acceptedByRequired: acceptanceRequired && acceptedReadyTaskIds.length > 0,
      acceptedAtValid: acceptance.acceptedAt ? acceptanceTimestampMs !== null : null
    },
    readiness: {
      readyForDispatch,
      dispatchableTaskIds: dispatchableIds,
      blockedTaskIds: blockedDecisions.map((decision) => decision.taskId).filter(Boolean),
      providerHandoffState: providerContract.handoff.state,
      providerValidationState: providerContract.validation.state,
      providerSyncState: providerContract.sync.state,
      providerExternalHandoffState: providerContract.serviceContract.externalHandoff.state,
      requiresProviderAck: providerContract.sync.requiresAck,
      clientHandoffState: clientRuntimeContract.handoff.state,
      clientDirective: clientRuntimeContract.handoff.userVisibleDirective,
      clientResumeToken: clientRuntimeContract.handoff.resumeToken,
      clientWorkflowState: clientRuntimeContract.workflow.state,
      clientWorkflowAction: clientRuntimeContract.workflow.action,
      clientHandoffAckRequired: clientRuntimeContract.workflow.requiresClientAck,
      clientHandoffAckMissing: clientRuntimeContract.workflow.ack.missingAck,
      clientDispatchManifestCount: clientRuntimeContract.workflow.dispatchManifest.length,
      boundaryValidationState: boundaryContract.validation.state,
      tenantId: boundaryContract.scope.tenantId,
      workspaceId: boundaryContract.scope.workspaceId,
      auditHandoffReady: boundaryContract.audit.handoffReady,
      auditCommitReady: auditHandoffContract.commit.ready,
      auditRouteAction: auditHandoffContract.sink.routeAction,
      auditManifestRows: auditHandoffContract.manifest.totalRows,
      operationalHealthState: operationalHealth.state,
      dispatchGate: operationalHealth.dispatchGate,
      nextHealthCheckAt: operationalHealth.retry.nextHealthCheckAt,
      restartStatus: persistedState.restartStatus,
      commandStatus: controls.commandStatus,
      lifecycleValidationState: controls.lifecycleContract.validation.state,
      lifecycleNextAction: controls.lifecycleContract.nextAction,
      commandWarningCount: controls.commandWarnings.length
    },
    lifecycleControls: controls.lifecycleContract,
    validation: {
      state: validationIssues.length === 0 ? 'valid' : 'action_required',
      issueCount: validationIssues.length,
      blockingIssueCount: validationSummary.blockingIssueCount,
      summaryByScope: validationSummary.scopes,
      issues: validationIssues.slice(0, 50)
    },
    nextSteps,
    nextStepContract,
    reviewContract
  };
}

function buildCurrentDispatchWatermark(providerContract, clientRuntimeContract, readinessContract, now) {
  if (!readinessContract.readiness.readyForDispatch || !providerContract.sync.ackToken) return null;

  const taskIds = readinessContract.acceptance.acceptedDispatchTaskIds.length > 0
    ? readinessContract.acceptance.acceptedDispatchTaskIds
    : providerContract.handoff.dispatchableTaskIds;
  const providerAckMatched = clientRuntimeContract.workflow.ack.providerAckMatched === true;

  return {
    dispatchId: providerContract.sync.ackToken,
    ackToken: providerContract.sync.ackToken,
    clientResumeToken: clientRuntimeContract.handoff.resumeToken,
    taskIds,
    issuedAt: now,
    ageMs: 0,
    acknowledged: providerAckMatched || providerContract.sync.requiresAck === false,
    acknowledgedAt: providerAckMatched ? clientRuntimeContract.workflow.ack.acknowledgedAt || now : null,
    recoveryState: providerAckMatched || providerContract.sync.requiresAck === false ? 'acknowledged' : 'awaiting_ack'
  };
}

function mergePendingDispatchWatermarks(persistedDispatches, currentDispatch) {
  const byAckToken = new Map();

  for (const dispatch of persistedDispatches) {
    if (!dispatch.ackToken || dispatch.acknowledged) continue;
    byAckToken.set(dispatch.ackToken, dispatch);
  }
  if (currentDispatch && currentDispatch.ackToken && !currentDispatch.acknowledged) {
    byAckToken.set(currentDispatch.ackToken, currentDispatch);
  }

  return [...byAckToken.values()]
    .slice(-10)
    .map((dispatch, index) => ({
      ordinal: index + 1,
      dispatchId: dispatch.dispatchId,
      ackToken: dispatch.ackToken,
      clientResumeToken: dispatch.clientResumeToken,
      taskIds: dispatch.taskIds,
      issuedAt: dispatch.issuedAt,
      ageMs: dispatch.ageMs,
      acknowledged: dispatch.acknowledged,
      acknowledgedAt: dispatch.acknowledgedAt,
      recoveryState: dispatch.recoveryState
    }));
}

function buildRestartStatusSnapshot({
  restartSafeStatus,
  persistedState,
  controls,
  providerContract,
  clientRuntimeContract,
  readinessContract,
  operationalHealth,
  analytics,
  pendingDispatches,
  now
}) {
  const blockingReasons = [
    ...persistedState.validation.issues.map((issue) => issue.code),
    ...readinessContract.validation.issues
      .filter((issue) => issue.scope !== 'task')
      .map((issue) => issue.code),
    ...operationalHealth.validation.issues.map((issue) => issue.code)
  ];
  const uniqueBlockingReasons = [...new Set(blockingReasons)];
  const dispatchableTaskIds = readinessContract.readiness.readyForDispatch
    ? readinessContract.acceptance.acceptedDispatchTaskIds
    : [];

  return {
    schemaVersion: 1,
    contractKind: 'scheduler.priority-policy.restart-status.v1',
    generatedAt: now,
    status: restartSafeStatus,
    lifecycle: {
      state: controls.lifecycleState,
      dispatchMode: controls.dispatchMode,
      disabledLanes: controls.disabledLanes,
      commandStatus: controls.commandStatus,
      commandId: controls.commandId
    },
    dispatch: {
      readyForDispatch: readinessContract.readiness.readyForDispatch,
      dispatchableTaskIds,
      providerHandoffState: providerContract.handoff.state,
      providerAckToken: providerContract.sync.ackToken,
      clientResumeToken: clientRuntimeContract.handoff.resumeToken,
      pendingAckTokens: pendingDispatches
        .filter((dispatch) => !dispatch.acknowledged)
        .map((dispatch) => dispatch.ackToken)
        .filter(Boolean)
    },
    health: {
      operationalState: operationalHealth.state,
      dispatchGate: operationalHealth.dispatchGate,
      queueDepth: analytics.queue.queueDepth,
      providerHealthState: operationalHealth.providerHealth.state,
      nextHealthCheckAt: operationalHealth.retry.nextHealthCheckAt
    },
    recovery: {
      recovered: persistedState.recovered,
      restartStatus: persistedState.restartStatus,
      restoredAt: persistedState.checkpoint.restoredAt,
      staleMs: persistedState.checkpoint.staleMs,
      blockingReasons: uniqueBlockingReasons.slice(0, 25)
    }
  };
}

function buildCheckpointCommitContract({
  restartSafeStatus,
  persistedState,
  controls,
  nextCheckpoint,
  writeIntent,
  currentDispatchWatermark,
  pendingDispatches,
  now
}) {
  const acknowledgedDispatchIds = pendingDispatches
    .filter((dispatch) => dispatch.acknowledged)
    .map((dispatch) => dispatch.dispatchId || dispatch.ackToken)
    .filter(Boolean);
  const awaitingAckTokens = pendingDispatches
    .filter((dispatch) => !dispatch.acknowledged)
    .map((dispatch) => dispatch.ackToken)
    .filter(Boolean);
  const mutation = controls.commandStatus === 'replay_ignored'
    ? 'return_existing_checkpoint'
    : restartSafeStatus === 'dispatch_ack_reconciliation_required'
      ? 'reconcile_pending_dispatch_ack'
      : writeIntent.required
        ? 'upsert_restart_checkpoint'
        : 'observe_without_write';
  const routeAction = mutation === 'return_existing_checkpoint'
    ? 'scheduler.priority-policy.persisted-status'
    : mutation === 'reconcile_pending_dispatch_ack'
      ? 'scheduler.priority-policy.reconcile-dispatch-ack'
      : mutation === 'upsert_restart_checkpoint'
        ? 'scheduler.priority-policy.commit-checkpoint'
        : 'scheduler.priority-policy.observe-status';

  return {
    schemaVersion: 1,
    contractKind: 'scheduler.priority-policy.checkpoint-commit.v1',
    generatedAt: now,
    mutation,
    routeAction,
    idempotencyKey: [
      surfaceId,
      'checkpoint',
      nextCheckpoint.stateEpoch,
      controls.commandId || 'no-command',
      currentDispatchWatermark ? currentDispatchWatermark.ackToken : nextCheckpoint.lastDispatchWatermark || 'no-dispatch'
    ].join(':'),
    expectedPreviousEpoch: persistedState.checkpoint.stateEpoch,
    nextEpoch: nextCheckpoint.stateEpoch,
    preconditions: {
      requireCompareAndSwap: persistedState.recovered || controls.commandStatus === 'applied',
      expectedLastAckToken: persistedState.checkpoint.lastAckToken,
      expectedLastResumeToken: persistedState.checkpoint.lastResumeToken,
      rejectIfAckOverdue: restartSafeStatus === 'dispatch_ack_reconciliation_required',
      rejectIfCommandReplayed: controls.commandStatus === 'replay_ignored'
    },
    statusResult: {
      restartSafeStatus,
      writeRequired: writeIntent.required,
      writeReason: writeIntent.reason,
      commandStatus: controls.commandStatus,
      acknowledgedDispatchIds,
      awaitingAckTokens
    },
    persistedShape: {
      requiredFields: [
        'stateEpoch',
        'persistedAt',
        'lifecycleState',
        'dispatchMode',
        'pendingDispatches',
        'appliedCommandIds',
        'commandLedger'
      ],
      optionalFields: [
        'lastAckToken',
        'lastResumeToken',
        'lastDispatchWatermark',
        'restartStatusSnapshot'
      ],
      checkpoint: nextCheckpoint
    }
  };
}

function buildPersistenceContract(
  persistedState,
  controls,
  providerContract,
  clientRuntimeContract,
  readinessContract,
  operationalHealth,
  analytics,
  now
) {
  const commandApplied = controls.commandStatus === 'applied' && Boolean(controls.commandId);
  const currentDispatchWatermark = buildCurrentDispatchWatermark(
    providerContract,
    clientRuntimeContract,
    readinessContract,
    now
  );
  const pendingDispatches = mergePendingDispatchWatermarks(
    persistedState.checkpoint.pendingDispatches,
    currentDispatchWatermark
  );
  const hasAckOverdueDispatch = persistedState.checkpoint.pendingDispatches.some((dispatch) => (
    dispatch.recoveryState === 'ack_overdue'
  ));
  const hasPendingDispatch = pendingDispatches.some((dispatch) => dispatch.recoveryState !== 'acknowledged');
  const appliedCommandIds = commandApplied
    ? [...new Set([...persistedState.command.appliedCommandIds, controls.commandId])]
    : persistedState.command.appliedCommandIds;
  const nextLedger = commandApplied
    ? [
        ...persistedState.command.ledger,
        {
          ordinal: persistedState.command.ledger.length + 1,
          commandId: controls.commandId,
          command: controls.command,
          appliedAt: now,
          lifecycleState: controls.lifecycleState
        }
      ].slice(-20)
    : persistedState.command.ledger;
  const restartSafeStatus = hasAckOverdueDispatch
    ? 'dispatch_ack_reconciliation_required'
    : persistedState.validation.state !== 'valid'
      ? 'checkpoint_repair_required'
    : controls.commandStatus === 'replay_ignored'
      ? 'idempotent_replay_returned'
      : readinessContract.readiness.readyForDispatch
        ? 'ready_checkpoint_written'
        : hasPendingDispatch
          ? 'awaiting_dispatch_ack'
      : operationalHealth.dispatchGate === 'blocked'
        ? 'blocked_checkpoint_written'
        : 'status_checkpoint_written';
  const nextCheckpoint = {
    stateEpoch: persistedState.checkpoint.stateEpoch + (commandApplied ? 1 : 0),
    persistedAt: now,
    lifecycleState: controls.lifecycleState,
    dispatchMode: controls.dispatchMode,
    disabledLanes: controls.disabledLanes,
    maxConcurrentTasks: controls.maxConcurrentTasks,
    maxDispatchBatch: controls.maxDispatchBatch,
    inFlightTasks: controls.inFlightTasks,
    concurrencyRemaining: controls.concurrencyRemaining,
    dispatchGate: operationalHealth.dispatchGate,
    operationalHealthState: operationalHealth.state,
    queueDepth: analytics.queue.queueDepth,
    dispatchable: analytics.counters.dispatchable,
    blocked: analytics.counters.blocked,
    needsAction: analytics.counters.needsAction,
    lastAckToken: providerContract.sync.ackToken,
    lastResumeToken: clientRuntimeContract.handoff.resumeToken,
    lastDispatchWatermark: currentDispatchWatermark
      ? currentDispatchWatermark.ackToken
      : persistedState.checkpoint.lastDispatchWatermark,
    pendingDispatches,
    appliedCommandIds,
    commandLedger: nextLedger
  };
  const restartStatusSnapshot = buildRestartStatusSnapshot({
    restartSafeStatus,
    persistedState,
    controls,
    providerContract,
    clientRuntimeContract,
    readinessContract,
    operationalHealth,
    analytics,
    pendingDispatches,
    now
  });
  nextCheckpoint.restartStatusSnapshot = restartStatusSnapshot;
  const writeIntent = {
    required: controls.commandStatus !== 'not_requested'
      || readinessContract.readiness.readyForDispatch
      || persistedState.recovered
      || hasPendingDispatch,
    reason: controls.commandStatus === 'replay_ignored'
      ? 'return_existing_status_without_mutating_command_state'
      : hasAckOverdueDispatch
        ? 'persist_dispatch_ack_reconciliation_required'
      : commandApplied
        ? 'persist_applied_lifecycle_command'
      : readinessContract.readiness.readyForDispatch
        ? 'persist_ready_dispatch_watermark'
      : hasPendingDispatch
        ? 'persist_pending_dispatch_watermark'
        : 'persist_restart_safe_scheduler_status'
  };
  const checkpointCommit = buildCheckpointCommitContract({
    restartSafeStatus,
    persistedState,
    controls,
    nextCheckpoint,
    writeIntent,
    currentDispatchWatermark,
    pendingDispatches,
    now
  });

  return {
    schemaVersion: 1,
    contractKind: 'scheduler.priority-policy.persistence-recovery.v1',
    generatedAt: now,
    restartSafeStatus,
    recovered: persistedState.recovered,
    recovery: {
      restartStatus: persistedState.restartStatus,
      restoredAt: persistedState.checkpoint.restoredAt,
      staleMs: persistedState.checkpoint.staleMs,
      validationState: persistedState.validation.state,
      pendingDispatchCount: persistedState.checkpoint.pendingDispatches.filter((dispatch) => !dispatch.acknowledged).length,
      ackOverdueDispatchCount: persistedState.checkpoint.pendingDispatches.filter((dispatch) => (
        dispatch.recoveryState === 'ack_overdue'
      )).length,
      issues: persistedState.validation.issues
    },
    idempotency: {
      commandStatus: controls.commandStatus,
      commandId: controls.commandId,
      replayed: persistedState.command.replayed,
      appliedCommandIds,
      providerAckToken: providerContract.sync.ackToken,
      clientResumeToken: clientRuntimeContract.handoff.resumeToken,
      dispatchWatermarkState: currentDispatchWatermark
        ? currentDispatchWatermark.recoveryState
          : hasPendingDispatch
            ? 'awaiting_prior_ack'
            : 'none'
    },
    restartStatusSnapshot,
    nextCheckpoint,
    writeIntent,
    checkpointCommit
  };
}

export function describePriorityPolicySurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const nowMs = toEpochMs(now, Date.now());
  const policy = normalizePolicy(input.policy);
  const persistedState = normalizePersistedSchedulerState(input, policy, nowMs, now);
  const controls = normalizeControls(input, policy, persistedState);
  const health = evaluateSchedulerHealth(input, policy, controls, nowMs, now);
  const boundaryContract = normalizeBoundaryContract(input, now);
  const rawTasks = Array.isArray(input.tasks)
    ? input.tasks
    : input.task && typeof input.task === 'object'
      ? [input.task]
      : [];
  const baseDecisions = rawTasks.map((task) => {
    const normalized = normalizeTask(task, nowMs, policy);
    const boundary = taskBoundaryFailures(task, boundaryContract);
    const score = rankTask(normalized, health);
    const retry = retryBackoffFor(normalized, policy, nowMs);
    const blockedByBackpressure = health.state !== 'healthy' && normalized.lane === 'background';
    const controlFailures = controlFailuresForTask(normalized, controls);
    const failureCodes = blockedByBackpressure
      ? [...normalized.errors, ...controlFailures, ...boundary.failureCodes, 'KERNEL_BACKPRESSURE']
      : [...normalized.errors, ...controlFailures, ...boundary.failureCodes];

    return {
      taskId: normalized.id,
      lane: normalized.lane,
      boundary: {
        tenantId: boundary.tenantId,
        workspaceId: boundary.workspaceId,
        isolated: boundary.isolated
      },
      priorityScore: score,
      attempts: normalized.attempts,
      taskAgeMs: normalized.ageMs,
      state: failureCodes.length > 0 ? 'needs_action' : 'ready',
      dispatchable: failureCodes.length === 0 && health.state !== 'unhealthy',
      retry,
      failures: decorateFailures(failureCodes)
    };
  });
  const preliminaryHistory = buildHistory(input.history || input.snapshots, {
    sequence: 1,
    generatedAt: now,
    healthState: health.state,
    queueDepth: health.queueDepth,
    dispatchable: baseDecisions.filter((decision) => decision.dispatchable).length,
    blocked: baseDecisions.filter((decision) => !decision.dispatchable).length,
    needsAction: baseDecisions.filter((decision) => decision.state === 'needs_action').length
  });
  const operationalHealth = buildOperationalHealthContract(health, preliminaryHistory, controls, policy, nowMs, now);
  const rankedDecisions = applySchedulingControls(
    baseDecisions.sort((a, b) => b.priorityScore - a.priorityScore),
    controls,
    health,
    operationalHealth
  );
  const providerContract = normalizeProviderContract(
    input,
    controls,
    health,
    policy,
    rankedDecisions,
    now,
    boundaryContract,
    operationalHealth
  );
  const providerGatedDecisions = applyProviderServiceGate(rankedDecisions, providerContract);
  providerContract.handoffEnvelope = buildProviderHandoffEnvelope(providerContract, providerGatedDecisions, now);
  const readyCount = providerGatedDecisions.filter((decision) => decision.dispatchable).length;
  const failedCount = providerGatedDecisions.filter((decision) => decision.state === 'needs_action').length;
  const clientRuntimeContract = normalizeClientRuntimeContract(input, controls, health, providerGatedDecisions, providerContract, now);
  const auditHandoffContract = buildAuditHandoffContract(
    providerGatedDecisions,
    boundaryContract,
    providerContract,
    clientRuntimeContract,
    now
  );
  const readinessContract = buildReadinessContract(
    input,
    controls,
    health,
    providerGatedDecisions,
    providerContract,
    clientRuntimeContract,
    boundaryContract,
    operationalHealth,
    persistedState,
    auditHandoffContract,
    now
  );
  const analytics = buildAnalytics(
    providerGatedDecisions,
    health,
    policy,
    boundaryContract,
    operationalHealth,
    auditHandoffContract
  );
  const history = buildHistory(input.history || input.snapshots, {
    sequence: 1,
    generatedAt: now,
    healthState: health.state,
    queueDepth: health.queueDepth,
    dispatchable: analytics.counters.dispatchable,
    blocked: analytics.counters.blocked,
    needsAction: analytics.counters.needsAction
  });
  const timeline = buildTimeline(providerGatedDecisions, health, now);
  const reportingState = buildReportingState(analytics, history, timeline, operationalHealth);
  const persistenceContract = buildPersistenceContract(
    persistedState,
    controls,
    providerContract,
    clientRuntimeContract,
    readinessContract,
    operationalHealth,
    analytics,
    now
  );
  const exportReady = buildExport(
    providerGatedDecisions,
    analytics,
    history,
    reportingState,
    now,
    readinessContract,
    clientRuntimeContract,
    boundaryContract,
    operationalHealth,
    persistenceContract,
    providerContract,
    auditHandoffContract
  );

  return {
    ok: health.state !== 'unhealthy'
      && failedCount === 0
      && clientRuntimeContract.validation.state === 'valid'
      && providerContract.validation.state === 'valid'
      && boundaryContract.validation.state === 'valid'
      && auditHandoffContract.validation.state === 'valid'
      && auditHandoffContract.commit.ready
      && persistedState.validation.state === 'valid'
      && !['blocked', 'cooldown', 'closed'].includes(operationalHealth.dispatchGate),
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'hosted-kernel scheduler priority policy v1',
    boundaryContract,
    auditHandoffContract,
    providerContract,
    clientRuntimeContract,
    readinessContract,
    persistenceContract,
    operationalHealth,
    health,
    summary: {
      evaluatedTasks: providerGatedDecisions.length,
      readyCount,
      failedCount,
      degradedMode: health.degraded,
      operationalHealthState: operationalHealth.state,
      dispatchGate: operationalHealth.dispatchGate,
      reportingSeverity: reportingState.severity,
      reportingHeadline: reportingState.headline,
      historyTrendState: reportingState.trend.state,
      nextHealthCheckAt: operationalHealth.retry.nextHealthCheckAt,
      providerHealthState: operationalHealth.providerHealth.state,
      providerIncidentState: operationalHealth.providerHealth.incidentState,
      providerConsecutiveFailures: operationalHealth.providerHealth.consecutiveFailures,
      providerRetryAfterMs: operationalHealth.providerHealth.retryAfterMs,
      providerValidationState: providerContract.validation.state,
      providerProtocolSupported: providerContract.provider.protocolSupported,
      providerSyncState: providerContract.sync.state,
      providerExternalHandoffState: providerContract.serviceContract.externalHandoff.state,
      providerHandoffEnvelopeState: providerContract.handoffEnvelope.state,
      providerServiceIssueCount: providerContract.validation.issueCount,
      controlErrors: controls.settingErrors.length,
      providerHandoffState: providerContract.handoff.state,
      previewState: readinessContract.preview.state,
      acceptanceState: readinessContract.acceptance.state,
      validationIssueCount: readinessContract.validation.issueCount,
      readyForDispatch: readinessContract.readiness.readyForDispatch,
      reviewBannerState: readinessContract.reviewContract.banner.state,
      reviewPrimaryAction: readinessContract.reviewContract.controls.primaryAction.command,
      reviewCanDispatch: readinessContract.reviewContract.controls.canDispatch,
      reviewCanAcceptSelection: readinessContract.reviewContract.controls.canAcceptSelection,
      boundaryValidationState: boundaryContract.validation.state,
      tenantId: boundaryContract.scope.tenantId,
      workspaceId: boundaryContract.scope.workspaceId,
      auditHandoffReady: boundaryContract.audit.handoffReady,
      auditCommitReady: auditHandoffContract.commit.ready,
      auditManifestRows: auditHandoffContract.manifest.totalRows,
      auditUnscopedReadyRows: auditHandoffContract.manifest.unscopedReadyRows,
      auditRouteAction: auditHandoffContract.sink.routeAction,
      clientBindingState: clientRuntimeContract.binding.state,
      clientHandoffState: clientRuntimeContract.handoff.state,
      clientDirective: clientRuntimeContract.handoff.userVisibleDirective,
      clientWorkflowState: clientRuntimeContract.workflow.state,
      clientWorkflowAction: clientRuntimeContract.workflow.action,
      clientHandoffAckRequired: clientRuntimeContract.workflow.requiresClientAck,
      clientHandoffAckMissing: clientRuntimeContract.workflow.ack.missingAck,
      clientDispatchManifestCount: clientRuntimeContract.workflow.dispatchManifest.length,
      restartSafeStatus: persistenceContract.restartSafeStatus,
      recoveredState: persistenceContract.recovered,
      commandStatus: controls.commandStatus,
      commandId: controls.commandId,
      pendingDispatchCount: persistenceContract.recovery.pendingDispatchCount,
      ackOverdueDispatchCount: persistenceContract.recovery.ackOverdueDispatchCount,
      dispatchWatermarkState: persistenceContract.idempotency.dispatchWatermarkState,
      checkpointMutation: persistenceContract.checkpointCommit.mutation,
      checkpointRouteAction: persistenceContract.checkpointCommit.routeAction,
      checkpointNextEpoch: persistenceContract.checkpointCommit.nextEpoch,
      lifecycleValidationState: controls.lifecycleContract.validation.state,
      lifecycleNextAction: controls.lifecycleContract.nextAction,
      commandWarningCount: controls.commandWarnings.length,
      persistenceWriteRequired: persistenceContract.writeIntent.required,
      nextSteps: readinessContract.nextSteps.map((step) => step.label),
      acceptedCapabilities: providerContract.provider.acceptedCapabilities,
      nextAction: controls.settingErrors.length > 0
        ? 'correct invalid lifecycle settings before dispatch'
        : health.state === 'unhealthy'
        ? 'restore scheduler workers or reduce queue depth before dispatch'
          : operationalHealth.dispatchGate === 'blocked'
          ? 'restore scheduler operational health before dispatch'
          : operationalHealth.dispatchGate === 'cooldown'
          ? 'wait for scheduler recovery cooldown before dispatch'
          : operationalHealth.dispatchGate === 'priority_only'
          ? 'dispatch critical/high lanes only until scheduler health stabilizes'
          : persistedState.validation.state !== 'valid'
          ? 'repair scheduler checkpoint before automatic dispatch'
          : controls.commandStatus === 'replay_ignored'
          ? 'return restart-safe persisted scheduler status without reapplying command'
          : clientRuntimeContract.validation.state !== 'valid'
          ? 'repair client runtime binding before dispatch handoff'
          : providerContract.validation.state !== 'valid'
          ? 'repair provider service contract before dispatch handoff'
          : boundaryContract.validation.state !== 'valid'
          ? 'repair tenant/workspace boundary before dispatch'
          : auditHandoffContract.validation.state !== 'valid' || !auditHandoffContract.commit.ready
          ? 'bind scheduler audit handoff before dispatch'
          : readinessContract.acceptance.state === 'awaiting_acceptance'
          ? 'accept the ready preview before dispatch'
          : failedCount > 0
          ? 'repair failed task metadata before dispatch'
          : 'dispatch ready tasks by descending priorityScore'
    },
    controls: {
      enabled: controls.enabled,
      lifecycleState: controls.lifecycleState,
      dispatchMode: controls.dispatchMode,
      command: controls.command,
      disabledLanes: controls.disabledLanes,
      maxConcurrentTasks: controls.maxConcurrentTasks,
      maxDispatchBatch: controls.maxDispatchBatch,
      inFlightTasks: controls.inFlightTasks,
      concurrencyRemaining: controls.concurrencyRemaining,
      dispatchApproved: controls.dispatchApproved,
      commandStatus: controls.commandStatus,
      commandId: controls.commandId,
      settingErrors: controls.settingErrors,
      commandWarnings: controls.commandWarnings,
      nextAction: controls.nextAction,
      lifecycleContract: controls.lifecycleContract
    },
    analytics,
    history,
    timeline,
    reportingState,
    exportReady,
    decisions: providerGatedDecisions,
    proof: {
      policy,
      audit: {
        inputEvidenceCount: Array.isArray(input.evidence) ? input.evidence.length : 0,
        decisionCount: providerGatedDecisions.length,
        providerContractSchemaVersion: providerContract.schemaVersion,
        providerHandoffState: providerContract.handoff.state,
        clientRuntimeContractKind: clientRuntimeContract.contractKind,
        clientBindingState: clientRuntimeContract.binding.state,
        clientHandoffState: clientRuntimeContract.handoff.state,
        clientDirective: clientRuntimeContract.handoff.userVisibleDirective,
        clientValidationIssueCount: clientRuntimeContract.validation.issueCount,
        clientResumeTokenIssued: Boolean(clientRuntimeContract.handoff.resumeToken),
        clientWorkflowState: clientRuntimeContract.workflow.state,
        clientWorkflowAction: clientRuntimeContract.workflow.action,
        clientHandoffAckRequired: clientRuntimeContract.workflow.requiresClientAck,
        clientHandoffAckMissing: clientRuntimeContract.workflow.ack.missingAck,
        clientDispatchManifestCount: clientRuntimeContract.workflow.dispatchManifest.length,
        boundaryContractKind: boundaryContract.contractKind,
        boundaryValidationState: boundaryContract.validation.state,
        boundaryIssueCount: boundaryContract.validation.issueCount,
        tenantId: boundaryContract.scope.tenantId,
        workspaceId: boundaryContract.scope.workspaceId,
        scopedWorkspaceCount: boundaryContract.scope.allowedWorkspaceIds.length,
        permissionCheckRequired: boundaryContract.actor.requirePermissionCheck,
        auditHandoffReady: boundaryContract.audit.handoffReady,
        auditHandoffContractKind: auditHandoffContract.contractKind,
        auditHandoffValidationState: auditHandoffContract.validation.state,
        auditCommitReady: auditHandoffContract.commit.ready,
        auditCommitMode: auditHandoffContract.commit.mode,
        auditManifestRows: auditHandoffContract.manifest.totalRows,
        auditUnscopedReadyRows: auditHandoffContract.manifest.unscopedReadyRows,
        auditRouteAction: auditHandoffContract.sink.routeAction,
        previewContractKind: readinessContract.contractKind,
        previewState: readinessContract.preview.state,
        acceptanceState: readinessContract.acceptance.state,
        reviewContractKind: readinessContract.reviewContract.contractKind,
        reviewBannerState: readinessContract.reviewContract.banner.state,
        reviewPrimaryAction: readinessContract.reviewContract.controls.primaryAction.command,
        reviewCanDispatch: readinessContract.reviewContract.controls.canDispatch,
        reviewCanAcceptSelection: readinessContract.reviewContract.controls.canAcceptSelection,
        reviewSelectableCount: readinessContract.reviewContract.previewList.selectableCount,
        reviewBlockedCount: readinessContract.reviewContract.previewList.blockedCount,
        validationIssueCount: readinessContract.validation.issueCount,
        readyForDispatch: readinessContract.readiness.readyForDispatch,
        nextStepCount: readinessContract.nextSteps.length,
        acceptedCapabilityCount: providerContract.provider.acceptedCapabilities.length,
        rejectedCapabilityCount: providerContract.provider.rejectedCapabilities.length,
        providerValidationState: providerContract.validation.state,
        providerServiceContractKind: providerContract.serviceContract.contractKind,
        providerProtocolSupported: providerContract.provider.protocolSupported,
        providerRequiredCapabilityCount: providerContract.provider.requiredCapabilities.length,
        providerMissingRequiredCapabilityCount: providerContract.provider.missingRequiredCapabilities.length,
        providerSyncState: providerContract.sync.state,
        providerMinimumSourceEpoch: providerContract.sync.minimumSourceEpoch,
        providerExternalHandoffState: providerContract.serviceContract.externalHandoff.state,
        providerExternalHandoffRequired: providerContract.serviceContract.externalHandoff.required,
        providerHandoffEnvelopeKind: providerContract.handoffEnvelope.contractKind,
        providerHandoffEnvelopeState: providerContract.handoffEnvelope.state,
        providerHandoffEnvelopeReadyCount: providerContract.handoffEnvelope.manifest.readyCount,
        providerHandoffEnvelopeBlockedCount: providerContract.handoffEnvelope.manifest.blockedCount,
        providerServiceIssueCount: providerContract.validation.issueCount,
        syncRequiresAck: providerContract.sync.requiresAck,
        analyticsCounters: analytics.counters,
        laneCounters: analytics.lanes,
        failureHotspotCount: analytics.failureHotspots.length,
        reportingSeverity: reportingState.severity,
        historyTrendState: reportingState.trend.state,
        historySnapshotCount: history.snapshots.length,
        exportSchemaVersion: exportReady.schemaVersion,
        lifecycleState: controls.lifecycleState,
        dispatchMode: controls.dispatchMode,
        settingErrorCount: controls.settingErrors.length,
        lifecycleContractKind: controls.lifecycleContract.contractKind,
        lifecycleValidationState: controls.lifecycleContract.validation.state,
        lifecycleNextAction: controls.lifecycleContract.nextAction,
        commandWarningCount: controls.commandWarnings.length,
        operationalHealthState: operationalHealth.state,
        dispatchGate: operationalHealth.dispatchGate,
        operationalHealthIssueCount: operationalHealth.validation.issueCount,
        nextHealthCheckAt: operationalHealth.retry.nextHealthCheckAt,
        providerHealthState: operationalHealth.providerHealth.state,
        providerIncidentState: operationalHealth.providerHealth.incidentState,
        providerConsecutiveFailures: operationalHealth.providerHealth.consecutiveFailures,
        providerRetryAfterMs: operationalHealth.providerHealth.retryAfterMs,
        providerHealthValidationState: operationalHealth.providerHealth.validationState,
        persistedStateContractKind: persistedState.contractKind,
        persistenceContractKind: persistenceContract.contractKind,
        restartStatus: persistedState.restartStatus,
        restartSafeStatus: persistenceContract.restartSafeStatus,
        recoveredState: persistenceContract.recovered,
        persistedStateIssueCount: persistedState.validation.issueCount,
        commandStatus: controls.commandStatus,
        commandId: controls.commandId,
        replayedCommand: persistedState.command.replayed,
        pendingDispatchCount: persistenceContract.recovery.pendingDispatchCount,
        ackOverdueDispatchCount: persistenceContract.recovery.ackOverdueDispatchCount,
        dispatchWatermarkState: persistenceContract.idempotency.dispatchWatermarkState,
        persistenceWriteRequired: persistenceContract.writeIntent.required,
        checkpointCommitKind: persistenceContract.checkpointCommit.contractKind,
        checkpointMutation: persistenceContract.checkpointCommit.mutation,
        checkpointRouteAction: persistenceContract.checkpointCommit.routeAction,
        checkpointNextEpoch: persistenceContract.checkpointCommit.nextEpoch,
        restartStatusSnapshotKind: persistenceContract.restartStatusSnapshot.contractKind,
        nextCheckpointEpoch: persistenceContract.nextCheckpoint.stateEpoch,
        generatedBy: surfaceId
      }
    },
    evidence: Array.isArray(input.evidence) ? input.evidence : []
  };
}

export default describePriorityPolicySurface;
