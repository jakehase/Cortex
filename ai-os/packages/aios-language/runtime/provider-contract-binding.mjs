import { createApprovalPreviewAcceptanceContract } from "./approval-binding.mjs";

const DEFAULT_MAILCHIMP_ENDPOINTS = Object.freeze({
  audienceRead: "GET /3.0/lists/{audienceId}/members",
  memberUpsert: "PUT /3.0/lists/{audienceId}/members/{subscriberHash}",
  tagWrite: "POST /3.0/lists/{audienceId}/members/{subscriberHash}/tags",
});

const DEFAULT_CAPABILITIES = Object.freeze([
  "provider.mailchimp.audience.read",
  "provider.mailchimp.member.upsert",
  "provider.mailchimp.tag.write",
  "memory.local.artifact.write",
  "verifier.mailchimp.contract.check",
]);

const DEFAULT_ALLOWED_FIELDS = Object.freeze([
  "email_address",
  "status_if_new",
  "merge_fields",
  "tags",
  "interests",
]);

const LIFECYCLE_ACTIONS = Object.freeze([
  "provider.enable",
  "provider.disable",
  "settings.validate",
  "sync.preview",
  "sync.accept",
  "sync.commit",
  "sync.pause",
  "sync.resume",
]);

const SCHEDULE_CADENCES = Object.freeze(["manual", "hourly", "daily", "weekly"]);
const HEALTH_OBSERVATION_STATUSES = Object.freeze([
  "unknown",
  "healthy",
  "degraded",
  "rate_limited",
  "unavailable",
  "auth_failed",
]);
const HEALTH_HTTP_RETRYABLE = Object.freeze([408, 409, 425, 429, 500, 502, 503, 504]);
const HEALTH_HTTP_TERMINAL = Object.freeze([400, 401, 403, 404, 410, 422]);

function stableObject(value) {
  if (Array.isArray(value)) {
    return value.map(stableObject);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableObject(value[key])]),
  );
}

export function stableContractDigest(value) {
  const text = JSON.stringify(stableObject(value));
  let hash = 2166136261;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function asCleanString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asUniqueStrings(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))];
}

function uniqueSortedStrings(values) {
  return asUniqueStrings(values).sort((left, right) => left.localeCompare(right));
}

function asNonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.floor(number));
}

function normalizeProvider(input) {
  const provider = input?.provider && typeof input.provider === "object" ? input.provider : input ?? {};
  const slug = asCleanString(provider.slug, "mailchimp").toLowerCase();
  const product = asCleanString(provider.product, "Mailchimp");

  return {
    slug,
    product,
    datacenter: asCleanString(provider.datacenter, provider.dc ?? "us1").toLowerCase(),
    apiVersion: asCleanString(provider.apiVersion, "3.0"),
    baseUrl: asCleanString(provider.baseUrl, `https://${asCleanString(provider.datacenter, provider.dc ?? "us1").toLowerCase()}.api.mailchimp.com/3.0`),
  };
}

function normalizeAudience(input) {
  const source = input?.audience && typeof input.audience === "object" ? input.audience : input ?? {};
  const audienceId = asCleanString(source.audienceId, source.listId);
  const segmentId = asCleanString(source.segmentId, "");

  return {
    audienceId,
    segmentId: segmentId || null,
    requiredMergeFields: asUniqueStrings(source.requiredMergeFields),
    allowedMemberFields: asUniqueStrings(source.allowedMemberFields).length
      ? asUniqueStrings(source.allowedMemberFields)
      : [...DEFAULT_ALLOWED_FIELDS],
  };
}

function normalizeAuth(input) {
  const auth = input?.auth && typeof input.auth === "object" ? input.auth : {};
  const secretRef = asCleanString(auth.secretRef, "secret://mailchimp/api-key");

  return {
    mode: asCleanString(auth.mode, "apiKey"),
    secretRef,
    exposure: "reference-only",
  };
}

function normalizePolicy(input) {
  const policy = input?.policy && typeof input.policy === "object" ? input.policy : {};
  const maxBatchSize = Number.isInteger(policy.maxBatchSize) && policy.maxBatchSize > 0 ? policy.maxBatchSize : 500;
  const retryLimit = Number.isInteger(policy.retryLimit) && policy.retryLimit >= 0 ? policy.retryLimit : 3;

  return {
    maxBatchSize: Math.min(maxBatchSize, 500),
    retryLimit: Math.min(retryLimit, 6),
    dryRunDefault: policy.dryRunDefault !== false,
    allowExternalWrites: policy.allowExternalWrites === true,
    idempotencyKeyFields: asUniqueStrings(policy.idempotencyKeyFields).length
      ? asUniqueStrings(policy.idempotencyKeyFields)
      : ["audienceId", "email_address"],
  };
}

function normalizeCapabilityInput(input = {}) {
  const provider = input.provider && typeof input.provider === "object" ? input.provider : {};
  const adapter = input.adapter && typeof input.adapter === "object" ? input.adapter : {};
  const service = input.service && typeof input.service === "object" ? input.service : {};
  const requested = uniqueSortedStrings([
    ...DEFAULT_CAPABILITIES,
    ...asUniqueStrings(input.capabilities),
    ...asUniqueStrings(input.requestedCapabilities),
    ...asUniqueStrings(provider.capabilities),
    ...asUniqueStrings(service.requestedCapabilities),
  ]);
  const observed = uniqueSortedStrings([
    ...asUniqueStrings(input.availableCapabilities),
    ...asUniqueStrings(input.adapterCapabilities),
    ...asUniqueStrings(input.serviceCapabilities),
    ...asUniqueStrings(provider.availableCapabilities),
    ...asUniqueStrings(adapter.capabilities),
    ...asUniqueStrings(service.capabilities),
  ]);
  const available = observed.length ? observed : requested;

  return {
    requested,
    available,
    observedExplicitly: observed.length > 0,
  };
}

function capabilityEndpointBindings(endpoints) {
  return {
    "provider.mailchimp.audience.read": {
      endpoint: endpoints.audienceRead,
      method: "GET",
      sideEffect: "read",
    },
    "provider.mailchimp.member.upsert": {
      endpoint: endpoints.memberUpsert,
      method: "PUT",
      sideEffect: "external-write",
    },
    "provider.mailchimp.tag.write": {
      endpoint: endpoints.tagWrite,
      method: "POST",
      sideEffect: "external-write",
    },
    "memory.local.artifact.write": {
      endpoint: "workspace://local-artifact",
      method: "WRITE",
      sideEffect: "local-write",
    },
    "verifier.mailchimp.contract.check": {
      endpoint: "runtime://verifier/mailchimp-contract",
      method: "CHECK",
      sideEffect: "none",
    },
  };
}

function buildCapabilityNegotiation(input, endpoints, policy, lifecycle) {
  const capabilityInput = normalizeCapabilityInput(input);
  const endpointBindings = capabilityEndpointBindings(endpoints);
  const requiredCapabilities = uniqueSortedStrings([
    "provider.mailchimp.audience.read",
    "memory.local.artifact.write",
    "verifier.mailchimp.contract.check",
    ...(lifecycle.controls.allowCommit || policy.allowExternalWrites
      ? ["provider.mailchimp.member.upsert"]
      : []),
    ...(policy.allowExternalWrites && asUniqueStrings(input.requiredCapabilities).includes("provider.mailchimp.tag.write")
      ? ["provider.mailchimp.tag.write"]
      : []),
    ...asUniqueStrings(input.requiredCapabilities),
  ]);
  const optionalCapabilities = uniqueSortedStrings([
    ...DEFAULT_CAPABILITIES,
    ...capabilityInput.requested,
  ].filter((capability) => !requiredCapabilities.includes(capability)));
  const availableSet = new Set(capabilityInput.available);
  const requestedSet = new Set(capabilityInput.requested);
  const negotiated = uniqueSortedStrings(capabilityInput.requested.filter((capability) => availableSet.has(capability)));
  const missingRequired = requiredCapabilities.filter((capability) => !availableSet.has(capability));
  const unavailableOptional = optionalCapabilities.filter((capability) => requestedSet.has(capability) && !availableSet.has(capability));
  const externalWriteCapabilities = ["provider.mailchimp.member.upsert", "provider.mailchimp.tag.write"];
  const writeCapabilitiesReady = externalWriteCapabilities.filter((capability) => negotiated.includes(capability));
  const externalWriteSuppressed = writeCapabilitiesReady.length > 0 && policy.allowExternalWrites !== true;
  const canPreview = missingRequired.filter((capability) => capability !== "provider.mailchimp.member.upsert").length === 0;
  const canCommit = canPreview
    && missingRequired.length === 0
    && policy.allowExternalWrites === true
    && lifecycle.controls.allowCommit === true
    && lifecycle.enabled === true
    && lifecycle.schedule.paused !== true;
  const status = missingRequired.length
    ? "missing_required_capabilities"
    : externalWriteSuppressed
      ? "preview_only_external_writes_suppressed"
      : canCommit
        ? "commit_capable"
        : canPreview
          ? "preview_capable"
          : "blocked";
  const negotiationDigest = stableContractDigest({
    requested: capabilityInput.requested,
    available: capabilityInput.available,
    requiredCapabilities,
    optionalCapabilities,
    policy: {
      allowExternalWrites: policy.allowExternalWrites,
      dryRunDefault: policy.dryRunDefault,
    },
    lifecycle: {
      enabled: lifecycle.enabled,
      allowCommit: lifecycle.controls.allowCommit,
      schedulePaused: lifecycle.schedule.paused,
    },
  });

  return {
    kind: "aios.provider.capability_negotiation",
    version: "mailchimp.capability-negotiation.v1",
    status,
    digest: negotiationDigest,
    requestedCapabilities: capabilityInput.requested,
    availableCapabilities: capabilityInput.available,
    availableObservedExplicitly: capabilityInput.observedExplicitly,
    requiredCapabilities,
    optionalCapabilities,
    negotiatedCapabilities: negotiated,
    missingRequiredCapabilities: missingRequired,
    unavailableOptionalCapabilities: unavailableOptional,
    endpointBindings: Object.fromEntries(
      capabilityInput.requested.map((capability) => [capability, endpointBindings[capability] ?? {
        endpoint: "adapter://capability/unmapped",
        method: "UNKNOWN",
        sideEffect: capability.includes(".write") || capability.includes(".upsert") ? "external-write" : "unknown",
      }]),
    ),
    controls: {
      previewCapable: canPreview,
      commitCapable: canCommit,
      externalWriteSuppressed,
      dryRunDefault: policy.dryRunDefault,
      scheduleOpen: lifecycle.schedule.paused !== true,
    },
    syncMetadata: {
      product: "Mailchimp",
      negotiationMode: capabilityInput.observedExplicitly ? "adapter-observed" : "contract-defaulted",
      settingsRevision: lifecycle.settingsRevision,
      cadence: lifecycle.schedule.cadence,
      requestedAction: lifecycle.requestedAction,
      idempotencyKeyFields: policy.idempotencyKeyFields,
    },
    externalHandoff: {
      status: canCommit ? "ready_for_external_adapter" : canPreview ? "local_preview_only" : "blocked",
      adapterRequired: canCommit,
      suppressedCapabilities: externalWriteSuppressed
        ? writeCapabilitiesReady
        : [],
      nextAction: missingRequired.length
        ? "negotiate-provider-capabilities"
        : canCommit
          ? "sync.commit"
          : canPreview
            ? "sync.preview"
            : "settings.fix",
      digest: `capability:${negotiationDigest.slice(-12)}`,
    },
  };
}

function normalizeHealthObservation(input) {
  const source = input?.operationalHealth && typeof input.operationalHealth === "object"
    ? input.operationalHealth
    : input?.health && typeof input.health === "object"
      ? input.health
      : input?.providerHealth && typeof input.providerHealth === "object"
        ? input.providerHealth
        : input?.statusObservation && typeof input.statusObservation === "object"
          ? input.statusObservation
          : {};
  const observedStatusRaw = asCleanString(source.status, source.state)
    .toLowerCase()
    .replaceAll("-", "_");
  const httpStatus = asNonNegativeInteger(source.httpStatus ?? source.statusCode, 0);
  const consecutiveFailures = asNonNegativeInteger(source.consecutiveFailures ?? source.failureCount, 0);
  const retryAfterSeconds = asNonNegativeInteger(source.retryAfterSeconds ?? source.retryAfter, 0);
  const lastErrorCode = asCleanString(source.lastErrorCode, source.errorCode).toLowerCase().replaceAll(" ", "_");
  const statusFromHttp = httpStatus === 429
    ? "rate_limited"
    : httpStatus >= 500
      ? "unavailable"
      : httpStatus === 401 || httpStatus === 403
        ? "auth_failed"
        : httpStatus >= 400
          ? "degraded"
          : "";
  const observedStatus = HEALTH_OBSERVATION_STATUSES.includes(observedStatusRaw)
    ? observedStatusRaw
    : statusFromHttp || "unknown";
  const failureBudget = asNonNegativeInteger(source.failureBudget, 3);
  const circuitStateRaw = asCleanString(source.circuitState, source.circuitBreaker)
    .toLowerCase()
    .replaceAll("-", "_");
  const circuitState = ["closed", "half_open", "open"].includes(circuitStateRaw)
    ? circuitStateRaw
    : consecutiveFailures >= failureBudget && failureBudget > 0
      ? "open"
      : "closed";

  return {
    version: "mailchimp.provider-health-observation.v1",
    observedStatus,
    observedStatusRaw: observedStatusRaw || null,
    httpStatus: httpStatus || null,
    lastErrorCode: lastErrorCode || null,
    lastErrorMessage: asCleanString(source.lastErrorMessage, source.message) || null,
    checkedAt: asCleanString(source.checkedAt, source.observedAt) || null,
    consecutiveFailures,
    failureBudget,
    retryAfterSeconds,
    circuitState,
    adapterRegion: asCleanString(source.adapterRegion, source.region) || null,
    degradedModeAllowed: source.degradedModeAllowed !== false,
  };
}

function normalizeLifecycle(input) {
  const lifecycle = input?.lifecycle && typeof input.lifecycle === "object" ? input.lifecycle : {};
  const enabled = lifecycle.enabled !== false;
  const requestedActionRaw = asCleanString(lifecycle.requestedAction, enabled ? "sync.preview" : "provider.enable");
  const requestedAction = LIFECYCLE_ACTIONS.includes(requestedActionRaw)
    ? requestedActionRaw
    : enabled
      ? "sync.preview"
      : "provider.enable";
  const schedule = lifecycle.schedule && typeof lifecycle.schedule === "object" ? lifecycle.schedule : {};
  const cadenceRaw = asCleanString(schedule.cadence, "manual");
  const timezone = asCleanString(schedule.timezone, "UTC");
  const settings = lifecycle.settings && typeof lifecycle.settings === "object" ? lifecycle.settings : {};
  const requestedMaxPreviewRows = Number.isInteger(settings.maxPreviewRows) ? settings.maxPreviewRows : 100;
  const requestedAcceptanceMode = asCleanString(settings.acceptanceMode, "per-row");

  return {
    enabled,
    requestedAction,
    requestedActionRaw,
    controls: {
      allowPreview: lifecycle.allowPreview !== false,
      allowCommit: lifecycle.allowCommit === true,
      requireAcceptance: lifecycle.requireAcceptance !== false,
    },
    schedule: {
      cadence: SCHEDULE_CADENCES.includes(cadenceRaw) ? cadenceRaw : "manual",
      requestedCadence: cadenceRaw,
      timezone,
      window: asCleanString(schedule.window, "operator-controlled"),
      paused: schedule.paused === true,
    },
    settingsRevision: asCleanString(lifecycle.settingsRevision, "draft"),
    settings: {
      acceptanceMode: ["per-row", "all-or-none"].includes(requestedAcceptanceMode) ? requestedAcceptanceMode : "per-row",
      requestedAcceptanceMode,
      maxPreviewRows: Math.max(1, Math.min(requestedMaxPreviewRows, 500)),
      requestedMaxPreviewRows,
      clientVisibleSummary: settings.clientVisibleSummary !== false,
      requireValidationSummary: settings.requireValidationSummary !== false,
    },
  };
}

function normalizeRuntimeBoundary(input = {}) {
  const source = input.runtimeBoundary && typeof input.runtimeBoundary === "object"
    ? input.runtimeBoundary
    : input.tenantBoundary && typeof input.tenantBoundary === "object"
      ? input.tenantBoundary
      : input.permissionBoundary && typeof input.permissionBoundary === "object"
        ? input.permissionBoundary
        : input.clientRuntime?.tenantBoundary && typeof input.clientRuntime.tenantBoundary === "object"
          ? input.clientRuntime.tenantBoundary
          : {};
  const actor = source.actor && typeof source.actor === "object" ? source.actor : {};
  const grant = source.grant && typeof source.grant === "object" ? source.grant : {};
  const tenant = asCleanString(source.tenant, source.tenantId);
  const workspace = asCleanString(source.workspace, source.workspaceId);
  const actorId = asCleanString(source.actorId, actor.id);
  const permissions = asUniqueStrings(source.permissions ?? grant.permissions);
  const roles = asUniqueStrings(source.roles ?? actor.roles ?? grant.roles);
  const leaseState = asCleanString(source.leaseState, source.state ?? source.status ?? "observed")
    .toLowerCase()
    .replaceAll("-", "_");

  return {
    version: "mailchimp.runtime-boundary.v1",
    tenant,
    workspace,
    actorId,
    roles,
    permissions,
    leaseId: asCleanString(source.leaseId, source.id),
    leaseState,
    policyVersion: asCleanString(source.policyVersion, grant.policyVersion ?? "1"),
    issuedAt: asCleanString(source.issuedAt, source.at) || null,
    expiresAt: asCleanString(source.expiresAt, source.expiry) || null,
    auditSink: asCleanString(source.auditSink, source.audit?.sink ?? "local-runtime-audit"),
    source: asCleanString(source.source, grant.source ?? "runtime"),
  };
}

function permissionAllows(granted, required) {
  if (!required) return true;
  if (granted.includes("*") || granted.includes(required)) return true;
  return granted.some((permission) => permission.endsWith("*") && required.startsWith(permission.slice(0, -1)));
}

function actionPermissionMatrix(boundary, requiredPermissions) {
  const granted = boundary.permissions;
  const rows = requiredPermissions.map((permission) => {
    const action = permission.includes(".commit")
      ? "sync.commit"
      : permission.includes(".preview")
        ? "sync.preview"
        : permission.includes(".read")
          ? "audience.read"
          : "runtime.access";
    const allowed = permissionAllows(granted, permission);

    return {
      action,
      permission,
      allowed,
      source: allowed ? "grant" : "missing",
    };
  });

  return rows;
}

function buildRuntimeBoundaryAuthorization(boundary, requiredPermissions, controls) {
  const matrix = actionPermissionMatrix(boundary, requiredPermissions);
  const missingPermissions = matrix.filter((entry) => entry.allowed === false).map((entry) => entry.permission);
  const deniedActions = matrix.filter((entry) => entry.allowed === false).map((entry) => entry.action);
  const hasTenant = Boolean(boundary.tenant);
  const hasWorkspace = Boolean(boundary.workspace);
  const leaseActive = controls.leaseActive === true;
  const privileged = controls.privileged === true;
  const previewAllowed = hasTenant
    && hasWorkspace
    && leaseActive
    && (privileged || deniedActions.includes("sync.preview") === false);
  const commitAllowed = previewAllowed
    && controls.externalWritesRequested === true
    && (privileged || deniedActions.includes("sync.commit") === false);
  const deniedReasons = [
    ...(!hasTenant ? ["tenant_missing"] : []),
    ...(!hasWorkspace ? ["workspace_missing"] : []),
    ...(!leaseActive ? ["lease_inactive"] : []),
    ...missingPermissions.map((permission) => `permission_missing:${permission}`),
  ];
  const status = deniedReasons.length
    ? "denied"
    : commitAllowed
      ? "commit-authorized"
      : previewAllowed
        ? "preview-authorized"
        : "needs-boundary";
  const scope = {
    tenant: boundary.tenant || null,
    workspace: boundary.workspace || null,
    actorId: boundary.actorId || null,
    leaseId: boundary.leaseId || null,
    policyVersion: boundary.policyVersion,
  };
  const decisionDigest = stableContractDigest({
    scope,
    roles: boundary.roles,
    permissions: boundary.permissions,
    requiredPermissions,
    missingPermissions,
    leaseState: boundary.leaseState,
    status,
  });

  return {
    kind: "aios.provider.runtime_boundary_authorization",
    version: "mailchimp.runtime-boundary-authorization.v1",
    status,
    decisionDigest,
    scope,
    isolationKey: [
      boundary.tenant || "unbound-tenant",
      boundary.workspace || "unbound-workspace",
      boundary.policyVersion,
    ].join(":"),
    permissionMatrix: matrix,
    deniedActions,
    deniedReasons,
    missingPermissions,
    controls: {
      tenantScoped: hasTenant,
      workspaceScoped: hasWorkspace,
      leaseActive,
      privileged,
      previewAllowed,
      commitAllowed,
      externalWritesRequested: controls.externalWritesRequested === true,
    },
    auditChain: {
      sink: boundary.auditSink,
      eventType: "mailchimp.provider.authorization.evaluated",
      decisionDigest,
      appendOnly: true,
      restartSafe: true,
      requiredFields: [
        "tenant",
        "workspace",
        "actorId",
        "leaseId",
        "decisionDigest",
        "status",
      ],
    },
    handoff: {
      safeForPreview: previewAllowed,
      safeForCommit: commitAllowed,
      nextAction: deniedReasons.length
        ? "bind-runtime-boundary"
        : commitAllowed
          ? "sync.commit"
          : previewAllowed
            ? "sync.preview"
            : "operator.review",
      statusOnFailure: deniedReasons.length
        ? "runtime_boundary_authorization_required"
        : "runtime_boundary_authorized",
    },
  };
}

function buildRuntimeBoundaryContract(contract) {
  const boundary = contract.runtimeBoundary;
  const tenant = boundary.tenant || "unbound-tenant";
  const workspace = boundary.workspace || contract.audience.audienceId || "unbound-workspace";
  const requiredPermissions = [
    `tenant.${tenant}.mailchimp.read`,
    `workspace.${workspace}.mailchimp.preview`,
    contract.lifecycle.controls.allowCommit || contract.policy.allowExternalWrites
      ? `workspace.${workspace}.mailchimp.commit`
      : "",
  ].filter(Boolean);
  const privileged = boundary.roles.some((role) => ["owner", "admin", "mailchimp_admin", "integration_admin"].includes(role));
  const missingPermissions = requiredPermissions
    .filter((permission) => !permissionAllows(boundary.permissions, permission))
    .sort();
  const activeLease = !["expired", "revoked", "blocked"].includes(boundary.leaseState);
  const canPreview = Boolean(boundary.tenant && boundary.workspace && activeLease && (missingPermissions.length === 0 || privileged));
  const canCommit = canPreview
    && contract.policy.allowExternalWrites
    && (privileged || permissionAllows(boundary.permissions, `workspace.${workspace}.mailchimp.commit`));
  const boundaryDigest = stableContractDigest({
    tenant: boundary.tenant,
    workspace: boundary.workspace,
    actorId: boundary.actorId,
    roles: boundary.roles,
    permissions: boundary.permissions,
    leaseId: boundary.leaseId,
    policyVersion: boundary.policyVersion,
  });
  const authorization = buildRuntimeBoundaryAuthorization(boundary, requiredPermissions, {
    leaseActive: activeLease,
    privileged,
    externalWritesRequested: contract.policy.allowExternalWrites || contract.lifecycle.controls.allowCommit,
  });

  return {
    kind: "aios.provider.runtime_boundary",
    version: boundary.version,
    tenant: boundary.tenant || null,
    workspace: boundary.workspace || null,
    actorId: boundary.actorId || null,
    leaseId: boundary.leaseId || null,
    leaseState: boundary.leaseState,
    policyVersion: boundary.policyVersion,
    auditSink: boundary.auditSink,
    source: boundary.source,
    digest: boundaryDigest,
    requiredPermissions,
    grantedPermissions: boundary.permissions,
    roles: boundary.roles,
    missingPermissions,
    privileged,
    authorization,
    controls: {
      tenantScoped: Boolean(boundary.tenant),
      workspaceScoped: Boolean(boundary.workspace),
      leaseActive: activeLease,
      previewAllowed: canPreview && authorization.controls.previewAllowed,
      commitAllowed: canCommit && authorization.controls.commitAllowed,
      externalWritesSuppressed: !canCommit,
    },
    auditHandoff: {
      sink: boundary.auditSink,
      eventType: "mailchimp.provider.boundary.checked",
      tenant: boundary.tenant || null,
      workspace: boundary.workspace || null,
      actorId: boundary.actorId || null,
      boundaryDigest,
      authorizationDigest: authorization.decisionDigest,
      authorizationStatus: authorization.status,
      restartSafe: true,
    },
    nextAction: authorization.handoff.nextAction === "bind-runtime-boundary"
      ? "bind-runtime-boundary"
      : canPreview
        ? canCommit
        ? "sync.commit"
        : "sync.preview"
      : "bind-runtime-boundary",
  };
}

function collectLifecycleSettingsIssues(contract) {
  const issues = [];
  const lifecycle = contract.lifecycle;

  if (lifecycle.requestedActionRaw !== lifecycle.requestedAction) {
    issues.push({
      code: "lifecycle.action_unknown",
      severity: "warning",
      message: `Unknown lifecycle requestedAction ${lifecycle.requestedActionRaw}; runtime will expose ${lifecycle.requestedAction}.`,
      path: "lifecycle.requestedAction",
    });
  }

  if (lifecycle.schedule.requestedCadence !== lifecycle.schedule.cadence) {
    issues.push({
      code: "lifecycle.schedule_cadence_unknown",
      severity: "warning",
      message: `Unknown schedule cadence ${lifecycle.schedule.requestedCadence}; runtime will use manual scheduling.`,
      path: "lifecycle.schedule.cadence",
    });
  }

  if (!lifecycle.schedule.timezone || /\s/.test(lifecycle.schedule.timezone)) {
    issues.push({
      code: "lifecycle.schedule_timezone_shape",
      severity: "warning",
      message: "Schedule timezone should be a compact IANA timezone or UTC token.",
      path: "lifecycle.schedule.timezone",
    });
  }

  if (lifecycle.settings.requestedAcceptanceMode !== lifecycle.settings.acceptanceMode) {
    issues.push({
      code: "lifecycle.acceptance_mode_unknown",
      severity: "warning",
      message: `Unknown acceptanceMode ${lifecycle.settings.requestedAcceptanceMode}; runtime will use per-row acceptance.`,
      path: "lifecycle.settings.acceptanceMode",
    });
  }

  if (lifecycle.settings.requestedMaxPreviewRows < 1 || lifecycle.settings.requestedMaxPreviewRows > 500) {
    issues.push({
      code: "lifecycle.max_preview_rows_clamped",
      severity: "warning",
      message: "maxPreviewRows must be between 1 and 500; runtime will clamp the preview window.",
      path: "lifecycle.settings.maxPreviewRows",
    });
  }

  if (lifecycle.controls.requireAcceptance === false && lifecycle.controls.allowCommit) {
    issues.push({
      code: "lifecycle.commit_without_acceptance",
      severity: "warning",
      message: "Commit control is enabled without acceptance gating; runtime will still expose validation summary state.",
      path: "lifecycle.requireAcceptance",
    });
  }

  return issues;
}

function collectHealthObservationIssues(contract) {
  const health = contract.healthObservation;
  const issues = [];

  if (health.httpStatus && HEALTH_HTTP_TERMINAL.includes(health.httpStatus)) {
    issues.push({
      code: "health.provider_http_terminal",
      severity: health.httpStatus === 401 || health.httpStatus === 403 ? "error" : "warning",
      message: `Mailchimp health observation returned HTTP ${health.httpStatus}; operator action is required before adapter handoff if this persists.`,
      path: "operationalHealth.httpStatus",
    });
  }

  if (health.observedStatus === "auth_failed") {
    issues.push({
      code: "health.auth_failed",
      severity: "error",
      message: "Mailchimp health observation indicates authentication failed; refresh the secret reference before handoff.",
      path: "operationalHealth.status",
    });
  }

  if (health.observedStatus === "rate_limited") {
    issues.push({
      code: "health.rate_limited",
      severity: "warning",
      message: "Mailchimp health observation is rate limited; runtime should honor retryAfterSeconds before retrying.",
      path: "operationalHealth.retryAfterSeconds",
    });
  }

  if (health.observedStatus === "unavailable") {
    issues.push({
      code: "health.provider_unavailable",
      severity: "warning",
      message: "Mailchimp health observation reports provider unavailability; runtime should enter degraded preview mode.",
      path: "operationalHealth.status",
    });
  }

  if (health.circuitState === "open") {
    issues.push({
      code: "health.circuit_open",
      severity: health.degradedModeAllowed ? "warning" : "error",
      message: "Mailchimp provider health circuit is open after repeated failures.",
      path: "operationalHealth.circuitState",
    });
  }

  if (health.consecutiveFailures > health.failureBudget && health.failureBudget > 0) {
    issues.push({
      code: "health.failure_budget_exceeded",
      severity: health.degradedModeAllowed ? "warning" : "error",
      message: "Mailchimp provider health failure budget is exceeded.",
      path: "operationalHealth.consecutiveFailures",
    });
  }

  return issues;
}

function collectContractIssues(contract) {
  const issues = [];
  const boundaryContract = buildRuntimeBoundaryContract(contract);
  const capabilityNegotiation = contract.capabilityNegotiation;

  if (contract.provider.slug !== "mailchimp") {
    issues.push({
      code: "provider.unsupported",
      severity: "error",
      message: "Only Mailchimp provider contracts can be lowered by this binding.",
      path: "provider.slug",
    });
  }

  if (!contract.audience.audienceId) {
    issues.push({
      code: "audience.missing_id",
      severity: "error",
      message: "Mailchimp audienceId/listId is required for runtime handoff.",
      path: "audience.audienceId",
    });
  }

  if (!contract.auth.secretRef.startsWith("secret://")) {
    issues.push({
      code: "auth.secret_ref_boundary",
      severity: "error",
      message: "Mailchimp credentials must be supplied as a secret:// reference.",
      path: "auth.secretRef",
    });
  }

  if (contract.policy.allowExternalWrites) {
    issues.push({
      code: "policy.external_write_requested",
      severity: "warning",
      message: "External Mailchimp writes are represented as pending adapter operations until explicitly committed by the kernel.",
      path: "policy.allowExternalWrites",
    });
  }

  if (!contract.lifecycle.enabled && contract.lifecycle.controls.allowCommit) {
    issues.push({
      code: "lifecycle.commit_while_disabled",
      severity: "error",
      message: "Mailchimp commit controls cannot be enabled while the provider lifecycle is disabled.",
      path: "lifecycle.controls.allowCommit",
    });
  }

  if (contract.lifecycle.schedule.paused && contract.lifecycle.requestedAction === "sync.commit") {
    issues.push({
      code: "lifecycle.paused_commit",
      severity: "warning",
      message: "Commit action is requested while the provider schedule is paused; runtime will expose preview-only next actions.",
      path: "lifecycle.schedule.paused",
    });
  }

  if (contract.lifecycle.controls.allowCommit && !contract.policy.allowExternalWrites) {
    issues.push({
      code: "lifecycle.commit_requires_external_write_policy",
      severity: "warning",
      message: "Commit control is enabled, but policy.allowExternalWrites is false; commit syscalls will remain dry-run gated.",
      path: "policy.allowExternalWrites",
    });
  }

  for (const capability of capabilityNegotiation.missingRequiredCapabilities) {
    issues.push({
      code: "capability.required_missing",
      severity: "error",
      message: `Mailchimp adapter capability negotiation is missing required capability ${capability}.`,
      path: "capabilities",
    });
  }

  if (capabilityNegotiation.unavailableOptionalCapabilities.length > 0) {
    issues.push({
      code: "capability.optional_unavailable",
      severity: "warning",
      message: "One or more requested optional Mailchimp capabilities are unavailable and will be omitted from adapter handoff.",
      path: "capabilities",
    });
  }

  if (capabilityNegotiation.controls.externalWriteSuppressed) {
    issues.push({
      code: "capability.external_write_suppressed",
      severity: "warning",
      message: "Mailchimp write capabilities are present, but external writes are suppressed by policy.",
      path: "policy.allowExternalWrites",
    });
  }

  if (!boundaryContract.controls.tenantScoped) {
    issues.push({
      code: "runtime_boundary.tenant_missing",
      severity: "error",
      message: "Mailchimp provider runtime requires a tenant boundary before preview or commit handoff.",
      path: "runtimeBoundary.tenant",
    });
  }

  if (!boundaryContract.controls.workspaceScoped) {
    issues.push({
      code: "runtime_boundary.workspace_missing",
      severity: "error",
      message: "Mailchimp provider runtime requires a workspace boundary before preview or commit handoff.",
      path: "runtimeBoundary.workspace",
    });
  }

  if (!boundaryContract.controls.leaseActive) {
    issues.push({
      code: "runtime_boundary.lease_inactive",
      severity: "error",
      message: "Mailchimp runtime boundary lease is inactive and cannot authorize provider handoff.",
      path: "runtimeBoundary.leaseState",
    });
  }

  for (const permission of boundaryContract.missingPermissions) {
    issues.push({
      code: "runtime_boundary.permission_missing",
      severity: "error",
      message: `Mailchimp runtime boundary is missing permission ${permission}.`,
      path: "runtimeBoundary.permissions",
    });
  }

  if (boundaryContract.authorization.status === "denied") {
    issues.push({
      code: "runtime_boundary.authorization_denied",
      severity: "error",
      message: "Mailchimp runtime boundary authorization denied preview or commit handoff.",
      path: "runtimeBoundary.authorization",
    });
  }

  if (boundaryContract.authorization.auditChain.sink !== boundaryContract.auditSink) {
    issues.push({
      code: "runtime_boundary.audit_sink_mismatch",
      severity: "warning",
      message: "Mailchimp runtime boundary audit sink differs from the authorization audit chain.",
      path: "runtimeBoundary.auditSink",
    });
  }

  return [...issues, ...collectLifecycleSettingsIssues(contract), ...collectHealthObservationIssues(contract)];
}

function buildSettingsValidationSummary(contract, blockingIssues) {
  const issueCounts = contract.issues.reduce(
    (counts, issue) => ({
      ...counts,
      [issue.severity ?? "unknown"]: (counts[issue.severity ?? "unknown"] ?? 0) + 1,
    }),
    {},
  );

  return {
    status: blockingIssues.length ? "blocked" : "ready",
    checkedFields: [
      "provider.slug",
      "audience.audienceId",
      "auth.secretRef",
      "policy.allowExternalWrites",
      "lifecycle.enabled",
      "lifecycle.controls.allowPreview",
      "lifecycle.controls.allowCommit",
      "lifecycle.controls.requireAcceptance",
      "lifecycle.schedule.cadence",
      "lifecycle.schedule.timezone",
      "lifecycle.settings.acceptanceMode",
      "lifecycle.settings.maxPreviewRows",
      "capabilities.required",
      "capabilities.available",
      "capabilities.negotiated",
    ],
    normalizedSettings: {
      requestedAction: contract.lifecycle.requestedAction,
      settingsRevision: contract.lifecycle.settingsRevision,
      acceptanceMode: contract.lifecycle.settings.acceptanceMode,
      maxPreviewRows: contract.lifecycle.settings.maxPreviewRows,
      clientVisibleSummary: contract.lifecycle.settings.clientVisibleSummary,
      requireValidationSummary: contract.lifecycle.settings.requireValidationSummary,
      capabilityStatus: contract.capabilityNegotiation.status,
      negotiatedCapabilities: contract.capabilityNegotiation.negotiatedCapabilities,
      missingRequiredCapabilities: contract.capabilityNegotiation.missingRequiredCapabilities,
    },
    issueCounts,
    issueCodes: contract.issues.map((issue) => issue.code),
  };
}

function buildSchedulingControls(contract, previewAllowed, commitAllowed) {
  const schedule = contract.lifecycle.schedule;

  return {
    cadence: schedule.cadence,
    timezone: schedule.timezone,
    window: schedule.window,
    paused: schedule.paused,
    resumable: contract.lifecycle.enabled && schedule.paused,
    pausable: contract.lifecycle.enabled && !schedule.paused && schedule.cadence !== "manual",
    manualRunAllowed: previewAllowed,
    nextScheduledAction: schedule.paused
      ? "sync.resume"
      : commitAllowed
        ? "sync.commit"
        : previewAllowed
          ? "sync.preview"
          : "operator.review",
  };
}

function buildLifecycleCommandQueue(contract, lifecycleState) {
  const requestedCommand = lifecycleState.requestedAction === "settings.validate"
    ? "provider.settings.validate"
    : lifecycleState.requestedAction;
  const queue = [
    {
      command: "provider.settings.validate",
      status: lifecycleState.settingsValidation.status,
      reason: lifecycleState.settingsValidation.status === "ready"
        ? "Provider settings satisfy required Mailchimp boundaries."
        : "Resolve provider contract errors before runtime handoff.",
    },
    {
      command: lifecycleState.enabled ? "provider.disable" : "provider.enable",
      status: "ready",
      reason: lifecycleState.enabled ? "Disable future Mailchimp sync actions." : "Enable preview and validation actions.",
    },
    {
      command: contract.lifecycle.schedule.paused ? "sync.resume" : "sync.pause",
      status: lifecycleState.enabled ? "ready" : "blocked",
      reason: contract.lifecycle.schedule.paused
        ? "Resume scheduled Mailchimp sync evaluation."
        : "Pause scheduled Mailchimp sync evaluation.",
    },
    {
      command: "sync.preview",
      status: lifecycleState.controls.previewAllowed ? "ready" : "blocked",
      reason: lifecycleState.controls.previewAllowed
        ? "Preview can produce local artifacts without external provider writes."
        : "Preview is gated by lifecycle controls or contract errors.",
    },
    {
      command: "sync.commit",
      status: lifecycleState.controls.commitAllowed ? "ready" : "blocked",
      reason: lifecycleState.controls.commitAllowed
        ? "Commit can be handed to the adapter with external writes authorized."
        : "Commit requires enabled lifecycle, open schedule, acceptance, and external write policy.",
    },
  ];

  return queue.map((entry) => ({
    ...entry,
    requested: entry.command === requestedCommand,
  }));
}

function buildLifecycleTransitionPlan(contract, lifecycleState) {
  const schedule = contract.lifecycle.schedule;
  const requestedCommand = lifecycleState.requestedAction === "settings.validate"
    ? "provider.settings.validate"
    : lifecycleState.requestedAction;
  const queueByCommand = new Map(lifecycleState.commandQueue.map((entry) => [entry.command, entry]));
  const selected = queueByCommand.get(requestedCommand);
  const selectedStatus = selected?.status ?? "blocked";
  const blockedReason = selected
    ? selected.reason
    : `Requested lifecycle action ${contract.lifecycle.requestedAction} is not exposed by the Mailchimp runtime command queue.`;
  const commitRequested = requestedCommand === "sync.commit";
  const previewRequested = requestedCommand === "sync.preview";
  const settingsRequested = requestedCommand === "provider.settings.validate";
  const enableRequested = requestedCommand === "provider.enable";
  const disableRequested = requestedCommand === "provider.disable";
  const pauseRequested = requestedCommand === "sync.pause";
  const resumeRequested = requestedCommand === "sync.resume";
  const scheduleOpenRequired = commitRequested;
  const enabledRequired = previewRequested || commitRequested || pauseRequested || resumeRequested || disableRequested;
  const allowed = selectedStatus === "ready";
  const transitionStatus = allowed
    ? "ready"
    : selected
      ? "blocked"
      : "unsupported";
  const stateBefore = {
    enabled: contract.lifecycle.enabled,
    schedulePaused: schedule.paused,
    cadence: schedule.cadence,
    nextAction: lifecycleState.nextAction,
    settingsRevision: contract.lifecycle.settingsRevision,
    commitAllowed: lifecycleState.controls.commitAllowed,
    previewAllowed: lifecycleState.controls.previewAllowed,
  };
  const stateAfter = {
    enabled: enableRequested && allowed
      ? true
      : disableRequested && allowed
        ? false
        : contract.lifecycle.enabled,
    schedulePaused: pauseRequested && allowed
      ? true
      : resumeRequested && allowed
        ? false
        : schedule.paused,
    cadence: schedule.cadence,
    nextAction: allowed
      ? requestedCommand
      : lifecycleState.nextAction,
    settingsRevision: contract.lifecycle.settingsRevision,
    commitAllowed: commitRequested && allowed,
    previewAllowed: (previewRequested || commitRequested || settingsRequested) && lifecycleState.controls.previewAllowed,
  };
  const gateResults = [
    {
      gate: "settings.validated",
      passed: lifecycleState.settingsValidation.status === "ready",
      action: lifecycleState.settingsValidation.status === "ready" ? "continue" : "settings.fix",
    },
    {
      gate: "provider.enabled",
      passed: enabledRequired === false || contract.lifecycle.enabled || enableRequested,
      action: enabledRequired === false || contract.lifecycle.enabled || enableRequested ? "continue" : "provider.enable",
    },
    {
      gate: "schedule.open",
      passed: scheduleOpenRequired === false || schedule.paused === false || resumeRequested || settingsRequested || disableRequested,
      action: scheduleOpenRequired === false || schedule.paused === false || resumeRequested || settingsRequested || disableRequested
        ? "continue"
        : "sync.resume",
    },
    {
      gate: "external.writes.authorized",
      passed: commitRequested === false || lifecycleState.gates.externalWritesAuthorized === true,
      action: commitRequested === false || lifecycleState.gates.externalWritesAuthorized === true
        ? "continue"
        : "policy.authorize-external-writes",
    },
    {
      gate: "command.ready",
      passed: allowed,
      action: allowed ? requestedCommand : lifecycleState.nextAction,
    },
  ];
  const blockers = gateResults
    .filter((gate) => gate.passed === false)
    .map((gate) => ({
      code: `lifecycle.gate.${gate.gate.replaceAll(".", "_")}`,
      gate: gate.gate,
      action: gate.action,
    }));
  const resumeToken = stableContractDigest({
    provider: contract.provider.slug,
    audienceId: contract.audience.audienceId || "unbound",
    requestedCommand,
    stateAfter,
    settingsRevision: contract.lifecycle.settingsRevision,
  });

  return {
    kind: "aios.provider.lifecycle_transition_plan",
    version: "mailchimp.lifecycle-transition.v1",
    requestedCommand,
    requestedAction: contract.lifecycle.requestedAction,
    status: transitionStatus,
    allowed,
    reason: allowed
      ? `Lifecycle command ${requestedCommand} is ready for Mailchimp runtime handoff.`
      : blockedReason,
    stateBefore,
    stateAfter,
    gateResults,
    blockers,
    resume: {
      token: `lifecycle:${resumeToken.slice(-12)}`,
      restartSafe: true,
      idempotencyKey: stableContractDigest({
        requestedCommand,
        stateBefore,
        stateAfter,
        settingsRevision: contract.lifecycle.settingsRevision,
      }),
    },
    handoff: {
      command: allowed ? requestedCommand : lifecycleState.nextAction,
      nextAction: allowed ? requestedCommand : lifecycleState.nextAction,
      scheduleMutation: pauseRequested || resumeRequested,
      enablementMutation: enableRequested || disableRequested,
      externalWrites: commitRequested && allowed,
    },
  };
}

function buildLifecycleState(contract, blockingIssues) {
  const hasErrors = blockingIssues.length > 0;
  const previewAllowed = contract.lifecycle.enabled
    && contract.lifecycle.controls.allowPreview
    && !hasErrors;
  const commitAllowed = previewAllowed
    && contract.lifecycle.controls.allowCommit
    && contract.policy.allowExternalWrites
    && !contract.lifecycle.schedule.paused;
  const nextAction = !contract.lifecycle.enabled
    ? "provider.enable"
    : hasErrors
      ? "settings.fix"
      : commitAllowed
        ? "sync.commit"
        : previewAllowed
          ? "sync.preview"
          : "operator.review";

  const settingsValidation = buildSettingsValidationSummary(contract, blockingIssues);
  const schedulingControls = buildSchedulingControls(contract, previewAllowed, commitAllowed);
  const lifecycleState = {
    enabled: contract.lifecycle.enabled,
    requestedAction: contract.lifecycle.requestedAction,
    nextAction,
    settingsRevision: contract.lifecycle.settingsRevision,
    settings: contract.lifecycle.settings,
    settingsValidation,
    schedule: contract.lifecycle.schedule,
    schedulingControls,
    controls: {
      previewAllowed,
      commitAllowed,
      acceptanceRequired: contract.lifecycle.controls.requireAcceptance,
      enableAllowed: !contract.lifecycle.enabled,
      disableAllowed: contract.lifecycle.enabled,
    },
    gates: {
      providerReady: !hasErrors,
      scheduleOpen: !contract.lifecycle.schedule.paused,
      externalWritesAuthorized: contract.policy.allowExternalWrites,
      settingsValidated: settingsValidation.status === "ready",
    },
  };

  const lifecycleWithQueue = {
    ...lifecycleState,
    commandQueue: buildLifecycleCommandQueue(contract, lifecycleState),
  };

  return {
    ...lifecycleWithQueue,
    transitionPlan: buildLifecycleTransitionPlan(contract, lifecycleWithQueue),
  };
}

function buildPreviewAcceptanceContract(contract, lifecycleState, blockingIssues) {
  const requiredMergeFields = contract.audience.requiredMergeFields;
  const allowedMemberFields = contract.audience.allowedMemberFields;
  const acceptanceRequired = lifecycleState.controls.acceptanceRequired;
  const validationIssueCodes = lifecycleState.settingsValidation.issueCodes;
  const blockingIssueCodes = blockingIssues.map((issue) => issue.code);
  const previewWindow = {
    mode: "bounded-client-preview",
    maxRows: contract.lifecycle.settings.maxPreviewRows,
    redactedFields: ["email_address", "merge_fields", "interests"],
    visibleFields: allowedMemberFields.filter((field) => field !== "interests"),
  };
  const acceptanceGate = {
    required: acceptanceRequired,
    mode: contract.lifecycle.settings.acceptanceMode,
    status: blockingIssueCodes.length
      ? "blocked"
      : acceptanceRequired
        ? "awaiting-operator-acceptance"
        : "not-required",
    requiredActions: acceptanceRequired
      ? ["review.preview_rows", "accept.validation_summary"]
      : ["review.validation_summary"],
  };
  const readinessReasons = [
    {
      code: "capability.negotiation",
      status: contract.capabilityNegotiation.controls.previewCapable ? "ready" : "blocked",
      message: contract.capabilityNegotiation.controls.previewCapable
        ? "Mailchimp adapter capabilities satisfy local preview handoff."
        : "Mailchimp adapter capability negotiation is missing required preview capabilities.",
    },
    {
      code: "settings.validation",
      status: lifecycleState.settingsValidation.status,
      message: lifecycleState.settingsValidation.status === "ready"
        ? "Provider settings are normalized and ready for preview."
        : "Provider settings have blocking contract errors.",
    },
    {
      code: "preview.control",
      status: lifecycleState.controls.previewAllowed ? "ready" : "blocked",
      message: lifecycleState.controls.previewAllowed
        ? "Preview is available as a local artifact handoff."
        : "Preview is unavailable until lifecycle controls and contract errors are resolved.",
    },
    {
      code: "commit.control",
      status: lifecycleState.controls.commitAllowed ? "ready" : "blocked",
      message: lifecycleState.controls.commitAllowed
        ? "Commit can be adapter-mediated after acceptance."
        : "Commit remains gated by acceptance, schedule, or external write policy.",
    },
  ];

  return {
    kind: "aios.provider.preview_acceptance_contract",
    status: blockingIssueCodes.length
      ? "blocked"
      : lifecycleState.controls.commitAllowed
        ? acceptanceGate.status
        : lifecycleState.controls.previewAllowed
          ? "preview-ready"
          : "needs-operator-action",
    previewWindow,
    acceptanceGate,
    validationSummary: {
      status: lifecycleState.settingsValidation.status,
      requiredMergeFields,
      allowedMemberFields,
      issueCodes: validationIssueCodes,
      blockingIssueCodes,
      checkedFields: lifecycleState.settingsValidation.checkedFields,
      capabilityNegotiation: {
        status: contract.capabilityNegotiation.status,
        requiredCapabilities: contract.capabilityNegotiation.requiredCapabilities,
        negotiatedCapabilities: contract.capabilityNegotiation.negotiatedCapabilities,
        missingRequiredCapabilities: contract.capabilityNegotiation.missingRequiredCapabilities,
      },
    },
    nextSteps: readinessReasons
      .filter((reason) => reason.status !== "ready")
      .map((reason) => ({
        code: reason.code,
        action: reason.code === "settings.validation"
          ? "settings.fix"
          : reason.code === "capability.negotiation"
            ? "negotiate-provider-capabilities"
          : reason.code === "preview.control"
            ? "provider.enable"
            : "sync.preview",
        message: reason.message,
      })),
    readinessReasons,
  };
}

function buildClientPreviewSurface(contract, lifecycleState, previewAcceptance, operationalHealth) {
  const blockingIssueCodes = previewAcceptance.validationSummary.blockingIssueCodes;
  const previewEnabled = lifecycleState.controls.previewAllowed && blockingIssueCodes.length === 0;
  const commitEnabled = lifecycleState.controls.commitAllowed && previewAcceptance.acceptanceGate.status !== "blocked";
  const primaryAction = blockingIssueCodes.length
    ? "settings.fix"
    : previewEnabled
      ? "sync.preview"
      : lifecycleState.controls.enableAllowed
        ? "provider.enable"
        : "operator.review";
  const acceptanceAction = previewAcceptance.acceptanceGate.required
    ? "preview.accept"
    : "validation.acknowledge";

  return {
    kind: "aios.provider.client_preview_surface",
    version: "mailchimp.preview.acceptance.v1",
    audienceId: contract.audience.audienceId || null,
    provider: contract.provider.slug,
    product: contract.provider.product,
    status: previewAcceptance.status,
    userVisible: contract.lifecycle.settings.clientVisibleSummary,
    readiness: {
      status: operationalHealth.status,
      previewEnabled,
      commitEnabled,
      degraded: operationalHealth.degraded,
      blockingIssueCodes,
      warningIssueCodes: contract.issues
        .filter((issue) => issue.severity === "warning")
        .map((issue) => issue.code),
    },
    preview: {
      mode: previewAcceptance.previewWindow.mode,
      maxRows: previewAcceptance.previewWindow.maxRows,
      visibleFields: previewAcceptance.previewWindow.visibleFields,
      redactedFields: previewAcceptance.previewWindow.redactedFields,
      validationSummaryRequired: contract.lifecycle.settings.requireValidationSummary,
    },
    acceptance: {
      required: previewAcceptance.acceptanceGate.required,
      mode: previewAcceptance.acceptanceGate.mode,
      status: previewAcceptance.acceptanceGate.status,
      requiredActions: previewAcceptance.acceptanceGate.requiredActions,
      acceptedByDefault: previewAcceptance.acceptanceGate.required === false,
    },
    nextActions: [
      {
        id: primaryAction,
        label: primaryAction === "sync.preview"
          ? "Build Mailchimp preview"
          : primaryAction === "provider.enable"
            ? "Enable Mailchimp provider"
            : primaryAction === "settings.fix"
              ? "Fix provider settings"
              : "Review provider state",
        enabled: primaryAction !== "settings.fix" || blockingIssueCodes.length > 0,
        reason: previewAcceptance.readinessReasons.find((reason) => reason.status !== "ready")?.message
          ?? "Provider preview surface is ready for the next workflow step.",
      },
      {
        id: acceptanceAction,
        label: previewAcceptance.acceptanceGate.required
          ? "Accept preview rows"
          : "Acknowledge validation summary",
        enabled: previewEnabled,
        reason: previewAcceptance.acceptanceGate.required
          ? "Operator acceptance is required before adapter-mediated commit."
          : "Validation acknowledgement is captured for audit even when acceptance is optional.",
      },
      {
        id: "sync.commit",
        label: "Commit through adapter",
        enabled: commitEnabled,
        reason: commitEnabled
          ? "Commit is available after preview acceptance."
          : "Commit is gated by lifecycle controls, schedule state, acceptance, or external write policy.",
      },
    ],
    handoff: {
      status: commitEnabled ? "ready_for_adapter_commit" : previewEnabled ? "preview_ready" : "blocked",
      commitMode: contract.policy.allowExternalWrites ? "adapter-mediated" : "dry-run",
      settingsRevision: contract.lifecycle.settingsRevision,
      requestedCommand: lifecycleState.transitionPlan.requestedCommand,
      transitionStatus: lifecycleState.transitionPlan.status,
      transitionBlockers: lifecycleState.transitionPlan.blockers,
      digest: stableContractDigest({
        contractDigest: contract.digest,
        lifecycleState,
        previewAcceptance,
        operationalHealth,
      }),
    },
  };
}

function buildPreviewApprovalContract(contract, lifecycleState, previewAcceptance, operationalHealth, blockingIssues) {
  const subjectParts = [
    "mailchimp",
    contract.audience.audienceId || "unbound-audience",
    contract.lifecycle.settingsRevision || "draft",
  ];
  const blockingIssueCodes = blockingIssues.map((issue) => issue.code);
  const warningIssueCodes = contract.issues
    .filter((issue) => issue.severity === "warning")
    .map((issue) => issue.code);
  const approvalRequired = previewAcceptance.acceptanceGate.required === true;
  const sourceStatus = operationalHealth.status === "unavailable" || operationalHealth.failureState?.terminal
    ? "unavailable"
    : operationalHealth.degraded || warningIssueCodes.length > 0
      ? "degraded"
      : "healthy";
  const approval = createApprovalPreviewAcceptanceContract({
    action: "preview.accept",
    subject: subjectParts.join(":"),
    approvalId: `approval:mailchimp:${contract.audience.audienceId || "unbound"}:${contract.lifecycle.settingsRevision || "draft"}`,
    clientRequest: lifecycleState.transitionPlan?.resume?.token ?? contract.digest,
    reason: approvalRequired
      ? "Accept Mailchimp preview validation summary before adapter-mediated commit."
      : "Acknowledge Mailchimp preview validation summary for audit handoff.",
    risk: contract.policy.allowExternalWrites ? "medium" : "low",
    ttl: "15m",
    health: sourceStatus,
    retryAfter: operationalHealth.retryPlan?.retryAfterSeconds
      ? `${Math.max(1, operationalHealth.retryPlan.retryAfterSeconds)}s`
      : sourceStatus === "healthy" ? "0s" : "30s",
    blockingIssueCodes,
    warningIssueCodes,
    approvalRequired,
    userVisible: contract.lifecycle.settings.clientVisibleSummary,
    exportLabel: `mailchimp-preview:${contract.audience.audienceId || "unbound"}`,
  });
  const acceptanceBlocked = previewAcceptance.acceptanceGate.status === "blocked" || approval.status === "blocked";
  const acceptanceReady = lifecycleState.controls.previewAllowed
    && acceptanceBlocked === false
    && previewAcceptance.validationSummary.status === "ready";
  const clientResumeCheckpoint = approval.clientResumeCheckpoint ?? approval.descriptor?.clientResumeCheckpoint ?? null;

  return {
    ...approval,
    provider: contract.provider.slug,
    product: contract.provider.product,
    audienceId: contract.audience.audienceId || null,
    settingsRevision: contract.lifecycle.settingsRevision,
    acceptanceGate: previewAcceptance.acceptanceGate,
    validationSummary: previewAcceptance.validationSummary,
    readiness: {
      ...approval.readiness,
      approvalRequired,
      acceptanceReady,
      previewAllowed: lifecycleState.controls.previewAllowed,
      commitAllowed: lifecycleState.controls.commitAllowed,
      healthStatus: operationalHealth.status,
      blockingIssueCodes,
      warningIssueCodes,
    },
    clientAction: {
      id: acceptanceBlocked
        ? "settings.fix"
        : approvalRequired
          ? "preview.accept"
          : "validation.acknowledge",
      label: acceptanceBlocked
        ? "Fix provider settings"
        : approvalRequired
          ? "Accept preview rows"
          : "Acknowledge validation summary",
      enabled: acceptanceReady,
      nextOnSuccess: lifecycleState.controls.commitAllowed ? "sync.commit" : "sync.preview",
    },
    clientResumeCheckpoint: clientResumeCheckpoint
      ? {
          ...clientResumeCheckpoint,
          provider: contract.provider.slug,
          product: contract.provider.product,
          audienceId: contract.audience.audienceId || null,
          settingsRevision: contract.lifecycle.settingsRevision,
          runtimeNextAction: lifecycleState.nextAction,
          validationStatus: previewAcceptance.validationSummary.status,
          lifecycleTransitionStatus: lifecycleState.transitionPlan?.status ?? null,
          checkpointScope: {
            providerJobSubject: subjectParts.join(":"),
            acceptanceMode: previewAcceptance.acceptanceGate.mode,
            acceptanceStatus: previewAcceptance.acceptanceGate.status,
            commitMode: contract.policy.allowExternalWrites ? "adapter-mediated" : "dry-run",
            externalWritesAuthorized: lifecycleState.gates.externalWritesAuthorized,
          },
          providerReplayBinding: {
            replayManifestId: clientResumeCheckpoint.replayManifest?.manifestId ?? null,
            replayStatus: clientResumeCheckpoint.replayManifest?.status ?? null,
            replayChecksum: clientResumeCheckpoint.replayManifest?.checksum ?? clientResumeCheckpoint.checksum ?? null,
            stateKeySeed: stableContractDigest({
              provider: contract.provider.slug,
              audienceId: contract.audience.audienceId || "unbound",
              settingsRevision: contract.lifecycle.settingsRevision,
              checkpointKey: clientResumeCheckpoint.checkpointKey,
              replayManifestId: clientResumeCheckpoint.replayManifest?.manifestId ?? null,
            }),
            restartSafe: clientResumeCheckpoint.replayManifest?.restartSafe !== false,
            localOnly: clientResumeCheckpoint.replayManifest?.localOnly !== false,
          },
        }
      : null,
    handoff: {
      approvalId: approval.approvalId,
      approvalStatus: approval.status,
      receiptStatus: approval.statusContract.receipt.status,
      adapterStatus: approval.statusContract.adapter.status,
      nextAction: acceptanceBlocked
        ? "settings.fix"
        : approvalRequired
          ? "preview.accept"
          : lifecycleState.nextAction,
      reportId: approval.reporting.reportId,
      exportReady: approval.reporting.exportReady,
      checkpointKey: clientResumeCheckpoint?.checkpointKey ?? null,
      checkpointStatus: clientResumeCheckpoint?.status ?? null,
      checkpointCommandId: clientResumeCheckpoint?.commands?.persist?.id ?? null,
      resumeCommandId: clientResumeCheckpoint?.commands?.resume?.id ?? null,
      replayManifestId: clientResumeCheckpoint?.replayManifest?.manifestId ?? null,
      replayStatus: clientResumeCheckpoint?.replayManifest?.status ?? null,
      replayChecksum: clientResumeCheckpoint?.replayManifest?.checksum ?? clientResumeCheckpoint?.checksum ?? null,
      nextClientAction: clientResumeCheckpoint?.clientStatus?.nextClientAction ?? null,
      digest: stableContractDigest({
        approvalId: approval.approvalId,
        contractDigest: contract.digest,
        validationStatus: previewAcceptance.validationSummary.status,
        lifecycleTransition: lifecycleState.transitionPlan?.status,
        healthStatus: operationalHealth.status,
        checkpointKey: clientResumeCheckpoint?.checkpointKey ?? null,
        replayManifestId: clientResumeCheckpoint?.replayManifest?.manifestId ?? null,
      }),
    },
  };
}

function normalizeClientRuntimeInput(input = {}) {
  const runtime = input.clientRuntime && typeof input.clientRuntime === "object"
    ? input.clientRuntime
    : input.runtime && typeof input.runtime === "object"
      ? input.runtime
      : {};
  const request = input.request && typeof input.request === "object" ? input.request : {};
  const workflow = input.workflow && typeof input.workflow === "object" ? input.workflow : {};
  const handoff = runtime.handoff && typeof runtime.handoff === "object"
    ? runtime.handoff
    : input.handoff && typeof input.handoff === "object"
      ? input.handoff
      : {};

  return {
    requestId: asCleanString(runtime.requestId, request.id),
    conversationId: asCleanString(runtime.conversationId, request.conversationId),
    userMessageId: asCleanString(runtime.userMessageId, request.userMessageId),
    workflowId: asCleanString(runtime.workflowId, workflow.id),
    workflowStep: asCleanString(runtime.workflowStep, workflow.step),
    clientVisibleStatus: asCleanString(runtime.clientVisibleStatus, "provider_settings_review"),
    resumeToken: asCleanString(runtime.resumeToken, handoff.resumeToken),
    adapterRunId: asCleanString(runtime.adapterRunId, handoff.adapterRunId),
    handoffStatus: asCleanString(runtime.handoffStatus, handoff.status) || "not_started",
  };
}

function buildClientRuntimeHandoffContract(input, contract, lifecycleState, previewAcceptance, operationalHealth) {
  const runtime = normalizeClientRuntimeInput(input);
  const runtimeBoundary = contract.runtimeBoundaryContract || buildRuntimeBoundaryContract(contract);
  const requiredFields = ["requestId", "workflowId", "workflowStep"];
  const missingFields = requiredFields.filter((field) => !runtime[field]);
  const acceptanceBlocked = previewAcceptance.acceptanceGate.status === "blocked";
  const acceptancePending = [
    "awaiting-operator-acceptance",
    "needs_acceptance",
    "needs_validation_ack",
  ].includes(previewAcceptance.acceptanceGate.status);
  const retryable = operationalHealth.retryPlan.mode !== "do-not-retry-until-settings-change"
    && operationalHealth.failureState.terminal !== true;
  const handoffReady = missingFields.length === 0
    && lifecycleState.controls.previewAllowed
    && acceptanceBlocked === false;
  const status = missingFields.length
    ? "needs_client_state"
    : acceptanceBlocked
      ? "blocked"
      : acceptancePending
        ? "awaiting_preview_acceptance"
        : handoffReady
          ? "ready_for_client_handoff"
          : "needs_operator_action";

  return {
    kind: "aios.provider.client_runtime_handoff",
    version: "mailchimp.client-runtime-handoff.v1",
    status,
    provider: contract.provider.slug,
    audienceId: contract.audience.audienceId || null,
    requestState: {
      requestId: runtime.requestId || null,
      conversationId: runtime.conversationId || null,
      userMessageId: runtime.userMessageId || null,
      workflowId: runtime.workflowId || null,
      workflowStep: runtime.workflowStep || null,
      clientVisibleStatus: runtime.clientVisibleStatus,
      missingFields,
    },
    workflowHandoff: {
      handoffStatus: runtime.handoffStatus,
      adapterRunId: runtime.adapterRunId || null,
      resumeToken: runtime.resumeToken || null,
      continuationKey: stableContractDigest({
        provider: contract.provider.slug,
        audienceId: contract.audience.audienceId || "unbound",
        requestId: runtime.requestId || "unbound-request",
        workflowId: runtime.workflowId || "unbound-workflow",
        settingsRevision: contract.lifecycle.settingsRevision,
      }),
      nextClientAction: missingFields.length
        ? "bind-client-runtime-state"
        : acceptanceBlocked
          ? "fix-provider-settings"
          : acceptancePending
            ? "collect-preview-acceptance"
            : lifecycleState.nextAction === "sync.commit"
              ? "show-commit-review"
              : "show-preview-review",
      lifecycleTransition: {
        requestedCommand: lifecycleState.transitionPlan.requestedCommand,
        status: lifecycleState.transitionPlan.status,
        allowed: lifecycleState.transitionPlan.allowed,
        nextAction: lifecycleState.transitionPlan.handoff.nextAction,
        resumeToken: lifecycleState.transitionPlan.resume.token,
        blockers: lifecycleState.transitionPlan.blockers,
      },
    },
    retryPolicy: {
      retryable,
      retryLimit: contract.policy.retryLimit,
      backoff: retryable ? operationalHealth.retryPlan.backoff : "none",
      retryableIssueCodes: operationalHealth.retryPlan.retryableIssueCodes,
      blockedIssueCodes: previewAcceptance.validationSummary.blockingIssueCodes,
    },
    handoffGuards: {
      settingsValidated: lifecycleState.gates.settingsValidated,
      previewAllowed: lifecycleState.controls.previewAllowed,
      acceptanceRequired: lifecycleState.controls.acceptanceRequired,
      externalWritesAuthorized: lifecycleState.gates.externalWritesAuthorized,
      lifecycleTransitionAllowed: lifecycleState.transitionPlan.allowed,
      lifecycleTransitionCommand: lifecycleState.transitionPlan.requestedCommand,
      commitMode: contract.policy.allowExternalWrites ? "adapter-mediated" : "dry-run",
      runtimeBoundary: {
        digest: runtimeBoundary.digest,
        tenant: runtimeBoundary.tenant,
        workspace: runtimeBoundary.workspace,
        leaseActive: runtimeBoundary.controls.leaseActive,
        previewAllowed: runtimeBoundary.controls.previewAllowed,
        commitAllowed: runtimeBoundary.controls.commitAllowed,
        auditSink: runtimeBoundary.auditSink,
      },
    },
  };
}

function normalizePersistedProviderRuntimeState(state = {}) {
  const runtime = state && typeof state === "object" ? state : {};
  const requestState = runtime.requestState && typeof runtime.requestState === "object"
    ? runtime.requestState
    : {};
  const workflowHandoff = runtime.workflowHandoff && typeof runtime.workflowHandoff === "object"
    ? runtime.workflowHandoff
    : {};

  return {
    contractVersion: asCleanString(runtime.contractVersion, "aios.provider.runtime-state.mailchimp.v1"),
    stateKey: asCleanString(runtime.stateKey, runtime.key),
    providerJobId: asCleanString(runtime.providerJobId, runtime.jobId),
    audienceId: asCleanString(runtime.audienceId, requestState.audienceId),
    settingsRevision: asCleanString(runtime.settingsRevision, requestState.settingsRevision),
    status: asCleanString(runtime.status, "unknown"),
    sequence: Number.isInteger(runtime.sequence) && runtime.sequence >= 0 ? runtime.sequence : 0,
    checksum: asCleanString(runtime.checksum, ""),
    persistedAt: asCleanString(runtime.persistedAt, "") || null,
    requestState: {
      requestId: asCleanString(requestState.requestId, runtime.requestId),
      workflowId: asCleanString(requestState.workflowId, runtime.workflowId),
      workflowStep: asCleanString(requestState.workflowStep, runtime.workflowStep),
      conversationId: asCleanString(requestState.conversationId, runtime.conversationId),
      userMessageId: asCleanString(requestState.userMessageId, runtime.userMessageId),
      missingFields: asUniqueStrings(requestState.missingFields),
    },
    workflowHandoff: {
      handoffStatus: asCleanString(workflowHandoff.handoffStatus, runtime.handoffStatus) || "not_started",
      adapterRunId: asCleanString(workflowHandoff.adapterRunId, runtime.adapterRunId),
      resumeToken: asCleanString(workflowHandoff.resumeToken, runtime.resumeToken),
      continuationKey: asCleanString(workflowHandoff.continuationKey, runtime.continuationKey),
      nextClientAction: asCleanString(workflowHandoff.nextClientAction, runtime.nextClientAction),
    },
  };
}

function providerRuntimeStateKey(contract, clientRuntimeHandoff) {
  return [
    "mailchimp",
    contract.runtimeBoundary?.tenant || "unbound-tenant",
    contract.runtimeBoundary?.workspace || "unbound-workspace",
    contract.audience.audienceId || "unbound-audience",
    contract.lifecycle.settingsRevision || "draft",
    clientRuntimeHandoff.workflowHandoff.continuationKey || "continuation",
  ].join(":");
}

function providerRuntimeCommandId(kind, stateKey, checksum) {
  return [
    "mailchimp.provider.runtime",
    kind,
    stateKey || "state",
    checksum || "checksum",
  ]
    .join(".")
    .toLowerCase()
    .replace(/[^a-z0-9.:/_-]+/g, "-")
    .replace(/-+/g, "-");
}

function buildProviderRuntimePersistence(contract, jobId, lifecycleState, previewAcceptance, previewApproval, clientRuntimeHandoff, persistedState = {}) {
  const previous = normalizePersistedProviderRuntimeState(persistedState);
  const runtimeBoundary = buildRuntimeBoundaryContract(contract);
  const stateKey = providerRuntimeStateKey(contract, clientRuntimeHandoff);
  const missingClientState = clientRuntimeHandoff.requestState.missingFields;
  const blockedIssueCodes = Array.isArray(previewAcceptance.validationSummary?.blockingIssueCodes)
    ? previewAcceptance.validationSummary.blockingIssueCodes
    : [];
  const status = blockedIssueCodes.length
    ? "blocked"
    : missingClientState.length
      ? "needs_client_state"
      : clientRuntimeHandoff.status;
  const sequence = previous.stateKey === stateKey ? previous.sequence + 1 : 1;
  const stateBody = {
    provider: contract.provider.slug,
    providerJobId: jobId,
    audienceId: contract.audience.audienceId || null,
    settingsRevision: contract.lifecycle.settingsRevision,
    status,
    lifecycleNextAction: lifecycleState.nextAction,
    requestState: clientRuntimeHandoff.requestState,
    workflowHandoff: clientRuntimeHandoff.workflowHandoff,
    lifecycleTransition: lifecycleState.transitionPlan,
    handoffGuards: clientRuntimeHandoff.handoffGuards,
    runtimeBoundary: {
      tenant: runtimeBoundary.tenant,
      workspace: runtimeBoundary.workspace,
      leaseId: runtimeBoundary.leaseId,
      leaseState: runtimeBoundary.leaseState,
      digest: runtimeBoundary.digest,
      missingPermissions: runtimeBoundary.missingPermissions,
    },
    approvalReplay: {
      approvalId: previewApproval.approvalId ?? null,
      checkpointKey: previewApproval.clientResumeCheckpoint?.checkpointKey ?? null,
      replayManifestId: previewApproval.clientResumeCheckpoint?.replayManifest?.manifestId ?? null,
      replayStatus: previewApproval.clientResumeCheckpoint?.replayManifest?.status ?? null,
      replayChecksum: previewApproval.clientResumeCheckpoint?.replayManifest?.checksum
        ?? previewApproval.clientResumeCheckpoint?.checksum
        ?? null,
      resumeCommandId: previewApproval.clientResumeCheckpoint?.commands?.resume?.id ?? null,
    },
    blockedIssueCodes,
    sequence,
  };
  const checksum = stableContractDigest(stateBody);
  const persistCommandId = providerRuntimeCommandId("persist", stateKey, checksum);
  const resumeCommandId = providerRuntimeCommandId(
    "resume",
    stateKey,
    clientRuntimeHandoff.workflowHandoff.resumeToken || clientRuntimeHandoff.workflowHandoff.adapterRunId || checksum,
  );
  const alreadyPersisted = previous.checksum === checksum;
  const canResume = missingClientState.length === 0
    && blockedIssueCodes.length === 0
    && Boolean(
      clientRuntimeHandoff.workflowHandoff.resumeToken
        || clientRuntimeHandoff.workflowHandoff.adapterRunId
        || clientRuntimeHandoff.workflowHandoff.handoffStatus === "handoff_started",
    );

  return {
    kind: "aios.provider.runtime_persistence",
    version: "mailchimp.provider-runtime-state.v1",
    stateKey,
    providerJobId: jobId,
    audienceId: contract.audience.audienceId || null,
    runtimeBoundary,
    settingsRevision: contract.lifecycle.settingsRevision,
    status,
    sequence,
    checksum,
    previousChecksum: previous.checksum || null,
    restartSafe: true,
    alreadyPersisted,
    persistCommand: {
      commandVersion: "aios.provider.runtime-command.v1",
      id: persistCommandId,
      type: "persist-provider-runtime-state",
      idempotencyKey: persistCommandId,
      stateKey,
      checksum,
      expectedPreviousChecksum: previous.checksum || null,
      status: alreadyPersisted ? "already_persisted" : "ready_to_persist",
      externalWrites: false,
    },
    resumeCommand: {
      commandVersion: "aios.provider.runtime-command.v1",
      id: resumeCommandId,
      type: "resume-provider-runtime-state",
      idempotencyKey: resumeCommandId,
      stateKey,
      continuationKey: clientRuntimeHandoff.workflowHandoff.continuationKey,
      resumeToken: clientRuntimeHandoff.workflowHandoff.resumeToken || null,
      adapterRunId: clientRuntimeHandoff.workflowHandoff.adapterRunId || null,
      status: canResume ? "ready_to_resume" : "blocked",
      externalWrites: false,
    },
    approvalReplay: {
      approvalId: previewApproval.approvalId ?? null,
      checkpointKey: previewApproval.clientResumeCheckpoint?.checkpointKey ?? null,
      replayManifestId: previewApproval.clientResumeCheckpoint?.replayManifest?.manifestId ?? null,
      replayStatus: previewApproval.clientResumeCheckpoint?.replayManifest?.status ?? null,
      replayChecksum: previewApproval.clientResumeCheckpoint?.replayManifest?.checksum
        ?? previewApproval.clientResumeCheckpoint?.checksum
        ?? null,
      resumeCommandId: previewApproval.clientResumeCheckpoint?.commands?.resume?.id ?? null,
      restartSafe: previewApproval.clientResumeCheckpoint?.replayManifest?.restartSafe !== false,
      localOnly: previewApproval.clientResumeCheckpoint?.replayManifest?.localOnly !== false,
    },
    recovery: [
      ...missingClientState.map((field) => ({
        code: "provider_runtime_missing_client_state",
        field,
        action: "bind-client-runtime-state-before-provider-resume",
      })),
      ...blockedIssueCodes.map((code) => ({
        code: "provider_runtime_blocked_issue",
        field: code,
        action: "resolve-provider-validation-before-provider-resume",
      })),
      ...(runtimeBoundary.controls.previewAllowed
        ? []
        : [{
            code: "provider_runtime_boundary_not_ready",
            field: "runtimeBoundary",
            action: runtimeBoundary.nextAction,
          }]),
      ...(previous.stateKey && previous.stateKey !== stateKey
        ? [{
            code: "provider_runtime_state_key_changed",
            previousStateKey: previous.stateKey,
            nextStateKey: stateKey,
            action: "persist-new-runtime-state-before-resume",
          }]
        : []),
      ...(alreadyPersisted
        ? [{
            code: "provider_runtime_state_already_persisted",
            checksum,
            action: "treat-persist-command-as-idempotent-success",
          }]
        : []),
    ],
  };
}

function normalizeAnalyticsHistoryEntry(entry = {}, index = 0) {
  const source = entry && typeof entry === "object" ? entry : {};
  const counters = source.counters && typeof source.counters === "object" ? source.counters : {};
  const blockedReasons = asUniqueStrings(source.blockedReasons ?? source.blockers ?? source.issueCodes);
  const status = asCleanString(source.status, source.exportStatus) || "unknown";
  const nextAction = asCleanString(source.nextAction, source.action) || "operator.review";
  const digest = asCleanString(source.digest, source.exportDigest) || stableContractDigest({
    status,
    nextAction,
    blockedReasons,
    counters,
    index,
  });

  return {
    version: "mailchimp.provider-analytics-history-entry.v1",
    index: asNonNegativeInteger(source.index, index),
    digest,
    status,
    nextAction,
    stateKey: asCleanString(source.stateKey, source.providerStateKey) || null,
    settingsRevision: asCleanString(source.settingsRevision, source.revision) || null,
    providerJobId: asCleanString(source.providerJobId, source.jobId) || null,
    exportedAt: asCleanString(source.exportedAt, source.createdAt) || null,
    counters: {
      issueTotal: asNonNegativeInteger(counters.issueTotal ?? source.issueTotal, 0),
      blockingIssueTotal: asNonNegativeInteger(counters.blockingIssueTotal ?? source.blockingIssueTotal, 0),
      warningIssueTotal: asNonNegativeInteger(counters.warningIssueTotal ?? source.warningIssueTotal, 0),
      previewRows: asNonNegativeInteger(counters.previewRows ?? source.previewRows, 0),
      acceptedRows: asNonNegativeInteger(counters.acceptedRows ?? source.acceptedRows, 0),
      pendingRows: asNonNegativeInteger(counters.pendingRows ?? source.pendingRows, 0),
    },
    blockedReasons,
  };
}

function normalizeAnalyticsHistory(input = {}, persistedState = {}) {
  const direct = Array.isArray(input.analyticsHistory)
    ? input.analyticsHistory
    : Array.isArray(input.exportHistory)
      ? input.exportHistory
      : Array.isArray(input.analyticsExport?.historySnapshots)
        ? input.analyticsExport.historySnapshots
        : [];
  const persisted = Array.isArray(persistedState.analyticsHistory)
    ? persistedState.analyticsHistory
    : Array.isArray(persistedState.exportHistory)
      ? persistedState.exportHistory
      : [];
  const entries = [...persisted, ...direct]
    .map((entry, index) => normalizeAnalyticsHistoryEntry(entry, index))
    .filter((entry) => entry.digest || entry.status !== "unknown");
  const seen = new Set();

  return entries
    .filter((entry) => {
      const key = entry.digest || `${entry.stateKey}:${entry.index}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(-12)
    .map((entry, index) => ({ ...entry, index }));
}

function analyticsTimelineEvent(index, phase, status, detail = {}) {
  const action = asCleanString(detail.action, detail.nextAction) || "operator.review";
  const code = asCleanString(detail.code, phase);
  const message = asCleanString(detail.message, "");

  return {
    index,
    phase,
    status,
    code,
    action,
    message,
    restartSafe: detail.restartSafe !== false,
    digest: stableContractDigest({
      index,
      phase,
      status,
      code,
      action,
      message,
    }),
  };
}

function buildProviderAnalyticsExport(
  input,
  contract,
  jobId,
  lifecycleState,
  previewAcceptance,
  clientRuntimeHandoff,
  runtimePersistence,
  operationalHealth,
  blockingIssues,
) {
  const history = normalizeAnalyticsHistory(input, input.persistedProviderRuntimeState);
  const warnings = contract.issues.filter((issue) => issue.severity === "warning");
  const blockedReasons = [
    ...blockingIssues.map((issue) => issue.code),
    ...clientRuntimeHandoff.requestState.missingFields.map((field) => `missing_client_state:${field}`),
    ...(runtimePersistence.recovery || []).map((entry) => entry.code),
    ...(operationalHealth.failureState.actionableIssueCodes || []),
  ].filter(Boolean);
  const uniqueBlockedReasons = [...new Set(blockedReasons)].sort();
  const status = blockingIssues.length
    ? "blocked"
    : clientRuntimeHandoff.requestState.missingFields.length
      ? "needs_client_state"
      : operationalHealth.failureState.terminal
        ? "provider_repair_required"
        : operationalHealth.degraded
          ? "degraded"
          : lifecycleState.nextAction === "sync.commit"
            ? "commit_ready"
            : "preview_ready";
  const counters = {
    issueTotal: contract.issues.length,
    blockingIssueTotal: blockingIssues.length,
    warningIssueTotal: warnings.length,
    lifecycleCommandTotal: lifecycleState.commandQueue.length,
    readyLifecycleCommandTotal: lifecycleState.commandQueue.filter((command) => command.status === "ready").length,
    missingClientStateTotal: clientRuntimeHandoff.requestState.missingFields.length,
    runtimeRecoveryActionTotal: runtimePersistence.recovery.length,
    lifecycleTransitionBlockerTotal: lifecycleState.transitionPlan.blockers.length,
    negotiatedCapabilityTotal: contract.capabilityNegotiation.negotiatedCapabilities.length,
    missingRequiredCapabilityTotal: contract.capabilityNegotiation.missingRequiredCapabilities.length,
    retryableIssueTotal: operationalHealth.retryPlan.retryableIssueCodes.length,
    actionableErrorTotal: operationalHealth.failureState.actionableErrors.length,
    historySnapshotTotal: history.length,
  };
  const exportDigest = stableContractDigest({
    provider: contract.provider.slug,
    audienceId: contract.audience.audienceId || null,
    settingsRevision: contract.lifecycle.settingsRevision,
    lifecycleStatus: lifecycleState.nextAction,
    status,
    counters,
    blockedReasons: uniqueBlockedReasons,
    runtimePersistence: {
      stateKey: runtimePersistence.stateKey,
      checksum: runtimePersistence.checksum,
      sequence: runtimePersistence.sequence,
    },
  });
  const currentSnapshot = {
    version: "mailchimp.provider-analytics-history-entry.v1",
    index: history.length,
    digest: exportDigest,
    status,
    nextAction: uniqueBlockedReasons.length
      ? operationalHealth.clientStatus.nextAction || lifecycleState.nextAction
      : lifecycleState.nextAction,
    stateKey: runtimePersistence.stateKey,
    settingsRevision: contract.lifecycle.settingsRevision,
    providerJobId: jobId,
    exportedAt: null,
    counters: {
      issueTotal: counters.issueTotal,
      blockingIssueTotal: counters.blockingIssueTotal,
      warningIssueTotal: counters.warningIssueTotal,
      previewRows: previewAcceptance.previewWindow.maxRows,
      acceptedRows: 0,
      pendingRows: previewAcceptance.acceptanceGate.required ? previewAcceptance.previewWindow.maxRows : 0,
    },
    blockedReasons: uniqueBlockedReasons,
  };
  const historySnapshots = [...history, currentSnapshot].slice(-12).map((entry, index) => ({ ...entry, index }));
  const timeline = [
    analyticsTimelineEvent(0, "settings-validation", lifecycleState.settingsValidation.status, {
      action: lifecycleState.settingsValidation.status === "ready" ? "sync.preview" : "settings.fix",
      message: lifecycleState.settingsValidation.status === "ready"
        ? "Mailchimp provider settings are export-ready."
        : "Mailchimp provider settings must be repaired before export.",
      restartSafe: true,
    }),
    analyticsTimelineEvent(1, "runtime-persistence", runtimePersistence.status, {
      action: runtimePersistence.persistCommand.status === "already_persisted"
        ? "reuse-provider-runtime-state"
        : "persist-provider-runtime-state",
      message: "Provider runtime state contributes restart-safe analytics history.",
      restartSafe: runtimePersistence.restartSafe,
    }),
    analyticsTimelineEvent(2, "lifecycle-transition", lifecycleState.transitionPlan.status, {
      action: lifecycleState.transitionPlan.handoff.nextAction,
      message: lifecycleState.transitionPlan.allowed
        ? "Requested lifecycle command is ready for deterministic handoff."
        : "Requested lifecycle command has blocking gates before handoff.",
      restartSafe: lifecycleState.transitionPlan.resume.restartSafe,
    }),
    analyticsTimelineEvent(3, "operational-health", operationalHealth.status, {
      action: operationalHealth.clientStatus.nextAction,
      message: operationalHealth.degraded
        ? "Provider health is degraded; analytics export carries retry and repair state."
        : "Provider health allows normal preview or commit reporting.",
      restartSafe: operationalHealth.failureState.terminal !== true,
    }),
    analyticsTimelineEvent(4, "client-runtime", clientRuntimeHandoff.status, {
      action: clientRuntimeHandoff.workflowHandoff.nextClientAction,
      message: clientRuntimeHandoff.requestState.missingFields.length
        ? "Client runtime state is missing required fields for handoff reporting."
        : "Client runtime handoff is export-ready.",
      restartSafe: true,
    }),
  ];

  return {
    kind: "aios.provider.analytics_export",
    version: "mailchimp.provider-analytics-export.v1",
    provider: contract.provider.slug,
    product: contract.provider.product,
    providerJobId: jobId,
    audienceId: contract.audience.audienceId || null,
    status,
    exportDigest,
    exportSummary: {
      status,
      nextAction: currentSnapshot.nextAction,
      commitMode: contract.policy.allowExternalWrites ? "adapter-mediated" : "dry-run",
      settingsRevision: contract.lifecycle.settingsRevision,
      stateKey: runtimePersistence.stateKey,
      sequence: runtimePersistence.sequence,
      checksum: runtimePersistence.checksum,
      restartSafe: runtimePersistence.restartSafe && timeline.every((event) => event.restartSafe),
      blockedReasons: uniqueBlockedReasons,
    },
    counters,
    historySnapshots,
    timeline,
    report: {
      title: "Mailchimp provider runtime analytics",
      providerReady: blockingIssues.length === 0,
      previewEnabled: lifecycleState.controls.previewAllowed,
      commitEnabled: lifecycleState.controls.commitAllowed,
      healthStatus: operationalHealth.status,
      degraded: operationalHealth.degraded,
      retryAfterSeconds: operationalHealth.retryPlan.retryAfterSeconds,
      missingClientState: clientRuntimeHandoff.requestState.missingFields,
      capabilityNegotiation: {
        status: contract.capabilityNegotiation.status,
        requiredCapabilities: contract.capabilityNegotiation.requiredCapabilities,
        negotiatedCapabilities: contract.capabilityNegotiation.negotiatedCapabilities,
        missingRequiredCapabilities: contract.capabilityNegotiation.missingRequiredCapabilities,
        nextAction: contract.capabilityNegotiation.externalHandoff.nextAction,
      },
      actionableErrors: operationalHealth.failureState.actionableErrors,
      lifecycleCommands: lifecycleState.commandQueue.map((command) => ({
        command: command.command,
        status: command.status,
        requested: command.requested,
      })),
      lifecycleTransition: {
        requestedCommand: lifecycleState.transitionPlan.requestedCommand,
        status: lifecycleState.transitionPlan.status,
        blockers: lifecycleState.transitionPlan.blockers,
      },
    },
  };
}

function buildOperationalHealth(contract, lifecycleState, blockingIssues) {
  const health = contract.healthObservation;
  const warnings = contract.issues.filter((issue) => issue.severity === "warning");
  const healthIssues = contract.issues.filter((issue) => issue.code?.startsWith("health."));
  const healthBlocking = blockingIssues.filter((issue) => issue.code?.startsWith("health."));
  const providerUnavailable = ["rate_limited", "unavailable"].includes(health.observedStatus)
    || (health.httpStatus && HEALTH_HTTP_RETRYABLE.includes(health.httpStatus));
  const terminalProviderFailure = healthBlocking.length > 0
    || health.observedStatus === "auth_failed"
    || (health.httpStatus && HEALTH_HTTP_TERMINAL.includes(health.httpStatus) && health.httpStatus !== 404);
  const retryableIssueCodes = [
    ...warnings
      .filter((issue) => issue.code?.startsWith("health."))
      .map((issue) => issue.code),
    ...(providerUnavailable && health.lastErrorCode ? [`provider_error:${health.lastErrorCode}`] : []),
  ];
  const nextRetryDelaySeconds = terminalProviderFailure
    ? 0
    : health.retryAfterSeconds > 0
      ? health.retryAfterSeconds
      : providerUnavailable || health.consecutiveFailures > 0
        ? Math.min(900, 2 ** Math.min(health.consecutiveFailures, 8))
        : 0;
  const degradedReasons = [
    ...blockingIssues.map((issue) => ({
      code: issue.code,
      severity: "error",
      action: issue.code?.startsWith("health.")
        ? "repair-provider-health"
        : "fix-provider-settings",
      message: issue.message,
    })),
    ...warnings.map((issue) => ({
      code: issue.code,
      severity: "warning",
      action: issue.code === "policy.external_write_requested"
        ? "confirm-adapter-commit-boundary"
        : "review-provider-settings",
      message: issue.message,
    })),
  ];
  const status = blockingIssues.length
    ? "failed-validation"
    : terminalProviderFailure
      ? "failed-provider-health"
      : health.circuitState === "open"
        ? "degraded-circuit-open"
        : providerUnavailable
          ? "degraded-provider"
          : lifecycleState.controls.commitAllowed
            ? "healthy"
            : warnings.length
              ? "degraded"
              : "preview-only";
  const degradedMode = {
    enabled: health.degradedModeAllowed
      && terminalProviderFailure !== true
      && (providerUnavailable || health.circuitState === "open" || warnings.length > 0),
    mode: providerUnavailable || health.circuitState === "open"
      ? "local-preview-and-status-only"
      : lifecycleState.controls.commitAllowed
        ? "adapter-commit-available"
        : "preview-only",
    externalCommitSuppressed: terminalProviderFailure
      || providerUnavailable
      || health.circuitState === "open"
      || lifecycleState.controls.commitAllowed !== true,
    reasonCodes: healthIssues.map((issue) => issue.code).sort(),
  };
  const actionableErrors = [
    ...healthBlocking.map((issue) => ({
      code: issue.code,
      path: issue.path,
      action: issue.code === "health.auth_failed"
        ? "refresh-mailchimp-secret"
        : "repair-provider-health",
      message: issue.message,
    })),
    ...(health.lastErrorCode && terminalProviderFailure
      ? [{
          code: `provider_error:${health.lastErrorCode}`,
          path: "operationalHealth.lastErrorCode",
          action: "inspect-provider-error",
          message: health.lastErrorMessage || "Mailchimp provider reported a terminal health error.",
        }]
      : []),
  ];

  return {
    kind: "aios.provider.operational_health",
    status,
    observation: health,
    degraded: status !== "healthy",
    degradedMode,
    retryPlan: {
      mode: terminalProviderFailure
        ? "do-not-retry-until-provider-repair"
        : blockingIssues.length
          ? "do-not-retry-until-settings-change"
          : providerUnavailable || health.circuitState === "open"
            ? "retry-after-health-backoff"
            : "bounded-adapter-retry",
      limit: contract.policy.retryLimit,
      backoff: terminalProviderFailure || blockingIssues.length ? "none" : "exponential-with-jitter",
      retryAfterSeconds: nextRetryDelaySeconds,
      nextRetryDelaySeconds,
      retryableIssueCodes,
    },
    failureState: {
      terminal: terminalProviderFailure || blockingIssues.length > 0,
      providerUnavailable,
      circuitOpen: health.circuitState === "open",
      statusOnFailure: terminalProviderFailure
        ? "provider_health_repair_required"
        : blockingIssues.length
          ? "settings_fix_required"
          : providerUnavailable
            ? "degraded_retry_scheduled"
            : "needs_operator_review",
      actionableIssueCodes: degradedReasons.map((reason) => reason.code),
      actionableErrors,
    },
    degradedReasons,
    clientStatus: {
      visibleState: terminalProviderFailure
        ? "provider-needs-repair"
        : degradedMode.enabled
          ? "provider-degraded-preview-available"
          : status === "healthy"
            ? "provider-ready"
            : "provider-preview-only",
      nextAction: terminalProviderFailure
        ? "repair-provider-health"
        : degradedMode.enabled
          ? "show-local-preview-and-retry-status"
          : lifecycleState.nextAction,
      retryAfterSeconds: nextRetryDelaySeconds || null,
    },
  };
}

export function normalizeMailchimpProviderContract(input = {}) {
  const provider = normalizeProvider(input);
  const audience = normalizeAudience(input);
  const auth = normalizeAuth(input);
  const policy = normalizePolicy(input);
  const lifecycle = normalizeLifecycle(input);
  const runtimeBoundary = normalizeRuntimeBoundary(input);
  const healthObservation = normalizeHealthObservation(input);
  const endpoints = { ...DEFAULT_MAILCHIMP_ENDPOINTS, ...(input.endpoints ?? {}) };
  const capabilityNegotiation = buildCapabilityNegotiation(input, endpoints, policy, lifecycle);
  const capabilities = capabilityNegotiation.negotiatedCapabilities;
  const contract = {
    kind: "aios.provider.contract",
    provider,
    audience,
    auth,
    policy,
    lifecycle,
    runtimeBoundary,
    healthObservation,
    endpoints,
    capabilities,
    capabilityNegotiation,
  };

  const runtimeBoundaryContract = buildRuntimeBoundaryContract(contract);

  return {
    ...contract,
    runtimeBoundaryContract,
    issues: collectContractIssues(contract),
    digest: stableContractDigest(contract),
  };
}

export function compileMailchimpProviderJob(input = {}) {
  const contract = normalizeMailchimpProviderContract(input);
  const blockingIssues = contract.issues.filter((issue) => issue.severity === "error");
  const jobId = `mailchimp:${contract.audience.audienceId || "unbound"}:${contract.digest.slice(-8)}`;
  const commitMode = contract.policy.allowExternalWrites ? "adapter-mediated" : "dry-run";
  const lifecycleState = buildLifecycleState(contract, blockingIssues);
  const previewAcceptance = buildPreviewAcceptanceContract(contract, lifecycleState, blockingIssues);
  const operationalHealth = buildOperationalHealth(contract, lifecycleState, blockingIssues);
  const runtimeBoundary = contract.runtimeBoundaryContract;
  const capabilityNegotiation = contract.capabilityNegotiation;
  const clientPreviewSurface = buildClientPreviewSurface(contract, lifecycleState, previewAcceptance, operationalHealth);
  const previewApproval = buildPreviewApprovalContract(contract, lifecycleState, previewAcceptance, operationalHealth, blockingIssues);
  const clientRuntimeHandoff = buildClientRuntimeHandoffContract(input, contract, lifecycleState, previewAcceptance, operationalHealth);
  const runtimePersistence = buildProviderRuntimePersistence(
    contract,
    jobId,
    lifecycleState,
    previewAcceptance,
    previewApproval,
    clientRuntimeHandoff,
    input.persistedProviderRuntimeState,
  );
  const analyticsExport = buildProviderAnalyticsExport(
    input,
    contract,
    jobId,
    lifecycleState,
    previewAcceptance,
    clientRuntimeHandoff,
    runtimePersistence,
    operationalHealth,
    blockingIssues,
  );

  return {
    kind: "aios.kernel.job_descriptor",
    jobId,
    provider: contract.provider.slug,
    product: contract.provider.product,
    status: blockingIssues.length ? "blocked" : "ready",
    commitMode,
    lifecycleState,
    previewAcceptance,
    previewApproval,
    runtimeBoundary,
    capabilityNegotiation,
    clientPreviewSurface,
    clientRuntimeHandoff,
    runtimePersistence,
    operationalHealth,
    analyticsExport,
    capabilities: contract.capabilities,
    verifierContracts: [
      {
        name: "mailchimp.provider.contract",
        digest: contract.digest,
        required: true,
        errors: blockingIssues.map((issue) => issue.code),
      },
      {
        name: "mailchimp.no_plaintext_secret",
        required: true,
        secretRef: contract.auth.secretRef,
      },
      {
        name: "mailchimp.capability_negotiation",
        required: true,
        digest: capabilityNegotiation.digest,
        status: capabilityNegotiation.status,
        missingRequiredCapabilities: capabilityNegotiation.missingRequiredCapabilities,
      },
      {
        name: "mailchimp.runtime_boundary.authorization",
        required: true,
        digest: runtimeBoundary.authorization.decisionDigest,
        status: runtimeBoundary.authorization.status,
        deniedReasons: runtimeBoundary.authorization.deniedReasons,
        auditSink: runtimeBoundary.authorization.auditChain.sink,
      },
    ],
    memory: {
      localKeys: [
        `mailchimp/${contract.audience.audienceId || "unbound"}/contract.json`,
        `mailchimp/${contract.audience.audienceId || "unbound"}/truth-boundary.json`,
      ],
      externalWrites: [],
    },
    adapterHandoff: {
      provider: "mailchimp",
      baseUrl: contract.provider.baseUrl,
      endpoints: contract.endpoints,
      auth: contract.auth,
      audience: contract.audience,
      policy: contract.policy,
      lifecycle: lifecycleState,
      lifecycleTransition: lifecycleState.transitionPlan,
      settingsValidation: lifecycleState.settingsValidation,
      schedulingControls: lifecycleState.schedulingControls,
      previewAcceptance,
      previewApproval,
      runtimeBoundary,
      runtimeBoundaryAuthorization: runtimeBoundary.authorization,
      capabilityNegotiation,
      clientPreviewSurface,
      clientRuntimeHandoff,
      runtimePersistence,
      operationalHealth,
      analyticsExport,
      commitMode,
    },
    recovery: {
      statusOnAdapterFailure: operationalHealth.failureState.statusOnFailure,
      retryLimit: contract.policy.retryLimit,
      retryPlan: operationalHealth.retryPlan,
      capabilityNegotiation,
      runtimeBoundaryAuthorization: runtimeBoundary.authorization,
      runtimePersistence,
      analyticsExport: analyticsExport.exportSummary,
      previewApproval: {
        approvalId: previewApproval.approvalId,
        status: previewApproval.status,
        nextAction: previewApproval.handoff.nextAction,
        reportId: previewApproval.handoff.reportId,
        checkpointKey: previewApproval.clientResumeCheckpoint?.checkpointKey ?? null,
        checkpointStatus: previewApproval.clientResumeCheckpoint?.status ?? null,
        resumeCommandId: previewApproval.clientResumeCheckpoint?.commands?.resume?.id ?? null,
      },
      lifecycleTransition: lifecycleState.transitionPlan,
      rollback: "local-artifacts-only",
      idempotencyKeyFields: contract.policy.idempotencyKeyFields,
    },
    truthBoundary: buildMailchimpTruthBoundaryReport(contract),
    issues: contract.issues,
  };
}

export function planMailchimpProviderLifecycle(input = {}) {
  const contract = normalizeMailchimpProviderContract(input);
  const blockingIssues = contract.issues.filter((issue) => issue.severity === "error");
  const lifecycleState = buildLifecycleState(contract, blockingIssues);
  const previewAcceptance = buildPreviewAcceptanceContract(contract, lifecycleState, blockingIssues);
  const operationalHealth = buildOperationalHealth(contract, lifecycleState, blockingIssues);
  const runtimeBoundary = contract.runtimeBoundaryContract;
  const capabilityNegotiation = contract.capabilityNegotiation;
  const clientPreviewSurface = buildClientPreviewSurface(contract, lifecycleState, previewAcceptance, operationalHealth);
  const previewApproval = buildPreviewApprovalContract(contract, lifecycleState, previewAcceptance, operationalHealth, blockingIssues);
  const clientRuntimeHandoff = buildClientRuntimeHandoffContract(input, contract, lifecycleState, previewAcceptance, operationalHealth);
  const runtimePersistence = buildProviderRuntimePersistence(
    contract,
    `mailchimp:${contract.audience.audienceId || "unbound"}:${contract.digest.slice(-8)}`,
    lifecycleState,
    previewAcceptance,
    previewApproval,
    clientRuntimeHandoff,
    input.persistedProviderRuntimeState,
  );
  const analyticsExport = buildProviderAnalyticsExport(
    input,
    contract,
    `mailchimp:${contract.audience.audienceId || "unbound"}:${contract.digest.slice(-8)}`,
    lifecycleState,
    previewAcceptance,
    clientRuntimeHandoff,
    runtimePersistence,
    operationalHealth,
    blockingIssues,
  );
  const commands = lifecycleState.commandQueue;

  return {
    kind: "aios.provider.lifecycle_plan",
    provider: contract.provider.slug,
    audienceId: contract.audience.audienceId || null,
    digest: stableContractDigest({
      contractDigest: contract.digest,
      lifecycleState,
      commands,
    }),
    lifecycleState,
    schedulingControls: lifecycleState.schedulingControls,
    lifecycleTransition: lifecycleState.transitionPlan,
    enablementControls: {
      enabled: lifecycleState.enabled,
      enableAllowed: lifecycleState.controls.enableAllowed,
      disableAllowed: lifecycleState.controls.disableAllowed,
      nextAction: lifecycleState.nextAction,
    },
    commands,
    settingsValidation: lifecycleState.settingsValidation,
    previewAcceptance,
    previewApproval,
    runtimeBoundary,
    capabilityNegotiation,
    clientPreviewSurface,
    clientRuntimeHandoff,
    runtimePersistence,
    operationalHealth,
    analyticsExport,
  };
}

export function recoverMailchimpProviderRuntimeState(providerJob = {}, persistedState = {}) {
  const contract = normalizeMailchimpProviderContract(providerJob.contract ?? providerJob);
  const blockingIssues = contract.issues.filter((issue) => issue.severity === "error");
  const lifecycleState = providerJob.lifecycleState && typeof providerJob.lifecycleState === "object"
    ? providerJob.lifecycleState
    : buildLifecycleState(contract, blockingIssues);
  const previewAcceptance = providerJob.previewAcceptance && typeof providerJob.previewAcceptance === "object"
    ? providerJob.previewAcceptance
    : buildPreviewAcceptanceContract(contract, lifecycleState, blockingIssues);
  const operationalHealth = providerJob.operationalHealth && typeof providerJob.operationalHealth === "object"
    ? providerJob.operationalHealth
    : buildOperationalHealth(contract, lifecycleState, blockingIssues);
  const previewApproval = providerJob.previewApproval && typeof providerJob.previewApproval === "object"
    ? providerJob.previewApproval
    : buildPreviewApprovalContract(contract, lifecycleState, previewAcceptance, operationalHealth, blockingIssues);
  const clientRuntimeHandoff = providerJob.clientRuntimeHandoff && typeof providerJob.clientRuntimeHandoff === "object"
    ? providerJob.clientRuntimeHandoff
    : buildClientRuntimeHandoffContract(providerJob, contract, lifecycleState, previewAcceptance, operationalHealth);
  const jobId = asCleanString(
    providerJob.jobId,
    `mailchimp:${contract.audience.audienceId || "unbound"}:${contract.digest.slice(-8)}`,
  );
  const persistence = buildProviderRuntimePersistence(
    contract,
    jobId,
    lifecycleState,
    previewAcceptance,
    previewApproval,
    clientRuntimeHandoff,
    persistedState,
  );
  const persisted = normalizePersistedProviderRuntimeState(persistedState);
  const resumeReady = persistence.resumeCommand.status === "ready_to_resume";

  return {
    recoveryVersion: "aios.provider.runtime-recovery.mailchimp.v1",
    provider: "mailchimp",
    providerJobId: jobId,
    stateKey: persistence.stateKey,
    status: persistence.alreadyPersisted
      ? "recovered"
      : resumeReady
        ? "resume_ready"
        : "needs_repair",
    restartSafe: true,
    sequence: persisted.sequence,
    checksum: persisted.checksum || persistence.checksum,
    clientRuntimeHandoff,
    resumeCommand: persistence.resumeCommand,
    persistCommand: persistence.persistCommand,
    recovery: persistence.recovery,
    runtimeBoundary: persistence.runtimeBoundary,
    truthBoundary: {
      source: "persisted-provider-runtime-state",
      externalWrites: false,
    },
  };
}

export function buildMailchimpTruthBoundaryReport(contractInput = {}) {
  const contract = contractInput.kind === "aios.provider.contract"
    ? contractInput
    : normalizeMailchimpProviderContract(contractInput);

  return {
    kind: "aios.truth_boundary.report",
    provider: "mailchimp",
    digest: stableContractDigest({
      provider: contract.provider,
      audience: contract.audience,
      policy: contract.policy,
      endpoints: contract.endpoints,
    }),
    trustedInputs: [
      { name: "audienceId", source: "operator", present: Boolean(contract.audience.audienceId) },
      { name: "secretRef", source: "secret-manager-reference", present: Boolean(contract.auth.secretRef) },
    ],
    untrustedInputs: [
      { name: "memberPayload", source: "runtime-call", verifier: "mailchimp.member.payload" },
      { name: "providerResponse", source: "adapter", verifier: "mailchimp.response.shape" },
    ],
    sideEffectBoundary: contract.policy.allowExternalWrites ? "external-write-requested" : "local-dry-run",
    plaintextSecretAllowed: false,
  };
}
