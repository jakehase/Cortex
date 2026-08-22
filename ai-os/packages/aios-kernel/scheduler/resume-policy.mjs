export const surfaceId = "aios_scheduler_resume-policy_059";
export const surfaceGroup = "scheduler";
export const surfaceName = "resume-policy";

const DEFAULT_ALLOWED_ROLES = new Set(['owner', 'admin', 'operator', 'scheduler']);
const CROSS_TENANT_ROLES = new Set(['owner', 'admin']);
const VALID_BOUNDARY_MODES = new Set(['strict', 'workspace', 'tenant']);
const DEFAULT_MAX_RESUME_ATTEMPTS = 3;
const DEFAULT_RETRY_AFTER_MS = 30000;
const MAX_RETRY_AFTER_MS = 900000;
const HEALTHY_DEPENDENCY_STATES = new Set(['ok', 'healthy', 'ready']);
const DEGRADED_DEPENDENCY_STATES = new Set(['degraded', 'slow', 'stale']);
const FAILED_DEPENDENCY_STATES = new Set(['down', 'failed', 'unavailable', 'timeout']);
const VALID_FAILURE_STATE_STATUSES = new Set(['closed', 'open', 'half_open', 'tripped', 'recovering']);
const HISTORY_SNAPSHOT_LIMIT = 25;
const ANALYTICS_EXPORT_ROW_LIMIT = 100;
const ANALYTICS_RECENT_WINDOW_SIZE = 10;
const VALID_ANALYTICS_EXPORT_FORMATS = new Set(['json', 'jsonl', 'csv']);
const KNOWN_HISTORY_OUTCOMES = new Set(['allow', 'allow_with_review', 'deny', 'failed', 'degraded', 'dispatched', 'retried']);
const VALID_CLIENT_INTENTS = new Set(['resume', 'retry', 'handoff', 'inspect', 'cancel']);
const VALID_HANDOFF_CHANNELS = new Set(['scheduler-console', 'client-runtime', 'operator-review', 'audit-export']);
const VALID_CLIENT_STATE_STATUSES = new Set(['unknown', 'draft', 'previewing', 'accepted', 'acknowledged', 'dispatching', 'reviewing', 'blocked', 'stale']);
const VALID_PREVIEW_ACCEPTANCE_ACTIONS = new Set(['accept', 'reject', 'defer', 'request_review']);
const MAX_CLIENT_STATE_AGE_MS = 300000;
const MAX_PREVIEW_ACCEPTANCE_AGE_MS = 600000;
const TERMINAL_PERSISTED_STATUSES = new Set(['blocked', 'cancelled', 'completed', 'dispatched', 'failed_terminal']);
const ACTIVE_PERSISTED_STATUSES = new Set(['checkpointed', 'dispatching', 'retry_scheduled', 'awaiting_ack', 'review_required']);
const VALID_PERSISTED_STATUSES = new Set([...TERMINAL_PERSISTED_STATUSES, ...ACTIVE_PERSISTED_STATUSES, 'missing', 'stale']);
const VALID_LIFECYCLE_COMMANDS = new Set(['enable', 'disable', 'pause', 'resume', 'drain', 'hold', 'cancel']);
const VALID_SCHEDULE_MODES = new Set(['immediate', 'delayed', 'maintenance_window', 'manual_review']);
const VALID_DRAIN_POLICIES = new Set(['reject_new', 'allow_checkpointed', 'allow_all']);
const TERMINAL_COMMAND_STATUSES = new Set(['completed', 'succeeded', 'failed_terminal', 'cancelled']);
const ACTIVE_COMMAND_STATUSES = new Set(['recorded', 'queued', 'dispatching', 'running', 'retry_scheduled', 'awaiting_ack', 'review_required']);
const FAILED_RETRYABLE_COMMAND_STATUSES = new Set(['failed', 'timed_out', 'lease_expired']);
const VALID_COMMAND_STATUSES = new Set([...TERMINAL_COMMAND_STATUSES, ...ACTIVE_COMMAND_STATUSES, ...FAILED_RETRYABLE_COMMAND_STATUSES, 'unknown']);
const MAX_SCHEDULE_DELAY_MS = 86400000;
const REASON_REQUIRED_LIFECYCLE_COMMANDS = new Set(['disable', 'hold', 'drain', 'cancel']);
const LIFECYCLE_COMMAND_TYPES = {
  enable: 'scheduler.resume.lifecycle.enable',
  disable: 'scheduler.resume.lifecycle.disable',
  pause: 'scheduler.resume.lifecycle.pause',
  resume: 'scheduler.resume.lifecycle.resume',
  drain: 'scheduler.resume.lifecycle.drain',
  hold: 'scheduler.resume.lifecycle.hold',
  cancel: 'scheduler.resume.lifecycle.cancel'
};
const RESUME_INTENT_ACTIONS = {
  resume: 'scheduler.resume.execute',
  retry: 'scheduler.resume.retry',
  handoff: 'scheduler.resume.handoff',
  inspect: 'scheduler.resume.inspect',
  cancel: 'scheduler.resume.cancel'
};
const WILDCARD_PERMISSION_ACTIONS = new Set(['scheduler.resume.*', 'scheduler.resume.manage']);
const VALID_PERMISSION_SOURCES = new Set(['actor', 'workspace-policy', 'tenant-policy', 'operator-delegation', 'system']);
const WORKSPACE_SCOPE_AUTHORITY = new Set(['workspace-membership', 'workspace-grant', 'tenant-grant', 'cross-tenant-delegation']);
const VALID_PROVIDER_TYPES = new Set(['kernel', 'queue', 'checkpoint-store', 'audit-sink', 'client-handoff', 'operator-review']);
const VALID_PROVIDER_STATUSES = new Set(['unknown', 'ready', 'degraded', 'unavailable', 'stale']);
const HEALTHY_PROVIDER_STATUSES = new Set(['ready']);
const DEGRADED_PROVIDER_STATUSES = new Set(['degraded', 'stale']);
const FAILED_PROVIDER_STATUSES = new Set(['unavailable']);
const VALID_PROVIDER_HANDOFF_STATUSES = new Set(['none', 'pending', 'accepted', 'externalized', 'failed', 'expired']);
const MAX_PROVIDER_SYNC_LAG_MS = 120000;
const RESUME_PROVIDER_CAPABILITIES = {
  resume: ['resume.dispatch', 'checkpoint.write', 'audit.emit'],
  retry: ['resume.retry.schedule', 'checkpoint.write', 'audit.emit'],
  handoff: ['external.handoff', 'client.state.sync', 'audit.emit'],
  inspect: ['audit.read', 'client.state.sync'],
  cancel: ['resume.cancel', 'checkpoint.write', 'audit.emit']
};

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asText(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => asText(entry)).filter(Boolean);
}

function asNumber(value, fallback = 0) {
  if (Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return fallback;
}

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeTimestamp(value, fallback) {
  const text = asText(value);
  if (!text) return fallback;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function normalizeDependencyHealth(input) {
  const source = Array.isArray(input.dependencies)
    ? input.dependencies
    : Array.isArray(input.scheduler?.dependencies)
      ? input.scheduler.dependencies
    : Array.isArray(input.health?.dependencies)
      ? input.health.dependencies
      : [];

  return source.map((dependency, index) => {
    const record = asRecord(dependency);
    return {
      name: asText(record.name, `dependency-${index + 1}`),
      state: asText(record.state || record.status, 'unknown').toLowerCase(),
      required: record.required !== false,
      checkedAt: asText(record.checkedAt || input.health?.checkedAt)
    };
  });
}

function normalizeProviderContracts(input, generatedAt) {
  const scheduler = asRecord(input.scheduler);
  const source = Array.isArray(input.providerContracts)
    ? input.providerContracts
    : Array.isArray(input.integrationProviders)
      ? input.integrationProviders
      : Array.isArray(scheduler.providerContracts)
        ? scheduler.providerContracts
        : Array.isArray(scheduler.integrationProviders)
          ? scheduler.integrationProviders
          : [];
  const generatedAtMs = Date.parse(generatedAt);
  const effectiveSource = source.length
    ? source
    : [
        {
          providerId: 'hosted-kernel-dispatch',
          type: 'queue',
          status: 'ready',
          required: true,
          capabilities: ['resume.dispatch', 'resume.retry.schedule', 'resume.cancel'],
          sync: { observedAt: generatedAt, revision: 1 }
        },
        {
          providerId: 'hosted-kernel-checkpoint',
          type: 'checkpoint-store',
          status: 'ready',
          required: true,
          capabilities: ['checkpoint.write'],
          sync: { observedAt: generatedAt, revision: 1 }
        },
        {
          providerId: 'hosted-kernel-audit',
          type: 'audit-sink',
          status: 'ready',
          required: true,
          capabilities: ['audit.emit', 'audit.read'],
          sync: { observedAt: generatedAt, revision: 1 }
        },
        {
          providerId: 'hosted-kernel-client-sync',
          type: 'client-handoff',
          status: 'ready',
          required: false,
          capabilities: ['client.state.sync', 'external.handoff'],
          sync: { observedAt: generatedAt, revision: 1 }
        }
      ];

  return effectiveSource.map((entry, index) => {
    const record = asRecord(entry);
    const sync = asRecord(record.sync || record.syncMetadata || record.cursor);
    const handoff = asRecord(record.handoff || record.externalHandoff || record.externalState);
    const providerType = asText(record.type || record.providerType || record.kind, 'kernel').toLowerCase();
    const status = asText(record.status || record.state, 'unknown').toLowerCase();
    const observedAt = normalizeTimestamp(record.observedAt || record.checkedAt || sync.observedAt || sync.updatedAt, '');
    const observedAtMs = observedAt ? Date.parse(observedAt) : 0;
    const explicitLagMs = asNumber(sync.lagMs, asNumber(record.syncLagMs, -1));
    const lagMs = explicitLagMs >= 0
      ? clampNumber(explicitLagMs, 0, MAX_RETRY_AFTER_MS)
      : observedAtMs && Number.isFinite(observedAtMs) && Number.isFinite(generatedAtMs)
        ? Math.max(generatedAtMs - observedAtMs, 0)
        : null;
    const stale = status === 'stale'
      || sync.stale === true
      || (lagMs !== null && lagMs > MAX_PROVIDER_SYNC_LAG_MS);
    const handoffStatus = asText(handoff.status || handoff.state, handoff.externalStateId ? 'externalized' : 'none').toLowerCase();
    const validation = [];

    if (!asText(record.providerId || record.id || record.name)) {
      validation.push({ code: 'provider_id_missing', severity: 'warning', field: 'providerContracts.providerId' });
    }
    if (!VALID_PROVIDER_TYPES.has(providerType)) {
      validation.push({ code: 'provider_type_unknown', severity: 'warning', field: 'providerContracts.type', value: providerType });
    }
    if (!VALID_PROVIDER_STATUSES.has(status)) {
      validation.push({ code: 'provider_status_unknown', severity: 'warning', field: 'providerContracts.status', value: status });
    }
    if (!observedAt) {
      validation.push({ code: 'provider_sync_observed_at_missing', severity: 'warning', field: 'providerContracts.sync.observedAt' });
    } else if (stale) {
      validation.push({ code: 'provider_sync_stale', severity: 'warning', field: 'providerContracts.sync.observedAt', lagMs });
    }
    if (handoffStatus !== 'none' && !asText(handoff.externalStateId || handoff.stateId || record.externalStateId)) {
      validation.push({ code: 'provider_handoff_state_id_missing', severity: 'warning', field: 'providerContracts.handoff.externalStateId' });
    }

    return {
      contract: 'scheduler.resume_policy.provider_contract.v1',
      providerId: asText(record.providerId || record.id || record.name, `provider-${index + 1}`),
      name: asText(record.name || record.label, `provider-${index + 1}`),
      type: VALID_PROVIDER_TYPES.has(providerType) ? providerType : 'kernel',
      status: VALID_PROVIDER_STATUSES.has(status) ? status : 'unknown',
      required: record.required !== false,
      capabilities: asStringArray(record.capabilities || record.provides || record.scopes).map((capability) => capability.toLowerCase()),
      sync: {
        cursor: asText(sync.cursor || sync.token || record.syncCursor),
        revision: clampNumber(asNumber(sync.revision, asNumber(record.revision, 0)), 0, 1000000000),
        observedAt,
        lagMs,
        stale
      },
      handoff: {
        status: VALID_PROVIDER_HANDOFF_STATUSES.has(handoffStatus) ? handoffStatus : 'none',
        externalStateId: asText(handoff.externalStateId || handoff.stateId || record.externalStateId),
        channel: asText(handoff.channel || record.channel),
        returnTo: asText(handoff.returnTo || record.returnTo),
        expiresAt: normalizeTimestamp(handoff.expiresAt || record.expiresAt, '')
      },
      validation
    };
  });
}

function normalizeClientRuntime(input) {
  const client = asRecord(input.client || input.clientRuntime || input.runtimeClient);
  const resumeRequest = asRecord(input.resumeRequest || input.request);
  const handoff = asRecord(input.workflowHandoff || resumeRequest.handoff || client.handoff);
  const requestState = asRecord(client.requestState || resumeRequest.clientState || handoff.state);
  const intent = asText(handoff.intent || resumeRequest.intent || client.intent, 'resume').toLowerCase();
  const channel = asText(handoff.channel || client.channel, 'client-runtime').toLowerCase();
  const status = asText(requestState.status || requestState.state || client.status, 'unknown').toLowerCase();
  const acknowledged = asRecord(handoff.acknowledged || client.acknowledged);
  const visibleSignals = asStringArray(handoff.visibleSignals || client.visibleSignals);

  return {
    sessionId: asText(client.sessionId || input.sessionId),
    requestStateId: asText(client.requestStateId || resumeRequest.clientStateId || input.requestStateId),
    stateRevision: clampNumber(asNumber(requestState.revision, asNumber(client.stateRevision, 0)), 0, 1000000),
    stateObservedAt: normalizeTimestamp(requestState.observedAt || requestState.updatedAt || client.stateObservedAt, ''),
    status: VALID_CLIENT_STATE_STATUSES.has(status) ? status : 'unknown',
    lastKnownWorkflowState: asText(requestState.workflowState || client.workflowState),
    lastKnownNextAction: asText(requestState.nextAction || client.nextAction),
    view: asText(client.view || handoff.view, 'resume-panel'),
    intent: VALID_CLIENT_INTENTS.has(intent) ? intent : 'resume',
    channel: VALID_HANDOFF_CHANNELS.has(channel) ? channel : 'client-runtime',
    returnTo: asText(handoff.returnTo || client.returnTo || input.returnTo),
    acknowledgement: {
      required: acknowledged.required === true || handoff.requireAcknowledgement === true,
      token: asText(acknowledged.token || handoff.acknowledgementToken),
      receivedAt: normalizeTimestamp(acknowledged.receivedAt || handoff.acknowledgedAt, '')
    },
    visibleSignals: visibleSignals.length ? visibleSignals : ['decision', 'healthStatus', 'retry', 'clientState'],
    optimisticDispatch: client.optimisticDispatch === true || handoff.optimisticDispatch === true
  };
}

function normalizeFailureState(input, generatedAt) {
  const scheduler = asRecord(input.scheduler);
  const source = asRecord(input.failureState || input.resumeFailureState || scheduler.failureState);
  const rawStatus = asText(source.status || source.state, 'closed').toLowerCase().replace('-', '_');
  const retryAfterMs = clampNumber(
    asNumber(source.retryAfterMs, asNumber(source.backoffMs, 0)),
    0,
    MAX_RETRY_AFTER_MS
  );
  const consecutiveFailures = clampNumber(
    asNumber(source.consecutiveFailures, asNumber(source.failureCount, 0)),
    0,
    1000
  );
  const degradedUntil = normalizeTimestamp(source.degradedUntil || source.recoverAfter || source.cooldownUntil, '');
  const degradedUntilMs = degradedUntil ? Date.parse(degradedUntil) - Date.parse(generatedAt) : 0;

  return {
    contract: 'scheduler.resume_policy.failure_state.v1',
    status: VALID_FAILURE_STATE_STATUSES.has(rawStatus) ? rawStatus : 'closed',
    reasonCode: asText(source.reasonCode || source.reason || source.lastErrorCode),
    consecutiveFailures,
    openedAt: normalizeTimestamp(source.openedAt || source.trippedAt, ''),
    lastFailureAt: normalizeTimestamp(source.lastFailureAt || source.failedAt, ''),
    degradedUntil,
    retryAfterMs: Math.max(retryAfterMs, degradedUntilMs > 0 ? degradedUntilMs : 0),
    operatorAction: asText(source.operatorAction || source.remediation),
    auditRef: asText(source.auditRef || source.evidenceRef)
  };
}

function normalizeLifecycleSettings(input, generatedAt) {
  const scheduler = asRecord(input.scheduler);
  const source = asRecord(input.lifecycleSettings || input.resumePolicySettings || scheduler.lifecycleSettings || scheduler.resumePolicySettings);
  const rawCommand = asText(source.command || source.lifecycleCommand || source.action).toLowerCase();
  const rawScheduleMode = asText(source.scheduleMode || source.mode, source.nextRunAt ? 'delayed' : 'immediate').toLowerCase();
  const rawDrainPolicy = asText(source.drainPolicy, 'reject_new').toLowerCase();
  const maintenanceWindow = asRecord(source.maintenanceWindow || source.window);
  const concurrency = asRecord(source.concurrency || source.limits);
  const enabled = source.enabled !== false && source.disabled !== true;
  const minDelayMs = clampNumber(asNumber(source.minDelayMs, 0), 0, MAX_SCHEDULE_DELAY_MS);
  const maxDelayMs = clampNumber(asNumber(source.maxDelayMs, MAX_SCHEDULE_DELAY_MS), 0, MAX_SCHEDULE_DELAY_MS);
  const requestedDelayMs = clampNumber(
    asNumber(source.delayMs, asNumber(source.scheduleAfterMs, minDelayMs)),
    0,
    MAX_SCHEDULE_DELAY_MS
  );
  const nextRunAt = normalizeTimestamp(source.nextRunAt || source.scheduleAt, '');
  const windowStartsAt = normalizeTimestamp(maintenanceWindow.startsAt || maintenanceWindow.startAt, '');
  const windowEndsAt = normalizeTimestamp(maintenanceWindow.endsAt || maintenanceWindow.endAt, '');
  const generatedAtMs = Date.parse(generatedAt);
  const effectiveGeneratedAtMs = Number.isFinite(generatedAtMs) ? generatedAtMs : Date.now();
  const validationFindings = [];

  if (rawCommand && !VALID_LIFECYCLE_COMMANDS.has(rawCommand)) {
    validationFindings.push({ code: 'invalid_lifecycle_command', severity: 'error', field: 'lifecycleSettings.command', value: rawCommand });
  }
  if (rawScheduleMode && !VALID_SCHEDULE_MODES.has(rawScheduleMode)) {
    validationFindings.push({ code: 'invalid_schedule_mode', severity: 'error', field: 'lifecycleSettings.scheduleMode', value: rawScheduleMode });
  }
  if (rawDrainPolicy && !VALID_DRAIN_POLICIES.has(rawDrainPolicy)) {
    validationFindings.push({ code: 'invalid_drain_policy', severity: 'error', field: 'lifecycleSettings.drainPolicy', value: rawDrainPolicy });
  }
  if (minDelayMs > maxDelayMs) {
    validationFindings.push({ code: 'schedule_delay_bounds_inverted', severity: 'error', field: 'lifecycleSettings.minDelayMs' });
  }
  if (!enabled && !asText(source.disabledReason || source.reason)) {
    validationFindings.push({ code: 'resume_policy_disabled_without_reason', severity: 'warning', field: 'lifecycleSettings.disabledReason' });
  }
  if (rawScheduleMode === 'maintenance_window' && !windowEndsAt) {
    validationFindings.push({ code: 'maintenance_window_missing_end', severity: 'warning', field: 'lifecycleSettings.maintenanceWindow.endsAt' });
  }

  const boundedDelayMs = clampNumber(requestedDelayMs, Math.min(minDelayMs, maxDelayMs), Math.max(minDelayMs, maxDelayMs));
  const delayUntil = nextRunAt || (boundedDelayMs > 0 ? new Date(effectiveGeneratedAtMs + boundedDelayMs).toISOString() : '');
  const windowActive = maintenanceWindow.active === true || (
    windowStartsAt
    && Date.parse(windowStartsAt) <= effectiveGeneratedAtMs
    && (!windowEndsAt || Date.parse(windowEndsAt) > effectiveGeneratedAtMs)
  );

  return {
    contract: 'scheduler.resume_policy.lifecycle_settings.v1',
    enabled,
    command: VALID_LIFECYCLE_COMMANDS.has(rawCommand) ? rawCommand : 'resume',
    scheduleMode: VALID_SCHEDULE_MODES.has(rawScheduleMode) ? rawScheduleMode : 'immediate',
    drainPolicy: VALID_DRAIN_POLICIES.has(rawDrainPolicy) ? rawDrainPolicy : 'reject_new',
    disabledReason: asText(source.disabledReason || source.reason),
    allowManualOverride: source.allowManualOverride === true,
    requireAckBeforeDispatch: source.requireAckBeforeDispatch === true,
    delay: {
      requestedMs: requestedDelayMs,
      effectiveMs: boundedDelayMs,
      minMs: minDelayMs,
      maxMs: maxDelayMs,
      until: delayUntil
    },
    maintenanceWindow: {
      active: Boolean(windowActive),
      startsAt: windowStartsAt,
      endsAt: windowEndsAt
    },
    concurrency: {
      maxInFlight: clampNumber(asNumber(concurrency.maxInFlight, asNumber(source.maxInFlight, 1)), 1, 10000),
      currentInFlight: clampNumber(asNumber(concurrency.currentInFlight, asNumber(source.currentInFlight, 0)), 0, 10000),
      reservedSlots: clampNumber(asNumber(concurrency.reservedSlots, 0), 0, 10000)
    },
    validation: {
      valid: !validationFindings.some((finding) => finding.severity === 'error'),
      findings: validationFindings
    }
  };
}

function normalizeLifecycleCommandRequest(input, lifecycle, generatedAt) {
  const scheduler = asRecord(input.scheduler);
  const source = asRecord(input.lifecycleCommandRequest || input.lifecycleCommand || scheduler.lifecycleCommandRequest);
  const rawCommand = asText(source.command || source.action || source.lifecycleCommand).toLowerCase();
  const rawScheduleMode = asText(source.scheduleMode || source.mode, lifecycle.scheduleMode).toLowerCase();
  const requestedAt = normalizeTimestamp(source.requestedAt || source.createdAt || source.submittedAt, generatedAt);
  const requestedDelayMs = clampNumber(asNumber(source.delayMs, asNumber(source.scheduleAfterMs, 0)), 0, MAX_SCHEDULE_DELAY_MS);
  const scheduledFor = normalizeTimestamp(source.scheduledFor || source.effectiveAt || source.scheduleAt, '');
  const generatedAtMs = Date.parse(generatedAt);
  const effectiveGeneratedAtMs = Number.isFinite(generatedAtMs) ? generatedAtMs : Date.now();
  const effectiveAt = scheduledFor || (requestedDelayMs > 0 ? new Date(effectiveGeneratedAtMs + requestedDelayMs).toISOString() : generatedAt);
  const effectiveAtMs = Date.parse(effectiveAt);
  const validationFindings = [];

  if (!rawCommand) {
    validationFindings.push({ code: 'lifecycle_command_request_missing', severity: 'info', field: 'lifecycleCommandRequest.command' });
  } else if (!VALID_LIFECYCLE_COMMANDS.has(rawCommand)) {
    validationFindings.push({ code: 'invalid_lifecycle_command_request', severity: 'error', field: 'lifecycleCommandRequest.command', value: rawCommand });
  }
  if (rawScheduleMode && !VALID_SCHEDULE_MODES.has(rawScheduleMode)) {
    validationFindings.push({ code: 'invalid_lifecycle_command_schedule_mode', severity: 'error', field: 'lifecycleCommandRequest.scheduleMode', value: rawScheduleMode });
  }
  if (rawCommand && REASON_REQUIRED_LIFECYCLE_COMMANDS.has(rawCommand) && !asText(source.reason || source.justification)) {
    validationFindings.push({ code: 'lifecycle_command_reason_required', severity: 'error', field: 'lifecycleCommandRequest.reason' });
  }
  if (rawCommand && !asText(source.idempotencyKey || source.commandKey)) {
    validationFindings.push({ code: 'lifecycle_command_idempotency_key_missing', severity: 'warning', field: 'lifecycleCommandRequest.idempotencyKey' });
  }
  if (Number.isFinite(effectiveAtMs) && effectiveAtMs < effectiveGeneratedAtMs - 1000) {
    validationFindings.push({ code: 'lifecycle_command_effective_at_in_past', severity: 'warning', field: 'lifecycleCommandRequest.effectiveAt' });
  }
  if (rawCommand === 'enable' && source.disabledReason) {
    validationFindings.push({ code: 'enable_command_ignores_disabled_reason', severity: 'warning', field: 'lifecycleCommandRequest.disabledReason' });
  }

  const command = VALID_LIFECYCLE_COMMANDS.has(rawCommand) ? rawCommand : '';
  const scheduleMode = VALID_SCHEDULE_MODES.has(rawScheduleMode) ? rawScheduleMode : lifecycle.scheduleMode;
  const scheduled = scheduleMode === 'delayed' || (Number.isFinite(effectiveAtMs) && effectiveAtMs > effectiveGeneratedAtMs);

  return {
    contract: 'scheduler.resume_policy.lifecycle_command_request.v1',
    present: Boolean(rawCommand),
    command,
    commandType: command ? LIFECYCLE_COMMAND_TYPES[command] : null,
    requestedBy: asText(source.requestedBy || source.actorId || input.actor?.id, 'anonymous'),
    requestedAt,
    reason: asText(source.reason || source.justification),
    idempotencyKey: asText(source.idempotencyKey || source.commandKey),
    scheduleMode,
    scheduled,
    effectiveAt,
    dryRun: source.dryRun === true || source.preview === true,
    force: source.force === true || source.manualOverride === true,
    acknowledgementToken: asText(source.acknowledgementToken || source.ackToken),
    validation: {
      valid: !validationFindings.some((finding) => finding.severity === 'error'),
      findings: validationFindings
    }
  };
}

function lifecyclePatchForCommand(lifecycle, commandRequest) {
  const command = commandRequest.command;
  const disabledReason = commandRequest.reason || lifecycle.disabledReason || null;
  if (!command) return null;

  return {
    enabled: command === 'disable' || command === 'cancel' ? false : true,
    command,
    disabledReason: command === 'disable' || command === 'cancel' ? disabledReason : null,
    scheduleMode: commandRequest.scheduled ? 'delayed' : lifecycle.scheduleMode,
    effectiveAt: commandRequest.effectiveAt,
    drainPolicy: command === 'drain' ? lifecycle.drainPolicy : null,
    requireAckBeforeDispatch: lifecycle.requireAckBeforeDispatch,
    concurrency: lifecycle.concurrency
  };
}

function normalizePermissionGrants(input, generatedAt) {
  const actor = asRecord(input.actor);
  const source = Array.isArray(actor.permissionGrants)
    ? actor.permissionGrants
    : Array.isArray(actor.grants)
      ? actor.grants
      : Array.isArray(input.permissionGrants)
        ? input.permissionGrants
        : [];

  return source.map((entry, index) => {
    const record = asRecord(entry);
    const sourceName = asText(record.source || record.issuer || record.issuedBy, 'actor').toLowerCase();
    const expiresAt = normalizeTimestamp(record.expiresAt || record.expires || record.validUntil, '');
    return {
      grantId: asText(record.grantId || record.id, `permission-grant-${index + 1}`),
      source: VALID_PERMISSION_SOURCES.has(sourceName) ? sourceName : 'actor',
      tenantId: asText(record.tenantId || record.tenant),
      workspaceId: asText(record.workspaceId || record.workspace),
      actions: asStringArray(record.actions || record.permissions || record.scopes).map((action) => action.toLowerCase()),
      roles: asStringArray(record.roles || record.roleBindings).map((role) => role.toLowerCase()),
      expiresAt,
      expired: expiresAt ? Date.parse(expiresAt) <= Date.parse(generatedAt) : false,
      reason: asText(record.reason || record.note)
    };
  });
}

function normalizeContext(input, generatedAt) {
  const actor = asRecord(input.actor);
  const workspace = asRecord(input.workspace);
  const resumeRequest = asRecord(input.resumeRequest || input.request);
  const scheduler = asRecord(input.scheduler);
  const retry = asRecord(resumeRequest.retry || input.retry);
  const requestedWorkspaceId = asText(resumeRequest.workspaceId, asText(input.workspaceId));
  const requestedTenantId = asText(resumeRequest.tenantId, asText(input.tenantId));
  const mode = asText(input.boundaryMode, 'strict');
  const attempt = clampNumber(asNumber(retry.attempt, asNumber(resumeRequest.attempt, 0)), 0, 1000);
  const maxAttempts = clampNumber(
    asNumber(retry.maxAttempts, asNumber(input.maxResumeAttempts, DEFAULT_MAX_RESUME_ATTEMPTS)),
    1,
    1000
  );
  const lifecycleSettings = normalizeLifecycleSettings(input, generatedAt);
  const lifecycleCommandRequest = normalizeLifecycleCommandRequest(input, lifecycleSettings, generatedAt);

  return {
    actor: {
      id: asText(actor.id, 'anonymous'),
      tenantId: asText(actor.tenantId, asText(input.actorTenantId)),
      workspaceIds: asStringArray(actor.workspaceIds || actor.workspaces),
      roles: new Set(asStringArray(actor.roles).map((role) => role.toLowerCase())),
      permissionGrants: normalizePermissionGrants(input, generatedAt)
    },
    workspace: {
      id: asText(workspace.id, asText(input.currentWorkspaceId)),
      tenantId: asText(workspace.tenantId, asText(input.currentTenantId)),
      suspended: Boolean(workspace.suspended),
      locked: Boolean(workspace.locked)
    },
    request: {
      id: asText(resumeRequest.id, asText(input.resumeId, 'resume-request')),
      runId: asText(resumeRequest.runId, asText(input.runId)),
      workspaceId: requestedWorkspaceId,
      tenantId: requestedTenantId,
      reason: asText(resumeRequest.reason, 'manual-resume'),
      requestedBy: asText(resumeRequest.requestedBy, asText(actor.id, 'anonymous')),
      idempotencyKey: asText(resumeRequest.idempotencyKey || input.idempotencyKey),
      attempt,
      maxAttempts
    },
    scheduler: {
      state: asText(scheduler.state || input.schedulerState, 'ready').toLowerCase(),
      queueDepth: clampNumber(asNumber(scheduler.queueDepth, asNumber(input.queueDepth, 0)), 0, 1000000),
      acceptingResumes: scheduler.acceptingResumes !== false,
      lastError: asText(scheduler.lastError || input.lastSchedulerError),
      dependencies: normalizeDependencyHealth(input),
      providerContracts: normalizeProviderContracts(input, generatedAt),
      failureState: normalizeFailureState(input, generatedAt),
      lifecycleSettings,
      lifecycleCommandRequest
    },
    boundaryMode: VALID_BOUNDARY_MODES.has(mode) ? mode : 'strict',
    client: normalizeClientRuntime(input)
  };
}

function hasAllowedRole(roles) {
  for (const role of roles) {
    if (DEFAULT_ALLOWED_ROLES.has(role)) return true;
  }
  return false;
}

function hasCrossTenantRole(roles) {
  for (const role of roles) {
    if (CROSS_TENANT_ROLES.has(role)) return true;
  }
  return false;
}

function grantHasAction(grant, requiredAction) {
  if (!requiredAction) return false;
  return grant.actions.includes(requiredAction) || grant.actions.some((action) => WILDCARD_PERMISSION_ACTIONS.has(action));
}

function grantRoleBound(grant, actorRoles) {
  if (!grant.roles.length) return true;
  return grant.roles.some((role) => actorRoles.has(role));
}

function grantMatchesBoundary(grant, context, requiredAction, workspaceId, tenantId) {
  if (grant.expired) return false;
  if (!grantHasAction(grant, requiredAction)) return false;
  if (!grantRoleBound(grant, context.actor.roles)) return false;
  if (grant.tenantId && tenantId && grant.tenantId !== tenantId) return false;
  if (grant.workspaceId && workspaceId && grant.workspaceId !== workspaceId) return false;
  if (!grant.tenantId && !grant.workspaceId) return false;
  return true;
}

function evaluatePermissionGrants(context, workspaceId, tenantId) {
  const requiredAction = RESUME_INTENT_ACTIONS[context.client.intent] || RESUME_INTENT_ACTIONS.resume;
  const matchingGrants = context.actor.permissionGrants.filter((grant) => (
    grantMatchesBoundary(grant, context, requiredAction, workspaceId, tenantId)
  ));
  const expiredGrantIds = context.actor.permissionGrants
    .filter((grant) => grant.expired && grantHasAction(grant, requiredAction))
    .map((grant) => grant.grantId);
  const boundaryScoped = matchingGrants.some((grant) => grant.workspaceId === workspaceId || grant.tenantId === tenantId);
  const crossTenantDelegated = matchingGrants.some((grant) => grant.source === 'tenant-policy' || grant.source === 'operator-delegation');

  return {
    contract: 'scheduler.resume_policy.permission_grants.v1',
    requiredAction,
    authorized: matchingGrants.length > 0,
    boundaryScoped,
    crossTenantDelegated,
    matchingGrantIds: matchingGrants.map((grant) => grant.grantId),
    expiredGrantIds,
    grants: context.actor.permissionGrants
  };
}

function buildWorkspaceAccessScope(context, permission, workspaceId, tenantId) {
  const actorTenantId = context.actor.tenantId || null;
  const workspaceTenantId = context.workspace.tenantId || null;
  const requestTenantId = context.request.tenantId || workspaceTenantId || null;
  const effectiveTenantId = tenantId || requestTenantId || workspaceTenantId || null;
  const effectiveWorkspaceId = workspaceId || context.workspace.id || null;
  const actorWorkspaceIds = context.actor.workspaceIds;
  const memberOfWorkspace = Boolean(effectiveWorkspaceId && actorWorkspaceIds.includes(effectiveWorkspaceId));
  const tenantAligned = Boolean(actorTenantId && effectiveTenantId && actorTenantId === effectiveTenantId);
  const workspaceTenantAligned = Boolean(!requestTenantId || !workspaceTenantId || requestTenantId === workspaceTenantId);
  const matchingWorkspaceGrants = permission.grants.filter((grant) => (
    !grant.expired
    && grant.workspaceId
    && effectiveWorkspaceId
    && grant.workspaceId === effectiveWorkspaceId
    && grantHasAction(grant, permission.requiredAction)
    && grantRoleBound(grant, context.actor.roles)
  ));
  const matchingTenantGrants = permission.grants.filter((grant) => (
    !grant.expired
    && grant.tenantId
    && effectiveTenantId
    && grant.tenantId === effectiveTenantId
    && grantHasAction(grant, permission.requiredAction)
    && grantRoleBound(grant, context.actor.roles)
  ));
  const crossTenantDelegations = matchingTenantGrants.filter((grant) => (
    actorTenantId
    && effectiveTenantId
    && actorTenantId !== effectiveTenantId
    && (grant.source === 'tenant-policy' || grant.source === 'operator-delegation')
  ));
  const authority = [
    ...(memberOfWorkspace ? ['workspace-membership'] : []),
    ...(matchingWorkspaceGrants.length ? ['workspace-grant'] : []),
    ...(tenantAligned && matchingTenantGrants.length ? ['tenant-grant'] : []),
    ...(crossTenantDelegations.length ? ['cross-tenant-delegation'] : [])
  ].filter((entry) => WORKSPACE_SCOPE_AUTHORITY.has(entry));
  const findings = [];

  if (!effectiveWorkspaceId) {
    findings.push({ code: 'workspace_scope_target_missing', severity: 'deny', field: 'resumeRequest.workspaceId' });
  }
  if (!effectiveTenantId) {
    findings.push({ code: 'workspace_scope_tenant_missing', severity: 'deny', field: 'resumeRequest.tenantId' });
  }
  if (!workspaceTenantAligned) {
    findings.push({ code: 'workspace_scope_request_tenant_mismatch', severity: 'deny', field: 'resumeRequest.tenantId' });
  }
  if (effectiveWorkspaceId && actorWorkspaceIds.length && !memberOfWorkspace && matchingWorkspaceGrants.length === 0) {
    findings.push({ code: 'workspace_scope_membership_or_grant_missing', severity: 'deny', field: 'actor.workspaceIds' });
  }
  if (!actorWorkspaceIds.length && matchingWorkspaceGrants.length === 0) {
    findings.push({ code: 'workspace_scope_membership_unproven', severity: 'review', field: 'actor.workspaceIds' });
  }
  if (actorTenantId && effectiveTenantId && actorTenantId !== effectiveTenantId && crossTenantDelegations.length === 0) {
    findings.push({ code: 'workspace_scope_cross_tenant_delegation_missing', severity: 'deny', field: 'permissionGrants' });
  }
  if (matchingTenantGrants.length && !matchingWorkspaceGrants.length && !memberOfWorkspace) {
    findings.push({ code: 'workspace_scope_tenant_grant_without_workspace_membership', severity: 'review', field: 'permissionGrants.workspaceId' });
  }

  const denied = findings.some((finding) => finding.severity === 'deny');
  const reviewRequired = findings.some((finding) => finding.severity === 'review');
  return {
    contract: 'scheduler.resume_policy.workspace_access_scope.v1',
    effective: {
      tenantId: effectiveTenantId,
      workspaceId: effectiveWorkspaceId,
      boundaryMode: context.boundaryMode
    },
    actor: {
      actorId: context.actor.id,
      tenantId: actorTenantId,
      workspaceIds: actorWorkspaceIds,
      roles: Array.from(context.actor.roles)
    },
    request: {
      tenantId: requestTenantId,
      workspaceId: context.request.workspaceId || null,
      requestedBy: context.request.requestedBy,
      intent: context.client.intent,
      requiredAction: permission.requiredAction
    },
    membership: {
      memberOfWorkspace,
      tenantAligned,
      workspaceTenantAligned,
      authority,
      workspaceGrantIds: matchingWorkspaceGrants.map((grant) => grant.grantId),
      tenantGrantIds: matchingTenantGrants.map((grant) => grant.grantId),
      crossTenantDelegationGrantIds: crossTenantDelegations.map((grant) => grant.grantId)
    },
    decision: denied ? 'deny' : reviewRequired ? 'allow_with_review' : 'allow',
    findings,
    audit: {
      type: 'scheduler.resume_policy.workspace_access_scope',
      surfaceId,
      contract: 'scheduler.resume_policy.workspace_access_scope.v1',
      tenantId: effectiveTenantId,
      workspaceId: effectiveWorkspaceId,
      actorId: context.actor.id,
      requiredAction: permission.requiredAction,
      decision: denied ? 'deny' : reviewRequired ? 'allow_with_review' : 'allow',
      authority
    }
  };
}

function evaluateBoundary(context) {
  const findings = [];
  const scopes = [];
  const actorTenant = context.actor.tenantId;
  const workspaceTenant = context.workspace.tenantId;
  const requestTenant = context.request.tenantId || workspaceTenant;
  const workspaceId = context.request.workspaceId || context.workspace.id;
  const actorWorkspaceIds = context.actor.workspaceIds;
  const permission = evaluatePermissionGrants(context, workspaceId, requestTenant || workspaceTenant);
  const workspaceAccess = buildWorkspaceAccessScope(context, permission, workspaceId, requestTenant || workspaceTenant);
  findings.push(...workspaceAccess.findings);

  if (!actorTenant) findings.push({ code: 'missing_actor_tenant', severity: 'deny' });
  if (!workspaceTenant) findings.push({ code: 'missing_workspace_tenant', severity: 'deny' });
  if (!workspaceId) findings.push({ code: 'missing_workspace_id', severity: 'deny' });
  if (!hasAllowedRole(context.actor.roles) && !permission.authorized) {
    findings.push({ code: 'missing_resume_role_or_permission_grant', severity: 'deny', requiredAction: permission.requiredAction });
  } else if (!hasAllowedRole(context.actor.roles) && permission.authorized) {
    findings.push({ code: 'resume_authorized_by_permission_grant', severity: 'review', grantIds: permission.matchingGrantIds });
    scopes.push(`permission:${permission.requiredAction}`);
  }
  if (context.workspace.locked) findings.push({ code: 'workspace_locked', severity: 'deny' });
  if (context.workspace.suspended) findings.push({ code: 'workspace_suspended', severity: 'review' });
  if (permission.expiredGrantIds.length) {
    findings.push({ code: 'expired_permission_grants_ignored', severity: 'review', grantIds: permission.expiredGrantIds });
  }

  if (requestTenant && workspaceTenant && requestTenant !== workspaceTenant) {
    findings.push({ code: 'request_workspace_tenant_mismatch', severity: 'deny' });
  }

  if (actorTenant && workspaceTenant && actorTenant !== workspaceTenant) {
    if (
      context.boundaryMode === 'tenant'
      && (hasCrossTenantRole(context.actor.roles) || permission.crossTenantDelegated)
      && permission.boundaryScoped
    ) {
      findings.push({ code: 'cross_tenant_privileged_resume', severity: 'review' });
      scopes.push('tenant-delegated');
    } else {
      findings.push({ code: 'cross_tenant_resume_blocked', severity: 'deny' });
    }
  }

  if (workspaceId && actorWorkspaceIds.length && !actorWorkspaceIds.includes(workspaceId)) {
    if (context.boundaryMode === 'workspace' && permission.boundaryScoped) {
      findings.push({ code: 'workspace_scope_delegation_required', severity: 'review' });
      scopes.push('workspace-delegated');
    } else {
      findings.push({ code: 'actor_outside_workspace_scope', severity: 'deny' });
    }
  }

  if (!actorWorkspaceIds.length) {
    findings.push({ code: 'workspace_membership_unproven', severity: 'review' });
  } else if (workspaceId) {
    scopes.push(`workspace:${workspaceId}`);
  }

  if (workspaceTenant) scopes.push(`tenant:${workspaceTenant}`);

  const denied = findings.some((finding) => finding.severity === 'deny');
  const reviewRequired = findings.some((finding) => finding.severity === 'review');
  return {
    decision: denied ? 'deny' : reviewRequired ? 'allow_with_review' : 'allow',
    findings,
    scopes: Array.from(new Set(scopes)),
    permission,
    workspaceAccess
  };
}

function evaluateProviderCapabilities(context) {
  const requiredCapabilities = RESUME_PROVIDER_CAPABILITIES[context.client.intent] || RESUME_PROVIDER_CAPABILITIES.resume;
  const providers = context.scheduler.providerContracts;
  const providersByCapability = requiredCapabilities.reduce((index, capability) => {
    index[capability] = providers.filter((provider) => provider.capabilities.includes(capability));
    return index;
  }, {});
  const missingCapabilities = requiredCapabilities.filter((capability) => providersByCapability[capability].length === 0);
  const unavailableCapabilities = requiredCapabilities.filter((capability) => (
    providersByCapability[capability].length > 0
    && !providersByCapability[capability].some((provider) => HEALTHY_PROVIDER_STATUSES.has(provider.status))
  ));
  const staleCapabilities = requiredCapabilities.filter((capability) => (
    providersByCapability[capability].some((provider) => provider.sync.stale)
  ));
  const selectedProviders = requiredCapabilities.map((capability) => {
    const candidates = providersByCapability[capability] || [];
    const selected = candidates.find((provider) => HEALTHY_PROVIDER_STATUSES.has(provider.status) && !provider.sync.stale)
      || candidates.find((provider) => HEALTHY_PROVIDER_STATUSES.has(provider.status))
      || candidates[0]
      || null;
    return {
      capability,
      providerId: selected?.providerId || null,
      providerType: selected?.type || null,
      status: selected?.status || 'missing',
      syncRevision: selected?.sync.revision || 0,
      syncCursor: selected?.sync.cursor || null,
      stale: selected?.sync.stale || false,
      handoffStateId: selected?.handoff.externalStateId || null
    };
  });

  return {
    contract: 'scheduler.resume_policy.provider_capability_negotiation.v1',
    requiredCapabilities,
    providers,
    selectedProviders,
    missingCapabilities,
    unavailableCapabilities,
    staleCapabilities,
    ready: missingCapabilities.length === 0 && unavailableCapabilities.length === 0,
    degraded: staleCapabilities.length > 0 || providers.some((provider) => DEGRADED_PROVIDER_STATUSES.has(provider.status)),
    validationFindings: providers.flatMap((provider) => (
      provider.validation.map((finding) => ({
        ...finding,
        providerId: provider.providerId
      }))
    ))
  };
}

function retryAfterMs(context) {
  const attempt = Math.max(context.request.attempt, 0);
  const exponentialDelay = DEFAULT_RETRY_AFTER_MS * (2 ** attempt);
  const queueDelay = Math.min(context.scheduler.queueDepth * 250, 120000);
  const failureDelay = Math.min(context.scheduler.failureState.consecutiveFailures * 15000, 300000);
  const requestedDelay = Math.max(context.scheduler.failureState.retryAfterMs, failureDelay);
  return clampNumber(
    Math.max(exponentialDelay + queueDelay + failureDelay, requestedDelay),
    DEFAULT_RETRY_AFTER_MS,
    MAX_RETRY_AFTER_MS
  );
}

function buildActionableError(error, context, retryAllowed) {
  const retryAfterMsValue = retryAllowed ? retryAfterMs(context) : 0;
  const ownersByCode = {
    missing_run_id: 'client',
    lifecycle_settings_invalid: 'scheduler',
    lifecycle_command_request_invalid: 'operator',
    resume_policy_disabled: 'operator',
    resume_policy_paused: 'operator',
    schedule_delay_pending: 'scheduler',
    maintenance_window_inactive: 'scheduler',
    lifecycle_concurrency_saturated: 'scheduler',
    scheduler_not_accepting_resumes: 'scheduler',
    scheduler_failure_circuit_open: 'scheduler',
    required_dependency_unhealthy: 'platform',
    provider_capability_missing: 'platform',
    provider_capability_unavailable: 'platform',
    resume_retry_budget_exhausted: 'operator'
  };
  const nextActionsByCode = {
    missing_run_id: 'Populate resumeRequest.runId and resubmit the same resume request.',
    lifecycle_settings_invalid: 'Correct lifecycleSettings validation findings before evaluating resume dispatch.',
    lifecycle_command_request_invalid: 'Correct lifecycleCommandRequest before applying lifecycle controls.',
    resume_policy_disabled: 'Enable the resume policy or use an authorized manual override before dispatching.',
    resume_policy_paused: 'Resume the lifecycle policy or wait for drain/hold controls to clear.',
    schedule_delay_pending: 'Wait until lifecycleSettings.delay.until before enqueueing resume work.',
    maintenance_window_inactive: 'Wait for the configured maintenance window before scheduling this resume.',
    lifecycle_concurrency_saturated: 'Wait for an in-flight resume slot to become available.',
    scheduler_not_accepting_resumes: 'Wait for scheduler acceptingResumes=true before enqueueing.',
    scheduler_failure_circuit_open: 'Keep the resume blocked until the failure-state cooldown expires or an operator closes the circuit.',
    required_dependency_unhealthy: `Restore dependency ${error.dependency || 'unknown'} before dispatching.`,
    provider_capability_missing: `Register an integration provider for capability ${error.capability || 'unknown'}.`,
    provider_capability_unavailable: `Restore an integration provider for capability ${error.capability || 'unknown'} before dispatching.`,
    resume_retry_budget_exhausted: 'Escalate the failed resume state to operator review before another retry.'
  };

  return {
    contract: 'scheduler.resume_policy.actionable_error.v1',
    code: error.code,
    severity: error.severity || 'error',
    field: error.field || null,
    dependency: error.dependency || null,
    owner: ownersByCode[error.code] || 'scheduler',
    retryable: retryAllowed
      && error.code !== 'missing_run_id'
      && error.code !== 'resume_retry_budget_exhausted'
      && error.code !== 'lifecycle_settings_invalid'
      && error.code !== 'lifecycle_command_request_invalid'
      && error.code !== 'resume_policy_disabled'
      && error.code !== 'provider_capability_missing',
    retryAfterMs: retryAfterMsValue,
    nextAction: nextActionsByCode[error.code] || 'Inspect scheduler resume policy output for remediation details.',
    evidence: {
      resumeRequestId: context.request.id,
      runId: context.request.runId || null,
      attempt: context.request.attempt,
      maxAttempts: context.request.maxAttempts,
      schedulerState: context.scheduler.state,
      failureState: context.scheduler.failureState.status,
      failureReasonCode: context.scheduler.failureState.reasonCode || null,
      auditRef: context.scheduler.failureState.auditRef || null,
      providerCapability: error.capability || null,
      lifecycleCommand: context.scheduler.lifecycleSettings.command,
      lifecycleEnabled: context.scheduler.lifecycleSettings.enabled,
      scheduleMode: context.scheduler.lifecycleSettings.scheduleMode,
      scheduleDelayUntil: context.scheduler.lifecycleSettings.delay.until || null,
      lifecycleCommandRequest: context.scheduler.lifecycleCommandRequest.present
        ? {
            command: context.scheduler.lifecycleCommandRequest.command,
            scheduled: context.scheduler.lifecycleCommandRequest.scheduled,
            effectiveAt: context.scheduler.lifecycleCommandRequest.effectiveAt,
            idempotencyKey: context.scheduler.lifecycleCommandRequest.idempotencyKey || null
          }
        : null
    }
  };
}

function evaluateOperationalHealth(context, boundary, generatedAt) {
  const failures = [];
  const degraded = [];
  const actions = [];
  const retryable = [];
  const providerNegotiation = evaluateProviderCapabilities(context);
  const lifecycle = context.scheduler.lifecycleSettings;
  const lifecycleCommandRequest = context.scheduler.lifecycleCommandRequest;
  const parsedNowMs = Date.parse(generatedAt);
  const nowMs = Number.isFinite(parsedNowMs) ? parsedNowMs : Date.now();
  const delayUntilMs = lifecycle.delay.until ? Date.parse(lifecycle.delay.until) : 0;
  const availableSlots = Math.max(
    lifecycle.concurrency.maxInFlight - lifecycle.concurrency.reservedSlots,
    0
  );

  if (!context.request.runId) {
    failures.push({ code: 'missing_run_id', severity: 'error', field: 'resumeRequest.runId' });
    actions.push('Provide resumeRequest.runId before enqueueing resume work.');
  }

  if (!lifecycle.validation.valid) {
    failures.push({ code: 'lifecycle_settings_invalid', severity: 'error', field: 'lifecycleSettings' });
    actions.push('Fix lifecycleSettings validation errors before scheduling resume work.');
  }

  if (lifecycleCommandRequest.present && !lifecycleCommandRequest.validation.valid) {
    failures.push({ code: 'lifecycle_command_request_invalid', severity: 'error', field: 'lifecycleCommandRequest' });
    actions.push('Correct lifecycleCommandRequest validation errors before applying lifecycle controls.');
  } else if (lifecycleCommandRequest.present && lifecycleCommandRequest.scheduled) {
    degraded.push({
      code: 'lifecycle_command_scheduled',
      severity: 'warning',
      field: 'lifecycleCommandRequest.effectiveAt',
      command: lifecycleCommandRequest.command,
      effectiveAt: lifecycleCommandRequest.effectiveAt
    });
    actions.push(`Apply lifecycle command ${lifecycleCommandRequest.command} at ${lifecycleCommandRequest.effectiveAt}.`);
  }

  if (!lifecycle.enabled || lifecycle.command === 'disable' || lifecycle.command === 'cancel') {
    failures.push({
      code: 'resume_policy_disabled',
      severity: 'error',
      field: 'lifecycleSettings.enabled',
      reason: lifecycle.disabledReason || null
    });
    actions.push(lifecycle.allowManualOverride
      ? 'Require an authorized manual override before dispatching while resume policy is disabled.'
      : 'Enable lifecycleSettings.enabled before dispatching resume work.');
  } else if (lifecycle.command === 'pause' || lifecycle.command === 'hold' || (lifecycle.command === 'drain' && lifecycle.drainPolicy === 'reject_new')) {
    failures.push({
      code: 'resume_policy_paused',
      severity: 'error',
      field: 'lifecycleSettings.command',
      command: lifecycle.command,
      drainPolicy: lifecycle.drainPolicy
    });
    retryable.push('lifecycle_control');
    actions.push('Wait for lifecycle command resume/enable before accepting new resume work.');
  }

  if (lifecycle.scheduleMode === 'delayed' && delayUntilMs > nowMs) {
    failures.push({ code: 'schedule_delay_pending', severity: 'error', field: 'lifecycleSettings.delay.until', retryAt: lifecycle.delay.until });
    retryable.push('schedule_delay');
    actions.push(`Defer resume scheduling until ${lifecycle.delay.until}.`);
  } else if (lifecycle.scheduleMode === 'maintenance_window' && !lifecycle.maintenanceWindow.active) {
    failures.push({ code: 'maintenance_window_inactive', severity: 'error', field: 'lifecycleSettings.maintenanceWindow' });
    retryable.push('maintenance_window');
    actions.push('Wait for the configured lifecycle maintenance window before dispatching resume work.');
  } else if (lifecycle.scheduleMode === 'manual_review') {
    degraded.push({ code: 'manual_review_schedule_mode', severity: 'warning', field: 'lifecycleSettings.scheduleMode' });
    actions.push('Open operator review because lifecycleSettings.scheduleMode requires manual review.');
  }

  if (lifecycle.concurrency.currentInFlight >= availableSlots) {
    failures.push({
      code: 'lifecycle_concurrency_saturated',
      severity: 'error',
      field: 'lifecycleSettings.concurrency.currentInFlight',
      currentInFlight: lifecycle.concurrency.currentInFlight,
      availableSlots
    });
    retryable.push('lifecycle_capacity');
    actions.push('Wait for lifecycle resume concurrency to drop below the configured in-flight limit.');
  }

  if (!context.request.idempotencyKey) {
    degraded.push({ code: 'missing_idempotency_key', severity: 'warning', field: 'resumeRequest.idempotencyKey' });
    actions.push('Attach a stable idempotencyKey so duplicate resume attempts can be collapsed.');
  }

  if (!context.scheduler.acceptingResumes || context.scheduler.state === 'paused' || context.scheduler.state === 'draining') {
    failures.push({ code: 'scheduler_not_accepting_resumes', severity: 'error', field: 'scheduler.state' });
    retryable.push('scheduler_not_accepting_resumes');
    actions.push('Wait for the scheduler to leave paused/draining mode, then retry the same idempotency key.');
  } else if (context.scheduler.state !== 'ready') {
    degraded.push({ code: 'scheduler_state_degraded', severity: 'warning', field: 'scheduler.state', state: context.scheduler.state });
    actions.push('Route resume work through degraded-mode queue monitoring until scheduler.state returns to ready.');
  }

  if (context.scheduler.lastError) {
    degraded.push({ code: 'scheduler_recent_error', severity: 'warning', field: 'scheduler.lastError' });
    actions.push('Review scheduler.lastError before promoting this resume out of degraded-mode handling.');
  }

  if (context.scheduler.failureState.status === 'open' || context.scheduler.failureState.status === 'tripped') {
    failures.push({
      code: 'scheduler_failure_circuit_open',
      severity: 'error',
      field: 'scheduler.failureState.status',
      state: context.scheduler.failureState.status,
      reasonCode: context.scheduler.failureState.reasonCode || null
    });
    retryable.push('scheduler_failure_circuit_open');
    actions.push(context.scheduler.failureState.operatorAction || 'Wait for the scheduler failure circuit to close before dispatching resume work.');
  } else if (context.scheduler.failureState.status === 'half_open' || context.scheduler.failureState.status === 'recovering') {
    degraded.push({
      code: 'scheduler_failure_circuit_recovering',
      severity: 'warning',
      field: 'scheduler.failureState.status',
      state: context.scheduler.failureState.status,
      consecutiveFailures: context.scheduler.failureState.consecutiveFailures
    });
    actions.push('Route resume through degraded-mode handling while scheduler failure state is recovering.');
  }

  for (const dependency of context.scheduler.dependencies) {
    if (FAILED_DEPENDENCY_STATES.has(dependency.state) && dependency.required) {
      failures.push({ code: 'required_dependency_unhealthy', severity: 'error', dependency: dependency.name, state: dependency.state });
      retryable.push(`dependency:${dependency.name}`);
      actions.push(`Restore required dependency ${dependency.name} before dispatching this resume.`);
    } else if (DEGRADED_DEPENDENCY_STATES.has(dependency.state) || !HEALTHY_DEPENDENCY_STATES.has(dependency.state)) {
      degraded.push({ code: 'dependency_degraded', severity: 'warning', dependency: dependency.name, state: dependency.state });
      actions.push(`Monitor dependency ${dependency.name}; continue only with audit review if latency/error budgets are acceptable.`);
    }
  }

  for (const capability of providerNegotiation.missingCapabilities) {
    failures.push({ code: 'provider_capability_missing', severity: 'error', field: 'providerContracts.capabilities', capability });
    actions.push(`Register a scheduler integration provider for capability ${capability}.`);
  }

  for (const capability of providerNegotiation.unavailableCapabilities) {
    failures.push({ code: 'provider_capability_unavailable', severity: 'error', field: 'providerContracts.status', capability });
    retryable.push(`provider:${capability}`);
    actions.push(`Wait for a ready provider that can satisfy capability ${capability}.`);
  }

  if (providerNegotiation.degraded) {
    degraded.push({
      code: 'provider_contract_degraded',
      severity: 'warning',
      field: 'providerContracts',
      staleCapabilities: providerNegotiation.staleCapabilities,
      validationCodes: providerNegotiation.validationFindings.map((finding) => finding.code)
    });
    actions.push('Refresh provider sync metadata before promoting resume handoff to external systems.');
  }

  if (context.request.attempt >= context.request.maxAttempts) {
    failures.push({ code: 'resume_retry_budget_exhausted', severity: 'error', field: 'resumeRequest.retry.attempt' });
    actions.push('Escalate to operator review and clear the failed resume state before issuing another attempt.');
  }

  if (boundary.decision === 'deny') {
    actions.push('Resolve boundary findings before retrying; operational retry cannot override policy denial.');
  }

  const retryAllowed = boundary.decision !== 'deny'
    && failures.length > 0
    && retryable.length > 0
    && context.request.attempt < context.request.maxAttempts;
  const degradedMode = failures.length === 0 && degraded.length > 0;
  const actionableErrors = failures.map((error) => buildActionableError(error, context, retryAllowed));

  return {
    status: failures.length ? 'failed' : degradedMode ? 'degraded' : 'healthy',
    degradedMode,
    dispatchable: boundary.decision !== 'deny' && failures.length === 0,
    retry: {
      allowed: retryAllowed,
      attempt: context.request.attempt,
      maxAttempts: context.request.maxAttempts,
      retryAfterMs: retryAllowed ? retryAfterMs(context) : 0,
      retryable
    },
    errors: failures,
    warnings: degraded,
    actionableErrors,
    failureState: context.scheduler.failureState,
    providerNegotiation,
    actions: Array.from(new Set(actions))
  };
}

function workflowStateFor(context, boundary, operationalHealth) {
  if (boundary.decision === 'deny') return 'blocked';
  if (operationalHealth.errors.some((error) => error.code === 'lifecycle_command_request_invalid')) return 'lifecycle_command_invalid';
  if (operationalHealth.errors.some((error) => error.code === 'resume_policy_disabled' || error.code === 'lifecycle_settings_invalid')) return 'lifecycle_disabled';
  if (operationalHealth.errors.some((error) => error.code === 'resume_policy_paused')) return 'lifecycle_paused';
  if (operationalHealth.errors.some((error) => error.code === 'schedule_delay_pending' || error.code === 'maintenance_window_inactive')) return 'scheduled_wait';
  if (operationalHealth.errors.some((error) => error.code === 'lifecycle_concurrency_saturated')) return 'capacity_wait';
  if (operationalHealth.retry.allowed) return 'retry_scheduled';
  if (!operationalHealth.dispatchable) return 'waiting_on_scheduler';
  if (operationalHealth.warnings.some((warning) => warning.code === 'manual_review_schedule_mode')) return 'review_required';
  if (boundary.decision === 'allow_with_review') return 'review_required';
  if ((context.client.acknowledgement.required || context.scheduler.lifecycleSettings.requireAckBeforeDispatch) && !context.client.acknowledgement.receivedAt) return 'awaiting_client_ack';
  return 'ready_to_dispatch';
}

function lifecycleCommandAllowed(command, context, boundary, operationalHealth) {
  const lifecycle = context.scheduler.lifecycleSettings;
  if (!lifecycle.validation.valid && command !== 'disable') return false;
  if (boundary.decision === 'deny') return false;
  if ((command === 'enable' || command === 'resume') && lifecycle.enabled && lifecycle.command === 'resume') return false;
  if (command === 'disable' && !lifecycle.enabled) return false;
  if (command === 'pause' && (!lifecycle.enabled || lifecycle.command === 'pause')) return false;
  if (command === 'hold' && (!lifecycle.enabled || lifecycle.command === 'hold')) return false;
  if (command === 'drain' && (!lifecycle.enabled || lifecycle.command === 'drain')) return false;
  if (command === 'cancel' && operationalHealth.dispatchable) return false;
  return true;
}

function buildLifecycleCommandControls(context, boundary, operationalHealth, workflowState, generatedAt) {
  const lifecycle = context.scheduler.lifecycleSettings;
  const commandRequest = context.scheduler.lifecycleCommandRequest;
  const requestedCommand = lifecycle.command;
  const actorCanManage = hasAllowedRole(context.actor.roles) || boundary.permission.authorized;
  const blockingCodes = [
    ...boundary.findings.filter((finding) => finding.severity === 'deny').map((finding) => finding.code),
    ...operationalHealth.errors.map((error) => error.code),
    ...lifecycle.validation.findings.filter((finding) => finding.severity === 'error').map((finding) => finding.code),
    ...commandRequest.validation.findings.filter((finding) => finding.severity === 'error').map((finding) => finding.code)
  ];
  const commandOrder = ['enable', 'resume', 'pause', 'hold', 'drain', 'disable', 'cancel'];
  const controlRows = commandOrder.map((command) => {
    const allowedByState = lifecycleCommandAllowed(command, context, boundary, operationalHealth);
    const enabled = actorCanManage && allowedByState;
    return {
      command,
      commandType: LIFECYCLE_COMMAND_TYPES[command],
      enabled,
      selected: command === requestedCommand,
      disabledReason: enabled
        ? null
        : !actorCanManage
          ? 'actor_not_authorized_for_lifecycle_command'
          : boundary.decision === 'deny'
            ? 'policy_boundary_denied'
            : !lifecycle.validation.valid && command !== 'disable'
              ? 'lifecycle_settings_invalid'
              : command === 'cancel' && operationalHealth.dispatchable
                ? 'resume_already_dispatchable'
                : 'command_not_applicable_to_current_lifecycle_state'
    };
  });
  const requestedControl = commandRequest.command
    ? controlRows.find((control) => control.command === commandRequest.command)
    : null;
  const recommendedCommand = commandRequest.present && commandRequest.command && commandRequest.validation.valid
    ? commandRequest.command
    : workflowState === 'lifecycle_disabled'
    ? 'enable'
    : workflowState === 'lifecycle_paused'
      ? 'resume'
      : workflowState === 'ready_to_dispatch'
        ? 'pause'
        : workflowState === 'blocked'
          ? 'cancel'
          : requestedCommand;
  const recommendedControl = controlRows.find((control) => control.command === recommendedCommand);
  const schedulePatch = {
    scheduleMode: lifecycle.scheduleMode,
    delayUntil: lifecycle.delay.until || null,
    delayMs: lifecycle.delay.effectiveMs,
    maintenanceWindow: lifecycle.maintenanceWindow,
    concurrency: lifecycle.concurrency,
    drainPolicy: lifecycle.drainPolicy
  };
  const desiredPatch = commandRequest.present && commandRequest.validation.valid
    ? lifecyclePatchForCommand(lifecycle, commandRequest)
    : null;
  const commandApplyBlocked = [
    ...blockingCodes,
    ...(commandRequest.present && !commandRequest.idempotencyKey ? ['lifecycle_command_idempotency_key_missing'] : []),
    ...(commandRequest.present && !requestedControl?.enabled ? [requestedControl?.disabledReason || 'lifecycle_command_control_disabled'] : [])
  ].filter(Boolean);
  const mutationApplyMode = !commandRequest.present
    ? 'none'
    : commandRequest.dryRun
      ? 'preview'
      : commandRequest.scheduled
        ? 'schedule'
        : 'apply';
  const mutationCanApply = commandRequest.present
    && commandRequest.validation.valid
    && actorCanManage
    && Boolean(requestedControl?.enabled)
    && commandApplyBlocked.length === 0;
  const commandMutation = {
    contract: 'scheduler.resume_policy.lifecycle_command_mutation.v1',
    present: commandRequest.present,
    dryRun: commandRequest.dryRun,
    command: commandRequest.command || null,
    commandType: commandRequest.commandType,
    idempotencyKey: commandRequest.idempotencyKey || null,
    requestedBy: commandRequest.requestedBy,
    effectiveAt: commandRequest.effectiveAt,
    scheduled: commandRequest.scheduled,
    canApply: mutationCanApply,
    applyMode: mutationApplyMode,
    blockedBy: Array.from(new Set(commandApplyBlocked)),
    desiredPatch,
    audit: {
      type: 'scheduler.resume_policy.lifecycle_command_mutation',
      surfaceId,
      contract: 'scheduler.resume_policy.lifecycle_command_mutation.v1',
      generatedAt,
      command: commandRequest.command || null,
      applyMode: mutationApplyMode,
      canApply: mutationCanApply,
      blockedCount: commandApplyBlocked.length
    }
  };

  return {
    contract: 'scheduler.resume_policy.lifecycle_command_controls.v1',
    generatedAt,
    requestedCommand,
    recommendedCommand,
    actorCanManage,
    enabled: lifecycle.enabled,
    workflowState,
    controls: controlRows,
    commandRequest,
    commandMutation,
    nextCommand: {
      command: recommendedCommand,
      commandType: LIFECYCLE_COMMAND_TYPES[recommendedCommand],
      enabled: Boolean(recommendedControl?.enabled),
      reason: recommendedControl?.disabledReason || null
    },
    schedulePatch,
    proof: {
      required: [
        'actor-lifecycle-authority',
        'tenant-boundary',
        'workspace-boundary',
        ...(lifecycle.validation.valid ? [] : ['lifecycle-validation']),
        ...(commandRequest.present ? ['lifecycle-command-request'] : []),
        ...(lifecycle.allowManualOverride ? ['manual-override'] : [])
      ],
      blockingCodes: Array.from(new Set(blockingCodes)),
      lifecycleFindingCodes: [
        ...lifecycle.validation.findings.map((finding) => finding.code),
        ...commandRequest.validation.findings.map((finding) => finding.code)
      ],
      permissionGrantIds: boundary.permission.matchingGrantIds,
      scopes: boundary.scopes
    },
    auditExport: {
      type: 'scheduler.resume_policy.lifecycle_command_controls',
      surfaceId,
      contract: 'scheduler.resume_policy.lifecycle_command_controls.v1',
      generatedAt,
      requestedCommand,
      recommendedCommand,
      actorCanManage,
      enabledControlCount: controlRows.filter((control) => control.enabled).length,
      blockingCount: blockingCodes.length,
      commandRequestPresent: commandRequest.present,
      commandMutationCanApply: commandMutation.canApply
    }
  };
}

function buildClientStateSync(context, boundary, operationalHealth, workflowState, nextAction, lifecycleCommandControls, generatedAt) {
  const observedAtMs = context.client.stateObservedAt ? Date.parse(context.client.stateObservedAt) : 0;
  const generatedAtMs = Date.parse(generatedAt);
  const nowMs = Number.isFinite(generatedAtMs) ? generatedAtMs : Date.now();
  const stateAgeMs = observedAtMs ? Math.max(nowMs - observedAtMs, 0) : null;
  const conflicts = [];

  if (!context.client.requestStateId) {
    conflicts.push({ code: 'client_state_id_missing', severity: 'warning', field: 'client.requestStateId' });
  }
  if (!context.client.stateObservedAt) {
    conflicts.push({ code: 'client_state_observed_at_missing', severity: 'warning', field: 'client.requestState.observedAt' });
  } else if (stateAgeMs > MAX_CLIENT_STATE_AGE_MS) {
    conflicts.push({ code: 'client_state_stale', severity: 'warning', field: 'client.requestState.observedAt', ageMs: stateAgeMs });
  }
  if (context.client.lastKnownWorkflowState && context.client.lastKnownWorkflowState !== workflowState) {
    conflicts.push({
      code: 'client_workflow_state_out_of_sync',
      severity: 'warning',
      field: 'client.requestState.workflowState',
      clientValue: context.client.lastKnownWorkflowState,
      kernelValue: workflowState
    });
  }
  if (context.client.lastKnownNextAction && context.client.lastKnownNextAction !== nextAction) {
    conflicts.push({
      code: 'client_next_action_out_of_sync',
      severity: 'warning',
      field: 'client.requestState.nextAction',
      clientValue: context.client.lastKnownNextAction,
      kernelValue: nextAction
    });
  }
  if (context.client.status === 'accepted' && !operationalHealth.dispatchable) {
    conflicts.push({ code: 'client_accepted_non_dispatchable_resume', severity: 'error', field: 'client.requestState.status' });
  }
  if (context.client.status === 'acknowledged' && context.client.acknowledgement.required && !context.client.acknowledgement.receivedAt) {
    conflicts.push({ code: 'client_ack_status_without_ack_timestamp', severity: 'error', field: 'client.acknowledgement.receivedAt' });
  }

  const blocking = conflicts.filter((conflict) => conflict.severity === 'error').map((conflict) => conflict.code);
  const refreshRequired = conflicts.length > 0 || context.client.status === 'stale';
  const stateId = context.client.requestStateId || `${context.request.id}:${workflowState}`;
  const nextRevision = context.client.stateRevision + 1;

  return {
    contract: 'scheduler.resume_policy.client_state_sync.v1',
    generatedAt,
    stateId,
    previousRevision: context.client.stateRevision,
    nextRevision,
    refreshRequired,
    blocking,
    conflicts,
    patch: {
      op: context.client.requestStateId ? 'replace' : 'create',
      stateId,
      revision: nextRevision,
      observedAt: generatedAt,
      workflowState,
      nextAction,
      status: blocking.length
        ? 'blocked'
        : workflowState === 'ready_to_dispatch'
          ? 'accepted'
          : workflowState === 'review_required'
            ? 'reviewing'
            : workflowState === 'blocked'
              ? 'blocked'
              : 'previewing',
      routeName: `scheduler.resume.${nextAction}`,
      lifecycleRecommendedCommand: lifecycleCommandControls.recommendedCommand
    },
    userHandoff: {
      title: blocking.length
        ? 'Resume state changed'
        : refreshRequired
          ? 'Refresh resume state'
          : 'Resume state current',
      primaryAction: blocking.length
        ? 'reload_resume_policy'
        : nextAction,
      secondaryAction: lifecycleCommandControls.nextCommand.enabled
        ? lifecycleCommandControls.nextCommand.command
        : null,
      visibleConflictCodes: conflicts.map((conflict) => conflict.code)
    },
    proof: {
      required: [
        'client-state-id',
        'client-state-revision',
        'kernel-workflow-state',
        ...(context.client.acknowledgement.required ? ['client-acknowledgement'] : [])
      ],
      blockingCodes: blocking,
      conflictCodes: conflicts.map((conflict) => conflict.code),
      scopes: boundary.scopes
    },
    auditExport: {
      type: 'scheduler.resume_policy.client_state_sync',
      surfaceId,
      contract: 'scheduler.resume_policy.client_state_sync.v1',
      generatedAt,
      stateId,
      refreshRequired,
      conflictCount: conflicts.length,
      blockingCount: blocking.length,
      workflowState,
      nextAction
    }
  };
}

function buildClientWorkflowHandoff(context, boundary, operationalHealth, generatedAt) {
  const workflowState = workflowStateFor(context, boundary, operationalHealth);
  const lifecycleCommandControls = buildLifecycleCommandControls(context, boundary, operationalHealth, workflowState, generatedAt);
  const blocked = workflowState === 'blocked';
  const reviewRequired = workflowState === 'review_required' || boundary.decision === 'allow_with_review';
  const canDispatch = operationalHealth.dispatchable
    && !blocked
    && workflowState !== 'waiting_on_scheduler'
    && workflowState !== 'awaiting_client_ack';
  const nextAction = blocked
    ? 'show_policy_blocked'
    : workflowState === 'lifecycle_command_invalid'
      ? 'correct_lifecycle_command'
    : workflowState === 'lifecycle_disabled'
      ? 'enable_resume_policy'
      : workflowState === 'lifecycle_paused'
        ? 'wait_for_lifecycle_resume'
        : workflowState === 'scheduled_wait'
          ? 'wait_until_scheduled'
          : workflowState === 'capacity_wait'
            ? 'wait_for_capacity'
            : operationalHealth.retry.allowed
              ? 'schedule_retry'
              : workflowState === 'awaiting_client_ack'
                ? 'request_client_acknowledgement'
                : reviewRequired
                  ? 'open_operator_review'
                  : canDispatch
                    ? 'enqueue_resume'
                    : 'show_scheduler_wait';
  const clientStateSync = buildClientStateSync(context, boundary, operationalHealth, workflowState, nextAction, lifecycleCommandControls, generatedAt);
  const routeParams = {
    resumeRequestId: context.request.id,
    runId: context.request.runId || null,
    workspaceId: context.request.workspaceId || context.workspace.id || null,
    tenantId: context.request.tenantId || context.workspace.tenantId || null
  };

  return {
    contract: 'scheduler.resume_policy.client_handoff.v1',
    generatedAt,
    stateId: clientStateSync.stateId,
    sessionId: context.client.sessionId || null,
    channel: context.client.channel,
    view: context.client.view,
    intent: context.client.intent,
    workflowState,
    nextAction,
    clientStateSync,
    dispatch: {
      allowed: canDispatch,
      optimistic: canDispatch && context.client.optimisticDispatch,
      queue: reviewRequired ? 'resume-review' : 'resume-dispatch',
      idempotencyKey: context.request.idempotencyKey || null
    },
    retry: operationalHealth.retry,
    review: {
      required: reviewRequired,
      reasonCodes: [
        ...boundary.findings.filter((finding) => finding.severity === 'review').map((finding) => finding.code),
        ...operationalHealth.warnings.map((warning) => warning.code)
      ]
    },
    acknowledgement: {
      ...context.client.acknowledgement,
      required: context.client.acknowledgement.required || context.scheduler.lifecycleSettings.requireAckBeforeDispatch
    },
    lifecycle: {
      contract: context.scheduler.lifecycleSettings.contract,
      enabled: context.scheduler.lifecycleSettings.enabled,
      command: context.scheduler.lifecycleSettings.command,
      scheduleMode: context.scheduler.lifecycleSettings.scheduleMode,
      delayUntil: context.scheduler.lifecycleSettings.delay.until || null,
      validation: context.scheduler.lifecycleSettings.validation,
      commandRequest: lifecycleCommandControls.commandRequest,
      commandMutation: lifecycleCommandControls.commandMutation,
      commandControls: lifecycleCommandControls
    },
    route: {
      name: `scheduler.resume.${nextAction}`,
      params: routeParams,
      returnTo: context.client.returnTo || null
    },
    visibleSignals: context.client.visibleSignals.reduce((signals, signal) => {
      if (signal === 'decision') signals.decision = boundary.decision;
      if (signal === 'healthStatus') signals.healthStatus = operationalHealth.status;
      if (signal === 'retry') signals.retryAllowed = operationalHealth.retry.allowed;
      if (signal === 'findings') signals.findings = boundary.findings.map((finding) => finding.code);
      if (signal === 'actions') signals.actions = operationalHealth.actions;
      if (signal === 'clientState') {
        signals.clientState = {
          refreshRequired: clientStateSync.refreshRequired,
          revision: clientStateSync.nextRevision,
          status: clientStateSync.patch.status,
          conflictCodes: clientStateSync.proof.conflictCodes
        };
      }
      if (signal === 'lifecycle') {
        signals.lifecycle = {
          enabled: context.scheduler.lifecycleSettings.enabled,
          command: context.scheduler.lifecycleSettings.command,
          scheduleMode: context.scheduler.lifecycleSettings.scheduleMode,
          delayUntil: context.scheduler.lifecycleSettings.delay.until || null,
          recommendedCommand: lifecycleCommandControls.recommendedCommand,
          commandRequestPresent: lifecycleCommandControls.commandRequest.present,
          commandMutationCanApply: lifecycleCommandControls.commandMutation.canApply,
          commandMutationApplyMode: lifecycleCommandControls.commandMutation.applyMode,
          enabledControlCount: lifecycleCommandControls.controls.filter((control) => control.enabled).length
        };
      }
      return signals;
    }, {})
  };
}

function normalizePreviewAcceptanceRequest(input, context, clientHandoff, generatedAt) {
  const client = asRecord(input.client || input.clientRuntime || input.runtimeClient);
  const resumeRequest = asRecord(input.resumeRequest || input.request);
  const source = asRecord(
    input.previewAcceptanceRequest
      || input.acceptanceRequest
      || resumeRequest.previewAcceptanceRequest
      || resumeRequest.acceptanceRequest
      || client.previewAcceptanceRequest
      || client.acceptanceRequest
  );
  const action = asText(source.action || source.decision || source.status).toLowerCase();
  const requestedAt = normalizeTimestamp(source.requestedAt || source.acceptedAt || source.createdAt || source.submittedAt, '');
  const requestedAtMs = requestedAt ? Date.parse(requestedAt) : 0;
  const generatedAtMs = Date.parse(generatedAt);
  const ageMs = requestedAtMs && Number.isFinite(requestedAtMs) && Number.isFinite(generatedAtMs)
    ? Math.max(generatedAtMs - requestedAtMs, 0)
    : null;
  const previewId = `${context.request.id}:${clientHandoff.workflowState}:preview`;
  const expectedRevision = clientHandoff.clientStateSync.nextRevision;
  const stateRevision = clampNumber(asNumber(source.stateRevision, asNumber(source.revision, 0)), 0, 1000000);
  const validationFindings = [];
  const normalizedAction = VALID_PREVIEW_ACCEPTANCE_ACTIONS.has(action) ? action : '';

  if (!action) {
    validationFindings.push({ code: 'preview_acceptance_request_missing', severity: 'info', field: 'previewAcceptanceRequest.action' });
  } else if (!normalizedAction) {
    validationFindings.push({ code: 'preview_acceptance_action_invalid', severity: 'error', field: 'previewAcceptanceRequest.action', value: action });
  }
  if (normalizedAction === 'accept' && !asText(source.idempotencyKey || source.acceptanceKey || context.request.idempotencyKey)) {
    validationFindings.push({ code: 'preview_acceptance_idempotency_key_missing', severity: 'error', field: 'previewAcceptanceRequest.idempotencyKey' });
  }
  if (normalizedAction === 'reject' && !asText(source.reason || source.justification)) {
    validationFindings.push({ code: 'preview_rejection_reason_required', severity: 'error', field: 'previewAcceptanceRequest.reason' });
  }
  if (asText(source.previewId) && source.previewId !== previewId) {
    validationFindings.push({ code: 'preview_acceptance_preview_id_mismatch', severity: 'error', field: 'previewAcceptanceRequest.previewId' });
  }
  if (asText(source.stateId) && source.stateId !== clientHandoff.stateId) {
    validationFindings.push({ code: 'preview_acceptance_state_id_mismatch', severity: 'error', field: 'previewAcceptanceRequest.stateId' });
  }
  if (stateRevision && stateRevision !== expectedRevision) {
    validationFindings.push({
      code: 'preview_acceptance_revision_mismatch',
      severity: 'error',
      field: 'previewAcceptanceRequest.stateRevision',
      expectedRevision,
      stateRevision
    });
  }
  if (!requestedAt && normalizedAction) {
    validationFindings.push({ code: 'preview_acceptance_requested_at_missing', severity: 'warning', field: 'previewAcceptanceRequest.requestedAt' });
  } else if (ageMs !== null && ageMs > MAX_PREVIEW_ACCEPTANCE_AGE_MS) {
    validationFindings.push({ code: 'preview_acceptance_request_stale', severity: 'error', field: 'previewAcceptanceRequest.requestedAt', ageMs });
  }
  if (clientHandoff.acknowledgement.required && !clientHandoff.acknowledgement.receivedAt && normalizedAction === 'accept') {
    validationFindings.push({ code: 'preview_acceptance_acknowledgement_missing', severity: 'error', field: 'client.acknowledgement.receivedAt' });
  }

  return {
    contract: 'scheduler.resume_policy.preview_acceptance_request.v1',
    present: Boolean(action),
    action: normalizedAction,
    requestedBy: asText(source.requestedBy || source.actorId || context.actor.id, context.actor.id),
    requestedAt: requestedAt || generatedAt,
    reason: asText(source.reason || source.justification),
    previewId: asText(source.previewId, previewId),
    stateId: asText(source.stateId, clientHandoff.stateId),
    stateRevision,
    expectedRevision,
    idempotencyKey: asText(source.idempotencyKey || source.acceptanceKey || context.request.idempotencyKey),
    token: asText(source.token || source.acceptanceToken || clientHandoff.acknowledgement.token),
    routeName: asText(source.routeName, clientHandoff.route.name),
    ageMs,
    validation: {
      valid: !validationFindings.some((finding) => finding.severity === 'error'),
      findings: validationFindings
    }
  };
}

function buildResumePreviewAcceptance(context, boundary, operationalHealth, clientHandoff, generatedAt, input = {}) {
  const acceptanceRequest = normalizePreviewAcceptanceRequest(input, context, clientHandoff, generatedAt);
  return buildResumePreviewAcceptanceFromRequest(context, boundary, operationalHealth, clientHandoff, generatedAt, acceptanceRequest);
}

function buildResumePreviewAcceptanceFromRequest(context, boundary, operationalHealth, clientHandoff, generatedAt, acceptanceRequest) {
  const lifecycleValidation = context.scheduler.lifecycleSettings.validation;
  const clientStateConflicts = clientHandoff.clientStateSync.conflicts;
  const boundaryReviewCodes = boundary.findings
    .filter((finding) => finding.severity === 'review')
    .map((finding) => finding.code);
  const boundaryDenyCodes = boundary.findings
    .filter((finding) => finding.severity === 'deny')
    .map((finding) => finding.code);
  const validationFindings = [
    ...lifecycleValidation.findings.map((finding) => ({
      source: 'lifecycle',
      code: finding.code,
      severity: finding.severity,
      field: finding.field || null
    })),
    ...boundary.findings.map((finding) => ({
      source: 'boundary',
      code: finding.code,
      severity: finding.severity === 'deny' ? 'error' : 'warning',
      field: finding.field || null
    })),
    ...operationalHealth.errors.map((error) => ({
      source: 'operational',
      code: error.code,
      severity: 'error',
      field: error.field || null
    })),
    ...operationalHealth.warnings.map((warning) => ({
      source: 'operational',
      code: warning.code,
      severity: 'warning',
      field: warning.field || null
    })),
    ...clientStateConflicts.map((conflict) => ({
      source: 'client_state',
      code: conflict.code,
      severity: conflict.severity === 'error' ? 'error' : 'warning',
      field: conflict.field || null
    })),
    ...acceptanceRequest.validation.findings.map((finding) => ({
      source: 'acceptance_request',
      code: finding.code,
      severity: finding.severity === 'error' ? 'error' : finding.severity,
      field: finding.field || null
    }))
  ];
  const blockingCodes = validationFindings
    .filter((finding) => finding.severity === 'error')
    .map((finding) => finding.code);
  const warningCodes = validationFindings
    .filter((finding) => finding.severity !== 'error')
    .map((finding) => finding.code);
  const acknowledgementRequired = clientHandoff.acknowledgement.required && !clientHandoff.acknowledgement.receivedAt;
  const acceptanceAvailable = clientHandoff.dispatch.allowed
    && blockingCodes.length === 0
    && !acknowledgementRequired
    && !clientHandoff.review.required;
  const accepted = acceptanceAvailable
    && acceptanceRequest.present
    && acceptanceRequest.action === 'accept'
    && acceptanceRequest.validation.valid;
  const rejected = acceptanceRequest.present && acceptanceRequest.action === 'reject' && acceptanceRequest.validation.valid;
  const deferred = acceptanceRequest.present && acceptanceRequest.action === 'defer' && acceptanceRequest.validation.valid;
  const reviewRequested = acceptanceRequest.present && acceptanceRequest.action === 'request_review' && acceptanceRequest.validation.valid;
  const ready = {
    preview: boundary.decision !== 'deny',
    acceptance: acceptanceAvailable,
    dispatch: clientHandoff.dispatch.allowed && !acknowledgementRequired,
    audit: Boolean(context.actor.id && (context.request.workspaceId || context.workspace.id)),
    retry: operationalHealth.retry.allowed
  };
  const nextStep = rejected
    ? {
        action: 'persist_preview_rejection',
        label: 'Save rejection reason and keep resume blocked',
        routeName: 'scheduler.resume.preview.reject',
        owner: 'client'
      }
    : deferred
      ? {
          action: 'defer_preview_acceptance',
          label: 'Keep preview open until acceptance is submitted',
          routeName: 'scheduler.resume.preview.defer',
          owner: 'client'
        }
      : reviewRequested
        ? {
            action: 'open_operator_review',
            label: 'Open operator review from preview acceptance request',
            routeName: 'scheduler.resume.open_operator_review',
            owner: 'operator'
          }
        : accepted
    ? {
        action: 'accept_and_enqueue_resume',
        label: 'Accept preview and enqueue resume',
        routeName: clientHandoff.route.name,
        owner: 'scheduler'
      }
    : acknowledgementRequired
      ? {
          action: 'collect_acknowledgement',
          label: 'Collect client acknowledgement before accepting resume',
          routeName: 'scheduler.resume.request_client_acknowledgement',
          owner: 'client'
        }
      : clientHandoff.nextAction === 'open_operator_review'
        ? {
            action: 'open_operator_review',
            label: 'Open operator review with validation summary',
            routeName: clientHandoff.route.name,
            owner: 'operator'
          }
        : acceptanceAvailable
          ? {
              action: 'submit_preview_acceptance',
              label: 'Submit preview acceptance to enqueue resume',
              routeName: 'scheduler.resume.preview.accept',
              owner: 'client'
            }
        : {
            action: clientHandoff.nextAction,
            label: operationalHealth.actions[0] || 'Review resume policy state before accepting resume',
            routeName: clientHandoff.route.name,
            owner: operationalHealth.actionableErrors[0]?.owner || 'scheduler'
          };

  return {
    contract: 'scheduler.resume_policy.preview_acceptance.v1',
    generatedAt,
    previewId: `${context.request.id}:${clientHandoff.workflowState}:preview`,
    stateId: clientHandoff.stateId,
    display: {
      title: accepted ? 'Resume ready to accept' : 'Resume requires attention',
      status: accepted ? 'ready' : rejected ? 'rejected' : blockingCodes.length ? 'blocked' : 'needs_review',
      summary: {
        decision: boundary.decision,
        healthStatus: operationalHealth.status,
        workflowState: clientHandoff.workflowState,
        nextAction: clientHandoff.nextAction
      }
    },
    readiness: ready,
    acceptance: {
      accepted,
      rejected,
      deferred,
      reviewRequested,
      available: acceptanceAvailable,
      required: clientHandoff.dispatch.allowed || clientHandoff.review.required || acknowledgementRequired,
      acknowledgementRequired,
      reviewRequired: clientHandoff.review.required,
      dispatchQueue: clientHandoff.dispatch.queue,
      idempotencyKey: clientHandoff.dispatch.idempotencyKey,
      token: clientHandoff.acknowledgement.token || null,
      request: acceptanceRequest
    },
    validationSummary: {
      valid: blockingCodes.length === 0,
      totalFindings: validationFindings.length,
      blockingCodes,
      warningCodes,
      boundaryDenyCodes,
      boundaryReviewCodes,
      lifecycleValid: lifecycleValidation.valid,
      retryableCodes: operationalHealth.retry.retryable
    },
    nextStep,
    mutation: {
      contract: 'scheduler.resume_policy.preview_acceptance_mutation.v1',
      op: accepted
        ? 'accept'
        : rejected
          ? 'reject'
          : deferred
            ? 'defer'
            : reviewRequested
              ? 'request_review'
              : 'none',
      canApply: acceptanceRequest.present && acceptanceRequest.validation.valid && (accepted || rejected || deferred || reviewRequested),
      blockedBy: Array.from(new Set(blockingCodes)),
      patch: {
        previewId: acceptanceRequest.previewId,
        stateId: acceptanceRequest.stateId,
        stateRevision: acceptanceRequest.expectedRevision,
        status: accepted
          ? 'accepted'
          : rejected
            ? 'blocked'
            : reviewRequested
              ? 'reviewing'
              : 'previewing',
        acceptedAt: accepted ? acceptanceRequest.requestedAt : null,
        requestedBy: acceptanceRequest.requestedBy,
        reason: acceptanceRequest.reason || null,
        routeName: nextStep.routeName
      },
      audit: {
        type: 'scheduler.resume_policy.preview_acceptance_mutation',
        surfaceId,
        contract: 'scheduler.resume_policy.preview_acceptance_mutation.v1',
        generatedAt,
        previewId: acceptanceRequest.previewId,
        action: acceptanceRequest.action || null,
        canApply: acceptanceRequest.present && acceptanceRequest.validation.valid && (accepted || rejected || deferred || reviewRequested),
        blockingCount: blockingCodes.length
      }
    },
    route: {
      ...clientHandoff.route,
      acceptanceState: accepted
        ? 'accepted'
        : rejected
          ? 'rejected'
          : reviewRequested
            ? 'review_requested'
            : deferred
              ? 'deferred'
              : 'pending'
    },
    explanation: [
      ...blockingCodes.map((code) => `Blocked by ${code}.`),
      ...warningCodes.slice(0, 5).map((code) => `Review ${code}.`),
      accepted ? 'All required scheduler resume checks are ready for dispatch.' : ''
    ].filter(Boolean)
  };
}

function buildAuditHandoff(context, boundary, operationalHealth, generatedAt, clientHandoff, previewAcceptance) {
  const effectiveClientHandoff = clientHandoff || buildClientWorkflowHandoff(context, boundary, operationalHealth, generatedAt);
  const effectivePreviewAcceptance = previewAcceptance || buildResumePreviewAcceptance(context, boundary, operationalHealth, effectiveClientHandoff, generatedAt);
  return {
    type: 'scheduler.resume_policy.audit_handoff',
    generatedAt,
    actorId: context.actor.id,
    tenantId: context.workspace.tenantId || context.request.tenantId || null,
    workspaceId: context.request.workspaceId || context.workspace.id || null,
    resumeRequestId: context.request.id,
    runId: context.request.runId || null,
    decision: boundary.decision,
    healthStatus: operationalHealth.status,
    dispatchable: operationalHealth.dispatchable,
    retryAllowed: operationalHealth.retry.allowed,
    retryAfterMs: operationalHealth.retry.retryAfterMs,
    reason: context.request.reason,
    requiredProof: boundary.decision === 'deny'
      ? ['actor-role', 'tenant-boundary', 'workspace-boundary', 'workspace-access-scope']
      : ['actor-role', 'tenant-boundary', 'workspace-access-scope'],
    findings: boundary.findings.map((finding) => finding.code),
    permission: {
      contract: boundary.permission.contract,
      requiredAction: boundary.permission.requiredAction,
      authorized: boundary.permission.authorized,
      matchingGrantIds: boundary.permission.matchingGrantIds,
      expiredGrantIds: boundary.permission.expiredGrantIds
    },
    workspaceAccess: {
      contract: boundary.workspaceAccess.contract,
      decision: boundary.workspaceAccess.decision,
      effective: boundary.workspaceAccess.effective,
      authority: boundary.workspaceAccess.membership.authority,
      memberOfWorkspace: boundary.workspaceAccess.membership.memberOfWorkspace,
      tenantAligned: boundary.workspaceAccess.membership.tenantAligned,
      workspaceTenantAligned: boundary.workspaceAccess.membership.workspaceTenantAligned,
      findingCodes: boundary.workspaceAccess.findings.map((finding) => finding.code),
      audit: boundary.workspaceAccess.audit
    },
    providerContracts: {
      contract: operationalHealth.providerNegotiation.contract,
      ready: operationalHealth.providerNegotiation.ready,
      degraded: operationalHealth.providerNegotiation.degraded,
      requiredCapabilities: operationalHealth.providerNegotiation.requiredCapabilities,
      selectedProviders: operationalHealth.providerNegotiation.selectedProviders,
      missingCapabilities: operationalHealth.providerNegotiation.missingCapabilities,
      unavailableCapabilities: operationalHealth.providerNegotiation.unavailableCapabilities,
      staleCapabilities: operationalHealth.providerNegotiation.staleCapabilities
    },
    operationalErrors: operationalHealth.errors.map((error) => error.code),
    previewAcceptance: {
      contract: effectivePreviewAcceptance.contract,
      previewId: effectivePreviewAcceptance.previewId,
      accepted: effectivePreviewAcceptance.acceptance.accepted,
      requestedAction: effectivePreviewAcceptance.acceptance.request.action || null,
      requestValid: effectivePreviewAcceptance.acceptance.request.validation.valid,
      status: effectivePreviewAcceptance.display.status,
      nextStep: effectivePreviewAcceptance.nextStep,
      mutation: {
        contract: effectivePreviewAcceptance.mutation.contract,
        op: effectivePreviewAcceptance.mutation.op,
        canApply: effectivePreviewAcceptance.mutation.canApply,
        blockedBy: effectivePreviewAcceptance.mutation.blockedBy
      },
      blockingCodes: effectivePreviewAcceptance.validationSummary.blockingCodes,
      warningCodes: effectivePreviewAcceptance.validationSummary.warningCodes
    },
    lifecycle: {
      contract: context.scheduler.lifecycleSettings.contract,
      enabled: context.scheduler.lifecycleSettings.enabled,
      command: context.scheduler.lifecycleSettings.command,
      scheduleMode: context.scheduler.lifecycleSettings.scheduleMode,
      delayUntil: context.scheduler.lifecycleSettings.delay.until || null,
      validationFindingCodes: context.scheduler.lifecycleSettings.validation.findings.map((finding) => finding.code),
      commandControls: {
        contract: effectiveClientHandoff.lifecycle.commandControls.contract,
        requestedCommand: effectiveClientHandoff.lifecycle.commandControls.requestedCommand,
        recommendedCommand: effectiveClientHandoff.lifecycle.commandControls.recommendedCommand,
        nextCommand: effectiveClientHandoff.lifecycle.commandControls.nextCommand,
        enabledControlCount: effectiveClientHandoff.lifecycle.commandControls.controls.filter((control) => control.enabled).length,
        blockingCodes: effectiveClientHandoff.lifecycle.commandControls.proof.blockingCodes
      },
      commandMutation: {
        contract: effectiveClientHandoff.lifecycle.commandMutation.contract,
        present: effectiveClientHandoff.lifecycle.commandMutation.present,
        command: effectiveClientHandoff.lifecycle.commandMutation.command,
        applyMode: effectiveClientHandoff.lifecycle.commandMutation.applyMode,
        canApply: effectiveClientHandoff.lifecycle.commandMutation.canApply,
        blockedBy: effectiveClientHandoff.lifecycle.commandMutation.blockedBy,
        desiredPatch: effectiveClientHandoff.lifecycle.commandMutation.desiredPatch
      }
    },
    actions: operationalHealth.actions,
    clientWorkflowState: effectiveClientHandoff.workflowState,
    clientNextAction: effectiveClientHandoff.nextAction,
    clientRoute: effectiveClientHandoff.route,
    clientStateSync: {
      contract: effectiveClientHandoff.clientStateSync.contract,
      stateId: effectiveClientHandoff.clientStateSync.stateId,
      previousRevision: effectiveClientHandoff.clientStateSync.previousRevision,
      nextRevision: effectiveClientHandoff.clientStateSync.nextRevision,
      refreshRequired: effectiveClientHandoff.clientStateSync.refreshRequired,
      conflictCodes: effectiveClientHandoff.clientStateSync.proof.conflictCodes,
      blockingCodes: effectiveClientHandoff.clientStateSync.proof.blockingCodes,
      patchStatus: effectiveClientHandoff.clientStateSync.patch.status,
      primaryAction: effectiveClientHandoff.clientStateSync.userHandoff.primaryAction
    }
  };
}

function normalizeHistoryEvents(input, generatedAt) {
  const source = Array.isArray(input.resumeHistory)
    ? input.resumeHistory
    : Array.isArray(input.history)
      ? input.history
      : Array.isArray(input.auditHistory)
        ? input.auditHistory
        : [];

  return source.map((entry, index) => {
    const record = asRecord(entry);
    const outcome = asText(record.outcome || record.decision || record.status, 'unknown').toLowerCase();
    const retry = asRecord(record.retry);
    const findings = asStringArray(record.findings || record.findingCodes || record.policyFindings);
    const errors = asStringArray(record.operationalErrors || record.errors || record.errorCodes);
    const warnings = asStringArray(record.operationalWarnings || record.warnings || record.warningCodes);

    return {
      sequence: index + 1,
      observedAt: normalizeTimestamp(record.observedAt || record.generatedAt || record.timestamp || record.at, generatedAt),
      resumeRequestId: asText(record.resumeRequestId || record.requestId || record.id, `history-${index + 1}`),
      runId: asText(record.runId),
      workspaceId: asText(record.workspaceId),
      tenantId: asText(record.tenantId),
      actorId: asText(record.actorId || record.requestedBy),
      outcome: KNOWN_HISTORY_OUTCOMES.has(outcome) ? outcome : 'unknown',
      dispatchable: record.dispatchable === true,
      retryAllowed: record.retryAllowed === true || retry.allowed === true,
      retryAfterMs: clampNumber(asNumber(record.retryAfterMs, asNumber(retry.retryAfterMs, 0)), 0, MAX_RETRY_AFTER_MS),
      attempt: clampNumber(asNumber(record.attempt, asNumber(retry.attempt, 0)), 0, 1000),
      queueDepth: clampNumber(asNumber(record.queueDepth, 0), 0, 1000000),
      findings,
      errors,
      warnings
    };
  });
}

function normalizeCommandLedger(input, generatedAt) {
  const source = Array.isArray(input.commands)
    ? input.commands
    : Array.isArray(input.commandLedger)
      ? input.commandLedger
      : [];

  return source.map((entry, index) => {
    const record = asRecord(entry);
    const status = asText(record.status || record.state, 'recorded').toLowerCase();
    const normalizedStatus = VALID_COMMAND_STATUSES.has(status) ? status : 'unknown';
    const type = asText(record.type || record.name, 'unknown');
    const recordedAt = normalizeTimestamp(record.recordedAt || record.updatedAt || record.createdAt, generatedAt);
    return {
      contract: 'scheduler.resume_policy.command_ledger_entry.v1',
      sequence: index + 1,
      commandId: asText(record.commandId || record.id, `command-${index + 1}`),
      idempotencyKey: asText(record.idempotencyKey),
      type,
      status: normalizedStatus,
      terminal: TERMINAL_COMMAND_STATUSES.has(normalizedStatus),
      active: ACTIVE_COMMAND_STATUSES.has(normalizedStatus),
      retryableFailure: FAILED_RETRYABLE_COMMAND_STATUSES.has(normalizedStatus),
      recordedAt,
      checkpointId: asText(record.checkpointId || record.expectedPreviousCheckpointId),
      resultRef: asText(record.resultRef || record.resultId || record.auditRef),
      replayToken: asText(record.replayToken || record.resultToken || `${type}:${recordedAt}`)
    };
  });
}

function normalizePersistedResumeState(input, context, generatedAt) {
  const source = asRecord(input.persistedState || input.resumeState || input.checkpoint);
  const status = asText(source.status || source.state, source.checkpointId ? 'checkpointed' : 'missing').toLowerCase();
  const lease = asRecord(source.lease);
  const updatedAt = normalizeTimestamp(source.updatedAt || source.persistedAt || source.lastSeenAt, '');
  const leaseExpiresAt = normalizeTimestamp(source.leaseExpiresAt || lease.expiresAt, '');
  const commandLedger = normalizeCommandLedger(source, generatedAt);
  const generatedAtMs = Date.parse(generatedAt);
  const updatedAtMs = updatedAt ? Date.parse(updatedAt) : 0;
  const latestMatchingCommand = [...commandLedger]
    .reverse()
    .find((command) => command.idempotencyKey && command.idempotencyKey === context.request.idempotencyKey);
  const latestActiveCommand = [...commandLedger]
    .reverse()
    .find((command) => command.active);
  const latestTerminalCommand = [...commandLedger]
    .reverse()
    .find((command) => command.terminal);

  return {
    contract: 'scheduler.resume_policy.persisted_state.v1',
    checkpointId: asText(source.checkpointId || source.id),
    resumeRequestId: asText(source.resumeRequestId || source.requestId),
    runId: asText(source.runId),
    workspaceId: asText(source.workspaceId),
    tenantId: asText(source.tenantId),
    idempotencyKey: asText(source.idempotencyKey),
    attempt: clampNumber(asNumber(source.attempt, 0), 0, 1000),
    status: VALID_PERSISTED_STATUSES.has(status) ? status : 'stale',
    updatedAt,
    lease: {
      holder: asText(source.leaseHolder || lease.holder),
      expiresAt: leaseExpiresAt,
      expired: leaseExpiresAt ? Date.parse(leaseExpiresAt) <= Date.parse(generatedAt) : false
    },
    freshness: {
      observedAt: generatedAt,
      ageMs: updatedAtMs && Number.isFinite(updatedAtMs) && Number.isFinite(generatedAtMs)
        ? Math.max(generatedAtMs - updatedAtMs, 0)
        : null,
      stale: Boolean(updatedAt && Number.isFinite(updatedAtMs) && Number.isFinite(generatedAtMs) && generatedAtMs - updatedAtMs > MAX_CLIENT_STATE_AGE_MS)
    },
    commandLedger,
    latestMatchingCommand: latestMatchingCommand || null,
    latestActiveCommand: latestActiveCommand || null,
    latestTerminalCommand: latestTerminalCommand || null
  };
}

function checkpointMatchesContext(persistedState, context) {
  if (!persistedState.checkpointId) return false;
  if (persistedState.resumeRequestId && persistedState.resumeRequestId !== context.request.id) return false;
  if (persistedState.runId && context.request.runId && persistedState.runId !== context.request.runId) return false;
  if (persistedState.workspaceId && context.request.workspaceId && persistedState.workspaceId !== context.request.workspaceId) return false;
  if (persistedState.tenantId && context.request.tenantId && persistedState.tenantId !== context.request.tenantId) return false;
  return true;
}

function persistedStateFindings(persistedState, context, generatedAt) {
  const findings = [];
  if (!persistedState.checkpointId) {
    findings.push({ code: 'checkpoint_missing', severity: 'recover', field: 'persistedState.checkpointId' });
  }
  if (persistedState.resumeRequestId && persistedState.resumeRequestId !== context.request.id) {
    findings.push({ code: 'checkpoint_request_mismatch', severity: 'replace', field: 'persistedState.resumeRequestId' });
  }
  if (persistedState.runId && context.request.runId && persistedState.runId !== context.request.runId) {
    findings.push({ code: 'checkpoint_run_mismatch', severity: 'replace', field: 'persistedState.runId' });
  }
  if (persistedState.workspaceId && context.request.workspaceId && persistedState.workspaceId !== context.request.workspaceId) {
    findings.push({ code: 'checkpoint_workspace_mismatch', severity: 'replace', field: 'persistedState.workspaceId' });
  }
  if (persistedState.tenantId && context.request.tenantId && persistedState.tenantId !== context.request.tenantId) {
    findings.push({ code: 'checkpoint_tenant_mismatch', severity: 'replace', field: 'persistedState.tenantId' });
  }
  if (persistedState.status === 'stale' || persistedState.freshness.stale) {
    findings.push({ code: 'checkpoint_stale', severity: 'recover', field: 'persistedState.updatedAt', ageMs: persistedState.freshness.ageMs });
  }
  if (persistedState.lease.expired && ACTIVE_PERSISTED_STATUSES.has(persistedState.status)) {
    findings.push({ code: 'active_checkpoint_lease_expired', severity: 'recover', field: 'persistedState.lease.expiresAt' });
  }
  if (persistedState.latestMatchingCommand?.retryableFailure) {
    findings.push({ code: 'matching_command_retryable_failure', severity: 'recover', field: 'persistedState.commandLedger' });
  }
  if (persistedState.latestMatchingCommand?.terminal) {
    findings.push({ code: 'matching_command_terminal', severity: 'replay', field: 'persistedState.commandLedger' });
  }
  if (!persistedState.updatedAt && persistedState.checkpointId) {
    findings.push({ code: 'checkpoint_updated_at_missing', severity: 'audit', field: 'persistedState.updatedAt' });
  }
  return findings.map((finding) => ({
    ...finding,
    observedAt: generatedAt,
    checkpointId: persistedState.checkpointId || null,
    resumeRequestId: context.request.id
  }));
}

function persistedStatusForWorkflow(workflowState, operationalHealth) {
  if (workflowState === 'ready_to_dispatch') return 'dispatching';
  if (workflowState === 'blocked' || workflowState === 'lifecycle_disabled' || workflowState === 'lifecycle_paused' || workflowState === 'lifecycle_command_invalid') return 'blocked';
  if (workflowState === 'awaiting_client_ack') return 'awaiting_ack';
  if (workflowState === 'retry_scheduled' || operationalHealth.retry.allowed) return 'retry_scheduled';
  if (workflowState === 'review_required') return 'review_required';
  return 'checkpointed';
}

function commandTypeForHandoff(clientHandoff) {
  if (clientHandoff.nextAction === 'enqueue_resume') return 'scheduler.resume.enqueue';
  if (clientHandoff.nextAction === 'schedule_retry') return 'scheduler.resume.retry.schedule';
  if (clientHandoff.nextAction === 'open_operator_review') return 'scheduler.resume.review.open';
  if (clientHandoff.nextAction === 'request_client_acknowledgement') return 'scheduler.resume.ack.request';
  if (clientHandoff.nextAction === 'correct_lifecycle_command') return 'scheduler.resume.lifecycle.command.correct';
  if (clientHandoff.nextAction === 'enable_resume_policy') return 'scheduler.resume.lifecycle.enable_required';
  if (clientHandoff.nextAction === 'wait_for_lifecycle_resume') return 'scheduler.resume.lifecycle.wait';
  if (clientHandoff.nextAction === 'wait_until_scheduled') return 'scheduler.resume.schedule.wait';
  if (clientHandoff.nextAction === 'wait_for_capacity') return 'scheduler.resume.capacity.wait';
  if (clientHandoff.nextAction === 'show_policy_blocked') return 'scheduler.resume.block.persist';
  return 'scheduler.resume.wait.persist';
}

function buildPersistenceRecovery(input, context, boundary, operationalHealth, clientHandoff, generatedAt) {
  const persistedState = normalizePersistedResumeState(input, context, generatedAt);
  const matchesContext = checkpointMatchesContext(persistedState, context);
  const stateFindings = persistedStateFindings(persistedState, context, generatedAt);
  const sameIdempotencyKey = Boolean(
    context.request.idempotencyKey
      && persistedState.idempotencyKey
      && context.request.idempotencyKey === persistedState.idempotencyKey
  );
  const commandTerminalReplay = Boolean(context.request.idempotencyKey && persistedState.latestMatchingCommand?.terminal);
  const commandActiveDuplicate = Boolean(context.request.idempotencyKey && persistedState.latestMatchingCommand?.active && !persistedState.lease.expired);
  const commandRetryableFailure = Boolean(context.request.idempotencyKey && persistedState.latestMatchingCommand?.retryableFailure);
  const terminalDuplicate = sameIdempotencyKey && TERMINAL_PERSISTED_STATUSES.has(persistedState.status);
  const activeDuplicate = sameIdempotencyKey && ACTIVE_PERSISTED_STATUSES.has(persistedState.status) && !persistedState.lease.expired;
  const needsCheckpoint = !persistedState.checkpointId || !matchesContext;
  const restartRecovered = matchesContext && (
    (persistedState.lease.expired && ACTIVE_PERSISTED_STATUSES.has(persistedState.status))
    || commandRetryableFailure
    || persistedState.freshness.stale
  );
  const commandType = commandTypeForHandoff(clientHandoff);
  const commandIdSeed = context.request.idempotencyKey || `${context.request.id}:${clientHandoff.workflowState}`;
  const statusAfterCommand = persistedStatusForWorkflow(clientHandoff.workflowState, operationalHealth);

  const recoveryAction = terminalDuplicate || commandTerminalReplay
    ? 'return_persisted_terminal_result'
    : activeDuplicate || commandActiveDuplicate
      ? 'suppress_duplicate_command'
      : restartRecovered
        ? 'reclaim_expired_checkpoint'
        : needsCheckpoint
          ? 'create_checkpoint'
          : operationalHealth.retry.allowed
          ? 'refresh_retry_checkpoint'
          : 'advance_checkpoint';
  const restartSafeStatus = terminalDuplicate || commandTerminalReplay
    ? 'terminal_replay'
    : activeDuplicate || commandActiveDuplicate
      ? 'duplicate_in_flight'
      : restartRecovered
        ? 'recovered_after_restart'
        : needsCheckpoint
          ? 'new_checkpoint_required'
          : 'checkpoint_current';
  const checkpointId = persistedState.checkpointId || `${context.request.id}:${commandIdSeed}`;
  const checkpointRequired = needsCheckpoint
    || restartRecovered
    || recoveryAction === 'advance_checkpoint'
    || recoveryAction === 'refresh_retry_checkpoint';
  const checkpointOperation = terminalDuplicate || commandTerminalReplay || activeDuplicate || commandActiveDuplicate
    ? 'none'
    : needsCheckpoint
      ? 'create'
      : restartRecovered
        ? 'reclaim'
        : 'update';
  const generatedAtMs = Date.parse(generatedAt);
  const effectiveGeneratedAtMs = Number.isFinite(generatedAtMs) ? generatedAtMs : Date.now();
  const nextLeaseExpiresAt = checkpointRequired
    ? new Date(effectiveGeneratedAtMs + (operationalHealth.retry.allowed ? operationalHealth.retry.retryAfterMs : DEFAULT_RETRY_AFTER_MS)).toISOString()
    : persistedState.lease.expiresAt || null;

  return {
    contract: 'scheduler.resume_policy.recovery.v1',
    generatedAt,
    restartSafeStatus,
    recoveryAction,
    persistedState,
    stateFindings,
    checkpoint: {
      required: checkpointRequired,
      operation: checkpointOperation,
      checkpointId,
      status: statusAfterCommand,
      resumeRequestId: context.request.id,
      runId: context.request.runId || null,
      workspaceId: context.request.workspaceId || context.workspace.id || null,
      tenantId: context.request.tenantId || context.workspace.tenantId || null,
      idempotencyKey: context.request.idempotencyKey || null,
      attempt: context.request.attempt,
      leaseTtlMs: operationalHealth.retry.allowed ? operationalHealth.retry.retryAfterMs : DEFAULT_RETRY_AFTER_MS,
      leaseExpiresAt: nextLeaseExpiresAt,
      compareAndSwap: {
        expectedCheckpointId: matchesContext ? persistedState.checkpointId || null : null,
        expectedStatus: matchesContext ? persistedState.status : null,
        expectedLeaseHolder: matchesContext ? persistedState.lease.holder || null : null
      }
    },
    command: {
      emit: !terminalDuplicate
        && !commandTerminalReplay
        && !activeDuplicate
        && !commandActiveDuplicate
        && boundary.decision !== 'deny'
        && clientHandoff.nextAction !== 'enable_resume_policy',
      commandId: `${commandType}:${commandIdSeed}`,
      type: commandType,
      idempotencyKey: context.request.idempotencyKey || null,
      dedupeKey: context.request.idempotencyKey || `${context.request.id}:${context.request.attempt}`,
      expectedPreviousCheckpointId: matchesContext ? persistedState.checkpointId || null : null,
      statusIfRecorded: statusAfterCommand,
      route: clientHandoff.route
    },
    persistencePatch: {
      contract: 'scheduler.resume_policy.persistence_patch.v1',
      op: checkpointOperation,
      checkpointId,
      writeRequired: checkpointRequired && checkpointOperation !== 'none',
      idempotent: Boolean(context.request.idempotencyKey),
      status: statusAfterCommand,
      leaseExpiresAt: nextLeaseExpiresAt,
      findings: stateFindings.map((finding) => finding.code),
      audit: {
        type: 'scheduler.resume_policy.persistence_patch',
        surfaceId,
        generatedAt,
        recoveryAction,
        restartSafeStatus,
        checkpointOperation,
        checkpointId,
        commandId: `${commandType}:${commandIdSeed}`
      }
    },
    replay: {
      safeToReplay: !terminalDuplicate
        && !commandTerminalReplay
        && (!activeDuplicate || persistedState.lease.expired)
        && (!commandActiveDuplicate || persistedState.lease.expired),
      latestMatchingCommand: persistedState.latestMatchingCommand,
      reasonCodes: [
        ...(needsCheckpoint ? ['checkpoint_missing_or_mismatched'] : []),
        ...(restartRecovered ? ['checkpoint_lease_expired'] : []),
        ...(terminalDuplicate || commandTerminalReplay ? ['terminal_idempotency_replay'] : []),
        ...(activeDuplicate || commandActiveDuplicate ? ['active_idempotency_duplicate'] : []),
        ...(commandRetryableFailure ? ['command_retryable_failure'] : []),
        ...stateFindings.map((finding) => finding.code)
      ]
    }
  };
}

function buildDispatchPlan(context, boundary, operationalHealth, clientHandoff, previewAcceptance, recovery, generatedAt) {
  const workspaceId = context.request.workspaceId || context.workspace.id || null;
  const tenantId = context.request.tenantId || context.workspace.tenantId || null;
  const blockingCodes = [
    ...boundary.findings.filter((finding) => finding.severity === 'deny').map((finding) => finding.code),
    ...operationalHealth.errors.map((error) => error.code),
    ...(previewAcceptance.acceptance.acknowledgementRequired ? ['client_acknowledgement_required'] : []),
    ...clientHandoff.clientStateSync.proof.blockingCodes
  ];
  const reviewCodes = [
    ...boundary.findings.filter((finding) => finding.severity === 'review').map((finding) => finding.code),
    ...operationalHealth.warnings.map((warning) => warning.code),
    ...(previewAcceptance.acceptance.reviewRequired ? ['operator_review_required'] : [])
  ];
  const canEmitDispatch = recovery.command.emit
    && previewAcceptance.acceptance.accepted
    && clientHandoff.dispatch.allowed
    && blockingCodes.length === 0;
  const planMode = canEmitDispatch
    ? 'dispatch'
    : operationalHealth.retry.allowed
      ? 'retry'
      : clientHandoff.review.required
        ? 'review'
        : boundary.decision === 'deny'
          ? 'blocked'
          : 'wait';
  const leaseTtlMs = planMode === 'retry'
    ? operationalHealth.retry.retryAfterMs
    : recovery.checkpoint.leaseTtlMs;
  const requiredProof = [
    'tenant-boundary',
    'workspace-boundary',
    'workspace-access-scope',
    'resume-request',
    ...(boundary.permission.authorized ? ['permission-grant'] : ['actor-role']),
    ...(context.request.idempotencyKey ? ['idempotency-key'] : ['idempotency-warning']),
    ...(clientHandoff.clientStateSync.refreshRequired ? ['client-state-sync'] : []),
    ...(previewAcceptance.acceptance.acknowledgementRequired ? ['client-acknowledgement'] : []),
    ...(reviewCodes.length ? ['operator-review'] : [])
  ];
  const dispatchIdSeed = context.request.idempotencyKey || `${context.request.id}:${context.request.attempt}`;

  return {
    contract: 'scheduler.resume_policy.dispatch_plan.v1',
    generatedAt,
    mode: planMode,
    ready: canEmitDispatch,
    queue: clientHandoff.dispatch.queue,
    command: {
      emit: canEmitDispatch,
      commandId: canEmitDispatch ? recovery.command.commandId : null,
      type: recovery.command.type,
      dispatchId: `resume-dispatch:${dispatchIdSeed}`,
      dedupeKey: recovery.command.dedupeKey,
      idempotencyKey: context.request.idempotencyKey || null,
      expectedPreviousCheckpointId: recovery.command.expectedPreviousCheckpointId,
      checkpointId: recovery.checkpoint.checkpointId,
      leaseTtlMs,
      checkpointOperation: recovery.checkpoint.operation,
      persistencePatch: recovery.persistencePatch,
      route: clientHandoff.route
    },
    target: {
      resumeRequestId: context.request.id,
      runId: context.request.runId || null,
      tenantId,
      workspaceId,
      actorId: context.actor.id
    },
    gating: {
      decision: boundary.decision,
      healthStatus: operationalHealth.status,
      workflowState: clientHandoff.workflowState,
      previewAccepted: previewAcceptance.acceptance.accepted,
      restartSafeStatus: recovery.restartSafeStatus,
      recoveryAction: recovery.recoveryAction,
      replaySafe: recovery.replay.safeToReplay,
      blockingCodes,
      reviewCodes
    },
    proof: {
      required: Array.from(new Set(requiredProof)),
      permissionGrantIds: boundary.permission.matchingGrantIds,
      scopes: boundary.scopes,
      auditRef: context.scheduler.failureState.auditRef || null,
      previewId: previewAcceptance.previewId,
      clientStateId: clientHandoff.stateId,
      checkpointRequired: recovery.checkpoint.required,
      checkpointOperation: recovery.checkpoint.operation,
      recoveryFindingCodes: recovery.stateFindings.map((finding) => finding.code)
    },
    auditExport: {
      type: 'scheduler.resume_policy.dispatch_plan',
      surfaceId,
      contract: 'scheduler.resume_policy.dispatch_plan.v1',
      generatedAt,
      outcome: planMode,
      commandType: recovery.command.type,
      commandEmit: canEmitDispatch,
      queue: clientHandoff.dispatch.queue,
      blockingCount: blockingCodes.length,
      reviewCount: reviewCodes.length
    }
  };
}

function buildProviderHandoffState(context, boundary, operationalHealth, clientHandoff, dispatchPlan, generatedAt) {
  const negotiation = operationalHealth.providerNegotiation;
  const externalTargets = negotiation.selectedProviders
    .filter((provider) => provider.providerId)
    .map((provider) => ({
      capability: provider.capability,
      providerId: provider.providerId,
      providerType: provider.providerType,
      status: provider.status,
      syncCursor: provider.syncCursor,
      syncRevision: provider.syncRevision,
      externalStateId: provider.handoffStateId,
      routeName: clientHandoff.route.name
    }));
  const handoffProviders = context.scheduler.providerContracts.filter((provider) => (
    provider.handoff.status !== 'none' || provider.capabilities.includes('external.handoff')
  ));
  const externalState = handoffProviders.map((provider) => ({
    providerId: provider.providerId,
    providerType: provider.type,
    status: provider.handoff.status,
    externalStateId: provider.handoff.externalStateId || `${context.request.id}:${provider.providerId}`,
    channel: provider.handoff.channel || context.client.channel,
    returnTo: provider.handoff.returnTo || context.client.returnTo || null,
    expiresAt: provider.handoff.expiresAt || null,
    syncRevision: provider.sync.revision,
    syncCursor: provider.sync.cursor || null,
    stale: provider.sync.stale
  }));
  const blockingCodes = [
    ...dispatchPlan.gating.blockingCodes,
    ...negotiation.missingCapabilities.map((capability) => `missing:${capability}`),
    ...negotiation.unavailableCapabilities.map((capability) => `unavailable:${capability}`)
  ];
  const canExternalize = boundary.decision !== 'deny'
    && negotiation.ready
    && blockingCodes.length === 0
    && (dispatchPlan.mode === 'dispatch' || dispatchPlan.mode === 'retry' || dispatchPlan.mode === 'review');

  return {
    contract: 'scheduler.resume_policy.provider_handoff_state.v1',
    generatedAt,
    ready: negotiation.ready,
    degraded: negotiation.degraded,
    canExternalize,
    negotiation,
    externalTargets,
    externalState,
    syncMetadata: {
      requiredCapabilityCount: negotiation.requiredCapabilities.length,
      selectedProviderCount: externalTargets.length,
      staleCapabilities: negotiation.staleCapabilities,
      maxLagMs: context.scheduler.providerContracts.reduce((max, provider) => (
        Math.max(max, provider.sync.lagMs || 0)
      ), 0),
      cursors: externalTargets
        .filter((target) => target.syncCursor)
        .map((target) => ({
          providerId: target.providerId,
          capability: target.capability,
          cursor: target.syncCursor,
          revision: target.syncRevision
        }))
    },
    handoffPatch: {
      op: canExternalize ? 'upsert_external_state' : 'hold_external_state',
      stateId: `${context.request.id}:${clientHandoff.workflowState}:provider-handoff`,
      routeName: clientHandoff.route.name,
      dispatchMode: dispatchPlan.mode,
      targets: externalTargets,
      blockedBy: Array.from(new Set(blockingCodes)),
      audit: {
        type: 'scheduler.resume_policy.provider_handoff_state',
        surfaceId,
        contract: 'scheduler.resume_policy.provider_handoff_state.v1',
        generatedAt,
        canExternalize,
        providerCount: context.scheduler.providerContracts.length,
        requiredCapabilities: negotiation.requiredCapabilities
      }
    },
    proof: {
      required: [
        'provider-capability-negotiation',
        'provider-sync-metadata',
        ...(externalState.length ? ['external-handoff-state'] : []),
        ...(negotiation.degraded ? ['provider-refresh-review'] : [])
      ],
      missingCapabilities: negotiation.missingCapabilities,
      unavailableCapabilities: negotiation.unavailableCapabilities,
      validationCodes: negotiation.validationFindings.map((finding) => finding.code),
      scopes: boundary.scopes
    }
  };
}

function countBy(items, readKey) {
  const counts = {};
  for (const item of items) {
    const key = asText(readKey(item), 'unknown');
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function normalizeAnalyticsExportConfig(input) {
  const analytics = asRecord(input.analytics);
  const source = asRecord(input.analyticsExport || analytics.export || input.export);
  const format = asText(source.format, 'json').toLowerCase();
  return {
    contract: 'scheduler.resume_policy.analytics_export_config.v1',
    enabled: source.enabled !== false,
    format: VALID_ANALYTICS_EXPORT_FORMATS.has(format) ? format : 'json',
    destination: asText(source.destination || source.sink || source.target, 'audit-export'),
    includeHistory: source.includeHistory !== false,
    rowLimit: clampNumber(asNumber(source.rowLimit, ANALYTICS_EXPORT_ROW_LIMIT), 1, ANALYTICS_EXPORT_ROW_LIMIT),
    requestedFields: asStringArray(source.fields || source.requestedFields)
  };
}

function severityScoreForEvent(event) {
  return (event.errors.length * 10)
    + (event.findings.length * 5)
    + (event.warnings.length * 2)
    + (event.retryAllowed ? 1 : 0)
    + (event.dispatchable ? 0 : 1);
}

function buildHistorySnapshots(events) {
  return events.slice(-HISTORY_SNAPSHOT_LIMIT).map((event, index, retainedEvents) => {
    const previous = retainedEvents[index - 1];
    return {
      sequence: event.sequence,
      observedAt: event.observedAt,
      resumeRequestId: event.resumeRequestId,
      runId: event.runId || null,
      outcome: event.outcome,
      dispatchable: event.dispatchable,
      retryAllowed: event.retryAllowed,
      retryAfterMs: event.retryAfterMs,
      attempt: event.attempt,
      queueDepth: event.queueDepth,
      delta: {
        queueDepth: previous ? event.queueDepth - previous.queueDepth : 0,
        retryAfterMs: previous ? event.retryAfterMs - previous.retryAfterMs : 0,
        severityScore: previous ? severityScoreForEvent(event) - severityScoreForEvent(previous) : 0
      },
      signalCounts: {
        findings: event.findings.length,
        errors: event.errors.length,
        warnings: event.warnings.length
      }
    };
  });
}

function buildRecentWindow(events) {
  const recent = events.slice(-ANALYTICS_RECENT_WINDOW_SIZE);
  const previous = events.slice(-ANALYTICS_RECENT_WINDOW_SIZE * 2, -ANALYTICS_RECENT_WINDOW_SIZE);
  const summarize = (windowEvents) => ({
    evaluations: windowEvents.length,
    dispatchable: windowEvents.filter((event) => event.dispatchable).length,
    denied: windowEvents.filter((event) => event.outcome === 'deny').length,
    failed: windowEvents.filter((event) => event.outcome === 'failed' || event.errors.length > 0).length,
    retryable: windowEvents.filter((event) => event.retryAllowed || event.retryAfterMs > 0).length,
    severityScore: windowEvents.reduce((total, event) => total + severityScoreForEvent(event), 0)
  });
  const current = summarize(recent);
  const baseline = summarize(previous);

  return {
    contract: 'scheduler.resume_policy.analytics_recent_window.v1',
    size: ANALYTICS_RECENT_WINDOW_SIZE,
    current,
    previous: baseline,
    trend: {
      dispatchableDelta: current.dispatchable - baseline.dispatchable,
      deniedDelta: current.denied - baseline.denied,
      failedDelta: current.failed - baseline.failed,
      retryableDelta: current.retryable - baseline.retryable,
      severityScoreDelta: current.severityScore - baseline.severityScore
    }
  };
}

function buildAnalyticsExportRows(events, exportConfig, generatedAt) {
  const sourceEvents = exportConfig.includeHistory ? events : events.slice(-1);
  return sourceEvents.slice(-exportConfig.rowLimit).map((event) => ({
    exportContract: 'scheduler.resume_policy.analytics_export_row.v1',
    exportedAt: generatedAt,
    sequence: event.sequence,
    observedAt: event.observedAt,
    resumeRequestId: event.resumeRequestId,
    runId: event.runId || null,
    tenantId: event.tenantId || null,
    workspaceId: event.workspaceId || null,
    actorId: event.actorId || null,
    outcome: event.outcome,
    dispatchable: event.dispatchable,
    retryAllowed: event.retryAllowed,
    retryAfterMs: event.retryAfterMs,
    attempt: event.attempt,
    queueDepth: event.queueDepth,
    findingCodes: event.findings,
    errorCodes: event.errors,
    warningCodes: event.warnings,
    severityScore: severityScoreForEvent(event)
  }));
}

function buildReportingState(context, boundary, operationalHealth, clientHandoff, currentEvent, recentWindow, exportRows, generatedAt) {
  const blockingCount = boundary.findings.filter((finding) => finding.severity === 'deny').length + operationalHealth.errors.length;
  const reviewCount = boundary.findings.filter((finding) => finding.severity === 'review').length + operationalHealth.warnings.length;
  const reportStatus = blockingCount
    ? 'blocked'
    : reviewCount
      ? 'needs_review'
      : operationalHealth.dispatchable
        ? 'ready'
        : 'watch';

  return {
    contract: 'scheduler.resume_policy.analytics_reporting_state.v1',
    reportId: `resume-policy:${context.request.id}:${currentEvent.sequence}`,
    generatedAt,
    status: reportStatus,
    freshness: {
      latestObservedAt: currentEvent.observedAt,
      currentSequence: currentEvent.sequence,
      historyWindowComplete: currentEvent.sequence <= HISTORY_SNAPSHOT_LIMIT,
      exportRowsReady: exportRows.length
    },
    counters: {
      blockingSignals: blockingCount,
      reviewSignals: reviewCount,
      severityScore: severityScoreForEvent(currentEvent),
      recentSeverityScoreDelta: recentWindow.trend.severityScoreDelta
    },
    routeState: {
      workflowState: clientHandoff.workflowState,
      nextAction: clientHandoff.nextAction,
      routeName: clientHandoff.route.name,
      auditChannel: clientHandoff.channel === 'audit-export'
    },
    labels: {
      tenantId: currentEvent.tenantId || null,
      workspaceId: currentEvent.workspaceId || null,
      runId: currentEvent.runId || null,
      schedulerState: context.scheduler.state,
      failureState: context.scheduler.failureState.status
    }
  };
}

function buildAnalyticsReport(input, context, boundary, operationalHealth, history, generatedAt, clientHandoff) {
  const currentOutcome = boundary.decision === 'deny'
    ? 'deny'
    : operationalHealth.dispatchable
      ? boundary.decision
      : operationalHealth.status;
  const currentEvent = {
    sequence: history.length + 1,
    observedAt: generatedAt,
    resumeRequestId: context.request.id,
    runId: context.request.runId || '',
    workspaceId: context.request.workspaceId || context.workspace.id || '',
    tenantId: context.request.tenantId || context.workspace.tenantId || '',
    actorId: context.actor.id,
    outcome: currentOutcome,
    dispatchable: operationalHealth.dispatchable,
    retryAllowed: operationalHealth.retry.allowed,
    retryAfterMs: operationalHealth.retry.retryAfterMs,
    attempt: context.request.attempt,
    queueDepth: context.scheduler.queueDepth,
    findings: boundary.findings.map((finding) => finding.code),
    errors: operationalHealth.errors.map((error) => error.code),
    warnings: operationalHealth.warnings.map((warning) => warning.code)
  };
  const events = [...history, currentEvent];
  const failedEvents = events.filter((event) => event.outcome === 'failed' || event.errors.length > 0);
  const deniedEvents = events.filter((event) => event.outcome === 'deny' || event.findings.length > 0);
  const retryEvents = events.filter((event) => event.retryAllowed || event.retryAfterMs > 0);
  const dispatchableEvents = events.filter((event) => event.dispatchable);
  const totalRetryDelayMs = retryEvents.reduce((total, event) => total + event.retryAfterMs, 0);
  const maxQueueDepth = events.reduce((max, event) => Math.max(max, event.queueDepth), 0);
  const snapshots = buildHistorySnapshots(events);
  const recentWindow = buildRecentWindow(events);
  const exportConfig = normalizeAnalyticsExportConfig(input);
  const exportRows = buildAnalyticsExportRows(events, exportConfig, generatedAt);
  const reportingState = buildReportingState(context, boundary, operationalHealth, clientHandoff, currentEvent, recentWindow, exportRows, generatedAt);

  return {
    contract: 'scheduler.resume_policy.analytics.v1',
    generatedAt,
    counters: {
      totalEvaluations: events.length,
      historicalEvaluations: history.length,
      dispatchableEvaluations: dispatchableEvents.length,
      deniedEvaluations: deniedEvents.length,
      failedEvaluations: failedEvents.length,
      retryableEvaluations: retryEvents.length,
      reviewEvaluations: events.filter((event) => event.outcome === 'allow_with_review' || event.warnings.length > 0).length,
      averageRetryDelayMs: retryEvents.length ? Math.round(totalRetryDelayMs / retryEvents.length) : 0,
      maxQueueDepth
    },
    outcomeCounts: countBy(events, (event) => event.outcome),
    signalCounts: {
      findings: countBy(events.flatMap((event) => event.findings), (code) => code),
      errors: countBy(events.flatMap((event) => event.errors), (code) => code),
      warnings: countBy(events.flatMap((event) => event.warnings), (code) => code)
    },
    timeline: snapshots,
    recentWindow,
    reportingState,
    export: {
      config: exportConfig,
      ready: exportConfig.enabled,
      format: exportConfig.format,
      destination: exportConfig.destination,
      rowCount: exportRows.length,
      fields: exportConfig.requestedFields.length
        ? exportConfig.requestedFields
        : Object.keys(exportRows[0] || {}),
      rows: exportRows
    },
    exportSummary: {
      surfaceId,
      tenantId: currentEvent.tenantId || null,
      workspaceId: currentEvent.workspaceId || null,
      currentResumeRequestId: context.request.id,
      currentRunId: context.request.runId || null,
      currentOutcome,
      currentDispatchable: operationalHealth.dispatchable,
      currentRetryAllowed: operationalHealth.retry.allowed,
      currentRetryAfterMs: operationalHealth.retry.retryAfterMs,
      clientWorkflowState: clientHandoff.workflowState,
      clientNextAction: clientHandoff.nextAction,
      clientChannel: clientHandoff.channel,
      lifecycle: {
        enabled: context.scheduler.lifecycleSettings.enabled,
        command: context.scheduler.lifecycleSettings.command,
        scheduleMode: context.scheduler.lifecycleSettings.scheduleMode,
        delayUntil: context.scheduler.lifecycleSettings.delay.until || null,
        validationFindingCount: context.scheduler.lifecycleSettings.validation.findings.length,
        recommendedCommand: clientHandoff.lifecycle.commandControls.recommendedCommand,
        commandRequestPresent: clientHandoff.lifecycle.commandRequest.present,
        commandMutationCanApply: clientHandoff.lifecycle.commandMutation.canApply,
        commandMutationApplyMode: clientHandoff.lifecycle.commandMutation.applyMode,
        enabledControlCount: clientHandoff.lifecycle.commandControls.controls.filter((control) => control.enabled).length
      },
      latestSignals: {
        findings: currentEvent.findings,
        errors: currentEvent.errors,
        warnings: currentEvent.warnings,
        severityScore: severityScoreForEvent(currentEvent)
      },
      historyWindow: {
        retained: snapshots.length,
        limit: HISTORY_SNAPSHOT_LIMIT,
        firstObservedAt: snapshots[0]?.observedAt || generatedAt,
        lastObservedAt: snapshots[snapshots.length - 1]?.observedAt || generatedAt
      },
      exportWindow: {
        destination: exportConfig.destination,
        format: exportConfig.format,
        rowCount: exportRows.length,
        includeHistory: exportConfig.includeHistory
      }
    }
  };
}

export function describeResumePolicySurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const context = normalizeContext(input, now);
  const boundary = evaluateBoundary(context);
  const operationalHealth = evaluateOperationalHealth(context, boundary, now);
  const clientHandoff = buildClientWorkflowHandoff(context, boundary, operationalHealth, now);
  const previewAcceptance = buildResumePreviewAcceptance(context, boundary, operationalHealth, clientHandoff, now, input);
  const auditHandoff = buildAuditHandoff(context, boundary, operationalHealth, now, clientHandoff, previewAcceptance);
  const resumeHistory = normalizeHistoryEvents(input, now);
  const analytics = buildAnalyticsReport(input, context, boundary, operationalHealth, resumeHistory, now, clientHandoff);
  const recovery = buildPersistenceRecovery(input, context, boundary, operationalHealth, clientHandoff, now);
  const dispatchPlan = buildDispatchPlan(context, boundary, operationalHealth, clientHandoff, previewAcceptance, recovery, now);
  const providerHandoffState = buildProviderHandoffState(context, boundary, operationalHealth, clientHandoff, dispatchPlan, now);

  return {
    ok: true,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'scheduler.resume_policy.v1',
    decision: boundary.decision,
    dispatchable: operationalHealth.dispatchable,
    healthStatus: operationalHealth.status,
    boundaryMode: context.boundaryMode,
    dataContract: {
      actor: {
        id: 'string',
        tenantId: 'string',
        roles: 'string[]',
        workspaceIds: 'string[]'
      },
      workspace: {
        id: 'string',
        tenantId: 'string',
        suspended: 'boolean',
        locked: 'boolean'
      },
      resumeRequest: {
        id: 'string',
        runId: 'string',
        workspaceId: 'string',
        tenantId: 'string',
        reason: 'string',
        requestedBy: 'string',
        idempotencyKey: 'string',
        retry: {
          attempt: 'number',
          maxAttempts: 'number'
        }
      },
      scheduler: {
        state: 'ready|paused|draining|degraded|string',
        queueDepth: 'number',
        acceptingResumes: 'boolean',
        dependencies: 'Array<{ name: string, state: string, required: boolean, checkedAt?: string }>',
        failureState: {
          contract: 'scheduler.resume_policy.failure_state.v1',
          status: 'closed|open|half_open|tripped|recovering',
          reasonCode: 'string',
          consecutiveFailures: 'number',
          openedAt: 'string',
          lastFailureAt: 'string',
          degradedUntil: 'string',
          retryAfterMs: 'number',
          operatorAction: 'string',
          auditRef: 'string'
        },
        lifecycleSettings: {
          contract: 'scheduler.resume_policy.lifecycle_settings.v1',
          enabled: 'boolean',
          command: 'enable|disable|pause|resume|drain|hold|cancel',
          scheduleMode: 'immediate|delayed|maintenance_window|manual_review',
          drainPolicy: 'reject_new|allow_checkpointed|allow_all',
          disabledReason: 'string',
          allowManualOverride: 'boolean',
          requireAckBeforeDispatch: 'boolean',
          delay: '{ requestedMs: number, effectiveMs: number, minMs: number, maxMs: number, until: string }',
          maintenanceWindow: '{ active: boolean, startsAt: string, endsAt: string }',
          concurrency: '{ maxInFlight: number, currentInFlight: number, reservedSlots: number }',
          validation: '{ valid: boolean, findings: Array<{ code: string, severity: string, field: string, value?: string }> }'
        },
        lifecycleCommandRequest: {
          contract: 'scheduler.resume_policy.lifecycle_command_request.v1',
          present: 'boolean',
          command: 'enable|disable|pause|resume|drain|hold|cancel|string',
          commandType: 'string|null',
          requestedBy: 'string',
          requestedAt: 'string',
          reason: 'string',
          idempotencyKey: 'string',
          scheduleMode: 'immediate|delayed|maintenance_window|manual_review',
          scheduled: 'boolean',
          effectiveAt: 'string',
          dryRun: 'boolean',
          force: 'boolean',
          acknowledgementToken: 'string',
          validation: '{ valid: boolean, findings: Array<{ code: string, severity: string, field: string, value?: string }> }'
        },
        providerContracts: 'Array<scheduler.resume_policy.provider_contract.v1>'
      },
      client: {
        sessionId: 'string',
        requestStateId: 'string',
        stateRevision: 'number',
        stateObservedAt: 'string',
        status: 'unknown|draft|previewing|accepted|acknowledged|dispatching|reviewing|blocked|stale',
        lastKnownWorkflowState: 'string',
        lastKnownNextAction: 'string',
        view: 'string',
        intent: 'resume|retry|handoff|inspect|cancel',
        channel: 'scheduler-console|client-runtime|operator-review|audit-export',
        returnTo: 'string',
        acknowledgement: {
          required: 'boolean',
          token: 'string',
          receivedAt: 'string'
        },
        visibleSignals: 'string[]',
        optimisticDispatch: 'boolean'
      },
      permissionGrants: {
        contract: 'scheduler.resume_policy.permission_grants.v1',
        requiredAction: 'scheduler.resume.execute|scheduler.resume.retry|scheduler.resume.handoff|scheduler.resume.inspect|scheduler.resume.cancel',
        grants: 'Array<{ grantId: string, source: string, tenantId: string, workspaceId: string, actions: string[], roles: string[], expiresAt: string, expired: boolean, reason: string }>',
        matchingGrantIds: 'string[]',
        expiredGrantIds: 'string[]'
      },
      workspaceAccess: {
        contract: 'scheduler.resume_policy.workspace_access_scope.v1',
        effective: '{ tenantId: string|null, workspaceId: string|null, boundaryMode: strict|workspace|tenant }',
        actor: '{ actorId: string, tenantId: string|null, workspaceIds: string[], roles: string[] }',
        request: '{ tenantId: string|null, workspaceId: string|null, requestedBy: string, intent: string, requiredAction: string }',
        membership: '{ memberOfWorkspace: boolean, tenantAligned: boolean, workspaceTenantAligned: boolean, authority: string[], workspaceGrantIds: string[], tenantGrantIds: string[], crossTenantDelegationGrantIds: string[] }',
        decision: 'allow|allow_with_review|deny',
        findings: 'Array<{ code: string, severity: deny|review, field: string }>',
        audit: '{ type: scheduler.resume_policy.workspace_access_scope, surfaceId: string, contract: string, tenantId: string|null, workspaceId: string|null, actorId: string, requiredAction: string, decision: string, authority: string[] }'
      },
      providerContracts: {
        contract: 'scheduler.resume_policy.provider_contract.v1',
        providerId: 'string',
        name: 'string',
        type: 'kernel|queue|checkpoint-store|audit-sink|client-handoff|operator-review',
        status: 'unknown|ready|degraded|unavailable|stale',
        required: 'boolean',
        capabilities: 'string[]',
        sync: '{ cursor: string, revision: number, observedAt: string, lagMs: number|null, stale: boolean }',
        handoff: '{ status: none|pending|accepted|externalized|failed|expired, externalStateId: string, channel: string, returnTo: string, expiresAt: string }',
        validation: 'Array<{ code: string, severity: string, field: string, value?: string, lagMs?: number|null }>'
      },
      providerHandoffState: {
        contract: 'scheduler.resume_policy.provider_handoff_state.v1',
        ready: 'boolean',
        degraded: 'boolean',
        canExternalize: 'boolean',
        negotiation: 'scheduler.resume_policy.provider_capability_negotiation.v1',
        externalTargets: 'Array<{ capability: string, providerId: string, providerType: string, status: string, syncCursor: string|null, syncRevision: number, externalStateId: string|null, routeName: string }>',
        externalState: 'Array<{ providerId: string, providerType: string, status: string, externalStateId: string, channel: string, returnTo: string|null, expiresAt: string|null, syncRevision: number, syncCursor: string|null, stale: boolean }>',
        syncMetadata: '{ requiredCapabilityCount: number, selectedProviderCount: number, staleCapabilities: string[], maxLagMs: number, cursors: Array<object> }',
        handoffPatch: '{ op: upsert_external_state|hold_external_state, stateId: string, routeName: string, dispatchMode: string, targets: Array<object>, blockedBy: string[], audit: object }',
        proof: '{ required: string[], missingCapabilities: string[], unavailableCapabilities: string[], validationCodes: string[], scopes: string[] }'
      },
      clientHandoff: {
        contract: 'scheduler.resume_policy.client_handoff.v1',
        workflowState: 'blocked|lifecycle_command_invalid|lifecycle_disabled|lifecycle_paused|scheduled_wait|capacity_wait|retry_scheduled|waiting_on_scheduler|review_required|awaiting_client_ack|ready_to_dispatch',
        nextAction: 'show_policy_blocked|correct_lifecycle_command|enable_resume_policy|wait_for_lifecycle_resume|wait_until_scheduled|wait_for_capacity|schedule_retry|request_client_acknowledgement|open_operator_review|enqueue_resume|show_scheduler_wait',
        clientStateSync: 'scheduler.resume_policy.client_state_sync.v1',
        dispatch: '{ allowed: boolean, optimistic: boolean, queue: string, idempotencyKey: string|null }',
        lifecycle: 'scheduler.resume_policy.lifecycle_settings.v1 summary plus scheduler.resume_policy.lifecycle_command_controls.v1',
        route: '{ name: string, params: object, returnTo: string|null }',
        visibleSignals: 'Record<string, unknown>'
      },
      clientStateSync: {
        contract: 'scheduler.resume_policy.client_state_sync.v1',
        stateId: 'string',
        previousRevision: 'number',
        nextRevision: 'number',
        refreshRequired: 'boolean',
        blocking: 'string[]',
        conflicts: 'Array<{ code: string, severity: error|warning, field: string, clientValue?: string, kernelValue?: string, ageMs?: number }>',
        patch: '{ op: create|replace, stateId: string, revision: number, observedAt: string, workflowState: string, nextAction: string, status: string, routeName: string, lifecycleRecommendedCommand: string }',
        userHandoff: '{ title: string, primaryAction: string, secondaryAction: string|null, visibleConflictCodes: string[] }',
        proof: '{ required: string[], blockingCodes: string[], conflictCodes: string[], scopes: string[] }',
        auditExport: '{ type: scheduler.resume_policy.client_state_sync, surfaceId: string, contract: string, generatedAt: string, stateId: string, refreshRequired: boolean, conflictCount: number, blockingCount: number, workflowState: string, nextAction: string }'
      },
      lifecycleCommandControls: {
        contract: 'scheduler.resume_policy.lifecycle_command_controls.v1',
        requestedCommand: 'enable|disable|pause|resume|drain|hold|cancel',
        recommendedCommand: 'enable|disable|pause|resume|drain|hold|cancel',
        actorCanManage: 'boolean',
        controls: 'Array<{ command: string, commandType: string, enabled: boolean, selected: boolean, disabledReason: string|null }>',
        commandRequest: 'scheduler.resume_policy.lifecycle_command_request.v1',
        commandMutation: '{ contract: scheduler.resume_policy.lifecycle_command_mutation.v1, present: boolean, dryRun: boolean, command: string|null, commandType: string|null, idempotencyKey: string|null, requestedBy: string, effectiveAt: string, scheduled: boolean, canApply: boolean, applyMode: none|preview|schedule|apply, blockedBy: string[], desiredPatch: object|null, audit: object }',
        nextCommand: '{ command: string, commandType: string, enabled: boolean, reason: string|null }',
        schedulePatch: '{ scheduleMode: string, delayUntil: string|null, delayMs: number, maintenanceWindow: object, concurrency: object, drainPolicy: string }',
        proof: '{ required: string[], blockingCodes: string[], lifecycleFindingCodes: string[], permissionGrantIds: string[], scopes: string[] }',
        auditExport: '{ type: scheduler.resume_policy.lifecycle_command_controls, surfaceId: string, contract: string, generatedAt: string, requestedCommand: string, recommendedCommand: string, actorCanManage: boolean, enabledControlCount: number, blockingCount: number }'
      },
      previewAcceptance: {
        contract: 'scheduler.resume_policy.preview_acceptance.v1',
        previewId: 'string',
        stateId: 'string',
        display: '{ title: string, status: ready|rejected|blocked|needs_review, summary: object }',
        readiness: '{ preview: boolean, acceptance: boolean, dispatch: boolean, audit: boolean, retry: boolean }',
        acceptance: '{ accepted: boolean, rejected: boolean, deferred: boolean, reviewRequested: boolean, available: boolean, required: boolean, acknowledgementRequired: boolean, reviewRequired: boolean, dispatchQueue: string, idempotencyKey: string|null, token: string|null, request: scheduler.resume_policy.preview_acceptance_request.v1 }',
        validationSummary: '{ valid: boolean, totalFindings: number, blockingCodes: string[], warningCodes: string[], boundaryDenyCodes: string[], boundaryReviewCodes: string[], lifecycleValid: boolean, retryableCodes: string[] }',
        nextStep: '{ action: string, label: string, routeName: string, owner: client|operator|scheduler|platform }',
        mutation: '{ contract: scheduler.resume_policy.preview_acceptance_mutation.v1, op: accept|reject|defer|request_review|none, canApply: boolean, blockedBy: string[], patch: object, audit: object }',
        route: '{ name: string, params: object, returnTo: string|null, acceptanceState: accepted|rejected|review_requested|deferred|pending }',
        explanation: 'string[]'
      },
      previewAcceptanceRequest: {
        contract: 'scheduler.resume_policy.preview_acceptance_request.v1',
        present: 'boolean',
        action: 'accept|reject|defer|request_review|string',
        requestedBy: 'string',
        requestedAt: 'string',
        reason: 'string',
        previewId: 'string',
        stateId: 'string',
        stateRevision: 'number',
        expectedRevision: 'number',
        idempotencyKey: 'string',
        token: 'string',
        routeName: 'string',
        ageMs: 'number|null',
        validation: '{ valid: boolean, findings: Array<{ code: string, severity: error|warning|info, field: string, value?: string, expectedRevision?: number, stateRevision?: number, ageMs?: number|null }> }'
      },
      analyticsInputs: {
        history: 'Array<{ observedAt?: string, outcome?: string, decision?: string, status?: string, retry?: object }>',
        resumeHistory: 'Array<scheduler.resume_policy.history_event>',
        auditHistory: 'Array<scheduler.resume_policy.history_event>'
      },
      analytics: {
        contract: 'scheduler.resume_policy.analytics.v1',
        counters: '{ totalEvaluations: number, historicalEvaluations: number, dispatchableEvaluations: number, deniedEvaluations: number, failedEvaluations: number, retryableEvaluations: number, reviewEvaluations: number, averageRetryDelayMs: number, maxQueueDepth: number }',
        outcomeCounts: 'Record<string, number>',
        signalCounts: '{ findings: Record<string, number>, errors: Record<string, number>, warnings: Record<string, number> }',
        timeline: 'Array<{ sequence: number, observedAt: string, resumeRequestId: string, outcome: string, dispatchable: boolean, retryAllowed: boolean, retryAfterMs: number, attempt: number, queueDepth: number, delta: object, signalCounts: object }>',
        recentWindow: '{ contract: scheduler.resume_policy.analytics_recent_window.v1, size: number, current: object, previous: object, trend: object }',
        reportingState: '{ contract: scheduler.resume_policy.analytics_reporting_state.v1, reportId: string, status: blocked|needs_review|ready|watch, freshness: object, counters: object, routeState: object, labels: object }',
        export: '{ config: scheduler.resume_policy.analytics_export_config.v1, ready: boolean, format: json|jsonl|csv, destination: string, rowCount: number, fields: string[], rows: Array<scheduler.resume_policy.analytics_export_row.v1> }',
        exportSummary: '{ surfaceId: string, currentOutcome: string, latestSignals: object, historyWindow: object, exportWindow: object }'
      },
      persistedState: {
        contract: 'scheduler.resume_policy.persisted_state.v1',
        checkpointId: 'string',
        resumeRequestId: 'string',
        runId: 'string',
        workspaceId: 'string',
        tenantId: 'string',
        idempotencyKey: 'string',
        attempt: 'number',
        status: 'missing|checkpointed|dispatching|retry_scheduled|awaiting_ack|review_required|blocked|cancelled|completed|dispatched|failed_terminal|stale',
        updatedAt: 'string',
        lease: '{ holder: string, expiresAt: string, expired: boolean }',
        freshness: '{ observedAt: string, ageMs: number|null, stale: boolean }',
        commandLedger: 'Array<{ contract: scheduler.resume_policy.command_ledger_entry.v1, commandId: string, idempotencyKey: string, type: string, status: string, terminal: boolean, active: boolean, retryableFailure: boolean, recordedAt: string, checkpointId: string, resultRef: string, replayToken: string }>',
        latestMatchingCommand: 'scheduler.resume_policy.command_ledger_entry.v1|null',
        latestActiveCommand: 'scheduler.resume_policy.command_ledger_entry.v1|null',
        latestTerminalCommand: 'scheduler.resume_policy.command_ledger_entry.v1|null'
      },
      recovery: {
        contract: 'scheduler.resume_policy.recovery.v1',
        restartSafeStatus: 'terminal_replay|duplicate_in_flight|recovered_after_restart|new_checkpoint_required|checkpoint_current',
        recoveryAction: 'return_persisted_terminal_result|suppress_duplicate_command|reclaim_expired_checkpoint|create_checkpoint|refresh_retry_checkpoint|advance_checkpoint',
        stateFindings: 'Array<{ code: string, severity: recover|replace|replay|audit, field: string, observedAt: string, checkpointId: string|null, resumeRequestId: string, ageMs?: number|null }>',
        checkpoint: '{ required: boolean, operation: none|create|reclaim|update, checkpointId: string, status: string, resumeRequestId: string, runId: string|null, workspaceId: string|null, tenantId: string|null, idempotencyKey: string|null, attempt: number, leaseTtlMs: number, leaseExpiresAt: string|null, compareAndSwap: object }',
        command: '{ emit: boolean, commandId: string, type: string, idempotencyKey: string|null, dedupeKey: string, expectedPreviousCheckpointId: string|null, statusIfRecorded: string, route: object }',
        persistencePatch: '{ contract: scheduler.resume_policy.persistence_patch.v1, op: none|create|reclaim|update, checkpointId: string, writeRequired: boolean, idempotent: boolean, status: string, leaseExpiresAt: string|null, findings: string[], audit: object }',
        replay: '{ safeToReplay: boolean, latestMatchingCommand: object|null, reasonCodes: string[] }'
      },
      dispatchPlan: {
        contract: 'scheduler.resume_policy.dispatch_plan.v1',
        mode: 'dispatch|retry|review|blocked|wait',
        ready: 'boolean',
        queue: 'resume-dispatch|resume-review|string',
        command: '{ emit: boolean, commandId: string|null, type: string, dispatchId: string, dedupeKey: string, idempotencyKey: string|null, expectedPreviousCheckpointId: string|null, checkpointId: string, leaseTtlMs: number, checkpointOperation: string, persistencePatch: scheduler.resume_policy.persistence_patch.v1, route: object }',
        target: '{ resumeRequestId: string, runId: string|null, tenantId: string|null, workspaceId: string|null, actorId: string }',
        gating: '{ decision: string, healthStatus: string, workflowState: string, previewAccepted: boolean, restartSafeStatus: string, recoveryAction: string, replaySafe: boolean, blockingCodes: string[], reviewCodes: string[] }',
        proof: '{ required: string[], permissionGrantIds: string[], scopes: string[], auditRef: string|null, previewId: string, clientStateId: string, checkpointRequired: boolean, checkpointOperation: string, recoveryFindingCodes: string[] }',
        auditExport: '{ type: scheduler.resume_policy.dispatch_plan, surfaceId: string, contract: string, generatedAt: string, outcome: string, commandType: string, commandEmit: boolean, queue: string, blockingCount: number, reviewCount: number }'
      },
      operationalHealth: {
        failureState: 'scheduler.resume_policy.failure_state.v1',
        providerNegotiation: 'scheduler.resume_policy.provider_capability_negotiation.v1',
        lifecycleErrorCodes: 'lifecycle_settings_invalid|lifecycle_command_request_invalid|resume_policy_disabled|resume_policy_paused|schedule_delay_pending|maintenance_window_inactive|lifecycle_concurrency_saturated|provider_capability_missing|provider_capability_unavailable',
        actionableErrors: 'Array<{ contract: scheduler.resume_policy.actionable_error.v1, code: string, owner: string, retryable: boolean, retryAfterMs: number, nextAction: string, evidence: object }>'
      }
    },
    policy: {
      allowedRoles: Array.from(DEFAULT_ALLOWED_ROLES),
      crossTenantRoles: Array.from(CROSS_TENANT_ROLES),
      scopes: boundary.scopes,
      findings: boundary.findings,
      permission: boundary.permission,
      workspaceAccess: boundary.workspaceAccess
    },
    operationalHealth,
    clientHandoff,
    previewAcceptance,
    recovery,
    dispatchPlan,
    providerHandoffState,
    analytics,
    auditHandoff,
    proof: {
      surfaceId,
      contract: 'scheduler.resume_policy.v1',
      decision: boundary.decision,
      healthStatus: operationalHealth.status,
      dispatchable: operationalHealth.dispatchable,
      retryAllowed: operationalHealth.retry.allowed,
      actorId: context.actor.id,
      tenantBoundary: context.workspace.tenantId || context.request.tenantId || null,
      workspaceBoundary: context.request.workspaceId || context.workspace.id || null,
      evidenceCount: Array.isArray(input.evidence) ? input.evidence.length : 0,
      historyCount: analytics.counters.historicalEvaluations,
      timelineCount: analytics.timeline.length,
      exportContract: analytics.contract,
      analyticsReportId: analytics.reportingState.reportId,
      analyticsReportStatus: analytics.reportingState.status,
      analyticsExportReady: analytics.export.ready,
      analyticsExportFormat: analytics.export.format,
      analyticsExportRowCount: analytics.export.rowCount,
      analyticsSeverityScore: analytics.reportingState.counters.severityScore,
      analyticsRecentSeverityDelta: analytics.recentWindow.trend.severityScoreDelta,
      clientHandoffContract: clientHandoff.contract,
      clientWorkflowState: clientHandoff.workflowState,
      clientNextAction: clientHandoff.nextAction,
      clientStateId: clientHandoff.stateId,
      clientStateSyncContract: clientHandoff.clientStateSync.contract,
      clientStateRefreshRequired: clientHandoff.clientStateSync.refreshRequired,
      clientStateConflictCount: clientHandoff.clientStateSync.conflicts.length,
      clientStateBlockingCount: clientHandoff.clientStateSync.blocking.length,
      clientStatePatchStatus: clientHandoff.clientStateSync.patch.status,
      clientStateNextRevision: clientHandoff.clientStateSync.nextRevision,
      clientStatePrimaryAction: clientHandoff.clientStateSync.userHandoff.primaryAction,
      previewAcceptanceContract: previewAcceptance.contract,
      previewAcceptanceStatus: previewAcceptance.display.status,
      previewAccepted: previewAcceptance.acceptance.accepted,
      previewAcceptanceAvailable: previewAcceptance.acceptance.available,
      previewAcceptanceRequestedAction: previewAcceptance.acceptance.request.action || null,
      previewAcceptanceRequestPresent: previewAcceptance.acceptance.request.present,
      previewAcceptanceRequestValid: previewAcceptance.acceptance.request.validation.valid,
      previewAcceptanceRequestFindingCount: previewAcceptance.acceptance.request.validation.findings.length,
      previewAcceptanceMutationOp: previewAcceptance.mutation.op,
      previewAcceptanceMutationCanApply: previewAcceptance.mutation.canApply,
      previewAcceptanceMutationBlockedCount: previewAcceptance.mutation.blockedBy.length,
      previewNextAction: previewAcceptance.nextStep.action,
      previewBlockingCount: previewAcceptance.validationSummary.blockingCodes.length,
      previewWarningCount: previewAcceptance.validationSummary.warningCodes.length,
      permissionContract: boundary.permission.contract,
      requiredPermissionAction: boundary.permission.requiredAction,
      permissionGrantAuthorized: boundary.permission.authorized,
      permissionGrantCount: boundary.permission.grants.length,
      matchingPermissionGrantCount: boundary.permission.matchingGrantIds.length,
      workspaceAccessContract: boundary.workspaceAccess.contract,
      workspaceAccessDecision: boundary.workspaceAccess.decision,
      workspaceAccessAuthority: boundary.workspaceAccess.membership.authority,
      workspaceAccessFindingCount: boundary.workspaceAccess.findings.length,
      workspaceAccessMemberOfWorkspace: boundary.workspaceAccess.membership.memberOfWorkspace,
      workspaceAccessTenantAligned: boundary.workspaceAccess.membership.tenantAligned,
      workspaceAccessWorkspaceTenantAligned: boundary.workspaceAccess.membership.workspaceTenantAligned,
      failureStateStatus: operationalHealth.failureState.status,
      failureStateConsecutiveFailures: operationalHealth.failureState.consecutiveFailures,
      lifecycleSettingsContract: context.scheduler.lifecycleSettings.contract,
      lifecycleEnabled: context.scheduler.lifecycleSettings.enabled,
      lifecycleCommand: context.scheduler.lifecycleSettings.command,
      lifecycleScheduleMode: context.scheduler.lifecycleSettings.scheduleMode,
      lifecycleDelayUntil: context.scheduler.lifecycleSettings.delay.until || null,
      lifecycleValidationValid: context.scheduler.lifecycleSettings.validation.valid,
      lifecycleValidationFindingCount: context.scheduler.lifecycleSettings.validation.findings.length,
      lifecycleCommandRequestPresent: context.scheduler.lifecycleCommandRequest.present,
      lifecycleCommandRequestValid: context.scheduler.lifecycleCommandRequest.validation.valid,
      lifecycleCommandRequestCommand: context.scheduler.lifecycleCommandRequest.command || null,
      lifecycleCommandRequestScheduled: context.scheduler.lifecycleCommandRequest.scheduled,
      lifecycleControlsContract: clientHandoff.lifecycle.commandControls.contract,
      lifecycleRecommendedCommand: clientHandoff.lifecycle.commandControls.recommendedCommand,
      lifecycleNextCommandEnabled: clientHandoff.lifecycle.commandControls.nextCommand.enabled,
      lifecycleEnabledControlCount: clientHandoff.lifecycle.commandControls.controls.filter((control) => control.enabled).length,
      lifecycleControlsBlockingCount: clientHandoff.lifecycle.commandControls.proof.blockingCodes.length,
      lifecycleCommandMutationCanApply: clientHandoff.lifecycle.commandMutation.canApply,
      lifecycleCommandMutationApplyMode: clientHandoff.lifecycle.commandMutation.applyMode,
      lifecycleCommandMutationBlockedCount: clientHandoff.lifecycle.commandMutation.blockedBy.length,
      actionableErrorCount: operationalHealth.actionableErrors.length,
      restartSafeStatus: recovery.restartSafeStatus,
      recoveryAction: recovery.recoveryAction,
      recoveryFindingCount: recovery.stateFindings.length,
      recoveryFindingCodes: recovery.stateFindings.map((finding) => finding.code),
      checkpointRequired: recovery.checkpoint.required,
      checkpointOperation: recovery.checkpoint.operation,
      checkpointLeaseExpiresAt: recovery.checkpoint.leaseExpiresAt,
      persistencePatchWriteRequired: recovery.persistencePatch.writeRequired,
      commandEmit: recovery.command.emit,
      commandId: recovery.command.commandId,
      dispatchPlanContract: dispatchPlan.contract,
      dispatchPlanMode: dispatchPlan.mode,
      dispatchPlanReady: dispatchPlan.ready,
      dispatchPlanQueue: dispatchPlan.queue,
      dispatchPlanBlockingCount: dispatchPlan.gating.blockingCodes.length,
      dispatchPlanReviewCount: dispatchPlan.gating.reviewCodes.length,
      dispatchCommandEmit: dispatchPlan.command.emit,
      dispatchCommandType: dispatchPlan.command.type,
      dispatchDedupeKey: dispatchPlan.command.dedupeKey,
      dispatchRequiredProofCount: dispatchPlan.proof.required.length,
      providerNegotiationContract: operationalHealth.providerNegotiation.contract,
      providerContractCount: operationalHealth.providerNegotiation.providers.length,
      providerRequiredCapabilityCount: operationalHealth.providerNegotiation.requiredCapabilities.length,
      providerReady: operationalHealth.providerNegotiation.ready,
      providerDegraded: operationalHealth.providerNegotiation.degraded,
      providerMissingCapabilityCount: operationalHealth.providerNegotiation.missingCapabilities.length,
      providerUnavailableCapabilityCount: operationalHealth.providerNegotiation.unavailableCapabilities.length,
      providerHandoffContract: providerHandoffState.contract,
      providerHandoffCanExternalize: providerHandoffState.canExternalize,
      providerExternalTargetCount: providerHandoffState.externalTargets.length,
      providerExternalStateCount: providerHandoffState.externalState.length,
      providerHandoffOperation: providerHandoffState.handoffPatch.op,
      providerSyncMaxLagMs: providerHandoffState.syncMetadata.maxLagMs,
      generatedAt: now
    },
    evidence: Array.isArray(input.evidence) ? input.evidence : []
  };
}

export default describeResumePolicySurface;
