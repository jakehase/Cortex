export const surfaceId = "aios_capability-security_revocation_014";
export const surfaceGroup = "capability-security";
export const surfaceName = "revocation";

const lifecycleCommands = new Set([
  "inspect",
  "enable",
  "disable",
  "schedule",
  "revoke",
  "restore"
]);

const revocationReasons = new Set([
  "operator_request",
  "capability_expired",
  "policy_violation",
  "credential_rotated",
  "incident_response"
]);

const providerContractKinds = new Set([
  "hosted-kernel",
  "identity-provider",
  "secrets-vault",
  "policy-engine",
  "audit-sink",
  "external-service"
]);

const providerHandoffCommands = new Set([
  "disable",
  "schedule",
  "revoke",
  "restore"
]);

const providerHealthStates = new Set([
  "healthy",
  "degraded",
  "outage",
  "unknown"
]);

const retryableFailureStates = new Set([
  "pending",
  "ready-for-handoff",
  "replaying",
  "failed"
]);

const providerFailureCategories = new Set([
  "auth",
  "configuration",
  "rate_limit",
  "network",
  "provider_outage",
  "proof_rejected",
  "unknown"
]);

const activeScheduledStatuses = new Set([
  "pending",
  "ready-for-handoff",
  "ready-for-commit",
  "needs-proof",
  "replaying",
  "scheduled"
]);

const clientContinuationStatuses = new Set([
  "draft",
  "blocked",
  "needs-proof",
  "ready-for-handoff",
  "ready-for-commit",
  "degraded-checkpoint",
  "replaying",
  "completed",
  "abandoned"
]);

const providerProofModes = new Set([
  "none",
  "operator-attestation",
  "signed-proof",
  "kernel-ledger-proof"
]);

const providerSyncDirections = new Set([
  "pull",
  "push",
  "bidirectional",
  "none"
]);

const analyticsExportFormats = new Set([
  "json",
  "csv",
  "ndjson"
]);

const analyticsExportColumns = new Set([
  "occurredAt",
  "eventType",
  "operationKey",
  "command",
  "status",
  "providerId",
  "tenantId",
  "workspaceId",
  "capabilityId",
  "retryAttemptCount"
]);

const providerPreflightFields = new Set([
  "tenantId",
  "workspaceId",
  "capabilityId",
  "reason",
  "proofId",
  "externalCorrelationId",
  "idempotencyKey",
  "operationKey",
  "scheduleAt"
]);

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asStringList(value, fallback = []) {
  const source = Array.isArray(value) ? value : fallback;
  return [...new Set(source.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()))];
}

function asIso(value, fallback) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number)) {
    return fallback;
  }
  return Math.min(Math.max(number, min), max);
}

function lowerToken(value) {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : "";
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(asObject(object), key);
}

function requestFieldSupplied(object, key) {
  return hasOwn(object, key) && object[key] !== null && object[key] !== undefined && object[key] !== "";
}

function suppliedFieldValue(object, key) {
  const value = asObject(object)[key];
  return typeof value === "string" ? value.trim() : value;
}

function buildRequestNormalizationReport(input, request, normalizedRequest) {
  const issues = [];
  const rawCommand = suppliedFieldValue(request, "command");
  const rawReason = suppliedFieldValue(request, "reason");
  const rawProofMode = suppliedFieldValue(request, "proofMode");
  const rawScheduleAt = suppliedFieldValue(request, "scheduleAt");
  const rawTenantId = suppliedFieldValue(request, "tenantId");
  const rawWorkspaceId = suppliedFieldValue(request, "workspaceId");
  const rootTenantId = suppliedFieldValue(input, "tenantId");
  const rootWorkspaceId = suppliedFieldValue(input, "workspaceId");

  if (requestFieldSupplied(request, "command") && !lifecycleCommands.has(rawCommand)) {
    issues.push({
      severity: "error",
      code: "unsupported_revocation_command",
      field: "request.command",
      suppliedValue: rawCommand,
      normalizedValue: normalizedRequest.command,
      message: `Unsupported revocation command '${rawCommand}' was normalized to inspect for preview only`
    });
  }
  if (!requestFieldSupplied(request, "command")) {
    issues.push({
      severity: "info",
      code: "defaulted_revocation_command",
      field: "request.command",
      suppliedValue: null,
      normalizedValue: normalizedRequest.command,
      message: "No command was supplied; inspect is used as the read-only default"
    });
  }
  if (requestFieldSupplied(request, "reason") && !revocationReasons.has(rawReason)) {
    issues.push({
      severity: "error",
      code: "unsupported_revocation_reason",
      field: "request.reason",
      suppliedValue: rawReason,
      normalizedValue: normalizedRequest.reason,
      message: `Unsupported revocation reason '${rawReason}' was not accepted`
    });
  }
  if (requestFieldSupplied(request, "proofMode") && !providerProofModes.has(rawProofMode)) {
    issues.push({
      severity: "warning",
      code: "unsupported_provider_proof_mode",
      field: "request.proofMode",
      suppliedValue: rawProofMode,
      normalizedValue: normalizedRequest.proofMode,
      message: `Unsupported proof mode '${rawProofMode}' was normalized from proof presence`
    });
  }
  if (requestFieldSupplied(request, "scheduleAt") && !normalizedRequest.scheduleAt) {
    issues.push({
      severity: normalizedRequest.command === "schedule" ? "error" : "warning",
      code: "invalid_schedule_timestamp",
      field: "request.scheduleAt",
      suppliedValue: rawScheduleAt,
      normalizedValue: normalizedRequest.scheduleAt,
      message: "scheduleAt must be a parseable timestamp before it can drive revocation scheduling"
    });
  }
  if (!rawTenantId && rootTenantId) {
    issues.push({
      severity: "info",
      code: "inherited_tenant_boundary",
      field: "request.tenantId",
      suppliedValue: null,
      normalizedValue: normalizedRequest.tenantId,
      message: "tenantId was inherited from the root request boundary"
    });
  }
  if (!rawWorkspaceId && rootWorkspaceId) {
    issues.push({
      severity: "info",
      code: "inherited_workspace_boundary",
      field: "request.workspaceId",
      suppliedValue: null,
      normalizedValue: normalizedRequest.workspaceId,
      message: "workspaceId was inherited from the root request boundary"
    });
  }

  return {
    contractVersion: "revocation-request-normalization-v1",
    acceptedCommands: [...lifecycleCommands],
    acceptedReasons: [...revocationReasons],
    acceptedProofModes: [...providerProofModes],
    issueCount: issues.length,
    errorCount: issues.filter((issue) => issue.severity === "error").length,
    warningCount: issues.filter((issue) => issue.severity === "warning").length,
    defaultedCommand: !requestFieldSupplied(request, "command"),
    commandWasCoerced: requestFieldSupplied(request, "command") && rawCommand !== normalizedRequest.command,
    reasonWasRejected: requestFieldSupplied(request, "reason") && rawReason !== normalizedRequest.reason,
    proofModeWasCoerced: requestFieldSupplied(request, "proofMode") && rawProofMode !== normalizedRequest.proofMode,
    scheduleAtWasRejected: requestFieldSupplied(request, "scheduleAt") && !normalizedRequest.scheduleAt,
    boundaryInheritedFromRoot: {
      tenantId: !rawTenantId && Boolean(rootTenantId),
      workspaceId: !rawWorkspaceId && Boolean(rootWorkspaceId)
    },
    issues
  };
}

function normalizeWorkspacePermissionGrants(value, actorRoles, fallbackWorkspaceIds) {
  const objectGrants = asObject(value);
  const source = Array.isArray(value)
    ? value
    : Object.entries(objectGrants).map(([workspaceId, grant]) => ({
        ...asObject(grant),
        workspaceId
      }));
  const normalized = source
    .map((grant) => {
      const entry = asObject(grant);
      const workspaceId = typeof entry.workspaceId === "string" && entry.workspaceId.trim()
        ? entry.workspaceId.trim()
        : null;
      const tenantId = typeof entry.tenantId === "string" && entry.tenantId.trim()
        ? entry.tenantId.trim()
        : null;
      const roles = asStringList(entry.roles, actorRoles);
      const commands = asStringList(entry.commands ?? entry.allowedCommands, [...lifecycleCommands])
        .filter((command) => lifecycleCommands.has(command));

      if (!workspaceId) {
        return null;
      }

      return {
        workspaceId,
        tenantId,
        roles,
        scopes: asStringList(entry.scopes ?? entry.permissions, scopesForRoles(roles)),
        deniedScopes: asStringList(entry.deniedScopes),
        commands: commands.length ? commands : [...lifecycleCommands],
        deniedCommands: asStringList(entry.deniedCommands).filter((command) => lifecycleCommands.has(command))
      };
    })
    .filter(Boolean);

  if (normalized.length) {
    return normalized;
  }

  return fallbackWorkspaceIds.map((workspaceId) => ({
    workspaceId,
    tenantId: null,
    roles: actorRoles,
    scopes: scopesForRoles(actorRoles),
    deniedScopes: [],
    commands: [...lifecycleCommands],
    deniedCommands: []
  }));
}

function classifyProviderFailure(report = {}, existing = null) {
  const code = lowerToken(report.failureCode ?? report.errorCode ?? existing?.failureCode);
  const message = lowerToken(report.lastError ?? existing?.lastError);
  const category = providerFailureCategories.has(report.failureCategory)
    ? report.failureCategory
    : code.includes("auth") || code.includes("401") || code.includes("403") || message.includes("unauthorized")
      ? "auth"
      : code.includes("config") || message.includes("misconfigured")
        ? "configuration"
        : code.includes("rate") || code.includes("429") || message.includes("rate limit")
          ? "rate_limit"
          : code.includes("proof") || message.includes("proof")
            ? "proof_rejected"
            : code.includes("timeout") || code.includes("network") || message.includes("timeout")
              ? "network"
              : report.state === "outage"
                ? "provider_outage"
                : "unknown";
  const retryable = ["rate_limit", "network", "provider_outage", "unknown"].includes(category);

  return {
    category,
    retryable,
    operatorAction: {
      auth: "refresh_provider_credentials",
      configuration: "repair_provider_contract",
      rate_limit: "wait_for_retry_window",
      network: "check_provider_connectivity",
      provider_outage: "monitor_provider_recovery",
      proof_rejected: "attach_valid_provider_proof",
      unknown: "review_provider_failure"
    }[category],
    route: {
      auth: "/capability-security/revocation/providers/credentials",
      configuration: "/capability-security/revocation/providers/contracts",
      rate_limit: "/capability-security/revocation/retry",
      network: "/capability-security/revocation/health",
      provider_outage: "/capability-security/revocation/health",
      proof_rejected: "/capability-security/revocation/proof",
      unknown: "/capability-security/revocation/recovery/review"
    }[category]
  };
}

function buildProviderCircuit(report = {}, retryPolicy = {}, now) {
  const consecutiveFailures = boundedInteger(report.consecutiveFailures, report.state === "healthy" ? 0 : 1, 0, 1000);
  const threshold = boundedInteger(retryPolicy.circuitBreakerFailureThreshold, 3, 1, 50);
  const cooldownSeconds = boundedInteger(retryPolicy.circuitBreakerCooldownSeconds, 300, 30, 86400);
  const forcedOpen = report.circuitOpen === true || report.circuitState === "open";
  const halfOpen = report.circuitState === "half-open";
  const open = forcedOpen || report.state === "outage" || consecutiveFailures >= threshold;
  const openedAt = asIso(report.circuitOpenedAt ?? report.lastFailureAt, open ? now : null);
  const retryAfterSeconds = boundedInteger(report.retryAfterSeconds, 0, 0, 86400);
  const cooldownUntil = open
    ? new Date(Date.parse(openedAt || now) + Math.max(cooldownSeconds, retryAfterSeconds) * 1000).toISOString()
    : null;

  return {
    state: open ? "open" : halfOpen ? "half-open" : "closed",
    consecutiveFailures,
    threshold,
    openedAt,
    cooldownSeconds,
    retryAfterSeconds,
    cooldownUntil,
    allowsProbe: halfOpen || (open && cooldownUntil && Date.parse(cooldownUntil) <= Date.parse(now))
  };
}

function defaultScopesForCommand(command) {
  if (command === "inspect") {
    return ["revocation:read"];
  }
  if (command === "restore") {
    return ["revocation:write", "capability:restore"];
  }
  if (command === "revoke") {
    return ["revocation:write", "capability:revoke"];
  }
  if (command === "schedule") {
    return ["revocation:write", "revocation:schedule"];
  }
  return ["revocation:write"];
}

function scopesForRoles(roles) {
  const scopes = new Set();

  for (const role of roles) {
    if (role === "tenant-admin" || role === "capability-admin") {
      ["revocation:read", "revocation:write", "capability:revoke", "capability:restore", "revocation:schedule"].forEach((scope) => scopes.add(scope));
    } else if (role === "revocation-operator") {
      ["revocation:read", "revocation:write", "capability:revoke", "revocation:schedule"].forEach((scope) => scopes.add(scope));
    } else if (role === "revocation-scheduler") {
      ["revocation:read", "revocation:write", "revocation:schedule"].forEach((scope) => scopes.add(scope));
    } else if (role === "audit-reader") {
      scopes.add("revocation:read");
    }
  }

  return [...scopes];
}

function normalizeBoundaryContext(input = {}, request, clientRuntime) {
  const boundary = asObject(input.boundary ?? input.tenantBoundary ?? input.authorization);
  const resource = asObject(boundary.resource ?? input.resource ?? input.capability);
  const grants = asObject(boundary.grants ?? input.grants);
  const actor = asObject(boundary.actor);
  const tenantId = typeof request.tenantId === "string" && request.tenantId.trim()
    ? request.tenantId.trim()
    : typeof boundary.tenantId === "string" && boundary.tenantId.trim()
      ? boundary.tenantId.trim()
      : "hosted-kernel-tenant";
  const workspaceId = typeof request.workspaceId === "string" && request.workspaceId.trim()
    ? request.workspaceId.trim()
    : typeof boundary.workspaceId === "string" && boundary.workspaceId.trim()
      ? boundary.workspaceId.trim()
      : "default-workspace";
  const actorTenantId = typeof actor.tenantId === "string" && actor.tenantId.trim()
    ? actor.tenantId.trim()
    : typeof boundary.actorTenantId === "string" && boundary.actorTenantId.trim()
      ? boundary.actorTenantId.trim()
      : tenantId;
  const actorWorkspaceIds = asStringList(actor.workspaceIds ?? boundary.actorWorkspaceIds, [workspaceId]);
  const workspaceAliases = asStringList(boundary.workspaceAliases ?? actor.workspaceAliases);
  const actorRoles = asStringList(actor.roles ?? boundary.actorRoles, request.command === "inspect" ? ["audit-reader"] : ["revocation-operator"]);
  const grantedScopes = asStringList(grants.scopes ?? boundary.grantedScopes ?? boundary.permissions, scopesForRoles(actorRoles));
  const deniedScopes = asStringList(grants.deniedScopes ?? boundary.deniedScopes);
  const globalDeniedCommands = asStringList(grants.deniedCommands ?? boundary.deniedCommands).filter((command) => lifecycleCommands.has(command));
  const resourceTenantId = typeof resource.tenantId === "string" && resource.tenantId.trim() ? resource.tenantId.trim() : tenantId;
  const resourceWorkspaceId = typeof resource.workspaceId === "string" && resource.workspaceId.trim() ? resource.workspaceId.trim() : workspaceId;
  const visibleWorkspaceIds = asStringList(clientRuntime.visibleWorkspaceIds, actorWorkspaceIds);
  const workspacePermissionGrants = normalizeWorkspacePermissionGrants(
    grants.workspaceGrants ?? boundary.workspaceGrants ?? actor.workspaceGrants,
    actorRoles,
    actorWorkspaceIds
  );
  const matchingWorkspaceGrant = workspacePermissionGrants.find((grant) => (
    (grant.workspaceId === workspaceId || grant.workspaceId === "*" || workspaceAliases.includes(grant.workspaceId))
    && (!grant.tenantId || grant.tenantId === tenantId)
  )) || null;
  const scopedDeniedScopes = [
    ...deniedScopes,
    ...(matchingWorkspaceGrant?.deniedScopes || [])
  ];
  const effectiveScopes = [
    ...new Set([
      ...grantedScopes,
      ...(matchingWorkspaceGrant?.scopes || [])
    ])
  ].filter((scope) => !scopedDeniedScopes.includes(scope));
  const missingScopes = request.requiredScopes.filter((scope) => !effectiveScopes.includes(scope));
  const workspaceAllowed = actorWorkspaceIds.includes(workspaceId)
    || actorWorkspaceIds.includes("*")
    || workspaceAliases.includes(workspaceId)
    || Boolean(matchingWorkspaceGrant);
  const resourceInBoundary = resourceTenantId === tenantId
    && (resourceWorkspaceId === workspaceId || workspaceAliases.includes(resourceWorkspaceId));
  const commandAllowedByWorkspace = Boolean(matchingWorkspaceGrant)
    ? matchingWorkspaceGrant.commands.includes(request.command) && !matchingWorkspaceGrant.deniedCommands.includes(request.command)
    : true;
  const commandDenied = globalDeniedCommands.includes(request.command) || !commandAllowedByWorkspace;
  const adoptUnscopedClientWork = boundary.adoptUnscopedClientWork === true
    || asObject(boundary.unscopedClientWork).adopt === true;

  return {
    contractVersion: typeof boundary.contractVersion === "string" && boundary.contractVersion.trim()
      ? boundary.contractVersion.trim()
      : "revocation-tenant-boundary-v1",
    tenantId,
    workspaceId,
    actorTenantId,
    actorWorkspaceIds,
    workspaceAliases,
    actorRoles,
    grantedScopes,
    deniedScopes,
    scopedDeniedScopes,
    effectiveScopes,
    missingScopes,
    visibleWorkspaceIds,
    workspacePermissionGrants,
    selectedWorkspaceGrant: matchingWorkspaceGrant,
    deniedCommands: globalDeniedCommands,
    resource: {
      tenantId: resourceTenantId,
      workspaceId: resourceWorkspaceId,
      capabilityId: typeof resource.capabilityId === "string" && resource.capabilityId.trim()
        ? resource.capabilityId.trim()
        : request.capabilityId
    },
    enforcement: {
      actorInTenant: actorTenantId === tenantId,
      workspaceAllowed,
      resourceInBoundary,
      permissionSatisfied: missingScopes.length === 0,
      commandAllowed: !commandDenied,
      adoptUnscopedClientWork: adoptUnscopedClientWork && workspaceAllowed,
      mode: boundary.enforce === false ? "advisory" : "enforced"
    }
  };
}

function normalizeProviderCapabilities(input = {}, kind = "external-service") {
  const capabilities = asObject(input.capabilities ?? input.contractCapabilities);
  const sync = asObject(capabilities.sync ?? input.sync);
  const proofModes = asStringList(capabilities.proofModes, input.requiresProof ? ["signed-proof"] : ["none"])
    .filter((mode) => providerProofModes.has(mode));
  const scopes = asStringList(capabilities.scopes, kind === "hosted-kernel"
    ? ["revocation:read", "revocation:write", "capability:revoke", "capability:restore", "revocation:schedule"]
    : ["revocation:read"]);
  const syncDirection = providerSyncDirections.has(sync.direction)
    ? sync.direction
    : input.externalHandoff === false
      ? "none"
      : "push";

  return {
    contractVersion: typeof capabilities.contractVersion === "string" && capabilities.contractVersion.trim()
      ? capabilities.contractVersion.trim()
      : "revocation-provider-contract-v1",
    scopes,
    proofModes: proofModes.length ? proofModes : ["none"],
    maxBatchSize: boundedInteger(capabilities.maxBatchSize, 1, 1, 1000),
    sync: {
      direction: syncDirection,
      leaseSeconds: boundedInteger(sync.leaseSeconds, 300, 30, 86400),
      ackRequired: sync.ackRequired !== false && syncDirection !== "none",
      supportsCheckpointReplay: sync.supportsCheckpointReplay !== false
    }
  };
}

function normalizeProviderPreflight(input = {}, kind = "external-service") {
  const preflight = asObject(input.preflight ?? input.serviceContract?.preflight);
  const requiredFields = asStringList(preflight.requiredFields, kind === "hosted-kernel"
    ? ["tenantId", "workspaceId", "operationKey", "idempotencyKey"]
    : ["tenantId", "workspaceId", "capabilityId", "externalCorrelationId", "idempotencyKey"])
    .filter((field) => providerPreflightFields.has(field));
  const idempotencyWindowSeconds = boundedInteger(preflight.idempotencyWindowSeconds, 86400, 60, 604800);
  const requiresLeaseAck = preflight.requiresLeaseAck === true;
  const requiresCursorOnReplay = preflight.requiresCursorOnReplay === true;

  return {
    contractVersion: typeof preflight.contractVersion === "string" && preflight.contractVersion.trim()
      ? preflight.contractVersion.trim()
      : "revocation-provider-preflight-v1",
    requiredFields: requiredFields.length ? requiredFields : ["tenantId", "workspaceId"],
    idempotencyWindowSeconds,
    requiresLeaseAck,
    requiresCursorOnReplay,
    acceptsExternalCorrelationId: preflight.acceptsExternalCorrelationId !== false,
    replayTokenScope: ["operation", "provider", "tenant"].includes(preflight.replayTokenScope)
      ? preflight.replayTokenScope
      : "operation"
  };
}

function normalizeSettings(settingsInput = {}) {
  const settings = asObject(settingsInput);
  const scheduling = asObject(settings.scheduling);
  const controls = asObject(settings.controls);
  const retentionDays = Number(settings.auditRetentionDays ?? 90);
  const reviewMinutes = Number(scheduling.reviewEveryMinutes ?? 15);
  const maxScheduledRevocations = Number(scheduling.maxScheduledRevocations ?? 250);

  return {
    enabled: settings.enabled !== false,
    requireReason: settings.requireReason !== false,
    auditRetentionDays: Number.isInteger(retentionDays) && retentionDays >= 7 && retentionDays <= 365
      ? retentionDays
      : 90,
    controls: {
      allowManualDisable: controls.allowManualDisable !== false,
      allowRestore: controls.allowRestore !== false,
      requireProofBeforeRevoke: controls.requireProofBeforeRevoke !== false,
      allowDisableWithPending: controls.allowDisableWithPending === true
    },
    scheduling: {
      enabled: scheduling.enabled !== false,
      reviewEveryMinutes: Number.isInteger(reviewMinutes) && reviewMinutes >= 5 && reviewMinutes <= 1440
        ? reviewMinutes
        : 15,
      maxScheduledRevocations: Number.isInteger(maxScheduledRevocations) && maxScheduledRevocations >= 1
        ? maxScheduledRevocations
        : 250
    }
  };
}

function normalizeProviderContract(input = {}, index = 0) {
  const contract = asObject(input);
  const kind = providerContractKinds.has(contract.kind) ? contract.kind : "external-service";
  const providerId = typeof contract.providerId === "string" && contract.providerId.trim()
    ? contract.providerId.trim()
    : `${kind}-${index + 1}`;
  const supportedCommands = asStringList(contract.supportedCommands, ["inspect"])
    .filter((command) => lifecycleCommands.has(command));
  const supportedReasons = asStringList(contract.supportedReasons, [...revocationReasons])
    .filter((reason) => revocationReasons.has(reason));
  const endpoint = asObject(contract.endpoint);
  const sync = asObject(contract.sync);
  const capabilities = normalizeProviderCapabilities(contract, kind);
  const preflight = normalizeProviderPreflight(contract, kind);

  return {
    providerId,
    kind,
    service: typeof contract.service === "string" && contract.service.trim() ? contract.service.trim() : providerId,
    endpoint: {
      route: typeof endpoint.route === "string" && endpoint.route.trim()
        ? endpoint.route.trim()
        : `/capability-security/revocation/providers/${providerId}`,
      method: typeof endpoint.method === "string" && endpoint.method.trim()
        ? endpoint.method.trim().toUpperCase()
        : "POST"
    },
    supportedCommands,
    supportedReasons,
    sync: {
      cursor: typeof sync.cursor === "string" && sync.cursor.trim() ? sync.cursor.trim() : null,
      lastSyncedAt: asIso(sync.lastSyncedAt, null),
      watermark: typeof sync.watermark === "string" && sync.watermark.trim() ? sync.watermark.trim() : null,
      direction: capabilities.sync.direction,
      leaseSeconds: capabilities.sync.leaseSeconds,
      ackRequired: capabilities.sync.ackRequired,
      supportsCheckpointReplay: capabilities.sync.supportsCheckpointReplay
    },
    capabilities,
    preflight,
    externalHandoff: contract.externalHandoff !== false,
    requiresProof: contract.requiresProof === true
  };
}

function normalizeProviderContracts(input = {}) {
  const contractsInput = Array.isArray(input.providerContracts)
    ? input.providerContracts
    : Array.isArray(input.providers)
      ? input.providers
      : [];
  const contracts = contractsInput.map(normalizeProviderContract);

  if (contracts.length) {
    return contracts;
  }

  return [
    normalizeProviderContract({
      providerId: "hosted-kernel-revocation-ledger",
      kind: "hosted-kernel",
      service: "capability-security.revocation",
      supportedCommands: [...lifecycleCommands],
      supportedReasons: [...revocationReasons],
      externalHandoff: false
    })
  ];
}

function buildProviderPreflightRequirement(provider, request, validation, now) {
  const values = {
    tenantId: request.tenantId,
    workspaceId: request.workspaceId,
    capabilityId: request.capabilityId,
    reason: request.reason,
    proofId: request.proofId,
    externalCorrelationId: provider.preflight.acceptsExternalCorrelationId ? request.externalCorrelationId : null,
    idempotencyKey: validation.ok
      ? `${surfaceId}:${request.tenantId || "hosted-kernel-tenant"}:${request.workspaceId || "default-workspace"}:${request.command}:${request.capabilityId || "none"}:${request.requestedAt}`
      : null,
    operationKey: buildRestartSafeOperationKey(request),
    scheduleAt: request.scheduleAt
  };
  const missingFields = provider.preflight.requiredFields.filter((field) => {
    if (field === "reason" && request.command === "restore") {
      return false;
    }
    return values[field] === null || values[field] === undefined || values[field] === "";
  });
  const replayToken = [
    provider.preflight.replayTokenScope,
    provider.providerId,
    request.tenantId || "hosted-kernel-tenant",
    provider.preflight.replayTokenScope === "tenant" ? request.workspaceId || "default-workspace" : request.command,
    provider.preflight.replayTokenScope === "operation" ? values.operationKey : request.capabilityId || "global"
  ].join(":");

  return {
    providerId: provider.providerId,
    contractVersion: provider.preflight.contractVersion,
    requiredFields: provider.preflight.requiredFields,
    missingFields,
    ready: missingFields.length === 0,
    requiresLeaseAck: provider.preflight.requiresLeaseAck,
    requiresCursorOnReplay: provider.preflight.requiresCursorOnReplay,
    idempotencyWindowSeconds: provider.preflight.idempotencyWindowSeconds,
    replayToken,
    expiresAt: new Date(Date.parse(now) + provider.preflight.idempotencyWindowSeconds * 1000).toISOString()
  };
}

function buildProviderIntegration({ request, settings, validation, providerContracts, now }) {
  const commandProviders = providerContracts.filter((provider) => provider.supportedCommands.includes(request.command));
  const reasonProviders = request.reason
    ? commandProviders.filter((provider) => provider.supportedReasons.includes(request.reason))
    : commandProviders;
  const scoredProviders = reasonProviders.map((provider) => {
    const missingScopes = request.requiredScopes.filter((scope) => !provider.capabilities.scopes.includes(scope));
    const preflight = buildProviderPreflightRequirement(provider, request, validation, now);
    const proofModeSupported = provider.capabilities.proofModes.includes(request.proofMode)
      || (!request.proofId && provider.capabilities.proofModes.includes("none"));
    const proofBlocked = provider.requiresProof && !request.proofId;
    const syncReady = provider.externalHandoff === false
      || provider.capabilities.sync.direction === "push"
      || provider.capabilities.sync.direction === "bidirectional";

    return {
      provider,
      missingScopes,
      preflight,
      proofModeSupported,
      proofBlocked,
      syncReady,
      score: [
        missingScopes.length === 0 ? 8 : 0,
        proofModeSupported ? 4 : 0,
        !proofBlocked ? 2 : 0,
        preflight.ready ? 2 : 0,
        syncReady ? 1 : 0,
        provider.kind === "hosted-kernel" ? 1 : 0
      ].reduce((total, value) => total + value, 0)
    };
  });
  const eligibleProviders = reasonProviders.filter((provider) => {
    const candidate = scoredProviders.find((entry) => entry.provider.providerId === provider.providerId);
    if (provider.requiresProof && !request.proofId) {
      return false;
    }
    if (request.requiredScopes.some((scope) => !provider.capabilities.scopes.includes(scope))) {
      return false;
    }
    if (!provider.capabilities.proofModes.includes(request.proofMode) && (request.proofId || !provider.capabilities.proofModes.includes("none"))) {
      return false;
    }
    if (candidate && !candidate.preflight.ready) {
      return false;
    }
    return true;
  }).sort((left, right) => {
    const leftScore = scoredProviders.find((candidate) => candidate.provider.providerId === left.providerId)?.score || 0;
    const rightScore = scoredProviders.find((candidate) => candidate.provider.providerId === right.providerId)?.score || 0;
    return rightScore - leftScore;
  });
  const selectedProvider = eligibleProviders[0] || null;
  const handoffRequired = providerHandoffCommands.has(request.command)
    && validation.ok
    && settings.enabled
    && selectedProvider?.externalHandoff === true;
  const proofBlockedProviders = reasonProviders
    .filter((provider) => provider.requiresProof && !request.proofId)
    .map((provider) => provider.providerId);
  const scopeBlockedProviders = scoredProviders
    .filter((candidate) => candidate.missingScopes.length)
    .map((candidate) => ({
      providerId: candidate.provider.providerId,
      missingScopes: candidate.missingScopes
    }));
  const proofModeBlockedProviders = scoredProviders
    .filter((candidate) => !candidate.proofModeSupported)
    .map((candidate) => candidate.provider.providerId);
  const preflightBlockedProviders = scoredProviders
    .filter((candidate) => !candidate.preflight.ready)
    .map((candidate) => ({
      providerId: candidate.provider.providerId,
      missingFields: candidate.preflight.missingFields,
      requiredFields: candidate.preflight.requiredFields,
      contractVersion: candidate.preflight.contractVersion
    }));
  const selectedPreflight = selectedProvider
    ? scoredProviders.find((candidate) => candidate.provider.providerId === selectedProvider.providerId)?.preflight || null
    : null;
  const handoffLeaseExpiresAt = handoffRequired
    ? new Date(Date.parse(now) + selectedProvider.sync.leaseSeconds * 1000).toISOString()
    : null;

  return {
    negotiation: {
      requestedCommand: request.command,
      requestedReason: request.reason,
      requestedScopes: request.requiredScopes,
      requestedProofMode: request.proofMode,
      matchedProviderCount: commandProviders.length,
      reasonMatchedProviderCount: reasonProviders.length,
      eligibleProviderCount: eligibleProviders.length,
      selectedProviderId: selectedProvider?.providerId || null,
      selectedContractVersion: selectedProvider?.capabilities.contractVersion || null,
      proofBlockedProviders,
      scopeBlockedProviders,
      proofModeBlockedProviders,
      preflightBlockedProviders,
      candidates: scoredProviders.map((candidate) => ({
        providerId: candidate.provider.providerId,
        service: candidate.provider.service,
        contractVersion: candidate.provider.capabilities.contractVersion,
        score: candidate.score,
        missingScopes: candidate.missingScopes,
        missingPreflightFields: candidate.preflight.missingFields,
        preflightContractVersion: candidate.preflight.contractVersion,
        replayToken: candidate.preflight.replayToken,
        proofModeSupported: candidate.proofModeSupported,
        syncReady: candidate.syncReady
      }))
    },
    sync: providerContracts.map((provider) => ({
      providerId: provider.providerId,
      service: provider.service,
      cursor: provider.sync.cursor,
      lastSyncedAt: provider.sync.lastSyncedAt,
      watermark: provider.sync.watermark,
      direction: provider.sync.direction,
      ackRequired: provider.sync.ackRequired,
      leaseSeconds: provider.sync.leaseSeconds,
      supportsCheckpointReplay: provider.sync.supportsCheckpointReplay,
      observedAt: now
    })),
    handoff: {
      required: Boolean(handoffRequired),
      state: handoffRequired
        ? "ready"
        : !validation.ok || (providerHandoffCommands.has(request.command) && !selectedProvider)
          ? "blocked"
          : "local-only",
      providerId: handoffRequired ? selectedProvider.providerId : null,
      route: handoffRequired ? selectedProvider.endpoint.route : null,
      method: handoffRequired ? selectedProvider.endpoint.method : null,
      idempotencyKey: handoffRequired
        ? `${surfaceId}:${request.tenantId || "hosted-kernel-tenant"}:${request.workspaceId || "default-workspace"}:${request.command}:${request.capabilityId || "none"}:${request.requestedAt}`
        : null,
      externalState: handoffRequired
        ? {
            state: "lease-open",
            service: selectedProvider.service,
            contractVersion: selectedProvider.capabilities.contractVersion,
            preflightContractVersion: selectedPreflight?.contractVersion || null,
            leaseExpiresAt: handoffLeaseExpiresAt,
            ackRequired: selectedProvider.sync.ackRequired || selectedPreflight?.requiresLeaseAck === true,
            syncCursor: selectedProvider.sync.cursor,
            syncWatermark: selectedProvider.sync.watermark,
            correlationId: request.externalCorrelationId,
            replayToken: selectedPreflight?.replayToken || null,
            replayTokenExpiresAt: selectedPreflight?.expiresAt || null
          }
        : null,
      payloadContract: selectedProvider
        ? {
            requiredFields: [
              "surfaceId",
              "command",
              ...selectedProvider.preflight.requiredFields
            ],
            missingPreflightFields: selectedPreflight?.missingFields || [],
            scopes: request.requiredScopes,
            proofMode: request.proofMode,
            maxBatchSize: selectedProvider.capabilities.maxBatchSize,
            idempotencyWindowSeconds: selectedProvider.preflight.idempotencyWindowSeconds,
            replayTokenScope: selectedProvider.preflight.replayTokenScope
          }
        : null
    }
  };
}

function normalizeRequest(input, now) {
  const request = asObject(input.request);
  const command = lifecycleCommands.has(request.command) ? request.command : "inspect";
  const reason = revocationReasons.has(request.reason) ? request.reason : null;
  const capabilityId = typeof request.capabilityId === "string" && request.capabilityId.trim()
    ? request.capabilityId.trim()
    : null;
  const scheduleAt = asIso(request.scheduleAt, null);
  const normalizedRequest = {
    command,
    capabilityId,
    tenantId: typeof request.tenantId === "string" && request.tenantId.trim()
      ? request.tenantId.trim()
      : typeof input.tenantId === "string" && input.tenantId.trim()
        ? input.tenantId.trim()
        : null,
    workspaceId: typeof request.workspaceId === "string" && request.workspaceId.trim()
      ? request.workspaceId.trim()
      : typeof input.workspaceId === "string" && input.workspaceId.trim()
        ? input.workspaceId.trim()
        : null,
    reason,
    scheduleAt,
    actor: typeof request.actor === "string" && request.actor.trim() ? request.actor.trim() : "hosted-kernel",
    requestedAt: asIso(request.requestedAt, now),
    proofId: typeof request.proofId === "string" && request.proofId.trim() ? request.proofId.trim() : null,
    proofMode: providerProofModes.has(request.proofMode)
      ? request.proofMode
      : typeof request.proofId === "string" && request.proofId.trim()
        ? "signed-proof"
        : "none",
    requiredScopes: asStringList(request.requiredScopes ?? request.scopes, defaultScopesForCommand(command)),
    overridePending: request.overridePending === true,
    externalCorrelationId: typeof request.externalCorrelationId === "string" && request.externalCorrelationId.trim()
      ? request.externalCorrelationId.trim()
      : `${surfaceId}:${command}:${capabilityId || "global"}:${asIso(request.requestedAt, now)}`
  };

  return {
    ...normalizedRequest,
    normalization: buildRequestNormalizationReport(input, request, normalizedRequest)
  };
}

function normalizePendingRevocation(input = {}, index = 0) {
  const pending = asObject(input);
  const command = lifecycleCommands.has(pending.command) ? pending.command : "inspect";
  const capabilityId = typeof pending.capabilityId === "string" && pending.capabilityId.trim()
    ? pending.capabilityId.trim()
    : null;

  return {
    clientEntryId: typeof pending.clientEntryId === "string" && pending.clientEntryId.trim()
      ? pending.clientEntryId.trim()
      : `pending-revocation-${index + 1}`,
    command,
    capabilityId,
    tenantId: typeof pending.tenantId === "string" && pending.tenantId.trim() ? pending.tenantId.trim() : null,
    workspaceId: typeof pending.workspaceId === "string" && pending.workspaceId.trim() ? pending.workspaceId.trim() : null,
    reason: revocationReasons.has(pending.reason) ? pending.reason : null,
    proofId: typeof pending.proofId === "string" && pending.proofId.trim() ? pending.proofId.trim() : null,
    status: typeof pending.status === "string" && pending.status.trim() ? pending.status.trim() : "draft",
    updatedAt: asIso(pending.updatedAt, null)
  };
}

function normalizeClientContinuation(input = {}, index = 0) {
  const continuation = asObject(input);
  const status = clientContinuationStatuses.has(continuation.status) ? continuation.status : "draft";
  const command = lifecycleCommands.has(continuation.command) ? continuation.command : "inspect";
  const navigation = asObject(continuation.navigation);
  const externalState = asObject(continuation.externalState);

  return {
    continuationId: typeof continuation.continuationId === "string" && continuation.continuationId.trim()
      ? continuation.continuationId.trim()
      : `revocation-continuation-${index + 1}`,
    operationKey: typeof continuation.operationKey === "string" && continuation.operationKey.trim()
      ? continuation.operationKey.trim()
      : null,
    idempotencyKey: typeof continuation.idempotencyKey === "string" && continuation.idempotencyKey.trim()
      ? continuation.idempotencyKey.trim()
      : null,
    requestId: typeof continuation.requestId === "string" && continuation.requestId.trim()
      ? continuation.requestId.trim()
      : null,
    command,
    capabilityId: typeof continuation.capabilityId === "string" && continuation.capabilityId.trim()
      ? continuation.capabilityId.trim()
      : null,
    tenantId: typeof continuation.tenantId === "string" && continuation.tenantId.trim() ? continuation.tenantId.trim() : null,
    workspaceId: typeof continuation.workspaceId === "string" && continuation.workspaceId.trim() ? continuation.workspaceId.trim() : null,
    status,
    providerId: typeof continuation.providerId === "string" && continuation.providerId.trim() ? continuation.providerId.trim() : null,
    route: typeof continuation.route === "string" && continuation.route.trim()
      ? continuation.route.trim()
      : typeof navigation.to === "string" && navigation.to.trim()
        ? navigation.to.trim()
        : null,
    method: typeof continuation.method === "string" && continuation.method.trim()
      ? continuation.method.trim().toUpperCase()
      : typeof navigation.method === "string" && navigation.method.trim()
        ? navigation.method.trim().toUpperCase()
        : "POST",
    leaseExpiresAt: asIso(continuation.leaseExpiresAt ?? externalState.leaseExpiresAt, null),
    replayToken: typeof continuation.replayToken === "string" && continuation.replayToken.trim()
      ? continuation.replayToken.trim()
      : typeof externalState.replayToken === "string" && externalState.replayToken.trim()
        ? externalState.replayToken.trim()
        : null,
    updatedAt: asIso(continuation.updatedAt, null)
  };
}

function buildRestartSafeOperationKey(request) {
  return [
    surfaceId,
    request.tenantId || "hosted-kernel-tenant",
    request.workspaceId || "default-workspace",
    request.command,
    request.capabilityId || "global",
    request.reason || "no-reason",
    request.scheduleAt || "immediate"
  ].join(":");
}

function normalizePersistedRevocationRecord(input = {}, index = 0) {
  const record = asObject(input);
  const providerPreflight = asObject(record.providerPreflight);
  const command = lifecycleCommands.has(record.command) ? record.command : "inspect";
  const status = typeof record.status === "string" && record.status.trim()
    ? record.status.trim()
    : "pending";
  const capabilityId = typeof record.capabilityId === "string" && record.capabilityId.trim()
    ? record.capabilityId.trim()
    : null;
  const scheduleAt = asIso(record.scheduleAt, null);
  const operationKey = typeof record.operationKey === "string" && record.operationKey.trim()
    ? record.operationKey.trim()
    : [
        surfaceId,
        typeof record.tenantId === "string" && record.tenantId.trim() ? record.tenantId.trim() : "hosted-kernel-tenant",
        typeof record.workspaceId === "string" && record.workspaceId.trim() ? record.workspaceId.trim() : "default-workspace",
        command,
        capabilityId || "global",
        revocationReasons.has(record.reason) ? record.reason : "no-reason",
        scheduleAt || "immediate"
      ].join(":");

  return {
    operationKey,
    ledgerEntryId: typeof record.ledgerEntryId === "string" && record.ledgerEntryId.trim()
      ? record.ledgerEntryId.trim()
      : `revocation-ledger-${index + 1}`,
    command,
    capabilityId,
    tenantId: typeof record.tenantId === "string" && record.tenantId.trim() ? record.tenantId.trim() : null,
    workspaceId: typeof record.workspaceId === "string" && record.workspaceId.trim() ? record.workspaceId.trim() : null,
    reason: revocationReasons.has(record.reason) ? record.reason : null,
    proofId: typeof record.proofId === "string" && record.proofId.trim() ? record.proofId.trim() : null,
    providerId: typeof record.providerId === "string" && record.providerId.trim() ? record.providerId.trim() : null,
    providerContractVersion: typeof record.providerContractVersion === "string" && record.providerContractVersion.trim()
      ? record.providerContractVersion.trim()
      : null,
    externalCorrelationId: typeof record.externalCorrelationId === "string" && record.externalCorrelationId.trim()
      ? record.externalCorrelationId.trim()
      : null,
    providerPreflight: Object.keys(providerPreflight).length
      ? {
          requiredFields: asStringList(providerPreflight.requiredFields),
          missingFields: asStringList(providerPreflight.missingFields ?? providerPreflight.missingPreflightFields),
          replayToken: typeof providerPreflight.replayToken === "string" && providerPreflight.replayToken.trim()
            ? providerPreflight.replayToken.trim()
            : null,
          replayTokenExpiresAt: asIso(providerPreflight.replayTokenExpiresAt, null),
          idempotencyWindowSeconds: boundedInteger(providerPreflight.idempotencyWindowSeconds, 86400, 60, 604800)
        }
      : null,
    leaseExpiresAt: asIso(record.leaseExpiresAt ?? asObject(record.externalState).leaseExpiresAt, null),
    replayToken: typeof record.replayToken === "string" && record.replayToken.trim()
      ? record.replayToken.trim()
      : typeof providerPreflight.replayToken === "string" && providerPreflight.replayToken.trim()
        ? providerPreflight.replayToken.trim()
        : null,
    status,
    scheduleAt,
    idempotencyKey: typeof record.idempotencyKey === "string" && record.idempotencyKey.trim()
      ? record.idempotencyKey.trim()
      : operationKey,
    attemptCount: Number.isInteger(Number(record.attemptCount)) && Number(record.attemptCount) >= 0
      ? Number(record.attemptCount)
      : 0,
    lastError: typeof record.lastError === "string" && record.lastError.trim() ? record.lastError.trim() : null,
    createdAt: asIso(record.createdAt, null),
    updatedAt: asIso(record.updatedAt, null),
    completedAt: asIso(record.completedAt, null)
  };
}

function classifyPersistedRestartStatus(record, request, now) {
  if (!record) {
    return {
      phase: "absent",
      restartStatus: "new-operation",
      terminal: false,
      durableAccepted: false,
      resumable: false,
      operatorReview: false,
      replayable: false,
      leaseExpired: false,
      replayTokenExpired: false,
      statusReason: "no_matching_persisted_record"
    };
  }

  const terminal = ["completed", "revoked", "restored", "disabled", "enabled"].includes(record.status);
  const durableAccepted = terminal || ["scheduled", "observed"].includes(record.status);
  const operatorReview = ["blocked", "failed"].includes(record.status);
  const resumable = ["pending", "ready-for-handoff", "ready-for-commit", "needs-proof", "replaying"].includes(record.status);
  const leaseExpired = Boolean(record.leaseExpiresAt && Date.parse(record.leaseExpiresAt) <= Date.parse(now));
  const replayTokenExpiresAt = record.providerPreflight?.replayTokenExpiresAt || null;
  const replayTokenExpired = Boolean(replayTokenExpiresAt && Date.parse(replayTokenExpiresAt) <= Date.parse(now));
  const commandChanged = record.command !== request.command;
  const capabilityChanged = (record.capabilityId || null) !== (request.capabilityId || null);
  const replayable = resumable && !leaseExpired && !replayTokenExpired && !commandChanged && !capabilityChanged;
  const restartStatus = durableAccepted
    ? "already-applied"
    : operatorReview
      ? "requires-operator-review"
      : replayable
        ? "resume-pending"
        : resumable
          ? "resume-blocked-stale-state"
          : "new-operation";
  const statusReason = durableAccepted
    ? "durable_status_is_idempotent"
    : operatorReview
      ? "persisted_record_requires_operator_review"
      : commandChanged || capabilityChanged
        ? "persisted_record_shape_changed"
        : leaseExpired
          ? "provider_handoff_lease_expired"
          : replayTokenExpired
            ? "provider_replay_token_expired"
            : replayable
              ? "persisted_record_can_resume"
              : "persisted_record_not_replayable";

  return {
    phase: terminal
      ? "terminal"
      : durableAccepted
        ? "durable-accepted"
        : operatorReview
          ? "operator-review"
          : resumable
            ? "resumable"
            : "unknown",
    restartStatus,
    terminal,
    durableAccepted,
    resumable,
    operatorReview,
    replayable,
    leaseExpired,
    replayTokenExpired,
    statusReason
  };
}

function buildPersistedStatePatch({ persistedState, existing, nextRecord, statusDescriptor, duplicateRecords, now }) {
  const preserveExisting = statusDescriptor.durableAccepted || statusDescriptor.operatorReview;
  const supersededOperationKeys = duplicateRecords
    .filter((record) => record.operationKey !== persistedState.currentOperationKey)
    .map((record) => record.operationKey);

  return {
    patchContractVersion: "revocation-persisted-state-patch-v1",
    storeVersion: persistedState.storeVersion,
    snapshotId: persistedState.snapshotId,
    checkpointId: persistedState.checkpointId,
    generatedAt: now,
    operation: nextRecord
      ? preserveExisting
        ? "preserve_existing_record"
        : existing
          ? "merge_resume_record"
          : "insert_record"
      : "no_write",
    currentOperationKey: persistedState.currentOperationKey,
    preserveExisting,
    beforeStatus: existing?.status || null,
    afterStatus: nextRecord?.status || null,
    restartStatus: statusDescriptor.restartStatus,
    statusReason: statusDescriptor.statusReason,
    writeRecord: preserveExisting ? null : nextRecord,
    tombstoneSupersededOperationKeys: supersededOperationKeys,
    expectedRecordCountAfterPatch: preserveExisting
      ? persistedState.records.length
      : persistedState.records.some((record) => record.operationKey === persistedState.currentOperationKey)
        ? persistedState.records.length
        : persistedState.records.length + 1
  };
}

function normalizePersistedRevocationState(input = {}, request, clientRuntime, now) {
  const persisted = asObject(input.persistedState ?? input.recoveryState ?? input.revocationLedger);
  const recordsInput = Array.isArray(persisted.records)
    ? persisted.records
    : Array.isArray(persisted.revocations)
      ? persisted.revocations
      : [];
  const records = recordsInput
    .map(normalizePersistedRevocationRecord)
    .filter((record) => record.capabilityId || record.command === "inspect");
  const currentOperationKey = buildRestartSafeOperationKey(request);
  const matchingRecord = records.find((record) => record.operationKey === currentOperationKey) || null;
  const dirtyRecords = records.filter((record) => ["pending", "ready-for-handoff", "ready-for-commit", "needs-proof", "replaying"].includes(record.status));

  return {
    storeVersion: typeof persisted.storeVersion === "string" && persisted.storeVersion.trim()
      ? persisted.storeVersion.trim()
      : "revocation-persisted-state-v1",
    snapshotId: typeof persisted.snapshotId === "string" && persisted.snapshotId.trim()
      ? persisted.snapshotId.trim()
      : `${surfaceId}:${clientRuntime.sessionId}`,
    checkpointId: typeof persisted.checkpointId === "string" && persisted.checkpointId.trim()
      ? persisted.checkpointId.trim()
      : `${surfaceId}:${clientRuntime.workflowId}:checkpoint`,
    loadedAt: asIso(persisted.loadedAt, now),
    lastCheckpointAt: asIso(persisted.lastCheckpointAt, null),
    currentOperationKey,
    currentIdempotencyKey: matchingRecord?.idempotencyKey || currentOperationKey,
    matchingRecord,
    dirtyRecords,
    records
  };
}

function normalizeClientRuntime(input = {}, request, now) {
  const runtime = asObject(input.clientRuntime ?? input.clientState);
  const selection = asObject(runtime.selection);
  const navigation = asObject(runtime.navigation);
  const queue = asObject(runtime.queue);
  const sessionId = typeof runtime.sessionId === "string" && runtime.sessionId.trim()
    ? runtime.sessionId.trim()
    : "hosted-kernel-session";
  const requestId = typeof runtime.requestId === "string" && runtime.requestId.trim()
    ? runtime.requestId.trim()
    : `${surfaceId}:${sessionId}:${request.requestedAt}`;
  const workflowId = typeof runtime.workflowId === "string" && runtime.workflowId.trim()
    ? runtime.workflowId.trim()
    : `${surfaceName}:${request.command}:${request.capabilityId || "global"}`;
  const pendingRevocations = (Array.isArray(queue.pendingRevocations)
    ? queue.pendingRevocations
    : Array.isArray(runtime.pendingRevocations)
      ? runtime.pendingRevocations
      : [])
    .map(normalizePendingRevocation)
    .filter((entry) => entry.capabilityId || entry.command === "inspect");
  const handoffContinuations = (Array.isArray(queue.handoffContinuations)
    ? queue.handoffContinuations
    : Array.isArray(runtime.handoffContinuations)
      ? runtime.handoffContinuations
      : Array.isArray(runtime.workflowHandoffs)
        ? runtime.workflowHandoffs
        : [])
    .map(normalizeClientContinuation)
    .filter((entry) => entry.operationKey || entry.capabilityId || entry.command === "inspect");
  const selectedCapabilityId = typeof selection.capabilityId === "string" && selection.capabilityId.trim()
    ? selection.capabilityId.trim()
    : typeof runtime.selectedCapabilityId === "string" && runtime.selectedCapabilityId.trim()
      ? runtime.selectedCapabilityId.trim()
      : request.capabilityId;
  const activeProofId = typeof selection.proofId === "string" && selection.proofId.trim()
    ? selection.proofId.trim()
    : request.proofId;

  return {
    sessionId,
    requestId,
    workflowId,
    stateVersion: typeof runtime.stateVersion === "string" && runtime.stateVersion.trim()
      ? runtime.stateVersion.trim()
      : "revocation-runtime-v1",
    currentRoute: typeof navigation.currentRoute === "string" && navigation.currentRoute.trim()
      ? navigation.currentRoute.trim()
      : "/capability-security/revocation",
    returnRoute: typeof navigation.returnRoute === "string" && navigation.returnRoute.trim()
      ? navigation.returnRoute.trim()
      : "/capability-security",
    selectedCapabilityId,
    activeProofId,
    visibleCapabilityIds: asStringList(runtime.visibleCapabilityIds),
    visibleWorkspaceIds: asStringList(runtime.visibleWorkspaceIds, request.workspaceId ? [request.workspaceId] : []),
    pendingRevocations,
    handoffContinuations,
    observedAt: asIso(runtime.observedAt, now)
  };
}

function validateLifecycle({ request, settings, now }) {
  const errors = [];
  const warnings = [];
  const scheduledMs = request.scheduleAt ? Date.parse(request.scheduleAt) : null;
  const nowMs = Date.parse(now);

  for (const issue of request.normalization?.issues || []) {
    if (issue.severity === "error") {
      errors.push(issue.message);
    } else if (issue.severity === "warning") {
      warnings.push(issue.message);
    }
  }
  if (["schedule", "revoke", "restore"].includes(request.command) && !request.capabilityId) {
    errors.push("capabilityId is required for lifecycle mutation commands");
  }
  if (settings.requireReason && ["schedule", "revoke", "disable"].includes(request.command) && !request.reason) {
    errors.push("approved revocation reason is required by settings");
  }
  if (request.command === "disable" && !settings.controls.allowManualDisable) {
    errors.push("manual disable is blocked by lifecycle controls");
  }
  if (request.command === "restore" && !settings.controls.allowRestore) {
    errors.push("restore is blocked by lifecycle controls");
  }
  if (request.command === "schedule" && !settings.scheduling.enabled) {
    errors.push("scheduling is disabled by revocation settings");
  }
  if (request.command === "schedule" && !request.scheduleAt) {
    errors.push("scheduleAt is required for schedule command");
  }
  if (request.command === "schedule" && scheduledMs !== null && scheduledMs <= nowMs) {
    errors.push("scheduleAt must be in the future");
  }
  if (request.command === "revoke" && settings.controls.requireProofBeforeRevoke && !request.proofId) {
    warnings.push("revoke is accepted for planning but still needs proofId before commit");
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings
  };
}

function validateClientRuntime({ request, validation, clientRuntime }) {
  const warnings = [...validation.warnings];

  if (request.capabilityId && clientRuntime.selectedCapabilityId && clientRuntime.selectedCapabilityId !== request.capabilityId) {
    warnings.push("request capability differs from selected client capability");
  }
  if (request.proofId && clientRuntime.activeProofId && clientRuntime.activeProofId !== request.proofId) {
    warnings.push("request proof differs from active client proof");
  }
  if (request.capabilityId && clientRuntime.visibleCapabilityIds.length && !clientRuntime.visibleCapabilityIds.includes(request.capabilityId)) {
    warnings.push("requested capability is not visible in current client state");
  }
  if (request.workspaceId && clientRuntime.visibleWorkspaceIds.length && !clientRuntime.visibleWorkspaceIds.includes(request.workspaceId)) {
    warnings.push("requested workspace is not visible in current client state");
  }

  return {
    ...validation,
    warnings
  };
}

function buildLifecycleControlEvaluation({ request, settings, persistedState, clientRuntime, boundaryContext, now }) {
  const nowMs = Date.parse(now);
  const boundaryWorksets = buildBoundaryScopedWorksets({ persistedState, clientRuntime, boundaryContext });
  const scheduledLedgerRecords = boundaryWorksets.scopedScheduledLedger.filter((record) => {
    if (!record.scheduleAt) {
      return false;
    }
    return Date.parse(record.scheduleAt) > nowMs;
  });
  const scheduledClientEntries = boundaryWorksets.scopedScheduledClient;
  const scheduledCapacityUsed = scheduledLedgerRecords.length + scheduledClientEntries.length;
  const scheduleWouldUseCapacity = request.command === "schedule" && Boolean(request.scheduleAt);
  const scheduledCapacityAfterRequest = scheduledCapacityUsed + (scheduleWouldUseCapacity ? 1 : 0);
  const scheduleCapacityRemaining = Math.max(settings.scheduling.maxScheduledRevocations - scheduledCapacityUsed, 0);
  const pendingMutations = boundaryWorksets.scopedDirtyLedger.filter((record) => record.command !== "inspect");
  const pendingClientMutations = boundaryWorksets.scopedPendingClient;
  const lifecycleMutation = ["disable", "schedule", "revoke", "restore"].includes(request.command);
  const errors = [];
  const warnings = [];

  if (!settings.enabled && lifecycleMutation) {
    errors.push("revocation controls are disabled; enable controls before lifecycle mutations");
  }
  if (request.command === "enable" && settings.enabled) {
    warnings.push("revocation controls are already enabled");
  }
  if (request.command === "disable" && !settings.enabled) {
    warnings.push("revocation controls are already disabled");
  }
  if (request.command === "disable" && !settings.controls.allowDisableWithPending && !request.overridePending) {
    if (pendingMutations.length || pendingClientMutations.length) {
      errors.push("disable requires clearing or overriding pending revocation work");
    }
  }
  if (request.command === "schedule" && scheduleWouldUseCapacity && scheduledCapacityAfterRequest > settings.scheduling.maxScheduledRevocations) {
    errors.push(`scheduled revocation capacity exceeded (${scheduledCapacityUsed}/${settings.scheduling.maxScheduledRevocations} active)`);
  }
  if (request.command === "schedule" && scheduleCapacityRemaining <= 5) {
    warnings.push(`scheduled revocation capacity is nearly full (${scheduleCapacityRemaining} slots remaining)`);
  }
  if (boundaryWorksets.quarantinedUnscopedClientEntryIds.length || boundaryWorksets.unscopedLedgerCount) {
    warnings.push("legacy unscoped pending revocation work is quarantined until a workspace adoption boundary is present");
  }
  if (boundaryWorksets.adoptedUnscopedClientEntryIds.length) {
    warnings.push("legacy unscoped client revocation work was adopted into the requested workspace by boundary policy");
  }

  const controlTransition = request.command === "enable"
    ? settings.enabled ? "noop-enabled" : "enable-controls"
    : request.command === "disable"
      ? settings.enabled ? "disable-controls" : "noop-disabled"
      : settings.enabled ? "controls-active" : "controls-inactive";

  return {
    contractVersion: "revocation-lifecycle-control-evaluation-v1",
    generatedAt: now,
    controlTransition,
    controlsEnabled: settings.enabled,
    overridePending: request.overridePending,
    boundaryScopedWorksets: {
      contractVersion: boundaryWorksets.contractVersion,
      tenantId: boundaryWorksets.tenantId,
      workspaceId: boundaryWorksets.workspaceId,
      scopedDirtyLedgerCount: boundaryWorksets.scopedDirtyLedger.length,
      scopedPendingClientCount: boundaryWorksets.scopedPendingClient.length,
      ignoredLedgerCount: boundaryWorksets.ignoredLedger.length,
      ignoredClientCount: boundaryWorksets.ignoredClient.length,
      unscopedLedgerCount: boundaryWorksets.unscopedLedgerCount,
      unscopedClientCount: boundaryWorksets.unscopedClientCount,
      unscopedClientAdoptionEnabled: boundaryContext.enforcement.adoptUnscopedClientWork,
      adoptedUnscopedClientEntryIds: boundaryWorksets.adoptedUnscopedClientEntryIds,
      quarantinedUnscopedClientEntryIds: boundaryWorksets.quarantinedUnscopedClientEntryIds,
      ignoredOperationKeys: boundaryWorksets.ignoredLedger.map((candidate) => candidate.record.operationKey),
      ignoredClientEntryIds: boundaryWorksets.ignoredClient.map((candidate) => candidate.entry.clientEntryId),
      ignoredReasons: [
        ...new Set([
          ...boundaryWorksets.ignoredLedger.map((candidate) => candidate.boundaryStatus),
          ...boundaryWorksets.ignoredClient.map((candidate) => candidate.boundaryStatus)
        ])
      ]
    },
    errors,
    warnings,
    scheduling: {
      enabled: settings.scheduling.enabled,
      maxScheduledRevocations: settings.scheduling.maxScheduledRevocations,
      activeLedgerSchedules: scheduledLedgerRecords.length,
      activeClientSchedules: scheduledClientEntries.length,
      activeScheduledCount: scheduledCapacityUsed,
      capacityRemaining: scheduleCapacityRemaining,
      wouldExceedCapacity: scheduleWouldUseCapacity && scheduledCapacityAfterRequest > settings.scheduling.maxScheduledRevocations,
      scheduledOperationKeys: scheduledLedgerRecords.map((record) => record.operationKey),
      scheduledClientEntryIds: scheduledClientEntries.map((entry) => entry.clientEntryId)
    },
    pendingWork: {
      dirtyLedgerCount: pendingMutations.length,
      pendingClientCount: pendingClientMutations.length,
      disableBlockedByPending: request.command === "disable"
        && !settings.controls.allowDisableWithPending
        && !request.overridePending
        && (pendingMutations.length > 0 || pendingClientMutations.length > 0),
      operationKeys: pendingMutations.map((record) => record.operationKey),
      clientEntryIds: pendingClientMutations.map((entry) => entry.clientEntryId)
    },
    commands: {
      enable: {
        enabled: request.command === "enable" ? errors.length === 0 : true,
        route: "/capability-security/revocation/settings/enable",
        resultingEnabled: true
      },
      disable: {
        enabled: settings.controls.allowManualDisable && !pendingMutations.length && !pendingClientMutations.length,
        route: "/capability-security/revocation/settings/disable",
        resultingEnabled: false
      },
      schedule: {
        enabled: settings.enabled && settings.scheduling.enabled && scheduleCapacityRemaining > 0,
        route: "/capability-security/revocation/schedule",
        capacityRemaining: scheduleCapacityRemaining
      }
    }
  };
}

function applyLifecycleControlValidation(validation, controlEvaluation) {
  const errors = [...validation.errors, ...controlEvaluation.errors];
  const warnings = [...validation.warnings, ...controlEvaluation.warnings];

  return {
    ok: errors.length === 0,
    errors,
    warnings
  };
}

function validateBooleanSetting(rawSettings, path, normalizedValue, warnings) {
  const segments = path.split(".");
  let cursor = rawSettings;

  for (const segment of segments) {
    if (!asObject(cursor).hasOwnProperty(segment)) {
      return;
    }
    cursor = cursor[segment];
  }
  if (typeof cursor !== "boolean") {
    warnings.push(`${path} must be boolean; using ${normalizedValue}`);
  }
}

function buildLifecycleSettingsCommandPlan({ input, request, settings, controlEvaluation, boundaryContext, now }) {
  const rawSettings = asObject(input.settings);
  const rawScheduling = asObject(rawSettings.scheduling);
  const rawControls = asObject(rawSettings.controls);
  const warnings = [];
  const errors = [];
  const lifecycleCommand = ["enable", "disable", "schedule"].includes(request.command);
  const normalizedSettingsSnapshot = {
    enabled: settings.enabled,
    requireReason: settings.requireReason,
    auditRetentionDays: settings.auditRetentionDays,
    controls: settings.controls,
    scheduling: settings.scheduling
  };

  validateBooleanSetting(rawSettings, "enabled", settings.enabled, warnings);
  validateBooleanSetting(rawSettings, "requireReason", settings.requireReason, warnings);
  validateBooleanSetting(rawSettings, "controls.allowManualDisable", settings.controls.allowManualDisable, warnings);
  validateBooleanSetting(rawSettings, "controls.allowRestore", settings.controls.allowRestore, warnings);
  validateBooleanSetting(rawSettings, "controls.requireProofBeforeRevoke", settings.controls.requireProofBeforeRevoke, warnings);
  validateBooleanSetting(rawSettings, "controls.allowDisableWithPending", settings.controls.allowDisableWithPending, warnings);
  validateBooleanSetting(rawSettings, "scheduling.enabled", settings.scheduling.enabled, warnings);

  if (rawSettings.hasOwnProperty("auditRetentionDays")) {
    const value = Number(rawSettings.auditRetentionDays);
    if (!Number.isInteger(value) || value < 7 || value > 365) {
      warnings.push("auditRetentionDays must be an integer between 7 and 365; using 90");
    }
  }
  if (rawScheduling.hasOwnProperty("reviewEveryMinutes")) {
    const value = Number(rawScheduling.reviewEveryMinutes);
    if (!Number.isInteger(value) || value < 5 || value > 1440) {
      warnings.push("scheduling.reviewEveryMinutes must be an integer between 5 and 1440; using 15");
    }
  }
  if (rawScheduling.hasOwnProperty("maxScheduledRevocations")) {
    const value = Number(rawScheduling.maxScheduledRevocations);
    if (!Number.isInteger(value) || value < 1) {
      warnings.push("scheduling.maxScheduledRevocations must be a positive integer; using 250");
    }
  }

  if (request.command === "disable" && rawControls.allowManualDisable === false) {
    errors.push("settings command rejected because manual disable is not allowed");
  }
  if (request.command === "schedule" && rawScheduling.enabled === false) {
    errors.push("settings command rejected because scheduling is disabled");
  }

  const nextSettings = {
    ...normalizedSettingsSnapshot,
    enabled: request.command === "enable"
      ? true
      : request.command === "disable"
        ? false
        : settings.enabled
  };
  const scheduleReviewAt = new Date(Date.parse(now) + settings.scheduling.reviewEveryMinutes * 60 * 1000).toISOString();
  const settingsPatch = lifecycleCommand
    ? {
        patchType: request.command === "enable"
          ? "enable_revocation_controls"
          : request.command === "disable"
            ? "disable_revocation_controls"
            : "validate_schedule_policy",
        tenantId: boundaryContext.tenantId,
        workspaceId: boundaryContext.workspaceId,
        before: normalizedSettingsSnapshot,
        after: nextSettings,
        generatedAt: now
      }
    : null;
  const commandState = request.command === "enable"
    ? settings.enabled ? "already-enabled" : "ready-to-enable"
    : request.command === "disable"
      ? controlEvaluation.pendingWork.disableBlockedByPending
        ? "blocked-by-pending-work"
        : settings.enabled ? "ready-to-disable" : "already-disabled"
      : request.command === "schedule"
        ? controlEvaluation.scheduling.wouldExceedCapacity
          ? "blocked-by-schedule-capacity"
          : settings.scheduling.enabled ? "ready-to-schedule" : "scheduling-disabled"
        : "not-a-settings-command";

  return {
    contractVersion: "revocation-lifecycle-settings-command-plan-v1",
    generatedAt: now,
    command: request.command,
    lifecycleCommand,
    validation: {
      ok: errors.length === 0,
      errors,
      warnings,
      normalizedSettingsApplied: warnings.length > 0
    },
    commandState,
    settingsPatch,
    schedulingReview: {
      enabled: settings.scheduling.enabled,
      reviewEveryMinutes: settings.scheduling.reviewEveryMinutes,
      nextReviewAt: scheduleReviewAt,
      activeScheduledCount: controlEvaluation.scheduling.activeScheduledCount,
      capacityRemaining: controlEvaluation.scheduling.capacityRemaining,
      capacityLimit: settings.scheduling.maxScheduledRevocations,
      requestedScheduleAt: request.scheduleAt
    },
    nextActions: [
      ...(warnings.length ? [{
        action: "review_lifecycle_settings_normalization",
        route: "/capability-security/revocation/settings/validate",
        enabled: true
      }] : []),
      {
        action: commandState,
        route: request.command === "enable"
          ? "/capability-security/revocation/settings/enable"
          : request.command === "disable"
            ? "/capability-security/revocation/settings/disable"
            : request.command === "schedule"
              ? "/capability-security/revocation/schedule"
              : "/capability-security/revocation/settings",
        enabled: errors.length === 0 && lifecycleCommand
      }
    ]
  };
}

function applySettingsCommandValidation(validation, settingsCommandPlan) {
  const errors = [...validation.errors, ...settingsCommandPlan.validation.errors];
  const warnings = [...validation.warnings, ...settingsCommandPlan.validation.warnings];

  return {
    ok: errors.length === 0,
    errors,
    warnings
  };
}

function validateTenantPermissionBoundary({ request, validation, boundaryContext }) {
  const errors = [...validation.errors];
  const warnings = [...validation.warnings];
  const enforced = boundaryContext.enforcement.mode === "enforced";

  if (!boundaryContext.enforcement.actorInTenant) {
    (enforced ? errors : warnings).push("actor tenant does not match revocation tenant boundary");
  }
  if (!boundaryContext.enforcement.workspaceAllowed) {
    (enforced ? errors : warnings).push("actor is not allowed to operate in requested workspace");
  }
  if (!boundaryContext.enforcement.resourceInBoundary && request.capabilityId) {
    (enforced ? errors : warnings).push("capability resource is outside requested tenant workspace boundary");
  }
  if (!boundaryContext.enforcement.permissionSatisfied) {
    (enforced ? errors : warnings).push(`actor missing required revocation scopes: ${boundaryContext.missingScopes.join(", ")}`);
  }
  if (!boundaryContext.enforcement.commandAllowed) {
    (enforced ? errors : warnings).push(`actor boundary does not allow ${request.command} command in requested workspace`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings
  };
}

function boundaryMatchStatus(entry, boundaryContext) {
  const tenantId = typeof entry.tenantId === "string" && entry.tenantId.trim() ? entry.tenantId.trim() : null;
  const workspaceId = typeof entry.workspaceId === "string" && entry.workspaceId.trim() ? entry.workspaceId.trim() : null;

  if (!tenantId || !workspaceId) {
    return "unscoped";
  }
  if (tenantId === boundaryContext.tenantId && workspaceId === boundaryContext.workspaceId) {
    return "in-boundary";
  }
  if (tenantId === boundaryContext.tenantId) {
    return "same-tenant-other-workspace";
  }
  return "foreign-tenant";
}

function buildBoundaryScopedWorksets({ persistedState, clientRuntime, boundaryContext }) {
  const dirtyLedger = persistedState.dirtyRecords.map((record) => ({
    record,
    boundaryStatus: boundaryMatchStatus(record, boundaryContext)
  }));
  const pendingClient = clientRuntime.pendingRevocations
    .filter((entry) => entry.command !== "inspect" && activeScheduledStatuses.has(entry.status))
    .map((entry) => ({
      entry,
      boundaryStatus: boundaryMatchStatus(entry, boundaryContext)
    }));
  const scheduledLedger = persistedState.records
    .filter((record) => record.command === "schedule" && record.scheduleAt && activeScheduledStatuses.has(record.status))
    .map((record) => ({
      record,
      boundaryStatus: boundaryMatchStatus(record, boundaryContext)
    }));
  const scheduledClient = clientRuntime.pendingRevocations
    .filter((entry) => entry.command === "schedule" && activeScheduledStatuses.has(entry.status) && entry.capabilityId)
    .map((entry) => ({
      entry,
      boundaryStatus: boundaryMatchStatus(entry, boundaryContext)
    }));
  const scopedDirtyLedger = dirtyLedger
    .filter((candidate) => candidate.boundaryStatus === "in-boundary")
    .map((candidate) => candidate.record);
  const scopedPendingClient = pendingClient
    .filter((candidate) => (
      candidate.boundaryStatus === "in-boundary"
      || (candidate.boundaryStatus === "unscoped" && boundaryContext.enforcement.adoptUnscopedClientWork)
    ))
    .map((candidate) => candidate.entry);
  const scopedScheduledLedger = scheduledLedger
    .filter((candidate) => candidate.boundaryStatus === "in-boundary")
    .map((candidate) => candidate.record);
  const scopedScheduledClient = scheduledClient
    .filter((candidate) => (
      candidate.boundaryStatus === "in-boundary"
      || (candidate.boundaryStatus === "unscoped" && boundaryContext.enforcement.adoptUnscopedClientWork)
    ))
    .map((candidate) => candidate.entry);
  const ignoredLedger = dirtyLedger.filter((candidate) => (
    candidate.boundaryStatus === "same-tenant-other-workspace" || candidate.boundaryStatus === "foreign-tenant"
  ));
  const ignoredClient = pendingClient.filter((candidate) => (
    candidate.boundaryStatus === "same-tenant-other-workspace" || candidate.boundaryStatus === "foreign-tenant"
  ));
  const quarantinedUnscopedClient = pendingClient.filter((candidate) => (
    candidate.boundaryStatus === "unscoped" && !boundaryContext.enforcement.adoptUnscopedClientWork
  ));

  return {
    contractVersion: "revocation-boundary-scoped-worksets-v1",
    tenantId: boundaryContext.tenantId,
    workspaceId: boundaryContext.workspaceId,
    scopedDirtyLedger,
    scopedPendingClient,
    scopedScheduledLedger,
    scopedScheduledClient,
    ignoredLedger,
    ignoredClient: [...ignoredClient, ...quarantinedUnscopedClient],
    adoptedUnscopedClientEntryIds: boundaryContext.enforcement.adoptUnscopedClientWork
      ? pendingClient
          .filter((candidate) => candidate.boundaryStatus === "unscoped")
          .map((candidate) => candidate.entry.clientEntryId)
      : [],
    quarantinedUnscopedClientEntryIds: quarantinedUnscopedClient.map((candidate) => candidate.entry.clientEntryId),
    unscopedLedgerCount: dirtyLedger.filter((candidate) => candidate.boundaryStatus === "unscoped").length,
    unscopedClientCount: pendingClient.filter((candidate) => candidate.boundaryStatus === "unscoped").length
  };
}

function validateProviderContracts({ request, validation, providerIntegration }) {
  const errors = [...validation.errors];
  const warnings = [...validation.warnings];

  if (request.command !== "inspect" && providerIntegration.negotiation.matchedProviderCount === 0) {
    errors.push(`no provider contract supports ${request.command}`);
  }
  if (request.reason && providerIntegration.negotiation.matchedProviderCount > 0 && providerIntegration.negotiation.reasonMatchedProviderCount === 0) {
    errors.push(`no eligible provider contract accepts ${request.reason}`);
  }
  if (providerIntegration.negotiation.proofBlockedProviders.length) {
    warnings.push("one or more provider contracts require proofId before external handoff");
  }
  if (request.command !== "inspect" && providerIntegration.negotiation.scopeBlockedProviders.length && providerIntegration.negotiation.eligibleProviderCount === 0) {
    errors.push(`no eligible provider contract grants scopes: ${request.requiredScopes.join(", ")}`);
  }
  if (request.proofMode !== "none" && providerIntegration.negotiation.proofModeBlockedProviders.length && providerIntegration.negotiation.eligibleProviderCount === 0) {
    errors.push(`no eligible provider contract accepts proof mode ${request.proofMode}`);
  }
  if (providerIntegration.negotiation.preflightBlockedProviders.length && providerIntegration.negotiation.eligibleProviderCount === 0) {
    errors.push("no eligible provider contract has complete preflight handoff fields");
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings
  };
}

function normalizeProviderHealthReports(input = {}, providerContracts, now) {
  const health = asObject(input.operationalHealth ?? input.health);
  const retryPolicy = asObject(health.retryPolicy);
  const providerHealthInput = Array.isArray(health.providerStatuses)
    ? health.providerStatuses
    : Array.isArray(health.providers)
      ? health.providers
      : [];
  const providerHealthMap = asObject(health.providerStatusById ?? health.providerHealth);
  const reported = providerHealthInput.map((entry) => asObject(entry));
  const mergedReports = providerContracts.map((provider) => {
    const mapEntry = asObject(providerHealthMap[provider.providerId]);
    const listEntry = reported.find((entry) => entry.providerId === provider.providerId) || {};
    const report = Object.keys(mapEntry).length ? mapEntry : listEntry;
    const state = providerHealthStates.has(report.state) ? report.state : "healthy";
    const failure = classifyProviderFailure({ ...report, state });
    const circuit = buildProviderCircuit({ ...report, state }, retryPolicy, now);

    return {
      providerId: provider.providerId,
      service: provider.service,
      state,
      observedAt: asIso(report.observedAt, now),
      lastSuccessAt: asIso(report.lastSuccessAt, null),
      lastFailureAt: asIso(report.lastFailureAt, null),
      lastError: typeof report.lastError === "string" && report.lastError.trim() ? report.lastError.trim() : null,
      failureCode: typeof report.failureCode === "string" && report.failureCode.trim()
        ? report.failureCode.trim()
        : typeof report.errorCode === "string" && report.errorCode.trim()
          ? report.errorCode.trim()
          : null,
      failureCategory: failure.category,
      failureRetryable: failure.retryable,
      operatorAction: failure.operatorAction,
      operatorRoute: failure.route,
      circuit
    };
  });

  return {
    degradedModeEnabled: health.degradedMode === true || asObject(health.degradedMode).enabled === true,
    failureBudgetRemaining: boundedInteger(health.failureBudgetRemaining, 3, 0, 100),
    providerReports: mergedReports
  };
}

function buildOperationalHealth({ request, validation, providerIntegration, providerContracts, persistedState, input, now }) {
  const healthReports = normalizeProviderHealthReports(input, providerContracts, now);
  const retryPolicyInput = asObject(asObject(input.operationalHealth ?? input.health).retryPolicy);
  const retryPolicy = {
    maxAttempts: boundedInteger(retryPolicyInput.maxAttempts, 3, 1, 20),
    baseDelaySeconds: boundedInteger(retryPolicyInput.baseDelaySeconds, 30, 5, 3600),
    maxDelaySeconds: boundedInteger(retryPolicyInput.maxDelaySeconds, 900, 30, 86400),
    circuitBreakerFailureThreshold: boundedInteger(retryPolicyInput.circuitBreakerFailureThreshold, 3, 1, 50),
    circuitBreakerCooldownSeconds: boundedInteger(retryPolicyInput.circuitBreakerCooldownSeconds, 300, 30, 86400)
  };
  const selectedProviderHealth = providerIntegration.negotiation.selectedProviderId
    ? healthReports.providerReports.find((report) => report.providerId === providerIntegration.negotiation.selectedProviderId) || null
    : null;
  const existing = persistedState.matchingRecord;
  const attemptCount = existing?.attemptCount || 0;
  const selectedFailure = selectedProviderHealth
    ? classifyProviderFailure(selectedProviderHealth, existing)
    : classifyProviderFailure({}, existing);
  const providerCircuitOpen = selectedProviderHealth?.circuit.state === "open" && !selectedProviderHealth.circuit.allowsProbe;
  const retryable = Boolean(
    (existing && retryableFailureStates.has(existing.status))
    || (providerIntegration.handoff.required && selectedFailure.retryable)
  );
  const attemptsRemaining = retryable ? Math.max(retryPolicy.maxAttempts - attemptCount, 0) : 0;
  const backoffDelaySeconds = Math.min(
    retryPolicy.baseDelaySeconds * (2 ** Math.max(attemptCount - 1, 0)),
    retryPolicy.maxDelaySeconds
  );
  const providerRetryDelaySeconds = selectedProviderHealth?.circuit.retryAfterSeconds || 0;
  const circuitCooldownSeconds = selectedProviderHealth?.circuit.cooldownUntil
    ? Math.max(Math.ceil((Date.parse(selectedProviderHealth.circuit.cooldownUntil) - Date.parse(now)) / 1000), 0)
    : 0;
  const nextDelaySeconds = Math.max(backoffDelaySeconds, providerRetryDelaySeconds, circuitCooldownSeconds);
  const nextRetryAt = retryable && attemptsRemaining > 0
    ? new Date(Date.parse(now) + nextDelaySeconds * 1000).toISOString()
    : null;
  const providerUnavailable = providerIntegration.handoff.required
    && (["degraded", "outage", "unknown"].includes(selectedProviderHealth?.state) || providerCircuitOpen);
  const exhaustedRetries = retryable && attemptsRemaining === 0;
  const canUseDegradedMode = providerUnavailable
    && healthReports.degradedModeEnabled
    && validation.ok
    && selectedFailure.retryable
    && request.command !== "restore";
  const errors = [];
  const warnings = [];

  if (providerUnavailable && !canUseDegradedMode) {
    errors.push(`selected provider ${selectedProviderHealth.providerId} is ${providerCircuitOpen ? "circuit-open" : selectedProviderHealth.state}`);
  }
  if (exhaustedRetries) {
    errors.push(`retry limit reached after ${attemptCount} attempts`);
  }
  if (providerUnavailable && canUseDegradedMode) {
    warnings.push(`provider health is degraded (${selectedFailure.category}); using local checkpointed degraded mode`);
  }
  if (retryable && attemptsRemaining > 0) {
    warnings.push(`retry scheduled with ${attemptsRemaining} attempts remaining`);
  }
  if (selectedProviderHealth?.circuit.state === "half-open") {
    warnings.push("provider circuit is half-open; next handoff should be treated as a recovery probe");
  }
  if (healthReports.failureBudgetRemaining === 0) {
    warnings.push("revocation failure budget is exhausted");
  }

  return {
    status: errors.length
      ? "unhealthy"
      : providerUnavailable || healthReports.failureBudgetRemaining === 0
        ? "degraded"
        : "healthy",
    degradedMode: {
      enabled: healthReports.degradedModeEnabled,
      active: canUseDegradedMode,
      reason: canUseDegradedMode ? "provider_unavailable_checkpoint_locally" : null,
      providerFailureCategory: canUseDegradedMode ? selectedFailure.category : null
    },
    selectedProvider: selectedProviderHealth,
    providerReports: healthReports.providerReports,
    selectedFailure: {
      category: selectedFailure.category,
      retryable: selectedFailure.retryable,
      operatorAction: selectedFailure.operatorAction,
      route: selectedFailure.route,
      providerCircuitOpen
    },
    retry: {
      policy: retryPolicy,
      attemptCount,
      attemptsRemaining,
      retryable,
      nextRetryAt,
      backoffDelaySeconds,
      providerRetryDelaySeconds,
      circuitCooldownSeconds,
      nextDelaySeconds,
      lastError: existing?.lastError || selectedProviderHealth?.lastError || null
    },
    failureBudgetRemaining: healthReports.failureBudgetRemaining,
    validationPatch: { errors, warnings },
    actionableErrors: errors.map((message) => ({
      code: message.includes("retry limit")
        ? "revocation_retry_exhausted"
        : providerCircuitOpen
          ? "revocation_provider_circuit_open"
          : `revocation_provider_${selectedFailure.category}`,
      message,
      action: message.includes("retry limit") ? "review_failed_revocation" : selectedFailure.operatorAction,
      route: message.includes("retry limit")
        ? "/capability-security/revocation/recovery/review"
        : selectedFailure.route,
      operationKey: persistedState.currentOperationKey,
      providerId: selectedProviderHealth?.providerId || null,
      retryable: !message.includes("retry limit") && selectedFailure.retryable,
      nextRetryAt
    }))
  };
}

function applyOperationalHealthValidation(validation, operationalHealth) {
  const errors = [...validation.errors, ...operationalHealth.validationPatch.errors];
  const warnings = [...validation.warnings, ...operationalHealth.validationPatch.warnings];

  return {
    ok: errors.length === 0,
    errors,
    warnings
  };
}

function buildProviderHealthGate({ providerIntegration, operationalHealth, validation, now }) {
  const handoff = providerIntegration.handoff;
  const selectedProviderId = handoff.providerId || providerIntegration.negotiation.selectedProviderId;
  const healthStatus = operationalHealth.status;
  const selectedHealth = operationalHealth.selectedProvider;
  const circuitState = selectedHealth?.circuit.state || "unknown";
  const retry = operationalHealth.retry;
  const actionableError = operationalHealth.actionableErrors[0] || null;
  const providerBlocked = healthStatus === "unhealthy" || actionableError !== null;
  const retryWaiting = Boolean(retry.nextRetryAt && Date.parse(retry.nextRetryAt) > Date.parse(now));
  const degradedCheckpoint = operationalHealth.degradedMode.active;
  const readiness = !handoff.required
    ? "not-required"
    : degradedCheckpoint
      ? "degraded-checkpoint"
      : providerBlocked
        ? "blocked"
        : retryWaiting
          ? "retry-wait"
          : circuitState === "half-open"
            ? "recovery-probe"
            : handoff.state === "ready"
              ? "ready"
              : handoff.state;

  return {
    contractVersion: "revocation-provider-health-gate-v1",
    evaluatedAt: now,
    providerId: selectedProviderId,
    handoffRequired: handoff.required,
    readiness,
    healthStatus,
    degradedModeActive: degradedCheckpoint,
    failureCategory: operationalHealth.selectedFailure.category,
    failureRetryable: operationalHealth.selectedFailure.retryable,
    circuitState,
    circuitAllowsProbe: selectedHealth?.circuit.allowsProbe === true,
    attemptCount: retry.attemptCount,
    attemptsRemaining: retry.attemptsRemaining,
    nextRetryAt: retry.nextRetryAt,
    retryAfterSeconds: retry.nextDelaySeconds,
    operatorAction: actionableError?.action || operationalHealth.selectedFailure.operatorAction,
    operatorRoute: actionableError?.route || operationalHealth.selectedFailure.route,
    actionableErrors: operationalHealth.actionableErrors,
    validationOkBeforeHealthGate: validation.ok,
    commitBehavior: degradedCheckpoint
      ? "checkpoint_locally_until_provider_recovers"
      : providerBlocked
        ? "block_external_handoff"
        : retryWaiting
          ? "delay_handoff_until_retry_window"
          : circuitState === "half-open"
            ? "send_single_recovery_probe"
            : handoff.required
              ? "handoff_to_provider"
              : "local_commit"
  };
}

function applyOperationalHealthToProviderIntegration({ providerIntegration, operationalHealth, validation, now }) {
  const healthGate = buildProviderHealthGate({ providerIntegration, operationalHealth, validation, now });
  const handoffState = !providerIntegration.handoff.required
    ? providerIntegration.handoff.state
    : healthGate.readiness === "degraded-checkpoint"
      ? "degraded-checkpoint"
      : healthGate.readiness === "blocked"
        ? "blocked"
        : healthGate.readiness === "retry-wait"
          ? "retry-wait"
          : healthGate.readiness === "recovery-probe"
            ? "ready"
            : providerIntegration.handoff.state;
  const healthRequiredFields = providerIntegration.handoff.required
    ? ["healthGate.readiness", "healthGate.healthStatus", "healthGate.commitBehavior"]
    : [];

  return {
    ...providerIntegration,
    negotiation: {
      ...providerIntegration.negotiation,
      healthGate
    },
    handoff: {
      ...providerIntegration.handoff,
      state: handoffState,
      healthGate,
      actionableErrors: healthGate.actionableErrors,
      externalState: providerIntegration.handoff.externalState
        ? {
            ...providerIntegration.handoff.externalState,
            healthGate: {
              readiness: healthGate.readiness,
              healthStatus: healthGate.healthStatus,
              failureCategory: healthGate.failureCategory,
              nextRetryAt: healthGate.nextRetryAt,
              circuitState: healthGate.circuitState,
              commitBehavior: healthGate.commitBehavior
            }
          }
        : null,
      payloadContract: providerIntegration.handoff.payloadContract
        ? {
            ...providerIntegration.handoff.payloadContract,
            requiredFields: [
              ...providerIntegration.handoff.payloadContract.requiredFields,
              ...healthRequiredFields
            ],
            operationalSafety: {
              contractVersion: healthGate.contractVersion,
              requiredRuntimeFields: healthRequiredFields,
              readiness: healthGate.readiness,
              retryable: healthGate.failureRetryable,
              nextRetryAt: healthGate.nextRetryAt,
              operatorAction: healthGate.operatorAction,
              operatorRoute: healthGate.operatorRoute
            }
          }
        : null
    }
  };
}

function buildLifecycleState({ request, settings, validation, providerIntegration, operationalHealth, controlEvaluation, settingsCommandPlan }) {
  const commandAllowed = validation.ok && (settings.enabled || request.command === "enable");
  const mutationCommand = ["enable", "disable", "schedule", "revoke", "restore"].includes(request.command);
  const nextAction = controlEvaluation.pendingWork.disableBlockedByPending
    ? "review_pending_revocations"
    : controlEvaluation.scheduling.wouldExceedCapacity
      ? "raise_schedule_capacity"
      : !settings.enabled && request.command !== "enable"
    ? "enable_revocation_controls"
    : operationalHealth?.degradedMode.active
      ? "checkpoint_degraded_revocation"
    : !validation.ok
      ? "fix_request"
      : request.command === "inspect"
        ? "monitor"
        : request.command === "revoke" && validation.warnings.length
            ? "attach_proof"
            : providerIntegration.handoff.required
              ? "handoff_to_provider"
              : request.command === "schedule"
                ? "queue_revocation"
            : mutationCommand
              ? "commit_lifecycle_command"
              : "monitor";

  return {
    enabled: settings.enabled,
    command: request.command,
    commandAllowed,
    mutationCommand,
    scheduled: request.command === "schedule" && commandAllowed,
    capabilityId: request.capabilityId,
    tenantId: request.tenantId,
    workspaceId: request.workspaceId,
    nextAction,
    providerId: providerIntegration.negotiation.selectedProviderId,
    providerContractVersion: providerIntegration.negotiation.selectedContractVersion,
    externalHandoffState: providerIntegration.handoff.state,
    externalHandoffLeaseExpiresAt: providerIntegration.handoff.externalState?.leaseExpiresAt || null,
    externalHandoffReplayToken: providerIntegration.handoff.externalState?.replayToken || null,
    externalHandoffMissingFields: providerIntegration.handoff.payloadContract?.missingPreflightFields || [],
    operationalHealthStatus: operationalHealth?.status || "healthy",
    degradedModeActive: Boolean(operationalHealth?.degradedMode.active),
    controlTransition: controlEvaluation.controlTransition,
    settingsCommandState: settingsCommandPlan.commandState,
    settingsNormalizationApplied: settingsCommandPlan.validation.normalizedSettingsApplied,
    scheduleCapacityRemaining: controlEvaluation.scheduling.capacityRemaining,
    pendingWorkBlocksDisable: controlEvaluation.pendingWork.disableBlockedByPending,
    nextSettingsReviewAt: settingsCommandPlan.schedulingReview.nextReviewAt
  };
}

function buildValidationSummary({ request, validation, providerIntegration, controlEvaluation }) {
  const blockers = validation.errors.map((message) => ({
    code: "revocation_validation_blocker",
    message,
    command: request.command,
    capabilityId: request.capabilityId,
    tenantId: request.tenantId,
    workspaceId: request.workspaceId
  }));
  const advisories = validation.warnings.map((message) => ({
    code: message.includes("proofId") ? "proof_required_before_commit" : "revocation_validation_advisory",
    message,
    command: request.command,
    providerIds: message.includes("provider contracts require proofId")
      ? providerIntegration.negotiation.proofBlockedProviders
      : []
  }));
  const scopeGaps = providerIntegration.negotiation.scopeBlockedProviders.flatMap((provider) => provider.missingScopes);
  const providerReady = providerIntegration.negotiation.eligibleProviderCount > 0
    || request.command === "inspect"
    || providerIntegration.handoff.state === "local-only";

  return {
    status: validation.ok ? "pass" : "fail",
    canPreview: true,
    canAccept: validation.ok,
    providerReady,
    requestNormalization: {
      contractVersion: request.normalization?.contractVersion || "revocation-request-normalization-v1",
      status: request.normalization?.errorCount ? "invalid" : request.normalization?.warningCount ? "normalized-with-warnings" : "accepted",
      issueCount: request.normalization?.issueCount || 0,
      errorCount: request.normalization?.errorCount || 0,
      warningCount: request.normalization?.warningCount || 0,
      commandWasCoerced: request.normalization?.commandWasCoerced === true,
      reasonWasRejected: request.normalization?.reasonWasRejected === true,
      proofModeWasCoerced: request.normalization?.proofModeWasCoerced === true,
      scheduleAtWasRejected: request.normalization?.scheduleAtWasRejected === true,
      issues: request.normalization?.issues || []
    },
    requiredScopes: request.requiredScopes,
    proofMode: request.proofMode,
    missingProviderScopes: [...new Set(scopeGaps)],
    missingProviderPreflightFields: [
      ...new Set(providerIntegration.negotiation.preflightBlockedProviders.flatMap((provider) => provider.missingFields))
    ],
    blockerCount: blockers.length,
    advisoryCount: advisories.length,
    blockers,
    advisories,
    checks: [
      {
        check: "request_shape",
        status: validation.errors.some((message) => message.includes("capabilityId") || message.includes("scheduleAt"))
          ? "fail"
          : "pass"
      },
      {
        check: "request_normalization",
        status: request.normalization?.errorCount
          ? "fail"
          : request.normalization?.warningCount
            ? "needs_review"
            : "pass"
      },
      {
        check: "policy_controls",
        status: validation.errors.some((message) => message.includes("blocked") || message.includes("disabled"))
          ? "fail"
          : "pass"
      },
      {
        check: "lifecycle_control_capacity",
        status: controlEvaluation.scheduling.wouldExceedCapacity || controlEvaluation.pendingWork.disableBlockedByPending
          ? "fail"
          : "pass"
      },
      {
        check: "provider_contract",
        status: providerReady ? "pass" : "fail"
      },
      {
        check: "provider_capability_scope",
        status: scopeGaps.length ? "fail" : "pass"
      },
      {
        check: "provider_proof_mode",
        status: providerIntegration.negotiation.proofModeBlockedProviders.length && !providerReady ? "fail" : "pass"
      },
      {
        check: "provider_preflight_contract",
        status: providerIntegration.negotiation.preflightBlockedProviders.length && !providerReady ? "fail" : "pass"
      },
      {
        check: "proof",
        status: advisories.some((advisory) => advisory.code === "proof_required_before_commit") ? "needs_input" : "pass"
      }
    ]
  };
}

function previewImpactRows({ request, settings, state, providerIntegration, controlEvaluation }) {
  const rows = [
    {
      id: "command",
      label: "Requested command",
      value: request.command,
      severity: state.mutationCommand ? "attention" : "neutral"
    },
    {
      id: "scope",
      label: "Capability scope",
      value: request.capabilityId || "workspace controls",
      severity: request.capabilityId ? "attention" : "neutral"
    },
    {
      id: "effective_at",
      label: "Effective time",
      value: request.command === "schedule" ? request.scheduleAt : "immediate",
      severity: request.command === "schedule" ? "attention" : "neutral"
    },
    {
      id: "controls",
      label: "Control state",
      value: settings.enabled ? "enabled" : "disabled",
      severity: settings.enabled || request.command === "enable" ? "neutral" : "blocker"
    },
    {
      id: "provider",
      label: "Provider handoff",
      value: providerIntegration.handoff.required
        ? `${providerIntegration.handoff.providerId} via ${providerIntegration.handoff.method} ${providerIntegration.handoff.route}`
        : providerIntegration.handoff.state,
      severity: providerIntegration.handoff.state === "blocked" ? "blocker" : providerIntegration.handoff.required ? "attention" : "neutral"
    },
    {
      id: "schedule_capacity",
      label: "Schedule capacity",
      value: `${controlEvaluation.scheduling.capacityRemaining} slots remaining`,
      severity: controlEvaluation.scheduling.wouldExceedCapacity ? "blocker" : controlEvaluation.scheduling.capacityRemaining <= 5 ? "attention" : "neutral"
    }
  ];

  return rows.filter((row) => row.value !== null && row.value !== undefined && row.value !== "");
}

function buildAcceptanceGate({ gate, passed, required = true, route, explanation, blockingCode = null }) {
  return {
    gate,
    status: passed ? "pass" : required ? "block" : "warn",
    required,
    route,
    explanation,
    blockingCode: passed ? null : blockingCode || `revocation_${gate}_not_ready`
  };
}

function buildPreviewAcceptance({ request, settings, validation, validationSummary, state, providerIntegration, controlEvaluation, now }) {
  const mutatesCapability = state.mutationCommand && validation.ok;
  const acceptanceState = !validation.ok
    ? "blocked"
    : state.degradedModeActive
      ? "degraded-checkpoint"
    : state.nextAction === "attach_proof"
      ? "needs-proof"
      : providerIntegration.handoff.required
        ? "ready-for-handoff"
        : mutatesCapability
          ? "ready-for-commit"
          : "read-only";
  const effectiveAt = request.command === "schedule" ? request.scheduleAt : now;
  const routeBase = `/capability-security/revocation/${request.command}`;
  const acceptanceToken = validation.ok
    ? `${surfaceId}:${request.tenantId || "hosted-kernel-tenant"}:${request.workspaceId || "default-workspace"}:${request.command}:${request.capabilityId || "global"}:${request.requestedAt}`
    : null;
  const impactRows = previewImpactRows({ request, settings, state, providerIntegration, controlEvaluation });
  const acceptanceGates = [
    buildAcceptanceGate({
      gate: "validation",
      passed: validation.ok,
      route: "/capability-security/revocation/validate",
      explanation: validation.ok
        ? "Request validation passed"
        : `${validationSummary.blockerCount} validation blockers must be resolved`,
      blockingCode: "revocation_validation_failed"
    }),
    buildAcceptanceGate({
      gate: "proof",
      passed: Boolean(request.proofId) || state.nextAction !== "attach_proof",
      required: state.nextAction === "attach_proof" || request.command === "revoke",
      route: "/capability-security/revocation/proof",
      explanation: request.proofId
        ? "Proof is attached"
        : state.nextAction === "attach_proof"
          ? "Attach proof before accepting the revocation"
          : "Proof is not required for this command",
      blockingCode: "revocation_proof_required"
    }),
    buildAcceptanceGate({
      gate: "provider_preflight",
      passed: !providerIntegration.handoff.required
        || providerIntegration.handoff.state === "ready"
        || state.degradedModeActive,
      required: providerIntegration.handoff.required,
      route: providerIntegration.handoff.route || "/capability-security/revocation/providers",
      explanation: state.degradedModeActive
        ? "Provider handoff is replaced by a local degraded checkpoint until recovery"
        : providerIntegration.handoff.required
        ? "Selected provider preflight is ready for handoff"
        : "Provider handoff is not required",
      blockingCode: "revocation_provider_preflight_not_ready"
    }),
    buildAcceptanceGate({
      gate: "schedule_capacity",
      passed: !controlEvaluation.scheduling.wouldExceedCapacity,
      required: request.command === "schedule",
      route: "/capability-security/revocation/schedule",
      explanation: controlEvaluation.scheduling.wouldExceedCapacity
        ? "Schedule capacity must be raised before accepting"
        : `${controlEvaluation.scheduling.capacityRemaining} schedule slots remain`,
      blockingCode: "revocation_schedule_capacity_exceeded"
    }),
    buildAcceptanceGate({
      gate: "pending_work",
      passed: !controlEvaluation.pendingWork.disableBlockedByPending,
      required: request.command === "disable",
      route: "/capability-security/revocation/recovery/review",
      explanation: controlEvaluation.pendingWork.disableBlockedByPending
        ? "Pending revocation work must be cleared or explicitly overridden"
        : "Pending work does not block this command",
      blockingCode: "revocation_pending_work_blocks_disable"
    })
  ];
  const requiredGatesBlocked = acceptanceGates.filter((gate) => gate.required && gate.status === "block");
  const submitRoute = providerIntegration.handoff.required
    ? providerIntegration.handoff.route
    : acceptanceState === "needs-proof"
      ? "/capability-security/revocation/proof"
      : routeBase;

  return {
    contract: {
      version: "revocation-preview-acceptance-v2",
      audience: "hosted-kernel-client",
      previewFields: ["title", "impactRows", "reviewChecklist", "route"],
      acceptanceFields: ["state", "acceptanceToken", "gates", "formContract"],
      readinessFields: ["lifecycleReady", "externalHandoffReady", "localCommitReady", "nextAction"],
      validationSummaryFields: ["status", "requestNormalization", "blockerCount", "advisoryCount", "checks"]
    },
    preview: {
      title: request.command === "inspect"
        ? "Inspect revocation controls"
        : `${request.command} capability revocation`,
      command: request.command,
      capabilityId: request.capabilityId,
      reason: request.reason,
      actor: request.actor,
      effectiveAt,
      mutatesCapability,
      expectedOutcome: validation.ok
        ? state.nextAction
        : "request_rejected",
      providerId: providerIntegration.negotiation.selectedProviderId,
      providerContractVersion: providerIntegration.negotiation.selectedContractVersion,
      route: routeBase,
      impactRows,
      reviewChecklist: acceptanceGates.map((gate) => ({
        item: gate.gate,
        status: gate.status,
        required: gate.required,
        route: gate.route,
        explanation: gate.explanation
      }))
    },
    acceptance: {
      state: acceptanceState,
      accepted: validation.ok && requiredGatesBlocked.length === 0,
      acceptanceToken,
      requiresOperatorConfirmation: mutatesCapability,
      requiresProof: state.nextAction === "attach_proof" || providerIntegration.negotiation.proofBlockedProviders.length > 0,
      proofId: request.proofId,
      readyAt: validation.ok && requiredGatesBlocked.length === 0 ? now : null,
      gates: acceptanceGates,
      blockedGateCount: requiredGatesBlocked.length,
      blockedGateCodes: requiredGatesBlocked.map((gate) => gate.blockingCode),
      formContract: {
        method: providerIntegration.handoff.required ? providerIntegration.handoff.method : "POST",
        route: submitRoute,
        submitLabel: acceptanceState === "read-only"
          ? "Refresh"
          : acceptanceState === "needs-proof"
            ? "Attach proof"
            : providerIntegration.handoff.required
              ? "Accept and hand off"
              : "Accept and commit",
        disabled: !validation.ok || requiredGatesBlocked.length > 0,
        disabledReason: !validation.ok
          ? "Fix validation blockers before accepting"
          : requiredGatesBlocked.length
            ? `Resolve ${requiredGatesBlocked.length} required acceptance gates`
            : null,
        requiredFields: [
          "surfaceId",
          "command",
          "tenantId",
          "workspaceId",
          ...(request.capabilityId ? ["capabilityId"] : []),
          ...(request.command === "schedule" ? ["scheduleAt"] : []),
          ...(state.nextAction === "attach_proof" ? ["proofId"] : [])
        ],
        hiddenFields: {
          acceptanceToken,
          operationKey: buildRestartSafeOperationKey(request),
          externalCorrelationId: request.externalCorrelationId
        }
      },
      validationSummary: {
        status: validationSummary.status,
        requestNormalization: validationSummary.requestNormalization,
        blockerCount: validationSummary.blockerCount,
        advisoryCount: validationSummary.advisoryCount,
        checks: validationSummary.checks
      }
    },
    readiness: {
      controlsEnabled: settings.enabled,
      lifecycleReady: validation.ok,
      externalHandoffReady: providerIntegration.handoff.required && providerIntegration.handoff.state === "ready",
      externalHandoffLeaseExpiresAt: providerIntegration.handoff.externalState?.leaseExpiresAt || null,
      localCommitReady: validation.ok && !providerIntegration.handoff.required && state.nextAction === "commit_lifecycle_command",
      scheduleReady: state.scheduled,
      scheduleCapacityRemaining: controlEvaluation.scheduling.capacityRemaining,
      scheduleCapacityReady: !controlEvaluation.scheduling.wouldExceedCapacity,
      proofReady: Boolean(request.proofId) || state.nextAction !== "attach_proof",
      pendingWorkBlocksDisable: controlEvaluation.pendingWork.disableBlockedByPending,
      controlTransition: controlEvaluation.controlTransition,
      degradedModeActive: state.degradedModeActive,
      nextAction: state.nextAction
    }
  };
}

function buildPersistenceRecovery({ request, validation, state, providerIntegration, previewAcceptance, persistedState, now }) {
  const existing = persistedState.matchingRecord;
  const statusDescriptor = classifyPersistedRestartStatus(existing, request, now);
  const duplicateRecords = persistedState.records.filter((record) => (
    record.operationKey !== persistedState.currentOperationKey
    && record.idempotencyKey === persistedState.currentIdempotencyKey
  ));
  const conflictingDuplicateRecords = duplicateRecords.filter((record) => (
    record.command !== request.command || (record.capabilityId || null) !== (request.capabilityId || null)
  ));
  const shouldReplay = validation.ok
    && !statusDescriptor.durableAccepted
    && !statusDescriptor.operatorReview
    && !state.degradedModeActive
    && (statusDescriptor.replayable || (!existing && state.nextAction === "handoff_to_provider"));
  const restartStatus = validation.ok
    ? statusDescriptor.restartStatus
    : "not-persistable";
  const selectedProviderPreflight = providerIntegration.handoff.payloadContract
    ? {
        requiredFields: providerIntegration.handoff.payloadContract.requiredFields,
        missingFields: providerIntegration.handoff.payloadContract.missingPreflightFields,
        replayToken: providerIntegration.handoff.externalState?.replayToken || existing?.providerPreflight?.replayToken || existing?.replayToken || null,
        replayTokenExpiresAt: providerIntegration.handoff.externalState?.replayTokenExpiresAt || existing?.providerPreflight?.replayTokenExpiresAt || null,
        idempotencyWindowSeconds: providerIntegration.handoff.payloadContract.idempotencyWindowSeconds
      }
    : existing?.providerPreflight || null;
  const nextRecord = validation.ok
    ? {
        recordContractVersion: "revocation-ledger-record-v2",
        operationKey: persistedState.currentOperationKey,
        ledgerEntryId: existing?.ledgerEntryId || `${surfaceName}:${request.command}:${request.capabilityId || "global"}`,
        command: request.command,
        capabilityId: request.capabilityId,
        tenantId: request.tenantId,
        workspaceId: request.workspaceId,
        reason: request.reason,
        proofId: request.proofId,
        providerId: providerIntegration.negotiation.selectedProviderId,
        providerContractVersion: providerIntegration.negotiation.selectedContractVersion,
        externalCorrelationId: request.externalCorrelationId,
        providerPreflight: selectedProviderPreflight,
        leaseExpiresAt: providerIntegration.handoff.externalState?.leaseExpiresAt || existing?.leaseExpiresAt || null,
        replayToken: selectedProviderPreflight?.replayToken || null,
        requiredScopes: request.requiredScopes,
        proofMode: request.proofMode,
        status: statusDescriptor.durableAccepted
          ? existing.status
          : previewAcceptance.acceptance.state,
        previousStatus: existing?.status || null,
        restartStatus,
        recoveryPhase: statusDescriptor.phase,
        recoveryReason: statusDescriptor.statusReason,
        scheduleAt: request.scheduleAt,
        idempotencyKey: existing?.idempotencyKey
          || providerIntegration.handoff.idempotencyKey
          || previewAcceptance.acceptance.acceptanceToken
          || persistedState.currentIdempotencyKey,
        attemptCount: existing?.attemptCount || 0,
        lastError: statusDescriptor.operatorReview ? existing.lastError : null,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        completedAt: statusDescriptor.durableAccepted ? existing.completedAt || existing.updatedAt || now : null
      }
    : null;
  const statePatch = buildPersistedStatePatch({
    persistedState,
    existing,
    nextRecord,
    statusDescriptor,
    duplicateRecords,
    now
  });

  return {
    persistenceContract: {
      version: persistedState.storeVersion,
      requiredFields: ["operationKey", "tenantId", "workspaceId", "status", "idempotencyKey", "updatedAt"],
      acceptedInputAliases: ["persistedState", "recoveryState", "revocationLedger"],
      statusSemantics: {
        terminal: ["completed", "revoked", "restored", "disabled", "enabled"],
        resumable: ["pending", "ready-for-handoff", "ready-for-commit", "needs-proof", "replaying"],
        operatorReview: ["blocked", "failed"]
      },
      providerFields: {
        requiredOnExternalHandoff: ["providerId", "providerContractVersion", "idempotencyKey"],
        syncStateFields: ["cursor", "watermark", "leaseExpiresAt", "ackRequired"],
        preflightFields: ["requiredFields", "missingPreflightFields", "replayToken", "replayTokenExpiresAt"]
      },
      restartStatusSemantics: {
        alreadyApplied: "terminal or durable accepted records must be returned without a second mutation",
        resumePending: "matching resumable records keep the original idempotency key and replay token when still valid",
        resumeBlockedStaleState: "expired leases, expired replay tokens, or changed command shape require a fresh checkpoint",
        requiresOperatorReview: "blocked and failed records are never replayed automatically"
      }
    },
    restart: {
      status: restartStatus,
      operationKey: persistedState.currentOperationKey,
      idempotencyKey: nextRecord?.idempotencyKey || persistedState.currentIdempotencyKey,
      phase: statusDescriptor.phase,
      reason: validation.ok ? statusDescriptor.statusReason : "request_not_valid_for_persistence",
      duplicateOfLedgerEntryId: statusDescriptor.durableAccepted ? existing.ledgerEntryId : null,
      resumeLedgerEntryId: statusDescriptor.resumable ? existing.ledgerEntryId : null,
      leaseExpired: statusDescriptor.leaseExpired,
      replayTokenExpired: statusDescriptor.replayTokenExpired,
      conflictingDuplicateCount: conflictingDuplicateRecords.length,
      conflictingDuplicateOperationKeys: conflictingDuplicateRecords.map((record) => record.operationKey),
      loadedAt: persistedState.loadedAt,
      lastCheckpointAt: persistedState.lastCheckpointAt
    },
    checkpoint: {
      action: validation.ok ? "upsert_revocation_checkpoint" : "skip_checkpoint_until_valid",
      snapshotId: persistedState.snapshotId,
      checkpointId: persistedState.checkpointId,
      generatedAt: now,
      nextRecord,
      statePatch
    },
    recoveryPath: statusDescriptor.durableAccepted
      ? {
          action: "return_existing_revocation_result",
          method: "GET",
          route: `/capability-security/revocation/ledger/${existing.ledgerEntryId}`,
          enabled: true,
          payload: {
            operationKey: persistedState.currentOperationKey,
            ledgerEntryId: existing.ledgerEntryId,
            status: existing.status,
            idempotencyKey: existing.idempotencyKey
          }
        }
      : statusDescriptor.operatorReview
        ? {
            action: "review_blocked_revocation",
            method: "POST",
            route: "/capability-security/revocation/recovery/review",
            enabled: true,
            payload: {
              operationKey: persistedState.currentOperationKey,
              ledgerEntryId: existing.ledgerEntryId,
              lastError: existing.lastError,
              recoveryPhase: statusDescriptor.phase,
              recoveryReason: statusDescriptor.statusReason
            }
          }
        : shouldReplay
          ? {
              action: "replay_idempotent_revocation",
              method: providerIntegration.handoff.required ? providerIntegration.handoff.method : "POST",
              route: providerIntegration.handoff.required
                ? providerIntegration.handoff.route
                : `/capability-security/revocation/${state.nextAction}`,
              enabled: true,
              payload: {
                operationKey: persistedState.currentOperationKey,
                idempotencyKey: nextRecord.idempotencyKey,
                command: request.command,
                capabilityId: request.capabilityId,
                tenantId: request.tenantId,
                workspaceId: request.workspaceId,
                externalCorrelationId: request.externalCorrelationId,
                providerPreflight: nextRecord.providerPreflight,
                leaseExpiresAt: nextRecord.leaseExpiresAt,
                replayToken: nextRecord.replayToken,
                requiredScopes: request.requiredScopes,
                proofMode: request.proofMode,
                recoveryPhase: statusDescriptor.phase,
                recoveryReason: statusDescriptor.statusReason
              }
            }
          : null,
    dirtyRecordCount: persistedState.dirtyRecords.length
  };
}

function statusForHostedKernelCommand(command, acceptanceState) {
  if (acceptanceState === "read-only") {
    return "observed";
  }
  if (command === "enable") {
    return "enabled";
  }
  if (command === "disable") {
    return "disabled";
  }
  if (command === "restore") {
    return "restored";
  }
  if (command === "revoke") {
    return "revoked";
  }
  if (command === "schedule") {
    return "scheduled";
  }
  return acceptanceState;
}

function buildHostedKernelRevocationPlan({
  request,
  validation,
  state,
  providerIntegration,
  previewAcceptance,
  persistenceRecovery,
  operationalHealth,
  controlEvaluation,
  settingsCommandPlan,
  boundaryContext,
  now
}) {
  const externalHandoff = providerIntegration.handoff.required && !operationalHealth.degradedMode.active;
  const localCommitReady = validation.ok
    && !externalHandoff
    && ["commit_lifecycle_command", "queue_revocation", "checkpoint_degraded_revocation", "monitor"].includes(state.nextAction);
  const ledgerStatus = validation.ok
    ? statusForHostedKernelCommand(request.command, previewAcceptance.acceptance.state)
    : "blocked";
  const commandMutation = {
    enable: "set_revocation_controls_enabled",
    disable: "set_revocation_controls_disabled",
    schedule: "append_scheduled_revocation",
    revoke: "mark_capability_revoked",
    restore: "mark_capability_restored",
    inspect: "read_revocation_state"
  }[request.command] || "record_revocation_command";
  const proofMaterial = [
    surfaceId,
    persistenceRecovery.restart.operationKey,
    persistenceRecovery.restart.idempotencyKey,
    request.command,
    request.capabilityId || "global",
    ledgerStatus,
    boundaryContext.tenantId,
    boundaryContext.workspaceId,
    now
  ].join("|");

  return {
    contract: {
      version: "hosted-kernel-revocation-execution-v1",
      executionModes: ["local-commit", "external-handoff", "degraded-checkpoint", "read-only", "blocked"],
      requiredLedgerFields: ["operationKey", "ledgerEntryId", "tenantId", "workspaceId", "command", "status", "idempotencyKey", "proofReceiptId"],
      emittedArtifacts: ["ledgerWrite", "capabilityPatch", "settingsPatch", "proofReceipt", "auditDigest"]
    },
    execution: {
      mode: !validation.ok
        ? "blocked"
        : externalHandoff
          ? "external-handoff"
          : operationalHealth.degradedMode.active
            ? "degraded-checkpoint"
            : previewAcceptance.acceptance.state === "read-only"
              ? "read-only"
              : "local-commit",
      localCommitReady,
      commandMutation,
      effectiveAt: request.command === "schedule" ? request.scheduleAt : now,
      route: externalHandoff
        ? providerIntegration.handoff.route
        : operationalHealth.degradedMode.active
          ? "/capability-security/revocation/degraded-checkpoints"
          : `/capability-security/revocation/kernel/${request.command}`,
      method: externalHandoff ? providerIntegration.handoff.method : "POST"
    },
    ledgerWrite: validation.ok
      ? {
          operationKey: persistenceRecovery.restart.operationKey,
          ledgerEntryId: persistenceRecovery.checkpoint.nextRecord?.ledgerEntryId || `${surfaceName}:${request.command}:${request.capabilityId || "global"}`,
          tenantId: boundaryContext.tenantId,
          workspaceId: boundaryContext.workspaceId,
          command: request.command,
          capabilityId: request.capabilityId,
          reason: request.reason,
          status: ledgerStatus,
          scheduleAt: request.scheduleAt,
          providerId: providerIntegration.negotiation.selectedProviderId || "hosted-kernel",
          idempotencyKey: persistenceRecovery.restart.idempotencyKey,
          proofReceiptId: `${surfaceName}:proof:${persistenceRecovery.restart.operationKey}`,
          updatedAt: now
        }
      : null,
    capabilityPatch: validation.ok && request.capabilityId
      ? {
          capabilityId: request.capabilityId,
          tenantId: boundaryContext.tenantId,
          workspaceId: boundaryContext.workspaceId,
          patchType: commandMutation,
          lifecycleState: request.command === "revoke"
            ? "revoked"
            : request.command === "restore"
              ? "active"
              : request.command === "schedule"
                ? "revocation-scheduled"
                : "unchanged",
          effectiveAt: request.command === "schedule" ? request.scheduleAt : now,
          reason: request.reason,
          proofId: request.proofId
        }
      : null,
    settingsPatch: validation.ok ? settingsCommandPlan.settingsPatch : null,
    proofReceipt: validation.ok
      ? {
          proofReceiptId: `${surfaceName}:proof:${persistenceRecovery.restart.operationKey}`,
          proofMode: request.proofMode,
          suppliedProofId: request.proofId,
          generatedAt: now,
          materialFields: ["surfaceId", "operationKey", "idempotencyKey", "command", "capabilityId", "status", "tenantId", "workspaceId", "generatedAt"],
          auditDigest: proofMaterial,
          boundarySatisfied: boundaryContext.enforcement.permissionSatisfied && boundaryContext.enforcement.resourceInBoundary,
          controlsSatisfied: !controlEvaluation.pendingWork.disableBlockedByPending && !controlEvaluation.scheduling.wouldExceedCapacity
        }
      : null
  };
}

function buildNextStepContracts({ request, validation, validationSummary, state, providerIntegration, previewAcceptance, persistenceRecovery, hostedKernelPlan, operationalHealth, controlEvaluation, settingsCommandPlan, now }) {
  const degradedCheckpoint = operationalHealth.degradedMode.active;
  const nextStep = {
    action: state.nextAction,
    label: state.nextAction.replaceAll("_", " "),
    method: providerIntegration.handoff.required && !degradedCheckpoint ? providerIntegration.handoff.method : "POST",
    route: degradedCheckpoint
      ? "/capability-security/revocation/degraded-checkpoints"
      : providerIntegration.handoff.required
      ? providerIntegration.handoff.route
      : `/capability-security/revocation/${state.nextAction}`,
    enabled: validation.ok,
    payload: {
      surfaceId,
      command: request.command,
      capabilityId: request.capabilityId,
      tenantId: request.tenantId,
      workspaceId: request.workspaceId,
      reason: request.reason,
      proofId: request.proofId,
      scheduleAt: request.scheduleAt,
      acceptanceToken: previewAcceptance.acceptance.acceptanceToken,
      operationKey: persistenceRecovery.restart.operationKey,
      idempotencyKey: persistenceRecovery.restart.idempotencyKey,
      providerContractVersion: providerIntegration.negotiation.selectedContractVersion,
      providerPreflight: providerIntegration.handoff.payloadContract,
      providerReplayToken: providerIntegration.handoff.externalState?.replayToken || null,
      externalCorrelationId: request.externalCorrelationId,
      requiredScopes: request.requiredScopes,
      proofMode: request.proofMode,
      hostedKernelExecution: {
        mode: hostedKernelPlan.execution.mode,
        commandMutation: hostedKernelPlan.execution.commandMutation,
        proofReceiptId: hostedKernelPlan.proofReceipt?.proofReceiptId || null,
        settingsCommandState: settingsCommandPlan.commandState
      },
      operationalSafety: {
        healthStatus: operationalHealth.status,
        degradedModeActive: operationalHealth.degradedMode.active,
        providerFailureCategory: operationalHealth.selectedFailure.category,
        retryable: operationalHealth.retry.retryable,
        nextRetryAt: operationalHealth.retry.nextRetryAt,
        providerCircuit: operationalHealth.selectedProvider?.circuit || null
      }
    }
  };
  const validationRoute = {
    action: "validate_revocation_request",
    method: "POST",
    route: "/capability-security/revocation/validate",
    enabled: true,
    payload: {
      surfaceId,
      command: request.command,
      capabilityId: request.capabilityId,
      tenantId: request.tenantId,
      workspaceId: request.workspaceId,
      requestedAt: request.requestedAt
    }
  };

  return {
    generatedAt: now,
    previewAcceptance: {
      action: "render_revocation_preview_acceptance",
      method: "POST",
      route: "/capability-security/revocation/preview",
      enabled: true,
      payload: {
        contractVersion: previewAcceptance.contract.version,
        surfaceId,
        command: request.command,
        capabilityId: request.capabilityId,
        tenantId: request.tenantId,
        workspaceId: request.workspaceId,
        preview: previewAcceptance.preview,
        acceptance: {
          state: previewAcceptance.acceptance.state,
          accepted: previewAcceptance.acceptance.accepted,
          acceptanceToken: previewAcceptance.acceptance.acceptanceToken,
          requiresOperatorConfirmation: previewAcceptance.acceptance.requiresOperatorConfirmation,
          requiresProof: previewAcceptance.acceptance.requiresProof,
          readyAt: previewAcceptance.acceptance.readyAt,
          gates: previewAcceptance.acceptance.gates,
          blockedGateCount: previewAcceptance.acceptance.blockedGateCount,
          blockedGateCodes: previewAcceptance.acceptance.blockedGateCodes,
          formContract: previewAcceptance.acceptance.formContract
        },
        readiness: previewAcceptance.readiness,
        validationSummary: {
          status: validationSummary.status,
          providerReady: validationSummary.providerReady,
          requestNormalization: validationSummary.requestNormalization,
          blockerCount: validationSummary.blockerCount,
          advisoryCount: validationSummary.advisoryCount,
          checks: validationSummary.checks
        }
      }
    },
    primary: nextStep,
    validation: validationRoute,
    persistence: {
      action: persistenceRecovery.checkpoint.action,
      method: "PUT",
      route: "/capability-security/revocation/checkpoints",
      enabled: validation.ok,
      payload: {
        snapshotId: persistenceRecovery.checkpoint.snapshotId,
        checkpointId: persistenceRecovery.checkpoint.checkpointId,
        record: persistenceRecovery.checkpoint.nextRecord
      }
    },
    settingsControls: {
      action: controlEvaluation.controlTransition,
      method: "POST",
      route: request.command === "enable"
        ? controlEvaluation.commands.enable.route
        : request.command === "disable"
          ? controlEvaluation.commands.disable.route
          : "/capability-security/revocation/settings/validate",
      enabled: validation.ok && ["enable", "disable"].includes(request.command),
      payload: {
        surfaceId,
        command: request.command,
        tenantId: request.tenantId,
        workspaceId: request.workspaceId,
        operationKey: persistenceRecovery.restart.operationKey,
        idempotencyKey: persistenceRecovery.restart.idempotencyKey,
        resultingEnabled: request.command === "enable"
          ? true
          : request.command === "disable"
            ? false
            : controlEvaluation.controlsEnabled,
        overridePending: controlEvaluation.overridePending,
        pendingWork: controlEvaluation.pendingWork,
        commandState: settingsCommandPlan.commandState,
        settingsPatch: settingsCommandPlan.settingsPatch,
        normalizationWarnings: settingsCommandPlan.validation.warnings,
        nextActions: settingsCommandPlan.nextActions
      }
    },
    schedulingControls: {
      action: controlEvaluation.scheduling.wouldExceedCapacity ? "raise_schedule_capacity" : "accept_schedule_capacity",
      method: "POST",
      route: controlEvaluation.commands.schedule.route,
      enabled: request.command === "schedule" && validation.ok,
      payload: {
        surfaceId,
        tenantId: request.tenantId,
        workspaceId: request.workspaceId,
        maxScheduledRevocations: controlEvaluation.scheduling.maxScheduledRevocations,
        activeScheduledCount: controlEvaluation.scheduling.activeScheduledCount,
        capacityRemaining: controlEvaluation.scheduling.capacityRemaining,
        scheduledOperationKeys: controlEvaluation.scheduling.scheduledOperationKeys,
        scheduledClientEntryIds: controlEvaluation.scheduling.scheduledClientEntryIds,
        boundaryScope: controlEvaluation.boundaryScopedWorksets,
        nextReviewAt: settingsCommandPlan.schedulingReview.nextReviewAt,
        requestedScheduleAt: settingsCommandPlan.schedulingReview.requestedScheduleAt
      }
    },
    providerHandoff: providerIntegration.handoff.required
      && !degradedCheckpoint
      ? {
          action: "handoff_to_provider",
          providerId: providerIntegration.handoff.providerId,
          externalState: providerIntegration.handoff.externalState,
          payloadContract: providerIntegration.handoff.payloadContract,
          method: providerIntegration.handoff.method,
          route: providerIntegration.handoff.route,
          idempotencyKey: persistenceRecovery.restart.idempotencyKey,
          payload: nextStep.payload
      }
      : null,
    hostedKernelCommit: {
      action: hostedKernelPlan.execution.commandMutation,
      method: hostedKernelPlan.execution.method,
      route: hostedKernelPlan.execution.route,
      enabled: hostedKernelPlan.execution.localCommitReady,
      executionMode: hostedKernelPlan.execution.mode,
      ledgerWrite: hostedKernelPlan.ledgerWrite,
      capabilityPatch: hostedKernelPlan.capabilityPatch,
      proofReceipt: hostedKernelPlan.proofReceipt
    },
    operationalHealth: {
      action: operationalHealth.status === "healthy" ? "record_health_snapshot" : "surface_operational_health",
      method: "POST",
      route: operationalHealth.selectedFailure.route || "/capability-security/revocation/health",
      enabled: true,
      payload: {
        status: operationalHealth.status,
        degradedModeActive: operationalHealth.degradedMode.active,
        selectedFailure: operationalHealth.selectedFailure,
        providerCircuit: operationalHealth.selectedProvider?.circuit || null,
        retry: operationalHealth.retry,
        actionableErrors: operationalHealth.actionableErrors,
        boundaryScope: controlEvaluation.boundaryScopedWorksets
      }
    },
    recovery: persistenceRecovery.recoveryPath || (validation.ok
      ? null
      : {
          action: "fix_request",
          method: "POST",
          route: "/capability-security/revocation/validate",
          enabled: true,
          payload: validationRoute.payload
        })
  };
}

function buildClientRuntimeOutcome({
  request,
  validation,
  state,
  providerIntegration,
  previewAcceptance,
  clientRuntime,
  persistenceRecovery,
  hostedKernelPlan,
  operationalHealth,
  continuationAdoption,
  routeTarget,
  now
}) {
  const commandTargetsCapability = Boolean(request.capabilityId);
  const localLedgerAccepted = validation.ok && hostedKernelPlan.execution.mode === "local-commit";
  const externalHandoffReady = validation.ok && providerIntegration.handoff.required && !operationalHealth.degradedMode.active;
  const degradedCheckpointActive = validation.ok && operationalHealth.degradedMode.active;
  const proofStillRequired = previewAcceptance.acceptance.requiresProof && !request.proofId;
  const currentCapabilityState = request.command === "revoke"
    ? "revoked"
    : request.command === "restore"
      ? "active"
      : request.command === "schedule"
        ? "revocation-scheduled"
        : "unchanged";
  const visibleState = !validation.ok
    ? "blocked"
    : proofStillRequired
      ? "needs-proof"
      : externalHandoffReady
        ? "handoff-pending"
        : degradedCheckpointActive
          ? "checkpointed"
          : localLedgerAccepted
            ? currentCapabilityState
            : previewAcceptance.acceptance.state;
  const optimisticAllowed = validation.ok
    && commandTargetsCapability
    && !proofStillRequired
    && !externalHandoffReady
    && !degradedCheckpointActive
    && ["revoke", "restore", "schedule"].includes(request.command);
  const reconciliationAction = !validation.ok
    ? "discard_optimistic_change"
    : proofStillRequired
      ? "hold_until_proof_attached"
      : externalHandoffReady
        ? "wait_for_provider_ack"
        : degradedCheckpointActive
          ? "persist_degraded_checkpoint_badge"
          : optimisticAllowed
            ? "apply_kernel_confirmed_state"
            : "refresh_revocation_view";
  const badges = [
    ...(externalHandoffReady ? ["provider-handoff"] : []),
    ...(degradedCheckpointActive ? ["degraded-checkpoint"] : []),
    ...(proofStillRequired ? ["proof-required"] : []),
    ...(continuationAdoption.canResume ? ["resumed"] : []),
    ...(persistenceRecovery.restart.status === "already-applied" ? ["already-applied"] : [])
  ];

  return {
    contractVersion: "revocation-client-runtime-outcome-v1",
    generatedAt: now,
    requestId: clientRuntime.requestId,
    workflowId: clientRuntime.workflowId,
    operationKey: persistenceRecovery.restart.operationKey,
    capabilityId: request.capabilityId,
    visibleState,
    reconciliationAction,
    optimisticAllowed,
    routeTarget,
    badges,
    ledgerProjection: hostedKernelPlan.ledgerWrite
      ? {
          ledgerEntryId: hostedKernelPlan.ledgerWrite.ledgerEntryId,
          status: hostedKernelPlan.ledgerWrite.status,
          proofReceiptId: hostedKernelPlan.ledgerWrite.proofReceiptId,
          effectiveAt: hostedKernelPlan.execution.effectiveAt
        }
      : null,
    capabilityProjection: hostedKernelPlan.capabilityPatch
      ? {
          capabilityId: hostedKernelPlan.capabilityPatch.capabilityId,
          lifecycleState: hostedKernelPlan.capabilityPatch.lifecycleState,
          patchType: hostedKernelPlan.capabilityPatch.patchType,
          effectiveAt: hostedKernelPlan.capabilityPatch.effectiveAt
        }
      : null,
    providerProjection: providerIntegration.handoff.required
      ? {
          providerId: providerIntegration.handoff.providerId,
          handoffState: providerIntegration.handoff.state,
          leaseExpiresAt: providerIntegration.handoff.externalState?.leaseExpiresAt || null,
          replayToken: providerIntegration.handoff.externalState?.replayToken || null,
          ackRequired: providerIntegration.handoff.externalState?.ackRequired === true
        }
      : null,
    operatorNotice: {
      level: validation.ok
        ? operationalHealth.status === "degraded" || proofStillRequired ? "warning" : "info"
        : "error",
      code: validation.ok
        ? reconciliationAction
        : "revocation_runtime_reconciliation_blocked",
      route: routeTarget,
      message: validation.ok
        ? proofStillRequired
          ? "Attach proof before the client can apply the revocation workflow"
          : externalHandoffReady
            ? "Provider handoff is ready; client state waits for acknowledgement"
            : degradedCheckpointActive
              ? "Revocation is checkpointed locally until provider recovery"
              : "Client state can reconcile with the hosted-kernel ledger projection"
        : "Client state must keep the prior capability view until validation blockers are fixed"
    }
  };
}

function buildClientWorkflowHandoff({ request, validation, state, providerIntegration, previewAcceptance, clientRuntime, persistenceRecovery, hostedKernelPlan, operationalHealth, settingsCommandPlan, now }) {
  const degradedCheckpoint = operationalHealth.degradedMode.active;
  const continuationAdoption = buildClientContinuationAdoption({
    request,
    validation,
    state,
    providerIntegration,
    previewAcceptance,
    clientRuntime,
    persistenceRecovery,
    operationalHealth,
    now
  });
  const pendingEntry = {
    clientEntryId: `${clientRuntime.workflowId}:${request.command}`,
    requestId: clientRuntime.requestId,
    command: request.command,
    capabilityId: request.capabilityId,
    tenantId: request.tenantId,
    workspaceId: request.workspaceId,
    reason: request.reason,
    proofId: request.proofId,
    status: validation.ok ? previewAcceptance.acceptance.state : "blocked",
    providerId: providerIntegration.negotiation.selectedProviderId,
    providerContractVersion: providerIntegration.negotiation.selectedContractVersion,
    externalCorrelationId: request.externalCorrelationId,
    providerPreflight: providerIntegration.handoff.payloadContract
      ? {
          requiredFields: providerIntegration.handoff.payloadContract.requiredFields,
          missingFields: providerIntegration.handoff.payloadContract.missingPreflightFields,
          replayToken: providerIntegration.handoff.externalState?.replayToken || null
        }
      : null,
    operationKey: persistenceRecovery.restart.operationKey,
    idempotencyKey: persistenceRecovery.restart.idempotencyKey,
    updatedAt: now
  };
  const queueAction = request.command === "inspect"
    ? "none"
    : validation.ok
      ? "upsert_pending_revocation"
      : "surface_validation_errors";
  const routeTarget = providerIntegration.handoff.required
    && !degradedCheckpoint
    ? providerIntegration.handoff.route
    : degradedCheckpoint
      ? "/capability-security/revocation/degraded-checkpoints"
    : state.nextAction === "attach_proof"
      ? "/capability-security/revocation/proof"
      : `/capability-security/revocation/${state.nextAction}`;
  const runtimeOutcome = buildClientRuntimeOutcome({
    request,
    validation,
    state,
    providerIntegration,
    previewAcceptance,
    clientRuntime,
    persistenceRecovery,
    hostedKernelPlan,
    operationalHealth,
    continuationAdoption,
    routeTarget,
    now
  });

  return {
    runtimeContract: {
      version: clientRuntime.stateVersion,
      requiredFields: ["sessionId", "requestId", "workflowId", "currentRoute"],
      acceptedInputAliases: ["clientRuntime", "clientState"],
      emittedFields: ["clientPatch", "runtimeOutcome", "handoffEnvelope", "userNotice"]
    },
    clientPatch: {
      sessionId: clientRuntime.sessionId,
      requestId: clientRuntime.requestId,
      workflowId: clientRuntime.workflowId,
      selectedCapabilityId: request.capabilityId || clientRuntime.selectedCapabilityId,
      activeProofId: request.proofId || clientRuntime.activeProofId,
      queueAction,
      pendingRevocation: queueAction === "upsert_pending_revocation" ? pendingEntry : null,
      continuationAction: continuationAdoption.action,
      handoffContinuation: continuationAdoption.nextContinuation,
      staleContinuationIds: continuationAdoption.staleContinuationIds,
      runtimeOutcome,
      persistedCheckpoint: validation.ok
        ? {
            action: persistenceRecovery.checkpoint.action,
            snapshotId: persistenceRecovery.checkpoint.snapshotId,
            checkpointId: persistenceRecovery.checkpoint.checkpointId,
            restartStatus: persistenceRecovery.restart.status
          }
        : null,
      settingsCommand: settingsCommandPlan.lifecycleCommand
        ? {
            state: settingsCommandPlan.commandState,
            settingsPatch: settingsCommandPlan.settingsPatch,
            nextReviewAt: settingsCommandPlan.schedulingReview.nextReviewAt
          }
        : null,
      preserveReturnRoute: clientRuntime.returnRoute,
      generatedAt: now
    },
    navigation: {
      from: clientRuntime.currentRoute,
      to: routeTarget,
      returnRoute: clientRuntime.returnRoute,
      external: providerIntegration.handoff.required && !degradedCheckpoint,
      method: providerIntegration.handoff.required && !degradedCheckpoint ? providerIntegration.handoff.method : "POST"
    },
    continuation: continuationAdoption,
    runtimeOutcome,
    handoffEnvelope: validation.ok
      ? {
          envelopeId: `${surfaceId}:${clientRuntime.requestId}`,
          idempotencyKey: providerIntegration.handoff.idempotencyKey || previewAcceptance.acceptance.acceptanceToken,
          providerId: providerIntegration.negotiation.selectedProviderId,
          providerContractVersion: providerIntegration.negotiation.selectedContractVersion,
          externalCorrelationId: request.externalCorrelationId,
          route: routeTarget,
          command: request.command,
          capabilityId: request.capabilityId,
          tenantId: request.tenantId,
          workspaceId: request.workspaceId,
          reason: request.reason,
          proofId: request.proofId,
          operationKey: persistenceRecovery.restart.operationKey,
          idempotencyKey: persistenceRecovery.restart.idempotencyKey,
          requiredScopes: request.requiredScopes,
          proofMode: request.proofMode,
          hostedKernelExecution: {
            mode: hostedKernelPlan.execution.mode,
            route: hostedKernelPlan.execution.route,
            commandMutation: hostedKernelPlan.execution.commandMutation,
            ledgerEntryId: hostedKernelPlan.ledgerWrite?.ledgerEntryId || null,
            proofReceiptId: hostedKernelPlan.proofReceipt?.proofReceiptId || null,
            settingsCommandState: settingsCommandPlan.commandState
          },
          operationalSafety: {
            healthStatus: operationalHealth.status,
            degradedModeActive: operationalHealth.degradedMode.active,
            providerFailureCategory: operationalHealth.selectedFailure.category,
            retryable: operationalHealth.retry.retryable,
            nextRetryAt: operationalHealth.retry.nextRetryAt,
            providerCircuit: operationalHealth.selectedProvider?.circuit || null
          },
          externalState: providerIntegration.handoff.externalState,
          providerPreflight: providerIntegration.handoff.payloadContract,
          runtimeOutcome: {
            contractVersion: runtimeOutcome.contractVersion,
            visibleState: runtimeOutcome.visibleState,
            reconciliationAction: runtimeOutcome.reconciliationAction,
            optimisticAllowed: runtimeOutcome.optimisticAllowed,
            badges: runtimeOutcome.badges
          },
          acceptanceState: previewAcceptance.acceptance.state
        }
      : null,
    userNotice: {
      level: runtimeOutcome.operatorNotice.level,
      message: runtimeOutcome.operatorNotice.message,
      nextAction: state.nextAction,
      runtimeOutcomeCode: runtimeOutcome.operatorNotice.code,
      actionableErrors: operationalHealth.actionableErrors
    }
  };
}

function buildClientContinuationAdoption({
  request,
  validation,
  state,
  providerIntegration,
  previewAcceptance,
  clientRuntime,
  persistenceRecovery,
  operationalHealth,
  now
}) {
  const currentOperationKey = persistenceRecovery.restart.operationKey;
  const currentIdempotencyKey = persistenceRecovery.restart.idempotencyKey;
  const continuations = clientRuntime.handoffContinuations || [];
  const matchingContinuation = continuations.find((entry) => entry.operationKey === currentOperationKey)
    || continuations.find((entry) => entry.idempotencyKey === currentIdempotencyKey)
    || null;
  const staleContinuations = continuations.filter((entry) => {
    if (matchingContinuation && entry.continuationId === matchingContinuation.continuationId) {
      return false;
    }
    if (entry.status === "completed" || entry.status === "abandoned") {
      return false;
    }
    if (request.capabilityId && entry.capabilityId === request.capabilityId && entry.command === request.command) {
      return true;
    }
    return entry.operationKey === currentOperationKey || entry.idempotencyKey === currentIdempotencyKey;
  });
  const leaseExpiresAt = providerIntegration.handoff.externalState?.leaseExpiresAt || matchingContinuation?.leaseExpiresAt || null;
  const leaseExpired = leaseExpiresAt ? Date.parse(leaseExpiresAt) <= Date.parse(now) : false;
  const resumeStatus = matchingContinuation?.status || persistenceRecovery.restart.status;
  const canResume = validation.ok
    && Boolean(matchingContinuation)
    && !leaseExpired
    && ["ready-for-handoff", "ready-for-commit", "needs-proof", "degraded-checkpoint", "replaying"].includes(resumeStatus);
  const action = !validation.ok
    ? "block_continuation_until_valid"
    : canResume
      ? "resume_client_continuation"
      : staleContinuations.length
        ? "supersede_stale_continuations"
        : "create_client_continuation";
  const nextContinuation = validation.ok
    ? {
        continuationId: matchingContinuation?.continuationId || `${clientRuntime.workflowId}:${currentOperationKey}`,
        requestId: clientRuntime.requestId,
        workflowId: clientRuntime.workflowId,
        operationKey: currentOperationKey,
        idempotencyKey: currentIdempotencyKey,
        command: request.command,
        capabilityId: request.capabilityId,
        tenantId: request.tenantId,
        workspaceId: request.workspaceId,
        status: previewAcceptance.acceptance.state,
        nextAction: state.nextAction,
        providerId: providerIntegration.negotiation.selectedProviderId,
        route: providerIntegration.handoff.required && !operationalHealth.degradedMode.active
          ? providerIntegration.handoff.route
          : operationalHealth.degradedMode.active
            ? "/capability-security/revocation/degraded-checkpoints"
            : `/capability-security/revocation/${state.nextAction}`,
        method: providerIntegration.handoff.required && !operationalHealth.degradedMode.active
          ? providerIntegration.handoff.method
          : "POST",
        leaseExpiresAt,
        leaseExpired,
        replayToken: providerIntegration.handoff.externalState?.replayToken || matchingContinuation?.replayToken || null,
        restartStatus: persistenceRecovery.restart.status,
        updatedAt: now
      }
    : null;

  return {
    contractVersion: "revocation-client-continuation-v1",
    action,
    canResume,
    matchingContinuationId: matchingContinuation?.continuationId || null,
    staleContinuationIds: staleContinuations.map((entry) => entry.continuationId),
    leaseExpiresAt,
    leaseExpired,
    resumeStatus,
    nextContinuation
  };
}

function incrementCounter(target, key) {
  const normalizedKey = typeof key === "string" && key.trim() ? key.trim() : "unknown";
  target[normalizedKey] = (target[normalizedKey] || 0) + 1;
}

function normalizeAnalyticsSnapshot(input = {}, index = 0) {
  const snapshot = asObject(input);
  const counters = asObject(snapshot.counters);

  return {
    snapshotId: typeof snapshot.snapshotId === "string" && snapshot.snapshotId.trim()
      ? snapshot.snapshotId.trim()
      : `revocation-analytics-snapshot-${index + 1}`,
    capturedAt: asIso(snapshot.capturedAt ?? snapshot.generatedAt, null),
    window: {
      from: asIso(asObject(snapshot.window).from ?? snapshot.from, null),
      to: asIso(asObject(snapshot.window).to ?? snapshot.to, null)
    },
    counters: {
      total: boundedInteger(counters.total ?? snapshot.total, 0, 0, 1000000),
      accepted: boundedInteger(counters.accepted ?? snapshot.accepted, 0, 0, 1000000),
      rejected: boundedInteger(counters.rejected ?? snapshot.rejected, 0, 0, 1000000),
      externalHandoffs: boundedInteger(counters.externalHandoffs ?? snapshot.externalHandoffs, 0, 0, 1000000),
      degradedCheckpoints: boundedInteger(counters.degradedCheckpoints ?? snapshot.degradedCheckpoints, 0, 0, 1000000)
    }
  };
}

function normalizeAnalyticsExportRequest(input = {}, clientRuntime, now) {
  const analyticsInput = asObject(input.analytics ?? input.reporting);
  const exportInput = asObject(analyticsInput.export ?? analyticsInput.exportRequest ?? input.exportRequest ?? input.analyticsExport);
  const requestedFormat = lowerToken(exportInput.format);
  const requestedColumns = asStringList(exportInput.columns)
    .filter((column) => analyticsExportColumns.has(column));
  const defaultColumns = [...analyticsExportColumns];
  const window = asObject(exportInput.window);
  const from = asIso(window.from ?? exportInput.from, null);
  const to = asIso(window.to ?? exportInput.to, null);
  const maxRows = boundedInteger(exportInput.maxRows, 500, 1, 10000);
  const includeHistorySnapshots = exportInput.includeHistorySnapshots !== false;
  const includeTimelineRows = exportInput.includeTimelineRows !== false;
  const redactionMode = ["operator", "minimal"].includes(exportInput.redactionMode)
    ? exportInput.redactionMode
    : "operator";

  return {
    contractVersion: "revocation-analytics-export-request-v1",
    requestedAt: asIso(exportInput.requestedAt, now),
    requestedBy: typeof exportInput.requestedBy === "string" && exportInput.requestedBy.trim()
      ? exportInput.requestedBy.trim()
      : "hosted-kernel",
    format: analyticsExportFormats.has(requestedFormat) ? requestedFormat : "json",
    columns: requestedColumns.length ? requestedColumns : defaultColumns,
    window: { from, to },
    maxRows,
    includeTimelineRows,
    includeHistorySnapshots,
    redactionMode,
    destination: {
      route: typeof exportInput.route === "string" && exportInput.route.trim()
        ? exportInput.route.trim()
        : "/capability-security/revocation/analytics/export",
      method: typeof exportInput.method === "string" && exportInput.method.trim()
        ? exportInput.method.trim().toUpperCase()
        : "POST"
    },
    clientRequestId: clientRuntime.requestId,
    workflowId: clientRuntime.workflowId
  };
}

function selectExportColumns(row, columns) {
  return columns.reduce((selected, column) => {
    selected[column] = row[column] ?? null;
    return selected;
  }, {});
}

function snapshotCounterDelta(currentSnapshot, previousSnapshot) {
  const previous = previousSnapshot?.counters || {};
  const current = currentSnapshot.counters;

  return Object.fromEntries(Object.entries(current).map(([key, value]) => [
    key,
    value - boundedInteger(previous[key], 0, 0, 1000000)
  ]));
}

function buildRevocationExportReadiness({
  exportRequest,
  exportRows,
  exportedHistorySnapshots,
  timeline,
  retainedSnapshots,
  validation,
  providerIntegration,
  operationalHealth,
  state,
  clientRuntime,
  now
}) {
  const requestedWindow = exportRequest.window || {};
  const requestedFromMs = requestedWindow.from ? Date.parse(requestedWindow.from) : null;
  const requestedToMs = requestedWindow.to ? Date.parse(requestedWindow.to) : null;
  const invalidWindow = Boolean(
    (requestedWindow.from && !Number.isFinite(requestedFromMs)) ||
    (requestedWindow.to && !Number.isFinite(requestedToMs)) ||
    (Number.isFinite(requestedFromMs) && Number.isFinite(requestedToMs) && requestedFromMs > requestedToMs)
  );
  const missingRequestedColumns = exportRequest.columns.filter((column) => !analyticsExportColumns.has(column));
  const selectedProviderId = providerIntegration.negotiation.selectedProviderId || providerIntegration.handoff.providerId || "local";
  const handoffBlocked = providerIntegration.handoff.required && providerIntegration.handoff.state === "blocked";
  const healthBlocksExport = operationalHealth.status === "unhealthy" && operationalHealth.degradedMode.active !== true;
  const containsCurrentRequest = timeline.some((entry) => entry.type === "current_request");
  const redactionReady = exportRequest.redactionMode === "operator"
    || exportRequest.redactionMode === "summary"
    || exportRequest.redactionMode === "none";
  const emptyExport = exportRequest.includeTimelineRows && exportRows.length === 0;
  const boundedByMaxRows = exportRows.length === exportRequest.maxRows && timeline.length > exportRows.length;
  const blockers = [
    ...(!validation.ok ? [{
      code: "validation_not_accepted",
      message: "Revocation analytics export is blocked until request validation passes.",
      action: "repair_revocation_request",
      route: "/capability-security/revocation/validate"
    }] : []),
    ...(invalidWindow ? [{
      code: "invalid_export_window",
      message: "Analytics export window must use parseable timestamps and from must not be after to.",
      action: "repair_export_window",
      route: exportRequest.destination.route
    }] : []),
    ...(missingRequestedColumns.length ? [{
      code: "unsupported_export_columns",
      message: `Unsupported analytics export columns requested: ${missingRequestedColumns.join(", ")}.`,
      action: "select_supported_export_columns",
      route: exportRequest.destination.route
    }] : []),
    ...(handoffBlocked ? [{
      code: "provider_handoff_blocked",
      message: `Provider ${selectedProviderId} handoff is blocked; export would not include a durable external state.`,
      action: providerIntegration.handoff.healthGate?.operatorAction || "repair_provider_handoff",
      route: providerIntegration.handoff.healthGate?.operatorRoute || "/capability-security/revocation/providers"
    }] : []),
    ...(healthBlocksExport ? [{
      code: "operational_health_unhealthy",
      message: "Operational health is unhealthy and no degraded checkpoint export is active.",
      action: operationalHealth.selectedFailure.operatorAction,
      route: operationalHealth.selectedFailure.route
    }] : [])
  ];
  const warnings = [
    ...(emptyExport ? [{
      code: "empty_timeline_export",
      message: "Export window produced no timeline rows.",
      action: "widen_export_window"
    }] : []),
    ...(boundedByMaxRows ? [{
      code: "export_rows_truncated",
      message: `Export rows were bounded by maxRows=${exportRequest.maxRows}.`,
      action: "increase_max_rows_or_page_export"
    }] : []),
    ...(!containsCurrentRequest ? [{
      code: "current_request_not_in_timeline",
      message: "Current request is outside the export window.",
      action: "include_current_request_window"
    }] : []),
    ...(operationalHealth.degradedMode.active ? [{
      code: "degraded_checkpoint_export",
      message: "Export is generated from a local degraded checkpoint while provider recovery is pending.",
      action: "reconcile_provider_after_recovery"
    }] : []),
    ...(!redactionReady ? [{
      code: "unknown_redaction_mode",
      message: `Redaction mode ${exportRequest.redactionMode} is not recognized by this surface.`,
      action: "use_operator_or_summary_redaction"
    }] : [])
  ];
  const requiredActions = [
    ...blockers.map((blocker, index) => ({
      id: `revocation-export-blocker-${index + 1}`,
      severity: "blocker",
      code: blocker.code,
      action: blocker.action,
      route: blocker.route || exportRequest.destination.route
    })),
    ...warnings.slice(0, 3).map((warning, index) => ({
      id: `revocation-export-warning-${index + 1}`,
      severity: "warning",
      code: warning.code,
      action: warning.action,
      route: exportRequest.destination.route
    }))
  ];
  const readinessStatus = blockers.length
    ? "blocked"
    : warnings.length
      ? "ready-with-warnings"
      : "ready";

  return {
    contractVersion: "revocation-analytics-export-readiness-v1",
    generatedAt: now,
    status: readinessStatus,
    ready: blockers.length === 0,
    exportable: blockers.length === 0 && (exportRows.length > 0 || exportedHistorySnapshots.length > 0),
    clientRequestId: clientRuntime.requestId,
    workflowId: clientRuntime.workflowId,
    selectedProviderId,
    lifecycleNextAction: state.nextAction,
    format: exportRequest.format,
    redactionMode: exportRequest.redactionMode,
    requestedWindow,
    rowCount: exportRows.length,
    historySnapshotCount: exportedHistorySnapshots.length,
    retainedSnapshotCount: retainedSnapshots.length,
    timelineEntryCount: timeline.length,
    boundedByMaxRows,
    blockers,
    warnings,
    requiredActions,
    nextAction: requiredActions[0]?.action || (readinessStatus === "ready" ? "download_export" : "review_export_warnings"),
    manifestPatch: {
      exportReady: blockers.length === 0,
      readinessStatus,
      generatedAt: now,
      validationOk: validation.ok,
      operationalHealthStatus: operationalHealth.status,
      providerHandoffState: providerIntegration.handoff.state
    }
  };
}

function buildRevocationAnalyticsReporting({
  input,
  request,
  validation,
  state,
  providerIntegration,
  persistedState,
  previewAcceptance,
  clientRuntime,
  operationalHealth,
  now
}) {
  const analyticsInput = asObject(input.analytics ?? input.reporting);
  const retention = asObject(analyticsInput.retention);
  const exportRequest = normalizeAnalyticsExportRequest(input, clientRuntime, now);
  const snapshotInput = Array.isArray(analyticsInput.snapshots)
    ? analyticsInput.snapshots
    : Array.isArray(input.historySnapshots)
      ? input.historySnapshots
      : [];
  const maxHistorySnapshots = boundedInteger(retention.maxSnapshots, 25, 1, 365);
  const historySnapshots = snapshotInput
    .map(normalizeAnalyticsSnapshot)
    .filter((snapshot) => snapshot.capturedAt || snapshot.counters.total > 0)
    .sort((left, right) => Date.parse(left.capturedAt || "1970-01-01T00:00:00.000Z") - Date.parse(right.capturedAt || "1970-01-01T00:00:00.000Z"));
  const records = persistedState.records;
  const counters = {
    totalRecords: records.length,
    dirtyRecords: persistedState.dirtyRecords.length,
    acceptedRequests: validation.ok ? 1 : 0,
    rejectedRequests: validation.ok ? 0 : 1,
    externalHandoffs: providerIntegration.handoff.required ? 1 : 0,
    localCommits: validation.ok && state.nextAction === "commit_lifecycle_command" ? 1 : 0,
    scheduledRevocations: request.command === "schedule" && validation.ok ? 1 : 0,
    degradedCheckpoints: operationalHealth.degradedMode.active ? 1 : 0,
    retryableRecords: records.filter((record) => retryableFailureStates.has(record.status)).length,
    proofRequired: previewAcceptance.acceptance.requiresProof ? 1 : 0,
    actionableErrors: operationalHealth.actionableErrors.length
  };
  const byCommand = {};
  const byStatus = {};
  const byProvider = {};
  const byReason = {};

  for (const record of records) {
    incrementCounter(byCommand, record.command);
    incrementCounter(byStatus, record.status);
    incrementCounter(byProvider, record.providerId || "local");
    incrementCounter(byReason, record.reason || "none");
  }
  incrementCounter(byCommand, request.command);
  incrementCounter(byStatus, validation.ok ? previewAcceptance.acceptance.state : "rejected");
  incrementCounter(byProvider, providerIntegration.negotiation.selectedProviderId || "local");
  incrementCounter(byReason, request.reason || "none");

  const timelineRecords = records
    .map((record) => ({
      occurredAt: record.completedAt || record.updatedAt || record.createdAt || persistedState.loadedAt,
      type: "ledger_record",
      operationKey: record.operationKey,
      capabilityId: record.capabilityId,
      tenantId: record.tenantId || "unknown",
      workspaceId: record.workspaceId || "unknown",
      command: record.command,
      status: record.status,
      providerId: record.providerId || "local",
      retryAttemptCount: record.attemptCount
    }))
    .filter((entry) => entry.occurredAt);
  const timeline = [
    ...timelineRecords,
    {
      occurredAt: now,
      type: "current_request",
      operationKey: persistedState.currentOperationKey,
      capabilityId: request.capabilityId,
      tenantId: request.tenantId,
      workspaceId: request.workspaceId,
      command: request.command,
      status: validation.ok ? previewAcceptance.acceptance.state : "rejected",
      providerId: providerIntegration.negotiation.selectedProviderId || "local",
      retryAttemptCount: operationalHealth.retry.attemptCount
    }
  ].sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt));

  const currentSnapshot = {
    snapshotId: `${surfaceId}:${clientRuntime.workflowId}:analytics:${now}`,
    capturedAt: now,
    window: {
      from: timeline[0]?.occurredAt || now,
      to: now
    },
    counters: {
      total: counters.totalRecords + 1,
      accepted: counters.acceptedRequests,
      rejected: counters.rejectedRequests,
      externalHandoffs: counters.externalHandoffs,
      degradedCheckpoints: counters.degradedCheckpoints
    }
  };
  const retainedSnapshots = [...historySnapshots, currentSnapshot].slice(-maxHistorySnapshots);
  const previousSnapshot = retainedSnapshots.length > 1 ? retainedSnapshots[retainedSnapshots.length - 2] : null;
  const requestedFromMs = exportRequest.window.from ? Date.parse(exportRequest.window.from) : null;
  const requestedToMs = exportRequest.window.to ? Date.parse(exportRequest.window.to) : null;
  const exportTimeline = exportRequest.includeTimelineRows
    ? timeline.filter((entry) => {
        const occurredMs = Date.parse(entry.occurredAt);
        if (requestedFromMs !== null && occurredMs < requestedFromMs) {
          return false;
        }
        if (requestedToMs !== null && occurredMs > requestedToMs) {
          return false;
        }
        return true;
      }).slice(-exportRequest.maxRows)
    : [];
  const exportRows = exportTimeline.map((entry) => selectExportColumns({
    occurredAt: entry.occurredAt,
    eventType: entry.type,
    operationKey: entry.operationKey,
    command: entry.command,
    status: entry.status,
    providerId: entry.providerId,
    capabilityId: entry.capabilityId,
    tenantId: entry.tenantId,
    workspaceId: entry.workspaceId,
    retryAttemptCount: entry.retryAttemptCount
  }, exportRequest.columns));
  const exportedHistorySnapshots = exportRequest.includeHistorySnapshots
    ? retainedSnapshots.filter((snapshot) => {
        const capturedMs = snapshot.capturedAt ? Date.parse(snapshot.capturedAt) : null;
        if (capturedMs === null) {
          return true;
        }
        if (requestedFromMs !== null && capturedMs < requestedFromMs) {
          return false;
        }
        if (requestedToMs !== null && capturedMs > requestedToMs) {
          return false;
        }
        return true;
      })
    : [];
  const aggregateHistoryCounters = retainedSnapshots.reduce((totals, snapshot) => ({
    total: totals.total + snapshot.counters.total,
    accepted: totals.accepted + snapshot.counters.accepted,
    rejected: totals.rejected + snapshot.counters.rejected,
    externalHandoffs: totals.externalHandoffs + snapshot.counters.externalHandoffs,
    degradedCheckpoints: totals.degradedCheckpoints + snapshot.counters.degradedCheckpoints
  }), {
    total: 0,
    accepted: 0,
    rejected: 0,
    externalHandoffs: 0,
    degradedCheckpoints: 0
  });
  const exportReadiness = buildRevocationExportReadiness({
    exportRequest,
    exportRows,
    exportedHistorySnapshots,
    timeline,
    retainedSnapshots,
    validation,
    providerIntegration,
    operationalHealth,
    state,
    clientRuntime,
    now
  });

  return {
    contract: {
      version: "revocation-analytics-reporting-v1",
      acceptedInputAliases: ["analytics", "reporting", "historySnapshots", "exportRequest", "analyticsExport"],
      exportFormats: [...analyticsExportFormats],
      dimensions: ["command", "status", "providerId", "reason"],
      redaction: {
        capabilityId: "included-for-operator-scope",
        proofId: "excluded-from-export-rows",
        actor: "excluded-from-export-rows"
      }
    },
    counters,
    breakdowns: {
      byCommand,
      byStatus,
      byProvider,
      byReason
    },
    history: {
      snapshots: retainedSnapshots,
      latestSnapshotId: currentSnapshot.snapshotId,
      retainedSnapshotCount: retainedSnapshots.length,
      droppedSnapshotCount: Math.max(historySnapshots.length + 1 - retainedSnapshots.length, 0),
      aggregateCounters: aggregateHistoryCounters,
      currentDelta: snapshotCounterDelta(currentSnapshot, previousSnapshot),
      retention: {
        maxSnapshots: maxHistorySnapshots,
        policy: "retain-most-recent-captures"
      }
    },
    timeline: {
      generatedAt: now,
      entryCount: timeline.length,
      exportedEntryCount: exportTimeline.length,
      entries: timeline
    },
    exportSummary: {
      generatedAt: now,
      exportId: `${surfaceId}:${clientRuntime.requestId}:export`,
      formatReady: exportReadiness.ready,
      readiness: exportReadiness,
      request: exportRequest,
      rowCount: exportRows.length,
      historySnapshotCount: exportedHistorySnapshots.length,
      schema: exportRequest.columns,
      rows: exportRows,
      historySnapshots: exportedHistorySnapshots,
      manifest: {
        route: exportRequest.destination.route,
        method: exportRequest.destination.method,
        format: exportRequest.format,
        window: exportRequest.window,
        redactionMode: exportRequest.redactionMode,
        maxRows: exportRequest.maxRows,
        boundedByMaxRows: exportTimeline.length === exportRequest.maxRows && timeline.length > exportTimeline.length,
        generatedForRequestId: clientRuntime.requestId,
        readinessStatus: exportReadiness.status,
        exportReady: exportReadiness.ready,
        requiredActions: exportReadiness.requiredActions,
        readinessPatch: exportReadiness.manifestPatch
      }
    },
    reportingState: {
      status: exportReadiness.ready
        ? operationalHealth.status === "unhealthy" ? "attention-required" : "ready"
        : exportReadiness.status,
      route: "/capability-security/revocation/analytics",
      exportRoute: exportRequest.destination.route,
      refreshAfterSeconds: state.mutationCommand ? 30 : 300,
      staleAfter: new Date(Date.parse(now) + (state.mutationCommand ? 30 : 300) * 1000).toISOString(),
      clientRequestId: clientRuntime.requestId,
      workflowId: clientRuntime.workflowId,
      nextAction: exportReadiness.nextAction,
      exportReady: exportReadiness.ready,
      blockerCount: exportReadiness.blockers.length,
      warningCount: exportReadiness.warnings.length
    }
  };
}

function buildAudit({ request, settings, validation, state, now, evidence, providerIntegration, boundaryContext, clientRuntime, workflowHandoff, persistenceRecovery, hostedKernelPlan, operationalHealth, analyticsReporting, controlEvaluation, settingsCommandPlan }) {
  const proof = {
    proofId: request.proofId || `${surfaceName}:${request.command}:${request.capabilityId || "none"}`,
    surfaceId,
    command: request.command,
    capabilityId: request.capabilityId,
    tenantId: request.tenantId,
    workspaceId: request.workspaceId,
    operationKey: persistenceRecovery.restart.operationKey,
    idempotencyKey: persistenceRecovery.restart.idempotencyKey,
    restartStatus: persistenceRecovery.restart.status,
    checkpointId: persistenceRecovery.checkpoint.checkpointId,
    controlsEnabled: settings.enabled,
    controlTransition: controlEvaluation.controlTransition,
    settingsCommandState: settingsCommandPlan.commandState,
    settingsNormalizationApplied: settingsCommandPlan.validation.normalizedSettingsApplied,
    nextSettingsReviewAt: settingsCommandPlan.schedulingReview.nextReviewAt,
    scheduleCapacityRemaining: controlEvaluation.scheduling.capacityRemaining,
    pendingWorkBlocksDisable: controlEvaluation.pendingWork.disableBlockedByPending,
    boundaryScopedWorksets: controlEvaluation.boundaryScopedWorksets,
    validated: validation.ok,
    nextAction: state.nextAction,
    providerId: providerIntegration.negotiation.selectedProviderId,
    providerContractVersion: providerIntegration.negotiation.selectedContractVersion,
    requiredScopes: request.requiredScopes,
    grantedScopes: boundaryContext.grantedScopes,
    effectiveScopes: boundaryContext.effectiveScopes,
    missingScopes: boundaryContext.missingScopes,
    selectedWorkspaceGrant: boundaryContext.selectedWorkspaceGrant
      ? {
          workspaceId: boundaryContext.selectedWorkspaceGrant.workspaceId,
          tenantId: boundaryContext.selectedWorkspaceGrant.tenantId,
          roles: boundaryContext.selectedWorkspaceGrant.roles,
          scopes: boundaryContext.selectedWorkspaceGrant.scopes,
          deniedScopes: boundaryContext.selectedWorkspaceGrant.deniedScopes,
          commands: boundaryContext.selectedWorkspaceGrant.commands,
          deniedCommands: boundaryContext.selectedWorkspaceGrant.deniedCommands
        }
      : null,
    commandAllowedByBoundary: boundaryContext.enforcement.commandAllowed,
    unscopedClientWorkAdoption: {
      enabled: boundaryContext.enforcement.adoptUnscopedClientWork,
      adoptedClientEntryIds: controlEvaluation.boundaryScopedWorksets.adoptedUnscopedClientEntryIds,
      quarantinedClientEntryIds: controlEvaluation.boundaryScopedWorksets.quarantinedUnscopedClientEntryIds
    },
    proofMode: request.proofMode,
    externalCorrelationId: request.externalCorrelationId,
    requestNormalization: {
      status: request.normalization?.errorCount
        ? "invalid"
        : request.normalization?.warningCount
          ? "normalized-with-warnings"
          : "accepted",
      issueCount: request.normalization?.issueCount || 0,
      errorCount: request.normalization?.errorCount || 0,
      warningCount: request.normalization?.warningCount || 0,
      commandWasCoerced: request.normalization?.commandWasCoerced === true,
      reasonWasRejected: request.normalization?.reasonWasRejected === true,
      proofModeWasCoerced: request.normalization?.proofModeWasCoerced === true,
      scheduleAtWasRejected: request.normalization?.scheduleAtWasRejected === true
    },
    handoffRequired: providerIntegration.handoff.required,
    handoffIdempotencyKey: providerIntegration.handoff.idempotencyKey,
    handoffLeaseExpiresAt: providerIntegration.handoff.externalState?.leaseExpiresAt || null,
    handoffReplayToken: providerIntegration.handoff.externalState?.replayToken || null,
    handoffPreflightMissingFields: providerIntegration.handoff.payloadContract?.missingPreflightFields || [],
    clientRequestId: clientRuntime.requestId,
    workflowId: clientRuntime.workflowId,
    runtimeStateVersion: clientRuntime.stateVersion,
    handoffEnvelopeId: workflowHandoff.handoffEnvelope?.envelopeId || null,
    operationalHealthStatus: operationalHealth.status,
    degradedModeActive: operationalHealth.degradedMode.active,
    providerFailureCategory: operationalHealth.selectedFailure.category,
    providerCircuitState: operationalHealth.selectedProvider?.circuit.state || null,
    nextRetryAt: operationalHealth.retry.nextRetryAt,
    retryAttemptCount: operationalHealth.retry.attemptCount,
    analyticsSnapshotId: analyticsReporting.history.latestSnapshotId,
    analyticsExportId: analyticsReporting.exportSummary.exportId,
    hostedKernelExecutionMode: hostedKernelPlan.execution.mode,
    hostedKernelMutation: hostedKernelPlan.execution.commandMutation,
    hostedKernelLedgerEntryId: hostedKernelPlan.ledgerWrite?.ledgerEntryId || null,
    hostedKernelProofReceiptId: hostedKernelPlan.proofReceipt?.proofReceiptId || null,
    boundaryContractVersion: boundaryContext.contractVersion,
    boundaryEnforcement: boundaryContext.enforcement
  };

  return {
    auditEvent: {
      eventType: `capability.revocation.${request.command}`,
      actor: request.actor,
      occurredAt: now,
      reason: request.reason,
      tenantId: request.tenantId,
      workspaceId: request.workspaceId,
      outcome: validation.ok ? "accepted" : "rejected",
      warnings: validation.warnings,
      operationalHealthStatus: operationalHealth.status,
      degradedModeActive: operationalHealth.degradedMode.active,
      clientRequestId: clientRuntime.requestId,
      workflowId: clientRuntime.workflowId,
      operationKey: persistenceRecovery.restart.operationKey,
      externalCorrelationId: request.externalCorrelationId,
      providerContractVersion: providerIntegration.negotiation.selectedContractVersion,
      restartStatus: persistenceRecovery.restart.status
    },
    proof,
    evidence: [
      ...(Array.isArray(evidence) ? evidence : []),
      {
        type: "client-runtime-state",
        sessionId: clientRuntime.sessionId,
        requestId: clientRuntime.requestId,
        workflowId: clientRuntime.workflowId,
        observedAt: clientRuntime.observedAt
      },
      {
        type: "revocation-tenant-boundary",
        contractVersion: boundaryContext.contractVersion,
        tenantId: boundaryContext.tenantId,
        workspaceId: boundaryContext.workspaceId,
        actorTenantId: boundaryContext.actorTenantId,
        actorRoles: boundaryContext.actorRoles,
        actorWorkspaceIds: boundaryContext.actorWorkspaceIds,
        workspaceAliases: boundaryContext.workspaceAliases,
        effectiveScopes: boundaryContext.effectiveScopes,
        missingScopes: boundaryContext.missingScopes,
        selectedWorkspaceGrant: proof.selectedWorkspaceGrant,
        deniedCommands: boundaryContext.deniedCommands,
        enforcement: boundaryContext.enforcement
      },
      {
        type: "revocation-provider-negotiation",
        selectedProviderId: providerIntegration.negotiation.selectedProviderId,
        selectedContractVersion: providerIntegration.negotiation.selectedContractVersion,
        requestedScopes: request.requiredScopes,
        requestedProofMode: request.proofMode,
        eligibleProviderCount: providerIntegration.negotiation.eligibleProviderCount,
        blockedByScope: providerIntegration.negotiation.scopeBlockedProviders,
        blockedByProofMode: providerIntegration.negotiation.proofModeBlockedProviders,
        blockedByPreflight: providerIntegration.negotiation.preflightBlockedProviders,
        selectedReplayToken: providerIntegration.handoff.externalState?.replayToken || null
      },
      {
        type: "revocation-persistence-checkpoint",
        snapshotId: persistenceRecovery.checkpoint.snapshotId,
        checkpointId: persistenceRecovery.checkpoint.checkpointId,
        operationKey: persistenceRecovery.restart.operationKey,
        restartStatus: persistenceRecovery.restart.status,
        dirtyRecordCount: persistenceRecovery.dirtyRecordCount
      },
      {
        type: "revocation-lifecycle-controls",
        contractVersion: controlEvaluation.contractVersion,
        controlTransition: controlEvaluation.controlTransition,
        controlsEnabled: controlEvaluation.controlsEnabled,
        scheduleCapacityRemaining: controlEvaluation.scheduling.capacityRemaining,
        activeScheduledCount: controlEvaluation.scheduling.activeScheduledCount,
        pendingWorkBlocksDisable: controlEvaluation.pendingWork.disableBlockedByPending
      },
      {
        type: "revocation-lifecycle-settings-command-plan",
        contractVersion: settingsCommandPlan.contractVersion,
        command: settingsCommandPlan.command,
        commandState: settingsCommandPlan.commandState,
        lifecycleCommand: settingsCommandPlan.lifecycleCommand,
        normalizedSettingsApplied: settingsCommandPlan.validation.normalizedSettingsApplied,
        validationWarnings: settingsCommandPlan.validation.warnings,
        validationErrors: settingsCommandPlan.validation.errors,
        nextReviewAt: settingsCommandPlan.schedulingReview.nextReviewAt,
        settingsPatchType: settingsCommandPlan.settingsPatch?.patchType || null
      },
      {
        type: "revocation-boundary-scoped-worksets",
        contractVersion: controlEvaluation.boundaryScopedWorksets.contractVersion,
        tenantId: controlEvaluation.boundaryScopedWorksets.tenantId,
        workspaceId: controlEvaluation.boundaryScopedWorksets.workspaceId,
        scopedDirtyLedgerCount: controlEvaluation.boundaryScopedWorksets.scopedDirtyLedgerCount,
        scopedPendingClientCount: controlEvaluation.boundaryScopedWorksets.scopedPendingClientCount,
        ignoredLedgerCount: controlEvaluation.boundaryScopedWorksets.ignoredLedgerCount,
        ignoredClientCount: controlEvaluation.boundaryScopedWorksets.ignoredClientCount,
        unscopedLedgerCount: controlEvaluation.boundaryScopedWorksets.unscopedLedgerCount,
        unscopedClientCount: controlEvaluation.boundaryScopedWorksets.unscopedClientCount,
        unscopedClientAdoptionEnabled: controlEvaluation.boundaryScopedWorksets.unscopedClientAdoptionEnabled,
        adoptedUnscopedClientEntryIds: controlEvaluation.boundaryScopedWorksets.adoptedUnscopedClientEntryIds,
        quarantinedUnscopedClientEntryIds: controlEvaluation.boundaryScopedWorksets.quarantinedUnscopedClientEntryIds,
        ignoredOperationKeys: controlEvaluation.boundaryScopedWorksets.ignoredOperationKeys,
        ignoredClientEntryIds: controlEvaluation.boundaryScopedWorksets.ignoredClientEntryIds,
        ignoredReasons: controlEvaluation.boundaryScopedWorksets.ignoredReasons
      },
      {
        type: "revocation-operational-health",
        status: operationalHealth.status,
        degradedModeActive: operationalHealth.degradedMode.active,
        selectedProviderId: operationalHealth.selectedProvider?.providerId || null,
        providerFailureCategory: operationalHealth.selectedFailure.category,
        providerCircuit: operationalHealth.selectedProvider?.circuit || null,
        nextRetryAt: operationalHealth.retry.nextRetryAt,
        retryable: operationalHealth.retry.retryable,
        actionableErrorCount: operationalHealth.actionableErrors.length
      },
      {
        type: "hosted-kernel-revocation-execution",
        contractVersion: hostedKernelPlan.contract.version,
        executionMode: hostedKernelPlan.execution.mode,
        localCommitReady: hostedKernelPlan.execution.localCommitReady,
        commandMutation: hostedKernelPlan.execution.commandMutation,
        route: hostedKernelPlan.execution.route,
        ledgerEntryId: hostedKernelPlan.ledgerWrite?.ledgerEntryId || null,
        proofReceiptId: hostedKernelPlan.proofReceipt?.proofReceiptId || null,
        auditDigest: hostedKernelPlan.proofReceipt?.auditDigest || null
      },
      {
        type: "revocation-analytics-reporting",
        snapshotId: analyticsReporting.history.latestSnapshotId,
        exportId: analyticsReporting.exportSummary.exportId,
        rowCount: analyticsReporting.exportSummary.rowCount,
        reportingStatus: analyticsReporting.reportingState.status
      }
    ]
  };
}

export function describeRevocationSurface(input = {}) {
  const now = asIso(input.now, new Date().toISOString());
  const settings = normalizeSettings(input.settings);
  const request = normalizeRequest(input, now);
  const clientRuntime = normalizeClientRuntime(input, request, now);
  const boundaryContext = normalizeBoundaryContext(input, request, clientRuntime);
  request.tenantId = boundaryContext.tenantId;
  request.workspaceId = boundaryContext.workspaceId;
  const persistedState = normalizePersistedRevocationState(input, request, clientRuntime, now);
  const controlEvaluation = buildLifecycleControlEvaluation({
    request,
    settings,
    persistedState,
    clientRuntime,
    boundaryContext,
    now
  });
  const settingsCommandPlan = buildLifecycleSettingsCommandPlan({
    input,
    request,
    settings,
    controlEvaluation,
    boundaryContext,
    now
  });
  const providerContracts = normalizeProviderContracts(input);
  const controlValidation = applySettingsCommandValidation(applyLifecycleControlValidation(
    validateLifecycle({ request, settings, now }),
    controlEvaluation
  ), settingsCommandPlan);
  const runtimeValidation = validateClientRuntime({
    request,
    validation: controlValidation,
    clientRuntime
  });
  const lifecycleValidation = validateTenantPermissionBoundary({
    request,
    validation: runtimeValidation,
    boundaryContext
  });
  const providerIntegration = buildProviderIntegration({
    request,
    settings,
    validation: lifecycleValidation,
    providerContracts,
    now
  });
  const providerValidation = validateProviderContracts({
    request,
    validation: lifecycleValidation,
    providerIntegration
  });
  const operationalHealth = buildOperationalHealth({
    request,
    validation: providerValidation,
    providerIntegration,
    providerContracts,
    persistedState,
    input,
    now
  });
  const validation = applyOperationalHealthValidation(providerValidation, operationalHealth);
  const healthGatedProviderIntegration = applyOperationalHealthToProviderIntegration({
    providerIntegration,
    operationalHealth,
    validation,
    now
  });
  const state = buildLifecycleState({
    request,
    settings,
    validation,
    providerIntegration: healthGatedProviderIntegration,
    operationalHealth,
    controlEvaluation,
    settingsCommandPlan
  });
  const validationSummary = buildValidationSummary({
    request,
    validation,
    providerIntegration: healthGatedProviderIntegration,
    controlEvaluation
  });
  const previewAcceptance = buildPreviewAcceptance({
    request,
    settings,
    validation,
    validationSummary,
    state,
    providerIntegration: healthGatedProviderIntegration,
    controlEvaluation,
    now
  });
  const persistenceRecovery = buildPersistenceRecovery({
    request,
    validation,
    state,
    providerIntegration: healthGatedProviderIntegration,
    previewAcceptance,
    persistedState,
    now
  });
  const hostedKernelPlan = buildHostedKernelRevocationPlan({
    request,
    validation,
    state,
    providerIntegration: healthGatedProviderIntegration,
    previewAcceptance,
    persistenceRecovery,
    operationalHealth,
    controlEvaluation,
    settingsCommandPlan,
    boundaryContext,
    now
  });
  const nextSteps = buildNextStepContracts({
    request,
    validation,
    validationSummary,
    state,
    providerIntegration: healthGatedProviderIntegration,
    previewAcceptance,
    persistenceRecovery,
    hostedKernelPlan,
    operationalHealth,
    controlEvaluation,
    settingsCommandPlan,
    now
  });
  const workflowHandoff = buildClientWorkflowHandoff({
    request,
    validation,
    state,
    providerIntegration: healthGatedProviderIntegration,
    previewAcceptance,
    clientRuntime,
    persistenceRecovery,
    hostedKernelPlan,
    operationalHealth,
    settingsCommandPlan,
    now
  });
  const analyticsReporting = buildRevocationAnalyticsReporting({
    input,
    request,
    validation,
    state,
    providerIntegration: healthGatedProviderIntegration,
    persistedState,
    previewAcceptance,
    clientRuntime,
    operationalHealth,
    now
  });
  const audit = buildAudit({
    request,
    settings,
    validation,
    state,
    now,
    evidence: input.evidence,
    providerIntegration: healthGatedProviderIntegration,
    boundaryContext,
    clientRuntime,
    workflowHandoff,
    persistenceRecovery,
    hostedKernelPlan,
    operationalHealth,
    analyticsReporting,
    controlEvaluation,
    settingsCommandPlan
  });

  return {
    ok: validation.ok,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: "hosted-kernel capability revocation lifecycle controls",
    supportedCommands: [...lifecycleCommands],
    supportedReasons: [...revocationReasons],
    settings,
    request,
    boundaryContext,
    clientRuntime,
    persistedState,
    lifecycleControls: controlEvaluation,
    lifecycleSettingsCommandPlan: settingsCommandPlan,
    providerContracts,
    providerIntegration: healthGatedProviderIntegration,
    validation,
    validationSummary,
    operationalHealth,
    previewContract: previewAcceptance.contract,
    preview: previewAcceptance.preview,
    acceptance: previewAcceptance.acceptance,
    readiness: previewAcceptance.readiness,
    nextSteps,
    workflowHandoff,
    persistenceRecovery,
    hostedKernelPlan,
    analyticsReporting,
    lifecycle: state,
    audit
  };
}

export default describeRevocationSurface;
