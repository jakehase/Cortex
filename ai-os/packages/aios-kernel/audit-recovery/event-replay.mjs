export const surfaceId = "aios_audit-recovery_event-replay_078";
export const surfaceGroup = "audit-recovery";
export const surfaceName = "event-replay";

const lifecycleCommands = new Set([
  "inspect",
  "enable",
  "disable",
  "schedule",
  "pause",
  "resume",
  "replay-now"
]);

const retentionModes = new Set(["strict", "balanced", "permissive"]);
const scheduleModes = new Set(["manual", "interval", "window"]);
const replayCapabilities = new Set([
  "event-scan",
  "proof-export",
  "dry-run",
  "live-replay",
  "external-handoff",
  "sync-cursor"
]);
const defaultProviderCapabilities = ["event-scan", "proof-export", "dry-run", "sync-cursor"];
const handoffStates = new Set(["none", "pending", "ready", "blocked", "accepted"]);
const clientDisplayModes = new Set(["compact", "guided", "operator"]);
const clientIntentKinds = new Set(["inspect", "preview", "execute", "handoff", "recover"]);
const clientContinuationModes = new Set(["inline", "route", "callback", "deferred"]);
const clientContinuationActions = new Set(["preview", "accept", "dispatch", "handoff", "status"]);
const persistedReplayStates = new Set([
  "unknown",
  "disabled",
  "idle",
  "waiting",
  "scheduled",
  "preview-ready",
  "execution-ready",
  "running",
  "completed",
  "blocked",
  "failed"
]);
const restartRecoverableStates = new Set(["running", "failed", "blocked"]);
const idempotentLifecycleCommands = new Set(["enable", "disable", "schedule", "pause", "resume", "replay-now"]);
const terminalReplayStates = new Set(["completed", "disabled"]);
const tenantIsolationModes = new Set(["strict", "workspace", "trusted"]);
const replayRoles = new Set(["owner", "admin", "auditor", "recovery-operator", "automation"]);
const operationalHealthStates = new Set(["ok", "degraded", "failed", "unknown"]);
const dependencyHealthStates = new Set(["ok", "degraded", "failed", "missing", "unknown"]);
const degradedModePolicies = new Set(["allow-preview", "require-ack", "block-live-replay"]);
const serviceProtocolVersions = ["2026-07-01", "2026-03-01", "2025-12-01"];
const providerAuthModes = new Set(["none", "signed-request", "mTLS", "oauth-client"]);
const deliveryGuarantees = new Set(["at-most-once", "at-least-once", "exactly-once"]);
const providerEndpointKinds = new Set(["scan", "proof", "replay", "handoff", "status"]);
const providerReceiptStates = new Set(["none", "pending", "acknowledged", "rejected", "expired"]);
const providerReceiptKinds = new Set(["scan", "proof", "replay", "handoff", "status"]);
const replayOperationKinds = new Set(["restore", "reconcile", "compensate", "skip"]);
const lifecycleControlDefaults = {
  enable: true,
  disable: true,
  schedule: true,
  pause: true,
  resume: true,
  manualReplay: true
};
const replayPermissions = new Set([
  "audit-replay:read",
  "audit-replay:configure",
  "audit-replay:schedule",
  "audit-replay:execute",
  "audit-replay:handoff",
  "audit-replay:tenant-crossing"
]);
const commandPermissionRequirements = {
  inspect: ["audit-replay:read"],
  enable: ["audit-replay:configure"],
  disable: ["audit-replay:configure"],
  schedule: ["audit-replay:schedule"],
  pause: ["audit-replay:configure"],
  resume: ["audit-replay:configure"],
  "replay-now": ["audit-replay:execute"]
};
const rolePermissionGrants = {
  owner: Array.from(replayPermissions),
  admin: [
    "audit-replay:read",
    "audit-replay:configure",
    "audit-replay:schedule",
    "audit-replay:execute",
    "audit-replay:handoff"
  ],
  auditor: ["audit-replay:read"],
  "recovery-operator": [
    "audit-replay:read",
    "audit-replay:schedule",
    "audit-replay:execute",
    "audit-replay:handoff"
  ],
  automation: ["audit-replay:read", "audit-replay:schedule", "audit-replay:execute"]
};

function asBoolean(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function asPositiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalizeLifecycleCommand(value) {
  const command = typeof value === "string" ? value.trim().toLowerCase() : "inspect";
  return lifecycleCommands.has(command) ? command : "inspect";
}

function normalizeProviderContract(input = {}) {
  const provider = input.provider && typeof input.provider === "object" ? input.provider : {};
  const service = input.service && typeof input.service === "object" ? input.service : {};
  const endpoints = service.endpoints && typeof service.endpoints === "object"
    ? service.endpoints
    : provider.endpoints && typeof provider.endpoints === "object"
      ? provider.endpoints
      : {};
  const requestedCapabilities = Array.isArray(input.requestedCapabilities)
    ? input.requestedCapabilities
    : Array.isArray(provider.requestedCapabilities)
      ? provider.requestedCapabilities
      : [];
  const providerCapabilities = Array.isArray(provider.capabilities)
    ? provider.capabilities
    : defaultProviderCapabilities;
  const normalizedProviderCapabilities = providerCapabilities
    .map((capability) => (typeof capability === "string" ? capability.trim() : ""))
    .filter((capability) => replayCapabilities.has(capability));
  const normalizedRequestedCapabilities = requestedCapabilities
    .map((capability) => (typeof capability === "string" ? capability.trim() : ""))
    .filter((capability) => replayCapabilities.has(capability));
  const effectiveCapabilities = normalizedRequestedCapabilities.length > 0
    ? normalizedProviderCapabilities.filter((capability) => normalizedRequestedCapabilities.includes(capability))
    : normalizedProviderCapabilities;
  const providerId = typeof provider.id === "string" && provider.id.trim()
    ? provider.id.trim()
    : "hosted-kernel";
  const serviceId = typeof service.id === "string" && service.id.trim()
    ? service.id.trim()
    : "audit-recovery-event-replay";
  const providerVersions = Array.isArray(provider.protocolVersions)
    ? provider.protocolVersions
    : typeof provider.protocolVersion === "string"
      ? [provider.protocolVersion]
      : serviceProtocolVersions;
  const serviceVersions = Array.isArray(service.acceptedProtocolVersions)
    ? service.acceptedProtocolVersions
    : serviceProtocolVersions;
  const normalizedProviderVersions = providerVersions
    .map((version) => (typeof version === "string" ? version.trim() : ""))
    .filter((version) => serviceProtocolVersions.includes(version));
  const normalizedServiceVersions = serviceVersions
    .map((version) => (typeof version === "string" ? version.trim() : ""))
    .filter((version) => serviceProtocolVersions.includes(version));
  const negotiatedProtocolVersion = serviceProtocolVersions.find((version) => (
    normalizedProviderVersions.includes(version) && normalizedServiceVersions.includes(version)
  )) || null;
  const providerAuthMode = providerAuthModes.has(provider.authMode) ? provider.authMode : "signed-request";
  const serviceRequiredAuth = providerAuthModes.has(service.requiredAuth) ? service.requiredAuth : "signed-request";
  const deliveryGuarantee = deliveryGuarantees.has(provider.deliveryGuarantee)
    ? provider.deliveryGuarantee
    : "at-least-once";
  const endpointReadiness = Array.from(providerEndpointKinds).map((kind) => {
    const endpoint = endpoints[kind] && typeof endpoints[kind] === "object" ? endpoints[kind] : {};
    const explicitUrl = typeof endpoint.url === "string" && endpoint.url.trim() ? endpoint.url.trim() : null;
    const url = explicitUrl || (providerId === "hosted-kernel" ? `kernel://${serviceId}/${kind}` : null);
    const enabled = endpoint.enabled === false ? false : url !== null;
    const requiresCapability = kind === "scan"
      ? "event-scan"
      : kind === "proof"
        ? "proof-export"
        : kind === "replay"
          ? "live-replay"
          : kind === "handoff"
            ? "external-handoff"
            : "sync-cursor";
    const capabilityNegotiated = effectiveCapabilities.includes(requiresCapability);

    return {
      kind,
      url,
      enabled,
      explicit: explicitUrl !== null,
      requiresCapability,
      capabilityNegotiated,
      ready: enabled && capabilityNegotiated
    };
  });
  const requiredEndpointKinds = [
    "scan",
    "status",
    service.requiredProofEndpoint === false ? null : "proof",
    effectiveCapabilities.includes("live-replay") ? "replay" : null,
    effectiveCapabilities.includes("external-handoff") ? "handoff" : null
  ].filter(Boolean);
  const missingEndpointKinds = requiredEndpointKinds.filter((kind) => (
    !endpointReadiness.some((endpoint) => endpoint.kind === kind && endpoint.ready)
  ));
  const contractErrors = [
    negotiatedProtocolVersion === null
      ? {
        field: "provider.protocolVersions",
        code: "provider_protocol_version_not_negotiated",
        providerVersions: normalizedProviderVersions,
        acceptedVersions: normalizedServiceVersions
      }
      : null,
    providerAuthMode !== serviceRequiredAuth && serviceRequiredAuth !== "none"
      ? {
        field: "provider.authMode",
        code: "provider_auth_mode_mismatch",
        providerAuthMode,
        serviceRequiredAuth
      }
      : null,
    deliveryGuarantee === "at-most-once" && normalizedRequestedCapabilities.includes("live-replay")
      ? {
        field: "provider.deliveryGuarantee",
        code: "live_replay_requires_replay_safe_delivery",
        deliveryGuarantee,
        required: ["at-least-once", "exactly-once"]
      }
      : null,
    ...missingEndpointKinds.map((kind) => ({
      field: `provider.endpoints.${kind}`,
      code: "provider_endpoint_not_ready",
      endpointKind: kind
    }))
  ].filter(Boolean);

  return {
    providerId,
    serviceId,
    protocol: "aios.auditRecovery.eventReplay.v1",
    serviceContract: {
      schemaVersion: "aios.auditRecovery.eventReplay.providerServiceContract.v1",
      supportedProtocolVersions: serviceProtocolVersions,
      providerProtocolVersions: normalizedProviderVersions,
      acceptedProtocolVersions: normalizedServiceVersions,
      negotiatedProtocolVersion,
      providerAuthMode,
      serviceRequiredAuth,
      deliveryGuarantee,
      endpointReadiness,
      requiredEndpointKinds,
      missingEndpointKinds,
      contractValid: contractErrors.length === 0
    },
    providerCapabilities: normalizedProviderCapabilities,
    requestedCapabilities: normalizedRequestedCapabilities,
    effectiveCapabilities,
    missingCapabilities: normalizedRequestedCapabilities.filter(
      (capability) => !normalizedProviderCapabilities.includes(capability)
    ),
    contractErrors
  };
}

function normalizeSyncMetadata(input = {}) {
  const sync = input.sync && typeof input.sync === "object" ? input.sync : {};
  const cursor = typeof sync.cursor === "string" && sync.cursor.trim() ? sync.cursor.trim() : null;
  const previousCursor = typeof sync.previousCursor === "string" && sync.previousCursor.trim()
    ? sync.previousCursor.trim()
    : null;
  const sourceEpoch = asPositiveInteger(sync.sourceEpoch, 1);
  const highWatermark = asPositiveInteger(sync.highWatermark, 0);
  const batchId = typeof sync.batchId === "string" && sync.batchId.trim()
    ? sync.batchId.trim()
    : `replay-${sourceEpoch}-${highWatermark}`;

  return {
    cursor,
    previousCursor,
    sourceEpoch,
    highWatermark,
    batchId,
    cursorChanged: cursor !== null && cursor !== previousCursor
  };
}

function normalizeStringList(value, limit = 20) {
  return Array.isArray(value)
    ? value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean)
      .slice(-limit)
    : [];
}

function normalizeDependencyHealth(dependency, index) {
  const candidate = dependency && typeof dependency === "object" ? dependency : {};
  const name = typeof candidate.name === "string" && candidate.name.trim()
    ? candidate.name.trim()
    : `dependency-${index + 1}`;
  const state = dependencyHealthStates.has(candidate.state) ? candidate.state : "unknown";
  const required = candidate.required === false ? false : true;
  const lastOkAt = typeof candidate.lastOkAt === "string" && candidate.lastOkAt.trim()
    ? candidate.lastOkAt.trim()
    : null;
  const errorCode = typeof candidate.errorCode === "string" && candidate.errorCode.trim()
    ? candidate.errorCode.trim()
    : state === "failed" || state === "missing"
      ? "dependency_unavailable"
      : null;

  return {
    name,
    state,
    required,
    lastOkAt,
    errorCode,
    message: typeof candidate.message === "string" && candidate.message.trim()
      ? candidate.message.trim()
      : null
  };
}

function calculateRetryBackoffMs(failureCount, retryPolicy) {
  const baseMs = asPositiveInteger(retryPolicy.baseMs, 1000);
  const maxMs = asPositiveInteger(retryPolicy.maxMs, 30000);
  const boundedFailures = Math.min(Math.max(failureCount - 1, 0), 8);
  return Math.min(baseMs * (2 ** boundedFailures), maxMs);
}

function normalizeRetryAfter(value) {
  const parsed = normalizeIsoTimestamp(value);
  return parsed;
}

function normalizeIsoTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const trimmed = value.trim();
  return Number.isFinite(Date.parse(trimmed)) ? new Date(Date.parse(trimmed)).toISOString() : null;
}

function normalizeScheduleWindow(value) {
  const candidate = value && typeof value === "object"
    ? value
    : typeof value === "string" && value.trim()
      ? { label: value.trim() }
      : {};
  const startAt = normalizeIsoTimestamp(candidate.startAt || candidate.startsAt || candidate.start);
  const endAt = normalizeIsoTimestamp(candidate.endAt || candidate.endsAt || candidate.end);
  const label = typeof candidate.label === "string" && candidate.label.trim()
    ? candidate.label.trim()
    : startAt && endAt
      ? `${startAt}/${endAt}`
      : null;
  const timezone = typeof candidate.timezone === "string" && candidate.timezone.trim()
    ? candidate.timezone.trim()
    : "UTC";
  const parsedStart = startAt ? Date.parse(startAt) : null;
  const parsedEnd = endAt ? Date.parse(endAt) : null;
  const errors = [];

  if ((candidate.startAt || candidate.startsAt || candidate.start) && !startAt) {
    errors.push({
      field: "settings.schedule.window.startAt",
      code: "invalid_schedule_window_start"
    });
  }

  if ((candidate.endAt || candidate.endsAt || candidate.end) && !endAt) {
    errors.push({
      field: "settings.schedule.window.endAt",
      code: "invalid_schedule_window_end"
    });
  }

  if (parsedStart !== null && parsedEnd !== null && parsedStart >= parsedEnd) {
    errors.push({
      field: "settings.schedule.window",
      code: "schedule_window_order_invalid"
    });
  }

  return {
    configured: Boolean(label || startAt || endAt),
    label,
    timezone,
    startAt,
    endAt,
    valid: errors.length === 0 && Boolean(label || (startAt && endAt)),
    errors
  };
}

function normalizeLifecycleTransition(input = {}) {
  const lifecycle = input.lifecycle && typeof input.lifecycle === "object" ? input.lifecycle : {};
  const settings = input.settings && typeof input.settings === "object" ? input.settings : {};
  const requested = lifecycle.requestedSettings && typeof lifecycle.requestedSettings === "object"
    ? lifecycle.requestedSettings
    : settings.lifecycle && typeof settings.lifecycle === "object"
      ? settings.lifecycle
      : {};
  const requestedSchedule = requested.schedule && typeof requested.schedule === "object"
    ? requested.schedule
    : {};
  const requestedReplay = requested.replay && typeof requested.replay === "object"
    ? requested.replay
    : {};
  const rawScheduleMode = typeof requestedSchedule.mode === "string" ? requestedSchedule.mode.trim() : null;
  const requestedScheduleMode = scheduleModes.has(rawScheduleMode) ? rawScheduleMode : null;
  const requestedIntervalMinutes = asPositiveInteger(requestedSchedule.intervalMinutes, null);
  const requestedWindow = normalizeScheduleWindow(requestedSchedule.window);
  const hasRequestedWindow = requestedWindow.configured;
  const requestedEnabled = typeof requested.enabled === "boolean" ? requested.enabled : null;
  const requestedDryRun = typeof requestedReplay.dryRun === "boolean" ? requestedReplay.dryRun : null;
  const requestedRequireProof = typeof requestedReplay.requireProof === "boolean" ? requestedReplay.requireProof : null;
  const rawRetentionMode = typeof requestedReplay.retentionMode === "string" ? requestedReplay.retentionMode.trim() : null;
  const requestedRetentionMode = retentionModes.has(rawRetentionMode) ? rawRetentionMode : null;
  const requestedMaxEventsPerRun = asPositiveInteger(requestedReplay.maxEventsPerRun, null);
  const reason = typeof lifecycle.reason === "string" && lifecycle.reason.trim()
    ? lifecycle.reason.trim()
    : typeof requested.reason === "string" && requested.reason.trim()
      ? requested.reason.trim()
      : null;
  const validationErrors = [
    rawScheduleMode && !requestedScheduleMode
      ? {
        field: "lifecycle.requestedSettings.schedule.mode",
        code: "unsupported_lifecycle_schedule_mode",
        allowed: Array.from(scheduleModes)
      }
      : null,
    requestedSchedule.window && !requestedWindow.valid
      ? {
        field: "lifecycle.requestedSettings.schedule.window",
        code: "invalid_lifecycle_schedule_window"
      }
      : null,
    rawRetentionMode && !requestedRetentionMode
      ? {
        field: "lifecycle.requestedSettings.replay.retentionMode",
        code: "unsupported_lifecycle_retention_mode",
        allowed: Array.from(retentionModes)
      }
      : null
  ].filter(Boolean);
  const changedFields = [
    requestedEnabled !== null ? "enabled" : null,
    requestedScheduleMode !== null ? "schedule.mode" : null,
    requestedIntervalMinutes !== null ? "schedule.intervalMinutes" : null,
    hasRequestedWindow ? "schedule.window" : null,
    requestedDryRun !== null ? "replay.dryRun" : null,
    requestedRequireProof !== null ? "replay.requireProof" : null,
    requestedRetentionMode !== null ? "replay.retentionMode" : null,
    requestedMaxEventsPerRun !== null ? "replay.maxEventsPerRun" : null
  ].filter(Boolean);

  return {
    schemaVersion: "aios.auditRecovery.eventReplay.lifecycleTransition.v1",
    requested: changedFields.length > 0,
    reason,
    changedFields,
    requestedSettings: {
      enabled: requestedEnabled,
      schedule: {
        mode: requestedScheduleMode,
        intervalMinutes: requestedIntervalMinutes,
        window: hasRequestedWindow ? requestedWindow : null
      },
      replay: {
        dryRun: requestedDryRun,
        requireProof: requestedRequireProof,
        retentionMode: requestedRetentionMode,
        maxEventsPerRun: requestedMaxEventsPerRun
      }
    },
    validationErrors
  };
}

function normalizeLifecycleControls(settings = {}) {
  const controls = settings.controls && typeof settings.controls === "object" ? settings.controls : {};
  const minIntervalMinutes = asPositiveInteger(controls.minIntervalMinutes, 5);
  const maxIntervalMinutes = asPositiveInteger(controls.maxIntervalMinutes, 10080);
  const lockedCommand = normalizeLifecycleCommand(controls.commandLock);
  const lockedControl = lockedCommand === "replay-now" ? "manualReplay" : lockedCommand;
  const commandControls = controls.commandLock && lifecycleCommands.has(lockedCommand)
    ? { ...lifecycleControlDefaults, [lockedControl]: false }
    : lifecycleControlDefaults;
  const maintenanceLock = asBoolean(controls.maintenanceLock, false);
  const lockReason = typeof controls.lockReason === "string" && controls.lockReason.trim()
    ? controls.lockReason.trim()
    : maintenanceLock
      ? "maintenance_lock_active"
      : null;

  return {
    schemaVersion: "aios.auditRecovery.eventReplay.lifecycleControls.v1",
    allowEnable: asBoolean(controls.allowEnable, commandControls.enable),
    allowDisable: asBoolean(controls.allowDisable, commandControls.disable),
    allowSchedule: asBoolean(controls.allowSchedule, commandControls.schedule),
    allowPause: asBoolean(controls.allowPause, commandControls.pause),
    allowResume: asBoolean(controls.allowResume, commandControls.resume),
    allowManualReplay: asBoolean(controls.allowManualReplay, commandControls.manualReplay),
    requireScheduleWindow: asBoolean(controls.requireScheduleWindow, false),
    maintenanceLock,
    lockReason,
    minIntervalMinutes,
    maxIntervalMinutes,
    minIntervalValid: minIntervalMinutes <= maxIntervalMinutes
  };
}

function normalizeOperationalHealth(input = {}, now, clientRuntime) {
  const health = input.health && typeof input.health === "object"
    ? input.health
    : input.operationalHealth && typeof input.operationalHealth === "object"
      ? input.operationalHealth
      : input.provider?.health && typeof input.provider.health === "object"
        ? input.provider.health
        : input.service?.health && typeof input.service.health === "object"
          ? input.service.health
          : {};
  const dependencies = Array.isArray(health.dependencies)
    ? health.dependencies.map(normalizeDependencyHealth).slice(0, 20)
    : [];
  const requiredFailures = dependencies.filter(
    (dependency) => dependency.required && (dependency.state === "failed" || dependency.state === "missing")
  );
  const degradedDependencies = dependencies.filter((dependency) => dependency.state === "degraded");
  const requestedStatus = operationalHealthStates.has(health.status) ? health.status : "unknown";
  const status = requiredFailures.length > 0
    ? "failed"
    : requestedStatus === "failed"
      ? "failed"
      : degradedDependencies.length > 0 || requestedStatus === "degraded"
        ? "degraded"
        : requestedStatus === "unknown" && dependencies.length === 0
          ? "ok"
          : requestedStatus;
  const failureCount = asPositiveInteger(health.failureCount, requiredFailures.length > 0 ? 1 : 0);
  const retryPolicy = health.retryPolicy && typeof health.retryPolicy === "object" ? health.retryPolicy : {};
  const maxAttempts = asPositiveInteger(retryPolicy.maxAttempts, 6);
  const retryBudgetExhausted = status === "failed" && failureCount >= maxAttempts;
  const retryable = health.retryable === false
    ? false
    : (status === "failed" || status === "degraded") && !retryBudgetExhausted;
  const backoffMs = retryable ? calculateRetryBackoffMs(failureCount, retryPolicy) : 0;
  const observedAt = typeof health.observedAt === "string" && health.observedAt.trim()
    ? health.observedAt.trim()
    : now;
  const nowEpoch = Number.isFinite(Date.parse(now)) ? Date.parse(now) : Date.now();
  const observedEpoch = Number.isFinite(Date.parse(observedAt)) ? Date.parse(observedAt) : nowEpoch;
  const staleAfterMs = asPositiveInteger(health.staleAfterMs, 300000);
  const stale = nowEpoch - observedEpoch > staleAfterMs;
  const explicitRetryAfter = normalizeRetryAfter(health.retryAfter || health.nextRetryAt);
  const nextRetryAt = retryable
    ? explicitRetryAfter || new Date(nowEpoch + backoffMs).toISOString()
    : null;
  const degradedModePolicy = degradedModePolicies.has(health.degradedModePolicy)
    ? health.degradedModePolicy
    : "allow-preview";
  const degradedModeAcknowledged = clientRuntime.acknowledgedWarnings.includes("operational_health_degraded")
    || clientRuntime.acknowledgedWarnings.includes("degraded_mode");
  const liveReplaySafe = status === "ok"
    || (
      status === "degraded"
      && degradedModePolicy === "require-ack"
      && degradedModeAcknowledged
    );
  const failureState = {
    schemaVersion: "aios.auditRecovery.eventReplay.operationalFailureState.v1",
    state: status === "failed"
      ? retryBudgetExhausted
        ? "failed-terminal"
        : "failed-retryable"
      : stale
        ? "stale"
        : status === "degraded"
          ? degradedModePolicy === "allow-preview"
            ? "degraded-preview-only"
            : degradedModePolicy === "block-live-replay"
              ? "degraded-live-blocked"
              : degradedModeAcknowledged
                ? "degraded-acknowledged"
                : "degraded-ack-required"
          : "healthy",
    stale,
    staleAfterMs,
    retryBudget: {
      failureCount,
      maxAttempts,
      exhausted: retryBudgetExhausted,
      attemptsRemaining: Math.max(maxAttempts - failureCount, 0)
    },
    canPreview: status !== "failed",
    canAccept: status === "ok" || status === "degraded",
    canDispatch: liveReplaySafe && !stale,
    degradedModeRequired: status === "degraded" && !liveReplaySafe,
    operatorAction: status === "failed"
      ? retryBudgetExhausted
        ? "Escalate hosted-kernel replay dependency recovery; retry budget is exhausted."
        : "Wait for the retry window or restore the failed replay dependency."
      : stale
        ? "Refresh hosted-kernel replay health before dispatching live replay."
        : status === "degraded"
          ? degradedModePolicy === "allow-preview"
            ? "Use dry-run preview until dependencies recover."
            : degradedModePolicy === "block-live-replay"
              ? "Wait for dependencies to recover before live replay."
              : degradedModeAcknowledged
                ? "Continue with acknowledged degraded mode."
                : "Acknowledge degraded mode before live replay."
          : "No operator action required."
  };
  const actionableErrors = [
    ...requiredFailures.map((dependency) => ({
      field: `health.dependencies.${dependency.name}`,
      code: dependency.errorCode || "dependency_unavailable",
      severity: "error",
      dependency: dependency.name,
      retryable,
      nextRetryAt,
      operatorAction: "Restore the required replay dependency before executing event replay."
    })),
    ...degradedDependencies.map((dependency) => ({
      field: `health.dependencies.${dependency.name}`,
      code: dependency.errorCode || "dependency_degraded",
      severity: "warning",
      dependency: dependency.name,
      retryable,
      nextRetryAt,
      operatorAction: "Acknowledge degraded mode or wait for this dependency to recover."
    }))
  ];

  if (stale) {
    actionableErrors.push({
      field: "health.observedAt",
      code: "operational_health_observation_stale",
      severity: status === "failed" ? "error" : "warning",
      retryable: true,
      nextRetryAt: now,
      operatorAction: "Refresh hosted-kernel replay health before dispatching event replay."
    });
  }

  if (retryBudgetExhausted) {
    actionableErrors.push({
      field: "health.retryPolicy.maxAttempts",
      code: "operational_health_retry_budget_exhausted",
      severity: "error",
      retryable: false,
      nextRetryAt: null,
      operatorAction: failureState.operatorAction
    });
  }

  if (status === "failed" && actionableErrors.length === 0) {
    actionableErrors.push({
      field: "health.status",
      code: "operational_health_failed",
      severity: "error",
      retryable,
      nextRetryAt,
      operatorAction: "Wait for hosted-kernel replay health to recover before continuing."
    });
  }

  return {
    schemaVersion: "aios.auditRecovery.eventReplay.operationalHealth.v1",
    status,
    observedAt,
    degradedModePolicy,
    degradedModeAcknowledged,
    dependencies,
    failureCount,
    failureState,
    retry: {
      retryable,
      backoffMs,
      nextRetryAt,
      maxAttempts,
      attemptsRemaining: failureState.retryBudget.attemptsRemaining,
      budgetExhausted: retryBudgetExhausted
    },
    actionableErrors,
    blocking: status === "failed" || (stale && status !== "ok")
  };
}

function buildCommandKey({ command, sync, clientRuntime, input }) {
  const explicitKey = typeof input.commandKey === "string" && input.commandKey.trim()
    ? input.commandKey.trim()
    : typeof input.lifecycleCommandId === "string" && input.lifecycleCommandId.trim()
      ? input.lifecycleCommandId.trim()
      : null;

  return explicitKey || [
    surfaceId,
    command,
    sync.batchId,
    sync.cursor || "no-cursor",
    clientRuntime.requestId || clientRuntime.workflowId
  ].join(":");
}

function normalizePersistedStatusJournal(rootState = {}, context = {}) {
  const candidates = Array.isArray(rootState.statusJournal)
    ? rootState.statusJournal
    : Array.isArray(rootState.journal)
      ? rootState.journal
      : [];

  return candidates
    .map((entry, index) => {
      const candidate = entry && typeof entry === "object" ? entry : {};
      const status = persistedReplayStates.has(candidate.status) ? candidate.status : "unknown";
      const observedAt = normalizeIsoTimestamp(candidate.observedAt || candidate.at || candidate.statusSince)
        || context.now
        || null;
      const commandKey = typeof candidate.commandKey === "string" && candidate.commandKey.trim()
        ? candidate.commandKey.trim()
        : null;
      const batchId = typeof candidate.batchId === "string" && candidate.batchId.trim()
        ? candidate.batchId.trim()
        : null;
      const cursor = typeof candidate.cursor === "string" && candidate.cursor.trim()
        ? candidate.cursor.trim()
        : null;

      if (status === "unknown" && !observedAt && !commandKey && !batchId && !cursor) {
        return null;
      }

      return {
        sequence: asPositiveInteger(candidate.sequence, index + 1),
        status,
        observedAt,
        command: normalizeLifecycleCommand(candidate.command),
        commandKey,
        batchId,
        cursor,
        restartDetected: asBoolean(candidate.restartDetected, false),
        duplicateCommand: asBoolean(candidate.duplicateCommand, false)
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.sequence - right.sequence)
    .slice(-12);
}

function normalizeReplayLease(rootState = {}, now) {
  const lease = rootState.lease && typeof rootState.lease === "object"
    ? rootState.lease
    : rootState.recoveryLease && typeof rootState.recoveryLease === "object"
      ? rootState.recoveryLease
      : {};
  const owner = typeof lease.owner === "string" && lease.owner.trim() ? lease.owner.trim() : null;
  const token = typeof lease.token === "string" && lease.token.trim() ? lease.token.trim() : null;
  const acquiredAt = normalizeIsoTimestamp(lease.acquiredAt);
  const expiresAt = normalizeIsoTimestamp(lease.expiresAt);
  const nowEpoch = Number.isFinite(Date.parse(now)) ? Date.parse(now) : Date.now();
  const expired = expiresAt !== null && Date.parse(expiresAt) <= nowEpoch;

  return {
    schemaVersion: "aios.auditRecovery.eventReplay.recoveryLease.v1",
    present: Boolean(owner || token || acquiredAt || expiresAt),
    owner,
    token,
    acquiredAt,
    expiresAt,
    expired,
    reclaimable: !owner || expired
  };
}

function normalizePersistedReplayState(input = {}, context) {
  const rootState = input.persistedState && typeof input.persistedState === "object"
    ? input.persistedState
    : input.state && typeof input.state === "object"
      ? input.state.eventReplay && typeof input.state.eventReplay === "object"
        ? input.state.eventReplay
        : input.state
      : {};
  const statusJournal = normalizePersistedStatusJournal(rootState, context);
  const journalLatest = statusJournal.at(-1);
  const status = persistedReplayStates.has(rootState.status)
    ? rootState.status
    : persistedReplayStates.has(journalLatest?.status)
      ? journalLatest.status
      : "unknown";
  const processedCommandKeys = normalizeStringList(rootState.processedCommandKeys);
  const commandKey = buildCommandKey({ ...context, input });
  const duplicateCommand = idempotentLifecycleCommands.has(context.command)
    && processedCommandKeys.includes(commandKey);
  const persistedCursor = typeof rootState.cursor === "string" && rootState.cursor.trim()
    ? rootState.cursor.trim()
    : null;
  const persistedBatchId = typeof rootState.batchId === "string" && rootState.batchId.trim()
    ? rootState.batchId.trim()
    : null;
  const statusSince = typeof rootState.statusSince === "string" && rootState.statusSince.trim()
    ? rootState.statusSince.trim()
    : null;
  const lastAppliedAt = typeof rootState.lastAppliedAt === "string" && rootState.lastAppliedAt.trim()
    ? rootState.lastAppliedAt.trim()
    : null;
  const restartDetected = asBoolean(input.restartDetected, false)
    || asBoolean(rootState.restartDetected, false)
    || (restartRecoverableStates.has(status) && persistedBatchId === context.sync.batchId);
  const commandKeyMatchesLast = rootState.lastCommandKey === commandKey || journalLatest?.commandKey === commandKey;
  const commandKeyReusedForDifferentBatch = commandKeyMatchesLast
    && persistedBatchId !== null
    && persistedBatchId !== context.sync.batchId;
  const pendingOperationIds = normalizeStringList(
    rootState.pendingOperationIds || rootState.inFlightOperationIds,
    100
  );
  const lease = normalizeReplayLease(rootState, context.now);

  return {
    schemaVersion: "aios.auditRecovery.eventReplay.persistedState.v1",
    commandKey,
    duplicateCommand,
    commandKeyMatchesLast,
    commandKeyReusedForDifferentBatch,
    restartDetected,
    lease,
    previous: {
      status,
      statusSince,
      cursor: persistedCursor,
      batchId: persistedBatchId,
      lastCommand: typeof rootState.lastCommand === "string" ? rootState.lastCommand : null,
      lastCommandKey: typeof rootState.lastCommandKey === "string" ? rootState.lastCommandKey : null,
      lastAppliedAt,
      processedCommandKeys,
      statusJournal,
      pendingOperationIds,
      terminal: terminalReplayStates.has(status),
      journalLatestStatus: journalLatest?.status || null
    },
    recoveryHint: restartDetected
      ? status === "running"
        ? lease.reclaimable
          ? "claim-and-resume-running-batch"
          : "wait-for-active-replay-lease"
        : status === "failed"
          ? "inspect-failed-batch"
          : "resolve-blocked-batch"
      : commandKeyReusedForDifferentBatch
        ? "reject-command-key-batch-conflict"
      : duplicateCommand
        ? "return-existing-status"
        : "apply-command"
  };
}

function normalizeExternalHandoff(input = {}) {
  const handoff = input.handoff && typeof input.handoff === "object" ? input.handoff : {};
  const requested = asBoolean(handoff.requested, false);
  const state = handoffStates.has(handoff.state) ? handoff.state : requested ? "pending" : "none";
  const target = typeof handoff.target === "string" && handoff.target.trim()
    ? handoff.target.trim()
    : null;
  const reference = typeof handoff.reference === "string" && handoff.reference.trim()
    ? handoff.reference.trim()
    : null;
  const targetTenantId = typeof handoff.targetTenantId === "string" && handoff.targetTenantId.trim()
    ? handoff.targetTenantId.trim()
    : typeof handoff.tenantId === "string" && handoff.tenantId.trim()
      ? handoff.tenantId.trim()
      : null;

  return {
    requested,
    state,
    target,
    reference,
    targetTenantId,
    transferable: requested && state !== "blocked" && target !== null
  };
}

function normalizeProviderReceipt(input = {}, context = {}) {
  const provider = input.provider && typeof input.provider === "object" ? input.provider : {};
  const service = input.service && typeof input.service === "object" ? input.service : {};
  const receipt = input.providerReceipt && typeof input.providerReceipt === "object"
    ? input.providerReceipt
    : provider.receipt && typeof provider.receipt === "object"
      ? provider.receipt
      : service.providerReceipt && typeof service.providerReceipt === "object"
        ? service.providerReceipt
        : {};
  const present = Object.keys(receipt).length > 0;
  const state = providerReceiptStates.has(receipt.state)
    ? receipt.state
    : present
      ? "pending"
      : "none";
  const kind = providerReceiptKinds.has(receipt.kind)
    ? receipt.kind
    : context.handoff?.requested
      ? "handoff"
      : "status";
  const receiptBatchId = typeof receipt.batchId === "string" && receipt.batchId.trim()
    ? receipt.batchId.trim()
    : null;
  const receiptCursor = typeof receipt.cursor === "string" && receipt.cursor.trim()
    ? receipt.cursor.trim()
    : null;
  const receiptReference = typeof receipt.reference === "string" && receipt.reference.trim()
    ? receipt.reference.trim()
    : typeof receipt.handoffReference === "string" && receipt.handoffReference.trim()
      ? receipt.handoffReference.trim()
      : null;
  const externalTicketId = typeof receipt.externalTicketId === "string" && receipt.externalTicketId.trim()
    ? receipt.externalTicketId.trim()
    : typeof receipt.ticketId === "string" && receipt.ticketId.trim()
      ? receipt.ticketId.trim()
      : null;
  const acknowledgedAt = normalizeIsoTimestamp(receipt.acknowledgedAt || receipt.receivedAt);
  const expiresAt = normalizeIsoTimestamp(receipt.expiresAt);
  const nowEpoch = Number.isFinite(Date.parse(context.now)) ? Date.parse(context.now) : Date.now();
  const expired = state === "expired" || (expiresAt !== null && Date.parse(expiresAt) <= nowEpoch);
  const matchesBatch = !receiptBatchId || receiptBatchId === context.sync?.batchId;
  const matchesCursor = !receiptCursor || receiptCursor === context.sync?.cursor;
  const matchesHandoff = !context.handoff?.reference
    || !receiptReference
    || receiptReference === context.handoff.reference;
  const requiredReasons = [
    context.sync?.cursorChanged ? "sync-cursor-advance" : null,
    context.handoff?.state === "accepted" ? "accepted-external-handoff" : null
  ].filter(Boolean);
  const acknowledged = state === "acknowledged" && !expired && matchesBatch && matchesCursor && matchesHandoff;

  return {
    schemaVersion: "aios.auditRecovery.eventReplay.providerReceipt.v1",
    present,
    state: expired ? "expired" : state,
    kind,
    providerId: context.providerContract?.providerId || "hosted-kernel",
    serviceId: context.providerContract?.serviceId || "audit-recovery-event-replay",
    batchId: receiptBatchId,
    cursor: receiptCursor,
    reference: receiptReference,
    externalTicketId,
    acknowledgedAt,
    expiresAt,
    matchesBatch,
    matchesCursor,
    matchesHandoff,
    required: requiredReasons.length > 0,
    requiredReasons,
    acknowledged,
    handoffAccepted: context.handoff?.state === "accepted" ? acknowledged : null,
    syncCursorAcknowledged: context.sync?.cursorChanged ? acknowledged : null
  };
}

function normalizeWorkspaceBoundary(input = {}, context = {}) {
  const workspace = input.workspace && typeof input.workspace === "object" ? input.workspace : {};
  const tenant = input.tenant && typeof input.tenant === "object" ? input.tenant : {};
  const request = input.request && typeof input.request === "object" ? input.request : {};
  const client = input.client && typeof input.client === "object" ? input.client : {};
  const boundary = input.boundary && typeof input.boundary === "object" ? input.boundary : {};
  const workspaceId = typeof workspace.id === "string" && workspace.id.trim()
    ? workspace.id.trim()
    : typeof request.workspaceId === "string" && request.workspaceId.trim()
      ? request.workspaceId.trim()
      : "default";
  const tenantId = typeof tenant.id === "string" && tenant.id.trim()
    ? tenant.id.trim()
    : typeof workspace.tenantId === "string" && workspace.tenantId.trim()
      ? workspace.tenantId.trim()
      : typeof request.tenantId === "string" && request.tenantId.trim()
        ? request.tenantId.trim()
        : "default";
  const isolationMode = tenantIsolationModes.has(boundary.isolationMode)
    ? boundary.isolationMode
    : tenantIsolationModes.has(workspace.isolationMode)
      ? workspace.isolationMode
      : "strict";
  const allowedWorkspaceIds = normalizeStringList(
    boundary.allowedWorkspaceIds || request.allowedWorkspaceIds || client.allowedWorkspaceIds,
    50
  );
  const allowedTenantIds = normalizeStringList(
    boundary.allowedTenantIds || request.allowedTenantIds || client.allowedTenantIds,
    50
  );
  const rawRoles = normalizeStringList(request.roles || client.roles || boundary.roles, 20)
    .filter((role) => replayRoles.has(role));
  const explicitPermissions = normalizeStringList(
    request.permissions || client.permissions || boundary.permissions,
    50
  ).filter((permission) => replayPermissions.has(permission));
  const roles = rawRoles.length === 0 && explicitPermissions.length === 0
    ? ["auditor"]
    : rawRoles;
  const grantedPermissions = Array.from(new Set([
    ...roles.flatMap((role) => rolePermissionGrants[role] || []),
    ...explicitPermissions
  ]));
  const requiredPermissions = Array.from(new Set([
    ...(commandPermissionRequirements[context.command] || commandPermissionRequirements.inspect),
    context.handoff?.requested ? "audit-replay:handoff" : null,
    context.settings?.replay?.dryRun === false ? "audit-replay:execute" : null,
    context.handoff?.targetTenantId && context.handoff.targetTenantId !== tenantId
      ? "audit-replay:tenant-crossing"
      : null
  ].filter(Boolean)));
  const workspaceAllowed = allowedWorkspaceIds.length === 0 || allowedWorkspaceIds.includes(workspaceId);
  const tenantAllowed = allowedTenantIds.length === 0 || allowedTenantIds.includes(tenantId);
  const crossTenantHandoff = context.handoff?.targetTenantId
    ? context.handoff.targetTenantId !== tenantId
    : false;
  const permissionGaps = requiredPermissions.filter((permission) => !grantedPermissions.includes(permission));
  const boundaryErrors = [];

  if (!workspaceAllowed) {
    boundaryErrors.push({
      field: "workspace.id",
      code: "workspace_scope_not_allowed",
      workspaceId,
      allowedWorkspaceIds
    });
  }

  if (!tenantAllowed) {
    boundaryErrors.push({
      field: "tenant.id",
      code: "tenant_scope_not_allowed",
      tenantId,
      allowedTenantIds
    });
  }

  if (isolationMode === "strict" && crossTenantHandoff && !grantedPermissions.includes("audit-replay:tenant-crossing")) {
    boundaryErrors.push({
      field: "handoff.targetTenantId",
      code: "cross_tenant_handoff_requires_permission",
      sourceTenantId: tenantId,
      targetTenantId: context.handoff.targetTenantId
    });
  }

  for (const permission of permissionGaps) {
    boundaryErrors.push({
      field: "request.permissions",
      code: "permission_required",
      permission
    });
  }

  return {
    schemaVersion: "aios.auditRecovery.eventReplay.workspaceBoundary.v1",
    workspaceId,
    tenantId,
    isolationMode,
    allowedWorkspaceIds,
    allowedTenantIds,
    roles,
    permissions: grantedPermissions,
    requiredPermissions,
    missingPermissions: permissionGaps,
    crossTenantHandoff,
    authorized: boundaryErrors.length === 0,
    boundaryErrors
  };
}

function normalizeClientRuntimeState(input = {}) {
  const client = input.client && typeof input.client === "object" ? input.client : {};
  const request = input.request && typeof input.request === "object" ? input.request : {};
  const continuation = request.continuation && typeof request.continuation === "object"
    ? request.continuation
    : client.continuation && typeof client.continuation === "object"
      ? client.continuation
      : {};
  const requestId = typeof request.id === "string" && request.id.trim()
    ? request.id.trim()
    : typeof client.requestId === "string" && client.requestId.trim()
      ? client.requestId.trim()
      : null;
  const actorId = typeof request.actorId === "string" && request.actorId.trim()
    ? request.actorId.trim()
    : typeof client.actorId === "string" && client.actorId.trim()
      ? client.actorId.trim()
      : "operator";
  const intent = clientIntentKinds.has(request.intent)
    ? request.intent
    : clientIntentKinds.has(client.intent)
      ? client.intent
      : "inspect";
  const displayMode = clientDisplayModes.has(client.displayMode) ? client.displayMode : "guided";
  const returnRoute = typeof client.returnRoute === "string" && client.returnRoute.trim()
    ? client.returnRoute.trim()
    : typeof request.returnRoute === "string" && request.returnRoute.trim()
      ? request.returnRoute.trim()
      : "audit-recovery";
  const callbackUrl = typeof continuation.callbackUrl === "string" && continuation.callbackUrl.trim()
    ? continuation.callbackUrl.trim()
    : typeof continuation.url === "string" && continuation.url.trim()
      ? continuation.url.trim()
      : null;
  const callbackMethod = typeof continuation.callbackMethod === "string" && continuation.callbackMethod.trim()
    ? continuation.callbackMethod.trim().toUpperCase()
    : "POST";
  const requestedMode = typeof continuation.mode === "string" ? continuation.mode.trim() : null;
  const continuationMode = clientContinuationModes.has(requestedMode)
    ? requestedMode
    : callbackUrl
      ? "callback"
      : client.interactive === false
        ? "deferred"
        : "route";
  const requestedAction = typeof continuation.action === "string" ? continuation.action.trim() : null;
  const preferredAction = clientContinuationActions.has(requestedAction)
    ? requestedAction
    : intent === "handoff"
      ? "handoff"
      : intent === "execute"
        ? "dispatch"
        : intent === "preview"
          ? "preview"
          : "status";
  const stateToken = typeof continuation.stateToken === "string" && continuation.stateToken.trim()
    ? continuation.stateToken.trim()
    : typeof request.stateToken === "string" && request.stateToken.trim()
      ? request.stateToken.trim()
      : null;
  const workflowId = typeof client.workflowId === "string" && client.workflowId.trim()
    ? client.workflowId.trim()
    : requestId
      ? `event-replay:${requestId}`
      : "event-replay:local";
  const acknowledgedWarnings = Array.isArray(client.acknowledgedWarnings)
    ? client.acknowledgedWarnings
      .map((warning) => (typeof warning === "string" ? warning.trim() : ""))
      .filter(Boolean)
    : [];

  return {
    requestId,
    actorId,
    intent,
    displayMode,
    returnRoute,
    workflowId,
    acknowledgedWarnings,
    interactive: client.interactive === false ? false : true,
    continuation: {
      schemaVersion: "aios.auditRecovery.eventReplay.clientContinuation.v1",
      mode: continuationMode,
      preferredAction,
      callbackUrl,
      callbackMethod,
      stateToken,
      requireOperatorAck: asBoolean(continuation.requireOperatorAck, false),
      includeProofPackage: asBoolean(continuation.includeProofPackage, true),
      includeHostedKernelInvocation: asBoolean(continuation.includeHostedKernelInvocation, true),
      returnRoute,
      routeSuffix: typeof continuation.routeSuffix === "string" && continuation.routeSuffix.trim()
        ? continuation.routeSuffix.trim().replace(/^\/+/, "")
        : "event-replay"
    }
  };
}

function normalizeSettings(input = {}) {
  const settings = input.settings && typeof input.settings === "object" ? input.settings : {};
  const replaySettings = settings.replay && typeof settings.replay === "object" ? settings.replay : {};
  const scheduleSettings = settings.schedule && typeof settings.schedule === "object" ? settings.schedule : {};
  const validationErrors = [];
  const lifecycleControls = normalizeLifecycleControls(settings);
  const lifecycleTransition = normalizeLifecycleTransition(input);
  const scheduleWindow = normalizeScheduleWindow(scheduleSettings.window);

  const retentionMode = retentionModes.has(replaySettings.retentionMode)
    ? replaySettings.retentionMode
    : "balanced";
  const maxEventsPerRun = asPositiveInteger(replaySettings.maxEventsPerRun, 250);
  const requireProof = asBoolean(replaySettings.requireProof, true);
  const dryRun = asBoolean(replaySettings.dryRun, true);
  const scheduleMode = scheduleModes.has(scheduleSettings.mode) ? scheduleSettings.mode : "manual";
  const intervalMinutes = asPositiveInteger(scheduleSettings.intervalMinutes, 60);
  const enabled = asBoolean(settings.enabled, false);

  if (replaySettings.retentionMode && !retentionModes.has(replaySettings.retentionMode)) {
    validationErrors.push({
      field: "settings.replay.retentionMode",
      code: "unsupported_retention_mode",
      allowed: Array.from(retentionModes)
    });
  }

  if (scheduleSettings.mode && !scheduleModes.has(scheduleSettings.mode)) {
    validationErrors.push({
      field: "settings.schedule.mode",
      code: "unsupported_schedule_mode",
      allowed: Array.from(scheduleModes)
    });
  }

  if (scheduleMode === "interval" && intervalMinutes < 5) {
    validationErrors.push({
      field: "settings.schedule.intervalMinutes",
      code: "interval_too_short",
      minimum: 5
    });
  }

  if (intervalMinutes < lifecycleControls.minIntervalMinutes) {
    validationErrors.push({
      field: "settings.schedule.intervalMinutes",
      code: "interval_below_lifecycle_minimum",
      minimum: lifecycleControls.minIntervalMinutes
    });
  }

  if (intervalMinutes > lifecycleControls.maxIntervalMinutes) {
    validationErrors.push({
      field: "settings.schedule.intervalMinutes",
      code: "interval_above_lifecycle_maximum",
      maximum: lifecycleControls.maxIntervalMinutes
    });
  }

  if (!lifecycleControls.minIntervalValid) {
    validationErrors.push({
      field: "settings.controls.maxIntervalMinutes",
      code: "lifecycle_interval_bounds_invalid",
      minimum: lifecycleControls.minIntervalMinutes,
      maximum: lifecycleControls.maxIntervalMinutes
    });
  }

  validationErrors.push(...scheduleWindow.errors);
  validationErrors.push(...lifecycleTransition.validationErrors);

  if (scheduleMode === "window" && !scheduleWindow.valid) {
    validationErrors.push({
      field: "settings.schedule.window",
      code: "window_schedule_requires_valid_window"
    });
  }

  if (lifecycleControls.requireScheduleWindow && scheduleMode !== "manual" && !scheduleWindow.valid) {
    validationErrors.push({
      field: "settings.controls.requireScheduleWindow",
      code: "schedule_window_required_by_lifecycle_controls"
    });
  }

  if (
    lifecycleTransition.requestedSettings.schedule.intervalMinutes !== null
    && lifecycleTransition.requestedSettings.schedule.intervalMinutes < lifecycleControls.minIntervalMinutes
  ) {
    validationErrors.push({
      field: "lifecycle.requestedSettings.schedule.intervalMinutes",
      code: "lifecycle_requested_interval_below_minimum",
      minimum: lifecycleControls.minIntervalMinutes
    });
  }

  if (
    lifecycleTransition.requestedSettings.schedule.intervalMinutes !== null
    && lifecycleTransition.requestedSettings.schedule.intervalMinutes > lifecycleControls.maxIntervalMinutes
  ) {
    validationErrors.push({
      field: "lifecycle.requestedSettings.schedule.intervalMinutes",
      code: "lifecycle_requested_interval_above_maximum",
      maximum: lifecycleControls.maxIntervalMinutes
    });
  }

  if (
    lifecycleControls.requireScheduleWindow
    && lifecycleTransition.requestedSettings.schedule.mode
    && lifecycleTransition.requestedSettings.schedule.mode !== "manual"
    && !lifecycleTransition.requestedSettings.schedule.window?.valid
    && !scheduleWindow.valid
  ) {
    validationErrors.push({
      field: "lifecycle.requestedSettings.schedule.window",
      code: "lifecycle_requested_schedule_window_required"
    });
  }

  return {
    normalized: {
      enabled,
      replay: { retentionMode, maxEventsPerRun, requireProof, dryRun },
      lifecycleControls,
      lifecycleTransition,
      schedule: {
        mode: scheduleMode,
        intervalMinutes,
        window: scheduleWindow.label,
        windowPolicy: scheduleWindow
      }
    },
    validationErrors
  };
}

function evaluateLifecycleControl(command, settings) {
  const controls = settings.lifecycleControls || normalizeLifecycleControls({});
  const deniedByCommand = command === "enable" && !controls.allowEnable
    ? "enable_disabled_by_lifecycle_controls"
    : command === "disable" && !controls.allowDisable
      ? "disable_disabled_by_lifecycle_controls"
      : command === "schedule" && !controls.allowSchedule
        ? "schedule_disabled_by_lifecycle_controls"
        : command === "pause" && !controls.allowPause
          ? "pause_disabled_by_lifecycle_controls"
          : command === "resume" && !controls.allowResume
            ? "resume_disabled_by_lifecycle_controls"
            : command === "replay-now" && !controls.allowManualReplay
              ? "manual_replay_disabled_by_lifecycle_controls"
              : null;
  const deniedByMaintenance = controls.maintenanceLock && command !== "inspect" && command !== "disable"
    ? controls.lockReason || "maintenance_lock_active"
    : null;
  const denialCode = deniedByMaintenance || deniedByCommand;

  return {
    allowed: denialCode === null,
    denialCode,
    operatorAction: denialCode
      ? command === "replay-now"
        ? "Enable manual replay controls before requesting a replay run."
        : "Update lifecycle controls or use inspect until the lock is released."
      : null
  };
}

function applyLifecycleTransition(nextSettings, transition, command, controlEvents) {
  const requested = transition?.requestedSettings;
  if (!transition?.requested || !requested) {
    return [];
  }

  const appliedFields = [];
  const applyField = (field, value, writer) => {
    if (value === null || value === undefined) {
      return;
    }
    writer(value);
    appliedFields.push(field);
  };

  if (command === "enable" || command === "resume" || command === "schedule") {
    applyField("enabled", requested.enabled, (value) => {
      nextSettings.enabled = value;
    });
  }

  applyField("replay.dryRun", requested.replay.dryRun, (value) => {
    nextSettings.replay.dryRun = value;
  });
  applyField("replay.requireProof", requested.replay.requireProof, (value) => {
    nextSettings.replay.requireProof = value;
  });
  applyField("replay.retentionMode", requested.replay.retentionMode, (value) => {
    nextSettings.replay.retentionMode = value;
  });
  applyField("replay.maxEventsPerRun", requested.replay.maxEventsPerRun, (value) => {
    nextSettings.replay.maxEventsPerRun = value;
  });

  if (command === "schedule") {
    applyField("schedule.mode", requested.schedule.mode, (value) => {
      nextSettings.schedule.mode = value;
    });
    applyField("schedule.intervalMinutes", requested.schedule.intervalMinutes, (value) => {
      nextSettings.schedule.intervalMinutes = value;
    });
    if (requested.schedule.window?.valid) {
      nextSettings.schedule.window = requested.schedule.window.label;
      nextSettings.schedule.windowPolicy = requested.schedule.window;
      appliedFields.push("schedule.window");
    }
  }

  if (appliedFields.length > 0) {
    controlEvents.push("event_replay_lifecycle_settings_applied");
  }

  return appliedFields;
}

function applyLifecycleCommand(command, settings, now, persistedState = null) {
  const nextSettings = {
    ...settings,
    replay: { ...settings.replay },
    schedule: { ...settings.schedule },
    lifecycleControls: { ...settings.lifecycleControls }
  };
  const controlEvents = [];
  const controlDecision = evaluateLifecycleControl(command, settings);
  const transition = settings.lifecycleTransition;

  if (persistedState?.duplicateCommand) {
    return {
      settings: nextSettings,
      controlEvents: ["event_replay_duplicate_command_ignored"],
      lifecycleAppliedAt: persistedState.previous.lastAppliedAt || now,
      idempotentReplay: true,
      commandKey: persistedState.commandKey,
      controlDecision,
      appliedLifecycleFields: [],
      lifecycleTransition: transition
    };
  }

  if (!controlDecision.allowed) {
    return {
      settings: nextSettings,
      controlEvents: ["event_replay_lifecycle_command_denied"],
      lifecycleAppliedAt: now,
      idempotentReplay: false,
      commandKey: persistedState?.commandKey || null,
      controlDecision,
      appliedLifecycleFields: [],
      lifecycleTransition: transition
    };
  }

  const appliedLifecycleFields = [];

  if (command === "enable") {
    nextSettings.enabled = true;
    controlEvents.push("event_replay_enabled");
  } else if (command === "disable") {
    nextSettings.enabled = false;
    nextSettings.schedule.mode = "manual";
    controlEvents.push("event_replay_disabled", "event_replay_schedule_cleared");
  } else if (command === "schedule") {
    nextSettings.enabled = true;
    if (nextSettings.schedule.mode === "manual") {
      nextSettings.schedule.mode = "interval";
    }
    controlEvents.push("event_replay_scheduled");
  } else if (command === "pause") {
    nextSettings.enabled = false;
    controlEvents.push("event_replay_paused");
  } else if (command === "resume") {
    nextSettings.enabled = true;
    controlEvents.push("event_replay_resumed");
  } else if (command === "replay-now") {
    nextSettings.enabled = true;
    nextSettings.schedule.mode = "manual";
    controlEvents.push("event_replay_manual_run_requested");
  } else {
    controlEvents.push("event_replay_inspected");
  }

  appliedLifecycleFields.push(...applyLifecycleTransition(nextSettings, transition, command, controlEvents));

  return {
    settings: nextSettings,
    controlEvents,
    lifecycleAppliedAt: now,
    idempotentReplay: false,
    commandKey: persistedState?.commandKey || null,
    controlDecision,
    appliedLifecycleFields,
    lifecycleTransition: transition
  };
}

function derivePersistedRecoveryPath({
  lifecycle,
  nextAction,
  readiness,
  acceptance,
  persistedState,
  providerReceipt,
  operationalHealth
}) {
  if (persistedState.commandKeyReusedForDifferentBatch) {
    return {
      path: "command-key-conflict",
      statusOverride: "blocked",
      restartSafe: false,
      mutationAllowed: false,
      providerStatusRequired: true,
      operatorAction: "Use a new command key for this replay batch before mutating persisted replay state."
    };
  }

  if (persistedState.duplicateCommand) {
    return {
      path: "idempotent-status-return",
      statusOverride: persistedState.previous.status === "unknown" ? readiness.state : persistedState.previous.status,
      restartSafe: true,
      mutationAllowed: false,
      providerStatusRequired: false,
      operatorAction: "Return the previously persisted replay status without reapplying the command."
    };
  }

  if (!persistedState.restartDetected) {
    return {
      path: "fresh-command",
      statusOverride: null,
      restartSafe: true,
      mutationAllowed: lifecycle.controlDecision.allowed,
      providerStatusRequired: false,
      operatorAction: lifecycle.controlDecision.allowed
        ? "Apply command and persist the resulting replay state."
        : "Keep prior persisted replay state because lifecycle controls denied the command."
    };
  }

  if (!persistedState.lease.reclaimable) {
    return {
      path: "active-lease-observed",
      statusOverride: "waiting",
      restartSafe: true,
      mutationAllowed: false,
      providerStatusRequired: true,
      operatorAction: "Poll provider status and wait for the active replay lease to expire or complete."
    };
  }

  if (persistedState.previous.status === "running") {
    const acknowledged = providerReceipt?.acknowledged === true;
    return {
      path: acknowledged ? "running-batch-confirmed" : "claim-running-batch",
      statusOverride: acknowledged
        ? "completed"
        : operationalHealth?.status === "failed"
          ? "failed"
          : acceptance.accepted
            ? "running"
            : "blocked",
      restartSafe: acknowledged || operationalHealth?.status !== "failed",
      mutationAllowed: acknowledged || acceptance.accepted,
      providerStatusRequired: !acknowledged,
      operatorAction: acknowledged
        ? "Persist provider acknowledgement as the recovered terminal replay status."
        : "Claim the expired running replay lease and resume from persisted checkpoints."
    };
  }

  if (persistedState.previous.status === "failed") {
    return {
      path: operationalHealth?.retry?.retryable ? "retry-failed-batch" : "failed-batch-terminal",
      statusOverride: operationalHealth?.retry?.retryable ? "scheduled" : "failed",
      restartSafe: operationalHealth?.retry?.retryable === true,
      mutationAllowed: operationalHealth?.retry?.retryable === true,
      providerStatusRequired: true,
      operatorAction: operationalHealth?.retry?.retryable
        ? "Schedule a retry from the persisted failure checkpoint."
        : "Keep failed status and require operator recovery before replay resumes."
    };
  }

  if (persistedState.previous.status === "blocked") {
    return {
      path: nextAction.state === "blocked" ? "blocked-batch-still-blocked" : "blocked-batch-unblocked",
      statusOverride: nextAction.state === "blocked" ? "blocked" : readiness.state,
      restartSafe: nextAction.state !== "blocked",
      mutationAllowed: nextAction.state !== "blocked",
      providerStatusRequired: false,
      operatorAction: nextAction.state === "blocked"
        ? "Resolve the persisted replay blocker before resuming."
        : "Persist the unblocked replay state and continue the recovered workflow."
    };
  }

  return {
    path: terminalReplayStates.has(persistedState.previous.status) ? "terminal-status-return" : "restart-inspect",
    statusOverride: terminalReplayStates.has(persistedState.previous.status) ? persistedState.previous.status : readiness.state,
    restartSafe: true,
    mutationAllowed: !terminalReplayStates.has(persistedState.previous.status),
    providerStatusRequired: false,
    operatorAction: terminalReplayStates.has(persistedState.previous.status)
      ? "Return the terminal persisted replay status."
      : "Inspect and persist the latest replay status after restart."
  };
}

function buildPersistedReplayState({
  command,
  lifecycle,
  sync,
  nextAction,
  readiness,
  acceptance,
  persistedState,
  providerReceipt,
  operationalHealth,
  now
}) {
  const recoveryPath = derivePersistedRecoveryPath({
    lifecycle,
    nextAction,
    readiness,
    acceptance,
    persistedState,
    providerReceipt,
    operationalHealth
  });
  const nextStatus = persistedState.duplicateCommand
    ? persistedState.previous.status === "unknown"
      ? readiness.state
      : persistedState.previous.status
    : recoveryPath.statusOverride || readiness.state;
  const processedCommandKeys = persistedState.duplicateCommand || !recoveryPath.mutationAllowed
    ? persistedState.previous.processedCommandKeys
    : [...persistedState.previous.processedCommandKeys, persistedState.commandKey].slice(-20);
  const cursorStable = persistedState.previous.cursor === null || persistedState.previous.cursor === sync.cursor;
  const batchStable = persistedState.previous.batchId === null || persistedState.previous.batchId === sync.batchId;
  const restartStatus = persistedState.restartDetected
    ? persistedState.previous.status === "running" && acceptance.accepted
      ? "resumable"
      : nextAction.state === "blocked"
        ? "operator-required"
        : "recovered"
    : "not-restarted";

  return {
    schemaVersion: persistedState.schemaVersion,
    status: nextStatus,
    statusSince: persistedState.previous.status === nextStatus && persistedState.previous.statusSince
      ? persistedState.previous.statusSince
      : now,
    cursor: sync.cursor,
    batchId: sync.batchId,
    highWatermark: sync.highWatermark,
    lastCommand: command,
    lastCommandKey: persistedState.commandKey,
    lastAppliedAt: lifecycle.lifecycleAppliedAt,
    processedCommandKeys,
    idempotency: {
      commandKey: persistedState.commandKey,
      duplicateCommand: persistedState.duplicateCommand,
      ignoredMutation: lifecycle.idempotentReplay,
      mutationAllowed: recoveryPath.mutationAllowed,
      retainedStatus: persistedState.duplicateCommand
    },
    restart: {
      detected: persistedState.restartDetected,
      status: restartStatus,
      recoveryHint: persistedState.recoveryHint,
      recoveryPath: recoveryPath.path,
      restartSafe: recoveryPath.restartSafe,
      providerStatusRequired: recoveryPath.providerStatusRequired,
      operatorAction: recoveryPath.operatorAction,
      cursorStable,
      batchStable
    },
    lease: persistedState.lease,
    recoveryCheckpoint: {
      schemaVersion: "aios.auditRecovery.eventReplay.recoveryCheckpoint.v1",
      batchId: sync.batchId,
      cursor: sync.cursor,
      highWatermark: sync.highWatermark,
      previousStatus: persistedState.previous.status,
      previousBatchId: persistedState.previous.batchId,
      previousCursor: persistedState.previous.cursor,
      pendingOperationIds: persistedState.previous.pendingOperationIds,
      providerReceiptState: providerReceipt?.state || "none",
      operationalHealthStatus: operationalHealth?.status || "unknown",
      commandKey: persistedState.commandKey,
      path: recoveryPath.path
    },
    statusJournal: [
      ...persistedState.previous.statusJournal,
      {
        sequence: persistedState.previous.statusJournal.length + 1,
        status: nextStatus,
        observedAt: now,
        command,
        commandKey: persistedState.commandKey,
        batchId: sync.batchId,
        cursor: sync.cursor,
        restartDetected: persistedState.restartDetected,
        duplicateCommand: persistedState.duplicateCommand
      }
    ].slice(-12)
  };
}

function buildReplayClaimEnvelope({
  command,
  lifecycle,
  sync,
  nextAction,
  acceptance,
  readiness,
  persistedState,
  persistedOutput,
  providerReceipt,
  workspaceBoundary,
  operationalHealth,
  now
}) {
  const boundaryBlocked = workspaceBoundary.authorized === false;
  const lifecycleBlocked = lifecycle.controlDecision.allowed === false;
  const healthBlocked = operationalHealth.blocking === true;
  const receiptBlocked = providerReceipt.required === true && providerReceipt.acknowledged !== true;
  const restartBlocked = persistedOutput.restart.restartSafe === false
    || persistedOutput.restart.providerStatusRequired === true && providerReceipt.acknowledged !== true;
  const claimBlockers = [
    persistedState.commandKeyReusedForDifferentBatch
      ? {
        code: "command_key_batch_conflict",
        owner: "operator",
        retryable: false,
        field: "commandKey",
        detail: "The command key was previously bound to a different replay batch."
      }
      : null,
    boundaryBlocked
      ? {
        code: "workspace_boundary_blocked",
        owner: "tenant-admin",
        retryable: false,
        field: "workspaceBoundary",
        detail: workspaceBoundary.boundaryErrors.map((error) => error.code).join(",") || "workspace boundary denied"
      }
      : null,
    lifecycleBlocked
      ? {
        code: lifecycle.controlDecision.denialCode || "lifecycle_command_denied",
        owner: "recovery-operator",
        retryable: false,
        field: "settings.lifecycleControls",
        detail: lifecycle.controlDecision.operatorAction
      }
      : null,
    healthBlocked
      ? {
        code: operationalHealth.failureState.state,
        owner: "provider-ops",
        retryable: operationalHealth.retry.retryable,
        field: "operationalHealth",
        detail: operationalHealth.failureState.operatorAction
      }
      : null,
    receiptBlocked
      ? {
        code: "provider_receipt_required",
        owner: "provider",
        retryable: true,
        field: "providerReceipt",
        detail: providerReceipt.requiredReasons.join(",") || "provider receipt required"
      }
      : null,
    restartBlocked
      ? {
        code: persistedOutput.restart.recoveryPath,
        owner: "hosted-kernel",
        retryable: persistedOutput.restart.restartSafe,
        field: "persistedState.restart",
        detail: persistedOutput.restart.operatorAction
      }
      : null
  ].filter(Boolean);
  const terminal = terminalReplayStates.has(persistedOutput.status)
    || persistedOutput.status === "failed"
    || claimBlockers.some((blocker) => blocker.retryable === false);
  const duplicateReturn = persistedState.duplicateCommand && persistedOutput.idempotency.retainedStatus;
  const replayable = claimBlockers.length === 0
    && acceptance.accepted
    && readiness.state !== "blocked"
    && persistedOutput.idempotency.mutationAllowed
    && !terminal;
  const retryable = !replayable
    && !terminal
    && claimBlockers.length > 0
    && claimBlockers.every((blocker) => blocker.retryable !== false);
  const nextAttemptAt = operationalHealth.retry.nextRetryAt
    || providerReceipt.required && !providerReceipt.acknowledged ? now : null;
  const claimState = duplicateReturn
    ? "duplicate-return"
    : persistedState.commandKeyReusedForDifferentBatch
      ? "conflict"
      : replayable
        ? "claimable"
        : retryable
          ? "retry-wait"
          : terminal
            ? "terminal"
            : "blocked";

  return {
    schemaVersion: "aios.auditRecovery.eventReplay.replayClaim.v1",
    generatedAt: now,
    state: claimState,
    command,
    commandKey: persistedState.commandKey,
    batchId: sync.batchId,
    cursor: sync.cursor,
    claimable: replayable,
    duplicateReturn,
    terminal,
    retryable,
    nextAttemptAt,
    blockers: claimBlockers,
    blockerCodes: claimBlockers.map((blocker) => blocker.code),
    replayPolicy: {
      idempotencyScope: "commandKey:batchId:cursor",
      replaySafe: replayable || duplicateReturn,
      mutationAllowed: persistedOutput.idempotency.mutationAllowed,
      receiptRequired: providerReceipt.required,
      receiptAcknowledged: providerReceipt.acknowledged,
      restartSafe: persistedOutput.restart.restartSafe,
      providerStatusRequired: persistedOutput.restart.providerStatusRequired
    },
    resume: {
      route: "audit-recovery/event-replay/replay-claim",
      action: replayable
        ? "claim-and-continue"
        : duplicateReturn
          ? "return-existing-status"
          : retryable
            ? "wait-and-retry"
            : "operator-review",
      reason: claimBlockers[0]?.code || persistedOutput.restart.recoveryPath,
      operatorAction: claimBlockers[0]?.detail || persistedOutput.restart.operatorAction
    },
    audit: {
      proofType: "aios.auditRecovery.eventReplay.replayClaimProof.v1",
      commandKey: persistedState.commandKey,
      status: persistedOutput.status,
      previousStatus: persistedState.previous.status,
      recoveryPath: persistedOutput.restart.recoveryPath,
      blockerCount: claimBlockers.length,
      claimStable: persistedOutput.batchId === sync.batchId
        && persistedOutput.cursor === sync.cursor
        && persistedOutput.lastCommandKey === persistedState.commandKey
    }
  };
}

function deriveNextAction(command, settings, validationErrors, providerContract, handoff, workspaceBoundary, operationalHealth) {
  if (validationErrors.length > 0) {
    const boundaryBlocked = workspaceBoundary?.boundaryErrors?.length > 0;
    const providerContractBlocked = providerContract.contractErrors.length > 0
      || providerContract.missingCapabilities.length > 0;
    const lifecycleBlocked = validationErrors.some((error) => (
      typeof error.code === "string"
      && (
        error.code.includes("lifecycle")
        || error.code.includes("maintenance_lock")
        || error.code.includes("_disabled_by_")
      )
    ));
    const healthValidationBlocked = operationalHealth?.blocking
      || validationErrors.some((error) => typeof error.code === "string" && error.code.startsWith("operational_health"));
    const healthAction = operationalHealth?.status === "degraded"
      ? operationalHealth.degradedModePolicy === "allow-preview"
        ? "switch-to-dry-run-preview"
        : operationalHealth.degradedModePolicy === "block-live-replay"
          ? "wait-for-health-recovery"
          : "acknowledge-degraded-mode"
      : "wait-for-health-retry";
    return {
      state: "blocked",
      action: healthValidationBlocked
        ? healthAction
        : boundaryBlocked
          ? "request-boundary-access"
          : providerContractBlocked
            ? "negotiate-provider-service-contract"
          : lifecycleBlocked
            ? "release-lifecycle-control"
            : "fix-settings",
      reason: healthValidationBlocked
        ? operationalHealth.status === "degraded" ? "operational_health_degraded" : "operational_health_failed"
        : boundaryBlocked
          ? "workspace_boundary_blocked"
          : providerContractBlocked
            ? "provider_service_contract_blocked"
          : lifecycleBlocked
            ? "lifecycle_control_blocked"
            : "settings_validation_failed",
      retry: healthValidationBlocked ? operationalHealth.retry : undefined
    };
  }

  if (!settings.enabled) {
    return {
      state: "disabled",
      action: command === "disable" || command === "pause" ? "none" : "enable",
      reason: "event_replay_disabled"
    };
  }

  if (providerContract.missingCapabilities.length > 0) {
    return {
      state: "blocked",
      action: "negotiate-provider-capabilities",
      reason: "provider_capability_gap",
      missingCapabilities: providerContract.missingCapabilities
    };
  }

  if (!settings.replay.dryRun && !providerContract.effectiveCapabilities.includes("live-replay")) {
    return {
      state: "blocked",
      action: "request-live-replay-capability",
      reason: "live_replay_not_negotiated"
    };
  }

  if (
    operationalHealth.status === "degraded"
    && !settings.replay.dryRun
    && (
      operationalHealth.degradedModePolicy === "allow-preview"
      || operationalHealth.degradedModePolicy === "block-live-replay"
      || (
        operationalHealth.degradedModePolicy === "require-ack"
        && !operationalHealth.degradedModeAcknowledged
      )
    )
  ) {
    return {
      state: "blocked",
      action: operationalHealth.degradedModePolicy === "allow-preview"
        ? "switch-to-dry-run-preview"
        : operationalHealth.degradedModePolicy === "block-live-replay"
        ? "wait-for-health-recovery"
        : "acknowledge-degraded-mode",
      reason: "operational_health_degraded",
      retry: operationalHealth.retry
    };
  }

  if (handoff.requested && !providerContract.effectiveCapabilities.includes("external-handoff")) {
    return {
      state: "blocked",
      action: "request-external-handoff-capability",
      reason: "external_handoff_not_negotiated"
    };
  }

  if (handoff.requested && !handoff.transferable) {
    return {
      state: "blocked",
      action: "complete-handoff-target",
      reason: handoff.state === "blocked" ? "external_handoff_blocked" : "external_handoff_target_missing"
    };
  }

  if (command === "replay-now") {
    return {
      state: "ready",
      action: handoff.requested ? "prepare-external-handoff" : settings.replay.dryRun ? "preview-replay" : "execute-replay",
      reason: "manual_replay_requested"
    };
  }

  if (settings.schedule.mode === "manual") {
    return {
      state: "waiting",
      action: "request-manual-replay",
      reason: "manual_schedule_selected"
    };
  }

  return {
    state: "scheduled",
    action: "await-schedule",
    reason: settings.schedule.mode === "window" ? "window_schedule_active" : "interval_schedule_active"
  };
}

function buildReplayProof({ command, settings, evidence, now, validationErrors, controlEvents, providerContract, providerReceipt, sync, handoff, clientRuntime, persistedState, workspaceBoundary, operationalHealth, replayPlan, reporting }) {
  return {
    proofType: "audit-recovery.event-replay.lifecycle",
    surfaceId,
    generatedAt: now,
    command,
    commandKey: persistedState.commandKey,
    accepted: validationErrors.length === 0,
    evidenceCount: evidence.length,
    controlEvents,
    settingsFingerprint: [
      settings.enabled ? "enabled" : "disabled",
      settings.replay.retentionMode,
      settings.replay.requireProof ? "proof-required" : "proof-optional",
      settings.replay.dryRun ? "dry-run" : "live-run",
      settings.schedule.mode,
      String(settings.schedule.intervalMinutes),
      settings.schedule.windowPolicy?.valid ? "window-valid" : "window-open",
      settings.lifecycleControls?.maintenanceLock ? "lifecycle-locked" : "lifecycle-open",
      settings.lifecycleTransition?.requested ? settings.lifecycleTransition.changedFields.join("+") : "no-lifecycle-transition"
    ].join(":"),
    providerFingerprint: [
      providerContract.providerId,
      providerContract.serviceId,
      providerContract.effectiveCapabilities.join("+") || "no-capabilities",
      providerContract.serviceContract.negotiatedProtocolVersion || "no-protocol-version",
      providerContract.serviceContract.deliveryGuarantee,
      providerContract.serviceContract.providerAuthMode,
      sync.batchId,
      handoff.state,
      providerReceipt.state,
      providerReceipt.acknowledged ? "receipt-acknowledged" : "receipt-open",
      providerReceipt.externalTicketId || "no-provider-ticket"
    ].join(":"),
    clientFingerprint: [
      clientRuntime.workflowId,
      clientRuntime.intent,
      clientRuntime.displayMode,
      clientRuntime.returnRoute,
      clientRuntime.interactive ? "interactive" : "headless",
      clientRuntime.continuation.mode,
      clientRuntime.continuation.preferredAction,
      clientRuntime.continuation.stateToken ? "state-token" : "no-state-token"
    ].join(":"),
    boundaryFingerprint: [
      workspaceBoundary.tenantId,
      workspaceBoundary.workspaceId,
      workspaceBoundary.isolationMode,
      workspaceBoundary.authorized ? "authorized" : "blocked",
      workspaceBoundary.requiredPermissions.join("+") || "no-required-permissions"
    ].join(":"),
    healthFingerprint: [
      operationalHealth.status,
      operationalHealth.failureState.state,
      operationalHealth.degradedModePolicy,
      operationalHealth.degradedModeAcknowledged ? "degraded-acknowledged" : "degraded-unacknowledged",
      operationalHealth.retry.retryable ? `retry:${operationalHealth.retry.backoffMs}` : "no-retry",
      operationalHealth.dependencies
        .map((dependency) => `${dependency.name}:${dependency.state}`)
        .join("+") || "no-dependencies"
    ].join(":"),
    persistenceFingerprint: [
      persistedState.previous.status,
      persistedState.previous.batchId || "no-batch",
      persistedState.duplicateCommand ? "duplicate-command" : "new-command",
      persistedState.restartDetected ? "restart-detected" : "steady-state",
      persistedState.lease?.reclaimable === false ? "lease-active" : "lease-reclaimable",
      persistedState.commandKeyReusedForDifferentBatch ? "command-key-conflict" : "command-key-clean"
    ].join(":"),
    analyticsFingerprint: [
      reporting?.counters?.selectedEvents ?? 0,
      reporting?.counters?.blockedEvents ?? 0,
      reporting?.counters?.validationErrors ?? validationErrors.length,
      reporting?.exportSummary?.ready ? "export-ready" : "export-blocked",
      reporting?.history?.snapshots?.length ?? 0
    ].join(":"),
    replayPlanFingerprint: [
      replayPlan?.schemaVersion || "no-plan",
      replayPlan?.planReady ? "plan-ready" : "plan-blocked",
      replayPlan?.integrity?.valid ? "integrity-valid" : "integrity-blocked",
      replayPlan?.integrity?.errors?.map((error) => error.code).join("+") || "no-integrity-errors",
      replayPlan?.manifest?.entryCount ?? 0,
      replayPlan?.manifest?.executableCount ?? 0,
      replayPlan?.manifest?.checkpointStart || "no-start",
      replayPlan?.manifest?.checkpointEnd || "no-end"
    ].join(":")
  };
}

function buildIntegrationState({ command, providerContract, providerReceipt, sync, handoff, nextAction, clientRuntime, workspaceBoundary, persistedOutput, operationalHealth, lifecycle }) {
  return {
    provider: {
      id: providerContract.providerId,
      serviceId: providerContract.serviceId,
      protocol: providerContract.protocol,
      capabilities: providerContract.effectiveCapabilities,
      missingCapabilities: providerContract.missingCapabilities,
      negotiated: providerContract.missingCapabilities.length === 0 && providerContract.serviceContract.contractValid,
      serviceContract: providerContract.serviceContract,
      contractErrors: providerContract.contractErrors,
      receipt: providerReceipt
    },
    sync: {
      cursor: sync.cursor,
      previousCursor: sync.previousCursor,
      sourceEpoch: sync.sourceEpoch,
      highWatermark: sync.highWatermark,
      batchId: sync.batchId,
      cursorChanged: sync.cursorChanged,
      mode: command === "replay-now" ? "manual" : "lifecycle"
    },
    externalHandoff: {
      requested: handoff.requested,
      state: handoff.state,
      target: handoff.target,
      reference: handoff.reference,
      targetTenantId: handoff.targetTenantId,
      transferable: handoff.transferable,
      nextAction: handoff.requested ? nextAction.action : "none"
    },
    lifecycleControls: {
      schemaVersion: lifecycle.settings.lifecycleControls.schemaVersion,
      allowed: lifecycle.controlDecision.allowed,
      denialCode: lifecycle.controlDecision.denialCode,
      operatorAction: lifecycle.controlDecision.operatorAction,
      maintenanceLock: lifecycle.settings.lifecycleControls.maintenanceLock,
      lockReason: lifecycle.settings.lifecycleControls.lockReason,
      allowEnable: lifecycle.settings.lifecycleControls.allowEnable,
      allowDisable: lifecycle.settings.lifecycleControls.allowDisable,
      allowSchedule: lifecycle.settings.lifecycleControls.allowSchedule,
      allowPause: lifecycle.settings.lifecycleControls.allowPause,
      allowResume: lifecycle.settings.lifecycleControls.allowResume,
      allowManualReplay: lifecycle.settings.lifecycleControls.allowManualReplay,
      requireScheduleWindow: lifecycle.settings.lifecycleControls.requireScheduleWindow
    },
    lifecycleTransition: {
      schemaVersion: lifecycle.lifecycleTransition?.schemaVersion,
      requested: lifecycle.lifecycleTransition?.requested || false,
      reason: lifecycle.lifecycleTransition?.reason || null,
      changedFields: lifecycle.lifecycleTransition?.changedFields || [],
      appliedFields: lifecycle.appliedLifecycleFields || [],
      requestedSettings: lifecycle.lifecycleTransition?.requestedSettings || null
    },
    workspaceBoundary: {
      schemaVersion: workspaceBoundary.schemaVersion,
      tenantId: workspaceBoundary.tenantId,
      workspaceId: workspaceBoundary.workspaceId,
      isolationMode: workspaceBoundary.isolationMode,
      roles: workspaceBoundary.roles,
      permissions: workspaceBoundary.permissions,
      requiredPermissions: workspaceBoundary.requiredPermissions,
      missingPermissions: workspaceBoundary.missingPermissions,
      authorized: workspaceBoundary.authorized,
      crossTenantHandoff: workspaceBoundary.crossTenantHandoff
    },
    operationalHealth: {
      schemaVersion: operationalHealth.schemaVersion,
      status: operationalHealth.status,
      observedAt: operationalHealth.observedAt,
      blocking: operationalHealth.blocking,
      degradedModePolicy: operationalHealth.degradedModePolicy,
      degradedModeAcknowledged: operationalHealth.degradedModeAcknowledged,
      failureState: operationalHealth.failureState,
      retry: operationalHealth.retry,
      dependencies: operationalHealth.dependencies,
      actionableErrors: operationalHealth.actionableErrors
    },
    clientRuntime: {
      requestId: clientRuntime.requestId,
      actorId: clientRuntime.actorId,
      workflowId: clientRuntime.workflowId,
      intent: clientRuntime.intent,
      displayMode: clientRuntime.displayMode,
      returnRoute: clientRuntime.returnRoute,
      interactive: clientRuntime.interactive,
      acknowledgedWarnings: clientRuntime.acknowledgedWarnings,
      continuation: clientRuntime.continuation
    },
    persistence: {
      schemaVersion: persistedOutput.schemaVersion,
      status: persistedOutput.status,
      statusSince: persistedOutput.statusSince,
      commandKey: persistedOutput.lastCommandKey,
      duplicateCommand: persistedOutput.idempotency.duplicateCommand,
      mutationAllowed: persistedOutput.idempotency.mutationAllowed,
      restartDetected: persistedOutput.restart.detected,
      restartStatus: persistedOutput.restart.status,
      recoveryHint: persistedOutput.restart.recoveryHint,
      recoveryPath: persistedOutput.restart.recoveryPath,
      restartSafe: persistedOutput.restart.restartSafe,
      providerStatusRequired: persistedOutput.restart.providerStatusRequired,
      lease: persistedOutput.lease,
      recoveryCheckpoint: persistedOutput.recoveryCheckpoint,
      statusJournalSize: persistedOutput.statusJournal.length
    }
  };
}

function validateIntegrationContracts({
  command,
  settings,
  providerContract,
  providerReceipt,
  sync,
  handoff,
  clientRuntime,
  workspaceBoundary,
  operationalHealth,
  lifecycle,
  persistedState
}) {
  const errors = [...workspaceBoundary.boundaryErrors, ...providerContract.contractErrors];

  if (persistedState?.commandKeyReusedForDifferentBatch) {
    errors.push({
      field: "persistedState.commandKey",
      code: "command_key_reused_for_different_batch",
      commandKey: persistedState.commandKey,
      previousBatchId: persistedState.previous.batchId,
      batchId: sync.batchId
    });
  }

  if (lifecycle && !lifecycle.controlDecision.allowed) {
    errors.push({
      field: "settings.controls",
      code: lifecycle.controlDecision.denialCode || "lifecycle_command_denied",
      command,
      operatorAction: lifecycle.controlDecision.operatorAction
    });
  }

  if (providerContract.providerCapabilities.length === 0) {
    errors.push({
      field: "provider.capabilities",
      code: "provider_capabilities_empty",
      allowed: Array.from(replayCapabilities)
    });
  }

  if (!settings.replay.dryRun && !providerContract.effectiveCapabilities.includes("live-replay")) {
    errors.push({
      field: "provider.capabilities",
      code: "live_replay_capability_required"
    });
  }

  if (settings.replay.requireProof && !providerContract.effectiveCapabilities.includes("proof-export")) {
    errors.push({
      field: "provider.capabilities",
      code: "proof_export_capability_required"
    });
  }

  if (handoff.requested && !handoff.target) {
    errors.push({
      field: "handoff.target",
      code: "handoff_target_required"
    });
  }

  if (sync.cursorChanged && sync.previousCursor === null) {
    errors.push({
      field: "sync.previousCursor",
      code: "previous_cursor_required_for_cursor_change"
    });
  }

  if (providerReceipt.present && !providerReceipt.matchesBatch) {
    errors.push({
      field: "provider.receipt.batchId",
      code: "provider_receipt_batch_mismatch",
      expectedBatchId: sync.batchId,
      receiptBatchId: providerReceipt.batchId
    });
  }

  if (providerReceipt.present && !providerReceipt.matchesCursor) {
    errors.push({
      field: "provider.receipt.cursor",
      code: "provider_receipt_cursor_mismatch",
      expectedCursor: sync.cursor,
      receiptCursor: providerReceipt.cursor
    });
  }

  if (providerReceipt.present && !providerReceipt.matchesHandoff) {
    errors.push({
      field: "provider.receipt.reference",
      code: "provider_receipt_handoff_reference_mismatch",
      expectedReference: handoff.reference,
      receiptReference: providerReceipt.reference
    });
  }

  if (providerReceipt.state === "rejected") {
    errors.push({
      field: "provider.receipt.state",
      code: "provider_receipt_rejected",
      kind: providerReceipt.kind,
      externalTicketId: providerReceipt.externalTicketId
    });
  }

  if (providerReceipt.state === "expired") {
    errors.push({
      field: "provider.receipt.expiresAt",
      code: "provider_receipt_expired",
      expiresAt: providerReceipt.expiresAt
    });
  }

  if (providerReceipt.required && !providerReceipt.acknowledged) {
    errors.push({
      field: "provider.receipt.state",
      code: "provider_receipt_acknowledgement_required",
      requiredReasons: providerReceipt.requiredReasons,
      state: providerReceipt.state
    });
  }

  if (!clientRuntime.interactive && handoff.requested && !clientRuntime.requestId) {
    errors.push({
      field: "client.requestId",
      code: "client_request_id_required_for_headless_handoff"
    });
  }

  if (clientRuntime.continuation.mode === "callback" && !clientRuntime.continuation.callbackUrl) {
    errors.push({
      field: "client.continuation.callbackUrl",
      code: "callback_continuation_url_required"
    });
  }

  if (clientRuntime.continuation.mode === "callback" && !["POST", "PUT", "PATCH"].includes(clientRuntime.continuation.callbackMethod)) {
    errors.push({
      field: "client.continuation.callbackMethod",
      code: "callback_continuation_method_unsupported",
      allowed: ["POST", "PUT", "PATCH"]
    });
  }

  if (
    !clientRuntime.interactive
    && clientRuntime.continuation.mode !== "callback"
    && clientRuntime.continuation.mode !== "deferred"
  ) {
    errors.push({
      field: "client.continuation.mode",
      code: "headless_client_requires_callback_or_deferred_continuation"
    });
  }

  if (clientRuntime.intent === "execute" && settings.replay.dryRun) {
    errors.push({
      field: "client.intent",
      code: "execute_intent_requires_live_replay"
    });
  }

  if (clientRuntime.intent === "handoff" && !handoff.requested) {
    errors.push({
      field: "client.intent",
      code: "handoff_intent_requires_handoff_request"
    });
  }

  if (operationalHealth.status === "failed") {
    errors.push(...operationalHealth.actionableErrors
      .filter((error) => error.severity === "error")
      .map((error) => ({
        ...error,
        code: error.code || "operational_health_failed"
      })));
  }

  if (
    operationalHealth.failureState.stale
    && !settings.replay.dryRun
    && operationalHealth.status !== "ok"
  ) {
    errors.push({
      field: "health.observedAt",
      code: "operational_health_observation_stale",
      observedAt: operationalHealth.observedAt,
      staleAfterMs: operationalHealth.failureState.staleAfterMs,
      operatorAction: operationalHealth.failureState.operatorAction
    });
  }

  if (operationalHealth.failureState.retryBudget.exhausted) {
    errors.push({
      field: "health.retryPolicy.maxAttempts",
      code: "operational_health_retry_budget_exhausted",
      failureCount: operationalHealth.failureState.retryBudget.failureCount,
      maxAttempts: operationalHealth.failureState.retryBudget.maxAttempts,
      operatorAction: operationalHealth.failureState.operatorAction
    });
  }

  if (
    operationalHealth.status === "degraded"
    && !settings.replay.dryRun
    && (
      operationalHealth.degradedModePolicy === "allow-preview"
      || operationalHealth.degradedModePolicy === "block-live-replay"
      || !operationalHealth.degradedModeAcknowledged
    )
  ) {
    errors.push({
      field: "health.degradedModePolicy",
      code: operationalHealth.degradedModePolicy === "allow-preview"
        ? "operational_health_degraded_preview_only"
        : operationalHealth.degradedModePolicy === "block-live-replay"
          ? "operational_health_degraded_live_blocked"
          : "operational_health_degraded_ack_required",
      retryable: operationalHealth.retry.retryable,
      nextRetryAt: operationalHealth.retry.nextRetryAt,
      dependencies: operationalHealth.dependencies
        .filter((dependency) => dependency.state === "degraded")
        .map((dependency) => dependency.name)
    });
  }

  if (handoff.targetTenantId && handoff.targetTenantId !== workspaceBoundary.tenantId && workspaceBoundary.isolationMode !== "trusted") {
    const targetTenantAllowed = workspaceBoundary.allowedTenantIds.length === 0
      || workspaceBoundary.allowedTenantIds.includes(handoff.targetTenantId);
    if (!targetTenantAllowed) {
      errors.push({
        field: "handoff.targetTenantId",
        code: "handoff_target_tenant_outside_workspace_boundary",
        sourceTenantId: workspaceBoundary.tenantId,
        targetTenantId: handoff.targetTenantId
      });
    }
  }

  return errors;
}

function normalizePreviewEvent(event, index) {
  const candidate = event && typeof event === "object" ? event : {};
  const id = typeof candidate.id === "string" && candidate.id.trim()
    ? candidate.id.trim()
    : `event-${index + 1}`;
  const stream = typeof candidate.stream === "string" && candidate.stream.trim()
    ? candidate.stream.trim()
    : "audit";
  const type = typeof candidate.type === "string" && candidate.type.trim()
    ? candidate.type.trim()
    : "unknown";
  const timestamp = typeof candidate.timestamp === "string" && candidate.timestamp.trim()
    ? normalizeIsoTimestamp(candidate.timestamp) || candidate.timestamp.trim()
    : null;
  const replayable = candidate.replayable === false ? false : true;
  const proofId = typeof candidate.proofId === "string" && candidate.proofId.trim()
    ? candidate.proofId.trim()
    : null;
  const operation = replayOperationKinds.has(candidate.operation)
    ? candidate.operation
    : replayable
      ? "restore"
      : "skip";
  const sourceCursor = typeof candidate.cursor === "string" && candidate.cursor.trim()
    ? candidate.cursor.trim()
    : typeof candidate.sourceCursor === "string" && candidate.sourceCursor.trim()
      ? candidate.sourceCursor.trim()
      : null;
  const aggregateId = typeof candidate.aggregateId === "string" && candidate.aggregateId.trim()
    ? candidate.aggregateId.trim()
    : typeof candidate.subjectId === "string" && candidate.subjectId.trim()
      ? candidate.subjectId.trim()
      : null;
  const tenantId = typeof candidate.tenantId === "string" && candidate.tenantId.trim()
    ? candidate.tenantId.trim()
    : typeof candidate.sourceTenantId === "string" && candidate.sourceTenantId.trim()
      ? candidate.sourceTenantId.trim()
      : null;
  const workspaceId = typeof candidate.workspaceId === "string" && candidate.workspaceId.trim()
    ? candidate.workspaceId.trim()
    : typeof candidate.sourceWorkspaceId === "string" && candidate.sourceWorkspaceId.trim()
      ? candidate.sourceWorkspaceId.trim()
      : null;
  const scope = candidate.scope && typeof candidate.scope === "object" ? candidate.scope : {};
  const scopedTenantId = tenantId || (typeof scope.tenantId === "string" && scope.tenantId.trim()
    ? scope.tenantId.trim()
    : null);
  const scopedWorkspaceId = workspaceId || (typeof scope.workspaceId === "string" && scope.workspaceId.trim()
    ? scope.workspaceId.trim()
    : null);
  const reason = replayable
    ? "eligible_for_replay"
    : typeof candidate.reason === "string" && candidate.reason.trim()
      ? candidate.reason.trim()
      : "marked_non_replayable";

  return {
    id,
    stream,
    type,
    timestamp,
    replayable,
    proofId,
    operation,
    sourceCursor,
    aggregateId,
    tenantId: scopedTenantId,
    workspaceId: scopedWorkspaceId,
    reason
  };
}

function evaluateEventBoundary(event, workspaceBoundary) {
  const eventTenantId = event.tenantId || workspaceBoundary.tenantId;
  const eventWorkspaceId = event.workspaceId || workspaceBoundary.workspaceId;
  const tenantMismatch = eventTenantId !== workspaceBoundary.tenantId;
  const workspaceMismatch = eventWorkspaceId !== workspaceBoundary.workspaceId;
  const tenantExplicitlyAllowed = workspaceBoundary.allowedTenantIds.length === 0
    || workspaceBoundary.allowedTenantIds.includes(eventTenantId);
  const workspaceExplicitlyAllowed = workspaceBoundary.allowedWorkspaceIds.length === 0
    || workspaceBoundary.allowedWorkspaceIds.includes(eventWorkspaceId);
  const canCrossTenant = workspaceBoundary.permissions.includes("audit-replay:tenant-crossing");
  const blockedBy = [
    tenantMismatch && workspaceBoundary.isolationMode === "strict"
      ? "event_tenant_mismatch_strict_isolation"
      : null,
    tenantMismatch && !canCrossTenant
      ? "event_tenant_crossing_permission_required"
      : null,
    tenantMismatch && !tenantExplicitlyAllowed
      ? "event_tenant_outside_allowed_boundary"
      : null,
    workspaceMismatch && !workspaceExplicitlyAllowed
      ? "event_workspace_outside_allowed_boundary"
      : null,
    !workspaceBoundary.authorized
      ? "request_boundary_not_authorized"
      : null
  ].filter(Boolean);

  return {
    schemaVersion: "aios.auditRecovery.eventReplay.eventBoundary.v1",
    tenantId: eventTenantId,
    workspaceId: eventWorkspaceId,
    tenantMismatch,
    workspaceMismatch,
    tenantExplicitlyAllowed,
    workspaceExplicitlyAllowed,
    canCrossTenant,
    authorized: blockedBy.length === 0,
    blockedBy
  };
}

function buildReplayPlanEntry(event, index, context) {
  const proofRequired = context.settings.replay.requireProof;
  const proofSatisfied = !proofRequired || Boolean(event.proofId);
  const eventBoundary = evaluateEventBoundary(event, context.workspaceBoundary);
  const checkpoint = [
    context.sync.batchId,
    String(index + 1).padStart(4, "0"),
    event.stream,
    event.id
  ].join(":");
  const routeKey = [
    eventBoundary.tenantId,
    eventBoundary.workspaceId,
    event.stream,
    event.aggregateId || "unscoped"
  ].join("/");
  const executable = event.replayable
    && event.operation !== "skip"
    && proofSatisfied
    && context.providerContract.serviceContract.contractValid
    && context.workspaceBoundary.authorized
    && eventBoundary.authorized;

  return {
    schemaVersion: "aios.auditRecovery.eventReplay.planEntry.v1",
    index: index + 1,
    eventId: event.id,
    stream: event.stream,
    type: event.type,
    timestamp: event.timestamp,
    operation: event.operation,
    aggregateId: event.aggregateId,
    tenantId: eventBoundary.tenantId,
    workspaceId: eventBoundary.workspaceId,
    sourceCursor: event.sourceCursor || context.sync.cursor,
    checkpoint,
    routeKey,
    boundary: eventBoundary,
    proof: {
      required: proofRequired,
      proofId: event.proofId,
      satisfied: proofSatisfied
    },
    execution: {
      mode: context.settings.replay.dryRun ? "dry-run" : "live-replay",
      executable,
      blockedBy: [
        !event.replayable ? event.reason : null,
        event.operation === "skip" ? "skip_operation_not_executable" : null,
        !proofSatisfied ? "proof_required" : null,
        !context.providerContract.serviceContract.contractValid ? "provider_service_contract_invalid" : null,
        !context.workspaceBoundary.authorized ? "workspace_boundary_blocked" : null,
        ...eventBoundary.blockedBy
      ].filter(Boolean)
    }
  };
}

function duplicateValues(values) {
  const counts = new Map();
  for (const value of values.filter(Boolean)) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([value, count]) => ({ value, count }));
}

function analyzeReplayPlanIntegrity(entries, settings, sync) {
  const duplicateEventIds = duplicateValues(entries.map((entry) => entry.eventId));
  const duplicateCheckpoints = duplicateValues(entries.map((entry) => entry.checkpoint));
  const missingCursorEntries = entries.filter((entry) => !entry.sourceCursor);
  const executableMutationEntries = entries.filter((entry) => (
    entry.execution.executable && entry.operation !== "skip"
  ));
  const orderedByRoute = new Map();
  const timestampOrderViolations = [];

  for (const entry of entries) {
    if (!entry.timestamp) {
      continue;
    }

    const observedAt = Date.parse(entry.timestamp);
    if (!Number.isFinite(observedAt)) {
      continue;
    }

    const routeState = orderedByRoute.get(entry.routeKey);
    if (routeState && observedAt < routeState.observedAt) {
      timestampOrderViolations.push({
        routeKey: entry.routeKey,
        previousEventId: routeState.eventId,
        eventId: entry.eventId,
        previousTimestamp: routeState.timestamp,
        timestamp: entry.timestamp
      });
    }

    orderedByRoute.set(entry.routeKey, {
      eventId: entry.eventId,
      observedAt,
      timestamp: entry.timestamp
    });
  }

  const errors = [
    ...duplicateEventIds.map((duplicate) => ({
      field: "evidence.id",
      code: "replay_plan_duplicate_event_id",
      eventId: duplicate.value,
      count: duplicate.count
    })),
    ...duplicateCheckpoints.map((duplicate) => ({
      field: "replayPlan.entries.checkpoint",
      code: "replay_plan_duplicate_checkpoint",
      checkpoint: duplicate.value,
      count: duplicate.count
    })),
    ...(
      settings.replay.dryRun
        ? []
        : missingCursorEntries.map((entry) => ({
          field: "replayPlan.entries.sourceCursor",
          code: "live_replay_entry_cursor_required",
          eventId: entry.eventId,
          checkpoint: entry.checkpoint
        }))
    ),
    ...timestampOrderViolations.map((violation) => ({
      field: "replayPlan.entries.timestamp",
      code: "replay_plan_timestamp_order_violation",
      ...violation
    })),
    entries.length > 0 && executableMutationEntries.length === 0
      ? {
        field: "replayPlan.entries.operation",
        code: "replay_plan_requires_executable_mutation",
        allowedOperations: Array.from(replayOperationKinds).filter((operation) => operation !== "skip")
      }
      : null
  ].filter(Boolean);

  return {
    schemaVersion: "aios.auditRecovery.eventReplay.planIntegrity.v1",
    valid: errors.length === 0,
    errors,
    duplicateEventIds,
    duplicateCheckpoints,
    missingCursorEventIds: missingCursorEntries.map((entry) => entry.eventId),
    timestampOrderViolations,
    cursorPolicy: {
      required: !settings.replay.dryRun,
      batchCursor: sync.cursor,
      missingCount: missingCursorEntries.length
    },
    executableMutationCount: executableMutationEntries.length
  };
}

function buildReplayPlan({ preview, settings, sync, providerContract, workspaceBoundary, operationalHealth }) {
  const entries = preview.selectedEvents.map((event, index) => buildReplayPlanEntry(event, index, {
    settings,
    sync,
    providerContract,
    workspaceBoundary
  }));
  const executableEntries = entries.filter((entry) => entry.execution.executable);
  const blockedEntries = entries.filter((entry) => !entry.execution.executable);
  const boundaryBlockedEntries = blockedEntries.filter((entry) => entry.boundary.blockedBy.length > 0);
  const liveReplayRequested = !settings.replay.dryRun;
  const healthAllowsExecution = settings.replay.dryRun
    ? operationalHealth.failureState.canPreview
    : operationalHealth.failureState.canDispatch;
  const integrity = analyzeReplayPlanIntegrity(entries, settings, sync);
  const planReady = entries.length > 0
    && blockedEntries.length === 0
    && integrity.valid
    && healthAllowsExecution
    && (!liveReplayRequested || providerContract.effectiveCapabilities.includes("live-replay"));

  return {
    schemaVersion: "aios.auditRecovery.eventReplay.plan.v1",
    batchId: sync.batchId,
    cursor: sync.cursor,
    mode: settings.replay.dryRun ? "dry-run" : "live-replay",
    planReady,
    healthAllowsExecution,
    healthGate: {
      state: operationalHealth.failureState.state,
      canPreview: operationalHealth.failureState.canPreview,
      canDispatch: operationalHealth.failureState.canDispatch,
      operatorAction: operationalHealth.failureState.operatorAction,
      retry: operationalHealth.retry
    },
    entries,
    integrity,
    manifest: {
      entryCount: entries.length,
      executableCount: executableEntries.length,
      blockedCount: blockedEntries.length,
      integrityValid: integrity.valid,
      integrityErrorCount: integrity.errors.length,
      duplicateEventIdCount: integrity.duplicateEventIds.length,
      duplicateCheckpointCount: integrity.duplicateCheckpoints.length,
      missingCursorCount: integrity.cursorPolicy.missingCount,
      timestampOrderViolationCount: integrity.timestampOrderViolations.length,
      executableMutationCount: integrity.executableMutationCount,
      checkpointStart: entries[0]?.checkpoint || null,
      checkpointEnd: entries.at(-1)?.checkpoint || null,
      operationCounts: entries.reduce((counts, entry) => ({
        ...counts,
        [entry.operation]: (counts[entry.operation] || 0) + 1
      }), {}),
      proofIds: entries
        .map((entry) => entry.proof.proofId)
        .filter(Boolean),
      blockedReasons: Array.from(new Set(blockedEntries.flatMap((entry) => entry.execution.blockedBy))),
      boundaryBlockedCount: boundaryBlockedEntries.length,
      boundaryScopes: entries.map((entry) => ({
        eventId: entry.eventId,
        tenantId: entry.boundary.tenantId,
        workspaceId: entry.boundary.workspaceId,
        authorized: entry.boundary.authorized,
        blockedBy: entry.boundary.blockedBy
      }))
    }
  };
}

function endpointUrlFor(providerContract, kind) {
  return providerContract.serviceContract.endpointReadiness
    .find((endpoint) => endpoint.kind === kind)?.url || null;
}

function buildHostedKernelInvocation({
  replayPlan,
  providerContract,
  providerReceipt,
  acceptance,
  readiness,
  sync,
  workspaceBoundary,
  clientRuntime,
  handoff,
  operationalHealth
}) {
  const scanEndpoint = endpointUrlFor(providerContract, "scan");
  const proofEndpoint = endpointUrlFor(providerContract, "proof");
  const replayEndpoint = endpointUrlFor(providerContract, "replay");
  const handoffEndpoint = endpointUrlFor(providerContract, "handoff");
  const statusEndpoint = endpointUrlFor(providerContract, "status");
  const dispatchBlockers = [
    !acceptance.accepted ? "acceptance_required" : null,
    !replayPlan.planReady ? "replay_plan_not_ready" : null,
    !replayPlan.integrity.valid ? "replay_plan_integrity_invalid" : null,
    ...replayPlan.integrity.errors.map((error) => error.code),
    operationalHealth.status === "failed" ? "operational_health_failed" : null,
    operationalHealth.failureState.stale && replayPlan.mode === "live-replay" ? "operational_health_observation_stale" : null,
    operationalHealth.failureState.retryBudget.exhausted ? "operational_health_retry_budget_exhausted" : null,
    replayPlan.mode === "live-replay" && !operationalHealth.failureState.canDispatch
      ? operationalHealth.failureState.state
      : null,
    replayPlan.mode === "live-replay" && !replayEndpoint ? "replay_endpoint_missing" : null,
    !scanEndpoint ? "scan_endpoint_missing" : null,
    readiness.canExportProof && !proofEndpoint ? "proof_endpoint_missing" : null,
    handoff.requested && !handoffEndpoint ? "handoff_endpoint_missing" : null,
    providerReceipt.required && !providerReceipt.acknowledged ? "provider_receipt_acknowledgement_required" : null
  ].filter(Boolean);
  const routeBase = {
    tenantId: workspaceBoundary.tenantId,
    workspaceId: workspaceBoundary.workspaceId,
    batchId: sync.batchId,
    cursor: sync.cursor,
    actorId: clientRuntime.actorId,
    requestId: clientRuntime.requestId,
    workflowId: clientRuntime.workflowId
  };
  const operations = replayPlan.entries.map((entry) => ({
    operationId: entry.checkpoint,
    endpoint: replayPlan.mode === "live-replay" ? replayEndpoint : scanEndpoint,
    method: replayPlan.mode === "live-replay" ? "POST" : "GET",
    mode: replayPlan.mode,
    dispatchable: dispatchBlockers.length === 0 && entry.execution.executable,
    event: {
      id: entry.eventId,
      stream: entry.stream,
      type: entry.type,
      aggregateId: entry.aggregateId,
      tenantId: entry.tenantId,
      workspaceId: entry.workspaceId,
      operation: entry.operation,
      sourceCursor: entry.sourceCursor
    },
    proof: {
      proofId: entry.proof.proofId,
      exportEndpoint: proofEndpoint,
      exportRequired: entry.proof.required
    },
    route: {
      ...routeBase,
      routeKey: entry.routeKey,
      checkpoint: entry.checkpoint,
      boundaryAuthorized: entry.boundary.authorized
    },
    blockedBy: [...dispatchBlockers, ...entry.execution.blockedBy]
  }));

  return {
    schemaVersion: "aios.auditRecovery.eventReplay.hostedKernelInvocation.v1",
    providerId: providerContract.providerId,
    serviceId: providerContract.serviceId,
    protocolVersion: providerContract.serviceContract.negotiatedProtocolVersion,
    authMode: providerContract.serviceContract.providerAuthMode,
    deliveryGuarantee: providerContract.serviceContract.deliveryGuarantee,
    dispatchable: dispatchBlockers.length === 0 && operations.length > 0,
    dispatchBlockers,
    planIntegrity: replayPlan.integrity,
    endpoints: {
      scan: scanEndpoint,
      proof: proofEndpoint,
      replay: replayEndpoint,
      handoff: handoffEndpoint,
      status: statusEndpoint
    },
    operationCount: operations.length,
    dispatchableOperationCount: operations.filter((operation) => operation.dispatchable).length,
    healthGate: {
      state: operationalHealth.failureState.state,
      dispatchAllowed: operationalHealth.failureState.canDispatch,
      retry: operationalHealth.retry,
      operatorAction: operationalHealth.failureState.operatorAction
    },
    providerReceipt: {
      state: providerReceipt.state,
      kind: providerReceipt.kind,
      required: providerReceipt.required,
      acknowledged: providerReceipt.acknowledged,
      externalTicketId: providerReceipt.externalTicketId,
      acknowledgedAt: providerReceipt.acknowledgedAt,
      expiresAt: providerReceipt.expiresAt
    },
    operations,
    statusPoll: {
      endpoint: statusEndpoint,
      enabled: Boolean(statusEndpoint),
      correlationKey: [
        surfaceId,
        workspaceBoundary.tenantId,
        workspaceBoundary.workspaceId,
        sync.batchId
      ].join(":"),
      lastProviderReceipt: providerReceipt.present
        ? {
          state: providerReceipt.state,
          kind: providerReceipt.kind,
          externalTicketId: providerReceipt.externalTicketId,
          acknowledgedAt: providerReceipt.acknowledgedAt
        }
        : null
    },
    handoffPackage: handoff.requested
      ? {
        endpoint: handoffEndpoint,
        target: handoff.target,
        reference: handoff.reference,
        targetTenantId: handoff.targetTenantId,
        providerReceiptState: providerReceipt.state,
        externalTicketId: providerReceipt.externalTicketId,
        transferable: handoff.transferable && dispatchBlockers.length === 0
      }
      : null
  };
}

function buildPreviewContract({ evidence, settings, sync, handoff, workspaceBoundary }) {
  const normalizedEvents = evidence.map(normalizePreviewEvent);
  const replayableEvents = normalizedEvents.filter((event) => event.replayable);
  const blockedEvents = normalizedEvents.filter((event) => !event.replayable);
  const maxEventsPerRun = settings.replay.maxEventsPerRun;
  const selectedEvents = replayableEvents.slice(0, maxEventsPerRun);
  const overflowCount = Math.max(replayableEvents.length - selectedEvents.length, 0);
  const proofMissingCount = selectedEvents.filter((event) => !event.proofId).length;

  return {
    kind: "event-replay-preview",
    mode: settings.replay.dryRun ? "dry-run" : "live-replay",
    batchId: sync.batchId,
    cursor: sync.cursor,
    selection: {
      received: normalizedEvents.length,
      replayable: replayableEvents.length,
      selected: selectedEvents.length,
      blocked: blockedEvents.length,
      overflow: overflowCount,
      selectedEventIds: selectedEvents.map((event) => event.id)
    },
    selectedEvents,
    sample: selectedEvents.slice(0, 5).map((event) => ({
      id: event.id,
      stream: event.stream,
      type: event.type,
      timestamp: event.timestamp,
      proofId: event.proofId,
      operation: event.operation,
      tenantId: event.tenantId || workspaceBoundary.tenantId,
      workspaceId: event.workspaceId || workspaceBoundary.workspaceId,
      checkpointCursor: event.sourceCursor || sync.cursor,
      explanation: event.reason
    })),
    blockers: blockedEvents.slice(0, 5).map((event) => ({
      id: event.id,
      stream: event.stream,
      type: event.type,
      reason: event.reason
    })),
    proofCoverage: {
      required: settings.replay.requireProof,
      missingForSelected: proofMissingCount,
      complete: !settings.replay.requireProof || proofMissingCount === 0
    },
    handoffPreview: {
      requested: handoff.requested,
      target: handoff.target,
      targetTenantId: handoff.targetTenantId,
      transferable: handoff.transferable,
      boundarySafe: workspaceBoundary.authorized && !workspaceBoundary.crossTenantHandoff
        ? true
        : workspaceBoundary.authorized && workspaceBoundary.permissions.includes("audit-replay:tenant-crossing")
    }
  };
}

function summarizeValidation(errors) {
  const fields = {};
  for (const error of errors) {
    const field = typeof error.field === "string" ? error.field : "unknown";
    fields[field] = (fields[field] || 0) + 1;
  }

  return {
    status: errors.length === 0 ? "valid" : "invalid",
    errorCount: errors.length,
    fields,
    userVisible: errors.map((error) => ({
      field: error.field || "unknown",
      code: error.code || "validation_failed",
      message: explainValidationError(error)
    }))
  };
}

function explainValidationError(error) {
  if (error.code === "unsupported_retention_mode") {
    return "Choose a supported replay retention mode before continuing.";
  }
  if (error.code === "unsupported_schedule_mode") {
    return "Choose a supported event replay schedule mode before continuing.";
  }
  if (error.code === "interval_too_short") {
    return "Increase the replay interval to at least the required minimum.";
  }
  if (error.code === "interval_below_lifecycle_minimum") {
    return `Increase the replay interval to at least ${error.minimum || "the lifecycle minimum"} minutes.`;
  }
  if (error.code === "interval_above_lifecycle_maximum") {
    return `Reduce the replay interval to no more than ${error.maximum || "the lifecycle maximum"} minutes.`;
  }
  if (error.code === "lifecycle_interval_bounds_invalid") {
    return "Fix lifecycle interval bounds so the minimum is not greater than the maximum.";
  }
  if (error.code === "invalid_schedule_window_start") {
    return "Provide a valid ISO start time for the replay schedule window.";
  }
  if (error.code === "invalid_schedule_window_end") {
    return "Provide a valid ISO end time for the replay schedule window.";
  }
  if (error.code === "schedule_window_order_invalid") {
    return "Set the replay schedule window start before its end.";
  }
  if (error.code === "window_schedule_requires_valid_window") {
    return "Provide a valid replay schedule window before using window scheduling.";
  }
  if (error.code === "schedule_window_required_by_lifecycle_controls") {
    return "Provide a valid replay schedule window required by lifecycle controls.";
  }
  if (error.code === "unsupported_lifecycle_schedule_mode") {
    return "Choose a supported requested schedule mode before applying this lifecycle change.";
  }
  if (error.code === "invalid_lifecycle_schedule_window") {
    return "Provide a valid requested lifecycle schedule window before scheduling replay.";
  }
  if (error.code === "unsupported_lifecycle_retention_mode") {
    return "Choose a supported requested replay retention mode before applying this lifecycle change.";
  }
  if (error.code === "lifecycle_requested_interval_below_minimum") {
    return `Increase the requested replay interval to at least ${error.minimum || "the lifecycle minimum"} minutes.`;
  }
  if (error.code === "lifecycle_requested_interval_above_maximum") {
    return `Reduce the requested replay interval to no more than ${error.maximum || "the lifecycle maximum"} minutes.`;
  }
  if (error.code === "lifecycle_requested_schedule_window_required") {
    return "Include a valid schedule window with this requested lifecycle schedule change.";
  }
  if (
    error.code === "maintenance_lock_active"
    || error.code === "enable_disabled_by_lifecycle_controls"
    || error.code === "disable_disabled_by_lifecycle_controls"
    || error.code === "schedule_disabled_by_lifecycle_controls"
    || error.code === "pause_disabled_by_lifecycle_controls"
    || error.code === "resume_disabled_by_lifecycle_controls"
    || error.code === "manual_replay_disabled_by_lifecycle_controls"
    || error.code === "lifecycle_command_denied"
  ) {
    return error.operatorAction || "Update lifecycle controls before applying this replay command.";
  }
  if (error.code === "provider_capabilities_empty") {
    return "Connect a hosted-kernel provider that advertises event replay capabilities.";
  }
  if (error.code === "provider_protocol_version_not_negotiated") {
    return "Choose a provider protocol version accepted by the hosted-kernel event replay service.";
  }
  if (error.code === "provider_auth_mode_mismatch") {
    return `Use ${error.serviceRequiredAuth || "the required auth mode"} for this replay provider contract.`;
  }
  if (error.code === "live_replay_requires_replay_safe_delivery") {
    return "Use at-least-once or exactly-once delivery before negotiating live replay.";
  }
  if (error.code === "provider_endpoint_not_ready") {
    return `Provide a ready ${error.endpointKind || "provider"} endpoint for the negotiated replay service contract.`;
  }
  if (error.code === "live_replay_capability_required") {
    return "Negotiate live replay capability or switch the run back to dry-run mode.";
  }
  if (error.code === "proof_export_capability_required") {
    return "Negotiate proof export capability or make replay proof optional.";
  }
  if (error.code === "handoff_target_required") {
    return "Provide the external handoff target before accepting this replay.";
  }
  if (error.code === "previous_cursor_required_for_cursor_change") {
    return "Provide the previous sync cursor when advancing to a new cursor.";
  }
  if (error.code === "provider_receipt_batch_mismatch") {
    return "Use a provider receipt generated for this replay batch before continuing.";
  }
  if (error.code === "provider_receipt_cursor_mismatch") {
    return "Use a provider receipt generated for the current sync cursor before continuing.";
  }
  if (error.code === "provider_receipt_handoff_reference_mismatch") {
    return "Use a provider receipt that matches the external handoff reference.";
  }
  if (error.code === "provider_receipt_rejected") {
    return "Resolve the rejected provider receipt before accepting this replay.";
  }
  if (error.code === "provider_receipt_expired") {
    return "Refresh the provider receipt before accepting this replay.";
  }
  if (error.code === "provider_receipt_acknowledgement_required") {
    return "Wait for provider acknowledgement before completing this sync or handoff transition.";
  }
  if (error.code === "command_key_reused_for_different_batch") {
    return "Use a new command key before applying this replay batch.";
  }
  if (error.code === "client_request_id_required_for_headless_handoff") {
    return "Provide a client request id before sending a headless replay handoff.";
  }
  if (error.code === "callback_continuation_url_required") {
    return "Provide a callback URL before using callback continuation for replay.";
  }
  if (error.code === "callback_continuation_method_unsupported") {
    return "Use POST, PUT, or PATCH for replay callback continuation.";
  }
  if (error.code === "headless_client_requires_callback_or_deferred_continuation") {
    return "Use callback or deferred continuation for headless replay clients.";
  }
  if (error.code === "execute_intent_requires_live_replay") {
    return "Switch replay out of dry-run mode before using an execute workflow intent.";
  }
  if (error.code === "handoff_intent_requires_handoff_request") {
    return "Request an external handoff before using a handoff workflow intent.";
  }
  if (error.code === "workspace_scope_not_allowed") {
    return "Switch to a workspace included in this replay request boundary.";
  }
  if (error.code === "tenant_scope_not_allowed") {
    return "Switch to a tenant included in this replay request boundary.";
  }
  if (error.code === "cross_tenant_handoff_requires_permission") {
    return "Grant cross-tenant replay handoff permission before sending this package.";
  }
  if (error.code === "permission_required") {
    return `Grant ${error.permission || "the required replay permission"} before continuing.`;
  }
  if (error.code === "handoff_target_tenant_outside_workspace_boundary") {
    return "Add the handoff target tenant to the replay boundary before continuing.";
  }
  if (error.code === "operational_health_failed" || error.code === "dependency_unavailable") {
    return error.nextRetryAt
      ? `Hosted-kernel replay health is failed; retry after ${error.nextRetryAt} or restore the dependency.`
      : "Hosted-kernel replay health is failed; restore the dependency before continuing.";
  }
  if (error.code === "operational_health_observation_stale") {
    return "Refresh hosted-kernel replay health before dispatching live replay.";
  }
  if (error.code === "operational_health_retry_budget_exhausted") {
    return "Escalate replay dependency recovery; the retry budget is exhausted.";
  }
  if (error.code === "operational_health_degraded_ack_required" || error.code === "dependency_degraded") {
    return "Acknowledge degraded mode or wait for replay dependencies to recover before live replay.";
  }
  if (error.code === "operational_health_degraded_preview_only") {
    return "Switch to dry-run preview while replay dependencies are degraded.";
  }
  if (error.code === "operational_health_degraded_live_blocked") {
    return "Wait for replay dependencies to recover before live replay.";
  }
  return "Review this field before accepting the replay.";
}

function buildAcceptanceContract({ command, preview, replayPlan, nextAction, validationSummary, providerContract, workspaceBoundary, operationalHealth }) {
  const proofSatisfied = preview.proofCoverage.complete;
  const hasSelectedEvents = preview.selection.selected > 0;
  const readyState = nextAction.state === "ready" || nextAction.state === "scheduled" || nextAction.state === "waiting";
  const healthAcceptable = operationalHealth.status !== "failed"
    && (
      preview.mode === "dry-run"
        ? operationalHealth.failureState.canPreview
        : operationalHealth.failureState.canDispatch
    );
  const accepted = validationSummary.status === "valid"
    && proofSatisfied
    && hasSelectedEvents
    && providerContract.missingCapabilities.length === 0
    && providerContract.serviceContract.contractValid
    && workspaceBoundary.authorized
    && healthAcceptable
    && replayPlan.planReady
    && readyState;

  return {
    kind: "event-replay-acceptance",
    accepted,
    acceptedAtCommand: command,
    acceptToken: accepted
      ? [
        surfaceId,
        preview.batchId,
        preview.mode,
        String(preview.selection.selected),
        providerContract.providerId,
        workspaceBoundary.tenantId,
        workspaceBoundary.workspaceId
      ].join(":")
      : null,
    requirements: {
      validationPassed: validationSummary.status === "valid",
    providerNegotiated: providerContract.missingCapabilities.length === 0
        && providerContract.serviceContract.contractValid,
      boundaryAuthorized: workspaceBoundary.authorized,
      operationalHealthAcceptable: healthAcceptable,
      replayPlanIntegrityValid: replayPlan.integrity.valid,
      replayPlanReady: replayPlan.planReady,
      proofSatisfied,
      hasSelectedEvents,
      readyState
    },
    rejectReasons: [
      validationSummary.status !== "valid" ? "validation_failed" : null,
      providerContract.missingCapabilities.length > 0 ? "provider_capability_gap" : null,
      !providerContract.serviceContract.contractValid ? "provider_service_contract_invalid" : null,
      !workspaceBoundary.authorized ? "workspace_boundary_blocked" : null,
      !healthAcceptable ? operationalHealth.status === "failed" ? "operational_health_failed" : "operational_health_degraded" : null,
      !replayPlan.integrity.valid ? "replay_plan_integrity_invalid" : null,
      ...replayPlan.integrity.errors.map((error) => error.code),
      !replayPlan.planReady ? "replay_plan_not_ready" : null,
      !proofSatisfied ? "proof_coverage_incomplete" : null,
      !hasSelectedEvents ? "no_replayable_events_selected" : null,
      !readyState ? nextAction.reason : null
    ].filter(Boolean)
  };
}

function buildReadinessContract({ settings, preview, replayPlan, acceptance, nextAction, integration, persistedOutput, operationalHealth }) {
  const state = acceptance.accepted
    ? settings.replay.dryRun
      ? "preview-ready"
      : "execution-ready"
    : nextAction.state;
  const proofEndpointReady = integration.provider.serviceContract.endpointReadiness
    .some((endpoint) => endpoint.kind === "proof" && endpoint.ready);
  const replayEndpointReady = integration.provider.serviceContract.endpointReadiness
    .some((endpoint) => endpoint.kind === "replay" && endpoint.ready);
  const restartSafeState = persistedOutput.idempotency.duplicateCommand
    ? "idempotent-replay"
    : persistedOutput.restart.detected
      ? persistedOutput.restart.status
      : "current";
  const recoveryBlocking = persistedOutput.restart.providerStatusRequired
    || persistedOutput.restart.restartSafe === false
    || persistedOutput.lease.reclaimable === false;

  return {
    kind: "event-replay-readiness",
    state,
    persistedStatus: persistedOutput.status,
    restartSafeState,
    recovery: {
      path: persistedOutput.restart.recoveryPath,
      hint: persistedOutput.restart.recoveryHint,
      restartSafe: persistedOutput.restart.restartSafe,
      providerStatusRequired: persistedOutput.restart.providerStatusRequired,
      operatorAction: persistedOutput.restart.operatorAction,
      blocking: recoveryBlocking,
      lease: persistedOutput.lease,
      checkpoint: persistedOutput.recoveryCheckpoint,
      statusJournalSize: persistedOutput.statusJournal.length
    },
    canPreview: preview.selection.selected > 0
      && preview.proofCoverage.complete
      && operationalHealth.failureState.canPreview,
    canAccept: acceptance.accepted
      && !persistedOutput.idempotency.ignoredMutation
      && !recoveryBlocking,
    canExecute: acceptance.accepted
      && !settings.replay.dryRun
      && replayPlan.planReady
      && !persistedOutput.idempotency.ignoredMutation
      && !persistedOutput.restart.providerStatusRequired
      && operationalHealth.failureState.canDispatch
      && replayEndpointReady,
    canExportProof: integration.provider.capabilities.includes("proof-export") && proofEndpointReady,
    providerReceipt: {
      schemaVersion: integration.provider.receipt.schemaVersion,
      state: integration.provider.receipt.state,
      kind: integration.provider.receipt.kind,
      required: integration.provider.receipt.required,
      requiredReasons: integration.provider.receipt.requiredReasons,
      acknowledged: integration.provider.receipt.acknowledged,
      externalTicketId: integration.provider.receipt.externalTicketId,
      acknowledgedAt: integration.provider.receipt.acknowledgedAt,
      expiresAt: integration.provider.receipt.expiresAt
    },
    providerServiceContract: {
      negotiatedProtocolVersion: integration.provider.serviceContract.negotiatedProtocolVersion,
      deliveryGuarantee: integration.provider.serviceContract.deliveryGuarantee,
      authMode: integration.provider.serviceContract.providerAuthMode,
      contractValid: integration.provider.serviceContract.contractValid,
      missingEndpointKinds: integration.provider.serviceContract.missingEndpointKinds
    },
    healthStatus: operationalHealth.status,
    degradedMode: {
      active: operationalHealth.status === "degraded",
      policy: operationalHealth.degradedModePolicy,
      acknowledged: operationalHealth.degradedModeAcknowledged,
      required: operationalHealth.failureState.degradedModeRequired
    },
    healthGate: {
      state: operationalHealth.failureState.state,
      canPreview: operationalHealth.failureState.canPreview,
      canAccept: operationalHealth.failureState.canAccept,
      canDispatch: operationalHealth.failureState.canDispatch,
      operatorAction: operationalHealth.failureState.operatorAction,
      retryBudget: operationalHealth.failureState.retryBudget
    },
    retry: operationalHealth.retry,
    replayMode: preview.mode,
    replayPlanReady: replayPlan.planReady,
    replayPlanManifest: replayPlan.manifest,
    replayPlanIntegrity: replayPlan.integrity,
    batchId: preview.batchId,
    cursor: integration.sync.cursor,
    scheduleMode: settings.schedule.mode,
    scheduleWindow: settings.schedule.windowPolicy,
    lifecycleTransition: {
      requested: settings.lifecycleTransition?.requested || false,
      reason: settings.lifecycleTransition?.reason || null,
      changedFields: settings.lifecycleTransition?.changedFields || [],
      appliedFields: integration.lifecycleTransition?.appliedFields || [],
      pendingFields: (settings.lifecycleTransition?.changedFields || [])
        .filter((field) => !(integration.lifecycleTransition?.appliedFields || []).includes(field))
    },
    lifecycleControls: {
      allowed: integration.lifecycleControls.allowed,
      denialCode: integration.lifecycleControls.denialCode,
      maintenanceLock: integration.lifecycleControls.maintenanceLock,
      requireScheduleWindow: integration.lifecycleControls.requireScheduleWindow
    },
    recoveryHint: persistedOutput.restart.recoveryHint,
    recoveryPath: persistedOutput.restart.recoveryPath,
    recoveryOperatorAction: persistedOutput.restart.operatorAction,
    providerStatusRequired: persistedOutput.restart.providerStatusRequired,
    commandKey: persistedOutput.lastCommandKey
  };
}

function buildWorkflowHandoffContract({ command, clientRuntime, handoff, preview, acceptance, readiness, validationSummary, workspaceBoundary, operationalHealth }) {
  const blocked = validationSummary.status !== "valid" || readiness.state === "blocked";
  const replayAlreadyApplied = readiness.restartSafeState === "idempotent-replay";
  const continuation = clientRuntime.continuation;
  const handoffAction = replayAlreadyApplied
    ? "show-existing-replay-status"
    : handoff.requested
    ? handoff.transferable && acceptance.accepted
      ? "send-external-handoff"
      : "prepare-external-handoff"
    : acceptance.accepted
      ? preview.mode === "dry-run"
        ? "open-preview"
        : "execute-replay"
      : "continue-setup";
  const continuationAction = blocked
    ? "status"
    : replayAlreadyApplied
      ? "status"
      : handoffAction === "send-external-handoff"
        ? "handoff"
        : handoffAction === "execute-replay"
          ? "dispatch"
          : handoffAction === "open-preview"
            ? "preview"
            : continuation.preferredAction;
  const continuationTarget = continuation.mode === "callback"
    ? continuation.callbackUrl
    : continuation.mode === "route"
      ? `${continuation.returnRoute}/${continuation.routeSuffix}/${preview.batchId}/${continuationAction}`
      : continuation.mode === "inline"
        ? "inline-client-state"
        : null;

  return {
    kind: "event-replay-workflow-handoff",
    requestId: clientRuntime.requestId,
    workflowId: clientRuntime.workflowId,
    actorId: clientRuntime.actorId,
    tenantId: workspaceBoundary.tenantId,
    workspaceId: workspaceBoundary.workspaceId,
    displayMode: clientRuntime.displayMode,
    returnRoute: clientRuntime.returnRoute,
    continuation: {
      schemaVersion: continuation.schemaVersion,
      mode: continuation.mode,
      action: continuationAction,
      target: continuationTarget,
      method: continuation.mode === "callback" ? continuation.callbackMethod : "GET",
      stateToken: continuation.stateToken,
      requireOperatorAck: continuation.requireOperatorAck,
      includeProofPackage: continuation.includeProofPackage,
      includeHostedKernelInvocation: continuation.includeHostedKernelInvocation,
      deliverable: !blocked && (
        continuation.mode === "inline"
        || continuation.mode === "deferred"
        || Boolean(continuationTarget)
      )
    },
    intent: clientRuntime.intent,
    blocked,
    primaryAction: blocked ? "resolve-blockers" : handoffAction,
    primaryLabel: blocked
      ? "Resolve replay blockers"
      : replayAlreadyApplied
        ? "Show replay status"
      : handoffAction === "send-external-handoff"
        ? "Send handoff package"
        : handoffAction === "execute-replay"
          ? "Execute replay"
          : handoffAction === "open-preview"
            ? "Open replay preview"
            : "Continue replay setup",
    statusText: blocked
      ? operationalHealth.status === "failed"
        ? operationalHealth.failureState.operatorAction
        : operationalHealth.status === "degraded"
          ? operationalHealth.failureState.operatorAction
          : "Replay needs operator attention before it can continue."
      : replayAlreadyApplied
        ? `Replay command ${readiness.commandKey} was already applied; returning persisted status ${readiness.persistedStatus}.`
      : acceptance.accepted
        ? `Replay ${preview.batchId} is ready for ${preview.mode === "dry-run" ? "preview" : "execution"}.`
        : "Replay setup is waiting for the next operator step.",
    continuationInput: {
      surfaceId,
      command: replayAlreadyApplied ? "inspect" : acceptance.accepted && preview.mode !== "dry-run" ? "replay-now" : command,
      batchId: preview.batchId,
      cursor: preview.cursor,
      handoffTarget: handoff.target,
      selectedEventCount: preview.selection.selected,
      persistedStatus: readiness.persistedStatus,
      commandKey: readiness.commandKey,
      tenantId: workspaceBoundary.tenantId,
      workspaceId: workspaceBoundary.workspaceId
    },
    continuationEnvelope: {
      schemaVersion: "aios.auditRecovery.eventReplay.workflowContinuationEnvelope.v1",
      mode: continuation.mode,
      action: continuationAction,
      target: continuationTarget,
      method: continuation.mode === "callback" ? continuation.callbackMethod : "GET",
      requestId: clientRuntime.requestId,
      workflowId: clientRuntime.workflowId,
      stateToken: continuation.stateToken,
      batchId: preview.batchId,
      cursor: preview.cursor,
      accepted: acceptance.accepted,
      readinessState: readiness.state,
      healthGateState: readiness.healthGate.state,
      replayMode: preview.mode,
      selectedEventCount: preview.selection.selected,
      includeProofPackage: continuation.includeProofPackage && readiness.canExportProof,
      includeHostedKernelInvocation: continuation.includeHostedKernelInvocation
    },
    blockingReasons: blocked
      ? validationSummary.userVisible.map((error) => ({
        field: error.field,
        code: error.code,
        message: error.message
      }))
      : [],
    auditTags: [
      clientRuntime.interactive ? "interactive-client" : "headless-client",
      `intent:${clientRuntime.intent}`,
      `tenant:${workspaceBoundary.tenantId}`,
      `workspace:${workspaceBoundary.workspaceId}`,
      workspaceBoundary.authorized ? "boundary-authorized" : "boundary-blocked",
      workspaceBoundary.crossTenantHandoff ? "cross-tenant-handoff" : "single-tenant",
      `health:${operationalHealth.status}`,
      `continuation:${continuation.mode}`,
      `continuation-action:${continuationAction}`,
      continuation.stateToken ? "continuation-state-token" : "continuation-stateless",
      `provider-protocol:${readiness.providerServiceContract.negotiatedProtocolVersion || "unnegotiated"}`,
      `delivery:${readiness.providerServiceContract.deliveryGuarantee}`,
      readiness.providerServiceContract.contractValid ? "provider-contract-valid" : "provider-contract-invalid",
      operationalHealth.retry.retryable ? "health-retryable" : "health-stable",
      readiness.lifecycleControls.allowed ? "lifecycle-command-allowed" : "lifecycle-command-denied",
      readiness.lifecycleControls.maintenanceLock ? "maintenance-lock-active" : "maintenance-lock-clear",
      replayAlreadyApplied ? "idempotent-command" : "new-command",
      handoff.requested ? "handoff-requested" : "local-workflow"
    ]
  };
}

function buildExplainableNextSteps({ nextAction, validationSummary, acceptance, preview, workflowHandoff, operationalHealth }) {
  if (!acceptance.accepted && operationalHealth.status === "failed") {
    return [{
      id: "wait-for-operational-health",
      label: "Wait for replay health",
      reason: "operational_health_failed",
      command: "inspect",
      enabled: operationalHealth.retry.retryable,
      retry: operationalHealth.retry,
      errors: operationalHealth.actionableErrors,
      operatorAction: operationalHealth.failureState.operatorAction
    }];
  }

  if (!acceptance.accepted && operationalHealth.failureState.stale) {
    return [{
      id: "refresh-operational-health",
      label: "Refresh replay health",
      reason: "operational_health_observation_stale",
      command: "inspect",
      enabled: true,
      retry: operationalHealth.retry,
      errors: operationalHealth.actionableErrors,
      operatorAction: operationalHealth.failureState.operatorAction
    }];
  }

  if (acceptance.accepted) {
    return [{
      id: "continue-accepted-replay",
      label: workflowHandoff.primaryLabel,
      reason: "replay_acceptance_complete",
      command: workflowHandoff.continuationInput.command,
      workflowId: workflowHandoff.workflowId,
      enabled: true
    }];
  }

  const validationStep = validationSummary.status === "valid"
    ? []
    : [{
      id: "resolve-validation-errors",
      label: "Resolve validation errors",
      reason: "validation_failed",
      command: "inspect",
      enabled: true,
      errors: validationSummary.userVisible
    }];

  const actionStep = {
    id: `next-${nextAction.action}`,
    label: nextAction.action,
    reason: nextAction.reason,
    command: nextAction.action === "enable" ? "enable" : nextAction.action === "request-manual-replay" ? "replay-now" : "inspect",
    enabled: validationSummary.status === "valid"
  };

  return [...validationStep, actionStep];
}

function buildClientPreviewAcceptanceContract({
  command,
  preview,
  replayPlan,
  acceptance,
  readiness,
  validationSummary,
  workflowHandoff,
  explainableNextSteps,
  hostedKernelInvocation,
  providerContract,
  workspaceBoundary,
  operationalHealth,
  sync
}) {
  const rowByEventId = new Map(replayPlan.entries.map((entry) => [entry.eventId, entry]));
  const previewRows = preview.selectedEvents.slice(0, 25).map((event) => {
    const planEntry = rowByEventId.get(event.id);
    return {
      eventId: event.id,
      title: `${event.stream}:${event.type}`,
      subtitle: event.aggregateId || event.sourceCursor || sync.cursor || "unscoped event",
      timestamp: event.timestamp,
      operation: event.operation,
      proofId: event.proofId,
      checkpoint: planEntry?.checkpoint || null,
      routeKey: planEntry?.routeKey || null,
      tenantId: planEntry?.tenantId || workspaceBoundary.tenantId,
      workspaceId: planEntry?.workspaceId || workspaceBoundary.workspaceId,
      replayMode: preview.mode,
      selectable: Boolean(planEntry?.execution.executable),
      boundaryAuthorized: planEntry?.boundary.authorized || false,
      blockedBy: planEntry?.execution.blockedBy || []
    };
  });
  const validationBanner = validationSummary.status === "valid"
    ? {
      tone: "success",
      title: "Replay validation passed",
      message: `${preview.selection.selected} event${preview.selection.selected === 1 ? "" : "s"} ready for ${preview.mode}.`
    }
    : {
      tone: operationalHealth.status === "failed" ? "critical" : "warning",
      title: "Replay validation needs attention",
      message: `${validationSummary.errorCount} blocker${validationSummary.errorCount === 1 ? "" : "s"} must be resolved before acceptance.`
    };
  const acceptanceBlockers = acceptance.rejectReasons.map((reason) => ({
    reason,
    message: validationSummary.userVisible.find((error) => error.code === reason)?.message
      || reason.replaceAll("_", " ")
  }));
  const acceptancePayload = {
    schemaVersion: "aios.auditRecovery.eventReplay.clientAcceptancePayload.v1",
    acceptToken: acceptance.acceptToken,
    command,
    batchId: preview.batchId,
    cursor: preview.cursor,
    tenantId: workspaceBoundary.tenantId,
    workspaceId: workspaceBoundary.workspaceId,
    selectedEventIds: preview.selection.selectedEventIds,
    selectedEventCount: preview.selection.selected,
    replayMode: preview.mode,
    proofExportRequired: preview.proofCoverage.required,
    providerId: providerContract.providerId,
    protocolVersion: providerContract.serviceContract.negotiatedProtocolVersion,
    dispatchable: hostedKernelInvocation.dispatchable,
    dispatchBlockers: hostedKernelInvocation.dispatchBlockers,
    continuation: workflowHandoff.continuationEnvelope
  };
  const readinessBadges = [
    {
      id: "provider-contract",
      label: "Provider",
      state: providerContract.serviceContract.contractValid ? "ready" : "blocked",
      detail: providerContract.serviceContract.negotiatedProtocolVersion || "protocol not negotiated"
    },
    {
      id: "provider-receipt",
      label: "Receipt",
      state: readiness.providerReceipt.required
        ? readiness.providerReceipt.acknowledged ? "ready" : "blocked"
        : readiness.providerReceipt.state,
      detail: readiness.providerReceipt.externalTicketId
        || readiness.providerReceipt.acknowledgedAt
        || readiness.providerReceipt.state
    },
    {
      id: "workspace-boundary",
      label: "Boundary",
      state: workspaceBoundary.authorized ? "ready" : "blocked",
      detail: workspaceBoundary.authorized ? workspaceBoundary.workspaceId : "permission required"
    },
    {
      id: "proof-coverage",
      label: "Proof",
      state: preview.proofCoverage.complete ? "ready" : "blocked",
      detail: preview.proofCoverage.required
        ? `${preview.proofCoverage.missingForSelected} missing`
        : "optional"
    },
    {
      id: "health",
      label: "Health",
      state: operationalHealth.status === "ok" ? "ready" : operationalHealth.status,
      detail: operationalHealth.failureState.state,
      action: operationalHealth.failureState.operatorAction,
      retryAt: operationalHealth.retry.nextRetryAt
    },
    {
      id: "dispatch",
      label: "Dispatch",
      state: hostedKernelInvocation.dispatchable ? "ready" : "blocked",
      detail: `${hostedKernelInvocation.dispatchableOperationCount}/${hostedKernelInvocation.operationCount} operations`
    }
  ];

  return {
    schemaVersion: "aios.auditRecovery.eventReplay.clientPreviewAcceptance.v1",
    route: workflowHandoff.returnRoute,
    workflowId: workflowHandoff.workflowId,
    requestId: workflowHandoff.requestId,
    displayMode: workflowHandoff.displayMode,
    validationBanner,
    previewRows,
    overflowNotice: preview.selection.overflow > 0
      ? `${preview.selection.overflow} replayable event${preview.selection.overflow === 1 ? "" : "s"} deferred by maxEventsPerRun.`
      : null,
    acceptance: {
      accepted: acceptance.accepted,
      canAccept: readiness.canAccept,
      blockers: acceptanceBlockers,
      payload: acceptancePayload
    },
    readinessBadges,
    nextStepCards: explainableNextSteps.map((step) => ({
      id: step.id,
      label: step.label,
      reason: step.reason,
      command: step.command,
      enabled: step.enabled,
      retryAt: step.retry?.nextRetryAt || null,
      errorCount: Array.isArray(step.errors) ? step.errors.length : 0,
      operatorAction: step.operatorAction || null
    })),
    routeContracts: {
      continuation: {
        mode: workflowHandoff.continuation.mode,
        action: workflowHandoff.continuation.action,
        target: workflowHandoff.continuation.target,
        method: workflowHandoff.continuation.method,
        enabled: workflowHandoff.continuation.deliverable,
        bodySchema: workflowHandoff.continuationEnvelope.schemaVersion
      },
      preview: {
        href: `${workflowHandoff.returnRoute}/event-replay/${preview.batchId}/preview`,
        method: "GET",
        enabled: readiness.canPreview
      },
      accept: {
        href: `${workflowHandoff.returnRoute}/event-replay/${preview.batchId}/accept`,
        method: "POST",
        enabled: readiness.canAccept,
        bodySchema: acceptancePayload.schemaVersion
      },
      proofExport: {
        href: `${workflowHandoff.returnRoute}/event-replay/${preview.batchId}/proof`,
        method: "POST",
        enabled: readiness.canExportProof,
        endpoint: hostedKernelInvocation.endpoints.proof
      },
      dispatch: {
        href: `${workflowHandoff.returnRoute}/event-replay/${preview.batchId}/dispatch`,
        method: "POST",
        enabled: hostedKernelInvocation.dispatchable,
        endpoint: preview.mode === "live-replay"
          ? hostedKernelInvocation.endpoints.replay
          : hostedKernelInvocation.endpoints.scan
      }
    }
  };
}

function buildOperatorDecisionContract({
  command,
  preview,
  acceptance,
  readiness,
  validationSummary,
  workflowHandoff,
  clientPreviewAcceptance,
  hostedKernelInvocation,
  providerContract,
  providerReceipt,
  workspaceBoundary,
  operationalHealth,
  replayPlan
}) {
  const blockingCodes = Array.from(new Set([
    ...acceptance.rejectReasons,
    ...hostedKernelInvocation.dispatchBlockers,
    ...validationSummary.userVisible.map((error) => error.code),
    ...operationalHealth.actionableErrors.map((error) => error.code || "operational_health_action_required")
  ].filter(Boolean)));
  const acknowledgementRequired = [
    workflowHandoff.continuation.requireOperatorAck ? "client_continuation_ack_required" : null,
    operationalHealth.failureState.degradedModeRequired ? "degraded_mode_ack_required" : null,
    providerReceipt.required && !providerReceipt.acknowledged ? "provider_receipt_ack_required" : null,
    workspaceBoundary.crossTenantHandoff ? "cross_tenant_handoff_ack_recommended" : null
  ].filter(Boolean);
  const submitActions = [
    {
      id: "preview",
      label: "Open replay preview",
      command: "inspect",
      method: clientPreviewAcceptance.routeContracts.preview.method,
      href: clientPreviewAcceptance.routeContracts.preview.href,
      enabled: clientPreviewAcceptance.routeContracts.preview.enabled,
      requiresAcceptance: false,
      payloadSchema: null
    },
    {
      id: "accept",
      label: "Accept replay selection",
      command,
      method: clientPreviewAcceptance.routeContracts.accept.method,
      href: clientPreviewAcceptance.routeContracts.accept.href,
      enabled: clientPreviewAcceptance.routeContracts.accept.enabled && acknowledgementRequired.length === 0,
      requiresAcceptance: false,
      payloadSchema: clientPreviewAcceptance.routeContracts.accept.bodySchema
    },
    {
      id: "export-proof",
      label: "Export proof package",
      command: "inspect",
      method: clientPreviewAcceptance.routeContracts.proofExport.method,
      href: clientPreviewAcceptance.routeContracts.proofExport.href,
      enabled: clientPreviewAcceptance.routeContracts.proofExport.enabled,
      requiresAcceptance: true,
      payloadSchema: "aios.auditRecovery.eventReplay.proofExportRequest.v1"
    },
    {
      id: "dispatch",
      label: preview.mode === "live-replay" ? "Dispatch live replay" : "Dispatch dry-run scan",
      command: preview.mode === "live-replay" ? "replay-now" : "inspect",
      method: clientPreviewAcceptance.routeContracts.dispatch.method,
      href: clientPreviewAcceptance.routeContracts.dispatch.href,
      enabled: clientPreviewAcceptance.routeContracts.dispatch.enabled,
      requiresAcceptance: true,
      payloadSchema: hostedKernelInvocation.schemaVersion
    }
  ];
  const recommendedAction = submitActions.find((action) => action.id === workflowHandoff.continuation.action)
    || submitActions.find((action) => action.enabled)
    || submitActions[0];

  return {
    schemaVersion: "aios.auditRecovery.eventReplay.clientOperatorDecision.v1",
    decisionId: [
      surfaceId,
      workspaceBoundary.tenantId,
      workspaceBoundary.workspaceId,
      preview.batchId,
      readiness.state
    ].join(":"),
    command,
    state: acceptance.accepted
      ? hostedKernelInvocation.dispatchable
        ? "ready-to-dispatch"
        : "accepted-waiting"
      : validationSummary.status === "invalid"
        ? "blocked"
        : readiness.canAccept
          ? "ready-to-accept"
          : "preview-only",
    recommendedActionId: recommendedAction.id,
    recommendedActionLabel: recommendedAction.label,
    submitActions,
    acknowledgements: {
      required: acknowledgementRequired.length > 0,
      reasons: acknowledgementRequired,
      acceptedWarningCodes: operationalHealth.degradedModeAcknowledged
        ? ["operational_health_degraded"]
        : []
    },
    routePayloads: {
      accept: {
        schemaVersion: clientPreviewAcceptance.acceptance.payload.schemaVersion,
        acceptToken: clientPreviewAcceptance.acceptance.payload.acceptToken,
        batchId: preview.batchId,
        cursor: preview.cursor,
        selectedEventIds: preview.selection.selectedEventIds,
        selectedEventCount: preview.selection.selected,
        providerId: providerContract.providerId,
        protocolVersion: providerContract.serviceContract.negotiatedProtocolVersion,
        tenantId: workspaceBoundary.tenantId,
        workspaceId: workspaceBoundary.workspaceId
      },
      proofExport: {
        schemaVersion: "aios.auditRecovery.eventReplay.proofExportRequest.v1",
        exportId: [
          surfaceId,
          workspaceBoundary.tenantId,
          workspaceBoundary.workspaceId,
          preview.batchId,
          "proof"
        ].join(":"),
        batchId: preview.batchId,
        includeLineItems: true,
        lineItemLimit: Math.min(replayPlan.manifest.entryCount, 100),
        proofIds: replayPlan.manifest.proofIds,
        proofEndpoint: hostedKernelInvocation.endpoints.proof
      },
      dispatch: {
        schemaVersion: hostedKernelInvocation.schemaVersion,
        dispatchable: hostedKernelInvocation.dispatchable,
        endpoint: preview.mode === "live-replay"
          ? hostedKernelInvocation.endpoints.replay
          : hostedKernelInvocation.endpoints.scan,
        batchId: preview.batchId,
        operationCount: hostedKernelInvocation.operationCount,
        dispatchableOperationCount: hostedKernelInvocation.dispatchableOperationCount,
        correlationKey: hostedKernelInvocation.statusPoll.correlationKey
      }
    },
    validationRollup: {
      status: validationSummary.status,
      blockingCodes,
      firstBlockingMessage: validationSummary.userVisible[0]?.message || null,
      healthGateState: operationalHealth.failureState.state,
      providerReceiptState: providerReceipt.state,
      replayPlanReady: replayPlan.planReady,
      replayPlanIntegrityValid: replayPlan.integrity.valid,
      replayPlanIntegrityErrors: replayPlan.integrity.errors,
      dispatchable: hostedKernelInvocation.dispatchable
    }
  };
}

function buildClientContinuationResumeContract({
  now,
  clientRuntime,
  workflowHandoff,
  clientOperatorDecision,
  hostedKernelInvocation,
  readiness,
  preview,
  acceptance,
  providerReceipt,
  validationSummary,
  operationalHealth,
  persistedOutput
}) {
  const continuation = workflowHandoff.continuation;
  const routePayloads = clientOperatorDecision.routePayloads;
  const blockedCodes = clientOperatorDecision.validationRollup.blockingCodes;
  const terminal = readiness.state === "completed" || readiness.state === "failed";
  const waitingOnProviderReceipt = providerReceipt.required && !providerReceipt.acknowledged;
  const waitingOnHealthRetry = operationalHealth.retry.retryable
    && (operationalHealth.status === "failed" || operationalHealth.failureState.stale);
  const resumeAfter = waitingOnProviderReceipt
    ? providerReceipt.expiresAt || hostedKernelInvocation.statusPoll.lastProviderReceipt?.acknowledgedAt || null
    : waitingOnHealthRetry
      ? operationalHealth.retry.nextRetryAt
      : null;
  const resumeState = terminal
    ? "terminal"
    : validationSummary.status === "invalid"
      ? "blocked"
      : acceptance.accepted
        ? hostedKernelInvocation.dispatchable
          ? "dispatch-ready"
          : waitingOnProviderReceipt
            ? "waiting-provider-receipt"
            : "accepted-waiting"
        : readiness.canAccept
          ? "acceptance-ready"
          : "preview-ready";
  const resumeCommand = resumeState === "dispatch-ready"
    ? preview.mode === "live-replay" ? "replay-now" : "inspect"
    : resumeState === "acceptance-ready"
      ? workflowHandoff.continuationInput.command
      : "inspect";
  const resumeTarget = continuation.target || routePayloads.dispatch.endpoint || hostedKernelInvocation.statusPoll.endpoint;
  const statusPollEnabled = Boolean(hostedKernelInvocation.statusPoll.endpoint)
    && !terminal
    && (
      hostedKernelInvocation.dispatchable
      || waitingOnProviderReceipt
      || waitingOnHealthRetry
      || persistedOutput.restart.providerStatusRequired
      || persistedOutput.restart.detected
    );
  const visibleActions = clientOperatorDecision.submitActions.map((action) => ({
    id: action.id,
    label: action.label,
    command: action.command,
    href: action.href,
    method: action.method,
    enabled: action.enabled,
    current: action.id === clientOperatorDecision.recommendedActionId,
    disabledReason: action.enabled
      ? null
      : blockedCodes[0] || hostedKernelInvocation.dispatchBlockers[0] || "not_ready"
  }));

  return {
    schemaVersion: "aios.auditRecovery.eventReplay.clientContinuationResume.v1",
    createdAt: now,
    requestId: clientRuntime.requestId,
    workflowId: clientRuntime.workflowId,
    actorId: clientRuntime.actorId,
    resumeState,
    resumeCommand,
    resumeAfter,
    terminal,
    correlation: {
      commandKey: readiness.commandKey,
      batchId: preview.batchId,
      cursor: preview.cursor,
      acceptToken: acceptance.acceptToken,
      statusPollKey: hostedKernelInvocation.statusPoll.correlationKey,
      providerExternalTicketId: providerReceipt.externalTicketId
    },
    delivery: {
      mode: continuation.mode,
      action: continuation.action,
      target: resumeTarget,
      method: continuation.method,
      deliverable: continuation.deliverable,
      stateToken: continuation.stateToken,
      includeProofPackage: workflowHandoff.continuationEnvelope.includeProofPackage,
      includeHostedKernelInvocation: workflowHandoff.continuationEnvelope.includeHostedKernelInvocation
    },
    statusPoll: {
      enabled: statusPollEnabled,
      endpoint: hostedKernelInvocation.statusPoll.endpoint,
      method: "GET",
      intervalMs: operationalHealth.status === "failed" ? 15000 : 5000,
      correlationKey: hostedKernelInvocation.statusPoll.correlationKey,
      stopWhen: terminal ? "terminal" : acceptance.accepted ? "provider-receipt-acknowledged" : "operator-action"
    },
    routePayloads: {
      accept: routePayloads.accept,
      proofExport: routePayloads.proofExport,
      dispatch: routePayloads.dispatch,
      status: {
        schemaVersion: "aios.auditRecovery.eventReplay.statusResumeRequest.v1",
        batchId: preview.batchId,
        cursor: preview.cursor,
        commandKey: readiness.commandKey,
        providerReceiptState: providerReceipt.state,
        healthGateState: operationalHealth.failureState.state,
        persistedStatus: readiness.persistedStatus
      }
    },
    visibleActions,
    handoffMessage: acceptance.accepted
      ? hostedKernelInvocation.dispatchable
        ? `Replay ${preview.batchId} can continue with ${clientOperatorDecision.recommendedActionLabel}.`
        : waitingOnProviderReceipt
          ? "Replay acceptance is recorded; waiting for provider receipt acknowledgement."
          : "Replay acceptance is recorded; waiting for dispatch blockers to clear."
      : validationSummary.status === "invalid"
        ? "Replay continuation is blocked until validation errors are resolved."
        : "Replay preview is ready for operator acceptance.",
    blockedBy: blockedCodes,
    restart: {
      detected: persistedOutput.restart.detected,
      status: persistedOutput.restart.status,
      recoveryHint: persistedOutput.restart.recoveryHint,
      recoveryPath: persistedOutput.restart.recoveryPath,
      restartSafe: persistedOutput.restart.restartSafe,
      providerStatusRequired: persistedOutput.restart.providerStatusRequired,
      operatorAction: persistedOutput.restart.operatorAction,
      lease: persistedOutput.lease,
      checkpoint: persistedOutput.recoveryCheckpoint
    }
  };
}

function buildAuditOutputs({
  lifecycle,
  providerContract,
  providerReceipt,
  sync,
  handoff,
  workspaceBoundary,
  workflowHandoff,
  persistedOutput,
  operationalHealth,
  replayPlan,
  hostedKernelInvocation,
  clientOperatorDecision,
  clientContinuationResume
}) {
  const integrationEvents = [
    providerContract.missingCapabilities.length > 0 ? "provider_capability_gap_detected" : "provider_capabilities_negotiated",
    providerContract.serviceContract.contractValid ? "provider_service_contract_valid" : "provider_service_contract_invalid",
    providerContract.serviceContract.negotiatedProtocolVersion
      ? `provider_protocol_${providerContract.serviceContract.negotiatedProtocolVersion}`
      : "provider_protocol_unnegotiated",
    `provider_delivery_${providerContract.serviceContract.deliveryGuarantee}`,
    providerReceipt.present ? `provider_receipt_${providerReceipt.state}` : "provider_receipt_absent",
    sync.cursorChanged ? "sync_cursor_advanced" : "sync_cursor_unchanged",
    workspaceBoundary.authorized ? "workspace_boundary_authorized" : "workspace_boundary_blocked",
    lifecycle.controlDecision.allowed ? "lifecycle_command_allowed" : "lifecycle_command_denied",
    `operational_health_${operationalHealth.status}`
  ];

  if (operationalHealth.retry.retryable) {
    integrationEvents.push("operational_health_retry_scheduled");
  }

  if (operationalHealth.failureState.retryBudget.exhausted) {
    integrationEvents.push("operational_health_retry_budget_exhausted");
  }

  if (operationalHealth.failureState.stale) {
    integrationEvents.push("operational_health_observation_stale");
  }

  if (operationalHealth.status === "degraded" && operationalHealth.degradedModeAcknowledged) {
    integrationEvents.push("degraded_mode_acknowledged");
  }

  if (persistedOutput.idempotency.duplicateCommand) {
    integrationEvents.push("idempotent_command_replayed");
  }

  if (persistedOutput.restart.detected) {
    integrationEvents.push(`restart_${persistedOutput.restart.status}`);
    integrationEvents.push(`recovery_path_${persistedOutput.restart.recoveryPath}`);
  }

  if (persistedOutput.restart.providerStatusRequired) {
    integrationEvents.push("recovery_provider_status_required");
  }

  if (persistedOutput.lease.present) {
    integrationEvents.push(persistedOutput.lease.reclaimable ? "recovery_lease_reclaimable" : "recovery_lease_active");
  }

  if (handoff.requested) {
    integrationEvents.push(handoff.transferable ? "external_handoff_ready" : "external_handoff_pending");
  }

  if (workspaceBoundary.crossTenantHandoff) {
    integrationEvents.push("cross_tenant_handoff_requested");
  }

  return {
    route: "audit-recovery/event-replay",
    lifecycleAppliedAt: lifecycle.lifecycleAppliedAt,
    controlEvents: lifecycle.controlEvents,
    providerEvents: integrationEvents,
    proofRequired: lifecycle.settings.replay.requireProof,
    providerServiceContract: {
      protocolVersion: providerContract.serviceContract.negotiatedProtocolVersion,
      authMode: providerContract.serviceContract.providerAuthMode,
      deliveryGuarantee: providerContract.serviceContract.deliveryGuarantee,
      contractValid: providerContract.serviceContract.contractValid,
      requiredEndpointKinds: providerContract.serviceContract.requiredEndpointKinds,
      missingEndpointKinds: providerContract.serviceContract.missingEndpointKinds
    },
    providerReceipt: {
      schemaVersion: providerReceipt.schemaVersion,
      state: providerReceipt.state,
      kind: providerReceipt.kind,
      required: providerReceipt.required,
      requiredReasons: providerReceipt.requiredReasons,
      acknowledged: providerReceipt.acknowledged,
      externalTicketId: providerReceipt.externalTicketId,
      acknowledgedAt: providerReceipt.acknowledgedAt,
      expiresAt: providerReceipt.expiresAt
    },
    lifecycleControl: {
      allowed: lifecycle.controlDecision.allowed,
      denialCode: lifecycle.controlDecision.denialCode,
      operatorAction: lifecycle.controlDecision.operatorAction,
      maintenanceLock: lifecycle.settings.lifecycleControls.maintenanceLock,
      lockReason: lifecycle.settings.lifecycleControls.lockReason,
      requireScheduleWindow: lifecycle.settings.lifecycleControls.requireScheduleWindow
    },
    lifecycleTransition: {
      schemaVersion: lifecycle.lifecycleTransition?.schemaVersion,
      requested: lifecycle.lifecycleTransition?.requested || false,
      reason: lifecycle.lifecycleTransition?.reason || null,
      changedFields: lifecycle.lifecycleTransition?.changedFields || [],
      appliedFields: lifecycle.appliedLifecycleFields || [],
      pendingFields: (lifecycle.lifecycleTransition?.changedFields || [])
        .filter((field) => !(lifecycle.appliedLifecycleFields || []).includes(field)),
      requestedSettings: lifecycle.lifecycleTransition?.requestedSettings || null
    },
    schedulePolicy: {
      mode: lifecycle.settings.schedule.mode,
      intervalMinutes: lifecycle.settings.schedule.intervalMinutes,
      window: lifecycle.settings.schedule.windowPolicy
    },
    syncBatchId: sync.batchId,
    handoffState: handoff.state,
    tenantId: workspaceBoundary.tenantId,
    workspaceId: workspaceBoundary.workspaceId,
    boundaryAuthorized: workspaceBoundary.authorized,
    missingBoundaryPermissions: workspaceBoundary.missingPermissions,
    workflowId: workflowHandoff.workflowId,
    workflowPrimaryAction: workflowHandoff.primaryAction,
    workflowAuditTags: workflowHandoff.auditTags,
    persistedStatus: persistedOutput.status,
    commandKey: persistedOutput.lastCommandKey,
    restartRecoveryHint: persistedOutput.restart.recoveryHint,
    restartRecoveryPath: persistedOutput.restart.recoveryPath,
    restartSafe: persistedOutput.restart.restartSafe,
    recoveryProviderStatusRequired: persistedOutput.restart.providerStatusRequired,
    recoveryOperatorAction: persistedOutput.restart.operatorAction,
    recoveryLease: persistedOutput.lease,
    recoveryCheckpoint: persistedOutput.recoveryCheckpoint,
    persistedStatusJournalSize: persistedOutput.statusJournal.length,
    replayPlanReady: replayPlan.planReady,
    replayPlanManifest: replayPlan.manifest,
    replayPlanIntegrity: replayPlan.integrity,
    hostedKernelDispatchable: hostedKernelInvocation.dispatchable,
    hostedKernelDispatchBlockers: hostedKernelInvocation.dispatchBlockers,
    hostedKernelOperationCount: hostedKernelInvocation.operationCount,
    hostedKernelDispatchableOperationCount: hostedKernelInvocation.dispatchableOperationCount,
    hostedKernelStatusPoll: hostedKernelInvocation.statusPoll,
    operatorDecisionId: clientOperatorDecision.decisionId,
    operatorDecisionState: clientOperatorDecision.state,
    operatorRecommendedAction: clientOperatorDecision.recommendedActionId,
    operatorAcknowledgementRequired: clientOperatorDecision.acknowledgements.required,
    continuationResumeState: clientContinuationResume.resumeState,
    continuationResumeCommand: clientContinuationResume.resumeCommand,
    continuationStatusPollEnabled: clientContinuationResume.statusPoll.enabled,
    continuationVisibleActions: clientContinuationResume.visibleActions.map((action) => ({
      id: action.id,
      enabled: action.enabled,
      current: action.current
    })),
    operationalHealthStatus: operationalHealth.status,
    operationalFailureState: operationalHealth.failureState,
    operationalHealthRetry: operationalHealth.retry,
    actionableHealthErrors: operationalHealth.actionableErrors
  };
}

function normalizePriorHistorySnapshots(input = {}) {
  const analytics = input.analytics && typeof input.analytics === "object" ? input.analytics : {};
  const history = input.history && typeof input.history === "object" ? input.history : {};
  const candidates = Array.isArray(analytics.historySnapshots)
    ? analytics.historySnapshots
    : Array.isArray(history.eventReplaySnapshots)
      ? history.eventReplaySnapshots
      : [];

  return candidates
    .map((snapshot, index) => {
      const candidate = snapshot && typeof snapshot === "object" ? snapshot : {};
      const observedAt = typeof candidate.observedAt === "string" && candidate.observedAt.trim()
        ? candidate.observedAt.trim()
        : null;
      const batchId = typeof candidate.batchId === "string" && candidate.batchId.trim()
        ? candidate.batchId.trim()
        : null;

      if (!observedAt && !batchId) {
        return null;
      }

      return {
        observedAt,
        batchId,
        command: normalizeLifecycleCommand(candidate.command),
        state: persistedReplayStates.has(candidate.state) ? candidate.state : "unknown",
        accepted: asBoolean(candidate.accepted, false),
        selectedEvents: asPositiveInteger(candidate.selectedEvents, 0),
        blockedEvents: asPositiveInteger(candidate.blockedEvents, 0),
        validationErrors: asPositiveInteger(candidate.validationErrors, 0),
        replayPlanBlockedEntries: asPositiveInteger(candidate.replayPlanBlockedEntries, 0),
        dispatchableOperations: asPositiveInteger(candidate.dispatchableOperations, 0),
        exportReady: asBoolean(candidate.exportReady, false),
        healthStatus: operationalHealthStates.has(candidate.healthStatus) ? candidate.healthStatus : "unknown",
        sequence: asPositiveInteger(candidate.sequence, index + 1)
      };
    })
    .filter(Boolean)
    .slice(-11);
}

function incrementCount(counts, key) {
  const normalizedKey = typeof key === "string" && key.trim() ? key.trim() : "unknown";
  counts[normalizedKey] = (counts[normalizedKey] || 0) + 1;
  return counts;
}

function buildReplayAnalyticsLedger({ replayPlan, preview, validationSummary, hostedKernelInvocation, operationalHealth }) {
  const executableEntryIds = new Set(
    replayPlan.entries
      .filter((entry) => entry.execution.executable)
      .map((entry) => entry.eventId)
  );
  const dispatchableOperationIds = new Set(
    hostedKernelInvocation.operations
      .filter((operation) => operation.dispatchable)
      .map((operation) => operation.event.id)
  );
  const selectedByStream = {};
  const selectedByType = {};
  const selectedByOperation = {};
  const blockedByReason = {};
  const blockedByScope = {};
  const proofByState = {
    required: 0,
    present: 0,
    missing: 0
  };

  for (const entry of replayPlan.entries) {
    incrementCount(selectedByStream, entry.stream);
    incrementCount(selectedByType, entry.type);
    incrementCount(selectedByOperation, entry.operation);

    if (entry.proof.required) {
      proofByState.required += 1;
      if (entry.proof.satisfied) {
        proofByState.present += 1;
      } else {
        proofByState.missing += 1;
      }
    }

    for (const reason of entry.execution.blockedBy) {
      incrementCount(blockedByReason, reason);
    }

    if (!entry.boundary.authorized) {
      incrementCount(blockedByScope, `${entry.tenantId}/${entry.workspaceId}`);
    }
  }

  const exportLineItems = replayPlan.entries.map((entry) => ({
    eventId: entry.eventId,
    checkpoint: entry.checkpoint,
    stream: entry.stream,
    type: entry.type,
    operation: entry.operation,
    routeKey: entry.routeKey,
    proofId: entry.proof.proofId,
    proofSatisfied: entry.proof.satisfied,
    executable: executableEntryIds.has(entry.eventId),
    dispatchable: dispatchableOperationIds.has(entry.eventId),
    blockedBy: entry.execution.blockedBy,
    tenantId: entry.tenantId,
    workspaceId: entry.workspaceId
  }));

  return {
    schemaVersion: "aios.auditRecovery.eventReplay.analyticsLedger.v1",
    selectedByStream,
    selectedByType,
    selectedByOperation,
    blockedByReason,
    blockedByScope,
    proofByState,
    validationHotspots: validationSummary.userVisible.map((error) => ({
      field: error.field,
      code: error.code
    })),
    health: {
      status: operationalHealth.status,
      gateState: operationalHealth.failureState.state,
      retryable: operationalHealth.retry.retryable,
      actionableErrorCount: operationalHealth.actionableErrors.length
    },
    exportLineItems,
    totals: {
      receivedEvents: preview.selection.received,
      selectedEvents: preview.selection.selected,
      executableEntries: executableEntryIds.size,
      dispatchableOperations: dispatchableOperationIds.size,
      uniqueStreams: Object.keys(selectedByStream).length,
      uniqueTypes: Object.keys(selectedByType).length,
      blockerKinds: Object.keys(blockedByReason).length,
      blockedScopes: Object.keys(blockedByScope).length
    }
  };
}

function buildReportingState({
  input,
  now,
  command,
  providerContract,
  providerReceipt,
  sync,
  preview,
  replayPlan,
  validationSummary,
  acceptance,
  readiness,
  workflowHandoff,
  persistedOutput,
  workspaceBoundary,
  operationalHealth,
  hostedKernelInvocation,
  clientContinuationResume,
  audit
}) {
  const priorSnapshots = normalizePriorHistorySnapshots(input);
  const selectedRatio = preview.selection.received > 0
    ? Number((preview.selection.selected / preview.selection.received).toFixed(4))
    : 0;
  const proofCoverageRatio = preview.selection.selected > 0
    ? Number(((preview.selection.selected - preview.proofCoverage.missingForSelected) / preview.selection.selected).toFixed(4))
    : 1;
  const validationHotspots = Object.entries(validationSummary.fields)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([field, count]) => ({ field, count }));
  const exportReady = acceptance.accepted
    && readiness.canExportProof
    && replayPlan.planReady
    && providerContract.serviceContract.contractValid
    && preview.proofCoverage.complete
    && workspaceBoundary.authorized;
  const exportBlockers = [
    !acceptance.accepted ? "replay_not_accepted" : null,
    !replayPlan.planReady ? "replay_plan_not_ready" : null,
    !replayPlan.integrity.valid ? "replay_plan_integrity_invalid" : null,
    !readiness.canExportProof ? "proof_export_not_negotiated" : null,
    !providerContract.serviceContract.contractValid ? "provider_service_contract_invalid" : null,
    !preview.proofCoverage.complete ? "proof_coverage_incomplete" : null,
    !workspaceBoundary.authorized ? "workspace_boundary_blocked" : null
  ].filter(Boolean);
  const analyticsLedger = buildReplayAnalyticsLedger({
    replayPlan,
    preview,
    validationSummary,
    hostedKernelInvocation,
    operationalHealth
  });
  const currentSnapshot = {
    observedAt: now,
    batchId: sync.batchId,
    command,
    state: readiness.state,
    accepted: acceptance.accepted,
    selectedEvents: preview.selection.selected,
    blockedEvents: preview.selection.blocked,
    validationErrors: validationSummary.errorCount,
    replayPlanBlockedEntries: replayPlan.manifest.blockedCount,
    dispatchableOperations: analyticsLedger.totals.dispatchableOperations,
    exportReady,
    healthStatus: operationalHealth.status,
    sequence: priorSnapshots.length + 1
  };
  const snapshots = [...priorSnapshots, currentSnapshot];
  const timeline = [
    {
      at: now,
      stage: "command",
      status: audit.lifecycleControl.allowed ? command : "denied",
      label: audit.lifecycleControl.allowed
        ? `Lifecycle command ${command} received`
        : `Lifecycle command ${command} denied by controls`,
      batchId: sync.batchId
    },
    {
      at: now,
      stage: "preview",
      status: preview.mode,
      label: `${preview.selection.selected} of ${preview.selection.received} events selected`,
      selectedEvents: preview.selection.selected,
      blockedEvents: preview.selection.blocked
    },
    {
      at: now,
      stage: "validation",
      status: validationSummary.status,
      label: validationSummary.status === "valid"
        ? "Replay contracts validated"
        : `${validationSummary.errorCount} replay contract blockers found`,
      hotspots: validationHotspots.slice(0, 5)
    },
    {
      at: now,
      stage: "readiness",
      status: readiness.state,
      label: workflowHandoff.statusText,
      primaryAction: workflowHandoff.primaryAction
    },
    {
      at: now,
      stage: "export",
      status: exportReady ? "ready" : "blocked",
      label: exportReady ? "Proof export summary is ready" : "Proof export summary is waiting on blockers",
      blockers: exportBlockers
    },
    {
      at: now,
      stage: "analytics",
      status: analyticsLedger.totals.blockerKinds > 0 ? "has-blockers" : "clean",
      label: `${analyticsLedger.totals.uniqueStreams} stream${analyticsLedger.totals.uniqueStreams === 1 ? "" : "s"} and ${analyticsLedger.totals.uniqueTypes} event type${analyticsLedger.totals.uniqueTypes === 1 ? "" : "s"} analyzed`,
      selectedByOperation: analyticsLedger.selectedByOperation,
      blockedByReason: analyticsLedger.blockedByReason
    }
  ];

  return {
    schemaVersion: "aios.auditRecovery.eventReplay.reporting.v1",
    counters: {
      evidenceReceived: preview.selection.received,
      replayableEvents: preview.selection.replayable,
      selectedEvents: preview.selection.selected,
      blockedEvents: preview.selection.blocked,
      overflowEvents: preview.selection.overflow,
      proofMissingForSelected: preview.proofCoverage.missingForSelected,
      validationErrors: validationSummary.errorCount,
      validationFields: validationHotspots.length,
      missingProviderCapabilities: providerContract.missingCapabilities.length,
      providerContractErrors: providerContract.contractErrors.length,
      missingProviderEndpoints: providerContract.serviceContract.missingEndpointKinds.length,
      providerEndpointsReady: providerContract.serviceContract.endpointReadiness
        .filter((endpoint) => endpoint.ready)
        .length,
      providerReceiptRequired: providerReceipt.required ? 1 : 0,
      providerReceiptAcknowledged: providerReceipt.acknowledged ? 1 : 0,
      providerReceiptExpired: providerReceipt.state === "expired" ? 1 : 0,
      missingBoundaryPermissions: workspaceBoundary.missingPermissions.length,
      actionableHealthErrors: operationalHealth.actionableErrors.length,
      healthGateBlocked: operationalHealth.failureState.canDispatch ? 0 : 1,
      healthObservationStale: operationalHealth.failureState.stale ? 1 : 0,
      healthRetryBudgetExhausted: operationalHealth.failureState.retryBudget.exhausted ? 1 : 0,
      healthRetryAttemptsRemaining: operationalHealth.failureState.retryBudget.attemptsRemaining,
      controlEvents: audit.controlEvents.length,
      lifecycleCommandDenied: audit.lifecycleControl.allowed ? 0 : 1,
      lifecycleTransitionRequested: audit.lifecycleTransition.requested ? 1 : 0,
      lifecycleTransitionAppliedFields: audit.lifecycleTransition.appliedFields.length,
      lifecycleTransitionPendingFields: audit.lifecycleTransition.pendingFields.length,
      scheduleWindowConfigured: audit.schedulePolicy.window.configured ? 1 : 0,
      duplicateCommands: persistedOutput.idempotency.duplicateCommand ? 1 : 0,
      restartRecoveries: persistedOutput.restart.detected ? 1 : 0,
      recoveryProviderStatusRequired: persistedOutput.restart.providerStatusRequired ? 1 : 0,
      recoveryLeasePresent: persistedOutput.lease.present ? 1 : 0,
      recoveryLeaseReclaimable: persistedOutput.lease.reclaimable ? 1 : 0,
      persistedPendingOperations: persistedOutput.recoveryCheckpoint.pendingOperationIds.length,
      persistedStatusJournalEntries: persistedOutput.statusJournal.length,
      replayPlanEntries: replayPlan.manifest.entryCount,
      replayPlanExecutableEntries: replayPlan.manifest.executableCount,
      replayPlanBlockedEntries: replayPlan.manifest.blockedCount,
      replayPlanIntegrityErrors: replayPlan.integrity.errors.length,
      replayPlanDuplicateEventIds: replayPlan.integrity.duplicateEventIds.length,
      replayPlanDuplicateCheckpoints: replayPlan.integrity.duplicateCheckpoints.length,
      replayPlanMissingCursors: replayPlan.integrity.cursorPolicy.missingCount,
      replayPlanTimestampOrderViolations: replayPlan.integrity.timestampOrderViolations.length,
      replayPlanExecutableMutations: replayPlan.integrity.executableMutationCount,
      replayPlanBoundaryBlockedEntries: replayPlan.manifest.boundaryBlockedCount,
      hostedKernelOperations: hostedKernelInvocation.operationCount,
      hostedKernelDispatchableOperations: hostedKernelInvocation.dispatchableOperationCount,
      hostedKernelDispatchBlockers: hostedKernelInvocation.dispatchBlockers.length,
      continuationResumeBlocked: clientContinuationResume.resumeState === "blocked" ? 1 : 0,
      continuationStatusPollEnabled: clientContinuationResume.statusPoll.enabled ? 1 : 0,
      continuationVisibleActions: clientContinuationResume.visibleActions.length,
      uniqueEventStreams: analyticsLedger.totals.uniqueStreams,
      uniqueEventTypes: analyticsLedger.totals.uniqueTypes,
      eventBlockerKinds: analyticsLedger.totals.blockerKinds,
      boundaryBlockedScopes: analyticsLedger.totals.blockedScopes,
      proofRequiredEvents: analyticsLedger.proofByState.required,
      proofPresentEvents: analyticsLedger.proofByState.present,
      proofMissingEvents: analyticsLedger.proofByState.missing
    },
    rates: {
      selectedRatio,
      proofCoverageRatio,
      validationPassRatio: validationSummary.status === "valid" ? 1 : 0,
      exportReadinessRatio: exportReady ? 1 : 0
    },
    history: {
      retained: snapshots.length,
      latestBatchId: currentSnapshot.batchId,
      snapshots,
      stateCounts: snapshots.reduce((counts, snapshot) => ({
        ...counts,
        [snapshot.state]: (counts[snapshot.state] || 0) + 1
      }), {}),
      acceptanceCounts: snapshots.reduce((counts, snapshot) => ({
        ...counts,
        [snapshot.accepted ? "accepted" : "notAccepted"]: (counts[snapshot.accepted ? "accepted" : "notAccepted"] || 0) + 1
      }), {}),
      exportReadyCount: snapshots.filter((snapshot) => snapshot.exportReady).length,
      lastDispatchableOperations: currentSnapshot.dispatchableOperations
    },
    analyticsLedger,
    exportSummary: {
      format: "application/json",
      ready: exportReady,
      blockers: exportBlockers,
      exportId: [
        surfaceId,
        workspaceBoundary.tenantId,
        workspaceBoundary.workspaceId,
        sync.batchId,
        readiness.state
      ].join(":"),
      filename: `event-replay-${workspaceBoundary.tenantId}-${workspaceBoundary.workspaceId}-${sync.batchId}.json`,
      includes: [
        "proof",
        "audit",
        "preview.selection",
        "validationSummary",
        "readiness",
        "workflowHandoff",
        "operationalHealth",
        "providerServiceContract",
        "providerReceipt",
        "replayPlan.manifest",
        "replayPlan.integrity",
        "hostedKernelInvocation",
        "clientContinuationResume",
        "history.snapshots",
        "analyticsLedger.exportLineItems"
      ],
      summary: {
        tenantId: workspaceBoundary.tenantId,
        workspaceId: workspaceBoundary.workspaceId,
        batchId: sync.batchId,
        command,
        lifecycleCommandAllowed: audit.lifecycleControl.allowed,
        lifecycleDenialCode: audit.lifecycleControl.denialCode,
        lifecycleTransitionRequested: audit.lifecycleTransition.requested,
        lifecycleTransitionAppliedFields: audit.lifecycleTransition.appliedFields,
        lifecycleTransitionPendingFields: audit.lifecycleTransition.pendingFields,
        mode: preview.mode,
        state: readiness.state,
        accepted: acceptance.accepted,
        selectedEvents: preview.selection.selected,
        validationErrors: validationSummary.errorCount,
        healthStatus: operationalHealth.status,
        healthGateState: operationalHealth.failureState.state,
        healthGateOperatorAction: operationalHealth.failureState.operatorAction,
        healthRetryAttemptsRemaining: operationalHealth.failureState.retryBudget.attemptsRemaining,
        providerProtocolVersion: providerContract.serviceContract.negotiatedProtocolVersion,
        providerDeliveryGuarantee: providerContract.serviceContract.deliveryGuarantee,
        providerServiceContractValid: providerContract.serviceContract.contractValid,
        providerReceiptState: providerReceipt.state,
        providerReceiptAcknowledged: providerReceipt.acknowledged,
        providerReceiptExternalTicketId: providerReceipt.externalTicketId,
        restartDetected: persistedOutput.restart.detected,
        restartRecoveryPath: persistedOutput.restart.recoveryPath,
        restartSafe: persistedOutput.restart.restartSafe,
        recoveryProviderStatusRequired: persistedOutput.restart.providerStatusRequired,
        recoveryLeaseReclaimable: persistedOutput.lease.reclaimable,
        recoveryPendingOperations: persistedOutput.recoveryCheckpoint.pendingOperationIds.length,
        replayPlanReady: replayPlan.planReady,
        replayPlanIntegrityValid: replayPlan.integrity.valid,
        replayPlanIntegrityErrors: replayPlan.integrity.errors.length,
        replayPlanDuplicateEventIds: replayPlan.integrity.duplicateEventIds.length,
        replayPlanDuplicateCheckpoints: replayPlan.integrity.duplicateCheckpoints.length,
        replayPlanMissingCursors: replayPlan.integrity.cursorPolicy.missingCount,
        replayPlanTimestampOrderViolations: replayPlan.integrity.timestampOrderViolations.length,
        replayPlanBoundaryBlockedEvents: replayPlan.manifest.boundaryBlockedCount,
        hostedKernelDispatchable: hostedKernelInvocation.dispatchable,
        hostedKernelDispatchableOperations: hostedKernelInvocation.dispatchableOperationCount,
        continuationResumeState: clientContinuationResume.resumeState,
        continuationResumeCommand: clientContinuationResume.resumeCommand,
        continuationStatusPollEnabled: clientContinuationResume.statusPoll.enabled,
        uniqueEventStreams: analyticsLedger.totals.uniqueStreams,
        uniqueEventTypes: analyticsLedger.totals.uniqueTypes,
        eventBlockerKinds: analyticsLedger.totals.blockerKinds,
        proofPresentEvents: analyticsLedger.proofByState.present,
        proofMissingEvents: analyticsLedger.proofByState.missing
      },
      lineItemCount: analyticsLedger.exportLineItems.length,
      lineItems: analyticsLedger.exportLineItems.slice(0, 100)
    },
    timeline,
    reportState: {
      severity: operationalHealth.status === "failed" || validationSummary.status === "invalid"
        ? "action-required"
        : acceptance.accepted
          ? "accepted"
          : "informational",
      route: "audit-recovery/event-replay",
      workflowId: workflowHandoff.workflowId,
      primaryAction: workflowHandoff.primaryAction,
      nextRefreshCursor: sync.cursor,
      recoveryPath: persistedOutput.restart.recoveryPath,
      recoveryOperatorAction: persistedOutput.restart.operatorAction,
      healthGateState: operationalHealth.failureState.state,
      healthGateOperatorAction: operationalHealth.failureState.operatorAction,
      lifecycleControlState: audit.lifecycleControl.allowed ? "allowed" : "denied",
      auditTags: workflowHandoff.auditTags
    }
  };
}

function buildExportHandoffSummary({
  now,
  reporting,
  readiness,
  workflowHandoff,
  hostedKernelInvocation,
  providerContract,
  providerReceipt,
  workspaceBoundary,
  operationalHealth,
  replayClaim
}) {
  const exportSummary = reporting.exportSummary;
  const providerProofEndpoint = hostedKernelInvocation.endpoints.proof;
  const statusEndpoint = hostedKernelInvocation.endpoints.status;
  const lineItemLimitReached = exportSummary.lineItemCount > exportSummary.lineItems.length;
  const clientDeliverable = workflowHandoff.continuation.deliverable;
  const receiptOpen = providerReceipt.required && !providerReceipt.acknowledged;
  const recoveryOpen = replayClaim.retryable || replayClaim.claimable === false && replayClaim.terminal === false;
  const blockingReasons = [
    ...exportSummary.blockers,
    !providerProofEndpoint ? "proof_endpoint_missing" : null,
    !statusEndpoint && receiptOpen ? "status_endpoint_missing_for_receipt_poll" : null,
    !clientDeliverable ? "client_continuation_not_deliverable" : null,
    receiptOpen ? "provider_receipt_open" : null,
    operationalHealth.failureState.stale ? "operational_health_observation_stale" : null,
    operationalHealth.failureState.retryBudget.exhausted ? "operational_health_retry_budget_exhausted" : null,
    recoveryOpen ? "replay_claim_not_terminal_or_claimable" : null
  ].filter(Boolean);
  const ready = exportSummary.ready
    && blockingReasons.length === 0
    && readiness.canExportProof
    && providerContract.serviceContract.contractValid;

  return {
    schemaVersion: "aios.auditRecovery.eventReplay.exportHandoffSummary.v1",
    generatedAt: now,
    ready,
    state: ready
      ? "export-handoff-ready"
      : receiptOpen
        ? "waiting-provider-receipt"
        : recoveryOpen
          ? "waiting-replay-claim"
          : blockingReasons.length > 0
            ? "export-handoff-blocked"
            : "export-handoff-pending",
    exportId: exportSummary.exportId,
    filename: exportSummary.filename,
    contentType: exportSummary.format,
    lineItemCount: exportSummary.lineItemCount,
    lineItemLimitReached,
    blockingReasons: [...new Set(blockingReasons)].sort(),
    provider: {
      providerId: providerContract.providerId,
      serviceId: providerContract.serviceId,
      protocolVersion: providerContract.serviceContract.negotiatedProtocolVersion,
      proofEndpoint: providerProofEndpoint,
      statusEndpoint,
      receiptState: providerReceipt.state,
      receiptAcknowledged: providerReceipt.acknowledged,
      externalTicketId: providerReceipt.externalTicketId
    },
    boundary: {
      tenantId: workspaceBoundary.tenantId,
      workspaceId: workspaceBoundary.workspaceId,
      authorized: workspaceBoundary.authorized,
      missingPermissions: workspaceBoundary.missingPermissions
    },
    claim: {
      state: replayClaim.state,
      claimable: replayClaim.claimable,
      retryable: replayClaim.retryable,
      terminal: replayClaim.terminal,
      nextAttemptAt: replayClaim.nextAttemptAt,
      blockerCodes: replayClaim.blockerCodes
    },
    routeContract: {
      route: `${workflowHandoff.returnRoute}/event-replay/${exportSummary.summary.batchId}/export`,
      method: ready ? "POST" : "GET",
      bodySchema: ready ? "aios.auditRecovery.eventReplay.exportHandoffRequest.v1" : null,
      statusRoute: statusEndpoint,
      continuationTarget: workflowHandoff.continuation.target,
      continuationAction: workflowHandoff.continuation.action
    },
    consumerSummary: {
      surfaceId,
      kind: "event-replay-export",
      batchId: exportSummary.summary.batchId,
      commandKey: readiness.commandKey,
      readinessState: readiness.state,
      healthGateState: operationalHealth.failureState.state,
      selectedEvents: exportSummary.summary.selectedEvents,
      dispatchableOperations: exportSummary.summary.hostedKernelDispatchableOperations,
      validationErrors: exportSummary.summary.validationErrors,
      replayPlanIntegrityErrors: exportSummary.summary.replayPlanIntegrityErrors,
      exportReady: ready
    }
  };
}

export function describeEventReplaySurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const command = normalizeLifecycleCommand(input.command || input.lifecycleCommand);
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  const { normalized, validationErrors } = normalizeSettings(input);
  const providerContract = normalizeProviderContract(input);
  const sync = normalizeSyncMetadata(input);
  const handoff = normalizeExternalHandoff(input);
  const providerReceipt = normalizeProviderReceipt(input, {
    providerContract,
    sync,
    handoff,
    now
  });
  const clientRuntime = normalizeClientRuntimeState(input);
  const operationalHealth = normalizeOperationalHealth(input, now, clientRuntime);
  const persistedState = normalizePersistedReplayState(input, { command, sync, clientRuntime, now });
  const lifecycle = applyLifecycleCommand(command, normalized, now, persistedState);
  const workspaceBoundary = normalizeWorkspaceBoundary(input, {
    command,
    settings: lifecycle.settings,
    handoff
  });
  const integrationValidationErrors = validateIntegrationContracts({
    command,
    settings: lifecycle.settings,
    providerContract,
    providerReceipt,
    sync,
    handoff,
    clientRuntime,
    workspaceBoundary,
    operationalHealth,
    lifecycle,
    persistedState
  });
  const allValidationErrors = [...validationErrors, ...integrationValidationErrors];
  const nextAction = deriveNextAction(
    command,
    lifecycle.settings,
    allValidationErrors,
    providerContract,
    handoff,
    workspaceBoundary,
    operationalHealth
  );
  const preview = buildPreviewContract({
    evidence,
    settings: lifecycle.settings,
    sync,
    handoff,
    workspaceBoundary
  });
  const replayPlan = buildReplayPlan({
    preview,
    settings: lifecycle.settings,
    sync,
    providerContract,
    workspaceBoundary,
    operationalHealth
  });
  const validationSummary = summarizeValidation(allValidationErrors);
  const acceptance = buildAcceptanceContract({
    command,
    preview,
    replayPlan,
    nextAction,
    validationSummary,
    providerContract,
    workspaceBoundary,
    operationalHealth
  });
  const persistedOutput = buildPersistedReplayState({
    command,
    lifecycle,
    sync,
    nextAction,
    readiness: { state: acceptance.accepted ? lifecycle.settings.replay.dryRun ? "preview-ready" : "execution-ready" : nextAction.state },
    acceptance,
    persistedState,
    providerReceipt,
    operationalHealth,
    now
  });
  const replayClaim = buildReplayClaimEnvelope({
    command,
    lifecycle,
    sync,
    nextAction,
    acceptance,
    readiness: { state: acceptance.accepted ? lifecycle.settings.replay.dryRun ? "preview-ready" : "execution-ready" : nextAction.state },
    persistedState,
    persistedOutput,
    providerReceipt,
    workspaceBoundary,
    operationalHealth,
    now
  });
  const integration = buildIntegrationState({
    command,
    providerContract,
    providerReceipt,
    sync,
    handoff,
    nextAction,
    clientRuntime,
    workspaceBoundary,
    persistedOutput,
    operationalHealth,
    lifecycle
  });
  const readiness = buildReadinessContract({
    settings: lifecycle.settings,
    preview,
    replayPlan,
    acceptance,
    nextAction,
    integration,
    persistedOutput,
    operationalHealth
  });
  const hostedKernelInvocation = buildHostedKernelInvocation({
    replayPlan,
    providerContract,
    providerReceipt,
    acceptance,
    readiness,
    sync,
    workspaceBoundary,
    clientRuntime,
    handoff,
    operationalHealth
  });
  const workflowHandoff = buildWorkflowHandoffContract({
    command,
    clientRuntime,
    handoff,
    preview,
    acceptance,
    readiness,
    validationSummary,
    workspaceBoundary,
    operationalHealth
  });
  const explainableNextSteps = buildExplainableNextSteps({
    nextAction,
    validationSummary,
    acceptance,
    preview,
    workflowHandoff,
    operationalHealth
  });
  const clientPreviewAcceptance = buildClientPreviewAcceptanceContract({
    command,
    preview,
    replayPlan,
    acceptance,
    readiness,
    validationSummary,
    workflowHandoff,
    explainableNextSteps,
    hostedKernelInvocation,
    providerContract,
    workspaceBoundary,
    operationalHealth,
    sync
  });
  const clientOperatorDecision = buildOperatorDecisionContract({
    command,
    preview,
    acceptance,
    readiness,
    validationSummary,
    workflowHandoff,
    clientPreviewAcceptance,
    hostedKernelInvocation,
    providerContract,
    providerReceipt,
    workspaceBoundary,
    operationalHealth,
    replayPlan
  });
  const clientContinuationResume = buildClientContinuationResumeContract({
    now,
    clientRuntime,
    workflowHandoff,
    clientOperatorDecision,
    hostedKernelInvocation,
    readiness,
    preview,
    acceptance,
    providerReceipt,
    validationSummary,
    operationalHealth,
    persistedOutput
  });
  const audit = buildAuditOutputs({
    lifecycle,
    providerContract,
    providerReceipt,
    sync,
    handoff,
    workspaceBoundary,
    workflowHandoff,
    persistedOutput,
    operationalHealth,
    replayPlan,
    hostedKernelInvocation,
    clientOperatorDecision,
    clientContinuationResume
  });
  const reporting = buildReportingState({
    input,
    now,
    command,
    providerContract,
    providerReceipt,
    sync,
    preview,
    replayPlan,
    validationSummary,
    acceptance,
    readiness,
    workflowHandoff,
    persistedOutput,
    workspaceBoundary,
    operationalHealth,
    hostedKernelInvocation,
    clientContinuationResume,
    audit
  });
  const exportHandoffSummary = buildExportHandoffSummary({
    now,
    reporting,
    readiness,
    workflowHandoff,
    hostedKernelInvocation,
    providerContract,
    providerReceipt,
    workspaceBoundary,
    operationalHealth,
    replayClaim
  });
  const proof = buildReplayProof({
    command,
    settings: lifecycle.settings,
    evidence,
    now,
    validationErrors: allValidationErrors,
    controlEvents: lifecycle.controlEvents,
    providerContract,
    providerReceipt,
    sync,
    handoff,
    clientRuntime,
    persistedState,
    workspaceBoundary,
    operationalHealth,
    replayPlan,
    replayClaim,
    reporting
  });

  return {
    ok: allValidationErrors.length === 0 && acceptance.requirements.proofSatisfied && replayPlan.planReady,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: "hosted-kernel audit recovery event replay lifecycle contract",
    command,
    settings: lifecycle.settings,
    validationErrors: allValidationErrors,
    validationSummary,
    nextAction,
    explainableNextSteps,
    clientPreviewAcceptance,
    clientOperatorDecision,
    clientContinuationResume,
    preview,
    replayPlan,
    acceptance,
    readiness,
    persistedState: persistedOutput,
    replayClaim,
    workflowHandoff,
    hostedKernelInvocation,
    integration,
    operationalHealth,
    workspaceBoundary,
    reporting,
    exportHandoffSummary,
    audit: {
      ...audit,
      evidenceAccepted: evidence.length,
      previewSelectedEvents: preview.selection.selected,
      replayPlanReady: replayPlan.planReady,
      replayPlanEntries: replayPlan.manifest.entryCount,
      replayAccepted: acceptance.accepted,
      readinessState: readiness.state,
      analyticsCounters: reporting.counters,
      exportReady: reporting.exportSummary.ready,
      exportHandoffReady: exportHandoffSummary.ready,
      exportHandoffState: exportHandoffSummary.state,
      exportHandoffBlockers: exportHandoffSummary.blockingReasons,
      reportSeverity: reporting.reportState.severity,
      replayClaimState: replayClaim.state,
      replayClaimBlockers: replayClaim.blockerCodes,
      replayClaimStable: replayClaim.audit.claimStable
    },
    proof,
    evidence
  };
}

export default describeEventReplaySurface;
