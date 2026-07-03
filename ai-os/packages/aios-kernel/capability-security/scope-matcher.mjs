export const surfaceId = "aios_capability-security_scope-matcher_020";
export const surfaceGroup = "capability-security";
export const surfaceName = "scope-matcher";

const DEFAULT_RETRY_POLICY = Object.freeze({
  maxAttempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 4_000,
  jitterRatio: 0.2
});

const TRANSIENT_FAILURE_CODES = new Set([
  "scope_inventory_unavailable",
  "capability_registry_timeout",
  "policy_snapshot_stale"
]);

const LIFECYCLE_COMMANDS = new Set(["evaluate", "enable", "disable", "pause", "resume", "rotate-proof", "schedule"]);
const SCHEDULING_MODES = new Set(["manual", "interval", "event"]);
const PROVIDER_CONTRACT_STATUSES = new Set(["active", "degraded", "disabled", "revoked"]);
const SYNC_STATES = new Set(["current", "stale", "pending", "failed", "unknown"]);
const HANDOFF_STATES = new Set(["ready", "pending", "blocked", "not_required"]);
const CLIENT_RUNTIME_STATES = new Set(["attached", "background", "stale", "offline", "unknown"]);
const CLIENT_WORKFLOW_STATES = new Set(["interactive", "headless", "deferred", "unknown"]);
const PERSISTED_MATCHER_STATES = new Set(["empty", "applied", "applying", "recovered", "recovering", "failed"]);
const PERSISTED_COMMAND_STATES = new Set(["prepared", "applying", "applied", "replayed", "recovering", "failed", "rejected"]);
const OPERATIONAL_HEALTH_STATES = new Set(["healthy", "degraded", "failing", "offline", "maintenance", "unknown"]);
const OPERATIONAL_MODES = new Set(["normal", "degraded", "read_only", "disabled"]);
const OPERATIONAL_FAILURE_STATES = new Set(["clear", "degraded", "retrying", "escalated", "blocked"]);
const LIFECYCLE_TARGET_STATES = new Set(["enabled", "disabled", "paused", "proof_rotation_pending", "schedule_pending"]);
const DEPENDENCY_HEALTH_STATES = new Set(["healthy", "degraded", "failing", "offline", "unknown"]);
const DEPENDENCY_INCIDENT_SEVERITIES = new Set(["info", "warning", "error", "critical"]);
const CIRCUIT_BREAKER_STATES = new Set(["closed", "half_open", "open"]);
const RESERVED_SCOPE_BOUNDARY_KEYS = new Set(["tenant", "workspace", "org", "organization", "account"]);
const PROVIDER_READINESS_STATES = new Set(["ready", "warning", "blocked"]);
const PREVIEW_READINESS_STATES = new Set(["ready_for_acceptance", "ready_with_warnings", "needs_action", "blocked"]);
const PREVIEW_ACCEPTANCE_STATES = new Set(["not_requested", "accepted", "pending_acknowledgement", "rejected", "blocked"]);
const CLIENT_HANDOFF_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const CLIENT_ADOPTION_ACTIONS = new Set([
  "refresh_scope_snapshot",
  "open_provider_handoff",
  "request_security_boundary_update",
  "recover_operational_health",
  "resume_lifecycle",
  "acknowledge_denied_scopes"
]);
const BLOCKING_PROVIDER_READINESS_REASONS = new Set([
  "provider_contract_required",
  "provider_contract_unusable",
  "provider_contract_current_sync_required",
  "provider_contract_sync_failed",
  "provider_contract_sync_lag_exceeded",
  "provider_contract_proof_missing",
  "provider_contract_required_scopes_missing"
]);

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function normalizeScope(scope) {
  if (typeof scope !== "string") return "";
  return scope.trim().toLowerCase().replace(/\s+/g, ":");
}

function normalizeIdentity(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim().toLowerCase();
  return normalized || null;
}

function uniqueNormalized(values) {
  return Array.from(new Set(asArray(values).map(normalizeScope).filter(Boolean)));
}

function normalizeCapabilityClaim(claim) {
  if (typeof claim === "string") {
    return { id: claim, scopes: [claim], status: "active" };
  }

  if (!claim || typeof claim !== "object") {
    return { id: "invalid-claim", scopes: [], status: "invalid" };
  }

  const id = String(claim.id || claim.capability || claim.name || "unnamed-capability");
  return {
    id,
    status: claim.status === "disabled" || claim.status === "degraded" ? claim.status : "active",
    scopes: asArray(claim.scopes || claim.scope).map(normalizeScope).filter(Boolean),
    proof: claim.proof || claim.receipt || null,
    tenantId: normalizeIdentity(claim.tenantId || claim.tenant || claim.accountId),
    workspaceId: normalizeIdentity(claim.workspaceId || claim.workspace || claim.projectId)
  };
}

function normalizeProviderContract(contract, index) {
  if (!contract || typeof contract !== "object") {
    return {
      id: `invalid-provider-contract-${index}`,
      providerId: "unknown-provider",
      capabilityId: null,
      status: "revoked",
      supportedScopes: [],
      requiredScopes: [],
      sync: { state: "unknown", cursor: null, updatedAt: null, lagMs: null },
      handoff: { state: "blocked", target: null, mode: "none" }
    };
  }

  const rawStatus = String(contract.status || contract.state || "active").trim().toLowerCase();
  const rawSync = contract.sync && typeof contract.sync === "object" ? contract.sync : {};
  const rawHandoff = contract.handoff && typeof contract.handoff === "object" ? contract.handoff : {};
  const syncState = String(rawSync.state || contract.syncState || "unknown").trim().toLowerCase();
  const handoffState = String(rawHandoff.state || contract.handoffState || "not_required").trim().toLowerCase();

  return {
    id: String(contract.id || contract.contractId || `provider-contract-${index}`),
    providerId: String(contract.providerId || contract.provider || contract.service || contract.id || `provider-${index}`),
    capabilityId: contract.capabilityId || contract.capability || null,
    version: String(contract.version || contract.contractVersion || "1"),
    status: PROVIDER_CONTRACT_STATUSES.has(rawStatus) ? rawStatus : "revoked",
    supportedScopes: asArray(contract.supportedScopes || contract.scopes || contract.offeredScopes)
      .map(normalizeScope)
      .filter(Boolean),
    requiredScopes: asArray(contract.requiredScopes || contract.requires)
      .map(normalizeScope)
      .filter(Boolean),
    proof: normalizeProofReceipt(contract.proof || contract.receipt, `${contract.id || contract.contractId || `provider-contract-${index}`}:proof`),
    sync: {
      state: SYNC_STATES.has(syncState) ? syncState : "unknown",
      cursor: rawSync.cursor || contract.syncCursor || null,
      updatedAt: rawSync.updatedAt || contract.syncedAt || null,
      lagMs: nonNegativeInteger(rawSync.lagMs ?? contract.syncLagMs)
    },
    handoff: {
      state: HANDOFF_STATES.has(handoffState) ? handoffState : "not_required",
      target: rawHandoff.target || contract.handoffTarget || null,
      mode: rawHandoff.mode || contract.handoffMode || "none"
    },
    owner: contract.owner || contract.team || null
  };
}

function normalizeProviderContracts(input, capabilityClaims) {
  const explicitContracts = asArray(input.providerContracts || input.serviceContracts || input.integrationProviders);
  if (explicitContracts.length > 0) {
    return explicitContracts.map(normalizeProviderContract);
  }

  return capabilityClaims
    .filter((claim) => claim.id && claim.status !== "invalid")
    .map((claim, index) => normalizeProviderContract({
      id: `${claim.id}:implicit-contract`,
      providerId: claim.id,
      capabilityId: claim.id,
      status: claim.status,
      supportedScopes: claim.scopes,
      sync: {
        state: claim.proof ? "current" : "unknown",
        cursor: claim.proof?.cursor || null,
        updatedAt: claim.proof?.generatedAt || claim.proof?.timestamp || null
      },
      handoff: {
        state: claim.status === "active" ? "not_required" : "pending",
        target: claim.id,
        mode: "capability-registry"
      }
    }, index));
}

function normalizeProviderReadinessPolicy(input) {
  const source = input.providerReadiness && typeof input.providerReadiness === "object"
    ? input.providerReadiness
    : input.providerPolicy && typeof input.providerPolicy === "object"
      ? input.providerPolicy
      : {};

  return {
    contract: "hosted-kernel.scope-matcher.provider-readiness-policy.v1",
    requireProviderContract: source.requireProviderContract === true || input.requireProviderContract === true,
    requireCurrentSync: source.requireCurrentSync === true || input.requireCurrentProviderSync === true,
    requireProofReceipt: source.requireProofReceipt === true || input.requireProviderProof === true,
    allowDegradedContract: source.allowDegradedContract === true || input.allowDegradedProviderContracts === true,
    maxSyncLagMs: nonNegativeInteger(source.maxSyncLagMs ?? input.maxProviderSyncLagMs),
    supplied: Object.keys(source).length > 0 ||
      input.requireProviderContract === true ||
      input.requireCurrentProviderSync === true ||
      input.requireProviderProof === true
  };
}

function normalizeProofReceipt(proof, fallbackId) {
  if (!proof || typeof proof !== "object") {
    return null;
  }

  return {
    proofId: String(proof.proofId || proof.id || proof.receiptId || fallbackId),
    generatedAt: proof.generatedAt || proof.timestamp || proof.issuedAt || null,
    cursor: proof.cursor || proof.checkpoint || null,
    issuer: proof.issuer || proof.providerId || proof.service || null,
    signature: proof.signature || proof.digest || proof.hash || null
  };
}

function readinessStateFromReasons(reasons) {
  if (reasons.some((reason) => BLOCKING_PROVIDER_READINESS_REASONS.has(reason))) {
    return "blocked";
  }
  if (reasons.length > 0) {
    return "warning";
  }
  return "ready";
}

function buildProviderReadiness({
  requestedScopes,
  providerContracts,
  capabilityClaims,
  policy,
  now
}) {
  const claimProofById = new Map(capabilityClaims.map((claim) => [
    claim.id,
    normalizeProofReceipt(claim.proof, `${claim.id}:claim-proof`)
  ]));
  const evaluatedScopes = requestedScopes.map((requestedScope) => {
    const matchingContracts = providerContracts.filter((contract) => (
      contract.supportedScopes.some((grantedScope) => scopeMatches(grantedScope, requestedScope))
    ));
    const contractResults = matchingContracts.map((contract) => {
      const proof = normalizeProofReceipt(contract.proof || contract.receipt, `${contract.id}:contract-proof`) ||
        claimProofById.get(contract.capabilityId || contract.providerId) ||
        null;
      const missingRequiredScopes = contract.requiredScopes.filter((requiredScope) => (
        !requestedScopes.some((scope) => scopeMatches(scope, requiredScope) || scopeMatches(requiredScope, scope))
      ));
      const syncLagExceeded = Number.isFinite(policy.maxSyncLagMs) &&
        Number.isFinite(contract.sync.lagMs) &&
        contract.sync.lagMs > policy.maxSyncLagMs;
      const reasons = [
        contract.status === "disabled" || contract.status === "revoked" ? "provider_contract_unusable" : null,
        contract.status === "degraded" && !policy.allowDegradedContract ? "provider_contract_degraded" : null,
        policy.requireCurrentSync && contract.sync.state !== "current" ? "provider_contract_current_sync_required" : null,
        contract.sync.state === "failed" ? "provider_contract_sync_failed" : null,
        syncLagExceeded ? "provider_contract_sync_lag_exceeded" : null,
        policy.requireProofReceipt && !proof ? "provider_contract_proof_missing" : null,
        missingRequiredScopes.length > 0 ? "provider_contract_required_scopes_missing" : null
      ].filter(Boolean);

      return {
        contractId: contract.id,
        providerId: contract.providerId,
        capabilityId: contract.capabilityId,
        status: contract.status,
        syncState: contract.sync.state,
        syncLagMs: contract.sync.lagMs,
        handoffState: contract.handoff.state,
        requiredScopes: contract.requiredScopes,
        missingRequiredScopes,
        proof,
        state: readinessStateFromReasons(reasons),
        reasons
      };
    });
    const usableContract = contractResults.some((contract) => contract.state !== "blocked");
    const reasons = [
      policy.requireProviderContract && contractResults.length === 0 ? "provider_contract_required" : null,
      ...contractResults.flatMap((contract) => contract.reasons)
    ].filter(Boolean);
    const state = policy.requireProviderContract && contractResults.length === 0
      ? "blocked"
      : contractResults.some((contract) => contract.state === "ready")
        ? "ready"
        : readinessStateFromReasons(reasons);

    return {
      requestedScope,
      state: PROVIDER_READINESS_STATES.has(state) ? state : "blocked",
      accepted: state === "ready" || (!policy.requireProviderContract && contractResults.length === 0),
      usableContract,
      reasons: Array.from(new Set(reasons)),
      contracts: contractResults
    };
  });

  return {
    contract: "hosted-kernel.scope-matcher.provider-readiness.v1",
    generatedAt: now,
    policy,
    evaluatedScopes,
    readyScopeCount: evaluatedScopes.filter((scope) => scope.state === "ready").length,
    warningScopeCount: evaluatedScopes.filter((scope) => scope.state === "warning").length,
    blockedScopeCount: evaluatedScopes.filter((scope) => scope.state === "blocked").length,
    proofReceiptCount: evaluatedScopes.reduce((count, scope) => (
      count + scope.contracts.filter((contract) => contract.proof).length
    ), 0)
  };
}

function validateProviderReadiness({ providerReadiness, retryPolicy, failureCount }) {
  const blockedScopes = providerReadiness.evaluatedScopes.filter((scope) => scope.state === "blocked");
  if (blockedScopes.length === 0) return [];

  return [buildActionableError({
    code: "provider_readiness_blocked",
    message: `${blockedScopes.length} requested scope(s) failed hosted-kernel provider readiness policy.`,
    remediation: "Refresh provider contracts, sync cursors, and proof receipts before accepting the scope decision.",
    retryable: blockedScopes.some((scope) => scope.reasons.some((reason) => (
      reason.includes("sync") || reason.includes("proof") || reason === "provider_contract_required"
    ))),
    retryAfter: retryAfterMs(failureCount, retryPolicy)
  })];
}

function scopeBoundaryParts(scope) {
  const parts = normalizeScope(scope).split(":").filter(Boolean);
  const boundary = {};

  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index];
    if (!RESERVED_SCOPE_BOUNDARY_KEYS.has(key)) continue;
    boundary[key === "org" || key === "organization" || key === "account" ? "tenant" : key] = parts[index + 1];
    index += 1;
  }

  return {
    tenantId: boundary.tenant || null,
    workspaceId: boundary.workspace || null
  };
}

function permissionMatches(grantedPermission, requiredPermission) {
  if (grantedPermission === requiredPermission) return true;
  if (grantedPermission.endsWith(":*")) {
    return requiredPermission.startsWith(grantedPermission.slice(0, -1));
  }
  return grantedPermission === "*";
}

function requiredPermissionsForScope(scope, policy) {
  const explicit = Object.entries(policy.scopePermissions)
    .filter(([pattern]) => scopeMatches(normalizeScope(pattern), scope))
    .flatMap(([, permissions]) => permissions);
  const inferred = policy.inferScopePermissions
    ? [scope.replace(/:[^:]+$/, ":read")]
    : [];
  return uniqueNormalized([...explicit, ...inferred]);
}

function normalizeRolePermissionBindings(source, input) {
  const policy = source.policy && typeof source.policy === "object" ? source.policy : {};
  const objectBindings = Object.entries(policy.rolePermissions || source.rolePermissions || input.rolePermissions || {})
    .map(([role, permissions]) => [normalizeScope(role), uniqueNormalized(permissions)])
    .filter(([role, permissions]) => role && permissions.length > 0);
  const listBindings = asArray(policy.roleBindings || source.roleBindings || input.roleBindings)
    .filter((binding) => binding && typeof binding === "object")
    .map((binding) => [
      normalizeScope(binding.role || binding.roleId || binding.name),
      uniqueNormalized(binding.permissions || binding.grants || binding.scopes)
    ])
    .filter(([role, permissions]) => role && permissions.length > 0);
  const merged = new Map();

  for (const [role, permissions] of [...objectBindings, ...listBindings]) {
    merged.set(role, uniqueNormalized([...(merged.get(role) || []), ...permissions]));
  }

  return Object.fromEntries(merged);
}

function expandActorPermissions({ directPermissions, roles, rolePermissions }) {
  const roleDerivedPermissions = roles.flatMap((role) => rolePermissions[role] || []);
  const missingRoleBindings = roles.filter((role) => !rolePermissions[role]);

  return {
    directPermissions,
    roleDerivedPermissions: uniqueNormalized(roleDerivedPermissions),
    effectivePermissions: uniqueNormalized([...directPermissions, ...roleDerivedPermissions]),
    missingRoleBindings
  };
}

function normalizeBoundaryPartitionList(...values) {
  return Array.from(new Set(values.flatMap((value) => asArray(value).map(normalizeIdentity)).filter(Boolean)));
}

function normalizeSecurityBoundary(input, requestedScopes, now) {
  const request = input.request && typeof input.request === "object" ? input.request : {};
  const source = input.securityBoundary && typeof input.securityBoundary === "object"
    ? input.securityBoundary
    : input.tenantBoundary && typeof input.tenantBoundary === "object"
      ? input.tenantBoundary
      : {};
  const actor = source.actor && typeof source.actor === "object"
    ? source.actor
    : input.actor && typeof input.actor === "object"
      ? input.actor
      : {};
  const policy = source.policy && typeof source.policy === "object" ? source.policy : {};
  const scopeBoundaries = requestedScopes.map((scope) => ({
    requestedScope: scope,
    ...scopeBoundaryParts(scope)
  }));
  const inferredTenantIds = uniqueNormalized(scopeBoundaries.map((item) => item.tenantId));
  const inferredWorkspaceIds = uniqueNormalized(scopeBoundaries.map((item) => item.workspaceId));
  const tenantId = normalizeIdentity(source.tenantId || input.tenantId || request.tenantId || inferredTenantIds[0]);
  const workspaceId = normalizeIdentity(source.workspaceId || input.workspaceId || request.workspaceId || inferredWorkspaceIds[0]);
  const roles = uniqueNormalized(actor.roles || source.roles || input.roles);
  const directPermissions = uniqueNormalized(actor.permissions || source.permissions || input.permissions);
  const rolePermissions = normalizeRolePermissionBindings(source, input);
  const expandedPermissions = expandActorPermissions({ directPermissions, roles, rolePermissions });
  const allowedTenantIds = normalizeBoundaryPartitionList(
    source.allowedTenantIds,
    source.allowedTenants,
    policy.allowedTenantIds,
    policy.allowedTenants
  );
  const allowedWorkspaceIds = normalizeBoundaryPartitionList(
    source.allowedWorkspaceIds,
    source.allowedWorkspaces,
    policy.allowedWorkspaceIds,
    policy.allowedWorkspaces
  );
  const deniedTenantIds = normalizeBoundaryPartitionList(
    source.deniedTenantIds,
    source.deniedTenants,
    policy.deniedTenantIds,
    policy.deniedTenants
  );
  const deniedWorkspaceIds = normalizeBoundaryPartitionList(
    source.deniedWorkspaceIds,
    source.deniedWorkspaces,
    policy.deniedWorkspaceIds,
    policy.deniedWorkspaces
  );

  return {
    contract: "hosted-kernel.scope-matcher.security-boundary.v1",
    generatedAt: now,
    supplied: Object.keys(source).length > 0 || Boolean(input.tenantId || input.workspaceId || actor.id),
    tenantId,
    workspaceId,
    actor: {
      id: normalizeIdentity(actor.id || actor.actorId || source.actorId || input.actorId),
      roles,
      permissions: expandedPermissions.effectivePermissions,
      directPermissions: expandedPermissions.directPermissions,
      roleDerivedPermissions: expandedPermissions.roleDerivedPermissions,
      missingRoleBindings: expandedPermissions.missingRoleBindings
    },
    policy: {
      requireTenant: policy.requireTenant !== false,
      requireWorkspace: policy.requireWorkspace === true,
      requireTenantForWorkspace: policy.requireTenantForWorkspace !== false,
      allowCrossTenant: policy.allowCrossTenant === true || source.allowCrossTenant === true,
      allowCrossWorkspace: policy.allowCrossWorkspace === true || source.allowCrossWorkspace === true,
      inferScopePermissions: policy.inferScopePermissions === true,
      scopePermissions: Object.fromEntries(Object.entries(policy.scopePermissions || {})
        .map(([scope, permissions]) => [normalizeScope(scope), uniqueNormalized(permissions)])
        .filter(([scope, permissions]) => scope && permissions.length > 0)),
      rolePermissions,
      allowedTenantIds,
      allowedWorkspaceIds,
      deniedTenantIds,
      deniedWorkspaceIds,
      requireBoundedWorkspaceGrant: policy.requireBoundedWorkspaceGrant === true
    },
    scopeBoundaries,
    inferredTenantIds,
    inferredWorkspaceIds
  };
}

function evaluateScopeBoundary(requestedScope, securityBoundary) {
  const boundary = scopeBoundaryParts(requestedScope);
  const requiredPermissions = requiredPermissionsForScope(requestedScope, securityBoundary.policy);
  const effectiveTenantId = boundary.tenantId || securityBoundary.tenantId;
  const effectiveWorkspaceId = boundary.workspaceId || securityBoundary.workspaceId;
  const missingPermissions = requiredPermissions.filter((requiredPermission) => (
    !securityBoundary.actor.permissions.some((grantedPermission) => permissionMatches(grantedPermission, requiredPermission))
  ));
  const mismatches = [];

  if (securityBoundary.policy.requireTenant && !securityBoundary.tenantId) {
    mismatches.push("missing_tenant_boundary");
  }

  if (securityBoundary.policy.requireWorkspace && !securityBoundary.workspaceId) {
    mismatches.push("missing_workspace_boundary");
  }

  if (securityBoundary.policy.requireTenantForWorkspace && effectiveWorkspaceId && !effectiveTenantId) {
    mismatches.push("workspace_without_tenant_boundary");
  }

  if (!securityBoundary.policy.allowCrossTenant && boundary.tenantId && securityBoundary.tenantId && boundary.tenantId !== securityBoundary.tenantId) {
    mismatches.push("tenant_scope_mismatch");
  }

  if (!securityBoundary.policy.allowCrossWorkspace && boundary.workspaceId && securityBoundary.workspaceId && boundary.workspaceId !== securityBoundary.workspaceId) {
    mismatches.push("workspace_scope_mismatch");
  }

  if (effectiveTenantId && securityBoundary.policy.deniedTenantIds.includes(effectiveTenantId)) {
    mismatches.push("tenant_boundary_explicitly_denied");
  }

  if (effectiveWorkspaceId && securityBoundary.policy.deniedWorkspaceIds.includes(effectiveWorkspaceId)) {
    mismatches.push("workspace_boundary_explicitly_denied");
  }

  if (
    securityBoundary.policy.allowedTenantIds.length > 0 &&
    (!effectiveTenantId || !securityBoundary.policy.allowedTenantIds.includes(effectiveTenantId))
  ) {
    mismatches.push("tenant_not_in_actor_boundary");
  }

  if (
    securityBoundary.policy.allowedWorkspaceIds.length > 0 &&
    (!effectiveWorkspaceId || !securityBoundary.policy.allowedWorkspaceIds.includes(effectiveWorkspaceId))
  ) {
    mismatches.push("workspace_not_in_actor_boundary");
  }

  if (
    securityBoundary.policy.requireBoundedWorkspaceGrant &&
    effectiveWorkspaceId &&
    securityBoundary.policy.allowedWorkspaceIds.length === 0 &&
    !securityBoundary.policy.allowCrossWorkspace
  ) {
    mismatches.push("workspace_boundary_grant_required");
  }

  if (missingPermissions.length > 0) {
    mismatches.push("missing_actor_permissions");
  }

  return {
    requestedScope,
    tenantId: boundary.tenantId,
    workspaceId: boundary.workspaceId,
    effectiveTenantId,
    effectiveWorkspaceId,
    requiredPermissions,
    missingPermissions,
    directPermissionCount: securityBoundary.actor.directPermissions.length,
    roleDerivedPermissionCount: securityBoundary.actor.roleDerivedPermissions.length,
    rolesWithoutPermissionBindings: securityBoundary.actor.missingRoleBindings,
    allowed: mismatches.length === 0,
    reasons: mismatches
  };
}

function validateSecurityBoundary({ securityBoundary, retryPolicy, failureCount }) {
  const errors = [];

  if (securityBoundary.policy.requireTenant && !securityBoundary.tenantId) {
    errors.push(buildActionableError({
      code: "missing_tenant_boundary",
      message: "Hosted-kernel scope matching requires a tenant boundary for tenant-isolated decisions.",
      remediation: "Pass securityBoundary.tenantId or encode tenant:<id> in requested scopes."
    }));
  }

  if (securityBoundary.policy.requireWorkspace && !securityBoundary.workspaceId) {
    errors.push(buildActionableError({
      code: "missing_workspace_boundary",
      message: "Workspace-scoped matching requires a workspace boundary.",
      remediation: "Pass securityBoundary.workspaceId or encode workspace:<id> in requested scopes."
    }));
  }

  const crossTenantScopes = securityBoundary.scopeBoundaries.filter((item) => (
    item.tenantId && securityBoundary.tenantId && item.tenantId !== securityBoundary.tenantId
  ));
  if (!securityBoundary.policy.allowCrossTenant && crossTenantScopes.length > 0) {
    errors.push(buildActionableError({
      code: "cross_tenant_scope_denied",
      message: `${crossTenantScopes.length} requested scope(s) target a different tenant boundary.`,
      remediation: "Reissue the request in the matching tenant partition or explicitly enable a cross-tenant policy.",
      retryable: true,
      retryAfter: retryAfterMs(failureCount, retryPolicy)
    }));
  }

  const crossWorkspaceScopes = securityBoundary.scopeBoundaries.filter((item) => (
    item.workspaceId && securityBoundary.workspaceId && item.workspaceId !== securityBoundary.workspaceId
  ));
  if (!securityBoundary.policy.allowCrossWorkspace && crossWorkspaceScopes.length > 0) {
    errors.push(buildActionableError({
      code: "cross_workspace_scope_denied",
      message: `${crossWorkspaceScopes.length} requested scope(s) target a different workspace boundary.`,
      remediation: "Reissue the request in the matching workspace partition or explicitly enable a cross-workspace policy.",
      retryable: true,
      retryAfter: retryAfterMs(failureCount, retryPolicy)
    }));
  }

  return errors;
}

function scopesFingerprint(scopes) {
  return scopes.map(normalizeScope).filter(Boolean).sort().join("|");
}

function scopeMatches(grantedScope, requestedScope) {
  if (grantedScope === requestedScope) return true;
  if (grantedScope.endsWith(":*")) {
    return requestedScope.startsWith(grantedScope.slice(0, -1));
  }
  return false;
}

function retryAfterMs(failureCount, retryPolicy) {
  const attempt = Math.max(1, Number(failureCount || 0) + 1);
  const baseDelay = Number(retryPolicy.baseDelayMs || DEFAULT_RETRY_POLICY.baseDelayMs);
  const capped = Math.min(
    Number(retryPolicy.maxDelayMs || DEFAULT_RETRY_POLICY.maxDelayMs),
    baseDelay * 2 ** (attempt - 1)
  );
  const jitter = Math.round(capped * Number(retryPolicy.jitterRatio || 0));
  return capped + jitter;
}

function isoAfterMs(now, delayMs) {
  const parsedNow = Date.parse(now);
  if (!Number.isFinite(parsedNow) || !Number.isFinite(delayMs)) return null;
  return new Date(parsedNow + delayMs).toISOString();
}

function buildActionableError({ code, message, remediation, retryable = false, retryAfter = null }) {
  return {
    code,
    message,
    retryable,
    retryAfterMs: retryAfter,
    remediation
  };
}

function positiveInteger(value, fallback = null) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.floor(number);
}

function nonNegativeInteger(value, fallback = null) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.floor(number);
}

function normalizeLifecycleSettings(input) {
  const source = input.lifecycle && typeof input.lifecycle === "object" ? input.lifecycle : {};
  const settings = input.settings && typeof input.settings === "object" ? input.settings : {};
  const controls = source.controls && typeof source.controls === "object"
    ? source.controls
    : settings.controls && typeof settings.controls === "object"
      ? settings.controls
      : {};
  const rawCommand = String(input.lifecycleCommand || source.command || input.command || "evaluate").trim().toLowerCase();
  const command = LIFECYCLE_COMMANDS.has(rawCommand) ? rawCommand : "evaluate";
  const mutatesLifecycle = command !== "evaluate";
  const proofRequired = source.proofRequired ?? settings.proofRequired ?? input.proofRequired;
  const auditRequired = source.auditRequired ?? settings.auditRequired ?? input.auditRequired;
  const requestedEnabled = source.enabled ?? settings.enabled ?? input.enabled;

  return {
    command,
    commandId: source.commandId || input.commandId || input.idempotencyKey || null,
    requestedCommand: rawCommand,
    enabled: requestedEnabled === undefined ? true : requestedEnabled !== false,
    proofRequired: proofRequired === undefined ? mutatesLifecycle : proofRequired !== false,
    auditRequired: auditRequired === undefined ? mutatesLifecycle : auditRequired !== false,
    minProofEvidence: positiveInteger(source.minProofEvidence ?? settings.minProofEvidence ?? input.minProofEvidence, 1),
    allowDegradedProviders: source.allowDegradedProviders === true || settings.allowDegradedProviders === true,
    controls: {
      requireReasonForMutation: controls.requireReasonForMutation !== false && settings.requireLifecycleReason !== false,
      allowScheduleWhileDisabled: controls.allowScheduleWhileDisabled === true || settings.allowScheduleWhileDisabled === true,
      requireFutureSchedule: controls.requireFutureSchedule !== false,
      requireExplicitEnableForSchedule: controls.requireExplicitEnableForSchedule === true,
      requestedTargetState: String(controls.targetState || source.targetState || "").trim().toLowerCase() || null
    },
    reason: source.reason || input.reason || null,
    actor: source.actor || input.actor || null
  };
}

function normalizeSchedule(input, now) {
  const source = input.schedule && typeof input.schedule === "object" ? input.schedule : {};
  const rawMode = String(source.mode || input.scheduleMode || "manual").trim().toLowerCase();
  const mode = SCHEDULING_MODES.has(rawMode) ? rawMode : "manual";
  const nextRunAt = source.nextRunAt || input.nextRunAt || null;
  const pausedUntil = source.pausedUntil || input.pausedUntil || null;

  return {
    mode,
    requestedMode: rawMode,
    intervalMs: mode === "interval" ? positiveInteger(source.intervalMs ?? input.intervalMs) : null,
    eventName: mode === "event" ? source.eventName || input.eventName || null : null,
    nextRunAt: nextRunAt ? String(nextRunAt) : null,
    pausedUntil: pausedUntil ? String(pausedUntil) : null,
    controller: source.controller || input.scheduler || "hosted-kernel",
    generatedAt: now
  };
}

function normalizeClientRuntime(input, requestedScopes, now) {
  const request = input.request && typeof input.request === "object" ? input.request : {};
  const source = input.clientRuntime && typeof input.clientRuntime === "object"
    ? input.clientRuntime
    : input.clientState && typeof input.clientState === "object"
      ? input.clientState
      : request.clientRuntime && typeof request.clientRuntime === "object"
        ? request.clientRuntime
        : {};
  const rawState = String(source.state || source.connectionState || input.clientStateName || "unknown").trim().toLowerCase();
  const rawWorkflowState = String(source.workflowState || source.mode || input.workflowState || "unknown").trim().toLowerCase();
  const grantedScopes = asArray(source.grantedScopes || source.scopeSnapshot || source.visibleScopes)
    .map(normalizeScope)
    .filter(Boolean);
  const requestedFingerprint = scopesFingerprint(requestedScopes);
  const suppliedFingerprint = source.requestedScopesFingerprint || source.scopeFingerprint || null;
  const snapshotFingerprint = scopesFingerprint(grantedScopes);
  const handoff = source.handoff && typeof source.handoff === "object" ? source.handoff : {};
  const requestContext = source.requestContext && typeof source.requestContext === "object"
    ? source.requestContext
    : request.context && typeof request.context === "object"
      ? request.context
      : {};
  const rawPriority = String(handoff.priority || source.handoffPriority || request.priority || "normal").trim().toLowerCase();
  const acceptedActions = uniqueNormalized(handoff.acceptedActions || source.acceptedHandoffActions || request.acceptedHandoffActions)
    .filter((action) => CLIENT_ADOPTION_ACTIONS.has(action));
  const suppressedActions = uniqueNormalized(handoff.suppressedActions || source.suppressedHandoffActions || request.suppressedHandoffActions)
    .filter((action) => CLIENT_ADOPTION_ACTIONS.has(action));

  return {
    contract: "hosted-kernel.client-runtime-scope-state.v1",
    clientId: String(source.clientId || input.clientId || request.clientId || "anonymous-client"),
    requestId: source.requestId || input.requestId || request.id || request.requestId || null,
    sessionId: source.sessionId || input.sessionId || request.sessionId || null,
    routeId: source.routeId || input.routeId || request.routeId || null,
    workflowId: source.workflowId || input.workflowId || request.workflowId || null,
    idempotencyKey: source.idempotencyKey || input.idempotencyKey || request.idempotencyKey || null,
    state: CLIENT_RUNTIME_STATES.has(rawState) ? rawState : "unknown",
    requestedState: rawState,
    workflowState: CLIENT_WORKFLOW_STATES.has(rawWorkflowState) ? rawWorkflowState : "unknown",
    requestedWorkflowState: rawWorkflowState,
    scopeSnapshot: {
      grantedScopes,
      requestedScopes,
      requestedFingerprint,
      suppliedFingerprint: suppliedFingerprint ? String(suppliedFingerprint) : null,
      grantedFingerprint: snapshotFingerprint,
      generatedAt: source.snapshotGeneratedAt || source.generatedAt || null,
      expiresAt: source.snapshotExpiresAt || source.expiresAt || null
    },
    handoff: {
      channel: handoff.channel || source.handoffChannel || "client-runtime",
      target: handoff.target || source.handoffTarget || null,
      label: handoff.label || source.handoffLabel || "Review capability access",
      returnTo: handoff.returnTo || source.returnTo || request.returnTo || null,
      priority: CLIENT_HANDOFF_PRIORITIES.has(rawPriority) ? rawPriority : "normal",
      requestedPriority: rawPriority,
      acceptedActions,
      suppressedActions,
      requiresUserVisibleHandoff: handoff.requiresUserVisibleHandoff === true ||
        source.requiresUserVisibleHandoff === true ||
        request.requiresUserVisibleHandoff === true
    },
    requestContext: {
      surface: requestContext.surface || request.surface || surfaceId,
      entrypoint: requestContext.entrypoint || request.entrypoint || input.entrypoint || null,
      origin: requestContext.origin || request.origin || input.origin || null,
      correlationId: requestContext.correlationId || request.correlationId || input.correlationId || null,
      locale: requestContext.locale || request.locale || input.locale || null
    },
    receivedAt: now,
    supplied: Object.keys(source).length > 0
  };
}

function validateClientRuntime({ clientRuntime, requestedScopes, retryPolicy, failureCount, now }) {
  const errors = [];
  const snapshot = clientRuntime.scopeSnapshot;
  const staleSnapshot = snapshot.expiresAt && Date.parse(snapshot.expiresAt) <= Date.parse(now);
  const missingFromSnapshot = snapshot.grantedScopes.length > 0
    ? requestedScopes.filter((requestedScope) => !snapshot.grantedScopes.some((grantedScope) => scopeMatches(grantedScope, requestedScope)))
    : [];

  if (!CLIENT_RUNTIME_STATES.has(clientRuntime.requestedState)) {
    errors.push(buildActionableError({
      code: "unsupported_client_runtime_state",
      message: `Client runtime state ${clientRuntime.requestedState} is not supported by the scope matcher.`,
      remediation: `Use one of: ${Array.from(CLIENT_RUNTIME_STATES).join(", ")}.`
    }));
  }

  if (!CLIENT_WORKFLOW_STATES.has(clientRuntime.requestedWorkflowState)) {
    errors.push(buildActionableError({
      code: "unsupported_client_workflow_state",
      message: `Client workflow state ${clientRuntime.requestedWorkflowState} is not supported by the scope matcher.`,
      remediation: `Use one of: ${Array.from(CLIENT_WORKFLOW_STATES).join(", ")}.`
    }));
  }

  if (!CLIENT_HANDOFF_PRIORITIES.has(clientRuntime.handoff.requestedPriority)) {
    errors.push(buildActionableError({
      code: "unsupported_client_handoff_priority",
      message: `Client handoff priority ${clientRuntime.handoff.requestedPriority} is not supported by the scope matcher.`,
      remediation: `Use one of: ${Array.from(CLIENT_HANDOFF_PRIORITIES).join(", ")}.`
    }));
  }

  if (clientRuntime.state === "offline" || clientRuntime.state === "stale" || staleSnapshot) {
    errors.push(buildActionableError({
      code: staleSnapshot ? "client_scope_snapshot_expired" : "client_runtime_not_current",
      message: staleSnapshot
        ? "Client scope snapshot expired before the hosted-kernel decision was evaluated."
        : "Client runtime is not current enough to adopt a hosted-kernel capability decision.",
      remediation: "Refresh client runtime scope state before completing the workflow handoff.",
      retryable: true,
      retryAfter: retryAfterMs(failureCount, retryPolicy)
    }));
  }

  if (snapshot.suppliedFingerprint && snapshot.suppliedFingerprint !== snapshot.requestedFingerprint) {
    errors.push(buildActionableError({
      code: "client_requested_scope_fingerprint_mismatch",
      message: "Client request scope fingerprint does not match the normalized hosted-kernel request.",
      remediation: "Rebuild the client request from the normalized requestedScopes returned by the scope matcher."
    }));
  }

  if (missingFromSnapshot.length > 0) {
    errors.push(buildActionableError({
      code: "client_scope_snapshot_missing_requested_scopes",
      message: `${missingFromSnapshot.length} requested scope(s) are absent from the client runtime scope snapshot.`,
      remediation: "Route the user through capability approval or refresh the client-visible scope snapshot.",
      retryable: true,
      retryAfter: retryAfterMs(failureCount, retryPolicy)
    }));
  }

  return errors;
}

function timestampState(value, now) {
  if (!value) return { supplied: false, valid: true, future: false, epochMs: null };
  const epochMs = Date.parse(value);
  const nowMs = Date.parse(now);
  return {
    supplied: true,
    valid: Number.isFinite(epochMs),
    future: Number.isFinite(epochMs) && Number.isFinite(nowMs) && epochMs > nowMs,
    epochMs: Number.isFinite(epochMs) ? epochMs : null
  };
}

function lifecycleTargetStateForCommand(command, enabled) {
  if (command === "disable") return "disabled";
  if (command === "pause") return "paused";
  if (command === "rotate-proof") return "proof_rotation_pending";
  if (command === "schedule") return "schedule_pending";
  if (command === "enable" || command === "resume") return "enabled";
  return enabled ? "enabled" : "disabled";
}

function buildLifecycleControlPlan({ lifecycle, schedule, now }) {
  const nextRun = timestampState(schedule.nextRunAt, now);
  const pausedUntil = timestampState(schedule.pausedUntil, now);
  const scheduleRequested = schedule.mode !== "manual";
  const derivedTargetState = lifecycleTargetStateForCommand(lifecycle.command, lifecycle.enabled);
  const targetState = lifecycle.controls.requestedTargetState || derivedTargetState;
  const targetStateValid = LIFECYCLE_TARGET_STATES.has(targetState);
  const effectiveEnabled = targetState === "enabled" || targetState === "schedule_pending" || targetState === "proof_rotation_pending";
  const scheduleActive = scheduleRequested && effectiveEnabled && targetState !== "paused";
  const blockers = [
    !targetStateValid ? "unsupported_target_state" : null,
    lifecycle.command === "schedule" && schedule.mode === "manual" ? "schedule_command_requires_schedule_mode" : null,
    scheduleRequested && !effectiveEnabled && !lifecycle.controls.allowScheduleWhileDisabled ? "schedule_requires_enabled_lifecycle" : null,
    lifecycle.controls.requireExplicitEnableForSchedule && scheduleRequested && lifecycle.enabled === false &&
      lifecycle.command !== "enable" && lifecycle.command !== "resume" ? "explicit_enable_required_for_schedule" : null,
    schedule.nextRunAt && !nextRun.valid ? "invalid_next_run_at" : null,
    schedule.pausedUntil && !pausedUntil.valid ? "invalid_paused_until" : null,
    lifecycle.controls.requireFutureSchedule && scheduleRequested && schedule.nextRunAt && !nextRun.future ? "next_run_at_must_be_future" : null
  ].filter(Boolean);
  const nextAction = blockers.length > 0
    ? "fix_lifecycle_controls"
    : targetState === "disabled"
      ? "disable_scope_matching"
      : targetState === "paused"
        ? "pause_scope_matching_until_resume"
        : targetState === "proof_rotation_pending"
          ? "rotate_lifecycle_proof"
          : scheduleActive
            ? "arm_schedule"
            : "evaluate_now";

  return {
    contract: "hosted-kernel.scope-matcher.lifecycle-control-plan.v1",
    generatedAt: now,
    command: lifecycle.command,
    commandId: lifecycle.commandId,
    targetState,
    derivedTargetState,
    targetStateValid,
    effectiveEnabled,
    scheduleRequested,
    scheduleActive,
    scheduleMode: schedule.mode,
    nextRunAt: schedule.nextRunAt,
    pausedUntil: schedule.pausedUntil,
    nextRunAtFuture: nextRun.supplied ? nextRun.future : null,
    pausedUntilFuture: pausedUntil.supplied ? pausedUntil.future : null,
    controls: lifecycle.controls,
    blockers,
    nextAction
  };
}

function validateLifecycleSettings({ lifecycle, schedule, evidence, controlPlan, now }) {
  const errors = [];

  if (!LIFECYCLE_COMMANDS.has(lifecycle.requestedCommand)) {
    errors.push(buildActionableError({
      code: "unsupported_lifecycle_command",
      message: `Lifecycle command ${lifecycle.requestedCommand} is not supported by the scope matcher.`,
      remediation: `Use one of: ${Array.from(LIFECYCLE_COMMANDS).join(", ")}.`
    }));
  }

  if (!SCHEDULING_MODES.has(schedule.requestedMode)) {
    errors.push(buildActionableError({
      code: "unsupported_schedule_mode",
      message: `Schedule mode ${schedule.requestedMode} is not supported by the scope matcher.`,
      remediation: `Use one of: ${Array.from(SCHEDULING_MODES).join(", ")}.`
    }));
  }

  if (schedule.mode === "interval" && !schedule.intervalMs) {
    errors.push(buildActionableError({
      code: "missing_schedule_interval",
      message: "Interval scheduling requires a positive intervalMs value.",
      remediation: "Provide schedule.intervalMs as a positive number of milliseconds."
    }));
  }

  if (schedule.mode === "event" && !schedule.eventName) {
    errors.push(buildActionableError({
      code: "missing_schedule_event",
      message: "Event scheduling requires an eventName.",
      remediation: "Provide schedule.eventName with the hosted-kernel event that should re-run matching."
    }));
  }

  if (lifecycle.controls.requestedTargetState && !controlPlan.targetStateValid) {
    errors.push(buildActionableError({
      code: "unsupported_lifecycle_target_state",
      message: `Lifecycle target state ${lifecycle.controls.requestedTargetState} is not supported by the scope matcher.`,
      remediation: `Use one of: ${Array.from(LIFECYCLE_TARGET_STATES).join(", ")}.`
    }));
  }

  if (lifecycle.command !== "evaluate" && lifecycle.controls.requireReasonForMutation && !lifecycle.reason) {
    errors.push(buildActionableError({
      code: "missing_lifecycle_mutation_reason",
      message: `Lifecycle command ${lifecycle.command} requires a reason for hosted-kernel audit controls.`,
      remediation: "Pass lifecycle.reason with the operational reason for the lifecycle mutation."
    }));
  }

  if (lifecycle.command === "schedule" && schedule.mode === "manual") {
    errors.push(buildActionableError({
      code: "schedule_command_requires_schedule_mode",
      message: "Lifecycle schedule command requires interval or event scheduling mode.",
      remediation: "Set schedule.mode to interval or event before issuing lifecycleCommand=schedule."
    }));
  }

  if (controlPlan.blockers.includes("schedule_requires_enabled_lifecycle")) {
    errors.push(buildActionableError({
      code: "schedule_requires_enabled_lifecycle",
      message: "Scheduling controls cannot be armed while the scope matcher lifecycle is disabled or paused.",
      remediation: "Issue enable or resume before scheduling, or set lifecycle.controls.allowScheduleWhileDisabled when intentionally staging a disabled schedule."
    }));
  }

  if (controlPlan.blockers.includes("explicit_enable_required_for_schedule")) {
    errors.push(buildActionableError({
      code: "explicit_lifecycle_enable_required_for_schedule",
      message: "Scheduling controls require an explicit enable or resume command for this lifecycle policy.",
      remediation: "Send lifecycleCommand=enable or lifecycleCommand=resume with the scheduling request."
    }));
  }

  if (controlPlan.blockers.includes("invalid_next_run_at") || controlPlan.blockers.includes("invalid_paused_until")) {
    errors.push(buildActionableError({
      code: "invalid_lifecycle_schedule_timestamp",
      message: "Lifecycle scheduling controls include an invalid timestamp.",
      remediation: "Pass schedule.nextRunAt and schedule.pausedUntil as ISO-8601 timestamps."
    }));
  }

  if (controlPlan.blockers.includes("next_run_at_must_be_future")) {
    errors.push(buildActionableError({
      code: "lifecycle_schedule_next_run_not_future",
      message: "Lifecycle scheduling controls require nextRunAt to be in the future.",
      remediation: `Choose a schedule.nextRunAt later than ${now}.`
    }));
  }

  if (lifecycle.auditRequired && !lifecycle.actor) {
    errors.push(buildActionableError({
      code: "missing_lifecycle_actor",
      message: "Audited lifecycle commands require an actor.",
      remediation: "Pass lifecycle.actor so enable, disable, pause, resume, and scheduling changes are attributable."
    }));
  }

  if (lifecycle.proofRequired && evidence.length < lifecycle.minProofEvidence) {
    errors.push(buildActionableError({
      code: "insufficient_lifecycle_evidence",
      message: `Lifecycle proof requires at least ${lifecycle.minProofEvidence} evidence item(s).`,
      remediation: "Attach hosted-kernel evidence receipts before applying the lifecycle command."
    }));
  }

  return errors;
}

function normalizeHistorySnapshot(snapshot, index) {
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }

  const generatedAt = String(snapshot.generatedAt || snapshot.timestamp || `history-${index}`);
  const requestedScopes = asArray(snapshot.requestedScopes || snapshot.scopes)
    .map(normalizeScope)
    .filter(Boolean);
  const deniedScopes = asArray(snapshot.deniedScopes || snapshot.denied)
    .map(normalizeScope)
    .filter(Boolean);
  const errorCodes = asArray(snapshot.errorCodes || snapshot.errors)
    .map((error) => typeof error === "string" ? error : error?.code)
    .filter(Boolean)
    .map(String);
  const decision = snapshot.decision === "allow" || snapshot.ok === true
    ? "allow"
    : deniedScopes.length > 0 || snapshot.ok === false
      ? "deny"
      : String(snapshot.decision || "unknown");
  const health = String(snapshot.health || (decision === "allow" ? "healthy" : "degraded"));
  const requestedScopeCount = requestedScopes.length;
  const deniedScopeCount = deniedScopes.length;
  const grantedScopeCount = Math.max(0, requestedScopeCount - deniedScopeCount);

  return {
    generatedAt,
    decision,
    health,
    requestedScopes,
    requestedScopeCount,
    grantedScopeCount,
    deniedScopeCount,
    deniedScopes,
    errorCodes,
    proofId: snapshot.proofId || snapshot.audit?.proofId || null,
    lifecycleCommand: snapshot.lifecycleCommand || snapshot.command || null,
    operationalMode: snapshot.operationalMode || snapshot.mode || null,
    tenantId: normalizeIdentity(snapshot.tenantId || snapshot.securityBoundary?.tenantId),
    workspaceId: normalizeIdentity(snapshot.workspaceId || snapshot.securityBoundary?.workspaceId)
  };
}

function normalizePersistedDecision(decision, index = 0) {
  if (!decision || typeof decision !== "object") {
    return null;
  }

  const generatedAt = decision.generatedAt || decision.updatedAt || decision.timestamp || null;
  const requestedScopes = asArray(decision.requestedScopes || decision.scopes)
    .map(normalizeScope)
    .filter(Boolean);
  const deniedScopes = asArray(decision.deniedScopes || decision.denied)
    .map(normalizeScope)
    .filter(Boolean);
  const rawDecision = String(decision.decision || (deniedScopes.length > 0 ? "deny" : "unknown")).trim().toLowerCase();
  const rawHealth = String(decision.health || decision.status || "unknown").trim().toLowerCase();

  return {
    proofId: decision.proofId || decision.audit?.proofId || `persisted-decision-${index}`,
    commandId: decision.commandId || decision.lifecycleCommandId || decision.idempotencyKey || null,
    commandFingerprint: decision.commandFingerprint || decision.fingerprint || null,
    generatedAt,
    decision: rawDecision === "allow" || rawDecision === "deny" ? rawDecision : "unknown",
    health: ["healthy", "degraded", "failed", "unknown"].includes(rawHealth) ? rawHealth : "unknown",
    requestedScopes,
    requestedFingerprint: decision.requestedFingerprint || scopesFingerprint(requestedScopes),
    deniedScopes,
    lifecycleCommand: decision.lifecycleCommand || decision.command || null,
    sequence: nonNegativeInteger(decision.sequence, index),
    durable: decision.durable !== false,
    recoveryCursor: decision.recoveryCursor || decision.cursor || null
  };
}

function normalizePersistenceJournalEntry(entry, index = 0) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const rawState = String(entry.state || entry.status || "prepared").trim().toLowerCase();
  const requestedScopes = asArray(entry.requestedScopes || entry.scopes)
    .map(normalizeScope)
    .filter(Boolean);

  return {
    entryId: String(entry.entryId || entry.id || `journal-entry-${index}`),
    sequence: nonNegativeInteger(entry.sequence ?? entry.offset, index),
    state: PERSISTED_COMMAND_STATES.has(rawState) ? rawState : "failed",
    requestedState: rawState,
    commandId: entry.commandId || entry.lifecycleCommandId || entry.idempotencyKey || null,
    commandFingerprint: entry.commandFingerprint || entry.fingerprint || null,
    lifecycleCommand: entry.lifecycleCommand || entry.command || null,
    requestedScopes,
    requestedFingerprint: entry.requestedFingerprint || scopesFingerprint(requestedScopes),
    proofId: entry.proofId || entry.audit?.proofId || null,
    recoveryCursor: entry.recoveryCursor || entry.cursor || entry.proofId || null,
    startedAt: entry.startedAt || entry.createdAt || entry.timestamp || null,
    updatedAt: entry.updatedAt || entry.committedAt || null,
    errorCode: entry.errorCode || entry.error?.code || null,
    durable: entry.durable !== false
  };
}

function normalizePersistenceLease(source, now) {
  const lease = source.lease && typeof source.lease === "object" ? source.lease : {};
  const leaseId = source.lockId || source.leaseId || lease.lockId || lease.id || null;
  const expiresAt = lease.expiresAt || source.lockExpiresAt || source.leaseExpiresAt || null;
  const expiresAtMs = Date.parse(expiresAt);
  const nowMs = Date.parse(now);

  return {
    leaseId,
    holder: source.lockedBy || source.owner || lease.holder || lease.owner || null,
    acquiredAt: lease.acquiredAt || source.lockedAt || source.leaseAcquiredAt || null,
    expiresAt,
    expired: Boolean(expiresAt && Number.isFinite(expiresAtMs) && Number.isFinite(nowMs) && expiresAtMs <= nowMs),
    fencingToken: source.fencingToken || lease.fencingToken || source.revision || null
  };
}

function normalizePersistedMatcherState(input, requestedScopes, now) {
  const source = input.persistedState && typeof input.persistedState === "object"
    ? input.persistedState
    : input.stateSnapshot && typeof input.stateSnapshot === "object"
      ? input.stateSnapshot
      : input.checkpoint && typeof input.checkpoint === "object"
        ? input.checkpoint
        : {};
  const rawState = String(source.state || source.status || (Object.keys(source).length > 0 ? "applied" : "empty")).trim().toLowerCase();
  const decisions = asArray(source.decisions || source.history || source.previousDecisions)
    .map(normalizePersistedDecision)
    .filter(Boolean)
    .sort((left, right) => left.sequence - right.sequence);
  const journal = asArray(source.journal || source.commandJournal || source.pendingCommands)
    .map(normalizePersistenceJournalEntry)
    .filter(Boolean)
    .sort((left, right) => left.sequence - right.sequence);
  const lastDecision = normalizePersistedDecision(source.lastDecision || source.currentDecision, decisions.length)
    || decisions.at(-1)
    || null;
  const requestedFingerprint = scopesFingerprint(requestedScopes);
  const staleForRequest = Boolean(lastDecision?.requestedFingerprint && lastDecision.requestedFingerprint !== requestedFingerprint);
  const inFlightCommands = journal.filter((entry) => (
    entry.state === "prepared" ||
    entry.state === "applying" ||
    entry.state === "recovering"
  ));
  const failedCommands = journal.filter((entry) => entry.state === "failed");
  const lease = normalizePersistenceLease(source, now);

  return {
    contract: "hosted-kernel.scope-matcher.persisted-state.v1",
    supplied: Object.keys(source).length > 0,
    state: PERSISTED_MATCHER_STATES.has(rawState) ? rawState : "failed",
    requestedState: rawState,
    storeId: source.storeId || source.partition || "capability-security/scope-matcher",
    checkpointId: source.checkpointId || source.id || null,
    revision: nonNegativeInteger(source.revision ?? source.version, 0),
    recoveryCursor: source.recoveryCursor || source.cursor || lastDecision?.recoveryCursor || null,
    lockId: lease.leaseId,
    lockedBy: lease.holder,
    lease,
    lastAppliedCommandId: source.lastAppliedCommandId || lastDecision?.commandId || null,
    lastAppliedFingerprint: source.lastAppliedFingerprint || lastDecision?.commandFingerprint || null,
    lastDecision,
    decisions,
    journal,
    inFlightCommands,
    failedCommands,
    requestedFingerprint,
    staleForRequest,
    recoveredAt: source.recoveredAt || null
  };
}

function normalizeOperationalDependency(dependency, index) {
  if (!dependency || typeof dependency !== "object") {
    return {
      id: `invalid-dependency-${index}`,
      state: "failing",
      requestedState: "invalid",
      required: true,
      latencyMs: null,
      lastOkAt: null,
      lastErrorCode: "invalid_dependency_health",
      owner: null
    };
  }

  const rawState = String(dependency.state || dependency.status || "unknown").trim().toLowerCase();
  return {
    id: String(dependency.id || dependency.name || dependency.service || `dependency-${index}`),
    state: DEPENDENCY_HEALTH_STATES.has(rawState) ? rawState : "unknown",
    requestedState: rawState,
    required: dependency.required !== false,
    latencyMs: nonNegativeInteger(dependency.latencyMs ?? dependency.responseTimeMs),
    lastOkAt: dependency.lastOkAt || dependency.lastHealthyAt || null,
    lastErrorCode: dependency.lastErrorCode || dependency.errorCode || null,
    owner: dependency.owner || dependency.team || null
  };
}

function normalizeOperationalHealthPolicy(source, input) {
  const policy = source.policy && typeof source.policy === "object"
    ? source.policy
    : input.operationalPolicy && typeof input.operationalPolicy === "object"
      ? input.operationalPolicy
      : {};

  return {
    contract: "hosted-kernel.scope-matcher.operational-health-policy.v1",
    maxDependencyLatencyMs: positiveInteger(
      policy.maxDependencyLatencyMs ?? source.maxDependencyLatencyMs ?? input.maxDependencyLatencyMs
    ),
    dependencyLastOkTtlMs: positiveInteger(
      policy.dependencyLastOkTtlMs ?? policy.maxDependencyLastOkAgeMs ?? source.dependencyLastOkTtlMs
    ),
    allowDegradedEvaluate: policy.allowDegradedEvaluate !== false,
    allowDegradedLifecycleMutation: policy.allowDegradedLifecycleMutation === true,
    allowHalfOpenEvaluate: policy.allowHalfOpenEvaluate !== false,
    escalationFailureCount: positiveInteger(policy.escalationFailureCount ?? source.escalationFailureCount, 3)
  };
}

function dependencyHealthAgeMs(dependency, now) {
  if (!dependency.lastOkAt) return null;
  const parsedLastOk = Date.parse(dependency.lastOkAt);
  const parsedNow = Date.parse(now);
  if (!Number.isFinite(parsedLastOk) || !Number.isFinite(parsedNow)) return null;
  return Math.max(0, parsedNow - parsedLastOk);
}

function classifyOperationalDependencyIncident(dependency, policy, now) {
  const ageMs = dependencyHealthAgeMs(dependency, now);
  const stale = Boolean(
    dependency.lastOkAt &&
    policy.dependencyLastOkTtlMs &&
    ageMs !== null &&
    ageMs > policy.dependencyLastOkTtlMs
  );
  const latencyExceeded = Boolean(
    policy.maxDependencyLatencyMs &&
    Number.isFinite(dependency.latencyMs) &&
    dependency.latencyMs > policy.maxDependencyLatencyMs
  );
  const invalidState = !DEPENDENCY_HEALTH_STATES.has(dependency.requestedState);
  const blocked = dependency.required && (
    dependency.state === "failing" ||
    dependency.state === "offline" ||
    invalidState ||
    stale
  );
  const warning = dependency.state === "degraded" || latencyExceeded || (!dependency.required && stale);
  const severity = blocked
    ? dependency.state === "offline" ? "critical" : "error"
    : warning
      ? "warning"
      : "info";
  const recoveryAction = blocked
    ? stale
      ? "refresh_dependency_health_evidence"
      : dependency.state === "offline"
        ? "restore_dependency_route"
        : "recover_dependency"
    : latencyExceeded
      ? "reduce_dependency_latency_or_failover"
      : dependency.state === "degraded"
        ? "monitor_degraded_dependency"
        : "none";

  return {
    ...dependency,
    healthAgeMs: ageMs,
    stale,
    latencyExceeded,
    invalidState,
    blocked,
    warning,
    severity: DEPENDENCY_INCIDENT_SEVERITIES.has(severity) ? severity : "warning",
    recoveryAction,
    retryable: blocked || warning
  };
}

function normalizeOperationalHealth(input, upstreamHealth, now) {
  const source = input.operationalHealth && typeof input.operationalHealth === "object"
    ? input.operationalHealth
    : input.health && typeof input.health === "object"
      ? input.health
      : {};
  const policy = normalizeOperationalHealthPolicy(source, input);
  const rawState = String(source.state || source.status || (upstreamHealth.degraded ? "degraded" : "healthy")).trim().toLowerCase();
  const heartbeatAt = source.heartbeatAt || source.lastHeartbeatAt || source.checkedAt || null;
  const heartbeatTtlMs = positiveInteger(source.heartbeatTtlMs ?? source.maxHeartbeatAgeMs);
  const heartbeatStale = Boolean(
    heartbeatAt &&
    heartbeatTtlMs &&
    Date.parse(heartbeatAt) + heartbeatTtlMs <= Date.parse(now)
  );
  const circuitBreakerSource = source.circuitBreaker && typeof source.circuitBreaker === "object"
    ? source.circuitBreaker
    : {};
  const rawCircuitBreakerState = String(circuitBreakerSource.state || source.circuitBreakerState || "closed").trim().toLowerCase();
  const dependencies = [
    ...asArray(source.dependencies || source.checks).map(normalizeOperationalDependency),
    ...asArray(upstreamHealth.dependencies).map((dependency, index) => normalizeOperationalDependency(dependency, index + asArray(source.dependencies || source.checks).length))
  ].map((dependency) => classifyOperationalDependencyIncident(dependency, policy, now));
  const requiredFailures = dependencies.filter((dependency) => (
    dependency.required && dependency.blocked
  ));
  const degradedDependencies = dependencies.filter((dependency) => dependency.warning);
  const requestedMode = String(source.mode || source.operatingMode || "").trim().toLowerCase();
  const fallbackMode = rawState === "offline"
    ? "disabled"
    : rawState === "maintenance"
      ? "read_only"
      : rawState === "degraded" || rawState === "failing" || requiredFailures.length > 0 || degradedDependencies.length > 0
        ? "degraded"
        : "normal";

  return {
    contract: "hosted-kernel.scope-matcher.operational-health.v1",
    supplied: Object.keys(source).length > 0,
    generatedAt: now,
    state: OPERATIONAL_HEALTH_STATES.has(rawState) ? rawState : "unknown",
    requestedState: rawState,
    policy,
    mode: OPERATIONAL_MODES.has(requestedMode) ? requestedMode : fallbackMode,
    requestedMode: requestedMode || fallbackMode,
    heartbeatAt,
    heartbeatTtlMs,
    heartbeatStale,
    region: source.region || input.region || null,
    cellId: source.cellId || input.cellId || null,
    dependencies,
    requiredFailureIds: requiredFailures.map((dependency) => dependency.id),
    degradedDependencyIds: degradedDependencies.map((dependency) => dependency.id),
    dependencyIncidents: dependencies
      .filter((dependency) => dependency.blocked || dependency.warning)
      .map((dependency) => ({
        dependencyId: dependency.id,
        severity: dependency.severity,
        state: dependency.state,
        required: dependency.required,
        stale: dependency.stale,
        latencyExceeded: dependency.latencyExceeded,
        healthAgeMs: dependency.healthAgeMs,
        latencyMs: dependency.latencyMs,
        lastErrorCode: dependency.lastErrorCode,
        recoveryAction: dependency.recoveryAction,
        owner: dependency.owner
      })),
    circuitBreaker: {
      state: CIRCUIT_BREAKER_STATES.has(rawCircuitBreakerState) ? rawCircuitBreakerState : "closed",
      openedAt: circuitBreakerSource.openedAt || source.circuitBreakerOpenedAt || null,
      reason: circuitBreakerSource.reason || source.circuitBreakerReason || null,
      failureCount: nonNegativeInteger(circuitBreakerSource.failureCount ?? source.circuitBreakerFailureCount, 0)
    }
  };
}

function validateOperationalHealth({ operationalHealth, lifecycle, retryPolicy, failureCount }) {
  const errors = [];
  const mutatingCommand = lifecycle.command !== "evaluate";
  const unsupportedDependencies = operationalHealth.dependencies.filter((dependency) => dependency.invalidState);
  const staleRequiredDependencies = operationalHealth.dependencies.filter((dependency) => (
    dependency.required && dependency.stale
  ));
  const latencyExceededDependencies = operationalHealth.dependencies.filter((dependency) => dependency.latencyExceeded);

  if (!OPERATIONAL_HEALTH_STATES.has(operationalHealth.requestedState)) {
    errors.push(buildActionableError({
      code: "unsupported_operational_health_state",
      message: `Operational health state ${operationalHealth.requestedState} is not supported by the scope matcher.`,
      remediation: `Use one of: ${Array.from(OPERATIONAL_HEALTH_STATES).join(", ")}.`
    }));
  }

  if (!OPERATIONAL_MODES.has(operationalHealth.requestedMode)) {
    errors.push(buildActionableError({
      code: "unsupported_operational_mode",
      message: `Operational mode ${operationalHealth.requestedMode} is not supported by the scope matcher.`,
      remediation: `Use one of: ${Array.from(OPERATIONAL_MODES).join(", ")}.`
    }));
  }

  if (unsupportedDependencies.length > 0) {
    errors.push(buildActionableError({
      code: "unsupported_operational_dependency_state",
      message: `${unsupportedDependencies.length} dependency health check(s) reported unsupported states.`,
      remediation: `Report dependency state as one of: ${Array.from(DEPENDENCY_HEALTH_STATES).join(", ")}.`
    }));
  }

  if (operationalHealth.heartbeatStale) {
    errors.push(buildActionableError({
      code: "operational_heartbeat_stale",
      message: "Hosted-kernel operational heartbeat is stale for this scope-matcher decision.",
      remediation: "Refresh operational health before accepting or persisting the scope decision.",
      retryable: true,
      retryAfter: retryAfterMs(failureCount, retryPolicy)
    }));
  }

  if (operationalHealth.mode === "disabled" || operationalHealth.state === "offline") {
    errors.push(buildActionableError({
      code: "scope_matcher_operationally_disabled",
      message: "Scope matcher is disabled by hosted-kernel operational health.",
      remediation: "Wait for the hosted-kernel cell to return to normal or degraded mode before evaluating scopes.",
      retryable: true,
      retryAfter: retryAfterMs(failureCount, retryPolicy)
    }));
  }

  if (operationalHealth.mode === "read_only" && mutatingCommand) {
    errors.push(buildActionableError({
      code: "scope_matcher_read_only_lifecycle_command",
      message: `Lifecycle command ${lifecycle.command} cannot run while the scope matcher is in read-only mode.`,
      remediation: "Use evaluate while maintenance is active, or retry the lifecycle command after read-only mode clears.",
      retryable: true,
      retryAfter: retryAfterMs(failureCount, retryPolicy)
    }));
  }

  if (operationalHealth.mode === "degraded" && !mutatingCommand && !operationalHealth.policy.allowDegradedEvaluate) {
    errors.push(buildActionableError({
      code: "scope_matcher_degraded_evaluate_disabled",
      message: "Evaluate cannot run while degraded mode is active for this operational health policy.",
      remediation: "Refresh operational health to normal mode or enable operationalHealth.policy.allowDegradedEvaluate for guarded reads.",
      retryable: true,
      retryAfter: retryAfterMs(failureCount, retryPolicy)
    }));
  }

  if (operationalHealth.requiredFailureIds.length > 0) {
    errors.push(buildActionableError({
      code: "required_operational_dependency_failed",
      message: `${operationalHealth.requiredFailureIds.length} required operational dependency check(s) failed.`,
      remediation: "Recover required hosted-kernel dependencies before completing capability scope matching.",
      retryable: true,
      retryAfter: retryAfterMs(failureCount, retryPolicy)
    }));
  }

  if (staleRequiredDependencies.length > 0) {
    errors.push(buildActionableError({
      code: "required_operational_dependency_health_stale",
      message: `${staleRequiredDependencies.length} required dependency health receipt(s) exceeded the allowed age.`,
      remediation: "Refresh required dependency health evidence before evaluating hosted-kernel scopes.",
      retryable: true,
      retryAfter: retryAfterMs(failureCount, retryPolicy)
    }));
  }

  if (latencyExceededDependencies.length > 0) {
    errors.push(buildActionableError({
      code: "operational_dependency_latency_slo_exceeded",
      message: `${latencyExceededDependencies.length} dependency check(s) exceeded the scope-matcher latency SLO.`,
      remediation: "Fail over or reduce dependency latency before persisting this capability decision.",
      retryable: true,
      retryAfter: retryAfterMs(failureCount, retryPolicy)
    }));
  }

  if (operationalHealth.mode === "degraded" && mutatingCommand && !operationalHealth.policy.allowDegradedLifecycleMutation) {
    errors.push(buildActionableError({
      code: "scope_matcher_degraded_lifecycle_command",
      message: `Lifecycle command ${lifecycle.command} cannot mutate scope-matcher state while degraded mode is active.`,
      remediation: "Use evaluate during degraded mode or explicitly allow degraded lifecycle mutation in operational health policy.",
      retryable: true,
      retryAfter: retryAfterMs(failureCount, retryPolicy)
    }));
  }

  if (operationalHealth.circuitBreaker.state === "half_open" && mutatingCommand) {
    errors.push(buildActionableError({
      code: "scope_matcher_half_open_lifecycle_command",
      message: `Lifecycle command ${lifecycle.command} cannot run while the circuit breaker is half-open.`,
      remediation: "Let the half-open probe complete with an evaluate command before mutating matcher lifecycle state.",
      retryable: true,
      retryAfter: retryAfterMs(
        Math.max(failureCount || 0, operationalHealth.circuitBreaker.failureCount || 0),
        retryPolicy
      )
    }));
  }

  if (operationalHealth.circuitBreaker.state === "half_open" && !mutatingCommand && !operationalHealth.policy.allowHalfOpenEvaluate) {
    errors.push(buildActionableError({
      code: "scope_matcher_half_open_evaluate_disabled",
      message: "Evaluate cannot run while the circuit breaker is half-open for this operational health policy.",
      remediation: "Allow a half-open evaluate probe in policy or wait for the breaker to close after recovery.",
      retryable: true,
      retryAfter: retryAfterMs(
        Math.max(failureCount || 0, operationalHealth.circuitBreaker.failureCount || 0),
        retryPolicy
      )
    }));
  }

  if (operationalHealth.circuitBreaker.state === "open") {
    errors.push(buildActionableError({
      code: "scope_matcher_circuit_breaker_open",
      message: "Scope matcher circuit breaker is open after repeated operational failures.",
      remediation: "Retry after the breaker half-opens or provide a fresh healthy operational health report.",
      retryable: true,
      retryAfter: retryAfterMs(
        Math.max(failureCount || 0, operationalHealth.circuitBreaker.failureCount || 0),
        retryPolicy
      )
    }));
  }

  return errors;
}

function buildOperationalRecoveryPlan({ operationalHealth, retryableErrors, hardErrors, retryPolicy, failureCount, now }) {
  const operationalErrors = [...retryableErrors, ...hardErrors].filter((error) => (
    String(error.code).startsWith("operational_") ||
    String(error.code).startsWith("scope_matcher_") ||
    String(error.code).startsWith("required_operational_")
  ));
  const retryAfterMsValue = operationalErrors.some((error) => error.retryable)
    ? Math.max(...operationalErrors.map((error) => error.retryAfterMs || retryAfterMs(failureCount, retryPolicy)))
    : null;

  return {
    contract: "hosted-kernel.scope-matcher.operational-recovery.v1",
    generatedAt: now,
    state: operationalErrors.length === 0
      ? operationalHealth.mode === "degraded" || operationalHealth.degradedDependencyIds.length > 0
        ? "degraded_observe"
        : "nominal"
      : hardErrors.some((error) => operationalErrors.includes(error))
        ? "blocked"
        : "retry_scheduled",
    mode: operationalHealth.mode,
    retryAfterMs: retryAfterMsValue,
    retryPolicy,
    dependencyActions: operationalHealth.requiredFailureIds.map((dependencyId) => ({
      dependencyId,
      action: operationalHealth.dependencyIncidents.find((incident) => incident.dependencyId === dependencyId)?.recoveryAction ||
        "recover_required_dependency"
    })),
    dependencyIncidents: operationalHealth.dependencyIncidents.map((incident) => ({
      ...incident,
      retryAfterMs: retryAfterMs(
        incident.severity === "critical"
          ? Math.max(failureCount || 0, operationalHealth.policy.escalationFailureCount)
          : failureCount,
        retryPolicy
      )
    })),
    degradedDependencyIds: operationalHealth.degradedDependencyIds,
    circuitBreakerAction: operationalHealth.circuitBreaker.state === "open"
      ? "wait_for_half_open_probe"
      : operationalHealth.circuitBreaker.state === "half_open"
        ? "allow_single_probe"
        : "none",
    nextAction: operationalErrors.length === 0
      ? "continue_scope_matching"
      : retryAfterMsValue
        ? "retry_after_backoff"
        : "operator_intervention_required"
  };
}

function operationalFailureRoute(errorCode) {
  const code = String(errorCode || "");
  if (code.includes("circuit")) return "hosted-kernel.circuit-breaker";
  if (code.includes("dependency")) return "hosted-kernel.dependency-health";
  if (code.includes("heartbeat")) return "hosted-kernel.health-check";
  if (code.includes("provider")) return "capability-provider-sync";
  if (code.includes("client")) return "client-runtime-handoff";
  return "capability-security.scope-matcher";
}

function buildOperationalFailureState({
  operationalHealth,
  operationalRecovery,
  retryableErrors,
  hardErrors,
  matches,
  retryPolicy,
  failureCount,
  lifecycle,
  audit,
  now
}) {
  const operationalErrors = [...retryableErrors, ...hardErrors].filter((error) => (
    categorizeValidationError(error) === "operational" ||
    String(error.code).startsWith("scope_matcher_")
  ));
  const retryableOperationalErrors = operationalErrors.filter((error) => error.retryable);
  const blockedScopes = matches
    .filter((match) => match.operationalBlocked)
    .map((match) => match.requestedScope);
  const effectiveFailureCount = Math.max(
    nonNegativeInteger(failureCount, 0),
    operationalHealth.circuitBreaker.failureCount || 0
  );
  const shouldEscalate = effectiveFailureCount >= operationalHealth.policy.escalationFailureCount ||
    operationalHealth.dependencyIncidents.some((incident) => incident.severity === "critical");
  const retryAfter = retryableOperationalErrors.length > 0 || operationalRecovery.retryAfterMs
    ? Math.max(
      operationalRecovery.retryAfterMs || 0,
      ...retryableOperationalErrors.map((error) => error.retryAfterMs || retryAfterMs(effectiveFailureCount, retryPolicy))
    )
    : null;
  const state = hardErrors.some((error) => operationalErrors.includes(error)) || operationalHealth.mode === "disabled"
    ? "blocked"
    : shouldEscalate && operationalErrors.length > 0
      ? "escalated"
      : retryAfter
        ? "retrying"
        : operationalHealth.mode === "degraded" || operationalHealth.degradedDependencyIds.length > 0
          ? "degraded"
          : "clear";
  const degradedMode = {
    active: operationalHealth.mode === "degraded" || state === "degraded",
    evaluateAllowed: lifecycle.command === "evaluate" && operationalHealth.policy.allowDegradedEvaluate,
    lifecycleMutationAllowed: operationalHealth.policy.allowDegradedLifecycleMutation,
    blockedCommand: lifecycle.command !== "evaluate" && !operationalHealth.policy.allowDegradedLifecycleMutation
      ? lifecycle.command
      : null,
    allowedCommands: operationalHealth.policy.allowDegradedLifecycleMutation
      ? Array.from(LIFECYCLE_COMMANDS)
      : ["evaluate"]
  };
  const errorActions = operationalErrors.map((error) => ({
    code: error.code,
    route: operationalFailureRoute(error.code),
    retryable: error.retryable,
    retryAfterMs: error.retryAfterMs || (error.retryable ? retryAfterMs(effectiveFailureCount, retryPolicy) : null),
    remediation: error.remediation
  }));
  const dependencyActions = operationalHealth.dependencyIncidents.map((incident) => ({
    dependencyId: incident.dependencyId,
    route: "hosted-kernel.dependency-health",
    severity: incident.severity,
    owner: incident.owner || "capability-security",
    action: incident.recoveryAction,
    retryAfterMs: retryAfterMs(
      incident.severity === "critical"
        ? Math.max(effectiveFailureCount, operationalHealth.policy.escalationFailureCount)
        : effectiveFailureCount,
      retryPolicy
    )
  }));

  return {
    contract: "hosted-kernel.scope-matcher.operational-failure-state.v1",
    generatedAt: now,
    state: OPERATIONAL_FAILURE_STATES.has(state) ? state : "blocked",
    proofId: audit.proofId,
    decision: audit.decision,
    mode: operationalHealth.mode,
    healthState: operationalHealth.state,
    failureCount: effectiveFailureCount,
    escalationThreshold: operationalHealth.policy.escalationFailureCount,
    retry: {
      retryable: retryAfter !== null && state !== "blocked",
      retryAfterMs: retryAfter,
      nextProbeAt: retryAfter === null ? null : isoAfterMs(now, retryAfter),
      attempt: effectiveFailureCount + 1,
      policy: retryPolicy
    },
    degradedMode,
    circuitBreaker: {
      state: operationalHealth.circuitBreaker.state,
      action: operationalRecovery.circuitBreakerAction,
      failureCount: operationalHealth.circuitBreaker.failureCount
    },
    blockedScopes,
    dependencyActions,
    errorActions,
    actionQueue: [...dependencyActions, ...errorActions].map((action, index) => ({
      id: `operational-action-${index + 1}`,
      ...action
    })),
    nextAction: state === "clear"
      ? "continue_scope_matching"
      : state === "degraded"
        ? "continue_with_degraded_guardrails"
        : state === "retrying"
          ? "retry_operational_probe_after_backoff"
          : state === "escalated"
            ? "escalate_to_hosted_kernel_operator"
            : "block_scope_matching_until_operational_recovery"
  };
}

function buildOperationalScopeGate({ requestedScopes, lifecycle, operationalHealth, retryPolicy, failureCount, now }) {
  const mutatingCommand = lifecycle.command !== "evaluate";
  const effectiveFailureCount = Math.max(
    nonNegativeInteger(failureCount, 0),
    operationalHealth.circuitBreaker.failureCount || 0
  );
  const degradedActive = operationalHealth.mode === "degraded" ||
    operationalHealth.degradedDependencyIds.length > 0 ||
    operationalHealth.circuitBreaker.state === "half_open";
  const baseRetryAfter = retryAfterMs(effectiveFailureCount, retryPolicy);
  const dependencyReasonById = new Map(operationalHealth.dependencyIncidents.map((incident) => [
    incident.dependencyId,
    incident.recoveryAction
  ]));
  const reasons = [
    operationalHealth.state === "offline" ? "operational_state_offline" : null,
    operationalHealth.mode === "disabled" ? "operational_mode_disabled" : null,
    operationalHealth.mode === "read_only" && mutatingCommand ? "read_only_blocks_lifecycle_mutation" : null,
    degradedActive && !mutatingCommand && !operationalHealth.policy.allowDegradedEvaluate ? "degraded_evaluate_disabled_by_policy" : null,
    degradedActive && mutatingCommand && !operationalHealth.policy.allowDegradedLifecycleMutation ? "degraded_lifecycle_mutation_disabled_by_policy" : null,
    operationalHealth.circuitBreaker.state === "open" ? "circuit_breaker_open" : null,
    operationalHealth.circuitBreaker.state === "half_open" && mutatingCommand ? "half_open_blocks_lifecycle_mutation" : null,
    operationalHealth.circuitBreaker.state === "half_open" && !mutatingCommand && !operationalHealth.policy.allowHalfOpenEvaluate
      ? "half_open_evaluate_disabled_by_policy"
      : null,
    operationalHealth.requiredFailureIds.length > 0 ? "required_dependency_failed" : null,
    operationalHealth.heartbeatStale ? "operational_heartbeat_stale" : null
  ].filter(Boolean);
  const hardBlockReasons = new Set([
    "operational_state_offline",
    "operational_mode_disabled",
    "read_only_blocks_lifecycle_mutation",
    "degraded_evaluate_disabled_by_policy",
    "degraded_lifecycle_mutation_disabled_by_policy",
    "circuit_breaker_open",
    "half_open_blocks_lifecycle_mutation",
    "half_open_evaluate_disabled_by_policy",
    "required_dependency_failed"
  ]);
  const hardBlocked = reasons.some((reason) => hardBlockReasons.has(reason));
  const retryable = hardBlocked || reasons.includes("operational_heartbeat_stale") || degradedActive;
  const state = hardBlocked
    ? "blocked"
    : reasons.includes("operational_heartbeat_stale")
      ? "retrying"
      : degradedActive
        ? "degraded"
        : "ready";
  const modeAction = hardBlocked
    ? "block_scope_evaluation"
    : state === "retrying"
      ? "retry_health_probe_before_acceptance"
      : state === "degraded"
        ? "evaluate_with_degraded_guardrails"
        : "evaluate_normally";
  const perScope = requestedScopes.map((requestedScope) => ({
    contract: "hosted-kernel.scope-matcher.operational-scope-gate-row.v1",
    requestedScope,
    state,
    decision: hardBlocked
      ? "deny"
      : state === "degraded"
        ? "allow_with_degraded_guardrails"
        : "allow",
    evaluationAllowed: !hardBlocked,
    retryable,
    retryAfterMs: retryable ? baseRetryAfter : null,
    nextProbeAt: retryable ? isoAfterMs(now, baseRetryAfter) : null,
    reasons,
    requiredFailureIds: operationalHealth.requiredFailureIds,
    degradedDependencyIds: operationalHealth.degradedDependencyIds,
    dependencyRecoveryActions: operationalHealth.requiredFailureIds.map((dependencyId) => ({
      dependencyId,
      action: dependencyReasonById.get(dependencyId) || "recover_required_dependency"
    })),
    circuitBreakerState: operationalHealth.circuitBreaker.state,
    modeAction
  }));

  return {
    contract: "hosted-kernel.scope-matcher.operational-scope-gate.v1",
    generatedAt: now,
    state,
    mode: operationalHealth.mode,
    command: lifecycle.command,
    evaluationBlocked: hardBlocked,
    retryable,
    retryAfterMs: retryable ? baseRetryAfter : null,
    nextProbeAt: retryable ? isoAfterMs(now, baseRetryAfter) : null,
    reasons,
    requiredFailureIds: operationalHealth.requiredFailureIds,
    degradedDependencyIds: operationalHealth.degradedDependencyIds,
    deniedScopeCount: hardBlocked ? requestedScopes.length : 0,
    guardedScopeCount: state === "degraded" ? requestedScopes.length : 0,
    perScope,
    nextAction: modeAction
  };
}

function commandFingerprint({ lifecycle, schedule, requestedScopes, clientRuntime, securityBoundary }) {
  return [
    lifecycle.command,
    lifecycle.commandId || "no-command-id",
    scopesFingerprint(requestedScopes),
    securityBoundary?.tenantId || "no-tenant",
    securityBoundary?.workspaceId || "no-workspace",
    securityBoundary?.actor?.id || "no-actor",
    schedule.mode,
    schedule.intervalMs || "",
    schedule.eventName || "",
    schedule.nextRunAt || "",
    clientRuntime.clientId,
    clientRuntime.requestId || ""
  ].join("|");
}

function buildStatePersistenceRecovery({
  persistedState,
  lifecycle,
  schedule,
  requestedScopes,
  clientRuntime,
  securityBoundary,
  audit,
  ok,
  health,
  retryableErrors,
  hardErrors,
  deniedScopes,
  now
}) {
  const fingerprint = commandFingerprint({ lifecycle, schedule, requestedScopes, clientRuntime, securityBoundary });
  const repeatedCommand = Boolean(lifecycle.commandId && lifecycle.commandId === persistedState.lastAppliedCommandId);
  const repeatedFingerprint = Boolean(persistedState.lastAppliedFingerprint && persistedState.lastAppliedFingerprint === fingerprint);
  const matchingJournalEntry = persistedState.journal.find((entry) => (
    (lifecycle.commandId && entry.commandId === lifecycle.commandId) ||
    entry.commandFingerprint === fingerprint
  )) || null;
  const journalReplay = Boolean(matchingJournalEntry && (
    matchingJournalEntry.state === "applied" ||
    matchingJournalEntry.state === "replayed"
  ));
  const replayed = persistedState.supplied && (repeatedCommand || repeatedFingerprint || journalReplay);
  const interrupted = persistedState.state === "applying" || persistedState.state === "recovering";
  const interruptedCommand = matchingJournalEntry && (
    matchingJournalEntry.state === "prepared" ||
    matchingJournalEntry.state === "applying" ||
    matchingJournalEntry.state === "recovering"
  )
    ? matchingJournalEntry
    : persistedState.inFlightCommands.at(-1) || null;
  const staleCheckpoint = persistedState.supplied && persistedState.staleForRequest;
  const leaseBlocksWrite = Boolean(
    persistedState.lease.leaseId &&
    !persistedState.lease.expired &&
    persistedState.lease.holder &&
    persistedState.lease.holder !== clientRuntime.clientId
  );
  const needsRecovery = interrupted ||
    Boolean(interruptedCommand) ||
    (persistedState.state === "failed" && retryableErrors.length > 0);
  const commandEffect = replayed
    ? "replayed"
    : leaseBlocksWrite
      ? "deferred"
    : hardErrors.length > 0
      ? "rejected"
      : needsRecovery
        ? "recover"
        : lifecycle.command === "evaluate"
          ? "read"
          : "apply";
  const restartSafeStatus = replayed
    ? "idempotent_replay"
    : leaseBlocksWrite
      ? "write_deferred_by_active_lease"
    : needsRecovery
      ? "recovery_required"
      : ok
        ? "durably_applied"
        : retryableErrors.length > 0 && hardErrors.length === 0
          ? "retryable_pending"
          : "blocked";
  const recoveryActions = [
    staleCheckpoint ? "discard_stale_checkpoint_for_request" : null,
    leaseBlocksWrite ? "wait_for_active_persistence_lease_or_retry_with_fencing_token" : null,
    interruptedCommand ? "resume_interrupted_command_from_journal" : null,
    needsRecovery && !interruptedCommand ? "recover_from_checkpoint_cursor" : null,
    replayed ? "return_last_durable_decision_without_reapplying" : null,
    retryableErrors.length > 0 && !needsRecovery ? "persist_retryable_pending_snapshot" : null,
    hardErrors.length > 0 ? "persist_rejected_command_audit" : null
  ].filter(Boolean);
  const journalAppend = {
    entryId: `${surfaceId}:journal:${persistedState.revision + 1}`,
    sequence: persistedState.journal.length > 0
      ? Math.max(...persistedState.journal.map((entry) => entry.sequence)) + 1
      : persistedState.revision + 1,
    state: replayed
      ? "replayed"
      : hardErrors.length > 0
        ? "rejected"
        : needsRecovery
          ? "recovering"
          : ok
            ? "applied"
            : retryableErrors.length > 0
              ? "prepared"
              : "failed",
    commandId: lifecycle.commandId,
    commandFingerprint: fingerprint,
    lifecycleCommand: lifecycle.command,
    requestedScopes,
    requestedFingerprint: scopesFingerprint(requestedScopes),
    proofId: audit.proofId,
    recoveryCursor: retryableErrors.length > 0 || needsRecovery
      ? interruptedCommand?.recoveryCursor || persistedState.recoveryCursor || audit.proofId
      : null,
    startedAt: interruptedCommand?.startedAt || now,
    updatedAt: now,
    errorCode: hardErrors[0]?.code || retryableErrors[0]?.code || null,
    durable: !leaseBlocksWrite && hardErrors.length === 0
  };
  const writePrecondition = {
    expectedRevision: persistedState.revision,
    expectedCheckpointId: persistedState.checkpointId,
    requiredLeaseId: persistedState.lease.expired ? null : persistedState.lease.leaseId,
    fencingToken: persistedState.lease.fencingToken,
    allowIfLeaseExpired: true,
    blockedByActiveLease: leaseBlocksWrite
  };
  const nextSnapshotState = leaseBlocksWrite || replayed
    ? persistedState.state
    : ok
      ? "applied"
      : retryableErrors.length > 0 && hardErrors.length === 0
        ? "recovering"
        : "failed";
  const nextRevision = leaseBlocksWrite || replayed
    ? persistedState.revision
    : persistedState.revision + 1;
  const nextLastAppliedCommandId = hardErrors.length > 0 || leaseBlocksWrite
    ? persistedState.lastAppliedCommandId
    : lifecycle.commandId || persistedState.lastAppliedCommandId;
  const nextLastAppliedFingerprint = hardErrors.length > 0 || leaseBlocksWrite
    ? persistedState.lastAppliedFingerprint
    : fingerprint;

  return {
    contract: "hosted-kernel.scope-matcher.state-persistence.v1",
    generatedAt: now,
    storeId: persistedState.storeId,
    checkpointId: persistedState.checkpointId,
    revision: persistedState.revision,
    commandId: lifecycle.commandId,
    commandFingerprint: fingerprint,
    commandEffect,
    restartSafeStatus,
    idempotent: Boolean(lifecycle.commandId),
    replayed,
    replaySource: journalReplay
      ? "journal"
      : repeatedCommand
        ? "last_applied_command_id"
        : repeatedFingerprint
          ? "last_applied_fingerprint"
          : null,
    recoveredFromCheckpoint: persistedState.supplied && !staleCheckpoint && !interrupted,
    recoveryRequired: needsRecovery,
    recoveryCursor: needsRecovery
      ? interruptedCommand?.recoveryCursor || persistedState.recoveryCursor || audit.proofId
      : null,
    recoveryActions,
    staleCheckpoint,
    commandLineage: {
      matchingJournalEntryId: matchingJournalEntry?.entryId || null,
      interruptedJournalEntryId: interruptedCommand?.entryId || null,
      previousCommandId: persistedState.lastAppliedCommandId,
      previousFingerprint: persistedState.lastAppliedFingerprint,
      nextJournalEntryId: journalAppend.entryId
    },
    writePrecondition,
    lock: {
      lockId: persistedState.lockId,
      lockedBy: persistedState.lockedBy,
      expiresAt: persistedState.lease.expiresAt,
      expired: persistedState.lease.expired,
      action: leaseBlocksWrite
        ? "wait_for_lease_expiry"
        : interrupted || interruptedCommand
          ? "resume_or_steal_after_lease"
          : "none"
    },
    lastDecision: persistedState.lastDecision ? {
      proofId: persistedState.lastDecision.proofId,
      commandId: persistedState.lastDecision.commandId,
      commandFingerprint: persistedState.lastDecision.commandFingerprint,
      generatedAt: persistedState.lastDecision.generatedAt,
      decision: persistedState.lastDecision.decision,
      health: persistedState.lastDecision.health,
      staleForRequest: persistedState.staleForRequest
    } : null,
    nextSnapshot: {
      state: nextSnapshotState,
      revision: nextRevision,
      checkpointId: persistedState.checkpointId || `${surfaceId}:checkpoint:${nextRevision}`,
      lastAppliedCommandId: nextLastAppliedCommandId,
      lastAppliedFingerprint: nextLastAppliedFingerprint,
      recoveryCursor: retryableErrors.length > 0 || needsRecovery
        ? interruptedCommand?.recoveryCursor || persistedState.recoveryCursor || audit.proofId
        : null,
      journalAppend,
      lastDecision: {
        proofId: audit.proofId,
        commandId: lifecycle.commandId,
        commandFingerprint: fingerprint,
        generatedAt: now,
        decision: audit.decision,
        health,
        requestedScopes,
        requestedFingerprint: scopesFingerprint(requestedScopes),
        deniedScopes,
        lifecycleCommand: lifecycle.command,
        durable: hardErrors.length === 0
      }
    }
  };
}

function buildAnalyticsCounters({ requestedScopes, capabilityClaims, matches, errors, upstreamFailures, historySnapshots }) {
  const grantedScopes = matches.filter((match) => match.granted).length;
  const deniedScopes = matches.length - grantedScopes;
  const activeClaims = capabilityClaims.filter((claim) => claim.status === "active").length;
  const degradedClaims = capabilityClaims.filter((claim) => claim.status === "degraded").length;
  const disabledClaims = capabilityClaims.filter((claim) => claim.status === "disabled").length;
  const proofBackedProviders = matches.reduce((count, match) => (
    count + match.providers.filter((provider) => provider.proof).length
  ), 0);
  const historicalDenials = historySnapshots.reduce((count, snapshot) => count + snapshot.deniedScopeCount, 0);
  const boundaryDeniedScopes = matches.filter((match) => match.boundaryBlocked).length;

  return {
    requestedScopeCount: requestedScopes.length,
    grantedScopeCount: grantedScopes,
    deniedScopeCount: deniedScopes,
    capabilityClaimCount: capabilityClaims.length,
    activeClaimCount: activeClaims,
    degradedClaimCount: degradedClaims,
    disabledClaimCount: disabledClaims,
    providerMatchCount: matches.reduce((count, match) => count + match.providers.length, 0),
    proofBackedProviderCount: proofBackedProviders,
    errorCount: errors.length,
    retryableDependencyFailureCount: upstreamFailures.filter((failure) => failure.retryable).length,
    hardDependencyFailureCount: upstreamFailures.filter((failure) => !failure.retryable).length,
    historySnapshotCount: historySnapshots.length,
    historicalDeniedScopeCount: historicalDenials,
    boundaryDeniedScopeCount: boundaryDeniedScopes,
    operationalBlockedScopeCount: matches.filter((match) => match.operationalBlocked).length,
    providerReadinessBlockedScopeCount: matches.filter((match) => match.providerReadinessBlocked).length,
    permissionDeniedScopeCount: matches.filter((match) => match.boundary?.missingPermissions?.length > 0).length,
    crossBoundaryDeniedScopeCount: matches.filter((match) => (
      match.boundary?.reasons?.includes("tenant_scope_mismatch") ||
      match.boundary?.reasons?.includes("workspace_scope_mismatch")
    )).length,
    explicitBoundaryDenyScopeCount: matches.filter((match) => (
      match.boundary?.reasons?.includes("tenant_boundary_explicitly_denied") ||
      match.boundary?.reasons?.includes("workspace_boundary_explicitly_denied")
    )).length,
    unboundedWorkspaceScopeCount: matches.filter((match) => (
      match.boundary?.reasons?.includes("workspace_without_tenant_boundary") ||
      match.boundary?.reasons?.includes("workspace_boundary_grant_required")
    )).length
  };
}

function normalizeAnalyticsExportSettings(input, now) {
  const source = input.analytics && typeof input.analytics === "object"
    ? input.analytics
    : input.reporting && typeof input.reporting === "object"
      ? input.reporting
      : {};
  const requestedFormats = uniqueNormalized(source.exportFormats || source.formats || input.exportFormats);
  const exportFormats = requestedFormats.length > 0
    ? requestedFormats.filter((format) => format === "json" || format === "ndjson" || format === "csv")
    : ["json", "ndjson"];
  const rawWindow = source.window && typeof source.window === "object" ? source.window : {};

  return {
    contract: "hosted-kernel.scope-matcher.analytics-export-settings.v1",
    generatedAt: now,
    exportFormats: exportFormats.length > 0 ? exportFormats : ["json"],
    includeHistory: source.includeHistory !== false,
    includeTimeline: source.includeTimeline !== false,
    maxHistorySnapshots: positiveInteger(source.maxHistorySnapshots ?? source.historyLimit, 25),
    window: {
      from: rawWindow.from || source.windowFrom || null,
      to: rawWindow.to || source.windowTo || now,
      label: rawWindow.label || source.windowLabel || "current-decision"
    },
    sink: {
      target: source.sink || source.destination || "hosted-kernel-analytics",
      dataset: source.dataset || "capability_security_scope_matcher",
      partitionKey: source.partitionKey || surfaceId
    }
  };
}

function countBy(values) {
  const counts = new Map();
  for (const value of values.filter(Boolean)) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return Object.fromEntries(Array.from(counts.entries()).sort((left, right) => (
    right[1] - left[1] || left[0].localeCompare(right[0])
  )));
}

function topEntries(counts, limit = 5) {
  return Object.entries(counts)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const stringValue = Array.isArray(value) || typeof value === "object"
    ? JSON.stringify(value)
    : String(value);
  return /[",\n]/.test(stringValue)
    ? `"${stringValue.replace(/"/g, '""')}"`
    : stringValue;
}

function buildScopeDecisionHistorySnapshot({ audit, requestedScopes, analytics, health, lifecycle, operationalHealth, securityBoundary, errors, now }) {
  return {
    contract: "hosted-kernel.scope-matcher.history-snapshot.v1",
    generatedAt: now,
    proofId: audit.proofId,
    decision: audit.decision,
    health,
    requestedScopes,
    requestedScopeCount: analytics.requestedScopeCount,
    grantedScopeCount: analytics.grantedScopeCount,
    deniedScopeCount: analytics.deniedScopeCount,
    deniedScopes: audit.deniedScopes,
    errorCodes: errors.map((error) => error.code),
    lifecycleCommand: lifecycle.command,
    lifecycleCommandId: lifecycle.commandId,
    operationalMode: operationalHealth.mode,
    operationalState: operationalHealth.state,
    tenantId: securityBoundary.tenantId,
    workspaceId: securityBoundary.workspaceId
  };
}

function buildAnalyticsExportManifest({
  analyticsReport,
  exportSummary,
  exportSettings,
  timeline,
  errors,
  audit,
  requestedScopes,
  analytics,
  health,
  lifecycle,
  operationalHealth,
  securityBoundary,
  statePersistence,
  previewReadiness,
  previewAcceptance,
  now
}) {
  const nextHistorySnapshot = {
    ...buildScopeDecisionHistorySnapshot({
      audit,
      requestedScopes,
      analytics,
      health,
      lifecycle,
      operationalHealth,
      securityBoundary,
      errors,
      now
    })
  };
  const csvHeaders = [
    "generatedAt",
    "surfaceId",
    "requestedScope",
    "decision",
    "providerCount",
    "providerIds",
    "deniedReasons",
    "tenantId",
    "workspaceId",
    "clientId",
    "requestId",
    "operationalMode",
    "persistenceStatus"
  ];
  const csvLines = [
    csvHeaders.join(","),
    ...analyticsReport.exportRows.map((row) => csvHeaders.map((header) => csvCell(row[header])).join(","))
  ];
  const jsonPayload = {
    contract: "hosted-kernel.scope-matcher.analytics-export-payload.v1",
    generatedAt: now,
    summary: exportSummary,
    counters: analyticsReport.current,
    trend: analyticsReport.trend,
    rows: analyticsReport.exportRows,
    timeline,
    nextHistorySnapshot,
    proof: {
      proofId: audit.proofId,
      decision: audit.decision,
      deniedScopes: audit.deniedScopes,
      providerProofReceiptCount: audit.providerProofReceiptCount
    },
    acceptance: {
      previewState: previewReadiness.state,
      previewRevision: previewReadiness.previewRevision,
      acceptanceState: previewAcceptance.state,
      accepted: previewAcceptance.accepted
    },
    persistence: {
      restartSafeStatus: statePersistence.restartSafeStatus,
      recoveryRequired: statePersistence.recoveryRequired,
      recoveryCursor: statePersistence.recoveryCursor
    }
  };
  const artifactCandidates = {
    json: {
      format: "json",
      mediaType: "application/json",
      recordCount: analyticsReport.exportRows.length,
      preview: jsonPayload
    },
    ndjson: {
      format: "ndjson",
      mediaType: "application/x-ndjson",
      recordCount: analyticsReport.ndjsonPreview.length,
      previewLines: analyticsReport.ndjsonPreview
    },
    csv: {
      format: "csv",
      mediaType: "text/csv",
      recordCount: analyticsReport.exportRows.length,
      headers: csvHeaders,
      previewLines: csvLines
    }
  };
  const artifacts = exportSettings.exportFormats
    .map((format) => artifactCandidates[format])
    .filter(Boolean)
    .map((artifact) => ({
      ...artifact,
      artifactKey: [
        exportSettings.sink.dataset,
        exportSettings.sink.partitionKey,
        exportSettings.window.label,
        audit.proofId,
        artifact.format
      ].join("/")
    }));

  return {
    contract: "hosted-kernel.scope-matcher.analytics-export-manifest.v1",
    generatedAt: now,
    exportId: `${surfaceId}:${audit.proofId}`,
    sink: exportSettings.sink,
    window: exportSettings.window,
    formats: exportSettings.exportFormats,
    ready: artifacts.length > 0 && statePersistence.restartSafeStatus !== "blocked",
    blockedReason: artifacts.length === 0
      ? "no_supported_export_format"
      : statePersistence.restartSafeStatus === "blocked"
        ? "state_persistence_blocked"
        : null,
    artifactCount: artifacts.length,
    artifacts,
    timelineEventCount: timeline.length,
    nextHistorySnapshot,
    reportIndexes: {
      byDeniedScope: analyticsReport.topDeniedScopes.map((entry) => entry.key),
      byDeniedReason: Object.keys(analyticsReport.deniedReasonCounts),
      byErrorCode: Object.keys(analyticsReport.errorCodeCounts)
    }
  };
}

function buildAnalyticsHistoryReport({
  analytics,
  matches,
  errors,
  historySnapshots,
  exportSettings,
  operationalHealth,
  clientRuntime,
  statePersistence,
  now
}) {
  const scopedHistory = exportSettings.includeHistory
    ? historySnapshots.slice(-exportSettings.maxHistorySnapshots)
    : [];
  const latestHistory = scopedHistory.at(-1) || null;
  const historicalDeniedScopeCounts = countBy(scopedHistory.flatMap((snapshot) => snapshot.deniedScopes));
  const currentDeniedReasons = matches
    .filter((match) => !match.granted)
    .flatMap((match) => [
      match.lifecycleBlocked ? "lifecycle_blocked" : null,
      match.operationalBlocked ? "operational_health_blocked" : null,
      ...(match.operationalGate?.reasons || []),
      match.providerReadinessBlocked ? "provider_readiness_blocked" : null,
      match.boundaryBlocked ? "security_boundary_blocked" : null,
      match.clientSnapshotBlocked ? "client_snapshot_not_adopted" : null,
      match.providers.length === 0 ? "provider_scope_unavailable" : null,
      ...(match.boundary?.reasons || [])
    ]);
  const currentDeniedReasonCounts = countBy(currentDeniedReasons);
  const errorCodeCounts = countBy(errors.map((error) => error.code));
  const previousDeniedScopeCount = latestHistory?.deniedScopeCount ?? 0;
  const previousRequestedScopeCount = latestHistory?.requestedScopeCount ?? 0;
  const currentDenyRate = analytics.requestedScopeCount > 0
    ? analytics.deniedScopeCount / analytics.requestedScopeCount
    : 0;
  const previousDenyRate = previousRequestedScopeCount > 0
    ? previousDeniedScopeCount / previousRequestedScopeCount
    : 0;
  const exportRows = matches.map((match) => ({
    contract: "hosted-kernel.scope-matcher.analytics-row.v1",
    generatedAt: now,
    surfaceId,
    requestedScope: match.requestedScope,
    decision: match.granted ? "allow" : "deny",
    providerCount: match.providers.length,
    providerIds: match.providers.map((provider) => provider.capabilityId),
    deniedReasons: match.granted ? [] : [
      match.lifecycleBlocked ? "lifecycle_blocked" : null,
      match.operationalBlocked ? "operational_health_blocked" : null,
      match.providerReadinessBlocked ? "provider_readiness_blocked" : null,
      match.boundaryBlocked ? "security_boundary_blocked" : null,
      match.clientSnapshotBlocked ? "client_snapshot_not_adopted" : null,
      match.providers.length === 0 ? "provider_scope_unavailable" : null
    ].filter(Boolean),
    tenantId: match.boundary?.tenantId || null,
    workspaceId: match.boundary?.workspaceId || null,
    clientId: clientRuntime.clientId,
    requestId: clientRuntime.requestId,
    operationalMode: operationalHealth.mode,
    persistenceStatus: statePersistence.restartSafeStatus
  }));

  return {
    contract: "hosted-kernel.scope-matcher.analytics-history-report.v1",
    generatedAt: now,
    window: exportSettings.window,
    sink: exportSettings.sink,
    current: analytics,
    trend: {
      previousProofId: latestHistory?.proofId || null,
      previousDecision: latestHistory?.decision || null,
      deniedScopeDelta: analytics.deniedScopeCount - previousDeniedScopeCount,
      requestedScopeDelta: analytics.requestedScopeCount - previousRequestedScopeCount,
      denyRate: Number(currentDenyRate.toFixed(4)),
      previousDenyRate: Number(previousDenyRate.toFixed(4)),
      denyRateDelta: Number((currentDenyRate - previousDenyRate).toFixed(4))
    },
    topDeniedScopes: topEntries({
      ...historicalDeniedScopeCounts,
      ...Object.fromEntries(matches.filter((match) => !match.granted).map((match) => [
        match.requestedScope,
        (historicalDeniedScopeCounts[match.requestedScope] || 0) + 1
      ]))
    }),
    deniedReasonCounts: currentDeniedReasonCounts,
    errorCodeCounts,
    exportRows,
    ndjsonPreview: exportRows.map((row) => JSON.stringify(row)),
    healthFlags: {
      hasHardErrors: errors.some((error) => !error.retryable),
      hasRetryableErrors: errors.some((error) => error.retryable),
      operationallyBlocked: analytics.operationalBlockedScopeCount > 0,
      persistenceRecoveryRequired: statePersistence.recoveryRequired,
      clientSnapshotBlocked: matches.some((match) => match.clientSnapshotBlocked)
    }
  };
}

function syncActionForProviderContract(contract) {
  if (contract.sync.state === "failed") return "retry_provider_contract_sync";
  if (contract.sync.state === "stale") return "refresh_provider_contract_sync";
  if (contract.sync.state === "pending") return "await_provider_contract_sync";
  if (contract.status === "degraded") return "review_degraded_provider_contract";
  if (contract.status === "disabled" || contract.status === "revoked") return "restore_or_replace_provider_contract";
  return "none";
}

function providerContractNegotiationMetadata(contract) {
  const action = syncActionForProviderContract(contract);

  return {
    contract: "hosted-kernel.provider-contract-negotiation-metadata.v1",
    providerContractId: contract.id,
    providerId: contract.providerId,
    capabilityId: contract.capabilityId,
    version: contract.version,
    status: contract.status,
    supportedScopes: contract.supportedScopes,
    requiredScopes: contract.requiredScopes,
    sync: {
      state: contract.sync.state,
      cursor: contract.sync.cursor,
      updatedAt: contract.sync.updatedAt,
      lagMs: contract.sync.lagMs,
      action
    },
    proof: contract.proof ? {
      proofId: contract.proof.proofId,
      generatedAt: contract.proof.generatedAt,
      issuer: contract.proof.issuer,
      cursor: contract.proof.cursor,
      hasSignature: Boolean(contract.proof.signature)
    } : null,
    handoff: {
      state: contract.handoff.state,
      target: contract.handoff.target,
      mode: contract.handoff.mode,
      actionRequired: action !== "none" || contract.handoff.state === "pending" || contract.handoff.state === "blocked"
    }
  };
}

function missingProviderRequiredScopes(matchingContracts, requestedScopes) {
  return Array.from(new Set(matchingContracts.flatMap((contract) => (
    contract.requiredScopes.filter((requiredScope) => (
      !requestedScopes.some((scope) => scopeMatches(scope, requiredScope) || scopeMatches(requiredScope, scope))
    ))
  ))));
}

function negotiationBlockersForScope({ state, match, matchingContracts, missingRequiredScopes }) {
  return [
    state === "blocked_by_lifecycle" ? "lifecycle_not_evaluable" : null,
    state === "blocked_by_operational_health" ? "operational_health_not_evaluable" : null,
    match?.providerReadinessBlocked ? "provider_readiness_blocked" : null,
    match?.boundaryBlocked ? "security_boundary_blocked" : null,
    match?.clientSnapshotBlocked ? "client_snapshot_not_adopted" : null,
    matchingContracts.length === 0 ? "provider_contract_missing" : null,
    missingRequiredScopes.length > 0 ? "provider_required_scope_coverage_missing" : null,
    matchingContracts.some((contract) => contract.sync.state === "failed") ? "provider_contract_sync_failed" : null,
    matchingContracts.some((contract) => contract.status === "disabled" || contract.status === "revoked")
      ? "provider_contract_unusable"
      : null
  ].filter(Boolean);
}

function buildCapabilityNegotiation({ requestedScopes, matches, providerContracts, lifecycleEvaluationDisabled, operationalEvaluationBlocked }) {
  const usableContracts = providerContracts.filter((contract) => (
    contract.status === "active" || contract.status === "degraded"
  ));
  const syncLagMs = usableContracts
    .map((contract) => contract.sync.lagMs)
    .filter((lagMs) => Number.isFinite(lagMs));
  const staleContracts = providerContracts.filter((contract) => (
    contract.sync.state === "stale" || contract.sync.state === "failed" || contract.status === "degraded"
  ));

  const requested = requestedScopes.map((requestedScope) => {
    const matchingContracts = usableContracts.filter((contract) => (
      contract.supportedScopes.some((grantedScope) => scopeMatches(grantedScope, requestedScope))
    ));
    const match = matches.find((candidate) => candidate.requestedScope === requestedScope);
    const accepted = !lifecycleEvaluationDisabled && Boolean(match?.granted) && matchingContracts.length > 0;
    const selectedContract = matchingContracts.find((contract) => (
      contract.status === "active" &&
      contract.sync.state === "current" &&
      contract.proof
    )) || matchingContracts.find((contract) => (
      contract.status === "active" && contract.sync.state === "current"
    )) || matchingContracts[0] || null;
    const syncMetadata = matchingContracts.map(providerContractNegotiationMetadata);
    const missingRequiredScopes = missingProviderRequiredScopes(matchingContracts, requestedScopes);
    const state = lifecycleEvaluationDisabled
      ? "blocked_by_lifecycle"
      : operationalEvaluationBlocked
        ? "blocked_by_operational_health"
        : match?.providerReadinessBlocked
          ? "blocked_by_provider_readiness"
        : accepted
          ? staleContracts.some((contract) => matchingContracts.includes(contract))
            ? "accepted_with_sync_warning"
            : "accepted"
          : match?.boundaryBlocked
            ? "blocked_by_security_boundary"
          : match?.clientSnapshotBlocked
            ? "client_snapshot_not_adopted"
          : matchingContracts.length > 0
            ? "provider_contract_available_but_capability_missing"
            : "needs_provider_contract";
    const blockers = negotiationBlockersForScope({ state, match, matchingContracts, missingRequiredScopes });
    const handoffCandidates = syncMetadata
      .filter((metadata) => metadata.handoff.state === "ready" || metadata.handoff.state === "pending" || metadata.handoff.actionRequired)
      .map((metadata) => ({
        providerContractId: metadata.providerContractId,
        providerId: metadata.providerId,
        target: metadata.handoff.target,
        mode: metadata.handoff.mode,
        state: metadata.handoff.state,
        action: metadata.sync.action,
        syncState: metadata.sync.state
      }));

    return {
      contract: "hosted-kernel.scope-matcher.capability-negotiation-scope.v1",
      requestedScope,
      state,
      accepted,
      negotiationToken: `${surfaceId}:${requestedScope}:${selectedContract?.id || "no-provider-contract"}`,
      selectedProviderContractId: selectedContract?.id || null,
      selectedProviderId: selectedContract?.providerId || null,
      providerContractIds: matchingContracts.map((contract) => contract.id),
      providerIds: matchingContracts.map((contract) => contract.providerId),
      requiredScopes: Array.from(new Set(matchingContracts.flatMap((contract) => contract.requiredScopes))),
      missingRequiredScopes,
      blockers,
      providerReadinessReasons: match?.providerReadiness?.reasons || [],
      syncMetadata,
      handoffCandidates,
      serviceContract: selectedContract ? {
        contract: "hosted-kernel.integration-provider-service-contract.v1",
        providerContractId: selectedContract.id,
        providerId: selectedContract.providerId,
        capabilityId: selectedContract.capabilityId,
        version: selectedContract.version,
        proofId: selectedContract.proof?.proofId || null,
        syncCursor: selectedContract.sync.cursor,
        syncState: selectedContract.sync.state,
        handoffState: selectedContract.handoff.state,
        handoffTarget: selectedContract.handoff.target,
        resumeWhen: accepted
          ? null
          : missingRequiredScopes.length > 0
            ? "provider_required_scopes_available"
            : selectedContract.sync.state !== "current"
              ? "provider_contract_sync_current"
              : "provider_capability_claim_advertises_requested_scope"
      } : null
    };
  });
  const handoffRequiredScopes = requested.filter((item) => !item.accepted && item.handoffCandidates.length > 0);

  return {
    protocol: "hosted-kernel.capability-provider.v1",
    contract: "hosted-kernel.scope-matcher.capability-negotiation.v2",
    requested,
    acceptedScopeCount: requested.filter((item) => item.accepted).length,
    pendingScopeCount: requested.filter((item) => !item.accepted).length,
    handoffRequiredScopeCount: handoffRequiredScopes.length,
    providerContractCount: providerContracts.length,
    activeProviderContractCount: usableContracts.filter((contract) => contract.status === "active").length,
    degradedProviderContractCount: usableContracts.filter((contract) => contract.status === "degraded").length,
    staleProviderContractIds: staleContracts.map((contract) => contract.id),
    failedProviderContractIds: providerContracts.filter((contract) => contract.sync.state === "failed").map((contract) => contract.id),
    maxSyncLagMs: syncLagMs.length > 0 ? Math.max(...syncLagMs) : null,
    handoffQueue: handoffRequiredScopes.flatMap((item) => item.handoffCandidates.map((candidate) => ({
      requestedScope: item.requestedScope,
      negotiationToken: item.negotiationToken,
      ...candidate
    })))
  };
}

function buildExternalHandoffState({ negotiation, deniedScopes, upstreamFailures, lifecycleState, providerContracts, now }) {
  const pendingScopes = negotiation.requested
    .filter((item) => !item.accepted)
    .map((item) => item.requestedScope);
  const dependencyFailures = upstreamFailures.map((failure) => failure.code);
  const contractTargets = providerContracts
    .filter((contract) => contract.handoff.state === "ready" || contract.handoff.state === "pending")
    .map((contract) => ({
      providerContractId: contract.id,
      providerId: contract.providerId,
      target: contract.handoff.target,
      mode: contract.handoff.mode,
      state: contract.handoff.state
    }));
  const negotiationTickets = negotiation.handoffQueue.map((item, index) => ({
    contract: "hosted-kernel.external-provider-handoff-ticket.v1",
    ticketId: `${surfaceId}:handoff:${index + 1}:${item.providerContractId}`,
    requestedScope: item.requestedScope,
    negotiationToken: item.negotiationToken,
    providerContractId: item.providerContractId,
    providerId: item.providerId,
    target: item.target,
    mode: item.mode,
    state: item.state === "ready" ? "dispatchable" : "queued",
    action: item.action === "none" ? "open_provider_handoff" : item.action,
    syncState: item.syncState,
    createdAt: now,
    resumeWhen: item.syncState === "current"
      ? "provider_capability_claim_advertises_requested_scope"
      : "provider_contract_sync_current"
  }));
  const required = pendingScopes.length > 0 || dependencyFailures.length > 0 || lifecycleState.state === "blocked";

  return {
    contract: "hosted-kernel.scope-matcher.external-handoff-state.v2",
    state: !required
      ? "not_required"
      : negotiationTickets.some((ticket) => ticket.state === "dispatchable") || contractTargets.some((target) => target.state === "ready")
        ? "ready"
        : "pending",
    generatedAt: now,
    reason: pendingScopes.length > 0
      ? "missing_provider_contract_or_capability_scope"
      : dependencyFailures.length > 0
        ? "dependency_recovery_required"
        : lifecycleState.nextAction,
    deniedScopes,
    pendingScopes,
    dependencyFailures,
    targets: contractTargets,
    tickets: negotiationTickets,
    ticketCount: negotiationTickets.length,
    dispatchableTicketCount: negotiationTickets.filter((ticket) => ticket.state === "dispatchable").length,
    syncActions: negotiationTickets.map((ticket) => ({
      ticketId: ticket.ticketId,
      providerContractId: ticket.providerContractId,
      action: ticket.action,
      syncState: ticket.syncState
    })),
    resumeWhen: required ? "provider_contract_sync_current_and_scope_accepted" : null
  };
}

function syncWatermarkForProviderContracts(contracts) {
  const cursors = contracts.map((contract) => contract.sync.cursor).filter(Boolean);
  const updatedAtValues = contracts
    .map((contract) => contract.sync.updatedAt)
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort((left, right) => Date.parse(right) - Date.parse(left));
  const lagValues = contracts
    .map((contract) => contract.sync.lagMs)
    .filter((lagMs) => Number.isFinite(lagMs));

  return {
    cursor: cursors.at(-1) || null,
    latestUpdatedAt: updatedAtValues[0] || null,
    maxLagMs: lagValues.length > 0 ? Math.max(...lagValues) : null,
    current: contracts.length > 0 && contracts.every((contract) => contract.sync.state === "current")
  };
}

function providerServiceContractState({ providerId, contracts, negotiation, now }) {
  const providerNegotiations = negotiation.requested.filter((item) => item.providerIds.includes(providerId));
  const acceptedScopes = providerNegotiations
    .filter((item) => item.accepted)
    .map((item) => item.requestedScope);
  const blockedScopes = providerNegotiations
    .filter((item) => !item.accepted)
    .map((item) => ({
      requestedScope: item.requestedScope,
      blockers: item.blockers,
      resumeWhen: item.serviceContract?.resumeWhen || "provider_contract_available"
    }));
  const handoffTickets = negotiation.handoffQueue.filter((ticket) => ticket.providerId === providerId);
  const syncWatermark = syncWatermarkForProviderContracts(contracts);
  const statuses = new Set(contracts.map((contract) => contract.status));
  const syncStates = new Set(contracts.map((contract) => contract.sync.state));
  const blocked = blockedScopes.length > 0 ||
    statuses.has("disabled") ||
    statuses.has("revoked") ||
    syncStates.has("failed");
  const warning = !blocked && (statuses.has("degraded") || !syncWatermark.current || handoffTickets.length > 0);

  return {
    contract: "hosted-kernel.integration-provider-service-registry-entry.v1",
    providerId,
    generatedAt: now,
    state: blocked ? "blocked" : warning ? "warning" : "ready",
    providerContractIds: contracts.map((contract) => contract.id),
    capabilityIds: Array.from(new Set(contracts.map((contract) => contract.capabilityId).filter(Boolean))),
    versions: Array.from(new Set(contracts.map((contract) => contract.version).filter(Boolean))),
    supportedScopes: Array.from(new Set(contracts.flatMap((contract) => contract.supportedScopes))).sort(),
    requiredScopes: Array.from(new Set(contracts.flatMap((contract) => contract.requiredScopes))).sort(),
    acceptedScopes,
    blockedScopes,
    syncWatermark,
    proofIds: contracts.map((contract) => contract.proof?.proofId).filter(Boolean),
    handoff: {
      required: handoffTickets.length > 0 || blockedScopes.length > 0,
      dispatchable: handoffTickets.some((ticket) => ticket.state === "ready"),
      ticketIds: handoffTickets.map((ticket) => ticket.negotiationToken),
      targets: Array.from(new Set(contracts.map((contract) => contract.handoff.target).filter(Boolean))),
      modes: Array.from(new Set(contracts.map((contract) => contract.handoff.mode).filter(Boolean))),
      resumeWhen: blockedScopes[0]?.resumeWhen || (syncWatermark.current ? null : "provider_contract_sync_current")
    },
    lease: {
      leaseId: `${surfaceId}:${providerId}:${syncWatermark.cursor || "no-cursor"}`,
      idempotencyKey: `${providerId}:${acceptedScopes.join(",") || "no-accepted-scope"}:${blockedScopes.length}`,
      expiresWhen: syncWatermark.current ? null : "next_provider_sync_watermark"
    }
  };
}

function buildProviderServiceContractRegistry({ providerContracts, negotiation, externalHandoff, now }) {
  const contractsByProvider = new Map();
  for (const contract of providerContracts) {
    const existing = contractsByProvider.get(contract.providerId) || [];
    existing.push(contract);
    contractsByProvider.set(contract.providerId, existing);
  }

  const providers = Array.from(contractsByProvider.entries())
    .map(([providerId, contracts]) => providerServiceContractState({
      providerId,
      contracts,
      negotiation,
      now
    }))
    .sort((left, right) => left.providerId.localeCompare(right.providerId));
  const blockedProviders = providers.filter((provider) => provider.state === "blocked");
  const warningProviders = providers.filter((provider) => provider.state === "warning");
  const dispatchableProviders = providers.filter((provider) => provider.handoff.dispatchable);

  return {
    contract: "hosted-kernel.scope-matcher.provider-service-contract-registry.v1",
    generatedAt: now,
    protocol: negotiation.protocol,
    state: blockedProviders.length > 0
      ? "blocked"
      : warningProviders.length > 0 || externalHandoff.state === "pending"
        ? "warning"
        : "ready",
    providerCount: providers.length,
    readyProviderCount: providers.filter((provider) => provider.state === "ready").length,
    warningProviderCount: warningProviders.length,
    blockedProviderCount: blockedProviders.length,
    dispatchableProviderCount: dispatchableProviders.length,
    acceptedScopeCount: providers.reduce((count, provider) => count + provider.acceptedScopes.length, 0),
    blockedScopeCount: providers.reduce((count, provider) => count + provider.blockedScopes.length, 0),
    syncCurrentProviderCount: providers.filter((provider) => provider.syncWatermark.current).length,
    maxSyncLagMs: providers
      .map((provider) => provider.syncWatermark.maxLagMs)
      .filter((lagMs) => Number.isFinite(lagMs))
      .reduce((max, lagMs) => Math.max(max, lagMs), null),
    providers,
    handoffLeases: providers
      .filter((provider) => provider.handoff.required)
      .map((provider) => ({
        providerId: provider.providerId,
        leaseId: provider.lease.leaseId,
        idempotencyKey: provider.lease.idempotencyKey,
        dispatchable: provider.handoff.dispatchable,
        resumeWhen: provider.handoff.resumeWhen,
        targets: provider.handoff.targets
      }))
  };
}

function buildClientWorkflowHandoff({ clientRuntime, externalHandoff, deniedScopes, matches, errors, now }) {
  const clientVisibleDenials = deniedScopes.map((requestedScope) => {
    const match = matches.find((candidate) => candidate.requestedScope === requestedScope);
    return {
      requestedScope,
      reason: match?.lifecycleBlocked
        ? "lifecycle_blocked"
        : match?.operationalBlocked
          ? "operational_health_blocked"
        : match?.providerReadinessBlocked
          ? "provider_readiness_blocked"
        : match?.boundaryBlocked
          ? "security_boundary_blocked"
        : match?.clientSnapshotBlocked
          ? "client_snapshot_not_adopted"
          : "provider_scope_unavailable",
      providerCount: match?.providers.length || 0,
      boundaryReasons: match?.boundary?.reasons || [],
      missingPermissions: match?.boundary?.missingPermissions || []
    };
  });
  const retryableClientErrors = errors.filter((error) => (
    error.retryable && String(error.code).startsWith("client_")
  ));
  const needsClientAction = clientVisibleDenials.length > 0 || retryableClientErrors.length > 0;
  const suppressedActions = new Set(clientRuntime.handoff.suppressedActions);
  const acceptedActions = new Set(clientRuntime.handoff.acceptedActions);
  const requestedAction = retryableClientErrors.length > 0
    ? "refresh_scope_snapshot"
    : clientVisibleDenials.some((denial) => denial.reason === "provider_readiness_blocked" || denial.reason === "provider_scope_unavailable")
      ? "open_provider_handoff"
      : clientVisibleDenials.some((denial) => denial.reason === "security_boundary_blocked")
        ? "request_security_boundary_update"
        : clientVisibleDenials.some((denial) => denial.reason === "operational_health_blocked")
          ? "recover_operational_health"
          : clientVisibleDenials.some((denial) => denial.reason === "lifecycle_blocked")
            ? "resume_lifecycle"
            : "acknowledge_denied_scopes";
  const actionAllowedByClient = needsClientAction &&
    !suppressedActions.has(requestedAction) &&
    (acceptedActions.size === 0 || acceptedActions.has(requestedAction));
  const nextAction = !needsClientAction
    ? "continue_workflow"
    : actionAllowedByClient
      ? requestedAction
      : "handoff_action_not_accepted_by_client";
  const workflowState = !needsClientAction
    ? "not_required"
    : clientRuntime.state === "attached" && clientRuntime.workflowState === "interactive" && actionAllowedByClient
      ? "ready"
      : "pending";
  const routePayload = {
    contract: "hosted-kernel.client-workflow-route-payload.v1",
    clientId: clientRuntime.clientId,
    requestId: clientRuntime.requestId,
    sessionId: clientRuntime.sessionId,
    workflowId: clientRuntime.workflowId,
    routeId: clientRuntime.routeId,
    idempotencyKey: clientRuntime.idempotencyKey ||
      `${clientRuntime.clientId}:${clientRuntime.requestId || "request"}:${scopesFingerprint(deniedScopes) || "no-denial"}`,
    target: clientRuntime.handoff.target || externalHandoff.targets[0]?.target || clientRuntime.routeId || null,
    returnTo: clientRuntime.handoff.returnTo,
    priority: clientRuntime.handoff.priority,
    context: clientRuntime.requestContext
  };

  return {
    contract: "hosted-kernel.client-workflow-handoff.v1",
    generatedAt: now,
    clientId: clientRuntime.clientId,
    requestId: clientRuntime.requestId,
    sessionId: clientRuntime.sessionId,
    workflowId: clientRuntime.workflowId,
    routeId: clientRuntime.routeId,
    state: workflowState,
    channel: clientRuntime.handoff.channel,
    target: routePayload.target,
    label: clientRuntime.handoff.label,
    returnTo: clientRuntime.handoff.returnTo,
    priority: clientRuntime.handoff.priority,
    routePayload,
    deniedScopes: clientVisibleDenials,
    retryableErrorCodes: retryableClientErrors.map((error) => error.code),
    requestedAction,
    actionAcceptedByClient: actionAllowedByClient,
    acceptedActions: clientRuntime.handoff.acceptedActions,
    suppressedActions: clientRuntime.handoff.suppressedActions,
    nextAction,
    resumeWhen: needsClientAction
      ? "client_runtime_scope_snapshot_contains_requested_scopes"
      : null
  };
}

function buildClientAdoptionPlan({ clientRuntime, clientWorkflowHandoff, previewAcceptance, validationSummary, deniedScopes, now }) {
  const actionable = clientWorkflowHandoff.state === "ready" || clientWorkflowHandoff.state === "pending";
  const queuedActions = actionable && clientWorkflowHandoff.actionAcceptedByClient
    ? [{
      action: clientWorkflowHandoff.requestedAction,
      state: clientWorkflowHandoff.state === "ready" ? "dispatchable" : "queued",
      routePayload: clientWorkflowHandoff.routePayload,
      deniedScopes,
      retryableErrorCodes: clientWorkflowHandoff.retryableErrorCodes
    }]
    : [];
  const blockers = [
    clientWorkflowHandoff.actionAcceptedByClient === false && clientWorkflowHandoff.state !== "not_required"
      ? "client_handoff_action_not_accepted"
      : null,
    clientRuntime.handoff.requiresUserVisibleHandoff && clientRuntime.workflowState === "headless"
      ? "user_visible_handoff_required"
      : null,
    previewAcceptance.state === "pending_acknowledgement"
      ? "denied_scope_acknowledgement_required"
      : null
  ].filter(Boolean);

  return {
    contract: "hosted-kernel.client-runtime-adoption-plan.v1",
    generatedAt: now,
    state: blockers.length > 0
      ? "blocked"
      : queuedActions.some((item) => item.state === "dispatchable")
        ? "dispatchable"
        : queuedActions.length > 0
          ? "queued"
          : validationSummary.state === "valid"
            ? "adopted"
            : "no_client_action",
    clientId: clientRuntime.clientId,
    requestId: clientRuntime.requestId,
    workflowId: clientRuntime.workflowId,
    routeId: clientRuntime.routeId,
    idempotencyKey: clientWorkflowHandoff.routePayload.idempotencyKey,
    requiresUserVisibleHandoff: clientRuntime.handoff.requiresUserVisibleHandoff,
    queuedActions,
    blockers,
    validationState: validationSummary.state,
    previewAcceptanceState: previewAcceptance.state,
    resumeToken: `${clientRuntime.clientId}:${validationSummary.generatedAt}:${validationSummary.requestedScopeCount}:${validationSummary.deniedScopeCount}`,
    resumeWhen: blockers.length > 0
      ? "client_accepts_handoff_action_and_acknowledges_denied_scopes"
      : clientWorkflowHandoff.resumeWhen
  };
}

function buildClientRuntimeAdoptionCommit({
  clientRuntime,
  clientWorkflowHandoff,
  clientAdoptionPlan,
  previewReadiness,
  previewAcceptance,
  validationSummary,
  matches,
  statePersistence,
  audit,
  now
}) {
  const deniedScopeSet = new Set(audit.deniedScopes);
  const acceptedByPreview = previewAcceptance.accepted && previewAcceptance.decisionProofId === audit.proofId;
  const dispatchableAction = clientAdoptionPlan.queuedActions.find((action) => action.state === "dispatchable") || null;
  const queuedAction = clientAdoptionPlan.queuedActions[0] || null;
  const snapshotCoversAllRequestedScopes = matches.every((match) => (
    match.clientRuntime.snapshotContainsScope
  ));
  const adoptionRows = matches.map((match) => {
    const blockedReasons = validationSummary.perScope
      .find((scope) => scope.requestedScope === match.requestedScope)
      ?.blockingReasons || [];
    const requiresAcknowledgement = deniedScopeSet.has(match.requestedScope) &&
      !previewAcceptance.acknowledgedDeniedScopes.includes(match.requestedScope);
    const canAdopt = match.granted ||
      (acceptedByPreview && !requiresAcknowledgement && !match.clientSnapshotBlocked);

    return {
      contract: "hosted-kernel.client-runtime-scope-adoption-row.v1",
      requestedScope: match.requestedScope,
      state: canAdopt
        ? "adopted"
        : match.clientSnapshotBlocked
          ? "snapshot_refresh_required"
          : requiresAcknowledgement
            ? "acknowledgement_required"
            : "blocked",
      granted: match.granted,
      denied: deniedScopeSet.has(match.requestedScope),
      snapshotContainsScope: match.clientRuntime.snapshotContainsScope,
      requiresAcknowledgement,
      blockingReasons: blockedReasons,
      routeAction: match.clientSnapshotBlocked
        ? "refresh_scope_snapshot"
        : requiresAcknowledgement
          ? "acknowledge_denied_scopes"
          : blockedReasons.includes("provider_readiness_blocked") || blockedReasons.includes("provider_scope_unavailable")
            ? "open_provider_handoff"
            : blockedReasons.includes("security_boundary_blocked")
              ? "request_security_boundary_update"
              : "none"
    };
  });
  const blockedRows = adoptionRows.filter((row) => row.state === "blocked");
  const refreshRows = adoptionRows.filter((row) => row.state === "snapshot_refresh_required");
  const acknowledgementRows = adoptionRows.filter((row) => row.state === "acknowledgement_required");
  const dispatchReady = Boolean(dispatchableAction) &&
    clientAdoptionPlan.blockers.length === 0 &&
    statePersistence.restartSafeStatus !== "blocked";
  const state = statePersistence.restartSafeStatus === "blocked"
    ? "persistence_blocked"
    : dispatchReady
      ? "handoff_dispatchable"
      : refreshRows.length > 0
        ? "snapshot_refresh_required"
        : acknowledgementRows.length > 0
          ? "acknowledgement_required"
          : blockedRows.length > 0 || clientAdoptionPlan.blockers.length > 0
            ? "blocked"
            : acceptedByPreview || validationSummary.state === "valid"
              ? "committed"
              : "awaiting_preview_acceptance";

  return {
    contract: "hosted-kernel.client-runtime-adoption-commit.v1",
    generatedAt: now,
    state,
    clientId: clientRuntime.clientId,
    requestId: clientRuntime.requestId,
    sessionId: clientRuntime.sessionId,
    workflowId: clientRuntime.workflowId,
    routeId: clientRuntime.routeId,
    decisionProofId: audit.proofId,
    previewRevision: previewReadiness.previewRevision,
    previewAccepted: acceptedByPreview,
    statePersistenceStatus: statePersistence.restartSafeStatus,
    snapshot: {
      requestedFingerprint: clientRuntime.scopeSnapshot.requestedFingerprint,
      grantedFingerprint: clientRuntime.scopeSnapshot.grantedFingerprint,
      suppliedFingerprint: clientRuntime.scopeSnapshot.suppliedFingerprint,
      coversAllRequestedScopes: snapshotCoversAllRequestedScopes,
      generatedAt: clientRuntime.scopeSnapshot.generatedAt,
      expiresAt: clientRuntime.scopeSnapshot.expiresAt
    },
    dispatch: {
      ready: dispatchReady,
      channel: clientWorkflowHandoff.channel,
      target: clientWorkflowHandoff.target,
      label: clientWorkflowHandoff.label,
      priority: clientWorkflowHandoff.priority,
      action: dispatchableAction?.action || queuedAction?.action || clientWorkflowHandoff.nextAction,
      routePayload: dispatchableAction?.routePayload || queuedAction?.routePayload || clientWorkflowHandoff.routePayload,
      queuedActionCount: clientAdoptionPlan.queuedActions.length,
      blockerCount: clientAdoptionPlan.blockers.length
    },
    counts: {
      adoptedScopeCount: adoptionRows.filter((row) => row.state === "adopted").length,
      blockedScopeCount: blockedRows.length,
      snapshotRefreshScopeCount: refreshRows.length,
      acknowledgementScopeCount: acknowledgementRows.length,
      deniedScopeCount: audit.deniedScopes.length
    },
    blockers: Array.from(new Set([
      ...clientAdoptionPlan.blockers,
      ...blockedRows.flatMap((row) => row.blockingReasons),
      statePersistence.restartSafeStatus === "blocked" ? "state_persistence_blocked" : null
    ].filter(Boolean))),
    rows: adoptionRows,
    resumeToken: clientAdoptionPlan.resumeToken,
    resumeWhen: state === "committed"
      ? null
      : refreshRows.length > 0
        ? "client_runtime_scope_snapshot_refreshed"
        : acknowledgementRows.length > 0
          ? "denied_scopes_acknowledged"
          : clientAdoptionPlan.resumeWhen
  };
}

function buildTimeline({ now, requestedScopes, matches, upstreamFailures, historySnapshots }) {
  const timeline = [{
    at: now,
    type: "scope-request",
    summary: `${requestedScopes.length} requested scope(s) normalized for hosted-kernel matching.`,
    scopeCount: requestedScopes.length
  }];

  for (const failure of upstreamFailures) {
    timeline.push({
      at: now,
      type: failure.retryable ? "dependency-retryable" : "dependency-hard-failure",
      summary: failure.message,
      code: failure.code,
      retryAfterMs: failure.retryAfterMs
    });
  }

  for (const match of matches) {
    timeline.push({
      at: now,
      type: match.granted ? "scope-granted" : "scope-denied",
      summary: match.lifecycleBlocked
        ? `${match.requestedScope} blocked by lifecycle controls.`
        : match.operationalBlocked
        ? `${match.requestedScope} blocked by hosted-kernel operational health.`
        : match.providerReadinessBlocked
          ? `${match.requestedScope} blocked by provider readiness policy.`
        : match.granted
          ? `${match.requestedScope} granted by ${match.providers.length} capability provider(s).`
          : match.boundaryBlocked
            ? `${match.requestedScope} blocked by tenant or workspace boundary policy.`
          : match.clientSnapshotBlocked
            ? `${match.requestedScope} blocked until the client runtime adopts the scope snapshot.`
          : `${match.requestedScope} has no active matching capability provider.`,
      requestedScope: match.requestedScope,
      providerCount: match.providers.length,
      boundaryReasons: match.boundary?.reasons || []
    });
  }

  for (const snapshot of historySnapshots.slice(-5)) {
    timeline.push({
      at: snapshot.generatedAt,
      type: "history-snapshot",
      summary: `${snapshot.decision} decision with ${snapshot.deniedScopeCount} denied scope(s).`,
      decision: snapshot.decision,
      health: snapshot.health,
      proofId: snapshot.proofId
    });
  }

  return timeline;
}

function buildLifecycleState({ lifecycle, schedule, controlPlan, ok, health, retryableErrors, deniedScopes, now }) {
  const disabled = lifecycle.enabled === false || lifecycle.command === "disable" || controlPlan.effectiveEnabled === false;
  const paused = lifecycle.command === "pause" || controlPlan.targetState === "paused";
  const readyForSchedule = controlPlan.scheduleActive && ok && !disabled && !paused;
  const nextAction = controlPlan.blockers.length > 0
    ? controlPlan.nextAction
    : disabled
      ? "remain_disabled"
      : paused
        ? "wait_for_resume"
      : retryableErrors.length > 0
        ? "retry_after_dependency_recovery"
        : deniedScopes.length > 0
          ? "request_scope_or_capability_update"
          : readyForSchedule
            ? "schedule_next_evaluation"
            : "no_action_required";

  return {
    command: lifecycle.command,
    commandId: lifecycle.commandId,
    enabled: !disabled,
    state: disabled ? "disabled" : paused ? "paused" : ok ? "enabled" : "blocked",
    nextAction,
    proofRequired: lifecycle.proofRequired,
    auditRequired: lifecycle.auditRequired,
    allowDegradedProviders: lifecycle.allowDegradedProviders,
    actor: lifecycle.actor,
    reason: lifecycle.reason,
    controls: controlPlan,
    schedule,
    canEvaluate: !disabled && !paused,
    canEnable: disabled || lifecycle.command === "enable" || lifecycle.command === "resume",
    canDisable: !disabled,
    canSchedule: controlPlan.scheduleRequested && controlPlan.blockers.length === 0,
    nextEvaluationAt: readyForSchedule ? schedule.nextRunAt || now : null,
    healthAtCommand: health
  };
}

function normalizePreviewAcceptance(input, deniedScopes, now) {
  const source = input.previewAcceptance && typeof input.previewAcceptance === "object"
    ? input.previewAcceptance
    : input.acceptance && typeof input.acceptance === "object"
      ? input.acceptance
      : input.clientAcceptance && typeof input.clientAcceptance === "object"
        ? input.clientAcceptance
        : {};
  const acknowledgedDeniedScopes = uniqueNormalized(source.acknowledgedDeniedScopes || source.deniedScopesAcknowledged);
  const requestedState = String(source.state || (source.accepted === true ? "accepted" : "not_requested")).trim().toLowerCase();

  return {
    contract: "hosted-kernel.scope-matcher.preview-acceptance-request.v1",
    supplied: Object.keys(source).length > 0,
    state: PREVIEW_ACCEPTANCE_STATES.has(requestedState) ? requestedState : "rejected",
    requestedState,
    accepted: source.accepted === true || requestedState === "accepted",
    actorId: normalizeIdentity(source.actorId || source.actor?.id || input.actorId),
    acceptedAt: source.acceptedAt || source.timestamp || (source.accepted === true ? now : null),
    acceptanceToken: source.acceptanceToken || source.token || null,
    clientPreviewRevision: source.previewRevision || source.revision || null,
    requireReadyPreview: source.requireReadyPreview !== false,
    acknowledgedDeniedScopes,
    missingDeniedScopeAcknowledgements: deniedScopes.filter((scope) => !acknowledgedDeniedScopes.includes(scope)),
    note: source.note || source.reason || null
  };
}

function categorizeValidationError(error) {
  const code = String(error.code || "");
  if (code.includes("provider") || code.includes("capability")) return "provider";
  if (code.includes("client")) return "client";
  if (code.includes("tenant") || code.includes("workspace") || code.includes("boundary") || code.includes("permission")) return "security";
  if (code.includes("operational") || code.includes("circuit") || code.includes("dependency")) return "operational";
  if (code.includes("lifecycle") || code.includes("schedule")) return "lifecycle";
  if (code.includes("persisted") || code.includes("recovery")) return "persistence";
  return "request";
}

function buildValidationSummary({ errors, matches, requestedScopes, providerReadiness, operationalHealth, clientRuntime, statePersistence, now }) {
  const categoryCounts = countBy(errors.map(categorizeValidationError));
  const hardErrors = errors.filter((error) => !error.retryable);
  const retryableErrors = errors.filter((error) => error.retryable);
  const deniedMatches = matches.filter((match) => !match.granted);
  const perScope = matches.map((match) => ({
    requestedScope: match.requestedScope,
    valid: match.granted,
    decision: match.granted ? "allow" : "deny",
    blockingReasons: match.granted ? [] : [
      match.lifecycleBlocked ? "lifecycle_blocked" : null,
      match.operationalBlocked ? "operational_health_blocked" : null,
      match.providerReadinessBlocked ? "provider_readiness_blocked" : null,
      match.boundaryBlocked ? "security_boundary_blocked" : null,
      match.clientSnapshotBlocked ? "client_snapshot_not_adopted" : null,
      match.providers.length === 0 ? "provider_scope_unavailable" : null,
      ...(match.operationalGate?.reasons || []),
      ...(match.boundary?.reasons || [])
    ].filter(Boolean),
    providerContractIds: match.providerReadiness.contractIds,
    missingPermissions: match.boundary?.missingPermissions || []
  }));

  return {
    contract: "hosted-kernel.scope-matcher.validation-summary.v1",
    generatedAt: now,
    state: hardErrors.length > 0 || deniedMatches.length > 0
      ? "invalid"
      : retryableErrors.length > 0 || operationalHealth.mode === "degraded" || providerReadiness.warningScopeCount > 0
        ? "valid_with_warnings"
        : "valid",
    requestedScopeCount: requestedScopes.length,
    validScopeCount: perScope.filter((scope) => scope.valid).length,
    deniedScopeCount: deniedMatches.length,
    errorCount: errors.length,
    hardErrorCount: hardErrors.length,
    retryableErrorCount: retryableErrors.length,
    categoryCounts,
    blockingErrorCodes: hardErrors.map((error) => error.code),
    retryableErrorCodes: retryableErrors.map((error) => error.code),
    providerReadinessState: providerReadiness.blockedScopeCount > 0
      ? "blocked"
      : providerReadiness.warningScopeCount > 0 ? "warning" : "ready",
    clientRuntimeState: clientRuntime.state,
    persistenceRestartSafeStatus: statePersistence.restartSafeStatus,
    perScope
  };
}

function previewReasonForMatch(match) {
  if (match.granted) return "scope_granted";
  if (match.lifecycleBlocked) return "lifecycle_blocked";
  if (match.operationalBlocked) return "operational_health_blocked";
  if (match.providerReadinessBlocked) return "provider_readiness_blocked";
  if (match.boundaryBlocked) return "security_boundary_blocked";
  if (match.clientSnapshotBlocked) return "client_snapshot_not_adopted";
  return "provider_scope_unavailable";
}

function nextStepForPreviewReason(reason) {
  if (reason === "scope_granted") return "accept_preview";
  if (reason === "operational_health_blocked") return "recover_operational_health";
  if (reason === "provider_readiness_blocked" || reason === "provider_scope_unavailable") return "open_provider_handoff";
  if (reason === "security_boundary_blocked") return "fix_security_boundary";
  if (reason === "client_snapshot_not_adopted") return "refresh_client_runtime_scope_snapshot";
  if (reason === "lifecycle_blocked") return "resume_or_enable_lifecycle";
  return "review_validation_errors";
}

function buildPreviewReadiness({ ok, health, degraded, matches, errors, audit, lifecycleState, operationalRecovery, clientWorkflowHandoff, now }) {
  const hardErrors = errors.filter((error) => !error.retryable);
  const retryableErrors = errors.filter((error) => error.retryable);
  const previewRows = matches.map((match) => {
    const reason = previewReasonForMatch(match);
    return {
      contract: "hosted-kernel.scope-matcher.preview-row.v1",
      requestedScope: match.requestedScope,
      decision: match.granted ? "allow" : "deny",
      displayState: match.granted ? "Ready" : "Needs action",
      reason,
      nextStep: nextStepForPreviewReason(reason),
      providerCount: match.providers.length,
      providerContractIds: match.providerReadiness.contractIds,
      missingPermissions: match.boundary?.missingPermissions || [],
      boundaryReasons: match.boundary?.reasons || []
    };
  });
  const state = ok && hardErrors.length === 0
    ? degraded || retryableErrors.length > 0
      ? "ready_with_warnings"
      : "ready_for_acceptance"
    : retryableErrors.length > 0 && hardErrors.length === 0
      ? "needs_action"
      : "blocked";

  return {
    contract: "hosted-kernel.scope-matcher.preview-readiness.v1",
    generatedAt: now,
    state: PREVIEW_READINESS_STATES.has(state) ? state : "blocked",
    previewRevision: audit.proofId,
    decision: audit.decision,
    health,
    canAccept: state === "ready_for_acceptance" || state === "ready_with_warnings",
    requiresAcknowledgement: previewRows.some((row) => row.decision === "deny"),
    primaryAction: state === "ready_for_acceptance" || state === "ready_with_warnings"
      ? "accept_scope_decision"
      : clientWorkflowHandoff.nextAction || operationalRecovery.nextAction || lifecycleState.nextAction,
    checks: {
      lifecycleCanEvaluate: lifecycleState.canEvaluate,
      operationalRecoveryState: operationalRecovery.state,
      clientHandoffState: clientWorkflowHandoff.state,
      hardErrorCount: hardErrors.length,
      retryableErrorCount: retryableErrors.length
    },
    rows: previewRows
  };
}

function buildPreviewAcceptanceContract({ previewReadiness, previewAcceptance, deniedScopes, errors, audit, now }) {
  const hardErrorCodes = errors.filter((error) => !error.retryable).map((error) => error.code);
  const tokenMatches = !previewAcceptance.acceptanceToken || previewAcceptance.acceptanceToken === previewReadiness.previewRevision;
  const revisionMatches = !previewAcceptance.clientPreviewRevision ||
    previewAcceptance.clientPreviewRevision === previewReadiness.previewRevision;
  const missingAcknowledgements = previewAcceptance.missingDeniedScopeAcknowledgements;
  const blockedByReadiness = previewAcceptance.requireReadyPreview && !previewReadiness.canAccept;
  const accepted = previewAcceptance.supplied &&
    previewAcceptance.accepted &&
    tokenMatches &&
    revisionMatches &&
    !blockedByReadiness &&
    missingAcknowledgements.length === 0 &&
    hardErrorCodes.length === 0;
  const state = !previewAcceptance.supplied
    ? "not_requested"
    : accepted
      ? "accepted"
      : missingAcknowledgements.length > 0
        ? "pending_acknowledgement"
        : blockedByReadiness || hardErrorCodes.length > 0 || !revisionMatches
          ? "blocked"
          : "rejected";

  return {
    contract: "hosted-kernel.scope-matcher.preview-acceptance.v1",
    generatedAt: now,
    state,
    accepted,
    acceptanceToken: previewReadiness.previewRevision,
    receivedToken: previewAcceptance.acceptanceToken,
    tokenMatches,
    revisionMatches,
    receivedPreviewRevision: previewAcceptance.clientPreviewRevision,
    actorId: previewAcceptance.actorId,
    acceptedAt: accepted ? previewAcceptance.acceptedAt || now : null,
    previewRevision: previewReadiness.previewRevision,
    decisionProofId: audit.proofId,
    deniedScopes,
    acknowledgedDeniedScopes: previewAcceptance.acknowledgedDeniedScopes,
    missingDeniedScopeAcknowledgements: missingAcknowledgements,
    blockingErrorCodes: hardErrorCodes,
    nextAction: accepted
      ? "persist_accepted_scope_decision"
      : state === "pending_acknowledgement"
        ? "acknowledge_denied_scopes"
        : !revisionMatches
          ? "refresh_preview_revision"
        : blockedByReadiness
          ? previewReadiness.primaryAction
          : "resubmit_preview_acceptance"
  };
}

function buildExplainableNextSteps({ previewReadiness, validationSummary, previewAcceptance, externalHandoff, clientWorkflowHandoff, operationalRecovery, statePersistence }) {
  const steps = [];

  if (previewAcceptance.accepted) {
    steps.push({
      id: "persist-accepted-decision",
      label: "Persist accepted decision",
      reason: "Client accepted the current preview revision.",
      target: statePersistence.storeId,
      action: "persist_scope_matcher_state"
    });
  }

  for (const row of previewReadiness.rows.filter((item) => item.decision === "deny")) {
    steps.push({
      id: `resolve-${row.requestedScope}`,
      label: row.displayState,
      reason: row.reason,
      requestedScope: row.requestedScope,
      action: row.nextStep,
      providerContractIds: row.providerContractIds
    });
  }

  if (clientWorkflowHandoff.state === "ready" || clientWorkflowHandoff.state === "pending") {
    steps.push({
      id: "client-workflow-handoff",
      label: clientWorkflowHandoff.label,
      reason: clientWorkflowHandoff.nextAction,
      target: clientWorkflowHandoff.target,
      action: "route_client_workflow"
    });
  }

  if (externalHandoff.state === "ready" || externalHandoff.state === "pending") {
    steps.push({
      id: "external-provider-handoff",
      label: "Provider capability handoff",
      reason: externalHandoff.reason,
      target: externalHandoff.targets[0]?.target || null,
      action: "route_provider_handoff"
    });
  }

  if (operationalRecovery.nextAction !== "continue_scope_matching") {
    steps.push({
      id: "operational-recovery",
      label: "Operational recovery",
      reason: operationalRecovery.state,
      retryAfterMs: operationalRecovery.retryAfterMs,
      action: operationalRecovery.nextAction
    });
  }

  return {
    contract: "hosted-kernel.scope-matcher.explainable-next-steps.v1",
    state: previewAcceptance.accepted
      ? "accepted"
      : previewReadiness.canAccept
        ? "awaiting_acceptance"
        : validationSummary.state,
    primaryAction: steps[0]?.action || previewReadiness.primaryAction,
    validationState: validationSummary.state,
    stepCount: steps.length,
    steps
  };
}

function buildClientPreviewRouteContract({
  previewReadiness,
  previewAcceptance,
  validationSummary,
  clientWorkflowHandoff,
  clientAdoptionPlan,
  explainableNextSteps,
  audit,
  clientRuntime,
  now
}) {
  const routePayloadBase = {
    clientId: clientRuntime.clientId,
    requestId: clientRuntime.requestId,
    sessionId: clientRuntime.sessionId,
    workflowId: clientRuntime.workflowId,
    routeId: clientRuntime.routeId,
    previewRevision: previewReadiness.previewRevision,
    acceptanceToken: previewAcceptance.acceptanceToken,
    decisionProofId: audit.proofId,
    returnTo: clientRuntime.handoff.returnTo,
    context: clientRuntime.requestContext
  };
  const deniedRows = previewReadiness.rows.filter((row) => row.decision === "deny");
  const acceptDisabledReasons = [
    !previewReadiness.canAccept ? "preview_not_ready" : null,
    previewAcceptance.state === "pending_acknowledgement" ? "denied_scope_acknowledgement_required" : null,
    previewAcceptance.revisionMatches === false ? "preview_revision_stale" : null,
    validationSummary.hardErrorCount > 0 ? "hard_validation_errors_present" : null
  ].filter(Boolean);
  const displayRows = previewReadiness.rows.map((row) => ({
    requestedScope: row.requestedScope,
    decision: row.decision,
    state: row.displayState,
    reason: row.reason,
    nextStep: row.nextStep,
    routeAction: row.decision === "allow"
      ? "none"
      : row.nextStep === "open_provider_handoff"
        ? "provider_handoff"
        : row.nextStep === "refresh_client_runtime_scope_snapshot"
          ? "client_scope_refresh"
          : row.nextStep === "fix_security_boundary"
            ? "security_boundary_update"
            : row.nextStep,
    details: {
      providerCount: row.providerCount,
      providerContractIds: row.providerContractIds,
      missingPermissions: row.missingPermissions,
      boundaryReasons: row.boundaryReasons
    }
  }));

  return {
    contract: "hosted-kernel.scope-matcher.client-preview-route.v1",
    generatedAt: now,
    clientId: clientRuntime.clientId,
    requestId: clientRuntime.requestId,
    routeId: clientRuntime.routeId,
    workflowId: clientRuntime.workflowId,
    state: previewAcceptance.accepted
      ? "accepted"
      : previewReadiness.canAccept && acceptDisabledReasons.length === 0
        ? "acceptance_enabled"
        : previewReadiness.canAccept
          ? "acceptance_blocked"
          : "action_required",
    title: previewReadiness.decision === "allow"
      ? "Capability access ready"
      : "Capability access needs review",
    readiness: {
      state: previewReadiness.state,
      canAccept: previewReadiness.canAccept,
      requiresAcknowledgement: previewReadiness.requiresAcknowledgement,
      primaryAction: previewReadiness.primaryAction,
      validationState: validationSummary.state
    },
    acceptance: {
      state: previewAcceptance.state,
      accepted: previewAcceptance.accepted,
      disabledReasons: acceptDisabledReasons,
      tokenMatches: previewAcceptance.tokenMatches,
      revisionMatches: previewAcceptance.revisionMatches,
      missingDeniedScopeAcknowledgements: previewAcceptance.missingDeniedScopeAcknowledgements,
      submitPayload: {
        ...routePayloadBase,
        accepted: true,
        acknowledgedDeniedScopes: deniedRows.map((row) => row.requestedScope)
      }
    },
    validation: {
      summaryState: validationSummary.state,
      requestedScopeCount: validationSummary.requestedScopeCount,
      validScopeCount: validationSummary.validScopeCount,
      deniedScopeCount: validationSummary.deniedScopeCount,
      errorCount: validationSummary.errorCount,
      categoryCounts: validationSummary.categoryCounts,
      blockingErrorCodes: validationSummary.blockingErrorCodes,
      retryableErrorCodes: validationSummary.retryableErrorCodes
    },
    rows: displayRows,
    actions: explainableNextSteps.steps.map((step, index) => ({
      actionId: step.id || `preview-action-${index + 1}`,
      label: step.label,
      reason: step.reason,
      action: step.action,
      requestedScope: step.requestedScope || null,
      target: step.target || clientWorkflowHandoff.target || null,
      routePayload: step.id === "client-workflow-handoff"
        ? clientWorkflowHandoff.routePayload
        : routePayloadBase
    })),
    adoption: {
      state: clientAdoptionPlan.state,
      queuedActionCount: clientAdoptionPlan.queuedActions.length,
      blockerCount: clientAdoptionPlan.blockers.length,
      resumeToken: clientAdoptionPlan.resumeToken,
      resumeWhen: clientAdoptionPlan.resumeWhen
    }
  };
}

export function describeScopeMatcherSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  const requestedScopes = asArray(input.requestedScopes || input.requiredScopes || input.scope)
    .map(normalizeScope)
    .filter(Boolean);
  const securityBoundary = normalizeSecurityBoundary(input, requestedScopes, now);
  const capabilityClaims = asArray(input.capabilityClaims || input.capabilities)
    .map(normalizeCapabilityClaim);
  const providerContracts = normalizeProviderContracts(input, capabilityClaims);
  const providerReadinessPolicy = normalizeProviderReadinessPolicy(input);
  const providerReadiness = buildProviderReadiness({
    requestedScopes,
    providerContracts,
    capabilityClaims,
    policy: providerReadinessPolicy,
    now
  });
  const retryPolicy = { ...DEFAULT_RETRY_POLICY, ...(input.retryPolicy || {}) };
  const clientRuntime = normalizeClientRuntime(input, requestedScopes, now);
  const upstreamHealth = input.upstreamHealth && typeof input.upstreamHealth === "object"
    ? input.upstreamHealth
    : {};
  const operationalHealth = normalizeOperationalHealth(input, upstreamHealth, now);
  const historySnapshots = asArray(input.history || input.historySnapshots || input.previousDecisions)
    .map(normalizeHistorySnapshot)
    .filter(Boolean);
  const lifecycle = normalizeLifecycleSettings(input);
  const schedule = normalizeSchedule(input, now);
  const lifecycleControlPlan = buildLifecycleControlPlan({ lifecycle, schedule, now });
  const persistedState = normalizePersistedMatcherState(input, requestedScopes, now);
  const lifecycleErrors = validateLifecycleSettings({
    lifecycle,
    schedule,
    evidence,
    controlPlan: lifecycleControlPlan,
    now
  });
  const operationalErrors = validateOperationalHealth({
    operationalHealth,
    lifecycle,
    retryPolicy,
    failureCount: input.failureCount
  });
  const securityBoundaryErrors = validateSecurityBoundary({
    securityBoundary,
    retryPolicy,
    failureCount: input.failureCount
  });
  const providerReadinessErrors = providerReadinessPolicy.supplied
    ? validateProviderReadiness({
      providerReadiness,
      retryPolicy,
      failureCount: input.failureCount
    })
    : [];
  const clientRuntimeErrors = clientRuntime.supplied
    ? validateClientRuntime({
      clientRuntime,
      requestedScopes,
      retryPolicy,
      failureCount: input.failureCount,
      now
    })
    : [];

  const validationErrors = [
    ...lifecycleErrors,
    ...operationalErrors,
    ...securityBoundaryErrors,
    ...providerReadinessErrors,
    ...clientRuntimeErrors
  ];
  if (persistedState.supplied && !PERSISTED_MATCHER_STATES.has(persistedState.requestedState)) {
    validationErrors.push(buildActionableError({
      code: "unsupported_persisted_matcher_state",
      message: `Persisted matcher state ${persistedState.requestedState} is not supported for restart recovery.`,
      remediation: `Persist one of: ${Array.from(PERSISTED_MATCHER_STATES).join(", ")}.`
    }));
  }

  if (persistedState.supplied && persistedState.state === "failed" && !persistedState.recoveryCursor) {
    validationErrors.push(buildActionableError({
      code: "missing_persisted_recovery_cursor",
      message: "Failed persisted matcher state requires a recovery cursor before restart-safe evaluation can continue.",
      remediation: "Persist the last proof id or durable checkpoint cursor with failed scope-matcher state.",
      retryable: true,
      retryAfter: retryAfterMs(input.failureCount, retryPolicy)
    }));
  }

  if (requestedScopes.length === 0) {
    validationErrors.push(buildActionableError({
      code: "missing_requested_scopes",
      message: "Scope matcher requires at least one requested scope.",
      remediation: "Pass requestedScopes as a non-empty string array before asking for a capability decision."
    }));
  }

  const invalidClaims = capabilityClaims.filter((claim) => claim.status === "invalid" || claim.scopes.length === 0);
  if (invalidClaims.length > 0) {
    validationErrors.push(buildActionableError({
      code: "invalid_capability_claims",
      message: `${invalidClaims.length} capability claim(s) are missing usable scopes.`,
      remediation: "Refresh the capability registry entry and include normalized scope strings on each claim."
    }));
  }

  const invalidProviderContracts = providerContracts.filter((contract) => (
    contract.status === "revoked" || contract.supportedScopes.length === 0
  ));
  if (invalidProviderContracts.length > 0) {
    validationErrors.push(buildActionableError({
      code: "invalid_provider_contracts",
      message: `${invalidProviderContracts.length} provider contract(s) cannot advertise hosted-kernel scopes.`,
      remediation: "Refresh integration provider contracts with active status and non-empty supportedScopes."
    }));
  }

  const failedSyncContracts = providerContracts.filter((contract) => contract.sync.state === "failed");
  if (failedSyncContracts.length > 0) {
    validationErrors.push(buildActionableError({
      code: "provider_contract_sync_failed",
      message: `${failedSyncContracts.length} provider contract sync operation(s) failed.`,
      remediation: "Retry provider contract sync before allowing external capability handoff.",
      retryable: true,
      retryAfter: retryAfterMs(input.failureCount, retryPolicy)
    }));
  }
  const evaluableClaims = lifecycle.allowDegradedProviders
    ? capabilityClaims.filter((claim) => claim.status === "active" || claim.status === "degraded")
    : capabilityClaims.filter((claim) => claim.status === "active");

  const upstreamFailures = asArray(upstreamHealth.failures).map((failure) => {
    const code = String(failure?.code || failure || "unknown_upstream_failure");
    const retryable = TRANSIENT_FAILURE_CODES.has(code) || failure?.retryable === true;
    return buildActionableError({
      code,
      message: String(failure?.message || `Scope matcher dependency reported ${code}.`),
      retryable,
      retryAfter: retryable ? retryAfterMs(input.failureCount, retryPolicy) : null,
      remediation: String(failure?.remediation || (retryable
        ? "Retry with exponential backoff after refreshing hosted-kernel health."
        : "Escalate to the capability-security owner with the audit proof id."))
    });
  });

  const lifecycleEvaluationDisabled = lifecycle.enabled === false ||
    lifecycle.command === "disable" ||
    lifecycle.command === "pause" ||
    lifecycleControlPlan.effectiveEnabled === false ||
    lifecycleControlPlan.targetState === "paused";
  const operationalScopeGate = buildOperationalScopeGate({
    requestedScopes,
    lifecycle,
    operationalHealth,
    retryPolicy,
    failureCount: input.failureCount,
    now
  });
  const operationalEvaluationBlocked = operationalScopeGate.evaluationBlocked;
  const matches = requestedScopes.map((requestedScope) => {
    const boundary = evaluateScopeBoundary(requestedScope, securityBoundary);
    const readiness = providerReadiness.evaluatedScopes.find((scope) => scope.requestedScope === requestedScope) || {
      accepted: true,
      state: "ready",
      reasons: [],
      contracts: []
    };
    const operationalGate = operationalScopeGate.perScope.find((scope) => scope.requestedScope === requestedScope) || null;
    const providerReadinessBlocked = providerReadinessPolicy.supplied && readiness.state === "blocked";
    const clientSnapshotBlocked = clientRuntime.scopeSnapshot.grantedScopes.length > 0 &&
      !clientRuntime.scopeSnapshot.grantedScopes.some((grantedScope) => scopeMatches(grantedScope, requestedScope));
    const providers = evaluableClaims
      .filter((claim) => {
        const claimTenantAllowed = !claim.tenantId || !securityBoundary.tenantId || claim.tenantId === securityBoundary.tenantId || securityBoundary.policy.allowCrossTenant;
        const claimWorkspaceAllowed = !claim.workspaceId || !securityBoundary.workspaceId || claim.workspaceId === securityBoundary.workspaceId || securityBoundary.policy.allowCrossWorkspace;
        return claimTenantAllowed &&
          claimWorkspaceAllowed &&
          claim.scopes.some((grantedScope) => scopeMatches(grantedScope, requestedScope));
      })
      .map((claim) => {
        const matchingContracts = providerContracts.filter((contract) => (
          (contract.capabilityId === claim.id || contract.providerId === claim.id) &&
          contract.supportedScopes.some((grantedScope) => scopeMatches(grantedScope, requestedScope))
        ));

        return {
          capabilityId: claim.id,
          status: claim.status,
          proof: claim.proof,
          matchedScopes: claim.scopes.filter((grantedScope) => scopeMatches(grantedScope, requestedScope)),
          providerContracts: matchingContracts.map((contract) => ({
            id: contract.id,
            providerId: contract.providerId,
            version: contract.version,
            status: contract.status,
            syncState: contract.sync.state,
            handoffState: contract.handoff.state
          }))
        };
      });

    return {
      requestedScope,
      granted: !lifecycleEvaluationDisabled &&
        !operationalEvaluationBlocked &&
        boundary.allowed &&
        !providerReadinessBlocked &&
        !clientSnapshotBlocked &&
        providers.length > 0,
      lifecycleBlocked: lifecycleEvaluationDisabled,
      operationalBlocked: operationalEvaluationBlocked,
      providerReadinessBlocked,
      providerReadiness: {
        state: readiness.state,
        accepted: readiness.accepted,
        reasons: readiness.reasons,
        contractIds: readiness.contracts.map((contract) => contract.contractId),
        proofReceiptCount: readiness.contracts.filter((contract) => contract.proof).length
      },
      boundaryBlocked: !boundary.allowed,
      boundary,
      clientSnapshotBlocked,
      operationalHealth: {
        state: operationalHealth.state,
        mode: operationalHealth.mode,
        circuitBreakerState: operationalHealth.circuitBreaker.state,
        requiredFailureIds: operationalHealth.requiredFailureIds,
        gateState: operationalGate?.state || operationalScopeGate.state,
        gateDecision: operationalGate?.decision || "allow",
        gateReasons: operationalGate?.reasons || operationalScopeGate.reasons,
        retryAfterMs: operationalGate?.retryAfterMs || null,
        nextProbeAt: operationalGate?.nextProbeAt || null
      },
      operationalGate,
      clientRuntime: {
        clientId: clientRuntime.clientId,
        requestId: clientRuntime.requestId,
        sessionId: clientRuntime.sessionId,
        state: clientRuntime.state,
        workflowState: clientRuntime.workflowState,
        snapshotContainsScope: !clientSnapshotBlocked
      },
      providers
    };
  });

  const deniedScopes = lifecycleEvaluationDisabled || operationalEvaluationBlocked
    ? requestedScopes
    : matches.filter((match) => !match.granted).map((match) => match.requestedScope);
  const degradedClaims = capabilityClaims.filter((claim) => claim.status === "degraded").map((claim) => claim.id);
  const disabledClaims = capabilityClaims.filter((claim) => claim.status === "disabled").map((claim) => claim.id);
  const hardErrors = [
    ...validationErrors.filter((failure) => !failure.retryable),
    ...upstreamFailures.filter((failure) => !failure.retryable)
  ];
  const retryableErrors = [...validationErrors, ...upstreamFailures].filter((failure) => failure.retryable);
  const degraded = degradedClaims.length > 0 ||
    retryableErrors.length > 0 ||
    upstreamHealth.degraded === true ||
    operationalHealth.mode === "degraded" ||
    operationalHealth.degradedDependencyIds.length > 0 ||
    operationalHealth.circuitBreaker.state === "half_open";
  const ok = hardErrors.length === 0 && deniedScopes.length === 0;
  const health = hardErrors.length > 0
    ? "failed"
    : degraded || deniedScopes.length > 0
      ? "degraded"
      : "healthy";

  const audit = {
    proofId: `${surfaceId}:${now}:${requestedScopes.join(",") || "no-scope"}`,
    decision: ok ? "allow" : "deny",
    deniedScopes,
    degradedClaims,
    disabledClaims,
    evidenceCount: evidence.length,
    lifecycleCommand: lifecycle.command,
    lifecycleCommandId: lifecycle.commandId,
    lifecycleTargetState: lifecycleControlPlan.targetState,
    lifecycleControlNextAction: lifecycleControlPlan.nextAction,
    lifecycleControlBlockers: lifecycleControlPlan.blockers,
    lifecycleState: lifecycleEvaluationDisabled ? "evaluation_disabled" : "evaluation_enabled",
    operationalState: operationalHealth.state,
    operationalMode: operationalHealth.mode,
    operationalRegion: operationalHealth.region,
    operationalCellId: operationalHealth.cellId,
    operationalRequiredFailureIds: operationalHealth.requiredFailureIds,
    operationalDegradedDependencyIds: operationalHealth.degradedDependencyIds,
    operationalCircuitBreakerState: operationalHealth.circuitBreaker.state,
    operationalScopeGateState: operationalScopeGate.state,
    operationalScopeGateNextAction: operationalScopeGate.nextAction,
    operationalScopeGateRetryAfterMs: operationalScopeGate.retryAfterMs,
    operationalScopeGateDeniedScopeCount: operationalScopeGate.deniedScopeCount,
    operationalScopeGateGuardedScopeCount: operationalScopeGate.guardedScopeCount,
    operationalScopeGateReasons: operationalScopeGate.reasons,
    providerReadinessPolicy: {
      requireProviderContract: providerReadinessPolicy.requireProviderContract,
      requireCurrentSync: providerReadinessPolicy.requireCurrentSync,
      requireProofReceipt: providerReadinessPolicy.requireProofReceipt,
      maxSyncLagMs: providerReadinessPolicy.maxSyncLagMs
    },
    providerReadinessBlockedScopes: providerReadiness.evaluatedScopes
      .filter((scope) => scope.state === "blocked")
      .map((scope) => ({
        requestedScope: scope.requestedScope,
        reasons: scope.reasons,
        providerContractIds: scope.contracts.map((contract) => contract.contractId)
      })),
    providerProofReceiptCount: providerReadiness.proofReceiptCount,
    scheduleMode: schedule.mode,
    scheduleActive: lifecycleControlPlan.scheduleActive,
    persistedStateRevision: persistedState.revision,
    persistedStateStatus: persistedState.state,
    persistedStateCheckpointId: persistedState.checkpointId,
    clientId: clientRuntime.clientId,
    clientRequestId: clientRuntime.requestId,
    clientRuntimeState: clientRuntime.state,
    clientWorkflowState: clientRuntime.workflowState,
    clientWorkflowId: clientRuntime.workflowId,
    clientRouteId: clientRuntime.routeId,
    clientIdempotencyKey: clientRuntime.idempotencyKey,
    clientHandoffPriority: clientRuntime.handoff.priority,
    clientHandoffAcceptedActions: clientRuntime.handoff.acceptedActions,
    clientHandoffSuppressedActions: clientRuntime.handoff.suppressedActions,
    clientScopeSnapshotFingerprint: clientRuntime.scopeSnapshot.grantedFingerprint,
    tenantId: securityBoundary.tenantId,
    workspaceId: securityBoundary.workspaceId,
    actorId: securityBoundary.actor.id,
    actorRoles: securityBoundary.actor.roles,
    actorPermissionCount: securityBoundary.actor.permissions.length,
    actorDirectPermissionCount: securityBoundary.actor.directPermissions.length,
    actorRoleDerivedPermissionCount: securityBoundary.actor.roleDerivedPermissions.length,
    actorMissingRoleBindings: securityBoundary.actor.missingRoleBindings,
    boundaryPartitionPolicy: {
      requireTenantForWorkspace: securityBoundary.policy.requireTenantForWorkspace,
      requireBoundedWorkspaceGrant: securityBoundary.policy.requireBoundedWorkspaceGrant,
      allowedTenantIds: securityBoundary.policy.allowedTenantIds,
      allowedWorkspaceIds: securityBoundary.policy.allowedWorkspaceIds,
      deniedTenantIds: securityBoundary.policy.deniedTenantIds,
      deniedWorkspaceIds: securityBoundary.policy.deniedWorkspaceIds
    },
    boundaryDeniedScopes: matches
      .filter((match) => match.boundaryBlocked)
      .map((match) => ({
        requestedScope: match.requestedScope,
        tenantId: match.boundary.effectiveTenantId,
        workspaceId: match.boundary.effectiveWorkspaceId,
        reasons: match.boundary.reasons,
        missingPermissions: match.boundary.missingPermissions,
        roleDerivedPermissionCount: match.boundary.roleDerivedPermissionCount,
        rolesWithoutPermissionBindings: match.boundary.rolesWithoutPermissionBindings
      })),
    providerContractIds: providerContracts.map((contract) => contract.id),
    providerContractSyncStates: Object.fromEntries(providerContracts.map((contract) => [contract.id, contract.sync.state]))
  };
  const errors = [...validationErrors, ...upstreamFailures];
  const analytics = buildAnalyticsCounters({
    requestedScopes,
    capabilityClaims,
    matches,
    errors,
    upstreamFailures,
    historySnapshots
  });
  const analyticsExportSettings = normalizeAnalyticsExportSettings(input, now);
  const exportSummary = {
    surfaceId,
    generatedAt: now,
    decision: audit.decision,
    health,
    analyticsContract: "hosted-kernel.scope-matcher.export-summary.v1",
    exportDataset: analyticsExportSettings.sink.dataset,
    exportPartitionKey: analyticsExportSettings.sink.partitionKey,
    exportWindow: analyticsExportSettings.window,
    exportFormats: analyticsExportSettings.exportFormats,
    requestedScopeCount: analytics.requestedScopeCount,
    grantedScopeCount: analytics.grantedScopeCount,
    deniedScopeCount: analytics.deniedScopeCount,
    deniedScopes,
    degradedClaimCount: analytics.degradedClaimCount,
    dependencyFailureCount: upstreamFailures.length,
    retryableDependencyFailureCount: analytics.retryableDependencyFailureCount,
    operationalHealthState: operationalHealth.state,
    operationalMode: operationalHealth.mode,
    operationalHeartbeatStale: operationalHealth.heartbeatStale,
    operationalRequiredFailureCount: operationalHealth.requiredFailureIds.length,
    operationalDegradedDependencyCount: operationalHealth.degradedDependencyIds.length,
    operationalScopeGateState: operationalScopeGate.state,
    operationalScopeGateNextAction: operationalScopeGate.nextAction,
    operationalScopeGateRetryAfterMs: operationalScopeGate.retryAfterMs,
    operationalScopeGateDeniedScopeCount: operationalScopeGate.deniedScopeCount,
    operationalScopeGateGuardedScopeCount: operationalScopeGate.guardedScopeCount,
    circuitBreakerState: operationalHealth.circuitBreaker.state,
    proofId: audit.proofId,
    historySnapshotCount: analytics.historySnapshotCount,
    lastHistoryProofId: historySnapshots.at(-1)?.proofId || null,
    lifecycleCommand: lifecycle.command,
    lifecycleCommandId: lifecycle.commandId,
    lifecycleEnabled: !lifecycleEvaluationDisabled,
    lifecycleTargetState: lifecycleControlPlan.targetState,
    lifecycleControlNextAction: lifecycleControlPlan.nextAction,
    lifecycleControlBlockerCount: lifecycleControlPlan.blockers.length,
    scheduleMode: schedule.mode,
    scheduleActive: lifecycleControlPlan.scheduleActive,
    nextRunAt: schedule.nextRunAt,
    providerContractCount: providerContracts.length,
    providerContractsCurrent: providerContracts.every((contract) => contract.sync.state === "current" || contract.sync.state === "unknown"),
    providerReadinessPolicySupplied: providerReadinessPolicy.supplied,
    providerReadyScopeCount: providerReadiness.readyScopeCount,
    providerWarningScopeCount: providerReadiness.warningScopeCount,
    providerBlockedScopeCount: providerReadiness.blockedScopeCount,
    providerProofReceiptCount: providerReadiness.proofReceiptCount,
    clientRuntimeState: clientRuntime.state,
    clientWorkflowState: clientRuntime.workflowState,
    clientRuntimeSupplied: clientRuntime.supplied,
    clientWorkflowId: clientRuntime.workflowId,
    clientRouteId: clientRuntime.routeId,
    clientHandoffPriority: clientRuntime.handoff.priority,
    clientHandoffRequiresUserVisible: clientRuntime.handoff.requiresUserVisibleHandoff,
    tenantId: securityBoundary.tenantId,
    workspaceId: securityBoundary.workspaceId,
    actorId: securityBoundary.actor.id,
    boundaryDeniedScopeCount: matches.filter((match) => match.boundaryBlocked).length,
    explicitBoundaryDenyScopeCount: analytics.explicitBoundaryDenyScopeCount,
    unboundedWorkspaceScopeCount: analytics.unboundedWorkspaceScopeCount,
    actorRoleCount: securityBoundary.actor.roles.length,
    actorDirectPermissionCount: securityBoundary.actor.directPermissions.length,
    actorRoleDerivedPermissionCount: securityBoundary.actor.roleDerivedPermissions.length,
    actorMissingRoleBindingCount: securityBoundary.actor.missingRoleBindings.length,
    allowedTenantBoundaryCount: securityBoundary.policy.allowedTenantIds.length,
    allowedWorkspaceBoundaryCount: securityBoundary.policy.allowedWorkspaceIds.length,
    deniedTenantBoundaryCount: securityBoundary.policy.deniedTenantIds.length,
    deniedWorkspaceBoundaryCount: securityBoundary.policy.deniedWorkspaceIds.length,
    crossTenantPolicyEnabled: securityBoundary.policy.allowCrossTenant,
    crossWorkspacePolicyEnabled: securityBoundary.policy.allowCrossWorkspace,
    clientScopeSnapshotCurrent: clientRuntime.scopeSnapshot.expiresAt
      ? Date.parse(clientRuntime.scopeSnapshot.expiresAt) > Date.parse(now)
      : null,
    persistedStateSupplied: persistedState.supplied,
    persistedStateStatus: persistedState.state,
    persistedStateRevision: persistedState.revision,
    persistedStateStaleForRequest: persistedState.staleForRequest
  };
  const lifecycleState = buildLifecycleState({
    lifecycle,
    schedule,
    controlPlan: lifecycleControlPlan,
    ok,
    health,
    retryableErrors,
    deniedScopes,
    now
  });
  const operationalRecovery = buildOperationalRecoveryPlan({
    operationalHealth,
    retryableErrors,
    hardErrors,
    retryPolicy,
    failureCount: input.failureCount,
    now
  });
  const operationalFailureState = buildOperationalFailureState({
    operationalHealth,
    operationalRecovery,
    retryableErrors,
    hardErrors,
    matches,
    retryPolicy,
    failureCount: input.failureCount,
    lifecycle,
    audit,
    now
  });
  Object.assign(audit, {
    operationalFailureState: operationalFailureState.state,
    operationalFailureNextAction: operationalFailureState.nextAction,
    operationalFailureRetryAfterMs: operationalFailureState.retry.retryAfterMs,
    operationalFailureActionCount: operationalFailureState.actionQueue.length
  });
  Object.assign(exportSummary, {
    operationalFailureState: operationalFailureState.state,
    operationalFailureNextAction: operationalFailureState.nextAction,
    operationalFailureRetryAfterMs: operationalFailureState.retry.retryAfterMs,
    operationalFailureActionCount: operationalFailureState.actionQueue.length,
    operationalFailureBlockedScopeCount: operationalFailureState.blockedScopes.length
  });
  const statePersistence = buildStatePersistenceRecovery({
    persistedState,
    lifecycle,
    schedule,
    requestedScopes,
    securityBoundary,
    clientRuntime,
    audit,
    ok,
    health,
    retryableErrors,
    hardErrors,
    deniedScopes,
    now
  });
  const analyticsReport = buildAnalyticsHistoryReport({
    analytics,
    matches,
    errors,
    historySnapshots,
    exportSettings: analyticsExportSettings,
    operationalHealth,
    clientRuntime,
    statePersistence,
    now
  });
  const negotiation = buildCapabilityNegotiation({
    requestedScopes,
    matches,
    providerContracts,
    lifecycleEvaluationDisabled,
    operationalEvaluationBlocked
  });
  const externalHandoff = buildExternalHandoffState({
    negotiation,
    deniedScopes,
    upstreamFailures,
    lifecycleState,
    providerContracts,
    now
  });
  const providerServiceRegistry = buildProviderServiceContractRegistry({
    providerContracts,
    negotiation,
    externalHandoff,
    now
  });
  Object.assign(audit, {
    providerServiceRegistryState: providerServiceRegistry.state,
    providerServiceRegistryProviderCount: providerServiceRegistry.providerCount,
    providerServiceRegistryBlockedProviderCount: providerServiceRegistry.blockedProviderCount,
    providerServiceRegistryDispatchableProviderCount: providerServiceRegistry.dispatchableProviderCount,
    providerServiceRegistryMaxSyncLagMs: providerServiceRegistry.maxSyncLagMs,
    providerHandoffLeaseCount: providerServiceRegistry.handoffLeases.length
  });
  Object.assign(exportSummary, {
    providerServiceRegistryState: providerServiceRegistry.state,
    providerServiceRegistryProviderCount: providerServiceRegistry.providerCount,
    providerServiceRegistryBlockedProviderCount: providerServiceRegistry.blockedProviderCount,
    providerServiceRegistryDispatchableProviderCount: providerServiceRegistry.dispatchableProviderCount,
    providerServiceRegistryMaxSyncLagMs: providerServiceRegistry.maxSyncLagMs,
    providerHandoffLeaseCount: providerServiceRegistry.handoffLeases.length
  });
  const clientWorkflowHandoff = buildClientWorkflowHandoff({
    clientRuntime,
    externalHandoff,
    deniedScopes,
    matches,
    errors,
    now
  });
  const validationSummary = buildValidationSummary({
    errors,
    matches,
    requestedScopes,
    providerReadiness,
    operationalHealth,
    clientRuntime,
    statePersistence,
    now
  });
  const previewReadiness = buildPreviewReadiness({
    ok,
    health,
    degraded,
    matches,
    errors,
    audit,
    lifecycleState,
    operationalRecovery,
    clientWorkflowHandoff,
    now
  });
  const previewAcceptanceRequest = normalizePreviewAcceptance(input, deniedScopes, now);
  const previewAcceptance = buildPreviewAcceptanceContract({
    previewReadiness,
    previewAcceptance: previewAcceptanceRequest,
    deniedScopes,
    errors,
    audit,
    now
  });
  const clientAdoptionPlan = buildClientAdoptionPlan({
    clientRuntime,
    clientWorkflowHandoff,
    previewAcceptance,
    validationSummary,
    deniedScopes,
    now
  });
  const clientRuntimeAdoptionCommit = buildClientRuntimeAdoptionCommit({
    clientRuntime,
    clientWorkflowHandoff,
    clientAdoptionPlan,
    previewReadiness,
    previewAcceptance,
    validationSummary,
    matches,
    statePersistence,
    audit,
    now
  });
  Object.assign(audit, {
    clientRuntimeAdoptionCommitState: clientRuntimeAdoptionCommit.state,
    clientRuntimeAdoptionDispatchReady: clientRuntimeAdoptionCommit.dispatch.ready,
    clientRuntimeAdoptionBlockedScopeCount: clientRuntimeAdoptionCommit.counts.blockedScopeCount,
    clientRuntimeAdoptionSnapshotRefreshScopeCount: clientRuntimeAdoptionCommit.counts.snapshotRefreshScopeCount,
    clientRuntimeAdoptionAcknowledgementScopeCount: clientRuntimeAdoptionCommit.counts.acknowledgementScopeCount,
    clientRuntimeAdoptionBlockers: clientRuntimeAdoptionCommit.blockers
  });
  Object.assign(exportSummary, {
    clientRuntimeAdoptionCommitState: clientRuntimeAdoptionCommit.state,
    clientRuntimeAdoptionDispatchReady: clientRuntimeAdoptionCommit.dispatch.ready,
    clientRuntimeAdoptionAdoptedScopeCount: clientRuntimeAdoptionCommit.counts.adoptedScopeCount,
    clientRuntimeAdoptionBlockedScopeCount: clientRuntimeAdoptionCommit.counts.blockedScopeCount,
    clientRuntimeAdoptionSnapshotRefreshScopeCount: clientRuntimeAdoptionCommit.counts.snapshotRefreshScopeCount,
    clientRuntimeAdoptionAcknowledgementScopeCount: clientRuntimeAdoptionCommit.counts.acknowledgementScopeCount
  });
  const explainableNextSteps = buildExplainableNextSteps({
    previewReadiness,
    validationSummary,
    previewAcceptance,
    externalHandoff,
    clientWorkflowHandoff,
    operationalRecovery,
    statePersistence
  });
  const clientPreviewRoute = buildClientPreviewRouteContract({
    previewReadiness,
    previewAcceptance,
    validationSummary,
    clientWorkflowHandoff,
    clientAdoptionPlan,
    explainableNextSteps,
    audit,
    clientRuntime,
    now
  });
  const timeline = buildTimeline({ now, requestedScopes, matches, upstreamFailures, historySnapshots });
  const analyticsExportManifest = buildAnalyticsExportManifest({
    analyticsReport,
    exportSummary,
    exportSettings: analyticsExportSettings,
    timeline,
    errors,
    audit,
    requestedScopes,
    analytics,
    health,
    lifecycle,
    operationalHealth,
    securityBoundary,
    statePersistence,
    previewReadiness,
    previewAcceptance,
    now
  });
  const reporting = {
    contract: "hosted-kernel.scope-matcher.reporting-state.v1",
    status: statePersistence.recoveryRequired
      ? "recovery_required"
      : statePersistence.replayed
        ? "idempotent_replay"
        : ok
          ? "ready"
          : retryableErrors.length > 0 && hardErrors.length === 0 ? "retryable" : "action_required",
    reportKey: `${surfaceGroup}/${surfaceName}/${now}`,
    exportFormats: analyticsExportSettings.exportFormats,
    exportSink: analyticsExportSettings.sink,
    exportWindow: analyticsExportSettings.window,
    exportReady: analyticsExportManifest.ready,
    exportArtifactCount: analyticsExportManifest.artifactCount,
    exportBlockedReason: analyticsExportManifest.blockedReason,
    nextHistorySnapshot: analyticsExportManifest.nextHistorySnapshot,
    counters: analytics,
    trends: analyticsReport.trend,
    topDeniedScopes: analyticsReport.topDeniedScopes,
    deniedReasonCounts: analyticsReport.deniedReasonCounts,
    errorCodeCounts: analyticsReport.errorCodeCounts,
    healthFlags: analyticsReport.healthFlags,
    operationalFailureState: {
      state: operationalFailureState.state,
      nextAction: operationalFailureState.nextAction,
      retryable: operationalFailureState.retry.retryable,
      retryAfterMs: operationalFailureState.retry.retryAfterMs,
      nextProbeAt: operationalFailureState.retry.nextProbeAt,
      actionCount: operationalFailureState.actionQueue.length,
      blockedScopeCount: operationalFailureState.blockedScopes.length,
      degradedModeActive: operationalFailureState.degradedMode.active
    },
    operationalScopeGate: {
      contract: operationalScopeGate.contract,
      state: operationalScopeGate.state,
      nextAction: operationalScopeGate.nextAction,
      evaluationBlocked: operationalScopeGate.evaluationBlocked,
      retryable: operationalScopeGate.retryable,
      retryAfterMs: operationalScopeGate.retryAfterMs,
      nextProbeAt: operationalScopeGate.nextProbeAt,
      deniedScopeCount: operationalScopeGate.deniedScopeCount,
      guardedScopeCount: operationalScopeGate.guardedScopeCount,
      reasons: operationalScopeGate.reasons
    },
    lifecycleControls: {
      contract: lifecycleControlPlan.contract,
      targetState: lifecycleControlPlan.targetState,
      effectiveEnabled: lifecycleControlPlan.effectiveEnabled,
      scheduleActive: lifecycleControlPlan.scheduleActive,
      blockerCount: lifecycleControlPlan.blockers.length,
      blockers: lifecycleControlPlan.blockers,
      nextAction: lifecycleControlPlan.nextAction
    },
    validationSummary,
    previewReadiness: {
      state: previewReadiness.state,
      canAccept: previewReadiness.canAccept,
      requiresAcknowledgement: previewReadiness.requiresAcknowledgement,
      primaryAction: previewReadiness.primaryAction,
      previewRevision: previewReadiness.previewRevision
    },
    previewAcceptance: {
      state: previewAcceptance.state,
      accepted: previewAcceptance.accepted,
      nextAction: previewAcceptance.nextAction,
      revisionMatches: previewAcceptance.revisionMatches
    },
    clientPreviewRoute: {
      contract: clientPreviewRoute.contract,
      state: clientPreviewRoute.state,
      routeId: clientPreviewRoute.routeId,
      actionCount: clientPreviewRoute.actions.length,
      acceptanceDisabledReasons: clientPreviewRoute.acceptance.disabledReasons,
      rowCount: clientPreviewRoute.rows.length
    },
    clientAdoptionPlan: {
      state: clientAdoptionPlan.state,
      queuedActionCount: clientAdoptionPlan.queuedActions.length,
      blockerCount: clientAdoptionPlan.blockers.length,
      idempotencyKey: clientAdoptionPlan.idempotencyKey,
      resumeWhen: clientAdoptionPlan.resumeWhen
    },
    clientRuntimeAdoptionCommit: {
      contract: clientRuntimeAdoptionCommit.contract,
      state: clientRuntimeAdoptionCommit.state,
      dispatchReady: clientRuntimeAdoptionCommit.dispatch.ready,
      dispatchAction: clientRuntimeAdoptionCommit.dispatch.action,
      blockerCount: clientRuntimeAdoptionCommit.blockers.length,
      adoptedScopeCount: clientRuntimeAdoptionCommit.counts.adoptedScopeCount,
      snapshotRefreshScopeCount: clientRuntimeAdoptionCommit.counts.snapshotRefreshScopeCount,
      acknowledgementScopeCount: clientRuntimeAdoptionCommit.counts.acknowledgementScopeCount,
      resumeWhen: clientRuntimeAdoptionCommit.resumeWhen
    },
    providerServiceRegistry: {
      contract: providerServiceRegistry.contract,
      state: providerServiceRegistry.state,
      providerCount: providerServiceRegistry.providerCount,
      readyProviderCount: providerServiceRegistry.readyProviderCount,
      warningProviderCount: providerServiceRegistry.warningProviderCount,
      blockedProviderCount: providerServiceRegistry.blockedProviderCount,
      dispatchableProviderCount: providerServiceRegistry.dispatchableProviderCount,
      acceptedScopeCount: providerServiceRegistry.acceptedScopeCount,
      blockedScopeCount: providerServiceRegistry.blockedScopeCount,
      syncCurrentProviderCount: providerServiceRegistry.syncCurrentProviderCount,
      maxSyncLagMs: providerServiceRegistry.maxSyncLagMs,
      handoffLeaseCount: providerServiceRegistry.handoffLeases.length
    },
    nextSteps: explainableNextSteps,
    summary: exportSummary,
    timeline,
    exportManifest: {
      contract: analyticsExportManifest.contract,
      exportId: analyticsExportManifest.exportId,
      ready: analyticsExportManifest.ready,
      blockedReason: analyticsExportManifest.blockedReason,
      artifactCount: analyticsExportManifest.artifactCount,
      artifactKeys: analyticsExportManifest.artifacts.map((artifact) => artifact.artifactKey),
      reportIndexes: analyticsExportManifest.reportIndexes
    }
  };

  return {
    ok,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: "hosted-kernel capability scope matcher health and decision contract",
    health,
    degraded,
    requestedScopes,
    operationalHealth,
    operationalScopeGate,
    operationalRecovery,
    operationalFailureState,
    securityBoundary,
    clientRuntime,
    matches,
    errors,
    retry: retryableErrors.length > 0 ? {
      policy: retryPolicy,
      nextRetryAfterMs: Math.max(...retryableErrors.map((error) => error.retryAfterMs || 0))
    } : null,
    lifecycle: lifecycleState,
    lifecycleControlPlan,
    persistedState,
    statePersistence,
    settings: {
      proofRequired: lifecycle.proofRequired,
      auditRequired: lifecycle.auditRequired,
      minProofEvidence: lifecycle.minProofEvidence,
      allowDegradedProviders: lifecycle.allowDegradedProviders,
      lifecycleControls: lifecycle.controls,
      lifecycleTargetState: lifecycleControlPlan.targetState,
      scheduleActive: lifecycleControlPlan.scheduleActive,
      lifecycleControlNextAction: lifecycleControlPlan.nextAction
    },
    audit,
    analytics,
    analyticsExportSettings,
    analyticsReport,
    analyticsExportManifest,
    history: historySnapshots,
    nextHistorySnapshot: analyticsExportManifest.nextHistorySnapshot,
    providerContracts,
    providerReadiness,
    negotiation,
    externalHandoff,
    providerServiceRegistry,
    clientWorkflowHandoff,
    clientAdoptionPlan,
    clientRuntimeAdoptionCommit,
    validationSummary,
    previewReadiness,
    previewAcceptanceRequest,
    previewAcceptance,
    clientPreviewRoute,
    explainableNextSteps,
    exportSummary,
    reporting,
    evidence
  };
}

export default describeScopeMatcherSurface;
