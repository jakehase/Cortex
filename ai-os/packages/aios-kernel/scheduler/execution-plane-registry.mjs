export const surfaceId = "aios_scheduler_execution-plane-registry_053";
export const surfaceGroup = "scheduler";
export const surfaceName = "execution-plane-registry";

const KNOWN_PLANE_STATES = new Set(["ready", "draining", "degraded", "offline"]);
const EXPORT_SCHEMA_VERSION = "execution-plane-registry.analytics.v1";
const KNOWN_SCHEDULING_MODES = new Set(["automatic", "paused", "drain-only", "maintenance"]);
const KNOWN_HANDOFF_STATES = new Set(["none", "prepared", "in-flight", "completed", "failed"]);
const KNOWN_RECOVERY_MODES = new Set(["cold-start", "warm-restart", "snapshot-restore", "leader-failover"]);
const KNOWN_HANDOFF_POLICIES = new Set(["auto", "strict-hetzner", "allow-generic-fallback", "confirm-fallback"]);
const KNOWN_REQUEST_INTENTS = new Set([
  "dispatch-continuation",
  "remediate-registry",
  "preview-registry",
  "external-handoff"
]);
const KNOWN_EXECUTION_PLANE_KINDS = new Set([
  "local-control-plane",
  "hetzner-worker-plane",
  "generic-worker-plane"
]);
const PROVIDER_SERVICE_PROFILES = Object.freeze({
  "local-control-plane": Object.freeze({
    preferredServices: Object.freeze(["registry-control", "control-plane-registry", "continuation-dispatch"]),
    requiredCapabilities: Object.freeze(["registry-control"]),
    capabilityAliases: Object.freeze({
      "registry-control": Object.freeze(["registry-control", "control-plane", "local-control-plane"])
    })
  }),
  "hetzner-worker-plane": Object.freeze({
    preferredServices: Object.freeze(["continuation-dispatch", "worker-dispatch", "external-handoff"]),
    requiredCapabilities: Object.freeze(["hetzner-worker"]),
    capabilityAliases: Object.freeze({
      "hetzner-worker": Object.freeze(["hetzner-worker", "worker-plane:hetzner", "external-handoff"])
    })
  }),
  "generic-worker-plane": Object.freeze({
    preferredServices: Object.freeze(["continuation-dispatch", "worker-dispatch"]),
    requiredCapabilities: Object.freeze([]),
    capabilityAliases: Object.freeze({})
  })
});
const CONTROL_PLANE_REQUEST_INTENTS = new Set([
  "preview-registry",
  "remediate-registry",
  "external-handoff"
]);
const KNOWN_LIFECYCLE_COMMANDS = new Set([
  "enable",
  "disable",
  "drain",
  "resume",
  "pause-scheduling",
  "resume-scheduling"
]);
const DEFAULT_TENANT_ID = "default-tenant";
const DEFAULT_WORKSPACE_ID = "default-workspace";
const ACCESS_PERMISSION_GRANTS = Object.freeze({
  "registry-admin": [
    "execution-plane:read",
    "execution-plane:dispatch",
    "execution-plane:command",
    "execution-plane:audit",
    "execution-plane:cross-workspace"
  ],
  "scheduler-operator": [
    "execution-plane:read",
    "execution-plane:dispatch",
    "execution-plane:command",
    "execution-plane:audit"
  ],
  "continuation-dispatcher": [
    "execution-plane:read",
    "execution-plane:dispatch"
  ],
  "workspace-viewer": [
    "execution-plane:read"
  ]
});
const LIFECYCLE_COMMAND_PERMISSIONS = Object.freeze({
  enable: "execution-plane:command",
  disable: "execution-plane:command",
  drain: "execution-plane:command",
  resume: "execution-plane:command",
  "pause-scheduling": "execution-plane:command",
  "resume-scheduling": "execution-plane:command"
});
const SELECTION_MODE_PERMISSIONS = Object.freeze({
  "registry-control": "execution-plane:read",
  "worker-dispatch": "execution-plane:dispatch"
});

function readNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function readRatio(value, fallback) {
  const numeric = readNumber(value, fallback);
  return Math.min(1, Math.max(0, numeric));
}

function readState(value) {
  const state = typeof value === "string" ? value.trim().toLowerCase() : "";
  return KNOWN_PLANE_STATES.has(state) ? state : "degraded";
}

function readBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "enabled"].includes(normalized)) return true;
    if (["false", "0", "no", "disabled"].includes(normalized)) return false;
  }
  return fallback;
}

function readText(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readSchedulingMode(value, fallback = "automatic") {
  const mode = typeof value === "string" ? value.trim().toLowerCase() : "";
  return KNOWN_SCHEDULING_MODES.has(mode) ? mode : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeIdList(value, fallback) {
  const values = (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value])
    .map((item) => readText(item, ""))
    .filter(Boolean);
  return values.length > 0 ? [...new Set(values)].sort() : fallback;
}

function normalizeRoleList(value) {
  return normalizeIdList(value, ["workspace-viewer"])
    .map((role) => role.toLowerCase());
}

function rolePermissionSet(roles, explicitPermissions = []) {
  const permissions = new Set(explicitPermissions);
  for (const role of roles) {
    for (const permission of ACCESS_PERMISSION_GRANTS[role] || []) {
      permissions.add(permission);
    }
  }
  return [...permissions].sort();
}

function hasScopedValue(scopeValues, value) {
  return scopeValues.includes("*") || scopeValues.includes(value);
}

function hasPermission(accessContext, permission) {
  return accessContext.permissions.includes(permission) || accessContext.permissions.includes("*");
}

function normalizeCapabilityList(value) {
  return [...new Set(asArray(value)
    .map((capability) => readText(capability, ""))
    .filter(Boolean)
    .map((capability) => capability.toLowerCase()))].sort();
}

function normalizeServiceName(value, fallback = "continuation-dispatch") {
  return readText(value, fallback).toLowerCase();
}

function normalizeExecutionPlaneKind(value, providerId, capabilities, region) {
  const explicit = readText(value, "").toLowerCase();
  if (["local", "local-control", "control", "control-plane"].includes(explicit)) return "local-control-plane";
  if (["hetzner", "hetzner-worker", "worker-hetzner"].includes(explicit)) return "hetzner-worker-plane";
  if (KNOWN_EXECUTION_PLANE_KINDS.has(explicit)) return explicit;

  const provider = readText(providerId, "").toLowerCase();
  const location = readText(region, "").toLowerCase();
  const capabilitySet = new Set(capabilities);

  if (
    provider.includes("hetzner")
    || capabilitySet.has("hetzner-worker")
    || capabilitySet.has("worker-plane:hetzner")
    || /^(fsn|nbg|hel)\d?/.test(location)
  ) {
    return "hetzner-worker-plane";
  }
  if (
    provider.includes("local-control")
    || provider === "local"
    || provider === "control-plane"
    || capabilitySet.has("local-control-plane")
    || capabilitySet.has("registry-control")
    || capabilitySet.has("control-plane")
  ) {
    return "local-control-plane";
  }
  return "generic-worker-plane";
}

function normalizeRequestedPlaneKind(value, fallback = null) {
  const explicit = readText(value, "").toLowerCase();

  if (!explicit) return fallback;
  if (["local", "local-control", "control", "control-plane", "local-control-plane"].includes(explicit)) {
    return "local-control-plane";
  }
  if (["hetzner", "hetzner-worker", "worker-hetzner", "hetzner-worker-plane"].includes(explicit)) {
    return "hetzner-worker-plane";
  }
  if (["generic", "worker", "generic-worker", "generic-worker-plane"].includes(explicit)) {
    return "generic-worker-plane";
  }
  return fallback;
}

function normalizeHandoffPolicy(value, requestIntent) {
  const policy = readText(value, "").toLowerCase();
  if (KNOWN_HANDOFF_POLICIES.has(policy)) return policy;
  return requestIntent === "dispatch-continuation" ? "strict-hetzner" : "auto";
}

function readTimeMs(value) {
  const parsed = typeof value === "string" && value.trim() ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function calculateRetryDelayMs(retryAttempts, lifecycleSettings) {
  const exponent = Math.min(10, Math.max(0, retryAttempts));
  const delay = lifecycleSettings.retryBackoffBaseMs * (2 ** exponent);
  return Math.min(lifecycleSettings.retryBackoffMaxMs, delay);
}

function normalizeProviderContract(rawContract, index, now) {
  const requiredCapabilities = normalizeCapabilityList(
    rawContract?.requiredCapabilities ?? rawContract?.capabilities
  );
  const service = normalizeServiceName(rawContract?.service ?? rawContract?.serviceName);
  const syncWatermark = readText(rawContract?.syncWatermark ?? rawContract?.cursor, null);
  const lastSyncedAt = readText(rawContract?.lastSyncedAt ?? rawContract?.syncedAt, null);

  return {
    contractId: readText(rawContract?.contractId ?? rawContract?.id, `provider-contract-${index + 1}`),
    providerId: readText(rawContract?.providerId ?? rawContract?.provider, "hosted-kernel"),
    service,
    version: readText(rawContract?.version, "v1"),
    planeKinds: normalizeIdList(
      rawContract?.planeKinds ?? rawContract?.executionPlaneKinds ?? rawContract?.supportedPlaneKinds,
      []
    ).map((kind) => normalizeExecutionPlaneKind(kind, rawContract?.providerId ?? rawContract?.provider, [], "unknown")),
    requiredCapabilities,
    optionalCapabilities: normalizeCapabilityList(rawContract?.optionalCapabilities),
    acceptsExternalHandoff: readBoolean(rawContract?.acceptsExternalHandoff, false),
    sync: {
      mode: readText(rawContract?.syncMode ?? rawContract?.sync?.mode, "snapshot"),
      watermark: syncWatermark,
      lastSyncedAt,
      stale: lastSyncedAt ? isHeartbeatStale(lastSyncedAt, now, readNumber(rawContract?.syncStaleAfterMs, 900000)) : false
    }
  };
}

function selectProviderContracts(input, now, planes = []) {
  const explicitContracts = asArray(input.providerContracts ?? input.serviceContracts ?? input.providers)
    .filter((contract) => contract && typeof contract === "object")
    .map((contract, index) => normalizeProviderContract(contract, index, now));

  if (explicitContracts.length > 0 || planes.length === 0) {
    return explicitContracts;
  }

  const hostedKernelCapabilities = [...new Set(planes
    .filter((plane) => plane.providerId === "hosted-kernel")
    .flatMap((plane) => plane.capabilities))].sort();

  return [normalizeProviderContract({
    contractId: "hosted-kernel-default-continuation-dispatch",
    providerId: "hosted-kernel",
    service: "continuation-dispatch",
    version: "v1",
    requiredCapabilities: [],
    optionalCapabilities: [...new Set(["external-handoff", "sync-watermark", ...hostedKernelCapabilities])].sort(),
    acceptsExternalHandoff: false,
    syncMode: "snapshot",
    syncWatermark: null,
    lastSyncedAt: now
  }, 0, now)];
}

function scoreProviderContractForPlane(contract, plane) {
  if (contract.providerId !== plane.providerId) return -100000;

  const serviceProfile = PROVIDER_SERVICE_PROFILES[plane.executionPlaneKind] || PROVIDER_SERVICE_PROFILES["generic-worker-plane"];
  const planeKindScoped = contract.planeKinds.length === 0 || contract.planeKinds.includes(plane.executionPlaneKind);
  const serviceRank = serviceProfile.preferredServices.indexOf(contract.service);
  const serviceCompatible = serviceRank >= 0;
  const requiredCapabilitiesMatched = contract.requiredCapabilities
    .filter((capability) => plane.capabilities.includes(capability))
    .length;
  const profileCapabilitiesMatched = serviceProfile.requiredCapabilities
    .filter((capability) => serviceProfileCapabilitySatisfied(serviceProfile, capability, plane, contract))
    .length;

  return (planeKindScoped ? 10000 : -10000)
    + (serviceCompatible ? 5000 - serviceRank : -5000)
    + (contract.sync.stale ? -1000 : 0)
    + (contract.acceptsExternalHandoff ? 100 : 0)
    + (requiredCapabilitiesMatched * 50)
    + (profileCapabilitiesMatched * 25);
}

function selectProviderContractForPlane(plane, providerContracts) {
  const rankedContracts = providerContracts
    .map((contract) => ({
      contract,
      score: scoreProviderContractForPlane(contract, plane)
    }))
    .filter((entry) => entry.score > -100000)
    .sort((left, right) => right.score - left.score || left.contract.contractId.localeCompare(right.contract.contractId));

  return rankedContracts[0]?.contract || null;
}

function serviceProfileCapabilitySatisfied(profile, capability, plane, contract) {
  const aliases = profile.capabilityAliases?.[capability] || [capability];
  return aliases.some((alias) => (
    plane.capabilities.includes(alias)
    || contract?.requiredCapabilities.includes(alias)
    || contract?.optionalCapabilities.includes(alias)
  ));
}

function missingServiceProfileCapabilities(profile, plane, contract) {
  return profile.requiredCapabilities
    .filter((capability) => !serviceProfileCapabilitySatisfied(profile, capability, plane, contract));
}

function normalizePlane(rawPlane, index, now, defaultSchedulingMode = "automatic") {
  const planeId = readText(rawPlane?.planeId, `plane-${index + 1}`);
  const capacity = Math.max(0, readNumber(rawPlane?.capacity, 0));
  const leasedSlots = Math.max(0, readNumber(rawPlane?.leasedSlots ?? rawPlane?.activeSlots, 0));
  const queuedContinuations = Math.max(0, readNumber(rawPlane?.queuedContinuations, 0));
  const completedContinuations = Math.max(0, readNumber(rawPlane?.completedContinuations, 0));
  const failedContinuations = Math.max(0, readNumber(rawPlane?.failedContinuations, 0));
  const retryState = rawPlane?.retryState ?? rawPlane?.retry ?? {};
  const lastFailureAt = readText(rawPlane?.lastFailureAt ?? retryState.lastFailureAt, null);
  const retryAfterAt = readText(rawPlane?.retryAfterAt ?? retryState.retryAfterAt, null);
  const retryAttempts = Math.max(0, readNumber(rawPlane?.retryAttempts ?? retryState.attempts, 0));
  const lastHeartbeatAt = typeof rawPlane?.lastHeartbeatAt === "string" && rawPlane.lastHeartbeatAt.trim()
    ? rawPlane.lastHeartbeatAt
    : null;
  const region = readText(rawPlane?.region, "unknown");
  const providerId = readText(rawPlane?.providerId ?? rawPlane?.provider, "hosted-kernel");
  const capabilities = normalizeCapabilityList(rawPlane?.capabilities);
  const executionPlaneKind = normalizeExecutionPlaneKind(
    rawPlane?.executionPlaneKind ?? rawPlane?.planeKind ?? rawPlane?.kind,
    providerId,
    capabilities,
    region
  );

  return {
    planeId,
    tenantId: readText(rawPlane?.tenantId ?? rawPlane?.tenant ?? rawPlane?.accountId, DEFAULT_TENANT_ID),
    workspaceId: readText(rawPlane?.workspaceId ?? rawPlane?.workspace ?? rawPlane?.projectId, DEFAULT_WORKSPACE_ID),
    domain: readText(rawPlane?.domain, "general"),
    state: readState(rawPlane?.state),
    owner: readText(rawPlane?.owner, "unassigned"),
    region,
    dataResidency: readText(rawPlane?.dataResidency ?? rawPlane?.residency, null),
    boundaryTags: normalizeCapabilityList(rawPlane?.boundaryTags ?? rawPlane?.accessTags),
    enabled: readBoolean(rawPlane?.enabled, true),
    schedulingMode: readSchedulingMode(rawPlane?.schedulingMode ?? rawPlane?.scheduleMode, defaultSchedulingMode),
    allowNewContinuations: readBoolean(rawPlane?.allowNewContinuations, true),
    providerId,
    executionPlaneKind,
    controlPlane: executionPlaneKind === "local-control-plane",
    workerPlane: executionPlaneKind !== "local-control-plane",
    capabilities,
    handoffState: readText(rawPlane?.handoffState, "none").toLowerCase(),
    handoffTarget: readText(rawPlane?.handoffTarget ?? rawPlane?.externalHandoffTarget, null),
    syncWatermark: readText(rawPlane?.syncWatermark ?? rawPlane?.cursor, null),
    capacity,
    leasedSlots,
    availableSlots: Math.max(0, capacity - leasedSlots),
    queuedContinuations,
    completedContinuations,
    failedContinuations,
    failureState: {
      retryAttempts,
      lastFailureAt,
      retryAfterAt,
      lastErrorCode: readText(rawPlane?.lastErrorCode ?? retryState.lastErrorCode, null),
      lastErrorMessage: readText(rawPlane?.lastErrorMessage ?? retryState.lastErrorMessage, null)
    },
    lastHeartbeatAt,
    snapshotAt: now
  };
}

function buildProviderNegotiation(planes, providerContracts, now) {
  const findings = [];

  const negotiations = planes.map((plane) => {
    const contract = selectProviderContractForPlane(plane, providerContracts);
    const serviceProfile = PROVIDER_SERVICE_PROFILES[plane.executionPlaneKind] || PROVIDER_SERVICE_PROFILES["generic-worker-plane"];
    const requiredCapabilities = contract?.requiredCapabilities || [];
    const missingCapabilities = requiredCapabilities.filter((capability) => !plane.capabilities.includes(capability));
    const missingProfileCapabilities = contract
      ? missingServiceProfileCapabilities(serviceProfile, plane, contract)
      : serviceProfile.requiredCapabilities;
    const planeKindSupported = !contract || contract.planeKinds.length === 0 || contract.planeKinds.includes(plane.executionPlaneKind);
    const serviceCompatible = !contract || serviceProfile.preferredServices.includes(contract.service);
    const handoffState = KNOWN_HANDOFF_STATES.has(plane.handoffState) ? plane.handoffState : "failed";
    const handoffRequired = Boolean(plane.handoffTarget || handoffState !== "none");
    const handoffAccepted = !handoffRequired || Boolean(contract?.acceptsExternalHandoff);
    const syncAligned = !contract?.sync.watermark
      || !plane.syncWatermark
      || contract.sync.watermark === plane.syncWatermark;
    const ready = Boolean(contract)
      && missingCapabilities.length === 0
      && missingProfileCapabilities.length === 0
      && planeKindSupported
      && serviceCompatible
      && handoffAccepted
      && syncAligned
      && !contract.sync.stale
      && handoffState !== "failed";

    if (!contract) {
      findings.push({ severity: "error", code: "provider-contract-missing", planeId: plane.planeId, providerId: plane.providerId });
    }
    if (missingCapabilities.length > 0) {
      findings.push({ severity: "error", code: "provider-capabilities-missing", planeId: plane.planeId, missingCapabilities });
    }
    if (missingProfileCapabilities.length > 0) {
      findings.push({
        severity: "error",
        code: "provider-service-profile-capabilities-missing",
        planeId: plane.planeId,
        executionPlaneKind: plane.executionPlaneKind,
        missingCapabilities: missingProfileCapabilities
      });
    }
    if (!planeKindSupported) {
      findings.push({
        severity: "error",
        code: "provider-contract-plane-kind-unsupported",
        planeId: plane.planeId,
        providerId: plane.providerId,
        contractId: contract.contractId,
        executionPlaneKind: plane.executionPlaneKind,
        supportedPlaneKinds: contract.planeKinds
      });
    }
    if (!serviceCompatible) {
      findings.push({
        severity: "error",
        code: "provider-service-incompatible-with-plane-kind",
        planeId: plane.planeId,
        providerId: plane.providerId,
        contractId: contract.contractId,
        service: contract.service,
        executionPlaneKind: plane.executionPlaneKind,
        expectedServices: serviceProfile.preferredServices
      });
    }
    if (!handoffAccepted) {
      findings.push({ severity: "error", code: "provider-handoff-not-accepted", planeId: plane.planeId, providerId: plane.providerId });
    }
    if (!syncAligned) {
      findings.push({ severity: "warn", code: "provider-sync-watermark-diverged", planeId: plane.planeId, providerId: plane.providerId });
    }
    if (contract?.sync.stale) {
      findings.push({ severity: "warn", code: "provider-sync-stale", providerId: plane.providerId, lastSyncedAt: contract.sync.lastSyncedAt });
    }
    if (!KNOWN_HANDOFF_STATES.has(plane.handoffState)) {
      findings.push({ severity: "error", code: "invalid-handoff-state", planeId: plane.planeId, received: plane.handoffState });
    }

    return {
      planeId: plane.planeId,
      providerId: plane.providerId,
      contractId: contract?.contractId || null,
      service: contract?.service || null,
      serviceProfile: {
        executionPlaneKind: plane.executionPlaneKind,
        expectedServices: serviceProfile.preferredServices,
        requiredCapabilities: serviceProfile.requiredCapabilities,
        serviceCompatible,
        planeKindSupported,
        missingProfileCapabilities
      },
      requiredCapabilities,
      missingCapabilities,
      optionalCapabilitiesMatched: (contract?.optionalCapabilities || []).filter((capability) => plane.capabilities.includes(capability)),
      sync: {
        planeWatermark: plane.syncWatermark,
        providerWatermark: contract?.sync.watermark || null,
        aligned: syncAligned,
        providerLastSyncedAt: contract?.sync.lastSyncedAt || null,
        providerSyncStale: Boolean(contract?.sync.stale)
      },
      externalHandoff: {
        state: handoffState,
        target: plane.handoffTarget,
        required: handoffRequired,
        accepted: handoffAccepted
      },
      ready,
      evaluatedAt: now
    };
  });

  return { negotiations, findings };
}

function summarizePlanes(planes) {
  return planes.reduce((summary, plane) => {
    summary.totalPlanes += 1;
    summary.totalCapacity += plane.capacity;
    summary.leasedSlots += plane.leasedSlots;
    summary.availableSlots += plane.availableSlots;
    summary.queuedContinuations += plane.queuedContinuations;
    summary.completedContinuations += plane.completedContinuations;
    summary.failedContinuations += plane.failedContinuations;
    summary.byState[plane.state] = (summary.byState[plane.state] || 0) + 1;
    summary.byDomain[plane.domain] = (summary.byDomain[plane.domain] || 0) + 1;
    summary.byOwner[plane.owner] = (summary.byOwner[plane.owner] || 0) + 1;
    summary.byTenant[plane.tenantId] = (summary.byTenant[plane.tenantId] || 0) + 1;
    summary.byWorkspace[plane.workspaceId] = (summary.byWorkspace[plane.workspaceId] || 0) + 1;
    return summary;
  }, {
    totalPlanes: 0,
    totalCapacity: 0,
    leasedSlots: 0,
    availableSlots: 0,
    queuedContinuations: 0,
    completedContinuations: 0,
    failedContinuations: 0,
    byState: {},
    byDomain: {},
    byOwner: {},
    byTenant: {},
    byWorkspace: {}
  });
}

function normalizeLifecycleSettings(inputSettings = {}) {
  const requestedMode = inputSettings.defaultSchedulingMode ?? inputSettings.schedulingMode;
  const requestedModeText = typeof requestedMode === "string" ? requestedMode.trim().toLowerCase() : requestedMode;
  const defaultSchedulingMode = readSchedulingMode(requestedMode);
  const heartbeatStaleAfterMs = Math.max(0, readNumber(inputSettings.heartbeatStaleAfterMs, 300000));
  const queueBackpressureLimit = Math.max(0, readNumber(inputSettings.queueBackpressureLimit, 25));
  const minReadyPlanes = Math.max(0, readNumber(inputSettings.minReadyPlanes, 1));
  const registryEnabled = readBoolean(inputSettings.registryEnabled ?? inputSettings.enabled, true);
  const proofRequired = readBoolean(inputSettings.proofRequired, true);
  const failureDegradeRatio = readRatio(inputSettings.failureDegradeRatio, 0.2);
  const failureBlockRatio = readRatio(inputSettings.failureBlockRatio, 0.5);
  const retryBackoffBaseMs = Math.max(0, readNumber(inputSettings.retryBackoffBaseMs, 30000));
  const retryBackoffMaxMs = Math.max(retryBackoffBaseMs, readNumber(inputSettings.retryBackoffMaxMs, 900000));
  const maxRetryAttempts = Math.max(0, readNumber(inputSettings.maxRetryAttempts, 5));
  const degradedModeEnabled = readBoolean(inputSettings.degradedModeEnabled, true);
  const findings = [];

  if (requestedMode !== undefined && defaultSchedulingMode !== requestedModeText) {
    findings.push({
      severity: "warn",
      code: "invalid-default-scheduling-mode",
      received: requestedMode,
      applied: defaultSchedulingMode
    });
  }
  if (heartbeatStaleAfterMs === 0) {
    findings.push({ severity: "warn", code: "heartbeat-staleness-disabled" });
  }
  if (queueBackpressureLimit === 0) {
    findings.push({ severity: "warn", code: "queue-backpressure-disabled" });
  }
  if (failureDegradeRatio > failureBlockRatio) {
    findings.push({
      severity: "warn",
      code: "failure-degrade-threshold-above-block-threshold",
      failureDegradeRatio,
      failureBlockRatio
    });
  }
  if (retryBackoffBaseMs === 0 || retryBackoffMaxMs === 0) {
    findings.push({ severity: "warn", code: "retry-backoff-disabled" });
  }
  if (maxRetryAttempts === 0) {
    findings.push({ severity: "warn", code: "retry-attempt-limit-disabled" });
  }

  return {
    settings: {
      registryEnabled,
      defaultSchedulingMode,
      heartbeatStaleAfterMs,
      queueBackpressureLimit,
      minReadyPlanes,
      proofRequired,
      failureDegradeRatio,
      failureBlockRatio,
      retryBackoffBaseMs,
      retryBackoffMaxMs,
      maxRetryAttempts,
      degradedModeEnabled
    },
    findings
  };
}

function isHeartbeatStale(lastHeartbeatAt, now, heartbeatStaleAfterMs) {
  if (!lastHeartbeatAt || heartbeatStaleAfterMs === 0) return false;
  const heartbeatTime = Date.parse(lastHeartbeatAt);
  const nowTime = Date.parse(now);
  return Number.isFinite(heartbeatTime)
    && Number.isFinite(nowTime)
    && nowTime - heartbeatTime > heartbeatStaleAfterMs;
}

function normalizeLifecycleCommand(rawCommand, index, now) {
  const action = readText(rawCommand?.action ?? rawCommand?.command, "").toLowerCase();
  const effectiveAt = readText(rawCommand?.effectiveAt ?? rawCommand?.notBefore, now);
  const expiresAt = readText(rawCommand?.expiresAt ?? rawCommand?.expireAt, null);
  const nowMs = readTimeMs(now);
  const effectiveMs = readTimeMs(effectiveAt);
  const expiresMs = readTimeMs(expiresAt);
  const invalidTimeWindow = effectiveMs === null
    || (expiresAt !== null && expiresMs === null)
    || (expiresMs !== null && expiresMs < effectiveMs);
  const scheduleState = invalidTimeWindow
    ? "invalid-time-window"
    : nowMs !== null && effectiveMs > nowMs
      ? "pending"
      : expiresMs !== null && nowMs !== null && expiresMs <= nowMs
        ? "expired"
        : "active";

  return {
    commandId: readText(rawCommand?.commandId ?? rawCommand?.id, `lifecycle-command-${index + 1}`),
    action,
    valid: KNOWN_LIFECYCLE_COMMANDS.has(action) && scheduleState !== "invalid-time-window",
    actionValid: KNOWN_LIFECYCLE_COMMANDS.has(action),
    targetPlaneId: readText(rawCommand?.targetPlaneId ?? rawCommand?.planeId, ""),
    tenantId: readText(rawCommand?.tenantId ?? rawCommand?.tenant ?? rawCommand?.accountId, null),
    workspaceId: readText(rawCommand?.workspaceId ?? rawCommand?.workspace ?? rawCommand?.projectId, null),
    expectedState: readState(rawCommand?.expectedState ?? rawCommand?.expectedPlaneState),
    requireCurrentState: readBoolean(rawCommand?.requireCurrentState, false),
    force: readBoolean(rawCommand?.force, false),
    idempotencyKey: readText(rawCommand?.idempotencyKey ?? rawCommand?.dedupeKey, null),
    requestedBy: readText(rawCommand?.requestedBy ?? rawCommand?.actor, "scheduler"),
    reason: readText(rawCommand?.reason, "not-specified"),
    requestedAt: readText(rawCommand?.requestedAt, now),
    effectiveAt,
    expiresAt,
    scheduleState
  };
}

function selectLifecycleCommands(input, now) {
  return asArray(input.lifecycleCommands ?? input.commands)
    .filter((command) => command && typeof command === "object")
    .map((command, index) => normalizeLifecycleCommand(command, index, now));
}

function normalizeAccessContext(input, now) {
  const rawAccess = input.accessContext ?? input.access ?? input.securityContext ?? input.requestContext?.access ?? {};
  const rawRequest = input.requestContext ?? input.request ?? input.clientRequest ?? {};
  const explicitAccess = rawAccess && Object.keys(rawAccess).length > 0;
  const actor = readText(rawAccess.actor ?? rawAccess.actorId ?? rawRequest.actor ?? rawRequest.requestedBy, "scheduler-system");
  const roles = explicitAccess
    ? normalizeRoleList(rawAccess.roles ?? rawAccess.role)
    : ["registry-admin"];
  const explicitPermissions = explicitAccess
    ? normalizeIdList(rawAccess.permissions ?? rawAccess.permissionGrants, [])
      .map((permission) => permission.toLowerCase())
    : ["*"];
  const tenantScope = explicitAccess
    ? normalizeIdList(rawAccess.tenantIds ?? rawAccess.tenants ?? rawAccess.tenantId, [
      readText(rawRequest.tenantId ?? rawRequest.tenant, DEFAULT_TENANT_ID)
    ])
    : ["*"];
  const workspaceScope = explicitAccess
    ? normalizeIdList(rawAccess.workspaceIds ?? rawAccess.workspaces ?? rawAccess.workspaceId, [
      readText(rawRequest.workspaceId ?? rawRequest.workspace, DEFAULT_WORKSPACE_ID)
    ])
    : ["*"];
  const permissions = rolePermissionSet(roles, explicitPermissions);

  return {
    schema: "execution-plane-registry.access-context.v1",
    actor,
    roles,
    permissions,
    tenantScope,
    workspaceScope,
    defaultTenantId: tenantScope.includes("*") ? DEFAULT_TENANT_ID : tenantScope[0],
    defaultWorkspaceId: workspaceScope.includes("*") ? DEFAULT_WORKSPACE_ID : workspaceScope[0],
    scoped: explicitAccess,
    evaluatedAt: now
  };
}

function evaluateAccessBoundary(planes, commands, accessContext, now) {
  const findings = [];
  const deniedPlanes = [];
  const visiblePlaneIds = new Set();
  const planeById = new Map(planes.map((plane) => [plane.planeId, plane]));
  const canRead = hasPermission(accessContext, "execution-plane:read");
  const canCrossWorkspace = hasPermission(accessContext, "execution-plane:cross-workspace");

  const visiblePlanes = planes.filter((plane) => {
    const tenantAllowed = hasScopedValue(accessContext.tenantScope, plane.tenantId);
    const workspaceAllowed = hasScopedValue(accessContext.workspaceScope, plane.workspaceId);
    const visible = canRead && tenantAllowed && (workspaceAllowed || canCrossWorkspace);

    if (visible) {
      visiblePlaneIds.add(plane.planeId);
      return true;
    }

    const reasons = [];
    if (!canRead) reasons.push("missing-read-permission");
    if (!tenantAllowed) reasons.push("tenant-out-of-scope");
    if (!workspaceAllowed && !canCrossWorkspace) reasons.push("workspace-out-of-scope");
    deniedPlanes.push({
      planeId: plane.planeId,
      tenantId: plane.tenantId,
      workspaceId: plane.workspaceId,
      reasons
    });
    findings.push({
      severity: canRead ? "info" : "error",
      topic: "access-boundary",
      code: "execution-plane-hidden-by-access-boundary",
      planeId: plane.planeId,
      tenantId: plane.tenantId,
      workspaceId: plane.workspaceId,
      reasons
    });
    return false;
  });

  const visibleCommands = commands.filter((command) => {
    const targetPlane = planeById.get(command.targetPlaneId);
    const commandPermission = LIFECYCLE_COMMAND_PERMISSIONS[command.action] || "execution-plane:command";
    const canApplyCommand = hasPermission(accessContext, commandPermission);
    const tenantId = command.tenantId || targetPlane?.tenantId || accessContext.defaultTenantId;
    const workspaceId = command.workspaceId || targetPlane?.workspaceId || accessContext.defaultWorkspaceId;
    const tenantAllowed = hasScopedValue(accessContext.tenantScope, tenantId);
    const workspaceAllowed = hasScopedValue(accessContext.workspaceScope, workspaceId);
    const targetVisible = command.targetPlaneId ? visiblePlaneIds.has(command.targetPlaneId) : false;
    const allowed = canApplyCommand
      && tenantAllowed
      && (workspaceAllowed || canCrossWorkspace)
      && targetVisible;

    if (allowed) return true;

    const reasons = [];
    if (!canApplyCommand) reasons.push("missing-command-permission");
    if (!tenantAllowed) reasons.push("command-tenant-out-of-scope");
    if (!workspaceAllowed && !canCrossWorkspace) reasons.push("command-workspace-out-of-scope");
    if (!targetVisible) reasons.push(targetPlane ? "target-plane-not-visible" : "target-plane-not-registered");
    findings.push({
      severity: "error",
      topic: "access-boundary",
      code: "lifecycle-command-denied-by-access-boundary",
      commandId: command.commandId,
      planeId: command.targetPlaneId,
      tenantId,
      workspaceId,
      reasons
    });
    return false;
  });

  return {
    schema: "execution-plane-registry.access-boundary.v1",
    context: accessContext,
    scopedPlanes: visiblePlanes.length,
    scopedCommands: visibleCommands.length,
    deniedPlanes,
    deniedCommandIds: commands
      .filter((command) => !visibleCommands.includes(command))
      .map((command) => command.commandId),
    isolationState: findings.some((finding) => finding.severity === "error") ? "restricted" : "clear",
    visiblePlanes,
    visibleCommands,
    findings,
    evaluatedAt: now
  };
}

function normalizePersistedPlaneState(rawState, index, now) {
  const lastPersistedAt = readText(rawState?.lastPersistedAt ?? rawState?.capturedAt ?? rawState?.snapshotAt, null);

  return {
    planeId: readText(rawState?.planeId ?? rawState?.id, `persisted-plane-${index + 1}`),
    state: readState(rawState?.state),
    enabled: readBoolean(rawState?.enabled, true),
    schedulingMode: readSchedulingMode(rawState?.schedulingMode ?? rawState?.scheduleMode),
    syncWatermark: readText(rawState?.syncWatermark ?? rawState?.cursor, null),
    leasedSlots: Math.max(0, readNumber(rawState?.leasedSlots ?? rawState?.activeSlots, 0)),
    queuedContinuations: Math.max(0, readNumber(rawState?.queuedContinuations, 0)),
    lastHeartbeatAt: readText(rawState?.lastHeartbeatAt, null),
    lastPersistedAt,
    persistedAtValid: !lastPersistedAt || readTimeMs(lastPersistedAt) !== null,
    recoveredAt: now
  };
}

function normalizeCommandReceipt(rawReceipt, index, now) {
  const appliedAt = readText(rawReceipt?.appliedAt ?? rawReceipt?.completedAt ?? rawReceipt?.recordedAt, null);
  const action = readText(rawReceipt?.action ?? rawReceipt?.command, "").toLowerCase();
  const outcome = readText(rawReceipt?.outcome ?? rawReceipt?.status, "applied").toLowerCase();

  return {
    receiptId: readText(rawReceipt?.receiptId ?? rawReceipt?.id, `command-receipt-${index + 1}`),
    commandId: readText(rawReceipt?.commandId, ""),
    idempotencyKey: readText(rawReceipt?.idempotencyKey ?? rawReceipt?.dedupeKey, null),
    planeId: readText(rawReceipt?.planeId ?? rawReceipt?.targetPlaneId, ""),
    action,
    outcome,
    terminal: ["applied", "no-op", "skipped", "failed", "rejected"].includes(outcome),
    appliedAt,
    appliedAtValid: !appliedAt || readTimeMs(appliedAt) !== null,
    recoveredAt: now
  };
}

function commandReceiptDedupKeys(receipt) {
  return [
    receipt.commandId,
    receipt.idempotencyKey
  ].filter(Boolean);
}

function commandDedupKeys(command) {
  return [
    command.commandId,
    command.idempotencyKey
  ].filter(Boolean);
}

function buildCommandReceiptIndex(commandReceipts) {
  const receiptsByKey = new Map();
  const receiptConflicts = [];

  for (const receipt of commandReceipts) {
    for (const key of commandReceiptDedupKeys(receipt)) {
      const existing = receiptsByKey.get(key);
      if (!existing) {
        receiptsByKey.set(key, receipt);
        continue;
      }

      const sameCommand = existing.commandId === receipt.commandId
        || Boolean(existing.idempotencyKey && existing.idempotencyKey === receipt.idempotencyKey);
      const sameEffect = existing.planeId === receipt.planeId && existing.action === receipt.action;
      if (!sameCommand || !sameEffect) {
        receiptConflicts.push({
          key,
          firstReceiptId: existing.receiptId,
          conflictingReceiptId: receipt.receiptId,
          firstCommandId: existing.commandId,
          conflictingCommandId: receipt.commandId,
          firstPlaneId: existing.planeId,
          conflictingPlaneId: receipt.planeId,
          firstAction: existing.action,
          conflictingAction: receipt.action
        });
      }
    }
  }

  return { receiptsByKey, receiptConflicts };
}

function normalizePersistedRegistryState(input, now) {
  const rawState = input.persistedState ?? input.registryState ?? input.persistence?.state ?? {};
  const mode = readText(rawState?.recoveryMode ?? rawState?.mode, "cold-start").toLowerCase();
  const lastPersistedAt = readText(rawState?.lastPersistedAt ?? rawState?.capturedAt ?? rawState?.snapshotAt, null);
  const planeStates = asArray(rawState?.planeStates ?? rawState?.planes)
    .filter((state) => state && typeof state === "object")
    .map((state, index) => normalizePersistedPlaneState(state, index, now));
  const commandReceipts = asArray(rawState?.commandReceipts ?? rawState?.appliedCommands)
    .filter((receipt) => receipt && typeof receipt === "object")
    .map((receipt, index) => normalizeCommandReceipt(receipt, index, now));
  const { receiptsByKey, receiptConflicts } = buildCommandReceiptIndex(commandReceipts);
  const receiptKeys = new Set(receiptsByKey.keys());
  const findings = [];

  if (mode && !KNOWN_RECOVERY_MODES.has(mode)) {
    findings.push({ severity: "warn", code: "unknown-persistence-recovery-mode", received: mode, applied: "cold-start" });
  }
  if (lastPersistedAt && readTimeMs(lastPersistedAt) === null) {
    findings.push({ severity: "warn", code: "invalid-registry-persisted-at", received: lastPersistedAt });
  }
  for (const state of planeStates) {
    if (!state.persistedAtValid) {
      findings.push({ severity: "warn", code: "invalid-plane-persisted-at", planeId: state.planeId, received: state.lastPersistedAt });
    }
  }
  for (const receipt of commandReceipts) {
    if (!receipt.commandId && !receipt.idempotencyKey) {
      findings.push({ severity: "warn", code: "persisted-command-receipt-missing-id", receiptId: receipt.receiptId });
    }
    if (!receipt.appliedAtValid) {
      findings.push({ severity: "warn", code: "invalid-command-receipt-applied-at", receiptId: receipt.receiptId, received: receipt.appliedAt });
    }
    if (receipt.action && !KNOWN_LIFECYCLE_COMMANDS.has(receipt.action)) {
      findings.push({ severity: "warn", code: "persisted-command-receipt-action-unknown", receiptId: receipt.receiptId, action: receipt.action });
    }
    if (!receipt.terminal) {
      findings.push({ severity: "warn", code: "persisted-command-receipt-outcome-nonterminal", receiptId: receipt.receiptId, outcome: receipt.outcome });
    }
  }
  for (const conflict of receiptConflicts) {
    findings.push({
      severity: "error",
      code: "persisted-command-receipt-conflict",
      ...conflict
    });
  }

  return {
    schema: "execution-plane-registry.persisted-state.v1",
    loaded: Boolean(rawState && Object.keys(rawState).length > 0),
    recoveryMode: KNOWN_RECOVERY_MODES.has(mode) ? mode : "cold-start",
    restartId: readText(rawState?.restartId ?? rawState?.bootId, `registry-restart:${now}`),
    epoch: readText(rawState?.epoch ?? rawState?.generation, "0"),
    lastPersistedAt,
    planeStates,
    commandReceipts,
    receiptKeys,
    receiptsByKey,
    receiptConflicts,
    findings
  };
}

function findCommandReceipt(command, persistedState) {
  for (const key of commandDedupKeys(command)) {
    const receipt = persistedState.receiptsByKey.get(key);
    if (receipt) return receipt;
  }
  return null;
}

function commandReceiptMatchesCommand(command, receipt) {
  return Boolean(receipt)
    && (!receipt.planeId || receipt.planeId === command.targetPlaneId)
    && (!receipt.action || receipt.action === command.action);
}

function commandAlreadyApplied(command, persistedState) {
  const receipt = findCommandReceipt(command, persistedState);
  return Boolean(receipt && receipt.terminal && commandReceiptMatchesCommand(command, receipt));
}

function buildCommandReplayDecision(command, persistedState, now) {
  const receipt = findCommandReceipt(command, persistedState);
  const conflict = receipt && !commandReceiptMatchesCommand(command, receipt);
  const alreadyApplied = Boolean(receipt && receipt.terminal && !conflict);
  const replayable = persistedState.loaded
    && command.valid
    && command.scheduleState === "active"
    && !alreadyApplied
    && !conflict;
  const action = conflict
    ? "hold-conflicting-replay"
    : alreadyApplied
      ? "skip-replayed-command"
      : replayable
        ? "replay-active-command"
        : command.scheduleState === "pending"
          ? "wait-until-effective"
          : command.scheduleState === "expired"
            ? "drop-expired-command"
            : "ignore-invalid-command";

  return {
    commandId: command.commandId,
    planeId: command.targetPlaneId,
    action: command.action,
    idempotencyKey: command.idempotencyKey,
    scheduleState: command.scheduleState,
    replayState: conflict
      ? "conflict"
      : alreadyApplied
        ? "deduped"
        : replayable ? "replayable" : "not-replayable",
    restartSafe: !persistedState.loaded || alreadyApplied || ["pending", "expired"].includes(command.scheduleState),
    persistedReceipt: receipt ? {
      receiptId: receipt.receiptId,
      commandId: receipt.commandId,
      planeId: receipt.planeId,
      action: receipt.action,
      outcome: receipt.outcome,
      appliedAt: receipt.appliedAt
    } : null,
    replayAction: action,
    evaluatedAt: now
  };
}

function buildPersistenceRecovery(planes, commands, persistedState, lifecycleSettings, now) {
  const planeStateById = new Map(persistedState.planeStates.map((state) => [state.planeId, state]));
  const currentPlaneIds = new Set(planes.map((plane) => plane.planeId));
  const recoveredPlanes = planes.map((plane) => {
    const previous = planeStateById.get(plane.planeId);
    const persistedStale = previous?.lastPersistedAt
      ? isHeartbeatStale(previous.lastPersistedAt, now, lifecycleSettings.heartbeatStaleAfterMs)
      : false;
    const heartbeatChanged = Boolean(previous?.lastHeartbeatAt && plane.lastHeartbeatAt && previous.lastHeartbeatAt !== plane.lastHeartbeatAt);
    const needsHeartbeat = Boolean(previous && plane.state === "ready" && !plane.lastHeartbeatAt);
    const status = !previous
      ? "new-plane"
      : persistedStale
        ? "stale-persisted-state"
        : needsHeartbeat
          ? "needs-heartbeat"
          : heartbeatChanged || plane.syncWatermark !== previous.syncWatermark
            ? "reconciled"
            : "restored";

    return {
      planeId: plane.planeId,
      restartSafeStatus: status,
      previousState: previous?.state || null,
      currentState: plane.state,
      previousEnabled: previous?.enabled ?? null,
      currentEnabled: plane.enabled,
      previousWatermark: previous?.syncWatermark || null,
      currentWatermark: plane.syncWatermark,
      previousLeasedSlots: previous?.leasedSlots ?? null,
      currentLeasedSlots: plane.leasedSlots,
      requiresSchedulerRefresh: ["new-plane", "stale-persisted-state", "needs-heartbeat"].includes(status),
      evaluatedAt: now
    };
  });
  const orphanedPersistedPlanes = persistedState.planeStates
    .filter((state) => !currentPlaneIds.has(state.planeId))
    .map((state) => ({
      planeId: state.planeId,
      previousState: state.state,
      lastPersistedAt: state.lastPersistedAt,
      recoveryAction: "drop-or-reregister-plane"
    }));
  const commandReplayDecisions = commands.map((command) => buildCommandReplayDecision(command, persistedState, now));
  const idempotentCommands = commandReplayDecisions.map((decision) => ({
    commandId: decision.commandId,
    planeId: decision.planeId,
    action: decision.action,
    idempotencyStatus: decision.replayState === "deduped" ? "already-applied" : decision.replayState,
    restartSafe: decision.restartSafe,
    scheduleState: decision.scheduleState,
    replayAction: decision.replayAction
  }));
  const alreadyAppliedCommands = commandReplayDecisions.filter((command) => command.replayState === "deduped");
  const replayableCommands = commandReplayDecisions.filter((command) => command.replayState === "replayable");
  const conflictingCommands = commandReplayDecisions.filter((command) => command.replayState === "conflict");

  return {
    schema: "execution-plane-registry.persistence-recovery.v1",
    restartId: persistedState.restartId,
    recoveryMode: persistedState.recoveryMode,
    loaded: persistedState.loaded,
    lastPersistedAt: persistedState.lastPersistedAt,
    restartSafe: recoveredPlanes.every((plane) => !plane.requiresSchedulerRefresh)
      && orphanedPersistedPlanes.length === 0
      && idempotentCommands.every((command) => command.restartSafe),
    recoveredPlanes,
    orphanedPersistedPlanes,
    idempotentCommands,
    commandReplayDecisions,
    alreadyAppliedCommandIds: alreadyAppliedCommands.map((command) => command.commandId),
    replayableCommandIds: replayableCommands.map((command) => command.commandId),
    conflictingCommandIds: conflictingCommands.map((command) => command.commandId),
    receiptConflicts: persistedState.receiptConflicts,
    pendingRefreshPlaneIds: recoveredPlanes
      .filter((plane) => plane.requiresSchedulerRefresh)
      .map((plane) => plane.planeId),
    evaluatedAt: now
  };
}

function buildFailureHealth(plane, lifecycleSettings, now) {
  const terminalContinuations = plane.completedContinuations + plane.failedContinuations;
  const failureRatio = terminalContinuations > 0
    ? Number((plane.failedContinuations / terminalContinuations).toFixed(4))
    : 0;
  const lastFailureMs = readTimeMs(plane.failureState.lastFailureAt);
  const explicitRetryMs = readTimeMs(plane.failureState.retryAfterAt);
  const nowMs = readTimeMs(now);
  const computedRetryMs = lastFailureMs === null || lifecycleSettings.retryBackoffBaseMs === 0
    ? null
    : lastFailureMs + calculateRetryDelayMs(plane.failureState.retryAttempts, lifecycleSettings);
  const retryAtMs = explicitRetryMs ?? computedRetryMs;
  const inBackoff = retryAtMs !== null && nowMs !== null && retryAtMs > nowMs;
  const retryAttemptsExhausted = lifecycleSettings.maxRetryAttempts > 0
    && plane.failureState.retryAttempts >= lifecycleSettings.maxRetryAttempts;
  const degradedByFailures = terminalContinuations > 0
    && failureRatio >= lifecycleSettings.failureDegradeRatio;
  const blockedByFailures = terminalContinuations > 0
    && failureRatio >= lifecycleSettings.failureBlockRatio;
  const degradationReasons = [];
  const blockReasons = [];

  if (degradedByFailures) degradationReasons.push("failure-ratio-elevated");
  if (plane.failureState.lastErrorCode) degradationReasons.push("last-error-recorded");
  if (inBackoff) blockReasons.push("failure-backoff-active");
  if (blockedByFailures) blockReasons.push("failure-ratio-blocked");
  if (retryAttemptsExhausted) blockReasons.push("retry-attempts-exhausted");
  if (plane.failureState.retryAfterAt && explicitRetryMs === null) blockReasons.push("invalid-retry-after");
  if (plane.failureState.lastFailureAt && lastFailureMs === null) degradationReasons.push("invalid-last-failure-at");

  return {
    schema: "execution-plane-registry.failure-health.v1",
    state: blockReasons.length > 0
      ? "blocked"
      : degradedByFailures && lifecycleSettings.degradedModeEnabled
        ? "degraded"
        : "healthy",
    failureRatio,
    terminalContinuations,
    retryAttempts: plane.failureState.retryAttempts,
    retryAfterAt: retryAtMs === null ? null : new Date(retryAtMs).toISOString(),
    backoffActive: inBackoff,
    degradedModeActive: degradedByFailures && lifecycleSettings.degradedModeEnabled && blockReasons.length === 0,
    degradationReasons,
    blockReasons,
    lastError: plane.failureState.lastErrorCode || plane.failureState.lastErrorMessage
      ? {
        code: plane.failureState.lastErrorCode,
        message: plane.failureState.lastErrorMessage,
        at: plane.failureState.lastFailureAt
      }
      : null
  };
}

function buildLifecycleCommandEffect(plane, command, lifecycleSettings, failureHealth, now) {
  const baseline = {
    state: plane.state,
    enabled: plane.enabled,
    schedulingMode: plane.schedulingMode,
    allowNewContinuations: plane.allowNewContinuations
  };
  const desired = { ...baseline };
  const mutations = [];
  const proofReasons = [];

  if (!command) {
    return {
      schema: "execution-plane-registry.lifecycle-command-effect.v1",
      state: "none",
      commandId: null,
      action: null,
      baseline,
      desired,
      mutations,
      dispatchPolicy: {
        acceptsNewContinuations: baseline.enabled
          && baseline.allowNewContinuations
          && baseline.schedulingMode === "automatic"
          && plane.state === "ready",
        reason: "no-active-lifecycle-command"
      },
      persistencePatch: null,
      proof: {
        actor: null,
        reason: null,
        force: false,
        evaluatedAt: now,
        proofReasons
      }
    };
  }

  switch (command.action) {
    case "enable":
      desired.enabled = true;
      desired.schedulingMode = lifecycleSettings.defaultSchedulingMode;
      desired.allowNewContinuations = true;
      proofReasons.push("enable-plane");
      break;
    case "disable":
      desired.enabled = false;
      desired.schedulingMode = "maintenance";
      desired.allowNewContinuations = false;
      proofReasons.push("disable-plane");
      if (plane.leasedSlots > 0 && !command.force) proofReasons.push("disable-after-drain-recommended");
      break;
    case "drain":
      desired.state = plane.state === "offline" ? "offline" : "draining";
      desired.schedulingMode = "drain-only";
      desired.allowNewContinuations = false;
      proofReasons.push("drain-existing-work");
      break;
    case "resume":
      desired.enabled = true;
      desired.state = plane.state === "offline" && !command.force ? "offline" : "ready";
      desired.schedulingMode = lifecycleSettings.defaultSchedulingMode;
      desired.allowNewContinuations = true;
      proofReasons.push("resume-plane");
      if (plane.state === "offline" && !command.force) proofReasons.push("offline-plane-requires-force-to-mark-ready");
      break;
    case "pause-scheduling":
      desired.schedulingMode = "paused";
      desired.allowNewContinuations = false;
      proofReasons.push("pause-scheduler-intake");
      break;
    case "resume-scheduling":
      desired.schedulingMode = lifecycleSettings.defaultSchedulingMode;
      desired.allowNewContinuations = true;
      proofReasons.push("resume-scheduler-intake");
      break;
    default:
      proofReasons.push("unknown-command-action");
  }

  for (const key of Object.keys(desired)) {
    if (desired[key] !== baseline[key]) {
      mutations.push({ field: key, from: baseline[key], to: desired[key] });
    }
  }

  const acceptsNewContinuations = desired.enabled
    && desired.allowNewContinuations
    && desired.schedulingMode === "automatic"
    && desired.state === "ready"
    && failureHealth.state !== "blocked";

  return {
    schema: "execution-plane-registry.lifecycle-command-effect.v1",
    state: mutations.length > 0 ? "changes-planned" : "no-op",
    commandId: command.commandId,
    action: command.action,
    baseline,
    desired,
    mutations,
    dispatchPolicy: {
      acceptsNewContinuations,
      reason: acceptsNewContinuations ? "command-leaves-plane-schedulable" : "command-blocks-new-continuations"
    },
    persistencePatch: {
      planeId: plane.planeId,
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      state: desired.state,
      enabled: desired.enabled,
      schedulingMode: desired.schedulingMode,
      allowNewContinuations: desired.allowNewContinuations,
      appliedBy: command.requestedBy,
      appliedAt: now
    },
    proof: {
      actor: command.requestedBy,
      reason: command.reason,
      force: command.force,
      expectedState: command.requireCurrentState ? command.expectedState : null,
      evaluatedAt: now,
      proofReasons
    }
  };
}

function buildLifecycleControls(planes, commands, lifecycleSettings, now, providerNegotiations = [], persistedState = null) {
  const findings = [];
  const commandByPlane = new Map();
  const pendingCommandsByPlane = new Map();
  const expiredCommands = [];
  const negotiationByPlane = new Map(providerNegotiations.map((negotiation) => [negotiation.planeId, negotiation]));
  const planeById = new Map(planes.map((plane) => [plane.planeId, plane]));

  for (const command of commands) {
    if (!command.valid) {
      findings.push({
        severity: "error",
        code: command.actionValid ? "invalid-lifecycle-command-window" : "invalid-lifecycle-command",
        commandId: command.commandId,
        action: command.action,
        effectiveAt: command.effectiveAt,
        expiresAt: command.expiresAt
      });
      continue;
    }
    if (!command.targetPlaneId) {
      findings.push({ severity: "error", code: "lifecycle-command-missing-target", commandId: command.commandId });
      continue;
    }
    if (persistedState && commandAlreadyApplied(command, persistedState)) {
      const receipt = findCommandReceipt(command, persistedState);
      findings.push({
        severity: "info",
        code: "lifecycle-command-already-applied",
        commandId: command.commandId,
        planeId: command.targetPlaneId,
        idempotencyKey: command.idempotencyKey,
        receiptId: receipt?.receiptId || null
      });
      continue;
    }
    if (persistedState) {
      const receipt = findCommandReceipt(command, persistedState);
      if (receipt && !commandReceiptMatchesCommand(command, receipt)) {
        findings.push({
          severity: "error",
          code: "lifecycle-command-idempotency-conflict",
          commandId: command.commandId,
          planeId: command.targetPlaneId,
          action: command.action,
          idempotencyKey: command.idempotencyKey,
          receiptId: receipt.receiptId,
          receiptCommandId: receipt.commandId,
          receiptPlaneId: receipt.planeId,
          receiptAction: receipt.action
        });
        continue;
      }
      if (receipt && !receipt.terminal) {
        findings.push({
          severity: "warn",
          code: "lifecycle-command-receipt-nonterminal",
          commandId: command.commandId,
          planeId: command.targetPlaneId,
          idempotencyKey: command.idempotencyKey,
          receiptId: receipt.receiptId,
          receiptOutcome: receipt.outcome
        });
      }
    }
    const targetPlane = planeById.get(command.targetPlaneId);
    if (targetPlane && command.requireCurrentState && targetPlane.state !== command.expectedState && !command.force) {
      findings.push({
        severity: "error",
        code: "lifecycle-command-state-precondition-failed",
        commandId: command.commandId,
        planeId: command.targetPlaneId,
        expectedState: command.expectedState,
        actualState: targetPlane.state
      });
      continue;
    }
    if (command.scheduleState === "pending") {
      const pendingCommands = pendingCommandsByPlane.get(command.targetPlaneId) || [];
      pendingCommands.push(command);
      pendingCommandsByPlane.set(command.targetPlaneId, pendingCommands);
      findings.push({
        severity: "warn",
        code: "lifecycle-command-pending",
        commandId: command.commandId,
        planeId: command.targetPlaneId,
        effectiveAt: command.effectiveAt
      });
      continue;
    }
    if (command.scheduleState === "expired") {
      expiredCommands.push(command);
      findings.push({
        severity: "warn",
        code: "lifecycle-command-expired",
        commandId: command.commandId,
        planeId: command.targetPlaneId,
        expiresAt: command.expiresAt
      });
      continue;
    }
    const currentCommand = commandByPlane.get(command.targetPlaneId);
    if (currentCommand) {
      const currentMs = readTimeMs(currentCommand.effectiveAt) ?? 0;
      const nextMs = readTimeMs(command.effectiveAt) ?? 0;
      const winner = nextMs >= currentMs ? command : currentCommand;
      const superseded = winner === command ? currentCommand : command;
      commandByPlane.set(command.targetPlaneId, winner);
      findings.push({
        severity: "warn",
        code: "lifecycle-command-superseded",
        planeId: command.targetPlaneId,
        activeCommandId: winner.commandId,
        supersededCommandId: superseded.commandId
      });
      continue;
    }
    commandByPlane.set(command.targetPlaneId, command);
  }

  const controls = planes.map((plane) => {
    const command = commandByPlane.get(plane.planeId);
    const pendingCommands = (pendingCommandsByPlane.get(plane.planeId) || [])
      .sort((left, right) => (readTimeMs(left.effectiveAt) ?? 0) - (readTimeMs(right.effectiveAt) ?? 0));
    const negotiation = negotiationByPlane.get(plane.planeId);
    const heartbeatStale = isHeartbeatStale(plane.lastHeartbeatAt, now, lifecycleSettings.heartbeatStaleAfterMs);
    const failureHealth = buildFailureHealth(plane, lifecycleSettings, now);
    const commandEffect = buildLifecycleCommandEffect(plane, command, lifecycleSettings, failureHealth, now);
    const effectiveMode = lifecycleSettings.registryEnabled ? commandEffect.desired.schedulingMode : "maintenance";
    const targetEnabled = commandEffect.desired.enabled;
    const targetState = commandEffect.desired.state;
    const targetAllowsNewContinuations = commandEffect.desired.allowNewContinuations;
    const acceptsNewContinuations = targetEnabled
      && targetAllowsNewContinuations
      && targetState === "ready"
      && !heartbeatStale
      && effectiveMode === "automatic"
      && plane.availableSlots > 0
      && failureHealth.state !== "blocked"
      && negotiation?.ready !== false;
    const blockedReasons = [];

    if (!lifecycleSettings.registryEnabled) blockedReasons.push("registry-disabled");
    if (!targetEnabled) blockedReasons.push("plane-disabled");
    if (targetState !== "ready") blockedReasons.push(`state-${targetState}`);
    if (heartbeatStale) blockedReasons.push("heartbeat-stale");
    if (!targetAllowsNewContinuations) blockedReasons.push("plane-rejects-new-continuations");
    if (effectiveMode !== "automatic") blockedReasons.push(`scheduling-${effectiveMode}`);
    if (plane.availableSlots === 0) blockedReasons.push("capacity-exhausted");
    if (plane.queuedContinuations > lifecycleSettings.queueBackpressureLimit) blockedReasons.push("queue-backpressure");
    if (negotiation?.ready === false) blockedReasons.push("provider-contract-not-ready");
    blockedReasons.push(...failureHealth.blockReasons);
    if (commandEffect.proof.proofReasons.includes("disable-after-drain-recommended")) {
      blockedReasons.push("disable-after-drain-recommended");
    }

    return {
      planeId: plane.planeId,
      commandId: command?.commandId || null,
      requestedAction: command?.action || null,
      commandScheduleState: command?.scheduleState || null,
      pendingCommands: pendingCommands.map((pendingCommand) => ({
        commandId: pendingCommand.commandId,
        action: pendingCommand.action,
        effectiveAt: pendingCommand.effectiveAt,
        requestedBy: pendingCommand.requestedBy,
        reason: pendingCommand.reason
      })),
      nextScheduledCommand: pendingCommands[0] ? {
        commandId: pendingCommands[0].commandId,
        action: pendingCommands[0].action,
        effectiveAt: pendingCommands[0].effectiveAt
      } : null,
      effectiveSchedulingMode: effectiveMode,
      effectiveEnabled: targetEnabled,
      effectiveState: targetState,
      effectiveAllowNewContinuations: targetAllowsNewContinuations,
      commandEffect,
      providerContractReady: negotiation?.ready ?? true,
      heartbeatStale,
      failureHealth,
      acceptsNewContinuations,
      blockedReasons,
      evaluatedAt: now
    };
  });

  for (const command of commands) {
    if (command.valid && command.targetPlaneId && !planes.some((plane) => plane.planeId === command.targetPlaneId)) {
      findings.push({ severity: "error", code: "lifecycle-command-target-missing", commandId: command.commandId, planeId: command.targetPlaneId });
    }
  }

  return {
    controls,
    findings,
    commandPlan: {
      active: [...commandByPlane.values()].map((command) => ({
        commandId: command.commandId,
        action: command.action,
        planeId: command.targetPlaneId,
        effectiveAt: command.effectiveAt,
        expiresAt: command.expiresAt,
        requestedBy: command.requestedBy,
        reason: command.reason
      })),
      pending: [...pendingCommandsByPlane.values()].flat().map((command) => ({
        commandId: command.commandId,
        action: command.action,
        planeId: command.targetPlaneId,
        effectiveAt: command.effectiveAt,
        expiresAt: command.expiresAt
      })),
      expired: expiredCommands.map((command) => ({
        commandId: command.commandId,
        action: command.action,
        planeId: command.targetPlaneId,
        effectiveAt: command.effectiveAt,
        expiresAt: command.expiresAt
      }))
    }
  };
}

function buildNextActions(planes, controls, lifecycleSettings, providerNegotiations = [], recovery = null) {
  const schedulable = controls.filter((control) => control.acceptsNewContinuations);
  const readyPlanes = planes.filter((plane) => plane.state === "ready").length;
  const queuePressurePlanes = planes.filter((plane) => plane.queuedContinuations > lifecycleSettings.queueBackpressureLimit);
  const blockedProviderPlanes = providerNegotiations.filter((negotiation) => !negotiation.ready);
  const failureBlockedControls = controls.filter((control) => control.failureHealth?.state === "blocked");
  const degradedModeControls = controls.filter((control) => control.failureHealth?.degradedModeActive);
  const controlsWithPendingCommands = controls.filter((control) => control.nextScheduledCommand);
  const actions = [];

  for (const planeId of recovery?.pendingRefreshPlaneIds || []) {
    actions.push({
      priority: "high",
      action: "refresh-recovered-plane-state",
      planeId,
      reason: "restart-state-needs-refresh"
    });
  }
  for (const orphanedPlane of recovery?.orphanedPersistedPlanes || []) {
    actions.push({
      priority: "medium",
      action: "reconcile-orphaned-persisted-plane",
      planeId: orphanedPlane.planeId,
      reason: orphanedPlane.recoveryAction,
      lastPersistedAt: orphanedPlane.lastPersistedAt
    });
  }
  if (!lifecycleSettings.registryEnabled) {
    actions.push({ priority: "critical", action: "enable-registry", reason: "registry-disabled" });
  }
  if (readyPlanes < lifecycleSettings.minReadyPlanes) {
    actions.push({ priority: "high", action: "restore-ready-capacity", readyPlanes, requiredReadyPlanes: lifecycleSettings.minReadyPlanes });
  }
  if (schedulable.length === 0 && planes.length > 0) {
    actions.push({ priority: "high", action: "resume-or-enable-plane", reason: "no-plane-accepts-new-continuations" });
  }
  for (const negotiation of blockedProviderPlanes) {
    actions.push({
      priority: "high",
      action: "reconcile-provider-contract",
      planeId: negotiation.planeId,
      providerId: negotiation.providerId,
      contractId: negotiation.contractId,
      missingCapabilities: negotiation.missingCapabilities,
      handoffAccepted: negotiation.externalHandoff.accepted,
      syncAligned: negotiation.sync.aligned
    });
  }
  for (const control of failureBlockedControls) {
    actions.push({
      priority: "high",
      action: control.failureHealth.backoffActive ? "wait-for-plane-retry-backoff" : "reset-plane-failure-state",
      planeId: control.planeId,
      failureRatio: control.failureHealth.failureRatio,
      retryAttempts: control.failureHealth.retryAttempts,
      retryAfterAt: control.failureHealth.retryAfterAt,
      blockedReasons: control.failureHealth.blockReasons
    });
  }
  for (const control of degradedModeControls) {
    actions.push({
      priority: "medium",
      action: "monitor-degraded-plane",
      planeId: control.planeId,
      failureRatio: control.failureHealth.failureRatio,
      retryAttempts: control.failureHealth.retryAttempts,
      degradationReasons: control.failureHealth.degradationReasons
    });
  }
  for (const control of controlsWithPendingCommands) {
    actions.push({
      priority: "medium",
      action: "await-scheduled-lifecycle-command",
      planeId: control.planeId,
      commandId: control.nextScheduledCommand.commandId,
      scheduledAction: control.nextScheduledCommand.action,
      effectiveAt: control.nextScheduledCommand.effectiveAt
    });
  }
  for (const plane of queuePressurePlanes) {
    actions.push({
      priority: "medium",
      action: "relieve-plane-queue",
      planeId: plane.planeId,
      queuedContinuations: plane.queuedContinuations,
      threshold: lifecycleSettings.queueBackpressureLimit
    });
  }

  return actions.length > 0
    ? actions
    : [{ priority: "normal", action: "schedule-next-continuation", eligiblePlanes: schedulable.map((control) => control.planeId) }];
}

function classifyOperationalSeverity(control, providerNegotiation, recoveryStatus) {
  if (control.failureHealth?.state === "blocked") return "error";
  if (providerNegotiation && !providerNegotiation.ready) return "error";
  if (control.blockedReasons.includes("heartbeat-stale")) return "warn";
  if (control.failureHealth?.degradedModeActive) return "warn";
  if (recoveryStatus?.requiresSchedulerRefresh) return "warn";
  return control.acceptsNewContinuations ? "info" : "warn";
}

function buildOperationalHealthContract({
  planes,
  controls,
  providerNegotiations,
  lifecycleSettings,
  recovery,
  accessBoundary,
  now
}) {
  const planeById = new Map(planes.map((plane) => [plane.planeId, plane]));
  const providerByPlane = new Map(providerNegotiations.map((negotiation) => [negotiation.planeId, negotiation]));
  const recoveryByPlane = new Map((recovery?.recoveredPlanes || []).map((state) => [state.planeId, state]));
  const incidents = controls
    .filter((control) => !control.acceptsNewContinuations || control.failureHealth?.state !== "healthy")
    .map((control) => {
      const plane = planeById.get(control.planeId);
      const providerNegotiation = providerByPlane.get(control.planeId);
      const recoveryStatus = recoveryByPlane.get(control.planeId);
      const severity = classifyOperationalSeverity(control, providerNegotiation, recoveryStatus);
      const retryBlocked = control.failureHealth?.blockReasons.includes("failure-backoff-active");
      const retryResetRequired = control.failureHealth?.blockReasons.includes("retry-attempts-exhausted")
        || control.failureHealth?.blockReasons.includes("invalid-retry-after");
      const action = retryBlocked
        ? "wait-for-retry-backoff"
        : retryResetRequired
          ? "reset-plane-failure-state"
          : providerNegotiation && !providerNegotiation.ready
            ? "reconcile-provider-contract"
            : recoveryStatus?.requiresSchedulerRefresh
              ? "refresh-recovered-plane-state"
              : control.heartbeatStale
                ? "restore-plane-heartbeat"
                : control.failureHealth?.degradedModeActive
                  ? "monitor-degraded-mode"
                  : "review-plane-scheduling-blocker";

      return {
        incidentId: `execution-plane-health:${control.planeId}`,
        planeId: control.planeId,
        tenantId: plane?.tenantId || null,
        workspaceId: plane?.workspaceId || null,
        severity,
        state: control.failureHealth?.state || "unknown",
        degradedModeActive: Boolean(control.failureHealth?.degradedModeActive),
        acceptsNewContinuations: control.acceptsNewContinuations,
        blockedReasons: control.blockedReasons,
        retry: {
          attempts: control.failureHealth?.retryAttempts || 0,
          retryAfterAt: control.failureHealth?.retryAfterAt || null,
          backoffActive: Boolean(control.failureHealth?.backoffActive),
          maxAttempts: lifecycleSettings.maxRetryAttempts
        },
        lastError: control.failureHealth?.lastError || null,
        provider: providerNegotiation ? {
          providerId: providerNegotiation.providerId,
          contractId: providerNegotiation.contractId,
          ready: providerNegotiation.ready,
          missingCapabilities: providerNegotiation.missingCapabilities,
          syncAligned: providerNegotiation.sync.aligned
        } : null,
        recovery: recoveryStatus ? {
          restartSafeStatus: recoveryStatus.restartSafeStatus,
          requiresSchedulerRefresh: recoveryStatus.requiresSchedulerRefresh
        } : null,
        action,
        userVisibleMessage: severity === "error"
          ? `Execution plane ${control.planeId} is blocked: ${control.blockedReasons.join(", ") || "failure-state-blocked"}`
          : `Execution plane ${control.planeId} needs attention: ${control.blockedReasons.join(", ") || control.failureHealth?.state || "health-check"}`,
        routePayload: {
          surfaceId,
          route: "scheduler.executionPlaneRegistry.operationalHealth",
          action,
          planeId: control.planeId,
          retryAfterAt: control.failureHealth?.retryAfterAt || null,
          blockedReasons: control.blockedReasons,
          generatedAt: now
        }
      };
    });
  const findings = incidents
    .filter((incident) => incident.severity === "error" || incident.severity === "warn")
    .map((incident) => ({
      severity: incident.severity,
      topic: "operational-health",
      code: incident.severity === "error" ? "execution-plane-operational-health-blocked" : "execution-plane-operational-health-attention",
      planeId: incident.planeId,
      action: incident.action,
      blockedReasons: incident.blockedReasons,
      retryAfterAt: incident.retry.retryAfterAt
    }));

  return {
    schema: "execution-plane-registry.operational-health.v1",
    generatedAt: now,
    state: incidents.some((incident) => incident.severity === "error")
      ? "blocked"
      : incidents.some((incident) => incident.severity === "warn")
        ? "degraded"
        : "healthy",
    registryEnabled: lifecycleSettings.registryEnabled,
    scopedPlanes: accessBoundary.scopedPlanes,
    visibleIncidents: incidents.length,
    blockedPlaneIds: incidents.filter((incident) => incident.severity === "error").map((incident) => incident.planeId),
    degradedPlaneIds: incidents.filter((incident) => incident.degradedModeActive).map((incident) => incident.planeId),
    retryBackoffPlaneIds: incidents.filter((incident) => incident.retry.backoffActive).map((incident) => incident.planeId),
    incidents,
    findings
  };
}

function buildValidationSummary(audit, providerNegotiation, lifecycle, settingsFindings, operationalHealth = null, executionPlaneSelection = null) {
  const allFindings = audit.findings;
  const errors = allFindings.filter((finding) => finding.severity === "error");
  const warnings = allFindings.filter((finding) => finding.severity === "warn");
  const requestFindings = allFindings.filter((finding) => finding.topic === "client-request");
  const validationTopics = [
    {
      topic: "registry-settings",
      status: settingsFindings.some((finding) => finding.severity === "error") ? "blocked" : "checked",
      findingCodes: settingsFindings.map((finding) => finding.code)
    },
    {
      topic: "lifecycle-commands",
      status: lifecycle.findings.some((finding) => finding.severity === "error") ? "blocked" : "checked",
      findingCodes: lifecycle.findings.map((finding) => finding.code)
    },
    {
      topic: "provider-contracts",
      status: providerNegotiation.findings.some((finding) => finding.severity === "error") ? "blocked" : "checked",
      findingCodes: providerNegotiation.findings.map((finding) => finding.code)
    },
    {
      topic: "audit-proof",
      status: audit.blockingFindings > 0 ? "blocked" : warnings.length > 0 ? "attention" : "checked",
      findingCodes: allFindings.map((finding) => finding.code)
    },
    {
      topic: "client-request",
      status: requestFindings.some((finding) => finding.severity === "error") ? "blocked" : "checked",
      findingCodes: requestFindings.map((finding) => finding.code)
    },
    {
      topic: "operational-health",
      status: operationalHealth?.state === "blocked" ? "blocked" : operationalHealth?.state === "degraded" ? "attention" : "checked",
      findingCodes: (operationalHealth?.findings || []).map((finding) => finding.code)
    },
    {
      topic: "execution-plane-selection",
      status: executionPlaneSelection?.state === "blocked" ? "blocked" : executionPlaneSelection?.fallbackUsed ? "attention" : "checked",
      findingCodes: (executionPlaneSelection?.findings || []).map((finding) => finding.code)
    }
  ];

  return {
    status: errors.length > 0 ? "blocked" : warnings.length > 0 ? "attention" : "passed",
    blockingFindings: errors.length,
    warningFindings: warnings.length,
    checkedTopics: validationTopics.length,
    topics: validationTopics,
    userVisibleSummary: errors.length > 0
      ? `${errors.length} blocking registry validation issue${errors.length === 1 ? "" : "s"}`
      : warnings.length > 0
        ? `${warnings.length} registry warning${warnings.length === 1 ? "" : "s"} need review`
        : "Execution plane registry is valid for scheduling preview"
  };
}

function buildReadinessContract(counters, lifecycleSettings, controls, providerSummary, audit, recovery = null) {
  const eligiblePlaneIds = controls
    .filter((control) => control.acceptsNewContinuations)
    .map((control) => control.planeId);
  const readyPlanes = counters.byState.ready || 0;
  const failureBlockedPlaneIds = controls
    .filter((control) => control.failureHealth?.state === "blocked")
    .map((control) => control.planeId);
  const readinessChecks = [
    {
      check: "registry-enabled",
      ready: lifecycleSettings.registryEnabled,
      detail: lifecycleSettings.registryEnabled ? "Registry accepts scheduler traffic" : "Registry is disabled"
    },
    {
      check: "minimum-ready-planes",
      ready: readyPlanes >= lifecycleSettings.minReadyPlanes,
      current: readyPlanes,
      required: lifecycleSettings.minReadyPlanes
    },
    {
      check: "schedulable-capacity",
      ready: eligiblePlaneIds.length > 0,
      eligiblePlaneIds
    },
    {
      check: "provider-contracts-ready",
      ready: providerSummary.blockedNegotiations === 0,
      blockedNegotiations: providerSummary.blockedNegotiations
    },
    {
      check: "failure-backoff-clear",
      ready: failureBlockedPlaneIds.length === 0,
      blockedPlaneIds: failureBlockedPlaneIds
    },
    {
      check: "audit-blockers-clear",
      ready: audit.blockingFindings === 0,
      blockingFindings: audit.blockingFindings
    },
    {
      check: "restart-safe-state",
      ready: recovery ? recovery.restartSafe : true,
      recoveryMode: recovery?.recoveryMode || "cold-start",
      pendingRefreshPlaneIds: recovery?.pendingRefreshPlaneIds || [],
      orphanedPersistedPlanes: recovery?.orphanedPersistedPlanes?.map((plane) => plane.planeId) || [],
      alreadyAppliedCommandIds: recovery?.alreadyAppliedCommandIds || [],
      replayableCommandIds: recovery?.replayableCommandIds || [],
      conflictingCommandIds: recovery?.conflictingCommandIds || []
    }
  ];
  const failedChecks = readinessChecks.filter((check) => !check.ready);

  return {
    state: failedChecks.length === 0 ? "ready" : eligiblePlaneIds.length > 0 && audit.blockingFindings === 0 ? "limited" : "blocked",
    ready: failedChecks.length === 0,
    score: readinessChecks.length === 0
      ? 0
      : Number(((readinessChecks.length - failedChecks.length) / readinessChecks.length).toFixed(4)),
    eligiblePlaneIds,
    failedChecks: failedChecks.map((check) => check.check),
    checks: readinessChecks
  };
}

function summarizeSelectionCandidatePreview(candidate, desiredPlaneKind, selectedPlaneId) {
  const rejectReasons = [...new Set([
    ...(candidate.executionPlaneKind === desiredPlaneKind || candidate.fallbackEligible
      ? []
      : [`kind-${candidate.executionPlaneKind}-not-${desiredPlaneKind}`]),
    ...asArray(candidate.selectionBoundaryReasons),
    ...asArray(candidate.blockedReasons),
    ...asArray(candidate.providerMissingProfileCapabilities)
      .map((capability) => `provider-profile-capability-missing-${capability}`)
  ])];
  const acceptanceState = candidate.planeId === selectedPlaneId
    ? "selected"
    : candidate.selectionEligible
      ? "acceptable"
      : candidate.fallbackEligible
        ? "fallback-acceptable"
        : "rejected";
  const nextAction = acceptanceState === "rejected"
    ? candidate.lifecycleSelection?.nextAction || "review-selection-blockers"
    : candidate.fallbackEligible ? "confirm-worker-fallback" : "confirm-selection";

  return {
    planeId: candidate.planeId,
    executionPlaneKind: candidate.executionPlaneKind,
    providerId: candidate.providerId,
    providerContractId: candidate.providerContractId,
    domain: candidate.domain,
    region: candidate.region,
    requested: candidate.requested,
    selected: candidate.planeId === selectedPlaneId,
    acceptanceState,
    acceptsRequestedKind: candidate.executionPlaneKind === desiredPlaneKind,
    boundaryEligible: candidate.boundaryEligible,
    providerReady: candidate.providerReady,
    lifecycleState: candidate.lifecycleSelection?.state || "unknown",
    availableSlots: candidate.availableSlots,
    queuedContinuations: candidate.queuedContinuations,
    score: candidate.score,
    rejectReasons,
    nextAction,
    userVisibleLabel: acceptanceState === "selected"
      ? `Selected ${candidate.executionPlaneKind} ${candidate.planeId}`
      : acceptanceState === "rejected"
        ? `${candidate.executionPlaneKind} ${candidate.planeId} blocked`
        : `${candidate.executionPlaneKind} ${candidate.planeId} available`
  };
}

function buildExecutionPlaneSelectionPreview(executionPlaneSelection, now) {
  const candidates = asArray(executionPlaneSelection?.candidates);
  const desiredPlaneKind = executionPlaneSelection?.desiredPlaneKind || null;
  const selectedPlaneId = executionPlaneSelection?.selectedPlaneId || null;
  const candidatePreviews = candidates.map((candidate) => (
    summarizeSelectionCandidatePreview(candidate, desiredPlaneKind, selectedPlaneId)
  ));
  const byKind = ["local-control-plane", "hetzner-worker-plane", "generic-worker-plane"]
    .reduce((summary, kind) => {
      const kindCandidates = candidatePreviews.filter((candidate) => candidate.executionPlaneKind === kind);
      summary[kind] = {
        total: kindCandidates.length,
        selectedPlaneIds: kindCandidates.filter((candidate) => candidate.selected).map((candidate) => candidate.planeId),
        acceptablePlaneIds: kindCandidates
          .filter((candidate) => ["selected", "acceptable", "fallback-acceptable"].includes(candidate.acceptanceState))
          .map((candidate) => candidate.planeId),
        rejectedPlaneIds: kindCandidates
          .filter((candidate) => candidate.acceptanceState === "rejected")
          .map((candidate) => candidate.planeId),
        topRejectReasons: countValues(kindCandidates.flatMap((candidate) => candidate.rejectReasons))
      };
      return summary;
    }, {});
  const selectedCandidate = candidatePreviews.find((candidate) => candidate.selected) || null;
  const blockedDesiredKinds = candidatePreviews.filter((candidate) => (
    candidate.executionPlaneKind === desiredPlaneKind && candidate.acceptanceState === "rejected"
  ));

  return {
    schema: "execution-plane-registry.selection-preview.v1",
    generatedAt: now,
    state: executionPlaneSelection?.state || "unknown",
    selectionMode: executionPlaneSelection?.selectionMode || "unknown",
    desiredPlaneKind,
    selectedPlaneId,
    selectedPlaneKind: executionPlaneSelection?.selectedPlaneKind || null,
    fallbackUsed: Boolean(executionPlaneSelection?.fallbackUsed),
    primaryDecisionLabel: selectedCandidate
      ? selectedCandidate.userVisibleLabel
      : `No ${desiredPlaneKind || "execution-plane"} accepted`,
    nextAction: selectedCandidate
      ? selectedCandidate.nextAction
      : executionPlaneSelection?.operationalAdvisory?.primaryAction || "register-compatible-execution-plane",
    byKind,
    blockedDesiredPlaneIds: blockedDesiredKinds.map((candidate) => candidate.planeId),
    rows: candidatePreviews,
    routePayload: {
      surfaceId,
      route: "scheduler.executionPlaneRegistry.selectionPreview",
      action: selectedCandidate ? "accept-selection-preview" : "resolve-selection-preview",
      selectionMode: executionPlaneSelection?.selectionMode || "unknown",
      desiredPlaneKind,
      selectedPlaneId,
      selectedPlaneKind: executionPlaneSelection?.selectedPlaneKind || null,
      fallbackUsed: Boolean(executionPlaneSelection?.fallbackUsed),
      generatedAt: now
    }
  };
}

function buildPreviewContract(planes, controls, providerNegotiations, counters, readiness, nextActions, now, executionPlaneSelection = null) {
  const controlByPlane = new Map(controls.map((control) => [control.planeId, control]));
  const negotiationByPlane = new Map(providerNegotiations.map((negotiation) => [negotiation.planeId, negotiation]));
  const selectionPreview = buildExecutionPlaneSelectionPreview(executionPlaneSelection, now);
  const previewRows = planes.map((plane) => {
    const control = controlByPlane.get(plane.planeId);
    const negotiation = negotiationByPlane.get(plane.planeId);

    return {
      planeId: plane.planeId,
      label: `${plane.domain}/${plane.planeId}`,
      state: plane.state,
      region: plane.region,
      capacityLabel: `${plane.availableSlots}/${plane.capacity} slots available`,
      providerLabel: negotiation?.ready
        ? `${plane.providerId} contract ready`
        : `${plane.providerId} contract blocked`,
      failureLabel: control?.failureHealth?.state === "blocked"
        ? `Retry blocked until ${control.failureHealth.retryAfterAt || "manual reset"}`
        : control?.failureHealth?.degradedModeActive
          ? `Degraded mode: ${control.failureHealth.degradationReasons.join(", ")}`
          : "Failure health clear",
      schedulingLabel: control?.acceptsNewContinuations
        ? "Accepting new continuations"
        : `Blocked: ${(control?.blockedReasons || ["not-evaluated"]).join(", ")}`,
      routeHint: control?.acceptsNewContinuations ? "scheduler.dispatch.preview.accept" : "scheduler.dispatch.preview.remediate",
      proofRefs: {
        providerContractId: negotiation?.contractId || null,
        lifecycleCommandId: control?.commandId || null,
        evaluatedAt: control?.evaluatedAt || now
      }
    };
  });

  return {
    title: readiness.ready ? "Execution planes ready" : "Execution planes need attention",
    generatedAt: now,
    summary: {
      totalPlanes: counters.totalPlanes,
      readyPlanes: counters.byState.ready || 0,
      eligiblePlanes: readiness.eligiblePlaneIds.length,
      nextAction: nextActions[0]?.action || "none",
      selectionState: selectionPreview.state,
      selectedPlaneId: selectionPreview.selectedPlaneId,
      selectedPlaneKind: selectionPreview.selectedPlaneKind,
      selectionFallbackUsed: selectionPreview.fallbackUsed
    },
    selectionDecision: selectionPreview,
    rows: previewRows,
    emptyState: planes.length === 0
      ? {
        title: "No execution planes registered",
        nextAction: "register-hosted-kernel-plane"
      }
      : null
  };
}

function buildAcceptanceContract(readiness, validationSummary, lifecycleSettings, providerSummary, nextActions, now, executionPlaneSelection = null) {
  const gates = [
    { gate: "readiness", accepted: readiness.ready, state: readiness.state },
    { gate: "validation", accepted: validationSummary.blockingFindings === 0, state: validationSummary.status },
    { gate: "proof-policy", accepted: !lifecycleSettings.proofRequired || validationSummary.status !== "blocked", proofRequired: lifecycleSettings.proofRequired },
    { gate: "provider-negotiation", accepted: providerSummary.blockedNegotiations === 0, blockedNegotiations: providerSummary.blockedNegotiations },
    {
      gate: "execution-plane-selection",
      accepted: executionPlaneSelection?.state !== "blocked",
      state: executionPlaneSelection?.state || "unknown",
      selectionMode: executionPlaneSelection?.selectionMode || "unknown",
      desiredPlaneKind: executionPlaneSelection?.desiredPlaneKind || null,
      selectedPlaneId: executionPlaneSelection?.selectedPlaneId || null,
      fallbackUsed: Boolean(executionPlaneSelection?.fallbackUsed)
    }
  ];
  const rejectedGates = gates.filter((gate) => !gate.accepted);

  return {
    schema: "execution-plane-registry.acceptance.v1",
    accepted: rejectedGates.length === 0,
    state: rejectedGates.length === 0 ? "accepted" : "requires-remediation",
    evaluatedAt: now,
    gates,
    rejectedGates: rejectedGates.map((gate) => gate.gate),
    remediationActions: rejectedGates.length === 0 ? [] : nextActions,
    routePayload: {
      surfaceId,
      route: "scheduler.executionPlaneRegistry.acceptance",
      action: rejectedGates.length === 0 ? "accept-registry-preview" : "review-rejected-gates",
      selectedPlaneId: executionPlaneSelection?.selectedPlaneId || null,
      selectedPlaneKind: executionPlaneSelection?.selectedPlaneKind || null,
      rejectedGates: rejectedGates.map((gate) => gate.gate),
      generatedAt: now
    }
  };
}

function buildNextStepContracts(nextActions, controls, providerNegotiations, now) {
  const blockedByPlane = new Map(controls.map((control) => [control.planeId, control.blockedReasons]));
  const controlByPlane = new Map(controls.map((control) => [control.planeId, control]));
  const negotiationByPlane = new Map(providerNegotiations.map((negotiation) => [negotiation.planeId, negotiation]));

  return nextActions.map((nextAction, index) => {
    const planeIds = nextAction.planeId
      ? [nextAction.planeId]
      : nextAction.eligiblePlanes || [];
    const negotiation = nextAction.planeId ? negotiationByPlane.get(nextAction.planeId) : null;
    const control = nextAction.planeId ? controlByPlane.get(nextAction.planeId) : null;

    return {
      stepId: `execution-plane-next-step-${index + 1}`,
      priority: nextAction.priority,
      action: nextAction.action,
      userVisibleLabel: nextAction.action.split("-").join(" "),
      rationale: nextAction.reason
        || (nextAction.planeId ? (blockedByPlane.get(nextAction.planeId) || []).join(", ") : "registry-ready"),
      planeIds,
      provider: negotiation ? {
        providerId: negotiation.providerId,
        contractId: negotiation.contractId,
        missingCapabilities: negotiation.missingCapabilities,
        syncAligned: negotiation.sync.aligned,
        handoffAccepted: negotiation.externalHandoff.accepted
      } : null,
      failure: control?.failureHealth ? {
        state: control.failureHealth.state,
        failureRatio: control.failureHealth.failureRatio,
        retryAttempts: control.failureHealth.retryAttempts,
        retryAfterAt: control.failureHealth.retryAfterAt,
        blockReasons: control.failureHealth.blockReasons
      } : null,
      lifecycleEffect: control?.commandEffect ? {
        schema: control.commandEffect.schema,
        state: control.commandEffect.state,
        commandId: control.commandEffect.commandId,
        action: control.commandEffect.action,
        desired: control.commandEffect.desired,
        mutations: control.commandEffect.mutations,
        dispatchPolicy: control.commandEffect.dispatchPolicy,
        persistencePatch: control.commandEffect.persistencePatch
      } : null,
      routePayload: {
        surfaceId,
        route: "scheduler.executionPlaneRegistry.nextStep",
        action: nextAction.action,
        planeIds,
        commandId: nextAction.commandId || null,
        scheduledAction: nextAction.scheduledAction || null,
        effectiveAt: nextAction.effectiveAt || null,
        retryAfterAt: nextAction.retryAfterAt || null,
        blockedReasons: nextAction.blockedReasons || [],
        lifecycleCommandEffect: control?.commandEffect ? {
          state: control.commandEffect.state,
          commandId: control.commandEffect.commandId,
          action: control.commandEffect.action,
          mutationFields: control.commandEffect.mutations.map((mutation) => mutation.field),
          acceptsNewContinuations: control.commandEffect.dispatchPolicy.acceptsNewContinuations
        } : null,
        generatedAt: now
      }
    };
  });
}

function normalizeClientRequestContext(input, now) {
  const request = input.requestContext ?? input.request ?? input.clientRequest ?? {};
  const clientState = input.clientState ?? input.client ?? {};
  const workflow = input.workflow ?? input.handoffWorkflow ?? {};
  const rawIntent = readText(request.intent ?? workflow.intent ?? clientState.intent, "preview-registry").toLowerCase();
  const intent = KNOWN_REQUEST_INTENTS.has(rawIntent) ? rawIntent : "preview-registry";
  const selectedPlaneId = readText(
    request.selectedPlaneId ?? request.planeId ?? clientState.selectedPlaneId ?? workflow.selectedPlaneId,
    null
  );
  const rawRequestedPlaneKind = request.executionPlaneKind
    ?? request.requestedPlaneKind
    ?? request.planeKind
    ?? clientState.executionPlaneKind
    ?? clientState.requestedPlaneKind
    ?? workflow.executionPlaneKind
    ?? workflow.requestedPlaneKind;
  const requestedPlaneKind = normalizeRequestedPlaneKind(rawRequestedPlaneKind, null);
  const requestedProviderId = readText(
    request.providerId ?? clientState.providerId ?? workflow.providerId,
    null
  );
  const handoffPolicy = normalizeHandoffPolicy(
    request.handoffPolicy
      ?? request.workerHandoffPolicy
      ?? clientState.handoffPolicy
      ?? workflow.handoffPolicy,
    intent
  );
  const selectedPlaneKind = normalizeRequestedPlaneKind(
    request.selectedPlaneKind ?? clientState.selectedPlaneKind ?? workflow.selectedPlaneKind,
    null
  );

  return {
    schema: "execution-plane-registry.client-request.v1",
    requestId: readText(request.requestId ?? request.id ?? clientState.requestId, `execution-plane-request:${now}`),
    sessionId: readText(request.sessionId ?? clientState.sessionId, null),
    actor: readText(request.actor ?? request.requestedBy ?? clientState.actor, "scheduler-client"),
    intent,
    rawIntent,
    continuationId: readText(request.continuationId ?? workflow.continuationId, null),
    selectedPlaneId,
    tenantId: readText(
      request.tenantId ?? request.tenant ?? clientState.tenantId ?? workflow.tenantId,
      null
    ),
    workspaceId: readText(
      request.workspaceId ?? request.workspace ?? clientState.workspaceId ?? workflow.workspaceId,
      null
    ),
    domain: readText(request.domain ?? clientState.domain, "general"),
    originRoute: readText(request.originRoute ?? clientState.originRoute, "scheduler.executionPlaneRegistry"),
    returnRoute: readText(request.returnRoute ?? workflow.returnRoute, "scheduler.continuationQueue"),
    clientCapabilities: normalizeCapabilityList(request.clientCapabilities ?? clientState.capabilities),
    executionPlaneRouting: {
      schema: "execution-plane-registry.client-routing.v1",
      requestedPlaneKind,
      rawRequestedPlaneKind: readText(rawRequestedPlaneKind, null),
      selectedPlaneKind,
      requestedProviderId,
      handoffPolicy,
      strictHetzner: handoffPolicy === "strict-hetzner",
      allowGenericFallback: ["allow-generic-fallback", "confirm-fallback"].includes(handoffPolicy),
      requireFallbackConfirmation: handoffPolicy === "confirm-fallback",
      controlIntent: CONTROL_PLANE_REQUEST_INTENTS.has(intent),
      workerDispatchIntent: intent === "dispatch-continuation"
    },
    requiresUserConfirmation: readBoolean(
      request.requiresUserConfirmation ?? workflow.requiresUserConfirmation,
      intent !== "dispatch-continuation"
    ),
    submittedAt: readText(request.submittedAt ?? request.createdAt, now)
  };
}

function buildSelectionBoundary(requestContext, accessBoundary, selectionMode) {
  const accessContext = accessBoundary.context;
  const requestedTenantId = readText(requestContext.tenantId, null);
  const requestedWorkspaceId = readText(requestContext.workspaceId, null);
  const wildcardTenantScope = accessContext.tenantScope.includes("*");
  const wildcardWorkspaceScope = accessContext.workspaceScope.includes("*");
  const crossWorkspaceAllowed = hasPermission(accessContext, "execution-plane:cross-workspace");
  const requiredPermission = SELECTION_MODE_PERMISSIONS[selectionMode] || "execution-plane:read";
  const permissionAllowed = hasPermission(accessContext, requiredPermission);
  const auditAllowed = hasPermission(accessContext, "execution-plane:audit");
  const targetTenantId = requestedTenantId
    || (wildcardTenantScope ? null : accessContext.tenantScope[0])
    || accessContext.defaultTenantId;
  const targetWorkspaceId = requestedWorkspaceId
    || (wildcardWorkspaceScope ? null : accessContext.workspaceScope[0])
    || accessContext.defaultWorkspaceId;

  return {
    schema: "execution-plane-registry.selection-boundary.v1",
    actor: accessContext.actor,
    requestedTenantId,
    requestedWorkspaceId,
    targetTenantId,
    targetWorkspaceId,
    strictTenant: Boolean(requestedTenantId) || !wildcardTenantScope,
    strictWorkspace: Boolean(requestedWorkspaceId) || (!wildcardWorkspaceScope && !crossWorkspaceAllowed),
    crossWorkspaceAllowed,
    requiredPermission,
    permissionAllowed,
    auditAllowed,
    tenantScope: accessContext.tenantScope,
    workspaceScope: accessContext.workspaceScope,
    isolationState: accessBoundary.isolationState
  };
}

function evaluateSelectionBoundaryMatch(plane, boundary, selectionMode) {
  const tenantMatch = !boundary.targetTenantId || plane.tenantId === boundary.targetTenantId;
  const workspaceMatch = !boundary.targetWorkspaceId || plane.workspaceId === boundary.targetWorkspaceId;
  const tenantAllowed = !boundary.strictTenant || tenantMatch;
  const workspaceAllowed = !boundary.strictWorkspace
    || workspaceMatch
    || (boundary.crossWorkspaceAllowed && !boundary.requestedWorkspaceId);
  const localControlAllowed = selectionMode !== "registry-control"
    || (boundary.permissionAllowed && tenantAllowed && workspaceAllowed);
  const workerDispatchAllowed = selectionMode !== "worker-dispatch"
    || (boundary.permissionAllowed && tenantAllowed && workspaceAllowed);
  const reasons = [];

  if (!boundary.permissionAllowed) reasons.push(`missing-${boundary.requiredPermission}`);
  if (!tenantAllowed) reasons.push("tenant-boundary-mismatch");
  if (!workspaceAllowed) reasons.push("workspace-boundary-mismatch");
  if (!localControlAllowed) reasons.push("local-control-boundary-mismatch");
  if (!workerDispatchAllowed) reasons.push("worker-dispatch-boundary-mismatch");

  return {
    tenantMatch,
    workspaceMatch,
    tenantAllowed,
    workspaceAllowed,
    localControlAllowed,
    workerDispatchAllowed,
    reasons,
    score: (tenantMatch ? 2500 : 0)
      + (workspaceMatch ? 2500 : 0)
      + (boundary.permissionAllowed ? 1000 : -10000)
      + (tenantAllowed ? 500 : -5000)
      + (workspaceAllowed ? 500 : -5000)
  };
}

function buildSelectionAuditHandoff({
  requestContext,
  selectionBoundary,
  selectionMode,
  desiredPlaneKind,
  selected,
  candidates,
  fallbackUsed,
  now
}) {
  const boundaryRejected = candidates.filter((candidate) => !candidate.boundaryEligible);
  const reasonCounts = countValues(boundaryRejected.flatMap((candidate) => candidate.selectionBoundaryReasons));
  const candidateCountByKind = countValues(candidates.map((candidate) => candidate.executionPlaneKind));
  const auditState = !selectionBoundary.permissionAllowed
    ? "permission-blocked"
    : selected
      ? fallbackUsed ? "fallback-handoff" : "handoff-ready"
      : "selection-blocked";

  return {
    schema: "execution-plane-registry.selection-audit-handoff.v1",
    generatedAt: now,
    state: auditState,
    actor: selectionBoundary.actor,
    requestId: requestContext.requestId,
    continuationId: requestContext.continuationId,
    selectionMode,
    desiredPlaneKind,
    requiredPermission: selectionBoundary.requiredPermission,
    permissionAllowed: selectionBoundary.permissionAllowed,
    auditAllowed: selectionBoundary.auditAllowed,
    accessIsolationState: selectionBoundary.isolationState,
    targetTenantId: selectionBoundary.targetTenantId,
    targetWorkspaceId: selectionBoundary.targetWorkspaceId,
    strictTenant: selectionBoundary.strictTenant,
    strictWorkspace: selectionBoundary.strictWorkspace,
    crossWorkspaceAllowed: selectionBoundary.crossWorkspaceAllowed,
    decision: {
      selectedPlaneId: selected?.planeId || null,
      selectedPlaneKind: selected?.executionPlaneKind || null,
      selectedProviderId: selected?.providerId || null,
      fallbackUsed,
      candidateCount: candidates.length,
      candidateCountByKind,
      boundaryRejectedPlaneIds: boundaryRejected.map((candidate) => candidate.planeId),
      boundaryRejectedReasonCounts: reasonCounts
    },
    selectedPlane: selected ? {
      planeId: selected.planeId,
      tenantId: selected.tenantId,
      workspaceId: selected.workspaceId,
      providerId: selected.providerId,
      providerContractId: selected.providerContractId,
      providerService: selected.providerService,
      executionPlaneKind: selected.executionPlaneKind,
      domain: selected.domain,
      region: selected.region,
      boundaryReasons: selected.selectionBoundaryReasons,
      routeAllowed: selected.boundaryEligible,
      serviceContract: {
        compatible: selected.providerServiceCompatible,
        expectedServices: selected.providerExpectedServices,
        planeKindSupported: selected.providerPlaneKindSupported,
        missingProfileCapabilities: selected.providerMissingProfileCapabilities
      }
    } : null,
    handoffPayload: {
      surfaceId,
      route: "scheduler.executionPlaneRegistry.selectionAudit",
      action: auditState,
      requestId: requestContext.requestId,
      continuationId: requestContext.continuationId,
      selectedPlaneId: selected?.planeId || null,
      selectedPlaneKind: selected?.executionPlaneKind || null,
      providerContractId: selected?.providerContractId || null,
      providerService: selected?.providerService || null,
      targetTenantId: selectionBoundary.targetTenantId,
      targetWorkspaceId: selectionBoundary.targetWorkspaceId,
      requiredPermission: selectionBoundary.requiredPermission,
      generatedAt: now
    }
  };
}

function buildSelectionCandidateOperationalState(candidate, desiredPlaneKind, selectionMode) {
  const reasons = [...candidate.selectionBoundaryReasons];
  const providerReasons = [];
  const failureReasons = [];
  const capacityReasons = [];
  const modeReasons = [];
  const lifecycleReasons = [];

  if (candidate.executionPlaneKind !== desiredPlaneKind) {
    reasons.push(`kind-${candidate.executionPlaneKind}-not-${desiredPlaneKind}`);
  }
  if (!candidate.providerReady) providerReasons.push("provider-contract-not-ready");
  if (candidate.providerServiceCompatible === false) {
    providerReasons.push(`provider-service-${candidate.providerService || "unknown"}-incompatible`);
  }
  if (candidate.providerPlaneKindSupported === false) {
    providerReasons.push("provider-contract-plane-kind-unsupported");
  }
  for (const capability of asArray(candidate.providerMissingProfileCapabilities)) {
    providerReasons.push(`provider-profile-capability-missing-${capability}`);
  }
  if (candidate.heartbeatStale) modeReasons.push("heartbeat-stale");
  if (candidate.availableSlots <= 0 && selectionMode === "worker-dispatch") capacityReasons.push("capacity-exhausted");
  if (candidate.queuedContinuations > 0 && !candidate.acceptsNewContinuations) capacityReasons.push("queued-work-not-dispatchable");
  for (const reason of candidate.blockedReasons) {
    if (reason.startsWith("effective-")) lifecycleReasons.push(reason);
    else if (reason.includes("failure") || reason.includes("retry")) failureReasons.push(reason);
    else if (reason.includes("capacity") || reason.includes("queue")) capacityReasons.push(reason);
    else if (reason.includes("provider")) providerReasons.push(reason);
    else modeReasons.push(reason);
  }

  const allReasons = [...new Set([
    ...reasons,
    ...providerReasons,
    ...failureReasons,
    ...capacityReasons,
    ...lifecycleReasons,
    ...modeReasons
  ])];
  const retryAfterAt = candidate.failureHealth?.retryAfterAt || null;
  const retryable = Boolean(retryAfterAt)
    || failureReasons.includes("failure-backoff-active")
    || providerReasons.length > 0
    || modeReasons.includes("heartbeat-stale");
  const remediationAction = !candidate.permissionAllowed
    ? "grant-selection-permission"
    : candidate.selectionBoundaryReasons.length > 0
      ? "adjust-selection-boundary"
      : lifecycleReasons.includes("effective-plane-disabled")
        ? "enable-plane"
      : lifecycleReasons.some((reason) => reason.startsWith("effective-state-"))
        ? "resume-plane"
        : lifecycleReasons.some((reason) => reason.startsWith("effective-scheduling-"))
          ? "resume-scheduling"
          : providerReasons.length > 0
            ? "reconcile-provider-contract"
            : failureReasons.includes("retry-attempts-exhausted")
              ? "reset-plane-failure-state"
              : retryAfterAt || failureReasons.includes("failure-backoff-active")
                ? "wait-for-plane-retry-backoff"
                : modeReasons.includes("heartbeat-stale")
                  ? "restore-plane-heartbeat"
                  : capacityReasons.length > 0
                    ? "relieve-plane-capacity"
                    : "review-plane-scheduling-mode";

  return {
    state: candidate.selectionEligible || candidate.fallbackEligible
      ? "eligible"
      : retryable ? "retryable-blocked" : "blocked",
    remediationAction,
    retryable,
    retryAfterAt,
    degradedModeActive: Boolean(candidate.failureHealth?.degradedModeActive),
    providerReasons: [...new Set(providerReasons)],
    failureReasons: [...new Set(failureReasons)],
    capacityReasons: [...new Set(capacityReasons)],
    lifecycleReasons: [...new Set(lifecycleReasons)],
    modeReasons: [...new Set(modeReasons)],
    allReasons,
    actionableError: allReasons.length === 0
      ? null
      : {
        code: `selection-${remediationAction}`,
        message: `${candidate.planeId} cannot serve ${desiredPlaneKind}: ${allReasons.join(", ")}`,
        planeId: candidate.planeId,
        action: remediationAction,
        retryAfterAt
      }
  };
}

function buildSelectionOperationalAdvisory({
  candidates,
  selected,
  fallbackUsed,
  desiredPlaneKind,
  selectionMode,
  now
}) {
  const candidateStates = candidates.map((candidate) => ({
    planeId: candidate.planeId,
    executionPlaneKind: candidate.executionPlaneKind,
    providerId: candidate.providerId,
    providerContractId: candidate.providerContractId,
    providerService: candidate.providerService,
    providerServiceCompatible: candidate.providerServiceCompatible,
    providerExpectedServices: candidate.providerExpectedServices,
    providerMissingProfileCapabilities: candidate.providerMissingProfileCapabilities,
    requested: candidate.requested,
    domainMatch: candidate.domainMatch,
    lifecycleSelection: candidate.lifecycleSelection,
    selectionEligible: candidate.selectionEligible,
    fallbackEligible: candidate.fallbackEligible,
    ...buildSelectionCandidateOperationalState(candidate, desiredPlaneKind, selectionMode)
  }));
  const blockedDesired = candidateStates.filter((candidate) => (
    candidate.executionPlaneKind === desiredPlaneKind && candidate.state !== "eligible"
  ));
  const retryableBlocked = blockedDesired.filter((candidate) => candidate.retryable);
  const degradedCandidates = candidateStates.filter((candidate) => candidate.degradedModeActive);
  const topError = blockedDesired.find((candidate) => candidate.actionableError)?.actionableError
    || candidateStates.find((candidate) => candidate.actionableError)?.actionableError
    || null;

  return {
    schema: "execution-plane-registry.selection-operational-advisory.v1",
    generatedAt: now,
    state: selected
      ? fallbackUsed ? "fallback-degraded" : degradedCandidates.some((candidate) => candidate.planeId === selected.planeId) ? "selected-degraded" : "selected"
      : retryableBlocked.length > 0 ? "retryable-blocked" : "blocked",
    desiredPlaneKind,
    selectedPlaneId: selected?.planeId || null,
    fallbackUsed,
    retryableBlockedPlaneIds: retryableBlocked.map((candidate) => candidate.planeId),
    degradedPlaneIds: degradedCandidates.map((candidate) => candidate.planeId),
    nextRetryAt: retryableBlocked
      .map((candidate) => candidate.retryAfterAt)
      .filter(Boolean)
      .sort()[0] || null,
    primaryAction: selected
      ? fallbackUsed ? "monitor-worker-fallback" : "dispatch-selected-plane"
      : topError?.action || "register-compatible-execution-plane",
    actionableError: selected && !fallbackUsed ? null : topError,
    candidates: candidateStates
  };
}

function validateClientRequestContext(requestContext, planes, controls) {
  const findings = [];
  const requestedPlaneKind = requestContext.executionPlaneRouting?.requestedPlaneKind || null;
  const selectedPlaneKind = requestContext.executionPlaneRouting?.selectedPlaneKind || null;
  const selectedPlaneFromRegistry = requestContext.selectedPlaneId
    ? planes.find((plane) => plane.planeId === requestContext.selectedPlaneId)
    : null;
  const selectedPlane = requestContext.selectedPlaneId
    ? planes.find((plane) => plane.planeId === requestContext.selectedPlaneId)
    : null;
  const selectedControl = requestContext.selectedPlaneId
    ? controls.find((control) => control.planeId === requestContext.selectedPlaneId)
    : null;

  if (requestContext.rawIntent !== requestContext.intent) {
    findings.push({
      severity: "warn",
      topic: "client-request",
      code: "unknown-client-request-intent",
      received: requestContext.rawIntent,
      applied: requestContext.intent
    });
  }
  if (requestContext.intent === "dispatch-continuation" && !requestContext.continuationId) {
    findings.push({
      severity: "error",
      topic: "client-request",
      code: "dispatch-request-missing-continuation-id",
      requestId: requestContext.requestId
    });
  }
  if (requestContext.intent === "dispatch-continuation" && requestedPlaneKind === "local-control-plane") {
    findings.push({
      severity: "error",
      topic: "client-request",
      code: "dispatch-request-targets-local-control-plane",
      requestId: requestContext.requestId,
      requestedPlaneKind
    });
  }
  if (CONTROL_PLANE_REQUEST_INTENTS.has(requestContext.intent) && requestedPlaneKind && requestedPlaneKind !== "local-control-plane") {
    findings.push({
      severity: "warn",
      topic: "client-request",
      code: "control-request-worker-plane-kind-ignored",
      requestId: requestContext.requestId,
      requestedPlaneKind,
      appliedPlaneKind: "local-control-plane"
    });
  }
  if (
    requestContext.intent === "dispatch-continuation"
    && requestContext.executionPlaneRouting?.strictHetzner
    && requestedPlaneKind
    && requestedPlaneKind !== "hetzner-worker-plane"
  ) {
    findings.push({
      severity: "error",
      topic: "client-request",
      code: "strict-hetzner-request-kind-mismatch",
      requestId: requestContext.requestId,
      requestedPlaneKind,
      handoffPolicy: requestContext.executionPlaneRouting.handoffPolicy
    });
  }
  if (requestContext.selectedPlaneId && !selectedPlane) {
    findings.push({
      severity: "error",
      topic: "client-request",
      code: "selected-plane-not-registered",
      requestId: requestContext.requestId,
      planeId: requestContext.selectedPlaneId
    });
  }
  if (selectedPlaneKind && selectedPlaneFromRegistry && selectedPlaneKind !== selectedPlaneFromRegistry.executionPlaneKind) {
    findings.push({
      severity: "warn",
      topic: "client-request",
      code: "selected-plane-kind-mismatch",
      requestId: requestContext.requestId,
      planeId: requestContext.selectedPlaneId,
      receivedPlaneKind: selectedPlaneKind,
      registryPlaneKind: selectedPlaneFromRegistry.executionPlaneKind
    });
  }
  if (selectedControl && !selectedControl.acceptsNewContinuations) {
    findings.push({
      severity: "warn",
      topic: "client-request",
      code: "selected-plane-not-schedulable",
      requestId: requestContext.requestId,
      planeId: requestContext.selectedPlaneId,
      blockedReasons: selectedControl.blockedReasons
    });
  }

  return findings;
}

function buildWorkflowHandoffContract(
  requestContext,
  readiness,
  acceptance,
  preview,
  nextStepContracts,
  controls,
  providerNegotiations,
  executionPlaneSelection,
  now
) {
  const eligiblePlaneIds = controls
    .filter((control) => control.acceptsNewContinuations)
    .map((control) => control.planeId);
  const dispatchIntent = requestContext.intent === "dispatch-continuation";
  const selectedByExecutionPlane = dispatchIntent
    ? executionPlaneSelection?.selectedPlaneId || null
    : null;
  const selectedPlaneEligible = requestContext.selectedPlaneId
    ? eligiblePlaneIds.includes(requestContext.selectedPlaneId)
      && (!dispatchIntent || requestContext.selectedPlaneId === selectedByExecutionPlane)
    : false;
  const selectedPlaneId = dispatchIntent
    ? selectedByExecutionPlane
    : selectedPlaneEligible
      ? requestContext.selectedPlaneId
      : eligiblePlaneIds[0] || null;
  const selectedNegotiation = selectedPlaneId
    ? providerNegotiations.find((negotiation) => negotiation.planeId === selectedPlaneId)
    : null;
  const routingPolicy = requestContext.executionPlaneRouting || {};
  const fallbackConfirmationRequired = dispatchIntent
    && Boolean(executionPlaneSelection?.fallbackUsed)
    && (routingPolicy.requireFallbackConfirmation || requestContext.requiresUserConfirmation);
  const canDispatch = acceptance.accepted
    && readiness.ready
    && Boolean(selectedPlaneId)
    && dispatchIntent
    && Boolean(requestContext.continuationId)
    && !fallbackConfirmationRequired;
  const primaryAction = canDispatch
    ? "dispatch-continuation"
    : fallbackConfirmationRequired
      ? "confirm-worker-plane-fallback"
    : acceptance.accepted && readiness.ready
      ? "confirm-dispatch-target"
      : "open-remediation";

  return {
    schema: "execution-plane-registry.workflow-handoff.v1",
    generatedAt: now,
    request: requestContext,
    state: canDispatch
      ? "ready-for-dispatch"
      : fallbackConfirmationRequired
        ? "awaiting-worker-fallback-confirmation"
        : acceptance.accepted ? "awaiting-client-selection" : "requires-remediation",
    selectedPlaneId,
    selectedPlaneEligible,
    handoffDecision: {
      schema: "execution-plane-registry.workflow-handoff-decision.v1",
      selectionMode: executionPlaneSelection?.selectionMode || null,
      desiredPlaneKind: executionPlaneSelection?.desiredPlaneKind || null,
      selectedPlaneKind: executionPlaneSelection?.selectedPlaneKind || null,
      selectedProviderId: executionPlaneSelection?.selectedProviderId || null,
      handoffPolicy: routingPolicy.handoffPolicy || "auto",
      fallbackUsed: Boolean(executionPlaneSelection?.fallbackUsed),
      fallbackConfirmationRequired,
      canDispatch,
      userConfirmationRequired: requestContext.requiresUserConfirmation,
      providerContractId: selectedNegotiation?.contractId || null,
      providerService: selectedNegotiation?.service || null
    },
    userVisibleLabel: canDispatch
      ? "Dispatch continuation"
      : fallbackConfirmationRequired
        ? "Confirm worker fallback"
      : acceptance.accepted
        ? "Choose execution plane"
        : "Resolve execution plane blockers",
    primaryRoute: {
      route: canDispatch
        ? "scheduler.continuation.dispatch"
        : fallbackConfirmationRequired
          ? "scheduler.executionPlaneRegistry.confirmWorkerFallback"
        : acceptance.accepted
          ? "scheduler.executionPlaneRegistry.selectPlane"
          : "scheduler.executionPlaneRegistry.remediate",
      action: primaryAction,
      requestId: requestContext.requestId,
      continuationId: requestContext.continuationId,
      planeId: selectedPlaneId,
      returnRoute: requestContext.returnRoute
    },
    fallbackRoute: {
      route: "scheduler.executionPlaneRegistry.preview",
      action: "review-registry-preview",
      requestId: requestContext.requestId,
      summary: preview.summary
    },
    proofRefs: {
      acceptanceState: acceptance.state,
      readinessState: readiness.state,
      providerContractId: selectedNegotiation?.contractId || null,
      executionPlaneSelectionState: executionPlaneSelection?.state || null,
      executionPlaneSelectionPlaneId: selectedByExecutionPlane,
      selectionAuditState: executionPlaneSelection?.auditHandoff?.state || null,
      nextStepIds: nextStepContracts.map((contract) => contract.stepId)
    },
    remediationStepIds: acceptance.accepted
      ? []
      : nextStepContracts.map((contract) => contract.stepId)
  };
}

function buildCandidateLifecycleSelectionState(plane, control, providerReady, selectionMode) {
  const effectiveEnabled = control?.effectiveEnabled ?? plane.enabled;
  const effectiveState = control?.effectiveState ?? plane.state;
  const effectiveSchedulingMode = control?.effectiveSchedulingMode ?? plane.schedulingMode;
  const effectiveAllowNewContinuations = control?.effectiveAllowNewContinuations ?? plane.allowNewContinuations;
  const commandEffectState = control?.commandEffect?.state || "none";
  const commandAction = control?.requestedAction || null;
  const activeCommandId = control?.commandId || null;
  const reasons = [];

  if (!effectiveEnabled) reasons.push("effective-plane-disabled");
  if (!["ready", "degraded"].includes(effectiveState)) reasons.push(`effective-state-${effectiveState}`);
  if (!effectiveAllowNewContinuations && selectionMode === "worker-dispatch") {
    reasons.push("effective-new-continuations-disabled");
  }
  if (effectiveSchedulingMode === "maintenance") reasons.push("effective-scheduling-maintenance");
  if (effectiveSchedulingMode === "paused") reasons.push("effective-scheduling-paused");
  if (effectiveSchedulingMode === "drain-only" && selectionMode === "worker-dispatch") {
    reasons.push("effective-scheduling-drain-only");
  }
  if (control?.heartbeatStale) reasons.push("heartbeat-stale");
  if (!providerReady) reasons.push("provider-contract-not-ready");

  const acceptsControlTraffic = effectiveEnabled
    && ["ready", "degraded"].includes(effectiveState)
    && !control?.heartbeatStale
    && providerReady
    && !["maintenance", "paused"].includes(effectiveSchedulingMode);
  const acceptsWorkerDispatch = Boolean(control?.acceptsNewContinuations)
    && effectiveEnabled
    && effectiveState === "ready"
    && effectiveAllowNewContinuations
    && effectiveSchedulingMode === "automatic";
  const nextAction = reasons.length === 0
    ? "select-plane"
    : reasons.includes("effective-plane-disabled")
      ? "enable-plane"
      : reasons.some((reason) => reason.startsWith("effective-state-"))
        ? "resume-plane"
        : reasons.some((reason) => reason.startsWith("effective-scheduling-"))
          ? "resume-scheduling"
          : reasons.includes("provider-contract-not-ready")
            ? "reconcile-provider-contract"
            : reasons.includes("heartbeat-stale")
              ? "restore-plane-heartbeat"
              : "review-lifecycle-control";

  return {
    schema: "execution-plane-registry.candidate-lifecycle-selection.v1",
    state: acceptsControlTraffic || acceptsWorkerDispatch ? "eligible" : "blocked",
    activeCommandId,
    commandAction,
    commandEffectState,
    effectiveEnabled,
    effectiveState,
    effectiveSchedulingMode,
    effectiveAllowNewContinuations,
    acceptsControlTraffic,
    acceptsWorkerDispatch,
    reasons,
    nextAction
  };
}

function buildExecutionPlaneSelectionContract({
  requestContext,
  planes,
  controls,
  providerNegotiations,
  accessBoundary,
  now
}) {
  const controlByPlane = new Map(controls.map((control) => [control.planeId, control]));
  const negotiationByPlane = new Map(providerNegotiations.map((negotiation) => [negotiation.planeId, negotiation]));
  const selectionMode = CONTROL_PLANE_REQUEST_INTENTS.has(requestContext.intent) ? "registry-control" : "worker-dispatch";
  const routingPolicy = requestContext.executionPlaneRouting || {};
  const requestedPlaneKind = routingPolicy.requestedPlaneKind || null;
  const workerRequestedKind = requestedPlaneKind && requestedPlaneKind !== "local-control-plane"
    ? requestedPlaneKind
    : null;
  const desiredPlaneKind = selectionMode === "worker-dispatch"
    ? workerRequestedKind || "hetzner-worker-plane"
    : "local-control-plane";
  const genericFallbackAllowed = selectionMode === "worker-dispatch"
    && desiredPlaneKind === "hetzner-worker-plane"
    && routingPolicy.allowGenericFallback === true;
  const selectionBoundary = buildSelectionBoundary(requestContext, accessBoundary, selectionMode);
  const findings = [];
  const candidates = planes
    .map((plane) => {
      const control = controlByPlane.get(plane.planeId);
      const negotiation = negotiationByPlane.get(plane.planeId);
      const boundaryMatch = evaluateSelectionBoundaryMatch(plane, selectionBoundary, selectionMode);
      const providerReady = negotiation?.ready ?? true;
      const providerServiceProfile = negotiation?.serviceProfile || null;
      const lifecycleSelection = buildCandidateLifecycleSelectionState(
        plane,
        control,
        providerReady,
        selectionMode
      );
      const controlHealthy = lifecycleSelection.acceptsControlTraffic;
      const canServeControl = plane.executionPlaneKind === "local-control-plane"
        && controlHealthy
        && lifecycleSelection.effectiveSchedulingMode !== "maintenance";
      const canServeWorker = plane.executionPlaneKind === "hetzner-worker-plane"
        && lifecycleSelection.acceptsWorkerDispatch;
      const canServeGenericWorker = plane.executionPlaneKind === "generic-worker-plane"
        && lifecycleSelection.acceptsWorkerDispatch;
      const requested = plane.planeId === requestContext.selectedPlaneId;
      const domainMatch = plane.domain === requestContext.domain;
      const selectionEligible = selectionMode === "registry-control"
        ? canServeControl && boundaryMatch.localControlAllowed
        : plane.executionPlaneKind === desiredPlaneKind
          && (desiredPlaneKind === "hetzner-worker-plane" ? canServeWorker : canServeGenericWorker)
          && boundaryMatch.workerDispatchAllowed;
      const fallbackEligible = genericFallbackAllowed
        ? canServeGenericWorker && boundaryMatch.workerDispatchAllowed
        : false;
      const boundaryEligible = selectionMode === "registry-control"
        ? boundaryMatch.localControlAllowed
        : boundaryMatch.workerDispatchAllowed;

      return {
        planeId: plane.planeId,
        tenantId: plane.tenantId,
        workspaceId: plane.workspaceId,
        providerId: plane.providerId,
        providerContractId: negotiation?.contractId || null,
        providerService: negotiation?.service || null,
        providerExpectedServices: providerServiceProfile?.expectedServices || [],
        providerServiceCompatible: providerServiceProfile?.serviceCompatible ?? true,
        providerPlaneKindSupported: providerServiceProfile?.planeKindSupported ?? true,
        providerMissingProfileCapabilities: providerServiceProfile?.missingProfileCapabilities || [],
        executionPlaneKind: plane.executionPlaneKind,
        domain: plane.domain,
        region: plane.region,
        requested,
        domainMatch,
        tenantMatch: boundaryMatch.tenantMatch,
        workspaceMatch: boundaryMatch.workspaceMatch,
        permissionAllowed: selectionBoundary.permissionAllowed,
        boundaryEligible,
        providerReady,
        heartbeatStale: Boolean(control?.heartbeatStale),
        acceptsNewContinuations: Boolean(control?.acceptsNewContinuations),
        lifecycleSelection,
        availableSlots: plane.availableSlots,
        queuedContinuations: plane.queuedContinuations,
        canServeControl,
        canServeWorker,
        canServeGenericWorker,
        selectionEligible,
        fallbackEligible,
        blockedReasons: [...new Set([
          ...asArray(control?.blockedReasons),
          ...lifecycleSelection.reasons
        ])],
        failureHealth: control?.failureHealth || null,
        selectionBoundaryReasons: boundaryMatch.reasons,
        score: (requested ? 100000 : 0)
          + (selectionEligible ? 50000 : 0)
          + (fallbackEligible ? 10000 : 0)
          + (plane.providerId === routingPolicy.requestedProviderId ? 25000 : 0)
          + (plane.executionPlaneKind === desiredPlaneKind ? 5000 : 0)
          + (domainMatch ? 1000 : 0)
          + boundaryMatch.score
          + (lifecycleSelection.acceptsControlTraffic || lifecycleSelection.acceptsWorkerDispatch ? 750 : -750)
          + (plane.availableSlots * 10)
          - plane.queuedContinuations
      };
    })
    .sort((left, right) => right.score - left.score || left.planeId.localeCompare(right.planeId));
  const primaryCandidates = candidates.filter((candidate) => candidate.selectionEligible);
  const fallbackCandidates = candidates.filter((candidate) => candidate.fallbackEligible);
  const selected = primaryCandidates[0] || fallbackCandidates[0] || null;
  const fallbackUsed = Boolean(selected && !selected.selectionEligible);
  const operationalAdvisory = buildSelectionOperationalAdvisory({
    candidates,
    selected,
    fallbackUsed,
    desiredPlaneKind,
    selectionMode,
    now
  });
  const selectionAuditHandoff = buildSelectionAuditHandoff({
    requestContext,
    selectionBoundary,
    selectionMode,
    desiredPlaneKind,
    selected,
    candidates,
    fallbackUsed,
    now
  });

  if (!selectionBoundary.permissionAllowed) {
    findings.push({
      severity: "error",
      topic: "execution-plane-selection",
      code: "execution-plane-selection-permission-denied",
      requiredPermission: selectionBoundary.requiredPermission,
      actor: selectionBoundary.actor,
      selectionMode
    });
  }

  if (requestContext.selectedPlaneId && !candidates.some((candidate) => candidate.planeId === requestContext.selectedPlaneId)) {
    findings.push({
      severity: "error",
      topic: "execution-plane-selection",
      code: "requested-selection-plane-not-visible",
      planeId: requestContext.selectedPlaneId
    });
  }
  const requestedCandidate = requestContext.selectedPlaneId
    ? candidates.find((candidate) => candidate.planeId === requestContext.selectedPlaneId)
    : null;
  if (requestedCandidate && !requestedCandidate.selectionEligible && !requestedCandidate.fallbackEligible) {
    findings.push({
      severity: primaryCandidates.length > 0 || fallbackCandidates.length > 0 ? "warn" : "error",
      topic: "execution-plane-selection",
      code: "requested-plane-kind-incompatible",
      planeId: requestedCandidate.planeId,
      selectedPlaneKind: requestedCandidate.executionPlaneKind,
      desiredPlaneKind,
      selectedReplacementPlaneId: selected?.planeId || null
    });
  }
  for (const candidate of candidates.filter((candidate) => (
    candidate.executionPlaneKind === desiredPlaneKind
    && candidate.lifecycleSelection?.reasons.length > 0
    && !candidate.selectionEligible
  ))) {
    findings.push({
      severity: candidate.lifecycleSelection.reasons.includes("provider-contract-not-ready") ? "error" : "warn",
      topic: "execution-plane-selection",
      code: selectionMode === "registry-control"
        ? "local-control-plane-lifecycle-blocked"
        : "worker-plane-lifecycle-blocked",
      planeId: candidate.planeId,
      commandId: candidate.lifecycleSelection.activeCommandId,
      commandAction: candidate.lifecycleSelection.commandAction,
      effectiveState: candidate.lifecycleSelection.effectiveState,
      effectiveSchedulingMode: candidate.lifecycleSelection.effectiveSchedulingMode,
      effectiveEnabled: candidate.lifecycleSelection.effectiveEnabled,
      reasons: candidate.lifecycleSelection.reasons,
      nextAction: candidate.lifecycleSelection.nextAction
    });
  }
  const boundaryRejectedControls = candidates
    .filter((candidate) => !candidate.boundaryEligible);
  for (const candidate of boundaryRejectedControls) {
    findings.push({
      severity: "warn",
      topic: "execution-plane-selection",
      code: candidate.executionPlaneKind === "local-control-plane"
        ? "local-control-plane-outside-selection-boundary"
        : "worker-plane-outside-selection-boundary",
      planeId: candidate.planeId,
      tenantId: candidate.tenantId,
      workspaceId: candidate.workspaceId,
      targetTenantId: selectionBoundary.targetTenantId,
      targetWorkspaceId: selectionBoundary.targetWorkspaceId,
      reasons: candidate.selectionBoundaryReasons
    });
  }
  if (selectionMode === "worker-dispatch" && primaryCandidates.length === 0) {
    findings.push({
      severity: fallbackCandidates.length > 0 ? "warn" : "error",
      topic: "execution-plane-selection",
      code: desiredPlaneKind === "hetzner-worker-plane"
        ? "hetzner-worker-plane-unavailable"
        : "requested-worker-plane-kind-unavailable",
      desiredPlaneKind,
      handoffPolicy: routingPolicy.handoffPolicy || "auto",
      fallbackPlaneIds: fallbackCandidates.map((candidate) => candidate.planeId)
    });
  }
  if (selectionMode === "worker-dispatch" && desiredPlaneKind === "hetzner-worker-plane" && !genericFallbackAllowed) {
    const genericWorkerCandidates = candidates.filter((candidate) => candidate.executionPlaneKind === "generic-worker-plane");
    if (genericWorkerCandidates.some((candidate) => candidate.canServeGenericWorker && candidate.boundaryEligible)) {
      findings.push({
        severity: primaryCandidates.length > 0 ? "info" : "error",
        topic: "execution-plane-selection",
        code: "generic-worker-fallback-suppressed-by-policy",
        handoffPolicy: routingPolicy.handoffPolicy || "strict-hetzner",
        genericWorkerPlaneIds: genericWorkerCandidates
          .filter((candidate) => candidate.canServeGenericWorker && candidate.boundaryEligible)
          .map((candidate) => candidate.planeId)
      });
    }
  }
  if (selectionMode === "registry-control" && primaryCandidates.length === 0) {
    findings.push({
      severity: "error",
      topic: "execution-plane-selection",
      code: "local-control-plane-unavailable"
    });
  }
  if (fallbackUsed) {
    findings.push({
      severity: "warn",
      topic: "execution-plane-selection",
      code: "execution-plane-selection-fallback-used",
      desiredPlaneKind,
      selectedPlaneKind: selected.executionPlaneKind,
      selectedPlaneId: selected.planeId
    });
  }
  if (!selected && operationalAdvisory.actionableError) {
    findings.push({
      severity: operationalAdvisory.state === "retryable-blocked" ? "warn" : "error",
      topic: "execution-plane-selection",
      code: operationalAdvisory.actionableError.code,
      planeId: operationalAdvisory.actionableError.planeId,
      action: operationalAdvisory.actionableError.action,
      retryAfterAt: operationalAdvisory.actionableError.retryAfterAt,
      reasons: operationalAdvisory.candidates
        .find((candidate) => candidate.planeId === operationalAdvisory.actionableError.planeId)
        ?.allReasons || []
    });
  }

  return {
    schema: "execution-plane-registry.execution-plane-selection.v1",
    generatedAt: now,
    requestId: requestContext.requestId,
    intent: requestContext.intent,
    selectionMode,
    desiredPlaneKind,
    routingPolicy: {
      schema: routingPolicy.schema || "execution-plane-registry.client-routing.v1",
      requestedPlaneKind,
      selectedPlaneKind: routingPolicy.selectedPlaneKind || null,
      requestedProviderId: routingPolicy.requestedProviderId || null,
      handoffPolicy: routingPolicy.handoffPolicy || "auto",
      allowGenericFallback: Boolean(routingPolicy.allowGenericFallback),
      requireFallbackConfirmation: Boolean(routingPolicy.requireFallbackConfirmation),
      genericFallbackAllowed
    },
    selectionBoundary,
    auditHandoff: selectionAuditHandoff,
    operationalAdvisory,
    state: selected
      ? fallbackUsed ? "fallback-selected" : "selected"
      : "blocked",
    selectedPlaneId: selected?.planeId || null,
    selectedProviderId: selected?.providerId || null,
    selectedPlaneKind: selected?.executionPlaneKind || null,
    selectedBy: selected?.requested
      ? "client-selected-plane"
      : selected?.domainMatch
        ? "domain-plane-kind-score"
        : selected ? "plane-kind-score" : "none",
    fallbackUsed,
    controlPlaneIds: candidates
      .filter((candidate) => candidate.executionPlaneKind === "local-control-plane")
      .map((candidate) => candidate.planeId),
    hetznerWorkerPlaneIds: candidates
      .filter((candidate) => candidate.executionPlaneKind === "hetzner-worker-plane")
      .map((candidate) => candidate.planeId),
    eligiblePlaneIds: primaryCandidates.map((candidate) => candidate.planeId),
    fallbackPlaneIds: fallbackCandidates.map((candidate) => candidate.planeId),
    candidates,
    findings,
    routePayload: {
      surfaceId,
      route: "scheduler.executionPlaneRegistry.executionPlaneSelection",
      action: selected
        ? fallbackUsed
          ? "route-to-generic-worker-fallback"
          : selectionMode === "worker-dispatch" ? "route-to-hetzner-worker-plane" : "route-to-local-control-plane"
        : "resolve-execution-plane-selection",
      requestId: requestContext.requestId,
      intent: requestContext.intent,
      selectionMode,
      desiredPlaneKind,
      routingPolicy: {
        requestedPlaneKind,
        requestedProviderId: routingPolicy.requestedProviderId || null,
        handoffPolicy: routingPolicy.handoffPolicy || "auto",
        genericFallbackAllowed,
        requireFallbackConfirmation: Boolean(routingPolicy.requireFallbackConfirmation)
      },
      planeId: selected?.planeId || null,
      providerId: selected?.providerId || null,
      providerContractId: selected?.providerContractId || null,
      providerService: selected?.providerService || null,
      operationalAdvisory: {
        schema: operationalAdvisory.schema,
        state: operationalAdvisory.state,
        primaryAction: operationalAdvisory.primaryAction,
        retryableBlockedPlaneIds: operationalAdvisory.retryableBlockedPlaneIds,
        degradedPlaneIds: operationalAdvisory.degradedPlaneIds,
        nextRetryAt: operationalAdvisory.nextRetryAt,
        actionableError: operationalAdvisory.actionableError
      },
      accessActor: accessBoundary.context.actor,
      auditHandoff: selectionAuditHandoff.handoffPayload,
      generatedAt: now
    }
  };
}

function buildDispatchReservationContract(
  requestContext,
  readiness,
  acceptance,
  planes,
  controls,
  providerNegotiations,
  executionPlaneSelection,
  accessBoundary,
  now
) {
  const planeById = new Map(planes.map((plane) => [plane.planeId, plane]));
  const negotiationByPlane = new Map(providerNegotiations.map((negotiation) => [negotiation.planeId, negotiation]));
  const dispatchSelectionRequired = requestContext.intent === "dispatch-continuation";
  const routingPolicy = requestContext.executionPlaneRouting || {};
  const desiredDispatchPlaneKind = executionPlaneSelection?.desiredPlaneKind || "hetzner-worker-plane";
  const selectedByExecutionPlane = dispatchSelectionRequired
    ? executionPlaneSelection?.selectedPlaneId || null
    : null;
  const selectionAllowsFallback = Boolean(executionPlaneSelection?.fallbackUsed);
  const acceptablePlaneKinds = dispatchSelectionRequired
    ? [
      desiredDispatchPlaneKind,
      ...(selectionAllowsFallback ? ["generic-worker-plane"] : [])
    ]
    : [];
  const selectionBlockedReasons = [];

  if (dispatchSelectionRequired && executionPlaneSelection?.state === "blocked") {
    selectionBlockedReasons.push("execution-plane-selection-blocked");
  }
  if (dispatchSelectionRequired && !selectedByExecutionPlane) {
    selectionBlockedReasons.push("execution-plane-selection-missing");
  }
  if (dispatchSelectionRequired && executionPlaneSelection?.auditHandoff?.permissionAllowed === false) {
    selectionBlockedReasons.push("execution-plane-selection-permission-denied");
  }

  const eligibleControls = controls
    .filter((control) => control.acceptsNewContinuations)
    .map((control) => {
      const plane = planeById.get(control.planeId);
      const domainMatch = plane?.domain === requestContext.domain;
      const selectedMatch = control.planeId === requestContext.selectedPlaneId;
      const selectionMatch = selectedByExecutionPlane
        ? control.planeId === selectedByExecutionPlane
        : false;
      const kindAllowed = !dispatchSelectionRequired
        || acceptablePlaneKinds.includes(plane?.executionPlaneKind);
      const availableSlots = Math.max(0, plane?.availableSlots || 0);
      const queuedContinuations = Math.max(0, plane?.queuedContinuations || 0);

      return {
        control,
        plane,
        domainMatch,
        selectedMatch,
        selectionMatch,
        kindAllowed,
        availableSlots,
        queuedContinuations,
        score: (selectionMatch ? 1000000 : 0)
          + (selectedMatch ? 100000 : 0)
          + (kindAllowed ? 50000 : 0)
          + (domainMatch ? 10000 : 0)
          + (availableSlots * 100)
          - queuedContinuations
      };
    })
    .filter((candidate) => {
      if (!candidate.plane) return false;
      if (!dispatchSelectionRequired) return true;
      return candidate.kindAllowed && (!selectedByExecutionPlane || candidate.selectionMatch);
    })
    .sort((left, right) => right.score - left.score || left.control.planeId.localeCompare(right.control.planeId));
  const selected = eligibleControls[0] || null;
  const selectedPlane = selected?.plane || null;
  const selectedControl = selected?.control || null;
  const selectedNegotiation = selectedPlane ? negotiationByPlane.get(selectedPlane.planeId) : null;
  const dispatchIntent = requestContext.intent === "dispatch-continuation";
  const fallbackConfirmationRequired = dispatchIntent
    && Boolean(executionPlaneSelection?.fallbackUsed)
    && (routingPolicy.requireFallbackConfirmation || requestContext.requiresUserConfirmation);
  const dispatchReady = dispatchIntent
    && Boolean(requestContext.continuationId)
    && acceptance.accepted
    && readiness.ready
    && Boolean(selectedPlane)
    && !fallbackConfirmationRequired;
  const blockedReasons = [];

  if (!dispatchIntent) blockedReasons.push("request-intent-not-dispatch");
  if (!requestContext.continuationId) blockedReasons.push("continuation-id-missing");
  if (!acceptance.accepted) blockedReasons.push("acceptance-not-granted");
  if (!readiness.ready) blockedReasons.push(`readiness-${readiness.state}`);
  if (!selectedPlane) blockedReasons.push("no-eligible-plane");
  if (fallbackConfirmationRequired) blockedReasons.push("worker-fallback-confirmation-required");
  blockedReasons.push(...selectionBlockedReasons);

  const rejectedDispatchCandidates = dispatchSelectionRequired
    ? controls
      .filter((control) => control.acceptsNewContinuations)
      .map((control) => {
        const plane = planeById.get(control.planeId);
        const reasons = [];
        if (!plane) reasons.push("plane-not-registered");
        if (plane && !acceptablePlaneKinds.includes(plane.executionPlaneKind)) {
          reasons.push(`kind-${plane.executionPlaneKind}-not-dispatchable`);
        }
        if (selectedByExecutionPlane && control.planeId !== selectedByExecutionPlane) {
          reasons.push("not-selected-by-execution-plane-routing");
        }
        return {
          planeId: control.planeId,
          executionPlaneKind: plane?.executionPlaneKind || null,
          reasons
        };
      })
      .filter((candidate) => candidate.reasons.length > 0)
    : [];

  return {
    schema: "execution-plane-registry.dispatch-reservation.v1",
    generatedAt: now,
    state: dispatchReady ? "reserved" : eligibleControls.length > 0 ? "preview-only" : "blocked",
    ready: dispatchReady,
    requestId: requestContext.requestId,
    continuationId: requestContext.continuationId,
    intent: requestContext.intent,
    requestedDomain: requestContext.domain,
    selectedPlaneId: selectedPlane?.planeId || null,
    selectedBy: selected?.selectionMatch
      ? "execution-plane-selection"
      : selected?.selectedMatch
        ? "client-selected-plane"
        : selected?.domainMatch
          ? "domain-capacity-score"
          : selectedPlane ? "capacity-score" : "none",
    selectedPlaneKind: selectedPlane?.executionPlaneKind || null,
    requiredPlaneKinds: acceptablePlaneKinds,
    handoffDecision: {
      schema: "execution-plane-registry.dispatch-handoff-decision.v1",
      handoffPolicy: routingPolicy.handoffPolicy || "auto",
      desiredPlaneKind: executionPlaneSelection?.desiredPlaneKind || null,
      selectedPlaneKind: executionPlaneSelection?.selectedPlaneKind || null,
      fallbackUsed: Boolean(executionPlaneSelection?.fallbackUsed),
      fallbackConfirmationRequired,
      strictHetzner: Boolean(routingPolicy.strictHetzner),
      allowGenericFallback: Boolean(routingPolicy.allowGenericFallback),
      providerId: selectedPlane?.providerId || null,
      providerContractId: selectedNegotiation?.contractId || null
    },
    executionPlaneSelection: dispatchSelectionRequired ? {
      state: executionPlaneSelection?.state || "missing",
      selectionMode: executionPlaneSelection?.selectionMode || "worker-dispatch",
      desiredPlaneKind: executionPlaneSelection?.desiredPlaneKind || "hetzner-worker-plane",
      selectedPlaneId: selectedByExecutionPlane,
      selectedPlaneKind: executionPlaneSelection?.selectedPlaneKind || null,
      fallbackUsed: Boolean(executionPlaneSelection?.fallbackUsed),
      auditHandoff: executionPlaneSelection?.auditHandoff ? {
        schema: executionPlaneSelection.auditHandoff.schema,
        state: executionPlaneSelection.auditHandoff.state,
        requiredPermission: executionPlaneSelection.auditHandoff.requiredPermission,
        permissionAllowed: executionPlaneSelection.auditHandoff.permissionAllowed,
        targetTenantId: executionPlaneSelection.auditHandoff.targetTenantId,
        targetWorkspaceId: executionPlaneSelection.auditHandoff.targetWorkspaceId,
        boundaryRejectedPlaneIds: executionPlaneSelection.auditHandoff.decision.boundaryRejectedPlaneIds
      } : null
    } : null,
    eligiblePlaneIds: eligibleControls.map((candidate) => candidate.control.planeId),
    rejectedDispatchCandidates,
    blockedReasons,
    reservation: selectedPlane ? {
      reservationId: `dispatch-reservation:${requestContext.requestId}:${selectedPlane.planeId}`,
      planeId: selectedPlane.planeId,
      tenantId: selectedPlane.tenantId,
      workspaceId: selectedPlane.workspaceId,
      providerId: selectedPlane.providerId,
      contractId: selectedNegotiation?.contractId || null,
      availableSlotsBeforeDispatch: selectedPlane.availableSlots,
      queuedContinuationsBeforeDispatch: selectedPlane.queuedContinuations,
      effectiveSchedulingMode: selectedControl.effectiveSchedulingMode,
      expiresAt: new Date((readTimeMs(now) ?? Date.now()) + 60000).toISOString()
    } : null,
    routePayload: {
      surfaceId,
      route: dispatchReady ? "scheduler.continuation.dispatch" : "scheduler.executionPlaneRegistry.preview",
      action: dispatchReady
        ? "reserve-and-dispatch-continuation"
        : fallbackConfirmationRequired ? "confirm-worker-plane-fallback" : "review-dispatch-blockers",
      requestId: requestContext.requestId,
      continuationId: requestContext.continuationId,
      planeId: selectedPlane?.planeId || null,
      planeKind: selectedPlane?.executionPlaneKind || null,
      selectionState: executionPlaneSelection?.state || null,
      selectionAuditHandoff: executionPlaneSelection?.auditHandoff?.handoffPayload || null,
      returnRoute: requestContext.returnRoute,
      blockedReasons,
      generatedAt: now
    },
    proofRefs: {
      accessActor: accessBoundary.context.actor,
      accessIsolationState: accessBoundary.isolationState,
      readinessState: readiness.state,
      acceptanceState: acceptance.state,
      executionPlaneSelectionState: executionPlaneSelection?.state || null,
      executionPlaneSelectionPlaneId: selectedByExecutionPlane,
      selectionAuditState: executionPlaneSelection?.auditHandoff?.state || null,
      selectionRequiredPermission: executionPlaneSelection?.auditHandoff?.requiredPermission || null,
      selectionPermissionAllowed: executionPlaneSelection?.auditHandoff?.permissionAllowed ?? null,
      requiredPlaneKinds: acceptablePlaneKinds,
      providerContractId: selectedNegotiation?.contractId || null,
      providerReady: selectedNegotiation?.ready ?? null,
      lifecycleCommandId: selectedControl?.commandId || null
    }
  };
}

function roundMetric(value, precision = 4) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(precision)) : 0;
}

function buildHistorySnapshots(inputHistory, currentSnapshot) {
  const normalizedHistory = asArray(inputHistory)
    .filter((snapshot) => snapshot && typeof snapshot === "object")
    .slice(-11)
    .map((snapshot, index) => ({
      snapshotId: typeof snapshot.snapshotId === "string" && snapshot.snapshotId.trim()
        ? snapshot.snapshotId.trim()
        : `history-${index + 1}`,
      capturedAt: typeof snapshot.capturedAt === "string" && snapshot.capturedAt.trim()
        ? snapshot.capturedAt
        : currentSnapshot.capturedAt,
      totalPlanes: Math.max(0, readNumber(snapshot.totalPlanes, 0)),
      readyPlanes: Math.max(0, readNumber(snapshot.readyPlanes, 0)),
      queuedContinuations: Math.max(0, readNumber(snapshot.queuedContinuations, 0)),
      failedContinuations: Math.max(0, readNumber(snapshot.failedContinuations, 0)),
      availableSlots: Math.max(0, readNumber(snapshot.availableSlots, 0)),
      leasedSlots: Math.max(0, readNumber(snapshot.leasedSlots, 0)),
      utilizationRatio: roundMetric(snapshot.utilizationRatio),
      failureRatio: roundMetric(snapshot.failureRatio),
      eligiblePlanes: Math.max(0, readNumber(snapshot.eligiblePlanes, 0)),
      blockedPlanes: Math.max(0, readNumber(snapshot.blockedPlanes, 0)),
      providerBlockedPlanes: Math.max(0, readNumber(snapshot.providerBlockedPlanes, 0)),
      selectionState: readText(snapshot.selectionState, "unknown"),
      selectedPlaneId: readText(snapshot.selectedPlaneId, null),
      selectedPlaneKind: readText(snapshot.selectedPlaneKind, null),
      localControlPlanes: Math.max(0, readNumber(snapshot.localControlPlanes, 0)),
      hetznerWorkerPlanes: Math.max(0, readNumber(snapshot.hetznerWorkerPlanes, 0)),
      selectionEligiblePlanes: Math.max(0, readNumber(snapshot.selectionEligiblePlanes, 0)),
      selectionRejectedPlanes: Math.max(0, readNumber(snapshot.selectionRejectedPlanes, 0)),
      selectionFallbacks: Math.max(0, readNumber(snapshot.selectionFallbacks, 0)),
      validationState: readText(snapshot.validationState, "unknown"),
      readinessState: readText(snapshot.readinessState, "unknown")
    }));

  return [
    ...normalizedHistory,
    currentSnapshot
  ];
}

function countValues(values) {
  return values.reduce((counts, value) => {
    const key = readText(value, "unknown");
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function buildSnapshotDelta(historySnapshots) {
  const current = historySnapshots[historySnapshots.length - 1] || {};
  const previous = historySnapshots.length > 1 ? historySnapshots[historySnapshots.length - 2] : null;

  if (!previous) {
    return {
      comparedTo: null,
      readyPlanes: 0,
      queuedContinuations: 0,
      failedContinuations: 0,
      availableSlots: 0,
      utilizationRatio: 0,
      failureRatio: 0,
      eligiblePlanes: 0,
      blockedPlanes: 0,
      providerBlockedPlanes: 0,
      localControlPlanes: 0,
      hetznerWorkerPlanes: 0,
      selectionEligiblePlanes: 0,
      selectionRejectedPlanes: 0,
      selectionFallbacks: 0
    };
  }

  return {
    comparedTo: previous.snapshotId,
    readyPlanes: current.readyPlanes - previous.readyPlanes,
    queuedContinuations: current.queuedContinuations - previous.queuedContinuations,
    failedContinuations: current.failedContinuations - previous.failedContinuations,
    availableSlots: current.availableSlots - previous.availableSlots,
    utilizationRatio: roundMetric(current.utilizationRatio - previous.utilizationRatio),
    failureRatio: roundMetric(current.failureRatio - previous.failureRatio),
    eligiblePlanes: current.eligiblePlanes - previous.eligiblePlanes,
    blockedPlanes: current.blockedPlanes - previous.blockedPlanes,
    providerBlockedPlanes: current.providerBlockedPlanes - previous.providerBlockedPlanes,
    localControlPlanes: (current.localControlPlanes || 0) - (previous.localControlPlanes || 0),
    hetznerWorkerPlanes: (current.hetznerWorkerPlanes || 0) - (previous.hetznerWorkerPlanes || 0),
    selectionEligiblePlanes: (current.selectionEligiblePlanes || 0) - (previous.selectionEligiblePlanes || 0),
    selectionRejectedPlanes: (current.selectionRejectedPlanes || 0) - (previous.selectionRejectedPlanes || 0),
    selectionFallbacks: (current.selectionFallbacks || 0) - (previous.selectionFallbacks || 0)
  };
}

function buildAnalyticsReport({
  counters,
  historySnapshots,
  controls,
  providerSummary,
  lifecycleCommands,
  executionPlaneSelection,
  selectionAnalytics,
  validationSummary,
  readiness,
  nextActions,
  now
}) {
  const current = historySnapshots[historySnapshots.length - 1] || {};
  const delta = buildSnapshotDelta(historySnapshots);
  const blockedReasonCounts = countValues(controls.flatMap((control) => control.blockedReasons));
  const failureHealthCounts = countValues(controls.map((control) => control.failureHealth?.state));
  const schedulingModeCounts = countValues(controls.map((control) => control.effectiveSchedulingMode));
  const readyRatio = counters.totalPlanes > 0 ? roundMetric((counters.byState.ready || 0) / counters.totalPlanes) : 0;
  const blockedPlaneCount = controls.filter((control) => !control.acceptsNewContinuations).length;
  const blockedRatio = counters.totalPlanes > 0 ? roundMetric(blockedPlaneCount / counters.totalPlanes) : 0;
  const backlogPerAvailableSlot = counters.availableSlots > 0
    ? roundMetric(counters.queuedContinuations / counters.availableSlots)
    : counters.queuedContinuations > 0 ? counters.queuedContinuations : 0;
  const criticalActions = nextActions.filter((action) => action.priority === "critical" || action.priority === "high");

  return {
    schema: "execution-plane-registry.analytics-report.v1",
    generatedAt: now,
    counters: {
      readyRatio,
      blockedRatio,
      backlogPerAvailableSlot,
      blockedReasonCounts,
      failureHealthCounts,
      schedulingModeCounts,
      providerReadyRatio: providerSummary.negotiatedPlanes > 0
        ? roundMetric(providerSummary.readyNegotiations / providerSummary.negotiatedPlanes)
        : 0,
      lifecycleCommandAcceptanceRatio: lifecycleCommands.length > 0
        ? roundMetric(lifecycleCommands.filter((command) => command.valid).length / lifecycleCommands.length)
        : 1,
      selectionCandidateCount: selectionAnalytics?.candidateCount || 0,
      selectionEligibleRatio: selectionAnalytics?.eligibleRatio || 0,
      selectionRejectedRatio: selectionAnalytics?.rejectedRatio || 0,
      selectionFallbackRatio: selectionAnalytics?.fallbackRatio || 0,
      localControlReadyRatio: selectionAnalytics?.localControlReadyRatio || 0,
      hetznerWorkerReadyRatio: selectionAnalytics?.hetznerWorkerReadyRatio || 0,
      selectionBlockedReasonCounts: selectionAnalytics?.blockedReasonCounts || {}
    },
    currentSnapshot: current,
    delta,
    trend: {
      readyCapacity: delta.readyPlanes > 0 ? "improving" : delta.readyPlanes < 0 ? "declining" : "flat",
      backlog: delta.queuedContinuations < 0 ? "improving" : delta.queuedContinuations > 0 ? "growing" : "flat",
      failures: delta.failureRatio < 0 ? "improving" : delta.failureRatio > 0 ? "worsening" : "flat",
      providerNegotiation: delta.providerBlockedPlanes < 0 ? "improving" : delta.providerBlockedPlanes > 0 ? "worsening" : "flat",
      planeSelection: delta.selectionEligiblePlanes > 0
        ? "improving"
        : delta.selectionRejectedPlanes > 0 || delta.selectionFallbacks > 0 ? "worsening" : "flat"
    },
    timeline: historySnapshots.map((snapshot) => ({
      at: snapshot.capturedAt,
      readyPlanes: snapshot.readyPlanes,
      eligiblePlanes: snapshot.eligiblePlanes,
      blockedPlanes: snapshot.blockedPlanes,
      queuedContinuations: snapshot.queuedContinuations,
      failedContinuations: snapshot.failedContinuations,
      utilizationRatio: snapshot.utilizationRatio,
      failureRatio: snapshot.failureRatio,
      readinessState: snapshot.readinessState,
      validationState: snapshot.validationState,
      selectionState: snapshot.selectionState || "unknown",
      selectedPlaneKind: snapshot.selectedPlaneKind || null,
      localControlPlanes: snapshot.localControlPlanes || 0,
      hetznerWorkerPlanes: snapshot.hetznerWorkerPlanes || 0,
      selectionEligiblePlanes: snapshot.selectionEligiblePlanes || 0,
      selectionRejectedPlanes: snapshot.selectionRejectedPlanes || 0,
      selectionFallbacks: snapshot.selectionFallbacks || 0
    })),
    selection: {
      schema: selectionAnalytics?.schema || "execution-plane-registry.selection-analytics.v1",
      state: selectionAnalytics?.state || executionPlaneSelection?.state || "unknown",
      mode: executionPlaneSelection?.selectionMode || "unknown",
      desiredPlaneKind: executionPlaneSelection?.desiredPlaneKind || null,
      selectedPlaneId: executionPlaneSelection?.selectedPlaneId || null,
      selectedPlaneKind: executionPlaneSelection?.selectedPlaneKind || null,
      selectedBy: executionPlaneSelection?.selectedBy || "none",
      fallbackUsed: Boolean(executionPlaneSelection?.fallbackUsed),
      counters: selectionAnalytics?.counters || {},
      ratios: selectionAnalytics?.ratios || {},
      blockedReasonCounts: selectionAnalytics?.blockedReasonCounts || {},
      providerCountsByKind: selectionAnalytics?.providerCountsByKind || {},
      timeline: historySnapshots.map((snapshot) => ({
        at: snapshot.capturedAt,
        state: snapshot.selectionState || "unknown",
        selectedPlaneKind: snapshot.selectedPlaneKind || null,
        selectedPlaneId: snapshot.selectedPlaneId || null,
        eligible: snapshot.selectionEligiblePlanes || 0,
        rejected: snapshot.selectionRejectedPlanes || 0,
        fallback: snapshot.selectionFallbacks || 0
      }))
    },
    reportState: {
      state: validationSummary.status === "blocked"
        ? "blocked"
        : selectionAnalytics?.state === "selection-blocked"
          ? "selection-blocked"
          : criticalActions.length > 0 ? "action-required" : readiness.state,
      headline: selectionAnalytics?.state === "selection-blocked"
        ? "execution-plane-selection-blocked"
        : criticalActions[0]?.action || (readiness.ready ? "registry-ready" : "registry-limited"),
      nextReportRoute: "scheduler.executionPlaneRegistry.analytics",
      exportable: historySnapshots.length > 0,
      generatedFromSnapshots: historySnapshots.length,
      selectionExportable: Boolean(selectionAnalytics)
    }
  };
}

function buildExecutionPlaneSelectionAnalytics(executionPlaneSelection, now) {
  const candidates = asArray(executionPlaneSelection?.candidates);
  const localControlCandidates = candidates.filter((candidate) => candidate.executionPlaneKind === "local-control-plane");
  const hetznerWorkerCandidates = candidates.filter((candidate) => candidate.executionPlaneKind === "hetzner-worker-plane");
  const genericWorkerCandidates = candidates.filter((candidate) => candidate.executionPlaneKind === "generic-worker-plane");
  const eligibleCandidates = candidates.filter((candidate) => candidate.selectionEligible);
  const fallbackCandidates = candidates.filter((candidate) => candidate.fallbackEligible);
  const boundaryRejectedCandidates = candidates.filter((candidate) => !candidate.boundaryEligible);
  const providerBlockedCandidates = candidates.filter((candidate) => !candidate.providerReady);
  const retryableCandidates = candidates.filter((candidate) => candidate.failureHealth?.backoffActive || candidate.failureHealth?.retryAfterAt);
  const selectionRejectedCandidates = candidates.filter((candidate) => !candidate.selectionEligible && !candidate.fallbackEligible);
  const blockedReasonCounts = countValues(selectionRejectedCandidates.flatMap((candidate) => [
    ...asArray(candidate.selectionBoundaryReasons),
    ...asArray(candidate.blockedReasons)
  ]));
  const providerCountsByKind = candidates.reduce((counts, candidate) => {
    const kind = readText(candidate.executionPlaneKind, "unknown");
    const provider = readText(candidate.providerId, "unknown");
    counts[kind] = counts[kind] || {};
    counts[kind][provider] = (counts[kind][provider] || 0) + 1;
    return counts;
  }, {});
  const localControlReadyCount = localControlCandidates.filter((candidate) => candidate.canServeControl).length;
  const hetznerWorkerReadyCount = hetznerWorkerCandidates.filter((candidate) => candidate.canServeWorker).length;
  const candidateCount = candidates.length;
  const selectedKind = executionPlaneSelection?.selectedPlaneKind || null;

  return {
    schema: "execution-plane-registry.selection-analytics.v1",
    generatedAt: now,
    state: executionPlaneSelection?.state === "blocked"
      ? "selection-blocked"
      : executionPlaneSelection?.fallbackUsed ? "fallback-selected" : "selected",
    mode: executionPlaneSelection?.selectionMode || "unknown",
    desiredPlaneKind: executionPlaneSelection?.desiredPlaneKind || null,
    selectedPlaneId: executionPlaneSelection?.selectedPlaneId || null,
    selectedPlaneKind: selectedKind,
    selectedBy: executionPlaneSelection?.selectedBy || "none",
    fallbackUsed: Boolean(executionPlaneSelection?.fallbackUsed),
    candidateCount,
    eligibleRatio: candidateCount > 0 ? roundMetric(eligibleCandidates.length / candidateCount) : 0,
    rejectedRatio: candidateCount > 0 ? roundMetric(selectionRejectedCandidates.length / candidateCount) : 0,
    fallbackRatio: candidateCount > 0 ? roundMetric(fallbackCandidates.length / candidateCount) : 0,
    localControlReadyRatio: localControlCandidates.length > 0
      ? roundMetric(localControlReadyCount / localControlCandidates.length)
      : 0,
    hetznerWorkerReadyRatio: hetznerWorkerCandidates.length > 0
      ? roundMetric(hetznerWorkerReadyCount / hetznerWorkerCandidates.length)
      : 0,
    counters: {
      localControlPlanes: localControlCandidates.length,
      localControlReadyPlanes: localControlReadyCount,
      hetznerWorkerPlanes: hetznerWorkerCandidates.length,
      hetznerWorkerReadyPlanes: hetznerWorkerReadyCount,
      genericWorkerPlanes: genericWorkerCandidates.length,
      eligiblePlanes: eligibleCandidates.length,
      fallbackPlanes: fallbackCandidates.length,
      rejectedPlanes: selectionRejectedCandidates.length,
      boundaryRejectedPlanes: boundaryRejectedCandidates.length,
      providerBlockedPlanes: providerBlockedCandidates.length,
      retryablePlanes: retryableCandidates.length
    },
    ratios: {
      eligibleRatio: candidateCount > 0 ? roundMetric(eligibleCandidates.length / candidateCount) : 0,
      rejectedRatio: candidateCount > 0 ? roundMetric(selectionRejectedCandidates.length / candidateCount) : 0,
      fallbackRatio: candidateCount > 0 ? roundMetric(fallbackCandidates.length / candidateCount) : 0,
      localControlReadyRatio: localControlCandidates.length > 0
        ? roundMetric(localControlReadyCount / localControlCandidates.length)
        : 0,
      hetznerWorkerReadyRatio: hetznerWorkerCandidates.length > 0
        ? roundMetric(hetznerWorkerReadyCount / hetznerWorkerCandidates.length)
        : 0
    },
    blockedReasonCounts,
    providerCountsByKind,
    exportRow: {
      state: executionPlaneSelection?.state || "unknown",
      mode: executionPlaneSelection?.selectionMode || "unknown",
      desiredPlaneKind: executionPlaneSelection?.desiredPlaneKind || null,
      selectedPlaneId: executionPlaneSelection?.selectedPlaneId || null,
      selectedPlaneKind: selectedKind,
      selectedBy: executionPlaneSelection?.selectedBy || "none",
      fallbackUsed: Boolean(executionPlaneSelection?.fallbackUsed),
      candidateCount,
      eligibleCandidates: eligibleCandidates.length,
      rejectedCandidates: selectionRejectedCandidates.length,
      generatedAt: now
    }
  };
}

function buildProviderSummary(providerContracts, negotiations) {
  const providers = new Set(providerContracts.map((contract) => contract.providerId));
  const readyNegotiations = negotiations.filter((negotiation) => negotiation.ready);
  const externalHandoffs = negotiations.filter((negotiation) => negotiation.externalHandoff.required);

  return {
    registeredProviders: providers.size,
    contracts: providerContracts.length,
    negotiatedPlanes: negotiations.length,
    readyNegotiations: readyNegotiations.length,
    blockedNegotiations: negotiations.length - readyNegotiations.length,
    externalHandoffs: externalHandoffs.length,
    acceptedExternalHandoffs: externalHandoffs.filter((negotiation) => negotiation.externalHandoff.accepted).length,
    staleSyncContracts: providerContracts.filter((contract) => contract.sync.stale).length
  };
}

function buildAudit(planes, counters, lifecycleFindings = [], providerContracts = [], providerNegotiations = [], controls = []) {
  const findings = [...lifecycleFindings];
  const seenPlaneIds = new Set();
  const seenContractIds = new Set();
  const controlByPlane = new Map(controls.map((control) => [control.planeId, control]));

  for (const plane of planes) {
    if (seenPlaneIds.has(plane.planeId)) {
      findings.push({ severity: "error", code: "duplicate-plane-id", planeId: plane.planeId });
    }
    seenPlaneIds.add(plane.planeId);

    if (plane.leasedSlots > plane.capacity) {
      findings.push({ severity: "error", code: "leased-slots-exceed-capacity", planeId: plane.planeId });
    }
    if (plane.state === "ready" && !plane.lastHeartbeatAt) {
      findings.push({ severity: "warn", code: "ready-plane-missing-heartbeat", planeId: plane.planeId });
    }
    if (plane.owner === "unassigned") {
      findings.push({ severity: "warn", code: "plane-owner-unassigned", planeId: plane.planeId });
    }
    const control = controlByPlane.get(plane.planeId);
    if (control?.failureHealth?.blockReasons.includes("invalid-retry-after")) {
      findings.push({ severity: "error", code: "invalid-retry-after", planeId: plane.planeId, received: plane.failureState.retryAfterAt });
    }
    if (control?.failureHealth?.degradationReasons.includes("invalid-last-failure-at")) {
      findings.push({ severity: "warn", code: "invalid-last-failure-at", planeId: plane.planeId, received: plane.failureState.lastFailureAt });
    }
    if (control?.failureHealth?.blockReasons.includes("retry-attempts-exhausted")) {
      findings.push({
        severity: "error",
        code: "plane-retry-attempts-exhausted",
        planeId: plane.planeId,
        retryAttempts: control.failureHealth.retryAttempts
      });
    }
  }

  for (const contract of providerContracts) {
    if (seenContractIds.has(contract.contractId)) {
      findings.push({ severity: "error", code: "duplicate-provider-contract-id", contractId: contract.contractId });
    }
    seenContractIds.add(contract.contractId);

    if (contract.requiredCapabilities.length === 0) {
      findings.push({ severity: "warn", code: "provider-contract-without-required-capabilities", contractId: contract.contractId });
    }
  }

  for (const negotiation of providerNegotiations) {
    if (!negotiation.ready && negotiation.missingCapabilities.length === 0 && negotiation.externalHandoff.accepted && negotiation.sync.aligned) {
      findings.push({
        severity: "warn",
        code: "provider-negotiation-blocked-by-sync-or-handoff-state",
        planeId: negotiation.planeId,
        providerId: negotiation.providerId
      });
    }
  }

  if (counters.totalPlanes === 0) {
    findings.push({ severity: "warn", code: "empty-execution-plane-registry" });
  }

  return {
    checkedPlanes: counters.totalPlanes,
    blockingFindings: findings.filter((finding) => finding.severity === "error").length,
    findings
  };
}

export function describeExecutionPlaneRegistrySurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const { settings: lifecycleSettings, findings: settingsFindings } = normalizeLifecycleSettings(
    input.lifecycleSettings ?? input.settings
  );
  const persistedState = normalizePersistedRegistryState(input, now);
  const allLifecycleCommands = selectLifecycleCommands(input, now);
  const allPlanes = asArray(input.executionPlanes ?? input.planes)
    .filter((plane) => plane && typeof plane === "object")
    .map((plane, index) => normalizePlane(plane, index, now, lifecycleSettings.defaultSchedulingMode));
  const accessContext = normalizeAccessContext(input, now);
  const accessBoundary = evaluateAccessBoundary(allPlanes, allLifecycleCommands, accessContext, now);
  const lifecycleCommands = accessBoundary.visibleCommands;
  const planes = accessBoundary.visiblePlanes;
  const recovery = buildPersistenceRecovery(planes, lifecycleCommands, persistedState, lifecycleSettings, now);
  const providerContracts = selectProviderContracts(input, now, planes);
  const providerNegotiation = buildProviderNegotiation(planes, providerContracts, now);
  const providerSummary = buildProviderSummary(providerContracts, providerNegotiation.negotiations);
  const counters = summarizePlanes(planes);
  const utilizationRatio = counters.totalCapacity > 0
    ? Number((counters.leasedSlots / counters.totalCapacity).toFixed(4))
    : 0;
  const failureRatio = counters.completedContinuations + counters.failedContinuations > 0
    ? Number((counters.failedContinuations / (counters.completedContinuations + counters.failedContinuations)).toFixed(4))
    : 0;
  const lifecycle = buildLifecycleControls(
    planes,
    lifecycleCommands,
    lifecycleSettings,
    now,
    providerNegotiation.negotiations,
    persistedState
  );
  const clientRequest = normalizeClientRequestContext(input, now);
  const clientRequestFindings = validateClientRequestContext(clientRequest, planes, lifecycle.controls);
  const nextActions = buildNextActions(
    planes,
    lifecycle.controls,
    lifecycleSettings,
    providerNegotiation.negotiations,
    recovery
  );
  const operationalHealth = buildOperationalHealthContract({
    planes,
    controls: lifecycle.controls,
    providerNegotiations: providerNegotiation.negotiations,
    lifecycleSettings,
    recovery,
    accessBoundary,
    now
  });
  const executionPlaneSelection = buildExecutionPlaneSelectionContract({
    requestContext: clientRequest,
    planes,
    controls: lifecycle.controls,
    providerNegotiations: providerNegotiation.negotiations,
    accessBoundary,
    now
  });
  const audit = buildAudit(planes, counters, [
    ...settingsFindings,
    ...persistedState.findings,
    ...accessBoundary.findings,
    ...lifecycle.findings,
    ...providerNegotiation.findings,
    ...clientRequestFindings,
    ...operationalHealth.findings,
    ...executionPlaneSelection.findings
  ], providerContracts, providerNegotiation.negotiations, lifecycle.controls);
  const validationSummary = buildValidationSummary(
    audit,
    providerNegotiation,
    lifecycle,
    settingsFindings,
    operationalHealth,
    executionPlaneSelection
  );
  const readiness = buildReadinessContract(counters, lifecycleSettings, lifecycle.controls, providerSummary, audit, recovery);
  const preview = buildPreviewContract(
    planes,
    lifecycle.controls,
    providerNegotiation.negotiations,
    counters,
    readiness,
    nextActions,
    now,
    executionPlaneSelection
  );
  const acceptance = buildAcceptanceContract(
    readiness,
    validationSummary,
    lifecycleSettings,
    providerSummary,
    nextActions,
    now,
    executionPlaneSelection
  );
  const nextStepContracts = buildNextStepContracts(nextActions, lifecycle.controls, providerNegotiation.negotiations, now);
  const selectionAnalytics = buildExecutionPlaneSelectionAnalytics(executionPlaneSelection, now);
  const currentSnapshot = {
    snapshotId: `${surfaceName}:${now}`,
    capturedAt: now,
    totalPlanes: counters.totalPlanes,
    readyPlanes: counters.byState.ready || 0,
    queuedContinuations: counters.queuedContinuations,
    failedContinuations: counters.failedContinuations,
    availableSlots: counters.availableSlots,
    leasedSlots: counters.leasedSlots,
    utilizationRatio,
    failureRatio,
    eligiblePlanes: lifecycle.controls.filter((control) => control.acceptsNewContinuations).length,
    blockedPlanes: lifecycle.controls.filter((control) => !control.acceptsNewContinuations).length,
    providerBlockedPlanes: providerSummary.blockedNegotiations,
    selectionState: executionPlaneSelection.state,
    selectedPlaneId: executionPlaneSelection.selectedPlaneId,
    selectedPlaneKind: executionPlaneSelection.selectedPlaneKind,
    localControlPlanes: selectionAnalytics.counters.localControlPlanes,
    hetznerWorkerPlanes: selectionAnalytics.counters.hetznerWorkerPlanes,
    selectionEligiblePlanes: selectionAnalytics.counters.eligiblePlanes,
    selectionRejectedPlanes: selectionAnalytics.counters.rejectedPlanes,
    selectionFallbacks: executionPlaneSelection.fallbackUsed ? 1 : 0,
    validationState: validationSummary.status,
    readinessState: readiness.state
  };
  const historySnapshots = buildHistorySnapshots(input.historySnapshots ?? input.history, currentSnapshot);
  const workflowHandoff = buildWorkflowHandoffContract(
    clientRequest,
    readiness,
    acceptance,
    preview,
    nextStepContracts,
    lifecycle.controls,
    providerNegotiation.negotiations,
    executionPlaneSelection,
    now
  );
  const dispatchReservation = buildDispatchReservationContract(
    clientRequest,
    readiness,
    acceptance,
    planes,
    lifecycle.controls,
    providerNegotiation.negotiations,
    executionPlaneSelection,
    accessBoundary,
    now
  );
  const analytics = buildAnalyticsReport({
    counters: {
      ...counters,
      utilizationRatio,
      failureRatio
    },
    historySnapshots,
    controls: lifecycle.controls,
    providerSummary,
    lifecycleCommands,
    executionPlaneSelection,
    selectionAnalytics,
    validationSummary,
    readiness,
    nextActions,
    now
  });
  const activeLifecycleEffects = lifecycle.controls
    .map((control) => control.commandEffect)
    .filter((effect) => effect?.commandId);
  const lifecycleMutationCount = activeLifecycleEffects
    .reduce((count, effect) => count + effect.mutations.length, 0);

  return {
    ok: audit.blockingFindings === 0,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: EXPORT_SCHEMA_VERSION,
    preview,
    acceptance,
    workflowHandoff,
    dispatchReservation,
    executionPlaneSelection,
    selectionAnalytics,
    operationalHealth,
    readiness,
    validation: validationSummary,
    registry: {
      planes,
      counters: {
        ...counters,
        utilizationRatio,
        failureRatio
      }
    },
    access: {
      context: accessBoundary.context,
      boundary: {
        schema: accessBoundary.schema,
        isolationState: accessBoundary.isolationState,
        evaluatedAt: accessBoundary.evaluatedAt,
        scopedPlanes: accessBoundary.scopedPlanes,
        scopedCommands: accessBoundary.scopedCommands,
        deniedPlanes: accessBoundary.deniedPlanes,
        deniedCommandIds: accessBoundary.deniedCommandIds
      }
    },
    persistence: {
      state: {
        schema: persistedState.schema,
        loaded: persistedState.loaded,
        recoveryMode: persistedState.recoveryMode,
        restartId: persistedState.restartId,
        epoch: persistedState.epoch,
        lastPersistedAt: persistedState.lastPersistedAt,
        planeStates: persistedState.planeStates,
        commandReceipts: persistedState.commandReceipts,
        receiptConflicts: persistedState.receiptConflicts
      },
      recovery
    },
    analytics,
    lifecycle: {
      settings: lifecycleSettings,
      commands: lifecycleCommands,
      controls: lifecycle.controls,
      commandEffects: activeLifecycleEffects,
      commandPlan: lifecycle.commandPlan,
      commandSummary: {
        received: lifecycleCommands.length,
        accepted: lifecycleCommands.filter((command) => command.valid).length,
        rejected: lifecycleCommands.filter((command) => !command.valid).length,
        active: lifecycle.commandPlan.active.length,
        pending: lifecycle.commandPlan.pending.length,
        expired: lifecycle.commandPlan.expired.length,
        effects: activeLifecycleEffects.length,
        mutations: lifecycleMutationCount,
        noOpEffects: activeLifecycleEffects.filter((effect) => effect.state === "no-op").length,
        dispatchBlockingEffects: activeLifecycleEffects
          .filter((effect) => !effect.dispatchPolicy.acceptsNewContinuations)
          .length
      }
    },
    providers: {
      contracts: providerContracts,
      negotiations: providerNegotiation.negotiations,
      summary: providerSummary
    },
    scheduling: {
      eligiblePlaneIds: lifecycle.controls
        .filter((control) => control.acceptsNewContinuations)
        .map((control) => control.planeId),
      blockedPlaneIds: lifecycle.controls
        .filter((control) => !control.acceptsNewContinuations)
        .map((control) => control.planeId),
      clientRequest,
      executionPlaneSelection,
      workflowHandoff,
      dispatchReservation,
      nextActions,
      nextStepContracts
    },
    history: {
      retainedSnapshots: historySnapshots.length,
      snapshots: historySnapshots,
      timeline: analytics.timeline,
      delta: analytics.delta,
      trend: analytics.trend,
      reportState: analytics.reportState
    },
    exports: {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      generatedAt: now,
      summary: {
        totalPlanes: counters.totalPlanes,
        readyPlanes: counters.byState.ready || 0,
        degradedPlanes: counters.byState.degraded || 0,
        drainingPlanes: counters.byState.draining || 0,
        offlinePlanes: counters.byState.offline || 0,
        utilizationRatio,
        queuedContinuations: counters.queuedContinuations,
        failureRatio,
        eligiblePlanes: lifecycle.controls.filter((control) => control.acceptsNewContinuations).length,
        blockedPlanes: lifecycle.controls.filter((control) => !control.acceptsNewContinuations).length,
        registeredProviders: providerSummary.registeredProviders,
        providerContracts: providerSummary.contracts,
        providerBlockedPlanes: providerSummary.blockedNegotiations,
        failureBlockedPlanes: lifecycle.controls.filter((control) => control.failureHealth?.state === "blocked").length,
        degradedModePlanes: lifecycle.controls.filter((control) => control.failureHealth?.degradedModeActive).length,
        operationalHealthState: operationalHealth.state,
        operationalHealthIncidents: operationalHealth.visibleIncidents,
        operationalHealthBlockedPlanes: operationalHealth.blockedPlaneIds.length,
        retryBackoffPlanes: operationalHealth.retryBackoffPlaneIds.length,
        externalHandoffs: providerSummary.externalHandoffs,
        pendingLifecycleCommands: lifecycleCommands.length,
        activeLifecycleCommands: lifecycle.commandPlan.active.length,
        lifecycleCommandEffects: activeLifecycleEffects.length,
        lifecycleCommandMutations: lifecycleMutationCount,
        alreadyAppliedLifecycleCommands: recovery.alreadyAppliedCommandIds.length,
        replayableLifecycleCommands: recovery.replayableCommandIds.length,
        conflictingLifecycleCommands: recovery.conflictingCommandIds.length,
        persistedCommandReceiptConflicts: recovery.receiptConflicts.length,
        scheduledLifecycleCommands: lifecycle.commandPlan.pending.length,
        expiredLifecycleCommands: lifecycle.commandPlan.expired.length,
        recoveryMode: recovery.recoveryMode,
        restartSafe: recovery.restartSafe,
        pendingRecoveryRefreshPlanes: recovery.pendingRefreshPlaneIds.length,
        orphanedPersistedPlanes: recovery.orphanedPersistedPlanes.length,
        scopedTenantCount: Object.keys(counters.byTenant).length,
        scopedWorkspaceCount: Object.keys(counters.byWorkspace).length,
        accessIsolationState: accessBoundary.isolationState,
        accessDeniedPlanes: accessBoundary.deniedPlanes.length,
        accessDeniedCommands: accessBoundary.deniedCommandIds.length,
        clientRequestIntent: clientRequest.intent,
        clientRequestedPlaneKind: clientRequest.executionPlaneRouting.requestedPlaneKind,
        clientSelectedPlaneKind: clientRequest.executionPlaneRouting.selectedPlaneKind,
        clientHandoffPolicy: clientRequest.executionPlaneRouting.handoffPolicy,
        clientGenericFallbackAllowed: clientRequest.executionPlaneRouting.allowGenericFallback,
        executionPlaneSelectionState: executionPlaneSelection.state,
        executionPlaneSelectionMode: executionPlaneSelection.selectionMode,
        executionPlaneSelectedPlaneId: executionPlaneSelection.selectedPlaneId,
        executionPlaneSelectedKind: executionPlaneSelection.selectedPlaneKind,
        executionPlaneSelectionDesiredKind: executionPlaneSelection.desiredPlaneKind,
        executionPlaneSelectionHandoffPolicy: executionPlaneSelection.routingPolicy.handoffPolicy,
        executionPlaneSelectionFallbackConfirmationRequired: executionPlaneSelection.routingPolicy.requireFallbackConfirmation,
        executionPlaneSelectionAuditState: executionPlaneSelection.auditHandoff.state,
        executionPlaneSelectionPermissionAllowed: executionPlaneSelection.auditHandoff.permissionAllowed,
        executionPlaneSelectionBoundaryRejectedPlanes: executionPlaneSelection.auditHandoff.decision.boundaryRejectedPlaneIds.length,
        localControlPlanes: executionPlaneSelection.controlPlaneIds.length,
        hetznerWorkerPlanes: executionPlaneSelection.hetznerWorkerPlaneIds.length,
        executionPlaneSelectionFallbackUsed: executionPlaneSelection.fallbackUsed,
        selectionCandidateCount: selectionAnalytics.candidateCount,
        selectionEligiblePlanes: selectionAnalytics.counters.eligiblePlanes,
        selectionRejectedPlanes: selectionAnalytics.counters.rejectedPlanes,
        selectionFallbackPlanes: selectionAnalytics.counters.fallbackPlanes,
        selectionBoundaryRejectedPlanes: selectionAnalytics.counters.boundaryRejectedPlanes,
        selectionProviderBlockedPlanes: selectionAnalytics.counters.providerBlockedPlanes,
        selectionRetryablePlanes: selectionAnalytics.counters.retryablePlanes,
        localControlReadyPlanes: selectionAnalytics.counters.localControlReadyPlanes,
        hetznerWorkerReadyPlanes: selectionAnalytics.counters.hetznerWorkerReadyPlanes,
        localControlReadyRatio: selectionAnalytics.localControlReadyRatio,
        hetznerWorkerReadyRatio: selectionAnalytics.hetznerWorkerReadyRatio,
        selectionEligibleRatio: selectionAnalytics.eligibleRatio,
        selectionRejectedRatio: selectionAnalytics.rejectedRatio,
        workflowHandoffState: workflowHandoff.state,
        workflowSelectedPlaneId: workflowHandoff.selectedPlaneId,
        workflowHandoffPolicy: workflowHandoff.handoffDecision.handoffPolicy,
        workflowFallbackConfirmationRequired: workflowHandoff.handoffDecision.fallbackConfirmationRequired,
        dispatchReservationState: dispatchReservation.state,
        dispatchReservedPlaneId: dispatchReservation.selectedPlaneId,
        dispatchHandoffPolicy: dispatchReservation.handoffDecision.handoffPolicy,
        dispatchFallbackConfirmationRequired: dispatchReservation.handoffDecision.fallbackConfirmationRequired,
        previewSelectionState: preview.selectionDecision.state,
        previewSelectionSelectedPlaneId: preview.selectionDecision.selectedPlaneId,
        previewSelectionSelectedKind: preview.selectionDecision.selectedPlaneKind,
        previewSelectionFallbackUsed: preview.selectionDecision.fallbackUsed,
        acceptanceSelectedPlaneId: acceptance.routePayload.selectedPlaneId,
        acceptanceSelectedPlaneKind: acceptance.routePayload.selectedPlaneKind,
        readyRatio: analytics.counters.readyRatio,
        blockedRatio: analytics.counters.blockedRatio,
        backlogPerAvailableSlot: analytics.counters.backlogPerAvailableSlot,
        analyticsReportState: analytics.reportState.state,
        analyticsHeadline: analytics.reportState.headline
      },
      analyticsSummary: {
        schema: analytics.schema,
        generatedAt: analytics.generatedAt,
        counters: analytics.counters,
        delta: analytics.delta,
        trend: analytics.trend,
        selection: analytics.selection,
        reportState: analytics.reportState
      },
      selectionSummary: {
        schema: selectionAnalytics.schema,
        generatedAt: selectionAnalytics.generatedAt,
        state: selectionAnalytics.state,
        mode: selectionAnalytics.mode,
        desiredPlaneKind: selectionAnalytics.desiredPlaneKind,
        selectedPlaneId: selectionAnalytics.selectedPlaneId,
        selectedPlaneKind: selectionAnalytics.selectedPlaneKind,
        selectedBy: selectionAnalytics.selectedBy,
        fallbackUsed: selectionAnalytics.fallbackUsed,
        counters: selectionAnalytics.counters,
        ratios: selectionAnalytics.ratios,
        blockedReasonCounts: selectionAnalytics.blockedReasonCounts,
        providerCountsByKind: selectionAnalytics.providerCountsByKind,
        row: selectionAnalytics.exportRow
      },
      operationalHealth: {
        schema: operationalHealth.schema,
        generatedAt: operationalHealth.generatedAt,
        state: operationalHealth.state,
        blockedPlaneIds: operationalHealth.blockedPlaneIds,
        degradedPlaneIds: operationalHealth.degradedPlaneIds,
        retryBackoffPlaneIds: operationalHealth.retryBackoffPlaneIds,
        incidents: operationalHealth.incidents.map((incident) => ({
          incidentId: incident.incidentId,
          planeId: incident.planeId,
          severity: incident.severity,
          state: incident.state,
          action: incident.action,
          blockedReasons: incident.blockedReasons,
          retry: incident.retry,
          userVisibleMessage: incident.userVisibleMessage
        }))
      },
      timeline: analytics.timeline,
      rows: planes.map((plane) => ({
        planeId: plane.planeId,
        tenantId: plane.tenantId,
        workspaceId: plane.workspaceId,
        domain: plane.domain,
        state: plane.state,
        owner: plane.owner,
        region: plane.region,
        dataResidency: plane.dataResidency,
        boundaryTags: plane.boundaryTags,
        enabled: plane.enabled,
        schedulingMode: plane.schedulingMode,
        allowNewContinuations: plane.allowNewContinuations,
        providerId: plane.providerId,
        executionPlaneKind: plane.executionPlaneKind,
        controlPlane: plane.controlPlane,
        workerPlane: plane.workerPlane,
        capabilities: plane.capabilities,
        handoffState: plane.handoffState,
        handoffTarget: plane.handoffTarget,
        syncWatermark: plane.syncWatermark,
        providerNegotiation: providerNegotiation.negotiations.find((negotiation) => negotiation.planeId === plane.planeId) || null,
        ...lifecycle.controls.find((control) => control.planeId === plane.planeId),
        capacity: plane.capacity,
        leasedSlots: plane.leasedSlots,
        availableSlots: plane.availableSlots,
        queuedContinuations: plane.queuedContinuations,
        completedContinuations: plane.completedContinuations,
        failedContinuations: plane.failedContinuations,
        failureState: plane.failureState,
        failureHealth: lifecycle.controls.find((control) => control.planeId === plane.planeId)?.failureHealth || null,
        lastHeartbeatAt: plane.lastHeartbeatAt
      }))
    },
    audit,
    proof: {
      source: "hosted-kernel execution-plane registry",
      planeCount: counters.totalPlanes,
      snapshotCount: historySnapshots.length,
      exportSchemaVersion: EXPORT_SCHEMA_VERSION,
      lifecycleCommands: lifecycleCommands.length,
      activeLifecycleCommands: lifecycle.commandPlan.active.length,
      lifecycleCommandEffects: activeLifecycleEffects.map((effect) => ({
        commandId: effect.commandId,
        action: effect.action,
        state: effect.state,
        mutationFields: effect.mutations.map((mutation) => mutation.field),
        dispatchPolicy: effect.dispatchPolicy,
        proofReasons: effect.proof.proofReasons
      })),
      lifecycleCommandMutations: lifecycleMutationCount,
      scheduledLifecycleCommands: lifecycle.commandPlan.pending.length,
      expiredLifecycleCommands: lifecycle.commandPlan.expired.length,
      providerContracts: providerContracts.length,
      providerNegotiationsReady: providerSummary.readyNegotiations,
      externalHandoffsAccepted: providerSummary.acceptedExternalHandoffs,
      schedulablePlanes: lifecycle.controls.filter((control) => control.acceptsNewContinuations).length,
      restartId: recovery.restartId,
      recoveryMode: recovery.recoveryMode,
      restartSafe: recovery.restartSafe,
      recoveredPlanes: recovery.recoveredPlanes.length,
      alreadyAppliedCommandIds: recovery.alreadyAppliedCommandIds,
      replayableCommandIds: recovery.replayableCommandIds,
      conflictingCommandIds: recovery.conflictingCommandIds,
      persistedCommandReceiptConflicts: recovery.receiptConflicts.length,
      pendingRecoveryRefreshPlaneIds: recovery.pendingRefreshPlaneIds,
      accessActor: accessBoundary.context.actor,
      accessRoles: accessBoundary.context.roles,
      accessTenantScope: accessBoundary.context.tenantScope,
      accessWorkspaceScope: accessBoundary.context.workspaceScope,
      accessIsolationState: accessBoundary.isolationState,
      accessScopedPlanes: accessBoundary.scopedPlanes,
      accessDeniedCommands: accessBoundary.deniedCommandIds,
      failureBlockedPlanes: lifecycle.controls.filter((control) => control.failureHealth?.state === "blocked").length,
      degradedModePlanes: lifecycle.controls.filter((control) => control.failureHealth?.degradedModeActive).length,
      operationalHealthState: operationalHealth.state,
      operationalHealthIncidents: operationalHealth.visibleIncidents,
      operationalHealthBlockedPlaneIds: operationalHealth.blockedPlaneIds,
      retryBackoffPlaneIds: operationalHealth.retryBackoffPlaneIds,
      analyticsReportState: analytics.reportState.state,
      analyticsSnapshotDelta: analytics.delta,
      selectionAnalyticsState: selectionAnalytics.state,
      selectionAnalyticsCounters: selectionAnalytics.counters,
      selectionAnalyticsRatios: selectionAnalytics.ratios,
      selectionBlockedReasonCounts: selectionAnalytics.blockedReasonCounts,
      nextActionCount: nextActions.length,
      clientRequestId: clientRequest.requestId,
      clientHandoffPolicy: clientRequest.executionPlaneRouting.handoffPolicy,
      clientRequestedPlaneKind: clientRequest.executionPlaneRouting.requestedPlaneKind,
      executionPlaneSelectionState: executionPlaneSelection.state,
      executionPlaneSelectionMode: executionPlaneSelection.selectionMode,
      executionPlaneSelectedPlaneId: executionPlaneSelection.selectedPlaneId,
      executionPlaneSelectedKind: executionPlaneSelection.selectedPlaneKind,
      executionPlaneSelectionDesiredKind: executionPlaneSelection.desiredPlaneKind,
      executionPlaneRoutingPolicy: executionPlaneSelection.routingPolicy,
      executionPlaneSelectionAuditState: executionPlaneSelection.auditHandoff.state,
      executionPlaneSelectionRequiredPermission: executionPlaneSelection.auditHandoff.requiredPermission,
      executionPlaneSelectionPermissionAllowed: executionPlaneSelection.auditHandoff.permissionAllowed,
      executionPlaneSelectionBoundaryRejectedPlaneIds: executionPlaneSelection.auditHandoff.decision.boundaryRejectedPlaneIds,
      localControlPlaneIds: executionPlaneSelection.controlPlaneIds,
      hetznerWorkerPlaneIds: executionPlaneSelection.hetznerWorkerPlaneIds,
      workflowHandoffState: workflowHandoff.state,
      workflowPrimaryRoute: workflowHandoff.primaryRoute.route,
      workflowHandoffDecision: workflowHandoff.handoffDecision,
      dispatchReservationState: dispatchReservation.state,
      dispatchReservationReady: dispatchReservation.ready,
      dispatchReservationPlaneId: dispatchReservation.selectedPlaneId,
      dispatchHandoffDecision: dispatchReservation.handoffDecision
    },
    routeContracts: {
      preview: {
        route: "scheduler.executionPlaneRegistry.preview",
        schema: "execution-plane-registry.preview.v1",
        generatedAt: now,
        summary: preview.summary,
        selectionDecision: {
          schema: preview.selectionDecision.schema,
          route: preview.selectionDecision.routePayload.route,
          state: preview.selectionDecision.state,
          selectionMode: preview.selectionDecision.selectionMode,
          desiredPlaneKind: preview.selectionDecision.desiredPlaneKind,
          selectedPlaneId: preview.selectionDecision.selectedPlaneId,
          selectedPlaneKind: preview.selectionDecision.selectedPlaneKind,
          fallbackUsed: preview.selectionDecision.fallbackUsed,
          primaryDecisionLabel: preview.selectionDecision.primaryDecisionLabel,
          nextAction: preview.selectionDecision.nextAction,
          byKind: preview.selectionDecision.byKind,
          blockedDesiredPlaneIds: preview.selectionDecision.blockedDesiredPlaneIds
        }
      },
      acceptance: {
        route: "scheduler.executionPlaneRegistry.acceptance",
        schema: acceptance.schema,
        generatedAt: now,
        accepted: acceptance.accepted,
        rejectedGates: acceptance.rejectedGates,
        selectedPlaneId: acceptance.routePayload.selectedPlaneId,
        selectedPlaneKind: acceptance.routePayload.selectedPlaneKind,
        action: acceptance.routePayload.action
      },
      selectionPreview: preview.selectionDecision.routePayload,
      nextSteps: nextStepContracts.map((contract) => contract.routePayload),
      workflowHandoff: {
        route: workflowHandoff.primaryRoute.route,
        schema: workflowHandoff.schema,
        generatedAt: now,
        requestId: clientRequest.requestId,
        state: workflowHandoff.state,
        selectedPlaneId: workflowHandoff.selectedPlaneId,
        returnRoute: workflowHandoff.primaryRoute.returnRoute,
        handoffDecision: workflowHandoff.handoffDecision
      },
      dispatchReservation: dispatchReservation.routePayload,
      executionPlaneSelection: executionPlaneSelection.routePayload,
      selectionAuditHandoff: executionPlaneSelection.auditHandoff.handoffPayload,
      analytics: {
        route: analytics.reportState.nextReportRoute,
        schema: analytics.schema,
        generatedAt: now,
        state: analytics.reportState.state,
        headline: analytics.reportState.headline,
        exportable: analytics.reportState.exportable,
        summary: {
          readyRatio: analytics.counters.readyRatio,
          blockedRatio: analytics.counters.blockedRatio,
          backlogPerAvailableSlot: analytics.counters.backlogPerAvailableSlot,
          trend: analytics.trend,
          selection: {
            state: analytics.selection.state,
            mode: analytics.selection.mode,
            desiredPlaneKind: analytics.selection.desiredPlaneKind,
            selectedPlaneId: analytics.selection.selectedPlaneId,
            selectedPlaneKind: analytics.selection.selectedPlaneKind,
            fallbackUsed: analytics.selection.fallbackUsed,
            ratios: analytics.selection.ratios
          }
        }
      },
      selectionAnalytics: {
        route: "scheduler.executionPlaneRegistry.selectionAnalytics",
        schema: selectionAnalytics.schema,
        generatedAt: selectionAnalytics.generatedAt,
        state: selectionAnalytics.state,
        mode: selectionAnalytics.mode,
        desiredPlaneKind: selectionAnalytics.desiredPlaneKind,
        selectedPlaneId: selectionAnalytics.selectedPlaneId,
        selectedPlaneKind: selectionAnalytics.selectedPlaneKind,
        fallbackUsed: selectionAnalytics.fallbackUsed,
        counters: selectionAnalytics.counters,
        ratios: selectionAnalytics.ratios,
        blockedReasonCounts: selectionAnalytics.blockedReasonCounts
      },
      persistenceRecovery: {
        route: "scheduler.executionPlaneRegistry.persistenceRecovery",
        schema: recovery.schema,
        generatedAt: now,
        restartId: recovery.restartId,
        recoveryMode: recovery.recoveryMode,
        restartSafe: recovery.restartSafe,
        pendingRefreshPlaneIds: recovery.pendingRefreshPlaneIds,
        alreadyAppliedCommandIds: recovery.alreadyAppliedCommandIds,
        replayableCommandIds: recovery.replayableCommandIds,
        conflictingCommandIds: recovery.conflictingCommandIds,
        receiptConflicts: recovery.receiptConflicts
      },
      accessBoundary: {
        route: "scheduler.executionPlaneRegistry.accessBoundary",
        schema: accessBoundary.schema,
        generatedAt: now,
        actor: accessBoundary.context.actor,
        tenantScope: accessBoundary.context.tenantScope,
        workspaceScope: accessBoundary.context.workspaceScope,
        isolationState: accessBoundary.isolationState,
        scopedPlanes: accessBoundary.scopedPlanes,
        scopedCommands: accessBoundary.scopedCommands,
        deniedPlaneIds: accessBoundary.deniedPlanes.map((plane) => plane.planeId),
        deniedCommandIds: accessBoundary.deniedCommandIds
      },
      operationalHealth: {
        route: "scheduler.executionPlaneRegistry.operationalHealth",
        schema: operationalHealth.schema,
        generatedAt: now,
        state: operationalHealth.state,
        blockedPlaneIds: operationalHealth.blockedPlaneIds,
        degradedPlaneIds: operationalHealth.degradedPlaneIds,
        retryBackoffPlaneIds: operationalHealth.retryBackoffPlaneIds,
        incidents: operationalHealth.incidents.map((incident) => incident.routePayload)
      }
    },
    evidence: Array.isArray(input.evidence) ? input.evidence : []
  };
}

export default describeExecutionPlaneRegistrySurface;
