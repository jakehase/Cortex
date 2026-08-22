export const surfaceId = "aios_scheduler_budget-manager_055";
export const surfaceGroup = "scheduler";
export const surfaceName = "budget-manager";

const SUPPORTED_BUDGET_UNITS = new Set(['tokens', 'milliseconds', 'usd_cents', 'operations']);
const SUPPORTED_HANDOFF_STATES = new Set(['none', 'pending', 'accepted', 'rejected', 'expired']);
const SUPPORTED_ACCEPTANCE_ACTIONS = new Set(['preview', 'reserve', 'commit', 'release']);
const SUPPORTED_CLIENT_PHASES = new Set(['draft', 'review', 'confirming', 'applying', 'complete', 'blocked']);
const SUPPORTED_HEALTH_STATES = new Set(['healthy', 'degraded', 'unavailable']);
const SUPPORTED_FAILURE_STATES = new Set(['none', 'transient', 'provider_unavailable', 'transport_offline', 'validation_blocked']);
const SUPPORTED_PROVIDER_PROTOCOLS = new Set(['in-process', 'https', 'message-bus']);
const SUPPORTED_SYNC_MODES = new Set(['snapshot', 'cursor', 'cursor+lease']);
const SUPPORTED_PERSISTED_COMMAND_STATUSES = new Set(['pending', 'applied', 'released', 'committed', 'failed', 'abandoned']);
const TERMINAL_PERSISTED_COMMAND_STATUSES = new Set(['applied', 'released', 'committed', 'failed', 'abandoned']);
const SUPPORTED_WORKSPACE_GRANT_STATES = new Set(['active', 'pending', 'revoked', 'expired']);
const SUPPORTED_LIFECYCLE_COMMANDS = new Set(['none', 'enable', 'disable', 'pause', 'resume', 'drain', 'hold', 'release_hold']);
const SUPPORTED_SCHEDULING_MODES = new Set(['normal', 'paused', 'draining', 'maintenance', 'disabled']);
const DEFAULT_RETRY_LIMIT = 3;
const WAVE_POLICY_MAX_WIDTH = 45;
const ROLE_PERMISSIONS = {
  viewer: ['budget.preview'],
  operator: ['budget.preview', 'budget.reserve', 'budget.release'],
  owner: ['budget.preview', 'budget.reserve', 'budget.release', 'budget.commit', 'handoff.accept'],
  auditor: ['budget.preview', 'audit.read'],
  system: ['budget.preview', 'budget.reserve', 'budget.release', 'budget.commit', 'handoff.accept', 'audit.read'],
};
const ACTION_PERMISSION = {
  preview: 'budget.preview',
  reserve: 'budget.reserve',
  commit: 'budget.commit',
  release: 'budget.release',
};

function asFiniteNonNegativeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function asNonEmptyString(value, fallback = null) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function uniqueStrings(values = []) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
}

function normalizeWorkspaceGrant(grant = {}, index, fallbackTenantId, nowMs) {
  const tenantId = asNonEmptyString(grant.tenantId, fallbackTenantId);
  const workspaceId = asNonEmptyString(grant.workspaceId, asNonEmptyString(grant.workspace));
  const declaredRoles = uniqueStrings(Array.isArray(grant.roles) ? grant.roles : [grant.role]);
  const rolePermissions = declaredRoles.flatMap((role) => ROLE_PERMISSIONS[role] || []);
  const explicitPermissions = uniqueStrings(grant.permissions);
  const requestedStatus = asNonEmptyString(grant.status, 'active');
  const status = SUPPORTED_WORKSPACE_GRANT_STATES.has(requestedStatus) ? requestedStatus : 'pending';
  const expiresAt = asNonEmptyString(grant.expiresAt);
  const expiresAtMs = expiresAt ? Date.parse(expiresAt) : null;
  const expired = expiresAtMs !== null && Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs;
  const effectiveStatus = expired ? 'expired' : status;

  return {
    grantId: asNonEmptyString(grant.grantId, workspaceId ? `workspace-grant-${index + 1}` : `invalid-workspace-grant-${index + 1}`),
    tenantId,
    workspaceId,
    scopeKey: tenantId && workspaceId ? `${tenantId}:${workspaceId}` : null,
    status: effectiveStatus,
    active: effectiveStatus === 'active' && Boolean(workspaceId),
    expiresAt,
    roles: declaredRoles,
    permissions: uniqueStrings([...rolePermissions, ...explicitPermissions]),
  };
}

function normalizeProvider(provider = {}) {
  const hostedKernelCapabilities = ['budget.reserve', 'budget.commit', 'budget.release', 'audit.proof', 'sync.cursor'];
  const requestedCapabilities = Array.isArray(provider.capabilities) && provider.capabilities.length > 0
    ? uniqueStrings(provider.capabilities)
    : hostedKernelCapabilities;
  const supportedCapabilities = new Set(hostedKernelCapabilities);
  const negotiated = requestedCapabilities.filter((capability) => supportedCapabilities.has(capability));
  const rejected = requestedCapabilities.filter((capability) => !supportedCapabilities.has(capability));
  const requestedProtocol = asNonEmptyString(provider.protocol, 'in-process');
  const protocol = SUPPORTED_PROVIDER_PROTOCOLS.has(requestedProtocol) ? requestedProtocol : 'in-process';
  const requestedSyncMode = asNonEmptyString(provider.syncMode, negotiated.includes('sync.cursor') ? 'cursor' : 'snapshot');
  const syncMode = SUPPORTED_SYNC_MODES.has(requestedSyncMode) ? requestedSyncMode : 'snapshot';
  const serviceEndpoint = asNonEmptyString(provider.serviceEndpoint, protocol === 'in-process' ? 'aios://kernel/scheduler/budget-manager' : null);

  return {
    providerId: typeof provider.providerId === 'string' && provider.providerId ? provider.providerId : 'hosted-kernel',
    contractVersion: typeof provider.contractVersion === 'string' && provider.contractVersion ? provider.contractVersion : '2026-07-01',
    capabilities: negotiated,
    rejectedCapabilities: rejected,
    service: {
      protocol,
      endpoint: serviceEndpoint,
      syncMode,
      maxBatchSize: Math.max(1, Math.trunc(asFiniteNonNegativeNumber(provider.maxBatchSize, 1))),
      leaseDurationMs: Math.trunc(asFiniteNonNegativeNumber(provider.leaseDurationMs, 300000)),
    },
    requiresExternalHandoff: provider.requiresExternalHandoff === true,
  };
}

function normalizeBudgetEnvelope(envelope = {}) {
  const unit = SUPPORTED_BUDGET_UNITS.has(envelope.unit) ? envelope.unit : 'tokens';
  const limit = asFiniteNonNegativeNumber(envelope.limit);
  const reserved = Math.min(asFiniteNonNegativeNumber(envelope.reserved), limit);
  const spent = Math.min(asFiniteNonNegativeNumber(envelope.spent), limit);
  const remaining = Math.max(0, limit - reserved - spent);
  const overBudget = reserved + spent > limit;

  return {
    unit,
    limit,
    reserved,
    spent,
    remaining,
    overBudget,
  };
}

function pickFiniteNonNegativeNumber(sources, fallback = 0) {
  for (const source of sources) {
    if (source !== undefined && source !== null) {
      const number = Number(source);
      if (Number.isFinite(number) && number >= 0) {
        return number;
      }
    }
  }
  return fallback;
}

function pickBooleanSetting(sources, fallback = false) {
  for (const source of sources) {
    if (typeof source === 'boolean') {
      return source;
    }
    if (typeof source === 'string') {
      const normalized = source.trim().toLowerCase();
      if (['true', 'enabled', 'on', 'yes'].includes(normalized)) {
        return true;
      }
      if (['false', 'disabled', 'off', 'no'].includes(normalized)) {
        return false;
      }
    }
  }
  return fallback;
}

function buildAccountingMeter(name, unit, limit, used, requested, reserved = 0) {
  const normalizedLimit = Math.trunc(asFiniteNonNegativeNumber(limit));
  const normalizedUsed = Math.trunc(asFiniteNonNegativeNumber(used));
  const normalizedReserved = Math.trunc(asFiniteNonNegativeNumber(reserved));
  const normalizedRequested = Math.trunc(asFiniteNonNegativeNumber(requested));
  const consumed = normalizedUsed + normalizedReserved;
  const remaining = normalizedLimit > 0 ? Math.max(0, normalizedLimit - consumed) : 0;
  const projected = consumed + normalizedRequested;
  const enforced = normalizedLimit > 0;

  return {
    name,
    unit,
    limit: normalizedLimit,
    used: normalizedUsed,
    reserved: normalizedReserved,
    requested: normalizedRequested,
    consumed,
    remaining,
    projected,
    enforced,
    fits: !enforced || projected <= normalizedLimit,
    overflow: enforced ? Math.max(0, projected - normalizedLimit) : 0,
  };
}

function getAccountingMeter(meters, name) {
  return meters.find((meter) => meter.name === name) || buildAccountingMeter(name, 'units', 0, 0, 0);
}

function buildReservationLedger(meters) {
  return meters.map((meter) => ({
    meter: meter.name,
    unit: meter.unit,
    before: {
      used: meter.used,
      reserved: meter.reserved,
      consumed: meter.consumed,
      remaining: meter.remaining,
    },
    reservation: {
      requested: meter.requested,
      accepted: meter.fits ? meter.requested : Math.max(0, meter.requested - meter.overflow),
      overflow: meter.overflow,
    },
    after: {
      projected: meter.projected,
      remaining: meter.enforced ? Math.max(0, meter.limit - meter.projected) : meter.remaining,
      fits: meter.fits,
    },
  }));
}

function buildWaveAdmissionDecision(waveMeter, mutationRequested) {
  const availableSlots = waveMeter.enforced
    ? Math.max(0, waveMeter.limit - waveMeter.consumed)
    : Number.POSITIVE_INFINITY;
  const admittedSlots = mutationRequested
    ? Math.min(waveMeter.requested, availableSlots)
    : 0;
  const deferredSlots = mutationRequested
    ? Math.max(0, waveMeter.requested - admittedSlots)
    : 0;
  const projectedWidth = waveMeter.projected;
  const saturationRatio = waveMeter.limit > 0
    ? Number((Math.min(projectedWidth, waveMeter.limit) / waveMeter.limit).toFixed(4))
    : 0;
  const status = !mutationRequested
    ? 'preview_only'
    : !waveMeter.fits
      ? 'defer_until_wave_capacity'
      : projectedWidth === waveMeter.limit
        ? 'admit_at_wave_limit'
        : projectedWidth >= Math.ceil(waveMeter.limit * 0.9)
          ? 'admit_near_wave_limit'
          : 'admit';

  return {
    status,
    maxWidth: WAVE_POLICY_MAX_WIDTH,
    configuredWidth: waveMeter.limit,
    activeWidth: waveMeter.consumed,
    requestedSlots: waveMeter.requested,
    admittedSlots,
    deferredSlots,
    availableSlots: Number.isFinite(availableSlots) ? availableSlots : null,
    projectedWidth,
    saturationRatio,
    shouldThrottle: status === 'defer_until_wave_capacity' || status === 'admit_near_wave_limit' || status === 'admit_at_wave_limit',
  };
}

function buildAccountingPlan(meters, acceptanceRequest, retryLimit, waveWidthLimit, mutationRequested, now) {
  const tokenMeter = getAccountingMeter(meters, 'tokens');
  const messageMeter = getAccountingMeter(meters, 'messages');
  const wallClockMeter = getAccountingMeter(meters, 'wallClock');
  const retryMeter = getAccountingMeter(meters, 'retries');
  const waveMeter = getAccountingMeter(meters, 'waveConcurrency');
  const ledger = buildReservationLedger(meters);
  const exhaustedMeters = meters.filter((meter) => meter.enforced && !meter.fits);
  const retryBudgetRemaining = Math.max(0, retryLimit - retryMeter.consumed);
  const canRetryAfterFailure = retryMeter.requested === 0 || retryMeter.fits;
  const waveAdmission = buildWaveAdmissionDecision(waveMeter, mutationRequested);
  const onlyWaveCapacityBlocked = exhaustedMeters.length > 0
    && exhaustedMeters.every((meter) => meter.name === 'waveConcurrency');
  const admissionStatus = onlyWaveCapacityBlocked
    ? waveAdmission.status
    : exhaustedMeters.length > 0
      ? 'blocked'
      : waveAdmission.status;

  return {
    schema: 'scheduler.budget-manager.accounting-plan.v1',
    generatedAt: now,
    action: acceptanceRequest.action,
    mutationRequested,
    admission: {
      status: admissionStatus,
      canEnterWave: exhaustedMeters.length === 0 && waveAdmission.deferredSlots === 0,
      blockedMeters: exhaustedMeters.map((meter) => meter.name),
      wave: waveAdmission,
    },
    reservations: {
      tokens: tokenMeter.requested,
      messages: messageMeter.requested,
      wallClockMs: wallClockMeter.requested,
      retries: retryMeter.requested,
      waveSlots: waveMeter.requested,
      ledger,
    },
    retry: {
      retryLimit,
      attemptsUsed: retryMeter.consumed,
      attemptsRequested: retryMeter.requested,
      attemptsRemaining: retryBudgetRemaining,
      canRetryAfterFailure,
      exhausted: retryMeter.enforced && !retryMeter.fits,
    },
    policy: {
      waveWidthLimit,
      maxWaveWidth: WAVE_POLICY_MAX_WIDTH,
      retryLimit,
    },
  };
}

function buildAccountingWorkflowSignal(budgetAccounting) {
  const plan = budgetAccounting && budgetAccounting.plan ? budgetAccounting.plan : null;
  const admission = plan ? plan.admission : {};
  const wave = admission.wave || {};
  const retry = plan ? plan.retry : {};
  const blockedMeters = Array.isArray(admission.blockedMeters) ? admission.blockedMeters : [];
  const onlyWaveCapacityBlocked = blockedMeters.length > 0
    && blockedMeters.every((meter) => meter === 'waveConcurrency');
  const retryExhausted = retry.exhausted === true || blockedMeters.includes('retries');
  const wallClockBlocked = blockedMeters.includes('wallClock');
  const messageBlocked = blockedMeters.includes('messages');
  const tokenBlocked = blockedMeters.includes('tokens');
  const deferredWaveSlots = Math.trunc(asFiniteNonNegativeNumber(wave.deferredSlots));
  const waveCapacityBlocked = onlyWaveCapacityBlocked && deferredWaveSlots > 0;
  const waveThrottleAdvised = !waveCapacityBlocked && wave.shouldThrottle === true;
  const capacityHold = waveCapacityBlocked || retryExhausted || wallClockBlocked || messageBlocked || tokenBlocked;
  const holdReason = waveCapacityBlocked
    ? 'wave_capacity'
    : retryExhausted
      ? 'retry_budget'
      : wallClockBlocked
        ? 'wall_clock_budget'
        : messageBlocked
          ? 'message_budget'
          : tokenBlocked
            ? 'token_budget'
            : waveThrottleAdvised
              ? 'wave_throttle'
              : null;
  const status = waveCapacityBlocked
    ? 'wave_capacity_pending'
    : retryExhausted
      ? 'retry_budget_exhausted'
      : wallClockBlocked
        ? 'wall_clock_blocked'
        : messageBlocked
          ? 'message_budget_blocked'
          : tokenBlocked
            ? 'token_budget_blocked'
            : waveThrottleAdvised
              ? 'wave_throttle_advised'
              : budgetAccounting && budgetAccounting.status ? budgetAccounting.status : 'unknown';
  const targetSurface = waveCapacityBlocked
    ? 'scheduler.wave-capacity'
    : retryExhausted
      ? 'scheduler.retry-review'
      : capacityHold
        ? 'scheduler.budget-editor'
        : waveThrottleAdvised
          ? 'scheduler.wave-monitor'
          : null;
  const primaryAction = waveCapacityBlocked
    ? 'wait_for_capacity'
    : retryExhausted
      ? 'review_retries'
      : capacityHold
        ? 'edit_budget'
        : waveThrottleAdvised
          ? 'throttle'
          : null;
  const title = waveCapacityBlocked
    ? 'Wave capacity pending'
    : retryExhausted
      ? 'Retry budget exhausted'
      : wallClockBlocked
        ? 'Wall-clock budget exceeded'
        : messageBlocked
          ? 'Message budget exceeded'
          : tokenBlocked
            ? 'Token budget exceeded'
            : waveThrottleAdvised
              ? 'Wave near capacity'
              : null;

  return {
    schema: 'scheduler.budget-manager.accounting-workflow-signal.v1',
    status,
    holdReason,
    capacityHold,
    waveCapacityBlocked,
    retryExhausted,
    waveThrottleAdvised,
    targetSurface,
    primaryAction,
    title,
    disabled: capacityHold,
    blockedMeters,
    deferredWaveSlots,
    projectedWaveWidth: asFiniteNonNegativeNumber(wave.projectedWidth),
    configuredWaveWidth: asFiniteNonNegativeNumber(wave.configuredWidth),
    retryAttemptsRemaining: asFiniteNonNegativeNumber(retry.attemptsRemaining),
  };
}

function normalizeBudgetAccounting(input, budgetEnvelope, acceptanceRequest, clientRuntime, operationalHealth, now) {
  const accounting = input.accounting && typeof input.accounting === 'object' ? input.accounting : {};
  const usage = accounting.usage && typeof accounting.usage === 'object' ? accounting.usage : accounting;
  const limits = accounting.limits && typeof accounting.limits === 'object' ? accounting.limits : accounting;
  const wave = accounting.wave && typeof accounting.wave === 'object' ? accounting.wave : {};
  const mutationRequested = acceptanceRequest.action !== 'preview';
  const retryLimit = Math.max(0, Math.trunc(pickFiniteNonNegativeNumber([
    limits.retryLimit,
    limits.maxRetries,
    accounting.retryLimit,
    input.retryLimit,
  ], DEFAULT_RETRY_LIMIT)));
  const waveWidthLimit = Math.min(WAVE_POLICY_MAX_WIDTH, Math.max(1, Math.trunc(pickFiniteNonNegativeNumber([
    wave.maxWidth,
    limits.waveWidth,
    limits.maxWaveWidth,
    input.maxWaveWidth,
  ], WAVE_POLICY_MAX_WIDTH))));
  const currentWaveWidth = Math.trunc(pickFiniteNonNegativeNumber([
    wave.active,
    wave.inFlight,
    wave.currentWidth,
    accounting.activeWaveWidth,
    input.activeWaveWidth,
  ]));
  const requestedWaveSlots = mutationRequested ? Math.max(1, Math.trunc(pickFiniteNonNegativeNumber([
    wave.requestedSlots,
    accounting.requestedWaveSlots,
    input.requestedWaveSlots,
  ], 1))) : 0;
  const retryCount = Math.max(
    clientRuntime.transport.retryCount,
    operationalHealth.retryPolicy.retryCount,
    Math.trunc(pickFiniteNonNegativeNumber([usage.retries, accounting.retries])),
  );

  const meters = [
    buildAccountingMeter(
      'tokens',
      'tokens',
      pickFiniteNonNegativeNumber([limits.tokens, limits.tokenLimit, accounting.tokenLimit], budgetEnvelope.unit === 'tokens' ? budgetEnvelope.limit : 0),
      pickFiniteNonNegativeNumber([usage.tokens, usage.tokenSpent], budgetEnvelope.unit === 'tokens' ? budgetEnvelope.spent : 0),
      pickFiniteNonNegativeNumber([accounting.requestedTokens, input.requestedTokens], budgetEnvelope.unit === 'tokens' && mutationRequested ? acceptanceRequest.amount : 0),
      pickFiniteNonNegativeNumber([usage.reservedTokens], budgetEnvelope.unit === 'tokens' ? budgetEnvelope.reserved : 0),
    ),
    buildAccountingMeter(
      'messages',
      'messages',
      pickFiniteNonNegativeNumber([limits.messages, limits.messageLimit, accounting.messageLimit, input.messageLimit]),
      pickFiniteNonNegativeNumber([usage.messages, input.messageCount]),
      pickFiniteNonNegativeNumber([accounting.requestedMessages, input.requestedMessages], mutationRequested ? 1 : 0),
    ),
    buildAccountingMeter(
      'wallClock',
      'milliseconds',
      pickFiniteNonNegativeNumber([limits.wallClockMs, limits.wallClockLimitMs, accounting.wallClockLimitMs, input.wallClockLimitMs]),
      pickFiniteNonNegativeNumber([usage.wallClockMs, usage.elapsedMs, input.elapsedMs]),
      pickFiniteNonNegativeNumber([accounting.requestedWallClockMs, input.requestedWallClockMs]),
    ),
    buildAccountingMeter('retries', 'attempts', retryLimit, retryCount, operationalHealth.retryPolicy.retryable ? 1 : 0),
    buildAccountingMeter('waveConcurrency', 'workers', waveWidthLimit, currentWaveWidth, requestedWaveSlots),
  ];
  const accountingPlan = buildAccountingPlan(meters, acceptanceRequest, retryLimit, waveWidthLimit, mutationRequested, now);
  const blockingMeters = meters.filter((meter) => !meter.fits);
  const warningMeters = meters.filter((meter) => meter.enforced && meter.fits && meter.remaining <= Math.max(1, Math.ceil(meter.limit * 0.1)));

  return {
    schema: 'scheduler.budget-manager.accounting.v1',
    generatedAt: now,
    policy: {
      waveWidthLimit,
      maxWaveWidth: WAVE_POLICY_MAX_WIDTH,
      retryLimit,
      mutationConsumesWaveSlot: mutationRequested,
    },
    status: blockingMeters.length > 0 ? 'blocked' : warningMeters.length > 0 ? 'near_limit' : 'within_budget',
    canSchedule: blockingMeters.length === 0,
    blockingReasons: blockingMeters.map((meter) => `${meter.name} exceeds ${meter.limit} ${meter.unit}`),
    warningReasons: warningMeters.map((meter) => `${meter.name} has ${meter.remaining} ${meter.unit} remaining`),
    plan: accountingPlan,
    meters,
  };
}

function normalizeLifecycleControls(input, acceptanceRequest, budgetAccounting, now) {
  const lifecycle = input.lifecycle && typeof input.lifecycle === 'object' ? input.lifecycle : {};
  const settings = input.settings && typeof input.settings === 'object' ? input.settings : {};
  const scheduling = input.scheduling && typeof input.scheduling === 'object' ? input.scheduling : {};
  const rawCommand = asNonEmptyString(lifecycle.command, asNonEmptyString(input.lifecycleCommand, 'none'));
  const command = SUPPORTED_LIFECYCLE_COMMANDS.has(rawCommand) ? rawCommand : 'none';
  const requestedMode = asNonEmptyString(
    lifecycle.mode,
    asNonEmptyString(settings.schedulingMode, asNonEmptyString(scheduling.mode, 'normal')),
  );
  const mode = SUPPORTED_SCHEDULING_MODES.has(requestedMode) ? requestedMode : 'normal';
  const enabled = pickBooleanSetting([lifecycle.enabled, settings.enabled, scheduling.enabled], mode !== 'disabled');
  const mutationsEnabled = pickBooleanSetting(
    [lifecycle.mutationsEnabled, settings.mutationsEnabled, scheduling.mutationsEnabled],
    enabled,
  );
  const paused = pickBooleanSetting(
    [lifecycle.paused, settings.paused, scheduling.paused],
    mode === 'paused' || mode === 'draining' || mode === 'maintenance',
  );
  const hold = pickBooleanSetting([lifecycle.hold, settings.hold, scheduling.hold], false);
  const drainRequested = command === 'drain' || mode === 'draining';
  const mutationRequested = acceptanceRequest.action !== 'preview';
  const invalidCommand = rawCommand !== command;
  const invalidMode = requestedMode !== mode;
  const nextEnabled = command === 'enable'
    ? true
    : command === 'disable'
      ? false
      : enabled;
  const nextPaused = command === 'resume' || command === 'release_hold'
    ? false
    : command === 'pause' || command === 'hold' || drainRequested
      ? true
      : paused || hold;
  const nextMode = !nextEnabled
    ? 'disabled'
    : command === 'resume' || command === 'release_hold'
      ? 'normal'
      : drainRequested
        ? 'draining'
        : command === 'pause' || command === 'hold'
          ? 'paused'
          : mode;
  const terminalHold = !nextEnabled || nextPaused || nextMode === 'maintenance';
  const lifecycleScheduleAllowed = !terminalHold;
  const scheduleAllowed = lifecycleScheduleAllowed && budgetAccounting.canSchedule;
  const mutationAllowed = !mutationRequested || (lifecycleScheduleAllowed && mutationsEnabled);
  const validationIssues = [
    invalidCommand ? `Unsupported lifecycle command ${rawCommand}.` : null,
    invalidMode ? `Unsupported scheduling mode ${requestedMode}.` : null,
    !nextEnabled && mutationRequested ? 'Budget manager lifecycle is disabled for mutations.' : null,
    nextPaused && mutationRequested ? 'Scheduling is paused for this budget manager lifecycle.' : null,
    nextMode === 'maintenance' && mutationRequested ? 'Maintenance mode allows preview only.' : null,
    !mutationsEnabled && mutationRequested ? 'Mutation controls are disabled in settings.' : null,
  ].filter(Boolean);
  const nextAction = invalidCommand || invalidMode
    ? 'fix_lifecycle_settings'
    : !nextEnabled
      ? 'enable_budget_manager'
      : nextPaused
        ? 'resume_scheduling'
        : !mutationsEnabled && mutationRequested
          ? 'enable_mutations'
          : budgetAccounting.canSchedule
            ? 'continue'
            : 'resolve_budget_accounting';

  return {
    schema: 'scheduler.budget-manager.lifecycle-controls.v1',
    generatedAt: now,
    command,
    commandValid: !invalidCommand,
    requestedMode,
    mode,
    modeValid: !invalidMode,
    current: {
      enabled,
      paused,
      hold,
      mutationsEnabled,
      schedulingMode: mode,
    },
    projected: {
      enabled: nextEnabled,
      paused: nextPaused,
      mutationsEnabled,
      schedulingMode: nextMode,
    },
    scheduling: {
      scheduleAllowed,
      lifecycleScheduleAllowed,
      accountingCanSchedule: budgetAccounting.canSchedule,
      mutationAllowed,
      previewAllowed: true,
      drainRequested,
      maxWaveWidth: budgetAccounting.policy.maxWaveWidth,
      configuredWaveWidth: budgetAccounting.policy.waveWidthLimit,
    },
    validationIssues,
    status: validationIssues.length > 0
      ? 'blocked'
      : !mutationRequested
        ? 'preview_allowed'
        : mutationAllowed
          ? 'enabled'
          : 'disabled',
    nextAction,
  };
}

function normalizeTenantBoundary(input = {}, now) {
  const tenant = input.tenant && typeof input.tenant === 'object' ? input.tenant : {};
  const workspace = input.workspace && typeof input.workspace === 'object' ? input.workspace : {};
  const principal = input.principal && typeof input.principal === 'object' ? input.principal : {};
  const parsedNow = Date.parse(now);
  const nowMs = Number.isFinite(parsedNow) ? parsedNow : Date.now();
  const tenantId = asNonEmptyString(tenant.tenantId, asNonEmptyString(input.tenantId, 'tenant:default'));
  const workspaceId = asNonEmptyString(workspace.workspaceId, asNonEmptyString(input.workspaceId, 'workspace:default'));
  const principalTenantId = asNonEmptyString(principal.tenantId, tenantId);
  const workspaceTenantId = asNonEmptyString(workspace.tenantId, tenantId);
  const declaredRoles = uniqueStrings(Array.isArray(principal.roles) ? principal.roles : [principal.role]);
  const roles = declaredRoles.length > 0 ? declaredRoles : ['viewer'];
  const rolePermissions = roles.flatMap((role) => ROLE_PERMISSIONS[role] || []);
  const explicitPermissions = uniqueStrings(principal.permissions);
  const rawWorkspaceGrants = Array.isArray(principal.workspaceGrants)
    ? principal.workspaceGrants
    : Array.isArray(principal.grants)
      ? principal.grants
      : Array.isArray(input.workspaceGrants)
        ? input.workspaceGrants
        : [];
  const workspaceGrants = rawWorkspaceGrants.map((grant, index) => normalizeWorkspaceGrant(grant, index, tenantId, nowMs));
  const matchingWorkspaceGrants = workspaceGrants.filter((grant) => (
    grant.tenantId === tenantId
    && grant.workspaceId === workspaceId
  ));
  const activeWorkspaceGrant = matchingWorkspaceGrants.find((grant) => grant.active) || null;
  const scopedPermissions = activeWorkspaceGrant ? activeWorkspaceGrant.permissions : [];
  const permissions = uniqueStrings([...rolePermissions, ...explicitPermissions, ...scopedPermissions]);
  const allowedWorkspaceIds = uniqueStrings(principal.allowedWorkspaceIds);
  const workspaceAllowedByList = allowedWorkspaceIds.length === 0 || allowedWorkspaceIds.includes(workspaceId);
  const workspaceGrantRequired = workspaceGrants.length > 0;
  const workspaceAllowed = workspaceAllowedByList
    && (!workspaceGrantRequired || Boolean(activeWorkspaceGrant));
  const tenantMatches = principalTenantId === tenantId && workspaceTenantId === tenantId;
  const grantStatus = !workspaceGrantRequired
    ? 'not_required'
    : activeWorkspaceGrant
      ? 'active'
      : matchingWorkspaceGrants.length > 0
        ? matchingWorkspaceGrants[0].status
        : 'missing';

  return {
    schema: 'scheduler.budget-manager.tenant-boundary.v1',
    tenantId,
    workspaceId,
    principal: {
      principalId: asNonEmptyString(principal.principalId, 'anonymous'),
      tenantId: principalTenantId,
      roles,
      permissions,
      declaredPermissions: explicitPermissions,
      scopedPermissions,
    },
    workspace: {
      workspaceId,
      tenantId: workspaceTenantId,
      scopeKey: `${tenantId}:${workspaceId}`,
      allowedWorkspaceIds,
      grantRequired: workspaceGrantRequired,
      activeGrantId: activeWorkspaceGrant ? activeWorkspaceGrant.grantId : null,
      grantStatus,
    },
    isolation: {
      tenantMatches,
      workspaceAllowed,
      workspaceAllowedByList,
      matchingWorkspaceGrantCount: matchingWorkspaceGrants.length,
      status: tenantMatches && workspaceAllowed ? 'isolated' : 'blocked',
    },
    workspaceGrants: workspaceGrants.map((grant) => ({
      grantId: grant.grantId,
      tenantId: grant.tenantId,
      workspaceId: grant.workspaceId,
      scopeKey: grant.scopeKey,
      status: grant.status,
      active: grant.active,
      expiresAt: grant.expiresAt,
      permissions: grant.permissions,
    })),
  };
}

function buildPermissionBoundary(tenantBoundary, acceptanceRequest, handoff) {
  const requiredPermission = ACTION_PERMISSION[acceptanceRequest.action] || 'budget.preview';
  const hasActionPermission = tenantBoundary.principal.permissions.includes(requiredPermission);
  const permissionSource = tenantBoundary.principal.scopedPermissions.includes(requiredPermission)
    ? 'workspace_grant'
    : tenantBoundary.principal.declaredPermissions.includes(requiredPermission)
      ? 'principal_permission'
      : tenantBoundary.principal.roles.some((role) => (ROLE_PERMISSIONS[role] || []).includes(requiredPermission))
        ? 'principal_role'
        : null;
  const handoffPermissionRequired = handoff.required && handoff.state === 'accepted';
  const hasHandoffPermission = !handoffPermissionRequired
    || tenantBoundary.principal.permissions.includes('handoff.accept');
  const mutationRequested = acceptanceRequest.action !== 'preview';
  const workspaceGrantSatisfied = !tenantBoundary.workspace.grantRequired
    || tenantBoundary.workspace.grantStatus === 'active';
  const allowed = tenantBoundary.isolation.status === 'isolated'
    && hasActionPermission
    && hasHandoffPermission;

  return {
    schema: 'scheduler.budget-manager.permission-boundary.v1',
    allowed,
    requiredPermission,
    permissionSource,
    mutationRequested,
    tenantId: tenantBoundary.tenantId,
    workspaceId: tenantBoundary.workspaceId,
    principalId: tenantBoundary.principal.principalId,
    workspaceGrant: {
      required: tenantBoundary.workspace.grantRequired,
      activeGrantId: tenantBoundary.workspace.activeGrantId,
      status: tenantBoundary.workspace.grantStatus,
      matchingGrantCount: tenantBoundary.isolation.matchingWorkspaceGrantCount,
    },
    checks: [
      {
        code: 'tenant.scope.matches',
        passed: tenantBoundary.isolation.tenantMatches,
        severity: tenantBoundary.isolation.tenantMatches ? 'info' : 'error',
        message: tenantBoundary.isolation.tenantMatches
          ? 'Principal, workspace, and budget tenant scopes match.'
          : 'Principal or workspace tenant scope does not match the budget tenant.',
      },
      {
        code: 'workspace.scope.allowed',
        passed: tenantBoundary.isolation.workspaceAllowedByList,
        severity: tenantBoundary.isolation.workspaceAllowedByList ? 'info' : 'error',
        message: tenantBoundary.isolation.workspaceAllowedByList
          ? 'Principal workspace allow-list includes this workspace or no allow-list is configured.'
          : 'Principal is not allowed to operate in this workspace.',
      },
      {
        code: 'workspace.grant.active',
        passed: workspaceGrantSatisfied,
        severity: workspaceGrantSatisfied ? 'info' : 'error',
        message: workspaceGrantSatisfied
          ? tenantBoundary.workspace.grantRequired
            ? 'An active workspace-scoped grant authorizes this workspace.'
            : 'Workspace-scoped grant is not required for this principal.'
          : tenantBoundary.workspace.grantStatus === 'missing'
            ? 'Principal has workspace grants, but none match this tenant and workspace.'
            : `Workspace grant is ${tenantBoundary.workspace.grantStatus}; an active grant is required.`,
      },
      {
        code: 'permission.action.allowed',
        passed: hasActionPermission,
        severity: hasActionPermission ? 'info' : 'error',
        message: hasActionPermission
          ? `Principal has permission for the requested budget action via ${permissionSource || 'effective permissions'}.`
          : `Principal is missing ${requiredPermission} for this budget action.`,
      },
      {
        code: 'permission.handoff.accept',
        passed: hasHandoffPermission,
        severity: hasHandoffPermission ? 'info' : 'error',
        message: hasHandoffPermission
          ? 'Handoff permission boundary is satisfied.'
          : 'Accepting external handoff requires handoff.accept permission.',
      },
    ],
  };
}

function normalizeClientRuntimeState(input, acceptanceRequest, syncMetadata) {
  const runtime = input.clientRuntime && typeof input.clientRuntime === 'object' ? input.clientRuntime : {};
  const workflow = runtime.workflow && typeof runtime.workflow === 'object' ? runtime.workflow : {};
  const requestedPhase = asNonEmptyString(runtime.phase, acceptanceRequest.action === 'preview' ? 'review' : 'confirming');
  const phase = SUPPORTED_CLIENT_PHASES.has(requestedPhase) ? requestedPhase : 'review';
  const routeId = acceptanceRequest.routeId
    || asNonEmptyString(runtime.routeId)
    || asNonEmptyString(input.routeId);
  const requestId = asNonEmptyString(runtime.requestId)
    || asNonEmptyString(input.requestId)
    || `budget-${surfaceName}-${syncMetadata.sequence}`;
  const traceId = asNonEmptyString(runtime.traceId)
    || asNonEmptyString(input.traceId)
    || requestId;

  return {
    schema: 'scheduler.budget-manager.client-runtime.v1',
    request: {
      requestId,
      traceId,
      routeId,
      clientMutationId: acceptanceRequest.clientMutationId,
    },
    phase,
    transport: {
      channel: asNonEmptyString(runtime.channel, 'hosted-kernel'),
      queueDepth: Math.trunc(asFiniteNonNegativeNumber(runtime.queueDepth)),
      retryCount: Math.trunc(asFiniteNonNegativeNumber(runtime.retryCount)),
      offline: runtime.offline === true,
    },
    workflow: {
      stepId: asNonEmptyString(workflow.stepId, acceptanceRequest.action === 'preview' ? 'budget-preview' : 'budget-acceptance'),
      panel: asNonEmptyString(workflow.panel, 'scheduler-budget'),
      returnTo: asNonEmptyString(workflow.returnTo, routeId ? `scheduler-route:${routeId}` : 'scheduler-queue'),
    },
    sync: {
      cursor: syncMetadata.cursor,
      sequence: syncMetadata.sequence,
      freshness: syncMetadata.freshness,
    },
  };
}

function normalizeAcceptanceRequest(input = {}) {
  const request = input.acceptance && typeof input.acceptance === 'object' ? input.acceptance : {};
  const requestedAction = typeof request.action === 'string' ? request.action : input.action;
  const action = SUPPORTED_ACCEPTANCE_ACTIONS.has(requestedAction) ? requestedAction : 'preview';
  const amount = asFiniteNonNegativeNumber(request.amount, asFiniteNonNegativeNumber(input.requestedAmount));
  const routeId = typeof request.routeId === 'string' && request.routeId ? request.routeId : null;
  const clientMutationId = typeof request.clientMutationId === 'string' && request.clientMutationId
    ? request.clientMutationId
    : null;

  return {
    action,
    amount,
    routeId,
    clientMutationId,
    dryRun: request.dryRun !== false,
  };
}

function normalizeOperationalHealth(input, providerContract, clientRuntime) {
  const source = input.operationalHealth && typeof input.operationalHealth === 'object'
    ? input.operationalHealth
    : input.health && typeof input.health === 'object'
      ? input.health
      : {};
  const requestedStatus = asNonEmptyString(source.status, providerContract.rejectedCapabilities.length > 0 ? 'degraded' : 'healthy');
  const offline = clientRuntime.transport.offline === true;
  const status = offline
    ? 'unavailable'
    : SUPPORTED_HEALTH_STATES.has(requestedStatus)
      ? requestedStatus
      : 'healthy';
  const requestedFailureState = asNonEmptyString(source.failureState, 'none');
  const failureState = offline
    ? 'transport_offline'
    : status === 'unavailable'
      ? 'provider_unavailable'
      : status === 'degraded'
        ? 'transient'
        : SUPPORTED_FAILURE_STATES.has(requestedFailureState)
          ? requestedFailureState
          : 'none';
  const retryCount = Math.trunc(asFiniteNonNegativeNumber(source.retryCount, clientRuntime.transport.retryCount));
  const baseDelayMs = Math.max(250, Math.trunc(asFiniteNonNegativeNumber(source.baseDelayMs, 500)));
  const maxDelayMs = Math.max(baseDelayMs, Math.trunc(asFiniteNonNegativeNumber(source.maxDelayMs, 8000)));
  const retryable = ['transient', 'provider_unavailable', 'transport_offline'].includes(failureState);
  const nextDelayMs = retryable ? Math.min(maxDelayMs, baseDelayMs * (2 ** Math.min(retryCount, 5))) : 0;
  const mutationSafe = status === 'healthy' && failureState === 'none';
  const readOnly = status === 'degraded' || failureState === 'transient';

  return {
    schema: 'scheduler.budget-manager.operational-health.v1',
    status,
    failureState,
    degradedMode: {
      enabled: !mutationSafe,
      readOnly,
      reason: mutationSafe
        ? null
        : offline
          ? 'Client transport is offline; budget mutations are suspended.'
          : status === 'degraded'
            ? 'Provider health is degraded; only preview and proof generation are allowed.'
            : 'Provider is unavailable; retry before applying budget mutations.',
    },
    retryPolicy: {
      retryable,
      retryCount,
      nextDelayMs,
      maxDelayMs,
      backoff: retryable ? 'exponential' : 'none',
    },
    actionableError: mutationSafe
      ? null
      : {
          code: `budget.health.${failureState}`,
          label: offline ? 'Reconnect scheduler transport' : status === 'degraded' ? 'Wait for provider recovery' : 'Retry hosted-kernel provider',
          detail: offline
            ? 'Reconnect the client transport before reserving, committing, or releasing budget.'
            : status === 'degraded'
              ? 'Use preview mode while the provider is degraded, then retry the mutation after health recovers.'
              : 'The hosted-kernel provider did not report an available mutation path.',
        },
  };
}

function buildWorkflowHandoff(clientRuntime, acceptanceRequest, acceptanceContract, readiness, externalHandoff, validationSummary, permissionBoundary, operationalHealth, lifecycleControls) {
  const blocked = validationSummary.status === 'blocked';
  const accountingSignal = buildAccountingWorkflowSignal(validationSummary.budgetAccounting);
  const accountingBlocked = accountingSignal.capacityHold;
  const accountingThrottled = accountingSignal.waveThrottleAdvised;
  const waitingForExternal = externalHandoff.required && externalHandoff.state === 'pending';
  const permissionBlocked = !permissionBoundary.allowed;
  const healthBlocked = operationalHealth.status === 'unavailable';
  const lifecycleBlocked = lifecycleControls.status === 'blocked' && acceptanceRequest.action !== 'preview';
  const degraded = operationalHealth.degradedMode.enabled && !healthBlocked;
  const confirmationRequired = !blocked
    && !accountingBlocked
    && !permissionBlocked
    && !lifecycleBlocked
    && !operationalHealth.degradedMode.enabled
    && !acceptanceContract.accepted
    && acceptanceRequest.action !== 'preview'
    && acceptanceContract.providerCanApply;
  const applied = acceptanceContract.accepted;
  let targetSurface = 'scheduler.budget-manager';
  let status = 'waiting';

  if (blocked) {
    targetSurface = lifecycleBlocked ? 'scheduler.lifecycle-settings' : accountingSignal.targetSurface || 'scheduler.budget-editor';
    status = lifecycleBlocked ? 'lifecycle_blocked' : accountingSignal.capacityHold ? accountingSignal.status : 'blocked';
  } else if (healthBlocked) {
    targetSurface = 'scheduler.provider-recovery';
    status = 'provider_unavailable';
  } else if (permissionBlocked) {
    targetSurface = 'scheduler.permission-review';
    status = 'permission_blocked';
  } else if (degraded) {
    targetSurface = 'scheduler.budget-preview';
    status = 'degraded_preview_only';
  } else if (applied) {
    targetSurface = readiness.ready ? 'scheduler.route-runner' : 'scheduler.budget-manager';
    status = 'applied';
  } else if (waitingForExternal) {
    targetSurface = externalHandoff.destination;
    status = 'external_handoff_pending';
  } else if (confirmationRequired) {
    targetSurface = 'scheduler.budget-confirmation';
    status = 'confirmation_required';
  } else if (accountingThrottled) {
    targetSurface = accountingSignal.targetSurface;
    status = accountingSignal.status;
  } else if (readiness.ready) {
    targetSurface = 'scheduler.route-runner';
    status = 'ready_to_continue';
  }
  const title = blocked
    ? lifecycleBlocked ? 'Lifecycle settings block scheduling' : accountingSignal.title || 'Budget needs adjustment'
    : healthBlocked
      ? 'Budget provider unavailable'
      : permissionBlocked
        ? 'Permission review required'
        : degraded
          ? 'Budget preview only'
          : applied
            ? 'Budget updated'
            : confirmationRequired
              ? 'Confirm budget change'
              : waitingForExternal
                ? 'External budget handoff pending'
                : accountingThrottled
                  ? accountingSignal.title
                  : 'Budget ready';
  const primaryAction = blocked
    ? lifecycleBlocked ? lifecycleControls.nextAction : accountingSignal.primaryAction || 'edit_budget'
    : healthBlocked
      ? 'retry'
      : permissionBlocked
        ? 'request_access'
        : degraded
          ? 'preview'
          : accountingThrottled
            ? accountingSignal.primaryAction
            : applied || readiness.ready
              ? 'continue'
              : confirmationRequired
                ? 'confirm'
                : 'review';
  const disabled = accountingSignal.disabled || blocked || waitingForExternal || permissionBlocked || healthBlocked || lifecycleBlocked;

  return {
    schema: 'scheduler.budget-manager.workflow-handoff.v1',
    status,
    targetSurface,
    userVisible: {
      title,
      primaryAction,
      disabled,
      accountingSignal,
      lifecycleControls,
    },
    route: {
      from: clientRuntime.workflow.panel,
      to: targetSurface,
      returnTo: clientRuntime.workflow.returnTo,
      routeId: clientRuntime.request.routeId,
      tenantId: permissionBoundary.tenantId,
      workspaceId: permissionBoundary.workspaceId,
    },
    token: [
      surfaceId,
      clientRuntime.request.requestId,
      clientRuntime.request.routeId || 'unrouted',
      acceptanceRequest.action,
      clientRuntime.sync.sequence,
    ].join(':'),
  };
}

function buildValidationSummary(providerContract, providerServiceContract, budgetEnvelope, budgetAccounting, handoff, acceptanceRequest, permissionBoundary, operationalHealth, lifecycleControls) {
  const operationProjection = buildBudgetOperationProjection(budgetEnvelope, acceptanceRequest);
  const checks = [
    {
      code: 'budget.limit.present',
      severity: budgetEnvelope.limit > 0 ? 'info' : 'error',
      passed: budgetEnvelope.limit > 0,
      message: budgetEnvelope.limit > 0 ? 'Budget limit is available.' : 'Budget limit must be greater than zero.',
    },
    {
      code: 'budget.capacity.available',
      severity: operationProjection.fitsBudget ? 'info' : 'error',
      passed: operationProjection.fitsBudget,
      message: operationProjection.fitsBudget
        ? operationProjection.reason
        : operationProjection.blockedReason,
    },
    {
      code: 'budget.accounting.within_policy',
      severity: budgetAccounting.canSchedule ? budgetAccounting.status === 'near_limit' ? 'warning' : 'info' : 'error',
      passed: budgetAccounting.canSchedule,
      message: budgetAccounting.canSchedule
        ? budgetAccounting.warningReasons[0] || 'Token, message, wall-clock, retry, and wave accounting are within policy.'
        : budgetAccounting.blockingReasons.join('; '),
    },
    {
      code: 'lifecycle.settings.scheduling_allowed',
      severity: lifecycleControls.status === 'blocked' && acceptanceRequest.action !== 'preview' ? 'error' : 'info',
      passed: lifecycleControls.status !== 'blocked' || acceptanceRequest.action === 'preview',
      message: lifecycleControls.status === 'blocked' && acceptanceRequest.action !== 'preview'
        ? lifecycleControls.validationIssues.join('; ')
        : 'Lifecycle settings allow this budget-manager action.',
    },
    {
      code: 'provider.capability.accepted',
      severity: providerContract.rejectedCapabilities.length === 0 ? 'info' : 'warning',
      passed: providerContract.rejectedCapabilities.length === 0,
      message: providerContract.rejectedCapabilities.length === 0
        ? 'All requested provider capabilities were accepted.'
        : 'Some requested provider capabilities are unavailable.',
    },
    {
      code: 'provider.service.operation.ready',
      severity: providerServiceContract.operation.canApply || acceptanceRequest.action === 'preview' ? 'info' : 'warning',
      passed: providerServiceContract.operation.canApply || acceptanceRequest.action === 'preview',
      message: providerServiceContract.operation.canApply
        ? 'Hosted-kernel provider service contract can apply this budget operation.'
        : acceptanceRequest.action === 'preview'
          ? 'Preview can proceed without a mutation-ready provider service contract.'
          : `Provider service contract is not mutation-ready: ${providerServiceContract.operation.rejectedReasons.join('; ')}.`,
    },
    {
      code: 'provider.service.apply_mode',
      severity: providerServiceContract.operation.applyRequested || acceptanceRequest.action === 'preview' ? 'info' : 'warning',
      passed: providerServiceContract.operation.applyRequested || acceptanceRequest.action === 'preview',
      message: providerServiceContract.operation.applyRequested
        ? 'Provider service contract is in explicit mutation apply mode.'
        : acceptanceRequest.action === 'preview'
          ? 'Preview does not require provider mutation apply mode.'
          : 'Mutation is contract-ready only after the caller submits dryRun=false.',
    },
    {
      code: 'provider.sync.capability.ready',
      severity: providerServiceContract.sync.capabilityReady ? 'info' : 'warning',
      passed: providerServiceContract.sync.capabilityReady,
      message: providerServiceContract.sync.capabilityReady
        ? 'Provider sync mode is covered by negotiated capabilities.'
        : `Provider sync mode ${providerServiceContract.sync.mode} requires sync.cursor capability.`,
    },
    {
      code: 'provider.sync.cursor.ready',
      severity: providerServiceContract.sync.cursorReady ? 'info' : 'warning',
      passed: providerServiceContract.sync.cursorReady,
      message: providerServiceContract.sync.cursorReady
        ? 'Provider sync metadata is ready for this operation.'
        : 'Provider sync mode requires a cursor before mutation handoff.',
    },
    {
      code: 'provider.sync.lease.ready',
      severity: providerServiceContract.sync.lease.required && providerServiceContract.sync.lease.state !== 'active' ? 'warning' : 'info',
      passed: !providerServiceContract.sync.lease.required || providerServiceContract.sync.lease.state === 'active',
      message: !providerServiceContract.sync.lease.required
        ? 'Provider sync lease is not required for this sync mode.'
        : providerServiceContract.sync.lease.state === 'active'
          ? 'Provider sync lease is active for cursor+lease mode.'
          : `Provider sync lease is ${providerServiceContract.sync.lease.state}.`,
    },
    {
      code: 'handoff.destination.ready',
      severity: !handoff.required || handoff.destination ? 'info' : 'warning',
      passed: !handoff.required || Boolean(handoff.destination),
      message: !handoff.required || handoff.destination
        ? 'External handoff routing is ready.'
        : 'External handoff requires a destination before acceptance.',
    },
    {
      code: 'operational.health.mutation_safe',
      severity: operationalHealth.status === 'unavailable'
        ? 'error'
        : operationalHealth.degradedMode.enabled && acceptanceRequest.action !== 'preview'
          ? 'warning'
          : 'info',
      passed: operationalHealth.status !== 'unavailable'
        && (!operationalHealth.degradedMode.enabled || acceptanceRequest.action === 'preview'),
      message: operationalHealth.status === 'unavailable'
        ? 'Hosted-kernel budget provider is unavailable.'
        : operationalHealth.degradedMode.enabled && acceptanceRequest.action !== 'preview'
          ? 'Hosted-kernel budget provider is degraded; mutation should remain in preview mode.'
          : 'Hosted-kernel budget provider is healthy for this request.',
    },
    ...permissionBoundary.checks,
  ];
  const errors = checks.filter((check) => check.severity === 'error' && !check.passed);
  const warnings = checks.filter((check) => check.severity === 'warning' && !check.passed);

  return {
    status: errors.length > 0 ? 'blocked' : warnings.length > 0 ? 'needs_attention' : 'ready',
    errorCount: errors.length,
    warningCount: warnings.length,
    operationProjection,
    budgetAccounting,
    checks,
  };
}

function buildBudgetOperationProjection(budgetEnvelope, acceptanceRequest) {
  const requestedAmount = acceptanceRequest.action === 'preview' ? 0 : acceptanceRequest.amount;
  const maxByAction = {
    preview: budgetEnvelope.remaining,
    reserve: budgetEnvelope.remaining,
    commit: budgetEnvelope.reserved,
    release: budgetEnvelope.reserved,
  };
  const maxApplicableAmount = maxByAction[acceptanceRequest.action] ?? budgetEnvelope.remaining;
  const appliedAmount = Math.min(requestedAmount, maxApplicableAmount);
  const fitsBudget = requestedAmount <= maxApplicableAmount;
  const before = {
    reserved: budgetEnvelope.reserved,
    spent: budgetEnvelope.spent,
    remaining: budgetEnvelope.remaining,
  };
  const after = { ...before };

  if (acceptanceRequest.action === 'reserve') {
    after.reserved = Math.min(budgetEnvelope.limit, before.reserved + appliedAmount);
  } else if (acceptanceRequest.action === 'commit') {
    after.reserved = Math.max(0, before.reserved - appliedAmount);
    after.spent = Math.min(budgetEnvelope.limit, before.spent + appliedAmount);
  } else if (acceptanceRequest.action === 'release') {
    after.reserved = Math.max(0, before.reserved - appliedAmount);
  }

  after.remaining = Math.max(0, budgetEnvelope.limit - after.reserved - after.spent);

  const blockedReasonByAction = {
    reserve: 'Requested reservation exceeds remaining budget.',
    commit: 'Requested commit exceeds currently reserved budget.',
    release: 'Requested release exceeds currently reserved budget.',
    preview: 'Preview request cannot exceed remaining budget.',
  };
  const reasonByAction = {
    reserve: 'Requested reservation fits within remaining budget.',
    commit: 'Requested commit is covered by reserved budget.',
    release: 'Requested release is covered by reserved budget.',
    preview: 'Preview can inspect the current budget envelope.',
  };

  return {
    schema: 'scheduler.budget-manager.operation-projection.v1',
    action: acceptanceRequest.action,
    requestedAmount,
    appliedAmount,
    maxApplicableAmount,
    unit: budgetEnvelope.unit,
    fitsBudget,
    reason: reasonByAction[acceptanceRequest.action] || 'Budget operation can be projected.',
    blockedReason: blockedReasonByAction[acceptanceRequest.action] || 'Requested amount exceeds budget capacity.',
    before,
    after,
    deltas: {
      reserved: after.reserved - before.reserved,
      spent: after.spent - before.spent,
      remaining: after.remaining - before.remaining,
    },
  };
}

function buildUserVisiblePreview(budgetEnvelope, acceptanceRequest, validationSummary) {
  const operationProjection = validationSummary.operationProjection
    || buildBudgetOperationProjection(budgetEnvelope, acceptanceRequest);

  return {
    label: validationSummary.status === 'blocked' ? 'Budget change blocked' : 'Budget change preview',
    action: acceptanceRequest.action,
    requestedAmount: acceptanceRequest.amount,
    acceptedPreviewAmount: operationProjection.appliedAmount,
    unit: budgetEnvelope.unit,
    before: operationProjection.before,
    after: operationProjection.after,
    operationProjection,
    displayHints: {
      intent: acceptanceRequest.action === 'preview' ? 'inspect' : 'confirm',
      severity: validationSummary.status === 'blocked' ? 'danger' : validationSummary.status === 'needs_attention' ? 'warning' : 'normal',
    },
  };
}

function buildAcceptanceContract(providerContract, providerServiceContract, budgetEnvelope, acceptanceRequest, validationSummary, preview, permissionBoundary, operationalHealth) {
  const capabilityByAction = {
    preview: 'budget.reserve',
    reserve: 'budget.reserve',
    commit: 'budget.commit',
    release: 'budget.release',
  };
  const requiredCapability = capabilityByAction[acceptanceRequest.action];
  const providerCanApply = providerServiceContract.operation.canApply;
  const accepted = validationSummary.status !== 'blocked'
    && permissionBoundary.allowed
    && !operationalHealth.degradedMode.enabled
    && providerCanApply
    && providerServiceContract.operation.applyRequested
    && acceptanceRequest.action !== 'preview';

  return {
    accepted,
    mode: acceptanceRequest.dryRun || !accepted ? 'preview' : 'mutation',
    action: acceptanceRequest.action,
    clientMutationId: acceptanceRequest.clientMutationId,
    requiredCapability,
    providerCanApply,
    providerService: {
      protocol: providerServiceContract.service.protocol,
      endpoint: providerServiceContract.service.endpoint,
      syncMode: providerServiceContract.service.syncMode,
      idempotencyKey: providerServiceContract.operation.idempotencyKey,
      applyRequested: providerServiceContract.operation.applyRequested,
      applyMode: providerServiceContract.operation.applyMode,
      rejectedReasons: providerServiceContract.operation.rejectedReasons,
      warnings: providerServiceContract.operation.warnings,
    },
    permission: {
      allowed: permissionBoundary.allowed,
      requiredPermission: permissionBoundary.requiredPermission,
      permissionSource: permissionBoundary.permissionSource,
      principalId: permissionBoundary.principalId,
      tenantId: permissionBoundary.tenantId,
      workspaceId: permissionBoundary.workspaceId,
      workspaceGrant: permissionBoundary.workspaceGrant,
    },
    reason: accepted
      ? 'Request can be applied by the hosted kernel provider.'
      : acceptanceRequest.action === 'preview'
        ? 'Preview requests do not mutate budget state.'
        : !permissionBoundary.allowed
          ? 'Request is blocked by tenant, workspace, or role permission boundaries.'
        : operationalHealth.degradedMode.enabled
          ? operationalHealth.degradedMode.reason
        : providerServiceContract.operation.applyMode === 'dry_run'
          ? 'Request is validated as a dry-run contract; submit dryRun=false to apply the mutation.'
        : providerCanApply
          ? 'Request is waiting on validation readiness.'
          : providerServiceContract.operation.rejectedReasons.length > 0
            ? providerServiceContract.operation.rejectedReasons.join('; ')
            : 'Provider capability is missing for the requested action.',
    patch: accepted
      ? {
          budgetUnit: budgetEnvelope.unit,
          reservedDelta: preview.operationProjection.deltas.reserved,
          spentDelta: preview.operationProjection.deltas.spent,
          remainingAfter: preview.operationProjection.after.remaining,
          appliedAmount: preview.operationProjection.appliedAmount,
          operationProjection: preview.operationProjection.schema,
        }
      : null,
  };
}

function buildReadinessSnapshot(providerContract, providerServiceContract, validationSummary, acceptanceContract, handoff, permissionBoundary, operationalHealth, lifecycleControls) {
  const gates = [
    { name: 'validation', ready: validationSummary.status !== 'blocked' },
    { name: 'budgetAccounting', ready: validationSummary.budgetAccounting.canSchedule },
    { name: 'lifecycleControls', ready: lifecycleControls.scheduling.mutationAllowed || acceptanceContract.action === 'preview' },
    { name: 'operationalHealth', ready: !operationalHealth.degradedMode.enabled },
    { name: 'providerCapability', ready: acceptanceContract.providerCanApply },
    { name: 'providerSyncContract', ready: providerServiceContract.sync.capabilityReady && providerServiceContract.sync.cursorReady },
    { name: 'providerSyncLease', ready: !providerServiceContract.sync.lease.required || providerServiceContract.sync.lease.state === 'active' },
    { name: 'tenantWorkspaceBoundary', ready: permissionBoundary.allowed },
    { name: 'auditProof', ready: providerContract.capabilities.includes('audit.proof') },
    { name: 'externalHandoff', ready: !handoff.required || handoff.state === 'accepted' || acceptanceContract.action === 'preview' },
  ];

  return {
    ready: gates.every((gate) => gate.ready),
    status: gates.every((gate) => gate.ready) ? 'ready' : 'not_ready',
    gates,
  };
}

function buildExplainableNextSteps(validationSummary, acceptanceContract, readiness, handoff, permissionBoundary, operationalHealth, lifecycleControls) {
  const steps = [];
  const accountingPlan = validationSummary.budgetAccounting.plan;
  const accountingSignal = buildAccountingWorkflowSignal(validationSummary.budgetAccounting);

  if (lifecycleControls.status === 'blocked' && acceptanceContract.action !== 'preview') {
    steps.push({
      code: lifecycleControls.nextAction,
      label: lifecycleControls.nextAction === 'fix_lifecycle_settings'
        ? 'Fix lifecycle settings'
        : lifecycleControls.nextAction === 'enable_budget_manager'
          ? 'Enable budget manager'
          : lifecycleControls.nextAction === 'enable_mutations'
            ? 'Enable budget mutations'
            : 'Resume scheduler lifecycle',
      detail: lifecycleControls.validationIssues.join(' ') || 'Lifecycle controls must allow scheduling before this budget mutation can continue.',
    });
  }

  if (operationalHealth.degradedMode.enabled && operationalHealth.actionableError) {
    steps.push({
      code: operationalHealth.actionableError.code,
      label: operationalHealth.actionableError.label,
      detail: operationalHealth.retryPolicy.retryable
        ? `${operationalHealth.actionableError.detail} Retry after ${operationalHealth.retryPolicy.nextDelayMs}ms.`
        : operationalHealth.actionableError.detail,
    });
  }

  if (accountingSignal.waveCapacityBlocked) {
    steps.push({
      code: 'wait_for_wave_capacity',
      label: 'Wait for wave capacity',
      detail: `${accountingSignal.deferredWaveSlots} requested scheduler wave slot(s) exceed the ${accountingSignal.configuredWaveWidth}-wide policy. Resume this request after active wave slots complete.`,
    });
  } else if (accountingSignal.retryExhausted) {
    steps.push({
      code: 'review_retry_budget',
      label: 'Review retry budget',
      detail: 'Retry attempts for this request are exhausted. Increase retry policy or restart from a fresh client mutation after operator review.',
    });
  } else if (accountingPlan && accountingPlan.admission.status === 'blocked') {
    const blockedMeters = accountingPlan.admission.blockedMeters.join(', ');
    steps.push({
      code: 'resolve_accounting_limits',
      label: 'Resolve scheduler budget limits',
      detail: `Request is blocked by ${blockedMeters || 'scheduler accounting policy'}. Reduce the request or wait for budget to free up.`,
    });
  } else if (accountingSignal.waveThrottleAdvised) {
    steps.push({
      code: 'throttle_near_wave_limit',
      label: 'Throttle scheduler wave',
      detail: `Projected wave width is ${accountingSignal.projectedWaveWidth}/${accountingSignal.configuredWaveWidth}; avoid launching additional work until slots complete.`,
    });
  }

  if (validationSummary.errorCount > 0) {
    steps.push({
      code: 'fix_budget_capacity',
      label: 'Adjust the budget request',
      detail: 'Reduce the requested amount or increase the available budget before accepting.',
    });
  }

  if (!acceptanceContract.providerCanApply) {
    const providerReasons = acceptanceContract.providerService.rejectedReasons;
    const firstReason = providerReasons[0] || 'Provider service contract is not ready.';
    const providerStep = providerReasons.some((reason) => reason.includes('handoff'))
      ? {
          code: 'accept_external_handoff',
          label: 'Accept external handoff',
          detail: firstReason,
        }
      : providerReasons.some((reason) => reason.includes('sync lease'))
        ? {
            code: 'renew_provider_sync_lease',
            label: 'Renew provider sync lease',
            detail: firstReason,
          }
        : providerReasons.some((reason) => reason.includes('sync cursor'))
          ? {
              code: 'refresh_provider_sync_cursor',
              label: 'Refresh provider sync cursor',
              detail: firstReason,
            }
          : {
              code: 'negotiate_provider_capability',
              label: 'Negotiate provider capability',
              detail: firstReason.includes('missing capability')
                ? `Request ${acceptanceContract.requiredCapability} from the hosted-kernel provider contract.`
                : firstReason,
            };
    steps.push({
      ...providerStep,
    });
  }

  if (!permissionBoundary.allowed) {
    const failedBoundaryCodes = permissionBoundary.checks
      .filter((check) => !check.passed)
      .map((check) => check.code);
    steps.push({
      code: 'resolve_permission_boundary',
      label: 'Resolve permission boundary',
      detail: failedBoundaryCodes.length > 0
        ? `Blocked by ${failedBoundaryCodes.join(', ')}.`
        : 'Tenant and workspace permission boundary must allow this budget action.',
    });
  }

  if (handoff.required && !handoff.destination) {
    steps.push({
      code: 'set_handoff_destination',
      label: 'Choose handoff destination',
      detail: 'Provide a destination so external budget ownership can be accepted or rejected.',
    });
  }

  if (steps.length === 0 && !acceptanceContract.accepted) {
    steps.push({
      code: 'confirm_acceptance',
      label: 'Confirm budget action',
      detail: 'Submit the same contract with dryRun=false to apply the accepted budget change.',
    });
  }

  if (steps.length === 0 && readiness.ready) {
    steps.push({
      code: 'continue_scheduler_work',
      label: 'Continue scheduler execution',
      detail: 'Budget contract is ready for the next scheduler route decision.',
    });
  }

  return steps;
}

function buildReviewDataContract(preview, validationSummary, acceptanceContract, readiness, workflowHandoff, nextSteps, operationalHealth, lifecycleControls) {
  const failedChecks = validationSummary.checks.filter((check) => !check.passed);
  const blockingChecks = failedChecks.filter((check) => check.severity === 'error');
  const warningChecks = failedChecks.filter((check) => check.severity === 'warning');
  const blockedGates = readiness.gates.filter((gate) => !gate.ready);
  const accountingPlan = validationSummary.budgetAccounting.plan;
  const accountingSignal = workflowHandoff.userVisible.accountingSignal
    || buildAccountingWorkflowSignal(validationSummary.budgetAccounting);
  const confirmationReady = acceptanceContract.action !== 'preview'
    && validationSummary.status !== 'blocked'
    && readiness.ready
    && acceptanceContract.permission.allowed
    && acceptanceContract.providerCanApply
    && !operationalHealth.degradedMode.enabled;
  const previewOnlyReason = acceptanceContract.action === 'preview'
    ? 'Request is a preview and will not mutate budget state.'
    : operationalHealth.degradedMode.enabled
      ? operationalHealth.degradedMode.reason
      : blockingChecks.length > 0
        ? blockingChecks[0].message
        : blockedGates.length > 0
          ? `Waiting on readiness gate ${blockedGates[0].name}.`
          : acceptanceContract.mode === 'preview'
            ? 'Mutation requires explicit acceptance with dryRun=false.'
            : null;

  return {
    schema: 'scheduler.budget-manager.review-contract.v1',
    status: acceptanceContract.accepted
      ? 'accepted'
      : blockingChecks.length > 0
        ? 'blocked'
        : confirmationReady
          ? 'ready_for_confirmation'
          : warningChecks.length > 0 || blockedGates.length > 0
            ? 'review_attention'
            : 'preview_only',
    generatedFor: {
      targetSurface: workflowHandoff.targetSurface,
      primaryAction: workflowHandoff.userVisible.primaryAction,
      workflowStatus: workflowHandoff.status,
    },
    validation: {
      status: validationSummary.status,
      passedCount: validationSummary.checks.length - failedChecks.length,
      failedCount: failedChecks.length,
      errorCount: validationSummary.errorCount,
      warningCount: validationSummary.warningCount,
      firstBlockingCode: blockingChecks[0] ? blockingChecks[0].code : null,
      firstWarningCode: warningChecks[0] ? warningChecks[0].code : null,
      failedCodes: failedChecks.map((check) => check.code),
    },
    readiness: {
      ready: readiness.ready,
      status: readiness.status,
      readyGateCount: readiness.gates.filter((gate) => gate.ready).length,
      blockedGateCount: blockedGates.length,
      blockedGates: blockedGates.map((gate) => gate.name),
    },
    acceptance: {
      action: acceptanceContract.action,
      mode: acceptanceContract.mode,
      accepted: acceptanceContract.accepted,
      confirmationReady,
      providerCanApply: acceptanceContract.providerCanApply,
      providerApplyMode: acceptanceContract.providerService.applyMode,
      providerApplyRequested: acceptanceContract.providerService.applyRequested,
      providerWarnings: acceptanceContract.providerService.warnings,
      permissionAllowed: acceptanceContract.permission.allowed,
      permissionSource: acceptanceContract.permission.permissionSource,
      workspaceGrantStatus: acceptanceContract.permission.workspaceGrant.status,
      previewOnlyReason,
      submitVerb: acceptanceContract.accepted
        ? 'continue'
        : confirmationReady
          ? 'accept'
          : 'review',
    },
    lifecycle: {
      status: lifecycleControls.status,
      command: lifecycleControls.command,
      mode: lifecycleControls.mode,
      nextAction: lifecycleControls.nextAction,
      validationIssues: lifecycleControls.validationIssues,
      scheduleAllowed: lifecycleControls.scheduling.scheduleAllowed,
      mutationAllowed: lifecycleControls.scheduling.mutationAllowed,
      projected: lifecycleControls.projected,
    },
    preview: {
      severity: preview.displayHints.severity,
      unit: preview.unit,
      requestedAmount: preview.requestedAmount,
      acceptedPreviewAmount: preview.acceptedPreviewAmount,
      deltas: preview.operationProjection.deltas,
      remainingAfter: preview.after.remaining,
    },
    accounting: {
      status: validationSummary.budgetAccounting.status,
      admissionStatus: accountingPlan.admission.status,
      canEnterWave: accountingPlan.admission.canEnterWave,
      blockedMeters: accountingPlan.admission.blockedMeters,
      waveDeferredSlots: accountingPlan.admission.wave.deferredSlots,
      retryAttemptsRemaining: accountingPlan.retry.attemptsRemaining,
      workflowSignal: {
        status: accountingSignal.status,
        holdReason: accountingSignal.holdReason,
        capacityHold: accountingSignal.capacityHold,
        targetSurface: accountingSignal.targetSurface,
        primaryAction: accountingSignal.primaryAction,
        waveCapacityBlocked: accountingSignal.waveCapacityBlocked,
        retryExhausted: accountingSignal.retryExhausted,
        waveThrottleAdvised: accountingSignal.waveThrottleAdvised,
      },
      handoff: {
        disabled: accountingSignal.disabled,
        deferredWaveSlots: accountingSignal.deferredWaveSlots,
        projectedWaveWidth: accountingSignal.projectedWaveWidth,
        configuredWaveWidth: accountingSignal.configuredWaveWidth,
      },
    },
    nextStepPayloads: nextSteps.map((step, index) => ({
      order: index + 1,
      code: step.code,
      label: step.label,
      detail: step.detail,
      primary: index === 0,
      routeAction: index === 0 ? workflowHandoff.userVisible.primaryAction : 'review',
      blocksAcceptance: index === 0 && !confirmationReady && !acceptanceContract.accepted,
    })),
  };
}

function buildClientDecisionContract(preview, validationSummary, acceptanceContract, readiness, workflowHandoff, nextSteps, operationalHealth, reviewContract, lifecycleControls) {
  const failedChecks = validationSummary.checks.filter((check) => !check.passed);
  const blockingChecks = failedChecks.filter((check) => check.severity === 'error');
  const warningChecks = failedChecks.filter((check) => check.severity === 'warning');
  const accountingSignal = workflowHandoff.userVisible.accountingSignal
    || buildAccountingWorkflowSignal(validationSummary.budgetAccounting);
  const canSubmitMutation = acceptanceContract.action !== 'preview'
    && acceptanceContract.permission.allowed
    && acceptanceContract.providerCanApply
    && readiness.ready
    && !operationalHealth.degradedMode.enabled;
  const requiresConfirmation = canSubmitMutation
    && acceptanceContract.mode === 'preview'
    && !acceptanceContract.accepted;
  const disabledReasons = [
    blockingChecks.length > 0 ? 'validation_errors' : null,
    warningChecks.length > 0 && !readiness.ready ? 'readiness_warnings' : null,
    !acceptanceContract.permission.allowed ? 'permission_boundary' : null,
    !acceptanceContract.providerCanApply ? 'provider_contract' : null,
    operationalHealth.degradedMode.enabled ? 'operational_health' : null,
    accountingSignal.waveCapacityBlocked ? 'accounting_wave_capacity' : null,
    accountingSignal.retryExhausted ? 'accounting_retry_budget' : null,
    accountingSignal.capacityHold && !accountingSignal.waveCapacityBlocked && !accountingSignal.retryExhausted
      ? `accounting_${accountingSignal.holdReason}`
      : null,
    lifecycleControls.status === 'blocked' && acceptanceContract.action !== 'preview' ? 'lifecycle_controls' : null,
  ].filter(Boolean);
  const primaryStep = nextSteps[0] || {
    code: 'review_budget_preview',
    label: 'Review budget preview',
    detail: 'Review projected budget state before continuing.',
  };

  return {
    schema: 'scheduler.budget-manager.client-decision.v1',
    status: acceptanceContract.accepted
      ? 'accepted'
      : blockingChecks.length > 0
        ? 'blocked'
        : requiresConfirmation
          ? 'needs_confirmation'
          : readiness.ready
            ? 'ready'
            : 'needs_attention',
    routeIntent: {
      targetSurface: workflowHandoff.targetSurface,
      primaryAction: workflowHandoff.userVisible.primaryAction,
      disabled: workflowHandoff.userVisible.disabled || disabledReasons.length > 0,
      disabledReasons,
      accountingHoldReason: accountingSignal.holdReason,
      accountingTargetSurface: accountingSignal.targetSurface,
      lifecycleNextAction: lifecycleControls.nextAction,
      returnTo: workflowHandoff.route.returnTo,
      routeId: workflowHandoff.route.routeId,
    },
    previewCard: {
      title: workflowHandoff.userVisible.title,
      label: preview.label,
      severity: preview.displayHints.severity,
      action: preview.action,
      amount: {
        requested: preview.requestedAmount,
        acceptedForPreview: preview.acceptedPreviewAmount,
        unit: preview.unit,
      },
      deltas: {
        reserved: preview.after.reserved - preview.before.reserved,
        spent: preview.after.spent - preview.before.spent,
        remaining: preview.after.remaining - preview.before.remaining,
      },
      after: preview.after,
    },
    acceptanceControls: {
      submitLabel: acceptanceContract.accepted
        ? 'Continue'
        : requiresConfirmation
          ? 'Confirm budget change'
          : workflowHandoff.userVisible.primaryAction === 'retry'
            ? 'Retry'
            : 'Review budget',
      submitEnabled: acceptanceContract.accepted || (canSubmitMutation && disabledReasons.length === 0),
      dryRunRequired: !acceptanceContract.accepted,
      idempotencyKey: acceptanceContract.providerService.idempotencyKey,
      clientMutationId: acceptanceContract.clientMutationId,
    },
    accountingDigest: {
      status: validationSummary.budgetAccounting.status,
      canSchedule: validationSummary.budgetAccounting.canSchedule,
      admissionStatus: validationSummary.budgetAccounting.plan.admission.status,
      canEnterWave: validationSummary.budgetAccounting.plan.admission.canEnterWave,
      wave: validationSummary.budgetAccounting.plan.admission.wave,
      retry: validationSummary.budgetAccounting.plan.retry,
      blockingReasons: validationSummary.budgetAccounting.blockingReasons,
      warningReasons: validationSummary.budgetAccounting.warningReasons,
      workflowSignal: accountingSignal,
      meters: validationSummary.budgetAccounting.meters.map((meter) => ({
        name: meter.name,
        unit: meter.unit,
        limit: meter.limit,
        remaining: meter.remaining,
        requested: meter.requested,
        fits: meter.fits,
        overflow: meter.overflow,
      })),
    },
    lifecycleControls: {
      status: lifecycleControls.status,
      command: lifecycleControls.command,
      mode: lifecycleControls.mode,
      current: lifecycleControls.current,
      projected: lifecycleControls.projected,
      scheduling: lifecycleControls.scheduling,
      validationIssues: lifecycleControls.validationIssues,
      nextAction: lifecycleControls.nextAction,
    },
    validationDigest: {
      status: validationSummary.status,
      errorCount: validationSummary.errorCount,
      warningCount: validationSummary.warningCount,
      failedCodes: failedChecks.map((check) => check.code),
      blockingMessages: blockingChecks.map((check) => check.message),
      warningMessages: warningChecks.map((check) => check.message),
    },
    reviewContract,
    nextStep: {
      code: primaryStep.code,
      label: primaryStep.label,
      detail: primaryStep.detail,
    },
  };
}

function buildSyncMetadata(input, providerContract, now) {
  const cursor = typeof input.syncCursor === 'string' && input.syncCursor ? input.syncCursor : null;
  const sequence = asFiniteNonNegativeNumber(input.syncSequence, 0);
  const supportsCursor = providerContract.capabilities.includes('sync.cursor');
  const externalCursor = cursor || `${providerContract.providerId}:${sequence}:snapshot`;
  const syncInput = input.sync && typeof input.sync === 'object' ? input.sync : {};
  const leaseExpiresAt = asNonEmptyString(input.syncLeaseExpiresAt, asNonEmptyString(syncInput.leaseExpiresAt));
  const parsedLeaseExpiresAt = leaseExpiresAt ? Date.parse(leaseExpiresAt) : null;
  const parsedNow = Date.parse(now);
  const leaseExpired = Number.isFinite(parsedLeaseExpiresAt)
    && Number.isFinite(parsedNow)
    && parsedLeaseExpiresAt <= parsedNow;
  const leaseState = providerContract.service.syncMode === 'cursor+lease'
    ? !supportsCursor
      ? 'unsupported'
      : !leaseExpiresAt
        ? 'missing'
        : leaseExpired
          ? 'expired'
          : 'active'
    : 'not_required';

  return {
    cursor,
    sequence,
    generatedAt: now,
    authority: supportsCursor ? providerContract.providerId : 'aios-kernel',
    freshness: cursor ? 'incremental' : 'snapshot',
    providerCursor: supportsCursor ? externalCursor : null,
    checkpoint: {
      scope: supportsCursor ? 'provider' : 'kernel',
      mode: providerContract.service.syncMode,
      resumable: supportsCursor && Boolean(externalCursor),
    },
    lease: {
      required: providerContract.service.syncMode === 'cursor+lease',
      state: leaseState,
      expiresAt: leaseExpiresAt,
      expired: leaseExpired,
    },
  };
}

function buildExternalHandoff(input, providerContract, budgetEnvelope, syncMetadata, tenantBoundary, now) {
  const source = input.externalHandoff && typeof input.externalHandoff === 'object' ? input.externalHandoff : input;
  const requestedState = typeof source.handoffState === 'string' ? source.handoffState : 'none';
  const state = SUPPORTED_HANDOFF_STATES.has(requestedState) ? requestedState : 'none';
  const shouldHandoff = providerContract.requiresExternalHandoff || state !== 'none';
  const destination = shouldHandoff && typeof source.handoffDestination === 'string' && source.handoffDestination
    ? source.handoffDestination
    : null;
  const ownerProviderId = asNonEmptyString(source.ownerProviderId, providerContract.providerId);
  const leaseDurationMs = Math.max(0, providerContract.service.leaseDurationMs);
  const parsedNow = Date.parse(now);
  const nowMs = Number.isFinite(parsedNow) ? parsedNow : Date.now();
  const requestedLeaseExpiresAt = asNonEmptyString(source.leaseExpiresAt, asNonEmptyString(source.handoffLeaseExpiresAt));
  const requestedLeaseExpiresAtMs = requestedLeaseExpiresAt ? Date.parse(requestedLeaseExpiresAt) : null;
  const requestedLeaseActive = Number.isFinite(requestedLeaseExpiresAtMs) && requestedLeaseExpiresAtMs > nowMs;
  const leaseExpiresAt = shouldHandoff
    ? requestedLeaseActive
      ? requestedLeaseExpiresAt
      : leaseDurationMs > 0
        ? new Date(nowMs + leaseDurationMs).toISOString()
        : null
    : null;
  const leaseState = !shouldHandoff
    ? 'not_required'
    : state === 'accepted'
      ? 'owned_by_external_provider'
      : state === 'pending'
        ? 'lease_pending'
        : state === 'rejected'
          ? 'returned_to_kernel'
          : state === 'expired'
            ? 'lease_expired'
            : 'not_started';

  return {
    required: shouldHandoff,
    state: shouldHandoff ? state : 'none',
    destination,
    lease: {
      state: leaseState,
      ownerProviderId,
      expiresAt: leaseExpiresAt,
      suppliedExternally: requestedLeaseActive,
      syncCursor: syncMetadata.providerCursor || syncMetadata.cursor,
    },
    payload: shouldHandoff
      ? {
          surfaceId,
          providerId: providerContract.providerId,
          ownerProviderId,
          tenantId: tenantBoundary.tenantId,
          workspaceId: tenantBoundary.workspaceId,
          scopeKey: tenantBoundary.workspace.scopeKey,
          boundary: {
            principalId: tenantBoundary.principal.principalId,
            boundaryStatus: tenantBoundary.isolation.status,
            workspaceGrantRequired: tenantBoundary.workspace.grantRequired,
            workspaceGrantStatus: tenantBoundary.workspace.grantStatus,
            workspaceGrantId: tenantBoundary.workspace.activeGrantId,
            scopedPermissionCount: tenantBoundary.principal.scopedPermissions.length,
          },
          budget: budgetEnvelope,
          syncCursor: syncMetadata.cursor,
          providerCursor: syncMetadata.providerCursor,
          leaseExpiresAt,
        }
      : null,
  };
}

function buildProviderServiceContract(providerContract, acceptanceRequest, syncMetadata, tenantBoundary, externalHandoff, operationalHealth, now) {
  const capabilityByAction = {
    preview: 'budget.reserve',
    reserve: 'budget.reserve',
    commit: 'budget.commit',
    release: 'budget.release',
  };
  const requiredCapability = capabilityByAction[acceptanceRequest.action];
  const hasRequiredCapability = providerContract.capabilities.includes(requiredCapability);
  const mutationRequested = acceptanceRequest.action !== 'preview';
  const applyRequested = mutationRequested && acceptanceRequest.dryRun === false;
  const cursorRequired = acceptanceRequest.action !== 'preview'
    && providerContract.service.syncMode !== 'snapshot';
  const syncCapabilityReady = !mutationRequested
    || providerContract.service.syncMode === 'snapshot'
    || providerContract.capabilities.includes('sync.cursor');
  const cursorReady = !cursorRequired || Boolean(syncMetadata.providerCursor || syncMetadata.cursor);
  const leaseReady = !mutationRequested || !syncMetadata.lease.required || syncMetadata.lease.state === 'active';
  const handoffDestinationReady = !externalHandoff.required || Boolean(externalHandoff.destination);
  const handoffAccepted = !externalHandoff.required || externalHandoff.state === 'accepted';
  const handoffReady = !mutationRequested || handoffAccepted;
  const healthReady = operationalHealth.status === 'healthy';
  const mutationPath = hasRequiredCapability
    && syncCapabilityReady
    && cursorReady
    && leaseReady
    && handoffReady
    && healthReady;
  const rejectedReasons = [
    !hasRequiredCapability ? `missing capability ${requiredCapability}` : null,
    !syncCapabilityReady ? `sync mode ${providerContract.service.syncMode} requires sync.cursor capability` : null,
    !cursorReady ? 'missing provider sync cursor' : null,
    !leaseReady ? `provider sync lease is ${syncMetadata.lease.state}` : null,
    mutationRequested && !handoffDestinationReady ? 'external handoff destination is not ready' : null,
    mutationRequested && handoffDestinationReady && !handoffAccepted ? `external handoff is ${externalHandoff.state}` : null,
    !healthReady ? `provider health is ${operationalHealth.status}` : null,
  ].filter(Boolean);
  const warnings = [
    mutationRequested && acceptanceRequest.dryRun !== false ? 'Mutation request is contract-ready but remains dry-run until dryRun=false is submitted.' : null,
    externalHandoff.required && handoffDestinationReady && !handoffAccepted ? 'External handoff destination is known but ownership must be accepted before mutation apply.' : null,
    providerContract.service.syncMode === 'cursor+lease' && syncMetadata.lease.state === 'active' ? `Provider sync lease expires at ${syncMetadata.lease.expiresAt}.` : null,
  ].filter(Boolean);

  return {
    schema: 'scheduler.budget-manager.provider-service-contract.v1',
    generatedAt: now,
    providerId: providerContract.providerId,
    version: providerContract.contractVersion,
    service: providerContract.service,
    tenantScope: {
      tenantId: tenantBoundary.tenantId,
      workspaceId: tenantBoundary.workspaceId,
      scopeKey: tenantBoundary.workspace.scopeKey,
    },
    operation: {
      action: acceptanceRequest.action,
      requestedAmount: acceptanceRequest.amount,
      requiredCapability,
      canApply: mutationPath,
      applyRequested,
      applyMode: !mutationRequested ? 'preview' : applyRequested ? 'mutation' : 'dry_run',
      dryRun: acceptanceRequest.dryRun,
      idempotencyKey: acceptanceRequest.clientMutationId
        || `${tenantBoundary.workspace.scopeKey}:${acceptanceRequest.action}:${syncMetadata.sequence}`,
      rejectedReasons,
      warnings,
    },
    capabilityNegotiation: {
      requested: [...providerContract.capabilities, ...providerContract.rejectedCapabilities],
      accepted: providerContract.capabilities,
      rejected: providerContract.rejectedCapabilities,
      missingRequired: hasRequiredCapability ? [] : [requiredCapability],
    },
    sync: {
      mode: providerContract.service.syncMode,
      capabilityReady: syncCapabilityReady,
      cursorRequired,
      cursorReady,
      cursor: syncMetadata.providerCursor || syncMetadata.cursor,
      checkpoint: syncMetadata.checkpoint,
      lease: syncMetadata.lease,
    },
    handoff: {
      required: externalHandoff.required,
      state: externalHandoff.state,
      destination: externalHandoff.destination,
      destinationReady: handoffDestinationReady,
      accepted: handoffAccepted,
      lease: externalHandoff.lease,
    },
    proof: {
      auditProofAvailable: providerContract.capabilities.includes('audit.proof'),
      proofBinding: `${surfaceId}:${providerContract.providerId}:${syncMetadata.sequence}`,
    },
  };
}

function buildAuditProof(input, providerContract, providerServiceContract, budgetEnvelope, budgetAccounting, syncMetadata, handoff, clientRuntime, workflowHandoff, tenantBoundary, permissionBoundary, operationalHealth, lifecycleControls) {
  const sourceEvidence = Array.isArray(input.evidence) ? input.evidence : [];
  return {
    proofType: 'scheduler.budget-manager.contract.v1',
    surfaceId,
    providerId: providerContract.providerId,
    acceptedCapabilities: providerContract.capabilities,
    rejectedCapabilities: providerContract.rejectedCapabilities,
    providerProtocol: providerServiceContract.service.protocol,
    providerEndpoint: providerServiceContract.service.endpoint,
    serviceCanApply: providerServiceContract.operation.canApply,
    serviceRejectedReasons: providerServiceContract.operation.rejectedReasons,
    serviceWarnings: providerServiceContract.operation.warnings,
    serviceApplyMode: providerServiceContract.operation.applyMode,
    serviceApplyRequested: providerServiceContract.operation.applyRequested,
    syncCapabilityReady: providerServiceContract.sync.capabilityReady,
    syncLeaseState: providerServiceContract.sync.lease.state,
    syncLeaseExpiresAt: providerServiceContract.sync.lease.expiresAt,
    budgetUnit: budgetEnvelope.unit,
    budgetRemaining: budgetEnvelope.remaining,
    overBudget: budgetEnvelope.overBudget,
    accountingStatus: budgetAccounting.status,
    accountingCanSchedule: budgetAccounting.canSchedule,
    accountingBlockedMeters: budgetAccounting.meters.filter((meter) => !meter.fits).map((meter) => meter.name),
    accountingAdmissionStatus: budgetAccounting.plan.admission.status,
    accountingCanEnterWave: budgetAccounting.plan.admission.canEnterWave,
    accountingWaveActiveWidth: budgetAccounting.plan.admission.wave.activeWidth,
    accountingWaveProjectedWidth: budgetAccounting.plan.admission.wave.projectedWidth,
    accountingWaveDeferredSlots: budgetAccounting.plan.admission.wave.deferredSlots,
    accountingRetryAttemptsRemaining: budgetAccounting.plan.retry.attemptsRemaining,
    waveWidthLimit: budgetAccounting.policy.waveWidthLimit,
    maxWaveWidth: budgetAccounting.policy.maxWaveWidth,
    retryLimit: budgetAccounting.policy.retryLimit,
    syncAuthority: syncMetadata.authority,
    handoffRequired: handoff.required,
    handoffState: handoff.state,
    handoffLeaseState: handoff.lease.state,
    handoffLeaseExpiresAt: handoff.lease.expiresAt,
    tenantId: tenantBoundary.tenantId,
    workspaceId: tenantBoundary.workspaceId,
    principalId: tenantBoundary.principal.principalId,
    boundaryStatus: tenantBoundary.isolation.status,
    workspaceAllowedByList: tenantBoundary.isolation.workspaceAllowedByList,
    workspaceGrantRequired: tenantBoundary.workspace.grantRequired,
    workspaceGrantStatus: tenantBoundary.workspace.grantStatus,
    workspaceGrantId: tenantBoundary.workspace.activeGrantId,
    workspaceGrantMatchCount: tenantBoundary.isolation.matchingWorkspaceGrantCount,
    scopedPermissionCount: tenantBoundary.principal.scopedPermissions.length,
    permissionAllowed: permissionBoundary.allowed,
    requiredPermission: permissionBoundary.requiredPermission,
    permissionSource: permissionBoundary.permissionSource,
    failedBoundaryChecks: permissionBoundary.checks.filter((check) => !check.passed).map((check) => check.code),
    auditHandoff: {
      required: handoff.required,
      destination: handoff.destination,
      leaseState: handoff.lease.state,
      scopeKey: tenantBoundary.workspace.scopeKey,
      boundaryStatus: tenantBoundary.isolation.status,
      permissionSource: permissionBoundary.permissionSource,
      workspaceGrantId: tenantBoundary.workspace.activeGrantId,
    },
    clientRequestId: clientRuntime.request.requestId,
    clientRouteId: clientRuntime.request.routeId,
    workflowStatus: workflowHandoff.status,
    workflowToken: workflowHandoff.token,
    operationalHealthStatus: operationalHealth.status,
    failureState: operationalHealth.failureState,
    degradedMode: operationalHealth.degradedMode.enabled,
    retryable: operationalHealth.retryPolicy.retryable,
    nextRetryDelayMs: operationalHealth.retryPolicy.nextDelayMs,
    lifecycleStatus: lifecycleControls.status,
    lifecycleCommand: lifecycleControls.command,
    lifecycleMode: lifecycleControls.mode,
    lifecycleNextAction: lifecycleControls.nextAction,
    lifecycleScheduleAllowed: lifecycleControls.scheduling.scheduleAllowed,
    lifecycleMutationAllowed: lifecycleControls.scheduling.mutationAllowed,
    lifecycleValidationIssues: lifecycleControls.validationIssues,
    evidenceCount: sourceEvidence.length,
  };
}

function normalizePersistedCommand(command = {}, index, tenantBoundary, providerServiceContract) {
  const result = command.result && typeof command.result === 'object' ? command.result : {};
  const requestedStatus = asNonEmptyString(command.status, 'pending');
  const status = SUPPORTED_PERSISTED_COMMAND_STATUSES.has(requestedStatus) ? requestedStatus : 'pending';
  const action = SUPPORTED_ACCEPTANCE_ACTIONS.has(command.action) ? command.action : providerServiceContract.operation.action;
  const scopeKey = asNonEmptyString(command.scopeKey, tenantBoundary.workspace.scopeKey);
  const amount = asFiniteNonNegativeNumber(command.amount, providerServiceContract.operation.requestedAmount);
  const idempotencyKey = asNonEmptyString(
    command.idempotencyKey,
    `${scopeKey}:${action}:${asNonEmptyString(command.sequence, index + 1)}`,
  );

  return {
    commandId: asNonEmptyString(command.commandId, `budget-command-${index + 1}`),
    idempotencyKey,
    action,
    amount,
    status,
    terminal: TERMINAL_PERSISTED_COMMAND_STATUSES.has(status),
    scopeKey,
    providerId: asNonEmptyString(command.providerId, providerServiceContract.providerId),
    cursor: asNonEmptyString(command.cursor),
    sequence: Math.trunc(asFiniteNonNegativeNumber(command.sequence, index + 1)),
    result: {
      appliedAt: asNonEmptyString(result.appliedAt, asNonEmptyString(command.appliedAt)),
      updatedAt: asNonEmptyString(result.updatedAt, asNonEmptyString(command.updatedAt, asNonEmptyString(command.appliedAt))),
      leaseExpiresAt: asNonEmptyString(result.leaseExpiresAt, asNonEmptyString(command.leaseExpiresAt)),
      remainingAfter: command.remainingAfter === undefined && result.remainingAfter === undefined
        ? null
        : asFiniteNonNegativeNumber(result.remainingAfter, asFiniteNonNegativeNumber(command.remainingAfter)),
      failureCode: asNonEmptyString(result.failureCode, asNonEmptyString(command.failureCode)),
    },
  };
}

function buildIdempotencyReplayAssessment(commands, idempotencyKey, acceptanceRequest, preview) {
  const matches = commands.filter((command) => command.idempotencyKey === idempotencyKey);
  const terminalMatches = matches.filter((command) => command.terminal);
  const successfulTerminal = terminalMatches.find((command) => !['failed', 'abandoned'].includes(command.status)) || null;
  const latestMatch = matches[matches.length - 1] || null;
  const expectedAmount = acceptanceRequest.action === 'preview'
    ? 0
    : preview.operationProjection.appliedAmount;
  const conflictingMatches = matches.filter((command) => {
    const actionMatches = command.action === acceptanceRequest.action;
    const amountMatches = command.amount === expectedAmount || command.amount === acceptanceRequest.amount;
    return !actionMatches || !amountMatches;
  });
  const terminalConflict = conflictingMatches.find((command) => command.terminal) || null;
  const inFlightConflict = conflictingMatches.find((command) => !command.terminal) || null;
  const pendingEquivalent = matches.find((command) => (
    !command.terminal
    && command.action === acceptanceRequest.action
    && (command.amount === expectedAmount || command.amount === acceptanceRequest.amount)
  )) || null;
  const status = terminalConflict
    ? 'terminal_conflict'
    : inFlightConflict
      ? 'in_flight_conflict'
      : successfulTerminal
        ? 'duplicate_success'
        : pendingEquivalent
          ? 'pending_equivalent'
          : latestMatch && latestMatch.status === 'failed'
            ? 'prior_failed'
            : latestMatch && latestMatch.status === 'abandoned'
              ? 'prior_abandoned'
              : 'new_command';
  const replaySafe = status === 'duplicate_success';
  const conflict = status === 'terminal_conflict' || status === 'in_flight_conflict';

  return {
    schema: 'scheduler.budget-manager.idempotency-replay.v1',
    idempotencyKey,
    status,
    replaySafe,
    conflict,
    matchedCommandCount: matches.length,
    expected: {
      action: acceptanceRequest.action,
      requestedAmount: acceptanceRequest.amount,
      appliedAmount: expectedAmount,
    },
    duplicateOfCommandId: replaySafe && successfulTerminal ? successfulTerminal.commandId : null,
    pendingCommandId: pendingEquivalent ? pendingEquivalent.commandId : null,
    conflictCommandId: terminalConflict
      ? terminalConflict.commandId
      : inFlightConflict
        ? inFlightConflict.commandId
        : null,
    conflictReason: conflict
      ? 'Idempotency key is already bound to a different budget action or amount.'
      : null,
    latestStatus: latestMatch ? latestMatch.status : null,
  };
}

function readTimestampMs(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildCommandRecoveryShape(commands, replay, acceptanceRequest, acceptanceContract, providerServiceContract, operationalHealth, now) {
  const nowMs = readTimestampMs(now) || Date.now();
  const pendingCommand = replay.pendingCommandId
    ? commands.find((command) => command.commandId === replay.pendingCommandId) || null
    : null;
  const pendingUpdatedMs = pendingCommand ? readTimestampMs(pendingCommand.result.updatedAt) : null;
  const pendingLeaseExpiresMs = pendingCommand ? readTimestampMs(pendingCommand.result.leaseExpiresAt) : null;
  const pendingStaleAfterMs = Math.max(
    30000,
    Math.trunc(asFiniteNonNegativeNumber(providerServiceContract.service.leaseDurationMs, 300000)),
  );
  const pendingAgeMs = pendingUpdatedMs === null ? 0 : Math.max(0, nowMs - pendingUpdatedMs);
  const pendingLeaseExpired = pendingLeaseExpiresMs !== null && pendingLeaseExpiresMs <= nowMs;
  const pendingStale = Boolean(pendingCommand)
    && (pendingLeaseExpired || (pendingUpdatedMs !== null && pendingAgeMs >= pendingStaleAfterMs));
  const commandAlreadyTerminal = replay.replaySafe;
  const appendAllowed = acceptanceContract.accepted
    && !commandAlreadyTerminal
    && !replay.conflict
    && (!pendingCommand || pendingStale);
  const deterministicCommandId = [
    'budget-command',
    providerServiceContract.tenantScope.scopeKey.replace(/[^a-zA-Z0-9:_-]/g, '_'),
    acceptanceRequest.action,
    providerServiceContract.operation.idempotencyKey.replace(/[^a-zA-Z0-9:_-]/g, '_'),
  ].join(':');

  return {
    schema: 'scheduler.budget-manager.command-recovery.v1',
    status: commandAlreadyTerminal
      ? 'terminal_replay'
      : replay.conflict
        ? 'conflict_requires_reconciliation'
        : pendingCommand && pendingStale
          ? 'stale_pending_reclaimable'
          : pendingCommand
            ? 'pending_in_flight'
            : appendAllowed
              ? 'append_ready'
              : acceptanceRequest.action === 'preview'
                ? 'preview_no_command'
                : operationalHealth.retryPolicy.retryable
                  ? 'retry_wait'
                  : 'no_append',
    activeCommandId: pendingCommand ? pendingCommand.commandId : null,
    stalePending: pendingStale,
    pendingAgeMs,
    pendingStaleAfterMs,
    pendingLeaseExpired,
    append: {
      allowed: appendAllowed,
      reason: appendAllowed
        ? pendingStale
          ? 'Existing pending command lease is stale; append a reclaim command with the same idempotency key.'
          : 'Accepted mutation can be written before provider apply.'
        : commandAlreadyTerminal
          ? 'Terminal command already exists for this idempotency key.'
          : replay.conflict
            ? 'Idempotency key is bound to a conflicting command.'
            : pendingCommand
              ? 'Equivalent command is still pending.'
              : acceptanceRequest.action === 'preview'
                ? 'Preview requests do not create persisted commands.'
                : 'Mutation is not accepted for persistence.',
      commandId: appendAllowed ? deterministicCommandId : null,
      idempotencyKey: appendAllowed ? providerServiceContract.operation.idempotencyKey : null,
      expectedStatus: appendAllowed ? 'pending' : null,
    },
  };
}

function buildPersistedAccountingCheckpoint(budgetAccounting) {
  const meterByName = new Map(budgetAccounting.meters.map((meter) => [meter.name, meter]));
  const pickMeter = (name) => meterByName.get(name) || buildAccountingMeter(name, 'units', 0, 0, 0);
  const tokens = pickMeter('tokens');
  const messages = pickMeter('messages');
  const wallClock = pickMeter('wallClock');
  const retries = pickMeter('retries');
  const wave = pickMeter('waveConcurrency');

  return {
    schema: 'scheduler.budget-manager.persisted-accounting-checkpoint.v1',
    status: budgetAccounting.status,
    canSchedule: budgetAccounting.canSchedule,
    admissionStatus: budgetAccounting.plan.admission.status,
    meters: {
      tokens: { used: tokens.used, reserved: tokens.reserved, requested: tokens.requested, remaining: tokens.remaining },
      messages: { used: messages.used, requested: messages.requested, remaining: messages.remaining },
      wallClockMs: { used: wallClock.used, requested: wallClock.requested, remaining: wallClock.remaining },
      retries: { used: retries.used, requested: retries.requested, remaining: retries.remaining },
      waveSlots: { active: wave.consumed, requested: wave.requested, deferred: budgetAccounting.plan.admission.wave.deferredSlots },
    },
  };
}

function buildPersistedStateContract(input, budgetEnvelope, budgetAccounting, acceptanceRequest, acceptanceContract, syncMetadata, tenantBoundary, providerServiceContract, workflowHandoff, operationalHealth, now) {
  const source = input.persistedState && typeof input.persistedState === 'object'
    ? input.persistedState
    : input.state && typeof input.state === 'object'
      ? input.state
      : {};
  const rawCommands = Array.isArray(source.commands)
    ? source.commands
    : Array.isArray(source.commandLog)
      ? source.commandLog
      : [];
  const commands = rawCommands
    .map((command, index) => normalizePersistedCommand(command, index, tenantBoundary, providerServiceContract))
    .filter((command) => command.scopeKey === tenantBoundary.workspace.scopeKey)
    .slice(-25);
  const idempotencyKey = providerServiceContract.operation.idempotencyKey;
  const replay = buildIdempotencyReplayAssessment(commands, idempotencyKey, acceptanceRequest, {
    operationProjection: buildBudgetOperationProjection(budgetEnvelope, acceptanceRequest),
  });
  const commandRecovery = buildCommandRecoveryShape(commands, replay, acceptanceRequest, acceptanceContract, providerServiceContract, operationalHealth, now);
  const accountingCheckpoint = buildPersistedAccountingCheckpoint(budgetAccounting);
  const duplicateReplay = replay.replaySafe;
  const commandStatus = duplicateReplay
    ? 'duplicate_replayed'
    : replay.conflict
      ? 'idempotency_conflict'
      : commandRecovery.status === 'stale_pending_reclaimable'
        ? 'stale_pending_reclaimable'
      : replay.status === 'pending_equivalent'
        ? 'already_pending'
        : workflowHandoff.status === 'provider_unavailable'
          ? 'awaiting_provider_recovery'
          : operationalHealth.retryPolicy.retryable
            ? 'retry_scheduled'
            : acceptanceContract.accepted
              ? 'ready_to_persist'
              : acceptanceRequest.action === 'preview'
                ? 'preview_only'
                : workflowHandoff.status.includes('blocked')
                  ? 'blocked'
                  : 'waiting_for_confirmation';
  const checkpointCursor = syncMetadata.providerCursor
    || syncMetadata.cursor
    || asNonEmptyString(source.cursor)
    || asNonEmptyString(source.checkpoint && source.checkpoint.cursor);
  const checkpointSequence = Math.max(
    Math.trunc(asFiniteNonNegativeNumber(source.sequence)),
    Math.trunc(asFiniteNonNegativeNumber(source.checkpoint && source.checkpoint.sequence)),
    Math.trunc(asFiniteNonNegativeNumber(syncMetadata.sequence)),
  );
  const recovered = commands.length > 0 || Boolean(source.checkpoint || source.storageKey);
  const restartSafe = duplicateReplay
    || commandStatus === 'preview_only'
    || commandStatus === 'blocked'
    || commandRecovery.status === 'pending_in_flight'
    || commandRecovery.status === 'stale_pending_reclaimable'
    || (Boolean(checkpointCursor) && !replay.conflict);

  return {
    schema: 'scheduler.budget-manager.persisted-state.v1',
    generatedAt: now,
    storageKey: asNonEmptyString(source.storageKey, `budget:${tenantBoundary.workspace.scopeKey}`),
    recovered,
    restartSafe,
    checkpoint: {
      cursor: checkpointCursor,
      sequence: checkpointSequence,
      authority: syncMetadata.authority,
      freshness: syncMetadata.freshness,
      resumable: restartSafe && Boolean(checkpointCursor),
    },
    command: {
      idempotencyKey,
      status: commandStatus,
      action: acceptanceRequest.action,
      requestedAmount: acceptanceRequest.amount,
      duplicateOfCommandId: replay.duplicateOfCommandId,
      pendingCommandId: replay.pendingCommandId,
      conflictCommandId: replay.conflictCommandId,
      appendCommandId: commandRecovery.append.commandId,
      effect: duplicateReplay
        ? 'no_op_already_applied'
        : replay.conflict
          ? 'no_mutation_idempotency_conflict'
          : commandRecovery.status === 'stale_pending_reclaimable'
            ? 'persist_reclaim_before_apply'
          : replay.status === 'pending_equivalent'
            ? 'no_op_already_pending'
            : acceptanceContract.accepted
              ? 'persist_then_apply'
              : 'no_mutation',
    },
    idempotencyReplay: replay,
    commandRecovery,
    recovery: {
      path: duplicateReplay
        ? 'return_prior_terminal_result'
        : replay.conflict
          ? 'operator_resolve_idempotency_conflict'
          : commandRecovery.status === 'stale_pending_reclaimable'
            ? 'reclaim_stale_pending_command'
          : replay.status === 'pending_equivalent'
            ? 'resume_pending_command'
            : operationalHealth.retryPolicy.retryable
              ? 'resume_after_retry_backoff'
              : checkpointCursor
                ? 'resume_from_checkpoint'
                : 'rebuild_snapshot_before_mutation',
      nextAction: duplicateReplay
        ? 'surface_terminal_status'
        : replay.conflict
          ? 'use_new_client_mutation_id_or_reconcile_prior_command'
          : commandRecovery.status === 'stale_pending_reclaimable'
            ? 'append_reclaim_command_with_same_idempotency_key'
          : replay.status === 'pending_equivalent'
            ? 'wait_for_pending_command_result'
            : operationalHealth.retryPolicy.retryable
              ? 'retry_provider_with_same_idempotency_key'
              : acceptanceContract.accepted
                ? 'write_command_before_provider_apply'
                : 'wait_for_user_or_operator_resolution',
      retryAfterMs: operationalHealth.retryPolicy.retryable ? operationalHealth.retryPolicy.nextDelayMs : 0,
    },
    budgetSnapshot: {
      unit: budgetEnvelope.unit,
      limit: budgetEnvelope.limit,
      reserved: budgetEnvelope.reserved,
      spent: budgetEnvelope.spent,
      remaining: budgetEnvelope.remaining,
    },
    accountingCheckpoint,
    recentCommands: commands,
  };
}

function normalizeHistorySnapshots(input = {}, now, budgetEnvelope) {
  const rawSnapshots = Array.isArray(input.historySnapshots)
    ? input.historySnapshots
    : input.analytics && Array.isArray(input.analytics.history)
      ? input.analytics.history
      : [];

  return rawSnapshots
    .map((snapshot, index) => {
      const entry = snapshot && typeof snapshot === 'object' ? snapshot : {};
      const budget = entry.budget && typeof entry.budget === 'object' ? entry.budget : entry;
      const unit = SUPPORTED_BUDGET_UNITS.has(budget.unit) ? budget.unit : budgetEnvelope.unit;
      const limit = asFiniteNonNegativeNumber(budget.limit, budgetEnvelope.limit);
      const reserved = Math.min(asFiniteNonNegativeNumber(budget.reserved), limit);
      const spent = Math.min(asFiniteNonNegativeNumber(budget.spent), limit);
      const remaining = Math.max(0, limit - reserved - spent);
      const generatedAt = asNonEmptyString(entry.generatedAt, asNonEmptyString(entry.at, now));

      return {
        snapshotId: asNonEmptyString(entry.snapshotId, `budget-history-${index + 1}`),
        generatedAt,
        source: asNonEmptyString(entry.source, 'client-history'),
        action: SUPPORTED_ACCEPTANCE_ACTIONS.has(entry.action) ? entry.action : 'preview',
        budget: {
          unit,
          limit,
          reserved,
          spent,
          remaining,
          utilizationRatio: limit > 0 ? Number(((reserved + spent) / limit).toFixed(4)) : 0,
        },
      };
    })
    .sort((left, right) => left.generatedAt.localeCompare(right.generatedAt))
    .slice(-12);
}

function normalizeAccountingHistorySnapshots(input = {}, now) {
  const rawSnapshots = Array.isArray(input.accountingHistory)
    ? input.accountingHistory
    : input.analytics && Array.isArray(input.analytics.accountingHistory)
      ? input.analytics.accountingHistory
      : input.analytics && Array.isArray(input.analytics.meterHistory)
        ? input.analytics.meterHistory
        : [];

  return rawSnapshots
    .map((snapshot, index) => {
      const entry = snapshot && typeof snapshot === 'object' ? snapshot : {};
      const accounting = entry.accounting && typeof entry.accounting === 'object' ? entry.accounting : {};
      const meters = Array.isArray(entry.meters)
        ? entry.meters
        : Array.isArray(accounting.meters)
          ? accounting.meters
          : [];
      const meterSummaries = meters
        .map((meter) => {
          const safeMeter = meter && typeof meter === 'object' ? meter : {};
          return {
            name: asNonEmptyString(safeMeter.name),
            unit: asNonEmptyString(safeMeter.unit, 'units'),
            limit: Math.trunc(asFiniteNonNegativeNumber(safeMeter.limit)),
            consumed: Math.trunc(asFiniteNonNegativeNumber(safeMeter.consumed, asFiniteNonNegativeNumber(safeMeter.used))),
            requested: Math.trunc(asFiniteNonNegativeNumber(safeMeter.requested)),
            remaining: Math.trunc(asFiniteNonNegativeNumber(safeMeter.remaining)),
            overflow: Math.trunc(asFiniteNonNegativeNumber(safeMeter.overflow)),
            fits: safeMeter.fits !== false,
          };
        })
        .filter((meter) => meter.name);
      const generatedAt = asNonEmptyString(entry.generatedAt, asNonEmptyString(entry.at, now));
      const admission = entry.admission && typeof entry.admission === 'object'
        ? entry.admission
        : accounting.admission && typeof accounting.admission === 'object'
          ? accounting.admission
          : {};

      return {
        snapshotId: asNonEmptyString(entry.snapshotId, `budget-accounting-history-${index + 1}`),
        generatedAt,
        source: asNonEmptyString(entry.source, 'client-accounting-history'),
        status: asNonEmptyString(entry.status, asNonEmptyString(accounting.status, 'unknown')),
        admissionStatus: asNonEmptyString(admission.status, 'unknown'),
        blockedMeters: uniqueStrings(Array.isArray(admission.blockedMeters) ? admission.blockedMeters : entry.blockedMeters),
        meters: meterSummaries,
      };
    })
    .sort((left, right) => left.generatedAt.localeCompare(right.generatedAt))
    .slice(-12);
}

function buildAccountingTrendRows(accountingHistory, currentMeters) {
  const priorSnapshot = accountingHistory.length > 0 ? accountingHistory[accountingHistory.length - 1] : null;
  const priorByName = new Map((priorSnapshot ? priorSnapshot.meters : []).map((meter) => [meter.name, meter]));

  return currentMeters.map((meter) => {
    const prior = priorByName.get(meter.name);
    const consumedDelta = prior ? meter.consumed - prior.consumed : meter.consumed;
    const remainingDelta = prior ? meter.remaining - prior.remaining : 0;
    const pressureRatio = meter.limit > 0
      ? Number((Math.min(meter.consumed + meter.requested, meter.limit) / meter.limit).toFixed(4))
      : 0;
    const trend = consumedDelta > 0
      ? 'increased'
      : consumedDelta < 0
        ? 'decreased'
        : 'flat';

    return {
      meter: meter.name,
      unit: meter.unit,
      currentConsumed: meter.consumed,
      currentRequested: meter.requested,
      currentRemaining: meter.remaining,
      priorConsumed: prior ? prior.consumed : null,
      consumedDelta,
      remainingDelta,
      pressureRatio,
      trend,
      exportStatus: meter.fits ? pressureRatio >= 0.9 ? 'near_limit' : 'within_limit' : 'over_limit',
    };
  });
}

function buildAnalyticsReporting(input, budgetEnvelope, budgetAccounting, acceptanceRequest, validationSummary, acceptanceContract, readiness, workflowHandoff, operationalHealth, tenantBoundary, syncMetadata, providerServiceContract, lifecycleControls, now) {
  const history = normalizeHistorySnapshots(input, now, budgetEnvelope);
  const accountingHistory = normalizeAccountingHistorySnapshots(input, now);
  const meterTrendRows = buildAccountingTrendRows(accountingHistory, budgetAccounting.meters);
  const currentUtilizationRatio = budgetEnvelope.limit > 0
    ? Number(((budgetEnvelope.reserved + budgetEnvelope.spent) / budgetEnvelope.limit).toFixed(4))
    : 0;
  const lastHistory = history.length > 0 ? history[history.length - 1] : null;
  const previousRemaining = lastHistory ? lastHistory.budget.remaining : budgetEnvelope.remaining;
  const remainingDelta = budgetEnvelope.remaining - previousRemaining;
  const failedChecks = validationSummary.checks.filter((check) => !check.passed);
  const exportRows = [
    {
      key: 'tenant_scope',
      label: 'Tenant scope',
      value: tenantBoundary.workspace.scopeKey,
    },
    {
      key: 'workspace_grant_status',
      label: 'Workspace grant status',
      value: tenantBoundary.workspace.grantStatus,
    },
    {
      key: 'workspace_grant_id',
      label: 'Workspace grant',
      value: tenantBoundary.workspace.activeGrantId || 'none',
    },
    {
      key: 'lifecycle_status',
      label: 'Lifecycle status',
      value: lifecycleControls.status,
    },
    {
      key: 'lifecycle_next_action',
      label: 'Lifecycle next action',
      value: lifecycleControls.nextAction,
    },
    {
      key: 'scoped_permission_count',
      label: 'Scoped permissions',
      value: tenantBoundary.principal.scopedPermissions.length,
    },
    {
      key: 'budget_remaining',
      label: 'Budget remaining',
      value: budgetEnvelope.remaining,
      unit: budgetEnvelope.unit,
    },
    {
      key: 'requested_amount',
      label: 'Requested amount',
      value: acceptanceRequest.amount,
      unit: budgetEnvelope.unit,
    },
    {
      key: 'workflow_status',
      label: 'Workflow status',
      value: workflowHandoff.status,
    },
    {
      key: 'readiness_status',
      label: 'Readiness status',
      value: readiness.status,
    },
    {
      key: 'accounting_admission',
      label: 'Accounting admission',
      value: budgetAccounting.plan.admission.status,
    },
    {
      key: 'wave_projected_width',
      label: 'Wave projected width',
      value: budgetAccounting.plan.admission.wave.projectedWidth,
      unit: 'workers',
    },
    ...meterTrendRows.map((row) => ({
      key: `meter_${row.meter}_pressure`,
      label: `${row.meter} pressure`,
      value: row.pressureRatio,
      unit: 'ratio',
      status: row.exportStatus,
    })),
  ];
  const timeline = [
    ...history.map((snapshot) => ({
      at: snapshot.generatedAt,
      kind: 'history_snapshot',
      status: snapshot.action,
      label: `Historical ${snapshot.action} snapshot`,
      remaining: snapshot.budget.remaining,
      unit: snapshot.budget.unit,
      source: snapshot.source,
    })),
    ...accountingHistory.map((snapshot) => ({
      at: snapshot.generatedAt,
      kind: 'accounting_snapshot',
      status: snapshot.admissionStatus,
      label: `Accounting ${snapshot.status}`,
      blockedMeters: snapshot.blockedMeters,
      meterCount: snapshot.meters.length,
      source: snapshot.source,
    })),
    {
      at: now,
      kind: 'current_request',
      status: workflowHandoff.status,
      label: acceptanceContract.accepted ? 'Budget mutation accepted' : 'Budget request evaluated',
      remaining: budgetEnvelope.remaining,
      unit: budgetEnvelope.unit,
      source: syncMetadata.authority,
    },
  ];

  return {
    schema: 'scheduler.budget-manager.analytics-reporting.v1',
    counters: {
      historySnapshotCount: history.length,
      accountingHistorySnapshotCount: accountingHistory.length,
      validationErrorCount: validationSummary.errorCount,
      validationWarningCount: validationSummary.warningCount,
      failedCheckCount: failedChecks.length,
      acceptedMutationCount: acceptanceContract.accepted ? 1 : 0,
      blockedWorkflowCount: workflowHandoff.status.includes('blocked') ? 1 : 0,
      degradedEvaluationCount: operationalHealth.degradedMode.enabled ? 1 : 0,
      retryableFailureCount: operationalHealth.retryPolicy.retryable ? 1 : 0,
      providerRejectedReasonCount: providerServiceContract.operation.rejectedReasons.length,
      serviceContractMutationReadyCount: providerServiceContract.operation.canApply ? 1 : 0,
      workspaceGrantRequiredCount: tenantBoundary.workspace.grantRequired ? 1 : 0,
      workspaceGrantActiveCount: tenantBoundary.workspace.grantStatus === 'active' ? 1 : 0,
      scopedPermissionCount: tenantBoundary.principal.scopedPermissions.length,
      lifecycleBlockedCount: lifecycleControls.status === 'blocked' ? 1 : 0,
      lifecycleMutationAllowedCount: lifecycleControls.scheduling.mutationAllowed ? 1 : 0,
      accountingBlockedMeterCount: budgetAccounting.meters.filter((meter) => !meter.fits).length,
      accountingWarningMeterCount: budgetAccounting.warningReasons.length,
      accountingWaveDeferredSlotCount: budgetAccounting.plan.admission.wave.deferredSlots,
      accountingWaveThrottleCount: budgetAccounting.plan.admission.wave.shouldThrottle ? 1 : 0,
      accountingRetryRemainingCount: budgetAccounting.plan.retry.attemptsRemaining,
      accountingMetersNearLimitCount: meterTrendRows.filter((row) => row.exportStatus === 'near_limit').length,
      accountingMetersOverLimitCount: meterTrendRows.filter((row) => row.exportStatus === 'over_limit').length,
      tokenConsumedCount: (budgetAccounting.meters.find((meter) => meter.name === 'tokens') || {}).consumed || 0,
      messageConsumedCount: (budgetAccounting.meters.find((meter) => meter.name === 'messages') || {}).consumed || 0,
      wallClockConsumedMs: (budgetAccounting.meters.find((meter) => meter.name === 'wallClock') || {}).consumed || 0,
      retryAttemptConsumedCount: (budgetAccounting.meters.find((meter) => meter.name === 'retries') || {}).consumed || 0,
      waveActiveSlotCount: budgetAccounting.plan.admission.wave.activeWidth,
    },
    currentSnapshot: {
      generatedAt: now,
      action: acceptanceRequest.action,
      workflowStatus: workflowHandoff.status,
      readinessStatus: readiness.status,
      budget: {
        unit: budgetEnvelope.unit,
        limit: budgetEnvelope.limit,
        reserved: budgetEnvelope.reserved,
        spent: budgetEnvelope.spent,
        remaining: budgetEnvelope.remaining,
        remainingDelta,
        utilizationRatio: currentUtilizationRatio,
      },
      accounting: {
        status: budgetAccounting.status,
        canSchedule: budgetAccounting.canSchedule,
        admissionStatus: budgetAccounting.plan.admission.status,
        waveWidthLimit: budgetAccounting.policy.waveWidthLimit,
        wave: budgetAccounting.plan.admission.wave,
        retry: budgetAccounting.plan.retry,
        reservations: {
          tokens: budgetAccounting.plan.reservations.tokens,
          messages: budgetAccounting.plan.reservations.messages,
          wallClockMs: budgetAccounting.plan.reservations.wallClockMs,
          retries: budgetAccounting.plan.reservations.retries,
          waveSlots: budgetAccounting.plan.reservations.waveSlots,
        },
        meters: budgetAccounting.meters.map((meter) => ({
          name: meter.name,
          limit: meter.limit,
          consumed: meter.consumed,
          requested: meter.requested,
          remaining: meter.remaining,
          fits: meter.fits,
        })),
      },
      lifecycle: {
        status: lifecycleControls.status,
        command: lifecycleControls.command,
        mode: lifecycleControls.mode,
        nextAction: lifecycleControls.nextAction,
        scheduleAllowed: lifecycleControls.scheduling.scheduleAllowed,
        mutationAllowed: lifecycleControls.scheduling.mutationAllowed,
      },
    },
    history,
    accountingHistory,
    meterTrends: meterTrendRows,
    exportSummary: {
      exportType: 'scheduler.budget-manager.summary.v1',
      generatedAt: now,
      syncCursor: syncMetadata.cursor,
      syncSequence: syncMetadata.sequence,
      scopeKey: tenantBoundary.workspace.scopeKey,
      principalId: tenantBoundary.principal.principalId,
      providerAuthority: syncMetadata.authority,
      providerProtocol: providerServiceContract.service.protocol,
      providerSyncMode: providerServiceContract.service.syncMode,
      canExportForAudit: tenantBoundary.principal.permissions.includes('audit.read'),
      reportState: {
        timelineEventCount: timeline.length,
        budgetHistoryEventCount: history.length,
        accountingHistoryEventCount: accountingHistory.length,
        currentRequestIncluded: true,
        latestAdmissionStatus: budgetAccounting.plan.admission.status,
        latestWorkflowStatus: workflowHandoff.status,
      },
      meterTrendRows,
      rows: exportRows,
    },
    timeline,
  };
}

function buildPreviewAcceptanceRouteContract(
  preview,
  validationSummary,
  acceptanceContract,
  readiness,
  workflowHandoff,
  nextSteps,
  reviewContract,
  clientRuntime,
  providerServiceContract,
  tenantBoundary,
  persistedState,
  analyticsReporting,
  lifecycleControls,
) {
  const failedChecks = validationSummary.checks.filter((check) => !check.passed);
  const groupedChecks = validationSummary.checks.reduce((groups, check) => {
    const key = check.severity || 'info';
    return {
      ...groups,
      [key]: [...(groups[key] || []), {
        code: check.code,
        passed: check.passed,
        message: check.message,
      }],
    };
  }, { info: [], warning: [], error: [] });
  const blockingGateNames = readiness.gates
    .filter((gate) => !gate.ready)
    .map((gate) => gate.name);
  const canSubmit = acceptanceContract.action !== 'preview'
    && readiness.ready
    && acceptanceContract.permission.allowed
    && acceptanceContract.providerCanApply
    && validationSummary.status !== 'blocked';
  const userDecision = acceptanceContract.accepted
    ? 'accepted'
    : validationSummary.status === 'blocked'
      ? 'blocked'
      : canSubmit
        ? 'ready_for_acceptance'
        : 'review_required';

  return {
    schema: 'scheduler.budget-manager.preview-acceptance-route.v1',
    decision: userDecision,
    generatedFor: {
      requestId: clientRuntime.request.requestId,
      traceId: clientRuntime.request.traceId,
      routeId: clientRuntime.request.routeId,
      clientMutationId: acceptanceContract.clientMutationId,
    },
    userVisiblePreview: {
      title: workflowHandoff.userVisible.title,
      label: preview.label,
      severity: preview.displayHints.severity,
      unit: preview.unit,
      before: preview.before,
      after: preview.after,
      delta: {
        reserved: preview.after.reserved - preview.before.reserved,
        spent: preview.after.spent - preview.before.spent,
        remaining: preview.after.remaining - preview.before.remaining,
      },
      requestedAmount: preview.requestedAmount,
      acceptedPreviewAmount: preview.acceptedPreviewAmount,
      accountingStatus: validationSummary.budgetAccounting.status,
      accountingAdmissionStatus: validationSummary.budgetAccounting.plan.admission.status,
      waveAdmission: validationSummary.budgetAccounting.plan.admission.wave,
    },
    acceptanceRequest: {
      action: acceptanceContract.action,
      mode: acceptanceContract.mode,
      submitEnabled: acceptanceContract.accepted || canSubmit,
      submitRequiresDryRunFalse: !acceptanceContract.accepted && canSubmit,
      idempotencyKey: acceptanceContract.providerService.idempotencyKey,
      requiredPermission: acceptanceContract.permission.requiredPermission,
      permissionSource: acceptanceContract.permission.permissionSource,
      workspaceGrantStatus: acceptanceContract.permission.workspaceGrant.status,
      workspaceGrantId: acceptanceContract.permission.workspaceGrant.activeGrantId,
      requiredCapability: acceptanceContract.requiredCapability,
      providerEndpoint: acceptanceContract.providerService.endpoint,
      providerApplyMode: acceptanceContract.providerService.applyMode,
      providerWarnings: acceptanceContract.providerService.warnings,
      payload: {
        tenantId: tenantBoundary.tenantId,
        workspaceId: tenantBoundary.workspaceId,
        scopeKey: tenantBoundary.workspace.scopeKey,
        action: acceptanceContract.action,
        amount: preview.acceptedPreviewAmount,
        dryRun: false,
        clientMutationId: acceptanceContract.clientMutationId,
        idempotencyKey: acceptanceContract.providerService.idempotencyKey,
        syncCursor: providerServiceContract.sync.cursor,
      },
    },
    readinessChecklist: readiness.gates.map((gate) => ({
      code: `readiness.${gate.name}`,
      label: gate.name,
      ready: gate.ready,
      blocking: !gate.ready,
    })),
    validationPanel: {
      status: validationSummary.status,
      errorCount: validationSummary.errorCount,
      warningCount: validationSummary.warningCount,
      groupedChecks,
      failedCodes: failedChecks.map((check) => check.code),
    },
    reviewSummary: {
      schema: reviewContract.schema,
      status: reviewContract.status,
      validation: reviewContract.validation,
      readiness: reviewContract.readiness,
      acceptance: reviewContract.acceptance,
      accounting: reviewContract.accounting,
      primaryNextStep: reviewContract.nextStepPayloads[0] || null,
    },
    routeIntegration: {
      targetSurface: workflowHandoff.targetSurface,
      returnTo: workflowHandoff.route.returnTo,
      primaryAction: workflowHandoff.userVisible.primaryAction,
      disabled: workflowHandoff.userVisible.disabled || blockingGateNames.length > 0,
      disabledReasons: blockingGateNames,
      lifecycleStatus: lifecycleControls.status,
      lifecycleNextAction: lifecycleControls.nextAction,
      commandStatus: persistedState.command.status,
      restartSafe: persistedState.restartSafe,
      recoveryPath: persistedState.recovery.path,
      accountingCanSchedule: validationSummary.budgetAccounting.canSchedule,
      accountingCanEnterWave: validationSummary.budgetAccounting.plan.admission.canEnterWave,
      accountingBlockedMeters: validationSummary.budgetAccounting.plan.admission.blockedMeters,
    },
    nextSteps: nextSteps.map((step, index) => ({
      order: index + 1,
      code: step.code,
      label: step.label,
      detail: step.detail,
      primary: index === 0,
    })),
    proofSummary: {
      exportReady: analyticsReporting.exportSummary.canExportForAudit,
      analyticsTimelineEvents: analyticsReporting.timeline.length,
      storageKey: persistedState.storageKey,
      commandEffect: persistedState.command.effect,
      idempotencyStatus: persistedState.idempotencyReplay.status,
      idempotencyConflict: persistedState.idempotencyReplay.conflict,
      lifecycleMutationAllowed: lifecycleControls.scheduling.mutationAllowed,
    },
  };
}

export function describeBudgetManagerSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const providerContract = normalizeProvider(input.provider);
  const budgetEnvelope = normalizeBudgetEnvelope(input.budget);
  const acceptanceRequest = normalizeAcceptanceRequest(input);
  const tenantBoundary = normalizeTenantBoundary(input, now);
  const syncMetadata = buildSyncMetadata(input, providerContract, now);
  const clientRuntime = normalizeClientRuntimeState(input, acceptanceRequest, syncMetadata);
  const operationalHealth = normalizeOperationalHealth(input, providerContract, clientRuntime);
  const budgetAccounting = normalizeBudgetAccounting(input, budgetEnvelope, acceptanceRequest, clientRuntime, operationalHealth, now);
  const lifecycleControls = normalizeLifecycleControls(input, acceptanceRequest, budgetAccounting, now);
  const externalHandoff = buildExternalHandoff(input, providerContract, budgetEnvelope, syncMetadata, tenantBoundary, now);
  const providerServiceContract = buildProviderServiceContract(providerContract, acceptanceRequest, syncMetadata, tenantBoundary, externalHandoff, operationalHealth, now);
  const permissionBoundary = buildPermissionBoundary(tenantBoundary, acceptanceRequest, externalHandoff);
  const validationSummary = buildValidationSummary(providerContract, providerServiceContract, budgetEnvelope, budgetAccounting, externalHandoff, acceptanceRequest, permissionBoundary, operationalHealth, lifecycleControls);
  const preview = buildUserVisiblePreview(budgetEnvelope, acceptanceRequest, validationSummary);
  const acceptance = buildAcceptanceContract(providerContract, providerServiceContract, budgetEnvelope, acceptanceRequest, validationSummary, preview, permissionBoundary, operationalHealth);
  const readiness = buildReadinessSnapshot(providerContract, providerServiceContract, validationSummary, acceptance, externalHandoff, permissionBoundary, operationalHealth, lifecycleControls);
  const workflowHandoff = buildWorkflowHandoff(clientRuntime, acceptanceRequest, acceptance, readiness, externalHandoff, validationSummary, permissionBoundary, operationalHealth, lifecycleControls);
  const nextSteps = buildExplainableNextSteps(validationSummary, acceptance, readiness, externalHandoff, permissionBoundary, operationalHealth, lifecycleControls);
  const reviewContract = buildReviewDataContract(preview, validationSummary, acceptance, readiness, workflowHandoff, nextSteps, operationalHealth, lifecycleControls);
  const clientDecision = buildClientDecisionContract(preview, validationSummary, acceptance, readiness, workflowHandoff, nextSteps, operationalHealth, reviewContract, lifecycleControls);
  const auditProof = buildAuditProof(input, providerContract, providerServiceContract, budgetEnvelope, budgetAccounting, syncMetadata, externalHandoff, clientRuntime, workflowHandoff, tenantBoundary, permissionBoundary, operationalHealth, lifecycleControls);
  const analyticsReporting = buildAnalyticsReporting(input, budgetEnvelope, budgetAccounting, acceptanceRequest, validationSummary, acceptance, readiness, workflowHandoff, operationalHealth, tenantBoundary, syncMetadata, providerServiceContract, lifecycleControls, now);
  const persistedState = buildPersistedStateContract(input, budgetEnvelope, budgetAccounting, acceptanceRequest, acceptance, syncMetadata, tenantBoundary, providerServiceContract, workflowHandoff, operationalHealth, now);
  const previewAcceptanceRoute = buildPreviewAcceptanceRouteContract(
    preview,
    validationSummary,
    acceptance,
    readiness,
    workflowHandoff,
    nextSteps,
    reviewContract,
    clientRuntime,
    providerServiceContract,
    tenantBoundary,
    persistedState,
    analyticsReporting,
    lifecycleControls,
  );

  return {
    ok: true,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: {
      kind: 'scheduler.budget-manager.provider-service-contract',
      version: providerContract.contractVersion,
      provider: providerContract,
      providerService: providerServiceContract,
      clientRuntime,
      tenantBoundary,
      permissionBoundary,
      budget: budgetEnvelope,
      budgetAccounting,
      lifecycleControls,
      sync: syncMetadata,
      operationalHealth,
      externalHandoff,
      acceptance,
      readiness,
      workflowHandoff,
      clientDecision,
      reviewContract,
      previewAcceptanceRoute,
      persistedState,
      analyticsReporting,
    },
    preview,
    validationSummary,
    nextSteps,
    reviewContract,
    clientDecision,
    auditProof: {
      ...auditProof,
      analyticsSchema: analyticsReporting.schema,
      analyticsSnapshotCount: analyticsReporting.counters.historySnapshotCount,
      analyticsTimelineEvents: analyticsReporting.timeline.length,
      exportReady: analyticsReporting.exportSummary.canExportForAudit,
      accountingStatus: budgetAccounting.status,
      accountingCanSchedule: budgetAccounting.canSchedule,
      accountingBlockedMeters: budgetAccounting.meters.filter((meter) => !meter.fits).map((meter) => meter.name),
      accountingAdmissionStatus: budgetAccounting.plan.admission.status,
      accountingCanEnterWave: budgetAccounting.plan.admission.canEnterWave,
      accountingWaveActiveWidth: budgetAccounting.plan.admission.wave.activeWidth,
      accountingWaveProjectedWidth: budgetAccounting.plan.admission.wave.projectedWidth,
      accountingWaveDeferredSlots: budgetAccounting.plan.admission.wave.deferredSlots,
      accountingRetryAttemptsRemaining: budgetAccounting.plan.retry.attemptsRemaining,
      clientDecisionStatus: clientDecision.status,
      clientDecisionTargetSurface: clientDecision.routeIntent.targetSurface,
      clientDecisionDisabledReasons: clientDecision.routeIntent.disabledReasons,
      persistedStateSchema: persistedState.schema,
      persistedStorageKey: persistedState.storageKey,
      persistedCommandStatus: persistedState.command.status,
      persistedRestartSafe: persistedState.restartSafe,
      persistedRecoveryPath: persistedState.recovery.path,
      persistedDuplicateCommandId: persistedState.command.duplicateOfCommandId,
      persistedIdempotencyReplayStatus: persistedState.idempotencyReplay.status,
      persistedIdempotencyConflict: persistedState.idempotencyReplay.conflict,
      persistedIdempotencyConflictCommandId: persistedState.command.conflictCommandId,
      lifecycleControlsSchema: lifecycleControls.schema,
      lifecycleStatus: lifecycleControls.status,
      lifecycleNextAction: lifecycleControls.nextAction,
      lifecycleMutationAllowed: lifecycleControls.scheduling.mutationAllowed,
      previewAcceptanceRouteSchema: previewAcceptanceRoute.schema,
      previewAcceptanceDecision: previewAcceptanceRoute.decision,
      previewAcceptanceSubmitEnabled: previewAcceptanceRoute.acceptanceRequest.submitEnabled,
      previewAcceptanceTargetSurface: previewAcceptanceRoute.routeIntegration.targetSurface,
      reviewContractStatus: reviewContract.status,
      reviewContractPrimaryStep: reviewContract.nextStepPayloads[0] ? reviewContract.nextStepPayloads[0].code : null,
      reviewContractBlockedGates: reviewContract.readiness.blockedGates,
    },
    persistedState,
    analyticsReporting,
    previewAcceptanceRoute,
    evidence: Array.isArray(input.evidence) ? input.evidence : [],
  };
}

export default describeBudgetManagerSurface;
