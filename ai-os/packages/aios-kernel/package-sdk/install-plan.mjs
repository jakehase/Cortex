export const surfaceId = "aios_package-sdk_install-plan_092";
export const surfaceGroup = "package-sdk";
export const surfaceName = "install-plan";

const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_BASE_BACKOFF_MS = 750;
const DEFAULT_MAX_BACKOFF_MS = 12000;
const DEFAULT_MAINTENANCE_WINDOW_MINUTES = 30;
const MIN_MAINTENANCE_WINDOW_MINUTES = 5;
const MAX_MAINTENANCE_WINDOW_MINUTES = 240;
const DEFAULT_PREVIEW_STEP_LIMIT = 8;
const MAX_PREVIEW_STEP_LIMIT = 25;
const LIFECYCLE_COMMANDS = new Set([
  "prepare",
  "enable",
  "disable",
  "schedule",
  "resume",
  "rollback",
  "audit"
]);
const LIFECYCLE_COMMAND_EFFECTS = {
  prepare: "shape hosted-kernel install state without dispatching package mutations",
  enable: "dispatch accepted package install steps to eligible hosted-kernel providers",
  disable: "stop new install-plan dispatches while preserving restart-safe checkpoints",
  schedule: "reserve the configured maintenance window for hosted-kernel package dispatch",
  resume: "continue retryable or checkpointed install steps with the current idempotency key",
  rollback: "dispatch rollback handling for failed required install steps",
  audit: "emit package, provider, workspace, and lifecycle proof without mutating install state"
};
const LIFECYCLE_MODES = new Set(["manual", "scheduled", "auto"]);
const DISABLE_DRAIN_MODES = new Set(["drain", "immediate", "hold"]);
const RESUME_SELECTION_POLICIES = new Set(["retryable-only", "checkpointed", "all-restart-safe"]);
const RETRYABLE_FAILURES = new Set([
  "network",
  "registry_unavailable",
  "hosted_kernel_busy",
  "timeout",
  "lock_contention",
  "rate_limited"
]);

const REQUIRED_HOSTED_KERNEL_CAPABILITIES = [
  "packageFetch",
  "integrityVerify",
  "planAudit"
];
const PROVIDER_CONTRACT_STATES = new Set(["active", "paused", "degraded", "revoked"]);
const HANDOFF_STATES = new Set(["none", "pending", "sent", "acknowledged", "failed"]);
const PROVIDER_HANDOFF_PROTOCOLS = new Set(["hosted-kernel-rpc", "https", "webhook", "queue"]);
const PROVIDER_ENDPOINT_AUTH_MODES = new Set(["boundary-token", "signed-request", "mtls", "none"]);
const CLIENT_WORKFLOW_STATES = new Set(["draft", "previewed", "accepted", "submitted", "cancelled"]);
const OPERATIONAL_SERVICE_STATES = new Set(["healthy", "degraded", "down", "unknown"]);
const PERSISTED_COMMAND_STATES = new Set(["pending", "running", "succeeded", "failed", "cancelled"]);
const RESTART_SAFE_STEP_STATUSES = new Set(["pending", "running", "failed"]);
const TERMINAL_STEP_STATUSES = new Set(["completed", "succeeded", "skipped", "cancelled"]);
const ANALYTICS_EXPORT_FORMATS = new Set(["json", "ndjson", "csv"]);
const ANALYTICS_EXPORT_DESTINATIONS = new Set(["client-download", "audit-sink", "kernel-reporting", "provider-handoff"]);
const ANALYTICS_EXPORT_REDACTION_MODES = new Set(["summary", "internal", "none"]);
const DEFAULT_TIMELINE_EXPORT_LIMIT = 50;
const MAX_TIMELINE_EXPORT_LIMIT = 250;
const REQUIRED_OPERATIONAL_SERVICES = ["kernel", "registry", "attestation"];
const WORKSPACE_SCOPE_MODES = new Set(["single-workspace", "tenant-shared", "kernel-admin"]);
const INSTALL_PLAN_PERMISSIONS = new Set([
  "package.install.preview",
  "package.install.accept",
  "package.install.dispatch",
  "package.install.audit",
  "package.install.rollback"
]);
const ROLE_PERMISSION_GRANTS = {
  viewer: ["package.install.preview"],
  developer: ["package.install.preview", "package.install.accept", "package.install.audit"],
  operator: [
    "package.install.preview",
    "package.install.accept",
    "package.install.dispatch",
    "package.install.audit",
    "package.install.rollback"
  ],
  admin: [
    "package.install.preview",
    "package.install.accept",
    "package.install.dispatch",
    "package.install.audit",
    "package.install.rollback"
  ]
};
const DEFAULT_PROVIDER_SERVICES = {
  registry: ["packageFetch", "integrityVerify"],
  attestation: ["integrityVerify", "planAudit"],
  orchestrator: ["planAudit"]
};
const COMMAND_SERVICE_REQUIREMENTS = {
  prepare: ["registry"],
  enable: ["registry", "attestation"],
  disable: ["orchestrator"],
  schedule: ["registry", "attestation", "orchestrator"],
  resume: ["registry"],
  rollback: ["orchestrator", "attestation"],
  audit: ["attestation"]
};
const SERVICE_ROUTE_FALLBACKS = {
  registry: ["orchestrator", "attestation"],
  attestation: ["orchestrator"],
  orchestrator: ["registry"]
};
const OPERATIONAL_SERVICE_RECOVERY_ACTIONS = {
  kernel: {
    down: "Restore hosted-kernel command admission before package-provider handoff.",
    degraded: "Keep the plan in preview or audit mode until kernel command admission is healthy.",
    unknown: "Refresh the hosted-kernel probe before dispatching lifecycle commands."
  },
  registry: {
    down: "Restore package registry reachability before package fetch or resume.",
    degraded: "Allow audit preview only; wait for registry health before enable or resume.",
    unknown: "Refresh registry health before promoting package fetch work."
  },
  attestation: {
    down: "Restore attestation verification before integrity-sensitive package install.",
    degraded: "Use degraded preview only and require checksums before enable.",
    unknown: "Refresh attestation health before accepting install proof."
  }
};

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeStep(step, index) {
  const id = typeof step?.id === "string" && step.id.trim() ? step.id.trim() : `step-${index + 1}`;
  const action = typeof step?.action === "string" && step.action.trim() ? step.action.trim() : "install";
  const packageName = typeof step?.packageName === "string" && step.packageName.trim()
    ? step.packageName.trim()
    : null;
  const version = typeof step?.version === "string" && step.version.trim() ? step.version.trim() : null;
  const attempts = Number.isInteger(step?.attempts) && step.attempts >= 0 ? step.attempts : 0;
  const status = typeof step?.status === "string" && step.status.trim() ? step.status.trim() : "pending";
  const failureCode = typeof step?.failureCode === "string" && step.failureCode.trim()
    ? step.failureCode.trim()
    : null;
  const required = step?.required !== false;

  return {
    id,
    action,
    packageName,
    version,
    status,
    required,
    attempts,
    failureCode,
    checksum: typeof step?.checksum === "string" && step.checksum.trim() ? step.checksum.trim() : null
  };
}

function normalizeProviderContract(contract, index) {
  const service = typeof contract?.service === "string" && contract.service.trim()
    ? contract.service.trim()
    : "registry";
  const contractId = typeof contract?.contractId === "string" && contract.contractId.trim()
    ? contract.contractId.trim()
    : typeof contract?.id === "string" && contract.id.trim()
      ? contract.id.trim()
      : `provider-${index + 1}`;
  const providerId = typeof contract?.providerId === "string" && contract.providerId.trim()
    ? contract.providerId.trim()
    : contractId;
  const requiredCapabilities = asArray(contract?.requiredCapabilities)
    .filter((capability) => typeof capability === "string" && capability.trim())
    .map((capability) => capability.trim());
  const optionalCapabilities = asArray(contract?.optionalCapabilities)
    .filter((capability) => typeof capability === "string" && capability.trim())
    .map((capability) => capability.trim());
  const defaultCapabilities = DEFAULT_PROVIDER_SERVICES[service] || [];
  const handoffState = HANDOFF_STATES.has(contract?.handoffState) ? contract.handoffState : "none";
  const tenantId = typeof contract?.tenantId === "string" && contract.tenantId.trim()
    ? contract.tenantId.trim()
    : typeof contract?.scope?.tenantId === "string" && contract.scope.tenantId.trim()
      ? contract.scope.tenantId.trim()
      : null;
  const workspaceId = typeof contract?.workspaceId === "string" && contract.workspaceId.trim()
    ? contract.workspaceId.trim()
    : typeof contract?.scope?.workspaceId === "string" && contract.scope.workspaceId.trim()
      ? contract.scope.workspaceId.trim()
      : null;
  const serviceEndpoint = normalizeProviderServiceEndpoint(contract, service);

  return {
    contractId,
    providerId,
    service,
    tenantId,
    workspaceId,
    tenantScoped: contract?.tenantScoped === true || Boolean(tenantId),
    workspaceScoped: contract?.workspaceScoped === true || Boolean(workspaceId),
    allowTenantSharedUse: contract?.allowTenantSharedUse === true,
    state: PROVIDER_CONTRACT_STATES.has(contract?.state) ? contract.state : "active",
    requiredCapabilities: requiredCapabilities.length ? requiredCapabilities : defaultCapabilities,
    optionalCapabilities,
    syncCursor: typeof contract?.syncCursor === "string" && contract.syncCursor.trim()
      ? contract.syncCursor.trim()
      : null,
    lastSyncedAt: typeof contract?.lastSyncedAt === "string" && contract.lastSyncedAt.trim()
      ? contract.lastSyncedAt.trim()
      : null,
    handoffState,
    handoffRef: typeof contract?.handoffRef === "string" && contract.handoffRef.trim()
      ? contract.handoffRef.trim()
      : null,
    serviceEndpoint,
    requiresServiceEndpoint: contract?.requiresServiceEndpoint === true
  };
}

function normalizeProviderServiceEndpoint(contract, service) {
  const endpointSource = contract?.serviceEndpoint && typeof contract.serviceEndpoint === "object"
    ? contract.serviceEndpoint
    : contract?.handoffEndpoint && typeof contract.handoffEndpoint === "object"
      ? contract.handoffEndpoint
      : contract?.endpoints && typeof contract.endpoints === "object" && contract.endpoints[service]
        ? typeof contract.endpoints[service] === "string"
          ? { url: contract.endpoints[service] }
          : contract.endpoints[service]
        : null;

  if (!endpointSource) return null;

  const url = typeof endpointSource.url === "string" && endpointSource.url.trim()
    ? endpointSource.url.trim()
    : typeof endpointSource.href === "string" && endpointSource.href.trim()
      ? endpointSource.href.trim()
      : null;
  const method = typeof endpointSource.method === "string" && endpointSource.method.trim()
    ? endpointSource.method.trim().toUpperCase()
    : "POST";
  const requestedProtocol = typeof endpointSource.protocol === "string" && endpointSource.protocol.trim()
    ? endpointSource.protocol.trim()
    : url?.startsWith("https://")
      ? "https"
      : "hosted-kernel-rpc";
  const requestedAuthMode = typeof endpointSource.authMode === "string" && endpointSource.authMode.trim()
    ? endpointSource.authMode.trim()
    : "boundary-token";

  return {
    url,
    method,
    protocol: PROVIDER_HANDOFF_PROTOCOLS.has(requestedProtocol) ? requestedProtocol : "hosted-kernel-rpc",
    authMode: PROVIDER_ENDPOINT_AUTH_MODES.has(requestedAuthMode) ? requestedAuthMode : "boundary-token",
    timeoutMs: Number.isInteger(endpointSource.timeoutMs) && endpointSource.timeoutMs > 0
      ? endpointSource.timeoutMs
      : null,
    supportsAcknowledgement: endpointSource.supportsAcknowledgement !== false,
    acknowledgementRoute: typeof endpointSource.acknowledgementRoute === "string"
      && endpointSource.acknowledgementRoute.trim()
      ? endpointSource.acknowledgementRoute.trim()
      : null
  };
}

function normalizeProviderContracts(input = {}) {
  const rawContracts = [
    ...asArray(input.providerContracts),
    ...asArray(input.providers),
    ...asArray(input.serviceContracts)
  ];

  if (rawContracts.length) {
    return rawContracts.map(normalizeProviderContract);
  }

  return [{
    contractId: "hosted-kernel-default-registry",
    providerId: "hosted-kernel-default-registry",
    service: "registry",
    tenantId: null,
    workspaceId: null,
    tenantScoped: false,
    workspaceScoped: false,
    allowTenantSharedUse: false,
    state: "active",
    requiredCapabilities: DEFAULT_PROVIDER_SERVICES.registry,
    optionalCapabilities: [],
    syncCursor: null,
    lastSyncedAt: null,
    handoffState: "none",
    handoffRef: null,
    serviceEndpoint: null,
    requiresServiceEndpoint: false
  }];
}

function normalizeClientRequest(input = {}) {
  const request = input.request && typeof input.request === "object"
    ? input.request
    : input.clientRequest && typeof input.clientRequest === "object"
      ? input.clientRequest
      : {};
  const client = request.client && typeof request.client === "object"
    ? request.client
    : input.client && typeof input.client === "object"
      ? input.client
      : {};
  const workflow = request.workflow && typeof request.workflow === "object"
    ? request.workflow
    : input.workflow && typeof input.workflow === "object"
      ? input.workflow
      : {};
  const requestId = typeof request.requestId === "string" && request.requestId.trim()
    ? request.requestId.trim()
    : typeof input.requestId === "string" && input.requestId.trim()
      ? input.requestId.trim()
      : null;
  const clientId = typeof client.clientId === "string" && client.clientId.trim()
    ? client.clientId.trim()
    : typeof request.clientId === "string" && request.clientId.trim()
      ? request.clientId.trim()
      : null;
  const sessionId = typeof client.sessionId === "string" && client.sessionId.trim()
    ? client.sessionId.trim()
    : typeof request.sessionId === "string" && request.sessionId.trim()
      ? request.sessionId.trim()
      : null;
  const route = typeof request.route === "string" && request.route.trim()
    ? request.route.trim()
    : typeof input.route === "string" && input.route.trim()
      ? input.route.trim()
      : "package-sdk/install-plan";

  return {
    requestId,
    clientId,
    sessionId,
    route,
    source: typeof request.source === "string" && request.source.trim() ? request.source.trim() : "client-runtime",
    intent: typeof request.intent === "string" && request.intent.trim() ? request.intent.trim() : "install-package-plan",
    actorId: typeof client.actorId === "string" && client.actorId.trim()
      ? client.actorId.trim()
      : typeof request.actorId === "string" && request.actorId.trim()
        ? request.actorId.trim()
        : null,
    correlationId: typeof request.correlationId === "string" && request.correlationId.trim()
      ? request.correlationId.trim()
      : requestId,
    workflow: {
      state: CLIENT_WORKFLOW_STATES.has(workflow.state) ? workflow.state : "draft",
      currentView: typeof workflow.currentView === "string" && workflow.currentView.trim()
        ? workflow.currentView.trim()
        : "install-plan-preview",
      returnTo: typeof workflow.returnTo === "string" && workflow.returnTo.trim() ? workflow.returnTo.trim() : null,
      handoffTarget: typeof workflow.handoffTarget === "string" && workflow.handoffTarget.trim()
        ? workflow.handoffTarget.trim()
        : "hosted-kernel-runtime",
      handoffToken: typeof workflow.handoffToken === "string" && workflow.handoffToken.trim()
        ? workflow.handoffToken.trim()
        : null
    }
  };
}

function normalizeWorkspaceScope(input = {}) {
  const source = input.workspaceScope && typeof input.workspaceScope === "object"
    ? input.workspaceScope
    : input.scope && typeof input.scope === "object"
      ? input.scope
      : {};
  const actor = source.actor && typeof source.actor === "object"
    ? source.actor
    : input.actor && typeof input.actor === "object"
      ? input.actor
      : {};
  const workspaceId = typeof source.workspaceId === "string" && source.workspaceId.trim()
    ? source.workspaceId.trim()
    : typeof input.workspaceId === "string" && input.workspaceId.trim()
      ? input.workspaceId.trim()
      : null;
  const tenantId = typeof source.tenantId === "string" && source.tenantId.trim()
    ? source.tenantId.trim()
    : typeof input.tenantId === "string" && input.tenantId.trim()
      ? input.tenantId.trim()
      : null;
  const roles = asArray(source.roles || actor.roles || input.roles)
    .filter((role) => typeof role === "string" && role.trim())
    .map((role) => role.trim());
  const explicitPermissions = asArray(source.permissions || actor.permissions || input.permissions)
    .filter((permission) => typeof permission === "string" && permission.trim())
    .map((permission) => permission.trim());
  const grantedPermissions = new Set(explicitPermissions);

  for (const role of roles) {
    for (const permission of ROLE_PERMISSION_GRANTS[role] || []) {
      grantedPermissions.add(permission);
    }
  }

  return {
    tenantId,
    workspaceId,
    scopeMode: WORKSPACE_SCOPE_MODES.has(source.scopeMode) ? source.scopeMode : "single-workspace",
    actorId: typeof actor.actorId === "string" && actor.actorId.trim()
      ? actor.actorId.trim()
      : typeof source.actorId === "string" && source.actorId.trim()
        ? source.actorId.trim()
        : null,
    roles,
    permissions: [...grantedPermissions].sort(),
    requestedPermissions: asArray(source.requestedPermissions)
      .filter((permission) => typeof permission === "string" && permission.trim())
      .map((permission) => permission.trim()),
    boundaryToken: typeof source.boundaryToken === "string" && source.boundaryToken.trim()
      ? source.boundaryToken.trim()
      : null,
    auditSink: typeof source.auditSink === "string" && source.auditSink.trim()
      ? source.auditSink.trim()
      : "tenant-audit-log",
    allowCrossWorkspaceProviders: source.allowCrossWorkspaceProviders === true
  };
}

function normalizeLifecycleSettings(settings = {}) {
  const lifecycle = settings && typeof settings === "object" ? settings : {};
  const mode = LIFECYCLE_MODES.has(lifecycle.mode) ? lifecycle.mode : "manual";
  const disableDrainMode = DISABLE_DRAIN_MODES.has(lifecycle.disableDrainMode)
    ? lifecycle.disableDrainMode
    : lifecycle.drainBeforeDisable === false
      ? "immediate"
      : "drain";
  const resumeSelectionPolicy = RESUME_SELECTION_POLICIES.has(lifecycle.resumeSelectionPolicy)
    ? lifecycle.resumeSelectionPolicy
    : "retryable-only";
  const requestedCommand = typeof lifecycle.requestedCommand === "string" && lifecycle.requestedCommand.trim()
    ? lifecycle.requestedCommand.trim()
    : null;

  return {
    enabled: lifecycle.enabled !== false,
    mode,
    requestedCommand,
    allowAutoEnable: lifecycle.allowAutoEnable === true,
    allowAutoDisable: lifecycle.allowAutoDisable === true,
    scheduledAt: typeof lifecycle.scheduledAt === "string" && lifecycle.scheduledAt.trim()
      ? lifecycle.scheduledAt.trim()
      : null,
    timezone: typeof lifecycle.timezone === "string" && lifecycle.timezone.trim()
      ? lifecycle.timezone.trim()
      : "UTC",
    maintenanceWindowMinutes: Number.isInteger(lifecycle.maintenanceWindowMinutes)
      ? lifecycle.maintenanceWindowMinutes
      : DEFAULT_MAINTENANCE_WINDOW_MINUTES,
    scheduleJitterMinutes: Number.isInteger(lifecycle.scheduleJitterMinutes) && lifecycle.scheduleJitterMinutes >= 0
      ? lifecycle.scheduleJitterMinutes
      : 0,
    maxScheduleDriftMinutes: Number.isInteger(lifecycle.maxScheduleDriftMinutes) && lifecycle.maxScheduleDriftMinutes >= 0
      ? lifecycle.maxScheduleDriftMinutes
      : 5,
    drainBeforeDisable: lifecycle.drainBeforeDisable !== false,
    disableDrainMode,
    disableReason: typeof lifecycle.disableReason === "string" && lifecycle.disableReason.trim()
      ? lifecycle.disableReason.trim()
      : null,
    enableRequiresAcceptance: lifecycle.enableRequiresAcceptance !== false,
    requireAuditBeforeEnable: lifecycle.requireAuditBeforeEnable !== false,
    resumeSelectionPolicy
  };
}

function normalizePreviewSettings(input = {}) {
  const preview = input.preview && typeof input.preview === "object" ? input.preview : {};
  const requestedLimit = Number.isInteger(preview.stepLimit) ? preview.stepLimit : DEFAULT_PREVIEW_STEP_LIMIT;

  return {
    includeOptionalSteps: preview.includeOptionalSteps !== false,
    includeProviderDetail: preview.includeProviderDetail !== false,
    requireExplicitAcceptance: preview.requireExplicitAcceptance !== false,
    stepLimit: Math.min(Math.max(requestedLimit, 1), MAX_PREVIEW_STEP_LIMIT),
    acceptedBy: typeof input.acceptedBy === "string" && input.acceptedBy.trim()
      ? input.acceptedBy.trim()
      : typeof preview.acceptedBy === "string" && preview.acceptedBy.trim()
        ? preview.acceptedBy.trim()
        : null,
    acceptanceToken: typeof input.acceptanceToken === "string" && input.acceptanceToken.trim()
      ? input.acceptanceToken.trim()
      : typeof preview.acceptanceToken === "string" && preview.acceptanceToken.trim()
        ? preview.acceptanceToken.trim()
        : null
  };
}

function normalizeAnalyticsExportRequest(input = {}) {
  const source = input.analyticsExport && typeof input.analyticsExport === "object"
    ? input.analyticsExport
    : input.export?.analytics && typeof input.export.analytics === "object"
      ? input.export.analytics
      : input.reporting?.export && typeof input.reporting.export === "object"
        ? input.reporting.export
        : {};
  const requestedFormat = typeof source.format === "string" && source.format.trim()
    ? source.format.trim()
    : "json";
  const requestedDestination = typeof source.destination === "string" && source.destination.trim()
    ? source.destination.trim()
    : "audit-sink";
  const requestedRedactionMode = typeof source.redactionMode === "string" && source.redactionMode.trim()
    ? source.redactionMode.trim()
    : "summary";
  const requestedTimelineLimit = Number.isInteger(source.timelineLimit)
    ? source.timelineLimit
    : DEFAULT_TIMELINE_EXPORT_LIMIT;

  return {
    enabled: source.enabled !== false,
    format: ANALYTICS_EXPORT_FORMATS.has(requestedFormat) ? requestedFormat : "json",
    destination: ANALYTICS_EXPORT_DESTINATIONS.has(requestedDestination) ? requestedDestination : "audit-sink",
    includeCounters: source.includeCounters !== false,
    includeHistory: source.includeHistory !== false,
    includeTimeline: source.includeTimeline !== false,
    includeProviderRoutes: source.includeProviderRoutes === true,
    includeCommandEnvelopeRefs: source.includeCommandEnvelopeRefs === true,
    redactionMode: ANALYTICS_EXPORT_REDACTION_MODES.has(requestedRedactionMode) ? requestedRedactionMode : "summary",
    timelineLimit: Math.min(Math.max(requestedTimelineLimit, 0), MAX_TIMELINE_EXPORT_LIMIT),
    requestedBy: typeof source.requestedBy === "string" && source.requestedBy.trim()
      ? source.requestedBy.trim()
      : null,
    exportRef: typeof source.exportRef === "string" && source.exportRef.trim() ? source.exportRef.trim() : null
  };
}

function normalizeOperationalService(service, index) {
  const serviceName = typeof service?.service === "string" && service.service.trim()
    ? service.service.trim()
    : typeof service?.name === "string" && service.name.trim()
      ? service.name.trim()
      : `service-${index + 1}`;
  const state = OPERATIONAL_SERVICE_STATES.has(service?.state) ? service.state : "unknown";

  return {
    service: serviceName,
    state,
    required: service?.required !== false,
    latencyMs: Number.isFinite(service?.latencyMs) && service.latencyMs >= 0 ? service.latencyMs : null,
    lastCheckedAt: typeof service?.lastCheckedAt === "string" && service.lastCheckedAt.trim()
      ? service.lastCheckedAt.trim()
      : null,
    errorCode: typeof service?.errorCode === "string" && service.errorCode.trim()
      ? service.errorCode.trim()
      : null,
    retryAfterMs: Number.isInteger(service?.retryAfterMs) && service.retryAfterMs >= 0
      ? service.retryAfterMs
      : null
  };
}

function normalizeOperationalHealth(input = {}) {
  const source = input.operationalHealth && typeof input.operationalHealth === "object"
    ? input.operationalHealth
    : input.health?.operational && typeof input.health.operational === "object"
      ? input.health.operational
      : {};
  const serviceRecords = Array.isArray(source.services)
    ? source.services
    : source.services && typeof source.services === "object"
      ? Object.entries(source.services).map(([service, value]) => ({
        service,
        ...(value && typeof value === "object" ? value : { state: value })
      }))
      : [];
  const normalizedServices = serviceRecords.map(normalizeOperationalService);
  const serviceNames = new Set(normalizedServices.map((service) => service.service));

  for (const service of REQUIRED_OPERATIONAL_SERVICES) {
    if (!serviceNames.has(service)) {
      normalizedServices.push({
        service,
        state: "unknown",
        required: true,
        latencyMs: null,
        lastCheckedAt: null,
        errorCode: null,
        retryAfterMs: null
      });
    }
  }

  return {
    status: normalizedServices.some((service) => service.state === "down" && service.required)
      ? "outage"
      : normalizedServices.some((service) => ["degraded", "unknown"].includes(service.state) && service.required)
        ? "degraded"
        : "healthy",
    observedAt: typeof source.observedAt === "string" && source.observedAt.trim()
      ? source.observedAt.trim()
      : null,
    source: typeof source.source === "string" && source.source.trim() ? source.source.trim() : "hosted-kernel-health",
    services: normalizedServices
  };
}

function parseTime(value) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

function validateLifecycleSettings({ settings, steps, now }) {
  const errors = [];
  const warnings = [];

  if (settings.requestedCommand && !LIFECYCLE_COMMANDS.has(settings.requestedCommand)) {
    errors.push({
      code: "LIFECYCLE_COMMAND_UNSUPPORTED",
      message: `Lifecycle command '${settings.requestedCommand}' is not supported for install plans.`,
      action: "Use prepare, enable, disable, schedule, resume, rollback, or audit."
    });
  }

  if (settings.maintenanceWindowMinutes < MIN_MAINTENANCE_WINDOW_MINUTES) {
    errors.push({
      code: "MAINTENANCE_WINDOW_TOO_SHORT",
      message: "Install-plan maintenance windows must allow enough time for package fetch and integrity verification.",
      action: `Set maintenanceWindowMinutes to at least ${MIN_MAINTENANCE_WINDOW_MINUTES}.`
    });
  }

  if (settings.maintenanceWindowMinutes > MAX_MAINTENANCE_WINDOW_MINUTES) {
    warnings.push({
      code: "MAINTENANCE_WINDOW_LONG",
      message: "Install-plan maintenance window is longer than the hosted-kernel default guardrail.",
      action: `Consider a window of ${MAX_MAINTENANCE_WINDOW_MINUTES} minutes or less unless the rollout is intentionally staged.`
    });
  }

  if (settings.scheduleJitterMinutes > settings.maintenanceWindowMinutes) {
    errors.push({
      code: "SCHEDULE_JITTER_EXCEEDS_WINDOW",
      message: "Schedule jitter cannot be larger than the install-plan maintenance window.",
      action: "Keep scheduleJitterMinutes within maintenanceWindowMinutes so provider handoff remains auditable."
    });
  }

  if (settings.maxScheduleDriftMinutes > settings.maintenanceWindowMinutes) {
    warnings.push({
      code: "SCHEDULE_DRIFT_EXCEEDS_WINDOW",
      message: "Allowed schedule drift is larger than the maintenance window.",
      action: "Reduce maxScheduleDriftMinutes so delayed hosted-kernel dispatches are not mistaken for an active window."
    });
  }

  if (!settings.enabled && settings.requestedCommand && settings.requestedCommand !== "audit") {
    errors.push({
      code: "LIFECYCLE_COMMAND_DISABLED",
      message: "Lifecycle controls are disabled for mutating install-plan commands.",
      action: "Enable lifecycleSettings.enabled or request audit while controls remain disabled."
    });
  }

  if (settings.disableDrainMode === "immediate" && !settings.disableReason) {
    warnings.push({
      code: "IMMEDIATE_DISABLE_REASON_MISSING",
      message: "Immediate disable mode should carry an operator reason for audit proof.",
      action: "Set lifecycleSettings.disableReason before bypassing drain on running package steps."
    });
  }

  if (settings.mode === "scheduled") {
    const scheduledTime = parseTime(settings.scheduledAt);
    const nowTime = parseTime(now);
    if (!scheduledTime) {
      errors.push({
        code: "SCHEDULED_AT_REQUIRED",
        message: "Scheduled lifecycle mode requires a valid scheduledAt timestamp.",
        action: "Set lifecycleSettings.scheduledAt to an ISO timestamp."
      });
    } else if (nowTime !== null && scheduledTime <= nowTime) {
      errors.push({
        code: "SCHEDULED_AT_PAST",
        message: "Scheduled lifecycle command cannot target a past maintenance window.",
        action: "Move scheduledAt to a future ISO timestamp before dispatching the plan."
      });
    }
  }

  if (settings.requestedCommand === "enable" && settings.requireAuditBeforeEnable) {
    const unauditedSteps = steps.filter((step) => step.action === "install" && (!step.version || !step.checksum));
    if (unauditedSteps.length) {
      warnings.push({
        code: "ENABLE_REQUIRES_AUDITABLE_STEPS",
        message: "Enable command is waiting on pinned versions and checksums for install steps.",
        action: "Pin versions and attach checksums, or relax requireAuditBeforeEnable for a degraded rollout.",
        stepIds: unauditedSteps.map((step) => step.id)
      });
    }
  }

  if (!settings.enabled && steps.some((step) => step.status === "running")) {
    warnings.push({
      code: "DISABLE_WITH_RUNNING_STEPS",
      message: "Install-plan controls are disabled while one or more steps are still running.",
      action: "Drain running steps before disabling lifecycle execution."
    });
  }

  return { errors, warnings };
}

function validateProviderContracts({ providerContracts, hostedCapabilities, now }) {
  const errors = [];
  const warnings = [];
  const seenContracts = new Set();
  const nowTime = parseTime(now);

  for (const contract of providerContracts) {
    if (seenContracts.has(contract.contractId)) {
      errors.push({
        code: "PROVIDER_CONTRACT_DUPLICATE",
        contractId: contract.contractId,
        message: "Provider service contracts must have stable unique contract ids.",
        action: "Assign a unique contractId for each package provider integration."
      });
    }
    seenContracts.add(contract.contractId);

    if (contract.state === "revoked") {
      errors.push({
        code: "PROVIDER_CONTRACT_REVOKED",
        contractId: contract.contractId,
        message: "A revoked provider contract cannot participate in hosted-kernel package installs.",
        action: "Reconnect the provider or remove the revoked contract from the plan input."
      });
    }

    const missingCapabilities = contract.requiredCapabilities.filter((capability) => !hostedCapabilities.has(capability));
    if (missingCapabilities.length) {
      errors.push({
        code: "PROVIDER_CAPABILITY_NEGOTIATION_FAILED",
        contractId: contract.contractId,
        providerId: contract.providerId,
        message: `Provider contract requires missing hosted-kernel capabilities: ${missingCapabilities.join(", ")}.`,
        action: "Enable the missing hosted-kernel capabilities or bind a provider contract with a compatible service profile.",
        missingCapabilities
      });
    }

    if (contract.state === "paused") {
      warnings.push({
        code: "PROVIDER_CONTRACT_PAUSED",
        contractId: contract.contractId,
        message: "Provider contract is paused; package sync can be audited but not handed off for execution.",
        action: "Resume the provider contract before enabling the install plan."
      });
    }

    const syncedAt = parseTime(contract.lastSyncedAt);
    if (contract.syncCursor && !syncedAt) {
      warnings.push({
        code: "PROVIDER_SYNC_TIMESTAMP_MISSING",
        contractId: contract.contractId,
        message: "Provider contract supplied a sync cursor without a valid lastSyncedAt timestamp.",
        action: "Attach lastSyncedAt so audit exports can prove provider catalog freshness."
      });
    } else if (syncedAt !== null && nowTime !== null && syncedAt > nowTime) {
      warnings.push({
        code: "PROVIDER_SYNC_CLOCK_SKEW",
        contractId: contract.contractId,
        message: "Provider sync timestamp is later than the install-plan generation time.",
        action: "Check provider clock skew before dispatching the external handoff."
      });
    }

    if (contract.handoffState === "failed") {
      warnings.push({
        code: "PROVIDER_HANDOFF_FAILED",
        contractId: contract.contractId,
        message: "Previous external provider handoff failed for this contract.",
        action: "Replay the handoff after provider connectivity and package integrity are verified."
      });
    }

    if (contract.serviceEndpoint) {
      if (!contract.serviceEndpoint.url) {
        warnings.push({
          code: "PROVIDER_ENDPOINT_URL_MISSING",
          contractId: contract.contractId,
          providerId: contract.providerId,
          message: "Provider service endpoint is declared without a routable URL.",
          action: "Attach serviceEndpoint.url or remove the endpoint contract until the provider handoff route is known."
        });
      } else if (contract.serviceEndpoint.protocol === "https" && !contract.serviceEndpoint.url.startsWith("https://")) {
        warnings.push({
          code: "PROVIDER_ENDPOINT_PROTOCOL_MISMATCH",
          contractId: contract.contractId,
          providerId: contract.providerId,
          message: "Provider service endpoint protocol is https but the URL is not an HTTPS URL.",
          action: "Use an https:// endpoint or set the provider endpoint protocol to hosted-kernel-rpc, webhook, or queue."
        });
      }

      if (contract.serviceEndpoint.authMode === "none" && contract.handoffState !== "none") {
        warnings.push({
          code: "PROVIDER_ENDPOINT_AUTH_NONE",
          contractId: contract.contractId,
          providerId: contract.providerId,
          message: "Provider service endpoint has no handoff authentication mode.",
          action: "Prefer boundary-token, signed-request, or mtls for install-plan provider handoff."
        });
      }
    } else if (contract.requiresServiceEndpoint) {
      errors.push({
        code: "PROVIDER_ENDPOINT_REQUIRED",
        contractId: contract.contractId,
        providerId: contract.providerId,
        message: "Provider contract requires an external service endpoint but none was supplied.",
        action: "Attach serviceEndpoint with URL, protocol, and authMode before dispatching hosted-kernel package work."
      });
    }
  }

  return { errors, warnings };
}

function validateClientRequest({ clientRequest, previewSettings }) {
  const errors = [];
  const warnings = [];

  if (!clientRequest.requestId) {
    errors.push({
      code: "CLIENT_REQUEST_ID_REQUIRED",
      message: "Install-plan requests must include a stable request id for runtime state reconciliation.",
      action: "Pass request.requestId or input.requestId before handing the plan to the hosted kernel."
    });
  }

  if (!clientRequest.clientId) {
    warnings.push({
      code: "CLIENT_ID_MISSING",
      message: "Install-plan request is not tied to a client id.",
      action: "Attach client.clientId so preview, acceptance, and handoff state can be reconciled in the client runtime."
    });
  }

  if (previewSettings.requireExplicitAcceptance && !clientRequest.actorId) {
    warnings.push({
      code: "CLIENT_ACTOR_MISSING_FOR_ACCEPTANCE",
      message: "Explicit acceptance is required but the request has no client actor id.",
      action: "Attach client.actorId so acceptance evidence can be attributed."
    });
  }

  if (clientRequest.workflow.state === "cancelled") {
    errors.push({
      code: "CLIENT_WORKFLOW_CANCELLED",
      message: "Cancelled client workflows cannot dispatch hosted-kernel install plans.",
      action: "Create a new request id and workflow before preparing another install plan."
    });
  }

  if (["submitted", "accepted"].includes(clientRequest.workflow.state) && !clientRequest.workflow.handoffToken) {
    warnings.push({
      code: "CLIENT_HANDOFF_TOKEN_MISSING",
      message: "Client workflow is past preview but has no handoff token.",
      action: "Attach workflow.handoffToken so the hosted-kernel runtime can acknowledge or replay the handoff."
    });
  }

  return { errors, warnings };
}

function validateWorkspaceScope({ workspaceScope, clientRequest, providerContracts }) {
  const errors = [];
  const warnings = [];
  const permissionSet = new Set(workspaceScope.permissions);
  const requested = workspaceScope.requestedPermissions.length
    ? workspaceScope.requestedPermissions
    : ["package.install.preview", "package.install.audit"];
  const missingPermissions = requested.filter((permission) => !permissionSet.has(permission));

  if (!workspaceScope.tenantId) {
    errors.push({
      code: "TENANT_SCOPE_REQUIRED",
      message: "Hosted-kernel install plans must be bound to a tenant before package provider handoff.",
      action: "Pass workspaceScope.tenantId so audit and provider dispatch remain tenant isolated."
    });
  }

  if (!workspaceScope.workspaceId && workspaceScope.scopeMode !== "kernel-admin") {
    errors.push({
      code: "WORKSPACE_SCOPE_REQUIRED",
      message: "Install-plan requests require a workspace id unless they are explicit kernel-admin operations.",
      action: "Pass workspaceScope.workspaceId or set scopeMode to kernel-admin for host-level maintenance."
    });
  }

  if (!workspaceScope.actorId && !clientRequest.actorId) {
    warnings.push({
      code: "WORKSPACE_ACTOR_MISSING",
      message: "Workspace permission evaluation has no actor id to attribute the install-plan decision.",
      action: "Attach workspaceScope.actor.actorId or client.actorId for audit attribution."
    });
  }

  if (!workspaceScope.boundaryToken) {
    errors.push({
      code: "WORKSPACE_BOUNDARY_TOKEN_REQUIRED",
      message: "Install-plan handoff requires a workspace boundary token.",
      action: "Mint a boundary token scoped to the tenant, workspace, request id, and hosted-kernel command."
    });
  }

  if (missingPermissions.length) {
    errors.push({
      code: "WORKSPACE_PERMISSION_DENIED",
      message: `Workspace actor is missing install-plan permissions: ${missingPermissions.join(", ")}.`,
      action: "Grant the actor an operator/admin role or explicit package install permissions before dispatch.",
      missingPermissions
    });
  }

  if (workspaceScope.scopeMode === "tenant-shared" && !workspaceScope.allowCrossWorkspaceProviders) {
    const providerCount = providerContracts.length;
    warnings.push({
      code: "TENANT_SHARED_PROVIDER_BOUNDARY_HELD",
      message: "Tenant-shared install plan is not allowed to use cross-workspace provider contracts.",
      action: "Set allowCrossWorkspaceProviders only after provider contracts are proven tenant scoped.",
      providerCount
    });
  }

  for (const contract of providerContracts) {
    if (contract.tenantId && workspaceScope.tenantId && contract.tenantId !== workspaceScope.tenantId) {
      errors.push({
        code: "PROVIDER_TENANT_SCOPE_MISMATCH",
        contractId: contract.contractId,
        providerId: contract.providerId,
        message: "Provider contract tenant does not match the install-plan tenant boundary.",
        action: "Bind a provider contract from the same tenant before hosted-kernel package handoff.",
        contractTenantId: contract.tenantId,
        requestedTenantId: workspaceScope.tenantId
      });
    }

    if (workspaceScope.scopeMode === "single-workspace"
      && contract.workspaceId
      && workspaceScope.workspaceId
      && contract.workspaceId !== workspaceScope.workspaceId) {
      errors.push({
        code: "PROVIDER_WORKSPACE_SCOPE_MISMATCH",
        contractId: contract.contractId,
        providerId: contract.providerId,
        message: "Provider contract workspace does not match the install-plan workspace boundary.",
        action: "Use a provider contract scoped to the current workspace or switch to a tenant-shared boundary with explicit permission.",
        contractWorkspaceId: contract.workspaceId,
        requestedWorkspaceId: workspaceScope.workspaceId
      });
    }

    if (workspaceScope.scopeMode === "tenant-shared"
      && workspaceScope.allowCrossWorkspaceProviders
      && !contract.tenantId
      && !contract.tenantScoped) {
      warnings.push({
        code: "TENANT_SHARED_PROVIDER_SCOPE_UNPROVEN",
        contractId: contract.contractId,
        providerId: contract.providerId,
        message: "Tenant-shared provider use is allowed but this contract has no tenant scope proof.",
        action: "Attach provider contract tenantId or tenantScoped=true before relying on cross-workspace dispatch."
      });
    }
  }

  for (const permission of workspaceScope.permissions) {
    if (!INSTALL_PLAN_PERMISSIONS.has(permission)) {
      warnings.push({
        code: "WORKSPACE_PERMISSION_UNKNOWN",
        permission,
        message: `Workspace permission '${permission}' is not part of the install-plan permission contract.`,
        action: "Keep unknown permissions out of package install-plan boundary tokens."
      });
    }
  }

  return { errors, warnings };
}

function validateOperationalHealth({ operationalHealth, now }) {
  const errors = [];
  const warnings = [];
  const nowTime = parseTime(now);
  const observedTime = parseTime(operationalHealth.observedAt);

  if (!operationalHealth.observedAt) {
    warnings.push({
      code: "OPERATIONAL_HEALTH_TIMESTAMP_MISSING",
      message: "Operational health input has no observedAt timestamp.",
      action: "Attach operationalHealth.observedAt so retry and outage decisions can be audited."
    });
  } else if (observedTime === null) {
    warnings.push({
      code: "OPERATIONAL_HEALTH_TIMESTAMP_INVALID",
      message: "Operational health input has an invalid observedAt timestamp.",
      action: "Set operationalHealth.observedAt to an ISO timestamp from the hosted-kernel health probe."
    });
  } else if (nowTime !== null && observedTime > nowTime) {
    warnings.push({
      code: "OPERATIONAL_HEALTH_CLOCK_SKEW",
      message: "Operational health was observed after install-plan generation time.",
      action: "Check hosted-kernel health probe clock skew before dispatching provider handoff."
    });
  }

  for (const service of operationalHealth.services) {
    if (service.required && service.state === "down") {
      errors.push({
        code: "OPERATIONAL_SERVICE_DOWN",
        service: service.service,
        message: `Required hosted-kernel service '${service.service}' is down.`,
        action: service.retryAfterMs !== null
          ? "Wait for the service retryAfterMs window, then regenerate the install plan before dispatch."
          : "Restore the service or route the install through a healthy provider before dispatch."
      });
    } else if (service.required && service.state === "unknown") {
      warnings.push({
        code: "OPERATIONAL_SERVICE_HEALTH_UNKNOWN",
        service: service.service,
        message: `Required hosted-kernel service '${service.service}' did not report health.`,
        action: "Refresh operationalHealth.services before promoting this plan beyond degraded mode."
      });
    } else if (service.required && service.state === "degraded") {
      warnings.push({
        code: "OPERATIONAL_SERVICE_DEGRADED",
        service: service.service,
        message: `Required hosted-kernel service '${service.service}' is degraded.`,
        action: "Keep the install plan in degraded mode or wait for the service to return healthy before enable."
      });
    }

    if (service.lastCheckedAt && parseTime(service.lastCheckedAt) === null) {
      warnings.push({
        code: "OPERATIONAL_SERVICE_CHECK_TIMESTAMP_INVALID",
        service: service.service,
        message: `Hosted-kernel service '${service.service}' has an invalid lastCheckedAt timestamp.`,
        action: "Attach a valid lastCheckedAt timestamp to keep service-health proof auditable."
      });
    }
  }

  return { errors, warnings };
}

function validatePlan({
  hostedKernel,
  steps,
  lifecycleSettings,
  providerContracts,
  clientRequest,
  previewSettings,
  workspaceScope,
  operationalHealth,
  now
}) {
  const errors = [];
  const warnings = [];
  const capabilities = new Set(asArray(hostedKernel?.capabilities).filter((item) => typeof item === "string"));
  const missingCapabilities = REQUIRED_HOSTED_KERNEL_CAPABILITIES.filter((capability) => !capabilities.has(capability));
  const lifecycleValidation = validateLifecycleSettings({ settings: lifecycleSettings, steps, now });
  const providerValidation = validateProviderContracts({
    providerContracts,
    hostedCapabilities: capabilities,
    now
  });
  const clientValidation = validateClientRequest({ clientRequest, previewSettings });
  const workspaceValidation = validateWorkspaceScope({ workspaceScope, clientRequest, providerContracts });
  const operationalValidation = validateOperationalHealth({ operationalHealth, now });

  if (!hostedKernel || typeof hostedKernel !== "object") {
    errors.push({
      code: "HOSTED_KERNEL_REQUIRED",
      message: "Install planning requires a hosted-kernel runtime descriptor.",
      action: "Pass input.hostedKernel with id, state, and capabilities."
    });
  } else {
    if (typeof hostedKernel.id !== "string" || !hostedKernel.id.trim()) {
      errors.push({
        code: "HOSTED_KERNEL_ID_REQUIRED",
        message: "Hosted-kernel install plans must identify the target kernel.",
        action: "Set input.hostedKernel.id to the kernel instance handling the package install."
      });
    }
    if (hostedKernel.state && !["ready", "degraded", "recovering"].includes(hostedKernel.state)) {
      errors.push({
        code: "HOSTED_KERNEL_UNAVAILABLE",
        message: `Hosted kernel state '${hostedKernel.state}' cannot accept install plans.`,
        action: "Retry after the hosted kernel reports ready, degraded, or recovering state."
      });
    }
    if (missingCapabilities.length) {
      errors.push({
        code: "HOSTED_KERNEL_CAPABILITY_GAP",
        message: `Hosted kernel is missing install capabilities: ${missingCapabilities.join(", ")}.`,
        action: "Enable package fetch, integrity verification, and plan audit support before execution."
      });
    }
  }

  errors.push(...lifecycleValidation.errors);
  warnings.push(...lifecycleValidation.warnings);
  errors.push(...providerValidation.errors);
  warnings.push(...providerValidation.warnings);
  errors.push(...clientValidation.errors);
  warnings.push(...clientValidation.warnings);
  errors.push(...workspaceValidation.errors);
  warnings.push(...workspaceValidation.warnings);
  errors.push(...operationalValidation.errors);
  warnings.push(...operationalValidation.warnings);

  if (!steps.length) {
    errors.push({
      code: "INSTALL_STEPS_REQUIRED",
      message: "Install plan must include at least one package step.",
      action: "Pass input.steps with packageName, version, action, and optional checksum."
    });
  }

  for (const step of steps) {
    if (!step.packageName) {
      errors.push({
        code: "PACKAGE_NAME_REQUIRED",
        stepId: step.id,
        message: "Install step is missing a package name.",
        action: "Set packageName for every install-plan step."
      });
    }
    if (step.action === "install" && !step.version) {
      warnings.push({
        code: "PACKAGE_VERSION_UNPINNED",
        stepId: step.id,
        message: "Install step is not pinned to an explicit version.",
        action: "Pin package versions to improve reproducibility and auditability."
      });
    }
    if (step.action === "install" && !step.checksum) {
      warnings.push({
        code: "PACKAGE_CHECKSUM_MISSING",
        stepId: step.id,
        message: "Install step lacks an integrity checksum.",
        action: "Attach a package checksum before promoting this plan beyond degraded mode."
      });
    }
  }

  return { errors, warnings };
}

function buildCapabilityNegotiation({ hostedKernel, providerContracts }) {
  const hostedCapabilities = new Set(asArray(hostedKernel?.capabilities).filter((item) => typeof item === "string"));
  const contracts = providerContracts.map((contract) => {
    const missingRequired = contract.requiredCapabilities.filter((capability) => !hostedCapabilities.has(capability));
    const matchedOptional = contract.optionalCapabilities.filter((capability) => hostedCapabilities.has(capability));
    const degraded = contract.state !== "active" || missingRequired.length > 0;

    return {
      contractId: contract.contractId,
      providerId: contract.providerId,
      service: contract.service,
      state: contract.state,
      accepted: !degraded,
      degraded,
      requiredCapabilities: contract.requiredCapabilities,
      missingRequiredCapabilities: missingRequired,
      matchedOptionalCapabilities: matchedOptional,
      handoffEligible: contract.state === "active" && missingRequired.length === 0 && contract.handoffState !== "failed"
    };
  });

  return {
    requiredHostedCapabilities: REQUIRED_HOSTED_KERNEL_CAPABILITIES,
    hostedCapabilities: [...hostedCapabilities].sort(),
    acceptedContractCount: contracts.filter((contract) => contract.accepted).length,
    degradedContractCount: contracts.filter((contract) => contract.degraded).length,
    allRequiredCapabilitiesMet: contracts.every((contract) => contract.missingRequiredCapabilities.length === 0),
    contracts
  };
}

function buildSyncMetadata({ now, providerContracts }) {
  const syncedContracts = providerContracts.filter((contract) => contract.lastSyncedAt);
  const syncTimes = syncedContracts.map((contract) => parseTime(contract.lastSyncedAt)).filter((time) => time !== null);
  const oldestSyncTime = syncTimes.length ? Math.min(...syncTimes) : null;
  const newestSyncTime = syncTimes.length ? Math.max(...syncTimes) : null;

  return {
    generatedAt: now,
    contractCount: providerContracts.length,
    syncedContractCount: syncedContracts.length,
    unsyncedContractIds: providerContracts
      .filter((contract) => !contract.lastSyncedAt)
      .map((contract) => contract.contractId),
    cursorByContractId: Object.fromEntries(providerContracts.map((contract) => [
      contract.contractId,
      contract.syncCursor
    ])),
    oldestSyncedAt: oldestSyncTime !== null ? new Date(oldestSyncTime).toISOString() : null,
    newestSyncedAt: newestSyncTime !== null ? new Date(newestSyncTime).toISOString() : null
  };
}

function buildProviderServiceBindings({
  now,
  providerContracts,
  capabilityNegotiation,
  syncMetadata,
  nextAction,
  operationalHealth
}) {
  const command = nextAction.command || "prepare";
  const requiredServices = COMMAND_SERVICE_REQUIREMENTS[command] || ["registry"];
  const negotiatedByContractId = new Map(capabilityNegotiation.contracts.map((contract) => [
    contract.contractId,
    contract
  ]));
  const healthByService = new Map(operationalHealth.services.map((service) => [service.service, service]));
  const routeForService = (service) => {
    const direct = providerContracts.filter((contract) => contract.service === service);
    const fallbacks = asArray(SERVICE_ROUTE_FALLBACKS[service]).flatMap((fallbackService) => (
      providerContracts.filter((contract) => contract.service === fallbackService)
    ));
    const candidates = [...direct, ...fallbacks]
      .map((contract) => {
        const negotiated = negotiatedByContractId.get(contract.contractId);
        const health = healthByService.get(service) || healthByService.get(contract.service) || null;
        const syncRequired = ["registry", "attestation"].includes(service);
        const synced = Boolean(contract.lastSyncedAt || contract.syncCursor);
        const directServiceMatch = contract.service === service;
        const fallback = !directServiceMatch;
        const endpoint = contract.serviceEndpoint;
        const endpointReady = !contract.requiresServiceEndpoint || Boolean(endpoint?.url);
        const blockedReasons = [
          ...(negotiated?.handoffEligible ? [] : ["CAPABILITY_OR_STATE_NOT_ELIGIBLE"]),
          ...(health?.state === "down" ? [`${service.toUpperCase()}_SERVICE_DOWN`] : []),
          ...(syncRequired && !synced ? ["PROVIDER_SYNC_REQUIRED"] : []),
          ...(endpointReady ? [] : ["PROVIDER_ENDPOINT_REQUIRED"])
        ];

        return {
          contractId: contract.contractId,
          providerId: contract.providerId,
          requestedService: service,
          service: contract.service,
          directServiceMatch,
          fallback,
          handoffEligible: Boolean(negotiated?.handoffEligible),
          synced,
          syncCursor: contract.syncCursor,
          lastSyncedAt: contract.lastSyncedAt,
          endpointRequired: contract.requiresServiceEndpoint,
          endpointPresent: Boolean(endpoint?.url),
          endpoint: endpoint?.url ? {
            url: endpoint.url,
            method: endpoint.method,
            protocol: endpoint.protocol,
            authMode: endpoint.authMode,
            timeoutMs: endpoint.timeoutMs,
            supportsAcknowledgement: endpoint.supportsAcknowledgement,
            acknowledgementRoute: endpoint.acknowledgementRoute
          } : null,
          handoffState: contract.handoffState,
          operationalState: health?.state || "unknown",
          blockedReasons,
          routeReady: blockedReasons.length === 0
        };
      })
      .sort((left, right) => {
        if (left.routeReady !== right.routeReady) return left.routeReady ? -1 : 1;
        if (left.directServiceMatch !== right.directServiceMatch) return left.directServiceMatch ? -1 : 1;
        if (left.synced !== right.synced) return left.synced ? -1 : 1;
        return left.contractId.localeCompare(right.contractId);
      });
    const elected = candidates.find((candidate) => candidate.routeReady) || null;

    return {
      service,
      requiredForCommand: command,
      state: elected ? "bound" : candidates.length ? "blocked" : "missing",
      electedContractId: elected?.contractId || null,
      electedProviderId: elected?.providerId || null,
      routeService: elected?.service || null,
      fallbackUsed: Boolean(elected?.fallback),
      syncCursor: elected?.syncCursor || null,
      lastSyncedAt: elected?.lastSyncedAt || null,
      candidateCount: candidates.length,
      candidateContractIds: candidates.map((candidate) => candidate.contractId),
      blockedReasons: elected
        ? []
        : candidates.length
          ? [...new Set(candidates.flatMap((candidate) => candidate.blockedReasons))]
          : ["SERVICE_PROVIDER_CONTRACT_MISSING"],
      candidates
    };
  };
  const bindings = requiredServices.map(routeForService);
  const heldBindings = bindings.filter((binding) => binding.state !== "bound");
  const electedRoutesByService = Object.fromEntries(bindings
    .filter((binding) => binding.electedContractId)
    .map((binding) => [
      binding.service,
      {
        contractId: binding.electedContractId,
        providerId: binding.electedProviderId,
        service: binding.routeService,
        requestedService: binding.service,
        fallbackUsed: binding.fallbackUsed,
        syncCursor: binding.syncCursor,
        lastSyncedAt: binding.lastSyncedAt,
        endpointRequired: binding.candidates
          .find((candidate) => candidate.contractId === binding.electedContractId)?.endpointRequired === true,
        endpoint: binding.candidates.find((candidate) => candidate.contractId === binding.electedContractId)?.endpoint || null
      }
    ]));

  return {
    generatedAt: now,
    command,
    requiredServices,
    ready: heldBindings.length === 0,
    state: heldBindings.length ? "held" : "ready",
    holdReasons: [...new Set(heldBindings.flatMap((binding) => binding.blockedReasons))],
    unsyncedContractIds: syncMetadata.unsyncedContractIds,
    electedContractIds: bindings
      .map((binding) => binding.electedContractId)
      .filter(Boolean),
    fallbackContractIds: bindings
      .filter((binding) => binding.fallbackUsed)
      .map((binding) => binding.electedContractId),
    electedRoutesByService,
    bindings
  };
}

function buildProviderIntegrationContract({
  now,
  hostedKernel,
  clientRequest,
  workspaceBoundary,
  nextAction,
  providerContracts,
  providerServiceBindings,
  capabilityNegotiation,
  syncMetadata
}) {
  const negotiatedByContractId = new Map(capabilityNegotiation.contracts.map((contract) => [
    contract.contractId,
    contract
  ]));
  const sourceContractsById = new Map(providerContracts.map((contract) => [contract.contractId, contract]));
  const serviceIntents = providerServiceBindings.bindings.map((binding) => {
    const route = binding.electedContractId
      ? providerServiceBindings.electedRoutesByService[binding.service]
      : null;
    const negotiated = route ? negotiatedByContractId.get(route.contractId) : null;
    const sourceContract = route ? sourceContractsById.get(route.contractId) : null;
    const requiredCapabilities = negotiated?.requiredCapabilities || [];
    const missingRequiredCapabilities = negotiated?.missingRequiredCapabilities || [];
    const syncProofRequired = ["registry", "attestation"].includes(binding.service);
    const syncProofPresent = Boolean(route?.syncCursor || route?.lastSyncedAt);
    const endpoint = route?.endpoint || null;
    const endpointRequired = sourceContract?.requiresServiceEndpoint === true;
    const endpointPresent = Boolean(endpoint?.url);
    const acknowledgementState = sourceContract?.handoffState === "acknowledged"
      ? "acknowledged"
      : binding.state === "bound"
        ? "awaiting-ack"
        : "not-sent";
    const handoffPatch = route ? {
      contractId: route.contractId,
      providerId: route.providerId,
      service: binding.service,
      routeService: route.service,
      fallbackUsed: route.fallbackUsed,
      handoffState: sourceContract?.handoffState || "none",
      handoffRef: sourceContract?.handoffRef || null,
      endpoint,
      endpointRequired,
      expectedAckRef: [
        surfaceId,
        clientRequest.requestId || "request-missing",
        route.contractId,
        binding.service,
        nextAction.command
      ].join(":")
    } : null;

    return {
      service: binding.service,
      command: nextAction.command,
      routeState: binding.state,
      contractId: route?.contractId || null,
      providerId: route?.providerId || null,
      routeService: route?.service || null,
      fallbackUsed: Boolean(route?.fallbackUsed),
      requiredCapabilities,
      missingRequiredCapabilities,
      capabilityAccepted: Boolean(negotiated?.accepted),
      handoffEligible: Boolean(negotiated?.handoffEligible),
      syncProofRequired,
      syncProofPresent,
      syncCursor: route?.syncCursor || null,
      lastSyncedAt: route?.lastSyncedAt || null,
      endpointRequired,
      endpointPresent,
      endpoint,
      acknowledgementState,
      handoffPatch,
      blockedReasons: binding.blockedReasons
    };
  });
  const blockedIntents = serviceIntents.filter((intent) => (
    intent.routeState !== "bound"
    || intent.missingRequiredCapabilities.length
    || (intent.syncProofRequired && !intent.syncProofPresent)
    || !intent.handoffEligible
  ));
  const pendingAckIntents = serviceIntents.filter((intent) => intent.acknowledgementState === "awaiting-ack");
  const integrationId = [
    surfaceId,
    clientRequest.requestId || "request-missing",
    hostedKernel?.id || "kernel-missing",
    nextAction.command,
    providerServiceBindings.requiredServices.join("+") || "no-services"
  ].join(":");
  const routeTable = Object.fromEntries(serviceIntents
    .filter((intent) => intent.contractId)
    .map((intent) => [
      intent.service,
      {
        contractId: intent.contractId,
        providerId: intent.providerId,
        routeService: intent.routeService,
        fallbackUsed: intent.fallbackUsed,
        syncCursor: intent.syncCursor,
        lastSyncedAt: intent.lastSyncedAt,
        endpoint: intent.endpoint,
        endpointRequired: intent.endpointRequired,
        expectedAckRef: intent.handoffPatch?.expectedAckRef || null
      }
    ]));
  const externalStatePatch = {
    integrationId,
    command: nextAction.command,
    tenantId: workspaceBoundary.tenantId,
    workspaceId: workspaceBoundary.workspaceId,
    requestId: clientRequest.requestId,
    routeTable,
    pendingAcknowledgementRefs: serviceIntents
      .map((intent) => intent.handoffPatch?.expectedAckRef)
      .filter(Boolean),
    providerEndpointsByService: Object.fromEntries(serviceIntents
      .filter((intent) => intent.endpoint)
      .map((intent) => [
        intent.service,
        {
          contractId: intent.contractId,
          providerId: intent.providerId,
          endpoint: intent.endpoint,
          expectedAckRef: intent.handoffPatch?.expectedAckRef || null
        }
      ])),
    providerCursorByContractId: syncMetadata.cursorByContractId
  };

  return {
    generatedAt: now,
    contract: "hosted-kernel-install-plan-provider-integration-contract",
    integrationId,
    command: nextAction.command,
    tenantId: workspaceBoundary.tenantId,
    workspaceId: workspaceBoundary.workspaceId,
    hostedKernelId: hostedKernel?.id || null,
    requestId: clientRequest.requestId,
    state: blockedIntents.length ? "held" : pendingAckIntents.length ? "ready-awaiting-ack" : "ready",
    dispatchable: blockedIntents.length === 0,
    serviceIntentCount: serviceIntents.length,
    serviceIntents,
    routeTable,
    blockedServiceIntents: blockedIntents.map((intent) => intent.service),
    pendingAcknowledgementServices: pendingAckIntents.map((intent) => intent.service),
    requiredSyncProofServices: serviceIntents
      .filter((intent) => intent.syncProofRequired)
      .map((intent) => intent.service),
    missingSyncProofServices: serviceIntents
      .filter((intent) => intent.syncProofRequired && !intent.syncProofPresent)
      .map((intent) => intent.service),
    missingEndpointServices: serviceIntents
      .filter((intent) => intent.endpointRequired && !intent.endpointPresent)
      .map((intent) => intent.service),
    capabilityGapServices: serviceIntents
      .filter((intent) => intent.missingRequiredCapabilities.length)
      .map((intent) => intent.service),
    externalStatePatch,
    holdReasons: [...new Set(blockedIntents.flatMap((intent) => [
      ...intent.blockedReasons,
      ...(intent.missingRequiredCapabilities.length ? ["PROVIDER_CAPABILITY_NEGOTIATION_FAILED"] : []),
      ...(intent.syncProofRequired && !intent.syncProofPresent ? ["PROVIDER_SYNC_PROOF_MISSING"] : []),
      ...(!intent.handoffEligible ? ["PROVIDER_HANDOFF_NOT_ELIGIBLE"] : [])
    ]))]
  };
}

function buildWorkspaceBoundary({
  now,
  workspaceScope,
  clientRequest,
  nextAction,
  validation,
  providerContracts
}) {
  const commandPermission = nextAction.command === "enable" || nextAction.command === "schedule" || nextAction.command === "resume"
    ? "package.install.dispatch"
    : nextAction.command === "rollback"
      ? "package.install.rollback"
      : nextAction.command === "audit"
        ? "package.install.audit"
        : "package.install.preview";
  const permissionSet = new Set(workspaceScope.permissions);
  const requiredPermissions = [...new Set([
    "package.install.preview",
    commandPermission,
    ...workspaceScope.requestedPermissions
  ])];
  const missingPermissions = requiredPermissions.filter((permission) => !permissionSet.has(permission));
  const validationBlocked = validation.errors.some((error) => [
    "TENANT_SCOPE_REQUIRED",
    "WORKSPACE_SCOPE_REQUIRED",
    "WORKSPACE_BOUNDARY_TOKEN_REQUIRED",
    "WORKSPACE_PERMISSION_DENIED",
    "PROVIDER_TENANT_SCOPE_MISMATCH",
    "PROVIDER_WORKSPACE_SCOPE_MISMATCH"
  ].includes(error.code));
  const providerScopeDecisions = providerContracts.map((contract) => {
    const tenantMatches = !contract.tenantId
      || !workspaceScope.tenantId
      || contract.tenantId === workspaceScope.tenantId;
    const workspaceMatches = !contract.workspaceId
      || !workspaceScope.workspaceId
      || contract.workspaceId === workspaceScope.workspaceId;
    const tenantSharedAllowed = workspaceScope.scopeMode === "tenant-shared"
      && workspaceScope.allowCrossWorkspaceProviders
      && (contract.allowTenantSharedUse || contract.tenantScoped || Boolean(contract.tenantId));
    const kernelAdminAllowed = workspaceScope.scopeMode === "kernel-admin"
      && permissionSet.has("package.install.dispatch");
    const sameWorkspaceAllowed = workspaceScope.scopeMode === "single-workspace"
      && tenantMatches
      && workspaceMatches;
    const providerAllowed = kernelAdminAllowed || sameWorkspaceAllowed || tenantSharedAllowed;
    const holdReasons = [
      ...(tenantMatches ? [] : ["PROVIDER_TENANT_SCOPE_MISMATCH"]),
      ...(workspaceMatches || workspaceScope.scopeMode !== "single-workspace" ? [] : ["PROVIDER_WORKSPACE_SCOPE_MISMATCH"]),
      ...(workspaceScope.scopeMode === "tenant-shared" && !workspaceScope.allowCrossWorkspaceProviders
        ? ["TENANT_SHARED_PROVIDER_BOUNDARY_HELD"]
        : []),
      ...(workspaceScope.scopeMode === "tenant-shared"
        && workspaceScope.allowCrossWorkspaceProviders
        && !tenantSharedAllowed
        ? ["TENANT_SHARED_PROVIDER_SCOPE_UNPROVEN"]
        : [])
    ];

    return {
      contractId: contract.contractId,
      providerId: contract.providerId,
      service: contract.service,
      providerTenantId: contract.tenantId,
      providerWorkspaceId: contract.workspaceId,
      tenantMatches,
      workspaceMatches,
      tenantSharedAllowed,
      kernelAdminAllowed,
      providerAllowed,
      holdReasons: [...new Set(holdReasons)]
    };
  });
  const providerBoundaryHeld = providerScopeDecisions.some((decision) => !decision.providerAllowed);
  const crossWorkspaceHold = workspaceScope.scopeMode === "tenant-shared"
    && (!workspaceScope.allowCrossWorkspaceProviders || providerBoundaryHeld);
  const dispatchable = !validationBlocked
    && missingPermissions.length === 0
    && !crossWorkspaceHold
    && !providerBoundaryHeld
    && Boolean(workspaceScope.boundaryToken);

  return {
    generatedAt: now,
    tenantId: workspaceScope.tenantId,
    workspaceId: workspaceScope.workspaceId,
    scopeMode: workspaceScope.scopeMode,
    actorId: workspaceScope.actorId || clientRequest.actorId,
    roles: workspaceScope.roles,
    grantedPermissions: workspaceScope.permissions,
    requiredPermissions,
    missingPermissions,
    auditSink: workspaceScope.auditSink,
    boundaryTokenPresent: Boolean(workspaceScope.boundaryToken),
    crossWorkspaceProvidersAllowed: workspaceScope.allowCrossWorkspaceProviders,
    providerBoundaryState: providerBoundaryHeld ? "held" : "ready",
    providerScopeDecisions,
    allowedProviderContractIds: providerScopeDecisions
      .filter((decision) => decision.providerAllowed)
      .map((decision) => decision.contractId),
    blockedProviderContractIds: providerScopeDecisions
      .filter((decision) => !decision.providerAllowed)
      .map((decision) => decision.contractId),
    providerBoundaryHoldReasons: [...new Set(providerScopeDecisions.flatMap((decision) => decision.holdReasons))],
    dispatchable,
    holdReason: dispatchable
      ? null
      : validationBlocked
        ? "WORKSPACE_BOUNDARY_VALIDATION_FAILED"
        : missingPermissions.length
          ? "WORKSPACE_PERMISSION_DENIED"
          : providerBoundaryHeld
            ? providerScopeDecisions
              .flatMap((decision) => decision.holdReasons)[0] || "PROVIDER_SCOPE_BOUNDARY_HELD"
          : crossWorkspaceHold
            ? "TENANT_SHARED_PROVIDER_BOUNDARY_HELD"
            : "WORKSPACE_BOUNDARY_TOKEN_REQUIRED"
  };
}

function buildExternalHandoff({
  now,
  health,
  nextAction,
  providerContracts,
  capabilityNegotiation,
  providerServiceBindings,
  providerIntegrationContract,
  operationalRecovery,
  persistedStateRecovery,
  workspaceBoundary
}) {
  const serviceBoundContractIds = new Set(providerServiceBindings.electedContractIds);
  const boundaryAllowedContractIds = new Set(workspaceBoundary.allowedProviderContractIds || []);
  const eligibleContracts = capabilityNegotiation.contracts.filter((contract) => (
    contract.handoffEligible
    && serviceBoundContractIds.has(contract.contractId)
    && boundaryAllowedContractIds.has(contract.contractId)
  ));
  const blockedContractIds = capabilityNegotiation.contracts
    .filter((contract) => (
      !contract.handoffEligible
      || !serviceBoundContractIds.has(contract.contractId)
      || !boundaryAllowedContractIds.has(contract.contractId)
    ))
    .map((contract) => contract.contractId);
  const providerStates = Object.fromEntries(providerContracts.map((contract) => [
    contract.contractId,
    contract.handoffState
  ]));
  const operationalHold = operationalRecovery?.recommendedMode === "hold";
  const persistenceHold = persistedStateRecovery?.commandIntent === "hold"
    || persistedStateRecovery?.commandIntent === "noop";
  const dispatchable = health.state !== "blocked"
    && eligibleContracts.length > 0
    && !nextAction.blocked
    && providerServiceBindings.ready
    && !operationalHold
    && !persistenceHold
    && providerIntegrationContract.dispatchable
    && workspaceBoundary.dispatchable;

  return {
    generatedAt: now,
    channel: "hosted-kernel-provider-service",
    state: dispatchable ? "ready" : "held",
    dispatchable,
    command: nextAction.command,
    eligibleContractIds: eligibleContracts.map((contract) => contract.contractId),
    blockedContractIds,
    requiredServices: providerServiceBindings.requiredServices,
    providerServiceBindingState: providerServiceBindings.state,
    providerServiceBindingHoldReasons: providerServiceBindings.holdReasons,
    electedRoutesByService: providerServiceBindings.electedRoutesByService,
    providerIntegrationContractId: providerIntegrationContract.integrationId,
    providerIntegrationState: providerIntegrationContract.state,
    providerIntegrationHoldReasons: providerIntegrationContract.holdReasons,
    providerExternalStatePatch: providerIntegrationContract.externalStatePatch,
    providerStates,
    boundaryAllowedContractIds: [...boundaryAllowedContractIds],
    boundaryBlockedContractIds: workspaceBoundary.blockedProviderContractIds,
    tenantId: workspaceBoundary.tenantId,
    workspaceId: workspaceBoundary.workspaceId,
    boundaryTokenRequired: true,
    boundaryTokenPresent: workspaceBoundary.boundaryTokenPresent,
    auditSink: workspaceBoundary.auditSink,
    holdReason: dispatchable
      ? null
      : operationalHold
        ? "OPERATIONAL_RECOVERY_HOLD"
        : persistenceHold
          ? persistedStateRecovery.commandIntent === "noop"
            ? "PERSISTED_COMMAND_ALREADY_APPLIED"
            : "PERSISTED_STATE_RECOVERY_HELD"
        : !providerServiceBindings.ready
          ? providerServiceBindings.holdReasons[0] || "PROVIDER_SERVICE_BINDING_HELD"
        : !providerIntegrationContract.dispatchable
          ? providerIntegrationContract.holdReasons[0] || "PROVIDER_INTEGRATION_CONTRACT_HELD"
        : !workspaceBoundary.dispatchable
          ? workspaceBoundary.holdReason
        : health.state === "blocked"
        ? health.reason
        : blockedContractIds.length
          ? "PROVIDER_HANDOFF_NOT_ELIGIBLE"
      : nextAction.reason
  };
}

function buildDispatchManifest({
  now,
  hostedKernel,
  steps,
  clientRequest,
  workspaceBoundary,
  nextAction,
  externalHandoff,
  acceptance,
  persistedStateRecovery,
  persistenceWriteSet,
  capabilityNegotiation,
  providerServiceBindings,
  providerIntegrationContract,
  operationalRecovery
}) {
  const eligibleContractIds = new Set(externalHandoff.eligibleContractIds);
  const eligibleContracts = capabilityNegotiation.contracts
    .filter((contract) => eligibleContractIds.has(contract.contractId));
  const fallbackProviderRouteByService = Object.fromEntries(eligibleContracts.map((contract) => [
    contract.service,
    {
      contractId: contract.contractId,
      providerId: contract.providerId,
      handoffChannel: externalHandoff.channel
    }
  ]));
  const providerRouteByService = Object.fromEntries(Object.entries({
    ...fallbackProviderRouteByService,
    ...providerServiceBindings.electedRoutesByService
  }).map(([service, route]) => [
    service,
    {
      contractId: route.contractId,
      providerId: route.providerId,
      handoffChannel: externalHandoff.channel,
      requestedService: route.requestedService || service,
      routeService: route.service || service,
      fallbackUsed: Boolean(route.fallbackUsed),
      syncCursor: route.syncCursor || null,
      lastSyncedAt: route.lastSyncedAt || null,
      endpoint: route.endpoint || null,
      endpointRequired: route.endpointRequired === true,
      expectedAckRef: providerIntegrationContract.routeTable[route.requestedService || service]?.expectedAckRef || null
    }
  ]));
  const selectedSteps = steps.filter((step) => {
    if (nextAction.command === "resume") {
      return step.id === nextAction.stepId || classifyFailure(step) === "retryable";
    }
    if (nextAction.command === "rollback") {
      return step.required && step.status === "failed";
    }
    if (["enable", "schedule"].includes(nextAction.command)) {
      return !["completed", "succeeded"].includes(step.status);
    }
    return false;
  });
  const blockingReasons = [
    ...(externalHandoff.dispatchable ? [] : [externalHandoff.holdReason || "EXTERNAL_HANDOFF_HELD"]),
    ...(acceptance.accepted ? [] : [acceptance.blockedReason || "ACCEPTANCE_REQUIRED"]),
    ...(persistedStateRecovery.safeToDispatch || persistedStateRecovery.commandIntent === "replay"
      ? []
      : [persistedStateRecovery.status === "already-applied"
        ? "PERSISTED_COMMAND_ALREADY_APPLIED"
        : "PERSISTED_STATE_NOT_DISPATCHABLE"]),
    ...(persistenceWriteSet.writable ? [] : persistenceWriteSet.deniedReasons),
    ...(operationalRecovery.recommendedMode === "hold" ? ["OPERATIONAL_RECOVERY_HOLD"] : []),
    ...(selectedSteps.length || ["prepare", "audit", "disable"].includes(nextAction.command)
      ? []
      : ["NO_MUTATING_STEPS_SELECTED"])
  ];
  const dispatchable = blockingReasons.length === 0
    && ["enable", "schedule", "resume", "rollback"].includes(nextAction.command);
  const manifestId = [
    surfaceId,
    clientRequest.requestId || "request-missing",
    hostedKernel?.id || "kernel-missing",
    nextAction.command,
    persistenceWriteSet.expectedGeneration
  ].join(":");
  const commandEnvelopes = dispatchable ? selectedSteps.map((step, index) => {
    const commandServices = COMMAND_SERVICE_REQUIREMENTS[nextAction.command] || ["registry"];
    const preferredServices = [
      ...(step.action === "verify" ? ["attestation"] : []),
      ...commandServices,
      "registry",
      "orchestrator",
      "attestation"
    ];
    const route = preferredServices
      .map((service) => providerRouteByService[service])
      .find(Boolean) || null;

    return {
      sequence: index + 1,
      envelopeId: `${manifestId}:${step.id}`,
      idempotencyKey: buildIdempotencyKey({
        clientRequest,
        hostedKernel,
        command: nextAction.command,
        stepId: step.id,
        scheduledAt: nextAction.scheduledAt
      }),
      command: nextAction.command,
      lifecycleAction: step.action,
      stepId: step.id,
      packageName: step.packageName,
      version: step.version,
      checksum: step.checksum,
      required: step.required,
      attempt: step.attempts + 1,
      scheduledAt: nextAction.command === "schedule" ? nextAction.scheduledAt || null : null,
      target: {
        hostedKernelId: hostedKernel?.id || null,
        tenantId: workspaceBoundary.tenantId,
        workspaceId: workspaceBoundary.workspaceId,
        providerContractId: route?.contractId || null,
        providerId: route?.providerId || null,
        channel: route?.handoffChannel || externalHandoff.channel,
        endpoint: route?.endpoint || null
      },
      proofRefs: {
        requestId: clientRequest.requestId,
        correlationId: clientRequest.correlationId,
        boundaryTokenPresent: workspaceBoundary.boundaryTokenPresent,
        acceptanceTokenPresent: acceptance.acceptanceTokenPresent,
        persistenceGeneration: persistenceWriteSet.expectedGeneration,
        providerService: route?.requestedService || route?.routeService || null,
        providerSyncCursor: route?.syncCursor || null,
        providerIntegrationContractId: providerIntegrationContract.integrationId,
        providerExpectedAckRef: route?.expectedAckRef || null,
        providerEndpointRequired: route?.endpointRequired === true,
        providerEndpointPresent: Boolean(route?.endpoint?.url)
      }
    };
  }) : [];

  return {
    generatedAt: now,
    contract: "hosted-kernel-install-plan-dispatch-manifest",
    manifestId,
    state: dispatchable
      ? "ready"
      : blockingReasons.includes("PERSISTED_COMMAND_ALREADY_APPLIED")
        ? "already-applied"
        : "held",
    dispatchable,
    command: nextAction.command,
    requestId: clientRequest.requestId,
    hostedKernelId: hostedKernel?.id || null,
    tenantId: workspaceBoundary.tenantId,
    workspaceId: workspaceBoundary.workspaceId,
    boundaryTokenRequired: true,
    boundaryTokenPresent: workspaceBoundary.boundaryTokenPresent,
    selectedStepIds: selectedSteps.map((step) => step.id),
    commandEnvelopeCount: commandEnvelopes.length,
    serviceBindingState: providerServiceBindings.state,
    serviceBindingHoldReasons: providerServiceBindings.holdReasons,
    requiredProviderServices: providerServiceBindings.requiredServices,
    providerIntegrationContractId: providerIntegrationContract.integrationId,
    providerIntegrationState: providerIntegrationContract.state,
    providerIntegrationRouteTable: providerIntegrationContract.routeTable,
    providerIntegrationExternalStatePatch: providerIntegrationContract.externalStatePatch,
    eligibleProviderRoutes: providerRouteByService,
    blockingReasons: [...new Set(blockingReasons.filter(Boolean))],
    commandEnvelopes,
    replay: persistedStateRecovery.commandIntent === "replay",
    replayIdempotencyKey: persistedStateRecovery.commandIntent === "replay"
      ? persistedStateRecovery.expectedIdempotencyKey
      : null
  };
}

function buildOperationalRecovery({ now, operationalHealth, retryPolicies, validation }) {
  const serviceFailures = operationalHealth.services.filter((service) => (
    service.required && ["down", "degraded", "unknown"].includes(service.state)
  ));
  const retryableStepBackoffs = retryPolicies
    .filter((policy) => policy.nextBackoffMs !== null)
    .map((policy) => policy.nextBackoffMs);
  const blockedServices = serviceFailures
    .filter((service) => service.state === "down")
    .map((service) => service.service);
  const degradedServices = serviceFailures
    .filter((service) => service.state !== "down")
    .map((service) => service.service);
  const nowTime = parseTime(now);
  const serviceDecisions = serviceFailures.map((service) => {
    const retryAfterMs = service.retryAfterMs !== null
      ? service.retryAfterMs
      : service.state === "down"
        ? DEFAULT_MAX_BACKOFF_MS
        : service.state === "unknown"
          ? DEFAULT_BASE_BACKOFF_MS
          : null;
    const retryAt = retryAfterMs !== null && nowTime !== null
      ? new Date(nowTime + retryAfterMs).toISOString()
      : null;
    const recoveryActions = OPERATIONAL_SERVICE_RECOVERY_ACTIONS[service.service] || {};
    const failureCode = service.errorCode || (
      service.state === "down"
        ? "SERVICE_DOWN"
        : service.state === "unknown"
          ? "SERVICE_HEALTH_UNKNOWN"
          : "SERVICE_DEGRADED"
    );

    return {
      service: service.service,
      state: service.state,
      required: service.required,
      severity: service.state === "down" ? "blocking" : "degraded",
      failureCode,
      retryable: service.state !== "down" || service.retryAfterMs !== null,
      retryAfterMs,
      retryAt,
      degradedModeAllowed: service.state !== "down",
      commandImpact: service.state === "down"
        ? ["enable", "resume", "schedule"]
        : service.state === "unknown"
          ? ["enable", "resume"]
          : ["enable"],
      operatorAction: recoveryActions[service.state] || (
        service.state === "down"
          ? "Restore the required hosted-kernel service before provider handoff."
          : "Refresh hosted-kernel service health before enabling the install plan."
      ),
      proofRequired: service.state === "unknown"
        ? "fresh-service-health-probe"
        : service.state === "degraded"
          ? "degraded-mode-operator-ack"
          : "service-restored-health-probe"
    };
  });
  const effectiveRetryBackoffs = [
    ...retryableStepBackoffs,
    ...serviceDecisions
      .map((decision) => decision.retryAfterMs)
      .filter((retryAfterMs) => retryAfterMs !== null)
  ];
  const effectiveNextRetryInMs = effectiveRetryBackoffs.length ? Math.max(...effectiveRetryBackoffs) : null;
  const blockingDecisions = serviceDecisions.filter((decision) => decision.severity === "blocking");
  const degradedDecisions = serviceDecisions.filter((decision) => decision.severity === "degraded");
  const recoveryProof = {
    required: serviceDecisions.length > 0,
    serviceCount: serviceDecisions.length,
    blockingServiceCount: blockingDecisions.length,
    degradedServiceCount: degradedDecisions.length,
    proofRequired: [...new Set(serviceDecisions.map((decision) => decision.proofRequired))],
    affectedCommands: [...new Set(serviceDecisions.flatMap((decision) => decision.commandImpact))].sort()
  };

  return {
    generatedAt: now,
    source: operationalHealth.source,
    observedAt: operationalHealth.observedAt,
    status: operationalHealth.status,
    serviceCount: operationalHealth.services.length,
    blockedServices,
    degradedServices,
    retryable: blockingDecisions.length === 0 && effectiveNextRetryInMs !== null
      && validation.errors.length === 0,
    nextRetryInMs: effectiveNextRetryInMs,
    nextRetryAt: effectiveNextRetryInMs !== null && nowTime !== null
      ? new Date(nowTime + effectiveNextRetryInMs).toISOString()
      : null,
    recommendedMode: blockingDecisions.length
      ? "hold"
      : degradedDecisions.length
        ? "degraded-preview"
        : effectiveNextRetryInMs !== null
          ? "retry-after-backoff"
          : "normal",
    serviceDecisions,
    recoveryProof,
    operatorAction: blockingDecisions.length
      ? blockingDecisions[0].operatorAction
      : degradedDecisions.length
        ? degradedDecisions[0].operatorAction
        : effectiveNextRetryInMs !== null
          ? "Resume retryable install steps after the computed backoff window."
          : "No operational recovery action required."
  };
}

function buildOperationalCommandGate({ now, operationalRecovery, requestedCommand }) {
  const nowTime = parseTime(now);
  const serviceDecisions = asArray(operationalRecovery?.serviceDecisions);
  const commandStates = Object.fromEntries([...LIFECYCLE_COMMANDS].map((command) => {
    const impactedDecisions = serviceDecisions.filter((decision) => (
      asArray(decision.commandImpact).includes(command)
    ));
    const blockingDecisions = impactedDecisions.filter((decision) => (
      decision.severity === "blocking"
      || decision.state === "unknown"
      || (decision.state === "degraded" && ["enable", "resume", "schedule"].includes(command))
    ));
    const degradedDecisions = impactedDecisions.filter((decision) => (
      !blockingDecisions.includes(decision)
      && decision.degradedModeAllowed
    ));
    const retryAfterValues = impactedDecisions
      .map((decision) => decision.retryAfterMs)
      .filter((retryAfterMs) => retryAfterMs !== null);
    const retryAfterMs = retryAfterValues.length ? Math.max(...retryAfterValues) : null;
    const blockerCodes = blockingDecisions.map((decision) => {
      const serviceCode = decision.service.replace(/[^a-z0-9]+/gi, "_").toUpperCase();
      return `OPERATIONAL_${serviceCode}_${decision.failureCode}`;
    });
    const proofRequired = [...new Set(impactedDecisions
      .map((decision) => decision.proofRequired)
      .filter(Boolean))];

    return [command, {
      command,
      mode: blockingDecisions.length
        ? "blocked"
        : degradedDecisions.length
          ? "degraded-allowed"
          : "ready",
      blocked: blockingDecisions.length > 0,
      degradedAllowed: degradedDecisions.length > 0 && blockingDecisions.length === 0,
      impactedServiceCount: impactedDecisions.length,
      impactedServices: impactedDecisions.map((decision) => decision.service),
      blockingServices: blockingDecisions.map((decision) => decision.service),
      degradedServices: degradedDecisions.map((decision) => decision.service),
      blockers: blockerCodes,
      retryAfterMs,
      retryAt: retryAfterMs !== null && nowTime !== null
        ? new Date(nowTime + retryAfterMs).toISOString()
        : null,
      proofRequired,
      operatorAction: blockingDecisions[0]?.operatorAction
        || degradedDecisions[0]?.operatorAction
        || null
    }];
  }));
  const requestedState = requestedCommand ? commandStates[requestedCommand] || null : null;
  const blockedCommands = Object.values(commandStates)
    .filter((state) => state.blocked)
    .map((state) => state.command);
  const degradedAllowedCommands = Object.values(commandStates)
    .filter((state) => state.degradedAllowed)
    .map((state) => state.command);
  const retryAfterValues = Object.values(commandStates)
    .map((state) => state.retryAfterMs)
    .filter((retryAfterMs) => retryAfterMs !== null);
  const nextRetryInMs = retryAfterValues.length ? Math.max(...retryAfterValues) : null;

  return {
    generatedAt: now,
    contract: "hosted-kernel-install-plan-operational-command-gate",
    status: blockedCommands.length
      ? "blocking"
      : degradedAllowedCommands.length
        ? "degraded-available"
        : "ready",
    requestedCommand,
    requestedCommandBlocked: Boolean(requestedState?.blocked),
    requestedCommandMode: requestedState?.mode || null,
    blockedCommands,
    degradedAllowedCommands,
    commandStates,
    requiredProof: [...new Set(Object.values(commandStates).flatMap((state) => state.proofRequired))],
    nextRetryInMs,
    nextRetryAt: nextRetryInMs !== null && nowTime !== null
      ? new Date(nowTime + nextRetryInMs).toISOString()
      : null,
    operatorAction: requestedState?.operatorAction
      || serviceDecisions[0]?.operatorAction
      || "No operational command gate action required."
  };
}

function buildClientWorkflowHandoff({
  now,
  clientRequest,
  previewSettings,
  readiness,
  acceptance,
  nextStep,
  externalHandoff,
  dispatchManifest,
  workspaceBoundary
}) {
  const previewRoute = `${clientRequest.route}/preview`;
  const submitRoute = `${clientRequest.route}/handoff`;
  const acknowledgementRoute = `${clientRequest.route}/handoff/ack`;
  const blocked = nextStep.blocked || acceptance.gate === "blocked";
  const needsAcceptance = acceptance.required && !acceptance.accepted;
  const dispatchable = !blocked && !needsAcceptance && externalHandoff.dispatchable;
  const replay = dispatchManifest.replay || dispatchManifest.state === "already-applied";
  const primaryBlockedReason = dispatchManifest.blockingReasons[0]
    || workspaceBoundary.holdReason
    || nextStep.reason
    || externalHandoff.holdReason
    || readiness.missingProof[0]
    || null;
  const routeIntent = dispatchable
    ? replay
      ? "replay-hosted-kernel-command"
      : "submit-hosted-kernel-command"
    : needsAcceptance
      ? "collect-client-acceptance"
      : readiness.canPreview
        ? "render-preview"
        : "resolve-blockers";
  const nextView = dispatchable
    ? "install-plan-handoff"
    : needsAcceptance
      ? "install-plan-acceptance"
      : readiness.canPreview
        ? "install-plan-preview"
        : "install-plan-blocked";
  const handoffId = [
    surfaceId,
    clientRequest.requestId || "request-missing",
    clientRequest.workflow.handoffTarget,
    dispatchManifest.manifestId
  ].join(":");
  const commandEnvelopeRefs = dispatchManifest.commandEnvelopes.map((envelope) => ({
    sequence: envelope.sequence,
    envelopeId: envelope.envelopeId,
    idempotencyKey: envelope.idempotencyKey,
    command: envelope.command,
    stepId: envelope.stepId,
    packageName: envelope.packageName,
    providerContractId: envelope.target.providerContractId,
    providerId: envelope.target.providerId,
    providerService: envelope.proofRefs.providerService,
    checksumPresent: Boolean(envelope.checksum)
  }));
  const pendingCommandEnvelopeIds = commandEnvelopeRefs.map((envelope) => envelope.envelopeId);
  const providerRouteSummary = Object.entries(dispatchManifest.eligibleProviderRoutes).map(([service, route]) => ({
    service,
    requestedService: route.requestedService,
    routeService: route.routeService,
    contractId: route.contractId,
    providerId: route.providerId,
    fallbackUsed: route.fallbackUsed,
    syncCursorPresent: Boolean(route.syncCursor),
    lastSyncedAt: route.lastSyncedAt,
    endpointPresent: Boolean(route.endpoint?.url),
    endpointProtocol: route.endpoint?.protocol || null,
    endpointAuthMode: route.endpoint?.authMode || null
  }));
  const proofRequirements = [
    ...(previewSettings.requireExplicitAcceptance ? ["client-acceptance-token"] : []),
    "workspace-boundary-token",
    "dispatch-manifest",
    ...(dispatchManifest.commandEnvelopeCount ? ["command-envelope-idempotency-keys"] : []),
    ...(readiness.missingProof || [])
  ];
  const statePatch = {
    requestId: clientRequest.requestId,
    correlationId: clientRequest.correlationId,
    workflowState: dispatchable
      ? "submitted"
      : needsAcceptance
        ? "previewed"
        : blocked
          ? clientRequest.workflow.state
          : "draft",
    currentView: nextView,
    returnTo: clientRequest.workflow.returnTo,
    handoffTarget: clientRequest.workflow.handoffTarget,
    handoffState: dispatchable
      ? replay
        ? "acknowledged"
        : "pending"
      : blocked
        ? "failed"
        : "none",
    handoffId,
    dispatchManifestId: dispatchManifest.manifestId,
    pendingCommandEnvelopeIds,
    lastBlockingReason: dispatchable ? null : primaryBlockedReason,
    replayIdempotencyKey: dispatchManifest.replayIdempotencyKey
  };

  return {
    generatedAt: now,
    contract: "hosted-kernel-install-plan-client-workflow-handoff",
    requestId: clientRequest.requestId,
    correlationId: clientRequest.correlationId,
    clientId: clientRequest.clientId,
    sessionId: clientRequest.sessionId,
    source: clientRequest.source,
    intent: clientRequest.intent,
    route: clientRequest.route,
    tenantId: workspaceBoundary.tenantId,
    workspaceId: workspaceBoundary.workspaceId,
    actorId: workspaceBoundary.actorId,
    auditSink: workspaceBoundary.auditSink,
    currentView: clientRequest.workflow.currentView,
    returnTo: clientRequest.workflow.returnTo,
    target: clientRequest.workflow.handoffTarget,
    handoffId,
    routeIntent,
    nextView,
    state: dispatchable
      ? replay
        ? "ready-to-replay"
        : "ready-to-submit"
      : needsAcceptance
        ? "awaiting-client-acceptance"
        : blocked
          ? "blocked"
          : "preview-ready",
    dispatchable,
    replay,
    previewRoute,
    submitRoute,
    acknowledgementRoute,
    handoffTokenPresent: Boolean(clientRequest.workflow.handoffToken),
    acceptanceTokenPresent: Boolean(previewSettings.acceptanceToken),
    dispatchManifestId: dispatchManifest.manifestId,
    dispatchManifestState: dispatchManifest.state,
    commandEnvelopeCount: dispatchManifest.commandEnvelopeCount,
    commandEnvelopeRefs,
    providerRouteSummary,
    proofRequirements: [...new Set(proofRequirements)],
    statePatch,
    handoffEnvelope: {
      contentType: "application/vnd.aios.hosted-kernel.install-plan-handoff+json",
      handoffId,
      target: clientRequest.workflow.handoffTarget,
      submitRoute,
      acknowledgementRoute,
      requestId: clientRequest.requestId,
      correlationId: clientRequest.correlationId,
      manifestId: dispatchManifest.manifestId,
      manifestState: dispatchManifest.state,
      command: dispatchManifest.command,
      idempotencyKeys: commandEnvelopeRefs.map((envelope) => envelope.idempotencyKey),
      replayIdempotencyKey: dispatchManifest.replayIdempotencyKey,
      boundary: {
        tenantId: workspaceBoundary.tenantId,
        workspaceId: workspaceBoundary.workspaceId,
        boundaryTokenPresent: workspaceBoundary.boundaryTokenPresent
      },
      providerRoutes: providerRouteSummary,
      providerEndpoints: providerRouteSummary
        .filter((route) => route.endpointPresent)
        .map((route) => ({
          service: route.service,
          contractId: route.contractId,
          providerId: route.providerId,
          protocol: route.endpointProtocol,
          authMode: route.endpointAuthMode
        })),
      proofRefs: {
        acceptanceTokenPresent: Boolean(previewSettings.acceptanceToken),
        handoffTokenPresent: Boolean(clientRequest.workflow.handoffToken),
        auditSink: workspaceBoundary.auditSink,
        missingProof: readiness.missingProof
      }
    },
    userVisibleHandoff: {
      title: replay ? "Replay hosted-kernel install handoff" : "Submit hosted-kernel install handoff",
      primaryAction: dispatchable
        ? replay
          ? "Replay handoff"
          : "Submit handoff"
        : needsAcceptance
          ? "Review and accept"
          : "Resolve blockers",
      secondaryAction: clientRequest.workflow.returnTo ? "Return to workflow" : "Keep reviewing",
      statusLabel: dispatchable
        ? `${dispatchManifest.commandEnvelopeCount} command envelope${dispatchManifest.commandEnvelopeCount === 1 ? "" : "s"} ready`
        : primaryBlockedReason || "Preview is not ready for handoff",
      blockingReasons: dispatchable
        ? []
        : [...new Set([
          primaryBlockedReason,
          ...dispatchManifest.blockingReasons,
          ...readiness.missingProof
        ].filter(Boolean))]
    },
    requiredClientAction: dispatchable
      ? replay
        ? "replay-hosted-kernel-handoff"
        : "submit-hosted-kernel-handoff"
      : needsAcceptance
        ? "collect-preview-acceptance"
        : readiness.canPreview
          ? "show-install-plan-preview"
          : "resolve-install-plan-blockers",
    blockedReason: dispatchable
      ? null
      : needsAcceptance
        ? "ACCEPTANCE_REQUIRED"
        : primaryBlockedReason
  };
}

function buildClientPreviewAcceptanceModel({
  now,
  preview,
  readiness,
  validationSummary,
  acceptance,
  nextStep,
  clientWorkflowHandoff,
  dispatchManifest,
  providerServiceBindings,
  workspaceBoundary,
  operationalRecovery,
  operationalCommandGate
}) {
  const readinessItems = [
    {
      key: "package-audit-proof",
      label: "Package audit proof",
      state: readiness.auditReady ? "ready" : "missing-proof",
      required: true,
      missingProof: readiness.auditReady
        ? []
        : readiness.missingProof.filter((proof) => ["pinned-package-versions", "package-checksums"].includes(proof)),
      action: readiness.auditReady ? "No package audit action required." : "Pin versions and attach checksums before enabling."
    },
    {
      key: "provider-routing",
      label: "Provider routing",
      state: readiness.providerReady && readiness.providerServiceBindingReady ? "ready" : "held",
      required: true,
      missingProof: readiness.missingProof.filter((proof) => proof.includes("provider")),
      action: providerServiceBindings.ready
        ? "Provider service bindings are ready."
        : "Bind a compatible provider contract for each required hosted-kernel service."
    },
    {
      key: "workspace-boundary",
      label: "Workspace boundary",
      state: workspaceBoundary.dispatchable ? "ready" : "held",
      required: true,
      missingProof: workspaceBoundary.dispatchable ? [] : ["workspace-boundary-proof"],
      action: workspaceBoundary.dispatchable
        ? "Workspace boundary token and provider scope are ready."
        : workspaceBoundary.holdReason || "Refresh the workspace boundary token before handoff."
    },
    {
      key: "operational-health",
      label: "Operational health",
      state: operationalCommandGate.requestedCommandBlocked
        ? "command-blocked"
        : operationalRecovery.recommendedMode === "normal"
          ? "ready"
          : operationalRecovery.recommendedMode,
      required: operationalRecovery.recommendedMode === "hold" || operationalCommandGate.requestedCommandBlocked,
      missingProof: operationalRecovery.recommendedMode === "normal" ? [] : operationalCommandGate.requiredProof,
      action: operationalCommandGate.operatorAction || operationalRecovery.operatorAction
    },
    {
      key: "client-acceptance",
      label: "Client acceptance",
      state: acceptance.accepted ? "accepted" : acceptance.required ? "required" : "not-required",
      required: acceptance.required,
      missingProof: acceptance.accepted || !acceptance.required ? [] : ["client-acceptance-token"],
      action: acceptance.accepted
        ? "Acceptance evidence is attached."
        : acceptance.required
          ? "Collect explicit preview acceptance before submitting the handoff."
          : "No explicit acceptance is required for this command."
    }
  ];
  const blockingItems = readinessItems.filter((item) => item.required && item.state !== "ready" && item.state !== "accepted");
  const validationPanel = {
    status: validationSummary.status,
    tone: validationSummary.status === "invalid"
      ? "error"
      : validationSummary.status === "needs-attention"
        ? "warning"
        : "success",
    errorCount: validationSummary.errorCount,
    warningCount: validationSummary.warningCount,
    packageWarningCount: validationSummary.packageWarningCount,
    providerIssueCount: validationSummary.providerIssueCount,
    blockedStepIds: validationSummary.blockedStepIds,
    retryableStepIds: validationSummary.retryableStepIds,
    affectedProviderContractIds: validationSummary.affectedProviderContractIds,
    firstAction: validationSummary.firstAction
  };
  const acceptancePanel = {
    gate: acceptance.gate,
    required: acceptance.required,
    accepted: acceptance.accepted,
    acceptedBy: acceptance.acceptedBy,
    acceptedAt: acceptance.acceptedAt,
    acceptanceTokenPresent: acceptance.acceptanceTokenPresent,
    blockedReason: acceptance.blockedReason,
    primaryAction: acceptance.accepted
      ? "Continue to handoff"
      : acceptance.required
        ? "Accept preview"
        : "Continue",
    disabled: acceptance.gate === "blocked",
    disabledReason: acceptance.gate === "blocked" ? acceptance.blockedReason : null
  };
  const routePayloads = {
    preview: {
      method: "GET",
      route: clientWorkflowHandoff.previewRoute,
      contentType: "application/vnd.aios.hosted-kernel.install-plan-preview+json",
      requestId: preview.requestId,
      visibleStepCount: preview.visibleStepCount,
      readinessState: readiness.state
    },
    accept: {
      method: "POST",
      route: `${clientWorkflowHandoff.previewRoute}/accept`,
      contentType: "application/vnd.aios.hosted-kernel.install-plan-acceptance+json",
      requestId: preview.requestId,
      required: acceptance.required,
      accepted: acceptance.accepted,
      blockedReason: acceptance.blockedReason,
      requiredProof: readinessItems.flatMap((item) => item.missingProof)
    },
    next: {
      method: clientWorkflowHandoff.dispatchable ? "POST" : "GET",
      route: clientWorkflowHandoff.dispatchable
        ? clientWorkflowHandoff.submitRoute
        : clientWorkflowHandoff.previewRoute,
      contentType: clientWorkflowHandoff.dispatchable
        ? clientWorkflowHandoff.handoffEnvelope.contentType
        : "application/vnd.aios.hosted-kernel.install-plan-preview+json",
      requiredClientAction: clientWorkflowHandoff.requiredClientAction,
      command: nextStep.command,
      dispatchManifestId: dispatchManifest.manifestId,
      dispatchable: clientWorkflowHandoff.dispatchable
    }
  };

  return {
    generatedAt: now,
    contract: "hosted-kernel-install-plan-preview-acceptance-model",
    requestId: preview.requestId,
    tenantId: preview.tenantId,
    workspaceId: preview.workspaceId,
    state: clientWorkflowHandoff.state,
    currentView: clientWorkflowHandoff.nextView,
    title: preview.title,
    displayMode: preview.displayMode,
    readinessChecklist: readinessItems,
    blockingItemKeys: blockingItems.map((item) => item.key),
    validationPanel,
    acceptancePanel,
    nextStep: {
      type: nextStep.type,
      command: nextStep.command,
      blocked: nextStep.blocked,
      explanation: nextStep.explanation,
      requiresAcceptance: nextStep.requiresAcceptance,
      routeIntent: clientWorkflowHandoff.routeIntent,
      requiredClientAction: clientWorkflowHandoff.requiredClientAction
    },
    routePayloads,
    statePatch: {
      ...clientWorkflowHandoff.statePatch,
      previewAcceptanceState: acceptancePanel.gate,
      readinessChecklistState: blockingItems.length ? "attention-required" : "complete",
      validationPanelTone: validationPanel.tone,
      nextRoute: routePayloads.next.route,
      nextRouteMethod: routePayloads.next.method
    }
  };
}

function buildLifecycleControls({ settings, health, validation, steps }) {
  const hasValidationErrors = validation.errors.length > 0;
  const hasRunningSteps = steps.some((step) => step.status === "running");
  const failedRequired = steps.some((step) => step.required && step.status === "failed");
  const auditable = !validation.warnings.some((warning) => [
    "PACKAGE_VERSION_UNPINNED",
    "PACKAGE_CHECKSUM_MISSING",
    "ENABLE_REQUIRES_AUDITABLE_STEPS"
  ].includes(warning.code));
  const scheduleReady = settings.mode !== "scheduled" || Boolean(settings.scheduledAt);

  return {
    enabled: settings.enabled,
    mode: settings.mode,
    requestedCommand: settings.requestedCommand,
    canPrepare: settings.enabled && !hasValidationErrors,
    canEnable: settings.enabled && health.state !== "blocked" && scheduleReady && (!settings.requireAuditBeforeEnable || auditable),
    canDisable: settings.enabled && (
      settings.allowAutoDisable
      || !hasRunningSteps
      || settings.disableDrainMode === "drain"
      || settings.disableDrainMode === "immediate"
    ),
    canSchedule: settings.enabled && settings.mode === "scheduled" && !hasValidationErrors,
    canResume: settings.enabled && health.state === "degraded" && !failedRequired,
    canRollback: failedRequired || health.state === "blocked",
    auditRequired: settings.requireAuditBeforeEnable && !auditable,
    autoEnableAllowed: settings.allowAutoEnable,
    autoDisableAllowed: settings.allowAutoDisable,
    disableDrainMode: settings.disableDrainMode,
    enableRequiresAcceptance: settings.enableRequiresAcceptance,
    resumeSelectionPolicy: settings.resumeSelectionPolicy,
    disabledReason: settings.enabled ? null : "LIFECYCLE_DISABLED"
  };
}

function buildScheduleControl({ now, settings, lifecycleControls }) {
  const scheduledTime = parseTime(settings.scheduledAt);
  const nowTime = parseTime(now);
  const startsInMs = scheduledTime !== null && nowTime !== null ? scheduledTime - nowTime : null;
  const windowMs = settings.maintenanceWindowMinutes * 60 * 1000;
  const jitterMs = settings.scheduleJitterMinutes * 60 * 1000;
  const driftMs = settings.maxScheduleDriftMinutes * 60 * 1000;
  const earliestDispatchAt = scheduledTime !== null ? new Date(scheduledTime - jitterMs).toISOString() : null;
  const latestDispatchAt = scheduledTime !== null ? new Date(scheduledTime + driftMs).toISOString() : null;
  const insideDispatchWindow = startsInMs !== null
    && startsInMs <= jitterMs
    && startsInMs >= -driftMs;

  return {
    mode: settings.mode,
    scheduledAt: settings.scheduledAt,
    timezone: settings.timezone,
    maintenanceWindowMinutes: settings.maintenanceWindowMinutes,
    scheduleJitterMinutes: settings.scheduleJitterMinutes,
    maxScheduleDriftMinutes: settings.maxScheduleDriftMinutes,
    startsInMs,
    earliestDispatchAt,
    latestDispatchAt,
    insideDispatchWindow,
    windowEndsAt: scheduledTime !== null ? new Date(scheduledTime + windowMs).toISOString() : null,
    dispatchable: lifecycleControls.canSchedule && startsInMs !== null && startsInMs > 0,
    holdReason: settings.mode === "scheduled" && !settings.scheduledAt
      ? "SCHEDULED_AT_REQUIRED"
      : lifecycleControls.disabledReason
  };
}

function buildLifecycleCommandPolicy({
  now,
  settings,
  lifecycleControls,
  scheduleControl,
  retryPolicies,
  health,
  operationalCommandGate,
  validation,
  steps
}) {
  const requestedCommand = LIFECYCLE_COMMANDS.has(settings.requestedCommand) ? settings.requestedCommand : null;
  const retryPolicy = retryPolicies.find((policy) => policy.nextBackoffMs !== null);
  const failedRequiredStepIds = steps
    .filter((step) => step.required && step.status === "failed")
    .map((step) => step.id);
  const runningStepIds = steps
    .filter((step) => step.status === "running")
    .map((step) => step.id);
  const blockersByCommand = {
    prepare: [
      ...(!lifecycleControls.canPrepare ? ["VALIDATION_ERRORS_PRESENT"] : []),
      ...asArray(operationalCommandGate.commandStates.prepare?.blockers)
    ],
    enable: [
      ...(!lifecycleControls.enabled ? ["LIFECYCLE_DISABLED"] : []),
      ...(health.state === "blocked" ? [health.reason] : []),
      ...(!lifecycleControls.canEnable && lifecycleControls.auditRequired ? ["ENABLE_REQUIRES_AUDITABLE_STEPS"] : []),
      ...(!lifecycleControls.canEnable && !lifecycleControls.auditRequired ? ["ENABLE_PREREQUISITES_NOT_MET"] : []),
      ...asArray(operationalCommandGate.commandStates.enable?.blockers)
    ],
    disable: [
      ...(!lifecycleControls.enabled ? ["LIFECYCLE_ALREADY_DISABLED"] : []),
      ...(!lifecycleControls.canDisable ? ["RUNNING_STEPS_REQUIRE_DRAIN"] : []),
      ...(runningStepIds.length && settings.disableDrainMode === "hold" ? ["DISABLE_HELD_FOR_RUNNING_STEPS"] : []),
      ...asArray(operationalCommandGate.commandStates.disable?.blockers)
    ],
    schedule: [
      ...(!lifecycleControls.enabled ? ["LIFECYCLE_DISABLED"] : []),
      ...(settings.mode !== "scheduled" ? ["SCHEDULED_MODE_REQUIRED"] : []),
      ...(!settings.scheduledAt ? ["SCHEDULED_AT_REQUIRED"] : []),
      ...(scheduleControl.startsInMs !== null && scheduleControl.startsInMs <= 0 ? ["SCHEDULED_AT_PAST"] : []),
      ...(!lifecycleControls.canSchedule ? ["SCHEDULE_VALIDATION_BLOCKED"] : []),
      ...asArray(operationalCommandGate.commandStates.schedule?.blockers)
    ],
    resume: [
      ...(!lifecycleControls.enabled ? ["LIFECYCLE_DISABLED"] : []),
      ...(!retryPolicy && !lifecycleControls.canResume ? ["NO_RETRYABLE_OR_DEGRADED_WORK"] : []),
      ...asArray(operationalCommandGate.commandStates.resume?.blockers)
    ],
    rollback: [
      ...(!lifecycleControls.canRollback ? ["ROLLBACK_NOT_REQUIRED"] : []),
      ...asArray(operationalCommandGate.commandStates.rollback?.blockers)
    ],
    audit: [
      ...(steps.length ? [] : ["INSTALL_STEPS_REQUIRED"]),
      ...asArray(operationalCommandGate.commandStates.audit?.blockers)
    ]
  };
  const commandStates = Object.fromEntries([...LIFECYCLE_COMMANDS].map((command) => {
    const blockers = blockersByCommand[command] || [];
    const mutatesRuntime = ["enable", "disable", "schedule", "resume", "rollback"].includes(command);
    const writesPersistence = ["enable", "schedule", "resume", "rollback"].includes(command);
    const route = command === "audit"
      ? "package-sdk/install-plan/audit"
      : command === "prepare"
        ? "package-sdk/install-plan/preview"
        : "hosted-kernel/package-command";
    const statePatch = {
      lifecycleCommand: command,
      controlsEnabled: lifecycleControls.enabled,
      commandState: blockers.length ? "blocked" : "available",
      requested: requestedCommand === command,
      mutatesRuntime,
      writesPersistence,
      requiresProviderHandoff: ["enable", "schedule", "resume", "rollback"].includes(command),
      requiresAcceptance: command === "enable" && settings.enableRequiresAcceptance,
      requiresDrain: command === "disable" && runningStepIds.length > 0 && settings.disableDrainMode === "drain",
      disableDrainMode: command === "disable" ? settings.disableDrainMode : null,
      resumeSelectionPolicy: command === "resume" ? settings.resumeSelectionPolicy : null,
      scheduledAt: command === "schedule" ? settings.scheduledAt : null,
      earliestDispatchAt: command === "schedule" ? scheduleControl.earliestDispatchAt : null,
      latestDispatchAt: command === "schedule" ? scheduleControl.latestDispatchAt : null,
      blockedBy: blockers
    };
    const operationalGate = operationalCommandGate.commandStates[command] || null;
    return [command, {
      allowed: blockers.length === 0,
      blockers,
      effect: LIFECYCLE_COMMAND_EFFECTS[command],
      route,
      mutatesRuntime,
      writesPersistence,
      requiresDrain: statePatch.requiresDrain,
      requiresAcceptance: statePatch.requiresAcceptance,
      scheduledAt: statePatch.scheduledAt,
      operationalMode: operationalGate?.mode || "ready",
      operationalProofRequired: operationalGate?.proofRequired || [],
      operationalRetryAt: operationalGate?.retryAt || null,
      operationalOperatorAction: operationalGate?.operatorAction || null,
      statePatch
    }];
  }));
  const operatorActions = Object.entries(commandStates)
    .filter(([, state]) => state.allowed)
    .map(([command, state]) => ({
      command,
      label: command === "enable"
        ? "Enable install plan"
        : command === "disable"
          ? settings.disableDrainMode === "immediate"
            ? "Disable immediately"
            : "Disable after drain"
          : command === "schedule"
            ? "Schedule maintenance handoff"
            : command === "resume"
              ? "Resume eligible steps"
              : command === "rollback"
                ? "Rollback failed required steps"
                : command === "audit"
                  ? "Export audit proof"
                  : "Prepare preview",
      route: state.route,
      requiresAcceptance: state.requiresAcceptance,
      writesPersistence: state.writesPersistence,
      scheduledAt: state.scheduledAt
    }));
  const fallbackCommand = retryPolicy
    ? "resume"
    : scheduleControl.dispatchable
      ? "schedule"
      : lifecycleControls.auditRequired
        ? "audit"
        : health.state === "healthy"
          ? "enable"
          : "prepare";
  const effectiveCommand = requestedCommand || fallbackCommand;
  const effectiveState = commandStates[effectiveCommand];

  return {
    generatedAt: now,
    requestedCommand,
    effectiveCommand,
    fallbackCommand,
    allowed: Boolean(effectiveState?.allowed),
    blockedReason: effectiveState?.blockers[0] || null,
    blockers: effectiveState?.blockers || [],
    effect: effectiveState?.effect || null,
    retryStepId: effectiveCommand === "resume" ? retryPolicy?.stepId || null : null,
    retryWaitMs: effectiveCommand === "resume" ? retryPolicy?.nextBackoffMs || null : null,
    scheduledAt: effectiveCommand === "schedule" ? settings.scheduledAt : null,
    scheduleStartsInMs: effectiveCommand === "schedule" ? scheduleControl.startsInMs : null,
    failedRequiredStepIds,
    runningStepIds,
    disableDrainMode: settings.disableDrainMode,
    resumeSelectionPolicy: settings.resumeSelectionPolicy,
    scheduleWindow: {
      scheduledAt: settings.scheduledAt,
      earliestDispatchAt: scheduleControl.earliestDispatchAt,
      latestDispatchAt: scheduleControl.latestDispatchAt,
      insideDispatchWindow: scheduleControl.insideDispatchWindow,
      maintenanceWindowMinutes: settings.maintenanceWindowMinutes,
      scheduleJitterMinutes: settings.scheduleJitterMinutes,
      maxScheduleDriftMinutes: settings.maxScheduleDriftMinutes
    },
    operationalCommandGate,
    operatorActions,
    commandStates
  };
}

function buildNextAction({ health, lifecycleControls, scheduleControl, retryPolicies, validation, commandPolicy }) {
  const retryPolicy = retryPolicies.find((policy) => policy.nextBackoffMs !== null);

  if (validation.errors.length) {
    return {
      type: "fix-validation",
      reason: validation.errors[0].code,
      command: "audit",
      blocked: true
    };
  }

  if (commandPolicy.requestedCommand && !commandPolicy.allowed) {
    return {
      type: "requested-command-blocked",
      reason: commandPolicy.blockedReason,
      command: commandPolicy.effectiveCommand,
      stepId: commandPolicy.retryStepId || undefined,
      scheduledAt: commandPolicy.scheduledAt || undefined,
      waitMs: commandPolicy.retryWaitMs || undefined,
      blocked: true
    };
  }

  if (commandPolicy.requestedCommand && commandPolicy.allowed) {
    return {
      type: "requested-command",
      reason: "REQUESTED_LIFECYCLE_COMMAND_READY",
      command: commandPolicy.effectiveCommand,
      stepId: commandPolicy.retryStepId || undefined,
      scheduledAt: commandPolicy.scheduledAt || undefined,
      waitMs: commandPolicy.retryWaitMs || undefined,
      blocked: false
    };
  }

  if (!lifecycleControls.enabled) {
    return {
      type: "enable-controls",
      reason: lifecycleControls.disabledReason,
      command: "enable",
      blocked: true
    };
  }

  if (retryPolicy) {
    return {
      type: "retry-step",
      reason: "RETRYABLE_INSTALL_STEP_FAILED",
      command: "resume",
      stepId: retryPolicy.stepId,
      waitMs: retryPolicy.nextBackoffMs,
      blocked: false
    };
  }

  if (scheduleControl.dispatchable) {
    return {
      type: "dispatch-scheduled-window",
      reason: "SCHEDULE_READY",
      command: "schedule",
      scheduledAt: scheduleControl.scheduledAt,
      blocked: false
    };
  }

  if (lifecycleControls.auditRequired) {
    return {
      type: "complete-audit",
      reason: "ENABLE_REQUIRES_AUDITABLE_STEPS",
      command: "audit",
      blocked: health.state === "blocked"
    };
  }

  return {
    type: health.state === "healthy" ? "enable-install-plan" : "prepare-install-plan",
    reason: health.reason,
    command: health.state === "healthy" ? "enable" : "prepare",
    blocked: health.state === "blocked"
  };
}

function buildValidationSummary({ validation, steps, providerContracts }) {
  const packageWarnings = validation.warnings.filter((warning) => warning.stepId);
  const providerIssues = [...validation.errors, ...validation.warnings].filter((issue) => issue.contractId);
  const blockedStepIds = steps
    .filter((step) => step.required && step.status === "failed" && classifyFailure(step) !== "retryable")
    .map((step) => step.id);
  const retryableStepIds = steps
    .filter((step) => step.required && classifyFailure(step) === "retryable")
    .map((step) => step.id);

  return {
    status: validation.errors.length ? "invalid" : validation.warnings.length ? "needs-attention" : "valid",
    errorCount: validation.errors.length,
    warningCount: validation.warnings.length,
    packageWarningCount: packageWarnings.length,
    providerIssueCount: providerIssues.length,
    blockedStepIds,
    retryableStepIds,
    affectedProviderContractIds: [...new Set(providerIssues.map((issue) => issue.contractId))],
    providerContractStates: Object.fromEntries(providerContracts.map((contract) => [
      contract.contractId,
      contract.state
    ])),
    firstAction: validation.errors[0]?.action || validation.warnings[0]?.action || null
  };
}

function buildReadinessContract({
  analytics,
  health,
  validationSummary,
  lifecycleControls,
  scheduleControl,
  capabilityNegotiation,
  providerServiceBindings,
  providerIntegrationContract,
  externalHandoff,
  operationalRecovery,
  operationalCommandGate,
  persistedStateRecovery,
  workspaceBoundary
}) {
  const auditReady = analytics.checksumCoverageCount === analytics.stepCount
    && analytics.pinnedVersionCount === analytics.stepCount
    && validationSummary.errorCount === 0;
  const providerReady = capabilityNegotiation.acceptedContractCount > 0
    && capabilityNegotiation.degradedContractCount === 0
    && providerServiceBindings.ready;
  const lifecycleReady = lifecycleControls.canPrepare
    && (lifecycleControls.canEnable || lifecycleControls.auditRequired || scheduleControl.dispatchable);
  const operationalCommandReady = !operationalCommandGate.requestedCommandBlocked
    && !operationalCommandGate.blockedCommands.includes("prepare");
  const persistenceReady = !persistedStateRecovery
    || persistedStateRecovery.safeToDispatch
    || persistedStateRecovery.commandIntent === "replay";

  return {
    state: health.state === "blocked"
      ? "blocked"
      : auditReady && providerReady && lifecycleReady && operationalCommandReady && persistenceReady && externalHandoff.dispatchable
        ? "ready"
        : "review",
    canPreview: analytics.stepCount > 0,
    canAccept: health.state !== "blocked" && validationSummary.errorCount === 0 && providerReady,
    auditReady,
    providerReady,
    lifecycleReady,
    operationalCommandReady,
    operationalCommandGateState: operationalCommandGate.status,
    operationalCommandGateRequestedMode: operationalCommandGate.requestedCommandMode,
    persistenceReady,
    providerIntegrationReady: providerIntegrationContract.dispatchable,
    externalHandoffReady: externalHandoff.dispatchable,
    providerServiceBindingReady: providerServiceBindings.ready,
    workspaceBoundaryReady: workspaceBoundary.dispatchable,
    missingProof: [
      ...(analytics.pinnedVersionCount === analytics.stepCount ? [] : ["pinned-package-versions"]),
      ...(analytics.checksumCoverageCount === analytics.stepCount ? [] : ["package-checksums"]),
      ...(providerReady ? [] : ["active-provider-contract"]),
      ...(providerServiceBindings.ready ? [] : ["provider-service-binding-proof"]),
      ...(providerIntegrationContract.dispatchable ? [] : ["provider-integration-contract-proof"]),
      ...(lifecycleReady ? [] : ["lifecycle-command-readiness"]),
      ...(operationalCommandReady ? [] : ["operational-command-gate-proof"]),
      ...(operationalRecovery.recommendedMode === "normal" ? [] : ["operational-health-recovery"]),
      ...(persistenceReady ? [] : ["persisted-state-recovery"]),
      ...(workspaceBoundary.dispatchable ? [] : ["workspace-boundary-proof"])
    ]
  };
}

function buildPersistenceWriteSet({
  now,
  persistedState,
  persistedStateRecovery,
  hostedKernel,
  steps,
  clientRequest,
  workspaceBoundary,
  nextAction,
  lifecycleCommandPolicy,
  externalHandoff,
  validationSummary
}) {
  const expectedGeneration = persistedState.generation + 1;
  const commandAlreadyRecorded = persistedState.commandLedger
    .some((command) => command.idempotencyKey === persistedStateRecovery.expectedIdempotencyKey);
  const duplicateCommandKeys = persistedState.commandLedger
    .reduce((duplicates, command, index, ledger) => {
      const repeated = ledger.findIndex((candidate) => (
        candidate.idempotencyKey === command.idempotencyKey
      )) !== index;
      return repeated && !duplicates.includes(command.idempotencyKey)
        ? [...duplicates, command.idempotencyKey]
        : duplicates;
    }, []);
  const checkpointedStepIds = new Set(persistedState.checkpoints
    .filter((checkpoint) => checkpoint.stepId)
    .map((checkpoint) => checkpoint.stepId));
  const checkpointUpserts = steps
    .filter((step) => RESTART_SAFE_STEP_STATUSES.has(step.status) || checkpointedStepIds.has(step.id))
    .map((step) => ({
      id: `${persistedState.planId || clientRequest.requestId || "install-plan"}:${step.id}`,
      stepId: step.id,
      packageName: step.packageName,
      version: step.version,
      action: step.action,
      status: step.status,
      failureCode: step.failureCode,
      restartSafe: RESTART_SAFE_STEP_STATUSES.has(step.status),
      retryable: classifyFailure(step) === "retryable",
      persistedAt: now,
      generation: expectedGeneration
    }));
  const deniedReasons = [
    ...(persistedStateRecovery.commandIntent === "hold" ? ["PERSISTED_STATE_RECOVERY_HELD"] : []),
    ...(persistedStateRecovery.commandIntent === "noop" ? ["PERSISTED_COMMAND_ALREADY_APPLIED"] : []),
    ...asArray(persistedStateRecovery.recoveryBlockers),
    ...(duplicateCommandKeys.length ? ["DUPLICATE_IDEMPOTENCY_KEYS"] : []),
    ...(validationSummary.status === "invalid" ? ["VALIDATION_ERRORS_PRESENT"] : []),
    ...(externalHandoff.dispatchable ? [] : [externalHandoff.holdReason || "EXTERNAL_HANDOFF_HELD"])
  ];
  const shouldAppendCommand = externalHandoff.dispatchable
    && !commandAlreadyRecorded
    && !duplicateCommandKeys.length;
  const writeMode = deniedReasons.length
    ? "read-only"
    : persistedStateRecovery.commandIntent === "replay"
      ? "replay-existing-command"
      : shouldAppendCommand
        ? "append-command-and-checkpoints"
        : "checkpoint-only";

  return {
    generatedAt: now,
    contract: "hosted-kernel-install-plan-persistence-write-set",
    planId: persistedState.planId || clientRequest.requestId,
    requestId: clientRequest.requestId,
    hostedKernelId: hostedKernel?.id || null,
    tenantId: workspaceBoundary.tenantId,
    workspaceId: workspaceBoundary.workspaceId,
    currentGeneration: persistedState.generation,
    expectedGeneration,
    status: externalHandoff.dispatchable
      ? "ready-to-persist"
      : persistedStateRecovery.status,
    writeMode,
    writable: !deniedReasons.length,
    deniedReasons,
    duplicateCommandKeys,
    commandAlreadyRecorded,
    commandRecord: shouldAppendCommand ? {
      idempotencyKey: persistedStateRecovery.expectedIdempotencyKey,
      command: nextAction.command,
      state: "pending",
      requestId: clientRequest.requestId,
      stepId: nextAction.stepId || null,
      attempt: 0,
      issuedAt: now,
      completedAt: null,
      resultRef: null,
      errorCode: null,
      lifecycleEffect: lifecycleCommandPolicy.effect
    } : null,
    checkpointUpserts,
    lockPatch: {
      ownerId: workspaceBoundary.actorId || clientRequest.clientId || "hosted-kernel-install-plan",
      acquiredAt: now,
      expiresAt: null,
      fencingToken: [
        persistedState.planId || clientRequest.requestId || surfaceId,
        expectedGeneration
      ].join(":")
    },
    restartStatus: {
      resumeEligibleStepIds: checkpointUpserts
        .filter((checkpoint) => checkpoint.retryable)
        .map((checkpoint) => checkpoint.stepId),
      restartSafeStepIds: checkpointUpserts
        .filter((checkpoint) => checkpoint.restartSafe)
        .map((checkpoint) => checkpoint.stepId),
      recoveredStepCount: persistedStateRecovery.recoveredStepStatuses.length,
      recoveredTerminalStepIds: persistedStateRecovery.terminalStepIds,
      recoveryBlockers: persistedStateRecovery.recoveryBlockers,
      restartShape: persistedStateRecovery.restartShape
    }
  };
}

function buildPersistedStateShape({
  now,
  persistedState,
  persistedStateRecovery,
  persistenceWriteSet,
  clientRequest,
  hostedKernel,
  workspaceBoundary,
  nextAction,
  dispatchManifest
}) {
  const terminalStepIds = new Set(persistedStateRecovery.terminalStepIds);
  const restartSafeStepIds = new Set(persistedStateRecovery.restartSafeStepIds);
  const checkpointPatchByStepId = Object.fromEntries(persistenceWriteSet.checkpointUpserts.map((checkpoint) => [
    checkpoint.stepId,
    {
      checkpointId: checkpoint.id,
      packageName: checkpoint.packageName,
      version: checkpoint.version,
      action: checkpoint.action,
      persistedStatus: terminalStepIds.has(checkpoint.stepId) ? "completed" : checkpoint.status,
      restartSafe: restartSafeStepIds.has(checkpoint.stepId) || checkpoint.restartSafe,
      retryable: checkpoint.retryable,
      generation: checkpoint.generation,
      persistedAt: checkpoint.persistedAt
    }
  ]));
  const commandRecordPatch = persistenceWriteSet.commandRecord
    ? {
      operation: "append",
      record: {
        ...persistenceWriteSet.commandRecord,
        generation: persistenceWriteSet.expectedGeneration,
        dispatchManifestId: dispatchManifest.manifestId
      }
    }
    : persistedStateRecovery.commandIntent === "replay"
      ? {
        operation: "reuse",
        idempotencyKey: persistedStateRecovery.expectedIdempotencyKey,
        existingState: persistedStateRecovery.matchingCommandState,
        dispatchManifestId: dispatchManifest.manifestId
      }
      : persistedStateRecovery.commandIntent === "noop"
        ? {
          operation: "no-op",
          idempotencyKey: persistedStateRecovery.expectedIdempotencyKey,
          existingState: persistedStateRecovery.matchingCommandState,
          reason: "PERSISTED_COMMAND_ALREADY_APPLIED"
        }
        : {
          operation: "none",
          idempotencyKey: persistedStateRecovery.expectedIdempotencyKey,
          reason: persistenceWriteSet.deniedReasons[0] || null
        };
  const atomicPatchMode = persistenceWriteSet.writable
    ? persistenceWriteSet.writeMode === "replay-existing-command"
      ? "reuse-ledger-and-refresh-checkpoints"
      : "compare-generation-and-upsert"
    : persistedStateRecovery.commandIntent === "noop"
      ? "read-existing-terminal-state"
      : "read-only-held";
  const restartStatus = persistedStateRecovery.commandIntent === "noop"
    ? "already-applied"
    : persistedStateRecovery.commandIntent === "replay"
      ? "replay-safe"
      : persistedStateRecovery.commandIntent === "retry"
        ? "retry-safe"
        : persistedStateRecovery.commandIntent === "hold"
          ? "held"
          : "dispatch-safe";

  return {
    generatedAt: now,
    contract: "hosted-kernel-install-plan-persisted-state-shape",
    patchId: [
      surfaceId,
      clientRequest.requestId || "request-missing",
      hostedKernel?.id || "kernel-missing",
      persistenceWriteSet.expectedGeneration
    ].join(":"),
    planId: persistenceWriteSet.planId,
    requestId: clientRequest.requestId,
    hostedKernelId: hostedKernel?.id || null,
    tenantId: workspaceBoundary.tenantId,
    workspaceId: workspaceBoundary.workspaceId,
    command: nextAction.command,
    restartStatus,
    atomicPatchMode,
    writable: persistenceWriteSet.writable,
    deniedReasons: persistenceWriteSet.deniedReasons,
    expectedGeneration: persistenceWriteSet.expectedGeneration,
    compareGeneration: persistedState.generation,
    idempotencyKey: persistedStateRecovery.expectedIdempotencyKey,
    idempotencyDecision: commandRecordPatch.operation,
    dispatchManifestId: dispatchManifest.manifestId,
    commandRecordPatch,
    checkpointPatchByStepId,
    checkpointPatchCount: Object.keys(checkpointPatchByStepId).length,
    terminalStepIds: [...terminalStepIds],
    restartSafeStepIds: [...restartSafeStepIds],
    activeConflictingCommandKeys: persistedStateRecovery.activeConflictingCommandKeys,
    lockPatch: persistenceWriteSet.writable ? persistenceWriteSet.lockPatch : null,
    statusPatch: {
      status: restartStatus,
      lastPersistedAt: persistenceWriteSet.writable ? now : persistedState.lastPersistedAt,
      generation: persistenceWriteSet.writable ? persistenceWriteSet.expectedGeneration : persistedState.generation,
      lastCommand: nextAction.command,
      lastManifestId: dispatchManifest.manifestId,
      lastBlockingReasons: persistenceWriteSet.deniedReasons,
      resumeEligibleStepIds: persistenceWriteSet.restartStatus.resumeEligibleStepIds,
      recoveredTerminalStepIds: persistenceWriteSet.restartStatus.recoveredTerminalStepIds
    },
    recoverySemantics: {
      duplicateDispatchPrevented: ["reuse", "no-op"].includes(commandRecordPatch.operation),
      safeToApplyAfterRestart: persistenceWriteSet.writable || ["replay-safe", "already-applied"].includes(restartStatus),
      requiresCompareAndSwap: persistenceWriteSet.writable,
      requiresOperatorIntervention: restartStatus === "held",
      replayUsesExistingIdempotencyKey: persistedStateRecovery.commandIntent === "replay"
    }
  };
}

function buildPreviewContract({
  now,
  clientRequest,
  hostedKernel,
  steps,
  previewSettings,
  readiness,
  validationSummary,
  nextAction,
  externalHandoff,
  capabilityNegotiation,
  providerServiceBindings,
  workspaceBoundary
}) {
  const visibleSteps = steps
    .filter((step) => previewSettings.includeOptionalSteps || step.required)
    .slice(0, previewSettings.stepLimit);

  return {
    generatedAt: now,
    title: "Hosted kernel package install preview",
    requestId: clientRequest.requestId,
    clientId: clientRequest.clientId,
    hostedKernelId: hostedKernel?.id || null,
    state: readiness.state,
    displayMode: validationSummary.status === "valid" ? "ready" : "review",
    stepCount: steps.length,
    visibleStepCount: visibleSteps.length,
    hiddenStepCount: Math.max(steps.length - visibleSteps.length, 0),
    nextCommand: nextAction.command,
    handoffState: externalHandoff.state,
    tenantId: workspaceBoundary.tenantId,
    workspaceId: workspaceBoundary.workspaceId,
    workspaceBoundaryState: workspaceBoundary.dispatchable ? "ready" : "held",
    workspaceBoundaryHoldReason: workspaceBoundary.holdReason,
    rows: visibleSteps.map((step) => ({
      stepId: step.id,
      label: [step.packageName, step.version].filter(Boolean).join("@") || step.id,
      action: step.action,
      status: step.status,
      required: step.required,
      hasChecksum: Boolean(step.checksum),
      failureClass: classifyFailure(step)
    })),
    providerBadges: previewSettings.includeProviderDetail
      ? capabilityNegotiation.contracts.map((contract) => ({
        contractId: contract.contractId,
        service: contract.service,
        state: contract.state,
        accepted: contract.accepted,
        handoffEligible: contract.handoffEligible,
        serviceBindingState: providerServiceBindings.bindings
          .find((binding) => binding.electedContractId === contract.contractId)?.state || null,
        fallbackUsed: providerServiceBindings.fallbackContractIds.includes(contract.contractId)
      }))
      : []
  };
}

function buildAcceptanceContract({ now, previewSettings, readiness, validationSummary, nextAction, lifecycleControls }) {
  const explicitAccepted = Boolean(previewSettings.acceptedBy && previewSettings.acceptanceToken);
  const required = previewSettings.requireExplicitAcceptance
    || (nextAction.command === "enable" && lifecycleControls.enableRequiresAcceptance);
  const accepted = readiness.canAccept && (!required || explicitAccepted);

  return {
    required,
    accepted,
    acceptedBy: explicitAccepted ? previewSettings.acceptedBy : null,
    acceptedAt: accepted ? now : null,
    acceptanceTokenPresent: Boolean(previewSettings.acceptanceToken),
    gate: accepted ? "accepted" : readiness.canAccept ? "awaiting-acceptance" : "blocked",
    blockedReason: readiness.canAccept
      ? required && !explicitAccepted
        ? "ACCEPTANCE_REQUIRED"
        : null
      : validationSummary.status === "invalid"
        ? "VALIDATION_ERRORS_PRESENT"
        : readiness.missingProof[0] || "READINESS_INCOMPLETE"
  };
}

function buildNextStepContract({ nextAction, readiness, acceptance, validationSummary, externalHandoff }) {
  return {
    type: nextAction.type,
    command: nextAction.command,
    blocked: nextAction.blocked || acceptance.gate === "blocked",
    reason: nextAction.reason,
    explanation: acceptance.accepted
      ? `Dispatch ${nextAction.command} through ${externalHandoff.channel}.`
      : acceptance.gate === "awaiting-acceptance"
        ? "Show the hosted-kernel install preview and collect explicit acceptance before dispatch."
        : validationSummary.firstAction || "Resolve readiness gaps before dispatching the hosted-kernel install plan.",
    requiresAcceptance: acceptance.required && !acceptance.accepted,
    readinessState: readiness.state,
    validationStatus: validationSummary.status,
    handoffState: externalHandoff.state
  };
}

function normalizeHistorySnapshot(snapshot, index) {
  const generatedAt = typeof snapshot?.generatedAt === "string" && snapshot.generatedAt.trim()
    ? snapshot.generatedAt.trim()
    : null;
  const healthState = typeof snapshot?.healthState === "string" && snapshot.healthState.trim()
    ? snapshot.healthState.trim()
    : "unknown";
  const stepCount = Number.isInteger(snapshot?.stepCount) && snapshot.stepCount >= 0
    ? snapshot.stepCount
    : 0;
  const completedStepCount = Number.isInteger(snapshot?.completedStepCount) && snapshot.completedStepCount >= 0
    ? snapshot.completedStepCount
    : 0;
  const failedStepCount = Number.isInteger(snapshot?.failedStepCount) && snapshot.failedStepCount >= 0
    ? snapshot.failedStepCount
    : 0;
  const retryableStepCount = Number.isInteger(snapshot?.retryableStepCount) && snapshot.retryableStepCount >= 0
    ? snapshot.retryableStepCount
    : 0;

  return {
    id: typeof snapshot?.id === "string" && snapshot.id.trim() ? snapshot.id.trim() : `snapshot-${index + 1}`,
    generatedAt,
    hostedKernelId: typeof snapshot?.hostedKernelId === "string" && snapshot.hostedKernelId.trim()
      ? snapshot.hostedKernelId.trim()
      : null,
    tenantId: typeof snapshot?.tenantId === "string" && snapshot.tenantId.trim() ? snapshot.tenantId.trim() : null,
    workspaceId: typeof snapshot?.workspaceId === "string" && snapshot.workspaceId.trim()
      ? snapshot.workspaceId.trim()
      : null,
    healthState,
    readinessState: typeof snapshot?.readinessState === "string" && snapshot.readinessState.trim()
      ? snapshot.readinessState.trim()
      : "unknown",
    nextCommand: typeof snapshot?.nextCommand === "string" && snapshot.nextCommand.trim()
      ? snapshot.nextCommand.trim()
      : null,
    handoffState: typeof snapshot?.handoffState === "string" && snapshot.handoffState.trim()
      ? snapshot.handoffState.trim()
      : null,
    stepCount,
    completedStepCount,
    failedStepCount,
    retryableStepCount,
    validationErrorCount: Number.isInteger(snapshot?.validationErrorCount) && snapshot.validationErrorCount >= 0
      ? snapshot.validationErrorCount
      : 0,
    validationWarningCount: Number.isInteger(snapshot?.validationWarningCount) && snapshot.validationWarningCount >= 0
      ? snapshot.validationWarningCount
      : 0,
    exportSequence: Number.isInteger(snapshot?.exportSequence) && snapshot.exportSequence >= 0
      ? snapshot.exportSequence
      : index + 1
  };
}

function normalizeCommandRecord(command, index) {
  const commandName = typeof command?.command === "string" && command.command.trim()
    ? command.command.trim()
    : "audit";
  const idempotencyKey = typeof command?.idempotencyKey === "string" && command.idempotencyKey.trim()
    ? command.idempotencyKey.trim()
    : typeof command?.key === "string" && command.key.trim()
      ? command.key.trim()
      : `command-${index + 1}`;
  const state = PERSISTED_COMMAND_STATES.has(command?.state) ? command.state : "pending";

  return {
    idempotencyKey,
    command: commandName,
    state,
    requestId: typeof command?.requestId === "string" && command.requestId.trim() ? command.requestId.trim() : null,
    stepId: typeof command?.stepId === "string" && command.stepId.trim() ? command.stepId.trim() : null,
    attempt: Number.isInteger(command?.attempt) && command.attempt >= 0 ? command.attempt : 0,
    generation: Number.isInteger(command?.generation) && command.generation >= 0 ? command.generation : null,
    issuedAt: typeof command?.issuedAt === "string" && command.issuedAt.trim() ? command.issuedAt.trim() : null,
    completedAt: typeof command?.completedAt === "string" && command.completedAt.trim() ? command.completedAt.trim() : null,
    resultRef: typeof command?.resultRef === "string" && command.resultRef.trim() ? command.resultRef.trim() : null,
    errorCode: typeof command?.errorCode === "string" && command.errorCode.trim() ? command.errorCode.trim() : null,
    lifecycleEffect: typeof command?.lifecycleEffect === "string" && command.lifecycleEffect.trim()
      ? command.lifecycleEffect.trim()
      : LIFECYCLE_COMMAND_EFFECTS[commandName] || null,
    dispatchManifestId: typeof command?.dispatchManifestId === "string" && command.dispatchManifestId.trim()
      ? command.dispatchManifestId.trim()
      : null,
    replaySafe: ["pending", "running", "failed"].includes(state)
  };
}

function countBy(items, selectKey) {
  return items.reduce((counts, item) => {
    const key = selectKey(item);
    if (!key) return counts;
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function duplicateKeys(items, selectKey) {
  return Object.entries(countBy(items, selectKey))
    .filter(([, count]) => count > 1)
    .map(([key]) => key)
    .sort();
}

function latestByGeneration(records, fallbackGeneration = 0) {
  return records.reduce((latest, record) => {
    const generation = Number.isInteger(record.generation) ? record.generation : fallbackGeneration;
    return generation > latest ? generation : latest;
  }, fallbackGeneration);
}

function normalizeCheckpointStepStatus(checkpointStatus) {
  if (TERMINAL_STEP_STATUSES.has(checkpointStatus)) return "completed";
  if (RESTART_SAFE_STEP_STATUSES.has(checkpointStatus)) return checkpointStatus;
  return "unknown";
}

function buildCheckpointRecoveryAction({ checkpoint, requestedStatus, effectiveStatus }) {
  if (!checkpoint) return "persist-new-restart-checkpoint";
  if (effectiveStatus === "completed") return "honor-terminal-checkpoint";
  if (effectiveStatus === "running") return "replay-running-step-with-same-idempotency-key";
  if (effectiveStatus === "failed") return "resume-failed-step-if-failure-is-retryable";
  if (requestedStatus !== effectiveStatus) return "reconcile-step-status-from-persisted-checkpoint";
  return "refresh-restart-checkpoint";
}

function normalizeCheckpoint(checkpoint, index) {
  const status = typeof checkpoint?.status === "string" && checkpoint.status.trim() ? checkpoint.status.trim() : "unknown";

  return {
    id: typeof checkpoint?.id === "string" && checkpoint.id.trim() ? checkpoint.id.trim() : `checkpoint-${index + 1}`,
    stepId: typeof checkpoint?.stepId === "string" && checkpoint.stepId.trim() ? checkpoint.stepId.trim() : null,
    packageName: typeof checkpoint?.packageName === "string" && checkpoint.packageName.trim()
      ? checkpoint.packageName.trim()
      : null,
    version: typeof checkpoint?.version === "string" && checkpoint.version.trim() ? checkpoint.version.trim() : null,
    action: typeof checkpoint?.action === "string" && checkpoint.action.trim() ? checkpoint.action.trim() : null,
    status,
    normalizedStatus: normalizeCheckpointStepStatus(status),
    persistedAt: typeof checkpoint?.persistedAt === "string" && checkpoint.persistedAt.trim()
      ? checkpoint.persistedAt.trim()
      : null,
    generation: Number.isInteger(checkpoint?.generation) && checkpoint.generation >= 0 ? checkpoint.generation : null,
    resultRef: typeof checkpoint?.resultRef === "string" && checkpoint.resultRef.trim() ? checkpoint.resultRef.trim() : null,
    restartSafe: RESTART_SAFE_STEP_STATUSES.has(status),
    terminal: TERMINAL_STEP_STATUSES.has(status)
  };
}

function normalizePersistedState(input = {}) {
  const source = input.persistedState && typeof input.persistedState === "object"
    ? input.persistedState
    : input.state && typeof input.state === "object"
      ? input.state
      : {};
  const lock = source.lock && typeof source.lock === "object" ? source.lock : {};
  const commandLedger = asArray(source.commandLedger || source.commands).map(normalizeCommandRecord);
  const checkpoints = asArray(source.checkpoints).map(normalizeCheckpoint);
  const duplicateCommandKeys = duplicateKeys(commandLedger, (command) => command.idempotencyKey);
  const duplicateCheckpointStepIds = duplicateKeys(checkpoints, (checkpoint) => checkpoint.stepId);
  const latestGeneration = Math.max(
    Number.isInteger(source.generation) && source.generation >= 0 ? source.generation : 0,
    latestByGeneration(commandLedger),
    latestByGeneration(checkpoints)
  );
  const activeCommandKeys = commandLedger
    .filter((command) => ["pending", "running"].includes(command.state))
    .map((command) => command.idempotencyKey);

  return {
    present: Boolean(source && Object.keys(source).length),
    planId: typeof source.planId === "string" && source.planId.trim() ? source.planId.trim() : null,
    requestId: typeof source.requestId === "string" && source.requestId.trim() ? source.requestId.trim() : null,
    hostedKernelId: typeof source.hostedKernelId === "string" && source.hostedKernelId.trim()
      ? source.hostedKernelId.trim()
      : null,
    generation: latestGeneration,
    sourceGeneration: Number.isInteger(source.generation) && source.generation >= 0 ? source.generation : 0,
    status: typeof source.status === "string" && source.status.trim() ? source.status.trim() : "unknown",
    lastPersistedAt: typeof source.lastPersistedAt === "string" && source.lastPersistedAt.trim()
      ? source.lastPersistedAt.trim()
      : null,
    commandLedger,
    checkpoints,
    duplicateCommandKeys,
    duplicateCheckpointStepIds,
    activeCommandKeys,
    restartShape: {
      commandCount: commandLedger.length,
      checkpointCount: checkpoints.length,
      activeCommandCount: activeCommandKeys.length,
      duplicateCommandKeyCount: duplicateCommandKeys.length,
      duplicateCheckpointStepCount: duplicateCheckpointStepIds.length,
      restartSafeCheckpointCount: checkpoints.filter((checkpoint) => checkpoint.restartSafe).length,
      terminalCheckpointCount: checkpoints.filter((checkpoint) => checkpoint.terminal).length
    },
    lock: {
      ownerId: typeof lock.ownerId === "string" && lock.ownerId.trim() ? lock.ownerId.trim() : null,
      acquiredAt: typeof lock.acquiredAt === "string" && lock.acquiredAt.trim() ? lock.acquiredAt.trim() : null,
      expiresAt: typeof lock.expiresAt === "string" && lock.expiresAt.trim() ? lock.expiresAt.trim() : null,
      fencingToken: typeof lock.fencingToken === "string" && lock.fencingToken.trim() ? lock.fencingToken.trim() : null
    }
  };
}

function buildIdempotencyKey({ clientRequest, hostedKernel, command, stepId, scheduledAt }) {
  return [
    surfaceId,
    clientRequest.requestId || "request-missing",
    hostedKernel?.id || "kernel-missing",
    command || "audit",
    stepId || scheduledAt || "plan"
  ].join(":");
}

function buildPersistedStateRecovery({
  now,
  persistedState,
  hostedKernel,
  steps,
  clientRequest,
  nextAction,
  health
}) {
  const expectedKey = buildIdempotencyKey({
    clientRequest,
    hostedKernel,
    command: nextAction.command,
    stepId: nextAction.stepId,
    scheduledAt: nextAction.scheduledAt
  });
  const matchingCommands = persistedState.commandLedger.filter((command) => command.idempotencyKey === expectedKey);
  const matchingCommand = matchingCommands.find((command) => ["pending", "running"].includes(command.state))
    || matchingCommands.find((command) => command.state === "succeeded")
    || matchingCommands[0]
    || null;
  const activeCommands = persistedState.commandLedger.filter((command) => ["pending", "running"].includes(command.state));
  const activeConflictingCommands = activeCommands.filter((command) => command.idempotencyKey !== expectedKey);
  const completedKeys = new Set(persistedState.commandLedger
    .filter((command) => command.state === "succeeded")
    .map((command) => command.idempotencyKey));
  const duplicateExpectedKey = persistedState.duplicateCommandKeys.includes(expectedKey);
  const expectedStates = [...new Set(matchingCommands.map((command) => command.state))].sort();
  const expectedKeyStateConflict = duplicateExpectedKey && expectedStates.length > 1;
  const checkpointByStepId = new Map(persistedState.checkpoints
    .filter((checkpoint) => checkpoint.stepId)
    .sort((left, right) => (right.generation || 0) - (left.generation || 0))
    .map((checkpoint) => [checkpoint.stepId, checkpoint]));
  const recoveredStepStatuses = steps
    .filter((step) => RESTART_SAFE_STEP_STATUSES.has(step.status) || checkpointByStepId.has(step.id))
    .map((step) => {
      const checkpoint = checkpointByStepId.get(step.id) || null;
      const checkpointStatus = checkpoint?.status || null;
      const completedByLedger = completedKeys.has(buildIdempotencyKey({
        clientRequest,
        hostedKernel,
        command: "resume",
        stepId: step.id
      }));
      const effectiveStatus = completedByLedger
        ? "completed"
        : checkpoint?.normalizedStatus && checkpoint.normalizedStatus !== "unknown"
          ? checkpoint.normalizedStatus
          : checkpointStatus || step.status;
      const restartSafe = RESTART_SAFE_STEP_STATUSES.has(effectiveStatus);
      const terminal = TERMINAL_STEP_STATUSES.has(effectiveStatus) || effectiveStatus === "completed";

      return {
        stepId: step.id,
        packageName: step.packageName,
        action: step.action,
        requestedStatus: step.status,
        checkpointStatus,
        effectiveStatus,
        checkpointId: checkpoint?.id || null,
        checkpointGeneration: checkpoint?.generation || null,
        persistedAt: checkpoint?.persistedAt || null,
        resultRef: checkpoint?.resultRef || null,
        completedByLedger,
        terminal,
        restartSafe,
        recoveryAction: buildCheckpointRecoveryAction({
          checkpoint,
          requestedStatus: step.status,
          effectiveStatus
        })
      };
    });
  const staleForRequest = Boolean(persistedState.requestId && clientRequest.requestId
    && persistedState.requestId !== clientRequest.requestId);
  const staleForKernel = Boolean(persistedState.hostedKernelId && hostedKernel?.id
    && persistedState.hostedKernelId !== hostedKernel.id);
  const lockExpiresAt = parseTime(persistedState.lock.expiresAt);
  const nowTime = parseTime(now);
  const lockExpired = lockExpiresAt !== null && nowTime !== null && lockExpiresAt <= nowTime;
  const lockHeld = Boolean(persistedState.lock.ownerId && !lockExpired);
  const recoveryBlockers = [
    ...(expectedKeyStateConflict ? ["PERSISTED_COMMAND_STATE_CONFLICT"] : []),
    ...(persistedState.duplicateCheckpointStepIds.length ? ["DUPLICATE_STEP_CHECKPOINTS"] : []),
    ...(activeConflictingCommands.length ? ["ACTIVE_CONFLICTING_COMMAND"] : []),
    ...(staleForRequest ? ["STALE_REQUEST_PERSISTED_STATE"] : []),
    ...(staleForKernel ? ["STALE_KERNEL_PERSISTED_STATE"] : []),
    ...(lockHeld && matchingCommand?.state !== "running" ? ["PERSISTED_STATE_LOCK_HELD"] : []),
    ...(health.state === "blocked" ? ["HEALTH_BLOCKED"] : [])
  ];

  let commandIntent = "dispatch";
  if (expectedKeyStateConflict) commandIntent = "hold";
  else if (matchingCommand?.state === "succeeded") commandIntent = "noop";
  else if (matchingCommand && ["pending", "running"].includes(matchingCommand.state)) commandIntent = "replay";
  else if (matchingCommand?.state === "failed" && !nextAction.blocked) commandIntent = "retry";
  else if (recoveryBlockers.length) commandIntent = "hold";
  const restartSafeStepIds = recoveredStepStatuses
    .filter((status) => status.restartSafe)
    .map((status) => status.stepId);
  const terminalStepIds = recoveredStepStatuses
    .filter((status) => status.terminal)
    .map((status) => status.stepId);

  return {
    generatedAt: now,
    present: persistedState.present,
    planId: persistedState.planId,
    generation: persistedState.generation,
    status: commandIntent === "noop"
      ? "already-applied"
      : commandIntent === "replay"
        ? "replaying"
        : commandIntent === "hold"
          ? "held"
          : health.state === "blocked"
            ? "blocked"
            : "recoverable",
    expectedIdempotencyKey: expectedKey,
    commandIntent,
    idempotent: Boolean(matchingCommand),
    matchingCommandState: matchingCommand?.state || null,
    matchingCommandAttempt: matchingCommand?.attempt || 0,
    duplicateExpectedKey,
    expectedKeyStateConflict,
    duplicateCommandKeys: persistedState.duplicateCommandKeys,
    duplicateCheckpointStepIds: persistedState.duplicateCheckpointStepIds,
    activeCommandCount: activeCommands.length,
    activeCommandKeys: activeCommands.map((command) => command.idempotencyKey),
    activeConflictingCommandKeys: activeConflictingCommands.map((command) => command.idempotencyKey),
    staleForRequest,
    staleForKernel,
    lockHeld,
    lockExpired,
    lockOwnerId: persistedState.lock.ownerId,
    recoveredStepStatuses,
    restartSafeStepIds,
    terminalStepIds,
    checkpointCount: persistedState.checkpoints.length,
    restartShape: persistedState.restartShape,
    recoveryBlockers,
    safeToDispatch: commandIntent === "dispatch" || commandIntent === "retry",
    operatorAction: commandIntent === "noop"
      ? "Treat the command as already applied and refresh plan state from persisted checkpoints."
      : commandIntent === "replay"
        ? "Replay the same idempotency key; do not create a second hosted-kernel command."
        : commandIntent === "hold"
          ? `Resolve persisted recovery blockers before dispatch: ${recoveryBlockers.join(", ") || "PERSISTED_STATE_HELD"}.`
          : "Persist the expected idempotency key before dispatching the hosted-kernel command."
  };
}

function classifyFailure(step) {
  if (step.status !== "failed") return null;
  if (!step.failureCode) return "unknown";
  return RETRYABLE_FAILURES.has(step.failureCode) ? "retryable" : "terminal";
}

function buildRetryPolicy(step, inputPolicy = {}) {
  const maxAttempts = Number.isInteger(inputPolicy.maxAttempts) && inputPolicy.maxAttempts > 0
    ? inputPolicy.maxAttempts
    : DEFAULT_MAX_ATTEMPTS;
  const baseBackoffMs = Number.isInteger(inputPolicy.baseBackoffMs) && inputPolicy.baseBackoffMs > 0
    ? inputPolicy.baseBackoffMs
    : DEFAULT_BASE_BACKOFF_MS;
  const maxBackoffMs = Number.isInteger(inputPolicy.maxBackoffMs) && inputPolicy.maxBackoffMs > 0
    ? inputPolicy.maxBackoffMs
    : DEFAULT_MAX_BACKOFF_MS;
  const retryable = classifyFailure(step) === "retryable";
  const attemptsRemaining = Math.max(maxAttempts - step.attempts, 0);
  const nextBackoffMs = Math.min(baseBackoffMs * (2 ** Math.max(step.attempts, 0)), maxBackoffMs);

  return {
    retryable,
    attemptsMade: step.attempts,
    attemptsRemaining: retryable ? attemptsRemaining : 0,
    nextBackoffMs: retryable && attemptsRemaining > 0 ? nextBackoffMs : null,
    strategy: retryable ? "exponential-backoff" : "manual-intervention"
  };
}

function buildHealth({ errors, warnings, steps }) {
  const failedRequired = steps.filter((step) => step.required && step.status === "failed");
  const terminalFailures = failedRequired.filter((step) => classifyFailure(step) === "terminal");
  const retryableFailures = failedRequired.filter((step) => classifyFailure(step) === "retryable");
  const pendingRequired = steps.filter((step) => step.required && step.status === "pending");

  if (errors.length || terminalFailures.length) {
    return {
      ok: false,
      state: "blocked",
      degraded: false,
      reason: errors[0]?.code || "TERMINAL_INSTALL_FAILURE"
    };
  }

  if (retryableFailures.length || warnings.length || pendingRequired.length) {
    return {
      ok: true,
      state: "degraded",
      degraded: true,
      reason: retryableFailures[0]?.failureCode || warnings[0]?.code || "PENDING_REQUIRED_STEPS"
    };
  }

  return {
    ok: true,
    state: "healthy",
    degraded: false,
    reason: "INSTALL_PLAN_READY"
  };
}

function buildActionableErrors(errors, steps, operationalRecovery) {
  const failureErrors = steps
    .filter((step) => step.status === "failed")
    .map((step) => {
      const failureType = classifyFailure(step);
      return {
        code: failureType === "retryable" ? "RETRYABLE_INSTALL_STEP_FAILED" : "INSTALL_STEP_FAILED",
        stepId: step.id,
        packageName: step.packageName,
        failureCode: step.failureCode || "unknown",
        action: failureType === "retryable"
          ? "Retry the step using the provided retryPolicy after the backoff window."
          : "Inspect the package source, checksum, and hosted-kernel logs before retrying."
      };
    });
  const operationalErrors = asArray(operationalRecovery?.serviceDecisions)
    .filter((decision) => decision.severity === "blocking" || decision.state === "unknown")
    .map((decision) => ({
      code: decision.severity === "blocking" ? "OPERATIONAL_SERVICE_BLOCKING" : "OPERATIONAL_SERVICE_UNVERIFIED",
      service: decision.service,
      failureCode: decision.failureCode,
      retryable: decision.retryable,
      retryAfterMs: decision.retryAfterMs,
      retryAt: decision.retryAt,
      affectedCommands: decision.commandImpact,
      proofRequired: decision.proofRequired,
      action: decision.operatorAction
    }));

  return [...errors, ...failureErrors, ...operationalErrors];
}

function buildAnalytics({ steps, validation, retryPolicies }) {
  const byStatus = {};
  const byAction = {};
  const byFailureClass = { retryable: 0, terminal: 0, unknown: 0 };
  let requiredStepCount = 0;
  let optionalStepCount = 0;
  let checksumCoverageCount = 0;
  let pinnedVersionCount = 0;

  for (const step of steps) {
    byStatus[step.status] = (byStatus[step.status] || 0) + 1;
    byAction[step.action] = (byAction[step.action] || 0) + 1;
    requiredStepCount += step.required ? 1 : 0;
    optionalStepCount += step.required ? 0 : 1;
    checksumCoverageCount += step.checksum ? 1 : 0;
    pinnedVersionCount += step.version ? 1 : 0;

    const failureClass = classifyFailure(step);
    if (failureClass) {
      byFailureClass[failureClass] = (byFailureClass[failureClass] || 0) + 1;
    }
  }

  const retryableStepCount = retryPolicies.filter((policy) => policy.retryable).length;
  const completedStepCount = byStatus.completed || byStatus.succeeded || 0;
  const failedStepCount = byStatus.failed || 0;
  const pendingStepCount = byStatus.pending || 0;
  const blockedStepCount = byFailureClass.terminal;

  return {
    stepCount: steps.length,
    requiredStepCount,
    optionalStepCount,
    completedStepCount,
    failedStepCount,
    pendingStepCount,
    blockedStepCount,
    retryableStepCount,
    checksumCoverageCount,
    pinnedVersionCount,
    checksumCoverageRatio: steps.length ? checksumCoverageCount / steps.length : 0,
    pinnedVersionRatio: steps.length ? pinnedVersionCount / steps.length : 0,
    validationErrorCount: validation.errors.length,
    validationWarningCount: validation.warnings.length,
    byStatus,
    byAction,
    byFailureClass
  };
}

function buildHistorySnapshots({
  inputHistory,
  now,
  hostedKernel,
  health,
  analytics,
  readiness,
  nextAction,
  externalHandoff,
  workspaceBoundary
}) {
  const history = asArray(inputHistory).map(normalizeHistorySnapshot);
  const current = {
    id: "current",
    generatedAt: now,
    hostedKernelId: hostedKernel?.id || null,
    tenantId: workspaceBoundary.tenantId,
    workspaceId: workspaceBoundary.workspaceId,
    healthState: health.state,
    readinessState: readiness.state,
    nextCommand: nextAction.command,
    handoffState: externalHandoff.state,
    stepCount: analytics.stepCount,
    completedStepCount: analytics.completedStepCount,
    failedStepCount: analytics.failedStepCount,
    retryableStepCount: analytics.retryableStepCount,
    validationErrorCount: analytics.validationErrorCount,
    validationWarningCount: analytics.validationWarningCount,
    exportSequence: history.length + 1
  };
  const snapshots = [...history, current];
  const previous = history.length ? history[history.length - 1] : null;
  const healthRank = { healthy: 0, degraded: 1, blocked: 2, unknown: 3 };
  const latestGeneratedAt = snapshots
    .map((snapshot) => parseTime(snapshot.generatedAt))
    .filter((time) => time !== null)
    .sort((left, right) => right - left)[0] || null;
  const deltaFromPrevious = previous ? {
    stepCount: current.stepCount - previous.stepCount,
    completedStepCount: current.completedStepCount - previous.completedStepCount,
    failedStepCount: current.failedStepCount - previous.failedStepCount,
    retryableStepCount: current.retryableStepCount - previous.retryableStepCount,
    validationErrorCount: current.validationErrorCount - previous.validationErrorCount,
    validationWarningCount: current.validationWarningCount - previous.validationWarningCount,
    healthChanged: previous.healthState !== current.healthState,
    readinessChanged: previous.readinessState !== current.readinessState,
    commandChanged: previous.nextCommand !== current.nextCommand,
    handoffChanged: previous.handoffState !== current.handoffState
  } : null;
  const regressionFlags = deltaFromPrevious ? [
    ...(deltaFromPrevious.failedStepCount > 0 ? ["failed-steps-increased"] : []),
    ...(deltaFromPrevious.validationErrorCount > 0 ? ["validation-errors-increased"] : []),
    ...(deltaFromPrevious.retryableStepCount > 0 ? ["retryable-steps-increased"] : []),
    ...((healthRank[current.healthState] ?? 3) > (healthRank[previous.healthState] ?? 3) ? ["health-regressed"] : [])
  ] : [];

  return {
    snapshots,
    latest: current,
    previousSnapshotId: previous?.id || null,
    latestGeneratedAt: latestGeneratedAt !== null ? new Date(latestGeneratedAt).toISOString() : null,
    deltaFromPrevious,
    regressionFlags,
    exportRows: snapshots.map((snapshot) => ({
      sequence: snapshot.exportSequence,
      snapshotId: snapshot.id,
      generatedAt: snapshot.generatedAt,
      hostedKernelId: snapshot.hostedKernelId,
      tenantId: snapshot.tenantId,
      workspaceId: snapshot.workspaceId,
      healthState: snapshot.healthState,
      readinessState: snapshot.readinessState,
      nextCommand: snapshot.nextCommand,
      handoffState: snapshot.handoffState,
      stepCount: snapshot.stepCount,
      completedStepCount: snapshot.completedStepCount,
      failedStepCount: snapshot.failedStepCount,
      retryableStepCount: snapshot.retryableStepCount,
      validationErrorCount: snapshot.validationErrorCount,
      validationWarningCount: snapshot.validationWarningCount
    }))
  };
}

function buildReportingState({
  now,
  analytics,
  history,
  timeline,
  readiness,
  nextStep,
  externalHandoff,
  providerServiceBindings,
  providerIntegrationContract,
  dispatchManifest,
  operationalRecovery,
  persistedStateRecovery,
  persistenceWriteSet,
  persistedStateShape,
  workspaceBoundary
}) {
  const severityCounts = timeline.reduce((counts, event) => {
    const severity = event.severity || "info";
    counts[severity] = (counts[severity] || 0) + 1;
    return counts;
  }, {});
  const counterSeries = [
    ["steps.total", analytics.stepCount],
    ["steps.completed", analytics.completedStepCount],
    ["steps.failed", analytics.failedStepCount],
    ["steps.retryable", analytics.retryableStepCount],
    ["validation.errors", analytics.validationErrorCount],
    ["validation.warnings", analytics.validationWarningCount],
    ["audit.checksumCoverageRatio", analytics.checksumCoverageRatio],
    ["audit.pinnedVersionRatio", analytics.pinnedVersionRatio],
    ["providers.boundServices", providerServiceBindings.electedContractIds.length],
    ["providers.serviceBindingHolds", providerServiceBindings.holdReasons.length],
    ["providers.integrationServiceIntents", providerIntegrationContract.serviceIntentCount],
    ["providers.integrationHolds", providerIntegrationContract.holdReasons.length],
    ["persistence.checkpointPatchCount", persistedStateShape.checkpointPatchCount],
    ["persistence.restartSafeSteps", persistedStateShape.restartSafeStepIds.length],
    ["timeline.errorEvents", severityCounts.error || 0],
    ["timeline.warningEvents", severityCounts.warning || 0]
  ].map(([name, value]) => ({ name, value }));
  const blocked = nextStep.blocked
    || readiness.state === "blocked"
    || externalHandoff.state === "held"
    || providerIntegrationContract.state === "held"
    || dispatchManifest.state === "held"
    || operationalRecovery.recommendedMode === "hold"
    || persistedStateRecovery.commandIntent === "hold"
    || !persistenceWriteSet.writable
    || !workspaceBoundary.dispatchable;

  return {
    generatedAt: now,
    reportId: [
      surfaceId,
      workspaceBoundary.tenantId || "tenant-missing",
      workspaceBoundary.workspaceId || "workspace-missing",
      history.latest.exportSequence
    ].join(":"),
    state: blocked ? "attention-required" : readiness.state === "ready" ? "export-ready" : "review-ready",
    blocked,
    exportFormat: "application/vnd.aios.install-plan.analytics+json",
    counterSeries,
    historyRows: history.exportRows,
    historyRegressionFlags: history.regressionFlags,
    timelineDigest: {
      eventCount: timeline.length,
      severityCounts,
      firstEventType: timeline[0]?.type || null,
      lastEventType: timeline[timeline.length - 1]?.type || null,
      blockingEventTypes: timeline
        .filter((event) => event.severity === "error")
        .map((event) => event.type)
    },
    exportBlocks: {
      readinessState: readiness.state,
      nextCommand: nextStep.command,
      handoffState: externalHandoff.state,
      providerServiceBindingState: providerServiceBindings.state,
      providerIntegrationState: providerIntegrationContract.state,
      providerIntegrationContractId: providerIntegrationContract.integrationId,
      providerIntegrationHoldReasons: providerIntegrationContract.holdReasons,
      dispatchManifestState: dispatchManifest.state,
      commandEnvelopeCount: dispatchManifest.commandEnvelopeCount,
      operationalMode: operationalRecovery.recommendedMode,
      persistedCommandIntent: persistedStateRecovery.commandIntent,
      persistenceWriteMode: persistenceWriteSet.writeMode,
      persistedStatePatchMode: persistedStateShape.atomicPatchMode,
      persistedRestartStatus: persistedStateShape.restartStatus,
      workspaceBoundaryDispatchable: workspaceBoundary.dispatchable,
      workspaceProviderBoundaryState: workspaceBoundary.providerBoundaryState,
      workspaceProviderBoundaryHoldReasons: workspaceBoundary.providerBoundaryHoldReasons
    },
    subscriberHints: [
      ...(history.regressionFlags.length ? ["notify-install-plan-regression"] : []),
      ...(externalHandoff.dispatchable ? ["provider-handoff-ready"] : ["provider-handoff-held"]),
      ...(providerServiceBindings.ready ? ["provider-service-bindings-ready"] : ["bind-provider-services"]),
      ...(providerIntegrationContract.dispatchable ? ["provider-integration-contract-ready"] : ["complete-provider-integration-contract"]),
      ...(dispatchManifest.dispatchable ? ["dispatch-manifest-ready"] : []),
      ...(dispatchManifest.replay ? ["replay-dispatch-manifest"] : []),
      ...(persistedStateRecovery.commandIntent === "replay" ? ["reuse-idempotency-key"] : []),
      ...(persistedStateShape.recoverySemantics.duplicateDispatchPrevented ? ["duplicate-dispatch-prevented"] : []),
      ...(persistedStateShape.recoverySemantics.requiresCompareAndSwap ? ["apply-persisted-state-cas"] : []),
      ...(persistenceWriteSet.commandRecord ? ["persist-command-ledger-entry"] : []),
      ...(persistenceWriteSet.checkpointUpserts.length ? ["persist-restart-checkpoints"] : []),
      ...(!workspaceBoundary.dispatchable ? ["refresh-workspace-boundary-token"] : [])
    ]
  };
}

function buildAnalyticsExportPackage({
  now,
  analyticsExportRequest,
  clientRequest,
  analytics,
  history,
  timeline,
  reportingState,
  validationSummary,
  dispatchManifest,
  externalHandoff,
  providerServiceBindings,
  providerIntegrationContract,
  workspaceBoundary
}) {
  const exportId = analyticsExportRequest.exportRef || [
    reportingState.reportId,
    analyticsExportRequest.destination,
    analyticsExportRequest.format
  ].join(":");
  const timelineRows = analyticsExportRequest.includeTimeline
    ? timeline.slice(-analyticsExportRequest.timelineLimit).map((event, index) => ({
      sequence: index + 1,
      at: event.at,
      type: event.type,
      severity: event.severity,
      code: event.code || event.commandBlockedReason || event.holdReason || null,
      stepId: event.stepId || null,
      command: event.command || null,
      state: event.state || event.status || event.handoffState || null
    }))
    : [];
  const counterRows = analyticsExportRequest.includeCounters
    ? reportingState.counterSeries.map((counter) => ({
      metric: counter.name,
      value: counter.value,
      generatedAt: now,
      reportId: reportingState.reportId
    }))
    : [];
  const historyRows = analyticsExportRequest.includeHistory ? reportingState.historyRows : [];
  const providerRouteRows = analyticsExportRequest.includeProviderRoutes
    ? Object.entries(dispatchManifest.eligibleProviderRoutes).map(([service, route]) => ({
      service,
      requestedService: route.requestedService,
      routeService: route.routeService,
      contractId: route.contractId,
      providerId: route.providerId,
      fallbackUsed: route.fallbackUsed,
      lastSyncedAt: route.lastSyncedAt,
      syncCursorPresent: Boolean(route.syncCursor),
      endpointPresent: Boolean(route.endpoint?.url),
      endpointProtocol: route.endpoint?.protocol || null,
      endpointAuthMode: route.endpoint?.authMode || null,
      endpointRequiresAck: route.endpoint?.supportsAcknowledgement === true
    }))
    : [];
  const providerIntegrationRows = analyticsExportRequest.includeProviderRoutes
    ? providerIntegrationContract.serviceIntents.map((intent) => ({
      service: intent.service,
      command: intent.command,
      routeState: intent.routeState,
      contractId: intent.contractId,
      providerId: intent.providerId,
      handoffEligible: intent.handoffEligible,
      syncProofRequired: intent.syncProofRequired,
      syncProofPresent: intent.syncProofPresent,
      endpointRequired: intent.endpointRequired,
      endpointPresent: intent.endpointPresent,
      endpointProtocol: intent.endpoint?.protocol || null,
      acknowledgementState: intent.acknowledgementState,
      expectedAckRef: intent.handoffPatch?.expectedAckRef || null,
      blockedReasons: intent.blockedReasons.join("|")
    }))
    : [];
  const commandEnvelopeRows = analyticsExportRequest.includeCommandEnvelopeRefs
    ? dispatchManifest.commandEnvelopes.map((envelope) => ({
      sequence: envelope.sequence,
      envelopeId: envelope.envelopeId,
      command: envelope.command,
      stepId: envelope.stepId,
      packageName: envelope.packageName,
      providerContractId: envelope.target.providerContractId,
      providerId: envelope.target.providerId,
      idempotencyKey: analyticsExportRequest.redactionMode === "none" ? envelope.idempotencyKey : null,
      idempotencyKeyPresent: Boolean(envelope.idempotencyKey)
    }))
    : [];
  const blocked = !analyticsExportRequest.enabled;
  const summaryRows = [{
    reportId: reportingState.reportId,
    exportId,
    generatedAt: now,
    requestId: clientRequest.requestId,
    correlationId: clientRequest.correlationId,
    tenantId: workspaceBoundary.tenantId,
    workspaceId: workspaceBoundary.workspaceId,
    readinessState: reportingState.exportBlocks.readinessState,
    reportState: reportingState.state,
    validationStatus: validationSummary.status,
    handoffState: externalHandoff.state,
    dispatchManifestState: dispatchManifest.state,
    providerServiceBindingState: providerServiceBindings.state,
    providerIntegrationState: providerIntegrationContract.state,
    providerIntegrationContractId: providerIntegrationContract.integrationId,
    commandEnvelopeCount: dispatchManifest.commandEnvelopeCount,
    stepCount: analytics.stepCount,
    failedStepCount: analytics.failedStepCount,
    retryableStepCount: analytics.retryableStepCount,
    validationErrorCount: analytics.validationErrorCount,
    validationWarningCount: analytics.validationWarningCount
  }];
  const rowCounts = {
    summary: summaryRows.length,
    counters: counterRows.length,
    history: historyRows.length,
    timeline: timelineRows.length,
    providerRoutes: providerRouteRows.length,
    providerIntegrations: providerIntegrationRows.length,
    commandEnvelopes: commandEnvelopeRows.length
  };

  return {
    generatedAt: now,
    contract: "hosted-kernel-install-plan-analytics-export",
    exportId,
    enabled: analyticsExportRequest.enabled,
    state: blocked
      ? "disabled"
      : reportingState.blocked
        ? "audit-export-ready"
        : "ready",
    format: analyticsExportRequest.format,
    destination: analyticsExportRequest.destination,
    contentType: analyticsExportRequest.format === "csv"
      ? "text/csv"
      : analyticsExportRequest.format === "ndjson"
        ? "application/x-ndjson"
        : reportingState.exportFormat,
    redactionMode: analyticsExportRequest.redactionMode,
    requestedBy: analyticsExportRequest.requestedBy,
    reportId: reportingState.reportId,
    rowCounts,
    totalRowCount: Object.values(rowCounts).reduce((total, count) => total + count, 0),
    schema: {
      summary: Object.keys(summaryRows[0]),
      counters: ["metric", "value", "generatedAt", "reportId"],
      history: historyRows[0] ? Object.keys(historyRows[0]) : [],
      timeline: ["sequence", "at", "type", "severity", "code", "stepId", "command", "state"],
      providerRoutes: providerRouteRows[0] ? Object.keys(providerRouteRows[0]) : [],
      providerIntegrations: providerIntegrationRows[0] ? Object.keys(providerIntegrationRows[0]) : [],
      commandEnvelopes: commandEnvelopeRows[0] ? Object.keys(commandEnvelopeRows[0]) : []
    },
    blocks: {
      summaryRows,
      counterRows,
      historyRows,
      timelineRows,
      providerRouteRows,
      providerIntegrationRows,
      commandEnvelopeRows
    },
    delivery: {
      auditSink: workspaceBoundary.auditSink,
      destination: analyticsExportRequest.destination,
      canAttachToClientWorkflow: analyticsExportRequest.destination === "client-download",
      canAttachToProviderHandoff: analyticsExportRequest.destination === "provider-handoff"
        && externalHandoff.dispatchable,
      subscriberHints: reportingState.subscriberHints
    },
    disabledReason: blocked ? "ANALYTICS_EXPORT_DISABLED" : null
  };
}

function buildTimeline({
  now,
  hostedKernel,
  steps,
  validation,
  retryPolicies,
  health,
  lifecycleControls,
  lifecycleCommandPolicy,
  scheduleControl,
  nextAction,
  capabilityNegotiation,
  providerServiceBindings,
  providerIntegrationContract,
  externalHandoff,
  dispatchManifest,
  operationalRecovery,
  operationalCommandGate,
  persistedStateRecovery,
  persistenceWriteSet,
  persistedStateShape,
  workspaceBoundary
}) {
  const validationEvents = [
    ...validation.errors.map((error) => ({
      at: now,
      type: "validation-error",
      severity: "error",
      code: error.code,
      stepId: error.stepId || null
    })),
    ...validation.warnings.map((warning) => ({
      at: now,
      type: "validation-warning",
      severity: "warning",
      code: warning.code,
      stepId: warning.stepId || null
    }))
  ];
  const stepEvents = steps.map((step) => ({
    at: now,
    type: "step-state",
    severity: step.status === "failed" && step.required ? "error" : "info",
    stepId: step.id,
    packageName: step.packageName,
    status: step.status,
    failureClass: classifyFailure(step),
    retryScheduled: retryPolicies.some((policy) => policy.stepId === step.id && policy.nextBackoffMs !== null)
  }));

  return [
    {
      at: now,
      type: "hosted-kernel-evaluated",
      severity: health.state === "blocked" ? "error" : health.degraded ? "warning" : "info",
      hostedKernelId: hostedKernel?.id || null,
      healthState: health.state
    },
    {
      at: now,
      type: "lifecycle-controls-evaluated",
      severity: nextAction.blocked || !lifecycleCommandPolicy.allowed ? "warning" : "info",
      command: nextAction.command,
      nextActionType: nextAction.type,
      controlsEnabled: lifecycleControls.enabled,
      requestedCommand: lifecycleCommandPolicy.requestedCommand,
      effectiveCommand: lifecycleCommandPolicy.effectiveCommand,
      commandAllowed: lifecycleCommandPolicy.allowed,
      commandBlockedReason: lifecycleCommandPolicy.blockedReason,
      disableDrainMode: lifecycleCommandPolicy.disableDrainMode,
      resumeSelectionPolicy: lifecycleCommandPolicy.resumeSelectionPolicy,
      scheduleDispatchable: scheduleControl.dispatchable,
      scheduleWindow: lifecycleCommandPolicy.scheduleWindow,
      operatorActionCount: lifecycleCommandPolicy.operatorActions.length
    },
    {
      at: now,
      type: "provider-capability-negotiated",
      severity: capabilityNegotiation.allRequiredCapabilitiesMet ? "info" : "error",
      acceptedContractCount: capabilityNegotiation.acceptedContractCount,
      degradedContractCount: capabilityNegotiation.degradedContractCount,
      allRequiredCapabilitiesMet: capabilityNegotiation.allRequiredCapabilitiesMet
    },
    {
      at: now,
      type: "provider-service-bindings-shaped",
      severity: providerServiceBindings.ready ? "info" : "warning",
      command: providerServiceBindings.command,
      state: providerServiceBindings.state,
      requiredServices: providerServiceBindings.requiredServices,
      electedContractIds: providerServiceBindings.electedContractIds,
      fallbackContractIds: providerServiceBindings.fallbackContractIds,
      holdReasons: providerServiceBindings.holdReasons
    },
    {
      at: now,
      type: "provider-integration-contract-shaped",
      severity: providerIntegrationContract.dispatchable ? "info" : "warning",
      integrationId: providerIntegrationContract.integrationId,
      state: providerIntegrationContract.state,
      command: providerIntegrationContract.command,
      serviceIntentCount: providerIntegrationContract.serviceIntentCount,
      blockedServiceIntents: providerIntegrationContract.blockedServiceIntents,
      pendingAcknowledgementServices: providerIntegrationContract.pendingAcknowledgementServices,
      missingSyncProofServices: providerIntegrationContract.missingSyncProofServices,
      capabilityGapServices: providerIntegrationContract.capabilityGapServices,
      holdReasons: providerIntegrationContract.holdReasons
    },
    {
      at: now,
      type: "operational-health-recovery-shaped",
      severity: operationalRecovery.recommendedMode === "hold"
        ? "error"
        : operationalRecovery.recommendedMode === "normal"
          ? "info"
          : "warning",
      status: operationalRecovery.status,
      recommendedMode: operationalRecovery.recommendedMode,
      blockedServices: operationalRecovery.blockedServices,
      degradedServices: operationalRecovery.degradedServices,
      nextRetryInMs: operationalRecovery.nextRetryInMs,
      recoveryProofRequired: operationalRecovery.recoveryProof.required,
      affectedCommands: operationalRecovery.recoveryProof.affectedCommands,
      serviceDecisionCount: operationalRecovery.serviceDecisions.length
    },
    {
      at: now,
      type: "operational-command-gate-shaped",
      severity: operationalCommandGate.status === "blocking"
        ? "error"
        : operationalCommandGate.status === "degraded-available"
          ? "warning"
          : "info",
      status: operationalCommandGate.status,
      requestedCommand: operationalCommandGate.requestedCommand,
      requestedCommandBlocked: operationalCommandGate.requestedCommandBlocked,
      requestedCommandMode: operationalCommandGate.requestedCommandMode,
      blockedCommands: operationalCommandGate.blockedCommands,
      degradedAllowedCommands: operationalCommandGate.degradedAllowedCommands,
      requiredProof: operationalCommandGate.requiredProof,
      nextRetryAt: operationalCommandGate.nextRetryAt
    },
    {
      at: now,
      type: "workspace-boundary-evaluated",
      severity: workspaceBoundary.dispatchable ? "info" : "error",
      tenantId: workspaceBoundary.tenantId,
      workspaceId: workspaceBoundary.workspaceId,
      scopeMode: workspaceBoundary.scopeMode,
      actorId: workspaceBoundary.actorId,
      missingPermissions: workspaceBoundary.missingPermissions,
      boundaryTokenPresent: workspaceBoundary.boundaryTokenPresent,
      providerBoundaryState: workspaceBoundary.providerBoundaryState,
      blockedProviderContractIds: workspaceBoundary.blockedProviderContractIds,
      providerBoundaryHoldReasons: workspaceBoundary.providerBoundaryHoldReasons,
      holdReason: workspaceBoundary.holdReason
    },
    {
      at: now,
      type: "external-provider-handoff-shaped",
      severity: externalHandoff.dispatchable ? "info" : "warning",
      command: externalHandoff.command,
      handoffState: externalHandoff.state,
      eligibleContractCount: externalHandoff.eligibleContractIds.length,
      blockedContractCount: externalHandoff.blockedContractIds.length,
      holdReason: externalHandoff.holdReason
    },
    {
      at: now,
      type: "dispatch-manifest-shaped",
      severity: dispatchManifest.dispatchable
        ? "info"
        : dispatchManifest.state === "already-applied"
          ? "info"
          : "warning",
      manifestId: dispatchManifest.manifestId,
      state: dispatchManifest.state,
      command: dispatchManifest.command,
      commandEnvelopeCount: dispatchManifest.commandEnvelopeCount,
      selectedStepIds: dispatchManifest.selectedStepIds,
      blockingReasons: dispatchManifest.blockingReasons,
      replay: dispatchManifest.replay
    },
    {
      at: now,
      type: "persisted-state-recovery-shaped",
      severity: persistedStateRecovery.commandIntent === "hold"
        ? "warning"
        : persistedStateRecovery.commandIntent === "noop"
          ? "info"
          : "info",
      status: persistedStateRecovery.status,
      commandIntent: persistedStateRecovery.commandIntent,
      expectedIdempotencyKey: persistedStateRecovery.expectedIdempotencyKey,
      idempotent: persistedStateRecovery.idempotent,
      activeCommandCount: persistedStateRecovery.activeCommandCount,
      activeConflictingCommandKeys: persistedStateRecovery.activeConflictingCommandKeys,
      checkpointCount: persistedStateRecovery.checkpointCount,
      restartSafeStepIds: persistedStateRecovery.restartSafeStepIds,
      terminalStepIds: persistedStateRecovery.terminalStepIds,
      recoveryBlockers: persistedStateRecovery.recoveryBlockers,
      safeToDispatch: persistedStateRecovery.safeToDispatch
    },
    {
      at: now,
      type: "persistence-write-set-shaped",
      severity: persistenceWriteSet.writable ? "info" : "warning",
      status: persistenceWriteSet.status,
      writeMode: persistenceWriteSet.writeMode,
      writable: persistenceWriteSet.writable,
      expectedGeneration: persistenceWriteSet.expectedGeneration,
      commandAlreadyRecorded: persistenceWriteSet.commandAlreadyRecorded,
      duplicateCommandKeys: persistenceWriteSet.duplicateCommandKeys,
      checkpointUpsertCount: persistenceWriteSet.checkpointUpserts.length,
      deniedReasons: persistenceWriteSet.deniedReasons
    },
    {
      at: now,
      type: "persisted-state-shape-built",
      severity: persistedStateShape.restartStatus === "held" ? "warning" : "info",
      patchId: persistedStateShape.patchId,
      restartStatus: persistedStateShape.restartStatus,
      atomicPatchMode: persistedStateShape.atomicPatchMode,
      idempotencyDecision: persistedStateShape.idempotencyDecision,
      checkpointPatchCount: persistedStateShape.checkpointPatchCount,
      terminalStepIds: persistedStateShape.terminalStepIds,
      restartSafeStepIds: persistedStateShape.restartSafeStepIds,
      safeToApplyAfterRestart: persistedStateShape.recoverySemantics.safeToApplyAfterRestart,
      requiresCompareAndSwap: persistedStateShape.recoverySemantics.requiresCompareAndSwap
    },
    ...validationEvents,
    ...stepEvents
  ];
}

function buildExportSummary({
  now,
  hostedKernel,
  health,
  analytics,
  actionableErrors,
  history,
  readiness,
  validationSummary,
  acceptance,
  nextStep,
  lifecycleControls,
  lifecycleCommandPolicy,
  scheduleControl,
  nextAction,
  capabilityNegotiation,
  providerServiceBindings,
  providerIntegrationContract,
  syncMetadata,
  externalHandoff,
  dispatchManifest,
  clientWorkflowHandoff,
  clientPreviewAcceptanceModel,
  operationalRecovery,
  operationalCommandGate,
  persistedStateRecovery,
  persistenceWriteSet,
  persistedStateShape,
  workspaceBoundary,
  reportingState,
  analyticsExportPackage
}) {
  return {
    generatedAt: now,
    exportType: "hosted-kernel-install-plan-summary",
    surfaceId,
    hostedKernelId: hostedKernel?.id || null,
    healthState: health.state,
    ok: health.ok,
    degraded: health.degraded,
    counters: {
      steps: analytics.stepCount,
      requiredSteps: analytics.requiredStepCount,
      optionalSteps: analytics.optionalStepCount,
      completedSteps: analytics.completedStepCount,
      failedSteps: analytics.failedStepCount,
      pendingSteps: analytics.pendingStepCount,
      retryableSteps: analytics.retryableStepCount,
      blockedSteps: analytics.blockedStepCount,
      validationErrors: analytics.validationErrorCount,
      validationWarnings: analytics.validationWarningCount
    },
    readiness: {
      state: readiness.state,
      canPreview: readiness.canPreview,
      canAccept: readiness.canAccept,
      auditReady: readiness.auditReady,
      providerReady: readiness.providerReady,
      lifecycleReady: readiness.lifecycleReady,
      operationalCommandReady: readiness.operationalCommandReady,
      operationalCommandGateState: readiness.operationalCommandGateState,
      checksumCoverageRatio: analytics.checksumCoverageRatio,
      pinnedVersionRatio: analytics.pinnedVersionRatio,
      actionableErrorCount: actionableErrors.length,
      missingProof: readiness.missingProof,
      workspaceBoundaryReady: workspaceBoundary.dispatchable,
      changedSincePreviousSnapshot: Boolean(history.deltaFromPrevious?.healthChanged)
    },
    validationSummary: {
      status: validationSummary.status,
      errorCount: validationSummary.errorCount,
      warningCount: validationSummary.warningCount,
      providerIssueCount: validationSummary.providerIssueCount
    },
    acceptance: {
      required: acceptance.required,
      accepted: acceptance.accepted,
      gate: acceptance.gate,
      blockedReason: acceptance.blockedReason
    },
    lifecycle: {
      controlsEnabled: lifecycleControls.enabled,
      requestedCommand: lifecycleControls.requestedCommand,
      effectiveCommand: lifecycleCommandPolicy.effectiveCommand,
      commandAllowed: lifecycleCommandPolicy.allowed,
      commandBlockedReason: lifecycleCommandPolicy.blockedReason,
      commandEffect: lifecycleCommandPolicy.effect,
      disableDrainMode: lifecycleCommandPolicy.disableDrainMode,
      resumeSelectionPolicy: lifecycleCommandPolicy.resumeSelectionPolicy,
      canEnable: lifecycleControls.canEnable,
      canDisable: lifecycleControls.canDisable,
      canSchedule: lifecycleControls.canSchedule,
      auditRequired: lifecycleControls.auditRequired,
      scheduleDispatchable: scheduleControl.dispatchable,
      scheduleWindow: lifecycleCommandPolicy.scheduleWindow,
      operatorActions: lifecycleCommandPolicy.operatorActions
    },
    nextStep: {
      type: nextStep.type,
      command: nextStep.command,
      blocked: nextStep.blocked,
      requiresAcceptance: nextStep.requiresAcceptance,
      explanation: nextStep.explanation
    },
    providers: {
      acceptedContracts: capabilityNegotiation.acceptedContractCount,
      degradedContracts: capabilityNegotiation.degradedContractCount,
      allRequiredCapabilitiesMet: capabilityNegotiation.allRequiredCapabilitiesMet,
      syncedContracts: syncMetadata.syncedContractCount,
      unsyncedContracts: syncMetadata.unsyncedContractIds.length,
      serviceBindingState: providerServiceBindings.state,
      integrationState: providerIntegrationContract.state,
      integrationContractId: providerIntegrationContract.integrationId,
      integrationServiceIntents: providerIntegrationContract.serviceIntentCount,
      requiredServices: providerServiceBindings.requiredServices,
      electedContracts: providerServiceBindings.electedContractIds.length,
      fallbackContracts: providerServiceBindings.fallbackContractIds.length,
      serviceBindingHoldReasons: providerServiceBindings.holdReasons,
      integrationHoldReasons: providerIntegrationContract.holdReasons,
      pendingAcknowledgementServices: providerIntegrationContract.pendingAcknowledgementServices
    },
    operationalRecovery: {
      status: operationalRecovery.status,
      recommendedMode: operationalRecovery.recommendedMode,
      blockedServices: operationalRecovery.blockedServices,
      degradedServices: operationalRecovery.degradedServices,
      retryable: operationalRecovery.retryable,
      nextRetryInMs: operationalRecovery.nextRetryInMs,
      affectedCommands: operationalRecovery.recoveryProof.affectedCommands,
      proofRequired: operationalRecovery.recoveryProof.proofRequired,
      serviceDecisionCount: operationalRecovery.serviceDecisions.length,
      operatorAction: operationalRecovery.operatorAction
    },
    operationalCommandGate: {
      status: operationalCommandGate.status,
      requestedCommand: operationalCommandGate.requestedCommand,
      requestedCommandBlocked: operationalCommandGate.requestedCommandBlocked,
      requestedCommandMode: operationalCommandGate.requestedCommandMode,
      blockedCommands: operationalCommandGate.blockedCommands,
      degradedAllowedCommands: operationalCommandGate.degradedAllowedCommands,
      requiredProof: operationalCommandGate.requiredProof,
      nextRetryInMs: operationalCommandGate.nextRetryInMs,
      nextRetryAt: operationalCommandGate.nextRetryAt,
      operatorAction: operationalCommandGate.operatorAction
    },
    externalHandoff: {
      channel: externalHandoff.channel,
      state: externalHandoff.state,
      dispatchable: externalHandoff.dispatchable,
      eligibleContractCount: externalHandoff.eligibleContractIds.length,
      requiredServices: externalHandoff.requiredServices,
      serviceBindingState: externalHandoff.providerServiceBindingState,
      providerIntegrationState: externalHandoff.providerIntegrationState,
      providerIntegrationContractId: externalHandoff.providerIntegrationContractId,
      boundaryAllowedContractIds: externalHandoff.boundaryAllowedContractIds,
      boundaryBlockedContractIds: externalHandoff.boundaryBlockedContractIds,
      holdReason: externalHandoff.holdReason
    },
    dispatchManifest: {
      manifestId: dispatchManifest.manifestId,
      state: dispatchManifest.state,
      dispatchable: dispatchManifest.dispatchable,
      command: dispatchManifest.command,
      commandEnvelopeCount: dispatchManifest.commandEnvelopeCount,
      selectedStepCount: dispatchManifest.selectedStepIds.length,
      serviceBindingState: dispatchManifest.serviceBindingState,
      providerIntegrationState: dispatchManifest.providerIntegrationState,
      providerIntegrationContractId: dispatchManifest.providerIntegrationContractId,
      blockingReasons: dispatchManifest.blockingReasons,
      replay: dispatchManifest.replay
    },
    workspaceBoundary: {
      tenantId: workspaceBoundary.tenantId,
      workspaceId: workspaceBoundary.workspaceId,
      scopeMode: workspaceBoundary.scopeMode,
      actorId: workspaceBoundary.actorId,
      auditSink: workspaceBoundary.auditSink,
      dispatchable: workspaceBoundary.dispatchable,
      boundaryTokenPresent: workspaceBoundary.boundaryTokenPresent,
      missingPermissions: workspaceBoundary.missingPermissions,
      providerBoundaryState: workspaceBoundary.providerBoundaryState,
      blockedProviderContractIds: workspaceBoundary.blockedProviderContractIds,
      providerBoundaryHoldReasons: workspaceBoundary.providerBoundaryHoldReasons,
      holdReason: workspaceBoundary.holdReason
    },
    persistedStateRecovery: {
      status: persistedStateRecovery.status,
      commandIntent: persistedStateRecovery.commandIntent,
      idempotent: persistedStateRecovery.idempotent,
      safeToDispatch: persistedStateRecovery.safeToDispatch,
      activeCommandCount: persistedStateRecovery.activeCommandCount,
      checkpointCount: persistedStateRecovery.checkpointCount,
      staleForRequest: persistedStateRecovery.staleForRequest,
      staleForKernel: persistedStateRecovery.staleForKernel,
      duplicateCommandKeyCount: persistedStateRecovery.duplicateCommandKeys.length,
      duplicateCheckpointStepCount: persistedStateRecovery.duplicateCheckpointStepIds.length,
      activeConflictingCommandCount: persistedStateRecovery.activeConflictingCommandKeys.length,
      restartSafeStepCount: persistedStateRecovery.restartSafeStepIds.length,
      terminalStepCount: persistedStateRecovery.terminalStepIds.length,
      recoveryBlockers: persistedStateRecovery.recoveryBlockers
    },
    persistenceWriteSet: {
      status: persistenceWriteSet.status,
      writeMode: persistenceWriteSet.writeMode,
      writable: persistenceWriteSet.writable,
      expectedGeneration: persistenceWriteSet.expectedGeneration,
      commandAlreadyRecorded: persistenceWriteSet.commandAlreadyRecorded,
      commandRecordPresent: Boolean(persistenceWriteSet.commandRecord),
      checkpointUpsertCount: persistenceWriteSet.checkpointUpserts.length,
      deniedReasons: persistenceWriteSet.deniedReasons
    },
    persistedStateShape: {
      patchId: persistedStateShape.patchId,
      restartStatus: persistedStateShape.restartStatus,
      atomicPatchMode: persistedStateShape.atomicPatchMode,
      idempotencyDecision: persistedStateShape.idempotencyDecision,
      checkpointPatchCount: persistedStateShape.checkpointPatchCount,
      terminalStepCount: persistedStateShape.terminalStepIds.length,
      restartSafeStepCount: persistedStateShape.restartSafeStepIds.length,
      safeToApplyAfterRestart: persistedStateShape.recoverySemantics.safeToApplyAfterRestart,
      duplicateDispatchPrevented: persistedStateShape.recoverySemantics.duplicateDispatchPrevented,
      requiresCompareAndSwap: persistedStateShape.recoverySemantics.requiresCompareAndSwap
    },
    clientWorkflow: {
      requestId: clientWorkflowHandoff.requestId,
      clientId: clientWorkflowHandoff.clientId,
      state: clientWorkflowHandoff.state,
      dispatchable: clientWorkflowHandoff.dispatchable,
      dispatchManifestState: clientWorkflowHandoff.dispatchManifestState,
      commandEnvelopeCount: clientWorkflowHandoff.commandEnvelopeCount,
      requiredClientAction: clientWorkflowHandoff.requiredClientAction,
      blockedReason: clientWorkflowHandoff.blockedReason
    },
    clientPreviewAcceptance: {
      contract: clientPreviewAcceptanceModel.contract,
      state: clientPreviewAcceptanceModel.state,
      currentView: clientPreviewAcceptanceModel.currentView,
      displayMode: clientPreviewAcceptanceModel.displayMode,
      checklistItemCount: clientPreviewAcceptanceModel.readinessChecklist.length,
      blockingItemKeys: clientPreviewAcceptanceModel.blockingItemKeys,
      validationTone: clientPreviewAcceptanceModel.validationPanel.tone,
      acceptanceGate: clientPreviewAcceptanceModel.acceptancePanel.gate,
      nextRoute: clientPreviewAcceptanceModel.routePayloads.next.route,
      nextRouteMethod: clientPreviewAcceptanceModel.routePayloads.next.method,
      requiredClientAction: clientPreviewAcceptanceModel.nextStep.requiredClientAction
    },
    reporting: {
      reportId: reportingState.reportId,
      state: reportingState.state,
      exportFormat: reportingState.exportFormat,
      counterCount: reportingState.counterSeries.length,
      historyRowCount: reportingState.historyRows.length,
      timelineEventCount: reportingState.timelineDigest.eventCount,
      timelineSeverityCounts: reportingState.timelineDigest.severityCounts,
      regressionFlags: reportingState.historyRegressionFlags,
      subscriberHints: reportingState.subscriberHints,
      analyticsExportState: analyticsExportPackage.state,
      analyticsExportDestination: analyticsExportPackage.destination,
      analyticsExportFormat: analyticsExportPackage.format,
      analyticsExportTotalRows: analyticsExportPackage.totalRowCount
    }
  };
}

function buildProof({
  now,
  hostedKernel,
  steps,
  health,
  validation,
  retryPolicies,
  readiness,
  validationSummary,
  acceptance,
  nextStep,
  lifecycleControls,
  lifecycleCommandPolicy,
  scheduleControl,
  nextAction,
  capabilityNegotiation,
  providerServiceBindings,
  providerIntegrationContract,
  syncMetadata,
  externalHandoff,
  dispatchManifest,
  clientWorkflowHandoff,
  clientPreviewAcceptanceModel,
  operationalRecovery,
  operationalCommandGate,
  persistedStateRecovery,
  persistenceWriteSet,
  persistedStateShape,
  workspaceBoundary,
  reportingState,
  analyticsExportPackage
}) {
  return {
    generatedAt: now,
    surfaceId,
    subject: "hosted-kernel-package-install-plan",
    hostedKernelId: hostedKernel?.id || null,
    stepCount: steps.length,
    requiredStepCount: steps.filter((step) => step.required).length,
    healthState: health.state,
    validationErrorCount: validation.errors.length,
    validationWarningCount: validation.warnings.length,
    readinessState: readiness.state,
    missingProof: readiness.missingProof,
    validationStatus: validationSummary.status,
    acceptanceGate: acceptance.gate,
    retryableStepIds: retryPolicies.filter((policy) => policy.retryable).map((policy) => policy.stepId),
    lifecycle: {
      controlsEnabled: lifecycleControls.enabled,
      requestedCommand: lifecycleControls.requestedCommand,
      effectiveCommand: lifecycleCommandPolicy.effectiveCommand,
      commandAllowed: lifecycleCommandPolicy.allowed,
      commandBlockedReason: lifecycleCommandPolicy.blockedReason,
      commandBlockers: lifecycleCommandPolicy.blockers,
      commandEffect: lifecycleCommandPolicy.effect,
      disableDrainMode: lifecycleCommandPolicy.disableDrainMode,
      resumeSelectionPolicy: lifecycleCommandPolicy.resumeSelectionPolicy,
      scheduleWindow: lifecycleCommandPolicy.scheduleWindow,
      operatorActions: lifecycleCommandPolicy.operatorActions,
      scheduleDispatchable: scheduleControl.dispatchable,
      nextAction: nextAction.type,
      nextCommand: nextAction.command,
      blocked: nextAction.blocked
    },
    nextStep: {
      type: nextStep.type,
      command: nextStep.command,
      blocked: nextStep.blocked,
      requiresAcceptance: nextStep.requiresAcceptance,
      explanation: nextStep.explanation
    },
    providerContracts: {
      acceptedContractCount: capabilityNegotiation.acceptedContractCount,
      degradedContractCount: capabilityNegotiation.degradedContractCount,
      allRequiredCapabilitiesMet: capabilityNegotiation.allRequiredCapabilitiesMet,
      unsyncedContractIds: syncMetadata.unsyncedContractIds,
      serviceBindingState: providerServiceBindings.state,
      requiredServices: providerServiceBindings.requiredServices,
      holdReasons: providerServiceBindings.holdReasons,
      electedRoutesByService: providerServiceBindings.electedRoutesByService,
      bindings: providerServiceBindings.bindings,
      integrationContractId: providerIntegrationContract.integrationId,
      integrationState: providerIntegrationContract.state,
      integrationServiceIntents: providerIntegrationContract.serviceIntents,
      integrationExternalStatePatch: providerIntegrationContract.externalStatePatch,
      integrationHoldReasons: providerIntegrationContract.holdReasons
    },
    operationalRecovery: {
      source: operationalRecovery.source,
      observedAt: operationalRecovery.observedAt,
      status: operationalRecovery.status,
      recommendedMode: operationalRecovery.recommendedMode,
      blockedServices: operationalRecovery.blockedServices,
      degradedServices: operationalRecovery.degradedServices,
      serviceDecisions: operationalRecovery.serviceDecisions,
      recoveryProof: operationalRecovery.recoveryProof,
      nextRetryAt: operationalRecovery.nextRetryAt,
      operatorAction: operationalRecovery.operatorAction
    },
    operationalCommandGate: {
      contract: operationalCommandGate.contract,
      status: operationalCommandGate.status,
      requestedCommand: operationalCommandGate.requestedCommand,
      requestedCommandBlocked: operationalCommandGate.requestedCommandBlocked,
      requestedCommandMode: operationalCommandGate.requestedCommandMode,
      blockedCommands: operationalCommandGate.blockedCommands,
      degradedAllowedCommands: operationalCommandGate.degradedAllowedCommands,
      requiredProof: operationalCommandGate.requiredProof,
      nextRetryAt: operationalCommandGate.nextRetryAt,
      commandStates: operationalCommandGate.commandStates
    },
    externalHandoff: {
      channel: externalHandoff.channel,
      state: externalHandoff.state,
      dispatchable: externalHandoff.dispatchable,
      eligibleContractIds: externalHandoff.eligibleContractIds,
      requiredServices: externalHandoff.requiredServices,
      providerServiceBindingState: externalHandoff.providerServiceBindingState,
      providerIntegrationContractId: externalHandoff.providerIntegrationContractId,
      providerIntegrationState: externalHandoff.providerIntegrationState,
      providerExternalStatePatch: externalHandoff.providerExternalStatePatch,
      boundaryAllowedContractIds: externalHandoff.boundaryAllowedContractIds,
      boundaryBlockedContractIds: externalHandoff.boundaryBlockedContractIds,
      holdReason: externalHandoff.holdReason
    },
    dispatchManifest: {
      contract: dispatchManifest.contract,
      manifestId: dispatchManifest.manifestId,
      state: dispatchManifest.state,
      dispatchable: dispatchManifest.dispatchable,
      command: dispatchManifest.command,
      requestId: dispatchManifest.requestId,
      hostedKernelId: dispatchManifest.hostedKernelId,
      tenantId: dispatchManifest.tenantId,
      workspaceId: dispatchManifest.workspaceId,
      selectedStepIds: dispatchManifest.selectedStepIds,
      commandEnvelopeCount: dispatchManifest.commandEnvelopeCount,
      serviceBindingState: dispatchManifest.serviceBindingState,
      providerIntegrationContractId: dispatchManifest.providerIntegrationContractId,
      providerIntegrationState: dispatchManifest.providerIntegrationState,
      providerIntegrationExternalStatePatch: dispatchManifest.providerIntegrationExternalStatePatch,
      requiredProviderServices: dispatchManifest.requiredProviderServices,
      blockingReasons: dispatchManifest.blockingReasons,
      replay: dispatchManifest.replay,
      replayIdempotencyKey: dispatchManifest.replayIdempotencyKey,
      commandEnvelopes: dispatchManifest.commandEnvelopes
    },
    workspaceBoundary: {
      tenantId: workspaceBoundary.tenantId,
      workspaceId: workspaceBoundary.workspaceId,
      scopeMode: workspaceBoundary.scopeMode,
      actorId: workspaceBoundary.actorId,
      roles: workspaceBoundary.roles,
      requiredPermissions: workspaceBoundary.requiredPermissions,
      grantedPermissions: workspaceBoundary.grantedPermissions,
      missingPermissions: workspaceBoundary.missingPermissions,
      auditSink: workspaceBoundary.auditSink,
      boundaryTokenPresent: workspaceBoundary.boundaryTokenPresent,
      crossWorkspaceProvidersAllowed: workspaceBoundary.crossWorkspaceProvidersAllowed,
      providerBoundaryState: workspaceBoundary.providerBoundaryState,
      allowedProviderContractIds: workspaceBoundary.allowedProviderContractIds,
      blockedProviderContractIds: workspaceBoundary.blockedProviderContractIds,
      providerBoundaryHoldReasons: workspaceBoundary.providerBoundaryHoldReasons,
      providerScopeDecisions: workspaceBoundary.providerScopeDecisions,
      dispatchable: workspaceBoundary.dispatchable,
      holdReason: workspaceBoundary.holdReason
    },
    persistedStateRecovery: {
      planId: persistedStateRecovery.planId,
      generation: persistedStateRecovery.generation,
      status: persistedStateRecovery.status,
      commandIntent: persistedStateRecovery.commandIntent,
      expectedIdempotencyKey: persistedStateRecovery.expectedIdempotencyKey,
      matchingCommandState: persistedStateRecovery.matchingCommandState,
      activeCommandKeys: persistedStateRecovery.activeCommandKeys,
      activeConflictingCommandKeys: persistedStateRecovery.activeConflictingCommandKeys,
      duplicateCommandKeys: persistedStateRecovery.duplicateCommandKeys,
      duplicateCheckpointStepIds: persistedStateRecovery.duplicateCheckpointStepIds,
      recoveredStepStatuses: persistedStateRecovery.recoveredStepStatuses,
      restartSafeStepIds: persistedStateRecovery.restartSafeStepIds,
      terminalStepIds: persistedStateRecovery.terminalStepIds,
      restartShape: persistedStateRecovery.restartShape,
      recoveryBlockers: persistedStateRecovery.recoveryBlockers,
      operatorAction: persistedStateRecovery.operatorAction
    },
    persistenceWriteSet: {
      planId: persistenceWriteSet.planId,
      requestId: persistenceWriteSet.requestId,
      hostedKernelId: persistenceWriteSet.hostedKernelId,
      tenantId: persistenceWriteSet.tenantId,
      workspaceId: persistenceWriteSet.workspaceId,
      currentGeneration: persistenceWriteSet.currentGeneration,
      expectedGeneration: persistenceWriteSet.expectedGeneration,
      status: persistenceWriteSet.status,
      writeMode: persistenceWriteSet.writeMode,
      writable: persistenceWriteSet.writable,
      deniedReasons: persistenceWriteSet.deniedReasons,
      duplicateCommandKeys: persistenceWriteSet.duplicateCommandKeys,
      commandAlreadyRecorded: persistenceWriteSet.commandAlreadyRecorded,
      commandRecord: persistenceWriteSet.commandRecord,
      checkpointUpserts: persistenceWriteSet.checkpointUpserts,
      lockPatch: persistenceWriteSet.lockPatch,
      restartStatus: persistenceWriteSet.restartStatus
    },
    persistedStateShape: {
      contract: persistedStateShape.contract,
      patchId: persistedStateShape.patchId,
      planId: persistedStateShape.planId,
      expectedGeneration: persistedStateShape.expectedGeneration,
      compareGeneration: persistedStateShape.compareGeneration,
      restartStatus: persistedStateShape.restartStatus,
      atomicPatchMode: persistedStateShape.atomicPatchMode,
      idempotencyKey: persistedStateShape.idempotencyKey,
      idempotencyDecision: persistedStateShape.idempotencyDecision,
      commandRecordPatch: persistedStateShape.commandRecordPatch,
      checkpointPatchByStepId: persistedStateShape.checkpointPatchByStepId,
      statusPatch: persistedStateShape.statusPatch,
      recoverySemantics: persistedStateShape.recoverySemantics
    },
    clientWorkflow: {
      requestId: clientWorkflowHandoff.requestId,
      correlationId: clientWorkflowHandoff.correlationId,
      clientId: clientWorkflowHandoff.clientId,
      state: clientWorkflowHandoff.state,
      dispatchable: clientWorkflowHandoff.dispatchable,
      requiredClientAction: clientWorkflowHandoff.requiredClientAction,
      previewRoute: clientWorkflowHandoff.previewRoute,
      submitRoute: clientWorkflowHandoff.submitRoute
    },
    clientPreviewAcceptance: {
      contract: clientPreviewAcceptanceModel.contract,
      state: clientPreviewAcceptanceModel.state,
      currentView: clientPreviewAcceptanceModel.currentView,
      readinessChecklist: clientPreviewAcceptanceModel.readinessChecklist,
      validationPanel: clientPreviewAcceptanceModel.validationPanel,
      acceptancePanel: clientPreviewAcceptanceModel.acceptancePanel,
      nextStep: clientPreviewAcceptanceModel.nextStep,
      routePayloads: clientPreviewAcceptanceModel.routePayloads,
      statePatch: clientPreviewAcceptanceModel.statePatch
    },
    reporting: {
      reportId: reportingState.reportId,
      state: reportingState.state,
      exportFormat: reportingState.exportFormat,
      counterSeries: reportingState.counterSeries,
      historyRegressionFlags: reportingState.historyRegressionFlags,
      timelineDigest: reportingState.timelineDigest,
      exportBlocks: reportingState.exportBlocks,
      subscriberHints: reportingState.subscriberHints,
      analyticsExport: {
        exportId: analyticsExportPackage.exportId,
        state: analyticsExportPackage.state,
        format: analyticsExportPackage.format,
        destination: analyticsExportPackage.destination,
        rowCounts: analyticsExportPackage.rowCounts,
        delivery: analyticsExportPackage.delivery
      }
    }
  };
}

export function describeInstallPlanSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const steps = asArray(input.steps).map(normalizeStep);
  const hostedKernel = input.hostedKernel && typeof input.hostedKernel === "object" ? input.hostedKernel : null;
  const lifecycleSettings = normalizeLifecycleSettings(input.lifecycleSettings || input.lifecycle || input.settings?.lifecycle);
  const previewSettings = normalizePreviewSettings(input);
  const clientRequest = normalizeClientRequest(input);
  const workspaceScope = normalizeWorkspaceScope(input);
  const providerContracts = normalizeProviderContracts(input);
  const operationalHealth = normalizeOperationalHealth(input);
  const persistedState = normalizePersistedState(input);
  const analyticsExportRequest = normalizeAnalyticsExportRequest(input);
  const validation = validatePlan({
    hostedKernel,
    steps,
    lifecycleSettings,
    providerContracts,
    clientRequest,
    previewSettings,
    workspaceScope,
    operationalHealth,
    now
  });
  const retryPolicies = steps.map((step) => ({
    stepId: step.id,
    ...buildRetryPolicy(step, input.retryPolicy)
  }));
  const health = buildHealth({ errors: validation.errors, warnings: validation.warnings, steps });
  const lifecycleControls = buildLifecycleControls({
    settings: lifecycleSettings,
    health,
    validation,
    steps
  });
  const scheduleControl = buildScheduleControl({ now, settings: lifecycleSettings, lifecycleControls });
  const operationalRecovery = buildOperationalRecovery({
    now,
    operationalHealth,
    retryPolicies,
    validation
  });
  const operationalCommandGate = buildOperationalCommandGate({
    now,
    operationalRecovery,
    requestedCommand: LIFECYCLE_COMMANDS.has(lifecycleSettings.requestedCommand)
      ? lifecycleSettings.requestedCommand
      : null
  });
  const lifecycleCommandPolicy = buildLifecycleCommandPolicy({
    now,
    settings: lifecycleSettings,
    lifecycleControls,
    scheduleControl,
    retryPolicies,
    health,
    operationalCommandGate,
    validation,
    steps
  });
  const nextAction = buildNextAction({
    health,
    lifecycleControls,
    scheduleControl,
    retryPolicies,
    validation,
    commandPolicy: lifecycleCommandPolicy
  });
  const workspaceBoundary = buildWorkspaceBoundary({
    now,
    workspaceScope,
    clientRequest,
    nextAction,
    validation,
    providerContracts
  });
  const persistedStateRecovery = buildPersistedStateRecovery({
    now,
    persistedState,
    hostedKernel,
    steps,
    clientRequest,
    nextAction,
    health
  });
  const capabilityNegotiation = buildCapabilityNegotiation({ hostedKernel, providerContracts });
  const syncMetadata = buildSyncMetadata({ now, providerContracts });
  const providerServiceBindings = buildProviderServiceBindings({
    now,
    providerContracts,
    capabilityNegotiation,
    syncMetadata,
    nextAction,
    operationalHealth
  });
  const providerIntegrationContract = buildProviderIntegrationContract({
    now,
    hostedKernel,
    clientRequest,
    workspaceBoundary,
    nextAction,
    providerContracts,
    providerServiceBindings,
    capabilityNegotiation,
    syncMetadata
  });
  const analytics = buildAnalytics({ steps, validation, retryPolicies });
  const validationSummary = buildValidationSummary({ validation, steps, providerContracts });
  const externalHandoff = buildExternalHandoff({
    now,
    health,
    nextAction,
    providerContracts,
    capabilityNegotiation,
    providerServiceBindings,
    providerIntegrationContract,
    operationalRecovery,
    persistedStateRecovery,
    workspaceBoundary
  });
  const actionableErrors = buildActionableErrors(validation.errors, steps, operationalRecovery);
  const persistenceWriteSet = buildPersistenceWriteSet({
    now,
    persistedState,
    persistedStateRecovery,
    hostedKernel,
    steps,
    clientRequest,
    workspaceBoundary,
    nextAction,
    lifecycleCommandPolicy,
    externalHandoff,
    validationSummary
  });
  const readiness = buildReadinessContract({
    analytics,
    health,
    validationSummary,
    lifecycleControls,
    scheduleControl,
    capabilityNegotiation,
    providerServiceBindings,
    externalHandoff,
    operationalRecovery,
    operationalCommandGate,
    persistedStateRecovery,
    providerIntegrationContract,
    workspaceBoundary
  });
  const acceptance = buildAcceptanceContract({
    now,
    previewSettings,
    readiness,
    validationSummary,
    nextAction,
    lifecycleControls
  });
  const dispatchManifest = buildDispatchManifest({
    now,
    hostedKernel,
    steps,
    clientRequest,
    workspaceBoundary,
    nextAction,
    externalHandoff,
    acceptance,
    persistedStateRecovery,
    persistenceWriteSet,
    capabilityNegotiation,
    providerServiceBindings,
    providerIntegrationContract,
    operationalRecovery
  });
  const persistedStateShape = buildPersistedStateShape({
    now,
    persistedState,
    persistedStateRecovery,
    persistenceWriteSet,
    clientRequest,
    hostedKernel,
    workspaceBoundary,
    nextAction,
    dispatchManifest
  });
  const preview = buildPreviewContract({
    now,
    clientRequest,
    hostedKernel,
    steps,
    previewSettings,
    readiness,
    validationSummary,
    nextAction,
    externalHandoff,
    capabilityNegotiation,
    providerServiceBindings,
    workspaceBoundary
  });
  const nextStep = buildNextStepContract({
    nextAction,
    readiness,
    acceptance,
    validationSummary,
    externalHandoff
  });
  const clientWorkflowHandoff = buildClientWorkflowHandoff({
    now,
    clientRequest,
    previewSettings,
    readiness,
    acceptance,
    nextStep,
    externalHandoff,
    dispatchManifest,
    workspaceBoundary
  });
  const clientPreviewAcceptanceModel = buildClientPreviewAcceptanceModel({
    now,
    preview,
    readiness,
    validationSummary,
    acceptance,
    nextStep,
    clientWorkflowHandoff,
    dispatchManifest,
    providerServiceBindings,
    workspaceBoundary,
    operationalRecovery,
    operationalCommandGate
  });
  const history = buildHistorySnapshots({
    inputHistory: input.history,
    now,
    hostedKernel,
    health,
    analytics,
    readiness,
    nextAction,
    externalHandoff,
    workspaceBoundary
  });
  const timeline = buildTimeline({
    now,
    hostedKernel,
    steps,
    validation,
    retryPolicies,
    health,
    lifecycleControls,
    lifecycleCommandPolicy,
    scheduleControl,
    nextAction,
    capabilityNegotiation,
    providerServiceBindings,
    providerIntegrationContract,
    externalHandoff,
    dispatchManifest,
    operationalRecovery,
    operationalCommandGate,
    persistedStateRecovery,
    persistenceWriteSet,
    persistedStateShape,
    workspaceBoundary
  });
  const reportingState = buildReportingState({
    now,
    analytics,
    history,
    timeline,
    readiness,
    nextStep,
    externalHandoff,
    providerServiceBindings,
    providerIntegrationContract,
    dispatchManifest,
    operationalRecovery,
    persistedStateRecovery,
    persistenceWriteSet,
    persistedStateShape,
    workspaceBoundary
  });
  const analyticsExportPackage = buildAnalyticsExportPackage({
    now,
    analyticsExportRequest,
    clientRequest,
    analytics,
    history,
    timeline,
    reportingState,
    validationSummary,
    dispatchManifest,
    externalHandoff,
    providerServiceBindings,
    providerIntegrationContract,
    workspaceBoundary
  });
  const exportSummary = buildExportSummary({
    now,
    hostedKernel,
    health,
    analytics,
    actionableErrors,
    history,
    readiness,
    validationSummary,
    acceptance,
    nextStep,
    lifecycleControls,
    lifecycleCommandPolicy,
    scheduleControl,
    nextAction,
    capabilityNegotiation,
    providerServiceBindings,
    providerIntegrationContract,
    syncMetadata,
    externalHandoff,
    dispatchManifest,
    clientWorkflowHandoff,
    clientPreviewAcceptanceModel,
    operationalRecovery,
    operationalCommandGate,
    persistedStateRecovery,
    persistenceWriteSet,
    persistedStateShape,
    workspaceBoundary,
    reportingState,
    analyticsExportPackage
  });
  const audit = {
    eventType: "package-sdk.install-plan.health-evaluated",
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    hostedKernelId: hostedKernel?.id || null,
    healthState: health.state,
    degraded: health.degraded,
    actionableErrorCount: actionableErrors.length,
    analyticsCounters: exportSummary.counters,
    historySnapshotCount: history.snapshots.length,
    historyRegressionFlags: history.regressionFlags,
    reportId: reportingState.reportId,
    reportState: reportingState.state,
    reportCounterCount: reportingState.counterSeries.length,
    reportHistoryRowCount: reportingState.historyRows.length,
    reportTimelineEventCount: reportingState.timelineDigest.eventCount,
    reportSubscriberHints: reportingState.subscriberHints,
    analyticsExportId: analyticsExportPackage.exportId,
    analyticsExportState: analyticsExportPackage.state,
    analyticsExportFormat: analyticsExportPackage.format,
    analyticsExportDestination: analyticsExportPackage.destination,
    analyticsExportTotalRows: analyticsExportPackage.totalRowCount,
    analyticsExportRowCounts: analyticsExportPackage.rowCounts,
    lifecycleCommand: nextAction.command,
    lifecycleBlocked: nextAction.blocked,
    readinessState: readiness.state,
    readinessMissingProof: readiness.missingProof,
    validationStatus: validationSummary.status,
    previewStepCount: preview.visibleStepCount,
    acceptanceGate: acceptance.gate,
    nextStepCommand: nextStep.command,
      nextStepRequiresAcceptance: nextStep.requiresAcceptance,
      controlsEnabled: lifecycleControls.enabled,
      scheduleDispatchable: scheduleControl.dispatchable,
      lifecycleRequestedCommand: lifecycleCommandPolicy.requestedCommand,
    lifecycleEffectiveCommand: lifecycleCommandPolicy.effectiveCommand,
      lifecycleCommandAllowed: lifecycleCommandPolicy.allowed,
      lifecycleCommandBlockedReason: lifecycleCommandPolicy.blockedReason,
      lifecycleDisableDrainMode: lifecycleCommandPolicy.disableDrainMode,
      lifecycleResumeSelectionPolicy: lifecycleCommandPolicy.resumeSelectionPolicy,
      lifecycleOperatorActionCount: lifecycleCommandPolicy.operatorActions.length,
      lifecycleScheduleWindow: lifecycleCommandPolicy.scheduleWindow,
      providerContractCount: providerContracts.length,
    acceptedProviderContractCount: capabilityNegotiation.acceptedContractCount,
    degradedProviderContractCount: capabilityNegotiation.degradedContractCount,
      providerServiceBindingState: providerServiceBindings.state,
    providerIntegrationState: providerIntegrationContract.state,
    providerIntegrationContractId: providerIntegrationContract.integrationId,
    providerIntegrationHoldReasons: providerIntegrationContract.holdReasons,
    providerServiceBindingHoldReasons: providerServiceBindings.holdReasons,
    providerServiceBindingElectedContracts: providerServiceBindings.electedContractIds,
    operationalHealthStatus: operationalHealth.status,
    operationalRecoveryMode: operationalRecovery.recommendedMode,
    operationalRecoveryRetryable: operationalRecovery.retryable,
    operationalRecoveryServiceDecisionCount: operationalRecovery.serviceDecisions.length,
    operationalRecoveryAffectedCommands: operationalRecovery.recoveryProof.affectedCommands,
    operationalRecoveryProofRequired: operationalRecovery.recoveryProof.proofRequired,
    operationalCommandGateStatus: operationalCommandGate.status,
    operationalCommandGateRequestedMode: operationalCommandGate.requestedCommandMode,
    operationalCommandGateRequestedBlocked: operationalCommandGate.requestedCommandBlocked,
    operationalCommandGateBlockedCommands: operationalCommandGate.blockedCommands,
    operationalCommandGateDegradedAllowedCommands: operationalCommandGate.degradedAllowedCommands,
    operationalCommandGateRequiredProof: operationalCommandGate.requiredProof,
    operationalCommandGateNextRetryAt: operationalCommandGate.nextRetryAt,
    externalHandoffState: externalHandoff.state,
    externalHandoffDispatchable: externalHandoff.dispatchable,
    dispatchManifestId: dispatchManifest.manifestId,
    dispatchManifestState: dispatchManifest.state,
    dispatchManifestDispatchable: dispatchManifest.dispatchable,
    dispatchManifestEnvelopeCount: dispatchManifest.commandEnvelopeCount,
    dispatchManifestBlockingReasons: dispatchManifest.blockingReasons,
    persistedStatePresent: persistedState.present,
    persistedStateStatus: persistedStateRecovery.status,
    persistedCommandIntent: persistedStateRecovery.commandIntent,
    persistedIdempotencyKey: persistedStateRecovery.expectedIdempotencyKey,
    persistedSafeToDispatch: persistedStateRecovery.safeToDispatch,
    persistedRecoveredStepCount: persistedStateRecovery.recoveredStepStatuses.length,
    persistedRestartSafeStepIds: persistedStateRecovery.restartSafeStepIds,
    persistedTerminalStepIds: persistedStateRecovery.terminalStepIds,
    persistedRecoveryBlockers: persistedStateRecovery.recoveryBlockers,
    persistedDuplicateCommandKeys: persistedStateRecovery.duplicateCommandKeys,
    persistedDuplicateCheckpointStepIds: persistedStateRecovery.duplicateCheckpointStepIds,
    persistedActiveConflictingCommandKeys: persistedStateRecovery.activeConflictingCommandKeys,
    persistenceWriteMode: persistenceWriteSet.writeMode,
    persistenceWritable: persistenceWriteSet.writable,
    persistenceExpectedGeneration: persistenceWriteSet.expectedGeneration,
    persistenceCheckpointUpsertCount: persistenceWriteSet.checkpointUpserts.length,
    persistedStateShapePatchId: persistedStateShape.patchId,
    persistedStateShapeRestartStatus: persistedStateShape.restartStatus,
    persistedStateShapePatchMode: persistedStateShape.atomicPatchMode,
    persistedStateShapeIdempotencyDecision: persistedStateShape.idempotencyDecision,
    persistedStateShapeCheckpointPatchCount: persistedStateShape.checkpointPatchCount,
    persistedStateShapeSafeToApplyAfterRestart: persistedStateShape.recoverySemantics.safeToApplyAfterRestart,
    tenantId: workspaceBoundary.tenantId,
    workspaceId: workspaceBoundary.workspaceId,
    workspaceBoundaryDispatchable: workspaceBoundary.dispatchable,
    workspaceBoundaryHoldReason: workspaceBoundary.holdReason,
    workspaceProviderBoundaryState: workspaceBoundary.providerBoundaryState,
    workspaceProviderBoundaryBlockedContracts: workspaceBoundary.blockedProviderContractIds,
    workspaceProviderBoundaryHoldReasons: workspaceBoundary.providerBoundaryHoldReasons,
    workspaceAuditSink: workspaceBoundary.auditSink,
    clientRequestId: clientWorkflowHandoff.requestId,
    clientWorkflowState: clientWorkflowHandoff.state,
    clientWorkflowAction: clientWorkflowHandoff.requiredClientAction,
    clientWorkflowDispatchable: clientWorkflowHandoff.dispatchable,
    clientPreviewAcceptanceState: clientPreviewAcceptanceModel.state,
    clientPreviewAcceptanceCurrentView: clientPreviewAcceptanceModel.currentView,
    clientPreviewAcceptanceGate: clientPreviewAcceptanceModel.acceptancePanel.gate,
    clientPreviewAcceptanceBlockingItems: clientPreviewAcceptanceModel.blockingItemKeys,
    clientPreviewAcceptanceNextRoute: clientPreviewAcceptanceModel.routePayloads.next.route
  };

  return {
    ok: health.ok,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'hosted-kernel package install plan with health, validation, retry, degraded-mode, and audit proof outputs',
    health,
    validation,
    validationSummary,
    steps,
    retryPolicies,
    previewSettings,
    clientRequest,
    preview,
    readiness,
    acceptance,
    lifecycleSettings,
    lifecycleControls,
    lifecycleCommandPolicy,
    scheduleControl,
    nextAction,
    nextStep,
    providerContracts,
    workspaceScope,
    workspaceBoundary,
    operationalHealth,
    operationalRecovery,
    operationalCommandGate,
    persistedState,
    persistedStateRecovery,
    persistenceWriteSet,
    persistedStateShape,
    dispatchManifest,
    capabilityNegotiation,
    providerServiceBindings,
    providerIntegrationContract,
    syncMetadata,
    externalHandoff,
    clientWorkflowHandoff,
    clientPreviewAcceptanceModel,
    analytics,
    analyticsExportRequest,
    analyticsExportPackage,
    history,
    timeline,
    reportingState,
    exportSummary,
    actionableErrors,
    degradedMode: {
      enabled: health.degraded,
      allowsOptionalSteps: health.state !== "blocked",
      requiresIntegrityPromotion: validation.warnings.some((warning) => warning.code === "PACKAGE_CHECKSUM_MISSING"),
      lifecycleCommand: nextAction.command,
      operationalMode: operationalRecovery.recommendedMode,
      operationalCommandGateStatus: operationalCommandGate.status,
      operationalCommandGateBlockedCommands: operationalCommandGate.blockedCommands,
      operationalCommandGateDegradedAllowedCommands: operationalCommandGate.degradedAllowedCommands,
      blockedServices: operationalRecovery.blockedServices,
      degradedServices: operationalRecovery.degradedServices,
      serviceDecisions: operationalRecovery.serviceDecisions,
      recoveryProof: operationalRecovery.recoveryProof,
      workspaceBoundaryHeld: !workspaceBoundary.dispatchable,
      workspaceBoundaryHoldReason: workspaceBoundary.holdReason,
      persistedRecoveryStatus: persistedStateRecovery.status,
      persistedCommandIntent: persistedStateRecovery.commandIntent,
      persistenceWriteMode: persistenceWriteSet.writeMode,
      persistenceWritable: persistenceWriteSet.writable,
      persistedStatePatchMode: persistedStateShape.atomicPatchMode,
      persistedRestartStatus: persistedStateShape.restartStatus,
      persistedStateSafeToApplyAfterRestart: persistedStateShape.recoverySemantics.safeToApplyAfterRestart
    },
    audit,
    proof: buildProof({
      now,
      hostedKernel,
      steps,
      health,
      validation,
      retryPolicies,
      readiness,
      validationSummary,
      acceptance,
      nextStep,
      lifecycleControls,
      lifecycleCommandPolicy,
      scheduleControl,
      nextAction,
      capabilityNegotiation,
      providerServiceBindings,
      providerIntegrationContract,
      syncMetadata,
      externalHandoff,
      dispatchManifest,
      clientWorkflowHandoff,
      clientPreviewAcceptanceModel,
      operationalRecovery,
      operationalCommandGate,
      persistedStateRecovery,
      persistenceWriteSet,
      persistedStateShape,
      workspaceBoundary,
      reportingState,
      analyticsExportPackage
    }),
    evidence: Array.isArray(input.evidence) ? input.evidence : []
  };
}

export default describeInstallPlanSurface;
