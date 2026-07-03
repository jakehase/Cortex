export const surfaceId = "aios_operator-userland_cli-approve_086";
export const surfaceGroup = "operator-userland";
export const surfaceName = "cli-approve";

const lifecycleCommands = new Set(['status', 'approve', 'reject', 'hold', 'enable', 'disable', 'schedule']);
const supportedProviderCapabilities = [
  'hosted-kernel.approval-intent.v1',
  'hosted-kernel.lifecycle-proof.v1',
  'operator-audit.append.v1',
  'external-handoff.state.v1',
  'hosted-kernel.idempotent-command.v1'
];
const defaultSettings = {
  enabled: true,
  requireReason: true,
  minApprovers: 1,
  maxScheduleDelayMinutes: 240,
  allowedActions: ['deploy', 'restart', 'rollback', 'config-change'],
  allowedRoles: ['operator', 'admin', 'release-manager'],
  allowedWorkspaces: ['default'],
  requireTenantMatch: true,
  requiredProviderCapabilities: ['hosted-kernel.approval-intent.v1', 'operator-audit.append.v1'],
  ackStaleAfterSeconds: 300,
  healthStaleAfterSeconds: 120,
  degradedQueueDepth: 50,
  healthErrorBudgetWindowSeconds: 900,
  healthErrorBudgetMaxFailures: 3,
  healthErrorBudgetMaxDegradedEvents: 6,
  retryBaseDelayMs: 1000,
  retryMaxDelayMs: 30000,
  retryMaxAttempts: 4,
  allowEnableCommand: true,
  allowDisableCommand: true,
  allowScheduleCommand: true,
  requireSettingsRevision: false,
  settingsRevision: 'cli-approve-settings:v1',
  minScheduleLeadMinutes: 1,
  scheduleBlackoutWindows: []
};

function normalizeCommand(command) {
  const value = String(command || 'status').trim().toLowerCase();
  return lifecycleCommands.has(value) ? value : 'status';
}

function normalizeSettings(settings = {}) {
  const merged = { ...defaultSettings, ...(settings && typeof settings === 'object' ? settings : {}) };
  const allowedActions = Array.isArray(merged.allowedActions)
    ? [...new Set(merged.allowedActions.map((action) => String(action).trim()).filter(Boolean))]
    : defaultSettings.allowedActions;
  const requiredProviderCapabilities = Array.isArray(merged.requiredProviderCapabilities)
    ? [...new Set(merged.requiredProviderCapabilities.map((capability) => String(capability).trim()).filter(Boolean))]
    : defaultSettings.requiredProviderCapabilities;
  const allowedRoles = Array.isArray(merged.allowedRoles)
    ? [...new Set(merged.allowedRoles.map((role) => String(role).trim().toLowerCase()).filter(Boolean))]
    : defaultSettings.allowedRoles;
  const allowedWorkspaces = Array.isArray(merged.allowedWorkspaces)
    ? [...new Set(merged.allowedWorkspaces.map((workspace) => String(workspace).trim()).filter(Boolean))]
    : defaultSettings.allowedWorkspaces;
  const scheduleBlackoutWindows = Array.isArray(merged.scheduleBlackoutWindows)
    ? merged.scheduleBlackoutWindows
        .map((window, index) => {
          if (!window || typeof window !== 'object') {
            return null;
          }
          const startsAt = window.startsAt || window.from || window.start || null;
          const endsAt = window.endsAt || window.to || window.end || null;
          const parsedStartsAt = startsAt ? Date.parse(startsAt) : Number.NaN;
          const parsedEndsAt = endsAt ? Date.parse(endsAt) : Number.NaN;

          if (!Number.isFinite(parsedStartsAt) || !Number.isFinite(parsedEndsAt) || parsedEndsAt <= parsedStartsAt) {
            return null;
          }

          return {
            blackoutId: String(window.blackoutId || window.id || `blackout-${index + 1}`).trim(),
            label: String(window.label || window.reason || 'operator-freeze-window').trim(),
            startsAt: new Date(parsedStartsAt).toISOString(),
            endsAt: new Date(parsedEndsAt).toISOString()
          };
        })
        .filter(Boolean)
    : defaultSettings.scheduleBlackoutWindows;

  return {
    enabled: merged.enabled !== false,
    requireReason: merged.requireReason !== false,
    minApprovers: Math.max(1, Number.parseInt(merged.minApprovers, 10) || defaultSettings.minApprovers),
    maxScheduleDelayMinutes: Math.max(
      0,
      Number.parseInt(merged.maxScheduleDelayMinutes, 10) || defaultSettings.maxScheduleDelayMinutes
    ),
    allowedActions,
    allowedRoles,
    allowedWorkspaces,
    requireTenantMatch: merged.requireTenantMatch !== false,
    requiredProviderCapabilities,
    ackStaleAfterSeconds: Math.max(
      30,
      Number.parseInt(merged.ackStaleAfterSeconds, 10) || defaultSettings.ackStaleAfterSeconds
    ),
    healthStaleAfterSeconds: Math.max(
      15,
      Number.parseInt(merged.healthStaleAfterSeconds, 10) || defaultSettings.healthStaleAfterSeconds
    ),
    degradedQueueDepth: Math.max(1, Number.parseInt(merged.degradedQueueDepth, 10) || defaultSettings.degradedQueueDepth),
    healthErrorBudgetWindowSeconds: Math.max(
      60,
      Number.parseInt(merged.healthErrorBudgetWindowSeconds, 10) || defaultSettings.healthErrorBudgetWindowSeconds
    ),
    healthErrorBudgetMaxFailures: Math.max(
      1,
      Number.parseInt(merged.healthErrorBudgetMaxFailures, 10) || defaultSettings.healthErrorBudgetMaxFailures
    ),
    healthErrorBudgetMaxDegradedEvents: Math.max(
      1,
      Number.parseInt(merged.healthErrorBudgetMaxDegradedEvents, 10) ||
        defaultSettings.healthErrorBudgetMaxDegradedEvents
    ),
    retryBaseDelayMs: Math.max(100, Number.parseInt(merged.retryBaseDelayMs, 10) || defaultSettings.retryBaseDelayMs),
    retryMaxDelayMs: Math.max(1000, Number.parseInt(merged.retryMaxDelayMs, 10) || defaultSettings.retryMaxDelayMs),
    retryMaxAttempts: Math.max(0, Number.parseInt(merged.retryMaxAttempts, 10) || defaultSettings.retryMaxAttempts),
    allowEnableCommand: merged.allowEnableCommand !== false,
    allowDisableCommand: merged.allowDisableCommand !== false,
    allowScheduleCommand: merged.allowScheduleCommand !== false,
    requireSettingsRevision: merged.requireSettingsRevision === true,
    settingsRevision: String(merged.settingsRevision || defaultSettings.settingsRevision).trim(),
    minScheduleLeadMinutes: Math.max(
      0,
      Number.parseInt(merged.minScheduleLeadMinutes, 10) || defaultSettings.minScheduleLeadMinutes
    ),
    scheduleBlackoutWindows
  };
}

function normalizeLifecycleControls(input, command, settings, scheduleAt, boundary, now) {
  const controlInput =
    input.lifecycleControl && typeof input.lifecycleControl === 'object'
      ? input.lifecycleControl
      : input.settingsControl && typeof input.settingsControl === 'object'
        ? input.settingsControl
        : input.controls && typeof input.controls === 'object'
          ? input.controls
          : {};
  const currentSettingsRevision = String(controlInput.currentSettingsRevision || settings.settingsRevision).trim();
  const expectedSettingsRevision = String(
    controlInput.expectedSettingsRevision || input.expectedSettingsRevision || currentSettingsRevision
  ).trim();
  const settingsRevisionMatched = !settings.requireSettingsRevision || expectedSettingsRevision === currentSettingsRevision;
  const requestedEnabled =
    command === 'enable' ? true : command === 'disable' ? false : controlInput.requestedEnabled ?? settings.enabled;
  const isToggleCommand = command === 'enable' || command === 'disable';
  const noopToggle = isToggleCommand && requestedEnabled === settings.enabled;
  const effectiveAtInput = controlInput.effectiveAt || controlInput.applyAt || (command === 'schedule' ? scheduleAt : null);
  const parsedEffectiveAt = effectiveAtInput ? Date.parse(effectiveAtInput) : Number.NaN;
  const effectiveAt = Number.isFinite(parsedEffectiveAt) ? new Date(parsedEffectiveAt).toISOString() : null;
  const parsedScheduleAt = scheduleAt ? Date.parse(scheduleAt) : Number.NaN;
  const scheduleDelayMinutes = Number.isFinite(parsedScheduleAt)
    ? Math.round((parsedScheduleAt - Date.parse(now)) / 60000)
    : null;
  const leadTimeSatisfied =
    command !== 'schedule' || (scheduleDelayMinutes !== null && scheduleDelayMinutes >= settings.minScheduleLeadMinutes);
  const blackoutWindow =
    command === 'schedule' && Number.isFinite(parsedScheduleAt)
      ? settings.scheduleBlackoutWindows.find(
          (window) => parsedScheduleAt >= Date.parse(window.startsAt) && parsedScheduleAt < Date.parse(window.endsAt)
        ) || null
      : null;
  const controlErrors = [
    command === 'enable' && !settings.allowEnableCommand ? 'enable-command-disabled-by-settings' : null,
    command === 'disable' && !settings.allowDisableCommand ? 'disable-command-disabled-by-settings' : null,
    command === 'schedule' && !settings.allowScheduleCommand ? 'schedule-command-disabled-by-settings' : null,
    settings.requireSettingsRevision && !settingsRevisionMatched ? 'settings-revision-mismatch' : null,
    command === 'schedule' && !leadTimeSatisfied ? 'schedule-lead-time-too-short' : null,
    blackoutWindow ? `schedule-blackout:${blackoutWindow.blackoutId}` : null
  ].filter(Boolean);

  return {
    contractVersion: 'cli-approve.lifecycle-controls.v1',
    command,
    currentEnabled: settings.enabled,
    requestedEnabled,
    noopToggle,
    currentSettingsRevision,
    expectedSettingsRevision,
    settingsRevisionMatched,
    effectiveAt,
    schedule: {
      requestedAt: scheduleAt || null,
      delayMinutes: scheduleDelayMinutes,
      minLeadMinutes: settings.minScheduleLeadMinutes,
      maxDelayMinutes: settings.maxScheduleDelayMinutes,
      leadTimeSatisfied,
      blackoutWindow,
      allowed: settings.allowScheduleCommand && !blackoutWindow && leadTimeSatisfied
    },
    toggles: {
      enableAllowed: settings.allowEnableCommand,
      disableAllowed: settings.allowDisableCommand,
      requestedByRole: boundary.role,
      workspaceId: boundary.workspaceId
    },
    blocked: controlErrors.length > 0,
    blockedReasons: controlErrors,
    nextControlAction:
      controlErrors.length > 0
        ? 'repair-lifecycle-controls'
        : command === 'enable'
          ? noopToggle
            ? 'surface-already-enabled'
            : 'persist-enabled-settings-state'
          : command === 'disable'
            ? noopToggle
              ? 'surface-already-disabled'
              : 'persist-disabled-settings-state'
            : command === 'schedule'
              ? 'persist-scheduled-decision'
              : 'observe-current-settings-state'
  };
}

function normalizeOperationalHealth(input, settings, providerContract, now) {
  const providerInput = input.provider && typeof input.provider === 'object' ? input.provider : {};
  const healthInput =
    input.health && typeof input.health === 'object'
      ? input.health
      : providerInput.health && typeof providerInput.health === 'object'
        ? providerInput.health
        : {};
  const rawStatus = String(healthInput.status || healthInput.state || 'healthy').trim().toLowerCase();
  const providerReachable = healthInput.reachable !== false && providerInput.reachable !== false;
  const lastHeartbeatAt = healthInput.lastHeartbeatAt || providerInput.lastHeartbeatAt || now;
  const heartbeatAgeSeconds = Math.max(0, Math.round((Date.parse(now) - Date.parse(lastHeartbeatAt)) / 1000));
  const queueDepth = Math.max(0, Number.parseInt(healthInput.queueDepth, 10) || 0);
  const latencyMs = Math.max(0, Number.parseInt(healthInput.latencyMs, 10) || 0);
  const consecutiveFailures = Math.max(0, Number.parseInt(healthInput.consecutiveFailures, 10) || 0);
  const circuitOpen = healthInput.circuitOpen === true || rawStatus === 'circuit-open';
  const heartbeatStale = !Number.isFinite(heartbeatAgeSeconds) || heartbeatAgeSeconds > settings.healthStaleAfterSeconds;
  const backlogDegraded = queueDepth >= settings.degradedQueueDepth;
  const failed = !providerReachable || ['down', 'offline', 'failed', 'unavailable'].includes(rawStatus) || circuitOpen;
  const degraded = !failed && (rawStatus === 'degraded' || heartbeatStale || backlogDegraded || consecutiveFailures > 0);
  const state = failed ? 'failed' : degraded ? 'degraded' : 'healthy';

  return {
    contractVersion: 'cli-approve.operational-health.v1',
    state,
    providerId: providerContract.providerId,
    endpointRef: providerContract.endpointRef,
    reachable: providerReachable && !circuitOpen,
    status: rawStatus,
    lastHeartbeatAt,
    heartbeatAgeSeconds: Number.isFinite(heartbeatAgeSeconds) ? heartbeatAgeSeconds : null,
    heartbeatStale,
    queueDepth,
    backlogDegraded,
    latencyMs,
    consecutiveFailures,
    circuitOpen,
    degradedMode: degraded,
    failureMode: failed ? (circuitOpen ? 'circuit-open' : providerReachable ? rawStatus : 'unreachable') : null
  };
}

function normalizeHealthEvent(event, index, request, providerContract, boundary, now) {
  if (!event || typeof event !== 'object') {
    return null;
  }

  const at = event.at || event.timestamp || event.generatedAt || event.observedAt || now;
  const parsedAt = Date.parse(at);
  const healthState = String(event.healthState || event.state || event.status || 'unknown').trim().toLowerCase();
  const errorCodes = Array.isArray(event.errorCodes)
    ? event.errorCodes.map((code) => String(code).trim()).filter(Boolean)
    : event.errorCode
      ? [String(event.errorCode).trim()]
      : [];
  const providerId = String(event.providerId || providerContract.providerId).trim();
  const requestId = String(event.requestId || event.id || request.id).trim();
  const boundaryScopeKey = String(event.boundaryScopeKey || boundary.scopeKey).trim();

  return {
    at: Number.isFinite(parsedAt) ? new Date(parsedAt).toISOString() : now,
    sequence: Number.parseInt(event.sequence, 10) || index + 1,
    providerId,
    requestId,
    boundaryScopeKey,
    healthState,
    errorCodes,
    retryable: event.retryable === true,
    degradedMode: event.degradedMode === true || healthState === 'degraded',
    failure:
      ['failed', 'down', 'offline', 'unavailable', 'critical'].includes(healthState) ||
      errorCodes.some((code) =>
        ['hosted_kernel_unavailable', 'provider_ack_terminal_failure', 'provider_ack_mismatch'].includes(code)
      )
  };
}

function buildHealthErrorBudget({ input, request, providerContract, boundary, operationalHealth, settings, now }) {
  const healthHistoryInput =
    input.healthHistory && Array.isArray(input.healthHistory)
      ? input.healthHistory
      : input.operationalEvents && Array.isArray(input.operationalEvents)
        ? input.operationalEvents
        : input.history && Array.isArray(input.history)
          ? input.history
          : input.auditHistory && Array.isArray(input.auditHistory)
            ? input.auditHistory
            : [];
  const currentEvent = {
    at: now,
    providerId: providerContract.providerId,
    requestId: request.id,
    boundaryScopeKey: boundary.scopeKey,
    healthState: operationalHealth.state,
    errorCodes: operationalHealth.failureMode ? ['hosted_kernel_unavailable'] : [],
    degradedMode: operationalHealth.degradedMode,
    retryable: operationalHealth.state === 'failed'
  };
  const windowStartMs = Date.parse(now) - settings.healthErrorBudgetWindowSeconds * 1000;
  const scopedEvents = [...healthHistoryInput, currentEvent]
    .map((event, index) => normalizeHealthEvent(event, index, request, providerContract, boundary, now))
    .filter(
      (event) =>
        event &&
        Date.parse(event.at) >= windowStartMs &&
        event.providerId === providerContract.providerId &&
        event.boundaryScopeKey === boundary.scopeKey
    )
    .sort((left, right) => Date.parse(left.at) - Date.parse(right.at) || left.sequence - right.sequence);
  const failedEvents = scopedEvents.filter((event) => event.failure);
  const degradedEvents = scopedEvents.filter((event) => event.degradedMode && !event.failure);
  const exhausted = failedEvents.length >= settings.healthErrorBudgetMaxFailures;
  const degradedBudgetExceeded =
    !exhausted && degradedEvents.length >= settings.healthErrorBudgetMaxDegradedEvents && operationalHealth.state !== 'healthy';
  const state = exhausted ? 'exhausted' : degradedBudgetExceeded ? 'degraded' : 'within-budget';
  const failureRatio = scopedEvents.length > 0 ? failedEvents.length / scopedEvents.length : 0;

  return {
    contractVersion: 'cli-approve.health-error-budget.v1',
    state,
    windowSeconds: settings.healthErrorBudgetWindowSeconds,
    providerId: providerContract.providerId,
    requestId: request.id,
    boundaryScopeKey: boundary.scopeKey,
    eventCount: scopedEvents.length,
    failureCount: failedEvents.length,
    degradedCount: degradedEvents.length,
    failureLimit: settings.healthErrorBudgetMaxFailures,
    degradedLimit: settings.healthErrorBudgetMaxDegradedEvents,
    failureRatio: Number(failureRatio.toFixed(3)),
    suppressMutation: exhausted,
    retryAllowed: !exhausted,
    fallbackMode: exhausted ? 'status-only-fail-closed' : degradedBudgetExceeded ? 'degraded-observe-before-mutate' : 'normal',
    escalationRoute: exhausted
      ? 'cli-approve.health.escalate-error-budget'
      : degradedBudgetExceeded
        ? 'cli-approve.health.observe-degraded-budget'
        : null,
    recommendedOperatorAction: exhausted
      ? `Pause cli approval mutations for ${boundary.scopeKey}; ${failedEvents.length}/${settings.healthErrorBudgetMaxFailures} hosted-kernel failures occurred in the health window.`
      : degradedBudgetExceeded
        ? `Observe hosted-kernel recovery before submitting more approval decisions; ${degradedEvents.length}/${settings.healthErrorBudgetMaxDegradedEvents} degraded events occurred.`
        : 'Continue normal cli approval handling.',
    latestFailureAt: failedEvents.length > 0 ? failedEvents[failedEvents.length - 1].at : null,
    latestDegradedAt: degradedEvents.length > 0 ? degradedEvents[degradedEvents.length - 1].at : null,
    evidence: scopedEvents.map((event) => ({
      at: event.at,
      healthState: event.healthState,
      failure: event.failure,
      degradedMode: event.degradedMode,
      errorCodes: event.errorCodes
    }))
  };
}

function normalizeRequest(input, settings) {
  const request = input.request && typeof input.request === 'object' ? input.request : {};
  const action = String(request.action || input.action || 'deploy').trim();
  const requestedBy = String(request.requestedBy || input.actor || 'operator').trim();
  const reason = String(request.reason || input.reason || '').trim();

  return {
    id: String(request.id || input.requestId || `${surfaceName}:${action}:${requestedBy}`).trim(),
    action,
    requestedBy,
    reason,
    allowed: settings.allowedActions.includes(action)
  };
}

function normalizeProviderContract(input, request) {
  const providerInput = input.provider && typeof input.provider === 'object' ? input.provider : {};
  const serviceInput = input.service && typeof input.service === 'object' ? input.service : {};
  const advertisedCapabilities = Array.isArray(providerInput.capabilities)
    ? providerInput.capabilities
    : supportedProviderCapabilities;
  const syncCursor = providerInput.syncCursor || input.syncCursor || null;

  return {
    providerId: String(providerInput.providerId || providerInput.id || 'hosted-kernel').trim(),
    serviceId: String(serviceInput.serviceId || serviceInput.id || 'operator-cli-approval').trim(),
    tenantId: String(providerInput.tenantId || input.tenantId || 'local-operator').trim(),
    endpointRef: String(providerInput.endpointRef || providerInput.endpoint || 'kernel://operator-userland/cli-approve').trim(),
    requestTopic: String(providerInput.requestTopic || 'operator-userland.cli-approve.requests').trim(),
    auditTopic: String(providerInput.auditTopic || 'operator-userland.cli-approve.audit').trim(),
    handoffTopic: String(providerInput.handoffTopic || 'operator-userland.cli-approve.handoff').trim(),
    syncCursor: syncCursor ? String(syncCursor).trim() : null,
    capabilities: [...new Set(advertisedCapabilities.map((capability) => String(capability).trim()).filter(Boolean))],
    contractVersion: String(providerInput.contractVersion || '2026-07-hosted-kernel-cli-approve').trim(),
    correlationId: String(providerInput.correlationId || input.correlationId || request.id).trim()
  };
}

function normalizeBoundary(input, request, providerContract, settings) {
  const requestInput = input.request && typeof input.request === 'object' ? input.request : {};
  const actorInput = input.actorContext && typeof input.actorContext === 'object' ? input.actorContext : {};
  const workspaceInput = input.workspace && typeof input.workspace === 'object' ? input.workspace : {};
  const providerWorkspace =
    input.provider && typeof input.provider === 'object' ? input.provider.workspaceId || input.provider.workspace : null;
  const tenantId = String(requestInput.tenantId || input.tenantId || providerContract.tenantId).trim();
  const targetTenantId = String(requestInput.targetTenantId || input.targetTenantId || providerContract.tenantId).trim();
  const workspaceId = String(
    requestInput.workspaceId || workspaceInput.workspaceId || workspaceInput.id || input.workspaceId || providerWorkspace || 'default'
  ).trim();
  const role = String(requestInput.role || actorInput.role || input.role || 'operator').trim().toLowerCase();
  const tenantAligned = !settings.requireTenantMatch || tenantId === providerContract.tenantId;
  const targetTenantAligned = !settings.requireTenantMatch || targetTenantId === providerContract.tenantId;
  const workspaceAllowed = settings.allowedWorkspaces.includes('*') || settings.allowedWorkspaces.includes(workspaceId);
  const roleAllowed = settings.allowedRoles.includes('*') || settings.allowedRoles.includes(role);

  return {
    contractVersion: 'cli-approve.boundary.v1',
    tenantId,
    targetTenantId,
    providerTenantId: providerContract.tenantId,
    workspaceId,
    role,
    tenantAligned,
    targetTenantAligned,
    workspaceAllowed,
    roleAllowed,
    isolated: tenantAligned && targetTenantAligned && workspaceAllowed,
    authorized: roleAllowed,
    policy: {
      requireTenantMatch: settings.requireTenantMatch,
      allowedRoles: settings.allowedRoles,
      allowedWorkspaces: settings.allowedWorkspaces
    },
    scopeKey: `${providerContract.tenantId}:${workspaceId}:${request.action}`
  };
}

function normalizePermissionBoundary(input, request, boundary, providerContract, now) {
  const actorInput = input.actorContext && typeof input.actorContext === 'object' ? input.actorContext : {};
  const workspaceInput = input.workspace && typeof input.workspace === 'object' ? input.workspace : {};
  const permissionInput =
    input.permissions && typeof input.permissions === 'object'
      ? input.permissions
      : actorInput.permissions && typeof actorInput.permissions === 'object'
        ? actorInput.permissions
        : {};
  const workspacePermissionInput =
    workspaceInput.permissions && typeof workspaceInput.permissions === 'object' ? workspaceInput.permissions : {};
  const grantInputs = [
    ...(Array.isArray(permissionInput.grants) ? permissionInput.grants : []),
    ...(Array.isArray(workspacePermissionInput.grants) ? workspacePermissionInput.grants : [])
  ];
  const deniedActions = new Set(
    [
      ...(Array.isArray(permissionInput.deniedActions) ? permissionInput.deniedActions : []),
      ...(Array.isArray(workspacePermissionInput.deniedActions) ? workspacePermissionInput.deniedActions : [])
    ]
      .map((action) => String(action).trim())
      .filter(Boolean)
  );
  const normalizedGrants = grantInputs
    .map((grant, index) => {
      if (!grant || typeof grant !== 'object') {
        return null;
      }
      const actions = Array.isArray(grant.actions)
        ? grant.actions.map((action) => String(action).trim()).filter(Boolean)
        : grant.action
          ? [String(grant.action).trim()]
          : ['*'];
      const roles = Array.isArray(grant.roles)
        ? grant.roles.map((role) => String(role).trim().toLowerCase()).filter(Boolean)
        : grant.role
          ? [String(grant.role).trim().toLowerCase()]
          : ['*'];
      const workspaceIds = Array.isArray(grant.workspaceIds)
        ? grant.workspaceIds.map((workspaceId) => String(workspaceId).trim()).filter(Boolean)
        : grant.workspaceId
          ? [String(grant.workspaceId).trim()]
          : ['*'];
      const tenantIds = Array.isArray(grant.tenantIds)
        ? grant.tenantIds.map((tenantId) => String(tenantId).trim()).filter(Boolean)
        : grant.tenantId
          ? [String(grant.tenantId).trim()]
          : [providerContract.tenantId];
      const expiresAt = grant.expiresAt || grant.until || null;
      const parsedExpiresAt = expiresAt ? Date.parse(expiresAt) : Number.NaN;

      return {
        grantId: String(grant.grantId || grant.id || `grant-${index + 1}`).trim(),
        source: String(grant.source || 'operator-permissions').trim(),
        actions,
        roles,
        workspaceIds,
        tenantIds,
        expiresAt: Number.isFinite(parsedExpiresAt) ? new Date(parsedExpiresAt).toISOString() : null,
        expired: Number.isFinite(parsedExpiresAt) && parsedExpiresAt <= Date.parse(now)
      };
    })
    .filter(Boolean);
  const matchingGrants = normalizedGrants.filter(
    (grant) =>
      !grant.expired &&
      (grant.actions.includes('*') || grant.actions.includes(request.action)) &&
      (grant.roles.includes('*') || grant.roles.includes(boundary.role)) &&
      (grant.workspaceIds.includes('*') || grant.workspaceIds.includes(boundary.workspaceId)) &&
      (grant.tenantIds.includes('*') || grant.tenantIds.includes(boundary.tenantId)) &&
      (grant.tenantIds.includes('*') || grant.tenantIds.includes(boundary.targetTenantId))
  );
  const explicitPermissions = normalizedGrants.length > 0 || deniedActions.size > 0;
  const actionDenied = deniedActions.has(request.action) || deniedActions.has('*');
  const grantRequired = explicitPermissions && !permissionInput.inheritSettingsPolicy && !workspacePermissionInput.inheritSettingsPolicy;
  const grantSatisfied = !grantRequired || matchingGrants.length > 0;
  const canSubmitDecision = !actionDenied && grantSatisfied;
  const deniedReasons = [
    actionDenied ? 'action-explicitly-denied' : null,
    grantRequired && matchingGrants.length === 0 ? 'no-matching-permission-grant' : null,
    ...normalizedGrants.filter((grant) => grant.expired).map((grant) => `expired:${grant.grantId}`)
  ].filter(Boolean);

  return {
    contractVersion: 'cli-approve.permission-boundary.v1',
    providerId: providerContract.providerId,
    tenantId: boundary.tenantId,
    targetTenantId: boundary.targetTenantId,
    workspaceId: boundary.workspaceId,
    role: boundary.role,
    action: request.action,
    explicitPermissions,
    grantRequired,
    grantSatisfied,
    actionDenied,
    canSubmitDecision,
    matchingGrantIds: matchingGrants.map((grant) => grant.grantId),
    deniedReasons,
    policyMode: explicitPermissions ? (grantRequired ? 'explicit-grant-required' : 'settings-inherited') : 'settings-only',
    auditSubject: `${providerContract.providerId}:${boundary.scopeKey}:${request.requestedBy}:${request.action}`,
    grants: normalizedGrants
  };
}

function negotiateCapabilities(providerContract, settings) {
  const providerCapabilities = new Set(providerContract.capabilities);
  const supported = supportedProviderCapabilities.filter((capability) => providerCapabilities.has(capability));
  const missingRequired = settings.requiredProviderCapabilities.filter((capability) => !providerCapabilities.has(capability));
  const unknown = providerContract.capabilities.filter((capability) => !supportedProviderCapabilities.includes(capability));

  return {
    ok: missingRequired.length === 0,
    supported,
    missingRequired,
    unknown,
    required: settings.requiredProviderCapabilities,
    selectedProofCapability: supported.includes('hosted-kernel.lifecycle-proof.v1')
      ? 'hosted-kernel.lifecycle-proof.v1'
      : null,
    selectedHandoffCapability: supported.includes('external-handoff.state.v1') ? 'external-handoff.state.v1' : null,
    selectedCommandCapability: supported.includes('hosted-kernel.idempotent-command.v1')
      ? 'hosted-kernel.idempotent-command.v1'
      : null
  };
}

function normalizeProviderAck(input, providerContract, request, boundary, settings, now) {
  const ackInput =
    input.providerAck && typeof input.providerAck === 'object'
      ? input.providerAck
      : input.ack && typeof input.ack === 'object'
        ? input.ack
        : {};
  const rawState = String(ackInput.state || ackInput.status || 'pending').trim().toLowerCase();
  const acknowledgedAt = ackInput.acknowledgedAt || ackInput.at || null;
  const parsedAckAt = acknowledgedAt ? Date.parse(acknowledgedAt) : Number.NaN;
  const ageSeconds = Number.isFinite(parsedAckAt) ? Math.max(0, Math.round((Date.parse(now) - parsedAckAt) / 1000)) : null;
  const expectedIdempotencyKey = `${providerContract.providerId}:${providerContract.correlationId}:${request.id}:${boundary.scopeKey}`;
  const idempotencyKey = String(ackInput.idempotencyKey || expectedIdempotencyKey).trim();
  const providerId = String(ackInput.providerId || providerContract.providerId).trim();
  const requestId = String(ackInput.requestId || request.id).trim();
  const acceptedStates = new Set(['accepted', 'persisted', 'published', 'applied']);
  const terminalStates = new Set(['rejected', 'failed', 'expired', 'conflict']);
  const stale = ageSeconds !== null && ageSeconds > settings.ackStaleAfterSeconds;
  const mismatches = [];

  if (providerId !== providerContract.providerId) {
    mismatches.push('providerId');
  }
  if (requestId !== request.id) {
    mismatches.push('requestId');
  }
  if (idempotencyKey !== expectedIdempotencyKey) {
    mismatches.push('idempotencyKey');
  }

  return {
    contractVersion: 'cli-approve.provider-ack.v1',
    providerId,
    requestId,
    state: rawState,
    acknowledgedAt: Number.isFinite(parsedAckAt) ? new Date(parsedAckAt).toISOString() : null,
    ageSeconds,
    stale,
    expectedIdempotencyKey,
    idempotencyKey,
    accepted: acceptedStates.has(rawState) && mismatches.length === 0 && !stale,
    terminalFailure: terminalStates.has(rawState),
    mismatches,
    receiptRef: ackInput.receiptRef ? String(ackInput.receiptRef).trim() : null,
    serviceCursor: ackInput.serviceCursor ? String(ackInput.serviceCursor).trim() : null
  };
}

function normalizeExternalHandoffCheckpoint(input, providerContract, request, boundary, now) {
  const handoffInput =
    input.externalHandoffState && typeof input.externalHandoffState === 'object'
      ? input.externalHandoffState
      : input.handoffCheckpoint && typeof input.handoffCheckpoint === 'object'
        ? input.handoffCheckpoint
        : input.externalHandoff && typeof input.externalHandoff === 'object'
          ? input.externalHandoff
          : {};
  const expectedScopeKey = `${providerContract.tenantId}:${boundary.workspaceId}:${request.action}`;
  const state = String(handoffInput.state || handoffInput.status || 'none').trim().toLowerCase();
  const providerId = String(handoffInput.providerId || providerContract.providerId).trim();
  const requestId = String(handoffInput.requestId || request.id).trim();
  const boundaryScopeKey = String(handoffInput.boundaryScopeKey || expectedScopeKey).trim();
  const owner = String(handoffInput.owner || handoffInput.leaseOwner || providerContract.serviceId).trim();
  const leaseUntil = handoffInput.leaseUntil || handoffInput.expiresAt || null;
  const parsedLeaseUntil = leaseUntil ? Date.parse(leaseUntil) : Number.NaN;
  const leased = ['leased', 'publishing', 'in-flight'].includes(state);
  const leaseActive = leased && Number.isFinite(parsedLeaseUntil) && parsedLeaseUntil > Date.parse(now);
  const completed = ['published', 'accepted', 'applied', 'completed'].includes(state);
  const mismatches = [];

  if (providerId !== providerContract.providerId) {
    mismatches.push('providerId');
  }
  if (requestId !== request.id) {
    mismatches.push('requestId');
  }
  if (boundaryScopeKey !== expectedScopeKey) {
    mismatches.push('boundaryScopeKey');
  }

  return {
    contractVersion: 'cli-approve.external-handoff-checkpoint.v1',
    present: Object.keys(handoffInput).length > 0,
    providerId,
    requestId,
    boundaryScopeKey,
    state,
    owner,
    leaseUntil: Number.isFinite(parsedLeaseUntil) ? new Date(parsedLeaseUntil).toISOString() : null,
    leaseActive,
    completed,
    cursor: handoffInput.cursor ? String(handoffInput.cursor).trim() : null,
    receiptRef: handoffInput.receiptRef ? String(handoffInput.receiptRef).trim() : null,
    mismatches,
    publishBlocked: mismatches.length > 0 || leaseActive || completed,
    publishBlockReason:
      mismatches.length > 0
        ? 'checkpoint-scope-mismatch'
        : leaseActive
          ? 'handoff-lease-active'
          : completed
            ? 'handoff-already-completed'
            : null
  };
}

function normalizeApprovalQuorum(input, request, boundary, settings, command, now) {
  const approvalInput = Array.isArray(input.approvals)
    ? input.approvals
    : Array.isArray(input.approverEvidence)
      ? input.approverEvidence
      : [];
  const currentDecisionCounts =
    command === 'approve' && boundary.authorized && boundary.isolated
      ? [
          {
            actor: request.requestedBy,
            role: boundary.role,
            tenantId: boundary.tenantId,
            workspaceId: boundary.workspaceId,
            decision: 'approved',
            at: now,
            source: 'current-command'
          }
        ]
      : [];
  const normalizedApprovals = [...approvalInput, ...currentDecisionCounts]
    .map((approval, index) => {
      if (!approval || typeof approval !== 'object') {
        return null;
      }
      const actor = String(approval.actor || approval.approvedBy || approval.requestedBy || '').trim();
      const role = String(approval.role || 'operator').trim().toLowerCase();
      const tenantId = String(approval.tenantId || boundary.tenantId).trim();
      const workspaceId = String(approval.workspaceId || boundary.workspaceId).trim();
      const decision = String(approval.decision || approval.status || 'approved').trim().toLowerCase();
      const parsedAt = Date.parse(approval.at || approval.approvedAt || approval.timestamp || now);

      return {
        actor,
        role,
        tenantId,
        workspaceId,
        decision,
        at: Number.isFinite(parsedAt) ? new Date(parsedAt).toISOString() : now,
        source: String(approval.source || `approval-${index + 1}`).trim(),
        accepted:
          Boolean(actor) &&
          decision === 'approved' &&
          tenantId === boundary.tenantId &&
          workspaceId === boundary.workspaceId &&
          (settings.allowedRoles.includes('*') || settings.allowedRoles.includes(role))
      };
    })
    .filter(Boolean);
  const approverIds = [...new Set(normalizedApprovals.filter((approval) => approval.accepted).map((approval) => approval.actor))];
  const rejectedEvidence = normalizedApprovals
    .filter((approval) => !approval.accepted)
    .map((approval) => ({
      actor: approval.actor || null,
      reason:
        !approval.actor
          ? 'missing-actor'
          : approval.decision !== 'approved'
            ? 'not-approved'
            : approval.tenantId !== boundary.tenantId || approval.workspaceId !== boundary.workspaceId
              ? 'scope-mismatch'
              : 'role-denied'
    }));

  return {
    contractVersion: 'cli-approve.approval-quorum.v1',
    required: settings.minApprovers,
    count: approverIds.length,
    satisfied: approverIds.length >= settings.minApprovers,
    approverIds,
    rejectedEvidence,
    evidence: normalizedApprovals,
    evaluatedAt: now
  };
}

function validateLifecycle({
  command,
  request,
  settings,
  scheduleAt,
  now,
  capabilityNegotiation,
  boundary,
  operationalHealth,
  healthErrorBudget,
  approvalQuorum,
  permissionBoundary,
  lifecycleControls
}) {
  const errors = [];
  const warnings = [];

  if (!boundary.tenantAligned || !boundary.targetTenantAligned) {
    errors.push({
      code: 'tenant_boundary_violation',
      message: `Request tenant "${boundary.tenantId}" must match provider tenant "${boundary.providerTenantId}".`
    });
  }

  if (!boundary.workspaceAllowed) {
    errors.push({
      code: 'workspace_scope_denied',
      message: `Workspace "${boundary.workspaceId}" is outside the cli approval boundary.`
    });
  }

  if (!boundary.roleAllowed && ['approve', 'reject', 'hold', 'schedule', 'enable', 'disable'].includes(command)) {
    errors.push({
      code: 'operator_role_denied',
      message: `Role "${boundary.role}" cannot submit cli approval lifecycle decisions.`
    });
  }

  if (
    ['approve', 'reject', 'hold', 'schedule', 'enable', 'disable'].includes(command) &&
    permissionBoundary &&
    !permissionBoundary.canSubmitDecision
  ) {
    errors.push({
      code: 'permission_scope_denied',
      message: `No active permission grant allows ${boundary.role} to ${command} ${request.action} in workspace "${boundary.workspaceId}".`
    });
  }

  if (!request.allowed) {
    errors.push({
      code: 'unsupported_action',
      message: `Action "${request.action}" is not enabled for cli approval.`
    });
  }

  if (settings.requireReason && ['approve', 'reject', 'hold', 'schedule'].includes(command) && !request.reason) {
    errors.push({
      code: 'reason_required',
      message: 'A reason is required for lifecycle decisions.'
    });
  }

  if (!settings.enabled && ['approve', 'reject', 'hold', 'schedule'].includes(command)) {
    errors.push({
      code: 'approvals_disabled',
      message: 'Approval decisions are disabled until an operator enables this surface.'
    });
  }

  if (lifecycleControls && lifecycleControls.blocked) {
    for (const reason of lifecycleControls.blockedReasons) {
      if (reason === 'enable-command-disabled-by-settings') {
        errors.push({
          code: 'enable_command_disabled',
          message: 'The enable command is disabled by lifecycle settings for this cli approval surface.'
        });
      } else if (reason === 'disable-command-disabled-by-settings') {
        errors.push({
          code: 'disable_command_disabled',
          message: 'The disable command is disabled by lifecycle settings for this cli approval surface.'
        });
      } else if (reason === 'schedule-command-disabled-by-settings') {
        errors.push({
          code: 'schedule_command_disabled',
          message: 'The schedule command is disabled by lifecycle settings for this cli approval surface.'
        });
      } else if (reason === 'settings-revision-mismatch') {
        errors.push({
          code: 'settings_revision_mismatch',
          message: `Expected settings revision "${lifecycleControls.expectedSettingsRevision}" does not match current revision "${lifecycleControls.currentSettingsRevision}".`
        });
      } else if (reason === 'schedule-lead-time-too-short') {
        errors.push({
          code: 'schedule_lead_time_too_short',
          message: `Scheduled approvals require at least ${lifecycleControls.schedule.minLeadMinutes} minute(s) of lead time.`
        });
      } else if (reason.startsWith('schedule-blackout:')) {
        errors.push({
          code: 'schedule_blackout_window',
          message: `Scheduled approval falls inside blackout window "${lifecycleControls.schedule.blackoutWindow.label}".`
        });
      }
    }
  }

  if (!capabilityNegotiation.ok) {
    errors.push({
      code: 'provider_capability_missing',
      message: `Provider is missing required capabilities: ${capabilityNegotiation.missingRequired.join(', ')}.`
    });
  }

  if (operationalHealth.state === 'failed' && ['approve', 'reject', 'hold', 'schedule', 'enable', 'disable'].includes(command)) {
    errors.push({
      code: 'hosted_kernel_unavailable',
      message: `Hosted kernel endpoint "${operationalHealth.endpointRef}" is ${operationalHealth.failureMode}.`
    });
  }

  if (healthErrorBudget && healthErrorBudget.suppressMutation && ['approve', 'reject', 'hold', 'schedule', 'enable', 'disable'].includes(command)) {
    errors.push({
      code: 'hosted_kernel_error_budget_exhausted',
      message: `Hosted kernel failure budget is exhausted for ${healthErrorBudget.boundaryScopeKey}; mutation commands are paused.`
    });
  }

  if (operationalHealth.state === 'degraded') {
    warnings.push({
      code: 'hosted_kernel_degraded',
      message: `Hosted kernel is degraded; heartbeat stale=${operationalHealth.heartbeatStale}, queueDepth=${operationalHealth.queueDepth}.`
    });
  }

  if (healthErrorBudget && healthErrorBudget.state === 'degraded') {
    warnings.push({
      code: 'hosted_kernel_error_budget_degraded',
      message: `Hosted kernel degraded budget is elevated (${healthErrorBudget.degradedCount}/${healthErrorBudget.degradedLimit}).`
    });
  }

  if (capabilityNegotiation.unknown.length > 0) {
    warnings.push({
      code: 'provider_capability_unknown',
      message: `Provider advertised unsupported capabilities: ${capabilityNegotiation.unknown.join(', ')}.`
    });
  }

  if (command === 'schedule' && scheduleAt) {
    const delayMinutes = Math.round((Date.parse(scheduleAt) - Date.parse(now)) / 60000);
    if (!Number.isFinite(delayMinutes) || delayMinutes < 0) {
      errors.push({ code: 'schedule_in_past', message: 'Scheduled approvals must be in the future.' });
    } else if (delayMinutes > settings.maxScheduleDelayMinutes) {
      errors.push({
        code: 'schedule_delay_exceeded',
        message: `Scheduled approvals cannot exceed ${settings.maxScheduleDelayMinutes} minutes.`
      });
    }
  } else if (command === 'schedule') {
    errors.push({ code: 'schedule_time_required', message: 'A scheduleAt ISO timestamp is required.' });
  }

  if (settings.minApprovers > 1) {
    if (command === 'approve' && !approvalQuorum.satisfied) {
      errors.push({
        code: 'approval_quorum_not_met',
        message: `${approvalQuorum.count}/${settings.minApprovers} required approvals are present for hosted-kernel execution.`
      });
    } else {
      warnings.push({
        code: 'multi_approver_gate',
        message: `${settings.minApprovers} approvals are required before hosted-kernel execution.`
      });
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function validateProviderDelivery({ command, lifecycle, providerAck, capabilityNegotiation, handoffCheckpoint }) {
  const errors = [];
  const warnings = [];
  const requiresDelivery = ['approve', 'schedule'].includes(command);

  if (lifecycle.runnable && !capabilityNegotiation.selectedCommandCapability) {
    warnings.push({
      code: 'idempotent_command_not_negotiated',
      message: 'Provider did not negotiate idempotent command delivery; duplicate approval protection is local only.'
    });
  }

  if (requiresDelivery && providerAck.terminalFailure) {
    errors.push({
      code: 'provider_ack_terminal_failure',
      message: `Provider acknowledgment is terminal: ${providerAck.state}.`
    });
  }

  if (requiresDelivery && providerAck.mismatches.length > 0) {
    errors.push({
      code: 'provider_ack_mismatch',
      message: `Provider acknowledgment mismatched fields: ${providerAck.mismatches.join(', ')}.`
    });
  }

  if (requiresDelivery && providerAck.stale) {
    warnings.push({
      code: 'provider_ack_stale',
      message: `Provider acknowledgment is older than the configured stale window (${providerAck.ageSeconds}s).`
    });
  }

  if (requiresDelivery && handoffCheckpoint.mismatches.length > 0) {
    errors.push({
      code: 'external_handoff_checkpoint_mismatch',
      message: `External handoff checkpoint mismatched fields: ${handoffCheckpoint.mismatches.join(', ')}.`
    });
  }

  if (requiresDelivery && handoffCheckpoint.leaseActive) {
    errors.push({
      code: 'external_handoff_lease_active',
      message: `External handoff is leased by ${handoffCheckpoint.owner} until ${handoffCheckpoint.leaseUntil}.`
    });
  }

  if (requiresDelivery && handoffCheckpoint.completed) {
    warnings.push({
      code: 'external_handoff_already_completed',
      message: `External handoff checkpoint is already ${handoffCheckpoint.state}; publish should remain idempotent.`
    });
  }

  return { ok: errors.length === 0, errors, warnings };
}

function buildSyncMetadata({ providerContract, request, lifecycle, validation, capabilityNegotiation, boundary, now }) {
  const sequenceSubject = `${providerContract.providerId}:${request.id}`;
  const syncStatus = validation.ok
    ? lifecycle.runnable
      ? 'ready-to-publish'
      : lifecycle.status === 'scheduled'
        ? 'deferred'
        : 'observed'
    : 'rejected';

  return {
    providerId: providerContract.providerId,
    serviceId: providerContract.serviceId,
    tenantId: providerContract.tenantId,
    workspaceId: boundary.workspaceId,
    boundaryScopeKey: boundary.scopeKey,
    correlationId: providerContract.correlationId,
    cursor: providerContract.syncCursor,
    sequenceSubject,
    syncStatus,
    lastSyncedAt: now,
    topics: {
      requests: providerContract.requestTopic,
      audit: providerContract.auditTopic,
      handoff: providerContract.handoffTopic
    },
    acceptedCapabilities: capabilityNegotiation.supported,
    missingCapabilities: capabilityNegotiation.missingRequired,
    idempotencyKey: `${providerContract.providerId}:${providerContract.correlationId}:${request.id}:${boundary.scopeKey}`,
    providerAckRequired: lifecycle.runnable || lifecycle.status === 'scheduled'
  };
}

function buildExternalHandoff({
  providerContract,
  request,
  lifecycle,
  validation,
  capabilityNegotiation,
  boundary,
  providerAck,
  handoffCheckpoint,
  operationalIncident,
  now
}) {
  const canPublish =
    validation.ok && Boolean(capabilityNegotiation.selectedHandoffCapability) && !operationalIncident.suppressProviderPublish;
  const handoffState = lifecycle.runnable
    ? 'ready'
    : lifecycle.status === 'scheduled'
      ? 'scheduled'
      : lifecycle.status === 'held'
        ? 'waiting-for-review'
        : validation.ok
          ? 'not-required'
          : 'blocked';

  return {
    contractVersion: 'cli-approve.external-handoff.v1',
    state: handoffState,
    publishable:
      canPublish && ['ready', 'scheduled', 'waiting-for-review'].includes(handoffState) && !handoffCheckpoint.publishBlocked,
    capability: capabilityNegotiation.selectedHandoffCapability,
    target: providerContract.endpointRef,
    topic: providerContract.handoffTopic,
    checkpoint: handoffCheckpoint,
    leaseRequest:
      canPublish && !handoffCheckpoint.publishBlocked
        ? {
            owner: providerContract.serviceId,
            scope: boundary.scopeKey,
            ttlSeconds: 60,
            renewRoute: 'cli-approve.external-handoff.lease-renew',
            releaseRoute: 'cli-approve.external-handoff.lease-release'
          }
        : null,
    blockedReason: handoffCheckpoint.publishBlockReason,
    operationalMode: operationalIncident.recommendedMode,
    publishSuppressedByIncident: operationalIncident.suppressProviderPublish,
    incidentCodes: operationalIncident.incidents.map((incident) => incident.code),
    payload: {
      requestId: request.id,
      action: request.action,
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
      boundaryScopeKey: boundary.scopeKey,
      decision: lifecycle.status,
      runnable: lifecycle.runnable,
      scheduleAt: lifecycle.scheduleAt,
      nextAction: lifecycle.nextAction,
      idempotencyKey: providerAck.expectedIdempotencyKey,
      providerAckState: providerAck.state,
      providerReceiptRef: providerAck.receiptRef,
      emittedAt: now
    }
  };
}

function buildProviderCommandEnvelope({
  providerContract,
  request,
  lifecycle,
  validation,
  capabilityNegotiation,
  boundary,
  permissionBoundary,
  sync,
  providerAck,
  handoffCheckpoint,
  operationalIncident,
  now
}) {
  const publishable =
    validation.ok &&
    (lifecycle.runnable || lifecycle.status === 'scheduled') &&
    !handoffCheckpoint.publishBlocked &&
    !operationalIncident.suppressProviderPublish;
  const commandName = lifecycle.runnable
    ? 'hosted-kernel.approval.execute'
    : lifecycle.status === 'scheduled'
      ? 'hosted-kernel.approval.schedule'
      : 'hosted-kernel.approval.observe';

  return {
    contractVersion: 'cli-approve.provider-command-envelope.v1',
    publishable,
    commandName,
    capability: capabilityNegotiation.selectedCommandCapability,
    idempotencyKey: providerAck.expectedIdempotencyKey,
    correlationId: providerContract.correlationId,
    providerId: providerContract.providerId,
    serviceId: providerContract.serviceId,
    requestTopic: providerContract.requestTopic,
    auditTopic: providerContract.auditTopic,
    blockedReason: operationalIncident.suppressProviderPublish
      ? operationalIncident.incidents[0]?.code || operationalIncident.state
      : handoffCheckpoint.publishBlockReason,
    operationalMode: operationalIncident.recommendedMode,
    incidentCodes: operationalIncident.incidents.map((incident) => incident.code),
    expectedAck: {
      requestId: request.id,
      providerId: providerContract.providerId,
      idempotencyKey: providerAck.expectedIdempotencyKey,
      acceptedStates: ['accepted', 'persisted', 'published', 'applied']
    },
    body: {
      requestId: request.id,
      action: request.action,
      decision: lifecycle.status,
      tenantId: boundary.tenantId,
      targetTenantId: boundary.targetTenantId,
      workspaceId: boundary.workspaceId,
      boundaryScopeKey: boundary.scopeKey,
      permissionPolicyMode: permissionBoundary ? permissionBoundary.policyMode : 'settings-only',
      permissionGrantIds: permissionBoundary ? permissionBoundary.matchingGrantIds : [],
      permissionAuditSubject: permissionBoundary ? permissionBoundary.auditSubject : null,
      requestedBy: request.requestedBy,
      reason: request.reason || null,
      scheduleAt: lifecycle.scheduleAt,
      emittedAt: now,
      syncCursor: sync.cursor
    }
  };
}

function normalizePersistedState(input, providerContract, request, boundary, providerAck, now) {
  const stateInput =
    input.persistedState && typeof input.persistedState === 'object'
      ? input.persistedState
      : input.stateSnapshot && typeof input.stateSnapshot === 'object'
        ? input.stateSnapshot
        : input.checkpoint && typeof input.checkpoint === 'object'
          ? input.checkpoint
          : {};
  const ledgerInput = Array.isArray(stateInput.commandLedger)
    ? stateInput.commandLedger
    : Array.isArray(stateInput.commands)
      ? stateInput.commands
      : [];
  const expectedScopeKey = `${providerContract.tenantId}:${boundary.workspaceId}:${request.action}`;
  const normalizedLedger = ledgerInput
    .map((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const at = entry.at || entry.persistedAt || entry.updatedAt || now;
      const parsedAt = Date.parse(at);
      const status = String(entry.status || entry.state || entry.decision || 'observed').trim().toLowerCase();
      const idempotencyKey = String(entry.idempotencyKey || '').trim();
      return {
        sequence: Number.parseInt(entry.sequence, 10) || index + 1,
        at: Number.isFinite(parsedAt) ? new Date(parsedAt).toISOString() : now,
        requestId: String(entry.requestId || request.id).trim(),
        command: normalizeCommand(entry.command),
        status,
        providerId: String(entry.providerId || providerContract.providerId).trim(),
        tenantId: String(entry.tenantId || providerContract.tenantId).trim(),
        workspaceId: String(entry.workspaceId || boundary.workspaceId).trim(),
        boundaryScopeKey: String(entry.boundaryScopeKey || expectedScopeKey).trim(),
        idempotencyKey,
        receiptRef: entry.receiptRef ? String(entry.receiptRef).trim() : null,
        serviceCursor: entry.serviceCursor ? String(entry.serviceCursor).trim() : null
      };
    })
    .filter(Boolean)
    .sort((left, right) => Date.parse(left.at) - Date.parse(right.at) || left.sequence - right.sequence);
  const matchingLedger = normalizedLedger.filter(
    (entry) =>
      entry.requestId === request.id &&
      entry.providerId === providerContract.providerId &&
      entry.boundaryScopeKey === expectedScopeKey
  );
  const lastMatch = matchingLedger.length > 0 ? matchingLedger[matchingLedger.length - 1] : null;
  const persistedAt = stateInput.persistedAt || stateInput.updatedAt || (lastMatch && lastMatch.at) || null;
  const parsedPersistedAt = persistedAt ? Date.parse(persistedAt) : Number.NaN;
  const checkpointRequestId = String(stateInput.requestId || (lastMatch && lastMatch.requestId) || request.id).trim();
  const checkpointScopeKey = String(stateInput.boundaryScopeKey || (lastMatch && lastMatch.boundaryScopeKey) || expectedScopeKey).trim();
  const checkpointProviderId = String(stateInput.providerId || (lastMatch && lastMatch.providerId) || providerContract.providerId).trim();
  const checkpointStatus = String(stateInput.status || stateInput.decision || (lastMatch && lastMatch.status) || 'unknown')
    .trim()
    .toLowerCase();
  const duplicateCommand =
    matchingLedger.some((entry) => entry.idempotencyKey === providerAck.expectedIdempotencyKey) ||
    String(stateInput.lastIdempotencyKey || '').trim() === providerAck.expectedIdempotencyKey;
  const mismatches = [];

  if (checkpointRequestId !== request.id) {
    mismatches.push('requestId');
  }
  if (checkpointScopeKey !== expectedScopeKey) {
    mismatches.push('boundaryScopeKey');
  }
  if (checkpointProviderId !== providerContract.providerId) {
    mismatches.push('providerId');
  }

  return {
    contractVersion: 'cli-approve.persisted-state.v1',
    present: Object.keys(stateInput).length > 0 || normalizedLedger.length > 0,
    providerId: checkpointProviderId,
    requestId: checkpointRequestId,
    tenantId: String(stateInput.tenantId || providerContract.tenantId).trim(),
    workspaceId: String(stateInput.workspaceId || boundary.workspaceId).trim(),
    boundaryScopeKey: checkpointScopeKey,
    status: checkpointStatus,
    persistedAt: Number.isFinite(parsedPersistedAt) ? new Date(parsedPersistedAt).toISOString() : null,
    serviceCursor: stateInput.serviceCursor || (lastMatch && lastMatch.serviceCursor) || providerAck.serviceCursor || null,
    receiptRef: stateInput.receiptRef || (lastMatch && lastMatch.receiptRef) || providerAck.receiptRef || null,
    lastIdempotencyKey: stateInput.lastIdempotencyKey || (lastMatch && lastMatch.idempotencyKey) || null,
    duplicateCommand,
    mismatches,
    ledgerSize: normalizedLedger.length,
    matchingLedgerSize: matchingLedger.length,
    latestLedgerEntry: lastMatch,
    commandLedger: normalizedLedger
  };
}

function buildRecoveryContract({ command, lifecycle, persistedState, providerAck, operationalHealth, now }) {
  const terminalStatuses = new Set(['approved', 'rejected', 'failed', 'expired', 'disabled']);
  const hasCheckpoint = persistedState.present && persistedState.mismatches.length === 0;
  const checkpointAgeSeconds = persistedState.persistedAt
    ? Math.max(0, Math.round((Date.parse(now) - Date.parse(persistedState.persistedAt)) / 1000))
    : null;
  const ackWithoutCheckpoint = providerAck.accepted && !hasCheckpoint;
  const replayRequired =
    ackWithoutCheckpoint ||
    (hasCheckpoint && lifecycle.runnable && !persistedState.duplicateCommand && operationalHealth.state !== 'failed');
  const recoveredTerminal = hasCheckpoint && terminalStatuses.has(persistedState.status);
  const restartSafeStatus =
    command === 'status' && hasCheckpoint
      ? persistedState.status
      : persistedState.duplicateCommand && persistedState.status !== 'unknown'
        ? persistedState.status
        : lifecycle.status;

  return {
    contractVersion: 'cli-approve.recovery.v1',
    state: persistedState.mismatches.length > 0 ? 'checkpoint-conflict' : replayRequired ? 'replay-required' : 'restart-safe',
    checkpointPresent: persistedState.present,
    checkpointAgeSeconds,
    duplicateCommand: persistedState.duplicateCommand,
    recoveredTerminal,
    restartSafeStatus,
    replayRequired,
    replayRoute: replayRequired ? 'cli-approve.recovery.replay-command' : null,
    conflictFields: persistedState.mismatches,
    recoveryCursor: persistedState.serviceCursor || providerAck.serviceCursor,
    recoveryReceiptRef: persistedState.receiptRef || providerAck.receiptRef,
    operatorMessage: persistedState.mismatches.length
      ? `Persisted checkpoint does not match request ${providerAck.requestId}.`
      : replayRequired
        ? `Replay idempotent command ${providerAck.expectedIdempotencyKey} from persisted recovery state.`
        : `Status is restart-safe for request ${providerAck.requestId}.`
  };
}

function reconcileLifecycleWithRecovery(lifecycle, command, recovery) {
  if (command !== 'status' && !recovery.duplicateCommand) {
    return lifecycle;
  }

  return {
    ...lifecycle,
    status: recovery.restartSafeStatus,
    runnable: lifecycle.runnable && !recovery.duplicateCommand,
    recoveredFromPersistedState: recovery.checkpointPresent,
    duplicateCommand: recovery.duplicateCommand,
    nextAction: recovery.replayRequired ? 'replay-persisted-hosted-kernel-command' : lifecycle.nextAction
  };
}

function buildPersistedCommandPlan({
  command,
  request,
  lifecycle,
  validation,
  providerContract,
  boundary,
  providerAck,
  persistedState,
  recovery,
  sync,
  externalHandoff,
  operationalIncident,
  now
}) {
  const decisionCommand = ['approve', 'reject', 'hold', 'schedule', 'enable', 'disable'].includes(command);
  const terminalStatuses = new Set(['approved', 'rejected', 'failed', 'expired', 'disabled']);
  const existingSequence = Math.max(
    0,
    ...persistedState.commandLedger.map((entry) => Number.parseInt(entry.sequence, 10) || 0)
  );
  const scopeMatches = persistedState.mismatches.length === 0;
  const canWriteDecision =
    decisionCommand &&
    validation.ok &&
    scopeMatches &&
    !operationalIncident.suppressProviderPublish &&
    externalHandoff.state !== 'blocked';
  const operation = persistedState.mismatches.length > 0
    ? 'quarantine-conflict'
    : persistedState.duplicateCommand
      ? 'no-op-duplicate'
      : recovery.replayRequired
        ? 'replay-from-checkpoint'
        : canWriteDecision
          ? 'append-checkpoint'
          : command === 'status'
            ? 'read-only-status'
            : 'blocked-no-write';
  const durableStatus = recovery.restartSafeStatus || lifecycle.status;
  const restartSemantics = recovery.replayRequired
    ? 'restart-replay-required'
    : persistedState.duplicateCommand
      ? 'restart-no-op'
      : terminalStatuses.has(durableStatus)
        ? 'restart-terminal'
        : lifecycle.status === 'scheduled'
          ? 'restart-deferred'
          : lifecycle.runnable
            ? 'restart-publish-pending'
            : 'restart-observable';
  const writeRequired = ['append-checkpoint', 'replay-from-checkpoint'].includes(operation);
  const auditOnly = ['quarantine-conflict', 'blocked-no-write'].includes(operation);
  const nextSequence = existingSequence + (writeRequired ? 1 : 0);
  const statePatch = writeRequired
    ? {
        providerId: providerContract.providerId,
        serviceId: providerContract.serviceId,
        requestId: request.id,
        tenantId: boundary.tenantId,
        workspaceId: boundary.workspaceId,
        boundaryScopeKey: boundary.scopeKey,
        status: durableStatus,
        command,
        persistedAt: now,
        lastIdempotencyKey: providerAck.expectedIdempotencyKey,
        receiptRef: providerAck.receiptRef || persistedState.receiptRef,
        serviceCursor: providerAck.serviceCursor || persistedState.serviceCursor || sync.cursor,
        commandLedgerAppend: {
          sequence: nextSequence,
          at: now,
          requestId: request.id,
          command,
          status: durableStatus,
          providerId: providerContract.providerId,
          tenantId: boundary.tenantId,
          workspaceId: boundary.workspaceId,
          boundaryScopeKey: boundary.scopeKey,
          idempotencyKey: providerAck.expectedIdempotencyKey,
          receiptRef: providerAck.receiptRef || persistedState.receiptRef,
          serviceCursor: providerAck.serviceCursor || persistedState.serviceCursor || sync.cursor
        }
      }
    : null;

  return {
    contractVersion: 'cli-approve.persisted-command-plan.v1',
    operation,
    writeRequired,
    auditOnly,
    idempotent: providerAck.idempotencyKey === providerAck.expectedIdempotencyKey && providerAck.mismatches.length === 0,
    duplicateCommand: persistedState.duplicateCommand,
    restartSemantics,
    expectedStatusAfterRestart: durableStatus,
    statusSource: persistedState.duplicateCommand || command === 'status' ? 'persisted-state' : 'current-command',
    persistenceKey: `${providerContract.providerId}:${boundary.scopeKey}:${request.id}`,
    idempotencyKey: providerAck.expectedIdempotencyKey,
    sequenceBefore: existingSequence,
    sequenceAfter: nextSequence,
    statePatch,
    recoveryPaths: [
      recovery.replayRequired
        ? {
            route: recovery.replayRoute,
            reason: 'accepted-provider-ack-without-compatible-checkpoint',
            cursor: recovery.recoveryCursor,
            receiptRef: recovery.recoveryReceiptRef
          }
        : null,
      persistedState.mismatches.length > 0
        ? {
            route: 'cli-approve.persistence.quarantine',
            reason: 'checkpoint-conflict',
            conflictFields: persistedState.mismatches,
            cursor: persistedState.serviceCursor
          }
        : null
    ].filter(Boolean),
    consistencyChecks: {
      checkpointScopeCompatible: scopeMatches,
      providerAckCompatible: providerAck.mismatches.length === 0,
      restartStatusStable: recovery.state !== 'checkpoint-conflict',
      writeAllowed: canWriteDecision || recovery.replayRequired,
      publishSuppressed: operationalIncident.suppressProviderPublish
    },
    auditEvent: {
      at: now,
      type: 'cli-approve.persisted-command-plan',
      requestId: request.id,
      command,
      operation,
      restartSemantics,
      persistenceKey: `${providerContract.providerId}:${boundary.scopeKey}:${request.id}`,
      idempotencyKey: providerAck.expectedIdempotencyKey,
      expectedStatusAfterRestart: durableStatus
    }
  };
}

function buildLifecycleState({ command, request, settings, validation, scheduleAt, now, approvalQuorum, lifecycleControls }) {
  const statusByCommand = {
    approve: 'approved',
    reject: 'rejected',
    hold: 'held',
    enable: 'enabled',
    disable: 'disabled',
    schedule: 'scheduled',
    status: settings.enabled ? 'waiting' : 'disabled'
  };
  const status = validation.ok ? statusByCommand[command] : 'blocked';
  const enabled = command === 'enable' ? true : command === 'disable' ? false : settings.enabled;
  const runnable = status === 'approved' && enabled && request.allowed && approvalQuorum.satisfied;
  const nextControlAction = lifecycleControls ? lifecycleControls.nextControlAction : 'observe-current-settings-state';

  return {
    status,
    enabled,
    runnable,
    requestId: request.id,
    action: request.action,
    approvalQuorumRequired: command === 'approve',
    approvalQuorumSatisfied: approvalQuorum.satisfied,
    approvalCount: approvalQuorum.count,
    approvalsRequired: approvalQuorum.required,
    scheduleAt: status === 'scheduled' ? scheduleAt : null,
    settingsRevision: lifecycleControls ? lifecycleControls.currentSettingsRevision : settings.settingsRevision,
    requestedSettingsRevision: lifecycleControls ? lifecycleControls.expectedSettingsRevision : settings.settingsRevision,
    lifecycleControlAction: nextControlAction,
    controlBlockedReasons: lifecycleControls ? lifecycleControls.blockedReasons : [],
    nextAction: runnable
      ? 'emit-hosted-kernel-proof'
      : status === 'scheduled'
        ? 'wait-for-schedule-window'
        : command === 'enable' || command === 'disable'
          ? nextControlAction
        : status === 'held'
          ? 'collect-operator-review'
          : validation.ok
            ? 'await-cli-decision'
            : 'repair-cli-approval-input'
  };
}

function buildRetryContract({ command, validation, lifecycle, operationalHealth, healthErrorBudget, settings, now }) {
  const retryableCodes = new Set([
    'hosted_kernel_unavailable',
    'provider_capability_missing',
    'schedule_in_past',
    'schedule_time_required'
  ]);
  const retryableErrors = validation.errors.filter((error) => retryableCodes.has(error.code));
  const attempted = Math.max(0, Number.parseInt(operationalHealth.consecutiveFailures, 10) || 0);
  const exhausted = attempted >= settings.retryMaxAttempts;
  const shouldRetry =
    retryableErrors.length > 0 &&
    !exhausted &&
    (!healthErrorBudget || healthErrorBudget.retryAllowed) &&
    !['reject', 'disable'].includes(command) &&
    lifecycle.status === 'blocked';
  const delayMs = shouldRetry
    ? Math.min(settings.retryMaxDelayMs, settings.retryBaseDelayMs * 2 ** Math.min(attempted, settings.retryMaxAttempts))
    : 0;
  const retryAt = shouldRetry ? new Date(Date.parse(now) + delayMs).toISOString() : null;

  return {
    contractVersion: 'cli-approve.retry-backoff.v1',
    retryable: shouldRetry,
    attempt: attempted,
    maxAttempts: settings.retryMaxAttempts,
    exhausted,
    delayMs,
    retryAt,
    retryRoute: shouldRetry ? 'cli-approve.health.retry' : null,
    retryableCodes: retryableErrors.map((error) => error.code),
    suppressedByErrorBudget: Boolean(healthErrorBudget && !healthErrorBudget.retryAllowed && retryableErrors.length > 0),
    errorBudgetState: healthErrorBudget ? healthErrorBudget.state : 'within-budget'
  };
}

function buildActionableErrors({ validation, retry, operationalHealth, healthErrorBudget, settings }) {
  return validation.errors.map((error) => {
    const common = {
      code: error.code,
      message: error.message,
      severity: error.code === 'hosted_kernel_unavailable' ? 'transient-blocker' : 'blocker',
      retryable: retry.retryableCodes.includes(error.code),
      retryAt: retry.retryableCodes.includes(error.code) ? retry.retryAt : null
    };

    if (error.code === 'hosted_kernel_unavailable') {
      return {
        ...common,
        operatorAction: operationalHealth.circuitOpen
          ? 'Close or reset the hosted-kernel circuit before submitting approval decisions.'
          : 'Restore hosted-kernel reachability before submitting approval decisions.',
        nextCommand: 'status',
        evidenceKey: 'operationalHealth'
      };
    }
    if (error.code === 'hosted_kernel_error_budget_exhausted') {
      return {
        ...common,
        severity: 'critical-blocker',
        operatorAction: healthErrorBudget
          ? healthErrorBudget.recommendedOperatorAction
          : 'Pause hosted-kernel mutations and inspect health history.',
        nextCommand: 'status',
        evidenceKey: 'healthErrorBudget',
        escalationRoute: healthErrorBudget ? healthErrorBudget.escalationRoute : 'cli-approve.health.escalate-error-budget'
      };
    }
    if (error.code === 'provider_capability_missing') {
      return {
        ...common,
        operatorAction: `Configure provider capabilities: ${settings.requiredProviderCapabilities.join(', ')}.`,
        nextCommand: 'status',
        evidenceKey: 'capabilityNegotiation'
      };
    }

    return {
      ...common,
      operatorAction: error.message,
      nextCommand: 'status',
      evidenceKey: 'validation'
    };
  });
}

function buildOperationalIncidentContract({
  command,
  request,
  lifecycle,
  validation,
  deliveryValidation,
  operationalHealth,
  healthErrorBudget,
  providerAck,
  handoffCheckpoint,
  retry,
  now
}) {
  const decisionCommand = ['approve', 'reject', 'hold', 'schedule', 'enable', 'disable'].includes(command);
  const publishCandidate = lifecycle.runnable || lifecycle.status === 'scheduled';
  const incidents = [];

  if (operationalHealth.state === 'failed') {
    incidents.push({
      code: 'hosted-kernel-down',
      severity: 'critical',
      source: 'operationalHealth',
      message: `Hosted kernel is ${operationalHealth.failureMode || 'failed'} for ${request.id}.`,
      operatorAction: operationalHealth.circuitOpen
        ? 'Reset the hosted-kernel circuit and run status before retrying the lifecycle command.'
        : 'Restore provider reachability and run status before retrying the lifecycle command.',
      blocksPublish: true,
      retryable: retry.retryable,
      evidence: {
        endpointRef: operationalHealth.endpointRef,
        heartbeatAgeSeconds: operationalHealth.heartbeatAgeSeconds,
        consecutiveFailures: operationalHealth.consecutiveFailures
      }
    });
  } else if (operationalHealth.state === 'degraded') {
    incidents.push({
      code: operationalHealth.backlogDegraded ? 'hosted-kernel-backlog' : 'hosted-kernel-degraded',
      severity: publishCandidate ? 'warning' : 'info',
      source: 'operationalHealth',
      message: `Hosted kernel is degraded while handling ${request.id}.`,
      operatorAction: publishCandidate
        ? 'Keep the command idempotent and monitor provider acknowledgment after publish.'
        : 'Continue in read-only/degraded observation mode until the provider recovers.',
      blocksPublish: false,
      retryable: false,
      evidence: {
        queueDepth: operationalHealth.queueDepth,
        heartbeatStale: operationalHealth.heartbeatStale,
        latencyMs: operationalHealth.latencyMs
      }
    });
  }

  if (healthErrorBudget && healthErrorBudget.state !== 'within-budget') {
    incidents.push({
      code:
        healthErrorBudget.state === 'exhausted'
          ? 'hosted-kernel-error-budget-exhausted'
          : 'hosted-kernel-error-budget-degraded',
      severity: healthErrorBudget.state === 'exhausted' ? 'critical' : publishCandidate ? 'warning' : 'info',
      source: 'healthErrorBudget',
      message: `Hosted kernel health budget is ${healthErrorBudget.state} for ${request.id}.`,
      operatorAction: healthErrorBudget.recommendedOperatorAction,
      blocksPublish: healthErrorBudget.suppressMutation,
      retryable: healthErrorBudget.retryAllowed && retry.retryable,
      evidence: {
        windowSeconds: healthErrorBudget.windowSeconds,
        failureCount: healthErrorBudget.failureCount,
        failureLimit: healthErrorBudget.failureLimit,
        degradedCount: healthErrorBudget.degradedCount,
        degradedLimit: healthErrorBudget.degradedLimit,
        latestFailureAt: healthErrorBudget.latestFailureAt,
        escalationRoute: healthErrorBudget.escalationRoute
      }
    });
  }

  if (providerAck.terminalFailure) {
    incidents.push({
      code: 'provider-ack-terminal',
      severity: 'critical',
      source: 'providerAck',
      message: `Provider acknowledgment is terminal (${providerAck.state}) for ${request.id}.`,
      operatorAction: 'Inspect the provider receipt and submit a new approval request if the operator decision is still needed.',
      blocksPublish: true,
      retryable: false,
      evidence: {
        providerId: providerAck.providerId,
        receiptRef: providerAck.receiptRef,
        acknowledgedAt: providerAck.acknowledgedAt
      }
    });
  }

  if (providerAck.stale && publishCandidate) {
    incidents.push({
      code: 'provider-ack-stale',
      severity: 'warning',
      source: 'providerAck',
      message: `Provider acknowledgment is stale (${providerAck.ageSeconds}s) for ${request.id}.`,
      operatorAction: 'Poll provider acknowledgment before publishing another command envelope.',
      blocksPublish: false,
      retryable: true,
      evidence: {
        requestId: providerAck.requestId,
        idempotencyKey: providerAck.idempotencyKey,
        expectedIdempotencyKey: providerAck.expectedIdempotencyKey
      }
    });
  }

  if (handoffCheckpoint.publishBlocked && !handoffCheckpoint.completed) {
    incidents.push({
      code: handoffCheckpoint.publishBlockReason || 'handoff-publish-blocked',
      severity: 'blocker',
      source: 'handoffCheckpoint',
      message: `External handoff blocks publish for ${request.id}.`,
      operatorAction: handoffCheckpoint.leaseActive
        ? `Wait for or release the active handoff lease owned by ${handoffCheckpoint.owner}.`
        : 'Repair the handoff checkpoint scope before retrying publish.',
      blocksPublish: true,
      retryable: handoffCheckpoint.leaseActive,
      evidence: {
        state: handoffCheckpoint.state,
        owner: handoffCheckpoint.owner,
        leaseUntil: handoffCheckpoint.leaseUntil,
        mismatches: handoffCheckpoint.mismatches
      }
    });
  }

  const validationBlockers = validation.errors.filter(
    (error) => !deliveryValidation.errors.some((deliveryError) => deliveryError.code === error.code)
  );
  const critical = incidents.some((incident) => incident.severity === 'critical');
  const blocksPublish = incidents.some((incident) => incident.blocksPublish) || validationBlockers.length > 0;
  const degradedReadOnly = operationalHealth.state === 'degraded' && !decisionCommand;
  const recommendedMode = critical
    ? 'fail-closed'
    : degradedReadOnly
      ? 'degraded-read-only'
      : blocksPublish
        ? 'blocked-remediation'
        : operationalHealth.state === 'degraded'
          ? 'degraded-idempotent-publish'
          : 'normal';

  return {
    contractVersion: 'cli-approve.operational-incident.v1',
    state: incidents.length === 0 && validationBlockers.length === 0 ? 'clear' : critical ? 'critical' : blocksPublish ? 'blocked' : 'degraded',
    recommendedMode,
    suppressProviderPublish: blocksPublish,
    allowStatusOnly: critical || degradedReadOnly,
    retryWindow: retry.retryable
      ? {
          retryAt: retry.retryAt,
          delayMs: retry.delayMs,
          attempt: retry.attempt,
          maxAttempts: retry.maxAttempts,
          route: retry.retryRoute
        }
      : null,
    incidentCount: incidents.length,
    validationBlockerCodes: validationBlockers.map((error) => error.code),
    incidents,
    generatedAt: now
  };
}

function buildAuditRecord({
  command,
  request,
  lifecycle,
  validation,
  boundary,
  operationalHealth,
  healthErrorBudget,
  retry,
  operationalIncident,
  approvalQuorum,
  permissionBoundary,
  now
}) {
  return {
    at: now,
    surfaceId,
    actor: request.requestedBy,
    command,
    requestId: request.id,
    action: request.action,
    tenantId: boundary.tenantId,
    providerTenantId: boundary.providerTenantId,
    workspaceId: boundary.workspaceId,
    role: boundary.role,
    boundaryScopeKey: boundary.scopeKey,
    decision: lifecycle.status,
    nextAction: lifecycle.nextAction,
    validation: validation.ok ? 'passed' : 'failed',
    errorCodes: validation.errors.map((error) => error.code),
    healthState: operationalHealth.state,
    degradedMode: operationalHealth.degradedMode,
    healthErrorBudgetState: healthErrorBudget.state,
    healthErrorBudgetFailures: healthErrorBudget.failureCount,
    healthErrorBudgetSuppressMutation: healthErrorBudget.suppressMutation,
    approvalCount: approvalQuorum.count,
    approvalsRequired: approvalQuorum.required,
    approvalQuorumSatisfied: approvalQuorum.satisfied,
    permissionPolicyMode: permissionBoundary ? permissionBoundary.policyMode : 'settings-only',
    permissionGrantIds: permissionBoundary ? permissionBoundary.matchingGrantIds : [],
    permissionDeniedReasons: permissionBoundary ? permissionBoundary.deniedReasons : [],
    recoveredFromPersistedState: lifecycle.recoveredFromPersistedState === true,
    duplicateCommand: lifecycle.duplicateCommand === true,
    retryable: retry.retryable,
    retryAt: retry.retryAt,
    operationalIncidentState: operationalIncident.state,
    operationalMode: operationalIncident.recommendedMode,
    publishSuppressed: operationalIncident.suppressProviderPublish,
    incidentCodes: operationalIncident.incidents.map((incident) => incident.code)
  };
}

function buildValidationSummary({ validation, capabilityNegotiation, request, settings, boundary, permissionBoundary }) {
  const blockingCodes = validation.errors.map((error) => error.code);
  const warningCodes = validation.warnings.map((warning) => warning.code);

  return {
    state: validation.ok ? 'valid' : 'invalid',
    blockingCount: validation.errors.length,
    warningCount: validation.warnings.length,
    blockingCodes,
    warningCodes,
    repairHints: validation.errors.map((error) => {
      if (error.code === 'unsupported_action') {
        return `Use one of: ${settings.allowedActions.join(', ')}.`;
      }
      if (error.code === 'reason_required') {
        return 'Provide request.reason before submitting this lifecycle decision.';
      }
      if (error.code === 'provider_capability_missing') {
        return `Attach a provider with: ${capabilityNegotiation.missingRequired.join(', ')}.`;
      }
      if (error.code === 'tenant_boundary_violation') {
        return `Use provider tenant ${boundary.providerTenantId} or disable requireTenantMatch for this surface.`;
      }
      if (error.code === 'workspace_scope_denied') {
        return `Use an allowed workspace: ${settings.allowedWorkspaces.join(', ')}.`;
      }
      if (error.code === 'operator_role_denied') {
        return `Use one of the allowed roles: ${settings.allowedRoles.join(', ')}.`;
      }
      if (error.code === 'permission_scope_denied') {
        return permissionBoundary && permissionBoundary.deniedReasons.length > 0
          ? `Attach an active permission grant; denied by ${permissionBoundary.deniedReasons.join(', ')}.`
          : 'Attach an active permission grant for this tenant, workspace, role, and action.';
      }
      if (error.code === 'approval_quorum_not_met') {
        return `Collect ${settings.minApprovers} distinct in-scope approval records before approving.`;
      }
      if (error.code === 'schedule_time_required') {
        return 'Provide scheduleAt as an ISO timestamp.';
      }
      if (error.code === 'settings_revision_mismatch') {
        return 'Refresh lifecycle settings and resubmit with the current settings revision.';
      }
      if (error.code === 'enable_command_disabled') {
        return 'Enable command submission is disabled by settings; update lifecycle control policy first.';
      }
      if (error.code === 'disable_command_disabled') {
        return 'Disable command submission is disabled by settings; update lifecycle control policy first.';
      }
      if (error.code === 'schedule_command_disabled') {
        return 'Schedule command submission is disabled by settings; update lifecycle control policy first.';
      }
      if (error.code === 'schedule_lead_time_too_short') {
        return `Choose a scheduleAt at least ${settings.minScheduleLeadMinutes} minute(s) in the future.`;
      }
      if (error.code === 'schedule_blackout_window') {
        return 'Choose a scheduleAt outside configured lifecycle blackout windows.';
      }
      return error.message;
    }),
    acceptedAction: request.allowed ? request.action : null,
    boundaryScopeKey: boundary.scopeKey,
    isolated: boundary.isolated,
    authorized: boundary.authorized,
    permissionPolicyMode: permissionBoundary ? permissionBoundary.policyMode : 'settings-only',
    permissionGrantSatisfied: permissionBoundary ? permissionBoundary.grantSatisfied : true,
    permissionDeniedReasons: permissionBoundary ? permissionBoundary.deniedReasons : [],
    requiredCapabilitiesSatisfied: capabilityNegotiation.ok
  };
}

function buildPreviewContract({
  command,
  request,
  lifecycle,
  validation,
  providerContract,
  capabilityNegotiation,
  boundary,
  approvalQuorum,
  now
}) {
  const decisionVerb = {
    approve: 'Approve',
    reject: 'Reject',
    hold: 'Hold',
    schedule: 'Schedule',
    enable: 'Enable',
    disable: 'Disable',
    status: 'Inspect'
  }[command];

  return {
    contractVersion: 'cli-approve.preview.v1',
    title: `${decisionVerb} ${request.action}`,
    summary: validation.ok
      ? `${decisionVerb} request ${request.id} for ${providerContract.providerId}.`
      : `Cannot ${command} request ${request.id} until validation passes.`,
    visibleToOperator: true,
    requestId: request.id,
    actor: request.requestedBy,
    reason: request.reason || null,
    tenantId: boundary.tenantId,
    workspaceId: boundary.workspaceId,
    role: boundary.role,
    boundaryScopeKey: boundary.scopeKey,
    decisionPreview: lifecycle.status,
    approvalCount: approvalQuorum.count,
    approvalsRequired: approvalQuorum.required,
    approvalQuorumSatisfied: approvalQuorum.satisfied,
    publishTarget: providerContract.endpointRef,
    publishTopic: providerContract.requestTopic,
    proofCapability: capabilityNegotiation.selectedProofCapability,
    handoffCapability: capabilityNegotiation.selectedHandoffCapability,
    scheduleAt: lifecycle.scheduleAt,
    generatedAt: now
  };
}

function buildAcceptanceContract({ command, request, lifecycle, validation, settings, providerContract, boundary }) {
  const requiresExplicitAccept = ['approve', 'reject', 'hold', 'schedule', 'enable', 'disable'].includes(command);
  const accepted =
    validation.ok && boundary.isolated && boundary.authorized && (command === 'status' || Boolean(request.reason) || !settings.requireReason);

  return {
    contractVersion: 'cli-approve.acceptance.v1',
    required: requiresExplicitAccept,
    accepted,
    acceptToken: accepted ? `${providerContract.correlationId}:${request.id}:${lifecycle.status}` : null,
    acceptedBy: accepted ? request.requestedBy : null,
    acceptedScope: accepted ? boundary.scopeKey : null,
    acceptanceText: requiresExplicitAccept
      ? `${request.requestedBy} accepts ${lifecycle.status} for ${request.id}.`
      : `Status inspection for ${request.id} requires no acceptance token.`,
    rejectionReasons: validation.errors.map((error) => error.message)
  };
}

function buildReadinessContract({
  lifecycle,
  validation,
  deliveryValidation,
  sync,
  externalHandoff,
  capabilityNegotiation,
  boundary,
  permissionBoundary,
  operationalHealth,
  healthErrorBudget,
  providerAck,
  recovery,
  persistedCommandPlan,
  handoffCheckpoint,
  operationalIncident
}) {
  const checks = [
    { id: 'tenant', label: 'Tenant boundary matched provider contract', ok: boundary.tenantAligned && boundary.targetTenantAligned },
    { id: 'workspace', label: 'Workspace scope allowed for cli approval', ok: boundary.workspaceAllowed },
    { id: 'role', label: 'Operator role authorized for lifecycle decision', ok: boundary.roleAllowed },
    {
      id: 'permission-grant',
      label: 'Operator permission grant matches tenant, workspace, role, and action',
      ok: !permissionBoundary || permissionBoundary.canSubmitDecision
    },
    { id: 'validation', label: 'Lifecycle input validated', ok: validation.ok },
    { id: 'sync', label: 'Provider sync metadata available', ok: Boolean(sync.sequenceSubject && sync.topics.requests) },
    { id: 'proof', label: 'Lifecycle proof capability negotiated', ok: Boolean(capabilityNegotiation.selectedProofCapability) },
    {
      id: 'quorum',
      label: 'Approval quorum satisfied for hosted-kernel execution',
      ok: !lifecycle.approvalQuorumRequired || lifecycle.approvalQuorumSatisfied
    },
    {
      id: 'handoff',
      label: 'External handoff route publishable',
      ok: externalHandoff.publishable || lifecycle.status === 'waiting' || (handoffCheckpoint && handoffCheckpoint.completed)
    },
    { id: 'health', label: 'Hosted kernel accepts cli approval decisions', ok: operationalHealth.state !== 'failed' },
    {
      id: 'health-error-budget',
      label: 'Hosted kernel health error budget permits mutation commands',
      ok: !healthErrorBudget || !healthErrorBudget.suppressMutation
    },
    {
      id: 'provider-ack',
      label: 'Provider acknowledgment is compatible with this approval request',
      ok: deliveryValidation.ok && (!lifecycle.runnable || providerAck.state === 'pending' || providerAck.accepted)
    },
    {
      id: 'recovery',
      label: 'Persisted checkpoint is compatible with restart-safe cli approval status',
      ok: !recovery || recovery.state !== 'checkpoint-conflict'
    },
    {
      id: 'persistence',
      label: 'Persisted command plan keeps restart status idempotent',
      ok:
        !persistedCommandPlan ||
        (persistedCommandPlan.consistencyChecks.restartStatusStable &&
          persistedCommandPlan.consistencyChecks.providerAckCompatible)
    },
    {
      id: 'handoff-checkpoint',
      label: 'External handoff checkpoint is available for this request scope',
      ok: !handoffCheckpoint || !handoffCheckpoint.publishBlocked || handoffCheckpoint.completed
    },
    {
      id: 'operational-incident',
      label: 'No operational incident suppresses hosted-kernel publish',
      ok: !operationalIncident || !operationalIncident.suppressProviderPublish
    }
  ];

  return {
    contractVersion: 'cli-approve.readiness.v1',
    state: recovery && recovery.state === 'checkpoint-conflict'
      ? 'blocked'
      : recovery && recovery.replayRequired
        ? 'recovering'
        : lifecycle.runnable
      ? 'ready'
      : validation.ok
        ? lifecycle.status === 'scheduled'
          ? 'scheduled'
          : 'not-ready'
        : 'blocked',
    runnable: lifecycle.runnable,
    degradedMode: operationalHealth.degradedMode,
    healthState: operationalHealth.state,
    healthErrorBudgetState: healthErrorBudget ? healthErrorBudget.state : 'within-budget',
    providerAckState: providerAck.state,
    recoveryState: recovery ? recovery.state : 'restart-safe',
    persistedCommandOperation: persistedCommandPlan ? persistedCommandPlan.operation : 'read-only-status',
    restartSemantics: persistedCommandPlan ? persistedCommandPlan.restartSemantics : 'restart-observable',
    handoffCheckpointState: handoffCheckpoint ? handoffCheckpoint.state : 'none',
    operationalIncidentState: operationalIncident ? operationalIncident.state : 'clear',
    operationalMode: operationalIncident ? operationalIncident.recommendedMode : 'normal',
    nextAction: lifecycle.nextAction,
    checks,
    failedChecks: checks.filter((check) => !check.ok).map((check) => check.id)
  };
}

function buildNextStepContract({
  command,
  request,
  lifecycle,
  preview,
  acceptance,
  readiness,
  sync,
  externalHandoff,
  boundary,
  retry,
  providerCommand,
  recovery,
  persistedCommandPlan,
  operationalIncident
}) {
  const handoffCompleted = externalHandoff.checkpoint && externalHandoff.checkpoint.completed;
  const route = retry.retryable
    ? retry.retryRoute
    : operationalIncident && operationalIncident.suppressProviderPublish
      ? 'cli-approve.operational.remediate'
    : recovery && recovery.replayRequired
      ? recovery.replayRoute
    : persistedCommandPlan && persistedCommandPlan.operation === 'quarantine-conflict'
      ? 'cli-approve.persistence.quarantine'
    : handoffCompleted
      ? 'cli-approve.external-handoff.observe'
    : lifecycle.runnable
    ? 'hosted-kernel.proof.publish'
    : lifecycle.status === 'scheduled'
      ? 'hosted-kernel.schedule.persist'
      : validationRoute(readiness.state);

  return {
    contractVersion: 'cli-approve.next-step.v1',
    route,
    command,
    requestId: request.id,
    action: request.action,
    label: lifecycle.nextAction,
    operatorMessage: preview.summary,
    canSubmit: acceptance.accepted && readiness.failedChecks.length === 0 && !handoffCompleted,
    retryable: retry.retryable,
    retryAt: retry.retryAt,
    restartSafeStatus: recovery ? recovery.restartSafeStatus : lifecycle.status,
    recoveryState: recovery ? recovery.state : 'restart-safe',
    persistedCommandOperation: persistedCommandPlan ? persistedCommandPlan.operation : 'read-only-status',
    restartSemantics: persistedCommandPlan ? persistedCommandPlan.restartSemantics : 'restart-observable',
    operationalIncidentState: operationalIncident ? operationalIncident.state : 'clear',
    operationalMode: operationalIncident ? operationalIncident.recommendedMode : 'normal',
    routeInput: {
      correlationId: sync.correlationId,
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
      boundaryScopeKey: boundary.scopeKey,
      topic: lifecycle.runnable ? sync.topics.audit : externalHandoff.topic,
      handoffState: externalHandoff.state,
      handoffCheckpointState: externalHandoff.checkpoint ? externalHandoff.checkpoint.state : 'none',
      commandEnvelopeIdempotencyKey: providerCommand.idempotencyKey,
      decision: lifecycle.status,
      restartSafeStatus: recovery ? recovery.restartSafeStatus : lifecycle.status,
      recoveryCursor: recovery ? recovery.recoveryCursor : null,
      persistenceKey: persistedCommandPlan ? persistedCommandPlan.persistenceKey : null,
      persistedCommandOperation: persistedCommandPlan ? persistedCommandPlan.operation : 'read-only-status',
      expectedStatusAfterRestart: persistedCommandPlan
        ? persistedCommandPlan.expectedStatusAfterRestart
        : recovery
          ? recovery.restartSafeStatus
          : lifecycle.status,
      scheduleAt: lifecycle.scheduleAt,
      retryAttempt: retry.attempt,
      incidentCodes: operationalIncident ? operationalIncident.incidents.map((incident) => incident.code) : []
    }
  };
}

function normalizeClientRuntimeContext({ input, request, boundary, sync, providerContract, now }) {
  const clientInput = input.client && typeof input.client === 'object' ? input.client : {};
  const sessionInput = input.session && typeof input.session === 'object' ? input.session : {};
  const runtimeInput = input.runtime && typeof input.runtime === 'object' ? input.runtime : {};
  const navigationInput =
    input.navigation && typeof input.navigation === 'object'
      ? input.navigation
      : clientInput.navigation && typeof clientInput.navigation === 'object'
        ? clientInput.navigation
        : {};
  const preferencesInput =
    clientInput.preferences && typeof clientInput.preferences === 'object'
      ? clientInput.preferences
      : runtimeInput.preferences && typeof runtimeInput.preferences === 'object'
        ? runtimeInput.preferences
        : {};
  const clientId = String(clientInput.clientId || clientInput.id || sessionInput.clientId || 'cli').trim();
  const sessionId = String(sessionInput.sessionId || sessionInput.id || clientInput.sessionId || sync.correlationId).trim();
  const requestedRequestId = String(
    clientInput.requestId || sessionInput.requestId || runtimeInput.requestId || navigationInput.requestId || request.id
  ).trim();
  const selectedCommand = normalizeCommand(
    clientInput.selectedCommand || runtimeInput.selectedCommand || navigationInput.command || input.command
  );
  const displayMode = ['compact', 'interactive', 'json', 'silent'].includes(String(preferencesInput.displayMode || '').trim())
    ? String(preferencesInput.displayMode).trim()
    : 'interactive';
  const handoffMode = ['inline', 'external', 'provider'].includes(String(preferencesInput.handoffMode || '').trim())
    ? String(preferencesInput.handoffMode).trim()
    : 'inline';
  const lastRenderedAt = clientInput.lastRenderedAt || runtimeInput.lastRenderedAt || null;
  const parsedLastRenderedAt = lastRenderedAt ? Date.parse(lastRenderedAt) : Number.NaN;
  const lastSeenCursor = String(clientInput.lastSeenCursor || sessionInput.lastSeenCursor || runtimeInput.lastSeenCursor || '').trim();
  const pendingMutationId = String(
    clientInput.pendingMutationId || runtimeInput.pendingMutationId || `${sync.correlationId}:${request.id}:${selectedCommand}`
  ).trim();
  const requestVersion = String(
    clientInput.requestVersion || runtimeInput.requestVersion || `${boundary.scopeKey}:${request.id}`
  ).trim();
  const traceId = String(runtimeInput.traceId || `${sync.correlationId}:${sessionId}:${request.id}`).trim();
  const focusTarget = String(navigationInput.focusTarget || clientInput.focusTarget || 'primary-action').trim();
  const mismatchReasons = [];

  if (requestedRequestId !== request.id) {
    mismatchReasons.push('requestId');
  }
  if (lastSeenCursor && sync.cursor && lastSeenCursor !== sync.cursor) {
    mismatchReasons.push('syncCursor');
  }

  return {
    contractVersion: 'cli-approve.client-runtime-context.v1',
    clientId,
    sessionId,
    traceId,
    requestedRequestId,
    selectedCommand,
    displayMode,
    handoffMode,
    focusTarget,
    pendingMutationId,
    requestVersion,
    lastSeenCursor: lastSeenCursor || null,
    lastRenderedAt: Number.isFinite(parsedLastRenderedAt) ? new Date(parsedLastRenderedAt).toISOString() : null,
    staleRender: Number.isFinite(parsedLastRenderedAt)
      ? Date.parse(now) - parsedLastRenderedAt > 15000
      : false,
    providerRoute: providerContract.endpointRef,
    mismatchReasons,
    compatible: mismatchReasons.length === 0
  };
}

function buildClientWorkflowPlan({
  runtimeContext,
  request,
  lifecycle,
  validation,
  readiness,
  nextStep,
  sync,
  externalHandoff,
  providerCommand,
  providerAck,
  handoffCheckpoint,
  retry,
  recovery,
  persistedCommandPlan,
  operationalIncident,
  operationalHealth,
  healthErrorBudget,
  persistedState,
  boundary,
  now
}) {
  const blockedReasons = [
    ...validation.errors.map((error) => error.code),
    ...readiness.failedChecks.map((check) => `readiness:${check}`),
    ...runtimeContext.mismatchReasons.map((reason) => `client:${reason}`)
  ];
  const canPublishProviderCommand =
    providerCommand.publishable &&
    externalHandoff.publishable &&
    nextStep.canSubmit &&
    runtimeContext.compatible &&
    providerAck.mismatches.length === 0;
  const intent = canPublishProviderCommand
    ? 'publish'
    : recovery.replayRequired
      ? 'replay'
      : persistedCommandPlan.operation === 'quarantine-conflict'
        ? 'quarantine'
      : retry.retryable
        ? 'retry'
        : blockedReasons.length > 0 || operationalIncident.suppressProviderPublish
          ? 'repair'
          : 'observe';
  const resumeToken = [
    sync.correlationId,
    runtimeContext.sessionId,
    request.id,
    runtimeContext.requestVersion,
    lifecycle.status
  ].join(':');
  const requiredClientState = [
    'clientId',
    'sessionId',
    'traceId',
    'pendingMutationId',
    'requestVersion',
    'boundaryScopeKey'
  ];
  const missingClientState = requiredClientState.filter((key) => {
    if (key === 'boundaryScopeKey') {
      return !boundary.scopeKey;
    }
    return !runtimeContext[key];
  });
  const optimisticUpdate =
    intent === 'publish'
      ? {
          allowed: true,
          requestState: 'publishing',
          expectedProviderAckState: 'accepted',
          rollbackOn: ['provider_ack_terminal_failure', 'provider_ack_mismatch', 'external_handoff_checkpoint_mismatch']
        }
      : intent === 'replay'
        ? {
            allowed: true,
            requestState: 'recovering',
            expectedProviderAckState: providerAck.state,
            rollbackOn: ['checkpoint-conflict']
          }
        : {
            allowed: false,
            requestState: lifecycle.status,
            expectedProviderAckState: providerAck.state,
            rollbackOn: []
          };
  const acknowledgementPolicy = {
    required: intent === 'publish' || lifecycle.runnable || lifecycle.status === 'scheduled',
    pollRoute:
      intent === 'publish' || providerAck.state === 'pending'
        ? 'cli-approve.provider-ack.poll'
        : recovery.replayRequired
          ? recovery.replayRoute
          : null,
    pollAfterMs: retry.retryable ? retry.delayMs : providerAck.state === 'pending' ? 1000 : 0,
    observedAckAgeSeconds: providerAck.ageSeconds,
    expected: providerCommand.expectedAck
  };
  const routeGuard = {
    route: nextStep.route,
    allowed: missingClientState.length === 0 && runtimeContext.compatible && !operationalIncident.suppressProviderPublish,
    deniedReasons: [
      ...missingClientState.map((key) => `missing:${key}`),
      ...runtimeContext.mismatchReasons.map((reason) => `client-mismatch:${reason}`),
      ...(operationalIncident.suppressProviderPublish ? ['operational-publish-suppressed'] : [])
    ],
    fallbackRoute: retry.retryable
      ? retry.retryRoute
      : recovery.replayRequired
        ? recovery.replayRoute
        : persistedCommandPlan.operation === 'quarantine-conflict'
          ? 'cli-approve.persistence.quarantine'
        : blockedReasons.length > 0
          ? 'cli-approve.validation.repair'
          : 'cli-approve.operator.wait'
  };

  return {
    contractVersion: 'cli-approve.client-workflow-plan.v1',
    planId: `${runtimeContext.pendingMutationId}:${intent}:${lifecycle.status}`,
    intent,
    resumeToken,
    routeGuard,
    requiredClientState,
    missingClientState,
    optimisticUpdate,
    acknowledgementPolicy,
    providerDelivery: {
      commandName: providerCommand.commandName,
      publishable: canPublishProviderCommand,
      topic: providerCommand.requestTopic,
      idempotencyKey: providerCommand.idempotencyKey,
      receiptRef: persistedState.receiptRef || providerAck.receiptRef,
      serviceCursor: persistedState.serviceCursor || providerAck.serviceCursor || sync.cursor
    },
    persistencePlan: {
      operation: persistedCommandPlan.operation,
      writeRequired: persistedCommandPlan.writeRequired,
      auditOnly: persistedCommandPlan.auditOnly,
      restartSemantics: persistedCommandPlan.restartSemantics,
      persistenceKey: persistedCommandPlan.persistenceKey,
      idempotencyKey: persistedCommandPlan.idempotencyKey,
      sequenceAfter: persistedCommandPlan.sequenceAfter,
      statePatch: persistedCommandPlan.statePatch
    },
    handoffLease: {
      state: handoffCheckpoint.state,
      active: handoffCheckpoint.leaseActive,
      owner: handoffCheckpoint.owner,
      leaseUntil: handoffCheckpoint.leaseUntil,
      blockedReason: externalHandoff.blockedReason
    },
    userVisibleState: {
      stage:
        intent === 'publish'
          ? 'ready-to-publish'
          : intent === 'replay'
            ? 'recovery-needed'
            : intent === 'retry'
              ? 'waiting-to-retry'
              : intent === 'repair'
                ? 'needs-attention'
                : 'watching-provider',
      message:
        intent === 'publish'
          ? `Ready to publish ${request.action} approval to hosted kernel.`
          : intent === 'replay'
            ? recovery.operatorMessage
            : intent === 'quarantine'
              ? `Persisted checkpoint conflict blocks ${request.id}; quarantine before continuing.`
            : intent === 'retry'
              ? `Retry ${request.id} after ${retry.retryAt}.`
              : blockedReasons.length > 0
                ? `Resolve ${blockedReasons[0]} before continuing ${request.id}.`
                : `Watching hosted-kernel state for ${request.id}.`,
      healthState: operationalHealth.state,
      incidentState: operationalIncident.state
    },
    healthBudget: {
      state: healthErrorBudget.state,
      fallbackMode: healthErrorBudget.fallbackMode,
      suppressMutation: healthErrorBudget.suppressMutation,
      escalationRoute: healthErrorBudget.escalationRoute
    },
    auditEvent: {
      at: now,
      type: 'cli-approve.client-workflow-plan',
      traceId: runtimeContext.traceId,
      requestId: request.id,
      intent,
      route: nextStep.route,
      routeAllowed: routeGuard.allowed,
      boundaryScopeKey: boundary.scopeKey,
      idempotencyKey: providerCommand.idempotencyKey,
      persistedCommandOperation: persistedCommandPlan.operation,
      resumeToken
    }
  };
}

function buildClientRuntimeState({
  input,
  command,
  request,
  lifecycle,
  validation,
  preview,
  acceptance,
  readiness,
  nextStep,
  sync,
  externalHandoff,
  providerCommand,
  providerAck,
  handoffCheckpoint,
  retry,
  recovery,
  persistedCommandPlan,
  operationalIncident,
  operationalHealth,
  healthErrorBudget,
  persistedState,
  boundary,
  providerContract,
  now
}) {
  const runtimeContext = normalizeClientRuntimeContext({ input, request, boundary, sync, providerContract, now });
  const clientWorkflowPlan = buildClientWorkflowPlan({
    runtimeContext,
    request,
    lifecycle,
    validation,
    readiness,
    nextStep,
    sync,
    externalHandoff,
    providerCommand,
    providerAck,
    handoffCheckpoint,
    retry,
    recovery,
    persistedCommandPlan,
    operationalIncident,
    operationalHealth,
    healthErrorBudget,
    persistedState,
    boundary,
    now
  });
  const terminalStates = new Set(['approved', 'rejected', 'failed', 'expired', 'disabled']);
  const pendingProviderAck = providerAck.state === 'pending' && (lifecycle.runnable || lifecycle.status === 'scheduled');
  const waitingForRecovery = recovery.replayRequired || recovery.state === 'checkpoint-conflict';
  const publishSuppressed = operationalIncident.suppressProviderPublish;
  const busy =
    retry.retryable ||
    waitingForRecovery ||
    operationalHealth.state === 'degraded' ||
    (pendingProviderAck && externalHandoff.publishable);
  const blocked = !validation.ok || readiness.state === 'blocked' || recovery.state === 'checkpoint-conflict' || publishSuppressed;
  const completed = terminalStates.has(lifecycle.status) && !lifecycle.runnable && !recovery.replayRequired;
  const stage = blocked
    ? 'blocked'
    : recovery.replayRequired
      ? 'recovering'
      : retry.retryable
        ? 'retry-wait'
        : lifecycle.runnable
          ? 'ready-to-submit'
          : lifecycle.status === 'scheduled'
            ? 'scheduled'
            : completed
              ? 'complete'
              : 'operator-review';
  const disabledCommands = [...lifecycleCommands].filter((candidate) => {
    if (candidate === 'status') {
      return false;
    }
    if (blocked) {
      return true;
    }
    if (busy && candidate !== 'hold') {
      return true;
    }
    if (candidate === 'approve' && !lifecycle.approvalQuorumSatisfied) {
      return true;
    }
    return acceptance.required && !acceptance.accepted;
  });
  const primaryAction = nextStep.canSubmit
    ? {
        command: lifecycle.runnable ? 'approve' : command,
        label: lifecycle.runnable ? 'Publish approval' : preview.title,
        route: clientWorkflowPlan.routeGuard.allowed ? nextStep.route : clientWorkflowPlan.routeGuard.fallbackRoute,
        payloadRef: lifecycle.runnable ? 'providerCommand.body' : 'externalHandoff.payload'
      }
    : {
        command: blocked ? 'status' : command,
        label: blocked ? 'Repair approval input' : preview.title,
        route: clientWorkflowPlan.routeGuard.allowed ? nextStep.route : clientWorkflowPlan.routeGuard.fallbackRoute,
        payloadRef: blocked ? 'validationSummary.repairHints' : 'preview'
      };
  const workflowHandoff = {
    contractVersion: 'cli-approve.client-workflow-handoff.v1',
    handoffId: clientWorkflowPlan.planId,
    intent: clientWorkflowPlan.intent,
    queue: clientWorkflowPlan.intent === 'observe' ? 'operator-visible' : 'operator-action',
    mode: runtimeContext.handoffMode,
    displayMode: runtimeContext.displayMode,
    route: clientWorkflowPlan.routeGuard.allowed ? nextStep.route : clientWorkflowPlan.routeGuard.fallbackRoute,
    routeGuard: clientWorkflowPlan.routeGuard,
    routeInput: {
      ...nextStep.routeInput,
      clientId: runtimeContext.clientId,
      sessionId: runtimeContext.sessionId,
      traceId: runtimeContext.traceId,
      pendingMutationId: runtimeContext.pendingMutationId,
      requestVersion: runtimeContext.requestVersion,
      resumeToken: clientWorkflowPlan.resumeToken
    },
    continuationToken: clientWorkflowPlan.resumeToken,
    requiresConfirmation: acceptance.required && !acceptance.accepted,
    confirmationText: acceptance.acceptanceText,
    publishTarget:
      clientWorkflowPlan.intent === 'publish'
        ? {
            commandName: providerCommand.commandName,
            topic: providerCommand.requestTopic,
            idempotencyKey: providerCommand.idempotencyKey,
            expectedAck: providerCommand.expectedAck
          }
        : null,
    auditRef: {
      stream: 'operator-userland.cli-approve.lifecycle',
      correlationId: sync.correlationId,
      traceId: runtimeContext.traceId,
      proofSubject: request.id,
      workflowPlanId: clientWorkflowPlan.planId
    },
    proofRef: {
      type: 'cli-approve.lifecycle-proof',
      subject: request.id,
      capability: preview.proofCapability,
      boundaryScopeKey: sync.boundaryScopeKey
    },
    optimisticUpdate: clientWorkflowPlan.optimisticUpdate,
    acknowledgementPolicy: clientWorkflowPlan.acknowledgementPolicy,
    providerDelivery: clientWorkflowPlan.providerDelivery,
    handoffLease: clientWorkflowPlan.handoffLease,
    auditEvent: clientWorkflowPlan.auditEvent
  };

  return {
    contractVersion: 'cli-approve.client-runtime.v1',
    clientId: runtimeContext.clientId,
    sessionId: runtimeContext.sessionId,
    runtimeContext,
    stage,
    busy,
    completed,
    generatedAt: now,
    requestState: {
      requestId: request.id,
      action: request.action,
      command,
      decision: lifecycle.status,
      restartSafeStatus: recovery.restartSafeStatus,
      providerAckState: providerAck.state,
      externalHandoffCheckpointState: handoffCheckpoint.state,
      externalHandoffLeaseActive: handoffCheckpoint.leaseActive,
      clientRequestCompatible: runtimeContext.compatible,
      clientRequestMismatchReasons: runtimeContext.mismatchReasons,
      clientRequestVersion: runtimeContext.requestVersion,
      clientWorkflowPlanId: clientWorkflowPlan.planId,
      clientWorkflowIntent: clientWorkflowPlan.intent,
      clientWorkflowRouteAllowed: clientWorkflowPlan.routeGuard.allowed,
      selectedCommand: runtimeContext.selectedCommand,
      healthState: operationalHealth.state,
      healthErrorBudgetState: healthErrorBudget.state,
      healthErrorBudgetFallbackMode: healthErrorBudget.fallbackMode,
      operationalIncidentState: operationalIncident.state,
      operationalMode: operationalIncident.recommendedMode,
      publishSuppressed,
      recoveryState: recovery.state,
      persistedCheckpointPresent: persistedState.present,
      persistedCommandOperation: persistedCommandPlan.operation,
      restartSemantics: persistedCommandPlan.restartSemantics,
      expectedStatusAfterRestart: persistedCommandPlan.expectedStatusAfterRestart,
      persistenceKey: persistedCommandPlan.persistenceKey,
      persistenceWriteRequired: persistedCommandPlan.writeRequired,
      latestReceiptRef: persistedState.receiptRef || providerAck.receiptRef,
      serviceCursor: persistedState.serviceCursor || providerAck.serviceCursor || sync.cursor
    },
    controls: {
      canSubmit: nextStep.canSubmit,
      disabledCommands,
      primaryAction,
      retryAt: retry.retryAt,
      pollAfterMs: retry.retryable ? retry.delayMs : pendingProviderAck ? 1000 : 0,
      pollRoute: retry.retryable
        ? retry.retryRoute
        : pendingProviderAck
          ? 'cli-approve.provider-ack.poll'
          : recovery.replayRequired
            ? recovery.replayRoute
          : null
    },
    workflowHandoff,
    clientWorkflowPlan,
    userVisibleHandoff: {
      title: preview.title,
      message:
        clientWorkflowPlan.userVisibleState.message ||
        (blocked
          ? validation.errors[0]?.message || 'Approval is blocked.'
          : recovery.replayRequired
            ? recovery.operatorMessage
            : nextStep.operatorMessage),
      route: workflowHandoff.route,
      routeInput: workflowHandoff.routeInput,
      routeGuard: clientWorkflowPlan.routeGuard,
      resumeToken: clientWorkflowPlan.resumeToken,
      visibleState: clientWorkflowPlan.userVisibleState,
      handoffState: externalHandoff.state,
      handoffPublishable: externalHandoff.publishable,
      handoffBlockedReason: externalHandoff.blockedReason,
      handoffTopic: externalHandoff.topic,
      providerCommandPublishable: providerCommand.publishable,
      providerCommandName: providerCommand.commandName,
      persistedCommandOperation: persistedCommandPlan.operation,
      restartSemantics: persistedCommandPlan.restartSemantics,
      operationalIncidents: operationalIncident.incidents,
      healthBudget: clientWorkflowPlan.healthBudget,
      workflowHandoff
    },
    auditRefs: {
      stream: 'operator-userland.cli-approve.lifecycle',
      correlationId: sync.correlationId,
      idempotencyKey: providerCommand.idempotencyKey,
      boundaryScopeKey: sync.boundaryScopeKey,
      proofSubject: request.id,
      runtimeTraceId: runtimeContext.traceId,
      pendingMutationId: runtimeContext.pendingMutationId,
      workflowHandoffId: workflowHandoff.handoffId,
      workflowPlanId: clientWorkflowPlan.planId,
      persistedCommandOperation: persistedCommandPlan.operation,
      persistenceKey: persistedCommandPlan.persistenceKey,
      routeAllowed: clientWorkflowPlan.routeGuard.allowed
    },
    persistence: persistedCommandPlan
  };
}

function buildOperatorConsoleContract({
  command,
  request,
  lifecycle,
  validation,
  validationSummary,
  preview,
  acceptance,
  readiness,
  nextStep,
  clientRuntime,
  providerCommand,
  externalHandoff,
  providerAck,
  retry,
  recovery,
  persistedCommandPlan,
  operationalIncident,
  healthErrorBudget,
  lifecycleControls,
  boundary,
  sync,
  now
}) {
  const blockingItems = validation.errors.map((error, index) => ({
    code: error.code,
    severity: 'blocker',
    message: error.message,
    repairHint: validationSummary.repairHints[index] || error.message,
    route: 'cli-approve.validation.repair',
    payloadRef: 'validationSummary'
  }));
  const warningItems = validation.warnings.map((warning) => ({
    code: warning.code,
    severity: 'warning',
    message: warning.message,
    repairHint: warning.message,
    route: 'cli-approve.operator.review-warning',
    payloadRef: 'validation.warnings'
  }));
  const decisionRows = [
    { id: 'request', label: 'Request', value: request.id, copyable: true },
    { id: 'action', label: 'Action', value: request.action, copyable: false },
    { id: 'actor', label: 'Actor', value: request.requestedBy, copyable: false },
    { id: 'scope', label: 'Boundary scope', value: boundary.scopeKey, copyable: true },
    { id: 'decision', label: 'Decision', value: lifecycle.status, copyable: false },
    { id: 'ack', label: 'Provider ack', value: providerAck.state, copyable: false }
  ];
  const routeActions = [
    {
      id: 'primary',
      label: clientRuntime.controls.primaryAction.label,
      route: clientRuntime.controls.primaryAction.route,
      enabled: clientRuntime.controls.canSubmit && clientRuntime.clientWorkflowPlan.routeGuard.allowed,
      disabledReasons: clientRuntime.clientWorkflowPlan.routeGuard.deniedReasons,
      payloadRef: clientRuntime.controls.primaryAction.payloadRef
    },
    {
      id: 'retry',
      label: 'Retry hosted-kernel check',
      route: retry.retryRoute,
      enabled: retry.retryable,
      disabledReasons: retry.retryable ? [] : ['retry-not-available'],
      payloadRef: 'retry'
    },
    {
      id: 'recovery',
      label: 'Replay persisted command',
      route: recovery.replayRoute,
      enabled: recovery.replayRequired,
      disabledReasons: recovery.replayRequired ? [] : ['recovery-not-required'],
      payloadRef: 'recovery'
    },
    {
      id: 'persistence',
      label: persistedCommandPlan.writeRequired ? 'Persist restart checkpoint' : 'Inspect restart checkpoint',
      route: persistedCommandPlan.operation === 'quarantine-conflict'
        ? 'cli-approve.persistence.quarantine'
        : 'cli-approve.persistence.persist-command',
      enabled: persistedCommandPlan.writeRequired || persistedCommandPlan.operation === 'quarantine-conflict',
      disabledReasons:
        persistedCommandPlan.writeRequired || persistedCommandPlan.operation === 'quarantine-conflict'
          ? []
          : [`persistence-${persistedCommandPlan.operation}`],
      payloadRef: 'persistedCommandPlan'
    },
    {
      id: 'handoff',
      label: 'Open external handoff',
      route: externalHandoff.publishable ? 'cli-approve.external-handoff.publish' : 'cli-approve.external-handoff.observe',
      enabled: externalHandoff.publishable || externalHandoff.checkpoint.completed,
      disabledReasons:
        externalHandoff.publishable || externalHandoff.checkpoint.completed
          ? []
          : [externalHandoff.blockedReason || 'handoff-not-publishable'],
      payloadRef: 'externalHandoff'
    }
  ];
  const acceptancePrompts = acceptance.required
    ? [
        {
          id: 'explicit-operator-acceptance',
          required: true,
          accepted: acceptance.accepted,
          text: acceptance.acceptanceText,
          token: acceptance.acceptToken,
          blockedBy: acceptance.accepted ? [] : validation.errors.map((error) => error.code)
        }
      ]
    : [];

  return {
    contractVersion: 'cli-approve.operator-console.v1',
    panelId: `${sync.correlationId}:${request.id}:operator-console`,
    generatedAt: now,
    command,
    state: readiness.state,
    title: preview.title,
    summary: preview.summary,
    decisionRows,
    validationPanel: {
      state: validationSummary.state,
      blockingCount: validationSummary.blockingCount,
      warningCount: validationSummary.warningCount,
      items: [...blockingItems, ...warningItems],
      repairRoute: blockingItems.length > 0 ? 'cli-approve.validation.repair' : null
    },
    acceptancePanel: {
      required: acceptance.required,
      accepted: acceptance.accepted,
      acceptedBy: acceptance.acceptedBy,
      acceptedScope: acceptance.acceptedScope,
      prompts: acceptancePrompts
    },
    readinessPanel: {
      state: readiness.state,
      failedChecks: readiness.failedChecks,
      checks: readiness.checks.map((check) => ({
        id: check.id,
        label: check.label,
        state: check.ok ? 'passed' : 'failed'
      })),
      incidentState: operationalIncident.state,
      recoveryState: recovery.state,
      persistenceOperation: persistedCommandPlan.operation,
      restartSemantics: persistedCommandPlan.restartSemantics
    },
    healthPanel: {
      state: healthErrorBudget.state,
      fallbackMode: healthErrorBudget.fallbackMode,
      suppressMutation: healthErrorBudget.suppressMutation,
      windowSeconds: healthErrorBudget.windowSeconds,
      failures: `${healthErrorBudget.failureCount}/${healthErrorBudget.failureLimit}`,
      degradedEvents: `${healthErrorBudget.degradedCount}/${healthErrorBudget.degradedLimit}`,
      latestFailureAt: healthErrorBudget.latestFailureAt,
      escalationRoute: healthErrorBudget.escalationRoute,
      operatorAction: healthErrorBudget.recommendedOperatorAction
    },
    lifecycleControlsPanel: {
      state: lifecycleControls.blocked ? 'blocked' : 'ready',
      currentSettingsRevision: lifecycleControls.currentSettingsRevision,
      expectedSettingsRevision: lifecycleControls.expectedSettingsRevision,
      settingsRevisionMatched: lifecycleControls.settingsRevisionMatched,
      currentEnabled: lifecycleControls.currentEnabled,
      requestedEnabled: lifecycleControls.requestedEnabled,
      nextControlAction: lifecycleControls.nextControlAction,
      blockedReasons: lifecycleControls.blockedReasons,
      schedule: lifecycleControls.schedule,
      toggles: lifecycleControls.toggles
    },
    nextStepPanel: {
      route: nextStep.route,
      label: nextStep.label,
      canSubmit: nextStep.canSubmit,
      operatorMessage: nextStep.operatorMessage,
      routeInput: nextStep.routeInput,
      actions: routeActions
    },
    providerPublishPanel: {
      publishable: providerCommand.publishable,
      commandName: providerCommand.commandName,
      topic: providerCommand.requestTopic,
      idempotencyKey: providerCommand.idempotencyKey,
      expectedAck: providerCommand.expectedAck,
      blockedReason: providerCommand.blockedReason
    },
    persistencePanel: {
      operation: persistedCommandPlan.operation,
      writeRequired: persistedCommandPlan.writeRequired,
      restartSemantics: persistedCommandPlan.restartSemantics,
      expectedStatusAfterRestart: persistedCommandPlan.expectedStatusAfterRestart,
      persistenceKey: persistedCommandPlan.persistenceKey,
      recoveryPaths: persistedCommandPlan.recoveryPaths,
      consistencyChecks: persistedCommandPlan.consistencyChecks
    },
    auditEvent: {
      at: now,
      type: 'cli-approve.operator-console-rendered',
      requestId: request.id,
      command,
      decision: lifecycle.status,
      route: nextStep.route,
      canSubmit: nextStep.canSubmit,
      lifecycleControlAction: lifecycleControls.nextControlAction,
      persistedCommandOperation: persistedCommandPlan.operation,
      validationState: validationSummary.state,
      readinessState: readiness.state,
      panelId: `${sync.correlationId}:${request.id}:operator-console`
    }
  };
}

function normalizeHistoryEvents(input, auditRecord, providerContract, boundary, now) {
  const historyInput = Array.isArray(input.history)
    ? input.history
    : Array.isArray(input.auditHistory)
      ? input.auditHistory
      : [];
  const priorEvents = historyInput
    .map((event, index) => {
      if (!event || typeof event !== 'object') {
        return null;
      }
      const at = event.at || event.generatedAt || event.timestamp || now;
      const parsedAt = Date.parse(at);
      return {
        at: Number.isFinite(parsedAt) ? new Date(parsedAt).toISOString() : now,
        source: String(event.source || 'history').trim(),
        sequence: Number.parseInt(event.sequence, 10) || index + 1,
        command: normalizeCommand(event.command),
        requestId: String(event.requestId || event.id || auditRecord.requestId).trim(),
        action: String(event.action || auditRecord.action).trim(),
        actor: String(event.actor || event.requestedBy || auditRecord.actor).trim(),
        decision: String(event.decision || event.status || 'observed').trim(),
        validation: String(event.validation || (Array.isArray(event.errorCodes) && event.errorCodes.length > 0 ? 'failed' : 'passed')).trim(),
        errorCodes: Array.isArray(event.errorCodes)
          ? event.errorCodes.map((code) => String(code).trim()).filter(Boolean)
          : [],
        healthState: String(event.healthState || 'unknown').trim(),
        degradedMode: event.degradedMode === true,
        retryable: event.retryable === true,
        retryAt: event.retryAt || null,
        tenantId: String(event.tenantId || providerContract.tenantId).trim(),
        workspaceId: String(event.workspaceId || boundary.workspaceId).trim(),
        boundaryScopeKey: String(event.boundaryScopeKey || boundary.scopeKey).trim(),
        readinessState: String(event.readinessState || event.latestReadiness || 'unknown').trim(),
        operationalIncidentState: String(event.operationalIncidentState || event.incidentState || 'clear').trim(),
        operationalMode: String(event.operationalMode || 'normal').trim(),
        publishSuppressed: event.publishSuppressed === true,
        route: event.route ? String(event.route).trim() : null,
        persistedCommandOperation: event.persistedCommandOperation
          ? String(event.persistedCommandOperation).trim()
          : null,
        workflowPlanId: event.workflowPlanId ? String(event.workflowPlanId).trim() : null,
        traceId: event.traceId || event.runtimeTraceId ? String(event.traceId || event.runtimeTraceId).trim() : null
      };
    })
    .filter(Boolean);

  return [
    ...priorEvents,
    {
      ...auditRecord,
      source: 'current',
      sequence: priorEvents.length + 1
    }
  ].sort((left, right) => Date.parse(left.at) - Date.parse(right.at) || left.sequence - right.sequence);
}

function incrementCounter(counter, key) {
  const normalized = String(key || 'unknown').trim() || 'unknown';
  counter[normalized] = (counter[normalized] || 0) + 1;
}

function normalizeAnalyticsWindow(input, now) {
  const analyticsInput =
    input.analytics && typeof input.analytics === 'object'
      ? input.analytics
      : input.reporting && typeof input.reporting === 'object'
        ? input.reporting
        : {};
  const from = analyticsInput.from || analyticsInput.windowStartAt || analyticsInput.since || null;
  const to = analyticsInput.to || analyticsInput.windowEndAt || analyticsInput.until || now;
  const parsedFrom = from ? Date.parse(from) : Number.NaN;
  const parsedTo = to ? Date.parse(to) : Date.parse(now);
  const lookbackSeconds = Math.max(60, Number.parseInt(analyticsInput.lookbackSeconds, 10) || 3600);
  const toIso = Number.isFinite(parsedTo) ? new Date(parsedTo).toISOString() : now;
  const fromIso = Number.isFinite(parsedFrom)
    ? new Date(parsedFrom).toISOString()
    : new Date(Date.parse(toIso) - lookbackSeconds * 1000).toISOString();

  return {
    contractVersion: 'cli-approve.analytics-window.v1',
    from: fromIso,
    to: toIso,
    lookbackSeconds,
    label: String(analyticsInput.label || 'operator-review-window').trim(),
    requestedBy: String(analyticsInput.requestedBy || input.actor || 'operator').trim()
  };
}

function buildAnalyticsTimeline(events, now) {
  let previousAt = null;

  return events.map((event) => {
    const atMs = Date.parse(event.at);
    const dwellSeconds =
      previousAt && Number.isFinite(atMs) ? Math.max(0, Math.round((atMs - previousAt) / 1000)) : 0;
    previousAt = Number.isFinite(atMs) ? atMs : previousAt;

    return {
      at: event.at,
      sequence: event.sequence,
      command: event.command,
      requestId: event.requestId,
      actor: event.actor,
      decision: event.decision,
      validation: event.validation,
      readinessState: event.readinessState,
      healthState: event.healthState,
      operationalIncidentState: event.operationalIncidentState,
      operationalMode: event.operationalMode,
      publishSuppressed: event.publishSuppressed,
      persistedCommandOperation: event.persistedCommandOperation,
      route: event.route,
      retryable: event.retryable,
      retryAt: event.retryAt,
      dwellSeconds,
      ageSeconds: Number.isFinite(atMs) ? Math.max(0, Math.round((Date.parse(now) - atMs) / 1000)) : null,
      errorCodes: event.errorCodes
    };
  });
}

function buildReportingState({ events, scopedEvents, counters, window, auditRecord, lifecycle, readiness, operationalHealth, retry }) {
  const blockedEvents = scopedEvents.filter((event) => event.validation === 'failed' || event.publishSuppressed);
  const lastBlockedEvent = blockedEvents.length > 0 ? blockedEvents[blockedEvents.length - 1] : null;
  const latestEvent = scopedEvents.length > 0 ? scopedEvents[scopedEvents.length - 1] : null;
  const staleWindow = scopedEvents.length === 0;
  const exportCompleteness =
    events.length === 0
      ? 'empty'
      : staleWindow
        ? 'outside-requested-window'
        : counters.currentBlockingErrors > 0
          ? 'blocked-current'
          : 'complete';

  return {
    contractVersion: 'cli-approve.analytics-reporting-state.v1',
    state: staleWindow ? 'stale' : blockedEvents.length > 0 ? 'attention' : 'clear',
    exportCompleteness,
    currentDecision: lifecycle.status,
    currentReadiness: readiness.state,
    currentHealthState: operationalHealth.state,
    currentRetryAt: retry.retryAt,
    latestEventAt: latestEvent ? latestEvent.at : null,
    latestEventDecision: latestEvent ? latestEvent.decision : auditRecord.decision,
    lastBlockedAt: lastBlockedEvent ? lastBlockedEvent.at : null,
    lastBlockedCodes: lastBlockedEvent ? lastBlockedEvent.errorCodes : [],
    reportWindow: window,
    operatorSummary:
      blockedEvents.length > 0
        ? `${blockedEvents.length} cli approval event(s) need attention in ${window.label}.`
        : staleWindow
          ? `No cli approval events were found in ${window.label}.`
          : `${scopedEvents.length} cli approval event(s) are export-ready for ${window.label}.`
  };
}

function buildAnalyticsExport({ input, auditRecord, validation, lifecycle, readiness, operationalHealth, providerContract, boundary, sync, retry, now }) {
  const events = normalizeHistoryEvents(input, auditRecord, providerContract, boundary, now);
  const window = normalizeAnalyticsWindow(input, now);
  const scopedEvents = events.filter((event) => Date.parse(event.at) >= Date.parse(window.from) && Date.parse(event.at) <= Date.parse(window.to));
  const counters = {
    totalEvents: events.length,
    scopedEvents: scopedEvents.length,
    currentBlockingErrors: validation.errors.length,
    currentWarnings: validation.warnings.length,
    retryableEvents: 0,
    degradedEvents: 0,
    publishSuppressedEvents: 0,
    byCommand: {},
    byDecision: {},
    byValidation: {},
    byHealthState: {},
    byReadinessState: {},
    byOperationalIncidentState: {},
    byOperationalMode: {},
    byActor: {},
    byWorkspace: {},
    byRoute: {},
    byPersistedCommandOperation: {},
    byErrorCode: {}
  };

  for (const event of scopedEvents) {
    incrementCounter(counters.byCommand, event.command);
    incrementCounter(counters.byDecision, event.decision);
    incrementCounter(counters.byValidation, event.validation);
    incrementCounter(counters.byHealthState, event.healthState);
    incrementCounter(counters.byReadinessState, event.readinessState);
    incrementCounter(counters.byOperationalIncidentState, event.operationalIncidentState);
    incrementCounter(counters.byOperationalMode, event.operationalMode);
    incrementCounter(counters.byActor, event.actor);
    incrementCounter(counters.byWorkspace, event.workspaceId);
    incrementCounter(counters.byRoute, event.route || 'none');
    incrementCounter(counters.byPersistedCommandOperation, event.persistedCommandOperation || 'none');
    if (event.retryable) {
      counters.retryableEvents += 1;
    }
    if (event.degradedMode || event.healthState === 'degraded') {
      counters.degradedEvents += 1;
    }
    if (event.publishSuppressed) {
      counters.publishSuppressedEvents += 1;
    }
    for (const code of event.errorCodes) {
      incrementCounter(counters.byErrorCode, code);
    }
  }

  const firstEventAt = scopedEvents.length > 0 ? scopedEvents[0].at : window.from;
  const lastEventAt = scopedEvents.length > 0 ? scopedEvents[scopedEvents.length - 1].at : window.to;
  const timeline = buildAnalyticsTimeline(scopedEvents, now);
  const reportingState = buildReportingState({
    events,
    scopedEvents,
    counters,
    window,
    auditRecord,
    lifecycle,
    readiness,
    operationalHealth,
    retry
  });

  return {
    contractVersion: 'cli-approve.analytics-export.v1',
    exportId: `${sync.correlationId}:${auditRecord.requestId}:${scopedEvents.length}:${window.label}`,
    generatedAt: now,
    scope: {
      providerId: providerContract.providerId,
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
      boundaryScopeKey: boundary.scopeKey,
      requestId: auditRecord.requestId,
      action: auditRecord.action
    },
    window,
    counters,
    historySnapshot: {
      firstEventAt,
      lastEventAt,
      totalSequence: events.length,
      currentSequence: scopedEvents.length,
      latestDecision: lifecycle.status,
      latestReadiness: readiness.state,
      latestHealthState: operationalHealth.state,
      latestRetryAt: retry.retryAt,
      windowSeconds: Math.max(0, Math.round((Date.parse(lastEventAt) - Date.parse(firstEventAt)) / 1000))
    },
    reportingState,
    timeline,
    exportSummary: {
      format: 'jsonl-ready',
      stream: 'operator-userland.cli-approve.lifecycle',
      ready: reportingState.exportCompleteness === 'complete' || reportingState.exportCompleteness === 'blocked-current',
      manifest: {
        exportId: `${sync.correlationId}:${auditRecord.requestId}:${scopedEvents.length}:${window.label}`,
        rowCount: scopedEvents.length,
        windowFrom: window.from,
        windowTo: window.to,
        stream: 'operator-userland.cli-approve.lifecycle',
        partitionKey: `${providerContract.providerId}/${boundary.workspaceId}/${auditRecord.action}`
      },
      columns: [
        'at',
        'sequence',
        'command',
        'requestId',
        'actor',
        'decision',
        'validation',
        'readinessState',
        'healthState',
        'operationalIncidentState',
        'publishSuppressed',
        'retryable',
        'errorCodes'
      ],
      rows: scopedEvents.map((event) => ({
        at: event.at,
        sequence: event.sequence,
        command: event.command,
        requestId: event.requestId,
        actor: event.actor,
        decision: event.decision,
        validation: event.validation,
        readinessState: event.readinessState,
        healthState: event.healthState,
        operationalIncidentState: event.operationalIncidentState,
        publishSuppressed: event.publishSuppressed,
        retryable: event.retryable,
        errorCodes: event.errorCodes
      }))
    }
  };
}

function validationRoute(readinessState) {
  return readinessState === 'blocked' ? 'cli-approve.validation.repair' : 'cli-approve.operator.wait';
}

export function describeCliApproveSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const command = normalizeCommand(input.command);
  const settings = normalizeSettings(input.settings);
  const request = normalizeRequest(input, settings);
  const providerContract = normalizeProviderContract(input, request);
  const boundary = normalizeBoundary(input, request, providerContract, settings);
  const permissionBoundary = normalizePermissionBoundary(input, request, boundary, providerContract, now);
  const approvalQuorum = normalizeApprovalQuorum(input, request, boundary, settings, command, now);
  const capabilityNegotiation = negotiateCapabilities(providerContract, settings);
  const operationalHealth = normalizeOperationalHealth(input, settings, providerContract, now);
  const healthErrorBudget = buildHealthErrorBudget({
    input,
    request,
    providerContract,
    boundary,
    operationalHealth,
    settings,
    now
  });
  const scheduleAt = input.scheduleAt || input.scheduledFor || null;
  const lifecycleControls = normalizeLifecycleControls(input, command, settings, scheduleAt, boundary, now);
  const validation = validateLifecycle({
    command,
    request,
    settings,
    scheduleAt,
    now,
    capabilityNegotiation,
    boundary,
    operationalHealth,
    healthErrorBudget,
    approvalQuorum,
    permissionBoundary,
    lifecycleControls
  });
  let lifecycle = buildLifecycleState({
    command,
    request,
    settings,
    validation,
    scheduleAt,
    now,
    approvalQuorum,
    lifecycleControls
  });
  const providerAck = normalizeProviderAck(input, providerContract, request, boundary, settings, now);
  const handoffCheckpoint = normalizeExternalHandoffCheckpoint(input, providerContract, request, boundary, now);
  const deliveryValidation = validateProviderDelivery({
    command,
    lifecycle,
    providerAck,
    capabilityNegotiation,
    handoffCheckpoint
  });
  validation.errors.push(...deliveryValidation.errors);
  validation.warnings.push(...deliveryValidation.warnings);
  validation.ok = validation.errors.length === 0;
  lifecycle = buildLifecycleState({
    command,
    request,
    settings,
    validation,
    scheduleAt,
    now,
    approvalQuorum,
    lifecycleControls
  });
  const persistedState = normalizePersistedState(input, providerContract, request, boundary, providerAck, now);
  const recovery = buildRecoveryContract({ command, lifecycle, persistedState, providerAck, operationalHealth, now });
  lifecycle = reconcileLifecycleWithRecovery(lifecycle, command, recovery);
  const retry = buildRetryContract({ command, validation, lifecycle, operationalHealth, healthErrorBudget, settings, now });
  const actionableErrors = buildActionableErrors({ validation, retry, operationalHealth, healthErrorBudget, settings });
  const operationalIncident = buildOperationalIncidentContract({
    command,
    request,
    lifecycle,
    validation,
    deliveryValidation,
    operationalHealth,
    healthErrorBudget,
    providerAck,
    handoffCheckpoint,
    retry,
    now
  });
  const auditRecord = buildAuditRecord({
    command,
    request,
    lifecycle,
    validation,
    boundary,
    operationalHealth,
    healthErrorBudget,
    retry,
    operationalIncident,
    approvalQuorum,
    permissionBoundary,
    now
  });
  const sync = buildSyncMetadata({ providerContract, request, lifecycle, validation, capabilityNegotiation, boundary, now });
  const externalHandoff = buildExternalHandoff({
    providerContract,
    request,
    lifecycle,
    validation,
    capabilityNegotiation,
    boundary,
    providerAck,
    handoffCheckpoint,
    operationalIncident,
    now
  });
  const providerCommand = buildProviderCommandEnvelope({
    providerContract,
    request,
    lifecycle,
    validation,
    capabilityNegotiation,
    boundary,
    permissionBoundary,
    sync,
    providerAck,
    handoffCheckpoint,
    operationalIncident,
    now
  });
  const persistedCommandPlan = buildPersistedCommandPlan({
    command,
    request,
    lifecycle,
    validation,
    providerContract,
    boundary,
    providerAck,
    persistedState,
    recovery,
    sync,
    externalHandoff,
    operationalIncident,
    now
  });
  const validationSummary = buildValidationSummary({
    validation,
    capabilityNegotiation,
    request,
    settings,
    boundary,
    permissionBoundary
  });
  const preview = buildPreviewContract({
    command,
    request,
    lifecycle,
    validation,
    providerContract,
    capabilityNegotiation,
    boundary,
    approvalQuorum,
    now
  });
  const acceptance = buildAcceptanceContract({ command, request, lifecycle, validation, settings, providerContract, boundary });
  const readiness = buildReadinessContract({
    lifecycle,
    validation,
    deliveryValidation,
    sync,
    externalHandoff,
    capabilityNegotiation,
    boundary,
    permissionBoundary,
    operationalHealth,
    healthErrorBudget,
    providerAck,
    recovery,
    persistedCommandPlan,
    handoffCheckpoint,
    operationalIncident
  });
  const nextStep = buildNextStepContract({
    command,
    request,
    lifecycle,
    preview,
    acceptance,
    readiness,
    sync,
    externalHandoff,
    boundary,
    retry,
    providerCommand,
    recovery,
    persistedCommandPlan,
    operationalIncident
  });
  const clientRuntime = buildClientRuntimeState({
    input,
    command,
    request,
    lifecycle,
    validation,
    preview,
    acceptance,
    readiness,
    nextStep,
    sync,
    externalHandoff,
    providerCommand,
    providerAck,
    handoffCheckpoint,
    retry,
    recovery,
    persistedCommandPlan,
    operationalIncident,
    operationalHealth,
    healthErrorBudget,
    persistedState,
    boundary,
    providerContract,
    now
  });
  const operatorConsole = buildOperatorConsoleContract({
    command,
    request,
    lifecycle,
    validation,
    validationSummary,
    preview,
    acceptance,
    readiness,
    nextStep,
    clientRuntime,
    providerCommand,
    externalHandoff,
    providerAck,
    retry,
    recovery,
    persistedCommandPlan,
    operationalIncident,
    healthErrorBudget,
    lifecycleControls,
    boundary,
    sync,
    now
  });
  const analytics = buildAnalyticsExport({
    input,
    auditRecord,
    validation,
    lifecycle,
    readiness,
    operationalHealth,
    providerContract,
    boundary,
    sync,
    retry,
    now
  });
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];

  return {
    ok: validation.ok,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'hosted-kernel cli approval lifecycle',
    command,
    request,
    settings,
    providerContract,
    boundary,
    permissionBoundary,
    approvalQuorum,
    capabilityNegotiation,
    validation,
    validationSummary,
    operationalHealth,
    healthErrorBudget,
    lifecycleControls,
    operationalIncident,
    persistedState,
    persistedCommandPlan,
    recovery,
    providerAck,
    handoffCheckpoint,
    deliveryValidation,
    retry,
    actionableErrors,
    lifecycle,
    preview,
    acceptance,
    readiness,
    nextStep,
    clientRuntime,
    operatorConsole,
    sync,
    externalHandoff,
    providerCommand,
    analytics,
    audit: {
      stream: 'operator-userland.cli-approve.lifecycle',
      record: auditRecord,
      clientRuntime: {
        traceId: clientRuntime.auditRefs.runtimeTraceId,
        workflowHandoffId: clientRuntime.auditRefs.workflowHandoffId,
        operatorConsolePanelId: operatorConsole.panelId,
        pendingMutationId: clientRuntime.auditRefs.pendingMutationId,
        stage: clientRuntime.stage,
        handoffIntent: clientRuntime.workflowHandoff.intent,
        persistedCommandOperation: persistedCommandPlan.operation,
        persistenceKey: persistedCommandPlan.persistenceKey,
        requestCompatible: clientRuntime.requestState.clientRequestCompatible
      }
    },
    proof: {
      type: 'cli-approve.lifecycle-proof',
      subject: request.id,
      decision: lifecycle.status,
      runnable: lifecycle.runnable,
      capability: capabilityNegotiation.selectedProofCapability,
      providerId: providerContract.providerId,
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
      boundaryScopeKey: boundary.scopeKey,
      correlationId: providerContract.correlationId,
      healthState: operationalHealth.state,
      degradedMode: operationalHealth.degradedMode,
      healthErrorBudgetState: healthErrorBudget.state,
      healthErrorBudgetFailures: healthErrorBudget.failureCount,
      healthErrorBudgetWindowSeconds: healthErrorBudget.windowSeconds,
      healthErrorBudgetSuppressMutation: healthErrorBudget.suppressMutation,
      healthFallbackMode: healthErrorBudget.fallbackMode,
      settingsRevision: lifecycleControls.currentSettingsRevision,
      expectedSettingsRevision: lifecycleControls.expectedSettingsRevision,
      settingsRevisionMatched: lifecycleControls.settingsRevisionMatched,
      lifecycleControlAction: lifecycleControls.nextControlAction,
      lifecycleControlBlockedReasons: lifecycleControls.blockedReasons,
      approvalCount: approvalQuorum.count,
      approvalsRequired: approvalQuorum.required,
      approvalQuorumSatisfied: approvalQuorum.satisfied,
      approverIds: approvalQuorum.approverIds,
      permissionPolicyMode: permissionBoundary.policyMode,
      permissionGrantSatisfied: permissionBoundary.grantSatisfied,
      permissionGrantIds: permissionBoundary.matchingGrantIds,
      permissionDeniedReasons: permissionBoundary.deniedReasons,
      retryable: retry.retryable,
      operationalIncidentState: operationalIncident.state,
      operationalMode: operationalIncident.recommendedMode,
      publishSuppressed: operationalIncident.suppressProviderPublish,
      clientTraceId: clientRuntime.auditRefs.runtimeTraceId,
      workflowHandoffId: clientRuntime.auditRefs.workflowHandoffId,
      operatorConsolePanelId: operatorConsole.panelId,
      pendingMutationId: clientRuntime.auditRefs.pendingMutationId,
      persistedCommandOperation: persistedCommandPlan.operation,
      restartSemantics: persistedCommandPlan.restartSemantics,
      expectedStatusAfterRestart: persistedCommandPlan.expectedStatusAfterRestart,
      persistenceKey: persistedCommandPlan.persistenceKey,
      emittedAt: now,
      evidenceCount: evidence.length
    },
    evidence
  };
}

export default describeCliApproveSurface;
