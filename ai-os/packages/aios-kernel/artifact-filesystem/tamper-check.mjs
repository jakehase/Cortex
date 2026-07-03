export const surfaceId = "aios_artifact-filesystem_tamper-check_037";
export const surfaceGroup = "artifact-filesystem";
export const surfaceName = "tamper-check";

const DEFAULT_RETENTION_LIMIT = 25;
const DEFAULT_SCHEDULE_INTERVAL_MINUTES = 60;
const MIN_SCHEDULE_INTERVAL_MINUTES = 5;
const MAX_SCHEDULE_INTERVAL_MINUTES = 1440;
const DEFAULT_RETRY_BACKOFF_MINUTES = 5;
const MAX_RETRY_BACKOFF_MINUTES = 120;
const VALID_SEVERITIES = new Set(["info", "warning", "critical"]);
const VALID_STATUSES = new Set(["clean", "suspect", "tampered", "quarantined"]);
const VALID_ENFORCEMENT_MODES = new Set(["observe", "enforce", "quarantine"]);
const VALID_HEALTH_SOURCES = new Set(["scheduler", "provider", "state", "evidence", "settings", "kernel"]);
const VALID_HEALTH_PROBE_STATES = new Set(["passed", "warning", "failed", "timeout", "skipped"]);
const VALID_CLIENT_ENTRYPOINTS = new Set(["preview", "report", "timeline", "handoff", "acceptance", "settings"]);
const VALID_HANDOFF_TARGETS = new Set(["artifact-review", "proof-export", "provider-setup", "baseline-run", "settings"]);
const VALID_EXPORT_FORMATS = new Set(["json", "csv", "ndjson", "proof-bundle"]);
const VALID_PROOF_ALGORITHMS = new Set(["sha256", "sha384", "sha512", "blake3", "unknown"]);
const VALID_HANDOFF_ACK_STATES = new Set(["accepted", "queued", "delivered", "failed", "rejected"]);
const VALID_WORKSPACE_SCOPE_MODES = new Set(["strict", "permissive", "read-only"]);
const VALID_TENANT_PERMISSIONS = new Set([
  "artifact:read",
  "tamper-check:run",
  "tamper-check:review",
  "tamper-check:quarantine",
  "proof:export",
  "provider:handoff",
  "settings:write"
]);
const ROLE_PERMISSION_GRANTS = {
  owner: Array.from(VALID_TENANT_PERMISSIONS),
  admin: Array.from(VALID_TENANT_PERMISSIONS),
  operator: ["artifact:read", "tamper-check:run", "tamper-check:review", "tamper-check:quarantine", "proof:export"],
  auditor: ["artifact:read", "tamper-check:review", "proof:export"],
  reviewer: ["artifact:read", "tamper-check:review"],
  viewer: ["artifact:read"]
};
const VALID_PROVIDER_CAPABILITIES = new Set([
  "artifact-digest-read",
  "artifact-quarantine-write",
  "integrity-proof-export",
  "tamper-alert-forward",
  "baseline-sync"
]);
const VALID_PROVIDER_DELIVERY_MODES = new Set(["poll", "push", "webhook", "managed"]);
const VALID_PROVIDER_AUTH_MODES = new Set(["none", "kernel-managed", "signed-request", "oauth-client"]);
const VALID_LIFECYCLE_COMMANDS = new Set([
  "enable",
  "disable",
  "run-now",
  "pause-schedule",
  "resume-schedule",
  "quarantine-flagged",
  "acknowledge-findings"
]);
const VALID_RECOVERY_STATES = new Set(["fresh", "loaded", "recovered", "stale", "corrupt"]);
const VALID_COMMAND_RECEIPT_STATES = new Set(["accepted", "applying", "applied", "failed", "expired"]);
const LIFECYCLE_COMMAND_PERMISSIONS = {
  enable: ["settings:write"],
  disable: ["settings:write"],
  "run-now": ["tamper-check:run"],
  "pause-schedule": ["settings:write"],
  "resume-schedule": ["settings:write"],
  "quarantine-flagged": ["tamper-check:quarantine"],
  "acknowledge-findings": ["tamper-check:review"]
};
const LIFECYCLE_COMMAND_LABELS = {
  enable: "Enable tamper-check",
  disable: "Disable tamper-check",
  "run-now": "Run tamper-check now",
  "pause-schedule": "Pause schedule",
  "resume-schedule": "Resume schedule",
  "quarantine-flagged": "Quarantine flagged artifacts",
  "acknowledge-findings": "Acknowledge findings"
};

function asIsoTimestamp(value, fallback) {
  if (value instanceof Date && Number.isFinite(value.valueOf())) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.valueOf())) {
      return parsed.toISOString();
    }
  }
  return fallback;
}

function clampRetentionLimit(value) {
  if (!Number.isFinite(value)) {
    return DEFAULT_RETENTION_LIMIT;
  }
  return Math.max(1, Math.min(100, Math.trunc(value)));
}

function normalizeBoolean(value, fallback) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (lowered === "true" || lowered === "enabled" || lowered === "on") {
      return true;
    }
    if (lowered === "false" || lowered === "disabled" || lowered === "off") {
      return false;
    }
  }
  return fallback;
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => typeof entry === "string" ? entry.trim() : "")
    .filter(Boolean);
}

function normalizeScopeIdentifier(value, fallback) {
  if (typeof value !== "string" && typeof value !== "number") {
    return fallback;
  }
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, 128) : fallback;
}

function normalizeTenantPermissions(value) {
  return Array.from(new Set(normalizeStringList(value)
    .map((permission) => permission.toLowerCase())
    .filter((permission) => VALID_TENANT_PERMISSIONS.has(permission))));
}

function normalizeArtifactPathPrefix(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  const normalized = value.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
  if (normalized === "/" || normalized === "*") {
    return "/";
  }
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function normalizeArtifactPath(value) {
  const normalized = typeof value === "string" && value.trim()
    ? value.trim().replace(/\\/g, "/").replace(/\/+/g, "/")
    : "/";
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function pathMatchesPrefix(path, prefix) {
  if (prefix === "/") {
    return true;
  }
  const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return path === prefix || path.startsWith(normalizedPrefix);
}

function normalizeWorkspaceScopePolicy(input, tenantBoundary, generatedAt) {
  const scopeSource = input.scope && typeof input.scope === "object" ? input.scope : {};
  const workspaceSource = input.workspace && typeof input.workspace === "object" ? input.workspace : {};
  const policySource = scopeSource.workspacePolicy && typeof scopeSource.workspacePolicy === "object"
    ? scopeSource.workspacePolicy
    : workspaceSource.policy && typeof workspaceSource.policy === "object"
      ? workspaceSource.policy
      : input.workspacePolicy && typeof input.workspacePolicy === "object"
        ? input.workspacePolicy
        : {};
  const rawMode = typeof policySource.mode === "string" ? policySource.mode.trim().toLowerCase() : "strict";
  const mode = VALID_WORKSPACE_SCOPE_MODES.has(rawMode) ? rawMode : "strict";
  const allowedPrefixes = Array.from(new Set(normalizeStringList(
    policySource.allowedArtifactPrefixes || policySource.allowedPaths || policySource.pathPrefixes || input.allowedArtifactPrefixes
  ).map(normalizeArtifactPathPrefix).filter(Boolean)));
  const deniedPrefixes = Array.from(new Set(normalizeStringList(
    policySource.deniedArtifactPrefixes || policySource.deniedPaths || policySource.blockedPaths || input.deniedArtifactPrefixes
  ).map(normalizeArtifactPathPrefix).filter(Boolean)));
  const allowUnlistedPaths = normalizeBoolean(
    policySource.allowUnlistedPaths,
    mode !== "strict" || allowedPrefixes.length === 0
  );

  return {
    schema: "aios.tamper-check.workspace-scope-policy.v1",
    generatedAt,
    tenantId: tenantBoundary.tenantId,
    workspaceId: tenantBoundary.workspaceId,
    mode,
    allowedPrefixes,
    deniedPrefixes,
    allowUnlistedPaths,
    explicitPathScope: allowedPrefixes.length > 0 || deniedPrefixes.length > 0,
    enforcementState: mode === "permissive"
      ? "observe"
      : mode === "read-only"
        ? "read-only"
        : "enforce",
    policyHash: stableProofHash({
      tenantId: tenantBoundary.tenantId,
      workspaceId: tenantBoundary.workspaceId,
      mode,
      allowedPrefixes,
      deniedPrefixes,
      allowUnlistedPaths
    })
  };
}

function evaluateWorkspacePathBoundary(path, workspaceScopePolicy) {
  const normalizedPath = normalizeArtifactPath(path);
  const deniedByPrefix = workspaceScopePolicy.deniedPrefixes.find((prefix) => pathMatchesPrefix(normalizedPath, prefix)) || null;
  const allowedByPrefix = workspaceScopePolicy.allowedPrefixes.find((prefix) => pathMatchesPrefix(normalizedPath, prefix)) || null;
  const listed = Boolean(allowedByPrefix);
  const denied = Boolean(deniedByPrefix);
  const unlisted = workspaceScopePolicy.allowedPrefixes.length > 0 && !listed;
  const enforced = workspaceScopePolicy.mode === "strict";
  const violations = [
    denied ? "workspace-path-denied" : null,
    enforced && unlisted && !workspaceScopePolicy.allowUnlistedPaths ? "workspace-path-not-allowed" : null
  ].filter(Boolean);

  return {
    path: normalizedPath,
    listed,
    allowedByPrefix,
    deniedByPrefix,
    observedOnly: workspaceScopePolicy.mode === "permissive",
    violations,
    state: violations.length > 0 ? "blocked" : unlisted ? "unlisted" : "allowed"
  };
}

function permissionsForRoles(roles) {
  const granted = new Set();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSION_GRANTS[role] || []) {
      granted.add(permission);
    }
  }
  return Array.from(granted);
}

function normalizeTenantBoundary(input, generatedAt) {
  const scopeSource = input.scope && typeof input.scope === "object" ? input.scope : {};
  const tenantSource = input.tenant && typeof input.tenant === "object" ? input.tenant : {};
  const workspaceSource = input.workspace && typeof input.workspace === "object" ? input.workspace : {};
  const requestSource = input.request && typeof input.request === "object" ? input.request : {};
  const clientSource = input.clientRuntime && typeof input.clientRuntime === "object"
    ? input.clientRuntime
    : input.client && typeof input.client === "object"
      ? input.client
      : {};
  const actorSource = input.actor && typeof input.actor === "object" ? input.actor : {};
  const tenantId = normalizeScopeIdentifier(
    scopeSource.tenantId ?? tenantSource.tenantId ?? tenantSource.id ?? requestSource.tenantId ?? input.tenantId,
    "hosted-kernel-tenant"
  );
  const workspaceId = normalizeScopeIdentifier(
    scopeSource.workspaceId ?? workspaceSource.workspaceId ?? workspaceSource.id ?? requestSource.workspaceId ?? input.workspaceId,
    "default-workspace"
  );
  const actorId = normalizeScopeIdentifier(
    actorSource.actorId ?? actorSource.id ?? clientSource.actorId ?? clientSource.actor ?? requestSource.actor ?? input.actorId,
    "hosted-kernel"
  );
  const rawRoles = normalizeStringList(
    actorSource.roles || scopeSource.roles || requestSource.roles || clientSource.roles || input.roles
  ).map((role) => role.toLowerCase()).filter((role) => ROLE_PERMISSION_GRANTS[role]);
  const roles = rawRoles.length > 0 ? Array.from(new Set(rawRoles)) : ["operator"];
  const explicitPermissions = normalizeTenantPermissions(
    actorSource.permissions || scopeSource.permissions || requestSource.permissions || clientSource.permissions || input.permissions
  );
  const grantedPermissions = Array.from(new Set([...permissionsForRoles(roles), ...explicitPermissions]));
  const requiredPermissions = ["artifact:read", "tamper-check:review"];
  const missingPermissions = requiredPermissions.filter((permission) => !grantedPermissions.includes(permission));
  const implicitDefaults = [
    tenantId === "hosted-kernel-tenant" ? "tenantId" : null,
    workspaceId === "default-workspace" ? "workspaceId" : null
  ].filter(Boolean);

  return {
    schema: "aios.tamper-check.tenant-boundary.v1",
    generatedAt,
    tenantId,
    workspaceId,
    actor: {
      actorId,
      roles,
      grantedPermissions,
      missingPermissions
    },
    requiredPermissions,
    implicitDefaults,
    scoped: implicitDefaults.length === 0,
    canReadArtifacts: missingPermissions.length === 0,
    canQuarantine: grantedPermissions.includes("tamper-check:quarantine"),
    canExportProofs: grantedPermissions.includes("proof:export"),
    canHandoffProvider: grantedPermissions.includes("provider:handoff"),
    isolationKey: `${tenantId}:${workspaceId}`,
    boundaryHash: stableProofHash({ tenantId, workspaceId, actorId, grantedPermissions, generatedAt: generatedAt.slice(0, 10) })
  };
}

function normalizeDigestAlgorithm(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return "unknown";
  }
  const normalized = value.trim().toLowerCase().replace(/_/g, "-");
  return VALID_PROOF_ALGORITHMS.has(normalized) ? normalized : "unknown";
}

function stableProofHash(value) {
  const serialized = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function normalizeEvidenceLabels(value) {
  const labels = normalizeStringList(value)
    .map((label) => label.toLowerCase())
    .filter((label) => /^[a-z0-9][a-z0-9:._-]{0,63}$/.test(label));
  return Array.from(new Set(labels)).slice(0, 12);
}

function normalizeProviderHandoffAcknowledgements(input, generatedAt) {
  const handoffSource = input.externalHandoff && typeof input.externalHandoff === "object"
    ? input.externalHandoff
    : input.providerHandoff && typeof input.providerHandoff === "object"
      ? input.providerHandoff
      : input.handoff && typeof input.handoff === "object"
        ? input.handoff
        : {};
  const acknowledgementSource = Array.isArray(handoffSource.acknowledgements)
    ? handoffSource.acknowledgements
    : Array.isArray(handoffSource.acks)
      ? handoffSource.acks
      : Array.isArray(input.providerAcknowledgements)
        ? input.providerAcknowledgements
        : [];

  return acknowledgementSource.slice(-50).map((acknowledgement, index) => {
    const source = acknowledgement && typeof acknowledgement === "object" ? acknowledgement : {};
    const rawState = typeof source.state === "string" ? source.state.trim().toLowerCase() : "";
    const state = VALID_HANDOFF_ACK_STATES.has(rawState) ? rawState : "queued";
    const providerId = typeof source.providerId === "string" && source.providerId.trim()
      ? source.providerId.trim()
      : typeof source.provider === "string" && source.provider.trim()
        ? source.provider.trim()
        : `unknown-provider-${index + 1}`;
    const rawProofIds = source.proofIds || source.proofs || source.proofId;
    const proofIds = normalizeStringList(rawProofIds ? [].concat(rawProofIds) : []);
    const cursor = typeof source.cursor === "string" && source.cursor.trim()
      ? source.cursor.trim()
      : typeof source.syncCursor === "string" && source.syncCursor.trim()
        ? source.syncCursor.trim()
        : null;

    return {
      acknowledgementId: typeof source.acknowledgementId === "string" && source.acknowledgementId.trim()
        ? source.acknowledgementId.trim()
        : typeof source.id === "string" && source.id.trim()
          ? source.id.trim()
          : `${providerId}:handoff-ack:${index + 1}`,
      providerId,
      state,
      receivedAt: asIsoTimestamp(source.receivedAt || source.timestamp || source.acknowledgedAt, generatedAt),
      cursor,
      correlationId: typeof source.correlationId === "string" && source.correlationId.trim() ? source.correlationId.trim() : null,
      proofIds,
      message: typeof source.message === "string" && source.message.trim() ? source.message.trim().slice(0, 240) : null,
      retryable: normalizeBoolean(source.retryable ?? source.retriable, state === "failed" || state === "queued")
    };
  });
}

function normalizeProviderEndpointContract(source, providerId) {
  const endpointSource = source.endpoint && typeof source.endpoint === "object"
    ? source.endpoint
    : source.connection && typeof source.connection === "object"
      ? source.connection
      : {};
  const rawDeliveryMode = endpointSource.deliveryMode || source.deliveryMode || source.mode;
  const deliveryMode = typeof rawDeliveryMode === "string" && VALID_PROVIDER_DELIVERY_MODES.has(rawDeliveryMode.trim().toLowerCase())
    ? rawDeliveryMode.trim().toLowerCase()
    : "managed";
  const rawAuthMode = endpointSource.authMode || source.authMode;
  const authMode = typeof rawAuthMode === "string" && VALID_PROVIDER_AUTH_MODES.has(rawAuthMode.trim().toLowerCase())
    ? rawAuthMode.trim().toLowerCase()
    : deliveryMode === "managed" ? "kernel-managed" : "signed-request";
  const url = typeof endpointSource.url === "string" && endpointSource.url.trim()
    ? endpointSource.url.trim()
    : typeof source.url === "string" && source.url.trim()
      ? source.url.trim()
      : null;
  const rawMethod = endpointSource.method || source.method;
  const method = typeof rawMethod === "string" && ["POST", "PUT", "PATCH"].includes(rawMethod.trim().toUpperCase())
    ? rawMethod.trim().toUpperCase()
    : deliveryMode === "poll" ? "GET" : "POST";
  const maxBatchSize = Number.isFinite(Number(endpointSource.maxBatchSize ?? source.maxBatchSize))
    ? Math.max(1, Math.min(250, Math.trunc(Number(endpointSource.maxBatchSize ?? source.maxBatchSize))))
    : 50;
  const route = typeof endpointSource.route === "string" && endpointSource.route.startsWith("/")
    ? endpointSource.route
    : `/kernel/${surfaceGroup}/${surfaceName}/providers/${encodeURIComponent(providerId)}/handoff`;

  return {
    schema: "aios.tamper-check.provider-endpoint-contract.v1",
    deliveryMode,
    authMode,
    method,
    url,
    route,
    maxBatchSize,
    requiresSignedEnvelope: authMode === "signed-request" || authMode === "oauth-client",
    managedByKernel: deliveryMode === "managed" || authMode === "kernel-managed"
  };
}

function buildProviderSyncLease({ providerId, source, settings, generatedAt, flaggedProofs, boundaryHeldProofs, missingCapabilities, latestAcknowledgement, syncCursor, outboundCursor, requestedDestination, endpoint }) {
  const leaseSource = source.syncLease && typeof source.syncLease === "object"
    ? source.syncLease
    : source.lease && typeof source.lease === "object"
      ? source.lease
      : {};
  const leaseTtlMinutes = Number.isFinite(Number(leaseSource.ttlMinutes ?? source.leaseTtlMinutes))
    ? Math.max(1, Math.min(240, Math.trunc(Number(leaseSource.ttlMinutes ?? source.leaseTtlMinutes))))
    : 30;
  const leaseExpiresAt = asIsoTimestamp(
    leaseSource.expiresAt || source.leaseExpiresAt,
    new Date(Date.parse(generatedAt) + leaseTtlMinutes * 60 * 1000).toISOString()
  );
  const eligibleFlaggedProofs = flaggedProofs.slice(0, endpoint.maxBatchSize);
  const blockedReasons = [
    !settings.enabled ? "tamper-check-disabled" : null,
    missingCapabilities.length > 0 ? "provider-capability-missing" : null,
    endpoint.deliveryMode !== "managed" && !endpoint.url ? "provider-endpoint-url-missing" : null,
    boundaryHeldProofs.length > 0 ? "workspace-boundary-held-proofs" : null
  ].filter(Boolean);
  const cursorSeed = {
    providerId,
    generatedAt,
    syncCursor,
    outboundCursor,
    proofIds: eligibleFlaggedProofs.map((proof) => proof.proofId),
    latestAcknowledgementId: latestAcknowledgement?.acknowledgementId || null
  };
  const handoffEnvelopeId = stableProofHash({
    providerId,
    destination: requestedDestination || "external-integrity-provider",
    cursorSeed,
    endpoint: {
      deliveryMode: endpoint.deliveryMode,
      authMode: endpoint.authMode,
      route: endpoint.route,
      url: endpoint.url
    }
  });

  return {
    schema: "aios.tamper-check.provider-sync-lease.v1",
    leaseId: `tamper-sync:${providerId}:${generatedAt}`,
    providerId,
    state: blockedReasons.length > 0
      ? "blocked"
      : eligibleFlaggedProofs.length > 0
        ? "handoff-ready"
        : settings.enabled
          ? "baseline-ready"
          : "disabled",
    generatedAt,
    expiresAt: leaseExpiresAt,
    ttlMinutes: leaseTtlMinutes,
    blockedReasons,
    checkpoint: {
      inboundCursor: syncCursor,
      outboundCursor: latestAcknowledgement?.cursor || outboundCursor || syncCursor,
      latestAcknowledgementId: latestAcknowledgement?.acknowledgementId || null,
      latestAcknowledgementState: latestAcknowledgement?.state || null,
      nextCursor: stableProofHash(cursorSeed)
    },
    handoffEnvelope: {
      envelopeId: handoffEnvelopeId,
      destination: requestedDestination || "external-integrity-provider",
      contentType: "application/vnd.aios.tamper-check.proof-handoff+json",
      proofIds: eligibleFlaggedProofs.map((proof) => proof.proofId),
      proofCount: eligibleFlaggedProofs.length,
      boundaryHeldProofIds: boundaryHeldProofs.map((proof) => proof.proofId),
      requiresAcknowledgement: eligibleFlaggedProofs.length > 0,
      signed: endpoint.requiresSignedEnvelope,
      deliveryMode: endpoint.deliveryMode,
      route: endpoint.route
    }
  };
}

function normalizeProviderContracts(input, settings, counters, evidence, generatedAt) {
  const acknowledgements = normalizeProviderHandoffAcknowledgements(input, generatedAt);
  const providerSource = Array.isArray(input.providers)
    ? input.providers
    : Array.isArray(input.serviceContracts)
      ? input.serviceContracts
      : Array.isArray(input.integrationProviders)
        ? input.integrationProviders
        : [];
  const handoffSource = input.externalHandoff && typeof input.externalHandoff === "object"
    ? input.externalHandoff
    : input.providerHandoff && typeof input.providerHandoff === "object"
      ? input.providerHandoff
      : input.handoff && typeof input.handoff === "object"
        ? input.handoff
        : {};
  const requestedDestination = typeof handoffSource.destination === "string" && handoffSource.destination.trim()
    ? handoffSource.destination.trim()
    : null;
  const outboundCursor = typeof handoffSource.syncCursor === "string" && handoffSource.syncCursor.trim()
    ? handoffSource.syncCursor.trim()
    : typeof handoffSource.cursor === "string" && handoffSource.cursor.trim()
      ? handoffSource.cursor.trim()
      : null;
  const requestedCapabilitiesFromHandoff = normalizeStringList(handoffSource.requiredCapabilities || handoffSource.capabilities);
  const requestedCapabilities = normalizeStringList(input.requestedCapabilities || input.capabilities);
  const requiredCapabilities = new Set([
    "artifact-digest-read",
    "integrity-proof-export",
    counters.tampered > 0 || counters.quarantined > 0 ? "tamper-alert-forward" : null,
    settings.enforcementMode === "quarantine" ? "artifact-quarantine-write" : null,
    settings.enabled ? "baseline-sync" : null
  ].filter(Boolean));
  for (const capability of requestedCapabilities) {
    if (VALID_PROVIDER_CAPABILITIES.has(capability)) {
      requiredCapabilities.add(capability);
    }
  }
  for (const capability of requestedCapabilitiesFromHandoff) {
    if (VALID_PROVIDER_CAPABILITIES.has(capability)) {
      requiredCapabilities.add(capability);
    }
  }

  const defaultProvider = {
    providerId: "hosted-kernel-artifact-store",
    service: "artifact-filesystem",
    capabilities: Array.from(VALID_PROVIDER_CAPABILITIES),
    syncCursor: null,
    lastSyncedAt: null
  };
  const boundaryHeldProofs = evidence
    .filter((record) => record.boundary.state === "blocked")
    .map((record) => ({
      artifactId: record.artifactId,
      proofId: record.proofId,
      status: record.status,
      severity: record.severity,
      violations: record.boundary.violations
    }));
  const flaggedProofs = evidence
    .filter((record) => record.status !== "clean" && record.boundary.state !== "blocked")
    .map((record) => ({
      artifactId: record.artifactId,
      proofId: record.proofId,
      status: record.status,
      severity: record.severity
    }));
  const providers = (providerSource.length > 0 ? providerSource : [defaultProvider]).map((provider, index) => {
    const source = provider && typeof provider === "object" ? provider : {};
    const providerId = typeof source.providerId === "string" && source.providerId.trim()
      ? source.providerId.trim()
      : typeof source.id === "string" && source.id.trim()
        ? source.id.trim()
        : `tamper-provider-${index + 1}`;
    const capabilities = normalizeStringList(source.capabilities).filter((capability) => VALID_PROVIDER_CAPABILITIES.has(capability));
    const missingCapabilities = Array.from(requiredCapabilities).filter((capability) => !capabilities.includes(capability));
    const lastSyncedAt = asIsoTimestamp(source.lastSyncedAt || source.syncedAt, null);
    const syncCursor = typeof source.syncCursor === "string"
      ? source.syncCursor
      : typeof source.cursor === "string"
        ? source.cursor
        : null;
    const endpoint = normalizeProviderEndpointContract(source, providerId);
    const providerAcknowledgements = acknowledgements.filter((acknowledgement) => acknowledgement.providerId === providerId);
    const latestAcknowledgement = providerAcknowledgements
      .slice()
      .sort((left, right) => left.receivedAt.localeCompare(right.receivedAt))
      .at(-1) || null;
    const syncLease = buildProviderSyncLease({
      providerId,
      source,
      settings,
      generatedAt,
      flaggedProofs,
      boundaryHeldProofs,
      missingCapabilities,
      latestAcknowledgement,
      syncCursor,
      outboundCursor,
      requestedDestination,
      endpoint
    });
    const externalWriteState = !settings.enabled
      ? "disabled"
      : missingCapabilities.length > 0
        ? "blocked"
        : latestAcknowledgement?.state === "failed" || latestAcknowledgement?.state === "rejected"
          ? "failed"
          : latestAcknowledgement?.state === "delivered" || latestAcknowledgement?.state === "accepted"
            ? "acknowledged"
            : flaggedProofs.length > 0
              ? "awaiting-provider-ack"
              : "idle";
    const providerProofCoverage = new Set(providerAcknowledgements.flatMap((acknowledgement) => acknowledgement.proofIds));

    return {
      providerId,
      service: typeof source.service === "string" && source.service.trim() ? source.service.trim() : "artifact-filesystem",
      contractVersion: typeof source.contractVersion === "string" ? source.contractVersion : "aios.provider.tamper-check.v1",
      capabilities,
      missingCapabilities,
      negotiated: missingCapabilities.length === 0,
      serviceContract: {
        schema: "aios.tamper-check.provider-service-contract.v1",
        providerId,
        service: typeof source.service === "string" && source.service.trim() ? source.service.trim() : "artifact-filesystem",
        contractVersion: typeof source.contractVersion === "string" ? source.contractVersion : "aios.provider.tamper-check.v1",
        endpoint,
        requiredCapabilities: Array.from(requiredCapabilities),
        optionalCapabilities: Array.from(VALID_PROVIDER_CAPABILITIES).filter((capability) => !requiredCapabilities.has(capability)),
        state: missingCapabilities.length > 0
          ? "capability-mismatch"
          : syncLease.state === "blocked"
            ? "sync-blocked"
            : "negotiated",
        contractHash: stableProofHash({
          providerId,
          capabilities,
          requiredCapabilities: Array.from(requiredCapabilities),
          endpoint,
          generatedAt: generatedAt.slice(0, 10)
        })
      },
      sync: {
        state: settings.enabled ? lastSyncedAt || syncCursor ? "ready" : "needs-baseline" : "disabled",
        lastSyncedAt,
        syncCursor,
        nextSyncAt: settings.enabled && settings.schedule.nextRunAt ? settings.schedule.nextRunAt : null,
        lease: syncLease,
        cursorContract: {
          current: syncLease.checkpoint.inboundCursor,
          writeback: syncLease.checkpoint.outboundCursor,
          next: syncLease.checkpoint.nextCursor,
          acknowledgementState: syncLease.checkpoint.latestAcknowledgementState
        }
      },
      externalHandoff: {
        destination: requestedDestination || "external-integrity-provider",
        state: externalWriteState,
        latestAcknowledgementId: latestAcknowledgement?.acknowledgementId || null,
        latestAcknowledgementState: latestAcknowledgement?.state || null,
        latestAcknowledgementAt: latestAcknowledgement?.receivedAt || null,
        acknowledgedProofIds: Array.from(providerProofCoverage),
        missingAcknowledgementProofIds: flaggedProofs
          .map((proof) => proof.proofId)
          .filter((proofId) => !providerProofCoverage.has(proofId)),
        writebackCursor: latestAcknowledgement?.cursor || outboundCursor || syncCursor,
        retryable: latestAcknowledgement ? latestAcknowledgement.retryable : flaggedProofs.length > 0,
        envelope: syncLease.handoffEnvelope
      }
    };
  });
  const negotiatedProviders = providers.filter((provider) => provider.negotiated);
  const handoffState = !settings.enabled
    ? "disabled"
    : providers.length === 0 || negotiatedProviders.length === 0
      ? "blocked"
      : providers.some((provider) => provider.externalHandoff.state === "failed")
        ? "external-writeback-failed"
        : flaggedProofs.length > 0 && providers.every((provider) => provider.externalHandoff.missingAcknowledgementProofIds.length === 0)
          ? "externally-acknowledged"
          : flaggedProofs.length > 0
            ? "pending-external-review"
            : "ready";
  const handoffCorrelation = {
    requestedDestination,
    outboundCursor,
    acknowledgementCount: acknowledgements.length,
    failedAcknowledgementIds: acknowledgements
      .filter((acknowledgement) => acknowledgement.state === "failed" || acknowledgement.state === "rejected")
      .map((acknowledgement) => acknowledgement.acknowledgementId),
    deliveredProofIds: Array.from(new Set(acknowledgements
      .filter((acknowledgement) => acknowledgement.state === "delivered" || acknowledgement.state === "accepted")
      .flatMap((acknowledgement) => acknowledgement.proofIds)))
  };

  return {
    requiredCapabilities: Array.from(requiredCapabilities),
    providers,
    negotiatedProviderIds: negotiatedProviders.map((provider) => provider.providerId),
    acknowledgements,
    handoff: {
      state: handoffState,
      generatedAt,
      destination: negotiatedProviders.length > 0 ? requestedDestination || "external-integrity-provider" : null,
      proofBundleId: `${surfaceName}:${generatedAt}`,
      flaggedProofs,
      boundaryHeldProofs,
      canExportProofBundle: negotiatedProviders.some((provider) => provider.capabilities.includes("integrity-proof-export")),
      canForwardAlert: flaggedProofs.length > 0 && negotiatedProviders.some((provider) => provider.capabilities.includes("tamper-alert-forward")),
      writebackState: handoffState === "externally-acknowledged"
        ? "acknowledged"
        : handoffState === "external-writeback-failed"
          ? "failed"
          : flaggedProofs.length > 0
            ? "pending"
            : "not-required",
      correlation: handoffCorrelation
    }
  };
}

function normalizeLifecycleCommand(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  const command = value.trim().toLowerCase();
  return VALID_LIFECYCLE_COMMANDS.has(command) ? command : "invalid";
}

function buildLifecycleCommandRequest(input, generatedAt, tenantBoundary) {
  const source = input.lifecycle && typeof input.lifecycle === "object" ? input.lifecycle : {};
  const settingsSource = input.settings && typeof input.settings === "object" ? input.settings : {};
  const rawCommand = input.lifecycleCommand || input.command || source.command || source.lifecycleCommand || settingsSource.lifecycleCommand;
  const command = normalizeLifecycleCommand(
    rawCommand
  );
  const actor = normalizeScopeIdentifier(
    source.actorId || input.actorId || tenantBoundary.actor.actorId,
    tenantBoundary.actor.actorId
  );
  const reason = typeof source.reason === "string" && source.reason.trim()
    ? source.reason.trim().slice(0, 240)
    : typeof input.commandReason === "string" && input.commandReason.trim()
      ? input.commandReason.trim().slice(0, 240)
      : null;
  const requestedAt = asIsoTimestamp(source.requestedAt || input.commandRequestedAt, generatedAt);
  const requiredPermissions = command && command !== "invalid" ? LIFECYCLE_COMMAND_PERMISSIONS[command] || [] : [];
  const missingPermissions = requiredPermissions.filter((permission) => !tenantBoundary.actor.grantedPermissions.includes(permission));

  return {
    schema: "aios.tamper-check.lifecycle-command-request.v1",
    command: command === "invalid" ? null : command,
    rawCommand: command === "invalid" ? rawCommand : null,
    valid: command !== "invalid",
    actor,
    requestedAt,
    reason,
    requiredPermissions,
    missingPermissions,
    canApply: Boolean(command && command !== "invalid" && missingPermissions.length === 0),
    auditSubject: `${tenantBoundary.tenantId}:${tenantBoundary.workspaceId}:${actor}`
  };
}

function normalizeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function ratioForCount(count, total, fallback = 0) {
  return total > 0 ? count / total : fallback;
}

function getPersistedStateSource(input) {
  const source = input.persistedState && typeof input.persistedState === "object"
    ? input.persistedState
    : input.state && typeof input.state === "object"
      ? input.state
      : input.checkpoint && typeof input.checkpoint === "object"
        ? input.checkpoint
        : null;
  return source;
}

function buildCommandFingerprint(command, input, generatedAt) {
  if (!command || command === "invalid") {
    return null;
  }
  const requestSource = input.request && typeof input.request === "object" ? input.request : {};
  const commandId = typeof input.commandId === "string" && input.commandId.trim()
    ? input.commandId.trim()
    : typeof requestSource.commandId === "string" && requestSource.commandId.trim()
      ? requestSource.commandId.trim()
      : typeof requestSource.id === "string" && requestSource.id.trim()
        ? requestSource.id.trim()
        : null;
  const actor = typeof input.actor === "string" && input.actor.trim()
    ? input.actor.trim()
    : typeof requestSource.actor === "string" && requestSource.actor.trim()
      ? requestSource.actor.trim()
      : "hosted-kernel";
  return commandId
    ? `${command}:${commandId}`
    : `${command}:${actor}:${generatedAt.slice(0, 16)}`;
}

function normalizeCommandJournalEntries(value, generatedAt) {
  const journal = Array.isArray(value) ? value : [];
  return journal.slice(-50).map((entry, index) => {
    const source = entry && typeof entry === "object" ? entry : {};
    const command = normalizeLifecycleCommand(source.command);
    const appliedAt = asIsoTimestamp(source.appliedAt || source.timestamp || source.commandAppliedAt, generatedAt);
    const fingerprint = typeof source.fingerprint === "string" && source.fingerprint.trim()
      ? source.fingerprint.trim()
      : command && command !== "invalid"
        ? `${command}:${typeof source.commandId === "string" && source.commandId.trim() ? source.commandId.trim() : appliedAt}`
        : `unknown:${index + 1}`;
    return {
      fingerprint,
      command: command && command !== "invalid" ? command : "unknown",
      appliedAt,
      actor: typeof source.actor === "string" && source.actor.trim() ? source.actor.trim() : "hosted-kernel",
      resultStatus: typeof source.resultStatus === "string" && source.resultStatus.trim() ? source.resultStatus.trim() : null
    };
  });
}

function normalizePersistedCommandReceipts(value, generatedAt) {
  const receipts = Array.isArray(value) ? value : [];
  const generatedTime = Date.parse(generatedAt);
  return receipts.slice(-50).map((entry, index) => {
    const source = entry && typeof entry === "object" ? entry : {};
    const command = normalizeLifecycleCommand(source.command);
    const acceptedAt = asIsoTimestamp(source.acceptedAt || source.requestedAt || source.timestamp, generatedAt);
    const expiresAt = asIsoTimestamp(source.expiresAt || source.deadlineAt, null);
    const rawState = typeof source.state === "string" ? source.state.trim().toLowerCase() : "";
    const state = VALID_COMMAND_RECEIPT_STATES.has(rawState) ? rawState : "accepted";
    const fingerprint = typeof source.fingerprint === "string" && source.fingerprint.trim()
      ? source.fingerprint.trim()
      : command && command !== "invalid"
        ? `${command}:${typeof source.commandId === "string" && source.commandId.trim() ? source.commandId.trim() : acceptedAt}`
        : `unknown-receipt:${index + 1}`;
    const expired = Boolean(expiresAt && Date.parse(expiresAt) <= generatedTime);

    return {
      receiptId: typeof source.receiptId === "string" && source.receiptId.trim()
        ? source.receiptId.trim()
        : `tamper-command-receipt-${index + 1}`,
      fingerprint,
      command: command && command !== "invalid" ? command : "unknown",
      state: expired && (state === "accepted" || state === "applying") ? "expired" : state,
      acceptedAt,
      expiresAt,
      actor: typeof source.actor === "string" && source.actor.trim() ? source.actor.trim() : "hosted-kernel",
      resumeToken: typeof source.resumeToken === "string" && source.resumeToken.trim() ? source.resumeToken.trim() : null,
      lastAttemptAt: asIsoTimestamp(source.lastAttemptAt || source.appliedAt, null),
      attemptCount: Math.max(0, Math.trunc(normalizeNumber(source.attemptCount ?? source.attempts, 0))),
      resultStatus: typeof source.resultStatus === "string" && source.resultStatus.trim() ? source.resultStatus.trim() : null,
      restartAction: expired
        ? "drop-expired-receipt"
        : state === "accepted" || state === "applying"
          ? "resume-idempotently"
          : state === "failed"
            ? "surface-retry"
            : "retain-for-replay-detection"
    };
  });
}

function normalizePersistedEvidenceCursor(source) {
  const checkpoint = source.checkpoint && typeof source.checkpoint === "object" ? source.checkpoint : {};
  const schedule = source.schedule && typeof source.schedule === "object" ? source.schedule : checkpoint.schedule && typeof checkpoint.schedule === "object" ? checkpoint.schedule : {};
  const counters = source.counters && typeof source.counters === "object" ? source.counters : checkpoint.counters && typeof checkpoint.counters === "object" ? checkpoint.counters : {};
  const flaggedProofIds = normalizeStringList(source.latestFlaggedProofIds || checkpoint.latestFlaggedProofIds);
  const deliveredProofIds = normalizeStringList(source.providerDeliveredProofIds || checkpoint.providerDeliveredProofIds);
  const failedAcknowledgementIds = normalizeStringList(source.providerFailedAcknowledgementIds || checkpoint.providerFailedAcknowledgementIds);
  const checkpointStatus = typeof checkpoint.status === "string" && checkpoint.status.trim()
    ? checkpoint.status.trim()
    : typeof source.status === "string" && source.status.trim()
      ? source.status.trim()
      : null;

  return {
    schema: "aios.tamper-check.persisted-evidence-cursor.v1",
    checkpointStatus,
    readinessState: typeof checkpoint.readinessState === "string" && checkpoint.readinessState.trim() ? checkpoint.readinessState.trim() : null,
    acceptanceDecision: typeof checkpoint.acceptanceDecision === "string" && checkpoint.acceptanceDecision.trim() ? checkpoint.acceptanceDecision.trim() : null,
    lastRunAt: asIsoTimestamp(schedule.lastRunAt, null),
    nextRunAt: asIsoTimestamp(schedule.nextRunAt, null),
    counterTotal: normalizeNumber(counters.total, 0),
    digestMismatches: normalizeNumber(counters.digestMismatches, 0),
    latestFlaggedProofIds: flaggedProofIds,
    providerDeliveredProofIds: deliveredProofIds,
    providerFailedAcknowledgementIds: failedAcknowledgementIds,
    unresolvedFlaggedProofIds: flaggedProofIds.filter((proofId) => !deliveredProofIds.includes(proofId)),
    cursorHash: stableProofHash({
      checkpointStatus,
      counterTotal: normalizeNumber(counters.total, 0),
      digestMismatches: normalizeNumber(counters.digestMismatches, 0),
      latestFlaggedProofIds: flaggedProofIds,
      providerDeliveredProofIds: deliveredProofIds,
      providerFailedAcknowledgementIds: failedAcknowledgementIds
    })
  };
}

function normalizePersistedState(input, generatedAt) {
  const source = getPersistedStateSource(input);
  const recoveryProblems = [];
  if (!source) {
    return {
      schema: "aios.tamper-check.persisted-state.v1",
      stateId: `tamper-check-state:${surfaceId}`,
      loaded: false,
      recoveryState: "fresh",
      recoveredAt: generatedAt,
      loadedFrom: null,
      lastGeneratedAt: null,
      lastStatus: null,
      lastStableStatus: null,
      schedule: {},
      counters: {},
      evidenceCursor: {
        schema: "aios.tamper-check.persisted-evidence-cursor.v1",
        checkpointStatus: null,
        readinessState: null,
        acceptanceDecision: null,
        lastRunAt: null,
        nextRunAt: null,
        counterTotal: 0,
        digestMismatches: 0,
        latestFlaggedProofIds: [],
        providerDeliveredProofIds: [],
        providerFailedAcknowledgementIds: [],
        unresolvedFlaggedProofIds: [],
        cursorHash: stableProofHash(`${surfaceId}:fresh-evidence-cursor`)
      },
      commandJournal: [],
      commandReceipts: [],
      commandFingerprints: new Set(),
      restartRecoveryPlan: [],
      recoveryProblems
    };
  }

  const checkpointSource = source.checkpoint && typeof source.checkpoint === "object" ? source.checkpoint : {};
  const lastGeneratedAt = asIsoTimestamp(source.generatedAt || source.lastGeneratedAt || source.updatedAt, null);
  const ageMinutes = lastGeneratedAt
    ? Math.max(0, Math.round((Date.parse(generatedAt) - Date.parse(lastGeneratedAt)) / 60000))
    : null;
  if (!lastGeneratedAt) {
    recoveryProblems.push({
      code: "missing-state-timestamp",
      severity: "warning",
      message: "Persisted tamper-check state did not include a recoverable timestamp."
    });
  }

  const persistedSchedule = source.schedule && typeof source.schedule === "object"
    ? source.schedule
    : checkpointSource.schedule && typeof checkpointSource.schedule === "object"
      ? checkpointSource.schedule
      : {};
  const persistedCounters = source.counters && typeof source.counters === "object"
    ? source.counters
    : checkpointSource.counters && typeof checkpointSource.counters === "object"
      ? checkpointSource.counters
      : {};
  const commandJournal = normalizeCommandJournalEntries(source.commandJournal || source.commands, generatedAt);
  const commandReceipts = normalizePersistedCommandReceipts(source.commandReceipts || source.pendingCommands || checkpointSource.commandReceipts, generatedAt);
  const activeCommandReceipts = commandReceipts.filter((receipt) => receipt.restartAction === "resume-idempotently");
  const evidenceCursor = normalizePersistedEvidenceCursor(source);
  const explicitRecoveryState = typeof source.recoveryState === "string" && VALID_RECOVERY_STATES.has(source.recoveryState)
    ? source.recoveryState
    : null;
  if (activeCommandReceipts.length > 0) {
    recoveryProblems.push({
      code: "active-command-receipts-recovered",
      severity: "info",
      message: "Persisted tamper-check state included accepted commands that must be resumed idempotently.",
      receiptIds: activeCommandReceipts.map((receipt) => receipt.receiptId)
    });
  }
  if (evidenceCursor.unresolvedFlaggedProofIds.length > 0) {
    recoveryProblems.push({
      code: "unresolved-flagged-proofs-recovered",
      severity: "warning",
      message: "Persisted tamper-check state still has flagged proofs without provider delivery acknowledgement.",
      proofIds: evidenceCursor.unresolvedFlaggedProofIds
    });
  }
  const recoveryState = explicitRecoveryState || (recoveryProblems.some((problem) => problem.severity === "critical")
    ? "corrupt"
    : recoveryProblems.length > 0
      ? "recovered"
      : ageMinutes !== null && ageMinutes > MAX_SCHEDULE_INTERVAL_MINUTES
        ? "stale"
        : "loaded");
  const restartRecoveryPlan = [
    ...activeCommandReceipts.map((receipt) => ({
      action: "resume-command",
      command: receipt.command,
      fingerprint: receipt.fingerprint,
      receiptId: receipt.receiptId,
      resumeToken: receipt.resumeToken,
      reason: "accepted-command-recovered-before-journal-commit"
    })),
    ...commandReceipts
      .filter((receipt) => receipt.restartAction === "drop-expired-receipt")
      .map((receipt) => ({
        action: "drop-command-receipt",
        command: receipt.command,
        fingerprint: receipt.fingerprint,
        receiptId: receipt.receiptId,
        reason: "command-receipt-expired-before-restart"
      })),
    evidenceCursor.unresolvedFlaggedProofIds.length > 0 ? {
      action: "replay-provider-handoff",
      proofIds: evidenceCursor.unresolvedFlaggedProofIds,
      reason: "flagged-proofs-lack-provider-delivery-acknowledgement"
    } : null
  ].filter(Boolean);

  return {
    schema: "aios.tamper-check.persisted-state.v1",
    stateId: typeof source.stateId === "string" && source.stateId.trim() ? source.stateId.trim() : `tamper-check-state:${surfaceId}`,
    loaded: true,
    recoveryState,
    recoveredAt: generatedAt,
    loadedFrom: typeof source.loadedFrom === "string" && source.loadedFrom.trim() ? source.loadedFrom.trim() : "hosted-kernel-checkpoint",
    lastGeneratedAt,
    ageMinutes,
    lastStatus: typeof source.status === "string" && source.status.trim() ? source.status.trim() : null,
    lastStableStatus: typeof source.lastStableStatus === "string" && source.lastStableStatus.trim()
      ? source.lastStableStatus.trim()
      : typeof source.status === "string" && source.status.trim()
        ? source.status.trim()
        : null,
    schedule: {
      lastRunAt: asIsoTimestamp(persistedSchedule.lastRunAt, null),
      nextRunAt: asIsoTimestamp(persistedSchedule.nextRunAt, null),
      paused: normalizeBoolean(persistedSchedule.paused, false)
    },
    counters: {
      total: normalizeNumber(persistedCounters.total, 0),
      clean: normalizeNumber(persistedCounters.clean, 0),
      suspect: normalizeNumber(persistedCounters.suspect, 0),
      tampered: normalizeNumber(persistedCounters.tampered, 0),
      quarantined: normalizeNumber(persistedCounters.quarantined, 0)
    },
    evidenceCursor,
    commandJournal,
    commandReceipts,
    commandFingerprints: new Set([
      ...commandJournal.map((entry) => entry.fingerprint),
      ...commandReceipts
        .filter((receipt) => receipt.restartAction !== "drop-expired-receipt")
        .map((receipt) => receipt.fingerprint)
    ]),
    restartRecoveryPlan,
    recoveryProblems
  };
}

function normalizeClientRuntimeState(input, generatedAt) {
  const source = input.clientRuntime && typeof input.clientRuntime === "object"
    ? input.clientRuntime
    : input.client && typeof input.client === "object"
      ? input.client
      : {};
  const requestSource = input.request && typeof input.request === "object" ? input.request : {};
  const rawEntrypoint = source.entrypoint || requestSource.entrypoint || input.entrypoint;
  const entrypoint = typeof rawEntrypoint === "string" && VALID_CLIENT_ENTRYPOINTS.has(rawEntrypoint.trim().toLowerCase())
    ? rawEntrypoint.trim().toLowerCase()
    : "preview";
  const rawHandoffTarget = source.handoffTarget || requestSource.handoffTarget || input.handoffTarget;
  const preferredHandoffTarget = typeof rawHandoffTarget === "string" && VALID_HANDOFF_TARGETS.has(rawHandoffTarget.trim().toLowerCase())
    ? rawHandoffTarget.trim().toLowerCase()
    : null;
  const selectedArtifactIds = normalizeStringList(source.selectedArtifactIds || requestSource.selectedArtifactIds || input.selectedArtifactIds);
  const reviewedProofIds = normalizeStringList(source.reviewedProofIds || requestSource.reviewedProofIds || input.reviewedProofIds);
  const sessionId = typeof source.sessionId === "string" && source.sessionId.trim()
    ? source.sessionId.trim()
    : typeof requestSource.sessionId === "string" && requestSource.sessionId.trim()
      ? requestSource.sessionId.trim()
      : `tamper-session:${generatedAt}`;
  const requestId = typeof source.requestId === "string" && source.requestId.trim()
    ? source.requestId.trim()
    : typeof requestSource.id === "string" && requestSource.id.trim()
      ? requestSource.id.trim()
      : `${sessionId}:request`;

  return {
    schema: "aios.tamper-check.client-runtime.v1",
    sessionId,
    requestId,
    generatedAt,
    entrypoint,
    preferredHandoffTarget,
    actor: typeof source.actor === "string" && source.actor.trim() ? source.actor.trim() : "current-user",
    selectedArtifactIds,
    reviewedProofIds,
    focusedProofId: typeof source.focusedProofId === "string" && source.focusedProofId.trim() ? source.focusedProofId.trim() : null,
    navigation: {
      returnTo: typeof source.returnTo === "string" && source.returnTo.startsWith("/") ? source.returnTo : null,
      sourceRoute: typeof requestSource.route === "string" && requestSource.route.startsWith("/") ? requestSource.route : null
    },
    subscriptions: {
      events: normalizeStringList(source.events || source.subscribedEvents).filter((eventName) => eventName.startsWith("tamper-check.")),
      wantsLiveUpdates: normalizeBoolean(source.liveUpdates ?? requestSource.liveUpdates, true)
    }
  };
}

function normalizeSettings(input, generatedAt, persistedState, tenantBoundary) {
  const source = input.settings && typeof input.settings === "object" ? input.settings : {};
  const scheduleSource = source.schedule && typeof source.schedule === "object" ? source.schedule : {};
  const validation = [];
  const lifecycleRequest = buildLifecycleCommandRequest(input, generatedAt, tenantBoundary);
  const requestedCommand = lifecycleRequest.valid ? lifecycleRequest.command : "invalid";
  const commandFingerprint = buildCommandFingerprint(requestedCommand, input, generatedAt);
  const commandReplayed = Boolean(commandFingerprint && persistedState.commandFingerprints.has(commandFingerprint));
  let enabled = normalizeBoolean(source.enabled ?? input.enabled, true);
  let schedulePaused = normalizeBoolean(scheduleSource.paused ?? source.schedulePaused, persistedState.schedule.paused || false);
  let enforcementMode = typeof source.enforcementMode === "string" ? source.enforcementMode.trim().toLowerCase() : "enforce";
  const rawInterval = Number(scheduleSource.intervalMinutes ?? source.intervalMinutes ?? DEFAULT_SCHEDULE_INTERVAL_MINUTES);
  const intervalMinutes = Number.isFinite(rawInterval)
    ? Math.max(MIN_SCHEDULE_INTERVAL_MINUTES, Math.min(MAX_SCHEDULE_INTERVAL_MINUTES, Math.trunc(rawInterval)))
    : DEFAULT_SCHEDULE_INTERVAL_MINUTES;

  if (!VALID_ENFORCEMENT_MODES.has(enforcementMode)) {
    validation.push({
      code: "invalid-enforcement-mode",
      severity: "warning",
      message: "Unsupported enforcement mode; falling back to enforce.",
      received: source.enforcementMode
    });
    enforcementMode = "enforce";
  }
  if (!Number.isFinite(rawInterval) || intervalMinutes !== Math.trunc(rawInterval)) {
    validation.push({
      code: "schedule-interval-normalized",
      severity: "warning",
      message: `Schedule interval must be between ${MIN_SCHEDULE_INTERVAL_MINUTES} and ${MAX_SCHEDULE_INTERVAL_MINUTES} minutes.`,
      received: scheduleSource.intervalMinutes ?? source.intervalMinutes
    });
  }
  if (requestedCommand === "invalid") {
    validation.push({
      code: "invalid-lifecycle-command",
      severity: "critical",
      message: "Lifecycle command is not supported by artifact filesystem tamper-check.",
      received: lifecycleRequest.rawCommand
    });
  }
  if (lifecycleRequest.missingPermissions.length > 0) {
    validation.push({
      code: "lifecycle-command-permission-missing",
      severity: "critical",
      message: "Actor cannot apply the requested tamper-check lifecycle command.",
      command: lifecycleRequest.command,
      missingPermissions: lifecycleRequest.missingPermissions
    });
  }

  if (commandReplayed) {
    validation.push({
      code: "lifecycle-command-replayed",
      severity: "info",
      message: "Lifecycle command fingerprint was already present in persisted tamper-check state.",
      fingerprint: commandFingerprint
    });
  } else if (!lifecycleRequest.canApply) {
    // Validation above records why this command cannot mutate hosted-kernel state.
  } else if (requestedCommand === "enable") {
    enabled = true;
  } else if (requestedCommand === "disable") {
    enabled = false;
  } else if (requestedCommand === "pause-schedule") {
    schedulePaused = true;
  } else if (requestedCommand === "resume-schedule") {
    schedulePaused = false;
  }

  const lastRunAt = asIsoTimestamp(scheduleSource.lastRunAt || source.lastRunAt, persistedState.schedule.lastRunAt || null);
  const suppliedNextRunAt = asIsoTimestamp(scheduleSource.nextRunAt || source.nextRunAt, persistedState.schedule.nextRunAt || null);
  const nextRunAt = enabled && !schedulePaused
    ? suppliedNextRunAt || new Date(Date.parse(generatedAt) + intervalMinutes * 60 * 1000).toISOString()
    : null;
  if (enabled && !schedulePaused && suppliedNextRunAt && Date.parse(suppliedNextRunAt) < Date.parse(generatedAt) - 60000) {
    validation.push({
      code: "schedule-next-run-in-past",
      severity: "warning",
      message: "Supplied nextRunAt is already in the past; hosted-kernel clients should offer run-now before persisting.",
      received: suppliedNextRunAt
    });
  }
  const scheduleDriftMinutes = persistedState.schedule.nextRunAt && nextRunAt
    ? Math.round((Date.parse(nextRunAt) - Date.parse(persistedState.schedule.nextRunAt)) / 60000)
    : null;
  const commandAccepted = Boolean(requestedCommand && requestedCommand !== "invalid" && lifecycleRequest.canApply);
  const mutationApplied = Boolean(commandAccepted && !commandReplayed);

  return {
    enabled,
    enforcementMode: enabled ? enforcementMode : "observe",
    validation,
    lifecycle: {
      request: lifecycleRequest,
      requestedCommand: requestedCommand === "invalid" ? null : requestedCommand,
      commandAccepted,
      commandAppliedAt: mutationApplied ? generatedAt : null,
      commandFingerprint,
      idempotency: {
        replayed: commandReplayed,
        stateMutationApplied: mutationApplied,
        sourceStateId: persistedState.stateId,
        recoveredFromState: persistedState.loaded
      },
      auditEvent: requestedCommand && requestedCommand !== "invalid" ? {
        eventName: "tamper-check.lifecycle-command.evaluated",
        generatedAt,
        command: requestedCommand,
        actor: lifecycleRequest.actor,
        tenantId: tenantBoundary.tenantId,
        workspaceId: tenantBoundary.workspaceId,
        accepted: commandAccepted,
        replayed: commandReplayed,
        missingPermissions: lifecycleRequest.missingPermissions,
        fingerprint: commandFingerprint
      } : null,
      commandContract: Array.from(VALID_LIFECYCLE_COMMANDS).map((command) => ({
        command,
        label: LIFECYCLE_COMMAND_LABELS[command],
        requiredPermissions: LIFECYCLE_COMMAND_PERMISSIONS[command] || []
      }))
    },
    controls: {
      settingsWritable: tenantBoundary.actor.grantedPermissions.includes("settings:write"),
      canRunChecks: tenantBoundary.actor.grantedPermissions.includes("tamper-check:run"),
      canReviewFindings: tenantBoundary.actor.grantedPermissions.includes("tamper-check:review"),
      canQuarantine: tenantBoundary.canQuarantine,
      disabledReason: enabled
        ? null
        : requestedCommand === "disable" && mutationApplied
          ? "disabled-by-lifecycle-command"
          : "disabled-by-settings"
      }
    ,
    schedule: {
      mode: enabled ? schedulePaused ? "paused" : "interval" : "disabled",
      intervalMinutes,
      lastRunAt,
      nextRunAt,
      scheduleDriftMinutes,
      suppliedNextRunAt,
      due: Boolean(nextRunAt && nextRunAt <= generatedAt),
      canRunNow: enabled,
      canPause: enabled && !schedulePaused,
      canResume: enabled && schedulePaused
    }
  };
}

function normalizeEvidenceRecord(record, index, generatedAt, tenantBoundary, workspaceScopePolicy) {
  const source = record && typeof record === "object" ? record : {};
  const artifactId = String(source.artifactId || source.path || source.id || `evidence-${index + 1}`);
  const path = typeof source.path === "string" ? source.path : artifactId;
  const workspacePathBoundary = evaluateWorkspacePathBoundary(path, workspaceScopePolicy);
  const tenantId = normalizeScopeIdentifier(source.tenantId ?? source.tenant ?? source.ownerTenantId, tenantBoundary.tenantId);
  const workspaceId = normalizeScopeIdentifier(source.workspaceId ?? source.workspace ?? source.ownerWorkspaceId, tenantBoundary.workspaceId);
  const boundaryViolations = [
    tenantId !== tenantBoundary.tenantId ? "tenant-mismatch" : null,
    workspaceId !== tenantBoundary.workspaceId ? "workspace-mismatch" : null,
    !tenantBoundary.canReadArtifacts ? "artifact-read-permission-missing" : null,
    ...workspacePathBoundary.violations
  ].filter(Boolean);
  const boundaryState = boundaryViolations.length > 0
    ? "blocked"
    : tenantBoundary.scoped
      ? "scoped"
      : "implicit-default-scope";
  const digest = typeof source.digest === "string" ? source.digest : null;
  const expectedDigest = typeof source.expectedDigest === "string" ? source.expectedDigest : null;
  const derivedStatus = VALID_STATUSES.has(source.status) ? source.status : digest && expectedDigest && digest !== expectedDigest ? "tampered" : "clean";
  const status = boundaryState === "blocked" ? "quarantined" : derivedStatus;
  const severity = VALID_SEVERITIES.has(source.severity)
    ? source.severity
    : boundaryState === "blocked" || status === "tampered" || status === "quarantined"
      ? "critical"
      : status === "suspect"
        ? "warning"
        : "info";
  const reason = typeof source.reason === "string"
    ? source.reason
    : boundaryState === "blocked"
      ? workspacePathBoundary.violations.length > 0
        ? "workspace-path-scope-violation"
        : "tenant-workspace-boundary-violation"
      : status === "clean"
        ? "digest-match"
        : "digest-or-policy-mismatch";

  return {
    artifactId,
    path: workspacePathBoundary.path,
    tenantId,
    workspaceId,
    boundary: {
      state: boundaryState,
      isolationKey: `${tenantId}:${workspaceId}`,
      expectedIsolationKey: tenantBoundary.isolationKey,
      violations: boundaryViolations,
      scopedBy: tenantBoundary.boundaryHash,
      workspacePath: {
        state: workspacePathBoundary.state,
        allowedByPrefix: workspacePathBoundary.allowedByPrefix,
        deniedByPrefix: workspacePathBoundary.deniedByPrefix,
        observedOnly: workspacePathBoundary.observedOnly,
        policyHash: workspaceScopePolicy.policyHash
      }
    },
    status,
    severity,
    digest,
    expectedDigest,
    proofId: typeof source.proofId === "string" ? source.proofId : `${surfaceName}:${artifactId}:${index + 1}`,
    checkedAt: asIsoTimestamp(source.checkedAt || source.timestamp, generatedAt),
    actor: typeof source.actor === "string" ? source.actor : tenantBoundary.actor.actorId,
    reason,
    proofMaterial: {
      schema: "aios.tamper-check.evidence-proof.v1",
      algorithm: normalizeDigestAlgorithm(source.algorithm || source.digestAlgorithm || source.hashAlgorithm),
      source: typeof source.proofSource === "string" && source.proofSource.trim() ? source.proofSource.trim() : "artifact-filesystem",
      baselineId: typeof source.baselineId === "string" && source.baselineId.trim() ? source.baselineId.trim() : null,
      labels: normalizeEvidenceLabels(source.labels || source.tags),
      observedSizeBytes: Number.isFinite(Number(source.sizeBytes ?? source.bytes))
        ? Math.max(0, Math.trunc(Number(source.sizeBytes ?? source.bytes)))
        : null,
      metadataHash: stableProofHash({
        artifactId,
        path: workspacePathBoundary.path,
        tenantId,
        workspaceId,
        digest,
        expectedDigest,
        status,
        boundaryState,
        checkedAt: asIsoTimestamp(source.checkedAt || source.timestamp, generatedAt)
      })
    }
  };
}

function summarizeEvidence(records) {
  const counters = {
    total: records.length,
    clean: 0,
    suspect: 0,
    tampered: 0,
    quarantined: 0,
    info: 0,
    warning: 0,
    critical: 0,
    digestMismatches: 0
  };

  for (const record of records) {
    counters[record.status] += 1;
    counters[record.severity] += 1;
    if (record.digest && record.expectedDigest && record.digest !== record.expectedDigest) {
      counters.digestMismatches += 1;
    }
  }

  return counters;
}

function summarizeTenantBoundary(tenantBoundary, records, generatedAt, workspaceScopePolicy) {
  const blockedRecords = records.filter((record) => record.boundary.state === "blocked");
  const scopedRecords = records.filter((record) => record.boundary.state === "scoped");
  const implicitRecords = records.filter((record) => record.boundary.state === "implicit-default-scope");
  const pathHeldRecords = blockedRecords.filter((record) => record.boundary.violations.some((violation) => violation.startsWith("workspace-path-")));
  const violationCounts = blockedRecords.reduce((counts, record) => {
    for (const violation of record.boundary.violations) {
      counts[violation] = (counts[violation] || 0) + 1;
    }
    return counts;
  }, {});
  const missingPermissionFindings = tenantBoundary.actor.missingPermissions.map((permission) => ({
    code: "tenant-permission-missing",
    severity: "critical",
    permission,
    message: `Actor is missing ${permission} for hosted-kernel tamper-check.`
  }));
  const boundaryFindings = blockedRecords.slice(0, 20).map((record) => ({
    code: "artifact-boundary-blocked",
    severity: "critical",
    artifactId: record.artifactId,
    proofId: record.proofId,
    tenantId: record.tenantId,
    workspaceId: record.workspaceId,
    violations: record.boundary.violations,
    message: "Artifact evidence is outside the active tenant/workspace boundary."
  }));

  return {
    schema: "aios.tamper-check.tenant-boundary-summary.v1",
    generatedAt,
    state: tenantBoundary.actor.missingPermissions.length > 0 || blockedRecords.length > 0
      ? "blocked"
      : tenantBoundary.scoped
        ? "scoped"
        : "implicit-default-scope",
    tenantId: tenantBoundary.tenantId,
    workspaceId: tenantBoundary.workspaceId,
    isolationKey: tenantBoundary.isolationKey,
    boundaryHash: tenantBoundary.boundaryHash,
    scoped: tenantBoundary.scoped,
    canReadArtifacts: tenantBoundary.canReadArtifacts,
    canQuarantine: tenantBoundary.canQuarantine,
    canExportProofs: tenantBoundary.canExportProofs,
    canHandoffProvider: tenantBoundary.canHandoffProvider,
    implicitDefaults: tenantBoundary.implicitDefaults,
    workspaceScopePolicy,
    counts: {
      evidenceRecords: records.length,
      scopedRecords: scopedRecords.length,
      implicitDefaultRecords: implicitRecords.length,
      blockedRecords: blockedRecords.length,
      pathHeldRecords: pathHeldRecords.length,
      violationCounts
    },
    boundaryHold: {
      state: blockedRecords.length > 0 ? "active" : "clear",
      heldProofIds: blockedRecords.map((record) => record.proofId).filter(Boolean),
      heldArtifactIds: blockedRecords.map((record) => record.artifactId),
      providerHandoffSuppressedProofIds: pathHeldRecords.map((record) => record.proofId).filter(Boolean),
      auditEvent: blockedRecords.length > 0 ? {
        eventName: "tamper-check.boundary-hold.applied",
        generatedAt,
        tenantId: tenantBoundary.tenantId,
        workspaceId: tenantBoundary.workspaceId,
        boundaryHash: tenantBoundary.boundaryHash,
        workspacePolicyHash: workspaceScopePolicy.policyHash,
        blockedRecordCount: blockedRecords.length,
        pathHeldRecordCount: pathHeldRecords.length
      } : null
    },
    actor: tenantBoundary.actor,
    findings: [...missingPermissionFindings, ...boundaryFindings]
  };
}

function normalizeHistorySnapshots(inputHistory, generatedAt, limit) {
  const history = Array.isArray(inputHistory) ? inputHistory : [];
  return history.slice(-limit).map((snapshot, index) => {
    const source = snapshot && typeof snapshot === "object" ? snapshot : {};
    const counters = source.counters && typeof source.counters === "object" ? source.counters : {};
    const severity = source.severity && typeof source.severity === "object" ? source.severity : {};
    const capturedAt = asIsoTimestamp(source.capturedAt || source.generatedAt || source.timestamp, generatedAt);
    const total = Math.max(0, Math.trunc(normalizeNumber(counters.total ?? source.total, 0)));
    const clean = Math.max(0, Math.trunc(normalizeNumber(counters.clean ?? source.clean, 0)));
    const tampered = Math.max(0, Math.trunc(normalizeNumber(counters.tampered ?? source.tampered, 0)));
    const suspect = Math.max(0, Math.trunc(normalizeNumber(counters.suspect ?? source.suspect, 0)));
    const quarantined = Math.max(0, Math.trunc(normalizeNumber(counters.quarantined ?? source.quarantined, 0)));
    const digestMismatches = Math.max(0, Math.trunc(normalizeNumber(counters.digestMismatches ?? source.digestMismatches, 0)));
    const flaggedArtifacts = suspect + tampered + quarantined;
    const critical = Math.max(0, Math.trunc(normalizeNumber(counters.critical ?? severity.critical ?? source.critical, 0)));
    const warning = Math.max(0, Math.trunc(normalizeNumber(counters.warning ?? severity.warning ?? source.warning, 0)));
    const info = Math.max(0, Math.trunc(normalizeNumber(counters.info ?? severity.info ?? source.info, 0)));

    return {
      snapshotId: typeof source.snapshotId === "string" ? source.snapshotId : `tamper-history-${index + 1}`,
      capturedAt,
      totalArtifacts: total,
      flaggedArtifacts,
      counters: {
        total,
        clean,
        suspect,
        tampered,
        quarantined,
        digestMismatches,
        info,
        warning,
        critical
      },
      ratios: {
        clean: ratioForCount(clean, total, 1),
        flagged: ratioForCount(flaggedArtifacts, total, 0),
        digestMismatch: ratioForCount(digestMismatches, total, 0),
        critical: ratioForCount(critical, total, 0)
      },
      lineageHash: stableProofHash({
        snapshotId: typeof source.snapshotId === "string" ? source.snapshotId : `tamper-history-${index + 1}`,
        capturedAt,
        total,
        clean,
        suspect,
        tampered,
        quarantined,
        digestMismatches,
        critical
      })
    };
  });
}

function buildTimeline(records, history, generatedAt) {
  const historyEvents = history.map((snapshot) => ({
    at: snapshot.capturedAt,
    kind: "history-snapshot",
    label: snapshot.snapshotId,
    flaggedArtifacts: snapshot.flaggedArtifacts,
    totalArtifacts: snapshot.totalArtifacts
  }));
  const evidenceEvents = records.map((record) => ({
    at: record.checkedAt,
    kind: record.status === "clean" ? "artifact-verified" : "artifact-flagged",
    label: record.artifactId,
    status: record.status,
    severity: record.severity,
    proofId: record.proofId
  }));

  return [...historyEvents, ...evidenceEvents]
    .sort((left, right) => left.at.localeCompare(right.at))
    .concat({
      at: generatedAt,
      kind: "report-generated",
      label: surfaceName
    });
}

function buildExportSummary({ generatedAt, records, counters, history, timeline }) {
  const flagged = records.filter((record) => record.status !== "clean");
  const recordsByStatus = records.reduce((groups, record) => {
    groups[record.status] = (groups[record.status] || 0) + 1;
    return groups;
  }, {});
  const recordsBySeverity = records.reduce((groups, record) => {
    groups[record.severity] = (groups[record.severity] || 0) + 1;
    return groups;
  }, {});
  const proofIds = records.map((record) => record.proofId).filter(Boolean);
  const digestMismatchProofIds = records
    .filter((record) => record.digest && record.expectedDigest && record.digest !== record.expectedDigest)
    .map((record) => record.proofId);
  return {
    format: "aios.tamper-check.report.v1",
    generatedAt,
    rowCount: records.length,
    columns: ["artifactId", "path", "status", "severity", "digest", "expectedDigest", "proofId", "checkedAt", "actor", "reason"],
    counters,
    exportReadiness: {
      state: counters.total === 0 ? "empty" : digestMismatchProofIds.length > 0 || flagged.length > 0 ? "review-required" : "ready",
      proofRowCount: proofIds.length,
      digestMismatchProofIds,
      recordsByStatus,
      recordsBySeverity,
      reportFingerprint: stableProofHash({
        generatedAt,
        counters,
        proofIds,
        digestMismatchProofIds,
        timelineEvents: timeline.length
      })
    },
    latestSnapshot: history.at(-1) || null,
    flaggedArtifacts: flagged.map((record) => ({
      artifactId: record.artifactId,
      status: record.status,
      severity: record.severity,
      proofId: record.proofId,
      checkedAt: record.checkedAt,
      boundaryState: record.boundary.state
    })),
    boundaryHeldArtifacts: flagged
      .filter((record) => record.boundary.state === "blocked")
      .map((record) => ({
        artifactId: record.artifactId,
        proofId: record.proofId,
        violations: record.boundary.violations,
        policyHash: record.boundary.workspacePath.policyHash
      })),
    timelineEventCount: timeline.length
  };
}

function buildAnalyticsReportState({ generatedAt, counters, history, timeline, records, settings }) {
  const flaggedArtifacts = counters.suspect + counters.tampered + counters.quarantined;
  const currentSnapshot = {
    snapshotId: `tamper-history-current:${generatedAt}`,
    capturedAt: generatedAt,
    totalArtifacts: counters.total,
    flaggedArtifacts,
    counters: {
      total: counters.total,
      clean: counters.clean,
      suspect: counters.suspect,
      tampered: counters.tampered,
      quarantined: counters.quarantined,
      digestMismatches: counters.digestMismatches,
      info: counters.info,
      warning: counters.warning,
      critical: counters.critical
    },
    ratios: {
      clean: ratioForCount(counters.clean, counters.total, 1),
      flagged: ratioForCount(flaggedArtifacts, counters.total, 0),
      digestMismatch: ratioForCount(counters.digestMismatches, counters.total, 0),
      critical: ratioForCount(counters.critical, counters.total, 0)
    },
    lineageHash: stableProofHash({
      generatedAt,
      counters,
      flaggedArtifacts
    })
  };
  const snapshots = [...history, currentSnapshot];
  const previousSnapshot = history.at(-1) || null;
  const flaggedDelta = previousSnapshot
    ? currentSnapshot.flaggedArtifacts - previousSnapshot.flaggedArtifacts
    : currentSnapshot.flaggedArtifacts;
  const digestMismatchProofIds = records
    .filter((record) => record.digest && record.expectedDigest && record.digest !== record.expectedDigest)
    .map((record) => record.proofId);
  const severityCounters = {
    info: counters.info,
    warning: counters.warning,
    critical: counters.critical
  };
  const statusCounters = {
    clean: counters.clean,
    suspect: counters.suspect,
    tampered: counters.tampered,
    quarantined: counters.quarantined
  };
  const transitionCounters = previousSnapshot ? {
    totalArtifacts: counters.total - previousSnapshot.counters.total,
    clean: counters.clean - previousSnapshot.counters.clean,
    suspect: counters.suspect - previousSnapshot.counters.suspect,
    tampered: counters.tampered - previousSnapshot.counters.tampered,
    quarantined: counters.quarantined - previousSnapshot.counters.quarantined,
    digestMismatches: counters.digestMismatches - (previousSnapshot.counters.digestMismatches || 0),
    critical: counters.critical - (previousSnapshot.counters.critical || 0)
  } : {
    totalArtifacts: counters.total,
    clean: counters.clean,
    suspect: counters.suspect,
    tampered: counters.tampered,
    quarantined: counters.quarantined,
    digestMismatches: counters.digestMismatches,
    critical: counters.critical
  };
  const timelineSeverityBuckets = timeline.reduce((buckets, event) => {
    if (!event.severity) {
      return buckets;
    }
    buckets[event.severity] = (buckets[event.severity] || 0) + 1;
    return buckets;
  }, {});
  const timelineBuckets = timeline.reduce((buckets, event) => {
    const day = event.at.slice(0, 10);
    const existing = buckets.get(day) || {
      day,
      eventCount: 0,
      flaggedEvents: 0,
      historySnapshots: 0,
      proofEvents: 0,
      criticalEvents: 0,
      warningEvents: 0
    };
    existing.eventCount += 1;
    if (event.kind === "history-snapshot") {
      existing.historySnapshots += 1;
    }
    if (event.kind === "artifact-verified" || event.kind === "artifact-flagged") {
      existing.proofEvents += 1;
    }
    if (event.kind === "artifact-flagged" || event.flaggedArtifacts > 0) {
      existing.flaggedEvents += 1;
    }
    if (event.severity === "critical") {
      existing.criticalEvents += 1;
    }
    if (event.severity === "warning") {
      existing.warningEvents += 1;
    }
    buckets.set(day, existing);
    return buckets;
  }, new Map());

  return {
    schema: "aios.tamper-check.analytics-reporting.v1",
    generatedAt,
    retentionWindow: {
      retainedSnapshots: history.length,
      oldestSnapshotAt: history[0]?.capturedAt || null,
      newestSnapshotAt: currentSnapshot.capturedAt
    },
    currentSnapshot,
    previousSnapshot,
    deltas: {
      totalArtifacts: previousSnapshot ? currentSnapshot.totalArtifacts - previousSnapshot.totalArtifacts : currentSnapshot.totalArtifacts,
      flaggedArtifacts: flaggedDelta,
      cleanArtifacts: previousSnapshot ? counters.clean - previousSnapshot.counters.clean : counters.clean,
      digestMismatches: counters.digestMismatches,
      transitionCounters
    },
    trend: {
      direction: flaggedDelta > 0 ? "worsening" : flaggedDelta < 0 ? "improving" : "stable",
      flaggedDelta,
      flaggedRatio: currentSnapshot.ratios.flagged,
      cleanRatio: currentSnapshot.ratios.clean,
      digestMismatchRatio: currentSnapshot.ratios.digestMismatch,
      priorFlaggedRatio: previousSnapshot?.ratios?.flagged ?? null,
      ratioDelta: previousSnapshot?.ratios ? currentSnapshot.ratios.flagged - previousSnapshot.ratios.flagged : currentSnapshot.ratios.flagged
    },
    counters: {
      status: statusCounters,
      severity: severityCounters,
      digestMismatches: counters.digestMismatches,
      digestMismatchProofIds
    },
    timelineReporting: {
      eventCount: timeline.length,
      bucketCount: timelineBuckets.size,
      buckets: Array.from(timelineBuckets.values()).slice(-14),
      severityBuckets: timelineSeverityBuckets,
      latestEvent: timeline.at(-1) || null
    },
    exportSummaryState: {
      summaryId: `tamper-analytics:${generatedAt}`,
      fingerprint: stableProofHash({
        currentSnapshot,
        previousSnapshotId: previousSnapshot?.snapshotId || null,
        transitionCounters,
        digestMismatchProofIds
      }),
      recommendedFormats: digestMismatchProofIds.length > 0 || counters.critical > 0
        ? ["json", "proof-bundle", "csv"]
        : ["json", "csv"],
      partitions: [
        {
          partitionId: "all-artifacts",
          rowCount: counters.total,
          filter: "status:*"
        },
        {
          partitionId: "flagged-artifacts",
          rowCount: currentSnapshot.flaggedArtifacts,
          filter: "status:suspect|tampered|quarantined"
        },
        {
          partitionId: "digest-mismatches",
          rowCount: counters.digestMismatches,
          filter: "digestMatches:false"
        }
      ]
    },
    scheduledReport: {
      enabled: settings.enabled && settings.schedule.mode === "interval",
      cadenceMinutes: settings.schedule.intervalMinutes,
      nextRunAt: settings.schedule.nextRunAt,
      exportDue: Boolean(settings.schedule.nextRunAt && settings.schedule.nextRunAt <= generatedAt)
    },
    reportCards: [
      {
        cardId: "integrity-posture",
        label: "Integrity posture",
        value: currentSnapshot.flaggedArtifacts,
        total: counters.total,
        tone: counters.critical > 0 ? "critical" : currentSnapshot.flaggedArtifacts > 0 ? "warning" : "success"
      },
      {
        cardId: "digest-mismatches",
        label: "Digest mismatches",
        value: counters.digestMismatches,
        total: counters.total,
        tone: counters.digestMismatches > 0 ? "critical" : "success"
      },
      {
        cardId: "history-trend",
        label: "History trend",
        value: flaggedDelta,
        total: previousSnapshot ? previousSnapshot.flaggedArtifacts : 0,
        tone: flaggedDelta > 0 ? "warning" : "info"
      }
    ],
    snapshots
  };
}

function normalizeRequestedExportFormats(input) {
  const source = input.export && typeof input.export === "object" ? input.export : {};
  const requested = normalizeStringList(input.exportFormats || source.formats || source.requestedFormats)
    .map((format) => format.toLowerCase())
    .filter((format) => VALID_EXPORT_FORMATS.has(format));
  return requested.length > 0 ? Array.from(new Set(requested)) : ["json", "csv"];
}

function buildExportDeliveryState({ input, generatedAt, records, counters, history, timeline, providerContracts, readinessSummary, acceptance, analyticsReport, tenantBoundarySummary }) {
  const source = input.export && typeof input.export === "object" ? input.export : {};
  const requestedFormats = normalizeRequestedExportFormats(input);
  const flaggedOnly = normalizeBoolean(source.flaggedOnly ?? input.flaggedOnlyExport, false);
  const exportRows = flaggedOnly ? records.filter((record) => record.status !== "clean") : records;
  const destination = typeof source.destination === "string" && source.destination.trim()
    ? source.destination.trim()
    : providerContracts.handoff.destination || "download";
  const proofBundleRequested = requestedFormats.includes("proof-bundle");
  const providerCanExport = providerContracts.handoff.canExportProofBundle;
  const blockedReasons = [
    readinessSummary.state === "blocked" ? "readiness-blocked" : null,
    proofBundleRequested && !providerCanExport ? "proof-bundle-provider-missing" : null,
    requestedFormats.some((format) => format !== "csv") && !tenantBoundarySummary.canExportProofs ? "proof-export-permission-missing" : null,
    tenantBoundarySummary.state === "blocked" ? "tenant-boundary-blocked" : null,
    acceptance.blockingReasons.length > 0 && acceptance.decision === "accepted" ? "acceptance-blocked" : null
  ].filter(Boolean);
  const manifests = requestedFormats.map((format) => {
    const includesProofMaterial = format === "proof-bundle" || format === "json" || format === "ndjson";
    const rowCount = format === "proof-bundle"
      ? records.filter((record) => record.proofId).length
      : exportRows.length;
    return {
      manifestId: `${surfaceName}:${format}:${generatedAt}`,
      format,
      destination,
      state: blockedReasons.length > 0 ? "blocked" : "ready",
      rowCount,
      includesProofMaterial,
      includesTimeline: format === "json" || format === "proof-bundle",
      includesHistory: history.length > 0 && (format === "json" || format === "proof-bundle"),
      contentTypes: format === "csv"
        ? ["text/csv"]
        : format === "ndjson"
          ? ["application/x-ndjson"]
          : ["application/json"],
      checksumSeed: `${surfaceId}:${format}:${rowCount}:${counters.digestMismatches}:${analyticsReport.trend.flaggedDelta}`
    };
  });

  return {
    schema: "aios.tamper-check.export-delivery.v1",
    generatedAt,
    destination,
    requestedFormats,
    flaggedOnly,
    state: blockedReasons.length > 0 ? "blocked" : "ready",
    blockedReasons,
    summary: {
      evidenceRows: exportRows.length,
      fullEvidenceRows: records.length,
      flaggedRows: records.filter((record) => record.status !== "clean").length,
      historySnapshots: history.length,
      timelineEvents: timeline.length,
      digestMismatches: counters.digestMismatches,
      trendDirection: analyticsReport.trend.direction
    },
    manifests,
    manifestIndex: manifests.reduce((index, manifest) => {
      index[manifest.format] = {
        manifestId: manifest.manifestId,
        state: manifest.state,
        rowCount: manifest.rowCount,
        checksum: stableProofHash({
          manifestId: manifest.manifestId,
          format: manifest.format,
          destination: manifest.destination,
          rowCount: manifest.rowCount,
          checksumSeed: manifest.checksumSeed
        })
      };
      return index;
    }, {}),
    auditEvent: {
      eventName: "tamper-check.export-summary.prepared",
      generatedAt,
      destination,
      formats: requestedFormats,
      state: blockedReasons.length > 0 ? "blocked" : "ready",
      proofBundleId: providerContracts.handoff.proofBundleId
    },
    tenantBoundary: {
      tenantId: tenantBoundarySummary.tenantId,
      workspaceId: tenantBoundarySummary.workspaceId,
      state: tenantBoundarySummary.state,
      isolationKey: tenantBoundarySummary.isolationKey,
      boundaryHash: tenantBoundarySummary.boundaryHash,
      workspacePolicyHash: tenantBoundarySummary.workspaceScopePolicy.policyHash,
      boundaryHeldProofIds: tenantBoundarySummary.boundaryHold.heldProofIds
    }
  };
}

function buildProofLedger({ generatedAt, records, counters, settings, providerContracts, readinessSummary, acceptance, tenantBoundarySummary }) {
  let previousChainHash = stableProofHash(`${surfaceId}:proof-ledger-root:${generatedAt}`);
  const entries = records.map((record, index) => {
    const priorChainHash = previousChainHash;
    const digestMatches = !(record.digest && record.expectedDigest) || record.digest === record.expectedDigest;
    const evidenceState = record.status === "clean" && digestMatches
      ? "verified"
      : record.status === "quarantined"
        ? "quarantined"
        : "flagged";
    const canonical = {
      ordinal: index + 1,
      artifactId: record.artifactId,
      path: record.path,
      tenantId: record.tenantId,
      workspaceId: record.workspaceId,
      boundary: record.boundary,
      proofId: record.proofId,
      status: record.status,
      severity: record.severity,
      digest: record.digest,
      expectedDigest: record.expectedDigest,
      digestMatches,
      checkedAt: record.checkedAt,
      proofMaterial: record.proofMaterial
    };
    const entryHash = stableProofHash(canonical);
    const chainHash = stableProofHash({
      previousChainHash: priorChainHash,
      entryHash,
      proofId: record.proofId,
      checkedAt: record.checkedAt
    });
    previousChainHash = chainHash;

    return {
      ledgerEntryId: `${surfaceName}:ledger:${index + 1}`,
      ordinal: index + 1,
      artifactId: record.artifactId,
      path: record.path,
      tenantId: record.tenantId,
      workspaceId: record.workspaceId,
      proofId: record.proofId,
      evidenceState,
      boundaryState: record.boundary.state,
      boundaryViolations: record.boundary.violations,
      status: record.status,
      severity: record.severity,
      digestMatches,
      checkedAt: record.checkedAt,
      reason: record.reason,
      algorithm: record.proofMaterial.algorithm,
      baselineId: record.proofMaterial.baselineId,
      observedSizeBytes: record.proofMaterial.observedSizeBytes,
      labels: record.proofMaterial.labels,
      entryHash,
      previousChainHash: index === 0 ? null : priorChainHash,
      chainHash,
      quarantineEligible: settings.enabled && settings.enforcementMode === "quarantine" && evidenceState === "flagged",
      providerHandoffEligible: evidenceState !== "verified" && record.boundary.state !== "blocked" && providerContracts.handoff.canForwardAlert
    };
  });

  const flaggedEntries = entries.filter((entry) => entry.evidenceState !== "verified");
  const quarantinePlan = flaggedEntries.map((entry) => ({
    artifactId: entry.artifactId,
    proofId: entry.proofId,
    command: entry.quarantineEligible ? "quarantine-flagged" : "acknowledge-findings",
    state: entry.quarantineEligible ? "ready" : "review-required",
    reason: entry.quarantineEligible ? "quarantine-mode-enabled" : "quarantine-mode-not-enabled"
  }));

  return {
    schema: "aios.tamper-check.proof-ledger.v1",
    ledgerId: `${surfaceName}:proof-ledger:${generatedAt}`,
    generatedAt,
    surfaceId,
    entryCount: entries.length,
    flaggedEntryCount: flaggedEntries.length,
    digestMismatchCount: counters.digestMismatches,
    rootHash: entries[0]?.entryHash || stableProofHash(`${surfaceId}:empty-proof-ledger`),
    finalChainHash: entries.at(-1)?.chainHash || stableProofHash(`${surfaceId}:empty-proof-ledger:${generatedAt}`),
    integrityState: counters.digestMismatches > 0 || counters.critical > 0 ? "compromised" : flaggedEntries.length > 0 ? "needs-review" : "verified",
    tenantBoundary: {
      state: tenantBoundarySummary.state,
      isolationKey: tenantBoundarySummary.isolationKey,
      boundaryHash: tenantBoundarySummary.boundaryHash,
      blockedRecordCount: tenantBoundarySummary.counts.blockedRecords,
      pathHeldRecordCount: tenantBoundarySummary.counts.pathHeldRecords,
      workspacePolicyHash: tenantBoundarySummary.workspaceScopePolicy.policyHash
    },
    providerHandoff: {
      state: providerContracts.handoff.state,
      writebackState: providerContracts.handoff.writebackState,
      proofBundleId: providerContracts.handoff.proofBundleId,
      destination: providerContracts.handoff.destination,
      negotiatedProviderIds: providerContracts.negotiatedProviderIds,
      canExportProofBundle: providerContracts.handoff.canExportProofBundle,
      alertProofIds: flaggedEntries.filter((entry) => entry.providerHandoffEligible).map((entry) => entry.proofId),
      boundaryHeldProofIds: providerContracts.handoff.boundaryHeldProofs.map((proof) => proof.proofId),
      deliveredProofIds: providerContracts.handoff.correlation.deliveredProofIds,
      failedAcknowledgementIds: providerContracts.handoff.correlation.failedAcknowledgementIds
    },
    acceptanceGate: {
      decision: acceptance.decision,
      accepted: acceptance.accepted,
      unreviewedProofIds: acceptance.unreviewedProofIds,
      readinessState: readinessSummary.state
    },
    quarantinePlan,
    entries
  };
}

function hasLifecycleCommandPermission(command, settings) {
  const requiredPermissions = LIFECYCLE_COMMAND_PERMISSIONS[command] || [];
  return requiredPermissions.every((permission) => {
    if (permission === "settings:write") {
      return settings.controls.settingsWritable;
    }
    if (permission === "tamper-check:run") {
      return settings.controls.canRunChecks;
    }
    if (permission === "tamper-check:review") {
      return settings.controls.canReviewFindings;
    }
    if (permission === "tamper-check:quarantine") {
      return settings.controls.canQuarantine;
    }
    return false;
  });
}

function buildLifecycleCommandEffect({ settings, counters, evidence, generatedAt }) {
  const command = settings.lifecycle.requestedCommand;
  const accepted = Boolean(command && settings.lifecycle.commandAccepted);
  const applied = Boolean(accepted && settings.lifecycle.commandAppliedAt);
  const flaggedEvidence = evidence.filter((record) => record.status !== "clean");
  const reviewProofIds = flaggedEvidence
    .map((record) => record.proofId)
    .filter(Boolean);
  const quarantineProofIds = flaggedEvidence
    .filter((record) => record.status === "tampered" || record.status === "quarantined" || record.severity === "critical")
    .map((record) => record.proofId)
    .filter(Boolean);
  const nextScheduledRunAt = settings.enabled && settings.schedule.mode === "interval"
    ? new Date(Date.parse(generatedAt) + settings.schedule.intervalMinutes * 60 * 1000).toISOString()
    : null;
  const settingsPatch = {};
  const schedulePatch = {};
  const proofActionPatch = {};

  if (applied && command === "enable") {
    settingsPatch.enabled = true;
    schedulePatch.mode = settings.schedule.mode;
    schedulePatch.nextRunAt = settings.schedule.nextRunAt || nextScheduledRunAt;
  } else if (applied && command === "disable") {
    settingsPatch.enabled = false;
    schedulePatch.mode = "disabled";
    schedulePatch.nextRunAt = null;
  } else if (applied && command === "pause-schedule") {
    schedulePatch.mode = "paused";
    schedulePatch.paused = true;
    schedulePatch.nextRunAt = null;
  } else if (applied && command === "resume-schedule") {
    schedulePatch.mode = "interval";
    schedulePatch.paused = false;
    schedulePatch.nextRunAt = settings.schedule.nextRunAt || nextScheduledRunAt;
  } else if (applied && command === "run-now") {
    schedulePatch.lastRunRequestedAt = generatedAt;
    schedulePatch.nextRunAt = nextScheduledRunAt;
    proofActionPatch.intent = counters.total === 0 ? "create-baseline" : "refresh-proof-ledger";
  } else if (applied && command === "quarantine-flagged") {
    proofActionPatch.intent = "quarantine-flagged-artifacts";
    proofActionPatch.proofIds = quarantineProofIds;
    proofActionPatch.requiresProviderWrite = quarantineProofIds.length > 0;
  } else if (applied && command === "acknowledge-findings") {
    proofActionPatch.intent = "mark-findings-reviewed";
    proofActionPatch.proofIds = reviewProofIds;
    proofActionPatch.reviewedAt = generatedAt;
  }

  return {
    schema: "aios.tamper-check.lifecycle-command-effect.v1",
    state: !command
      ? "idle"
      : !accepted
        ? "rejected"
        : settings.lifecycle.idempotency.replayed
          ? "replayed"
          : applied
            ? "applied"
            : "accepted",
    command,
    accepted,
    applied,
    fingerprint: settings.lifecycle.commandFingerprint,
    generatedAt,
    settingsPatch,
    schedulePatch,
    proofActionPatch,
    affectedProofIds: command === "quarantine-flagged"
      ? quarantineProofIds
      : command === "acknowledge-findings"
        ? reviewProofIds
        : [],
    auditEvent: command ? {
      eventName: "tamper-check.lifecycle-command.effect-prepared",
      generatedAt,
      command,
      state: accepted ? applied ? "applied" : "accepted" : "rejected",
      fingerprint: settings.lifecycle.commandFingerprint,
      affectedProofCount: command === "quarantine-flagged" ? quarantineProofIds.length : command === "acknowledge-findings" ? reviewProofIds.length : 0,
      scheduleMode: settings.schedule.mode
    } : null
  };
}

function buildLifecycleControls({ settings, counters, evidence, generatedAt }) {
  const flagged = counters.suspect + counters.tampered + counters.quarantined;
  const criticalProofIds = evidence
    .filter((record) => record.severity === "critical" && record.proofId)
    .map((record) => record.proofId);
  const dueAt = settings.schedule.nextRunAt;
  const isDue = Boolean(dueAt && dueAt <= generatedAt);
  const commandPermissionState = Array.from(VALID_LIFECYCLE_COMMANDS).reduce((states, command) => {
    states[command] = {
      requiredPermissions: LIFECYCLE_COMMAND_PERMISSIONS[command] || [],
      allowed: hasLifecycleCommandPermission(command, settings)
    };
    return states;
  }, {});
  const commandAvailability = {
    enable: !settings.enabled && commandPermissionState.enable.allowed,
    disable: settings.enabled && commandPermissionState.disable.allowed,
    "run-now": settings.enabled && commandPermissionState["run-now"].allowed,
    "pause-schedule": settings.schedule.canPause && commandPermissionState["pause-schedule"].allowed,
    "resume-schedule": settings.schedule.canResume && commandPermissionState["resume-schedule"].allowed,
    "quarantine-flagged": settings.enabled && flagged > 0 && settings.enforcementMode === "quarantine" && commandPermissionState["quarantine-flagged"].allowed,
    "acknowledge-findings": flagged > 0 && commandPermissionState["acknowledge-findings"].allowed
  };
  const commandReasons = {
    enable: !commandPermissionState.enable.allowed ? "settings-write-permission-missing" : settings.enabled ? "tamper-check-already-enabled" : null,
    disable: !commandPermissionState.disable.allowed ? "settings-write-permission-missing" : !settings.enabled ? "tamper-check-already-disabled" : null,
    "run-now": !commandPermissionState["run-now"].allowed ? "run-permission-missing" : !settings.enabled ? "tamper-check-disabled" : null,
    "pause-schedule": !settings.enabled
      ? "tamper-check-disabled"
      : !commandPermissionState["pause-schedule"].allowed
        ? "settings-write-permission-missing"
      : !settings.schedule.canPause
        ? "schedule-not-running"
        : null,
    "resume-schedule": !settings.enabled
      ? "tamper-check-disabled"
      : !commandPermissionState["resume-schedule"].allowed
        ? "settings-write-permission-missing"
      : !settings.schedule.canResume
        ? "schedule-not-paused"
        : null,
    "quarantine-flagged": !settings.enabled
      ? "tamper-check-disabled"
      : !commandPermissionState["quarantine-flagged"].allowed
        ? "quarantine-permission-missing"
      : flagged === 0
        ? "no-flagged-artifacts"
        : settings.enforcementMode !== "quarantine"
          ? "quarantine-mode-not-enabled"
          : null,
    "acknowledge-findings": !commandPermissionState["acknowledge-findings"].allowed ? "review-permission-missing" : flagged === 0 ? "no-flagged-artifacts" : null
  };
  const commandPalette = Array.from(VALID_LIFECYCLE_COMMANDS).map((command) => ({
    command,
    label: LIFECYCLE_COMMAND_LABELS[command],
    available: Boolean(commandAvailability[command]),
    disabledReason: commandAvailability[command] ? null : commandReasons[command] || "not-available",
    requiredPermissions: commandPermissionState[command].requiredPermissions,
    permissionAllowed: commandPermissionState[command].allowed,
    route: `/kernel/${surfaceGroup}/${surfaceName}/lifecycle/${command}`
  }));
  const commandEffect = buildLifecycleCommandEffect({ settings, counters, evidence, generatedAt });

  let nextAction = {
    actionId: "monitor-schedule",
    urgency: "info",
    reason: "tamper-check-enabled-and-clean",
    command: isDue ? "run-now" : null
  };

  if (!settings.enabled) {
    nextAction = {
      actionId: "enable-tamper-check",
      urgency: "warning",
      reason: "tamper-check-disabled",
      command: "enable"
    };
  } else if (counters.tampered > 0 || counters.quarantined > 0) {
    nextAction = {
      actionId: settings.enforcementMode === "quarantine" ? "quarantine-flagged-artifacts" : "review-critical-proofs",
      urgency: "critical",
      reason: "critical-artifact-integrity-findings",
      command: settings.enforcementMode === "quarantine" ? "quarantine-flagged" : "acknowledge-findings",
      proofIds: criticalProofIds
    };
  } else if (counters.suspect > 0 || counters.warning > 0) {
    nextAction = {
      actionId: "review-suspect-artifacts",
      urgency: "warning",
      reason: "non-critical-artifact-integrity-findings",
      command: "acknowledge-findings"
    };
  } else if (counters.total === 0) {
    nextAction = {
      actionId: "run-initial-baseline",
      urgency: "warning",
      reason: "no-artifact-evidence-records",
      command: "run-now"
    };
  } else if (isDue) {
    nextAction = {
      actionId: "run-scheduled-check",
      urgency: "info",
      reason: "scheduled-check-due",
      command: "run-now"
    };
  }

  return {
    schema: "aios.tamper-check.lifecycle-controls.v1",
    commandAvailability,
    commandPermissionState,
    commandPalette,
    commandEffect,
    lastCommand: settings.lifecycle.requestedCommand ? {
      command: settings.lifecycle.requestedCommand,
      accepted: settings.lifecycle.commandAccepted,
      appliedAt: settings.lifecycle.commandAppliedAt,
      replayed: settings.lifecycle.idempotency.replayed,
      fingerprint: settings.lifecycle.commandFingerprint,
      missingPermissions: settings.lifecycle.request.missingPermissions,
      effectState: commandEffect.state,
      affectedProofIds: commandEffect.affectedProofIds
    } : null,
    enabled: settings.enabled,
    enforcementMode: settings.enforcementMode,
    schedule: {
      ...settings.schedule,
      actionState: settings.schedule.mode === "disabled"
        ? "disabled"
        : settings.schedule.due
          ? "due"
          : settings.schedule.mode === "paused"
            ? "paused"
            : "scheduled",
      nextRunnableAt: settings.enabled
        ? settings.schedule.due
          ? generatedAt
          : settings.schedule.nextRunAt
        : null
    },
    nextAction,
    auditEvent: {
      eventName: "tamper-check.lifecycle-controls.prepared",
      generatedAt,
      enabled: settings.enabled,
      scheduleMode: settings.schedule.mode,
      nextActionId: nextAction.actionId,
      availableCommands: Object.entries(commandAvailability)
        .filter(([, available]) => available)
        .map(([command]) => command)
    }
  };
}

function buildValidationSummary({ settings, counters, providerContracts, tenantBoundarySummary }) {
  const checks = [
    {
      checkId: "settings-contract",
      state: settings.validation.some((entry) => entry.severity === "critical") ? "failed" : settings.validation.length > 0 ? "warning" : "passed",
      message: settings.validation.length > 0 ? "Settings were normalized before report generation." : "Settings are valid for hosted-kernel tamper-check.",
      findings: settings.validation
    },
    {
      checkId: "evidence-coverage",
      state: counters.total > 0 ? "passed" : "warning",
      message: counters.total > 0 ? `${counters.total} artifact evidence records are available.` : "No artifact evidence records were supplied.",
      findings: counters.total > 0 ? [] : [{
        code: "missing-evidence",
        severity: "warning",
        message: "Run a tamper-check baseline before accepting this preview."
      }]
    },
    {
      checkId: "provider-negotiation",
      state: providerContracts.handoff.state === "blocked" || providerContracts.handoff.writebackState === "failed"
        ? "failed"
        : providerContracts.negotiatedProviderIds.length > 0
          ? "passed"
          : "warning",
      message: providerContracts.negotiatedProviderIds.length > 0
        ? providerContracts.handoff.writebackState === "failed"
          ? "Provider contract received proof output but reported external writeback failure."
          : `${providerContracts.negotiatedProviderIds.length} provider contract(s) can receive proof output.`
        : "No provider contract has all required proof capabilities.",
      findings: [
        ...providerContracts.providers
        .filter((provider) => provider.missingCapabilities.length > 0)
        .map((provider) => ({
          code: "provider-capability-missing",
          severity: "critical",
          providerId: provider.providerId,
          message: "Provider is missing required tamper-check capabilities.",
          missingCapabilities: provider.missingCapabilities
        })),
        ...providerContracts.acknowledgements
          .filter((acknowledgement) => acknowledgement.state === "failed" || acknowledgement.state === "rejected")
          .map((acknowledgement) => ({
            code: "provider-handoff-writeback-failed",
            severity: "critical",
            providerId: acknowledgement.providerId,
            acknowledgementId: acknowledgement.acknowledgementId,
            proofIds: acknowledgement.proofIds,
            message: acknowledgement.message || "External provider did not accept tamper-check proof handoff."
          }))
      ]
    }
    ,
    {
      checkId: "tenant-workspace-boundary",
      state: tenantBoundarySummary.state === "blocked" ? "failed" : tenantBoundarySummary.state === "implicit-default-scope" ? "warning" : "passed",
      message: tenantBoundarySummary.state === "blocked"
        ? "Tenant/workspace boundary blocked one or more tamper-check records."
        : tenantBoundarySummary.state === "implicit-default-scope"
          ? "Tamper-check used an implicit hosted-kernel tenant/workspace scope."
          : "Tenant/workspace boundary is scoped and readable.",
      findings: tenantBoundarySummary.findings.length > 0
        ? tenantBoundarySummary.findings
        : tenantBoundarySummary.implicitDefaults.map((field) => ({
          code: "implicit-boundary-default",
          severity: "warning",
          field,
          message: `Tamper-check scope did not include ${field}; hosted-kernel default was used.`
        }))
    }
  ];
  const failed = checks.filter((check) => check.state === "failed").length;
  const warnings = checks.filter((check) => check.state === "warning").length;

  return {
    schema: "aios.tamper-check.validation-summary.v1",
    state: failed > 0 ? "failed" : warnings > 0 ? "warning" : "passed",
    canAccept: failed === 0 && counters.total > 0,
    failed,
    warnings,
    passed: checks.filter((check) => check.state === "passed").length,
    checks
  };
}

function buildReadinessSummary({ settings, counters, providerContracts, validationSummary, tenantBoundarySummary }) {
  const flagged = counters.suspect + counters.tampered + counters.quarantined;
  const blockers = [];
  if (!settings.enabled) {
    blockers.push("tamper-check-disabled");
  }
  if (validationSummary.state === "failed") {
    blockers.push("validation-failed");
  }
  if (providerContracts.handoff.state === "blocked") {
    blockers.push("provider-contract-blocked");
  }
  if (providerContracts.handoff.writebackState === "failed") {
    blockers.push("provider-writeback-failed");
  }
  if (tenantBoundarySummary.state === "blocked") {
    blockers.push("tenant-boundary-blocked");
  }

  return {
    schema: "aios.tamper-check.readiness.v1",
    state: blockers.length > 0 ? "blocked" : flagged > 0 ? "needs-review" : counters.total === 0 ? "needs-baseline" : "ready",
    blockers,
    indicators: {
      enabled: settings.enabled,
      scheduleMode: settings.schedule.mode,
      evidencePresent: counters.total > 0,
      flaggedArtifacts: flagged,
      proofExportReady: providerContracts.handoff.canExportProofBundle,
      alertForwardReady: providerContracts.handoff.canForwardAlert,
      providerWritebackState: providerContracts.handoff.writebackState,
      externalAcknowledgementCount: providerContracts.handoff.correlation.acknowledgementCount,
      externalAcknowledgedProofCount: providerContracts.handoff.correlation.deliveredProofIds.length,
      tenantBoundaryState: tenantBoundarySummary.state,
      scopedTenantId: tenantBoundarySummary.tenantId,
      scopedWorkspaceId: tenantBoundarySummary.workspaceId,
      boundaryBlockedRecords: tenantBoundarySummary.counts.blockedRecords
    },
    acceptancePreconditions: {
      requiresEvidence: counters.total === 0,
      requiresProviderNegotiation: providerContracts.handoff.state === "blocked",
      requiresProviderWritebackRepair: providerContracts.handoff.writebackState === "failed",
      requiresCriticalReview: counters.tampered > 0 || counters.quarantined > 0,
      requiresSettingsFix: validationSummary.failed > 0,
      requiresTenantBoundaryFix: tenantBoundarySummary.state === "blocked"
    }
  };
}

function normalizeOperationalFailures(input, generatedAt) {
  const healthSource = input.health && typeof input.health === "object" ? input.health : {};
  const failureSource = Array.isArray(input.operationalFailures)
    ? input.operationalFailures
    : Array.isArray(input.failures)
      ? input.failures
      : Array.isArray(healthSource.failures)
        ? healthSource.failures
        : [];
  const lastError = input.lastError && typeof input.lastError === "object"
    ? input.lastError
    : healthSource.lastError && typeof healthSource.lastError === "object"
      ? healthSource.lastError
      : null;
  const combined = lastError ? [...failureSource, lastError] : failureSource;

  return combined.slice(-20).map((failure, index) => {
    const source = failure && typeof failure === "object" ? failure : {};
    const severity = VALID_SEVERITIES.has(source.severity) ? source.severity : "warning";
    const sourceName = typeof source.source === "string" && VALID_HEALTH_SOURCES.has(source.source.trim().toLowerCase())
      ? source.source.trim().toLowerCase()
      : "kernel";
    const attempts = Math.max(0, Math.trunc(normalizeNumber(source.attempts ?? source.retryCount, 0)));
    const retriable = normalizeBoolean(source.retriable ?? source.retryable, severity !== "critical");
    const code = typeof source.code === "string" && source.code.trim()
      ? source.code.trim()
      : `${sourceName}-operational-failure-${index + 1}`;

    return {
      code,
      source: sourceName,
      severity,
      message: typeof source.message === "string" && source.message.trim()
        ? source.message.trim()
        : "Tamper-check operational failure requires attention.",
      retriable,
      attempts,
      firstSeenAt: asIsoTimestamp(source.firstSeenAt || source.startedAt || source.detectedAt, generatedAt),
      lastSeenAt: asIsoTimestamp(source.lastSeenAt || source.timestamp || source.detectedAt, generatedAt),
      correlationId: typeof source.correlationId === "string" && source.correlationId.trim() ? source.correlationId.trim() : null
    };
  });
}

function calculateRetryPolicy({ generatedAt, settings, failures, providerContracts, persistedState }) {
  const retriableFailures = failures.filter((failure) => failure.retriable);
  const maxAttempts = retriableFailures.reduce((max, failure) => Math.max(max, failure.attempts), 0);
  const missingProviderCapability = providerContracts.providers.some((provider) => provider.missingCapabilities.length > 0);
  const providerWritebackRetryable = providerContracts.handoff.writebackState === "failed"
    && providerContracts.acknowledgements.some((acknowledgement) => acknowledgement.retryable);
  const canRetry = settings.enabled && (retriableFailures.length > 0 || missingProviderCapability || providerWritebackRetryable || persistedState.recoveryState === "stale");
  const backoffMinutes = canRetry
    ? Math.min(MAX_RETRY_BACKOFF_MINUTES, DEFAULT_RETRY_BACKOFF_MINUTES * 2 ** Math.min(maxAttempts, 5))
    : 0;
  const retryAfter = canRetry
    ? new Date(Date.parse(generatedAt) + backoffMinutes * 60 * 1000).toISOString()
    : null;

  return {
    schema: "aios.tamper-check.retry-policy.v1",
    canRetry,
    retryAfter,
    backoffMinutes,
    attemptCeiling: 6,
    attemptsObserved: maxAttempts,
    retryCommand: canRetry ? "run-now" : null,
    suppressAutomaticRetry: !settings.enabled || failures.some((failure) => failure.severity === "critical" && !failure.retriable),
    reason: !settings.enabled
      ? "tamper-check-disabled"
      : retriableFailures.length > 0
        ? "retriable-operational-failure"
        : missingProviderCapability
          ? "provider-capability-negotiation"
          : providerWritebackRetryable
            ? "provider-writeback-retry"
            : persistedState.recoveryState === "stale"
              ? "stale-persisted-state"
              : "no-retry-needed"
  };
}

function normalizeHealthProbeRecords(input, generatedAt) {
  const healthSource = input.health && typeof input.health === "object" ? input.health : {};
  const probeSource = Array.isArray(healthSource.probes)
    ? healthSource.probes
    : Array.isArray(healthSource.checks)
      ? healthSource.checks
      : Array.isArray(input.healthProbes)
        ? input.healthProbes
        : [];
  const generatedTime = Date.parse(generatedAt);

  return probeSource.slice(-30).map((probe, index) => {
    const source = probe && typeof probe === "object" ? probe : {};
    const rawState = typeof source.state === "string" ? source.state.trim().toLowerCase() : "";
    const state = VALID_HEALTH_PROBE_STATES.has(rawState) ? rawState : "warning";
    const sourceName = typeof source.source === "string" && VALID_HEALTH_SOURCES.has(source.source.trim().toLowerCase())
      ? source.source.trim().toLowerCase()
      : "kernel";
    const observedAt = asIsoTimestamp(source.observedAt || source.checkedAt || source.timestamp, generatedAt);
    const latencyMs = Number.isFinite(Number(source.latencyMs ?? source.durationMs))
      ? Math.max(0, Math.trunc(Number(source.latencyMs ?? source.durationMs)))
      : null;
    const timeoutMs = Number.isFinite(Number(source.timeoutMs ?? source.deadlineMs))
      ? Math.max(1, Math.trunc(Number(source.timeoutMs ?? source.deadlineMs)))
      : null;
    const staleAfterMinutes = Number.isFinite(Number(source.staleAfterMinutes ?? source.ttlMinutes))
      ? Math.max(1, Math.trunc(Number(source.staleAfterMinutes ?? source.ttlMinutes)))
      : DEFAULT_SCHEDULE_INTERVAL_MINUTES * 2;
    const ageMinutes = Math.max(0, Math.round((generatedTime - Date.parse(observedAt)) / 60000));
    const stale = ageMinutes > staleAfterMinutes;
    const timedOut = state === "timeout" || Boolean(timeoutMs && latencyMs !== null && latencyMs > timeoutMs);
    const probeId = typeof source.probeId === "string" && source.probeId.trim()
      ? source.probeId.trim()
      : typeof source.id === "string" && source.id.trim()
        ? source.id.trim()
        : `${sourceName}:probe:${index + 1}`;

    return {
      probeId,
      source: sourceName,
      state: timedOut ? "timeout" : state,
      observedAt,
      ageMinutes,
      staleAfterMinutes,
      stale,
      latencyMs,
      timeoutMs,
      target: typeof source.target === "string" && source.target.trim() ? source.target.trim().slice(0, 160) : null,
      message: typeof source.message === "string" && source.message.trim()
        ? source.message.trim().slice(0, 240)
        : stale
          ? "Health probe is stale for hosted-kernel tamper-check."
          : timedOut
            ? "Health probe exceeded its configured deadline."
            : null,
      actionable: stale || timedOut || state === "failed" || state === "warning"
    };
  });
}

function buildHealthProbeSummary(probes) {
  const failed = probes.filter((probe) => probe.state === "failed" || probe.state === "timeout");
  const warnings = probes.filter((probe) => probe.state === "warning" || probe.stale);
  const passed = probes.filter((probe) => probe.state === "passed" && !probe.stale);
  const skipped = probes.filter((probe) => probe.state === "skipped");
  const sourceStates = Array.from(new Set(probes.map((probe) => probe.source))).map((source) => {
    const sourceProbes = probes.filter((probe) => probe.source === source);
    const sourceFailed = sourceProbes.some((probe) => probe.state === "failed" || probe.state === "timeout");
    const sourceWarning = sourceProbes.some((probe) => probe.state === "warning" || probe.stale);
    return {
      source,
      state: sourceFailed ? "failed" : sourceWarning ? "warning" : "passed",
      probeCount: sourceProbes.length,
      staleProbeIds: sourceProbes.filter((probe) => probe.stale).map((probe) => probe.probeId),
      failedProbeIds: sourceProbes
        .filter((probe) => probe.state === "failed" || probe.state === "timeout")
        .map((probe) => probe.probeId)
    };
  });

  return {
    schema: "aios.tamper-check.health-probes.v1",
    state: failed.length > 0 ? "failed" : warnings.length > 0 ? "warning" : probes.length === 0 ? "not-reported" : "passed",
    probeCount: probes.length,
    failed: failed.length,
    warnings: warnings.length,
    passed: passed.length,
    skipped: skipped.length,
    staleProbeIds: probes.filter((probe) => probe.stale).map((probe) => probe.probeId),
    timeoutProbeIds: probes.filter((probe) => probe.state === "timeout").map((probe) => probe.probeId),
    sourceStates,
    probes
  };
}

function buildRetryBudgetState({ retryPolicy, failures, probes, generatedAt }) {
  const retryableFailureAttempts = failures
    .filter((failure) => failure.retriable)
    .reduce((sum, failure) => sum + failure.attempts, 0);
  const failingProbeCount = probes.filter((probe) => probe.actionable && probe.state !== "skipped").length;
  const attemptsUsed = Math.max(retryPolicy.attemptsObserved, retryableFailureAttempts);
  const attemptsRemaining = Math.max(0, retryPolicy.attemptCeiling - attemptsUsed);
  const exhausted = retryPolicy.canRetry && attemptsRemaining === 0;

  return {
    schema: "aios.tamper-check.retry-budget.v1",
    generatedAt,
    state: exhausted ? "exhausted" : retryPolicy.canRetry ? "available" : "idle",
    attemptsUsed,
    attemptsRemaining,
    attemptCeiling: retryPolicy.attemptCeiling,
    failingProbeCount,
    nextRetryAt: exhausted ? null : retryPolicy.retryAfter,
    backoffMinutes: exhausted ? 0 : retryPolicy.backoffMinutes,
    escalation: exhausted ? {
      code: "retry-budget-exhausted",
      severity: "critical",
      message: "Tamper-check automatic retry budget is exhausted; operator repair is required.",
      action: "open-operational-health"
    } : null
  };
}

function buildOperationalHealth({ input, generatedAt, settings, counters, providerContracts, validationSummary, persistedState, controls, tenantBoundarySummary }) {
  const failures = normalizeOperationalFailures(input, generatedAt);
  const healthProbes = normalizeHealthProbeRecords(input, generatedAt);
  const probeSummary = buildHealthProbeSummary(healthProbes);
  const providerBlocked = providerContracts.handoff.state === "blocked";
  const providerWritebackFailed = providerContracts.handoff.writebackState === "failed";
  const stateStale = persistedState.recoveryState === "stale" || persistedState.recoveryState === "corrupt";
  const missingEvidenceAfterRecovery = persistedState.loaded && persistedState.counters.total > 0 && counters.total === 0;
  const criticalFailures = failures.filter((failure) => failure.severity === "critical");
  const retryPolicy = calculateRetryPolicy({ generatedAt, settings, failures, providerContracts, persistedState });
  const retryBudget = buildRetryBudgetState({ retryPolicy, failures, probes: healthProbes, generatedAt });
  const degradedReasons = [
    providerBlocked ? "provider-contract-blocked" : null,
    providerWritebackFailed ? "provider-writeback-failed" : null,
    tenantBoundarySummary.state === "blocked" ? "tenant-boundary-blocked" : null,
    stateStale ? `state-${persistedState.recoveryState}` : null,
    missingEvidenceAfterRecovery ? "recovered-without-evidence" : null,
    validationSummary.state === "warning" ? "validation-warning" : null,
    failures.some((failure) => failure.severity === "warning") ? "operational-warning" : null,
    probeSummary.state === "warning" ? "health-probe-warning" : null,
    probeSummary.staleProbeIds.length > 0 ? "health-probe-stale" : null
  ].filter(Boolean);
  const state = !settings.enabled
    ? "disabled"
    : criticalFailures.length > 0
      || settings.validation.some((entry) => entry.severity === "critical")
      || providerWritebackFailed
      || probeSummary.state === "failed"
      || retryBudget.state === "exhausted"
      ? "failed"
      : degradedReasons.length > 0
        ? "degraded"
        : "healthy";
  const degradedModePlan = {
    schema: "aios.tamper-check.degraded-mode-plan.v1",
    active: state === "degraded",
    serveMode: state === "degraded" && persistedState.lastStableStatus ? "cached-preview-with-live-errors" : "live-preview",
    suppressProviderWrites: providerBlocked || providerWritebackFailed || tenantBoundarySummary.state === "blocked",
    allowManualRun: settings.enabled && controls.commandAvailability["run-now"] && retryBudget.state !== "exhausted",
    allowAcceptance: state !== "failed" && validationSummary.canAccept && tenantBoundarySummary.state !== "blocked",
    reasonCodes: degradedReasons,
    operatorRoute: `/kernel/${surfaceGroup}/${surfaceName}/health`,
    nextRecoveryCommand: retryPolicy.canRetry && retryBudget.state !== "exhausted" ? retryPolicy.retryCommand : null
  };
  const actionableErrors = [
    ...failures.map((failure) => ({
      code: failure.code,
      source: failure.source,
      severity: failure.severity,
      message: failure.message,
      action: failure.retriable ? "retry-tamper-check" : "open-settings",
      command: failure.retriable ? "run-now" : "settings",
      retryAfter: failure.retriable ? retryPolicy.retryAfter : null,
      correlationId: failure.correlationId
    })),
    ...healthProbes
      .filter((probe) => probe.actionable)
      .map((probe) => ({
        code: probe.stale ? "health-probe-stale" : `health-probe-${probe.state}`,
        source: probe.source,
        severity: probe.state === "failed" || probe.state === "timeout" ? "critical" : "warning",
        message: probe.message || "Health probe reported a degraded tamper-check dependency.",
        action: probe.source === "provider" ? "open-provider-health" : "open-operational-health",
        route: probe.source === "provider"
          ? `/kernel/${surfaceGroup}/${surfaceName}/providers`
          : `/kernel/${surfaceGroup}/${surfaceName}/health`,
        probeId: probe.probeId,
        observedAt: probe.observedAt,
        stale: probe.stale,
        latencyMs: probe.latencyMs,
        timeoutMs: probe.timeoutMs
      })),
    retryBudget.escalation ? {
      ...retryBudget.escalation,
      source: "scheduler",
      route: `/kernel/${surfaceGroup}/${surfaceName}/health`,
      attemptsUsed: retryBudget.attemptsUsed,
      attemptCeiling: retryBudget.attemptCeiling
    } : null,
    providerBlocked ? {
      code: "provider-contract-blocked",
      source: "provider",
      severity: "critical",
      message: "No provider has all capabilities required for tamper-check proof handoff.",
      action: "connect-proof-provider",
      route: `/kernel/${surfaceGroup}/${surfaceName}/providers`,
      missingCapabilities: providerContracts.requiredCapabilities
    } : null,
    providerWritebackFailed ? {
      code: "provider-writeback-failed",
      source: "provider",
      severity: "critical",
      message: "External integrity provider rejected or failed tamper-check proof handoff writeback.",
      action: "repair-provider-handoff",
      route: `/kernel/${surfaceGroup}/${surfaceName}/providers`,
      failedAcknowledgementIds: providerContracts.handoff.correlation.failedAcknowledgementIds,
      retryable: providerContracts.acknowledgements.some((acknowledgement) => acknowledgement.retryable)
    } : null,
    missingEvidenceAfterRecovery ? {
      code: "recovered-state-missing-evidence",
      source: "state",
      severity: "warning",
      message: "Persisted state had prior evidence, but the current run did not receive evidence records.",
      action: "run-baseline",
      command: "run-now"
    } : null,
    tenantBoundarySummary.state === "blocked" ? {
      code: "tenant-boundary-blocked",
      source: "settings",
      severity: "critical",
      message: "Tamper-check evidence crossed the active tenant/workspace boundary or actor permissions are missing.",
      action: "open-boundary-settings",
      route: `/kernel/${surfaceGroup}/${surfaceName}/boundary`,
      missingPermissions: tenantBoundarySummary.actor.missingPermissions,
      blockedRecordCount: tenantBoundarySummary.counts.blockedRecords
    } : null
  ].filter(Boolean);

  return {
    schema: "aios.tamper-check.operational-health.v1",
    state,
    generatedAt,
    degradedMode: state === "degraded",
    failed: state === "failed",
    canServeCachedPreview: state === "degraded" && Boolean(persistedState.lastStableStatus),
    lastStableStatus: persistedState.lastStableStatus,
    degradedReasons,
    degradedModePlan,
    failureCount: failures.length,
    failures,
    healthProbes: probeSummary,
    retryPolicy,
    retryBudget,
    actionableErrors,
    healthSignals: {
      scheduler: settings.schedule.mode,
      providerHandoff: providerContracts.handoff.state,
      providerWriteback: providerContracts.handoff.writebackState,
      tenantBoundary: tenantBoundarySummary.state,
      persistedState: persistedState.recoveryState,
      evidenceRecords: counters.total,
      nextActionId: controls.nextAction.actionId,
      healthProbeState: probeSummary.state,
      staleHealthProbeCount: probeSummary.staleProbeIds.length,
      retryBudgetState: retryBudget.state
    }
  };
}

function buildUserPreview({ generatedAt, settings, counters, evidence, controls, readinessSummary }) {
  const flagged = evidence.filter((record) => record.status !== "clean");
  const visibleRecords = flagged.length > 0 ? flagged : evidence.slice(0, 5);
  const tone = readinessSummary.state === "blocked" || counters.critical > 0
    ? "critical"
    : readinessSummary.state === "needs-review" || readinessSummary.state === "needs-baseline"
      ? "warning"
      : "success";

  return {
    schema: "aios.tamper-check.preview.v1",
    generatedAt,
    title: settings.enabled ? "Artifact filesystem tamper-check" : "Artifact filesystem tamper-check is disabled",
    tone,
    summary: counters.total === 0
      ? "No artifacts have been checked yet."
      : `${counters.clean} clean, ${counters.suspect + counters.tampered + counters.quarantined} flagged, ${counters.digestMismatches} digest mismatch(es).`,
    primaryMetric: {
      label: "Flagged artifacts",
      value: counters.suspect + counters.tampered + counters.quarantined,
      total: counters.total
    },
    badges: [
      settings.enforcementMode,
      settings.schedule.mode,
      readinessSummary.state,
      controls.nextAction.urgency
    ],
    records: visibleRecords.slice(0, 5).map((record) => ({
      artifactId: record.artifactId,
      path: record.path,
      status: record.status,
      severity: record.severity,
      proofId: record.proofId,
      reason: record.reason,
      checkedAt: record.checkedAt
    })),
    emptyState: counters.total === 0 ? {
      actionId: "run-initial-baseline",
      command: "run-now",
      message: "Start a baseline run to create accept-ready tamper-check evidence."
    } : null
  };
}

function buildAcceptanceContract({ input, generatedAt, evidence, controls, readinessSummary, validationSummary }) {
  const acceptanceSource = input.acceptance && typeof input.acceptance === "object" ? input.acceptance : {};
  const rawDecision = input.acceptanceDecision || acceptanceSource.decision;
  const decision = typeof rawDecision === "string" ? rawDecision.trim().toLowerCase() : "pending";
  const validDecision = ["accepted", "rejected", "deferred", "pending"].includes(decision) ? decision : "pending";
  const reviewedProofIds = new Set(normalizeStringList(acceptanceSource.reviewedProofIds || input.reviewedProofIds));
  const requiredProofIds = evidence
    .filter((record) => record.status !== "clean" || record.severity === "critical")
    .map((record) => record.proofId)
    .filter(Boolean);
  const unreviewedProofIds = requiredProofIds.filter((proofId) => !reviewedProofIds.has(proofId));
  const canAccept = validationSummary.canAccept && readinessSummary.state !== "blocked" && unreviewedProofIds.length === 0;

  return {
    schema: "aios.tamper-check.acceptance.v1",
    decision: validDecision,
    accepted: validDecision === "accepted" && canAccept,
    acceptedAt: validDecision === "accepted" && canAccept ? generatedAt : null,
    acceptedBy: typeof acceptanceSource.actor === "string" && acceptanceSource.actor.trim() ? acceptanceSource.actor.trim() : null,
    canAccept,
    requiredProofIds,
    reviewedProofIds: Array.from(reviewedProofIds),
    unreviewedProofIds,
    rejectionReasons: validDecision === "rejected" ? normalizeStringList(acceptanceSource.reasons || input.rejectionReasons) : [],
    blockingReasons: [
      ...readinessSummary.blockers,
      ...unreviewedProofIds.map((proofId) => `proof-not-reviewed:${proofId}`),
      validationSummary.canAccept ? null : "validation-not-accept-ready"
    ].filter(Boolean),
    nextCommand: canAccept ? controls.nextAction.command : unreviewedProofIds.length > 0 ? "acknowledge-findings" : controls.nextAction.command
  };
}

function buildClientReviewContract({ generatedAt, preview, acceptance, validationSummary, readinessSummary, evidence, controls, tenantBoundarySummary, providerContracts }) {
  const flaggedRecords = evidence.filter((record) => record.status !== "clean" || record.severity === "critical");
  const unreviewedSet = new Set(acceptance.unreviewedProofIds);
  const validationFindings = validationSummary.checks.flatMap((check) => check.findings.map((finding) => ({
    checkId: check.checkId,
    code: finding.code || check.checkId,
    severity: finding.severity || (check.state === "failed" ? "critical" : "warning"),
    message: finding.message || check.message
  })));
  const reviewQueue = flaggedRecords.slice(0, 25).map((record, index) => {
    const digestState = record.digest && record.expectedDigest
      ? record.digest === record.expectedDigest ? "matched" : "mismatched"
      : "not-supplied";
    const providerPending = providerContracts.handoff.flaggedProofs.some((proof) => proof.proofId === record.proofId)
      && !providerContracts.handoff.correlation.deliveredProofIds.includes(record.proofId);
    return {
      queueId: `${surfaceName}:review:${index + 1}`,
      artifactId: record.artifactId,
      path: record.path,
      proofId: record.proofId,
      status: record.status,
      severity: record.severity,
      reason: record.reason,
      digestState,
      boundaryState: record.boundary.state,
      boundaryViolations: record.boundary.violations,
      checkedAt: record.checkedAt,
      requiresReview: unreviewedSet.has(record.proofId),
      providerPending,
      route: `/kernel/${surfaceGroup}/${surfaceName}/proofs/${encodeURIComponent(record.proofId)}`
    };
  });
  const acceptanceState = acceptance.accepted
    ? "accepted"
    : acceptance.decision === "rejected"
      ? "rejected"
      : acceptance.blockingReasons.length > 0
        ? "blocked"
        : acceptance.canAccept
          ? "ready"
          : "pending";
  const primaryAction = acceptance.canAccept
    ? {
      actionId: "accept-preview",
      label: "Accept preview",
      command: "accept",
      route: `/kernel/${surfaceGroup}/${surfaceName}/acceptance`
    }
    : controls.nextAction.command
      ? {
        actionId: controls.nextAction.actionId,
        label: controls.nextAction.reason,
        command: controls.nextAction.command,
        route: `/kernel/${surfaceGroup}/${surfaceName}/lifecycle/${controls.nextAction.command}`
      }
      : {
        actionId: "open-review",
        label: "Open review",
        command: null,
        route: `/kernel/${surfaceGroup}/${surfaceName}/preview`
      };

  return {
    schema: "aios.tamper-check.client-review.v1",
    generatedAt,
    state: acceptanceState,
    tone: preview.tone,
    title: preview.title,
    summaryText: preview.summary,
    readinessState: readinessSummary.state,
    validationState: validationSummary.state,
    tenantBoundaryState: tenantBoundarySummary.state,
    acceptance: {
      decision: acceptance.decision,
      accepted: acceptance.accepted,
      canAccept: acceptance.canAccept,
      acceptedAt: acceptance.acceptedAt,
      requiredProofCount: acceptance.requiredProofIds.length,
      reviewedProofCount: acceptance.reviewedProofIds.length,
      unreviewedProofCount: acceptance.unreviewedProofIds.length,
      blockingReasons: acceptance.blockingReasons
    },
    validationDigest: {
      failed: validationSummary.failed,
      warnings: validationSummary.warnings,
      passed: validationSummary.passed,
      topFindings: validationFindings.slice(0, 8)
    },
    readinessDigest: {
      blockers: readinessSummary.blockers,
      indicators: readinessSummary.indicators,
      acceptancePreconditions: readinessSummary.acceptancePreconditions
    },
    reviewQueue,
    emptyReviewQueue: reviewQueue.length === 0 ? {
      state: evidence.length === 0 ? "needs-baseline" : "no-flagged-proofs",
      message: evidence.length === 0 ? "No evidence is available for review." : "All current proof records are clean.",
      command: evidence.length === 0 ? "run-now" : controls.nextAction.command
    } : null,
    actionBar: {
      primary: primaryAction,
      secondary: [
        {
          actionId: "open-validation",
          label: "Validation",
          route: `/kernel/${surfaceGroup}/${surfaceName}/validation`,
          disabled: validationSummary.checks.length === 0
        },
        {
          actionId: "open-readiness",
          label: "Readiness",
          route: `/kernel/${surfaceGroup}/${surfaceName}/readiness`,
          disabled: false
        },
        {
          actionId: "export-proof",
          label: "Export proof",
          route: `/kernel/${surfaceGroup}/${surfaceName}/export`,
          disabled: !providerContracts.handoff.canExportProofBundle || !tenantBoundarySummary.canExportProofs
        }
      ]
    },
    routeContracts: {
      preview: `/kernel/${surfaceGroup}/${surfaceName}/preview`,
      acceptance: `/kernel/${surfaceGroup}/${surfaceName}/acceptance`,
      readiness: `/kernel/${surfaceGroup}/${surfaceName}/readiness`,
      validation: `/kernel/${surfaceGroup}/${surfaceName}/validation`,
      nextSteps: `/kernel/${surfaceGroup}/${surfaceName}/next-steps`
    }
  };
}

function buildExplainableNextSteps({ controls, readinessSummary, acceptanceContract, providerContracts, tenantBoundarySummary }) {
  const steps = [];
  if (readinessSummary.acceptancePreconditions.requiresTenantBoundaryFix) {
    steps.push({
      stepId: "fix-tenant-boundary",
      label: "Fix tenant/workspace boundary",
      command: "settings",
      route: `/kernel/${surfaceGroup}/${surfaceName}/boundary`,
      reason: "Artifact evidence must belong to the active tenant/workspace and actor permissions before proof acceptance.",
      blockedRecordCount: tenantBoundarySummary.counts.blockedRecords,
      missingPermissions: tenantBoundarySummary.actor.missingPermissions
    });
  }
  if (readinessSummary.acceptancePreconditions.requiresSettingsFix) {
    steps.push({
      stepId: "fix-settings",
      label: "Fix tamper-check settings",
      command: "settings",
      reason: "Settings validation must pass before the report can be accepted."
    });
  }
  if (readinessSummary.acceptancePreconditions.requiresProviderNegotiation) {
    steps.push({
      stepId: "connect-provider",
      label: "Connect proof provider",
      command: null,
      route: `/kernel/${surfaceGroup}/${surfaceName}/providers`,
      reason: "Proof export and alert forwarding require a negotiated provider contract.",
      requiredCapabilities: providerContracts.requiredCapabilities
    });
  }
  if (readinessSummary.acceptancePreconditions.requiresProviderWritebackRepair) {
    steps.push({
      stepId: "repair-provider-handoff",
      label: "Repair provider handoff",
      command: null,
      route: `/kernel/${surfaceGroup}/${surfaceName}/providers`,
      reason: "External provider writeback must be repaired before proof acceptance can continue.",
      failedAcknowledgementIds: providerContracts.handoff.correlation.failedAcknowledgementIds
    });
  }
  if (readinessSummary.acceptancePreconditions.requiresEvidence) {
    steps.push({
      stepId: "run-baseline",
      label: "Run baseline tamper-check",
      command: "run-now",
      reason: "Acceptance requires at least one artifact evidence record."
    });
  }
  if (acceptanceContract.unreviewedProofIds.length > 0) {
    steps.push({
      stepId: "review-proofs",
      label: "Review flagged proof records",
      command: "acknowledge-findings",
      reason: "Flagged artifacts must have reviewed proof identifiers before acceptance.",
      proofIds: acceptanceContract.unreviewedProofIds
    });
  }
  if (steps.length === 0) {
    steps.push({
      stepId: controls.nextAction.actionId,
      label: "Continue tamper-check workflow",
      command: controls.nextAction.command,
      reason: controls.nextAction.reason
    });
  }

  return {
    schema: "aios.tamper-check.next-steps.v1",
    primaryStepId: steps[0].stepId,
    steps
  };
}

function buildPreviewDecisionContract({ generatedAt, preview, validationSummary, readinessSummary, acceptance, nextSteps, clientReview, providerContracts, tenantBoundarySummary }) {
  const validationSections = validationSummary.checks.map((check) => ({
    sectionId: check.checkId,
    state: check.state,
    label: check.checkId.split("-").map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(" "),
    findingCount: check.findings.length,
    criticalFindingCount: check.findings.filter((finding) => finding.severity === "critical").length,
    route: `/kernel/${surfaceGroup}/${surfaceName}/validation#${encodeURIComponent(check.checkId)}`,
    summary: check.message
  }));
  const unresolvedNextSteps = nextSteps.steps.filter((step) => step.stepId !== "monitor-schedule");
  const requiredProofCount = acceptance.requiredProofIds.length;
  const reviewedProofCount = acceptance.reviewedProofIds.filter((proofId) => acceptance.requiredProofIds.includes(proofId)).length;
  const reviewProgress = requiredProofCount > 0 ? reviewedProofCount / requiredProofCount : 1;
  const acceptanceCriteria = [
    {
      criterionId: "validation-passed",
      label: "Validation passed",
      satisfied: validationSummary.state !== "failed",
      blockingReasons: validationSummary.state === "failed" ? ["validation-failed"] : []
    },
    {
      criterionId: "readiness-not-blocked",
      label: "Readiness not blocked",
      satisfied: readinessSummary.state !== "blocked",
      blockingReasons: readinessSummary.blockers
    },
    {
      criterionId: "required-proofs-reviewed",
      label: "Required proofs reviewed",
      satisfied: acceptance.unreviewedProofIds.length === 0,
      blockingReasons: acceptance.unreviewedProofIds.map((proofId) => `proof-not-reviewed:${proofId}`)
    },
    {
      criterionId: "tenant-boundary-clear",
      label: "Tenant boundary clear",
      satisfied: tenantBoundarySummary.state !== "blocked",
      blockingReasons: tenantBoundarySummary.state === "blocked" ? ["tenant-boundary-blocked"] : []
    }
  ];
  const failedCriteria = acceptanceCriteria.filter((criterion) => !criterion.satisfied);
  const previewState = acceptance.accepted
    ? "accepted"
    : failedCriteria.length > 0
      ? "blocked"
      : acceptance.canAccept
        ? "accept-ready"
        : "review";

  return {
    schema: "aios.tamper-check.preview-decision.v1",
    generatedAt,
    state: previewState,
    tone: preview.tone,
    title: preview.title,
    summary: preview.summary,
    acceptReady: previewState === "accept-ready" || acceptance.accepted,
    decisionHash: stableProofHash({
      generatedAt,
      previewState,
      validationState: validationSummary.state,
      readinessState: readinessSummary.state,
      acceptanceDecision: acceptance.decision,
      unreviewedProofIds: acceptance.unreviewedProofIds,
      tenantBoundaryState: tenantBoundarySummary.state,
      providerWritebackState: providerContracts.handoff.writebackState
    }),
    summaryTiles: [
      {
        tileId: "readiness",
        label: "Readiness",
        value: readinessSummary.state,
        tone: readinessSummary.state === "blocked" ? "critical" : readinessSummary.state === "needs-review" ? "warning" : "success",
        route: `/kernel/${surfaceGroup}/${surfaceName}/readiness`
      },
      {
        tileId: "validation",
        label: "Validation",
        value: validationSummary.state,
        tone: validationSummary.failed > 0 ? "critical" : validationSummary.warnings > 0 ? "warning" : "success",
        route: `/kernel/${surfaceGroup}/${surfaceName}/validation`
      },
      {
        tileId: "acceptance",
        label: "Acceptance",
        value: acceptance.accepted ? "accepted" : acceptance.canAccept ? "ready" : acceptance.decision,
        tone: acceptance.accepted || acceptance.canAccept ? "success" : acceptance.blockingReasons.length > 0 ? "warning" : "info",
        route: `/kernel/${surfaceGroup}/${surfaceName}/acceptance`
      },
      {
        tileId: "provider",
        label: "Provider handoff",
        value: providerContracts.handoff.writebackState,
        tone: providerContracts.handoff.writebackState === "failed" || providerContracts.handoff.state === "blocked" ? "critical" : "info",
        route: `/kernel/${surfaceGroup}/${surfaceName}/providers`
      }
    ],
    acceptanceCriteria,
    failedCriteria,
    validationSections,
    proofReview: {
      requiredProofCount,
      reviewedProofCount,
      unreviewedProofCount: acceptance.unreviewedProofIds.length,
      reviewProgress,
      reviewRoute: `/kernel/${surfaceGroup}/${surfaceName}/review`,
      nextUnreviewedProofId: acceptance.unreviewedProofIds[0] || null,
      reviewQueueIds: clientReview.reviewQueue.map((item) => item.queueId)
    },
    nextStepCards: unresolvedNextSteps.slice(0, 6).map((step, index) => ({
      cardId: `preview-next-step-${index + 1}`,
      stepId: step.stepId,
      label: step.label,
      command: step.command || null,
      route: step.route || (step.command ? `/kernel/${surfaceGroup}/${surfaceName}/lifecycle/${step.command}` : `/kernel/${surfaceGroup}/${surfaceName}/next-steps`),
      reason: step.reason,
      primary: index === 0
    })),
    routeContracts: {
      preview: `/kernel/${surfaceGroup}/${surfaceName}/preview`,
      validationSummary: `/kernel/${surfaceGroup}/${surfaceName}/validation`,
      readinessSummary: `/kernel/${surfaceGroup}/${surfaceName}/readiness`,
      acceptance: `/kernel/${surfaceGroup}/${surfaceName}/acceptance`,
      proofReview: `/kernel/${surfaceGroup}/${surfaceName}/review`,
      nextSteps: `/kernel/${surfaceGroup}/${surfaceName}/next-steps`
    }
  };
}

function routeForHandoffTarget(handoffTarget, focusedProofId) {
  if (handoffTarget === "artifact-review" && focusedProofId) {
    return `/kernel/${surfaceGroup}/${surfaceName}/proofs/${encodeURIComponent(focusedProofId)}`;
  }
  const routeSegments = {
    "artifact-review": "review",
    "proof-export": "export",
    "provider-setup": "providers",
    "baseline-run": "lifecycle/run-now",
    settings: "settings"
  };
  return `/kernel/${surfaceGroup}/${surfaceName}/${routeSegments[handoffTarget] || "handoff"}`;
}

function buildHandoffDestinationPayload({ handoffTarget, selectedArtifacts, focusedProof, providerContracts, acceptance, nextSteps, clientReview, tenantBoundarySummary }) {
  const firstStep = nextSteps.steps[0] || null;
  if (handoffTarget === "artifact-review") {
    return {
      view: "proof-review",
      queueIds: clientReview.reviewQueue.map((item) => item.queueId),
      artifactIds: selectedArtifacts.map((record) => record.artifactId),
      proofIds: selectedArtifacts.map((record) => record.proofId).filter(Boolean),
      focusedProofId: focusedProof?.proofId || acceptance.unreviewedProofIds[0] || null,
      requireAcknowledgement: acceptance.unreviewedProofIds.length > 0
    };
  }
  if (handoffTarget === "proof-export") {
    return {
      view: "proof-export",
      proofBundleId: providerContracts.handoff.proofBundleId,
      destination: providerContracts.handoff.destination || "download",
      exportable: providerContracts.handoff.canExportProofBundle && tenantBoundarySummary.canExportProofs,
      formats: providerContracts.handoff.canExportProofBundle ? ["json", "proof-bundle"] : ["json"],
      proofIds: providerContracts.handoff.flaggedProofs.map((proof) => proof.proofId)
    };
  }
  if (handoffTarget === "provider-setup") {
    return {
      view: "provider-setup",
      requiredCapabilities: providerContracts.requiredCapabilities,
      negotiatedProviderIds: providerContracts.negotiatedProviderIds,
      missingCapabilitiesByProvider: providerContracts.providers.map((provider) => ({
        providerId: provider.providerId,
        missingCapabilities: provider.missingCapabilities
      }))
    };
  }
  if (handoffTarget === "baseline-run") {
    return {
      view: "baseline-run",
      command: "run-now",
      reason: "baseline-required-for-acceptance",
      firstStepId: firstStep?.stepId || null
    };
  }
  return {
    view: "settings",
    reason: firstStep?.reason || "tamper-check-settings-required",
    tenantBoundaryState: tenantBoundarySummary.state,
    missingPermissions: tenantBoundarySummary.actor.missingPermissions
  };
}

function buildClientWorkflowHandoff({ clientRuntime, providerContracts, nextSteps, acceptance, readinessSummary, preview, clientReview, evidence, tenantBoundarySummary }) {
  const selectedArtifacts = clientRuntime.selectedArtifactIds.length > 0
    ? evidence.filter((record) => clientRuntime.selectedArtifactIds.includes(record.artifactId))
    : evidence.filter((record) => record.status !== "clean");
  const focusedProof = clientRuntime.focusedProofId
    ? evidence.find((record) => record.proofId === clientRuntime.focusedProofId) || null
    : null;
  const firstStep = nextSteps.steps[0] || null;
  const inferredTarget = readinessSummary.acceptancePreconditions.requiresProviderNegotiation
    ? "provider-setup"
    : readinessSummary.acceptancePreconditions.requiresEvidence
      ? "baseline-run"
      : acceptance.unreviewedProofIds.length > 0 || selectedArtifacts.length > 0
        ? "artifact-review"
        : providerContracts.handoff.canExportProofBundle
          ? "proof-export"
          : "settings";
  const handoffTarget = clientRuntime.preferredHandoffTarget || inferredTarget;
  const providerReady = providerContracts.negotiatedProviderIds.length > 0;
  const route = routeForHandoffTarget(handoffTarget, focusedProof?.proofId || clientRuntime.focusedProofId);
  const proofScope = {
    selectedArtifactIds: selectedArtifacts.map((record) => record.artifactId),
    selectedProofIds: selectedArtifacts.map((record) => record.proofId).filter(Boolean),
    focusedProofId: focusedProof?.proofId || clientRuntime.focusedProofId || null,
    reviewedProofIds: clientRuntime.reviewedProofIds,
    unreviewedProofIds: acceptance.unreviewedProofIds,
    providerPendingProofIds: providerContracts.handoff.flaggedProofs
      .map((proof) => proof.proofId)
      .filter((proofId) => !providerContracts.handoff.correlation.deliveredProofIds.includes(proofId))
  };
  const handoffBlockers = [
    ...readinessSummary.blockers,
    handoffTarget === "proof-export" && !providerContracts.handoff.canExportProofBundle ? "proof-export-not-negotiated" : null,
    handoffTarget === "proof-export" && !tenantBoundarySummary.canExportProofs ? "proof-export-permission-missing" : null,
    handoffTarget === "artifact-review" && tenantBoundarySummary.state === "blocked" ? "tenant-boundary-blocked" : null,
    handoffTarget === "provider-setup" && providerContracts.requiredCapabilities.length === 0 ? "provider-setup-not-required" : null
  ].filter(Boolean);
  const repairTargets = new Set(["provider-setup", "settings", "baseline-run"]);
  const canContinue = readinessSummary.state !== "blocked" || repairTargets.has(handoffTarget);
  const destinationPayload = buildHandoffDestinationPayload({
    handoffTarget,
    selectedArtifacts,
    focusedProof,
    providerContracts,
    acceptance,
    nextSteps,
    clientReview,
    tenantBoundarySummary
  });
  const intentId = stableProofHash({
    sessionId: clientRuntime.sessionId,
    requestId: clientRuntime.requestId,
    handoffTarget,
    route,
    selectedProofIds: proofScope.selectedProofIds,
    unreviewedProofIds: proofScope.unreviewedProofIds,
    tenantBoundaryHash: tenantBoundarySummary.boundaryHash
  });
  const dispatchState = !canContinue
    ? "blocked"
    : acceptance.accepted
      ? "accepted"
      : proofScope.unreviewedProofIds.length > 0
        ? "requires-review"
        : handoffTarget === "proof-export" && providerContracts.handoff.canExportProofBundle
          ? "export-ready"
          : "ready";

  return {
    schema: "aios.tamper-check.workflow-handoff.v1",
    sessionId: clientRuntime.sessionId,
    requestId: clientRuntime.requestId,
    entrypoint: clientRuntime.entrypoint,
    handoffTarget,
    state: dispatchState,
    route,
    returnTo: clientRuntime.navigation.returnTo,
    providerReady,
    title: preview.title,
    tone: preview.tone,
    primaryStepId: firstStep ? firstStep.stepId : null,
    primaryCommand: firstStep ? firstStep.command : null,
    proofScope,
    destinationPayload,
    dispatch: {
      schema: "aios.tamper-check.client-handoff-dispatch.v1",
      intentId,
      dispatchState,
      canContinue,
      target: handoffTarget,
      route,
      method: "client-route-patch",
      blockers: handoffBlockers,
      correlation: {
        sessionId: clientRuntime.sessionId,
        requestId: clientRuntime.requestId,
        providerDestination: providerContracts.handoff.destination,
        proofBundleId: providerContracts.handoff.proofBundleId,
        tenantBoundaryHash: tenantBoundarySummary.boundaryHash
      },
      resumeToken: stableProofHash({
        intentId,
        target: handoffTarget,
        route,
        generatedState: clientReview.state,
        proofIds: proofScope.selectedProofIds
      })
    },
    selectedArtifacts: selectedArtifacts.slice(0, 10).map((record) => ({
      artifactId: record.artifactId,
      status: record.status,
      severity: record.severity,
      proofId: record.proofId,
      checkedAt: record.checkedAt
    })),
    focusedProof: focusedProof ? {
      artifactId: focusedProof.artifactId,
      proofId: focusedProof.proofId,
      status: focusedProof.status,
      severity: focusedProof.severity,
      reason: focusedProof.reason
    } : null,
    clientStatePatch: {
      activeSurface: surfaceId,
      activeRoute: route,
      handoffIntentId: intentId,
      handoffTarget,
      handoffState: dispatchState,
      highlightedProofIds: acceptance.unreviewedProofIds,
      reviewedProofIds: clientRuntime.reviewedProofIds,
      reviewQueueIds: clientReview.reviewQueue.map((item) => item.queueId),
      acceptanceState: clientReview.state,
      validationState: clientReview.validationState,
      liveUpdates: clientRuntime.subscriptions.wantsLiveUpdates,
      providerIds: providerContracts.negotiatedProviderIds
    },
    tenantBoundary: {
      tenantId: tenantBoundarySummary.tenantId,
      workspaceId: tenantBoundarySummary.workspaceId,
      state: tenantBoundarySummary.state,
      isolationKey: tenantBoundarySummary.isolationKey,
      blockedRecordCount: tenantBoundarySummary.counts.blockedRecords
    },
    auditEvent: {
      eventName: "tamper-check.workflow-handoff.prepared",
      actor: clientRuntime.actor,
      tenantId: tenantBoundarySummary.tenantId,
      workspaceId: tenantBoundarySummary.workspaceId,
      boundaryState: tenantBoundarySummary.state,
      sessionId: clientRuntime.sessionId,
      requestId: clientRuntime.requestId,
      target: handoffTarget,
      route,
      intentId,
      dispatchState,
      readinessState: readinessSummary.state,
      acceptanceDecision: acceptance.decision
    }
  };
}

function buildStatePersistenceContract({ persistedState, generatedAt, status, settings, counters, evidence, readinessSummary, acceptance, providerContracts, tenantBoundarySummary }) {
  const latestFlaggedProofIds = evidence
    .filter((record) => record.status !== "clean")
    .map((record) => record.proofId)
    .filter(Boolean);
  const currentFlaggedProofSet = new Set(latestFlaggedProofIds);
  const recoveredUnresolvedProofIds = persistedState.evidenceCursor.unresolvedFlaggedProofIds
    .filter((proofId) => !currentFlaggedProofSet.has(proofId));
  const retainedRecoveredProofIds = persistedState.evidenceCursor.unresolvedFlaggedProofIds
    .filter((proofId) => currentFlaggedProofSet.has(proofId));
  const activeRecoveredCommandReceipts = persistedState.commandReceipts
    .filter((receipt) => receipt.restartAction === "resume-idempotently");
  const retainedCommandReceipts = [
    ...persistedState.commandReceipts
      .filter((receipt) => receipt.restartAction !== "drop-expired-receipt" && receipt.state !== "applied"),
    settings.lifecycle.commandFingerprint && settings.lifecycle.commandAccepted ? {
      receiptId: `tamper-command-receipt:${settings.lifecycle.commandFingerprint}`,
      fingerprint: settings.lifecycle.commandFingerprint,
      command: settings.lifecycle.requestedCommand,
      state: settings.lifecycle.idempotency.replayed ? "applied" : "accepted",
      acceptedAt: generatedAt,
      expiresAt: new Date(Date.parse(generatedAt) + DEFAULT_RETRY_BACKOFF_MINUTES * 60 * 1000).toISOString(),
      actor: settings.lifecycle.request.actor,
      resumeToken: stableProofHash({
        stateId: persistedState.stateId,
        fingerprint: settings.lifecycle.commandFingerprint,
        command: settings.lifecycle.requestedCommand,
        generatedAt
      }),
      lastAttemptAt: settings.lifecycle.commandAppliedAt,
      attemptCount: settings.lifecycle.idempotency.replayed ? 0 : 1,
      resultStatus: status,
      restartAction: settings.lifecycle.idempotency.replayed ? "retain-for-replay-detection" : "resume-idempotently"
    } : null
  ].filter(Boolean);
  const newJournalEntry = settings.lifecycle.requestedCommand && settings.lifecycle.commandFingerprint && !settings.lifecycle.idempotency.replayed
    ? {
      fingerprint: settings.lifecycle.commandFingerprint,
      command: settings.lifecycle.requestedCommand,
      appliedAt: generatedAt,
      actor: "hosted-kernel",
      resultStatus: status
    }
    : null;
  const commandJournal = [
    ...persistedState.commandJournal,
    newJournalEntry
  ].filter(Boolean).slice(-50);
  const priorStableStatus = persistedState.lastStableStatus;
  const stableStatus = ["clean", "review", "attention-required", "provider-contract-blocked", "settings-invalid", "operational-failed", "operational-degraded", "disabled"].includes(status)
    ? status
    : priorStableStatus || status;
  const restartSafeStatus = readinessSummary.state === "blocked"
    ? "restart-blocked"
    : settings.lifecycle.idempotency.replayed
      ? "restart-replayed-command"
      : persistedState.recoveryState === "stale"
        ? "restart-recovered-stale"
        : persistedState.loaded
          ? "restart-recovered"
          : "restart-fresh";

  return {
    schema: "aios.tamper-check.state-persistence.v1",
    stateId: persistedState.stateId,
    generatedAt,
    loaded: persistedState.loaded,
    recoveryState: persistedState.recoveryState,
    restartSafeStatus,
    recoveryProblems: persistedState.recoveryProblems,
    checkpoint: {
      stateId: persistedState.stateId,
      surfaceId,
      generatedAt,
      status,
      lastStableStatus: stableStatus,
      restartSafeStatus,
      readinessState: readinessSummary.state,
      acceptanceDecision: acceptance.decision,
      providerContractState: providerContracts.handoff.state,
      providerWritebackState: providerContracts.handoff.writebackState,
      providerAcknowledgementCount: providerContracts.handoff.correlation.acknowledgementCount,
      providerDeliveredProofIds: providerContracts.handoff.correlation.deliveredProofIds,
      providerFailedAcknowledgementIds: providerContracts.handoff.correlation.failedAcknowledgementIds,
      tenantBoundaryState: tenantBoundarySummary.state,
      tenantId: tenantBoundarySummary.tenantId,
      workspaceId: tenantBoundarySummary.workspaceId,
      boundaryHash: tenantBoundarySummary.boundaryHash,
      schedule: {
        mode: settings.schedule.mode,
        intervalMinutes: settings.schedule.intervalMinutes,
        paused: settings.schedule.mode === "paused",
        lastRunAt: settings.schedule.lastRunAt,
        nextRunAt: settings.schedule.nextRunAt
      },
      counters: {
        total: counters.total,
        clean: counters.clean,
        suspect: counters.suspect,
        tampered: counters.tampered,
        quarantined: counters.quarantined,
        digestMismatches: counters.digestMismatches
      },
      latestFlaggedProofIds,
      recoveredUnresolvedProofIds,
      retainedRecoveredProofIds,
      evidenceCursor: {
        priorCursorHash: persistedState.evidenceCursor.cursorHash,
        currentCursorHash: stableProofHash({
          status,
          latestFlaggedProofIds,
          deliveredProofIds: providerContracts.handoff.correlation.deliveredProofIds,
          failedAcknowledgementIds: providerContracts.handoff.correlation.failedAcknowledgementIds,
          counters: {
            total: counters.total,
            digestMismatches: counters.digestMismatches
          }
        }),
        recoveredFlaggedProofCount: persistedState.evidenceCursor.unresolvedFlaggedProofIds.length,
        staleRecoveredProofCount: recoveredUnresolvedProofIds.length,
        retainedRecoveredProofCount: retainedRecoveredProofIds.length
      },
      commandReceipts: retainedCommandReceipts.slice(-50),
      commandJournal
    },
    writePolicy: {
      idempotencyKey: settings.lifecycle.commandFingerprint || `${surfaceId}:${generatedAt}`,
      compareAndSwapFrom: persistedState.loaded ? persistedState.lastGeneratedAt : null,
      expectedPriorCursorHash: persistedState.loaded ? persistedState.evidenceCursor.cursorHash : null,
      safeToPersist: settings.validation.every((entry) => entry.severity !== "critical")
        && tenantBoundarySummary.state !== "blocked"
        && !activeRecoveredCommandReceipts.some((receipt) => receipt.command !== settings.lifecycle.requestedCommand && receipt.state === "applying"),
      reason: settings.validation.some((entry) => entry.severity === "critical")
        ? "settings-validation-failed"
        : tenantBoundarySummary.state === "blocked"
          ? "tenant-boundary-blocked"
          : activeRecoveredCommandReceipts.some((receipt) => receipt.command !== settings.lifecycle.requestedCommand && receipt.state === "applying")
            ? "recovered-command-still-applying"
            : settings.lifecycle.idempotency.replayed
              ? "command-replay-no-new-mutation"
              : "checkpoint-ready",
      dropReceiptFingerprints: persistedState.commandReceipts
        .filter((receipt) => receipt.restartAction === "drop-expired-receipt" || receipt.state === "applied")
        .map((receipt) => receipt.fingerprint),
      retainReceiptFingerprints: retainedCommandReceipts.map((receipt) => receipt.fingerprint)
    },
    recoveryHints: {
      useLastStableStatus: persistedState.recoveryState === "stale" || persistedState.recoveryState === "recovered",
      lastStableStatus: priorStableStatus,
      replayedCommandFingerprint: settings.lifecycle.idempotency.replayed ? settings.lifecycle.commandFingerprint : null,
      missingEvidenceAfterRecovery: persistedState.loaded && persistedState.counters.total > 0 && counters.total === 0,
      restartRecoveryPlan: persistedState.restartRecoveryPlan,
      activeRecoveredCommandFingerprints: activeRecoveredCommandReceipts.map((receipt) => receipt.fingerprint),
      resumeProviderHandoffProofIds: retainedRecoveredProofIds,
      staleRecoveredProofIds: recoveredUnresolvedProofIds,
      priorCursorHash: persistedState.evidenceCursor.cursorHash
    }
  };
}

export function describeTamperCheckSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const generatedAt = asIsoTimestamp(now, new Date().toISOString());
  const retentionLimit = clampRetentionLimit(input.retentionLimit);
  const persistedState = normalizePersistedState(input, generatedAt);
  const tenantBoundary = normalizeTenantBoundary(input, generatedAt);
  const workspaceScopePolicy = normalizeWorkspaceScopePolicy(input, tenantBoundary, generatedAt);
  const settings = normalizeSettings(input, generatedAt, persistedState, tenantBoundary);
  const evidence = Array.isArray(input.evidence)
    ? input.evidence.map((record, index) => normalizeEvidenceRecord(record, index, generatedAt, tenantBoundary, workspaceScopePolicy))
    : [];
  const counters = summarizeEvidence(evidence);
  const tenantBoundarySummary = summarizeTenantBoundary(tenantBoundary, evidence, generatedAt, workspaceScopePolicy);
  const history = normalizeHistorySnapshots(input.history, generatedAt, retentionLimit);
  const timeline = buildTimeline(evidence, history, generatedAt);
  const exportSummary = buildExportSummary({ generatedAt, records: evidence, counters, history, timeline });
  const analyticsReport = buildAnalyticsReportState({ generatedAt, counters, history, timeline, records: evidence, settings });
  const controls = buildLifecycleControls({ settings, counters, evidence, generatedAt });
  const providerContracts = normalizeProviderContracts(input, settings, counters, evidence, generatedAt);
  const validationSummary = buildValidationSummary({ settings, counters, providerContracts, tenantBoundarySummary });
  const readinessSummary = buildReadinessSummary({ settings, counters, providerContracts, validationSummary, tenantBoundarySummary });
  const preview = buildUserPreview({ generatedAt, settings, counters, evidence, controls, readinessSummary });
  const acceptance = buildAcceptanceContract({ input, generatedAt, evidence, controls, readinessSummary, validationSummary });
  const clientReview = buildClientReviewContract({
    generatedAt,
    preview,
    acceptance,
    validationSummary,
    readinessSummary,
    evidence,
    controls,
    tenantBoundarySummary,
    providerContracts
  });
  const proofLedger = buildProofLedger({
    generatedAt,
    records: evidence,
    counters,
    settings,
    providerContracts,
    readinessSummary,
    acceptance,
    tenantBoundarySummary
  });
  const exportDelivery = buildExportDeliveryState({
    input,
    generatedAt,
    records: evidence,
    counters,
    history,
    timeline,
    providerContracts,
    readinessSummary,
    acceptance,
    analyticsReport,
    tenantBoundarySummary
  });
  const nextSteps = buildExplainableNextSteps({ controls, readinessSummary, acceptanceContract: acceptance, providerContracts, tenantBoundarySummary });
  const previewDecision = buildPreviewDecisionContract({
    generatedAt,
    preview,
    validationSummary,
    readinessSummary,
    acceptance,
    nextSteps,
    clientReview,
    providerContracts,
    tenantBoundarySummary
  });
  const clientRuntime = normalizeClientRuntimeState(input, generatedAt);
  const workflowHandoff = buildClientWorkflowHandoff({ clientRuntime, providerContracts, nextSteps, acceptance, readinessSummary, preview, clientReview, evidence, tenantBoundarySummary });
  const operationalHealth = buildOperationalHealth({
    input,
    generatedAt,
    settings,
    counters,
    providerContracts,
    validationSummary,
    persistedState,
    controls,
    tenantBoundarySummary
  });
  const hasCriticalFindings = counters.critical > 0 || counters.tampered > 0 || counters.quarantined > 0;
  const hasSettingsErrors = settings.validation.some((entry) => entry.severity === "critical");
  const hasProviderBlocker = providerContracts.handoff.state === "blocked";
  const hasTenantBoundaryBlocker = tenantBoundarySummary.state === "blocked";
  const hasOperationalFailure = operationalHealth.state === "failed";
  const hasOperationalDegradation = operationalHealth.state === "degraded";
  const status = !settings.enabled
    ? "disabled"
    : hasSettingsErrors
      ? "settings-invalid"
      : hasOperationalFailure
        ? "operational-failed"
        : hasTenantBoundaryBlocker
          ? "tenant-boundary-blocked"
        : hasProviderBlocker
          ? "provider-contract-blocked"
          : hasCriticalFindings
            ? "attention-required"
            : hasOperationalDegradation
              ? "operational-degraded"
              : counters.warning > 0
                ? "review"
                : "clean";
  const statePersistence = buildStatePersistenceContract({
    persistedState,
    generatedAt,
    status,
    settings,
    counters,
    evidence,
    readinessSummary,
    acceptance,
    providerContracts,
    tenantBoundarySummary
  });

  return {
    ok: settings.enabled && !hasCriticalFindings && !hasSettingsErrors && !hasProviderBlocker && !hasTenantBoundaryBlocker && operationalHealth.state === "healthy",
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'hosted-kernel artifact filesystem tamper-check report v1',
    status,
    settings,
    statePersistence,
    controls,
    preview,
    previewDecision,
    clientReview,
    validationSummary,
    operationalHealth,
    readinessSummary,
    acceptance,
    nextSteps,
    clientRuntime,
    workflowHandoff,
    analytics: {
      counters,
      report: analyticsReport,
      exportDeliveryState: exportDelivery.state,
      exportManifestCount: exportDelivery.manifests.length,
      retentionLimit,
      historyDepth: history.length,
      cleanRatio: counters.total === 0 ? 1 : counters.clean / counters.total,
      flaggedRatio: counters.total === 0 ? 0 : (counters.suspect + counters.tampered + counters.quarantined) / counters.total,
      scheduleMode: settings.schedule.mode,
      nextActionId: controls.nextAction.actionId,
      readinessState: readinessSummary.state,
      acceptanceState: acceptance.accepted ? "accepted" : acceptance.decision,
      providerContractState: providerContracts.handoff.state,
      providerWritebackState: providerContracts.handoff.writebackState,
      providerAcknowledgementCount: providerContracts.handoff.correlation.acknowledgementCount,
      providerDeliveredProofCount: providerContracts.handoff.correlation.deliveredProofIds.length,
      negotiatedProviderCount: providerContracts.negotiatedProviderIds.length,
      clientEntrypoint: clientRuntime.entrypoint,
      workflowHandoffTarget: workflowHandoff.handoffTarget,
      workflowHandoffState: workflowHandoff.state,
      clientReviewState: clientReview.state,
      clientReviewQueueCount: clientReview.reviewQueue.length,
      clientReviewPrimaryActionId: clientReview.actionBar.primary.actionId,
      previewDecisionState: previewDecision.state,
      previewDecisionHash: previewDecision.decisionHash,
      previewAcceptReady: previewDecision.acceptReady,
      previewFailedCriteriaCount: previewDecision.failedCriteria.length,
      tenantBoundaryState: tenantBoundarySummary.state,
      tenantBoundaryBlockedRecords: tenantBoundarySummary.counts.blockedRecords,
      tenantBoundaryPathHeldRecords: tenantBoundarySummary.counts.pathHeldRecords,
      workspaceScopeMode: tenantBoundarySummary.workspaceScopePolicy.mode,
      workspaceScopePolicyHash: tenantBoundarySummary.workspaceScopePolicy.policyHash,
      operationalHealthState: operationalHealth.state,
      operationalFailureCount: operationalHealth.failureCount,
      degradedMode: operationalHealth.degradedMode,
      retryBackoffMinutes: operationalHealth.retryPolicy.backoffMinutes,
      retryAfter: operationalHealth.retryPolicy.retryAfter,
      stateRecoveryState: statePersistence.recoveryState,
      restartSafeStatus: statePersistence.restartSafeStatus,
      commandReplay: settings.lifecycle.idempotency.replayed,
      proofLedgerState: proofLedger.integrityState,
      proofLedgerEntryCount: proofLedger.entryCount,
      proofLedgerFinalChainHash: proofLedger.finalChainHash
    },
    providerContracts,
    tenantBoundary: tenantBoundarySummary,
    evidence,
    history,
    timeline,
    reportingState: analyticsReport,
    exportSummary: {
      ...exportSummary,
      delivery: exportDelivery,
      proofLedgerManifest: {
        ledgerId: proofLedger.ledgerId,
        entryCount: proofLedger.entryCount,
        finalChainHash: proofLedger.finalChainHash,
        integrityState: proofLedger.integrityState,
        providerHandoffState: proofLedger.providerHandoff.state
      }
    },
    proof: {
      proofCount: evidence.filter((record) => record.proofId).length,
      digestMismatchCount: counters.digestMismatches,
      criticalArtifactIds: evidence.filter((record) => record.severity === "critical").map((record) => record.artifactId),
      ledger: proofLedger,
      auditEvents: [
        {
          eventName: "tamper-check.proof-ledger.generated",
          generatedAt,
          ledgerId: proofLedger.ledgerId,
          entryCount: proofLedger.entryCount,
          finalChainHash: proofLedger.finalChainHash,
          integrityState: proofLedger.integrityState,
          tenantBoundaryState: tenantBoundarySummary.state,
          tenantId: tenantBoundarySummary.tenantId,
          workspaceId: tenantBoundarySummary.workspaceId
        },
        {
          eventName: "tamper-check.proof-ledger.provider-handoff-evaluated",
          generatedAt,
          ledgerId: proofLedger.ledgerId,
          providerState: proofLedger.providerHandoff.state,
          providerWritebackState: proofLedger.providerHandoff.writebackState,
          providerIds: proofLedger.providerHandoff.negotiatedProviderIds,
          alertProofIds: proofLedger.providerHandoff.alertProofIds,
          deliveredProofIds: proofLedger.providerHandoff.deliveredProofIds,
          failedAcknowledgementIds: proofLedger.providerHandoff.failedAcknowledgementIds,
          boundaryHash: tenantBoundarySummary.boundaryHash
        },
        tenantBoundarySummary.boundaryHold.auditEvent
      ].filter(Boolean)
    },
    routes: {
      report: `/kernel/${surfaceGroup}/${surfaceName}/report`,
      export: `/kernel/${surfaceGroup}/${surfaceName}/export`,
      timeline: `/kernel/${surfaceGroup}/${surfaceName}/timeline`,
      settings: `/kernel/${surfaceGroup}/${surfaceName}/settings`,
      lifecycle: `/kernel/${surfaceGroup}/${surfaceName}/lifecycle`,
      providerContracts: `/kernel/${surfaceGroup}/${surfaceName}/providers`,
      handoff: `/kernel/${surfaceGroup}/${surfaceName}/handoff`,
      preview: `/kernel/${surfaceGroup}/${surfaceName}/preview`,
      acceptance: `/kernel/${surfaceGroup}/${surfaceName}/acceptance`,
      readiness: `/kernel/${surfaceGroup}/${surfaceName}/readiness`,
      validation: `/kernel/${surfaceGroup}/${surfaceName}/validation`,
      previewDecision: `/kernel/${surfaceGroup}/${surfaceName}/preview#decision`,
      clientReview: `/kernel/${surfaceGroup}/${surfaceName}/review`,
      operationalHealth: `/kernel/${surfaceGroup}/${surfaceName}/health`,
      nextSteps: `/kernel/${surfaceGroup}/${surfaceName}/next-steps`,
      workflowHandoff: workflowHandoff.route
      ,
      boundary: `/kernel/${surfaceGroup}/${surfaceName}/boundary`
    }
  };
}

export default describeTamperCheckSurface;
