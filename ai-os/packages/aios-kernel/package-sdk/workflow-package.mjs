export const surfaceId = "aios_package-sdk_workflow-package_097";
export const surfaceGroup = "package-sdk";
export const surfaceName = "workflow-package";

const DEFAULT_ROUTE = "hosted-kernel.workflow-package";
const VALID_HANDOFFS = new Set(["continue", "review", "blocked", "complete"]);
const VALID_PERSISTED_STATUSES = new Set(["new", "running", "blocked", "complete", "recovering"]);
const VALID_COMMANDS = new Set(["resume", "checkpoint", "acknowledge", "complete", "block"]);
const VALID_ROLES = new Set(["viewer", "operator", "maintainer", "owner"]);
const VALID_HEALTH_STATUSES = new Set(["healthy", "degraded", "unavailable"]);
const VALID_CHECK_STATUSES = new Set(["pass", "warn", "fail"]);
const VALID_DELIVERY_MODES = new Set(["inline", "queued", "webhook"]);
const VALID_SYNC_MODES = new Set(["push", "pull", "bidirectional"]);
const VALID_PROVIDER_AUTH_MODES = new Set(["none", "shared-secret", "oauth", "signed-request"]);
const VALID_SYNC_CONFLICT_POLICIES = new Set(["provider-wins", "kernel-wins", "manual-review"]);
const VALID_SCHEDULE_MODES = new Set(["immediate", "manual", "scheduled", "recurring", "disabled"]);
const VALID_CLIENT_STATE_MODES = new Set(["snapshot", "delta", "stream"]);
const VALID_CLIENT_HANDOFF_TARGETS = new Set(["chat", "dashboard", "automation", "api"]);
const VALID_CLIENT_URGENCIES = new Set(["normal", "attention", "urgent"]);
const VALID_CLIENT_ACTIONS = new Set([
  "refresh-client-state",
  "accept-preview",
  "review-blockers",
  "dispatch-now",
  "wait-for-schedule",
  "manual-dispatch",
  "continue-degraded",
  "acknowledge-state",
  "view-preview",
  "view-handoff-proof",
  "view-audit-trail",
  "view-provider-sync",
  "resolve-lifecycle-controls",
  "review-boundary"
]);
const VALID_ACCEPTANCE_DECISIONS = new Set(["pending", "accepted", "rejected", "needs-review"]);
const VALID_NEXT_STEP_TARGETS = new Set(["client", "operator", "provider", "scheduler", "audit"]);
const VALID_RECOVERY_POLICIES = new Set(["checkpoint-required", "best-effort", "manual-review"]);
const VALID_INCIDENT_SEVERITIES = new Set(["info", "warning", "critical"]);
const VALID_INCIDENT_STATUSES = new Set(["open", "acknowledged", "resolved"]);
const VALID_REPORTING_WINDOWS = new Set(["run", "hour", "day", "week"]);
const VALID_LIFECYCLE_CONTROL_ACTIONS = new Set(["none", "enable", "disable", "pause", "unpause", "reschedule", "approve"]);
const RETRYABLE_COMMANDS = new Set(["resume", "checkpoint", "block"]);
const DEFAULT_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30000;
const DEFAULT_CIRCUIT_BREAKER_THRESHOLD = 5;
const MIN_SCHEDULE_INTERVAL_MS = 60000;
const MAX_SCHEDULE_INTERVAL_MS = 86400000;
const DEFAULT_LIFECYCLE_TIMEOUT_MS = 300000;
const MAX_LIFECYCLE_TIMEOUT_MS = 7200000;
const DEFAULT_PROVIDER_CAPABILITIES = [
  "workflow.command.dispatch",
  "workflow.state.sync",
  "workflow.inline.response",
  "workflow.queue.dispatch",
  "workflow.webhook.callback",
  "workflow.proof.attach"
];
const ROLE_PERMISSIONS = {
  viewer: ["workflow:read", "audit:read"],
  operator: ["workflow:read", "workflow:resume", "audit:read"],
  maintainer: ["workflow:read", "workflow:resume", "workflow:checkpoint", "audit:read", "audit:write"],
  owner: [
    "workflow:read",
    "workflow:resume",
    "workflow:checkpoint",
    "workflow:complete",
    "audit:read",
    "audit:write",
    "tenant:admin"
  ]
};
const COMMAND_PERMISSIONS = {
  resume: "workflow:resume",
  checkpoint: "workflow:checkpoint",
  acknowledge: "workflow:read",
  complete: "workflow:complete",
  block: "workflow:checkpoint"
};
const TENANT_BOUND_EXPORTS = new Set([
  "clientState",
  "auditTrail",
  "handoffProof",
  "kernelCommandEnvelope",
  "analyticsReport",
  "historySnapshots",
  "exportSummary",
  "timeline"
]);

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asNonEmptyString(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item) => typeof item === "string" && item.trim())
    .map((item) => item.trim());
}

function asNonNegativeInteger(value, fallback = 0) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function asOptionalNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function asBoolean(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function uniqueStringList(items) {
  return [...new Set(asStringList(items))];
}

function filterValidClientActions(items) {
  return uniqueStringList(items).filter((item) => VALID_CLIENT_ACTIONS.has(item));
}

function integrationAcceptsProofForClient(handoffTarget) {
  return handoffTarget === "api" || handoffTarget === "automation";
}

function normalizeCounterMap(value) {
  return Object.entries(asObject(value)).reduce((counters, [key, count]) => {
    const counterName = asNonEmptyString(key, "");

    if (counterName) {
      counters[counterName] = asNonNegativeInteger(count);
    }

    return counters;
  }, {});
}

function addCounterMaps(...maps) {
  return maps.reduce((combined, map) => {
    for (const [key, count] of Object.entries(normalizeCounterMap(map))) {
      combined[key] = (combined[key] || 0) + count;
    }

    return combined;
  }, {});
}

function clampNonNegativeInteger(value, fallback, max) {
  return Math.min(asNonNegativeInteger(value, fallback), max);
}

function clampIntegerRange(value, fallback, min, max) {
  return Math.min(Math.max(asNonNegativeInteger(value, fallback), min), max);
}

function addMillisecondsToIsoString(value, milliseconds) {
  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp)
    ? new Date(timestamp + milliseconds).toISOString()
    : "";
}

function normalizeRole(value) {
  const role = asNonEmptyString(value, "operator");
  return VALID_ROLES.has(role) ? role : "viewer";
}

function normalizeScopedBoundaryList(...values) {
  return uniqueStringList(values.flatMap((value) => asStringList(value)));
}

function buildBoundaryScopeContract(input, request, client, runtime, tenantId, workspaceId, role) {
  const tenant = asObject(input.tenant);
  const workspace = asObject(input.workspace);
  const persisted = asObject(input.persistedState);
  const requestScope = asObject(request.scope);
  const clientScope = asObject(client.scope);
  const runtimeScope = asObject(runtime.scope);
  const tenantIds = normalizeScopedBoundaryList(
    tenant.allowedTenantIds,
    requestScope.tenantIds,
    clientScope.tenantIds,
    runtimeScope.tenantIds
  );
  const workspaceIds = normalizeScopedBoundaryList(
    tenant.workspaceIds,
    tenant.allowedWorkspaceIds,
    workspace.allowedWorkspaceIds,
    requestScope.workspaceIds,
    client.workspaceIds,
    clientScope.workspaceIds,
    runtime.workspaceIds,
    runtimeScope.workspaceIds
  );
  const explicitTenantScope = tenantIds.length > 0;
  const explicitWorkspaceScope = workspaceIds.length > 0;
  const tenantAuthorized = !explicitTenantScope || tenantIds.includes(tenantId);
  const workspaceAuthorized = !explicitWorkspaceScope || workspaceIds.includes(workspaceId);
  const persistedTenantId = asNonEmptyString(persisted.tenantId, tenantId);
  const persistedWorkspaceId = asNonEmptyString(persisted.workspaceId, workspaceId);
  const boundaryKey = `${tenantId}:${workspaceId}`;
  const persistedBoundaryKey = `${persistedTenantId}:${persistedWorkspaceId}`;
  const administrator = role === "owner";

  return {
    schemaVersion: "workflow-package.boundary-scope.v1",
    boundaryKey,
    persistedBoundaryKey,
    tenantId,
    workspaceId,
    tenantAuthorized,
    workspaceAuthorized,
    explicitTenantScope,
    explicitWorkspaceScope,
    requestedTenantIds: tenantIds,
    requestedWorkspaceIds: workspaceIds,
    persistedTenantId,
    persistedWorkspaceId,
    persistedBoundaryMatches: boundaryKey === persistedBoundaryKey,
    isolationDecision: tenantAuthorized && workspaceAuthorized && boundaryKey === persistedBoundaryKey
      ? "allow"
      : administrator && tenantAuthorized && workspaceAuthorized
        ? "owner-review"
        : "deny",
    handoff: {
      auditPartitionKey: boundaryKey,
      storagePartitionKey: boundaryKey,
      proofSubject: `${boundaryKey}:${asNonEmptyString(request.workflowId, asNonEmptyString(input.workflowId, surfaceName))}`,
      requiresTenantScopedExports: true
    }
  };
}

function normalizeBoundaryContext(input, request, client, workflowId) {
  const tenant = asObject(input.tenant);
  const workspace = asObject(input.workspace);
  const runtime = asObject(input.runtime);
  const role = normalizeRole(client.role || request.role);
  const tenantId = asNonEmptyString(
    request.tenantId,
    asNonEmptyString(tenant.id, "tenant:default")
  );
  const workspaceId = asNonEmptyString(
    request.workspaceId,
    asNonEmptyString(workspace.id, `${tenantId}:workspace:default`)
  );
  const persistedTenantId = asNonEmptyString(input.persistedState?.tenantId, tenantId);
  const persistedWorkspaceId = asNonEmptyString(input.persistedState?.workspaceId, workspaceId);
  const scopeContract = buildBoundaryScopeContract(input, request, client, runtime, tenantId, workspaceId, role);
  const allowedWorkspaceIds = scopeContract.explicitWorkspaceScope
    ? scopeContract.requestedWorkspaceIds
    : uniqueStringList([workspaceId]);
  const requestedPermissions = uniqueStringList(request.permissions);
  const grantedPermissions = uniqueStringList([
    ...ROLE_PERMISSIONS[role],
    ...asStringList(client.permissions),
    ...asStringList(runtime.permissions)
  ]);
  const requiredPermission = COMMAND_PERMISSIONS[asNonEmptyString(request.command, "resume")] || "workflow:read";
  const hasWorkspaceAccess = scopeContract.workspaceAuthorized;
  const hasTenantAccess = scopeContract.tenantAuthorized;
  const samePersistedBoundary = persistedTenantId === tenantId && persistedWorkspaceId === workspaceId;
  const missingPermissions = uniqueStringList([
    requiredPermission,
    ...requestedPermissions
  ]).filter((permission) => !grantedPermissions.includes(permission));
  const boundaryDecision = hasTenantAccess && hasWorkspaceAccess && samePersistedBoundary && missingPermissions.length === 0
    ? "allow"
    : scopeContract.isolationDecision === "owner-review" && missingPermissions.length === 0
      ? "owner-review"
      : "deny";

  return {
    schemaVersion: "workflow-package.permission-boundary.v1",
    tenantId,
    workspaceId,
    role,
    persistedTenantId,
    persistedWorkspaceId,
    boundaryKey: scopeContract.boundaryKey,
    persistedBoundaryKey: scopeContract.persistedBoundaryKey,
    allowedWorkspaceIds,
    allowedTenantIds: scopeContract.requestedTenantIds,
    explicitTenantScope: scopeContract.explicitTenantScope,
    explicitWorkspaceScope: scopeContract.explicitWorkspaceScope,
    hasTenantAccess,
    requestedPermissions,
    grantedPermissions,
    requiredPermission,
    hasWorkspaceAccess,
    samePersistedBoundary,
    missingPermissions,
    scopeContract,
    boundaryDecision,
    auditPartitionKey: scopeContract.handoff.auditPartitionKey,
    storagePartitionKey: scopeContract.handoff.storagePartitionKey,
    proofSubject: scopeContract.handoff.proofSubject,
    isolationMode: boundaryDecision === "allow"
      ? "tenant-workspace-bound"
      : "boundary-review"
  };
}

function boundaryBlockers(boundary) {
  const blockers = [];

  if (!boundary.hasTenantAccess) {
    blockers.push(`tenant-not-authorized:${boundary.tenantId}`);
  }

  if (!boundary.hasWorkspaceAccess) {
    blockers.push(`workspace-not-authorized:${boundary.workspaceId}`);
  }

  if (!boundary.samePersistedBoundary) {
    blockers.push("persisted-state-boundary-mismatch");
  }

  for (const permission of boundary.missingPermissions) {
    blockers.push(`permission-missing:${permission}`);
  }

  return blockers;
}

function filterTenantScopedExports(requestedExports, boundary) {
  if (boundary.isolationMode !== "tenant-workspace-bound") {
    const reviewSafeExports = new Set(["clientState", "handoffProof", "exportSummary"]);
    return requestedExports.filter((item) => reviewSafeExports.has(item));
  }

  const allowedExports = boundary.grantedPermissions.includes("audit:read")
    ? TENANT_BOUND_EXPORTS
    : new Set(["clientState", "handoffProof"]);

  return requestedExports.filter((item) => allowedExports.has(item));
}

function normalizeCommand(request, client) {
  const requestedCommand = asNonEmptyString(request.command, "resume");
  const command = VALID_COMMANDS.has(requestedCommand) ? requestedCommand : "resume";
  const commandId = asNonEmptyString(
    request.commandId,
    asNonEmptyString(client.requestId, `${command}:implicit`)
  );

  return {
    command,
    commandId,
    idempotencyKey: asNonEmptyString(request.idempotencyKey, commandId)
  };
}

function normalizeIntegrationContract(input, request, runtime, workflowId) {
  const integration = asObject(input.integration);
  const requestIntegration = asObject(request.integration);
  const runtimeIntegration = asObject(runtime.integration);
  const requestedDeliveryMode = asNonEmptyString(
    requestIntegration.deliveryMode,
    asNonEmptyString(integration.deliveryMode, "inline")
  );
  const deliveryMode = VALID_DELIVERY_MODES.has(requestedDeliveryMode) ? requestedDeliveryMode : "inline";
  const callbackUrl = deliveryMode === "webhook"
    ? asNonEmptyString(
      requestIntegration.callbackUrl,
      asNonEmptyString(integration.callbackUrl, "")
    )
    : "";
  const queueName = deliveryMode === "queued"
    ? asNonEmptyString(
      requestIntegration.queueName,
      asNonEmptyString(integration.queueName, `${workflowId}:kernel-commands`)
    )
    : "";
  const timeoutMs = clampNonNegativeInteger(
    requestIntegration.timeoutMs,
    clampNonNegativeInteger(integration.timeoutMs, 10000, 120000),
    120000
  );
  const schemaVersion = asNonEmptyString(
    runtimeIntegration.schemaVersion,
    asNonEmptyString(integration.schemaVersion, "workflow-package.command.v1")
  );
  const acceptsProof = asBoolean(
    requestIntegration.acceptsProof,
    asBoolean(integration.acceptsProof, true)
  );
  const requestedAcknowledgement = asNonEmptyString(
    requestIntegration.acknowledgement,
    asNonEmptyString(integration.acknowledgement, deliveryMode === "inline" ? "synchronous" : "deferred")
  );
  const acknowledgement = requestedAcknowledgement === "deferred" || requestedAcknowledgement === "synchronous"
    ? requestedAcknowledgement
    : deliveryMode === "inline" ? "synchronous" : "deferred";

  return {
    schemaVersion,
    deliveryMode,
    acknowledgement,
    callbackUrl,
    queueName,
    timeoutMs,
    acceptsProof,
    connectorId: asNonEmptyString(
      requestIntegration.connectorId,
      asNonEmptyString(integration.connectorId, "hosted-kernel")
    ),
    requestedOutputContracts: uniqueStringList([
      ...asStringList(integration.outputContracts),
      ...asStringList(requestIntegration.outputContracts)
    ])
  };
}

function normalizeProviderServiceContract(input, request, runtime, integration, workflowId) {
  const provider = asObject(input.provider);
  const requestProvider = asObject(request.provider);
  const runtimeProvider = asObject(runtime.provider);
  const sync = asObject(input.sync);
  const providerSync = asObject(provider.sync);
  const requestSync = asObject(requestProvider.sync);
  const providerHandoff = asObject(provider.handoff);
  const requestHandoff = asObject(requestProvider.handoff);
  const requestedSyncMode = asNonEmptyString(
    requestSync.mode,
    asNonEmptyString(providerSync.mode, asNonEmptyString(sync.mode, "push"))
  );
  const syncMode = VALID_SYNC_MODES.has(requestedSyncMode) ? requestedSyncMode : "push";
  const requestedAuthMode = asNonEmptyString(
    requestHandoff.authMode,
    asNonEmptyString(providerHandoff.authMode, integration.deliveryMode === "inline" ? "none" : "signed-request")
  );
  const authMode = VALID_PROVIDER_AUTH_MODES.has(requestedAuthMode) ? requestedAuthMode : "signed-request";
  const requestedConflictPolicy = asNonEmptyString(
    requestSync.conflictPolicy,
    asNonEmptyString(providerSync.conflictPolicy, "manual-review")
  );
  const conflictPolicy = VALID_SYNC_CONFLICT_POLICIES.has(requestedConflictPolicy)
    ? requestedConflictPolicy
    : "manual-review";
  const requestedServiceStatus = asNonEmptyString(
    runtimeProvider.status,
    asNonEmptyString(provider.status, "healthy")
  );
  const serviceStatus = VALID_HEALTH_STATUSES.has(requestedServiceStatus)
    ? requestedServiceStatus
    : "degraded";
  const deliveryCapabilities = integration.deliveryMode === "webhook"
    ? ["workflow.webhook.callback"]
    : integration.deliveryMode === "queued"
      ? ["workflow.queue.dispatch"]
      : ["workflow.inline.response"];
  const proofCapabilities = integration.acceptsProof ? ["workflow.proof.attach"] : [];
  const requiredCapabilities = uniqueStringList([
    "workflow.command.dispatch",
    "workflow.state.sync",
    ...deliveryCapabilities,
    ...proofCapabilities,
    ...asStringList(provider.requiredCapabilities),
    ...asStringList(requestProvider.requiredCapabilities)
  ]);
  const offeredCapabilities = uniqueStringList([
    ...DEFAULT_PROVIDER_CAPABILITIES,
    ...asStringList(runtime.capabilities),
    ...asStringList(provider.capabilities),
    ...asStringList(runtimeProvider.capabilities)
  ]);
  const optionalCapabilities = uniqueStringList([
    ...asStringList(provider.optionalCapabilities),
    ...asStringList(requestProvider.optionalCapabilities)
  ]);
  const missingCapabilities = requiredCapabilities.filter((capability) => !offeredCapabilities.includes(capability));
  const negotiatedCapabilities = requiredCapabilities.filter((capability) => offeredCapabilities.includes(capability));
  const optionalAccepted = optionalCapabilities.filter((capability) => offeredCapabilities.includes(capability));
  const providerId = asNonEmptyString(
    requestProvider.providerId,
    asNonEmptyString(provider.providerId, asNonEmptyString(integration.connectorId, "hosted-kernel"))
  );
  const serviceName = asNonEmptyString(
    requestProvider.serviceName,
    asNonEmptyString(provider.serviceName, "workflow-package-provider")
  );
  const syncTarget = asNonEmptyString(
    requestSync.target,
    asNonEmptyString(providerSync.target, `${providerId}:${workflowId}:sync`)
  );
  const handoffEndpoint = integration.deliveryMode === "webhook"
    ? asNonEmptyString(
      requestHandoff.endpoint,
      asNonEmptyString(providerHandoff.endpoint, integration.callbackUrl)
    )
    : integration.deliveryMode === "queued"
      ? asNonEmptyString(
        requestHandoff.endpoint,
        asNonEmptyString(providerHandoff.endpoint, integration.queueName)
      )
      : asNonEmptyString(
        requestHandoff.endpoint,
        asNonEmptyString(providerHandoff.endpoint, "inline-response")
      );
  const ackTopic = integration.deliveryMode === "inline"
    ? "inline-response"
    : asNonEmptyString(
      requestHandoff.ackTopic,
      asNonEmptyString(providerHandoff.ackTopic, `${providerId}:${workflowId}:ack`)
    );
  const handoffSubject = asNonEmptyString(
    requestHandoff.subject,
    asNonEmptyString(providerHandoff.subject, `${providerId}:${workflowId}:${integration.deliveryMode}`)
  );
  const externalState = missingCapabilities.length
    ? "capability-review"
    : serviceStatus === "unavailable"
      ? "provider-unavailable"
      : integration.deliveryMode === "inline"
        ? "inline-ready"
        : "handoff-pending";

  return {
    providerId,
    serviceName,
    apiVersion: asNonEmptyString(
      runtimeProvider.apiVersion,
      asNonEmptyString(provider.apiVersion, "workflow-provider.v1")
    ),
    serviceStatus,
    requiredCapabilities,
    offeredCapabilities,
    negotiatedCapabilities,
    missingCapabilities,
    optionalAccepted,
    externalState,
    capabilityDecision: missingCapabilities.length
      ? "capability-review"
      : serviceStatus === "unavailable"
        ? "provider-unavailable"
        : "negotiated",
    sync: {
      mode: syncMode,
      target: syncTarget,
      cursor: asNonEmptyString(requestSync.cursor, asNonEmptyString(providerSync.cursor, asNonEmptyString(sync.cursor, ""))),
      nextCursor: asNonEmptyString(
        requestSync.nextCursor,
        asNonEmptyString(providerSync.nextCursor, `${workflowId}:${providerId}:next`)
      ),
      watermark: asNonEmptyString(
        requestSync.watermark,
        asNonEmptyString(providerSync.watermark, asNonEmptyString(sync.watermark, ""))
      ),
      lastSyncedAt: asNonEmptyString(
        requestSync.lastSyncedAt,
        asNonEmptyString(providerSync.lastSyncedAt, asNonEmptyString(sync.lastSyncedAt, ""))
      ),
      sequence: asNonNegativeInteger(
        requestSync.sequence,
        asNonNegativeInteger(providerSync.sequence, asNonNegativeInteger(sync.sequence))
      ),
      conflictPolicy,
      leaseMs: clampNonNegativeInteger(requestSync.leaseMs, clampNonNegativeInteger(providerSync.leaseMs, 60000, 900000), 900000)
    },
    handoff: {
      schemaVersion: "workflow-package.provider-handoff.v1",
      state: externalState,
      deliveryMode: integration.deliveryMode,
      endpoint: handoffEndpoint,
      subject: handoffSubject,
      ackTopic,
      authMode,
      authRef: authMode === "none"
        ? ""
        : asNonEmptyString(requestHandoff.authRef, asNonEmptyString(providerHandoff.authRef, `${providerId}:credentials`)),
      requiresSignedProof: authMode === "signed-request" || integration.acceptsProof,
      metadata: {
        connectorId: integration.connectorId,
        acknowledgement: integration.acknowledgement,
        timeoutMs: integration.timeoutMs,
        outputContracts: integration.requestedOutputContracts
      }
    }
  };
}

function providerServiceBlockers(providerService) {
  const blockers = providerService.missingCapabilities.map((capability) => `provider-capability-missing:${capability}`);

  if (providerService.serviceStatus === "unavailable") {
    blockers.push(`provider-service-unavailable:${providerService.providerId}`);
  }

  if (!providerService.sync.target) {
    blockers.push("provider-sync-target-required");
  }

  if (providerService.handoff.deliveryMode !== "inline" && !providerService.handoff.endpoint) {
    blockers.push("provider-handoff-endpoint-required");
  }

  if (providerService.handoff.authMode !== "none" && !providerService.handoff.authRef) {
    blockers.push("provider-handoff-auth-ref-required");
  }

  if (providerService.sync.mode !== "push" && !providerService.sync.cursor) {
    blockers.push("provider-sync-cursor-required");
  }

  return blockers;
}

function normalizePersistedState(input, workflowId) {
  const persisted = asObject(input.persistedState);
  const checkpoint = asObject(persisted.checkpoint);
  const retry = asObject(persisted.retry);
  const recovery = asObject(persisted.recovery);
  const requestedStatus = asNonEmptyString(persisted.status, "new");
  const status = VALID_PERSISTED_STATUSES.has(requestedStatus) ? requestedStatus : "recovering";
  const revision = asNonNegativeInteger(persisted.revision);
  const completedActions = uniqueStringList(persisted.completedActions);
  const pendingActions = uniqueStringList(persisted.pendingActions);
  const blockers = uniqueStringList(persisted.blockers);
  const lastCommandId = asNonEmptyString(persisted.lastCommandId, "");

  return {
    status,
    revision,
    lastCommandId,
    completedActions,
    pendingActions,
    blockers,
    checkpoint: {
      key: asNonEmptyString(checkpoint.key, `${workflowId}:checkpoint`),
      savedAt: asNonEmptyString(checkpoint.savedAt, ""),
      route: asNonEmptyString(checkpoint.route, DEFAULT_ROUTE),
      proofId: asNonEmptyString(checkpoint.proofId, "")
    },
    retry: {
      attempts: asNonNegativeInteger(retry.attempts),
      lastFailureAt: asNonEmptyString(retry.lastFailureAt, ""),
      lastErrorCode: asNonEmptyString(retry.lastErrorCode, "")
    },
    recovery: {
      policy: VALID_RECOVERY_POLICIES.has(asNonEmptyString(recovery.policy, "checkpoint-required"))
        ? asNonEmptyString(recovery.policy, "checkpoint-required")
        : "checkpoint-required",
      requestedBy: asNonEmptyString(recovery.requestedBy, ""),
      reason: asNonEmptyString(recovery.reason, status === "recovering" ? "persisted-status-recovering" : ""),
      leaseId: asNonEmptyString(recovery.leaseId, `${workflowId}:recovery`),
      lastRecoveredAt: asNonEmptyString(recovery.lastRecoveredAt, "")
    },
    commandLedger: normalizeCommandLedger(persisted.commandLedger, workflowId, lastCommandId),
    history: normalizeHistorySnapshots(persisted.history, workflowId),
    analytics: normalizePersistedAnalyticsState(persisted.analytics, workflowId)
  };
}

function normalizePersistedAnalyticsState(value, workflowId) {
  const analytics = asObject(value);
  const requestedWindow = asNonEmptyString(analytics.reportingWindow, "run");
  const reportingWindow = VALID_REPORTING_WINDOWS.has(requestedWindow) ? requestedWindow : "run";

  return {
    schemaVersion: "workflow-package.persisted-analytics.v1",
    reportSequence: asNonNegativeInteger(analytics.reportSequence),
    reportingWindow,
    counters: normalizeCounterMap(analytics.counters),
    exportCounters: normalizeCounterMap(analytics.exportCounters),
    lastReportId: asNonEmptyString(analytics.lastReportId, ""),
    lastSnapshotId: asNonEmptyString(analytics.lastSnapshotId, ""),
    historyWatermark: asNonEmptyString(analytics.historyWatermark, ""),
    lastExportedAt: asNonEmptyString(analytics.lastExportedAt, ""),
    exportBatchId: asNonEmptyString(analytics.exportBatchId, `${workflowId}:exports:initial`),
    retainedSnapshotLimit: clampIntegerRange(analytics.retainedSnapshotLimit, 13, 1, 50)
  };
}

function normalizeClientRuntimeContract(input, request, client, runtime, persisted, command, workflowId, handoff) {
  const clientRuntime = asObject(input.clientRuntime);
  const requestClientRuntime = asObject(request.clientRuntime);
  const runtimeClient = asObject(runtime.clientRuntime);
  const view = asObject(clientRuntime.view);
  const requestView = asObject(requestClientRuntime.view);
  const receipt = asObject(clientRuntime.receipt);
  const requestReceipt = asObject(requestClientRuntime.receipt);
  const continuity = asObject(clientRuntime.continuity);
  const requestContinuity = asObject(requestClientRuntime.continuity);
  const actions = asObject(clientRuntime.actions);
  const requestActions = asObject(requestClientRuntime.actions);
  const runtimeActions = asObject(runtimeClient.actions);
  const requestedStateMode = asNonEmptyString(
    requestView.stateMode,
    asNonEmptyString(view.stateMode, asNonEmptyString(runtimeClient.stateMode, "snapshot"))
  );
  const stateMode = VALID_CLIENT_STATE_MODES.has(requestedStateMode) ? requestedStateMode : "snapshot";
  const requestedTarget = asNonEmptyString(
    requestClientRuntime.handoffTarget,
    asNonEmptyString(clientRuntime.handoffTarget, asNonEmptyString(client.handoffTarget, "chat"))
  );
  const handoffTarget = VALID_CLIENT_HANDOFF_TARGETS.has(requestedTarget) ? requestedTarget : "chat";
  const requestedUrgency = asNonEmptyString(
    requestClientRuntime.urgency,
    asNonEmptyString(clientRuntime.urgency, handoff === "blocked" ? "attention" : "normal")
  );
  const urgency = VALID_CLIENT_URGENCIES.has(requestedUrgency) ? requestedUrgency : "normal";
  const expectedRevision = asOptionalNonNegativeInteger(
    requestContinuity.expectedRevision ?? continuity.expectedRevision ?? client.expectedRevision
  );
  const lastSeenRevision = asNonNegativeInteger(
    requestContinuity.lastSeenRevision,
    asNonNegativeInteger(continuity.lastSeenRevision, persisted.revision)
  );
  const receiptRequired = asBoolean(
    requestReceipt.required,
    asBoolean(receipt.required, command.command !== "acknowledge")
  );
  const receiptChannel = asNonEmptyString(
    requestReceipt.channel,
    asNonEmptyString(receipt.channel, handoffTarget === "api" ? "api-response" : "client-session")
  );
  const allowedActions = filterValidClientActions([
    ...asStringList(runtimeActions.allowed),
    ...asStringList(actions.allowed),
    ...asStringList(requestActions.allowed)
  ]);
  const hiddenActions = filterValidClientActions([
    ...asStringList(runtimeActions.hidden),
    ...asStringList(actions.hidden),
    ...asStringList(requestActions.hidden)
  ]);
  const pinnedActions = filterValidClientActions([
    ...asStringList(runtimeActions.pinned),
    ...asStringList(actions.pinned),
    ...asStringList(requestActions.pinned)
  ]).filter((action) => !hiddenActions.includes(action));
  const maxVisibleActions = clampIntegerRange(
    requestActions.maxVisible,
    clampIntegerRange(actions.maxVisible, handoffTarget === "chat" ? 4 : 6, 1, 8),
    1,
    8
  );
  const blockers = [];

  if (expectedRevision !== null && expectedRevision !== persisted.revision) {
    blockers.push(`client-runtime-revision-stale:${expectedRevision}:${persisted.revision}`);
  }

  if (receiptRequired && !receiptChannel) {
    blockers.push("client-runtime-receipt-channel-required");
  }

  return {
    schemaVersion: "workflow-package.client-runtime.v1",
    requestId: asNonEmptyString(client.requestId, `${workflowId}:client-request`),
    correlationId: asNonEmptyString(
      requestClientRuntime.correlationId,
      asNonEmptyString(clientRuntime.correlationId, `${workflowId}:${command.commandId}`)
    ),
    handoffTarget,
    urgency,
    view: {
      stateMode,
      requestedFields: uniqueStringList([
        ...asStringList(view.fields),
        ...asStringList(requestView.fields)
      ]),
      includeAuditLinks: asBoolean(requestView.includeAuditLinks, asBoolean(view.includeAuditLinks, true)),
      includeProviderSync: asBoolean(requestView.includeProviderSync, asBoolean(view.includeProviderSync, true)),
      includeBlockedActions: asBoolean(requestView.includeBlockedActions, asBoolean(view.includeBlockedActions, true))
    },
    continuity: {
      expectedRevision,
      lastSeenRevision,
      resumeToken: asNonEmptyString(
        requestContinuity.resumeToken,
        asNonEmptyString(continuity.resumeToken, `${workflowId}:${lastSeenRevision}:resume`)
      ),
      stale: expectedRevision !== null && expectedRevision !== persisted.revision
    },
    receipt: {
      required: receiptRequired,
      channel: receiptChannel,
      deadlineMs: clampNonNegativeInteger(requestReceipt.deadlineMs, clampNonNegativeInteger(receipt.deadlineMs, 15000, 120000), 120000)
    },
    actionPolicy: {
      schemaVersion: "workflow-package.client-actions.v1",
      allowedActions,
      hiddenActions,
      pinnedActions,
      maxVisibleActions,
      requireProofBeforeDispatch: asBoolean(
        requestActions.requireProofBeforeDispatch,
        asBoolean(actions.requireProofBeforeDispatch, integrationAcceptsProofForClient(handoffTarget))
      ),
      routeNamespace: asNonEmptyString(
        requestActions.routeNamespace,
        asNonEmptyString(actions.routeNamespace, `${workflowId}:client-actions`)
      )
    },
    locale: asNonEmptyString(requestClientRuntime.locale, asNonEmptyString(clientRuntime.locale, asNonEmptyString(client.locale, "en-US"))),
    timezone: asNonEmptyString(
      requestClientRuntime.timezone,
      asNonEmptyString(clientRuntime.timezone, asNonEmptyString(client.timezone, "UTC"))
    ),
    blockers
  };
}

function normalizePreviewAcceptanceControls(input, request, client, workflowId) {
  const preview = asObject(input.preview);
  const requestPreview = asObject(request.preview);
  const acceptance = asObject(input.acceptance);
  const requestAcceptance = asObject(request.acceptance);
  const clientAcceptance = asObject(client.acceptance);
  const requestedDecision = asNonEmptyString(
    requestAcceptance.decision,
    asNonEmptyString(clientAcceptance.decision, asNonEmptyString(acceptance.decision, "pending"))
  );
  const decision = VALID_ACCEPTANCE_DECISIONS.has(requestedDecision) ? requestedDecision : "pending";
  const requestedNextStepTarget = asNonEmptyString(
    requestPreview.nextStepTarget,
    asNonEmptyString(preview.nextStepTarget, "client")
  );
  const nextStepTarget = VALID_NEXT_STEP_TARGETS.has(requestedNextStepTarget)
    ? requestedNextStepTarget
    : "client";
  const requireExplicitAcceptance = asBoolean(
    requestAcceptance.required,
    asBoolean(acceptance.required, false)
  );
  const acceptanceToken = asNonEmptyString(
    requestAcceptance.token,
    asNonEmptyString(clientAcceptance.token, asNonEmptyString(acceptance.token, ""))
  );
  const acceptedBy = asNonEmptyString(
    requestAcceptance.acceptedBy,
    asNonEmptyString(clientAcceptance.acceptedBy, asNonEmptyString(acceptance.acceptedBy, ""))
  );

  return {
    schemaVersion: "workflow-package.preview-controls.v1",
    decision,
    requireExplicitAcceptance,
    acceptedBy,
    acceptanceToken,
    acceptedAt: asNonEmptyString(requestAcceptance.acceptedAt, asNonEmptyString(acceptance.acceptedAt, "")),
    rejectionReason: decision === "rejected"
      ? asNonEmptyString(requestAcceptance.reason, asNonEmptyString(acceptance.reason, "preview rejected by client"))
      : "",
    suppressDispatchUntilAccepted: asBoolean(
      requestAcceptance.suppressDispatchUntilAccepted,
      requireExplicitAcceptance
    ),
    requestedPreviewFields: uniqueStringList([
      ...asStringList(preview.fields),
      ...asStringList(requestPreview.fields)
    ]),
    validationFocus: uniqueStringList([
      ...asStringList(preview.validationFocus),
      ...asStringList(requestPreview.validationFocus)
    ]),
    nextStepTarget,
    routeHint: asNonEmptyString(requestPreview.routeHint, asNonEmptyString(preview.routeHint, DEFAULT_ROUTE)),
    correlationRef: asNonEmptyString(
      requestPreview.correlationRef,
      asNonEmptyString(preview.correlationRef, `${workflowId}:preview`)
    )
  };
}

function normalizeHistorySnapshots(value, workflowId) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(-12).map((item, index) => {
    const snapshot = asObject(item);
    const requestedStatus = asNonEmptyString(snapshot.status, "running");
    const status = VALID_PERSISTED_STATUSES.has(requestedStatus) ? requestedStatus : "recovering";
    const pendingCount = asNonNegativeInteger(snapshot.pendingCount, asStringList(snapshot.pendingActions).length);
    const completedCount = asNonNegativeInteger(snapshot.completedCount, asStringList(snapshot.completedActions).length);
    const blockers = uniqueStringList(snapshot.blockers);
    const totalActions = pendingCount + completedCount;

    return {
      snapshotId: asNonEmptyString(snapshot.snapshotId, `${workflowId}:history:${index + 1}`),
      capturedAt: asNonEmptyString(snapshot.capturedAt, ""),
      revision: asNonNegativeInteger(snapshot.revision, index),
      status,
      pendingCount,
      completedCount,
      blockerCount: blockers.length,
      blockers,
      progress: totalActions === 0 ? 0 : Math.round((completedCount / totalActions) * 100),
      checkpointKey: asNonEmptyString(snapshot.checkpointKey, "")
    };
  });
}

function normalizeCommandLedger(value, workflowId, lastCommandId) {
  const ledger = Array.isArray(value) ? value : [];
  const normalized = ledger.slice(-20).map((item, index) => {
    const entry = asObject(item);
    const requestedStatus = asNonEmptyString(entry.status, "applied");
    const status = requestedStatus === "applied" || requestedStatus === "skipped" || requestedStatus === "failed"
      ? requestedStatus
      : "applied";

    return {
      commandId: asNonEmptyString(entry.commandId, ""),
      idempotencyKey: asNonEmptyString(entry.idempotencyKey, ""),
      command: asNonEmptyString(entry.command, "resume"),
      revision: asNonNegativeInteger(entry.revision, index),
      status,
      appliedAt: asNonEmptyString(entry.appliedAt, ""),
      effect: asNonEmptyString(entry.effect, "historical"),
      proofId: asNonEmptyString(entry.proofId, "")
    };
  }).filter((entry) => entry.commandId || entry.idempotencyKey);

  if (lastCommandId && !normalized.some((entry) => entry.commandId === lastCommandId)) {
    normalized.push({
      commandId: lastCommandId,
      idempotencyKey: lastCommandId,
      command: "resume",
      revision: 0,
      status: "applied",
      appliedAt: "",
      effect: "legacy-last-command",
      proofId: `${workflowId}:${lastCommandId}:legacy`
    });
  }

  return normalized.slice(-20);
}

function classifyPersistedRecovery(persisted, command, workflowId) {
  const ledgerMatch = persisted.commandLedger.find((entry) => (
    (command.commandId && entry.commandId === command.commandId)
    || (command.idempotencyKey && entry.idempotencyKey === command.idempotencyKey)
  ));
  const duplicateCommand = Boolean(ledgerMatch || (command.commandId && command.commandId === persisted.lastCommandId));
  const hasCheckpoint = Boolean(persisted.checkpoint.savedAt || persisted.checkpoint.proofId);
  const terminalPersisted = persisted.status === "complete";
  const terminalMutation = terminalPersisted && command.command !== "acknowledge" && !duplicateCommand;
  const recoveringWithoutCheckpoint = persisted.status === "recovering"
    && persisted.recovery.policy === "checkpoint-required"
    && !hasCheckpoint
    && !duplicateCommand;
  const blockers = [];

  if (terminalMutation) {
    blockers.push("persisted-state-terminal-command-conflict");
  }

  if (recoveringWithoutCheckpoint) {
    blockers.push("persisted-state-recovery-checkpoint-missing");
  }

  return {
    schemaVersion: "workflow-package.persisted-recovery.v1",
    workflowId,
    duplicateCommand,
    ledgerMatched: Boolean(ledgerMatch),
    matchedCommand: ledgerMatch || null,
    hasCheckpoint,
    terminalPersisted,
    terminalMutation,
    recoveringWithoutCheckpoint,
    policy: persisted.recovery.policy,
    leaseId: persisted.recovery.leaseId,
    blockers,
    recoveryMode: duplicateCommand
      ? "command-ledger-replay"
      : terminalPersisted
        ? "terminal-state-review"
        : hasCheckpoint
          ? "checkpoint-resume"
          : recoveringWithoutCheckpoint
            ? "manual-recovery-required"
            : "fresh-start"
  };
}

function appendCommandLedger(persisted, contract, generatedAt, effect, nextRevision, restart) {
  if (restart.duplicateCommand || effect === "read-state") {
    return persisted.commandLedger;
  }

  return [
    ...persisted.commandLedger,
    {
      commandId: contract.command.commandId,
      idempotencyKey: contract.command.idempotencyKey,
      command: contract.command.command,
      revision: nextRevision,
      status: contract.blockers.length ? "skipped" : "applied",
      appliedAt: generatedAt,
      effect,
      proofId: contract.integration.acceptsProof
        ? `${contract.workflowId}:${contract.client.requestId}:command`
        : ""
    }
  ].slice(-20);
}

function mergeActionState(requestedPending, requestedCompleted, persisted) {
  const completedActions = uniqueStringList([
    ...persisted.completedActions,
    ...requestedCompleted
  ]);
  const completed = new Set(completedActions);
  const pendingActions = uniqueStringList([
    ...persisted.pendingActions,
    ...requestedPending
  ]).filter((action) => !completed.has(action));

  return {
    pendingActions,
    completedActions
  };
}

function normalizeLifecycleControls(input, request, runtime, command, workflowId) {
  const lifecycle = asObject(input.lifecycle);
  const requestLifecycle = asObject(request.lifecycle);
  const runtimeLifecycle = asObject(runtime.lifecycle);
  const settings = asObject(input.settings);
  const requestSettings = asObject(request.settings);
  const schedule = asObject(input.schedule);
  const requestSchedule = asObject(request.schedule);
  const controls = asObject(request.controls);
  const requestIntegration = asObject(request.integration);
  const requestedControlAction = asNonEmptyString(
    controls.action,
    asNonEmptyString(requestLifecycle.action, "none")
  );
  const controlAction = VALID_LIFECYCLE_CONTROL_ACTIONS.has(requestedControlAction)
    ? requestedControlAction
    : "none";
  const previousEnabled = asBoolean(lifecycle.enabled, true);
  const previousPaused = asBoolean(lifecycle.paused, false);
  const requestedScheduleMode = asNonEmptyString(
    requestSchedule.mode,
    asNonEmptyString(schedule.mode, asBoolean(controls.enabled, previousEnabled) ? "immediate" : "disabled")
  );
  const requestedModeValid = VALID_SCHEDULE_MODES.has(requestedScheduleMode);
  const scheduleMode = requestedModeValid ? requestedScheduleMode : "manual";
  const controlForcedEnabled = controlAction === "enable"
    ? true
    : controlAction === "disable"
      ? false
      : null;
  const enabled = controlForcedEnabled !== null
    ? controlForcedEnabled
    : scheduleMode === "disabled"
    ? false
    : asBoolean(controls.enabled, asBoolean(requestLifecycle.enabled, asBoolean(lifecycle.enabled, true)));
  const controlForcedPaused = controlAction === "pause"
    ? true
    : controlAction === "unpause"
      ? false
      : null;
  const paused = controlForcedPaused !== null
    ? controlForcedPaused
    : asBoolean(
    controls.paused,
    asBoolean(requestLifecycle.paused, asBoolean(lifecycle.paused, false))
  );
  const maintenanceMode = asBoolean(
    runtimeLifecycle.maintenanceMode,
    asBoolean(lifecycle.maintenanceMode, false)
  );
  const requireApproval = asBoolean(
    requestSettings.requireApproval,
    asBoolean(settings.requireApproval, false)
  );
  const approved = controlAction === "approve" || asBoolean(requestLifecycle.approved, false);
  const allowQueuedWhilePaused = asBoolean(
    requestSettings.allowQueuedWhilePaused,
    asBoolean(settings.allowQueuedWhilePaused, false)
  );
  const concurrencyLimit = clampIntegerRange(
    requestSettings.concurrencyLimit,
    clampIntegerRange(settings.concurrencyLimit, 1, 1, 50),
    1,
    50
  );
  const activeRuns = clampIntegerRange(runtimeLifecycle.activeRuns, 0, 0, 1000);
  const timeoutMs = clampIntegerRange(
    requestSettings.timeoutMs,
    clampIntegerRange(settings.timeoutMs, DEFAULT_LIFECYCLE_TIMEOUT_MS, 1000, MAX_LIFECYCLE_TIMEOUT_MS),
    1000,
    MAX_LIFECYCLE_TIMEOUT_MS
  );
  const requestedDispatchDeadlineMs = asOptionalNonNegativeInteger(
    requestSettings.dispatchDeadlineMs ?? settings.dispatchDeadlineMs
  );
  const dispatchDeadlineMs = requestedDispatchDeadlineMs === null
    ? timeoutMs
    : clampIntegerRange(requestedDispatchDeadlineMs, timeoutMs, timeoutMs, MAX_LIFECYCLE_TIMEOUT_MS);
  const scheduledAt = asNonEmptyString(requestSchedule.runAt, asNonEmptyString(schedule.runAt, ""));
  const requestedEveryMs = requestSchedule.everyMs ?? schedule.everyMs;
  const rawEveryMs = asOptionalNonNegativeInteger(requestedEveryMs);
  const recurrenceEveryMs = scheduleMode === "recurring"
    ? clampIntegerRange(
      requestSchedule.everyMs,
      clampIntegerRange(schedule.everyMs, MIN_SCHEDULE_INTERVAL_MS, MIN_SCHEDULE_INTERVAL_MS, MAX_SCHEDULE_INTERVAL_MS),
      MIN_SCHEDULE_INTERVAL_MS,
      MAX_SCHEDULE_INTERVAL_MS
    )
    : 0;
  const scheduleTimestamp = scheduledAt ? Date.parse(scheduledAt) : NaN;
  const scheduleValid = !scheduledAt || Number.isFinite(scheduleTimestamp);
  const earliestDispatchAt = scheduleValid && scheduledAt ? new Date(scheduleTimestamp).toISOString() : "";
  const nextScheduledAt = scheduleMode === "recurring" && earliestDispatchAt && recurrenceEveryMs
    ? addMillisecondsToIsoString(earliestDispatchAt, recurrenceEveryMs)
    : "";
  const scheduleLeaseMs = clampNonNegativeInteger(
    requestSchedule.leaseMs,
    clampNonNegativeInteger(schedule.leaseMs, Math.min(timeoutMs, 900000), MAX_LIFECYCLE_TIMEOUT_MS),
    MAX_LIFECYCLE_TIMEOUT_MS
  );
  const commandMutates = command.command !== "acknowledge";
  const lifecycleControlMutates = controlAction !== "none";
  const validation = [];
  const blockers = [];

  if (!requestedModeValid) {
    validation.push({
      code: "schedule-mode-invalid",
      severity: "warning",
      detail: `Unsupported schedule mode ${requestedScheduleMode}; using manual dispatch.`
    });
  }

  if (rawEveryMs !== null && (rawEveryMs < MIN_SCHEDULE_INTERVAL_MS || rawEveryMs > MAX_SCHEDULE_INTERVAL_MS)) {
    validation.push({
      code: "schedule-recurring-interval-clamped",
      severity: "warning",
      detail: `Recurring interval was clamped to ${recurrenceEveryMs || 0}ms.`
    });
  }

  if (requestedDispatchDeadlineMs !== null && requestedDispatchDeadlineMs < timeoutMs) {
    validation.push({
      code: "lifecycle-dispatch-deadline-before-timeout",
      severity: "warning",
      detail: "Dispatch deadline was raised to cover the lifecycle timeout."
    });
  }

  if (controlAction === "reschedule" && scheduleMode !== "scheduled" && scheduleMode !== "recurring") {
    blockers.push("lifecycle-reschedule-requires-scheduled-mode");
  }

  if (controlAction === "approve" && !requireApproval) {
    validation.push({
      code: "lifecycle-approval-not-required",
      severity: "info",
      detail: "Approval command was accepted as a no-op because approval is not required."
    });
  }

  if (controlAction === "disable" && command.command === "resume") {
    blockers.push("lifecycle-disable-conflicts-with-resume");
  }

  if (!enabled && commandMutates && controlAction !== "disable") {
    blockers.push("lifecycle-disabled");
  }

  if (paused
    && commandMutates
    && controlAction !== "pause"
    && controlAction !== "unpause"
    && !(allowQueuedWhilePaused && requestIntegration.deliveryMode === "queued")) {
    blockers.push("lifecycle-paused");
  }

  if (maintenanceMode && command.command === "resume") {
    blockers.push("lifecycle-maintenance-mode");
  }

  if (requireApproval && command.command === "resume" && !approved) {
    blockers.push("lifecycle-approval-required");
  }

  if (activeRuns >= concurrencyLimit && command.command === "resume") {
    blockers.push(`lifecycle-concurrency-limit:${concurrencyLimit}`);
  }

  if ((scheduleMode === "scheduled" || scheduleMode === "recurring") && !scheduledAt) {
    blockers.push("schedule-run-at-required");
  }

  if (!scheduleValid) {
    blockers.push("schedule-run-at-invalid");
  }

  const nextAction = blockers.length
    ? "resolve-lifecycle-controls"
    : command.command === "acknowledge"
      ? "observe-state"
    : controlAction === "disable"
      ? "disable-workflow"
    : controlAction === "pause"
      ? "pause-workflow"
    : controlAction === "approve" && requireApproval
      ? "record-approval"
    : scheduleMode === "manual"
      ? "wait-for-manual-dispatch"
    : scheduleMode === "scheduled" || scheduleMode === "recurring"
      ? "wait-for-schedule"
      : "dispatch-now";
  const nextActionReason = blockers.length
    ? `Lifecycle controls blocked dispatch: ${blockers.join(", ")}.`
    : nextAction === "wait-for-schedule"
      ? `Dispatch is scheduled for ${earliestDispatchAt || "the configured runAt"}.`
      : nextAction === "wait-for-manual-dispatch"
        ? "Manual lifecycle dispatch is required before hosted-kernel delivery."
        : nextAction === "record-approval"
          ? "Approval is recorded before hosted-kernel continuation."
          : nextAction === "observe-state"
            ? "Acknowledge is read-only and observes current workflow state."
            : "Lifecycle controls allow immediate hosted-kernel dispatch.";

  return {
    settings: {
      enabled,
      paused,
      maintenanceMode,
      requireApproval,
      approved,
      allowQueuedWhilePaused,
      concurrencyLimit,
      activeRuns,
      timeoutMs,
      dispatchDeadlineMs,
      labels: uniqueStringList([...asStringList(settings.labels), ...asStringList(requestSettings.labels)])
    },
    controlCommand: {
      action: controlAction,
      requestedAction: requestedControlAction,
      mutatesLifecycle: lifecycleControlMutates,
      changedEnabled: previousEnabled !== enabled,
      changedPaused: previousPaused !== paused,
      requestedBy: asNonEmptyString(controls.requestedBy, asNonEmptyString(requestLifecycle.requestedBy, "kernel-client")),
      reason: asNonEmptyString(controls.reason, asNonEmptyString(requestLifecycle.reason, "workflow lifecycle update"))
    },
    schedule: {
      mode: enabled ? scheduleMode : "disabled",
      runAt: scheduleValid ? scheduledAt : "",
      earliestDispatchAt,
      nextScheduledAt,
      recurringEveryMs: recurrenceEveryMs,
      timezone: asNonEmptyString(requestSchedule.timezone, asNonEmptyString(schedule.timezone, "UTC")),
      jitterMs: clampNonNegativeInteger(requestSchedule.jitterMs, clampNonNegativeInteger(schedule.jitterMs, 0, 300000), 300000),
      leaseKey: asNonEmptyString(requestSchedule.leaseKey, asNonEmptyString(schedule.leaseKey, `${workflowId}:lifecycle`)),
      leaseMs: scheduleLeaseMs
    },
    validation,
    blockers,
    nextAction,
    nextActionReason
  };
}

function resolveRestartSemantics(contract) {
  const duplicateCommand = contract.persistedRecovery.duplicateCommand;
  const hasCheckpoint = contract.persistedRecovery.hasCheckpoint;
  const status = contract.blockers.length
    ? "blocked"
    : contract.command.command === "block"
      ? "blocked"
    : contract.command.command === "complete"
      ? "complete"
    : contract.command.command === "acknowledge"
      ? contract.persisted.status
    : duplicateCommand && contract.persisted.status !== "new"
      ? contract.persisted.status
    : hasCheckpoint
      ? "recovering"
      : "running";

  return {
    status,
    duplicateCommand,
    restartSafe: hasCheckpoint || duplicateCommand || contract.persisted.revision === 0,
    recoveryMode: duplicateCommand
      ? "idempotent-replay"
      : hasCheckpoint
        ? "checkpoint-resume"
        : contract.persistedRecovery.recoveringWithoutCheckpoint
          ? "manual-recovery-required"
          : "fresh-start",
    nextRevision: duplicateCommand ? contract.persisted.revision : contract.persisted.revision + 1
  };
}

function resolveCommandPersistenceEffect(contract, restart) {
  if (restart.duplicateCommand) {
    return "replay-existing-state";
  }

  if (contract.command.command === "acknowledge") {
    return "read-state";
  }

  if (contract.command.command === "checkpoint") {
    return "write-checkpoint";
  }

  if (contract.command.command === "complete") {
    return "write-terminal-state";
  }

  if (contract.command.command === "block" || contract.blockers.length) {
    return "write-blocked-state";
  }

  return restart.recoveryMode === "checkpoint-resume" ? "write-recovered-state" : "write-running-state";
}

function buildPersistedStateWritePlan(contract, generatedAt) {
  const restart = resolveRestartSemantics(contract);
  const effect = resolveCommandPersistenceEffect(contract, restart);
  const mutatesState = !restart.duplicateCommand && effect !== "read-state";
  const durableStatus = mutatesState ? restart.status : contract.persisted.status;
  const durablePendingActions = mutatesState ? contract.pendingActions : contract.persisted.pendingActions;
  const durableCompletedActions = mutatesState ? contract.completedActions : contract.persisted.completedActions;
  const durableBlockers = mutatesState ? contract.blockers : contract.persisted.blockers;
  const nextRevision = mutatesState ? restart.nextRevision : contract.persisted.revision;
  const checkpointProofId = contract.integration.acceptsProof
    ? `${contract.workflowId}:${contract.client.requestId}:checkpoint`
    : contract.persisted.checkpoint.proofId;
  const checkpointSavedAt = mutatesState && effect !== "read-state"
    ? generatedAt
    : contract.persisted.checkpoint.savedAt;
  const retrySnapshot = {
    attempts: contract.operationalHealth.retry.attempts,
    lastFailureAt: contract.operationalHealth.actionableErrors.length ? generatedAt : contract.persisted.retry.lastFailureAt,
    lastErrorCode: contract.operationalHealth.actionableErrors[0]?.code || contract.persisted.retry.lastErrorCode
  };
  const commandLedger = appendCommandLedger(contract.persisted, contract, generatedAt, effect, nextRevision, restart);

  return {
    schemaVersion: "workflow-package.persisted-state.v1",
    storageKey: `${contract.boundary.storagePartitionKey}:${contract.workflowId}`,
    effect,
    writePolicy: {
      operation: restart.duplicateCommand
        ? "skip-duplicate"
        : effect === "read-state"
          ? "read-only"
          : "compare-and-swap",
      expectedRevision: contract.persisted.revision,
      nextRevision,
      idempotencyKey: contract.command.idempotencyKey,
      commandId: contract.command.commandId,
      replaySafe: restart.duplicateCommand || restart.restartSafe,
      requiresBoundaryMatch: true
    },
    boundaryWriteGuard: {
      schemaVersion: contract.boundary.schemaVersion,
      boundaryKey: contract.boundary.boundaryKey,
      persistedBoundaryKey: contract.boundary.persistedBoundaryKey,
      decision: contract.boundary.boundaryDecision,
      tenantAuthorized: contract.boundary.hasTenantAccess,
      workspaceAuthorized: contract.boundary.hasWorkspaceAccess,
      persistedBoundaryMatches: contract.boundary.samePersistedBoundary,
      explicitTenantScope: contract.boundary.explicitTenantScope,
      explicitWorkspaceScope: contract.boundary.explicitWorkspaceScope,
      auditPartitionKey: contract.boundary.auditPartitionKey,
      storagePartitionKey: contract.boundary.storagePartitionKey
    },
    restart: {
      status: restart.status,
      recoveryMode: restart.recoveryMode,
      restartSafe: restart.restartSafe,
      duplicateCommand: restart.duplicateCommand,
      restoredFromCheckpoint: restart.recoveryMode === "checkpoint-resume",
      terminal: restart.status === "complete",
      policy: contract.persistedRecovery.policy,
      ledgerMatched: contract.persistedRecovery.ledgerMatched,
      recoveryBlockers: contract.persistedRecovery.blockers
    },
    durableState: {
      tenantId: contract.boundary.tenantId,
      workspaceId: contract.boundary.workspaceId,
      workflowId: contract.workflowId,
      packageName: contract.packageName,
      route: contract.route,
      status: durableStatus,
      revision: nextRevision,
      lastCommandId: mutatesState ? contract.command.commandId : contract.persisted.lastCommandId,
      idempotencyKey: contract.command.idempotencyKey,
      pendingActions: durablePendingActions,
      completedActions: durableCompletedActions,
      blockers: durableBlockers,
      checkpoint: {
        key: contract.persisted.checkpoint.key,
        savedAt: checkpointSavedAt,
        route: contract.route,
        proofId: checkpointProofId
      },
      retry: retrySnapshot,
      recovery: {
        policy: contract.persistedRecovery.policy,
        mode: restart.recoveryMode,
        leaseId: contract.persistedRecovery.leaseId,
        lastRecoveredAt: restart.recoveryMode === "checkpoint-resume" && mutatesState
          ? generatedAt
          : contract.persisted.recovery.lastRecoveredAt,
        blockers: contract.persistedRecovery.blockers
      },
      commandLedger,
      providerSync: {
        providerId: contract.providerService.providerId,
        mode: contract.providerService.sync.mode,
        target: contract.providerService.sync.target,
        cursor: contract.providerService.sync.cursor,
        nextCursor: contract.providerService.sync.nextCursor,
        watermark: contract.providerService.sync.watermark,
        lastSyncedAt: contract.providerService.sync.lastSyncedAt,
        sequence: contract.providerService.sync.sequence,
        conflictPolicy: contract.providerService.sync.conflictPolicy,
        handoffSubject: contract.providerService.handoff.subject,
        handoffState: contract.providerService.handoff.state,
        leaseMs: contract.providerService.sync.leaseMs
      }
    }
  };
}

function buildPreviewAcceptanceContract(contract, generatedAt, persistedWritePlan) {
  const restart = resolveRestartSemantics(contract);
  const previewControls = contract.previewControls;
  const validationItems = [
    {
      key: "tenant-workspace-boundary",
      label: "Tenant and workspace boundary",
      status: contract.boundary.isolationMode === "boundary-review" ? "fail" : "pass",
      detail: contract.boundary.samePersistedBoundary
        ? "Persisted state matches the requested tenant and workspace."
        : "Persisted state belongs to a different tenant or workspace."
    },
    {
      key: "command-permission",
      label: "Command permission",
      status: contract.boundary.missingPermissions.length ? "fail" : "pass",
      detail: contract.boundary.missingPermissions.length
        ? `Missing permissions: ${contract.boundary.missingPermissions.join(", ")}`
        : `Role ${contract.boundary.role} can run ${contract.command.command}.`
    },
    {
      key: "provider-capabilities",
      label: "Provider capabilities",
      status: contract.providerService.missingCapabilities.length
        ? "fail"
        : contract.providerService.serviceStatus === "degraded"
          ? "warn"
          : "pass",
      detail: contract.providerService.missingCapabilities.length
        ? `Missing capabilities: ${contract.providerService.missingCapabilities.join(", ")}`
        : `Provider ${contract.providerService.providerId} negotiated ${contract.providerService.negotiatedCapabilities.length} capabilities.`
    },
    {
      key: "provider-handoff",
      label: "Provider handoff contract",
      status: providerServiceBlockers(contract.providerService).length
        ? "fail"
        : contract.providerService.handoff.state === "handoff-pending"
          ? "warn"
          : "pass",
      detail: providerServiceBlockers(contract.providerService).length
        ? `Provider handoff blockers: ${providerServiceBlockers(contract.providerService).join(", ")}`
        : `Provider handoff ${contract.providerService.handoff.subject} uses ${contract.providerService.handoff.deliveryMode}.`
    },
    {
      key: "lifecycle-controls",
      label: "Lifecycle controls",
      status: contract.lifecycle.blockers.length
        ? "fail"
        : contract.lifecycle.validation.some((item) => item.severity === "warning")
          ? "warn"
          : "pass",
      detail: contract.lifecycle.blockers.length
        ? `Lifecycle blockers: ${contract.lifecycle.blockers.join(", ")}`
        : contract.lifecycle.validation.length
          ? `Lifecycle next action is ${contract.lifecycle.nextAction} with ${contract.lifecycle.validation.length} validation notes.`
          : contract.lifecycle.nextActionReason
    },
    {
      key: "operational-health",
      label: "Hosted kernel health",
      status: contract.operationalHealth.status === "healthy"
        ? "pass"
        : contract.operationalHealth.degradedMode
          ? "warn"
          : "fail",
      detail: contract.operationalHealth.actionableErrors.length
        ? contract.operationalHealth.actionableErrors.map((error) => error.code).join(", ")
        : "Hosted kernel health is acceptable for continuation."
    },
    {
      key: "persistence-write",
      label: "Persistence write plan",
      status: persistedWritePlan.writePolicy.operation === "compare-and-swap" || persistedWritePlan.writePolicy.operation === "read-only"
        ? "pass"
        : "warn",
      detail: `${persistedWritePlan.effect} via ${persistedWritePlan.writePolicy.operation}.`
    },
    {
      key: "client-acceptance",
      label: "Client acceptance",
      status: previewControls.decision === "rejected"
        ? "fail"
        : previewControls.requireExplicitAcceptance && previewControls.decision !== "accepted"
          ? "warn"
          : "pass",
      detail: previewControls.decision === "rejected"
        ? previewControls.rejectionReason
        : previewControls.requireExplicitAcceptance && previewControls.decision !== "accepted"
          ? "Explicit client acceptance is required before dispatch."
          : `Preview acceptance decision is ${previewControls.decision}.`
    }
  ];
  const failed = validationItems.filter((item) => item.status === "fail");
  const warnings = validationItems.filter((item) => item.status === "warn");
  const visibleValidationItems = previewControls.validationFocus.length
    ? validationItems.filter((item) => previewControls.validationFocus.includes(item.key))
    : validationItems;
  const previewSteps = [
    {
      step: "validate-request",
      state: failed.length ? "blocked" : warnings.length ? "attention" : "ready",
      summary: failed.length
        ? "Resolve validation failures before hosted-kernel dispatch."
        : warnings.length
          ? "Warnings are present, but the workflow can remain explainable."
          : "Request is ready for hosted-kernel dispatch evaluation."
    },
    {
      step: "persist-state",
      state: persistedWritePlan.writePolicy.operation === "skip-duplicate" ? "replay" : "planned",
      summary: `Revision ${persistedWritePlan.writePolicy.expectedRevision} to ${persistedWritePlan.writePolicy.nextRevision}; ${persistedWritePlan.effect}.`
    },
    {
      step: "deliver-command",
      state: contract.blockers.length ? "held" : contract.integration.deliveryMode,
      summary: contract.blockers.length
        ? "Command delivery is held until blockers clear."
        : `Delivery mode ${contract.integration.deliveryMode} with ${contract.integration.acknowledgement} acknowledgement.`
    },
    {
      step: "sync-provider",
      state: contract.providerService.sync.mode,
      summary: `Sync target ${contract.providerService.sync.target || "unassigned"} using ${contract.providerService.sync.mode}.`
    }
  ];
  const readiness = failed.length
    ? "blocked"
    : restart.duplicateCommand
      ? "replay-ready"
      : warnings.length
        ? "ready-with-warnings"
        : "ready";
  const explicitAcceptanceHeld = previewControls.suppressDispatchUntilAccepted
    && previewControls.decision !== "accepted"
    && !failed.length;
  const acceptanceState = failed.length
    ? "blocked"
    : previewControls.decision === "accepted"
      ? "accepted"
      : previewControls.decision === "needs-review"
        ? "review"
        : explicitAcceptanceHeld
          ? "waiting-for-acceptance"
          : "implicit";
  const routeTargets = {
    preview: {
      route: previewControls.routeHint,
      method: "GET",
      contract: "workflow-package.preview-acceptance.v1",
      query: {
        workflowId: contract.workflowId,
        requestId: contract.client.requestId,
        correlationRef: previewControls.correlationRef
      }
    },
    accept: {
      route: `${previewControls.routeHint}.accept`,
      method: "POST",
      contract: "workflow-package.acceptance-command.v1",
      body: {
        workflowId: contract.workflowId,
        commandId: contract.command.commandId,
        decision: "accepted",
        tokenRequired: previewControls.requireExplicitAcceptance
      }
    },
    nextStep: {
      route: `${previewControls.routeHint}.next-step`,
      method: "POST",
      target: previewControls.nextStepTarget
    }
  };
  const nextStepPayloads = failed.length
    ? failed.map((item) => ({
      target: "operator",
      route: `${previewControls.routeHint}.resolve`,
      action: `resolve-${item.key}`,
      reason: item.detail,
      blocking: true,
      payload: {
        workflowId: contract.workflowId,
        validationKey: item.key,
        commandId: contract.command.commandId
      }
    }))
    : [
      {
        target: explicitAcceptanceHeld ? "client" : previewControls.nextStepTarget,
        route: explicitAcceptanceHeld ? routeTargets.accept.route : routeTargets.nextStep.route,
        action: explicitAcceptanceHeld ? "accept-preview" : contract.lifecycle.nextAction,
        reason: explicitAcceptanceHeld
          ? "Client acceptance is required before hosted-kernel dispatch."
          : restart.duplicateCommand
            ? "Replay the existing persisted state for the duplicate command."
            : `Proceed using ${contract.integration.deliveryMode} delivery.`,
        blocking: explicitAcceptanceHeld,
        payload: {
          workflowId: contract.workflowId,
          commandId: contract.command.commandId,
          requestId: contract.client.requestId,
          dispatchEligible: contract.lifecycle.nextAction === "dispatch-now"
        }
      }
    ];

  return {
    schemaVersion: "workflow-package.preview-acceptance.v1",
    generatedAt,
    readiness,
    accepted: failed.length === 0
      && contract.blockers.length === 0
      && (!previewControls.suppressDispatchUntilAccepted || previewControls.decision === "accepted"),
    acceptanceState,
    acceptanceMode: restart.duplicateCommand
      ? "idempotent-replay"
      : contract.lifecycle.nextAction === "wait-for-schedule"
        ? "scheduled-acceptance"
        : contract.lifecycle.nextAction === "wait-for-manual-dispatch"
          ? "manual-acceptance"
          : contract.integration.deliveryMode === "inline"
            ? "inline-acceptance"
            : "deferred-acceptance",
    preview: {
      command: contract.command.command,
      handoff: contract.handoff,
      statusAfterAcceptance: persistedWritePlan.durableState.status,
      deliveryMode: contract.integration.deliveryMode,
      persistenceEffect: persistedWritePlan.effect,
      visibleSteps: previewSteps,
      visibleFields: previewControls.requestedPreviewFields.length
        ? previewControls.requestedPreviewFields
        : ["command", "readiness", "validationSummary", "nextSteps", "proofSubjects"],
      clientSummary: {
        title: `${contract.packageName} ${contract.command.command}`,
        status: failed.length ? "blocked" : explicitAcceptanceHeld ? "needs-acceptance" : readiness,
        primaryAction: nextStepPayloads[0]?.action || "review-preview",
        primaryTarget: nextStepPayloads[0]?.target || previewControls.nextStepTarget,
        message: failed.length
          ? "Validation failures are blocking hosted-kernel continuation."
          : explicitAcceptanceHeld
            ? "Review and accept the preview before dispatch."
            : `Hosted-kernel continuation is ${readiness}.`
      }
    },
    validationSummary: {
      status: failed.length ? "fail" : warnings.length ? "warn" : "pass",
      passCount: validationItems.filter((item) => item.status === "pass").length,
      warningCount: warnings.length,
      failureCount: failed.length,
      items: validationItems,
      visibleItems: visibleValidationItems
    },
    acceptanceControl: {
      schemaVersion: previewControls.schemaVersion,
      decision: previewControls.decision,
      required: previewControls.requireExplicitAcceptance,
      suppressDispatchUntilAccepted: previewControls.suppressDispatchUntilAccepted,
      acceptedBy: previewControls.acceptedBy,
      acceptedAt: previewControls.acceptedAt,
      tokenRequired: previewControls.requireExplicitAcceptance && !previewControls.acceptanceToken,
      rejectionReason: previewControls.rejectionReason
    },
    routeTargets,
    readinessGates: {
      boundaryAccepted: contract.boundary.isolationMode !== "boundary-review",
      providerAccepted: contract.providerService.missingCapabilities.length === 0
        && contract.providerService.serviceStatus !== "unavailable",
      lifecycleAccepted: contract.lifecycle.blockers.length === 0,
      healthAccepted: contract.operationalHealth.status === "healthy" || contract.operationalHealth.degradedMode,
      persistenceAccepted: persistedWritePlan.writePolicy.replaySafe || persistedWritePlan.writePolicy.operation === "compare-and-swap",
      clientAccepted: !previewControls.suppressDispatchUntilAccepted || previewControls.decision === "accepted",
      dispatchEligible: failed.length === 0
        && contract.blockers.length === 0
        && (!previewControls.suppressDispatchUntilAccepted || previewControls.decision === "accepted")
        && contract.lifecycle.nextAction === "dispatch-now"
    },
    nextSteps: nextStepPayloads,
    proofSubjects: uniqueStringList([
      contract.workflowId,
      contract.command.commandId,
      persistedWritePlan.storageKey,
      contract.providerService.providerId,
      contract.providerService.handoff.subject,
      contract.boundary.workspaceId,
      contract.boundary.proofSubject,
      contract.lifecycle.schedule.leaseKey
    ])
  };
}

function buildReportingState(contract, generatedAt, persistedWritePlan, previewAcceptance, dispatchGate) {
  const previousAnalytics = contract.persisted.analytics;
  const currentCounters = {
    continuations: 1,
    pendingActions: contract.pendingActions.length,
    completedActions: contract.completedActions.length,
    blockers: contract.blockers.length,
    actionableErrors: contract.operationalHealth.actionableErrors.length,
    activeIncidents: contract.operationalHealth.activeIncidents.length,
    stateWrites: persistedWritePlan.writePolicy.operation === "compare-and-swap" ? 1 : 0,
    idempotentReplays: persistedWritePlan.restart.duplicateCommand ? 1 : 0,
    dispatchEligible: dispatchGate.shouldDispatch ? 1 : 0,
    dispatchHeld: dispatchGate.shouldDispatch ? 0 : 1,
    previewValidationFailures: previewAcceptance.validationSummary.failureCount,
    previewValidationWarnings: previewAcceptance.validationSummary.warningCount,
    lifecycleBlockers: contract.lifecycle.blockers.length,
    clientRuntimeBlockers: contract.clientRuntime.blockers.length,
    recoveryBlockers: persistedWritePlan.restart.recoveryBlockers.length,
    commandLedgerEntries: persistedWritePlan.durableState.commandLedger.length,
    lifecycleValidationWarnings: contract.lifecycle.validation.filter((item) => item.severity === "warning").length,
    lifecycleControlMutations: contract.lifecycle.controlCommand.mutatesLifecycle ? 1 : 0,
    providerHandoffPending: contract.providerService.handoff.state === "handoff-pending" ? 1 : 0,
    providerSyncSequence: contract.providerService.sync.sequence,
    clientVisibleActions: contract.clientRuntime.actionPolicy.maxVisibleActions,
    clientDisabledActions: dispatchGate.blockingCodes.length,
    clientActionPolicyConstrained: contract.clientRuntime.actionPolicy.allowedActions.length ? 1 : 0
  };
  const requestedExportCounters = contract.exports.reduce((counters, exportName) => {
    counters[exportName] = 1;
    return counters;
  }, {});
  const exportBlockers = uniqueStringList([
    ...contract.blockers,
    ...dispatchGate.blockingCodes,
    ...contract.boundary.missingPermissions.map((permission) => `permission-missing:${permission}`)
  ]);
  const exportReadiness = contract.exports.map((exportName) => {
    const auditRequired = exportName === "auditTrail"
      || exportName === "analyticsReport"
      || exportName === "historySnapshots"
      || exportName === "timeline";
    const permissionBlocked = auditRequired && !contract.boundary.grantedPermissions.includes("audit:read");
    const proofBlocked = exportName === "handoffProof" && !contract.integration.acceptsProof;
    const boundaryBlocked = contract.boundary.isolationMode !== "tenant-workspace-bound"
      && !["clientState", "handoffProof", "exportSummary"].includes(exportName);
    const blockedBy = uniqueStringList([
      permissionBlocked ? "audit-read-permission-required" : "",
      proofBlocked ? "integration-proof-not-accepted" : "",
      boundaryBlocked ? "tenant-workspace-boundary-review" : "",
      ...exportBlockers
    ]);

    return {
      exportName,
      tenantScoped: TENANT_BOUND_EXPORTS.has(exportName),
      auditReadable: !auditRequired || contract.boundary.grantedPermissions.includes("audit:read"),
      status: blockedBy.length ? "blocked" : "ready",
      blockedBy,
      proofSubject: `${contract.boundary.proofSubject}:${exportName}`
    };
  });

  return {
    schemaVersion: "workflow-package.reporting-state.v1",
    reportId: `${contract.workflowId}:report:${previousAnalytics.reportSequence + 1}`,
    reportSequence: previousAnalytics.reportSequence + 1,
    reportingWindow: previousAnalytics.reportingWindow,
    generatedAt,
    previousReportId: previousAnalytics.lastReportId,
    previousSnapshotId: previousAnalytics.lastSnapshotId,
    historyWatermark: previousAnalytics.historyWatermark,
    exportBatchId: previousAnalytics.exportBatchId,
    currentCounters,
    cumulativeCounters: addCounterMaps(previousAnalytics.counters, currentCounters),
    exportCounters: addCounterMaps(previousAnalytics.exportCounters, requestedExportCounters),
    exportReadiness,
    readyExportCount: exportReadiness.filter((item) => item.status === "ready").length,
    blockedExportCount: exportReadiness.filter((item) => item.status === "blocked").length,
    nextWatermark: `${contract.workflowId}:${persistedWritePlan.writePolicy.nextRevision}:${previousAnalytics.reportSequence + 1}`,
    timelineState: {
      currentRevision: persistedWritePlan.writePolicy.nextRevision,
      previousRevision: persistedWritePlan.writePolicy.expectedRevision,
      dispatchGateStatus: dispatchGate.status,
      dispatchGateMode: dispatchGate.dispatchMode,
      nextAction: contract.lifecycle.nextAction,
      nextActionReason: contract.lifecycle.nextActionReason,
      lifecycleControlAction: contract.lifecycle.controlCommand.action,
      remediationMode: contract.operationalHealth.remediation.mode
    }
  };
}

function clientStateStatusForHandoff(restartStatus, requestedHandoff) {
  if (restartStatus === "complete") {
    return "complete";
  }

  if (restartStatus === "blocked") {
    return "blocked";
  }

  return VALID_HANDOFFS.has(requestedHandoff) ? requestedHandoff : "review";
}

function buildClientActionPanel(contract, previewAcceptance, dispatchGate, restart) {
  const policy = contract.clientRuntime.actionPolicy;
  const allowed = policy.allowedActions.length ? new Set(policy.allowedActions) : VALID_CLIENT_ACTIONS;
  const hidden = new Set(policy.hiddenActions);
  const disabledReasons = {};
  const routeNamespace = policy.routeNamespace;
  const routeBindings = {
    "refresh-client-state": `${routeNamespace}.refresh`,
    "accept-preview": previewAcceptance.routeTargets.accept.route,
    "review-blockers": `${routeNamespace}.blockers`,
    "dispatch-now": previewAcceptance.routeTargets.nextStep.route,
    "wait-for-schedule": `${routeNamespace}.schedule`,
    "manual-dispatch": `${routeNamespace}.manual-dispatch`,
    "continue-degraded": `${routeNamespace}.degraded-dispatch`,
    "acknowledge-state": `${routeNamespace}.acknowledge`,
    "view-preview": previewAcceptance.routeTargets.preview.route,
    "view-handoff-proof": `${routeNamespace}.proof`,
    "view-audit-trail": `${routeNamespace}.audit`,
    "view-provider-sync": `${routeNamespace}.provider-sync`,
    "resolve-lifecycle-controls": `${routeNamespace}.lifecycle`,
    "review-boundary": `${routeNamespace}.boundary`
  };
  const candidates = [
    contract.clientRuntime.continuity.stale ? "refresh-client-state" : "",
    previewAcceptance.acceptanceState === "waiting-for-acceptance" ? "accept-preview" : "",
    contract.boundary.isolationMode === "boundary-review" ? "review-boundary" : "",
    contract.lifecycle.blockers.length ? "resolve-lifecycle-controls" : "",
    contract.blockers.length ? "review-blockers" : "",
    dispatchGate.shouldDispatch && contract.operationalHealth.degradedMode ? "continue-degraded" : "",
    dispatchGate.shouldDispatch && !contract.operationalHealth.degradedMode ? "dispatch-now" : "",
    contract.lifecycle.nextAction === "wait-for-schedule" ? "wait-for-schedule" : "",
    contract.lifecycle.nextAction === "wait-for-manual-dispatch" ? "manual-dispatch" : "",
    contract.command.command === "acknowledge" || dispatchGate.status === "acknowledged" ? "acknowledge-state" : "",
    "view-preview",
    contract.integration.acceptsProof ? "view-handoff-proof" : "",
    contract.clientRuntime.view.includeAuditLinks ? "view-audit-trail" : "",
    contract.clientRuntime.view.includeProviderSync ? "view-provider-sync" : ""
  ];

  if (!dispatchGate.shouldDispatch) {
    disabledReasons["dispatch-now"] = dispatchGate.blockingCodes.length
      ? `Dispatch held by ${dispatchGate.blockingCodes.join(", ")}.`
      : `Dispatch gate is ${dispatchGate.status}.`;
  }

  if (policy.requireProofBeforeDispatch && !contract.integration.acceptsProof) {
    disabledReasons["dispatch-now"] = "Client action policy requires proof before dispatch, but the integration does not accept proof.";
    disabledReasons["continue-degraded"] = disabledReasons["dispatch-now"];
  }

  if (previewAcceptance.acceptanceState !== "waiting-for-acceptance") {
    disabledReasons["accept-preview"] = `Preview acceptance state is ${previewAcceptance.acceptanceState}.`;
  }

  if (!contract.clientRuntime.continuity.stale) {
    disabledReasons["refresh-client-state"] = "Client state is already current for the persisted revision.";
  }

  const actionEntries = uniqueStringList([
    ...policy.pinnedActions,
    ...candidates
  ])
    .filter((action) => VALID_CLIENT_ACTIONS.has(action) && allowed.has(action) && !hidden.has(action))
    .map((action) => ({
      action,
      route: routeBindings[action],
      target: action.startsWith("view-") || action === "accept-preview" || action === "refresh-client-state"
        ? contract.clientRuntime.handoffTarget
        : previewAcceptance.nextSteps[0]?.target || contract.previewControls.nextStepTarget,
      enabled: !disabledReasons[action],
      reason: disabledReasons[action] || (
        action === "dispatch-now" || action === "continue-degraded"
          ? contract.lifecycle.nextActionReason
          : action === "review-blockers"
            ? "Review blockers before hosted-kernel continuation."
            : action === "accept-preview"
              ? "Client acceptance is required before hosted-kernel dispatch."
              : action === "refresh-client-state"
                ? "Refresh stale client state before applying the command."
                : "Action is available for this workflow handoff."
      ),
      payload: {
        workflowId: contract.workflowId,
        commandId: contract.command.commandId,
        requestId: contract.client.requestId,
        revision: contract.persisted.revision,
        dispatchGateStatus: dispatchGate.status
      }
    }));
  const visibleActions = actionEntries.slice(0, policy.maxVisibleActions);
  const primaryAction = visibleActions.find((entry) => entry.enabled) || visibleActions[0] || {
    action: restart.status === "complete" ? "acknowledge-state" : "view-preview",
    route: restart.status === "complete" ? routeBindings["acknowledge-state"] : routeBindings["view-preview"],
    target: contract.clientRuntime.handoffTarget,
    enabled: true,
    reason: restart.status === "complete"
      ? "Workflow is complete; acknowledge the final state."
      : "Open the workflow preview.",
    payload: {
      workflowId: contract.workflowId,
      commandId: contract.command.commandId,
      requestId: contract.client.requestId,
      revision: contract.persisted.revision,
      dispatchGateStatus: dispatchGate.status
    }
  };

  return {
    schemaVersion: "workflow-package.client-action-panel.v1",
    target: contract.clientRuntime.handoffTarget,
    urgency: contract.clientRuntime.urgency,
    policy,
    primaryAction,
    secondaryActions: visibleActions.filter((entry) => entry.action !== primaryAction.action),
    disabledActions: Object.entries(disabledReasons).map(([action, reason]) => ({
      action,
      reason,
      route: routeBindings[action] || ""
    })),
    routeBindings,
    state: contract.clientRuntime.continuity.stale
      ? "refresh-required"
      : contract.blockers.length
        ? "blocked"
        : dispatchGate.shouldDispatch
          ? "dispatch-ready"
          : dispatchGate.status
  };
}

function normalizeHealthChecks(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item, index) => {
      const check = asObject(item);
      const requestedStatus = asNonEmptyString(check.status, "pass");
      const status = VALID_CHECK_STATUSES.has(requestedStatus) ? requestedStatus : "fail";

      return {
        name: asNonEmptyString(check.name, `runtime-check-${index + 1}`),
        status,
        required: asBoolean(check.required, true),
        message: asNonEmptyString(check.message, status === "pass" ? "ok" : "health check failed")
      };
    })
    .filter((item) => item.name);
}

function normalizeOperationalIncidents(value, workflowId) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(-10).map((item, index) => {
    const incident = asObject(item);
    const requestedSeverity = asNonEmptyString(incident.severity, "warning");
    const severity = VALID_INCIDENT_SEVERITIES.has(requestedSeverity) ? requestedSeverity : "warning";
    const requestedStatus = asNonEmptyString(incident.status, "open");
    const status = VALID_INCIDENT_STATUSES.has(requestedStatus) ? requestedStatus : "open";
    const retryAfterMs = clampNonNegativeInteger(incident.retryAfterMs, 0, MAX_BACKOFF_MS);

    return {
      incidentId: asNonEmptyString(incident.incidentId, `${workflowId}:health-incident:${index + 1}`),
      code: asNonEmptyString(incident.code, severity === "critical" ? "HOSTED_KERNEL_CRITICAL" : "HOSTED_KERNEL_DEGRADED"),
      severity,
      status,
      observedAt: asNonEmptyString(incident.observedAt, ""),
      checkName: asNonEmptyString(incident.checkName, ""),
      message: asNonEmptyString(incident.message, "Hosted kernel incident requires operator review."),
      retryAfterMs,
      runbook: asNonEmptyString(incident.runbook, "")
    };
  }).filter((incident) => incident.incidentId);
}

function resolveOperationalRemediation(healthStatus, degradedMode, retryable, retryExhausted, activeIncidents, circuitOpen, retryAfterMs) {
  const criticalIncident = activeIncidents.find((incident) => incident.severity === "critical");
  const openIncident = activeIncidents.find((incident) => incident.status === "open");

  if (circuitOpen) {
    return {
      mode: "circuit-breaker-open",
      action: "pause-hosted-kernel-dispatch",
      operatorAction: "acknowledge-or-resolve-open-incidents",
      retryAfterMs,
      incidentId: criticalIncident?.incidentId || openIncident?.incidentId || ""
    };
  }

  if (retryExhausted) {
    return {
      mode: "retry-budget-exhausted",
      action: "escalate-hosted-kernel",
      operatorAction: "increase-retry-budget-after-review",
      retryAfterMs: 0,
      incidentId: openIncident?.incidentId || ""
    };
  }

  if (retryable && healthStatus !== "healthy") {
    return {
      mode: "backoff-scheduled",
      action: "retry-after-backoff",
      operatorAction: "monitor-hosted-kernel-health",
      retryAfterMs,
      incidentId: openIncident?.incidentId || ""
    };
  }

  if (degradedMode) {
    return {
      mode: "degraded-continuation",
      action: "continue-with-proof",
      operatorAction: "watch-warning-checks",
      retryAfterMs: 0,
      incidentId: openIncident?.incidentId || ""
    };
  }

  return {
    mode: "none",
    action: "none",
    operatorAction: "none",
    retryAfterMs: 0,
    incidentId: ""
  };
}

function classifyOperationalHealth(runtime, persisted, command, boundary, blockers, workflowId) {
  const health = asObject(runtime.health);
  const retryPolicy = asObject(health.retryPolicy);
  const checks = normalizeHealthChecks(health.checks);
  const incidents = normalizeOperationalIncidents(health.incidents, workflowId);
  const activeIncidents = incidents.filter((incident) => incident.status !== "resolved");
  const criticalIncidents = activeIncidents.filter((incident) => incident.severity === "critical");
  const failedRequiredChecks = checks.filter((check) => check.required && check.status === "fail");
  const warningChecks = checks.filter((check) => check.status === "warn");
  const incidentRetryAfterMs = activeIncidents.reduce(
    (highest, incident) => Math.max(highest, incident.retryAfterMs),
    0
  );
  const requestedStatus = asNonEmptyString(
    health.status,
    criticalIncidents.length || failedRequiredChecks.length
      ? "unavailable"
      : activeIncidents.length || warningChecks.length
        ? "degraded"
        : "healthy"
  );
  const healthStatus = VALID_HEALTH_STATUSES.has(requestedStatus) ? requestedStatus : "degraded";
  const retryable = asBoolean(health.retryable, healthStatus !== "healthy" && RETRYABLE_COMMANDS.has(command.command));
  const maxAttempts = clampNonNegativeInteger(retryPolicy.maxAttempts, 3, 10);
  const attempts = clampNonNegativeInteger(
    health.attempts,
    persisted.retry.attempts,
    maxAttempts + 1
  );
  const baseBackoffMs = clampNonNegativeInteger(retryPolicy.baseBackoffMs, DEFAULT_BACKOFF_MS, MAX_BACKOFF_MS);
  const retryAfterMs = clampNonNegativeInteger(
    health.retryAfterMs,
    Math.max(
      incidentRetryAfterMs,
      Math.min(baseBackoffMs * (2 ** Math.max(attempts - 1, 0)), MAX_BACKOFF_MS)
    ),
    MAX_BACKOFF_MS
  );
  const retryExhausted = retryable && attempts >= maxAttempts;
  const degradedModeAllowed = asBoolean(health.allowDegradedMode, true);
  const circuitBreakerThreshold = clampIntegerRange(
    retryPolicy.circuitBreakerThreshold,
    DEFAULT_CIRCUIT_BREAKER_THRESHOLD,
    1,
    20
  );
  const circuitOpen = criticalIncidents.length > 0 || attempts >= circuitBreakerThreshold;
  const degradedMode = healthStatus === "degraded"
    && degradedModeAllowed
    && !failedRequiredChecks.length
    && !criticalIncidents.length
    && !circuitOpen;
  const remediation = resolveOperationalRemediation(
    healthStatus,
    degradedMode,
    retryable,
    retryExhausted,
    activeIncidents,
    circuitOpen,
    retryAfterMs
  );
  const actionableErrors = [];

  if (healthStatus === "unavailable" || circuitOpen) {
    actionableErrors.push({
      code: circuitOpen ? "KERNEL_CIRCUIT_OPEN" : "KERNEL_UNAVAILABLE",
      message: circuitOpen
        ? "Hosted kernel circuit breaker is open for this workflow package."
        : asNonEmptyString(health.message, "Hosted kernel health is unavailable for this workflow package."),
      action: remediation.action,
      retryable: retryable && !retryExhausted && !circuitOpen
    });
  }

  for (const incident of activeIncidents) {
    actionableErrors.push({
      code: `KERNEL_INCIDENT:${incident.code}`,
      message: incident.message,
      action: incident.severity === "critical" ? "resolve-critical-incident" : "acknowledge-health-incident",
      retryable: retryable && incident.severity !== "critical" && !retryExhausted
    });
  }

  for (const check of failedRequiredChecks) {
    actionableErrors.push({
      code: `HEALTH_CHECK_FAILED:${check.name}`,
      message: check.message,
      action: "repair-runtime-dependency",
      retryable
    });
  }

  if (boundary.isolationMode === "boundary-review") {
    actionableErrors.push({
      code: "BOUNDARY_REVIEW_REQUIRED",
      message: "Tenant, workspace, or permission boundary must be resolved before hosted-kernel continuation.",
      action: "review-boundary",
      retryable: false
    });
  }

  if (blockers.length) {
    actionableErrors.push({
      code: "WORKFLOW_BLOCKED",
      message: "Workflow blockers are present on the package handoff.",
      action: "resolve-workflow-blockers",
      retryable: false
    });
  }

  return {
    status: healthStatus,
    degradedMode,
    checks,
    incidents,
    activeIncidents: activeIncidents.map((incident) => ({
      incidentId: incident.incidentId,
      code: incident.code,
      severity: incident.severity,
      status: incident.status,
      runbook: incident.runbook
    })),
    failedRequiredChecks: failedRequiredChecks.map((check) => check.name),
    warningChecks: warningChecks.map((check) => check.name),
    failureState: healthStatus === "healthy" && !blockers.length && !circuitOpen
      ? "none"
      : circuitOpen
        ? "circuit-breaker-open"
      : retryExhausted
        ? "retry-exhausted"
        : degradedMode
          ? "degraded-continuation"
          : "blocked-continuation",
    retry: {
      retryable: retryable && !retryExhausted,
      attempts,
      maxAttempts,
      retryAfterMs,
      circuitBreakerThreshold,
      circuitOpen,
      nextAction: remediation.action === "retry-after-backoff" ? "schedule-retry" : "manual-review"
    },
    remediation,
    actionableErrors
  };
}

function normalizeWorkflowRequest(input) {
  const request = asObject(input.request);
  const client = asObject(input.client);
  const runtime = asObject(input.runtime);
  const requestedHandoff = asNonEmptyString(request.handoff, "continue");
  const handoff = VALID_HANDOFFS.has(requestedHandoff) ? requestedHandoff : "review";
  const workflowId = asNonEmptyString(
    request.workflowId,
    asNonEmptyString(input.workflowId, `${surfaceName}:default`)
  );
  const packageName = asNonEmptyString(
    request.packageName,
    asNonEmptyString(input.packageName, surfaceName)
  );
  const route = asNonEmptyString(request.route, DEFAULT_ROUTE);
  const actor = asNonEmptyString(client.actor, "kernel-client");
  const sessionId = asNonEmptyString(client.sessionId, `${workflowId}:${actor}`);
  const pendingActions = asStringList(request.pendingActions);
  const completedActions = asStringList(request.completedActions);
  const blockers = asStringList(request.blockers);
  const capabilities = asStringList(runtime.capabilities);
  const requestedExports = asStringList(request.exports);
  const command = normalizeCommand(request, client);
  const integration = normalizeIntegrationContract(input, request, runtime, workflowId);
  const providerService = normalizeProviderServiceContract(input, request, runtime, integration, workflowId);
  const persisted = normalizePersistedState(input, workflowId);
  const persistedRecovery = classifyPersistedRecovery(persisted, command, workflowId);
  const clientRuntime = normalizeClientRuntimeContract(input, request, client, runtime, persisted, command, workflowId, handoff);
  const previewControls = normalizePreviewAcceptanceControls(input, request, client, workflowId);
  const boundary = normalizeBoundaryContext(input, request, client, workflowId);
  const lifecycle = normalizeLifecycleControls(input, request, runtime, command, workflowId);
  const actionState = mergeActionState(pendingActions, completedActions, persisted);
  const previewAcceptanceBlockers = uniqueStringList([
    previewControls.decision === "rejected" ? "client-preview-rejected" : "",
    previewControls.suppressDispatchUntilAccepted && previewControls.decision !== "accepted"
      ? "client-preview-acceptance-required"
      : ""
  ]);
  const mergedBlockers = uniqueStringList([
    ...persisted.blockers,
    ...blockers,
    ...clientRuntime.blockers,
    ...previewAcceptanceBlockers,
    ...lifecycle.blockers,
    ...persistedRecovery.blockers,
    ...providerServiceBlockers(providerService),
    ...boundaryBlockers(boundary)
  ]);
  const operationalHealth = classifyOperationalHealth(
    runtime,
    persisted,
    command,
    boundary,
    mergedBlockers,
    workflowId
  );
  const operationalBlockers = operationalHealth.status === "unavailable"
    ? ["hosted-kernel-unavailable"]
    : operationalHealth.retry.circuitOpen
      ? ["hosted-kernel-circuit-open"]
    : operationalHealth.failureState === "retry-exhausted"
      ? ["hosted-kernel-retry-exhausted"]
      : [];
  const allBlockers = uniqueStringList([
    ...mergedBlockers,
    ...operationalBlockers
  ]);
  const defaultExports = [
    "clientState",
    "auditTrail",
    "handoffProof",
    "kernelCommandEnvelope",
    "analyticsReport",
    "exportSummary",
    "timeline"
  ];
  const exports = filterTenantScopedExports(
    requestedExports.length ? requestedExports : defaultExports,
    boundary
  );

  return {
    workflowId,
    packageName,
    route,
    handoff,
    client: {
      actor,
      sessionId,
      requestId: clientRuntime.requestId
    },
    runtime: {
      kernel: asNonEmptyString(runtime.kernel, "hosted"),
      capabilities
    },
    clientRuntime,
    previewControls,
    integration,
    providerService,
    lifecycle,
    command,
    boundary,
    operationalHealth,
    persisted,
    persistedRecovery,
    pendingActions: actionState.pendingActions,
    completedActions: actionState.completedActions,
    blockers: allBlockers,
    exports: exports.length ? exports : ["clientState", "handoffProof"]
  };
}

function buildClientState(contract, generatedAt) {
  const restart = resolveRestartSemantics(contract);
  const persistedWritePlan = buildPersistedStateWritePlan(contract, generatedAt);
  const previewAcceptance = buildPreviewAcceptanceContract(contract, generatedAt, persistedWritePlan);
  const dispatchGate = buildHostedKernelDispatchGate(contract, {
    generatedAt,
    persistedState: {
      duplicateCommand: restart.duplicateCommand
    }
  }, integrationContractBlockers(contract.integration));
  const actionPanel = buildClientActionPanel(contract, previewAcceptance, dispatchGate, restart);
  const reportingState = buildReportingState(contract, generatedAt, persistedWritePlan, previewAcceptance, dispatchGate);
  const totalActions = contract.pendingActions.length + contract.completedActions.length;
  const progress = totalActions === 0
    ? 0
    : Math.round((contract.completedActions.length / totalActions) * 100);

  return {
    generatedAt,
    workflowId: contract.workflowId,
    packageName: contract.packageName,
    route: contract.route,
    tenantId: contract.boundary.tenantId,
    workspaceId: contract.boundary.workspaceId,
    clientSession: contract.client.sessionId,
    actor: contract.client.actor,
    role: contract.boundary.role,
    runtimeKernel: contract.runtime.kernel,
    clientRuntime: {
      schemaVersion: contract.clientRuntime.schemaVersion,
      requestId: contract.clientRuntime.requestId,
      correlationId: contract.clientRuntime.correlationId,
      handoffTarget: contract.clientRuntime.handoffTarget,
      urgency: contract.clientRuntime.urgency,
      locale: contract.clientRuntime.locale,
      timezone: contract.clientRuntime.timezone,
      stateMode: contract.clientRuntime.view.stateMode,
      requestedFields: contract.clientRuntime.view.requestedFields,
      continuity: contract.clientRuntime.continuity,
      receipt: contract.clientRuntime.receipt,
      actionPolicy: contract.clientRuntime.actionPolicy,
      blockers: contract.clientRuntime.blockers
    },
    progress,
    pendingActions: contract.pendingActions,
    completedActions: contract.completedActions,
    blockers: contract.blockers,
    operationalHealth: {
      status: contract.operationalHealth.status,
      failureState: contract.operationalHealth.failureState,
      degradedMode: contract.operationalHealth.degradedMode,
      activeIncidents: contract.operationalHealth.activeIncidents,
      failedRequiredChecks: contract.operationalHealth.failedRequiredChecks,
      warningChecks: contract.operationalHealth.warningChecks,
      retry: contract.operationalHealth.retry,
      remediation: contract.operationalHealth.remediation,
      actionableErrors: contract.operationalHealth.actionableErrors,
      dispatchGate
    },
    providerService: {
      providerId: contract.providerService.providerId,
      serviceName: contract.providerService.serviceName,
      apiVersion: contract.providerService.apiVersion,
      serviceStatus: contract.providerService.serviceStatus,
      capabilityDecision: contract.providerService.capabilityDecision,
      negotiatedCapabilities: contract.providerService.negotiatedCapabilities,
      missingCapabilities: contract.providerService.missingCapabilities,
      optionalAccepted: contract.providerService.optionalAccepted,
      sync: contract.providerService.sync,
      handoff: contract.providerService.handoff
    },
    lifecycle: {
      settings: contract.lifecycle.settings,
      controlCommand: contract.lifecycle.controlCommand,
      schedule: contract.lifecycle.schedule,
      validation: contract.lifecycle.validation,
      blockers: contract.lifecycle.blockers,
      nextAction: contract.lifecycle.nextAction,
      nextActionReason: contract.lifecycle.nextActionReason
    },
    permissionBoundary: {
      schemaVersion: contract.boundary.schemaVersion,
      boundaryKey: contract.boundary.boundaryKey,
      persistedBoundaryKey: contract.boundary.persistedBoundaryKey,
      boundaryDecision: contract.boundary.boundaryDecision,
      isolationMode: contract.boundary.isolationMode,
      grantedPermissions: contract.boundary.grantedPermissions,
      missingPermissions: contract.boundary.missingPermissions,
      requiredPermission: contract.boundary.requiredPermission,
      tenantAuthorized: contract.boundary.hasTenantAccess,
      workspaceAuthorized: contract.boundary.hasWorkspaceAccess,
      persistedBoundaryMatches: contract.boundary.samePersistedBoundary
    },
    persistedState: {
      status: persistedWritePlan.durableState.status,
      revision: persistedWritePlan.writePolicy.nextRevision,
      previousRevision: contract.persisted.revision,
      checkpointKey: contract.persisted.checkpoint.key,
      lastCommandId: persistedWritePlan.durableState.lastCommandId,
      duplicateCommand: restart.duplicateCommand,
      recoveryMode: restart.recoveryMode,
      restartSafe: restart.restartSafe,
      savedAt: persistedWritePlan.durableState.checkpoint.savedAt,
      storageKey: persistedWritePlan.storageKey,
      writeOperation: persistedWritePlan.writePolicy.operation,
      persistenceEffect: persistedWritePlan.effect,
      idempotencyKey: persistedWritePlan.writePolicy.idempotencyKey,
      checkpointProofId: persistedWritePlan.durableState.checkpoint.proofId,
      recoveryPolicy: persistedWritePlan.restart.policy,
      recoveryBlockers: persistedWritePlan.restart.recoveryBlockers,
      commandLedgerSize: persistedWritePlan.durableState.commandLedger.length,
      ledgerMatched: persistedWritePlan.restart.ledgerMatched,
      providerSync: persistedWritePlan.durableState.providerSync
    },
    persistedStateWritePlan: persistedWritePlan,
    previewAcceptance,
    reportingState,
    clientActionPanel: actionPanel,
    nextHandoff: {
      status: restart.status === "running" ? contract.handoff : restart.status,
      label: actionPanel.state === "refresh-required"
        ? "Refresh client state before workflow continuation"
        : actionPanel.state === "blocked"
        ? "Resolve blockers before client continuation"
        : contract.boundary.isolationMode === "boundary-review"
          ? "Boundary review required before workflow continuation"
        : restart.duplicateCommand
          ? "Command already applied; replaying persisted workflow state"
        : "Workflow package ready for client continuation",
      requiredClientAction: contract.blockers.length
        ? contract.clientRuntime.continuity.stale
          ? "refresh-client-state"
          : "review-blockers"
        : contract.lifecycle.nextAction === "wait-for-schedule"
          ? "wait-for-schedule"
        : contract.lifecycle.nextAction === "wait-for-manual-dispatch"
          ? "manual-dispatch"
        : contract.operationalHealth.degradedMode
          ? "continue-degraded"
        : restart.status === "complete"
          ? "none"
        : contract.handoff
    },
    userVisibleWorkflowHandoff: {
      schemaVersion: "workflow-package.user-handoff.v1",
      target: contract.clientRuntime.handoffTarget,
      urgency: contract.clientRuntime.urgency,
      stateMode: contract.clientRuntime.view.stateMode,
      status: contract.clientRuntime.continuity.stale
        ? "stale-client-state"
        : previewAcceptance.acceptanceState === "waiting-for-acceptance"
          ? "needs-preview-acceptance"
        : contract.blockers.length
          ? "blocked"
          : clientStateStatusForHandoff(restart.status, contract.handoff),
      primaryAction: actionPanel.primaryAction.action,
      primaryActionReason: actionPanel.primaryAction.reason,
      primaryActionRoute: actionPanel.primaryAction.route,
      primaryActionPayload: actionPanel.primaryAction.payload,
      secondaryActions: actionPanel.secondaryActions.map((entry) => entry.action),
      actionPanel,
      message: contract.clientRuntime.continuity.stale
        ? `Client expected revision ${contract.clientRuntime.continuity.expectedRevision}, but persisted revision is ${contract.persisted.revision}.`
        : previewAcceptance.acceptanceState === "waiting-for-acceptance"
          ? "Review and accept the workflow preview before dispatch."
        : contract.blockers.length
          ? "Workflow handoff is waiting for blocker resolution."
          : `Workflow handoff is ${contract.lifecycle.nextAction}.`,
      preview: {
        readiness: previewAcceptance.readiness,
        acceptanceState: previewAcceptance.acceptanceState,
        validationStatus: previewAcceptance.validationSummary.status,
        routeTargets: previewAcceptance.routeTargets,
        nextSteps: previewAcceptance.nextSteps
      },
      receipt: {
        required: contract.clientRuntime.receipt.required,
        channel: contract.clientRuntime.receipt.channel,
        deadlineMs: contract.clientRuntime.receipt.deadlineMs
      }
    },
    externalHandoff: {
      providerId: contract.providerService.providerId,
      serviceName: contract.providerService.serviceName,
      state: contract.providerService.handoff.state,
      deliveryMode: contract.integration.deliveryMode,
      endpoint: contract.providerService.handoff.endpoint,
      subject: contract.providerService.handoff.subject,
      ackTopic: contract.providerService.handoff.ackTopic,
      authMode: contract.providerService.handoff.authMode,
      requiresSignedProof: contract.providerService.handoff.requiresSignedProof,
      syncMode: contract.providerService.sync.mode,
      syncTarget: contract.providerService.sync.target,
      syncCursor: contract.providerService.sync.cursor,
      syncNextCursor: contract.providerService.sync.nextCursor,
      syncSequence: contract.providerService.sync.sequence,
      syncConflictPolicy: contract.providerService.sync.conflictPolicy,
      leaseMs: contract.providerService.sync.leaseMs,
      expiresAt: addMillisecondsToIsoString(generatedAt, contract.providerService.sync.leaseMs)
    },
    nextActionState: {
      action: actionPanel.primaryAction.action || previewAcceptance.nextSteps[0]?.action || (contract.blockers.length ? "resolve-blockers" : contract.lifecycle.nextAction),
      target: actionPanel.primaryAction.target || previewAcceptance.nextSteps[0]?.target || contract.previewControls.nextStepTarget,
      route: actionPanel.primaryAction.route || previewAcceptance.nextSteps[0]?.route || previewAcceptance.routeTargets.nextStep.route,
      payload: actionPanel.primaryAction.payload || previewAcceptance.nextSteps[0]?.payload || {
        workflowId: contract.workflowId,
        commandId: contract.command.commandId,
        requestId: contract.client.requestId
      },
      source: dispatchGate.blockers[0]?.source || (contract.lifecycle.blockers.length ? "lifecycle-controls" : "workflow-package"),
      dispatchEligible: previewAcceptance.readinessGates.dispatchEligible && dispatchGate.shouldDispatch,
      dispatchGateStatus: dispatchGate.status,
      dispatchMode: dispatchGate.dispatchMode,
      retryAt: dispatchGate.retry.retryAt,
      operatorActions: dispatchGate.operatorActions,
      scheduleMode: contract.lifecycle.schedule.mode,
      runAt: contract.lifecycle.schedule.runAt,
      earliestDispatchAt: contract.lifecycle.schedule.earliestDispatchAt,
      nextScheduledAt: contract.lifecycle.schedule.nextScheduledAt,
      leaseKey: contract.lifecycle.schedule.leaseKey,
      leaseMs: contract.lifecycle.schedule.leaseMs,
      timeoutMs: contract.lifecycle.settings.timeoutMs,
      dispatchDeadlineMs: contract.lifecycle.settings.dispatchDeadlineMs,
      lifecycleControlAction: contract.lifecycle.controlCommand.action,
      lifecycleValidationCodes: contract.lifecycle.validation.map((item) => item.code),
      reason: contract.lifecycle.nextActionReason
    }
  };
}

function buildAuditTrail(contract, generatedAt, evidence, clientState) {
  const restart = resolveRestartSemantics(contract);
  const persistedWritePlan = buildPersistedStateWritePlan(contract, generatedAt);
  const previewAcceptance = buildPreviewAcceptanceContract(contract, generatedAt, persistedWritePlan);
  const events = [
    {
      type: "workflow-package.request.normalized",
      at: generatedAt,
      workflowId: contract.workflowId,
      route: contract.route,
      requestId: contract.client.requestId,
      commandId: contract.command.commandId
    },
    {
      type: "workflow-package.boundary.evaluated",
      at: generatedAt,
      tenantId: contract.boundary.tenantId,
      workspaceId: contract.boundary.workspaceId,
      boundaryKey: contract.boundary.boundaryKey,
      persistedBoundaryKey: contract.boundary.persistedBoundaryKey,
      role: contract.boundary.role,
      boundaryDecision: contract.boundary.boundaryDecision,
      isolationMode: contract.boundary.isolationMode,
      tenantAuthorized: contract.boundary.hasTenantAccess,
      workspaceAuthorized: contract.boundary.hasWorkspaceAccess,
      explicitTenantScope: contract.boundary.explicitTenantScope,
      explicitWorkspaceScope: contract.boundary.explicitWorkspaceScope,
      requiredPermission: contract.boundary.requiredPermission
    },
    {
      type: "workflow-package.boundary.audit-handoff-shaped",
      at: generatedAt,
      auditPartitionKey: contract.boundary.auditPartitionKey,
      storagePartitionKey: contract.boundary.storagePartitionKey,
      proofSubject: contract.boundary.proofSubject,
      exportScope: "tenant-workspace"
    },
    {
      type: "workflow-package.client-state.materialized",
      at: generatedAt,
      sessionId: contract.client.sessionId,
      pendingCount: contract.pendingActions.length,
      completedCount: contract.completedActions.length
    },
    {
      type: "workflow-package.client-runtime.normalized",
      at: generatedAt,
      requestId: contract.clientRuntime.requestId,
      correlationId: contract.clientRuntime.correlationId,
      handoffTarget: contract.clientRuntime.handoffTarget,
      stateMode: contract.clientRuntime.view.stateMode,
      expectedRevision: contract.clientRuntime.continuity.expectedRevision,
      lastSeenRevision: contract.clientRuntime.continuity.lastSeenRevision,
      stale: contract.clientRuntime.continuity.stale,
      receiptRequired: contract.clientRuntime.receipt.required
    },
    {
      type: "workflow-package.client-action-panel.materialized",
      at: generatedAt,
      target: clientState.clientActionPanel.target,
      state: clientState.clientActionPanel.state,
      primaryAction: clientState.clientActionPanel.primaryAction.action,
      primaryRoute: clientState.clientActionPanel.primaryAction.route,
      secondaryActions: clientState.clientActionPanel.secondaryActions.map((entry) => entry.action),
      disabledActions: clientState.clientActionPanel.disabledActions.map((entry) => entry.action),
      maxVisibleActions: clientState.clientActionPanel.policy.maxVisibleActions
    },
    {
      type: "workflow-package.persisted-state.shaped",
      at: generatedAt,
      checkpointKey: contract.persisted.checkpoint.key,
      previousRevision: contract.persisted.revision,
      nextRevision: restart.nextRevision,
      status: restart.status,
      storageKey: persistedWritePlan.storageKey,
      persistenceEffect: persistedWritePlan.effect,
      writeOperation: persistedWritePlan.writePolicy.operation
    },
    {
      type: "workflow-package.persisted-state.write-plan",
      at: generatedAt,
      storageKey: persistedWritePlan.storageKey,
      effect: persistedWritePlan.effect,
      operation: persistedWritePlan.writePolicy.operation,
      expectedRevision: persistedWritePlan.writePolicy.expectedRevision,
      nextRevision: persistedWritePlan.writePolicy.nextRevision,
      replaySafe: persistedWritePlan.writePolicy.replaySafe,
      restoredFromCheckpoint: persistedWritePlan.restart.restoredFromCheckpoint,
      terminal: persistedWritePlan.restart.terminal
    },
    {
      type: "workflow-package.persisted-state.recovery-classified",
      at: generatedAt,
      workflowId: contract.workflowId,
      recoveryMode: persistedWritePlan.restart.recoveryMode,
      recoveryPolicy: persistedWritePlan.restart.policy,
      duplicateCommand: persistedWritePlan.restart.duplicateCommand,
      ledgerMatched: persistedWritePlan.restart.ledgerMatched,
      hasCheckpoint: contract.persistedRecovery.hasCheckpoint,
      terminalPersisted: contract.persistedRecovery.terminalPersisted,
      blockers: contract.persistedRecovery.blockers
    },
    {
      type: "workflow-package.operational-health.evaluated",
      at: generatedAt,
      status: contract.operationalHealth.status,
      failureState: contract.operationalHealth.failureState,
      degradedMode: contract.operationalHealth.degradedMode,
      retry: contract.operationalHealth.retry,
      activeIncidentCount: contract.operationalHealth.activeIncidents.length,
      remediation: contract.operationalHealth.remediation,
      dispatchGateStatus: clientState.operationalHealth.dispatchGate.status,
      dispatchGateMode: clientState.operationalHealth.dispatchGate.dispatchMode,
      dispatchGateBlockers: clientState.operationalHealth.dispatchGate.blockingCodes
    },
    {
      type: "workflow-package.integration.contract-normalized",
      at: generatedAt,
      schemaVersion: contract.integration.schemaVersion,
      deliveryMode: contract.integration.deliveryMode,
      acknowledgement: contract.integration.acknowledgement,
      connectorId: contract.integration.connectorId,
      outputContracts: contract.integration.requestedOutputContracts
    },
    {
      type: "workflow-package.provider.capabilities-negotiated",
      at: generatedAt,
      providerId: contract.providerService.providerId,
      serviceName: contract.providerService.serviceName,
      serviceStatus: contract.providerService.serviceStatus,
      capabilityDecision: contract.providerService.capabilityDecision,
      negotiatedCapabilities: contract.providerService.negotiatedCapabilities,
      missingCapabilities: contract.providerService.missingCapabilities
    },
    {
      type: "workflow-package.provider.sync-state-shaped",
      at: generatedAt,
      providerId: contract.providerService.providerId,
      sync: contract.providerService.sync
    },
    {
      type: "workflow-package.provider.external-handoff-shaped",
      at: generatedAt,
      providerId: contract.providerService.providerId,
      state: contract.providerService.handoff.state,
      deliveryMode: contract.providerService.handoff.deliveryMode,
      endpoint: contract.providerService.handoff.endpoint,
      subject: contract.providerService.handoff.subject,
      ackTopic: contract.providerService.handoff.ackTopic,
      authMode: contract.providerService.handoff.authMode,
      requiresSignedProof: contract.providerService.handoff.requiresSignedProof
    },
    {
      type: "workflow-package.lifecycle.controls-evaluated",
      at: generatedAt,
      enabled: contract.lifecycle.settings.enabled,
      paused: contract.lifecycle.settings.paused,
      maintenanceMode: contract.lifecycle.settings.maintenanceMode,
      controlAction: contract.lifecycle.controlCommand.action,
      controlRequestedBy: contract.lifecycle.controlCommand.requestedBy,
      changedEnabled: contract.lifecycle.controlCommand.changedEnabled,
      changedPaused: contract.lifecycle.controlCommand.changedPaused,
      scheduleMode: contract.lifecycle.schedule.mode,
      earliestDispatchAt: contract.lifecycle.schedule.earliestDispatchAt,
      nextScheduledAt: contract.lifecycle.schedule.nextScheduledAt,
      leaseKey: contract.lifecycle.schedule.leaseKey,
      leaseMs: contract.lifecycle.schedule.leaseMs,
      nextAction: contract.lifecycle.nextAction,
      nextActionReason: contract.lifecycle.nextActionReason,
      validationCodes: contract.lifecycle.validation.map((item) => item.code),
      blockers: contract.lifecycle.blockers
    },
    {
      type: "workflow-package.preview-acceptance.evaluated",
      at: generatedAt,
      schemaVersion: previewAcceptance.schemaVersion,
      readiness: previewAcceptance.readiness,
      accepted: previewAcceptance.accepted,
      acceptanceState: previewAcceptance.acceptanceState,
      acceptanceMode: previewAcceptance.acceptanceMode,
      acceptanceRequired: previewAcceptance.acceptanceControl.required,
      acceptanceDecision: previewAcceptance.acceptanceControl.decision,
      validationStatus: previewAcceptance.validationSummary.status,
      validationFailures: previewAcceptance.validationSummary.failureCount,
      validationWarnings: previewAcceptance.validationSummary.warningCount,
      clientAccepted: previewAcceptance.readinessGates.clientAccepted,
      dispatchEligible: previewAcceptance.readinessGates.dispatchEligible,
      previewRoute: previewAcceptance.routeTargets.preview.route,
      acceptRoute: previewAcceptance.routeTargets.accept.route
    },
    {
      type: "workflow-package.reporting-state.materialized",
      at: generatedAt,
      reportId: clientState.reportingState.reportId,
      reportSequence: clientState.reportingState.reportSequence,
      reportingWindow: clientState.reportingState.reportingWindow,
      readyExportCount: clientState.reportingState.readyExportCount,
      blockedExportCount: clientState.reportingState.blockedExportCount,
      nextWatermark: clientState.reportingState.nextWatermark
    }
  ];

  for (const error of contract.operationalHealth.actionableErrors) {
    events.push({
      type: "workflow-package.operational-health.actionable-error",
      at: generatedAt,
      code: error.code,
      action: error.action,
      retryable: error.retryable
    });
  }

  for (const incident of contract.operationalHealth.activeIncidents) {
    events.push({
      type: "workflow-package.operational-health.incident-active",
      at: generatedAt,
      incidentId: incident.incidentId,
      code: incident.code,
      severity: incident.severity,
      status: incident.status,
      runbook: incident.runbook
    });
  }

  if (contract.boundary.missingPermissions.length) {
    events.push({
      type: "workflow-package.boundary.permission-denied",
      at: generatedAt,
      tenantId: contract.boundary.tenantId,
      workspaceId: contract.boundary.workspaceId,
      missingPermissions: contract.boundary.missingPermissions
    });
  }

  if (!contract.boundary.hasTenantAccess) {
    events.push({
      type: "workflow-package.boundary.tenant-denied",
      at: generatedAt,
      requestedTenantId: contract.boundary.tenantId,
      allowedTenantIds: contract.boundary.allowedTenantIds,
      boundaryDecision: contract.boundary.boundaryDecision
    });
  }

  if (!contract.boundary.hasWorkspaceAccess) {
    events.push({
      type: "workflow-package.boundary.workspace-denied",
      at: generatedAt,
      requestedWorkspaceId: contract.boundary.workspaceId,
      allowedWorkspaceIds: contract.boundary.allowedWorkspaceIds,
      boundaryDecision: contract.boundary.boundaryDecision
    });
  }

  if (contract.providerService.missingCapabilities.length) {
    events.push({
      type: "workflow-package.provider.capability-denied",
      at: generatedAt,
      providerId: contract.providerService.providerId,
      missingCapabilities: contract.providerService.missingCapabilities
    });
  }

  if (contract.lifecycle.blockers.length) {
    events.push({
      type: "workflow-package.lifecycle.blocked",
      at: generatedAt,
      blockers: contract.lifecycle.blockers,
      nextAction: contract.lifecycle.nextAction,
      controlAction: contract.lifecycle.controlCommand.action,
      nextActionReason: contract.lifecycle.nextActionReason
    });
  }

  for (const item of contract.lifecycle.validation) {
    events.push({
      type: "workflow-package.lifecycle.validation",
      at: generatedAt,
      code: item.code,
      severity: item.severity,
      detail: item.detail,
      controlAction: contract.lifecycle.controlCommand.action,
      scheduleMode: contract.lifecycle.schedule.mode
    });
  }

  if (contract.clientRuntime.blockers.length) {
    events.push({
      type: "workflow-package.client-runtime.blocked",
      at: generatedAt,
      blockers: contract.clientRuntime.blockers,
      expectedRevision: contract.clientRuntime.continuity.expectedRevision,
      persistedRevision: contract.persisted.revision,
      requiredAction: "refresh-client-state"
    });
  }

  if (!contract.boundary.samePersistedBoundary) {
    events.push({
      type: "workflow-package.boundary.persisted-state-rejected",
      at: generatedAt,
      requestedTenantId: contract.boundary.tenantId,
      requestedWorkspaceId: contract.boundary.workspaceId,
      persistedTenantId: contract.boundary.persistedTenantId,
      persistedWorkspaceId: contract.boundary.persistedWorkspaceId
    });
  }

  if (restart.duplicateCommand) {
    events.push({
      type: "workflow-package.command.idempotent-replay",
      at: generatedAt,
      commandId: contract.command.commandId,
      revision: contract.persisted.revision,
      ledgerMatched: contract.persistedRecovery.ledgerMatched,
      idempotencyKey: contract.command.idempotencyKey
    });
  }

  if (restart.recoveryMode === "checkpoint-resume") {
    events.push({
      type: "workflow-package.recovery.checkpoint-resume",
      at: generatedAt,
      checkpoint: contract.persisted.checkpoint
    });
  }

  for (const blocker of contract.persistedRecovery.blockers) {
    events.push({
      type: "workflow-package.persisted-state.recovery-blocked",
      at: generatedAt,
      blocker,
      policy: contract.persistedRecovery.policy,
      leaseId: contract.persistedRecovery.leaseId
    });
  }

  if (contract.blockers.length) {
    events.push({
      type: "workflow-package.handoff.blocked",
      at: generatedAt,
      blockers: contract.blockers
    });
  }

  for (const step of previewAcceptance.nextSteps) {
    events.push({
      type: "workflow-package.preview-acceptance.next-step",
      at: generatedAt,
      target: step.target,
      route: step.route,
      action: step.action,
      blocking: step.blocking,
      reason: step.reason,
      payload: step.payload
    });
  }

  for (const item of evidence) {
    events.push({
      type: "workflow-package.evidence.attached",
      at: generatedAt,
      value: item
    });
  }

  return events;
}

function buildHandoffProof(contract, clientState, auditTrail) {
  return {
    proofId: `${contract.workflowId}:${contract.client.requestId}`,
    surfaceId,
    route: contract.route,
    tenantId: contract.boundary.tenantId,
    workspaceId: contract.boundary.workspaceId,
    handoffStatus: clientState.nextHandoff.status,
    persistedStatus: clientState.persistedState.status,
    checkpointKey: clientState.persistedState.checkpointKey,
    stateRevision: clientState.persistedState.revision,
    duplicateCommand: clientState.persistedState.duplicateCommand,
    persistence: {
      storageKey: clientState.persistedStateWritePlan.storageKey,
      effect: clientState.persistedStateWritePlan.effect,
      operation: clientState.persistedStateWritePlan.writePolicy.operation,
      expectedRevision: clientState.persistedStateWritePlan.writePolicy.expectedRevision,
      nextRevision: clientState.persistedStateWritePlan.writePolicy.nextRevision,
      replaySafe: clientState.persistedStateWritePlan.writePolicy.replaySafe,
      recoveryMode: clientState.persistedStateWritePlan.restart.recoveryMode,
      recoveryPolicy: clientState.persistedStateWritePlan.restart.policy,
      recoveryBlockers: clientState.persistedStateWritePlan.restart.recoveryBlockers,
      ledgerMatched: clientState.persistedStateWritePlan.restart.ledgerMatched,
      commandLedgerSize: clientState.persistedStateWritePlan.durableState.commandLedger.length
    },
    boundary: {
      schemaVersion: contract.boundary.schemaVersion,
      boundaryKey: contract.boundary.boundaryKey,
      persistedBoundaryKey: contract.boundary.persistedBoundaryKey,
      boundaryDecision: contract.boundary.boundaryDecision,
      isolationMode: contract.boundary.isolationMode,
      role: contract.boundary.role,
      requiredPermission: contract.boundary.requiredPermission,
      missingPermissions: contract.boundary.missingPermissions,
      tenantAuthorized: contract.boundary.hasTenantAccess,
      workspaceAuthorized: contract.boundary.hasWorkspaceAccess,
      persistedBoundaryMatches: contract.boundary.samePersistedBoundary,
      explicitTenantScope: contract.boundary.explicitTenantScope,
      explicitWorkspaceScope: contract.boundary.explicitWorkspaceScope,
      auditPartitionKey: contract.boundary.auditPartitionKey,
      storagePartitionKey: contract.boundary.storagePartitionKey,
      proofSubject: contract.boundary.proofSubject
    },
    operationalHealth: {
      status: contract.operationalHealth.status,
      failureState: contract.operationalHealth.failureState,
      degradedMode: contract.operationalHealth.degradedMode,
      retryable: contract.operationalHealth.retry.retryable,
      retryAfterMs: contract.operationalHealth.retry.retryAfterMs,
      circuitOpen: contract.operationalHealth.retry.circuitOpen,
      remediation: contract.operationalHealth.remediation,
      dispatchGate: clientState.operationalHealth.dispatchGate,
      activeIncidentIds: contract.operationalHealth.activeIncidents.map((incident) => incident.incidentId),
      actionableErrorCodes: contract.operationalHealth.actionableErrors.map((error) => error.code)
    },
    clientRuntime: {
      schemaVersion: contract.clientRuntime.schemaVersion,
      requestId: contract.clientRuntime.requestId,
      correlationId: contract.clientRuntime.correlationId,
      handoffTarget: contract.clientRuntime.handoffTarget,
      urgency: contract.clientRuntime.urgency,
      stateMode: contract.clientRuntime.view.stateMode,
      expectedRevision: contract.clientRuntime.continuity.expectedRevision,
      lastSeenRevision: contract.clientRuntime.continuity.lastSeenRevision,
      stale: contract.clientRuntime.continuity.stale,
      receiptRequired: contract.clientRuntime.receipt.required,
      receiptChannel: contract.clientRuntime.receipt.channel,
      blockers: contract.clientRuntime.blockers
    },
    providerService: {
      providerId: contract.providerService.providerId,
      serviceName: contract.providerService.serviceName,
      apiVersion: contract.providerService.apiVersion,
      capabilityDecision: contract.providerService.capabilityDecision,
      negotiatedCapabilities: contract.providerService.negotiatedCapabilities,
      missingCapabilities: contract.providerService.missingCapabilities,
      syncMode: contract.providerService.sync.mode,
      syncTarget: contract.providerService.sync.target,
      syncNextCursor: contract.providerService.sync.nextCursor,
      syncSequence: contract.providerService.sync.sequence,
      syncConflictPolicy: contract.providerService.sync.conflictPolicy,
      handoffState: contract.providerService.handoff.state,
      handoffSubject: contract.providerService.handoff.subject,
      handoffEndpoint: contract.providerService.handoff.endpoint,
      handoffAuthMode: contract.providerService.handoff.authMode
    },
    lifecycle: {
      enabled: contract.lifecycle.settings.enabled,
      paused: contract.lifecycle.settings.paused,
      approved: contract.lifecycle.settings.approved,
      controlAction: contract.lifecycle.controlCommand.action,
      controlRequestedBy: contract.lifecycle.controlCommand.requestedBy,
      changedEnabled: contract.lifecycle.controlCommand.changedEnabled,
      changedPaused: contract.lifecycle.controlCommand.changedPaused,
      scheduleMode: contract.lifecycle.schedule.mode,
      runAt: contract.lifecycle.schedule.runAt,
      earliestDispatchAt: contract.lifecycle.schedule.earliestDispatchAt,
      nextScheduledAt: contract.lifecycle.schedule.nextScheduledAt,
      leaseKey: contract.lifecycle.schedule.leaseKey,
      leaseMs: contract.lifecycle.schedule.leaseMs,
      nextAction: contract.lifecycle.nextAction,
      nextActionReason: contract.lifecycle.nextActionReason,
      validationCodes: contract.lifecycle.validation.map((item) => item.code),
      blockers: contract.lifecycle.blockers
    },
    previewAcceptance: {
      schemaVersion: clientState.previewAcceptance.schemaVersion,
      readiness: clientState.previewAcceptance.readiness,
      accepted: clientState.previewAcceptance.accepted,
      acceptanceState: clientState.previewAcceptance.acceptanceState,
      acceptanceMode: clientState.previewAcceptance.acceptanceMode,
      validationStatus: clientState.previewAcceptance.validationSummary.status,
      acceptanceControl: clientState.previewAcceptance.acceptanceControl,
      readinessGates: clientState.previewAcceptance.readinessGates,
      routeTargets: clientState.previewAcceptance.routeTargets,
      nextSteps: clientState.previewAcceptance.nextSteps,
      proofSubjects: clientState.previewAcceptance.proofSubjects
    },
    clientActionPanel: {
      schemaVersion: clientState.clientActionPanel.schemaVersion,
      target: clientState.clientActionPanel.target,
      state: clientState.clientActionPanel.state,
      primaryAction: clientState.clientActionPanel.primaryAction.action,
      primaryRoute: clientState.clientActionPanel.primaryAction.route,
      primaryEnabled: clientState.clientActionPanel.primaryAction.enabled,
      secondaryActions: clientState.clientActionPanel.secondaryActions.map((entry) => entry.action),
      disabledActions: clientState.clientActionPanel.disabledActions,
      policy: clientState.clientActionPanel.policy
    },
    exportedContracts: contract.exports,
    auditEventCount: auditTrail.length,
    clientStateShape: [
      "workflowId",
      "packageName",
      "route",
      "tenantId",
      "workspaceId",
      "clientSession",
      "progress",
      "permissionBoundary",
      "persistedState",
      "reportingState",
      "previewAcceptance",
      "clientActionPanel",
      "nextHandoff",
      "userVisibleWorkflowHandoff",
      "externalHandoff",
      "kernelCommandEnvelope"
    ],
    runtimeCapabilities: contract.runtime.capabilities
  };
}

function integrationContractBlockers(integration) {
  const integrationBlockers = [];

  if (integration.deliveryMode === "webhook" && !integration.callbackUrl) {
    integrationBlockers.push("integration-callback-url-required");
  }

  if (integration.deliveryMode === "queued" && !integration.queueName) {
    integrationBlockers.push("integration-queue-name-required");
  }

  return integrationBlockers;
}

function buildHostedKernelDispatchGate(contract, clientState, integrationBlockers) {
  const retry = contract.operationalHealth.retry;
  const retryAt = retry.retryable && retry.retryAfterMs
    ? addMillisecondsToIsoString(clientState.generatedAt, retry.retryAfterMs)
    : "";
  const blockers = [];

  for (const blocker of integrationBlockers) {
    blockers.push({
      code: blocker,
      source: "integration",
      severity: "error",
      message: blocker === "integration-callback-url-required"
        ? "Webhook delivery requires a callbackUrl before hosted-kernel dispatch."
        : "Queued delivery requires a queueName before hosted-kernel dispatch.",
      action: "repair-integration-contract",
      retryable: false,
      retryAfterMs: 0
    });
  }

  for (const capability of contract.providerService.missingCapabilities) {
    blockers.push({
      code: `provider-capability-missing:${capability}`,
      source: "provider",
      severity: "error",
      message: `Provider ${contract.providerService.providerId} does not offer ${capability}.`,
      action: "negotiate-provider-capability",
      retryable: false,
      retryAfterMs: 0
    });
  }

  if (contract.providerService.serviceStatus === "unavailable") {
    blockers.push({
      code: `provider-service-unavailable:${contract.providerService.providerId}`,
      source: "provider",
      severity: "error",
      message: "Provider service is unavailable for the workflow package.",
      action: "restore-provider-service",
      retryable: retry.retryable,
      retryAfterMs: retry.retryAfterMs
    });
  }

  if (contract.clientRuntime.continuity.stale) {
    blockers.push({
      code: "client-runtime-revision-stale",
      source: "client-runtime",
      severity: "error",
      message: `Client expected revision ${contract.clientRuntime.continuity.expectedRevision}, but persisted revision is ${contract.persisted.revision}.`,
      action: "refresh-client-state",
      retryable: false,
      retryAfterMs: 0
    });
  }

  for (const blocker of contract.lifecycle.blockers) {
    blockers.push({
      code: blocker,
      source: "lifecycle",
      severity: "error",
      message: "Lifecycle controls are holding hosted-kernel dispatch.",
      action: "resolve-lifecycle-controls",
      retryable: false,
      retryAfterMs: 0
    });
  }

  for (const blocker of contract.blockers.filter((blocker) => !contract.lifecycle.blockers.includes(blocker))) {
    const boundaryBlocker = blocker.startsWith("permission-missing")
      || blocker.startsWith("tenant-not-authorized")
      || blocker.startsWith("workspace-not-authorized")
      || blocker.includes("boundary");
    const providerBlocker = blocker.startsWith("provider-");
    const previewBlocker = blocker.startsWith("client-preview-");

    blockers.push({
      code: blocker,
      source: previewBlocker
        ? "preview-acceptance"
        : boundaryBlocker
          ? "boundary"
          : providerBlocker ? "provider" : "workflow",
      severity: "error",
      message: previewBlocker
        ? "Client preview acceptance is required before hosted-kernel dispatch."
        : "Workflow continuation is blocked before hosted-kernel dispatch.",
      action: previewBlocker
        ? "accept-preview"
        : boundaryBlocker
          ? "review-boundary"
          : providerBlocker ? "repair-provider-contract" : "resolve-workflow-blockers",
      retryable: false,
      retryAfterMs: 0
    });
  }

  for (const error of contract.operationalHealth.actionableErrors) {
    blockers.push({
      code: error.code,
      source: "operational-health",
      severity: error.retryable ? "warning" : "error",
      message: error.message,
      action: error.action,
      retryable: error.retryable,
      retryAfterMs: error.retryable ? retry.retryAfterMs : 0
    });
  }

  const seenBlockerKeys = new Set();
  const normalizedBlockers = blockers.filter((blocker) => {
    const key = `${blocker.source}:${blocker.code}`;

    if (seenBlockerKeys.has(key)) {
      return false;
    }

    seenBlockerKeys.add(key);
    return true;
  });
  const blockingErrors = normalizedBlockers.filter((blocker) => blocker.severity === "error");
  const scheduledByLifecycle = contract.lifecycle.nextAction === "wait-for-manual-dispatch"
    || contract.lifecycle.nextAction === "wait-for-schedule";
  const lifecycleControlOnly = contract.lifecycle.controlCommand.mutatesLifecycle
    && contract.lifecycle.nextAction !== "dispatch-now"
    && !scheduledByLifecycle;
  const gateStatus = clientState.persistedState.duplicateCommand
    ? "replayed"
    : contract.command.command === "acknowledge"
      ? "acknowledged"
      : lifecycleControlOnly
        ? "lifecycle-control-applied"
      : retry.circuitOpen
        ? "held"
      : contract.operationalHealth.status === "unavailable" && retry.retryable
        ? "retry-scheduled"
      : scheduledByLifecycle
        ? "scheduled"
      : blockingErrors.length
        ? "held"
      : contract.operationalHealth.degradedMode
        ? "degraded-dispatchable"
      : "dispatchable";
  const shouldDispatch = gateStatus === "dispatchable" || gateStatus === "degraded-dispatchable";

  return {
    schemaVersion: "workflow-package.hosted-kernel-dispatch-gate.v1",
    status: gateStatus,
    shouldDispatch,
    degradedMode: contract.operationalHealth.degradedMode,
    failureState: contract.operationalHealth.failureState,
    retry: {
      retryable: retry.retryable,
      attempts: retry.attempts,
      maxAttempts: retry.maxAttempts,
      retryAfterMs: retry.retryAfterMs,
      retryAt,
      circuitOpen: retry.circuitOpen
    },
    acknowledgement: {
      mode: contract.integration.acknowledgement,
      receiptRequired: contract.clientRuntime.receipt.required,
      receiptChannel: contract.clientRuntime.receipt.channel,
      deadlineMs: contract.clientRuntime.receipt.deadlineMs,
      timeoutMs: contract.integration.timeoutMs
    },
    blockers: normalizedBlockers,
    blockingCodes: uniqueStringList(normalizedBlockers.map((blocker) => blocker.code)),
    operatorActions: uniqueStringList(normalizedBlockers.map((blocker) => blocker.action)),
    dispatchMode: shouldDispatch
      ? contract.integration.deliveryMode
      : gateStatus === "retry-scheduled"
        ? "backoff"
        : gateStatus === "lifecycle-control-applied"
          ? "control"
        : gateStatus === "scheduled"
          ? contract.lifecycle.schedule.mode
          : "held"
  };
}

function resolveKernelDispatch(contract, clientState) {
  const integrationBlockers = integrationContractBlockers(contract.integration);
  const gate = buildHostedKernelDispatchGate(contract, clientState, integrationBlockers);

  if (clientState.persistedState.duplicateCommand) {
    return {
      status: "replayed",
      reason: "duplicate-command",
      integrationBlockers,
      gate,
      shouldDispatch: false
    };
  }

  if (integrationBlockers.length) {
    return {
      status: "held",
      reason: "integration-contract-invalid",
      integrationBlockers,
      gate,
      shouldDispatch: false
    };
  }

  if (contract.clientRuntime.continuity.stale) {
    return {
      status: "held",
      reason: "client-runtime-revision-stale",
      integrationBlockers,
      gate,
      shouldDispatch: false
    };
  }

  if (contract.blockers.length || contract.boundary.isolationMode === "boundary-review") {
    return {
      status: "held",
      reason: "workflow-or-boundary-blocked",
      integrationBlockers,
      gate,
      shouldDispatch: false
    };
  }

  if (contract.lifecycle.nextAction === "wait-for-manual-dispatch" || contract.lifecycle.nextAction === "wait-for-schedule") {
    return {
      status: "scheduled",
      reason: contract.lifecycle.nextAction,
      integrationBlockers,
      gate,
      shouldDispatch: false
    };
  }

  if (contract.lifecycle.controlCommand.mutatesLifecycle && contract.lifecycle.nextAction !== "dispatch-now") {
    return {
      status: "accepted",
      reason: `lifecycle-control:${contract.lifecycle.nextAction}`,
      integrationBlockers,
      gate,
      shouldDispatch: false
    };
  }

  if (contract.operationalHealth.status === "unavailable") {
    return {
      status: contract.operationalHealth.retry.retryable ? "retry-scheduled" : "held",
      reason: contract.operationalHealth.retry.retryable
        ? "hosted-kernel-backoff"
        : "hosted-kernel-unavailable",
      integrationBlockers,
      gate,
      shouldDispatch: false
    };
  }

  if (contract.operationalHealth.retry.circuitOpen) {
    return {
      status: "held",
      reason: "hosted-kernel-circuit-open",
      integrationBlockers,
      gate,
      shouldDispatch: false
    };
  }

  if (contract.command.command === "acknowledge") {
    return {
      status: "acknowledged",
      reason: "read-only-command",
      integrationBlockers,
      gate,
      shouldDispatch: false
    };
  }

  return {
    status: contract.integration.deliveryMode === "inline" ? "ready" : "accepted",
    reason: contract.operationalHealth.degradedMode ? "degraded-mode-allowed" : "dispatchable",
    integrationBlockers,
    gate,
    shouldDispatch: true
  };
}

function buildKernelCommandEnvelope(contract, clientState, handoffProof, generatedAt) {
  const dispatch = resolveKernelDispatch(contract, clientState);
  const outputContracts = uniqueStringList([
    "clientState",
    "handoffProof",
    ...contract.integration.requestedOutputContracts,
    ...contract.exports
  ]);

  return {
    envelopeId: `${contract.workflowId}:${clientState.persistedState.revision}:${contract.command.commandId}`,
    schemaVersion: contract.integration.schemaVersion,
    generatedAt,
    surfaceId,
    route: contract.route,
    tenantId: contract.boundary.tenantId,
    workspaceId: contract.boundary.workspaceId,
    command: {
      name: contract.command.command,
      commandId: contract.command.commandId,
      idempotencyKey: contract.command.idempotencyKey,
      actor: contract.client.actor,
      sessionId: contract.client.sessionId,
      requestId: contract.clientRuntime.requestId,
      correlationId: contract.clientRuntime.correlationId,
      requestedHandoff: contract.handoff
    },
    boundaryContract: {
      schemaVersion: contract.boundary.schemaVersion,
      boundaryKey: contract.boundary.boundaryKey,
      persistedBoundaryKey: contract.boundary.persistedBoundaryKey,
      decision: contract.boundary.boundaryDecision,
      isolationMode: contract.boundary.isolationMode,
      tenantId: contract.boundary.tenantId,
      workspaceId: contract.boundary.workspaceId,
      tenantAuthorized: contract.boundary.hasTenantAccess,
      workspaceAuthorized: contract.boundary.hasWorkspaceAccess,
      persistedBoundaryMatches: contract.boundary.samePersistedBoundary,
      requiredPermission: contract.boundary.requiredPermission,
      missingPermissions: contract.boundary.missingPermissions,
      auditPartitionKey: contract.boundary.auditPartitionKey,
      storagePartitionKey: contract.boundary.storagePartitionKey,
      proofSubject: contract.boundary.proofSubject
    },
    dispatch: {
      status: dispatch.status,
      reason: dispatch.reason,
      shouldDispatch: dispatch.shouldDispatch,
      deliveryMode: contract.integration.deliveryMode,
      acknowledgement: contract.integration.acknowledgement,
      connectorId: contract.integration.connectorId,
      callbackUrl: contract.integration.callbackUrl,
      queueName: contract.integration.queueName,
      timeoutMs: contract.integration.timeoutMs,
      retryAfterMs: contract.operationalHealth.retry.retryAfterMs,
      circuitOpen: contract.operationalHealth.retry.circuitOpen,
      remediation: contract.operationalHealth.remediation,
      gate: dispatch.gate,
      blockingReasons: dispatch.gate.blockers,
      requiredOperatorActions: dispatch.gate.operatorActions,
      integrationBlockers: dispatch.integrationBlockers
    },
    stateContract: {
      previousRevision: clientState.persistedState.previousRevision,
      nextRevision: clientState.persistedState.revision,
      checkpointKey: clientState.persistedState.checkpointKey,
      persistedStatus: clientState.persistedState.status,
      recoveryMode: clientState.persistedState.recoveryMode,
      restartSafe: clientState.persistedState.restartSafe,
      storageKey: clientState.persistedStateWritePlan.storageKey,
      persistenceEffect: clientState.persistedStateWritePlan.effect,
      writePolicy: clientState.persistedStateWritePlan.writePolicy,
      recovery: clientState.persistedStateWritePlan.durableState.recovery,
      commandLedger: clientState.persistedStateWritePlan.durableState.commandLedger,
      durableState: clientState.persistedStateWritePlan.durableState
    },
    inputContracts: {
      pendingActions: contract.pendingActions,
      completedActions: contract.completedActions,
      blockers: contract.blockers,
      clientRuntime: {
        schemaVersion: contract.clientRuntime.schemaVersion,
        handoffTarget: contract.clientRuntime.handoffTarget,
        urgency: contract.clientRuntime.urgency,
        locale: contract.clientRuntime.locale,
        timezone: contract.clientRuntime.timezone,
        view: contract.clientRuntime.view,
        continuity: contract.clientRuntime.continuity,
        receipt: contract.clientRuntime.receipt,
        actionPolicy: contract.clientRuntime.actionPolicy,
        blockers: contract.clientRuntime.blockers
      },
      runtimeCapabilities: contract.runtime.capabilities,
      providerService: {
        providerId: contract.providerService.providerId,
        serviceName: contract.providerService.serviceName,
        apiVersion: contract.providerService.apiVersion,
        requiredCapabilities: contract.providerService.requiredCapabilities,
        negotiatedCapabilities: contract.providerService.negotiatedCapabilities,
        missingCapabilities: contract.providerService.missingCapabilities,
        sync: contract.providerService.sync,
        handoff: contract.providerService.handoff
      },
      permissionBoundary: clientState.permissionBoundary
    },
    lifecycle: {
      settings: contract.lifecycle.settings,
      controlCommand: contract.lifecycle.controlCommand,
      schedule: contract.lifecycle.schedule,
      validation: contract.lifecycle.validation,
      nextAction: contract.lifecycle.nextAction,
      nextActionReason: contract.lifecycle.nextActionReason,
      nextActionState: clientState.nextActionState
    },
    previewAcceptance: {
      schemaVersion: clientState.previewAcceptance.schemaVersion,
      readiness: clientState.previewAcceptance.readiness,
      accepted: clientState.previewAcceptance.accepted,
      acceptanceState: clientState.previewAcceptance.acceptanceState,
      acceptanceMode: clientState.previewAcceptance.acceptanceMode,
      acceptanceControl: clientState.previewAcceptance.acceptanceControl,
      validationSummary: clientState.previewAcceptance.validationSummary,
      readinessGates: clientState.previewAcceptance.readinessGates,
      routeTargets: clientState.previewAcceptance.routeTargets,
      nextSteps: clientState.previewAcceptance.nextSteps,
      proofSubjects: clientState.previewAcceptance.proofSubjects
    },
    clientActionPanel: {
      schemaVersion: clientState.clientActionPanel.schemaVersion,
      state: clientState.clientActionPanel.state,
      target: clientState.clientActionPanel.target,
      primaryAction: clientState.clientActionPanel.primaryAction,
      secondaryActions: clientState.clientActionPanel.secondaryActions,
      disabledActions: clientState.clientActionPanel.disabledActions,
      routeBindings: clientState.clientActionPanel.routeBindings
    },
    externalHandoff: {
      state: clientState.externalHandoff.state,
      providerId: clientState.externalHandoff.providerId,
      serviceName: clientState.externalHandoff.serviceName,
      deliveryMode: clientState.externalHandoff.deliveryMode,
      endpoint: clientState.externalHandoff.endpoint,
      subject: clientState.externalHandoff.subject,
      ackTopic: clientState.externalHandoff.ackTopic,
      authMode: clientState.externalHandoff.authMode,
      requiresSignedProof: clientState.externalHandoff.requiresSignedProof,
      syncTarget: clientState.externalHandoff.syncTarget,
      syncCursor: clientState.externalHandoff.syncCursor,
      syncNextCursor: clientState.externalHandoff.syncNextCursor,
      syncSequence: clientState.externalHandoff.syncSequence,
      syncConflictPolicy: clientState.externalHandoff.syncConflictPolicy,
      leaseMs: clientState.externalHandoff.leaseMs,
      expiresAt: clientState.externalHandoff.expiresAt
    },
    outputContracts,
    proof: contract.integration.acceptsProof
      ? {
        proofId: handoffProof.proofId,
        handoffStatus: handoffProof.handoffStatus,
        auditEventCount: handoffProof.auditEventCount,
        exportedContracts: handoffProof.exportedContracts
      }
      : {
        proofId: handoffProof.proofId,
        withheld: true,
        reason: "integration-does-not-accept-proof"
      }
  };
}

function buildHistorySnapshots(contract, clientState, generatedAt) {
  const currentSnapshot = {
    snapshotId: `${contract.workflowId}:revision:${clientState.persistedState.revision}`,
    capturedAt: generatedAt,
    revision: clientState.persistedState.revision,
    status: clientState.persistedState.status,
    pendingCount: contract.pendingActions.length,
    completedCount: contract.completedActions.length,
    blockerCount: contract.blockers.length,
    blockers: contract.blockers,
    progress: clientState.progress,
    checkpointKey: clientState.persistedState.checkpointKey,
    persistenceEffect: clientState.persistedStateWritePlan.effect,
    writeOperation: clientState.persistedStateWritePlan.writePolicy.operation,
    recoveryMode: clientState.persistedStateWritePlan.restart.recoveryMode,
    lifecycle: {
      nextAction: contract.lifecycle.nextAction,
      nextActionReason: contract.lifecycle.nextActionReason,
      scheduleMode: contract.lifecycle.schedule.mode,
      earliestDispatchAt: contract.lifecycle.schedule.earliestDispatchAt,
      nextScheduledAt: contract.lifecycle.schedule.nextScheduledAt,
      controlAction: contract.lifecycle.controlCommand.action,
      validationCodes: contract.lifecycle.validation.map((item) => item.code),
      blockers: contract.lifecycle.blockers,
      enabled: contract.lifecycle.settings.enabled,
      paused: contract.lifecycle.settings.paused
    },
    reporting: {
      reportId: clientState.reportingState.reportId,
      reportSequence: clientState.reportingState.reportSequence,
      reportingWindow: clientState.reportingState.reportingWindow,
      readyExportCount: clientState.reportingState.readyExportCount,
      blockedExportCount: clientState.reportingState.blockedExportCount,
      nextWatermark: clientState.reportingState.nextWatermark
    }
  };
  const snapshots = [
    ...contract.persisted.history,
    currentSnapshot
  ];
  const seen = new Set();

  return snapshots
    .filter((snapshot) => {
      const key = `${snapshot.revision}:${snapshot.snapshotId}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(-13);
}

function buildAnalyticsReport(contract, clientState, auditTrail, historySnapshots) {
  const eventTypeCounts = auditTrail.reduce((counts, event) => {
    counts[event.type] = (counts[event.type] || 0) + 1;
    return counts;
  }, {});
  const actionTotal = contract.pendingActions.length + contract.completedActions.length;
  const blockersByKind = contract.blockers.reduce((counts, blocker) => {
    const kind = blocker.includes(":") ? blocker.split(":")[0] : blocker;
    counts[kind] = (counts[kind] || 0) + 1;
    return counts;
  }, {});
  const latestHistoricalProgress = historySnapshots.length > 1
    ? historySnapshots[historySnapshots.length - 2].progress
    : 0;

  return {
    workflowId: contract.workflowId,
    route: contract.route,
    generatedAt: clientState.generatedAt,
    counters: {
      pendingActions: contract.pendingActions.length,
      completedActions: contract.completedActions.length,
      totalActions: actionTotal,
      blockers: contract.blockers.length,
      auditEvents: auditTrail.length,
      actionableErrors: contract.operationalHealth.actionableErrors.length,
      activeIncidents: contract.operationalHealth.activeIncidents.length,
      failedRequiredChecks: contract.operationalHealth.failedRequiredChecks.length,
      warningChecks: contract.operationalHealth.warningChecks.length,
      historySnapshots: historySnapshots.length,
      requestedExports: contract.exports.length,
      stateWrites: clientState.persistedStateWritePlan.writePolicy.operation === "compare-and-swap" ? 1 : 0,
      idempotentReplays: clientState.persistedStateWritePlan.restart.duplicateCommand ? 1 : 0,
      previewValidationFailures: clientState.previewAcceptance.validationSummary.failureCount,
      previewValidationWarnings: clientState.previewAcceptance.validationSummary.warningCount,
      previewNextSteps: clientState.previewAcceptance.nextSteps.length,
      previewAcceptanceRequired: clientState.previewAcceptance.acceptanceControl.required ? 1 : 0,
      previewAccepted: clientState.previewAcceptance.accepted ? 1 : 0,
      clientRuntimeBlockers: contract.clientRuntime.blockers.length,
      staleClientRuntimeRevisions: contract.clientRuntime.continuity.stale ? 1 : 0,
      recoveryBlockers: contract.persistedRecovery.blockers.length,
      commandLedgerEntries: clientState.persistedStateWritePlan.durableState.commandLedger.length,
      lifecycleValidationWarnings: contract.lifecycle.validation.filter((item) => item.severity === "warning").length,
      lifecycleControlMutations: contract.lifecycle.controlCommand.mutatesLifecycle ? 1 : 0,
      providerHandoffPending: contract.providerService.handoff.state === "handoff-pending" ? 1 : 0,
      providerSyncSequence: contract.providerService.sync.sequence,
      clientActionPanelVisibleActions: clientState.clientActionPanel.secondaryActions.length + 1,
      clientActionPanelDisabledActions: clientState.clientActionPanel.disabledActions.length,
      clientActionPanelPrimaryEnabled: clientState.clientActionPanel.primaryAction.enabled ? 1 : 0
    },
    reporting: {
      reportId: clientState.reportingState.reportId,
      reportSequence: clientState.reportingState.reportSequence,
      reportingWindow: clientState.reportingState.reportingWindow,
      previousReportId: clientState.reportingState.previousReportId,
      previousSnapshotId: clientState.reportingState.previousSnapshotId,
      historyWatermark: clientState.reportingState.historyWatermark,
      nextWatermark: clientState.reportingState.nextWatermark,
      readyExportCount: clientState.reportingState.readyExportCount,
      blockedExportCount: clientState.reportingState.blockedExportCount,
      currentCounters: clientState.reportingState.currentCounters,
      cumulativeCounters: clientState.reportingState.cumulativeCounters,
      exportCounters: clientState.reportingState.exportCounters
    },
    progress: {
      currentPercent: clientState.progress,
      previousPercent: latestHistoricalProgress,
      deltaPercent: clientState.progress - latestHistoricalProgress,
      completionRatio: actionTotal === 0 ? 0 : contract.completedActions.length / actionTotal
    },
    health: {
      status: contract.operationalHealth.status,
      failureState: contract.operationalHealth.failureState,
      degradedMode: contract.operationalHealth.degradedMode,
      retryable: contract.operationalHealth.retry.retryable,
      retryAfterMs: contract.operationalHealth.retry.retryAfterMs,
      circuitOpen: contract.operationalHealth.retry.circuitOpen,
      remediationMode: contract.operationalHealth.remediation.mode,
      remediationAction: contract.operationalHealth.remediation.action,
      dispatchGateStatus: clientState.operationalHealth.dispatchGate.status,
      dispatchGateMode: clientState.operationalHealth.dispatchGate.dispatchMode,
      dispatchGateBlockers: clientState.operationalHealth.dispatchGate.blockingCodes.length
    },
    providerService: {
      capabilityDecision: contract.providerService.capabilityDecision,
      negotiatedCapabilities: contract.providerService.negotiatedCapabilities.length,
      missingCapabilities: contract.providerService.missingCapabilities.length,
      optionalAccepted: contract.providerService.optionalAccepted.length,
      syncMode: contract.providerService.sync.mode,
      handoffState: contract.providerService.handoff.state,
      handoffDeliveryMode: contract.providerService.handoff.deliveryMode,
      syncConflictPolicy: contract.providerService.sync.conflictPolicy,
      syncSequence: contract.providerService.sync.sequence
    },
    lifecycle: {
      enabled: contract.lifecycle.settings.enabled,
      paused: contract.lifecycle.settings.paused,
      maintenanceMode: contract.lifecycle.settings.maintenanceMode,
      scheduleMode: contract.lifecycle.schedule.mode,
      nextAction: contract.lifecycle.nextAction,
      nextActionReason: contract.lifecycle.nextActionReason,
      controlAction: contract.lifecycle.controlCommand.action,
      changedEnabled: contract.lifecycle.controlCommand.changedEnabled,
      changedPaused: contract.lifecycle.controlCommand.changedPaused,
      earliestDispatchAt: contract.lifecycle.schedule.earliestDispatchAt,
      nextScheduledAt: contract.lifecycle.schedule.nextScheduledAt,
      leaseMs: contract.lifecycle.schedule.leaseMs,
      validationCodes: contract.lifecycle.validation.map((item) => item.code),
      blockerCount: contract.lifecycle.blockers.length,
      concurrencyUtilization: contract.lifecycle.settings.activeRuns / contract.lifecycle.settings.concurrencyLimit
    },
    persistence: {
      effect: clientState.persistedStateWritePlan.effect,
      operation: clientState.persistedStateWritePlan.writePolicy.operation,
      recoveryMode: clientState.persistedStateWritePlan.restart.recoveryMode,
      recoveryPolicy: clientState.persistedStateWritePlan.restart.policy,
      recoveryBlockers: clientState.persistedStateWritePlan.restart.recoveryBlockers,
      ledgerMatched: clientState.persistedStateWritePlan.restart.ledgerMatched,
      commandLedgerSize: clientState.persistedStateWritePlan.durableState.commandLedger.length,
      restartSafe: clientState.persistedStateWritePlan.restart.restartSafe,
      storageKey: clientState.persistedStateWritePlan.storageKey,
      expectedRevision: clientState.persistedStateWritePlan.writePolicy.expectedRevision,
      nextRevision: clientState.persistedStateWritePlan.writePolicy.nextRevision
    },
    previewAcceptance: {
      readiness: clientState.previewAcceptance.readiness,
      accepted: clientState.previewAcceptance.accepted,
      acceptanceState: clientState.previewAcceptance.acceptanceState,
      acceptanceMode: clientState.previewAcceptance.acceptanceMode,
      acceptanceRequired: clientState.previewAcceptance.acceptanceControl.required,
      validationStatus: clientState.previewAcceptance.validationSummary.status,
      dispatchEligible: clientState.previewAcceptance.readinessGates.dispatchEligible,
      clientAccepted: clientState.previewAcceptance.readinessGates.clientAccepted,
      previewRoute: clientState.previewAcceptance.routeTargets.preview.route,
      acceptRoute: clientState.previewAcceptance.routeTargets.accept.route,
      nextStepActions: clientState.previewAcceptance.nextSteps.map((step) => step.action),
      nextStepTargets: clientState.previewAcceptance.nextSteps.map((step) => step.target)
    },
    clientRuntime: {
      handoffTarget: contract.clientRuntime.handoffTarget,
      urgency: contract.clientRuntime.urgency,
      stateMode: contract.clientRuntime.view.stateMode,
      expectedRevision: contract.clientRuntime.continuity.expectedRevision,
      lastSeenRevision: contract.clientRuntime.continuity.lastSeenRevision,
      stale: contract.clientRuntime.continuity.stale,
      receiptRequired: contract.clientRuntime.receipt.required,
      blockerCount: contract.clientRuntime.blockers.length
    },
    clientActionPanel: {
      state: clientState.clientActionPanel.state,
      primaryAction: clientState.clientActionPanel.primaryAction.action,
      primaryEnabled: clientState.clientActionPanel.primaryAction.enabled,
      visibleActions: clientState.clientActionPanel.secondaryActions.length + 1,
      disabledActions: clientState.clientActionPanel.disabledActions.length,
      constrainedByPolicy: contract.clientRuntime.actionPolicy.allowedActions.length > 0
    },
    boundaries: {
      isolationMode: contract.boundary.isolationMode,
      boundaryDecision: contract.boundary.boundaryDecision,
      missingPermissionCount: contract.boundary.missingPermissions.length,
      tenantAuthorized: contract.boundary.hasTenantAccess,
      workspaceAuthorized: contract.boundary.hasWorkspaceAccess,
      persistedBoundaryMatches: contract.boundary.samePersistedBoundary,
      explicitTenantScope: contract.boundary.explicitTenantScope,
      explicitWorkspaceScope: contract.boundary.explicitWorkspaceScope,
      auditPartitionKey: contract.boundary.auditPartitionKey,
      storagePartitionKey: contract.boundary.storagePartitionKey
    },
    blockersByKind,
    eventTypeCounts
  };
}

function buildTimeline(contract, clientState, auditTrail, historySnapshots) {
  const historyEvents = historySnapshots.map((snapshot) => ({
    type: "workflow-package.history.snapshot",
    at: snapshot.capturedAt || clientState.generatedAt,
    revision: snapshot.revision,
    status: snapshot.status,
    progress: snapshot.progress,
    blockerCount: snapshot.blockerCount,
    persistenceEffect: snapshot.persistenceEffect || "historical",
    recoveryMode: snapshot.recoveryMode || "historical"
  }));
  const reportingEvents = [
    {
      type: "workflow-package.reporting.watermark",
      at: clientState.generatedAt,
      sequence: 0,
      reportId: clientState.reportingState.reportId,
      status: clientState.reportingState.blockedExportCount ? "exports-blocked" : "exports-ready",
      readyExportCount: clientState.reportingState.readyExportCount,
      blockedExportCount: clientState.reportingState.blockedExportCount,
      nextWatermark: clientState.reportingState.nextWatermark
    }
  ];
  const auditEvents = auditTrail.map((event, index) => ({
    type: event.type,
    at: event.at,
    sequence: index + 1,
    status: event.status || event.isolationMode || event.code || "recorded"
  }));

  return {
    workflowId: contract.workflowId,
    generatedAt: clientState.generatedAt,
    currentStatus: clientState.nextHandoff.status,
    reportingState: clientState.reportingState.timelineState,
    entries: [...historyEvents, ...reportingEvents, ...auditEvents].sort((left, right) => {
      const leftAt = left.at || "";
      const rightAt = right.at || "";
      return leftAt.localeCompare(rightAt) || (left.sequence || 0) - (right.sequence || 0);
    })
  };
}

function buildExportSummary(
  contract,
  clientState,
  handoffProof,
  kernelCommandEnvelope,
  analyticsReport,
  historySnapshots,
  timeline
) {
  const availableExports = {
    clientState: Boolean(clientState),
    auditTrail: contract.exports.includes("auditTrail"),
    handoffProof: Boolean(handoffProof),
    kernelCommandEnvelope: contract.exports.includes("kernelCommandEnvelope"),
    analyticsReport: contract.exports.includes("analyticsReport"),
    historySnapshots: contract.exports.includes("historySnapshots"),
    exportSummary: contract.exports.includes("exportSummary"),
    timeline: contract.exports.includes("timeline")
  };

  return {
    workflowId: contract.workflowId,
    tenantId: contract.boundary.tenantId,
    workspaceId: contract.boundary.workspaceId,
    generatedAt: clientState.generatedAt,
    requestedExports: contract.exports,
    availableExports,
    counts: {
      auditEvents: handoffProof.auditEventCount,
      historySnapshots: historySnapshots.length,
      timelineEntries: timeline.entries.length,
      analyticsCounters: Object.keys(analyticsReport.counters).length,
      commandOutputContracts: kernelCommandEnvelope.outputContracts.length,
      integrationBlockers: kernelCommandEnvelope.dispatch.integrationBlockers.length,
    activeHealthIncidents: contract.operationalHealth.activeIncidents.length,
    negotiatedProviderCapabilities: contract.providerService.negotiatedCapabilities.length,
    missingProviderCapabilities: contract.providerService.missingCapabilities.length,
    providerHandoffPending: contract.providerService.handoff.state === "handoff-pending" ? 1 : 0,
    providerSyncSequence: contract.providerService.sync.sequence,
    stateWritePlanned: kernelCommandEnvelope.stateContract.writePolicy.operation === "compare-and-swap" ? 1 : 0,
      lifecycleBlockers: contract.lifecycle.blockers.length,
      clientRuntimeBlockers: contract.clientRuntime.blockers.length,
      staleClientRuntimeRevisions: contract.clientRuntime.continuity.stale ? 1 : 0,
      recoveryBlockers: contract.persistedRecovery.blockers.length,
      commandLedgerEntries: clientState.persistedStateWritePlan.durableState.commandLedger.length,
      previewValidationFailures: clientState.previewAcceptance.validationSummary.failureCount,
      previewValidationWarnings: clientState.previewAcceptance.validationSummary.warningCount,
      previewNextSteps: clientState.previewAcceptance.nextSteps.length,
      previewAcceptanceRequired: clientState.previewAcceptance.acceptanceControl.required ? 1 : 0,
      previewAccepted: clientState.previewAcceptance.accepted ? 1 : 0,
      lifecycleValidationWarnings: contract.lifecycle.validation.filter((item) => item.severity === "warning").length,
      lifecycleControlMutations: contract.lifecycle.controlCommand.mutatesLifecycle ? 1 : 0,
      clientActionPanelVisibleActions: clientState.clientActionPanel.secondaryActions.length + 1,
      clientActionPanelDisabledActions: clientState.clientActionPanel.disabledActions.length,
      clientActionPanelPrimaryEnabled: clientState.clientActionPanel.primaryAction.enabled ? 1 : 0
    },
    reporting: {
      reportId: clientState.reportingState.reportId,
      reportSequence: clientState.reportingState.reportSequence,
      reportingWindow: clientState.reportingState.reportingWindow,
      previousReportId: clientState.reportingState.previousReportId,
      previousSnapshotId: clientState.reportingState.previousSnapshotId,
      nextWatermark: clientState.reportingState.nextWatermark,
      readyExportCount: clientState.reportingState.readyExportCount,
      blockedExportCount: clientState.reportingState.blockedExportCount,
      cumulativeCounters: clientState.reportingState.cumulativeCounters,
      exportCounters: clientState.reportingState.exportCounters
    },
    proofId: handoffProof.proofId,
    envelopeId: kernelCommandEnvelope.envelopeId,
    dispatchStatus: kernelCommandEnvelope.dispatch.status,
    dispatchReason: kernelCommandEnvelope.dispatch.reason,
    persistenceEffect: kernelCommandEnvelope.stateContract.persistenceEffect,
    stateWriteOperation: kernelCommandEnvelope.stateContract.writePolicy.operation,
    recoveryMode: kernelCommandEnvelope.stateContract.recovery.mode,
    recoveryPolicy: kernelCommandEnvelope.stateContract.recovery.policy,
    commandLedgerEntries: kernelCommandEnvelope.stateContract.commandLedger.length,
    externalHandoffState: kernelCommandEnvelope.externalHandoff.state,
    externalHandoffSubject: kernelCommandEnvelope.externalHandoff.subject,
    externalHandoffAuthMode: kernelCommandEnvelope.externalHandoff.authMode,
    externalHandoffRequiresSignedProof: kernelCommandEnvelope.externalHandoff.requiresSignedProof,
    providerSyncConflictPolicy: kernelCommandEnvelope.externalHandoff.syncConflictPolicy,
    clientHandoffTarget: contract.clientRuntime.handoffTarget,
    clientRuntimeStateMode: contract.clientRuntime.view.stateMode,
    clientRuntimeStale: contract.clientRuntime.continuity.stale,
    userVisibleHandoffStatus: clientState.userVisibleWorkflowHandoff.status,
    userVisiblePrimaryAction: clientState.userVisibleWorkflowHandoff.primaryAction,
    userVisiblePrimaryActionRoute: clientState.userVisibleWorkflowHandoff.primaryActionRoute,
    clientActionPanelState: clientState.clientActionPanel.state,
    clientActionPanelDisabledActions: clientState.clientActionPanel.disabledActions.map((entry) => entry.action),
    clientActionPanelRouteBindings: clientState.clientActionPanel.routeBindings,
    previewReadiness: clientState.previewAcceptance.readiness,
    previewAccepted: clientState.previewAcceptance.accepted,
    previewAcceptanceState: clientState.previewAcceptance.acceptanceState,
    previewAcceptanceRequired: clientState.previewAcceptance.acceptanceControl.required,
    previewAcceptRoute: clientState.previewAcceptance.routeTargets.accept.route,
    previewNextStepTargets: clientState.previewAcceptance.nextSteps.map((step) => step.target),
    previewValidationStatus: clientState.previewAcceptance.validationSummary.status,
    lifecycleNextAction: contract.lifecycle.nextAction,
    lifecycleNextActionReason: contract.lifecycle.nextActionReason,
    lifecycleControlAction: contract.lifecycle.controlCommand.action,
    lifecycleValidationCodes: contract.lifecycle.validation.map((item) => item.code),
    lifecycleScheduleMode: contract.lifecycle.schedule.mode,
    lifecycleEarliestDispatchAt: contract.lifecycle.schedule.earliestDispatchAt,
    lifecycleNextScheduledAt: contract.lifecycle.schedule.nextScheduledAt,
    healthRemediationMode: contract.operationalHealth.remediation.mode,
    healthRemediationAction: contract.operationalHealth.remediation.action,
    healthCircuitOpen: contract.operationalHealth.retry.circuitOpen,
    dispatchGateStatus: kernelCommandEnvelope.dispatch.gate.status,
    dispatchGateMode: kernelCommandEnvelope.dispatch.gate.dispatchMode,
    dispatchGateBlockers: kernelCommandEnvelope.dispatch.gate.blockingCodes,
    dispatchOperatorActions: kernelCommandEnvelope.dispatch.gate.operatorActions,
    exportReadiness: clientState.reportingState.exportReadiness,
    exportReady: contract.blockers.length === 0 && contract.boundary.isolationMode !== "boundary-review",
    blockedReasons: uniqueStringList([
      ...contract.blockers,
      ...contract.clientRuntime.blockers,
      ...contract.boundary.missingPermissions.map((permission) => `permission-missing:${permission}`),
      ...kernelCommandEnvelope.dispatch.integrationBlockers
    ])
  };
}

export function describeWorkflowPackageSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  const contract = normalizeWorkflowRequest(input);
  const clientState = buildClientState(contract, now);
  const auditTrail = buildAuditTrail(contract, now, evidence, clientState);
  const handoffProof = buildHandoffProof(contract, clientState, auditTrail);
  const kernelCommandEnvelope = buildKernelCommandEnvelope(contract, clientState, handoffProof, now);
  const historySnapshots = buildHistorySnapshots(contract, clientState, now);
  const analyticsReport = buildAnalyticsReport(contract, clientState, auditTrail, historySnapshots);
  const timeline = buildTimeline(contract, clientState, auditTrail, historySnapshots);
  const exportSummary = buildExportSummary(
    contract,
    clientState,
    handoffProof,
    kernelCommandEnvelope,
    analyticsReport,
    historySnapshots,
    timeline
  );

  return {
    ok: true,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract,
    clientState,
    auditTrail,
    handoffProof,
    kernelCommandEnvelope,
    analyticsReport,
    historySnapshots,
    exportSummary,
    timeline,
    evidence
  };
}

export default describeWorkflowPackageSurface;
