export const surfaceId = "aios_operator-userland_dashboard-model_087";
export const surfaceGroup = "operator-userland";
export const surfaceName = "dashboard-model";

const SUPPORTED_CAPABILITIES = Object.freeze([
  "dashboard.read",
  "kernel.status.read",
  "handoff.prepare",
  "sync.metadata.read",
  "audit.proof.read"
]);

const DEFAULT_PROVIDER_ID = "hosted-kernel-dashboard";
const DEFAULT_SYNC_CURSOR = "dashboard-model:init";
const CLIENT_WORKFLOW_STAGES = Object.freeze(["inspect", "triage", "handoff", "resume"]);
const CLIENT_DELIVERY_MODES = Object.freeze(["inline", "drawer", "external"]);
const CLIENT_INTENTS = Object.freeze(["status-check", "sync-review", "handoff", "acceptance"]);
const CLIENT_HANDOFF_CHANNELS = Object.freeze(["same-tab", "new-tab", "embedded", "command-palette"]);
const CLIENT_RETURN_STRATEGIES = Object.freeze(["preserve-panel", "resume-primary-action", "acceptance-gate"]);
const PERSISTED_STATE_VERSION = "dashboard-persisted-state.v1";
const COMMAND_TYPES = Object.freeze(["refresh-status", "resume-workflow", "acknowledge-acceptance", "prepare-handoff"]);
const OPERATOR_EVENT_TYPES = Object.freeze(["status", "validation", "command", "checkpoint", "workflow", "acceptance"]);
const ANALYTICS_EXPORT_FORMATS = Object.freeze(["jsonl", "csv", "summary"]);
const ANALYTICS_HISTORY_LIMIT = 24;
const PERSISTED_COMMAND_HISTORY_LIMIT = 16;
const CLI_RUN_EXPORT_HANDOFF_STALE_MS = 15 * 60 * 1000;
const LIFECYCLE_MODES = Object.freeze(["enabled", "disabled", "maintenance"]);
const LIFECYCLE_SCHEDULE_MODES = Object.freeze(["manual", "interval", "window"]);
const HEALTH_COMPONENTS = Object.freeze(["control-plane", "status-stream", "sync-writer", "handoff-broker"]);
const HEALTH_STATES = Object.freeze(["healthy", "degraded", "failing", "unknown"]);
const HEALTH_OBSERVATION_STALE_MS = 10 * 60 * 1000;
const HEALTH_OBSERVATION_FUTURE_DRIFT_MS = 60 * 1000;
const HEALTH_ACTIONABLE_ERROR_LIMIT = 12;
const RUNNING_JOB_STATES = Object.freeze(["queued", "running", "blocked", "failed", "completed"]);
const JOB_STALE_AFTER_MS = 30 * 60 * 1000;
const JOB_ATTENTION_AFTER_MS = 2 * 60 * 60 * 1000;
const JOB_PROGRESS_STALL_AFTER_MS = 45 * 60 * 1000;
const PERSISTED_OPERATIONAL_SNAPSHOT_STALE_MS = 15 * 60 * 1000;
const PROVIDER_API_VERSION = "2026-07-01";
const PROVIDER_SERVICE_REQUIREMENTS = Object.freeze({
  status: Object.freeze({
    minApiVersion: "2026-01-01",
    requiredDeliveryModes: Object.freeze(["inline", "drawer"]),
    handoffChannels: Object.freeze([])
  }),
  sync: Object.freeze({
    minApiVersion: "2026-03-01",
    requiredDeliveryModes: Object.freeze(["inline", "drawer"]),
    handoffChannels: Object.freeze([])
  }),
  audit: Object.freeze({
    minApiVersion: "2026-04-01",
    requiredDeliveryModes: Object.freeze(["inline", "drawer", "external"]),
    handoffChannels: Object.freeze([])
  }),
  handoff: Object.freeze({
    minApiVersion: "2026-06-01",
    requiredDeliveryModes: Object.freeze(["drawer", "external"]),
    handoffChannels: CLIENT_HANDOFF_CHANNELS
  })
});
const DASHBOARD_ROLE_PERMISSIONS = Object.freeze({
  viewer: Object.freeze(["dashboard.read", "kernel.status.read", "sync.metadata.read"]),
  operator: Object.freeze(["dashboard.read", "kernel.status.read", "sync.metadata.read", "audit.proof.read"]),
  handoff: Object.freeze(["dashboard.read", "kernel.status.read", "sync.metadata.read", "audit.proof.read", "handoff.prepare"]),
  admin: SUPPORTED_CAPABILITIES
});
const REQUIRED_DASHBOARD_PERMISSIONS = Object.freeze(["dashboard.read", "kernel.status.read"]);
const TENANT_HANDOFF_PERMISSIONS = Object.freeze(["dashboard.read", "kernel.status.read", "handoff.prepare"]);

function stableString(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableString(entry)).join(",")}]`;
  }
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableString(value[key])}`).join(",")}}`;
}

function proofToken(parts) {
  let hash = 2166136261;
  for (const char of stableString(parts)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `proof_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function normalizeString(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim()))];
}

function normalizeNumber(value, fallback, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

function compareDateVersion(left, right) {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) {
    return String(left || "").localeCompare(String(right || ""));
  }
  return leftTime - rightTime;
}

function normalizeProviderServiceDeclarations(inputProvider, providerEndpoint, providerApiVersion) {
  const rawServices = inputProvider.services && typeof inputProvider.services === "object" && inputProvider.services !== null
    ? inputProvider.services
    : inputProvider.serviceContracts && typeof inputProvider.serviceContracts === "object" && inputProvider.serviceContracts !== null
      ? inputProvider.serviceContracts
      : {};

  return Object.keys(PROVIDER_SERVICE_REQUIREMENTS).reduce((services, serviceId) => {
    const rawService = rawServices[serviceId] && typeof rawServices[serviceId] === "object" ? rawServices[serviceId] : {};
    const apiVersion = normalizeString(rawService.apiVersion || rawService.version, providerApiVersion);
    const endpoint = normalizeString(rawService.endpoint, `${providerEndpoint}/${serviceId}`);
    const supportedDeliveryModes = normalizeStringList(rawService.deliveryModes).filter((mode) => CLIENT_DELIVERY_MODES.includes(mode));
    const supportedHandoffChannels = normalizeStringList(rawService.handoffChannels).filter((channel) => CLIENT_HANDOFF_CHANNELS.includes(channel));
    const declaredCapabilities = normalizeStringList(rawService.capabilities).filter((capability) => SUPPORTED_CAPABILITIES.includes(capability));
    const explicitEnabled = rawService.enabled !== false;

    services[serviceId] = {
      contractVersion: "dashboard-provider-service-declaration.v1",
      serviceId,
      enabled: explicitEnabled,
      apiVersion,
      endpoint,
      deliveryModes: supportedDeliveryModes.length > 0 ? supportedDeliveryModes : CLIENT_DELIVERY_MODES,
      handoffChannels: supportedHandoffChannels.length > 0
        ? supportedHandoffChannels
        : serviceId === "handoff" ? CLIENT_HANDOFF_CHANNELS : [],
      declaredCapabilities,
      declarationProof: proofToken({
        serviceId,
        enabled: explicitEnabled,
        apiVersion,
        endpoint,
        deliveryModes: supportedDeliveryModes,
        handoffChannels: supportedHandoffChannels,
        declaredCapabilities
      })
    };
    return services;
  }, {});
}

function buildPermissionBoundary({
  tenantMatches,
  workspaceAllowed,
  tenantId,
  workspaceId,
  actorTenantId,
  actorWorkspaceIds,
  role,
  rolePermissions,
  explicitPermissions,
  effectivePermissions
}) {
  const unsupportedPermissions = explicitPermissions.filter((permission) => !SUPPORTED_CAPABILITIES.includes(permission));
  const missingRequiredPermissions = REQUIRED_DASHBOARD_PERMISSIONS.filter((permission) => !effectivePermissions.includes(permission));
  const handoffMissingPermissions = TENANT_HANDOFF_PERMISSIONS.filter((permission) => !effectivePermissions.includes(permission));
  const rolePermissionIds = [...rolePermissions];
  const explicitPermissionMode = explicitPermissions.length > 0;
  const narrowedRolePermissions = explicitPermissionMode
    ? rolePermissionIds.filter((permission) => !effectivePermissions.includes(permission))
    : [];
  const isolationState = tenantMatches && workspaceAllowed ? "scoped" : "blocked";
  const permissionState = isolationState === "blocked"
    ? "blocked"
    : missingRequiredPermissions.length > 0
      ? "limited"
      : "ready";
  const deniedReasons = [
    !tenantMatches ? "actor, workspace, and tenant identifiers must resolve to the same tenant" : null,
    !workspaceAllowed ? "actor is not scoped to this workspace" : null,
    unsupportedPermissions.length > 0 ? `unsupported permissions requested: ${unsupportedPermissions.join(", ")}` : null,
    missingRequiredPermissions.length > 0 ? `required dashboard permissions missing: ${missingRequiredPermissions.join(", ")}` : null
  ].filter(Boolean);
  const permissionProof = proofToken({
    tenantId,
    workspaceId,
    actorTenantId,
    actorWorkspaceIds,
    role,
    explicitPermissionMode,
    effectivePermissions,
    unsupportedPermissions,
    missingRequiredPermissions,
    isolationState,
    permissionState
  });

  return {
    contractVersion: "dashboard-permission-boundary.v1",
    state: permissionState,
    isolationState,
    role,
    rolePermissionIds,
    explicitPermissionMode,
    effectivePermissions,
    unsupportedPermissions,
    narrowedRolePermissions,
    missingRequiredPermissions,
    handoffMissingPermissions,
    canReadDashboard: missingRequiredPermissions.length === 0 && isolationState === "scoped",
    canPrepareHandoff: handoffMissingPermissions.length === 0 && isolationState === "scoped",
    canReadAuditProof: effectivePermissions.includes("audit.proof.read") && isolationState === "scoped",
    safeToPersist: isolationState === "scoped" && missingRequiredPermissions.length === 0 && unsupportedPermissions.length === 0,
    deniedReasons,
    permissionProof
  };
}

function normalizeProvider(inputProvider = {}) {
  const id = typeof inputProvider.id === "string" && inputProvider.id.trim()
    ? inputProvider.id.trim()
    : DEFAULT_PROVIDER_ID;
  const endpoint = typeof inputProvider.endpoint === "string" && inputProvider.endpoint.trim()
    ? inputProvider.endpoint.trim()
    : "aios://hosted-kernel/dashboard";
  const mode = inputProvider.mode === "external" ? "external" : "hosted-kernel";
  const revision = typeof inputProvider.revision === "string" && inputProvider.revision.trim()
    ? inputProvider.revision.trim()
    : "local";
  const apiVersion = typeof inputProvider.apiVersion === "string" && inputProvider.apiVersion.trim()
    ? inputProvider.apiVersion.trim()
    : PROVIDER_API_VERSION;
  const serviceDeclarations = normalizeProviderServiceDeclarations(inputProvider, endpoint, apiVersion);

  return {
    id,
    endpoint,
    mode,
    revision,
    apiVersion,
    serviceDeclarations,
    serviceDeclarationCount: Object.keys(serviceDeclarations).length,
    contractVersion: "dashboard-provider.v1"
  };
}

function normalizePersistedScopeClaim(rawEntry = {}, inheritedScope = {}, workspaceBoundary = null, fallbackId = "persisted-entry") {
  const rawTenantId = typeof rawEntry.tenantId === "string" && rawEntry.tenantId.trim() ? rawEntry.tenantId.trim() : null;
  const rawWorkspaceId = typeof rawEntry.workspaceId === "string" && rawEntry.workspaceId.trim() ? rawEntry.workspaceId.trim() : null;
  const rawBoundaryProof = typeof rawEntry.boundaryProof === "string" && rawEntry.boundaryProof.trim() ? rawEntry.boundaryProof.trim() : null;
  const tenantId = rawTenantId || inheritedScope.tenantId || null;
  const workspaceId = rawWorkspaceId || inheritedScope.workspaceId || null;
  const boundaryProof = rawBoundaryProof || inheritedScope.boundaryProof || null;
  const tenantClaimed = Boolean(rawTenantId || inheritedScope.tenantClaimed);
  const workspaceClaimed = Boolean(rawWorkspaceId || inheritedScope.workspaceClaimed);
  const boundaryClaimed = Boolean(rawBoundaryProof || inheritedScope.boundaryClaimed);
  const tenantMatches = !workspaceBoundary || tenantId === workspaceBoundary.tenantId;
  const workspaceMatches = !workspaceBoundary || workspaceId === workspaceBoundary.workspaceId;
  const boundaryMatches = !workspaceBoundary || !boundaryProof || boundaryProof === workspaceBoundary.boundaryProof;
  const fullyClaimed = tenantClaimed && workspaceClaimed;
  const state = !workspaceBoundary
    ? "unverified"
    : !tenantMatches
      ? "tenant-mismatch"
      : !workspaceMatches
        ? "workspace-mismatch"
        : !boundaryMatches
          ? "boundary-proof-mismatch"
          : fullyClaimed && boundaryClaimed
            ? "scoped"
            : fullyClaimed
              ? "scope-claim-only"
              : "legacy-unscoped";
  const trusted = workspaceBoundary
    ? state === "scoped" || state === "scope-claim-only"
    : false;

  return {
    contractVersion: "dashboard-persisted-scope-claim.v1",
    entryId: fallbackId,
    tenantId,
    workspaceId,
    boundaryProof,
    tenantClaimed,
    workspaceClaimed,
    boundaryClaimed,
    state,
    trusted,
    expectedTenantId: workspaceBoundary?.tenantId || null,
    expectedWorkspaceId: workspaceBoundary?.workspaceId || null,
    expectedBoundaryProof: workspaceBoundary?.boundaryProof || null,
    reason: trusted
      ? null
      : state === "legacy-unscoped"
        ? "Persisted entry has no tenant/workspace scope claim and must be refreshed before trust."
        : state === "tenant-mismatch"
          ? "Persisted entry belongs to a different tenant."
          : state === "workspace-mismatch"
            ? "Persisted entry belongs to a different workspace."
            : state === "boundary-proof-mismatch"
              ? "Persisted entry was written under a different workspace boundary proof."
              : "Persisted entry scope could not be verified."
  };
}

function normalizeKernelHealth(input = {}, now) {
  const health = input && typeof input.health === "object" && input.health !== null ? input.health : {};
  const components = health.components && typeof health.components === "object" && health.components !== null
    ? health.components
    : {};
  const failures = Array.isArray(health.failures) ? health.failures : [];
  const observedAt = typeof health.observedAt === "string" && health.observedAt.trim() ? health.observedAt.trim() : now;
  const retryAfterMs = normalizeNumber(health.retryAfterMs, null, { min: 0, max: 300000 });
  const attempt = Math.trunc(normalizeNumber(health.attempt, 0, { min: 0, max: 50 }));

  return {
    contractVersion: "dashboard-kernel-health-input.v1",
    observedAt,
    attempt,
    retryAfterMs,
    degradedModeAllowed: health.degradedModeAllowed !== false,
    components: HEALTH_COMPONENTS.map((id) => {
      const rawComponent = components[id] && typeof components[id] === "object" ? components[id] : {};
      const state = HEALTH_STATES.includes(rawComponent.state) ? rawComponent.state : "unknown";
      return {
        id,
        state,
        message: normalizeString(rawComponent.message, state === "healthy" ? "Component is reporting healthy." : "No hosted-kernel health detail was provided."),
        route: normalizeString(rawComponent.route, `hosted-kernel/health/${id}`),
        retryable: rawComponent.retryable !== false && state !== "healthy",
        lastTransitionAt: normalizeString(rawComponent.lastTransitionAt, observedAt)
      };
    }),
    failures: failures
      .filter((failure) => failure && typeof failure === "object")
      .map((failure, index) => ({
        id: normalizeString(failure.id, `failure-${index + 1}`),
        component: HEALTH_COMPONENTS.includes(failure.component) ? failure.component : "control-plane",
        severity: failure.severity === "error" ? "error" : failure.severity === "warning" ? "warning" : "info",
        code: normalizeString(failure.code, "hosted_kernel_failure"),
        message: normalizeString(failure.message, "Hosted-kernel health reported an unspecified failure."),
        retryable: failure.retryable !== false,
        route: normalizeString(failure.route, `hosted-kernel/health/${failure.component || "control-plane"}`)
      }))
  };
}

function buildOperationalHealthContract({ provider, capabilityNegotiation, syncMetadata, handoff, workspaceBoundary, kernelHealth, now }) {
  const componentFailures = kernelHealth.components.filter((component) => component.state === "failing");
  const componentDegradations = kernelHealth.components.filter((component) => component.state === "degraded" || component.state === "unknown");
  const explicitErrors = kernelHealth.failures.filter((failure) => failure.severity === "error");
  const explicitWarnings = kernelHealth.failures.filter((failure) => failure.severity === "warning");
  const healthBlocksDashboard = componentFailures.some((component) => component.id === "control-plane" || component.id === "status-stream");
  const healthBlocksSync = componentFailures.some((component) => component.id === "sync-writer") || syncMetadata.status !== "ready";
  const healthBlocksHandoff = componentFailures.some((component) => component.id === "handoff-broker") || handoff.state === "blocked";
  const blocked = workspaceBoundary.isolationState === "blocked" || healthBlocksDashboard || explicitErrors.some((failure) => !failure.retryable);
  const degraded = !blocked && (
    componentFailures.length > 0
    || componentDegradations.length > 0
    || explicitErrors.length > 0
    || explicitWarnings.length > 0
    || healthBlocksSync
    || healthBlocksHandoff
    || !capabilityNegotiation.granted.includes("kernel.status.read")
  );
  const retryable = !blocked && (
    componentFailures.some((component) => component.retryable)
    || kernelHealth.failures.some((failure) => failure.retryable)
    || syncMetadata.status !== "ready"
  );
  const baseDelayMs = kernelHealth.retryAfterMs ?? Math.min(120000, 1000 * (2 ** Math.min(kernelHealth.attempt, 6)));
  const retryDelayMs = retryable ? baseDelayMs : null;
  const parsedNow = Date.parse(now);
  const retryAnchorMs = Number.isFinite(parsedNow) ? parsedNow : Date.now();
  const retryToken = retryable
    ? proofToken({ providerId: provider.id, workspace: workspaceBoundary.workspaceId, attempt: kernelHealth.attempt, cursor: syncMetadata.cursor, baseDelayMs })
    : null;
  const mode = blocked
    ? "blocked"
    : degraded
      ? kernelHealth.degradedModeAllowed
        ? "degraded"
        : "blocked"
      : "healthy";
  const actionableErrors = [
    ...componentFailures.map((component) => ({
      id: `component-${component.id}`,
      severity: "error",
      code: `${component.id.replaceAll("-", "_")}_failing`,
      message: component.message,
      action: component.retryable ? "retry-component" : "escalate-component",
      route: `${workspaceBoundary.routeScope}/health/${component.id}`,
      retryable: component.retryable
    })),
    ...kernelHealth.failures.map((failure) => ({
      id: failure.id,
      severity: failure.severity,
      code: failure.code,
      message: failure.message,
      action: failure.retryable ? "retry-hosted-kernel" : "escalate-hosted-kernel",
      route: failure.route.startsWith(surfaceGroup) ? failure.route : `${workspaceBoundary.routeScope}/health/${failure.component}`,
      retryable: failure.retryable
    }))
  ];

  return {
    contractVersion: "dashboard-operational-health.v1",
    state: mode,
    healthy: mode === "healthy",
    degradedModeActive: mode === "degraded",
    observedAt: kernelHealth.observedAt,
    providerId: provider.id,
    providerMode: provider.mode,
    componentSummary: {
      total: kernelHealth.components.length,
      failing: componentFailures.length,
      degraded: componentDegradations.length,
      healthy: kernelHealth.components.filter((component) => component.state === "healthy").length
    },
    blocks: {
      dashboard: healthBlocksDashboard,
      sync: healthBlocksSync,
      handoff: healthBlocksHandoff
    },
    retry: {
      retryable,
      attempt: kernelHealth.attempt,
      backoffMs: retryDelayMs,
      nextAttemptAt: retryDelayMs === null ? null : new Date(retryAnchorMs + retryDelayMs).toISOString(),
      retryToken
    },
    components: kernelHealth.components,
    actionableErrors,
    proofId: proofToken({
      providerId: provider.id,
      workspace: workspaceBoundary.workspaceId,
      state: mode,
      components: kernelHealth.components,
      failures: kernelHealth.failures,
      retryToken
    }),
    route: `${workspaceBoundary.routeScope}/health`
  };
}

function buildHealthValidationEnvelope({ provider, capabilityNegotiation, workspaceBoundary, kernelHealth, operationalHealth, now }) {
  const nowMs = Date.parse(now);
  const observedMs = Date.parse(kernelHealth.observedAt);
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const observedValid = Number.isFinite(observedMs);
  const ageMs = observedValid ? Math.max(0, safeNowMs - observedMs) : null;
  const stale = observedValid ? ageMs > HEALTH_OBSERVATION_STALE_MS : true;
  const fromFuture = observedValid ? observedMs - safeNowMs > HEALTH_OBSERVATION_FUTURE_DRIFT_MS : false;
  const unknownComponents = kernelHealth.components.filter((component) => component.state === "unknown");
  const failingNonRetryable = operationalHealth.actionableErrors.filter((error) => error.severity === "error" && !error.retryable);
  const retryableErrors = operationalHealth.actionableErrors.filter((error) => error.retryable);
  const errorLimitExceeded = operationalHealth.actionableErrors.length > HEALTH_ACTIONABLE_ERROR_LIMIT;
  const dashboardReadable = capabilityNegotiation.granted.includes("dashboard.read");
  const kernelObservable = capabilityNegotiation.granted.includes("kernel.status.read");
  const findings = [
    observedValid ? null : {
      severity: "error",
      code: "health_observed_at_invalid",
      message: "Hosted-kernel health observedAt must be an ISO timestamp before operators can trust freshness."
    },
    stale ? {
      severity: "warning",
      code: "health_observation_stale",
      message: `Hosted-kernel health is older than ${HEALTH_OBSERVATION_STALE_MS}ms.`
    } : null,
    fromFuture ? {
      severity: "error",
      code: "health_observation_future_drift",
      message: "Hosted-kernel health timestamp is too far ahead of the dashboard clock."
    } : null,
    unknownComponents.length > 0 ? {
      severity: "warning",
      code: "health_components_unknown",
      message: `Hosted-kernel health is missing component detail for ${unknownComponents.map((component) => component.id).join(", ")}.`
    } : null,
    failingNonRetryable.length > 0 ? {
      severity: "error",
      code: "health_non_retryable_failures",
      message: `${failingNonRetryable.length} hosted-kernel health failure(s) require escalation.`
    } : null,
    errorLimitExceeded ? {
      severity: "error",
      code: "health_error_budget_exceeded",
      message: `Hosted-kernel health returned more than ${HEALTH_ACTIONABLE_ERROR_LIMIT} actionable errors.`
    } : null,
    !dashboardReadable || !kernelObservable ? {
      severity: "error",
      code: "health_permission_validation_blocked",
      message: "Dashboard health validation requires dashboard.read and kernel.status.read."
    } : null
  ].filter(Boolean);
  const blocksServing = workspaceBoundary.isolationState === "blocked"
    || !dashboardReadable
    || fromFuture
    || !observedValid
    || failingNonRetryable.length > 0
    || errorLimitExceeded;
  const degraded = !blocksServing && (stale || unknownComponents.length > 0 || operationalHealth.degradedModeActive);
  const validationState = blocksServing ? "blocked" : degraded ? "degraded" : "valid";
  const operatorActions = [
    stale || retryableErrors.length > 0 ? {
      id: "refresh-hosted-kernel-health",
      label: "Refresh hosted-kernel health",
      route: operationalHealth.route,
      retryToken: operationalHealth.retry.retryToken,
      reason: stale ? "The current hosted-kernel health observation is stale." : "Retryable hosted-kernel failures were reported."
    } : null,
    failingNonRetryable.length > 0 || errorLimitExceeded ? {
      id: "escalate-hosted-kernel-health",
      label: "Escalate hosted-kernel health",
      route: `${workspaceBoundary.routeScope}/health/escalation`,
      retryToken: null,
      reason: failingNonRetryable[0]?.message || "Hosted-kernel health exceeded the actionable error budget."
    } : null,
    unknownComponents.length > 0 ? {
      id: "inspect-health-components",
      label: "Inspect health components",
      route: `${workspaceBoundary.routeScope}/health/components`,
      retryToken: null,
      reason: `Missing component detail: ${unknownComponents.map((component) => component.id).join(", ")}.`
    } : null
  ].filter(Boolean);

  return {
    contractVersion: "dashboard-health-validation.v1",
    providerId: provider.id,
    state: validationState,
    blocksServing,
    degradedModeRecommended: degraded,
    observedAt: kernelHealth.observedAt,
    observedAtValid: observedValid,
    ageMs,
    freshness: {
      stale,
      fromFuture,
      staleAfterMs: HEALTH_OBSERVATION_STALE_MS,
      maxFutureDriftMs: HEALTH_OBSERVATION_FUTURE_DRIFT_MS
    },
    errorBudget: {
      actionableErrorCount: operationalHealth.actionableErrors.length,
      limit: HEALTH_ACTIONABLE_ERROR_LIMIT,
      exceeded: errorLimitExceeded,
      nonRetryableErrorCount: failingNonRetryable.length,
      retryableErrorCount: retryableErrors.length
    },
    unknownComponentIds: unknownComponents.map((component) => component.id),
    findingCount: findings.length,
    findings,
    operatorActions,
    proofId: proofToken({
      providerId: provider.id,
      workspace: workspaceBoundary.workspaceId,
      observedAt: kernelHealth.observedAt,
      state: validationState,
      findings,
      healthProofId: operationalHealth.proofId
    }),
    route: `${workspaceBoundary.routeScope}/health/validation`
  };
}

function normalizeWorkspaceBoundary(input = {}, now) {
  const tenant = input && typeof input.tenant === "object" && input.tenant !== null ? input.tenant : {};
  const workspace = input && typeof input.workspace === "object" && input.workspace !== null ? input.workspace : {};
  const actorAccess = input && typeof input.actorAccess === "object" && input.actorAccess !== null ? input.actorAccess : {};
  const client = input && typeof input.client === "object" && input.client !== null ? input.client : {};
  const tenantId = normalizeString(tenant.id, normalizeString(workspace.tenantId, "tenant-default"));
  const workspaceId = normalizeString(workspace.id, normalizeString(client.workspaceId, "workspace-default"));
  const workspaceTenantId = normalizeString(workspace.tenantId, tenantId);
  const actorTenantId = normalizeString(actorAccess.tenantId, tenantId);
  const actorWorkspaceIds = normalizeStringList(actorAccess.workspaceIds);
  const role = Object.prototype.hasOwnProperty.call(DASHBOARD_ROLE_PERMISSIONS, actorAccess.role)
    ? actorAccess.role
    : "operator";
  const rolePermissions = DASHBOARD_ROLE_PERMISSIONS[role];
  const explicitPermissions = normalizeStringList(actorAccess.permissions);
  const permissionSource = explicitPermissions.length > 0 ? "explicit" : "role";
  const effectivePermissions = explicitPermissions.length > 0
    ? explicitPermissions.filter((permission) => SUPPORTED_CAPABILITIES.includes(permission))
    : rolePermissions;
  const tenantMatches = tenantId === workspaceTenantId && tenantId === actorTenantId;
  const workspaceAllowed = actorWorkspaceIds.length === 0 || actorWorkspaceIds.includes(workspaceId);
  const permissionBoundary = buildPermissionBoundary({
    tenantMatches,
    workspaceAllowed,
    tenantId,
    workspaceId,
    actorTenantId,
    actorWorkspaceIds,
    role,
    rolePermissions,
    explicitPermissions,
    effectivePermissions
  });
  const isolationState = permissionBoundary.isolationState;
  const boundaryProof = proofToken({
    tenantId,
    workspaceId,
    actorTenantId,
    actorWorkspaceIds,
    role,
    effectivePermissions,
    isolationState,
    permissionProof: permissionBoundary.permissionProof
  });

  return {
    contractVersion: "dashboard-workspace-boundary.v1",
    tenantId,
    workspaceId,
    actorTenantId,
    actorWorkspaceIds,
    role,
    permissionSource,
    effectivePermissions,
    permissionBoundary,
    permissionState: permissionBoundary.state,
    unsupportedPermissions: permissionBoundary.unsupportedPermissions,
    missingRequiredPermissions: permissionBoundary.missingRequiredPermissions,
    handoffMissingPermissions: permissionBoundary.handoffMissingPermissions,
    permissionProof: permissionBoundary.permissionProof,
    isolationState,
    safeToPersist: permissionBoundary.safeToPersist,
    reason: permissionBoundary.deniedReasons[0] || null,
    routeScope: `${surfaceGroup}/${surfaceName}/tenants/${tenantId}/workspaces/${workspaceId}`,
    boundaryProof,
    evaluatedAt: now
  };
}

function negotiateCapabilities(requestedCapabilities = [], workspaceBoundary) {
  const requested = normalizeStringList(requestedCapabilities);
  const supported = SUPPORTED_CAPABILITIES.filter((capability) => requested.length === 0 || requested.includes(capability));
  const permitted = workspaceBoundary
    ? supported.filter((capability) => workspaceBoundary.effectivePermissions.includes(capability))
    : supported;
  const rejected = requested.filter((capability) => !SUPPORTED_CAPABILITIES.includes(capability));
  const denied = requested.length > 0
    ? supported.filter((capability) => !permitted.includes(capability))
    : [];

  return {
    requested,
    granted: workspaceBoundary?.isolationState === "blocked" ? [] : permitted,
    rejected,
    denied,
    complete: rejected.length === 0 && denied.length === 0 && workspaceBoundary?.isolationState !== "blocked",
    requiredForDashboard: ["dashboard.read", "kernel.status.read"]
  };
}

function buildSyncMetadata(input, now) {
  const sync = input && typeof input.sync === "object" && input.sync !== null ? input.sync : {};
  const cursor = typeof sync.cursor === "string" && sync.cursor.trim() ? sync.cursor.trim() : DEFAULT_SYNC_CURSOR;
  const sourceClock = Number.isFinite(sync.sourceClock) ? sync.sourceClock : 0;
  const acceptedClock = Math.max(0, sourceClock);

  return {
    cursor,
    sourceClock: acceptedClock,
    generatedAt: now,
    status: sync.paused ? "paused" : "ready",
    nextCursor: `${cursor}:${acceptedClock + 1}`,
    acceptsIncrementalSync: true
  };
}

function normalizeExternalHandoff(input, provider, capabilityNegotiation, workspaceBoundary) {
  const handoff = input && typeof input.handoff === "object" && input.handoff !== null ? input.handoff : {};
  const target = typeof handoff.target === "string" && handoff.target.trim() ? handoff.target.trim() : "operator-dashboard";
  const requested = handoff.requested === true || capabilityNegotiation.requested.includes("handoff.prepare");
  const boundaryBlocked = workspaceBoundary?.isolationState === "blocked";
  const permissionBlocked = workspaceBoundary?.permissionBoundary?.canPrepareHandoff === false;
  const canPrepare = capabilityNegotiation.granted.includes("handoff.prepare") && !boundaryBlocked && !permissionBlocked;
  const tenantScopedClaim = requested && canPrepare
    ? {
      contractVersion: "dashboard-tenant-handoff-claim.v1",
      tenantId: workspaceBoundary.tenantId,
      workspaceId: workspaceBoundary.workspaceId,
      routeScope: workspaceBoundary.routeScope,
      providerId: provider.id,
      target,
      allowedCapabilities: TENANT_HANDOFF_PERMISSIONS.filter((permission) => capabilityNegotiation.granted.includes(permission)),
      boundaryProof: workspaceBoundary.boundaryProof,
      permissionProof: workspaceBoundary.permissionProof,
      claimProof: proofToken({
        tenantId: workspaceBoundary.tenantId,
        workspaceId: workspaceBoundary.workspaceId,
        providerId: provider.id,
        target,
        boundaryProof: workspaceBoundary.boundaryProof,
        permissionProof: workspaceBoundary.permissionProof
      })
    }
    : null;

  return {
    requested,
    target,
    providerId: provider.id,
    state: requested && canPrepare ? "prepared" : requested ? "blocked" : "not-requested",
    reason: requested && boundaryBlocked
      ? workspaceBoundary.reason
      : requested && permissionBlocked
        ? `handoff boundary missing ${workspaceBoundary.handoffMissingPermissions.join(", ")}`
      : requested && !canPrepare
        ? "handoff.prepare capability was not granted"
        : null,
    resumeToken: requested && canPrepare
      ? proofToken({ providerId: provider.id, target, endpoint: provider.endpoint, workspace: workspaceBoundary?.workspaceId })
      : null,
    tenantScopedClaim
  };
}

function normalizeCliRunDashboardExportHandoff(input, workspaceBoundary, syncMetadata, now) {
  const cliRun = input && typeof input.cliRun === "object" && input.cliRun !== null ? input.cliRun : {};
  const handoff = input && typeof input.cliRunDashboardExportHandoff === "object" && input.cliRunDashboardExportHandoff !== null
    ? input.cliRunDashboardExportHandoff
    : input && typeof input.dashboardExportHandoff === "object" && input.dashboardExportHandoff !== null
      ? input.dashboardExportHandoff
      : cliRun.dashboardExportHandoff && typeof cliRun.dashboardExportHandoff === "object"
        ? cliRun.dashboardExportHandoff
        : cliRun.state && typeof cliRun.state === "object" && cliRun.state.dashboardExportHandoff && typeof cliRun.state.dashboardExportHandoff === "object"
          ? cliRun.state.dashboardExportHandoff
          : null;

  if (!handoff) {
    return {
      contractVersion: "dashboard-cli-run-export-handoff.v1",
      present: false,
      state: "not-present",
      accepted: false,
      reason: "No cli-run dashboard export handoff was supplied.",
      validationCodes: [],
      action: null,
      proofId: proofToken({
        workspace: workspaceBoundary.workspaceId,
        cursor: syncMetadata.cursor,
        state: "not-present"
      })
    };
  }

  const contract = normalizeString(handoff.contract || handoff.contractVersion || handoff.format, "unknown");
  const generatedAt = normalizeString(handoff.generatedAt, null);
  const generatedMs = generatedAt ? Date.parse(generatedAt) : NaN;
  const nowMs = Date.parse(now);
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const ageMs = Number.isFinite(generatedMs) ? Math.max(0, safeNowMs - generatedMs) : null;
  const fromFuture = Number.isFinite(generatedMs) ? generatedMs - safeNowMs > HEALTH_OBSERVATION_FUTURE_DRIFT_MS : false;
  const stale = ageMs === null || ageMs > CLI_RUN_EXPORT_HANDOFF_STALE_MS;
  const scopeMatches = handoff.tenantId === workspaceBoundary.tenantId && handoff.workspaceId === workspaceBoundary.workspaceId;
  const exportToken = normalizeString(handoff.exportToken, "");
  const blockedReasons = normalizeStringList(handoff.blockedReasons);
  const counters = handoff.counters && typeof handoff.counters === "object" ? handoff.counters : {};
  const freshness = handoff.freshness && typeof handoff.freshness === "object" ? handoff.freshness : {};
  const rowSetChecksums = handoff.rowSetChecksums && typeof handoff.rowSetChecksums === "object" ? handoff.rowSetChecksums : {};
  const datasets = Array.isArray(handoff.datasets)
    ? handoff.datasets
        .filter((dataset) => dataset && typeof dataset === "object")
        .map((dataset) => ({
          dataset: normalizeString(dataset.dataset, "unknown"),
          included: dataset.included !== false,
          checksum: normalizeString(dataset.checksum, null)
        }))
    : [];
  const validationCodes = [
    contract !== "aios.cli-run.dashboard-export-handoff.v1" ? "contract-mismatch" : null,
    !scopeMatches ? "scope-mismatch" : null,
    !exportToken.startsWith("cli_run_export_") ? "missing-export-token" : null,
    !generatedAt || !Number.isFinite(generatedMs) ? "generated-at-invalid" : null,
    fromFuture ? "generated-at-future-drift" : null,
    stale ? "handoff-stale" : null,
    blockedReasons.length > 0 ? "source-blocked" : null,
    workspaceBoundary.permissionBoundary.canReadDashboard ? null : "dashboard-read-denied"
  ].filter(Boolean);
  const state = !scopeMatches
    ? "scope-blocked"
    : validationCodes.includes("contract-mismatch") || validationCodes.includes("missing-export-token") || validationCodes.includes("generated-at-invalid") || validationCodes.includes("generated-at-future-drift")
      ? "invalid"
      : blockedReasons.length > 0
        ? "source-blocked"
        : stale
          ? "stale"
          : "ready";
  const accepted = state === "ready";
  const reason = accepted
    ? "cli-run analytics export handoff is scoped, fresh, and ready for dashboard ingestion."
    : state === "scope-blocked"
      ? "cli-run analytics export handoff belongs to a different tenant or workspace."
      : state === "source-blocked"
        ? blockedReasons[0]
        : state === "stale"
          ? "cli-run analytics export handoff is older than the dashboard freshness window."
          : validationCodes[0] || "cli-run analytics export handoff cannot be accepted.";

  return {
    contractVersion: "dashboard-cli-run-export-handoff.v1",
    present: true,
    state,
    accepted,
    reason,
    contract,
    tenantId: handoff.tenantId || null,
    workspaceId: handoff.workspaceId || null,
    runId: normalizeString(handoff.runId, null),
    epoch: Math.trunc(normalizeNumber(handoff.epoch, 0, { min: 0 })),
    generatedAt,
    ageMs,
    staleAfterMs: CLI_RUN_EXPORT_HANDOFF_STALE_MS,
    exportToken,
    route: normalizeString(handoff.route, `${workspaceBoundary.routeScope}/cli-run/export`),
    scopeMatches,
    validationCodes,
    blockedReasons,
    counters: {
      totalCommands: Math.trunc(normalizeNumber(counters.totalCommands, 0, { min: 0 })),
      activeCommands: Math.trunc(normalizeNumber(counters.activeCommands, 0, { min: 0 })),
      terminalCommands: Math.trunc(normalizeNumber(counters.terminalCommands, 0, { min: 0 })),
      staleCommands: Math.trunc(normalizeNumber(counters.staleCommands, 0, { min: 0 })),
      exportRows: Math.trunc(normalizeNumber(counters.exportRows, 0, { min: 0 })),
      historySnapshots: Math.trunc(normalizeNumber(counters.historySnapshots, 0, { min: 0 })),
      timelineEvents: Math.trunc(normalizeNumber(counters.timelineEvents, 0, { min: 0 })),
      warningCodes: Math.trunc(normalizeNumber(counters.warningCodes, 0, { min: 0 }))
    },
    freshness: {
      latestSnapshotAt: normalizeString(freshness.latestSnapshotAt, null),
      previousSnapshotAt: normalizeString(freshness.previousSnapshotAt, null),
      latestTimelineAt: normalizeString(freshness.latestTimelineAt, null),
      latestTimelineAgeMs: freshness.latestTimelineAgeMs === null || freshness.latestTimelineAgeMs === undefined
        ? null
        : Math.trunc(normalizeNumber(freshness.latestTimelineAgeMs, 0, { min: 0 })),
      trendSampleCount: Math.trunc(normalizeNumber(freshness.trendSampleCount, 0, { min: 0 })),
      boundedByHistoryLimit: freshness.boundedByHistoryLimit === true
    },
    datasets,
    rowSetChecksums,
    action: {
      id: accepted ? "ingest-cli-run-export" : stale ? "refresh-cli-run-export" : "repair-cli-run-export",
      label: accepted ? "Ingest cli-run analytics export" : stale ? "Refresh cli-run analytics export" : "Repair cli-run analytics export",
      route: accepted ? `${workspaceBoundary.routeScope}/analytics/cli-run/import` : `${workspaceBoundary.routeScope}/analytics/cli-run/export`,
      enabled: accepted && workspaceBoundary.permissionBoundary.canReadDashboard,
      reason
    },
    proofId: proofToken({
      workspace: workspaceBoundary.workspaceId,
      cursor: syncMetadata.cursor,
      contract,
      runId: handoff.runId,
      epoch: handoff.epoch,
      generatedAt,
      state,
      exportToken,
      rowSetChecksums
    })
  };
}

function normalizeMailchimpCampaignHandoff(input, workspaceBoundary, syncMetadata, operationalHealth, now) {
  const direct = input && typeof input.mailchimpCampaignHealth === "object" && input.mailchimpCampaignHealth !== null
    ? input.mailchimpCampaignHealth
    : input && typeof input.cliLogs === "object" && input.cliLogs !== null && input.cliLogs.mailchimpCampaignHealth && typeof input.cliLogs.mailchimpCampaignHealth === "object"
      ? input.cliLogs.mailchimpCampaignHealth
      : input && typeof input.cliRunMailchimpCampaignHandoff === "object" && input.cliRunMailchimpCampaignHandoff !== null
        ? input.cliRunMailchimpCampaignHandoff
        : input && typeof input.cliRun === "object" && input.cliRun !== null && input.cliRun.mailchimpCampaignHandoff && typeof input.cliRun.mailchimpCampaignHandoff === "object"
          ? input.cliRun.mailchimpCampaignHandoff
          : input && typeof input.cliRun === "object" && input.cliRun !== null && input.cliRun.state && typeof input.cliRun.state === "object" && input.cliRun.state.mailchimpCampaignHandoff && typeof input.cliRun.state.mailchimpCampaignHandoff === "object"
            ? input.cliRun.state.mailchimpCampaignHandoff
            : input && typeof input.cliRun === "object" && input.cliRun !== null && input.cliRun.processCreation?.source?.mailchimpCampaign && typeof input.cliRun.processCreation.source.mailchimpCampaign === "object"
              ? input.cliRun.processCreation.source.mailchimpCampaign
              : null;
  const fallback = input && typeof input.mailchimp === "object" && input.mailchimp !== null ? input.mailchimp : {};
  const source = direct || fallback;
  const present = Boolean(direct || fallback.enabled === true || fallback.present === true || fallback.campaignId || fallback.providerState);
  const generatedAt = normalizeString(source.generatedAt, now);
  const generatedMs = Date.parse(generatedAt);
  const nowMs = Date.parse(now);
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const ageMs = Number.isFinite(generatedMs) ? Math.max(0, safeNowMs - generatedMs) : null;
  const fromFuture = Number.isFinite(generatedMs) ? generatedMs - safeNowMs > HEALTH_OBSERVATION_FUTURE_DRIFT_MS : false;
  const freshness = source.freshness && typeof source.freshness === "object" ? source.freshness : {};
  const retry = source.retry && typeof source.retry === "object" ? source.retry : {};
  const handoff = source.handoff && typeof source.handoff === "object" ? source.handoff : {};
  const exportReadinessSource = source.exportReadiness && typeof source.exportReadiness === "object"
    ? source.exportReadiness
    : source.mailchimpExportReadiness && typeof source.mailchimpExportReadiness === "object"
      ? source.mailchimpExportReadiness
      : input && typeof input.mailchimpExportReadiness === "object" && input.mailchimpExportReadiness !== null
        ? input.mailchimpExportReadiness
        : input && typeof input.cliLogs === "object" && input.cliLogs !== null && input.cliLogs.mailchimpExportReadiness && typeof input.cliLogs.mailchimpExportReadiness === "object"
          ? input.cliLogs.mailchimpExportReadiness
          : {};
  const deliveryReadiness = source.deliveryReadiness && typeof source.deliveryReadiness === "object" ? source.deliveryReadiness : {};
  const actionableErrors = Array.isArray(source.actionableErrors)
    ? source.actionableErrors
        .filter((error) => error && typeof error === "object")
        .map((error, index) => ({
          id: normalizeString(error.id, `mailchimp-error-${index + 1}`),
          code: normalizeString(error.code, "mailchimp_error"),
          severity: error.severity === "critical" || error.severity === "error" ? "error" : "warning",
          message: normalizeString(error.message, "Mailchimp campaign handoff reported an error."),
          retryable: error.retryable === true,
          route: normalizeString(error.route, `${workspaceBoundary.routeScope}/integrations/mailchimp/errors`)
        }))
    : [];
  const validation = normalizeStringList(source.validation);
  const state = normalizeString(source.state, present ? "unknown" : "not-present");
  const scopeTenant = normalizeString(source.tenantId, workspaceBoundary.tenantId);
  const scopeWorkspace = normalizeString(source.workspaceId, workspaceBoundary.workspaceId);
  const scopeMatches = scopeTenant === workspaceBoundary.tenantId && scopeWorkspace === workspaceBoundary.workspaceId;
  const exportScopeTenant = normalizeString(exportReadinessSource.tenantId, scopeTenant);
  const exportScopeWorkspace = normalizeString(exportReadinessSource.workspaceId, scopeWorkspace);
  const exportScopeMatches = exportScopeTenant === workspaceBoundary.tenantId && exportScopeWorkspace === workspaceBoundary.workspaceId;
  const exportReadinessPresent = Object.keys(exportReadinessSource).length > 0;
  const exportReadinessAccepted = exportReadinessSource.accepted === true;
  const exportReadinessValidation = normalizeStringList(exportReadinessSource.validation);
  const exportReadinessState = normalizeString(exportReadinessSource.state, exportReadinessPresent ? "unknown" : "not-present");
  const exportReadinessCounters = exportReadinessSource.counters && typeof exportReadinessSource.counters === "object" ? exportReadinessSource.counters : {};
  const exportPackage = exportReadinessSource.exportPackage && typeof exportReadinessSource.exportPackage === "object" ? exportReadinessSource.exportPackage : {};
  const retryableErrors = actionableErrors.filter((error) => error.retryable);
  const blockingErrors = actionableErrors.filter((error) => error.severity === "error" && !error.retryable);
  const stale = freshness.stale === true || (ageMs !== null && ageMs > CLI_RUN_EXPORT_HANDOFF_STALE_MS);
  const attachProofReady = deliveryReadiness.canAttachLogProof === true
    || (deliveryReadiness.canAttachLogProof === undefined && state === "ready");
  const validationCodes = [
    present ? null : "not-present",
    !scopeMatches ? "scope-mismatch" : null,
    exportReadinessPresent && !exportScopeMatches ? "export-readiness-scope-mismatch" : null,
    exportReadinessPresent && !exportReadinessAccepted ? "mailchimp-export-readiness-blocked" : null,
    fromFuture ? "generated-at-future-drift" : null,
    stale && state !== "not-configured" ? "mailchimp-sync-stale" : null,
    validation.length > 0 ? "source-validation" : null,
    blockingErrors.length > 0 ? "blocking-mailchimp-errors" : null,
    workspaceBoundary.permissionBoundary.canReadDashboard ? null : "dashboard-read-denied",
    operationalHealth.state === "blocked" ? "dashboard-health-blocked" : null
  ].filter(Boolean);
  const accepted = present
    && scopeMatches
    && !fromFuture
    && (!exportReadinessPresent || (exportScopeMatches && exportReadinessAccepted))
    && validation.length === 0
    && blockingErrors.length === 0
    && (state === "not-configured" || attachProofReady)
    && workspaceBoundary.permissionBoundary.canReadDashboard
    && operationalHealth.state !== "blocked";
  const dashboardState = !present
    ? "not-present"
    : !scopeMatches
      ? "scope-blocked"
      : exportReadinessPresent && !exportScopeMatches
        ? "scope-blocked"
        : exportReadinessPresent && !exportReadinessAccepted && exportReadinessState !== "retry-after-sync"
          ? "export-blocked"
          : accepted && (state === "ready" || state === "not-configured")
            ? "ready"
            : state === "blocked" || blockingErrors.length > 0
              ? "blocked"
              : state === "rate-limited"
                ? "rate-limited"
                : stale || retryableErrors.length > 0 || state === "degraded"
                  ? "degraded"
                  : accepted
                    ? "ready"
                    : "needs-attention";
  const primaryReason = !present
    ? "No Mailchimp campaign handoff was supplied."
    : !scopeMatches
      ? "Mailchimp campaign handoff belongs to a different tenant or workspace."
      : exportReadinessPresent && !exportScopeMatches
        ? "Mailchimp export readiness belongs to a different tenant or workspace."
        : exportReadinessValidation[0] || validation[0] || blockingErrors[0]?.message || deliveryReadiness.reason || (stale ? "Mailchimp campaign sync is stale." : null) || "Mailchimp campaign handoff is ready.";
  const route = normalizeString(handoff.route, `${workspaceBoundary.routeScope}/integrations/mailchimp`);
  const retryAfterMs = retry.retryAfterMs === null || retry.retryAfterMs === undefined
    ? null
    : Math.trunc(normalizeNumber(retry.retryAfterMs, 0, { min: 0, max: 300000 }));
  const retryable = retry.retryable === true || retryableErrors.length > 0 || dashboardState === "rate-limited" || dashboardState === "degraded";
  const retryToken = retryable
    ? proofToken({
        workspace: workspaceBoundary.workspaceId,
        cursor: syncMetadata.cursor,
        campaignId: source.campaignId,
        state: dashboardState,
        retryAfterMs,
        errors: actionableErrors.map((error) => error.code)
      })
    : null;

  return {
    contractVersion: "dashboard-mailchimp-campaign-handoff.v1",
    sourceContract: normalizeString(source.contract || source.contractVersion, null),
    present,
    accepted,
    state: dashboardState,
    sourceState: state,
    provider: "mailchimp",
    campaignId: normalizeString(source.campaignId, null),
    audienceId: normalizeString(source.audienceId, null),
    providerState: normalizeString(source.providerState, "unknown"),
    campaignStatus: normalizeString(source.campaignStatus, "unknown"),
    generatedAt,
    ageMs,
    scopeMatches,
    validationCodes,
    validation,
    exportReadiness: {
      present: exportReadinessPresent,
      accepted: exportReadinessAccepted,
      state: exportReadinessState,
      scopeMatches: exportScopeMatches,
      validation: exportReadinessValidation,
      counters: {
        exportableRecords: Math.trunc(normalizeNumber(exportReadinessCounters.exportableRecords, 0, { min: 0, max: 1000000 })),
        attachableRecords: Math.trunc(normalizeNumber(exportReadinessCounters.attachableRecords, 0, { min: 0, max: 1000000 })),
        proofIds: Math.trunc(normalizeNumber(exportReadinessCounters.proofIds, 0, { min: 0, max: 1000000 })),
        priorExports: Math.trunc(normalizeNumber(exportReadinessCounters.priorExports, 0, { min: 0, max: 1000000 })),
        blockedExports: Math.trunc(normalizeNumber(exportReadinessCounters.blockedExports, 0, { min: 0, max: 1000000 })),
      },
      package: {
        reportId: normalizeString(exportPackage.reportId, null),
        exportId: normalizeString(exportPackage.exportId, null),
        recordCount: Math.trunc(normalizeNumber(exportPackage.recordCount, 0, { min: 0, max: 1000000 })),
        rootHash: normalizeString(exportPackage.rootHash, null),
        formats: normalizeStringList(exportPackage.formats),
        redactionSafe: exportPackage.redactionSafe !== false,
        payloadRef: normalizeString(exportReadinessSource.handoff?.payloadRef, null),
        proofDigest: normalizeString(exportReadinessSource.handoff?.proofDigest, null)
      }
    },
    freshness: {
      lastSyncAt: normalizeString(freshness.lastSyncAt, null),
      ageMs: freshness.ageMs === null || freshness.ageMs === undefined ? null : Math.trunc(normalizeNumber(freshness.ageMs, 0, { min: 0 })),
      stale,
      syncCursor: normalizeString(freshness.syncCursor, syncMetadata.cursor)
    },
    retry: {
      retryable,
      retryAfterMs,
      nextRetryAt: normalizeString(retry.nextRetryAt, retryable && retryAfterMs !== null ? new Date(safeNowMs + retryAfterMs).toISOString() : null),
      retryToken
    },
    actionableErrors,
    deliveryReadiness: {
      canAttachLogProof: deliveryReadiness.canAttachLogProof === true && accepted && (!exportReadinessPresent || exportReadinessAccepted),
      canContinueInDegradedMode: deliveryReadiness.canContinueInDegradedMode === true || dashboardState === "degraded" || dashboardState === "rate-limited",
      disabledCommands: normalizeStringList(deliveryReadiness.disabledCommands),
      reason: primaryReason
    },
    action: {
      id: dashboardState === "ready" ? "attach-mailchimp-log-proof" : retryable ? "retry-mailchimp-campaign-sync" : dashboardState === "export-blocked" ? "repair-mailchimp-export-package" : present ? "repair-mailchimp-campaign-handoff" : "configure-mailchimp-campaign",
      label: dashboardState === "ready" ? "Attach Mailchimp log proof" : retryable ? "Retry Mailchimp campaign sync" : dashboardState === "export-blocked" ? "Repair Mailchimp export package" : present ? "Repair Mailchimp campaign handoff" : "Configure Mailchimp campaign",
      route: dashboardState === "ready" ? `${workspaceBoundary.routeScope}/integrations/mailchimp/proof` : route,
      enabled: present && workspaceBoundary.permissionBoundary.canReadDashboard && dashboardState !== "ready",
      reason: primaryReason
    },
    proofId: proofToken({
      workspace: workspaceBoundary.workspaceId,
      cursor: syncMetadata.cursor,
      sourceState: state,
      dashboardState,
      campaignId: source.campaignId,
      audienceId: source.audienceId,
      validationCodes,
      exportReadinessState,
      exportPackageRootHash: exportPackage.rootHash || null,
      retryToken
    })
  };
}

function buildAuditProof({ provider, capabilityNegotiation, syncMetadata, clientRuntime, workspaceBoundary, providerServiceContract, evidence, now }) {
  const evidenceList = Array.isArray(evidence) ? evidence : [];
  const normalizedEvidence = evidenceList
    .filter((entry) => entry !== null && entry !== undefined)
    .map((entry, index) => ({
      index,
      type: typeof entry === "object" ? "structured" : "text",
      value: entry
    }));

  const proof = {
    surfaceId,
    providerId: provider.id,
    providerRevision: provider.revision,
    grantedCapabilities: capabilityNegotiation.granted,
    syncCursor: syncMetadata.cursor,
    requestId: clientRuntime?.requestId || null,
    clientIntent: clientRuntime?.intent || null,
    tenantId: workspaceBoundary?.tenantId || null,
    workspaceId: workspaceBoundary?.workspaceId || null,
    boundaryProof: workspaceBoundary?.boundaryProof || null,
    permissionProof: workspaceBoundary?.permissionProof || null,
    permissionState: workspaceBoundary?.permissionState || "unknown",
    isolationState: workspaceBoundary?.isolationState || "unknown",
    providerServiceProofId: providerServiceContract?.proofId || null,
    providerServiceState: providerServiceContract?.state || "unknown",
    generatedAt: now,
    evidenceCount: normalizedEvidence.length
  };

  return {
    proofId: proofToken(proof),
    proof,
    evidence: normalizedEvidence,
    auditRoute: `${workspaceBoundary?.routeScope || `${surfaceGroup}/${surfaceName}`}/audit/provider-contract`
  };
}

function normalizePreviewRequest(input = {}) {
  const preview = input && typeof input.preview === "object" && input.preview !== null ? input.preview : {};
  const requestedPanels = Array.isArray(preview.panels)
    ? preview.panels.filter((panel) => typeof panel === "string" && panel.trim()).map((panel) => panel.trim())
    : [];
  const panelSet = requestedPanels.length > 0 ? [...new Set(requestedPanels)] : ["kernel-status", "sync-state", "handoff"];
  const audience = preview.audience === "automation" ? "automation" : "operator";
  const detail = preview.detail === "compact" ? "compact" : "full";

  return {
    requested: preview.requested !== false,
    audience,
    detail,
    panels: panelSet
  };
}

function normalizeClientRuntime(input = {}, now) {
  const client = input && typeof input.client === "object" && input.client !== null ? input.client : {};
  const request = input && typeof input.request === "object" && input.request !== null ? input.request : {};
  const rawIntent = typeof request.intent === "string" && request.intent.trim()
    ? request.intent.trim()
    : typeof client.intent === "string" && client.intent.trim()
      ? client.intent.trim()
      : "status-check";
  const intent = CLIENT_INTENTS.includes(rawIntent) ? rawIntent : "status-check";
  const rawStage = typeof client.workflowStage === "string" && client.workflowStage.trim()
    ? client.workflowStage.trim()
    : intent === "handoff"
      ? "handoff"
      : "inspect";
  const workflowStage = CLIENT_WORKFLOW_STAGES.includes(rawStage) ? rawStage : "inspect";
  const rawDelivery = typeof client.deliveryMode === "string" && client.deliveryMode.trim()
    ? client.deliveryMode.trim()
    : workflowStage === "handoff"
      ? "drawer"
      : "inline";
  const deliveryMode = CLIENT_DELIVERY_MODES.includes(rawDelivery) ? rawDelivery : "inline";
  const requestId = typeof request.id === "string" && request.id.trim()
    ? request.id.trim()
    : proofToken({ surfaceId, now, intent, workflowStage }).replace("proof_", "request_");
  const sessionId = typeof client.sessionId === "string" && client.sessionId.trim()
    ? client.sessionId.trim()
    : "anonymous-session";
  const actor = typeof client.actor === "string" && client.actor.trim()
    ? client.actor.trim()
    : "operator";
  const originRoute = typeof client.originRoute === "string" && client.originRoute.trim()
    ? client.originRoute.trim()
    : `${surfaceGroup}/${surfaceName}`;
  const selectedPanel = typeof client.selectedPanel === "string" && client.selectedPanel.trim()
    ? client.selectedPanel.trim()
    : intent === "sync-review"
      ? "sync-state"
      : intent === "handoff"
        ? "handoff"
        : "kernel-status";
  const acknowledgementRequired = client.acknowledgementRequired === true || intent === "acceptance";

  return {
    contractVersion: "dashboard-client-runtime.v1",
    requestId,
    sessionId,
    actor,
    intent,
    workflowStage,
    deliveryMode,
    originRoute,
    selectedPanel,
    acknowledgementRequired,
    receivedAt: now
  };
}

function normalizeClientWorkflowState(input = {}, clientRuntime, handoff, previewRequest, workspaceBoundary, now) {
  const client = input && typeof input.client === "object" && input.client !== null ? input.client : {};
  const request = input && typeof input.request === "object" && input.request !== null ? input.request : {};
  const workflow = client.workflow && typeof client.workflow === "object" && client.workflow !== null
    ? client.workflow
    : request.workflow && typeof request.workflow === "object" && request.workflow !== null
      ? request.workflow
      : {};
  const requestedChannel = typeof workflow.handoffChannel === "string" && workflow.handoffChannel.trim()
    ? workflow.handoffChannel.trim()
    : clientRuntime.deliveryMode === "external"
      ? "new-tab"
      : clientRuntime.deliveryMode === "drawer"
        ? "embedded"
        : "same-tab";
  const requestedReturnStrategy = typeof workflow.returnStrategy === "string" && workflow.returnStrategy.trim()
    ? workflow.returnStrategy.trim()
    : clientRuntime.intent === "acceptance"
      ? "acceptance-gate"
      : clientRuntime.intent === "handoff" || clientRuntime.workflowStage === "resume"
        ? "resume-primary-action"
        : "preserve-panel";
  const channel = CLIENT_HANDOFF_CHANNELS.includes(requestedChannel) ? requestedChannel : "same-tab";
  const returnStrategy = CLIENT_RETURN_STRATEGIES.includes(requestedReturnStrategy) ? requestedReturnStrategy : "preserve-panel";
  const rawStepId = typeof workflow.stepId === "string" && workflow.stepId.trim()
    ? workflow.stepId.trim()
    : `${clientRuntime.workflowStage}:${clientRuntime.selectedPanel}`;
  const originRoute = normalizeString(workflow.originRoute, clientRuntime.originRoute);
  const returnRoute = normalizeString(
    workflow.returnRoute,
    returnStrategy === "acceptance-gate"
      ? `${workspaceBoundary.routeScope}/acceptance/${clientRuntime.requestId}`
      : `${workspaceBoundary.routeScope}/preview/${clientRuntime.selectedPanel}`
  );
  const handoffRoute = normalizeString(
    workflow.handoffRoute,
    `${workspaceBoundary.routeScope}/handoff/${handoff.target}`
  );
  const visiblePanelIds = previewRequest.requested ? previewRequest.panels : [];
  const selectedPanelVisible = visiblePanelIds.includes(clientRuntime.selectedPanel);
  const handoffRequested = clientRuntime.intent === "handoff" || handoff.requested || clientRuntime.workflowStage === "handoff";
  const resumeRequested = clientRuntime.workflowStage === "resume" || typeof workflow.resumeToken === "string";
  const pendingActions = [
    selectedPanelVisible ? null : {
      id: "restore-selected-panel",
      label: "Restore selected panel",
      route: `${workspaceBoundary.routeScope}/preview/${clientRuntime.selectedPanel}`,
      reason: `${clientRuntime.selectedPanel} is not present in the active preview payload.`
    },
    handoffRequested ? {
      id: "prepare-hosted-kernel-handoff",
      label: "Prepare hosted-kernel handoff",
      route: handoffRoute,
      reason: handoff.state === "prepared" ? "Hosted-kernel handoff is prepared." : handoff.reason || "Client requested a handoff workflow."
    } : null,
    resumeRequested ? {
      id: "resume-client-workflow",
      label: "Resume client workflow",
      route: returnRoute,
      reason: "Client workflow stage requested resume semantics."
    } : null
  ].filter(Boolean);
  const state = workspaceBoundary.isolationState === "blocked"
    ? "blocked"
    : handoffRequested && handoff.state === "blocked"
      ? "blocked"
      : resumeRequested && handoff.state === "prepared"
        ? "resume-pending"
        : pendingActions.length > 0
          ? "handoff-pending"
          : "in-place";

  return {
    contractVersion: "dashboard-client-workflow-state.v1",
    requestId: clientRuntime.requestId,
    sessionId: clientRuntime.sessionId,
    stepId: rawStepId,
    stage: clientRuntime.workflowStage,
    intent: clientRuntime.intent,
    channel,
    returnStrategy,
    originRoute,
    returnRoute,
    handoffRoute,
    selectedPanelId: clientRuntime.selectedPanel,
    selectedPanelVisible,
    state,
    pendingActionCount: pendingActions.length,
    pendingActions,
    issuedAt: now,
    proofId: proofToken({
      requestId: clientRuntime.requestId,
      workspace: workspaceBoundary.workspaceId,
      stepId: rawStepId,
      channel,
      returnStrategy,
      selectedPanelVisible,
      handoffState: handoff.state,
      state
    })
  };
}

function normalizePersistedDashboardState(input = {}, now, workspaceBoundary = null) {
  const persisted = input && typeof input.persistedState === "object" && input.persistedState !== null
    ? input.persistedState
    : {};
  const rawSnapshot = persisted.snapshot && typeof persisted.snapshot === "object" ? persisted.snapshot : persisted;
  const schemaVersion = rawSnapshot.schemaVersion === PERSISTED_STATE_VERSION
    ? rawSnapshot.schemaVersion
    : PERSISTED_STATE_VERSION;
  const status = ["ready", "degraded", "blocked", "recovering"].includes(rawSnapshot.status)
    ? rawSnapshot.status
    : "recovering";
  const lastKnownCursor = typeof rawSnapshot.lastKnownCursor === "string" && rawSnapshot.lastKnownCursor.trim()
    ? rawSnapshot.lastKnownCursor.trim()
    : DEFAULT_SYNC_CURSOR;
  const lastRequestId = typeof rawSnapshot.lastRequestId === "string" && rawSnapshot.lastRequestId.trim()
    ? rawSnapshot.lastRequestId.trim()
    : null;
  const lastAcceptedToken = typeof rawSnapshot.lastAcceptedToken === "string" && rawSnapshot.lastAcceptedToken.trim()
    ? rawSnapshot.lastAcceptedToken.trim()
    : null;
  const restartCount = Number.isInteger(rawSnapshot.restartCount) && rawSnapshot.restartCount >= 0
    ? rawSnapshot.restartCount
    : 0;
  const recoveredFrom = typeof persisted.recoveredFrom === "string" && persisted.recoveredFrom.trim()
    ? persisted.recoveredFrom.trim()
    : null;
  const lastWriteId = typeof rawSnapshot.lastWriteId === "string" && rawSnapshot.lastWriteId.trim()
    ? rawSnapshot.lastWriteId.trim()
    : proofToken({ lastKnownCursor, lastRequestId, restartCount }).replace("proof_", "state_");
  const rawCommandHistory = Array.isArray(rawSnapshot.commandHistory)
    ? rawSnapshot.commandHistory
    : Array.isArray(persisted.commandHistory)
      ? persisted.commandHistory
      : [];
  const commandHistory = rawCommandHistory
    .filter((entry) => entry && typeof entry === "object")
    .slice(-PERSISTED_COMMAND_HISTORY_LIMIT)
    .map((entry, index) => {
      const commandId = normalizeString(entry.commandId || entry.id, `persisted-command-${index + 1}`);
      const idempotencyKey = normalizeString(entry.idempotencyKey || entry.key, commandId);
      const type = COMMAND_TYPES.includes(entry.type) ? entry.type : "refresh-status";
      const state = ["accepted", "blocked", "deduplicated", "replayed"].includes(entry.state) ? entry.state : "accepted";
      const writeId = normalizeString(entry.writeId || entry.resultingWriteId, lastWriteId);
      const cursor = normalizeString(entry.cursor, lastKnownCursor);
      const requestId = typeof entry.requestId === "string" && entry.requestId.trim() ? entry.requestId.trim() : null;
      const acceptedAt = normalizeString(entry.acceptedAt || entry.updatedAt || entry.observedAt, now);

      return {
        contractVersion: "dashboard-persisted-command.v1",
        commandId,
        idempotencyKey,
        type,
        state,
        writeId,
        cursor,
        requestId,
        acceptedAt,
        replayToken: proofToken({ commandId, idempotencyKey, type, writeId, cursor }).replace("proof_", "replay_")
      };
    });
  const duplicateCommandKeys = commandHistory.reduce((keys, entry) => {
    keys[entry.commandId] = (keys[entry.commandId] || 0) + 1;
    keys[entry.idempotencyKey] = (keys[entry.idempotencyKey] || 0) + 1;
    return keys;
  }, {});
  const commandLedgerProof = proofToken({
    lastWriteId,
    restartCount,
    commands: commandHistory.map((entry) => [entry.commandId, entry.idempotencyKey, entry.writeId, entry.cursor])
  });
  const rawOperationalSnapshot = rawSnapshot.operationalSnapshot && typeof rawSnapshot.operationalSnapshot === "object"
    ? rawSnapshot.operationalSnapshot
    : persisted.operationalSnapshot && typeof persisted.operationalSnapshot === "object"
      ? persisted.operationalSnapshot
      : {};
  const snapshotScope = normalizePersistedScopeClaim(
    rawOperationalSnapshot,
    normalizePersistedScopeClaim(rawSnapshot, {}, workspaceBoundary, "persisted-dashboard-state"),
    workspaceBoundary,
    "persisted-operational-snapshot"
  );
  const capturedAt = normalizeString(rawOperationalSnapshot.capturedAt || rawOperationalSnapshot.generatedAt, now);
  const capturedMs = Date.parse(capturedAt);
  const nowMs = Date.parse(now);
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const ageMs = Number.isFinite(capturedMs) ? Math.max(0, safeNowMs - capturedMs) : null;
  const restoredBlockerCandidates = Array.isArray(rawOperationalSnapshot.blockers)
    ? rawOperationalSnapshot.blockers
      .filter((blocker) => blocker && typeof blocker === "object")
      .map((blocker, index) => {
        const id = normalizeString(blocker.id || blocker.code, `persisted-blocker-${index + 1}`);
        return {
          id,
          severity: blocker.severity === "error" ? "error" : blocker.severity === "warning" ? "warning" : "info",
          route: normalizeString(blocker.route, `${workspaceBoundary?.routeScope || `${surfaceGroup}/${surfaceName}`}/state/recovery`),
          message: normalizeString(blocker.message || blocker.reason, "Persisted dashboard blocker requires recovery review."),
          scopeClaim: normalizePersistedScopeClaim(blocker, snapshotScope, workspaceBoundary, `blocker:${id}`)
        };
      })
      .slice(0, 12)
    : [];
  const persistedBlockers = restoredBlockerCandidates.filter((blocker) => blocker.scopeClaim.trusted);
  const quarantinedBlockers = restoredBlockerCandidates
    .filter((blocker) => !blocker.scopeClaim.trusted)
    .map((blocker) => ({
      kind: "blocker",
      id: blocker.id,
      severity: blocker.severity,
      route: blocker.route,
      message: blocker.message,
      scopeState: blocker.scopeClaim.state,
      reason: blocker.scopeClaim.reason
    }));
  const restoredJobCandidates = Array.isArray(rawOperationalSnapshot.jobs)
    ? rawOperationalSnapshot.jobs
      .filter((job) => job && typeof job === "object")
      .map((job, index) => {
        const id = normalizeString(job.id || job.jobId, `persisted-job-${index + 1}`);
        return {
          id,
          state: RUNNING_JOB_STATES.includes(job.state) ? job.state : "queued",
          progressPercent: Math.trunc(normalizeNumber(job.progressPercent ?? job.progress, 0, { min: 0, max: 100 })),
          cursor: normalizeString(job.cursor, lastKnownCursor),
          writeId: typeof job.writeId === "string" && job.writeId.trim() ? job.writeId.trim() : null,
          scopeClaim: normalizePersistedScopeClaim(job, snapshotScope, workspaceBoundary, `job:${id}`)
        };
      })
      .slice(0, 24)
    : [];
  const persistedJobs = restoredJobCandidates.filter((job) => job.scopeClaim.trusted);
  const quarantinedJobs = restoredJobCandidates
    .filter((job) => !job.scopeClaim.trusted)
    .map((job) => ({
      kind: "job",
      id: job.id,
      state: job.state,
      cursor: job.cursor,
      writeId: job.writeId,
      scopeState: job.scopeClaim.state,
      reason: job.scopeClaim.reason
    }));
  const persistedProofRefs = rawOperationalSnapshot.proofRefs && typeof rawOperationalSnapshot.proofRefs === "object"
    ? Object.keys(rawOperationalSnapshot.proofRefs).sort().reduce((refs, key) => {
      const value = rawOperationalSnapshot.proofRefs[key];
      refs[key] = typeof value === "string" && value.trim() ? value.trim() : null;
      return refs;
    }, {})
    : {};
  const proofRefScope = normalizePersistedScopeClaim(
    rawOperationalSnapshot.proofScope && typeof rawOperationalSnapshot.proofScope === "object" ? rawOperationalSnapshot.proofScope : rawOperationalSnapshot,
    snapshotScope,
    workspaceBoundary,
    "proofRefs"
  );
  const quarantinedScopeViolations = [
    snapshotScope.trusted ? null : {
      kind: "snapshot",
      id: "persisted-operational-snapshot",
      scopeState: snapshotScope.state,
      reason: snapshotScope.reason
    },
    proofRefScope.trusted || Object.keys(persistedProofRefs).length === 0 ? null : {
      kind: "proofRefs",
      id: "proofRefs",
      scopeState: proofRefScope.state,
      reason: proofRefScope.reason
    },
    ...quarantinedBlockers,
    ...quarantinedJobs
  ].filter(Boolean);
  const trustedProofRefs = proofRefScope.trusted ? persistedProofRefs : {};
  const operationalSnapshot = {
    contractVersion: "dashboard-persisted-operational-snapshot.v1",
    present: Object.keys(rawOperationalSnapshot).length > 0,
    tenantId: snapshotScope.tenantId,
    workspaceId: snapshotScope.workspaceId,
    boundaryProof: snapshotScope.boundaryProof,
    scopeState: snapshotScope.state,
    scopeTrusted: snapshotScope.trusted,
    quarantinedScopeViolationCount: quarantinedScopeViolations.length,
    quarantinedScopeViolations,
    capturedAt,
    ageMs,
    stale: ageMs === null || ageMs > PERSISTED_OPERATIONAL_SNAPSHOT_STALE_MS,
    staleAfterMs: PERSISTED_OPERATIONAL_SNAPSHOT_STALE_MS,
    kernelState: normalizeString(rawOperationalSnapshot.kernelState || rawOperationalSnapshot.operationalHealthState, "unknown"),
    readinessState: normalizeString(rawOperationalSnapshot.readinessState || rawOperationalSnapshot.status, status),
    proofState: normalizeString(rawOperationalSnapshot.proofState, "unknown"),
    blockerCount: persistedBlockers.length,
    jobCount: persistedJobs.length,
    activeJobCount: persistedJobs.filter((job) => job.state === "queued" || job.state === "running").length,
    blockedJobCount: persistedJobs.filter((job) => job.state === "blocked" || job.state === "failed").length,
    blockers: persistedBlockers,
    jobs: persistedJobs,
    proofRefs: trustedProofRefs,
    proofRefCount: Object.keys(trustedProofRefs).length,
    quarantinedProofRefCount: proofRefScope.trusted ? 0 : Object.keys(persistedProofRefs).length,
    snapshotProof: proofToken({
      lastWriteId,
      tenantId: snapshotScope.tenantId,
      workspaceId: snapshotScope.workspaceId,
      boundaryProof: snapshotScope.boundaryProof,
      scopeState: snapshotScope.state,
      capturedAt,
      kernelState: rawOperationalSnapshot.kernelState || rawOperationalSnapshot.operationalHealthState,
      readinessState: rawOperationalSnapshot.readinessState || rawOperationalSnapshot.status,
      blockers: persistedBlockers.map((blocker) => [blocker.id, blocker.severity, blocker.route]),
      jobs: persistedJobs.map((job) => [job.id, job.state, job.progressPercent, job.cursor]),
      proofRefs: trustedProofRefs,
      quarantinedScopeViolations: quarantinedScopeViolations.map((violation) => [violation.kind, violation.id, violation.scopeState])
    })
  };

  return {
    contractVersion: PERSISTED_STATE_VERSION,
    schemaVersion,
    status,
    lastKnownCursor,
    lastRequestId,
    lastAcceptedToken,
    restartCount,
    recoveredFrom,
    lastWriteId,
    commandHistory,
    commandHistoryLimit: PERSISTED_COMMAND_HISTORY_LIMIT,
    commandHistoryCount: commandHistory.length,
    duplicateCommandKeyCount: Object.values(duplicateCommandKeys).filter((count) => count > 1).length,
    commandLedgerProof,
    operationalSnapshot,
    observedAt: now,
    present: Object.keys(persisted).length > 0
  };
}

function buildRestartRecoveryContract({ persistedState, syncMetadata, clientRuntime, acceptance }) {
  const cursorMatches = persistedState.lastKnownCursor === syncMetadata.cursor;
  const requestMatches = persistedState.lastRequestId === clientRuntime.requestId;
  const acceptanceMatches = persistedState.lastAcceptedToken === acceptance.acceptanceToken;
  const commandLedgerValid = persistedState.duplicateCommandKeyCount === 0;
  const needsReplay = persistedState.present && (!cursorMatches || (!requestMatches && clientRuntime.intent !== "status-check"));
  const needsLedgerRepair = persistedState.present && !commandLedgerValid;
  const recoveryState = !persistedState.present
    ? "cold-start"
    : needsLedgerRepair
      ? "ledger-repair-required"
    : needsReplay
      ? "replay-required"
    : syncMetadata.status === "ready"
        ? "restored"
        : "restored-degraded";
  const recoveryCursor = needsReplay ? persistedState.lastKnownCursor : syncMetadata.nextCursor;

  return {
    contractVersion: "dashboard-restart-recovery.v1",
    state: recoveryState,
    restartSafe: recoveryState === "restored" || recoveryState === "restored-degraded",
    replayRequired: needsReplay,
    recoveredFrom: persistedState.recoveredFrom,
    restartCount: persistedState.restartCount,
    checkpoint: {
      cursor: recoveryCursor,
      requestId: persistedState.lastRequestId || clientRuntime.requestId,
      acceptanceToken: persistedState.lastAcceptedToken,
      writeId: persistedState.lastWriteId,
      commandLedgerProof: persistedState.commandLedgerProof
    },
    comparisons: {
      cursorMatches,
      requestMatches,
      acceptanceMatches,
      commandLedgerValid
    },
    recoveryPaths: [
      !persistedState.present ? "initialize-empty-dashboard-state" : null,
      needsLedgerRepair ? "repair-command-ledger-before-dispatch" : null,
      needsReplay ? "replay-persisted-cursor-before-resume" : null,
      persistedState.operationalSnapshot.present && persistedState.operationalSnapshot.stale ? "refresh-persisted-operational-snapshot" : null,
      syncMetadata.status !== "ready" ? "restore-degraded-sync-status" : null
    ].filter(Boolean)
  };
}

function buildOperationalSnapshotRecovery({ persistedState, operationalHealth, runningJobs, proofRefs, blockers, workspaceBoundary, now }) {
  const snapshot = persistedState.operationalSnapshot;
  const currentProofRefs = Object.keys(proofRefs || {}).sort().reduce((refs, key) => {
    refs[key] = proofRefs[key] || null;
    return refs;
  }, {});
  const activeJobs = runningJobs.filter((job) => job.state === "queued" || job.state === "running");
  const attentionJobs = runningJobs.filter((job) => job.attentionRequired);
  const currentBlockers = blockers.filter((blocker) => blocker.severity === "error" || blocker.severity === "warning");
  const restoredActiveJobIds = new Set(snapshot.jobs.filter((job) => job.state === "queued" || job.state === "running").map((job) => job.id));
  const currentActiveJobIds = new Set(activeJobs.map((job) => job.id));
  const missingActiveJobs = [...restoredActiveJobIds].filter((jobId) => !currentActiveJobIds.has(jobId));
  const newlyActiveJobs = [...currentActiveJobIds].filter((jobId) => !restoredActiveJobIds.has(jobId));
  const proofRefKeys = [...new Set([...Object.keys(snapshot.proofRefs), ...Object.keys(currentProofRefs)])].sort();
  const changedProofRefs = proofRefKeys.filter((key) => (snapshot.proofRefs[key] || null) !== (currentProofRefs[key] || null));
  const restoredErrorBlockers = snapshot.blockers.filter((blocker) => blocker.severity === "error");
  const currentErrorBlockers = currentBlockers.filter((blocker) => blocker.severity === "error");
  const scopeQuarantined = snapshot.quarantinedScopeViolationCount > 0 || snapshot.scopeTrusted === false;
  const driftReasons = [
    !snapshot.present ? "no-persisted-operational-snapshot" : null,
    scopeQuarantined ? "persisted-operational-snapshot-scope-quarantined" : null,
    snapshot.stale ? "persisted-operational-snapshot-stale" : null,
    snapshot.kernelState !== "unknown" && snapshot.kernelState !== operationalHealth.state ? "kernel-health-state-changed-after-restart" : null,
    missingActiveJobs.length > 0 ? "persisted-active-jobs-missing-from-current-status" : null,
    newlyActiveJobs.length > 0 ? "new-active-jobs-after-restart" : null,
    changedProofRefs.length > 0 ? "proof-references-changed-after-restart" : null,
    restoredErrorBlockers.length > 0 && currentErrorBlockers.length === 0 ? "persisted-error-blockers-cleared" : null,
    restoredErrorBlockers.length === 0 && currentErrorBlockers.length > 0 ? "new-error-blockers-after-restart" : null
  ].filter(Boolean);
  const state = !snapshot.present
    ? "missing"
    : scopeQuarantined || snapshot.stale || currentErrorBlockers.length > 0
      ? "refresh-required"
      : driftReasons.length > 0 || attentionJobs.length > 0
        ? "drift-detected"
        : "restored";
  const actions = [
    !snapshot.present ? {
      id: "initialize-operational-snapshot",
      route: `${workspaceBoundary.routeScope}/state/operational-snapshot`,
      reason: "No persisted operational dashboard snapshot was available for restart recovery."
    } : null,
    snapshot.stale ? {
      id: "refresh-persisted-operational-snapshot",
      route: `${workspaceBoundary.routeScope}/state/operational-snapshot/refresh`,
      reason: `Persisted operational snapshot is older than ${snapshot.staleAfterMs}ms.`
    } : null,
    scopeQuarantined ? {
      id: "quarantine-cross-scope-operational-snapshot",
      route: `${workspaceBoundary.routeScope}/state/operational-snapshot/quarantine`,
      reason: snapshot.quarantinedScopeViolations[0]?.reason || "Persisted operational snapshot scope could not be verified for this workspace."
    } : null,
    missingActiveJobs.length > 0 || newlyActiveJobs.length > 0 ? {
      id: "reconcile-running-jobs-after-restart",
      route: `${workspaceBoundary.routeScope}/jobs/reconcile`,
      reason: "Running job identity changed between the persisted snapshot and current hosted-kernel status."
    } : null,
    changedProofRefs.length > 0 ? {
      id: "rebuild-proof-status-after-restart",
      route: `${workspaceBoundary.routeScope}/validation/proofs/rebuild`,
      reason: "Persisted proof references changed after restart and should be rebuilt before acceptance."
    } : null,
    currentErrorBlockers.length > 0 ? {
      id: "inspect-recovered-blockers",
      route: `${workspaceBoundary.routeScope}/blockers/recovered`,
      reason: currentErrorBlockers[0].message
    } : null
  ].filter(Boolean);

  return {
    contractVersion: "dashboard-operational-snapshot-recovery.v1",
    state,
    restartSafe: state === "restored" || state === "drift-detected",
    persistedSnapshotPresent: snapshot.present,
    persistedSnapshotAgeMs: snapshot.ageMs,
    persistedSnapshotStale: snapshot.stale,
    persistedScopeState: snapshot.scopeState,
    persistedScopeTrusted: snapshot.scopeTrusted,
    quarantinedScopeViolationCount: snapshot.quarantinedScopeViolationCount,
    quarantinedScopeViolations: snapshot.quarantinedScopeViolations,
    persistedKernelState: snapshot.kernelState,
    currentKernelState: operationalHealth.state,
    persistedActiveJobCount: snapshot.activeJobCount,
    currentActiveJobCount: activeJobs.length,
    currentAttentionJobCount: attentionJobs.length,
    persistedBlockerCount: snapshot.blockerCount,
    currentBlockerCount: currentBlockers.length,
    changedProofRefs,
    missingActiveJobIds: missingActiveJobs,
    newActiveJobIds: newlyActiveJobs,
    driftReasons,
    actions,
    actionCount: actions.length,
    recoveredAt: now,
    route: `${workspaceBoundary.routeScope}/state/operational-snapshot/recovery`,
    proofId: proofToken({
      workspace: workspaceBoundary.workspaceId,
      state,
      snapshotProof: snapshot.snapshotProof,
      currentKernelState: operationalHealth.state,
      activeJobs: activeJobs.map((job) => [job.id, job.state, job.progressPercent]),
      blockers: currentBlockers.map((blocker) => [blocker.id, blocker.severity, blocker.route]),
      changedProofRefs,
      quarantinedScopeViolations: snapshot.quarantinedScopeViolations.map((violation) => [violation.kind, violation.id, violation.scopeState])
    })
  };
}

function buildCommandRecoveryDecision({ command, persistedState, recovery, clientRuntime, workspaceBoundary, syncMetadata, operationalHealth, healthValidation, now }) {
  const ledgerMatches = persistedState.commandHistory.filter((entry) => (
    entry.commandId === command.id
    || entry.idempotencyKey === command.idempotencyKey
    || entry.writeId === command.replayOf
    || entry.replayToken === command.replayOf
  ));
  const priorCommand = ledgerMatches[0] || null;
  const legacyWriteMatch = command.replayOf === persistedState.lastWriteId || command.idempotencyKey === persistedState.lastWriteId;
  const replayTarget = priorCommand
    ? {
      source: "command-ledger",
      commandId: priorCommand.commandId,
      idempotencyKey: priorCommand.idempotencyKey,
      writeId: priorCommand.writeId,
      cursor: priorCommand.cursor,
      replayToken: priorCommand.replayToken
    }
    : legacyWriteMatch
      ? {
        source: "legacy-write-id",
        commandId: persistedState.lastRequestId || command.id,
        idempotencyKey: command.idempotencyKey,
        writeId: persistedState.lastWriteId,
        cursor: persistedState.lastKnownCursor,
        replayToken: null
      }
      : null;
  const resumeBlockedByReplay = command.type === "resume-workflow" && recovery.replayRequired;
  const ledgerRepairRequired = recovery.state === "ledger-repair-required";
  const boundaryBlocked = workspaceBoundary.isolationState === "blocked";
  const retryWindowOpen = operationalHealth?.retry?.retryable === true && !operationalHealth?.retry?.nextAttemptAt
    ? true
    : operationalHealth?.retry?.retryable === true && Date.parse(operationalHealth.retry.nextAttemptAt) <= (Date.parse(now) || Date.now());
  const refreshCommand = command.type === "refresh-status";
  const healthValidationBlocked = healthValidation?.state === "blocked";
  const dashboardHealthBlocked = operationalHealth?.blocks?.dashboard === true || operationalHealth?.state === "blocked";
  const syncHealthBlocked = operationalHealth?.blocks?.sync === true && command.type === "resume-workflow";
  const handoffHealthBlocked = operationalHealth?.blocks?.handoff === true && command.type === "prepare-handoff";
  const degradedHealth = operationalHealth?.degradedModeActive === true || healthValidation?.state === "degraded";
  const healthDispatchBlocker = healthValidationBlocked
    ? healthValidation.findings.find((finding) => finding.severity === "error")?.message || "hosted-kernel health validation blocks command dispatch"
    : handoffHealthBlocked
      ? "hosted-kernel handoff health blocks prepare-handoff dispatch"
      : syncHealthBlocked
        ? "hosted-kernel sync health blocks resume-workflow dispatch"
        : dashboardHealthBlocked && !refreshCommand
          ? operationalHealth.actionableErrors.find((error) => error.severity === "error")?.message || "hosted-kernel health blocks command dispatch"
          : null;
  const retryBackoffActive = refreshCommand
    && operationalHealth?.retry?.retryable === true
    && !retryWindowOpen;
  const healthDispatchMode = healthDispatchBlocker
    ? "health-blocked"
    : retryBackoffActive
      ? "wait-for-health-retry"
      : degradedHealth && !refreshCommand
        ? "degraded-dispatch"
        : "ready";
  const dispatchMode = boundaryBlocked
    ? "blocked"
    : ledgerRepairRequired
      ? "repair-ledger"
    : replayTarget
      ? "replay-existing"
    : healthDispatchMode === "health-blocked" || healthDispatchMode === "wait-for-health-retry"
      ? healthDispatchMode
    : resumeBlockedByReplay
      ? "defer-until-replay"
    : healthDispatchMode === "degraded-dispatch"
      ? healthDispatchMode
    : "dispatch-new";
  const restartSafeStatus = dispatchMode === "blocked"
    ? "blocked"
    : dispatchMode === "health-blocked"
      ? "blocked"
    : dispatchMode === "repair-ledger" || dispatchMode === "defer-until-replay" || dispatchMode === "wait-for-health-retry"
      ? "recovering"
    : dispatchMode === "degraded-dispatch"
      ? "degraded"
    : dispatchMode === "replay-existing"
      ? "replayed"
    : recovery.replayRequired
      ? "recovering"
        : "ready";
  const dispatchBlocker = boundaryBlocked
    ? workspaceBoundary.reason
    : ledgerRepairRequired
      ? "persisted command ledger must be repaired before command dispatch"
      : healthDispatchBlocker
        ? healthDispatchBlocker
        : retryBackoffActive
          ? `hosted-kernel retry backoff is active until ${operationalHealth.retry.nextAttemptAt}`
      : resumeBlockedByReplay
        ? "persisted cursor replay must complete before workflow resume"
        : null;
  const degradedDispatch = dispatchMode === "degraded-dispatch";
  const safeToDispatch = dispatchMode === "dispatch-new" || degradedDispatch;
  const recoveryActions = [
    ledgerRepairRequired ? {
      id: "repair-command-ledger",
      route: `${workspaceBoundary.routeScope}/state/commands/repair`,
      reason: "Persisted command history contains duplicate command or idempotency keys."
    } : null,
    resumeBlockedByReplay ? {
      id: "replay-persisted-cursor",
      route: `${workspaceBoundary.routeScope}/state/replay/${encodeURIComponent(recovery.checkpoint.cursor)}`,
      reason: "Workflow resume is waiting for the persisted cursor to be replayed."
    } : null,
    healthDispatchBlocker ? {
      id: healthValidationBlocked ? "refresh-hosted-kernel-health-validation" : "repair-hosted-kernel-health",
      route: healthValidationBlocked ? healthValidation.route : operationalHealth.route,
      reason: healthDispatchBlocker,
      retryToken: operationalHealth?.retry?.retryToken || null,
      nextAttemptAt: operationalHealth?.retry?.nextAttemptAt || null
    } : null,
    retryBackoffActive ? {
      id: "wait-for-hosted-kernel-retry-backoff",
      route: operationalHealth.route,
      reason: `Retry after ${operationalHealth.retry.nextAttemptAt} before dispatching another hosted-kernel refresh.`,
      retryToken: operationalHealth.retry.retryToken,
      nextAttemptAt: operationalHealth.retry.nextAttemptAt
    } : null,
    degradedDispatch ? {
      id: "dispatch-with-degraded-health",
      route: `${workspaceBoundary.routeScope}/commands/${encodeURIComponent(command.id)}/degraded-dispatch`,
      reason: "Command can dispatch, but the dashboard should keep degraded-mode warnings visible until health recovers.",
      retryToken: operationalHealth?.retry?.retryToken || null,
      nextAttemptAt: operationalHealth?.retry?.nextAttemptAt || null
    } : null,
    replayTarget ? {
      id: "return-idempotent-command-result",
      route: `${workspaceBoundary.routeScope}/commands/${encodeURIComponent(replayTarget.commandId)}`,
      reason: `Command matches a persisted ${replayTarget.source} and can return the previous write id.`
    } : null
  ].filter(Boolean);

  return {
    contractVersion: "dashboard-command-recovery-decision.v1",
    commandId: command.id,
    commandType: command.type,
    idempotencyKey: command.idempotencyKey,
    dispatchMode,
    restartSafeStatus,
    dispatchable: safeToDispatch,
    idempotentReplay: dispatchMode === "replay-existing",
    degradedDispatch,
    healthGate: {
      state: healthDispatchMode,
      blocksDispatch: dispatchMode === "health-blocked",
      backoffActive: retryBackoffActive,
      retryable: operationalHealth?.retry?.retryable === true,
      retryToken: operationalHealth?.retry?.retryToken || null,
      nextAttemptAt: operationalHealth?.retry?.nextAttemptAt || null,
      healthState: operationalHealth?.state || "unknown",
      validationState: healthValidation?.state || "unknown",
      degradedModeActive: operationalHealth?.degradedModeActive === true,
      blocker: healthDispatchBlocker
    },
    ledgerRepairRequired,
    replayBeforeResumeRequired: resumeBlockedByReplay,
    dispatchBlocker,
    replayTarget,
    priorCommand,
    ledgerMatchCount: ledgerMatches.length + (legacyWriteMatch ? 1 : 0),
    recoveryState: recovery.state,
    recoveryCursor: recovery.checkpoint.cursor,
    activeCursor: syncMetadata.cursor,
    nextCursor: syncMetadata.nextCursor,
    requestId: clientRuntime.requestId,
    route: `${workspaceBoundary.routeScope}/commands/${encodeURIComponent(command.id)}/recovery`,
    recoveryActions,
    decidedAt: now,
    proofId: proofToken({
      workspace: workspaceBoundary.workspaceId,
      commandId: command.id,
      idempotencyKey: command.idempotencyKey,
      dispatchMode,
      restartSafeStatus,
      recoveryState: recovery.state,
      healthDispatchMode,
      healthProofId: operationalHealth?.proofId || null,
      healthValidationProofId: healthValidation?.proofId || null,
      replayTarget,
      ledgerMatchCount: ledgerMatches.length + (legacyWriteMatch ? 1 : 0)
    })
  };
}

function normalizeCommand(input = {}, clientRuntime, persistedState) {
  const command = input && typeof input.command === "object" && input.command !== null ? input.command : {};
  const requestedType = typeof command.type === "string" && command.type.trim() ? command.type.trim() : null;
  const type = COMMAND_TYPES.includes(requestedType) ? requestedType : (
    clientRuntime.intent === "handoff"
      ? "prepare-handoff"
      : clientRuntime.intent === "acceptance"
        ? "acknowledge-acceptance"
        : "refresh-status"
  );
  const commandId = typeof command.id === "string" && command.id.trim()
    ? command.id.trim()
    : proofToken({ type, requestId: clientRuntime.requestId, stateWrite: persistedState.lastWriteId }).replace("proof_", "command_");
  const idempotencyKey = typeof command.idempotencyKey === "string" && command.idempotencyKey.trim()
    ? command.idempotencyKey.trim()
    : proofToken({ commandId, type, sessionId: clientRuntime.sessionId }).replace("proof_", "idem_");
  const replayOf = typeof command.replayOf === "string" && command.replayOf.trim() ? command.replayOf.trim() : null;

  return {
    contractVersion: "dashboard-command.v1",
    id: commandId,
    type,
    idempotencyKey,
    replayOf,
    requestedAt: clientRuntime.receivedAt
  };
}

function normalizeLifecycleSettings(input = {}, now) {
  const settings = input && typeof input.settings === "object" && input.settings !== null ? input.settings : {};
  const lifecycle = settings.lifecycle && typeof settings.lifecycle === "object" && settings.lifecycle !== null
    ? settings.lifecycle
    : {};
  const scheduling = lifecycle.scheduling && typeof lifecycle.scheduling === "object" && lifecycle.scheduling !== null
    ? lifecycle.scheduling
    : {};
  const requestedMode = LIFECYCLE_MODES.includes(lifecycle.mode) ? lifecycle.mode : "enabled";
  const requestedScheduleMode = LIFECYCLE_SCHEDULE_MODES.includes(scheduling.mode) ? scheduling.mode : "manual";
  const intervalSeconds = Math.trunc(normalizeNumber(scheduling.intervalSeconds, 300, { min: 30, max: 86400 }));
  const pausedUntil = typeof lifecycle.pausedUntil === "string" && lifecycle.pausedUntil.trim()
    ? lifecycle.pausedUntil.trim()
    : null;
  const windowStart = typeof scheduling.windowStart === "string" && scheduling.windowStart.trim()
    ? scheduling.windowStart.trim()
    : null;
  const windowEnd = typeof scheduling.windowEnd === "string" && scheduling.windowEnd.trim()
    ? scheduling.windowEnd.trim()
    : null;
  const enableRequested = lifecycle.enabled === true || lifecycle.action === "enable";
  const disableRequested = lifecycle.enabled === false || lifecycle.action === "disable";
  const requestedAction = enableRequested
    ? "enable"
    : disableRequested
      ? "disable"
      : lifecycle.action === "pause"
        ? "pause"
        : lifecycle.action === "resume"
          ? "resume"
          : "none";

  return {
    contractVersion: "dashboard-lifecycle-settings.v1",
    mode: disableRequested ? "disabled" : enableRequested ? "enabled" : requestedMode,
    requestedAction,
    reason: normalizeString(lifecycle.reason, requestedAction === "none" ? "No lifecycle control change requested." : "Operator lifecycle control requested."),
    pausedUntil,
    scheduling: {
      mode: requestedScheduleMode,
      intervalSeconds,
      windowStart,
      windowEnd,
      timezone: normalizeString(scheduling.timezone, "UTC"),
      jitterSeconds: Math.trunc(normalizeNumber(scheduling.jitterSeconds, 0, { min: 0, max: 300 }))
    },
    updatedAt: now
  };
}

function buildLifecycleControlContract({ lifecycleSettings, command, syncMetadata, operationalHealth, workspaceBoundary, now }) {
  const schedule = lifecycleSettings.scheduling;
  const nowMs = Date.parse(now);
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const pausedUntilMs = lifecycleSettings.pausedUntil ? Date.parse(lifecycleSettings.pausedUntil) : NaN;
  const windowStartMs = schedule.windowStart ? Date.parse(schedule.windowStart) : NaN;
  const windowEndMs = schedule.windowEnd ? Date.parse(schedule.windowEnd) : NaN;
  const pauseActive = lifecycleSettings.mode === "maintenance" && Number.isFinite(pausedUntilMs) && pausedUntilMs > safeNowMs;
  const invalidPause = lifecycleSettings.mode === "maintenance" && lifecycleSettings.pausedUntil !== null && !Number.isFinite(pausedUntilMs);
  const invalidWindow = schedule.mode === "window" && (
    !Number.isFinite(windowStartMs)
    || !Number.isFinite(windowEndMs)
    || windowEndMs <= windowStartMs
  );
  const nextScheduledAt = pauseActive
    ? new Date(pausedUntilMs).toISOString()
    : schedule.mode === "interval"
      ? new Date(safeNowMs + ((schedule.intervalSeconds + schedule.jitterSeconds) * 1000)).toISOString()
      : schedule.mode === "window" && Number.isFinite(windowStartMs)
        ? new Date(Math.max(safeNowMs, windowStartMs)).toISOString()
        : operationalHealth?.retry?.nextAttemptAt || null;
  const enabled = lifecycleSettings.mode === "enabled" && !pauseActive;
  const settingErrors = [
    invalidPause ? "maintenance pausedUntil must be an ISO timestamp when provided" : null,
    invalidWindow ? "window scheduling requires windowStart before windowEnd" : null
  ].filter(Boolean);
  const blockedReason = workspaceBoundary.isolationState === "blocked"
    ? workspaceBoundary.reason
    : settingErrors[0] || (lifecycleSettings.mode === "disabled" ? lifecycleSettings.reason : null);
  const commandAllowed = !blockedReason && enabled && !operationalHealth?.blocks?.dashboard;

  return {
    contractVersion: "dashboard-lifecycle-control.v1",
    state: blockedReason ? "blocked" : pauseActive ? "paused" : enabled ? "enabled" : lifecycleSettings.mode,
    enabled,
    commandAllowed,
    requestedAction: lifecycleSettings.requestedAction,
    blockedReason,
    settingErrors,
    schedule: {
      mode: schedule.mode,
      intervalSeconds: schedule.intervalSeconds,
      nextScheduledAt,
      pausedUntil: lifecycleSettings.pausedUntil,
      windowStart: schedule.windowStart,
      windowEnd: schedule.windowEnd,
      timezone: schedule.timezone
    },
    nextActionId: commandAllowed
      ? command.type
      : lifecycleSettings.mode === "disabled"
        ? "enable-lifecycle"
        : "repair-lifecycle-settings",
    proofId: proofToken({
      workspace: workspaceBoundary.workspaceId,
      mode: lifecycleSettings.mode,
      requestedAction: lifecycleSettings.requestedAction,
      commandId: command.id,
      cursor: syncMetadata.cursor,
      nextScheduledAt,
      blockedReason
    }),
    route: `${workspaceBoundary.routeScope}/settings/lifecycle`
  };
}

function buildLifecycleActionPlan({ lifecycleSettings, lifecycleControl, command, syncMetadata, workspaceBoundary, operationalHealth, now }) {
  const schedule = lifecycleSettings.scheduling;
  const blockedBySettings = lifecycleControl.settingErrors.length > 0;
  const boundaryBlocked = workspaceBoundary.isolationState === "blocked";
  const dashboardHealthBlocked = operationalHealth?.blocks?.dashboard === true;
  const controlsBlocked = boundaryBlocked || blockedBySettings;
  const controlBlocker = boundaryBlocked
    ? workspaceBoundary.reason
    : blockedBySettings
      ? lifecycleControl.settingErrors[0]
      : null;
  const actionSpecs = [
    {
      id: "enable-lifecycle",
      action: "enable",
      label: "Enable lifecycle commands",
      requested: lifecycleSettings.requestedAction === "enable",
      enabled: !controlsBlocked && lifecycleControl.state !== "enabled",
      reason: lifecycleControl.state === "enabled"
        ? "Lifecycle commands are already enabled."
        : controlBlocker || "Hosted-kernel lifecycle commands can be enabled for this workspace."
    },
    {
      id: "disable-lifecycle",
      action: "disable",
      label: "Disable lifecycle commands",
      requested: lifecycleSettings.requestedAction === "disable",
      enabled: !controlsBlocked && lifecycleControl.state !== "blocked" && lifecycleControl.state !== "disabled",
      reason: lifecycleControl.state === "disabled"
        ? "Lifecycle commands are already disabled."
        : controlBlocker || "Disable hosted-kernel lifecycle command dispatch for this workspace."
    },
    {
      id: "pause-lifecycle",
      action: "pause",
      label: "Pause lifecycle schedule",
      requested: lifecycleSettings.requestedAction === "pause",
      enabled: !controlsBlocked && lifecycleControl.state === "enabled",
      reason: lifecycleControl.state === "paused"
        ? "Lifecycle commands are already paused."
        : controlBlocker || "Pause lifecycle command dispatch until the configured resume time."
    },
    {
      id: "resume-lifecycle",
      action: "resume",
      label: "Resume lifecycle schedule",
      requested: lifecycleSettings.requestedAction === "resume",
      enabled: !controlsBlocked && (lifecycleControl.state === "paused" || lifecycleSettings.mode === "maintenance"),
      reason: lifecycleControl.state === "paused" || lifecycleSettings.mode === "maintenance"
        ? controlBlocker || "Resume lifecycle command dispatch from maintenance mode."
        : "Lifecycle schedule is not paused."
    }
  ];
  const controls = actionSpecs.map((control) => ({
    contractVersion: "dashboard-lifecycle-control-action.v1",
    ...control,
    route: `${workspaceBoundary.routeScope}/settings/lifecycle/${control.action}`,
    disabledReason: control.enabled ? null : control.reason,
    commandPayload: control.enabled
      ? {
        commandType: "refresh-status",
        lifecycleAction: control.action,
        idempotencyKey: proofToken({
          workspace: workspaceBoundary.workspaceId,
          action: control.action,
          mode: lifecycleSettings.mode,
          commandId: command.id,
          cursor: syncMetadata.cursor
        }).replace("proof_", "lifecycle_")
      }
      : null
  }));
  const scheduleControls = {
    contractVersion: "dashboard-lifecycle-schedule-controls.v1",
    mode: schedule.mode,
    modeOptions: LIFECYCLE_SCHEDULE_MODES.map((mode) => ({
      id: mode,
      selected: schedule.mode === mode,
      enabled: !controlsBlocked,
      route: `${workspaceBoundary.routeScope}/settings/lifecycle/schedule/${mode}`
    })),
    interval: {
      seconds: schedule.intervalSeconds,
      minSeconds: 30,
      maxSeconds: 86400,
      enabled: !controlsBlocked && schedule.mode === "interval"
    },
    window: {
      start: schedule.windowStart,
      end: schedule.windowEnd,
      timezone: schedule.timezone,
      enabled: !controlsBlocked && schedule.mode === "window",
      valid: schedule.mode !== "window" || !lifecycleControl.settingErrors.some((error) => error.includes("window scheduling"))
    },
    jitter: {
      seconds: schedule.jitterSeconds,
      maxSeconds: 300,
      enabled: !controlsBlocked && schedule.mode !== "manual"
    },
    nextScheduledAt: lifecycleControl.schedule.nextScheduledAt,
    validationState: blockedBySettings ? "invalid" : "valid"
  };
  const requestedControl = controls.find((control) => control.requested) || null;
  const repairControl = blockedBySettings
    ? {
      id: "repair-lifecycle-settings",
      label: "Repair lifecycle settings",
      route: lifecycleControl.route,
      reason: lifecycleControl.settingErrors[0],
      commandPayload: null
    }
    : null;
  const primaryControl = repairControl || requestedControl || controls.find((control) => control.enabled) || null;
  const nextActionState = repairControl
    ? "repair-required"
    : boundaryBlocked
      ? "blocked"
      : dashboardHealthBlocked && lifecycleControl.commandAllowed
        ? "health-blocked"
        : requestedControl?.enabled
          ? "operator-action-ready"
          : lifecycleControl.commandAllowed
            ? "command-dispatch-ready"
            : primaryControl
              ? "operator-action-available"
              : "idle";

  return {
    contractVersion: "dashboard-lifecycle-action-plan.v1",
    state: nextActionState,
    lifecycleState: lifecycleControl.state,
    requestedAction: lifecycleSettings.requestedAction,
    requestedActionValid: !requestedControl || requestedControl.enabled,
    commandAllowed: lifecycleControl.commandAllowed,
    controls,
    scheduleControls,
    primaryAction: primaryControl
      ? {
        id: primaryControl.id,
        label: primaryControl.label,
        route: primaryControl.route,
        reason: primaryControl.reason,
        commandPayload: primaryControl.commandPayload
      }
      : {
        id: lifecycleControl.nextActionId,
        label: "Run lifecycle command",
        route: lifecycleControl.route,
        reason: lifecycleControl.blockedReason || "Lifecycle command dispatch is controlled by the current hosted-kernel state.",
        commandPayload: lifecycleControl.commandAllowed
          ? {
            commandType: command.type,
            idempotencyKey: command.idempotencyKey,
            cursor: syncMetadata.nextCursor
          }
          : null
      },
    audit: {
      proofId: proofToken({
        workspace: workspaceBoundary.workspaceId,
        state: nextActionState,
        mode: lifecycleSettings.mode,
        requestedAction: lifecycleSettings.requestedAction,
        commandId: command.id,
        nextScheduledAt: lifecycleControl.schedule.nextScheduledAt,
        settingErrors: lifecycleControl.settingErrors
      }),
      evaluatedAt: now,
      route: `${workspaceBoundary.routeScope}/settings/lifecycle/audit`
    }
  };
}

function buildProviderServiceContract({ provider, capabilityNegotiation, syncMetadata, handoff, workspaceBoundary, operationalHealth, lifecycleControl, clientRuntime, clientWorkflow, now }) {
  const serviceSpecs = [
    {
      id: "status",
      capability: "kernel.status.read",
      routeSuffix: "provider/status",
      blocked: operationalHealth.blocks.dashboard,
      degraded: operationalHealth.degradedModeActive,
      handoffEligible: false
    },
    {
      id: "sync",
      capability: "sync.metadata.read",
      routeSuffix: "provider/sync",
      blocked: operationalHealth.blocks.sync || syncMetadata.status !== "ready",
      degraded: syncMetadata.status !== "ready",
      handoffEligible: false
    },
    {
      id: "audit",
      capability: "audit.proof.read",
      routeSuffix: "provider/audit",
      blocked: lifecycleControl.state === "blocked",
      degraded: lifecycleControl.state === "paused",
      handoffEligible: false
    },
    {
      id: "handoff",
      capability: "handoff.prepare",
      routeSuffix: `provider/handoff/${handoff.target}`,
      blocked: operationalHealth.blocks.handoff || handoff.state === "blocked",
      degraded: handoff.requested && handoff.state !== "prepared",
      handoffEligible: true
    }
  ];
  const services = serviceSpecs.map((service) => {
    const declaration = provider.serviceDeclarations?.[service.id] || normalizeProviderServiceDeclarations({}, provider.endpoint, provider.apiVersion)[service.id];
    const requirement = PROVIDER_SERVICE_REQUIREMENTS[service.id];
    const granted = capabilityNegotiation.granted.includes(service.capability);
    const apiVersionAccepted = compareDateVersion(declaration.apiVersion, requirement.minApiVersion) >= 0;
    const deliveryAccepted = declaration.deliveryModes.includes(clientRuntime.deliveryMode)
      || requirement.requiredDeliveryModes.some((mode) => declaration.deliveryModes.includes(mode));
    const handoffChannelAccepted = !service.handoffEligible
      || !handoff.requested
      || declaration.handoffChannels.includes(clientWorkflow.channel);
    const capabilityDeclared = declaration.declaredCapabilities.length === 0
      || declaration.declaredCapabilities.includes(service.capability);
    const optionalHandoffIdle = service.handoffEligible && !handoff.requested && !granted;
    const contractBlockers = [
      !declaration.enabled ? `${service.id} provider service is disabled by declaration` : null,
      !apiVersionAccepted ? `${service.id} provider API ${declaration.apiVersion} is older than required ${requirement.minApiVersion}` : null,
      !deliveryAccepted ? `${service.id} provider service does not support delivery mode ${clientRuntime.deliveryMode}` : null,
      !handoffChannelAccepted ? `${service.id} provider service does not support handoff channel ${clientWorkflow.channel}` : null,
      !capabilityDeclared ? `${service.id} provider service declaration omitted ${service.capability}` : null
    ].filter(Boolean);
    const state = optionalHandoffIdle
      ? "not-requested"
      : workspaceBoundary.isolationState === "blocked" || !granted || service.blocked || contractBlockers.length > 0
      ? "blocked"
      : service.degraded
        ? "degraded"
        : "ready";
    const blockedReason = workspaceBoundary.isolationState === "blocked"
      ? workspaceBoundary.reason
      : optionalHandoffIdle
        ? null
      : !granted
        ? `${service.capability} was not granted`
        : contractBlockers[0]
          ? contractBlockers[0]
        : service.blocked
          ? `${service.id} provider service is blocked by hosted-kernel state`
          : null;

    return {
      contractVersion: "dashboard-provider-service.v1",
      id: service.id,
      capability: service.capability,
      state,
      blockedReason,
      contractBlockers,
      declaration,
      requirement: {
        minApiVersion: requirement.minApiVersion,
        requiredDeliveryModes: requirement.requiredDeliveryModes,
        handoffChannels: requirement.handoffChannels
      },
      negotiation: {
        apiVersionAccepted,
        deliveryAccepted,
        handoffChannelAccepted,
        capabilityDeclared,
        requestedDeliveryMode: clientRuntime.deliveryMode,
        requestedHandoffChannel: service.handoffEligible ? clientWorkflow.channel : null
      },
      route: `${workspaceBoundary.routeScope}/${service.routeSuffix}`,
      providerEndpoint: declaration.endpoint,
      cursor: syncMetadata.nextCursor,
      dispatchable: state !== "blocked" && state !== "not-requested" && lifecycleControl.commandAllowed,
      externalHandoff: service.handoffEligible
        ? {
          requested: handoff.requested,
          state: handoff.state,
          target: handoff.target,
          resumeToken: handoff.resumeToken,
          tenantScopedClaim: handoff.tenantScopedClaim,
          returnRoute: `${workspaceBoundary.routeScope}/workflow/${clientRuntime.requestId}`
        }
        : null
    };
  });
  const blockedServices = services.filter((service) => service.state === "blocked");
  const degradedServices = services.filter((service) => service.state === "degraded");
  const contractBlockedServices = services.filter((service) => service.contractBlockers.length > 0);
  const declaredServiceVersions = services.reduce((versions, service) => {
    versions[service.id] = service.declaration.apiVersion;
    return versions;
  }, {});
  const negotiationState = workspaceBoundary.isolationState === "blocked" || blockedServices.some((service) => service.id === "status")
    ? "blocked"
    : degradedServices.length > 0 || blockedServices.length > 0
      ? "degraded"
      : "ready";

  return {
    contractVersion: "dashboard-provider-service-contract.v1",
    providerId: provider.id,
    providerMode: provider.mode,
    providerRevision: provider.revision,
    providerApiVersion: provider.apiVersion,
    negotiatedAt: now,
    state: negotiationState,
    requestedCapabilities: capabilityNegotiation.requested,
    grantedCapabilities: capabilityNegotiation.granted,
    deniedCapabilities: capabilityNegotiation.denied,
    rejectedCapabilities: capabilityNegotiation.rejected,
    syncCursor: syncMetadata.cursor,
    nextSyncCursor: syncMetadata.nextCursor,
    serviceCount: services.length,
    readyServiceCount: services.filter((service) => service.state === "ready").length,
    blockedServiceIds: blockedServices.map((service) => service.id),
    degradedServiceIds: degradedServices.map((service) => service.id),
    contractBlockedServiceIds: contractBlockedServices.map((service) => service.id),
    declaredServiceVersions,
    providerCompatibility: {
      compatible: contractBlockedServices.length === 0,
      requestedDeliveryMode: clientRuntime.deliveryMode,
      requestedHandoffChannel: clientWorkflow.channel,
      minApiVersions: Object.keys(PROVIDER_SERVICE_REQUIREMENTS).reduce((versions, serviceId) => {
        versions[serviceId] = PROVIDER_SERVICE_REQUIREMENTS[serviceId].minApiVersion;
        return versions;
      }, {}),
      blockerCount: contractBlockedServices.reduce((total, service) => total + service.contractBlockers.length, 0),
      blockers: contractBlockedServices.flatMap((service) => service.contractBlockers.map((message) => ({
        serviceId: service.id,
        message,
        route: service.route,
        providerEndpoint: service.providerEndpoint
      })))
    },
    handoffPrepared: handoff.state === "prepared",
    bindingRoute: `${workspaceBoundary.routeScope}/provider`,
    proofId: proofToken({
      providerId: provider.id,
      providerApiVersion: provider.apiVersion,
      workspace: workspaceBoundary.workspaceId,
      requestId: clientRuntime.requestId,
      granted: capabilityNegotiation.granted,
      services: services.map((service) => [service.id, service.state, service.cursor, service.declaration.apiVersion, service.contractBlockers]),
      handoffState: handoff.state
    }),
    services
  };
}

function buildCommandOutcome({ command, persistedState, recovery, acceptance, handoff, workspaceBoundary, lifecycleControl, commandRecovery }) {
  const priorCommand = commandRecovery.priorCommand;
  const duplicate = commandRecovery.idempotentReplay;
  const boundaryBlocked = workspaceBoundary?.isolationState === "blocked";
  const commandPermission = command.type === "prepare-handoff"
    ? "handoff.prepare"
    : command.type === "acknowledge-acceptance"
      ? "audit.proof.read"
      : "dashboard.read";
  const missingCommandPermission = !workspaceBoundary?.effectivePermissions?.includes(commandPermission);
  const blockedReason = commandRecovery.dispatchBlocker
    ? commandRecovery.dispatchBlocker
    : boundaryBlocked
    ? workspaceBoundary.reason
    : missingCommandPermission
      ? `actor lacks ${commandPermission} for this dashboard command`
      : command.type === "resume-workflow" && recovery.replayRequired
        ? "restart recovery requires replay before workflow resume"
      : command.type === "acknowledge-acceptance" && !acceptance.accepted
        ? "acceptance contract is not accepted"
        : command.type === "prepare-handoff" && handoff.state === "blocked"
          ? handoff.reason
          : lifecycleControl && !lifecycleControl.commandAllowed
            ? lifecycleControl.blockedReason || "lifecycle settings do not allow this command"
            : null;
  const state = duplicate ? "deduplicated" : blockedReason ? "blocked" : "accepted";
  const resultingWriteId = duplicate
    ? commandRecovery.replayTarget?.writeId || priorCommand?.writeId || persistedState.lastWriteId
    : proofToken({ commandId: command.id, key: command.idempotencyKey, state, cursor: recovery.checkpoint.cursor }).replace("proof_", "state_");

  return {
    contractVersion: "dashboard-command-outcome.v1",
    commandId: command.id,
    state,
    idempotent: true,
    duplicate,
    duplicateReason: priorCommand
      ? "persisted command ledger already contains this command or idempotency key"
      : commandRecovery.replayTarget?.source === "legacy-write-id"
        ? "command matched legacy persisted write id"
        : null,
    priorCommand: priorCommand
      ? {
        commandId: priorCommand.commandId,
        type: priorCommand.type,
        state: priorCommand.state,
        writeId: priorCommand.writeId,
        cursor: priorCommand.cursor,
        acceptedAt: priorCommand.acceptedAt,
        replayToken: priorCommand.replayToken
      }
      : null,
    blockedReason,
    requiredPermission: commandPermission,
    resultingWriteId,
    recoveryDecisionProofId: commandRecovery.proofId,
    dispatchMode: commandRecovery.dispatchMode,
    statusAfterRestart: state === "blocked"
      ? commandRecovery.restartSafeStatus === "blocked" ? "blocked" : "degraded"
      : commandRecovery.restartSafeStatus === "replayed"
        ? "ready"
        : commandRecovery.restartSafeStatus
  };
}

function buildPersistedStateEnvelope({ provider, syncMetadata, clientRuntime, workspaceBoundary, readiness, acceptance, recovery, operationalSnapshotRecovery, runningJobs, operationalHealth, proofRefs, blockers, command, commandOutcome, persistedState, now }) {
  const status = commandOutcome.statusAfterRestart === "ready" && readiness.state !== "ready" ? readiness.state : commandOutcome.statusAfterRestart;
  const commandEntry = {
    contractVersion: "dashboard-persisted-command.v1",
    commandId: command.id,
    idempotencyKey: command.idempotencyKey,
    type: command.type,
    state: commandOutcome.state,
    writeId: commandOutcome.resultingWriteId,
    cursor: syncMetadata.nextCursor,
    requestId: clientRuntime.requestId,
    acceptedAt: now,
    replayToken: proofToken({
      commandId: command.id,
      idempotencyKey: command.idempotencyKey,
      type: command.type,
      writeId: commandOutcome.resultingWriteId,
      cursor: syncMetadata.nextCursor
    }).replace("proof_", "replay_")
  };
  const retainedCommandHistory = commandOutcome.duplicate || commandOutcome.state === "blocked"
    ? persistedState.commandHistory
    : [...persistedState.commandHistory, commandEntry].slice(-PERSISTED_COMMAND_HISTORY_LIMIT);
  const snapshot = {
    schemaVersion: PERSISTED_STATE_VERSION,
    tenantId: workspaceBoundary.tenantId,
    workspaceId: workspaceBoundary.workspaceId,
    boundaryProof: workspaceBoundary.boundaryProof,
    permissionProof: workspaceBoundary.permissionProof,
    status,
    lastKnownCursor: syncMetadata.nextCursor,
    lastRequestId: clientRuntime.requestId,
    lastAcceptedToken: acceptance.acceptanceToken,
    restartCount: recovery.restartCount,
    lastWriteId: commandOutcome.resultingWriteId,
    commandHistory: retainedCommandHistory,
    operationalSnapshot: {
      contractVersion: "dashboard-persisted-operational-snapshot.v1",
      tenantId: workspaceBoundary.tenantId,
      workspaceId: workspaceBoundary.workspaceId,
      boundaryProof: workspaceBoundary.boundaryProof,
      permissionProof: workspaceBoundary.permissionProof,
      proofScope: {
        tenantId: workspaceBoundary.tenantId,
        workspaceId: workspaceBoundary.workspaceId,
        boundaryProof: workspaceBoundary.boundaryProof
      },
      capturedAt: now,
      kernelState: operationalHealth.state,
      readinessState: readiness.state,
      proofState: acceptance.accepted ? "accepted" : readiness.state === "blocked" ? "blocked" : "pending",
      commandRecoveryMode: commandOutcome.dispatchMode,
      commandRestartSafeStatus: commandOutcome.statusAfterRestart,
      activeJobCount: runningJobs.filter((job) => job.state === "queued" || job.state === "running").length,
      blockedJobCount: runningJobs.filter((job) => job.state === "blocked" || job.state === "failed").length,
      jobs: runningJobs.map((job) => ({
        id: job.id,
        tenantId: workspaceBoundary.tenantId,
        workspaceId: workspaceBoundary.workspaceId,
        boundaryProof: workspaceBoundary.boundaryProof,
        state: job.state,
        progressPercent: job.progressPercent,
        cursor: job.cursor,
        writeId: commandOutcome.resultingWriteId
      })),
      blockers: blockers.map((blocker) => ({
        id: blocker.id,
        tenantId: workspaceBoundary.tenantId,
        workspaceId: workspaceBoundary.workspaceId,
        boundaryProof: workspaceBoundary.boundaryProof,
        severity: blocker.severity,
        route: blocker.route,
        message: blocker.message
      })),
      proofRefs
    }
  };
  const snapshotProof = proofToken({
    providerId: provider.id,
    tenantId: workspaceBoundary.tenantId,
    workspaceId: workspaceBoundary.workspaceId,
    boundaryProof: workspaceBoundary.boundaryProof,
    snapshot,
    recoveryState: recovery.state
  });

  return {
    contractVersion: PERSISTED_STATE_VERSION,
    writeId: commandOutcome.resultingWriteId,
    providerId: provider.id,
    tenantId: workspaceBoundary.tenantId,
    workspaceId: workspaceBoundary.workspaceId,
    boundaryProof: workspaceBoundary.boundaryProof,
    status,
    lastKnownCursor: syncMetadata.nextCursor,
    lastRequestId: clientRuntime.requestId,
    lastAcceptedToken: acceptance.acceptanceToken,
    restartCount: snapshot.restartCount,
    previousRestartCount: recovery.restartCount,
    durable: commandOutcome.state !== "blocked" && workspaceBoundary.safeToPersist,
    idempotentReplay: commandOutcome.duplicate,
    commandHistoryCount: retainedCommandHistory.length,
    retainedCommandHistoryLimit: PERSISTED_COMMAND_HISTORY_LIMIT,
    recoveryPaths: recovery.recoveryPaths,
    operationalRecoveryState: operationalSnapshotRecovery.state,
    operationalRecoveryProofId: operationalSnapshotRecovery.proofId,
    snapshot,
    snapshotProof,
    writeRoute: `${workspaceBoundary.routeScope}/state/checkpoint`,
    generatedAt: now
  };
}

function buildWorkflowHandoffContract({ clientRuntime, clientWorkflow, workspaceBoundary, handoff, preview, acceptance, readiness }) {
  const selectedPanel = preview.panels.find((panel) => panel.id === clientRuntime.selectedPanel) || preview.panels[0] || null;
  const canResume = handoff.state === "prepared" && Boolean(handoff.resumeToken);
  const requiresAcknowledgement = clientRuntime.acknowledgementRequired && acceptance.accepted;
  const workflowState = canResume
    ? "resume-ready"
    : handoff.state === "blocked"
      ? "blocked"
      : readiness.state === "ready"
        ? "dashboard-ready"
        : "needs-refresh";
  const deliveryRoute = clientRuntime.deliveryMode === "external"
    ? handoff.target
    : clientWorkflow.state === "resume-pending"
      ? clientWorkflow.returnRoute
      : `${workspaceBoundary.routeScope}/workflow/${clientRuntime.requestId}`;
  const handoffInstruction = canResume
    ? {
      mode: clientWorkflow.channel,
      route: clientWorkflow.handoffRoute,
      returnRoute: clientWorkflow.returnRoute,
      returnStrategy: clientWorkflow.returnStrategy,
      resumeToken: handoff.resumeToken
    }
    : null;

  const actions = [
    {
      id: "open-selected-panel",
      label: `Open ${selectedPanel?.id || "dashboard"} panel`,
      enabled: Boolean(selectedPanel) && selectedPanel.status !== "unavailable",
      route: selectedPanel?.route || `${surfaceGroup}/${surfaceName}/preview`
    },
    {
      id: "acknowledge-acceptance",
      label: "Acknowledge accepted dashboard contract",
      enabled: requiresAcknowledgement,
      route: `${workspaceBoundary.routeScope}/acceptance/${clientRuntime.requestId}`
    },
    {
      id: "continue-handoff",
      label: "Continue hosted-kernel handoff",
      enabled: canResume,
      route: `${workspaceBoundary.routeScope}/handoff/${handoff.target}`
    },
    {
      id: "return-to-client-workflow",
      label: "Return to client workflow",
      enabled: clientWorkflow.state === "resume-pending" || clientWorkflow.state === "handoff-pending",
      route: clientWorkflow.returnRoute
    }
  ];

  return {
    contractVersion: "dashboard-workflow-handoff.v1",
    requestId: clientRuntime.requestId,
    sessionId: clientRuntime.sessionId,
    actor: clientRuntime.actor,
    tenantId: workspaceBoundary.tenantId,
    workspaceId: workspaceBoundary.workspaceId,
    state: workflowState,
    deliveryMode: clientRuntime.deliveryMode,
    deliveryRoute,
    clientWorkflowState: clientWorkflow.state,
    clientWorkflowProofId: clientWorkflow.proofId,
    handoffInstruction,
    selectedPanelId: selectedPanel?.id || null,
    selectedPanelStatus: selectedPanel?.status || "missing",
    resumeToken: canResume ? handoff.resumeToken : null,
    acknowledgementRequired: requiresAcknowledgement,
    nextActionId: actions.find((action) => action.enabled)?.id || "open-selected-panel",
    actions
  };
}

function buildHostedKernelHandoffEnvelope({
  provider,
  clientRuntime,
  clientWorkflow,
  workspaceBoundary,
  handoff,
  readiness,
  acceptance,
  providerServiceContract,
  stateCheckpoint,
  workflowHandoff,
  now
}) {
  const service = providerServiceContract.services.find((entry) => entry.id === "handoff") || null;
  const handoffRequested = handoff.requested || clientRuntime.intent === "handoff" || clientWorkflow.stage === "handoff";
  const hasResumeToken = handoff.state === "prepared" && Boolean(handoff.resumeToken);
  const blockedReasons = [
    workspaceBoundary.isolationState === "blocked" ? workspaceBoundary.reason : null,
    service?.state === "blocked" ? service.blockedReason : null,
    readiness.state === "blocked" ? "dashboard readiness is blocked" : null,
    handoffRequested && !hasResumeToken ? handoff.reason || "hosted-kernel handoff resume token is not available" : null
  ].filter(Boolean);
  const acknowledgementGateOpen = !clientRuntime.acknowledgementRequired || acceptance.accepted;
  const dispatchable = blockedReasons.length === 0 && hasResumeToken && acknowledgementGateOpen;
  const state = blockedReasons.length > 0
    ? "blocked"
    : dispatchable
      ? "dispatch-ready"
      : handoffRequested
        ? "awaiting-acceptance"
        : "preview-only";
  const destinationRoute = dispatchable
    ? workflowHandoff.deliveryRoute
    : state === "awaiting-acceptance"
      ? acceptance.submitRoute
      : clientWorkflow.returnRoute;
  const continuityKey = proofToken({
    requestId: clientRuntime.requestId,
    sessionId: clientRuntime.sessionId,
    workspace: workspaceBoundary.workspaceId,
    stepId: clientWorkflow.stepId,
    target: handoff.target,
    writeId: stateCheckpoint.writeId
  }).replace("proof_", "continuity_");
  const proofId = proofToken({
    providerId: provider.id,
    providerRevision: provider.revision,
    requestId: clientRuntime.requestId,
    workspace: workspaceBoundary.workspaceId,
    state,
    destinationRoute,
    resumeToken: hasResumeToken ? handoff.resumeToken : null,
    checkpointWriteId: stateCheckpoint.writeId,
    acceptanceToken: acceptance.acceptanceToken,
    serviceProofId: providerServiceContract.proofId
  });

  return {
    contractVersion: "dashboard-hosted-kernel-handoff-envelope.v1",
    requestId: clientRuntime.requestId,
    sessionId: clientRuntime.sessionId,
    providerId: provider.id,
    providerRevision: provider.revision,
    tenantId: workspaceBoundary.tenantId,
    workspaceId: workspaceBoundary.workspaceId,
    target: handoff.target,
    state,
    dispatchable,
    blockedReasons,
    destinationRoute,
    issuedAt: now,
    continuityKey,
    proofId,
    dispatchPolicy: {
      channel: clientWorkflow.channel,
      deliveryMode: clientRuntime.deliveryMode,
      returnStrategy: clientWorkflow.returnStrategy,
      openInNewContext: clientWorkflow.channel === "new-tab",
      preservePanel: clientWorkflow.returnStrategy === "preserve-panel",
      requiresAcknowledgement: clientRuntime.acknowledgementRequired,
      acknowledgementGateOpen
    },
    payload: {
      route: clientWorkflow.handoffRoute,
      returnRoute: clientWorkflow.returnRoute,
      originRoute: clientWorkflow.originRoute,
      selectedPanelId: clientWorkflow.selectedPanelId,
      stepId: clientWorkflow.stepId,
      resumeToken: hasResumeToken ? handoff.resumeToken : null,
      tenantScopedClaim: hasResumeToken ? handoff.tenantScopedClaim : null,
      boundaryProof: workspaceBoundary.boundaryProof,
      permissionProof: workspaceBoundary.permissionProof,
      checkpointWriteId: stateCheckpoint.writeId,
      providerServiceProofId: providerServiceContract.proofId,
      acceptanceToken: acceptance.acceptanceToken
    },
    userVisible: {
      title: dispatchable ? "Continue hosted-kernel handoff" : state === "blocked" ? "Handoff blocked" : "Review handoff",
      primaryActionId: dispatchable ? "dispatch-hosted-kernel-handoff" : state === "awaiting-acceptance" ? "acknowledge-acceptance" : "return-to-client-workflow",
      primaryRoute: destinationRoute,
      detail: blockedReasons[0] || (dispatchable
        ? `Resume ${handoff.target} using the prepared hosted-kernel token.`
        : "Complete acceptance before dispatching the hosted-kernel handoff.")
    }
  };
}

function buildClientWorkflowLaunchContract({
  clientRuntime,
  clientWorkflow,
  workspaceBoundary,
  readiness,
  acceptance,
  workflowHandoff,
  handoffEnvelope,
  providerServiceContract,
  stateCheckpoint,
  now
}) {
  const handoffService = providerServiceContract.services.find((service) => service.id === "handoff") || null;
  const launchRequested = clientRuntime.intent === "handoff"
    || clientRuntime.workflowStage === "handoff"
    || clientRuntime.workflowStage === "resume"
    || handoffEnvelope.state === "dispatch-ready"
    || workflowHandoff.state === "resume-ready";
  const acknowledgementBlocked = clientRuntime.acknowledgementRequired && !acceptance.accepted;
  const serviceBlocked = handoffService?.state === "blocked";
  const routeBlocked = clientWorkflow.state === "blocked" || handoffEnvelope.state === "blocked";
  const readinessBlocked = readiness.state === "blocked";
  const blockers = [
    workspaceBoundary.isolationState === "blocked" ? {
      code: "workspace_boundary_blocked",
      message: workspaceBoundary.reason || "Workspace boundary blocked client workflow launch.",
      route: `${workspaceBoundary.routeScope}/boundary`
    } : null,
    serviceBlocked ? {
      code: "handoff_service_blocked",
      message: handoffService?.blockedReason || "Hosted-kernel handoff service is blocked.",
      route: handoffService?.route || `${workspaceBoundary.routeScope}/provider/handoff`
    } : null,
    routeBlocked ? {
      code: "workflow_route_blocked",
      message: handoffEnvelope.blockedReasons[0] || clientWorkflow.pendingActions[0]?.reason || "Client workflow route cannot be resolved.",
      route: handoffEnvelope.payload.route || clientWorkflow.handoffRoute
    } : null,
    acknowledgementBlocked ? {
      code: "acceptance_acknowledgement_required",
      message: "Dashboard acceptance must be acknowledged before launching the hosted-kernel workflow.",
      route: acceptance.submitRoute
    } : null,
    readinessBlocked ? {
      code: "dashboard_readiness_blocked",
      message: "Dashboard readiness is blocked for this client workflow launch.",
      route: readiness.route
    } : null
  ].filter(Boolean);
  const launchState = blockers.length > 0
    ? "blocked"
    : handoffEnvelope.dispatchable
      ? "ready"
      : launchRequested
        ? "pending"
        : "idle";
  const launchRoute = launchState === "ready"
    ? handoffEnvelope.destinationRoute
    : acknowledgementBlocked
      ? acceptance.submitRoute
      : blockers[0]?.route || workflowHandoff.deliveryRoute;
  const resumeContext = {
    requestId: clientRuntime.requestId,
    sessionId: clientRuntime.sessionId,
    stepId: clientWorkflow.stepId,
    tenantId: workspaceBoundary.tenantId,
    workspaceId: workspaceBoundary.workspaceId,
    selectedPanelId: clientWorkflow.selectedPanelId,
    returnRoute: clientWorkflow.returnRoute,
    originRoute: clientWorkflow.originRoute,
    checkpointWriteId: stateCheckpoint.writeId,
    continuityKey: handoffEnvelope.continuityKey,
    acceptanceToken: acceptance.acceptanceToken,
    resumeToken: handoffEnvelope.payload.resumeToken,
    tenantScopedClaim: handoffEnvelope.payload.tenantScopedClaim
  };
  const commandPayload = {
    commandType: launchState === "ready" ? "prepare-handoff" : acknowledgementBlocked ? "acknowledge-acceptance" : "refresh-status",
    idempotencyKey: proofToken({
      requestId: clientRuntime.requestId,
      stepId: clientWorkflow.stepId,
      writeId: stateCheckpoint.writeId,
      launchState
    }).replace("proof_", "launch_"),
    route: launchRoute,
    proofRefs: {
      handoffEnvelopeProofId: handoffEnvelope.proofId,
      clientWorkflowProofId: clientWorkflow.proofId,
      checkpointWriteId: stateCheckpoint.writeId,
      providerServiceProofId: providerServiceContract.proofId
    }
  };

  return {
    contractVersion: "dashboard-client-workflow-launch.v1",
    requestId: clientRuntime.requestId,
    state: launchState,
    requested: launchRequested,
    dispatchable: launchState === "ready",
    launchRoute,
    delivery: {
      mode: clientRuntime.deliveryMode,
      channel: clientWorkflow.channel,
      openInNewContext: clientWorkflow.channel === "new-tab",
      returnStrategy: clientWorkflow.returnStrategy,
      preservePanel: clientWorkflow.returnStrategy === "preserve-panel",
      selectedPanelId: clientWorkflow.selectedPanelId
    },
    blockers,
    blockerCount: blockers.length,
    resumeContext,
    commandPayload,
    userVisible: {
      title: launchState === "ready" ? "Launch hosted-kernel workflow" : launchState === "blocked" ? "Workflow launch blocked" : launchRequested ? "Prepare workflow launch" : "Workflow launch idle",
      primaryActionId: commandPayload.commandType,
      primaryRoute: launchRoute,
      detail: blockers[0]?.message || (launchState === "ready"
        ? "The hosted-kernel workflow can be launched with a scoped resume context."
        : launchRequested
          ? "The hosted-kernel workflow is waiting for readiness or acceptance."
          : "No hosted-kernel workflow launch was requested.")
    },
    issuedAt: now,
    proofId: proofToken({
      requestId: clientRuntime.requestId,
      workspace: workspaceBoundary.workspaceId,
      state: launchState,
      launchRoute,
      blockers: blockers.map((blocker) => blocker.code),
      continuityKey: handoffEnvelope.continuityKey,
      checkpointWriteId: stateCheckpoint.writeId
    })
  };
}

function normalizeProcessActionPressure(input = {}, workspaceBoundary, syncMetadata, now) {
  const cliPs = input.cliPs && typeof input.cliPs === "object" && input.cliPs !== null ? input.cliPs : {};
  const rawQueue = input.processActionQueue && typeof input.processActionQueue === "object" && input.processActionQueue !== null
    ? input.processActionQueue
    : cliPs.operatorActionQueue && typeof cliPs.operatorActionQueue === "object" && cliPs.operatorActionQueue !== null
      ? cliPs.operatorActionQueue
      : cliPs.contract?.operatorActionQueue && typeof cliPs.contract.operatorActionQueue === "object"
        ? cliPs.contract.operatorActionQueue
        : {};
  const rawEntries = Array.isArray(rawQueue.entries)
    ? rawQueue.entries
    : Array.isArray(input.processActions)
      ? input.processActions
      : [];
  const fallbackProcesses = Array.isArray(input.processes)
    ? input.processes
    : Array.isArray(input.runningJobs)
      ? input.runningJobs
      : [];
  const derivedEntries = rawEntries.length > 0
    ? rawEntries
    : fallbackProcesses
      .filter((process) => process && typeof process === "object")
      .map((process, index) => {
        const state = normalizeString(process.state || process.status, "unknown");
        const health = normalizeString(process.health, state === "failed" ? "failed" : state === "blocked" ? "degraded" : "unknown");
        const pid = normalizeString(process.pid || process.id || process.jobId, `process-${index + 1}`);
        const failed = state === "failed" || health === "failed";
        const blocked = state === "blocked" || process.blocked === true || process.attentionRequired === true;
        const retryable = process.retryable === true || process.retry?.retryable === true || process.attemptsRemaining > 0;
        const action = failed || blocked
          ? retryable ? "schedule-retry" : "handoff-process"
          : health === "degraded"
            ? "inspect-process"
            : "monitor";

        return {
          pid,
          command: normalizeString(process.command || process.name, pid),
          action,
          severity: failed ? "critical" : blocked ? "warning" : health === "degraded" ? "notice" : "normal",
          reason: normalizeString(process.reason || process.lastError || process.blockedReason, action === "monitor" ? "none" : state),
          ready: action !== "monitor",
          blocksDispatch: failed || blocked,
          retryReady: retryable,
          notBefore: normalizeString(process.notBefore || process.nextRetryAt, null)
        };
      });
  const severityWeight = { critical: 4, error: 4, warning: 3, notice: 2, info: 1, normal: 0 };
  const actionWeight = {
    "repair-exit-contract": 100,
    "restore-required-dependency": 95,
    "renew-lease": 90,
    "refresh-before-replay": 85,
    "handoff-process": 80,
    "schedule-retry": 70,
    "refresh-process-table": 65,
    "inspect-process": 50,
    monitor: 10
  };
  const entries = derivedEntries
    .filter((entry) => entry && typeof entry === "object")
    .map((entry, index) => {
      const action = normalizeString(entry.action || entry.nextAction || entry.operatorAction, "inspect-process");
      const pid = normalizeString(entry.pid || entry.processId || entry.id, `process-${index + 1}`);
      const severity = normalizeString(entry.severity, entry.blocksDispatch ? "warning" : "notice");
      const priority = Math.trunc(normalizeNumber(
        entry.priority,
        (actionWeight[action] || 0) + ((severityWeight[severity] || 0) * 10),
        { min: 0, max: 1000 }
      ));

      return {
        contractVersion: "dashboard-process-action-entry.v1",
        index,
        pid,
        command: normalizeString(entry.command || entry.name, pid),
        action,
        priority,
        severity,
        reason: normalizeString(entry.reason || entry.code, "process-action-required"),
        message: normalizeString(entry.message || entry.label, `Process ${pid} requires ${action}.`),
        route: normalizeString(entry.route, `${workspaceBoundary.routeScope}/processes/${encodeURIComponent(pid)}`),
        ready: entry.ready !== false,
        blocksDispatch: entry.blocksDispatch === true || severity === "critical" || severity === "error",
        retryReady: entry.retryReady === true || action === "schedule-retry",
        handoffReady: entry.handoffReady === true || action === "handoff-process",
        readOnly: entry.readOnly === true,
        notBefore: normalizeString(entry.notBefore || entry.nextRetryAt, null),
        idempotencyKey: normalizeString(
          entry.idempotencyKey,
          proofToken({ workspace: workspaceBoundary.workspaceId, cursor: syncMetadata.cursor, pid, action, reason: entry.reason || entry.code }).replace("proof_", "process_action_")
        ),
        proofRefs: entry.proofRefs && typeof entry.proofRefs === "object" ? entry.proofRefs : {}
      };
    })
    .sort((left, right) => (
      right.priority - left.priority
      || String(left.notBefore || "").localeCompare(String(right.notBefore || ""))
      || left.pid.localeCompare(right.pid)
    ))
    .slice(0, 20);
  const readyEntries = entries.filter((entry) => entry.ready);
  const blockedEntries = entries.filter((entry) => entry.blocksDispatch);
  const handoffEntries = entries.filter((entry) => entry.handoffReady);
  const retryEntries = entries.filter((entry) => entry.retryReady);
  const byAction = entries.reduce((summary, entry) => {
    summary[entry.action] = (summary[entry.action] || 0) + 1;
    return summary;
  }, {});
  const upstreamState = normalizeString(rawQueue.state, null);
  const state = upstreamState || (blockedEntries.length
    ? "blocked"
    : readyEntries.length
      ? "actionable"
      : entries.length
        ? "watching"
        : "clear");

  return {
    contractVersion: "dashboard-process-action-pressure.v1",
    state,
    generatedAt: normalizeString(rawQueue.generatedAt, now),
    cursor: normalizeString(rawQueue.cursor, syncMetadata.cursor),
    totalCount: entries.length,
    readyCount: readyEntries.length,
    blockedCount: blockedEntries.length,
    retryReadyCount: retryEntries.length,
    handoffReadyCount: handoffEntries.length,
    readOnly: rawQueue.readOnly === true || entries.some((entry) => entry.readOnly),
    primaryAction: entries[0] || null,
    entries,
    summary: {
      byAction,
      source: rawEntries.length > 0 ? "cli-ps-action-queue" : fallbackProcesses.length > 0 ? "derived-processes" : "empty",
      upstreamState,
      visibleProcessCount: normalizeNumber(rawQueue.summary?.visibleProcessCount, fallbackProcesses.length, { min: 0 }),
      redactedProcessCount: normalizeNumber(rawQueue.summary?.redactedProcessCount, 0, { min: 0 }),
      nextNotBefore: entries
        .map((entry) => entry.notBefore)
        .filter(Boolean)
        .sort()[0] || null
    },
    route: `${workspaceBoundary.routeScope}/process-actions`,
    proofId: proofToken({
      workspace: workspaceBoundary.workspaceId,
      cursor: syncMetadata.cursor,
      state,
      entries: entries.map((entry) => [entry.pid, entry.action, entry.priority, entry.blocksDispatch, entry.notBefore]),
      upstreamProof: rawQueue.proof?.queueChecksum || rawQueue.proofId || null
    })
  };
}

function normalizeCliRunStatusBridge(input = {}, workspaceBoundary, syncMetadata, now) {
  const raw = input.cliRunStatusBridge && typeof input.cliRunStatusBridge === "object"
    ? input.cliRunStatusBridge
    : input.cliRunStatus && typeof input.cliRunStatus === "object"
      ? input.cliRunStatus
      : input.cliRun && typeof input.cliRun === "object"
        ? input.cliRun.clientStatusBridge || input.cliRun
        : {};
  const present = Object.keys(raw).length > 0;
  const tenantId = normalizeString(raw.tenantId, workspaceBoundary.tenantId);
  const workspaceId = normalizeString(raw.workspaceId, workspaceBoundary.workspaceId);
  const commandId = normalizeString(raw.persistedCommandId || raw.commandId, null);
  const validation = raw.validation && typeof raw.validation === "object" ? raw.validation : {};
  const readiness = raw.readiness && typeof raw.readiness === "object" ? raw.readiness : {};
  const recovery = raw.recovery && typeof raw.recovery === "object" ? raw.recovery : {};
  const nextStep = raw.nextStep && typeof raw.nextStep === "object" ? raw.nextStep : {};
  const clientPatch = raw.clientStatePatch && typeof raw.clientStatePatch === "object" ? raw.clientStatePatch : {};
  const lease = raw.lease && typeof raw.lease === "object" ? raw.lease : null;
  const validationCodes = normalizeStringList(validation.violationCodes);
  const recoveryRoutes = Array.isArray(recovery.routes)
    ? recovery.routes
        .filter((route) => route && typeof route === "object")
        .slice(0, 8)
        .map((route, index) => ({
          id: normalizeString(route.rel, `recovery-${index + 1}`),
          commandId: normalizeString(route.commandId, commandId),
          action: normalizeString(route.action, "inspect-command"),
          enabled: route.enabled !== false,
          route: normalizeString(route.route, `${workspaceBoundary.routeScope}/cli-run/recovery/${encodeURIComponent(normalizeString(route.commandId, commandId || "unknown"))}`),
          expectedAck: normalizeString(route.expectedAck, null),
          resumeToken: normalizeString(route.resumeToken, null),
          nextPollAfter: normalizeString(route.nextPollAfter, null)
        }))
    : [];
  const scopeMatches = tenantId === workspaceBoundary.tenantId && workspaceId === workspaceBoundary.workspaceId;
  const upstreamReadiness = normalizeString(readiness.state || clientPatch.readinessState, present ? "unknown" : "not-reported");
  const upstreamRecoveryState = normalizeString(recovery.state || clientPatch.recoveryState, present ? "unknown" : "not-reported");
  const restartSafeStatus = normalizeString(clientPatch.restartSafeStatus || lease?.restartSafeStatus, "unknown");
  const recoveryRequired = present && (
    upstreamReadiness === "recovery-required"
      || upstreamRecoveryState === "operator-action-required"
      || restartSafeStatus === "expired-needs-recovery"
      || recoveryRoutes.some((route) => route.enabled && route.action.includes("recover"))
  );
  const validationBlocked = present && (validation.ok === false || validationCodes.length > 0);
  const scopeBlocked = present && !scopeMatches;
  const state = !present
    ? "not-reported"
    : scopeBlocked
      ? "scope-blocked"
      : validationBlocked
        ? "blocked"
        : recoveryRequired
          ? "recovery-required"
          : upstreamReadiness === "blocked"
            ? "blocked"
            : upstreamReadiness === "degraded"
              ? "degraded"
              : "ready";
  const primaryRoute = normalizeString(
    nextStep.route,
    recoveryRoutes.find((route) => route.enabled)?.route || `${workspaceBoundary.routeScope}/cli-run/status`
  );
  const proofId = proofToken({
    workspace: workspaceBoundary.workspaceId,
    cursor: syncMetadata.cursor,
    present,
    scopeMatches,
    commandId,
    upstreamReadiness,
    upstreamRecoveryState,
    restartSafeStatus,
    validationCodes,
    routeIds: recoveryRoutes.map((route) => [route.id, route.commandId, route.action])
  });

  return {
    contractVersion: "dashboard-cli-run-status-bridge.v1",
    present,
    state,
    tenantId,
    workspaceId,
    commandId,
    requestId: normalizeString(raw.requestId, null),
    idempotencyKey: normalizeString(raw.idempotencyKey || clientPatch.idempotencyKey, null),
    scopeMatches,
    validationCodes,
    upstreamReadiness,
    upstreamRecoveryState,
    restartSafeStatus,
    accepted: raw.accepted === true,
    idempotentReplay: raw.idempotentReplay === true || clientPatch.idempotentReplay === true,
    safeResume: readiness.safeResume === true,
    safeRetry: readiness.safeRetry === true,
    safeHandoff: readiness.safeHandoff === true,
    leaseExpired: lease?.expired === true || restartSafeStatus === "expired-needs-recovery",
    recoveryRequired,
    recoveryRoutes,
    primaryAction: {
      id: normalizeString(nextStep.action, recoveryRequired ? "recover-cli-run-command" : "inspect-cli-run-status"),
      reason: normalizeString(
        nextStep.reason,
        scopeBlocked
          ? "cli-run status bridge belongs to a different tenant or workspace."
          : validationCodes[0] || upstreamRecoveryState
      ),
      route: primaryRoute,
      pollAfter: normalizeString(nextStep.pollAfter, null)
    },
    clientStatePatch: {
      ...clientPatch,
      dashboardCliRunBridgeState: state,
      dashboardCliRunBridgeProofId: proofId,
      scopedToDashboardWorkspace: scopeMatches
    },
    proofId,
    route: `${workspaceBoundary.routeScope}/cli-run/status`
  };
}

function buildValidationSummary({ provider, capabilityNegotiation, syncMetadata, handoff, previewRequest, clientRuntime, clientWorkflow, workspaceBoundary, operationalHealth, healthValidation, lifecycleControl, providerServiceContract, recovery, operationalSnapshotRecovery, commandRecovery, commandOutcome, processActionPressure, cliRunStatusBridge, cliRunExportHandoff, mailchimpCampaignHandoff }) {
  const findings = [];

  if (workspaceBoundary && workspaceBoundary.isolationState === "blocked") {
    findings.push({
      severity: "error",
      code: "workspace_boundary_blocked",
      message: workspaceBoundary.reason
    });
  }
  if (workspaceBoundary?.unsupportedPermissions?.length > 0) {
    findings.push({
      severity: "error",
      code: "workspace_permissions_unsupported",
      message: `Unsupported dashboard permissions were requested: ${workspaceBoundary.unsupportedPermissions.join(", ")}.`
    });
  }
  if (workspaceBoundary?.missingRequiredPermissions?.length > 0) {
    findings.push({
      severity: "error",
      code: "workspace_permissions_incomplete",
      message: `Dashboard boundary is missing required permissions: ${workspaceBoundary.missingRequiredPermissions.join(", ")}.`
    });
  }
  if (capabilityNegotiation.denied?.length > 0) {
    findings.push({
      severity: "error",
      code: "capabilities_denied_by_role",
      message: `Actor role ${workspaceBoundary?.role || "unknown"} denied ${capabilityNegotiation.denied.join(", ")}.`
    });
  }
  if (!capabilityNegotiation.granted.includes("dashboard.read")) {
    findings.push({
      severity: "error",
      code: "dashboard_read_not_granted",
      message: "Dashboard preview cannot be served without dashboard.read."
    });
  }
  if (!capabilityNegotiation.granted.includes("kernel.status.read")) {
    findings.push({
      severity: "warning",
      code: "kernel_status_not_observable",
      message: "Kernel status panel will be marked unavailable until kernel.status.read is granted."
    });
  }
  if (syncMetadata.status !== "ready") {
    findings.push({
      severity: "warning",
      code: "sync_paused",
      message: "Incremental sync is paused for this dashboard model response."
    });
  }
  if (handoff.state === "blocked") {
    findings.push({
      severity: "error",
      code: "handoff_blocked",
      message: handoff.reason
    });
  }
  if (provider.mode !== "hosted-kernel") {
    findings.push({
      severity: "info",
      code: "external_provider_mode",
      message: "Provider is running in external mode; hosted-kernel readiness is informational."
    });
  }
  if (operationalHealth && operationalHealth.state === "blocked") {
    findings.push({
      severity: "error",
      code: "hosted_kernel_health_blocked",
      message: operationalHealth.actionableErrors.find((error) => error.severity === "error")?.message || "Hosted-kernel health blocks dashboard service."
    });
  }
  if (operationalHealth && operationalHealth.degradedModeActive) {
    findings.push({
      severity: "warning",
      code: "hosted_kernel_degraded_mode",
      message: "Dashboard is serving a degraded hosted-kernel view with retry guidance."
    });
  }
  if (operationalHealth && operationalHealth.retry.retryable) {
    findings.push({
      severity: "info",
      code: "hosted_kernel_retry_scheduled",
      message: `Next hosted-kernel health retry is scheduled at ${operationalHealth.retry.nextAttemptAt}.`
    });
  }
  if (healthValidation && healthValidation.state === "blocked") {
    findings.push({
      severity: "error",
      code: "hosted_kernel_health_validation_blocked",
      message: healthValidation.findings.find((finding) => finding.severity === "error")?.message || "Hosted-kernel health validation blocks dashboard serving."
    });
  }
  if (healthValidation && healthValidation.state === "degraded") {
    findings.push({
      severity: "warning",
      code: "hosted_kernel_health_validation_degraded",
      message: healthValidation.findings.find((finding) => finding.severity === "warning")?.message || "Hosted-kernel health validation recommends degraded mode."
    });
  }
  if (lifecycleControl && lifecycleControl.settingErrors.length > 0) {
    findings.push({
      severity: "error",
      code: "lifecycle_settings_invalid",
      message: lifecycleControl.settingErrors.join("; ")
    });
  }
  if (lifecycleControl && lifecycleControl.state === "blocked") {
    findings.push({
      severity: lifecycleControl.enabled ? "warning" : "error",
      code: "lifecycle_control_blocked",
      message: lifecycleControl.blockedReason || "Lifecycle controls are blocking dashboard commands."
    });
  }
  if (lifecycleControl && lifecycleControl.state === "paused") {
    findings.push({
      severity: "warning",
      code: "lifecycle_paused",
      message: `Lifecycle commands are paused until ${lifecycleControl.schedule.nextScheduledAt || "the configured resume time"}.`
    });
  }
  if (lifecycleControl && lifecycleControl.schedule.nextScheduledAt) {
    findings.push({
      severity: "info",
      code: "lifecycle_next_run_scheduled",
      message: `Next lifecycle evaluation is scheduled at ${lifecycleControl.schedule.nextScheduledAt}.`
    });
  }
  if (providerServiceContract && providerServiceContract.state === "blocked") {
    findings.push({
      severity: "error",
      code: "provider_service_contract_blocked",
      message: `Provider service contract is blocked for ${providerServiceContract.blockedServiceIds.join(", ") || "workspace boundary"}.`
    });
  }
  if (providerServiceContract && providerServiceContract.state === "degraded") {
    findings.push({
      severity: "warning",
      code: "provider_service_contract_degraded",
      message: `Provider service contract is degraded for ${[...providerServiceContract.degradedServiceIds, ...providerServiceContract.blockedServiceIds].join(", ")}.`
    });
  }
  if (providerServiceContract && !providerServiceContract.providerCompatibility.compatible) {
    findings.push({
      severity: "error",
      code: "provider_service_contract_incompatible",
      message: providerServiceContract.providerCompatibility.blockers[0]?.message || "Provider service declarations are incompatible with dashboard service requirements."
    });
  }
  if (clientRuntime && clientRuntime.intent === "handoff" && !capabilityNegotiation.granted.includes("handoff.prepare")) {
    findings.push({
      severity: "error",
      code: "client_handoff_intent_unmet",
      message: "Client requested a handoff workflow, but handoff.prepare was not granted."
    });
  }
  if (clientRuntime && previewRequest.requested && !previewRequest.panels.includes(clientRuntime.selectedPanel)) {
    findings.push({
      severity: "warning",
      code: "client_panel_not_in_preview",
      message: `Client selected panel ${clientRuntime.selectedPanel}, but it is not part of the preview request.`
    });
  }
  if (clientWorkflow && clientWorkflow.state === "blocked") {
    findings.push({
      severity: "error",
      code: "client_workflow_blocked",
      message: clientWorkflow.pendingActions[0]?.reason || "Client workflow handoff cannot be completed in the current dashboard state."
    });
  }
  if (clientWorkflow && clientWorkflow.pendingActionCount > 0 && clientWorkflow.state !== "blocked") {
    findings.push({
      severity: "info",
      code: "client_workflow_actions_pending",
      message: `${clientWorkflow.pendingActionCount} client workflow handoff action(s) are available.`
    });
  }
  if (recovery && recovery.replayRequired) {
    findings.push({
      severity: "warning",
      code: "restart_replay_required",
      message: "Persisted dashboard state does not match the active request and must be replayed before resume."
    });
  }
  if (recovery && recovery.state === "ledger-repair-required") {
    findings.push({
      severity: "error",
      code: "restart_command_ledger_repair_required",
      message: "Persisted dashboard command history contains duplicate command or idempotency keys and must be repaired before dispatch."
    });
  }
  if (operationalSnapshotRecovery && operationalSnapshotRecovery.state === "refresh-required") {
    findings.push({
      severity: operationalSnapshotRecovery.quarantinedScopeViolationCount > 0 ? "error" : "warning",
      code: "restart_operational_snapshot_refresh_required",
      message: operationalSnapshotRecovery.driftReasons[0] || "Persisted operational dashboard snapshot requires refresh after restart."
    });
  }
  if (operationalSnapshotRecovery && operationalSnapshotRecovery.quarantinedScopeViolationCount > 0) {
    findings.push({
      severity: "error",
      code: "restart_operational_snapshot_scope_quarantined",
      message: operationalSnapshotRecovery.quarantinedScopeViolations[0]?.reason || "Persisted operational dashboard snapshot was quarantined by workspace scope validation."
    });
  }
  if (operationalSnapshotRecovery && operationalSnapshotRecovery.state === "drift-detected") {
    findings.push({
      severity: "info",
      code: "restart_operational_snapshot_drift_detected",
      message: operationalSnapshotRecovery.driftReasons[0] || "Persisted operational dashboard snapshot changed after restart."
    });
  }
  if (processActionPressure && processActionPressure.blockedCount > 0) {
    findings.push({
      severity: "error",
      code: "process_action_queue_blocked",
      message: `${processActionPressure.blockedCount} process action(s) block operator dispatch.`
    });
  }
  if (processActionPressure && processActionPressure.readyCount > 0 && processActionPressure.blockedCount === 0) {
    findings.push({
      severity: "warning",
      code: "process_action_queue_ready",
      message: `${processActionPressure.readyCount} process action(s) are ready for operator review.`
    });
  }
  if (processActionPressure && processActionPressure.readOnly) {
    findings.push({
      severity: "warning",
      code: "process_action_queue_read_only",
      message: "Process actions are currently read-only until the process table or provider sync barrier clears."
    });
  }
  if (cliRunStatusBridge?.scopeMatches === false) {
    findings.push({
      severity: "error",
      code: "cli_run_status_bridge_scope_mismatch",
      message: "cli-run status bridge was produced for a different tenant or workspace boundary."
    });
  }
  if (cliRunStatusBridge?.state === "blocked") {
    findings.push({
      severity: "error",
      code: "cli_run_status_bridge_blocked",
      message: cliRunStatusBridge.validationCodes[0] || cliRunStatusBridge.primaryAction.reason || "cli-run status bridge is blocked."
    });
  }
  if (cliRunStatusBridge?.state === "recovery-required") {
    findings.push({
      severity: "warning",
      code: "cli_run_recovery_required",
      message: cliRunStatusBridge.primaryAction.reason || "cli-run has restart-safe command recovery work before dashboard dispatch."
    });
  }
  if (cliRunStatusBridge?.state === "degraded") {
    findings.push({
      severity: "warning",
      code: "cli_run_status_bridge_degraded",
      message: "cli-run reports degraded readiness for the active command surface."
    });
  }
  if (cliRunExportHandoff?.state === "scope-blocked") {
    findings.push({
      severity: "error",
      code: "cli_run_export_handoff_scope_mismatch",
      message: cliRunExportHandoff.reason
    });
  }
  if (cliRunExportHandoff?.state === "invalid") {
    findings.push({
      severity: "error",
      code: "cli_run_export_handoff_invalid",
      message: cliRunExportHandoff.reason
    });
  }
  if (cliRunExportHandoff?.state === "source-blocked") {
    findings.push({
      severity: "warning",
      code: "cli_run_export_handoff_source_blocked",
      message: cliRunExportHandoff.reason
    });
  }
  if (cliRunExportHandoff?.state === "stale") {
    findings.push({
      severity: "warning",
      code: "cli_run_export_handoff_stale",
      message: cliRunExportHandoff.reason
    });
  }
  if (cliRunExportHandoff?.accepted) {
    findings.push({
      severity: "info",
      code: "cli_run_export_handoff_ready",
      message: `${cliRunExportHandoff.counters.exportRows} cli-run analytics export row(s) are ready for dashboard ingestion.`
    });
  }
  if (mailchimpCampaignHandoff?.state === "scope-blocked") {
    findings.push({
      severity: "error",
      code: "mailchimp_campaign_scope_blocked",
      message: mailchimpCampaignHandoff.deliveryReadiness.reason
    });
  }
  if (mailchimpCampaignHandoff?.state === "blocked" || mailchimpCampaignHandoff?.state === "export-blocked") {
    findings.push({
      severity: "error",
      code: "mailchimp_campaign_export_blocked",
      message: mailchimpCampaignHandoff.exportReadiness?.validation?.[0] || mailchimpCampaignHandoff.deliveryReadiness.reason
    });
  }
  if (mailchimpCampaignHandoff?.state === "degraded" || mailchimpCampaignHandoff?.state === "rate-limited") {
    findings.push({
      severity: "warning",
      code: "mailchimp_campaign_sync_degraded",
      message: mailchimpCampaignHandoff.deliveryReadiness.reason || "Mailchimp campaign-linked log proof is waiting for provider sync."
    });
  }
  if (mailchimpCampaignHandoff?.accepted && mailchimpCampaignHandoff.exportReadiness?.present) {
    findings.push({
      severity: "info",
      code: "mailchimp_campaign_export_ready",
      message: `${mailchimpCampaignHandoff.exportReadiness.counters.attachableRecords} Mailchimp campaign log proof row(s) are ready to attach.`
    });
  }
  if (commandRecovery && commandRecovery.dispatchMode === "repair-ledger") {
    findings.push({
      severity: "error",
      code: "command_recovery_ledger_repair_blocked",
      message: commandRecovery.dispatchBlocker
    });
  }
  if (commandRecovery && commandRecovery.dispatchMode === "defer-until-replay") {
    findings.push({
      severity: "warning",
      code: "command_recovery_replay_before_resume",
      message: commandRecovery.dispatchBlocker
    });
  }
  if (commandRecovery && commandRecovery.dispatchMode === "health-blocked") {
    findings.push({
      severity: "error",
      code: "command_recovery_health_blocked",
      message: commandRecovery.dispatchBlocker || "Hosted-kernel health blocks command dispatch."
    });
  }
  if (commandRecovery && commandRecovery.dispatchMode === "wait-for-health-retry") {
    findings.push({
      severity: "warning",
      code: "command_recovery_health_backoff_active",
      message: commandRecovery.dispatchBlocker || "Hosted-kernel retry backoff is active before another command dispatch."
    });
  }
  if (commandRecovery && commandRecovery.degradedDispatch) {
    findings.push({
      severity: "warning",
      code: "command_recovery_degraded_dispatch",
      message: "Command dispatch is allowed under degraded hosted-kernel health; retry guidance remains active."
    });
  }
  if (commandRecovery && commandRecovery.idempotentReplay) {
    findings.push({
      severity: "info",
      code: "command_recovery_idempotent_result",
      message: "Command recovery will return the persisted result instead of dispatching a duplicate hosted-kernel command."
    });
  }
  if (commandOutcome && commandOutcome.state === "blocked") {
    findings.push({
      severity: "error",
      code: "command_blocked",
      message: commandOutcome.blockedReason
    });
  }
  if (commandOutcome && commandOutcome.duplicate) {
    findings.push({
      severity: "info",
      code: "command_idempotent_replay",
      message: commandOutcome.duplicateReason || "Command replay was deduplicated against persisted dashboard state."
    });
  }

  return {
    ok: findings.every((finding) => finding.severity !== "error"),
    checkedAt: syncMetadata.generatedAt,
    previewRequested: previewRequest.requested,
    findingCount: findings.length,
    findings
  };
}

function buildDashboardPreview({ provider, capabilityNegotiation, syncMetadata, handoff, previewRequest, validationSummary, operationalHealth, workspaceBoundary }) {
  const panelStatus = {
    "kernel-status": operationalHealth?.blocks.dashboard
      ? "blocked"
      : capabilityNegotiation.granted.includes("kernel.status.read")
        ? operationalHealth?.degradedModeActive ? "degraded" : "ready"
        : "unavailable",
    "sync-state": operationalHealth?.blocks.sync
      ? "degraded"
      : syncMetadata.status === "ready"
        ? "ready"
        : "paused",
    handoff: operationalHealth?.blocks.handoff
      ? "blocked"
      : handoff.state === "prepared" || handoff.state === "not-requested"
        ? "ready"
        : "blocked"
  };
  const panels = previewRequest.panels.map((panel) => ({
    id: panel,
    status: workspaceBoundary.isolationState === "blocked" ? "unavailable" : panelStatus[panel] || "unknown",
    route: `${workspaceBoundary.routeScope}/preview/${panel}`,
    refreshCursor: syncMetadata.nextCursor
  }));

  return {
    contractVersion: "dashboard-preview.v1",
    visible: previewRequest.requested,
    audience: previewRequest.audience,
    detail: previewRequest.detail,
    tenantId: workspaceBoundary.tenantId,
    workspaceId: workspaceBoundary.workspaceId,
    isolationState: workspaceBoundary.isolationState,
    providerBadge: `${provider.id}@${provider.revision}`,
    readyPanelCount: panels.filter((panel) => panel.status === "ready").length,
    degradedPanelCount: panels.filter((panel) => panel.status === "degraded").length,
    panels,
    validationStatus: validationSummary.ok ? "pass" : "needs-attention"
  };
}

function buildAcceptanceContract({ provider, capabilityNegotiation, syncMetadata, handoff, validationSummary, operationalHealth, providerServiceContract, audit, workspaceBoundary, mailchimpCampaignHandoff }) {
  const requiredSignals = [
    { id: "workspace-scoped", accepted: workspaceBoundary.isolationState === "scoped" },
    { id: "permission-boundary-ready", accepted: workspaceBoundary.permissionState === "ready" },
    { id: "dashboard-readable", accepted: capabilityNegotiation.granted.includes("dashboard.read") },
    { id: "kernel-observable", accepted: capabilityNegotiation.granted.includes("kernel.status.read") },
    { id: "hosted-kernel-healthy", accepted: !operationalHealth || operationalHealth.state === "healthy" },
    { id: "provider-services-ready", accepted: !providerServiceContract || providerServiceContract.state === "ready" },
    { id: "sync-ready", accepted: syncMetadata.status === "ready" },
    { id: "handoff-resolvable", accepted: handoff.state !== "blocked" },
    ...(mailchimpCampaignHandoff?.present
      ? [
          { id: "mailchimp-campaign-scope-ready", accepted: mailchimpCampaignHandoff.scopeMatches && mailchimpCampaignHandoff.exportReadiness.scopeMatches },
          { id: "mailchimp-campaign-export-ready", accepted: mailchimpCampaignHandoff.accepted && mailchimpCampaignHandoff.deliveryReadiness.canAttachLogProof },
        ]
      : []),
    { id: "audit-proof-issued", accepted: Boolean(audit.proofId) }
  ];
  const accepted = validationSummary.ok && requiredSignals.every((signal) => signal.accepted);

  return {
    contractVersion: "dashboard-acceptance.v1",
    accepted,
    acceptanceToken: accepted ? proofToken({ providerId: provider.id, cursor: syncMetadata.cursor, proofId: audit.proofId, workspace: workspaceBoundary.workspaceId }) : null,
    requiredSignals,
    blockedBy: requiredSignals.filter((signal) => !signal.accepted).map((signal) => signal.id),
    submitRoute: `${workspaceBoundary.routeScope}/acceptance`
  };
}

function buildReadinessContract({ provider, capabilityNegotiation, syncMetadata, validationSummary, acceptance, operationalHealth, healthValidation, lifecycleControl, providerServiceContract, recovery, operationalSnapshotRecovery, commandRecovery, commandOutcome, processActionPressure, cliRunStatusBridge, mailchimpCampaignHandoff, workspaceBoundary }) {
  const readinessScore = [
    workspaceBoundary.isolationState === "scoped",
    workspaceBoundary.permissionState === "ready",
    capabilityNegotiation.granted.includes("dashboard.read"),
    capabilityNegotiation.granted.includes("kernel.status.read"),
    syncMetadata.status === "ready",
    validationSummary.ok,
    acceptance.accepted,
    !operationalHealth || operationalHealth.state === "healthy",
    !lifecycleControl || lifecycleControl.commandAllowed,
    !providerServiceContract || providerServiceContract.state === "ready",
    !recovery || !recovery.replayRequired,
    !operationalSnapshotRecovery || operationalSnapshotRecovery.restartSafe,
    !commandRecovery || ["dispatch-new", "degraded-dispatch", "replay-existing"].includes(commandRecovery.dispatchMode),
    !commandOutcome || commandOutcome.state !== "blocked",
    !processActionPressure || processActionPressure.blockedCount === 0,
    !cliRunStatusBridge || ["not-reported", "ready"].includes(cliRunStatusBridge.state),
    !mailchimpCampaignHandoff?.present || mailchimpCampaignHandoff.accepted || mailchimpCampaignHandoff.state === "not-present"
  ].filter(Boolean).length;
  const maxScore = 17;
  const healthBlocked = operationalHealth?.state === "blocked";
  const healthValidationBlocked = healthValidation?.state === "blocked";
  const lifecycleBlocked = lifecycleControl?.state === "blocked" || lifecycleControl?.settingErrors?.length > 0;
  const serviceBlocked = providerServiceContract?.state === "blocked";
  const permissionBlocked = workspaceBoundary.permissionState === "blocked" || workspaceBoundary.missingRequiredPermissions?.length > 0;
  const commandRecoveryBlocked = commandRecovery?.dispatchMode === "repair-ledger" || commandRecovery?.dispatchMode === "blocked";
  const commandHealthBlocked = commandRecovery?.dispatchMode === "health-blocked";
  const commandRetryBackoffActive = commandRecovery?.dispatchMode === "wait-for-health-retry";
  const processActionBlocked = processActionPressure?.blockedCount > 0;
  const processActionReady = processActionPressure?.readyCount > 0;
  const cliRunBridgeBlocked = cliRunStatusBridge?.state === "scope-blocked" || cliRunStatusBridge?.state === "blocked";
  const cliRunBridgeRecoveryRequired = cliRunStatusBridge?.state === "recovery-required";
  const cliRunBridgeDegraded = cliRunStatusBridge?.state === "degraded";
  const mailchimpBlocked = mailchimpCampaignHandoff?.state === "scope-blocked" || mailchimpCampaignHandoff?.state === "blocked" || mailchimpCampaignHandoff?.state === "export-blocked";
  const mailchimpDegraded = mailchimpCampaignHandoff?.state === "degraded" || mailchimpCampaignHandoff?.state === "rate-limited";
  const operationalSnapshotRefreshRequired = operationalSnapshotRecovery?.state === "refresh-required";
  const operationalSnapshotScopeBlocked = operationalSnapshotRecovery?.quarantinedScopeViolationCount > 0;
  const blocked = workspaceBoundary.isolationState === "blocked" || permissionBlocked || commandOutcome?.state === "blocked" || commandRecoveryBlocked || commandHealthBlocked || healthBlocked || healthValidationBlocked || lifecycleBlocked || serviceBlocked || operationalSnapshotScopeBlocked || processActionBlocked || cliRunBridgeBlocked || mailchimpBlocked || readinessScore < 3;
  const degraded = operationalHealth?.degradedModeActive || healthValidation?.state === "degraded" || lifecycleControl?.state === "paused" || providerServiceContract?.state === "degraded" || recovery?.replayRequired || operationalSnapshotRefreshRequired || operationalSnapshotRecovery?.state === "drift-detected" || commandRecovery?.dispatchMode === "defer-until-replay" || commandRetryBackoffActive || commandRecovery?.degradedDispatch || processActionReady || cliRunBridgeRecoveryRequired || cliRunBridgeDegraded || mailchimpDegraded || readinessScore < maxScore;

  return {
    contractVersion: "dashboard-readiness.v1",
    state: blocked ? "blocked" : degraded ? "degraded" : "ready",
    score: readinessScore,
    maxScore,
    providerMode: provider.mode,
    operationalHealthState: operationalHealth?.state || "unknown",
    healthValidationState: healthValidation?.state || "unknown",
    healthValidationProofId: healthValidation?.proofId || null,
    healthObservationAgeMs: healthValidation?.ageMs ?? null,
    lifecycleState: lifecycleControl?.state || "unknown",
    providerServiceState: providerServiceContract?.state || "unknown",
    commandRecoveryMode: commandRecovery?.dispatchMode || "unknown",
    commandRestartSafeStatus: commandRecovery?.restartSafeStatus || "unknown",
    commandRecoveryProofId: commandRecovery?.proofId || null,
    commandHealthGateState: commandRecovery?.healthGate?.state || "unknown",
    commandHealthGateBackoffActive: commandRecovery?.healthGate?.backoffActive === true,
    commandHealthGateNextAttemptAt: commandRecovery?.healthGate?.nextAttemptAt || null,
    operationalSnapshotRecoveryState: operationalSnapshotRecovery?.state || "unknown",
    operationalSnapshotRestartSafe: operationalSnapshotRecovery?.restartSafe ?? null,
    operationalSnapshotRecoveryProofId: operationalSnapshotRecovery?.proofId || null,
    operationalSnapshotScopeState: operationalSnapshotRecovery?.persistedScopeState || "unknown",
    operationalSnapshotQuarantinedScopeViolationCount: operationalSnapshotRecovery?.quarantinedScopeViolationCount || 0,
    processActionState: processActionPressure?.state || "unknown",
    processActionReadyCount: processActionPressure?.readyCount || 0,
    processActionBlockedCount: processActionPressure?.blockedCount || 0,
    processActionPrimaryAction: processActionPressure?.primaryAction?.action || null,
    processActionProofId: processActionPressure?.proofId || null,
    cliRunStatusBridgeState: cliRunStatusBridge?.state || "not-reported",
    cliRunStatusBridgeProofId: cliRunStatusBridge?.proofId || null,
    cliRunCommandId: cliRunStatusBridge?.commandId || null,
    cliRunRestartSafeStatus: cliRunStatusBridge?.restartSafeStatus || "unknown",
    cliRunRecoveryRequired: cliRunStatusBridge?.recoveryRequired === true,
    cliRunSafeResume: cliRunStatusBridge?.safeResume === true,
    cliRunSafeRetry: cliRunStatusBridge?.safeRetry === true,
    cliRunSafeHandoff: cliRunStatusBridge?.safeHandoff === true,
    mailchimpCampaignState: mailchimpCampaignHandoff?.state || "not-reported",
    mailchimpCampaignAccepted: mailchimpCampaignHandoff?.accepted === true,
    mailchimpExportReadinessState: mailchimpCampaignHandoff?.exportReadiness?.state || "not-reported",
    mailchimpAttachableRecords: mailchimpCampaignHandoff?.exportReadiness?.counters?.attachableRecords || 0,
    mailchimpRetryable: mailchimpCampaignHandoff?.retry?.retryable === true,
    permissionState: workspaceBoundary.permissionState,
    missingRequiredPermissions: workspaceBoundary.missingRequiredPermissions,
    unsupportedPermissions: workspaceBoundary.unsupportedPermissions,
    lifecycleNextScheduledAt: lifecycleControl?.schedule?.nextScheduledAt || null,
    retryToken: operationalHealth?.retry?.retryToken || null,
    tenantId: workspaceBoundary.tenantId,
    workspaceId: workspaceBoundary.workspaceId,
    lastCheckedAt: syncMetadata.generatedAt,
    route: `${workspaceBoundary.routeScope}/readiness`
  };
}

function buildNextStepContract({ handoff, validationSummary, acceptance, readiness, operationalHealth, healthValidation, lifecycleControl, lifecycleActionPlan, processActionPressure, cliRunStatusBridge, cliRunExportHandoff, mailchimpCampaignHandoff, workflowHandoff, handoffEnvelope, workspaceBoundary }) {
  const nextSteps = [];
  if (mailchimpCampaignHandoff?.accepted && mailchimpCampaignHandoff.deliveryReadiness.canAttachLogProof) {
    nextSteps.push({
      id: "attach-mailchimp-log-proof",
      label: "Attach Mailchimp log proof",
      reason: `${mailchimpCampaignHandoff.exportReadiness.counters.attachableRecords} campaign log proof row(s) are ready.`,
      route: mailchimpCampaignHandoff.action.route,
      proofRef: mailchimpCampaignHandoff.exportReadiness.package.proofDigest || mailchimpCampaignHandoff.proofId
    });
  }
  if (mailchimpCampaignHandoff?.state === "degraded" || mailchimpCampaignHandoff?.state === "rate-limited") {
    nextSteps.push({
      id: "retry-mailchimp-campaign-sync",
      label: "Retry Mailchimp campaign sync",
      reason: mailchimpCampaignHandoff.deliveryReadiness.reason,
      route: mailchimpCampaignHandoff.action.route,
      proofRef: mailchimpCampaignHandoff.proofId
    });
  }
  if (mailchimpCampaignHandoff?.state === "blocked" || mailchimpCampaignHandoff?.state === "export-blocked" || mailchimpCampaignHandoff?.state === "scope-blocked") {
    nextSteps.push({
      id: "repair-mailchimp-campaign-export",
      label: "Repair Mailchimp campaign export",
      reason: mailchimpCampaignHandoff.deliveryReadiness.reason,
      route: mailchimpCampaignHandoff.action.route,
      proofRef: mailchimpCampaignHandoff.proofId
    });
  }
  if (cliRunExportHandoff?.accepted && lifecycleControl?.commandAllowed) {
    nextSteps.push({
      id: "ingest-cli-run-export",
      label: "Ingest cli-run analytics export",
      reason: cliRunExportHandoff.reason,
      route: cliRunExportHandoff.action.route,
      proofRef: cliRunExportHandoff.proofId
    });
  }
  if (cliRunExportHandoff?.state === "stale") {
    nextSteps.push({
      id: "refresh-cli-run-export",
      label: "Refresh cli-run analytics export",
      reason: cliRunExportHandoff.reason,
      route: cliRunExportHandoff.action.route,
      proofRef: cliRunExportHandoff.proofId
    });
  }
  if (cliRunExportHandoff?.state === "invalid" || cliRunExportHandoff?.state === "scope-blocked") {
    nextSteps.push({
      id: "repair-cli-run-export",
      label: "Repair cli-run analytics export",
      reason: cliRunExportHandoff.reason,
      route: cliRunExportHandoff.action.route,
      proofRef: cliRunExportHandoff.proofId
    });
  }
  if (cliRunStatusBridge?.state === "scope-blocked") {
    nextSteps.push({
      id: "repair-cli-run-status-scope",
      label: "Repair cli-run status scope",
      reason: cliRunStatusBridge.primaryAction.reason,
      route: cliRunStatusBridge.route,
      proofRef: cliRunStatusBridge.proofId
    });
  }
  if (cliRunStatusBridge?.state === "blocked") {
    nextSteps.push({
      id: "repair-cli-run-status",
      label: "Repair cli-run status",
      reason: cliRunStatusBridge.primaryAction.reason,
      route: cliRunStatusBridge.primaryAction.route,
      proofRef: cliRunStatusBridge.proofId
    });
  }
  if (cliRunStatusBridge?.state === "recovery-required") {
    nextSteps.push({
      id: "recover-cli-run-command",
      label: "Recover cli-run command",
      reason: cliRunStatusBridge.primaryAction.reason,
      route: cliRunStatusBridge.primaryAction.route,
      proofRef: cliRunStatusBridge.proofId
    });
  }
  if (processActionPressure?.primaryAction && processActionPressure.blockedCount > 0) {
    nextSteps.push({
      id: `process-action-${processActionPressure.primaryAction.action}`,
      label: "Resolve blocking process action",
      reason: processActionPressure.primaryAction.message,
      route: processActionPressure.primaryAction.route,
      proofRef: processActionPressure.proofId
    });
  }
  if (processActionPressure?.primaryAction && processActionPressure.readyCount > 0 && processActionPressure.blockedCount === 0) {
    nextSteps.push({
      id: `process-action-${processActionPressure.primaryAction.action}`,
      label: "Review ready process action",
      reason: processActionPressure.primaryAction.message,
      route: processActionPressure.primaryAction.route,
      proofRef: processActionPressure.proofId
    });
  }
  if (handoffEnvelope?.state === "dispatch-ready") {
    nextSteps.push({
      id: "dispatch-hosted-kernel-handoff",
      label: "Dispatch hosted-kernel handoff",
      reason: handoffEnvelope.userVisible.detail,
      route: handoffEnvelope.destinationRoute,
      proofRef: handoffEnvelope.proofId
    });
  }
  if (handoffEnvelope?.state === "blocked") {
    nextSteps.push({
      id: "repair-hosted-kernel-handoff",
      label: "Repair hosted-kernel handoff",
      reason: handoffEnvelope.blockedReasons[0] || "Hosted-kernel handoff cannot be dispatched.",
      route: handoffEnvelope.payload.route,
      proofRef: handoffEnvelope.proofId
    });
  }
  if (lifecycleControl?.settingErrors?.length > 0) {
    nextSteps.push({
      id: "repair-lifecycle-settings",
      label: "Repair lifecycle settings",
      reason: lifecycleControl.settingErrors[0],
      route: lifecycleControl.route
    });
  }
  if (lifecycleControl?.state === "blocked" && lifecycleControl.nextActionId === "enable-lifecycle") {
    nextSteps.push({
      id: "enable-lifecycle",
      label: "Enable lifecycle commands",
      reason: lifecycleControl.blockedReason || "Lifecycle commands are disabled for this workspace.",
      route: lifecycleControl.route
    });
  }
  if (lifecycleControl?.state === "paused") {
    nextSteps.push({
      id: "resume-lifecycle",
      label: "Resume lifecycle schedule",
      reason: `Lifecycle commands are paused until ${lifecycleControl.schedule.nextScheduledAt || "the configured resume time"}.`,
      route: lifecycleControl.route
    });
  }
  if (lifecycleActionPlan?.primaryAction && !nextSteps.some((step) => step.id === lifecycleActionPlan.primaryAction.id)) {
    nextSteps.push({
      id: lifecycleActionPlan.primaryAction.id,
      label: lifecycleActionPlan.primaryAction.label,
      reason: lifecycleActionPlan.primaryAction.reason,
      route: lifecycleActionPlan.primaryAction.route,
      proofRef: lifecycleActionPlan.audit.proofId
    });
  }
  if (operationalHealth?.retry?.retryable) {
    nextSteps.push({
      id: "retry-hosted-kernel-health",
      label: "Retry hosted-kernel health check",
      reason: `Retry after ${operationalHealth.retry.backoffMs}ms using the issued retry token.`,
      route: operationalHealth.route,
      retryToken: operationalHealth.retry.retryToken
    });
  }
  if (healthValidation?.operatorActions?.length > 0) {
    for (const action of healthValidation.operatorActions) {
      nextSteps.push({
        id: action.id,
        label: action.label,
        reason: action.reason,
        route: action.route,
        retryToken: action.retryToken,
        proofRef: healthValidation.proofId
      });
    }
  }
  if (operationalHealth?.actionableErrors?.some((error) => !error.retryable && error.severity === "error")) {
    const failure = operationalHealth.actionableErrors.find((error) => !error.retryable && error.severity === "error");
    nextSteps.push({
      id: "escalate-hosted-kernel-health",
      label: "Escalate hosted-kernel health failure",
      reason: failure.message,
      route: failure.route
    });
  }
  if (workflowHandoff && workflowHandoff.state === "resume-ready") {
    nextSteps.push({
      id: "continue-client-workflow",
      label: "Continue requested workflow handoff",
      reason: "The client request has a prepared hosted-kernel resume token.",
      route: workflowHandoff.deliveryRoute
    });
  }
  if (!acceptance.accepted) {
    nextSteps.push({
      id: "resolve-validation",
      label: "Resolve dashboard validation findings",
      reason: validationSummary.findings.find((finding) => finding.severity === "error")?.message || "Acceptance checks are incomplete.",
      route: `${workspaceBoundary.routeScope}/validation`
    });
  }
  if (handoff.requested && handoff.state === "prepared") {
    nextSteps.push({
      id: "resume-handoff",
      label: "Resume prepared operator handoff",
      reason: "A hosted-kernel handoff resume token is available.",
      route: `${workspaceBoundary.routeScope}/handoff/${handoff.target}`
    });
  }
  if (readiness.state !== "ready") {
    nextSteps.push({
      id: "refresh-readiness",
      label: "Refresh readiness after capability or sync changes",
      reason: `Current readiness state is ${readiness.state}.`,
      route: readiness.route
    });
  }

  return {
    contractVersion: "dashboard-next-steps.v1",
    explainable: true,
    primaryAction: nextSteps[0]?.id || "open-dashboard",
    steps: nextSteps.length > 0 ? nextSteps : [{
      id: "open-dashboard",
      label: "Open hosted-kernel dashboard",
      reason: "Preview, validation, readiness, and acceptance contracts are passing.",
      route: `${workspaceBoundary.routeScope}/preview`
    }]
  };
}

function buildClientRouteContract({ clientRuntime, clientWorkflow, workspaceBoundary, preview, acceptance, readiness, validationSummary, healthValidation, lifecycleActionPlan, nextSteps, workflowHandoff, handoffEnvelope, workflowLaunch, providerServiceContract, cliRunStatusBridge, audit, stateCheckpoint }) {
  const severityRank = { error: 3, warning: 2, info: 1 };
  const sortedFindings = [...validationSummary.findings].sort((left, right) => (
    (severityRank[right.severity] || 0) - (severityRank[left.severity] || 0)
  ));
  const findingCounts = validationSummary.findings.reduce((counts, finding) => {
    counts[finding.severity] = (counts[finding.severity] || 0) + 1;
    return counts;
  }, { error: 0, warning: 0, info: 0 });
  const statusTone = (status) => {
    if (status === "ready" || status === "pass" || status === "accepted") {
      return "success";
    }
    if (status === "degraded" || status === "paused" || status === "pending") {
      return "warning";
    }
    if (status === "blocked" || status === "unavailable" || status === "needs-attention") {
      return "danger";
    }
    return "neutral";
  };
  const panelLabels = {
    "kernel-status": "Kernel status",
    "sync-state": "Sync state",
    handoff: "Handoff"
  };
  const readinessItems = [
    {
      id: "workspace-boundary",
      label: "Workspace boundary",
      state: workspaceBoundary.isolationState === "scoped" ? "pass" : "blocked",
      route: `${workspaceBoundary.routeScope}/boundary`
    },
    {
      id: "permission-boundary",
      label: "Permission boundary",
      state: workspaceBoundary.permissionState === "ready" ? "pass" : workspaceBoundary.permissionState,
      route: `${workspaceBoundary.routeScope}/boundary/permissions`
    },
    {
      id: "preview-available",
      label: "Preview available",
      state: preview.visible && preview.readyPanelCount > 0 ? "pass" : "blocked",
      route: `${workspaceBoundary.routeScope}/preview`
    },
    {
      id: "acceptance-gate",
      label: "Acceptance gate",
      state: acceptance.accepted ? "pass" : "pending",
      route: acceptance.submitRoute
    },
    {
      id: "workflow-handoff",
      label: "Workflow handoff",
      state: workflowHandoff.state === "blocked" ? "blocked" : workflowHandoff.resumeToken ? "pass" : "pending",
      route: workflowHandoff.deliveryRoute
    }
  ];
  const nextActionQueue = nextSteps.steps.map((step, index) => ({
    index,
    id: step.id,
    label: step.label,
    reason: step.reason,
    route: step.route,
    primary: step.id === nextSteps.primaryAction,
    proofRef: step.proofRef || null,
    retryToken: step.retryToken || null,
    clientCommand: step.id === "open-dashboard"
      ? "refresh-status"
      : step.id.includes("handoff")
        ? "prepare-handoff"
        : step.id.includes("acceptance") || step.id === "resolve-validation"
          ? "acknowledge-acceptance"
          : "refresh-status"
  }));
  const acceptanceState = acceptance.accepted
    ? "accepted"
    : findingCounts.error > 0 || acceptance.blockedBy.length > 0
      ? "blocked"
      : "pending";
  const contractProof = proofToken({
    requestId: clientRuntime.requestId,
    workspace: workspaceBoundary.workspaceId,
    permissionState: workspaceBoundary.permissionState,
    permissionProof: workspaceBoundary.permissionProof,
    preview: preview.panels.map((panel) => [panel.id, panel.status]),
    acceptanceState,
    readinessState: readiness.state,
    primaryAction: nextSteps.primaryAction,
    workflowState: clientWorkflow.state,
    workflowProofId: clientWorkflow.proofId,
    workflowLaunchProofId: workflowLaunch?.proofId || null,
    cliRunStatusBridgeProofId: cliRunStatusBridge?.proofId || null,
    auditProofId: audit.proofId,
    writeId: stateCheckpoint.writeId
  });

  return {
    contractVersion: "dashboard-client-route-contract.v1",
    requestId: clientRuntime.requestId,
    sessionId: clientRuntime.sessionId,
    intent: clientRuntime.intent,
    routeScope: workspaceBoundary.routeScope,
    proofId: contractProof,
    proofRefs: {
      auditProofId: audit.proofId,
      boundaryProof: workspaceBoundary.boundaryProof,
      permissionProof: workspaceBoundary.permissionProof,
      clientWorkflowProofId: clientWorkflow.proofId,
      workflowLaunchProofId: workflowLaunch?.proofId || null,
      checkpointWriteId: stateCheckpoint.writeId,
      providerServiceProofId: providerServiceContract?.proofId || null,
      handoffEnvelopeProofId: handoffEnvelope?.proofId || null,
      healthValidationProofId: healthValidation?.proofId || null,
      acceptanceToken: acceptance.acceptanceToken
    },
    cliRunStatusBridge: cliRunStatusBridge
      ? {
        state: cliRunStatusBridge.state,
        commandId: cliRunStatusBridge.commandId,
        requestId: cliRunStatusBridge.requestId,
        idempotencyKey: cliRunStatusBridge.idempotencyKey,
        restartSafeStatus: cliRunStatusBridge.restartSafeStatus,
        recoveryRequired: cliRunStatusBridge.recoveryRequired,
        safeResume: cliRunStatusBridge.safeResume,
        safeRetry: cliRunStatusBridge.safeRetry,
        safeHandoff: cliRunStatusBridge.safeHandoff,
        primaryAction: cliRunStatusBridge.primaryAction,
        recoveryRoutes: cliRunStatusBridge.recoveryRoutes,
        clientStatePatch: cliRunStatusBridge.clientStatePatch,
        proofId: cliRunStatusBridge.proofId
      }
      : null,
    providerServices: providerServiceContract
      ? providerServiceContract.services.map((service) => ({
        id: service.id,
        state: service.state,
        route: service.route,
        dispatchable: service.dispatchable,
        blockedReason: service.blockedReason,
        providerEndpoint: service.providerEndpoint,
        apiVersion: service.declaration.apiVersion,
        minApiVersion: service.requirement.minApiVersion,
        contractBlockers: service.contractBlockers,
        negotiation: service.negotiation,
        externalHandoffState: service.externalHandoff?.state || null,
        handoffClaimProof: service.externalHandoff?.tenantScopedClaim?.claimProof || null
      }))
      : [],
    boundaryGuard: {
      contractVersion: "dashboard-client-boundary-guard.v1",
      tenantId: workspaceBoundary.tenantId,
      workspaceId: workspaceBoundary.workspaceId,
      isolationState: workspaceBoundary.isolationState,
      permissionState: workspaceBoundary.permissionState,
      safeToPersist: workspaceBoundary.safeToPersist,
      unsupportedPermissions: workspaceBoundary.unsupportedPermissions,
      missingRequiredPermissions: workspaceBoundary.missingRequiredPermissions,
      handoffMissingPermissions: workspaceBoundary.handoffMissingPermissions,
      boundaryProof: workspaceBoundary.boundaryProof,
      permissionProof: workspaceBoundary.permissionProof
    },
    workflowHandoff: {
      state: clientWorkflow.state,
      stage: clientWorkflow.stage,
      channel: clientWorkflow.channel,
      selectedPanelVisible: clientWorkflow.selectedPanelVisible,
      originRoute: clientWorkflow.originRoute,
      returnRoute: clientWorkflow.returnRoute,
      handoffRoute: clientWorkflow.handoffRoute,
      pendingActions: clientWorkflow.pendingActions,
      instruction: workflowHandoff.handoffInstruction
    },
    hostedKernelHandoff: handoffEnvelope
      ? {
        state: handoffEnvelope.state,
        dispatchable: handoffEnvelope.dispatchable,
        destinationRoute: handoffEnvelope.destinationRoute,
        continuityKey: handoffEnvelope.continuityKey,
        proofId: handoffEnvelope.proofId,
        primaryActionId: handoffEnvelope.userVisible.primaryActionId,
        primaryRoute: handoffEnvelope.userVisible.primaryRoute,
        blockedReasons: handoffEnvelope.blockedReasons,
        payload: handoffEnvelope.payload
      }
      : null,
    workflowLaunch: workflowLaunch
      ? {
        state: workflowLaunch.state,
        requested: workflowLaunch.requested,
        dispatchable: workflowLaunch.dispatchable,
        launchRoute: workflowLaunch.launchRoute,
        delivery: workflowLaunch.delivery,
        blockerCount: workflowLaunch.blockerCount,
        blockers: workflowLaunch.blockers,
        resumeContext: workflowLaunch.resumeContext,
        commandPayload: workflowLaunch.commandPayload,
        userVisible: workflowLaunch.userVisible,
        proofId: workflowLaunch.proofId
      }
      : null,
    previewCards: preview.panels.map((panel) => ({
      id: panel.id,
      label: panelLabels[panel.id] || panel.id,
      status: panel.status,
      tone: statusTone(panel.status),
      route: panel.route,
      refreshCursor: panel.refreshCursor,
      disabledReason: panel.status === "unavailable"
        ? "Panel is outside the granted capability or workspace boundary."
        : panel.status === "blocked"
          ? "Panel is blocked by hosted-kernel health or handoff state."
          : null
    })),
    acceptanceGate: {
      state: acceptanceState,
      accepted: acceptance.accepted,
      acknowledgeEnabled: acceptance.accepted && clientRuntime.acknowledgementRequired,
      token: acceptance.acceptanceToken,
      blockedBy: acceptance.blockedBy,
      route: acceptance.submitRoute
    },
    readinessChecklist: readinessItems.map((item) => ({
      ...item,
      tone: statusTone(item.state)
    })),
    validationDigest: {
      status: validationSummary.ok ? "pass" : "needs-attention",
      tone: statusTone(validationSummary.ok ? "pass" : "needs-attention"),
      findingCounts,
      topFinding: sortedFindings[0] || null,
      route: `${workspaceBoundary.routeScope}/validation`
    },
    healthValidationBanner: healthValidation
      ? {
        state: healthValidation.state,
        tone: statusTone(healthValidation.state === "valid" ? "pass" : healthValidation.state),
        route: healthValidation.route,
        proofId: healthValidation.proofId,
        observedAt: healthValidation.observedAt,
        ageMs: healthValidation.ageMs,
        findingCount: healthValidation.findingCount,
        primaryFinding: healthValidation.findings[0] || null,
        primaryAction: healthValidation.operatorActions[0] || null
      }
      : null,
    lifecyclePanel: lifecycleActionPlan
      ? {
        state: lifecycleActionPlan.state,
        lifecycleState: lifecycleActionPlan.lifecycleState,
        requestedAction: lifecycleActionPlan.requestedAction,
        requestedActionValid: lifecycleActionPlan.requestedActionValid,
        commandAllowed: lifecycleActionPlan.commandAllowed,
        tone: statusTone(lifecycleActionPlan.state === "command-dispatch-ready" ? "ready" : lifecycleActionPlan.state === "repair-required" ? "blocked" : lifecycleActionPlan.lifecycleState),
        primaryAction: lifecycleActionPlan.primaryAction,
        controls: lifecycleActionPlan.controls.map((control) => ({
          id: control.id,
          action: control.action,
          label: control.label,
          requested: control.requested,
          enabled: control.enabled,
          route: control.route,
          disabledReason: control.disabledReason,
          commandPayload: control.commandPayload
        })),
        scheduleControls: lifecycleActionPlan.scheduleControls,
        auditProofId: lifecycleActionPlan.audit.proofId,
        auditRoute: lifecycleActionPlan.audit.route
      }
      : null,
    nextActionQueue,
    primaryAction: nextActionQueue.find((step) => step.primary) || nextActionQueue[0] || null
  };
}

function buildOperatorEventStreamContract({
  clientRuntime,
  clientWorkflow,
  workspaceBoundary,
  syncMetadata,
  operationalHealth,
  healthValidation,
  lifecycleControl,
  validationSummary,
  commandOutcome,
  stateCheckpoint,
  workflowHandoff,
  handoffEnvelope,
  acceptance,
  readiness,
  audit,
  nextSteps
}) {
  const eventBase = {
    requestId: clientRuntime.requestId,
    workspaceId: workspaceBoundary.workspaceId,
    tenantId: workspaceBoundary.tenantId,
    cursor: syncMetadata.nextCursor
  };
  const severityRank = { error: 3, warning: 2, info: 1 };
  const topValidationFinding = [...validationSummary.findings].sort((left, right) => (
    (severityRank[right.severity] || 0) - (severityRank[left.severity] || 0)
  ))[0] || null;
  const primaryHealthError = operationalHealth.actionableErrors.find((error) => error.severity === "error")
    || operationalHealth.actionableErrors[0]
    || null;
  const eventInputs = [
    {
      type: "status",
      state: operationalHealth.state,
      severity: operationalHealth.state === "blocked" ? "error" : operationalHealth.state === "degraded" ? "warning" : "info",
      title: "Hosted-kernel status evaluated",
      detail: primaryHealthError?.message || `Hosted-kernel dashboard state is ${operationalHealth.state}.`,
      route: operationalHealth.route,
      proofRef: operationalHealth.proofId,
      actionId: operationalHealth.retry.retryable ? "retry-hosted-kernel-health" : null
    },
    {
      type: "validation",
      state: validationSummary.ok ? "pass" : "needs-attention",
      severity: topValidationFinding?.severity || "info",
      title: "Dashboard validation completed",
      detail: topValidationFinding?.message || "Dashboard validation has no blocking findings.",
      route: `${workspaceBoundary.routeScope}/validation`,
      proofRef: audit.proofId,
      actionId: validationSummary.ok ? null : "resolve-validation"
    },
    {
      type: "command",
      state: commandOutcome.state,
      severity: commandOutcome.state === "blocked" ? "error" : commandOutcome.duplicate ? "warning" : "info",
      title: `Command ${commandOutcome.commandId} ${commandOutcome.state}`,
      detail: commandOutcome.blockedReason || `Command result write id is ${commandOutcome.resultingWriteId}.`,
      route: `${workspaceBoundary.routeScope}/commands/${commandOutcome.commandId}`,
      proofRef: commandOutcome.resultingWriteId,
      actionId: commandOutcome.state === "blocked" ? nextSteps.primaryAction : null
    },
    {
      type: "checkpoint",
      state: stateCheckpoint.durable ? "durable" : "volatile",
      severity: stateCheckpoint.durable ? "info" : "warning",
      title: "Dashboard checkpoint prepared",
      detail: stateCheckpoint.durable
        ? "Checkpoint is scoped and durable for restart recovery."
        : "Checkpoint is not durable because the command or workspace boundary blocked persistence.",
      route: stateCheckpoint.writeRoute,
      proofRef: stateCheckpoint.writeId,
      actionId: stateCheckpoint.durable ? null : "refresh-readiness"
    },
    {
      type: "workflow",
      state: handoffEnvelope?.state || workflowHandoff.state,
      severity: handoffEnvelope?.state === "blocked" || workflowHandoff.state === "blocked" || clientWorkflow.state === "blocked"
        ? "error"
        : handoffEnvelope?.state === "dispatch-ready" || workflowHandoff.state === "resume-ready" || clientWorkflow.state === "resume-pending"
          ? "info"
          : "warning",
      title: "Client workflow route resolved",
      detail: handoffEnvelope?.userVisible?.detail || (workflowHandoff.resumeToken
        ? `Workflow has a hosted-kernel resume token for ${clientWorkflow.channel}.`
        : clientWorkflow.pendingActionCount > 0
          ? clientWorkflow.pendingActions[0].reason
          : `Workflow state is ${workflowHandoff.state}.`),
      route: handoffEnvelope?.destinationRoute || workflowHandoff.deliveryRoute,
      proofRef: handoffEnvelope?.proofId || workflowHandoff.resumeToken || clientWorkflow.proofId,
      actionId: handoffEnvelope?.dispatchable
        ? "dispatch-hosted-kernel-handoff"
        : workflowHandoff.resumeToken || clientWorkflow.pendingActionCount > 0
          ? "continue-client-workflow"
          : nextSteps.primaryAction
    },
    {
      type: "acceptance",
      state: acceptance.accepted ? "accepted" : "pending",
      severity: acceptance.accepted ? "info" : readiness.state === "blocked" ? "error" : "warning",
      title: "Dashboard acceptance gate evaluated",
      detail: acceptance.accepted
        ? "Acceptance token is ready for acknowledgement."
        : `Acceptance is blocked by ${acceptance.blockedBy.join(", ") || "pending readiness"}.`,
      route: acceptance.submitRoute,
      proofRef: acceptance.acceptanceToken || audit.proofId,
      actionId: acceptance.accepted ? "acknowledge-acceptance" : nextSteps.primaryAction
    }
  ];
  const events = eventInputs
    .filter((event) => OPERATOR_EVENT_TYPES.includes(event.type))
    .map((event, index) => ({
      contractVersion: "dashboard-operator-event.v1",
      sequence: index + 1,
      id: proofToken({ ...eventBase, index, type: event.type, state: event.state, proofRef: event.proofRef }),
      emittedAt: syncMetadata.generatedAt,
      ...event,
      requestId: clientRuntime.requestId,
      cursor: syncMetadata.nextCursor,
      requiresAcknowledgement: event.severity === "error" || event.type === "acceptance",
      dispatchable: Boolean(event.actionId) && workspaceBoundary.isolationState === "scoped"
    }));
  const blockingEvents = events.filter((event) => event.severity === "error");

  return {
    contractVersion: "dashboard-operator-event-stream.v1",
    providerStream: "hosted-kernel-dashboard-events",
    cursor: syncMetadata.nextCursor,
    appendOnly: true,
    eventCount: events.length,
    blockingEventCount: blockingEvents.length,
    primaryEventId: blockingEvents[0]?.id || events[0]?.id || null,
    subscriptionRoute: `${workspaceBoundary.routeScope}/events?cursor=${encodeURIComponent(syncMetadata.nextCursor)}`,
    proofId: proofToken({
      ...eventBase,
      auditProofId: audit.proofId,
      eventIds: events.map((event) => event.id),
      blockingEventCount: blockingEvents.length
    }),
    events
  };
}

function buildAnalyticsReportingContract({
  input,
  clientRuntime,
  workspaceBoundary,
  syncMetadata,
  operationalHealth,
  healthValidation,
  lifecycleControl,
  validationSummary,
  commandOutcome,
  stateCheckpoint,
  workflowHandoff,
  handoffEnvelope,
  preview,
  acceptance,
  readiness,
  operatorEventStream,
  audit,
  now
}) {
  const analytics = input && typeof input.analytics === "object" && input.analytics !== null ? input.analytics : {};
  const sourceSurfaces = input && typeof input.surfaces === "object" && input.surfaces !== null ? input.surfaces : {};
  const cliRunSource = input.cliRun && typeof input.cliRun === "object" && input.cliRun !== null
    ? input.cliRun
    : sourceSurfaces.cliRun && typeof sourceSurfaces.cliRun === "object" && sourceSurfaces.cliRun !== null
      ? sourceSurfaces.cliRun
      : {};
  const cliLogsSource = input.cliLogs && typeof input.cliLogs === "object" && input.cliLogs !== null
    ? input.cliLogs
    : sourceSurfaces.cliLogs && typeof sourceSurfaces.cliLogs === "object" && sourceSurfaces.cliLogs !== null
      ? sourceSurfaces.cliLogs
      : {};
  const cliRunRecoveryHealth = cliRunSource.recoveryHealthHandoff && typeof cliRunSource.recoveryHealthHandoff === "object"
    ? cliRunSource.recoveryHealthHandoff
    : input.recoveryHealthHandoff && typeof input.recoveryHealthHandoff === "object"
      ? input.recoveryHealthHandoff
      : {};
  const cliLogsRestartSafe = cliLogsSource.restartSafeStatus && typeof cliLogsSource.restartSafeStatus === "object"
    ? cliLogsSource.restartSafeStatus
    : input.restartSafeStatus && typeof input.restartSafeStatus === "object"
      ? input.restartSafeStatus
      : {};
  const cliRunRecoveryCounters = cliRunRecoveryHealth.counters && typeof cliRunRecoveryHealth.counters === "object"
    ? cliRunRecoveryHealth.counters
    : {};
  const cliLogsExportableSummary = cliLogsRestartSafe.exportableSummary && typeof cliLogsRestartSafe.exportableSummary === "object"
    ? cliLogsRestartSafe.exportableSummary
    : {};
  const cliRunExportableSummary = cliRunRecoveryHealth.exportableSummary && typeof cliRunRecoveryHealth.exportableSummary === "object"
    ? cliRunRecoveryHealth.exportableSummary
    : {};
  const rawHistory = Array.isArray(analytics.history)
    ? analytics.history
    : Array.isArray(input.history)
      ? input.history
      : [];
  const requestedFormats = normalizeStringList(analytics.exportFormats).filter((format) => ANALYTICS_EXPORT_FORMATS.includes(format));
  const exportFormats = requestedFormats.length > 0 ? requestedFormats : ANALYTICS_EXPORT_FORMATS;
  const currentSnapshot = {
    id: proofToken({ requestId: clientRuntime.requestId, cursor: syncMetadata.nextCursor, writeId: stateCheckpoint.writeId }).replace("proof_", "snapshot_"),
    capturedAt: now,
    cursor: syncMetadata.nextCursor,
    requestId: clientRuntime.requestId,
    readinessState: readiness.state,
    operationalHealthState: operationalHealth.state,
    healthValidationState: healthValidation?.state || "unknown",
    healthObservationAgeMs: healthValidation?.ageMs ?? null,
    healthValidationFindings: healthValidation?.findingCount || 0,
    lifecycleState: lifecycleControl.state,
    commandState: commandOutcome.state,
    workflowState: workflowHandoff.state,
    handoffEnvelopeState: handoffEnvelope?.state || "unknown",
    handoffDispatchable: handoffEnvelope?.dispatchable === true,
    handoffEnvelopeProofId: handoffEnvelope?.proofId || null,
    handoffClaimProof: handoffEnvelope?.payload?.tenantScopedClaim?.claimProof || null,
    permissionState: workspaceBoundary.permissionState,
    unsupportedPermissionCount: workspaceBoundary.unsupportedPermissions.length,
    missingRequiredPermissionCount: workspaceBoundary.missingRequiredPermissions.length,
    acceptanceState: acceptance.accepted ? "accepted" : "pending",
    validationErrors: validationSummary.findings.filter((finding) => finding.severity === "error").length,
    validationWarnings: validationSummary.findings.filter((finding) => finding.severity === "warning").length,
    eventCount: operatorEventStream.eventCount,
    blockingEventCount: operatorEventStream.blockingEventCount,
    readyPanelCount: preview.readyPanelCount,
    degradedPanelCount: preview.degradedPanelCount,
    durableCheckpoint: stateCheckpoint.durable,
    cliRunRecoveryState: normalizeString(cliRunRecoveryHealth.state || cliRunExportableSummary.state, "unknown"),
    cliRunRestartSafeStatus: normalizeString(cliRunRecoveryHealth.restartSafeStatus || cliRunExportableSummary.restartSafeStatus, "unknown"),
    cliRunLifecycleReadiness: normalizeString(cliRunRecoveryHealth.lifecycleReadiness || cliRunExportableSummary.lifecycleReadiness, "unknown"),
    cliRunStaleCommands: Math.trunc(normalizeNumber(cliRunRecoveryCounters.staleCommands ?? cliRunExportableSummary.staleCommands, 0, { min: 0, max: 10000 })),
    cliRunExpiredLeases: Math.trunc(normalizeNumber(cliRunRecoveryCounters.expiredLeases ?? cliRunExportableSummary.expiredLeases, 0, { min: 0, max: 10000 })),
    cliRunRetryableCommands: Math.trunc(normalizeNumber(cliRunRecoveryCounters.retryRows ?? cliRunExportableSummary.retryableCommands, 0, { min: 0, max: 10000 })),
    cliRunActionableErrors: Math.trunc(normalizeNumber(cliRunRecoveryCounters.actionableErrors ?? cliRunExportableSummary.actionableErrors, 0, { min: 0, max: 10000 })),
    cliRunNextAttemptAt: normalizeString(cliRunRecoveryHealth.retryWindow?.nextAttemptAt || cliRunExportableSummary.nextAttemptAt, null),
    cliLogsRestartSafeStatus: normalizeString(cliLogsRestartSafe.status || cliLogsExportableSummary.status, "unknown"),
    cliLogsCanPersistStatus: cliLogsRestartSafe.canPersistStatus === true,
    cliLogsReplayableCommands: Math.trunc(normalizeNumber(cliLogsRestartSafe.replayableCommandCount ?? cliLogsExportableSummary.replayableCommandCount, 0, { min: 0, max: 10000 })),
    cliLogsOperatorAckRequired: Math.trunc(normalizeNumber(cliLogsRestartSafe.operatorAckRequiredCount ?? cliLogsExportableSummary.operatorAckRequiredCount, 0, { min: 0, max: 10000 })),
    cliLogsDuplicateIdempotencyKeys: Math.trunc(normalizeNumber(cliLogsRestartSafe.duplicateIdempotencyKeyCount ?? cliLogsExportableSummary.duplicateIdempotencyKeyCount, 0, { min: 0, max: 10000 })),
    cliLogsMissingEvents: Math.trunc(normalizeNumber(cliLogsExportableSummary.missingEvents, 0, { min: 0, max: 1000000 })),
    cliLogsRecoveryProofId: cliLogsRestartSafe.proof?.digest || cliLogsExportableSummary.proofId || null
  };
  const normalizedHistory = rawHistory
    .filter((snapshot) => snapshot && typeof snapshot === "object")
    .slice(-ANALYTICS_HISTORY_LIMIT)
    .map((snapshot, index) => {
      const capturedAt = normalizeString(snapshot.capturedAt || snapshot.generatedAt || snapshot.at, now);
      return {
        id: normalizeString(snapshot.id, proofToken({ workspace: workspaceBoundary.workspaceId, index, capturedAt }).replace("proof_", "snapshot_")),
        capturedAt,
        cursor: normalizeString(snapshot.cursor, DEFAULT_SYNC_CURSOR),
        requestId: typeof snapshot.requestId === "string" && snapshot.requestId.trim() ? snapshot.requestId.trim() : null,
        readinessState: normalizeString(snapshot.readinessState || snapshot.readiness, "unknown"),
        operationalHealthState: normalizeString(snapshot.operationalHealthState || snapshot.healthState, "unknown"),
        healthValidationState: normalizeString(snapshot.healthValidationState, "unknown"),
        healthObservationAgeMs: Math.trunc(normalizeNumber(snapshot.healthObservationAgeMs, 0, { min: 0, max: 86400000 })),
        healthValidationFindings: Math.trunc(normalizeNumber(snapshot.healthValidationFindings, 0, { min: 0, max: 10000 })),
        lifecycleState: normalizeString(snapshot.lifecycleState, "unknown"),
        commandState: normalizeString(snapshot.commandState, "unknown"),
        workflowState: normalizeString(snapshot.workflowState, "unknown"),
        handoffEnvelopeState: normalizeString(snapshot.handoffEnvelopeState, "unknown"),
        handoffDispatchable: snapshot.handoffDispatchable === true,
        handoffEnvelopeProofId: typeof snapshot.handoffEnvelopeProofId === "string" && snapshot.handoffEnvelopeProofId.trim()
          ? snapshot.handoffEnvelopeProofId.trim()
          : null,
        handoffClaimProof: typeof snapshot.handoffClaimProof === "string" && snapshot.handoffClaimProof.trim()
          ? snapshot.handoffClaimProof.trim()
          : null,
        permissionState: normalizeString(snapshot.permissionState, "unknown"),
        unsupportedPermissionCount: Math.trunc(normalizeNumber(snapshot.unsupportedPermissionCount, 0, { min: 0, max: 10000 })),
        missingRequiredPermissionCount: Math.trunc(normalizeNumber(snapshot.missingRequiredPermissionCount, 0, { min: 0, max: 10000 })),
        acceptanceState: normalizeString(snapshot.acceptanceState, "unknown"),
        validationErrors: Math.trunc(normalizeNumber(snapshot.validationErrors, 0, { min: 0, max: 10000 })),
        validationWarnings: Math.trunc(normalizeNumber(snapshot.validationWarnings, 0, { min: 0, max: 10000 })),
        eventCount: Math.trunc(normalizeNumber(snapshot.eventCount, 0, { min: 0, max: 10000 })),
        blockingEventCount: Math.trunc(normalizeNumber(snapshot.blockingEventCount, 0, { min: 0, max: 10000 })),
        readyPanelCount: Math.trunc(normalizeNumber(snapshot.readyPanelCount, 0, { min: 0, max: 10000 })),
        degradedPanelCount: Math.trunc(normalizeNumber(snapshot.degradedPanelCount, 0, { min: 0, max: 10000 })),
        durableCheckpoint: snapshot.durableCheckpoint === true,
        cliRunRecoveryState: normalizeString(snapshot.cliRunRecoveryState, "unknown"),
        cliRunRestartSafeStatus: normalizeString(snapshot.cliRunRestartSafeStatus, "unknown"),
        cliRunLifecycleReadiness: normalizeString(snapshot.cliRunLifecycleReadiness, "unknown"),
        cliRunStaleCommands: Math.trunc(normalizeNumber(snapshot.cliRunStaleCommands, 0, { min: 0, max: 10000 })),
        cliRunExpiredLeases: Math.trunc(normalizeNumber(snapshot.cliRunExpiredLeases, 0, { min: 0, max: 10000 })),
        cliRunRetryableCommands: Math.trunc(normalizeNumber(snapshot.cliRunRetryableCommands, 0, { min: 0, max: 10000 })),
        cliRunActionableErrors: Math.trunc(normalizeNumber(snapshot.cliRunActionableErrors, 0, { min: 0, max: 10000 })),
        cliRunNextAttemptAt: normalizeString(snapshot.cliRunNextAttemptAt, null),
        cliLogsRestartSafeStatus: normalizeString(snapshot.cliLogsRestartSafeStatus, "unknown"),
        cliLogsCanPersistStatus: snapshot.cliLogsCanPersistStatus === true,
        cliLogsReplayableCommands: Math.trunc(normalizeNumber(snapshot.cliLogsReplayableCommands, 0, { min: 0, max: 10000 })),
        cliLogsOperatorAckRequired: Math.trunc(normalizeNumber(snapshot.cliLogsOperatorAckRequired, 0, { min: 0, max: 10000 })),
        cliLogsDuplicateIdempotencyKeys: Math.trunc(normalizeNumber(snapshot.cliLogsDuplicateIdempotencyKeys, 0, { min: 0, max: 10000 })),
        cliLogsMissingEvents: Math.trunc(normalizeNumber(snapshot.cliLogsMissingEvents, 0, { min: 0, max: 1000000 })),
        cliLogsRecoveryProofId: typeof snapshot.cliLogsRecoveryProofId === "string" && snapshot.cliLogsRecoveryProofId.trim()
          ? snapshot.cliLogsRecoveryProofId.trim()
          : null
      };
    });
  const snapshots = [...normalizedHistory, currentSnapshot].sort((left, right) => {
    const leftTime = Date.parse(left.capturedAt);
    const rightTime = Date.parse(right.capturedAt);
    return (Number.isFinite(leftTime) ? leftTime : 0) - (Number.isFinite(rightTime) ? rightTime : 0);
  });
  const countBy = (field, value) => snapshots.filter((snapshot) => snapshot[field] === value).length;
  const counters = {
    snapshotCount: snapshots.length,
    historySnapshotCount: normalizedHistory.length,
    exportFormatCount: exportFormats.length,
    readySnapshots: countBy("readinessState", "ready"),
    degradedSnapshots: countBy("readinessState", "degraded"),
    blockedSnapshots: countBy("readinessState", "blocked"),
    acceptedSnapshots: countBy("acceptanceState", "accepted"),
    blockedCommands: countBy("commandState", "blocked"),
    permissionBoundaryBlocks: snapshots.filter((snapshot) => snapshot.permissionState === "blocked" || snapshot.permissionState === "limited").length,
    healthValidationBlocks: countBy("healthValidationState", "blocked"),
    healthValidationDegraded: countBy("healthValidationState", "degraded"),
    totalHealthValidationFindings: snapshots.reduce((total, snapshot) => total + snapshot.healthValidationFindings, 0),
    unsupportedPermissionFindings: snapshots.reduce((total, snapshot) => total + snapshot.unsupportedPermissionCount, 0),
    missingRequiredPermissionFindings: snapshots.reduce((total, snapshot) => total + snapshot.missingRequiredPermissionCount, 0),
    dispatchableHandoffs: snapshots.filter((snapshot) => snapshot.handoffDispatchable).length,
    durableCheckpoints: snapshots.filter((snapshot) => snapshot.durableCheckpoint).length,
    totalValidationErrors: snapshots.reduce((total, snapshot) => total + snapshot.validationErrors, 0),
    totalValidationWarnings: snapshots.reduce((total, snapshot) => total + snapshot.validationWarnings, 0),
    totalOperatorEvents: snapshots.reduce((total, snapshot) => total + snapshot.eventCount, 0),
    totalBlockingEvents: snapshots.reduce((total, snapshot) => total + snapshot.blockingEventCount, 0),
    cliRunRecoveryBlockedSnapshots: snapshots.filter((snapshot) => snapshot.cliRunRecoveryState === "blocked").length,
    cliRunRecoveryActiveSnapshots: snapshots.filter((snapshot) => ["blocked", "recovering", "retry-wait"].includes(snapshot.cliRunRecoveryState)).length,
    cliRunRestartSafeRecoveries: snapshots.filter((snapshot) => snapshot.cliRunRestartSafeStatus === "needs-recovery").length,
    cliLogsRestartBlockedSnapshots: snapshots.filter((snapshot) => snapshot.cliLogsRestartSafeStatus === "blocked").length,
    cliLogsPersistBlockedSnapshots: snapshots.filter((snapshot) => !snapshot.cliLogsCanPersistStatus && snapshot.cliLogsRestartSafeStatus !== "unknown").length,
    totalCliRunStaleCommands: snapshots.reduce((total, snapshot) => total + snapshot.cliRunStaleCommands, 0),
    totalCliRunExpiredLeases: snapshots.reduce((total, snapshot) => total + snapshot.cliRunExpiredLeases, 0),
    totalCliRunRetryableCommands: snapshots.reduce((total, snapshot) => total + snapshot.cliRunRetryableCommands, 0),
    totalCliRunActionableErrors: snapshots.reduce((total, snapshot) => total + snapshot.cliRunActionableErrors, 0),
    totalCliLogsReplayableCommands: snapshots.reduce((total, snapshot) => total + snapshot.cliLogsReplayableCommands, 0),
    totalCliLogsOperatorAckRequired: snapshots.reduce((total, snapshot) => total + snapshot.cliLogsOperatorAckRequired, 0),
    totalCliLogsDuplicateIdempotencyKeys: snapshots.reduce((total, snapshot) => total + snapshot.cliLogsDuplicateIdempotencyKeys, 0),
    totalCliLogsMissingEvents: snapshots.reduce((total, snapshot) => total + snapshot.cliLogsMissingEvents, 0)
  };
  const timeline = snapshots.map((snapshot, index) => ({
    sequence: index + 1,
    snapshotId: snapshot.id,
    capturedAt: snapshot.capturedAt,
    cursor: snapshot.cursor,
    state: snapshot.readinessState,
    health: snapshot.operationalHealthState,
    healthValidation: snapshot.healthValidationState,
    permissionState: snapshot.permissionState,
    handoff: snapshot.handoffEnvelopeState,
    handoffDispatchable: snapshot.handoffDispatchable,
    cliRunRecoveryState: snapshot.cliRunRecoveryState,
    cliRunRestartSafeStatus: snapshot.cliRunRestartSafeStatus,
    cliLogsRestartSafeStatus: snapshot.cliLogsRestartSafeStatus,
    eventCount: snapshot.eventCount,
    blockingEventCount: snapshot.blockingEventCount,
    exportRowKey: `${workspaceBoundary.workspaceId}:${snapshot.cursor}:${index + 1}`
  }));
  const previousSnapshot = snapshots.length > 1 ? snapshots[snapshots.length - 2] : null;
  const latestSnapshot = snapshots[snapshots.length - 1] || currentSnapshot;
  const stateTransitions = snapshots.slice(1).reduce((transitions, snapshot, index) => {
    const previous = snapshots[index];
    const transitionKey = `${previous.readinessState}->${snapshot.readinessState}`;
    transitions[transitionKey] = (transitions[transitionKey] || 0) + 1;
    return transitions;
  }, {});
  const timelineStateCounts = snapshots.reduce((counts, snapshot) => {
    counts[snapshot.readinessState] = (counts[snapshot.readinessState] || 0) + 1;
    return counts;
  }, {});
  const oldestSnapshot = snapshots[0] || currentSnapshot;
  const newestSnapshot = snapshots[snapshots.length - 1] || currentSnapshot;
  const observedStartMs = Date.parse(oldestSnapshot.capturedAt);
  const observedEndMs = Date.parse(newestSnapshot.capturedAt);
  const observedDurationMs = Number.isFinite(observedStartMs) && Number.isFinite(observedEndMs)
    ? Math.max(0, observedEndMs - observedStartMs)
    : 0;
  const latestDelta = previousSnapshot
    ? {
      readinessChanged: previousSnapshot.readinessState !== latestSnapshot.readinessState,
      healthChanged: previousSnapshot.operationalHealthState !== latestSnapshot.operationalHealthState,
      permissionChanged: previousSnapshot.permissionState !== latestSnapshot.permissionState,
      validationErrorDelta: latestSnapshot.validationErrors - previousSnapshot.validationErrors,
      validationWarningDelta: latestSnapshot.validationWarnings - previousSnapshot.validationWarnings,
      blockingEventDelta: latestSnapshot.blockingEventCount - previousSnapshot.blockingEventCount,
      cliRunRetryableCommandDelta: latestSnapshot.cliRunRetryableCommands - previousSnapshot.cliRunRetryableCommands,
      cliLogsOperatorAckDelta: latestSnapshot.cliLogsOperatorAckRequired - previousSnapshot.cliLogsOperatorAckRequired,
      readyPanelDelta: latestSnapshot.readyPanelCount - previousSnapshot.readyPanelCount,
      degradedPanelDelta: latestSnapshot.degradedPanelCount - previousSnapshot.degradedPanelCount,
      cursorAdvanced: previousSnapshot.cursor !== latestSnapshot.cursor
    }
    : {
      readinessChanged: false,
      healthChanged: false,
      permissionChanged: false,
      validationErrorDelta: 0,
      validationWarningDelta: 0,
      blockingEventDelta: 0,
      cliRunRetryableCommandDelta: 0,
      cliLogsOperatorAckDelta: 0,
      readyPanelDelta: 0,
      degradedPanelDelta: 0,
      cursorAdvanced: false
    };
  const exportRows = snapshots.map((snapshot, index) => ({
    rowNumber: index + 1,
    rowKey: `${workspaceBoundary.workspaceId}:${snapshot.cursor}:${index + 1}`,
    tenantId: workspaceBoundary.tenantId,
    workspaceId: workspaceBoundary.workspaceId,
    capturedAt: snapshot.capturedAt,
    cursor: snapshot.cursor,
    requestId: snapshot.requestId,
    readinessState: snapshot.readinessState,
    healthState: snapshot.operationalHealthState,
    healthValidationState: snapshot.healthValidationState,
    lifecycleState: snapshot.lifecycleState,
    commandState: snapshot.commandState,
    workflowState: snapshot.workflowState,
    handoffState: snapshot.handoffEnvelopeState,
    handoffDispatchable: snapshot.handoffDispatchable,
    permissionState: snapshot.permissionState,
    acceptanceState: snapshot.acceptanceState,
    validationErrors: snapshot.validationErrors,
    validationWarnings: snapshot.validationWarnings,
    healthValidationFindings: snapshot.healthValidationFindings,
    operatorEvents: snapshot.eventCount,
    blockingEvents: snapshot.blockingEventCount,
    readyPanels: snapshot.readyPanelCount,
    degradedPanels: snapshot.degradedPanelCount,
    durableCheckpoint: snapshot.durableCheckpoint,
    handoffEnvelopeProofId: snapshot.handoffEnvelopeProofId,
    handoffClaimProof: snapshot.handoffClaimProof,
    cliRunRecoveryState: snapshot.cliRunRecoveryState,
    cliRunRestartSafeStatus: snapshot.cliRunRestartSafeStatus,
    cliRunLifecycleReadiness: snapshot.cliRunLifecycleReadiness,
    cliRunStaleCommands: snapshot.cliRunStaleCommands,
    cliRunExpiredLeases: snapshot.cliRunExpiredLeases,
    cliRunRetryableCommands: snapshot.cliRunRetryableCommands,
    cliRunActionableErrors: snapshot.cliRunActionableErrors,
    cliRunNextAttemptAt: snapshot.cliRunNextAttemptAt,
    cliLogsRestartSafeStatus: snapshot.cliLogsRestartSafeStatus,
    cliLogsCanPersistStatus: snapshot.cliLogsCanPersistStatus,
    cliLogsReplayableCommands: snapshot.cliLogsReplayableCommands,
    cliLogsOperatorAckRequired: snapshot.cliLogsOperatorAckRequired,
    cliLogsDuplicateIdempotencyKeys: snapshot.cliLogsDuplicateIdempotencyKeys,
    cliLogsMissingEvents: snapshot.cliLogsMissingEvents,
    cliLogsRecoveryProofId: snapshot.cliLogsRecoveryProofId
  }));
  const exportColumns = Object.freeze([
    "rowNumber",
    "rowKey",
    "tenantId",
    "workspaceId",
    "capturedAt",
    "cursor",
    "requestId",
    "readinessState",
    "healthState",
    "healthValidationState",
    "lifecycleState",
    "commandState",
    "workflowState",
    "handoffState",
    "handoffDispatchable",
    "permissionState",
    "acceptanceState",
    "validationErrors",
    "validationWarnings",
    "healthValidationFindings",
    "operatorEvents",
    "blockingEvents",
    "readyPanels",
    "degradedPanels",
    "durableCheckpoint",
    "handoffEnvelopeProofId",
    "handoffClaimProof",
    "cliRunRecoveryState",
    "cliRunRestartSafeStatus",
    "cliRunLifecycleReadiness",
    "cliRunStaleCommands",
    "cliRunExpiredLeases",
    "cliRunRetryableCommands",
    "cliRunActionableErrors",
    "cliRunNextAttemptAt",
    "cliLogsRestartSafeStatus",
    "cliLogsCanPersistStatus",
    "cliLogsReplayableCommands",
    "cliLogsOperatorAckRequired",
    "cliLogsDuplicateIdempotencyKeys",
    "cliLogsMissingEvents",
    "cliLogsRecoveryProofId"
  ]);
  const reportState = counters.blockedSnapshots > 0
    || counters.totalValidationErrors > 0
    || counters.cliRunRecoveryBlockedSnapshots > 0
    || counters.cliLogsRestartBlockedSnapshots > 0
    || counters.totalCliLogsOperatorAckRequired > 0
    ? "needs-attention"
    : counters.degradedSnapshots > 0
      || counters.totalBlockingEvents > 0
      || counters.cliRunRecoveryActiveSnapshots > 0
      || counters.totalCliRunRetryableCommands > 0
      || counters.cliLogsPersistBlockedSnapshots > 0
      ? "watch"
      : "ready";

  return {
    contractVersion: "dashboard-analytics-reporting.v1",
    tenantId: workspaceBoundary.tenantId,
    workspaceId: workspaceBoundary.workspaceId,
    requestId: clientRuntime.requestId,
    generatedAt: now,
    reportState,
    counters,
    currentSnapshot,
    snapshots,
    timeline,
    timelineState: {
      stateCounts: timelineStateCounts,
      transitions: stateTransitions,
      latestSnapshotId: latestSnapshot.id,
      previousSnapshotId: previousSnapshot?.id || null,
      latestDelta,
      observedWindow: {
        startedAt: oldestSnapshot.capturedAt,
        endedAt: newestSnapshot.capturedAt,
        durationMs: observedDurationMs,
        boundedByHistoryLimit: rawHistory.length > ANALYTICS_HISTORY_LIMIT,
        retainedHistoryLimit: ANALYTICS_HISTORY_LIMIT
      }
    },
    exportSummary: {
      title: `Hosted-kernel dashboard report for ${workspaceBoundary.workspaceId}`,
      formats: exportFormats,
      rowCount: snapshots.length,
      columnCount: exportColumns.length,
      columns: exportColumns,
      routes: exportFormats.map((format) => ({
        format,
        route: `${workspaceBoundary.routeScope}/analytics/export.${format}?cursor=${encodeURIComponent(syncMetadata.nextCursor)}`
      })),
      manifests: exportFormats.map((format) => ({
        format,
        mediaType: format === "csv" ? "text/csv" : format === "jsonl" ? "application/x-ndjson" : "application/json",
        rowCount: exportRows.length,
        route: `${workspaceBoundary.routeScope}/analytics/export.${format}?cursor=${encodeURIComponent(syncMetadata.nextCursor)}`,
        proofId: proofToken({
          workspace: workspaceBoundary.workspaceId,
          format,
          cursor: syncMetadata.nextCursor,
          columns: exportColumns,
          rows: exportRows.map((row) => row.rowKey)
        })
      })),
      rows: exportRows,
      summaryCards: [
        {
          id: "readiness",
          label: "Readiness",
          value: latestSnapshot.readinessState,
          trend: latestDelta.readinessChanged ? "changed" : "stable"
        },
        {
          id: "validation-errors",
          label: "Validation errors",
          value: counters.totalValidationErrors,
          trend: latestDelta.validationErrorDelta > 0 ? "up" : latestDelta.validationErrorDelta < 0 ? "down" : "stable"
        },
        {
          id: "blocking-events",
          label: "Blocking events",
          value: counters.totalBlockingEvents,
          trend: latestDelta.blockingEventDelta > 0 ? "up" : latestDelta.blockingEventDelta < 0 ? "down" : "stable"
        },
        {
          id: "handoff-dispatchable",
          label: "Dispatchable handoffs",
          value: counters.dispatchableHandoffs,
          trend: latestSnapshot.handoffDispatchable ? "ready" : "waiting"
        },
        {
          id: "cli-run-recovery",
          label: "CLI run recovery",
          value: latestSnapshot.cliRunRecoveryState,
          trend: latestDelta.cliRunRetryableCommandDelta > 0 ? "more-retries" : latestDelta.cliRunRetryableCommandDelta < 0 ? "fewer-retries" : "stable"
        },
        {
          id: "cli-logs-restart",
          label: "CLI logs restart",
          value: latestSnapshot.cliLogsRestartSafeStatus,
          trend: latestDelta.cliLogsOperatorAckDelta > 0 ? "more-acks" : latestDelta.cliLogsOperatorAckDelta < 0 ? "fewer-acks" : "stable"
        }
      ],
      includesAuditProof: Boolean(audit.proofId),
      proofRefs: {
        auditProofId: audit.proofId,
        eventStreamProofId: operatorEventStream.proofId,
        handoffEnvelopeProofId: handoffEnvelope?.proofId || null,
        cliLogsRecoveryProofId: latestSnapshot.cliLogsRecoveryProofId,
        checkpointWriteId: stateCheckpoint.writeId
      }
    },
    proofId: proofToken({
      workspace: workspaceBoundary.workspaceId,
      requestId: clientRuntime.requestId,
      cursor: syncMetadata.nextCursor,
      counters,
      exportFormats,
      snapshotIds: snapshots.map((snapshot) => snapshot.id)
    })
  };
}

function normalizeRunningJobs(input = {}, workspaceBoundary, syncMetadata, now) {
  const rawJobs = Array.isArray(input.jobs)
    ? input.jobs
    : Array.isArray(input.runningJobs)
      ? input.runningJobs
      : [];
  const jobStateOrder = { blocked: 0, failed: 1, running: 2, queued: 3, completed: 4, unknown: 5 };
  const nowMs = Date.parse(now);
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();

  return rawJobs
    .filter((job) => job && typeof job === "object")
    .map((job, index) => {
      const id = normalizeString(job.id || job.jobId, `job-${index + 1}`);
      const state = RUNNING_JOB_STATES.includes(job.state)
        ? job.state
        : job.status === "in_progress"
          ? "running"
          : job.status === "done"
            ? "completed"
            : job.status === "error"
              ? "failed"
              : "unknown";
      const startedAt = typeof job.startedAt === "string" && job.startedAt.trim() ? job.startedAt.trim() : null;
      const updatedAt = normalizeString(job.updatedAt || job.observedAt, startedAt || now);
      const dueAt = typeof job.dueAt === "string" && job.dueAt.trim() ? job.dueAt.trim() : null;
      const startedMs = startedAt ? Date.parse(startedAt) : NaN;
      const updatedMs = Date.parse(updatedAt);
      const dueMs = dueAt ? Date.parse(dueAt) : NaN;
      const ageMs = Number.isFinite(startedMs) ? Math.max(0, safeNowMs - startedMs) : null;
      const sinceUpdateMs = Number.isFinite(updatedMs) ? Math.max(0, safeNowMs - updatedMs) : null;
      const overdueMs = Number.isFinite(dueMs) ? Math.max(0, safeNowMs - dueMs) : 0;
      const progressPercent = Math.trunc(normalizeNumber(job.progressPercent ?? job.progress, state === "completed" ? 100 : 0, { min: 0, max: 100 }));
      const route = normalizeString(job.route, `${workspaceBoundary.routeScope}/jobs/${encodeURIComponent(id)}`);
      const stale = (state === "queued" || state === "running") && sinceUpdateMs !== null && sinceUpdateMs > JOB_STALE_AFTER_MS;
      const stalled = state === "running" && progressPercent < 100 && sinceUpdateMs !== null && sinceUpdateMs > JOB_PROGRESS_STALL_AFTER_MS;
      const longRunning = state === "running" && ageMs !== null && ageMs > JOB_ATTENTION_AFTER_MS;
      const overdue = (state === "queued" || state === "running" || state === "blocked") && overdueMs > 0;
      const attentionRequired = state === "blocked" || state === "failed" || stale || stalled || longRunning || overdue;
      const attentionSeverity = state === "failed" || (state === "blocked" && overdue)
        ? "error"
        : attentionRequired
          ? "warning"
          : "info";
      const blockedReason = state === "blocked" || state === "failed"
        ? normalizeString(job.blockedReason || job.error || job.reason, "Job requires operator attention.")
        : stalled
          ? `Job progress has not advanced for more than ${JOB_PROGRESS_STALL_AFTER_MS}ms.`
          : stale
            ? `Job status has not updated for more than ${JOB_STALE_AFTER_MS}ms.`
            : longRunning
              ? `Job has been running for more than ${JOB_ATTENTION_AFTER_MS}ms.`
              : overdue
                ? "Job is past its requested due time."
                : null;
      const actionId = attentionRequired
        ? state === "failed" || state === "blocked"
          ? "inspect-job"
          : "refresh-job-status"
        : state === "running"
          ? "monitor-job"
          : "open-job";

      return {
        contractVersion: "dashboard-running-job.v1",
        id,
        label: normalizeString(job.label || job.name, id),
        type: normalizeString(job.type || job.kind, "hosted-kernel-job"),
        state,
        progressPercent,
        startedAt,
        updatedAt,
        dueAt,
        ageMs,
        sinceUpdateMs,
        overdueMs,
        stale,
        stalled,
        longRunning,
        attentionRequired,
        attentionSeverity,
        cursor: normalizeString(job.cursor, syncMetadata.cursor),
        route,
        blockedReason,
        actionId,
        operatorAction: {
          id: actionId,
          label: actionId === "refresh-job-status"
            ? `Refresh ${normalizeString(job.label || job.name, id)}`
            : actionId === "inspect-job"
              ? `Inspect ${normalizeString(job.label || job.name, id)}`
              : actionId === "monitor-job"
                ? `Monitor ${normalizeString(job.label || job.name, id)}`
                : `Open ${normalizeString(job.label || job.name, id)}`,
          route,
          reason: blockedReason || `${normalizeString(job.label || job.name, id)} is ${state}.`,
          severity: attentionSeverity
        }
      };
    })
    .sort((left, right) => {
      const leftRank = jobStateOrder[left.state] ?? jobStateOrder.unknown;
      const rightRank = jobStateOrder[right.state] ?? jobStateOrder.unknown;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      return String(right.updatedAt).localeCompare(String(left.updatedAt));
    });
}

function buildObjectiveTruthContract({
  workspaceBoundary,
  capabilityNegotiation,
  operationalHealth,
  healthValidation,
  providerServiceContract,
  lifecycleControl,
  commandRecovery,
  commandOutcome,
  stateCheckpoint,
  acceptance,
  readiness,
  validationSummary,
  operatorEventStream,
  audit,
  now
}) {
  const expectedProofRefs = {
    auditProofId: audit.proofId,
    boundaryProof: workspaceBoundary.boundaryProof,
    permissionProof: workspaceBoundary.permissionProof,
    healthProofId: operationalHealth.proofId,
    healthValidationProofId: healthValidation.proofId,
    providerServiceProofId: providerServiceContract.proofId,
    checkpointWriteId: stateCheckpoint.writeId,
    eventStreamProofId: operatorEventStream.proofId
  };
  const missingProofRefs = Object.entries(expectedProofRefs)
    .filter(([, value]) => !value)
    .map(([id]) => id);
  const errorFindings = validationSummary.findings.filter((finding) => finding.severity === "error");
  const blockingEvents = operatorEventStream.events.filter((event) => event.severity === "error");
  const claimInputs = [
    {
      id: "acceptance-reflects-validation",
      accepted: !acceptance.accepted || validationSummary.ok,
      severity: "error",
      message: "Acceptance cannot be true while validation has error findings.",
      repairAction: "resolve-validation"
    },
    {
      id: "readiness-reflects-acceptance",
      accepted: readiness.state !== "ready" || acceptance.accepted,
      severity: "error",
      message: "Readiness cannot be ready until the acceptance gate is accepted.",
      repairAction: "resolve-validation"
    },
    {
      id: "proof-chain-complete",
      accepted: missingProofRefs.length === 0,
      severity: "error",
      message: missingProofRefs.length > 0
        ? `Dashboard objective proof chain is missing ${missingProofRefs.join(", ")}.`
        : "Dashboard objective proof chain is complete.",
      repairAction: "refresh-readiness"
    },
    {
      id: "checkpoint-boundary-safe",
      accepted: !stateCheckpoint.durable || workspaceBoundary.safeToPersist,
      severity: "error",
      message: "Durable dashboard checkpoints require a scoped permission boundary.",
      repairAction: "refresh-readiness"
    },
    {
      id: "provider-compatibility-reflected",
      accepted: providerServiceContract.providerCompatibility.compatible || providerServiceContract.state !== "ready",
      severity: "error",
      message: "Provider services cannot be marked ready when declarations are incompatible.",
      repairAction: "repair-provider-contract"
    },
    {
      id: "health-validation-reflected",
      accepted: healthValidation.state !== "blocked" || readiness.state === "blocked",
      severity: "error",
      message: "Blocked hosted-kernel health validation must block dashboard readiness.",
      repairAction: "refresh-hosted-kernel-health"
    },
    {
      id: "command-recovery-reflected",
      accepted: !["repair-ledger", "blocked", "health-blocked", "wait-for-health-retry"].includes(commandRecovery.dispatchMode) || commandOutcome.state === "blocked",
      severity: "error",
      message: "Blocked command recovery must produce a blocked command outcome.",
      repairAction: commandRecovery.dispatchMode === "repair-ledger"
        ? "repair-command-ledger"
        : commandRecovery.dispatchMode === "health-blocked" || commandRecovery.dispatchMode === "wait-for-health-retry"
          ? "refresh-hosted-kernel-health"
          : "refresh-readiness"
    },
    {
      id: "command-health-gate-reflected",
      accepted: commandRecovery.healthGate.state === "ready"
        || commandRecovery.idempotentReplay
        || commandOutcome.state === "blocked"
        || commandRecovery.degradedDispatch,
      severity: "warning",
      message: "Command health gate state must be visible as either blocked, replayed, or degraded dispatch.",
      repairAction: commandRecovery.healthGate.backoffActive ? "retry-hosted-kernel-health" : "refresh-hosted-kernel-health"
    },
    {
      id: "event-stream-reflects-errors",
      accepted: errorFindings.length === 0 || blockingEvents.length > 0,
      severity: "warning",
      message: "Validation errors should be represented by at least one blocking operator event.",
      repairAction: "rebuild-operator-event-stream"
    },
    {
      id: "lifecycle-command-gate-reflected",
      accepted: lifecycleControl.commandAllowed || readiness.state !== "ready",
      severity: "warning",
      message: "Readiness should not be ready while lifecycle command dispatch is unavailable.",
      repairAction: "repair-lifecycle-settings"
    },
    {
      id: "capability-dashboard-readable",
      accepted: workspaceBoundary.isolationState !== "scoped" || capabilityNegotiation.granted.includes("dashboard.read"),
      severity: "error",
      message: "A scoped operator dashboard response must include dashboard.read.",
      repairAction: "repair-permission-boundary"
    }
  ];
  const claims = claimInputs.map((claim) => ({
    contractVersion: "dashboard-objective-truth-claim.v1",
    ...claim,
    state: claim.accepted ? "satisfied" : "gap",
    route: `${workspaceBoundary.routeScope}/objective-truth/${claim.id}`
  }));
  const gaps = claims.filter((claim) => !claim.accepted);
  const hardGaps = gaps.filter((claim) => claim.severity === "error");
  const repairActions = [...new Map(gaps.map((gap) => [gap.repairAction, gap])).values()].map((gap) => ({
    id: gap.repairAction,
    label: gap.repairAction.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" "),
    route: gap.route,
    reason: gap.message,
    severity: gap.severity
  }));
  const state = hardGaps.length > 0 ? "blocked" : gaps.length > 0 ? "degraded" : "true";

  return {
    contractVersion: "dashboard-objective-truth.v1",
    state,
    checkedAt: now,
    tenantId: workspaceBoundary.tenantId,
    workspaceId: workspaceBoundary.workspaceId,
    claimCount: claims.length,
    gapCount: gaps.length,
    hardGapCount: hardGaps.length,
    missingProofRefs,
    claims,
    gaps: gaps.map((gap) => ({
      id: gap.id,
      severity: gap.severity,
      message: gap.message,
      route: gap.route,
      repairAction: gap.repairAction
    })),
    repairActions,
    proofRefs: expectedProofRefs,
    proofId: proofToken({
      workspace: workspaceBoundary.workspaceId,
      readinessState: readiness.state,
      acceptanceAccepted: acceptance.accepted,
      validationOk: validationSummary.ok,
      eventStreamProofId: operatorEventStream.proofId,
      checkpointWriteId: stateCheckpoint.writeId,
      gaps: gaps.map((gap) => [gap.id, gap.severity, gap.repairAction])
    }),
    route: `${workspaceBoundary.routeScope}/objective-truth`
  };
}

function buildOperatorDashboardStateModel({
  input,
  clientRuntime,
  clientWorkflow,
  provider,
  workspaceBoundary,
  syncMetadata,
  kernelHealth,
  operationalHealth,
  healthValidation,
  providerServiceContract,
  lifecycleControl,
  lifecycleActionPlan,
  operationalSnapshotRecovery,
  runningJobs: normalizedRunningJobs,
  commandRecovery,
  commandOutcome,
  stateCheckpoint,
  workflowLaunch,
  acceptance,
  readiness,
  validationSummary,
  nextSteps,
  audit,
  operatorEventStream,
  objectiveTruth,
  now
}) {
  const runningJobs = Array.isArray(normalizedRunningJobs)
    ? normalizedRunningJobs
    : normalizeRunningJobs(input, workspaceBoundary, syncMetadata, now);
  const activeJobs = runningJobs.filter((job) => job.state === "queued" || job.state === "running");
  const completedJobs = runningJobs.filter((job) => job.state === "completed");
  const attentionJobs = runningJobs.filter((job) => job.attentionRequired);
  const blockedJobs = runningJobs.filter((job) => job.state === "blocked");
  const failedJobs = runningJobs.filter((job) => job.state === "failed");
  const staleJobs = runningJobs.filter((job) => job.stale || job.stalled || job.longRunning);
  const overdueJobs = runningJobs.filter((job) => job.overdueMs > 0);
  const highestJobSeverity = attentionJobs.some((job) => job.attentionSeverity === "error")
    ? "error"
    : attentionJobs.length > 0
      ? "warning"
      : "info";
  const jobQueueState = failedJobs.length > 0
    ? "failed"
    : blockedJobs.length > 0
      ? "blocked"
      : staleJobs.length > 0 || overdueJobs.length > 0
        ? "stale"
        : activeJobs.length > 0
          ? "active"
          : completedJobs.length > 0
            ? "complete"
            : "empty";
  const validationErrors = validationSummary.findings.filter((finding) => finding.severity === "error");
  const proofRefs = {
    auditProofId: audit.proofId,
    readinessRoute: readiness.route,
    healthProofId: operationalHealth.proofId,
    healthValidationProofId: healthValidation.proofId,
    providerServiceProofId: providerServiceContract.proofId,
    checkpointWriteId: stateCheckpoint.writeId,
    eventStreamProofId: operatorEventStream.proofId,
    objectiveTruthProofId: objectiveTruth.proofId,
    acceptanceToken: acceptance.acceptanceToken
  };
  const proofMissing = Object.entries(proofRefs)
    .filter(([key, value]) => key !== "acceptanceToken" && !value)
    .map(([key]) => key);
  const proofState = proofMissing.length > 0
    ? "incomplete"
    : acceptance.accepted
      ? "accepted"
      : validationErrors.length > 0
        ? "blocked"
        : "pending";
  const blockers = [
    workspaceBoundary.isolationState === "blocked" ? {
      id: "workspace-boundary",
      severity: "error",
      message: workspaceBoundary.reason || "Workspace boundary is blocked.",
      route: `${workspaceBoundary.routeScope}/boundary`
    } : null,
    operationalHealth.state === "blocked" ? {
      id: "kernel-health",
      severity: "error",
      message: operationalHealth.actionableErrors.find((error) => error.severity === "error")?.message || "Hosted-kernel health blocks dashboard service.",
      route: operationalHealth.route
    } : null,
    healthValidation.state === "blocked" ? {
      id: "health-validation",
      severity: "error",
      message: healthValidation.findings.find((finding) => finding.severity === "error")?.message || "Hosted-kernel health validation is blocked.",
      route: healthValidation.route
    } : null,
    providerServiceContract.state === "blocked" ? {
      id: "provider-services",
      severity: "error",
      message: providerServiceContract.providerCompatibility.blockers[0]?.message || "Provider service contract is blocked.",
      route: providerServiceContract.bindingRoute
    } : null,
    lifecycleControl.state === "blocked" ? {
      id: "lifecycle-control",
      severity: "warning",
      message: lifecycleControl.blockedReason || "Lifecycle control blocks command dispatch.",
      route: lifecycleControl.route
    } : null,
    commandOutcome.state === "blocked" ? {
      id: "command-outcome",
      severity: "error",
      message: commandOutcome.blockedReason || "Dashboard command was blocked.",
      route: `${workspaceBoundary.routeScope}/commands/${encodeURIComponent(commandOutcome.commandId)}`
    } : null,
    commandRecovery?.healthGate?.backoffActive ? {
      id: "command-health-backoff",
      severity: "warning",
      message: commandRecovery.dispatchBlocker || `Hosted-kernel command retry is delayed until ${commandRecovery.healthGate.nextAttemptAt}.`,
      route: commandRecovery.recoveryActions.find((action) => action.id === "wait-for-hosted-kernel-retry-backoff")?.route || operationalHealth.route
    } : null,
    commandRecovery?.degradedDispatch ? {
      id: "command-degraded-dispatch",
      severity: "warning",
      message: "Command dispatch is proceeding under degraded hosted-kernel health.",
      route: `${workspaceBoundary.routeScope}/commands/${encodeURIComponent(commandOutcome.commandId)}/degraded-dispatch`
    } : null,
    workflowLaunch.state === "blocked" ? {
      id: "workflow-launch",
      severity: "error",
      message: workflowLaunch.blockers[0]?.message || "Workflow launch is blocked.",
      route: workflowLaunch.launchRoute
    } : null,
    objectiveTruth.state === "blocked" ? {
      id: "objective-truth",
      severity: "error",
      message: objectiveTruth.gaps[0]?.message || "Dashboard objective truth contract is blocked.",
      route: objectiveTruth.route
    } : null,
    objectiveTruth.state === "degraded" ? {
      id: "objective-truth",
      severity: "warning",
      message: objectiveTruth.gaps[0]?.message || "Dashboard objective truth contract has unresolved gaps.",
      route: objectiveTruth.route
    } : null,
    operationalSnapshotRecovery?.state === "refresh-required" ? {
      id: "operational-snapshot-recovery",
      severity: operationalSnapshotRecovery.quarantinedScopeViolationCount > 0 ? "error" : "warning",
      message: operationalSnapshotRecovery.driftReasons[0] || "Persisted operational snapshot requires recovery refresh.",
      route: operationalSnapshotRecovery.route
    } : null,
    operationalSnapshotRecovery?.quarantinedScopeViolationCount > 0 ? {
      id: "operational-snapshot-scope",
      severity: "error",
      message: operationalSnapshotRecovery.quarantinedScopeViolations[0]?.reason || "Persisted operational snapshot scope was quarantined.",
      route: `${workspaceBoundary.routeScope}/state/operational-snapshot/quarantine`
    } : null,
    ...attentionJobs.map((job) => ({
      id: `job-${job.id}`,
      severity: job.attentionSeverity,
      message: job.blockedReason || `${job.label} is ${job.state}.`,
      route: job.route
    }))
  ].filter(Boolean);
  const actionById = new Map();
  for (const step of nextSteps.steps) {
    if (!actionById.has(step.id)) {
      actionById.set(step.id, {
        id: step.id,
        label: step.label,
        route: step.route,
        reason: step.reason,
        enabled: workspaceBoundary.isolationState === "scoped",
        source: "next-step",
        priority: step.id === nextSteps.primaryAction ? 0 : 2,
        proofRef: step.proofRef || null,
        retryToken: step.retryToken || null
      });
    }
  }
  for (const job of attentionJobs) {
    const id = `${job.actionId}-${job.id}`;
    actionById.set(id, {
      id,
      label: job.operatorAction.label,
      route: job.route,
      reason: job.operatorAction.reason,
      enabled: workspaceBoundary.isolationState === "scoped",
      source: "running-job",
      priority: job.attentionSeverity === "error" ? 0 : 1,
      proofRef: null,
      retryToken: null,
      severity: job.attentionSeverity
    });
  }
  for (const repairAction of objectiveTruth.repairActions) {
    if (!actionById.has(repairAction.id)) {
      actionById.set(repairAction.id, {
        id: repairAction.id,
        label: repairAction.label,
        route: repairAction.route,
        reason: repairAction.reason,
        enabled: workspaceBoundary.isolationState === "scoped",
        source: "objective-truth",
        priority: repairAction.severity === "error" ? 0 : 1,
        proofRef: objectiveTruth.proofId,
        retryToken: null
      });
    }
  }
  for (const recoveryAction of operationalSnapshotRecovery?.actions || []) {
    if (!actionById.has(recoveryAction.id)) {
      actionById.set(recoveryAction.id, {
        id: recoveryAction.id,
        label: recoveryAction.id.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" "),
        route: recoveryAction.route,
        reason: recoveryAction.reason,
        enabled: workspaceBoundary.isolationState === "scoped",
        source: "operational-snapshot-recovery",
        priority: operationalSnapshotRecovery.state === "refresh-required" ? 0 : 1,
        proofRef: operationalSnapshotRecovery.proofId,
        retryToken: null
      });
    }
  }
  for (const commandAction of commandRecovery?.recoveryActions || []) {
    if (!actionById.has(commandAction.id)) {
      actionById.set(commandAction.id, {
        id: commandAction.id,
        label: commandAction.id.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" "),
        route: commandAction.route,
        reason: commandAction.reason,
        enabled: workspaceBoundary.isolationState === "scoped" && commandRecovery.dispatchMode !== "blocked",
        source: "command-health-recovery",
        priority: commandRecovery.healthGate.blocksDispatch ? 0 : commandRecovery.healthGate.backoffActive ? 1 : 2,
        proofRef: commandRecovery.proofId,
        retryToken: commandAction.retryToken || commandRecovery.healthGate.retryToken || null,
        nextAttemptAt: commandAction.nextAttemptAt || commandRecovery.healthGate.nextAttemptAt || null
      });
    }
  }
  const operatorActions = [...actionById.values()].sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
  const findAction = (...ids) => ids.map((id) => actionById.get(id)).find(Boolean) || null;
  const requestedHandoffWorkflow = clientRuntime.intent === "handoff"
    || clientRuntime.workflowStage === "handoff"
    || clientRuntime.workflowStage === "resume"
    || workflowLaunch.requested;
  const workflowGates = [
    {
      id: "kernel-health",
      label: "Kernel health",
      state: operationalHealth.state === "healthy"
        ? "satisfied"
        : operationalHealth.state === "blocked"
          ? "blocked"
          : "review",
      route: operationalHealth.route,
      reason: operationalHealth.actionableErrors[0]?.message || `Hosted-kernel health is ${operationalHealth.state}.`,
      action: findAction("retry-hosted-kernel-health", "refresh-hosted-kernel-health", "refresh-readiness")
    },
    {
      id: "running-jobs",
      label: "Running jobs",
      state: failedJobs.length > 0 || blockedJobs.length > 0
        ? "blocked"
        : attentionJobs.length > 0
          ? "review"
          : activeJobs.length > 0
            ? "pending"
            : "satisfied",
      route: `${workspaceBoundary.routeScope}/jobs`,
      reason: attentionJobs[0]?.blockedReason || (activeJobs.length > 0
        ? `${activeJobs.length} hosted-kernel job(s) are still active.`
        : "No running jobs block the client workflow."),
      action: attentionJobs[0] ? actionById.get(`${attentionJobs[0].actionId}-${attentionJobs[0].id}`) || null : null
    },
    {
      id: "proof-status",
      label: "Proof status",
      state: proofState === "accepted"
        ? "satisfied"
        : proofState === "blocked" || proofState === "incomplete"
          ? "blocked"
          : "pending",
      route: `${workspaceBoundary.routeScope}/validation`,
      reason: proofMissing[0]
        ? `Dashboard proof chain is missing ${proofMissing[0]}.`
        : acceptance.accepted
          ? "Dashboard acceptance proof is available."
          : validationErrors[0]?.message || "Dashboard proof acceptance is pending.",
      action: findAction("resolve-validation", "acknowledge-acceptance", "refresh-readiness")
    },
    {
      id: "client-handoff",
      label: "Client handoff",
      state: !requestedHandoffWorkflow
        ? "not-requested"
        : workflowLaunch.dispatchable
          ? "satisfied"
          : workflowLaunch.state === "blocked"
            ? "blocked"
            : "pending",
      route: workflowLaunch.launchRoute,
      reason: workflowLaunch.blockers[0]?.message || workflowLaunch.userVisible.detail,
      action: findAction("dispatch-hosted-kernel-handoff", "continue-client-workflow", "repair-hosted-kernel-handoff", "resume-handoff")
    }
  ].map((gate) => ({
    contractVersion: "dashboard-operator-workflow-gate.v1",
    id: gate.id,
    label: gate.label,
    state: gate.state,
    route: gate.route,
    reason: gate.reason,
    blocking: gate.state === "blocked",
    userAction: gate.action
      ? {
        id: gate.action.id,
        label: gate.action.label,
        route: gate.action.route,
        enabled: gate.action.enabled,
        reason: gate.action.reason,
        proofRef: gate.action.proofRef || null,
        retryToken: gate.action.retryToken || null
      }
      : null
  }));
  const workflowBlockingGates = workflowGates.filter((gate) => gate.blocking);
  const workflowPendingGates = workflowGates.filter((gate) => gate.state === "pending" || gate.state === "review");
  const workflowReady = workflowBlockingGates.length === 0
    && workflowPendingGates.length === 0
    && (requestedHandoffWorkflow ? workflowLaunch.dispatchable : readiness.state !== "blocked");
  const workflowHandoffQueue = {
    contractVersion: "dashboard-operator-workflow-handoff-queue.v1",
    requestId: clientRuntime.requestId,
    sessionId: clientRuntime.sessionId,
    intent: clientRuntime.intent,
    stage: clientRuntime.workflowStage,
    requested: requestedHandoffWorkflow,
    state: workflowBlockingGates.length > 0
      ? "blocked"
      : workflowReady
        ? "ready"
        : workflowPendingGates.length > 0
          ? "waiting"
          : "idle",
    channel: clientWorkflow.channel,
    returnStrategy: clientWorkflow.returnStrategy,
    returnRoute: clientWorkflow.returnRoute,
    launchRoute: workflowLaunch.launchRoute,
    primaryGateId: workflowBlockingGates[0]?.id || workflowPendingGates[0]?.id || "client-handoff",
    primaryActionId: workflowBlockingGates[0]?.userAction?.id || workflowPendingGates[0]?.userAction?.id || workflowLaunch.userVisible.primaryActionId,
    commandType: workflowLaunch.commandPayload.commandType,
    idempotencyKey: workflowLaunch.commandPayload.idempotencyKey,
    gateCount: workflowGates.length,
    blockingGateCount: workflowBlockingGates.length,
    pendingGateCount: workflowPendingGates.length,
    gates: workflowGates,
    proofId: proofToken({
      requestId: clientRuntime.requestId,
      workspace: workspaceBoundary.workspaceId,
      intent: clientRuntime.intent,
      state: workflowLaunch.state,
      gates: workflowGates.map((gate) => [gate.id, gate.state, gate.userAction?.id || null]),
      launchProofId: workflowLaunch.proofId
    })
  };
  const state = blockers.some((blocker) => blocker.severity === "error")
    ? "blocked"
    : readiness.state === "ready" && attentionJobs.length === 0
      ? "ready"
      : "needs-attention";

  return {
    contractVersion: "dashboard-operator-state-model.v1",
    tenantId: workspaceBoundary.tenantId,
    workspaceId: workspaceBoundary.workspaceId,
    providerId: provider.id,
    state,
    evaluatedAt: now,
    kernel: {
      state: operationalHealth.state,
      observedAt: kernelHealth.observedAt,
      componentSummary: operationalHealth.componentSummary,
      retry: operationalHealth.retry
    },
    jobs: {
      state: jobQueueState,
      total: runningJobs.length,
      active: activeJobs.length,
      completed: completedJobs.length,
      blocked: blockedJobs.length,
      failed: failedJobs.length,
      stale: staleJobs.length,
      overdue: overdueJobs.length,
      attentionRequired: attentionJobs.length,
      highestSeverity: highestJobSeverity,
      staleAfterMs: JOB_STALE_AFTER_MS,
      attentionAfterMs: JOB_ATTENTION_AFTER_MS,
      progressStallAfterMs: JOB_PROGRESS_STALL_AFTER_MS,
      items: runningJobs
    },
    proofStatus: {
      state: proofState,
      missingRefs: proofMissing,
      accepted: acceptance.accepted,
      validationErrorCount: validationErrors.length,
      refs: proofRefs
    },
    objectiveTruth: {
      state: objectiveTruth.state,
      proofId: objectiveTruth.proofId,
      claimCount: objectiveTruth.claimCount,
      gapCount: objectiveTruth.gapCount,
      hardGapCount: objectiveTruth.hardGapCount,
      primaryGap: objectiveTruth.gaps[0] || null,
      repairActions: objectiveTruth.repairActions
    },
    operationalSnapshotRecovery: operationalSnapshotRecovery
      ? {
        state: operationalSnapshotRecovery.state,
        restartSafe: operationalSnapshotRecovery.restartSafe,
        persistedSnapshotPresent: operationalSnapshotRecovery.persistedSnapshotPresent,
        persistedSnapshotAgeMs: operationalSnapshotRecovery.persistedSnapshotAgeMs,
        persistedSnapshotStale: operationalSnapshotRecovery.persistedSnapshotStale,
        persistedScopeState: operationalSnapshotRecovery.persistedScopeState,
        persistedScopeTrusted: operationalSnapshotRecovery.persistedScopeTrusted,
        quarantinedScopeViolationCount: operationalSnapshotRecovery.quarantinedScopeViolationCount,
        quarantinedScopeViolations: operationalSnapshotRecovery.quarantinedScopeViolations,
        driftReasons: operationalSnapshotRecovery.driftReasons,
        changedProofRefs: operationalSnapshotRecovery.changedProofRefs,
        missingActiveJobIds: operationalSnapshotRecovery.missingActiveJobIds,
        newActiveJobIds: operationalSnapshotRecovery.newActiveJobIds,
        actionCount: operationalSnapshotRecovery.actionCount,
        proofId: operationalSnapshotRecovery.proofId,
        route: operationalSnapshotRecovery.route
      }
      : null,
    commandSafety: commandRecovery
      ? {
        state: commandRecovery.dispatchMode,
        restartSafeStatus: commandRecovery.restartSafeStatus,
        dispatchable: commandRecovery.dispatchable,
        degradedDispatch: commandRecovery.degradedDispatch,
        blocker: commandRecovery.dispatchBlocker,
        healthGate: commandRecovery.healthGate,
        recoveryActions: commandRecovery.recoveryActions,
        proofId: commandRecovery.proofId
      }
      : null,
    workflowHandoffQueue,
    blockers,
    blockerCount: blockers.length,
    operatorActions,
    primaryAction: operatorActions[0] || null,
    proofId: proofToken({
      workspace: workspaceBoundary.workspaceId,
      state,
      jobs: runningJobs.map((job) => [job.id, job.state, job.progressPercent]),
      blockers: blockers.map((blocker) => [blocker.id, blocker.severity, blocker.route]),
      proofState,
      readinessState: readiness.state,
      lifecycleActionState: lifecycleActionPlan.state,
      operationalSnapshotRecoveryState: operationalSnapshotRecovery?.state || "unknown",
      operationalSnapshotRecoveryProofId: operationalSnapshotRecovery?.proofId || null,
      objectiveTruthState: objectiveTruth.state,
      objectiveTruthProofId: objectiveTruth.proofId,
      workflowHandoffQueueProofId: workflowHandoffQueue.proofId
    })
  };
}

function buildPreviewAcceptanceSurface({
  clientRuntime,
  workspaceBoundary,
  preview,
  acceptance,
  readiness,
  validationSummary,
  healthValidation,
  workflowLaunch,
  nextSteps,
  objectiveTruth,
  operatorDashboardStateModel,
  stateCheckpoint,
  audit,
  now
}) {
  const severityRank = { error: 3, warning: 2, info: 1 };
  const visiblePanels = preview.panels.filter((panel) => panel.status !== "unavailable");
  const blockingFindings = validationSummary.findings.filter((finding) => finding.severity === "error");
  const warningFindings = validationSummary.findings.filter((finding) => finding.severity === "warning");
  const sortedFindings = [...validationSummary.findings].sort((left, right) => (
    (severityRank[right.severity] || 0) - (severityRank[left.severity] || 0)
  ));
  const acknowledgementRequired = clientRuntime.acknowledgementRequired || clientRuntime.intent === "acceptance";
  const acceptanceBlocked = !acceptance.accepted && (blockingFindings.length > 0 || acceptance.blockedBy.length > 0);
  const previewBlocked = preview.visible && visiblePanels.length === 0;
  const routeBlocked = workspaceBoundary.isolationState === "blocked" || workflowLaunch.state === "blocked";
  const readyForAcknowledgement = acceptance.accepted && acknowledgementRequired;
  const readyForPreview = preview.visible && !previewBlocked && readiness.state !== "blocked";
  const readyForDispatch = workflowLaunch.dispatchable && acceptance.accepted && readiness.state === "ready";
  const surfaceState = routeBlocked || acceptanceBlocked || previewBlocked || objectiveTruth.state === "blocked"
    ? "blocked"
    : readyForDispatch
      ? "dispatch-ready"
      : readyForAcknowledgement
        ? "acceptance-ready"
        : readiness.state === "degraded" || warningFindings.length > 0 || objectiveTruth.state === "degraded"
          ? "needs-review"
          : readyForPreview
            ? "preview-ready"
            : "pending";
  const recommendedStep = nextSteps.steps.find((step) => step.id === nextSteps.primaryAction) || nextSteps.steps[0] || null;
  const primaryRoute = readyForDispatch
    ? workflowLaunch.launchRoute
    : readyForAcknowledgement
      ? acceptance.submitRoute
      : recommendedStep?.route || `${workspaceBoundary.routeScope}/preview`;
  const primaryActionId = readyForDispatch
    ? "launch-hosted-kernel-workflow"
    : readyForAcknowledgement
      ? "acknowledge-acceptance"
      : recommendedStep?.id || "open-dashboard-preview";
  const blockers = [
    workspaceBoundary.isolationState === "blocked" ? {
      code: "workspace_boundary_blocked",
      message: workspaceBoundary.reason || "Workspace boundary is blocked.",
      route: `${workspaceBoundary.routeScope}/boundary`
    } : null,
    previewBlocked ? {
      code: "preview_panels_unavailable",
      message: "No requested preview panels can be shown for the current capability boundary.",
      route: `${workspaceBoundary.routeScope}/preview`
    } : null,
    acceptanceBlocked ? {
      code: "acceptance_blocked",
      message: blockingFindings[0]?.message || `Acceptance is blocked by ${acceptance.blockedBy.join(", ")}.`,
      route: acceptance.submitRoute
    } : null,
    workflowLaunch.state === "blocked" ? {
      code: "workflow_launch_blocked",
      message: workflowLaunch.blockers[0]?.message || "Workflow launch is blocked.",
      route: workflowLaunch.launchRoute
    } : null,
    objectiveTruth.state === "blocked" ? {
      code: "objective_truth_blocked",
      message: objectiveTruth.gaps[0]?.message || "Objective truth checks are blocked.",
      route: objectiveTruth.route
    } : null
  ].filter(Boolean);
  const validationBadges = [
    {
      id: "validation-errors",
      label: "Errors",
      value: blockingFindings.length,
      state: blockingFindings.length > 0 ? "blocked" : "clear"
    },
    {
      id: "validation-warnings",
      label: "Warnings",
      value: warningFindings.length,
      state: warningFindings.length > 0 ? "review" : "clear"
    },
    {
      id: "health-validation",
      label: "Health validation",
      value: healthValidation.state,
      state: healthValidation.state === "valid" ? "clear" : healthValidation.state
    },
    {
      id: "proof-status",
      label: "Proof status",
      value: operatorDashboardStateModel.proofStatus.state,
      state: operatorDashboardStateModel.proofStatus.state
    }
  ];
  const previewPanels = preview.panels.map((panel) => ({
    id: panel.id,
    status: panel.status,
    visible: panel.status !== "unavailable",
    actionable: panel.status === "ready" || panel.status === "degraded",
    route: panel.route,
    refreshCursor: panel.refreshCursor
  }));
  const workflowQueue = operatorDashboardStateModel.workflowHandoffQueue;

  return {
    contractVersion: "dashboard-preview-acceptance-surface.v1",
    requestId: clientRuntime.requestId,
    sessionId: clientRuntime.sessionId,
    tenantId: workspaceBoundary.tenantId,
    workspaceId: workspaceBoundary.workspaceId,
    state: surfaceState,
    evaluatedAt: now,
    userVisible: {
      title: surfaceState === "dispatch-ready"
        ? "Dashboard ready to launch"
        : surfaceState === "acceptance-ready"
          ? "Acceptance ready"
          : surfaceState === "blocked"
            ? "Dashboard blocked"
            : surfaceState === "needs-review"
              ? "Review dashboard warnings"
              : "Dashboard preview ready",
      detail: blockers[0]?.message || sortedFindings[0]?.message || recommendedStep?.reason || "Preview, readiness, validation, and acceptance are available for this request.",
      primaryActionId,
      primaryRoute,
      workflowGateId: workflowQueue.primaryGateId,
      workflowGateState: workflowQueue.state
    },
    preview: {
      visible: preview.visible,
      requestedAudience: preview.audience,
      detail: preview.detail,
      readyPanelCount: preview.readyPanelCount,
      degradedPanelCount: preview.degradedPanelCount,
      visiblePanelCount: visiblePanels.length,
      panels: previewPanels
    },
    acceptance: {
      state: acceptance.accepted ? "accepted" : acceptanceBlocked ? "blocked" : "pending",
      accepted: acceptance.accepted,
      acknowledgementRequired,
      acknowledgementEnabled: readyForAcknowledgement,
      token: acceptance.acceptanceToken,
      blockedBy: acceptance.blockedBy,
      submitRoute: acceptance.submitRoute
    },
    readiness: {
      state: readiness.state,
      score: readiness.score,
      maxScore: readiness.maxScore,
      route: readiness.route,
      retryToken: readiness.retryToken
    },
    workflowQueue: {
      state: workflowQueue.state,
      requested: workflowQueue.requested,
      channel: workflowQueue.channel,
      returnStrategy: workflowQueue.returnStrategy,
      launchRoute: workflowQueue.launchRoute,
      primaryGateId: workflowQueue.primaryGateId,
      primaryActionId: workflowQueue.primaryActionId,
      commandType: workflowQueue.commandType,
      blockingGateCount: workflowQueue.blockingGateCount,
      pendingGateCount: workflowQueue.pendingGateCount,
      gates: workflowQueue.gates.map((gate) => ({
        id: gate.id,
        label: gate.label,
        state: gate.state,
        route: gate.route,
        reason: gate.reason,
        actionId: gate.userAction?.id || null,
        actionEnabled: gate.userAction?.enabled === true
      })),
      proofId: workflowQueue.proofId
    },
    validation: {
      ok: validationSummary.ok,
      findingCount: validationSummary.findingCount,
      blockingFindingCount: blockingFindings.length,
      warningFindingCount: warningFindings.length,
      topFinding: sortedFindings[0] || null,
      badges: validationBadges
    },
    blockers,
    blockerCount: blockers.length,
    nextStep: recommendedStep
      ? {
        id: recommendedStep.id,
        label: recommendedStep.label,
        reason: recommendedStep.reason,
        route: recommendedStep.route,
        proofRef: recommendedStep.proofRef || null,
        retryToken: recommendedStep.retryToken || null
      }
      : null,
    routeContracts: {
      previewRoute: `${workspaceBoundary.routeScope}/preview`,
      readinessRoute: readiness.route,
      validationRoute: `${workspaceBoundary.routeScope}/validation`,
      acceptanceRoute: acceptance.submitRoute,
      launchRoute: workflowLaunch.launchRoute,
      checkpointRoute: stateCheckpoint.writeRoute
    },
    proofRefs: {
      auditProofId: audit.proofId,
      checkpointWriteId: stateCheckpoint.writeId,
      objectiveTruthProofId: objectiveTruth.proofId,
      operatorDashboardProofId: operatorDashboardStateModel.proofId,
      healthValidationProofId: healthValidation.proofId,
      acceptanceToken: acceptance.acceptanceToken
    },
    proofId: proofToken({
      requestId: clientRuntime.requestId,
      workspace: workspaceBoundary.workspaceId,
      state: surfaceState,
      primaryActionId,
      primaryRoute,
      previewPanels: previewPanels.map((panel) => [panel.id, panel.status]),
      acceptanceAccepted: acceptance.accepted,
      readinessState: readiness.state,
      findingCount: validationSummary.findingCount,
      checkpointWriteId: stateCheckpoint.writeId
    })
  };
}

export function describeDashboardModelSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const provider = normalizeProvider(input.provider);
  const workspaceBoundary = normalizeWorkspaceBoundary(input, now);
  const capabilityNegotiation = negotiateCapabilities(input.capabilities, workspaceBoundary);
  const syncMetadata = buildSyncMetadata(input, now);
  const handoff = normalizeExternalHandoff(input, provider, capabilityNegotiation, workspaceBoundary);
  const kernelHealth = normalizeKernelHealth(input, now);
  const operationalHealth = buildOperationalHealthContract({
    provider,
    capabilityNegotiation,
    syncMetadata,
    handoff,
    workspaceBoundary,
    kernelHealth,
    now
  });
  const healthValidation = buildHealthValidationEnvelope({
    provider,
    capabilityNegotiation,
    workspaceBoundary,
    kernelHealth,
    operationalHealth,
    now
  });
  const previewRequest = normalizePreviewRequest(input);
  const clientRuntime = normalizeClientRuntime(input, now);
  const clientWorkflow = normalizeClientWorkflowState(input, clientRuntime, handoff, previewRequest, workspaceBoundary, now);
  const persistedState = normalizePersistedDashboardState(input, now, workspaceBoundary);
  const command = normalizeCommand(input, clientRuntime, persistedState);
  const lifecycleSettings = normalizeLifecycleSettings(input, now);
  const lifecycleControl = buildLifecycleControlContract({
    lifecycleSettings,
    command,
    syncMetadata,
    operationalHealth,
    workspaceBoundary,
    now
  });
  const lifecycleActionPlan = buildLifecycleActionPlan({
    lifecycleSettings,
    lifecycleControl,
    command,
    syncMetadata,
    workspaceBoundary,
    operationalHealth,
    now
  });
  const providerServiceContract = buildProviderServiceContract({
    provider,
    capabilityNegotiation,
    syncMetadata,
    handoff,
    workspaceBoundary,
    operationalHealth,
    lifecycleControl,
    clientRuntime,
    clientWorkflow,
    now
  });
  const cliRunStatusBridge = normalizeCliRunStatusBridge(input, workspaceBoundary, syncMetadata, now);
  const cliRunExportHandoff = normalizeCliRunDashboardExportHandoff(input, workspaceBoundary, syncMetadata, now);
  const mailchimpCampaignHandoff = normalizeMailchimpCampaignHandoff(input, workspaceBoundary, syncMetadata, operationalHealth, now);
  const baseValidationSummary = buildValidationSummary({
    provider,
    capabilityNegotiation,
    syncMetadata,
    handoff,
    previewRequest,
    clientRuntime,
    clientWorkflow,
    workspaceBoundary,
    operationalHealth,
    healthValidation,
    lifecycleControl,
    providerServiceContract,
    cliRunStatusBridge,
    cliRunExportHandoff,
    mailchimpCampaignHandoff
  });
  const audit = buildAuditProof({
    provider,
    capabilityNegotiation,
    syncMetadata,
    clientRuntime,
    workspaceBoundary,
    providerServiceContract,
    evidence: input.evidence,
    now
  });
  const baseAcceptance = buildAcceptanceContract({
    provider,
    capabilityNegotiation,
    syncMetadata,
    handoff,
    validationSummary: baseValidationSummary,
    operationalHealth,
    providerServiceContract,
    audit,
    workspaceBoundary,
    mailchimpCampaignHandoff
  });
  const recovery = buildRestartRecoveryContract({
    persistedState,
    syncMetadata,
    clientRuntime,
    acceptance: baseAcceptance
  });
  const commandRecovery = buildCommandRecoveryDecision({
    command,
    persistedState,
    recovery,
    clientRuntime,
    workspaceBoundary,
    syncMetadata,
    operationalHealth,
    healthValidation,
    now
  });
  const commandOutcome = buildCommandOutcome({
    command,
    persistedState,
    recovery,
    acceptance: baseAcceptance,
    handoff,
    workspaceBoundary,
    lifecycleControl,
    commandRecovery
  });
  const runningJobs = normalizeRunningJobs(input, workspaceBoundary, syncMetadata, now);
  const processActionPressure = normalizeProcessActionPressure(input, workspaceBoundary, syncMetadata, now);
  const recoveryProofRefs = {
    auditProofId: audit.proofId,
    healthProofId: operationalHealth.proofId,
    healthValidationProofId: healthValidation.proofId,
    providerServiceProofId: providerServiceContract.proofId,
    commandRecoveryProofId: commandRecovery.proofId,
    acceptanceToken: baseAcceptance.acceptanceToken
  };
  const recoveryBlockers = [
    workspaceBoundary.isolationState === "blocked" ? {
      id: "workspace-boundary",
      severity: "error",
      message: workspaceBoundary.reason || "Workspace boundary is blocked.",
      route: `${workspaceBoundary.routeScope}/boundary`
    } : null,
    operationalHealth.state === "blocked" ? {
      id: "kernel-health",
      severity: "error",
      message: operationalHealth.actionableErrors.find((error) => error.severity === "error")?.message || "Hosted-kernel health blocks dashboard service.",
      route: operationalHealth.route
    } : null,
    healthValidation.state === "blocked" ? {
      id: "health-validation",
      severity: "error",
      message: healthValidation.findings.find((finding) => finding.severity === "error")?.message || "Hosted-kernel health validation is blocked.",
      route: healthValidation.route
    } : null,
    providerServiceContract.state === "blocked" ? {
      id: "provider-services",
      severity: "error",
      message: providerServiceContract.providerCompatibility.blockers[0]?.message || "Provider service contract is blocked.",
      route: providerServiceContract.bindingRoute
    } : null,
    commandOutcome.state === "blocked" ? {
      id: "command-outcome",
      severity: "error",
      message: commandOutcome.blockedReason || "Dashboard command was blocked.",
      route: `${workspaceBoundary.routeScope}/commands/${encodeURIComponent(commandOutcome.commandId)}`
    } : null,
    processActionPressure.blockedCount > 0 ? {
      id: "process-action-pressure",
      severity: "error",
      message: processActionPressure.primaryAction?.message || "Process action queue has blocking entries.",
      route: processActionPressure.route
    } : null,
    cliRunStatusBridge.state === "scope-blocked" || cliRunStatusBridge.state === "blocked" ? {
      id: "cli-run-status-bridge",
      severity: "error",
      message: cliRunStatusBridge.primaryAction.reason || "cli-run status bridge blocks dashboard dispatch.",
      route: cliRunStatusBridge.primaryAction.route
    } : null,
    cliRunExportHandoff.state === "scope-blocked" || cliRunExportHandoff.state === "invalid" ? {
      id: "cli-run-export-handoff",
      severity: "error",
      message: cliRunExportHandoff.reason,
      route: cliRunExportHandoff.action?.route || `${workspaceBoundary.routeScope}/analytics/cli-run/export`
    } : null,
    mailchimpCampaignHandoff.state === "scope-blocked" || mailchimpCampaignHandoff.state === "blocked" || mailchimpCampaignHandoff.state === "export-blocked" ? {
      id: "mailchimp-campaign-handoff",
      severity: "error",
      message: mailchimpCampaignHandoff.deliveryReadiness.reason,
      route: mailchimpCampaignHandoff.action.route
    } : null
  ].filter(Boolean);
  const operationalSnapshotRecovery = buildOperationalSnapshotRecovery({
    persistedState,
    operationalHealth,
    runningJobs,
    proofRefs: recoveryProofRefs,
    blockers: recoveryBlockers,
    workspaceBoundary,
    now
  });
  const validationSummary = buildValidationSummary({
    provider,
    capabilityNegotiation,
    syncMetadata,
    handoff,
    previewRequest,
    clientRuntime,
    clientWorkflow,
    workspaceBoundary,
    operationalHealth,
    healthValidation,
    lifecycleControl,
    providerServiceContract,
    recovery,
    operationalSnapshotRecovery,
    commandRecovery,
    commandOutcome,
    processActionPressure,
    cliRunStatusBridge,
    cliRunExportHandoff,
    mailchimpCampaignHandoff
  });
  const acceptance = buildAcceptanceContract({
    provider,
    capabilityNegotiation,
    syncMetadata,
    handoff,
    validationSummary,
    operationalHealth,
    providerServiceContract,
    audit,
    workspaceBoundary,
    mailchimpCampaignHandoff
  });
  const readiness = buildReadinessContract({
    provider,
    capabilityNegotiation,
    syncMetadata,
    validationSummary,
    acceptance,
    operationalHealth,
    healthValidation,
    lifecycleControl,
    providerServiceContract,
    recovery,
    operationalSnapshotRecovery,
    commandRecovery,
    commandOutcome,
    processActionPressure,
    cliRunStatusBridge,
    mailchimpCampaignHandoff,
    workspaceBoundary
  });
  const stateCheckpoint = buildPersistedStateEnvelope({
    provider,
    syncMetadata,
    clientRuntime,
    workspaceBoundary,
    readiness,
    acceptance,
    recovery,
    operationalSnapshotRecovery,
    runningJobs,
    operationalHealth,
    proofRefs: recoveryProofRefs,
    blockers: recoveryBlockers,
    command,
    commandOutcome,
    persistedState,
    now
  });
  const preview = buildDashboardPreview({
    provider,
    capabilityNegotiation,
    syncMetadata,
    handoff,
    previewRequest,
    validationSummary,
    operationalHealth,
    workspaceBoundary
  });
  const workflowHandoff = buildWorkflowHandoffContract({
    clientRuntime,
    clientWorkflow,
    workspaceBoundary,
    handoff,
    preview,
    acceptance,
    readiness
  });
  const handoffEnvelope = buildHostedKernelHandoffEnvelope({
    provider,
    clientRuntime,
    clientWorkflow,
    workspaceBoundary,
    handoff,
    readiness,
    acceptance,
    providerServiceContract,
    stateCheckpoint,
    workflowHandoff,
    now
  });
  const workflowLaunch = buildClientWorkflowLaunchContract({
    clientRuntime,
    clientWorkflow,
    workspaceBoundary,
    readiness,
    acceptance,
    workflowHandoff,
    handoffEnvelope,
    providerServiceContract,
    stateCheckpoint,
    now
  });
  const nextSteps = buildNextStepContract({
    handoff,
    validationSummary,
    acceptance,
    readiness,
    operationalHealth,
    healthValidation,
    lifecycleControl,
    lifecycleActionPlan,
    processActionPressure,
    cliRunStatusBridge,
    cliRunExportHandoff,
    mailchimpCampaignHandoff,
    workflowHandoff,
    handoffEnvelope,
    workspaceBoundary
  });
  const clientRouteContract = buildClientRouteContract({
    clientRuntime,
    clientWorkflow,
    workspaceBoundary,
    preview,
    acceptance,
    readiness,
    validationSummary,
    healthValidation,
    lifecycleActionPlan,
    nextSteps,
    workflowHandoff,
    handoffEnvelope,
    workflowLaunch,
    providerServiceContract,
    cliRunStatusBridge,
    audit,
    stateCheckpoint
  });
  const operatorEventStream = buildOperatorEventStreamContract({
    clientRuntime,
    clientWorkflow,
    workspaceBoundary,
    syncMetadata,
    operationalHealth,
    healthValidation,
    lifecycleControl,
    validationSummary,
    commandOutcome,
    stateCheckpoint,
    workflowHandoff,
    handoffEnvelope,
    acceptance,
    readiness,
    audit,
    nextSteps
  });
  const objectiveTruth = buildObjectiveTruthContract({
    workspaceBoundary,
    capabilityNegotiation,
    operationalHealth,
    healthValidation,
    providerServiceContract,
    lifecycleControl,
    commandRecovery,
    commandOutcome,
    stateCheckpoint,
    acceptance,
    readiness,
    validationSummary,
    operatorEventStream,
    audit,
    now
  });
  const operatorDashboardStateModel = buildOperatorDashboardStateModel({
    input,
    clientRuntime,
    clientWorkflow,
    provider,
    workspaceBoundary,
    syncMetadata,
    kernelHealth,
    operationalHealth,
    healthValidation,
    providerServiceContract,
    lifecycleControl,
    lifecycleActionPlan,
    operationalSnapshotRecovery,
    runningJobs,
    commandRecovery,
    commandOutcome,
    stateCheckpoint,
    workflowLaunch,
    acceptance,
    readiness,
    validationSummary,
    nextSteps,
    audit,
    operatorEventStream,
    objectiveTruth,
    now
  });
  const previewAcceptanceSurface = buildPreviewAcceptanceSurface({
    clientRuntime,
    workspaceBoundary,
    preview,
    acceptance,
    readiness,
    validationSummary,
    healthValidation,
    workflowLaunch,
    nextSteps,
    objectiveTruth,
    operatorDashboardStateModel,
    stateCheckpoint,
    audit,
    now
  });
  const analyticsReporting = buildAnalyticsReportingContract({
    input,
    clientRuntime,
    workspaceBoundary,
    syncMetadata,
    operationalHealth,
    healthValidation,
    lifecycleControl,
    validationSummary,
    commandOutcome,
    stateCheckpoint,
    workflowHandoff,
    handoffEnvelope,
    preview,
    acceptance,
    readiness,
    operatorEventStream,
    audit,
    now
  });

  return {
    ok: true,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: {
      kind: "hosted-kernel-dashboard-provider",
      version: "dashboard-model.v1",
      provider,
      clientRuntime,
      clientWorkflow,
      workspaceBoundary,
      capabilities: capabilityNegotiation,
      sync: syncMetadata,
      kernelHealth,
      operationalHealth,
      healthValidation,
      providerServiceContract,
      lifecycleSettings,
      lifecycleControl,
      lifecycleActionPlan,
      persistedState,
      recovery,
      operationalSnapshotRecovery,
      command,
      commandRecovery,
      commandOutcome,
      processActionPressure,
      cliRunStatusBridge,
      mailchimpCampaignHandoff,
      stateCheckpoint,
      handoff,
      workflowHandoff,
      handoffEnvelope,
      workflowLaunch,
      preview,
      acceptance,
      readiness,
      validation: validationSummary,
      nextSteps,
      objectiveTruth,
      operatorDashboardStateModel,
      previewAcceptanceSurface,
      clientRouteContract,
      operatorEventStream,
      analyticsReporting
    },
    dashboardState: {
      availability: capabilityNegotiation.granted.includes("dashboard.read") ? "available" : "degraded",
      kernelStatus: capabilityNegotiation.granted.includes("kernel.status.read") ? "observable" : "unavailable",
      providerMode: provider.mode,
      tenantId: workspaceBoundary.tenantId,
      workspaceId: workspaceBoundary.workspaceId,
      isolationState: workspaceBoundary.isolationState,
      permissionState: workspaceBoundary.permissionState,
      safeToPersistBoundary: workspaceBoundary.safeToPersist,
      boundaryProof: workspaceBoundary.boundaryProof,
      permissionProof: workspaceBoundary.permissionProof,
      unsupportedPermissions: workspaceBoundary.unsupportedPermissions,
      missingRequiredPermissions: workspaceBoundary.missingRequiredPermissions,
      handoffMissingPermissions: workspaceBoundary.handoffMissingPermissions,
      lastSyncedAt: syncMetadata.generatedAt,
      nextSyncCursor: syncMetadata.nextCursor,
      persistedWriteId: stateCheckpoint.writeId,
      persistedStateStatus: stateCheckpoint.status,
      persistedSnapshotProof: stateCheckpoint.snapshotProof,
      persistedCommandHistoryCount: stateCheckpoint.commandHistoryCount,
      persistedCommandHistoryLimit: stateCheckpoint.retainedCommandHistoryLimit,
      persistedIdempotentReplay: stateCheckpoint.idempotentReplay,
      recoveryState: recovery.state,
      recoveryReplayRequired: recovery.replayRequired,
      recoveryPaths: recovery.recoveryPaths,
      recoveryCommandLedgerProof: recovery.checkpoint.commandLedgerProof,
      persistedOperationalSnapshotPresent: persistedState.operationalSnapshot.present,
      persistedOperationalSnapshotStale: persistedState.operationalSnapshot.stale,
      persistedOperationalSnapshotAgeMs: persistedState.operationalSnapshot.ageMs,
      persistedOperationalSnapshotScopeState: persistedState.operationalSnapshot.scopeState,
      persistedOperationalSnapshotScopeTrusted: persistedState.operationalSnapshot.scopeTrusted,
      persistedOperationalSnapshotQuarantinedScopeViolationCount: persistedState.operationalSnapshot.quarantinedScopeViolationCount,
      persistedOperationalSnapshotQuarantinedProofRefCount: persistedState.operationalSnapshot.quarantinedProofRefCount,
      persistedOperationalSnapshotProof: persistedState.operationalSnapshot.snapshotProof,
      operationalSnapshotRecoveryState: operationalSnapshotRecovery.state,
      operationalSnapshotRestartSafe: operationalSnapshotRecovery.restartSafe,
      operationalSnapshotRecoveryProofId: operationalSnapshotRecovery.proofId,
      operationalSnapshotRecoveryActionCount: operationalSnapshotRecovery.actionCount,
      operationalSnapshotRecoveryScopeState: operationalSnapshotRecovery.persistedScopeState,
      operationalSnapshotRecoveryScopeTrusted: operationalSnapshotRecovery.persistedScopeTrusted,
      operationalSnapshotRecoveryQuarantinedScopeViolationCount: operationalSnapshotRecovery.quarantinedScopeViolationCount,
      operationalHealthState: operationalHealth.state,
      healthValidationState: healthValidation.state,
      healthValidationProofId: healthValidation.proofId,
      healthValidationFindingCount: healthValidation.findingCount,
      healthObservationAgeMs: healthValidation.ageMs,
      healthErrorBudgetExceeded: healthValidation.errorBudget.exceeded,
      providerServiceState: providerServiceContract.state,
      providerServiceProofId: providerServiceContract.proofId,
      providerApiVersion: providerServiceContract.providerApiVersion,
      providerCompatibilityState: providerServiceContract.providerCompatibility.compatible ? "compatible" : "incompatible",
      providerCompatibilityBlockerCount: providerServiceContract.providerCompatibility.blockerCount,
      providerContractBlockedServiceIds: providerServiceContract.contractBlockedServiceIds,
      providerDeclaredServiceVersions: providerServiceContract.declaredServiceVersions,
      providerReadyServiceCount: providerServiceContract.readyServiceCount,
      providerBlockedServiceIds: providerServiceContract.blockedServiceIds,
      providerDegradedServiceIds: providerServiceContract.degradedServiceIds,
      providerBindingRoute: providerServiceContract.bindingRoute,
      providerHandoffPrepared: providerServiceContract.handoffPrepared,
      degradedModeActive: operationalHealth.degradedModeActive,
      healthRetryable: operationalHealth.retry.retryable,
      healthRetryBackoffMs: operationalHealth.retry.backoffMs,
      healthActionableErrorCount: operationalHealth.actionableErrors.length,
      lifecycleState: lifecycleControl.state,
      lifecycleEnabled: lifecycleControl.enabled,
      lifecycleCommandAllowed: lifecycleControl.commandAllowed,
      lifecycleNextScheduledAt: lifecycleControl.schedule.nextScheduledAt,
      lifecycleNextActionId: lifecycleControl.nextActionId,
      lifecycleActionPlanState: lifecycleActionPlan.state,
      lifecyclePrimaryActionId: lifecycleActionPlan.primaryAction.id,
      lifecycleRequestedActionValid: lifecycleActionPlan.requestedActionValid,
      lifecycleScheduleValidationState: lifecycleActionPlan.scheduleControls.validationState,
      lifecycleAuditProofId: lifecycleActionPlan.audit.proofId,
      commandState: commandOutcome.state,
      commandRecoveryMode: commandRecovery.dispatchMode,
      commandRecoveryRestartSafeStatus: commandRecovery.restartSafeStatus,
      commandRecoveryProofId: commandRecovery.proofId,
      commandRecoveryActionCount: commandRecovery.recoveryActions.length,
      commandRecoveryHealthGateState: commandRecovery.healthGate.state,
      commandRecoveryHealthGateBackoffActive: commandRecovery.healthGate.backoffActive,
      commandRecoveryHealthGateNextAttemptAt: commandRecovery.healthGate.nextAttemptAt,
      commandRecoveryDegradedDispatch: commandRecovery.degradedDispatch,
      processActionPressureState: processActionPressure.state,
      processActionPressureReadyCount: processActionPressure.readyCount,
      processActionPressureBlockedCount: processActionPressure.blockedCount,
      processActionPressureRetryReadyCount: processActionPressure.retryReadyCount,
      processActionPressureHandoffReadyCount: processActionPressure.handoffReadyCount,
      processActionPressureReadOnly: processActionPressure.readOnly,
      processActionPressurePrimaryAction: processActionPressure.primaryAction?.action || null,
      processActionPressurePrimaryPid: processActionPressure.primaryAction?.pid || null,
      processActionPressureProofId: processActionPressure.proofId,
      cliRunStatusBridgeState: cliRunStatusBridge.state,
      cliRunStatusBridgeProofId: cliRunStatusBridge.proofId,
      cliRunStatusBridgePresent: cliRunStatusBridge.present,
      cliRunStatusCommandId: cliRunStatusBridge.commandId,
      cliRunStatusRequestId: cliRunStatusBridge.requestId,
      cliRunStatusRestartSafeStatus: cliRunStatusBridge.restartSafeStatus,
      cliRunStatusRecoveryRequired: cliRunStatusBridge.recoveryRequired,
      cliRunStatusSafeResume: cliRunStatusBridge.safeResume,
      cliRunStatusSafeRetry: cliRunStatusBridge.safeRetry,
      cliRunStatusSafeHandoff: cliRunStatusBridge.safeHandoff,
      cliRunStatusPrimaryAction: cliRunStatusBridge.primaryAction.id,
      cliRunStatusPrimaryRoute: cliRunStatusBridge.primaryAction.route,
      cliRunExportHandoffState: cliRunExportHandoff.state,
      cliRunExportHandoffAccepted: cliRunExportHandoff.accepted,
      cliRunExportHandoffProofId: cliRunExportHandoff.proofId,
      cliRunExportHandoffRunId: cliRunExportHandoff.runId || null,
      cliRunExportHandoffEpoch: cliRunExportHandoff.epoch || 0,
      cliRunExportHandoffAgeMs: cliRunExportHandoff.ageMs,
      cliRunExportHandoffExportRows: cliRunExportHandoff.counters?.exportRows || 0,
      cliRunExportHandoffHistorySnapshots: cliRunExportHandoff.counters?.historySnapshots || 0,
      cliRunExportHandoffTimelineEvents: cliRunExportHandoff.counters?.timelineEvents || 0,
      cliRunExportHandoffValidationCodes: cliRunExportHandoff.validationCodes || [],
      cliRunExportHandoffActionId: cliRunExportHandoff.action?.id || null,
      cliRunExportHandoffActionRoute: cliRunExportHandoff.action?.route || null,
      commandIdempotencyKey: command.idempotencyKey,
      commandDuplicate: commandOutcome.duplicate,
      commandDuplicateReason: commandOutcome.duplicateReason,
      readinessState: readiness.state,
      acceptanceState: acceptance.accepted ? "accepted" : "pending",
      activeRequestId: clientRuntime.requestId,
      clientIntent: clientRuntime.intent,
      clientWorkflowState: clientWorkflow.state,
      clientWorkflowChannel: clientWorkflow.channel,
      clientWorkflowReturnRoute: clientWorkflow.returnRoute,
      clientWorkflowProofId: clientWorkflow.proofId,
      workflowState: workflowHandoff.state,
      workflowDeliveryRoute: workflowHandoff.deliveryRoute,
      workflowHandoffInstructionMode: workflowHandoff.handoffInstruction?.mode || null,
      handoffEnvelopeState: handoffEnvelope.state,
      handoffEnvelopeDispatchable: handoffEnvelope.dispatchable,
      handoffEnvelopeProofId: handoffEnvelope.proofId,
      handoffEnvelopeDestinationRoute: handoffEnvelope.destinationRoute,
      handoffEnvelopePrimaryActionId: handoffEnvelope.userVisible.primaryActionId,
      handoffTenantClaimProof: handoffEnvelope.payload.tenantScopedClaim?.claimProof || null,
      workflowLaunchState: workflowLaunch.state,
      workflowLaunchDispatchable: workflowLaunch.dispatchable,
      workflowLaunchRoute: workflowLaunch.launchRoute,
      workflowLaunchPrimaryActionId: workflowLaunch.userVisible.primaryActionId,
      workflowLaunchProofId: workflowLaunch.proofId,
      workflowLaunchBlockerCount: workflowLaunch.blockerCount,
      previewPanelCount: preview.panels.length,
      previewReadyPanelCount: preview.readyPanelCount,
      previewPrimaryPanelId: clientRouteContract.previewCards[0]?.id || null,
      validationFindingCount: validationSummary.findingCount,
      validationErrorCount: clientRouteContract.validationDigest.findingCounts.error,
      primaryNextStep: nextSteps.primaryAction,
      primaryNextStepRoute: clientRouteContract.primaryAction?.route || null,
      clientRouteProofId: clientRouteContract.proofId,
      eventStreamCursor: operatorEventStream.cursor,
      eventStreamProofId: operatorEventStream.proofId,
      operatorEventCount: operatorEventStream.eventCount,
      blockingOperatorEventCount: operatorEventStream.blockingEventCount,
      primaryOperatorEventId: operatorEventStream.primaryEventId,
      objectiveTruthState: objectiveTruth.state,
      objectiveTruthProofId: objectiveTruth.proofId,
      objectiveTruthClaimCount: objectiveTruth.claimCount,
      objectiveTruthGapCount: objectiveTruth.gapCount,
      objectiveTruthHardGapCount: objectiveTruth.hardGapCount,
      objectiveTruthPrimaryGapId: objectiveTruth.gaps[0]?.id || null,
      objectiveTruthPrimaryRepairActionId: objectiveTruth.repairActions[0]?.id || null,
      objectiveTruthMissingProofRefCount: objectiveTruth.missingProofRefs.length,
      operatorDashboardState: operatorDashboardStateModel.state,
      operatorDashboardProofId: operatorDashboardStateModel.proofId,
      operatorDashboardBlockerCount: operatorDashboardStateModel.blockerCount,
      operatorDashboardPrimaryActionId: operatorDashboardStateModel.primaryAction?.id || null,
      operatorDashboardJobQueueState: operatorDashboardStateModel.jobs.state,
      operatorDashboardRunningJobCount: operatorDashboardStateModel.jobs.total,
      operatorDashboardActiveJobCount: operatorDashboardStateModel.jobs.active,
      operatorDashboardCompletedJobCount: operatorDashboardStateModel.jobs.completed,
      operatorDashboardBlockedJobCount: operatorDashboardStateModel.jobs.blocked,
      operatorDashboardFailedJobCount: operatorDashboardStateModel.jobs.failed,
      operatorDashboardStaleJobCount: operatorDashboardStateModel.jobs.stale,
      operatorDashboardOverdueJobCount: operatorDashboardStateModel.jobs.overdue,
      operatorDashboardJobAttentionCount: operatorDashboardStateModel.jobs.attentionRequired,
      operatorDashboardJobHighestSeverity: operatorDashboardStateModel.jobs.highestSeverity,
      operatorDashboardProofState: operatorDashboardStateModel.proofStatus.state,
      operatorDashboardProofMissingRefCount: operatorDashboardStateModel.proofStatus.missingRefs.length,
      operatorDashboardWorkflowQueueState: operatorDashboardStateModel.workflowHandoffQueue.state,
      operatorDashboardWorkflowQueueProofId: operatorDashboardStateModel.workflowHandoffQueue.proofId,
      operatorDashboardWorkflowPrimaryGateId: operatorDashboardStateModel.workflowHandoffQueue.primaryGateId,
      operatorDashboardWorkflowPrimaryActionId: operatorDashboardStateModel.workflowHandoffQueue.primaryActionId,
      operatorDashboardWorkflowBlockingGateCount: operatorDashboardStateModel.workflowHandoffQueue.blockingGateCount,
      operatorDashboardWorkflowPendingGateCount: operatorDashboardStateModel.workflowHandoffQueue.pendingGateCount,
      operatorDashboardWorkflowCommandType: operatorDashboardStateModel.workflowHandoffQueue.commandType,
      operatorDashboardCommandSafetyState: operatorDashboardStateModel.commandSafety.state,
      operatorDashboardCommandSafetyDispatchable: operatorDashboardStateModel.commandSafety.dispatchable,
      operatorDashboardCommandSafetyDegradedDispatch: operatorDashboardStateModel.commandSafety.degradedDispatch,
      previewAcceptanceSurfaceState: previewAcceptanceSurface.state,
      previewAcceptanceSurfaceProofId: previewAcceptanceSurface.proofId,
      previewAcceptancePrimaryActionId: previewAcceptanceSurface.userVisible.primaryActionId,
      previewAcceptancePrimaryRoute: previewAcceptanceSurface.userVisible.primaryRoute,
      previewAcceptanceWorkflowGateState: previewAcceptanceSurface.userVisible.workflowGateState,
      previewAcceptanceWorkflowGateId: previewAcceptanceSurface.userVisible.workflowGateId,
      previewAcceptanceBlockerCount: previewAcceptanceSurface.blockerCount,
      previewAcceptanceVisiblePanelCount: previewAcceptanceSurface.preview.visiblePanelCount,
      previewAcceptanceBlockingFindingCount: previewAcceptanceSurface.validation.blockingFindingCount,
      previewAcceptanceAcknowledgementEnabled: previewAcceptanceSurface.acceptance.acknowledgementEnabled,
      analyticsReportState: analyticsReporting.reportState,
      analyticsSnapshotCount: analyticsReporting.counters.snapshotCount,
      analyticsHistorySnapshotCount: analyticsReporting.counters.historySnapshotCount,
      analyticsPermissionBoundaryBlocks: analyticsReporting.counters.permissionBoundaryBlocks,
      analyticsExportFormats: analyticsReporting.exportSummary.formats,
      analyticsExportRowCount: analyticsReporting.exportSummary.rowCount,
      analyticsExportColumnCount: analyticsReporting.exportSummary.columnCount,
      analyticsLatestSnapshotId: analyticsReporting.timelineState.latestSnapshotId,
      analyticsPreviousSnapshotId: analyticsReporting.timelineState.previousSnapshotId,
      analyticsReadinessTransitions: analyticsReporting.timelineState.transitions,
      analyticsObservedWindowMs: analyticsReporting.timelineState.observedWindow.durationMs,
      analyticsHistoryLimitApplied: analyticsReporting.timelineState.observedWindow.boundedByHistoryLimit,
      analyticsLatestReadinessChanged: analyticsReporting.timelineState.latestDelta.readinessChanged,
      analyticsLatestBlockingEventDelta: analyticsReporting.timelineState.latestDelta.blockingEventDelta,
      analyticsProofId: analyticsReporting.proofId,
      mailchimpCampaignHandoffState: mailchimpCampaignHandoff.state,
      mailchimpCampaignHandoffAccepted: mailchimpCampaignHandoff.accepted,
      mailchimpCampaignHandoffSourceContract: mailchimpCampaignHandoff.sourceContract,
      mailchimpCampaignRetryable: mailchimpCampaignHandoff.retry.retryable,
      mailchimpCampaignActionId: mailchimpCampaignHandoff.action.id,
      mailchimpCampaignProofId: mailchimpCampaignHandoff.proofId,
      mailchimpExportReadinessState: mailchimpCampaignHandoff.exportReadiness.state,
      mailchimpExportReadinessAccepted: mailchimpCampaignHandoff.exportReadiness.accepted,
      mailchimpExportAttachableRecords: mailchimpCampaignHandoff.exportReadiness.counters.attachableRecords,
      mailchimpExportPackageId: mailchimpCampaignHandoff.exportReadiness.package.exportId,
      mailchimpExportPackageProofDigest: mailchimpCampaignHandoff.exportReadiness.package.proofDigest
    },
    audit,
    kernelHealth,
    operationalHealth,
    healthValidation,
    providerServiceContract,
    lifecycleSettings,
    lifecycleControl,
    lifecycleActionPlan,
    clientRuntime,
    clientWorkflow,
    workspaceBoundary,
    persistedState,
    recovery,
    operationalSnapshotRecovery,
    command,
    commandRecovery,
    commandOutcome,
    processActionPressure,
    cliRunStatusBridge,
    cliRunExportHandoff,
    mailchimpCampaignHandoff,
    stateCheckpoint,
    workflowHandoff,
    handoffEnvelope,
    workflowLaunch,
    preview,
    acceptance,
    readiness,
    validation: validationSummary,
    nextSteps,
    objectiveTruth,
    operatorDashboardStateModel,
    previewAcceptanceSurface,
    clientRouteContract,
    operatorEventStream,
    analyticsReporting
  };
}

export default describeDashboardModelSurface;
