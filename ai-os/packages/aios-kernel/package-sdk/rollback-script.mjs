export const surfaceId = "aios_package-sdk_rollback-script_093";
export const surfaceGroup = "package-sdk";
export const surfaceName = "rollback-script";

const terminalStatuses = new Set(["completed", "failed", "blocked", "skipped"]);
const allowedEventTypes = new Set([
  "rollback.requested",
  "rollback.started",
  "rollback.step",
  "rollback.completed",
  "rollback.failed",
  "rollback.blocked",
  "rollback.skipped",
  "artifact.exported"
]);
const allowedLifecycleCommands = new Set([
  "enable",
  "disable",
  "schedule",
  "cancel-schedule",
  "request-rollback",
  "export-proof"
]);
const allowedScheduleModes = new Set(["manual", "immediate", "maintenance-window"]);
const allowedPreviewDecisions = new Set(["accepted", "rejected", "deferred"]);
const allowedClientViews = new Set(["operator-console", "package-detail", "audit-export", "automation"]);
const allowedHandoffActions = new Set([
  "accept-preview",
  "fix-settings",
  "enable-controls",
  "export-proof",
  "await-schedule",
  "request-rollback",
  "ready-to-export",
  "commit-rollback-route"
]);
const allowedClientRuntimeStatuses = new Set(["idle", "dirty", "submitting", "submitted", "stale", "error"]);
const allowedProviderCapabilities = new Set([
  "preview",
  "execute",
  "schedule",
  "export-proof",
  "event-sync",
  "state-sync",
  "external-handoff"
]);
const allowedProviderSyncModes = new Set(["pull", "push", "bidirectional"]);
const allowedProviderSyncStatuses = new Set(["ready", "stale", "blocked", "unknown"]);
const allowedProviderHandoffLeaseStatuses = new Set(["none", "open", "expired", "revoked"]);
const allowedOperationalStatuses = new Set(["healthy", "degraded", "unhealthy", "unknown"]);
const allowedFailureStates = new Set(["none", "retryable", "operator-action-required", "fatal", "paused"]);
const allowedBackoffStrategies = new Set(["none", "fixed", "linear", "exponential"]);
const allowedAnalyticsGranularities = new Set(["event", "hour", "day"]);
const allowedPersistedStatuses = new Set([
  "idle",
  "scheduled",
  "running",
  "recovering",
  "completed",
  "failed",
  "blocked",
  "skipped"
]);
const allowedCommandJournalStatuses = new Set([
  "queued",
  "in-flight",
  "applied",
  "failed",
  "compensated",
  "stale"
]);
const terminalCommandJournalStatuses = new Set(["applied", "failed", "compensated", "stale"]);
const allowedWorkspaceRoles = new Set(["viewer", "auditor", "operator", "admin"]);
const workspaceRoleRank = new Map([
  ["viewer", 0],
  ["auditor", 1],
  ["operator", 2],
  ["admin", 3]
]);
const permissionRequirements = new Map([
  ["enable", { permission: "rollback:control", role: "admin" }],
  ["disable", { permission: "rollback:control", role: "admin" }],
  ["schedule", { permission: "rollback:schedule", role: "operator" }],
  ["cancel-schedule", { permission: "rollback:schedule", role: "operator" }],
  ["request-rollback", { permission: "rollback:execute", role: "operator" }],
  ["export-proof", { permission: "rollback:export", role: "auditor" }],
  ["accept-preview", { permission: "rollback:accept-preview", role: "operator" }]
]);
const knownRollbackPermissions = new Set([...permissionRequirements.values()].map((entry) => entry.permission));
const rollbackPhaseByType = new Map([
  ["rollback.requested", "intake"],
  ["rollback.started", "execution"],
  ["rollback.step", "execution"],
  ["rollback.completed", "terminal"],
  ["rollback.failed", "terminal"],
  ["rollback.blocked", "terminal"],
  ["rollback.skipped", "terminal"],
  ["artifact.exported", "export"]
]);
const commandControlKeys = new Map([
  ["enable", "enableDisable"],
  ["disable", "enableDisable"],
  ["schedule", "scheduling"],
  ["cancel-schedule", "scheduling"],
  ["request-rollback", "execution"],
  ["export-proof", "proofExport"]
]);

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeEvent(rawEvent, index, generatedAt) {
  const event = rawEvent && typeof rawEvent === "object" ? rawEvent : {};
  const type = allowedEventTypes.has(event.type) ? event.type : "rollback.step";
  const status = typeof event.status === "string" && event.status.trim()
    ? event.status.trim().toLowerCase()
    : type.replace("rollback.", "");
  const packageName = typeof event.packageName === "string" && event.packageName.trim()
    ? event.packageName.trim()
    : "unknown-package";
  const sequence = Number.isFinite(event.sequence) ? event.sequence : index + 1;
  const timestamp = typeof event.timestamp === "string" && event.timestamp.trim()
    ? event.timestamp
    : generatedAt;

  return {
    id: typeof event.id === "string" && event.id.trim()
      ? event.id.trim()
      : `${packageName}:${sequence}:${type}`,
    type,
    status,
    packageName,
    sequence,
    timestamp,
    actor: typeof event.actor === "string" && event.actor.trim() ? event.actor.trim() : "hosted-kernel",
    reason: typeof event.reason === "string" ? event.reason.trim() : "",
    artifact: typeof event.artifact === "string" ? event.artifact.trim() : "",
    proofHash: typeof event.proofHash === "string" ? event.proofHash.trim() : ""
  };
}

function countBy(events, selectKey) {
  return events.reduce((counts, event) => {
    const key = selectKey(event);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function timestampMs(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function elapsedMsBetween(start, end) {
  const startMs = timestampMs(start);
  const endMs = timestampMs(end);
  return startMs === null || endMs === null ? null : Math.max(0, endMs - startMs);
}

function eventPhase(event) {
  if (terminalStatuses.has(event.status)) {
    return "terminal";
  }
  return rollbackPhaseByType.get(event.type) || "execution";
}

function normalizeBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeStringList(value) {
  return [...new Set(toArray(value)
    .filter((entry) => typeof entry === "string" && entry.trim())
    .map((entry) => entry.trim()))];
}

function normalizePackageScope(value) {
  const entries = normalizeStringList(value);
  return entries.length ? entries : ["all-packages"];
}

function normalizePositiveInteger(value, fallback, max) {
  if (!Number.isInteger(value) || value <= 0) {
    return fallback;
  }
  return Math.min(value, max);
}

function normalizeProviderSync(rawSync, generatedAt) {
  const sync = rawSync && typeof rawSync === "object" ? rawSync : {};
  const mode = normalizeString(sync.mode, "bidirectional").toLowerCase();
  const status = normalizeString(sync.status || sync.health, "unknown").toLowerCase();
  const lastSyncedAt = normalizeString(sync.lastSyncedAt || sync.syncedAt, "");
  const lastSyncMs = lastSyncedAt ? timestampMs(lastSyncedAt) : null;
  const generatedMs = timestampMs(generatedAt);
  const lagMs = generatedMs !== null && lastSyncMs !== null
    ? Math.max(0, generatedMs - lastSyncMs)
    : null;

  return {
    mode: allowedProviderSyncModes.has(mode) ? mode : "bidirectional",
    status: allowedProviderSyncStatuses.has(status) ? status : "unknown",
    cursor: normalizeString(sync.cursor || sync.syncCursor, ""),
    lastSyncedAt: lastSyncedAt || null,
    lagMs,
    watermarkEventId: normalizeString(sync.watermarkEventId || sync.lastEventId, ""),
    warnings: [
      ...(!allowedProviderSyncModes.has(mode) ? [`unsupported provider sync mode '${mode}' fell back to bidirectional`] : []),
      ...(!allowedProviderSyncStatuses.has(status) ? [`unsupported provider sync status '${status}' fell back to unknown`] : []),
      ...(lastSyncedAt && lastSyncMs === null ? ["provider sync lastSyncedAt was not parseable"] : [])
    ]
  };
}

function normalizeRollbackProvider(rawProvider, index, requestContext, generatedAt) {
  const provider = rawProvider && typeof rawProvider === "object" ? rawProvider : {};
  const capabilities = normalizeStringList(provider.capabilities)
    .map((capability) => capability.toLowerCase());
  const supportedCapabilities = capabilities.filter((capability) => allowedProviderCapabilities.has(capability));
  const unsupportedCapabilities = capabilities.filter((capability) => !allowedProviderCapabilities.has(capability));
  const packageScope = normalizePackageScope(provider.packageScope || provider.allowedPackages || requestContext.packageName);
  const sync = normalizeProviderSync(provider.sync || provider.syncMetadata, generatedAt);
  const providerId = normalizeString(provider.id || provider.providerId, `rollback-provider:${index + 1}`);
  const service = normalizeString(provider.service || provider.serviceName, providerId);
  const endpoint = normalizeString(provider.endpoint || provider.baseUrl || provider.handoffUrl, "");
  const enabled = normalizeBoolean(provider.enabled, true);
  const leaseStatus = normalizeString(provider.leaseStatus || provider.handoffLeaseStatus, "none").toLowerCase();
  const leaseExpiresAt = normalizeString(provider.leaseExpiresAt || provider.handoffLeaseExpiresAt, "");
  const leaseExpiresMs = leaseExpiresAt ? timestampMs(leaseExpiresAt) : null;

  return {
    providerId,
    service,
    contract: normalizeString(provider.contract, "hosted-kernel rollback provider contract/v1"),
    enabled,
    endpoint: endpoint || null,
    packageScope,
    supportsRequestedPackage: packageInScope(requestContext.packageName, packageScope),
    capabilities: [...new Set(supportedCapabilities)],
    sync,
    externalHandoff: {
      enabled: Boolean(enabled && endpoint && supportedCapabilities.includes("external-handoff")),
      endpoint: endpoint || null,
      method: normalizeString(provider.method || provider.handoffMethod, "POST").toUpperCase(),
      stateToken: normalizeString(provider.stateToken || provider.handoffStateToken, ""),
      correlationId: normalizeString(provider.correlationId || provider.handoffCorrelationId, ""),
      lease: {
        id: normalizeString(provider.leaseId || provider.handoffLeaseId, ""),
        status: allowedProviderHandoffLeaseStatuses.has(leaseStatus) ? leaseStatus : "none",
        expiresAt: leaseExpiresAt || null,
        expired: leaseExpiresMs !== null && timestampMs(generatedAt) !== null
          ? leaseExpiresMs <= timestampMs(generatedAt)
          : false
      }
    },
    warnings: [
      ...unsupportedCapabilities.map((capability) => `ignored unsupported provider capability '${capability}'`),
      ...sync.warnings,
      ...(enabled && !endpoint && supportedCapabilities.includes("external-handoff")
        ? ["external handoff capability requires provider endpoint"]
        : []),
      ...(!allowedProviderHandoffLeaseStatuses.has(leaseStatus) ? [`unsupported handoff lease status '${leaseStatus}' fell back to none`] : []),
      ...(leaseExpiresAt && leaseExpiresMs === null ? ["handoff lease expiresAt was not parseable"] : [])
    ]
  };
}

function normalizeProviderContract(input, requestContext, generatedAt) {
  const rawProviders = toArray(input.providers || input.integrationProviders || input.rollbackProviders);
  const providers = rawProviders.length
    ? rawProviders.map((provider, index) => normalizeRollbackProvider(provider, index, requestContext, generatedAt))
    : [normalizeRollbackProvider({
        id: "hosted-kernel",
        service: "hosted-kernel rollback service",
        capabilities: ["preview", "execute", "schedule", "export-proof", "event-sync", "state-sync"],
        packageScope: ["all-packages"],
        sync: { mode: "bidirectional", status: "ready", lastSyncedAt: generatedAt }
      }, 0, requestContext, generatedAt)];

  return {
    contract: "hosted-kernel rollback integration provider contracts/v1",
    generatedAt,
    requestedPackage: requestContext.packageName,
    providers
  };
}

function normalizeRetryPolicy(rawPolicy, generatedAt) {
  const policy = rawPolicy && typeof rawPolicy === "object" ? rawPolicy : {};
  const strategy = normalizeString(policy.strategy, "exponential").toLowerCase();
  const baseDelayMs = normalizePositiveInteger(policy.baseDelayMs, 1000, 60000);
  const maxDelayMs = normalizePositiveInteger(policy.maxDelayMs, 30000, 300000);
  const attempt = normalizePositiveInteger(policy.attempt || policy.currentAttempt, 1, 25);
  const maxAttempts = normalizePositiveInteger(policy.maxAttempts, 3, 25);
  const clampedDelay = Math.min(maxDelayMs, baseDelayMs * (
    strategy === "linear"
      ? attempt
      : strategy === "exponential"
        ? 2 ** Math.max(0, attempt - 1)
        : 1
  ));
  const normalizedStrategy = allowedBackoffStrategies.has(strategy) ? strategy : "exponential";
  const generatedMs = timestampMs(generatedAt);
  const explicitNextRetryAt = normalizeString(policy.nextRetryAt, "");
  const explicitNextRetryMs = explicitNextRetryAt ? timestampMs(explicitNextRetryAt) : null;

  return {
    strategy: normalizedStrategy,
    attempt,
    maxAttempts,
    attemptsRemaining: Math.max(0, maxAttempts - attempt),
    baseDelayMs,
    maxDelayMs,
    delayMs: normalizedStrategy === "none" ? 0 : clampedDelay,
    nextRetryAt: explicitNextRetryMs !== null
      ? explicitNextRetryAt
      : generatedMs === null || normalizedStrategy === "none"
        ? null
        : new Date(generatedMs + clampedDelay).toISOString(),
    exhausted: attempt >= maxAttempts,
    warnings: [
      ...(!allowedBackoffStrategies.has(strategy) ? [`unsupported retry backoff strategy '${strategy}' fell back to exponential`] : []),
      ...(explicitNextRetryAt && explicitNextRetryMs === null ? ["retry.nextRetryAt was not parseable"] : []),
      ...(maxDelayMs < baseDelayMs ? ["retry.maxDelayMs was lower than retry.baseDelayMs"] : [])
    ]
  };
}

function normalizeHealthProbe(rawProbe, index, generatedAt) {
  const probe = rawProbe && typeof rawProbe === "object" ? rawProbe : {};
  const status = normalizeString(probe.status || probe.health, "unknown").toLowerCase();
  const observedAt = normalizeString(probe.observedAt || probe.timestamp, generatedAt);
  const observedMs = observedAt ? timestampMs(observedAt) : null;
  const generatedMs = timestampMs(generatedAt);
  const maxAgeMs = normalizePositiveInteger(probe.maxAgeMs || probe.staleAfterMs, 300000, 3600000);
  const ageMs = generatedMs !== null && observedMs !== null
    ? Math.max(0, generatedMs - observedMs)
    : null;
  const stale = ageMs !== null && ageMs > maxAgeMs;
  const latencyMs = Number.isFinite(probe.latencyMs) && probe.latencyMs >= 0
    ? Math.round(probe.latencyMs)
    : null;
  const normalizedStatus = allowedOperationalStatuses.has(status) ? status : "unknown";

  return {
    id: normalizeString(probe.id || probe.name, `probe:${index + 1}`),
    target: normalizeString(probe.target || probe.service, "hosted-kernel rollback surface"),
    status: stale && normalizedStatus === "healthy" ? "degraded" : normalizedStatus,
    observedAt,
    ageMs,
    maxAgeMs,
    stale,
    latencyMs,
    errorCode: normalizeString(probe.errorCode || probe.code, ""),
    message: normalizeString(
      probe.message || probe.reason,
      stale ? `probe result is stale by ${ageMs - maxAgeMs}ms` : ""
    ),
    actionable: normalizeBoolean(probe.actionable, Boolean(probe.errorCode || probe.message || stale)),
    warnings: [
      ...(!allowedOperationalStatuses.has(status) ? [`unsupported probe status '${status}' fell back to unknown`] : []),
      ...(observedAt && observedMs === null ? ["probe observedAt was not parseable"] : []),
      ...(stale ? [`probe ${normalizeString(probe.id || probe.name, `probe:${index + 1}`)} result is stale`] : [])
    ]
  };
}

function rankOperationalError(error, failureState) {
  if (failureState === "fatal" || error.code === "ROLLBACK_PACKAGE_FAILED") {
    return { severity: "critical", priority: 10 };
  }
  if (error.code === "ROLLBACK_PROVIDER_NOT_READY" || error.code === "ROLLBACK_PACKAGE_BLOCKED") {
    return { severity: "error", priority: 20 };
  }
  if (error.retryable) {
    return { severity: "warning", priority: 30 };
  }
  return { severity: "notice", priority: 40 };
}

function buildOperationalRemediationPlan(operational, generatedAt) {
  const retryableErrors = operational.actionableErrors.filter((error) => error.retryable);
  const operatorErrors = operational.actionableErrors.filter((error) => !error.retryable);
  const retryAvailable = retryableErrors.length > 0 && !operational.retry.exhausted;
  const circuitOpen = operational.failureState === "fatal"
    || operational.retry.exhausted
    || (operational.status === "unhealthy" && retryableErrors.length === 0);
  const mode = circuitOpen
    ? "operator-intervention"
    : retryAvailable
      ? "retry-scheduled"
      : operational.degradedMode.enabled
        ? "degraded-observation"
        : operational.actionableErrors.length
          ? "operator-remediation"
          : "clear";
  const actions = operational.actionableErrors
    .map((error) => {
      const ranked = rankOperationalError(error, operational.failureState);
      return {
        code: error.code,
        target: error.target,
        severity: ranked.severity,
        priority: ranked.priority,
        message: error.message,
        action: error.action,
        retryable: error.retryable,
        retryAt: error.retryable && retryAvailable ? operational.retry.nextRetryAt : null,
        blocksRollback: ranked.severity === "critical" || ranked.severity === "error" || operational.blocking,
        evidenceKey: buildProofDigest({
          code: error.code,
          target: error.target,
          message: error.message,
          action: error.action,
          generatedAt
        })
      };
    })
    .sort((left, right) => left.priority - right.priority || left.target.localeCompare(right.target));
  const exitCriteria = [
    ...(operational.degradedMode.enabled ? ["degradedMode.enabled must be false or explicitly accepted by policy"] : []),
    ...(operational.problems.length ? ["operationalHealth.problems must be empty or acknowledged by an operator"] : []),
    ...(operatorErrors.length ? ["non-retryable actionable errors require operator remediation evidence"] : []),
    ...(operational.retry.exhausted ? ["retry budget must be reset or incident must be manually closed"] : []),
    ...(operational.blocking ? ["blocking health state must clear before rollback route commit"] : [])
  ];

  return {
    contract: "hosted-kernel rollback operational remediation plan/v1",
    generatedAt,
    mode,
    circuitBreaker: {
      open: circuitOpen,
      reason: circuitOpen
        ? operational.failureState === "fatal"
          ? "fatal failure state"
          : operational.retry.exhausted
            ? "retry budget exhausted"
            : "unhealthy state has no retryable recovery path"
        : "",
      resetRequiresOperator: circuitOpen || operatorErrors.length > 0
    },
    retrySchedule: {
      enabled: retryAvailable,
      strategy: operational.retry.strategy,
      attempt: operational.retry.attempt,
      attemptsRemaining: operational.retry.attemptsRemaining,
      delayMs: retryAvailable ? operational.retry.delayMs : 0,
      nextRetryAt: retryAvailable ? operational.retry.nextRetryAt : null,
      retryableErrorCodes: [...new Set(retryableErrors.map((error) => error.code))]
    },
    degradedMode: {
      enabled: operational.degradedMode.enabled,
      allowedActions: operational.degradedMode.allowedActions,
      exitCriteria
    },
    actionCount: actions.length,
    blockingActionCount: actions.filter((action) => action.blocksRollback).length,
    actions,
    audit: {
      proofHash: buildProofDigest({
        status: operational.status,
        failureState: operational.failureState,
        mode,
        circuitOpen,
        retryAvailable,
        actions: actions.map((action) => ({
          code: action.code,
          target: action.target,
          severity: action.severity,
          retryAt: action.retryAt,
          blocksRollback: action.blocksRollback
        })),
        exitCriteria
      })
    }
  };
}

function buildOperationalHealth(input, reportState, lifecycleState, providerNegotiation, recoveryState, generatedAt) {
  const rawHealth = input.operationalHealth || input.health || input.rollbackHealth || {};
  const health = rawHealth && typeof rawHealth === "object" ? rawHealth : {};
  const requestedStatus = normalizeString(health.status, "").toLowerCase();
  const requestedFailureState = normalizeString(health.failureState, "").toLowerCase();
  const probes = toArray(health.probes || health.checks).map((probe, index) => normalizeHealthProbe(probe, index, generatedAt));
  const retry = normalizeRetryPolicy(health.retry || health.retryPolicy, generatedAt);
  const providerBlocked = providerNegotiation.candidates.filter((candidate) => !candidate.ready);
  const failedPackages = recoveryState.packages.filter((entry) => entry.status === "failed" || entry.status === "blocked");
  const recoveringPackages = recoveryState.packages.filter((entry) => entry.restartSafeStatus === "recovering");
  const probeFailures = probes.filter((probe) => probe.status === "unhealthy" || probe.status === "degraded" || probe.stale);
  const derivedProblems = [
    ...(!providerNegotiation.ready ? ["no rollback provider is currently ready"] : []),
    ...(!recoveryState.restartSafe ? ["persisted rollback state requires recovery before commit"] : []),
    ...failedPackages.map((entry) => `${entry.packageName} is ${entry.status}`),
    ...probeFailures.map((probe) => `${probe.id} reported ${probe.status}${probe.message ? `: ${probe.message}` : ""}`),
    ...(retry.exhausted && (failedPackages.length || recoveringPackages.length) ? ["retry budget is exhausted for rollback recovery"] : [])
  ];
  const fatal = retry.exhausted && failedPackages.length > 0;
  const degradedModeEnabled = normalizeBoolean(health.degradedMode?.enabled, Boolean(
    providerNegotiation.ready
      && recoveryState.restartSafe
      && reportState.readyForExport
      && (probeFailures.length > 0 || providerBlocked.length > 0)
  ));
  const derivedStatus = fatal || probes.some((probe) => probe.status === "unhealthy")
    ? "unhealthy"
    : derivedProblems.length || requestedStatus === "degraded"
      ? "degraded"
      : requestedStatus && allowedOperationalStatuses.has(requestedStatus)
        ? requestedStatus
        : "healthy";
  const failureState = requestedFailureState && allowedFailureStates.has(requestedFailureState)
    ? requestedFailureState
    : fatal
      ? "fatal"
      : derivedProblems.length && retry.attemptsRemaining > 0
        ? "retryable"
        : derivedProblems.length
          ? "operator-action-required"
          : "none";
  const actionableErrors = [
    ...providerBlocked.flatMap((candidate) => candidate.denials.map((denial) => ({
      code: "ROLLBACK_PROVIDER_NOT_READY",
      target: candidate.providerId,
      message: denial,
      action: "repair provider contract or choose a provider with the required capabilities",
      retryable: candidate.sync.status === "stale"
    }))),
    ...recoveringPackages.map((entry) => ({
      code: "ROLLBACK_PACKAGE_RECOVERY_REQUIRED",
      target: entry.packageName,
      message: "package has dirty or in-flight persisted state",
      action: "resume rollback recovery before route commit",
      retryable: true
    })),
    ...failedPackages.map((entry) => ({
      code: entry.status === "blocked" ? "ROLLBACK_PACKAGE_BLOCKED" : "ROLLBACK_PACKAGE_FAILED",
      target: entry.packageName,
      message: `package rollback status is ${entry.status}`,
      action: entry.proofHash ? "review terminal proof and operator decision" : "export proof or record operator remediation",
      retryable: entry.status === "failed" && retry.attemptsRemaining > 0
    })),
    ...probeFailures.map((probe) => ({
      code: probe.errorCode || "ROLLBACK_HEALTH_PROBE_DEGRADED",
      target: probe.target,
      message: probe.message || `${probe.id} reported ${probe.status}`,
      action: probe.actionable ? "inspect health probe target before retrying rollback" : "observe probe until it recovers",
      retryable: probe.status === "degraded" && retry.attemptsRemaining > 0
    }))
  ];

  const operational = {
    contract: "hosted-kernel rollback operational health/v1",
    generatedAt,
    status: derivedStatus,
    failureState,
    degradedMode: {
      enabled: degradedModeEnabled,
      reason: normalizeString(health.degradedMode?.reason, degradedModeEnabled ? "rollback can continue with reduced operational confidence" : ""),
      allowedActions: degradedModeEnabled
        ? ["export-proof", "accept-preview", ...(lifecycleState.controls.canRequestRollback ? ["request-rollback"] : [])]
        : []
    },
    retry,
    probes,
    blocking: derivedStatus === "unhealthy" || failureState === "fatal",
    degraded: derivedStatus === "degraded" || degradedModeEnabled,
    problems: [...new Set(derivedProblems)],
    actionableErrors,
    warnings: [
      ...retry.warnings,
      ...probes.flatMap((probe) => probe.warnings),
      ...(requestedStatus && !allowedOperationalStatuses.has(requestedStatus) ? [`unsupported operational health status '${requestedStatus}' fell back to derived status`] : []),
      ...(requestedFailureState && !allowedFailureStates.has(requestedFailureState) ? [`unsupported failure state '${requestedFailureState}' fell back to derived state`] : [])
    ],
    audit: {
      providerReady: providerNegotiation.ready,
      recoveryRestartSafe: recoveryState.restartSafe,
      failedPackageCount: failedPackages.length,
      recoveringPackageCount: recoveringPackages.length,
      proofHash: buildProofDigest({
        status: derivedStatus,
        failureState,
        retry,
        problems: derivedProblems,
        providerReady: providerNegotiation.ready,
        recoveryStatus: recoveryState.status
      })
    }
  };
  return {
    ...operational,
    remediationPlan: buildOperationalRemediationPlan(operational, generatedAt)
  };
}

function requiredProviderCapabilities(reportState, lifecycleState) {
  const required = new Set(["event-sync", "state-sync", "preview"]);
  if (lifecycleState.schedule.active) {
    required.add("schedule");
  }
  if (!reportState.readyForExport) {
    required.add("execute");
  }
  if (reportState.requiresProof) {
    required.add("export-proof");
  }
  return [...required];
}

function negotiateProviderContract(providerContract, reportState, lifecycleState) {
  const requiredCapabilities = requiredProviderCapabilities(reportState, lifecycleState);
  const candidates = providerContract.providers.map((provider) => {
    const missingCapabilities = requiredCapabilities
      .filter((capability) => !provider.capabilities.includes(capability));
    const denials = [
      ...(!provider.enabled ? ["provider is disabled"] : []),
      ...(!provider.supportsRequestedPackage ? ["provider does not support requested package scope"] : []),
      ...(provider.sync.status === "blocked" ? ["provider sync status is blocked"] : []),
      ...(provider.sync.status === "stale" ? ["provider sync status is stale"] : []),
      ...missingCapabilities.map((capability) => `missing provider capability '${capability}'`)
    ];

    return {
      providerId: provider.providerId,
      service: provider.service,
      endpoint: provider.endpoint,
      ready: denials.length === 0,
      capabilities: provider.capabilities,
      missingCapabilities,
      sync: provider.sync,
      externalHandoff: provider.externalHandoff,
      denials,
      warnings: provider.warnings
    };
  });
  const selectedProvider = candidates.find((candidate) => candidate.ready) || null;

  return {
    ...providerContract,
    requiredCapabilities,
    selectedProviderId: selectedProvider?.providerId || null,
    ready: Boolean(selectedProvider),
    candidates,
    audit: {
      candidateCount: candidates.length,
      readyCandidateCount: candidates.filter((candidate) => candidate.ready).length,
      proofHash: buildProofDigest({
        requestedPackage: providerContract.requestedPackage,
        requiredCapabilities,
        candidates: candidates.map((candidate) => ({
          providerId: candidate.providerId,
          ready: candidate.ready,
          missingCapabilities: candidate.missingCapabilities,
          syncStatus: candidate.sync.status
        }))
      })
    }
  };
}

function normalizeCommandPolicy(settings, validationWarnings) {
  const controls = settings.controls && typeof settings.controls === "object" ? settings.controls : {};
  const disabledCommands = normalizeStringList(settings.disabledCommands || controls.disabledCommands)
    .map((command) => command.toLowerCase());
  const unknownDisabledCommands = disabledCommands.filter((command) => !allowedLifecycleCommands.has(command));
  const normalizedDisabledCommands = disabledCommands.filter((command) => allowedLifecycleCommands.has(command));

  if (unknownDisabledCommands.length) {
    validationWarnings.push(`ignored unsupported disabled lifecycle commands: ${unknownDisabledCommands.join(", ")}`);
  }

  return {
    contract: "hosted-kernel rollback lifecycle command policy/v1",
    controls: {
      enableDisable: normalizeBoolean(controls.enableDisable, true),
      scheduling: normalizeBoolean(controls.scheduling, true),
      execution: normalizeBoolean(controls.execution, true),
      proofExport: normalizeBoolean(controls.proofExport, true)
    },
    disabledCommands: [...new Set(normalizedDisabledCommands)],
    requiresReason: {
      disable: true,
      requestRollback: true
    }
  };
}

function normalizeScheduleWindow(schedule, generatedAt, validationErrors, validationWarnings) {
  const notBefore = normalizeString(schedule.notBefore || schedule.startsAt, "");
  const notAfter = normalizeString(schedule.notAfter || schedule.endsAt, "");
  const requestedAt = normalizeString(schedule.requestedAt, generatedAt);
  const requestedMs = timestampMs(requestedAt);
  const notBeforeMs = notBefore ? timestampMs(notBefore) : null;
  const notAfterMs = notAfter ? timestampMs(notAfter) : null;

  if (notBefore && notBeforeMs === null) {
    validationErrors.push("schedule.notBefore must be an ISO timestamp when provided");
  }
  if (notAfter && notAfterMs === null) {
    validationErrors.push("schedule.notAfter must be an ISO timestamp when provided");
  }
  if (notBeforeMs !== null && notAfterMs !== null && notBeforeMs > notAfterMs) {
    validationErrors.push("schedule.notBefore must be before schedule.notAfter");
  }
  if (requestedMs === null) {
    validationWarnings.push("schedule.requestedAt was not parseable for window evaluation");
  }

  const opensInMs = requestedMs !== null && notBeforeMs !== null
    ? Math.max(0, notBeforeMs - requestedMs)
    : 0;
  const expiresInMs = requestedMs !== null && notAfterMs !== null
    ? notAfterMs - requestedMs
    : null;
  const open = (notBeforeMs === null || requestedMs === null || requestedMs >= notBeforeMs)
    && (notAfterMs === null || requestedMs === null || requestedMs <= notAfterMs);

  return {
    notBefore: notBefore || null,
    notAfter: notAfter || null,
    requestedAt,
    open,
    opensInMs,
    expiresInMs,
    state: open
      ? "open"
      : opensInMs > 0
        ? "not-yet-open"
        : "expired"
  };
}

function packageInScope(packageName, allowedPackages) {
  return allowedPackages.includes("all-packages") || allowedPackages.includes(packageName);
}

function roleAtLeast(actualRole, requiredRole) {
  return (workspaceRoleRank.get(actualRole) || 0) >= (workspaceRoleRank.get(requiredRole) || 0);
}

function normalizePermissionGrant(rawGrant, index, generatedAt) {
  const grant = rawGrant && typeof rawGrant === "object" ? rawGrant : {};
  const rawActions = normalizeStringList(grant.actions || grant.allowedActions || grant.commands)
    .map((action) => action.toLowerCase());
  const rawPermissions = normalizeStringList(grant.permissions || grant.scopes)
    .map((permission) => permission.toLowerCase());
  const actions = rawActions.filter((action) => allowedLifecycleCommands.has(action) || action === "accept-preview");
  const permissions = rawPermissions.filter((permission) => knownRollbackPermissions.has(permission));
  const packageScope = normalizePackageScope(grant.packageScope || grant.allowedPackages || grant.packages);
  const effect = normalizeString(grant.effect || grant.decision, "allow").toLowerCase() === "deny" ? "deny" : "allow";
  const notBefore = normalizeString(grant.notBefore || grant.startsAt, "");
  const expiresAt = normalizeString(grant.expiresAt || grant.notAfter || grant.endsAt, "");
  const generatedMs = timestampMs(generatedAt);
  const notBeforeMs = notBefore ? timestampMs(notBefore) : null;
  const expiresMs = expiresAt ? timestampMs(expiresAt) : null;
  const notYetActive = generatedMs !== null && notBeforeMs !== null && generatedMs < notBeforeMs;
  const expired = generatedMs !== null && expiresMs !== null && generatedMs > expiresMs;
  const parseWarnings = [
    ...(rawActions.length !== actions.length ? ["grant ignored unsupported lifecycle actions"] : []),
    ...(rawPermissions.length !== permissions.length ? ["grant ignored unsupported rollback permissions"] : []),
    ...(notBefore && notBeforeMs === null ? ["grant notBefore was not parseable"] : []),
    ...(expiresAt && expiresMs === null ? ["grant expiresAt was not parseable"] : [])
  ];

  return {
    id: normalizeString(grant.id || grant.grantId, `rollback-grant:${index + 1}`),
    effect,
    issuedBy: normalizeString(grant.issuedBy || grant.actor, "hosted-kernel"),
    reason: normalizeString(grant.reason, ""),
    packageScope,
    actions,
    permissions,
    notBefore: notBefore || null,
    expiresAt: expiresAt || null,
    active: !notYetActive && !expired && parseWarnings.every((warning) => !warning.includes("parseable")),
    state: expired
      ? "expired"
      : notYetActive
        ? "not-yet-active"
        : parseWarnings.some((warning) => warning.includes("parseable"))
          ? "invalid-window"
          : "active",
    warnings: parseWarnings
  };
}

function grantMatchesRequirement(grant, requirement, action, packageName) {
  const permissionMatch = requirement
    ? grant.permissions.includes(requirement.permission)
    : false;
  const actionMatch = grant.actions.includes(action);
  return grant.active
    && packageInScope(packageName, grant.packageScope)
    && (actionMatch || permissionMatch);
}

function evaluateScopedGrantAccess(boundary, action, packageName, requirement) {
  const grantMatches = boundary.permissionGrants.filter((grant) => (
    packageInScope(packageName, grant.packageScope)
      && (grant.actions.includes(action) || (requirement && grant.permissions.includes(requirement.permission)))
  ));
  const activeDenials = grantMatches.filter((grant) => grant.effect === "deny" && grantMatchesRequirement(grant, requirement, action, packageName));
  const activeAllows = grantMatches.filter((grant) => grant.effect === "allow" && grantMatchesRequirement(grant, requirement, action, packageName));
  const allowGrantsExistForAction = boundary.permissionGrants.some((grant) => (
    grant.effect === "allow"
      && (grant.actions.includes(action) || (requirement && grant.permissions.includes(requirement.permission)))
  ));
  const inactiveMatches = grantMatches.filter((grant) => !grant.active);

  return {
    grantIds: activeAllows.map((grant) => grant.id),
    deniedGrantIds: activeDenials.map((grant) => grant.id),
    inactiveGrantIds: inactiveMatches.map((grant) => grant.id),
    allowedByGrant: activeAllows.length > 0,
    deniedByGrant: activeDenials.length > 0,
    allowGrantRequired: allowGrantsExistForAction,
    denials: [
      ...activeDenials.map((grant) => `denied by workspace permission grant '${grant.id}'`),
      ...(allowGrantsExistForAction && activeAllows.length === 0
        ? [`no active workspace permission grant covers ${action} for package '${packageName}'`]
        : [])
    ]
  };
}

function stableSerialize(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function buildProofDigest(payload) {
  const source = stableSerialize(payload);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function normalizeWorkspaceBoundary(input, requestContext, generatedAt) {
  const tenant = input.tenant && typeof input.tenant === "object" ? input.tenant : {};
  const workspace = input.workspace && typeof input.workspace === "object" ? input.workspace : {};
  const principal = input.principal && typeof input.principal === "object" ? input.principal : {};
  const rawRole = normalizeString(principal.role || workspace.role || tenant.role, "viewer").toLowerCase();
  const role = allowedWorkspaceRoles.has(rawRole) ? rawRole : "viewer";
  const tenantId = normalizeString(tenant.id || tenant.tenantId || input.tenantId, "tenant:unknown");
  const workspaceId = normalizeString(workspace.id || workspace.workspaceId || input.workspaceId, "workspace:default");
  const allowedPackages = normalizePackageScope(
    workspace.allowedPackages
      || principal.allowedPackages
      || tenant.allowedPackages
      || requestContext.packageName
  );
  const explicitPermissions = normalizeStringList(principal.permissions || workspace.permissions);
  const permissionGrants = toArray(
    principal.permissionGrants
      || workspace.permissionGrants
      || tenant.permissionGrants
      || input.permissionGrants
      || input.grants
  ).map((grant, index) => normalizePermissionGrant(grant, index, generatedAt));
  const activeAllowGrants = permissionGrants.filter((grant) => grant.active && grant.effect === "allow");
  const activeDenyGrants = permissionGrants.filter((grant) => grant.active && grant.effect === "deny");
  const effectivePermissions = [
    ...new Set([
      ...explicitPermissions,
      ...activeAllowGrants.flatMap((grant) => grant.permissions)
    ])
  ];
  const requestedGrantDecision = evaluateScopedGrantAccess(
    {
      permissionGrants,
      allowedPackages
    },
    requestContext.requestedAction || "request-rollback",
    requestContext.packageName,
    permissionRequirements.get(requestContext.requestedAction || "request-rollback")
  );
  const warnings = [];

  if (!allowedWorkspaceRoles.has(rawRole)) {
    warnings.push(`unsupported workspace role '${rawRole}' fell back to viewer`);
  }
  if (!packageInScope(requestContext.packageName, allowedPackages)) {
    warnings.push(`requested package '${requestContext.packageName}' is outside workspace package scope`);
  }
  if (requestedGrantDecision.deniedByGrant) {
    warnings.push(`requested package '${requestContext.packageName}' is denied by an active workspace grant`);
  }

  return {
    contract: "hosted-kernel rollback workspace boundary/v1",
    tenantId,
    workspaceId,
    principalId: normalizeString(principal.id || principal.principalId || requestContext.correlation.actor, "hosted-kernel"),
    role,
    permissions: explicitPermissions,
    effectivePermissions,
    allowedPackages,
    permissionGrants,
    requestedPackageInScope: packageInScope(requestContext.packageName, allowedPackages) && !requestedGrantDecision.deniedByGrant,
    evaluatedAt: generatedAt,
    warnings: [
      ...warnings,
      ...permissionGrants.flatMap((grant) => grant.warnings.map((warning) => `${grant.id}: ${warning}`))
    ],
    audit: {
      activeAllowGrantIds: activeAllowGrants.map((grant) => grant.id),
      activeDenyGrantIds: activeDenyGrants.map((grant) => grant.id),
      inactiveGrantIds: permissionGrants.filter((grant) => !grant.active).map((grant) => grant.id),
      requestedGrantDecision,
      proofHash: buildProofDigest({
        tenantId,
        workspaceId,
        principalId: normalizeString(principal.id || principal.principalId || requestContext.correlation.actor, "hosted-kernel"),
        role,
        allowedPackages,
        effectivePermissions,
        grants: permissionGrants.map((grant) => ({
          id: grant.id,
          effect: grant.effect,
          state: grant.state,
          packageScope: grant.packageScope,
          actions: grant.actions,
          permissions: grant.permissions
        })),
        requestedPackage: requestContext.packageName
      })
    }
  };
}

function evaluateWorkspaceAccess(boundary, action, packageName) {
  const requirement = permissionRequirements.get(action);
  const denials = [];
  const grantDecision = evaluateScopedGrantAccess(boundary, action, packageName, requirement);

  if (!packageInScope(packageName, boundary.allowedPackages)) {
    denials.push(`package '${packageName}' is outside workspace package scope`);
  }
  if (requirement && !roleAtLeast(boundary.role, requirement.role)) {
    denials.push(`role '${boundary.role}' does not satisfy '${requirement.role}' for ${action}`);
  }
  if (
    requirement
      && boundary.effectivePermissions.length > 0
      && !boundary.effectivePermissions.includes(requirement.permission)
      && !grantDecision.allowedByGrant
  ) {
    denials.push(`missing permission '${requirement.permission}'`);
  }
  denials.push(...grantDecision.denials);

  return {
    action,
    packageName,
    allowed: denials.length === 0,
    requiredRole: requirement?.role || "viewer",
    requiredPermission: requirement?.permission || null,
    grantDecision,
    denials: [...new Set(denials)]
  };
}

function partitionEventsByWorkspace(events, workspaceBoundary) {
  const visibleEvents = [];
  const withheldEvents = [];

  for (const event of events) {
    const access = evaluateWorkspaceAccess(workspaceBoundary, "export-proof", event.packageName);
    if (access.allowed || (packageInScope(event.packageName, workspaceBoundary.allowedPackages) && !access.grantDecision.deniedByGrant)) {
      visibleEvents.push(event);
    } else {
      withheldEvents.push({
        eventId: event.id,
        packageName: event.packageName,
        type: event.type,
        timestamp: event.timestamp,
        reason: access.denials.length
          ? access.denials.join("; ")
          : "event package is outside workspace package scope"
      });
    }
  }

  return {
    contract: "hosted-kernel rollback event isolation/v1",
    visibleEvents,
    withheldEvents,
    visibleEventCount: visibleEvents.length,
    withheldEventCount: withheldEvents.length,
    proofHash: buildProofDigest({
      tenantId: workspaceBoundary.tenantId,
      workspaceId: workspaceBoundary.workspaceId,
      visibleEventIds: visibleEvents.map((event) => event.id),
      withheldEvents
    })
  };
}

function normalizeClientRuntimeState(input, request, client, route, generatedAt) {
  const runtime = (
    client.runtime
      || request.clientRuntime
      || input.clientRuntime
      || input.runtimeState
      || {}
  );
  const state = runtime && typeof runtime === "object" ? runtime : {};
  const status = normalizeString(state.status, "idle").toLowerCase();
  const lastHydratedAt = normalizeString(state.lastHydratedAt || state.hydratedAt, "");
  const lastInteractionAt = normalizeString(state.lastInteractionAt || state.interactedAt, "");
  const generatedMs = timestampMs(generatedAt);
  const hydratedMs = lastHydratedAt ? timestampMs(lastHydratedAt) : null;
  const interactionMs = lastInteractionAt ? timestampMs(lastInteractionAt) : null;
  const maxStalenessMs = normalizePositiveInteger(state.maxStalenessMs, 120000, 900000);
  const staleByHydration = generatedMs !== null && hydratedMs !== null
    ? generatedMs - hydratedMs > maxStalenessMs
    : false;
  const rawPendingAction = normalizeString(
    state.pendingAction || state.optimisticAction || client.requestedAction || request.action,
    ""
  ).toLowerCase();
  const pendingAction = allowedHandoffActions.has(rawPendingAction) ? rawPendingAction : null;
  const pendingPackageName = normalizeString(
    state.pendingPackageName || state.packageName || request.packageName || client.packageName,
    "all-packages"
  );
  const draft = state.handoffDraft && typeof state.handoffDraft === "object" ? state.handoffDraft : {};
  const draftAction = normalizeString(draft.action || pendingAction, "").toLowerCase();
  const submittedAt = normalizeString(draft.submittedAt || state.submittedAt, "");
  const submittedMs = submittedAt ? timestampMs(submittedAt) : null;
  const pendingRequestId = normalizeString(state.pendingRequestId || draft.requestId, "");
  const optimisticInFlight = Boolean(
    (status === "submitting" || state.optimisticSubmission === true)
      && pendingAction
      && (!pendingRequestId || pendingRequestId === normalizeString(request.requestId || request.id || input.requestId, pendingRequestId))
  );
  const clientRoute = normalizeString(state.currentRoute || route.href || client.currentRoute || client.returnTo || request.returnTo, "");
  const warnings = [
    ...(!allowedClientRuntimeStatuses.has(status) ? [`unsupported client runtime status '${status}' fell back to idle`] : []),
    ...(rawPendingAction && !allowedHandoffActions.has(rawPendingAction) ? [`unsupported pending handoff action '${rawPendingAction}' was ignored`] : []),
    ...(lastHydratedAt && hydratedMs === null ? ["client runtime lastHydratedAt was not parseable"] : []),
    ...(lastInteractionAt && interactionMs === null ? ["client runtime lastInteractionAt was not parseable"] : []),
    ...(submittedAt && submittedMs === null ? ["client runtime submittedAt was not parseable"] : []),
    ...(draftAction && !allowedHandoffActions.has(draftAction) ? [`unsupported draft handoff action '${draftAction}' was ignored`] : []),
    ...(staleByHydration ? ["client runtime hydration is stale for rollback handoff"] : [])
  ];

  return {
    contract: "hosted-kernel rollback client runtime state/v1",
    status: allowedClientRuntimeStatuses.has(status) ? status : "idle",
    currentRoute: clientRoute || null,
    lastHydratedAt: lastHydratedAt || null,
    lastInteractionAt: lastInteractionAt || null,
    stale: status === "stale" || staleByHydration,
    staleAfterMs: maxStalenessMs,
    dirtyFields: normalizeStringList(state.dirtyFields),
    pending: {
      action: pendingAction,
      packageName: pendingPackageName,
      requestId: pendingRequestId || null,
      submittedAt: submittedAt || null,
      optimisticInFlight,
      idempotencyKey: normalizeString(
        state.idempotencyKey || draft.idempotencyKey,
        pendingAction
          ? buildProofDigest({
              action: pendingAction,
              packageName: pendingPackageName,
              requestId: pendingRequestId || request.requestId || input.requestId || "",
              generatedAt
            })
          : ""
      )
    },
    draft: {
      action: allowedHandoffActions.has(draftAction) ? draftAction : null,
      packageName: normalizeString(draft.packageName, pendingPackageName),
      reason: normalizeString(draft.reason, ""),
      evidenceHash: normalizeString(draft.evidenceHash || draft.proofHash, ""),
      returnTo: normalizeString(draft.returnTo || client.returnTo || request.returnTo, "")
    },
    warnings
  };
}

function normalizeRequestContext(input, generatedAt) {
  const request = input.request && typeof input.request === "object" ? input.request : {};
  const client = input.client && typeof input.client === "object" ? input.client : {};
  const route = input.route && typeof input.route === "object" ? input.route : {};
  const clientRuntime = normalizeClientRuntimeState(input, request, client, route, generatedAt);
  const view = normalizeString(client.view || request.clientView, "operator-console").toLowerCase();
  const requestedAction = normalizeString(request.action || client.requestedAction || clientRuntime.pending.action, "").toLowerCase();
  const packageName = normalizeString(request.packageName || client.packageName, "all-packages");
  const requestId = normalizeString(request.requestId || request.id || input.requestId, `rollback:${packageName}:${generatedAt}`);
  const routeId = normalizeString(route.id || request.routeId || input.routeId, `${surfaceGroup}/${surfaceName}`);
  const returnTo = normalizeString(client.returnTo || request.returnTo, `/kernel/packages/${packageName}/rollback`);
  const warnings = [];

  if (!allowedClientViews.has(view)) {
    warnings.push(`unsupported client view '${view}' fell back to operator-console`);
  }
  if (requestedAction && !allowedHandoffActions.has(requestedAction)) {
    warnings.push(`unsupported requested action '${requestedAction}' will be resolved from rollback state`);
  }

  return {
    contract: "hosted-kernel rollback request context/v1",
    requestId,
    routeId,
    sessionId: normalizeString(client.sessionId || request.sessionId, "anonymous-session"),
    clientView: allowedClientViews.has(view) ? view : "operator-console",
    requestedAction: allowedHandoffActions.has(requestedAction) ? requestedAction : null,
    packageName,
    returnTo,
    receivedAt: normalizeString(request.receivedAt, generatedAt),
    clientRuntime,
    correlation: {
      traceId: normalizeString(request.traceId || input.traceId, requestId),
      actor: normalizeString(request.actor || client.actor, "hosted-kernel"),
      source: normalizeString(request.source || client.source, "package-sdk")
    },
    warnings
  };
}

function normalizeLifecycleSettings(input, generatedAt) {
  const settings = input && typeof input === "object" ? input : {};
  const schedule = settings.schedule && typeof settings.schedule === "object" ? settings.schedule : {};
  const mode = allowedScheduleModes.has(schedule.mode) ? schedule.mode : "manual";
  const enabled = normalizeBoolean(settings.enabled, true);
  const proofRequired = normalizeBoolean(settings.proofRequired, true);
  const maxConcurrentRollbacks = Number.isInteger(settings.maxConcurrentRollbacks) && settings.maxConcurrentRollbacks > 0
    ? Math.min(settings.maxConcurrentRollbacks, 5)
    : 1;
  const maintenanceWindow = typeof schedule.maintenanceWindow === "string" ? schedule.maintenanceWindow.trim() : "";
  const requestedAt = typeof schedule.requestedAt === "string" && schedule.requestedAt.trim()
    ? schedule.requestedAt.trim()
    : generatedAt;
  const validationErrors = [];
  const validationWarnings = [];
  const commandPolicy = normalizeCommandPolicy(settings, validationWarnings);
  const window = normalizeScheduleWindow(schedule, generatedAt, validationErrors, validationWarnings);

  if (!enabled && mode !== "manual") {
    validationErrors.push("rollback scheduling requires lifecycle controls to be enabled");
  }
  if (mode !== "manual" && !commandPolicy.controls.scheduling) {
    validationErrors.push("rollback scheduling mode requires scheduling controls to be enabled");
  }
  if (mode === "maintenance-window" && !maintenanceWindow) {
    validationErrors.push("maintenance-window scheduling requires schedule.maintenanceWindow");
  }
  if (mode === "immediate" && window.state === "not-yet-open") {
    validationErrors.push("immediate rollback scheduling cannot start before schedule.notBefore");
  }
  if (mode !== "manual" && window.state === "expired") {
    validationErrors.push("rollback schedule window has expired");
  }
  if (!proofRequired) {
    validationWarnings.push("terminal rollback states can export without proof hashes");
  }
  if (commandPolicy.disabledCommands.includes("enable") && commandPolicy.disabledCommands.includes("disable")) {
    validationWarnings.push("both enable and disable commands are disabled by lifecycle policy");
  }

  return {
    contract: "hosted-kernel rollback lifecycle settings/v2",
    enabled,
    proofRequired,
    maxConcurrentRollbacks,
    commandPolicy,
    schedule: {
      mode,
      maintenanceWindow: maintenanceWindow || null,
      requestedAt,
      window
    },
    validation: {
      ok: validationErrors.length === 0,
      errors: validationErrors,
      warnings: validationWarnings
    }
  };
}

function evaluateCommandPolicy(action, settings) {
  const errors = [];
  const controlKey = commandControlKeys.get(action);
  const policy = settings?.commandPolicy;

  if (!policy || !allowedLifecycleCommands.has(action)) {
    return errors;
  }
  if (controlKey && !policy.controls[controlKey]) {
    errors.push(`${action} is disabled because ${controlKey} controls are off`);
  }
  if (policy.disabledCommands.includes(action)) {
    errors.push(`${action} is disabled by lifecycle command policy`);
  }
  if (action === "schedule" && settings.schedule.window.state === "expired") {
    errors.push("schedule command cannot be accepted because the lifecycle window has expired");
  }
  if (action === "request-rollback" && settings.schedule.mode !== "manual" && settings.schedule.window.state === "not-yet-open") {
    errors.push("request-rollback must wait until the configured schedule window opens");
  }

  return errors;
}

function normalizeLifecycleCommand(rawCommand, index, generatedAt, workspaceBoundary, settings) {
  const command = rawCommand && typeof rawCommand === "object" ? rawCommand : {};
  const action = typeof command.action === "string" ? command.action.trim().toLowerCase() : "";
  const packageName = typeof command.packageName === "string" && command.packageName.trim()
    ? command.packageName.trim()
    : "all-packages";
  const requestedAt = typeof command.requestedAt === "string" && command.requestedAt.trim()
    ? command.requestedAt.trim()
    : generatedAt;
  const reason = typeof command.reason === "string" ? command.reason.trim() : "";
  const scheduleMode = typeof command.scheduleMode === "string" ? command.scheduleMode.trim() : "";
  const accepted = allowedLifecycleCommands.has(action);
  const errors = [];

  if (!accepted) {
    errors.push("unsupported lifecycle command");
  }
  if (action === "schedule" && scheduleMode && !allowedScheduleModes.has(scheduleMode)) {
    errors.push("unsupported schedule mode");
  }
  if ((action === "disable" || action === "request-rollback") && !reason) {
    errors.push(`${action} requires an operator reason`);
  }
  errors.push(...evaluateCommandPolicy(action, settings));
  const access = evaluateWorkspaceAccess(workspaceBoundary, action || "unknown", packageName);
  errors.push(...access.denials);

  return {
    id: typeof command.id === "string" && command.id.trim()
      ? command.id.trim()
      : `lifecycle:${index + 1}:${action || "unknown"}`,
    action: action || "unknown",
    packageName,
    requestedAt,
    requestedBy: typeof command.requestedBy === "string" && command.requestedBy.trim()
      ? command.requestedBy.trim()
      : "hosted-kernel",
    reason,
    scheduleMode: scheduleMode || null,
    lifecycleControl: commandControlKeys.get(action) || null,
    accepted: accepted && access.allowed && errors.length === 0,
    errors,
    access
  };
}

function normalizePersistedPackageState(rawPackage, generatedAt) {
  const packageState = rawPackage && typeof rawPackage === "object" ? rawPackage : {};
  const status = normalizeString(packageState.status, "idle").toLowerCase();

  return {
    packageName: normalizeString(packageState.packageName, "unknown-package"),
    status: allowedPersistedStatuses.has(status) ? status : "idle",
    lastEventId: normalizeString(packageState.lastEventId, ""),
    lastEventAt: normalizeString(packageState.lastEventAt, generatedAt),
    proofHash: normalizeString(packageState.proofHash, ""),
    attempt: Number.isInteger(packageState.attempt) && packageState.attempt > 0
      ? packageState.attempt
      : 1,
    dirty: normalizeBoolean(packageState.dirty, false)
  };
}

function normalizePersistedCommandJournalEntry(rawEntry, index, generatedAt) {
  const entry = rawEntry && typeof rawEntry === "object" ? rawEntry : {};
  const status = normalizeString(entry.status, "queued").toLowerCase();
  const commandId = normalizeString(entry.commandId || entry.id, `journal-command:${index + 1}`);
  const packageName = normalizeString(entry.packageName, "all-packages");
  const startedAt = normalizeString(entry.startedAt || entry.requestedAt, generatedAt);
  const updatedAt = normalizeString(entry.updatedAt || entry.appliedAt || entry.finishedAt, startedAt);
  const lastError = normalizeString(entry.lastError || entry.error, "");

  return {
    commandId,
    action: normalizeString(entry.action, "unknown").toLowerCase(),
    packageName,
    status: allowedCommandJournalStatuses.has(status) ? status : "queued",
    attempt: Number.isInteger(entry.attempt) && entry.attempt > 0 ? Math.min(entry.attempt, 25) : 1,
    startedAt,
    updatedAt,
    resultEventId: normalizeString(entry.resultEventId || entry.lastEventId, ""),
    proofHash: normalizeString(entry.proofHash, ""),
    lastError,
    restartToken: normalizeString(
      entry.restartToken,
      buildProofDigest({
        commandId,
        packageName,
        startedAt,
        surfaceId
      })
    ),
    terminal: terminalCommandJournalStatuses.has(status),
    warnings: [
      ...(!allowedCommandJournalStatuses.has(status) ? [`unsupported command journal status '${status}' fell back to queued`] : []),
      ...(startedAt && timestampMs(startedAt) === null ? [`command journal ${commandId} startedAt was not parseable`] : []),
      ...(updatedAt && timestampMs(updatedAt) === null ? [`command journal ${commandId} updatedAt was not parseable`] : [])
    ]
  };
}

function normalizePersistedState(rawState, requestContext, generatedAt) {
  const state = rawState && typeof rawState === "object" ? rawState : {};
  const status = normalizeString(state.status, "idle").toLowerCase();
  const packageStates = toArray(state.packageStates || state.packages)
    .map((packageState) => normalizePersistedPackageState(packageState, generatedAt));
  const commandJournal = toArray(state.commandJournal || state.commandsJournal || state.journal)
    .map((entry, index) => normalizePersistedCommandJournalEntry(entry, index, generatedAt));
  const checkpointId = normalizeString(
    state.checkpointId || state.id,
    `rollback-checkpoint:${requestContext.requestId}`
  );

  return {
    contract: "hosted-kernel rollback persisted state/v1",
    checkpointId,
    storageKey: normalizeString(
      state.storageKey,
      `aios:package-sdk:rollback:${requestContext.packageName}`
    ),
    revision: Number.isInteger(state.revision) && state.revision >= 0 ? state.revision : 0,
    status: allowedPersistedStatuses.has(status) ? status : "idle",
    lastPersistedAt: normalizeString(state.lastPersistedAt || state.persistedAt, generatedAt),
    appliedCommandIds: normalizeStringList(state.appliedCommandIds),
    inFlightCommandIds: normalizeStringList(state.inFlightCommandIds),
    dirtyPackageNames: normalizeStringList(state.dirtyPackageNames),
    packageStates,
    commandJournal
  };
}

function buildIdempotentLifecycleCommands(commands, persistedState) {
  const appliedCommandIds = new Set(persistedState.appliedCommandIds);
  const inFlightCommandIds = new Set(persistedState.inFlightCommandIds);
  const journalByCommandId = new Map(persistedState.commandJournal.map((entry) => [entry.commandId, entry]));
  const seenCommandIds = new Set();
  const executable = [];
  const resumable = [];
  const audit = [];

  for (const command of commands) {
    const duplicateInRequest = seenCommandIds.has(command.id);
    seenCommandIds.add(command.id);
    const journalEntry = journalByCommandId.get(command.id) || null;
    const alreadyApplied = appliedCommandIds.has(command.id) || journalEntry?.status === "applied";
    const alreadyInFlight = inFlightCommandIds.has(command.id) || journalEntry?.status === "in-flight";
    const terminalJournalState = journalEntry ? terminalCommandJournalStatuses.has(journalEntry.status) : false;
    const executableNow = command.accepted && !duplicateInRequest && !alreadyApplied && !alreadyInFlight && !terminalJournalState;
    const resumableNow = command.accepted && !duplicateInRequest && alreadyInFlight;

    if (executableNow) {
      executable.push(command);
    }
    if (resumableNow) {
      resumable.push({
        ...command,
        restartToken: journalEntry?.restartToken || buildProofDigest({ commandId: command.id, packageName: command.packageName, surfaceId }),
        attempt: journalEntry?.attempt || 1
      });
    }
    audit.push({
      commandId: command.id,
      action: command.action,
      packageName: command.packageName,
      accepted: command.accepted,
      executable: executableNow,
      resumable: resumableNow,
      access: command.access,
      idempotencyState: alreadyApplied
        ? "already-applied"
        : duplicateInRequest
          ? "duplicate-in-request"
          : alreadyInFlight
            ? "resume-in-flight"
            : terminalJournalState
              ? `terminal-${journalEntry.status}`
              : command.accepted
                ? "ready"
                : "rejected",
      journalStatus: journalEntry?.status || null,
      restartToken: journalEntry?.restartToken || null,
      errors: command.errors
    });
  }

  return {
    executable,
    resumable,
    skippedCount: audit.filter((entry) => entry.idempotencyState === "already-applied" || entry.idempotencyState === "duplicate-in-request").length,
    audit
  };
}

function buildHistorySnapshots(events, limit) {
  const packages = new Map();
  for (const event of events) {
    const previous = packages.get(event.packageName) || {
      packageName: event.packageName,
      firstEventAt: event.timestamp,
      lastStatus: "unknown",
      lastEventAt: event.timestamp,
      eventCount: 0,
      terminalEventCount: 0,
      exportEventCount: 0,
      lastProofHash: "",
      artifacts: [],
      statusCounts: {},
      typeCounts: {},
      phases: [],
      proofHashes: []
    };
    previous.firstEventAt = previous.firstEventAt < event.timestamp ? previous.firstEventAt : event.timestamp;
    previous.lastStatus = event.status;
    previous.lastEventAt = event.timestamp;
    previous.eventCount += 1;
    previous.terminalEventCount += terminalStatuses.has(event.status) ? 1 : 0;
    previous.exportEventCount += event.type === "artifact.exported" || event.artifact ? 1 : 0;
    previous.statusCounts[event.status] = (previous.statusCounts[event.status] || 0) + 1;
    previous.typeCounts[event.type] = (previous.typeCounts[event.type] || 0) + 1;
    const phase = eventPhase(event);
    if (!previous.phases.includes(phase)) {
      previous.phases.push(phase);
    }
    previous.lastProofHash = event.proofHash || previous.lastProofHash;
    if (event.proofHash && !previous.proofHashes.includes(event.proofHash)) {
      previous.proofHashes.push(event.proofHash);
    }
    if (event.artifact && !previous.artifacts.includes(event.artifact)) {
      previous.artifacts.push(event.artifact);
    }
    packages.set(event.packageName, previous);
  }

  return [...packages.values()]
    .map((snapshot) => {
      const terminal = terminalStatuses.has(snapshot.lastStatus);
      const missingProof = terminal && !snapshot.lastProofHash;
      return {
        ...snapshot,
        terminal,
        missingProof,
        exportReady: terminal && !missingProof,
        durationMs: elapsedMsBetween(snapshot.firstEventAt, snapshot.lastEventAt),
        transitionCount: Math.max(0, snapshot.eventCount - 1)
      };
    })
    .sort((left, right) => right.lastEventAt.localeCompare(left.lastEventAt))
    .slice(0, limit);
}

function buildTimeline(events) {
  const packageSeen = new Map();
  let previousTimestamp = null;

  return events
    .slice()
    .sort((left, right) => left.sequence - right.sequence || left.timestamp.localeCompare(right.timestamp))
    .map((event, index) => {
      const packageEventIndex = (packageSeen.get(event.packageName) || 0) + 1;
      packageSeen.set(event.packageName, packageEventIndex);
      const elapsedSincePreviousMs = previousTimestamp
        ? elapsedMsBetween(previousTimestamp, event.timestamp)
        : null;
      previousTimestamp = event.timestamp;

      return {
        index: index + 1,
        at: event.timestamp,
        label: `${event.packageName} ${event.status}`,
        eventId: event.id,
        packageName: event.packageName,
        status: event.status,
        type: event.type,
        phase: eventPhase(event),
        terminal: terminalStatuses.has(event.status),
        packageEventIndex,
        elapsedSincePreviousMs,
        proofHash: event.proofHash || null,
        exportArtifact: event.artifact || null
      };
    });
}

function buildAnalyticsCounters(events, snapshots, eventIsolation) {
  const terminalEvents = events.filter((event) => terminalStatuses.has(event.status));
  const exportEvents = events.filter((event) => event.type === "artifact.exported" || event.artifact);
  const proofBackedEvents = events.filter((event) => event.proofHash);
  const proofMissingTerminalEvents = terminalEvents.filter((event) => !event.proofHash);
  const terminalPackages = snapshots.filter((snapshot) => snapshot.terminal);
  const exportReadyPackages = snapshots.filter((snapshot) => snapshot.exportReady);

  return {
    totalEvents: events.length,
    visibleEvents: eventIsolation.visibleEventCount,
    withheldEvents: eventIsolation.withheldEventCount,
    terminalEvents: terminalEvents.length,
    nonTerminalEvents: events.length - terminalEvents.length,
    proofBackedEvents: proofBackedEvents.length,
    proofMissingTerminalEvents: proofMissingTerminalEvents.length,
    exportedArtifacts: exportEvents.length,
    packagesObserved: snapshots.length,
    terminalPackages: terminalPackages.length,
    exportReadyPackages: exportReadyPackages.length,
    blockedPackages: snapshots.filter((snapshot) => snapshot.lastStatus === "blocked").length,
    failedPackages: snapshots.filter((snapshot) => snapshot.lastStatus === "failed").length,
    exportCoverageRatio: terminalPackages.length
      ? Number((exportReadyPackages.length / terminalPackages.length).toFixed(4))
      : 0,
    byStatus: countBy(events, (event) => event.status),
    byType: countBy(events, (event) => event.type),
    byPhase: countBy(events, (event) => eventPhase(event)),
    byPackage: countBy(events, (event) => event.packageName),
    packagesMissingProof: proofMissingTerminalEvents.map((event) => event.packageName),
    latestTerminalEventAt: terminalEvents.length ? terminalEvents[terminalEvents.length - 1].timestamp : null
  };
}

function buildExportSummary(events, snapshots, counters, timeline, generatedAt) {
  const exportedArtifacts = events
    .filter((event) => event.type === "artifact.exported" || event.artifact)
    .map((event) => ({
      packageName: event.packageName,
      artifact: event.artifact || `${event.packageName}-rollback-report.json`,
      proofHash: event.proofHash || null,
      emittedAt: event.timestamp
    }));

  return {
    format: "application/vnd.aios.rollback.analytics+json;version=1",
    contract: "hosted-kernel rollback export summary/v2",
    generatedAt,
    surfaceId,
    packageCount: snapshots.length,
    eventCount: events.length,
    terminalEventCount: counters.terminalEvents,
    proofMissingTerminalEvents: counters.proofMissingTerminalEvents,
    exportCoverageRatio: counters.exportCoverageRatio,
    exportedArtifacts,
    packages: snapshots.map((snapshot) => ({
      packageName: snapshot.packageName,
      status: snapshot.lastStatus,
      eventCount: snapshot.eventCount,
      terminalEventCount: snapshot.terminalEventCount,
      exportReady: snapshot.exportReady,
      lastEventAt: snapshot.lastEventAt,
      durationMs: snapshot.durationMs,
      proofHash: snapshot.lastProofHash || null
    })),
    timeline: {
      firstEventAt: timeline[0]?.at || null,
      lastEventAt: timeline.at(-1)?.at || null,
      eventCount: timeline.length,
      terminalEventIds: timeline.filter((entry) => entry.terminal).map((entry) => entry.eventId)
    },
    proofHash: buildProofDigest({
      surfaceId,
      generatedAt,
      counters,
      packageNames: snapshots.map((snapshot) => snapshot.packageName),
      eventIds: events.map((event) => event.id)
    })
  };
}

function normalizeAnalyticsReportOptions(input) {
  const rawReport = input.analyticsReport || input.analytics || input.reporting || {};
  const report = rawReport && typeof rawReport === "object" ? rawReport : {};
  const requestedGranularity = normalizeString(report.granularity || report.bucketBy, "hour").toLowerCase();
  const maxBuckets = normalizePositiveInteger(report.maxBuckets || report.bucketLimit, 24, 96);
  const includeWithheldCounts = normalizeBoolean(report.includeWithheldCounts, true);

  return {
    contract: "hosted-kernel rollback analytics report options/v1",
    granularity: allowedAnalyticsGranularities.has(requestedGranularity) ? requestedGranularity : "hour",
    maxBuckets,
    includeWithheldCounts,
    warnings: [
      ...(!allowedAnalyticsGranularities.has(requestedGranularity)
        ? [`unsupported analytics granularity '${requestedGranularity}' fell back to hour`]
        : [])
    ]
  };
}

function bucketTimestamp(timestamp, granularity) {
  if (granularity === "event") {
    return timestamp;
  }
  const parsedMs = timestampMs(timestamp);
  if (parsedMs === null) {
    return "unparseable";
  }
  const bucket = new Date(parsedMs);
  bucket.setUTCMinutes(0, 0, 0);
  if (granularity === "day") {
    bucket.setUTCHours(0, 0, 0, 0);
  }
  return bucket.toISOString();
}

function buildTimelineBuckets(timeline, options) {
  const buckets = new Map();
  for (const entry of timeline) {
    const bucketKey = bucketTimestamp(entry.at, options.granularity);
    const bucket = buckets.get(bucketKey) || {
      bucket: bucketKey,
      firstEventAt: entry.at,
      lastEventAt: entry.at,
      eventCount: 0,
      terminalEventCount: 0,
      exportEventCount: 0,
      proofBackedEventCount: 0,
      packageNames: [],
      statusCounts: {},
      phaseCounts: {}
    };
    bucket.firstEventAt = bucket.firstEventAt < entry.at ? bucket.firstEventAt : entry.at;
    bucket.lastEventAt = bucket.lastEventAt > entry.at ? bucket.lastEventAt : entry.at;
    bucket.eventCount += 1;
    bucket.terminalEventCount += entry.terminal ? 1 : 0;
    bucket.exportEventCount += entry.exportArtifact ? 1 : 0;
    bucket.proofBackedEventCount += entry.proofHash ? 1 : 0;
    if (!bucket.packageNames.includes(entry.packageName)) {
      bucket.packageNames.push(entry.packageName);
    }
    bucket.statusCounts[entry.status] = (bucket.statusCounts[entry.status] || 0) + 1;
    bucket.phaseCounts[entry.phase] = (bucket.phaseCounts[entry.phase] || 0) + 1;
    buckets.set(bucketKey, bucket);
  }

  return [...buckets.values()]
    .sort((left, right) => left.bucket.localeCompare(right.bucket))
    .slice(-options.maxBuckets);
}

function buildPackageTransitionDeltas(snapshots, timeline) {
  const timelineByPackage = new Map();
  for (const entry of timeline) {
    const packageTimeline = timelineByPackage.get(entry.packageName) || [];
    packageTimeline.push(entry);
    timelineByPackage.set(entry.packageName, packageTimeline);
  }

  return snapshots.map((snapshot) => {
    const packageTimeline = timelineByPackage.get(snapshot.packageName) || [];
    const latest = packageTimeline.at(-1) || null;
    const previous = packageTimeline.length > 1 ? packageTimeline.at(-2) : null;
    const statusChanged = Boolean(previous && latest && previous.status !== latest.status);
    const phaseChanged = Boolean(previous && latest && previous.phase !== latest.phase);

    return {
      packageName: snapshot.packageName,
      previousStatus: previous?.status || null,
      currentStatus: snapshot.lastStatus,
      previousPhase: previous?.phase || null,
      currentPhase: latest?.phase || null,
      statusChanged,
      phaseChanged,
      transitionCount: snapshot.transitionCount,
      durationMs: snapshot.durationMs,
      terminal: snapshot.terminal,
      exportReady: snapshot.exportReady,
      proofState: snapshot.lastProofHash
        ? "proof-backed"
        : snapshot.terminal
          ? "terminal-missing-proof"
          : "pending-terminal",
      latestEventId: latest?.eventId || null,
      latestEventAt: snapshot.lastEventAt
    };
  });
}

function buildAnalyticsReportState(events, snapshots, counters, timeline, eventIsolation, requestContext, options, generatedAt) {
  const buckets = buildTimelineBuckets(timeline, options);
  const packageDeltas = buildPackageTransitionDeltas(snapshots, timeline);
  const firstEventAt = timeline[0]?.at || null;
  const lastEventAt = timeline.at(-1)?.at || null;
  const generatedMs = timestampMs(generatedAt);
  const lastEventMs = lastEventAt ? timestampMs(lastEventAt) : null;
  const staleAfterMs = 300000;
  const freshnessLagMs = generatedMs !== null && lastEventMs !== null
    ? Math.max(0, generatedMs - lastEventMs)
    : null;
  const packageExceptions = packageDeltas
    .filter((entry) => entry.proofState === "terminal-missing-proof" || entry.currentStatus === "failed" || entry.currentStatus === "blocked")
    .map((entry) => ({
      packageName: entry.packageName,
      status: entry.currentStatus,
      proofState: entry.proofState,
      latestEventAt: entry.latestEventAt
    }));
  const exportReady = counters.terminalEvents > 0 && counters.proofMissingTerminalEvents === 0;

  return {
    contract: "hosted-kernel rollback analytics reporting state/v1",
    generatedAt,
    requestId: requestContext.requestId,
    routeId: requestContext.routeId,
    options,
    reportingWindow: {
      firstEventAt,
      lastEventAt,
      durationMs: firstEventAt && lastEventAt ? elapsedMsBetween(firstEventAt, lastEventAt) : null,
      freshnessLagMs,
      stale: freshnessLagMs !== null && freshnessLagMs > staleAfterMs,
      staleAfterMs
    },
    counters: {
      totalEvents: counters.totalEvents,
      terminalEvents: counters.terminalEvents,
      exportedArtifacts: counters.exportedArtifacts,
      proofBackedEvents: counters.proofBackedEvents,
      proofMissingTerminalEvents: counters.proofMissingTerminalEvents,
      packagesObserved: counters.packagesObserved,
      exportCoverageRatio: counters.exportCoverageRatio,
      withheldEvents: options.includeWithheldCounts ? eventIsolation.withheldEventCount : 0
    },
    timelineBuckets: buckets,
    packageDeltas,
    packageExceptions,
    exportManifest: {
      ready: exportReady,
      format: "application/vnd.aios.rollback.analytics-report+json;version=1",
      suggestedFilename: `rollback-analytics-${requestContext.requestId}.json`,
      blockedReasonCodes: [
        ...(!counters.terminalEvents ? ["NO_TERMINAL_EVENTS"] : []),
        ...(counters.proofMissingTerminalEvents ? ["TERMINAL_EVENTS_MISSING_PROOF"] : []),
        ...(eventIsolation.withheldEventCount && options.includeWithheldCounts ? ["WORKSPACE_EVENTS_WITHHELD"] : [])
      ],
      bucketCount: buckets.length,
      exceptionCount: packageExceptions.length
    },
    audit: {
      proofHash: buildProofDigest({
        requestId: requestContext.requestId,
        routeId: requestContext.routeId,
        options,
        counters,
        buckets: buckets.map((bucket) => ({
          bucket: bucket.bucket,
          eventCount: bucket.eventCount,
          terminalEventCount: bucket.terminalEventCount,
          exportEventCount: bucket.exportEventCount
        })),
        packageDeltas: packageDeltas.map((entry) => ({
          packageName: entry.packageName,
          currentStatus: entry.currentStatus,
          proofState: entry.proofState,
          latestEventId: entry.latestEventId
        }))
      })
    }
  };
}

function buildLifecycleCommandState(commands, settings, workspaceBoundary) {
  const acceptedCommands = commands.filter((command) => command.accepted);
  const rejectedCommands = commands.filter((command) => !command.accepted);
  const policy = settings.commandPolicy;
  const latestDisable = acceptedCommands.findLast((command) => command.action === "disable");
  const latestEnable = acceptedCommands.findLast((command) => command.action === "enable");
  const disabledByCommand = Boolean(latestDisable && (!latestEnable || latestDisable.requestedAt >= latestEnable.requestedAt));
  const effectiveEnabled = settings.enabled && !disabledByCommand;
  const pendingSchedule = acceptedCommands
    .filter((command) => command.action === "schedule")
    .findLast((command) => true);
  const canceledSchedule = acceptedCommands
    .filter((command) => command.action === "cancel-schedule")
    .findLast((command) => true);
  const scheduleActive = Boolean(
    effectiveEnabled
      && pendingSchedule
      && (!canceledSchedule || pendingSchedule.requestedAt > canceledSchedule.requestedAt)
  );
  const commandAvailability = [...allowedLifecycleCommands].reduce((availability, action) => {
    const controlKey = commandControlKeys.get(action);
    const reasons = [];

    if (controlKey && !policy.controls[controlKey]) {
      reasons.push(`${controlKey} controls are disabled`);
    }
    if (policy.disabledCommands.includes(action)) {
      reasons.push(`${action} is disabled by lifecycle policy`);
    }
    if ((action === "schedule" || action === "request-rollback") && settings.schedule.window.state === "expired") {
      reasons.push("schedule window has expired");
    }
    if (action === "request-rollback" && settings.schedule.mode !== "manual" && settings.schedule.window.state === "not-yet-open") {
      reasons.push("schedule window is not yet open");
    }
    if (action !== "enable" && !effectiveEnabled) {
      reasons.push("rollback lifecycle controls are disabled");
    }
    if (!settings.validation.ok && (action === "schedule" || action === "request-rollback")) {
      reasons.push("lifecycle settings are invalid");
    }

    availability[action] = {
      allowed: reasons.length === 0,
      control: controlKey || null,
      reasons
    };
    return availability;
  }, {});

  return {
    effectiveEnabled,
    commandCount: commands.length,
    acceptedCount: acceptedCommands.length,
    rejectedCount: rejectedCommands.length,
    controls: {
      canEnable: !effectiveEnabled && commandAvailability.enable.allowed,
      canDisable: effectiveEnabled && commandAvailability.disable.allowed,
      canSchedule: commandAvailability.schedule.allowed,
      canCancelSchedule: scheduleActive,
      canRequestRollback: commandAvailability["request-rollback"].allowed,
      canExportProof: settings.proofRequired && commandAvailability["export-proof"].allowed
    },
    commandAvailability,
    schedule: {
      active: scheduleActive,
      mode: pendingSchedule?.scheduleMode || settings.schedule.mode,
      requestedAt: pendingSchedule?.requestedAt || settings.schedule.requestedAt,
      packageName: pendingSchedule?.packageName || "all-packages",
      window: settings.schedule.window
    },
    audit: commands.map((command) => ({
      commandId: command.id,
      action: command.action,
      packageName: command.packageName,
      requestedBy: command.requestedBy,
      requestedAt: command.requestedAt,
      accepted: command.accepted,
      access: command.access,
      errors: command.errors
    }))
  };
}

function buildLifecycleControlPlan(lifecycleState, settings, workspaceBoundary, requestContext, commandIdempotency, generatedAt) {
  const availabilityEntries = [...allowedLifecycleCommands].map((action) => {
    const availability = lifecycleState.commandAvailability[action];
    const access = evaluateWorkspaceAccess(workspaceBoundary, action, requestContext.packageName);

    return {
      action,
      enabled: Boolean(availability?.allowed && access.allowed),
      control: availability?.control || null,
      deniedByPolicy: availability?.reasons || [],
      deniedByAccess: access.denials,
      requiredRole: access.requiredRole,
      requiredPermission: access.requiredPermission
    };
  });
  const availabilityByAction = new Map(availabilityEntries.map((entry) => [entry.action, entry]));
  const executableActions = new Set(commandIdempotency.executable.map((command) => command.action));
  const resumableActions = new Set(commandIdempotency.resumable.map((command) => command.action));
  const rejectedAudit = commandIdempotency.audit
    .filter((entry) => !entry.accepted || entry.idempotencyState === "rejected")
    .map((entry) => ({
      commandId: entry.commandId,
      action: entry.action,
      packageName: entry.packageName,
      reasons: entry.errors.length ? entry.errors : entry.access.denials
    }));
  const scheduleWindow = settings.schedule.window;
  const scheduleBlocked = !lifecycleState.controls.canSchedule || !availabilityByAction.get("schedule")?.enabled;
  const requestBlocked = !lifecycleState.controls.canRequestRollback || !availabilityByAction.get("request-rollback")?.enabled;
  const proofBlocked = settings.proofRequired && !lifecycleState.controls.canExportProof;
  const controlActions = [
    ...(!lifecycleState.effectiveEnabled && availabilityByAction.get("enable")?.enabled ? [{
      type: "enable-controls",
      action: "enable",
      priority: 10,
      label: "Enable hosted-kernel rollback lifecycle controls",
      blocking: true,
      packageName: requestContext.packageName,
      reasons: ["rollback controls are currently disabled"]
    }] : []),
    ...(!settings.validation.ok ? [{
      type: "fix-settings",
      action: "schedule",
      priority: 20,
      label: "Fix rollback lifecycle settings",
      blocking: true,
      packageName: requestContext.packageName,
      reasons: settings.validation.errors
    }] : []),
    ...(scheduleWindow.state === "not-yet-open" && settings.schedule.mode !== "manual" ? [{
      type: "await-schedule-window",
      action: "schedule",
      priority: 30,
      label: "Wait for rollback schedule window",
      blocking: false,
      packageName: lifecycleState.schedule.packageName,
      opensInMs: scheduleWindow.opensInMs,
      reasons: [`schedule window opens at ${scheduleWindow.notBefore}`]
    }] : []),
    ...(scheduleBlocked && settings.schedule.mode !== "manual" ? [{
      type: "enable-scheduling",
      action: "schedule",
      priority: 40,
      label: "Enable scheduling controls for rollback lifecycle",
      blocking: true,
      packageName: lifecycleState.schedule.packageName,
      reasons: [
        ...availabilityByAction.get("schedule").deniedByPolicy,
        ...availabilityByAction.get("schedule").deniedByAccess
      ]
    }] : []),
    ...(requestBlocked && lifecycleState.effectiveEnabled ? [{
      type: "enable-execution",
      action: "request-rollback",
      priority: 50,
      label: "Enable rollback execution controls",
      blocking: true,
      packageName: requestContext.packageName,
      reasons: [
        ...availabilityByAction.get("request-rollback").deniedByPolicy,
        ...availabilityByAction.get("request-rollback").deniedByAccess
      ]
    }] : []),
    ...(proofBlocked ? [{
      type: "enable-proof-export",
      action: "export-proof",
      priority: 60,
      label: "Enable rollback proof export controls",
      blocking: true,
      packageName: requestContext.packageName,
      reasons: availabilityByAction.get("export-proof").deniedByPolicy
    }] : []),
    ...(commandIdempotency.resumable.length ? [{
      type: "resume-lifecycle-command",
      action: "request-rollback",
      priority: 70,
      label: "Resume in-flight rollback lifecycle commands",
      blocking: false,
      packageName: requestContext.packageName,
      commandIds: commandIdempotency.resumable.map((command) => command.id),
      reasons: ["accepted lifecycle commands were in-flight before restart"]
    }] : []),
    ...(commandIdempotency.executable.length ? [{
      type: "dispatch-lifecycle-command",
      action: "request-rollback",
      priority: 80,
      label: "Dispatch accepted rollback lifecycle commands",
      blocking: false,
      packageName: requestContext.packageName,
      commandIds: commandIdempotency.executable.map((command) => command.id),
      reasons: ["accepted lifecycle commands are ready for provider dispatch"]
    }] : [])
  ];
  const nextControlAction = controlActions
    .slice()
    .sort((left, right) => left.priority - right.priority)[0] || null;

  return {
    contract: "hosted-kernel rollback lifecycle control plan/v1",
    generatedAt,
    packageName: requestContext.packageName,
    availability: availabilityEntries,
    schedule: {
      active: lifecycleState.schedule.active,
      mode: lifecycleState.schedule.mode,
      state: scheduleWindow.state,
      notBefore: scheduleWindow.notBefore,
      notAfter: scheduleWindow.notAfter,
      opensInMs: scheduleWindow.opensInMs,
      expiresInMs: scheduleWindow.expiresInMs,
      canCancel: lifecycleState.controls.canCancelSchedule
    },
    dispatch: {
      executableCommandCount: commandIdempotency.executable.length,
      resumableCommandCount: commandIdempotency.resumable.length,
      skippedCommandCount: commandIdempotency.skippedCount,
      executableActions: [...executableActions],
      resumableActions: [...resumableActions],
      rejectedCommands: rejectedAudit
    },
    nextControlAction,
    blockingActionCount: controlActions.filter((action) => action.blocking).length,
    actions: controlActions,
    audit: {
      proofHash: buildProofDigest({
        packageName: requestContext.packageName,
        effectiveEnabled: lifecycleState.effectiveEnabled,
        availability: availabilityEntries.map((entry) => ({
          action: entry.action,
          enabled: entry.enabled,
          deniedByPolicy: entry.deniedByPolicy,
          deniedByAccess: entry.deniedByAccess
        })),
        schedule: lifecycleState.schedule,
        commandAudit: commandIdempotency.audit.map((entry) => ({
          commandId: entry.commandId,
          idempotencyState: entry.idempotencyState,
          executable: entry.executable,
          resumable: entry.resumable
        }))
      })
    }
  };
}

function buildPersistentRecoveryState(persistedState, snapshots, commands, idempotencyLedger, generatedAt) {
  const snapshotsByPackage = new Map(snapshots.map((snapshot) => [snapshot.packageName, snapshot]));
  const persistedByPackage = new Map(persistedState.packageStates.map((entry) => [entry.packageName, entry]));
  const commandJournalById = new Map(persistedState.commandJournal.map((entry) => [entry.commandId, entry]));
  const packageNames = new Set([
    ...snapshotsByPackage.keys(),
    ...persistedByPackage.keys(),
    ...persistedState.dirtyPackageNames
  ]);
  const shapedPackages = [...packageNames].sort().map((packageName) => {
    const snapshot = snapshotsByPackage.get(packageName);
    const persisted = persistedByPackage.get(packageName);
    const snapshotTerminal = snapshot ? terminalStatuses.has(snapshot.lastStatus) : false;
    const status = snapshot
      ? snapshot.lastStatus
      : persisted?.status || "idle";
    const dirty = Boolean(
      persisted?.dirty
        || persistedState.dirtyPackageNames.includes(packageName)
        || (persisted?.status === "running" && !snapshotTerminal)
    );

    return {
      packageName,
      status,
      restartSafeStatus: snapshotTerminal
        ? "terminal"
        : dirty
          ? "recovering"
          : status === "scheduled"
            ? "scheduled"
            : "idle",
      lastEventId: snapshot ? `${snapshot.packageName}:${snapshot.eventCount}:${snapshot.lastStatus}` : persisted?.lastEventId || null,
      lastEventAt: snapshot?.lastEventAt || persisted?.lastEventAt || generatedAt,
      proofHash: snapshot?.lastProofHash || persisted?.proofHash || null,
      attempt: persisted?.attempt || 1,
      dirty
    };
  });
  const commandIds = new Set(commands.map((command) => command.id));
  const acceptedCommandIds = new Set(commands.filter((command) => command.accepted).map((command) => command.id));
  const nowJournalEntries = idempotencyLedger.executable.map((command) => ({
    commandId: command.id,
    action: command.action,
    packageName: command.packageName,
    status: "queued",
    attempt: 1,
    startedAt: generatedAt,
    updatedAt: generatedAt,
    resultEventId: "",
    proofHash: "",
    lastError: "",
    restartToken: buildProofDigest({
      commandId: command.id,
      packageName: command.packageName,
      action: command.action,
      revision: persistedState.revision + 1
    }),
    terminal: false,
    warnings: []
  }));
  const replayCommandIds = new Set(nowJournalEntries.map((entry) => entry.commandId));
  const resumeCommandIds = new Set(idempotencyLedger.resumable.map((command) => command.id));
  const projectedCommandJournal = [
    ...persistedState.commandJournal.map((entry) => {
      if (!commandIds.has(entry.commandId) && entry.status === "in-flight") {
        return {
          ...entry,
          status: "stale",
          updatedAt: generatedAt,
          lastError: entry.lastError || "in-flight command was not present after restart",
          terminal: true
        };
      }
      if (resumeCommandIds.has(entry.commandId)) {
        return {
          ...entry,
          status: "in-flight",
          updatedAt: generatedAt,
          attempt: Math.min(entry.attempt + 1, 25),
          terminal: false
        };
      }
      return entry;
    }),
    ...nowJournalEntries.filter((entry) => !commandJournalById.has(entry.commandId))
  ];
  const recoveryActions = [
    ...persistedState.inFlightCommandIds
      .filter((commandId) => !commandIds.has(commandId))
      .map((commandId) => ({
        type: "clear-stale-command",
        commandId,
        reason: "in-flight command was not present after restart"
      })),
    ...idempotencyLedger.resumable.map((command) => ({
      type: "resume-command",
      commandId: command.id,
      action: command.action,
      packageName: command.packageName,
      restartToken: command.restartToken,
      attempt: command.attempt,
      reason: "accepted command was already in-flight before restart"
    })),
    ...idempotencyLedger.executable.map((command) => ({
      type: "replay-command",
      commandId: command.id,
      action: command.action,
      packageName: command.packageName,
      reason: "accepted command has not been applied to persisted state"
    })),
    ...shapedPackages
      .filter((entry) => entry.restartSafeStatus === "recovering")
      .map((entry) => ({
        type: "resume-package",
        packageName: entry.packageName,
        reason: "package was dirty or running before restart without terminal evidence"
      })),
    ...shapedPackages
      .filter((entry) => terminalStatuses.has(entry.status) && !entry.proofHash)
      .map((entry) => ({
        type: "export-proof",
        packageName: entry.packageName,
        reason: "terminal package state is missing proofHash"
      }))
  ];
  const terminalPackages = shapedPackages.filter((entry) => terminalStatuses.has(entry.status));
  const status = recoveryActions.some((action) => action.type === "resume-package" || action.type === "clear-stale-command")
    ? "recovering"
    : recoveryActions.some((action) => action.type === "resume-command")
      ? "recovering"
    : terminalPackages.some((entry) => entry.status === "failed")
      ? "failed"
      : terminalPackages.some((entry) => entry.status === "blocked")
        ? "blocked"
        : terminalPackages.length > 0 && terminalPackages.length === shapedPackages.length
          ? terminalPackages.every((entry) => entry.status === "skipped")
            ? "skipped"
            : "completed"
          : shapedPackages.some((entry) => entry.status === "scheduled")
            ? "scheduled"
            : persistedState.status;
  const nextAppliedCommandIds = [
    ...new Set([
      ...persistedState.appliedCommandIds,
      ...projectedCommandJournal
        .filter((entry) => entry.status === "applied")
        .map((entry) => entry.commandId)
    ])
  ];
  const nextInFlightCommandIds = [
    ...new Set([
      ...persistedState.inFlightCommandIds.filter((commandId) => commandIds.has(commandId)),
      ...projectedCommandJournal
        .filter((entry) => entry.status === "queued" || entry.status === "in-flight")
        .filter((entry) => acceptedCommandIds.has(entry.commandId) || replayCommandIds.has(entry.commandId))
        .map((entry) => entry.commandId)
    ])
  ];
  const nextDirtyPackageNames = [
    ...new Set(shapedPackages
      .filter((entry) => entry.dirty || entry.restartSafeStatus === "recovering")
      .map((entry) => entry.packageName))
  ];
  const nextRevision = persistedState.revision + (
    recoveryActions.length
      || idempotencyLedger.executable.length
      || projectedCommandJournal.length !== persistedState.commandJournal.length
      ? 1
      : 0
  );
  const checkpointProposal = {
    contract: "hosted-kernel rollback checkpoint proposal/v1",
    checkpointId: persistedState.checkpointId,
    storageKey: persistedState.storageKey,
    baseRevision: persistedState.revision,
    nextRevision,
    compareAndSwap: {
      expectedRevision: persistedState.revision,
      writeRevision: nextRevision,
      idempotencyKey: buildProofDigest({
        checkpointId: persistedState.checkpointId,
        baseRevision: persistedState.revision,
        commandIds: [...commandIds],
        packageNames: shapedPackages.map((entry) => entry.packageName)
      })
    },
    writeSet: {
      status,
      lastPersistedAt: generatedAt,
      appliedCommandIds: nextAppliedCommandIds,
      inFlightCommandIds: nextInFlightCommandIds,
      dirtyPackageNames: nextDirtyPackageNames,
      commandJournal: projectedCommandJournal.map((entry) => ({
        commandId: entry.commandId,
        action: entry.action,
        packageName: entry.packageName,
        status: entry.status,
        attempt: entry.attempt,
        startedAt: entry.startedAt,
        updatedAt: entry.updatedAt,
        restartToken: entry.restartToken,
        resultEventId: entry.resultEventId || null,
        proofHash: entry.proofHash || null,
        lastError: entry.lastError || null
      }))
    }
  };

  return {
    ...persistedState,
    status,
    nextRevision,
    restartSafe: recoveryActions.every((action) => (
      action.type !== "resume-package"
        && action.type !== "clear-stale-command"
        && action.type !== "resume-command"
    )),
    restartSafeStatus: status === "recovering"
      ? "recovery-required"
      : nextInFlightCommandIds.length
        ? "commands-in-flight"
        : "stable",
    packages: shapedPackages,
    commandJournal: projectedCommandJournal,
    checkpointProposal,
    recoveryActions,
    idempotency: {
      appliedCommandIds: persistedState.appliedCommandIds,
      inFlightCommandIds: persistedState.inFlightCommandIds,
      executableCommandCount: idempotencyLedger.executable.length,
      resumableCommandCount: idempotencyLedger.resumable.length,
      skippedCommandCount: idempotencyLedger.skippedCount,
      audit: idempotencyLedger.audit
    },
    warnings: [
      ...persistedState.commandJournal.flatMap((entry) => entry.warnings),
      ...projectedCommandJournal
        .filter((entry) => entry.status === "stale")
        .map((entry) => `${entry.commandId} was marked stale during restart recovery`)
    ],
    proofHash: buildProofDigest({
      checkpointId: persistedState.checkpointId,
      revision: nextRevision,
      status,
      packages: shapedPackages,
      recoveryActions,
      commandJournal: projectedCommandJournal.map((entry) => ({
        commandId: entry.commandId,
        status: entry.status,
        attempt: entry.attempt,
        restartToken: entry.restartToken
      }))
    })
  };
}

function buildNextAction(reportState, lifecycleState, settings, workspaceBoundary, requestContext, operationalHealth) {
  const requestAccess = evaluateWorkspaceAccess(
    workspaceBoundary,
    "request-rollback",
    requestContext.packageName
  );
  if (!requestAccess.allowed) {
    return {
      type: "fix-settings",
      label: "Resolve workspace permissions before running hosted-kernel rollback",
      blocking: true,
      reasons: requestAccess.denials
    };
  }
  if (!settings.validation.ok) {
    return {
      type: "fix-settings",
      label: "Fix rollback lifecycle settings before accepting commands",
      blocking: true,
      reasons: settings.validation.errors
    };
  }
  if (operationalHealth.blocking) {
    return {
      type: "fix-settings",
      label: "Resolve rollback operational health before continuing",
      blocking: true,
      reasons: operationalHealth.actionableErrors.length
        ? operationalHealth.actionableErrors.map((entry) => `${entry.target}: ${entry.message}`)
        : operationalHealth.problems
    };
  }
  if (!lifecycleState.effectiveEnabled) {
    return {
      type: "enable-controls",
      label: "Enable rollback controls before running hosted-kernel rollback",
      blocking: true,
      reasons: ["rollback lifecycle controls are disabled"]
    };
  }
  if (!lifecycleState.controls.canRequestRollback && !reportState.readyForExport) {
    return {
      type: "fix-settings",
      label: "Resolve rollback execution controls before requesting rollback",
      blocking: true,
      reasons: lifecycleState.commandAvailability["request-rollback"].reasons
    };
  }
  if (reportState.requiresProof && settings.proofRequired && !lifecycleState.controls.canExportProof) {
    return {
      type: "fix-settings",
      label: "Enable proof export controls before exporting rollback evidence",
      blocking: true,
      reasons: lifecycleState.commandAvailability["export-proof"].reasons
    };
  }
  if (reportState.requiresProof && settings.proofRequired) {
    return {
      type: "export-proof",
      label: "Export proof for terminal rollback states",
      blocking: false,
      reasons: ["one or more terminal rollback events are missing proofHash"]
    };
  }
  if (lifecycleState.schedule.active) {
    return {
      type: "await-schedule",
      label: "Await scheduled rollback execution",
      blocking: false,
      reasons: [`schedule active for ${lifecycleState.schedule.packageName}`]
    };
  }
  if (!reportState.readyForExport) {
    return {
      type: "request-rollback",
      label: "Request rollback or record a terminal rollback event",
      blocking: false,
      reasons: ["no terminal rollback evidence is ready for export"]
    };
  }
  return {
    type: "ready-to-export",
    label: "Rollback analytics and proof package are ready for export",
    blocking: false,
    reasons: []
  };
}

function normalizePreviewAcceptance(rawAcceptance, index, generatedAt, workspaceBoundary) {
  const acceptance = rawAcceptance && typeof rawAcceptance === "object" ? rawAcceptance : {};
  const decision = typeof acceptance.decision === "string"
    ? acceptance.decision.trim().toLowerCase()
    : "deferred";
  const acceptedDecision = allowedPreviewDecisions.has(decision) ? decision : "deferred";
  const packageName = typeof acceptance.packageName === "string" && acceptance.packageName.trim()
    ? acceptance.packageName.trim()
    : "all-packages";
  const decidedAt = typeof acceptance.decidedAt === "string" && acceptance.decidedAt.trim()
    ? acceptance.decidedAt.trim()
    : generatedAt;
  const reason = typeof acceptance.reason === "string" ? acceptance.reason.trim() : "";
  const errors = [];

  if (decision && !allowedPreviewDecisions.has(decision)) {
    errors.push("unsupported preview acceptance decision");
  }
  if (acceptedDecision === "rejected" && !reason) {
    errors.push("rejected preview decisions require an operator reason");
  }
  const access = evaluateWorkspaceAccess(workspaceBoundary, "accept-preview", packageName);
  errors.push(...access.denials);

  return {
    id: typeof acceptance.id === "string" && acceptance.id.trim()
      ? acceptance.id.trim()
      : `preview-acceptance:${index + 1}:${packageName}`,
    packageName,
    decision: acceptedDecision,
    decidedAt,
    decidedBy: typeof acceptance.decidedBy === "string" && acceptance.decidedBy.trim()
      ? acceptance.decidedBy.trim()
      : "hosted-kernel",
    reason,
    evidenceHash: typeof acceptance.evidenceHash === "string" ? acceptance.evidenceHash.trim() : "",
    valid: access.allowed && errors.length === 0,
    errors,
    access
  };
}

function latestAcceptanceForPackage(acceptances, packageName) {
  const packageAcceptance = acceptances
    .filter((acceptance) => acceptance.packageName === packageName)
    .sort((left, right) => right.decidedAt.localeCompare(left.decidedAt))[0];
  const globalAcceptance = acceptances
    .filter((acceptance) => acceptance.packageName === "all-packages")
    .sort((left, right) => right.decidedAt.localeCompare(left.decidedAt))[0];
  return packageAcceptance || globalAcceptance || null;
}

function buildPreviewAcceptanceState(acceptances, snapshots) {
  const knownPackages = new Set(snapshots.map((snapshot) => snapshot.packageName));
  const decisionsByPackage = snapshots.map((snapshot) => {
    const acceptance = latestAcceptanceForPackage(acceptances, snapshot.packageName);
    return {
      packageName: snapshot.packageName,
      decision: acceptance?.decision || "deferred",
      decidedAt: acceptance?.decidedAt || null,
      decidedBy: acceptance?.decidedBy || null,
      reason: acceptance?.reason || "",
      evidenceHash: acceptance?.evidenceHash || null,
      accepted: acceptance?.decision === "accepted" && acceptance.valid,
      rejected: acceptance?.decision === "rejected" && acceptance.valid
    };
  });
  const orphanedAcceptances = acceptances
    .filter((acceptance) => acceptance.packageName !== "all-packages" && !knownPackages.has(acceptance.packageName))
    .map((acceptance) => ({
      acceptanceId: acceptance.id,
      packageName: acceptance.packageName,
      decision: acceptance.decision,
      reason: "acceptance references a package without rollback preview evidence"
    }));

  return {
    decisionCount: acceptances.length,
    acceptedCount: decisionsByPackage.filter((decision) => decision.accepted).length,
    rejectedCount: decisionsByPackage.filter((decision) => decision.rejected).length,
    deferredCount: decisionsByPackage.filter((decision) => decision.decision === "deferred").length,
    invalidCount: acceptances.filter((acceptance) => !acceptance.valid).length,
    decisionsByPackage,
    orphanedAcceptances,
    audit: acceptances.map((acceptance) => ({
      acceptanceId: acceptance.id,
      packageName: acceptance.packageName,
      decision: acceptance.decision,
      decidedBy: acceptance.decidedBy,
      decidedAt: acceptance.decidedAt,
      valid: acceptance.valid,
      errors: acceptance.errors
    }))
  };
}

function buildPreviewPackageRows(snapshots, acceptanceState, settings) {
  const decisions = new Map(acceptanceState.decisionsByPackage.map((decision) => [decision.packageName, decision]));

  return snapshots.map((snapshot) => {
    const decision = decisions.get(snapshot.packageName);
    const terminal = terminalStatuses.has(snapshot.lastStatus);
    const proofReady = !settings.proofRequired || Boolean(snapshot.lastProofHash);
    const accepted = Boolean(decision?.accepted);
    const rejected = Boolean(decision?.rejected);
    const readiness = rejected
      ? "blocked-by-operator"
      : !terminal
        ? "waiting-for-terminal-event"
        : !proofReady
          ? "needs-proof"
          : accepted
            ? "accepted"
            : "awaiting-acceptance";

    return {
      packageName: snapshot.packageName,
      title: `${snapshot.packageName} rollback preview`,
      status: snapshot.lastStatus,
      lastEventAt: snapshot.lastEventAt,
      eventCount: snapshot.eventCount,
      proofHash: snapshot.lastProofHash || null,
      artifactCount: snapshot.artifacts.length,
      readiness,
      acceptanceDecision: decision?.decision || "deferred",
      accepted,
      blockingReasons: [
        ...(!terminal ? ["no terminal rollback event recorded"] : []),
        ...(!proofReady ? ["terminal rollback event is missing proofHash"] : []),
        ...(rejected ? ["operator rejected this rollback preview"] : []),
        ...(terminal && proofReady && !accepted && !rejected ? ["operator preview acceptance is required"] : [])
      ]
    };
  });
}

function buildValidationSummary(settings, lifecycleState, reportState, acceptanceState, previewRows, workspaceBoundary, requestContext, providerNegotiation, operationalHealth) {
  const requestAccess = evaluateWorkspaceAccess(workspaceBoundary, "request-rollback", requestContext.packageName);
  const gates = [
    {
      id: "workspace-boundary",
      label: "Rollback request is inside tenant workspace boundaries",
      ok: requestAccess.allowed && workspaceBoundary.requestedPackageInScope,
      severity: "error",
      details: [
        ...requestAccess.denials,
        ...workspaceBoundary.warnings
      ]
    },
    {
      id: "settings-valid",
      label: "Rollback lifecycle settings are valid",
      ok: settings.validation.ok,
      severity: "error",
      details: settings.validation.errors
    },
    {
      id: "controls-enabled",
      label: "Hosted-kernel rollback controls are enabled",
      ok: lifecycleState.effectiveEnabled,
      severity: "error",
      details: lifecycleState.effectiveEnabled ? [] : ["rollback lifecycle controls are disabled"]
    },
    {
      id: "lifecycle-command-policy",
      label: "Lifecycle command policy allows the next rollback action",
      ok: lifecycleState.controls.canRequestRollback || reportState.readyForExport,
      severity: "error",
      details: lifecycleState.controls.canRequestRollback || reportState.readyForExport
        ? []
        : lifecycleState.commandAvailability["request-rollback"].reasons
    },
    {
      id: "terminal-evidence",
      label: "At least one terminal rollback event is present",
      ok: reportState.readyForExport,
      severity: "warning",
      details: reportState.readyForExport ? [] : ["record completed, failed, blocked, or skipped rollback evidence"]
    },
    {
      id: "proof-ready",
      label: "Terminal rollback events include proof hashes",
      ok: !reportState.requiresProof || !settings.proofRequired,
      severity: "warning",
      details: reportState.requiresProof && settings.proofRequired
        ? ["one or more terminal rollback events are missing proofHash"]
        : []
    },
    {
      id: "preview-accepted",
      label: "Rollback previews have operator acceptance",
      ok: previewRows.length > 0 && previewRows.every((row) => row.accepted),
      severity: "warning",
      details: previewRows
        .filter((row) => !row.accepted)
        .map((row) => `${row.packageName}: ${row.readiness}`)
    },
    {
      id: "acceptance-valid",
      label: "Preview acceptance decisions are valid",
      ok: acceptanceState.invalidCount === 0 && acceptanceState.orphanedAcceptances.length === 0,
      severity: "error",
      details: [
        ...acceptanceState.audit.filter((entry) => !entry.valid).map((entry) => `${entry.acceptanceId}: ${entry.errors.join(", ")}`),
        ...acceptanceState.orphanedAcceptances.map((entry) => `${entry.acceptanceId}: ${entry.reason}`)
      ]
    },
    {
      id: "provider-contract-ready",
      label: "A rollback integration provider can service the requested package",
      ok: providerNegotiation.ready,
      severity: "error",
      details: providerNegotiation.ready
        ? []
        : providerNegotiation.candidates.flatMap((candidate) => {
            const prefix = `${candidate.providerId}:`;
            return candidate.denials.length
              ? candidate.denials.map((denial) => `${prefix} ${denial}`)
              : [`${prefix} provider is not ready`];
          })
    },
    {
      id: "operational-health",
      label: "Rollback operational health can continue safely",
      ok: !operationalHealth.blocking,
      severity: "error",
      details: operationalHealth.blocking
        ? operationalHealth.actionableErrors.map((entry) => `${entry.code} ${entry.target}: ${entry.action}`)
        : []
    },
    {
      id: "degraded-mode",
      label: "Degraded rollback mode is explicit when health is impaired",
      ok: !operationalHealth.degraded || operationalHealth.degradedMode.enabled,
      severity: "warning",
      details: operationalHealth.degraded && !operationalHealth.degradedMode.enabled
        ? operationalHealth.problems
        : []
    }
  ];

  return {
    ok: gates.every((gate) => gate.ok || gate.severity !== "error"),
    readyForOperatorAcceptance: gates
      .filter((gate) => gate.id !== "preview-accepted")
      .every((gate) => gate.ok || gate.severity !== "error"),
    blockingGateIds: gates.filter((gate) => !gate.ok && gate.severity === "error").map((gate) => gate.id),
    warningGateIds: gates.filter((gate) => !gate.ok && gate.severity === "warning").map((gate) => gate.id),
    gates
  };
}

function buildClientNextSteps(validationSummary, previewRows, nextAction) {
  const steps = [];
  for (const gate of validationSummary.gates.filter((candidate) => !candidate.ok)) {
    steps.push({
      type: gate.id,
      label: gate.label,
      blocking: gate.severity === "error",
      details: gate.details
    });
  }
  for (const row of previewRows.filter((candidate) => candidate.readiness === "awaiting-acceptance")) {
    steps.push({
      type: "accept-preview",
      label: `Accept rollback preview for ${row.packageName}`,
      packageName: row.packageName,
      blocking: false,
      details: row.blockingReasons
    });
  }

  return steps.length ? steps : [{
    type: nextAction.type,
    label: nextAction.label,
    blocking: nextAction.blocking,
    details: nextAction.reasons
  }];
}

function buildRouteCommitOperations(previewRows, commandIdempotency, requestContext, workspaceBoundary, generatedAt) {
  const rollbackCommandsByPackage = new Map();
  for (const command of commandIdempotency.executable.filter((entry) => entry.action === "request-rollback")) {
    const commands = rollbackCommandsByPackage.get(command.packageName) || [];
    commands.push(command);
    rollbackCommandsByPackage.set(command.packageName, commands);
  }

  return previewRows.map((row, index) => {
    const packageCommands = [
      ...(rollbackCommandsByPackage.get(row.packageName) || []),
      ...(rollbackCommandsByPackage.get("all-packages") || [])
    ];
    const access = evaluateWorkspaceAccess(workspaceBoundary, "request-rollback", row.packageName);
    const ready = row.accepted && row.blockingReasons.length === 0 && access.allowed;
    const operationId = `rollback-route:${requestContext.requestId}:${index + 1}:${row.packageName}`;
    const proofPayload = {
      operationId,
      requestId: requestContext.requestId,
      tenantId: workspaceBoundary.tenantId,
      workspaceId: workspaceBoundary.workspaceId,
      packageName: row.packageName,
      status: row.status,
      proofHash: row.proofHash,
      accepted: row.accepted,
      commandIds: packageCommands.map((command) => command.id)
    };

    return {
      operationId,
      packageName: row.packageName,
      action: "commit-rollback-route",
      ready,
      status: ready ? "ready" : "blocked",
      route: {
        id: requestContext.routeId,
        href: `${requestContext.returnTo}?package=${encodeURIComponent(row.packageName)}&request=${encodeURIComponent(requestContext.requestId)}`,
        params: {
          packageName: row.packageName,
          requestId: requestContext.requestId,
          traceId: requestContext.correlation.traceId
        }
      },
      requiredCommandIds: packageCommands.map((command) => command.id),
      proof: {
        generatedAt,
        sourceProofHash: row.proofHash,
        commitProofHash: buildProofDigest(proofPayload)
      },
      blockingReasons: [
        ...row.blockingReasons,
        ...access.denials,
        ...(packageCommands.length ? [] : ["no executable request-rollback command is queued for this package"])
      ]
    };
  });
}

function buildRouteCommitPlan(previewRows, commandIdempotency, validationSummary, lifecycleState, reportState, requestContext, workspaceBoundary, operationalHealth, generatedAt) {
  const operations = buildRouteCommitOperations(
    previewRows,
    commandIdempotency,
    requestContext,
    workspaceBoundary,
    generatedAt
  );
  const readyOperations = operations.filter((operation) => operation.ready);
  const blockedOperations = operations.filter((operation) => !operation.ready);
  const planReady = validationSummary.ok
    && lifecycleState.effectiveEnabled
    && reportState.readyForExport
    && !operationalHealth.blocking
    && operations.length > 0
    && blockedOperations.length === 0;
  const commitId = `rollback-commit:${requestContext.requestId}:${readyOperations.length}`;
  const blockingReasons = [
    ...validationSummary.gates
      .filter((gate) => !gate.ok && gate.severity === "error")
      .flatMap((gate) => gate.details.length ? gate.details : [gate.label]),
    ...blockedOperations.flatMap((operation) => operation.blockingReasons.map((reason) => `${operation.packageName}: ${reason}`)),
    ...(!lifecycleState.effectiveEnabled ? ["rollback lifecycle controls are disabled"] : []),
    ...(!reportState.readyForExport ? ["rollback terminal evidence is not ready for export"] : []),
    ...(operationalHealth.blocking ? operationalHealth.problems : [])
  ];

  return {
    contract: "hosted-kernel rollback route commit plan/v1",
    commitId,
    generatedAt,
    mode: planReady ? "commit" : "preview",
    ready: planReady,
    operationCount: operations.length,
    readyOperationCount: readyOperations.length,
    blockedOperationCount: blockedOperations.length,
    packageScope: {
      requested: requestContext.packageName,
      tenantId: workspaceBoundary.tenantId,
      workspaceId: workspaceBoundary.workspaceId,
      allowedPackages: workspaceBoundary.allowedPackages
    },
    operations,
    blockingReasons: [...new Set(blockingReasons)],
    audit: {
      executableCommandIds: commandIdempotency.executable.map((command) => command.id),
      skippedCommandCount: commandIdempotency.skippedCount,
      validationBlockingGateIds: validationSummary.blockingGateIds,
      proofHash: buildProofDigest({
        commitId,
        generatedAt,
        ready: planReady,
        operationIds: operations.map((operation) => operation.operationId),
        blockingReasons,
        operationalHealth: {
          status: operationalHealth.status,
          failureState: operationalHealth.failureState,
          degradedModeEnabled: operationalHealth.degradedMode.enabled
        }
      })
    }
  };
}

function buildProviderDispatchManifest(providerNegotiation, lifecycleControlPlan, routeCommitPlan, recoveryState, requestContext, workspaceBoundary, operationalHealth, generatedAt) {
  const selectedProvider = providerNegotiation.candidates
    .find((candidate) => candidate.providerId === providerNegotiation.selectedProviderId) || null;
  const handoff = selectedProvider?.externalHandoff || null;
  const lease = handoff?.lease || { status: "none", expiresAt: null, expired: false };
  const readyOperations = routeCommitPlan.operations.filter((operation) => operation.ready);
  const blockedOperations = routeCommitPlan.operations.filter((operation) => !operation.ready);
  const queuedJournalEntries = recoveryState.checkpointProposal.writeSet.commandJournal
    .filter((entry) => entry.status === "queued" || entry.status === "in-flight");
  const dispatchableCommands = queuedJournalEntries
    .filter((entry) => entry.action === "request-rollback")
    .map((entry) => ({
      commandId: entry.commandId,
      action: entry.action,
      packageName: entry.packageName,
      status: entry.status,
      attempt: entry.attempt,
      restartToken: entry.restartToken
    }));
  const providerUnavailable = !selectedProvider || !providerNegotiation.ready;
  const externalUnavailable = Boolean(selectedProvider && !handoff?.enabled);
  const leaseBlocked = Boolean(handoff?.enabled && (lease.status === "revoked" || lease.expired));
  const blockingReasons = [
    ...(!selectedProvider ? ["no negotiated rollback provider is selected"] : []),
    ...(selectedProvider && !selectedProvider.ready ? selectedProvider.denials : []),
    ...(externalUnavailable ? ["selected provider does not expose external handoff"] : []),
    ...(lease.status === "revoked" ? ["provider handoff lease was revoked"] : []),
    ...(lease.expired ? ["provider handoff lease has expired"] : []),
    ...(operationalHealth.blocking ? operationalHealth.problems : []),
    ...blockedOperations.flatMap((operation) => operation.blockingReasons.map((reason) => `${operation.packageName}: ${reason}`))
  ];
  const status = providerUnavailable
    ? "provider-unavailable"
    : operationalHealth.blocking || leaseBlocked
      ? "blocked"
      : externalUnavailable
        ? "local-provider-only"
        : routeCommitPlan.ready
          ? "ready-for-external-handoff"
          : dispatchableCommands.length
            ? "awaiting-route-commit"
            : "idle";
  const syncWatermark = {
    cursor: selectedProvider?.sync.cursor || recoveryState.checkpointProposal.compareAndSwap.idempotencyKey,
    watermarkEventId: selectedProvider?.sync.watermarkEventId || recoveryState.packages.at(-1)?.lastEventId || "",
    checkpointRevision: recoveryState.nextRevision,
    compareAndSwap: recoveryState.checkpointProposal.compareAndSwap,
    providerSyncStatus: selectedProvider?.sync.status || "unknown",
    providerLagMs: selectedProvider?.sync.lagMs ?? null
  };
  const routeOperations = readyOperations.map((operation) => ({
    operationId: operation.operationId,
    packageName: operation.packageName,
    href: operation.route.href,
    commitProofHash: operation.proof.commitProofHash,
    requiredCommandIds: operation.requiredCommandIds
  }));
  const handoffEnvelope = selectedProvider && handoff?.enabled
    ? {
        method: handoff.method,
        endpoint: handoff.endpoint,
        stateToken: handoff.stateToken || null,
        correlationId: handoff.correlationId || requestContext.correlation.traceId,
        lease,
        payload: {
          requestId: requestContext.requestId,
          routeId: requestContext.routeId,
          tenantId: workspaceBoundary.tenantId,
          workspaceId: workspaceBoundary.workspaceId,
          providerId: selectedProvider.providerId,
          requiredCapabilities: providerNegotiation.requiredCapabilities,
          syncWatermark,
          routeOperations,
          dispatchableCommands
        }
      }
    : null;

  return {
    contract: "hosted-kernel rollback provider dispatch manifest/v1",
    generatedAt,
    status,
    ready: status === "ready-for-external-handoff",
    provider: selectedProvider
      ? {
          providerId: selectedProvider.providerId,
          service: selectedProvider.service,
          endpoint: selectedProvider.endpoint,
          capabilities: selectedProvider.capabilities,
          missingCapabilities: selectedProvider.missingCapabilities,
          sync: selectedProvider.sync,
          externalHandoffEnabled: Boolean(handoff?.enabled)
        }
      : null,
    capabilityNegotiation: {
      requiredCapabilities: providerNegotiation.requiredCapabilities,
      selectedProviderId: providerNegotiation.selectedProviderId,
      readyCandidateCount: providerNegotiation.audit.readyCandidateCount,
      candidateCount: providerNegotiation.audit.candidateCount
    },
    syncWatermark,
    dispatch: {
      commandCount: dispatchableCommands.length,
      routeOperationCount: routeOperations.length,
      blockedOperationCount: blockedOperations.length,
      executableActions: lifecycleControlPlan.dispatch.executableActions,
      resumableActions: lifecycleControlPlan.dispatch.resumableActions,
      nextControlActionType: lifecycleControlPlan.nextControlAction?.type || null,
      commands: dispatchableCommands,
      routeOperations
    },
    externalHandoff: handoffEnvelope,
    blockingReasons: [...new Set(blockingReasons)],
    audit: {
      proofHash: buildProofDigest({
        requestId: requestContext.requestId,
        status,
        providerId: selectedProvider?.providerId || null,
        syncWatermark,
        commandIds: dispatchableCommands.map((command) => command.commandId),
        operationIds: routeOperations.map((operation) => operation.operationId),
        blockingReasons
      })
    }
  };
}

function buildUserVisiblePreviewContract(previewRows, validationSummary, clientNextSteps, routeCommitPlan, requestContext, providerNegotiation, operationalHealth, reportState, generatedAt) {
  const selectedProvider = providerNegotiation.candidates
    .find((candidate) => candidate.providerId === providerNegotiation.selectedProviderId) || null;
  const blockingSteps = clientNextSteps.filter((step) => step.blocking);
  const actionableSteps = clientNextSteps.filter((step) => !step.blocking);
  const acceptedRows = previewRows.filter((row) => row.accepted);
  const blockedRows = previewRows.filter((row) => row.blockingReasons.length > 0);
  const awaitingAcceptanceRows = previewRows.filter((row) => row.readiness === "awaiting-acceptance");
  const severity = blockingSteps.length || operationalHealth.blocking
    ? "error"
    : validationSummary.warningGateIds.length || operationalHealth.degraded
      ? "warning"
      : "ready";
  const headline = severity === "error"
    ? "Rollback preview is blocked"
    : awaitingAcceptanceRows.length
      ? "Rollback preview needs acceptance"
      : routeCommitPlan.ready
        ? "Rollback preview is ready to commit"
        : "Rollback preview is available";
  const primaryStep = blockingSteps[0] || actionableSteps[0] || {
    type: routeCommitPlan.ready ? "ready-to-export" : "accept-preview",
    label: routeCommitPlan.ready ? "Commit accepted rollback route" : "Review rollback preview",
    blocking: false,
    details: []
  };
  const routeOperationsByPackage = new Map(
    routeCommitPlan.operations.map((operation) => [operation.packageName, operation])
  );
  const packageCards = previewRows.map((row) => {
    const operation = routeOperationsByPackage.get(row.packageName) || null;
    const canAccept = row.readiness === "awaiting-acceptance"
      && validationSummary.readyForOperatorAcceptance
      && !operationalHealth.blocking;
    const statusTone = row.accepted
      ? "success"
      : row.readiness === "blocked-by-operator" || row.readiness === "needs-proof"
        ? "danger"
        : row.readiness === "waiting-for-terminal-event"
          ? "muted"
          : "attention";

    return {
      packageName: row.packageName,
      title: row.title,
      subtitle: `${row.eventCount} rollback event${row.eventCount === 1 ? "" : "s"} observed`,
      status: row.status,
      tone: statusTone,
      readiness: row.readiness,
      acceptanceDecision: row.acceptanceDecision,
      accepted: row.accepted,
      canAccept,
      proofHash: row.proofHash,
      lastEventAt: row.lastEventAt,
      artifactCount: row.artifactCount,
      blockingReasons: row.blockingReasons,
      action: {
        type: canAccept ? "accept-preview" : operation?.ready ? "commit-rollback-route" : primaryStep.type,
        label: canAccept
          ? `Accept preview for ${row.packageName}`
          : operation?.ready
            ? `Commit rollback route for ${row.packageName}`
            : primaryStep.label,
        enabled: canAccept || Boolean(operation?.ready),
        routeHref: operation?.route.href || requestContext.returnTo,
        payload: {
          requestId: requestContext.requestId,
          packageName: row.packageName,
          traceId: requestContext.correlation.traceId,
          operationId: operation?.operationId || null,
          sourceProofHash: row.proofHash
        }
      }
    };
  });

  return {
    contract: "hosted-kernel rollback user-visible preview/v1",
    generatedAt,
    requestId: requestContext.requestId,
    clientView: requestContext.clientView,
    headline,
    severity,
    summary: {
      packageCount: previewRows.length,
      acceptedPackageCount: acceptedRows.length,
      blockedPackageCount: blockedRows.length,
      awaitingAcceptanceCount: awaitingAcceptanceRows.length,
      routeReadyPackageCount: routeCommitPlan.readyOperationCount,
      terminalEvidenceReady: reportState.readyForExport,
      proofRequired: reportState.requiresProof,
      validationOk: validationSummary.ok,
      readyForOperatorAcceptance: validationSummary.readyForOperatorAcceptance,
      operationalHealthStatus: operationalHealth.status,
      providerReady: providerNegotiation.ready
    },
    primaryAction: {
      type: primaryStep.type,
      label: primaryStep.label,
      enabled: blockingSteps.length === 0 && !operationalHealth.blocking,
      blocking: primaryStep.blocking,
      details: primaryStep.details || [],
      routeHref: requestContext.returnTo,
      payload: {
        requestId: requestContext.requestId,
        packageName: requestContext.packageName,
        traceId: requestContext.correlation.traceId,
        commitId: routeCommitPlan.commitId,
        selectedProviderId: selectedProvider?.providerId || null
      }
    },
    provider: selectedProvider
      ? {
          providerId: selectedProvider.providerId,
          service: selectedProvider.service,
          syncStatus: selectedProvider.sync.status,
          endpoint: selectedProvider.endpoint,
          externalHandoffEnabled: selectedProvider.externalHandoff.enabled
        }
      : null,
    validation: {
      blockingGateIds: validationSummary.blockingGateIds,
      warningGateIds: validationSummary.warningGateIds,
      nextSteps: clientNextSteps
    },
    packageCards,
    audit: {
      proofHash: buildProofDigest({
        requestId: requestContext.requestId,
        severity,
        packageCards: packageCards.map((card) => ({
          packageName: card.packageName,
          readiness: card.readiness,
          accepted: card.accepted,
          actionType: card.action.type,
          enabled: card.action.enabled
        })),
        validationBlockingGateIds: validationSummary.blockingGateIds,
        providerReady: providerNegotiation.ready,
        routeCommitReady: routeCommitPlan.ready
      })
    }
  };
}

function buildPreviewAcceptanceReviewContract(previewRows, validationSummary, clientNextSteps, routeCommitPlan, requestContext, workspaceBoundary, operationalHealth, generatedAt) {
  const operationsByPackage = new Map(routeCommitPlan.operations.map((operation) => [operation.packageName, operation]));
  const blockingSteps = clientNextSteps.filter((step) => step.blocking);
  const canSubmitAcceptance = validationSummary.readyForOperatorAcceptance
    && !operationalHealth.blocking
    && blockingSteps.length === 0;
  const reviewRows = previewRows.map((row) => {
    const operation = operationsByPackage.get(row.packageName) || null;
    const access = evaluateWorkspaceAccess(workspaceBoundary, "accept-preview", row.packageName);
    const acceptEnabled = canSubmitAcceptance
      && access.allowed
      && row.readiness === "awaiting-acceptance";
    const commitEnabled = Boolean(operation?.ready);
    const requiredFields = [
      "decision",
      "packageName",
      ...(row.readiness === "blocked-by-operator" || row.acceptanceDecision === "rejected" ? ["reason"] : [])
    ];
    const denials = [
      ...row.blockingReasons.filter((reason) => reason !== "operator preview acceptance is required"),
      ...access.denials,
      ...(!validationSummary.readyForOperatorAcceptance ? ["validation gates must pass before accepting preview"] : []),
      ...(operationalHealth.blocking ? ["operational health is blocking preview acceptance"] : [])
    ];

    return {
      packageName: row.packageName,
      status: row.status,
      readiness: row.readiness,
      acceptanceDecision: row.acceptanceDecision,
      lastEventAt: row.lastEventAt,
      proofHash: row.proofHash,
      requiredFields,
      denials: [...new Set(denials)],
      accept: {
        enabled: acceptEnabled,
        method: "POST",
        href: requestContext.returnTo,
        payload: {
          requestId: requestContext.requestId,
          action: "accept-preview",
          packageName: row.packageName,
          decision: "accepted",
          evidenceHash: row.proofHash,
          traceId: requestContext.correlation.traceId
        }
      },
      reject: {
        enabled: access.allowed && !operationalHealth.blocking,
        method: "POST",
        href: requestContext.returnTo,
        payload: {
          requestId: requestContext.requestId,
          action: "accept-preview",
          packageName: row.packageName,
          decision: "rejected",
          reasonRequired: true,
          evidenceHash: row.proofHash,
          traceId: requestContext.correlation.traceId
        }
      },
      commit: {
        enabled: commitEnabled,
        method: "POST",
        href: operation?.route.href || requestContext.returnTo,
        payload: {
          requestId: requestContext.requestId,
          action: "commit-rollback-route",
          operationId: operation?.operationId || null,
          packageName: row.packageName,
          commitProofHash: operation?.proof.commitProofHash || null,
          traceId: requestContext.correlation.traceId
        }
      }
    };
  });
  const readyToAccept = reviewRows.filter((row) => row.accept.enabled);
  const readyToCommit = reviewRows.filter((row) => row.commit.enabled);
  const blocked = reviewRows.filter((row) => !row.accept.enabled && !row.commit.enabled);
  const primaryRouteIntent = readyToCommit[0]
    ? {
        type: "commit-rollback-route",
        packageName: readyToCommit[0].packageName,
        href: readyToCommit[0].commit.href,
        payload: readyToCommit[0].commit.payload
      }
    : readyToAccept[0]
      ? {
          type: "accept-preview",
          packageName: readyToAccept[0].packageName,
          href: readyToAccept[0].accept.href,
          payload: readyToAccept[0].accept.payload
        }
      : {
          type: clientNextSteps[0]?.type || "fix-settings",
          packageName: requestContext.packageName,
          href: requestContext.returnTo,
          payload: {
            requestId: requestContext.requestId,
            packageName: requestContext.packageName,
            traceId: requestContext.correlation.traceId
          }
        };

  return {
    contract: "hosted-kernel rollback preview acceptance review/v1",
    generatedAt,
    requestId: requestContext.requestId,
    routeId: requestContext.routeId,
    tenantBoundary: {
      tenantId: workspaceBoundary.tenantId,
      workspaceId: workspaceBoundary.workspaceId,
      principalId: workspaceBoundary.principalId,
      role: workspaceBoundary.role
    },
    summary: {
      packageCount: reviewRows.length,
      readyToAcceptCount: readyToAccept.length,
      readyToCommitCount: readyToCommit.length,
      blockedCount: blocked.length,
      canSubmitAcceptance,
      validationOk: validationSummary.ok,
      operationalHealthStatus: operationalHealth.status
    },
    primaryRouteIntent,
    rows: reviewRows,
    audit: {
      proofHash: buildProofDigest({
        requestId: requestContext.requestId,
        canSubmitAcceptance,
        routeCommitReady: routeCommitPlan.ready,
        rows: reviewRows.map((row) => ({
          packageName: row.packageName,
          readiness: row.readiness,
          acceptEnabled: row.accept.enabled,
          commitEnabled: row.commit.enabled,
          denials: row.denials
        })),
        blockingGateIds: validationSummary.blockingGateIds,
        operationalHealthStatus: operationalHealth.status
      })
    }
  };
}

function buildClientWorkflowHandoff(requestContext, validationSummary, previewRows, lifecycleState, nextAction, exportSummary, reportState, workspaceBoundary, providerNegotiation, operationalHealth) {
  const matchingRows = requestContext.packageName === "all-packages"
    ? previewRows
    : previewRows.filter((row) => row.packageName === requestContext.packageName);
  const acceptanceCandidate = matchingRows.find((row) => row.readiness === "awaiting-acceptance");
  const selectedProvider = providerNegotiation.candidates
    .find((candidate) => candidate.providerId === providerNegotiation.selectedProviderId) || null;
  const resolvedAction = requestContext.requestedAction
    || (acceptanceCandidate
      ? "accept-preview"
      : nextAction.type);
  const targetPackage = acceptanceCandidate?.packageName || requestContext.packageName;
  const runtime = requestContext.clientRuntime;
  const runtimePendingMatches = Boolean(
    runtime.pending.optimisticInFlight
      && runtime.pending.action === resolvedAction
      && (runtime.pending.packageName === targetPackage || runtime.pending.packageName === "all-packages")
  );
  const runtimeBlocksSubmission = runtime.stale || runtimePendingMatches;
  const runtimeHandoffMode = runtime.stale
    ? "refresh-client-state"
    : runtimePendingMatches
      ? "dedupe-pending-submission"
      : runtime.dirtyFields.length
        ? "preserve-client-draft"
        : "submit";
  const routeParams = {
    packageName: targetPackage,
    requestId: requestContext.requestId,
    traceId: requestContext.correlation.traceId
  };
  const blockingReasons = [
    ...validationSummary.gates
      .filter((gate) => !gate.ok && gate.severity === "error")
      .flatMap((gate) => gate.details.length ? gate.details : [gate.label]),
    ...(acceptanceCandidate?.blockingReasons || []),
    ...(runtime.stale ? ["client rollback state is stale; refresh before submitting handoff"] : []),
    ...(runtimePendingMatches ? [`${resolvedAction} is already pending for ${targetPackage}`] : [])
  ];
  const proofPayload = {
    requestId: requestContext.requestId,
    routeId: requestContext.routeId,
    tenantId: workspaceBoundary.tenantId,
    workspaceId: workspaceBoundary.workspaceId,
    principalId: workspaceBoundary.principalId,
    action: resolvedAction,
    packageName: targetPackage,
    readyForExport: reportState.readyForExport,
    validationOk: validationSummary.ok,
    exportEventCount: exportSummary.eventCount,
    artifactCount: exportSummary.exportedArtifacts.length,
    lastEventAt: reportState.lastEventAt,
    providerId: selectedProvider?.providerId || null,
    providerReady: providerNegotiation.ready,
    providerSyncStatus: selectedProvider?.sync.status || null,
    operationalHealthStatus: operationalHealth.status,
    failureState: operationalHealth.failureState,
    retryAttempt: operationalHealth.retry.attempt,
    retryNextAt: operationalHealth.retry.nextRetryAt,
    clientRuntimeStatus: runtime.status,
    clientRuntimeStale: runtime.stale,
    runtimeHandoffMode,
    pendingAction: runtime.pending.action,
    pendingIdempotencyKey: runtime.pending.idempotencyKey || null
  };

  return {
    contract: "hosted-kernel rollback workflow handoff/v1",
    requestId: requestContext.requestId,
    clientView: requestContext.clientView,
    action: resolvedAction,
    label: acceptanceCandidate
      ? `Accept rollback preview for ${acceptanceCandidate.packageName}`
      : nextAction.label,
    route: {
      id: requestContext.routeId,
      href: requestContext.returnTo,
      params: routeParams
    },
    packageScope: {
      requested: requestContext.packageName,
      matchedCount: matchingRows.length,
      targetPackage,
      allowedPackages: workspaceBoundary.allowedPackages,
      inScope: packageInScope(targetPackage, workspaceBoundary.allowedPackages)
    },
    tenantBoundary: {
      tenantId: workspaceBoundary.tenantId,
      workspaceId: workspaceBoundary.workspaceId,
      principalId: workspaceBoundary.principalId,
      role: workspaceBoundary.role,
      allowedPackages: workspaceBoundary.allowedPackages
    },
    enabled: lifecycleState.effectiveEnabled && !runtimeBlocksSubmission,
    blocking: blockingReasons.length > 0 || nextAction.blocking || runtimeBlocksSubmission,
    blockingReasons,
    clientRuntime: {
      contract: runtime.contract,
      status: runtime.status,
      stale: runtime.stale,
      currentRoute: runtime.currentRoute,
      dirtyFields: runtime.dirtyFields,
      handoffMode: runtimeHandoffMode,
      pending: runtime.pending,
      draft: runtime.draft,
      warnings: runtime.warnings
    },
    payload: {
      ...routeParams,
      action: resolvedAction,
      handoffMode: runtimeHandoffMode,
      clientRuntimeStatus: runtime.status,
      clientRuntimeStale: runtime.stale,
      pendingIdempotencyKey: runtime.pending.idempotencyKey || null,
      exportFormat: exportSummary.format,
      proofRequiredForExport: reportState.requiresProof,
      operationalHealth: {
        status: operationalHealth.status,
        failureState: operationalHealth.failureState,
        degradedModeEnabled: operationalHealth.degradedMode.enabled,
        nextRetryAt: operationalHealth.retry.nextRetryAt,
        actionableErrorCount: operationalHealth.actionableErrors.length
      },
      provider: selectedProvider
        ? {
            providerId: selectedProvider.providerId,
            service: selectedProvider.service,
            endpoint: selectedProvider.endpoint,
            requiredCapabilities: providerNegotiation.requiredCapabilities,
            syncCursor: selectedProvider.sync.cursor || null,
            syncStatus: selectedProvider.sync.status,
            externalHandoff: selectedProvider.externalHandoff.enabled
              ? {
                  endpoint: selectedProvider.externalHandoff.endpoint,
                  method: selectedProvider.externalHandoff.method,
                  stateToken: selectedProvider.externalHandoff.stateToken || null
                }
              : null
          }
        : null
    },
    audit: {
      proofHash: buildProofDigest(proofPayload),
      proofPayload,
      warnings: [
        ...requestContext.warnings,
        ...workspaceBoundary.warnings,
        ...providerNegotiation.candidates.flatMap((candidate) => candidate.warnings),
        ...operationalHealth.warnings
      ]
    }
  };
}

export function describeRollbackScriptSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const requestContext = normalizeRequestContext(input, now);
  const workspaceBoundary = normalizeWorkspaceBoundary(input, requestContext, now);
  const events = toArray(input.events).map((event, index) => normalizeEvent(event, index, now));
  const eventIsolation = partitionEventsByWorkspace(events, workspaceBoundary);
  const scopedEvents = eventIsolation.visibleEvents;
  const settings = normalizeLifecycleSettings(input.lifecycleSettings || input.settings, now);
  const lifecycleCommands = toArray(input.lifecycleCommands || input.commands)
    .map((command, index) => normalizeLifecycleCommand(command, index, now, workspaceBoundary, settings));
  const persistedState = normalizePersistedState(
    input.persistedState || input.checkpoint || input.recoveryState,
    requestContext,
    now
  );
  const commandIdempotency = buildIdempotentLifecycleCommands(lifecycleCommands, persistedState);
  const previewAcceptances = toArray(input.previewAcceptances || input.previewAcceptance || input.acceptances)
    .map((acceptance, index) => normalizePreviewAcceptance(acceptance, index, now, workspaceBoundary));
  const historyLimit = Number.isInteger(input.historyLimit) && input.historyLimit > 0
    ? Math.min(input.historyLimit, 50)
    : 12;
  const historySnapshots = buildHistorySnapshots(scopedEvents, historyLimit);
  const timeline = buildTimeline(scopedEvents);
  const counters = buildAnalyticsCounters(scopedEvents, historySnapshots, eventIsolation);
  const analyticsReportOptions = normalizeAnalyticsReportOptions(input);
  const analyticsReport = buildAnalyticsReportState(
    scopedEvents,
    historySnapshots,
    counters,
    timeline,
    eventIsolation,
    requestContext,
    analyticsReportOptions,
    now
  );
  const reportState = {
    readyForExport: scopedEvents.length > 0 && counters.terminalEvents > 0,
    requiresProof: counters.proofMissingTerminalEvents > 0,
    lastEventAt: timeline.at(-1)?.at || now,
    coverage: {
      terminalPackages: counters.terminalPackages,
      exportReadyPackages: counters.exportReadyPackages,
      exportCoverageRatio: counters.exportCoverageRatio,
      packagesMissingProof: counters.packagesMissingProof
    },
    timeline,
    timelineState: {
      contract: "hosted-kernel rollback timeline state/v1",
      empty: timeline.length === 0,
      firstEventAt: timeline[0]?.at || null,
      lastEventAt: timeline.at(-1)?.at || null,
      terminalEventCount: counters.terminalEvents,
      exportEventCount: counters.exportedArtifacts,
      phases: counters.byPhase,
      latestTerminalEventAt: counters.latestTerminalEventAt
    },
    reporting: {
      contract: analyticsReport.contract,
      granularity: analyticsReport.options.granularity,
      bucketCount: analyticsReport.timelineBuckets.length,
      exceptionCount: analyticsReport.packageExceptions.length,
      exportManifest: analyticsReport.exportManifest,
      reportingWindow: analyticsReport.reportingWindow,
      proofHash: analyticsReport.audit.proofHash
    }
  };
  const lifecycleState = buildLifecycleCommandState(commandIdempotency.executable, settings, workspaceBoundary);
  const lifecycleControlPlan = buildLifecycleControlPlan(
    lifecycleState,
    settings,
    workspaceBoundary,
    requestContext,
    commandIdempotency,
    now
  );
  const providerContract = normalizeProviderContract(input, requestContext, now);
  const providerNegotiation = negotiateProviderContract(providerContract, reportState, lifecycleState);
  const recoveryState = buildPersistentRecoveryState(
    persistedState,
    historySnapshots,
    lifecycleCommands,
    commandIdempotency,
    now
  );
  const operationalHealth = buildOperationalHealth(
    input,
    reportState,
    lifecycleState,
    providerNegotiation,
    recoveryState,
    now
  );
  const nextAction = buildNextAction(reportState, lifecycleState, settings, workspaceBoundary, requestContext, operationalHealth);
  const previewAcceptance = buildPreviewAcceptanceState(previewAcceptances, historySnapshots);
  const previewRows = buildPreviewPackageRows(historySnapshots, previewAcceptance, settings);
  const validationSummary = buildValidationSummary(
    settings,
    lifecycleState,
    reportState,
    previewAcceptance,
    previewRows,
    workspaceBoundary,
    requestContext,
    providerNegotiation,
    operationalHealth
  );
  const routeCommitPlan = buildRouteCommitPlan(
    previewRows,
    commandIdempotency,
    validationSummary,
    lifecycleState,
    reportState,
    requestContext,
    workspaceBoundary,
    operationalHealth,
    now
  );
  const providerDispatchManifest = buildProviderDispatchManifest(
    providerNegotiation,
    lifecycleControlPlan,
    routeCommitPlan,
    recoveryState,
    requestContext,
    workspaceBoundary,
    operationalHealth,
    now
  );
  const clientNextSteps = buildClientNextSteps(validationSummary, previewRows, nextAction);
  const userVisiblePreview = buildUserVisiblePreviewContract(
    previewRows,
    validationSummary,
    clientNextSteps,
    routeCommitPlan,
    requestContext,
    providerNegotiation,
    operationalHealth,
    reportState,
    now
  );
  const acceptanceReview = buildPreviewAcceptanceReviewContract(
    previewRows,
    validationSummary,
    clientNextSteps,
    routeCommitPlan,
    requestContext,
    workspaceBoundary,
    operationalHealth,
    now
  );
  const exportSummary = buildExportSummary(scopedEvents, historySnapshots, counters, timeline, now);
  const workflowHandoff = buildClientWorkflowHandoff(
    requestContext,
    validationSummary,
    previewRows,
    lifecycleState,
    nextAction,
    exportSummary,
    reportState,
    workspaceBoundary,
    providerNegotiation,
    operationalHealth
  );

  return {
    ok: true,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: "hosted-kernel rollback analytics contract/v1",
    requestContext,
    workspaceBoundary,
    eventIsolation: {
      contract: eventIsolation.contract,
      visibleEventCount: eventIsolation.visibleEventCount,
      withheldEventCount: eventIsolation.withheldEventCount,
      withheldEvents: eventIsolation.withheldEvents,
      proofHash: eventIsolation.proofHash
    },
    counters,
    historySnapshots,
    analyticsReport,
    exportSummary,
    reportState,
    lifecycleSettings: settings,
    lifecycleState: {
      ...lifecycleState,
      controlPlan: lifecycleControlPlan,
      idempotency: recoveryState.idempotency
    },
    providerContract: providerNegotiation,
    providerDispatchManifest,
    operationalHealth,
    persistedState: recoveryState,
    preview: {
      contract: "hosted-kernel rollback preview contract/v1",
      generatedAt: now,
      packageRows: previewRows,
      acceptance: previewAcceptance,
      acceptanceReview,
      userVisible: userVisiblePreview,
      readyForRouteCommit: routeCommitPlan.ready
    },
    routeCommitPlan,
    validationSummary,
    clientNextSteps,
    workflowHandoff,
    nextAction,
    evidence: toArray(input.evidence)
  };
}

export default describeRollbackScriptSurface;
