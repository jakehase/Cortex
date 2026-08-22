export const surfaceId = "aios_scheduler_model-policy_056";
export const surfaceGroup = "scheduler";
export const surfaceName = "model-policy";

const DEFAULT_MODEL_CATALOG = [
  {
    id: "hosted-kernel-balanced",
    provider: "aios-hosted-kernel",
    latencyMs: 900,
    maxContextTokens: 64000,
    costTier: "standard",
    capabilities: ["planning", "tool-use", "summarization", "classification", "verification", "review"],
    available: true
  },
  {
    id: "hosted-kernel-fast",
    provider: "aios-hosted-kernel",
    latencyMs: 420,
    maxContextTokens: 16000,
    costTier: "low",
    capabilities: ["classification", "routing", "summarization"],
    available: true
  }
];

const DEFAULT_POLICY = {
  requiredCapabilities: ["planning"],
  maxLatencyMs: 1200,
  minContextTokens: 8000,
  allowFallback: true,
  acceptanceMode: "operator",
  requiredRoles: ["planner", "compact_worker", "verifier", "reviewer"]
};

const POLICY_ROLES = new Set(["planner", "compact_worker", "verifier", "reviewer"]);
const DEFAULT_ROLE_POLICIES = {
  planner: {
    label: "Planner",
    requiredCapabilities: ["planning", "tool-use"],
    maxLatencyMs: 1600,
    minContextTokens: 32000,
    preferredCostTiers: ["standard", "premium"],
    required: true
  },
  compact_worker: {
    label: "Compact worker",
    requiredCapabilities: ["summarization", "routing"],
    maxLatencyMs: 800,
    minContextTokens: 12000,
    preferredCostTiers: ["low", "standard"],
    required: true
  },
  verifier: {
    label: "Verifier",
    requiredCapabilities: ["verification", "classification"],
    maxLatencyMs: 1400,
    minContextTokens: 16000,
    preferredCostTiers: ["standard", "premium"],
    required: true
  },
  reviewer: {
    label: "Reviewer",
    requiredCapabilities: ["review", "planning"],
    maxLatencyMs: 1800,
    minContextTokens: 24000,
    preferredCostTiers: ["standard", "premium"],
    required: true
  }
};

const COST_RANK = new Map([
  ["low", 1],
  ["standard", 2],
  ["premium", 3]
]);
const ROLE_PREFERENCE_POLICIES = new Set(["preferred", "required"]);

const STATUS_RANK = new Map([
  ["unknown", 0],
  ["blocked", 1],
  ["needs-operator-acceptance", 2],
  ["ready", 3],
  ["dispatchable", 4]
]);

const HEALTH_STATES = new Set(["healthy", "degraded", "unhealthy", "unknown"]);
const HARD_HEALTH_FAILURES = new Set(["provider_unavailable", "auth_failed", "quota_exhausted", "circuit_open"]);
const RETRYABLE_HEALTH_FAILURES = new Set(["rate_limited", "timeout", "transient_error", "provider_unavailable"]);
const FAILURE_STATE_SCOPES = new Set(["provider", "model"]);
const ANALYTICS_HISTORY_LIMIT = 12;
const COMMAND_RECEIPT_LIMIT = 24;
const LIFECYCLE_COMMAND_TYPES = new Set([
  "preview",
  "accept",
  "hold",
  "reject",
  "enable",
  "disable",
  "pause",
  "resume",
  "set-schedule",
  "probe-health"
]);
const LIFECYCLE_SCHEDULE_FIELDS = new Set(["enabled", "allowManualOverride", "window"]);
const CONTRACT_SYNC_MODES = new Set(["inline", "async", "webhook"]);
const CONTRACT_HANDOFF_PROTOCOLS = new Set(["hosted-kernel.dispatch.v1", "hosted-kernel.batch.v1"]);
const CONTRACT_AUTH_MODES = new Set(["scoped-token", "tenant-boundary-token", "service-account"]);
const CONTRACT_ACK_MODES = new Set(["receipt", "callback", "poll"]);
const CONTRACT_ACK_ROUTES = {
  receipt: "scheduler.modelPolicy.dispatch.receipt",
  callback: "scheduler.modelPolicy.dispatch.callback",
  poll: "scheduler.modelPolicy.dispatch.poll"
};
const CLIENT_HANDOFF_MODES = new Set(["inline", "modal", "background"]);
const CLIENT_URGENCY_LEVELS = new Set(["low", "normal", "high"]);
const TENANT_ROLE_PERMISSIONS = {
  owner: ["scheduler.modelPolicy.preview", "scheduler.modelPolicy.accept", "scheduler.modelPolicy.dispatch", "scheduler.modelPolicy.admin"],
  operator: ["scheduler.modelPolicy.preview", "scheduler.modelPolicy.accept", "scheduler.modelPolicy.dispatch"],
  reviewer: ["scheduler.modelPolicy.preview", "scheduler.modelPolicy.audit"],
  viewer: ["scheduler.modelPolicy.preview"]
};
const TENANT_REQUIRED_PERMISSIONS = {
  preview: "scheduler.modelPolicy.preview",
  accept: "scheduler.modelPolicy.accept",
  dispatch: "scheduler.modelPolicy.dispatch",
  audit: "scheduler.modelPolicy.audit"
};
const CLIENT_RUNTIME_PROOF_TYPES = new Set([
  "scheduler.model-policy.preview.v1",
  "scheduler.model-policy.dispatch-proof.v1"
]);
const WORKSPACE_ISOLATION_MODES = new Set(["strict", "shared", "audit-only"]);
const WORKSPACE_RESOURCE_ACCESS_MODES = new Set(["read", "write", "read-write"]);

function normalizeWorkspaceResourceRef(ref = {}, workspaceId = "default") {
  if (!ref || typeof ref !== "object" || Array.isArray(ref)) return null;
  const id = typeof ref.id === "string" && ref.id.trim() ? ref.id.trim() : null;
  const uri =
    typeof ref.uri === "string" && ref.uri.trim()
      ? ref.uri.trim()
      : typeof ref.resourceUri === "string" && ref.resourceUri.trim()
        ? ref.resourceUri.trim()
        : id;
  if (!uri) return null;

  const accessMode = WORKSPACE_RESOURCE_ACCESS_MODES.has(ref.accessMode) ? ref.accessMode : "read";
  return {
    schema: "scheduler.model-policy.workspace-resource-ref.v1",
    id: id || uri,
    uri,
    workspaceId:
      typeof ref.workspaceId === "string" && ref.workspaceId.trim() ? ref.workspaceId.trim() : workspaceId,
    tenantId: typeof ref.tenantId === "string" && ref.tenantId.trim() ? ref.tenantId.trim() : null,
    accessMode,
    required: ref.required !== false,
    label: typeof ref.label === "string" && ref.label.trim() ? ref.label.trim() : null,
    source:
      typeof ref.source === "string" && ref.source.trim() ? ref.source.trim() : "client-workspace-context"
  };
}

function normalizeWorkspaceResourceRefs(value, workspaceId) {
  return Array.isArray(value)
    ? value.map((ref) => normalizeWorkspaceResourceRef(ref, workspaceId)).filter(Boolean)
    : [];
}

function resourceMatchesPrefix(uri, prefixes) {
  return prefixes.some((prefix) => uri === prefix || uri.startsWith(prefix));
}

function buildWorkspaceResourceGrant({ ref, workspacePolicy, boundary }) {
  const denied = resourceMatchesPrefix(ref.uri, workspacePolicy.deniedResourcePrefixes);
  const allowed = resourceMatchesPrefix(ref.uri, workspacePolicy.allowedResourcePrefixes);
  const workspaceMatches = ref.workspaceId === boundary.requestedWorkspaceId;
  const tenantMatches = !ref.tenantId || ref.tenantId === boundary.requestedTenantId;
  const crossWorkspaceRead =
    ref.accessMode === "read" && !workspaceMatches && workspacePolicy.allowCrossWorkspaceReads;
  const granted = !denied && tenantMatches && (workspaceMatches || crossWorkspaceRead) && (allowed || crossWorkspaceRead);
  const reasons = [
    ...(denied ? ["resource_prefix_denied"] : []),
    ...(!allowed && !crossWorkspaceRead ? ["resource_prefix_not_allowed"] : []),
    ...(tenantMatches ? [] : ["resource_tenant_mismatch"]),
    ...(workspaceMatches || crossWorkspaceRead ? [] : ["resource_workspace_mismatch"])
  ];

  return {
    schema: "scheduler.model-policy.workspace-resource-grant.v1",
    resourceId: ref.id,
    uri: ref.uri,
    accessMode: ref.accessMode,
    required: ref.required,
    workspaceId: ref.workspaceId,
    tenantId: ref.tenantId,
    granted,
    providerVisible: granted && !denied,
    reasons: [...new Set(reasons)]
  };
}

function normalizePermissionBinding(binding = {}) {
  if (!binding || typeof binding !== "object") return null;
  const permission =
    typeof binding.permission === "string" && binding.permission.trim() ? binding.permission.trim() : null;
  if (!permission) return null;

  return {
    permission,
    tenantId:
      typeof binding.tenantId === "string" && binding.tenantId.trim() ? binding.tenantId.trim() : null,
    workspaceId:
      typeof binding.workspaceId === "string" && binding.workspaceId.trim() ? binding.workspaceId.trim() : null,
    source:
      typeof binding.source === "string" && binding.source.trim() ? binding.source.trim() : "tenant-boundary"
  };
}

function normalizePermissionBindings(value) {
  return Array.isArray(value) ? value.map(normalizePermissionBinding).filter(Boolean) : [];
}

function normalizeRoleBinding(binding = {}) {
  if (!binding || typeof binding !== "object") return null;
  const role = typeof binding.role === "string" && binding.role.trim() ? binding.role.trim() : null;
  const permissions = role && TENANT_ROLE_PERMISSIONS[role] ? TENANT_ROLE_PERMISSIONS[role] : null;
  if (!permissions) return null;

  const tenantId =
    typeof binding.tenantId === "string" && binding.tenantId.trim() ? binding.tenantId.trim() : null;
  const workspaceId =
    typeof binding.workspaceId === "string" && binding.workspaceId.trim() ? binding.workspaceId.trim() : null;
  const expiresAt =
    typeof binding.expiresAt === "string" && binding.expiresAt.trim() ? binding.expiresAt.trim() : null;
  const id =
    typeof binding.id === "string" && binding.id.trim()
      ? binding.id.trim()
      : stableStringify({ role, tenantId, workspaceId, permissions });

  return {
    schema: "scheduler.model-policy.tenant-role-binding.v1",
    id,
    role,
    tenantId,
    workspaceId,
    expiresAt,
    permissions,
    source:
      typeof binding.source === "string" && binding.source.trim()
        ? binding.source.trim()
        : `tenant-role-binding:${role}`
  };
}

function normalizeRoleBindings(value) {
  return Array.isArray(value) ? value.map(normalizeRoleBinding).filter(Boolean) : [];
}

function normalizeWorkspaceBoundaryPolicy(boundary = {}, workspaceId = "default") {
  const policy = boundary.workspacePolicy && typeof boundary.workspacePolicy === "object" ? boundary.workspacePolicy : {};
  const isolationMode = WORKSPACE_ISOLATION_MODES.has(policy.isolationMode) ? policy.isolationMode : "strict";
  const allowedResourcePrefixes = uniqueStrings(policy.allowedResourcePrefixes);
  const deniedResourcePrefixes = uniqueStrings(policy.deniedResourcePrefixes);

  return {
    schema: "scheduler.model-policy.workspace-boundary-policy.v1",
    workspaceId,
    isolationMode,
    requireExplicitWorkspaceScope:
      policy.requireExplicitWorkspaceScope === true || boundary.requireWorkspaceScopedPermissions === true,
    allowCrossWorkspaceReads: isolationMode !== "strict" && policy.allowCrossWorkspaceReads === true,
    providerMayReceiveTenantId: policy.providerMayReceiveTenantId === true,
    proofAudience:
      typeof policy.proofAudience === "string" && policy.proofAudience.trim()
        ? policy.proofAudience.trim()
        : "scheduler.modelPolicy.audit",
    allowedResourcePrefixes: allowedResourcePrefixes.length
      ? allowedResourcePrefixes
      : [`workspace/${workspaceId}/`, `tenant-workspace/${workspaceId}/`],
    deniedResourcePrefixes
  };
}

function roleBindingsToPermissionBindings(roleBindings, now) {
  const parsedNow = Date.parse(now);
  const currentMs = Number.isFinite(parsedNow) ? parsedNow : Date.now();

  return roleBindings.flatMap((binding) => {
    const expiresMs = binding.expiresAt ? Date.parse(binding.expiresAt) : null;
    if (binding.expiresAt && (!Number.isFinite(expiresMs) || expiresMs <= currentMs)) return [];

    return binding.permissions.map((permission) => ({
      permission,
      tenantId: binding.tenantId,
      workspaceId: binding.workspaceId,
      source: binding.source,
      role: binding.role,
      roleBindingId: binding.id,
      expiresAt: binding.expiresAt
    }));
  });
}

function roleBindingMatchesScope(binding, { tenantId, workspaceId }) {
  const tenantMatches = !binding.tenantId || binding.tenantId === tenantId;
  const workspaceMatches = !binding.workspaceId || binding.workspaceId === workspaceId;
  return tenantMatches && workspaceMatches;
}

function explainRoleBindingState(binding, scope, now) {
  const parsedNow = Date.parse(now);
  const currentMs = Number.isFinite(parsedNow) ? parsedNow : Date.now();
  const expiresMs = binding.expiresAt ? Date.parse(binding.expiresAt) : null;
  const expiryValid = !binding.expiresAt || Number.isFinite(expiresMs);
  const active = expiryValid && (!binding.expiresAt || expiresMs > currentMs);
  const scopedToRequest = roleBindingMatchesScope(binding, scope);

  return {
    id: binding.id,
    role: binding.role,
    tenantId: binding.tenantId,
    workspaceId: binding.workspaceId,
    source: binding.source,
    permissions: binding.permissions,
    expiresAt: binding.expiresAt,
    scopedToRequest,
    active,
    state: !expiryValid ? "invalid-expiry" : !active ? "expired" : scopedToRequest ? "active-for-request" : "active-out-of-scope"
  };
}

function bindingMatchesScope(binding, { tenantId, workspaceId }) {
  const tenantMatches = !binding.tenantId || binding.tenantId === tenantId;
  const workspaceMatches = !binding.workspaceId || binding.workspaceId === workspaceId;
  return tenantMatches && workspaceMatches;
}

function hasScopedPermission(boundary, permission, scope) {
  const hasAdminGrant = boundary.permissionGrants.includes("scheduler.modelPolicy.admin");
  const hasGlobalGrant = boundary.permissionGrants.includes(permission);
  const hasScopedGrant = boundary.permissionBindings.some(
    (binding) => binding.permission === permission && bindingMatchesScope(binding, scope)
  );
  return hasAdminGrant || hasScopedGrant || (!boundary.requireWorkspaceScopedPermissions && hasGlobalGrant);
}

function explainScopedPermission(boundary, permission, scope) {
  if (boundary.permissionGrants.includes("scheduler.modelPolicy.admin")) return "admin-grant";
  const scopedBinding = boundary.permissionBindings.find(
    (binding) => binding.permission === permission && bindingMatchesScope(binding, scope)
  );
  if (scopedBinding) {
    if (scopedBinding.role) {
      return scopedBinding.workspaceId
        ? `workspace-role:${scopedBinding.role}:${scopedBinding.workspaceId}`
        : scopedBinding.tenantId
          ? `tenant-role:${scopedBinding.role}:${scopedBinding.tenantId}`
          : `unscoped-role:${scopedBinding.role}`;
    }
    return scopedBinding.workspaceId
      ? `workspace-binding:${scopedBinding.workspaceId}`
      : scopedBinding.tenantId
        ? `tenant-binding:${scopedBinding.tenantId}`
        : "unscoped-binding";
  }
  if (!boundary.requireWorkspaceScopedPermissions && boundary.permissionGrants.includes(permission)) return "global-grant";
  return "missing";
}

function hasWorkspaceScopedPermission(boundary, permission, scope) {
  if (boundary.permissionGrants.includes("scheduler.modelPolicy.admin")) return true;
  return boundary.permissionBindings.some(
    (binding) =>
      binding.permission === permission &&
      binding.tenantId === scope.tenantId &&
      binding.workspaceId === scope.workspaceId
  );
}

function buildWorkspaceScopeContract({
  now,
  boundary,
  command,
  externalHandoff,
  permissionScope,
  requiredPermissions,
  permissionProofs
}) {
  const workspacePolicy = boundary.workspacePolicy;
  const dispatchRequested = externalHandoff.state === "ready-for-provider" || command.type === "accept";
  const permissionsRequiringExplicitWorkspaceScope = workspacePolicy.requireExplicitWorkspaceScope && dispatchRequested
    ? requiredPermissions.filter((permission) => !hasWorkspaceScopedPermission(boundary, permission, permissionScope))
    : [];
  const crossWorkspaceReadBlocked =
    workspacePolicy.isolationMode === "strict" &&
    boundary.workspaceId !== boundary.requestedWorkspaceId &&
    !workspacePolicy.allowCrossWorkspaceReads;
  const blockedResourcePrefixes = workspacePolicy.allowedResourcePrefixes.filter((prefix) =>
    workspacePolicy.deniedResourcePrefixes.some((deniedPrefix) => prefix.startsWith(deniedPrefix) || deniedPrefix.startsWith(prefix))
  );
  const resourceGrants = boundary.requestedResources.map((ref) =>
    buildWorkspaceResourceGrant({ ref, workspacePolicy, boundary })
  );
  const blockedResourceGrants = resourceGrants.filter((grant) => grant.required && !grant.granted);
  const blockingReasons = [
    ...permissionsRequiringExplicitWorkspaceScope.map((permission) => `workspace_scope_required:${permission}`),
    ...(crossWorkspaceReadBlocked ? ["workspace_scope_cross_read_denied"] : []),
    ...(blockedResourcePrefixes.length ? ["workspace_resource_prefix_conflict"] : []),
    ...blockedResourceGrants.map((grant) => `workspace_resource_blocked:${grant.resourceId}`)
  ];
  const providerResourceClaims = resourceGrants
    .filter((grant) => grant.providerVisible)
    .map((grant) => ({
      resourceId: grant.resourceId,
      uri: grant.uri,
      accessMode: grant.accessMode,
      workspaceId: grant.workspaceId
    }));
  const providerClaims = {
    schema: "scheduler.model-policy.provider-workspace-claims.v1",
    tenantId: workspacePolicy.providerMayReceiveTenantId ? boundary.requestedTenantId : null,
    workspaceId: boundary.requestedWorkspaceId,
    isolationMode: workspacePolicy.isolationMode,
    allowedResourcePrefixes: workspacePolicy.allowedResourcePrefixes,
    deniedResourcePrefixes: workspacePolicy.deniedResourcePrefixes,
    resourceClaims: providerResourceClaims,
    dispatchKey: externalHandoff.dispatchKey,
    modelId: externalHandoff.modelId,
    handoffProtocol: externalHandoff.handoffProtocol
  };
  const auditClaims = {
    schema: "scheduler.model-policy.workspace-scope-audit.v1",
    generatedAt: now,
    proofAudience: workspacePolicy.proofAudience,
    requestedTenantId: boundary.requestedTenantId,
    requestedWorkspaceId: boundary.requestedWorkspaceId,
    actorId: boundary.actorId,
    commandType: command.type,
    requiredPermissions,
    permissionProofs,
    explicitWorkspaceScopeRequired: workspacePolicy.requireExplicitWorkspaceScope,
    permissionsRequiringExplicitWorkspaceScope,
    crossWorkspaceReadBlocked,
    blockedResourcePrefixes,
    requestedResources: boundary.requestedResources,
    resourceGrants,
    blockedResourceGrants
  };
  const proofId = stableStringify({
    requestedTenantId: boundary.requestedTenantId,
    requestedWorkspaceId: boundary.requestedWorkspaceId,
    commandType: command.type,
    dispatchKey: externalHandoff.dispatchKey,
    requiredPermissions,
    permissionProofs,
    workspacePolicy,
    requestedResources: boundary.requestedResources,
    resourceGrants
  });

  return {
    schema: "scheduler.model-policy.workspace-scope-contract.v1",
    generatedAt: now,
    pass: blockingReasons.length === 0,
    state: blockingReasons.length ? "workspace-scope-blocked" : "workspace-scope-ready",
    blockingReasons,
    requestedTenantId: boundary.requestedTenantId,
    requestedWorkspaceId: boundary.requestedWorkspaceId,
    isolationMode: workspacePolicy.isolationMode,
    requireExplicitWorkspaceScope: workspacePolicy.requireExplicitWorkspaceScope,
    allowCrossWorkspaceReads: workspacePolicy.allowCrossWorkspaceReads,
    requestedResources: boundary.requestedResources,
    resourceGrants,
    providerClaims,
    auditClaims,
    proofType: "scheduler.model-policy.workspace-scope-proof.v1",
    proofId
  };
}

function uniqueStrings(value) {
  return Array.isArray(value)
    ? [...new Set(value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()))]
    : [];
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function makePolicyFingerprint({ request, policy }) {
  return stableStringify({
    taskId: request.taskId,
    workspaceId: request.clientState.workspaceId,
    tenantId: request.clientState.tenantBoundary.tenantId,
    requestedTenantId: request.clientState.tenantBoundary.requestedTenantId,
    requestedWorkspaceId: request.clientState.tenantBoundary.requestedWorkspaceId,
    requestedResources: request.clientState.tenantBoundary.requestedResources,
    requiredCapabilities: policy.requiredCapabilities,
    maxLatencyMs: policy.maxLatencyMs,
    minContextTokens: policy.minContextTokens,
    allowFallback: policy.allowFallback,
    acceptanceMode: policy.acceptanceMode,
    requiredRoles: policy.requiredRoles,
    rolePolicies: policy.rolePolicies
  });
}

function normalizeCommand(command = {}) {
  const type = typeof command.type === "string" && command.type.trim() ? command.type.trim() : "preview";
  return {
    id: typeof command.id === "string" && command.id.trim() ? command.id.trim() : null,
    type,
    modelId: typeof command.modelId === "string" && command.modelId.trim() ? command.modelId.trim() : null,
    policyFingerprint:
      typeof command.policyFingerprint === "string" && command.policyFingerprint.trim()
        ? command.policyFingerprint.trim()
        : null,
    dispatchKey:
      typeof command.dispatchKey === "string" && command.dispatchKey.trim() ? command.dispatchKey.trim() : null,
    reason: typeof command.reason === "string" && command.reason.trim() ? command.reason.trim() : null,
    pauseUntil: typeof command.pauseUntil === "string" && command.pauseUntil.trim() ? command.pauseUntil.trim() : null,
    schedule:
      command.schedule && typeof command.schedule === "object"
        ? {
            ...command.schedule
          }
        : null
  };
}

function buildAcceptanceTruthContract({
  now,
  command,
  selected,
  fallback,
  readiness,
  policyFingerprint,
  capabilityNegotiation
}) {
  const eligibleModels = [
    ...(selected
      ? [
          {
            modelId: selected.id,
            provider: selected.provider,
            role: "selected",
            accepted: selected.accepted
          }
        ]
      : []),
    ...(fallback
      ? [
          {
            modelId: fallback.id,
            provider: fallback.provider,
            role: "fallback",
            accepted: fallback.accepted
          }
        ]
      : [])
  ];
  const eligibleModelIds = eligibleModels.map((model) => model.modelId);
  const selectedOffer =
    capabilityNegotiation.offers.find((offer) => offer.modelId === command.modelId) || null;
  const acceptRequested = command.type === "accept";
  const modelBindingState = !acceptRequested
    ? "not-requested"
    : !command.modelId
      ? "missing-command-model"
      : eligibleModelIds.includes(command.modelId)
        ? "bound-to-current-preview"
        : "stale-or-foreign-model";
  const fingerprintState = !acceptRequested
    ? "not-requested"
    : !command.policyFingerprint
      ? "missing-policy-fingerprint"
      : command.policyFingerprint === policyFingerprint
        ? "matches-current-policy"
        : "stale-policy-fingerprint";
  const offerState = !acceptRequested
    ? "not-requested"
    : selectedOffer?.dispatchReady
      ? "dispatch-offer-ready"
      : selectedOffer
        ? "dispatch-offer-not-ready"
        : "dispatch-offer-missing";
  const blockingReasons = acceptRequested
    ? [
        ...(readiness.dispatchable ? [] : ["acceptance_readiness_not_dispatchable"]),
        ...(modelBindingState === "missing-command-model" ? ["acceptance_model_id_required"] : []),
        ...(modelBindingState === "stale-or-foreign-model" ? ["acceptance_model_not_in_current_preview"] : []),
        ...(fingerprintState === "missing-policy-fingerprint" ? ["acceptance_policy_fingerprint_required"] : []),
        ...(fingerprintState === "stale-policy-fingerprint" ? ["acceptance_policy_fingerprint_mismatch"] : []),
        ...(offerState === "dispatch-offer-missing" ? ["acceptance_provider_offer_missing"] : []),
        ...(offerState === "dispatch-offer-not-ready" ? ["acceptance_provider_offer_not_dispatch_ready"] : [])
      ]
    : [];

  return {
    schema: "scheduler.model-policy.acceptance-truth.v1",
    generatedAt: now,
    acceptRequested,
    pass: !acceptRequested || blockingReasons.length === 0,
    state: !acceptRequested
      ? "acceptance-not-requested"
      : blockingReasons.length
        ? "acceptance-truth-blocked"
        : "acceptance-truth-bound",
    commandModelId: command.modelId,
    currentPolicyFingerprint: policyFingerprint,
    commandPolicyFingerprint: command.policyFingerprint,
    modelBindingState,
    fingerprintState,
    offerState,
    eligibleModels,
    eligibleModelIds,
    selectedOfferModelId: capabilityNegotiation.selectedOfferModelId,
    fallbackOfferModelId: capabilityNegotiation.fallbackOfferModelId,
    blockingReasons: [...new Set(blockingReasons)],
    proofId: stableStringify({
      commandType: command.type,
      commandModelId: command.modelId,
      commandPolicyFingerprint: command.policyFingerprint,
      policyFingerprint,
      eligibleModelIds,
      offerState,
      readinessState: readiness.state,
      dispatchable: readiness.dispatchable
    })
  };
}

function normalizeClientRuntimeState(clientState = {}) {
  const runtime = clientState.runtime && typeof clientState.runtime === "object" ? clientState.runtime : {};
  const supportedHandoffProtocols = uniqueStrings(runtime.supportedHandoffProtocols).filter((protocol) =>
    CONTRACT_HANDOFF_PROTOCOLS.has(protocol)
  );
  const grantedScopes = uniqueStrings(runtime.grantedScopes);
  const acceptedProofTypes = uniqueStrings(runtime.acceptedProofTypes).filter((proofType) =>
    CLIENT_RUNTIME_PROOF_TYPES.has(proofType)
  );
  const maxProviderTimeoutMs =
    Number.isFinite(runtime.maxProviderTimeoutMs) && runtime.maxProviderTimeoutMs > 0
      ? Math.round(runtime.maxProviderTimeoutMs)
      : 30000;

  return {
    schema: "scheduler.model-policy.client-runtime.v1",
    supportedHandoffProtocols: supportedHandoffProtocols.length
      ? supportedHandoffProtocols
      : ["hosted-kernel.dispatch.v1"],
    grantedScopes: grantedScopes.length ? grantedScopes : ["scheduler.dispatch", "model.invoke"],
    acceptedProofTypes: acceptedProofTypes.length
      ? acceptedProofTypes
      : ["scheduler.model-policy.preview.v1", "scheduler.model-policy.dispatch-proof.v1"],
    canBackgroundDispatch: runtime.canBackgroundDispatch === true,
    maxProviderTimeoutMs,
    proofSinkRoute:
      typeof runtime.proofSinkRoute === "string" && runtime.proofSinkRoute.trim()
        ? runtime.proofSinkRoute.trim()
        : "scheduler.modelPolicy.audit",
    acknowledgementId:
      typeof runtime.acknowledgementId === "string" && runtime.acknowledgementId.trim()
        ? runtime.acknowledgementId.trim()
        : null
  };
}

function normalizeTenantBoundary(clientState = {}, now = new Date().toISOString()) {
  const boundary = clientState.tenantBoundary && typeof clientState.tenantBoundary === "object" ? clientState.tenantBoundary : {};
  const workspaceId =
    typeof clientState.workspaceId === "string" && clientState.workspaceId.trim()
      ? clientState.workspaceId.trim()
      : "default";
  const tenantId =
    typeof boundary.tenantId === "string" && boundary.tenantId.trim()
      ? boundary.tenantId.trim()
      : typeof clientState.tenantId === "string" && clientState.tenantId.trim()
        ? clientState.tenantId.trim()
        : "default";
  const requestedTenantId =
    typeof boundary.requestedTenantId === "string" && boundary.requestedTenantId.trim()
      ? boundary.requestedTenantId.trim()
      : tenantId;
  const requestedWorkspaceId =
    typeof boundary.requestedWorkspaceId === "string" && boundary.requestedWorkspaceId.trim()
      ? boundary.requestedWorkspaceId.trim()
      : workspaceId;
  const grantedTenantIds = uniqueStrings(boundary.grantedTenantIds);
  const allowedTenantIds = grantedTenantIds.length ? grantedTenantIds : [tenantId];
  const grantedWorkspaceIds = uniqueStrings(boundary.grantedWorkspaceIds);
  const allowedWorkspaceIds = grantedWorkspaceIds.length ? grantedWorkspaceIds : [workspaceId];
  const actorRoles = uniqueStrings(boundary.actorRoles);
  const effectiveActorRoles = actorRoles.length ? actorRoles : ["operator", "reviewer"];
  const inheritedRolePermissions = effectiveActorRoles.flatMap((role) => TENANT_ROLE_PERMISSIONS[role] || []);
  const roleBindings = normalizeRoleBindings(boundary.roleBindings);
  const scopedRolePermissionBindings = roleBindingsToPermissionBindings(roleBindings, now);
  const permissionGrants = [
    ...new Set([
      ...inheritedRolePermissions,
      ...uniqueStrings(boundary.permissionGrants),
      ...scopedRolePermissionBindings
        .filter((binding) => !binding.tenantId && !binding.workspaceId)
        .map((binding) => binding.permission)
    ])
  ];
  const permissionBindings = [
    ...normalizePermissionBindings(boundary.permissionBindings),
    ...scopedRolePermissionBindings.filter((binding) => binding.tenantId || binding.workspaceId)
  ];
  const effectiveAllowedTenantIds = uniqueStrings([
    ...allowedTenantIds,
    ...permissionBindings.map((binding) => binding.tenantId)
  ]);
  const effectiveAllowedWorkspaceIds = uniqueStrings([
    ...allowedWorkspaceIds,
    ...permissionBindings.map((binding) => binding.workspaceId)
  ]);
  const requestedResources = [
    ...normalizeWorkspaceResourceRefs(boundary.requestedResources, requestedWorkspaceId),
    ...normalizeWorkspaceResourceRefs(clientState.workspaceResources, requestedWorkspaceId)
  ];

  return {
    schema: "scheduler.model-policy.tenant-boundary.v1",
    tenantId,
    requestedTenantId,
    workspaceId,
    requestedWorkspaceId,
    allowedTenantIds: effectiveAllowedTenantIds,
    allowedWorkspaceIds: effectiveAllowedWorkspaceIds,
    actorId:
      typeof boundary.actorId === "string" && boundary.actorId.trim()
        ? boundary.actorId.trim()
        : typeof clientState.actorId === "string" && clientState.actorId.trim()
          ? clientState.actorId.trim()
          : null,
    actorRoles: effectiveActorRoles,
    roleBindings,
    permissionGrants,
    permissionBindings,
    requestedResources: [...new Map(requestedResources.map((ref) => [ref.uri, ref])).values()],
    workspacePolicy: normalizeWorkspaceBoundaryPolicy(boundary, requestedWorkspaceId),
    requireWorkspaceScopedPermissions: boundary.requireWorkspaceScopedPermissions === true,
    denyCrossTenantDispatch: boundary.denyCrossTenantDispatch !== false,
    auditTenantRoute:
      typeof boundary.auditTenantRoute === "string" && boundary.auditTenantRoute.trim()
        ? boundary.auditTenantRoute.trim()
        : `tenant.${tenantId}.scheduler.modelPolicy.audit`,
    boundaryToken:
      typeof boundary.boundaryToken === "string" && boundary.boundaryToken.trim() ? boundary.boundaryToken.trim() : null
  };
}

function normalizeClientState(value = {}, now = new Date().toISOString()) {
  const clientState = value && typeof value === "object" ? value : {};
  const handoffMode = CLIENT_HANDOFF_MODES.has(clientState.handoffMode) ? clientState.handoffMode : "inline";
  const urgency = CLIENT_URGENCY_LEVELS.has(clientState.urgency) ? clientState.urgency : "normal";
  const workspaceId =
    typeof clientState.workspaceId === "string" && clientState.workspaceId.trim()
      ? clientState.workspaceId.trim()
      : "default";

  return {
    schema: "scheduler.model-policy.client-state.v1",
    sessionId:
      typeof clientState.sessionId === "string" && clientState.sessionId.trim()
        ? clientState.sessionId.trim()
        : null,
    workspaceId,
    sourceSurface:
      typeof clientState.sourceSurface === "string" && clientState.sourceSurface.trim()
        ? clientState.sourceSurface.trim()
        : "scheduler.model-policy",
    currentRoute:
      typeof clientState.currentRoute === "string" && clientState.currentRoute.trim()
        ? clientState.currentRoute.trim()
        : "scheduler.modelPolicy.preview",
    returnRoute:
      typeof clientState.returnRoute === "string" && clientState.returnRoute.trim()
        ? clientState.returnRoute.trim()
        : "scheduler.queue",
    correlationId:
      typeof clientState.correlationId === "string" && clientState.correlationId.trim()
        ? clientState.correlationId.trim()
        : null,
    pendingActionId:
      typeof clientState.pendingActionId === "string" && clientState.pendingActionId.trim()
        ? clientState.pendingActionId.trim()
        : null,
    handoffMode,
    urgency,
    tenantBoundary: normalizeTenantBoundary({ ...clientState, workspaceId }, now),
    runtime: normalizeClientRuntimeState(clientState),
    visibleToUser: clientState.visibleToUser !== false
  };
}

function normalizePersistedState(state = {}) {
  const lastDecision =
    state && typeof state.lastDecision === "object" && state.lastDecision
      ? {
          commandId:
            typeof state.lastDecision.commandId === "string" && state.lastDecision.commandId.trim()
              ? state.lastDecision.commandId.trim()
              : null,
          type:
            typeof state.lastDecision.type === "string" && state.lastDecision.type.trim()
              ? state.lastDecision.type.trim()
              : "preview",
          modelId:
            typeof state.lastDecision.modelId === "string" && state.lastDecision.modelId.trim()
              ? state.lastDecision.modelId.trim()
              : null,
          status:
            typeof state.lastDecision.status === "string" && STATUS_RANK.has(state.lastDecision.status)
              ? state.lastDecision.status
              : "unknown",
          policyFingerprint:
            typeof state.lastDecision.policyFingerprint === "string" ? state.lastDecision.policyFingerprint : null,
          decidedAt: typeof state.lastDecision.decidedAt === "string" ? state.lastDecision.decidedAt : null
        }
      : null;

  const appliedCommandIds = uniqueStrings(state?.appliedCommandIds);
  if (lastDecision?.commandId && !appliedCommandIds.includes(lastDecision.commandId)) {
    appliedCommandIds.push(lastDecision.commandId);
  }
  const commandReceipts = normalizeCommandReceipts(state?.commandReceipts, lastDecision);
  const roleCheckpoint = normalizePersistedRoleCheckpoint(state?.roleSelection);
  const recoveryIssues = [
    ...(state && typeof state === "object" && state.schema && state.schema !== "scheduler.model-policy.state.v1"
      ? ["state_schema_mismatch"]
      : []),
    ...(lastDecision?.policyFingerprint &&
    typeof state?.policyFingerprint === "string" &&
    state.policyFingerprint !== lastDecision.policyFingerprint
      ? ["last_decision_policy_fingerprint_mismatch"]
      : []),
    ...(roleCheckpoint.present && !roleCheckpoint.ready ? ["persisted_role_checkpoint_not_ready"] : []),
    ...commandReceipts.filter((receipt) => !receipt.policyFingerprint).map((receipt) => `receipt_missing_policy:${receipt.commandId}`)
  ];

  return {
    schema: "scheduler.model-policy.state.v1",
    recovered: Boolean(state && Object.keys(state).length),
    status: typeof state?.status === "string" && STATUS_RANK.has(state.status) ? state.status : "unknown",
    selectedModelId:
      typeof state?.selectedModelId === "string" && state.selectedModelId.trim() ? state.selectedModelId.trim() : null,
    fallbackModelId:
      typeof state?.fallbackModelId === "string" && state.fallbackModelId.trim() ? state.fallbackModelId.trim() : null,
    policyFingerprint: typeof state?.policyFingerprint === "string" ? state.policyFingerprint : null,
    appliedCommandIds,
    commandReceipts,
    recoveryIssues: [...new Set(recoveryIssues)],
    roleCheckpoint,
    lastDecision,
    lifecycleSettings: normalizeLifecycleSettings(state?.lifecycleSettings),
    analyticsHistory: normalizeAnalyticsHistory(state?.analyticsHistory)
  };
}

function normalizeRoleCheckpointMap(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value)
          .filter(([role]) => POLICY_ROLES.has(role))
          .map(([role, modelId]) => [role, typeof modelId === "string" && modelId.trim() ? modelId.trim() : null])
      )
    : {};
}

function normalizePersistedRoleAssignmentCheckpoint(assignment = {}) {
  if (!assignment || typeof assignment !== "object" || Array.isArray(assignment)) return null;
  const role = normalizePolicyRole(assignment.role);
  if (!role) return null;
  return {
    schema: "scheduler.model-policy.role-recovery-assignment.v1",
    role,
    required: assignment.required === true,
    state:
      typeof assignment.state === "string" &&
      ["selected", "fallback", "degraded-fallback", "blocked", "optional-unassigned"].includes(assignment.state)
        ? assignment.state
        : assignment.activeModelId
          ? "selected"
          : assignment.required
            ? "blocked"
            : "optional-unassigned",
    activeModelId:
      typeof assignment.activeModelId === "string" && assignment.activeModelId.trim()
        ? assignment.activeModelId.trim()
        : null,
    activeProvider:
      typeof assignment.activeProvider === "string" && assignment.activeProvider.trim()
        ? assignment.activeProvider.trim()
        : null,
    selectedModelId:
      typeof assignment.selectedModelId === "string" && assignment.selectedModelId.trim()
        ? assignment.selectedModelId.trim()
        : null,
    fallbackModelId:
      typeof assignment.fallbackModelId === "string" && assignment.fallbackModelId.trim()
        ? assignment.fallbackModelId.trim()
        : null
  };
}

function normalizePersistedRoleCheckpoint(roleSelection = {}) {
  if (!roleSelection || typeof roleSelection !== "object" || Array.isArray(roleSelection)) {
    return {
      schema: "scheduler.model-policy.role-recovery-checkpoint.v1",
      present: false,
      ready: false,
      requiredRoles: [],
      blockedRequiredRoles: [],
      fallbackRoles: [],
      activeModelsByRole: {},
      activeProvidersByRole: {},
      assignments: [],
      checkpointId: null
    };
  }

  const assignments = Array.isArray(roleSelection.assignments)
    ? roleSelection.assignments.map(normalizePersistedRoleAssignmentCheckpoint).filter(Boolean)
    : [];
  const activeModelsByRole = Object.keys(normalizeRoleCheckpointMap(roleSelection.activeModelsByRole)).length
    ? normalizeRoleCheckpointMap(roleSelection.activeModelsByRole)
    : Object.fromEntries(assignments.map((assignment) => [assignment.role, assignment.activeModelId]));
  const activeProvidersByRole =
    roleSelection.activeProvidersByRole &&
    typeof roleSelection.activeProvidersByRole === "object" &&
    !Array.isArray(roleSelection.activeProvidersByRole)
      ? Object.fromEntries(
          Object.entries(roleSelection.activeProvidersByRole)
            .filter(([role]) => POLICY_ROLES.has(role))
            .map(([role, provider]) => [
              role,
              typeof provider === "string" && provider.trim() ? provider.trim() : null
            ])
        )
      : Object.fromEntries(assignments.map((assignment) => [assignment.role, assignment.activeProvider]));
  const requiredRoles = uniqueStrings(roleSelection.requiredRoles).map(normalizePolicyRole).filter(Boolean);
  const blockedRequiredRoles = uniqueStrings(roleSelection.blockedRequiredRoles).map(normalizePolicyRole).filter(Boolean);
  const fallbackRoles =
    Array.isArray(roleSelection.dispatchPlan?.fallbackRoles)
      ? uniqueStrings(roleSelection.dispatchPlan.fallbackRoles).map(normalizePolicyRole).filter(Boolean)
      : assignments
          .filter((assignment) => assignment.state === "fallback" || assignment.state === "degraded-fallback")
          .map((assignment) => assignment.role);
  const checkpointSubject = {
    requiredRoles: requiredRoles.length ? requiredRoles : assignments.filter((assignment) => assignment.required).map((assignment) => assignment.role),
    blockedRequiredRoles,
    fallbackRoles,
    activeModelsByRole,
    activeProvidersByRole
  };

  return {
    schema: "scheduler.model-policy.role-recovery-checkpoint.v1",
    present: true,
    ready: roleSelection.ready === true && blockedRequiredRoles.length === 0,
    ...checkpointSubject,
    assignments,
    checkpointId: stableStringify(checkpointSubject)
  };
}

function normalizeCommandReceipt(receipt = {}) {
  if (!receipt || typeof receipt !== "object") return null;
  const commandId =
    typeof receipt.commandId === "string" && receipt.commandId.trim() ? receipt.commandId.trim() : null;
  if (!commandId) return null;
  const type = typeof receipt.type === "string" && receipt.type.trim() ? receipt.type.trim() : "preview";
  const status = typeof receipt.status === "string" && STATUS_RANK.has(receipt.status) ? receipt.status : "unknown";
  const decision =
    receipt.decision && typeof receipt.decision === "object"
      ? {
          commandId,
          type,
          modelId:
            typeof receipt.decision.modelId === "string" && receipt.decision.modelId.trim()
              ? receipt.decision.modelId.trim()
              : null,
          status:
            typeof receipt.decision.status === "string" && STATUS_RANK.has(receipt.decision.status)
              ? receipt.decision.status
              : status,
          policyFingerprint:
            typeof receipt.decision.policyFingerprint === "string"
              ? receipt.decision.policyFingerprint
              : typeof receipt.policyFingerprint === "string"
                ? receipt.policyFingerprint
                : null,
          decidedAt: typeof receipt.decision.decidedAt === "string" ? receipt.decision.decidedAt : null
        }
      : {
          commandId,
          type,
          modelId: typeof receipt.modelId === "string" && receipt.modelId.trim() ? receipt.modelId.trim() : null,
          status,
          policyFingerprint: typeof receipt.policyFingerprint === "string" ? receipt.policyFingerprint : null,
          decidedAt: typeof receipt.decidedAt === "string" ? receipt.decidedAt : null
        };

  return {
    schema: "scheduler.model-policy.command-receipt.v1",
    commandId,
    type,
    status: decision.status,
    modelId: decision.modelId,
    policyFingerprint: decision.policyFingerprint,
    decidedAt: decision.decidedAt,
    applied: receipt.applied === true,
    accepted: receipt.accepted === true || type === "accept",
    lifecycleChanged: receipt.lifecycleChanged === true,
    problems: uniqueStrings(receipt.problems),
    lifecycleSettings:
      receipt.lifecycleSettings && typeof receipt.lifecycleSettings === "object"
        ? normalizeLifecycleSettings(receipt.lifecycleSettings)
        : null,
    decision,
    persistedAt: typeof receipt.persistedAt === "string" && receipt.persistedAt.trim() ? receipt.persistedAt.trim() : null,
    recoveryProofId:
      typeof receipt.recoveryProofId === "string" && receipt.recoveryProofId.trim()
        ? receipt.recoveryProofId.trim()
        : stableStringify({ commandId, type, status: decision.status, modelId: decision.modelId, policyFingerprint: decision.policyFingerprint })
  };
}

function normalizeCommandReceipts(receipts, lastDecision) {
  const normalized = Array.isArray(receipts) ? receipts.map(normalizeCommandReceipt).filter(Boolean) : [];
  if (lastDecision?.commandId && !normalized.some((receipt) => receipt.commandId === lastDecision.commandId)) {
    normalized.push(
      normalizeCommandReceipt({
        commandId: lastDecision.commandId,
        type: lastDecision.type,
        status: lastDecision.status,
        modelId: lastDecision.modelId,
        policyFingerprint: lastDecision.policyFingerprint,
        decidedAt: lastDecision.decidedAt,
        applied: true,
        accepted: lastDecision.type === "accept",
        decision: lastDecision
      })
    );
  }

  return [...new Map(normalized.map((receipt) => [receipt.commandId, receipt])).values()].slice(-COMMAND_RECEIPT_LIMIT);
}

function appendCommandReceipt(receipts, receipt) {
  if (!receipt) return receipts.slice(-COMMAND_RECEIPT_LIMIT);
  const next = receipts.filter((item) => item.commandId !== receipt.commandId);
  next.push(receipt);
  return next.slice(-COMMAND_RECEIPT_LIMIT);
}

function normalizeStringCountMap(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value)
          .filter(([key, count]) => typeof key === "string" && key.trim() && Number.isFinite(count))
          .map(([key, count]) => [key.trim(), Math.max(0, Math.floor(count))])
      )
    : {};
}

function normalizeAnalyticsSnapshot(snapshot = {}) {
  if (!snapshot || typeof snapshot !== "object") return null;
  const counters = snapshot.counters && typeof snapshot.counters === "object" ? snapshot.counters : {};
  const health = snapshot.health && typeof snapshot.health === "object" ? snapshot.health : {};
  const command = snapshot.command && typeof snapshot.command === "object" ? snapshot.command : {};
  const roleCoverage = snapshot.roleCoverage && typeof snapshot.roleCoverage === "object" ? snapshot.roleCoverage : {};
  const providerCoverage =
    snapshot.providerCoverage && typeof snapshot.providerCoverage === "object" ? snapshot.providerCoverage : {};
  const commandRollup = snapshot.commandRollup && typeof snapshot.commandRollup === "object" ? snapshot.commandRollup : {};
  return {
    schema: "scheduler.model-policy.analytics-snapshot.v1",
    generatedAt:
      typeof snapshot.generatedAt === "string" && snapshot.generatedAt.trim() ? snapshot.generatedAt.trim() : null,
    policyFingerprint: typeof snapshot.policyFingerprint === "string" ? snapshot.policyFingerprint : null,
    taskId: typeof snapshot.taskId === "string" && snapshot.taskId.trim() ? snapshot.taskId.trim() : null,
    status: typeof snapshot.status === "string" && STATUS_RANK.has(snapshot.status) ? snapshot.status : "unknown",
    selectedModelId:
      typeof snapshot.selectedModelId === "string" && snapshot.selectedModelId.trim()
        ? snapshot.selectedModelId.trim()
        : null,
    fallbackModelId:
      typeof snapshot.fallbackModelId === "string" && snapshot.fallbackModelId.trim()
        ? snapshot.fallbackModelId.trim()
        : null,
    counters: {
      totalCandidates: Number.isFinite(counters.totalCandidates) ? Math.max(0, Math.floor(counters.totalCandidates)) : 0,
      acceptedCandidates: Number.isFinite(counters.acceptedCandidates)
        ? Math.max(0, Math.floor(counters.acceptedCandidates))
        : 0,
      rejectedCandidates: Number.isFinite(counters.rejectedCandidates)
        ? Math.max(0, Math.floor(counters.rejectedCandidates))
        : 0,
      dispatchBlockedCandidates: Number.isFinite(counters.dispatchBlockedCandidates)
        ? Math.max(0, Math.floor(counters.dispatchBlockedCandidates))
        : 0,
      degradedCandidates: Number.isFinite(counters.degradedCandidates)
        ? Math.max(0, Math.floor(counters.degradedCandidates))
        : 0
    },
    roleCoverage: {
      ready: roleCoverage.ready === true,
      requiredRoles: uniqueStrings(roleCoverage.requiredRoles),
      blockedRequiredRoles: uniqueStrings(roleCoverage.blockedRequiredRoles),
      fallbackRoles: uniqueStrings(roleCoverage.fallbackRoles),
      assignmentStates: normalizeStringCountMap(roleCoverage.assignmentStates),
      activeModelsByRole:
        roleCoverage.activeModelsByRole && typeof roleCoverage.activeModelsByRole === "object"
          ? Object.fromEntries(
              Object.entries(roleCoverage.activeModelsByRole)
                .filter(([role]) => typeof role === "string" && role.trim())
                .map(([role, modelId]) => [role.trim(), typeof modelId === "string" && modelId.trim() ? modelId.trim() : null])
            )
          : {},
      activeProvidersByRole:
        roleCoverage.activeProvidersByRole && typeof roleCoverage.activeProvidersByRole === "object"
          ? Object.fromEntries(
              Object.entries(roleCoverage.activeProvidersByRole)
                .filter(([role]) => typeof role === "string" && role.trim())
                .map(([role, provider]) => [role.trim(), typeof provider === "string" && provider.trim() ? provider.trim() : null])
            )
          : {},
      workspaceBoundaryByRole:
        roleCoverage.workspaceBoundaryByRole && typeof roleCoverage.workspaceBoundaryByRole === "object"
          ? Object.fromEntries(
              Object.entries(roleCoverage.workspaceBoundaryByRole)
                .filter(([role, boundary]) => typeof role === "string" && role.trim() && boundary && typeof boundary === "object")
                .map(([role, boundary]) => [
                  role.trim(),
                  {
                    schema: boundary.schema || "scheduler.model-policy.role-workspace-boundary-evaluation.v1",
                    role: typeof boundary.role === "string" && boundary.role.trim() ? boundary.role.trim() : role.trim(),
                    enabled: boundary.enabled === true,
                    pass: boundary.pass !== false,
                    requestedTenantId:
                      typeof boundary.requestedTenantId === "string" && boundary.requestedTenantId.trim()
                        ? boundary.requestedTenantId.trim()
                        : null,
                    requestedWorkspaceId:
                      typeof boundary.requestedWorkspaceId === "string" && boundary.requestedWorkspaceId.trim()
                        ? boundary.requestedWorkspaceId.trim()
                        : null,
                    blockingReasons: uniqueStrings(boundary.blockingReasons)
                  }
                ])
            )
          : {}
    },
    providerCoverage: {
      activeProviderCounts: normalizeStringCountMap(providerCoverage.activeProviderCounts),
      fallbackProviderCounts: normalizeStringCountMap(providerCoverage.fallbackProviderCounts),
      multiRoleProviders: uniqueStrings(providerCoverage.multiRoleProviders)
    },
    commandRollup: {
      appliedReceiptCount: Number.isFinite(commandRollup.appliedReceiptCount)
        ? Math.max(0, Math.floor(commandRollup.appliedReceiptCount))
        : 0,
      acceptedReceiptCount: Number.isFinite(commandRollup.acceptedReceiptCount)
        ? Math.max(0, Math.floor(commandRollup.acceptedReceiptCount))
        : 0,
      lifecycleReceiptCount: Number.isFinite(commandRollup.lifecycleReceiptCount)
        ? Math.max(0, Math.floor(commandRollup.lifecycleReceiptCount))
        : 0,
      problemReceiptCount: Number.isFinite(commandRollup.problemReceiptCount)
        ? Math.max(0, Math.floor(commandRollup.problemReceiptCount))
        : 0,
      receiptTypeCounts: normalizeStringCountMap(commandRollup.receiptTypeCounts)
    },
    health: {
      state: HEALTH_STATES.has(health.state) ? health.state : "unknown",
      blockedModels: uniqueStrings(health.blockedModels),
      degradedModels: uniqueStrings(health.degradedModels)
    },
    command: {
      type: typeof command.type === "string" && command.type.trim() ? command.type.trim() : "preview",
      applied: Boolean(command.applied),
      replay: Boolean(command.replay)
    }
  };
}

function normalizeAnalyticsHistory(history) {
  return Array.isArray(history)
    ? history.map(normalizeAnalyticsSnapshot).filter(Boolean).slice(-ANALYTICS_HISTORY_LIMIT)
    : [];
}

function normalizePolicyRole(value) {
  return typeof value === "string" && POLICY_ROLES.has(value.trim()) ? value.trim() : null;
}

function normalizeRolePolicyProfile(role, inputProfile = {}, basePolicy = DEFAULT_POLICY) {
  const defaults = DEFAULT_ROLE_POLICIES[role];
  const profile = inputProfile && typeof inputProfile === "object" && !Array.isArray(inputProfile) ? inputProfile : {};
  const requiredCapabilities = uniqueStrings(profile.requiredCapabilities).length
    ? uniqueStrings(profile.requiredCapabilities)
    : defaults.requiredCapabilities;
  const preferredProviders = uniqueStrings(profile.preferredProviders);
  const excludedProviders = uniqueStrings(profile.excludedProviders);
  const preferredModelIds = uniqueStrings(profile.preferredModelIds);
  const preferredCostTiers = uniqueStrings(profile.preferredCostTiers).filter((tier) => COST_RANK.has(tier));
  const providerPreferencePolicy = ROLE_PREFERENCE_POLICIES.has(profile.providerPreferencePolicy)
    ? profile.providerPreferencePolicy
    : profile.requirePreferredProvider === true
      ? "required"
      : "preferred";
  const modelPreferencePolicy = ROLE_PREFERENCE_POLICIES.has(profile.modelPreferencePolicy)
    ? profile.modelPreferencePolicy
    : profile.requirePreferredModel === true
      ? "required"
      : "preferred";

  return {
    schema: "scheduler.model-policy.role-profile.v1",
    role,
    label: typeof profile.label === "string" && profile.label.trim() ? profile.label.trim() : defaults.label,
    required: profile.required === false ? false : defaults.required,
    requiredCapabilities,
    maxLatencyMs: Number.isFinite(profile.maxLatencyMs)
      ? profile.maxLatencyMs
      : Number.isFinite(basePolicy.maxLatencyMs)
        ? Math.max(basePolicy.maxLatencyMs, defaults.maxLatencyMs)
        : defaults.maxLatencyMs,
    minContextTokens: Number.isFinite(profile.minContextTokens)
      ? profile.minContextTokens
      : Math.max(basePolicy.minContextTokens || 0, defaults.minContextTokens),
    preferredProviders,
    excludedProviders,
    preferredModelIds,
    providerPreferencePolicy,
    modelPreferencePolicy,
    preferredCostTiers: preferredCostTiers.length ? preferredCostTiers : defaults.preferredCostTiers,
    workspaceBoundary: normalizeRoleWorkspaceBoundary(profile.workspaceBoundary || profile.workspaceScope),
    allowFallback: profile.allowFallback === false ? false : basePolicy.allowFallback !== false
  };
}

function normalizeRoleWorkspaceBoundary(inputBoundary = {}) {
  const boundary = inputBoundary && typeof inputBoundary === "object" && !Array.isArray(inputBoundary) ? inputBoundary : {};
  const resourceAccessModes = uniqueStrings(boundary.resourceAccessModes).filter((mode) =>
    WORKSPACE_RESOURCE_ACCESS_MODES.has(mode)
  );

  return {
    schema: "scheduler.model-policy.role-workspace-boundary.v1",
    enabled: boundary.enabled === true,
    requireRequestedWorkspace: boundary.requireRequestedWorkspace === true,
    allowedTenantIds: uniqueStrings(boundary.allowedTenantIds),
    deniedTenantIds: uniqueStrings(boundary.deniedTenantIds),
    allowedWorkspaceIds: uniqueStrings(boundary.allowedWorkspaceIds),
    deniedWorkspaceIds: uniqueStrings(boundary.deniedWorkspaceIds),
    allowedResourcePrefixes: uniqueStrings(boundary.allowedResourcePrefixes),
    deniedResourcePrefixes: uniqueStrings(boundary.deniedResourcePrefixes),
    resourceAccessModes: resourceAccessModes.length ? resourceAccessModes : ["read", "write", "read-write"],
    blockOnRequiredResourceMiss: boundary.blockOnRequiredResourceMiss !== false
  };
}

function evaluateRoleWorkspaceBoundary({ roleProfile, request }) {
  const boundary = roleProfile.workspaceBoundary;
  const tenantBoundary = request.clientState.tenantBoundary;
  const requestedTenantId = tenantBoundary.requestedTenantId;
  const requestedWorkspaceId = tenantBoundary.requestedWorkspaceId;
  const requestedResources = tenantBoundary.requestedResources;
  const enabled =
    boundary.enabled ||
    boundary.requireRequestedWorkspace ||
    boundary.allowedTenantIds.length > 0 ||
    boundary.deniedTenantIds.length > 0 ||
    boundary.allowedWorkspaceIds.length > 0 ||
    boundary.deniedWorkspaceIds.length > 0 ||
    boundary.allowedResourcePrefixes.length > 0 ||
    boundary.deniedResourcePrefixes.length > 0;
  const tenantDenied = boundary.deniedTenantIds.includes(requestedTenantId);
  const tenantAllowed = !boundary.allowedTenantIds.length || boundary.allowedTenantIds.includes(requestedTenantId);
  const workspaceDenied = boundary.deniedWorkspaceIds.includes(requestedWorkspaceId);
  const workspaceAllowed =
    !boundary.allowedWorkspaceIds.length || boundary.allowedWorkspaceIds.includes(requestedWorkspaceId);
  const requestedWorkspaceMissing =
    boundary.requireRequestedWorkspace && request.clientState.workspaceId !== requestedWorkspaceId;
  const resourceChecks = requestedResources
    .filter((ref) => boundary.resourceAccessModes.includes(ref.accessMode))
    .map((ref) => {
      const denied = resourceMatchesPrefix(ref.uri, boundary.deniedResourcePrefixes);
      const allowed = !boundary.allowedResourcePrefixes.length || resourceMatchesPrefix(ref.uri, boundary.allowedResourcePrefixes);
      return {
        resourceId: ref.id,
        uri: ref.uri,
        accessMode: ref.accessMode,
        required: ref.required,
        state: denied ? "denied" : allowed ? "allowed" : "outside-role-prefix",
        blocking: denied || (ref.required && boundary.blockOnRequiredResourceMiss && !allowed)
      };
    });
  const blockingResourceChecks = resourceChecks.filter((check) => check.blocking);
  const blockingReasons = [
    ...(tenantDenied ? [`role_tenant_denied:${roleProfile.role}:${requestedTenantId}`] : []),
    ...(tenantAllowed ? [] : [`role_tenant_not_allowed:${roleProfile.role}:${requestedTenantId}`]),
    ...(workspaceDenied ? [`role_workspace_denied:${roleProfile.role}:${requestedWorkspaceId}`] : []),
    ...(workspaceAllowed ? [] : [`role_workspace_not_allowed:${roleProfile.role}:${requestedWorkspaceId}`]),
    ...(requestedWorkspaceMissing ? [`role_requested_workspace_required:${roleProfile.role}`] : []),
    ...blockingResourceChecks.map((check) => `role_resource_blocked:${roleProfile.role}:${check.resourceId}`)
  ];

  return {
    schema: "scheduler.model-policy.role-workspace-boundary-evaluation.v1",
    role: roleProfile.role,
    enabled,
    pass: !enabled || blockingReasons.length === 0,
    requestedTenantId,
    requestedWorkspaceId,
    originWorkspaceId: request.clientState.workspaceId,
    blockingReasons: [...new Set(blockingReasons)],
    resourceChecks,
    boundary
  };
}

function normalizeRolePolicyProfiles(inputPolicy = {}, basePolicy = DEFAULT_POLICY) {
  const inputProfiles =
    inputPolicy.rolePolicies && typeof inputPolicy.rolePolicies === "object" && !Array.isArray(inputPolicy.rolePolicies)
      ? inputPolicy.rolePolicies
      : {};
  const requestedRoles = uniqueStrings(inputPolicy.requiredRoles).map(normalizePolicyRole).filter(Boolean);
  const roles = requestedRoles.length ? requestedRoles : DEFAULT_POLICY.requiredRoles;

  return Object.fromEntries(
    roles.map((role) => [role, normalizeRolePolicyProfile(role, inputProfiles[role], basePolicy)])
  );
}

function normalizePolicy(inputPolicy = {}) {
  const basePolicy = {
    ...DEFAULT_POLICY,
    ...inputPolicy,
    requiredCapabilities: uniqueStrings(inputPolicy.requiredCapabilities).length
      ? uniqueStrings(inputPolicy.requiredCapabilities)
      : DEFAULT_POLICY.requiredCapabilities,
    maxLatencyMs: Number.isFinite(inputPolicy.maxLatencyMs) ? inputPolicy.maxLatencyMs : DEFAULT_POLICY.maxLatencyMs,
    minContextTokens: Number.isFinite(inputPolicy.minContextTokens)
      ? inputPolicy.minContextTokens
      : DEFAULT_POLICY.minContextTokens,
    allowFallback: inputPolicy.allowFallback !== false,
    acceptanceMode: inputPolicy.acceptanceMode === "automatic" ? "automatic" : "operator"
  };
  const rolePolicies = normalizeRolePolicyProfiles(inputPolicy, basePolicy);

  return {
    ...basePolicy,
    requiredRoles: Object.keys(rolePolicies),
    rolePolicies
  };
}

function normalizeDispatchWindow(value = {}) {
  const timezone = typeof value.timezone === "string" && value.timezone.trim() ? value.timezone.trim() : "UTC";
  const startMinute = Number.isFinite(value.startMinute) ? Math.max(0, Math.min(1439, Math.floor(value.startMinute))) : 0;
  const endMinute = Number.isFinite(value.endMinute) ? Math.max(0, Math.min(1439, Math.floor(value.endMinute))) : 1439;
  return {
    timezone,
    startMinute,
    endMinute,
    crossesMidnight: endMinute < startMinute
  };
}

function normalizeLifecycleSettings(inputSettings = {}) {
  const schedule = inputSettings.schedule && typeof inputSettings.schedule === "object" ? inputSettings.schedule : {};
  const maxConcurrentDispatches = Number.isFinite(inputSettings.maxConcurrentDispatches)
    ? Math.max(1, Math.floor(inputSettings.maxConcurrentDispatches))
    : 1;
  const activeDispatches = Number.isFinite(inputSettings.activeDispatches)
    ? Math.max(0, Math.floor(inputSettings.activeDispatches))
    : 0;

  return {
    schema: "scheduler.model-policy.lifecycle-settings.v1",
    enabled: inputSettings.enabled !== false,
    pauseReason:
      typeof inputSettings.pauseReason === "string" && inputSettings.pauseReason.trim()
        ? inputSettings.pauseReason.trim()
        : null,
    pausedUntil:
      typeof inputSettings.pausedUntil === "string" && inputSettings.pausedUntil.trim()
        ? inputSettings.pausedUntil.trim()
        : null,
    schedule: {
      enabled: schedule.enabled === true,
      window: normalizeDispatchWindow(schedule.window),
      allowManualOverride: schedule.allowManualOverride === true
    },
    maxConcurrentDispatches,
    activeDispatches
  };
}

function validateScheduleMinute(value, fieldName, problems) {
  if (!Number.isFinite(value) || value < 0 || value > 1439) {
    problems.push(`invalid_schedule_${fieldName}`);
    return null;
  }
  return Math.floor(value);
}

function normalizeLifecycleScheduleCommand(schedule) {
  const problems = [];
  const warnings = [];
  const patch = {};
  const changedFields = [];

  if (!schedule || typeof schedule !== "object" || Array.isArray(schedule)) {
    return {
      schema: "scheduler.model-policy.schedule-command-validation.v1",
      valid: false,
      problems: ["schedule_payload_required"],
      warnings,
      patch,
      changedFields
    };
  }

  const suppliedFields = Object.keys(schedule).filter((field) => LIFECYCLE_SCHEDULE_FIELDS.has(field));
  if (!suppliedFields.length) problems.push("schedule_payload_empty");

  if (Object.hasOwn(schedule, "enabled")) {
    if (typeof schedule.enabled === "boolean") {
      patch.enabled = schedule.enabled;
      changedFields.push("schedule.enabled");
    } else {
      problems.push("invalid_schedule_enabled");
    }
  }

  if (Object.hasOwn(schedule, "allowManualOverride")) {
    if (typeof schedule.allowManualOverride === "boolean") {
      patch.allowManualOverride = schedule.allowManualOverride;
      changedFields.push("schedule.allowManualOverride");
    } else {
      problems.push("invalid_schedule_manual_override");
    }
  }

  if (Object.hasOwn(schedule, "window")) {
    const window = schedule.window;
    if (!window || typeof window !== "object" || Array.isArray(window)) {
      problems.push("invalid_schedule_window");
    } else {
      const windowPatch = {};
      if (Object.hasOwn(window, "timezone")) {
        if (typeof window.timezone === "string" && window.timezone.trim()) {
          windowPatch.timezone = window.timezone.trim();
          changedFields.push("schedule.window.timezone");
          if (windowPatch.timezone !== "UTC") warnings.push("dispatch_window_evaluated_in_utc");
        } else {
          problems.push("invalid_schedule_timezone");
        }
      }
      if (Object.hasOwn(window, "startMinute")) {
        const startMinute = validateScheduleMinute(window.startMinute, "start_minute", problems);
        if (startMinute !== null) {
          windowPatch.startMinute = startMinute;
          changedFields.push("schedule.window.startMinute");
        }
      }
      if (Object.hasOwn(window, "endMinute")) {
        const endMinute = validateScheduleMinute(window.endMinute, "end_minute", problems);
        if (endMinute !== null) {
          windowPatch.endMinute = endMinute;
          changedFields.push("schedule.window.endMinute");
        }
      }
      if (!Object.keys(windowPatch).length) problems.push("schedule_window_payload_empty");
      patch.window = windowPatch;
    }
  }

  const unknownFields = Object.keys(schedule).filter((field) => !LIFECYCLE_SCHEDULE_FIELDS.has(field));
  if (unknownFields.length) warnings.push(`ignored_schedule_fields:${unknownFields.sort().join(",")}`);

  return {
    schema: "scheduler.model-policy.schedule-command-validation.v1",
    valid: problems.length === 0,
    problems: [...new Set(problems)],
    warnings: [...new Set(warnings)],
    patch,
    changedFields: [...new Set(changedFields)]
  };
}

function applyLifecycleScheduleCommand(currentSettings, scheduleCommand) {
  const validation = normalizeLifecycleScheduleCommand(scheduleCommand);
  if (!validation.valid) {
    return {
      schema: "scheduler.model-policy.schedule-command-result.v1",
      applied: false,
      validation,
      settings: currentSettings
    };
  }

  const currentSchedule = currentSettings.schedule || {};
  const currentWindow = currentSchedule.window || normalizeDispatchWindow();
  const nextWindow = normalizeDispatchWindow({
    ...currentWindow,
    ...(validation.patch.window || {})
  });
  const nextSchedule = {
    ...currentSchedule,
    ...validation.patch,
    window: nextWindow
  };

  return {
    schema: "scheduler.model-policy.schedule-command-result.v1",
    applied: true,
    validation: {
      ...validation,
      warnings: [
        ...validation.warnings,
        ...(nextWindow.startMinute === nextWindow.endMinute ? ["dispatch_window_one_minute"] : [])
      ]
    },
    settings: normalizeLifecycleSettings({
      ...currentSettings,
      schedule: nextSchedule
    })
  };
}

function isLifecycleSettingsCommand(commandType) {
  return ["enable", "disable", "pause", "resume", "set-schedule"].includes(commandType);
}

function buildLifecycleCommandEffect(currentSettings, command, now) {
  const problems = [];
  const warnings = [];
  const changedFields = [];
  const parsedNow = Date.parse(now);
  const currentMs = Number.isFinite(parsedNow) ? parsedNow : Date.now();
  let nextSettings = currentSettings;
  let scheduleCommandResult = null;

  if (!isLifecycleSettingsCommand(command.type)) {
    return {
      schema: "scheduler.model-policy.lifecycle-command-effect.v1",
      commandType: command.type,
      mutationRequested: false,
      valid: true,
      appliedPreview: false,
      problems,
      warnings,
      changedFields,
      settings: currentSettings,
      scheduleCommandResult,
      nextAction: null
    };
  }

  if (command.type === "enable") {
    if (currentSettings.enabled) warnings.push("policy_already_enabled");
    if (currentSettings.pauseReason || currentSettings.pausedUntil) warnings.push("policy_still_paused_after_enable");
    nextSettings = normalizeLifecycleSettings({
      ...currentSettings,
      enabled: true
    });
    changedFields.push("enabled");
  }

  if (command.type === "disable") {
    if (!command.reason) problems.push("disable_reason_required");
    if (!currentSettings.enabled) warnings.push("policy_already_disabled");
    nextSettings = normalizeLifecycleSettings({
      ...currentSettings,
      enabled: false,
      pauseReason: command.reason || currentSettings.pauseReason
    });
    changedFields.push("enabled", "pauseReason");
  }

  if (command.type === "pause") {
    const pauseUntilMs = command.pauseUntil ? Date.parse(command.pauseUntil) : null;
    if (!command.reason) problems.push("pause_reason_required");
    if (command.pauseUntil && !Number.isFinite(pauseUntilMs)) problems.push("invalid_pause_until");
    if (Number.isFinite(pauseUntilMs) && pauseUntilMs <= currentMs) problems.push("pause_until_must_be_future");
    nextSettings = normalizeLifecycleSettings({
      ...currentSettings,
      pauseReason: command.reason || currentSettings.pauseReason,
      pausedUntil: command.pauseUntil || currentSettings.pausedUntil
    });
    changedFields.push("pauseReason");
    if (command.pauseUntil) changedFields.push("pausedUntil");
  }

  if (command.type === "resume") {
    if (!currentSettings.pauseReason && !currentSettings.pausedUntil) warnings.push("policy_not_paused");
    if (!currentSettings.enabled) warnings.push("resume_does_not_enable_disabled_policy");
    nextSettings = normalizeLifecycleSettings({
      ...currentSettings,
      pauseReason: null,
      pausedUntil: null
    });
    changedFields.push("pauseReason", "pausedUntil");
  }

  if (command.type === "set-schedule") {
    scheduleCommandResult = applyLifecycleScheduleCommand(currentSettings, command.schedule);
    if (!scheduleCommandResult.applied) problems.push(...scheduleCommandResult.validation.problems);
    warnings.push(...scheduleCommandResult.validation.warnings);
    changedFields.push(...scheduleCommandResult.validation.changedFields);
    nextSettings = scheduleCommandResult.applied ? scheduleCommandResult.settings : currentSettings;
  }

  const valid = problems.length === 0;
  const appliedPreview = valid && stableStringify(currentSettings) !== stableStringify(nextSettings);

  return {
    schema: "scheduler.model-policy.lifecycle-command-effect.v1",
    commandType: command.type,
    mutationRequested: true,
    valid,
    appliedPreview,
    problems: [...new Set(problems)],
    warnings: [...new Set(warnings)],
    changedFields: [...new Set(changedFields)],
    settings: valid ? nextSettings : currentSettings,
    rejectedSettings: valid ? null : nextSettings,
    scheduleCommandResult,
    nextAction: valid
      ? {
          id: `${command.type}-lifecycle-preview-applied`,
          action: "scheduler.modelPolicy.preview",
          enabled: true,
          reason: appliedPreview
            ? "lifecycle command changes are reflected in this preview"
            : "lifecycle command did not change the current settings"
        }
      : {
          id: "fix-lifecycle-command",
          action: "scheduler.modelPolicy.configureLifecycle",
          enabled: true,
          reason: problems.join(", ")
        }
  };
}

function normalizeProviderSyncMetadata({ rawContract = {}, provider, modelId, syncMode, handoffProtocol, timeoutMs }) {
  const requestedAckMode =
    typeof rawContract.ackMode === "string" && CONTRACT_ACK_MODES.has(rawContract.ackMode)
      ? rawContract.ackMode
      : syncMode === "webhook"
        ? "callback"
        : syncMode === "async"
          ? "poll"
          : "receipt";
  const authMode =
    typeof rawContract.authMode === "string" && CONTRACT_AUTH_MODES.has(rawContract.authMode)
      ? rawContract.authMode
      : provider === "aios-hosted-kernel"
        ? "tenant-boundary-token"
        : "scoped-token";
  const watermark =
    rawContract.watermark && typeof rawContract.watermark === "object" && !Array.isArray(rawContract.watermark)
      ? rawContract.watermark
      : {};
  const lastSyncedAt =
    typeof watermark.lastSyncedAt === "string" && watermark.lastSyncedAt.trim()
      ? watermark.lastSyncedAt.trim()
      : typeof rawContract.lastSyncedAt === "string" && rawContract.lastSyncedAt.trim()
        ? rawContract.lastSyncedAt.trim()
        : null;
  const sequence =
    Number.isFinite(watermark.sequence) && watermark.sequence >= 0
      ? Math.floor(watermark.sequence)
      : Number.isFinite(rawContract.sequence) && rawContract.sequence >= 0
        ? Math.floor(rawContract.sequence)
        : 0;
  const callbackRoute =
    typeof rawContract.callbackRoute === "string" && rawContract.callbackRoute.trim()
      ? rawContract.callbackRoute.trim()
      : CONTRACT_ACK_ROUTES[requestedAckMode];
  const leaseSeconds =
    Number.isFinite(rawContract.leaseSeconds) && rawContract.leaseSeconds > 0
      ? Math.floor(rawContract.leaseSeconds)
      : Math.max(30, Math.ceil(timeoutMs / 1000));

  return {
    schema: "scheduler.model-policy.provider-sync-metadata.v1",
    provider,
    modelId,
    syncMode,
    handoffProtocol,
    authMode,
    ackMode: requestedAckMode,
    callbackRoute,
    leaseSeconds,
    watermark: {
      source: typeof watermark.source === "string" && watermark.source.trim() ? watermark.source.trim() : "provider-contract",
      lastSyncedAt,
      sequence
    },
    requiresExternalAck: requestedAckMode !== "receipt",
    requiresBoundaryToken: authMode === "tenant-boundary-token"
  };
}

function buildProviderCapabilityHandshake({ serviceContract, policyCapabilities, runtime, now }) {
  const missingPolicyCapabilities = policyCapabilities.filter(
    (capability) => !serviceContract.supportedCapabilities.includes(capability)
  );
  const missingRuntimeScopes = serviceContract.requiredScopes.filter((scope) => !runtime.grantedScopes.includes(scope));
  const unsupportedProtocol = !runtime.supportedHandoffProtocols.includes(serviceContract.handoffProtocol);
  const proofUnsupported =
    serviceContract.proofRequired && !runtime.acceptedProofTypes.includes("scheduler.model-policy.dispatch-proof.v1");
  const timeoutExceeded = serviceContract.timeoutMs > runtime.maxProviderTimeoutMs;
  const blockedReasons = [
    ...missingPolicyCapabilities.map((capability) => `capability:${capability}`),
    ...missingRuntimeScopes.map((scope) => `scope:${scope}`),
    ...(unsupportedProtocol ? [`protocol:${serviceContract.handoffProtocol}`] : []),
    ...(proofUnsupported ? ["proof:scheduler.model-policy.dispatch-proof.v1"] : []),
    ...(timeoutExceeded ? ["timeout:client-runtime-limit"] : [])
  ];

  return {
    schema: "scheduler.model-policy.provider-capability-handshake.v1",
    generatedAt: now,
    provider: serviceContract.provider,
    modelId: serviceContract.modelId,
    state: blockedReasons.length ? "negotiation-blocked" : "negotiated",
    blockedReasons,
    requestedCapabilities: policyCapabilities,
    offeredCapabilities: serviceContract.supportedCapabilities,
    requiredScopes: serviceContract.requiredScopes,
    runtimeScopes: runtime.grantedScopes,
    handoffProtocol: serviceContract.handoffProtocol,
    syncMode: serviceContract.syncMode,
    ackMode: serviceContract.syncMetadata.ackMode,
    callbackRoute: serviceContract.syncMetadata.callbackRoute,
    authMode: serviceContract.syncMetadata.authMode,
    proofRequired: serviceContract.proofRequired,
    timeoutMs: serviceContract.timeoutMs,
    maxProviderTimeoutMs: runtime.maxProviderTimeoutMs
  };
}

function getContractRoleCapabilities(serviceContract, role) {
  const rawRoleCapabilities =
    serviceContract.roleCapabilities && typeof serviceContract.roleCapabilities === "object"
      ? uniqueStrings(serviceContract.roleCapabilities[role])
      : [];
  return rawRoleCapabilities.length ? rawRoleCapabilities : serviceContract.supportedCapabilities;
}

function buildProviderRoleContract({ serviceContract, roleSelection, runtime, now }) {
  const assignments = roleSelection.assignments
    .filter((assignment) => assignment.activeModelId === serviceContract.modelId)
    .map((assignment) => {
      const offeredCapabilities = getContractRoleCapabilities(serviceContract, assignment.role);
      const requiredCapabilities = assignment.policy.requiredCapabilities;
      const missingCapabilities = requiredCapabilities.filter((capability) => !offeredCapabilities.includes(capability));
      const missingScopes = serviceContract.requiredScopes.filter((scope) => !runtime.grantedScopes.includes(scope));
      const dispatchBinding =
        serviceContract.roleDispatchBindings[assignment.role] ||
        serviceContract.roleDispatchBindings.default ||
        serviceContract.handoffProtocol;
      const dispatchRoute =
        serviceContract.roleDispatchRoutes[assignment.role] ||
        serviceContract.roleDispatchRoutes.default ||
        serviceContract.syncMetadata.callbackRoute;
      const blockedReasons = [
        ...missingCapabilities.map((capability) => `role_capability:${assignment.role}:${capability}`),
        ...missingScopes.map((scope) => `role_scope:${assignment.role}:${scope}`),
        ...(dispatchRoute ? [] : [`role_dispatch_route_missing:${assignment.role}`])
      ];

      return {
        schema: "scheduler.model-policy.provider-role-assignment-contract.v1",
        role: assignment.role,
        label: assignment.label,
        required: assignment.required,
        state: blockedReasons.length ? "blocked" : assignment.state,
        modelId: assignment.activeModelId,
        provider: assignment.activeProvider,
        source: assignment.state,
        requiredCapabilities,
        offeredCapabilities,
        missingCapabilities,
        requiredScopes: serviceContract.requiredScopes,
        missingScopes,
        dispatchBinding,
        dispatchRoute,
        syncMode: serviceContract.syncMode,
        ackMode: serviceContract.syncMetadata.ackMode,
        workspaceBoundary: assignment.workspaceBoundary,
        blockedReasons
      };
    });
  const requiredAssignments = assignments.filter((assignment) => assignment.required);
  const blockedRequiredRoles = requiredAssignments
    .filter((assignment) => assignment.blockedReasons.length)
    .map((assignment) => assignment.role);
  const ready = requiredAssignments.length > 0 && blockedRequiredRoles.length === 0;

  return {
    schema: "scheduler.model-policy.provider-role-contract.v1",
    generatedAt: now,
    provider: serviceContract.provider,
    modelId: serviceContract.modelId,
    state: ready ? "ready" : blockedRequiredRoles.length ? "blocked" : "not-bound-to-required-roles",
    ready,
    requiredRoleCount: requiredAssignments.length,
    activeRoleCount: assignments.length,
    activeRoles: assignments.map((assignment) => assignment.role),
    blockedRequiredRoles,
    blockedReasons: [...new Set(assignments.flatMap((assignment) => assignment.blockedReasons))],
    dispatchBindingsByRole: Object.fromEntries(
      assignments.map((assignment) => [assignment.role, assignment.dispatchBinding])
    ),
    dispatchRoutesByRole: Object.fromEntries(assignments.map((assignment) => [assignment.role, assignment.dispatchRoute])),
    syncMode: serviceContract.syncMode,
    ackMode: serviceContract.syncMetadata.ackMode,
    assignments
  };
}

function normalizeServiceContract(candidate = {}) {
  const rawContract =
    candidate.serviceContract && typeof candidate.serviceContract === "object"
      ? candidate.serviceContract
      : candidate.providerContract && typeof candidate.providerContract === "object"
        ? candidate.providerContract
        : {};
  const provider = typeof candidate.provider === "string" && candidate.provider.trim() ? candidate.provider.trim() : "unknown";
  const modelId = typeof candidate.id === "string" && candidate.id.trim() ? candidate.id.trim() : null;
  const syncMode = CONTRACT_SYNC_MODES.has(rawContract.syncMode) ? rawContract.syncMode : "async";
  const handoffProtocol = CONTRACT_HANDOFF_PROTOCOLS.has(rawContract.handoffProtocol)
    ? rawContract.handoffProtocol
    : "hosted-kernel.dispatch.v1";
  const endpoint =
    typeof rawContract.endpoint === "string" && rawContract.endpoint.trim()
      ? rawContract.endpoint.trim()
      : provider === "aios-hosted-kernel" && modelId
        ? `aios://hosted-kernel/models/${modelId}/dispatch`
        : null;
  const requiredScopes = uniqueStrings(rawContract.requiredScopes).length
    ? uniqueStrings(rawContract.requiredScopes)
    : provider === "aios-hosted-kernel"
      ? ["scheduler.dispatch", "model.invoke"]
      : ["model.invoke"];
  const declaredCapabilities = uniqueStrings(rawContract.declaredCapabilities);
  const supportedCapabilities = declaredCapabilities.length ? declaredCapabilities : uniqueStrings(candidate.capabilities);
  const rawRoleCapabilities =
    rawContract.roleCapabilities && typeof rawContract.roleCapabilities === "object" && !Array.isArray(rawContract.roleCapabilities)
      ? rawContract.roleCapabilities
      : {};
  const roleCapabilities = Object.fromEntries(
    Object.entries(rawRoleCapabilities)
      .filter(([role]) => POLICY_ROLES.has(role))
      .map(([role, capabilities]) => [role, uniqueStrings(capabilities)])
      .filter(([, capabilities]) => capabilities.length)
  );
  const rawRoleDispatchBindings =
    rawContract.roleDispatchBindings &&
    typeof rawContract.roleDispatchBindings === "object" &&
    !Array.isArray(rawContract.roleDispatchBindings)
      ? rawContract.roleDispatchBindings
      : {};
  const roleDispatchBindings = Object.fromEntries(
    Object.entries(rawRoleDispatchBindings)
      .filter(([role, binding]) => (POLICY_ROLES.has(role) || role === "default") && typeof binding === "string" && binding.trim())
      .map(([role, binding]) => [role, binding.trim()])
  );
  const rawRoleDispatchRoutes =
    rawContract.roleDispatchRoutes &&
    typeof rawContract.roleDispatchRoutes === "object" &&
    !Array.isArray(rawContract.roleDispatchRoutes)
      ? rawContract.roleDispatchRoutes
      : {};
  const roleDispatchRoutes = Object.fromEntries(
    Object.entries(rawRoleDispatchRoutes)
      .filter(([role, route]) => (POLICY_ROLES.has(role) || role === "default") && typeof route === "string" && route.trim())
      .map(([role, route]) => [role, route.trim()])
  );
  const maxInFlight =
    Number.isFinite(rawContract.maxInFlight) && rawContract.maxInFlight > 0 ? Math.floor(rawContract.maxInFlight) : 1;
  const timeoutMs =
    Number.isFinite(rawContract.timeoutMs) && rawContract.timeoutMs > 0 ? Math.round(rawContract.timeoutMs) : 30000;
  const syncMetadata = normalizeProviderSyncMetadata({
    rawContract,
    provider,
    modelId,
    syncMode,
    handoffProtocol,
    timeoutMs
  });

  return {
    schema: "scheduler.model-policy.service-contract.v1",
    provider,
    modelId,
    endpoint,
    apiVersion:
      typeof rawContract.apiVersion === "string" && rawContract.apiVersion.trim()
        ? rawContract.apiVersion.trim()
        : "2026-07-01",
    syncMode,
    handoffProtocol,
    supportsStreaming: rawContract.supportsStreaming !== false,
    proofRequired: rawContract.proofRequired !== false,
    idempotencyKeyHeader:
      typeof rawContract.idempotencyKeyHeader === "string" && rawContract.idempotencyKeyHeader.trim()
        ? rawContract.idempotencyKeyHeader.trim()
        : "x-aios-dispatch-key",
    requiredScopes,
    supportedCapabilities,
    roleCapabilities,
    roleDispatchBindings,
    roleDispatchRoutes,
    syncMetadata,
    maxInFlight,
    timeoutMs,
    ready:
      Boolean(endpoint) &&
      requiredScopes.length > 0 &&
      supportedCapabilities.length > 0 &&
      Boolean(syncMetadata.callbackRoute)
  };
}

function minuteOfDayUtc(now) {
  const parsed = Date.parse(now);
  const date = Number.isFinite(parsed) ? new Date(parsed) : new Date();
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

function isWithinDispatchWindow(window, minute) {
  if (window.crossesMidnight) return minute >= window.startMinute || minute <= window.endMinute;
  return minute >= window.startMinute && minute <= window.endMinute;
}

function buildLifecycleState({ settings, command, now, lifecycleCommandEffect = null }) {
  const validationErrors = [];
  const validationWarnings = [];
  const scheduleCommandValidation =
    command.type === "set-schedule" ? normalizeLifecycleScheduleCommand(command.schedule) : null;
  const parsedPausedUntil = settings.pausedUntil ? Date.parse(settings.pausedUntil) : null;
  const parsedCommandPauseUntil = command.pauseUntil ? Date.parse(command.pauseUntil) : null;
  const nowMs = Date.parse(now);
  const currentMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const minute = minuteOfDayUtc(now);
  const withinSchedule = !settings.schedule.enabled || isWithinDispatchWindow(settings.schedule.window, minute);
  const capacityAvailable = settings.activeDispatches < settings.maxConcurrentDispatches;

  if (settings.pausedUntil && !Number.isFinite(parsedPausedUntil)) validationErrors.push("invalid_paused_until");
  if (command.type === "pause" && !command.reason) validationErrors.push("pause_reason_required");
  if (command.type === "pause" && command.pauseUntil && !Number.isFinite(parsedCommandPauseUntil)) {
    validationErrors.push("invalid_command_pause_until");
  }
  if (scheduleCommandValidation && !scheduleCommandValidation.valid) {
    validationErrors.push(...scheduleCommandValidation.problems);
  }
  if (scheduleCommandValidation) {
    validationWarnings.push(...scheduleCommandValidation.warnings);
  }
  if (lifecycleCommandEffect?.mutationRequested) {
    validationErrors.push(...lifecycleCommandEffect.problems);
    validationWarnings.push(...lifecycleCommandEffect.warnings);
  }
  if (settings.schedule.enabled && settings.schedule.window.timezone !== "UTC") {
    validationWarnings.push("dispatch_window_evaluated_in_utc");
  }
  if (!capacityAvailable) validationWarnings.push("dispatch_capacity_exhausted");
  if (settings.schedule.enabled && !withinSchedule) validationWarnings.push("outside_dispatch_window");

  const pauseActive = Number.isFinite(parsedPausedUntil) ? parsedPausedUntil > currentMs : Boolean(settings.pauseReason);
  const disabled = !settings.enabled;
  const dispatchBlocked = disabled || pauseActive || !withinSchedule || !capacityAvailable || validationErrors.length > 0;
  const reason = disabled
    ? "policy_disabled"
    : pauseActive
      ? "policy_paused"
      : !withinSchedule
        ? "outside_dispatch_window"
        : !capacityAvailable
          ? "dispatch_capacity_exhausted"
          : validationErrors.length
            ? "settings_invalid"
            : "lifecycle_allows_dispatch";

  return {
    schema: "scheduler.model-policy.lifecycle-state.v1",
    generatedAt: now,
    enabled: settings.enabled,
    pauseActive,
    pausedUntil: settings.pausedUntil,
    scheduleEnabled: settings.schedule.enabled,
    scheduleWindow: settings.schedule.window,
    activeDispatches: settings.activeDispatches,
    maxConcurrentDispatches: settings.maxConcurrentDispatches,
    dispatchBlocked,
    reason,
    validationErrors: [...new Set(validationErrors)],
    validationWarnings: [...new Set(validationWarnings)],
    lifecycleCommandEffect,
    scheduleCommandValidation,
    nextAction: lifecycleCommandEffect?.mutationRequested && !lifecycleCommandEffect.valid
      ? lifecycleCommandEffect.nextAction
      : dispatchBlocked
      ? {
          id:
            reason === "policy_disabled"
              ? "enable-policy"
              : reason === "policy_paused"
                ? "resume-policy"
                : reason === "outside_dispatch_window"
                  ? "configure-dispatch-window"
                  : "adjust-lifecycle-settings",
          action:
            reason === "policy_disabled"
              ? "scheduler.modelPolicy.enable"
              : reason === "policy_paused"
                ? "scheduler.modelPolicy.resume"
                : "scheduler.modelPolicy.configureLifecycle",
          enabled: true,
          reason
        }
      : {
          id: "dispatch-model-policy",
          action: "scheduler.modelPolicy.dispatch",
          enabled: true,
          reason
        }
  };
}

function normalizeCandidate(candidate, index) {
  const id = typeof candidate?.id === "string" && candidate.id.trim() ? candidate.id.trim() : `candidate-${index + 1}`;
  const provider = typeof candidate?.provider === "string" && candidate.provider.trim() ? candidate.provider.trim() : "unknown";
  const capabilities = uniqueStrings(candidate?.capabilities);
  const serviceContract = normalizeServiceContract({ ...candidate, id, provider, capabilities });
  return {
    id,
    provider,
    latencyMs: Number.isFinite(candidate?.latencyMs) ? candidate.latencyMs : Infinity,
    maxContextTokens: Number.isFinite(candidate?.maxContextTokens) ? candidate.maxContextTokens : 0,
    costTier: COST_RANK.has(candidate?.costTier) ? candidate.costTier : "standard",
    capabilities,
    available: candidate?.available !== false,
    serviceContract
  };
}

function normalizeHealthSignal(value = {}) {
  const state = HEALTH_STATES.has(value.state) ? value.state : "unknown";
  const failureCodes = uniqueStrings(value.failureCodes);
  const retryAfterMs = Number.isFinite(value.retryAfterMs) && value.retryAfterMs >= 0 ? Math.round(value.retryAfterMs) : null;
  const consecutiveFailures =
    Number.isFinite(value.consecutiveFailures) && value.consecutiveFailures > 0
      ? Math.floor(value.consecutiveFailures)
      : 0;
  return {
    state,
    failureCodes,
    lastFailureAt: typeof value.lastFailureAt === "string" && value.lastFailureAt.trim() ? value.lastFailureAt.trim() : null,
    retryAfterMs,
    consecutiveFailures,
    observedAt: typeof value.observedAt === "string" && value.observedAt.trim() ? value.observedAt.trim() : null
  };
}

function normalizeFailureStateEntry(entry = {}, scope = "model", id = "unknown") {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const normalizedScope = FAILURE_STATE_SCOPES.has(entry.scope) ? entry.scope : scope;
  const key =
    typeof entry.key === "string" && entry.key.trim()
      ? entry.key.trim()
      : typeof entry.id === "string" && entry.id.trim()
        ? entry.id.trim()
        : id;
  if (!key) return null;
  const failureCodes = uniqueStrings(entry.failureCodes);
  const consecutiveFailures =
    Number.isFinite(entry.consecutiveFailures) && entry.consecutiveFailures > 0
      ? Math.floor(entry.consecutiveFailures)
      : 0;
  const retryAttempt =
    Number.isFinite(entry.retryAttempt) && entry.retryAttempt > 0 ? Math.floor(entry.retryAttempt) : consecutiveFailures;
  const circuitOpenUntil =
    typeof entry.circuitOpenUntil === "string" && entry.circuitOpenUntil.trim() ? entry.circuitOpenUntil.trim() : null;
  const lastFailureAt =
    typeof entry.lastFailureAt === "string" && entry.lastFailureAt.trim() ? entry.lastFailureAt.trim() : null;
  const lastProbeAt =
    typeof entry.lastProbeAt === "string" && entry.lastProbeAt.trim() ? entry.lastProbeAt.trim() : null;

  return {
    schema: "scheduler.model-policy.failure-state.v1",
    scope: normalizedScope,
    key,
    state: HEALTH_STATES.has(entry.state) ? entry.state : consecutiveFailures ? "degraded" : "unknown",
    failureCodes,
    consecutiveFailures,
    retryAttempt,
    circuitOpenUntil,
    lastFailureAt,
    lastProbeAt,
    operatorNote:
      typeof entry.operatorNote === "string" && entry.operatorNote.trim() ? entry.operatorNote.trim() : null
  };
}

function normalizeFailureStateMap(value, scope) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => typeof key === "string" && key.trim())
          .map(([key, entry]) => [key.trim(), normalizeFailureStateEntry(entry, scope, key.trim())])
          .filter(([, entry]) => Boolean(entry))
      )
    : {};
}

function normalizeFailureStateLedger(inputHealth = {}) {
  const ledger =
    inputHealth && typeof inputHealth.failureState === "object" && inputHealth.failureState
      ? inputHealth.failureState
      : {};
  return {
    schema: "scheduler.model-policy.failure-state-ledger.v1",
    provider: normalizeFailureStateMap(ledger.provider, "provider"),
    model: normalizeFailureStateMap(ledger.model, "model")
  };
}

function normalizeHealthSignals(inputHealth = {}) {
  const providerHealth =
    inputHealth && typeof inputHealth.providerHealth === "object" && inputHealth.providerHealth
      ? Object.fromEntries(
          Object.entries(inputHealth.providerHealth)
            .filter(([provider]) => typeof provider === "string" && provider.trim())
            .map(([provider, value]) => [provider.trim(), normalizeHealthSignal(value)])
        )
      : {};
  const modelHealth =
    inputHealth && typeof inputHealth.modelHealth === "object" && inputHealth.modelHealth
      ? Object.fromEntries(
          Object.entries(inputHealth.modelHealth)
            .filter(([modelId]) => typeof modelId === "string" && modelId.trim())
            .map(([modelId, value]) => [modelId.trim(), normalizeHealthSignal(value)])
        )
      : {};
  return { providerHealth, modelHealth, failureState: normalizeFailureStateLedger(inputHealth) };
}

function buildRetryPlan({ failures, now, retryAfterMs: observedRetryAfterMs }) {
  const retryableFailures = failures.filter((code) => RETRYABLE_HEALTH_FAILURES.has(code));
  if (!retryableFailures.length) {
    return {
      retryable: false,
      retryAfterMs: null,
      nextRetryAt: null,
      strategy: "operator-intervention-required"
    };
  }

  const retryAfterMs = observedRetryAfterMs || (retryableFailures.includes("rate_limited") ? 60000 : 15000);
  const parsedNow = Date.parse(now);
  const retryBase = Number.isFinite(parsedNow) ? parsedNow : Date.now();
  return {
    retryable: true,
    retryAfterMs,
    nextRetryAt: new Date(retryBase + retryAfterMs).toISOString(),
    strategy: retryableFailures.includes("provider_unavailable") ? "provider-health-probe" : "same-model-backoff"
  };
}

function resolveFailureState({ candidate, healthSignals, now }) {
  const providerState = healthSignals.failureState.provider[candidate.provider] || null;
  const modelState = healthSignals.failureState.model[candidate.id] || null;
  const entries = [providerState, modelState].filter(Boolean);
  const parsedNow = Date.parse(now);
  const nowMs = Number.isFinite(parsedNow) ? parsedNow : Date.now();
  const circuitEntries = entries.filter((entry) => {
    const openUntilMs = entry.circuitOpenUntil ? Date.parse(entry.circuitOpenUntil) : null;
    return entry.failureCodes.includes("circuit_open")
      ? !entry.circuitOpenUntil || (Number.isFinite(openUntilMs) && openUntilMs > nowMs)
      : Number.isFinite(openUntilMs) && openUntilMs > nowMs;
  });
  const retryAttempt = Math.max(0, ...entries.map((entry) => entry.retryAttempt || entry.consecutiveFailures || 0));
  const failureCodes = [...new Set(entries.flatMap((entry) => entry.failureCodes))];
  const circuitOpenUntil = circuitEntries
    .map((entry) => entry.circuitOpenUntil)
    .filter(Boolean)
    .sort()
    .at(-1) || null;
  const circuitOpenUntilMs = circuitOpenUntil ? Date.parse(circuitOpenUntil) : null;
  const circuitOpen = circuitEntries.length > 0 && (!circuitOpenUntil || Number.isFinite(circuitOpenUntilMs));
  const nextProbeAt =
    circuitOpen && circuitOpenUntil && Number.isFinite(circuitOpenUntilMs)
      ? new Date(circuitOpenUntilMs).toISOString()
      : null;

  return {
    schema: "scheduler.model-policy.failure-state-summary.v1",
    state: circuitOpen ? "circuit-open" : entries.some((entry) => entry.state === "unhealthy") ? "failed" : entries.length ? "observed" : "clear",
    circuitOpen,
    circuitOpenUntil,
    retryAttempt,
    failureCodes,
    providerState,
    modelState,
    canProbeNow: !circuitOpen || (Number.isFinite(circuitOpenUntilMs) && circuitOpenUntilMs <= nowMs),
    nextProbeAt,
    action: circuitOpen
      ? "wait for circuit probe window or switch hosted-kernel model"
      : failureCodes.length
        ? "continue with retry budget and record next provider result"
        : "no persisted failure-state action required"
  };
}

function buildFailureStateRetryPlan({ retry, failureState, now }) {
  if (!failureState.retryAttempt) return retry;
  const baseRetryAfterMs = retry.retryAfterMs || 15000;
  const backoffMs = Math.min(300000, baseRetryAfterMs * 2 ** Math.min(failureState.retryAttempt - 1, 4));
  const parsedNow = Date.parse(now);
  const retryBase = Number.isFinite(parsedNow) ? parsedNow : Date.now();
  const nextRetryAt = failureState.nextProbeAt || new Date(retryBase + backoffMs).toISOString();

  return {
    ...retry,
    retryable: retry.retryable && !failureState.circuitOpen,
    retryAfterMs: failureState.circuitOpen ? null : backoffMs,
    nextRetryAt,
    strategy: failureState.circuitOpen ? "circuit-breaker-probe-window" : "exponential-hosted-kernel-backoff",
    attempt: failureState.retryAttempt
  };
}

function buildHealthRecoveryPlan({ report, selected }) {
  const blocked = report.dispatchBlocked;
  const circuitOpen = report.failureState.circuitOpen;
  const canProbe = report.failureState.canProbeNow && (report.retry.retryable || circuitOpen);
  const route = blocked
    ? circuitOpen
      ? "scheduler.modelPolicy.probeProviderHealth"
      : "scheduler.modelPolicy.resolveProviderHealth"
    : report.degradedMode
      ? "scheduler.modelPolicy.monitorProviderHealth"
      : "scheduler.modelPolicy.preview";

  return {
    schema: "scheduler.model-policy.health-recovery-plan.v1",
    modelId: report.modelId,
    provider: report.provider,
    state: report.state,
    selected,
    route,
    blocked,
    canProbe,
    retryable: report.retry.retryable,
    retryAttempt: report.retry.attempt || 0,
    nextRetryAt: report.retry.nextRetryAt,
    nextProbeAt: report.failureState.nextProbeAt,
    operatorAction: circuitOpen
      ? "wait for the circuit probe window, then run a provider health probe"
      : blocked
        ? report.action
        : report.degradedMode
          ? "allow degraded dispatch only with retry telemetry visible to the operator"
          : "no recovery action required",
    command: {
      type: canProbe ? "probe-health" : blocked ? "hold" : "preview",
      modelId: report.modelId,
      reason: blocked ? report.failures.join(", ") || report.state : null
    }
  };
}

function buildOperationalHealth({ evaluated, healthSignals, now }) {
  const modelReports = evaluated.map((candidate) => {
    const providerSignal = healthSignals.providerHealth[candidate.provider] || normalizeHealthSignal();
    const modelSignal = healthSignals.modelHealth[candidate.id] || normalizeHealthSignal();
    const failureState = resolveFailureState({ candidate, healthSignals, now });
    const failures = [...new Set([...providerSignal.failureCodes, ...modelSignal.failureCodes, ...failureState.failureCodes])];
    const observedRetryAfterMs = Math.max(providerSignal.retryAfterMs || 0, modelSignal.retryAfterMs || 0) || null;
    const activeHardFailures = failures.filter(
      (code) => HARD_HEALTH_FAILURES.has(code) && (code !== "circuit_open" || failureState.circuitOpen)
    );
    const hardFailed =
      providerSignal.state === "unhealthy" ||
      modelSignal.state === "unhealthy" ||
      failureState.circuitOpen ||
      activeHardFailures.length > 0;
    const degraded =
      !hardFailed &&
      (providerSignal.state === "degraded" ||
        modelSignal.state === "degraded" ||
        failureState.state === "observed" ||
        providerSignal.consecutiveFailures > 0 ||
        modelSignal.consecutiveFailures > 0);
    const retry = buildFailureStateRetryPlan({
      retry: buildRetryPlan({ failures, now, retryAfterMs: observedRetryAfterMs }),
      failureState,
      now
    });

    return {
      modelId: candidate.id,
      provider: candidate.provider,
      state: hardFailed ? "unhealthy" : degraded ? "degraded" : candidate.available ? "healthy" : "unknown",
      dispatchBlocked: hardFailed,
      degradedMode: degraded,
      failures,
      retry,
      failureState,
      action:
        failureState.circuitOpen
          ? "wait for circuit probe window or accept a healthy fallback"
          : hardFailed && failures.includes("auth_failed")
          ? "refresh hosted-kernel provider credentials"
          : hardFailed && failures.includes("quota_exhausted")
            ? "raise quota or choose a lower-cost fallback"
            : degraded
              ? "dispatch with operator-visible retry/backoff telemetry"
              : "no health action required"
    };
  });
  const blockedModels = modelReports.filter((report) => report.dispatchBlocked).map((report) => report.modelId);
  const degradedModels = modelReports.filter((report) => report.degradedMode).map((report) => report.modelId);
  const recoveryPlans = modelReports.map((report, index) =>
    buildHealthRecoveryPlan({ report, selected: index === 0 })
  );
  return {
    schema: "scheduler.model-policy.operational-health.v1",
    generatedAt: now,
    state: blockedModels.length ? "unhealthy" : degradedModels.length ? "degraded" : "healthy",
    degradedMode: degradedModels.length > 0 && blockedModels.length === 0,
    blockedModels,
    degradedModels,
    failureStateLedger: healthSignals.failureState,
    recoveryPlans,
    reports: modelReports
  };
}

function evaluateCandidate(candidate, policy) {
  const missingCapabilities = policy.requiredCapabilities.filter((capability) => !candidate.capabilities.includes(capability));
  const contractMissingCapabilities = policy.requiredCapabilities.filter(
    (capability) => !candidate.serviceContract.supportedCapabilities.includes(capability)
  );
  const violations = [];
  if (!candidate.available) violations.push("model_unavailable");
  if (candidate.latencyMs > policy.maxLatencyMs) violations.push("latency_budget_exceeded");
  if (candidate.maxContextTokens < policy.minContextTokens) violations.push("context_window_too_small");
  if (missingCapabilities.length) violations.push("missing_required_capabilities");
  if (!candidate.serviceContract.ready) violations.push("provider_contract_unready");
  if (contractMissingCapabilities.length) violations.push("provider_contract_capability_gap");

  const score =
    (candidate.available ? 40 : 0) +
    Math.max(0, 25 - missingCapabilities.length * 10) +
    Math.max(0, 20 - Math.ceil(candidate.latencyMs / 150)) +
    Math.max(0, 10 - COST_RANK.get(candidate.costTier)) +
    Math.min(10, Math.floor(candidate.maxContextTokens / Math.max(policy.minContextTokens, 1))) +
    (candidate.serviceContract.ready ? 5 : 0) -
    contractMissingCapabilities.length * 5;

  return {
    ...candidate,
    score,
    accepted: violations.length === 0,
    violations,
    missingCapabilities,
    contractMissingCapabilities,
    explain: {
      latency: candidate.latencyMs === Infinity ? "latency unknown" : `${candidate.latencyMs}ms estimated latency`,
      context: `${candidate.maxContextTokens} token context window`,
      cost: `${candidate.costTier} cost tier`,
      capabilityMatch: missingCapabilities.length
        ? `missing ${missingCapabilities.join(", ")}`
        : "all required capabilities present",
      providerContract: candidate.serviceContract.ready
        ? `${candidate.serviceContract.handoffProtocol} via ${candidate.serviceContract.syncMode}/${candidate.serviceContract.syncMetadata.ackMode}`
        : "provider contract is missing endpoint, scopes, or supported capabilities"
    }
  };
}

function evaluateCandidateForRole(candidate, roleProfile) {
  const missingCapabilities = roleProfile.requiredCapabilities.filter(
    (capability) => !candidate.capabilities.includes(capability)
  );
  const contractMissingCapabilities = roleProfile.requiredCapabilities.filter(
    (capability) => !candidate.serviceContract.supportedCapabilities.includes(capability)
  );
  const providerExcluded = roleProfile.excludedProviders.includes(candidate.provider);
  const preferredProvider = roleProfile.preferredProviders.includes(candidate.provider);
  const preferredModel = roleProfile.preferredModelIds.includes(candidate.id);
  const preferredCostTier = roleProfile.preferredCostTiers.includes(candidate.costTier);
  const providerRequired =
    roleProfile.providerPreferencePolicy === "required" && roleProfile.preferredProviders.length > 0;
  const modelRequired = roleProfile.modelPreferencePolicy === "required" && roleProfile.preferredModelIds.length > 0;
  const violations = [];
  if (!candidate.available) violations.push("model_unavailable");
  if (providerExcluded) violations.push("role_provider_excluded");
  if (providerRequired && !preferredProvider) violations.push("role_required_provider_unmatched");
  if (modelRequired && !preferredModel) violations.push("role_required_model_unmatched");
  if (candidate.latencyMs > roleProfile.maxLatencyMs) violations.push("role_latency_budget_exceeded");
  if (candidate.maxContextTokens < roleProfile.minContextTokens) violations.push("role_context_window_too_small");
  if (missingCapabilities.length) violations.push("role_missing_required_capabilities");
  if (!candidate.serviceContract.ready) violations.push("role_provider_contract_unready");
  if (contractMissingCapabilities.length) violations.push("role_provider_contract_capability_gap");

  const score =
    (candidate.available ? 35 : 0) +
    Math.max(0, 25 - missingCapabilities.length * 10) +
    Math.max(0, 15 - Math.ceil(candidate.latencyMs / 200)) +
    Math.min(12, Math.floor(candidate.maxContextTokens / Math.max(roleProfile.minContextTokens, 1))) +
    (candidate.serviceContract.ready ? 8 : 0) +
    (preferredProvider ? 8 : 0) +
    (preferredModel ? 10 : 0) +
    (preferredCostTier ? 4 : 0) -
    contractMissingCapabilities.length * 5 -
    (providerExcluded ? 50 : 0);

  return {
    modelId: candidate.id,
    provider: candidate.provider,
    score,
    accepted: violations.length === 0,
    violations,
    missingCapabilities,
    contractMissingCapabilities,
    explain: {
      latency: candidate.latencyMs === Infinity ? "latency unknown" : `${candidate.latencyMs}ms estimated latency`,
      context: `${candidate.maxContextTokens} token context window`,
      cost: `${candidate.costTier} cost tier`,
      providerPreference: preferredProvider
        ? `${roleProfile.providerPreferencePolicy} provider matched`
        : providerRequired
          ? `required provider missing: ${roleProfile.preferredProviders.join(", ")}`
          : "no provider preference match",
      modelPreference: preferredModel
        ? `${roleProfile.modelPreferencePolicy} model matched`
        : modelRequired
          ? `required model missing: ${roleProfile.preferredModelIds.join(", ")}`
          : "no model preference match",
      capabilityMatch: missingCapabilities.length
        ? `missing ${missingCapabilities.join(", ")}`
        : "all role capabilities present"
    }
  };
}

function buildRoleProviderCoverage(assignments) {
  const activeAssignments = assignments.filter((assignment) => assignment.activeModelId);
  const providerGroups = activeAssignments.reduce((groups, assignment) => {
    const provider = assignment.activeProvider || "unknown";
    if (!groups[provider]) {
      groups[provider] = {
        provider,
        roles: [],
        modelIds: [],
        fallbackRoles: []
      };
    }
    groups[provider].roles.push(assignment.role);
    groups[provider].modelIds.push(assignment.activeModelId);
    if (assignment.state === "fallback" || assignment.state === "degraded-fallback") {
      groups[provider].fallbackRoles.push(assignment.role);
    }
    return groups;
  }, {});

  return Object.fromEntries(
    Object.entries(providerGroups).map(([provider, group]) => [
      provider,
      {
        provider,
        roles: [...new Set(group.roles)],
        modelIds: [...new Set(group.modelIds)],
        fallbackRoles: [...new Set(group.fallbackRoles)]
      }
    ])
  );
}

function buildRoleDispatchPlan(assignments) {
  const activeAssignments = assignments.filter((assignment) => assignment.activeModelId);
  const primaryAssignment =
    activeAssignments.find((assignment) => assignment.role === "planner") ||
    activeAssignments.find((assignment) => assignment.required) ||
    activeAssignments[0] ||
    null;
  const fallbackRoles = assignments
    .filter(
      (assignment) =>
        assignment.required && (assignment.state === "fallback" || assignment.state === "degraded-fallback")
    )
    .map((assignment) => assignment.role);
  const degradedFallbackRoles = assignments
    .filter((assignment) => assignment.required && assignment.state === "degraded-fallback")
    .map((assignment) => assignment.role);
  const unassignedOptionalRoles = assignments
    .filter((assignment) => !assignment.required && !assignment.activeModelId)
    .map((assignment) => assignment.role);

  return {
    schema: "scheduler.model-policy.role-dispatch-plan.v1",
    ready: assignments.every((assignment) => !assignment.required || Boolean(assignment.activeModelId)),
    primaryRole: primaryAssignment?.role || null,
    primaryModelId: primaryAssignment?.activeModelId || null,
    primaryProvider: primaryAssignment?.activeProvider || null,
    activeModelsByRole: Object.fromEntries(assignments.map((assignment) => [assignment.role, assignment.activeModelId])),
    activeProvidersByRole: Object.fromEntries(assignments.map((assignment) => [assignment.role, assignment.activeProvider])),
    providerCoverage: buildRoleProviderCoverage(assignments),
    workspaceBoundaryByRole: Object.fromEntries(assignments.map((assignment) => [assignment.role, assignment.workspaceBoundary])),
    fallbackRoles,
    degradedFallbackRoles,
    unassignedOptionalRoles,
    requiresOperatorReview: fallbackRoles.length > 0 || degradedFallbackRoles.length > 0
  };
}

function buildHealthReportIndex(operationalHealth) {
  const reportByModelId = new Map((operationalHealth.reports || []).map((report) => [report.modelId, report]));
  const recoveryPlanByModelId = new Map((operationalHealth.recoveryPlans || []).map((plan) => [plan.modelId, plan]));
  return { reportByModelId, recoveryPlanByModelId };
}

function buildRoleHealthDecision({ roleProfile, candidate, healthReport, recoveryPlan }) {
  const state = healthReport?.state || "unknown";
  const dispatchBlocked = healthReport?.dispatchBlocked === true;
  const degradedMode = healthReport?.degradedMode === true;
  const retryable = healthReport?.retry?.retryable === true;
  const retryAfterMs = Number.isFinite(healthReport?.retry?.retryAfterMs) ? healthReport.retry.retryAfterMs : null;
  const nextRetryAt =
    typeof healthReport?.retry?.nextRetryAt === "string" && healthReport.retry.nextRetryAt.trim()
      ? healthReport.retry.nextRetryAt
      : null;
  const degradedFallbackAllowed =
    roleProfile.allowFallback &&
    degradedMode &&
    !dispatchBlocked &&
    !healthReport?.failures?.some((code) => HARD_HEALTH_FAILURES.has(code));
  const violations = [
    ...(dispatchBlocked ? ["role_health_dispatch_blocked"] : []),
    ...(degradedMode && !degradedFallbackAllowed ? ["role_health_degraded_requires_review"] : [])
  ];
  const scorePenalty =
    dispatchBlocked
      ? 120
      : degradedMode
        ? retryable
          ? 18
          : 35
        : state === "unknown"
          ? 8
          : 0;

  return {
    schema: "scheduler.model-policy.role-health-decision.v1",
    role: roleProfile.role,
    modelId: candidate.id,
    provider: candidate.provider,
    state,
    dispatchBlocked,
    degradedMode,
    degradedFallbackAllowed,
    retryable,
    retryAfterMs,
    nextRetryAt,
    failures: healthReport?.failures || [],
    scorePenalty,
    violations,
    recoveryPlan: recoveryPlan || null,
    action:
      dispatchBlocked
        ? recoveryPlan?.route || "scheduler.modelPolicy.resolveProviderHealth"
        : degradedMode
          ? "scheduler.modelPolicy.acceptFallback"
          : "scheduler.modelPolicy.preview"
  };
}

function buildRoleSelectionMatrix({ evaluated, policy, operationalHealth, request }) {
  const blockedModels = new Set(operationalHealth.blockedModels);
  const degradedModels = new Set(operationalHealth.degradedModels);
  const healthIndex = buildHealthReportIndex(operationalHealth);
  const assignments = Object.values(policy.rolePolicies).map((roleProfile) => {
    const workspaceBoundary = evaluateRoleWorkspaceBoundary({ roleProfile, request });
    const candidates = evaluated
      .map((candidate) => {
        const roleCandidate = evaluateCandidateForRole(candidate, roleProfile);
        const healthDecision = buildRoleHealthDecision({
          roleProfile,
          candidate,
          healthReport: healthIndex.reportByModelId.get(candidate.id),
          recoveryPlan: healthIndex.recoveryPlanByModelId.get(candidate.id)
        });
        const boundaryViolations = workspaceBoundary.pass ? [] : ["role_workspace_boundary_blocked"];
        const healthViolations = healthDecision.violations;
        return {
          ...roleCandidate,
          accepted: roleCandidate.accepted && workspaceBoundary.pass && !healthDecision.dispatchBlocked,
          score:
            (workspaceBoundary.pass ? roleCandidate.score : roleCandidate.score - 75) -
            healthDecision.scorePenalty,
          health: healthDecision,
          violations: [...new Set([...roleCandidate.violations, ...boundaryViolations, ...healthViolations])],
          workspaceBoundary: {
            pass: workspaceBoundary.pass,
            blockingReasons: workspaceBoundary.blockingReasons
          }
        };
      })
      .sort((left, right) => right.score - left.score || left.modelId.localeCompare(right.modelId));
    const selected =
      candidates.find(
        (candidate) =>
          candidate.accepted &&
          !blockedModels.has(candidate.modelId) &&
          !degradedModels.has(candidate.modelId)
      ) || null;
    const fallback = selected
      ? null
      : roleProfile.allowFallback && workspaceBoundary.pass
        ? candidates.find(
            (candidate) =>
              !blockedModels.has(candidate.modelId) &&
              (!candidate.health.degradedMode || candidate.health.degradedFallbackAllowed) &&
              !candidate.violations.includes("model_unavailable") &&
              !candidate.violations.includes("role_provider_excluded") &&
              !candidate.violations.includes("role_required_provider_unmatched") &&
              !candidate.violations.includes("role_required_model_unmatched")
          ) || null
        : null;
    const active = selected || fallback;
    const requiredBlocked = roleProfile.required && !active;

    return {
      schema: "scheduler.model-policy.role-assignment.v1",
      role: roleProfile.role,
      label: roleProfile.label,
      required: roleProfile.required,
      selectedModelId: selected?.modelId || null,
      selectedProvider: selected?.provider || null,
      fallbackModelId: fallback?.modelId || null,
      fallbackProvider: fallback?.provider || null,
      activeModelId: active?.modelId || null,
      activeProvider: active?.provider || null,
      state: selected
        ? "selected"
        : fallback
          ? fallback.health.degradedMode
            ? "degraded-fallback"
            : "fallback"
          : requiredBlocked
            ? "blocked"
            : "optional-unassigned",
      blockingReasons: requiredBlocked
        ? [
            "role_model_unavailable",
            ...workspaceBoundary.blockingReasons,
            ...new Set(candidates.flatMap((candidate) => candidate.violations).map((violation) => `${roleProfile.role}:${violation}`))
          ]
        : [],
      health: active?.health || null,
      recoveryAction: active?.health?.recoveryPlan || null,
      workspaceBoundary,
      policy: roleProfile,
      candidates
    };
  });
  const blockedRequiredRoles = assignments
    .filter((assignment) => assignment.required && !assignment.activeModelId)
    .map((assignment) => assignment.role);
  const dispatchPlan = buildRoleDispatchPlan(assignments);

  return {
    schema: "scheduler.model-policy.role-selection.v1",
    requiredRoles: policy.requiredRoles,
    ready: blockedRequiredRoles.length === 0 && dispatchPlan.ready,
    blockedRequiredRoles,
    selectedModelsByRole: Object.fromEntries(assignments.map((assignment) => [assignment.role, assignment.selectedModelId])),
    fallbackModelsByRole: Object.fromEntries(assignments.map((assignment) => [assignment.role, assignment.fallbackModelId])),
    activeModelsByRole: dispatchPlan.activeModelsByRole,
    activeProvidersByRole: dispatchPlan.activeProvidersByRole,
    workspaceBoundaryByRole: Object.fromEntries(assignments.map((assignment) => [assignment.role, assignment.workspaceBoundary])),
    dispatchPlan,
    assignments
  };
}

function selectPrimaryCandidate({ evaluated, operationalHealth }) {
  const blockedModels = new Set(operationalHealth.blockedModels);
  const degradedModels = new Set(operationalHealth.degradedModels);
  return (
    evaluated.find(
      (candidate) => candidate.accepted && !blockedModels.has(candidate.id) && !degradedModels.has(candidate.id)
    ) ||
    evaluated.find((candidate) => candidate.accepted && !blockedModels.has(candidate.id)) ||
    null
  );
}

function selectFallbackCandidate({ evaluated, operationalHealth }) {
  const blockedModels = new Set(operationalHealth.blockedModels);
  const degradedModels = new Set(operationalHealth.degradedModels);
  return (
    evaluated.find(
      (candidate) => candidate.available && !blockedModels.has(candidate.id) && !degradedModels.has(candidate.id)
    ) ||
    evaluated.find((candidate) => candidate.available && !blockedModels.has(candidate.id)) ||
    null
  );
}

function buildRoleHandoffManifest({ now, request, policyFingerprint, roleSelection, capabilityNegotiation, selectedOffer }) {
  const offerByModelId = new Map(capabilityNegotiation.offers.map((offer) => [offer.modelId, offer]));
  const routeContext = {
    sourceSurface: request.clientState.sourceSurface,
    currentRoute: request.clientState.currentRoute,
    returnRoute: request.clientState.returnRoute,
    sessionId: request.clientState.sessionId,
    workspaceId: request.clientState.workspaceId,
    correlationId: request.clientState.correlationId,
    pendingActionId: request.clientState.pendingActionId
  };
  const bindings = roleSelection.assignments.map((assignment) => {
    const activeOffer = assignment.activeModelId ? offerByModelId.get(assignment.activeModelId) || null : null;
    const providerRoleAssignment =
      activeOffer?.roleContract?.assignments.find((item) => item.role === assignment.role) || null;
    const handoffProtocol =
      providerRoleAssignment?.dispatchBinding ||
      activeOffer?.serviceContract?.roleDispatchBindings?.[assignment.role] ||
      activeOffer?.serviceContract?.roleDispatchBindings?.default ||
      activeOffer?.serviceContract?.handoffProtocol ||
      null;
    const handoffRoute =
      providerRoleAssignment?.dispatchRoute ||
      activeOffer?.serviceContract?.roleDispatchRoutes?.[assignment.role] ||
      activeOffer?.serviceContract?.roleDispatchRoutes?.default ||
      activeOffer?.serviceContract?.syncMetadata?.callbackRoute ||
      null;
    const blockedReasons = [
      ...assignment.blockingReasons,
      ...(providerRoleAssignment?.blockedReasons || (!assignment.activeModelId && assignment.required ? ["role_not_assigned"] : []))
    ];

    return {
      schema: "scheduler.model-policy.role-handoff-binding.v1",
      role: assignment.role,
      label: assignment.label,
      required: assignment.required,
      state: assignment.state,
      modelId: assignment.activeModelId,
      provider: assignment.activeProvider,
      selectedModelId: assignment.selectedModelId,
      fallbackModelId: assignment.fallbackModelId,
      handoffProtocol,
      handoffRoute,
      syncMode: activeOffer?.serviceContract?.syncMode || null,
      ackMode: activeOffer?.serviceContract?.syncMetadata?.ackMode || null,
      workspaceBoundary: assignment.workspaceBoundary,
      dispatchReady: Boolean(activeOffer?.dispatchReady && providerRoleAssignment && !providerRoleAssignment.blockedReasons.length),
      blockedReasons: [...new Set(blockedReasons)]
    };
  });
  const requiredBlockedRoles = bindings
    .filter((binding) => binding.required && (!binding.dispatchReady || binding.blockedReasons.length))
    .map((binding) => binding.role);
  const manifestId = stableStringify({
    taskId: request.taskId,
    policyFingerprint,
    selectedOfferModelId: selectedOffer?.modelId || null,
    activeModelsByRole: roleSelection.activeModelsByRole,
    activeProvidersByRole: roleSelection.activeProvidersByRole,
    requiredBlockedRoles
  });

  return {
    schema: "scheduler.model-policy.role-handoff-manifest.v1",
    generatedAt: now,
    manifestId,
    policyFingerprint,
    taskId: request.taskId,
    state: requiredBlockedRoles.length ? "blocked" : roleSelection.ready ? "ready" : "incomplete",
    ready: requiredBlockedRoles.length === 0 && roleSelection.ready,
    selectedOfferModelId: selectedOffer?.modelId || null,
    requiredRoles: roleSelection.requiredRoles,
    requiredBlockedRoles,
    activeModelsByRole: roleSelection.activeModelsByRole,
    activeProvidersByRole: roleSelection.activeProvidersByRole,
    workspaceBoundaryByRole: roleSelection.workspaceBoundaryByRole,
    fallbackRoles: roleSelection.dispatchPlan.fallbackRoles,
    routeContext,
    bindings
  };
}

function buildCapabilityNegotiation({ evaluated, policy, operationalHealth, lifecycleState, runtime, roleSelection, now }) {
  const offers = evaluated.map((candidate) => {
    const healthReport = operationalHealth.reports.find((report) => report.modelId === candidate.id);
    const requiredCapabilities = policy.requiredCapabilities;
    const modelCapabilityGaps = candidate.missingCapabilities;
    const contractCapabilityGaps = candidate.contractMissingCapabilities;
    const providerHandshake = buildProviderCapabilityHandshake({
      serviceContract: candidate.serviceContract,
      policyCapabilities: requiredCapabilities,
      runtime,
      now
    });
    const roleContract = buildProviderRoleContract({
      serviceContract: candidate.serviceContract,
      roleSelection,
      runtime,
      now
    });
    const contractAccepted = candidate.accepted && !healthReport?.dispatchBlocked;
    const blockedReasons = [
      ...candidate.violations,
      ...providerHandshake.blockedReasons.map((reason) => `provider_negotiation_${reason}`),
      ...roleContract.blockedReasons.map((reason) => `provider_role_contract_${reason}`),
      ...(roleContract.requiredRoleCount > 0 ? [] : ["provider_role_contract_no_required_roles"]),
      ...(healthReport?.dispatchBlocked ? ["hosted_kernel_health_blocking_dispatch"] : []),
      ...(lifecycleState.dispatchBlocked ? [lifecycleState.reason] : [])
    ];

    return {
      schema: "scheduler.model-policy.capability-offer.v1",
      modelId: candidate.id,
      provider: candidate.provider,
      requiredCapabilities,
      modelCapabilities: candidate.capabilities,
      contractCapabilities: candidate.serviceContract.supportedCapabilities,
      modelCapabilityGaps,
      contractCapabilityGaps,
      serviceContract: candidate.serviceContract,
      providerHandshake,
      roleContract,
      accepted: contractAccepted,
      negotiationReady: providerHandshake.state === "negotiated",
      roleContractReady: roleContract.ready,
      dispatchReady:
        contractAccepted &&
        providerHandshake.state === "negotiated" &&
        roleContract.ready &&
        !lifecycleState.dispatchBlocked,
      blockedReasons: [...new Set(blockedReasons)]
    };
  });
  const acceptedOffers = offers.filter((offer) => offer.accepted);
  const negotiatedOffers = acceptedOffers.filter((offer) => offer.negotiationReady);
  const roleReadyOffers = negotiatedOffers.filter((offer) => offer.roleContractReady);
  const readyRequiredRoles = [
    ...new Set(
      roleReadyOffers.flatMap((offer) =>
        offer.roleContract.assignments
          .filter((assignment) => assignment.required && !assignment.blockedReasons.length)
          .map((assignment) => assignment.role)
      )
    )
  ];
  const blockedRoleContractRoles = policy.requiredRoles.filter((role) => !readyRequiredRoles.includes(role));

  return {
    schema: "scheduler.model-policy.capability-negotiation.v1",
    generatedAt: now,
    requiredCapabilities: policy.requiredCapabilities,
    acceptedOfferCount: acceptedOffers.length,
    negotiatedOfferCount: negotiatedOffers.length,
    roleReadyOfferCount: roleReadyOffers.length,
    readyRequiredRoles,
    blockedRoleContractRoles,
    selectedOfferModelId: acceptedOffers[0]?.modelId || null,
    fallbackOfferModelId: acceptedOffers[1]?.modelId || null,
    contractReady: acceptedOffers.length > 0,
    providerNegotiationReady: negotiatedOffers.length > 0,
    providerRoleContractReady: blockedRoleContractRoles.length === 0,
    offers
  };
}

function buildExternalHandoff({ now, request, policyFingerprint, readiness, commandResult, capabilityNegotiation, roleSelection }) {
  const selectedOffer =
    capabilityNegotiation.offers.find((offer) => offer.modelId === readiness.selectedModelId) ||
    capabilityNegotiation.offers.find((offer) => offer.modelId === readiness.fallbackModelId) ||
    null;
  const serviceContract = selectedOffer?.serviceContract || null;
  const roleHandoffManifest = buildRoleHandoffManifest({
    now,
    request,
    policyFingerprint,
    roleSelection,
    capabilityNegotiation,
    selectedOffer
  });
  const handoffState = !selectedOffer
    ? "blocked"
    : readiness.dispatchable && commandResult.accepted
      ? "ready-for-provider"
      : readiness.acceptanceRequired && !commandResult.accepted
        ? "awaiting-operator-acceptance"
        : readiness.dispatchable
          ? "ready-for-acceptance"
          : "blocked";
  const dispatchKey = stableStringify({
    taskId: request.taskId,
    modelId: selectedOffer?.modelId || null,
    policyFingerprint,
    commandId: commandResult.commandId
  });

  return {
    schema: "scheduler.model-policy.external-handoff.v1",
    generatedAt: now,
    state: handoffState,
    taskId: request.taskId,
    requestedBy: request.requestedBy,
    tenancy: {
      tenantId: request.clientState.tenantBoundary.tenantId,
      requestedTenantId: request.clientState.tenantBoundary.requestedTenantId,
      workspaceId: request.clientState.workspaceId,
      requestedWorkspaceId: request.clientState.tenantBoundary.requestedWorkspaceId,
      auditTenantRoute: request.clientState.tenantBoundary.auditTenantRoute
    },
    modelId: selectedOffer?.modelId || null,
    provider: selectedOffer?.provider || null,
    endpoint: serviceContract?.endpoint || null,
    handoffProtocol: serviceContract?.handoffProtocol || null,
    syncMode: serviceContract?.syncMode || null,
    ackMode: serviceContract?.syncMetadata?.ackMode || null,
    callbackRoute: serviceContract?.syncMetadata?.callbackRoute || null,
    authMode: serviceContract?.syncMetadata?.authMode || null,
    syncMetadata: serviceContract?.syncMetadata || null,
    providerHandshake: selectedOffer?.providerHandshake || null,
    roleContract: selectedOffer?.roleContract || null,
    roleHandoffManifest,
    providerRoleContracts: capabilityNegotiation.offers
      .filter((offer) => offer.roleContract.activeRoleCount > 0)
      .map((offer) => offer.roleContract),
    blockedRoleContractRoles: capabilityNegotiation.blockedRoleContractRoles,
    timeoutMs: serviceContract?.timeoutMs || null,
    dispatchKey,
    idempotencyHeader: serviceContract?.idempotencyKeyHeader || null,
    requiredScopes: serviceContract?.requiredScopes || [],
    proofRequired: Boolean(serviceContract?.proofRequired),
    blockedReasons: selectedOffer?.blockedReasons || ["no_capability_offer"]
  };
}

function buildTenantBoundaryGate({ now, request, command, externalHandoff }) {
  const boundary = request.clientState.tenantBoundary;
  const permissionScope = {
    tenantId: boundary.requestedTenantId,
    workspaceId: boundary.requestedWorkspaceId
  };
  const requiredPermissions = [
    TENANT_REQUIRED_PERMISSIONS.preview,
    ...(command.type === "accept" ? [TENANT_REQUIRED_PERMISSIONS.accept] : []),
    ...(externalHandoff.state === "ready-for-provider" ? [TENANT_REQUIRED_PERMISSIONS.dispatch] : [])
  ];
  const auditPermission = TENANT_REQUIRED_PERMISSIONS.audit;
  const tenantAllowed = boundary.allowedTenantIds.includes(boundary.requestedTenantId);
  const workspaceAllowed = boundary.allowedWorkspaceIds.includes(boundary.requestedWorkspaceId);
  const crossTenant = boundary.tenantId !== boundary.requestedTenantId;
  const crossWorkspace = boundary.workspaceId !== boundary.requestedWorkspaceId;
  const missingPermissions = requiredPermissions.filter(
    (permission) => !hasScopedPermission(boundary, permission, permissionScope)
  );
  const auditAllowed = hasScopedPermission(boundary, auditPermission, permissionScope);
  const roleBindingProofs = boundary.roleBindings.map((binding) =>
    explainRoleBindingState(binding, permissionScope, now)
  );
  const roleBindingWarnings = roleBindingProofs
    .filter((binding) => binding.scopedToRequest && binding.state !== "active-for-request")
    .map((binding) => `role_binding_${binding.state}:${binding.id}`);
  const permissionProofs = Object.fromEntries(
    [...new Set([...requiredPermissions, auditPermission])].map((permission) => [
      permission,
      {
        granted: hasScopedPermission(boundary, permission, permissionScope),
        source: explainScopedPermission(boundary, permission, permissionScope),
        scope: permissionScope
      }
    ])
  );
  const workspaceScopeContract = buildWorkspaceScopeContract({
    now,
    boundary,
    command,
    externalHandoff,
    permissionScope,
    requiredPermissions,
    permissionProofs
  });
  const blockingReasons = [
    ...(boundary.denyCrossTenantDispatch && crossTenant ? ["cross_tenant_dispatch_denied"] : []),
    ...(tenantAllowed ? [] : ["tenant_not_granted_to_actor"]),
    ...(boundary.denyCrossTenantDispatch && crossWorkspace ? ["cross_workspace_dispatch_denied"] : []),
    ...(workspaceAllowed ? [] : ["workspace_not_granted_to_actor"]),
    ...missingPermissions.map((permission) => `missing_permission:${permission}`),
    ...(externalHandoff.proofRequired && !auditAllowed ? [`missing_permission:${auditPermission}`] : []),
    ...workspaceScopeContract.blockingReasons
  ];
  const proofSubject = {
    tenantId: boundary.tenantId,
    requestedTenantId: boundary.requestedTenantId,
    workspaceId: boundary.workspaceId,
    requestedWorkspaceId: boundary.requestedWorkspaceId,
    actorId: boundary.actorId,
    commandType: command.type,
    requiredPermissions,
    permissionScope,
    roleBindingProofs,
    workspaceScopeProofId: workspaceScopeContract.proofId,
    modelId: externalHandoff.modelId,
    dispatchKey: externalHandoff.dispatchKey
  };
  const proofId = stableStringify(proofSubject);
  const auditHandoff = {
    schema: "scheduler.model-policy.tenant-audit-handoff.v1",
    generatedAt: now,
    state: auditAllowed ? "ready" : "blocked",
    route: boundary.auditTenantRoute,
    sinkPermission: auditPermission,
    proofId,
    proofType: "scheduler.model-policy.tenant-boundary-proof.v1",
    tenantId: boundary.tenantId,
    requestedTenantId: boundary.requestedTenantId,
    workspaceId: boundary.workspaceId,
    requestedWorkspaceId: boundary.requestedWorkspaceId,
    actorId: boundary.actorId,
    dispatchKey: externalHandoff.dispatchKey,
    workspaceScopeProofId: workspaceScopeContract.proofId,
    workspaceScopeState: workspaceScopeContract.state,
    workspaceAuditClaims: workspaceScopeContract.auditClaims,
    resourceGrants: workspaceScopeContract.resourceGrants,
    blockingReasons: auditAllowed ? [] : [`missing_permission:${auditPermission}`]
  };

  return {
    schema: "scheduler.model-policy.tenant-boundary-gate.v1",
    generatedAt: now,
    pass: blockingReasons.length === 0,
    state: blockingReasons.length ? "tenant-boundary-blocked" : "tenant-boundary-ready",
    blockingReasons,
    tenantId: boundary.tenantId,
    requestedTenantId: boundary.requestedTenantId,
    workspaceId: boundary.workspaceId,
    requestedWorkspaceId: boundary.requestedWorkspaceId,
    actorId: boundary.actorId,
    actorRoles: boundary.actorRoles,
    requiredPermissions,
    missingPermissions,
    permissionGrants: boundary.permissionGrants,
    permissionBindings: boundary.permissionBindings,
    roleBindings: boundary.roleBindings,
    roleBindingProofs,
    roleBindingWarnings,
    requireWorkspaceScopedPermissions: boundary.requireWorkspaceScopedPermissions,
    workspacePolicy: boundary.workspacePolicy,
    requestedResources: boundary.requestedResources,
    resourceGrants: workspaceScopeContract.resourceGrants,
    workspaceScopeContract,
    permissionProofs,
    allowedTenantIds: boundary.allowedTenantIds,
    allowedWorkspaceIds: boundary.allowedWorkspaceIds,
    auditTenantRoute: boundary.auditTenantRoute,
    auditHandoff,
    proofSubject,
    proofId
  };
}

function buildClientRuntimeGate({ now, request, externalHandoff }) {
  const runtime = request.clientState.runtime;
  const missingScopes = externalHandoff.requiredScopes.filter((scope) => !runtime.grantedScopes.includes(scope));
  const unsupportedProtocol =
    externalHandoff.handoffProtocol && !runtime.supportedHandoffProtocols.includes(externalHandoff.handoffProtocol);
  const proofUnsupported =
    externalHandoff.proofRequired && !runtime.acceptedProofTypes.includes("scheduler.model-policy.dispatch-proof.v1");
  const backgroundUnsupported =
    request.clientState.handoffMode === "background" && !runtime.canBackgroundDispatch;
  const timeoutExceeded =
    Number.isFinite(externalHandoff.timeoutMs) && externalHandoff.timeoutMs > runtime.maxProviderTimeoutMs;
  const blockingReasons = [
    ...(externalHandoff.state === "blocked" ? [] : missingScopes.map((scope) => `missing_scope:${scope}`)),
    ...(unsupportedProtocol ? ["handoff_protocol_unsupported"] : []),
    ...(proofUnsupported ? ["dispatch_proof_type_unsupported"] : []),
    ...(backgroundUnsupported ? ["background_dispatch_not_enabled"] : []),
    ...(timeoutExceeded ? ["provider_timeout_exceeds_client_limit"] : [])
  ];
  const pass = externalHandoff.state !== "blocked" && blockingReasons.length === 0;
  const workItemRoute = pass
    ? externalHandoff.state === "ready-for-provider"
      ? "scheduler.modelPolicy.dispatch"
      : "scheduler.modelPolicy.accept"
    : blockingReasons.includes("background_dispatch_not_enabled")
      ? "scheduler.modelPolicy.accept"
      : "scheduler.modelPolicy.configureClientRuntime";

  return {
    schema: "scheduler.model-policy.client-runtime-gate.v1",
    generatedAt: now,
    pass,
    state: pass ? "client-runtime-ready" : externalHandoff.state === "blocked" ? "provider-handoff-blocked" : "client-runtime-blocked",
    blockingReasons,
    missingScopes,
    supportedHandoffProtocols: runtime.supportedHandoffProtocols,
    grantedScopes: runtime.grantedScopes,
    acceptedProofTypes: runtime.acceptedProofTypes,
    handoffMode: request.clientState.handoffMode,
    canBackgroundDispatch: runtime.canBackgroundDispatch,
    maxProviderTimeoutMs: runtime.maxProviderTimeoutMs,
    proofSinkRoute: runtime.proofSinkRoute,
    acknowledgementId: runtime.acknowledgementId,
    requiredProtocol: externalHandoff.handoffProtocol,
    requiredScopes: externalHandoff.requiredScopes,
    requiredTimeoutMs: externalHandoff.timeoutMs,
    visibleWorkItem: {
      id: pass ? "continue-hosted-kernel-handoff" : "resolve-client-runtime-handoff",
      route: workItemRoute,
      label: pass ? "Continue hosted-kernel handoff" : "Resolve client handoff requirements",
      severity: pass ? "info" : "warning",
      visibleToUser: request.clientState.visibleToUser
    }
  };
}

function buildHostedKernelDispatchEnvelope({
  now,
  request,
  policy,
  policyFingerprint,
  readiness,
  commandResult,
  externalHandoff,
  capabilityNegotiation,
  lifecycleState,
  operationalHealth,
  roleSelection,
  validationSummary,
  clientRuntimeGate,
  tenantBoundaryGate,
  acceptanceTruth
}) {
  const selectedOffer =
    capabilityNegotiation.offers.find((offer) => offer.modelId === externalHandoff.modelId) || null;
  const healthReport = operationalHealth.reports.find((report) => report.modelId === externalHandoff.modelId) || null;
  const preflightFailures = [
    ...(externalHandoff.state === "blocked" ? externalHandoff.blockedReasons : []),
    ...(commandResult.accepted ? [] : ["operator_acceptance_missing"]),
    ...(readiness.dispatchable ? [] : ["readiness_not_dispatchable"]),
    ...(lifecycleState.dispatchBlocked ? [lifecycleState.reason] : []),
    ...(validationSummary.errors || []),
    ...(healthReport?.dispatchBlocked ? ["hosted_kernel_health_blocking_dispatch"] : []),
    ...(capabilityNegotiation.providerRoleContractReady
      ? []
      : capabilityNegotiation.blockedRoleContractRoles.map((role) => `provider_role_contract_blocked:${role}`)),
    ...(selectedOffer?.roleContract?.ready ? [] : selectedOffer?.roleContract?.blockedReasons || ["provider_role_contract_unready"]),
    ...(clientRuntimeGate.pass ? [] : clientRuntimeGate.blockingReasons),
    ...(tenantBoundaryGate.pass ? [] : tenantBoundaryGate.blockingReasons)
  ];
  const uniquePreflightFailures = [...new Set(preflightFailures.filter(Boolean))];
  const invocationReady =
    externalHandoff.state === "ready-for-provider" &&
    commandResult.accepted &&
    readiness.dispatchable &&
    clientRuntimeGate.pass &&
    tenantBoundaryGate.pass &&
    selectedOffer?.roleContract?.ready &&
    capabilityNegotiation.providerRoleContractReady &&
    uniquePreflightFailures.length === 0 &&
    Boolean(selectedOffer?.serviceContract?.endpoint);
  const routeContext = {
    sourceSurface: request.clientState.sourceSurface,
    currentRoute: request.clientState.currentRoute,
    returnRoute: request.clientState.returnRoute,
    ownerRoute: invocationReady ? "scheduler.modelPolicy.dispatch" : "scheduler.modelPolicy.accept",
    correlationId: request.clientState.correlationId,
    workspaceId: request.clientState.workspaceId,
    sessionId: request.clientState.sessionId,
    tenantId: request.clientState.tenantBoundary.tenantId,
    requestedTenantId: request.clientState.tenantBoundary.requestedTenantId,
    requestedWorkspaceId: request.clientState.tenantBoundary.requestedWorkspaceId
  };
  const proofInputs = {
    taskId: request.taskId,
    requestedBy: request.requestedBy,
    modelId: externalHandoff.modelId,
    policyFingerprint,
    commandId: commandResult.commandId,
    dispatchKey: externalHandoff.dispatchKey,
    handoffState: externalHandoff.state
  };
  const proofId = stableStringify(proofInputs);

  return {
    schema: "scheduler.model-policy.hosted-kernel-dispatch-envelope.v1",
    generatedAt: now,
    state: invocationReady ? "ready" : uniquePreflightFailures.length ? "blocked" : "pending-acceptance",
    proofId,
    proofType: "scheduler.model-policy.dispatch-proof.v1",
    invocationReady,
    preflight: {
      pass: invocationReady,
      failures: uniquePreflightFailures,
      warnings: validationSummary.warnings,
      lifecycleReason: lifecycleState.reason,
      healthState: operationalHealth.state,
      healthRecoveryPlan: healthReport
        ? operationalHealth.recoveryPlans.find((plan) => plan.modelId === healthReport.modelId) || null
        : null,
      clientRuntimeState: clientRuntimeGate.state,
      tenantBoundaryState: tenantBoundaryGate.state
    },
    providerInvocation: invocationReady
      ? {
          schema: "hosted-kernel.dispatch-request.v1",
          endpoint: selectedOffer.serviceContract.endpoint,
          method: "POST",
          handoffProtocol: selectedOffer.serviceContract.handoffProtocol,
          syncMode: selectedOffer.serviceContract.syncMode,
          idempotencyHeader: selectedOffer.serviceContract.idempotencyKeyHeader,
          idempotencyKey: externalHandoff.dispatchKey,
          timeoutMs: selectedOffer.serviceContract.timeoutMs,
          requiredScopes: selectedOffer.serviceContract.requiredScopes,
          sync: {
            mode: selectedOffer.serviceContract.syncMode,
            ackMode: selectedOffer.serviceContract.syncMetadata.ackMode,
            callbackRoute: selectedOffer.serviceContract.syncMetadata.callbackRoute,
            leaseSeconds: selectedOffer.serviceContract.syncMetadata.leaseSeconds,
            watermark: selectedOffer.serviceContract.syncMetadata.watermark
          },
          auth: {
            mode: selectedOffer.serviceContract.syncMetadata.authMode,
            requiresBoundaryToken: selectedOffer.serviceContract.syncMetadata.requiresBoundaryToken,
            boundaryTokenPresent: Boolean(request.clientState.tenantBoundary.boundaryToken)
          },
          providerHandshake: selectedOffer.providerHandshake,
          roleContract: selectedOffer.roleContract,
          roleHandoffManifest: externalHandoff.roleHandoffManifest,
          providerRoleContracts: externalHandoff.providerRoleContracts,
          body: {
            taskId: request.taskId,
            requestedBy: request.requestedBy,
            modelId: externalHandoff.modelId,
            policyFingerprint,
            requiredCapabilities: policy.requiredCapabilities,
            roleSelection,
            acceptance: {
              commandId: commandResult.commandId,
              decidedAt: commandResult.decision.decidedAt,
              status: commandResult.status
            },
            providerSync: selectedOffer.serviceContract.syncMetadata,
            capabilityHandshake: selectedOffer.providerHandshake,
            roleContract: selectedOffer.roleContract,
            roleHandoffManifest: externalHandoff.roleHandoffManifest,
            providerRoleContracts: externalHandoff.providerRoleContracts,
            routeContext,
            tenantBoundary: {
              tenantId: tenantBoundaryGate.tenantId,
              requestedTenantId: tenantBoundaryGate.requestedTenantId,
              workspaceId: tenantBoundaryGate.workspaceId,
              requestedWorkspaceId: tenantBoundaryGate.requestedWorkspaceId,
              actorId: tenantBoundaryGate.actorId,
              permissionProofs: tenantBoundaryGate.permissionProofs,
              roleBindingProofs: tenantBoundaryGate.roleBindingProofs,
              workspaceScope: {
                proofId: tenantBoundaryGate.workspaceScopeContract.proofId,
                proofType: tenantBoundaryGate.workspaceScopeContract.proofType,
                state: tenantBoundaryGate.workspaceScopeContract.state,
                providerClaims: tenantBoundaryGate.workspaceScopeContract.providerClaims
              },
              auditHandoff: tenantBoundaryGate.auditHandoff,
              proofId: tenantBoundaryGate.proofId
            }
          }
        }
      : null,
    auditProof: {
      proofInputs,
      selectedOfferModelId: capabilityNegotiation.selectedOfferModelId,
      fallbackOfferModelId: capabilityNegotiation.fallbackOfferModelId,
      provider: externalHandoff.provider,
      endpoint: externalHandoff.endpoint,
      contractReady: capabilityNegotiation.contractReady,
      providerRoleContractReady: capabilityNegotiation.providerRoleContractReady,
      roleHandoffManifestId: externalHandoff.roleHandoffManifest?.manifestId || null,
      acceptanceApplied: commandResult.applied,
      idempotentReplay: commandResult.idempotentReplay,
      workspaceScopeContract: tenantBoundaryGate.workspaceScopeContract,
      clientRuntimeGate,
      tenantBoundaryGate,
      healthRecoveryPlans: operationalHealth.recoveryPlans,
      roleSelection,
      routeContext
    }
  };
}

function buildValidationSummary({
  evaluated,
  policy,
  request,
  operationalHealth,
  lifecycleState,
  capabilityNegotiation,
  tenantBoundaryGate,
  roleSelection,
  acceptanceTruth
}) {
  const accepted = evaluated.filter((candidate) => candidate.accepted);
  const rejected = evaluated.filter((candidate) => !candidate.accepted);
  const providerRoleBlockingReasons = capabilityNegotiation.offers
    .filter((offer) => offer.accepted && !offer.roleContractReady)
    .flatMap((offer) => offer.roleContract?.blockedReasons || ["provider_role_contract_unready"]);
  const roleWorkspaceBlockingReasons = roleSelection.assignments
    .flatMap((assignment) => assignment.workspaceBoundary?.blockingReasons || [])
    .map((reason) => `role_workspace_boundary:${reason}`);
  const warnings = [];
  if (!request.taskId) warnings.push("task_id_missing");
  if (!request.userVisibleLabel) warnings.push("preview_label_missing");
  if (!accepted.length && policy.allowFallback) warnings.push("fallback_required");
  if (!capabilityNegotiation.contractReady) warnings.push("provider_contract_negotiation_unready");
  if (capabilityNegotiation.contractReady && !capabilityNegotiation.providerNegotiationReady) {
    warnings.push("provider_capability_handshake_pending");
  }
  if (capabilityNegotiation.providerNegotiationReady && !capabilityNegotiation.providerRoleContractReady) {
    warnings.push("provider_role_contract_pending");
  }
  if (operationalHealth.degradedMode) warnings.push("hosted_kernel_degraded_mode");
  if (operationalHealth.blockedModels.length) warnings.push("hosted_kernel_health_blocking_dispatch");
  if (!tenantBoundaryGate.pass) warnings.push("tenant_boundary_action_required");
  if (!roleSelection.ready) warnings.push("required_role_selection_blocked");
  if (acceptanceTruth.acceptRequested && !acceptanceTruth.pass) warnings.push("acceptance_truth_action_required");
  warnings.push(...tenantBoundaryGate.roleBindingWarnings);
  warnings.push(...lifecycleState.validationWarnings);

  return {
    ready:
      accepted.length > 0 &&
      roleSelection.ready &&
      operationalHealth.state !== "unhealthy" &&
      !lifecycleState.dispatchBlocked &&
      tenantBoundaryGate.pass &&
      capabilityNegotiation.providerRoleContractReady &&
      acceptanceTruth.pass,
    acceptedCount: accepted.length,
    rejectedCount: rejected.length,
    warnings,
    errors: [
      ...lifecycleState.validationErrors,
      ...tenantBoundaryGate.blockingReasons,
      ...roleSelection.blockedRequiredRoles.map((role) => `required_role_blocked:${role}`),
      ...roleWorkspaceBlockingReasons,
      ...capabilityNegotiation.blockedRoleContractRoles.map((role) => `provider_role_contract_blocked:${role}`),
      ...providerRoleBlockingReasons.map((reason) => `provider_role_contract:${reason}`),
      ...acceptanceTruth.blockingReasons
    ],
    requiredCapabilities: policy.requiredCapabilities,
    roleSelection: {
      ready: roleSelection.ready,
      requiredRoles: roleSelection.requiredRoles,
      blockedRequiredRoles: roleSelection.blockedRequiredRoles,
      selectedModelsByRole: roleSelection.selectedModelsByRole,
      fallbackModelsByRole: roleSelection.fallbackModelsByRole,
      workspaceBoundaryByRole: roleSelection.workspaceBoundaryByRole
    },
    capabilityNegotiation: {
      contractReady: capabilityNegotiation.contractReady,
      providerNegotiationReady: capabilityNegotiation.providerNegotiationReady,
      providerRoleContractReady: capabilityNegotiation.providerRoleContractReady,
      acceptedOfferCount: capabilityNegotiation.acceptedOfferCount,
      negotiatedOfferCount: capabilityNegotiation.negotiatedOfferCount,
      roleReadyOfferCount: capabilityNegotiation.roleReadyOfferCount,
      readyRequiredRoles: capabilityNegotiation.readyRequiredRoles,
      blockedRoleContractRoles: capabilityNegotiation.blockedRoleContractRoles,
      selectedOfferModelId: capabilityNegotiation.selectedOfferModelId,
      fallbackOfferModelId: capabilityNegotiation.fallbackOfferModelId
    },
    acceptanceTruth: {
      pass: acceptanceTruth.pass,
      state: acceptanceTruth.state,
      commandModelId: acceptanceTruth.commandModelId,
      modelBindingState: acceptanceTruth.modelBindingState,
      fingerprintState: acceptanceTruth.fingerprintState,
      offerState: acceptanceTruth.offerState,
      blockingReasons: acceptanceTruth.blockingReasons
    },
    constraints: {
      maxLatencyMs: policy.maxLatencyMs,
      minContextTokens: policy.minContextTokens,
      allowFallback: policy.allowFallback
    },
    lifecycle: {
      enabled: lifecycleState.enabled,
      dispatchBlocked: lifecycleState.dispatchBlocked,
      reason: lifecycleState.reason,
      nextAction: lifecycleState.nextAction
    }
  };
}

function buildActionableErrors({ selected, fallback, operationalHealth, lifecycleState }) {
  if (lifecycleState.dispatchBlocked) {
    return [
      {
        code: lifecycleState.reason,
        severity: lifecycleState.validationErrors.length ? "error" : "warning",
        message: "Hosted-kernel model dispatch is blocked by lifecycle settings.",
        validationErrors: lifecycleState.validationErrors,
        validationWarnings: lifecycleState.validationWarnings,
        action: lifecycleState.nextAction.action
      }
    ];
  }

  const candidate = selected || fallback;
  if (!candidate) {
    return [
      {
        code: "no_model_candidate",
        severity: "error",
        message: "No hosted-kernel model can be selected for this policy.",
        action: "relax policy constraints or add an available hosted-kernel model"
      }
    ];
  }

  const report = operationalHealth.reports.find((item) => item.modelId === candidate.id);
  if (!report || report.state === "healthy") return [];
  const recoveryPlan = operationalHealth.recoveryPlans.find((plan) => plan.modelId === candidate.id) || null;

  return [
    {
      code: report.dispatchBlocked ? "hosted_kernel_dispatch_blocked" : "hosted_kernel_degraded",
      severity: report.dispatchBlocked ? "error" : "warning",
      modelId: candidate.id,
      provider: candidate.provider,
      message: report.dispatchBlocked
        ? `${candidate.id} cannot be dispatched until hosted-kernel health recovers.`
        : `${candidate.id} is dispatchable in degraded mode with retry telemetry.`,
      failures: report.failures,
      retry: report.retry,
      failureState: report.failureState,
      recoveryPlan,
      action: report.action
    }
  ];
}

function countViolations(evaluated) {
  return evaluated.reduce((counts, candidate) => {
    for (const violation of candidate.violations) {
      counts[violation] = (counts[violation] || 0) + 1;
    }
    return counts;
  }, {});
}

function incrementCount(counts, key) {
  if (typeof key === "string" && key.trim()) counts[key.trim()] = (counts[key.trim()] || 0) + 1;
  return counts;
}

function buildAnalyticsCounters({
  evaluated,
  readiness,
  operationalHealth,
  commandResult,
  validationSummary,
  lifecycleState,
  roleSelection,
  persistedState
}) {
  const acceptedCandidates = evaluated.filter((candidate) => candidate.accepted);
  const fallbackEligibleCandidates = evaluated.filter(
    (candidate) => candidate.available && !operationalHealth.blockedModels.includes(candidate.id)
  );
  const healthCounts = operationalHealth.reports.reduce(
    (counts, report) => {
      counts[report.state] = (counts[report.state] || 0) + 1;
      return counts;
    },
    { healthy: 0, degraded: 0, unhealthy: 0, unknown: 0 }
  );
  const roleAssignmentCounts = roleSelection.assignments.reduce(
    (counts, assignment) => incrementCount(counts, assignment.state),
    { selected: 0, fallback: 0, "degraded-fallback": 0, blocked: 0, "optional-unassigned": 0 }
  );
  const activeProviderCounts = roleSelection.assignments.reduce((counts, assignment) => {
    if (assignment.activeProvider) incrementCount(counts, assignment.activeProvider);
    return counts;
  }, {});
  const fallbackProviderCounts = roleSelection.assignments.reduce((counts, assignment) => {
    if (
      (assignment.state === "fallback" || assignment.state === "degraded-fallback") &&
      assignment.fallbackProvider
    ) {
      incrementCount(counts, assignment.fallbackProvider);
    }
    return counts;
  }, {});
  const receiptTypeCounts = persistedState.commandReceipts.reduce((counts, receipt) => incrementCount(counts, receipt.type), {});
  const receiptProblemCount = persistedState.commandReceipts.filter((receipt) => receipt.problems.length > 0).length;

  return {
    schema: "scheduler.model-policy.analytics-counters.v1",
    totalCandidates: evaluated.length,
    acceptedCandidates: acceptedCandidates.length,
    rejectedCandidates: evaluated.length - acceptedCandidates.length,
    fallbackEligibleCandidates: fallbackEligibleCandidates.length,
    dispatchBlockedCandidates: operationalHealth.blockedModels.length,
    degradedCandidates: operationalHealth.degradedModels.length,
    warningCount: validationSummary.warnings.length,
    violationCounts: countViolations(evaluated),
    healthCounts,
    commandCounts: {
      preview: commandResult.auditEvent.commandType === "preview" ? 1 : 0,
      accepted: commandResult.accepted ? 1 : 0,
      held: commandResult.auditEvent.commandType === "hold" && !commandResult.problems.length ? 1 : 0,
      rejected: commandResult.auditEvent.commandType === "reject" && !commandResult.problems.length ? 1 : 0,
      lifecycleChanged: commandResult.lifecycleChanged ? 1 : 0,
      failed: commandResult.problems.length ? 1 : 0,
      replayed: commandResult.idempotentReplay ? 1 : 0
    },
    commandReceiptCounts: {
      total: persistedState.commandReceipts.length,
      applied: persistedState.commandReceipts.filter((receipt) => receipt.applied).length,
      accepted: persistedState.commandReceipts.filter((receipt) => receipt.accepted).length,
      lifecycleChanged: persistedState.commandReceipts.filter((receipt) => receipt.lifecycleChanged).length,
      withProblems: receiptProblemCount,
      byType: receiptTypeCounts
    },
    roleAssignmentCounts,
    providerAssignmentCounts: {
      active: activeProviderCounts,
      fallback: fallbackProviderCounts,
      multiRoleProviders: Object.entries(roleSelection.dispatchPlan.providerCoverage)
        .filter(([, group]) => group.roles.length > 1)
        .map(([provider]) => provider)
    },
    readinessCounts: {
      dispatchable: readiness.dispatchable ? 1 : 0,
      acceptanceRequired: readiness.acceptanceRequired ? 1 : 0,
      degradedMode: readiness.degradedMode ? 1 : 0,
      lifecycleBlocked: lifecycleState.dispatchBlocked ? 1 : 0
    }
  };
}

function buildAnalyticsSnapshot({
  now,
  request,
  readiness,
  operationalHealth,
  commandResult,
  policyFingerprint,
  analyticsCounters,
  roleSelection
}) {
  return {
    schema: "scheduler.model-policy.analytics-snapshot.v1",
    generatedAt: now,
    policyFingerprint,
    taskId: request.taskId,
    status: commandResult.status,
    selectedModelId: readiness.selectedModelId,
    fallbackModelId: readiness.fallbackModelId,
    counters: {
      totalCandidates: analyticsCounters.totalCandidates,
      acceptedCandidates: analyticsCounters.acceptedCandidates,
      rejectedCandidates: analyticsCounters.rejectedCandidates,
      dispatchBlockedCandidates: analyticsCounters.dispatchBlockedCandidates,
      degradedCandidates: analyticsCounters.degradedCandidates
    },
    roleCoverage: {
      ready: roleSelection.ready,
      requiredRoles: roleSelection.requiredRoles,
      blockedRequiredRoles: roleSelection.blockedRequiredRoles,
      fallbackRoles: roleSelection.dispatchPlan.fallbackRoles,
      assignmentStates: analyticsCounters.roleAssignmentCounts,
      activeModelsByRole: roleSelection.activeModelsByRole,
      activeProvidersByRole: roleSelection.activeProvidersByRole,
      workspaceBoundaryByRole: roleSelection.workspaceBoundaryByRole
    },
    providerCoverage: {
      activeProviderCounts: analyticsCounters.providerAssignmentCounts.active,
      fallbackProviderCounts: analyticsCounters.providerAssignmentCounts.fallback,
      multiRoleProviders: analyticsCounters.providerAssignmentCounts.multiRoleProviders
    },
    commandRollup: {
      appliedReceiptCount: analyticsCounters.commandReceiptCounts.applied,
      acceptedReceiptCount: analyticsCounters.commandReceiptCounts.accepted,
      lifecycleReceiptCount: analyticsCounters.commandReceiptCounts.lifecycleChanged,
      problemReceiptCount: analyticsCounters.commandReceiptCounts.withProblems,
      receiptTypeCounts: analyticsCounters.commandReceiptCounts.byType
    },
    health: {
      state: operationalHealth.state,
      blockedModels: operationalHealth.blockedModels,
      degradedModels: operationalHealth.degradedModels
    },
    command: {
      type: commandResult.auditEvent.commandType,
      applied: commandResult.applied,
      replay: commandResult.idempotentReplay
    }
  };
}

function appendAnalyticsHistory(previousHistory, snapshot) {
  return [...previousHistory, snapshot].slice(-ANALYTICS_HISTORY_LIMIT);
}

function sumSnapshotCounters(history) {
  return history.reduce(
    (totals, snapshot) => ({
      totalCandidates: totals.totalCandidates + snapshot.counters.totalCandidates,
      acceptedCandidates: totals.acceptedCandidates + snapshot.counters.acceptedCandidates,
      rejectedCandidates: totals.rejectedCandidates + snapshot.counters.rejectedCandidates,
      dispatchBlockedCandidates: totals.dispatchBlockedCandidates + snapshot.counters.dispatchBlockedCandidates,
      degradedCandidates: totals.degradedCandidates + snapshot.counters.degradedCandidates
    }),
    {
      totalCandidates: 0,
      acceptedCandidates: 0,
      rejectedCandidates: 0,
      dispatchBlockedCandidates: 0,
      degradedCandidates: 0
    }
  );
}

function countSnapshotValues(history, selector) {
  return history.reduce((counts, snapshot) => {
    const value = selector(snapshot);
    if (value) counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

function sumSnapshotMaps(history, selector) {
  return history.reduce((totals, snapshot) => {
    const values = selector(snapshot);
    for (const [key, count] of Object.entries(values || {})) {
      totals[key] = (totals[key] || 0) + count;
    }
    return totals;
  }, {});
}

function buildAnalyticsTrendReport({ now, request, policyFingerprint, analyticsHistory }) {
  const latest = analyticsHistory.at(-1) || null;
  const previous = analyticsHistory.at(-2) || null;
  const totals = sumSnapshotCounters(analyticsHistory);
  const commandTypeCounts = countSnapshotValues(analyticsHistory, (snapshot) => snapshot.command.type);
  const statusCounts = countSnapshotValues(analyticsHistory, (snapshot) => snapshot.status);
  const healthStateCounts = countSnapshotValues(analyticsHistory, (snapshot) => snapshot.health.state);
  const selectedModelCounts = countSnapshotValues(analyticsHistory, (snapshot) => snapshot.selectedModelId);
  const roleStateCounts = sumSnapshotMaps(analyticsHistory, (snapshot) => snapshot.roleCoverage.assignmentStates);
  const activeProviderCounts = sumSnapshotMaps(analyticsHistory, (snapshot) => snapshot.providerCoverage.activeProviderCounts);
  const fallbackProviderCounts = sumSnapshotMaps(analyticsHistory, (snapshot) => snapshot.providerCoverage.fallbackProviderCounts);
  const commandReceiptTypeCounts = sumSnapshotMaps(analyticsHistory, (snapshot) => snapshot.commandRollup.receiptTypeCounts);
  const blockedModelCounts = analyticsHistory.reduce((counts, snapshot) => {
    for (const modelId of snapshot.health.blockedModels) counts[modelId] = (counts[modelId] || 0) + 1;
    return counts;
  }, {});
  const blockedRoleCounts = analyticsHistory.reduce((counts, snapshot) => {
    for (const role of snapshot.roleCoverage.blockedRequiredRoles) counts[role] = (counts[role] || 0) + 1;
    return counts;
  }, {});
  const fallbackRoleCounts = analyticsHistory.reduce((counts, snapshot) => {
    for (const role of snapshot.roleCoverage.fallbackRoles) counts[role] = (counts[role] || 0) + 1;
    return counts;
  }, {});
  const statusChanged = Boolean(previous && latest && previous.status !== latest.status);
  const healthChanged = Boolean(previous && latest && previous.health.state !== latest.health.state);
  const roleReadinessChanged = Boolean(previous && latest && previous.roleCoverage.ready !== latest.roleCoverage.ready);
  const activeProviderChanged = Boolean(
    previous &&
      latest &&
      stableStringify(previous.roleCoverage.activeProvidersByRole) !== stableStringify(latest.roleCoverage.activeProvidersByRole)
  );
  const acceptedDelta =
    latest && previous ? latest.counters.acceptedCandidates - previous.counters.acceptedCandidates : 0;
  const blockedDelta =
    latest && previous
      ? latest.counters.dispatchBlockedCandidates - previous.counters.dispatchBlockedCandidates
      : 0;
  const reportState = !latest
    ? "empty"
    : latest.health.state === "unhealthy" || latest.status === "blocked"
      ? "attention-required"
      : statusChanged || healthChanged || roleReadinessChanged || activeProviderChanged || acceptedDelta || blockedDelta
        ? "changed"
        : "stable";

  return {
    schema: "scheduler.model-policy.analytics-trend-report.v1",
    generatedAt: now,
    taskId: request.taskId,
    policyFingerprint,
    state: reportState,
    historyWindow: {
      retainedSnapshots: analyticsHistory.length,
      retentionLimit: ANALYTICS_HISTORY_LIMIT,
      firstSnapshotAt: analyticsHistory[0]?.generatedAt || null,
      latestSnapshotAt: latest?.generatedAt || null
    },
    totals,
    distributions: {
      commandTypes: commandTypeCounts,
      statuses: statusCounts,
      healthStates: healthStateCounts,
      selectedModels: selectedModelCounts,
      blockedModels: blockedModelCounts,
      roleStates: roleStateCounts,
      blockedRoles: blockedRoleCounts,
      fallbackRoles: fallbackRoleCounts,
      activeProviders: activeProviderCounts,
      fallbackProviders: fallbackProviderCounts,
      commandReceiptTypes: commandReceiptTypeCounts
    },
    deltaFromPrevious: previous && latest
      ? {
          previousSnapshotAt: previous.generatedAt,
          statusChanged,
          healthChanged,
          roleReadinessChanged,
          activeProviderChanged,
          acceptedCandidates: acceptedDelta,
          dispatchBlockedCandidates: blockedDelta,
          selectedModelChanged: previous.selectedModelId !== latest.selectedModelId,
          commandChanged: previous.command.type !== latest.command.type
        }
      : null,
    reportFlags: [
      ...(latest?.command.replay ? ["idempotent_replay"] : []),
      ...(blockedDelta > 0 ? ["blocked_candidate_increase"] : []),
      ...(acceptedDelta < 0 ? ["accepted_candidate_drop"] : []),
      ...(healthChanged ? ["health_state_changed"] : []),
      ...(statusChanged ? ["readiness_status_changed"] : []),
      ...(roleReadinessChanged ? ["role_readiness_changed"] : []),
      ...(activeProviderChanged ? ["role_provider_assignment_changed"] : []),
      ...(latest?.roleCoverage.blockedRequiredRoles.length ? ["required_role_blocked"] : [])
    ]
  };
}

function buildAnalyticsExportManifest({ now, request, analyticsHistory, exportSummary, trendReport, reportingTimeline }) {
  const latest = analyticsHistory.at(-1) || null;
  const exportId = stableStringify({
    taskId: request.taskId,
    generatedAt: now,
    policyFingerprint: exportSummary.policyFingerprint,
    latestSnapshotAt: latest?.generatedAt || null,
    retainedSnapshots: analyticsHistory.length
  });

  return {
    schema: "scheduler.model-policy.analytics-export-manifest.v1",
    generatedAt: now,
    exportId,
    route: "scheduler.modelPolicy.analytics.export",
    taskId: request.taskId,
    policyFingerprint: exportSummary.policyFingerprint,
    ready: Boolean(latest),
    retention: trendReport.historyWindow,
    datasets: [
      {
        id: "summary",
        schema: exportSummary.schema,
        rows: 1,
        proofKey: exportSummary.policyFingerprint
      },
      {
        id: "history",
        schema: "scheduler.model-policy.analytics-snapshot.v1",
        rows: analyticsHistory.length,
        proofKey: latest?.policyFingerprint || exportSummary.policyFingerprint
      },
      {
        id: "timeline",
        schema: "scheduler.model-policy.reporting-timeline.v1",
        rows: reportingTimeline.length,
        proofKey: reportingTimeline.at(-1)?.type || null
      },
      {
        id: "trend-report",
        schema: trendReport.schema,
        rows: trendReport.historyWindow.retainedSnapshots ? 1 : 0,
        proofKey: trendReport.state
      },
      {
        id: "role-provider-coverage",
        schema: "scheduler.model-policy.analytics-role-provider-coverage.v1",
        rows: Object.keys(exportSummary.roleProviderCoverage.activeProviderCounts).length,
        proofKey: exportSummary.roleProviderCoverage.ready ? "ready" : "blocked"
      }
    ],
    controls: {
      includesTenantBoundaryProof: Boolean(exportSummary.tenantBoundary?.proofId),
      includesWorkspaceScopeProof: Boolean(exportSummary.tenantBoundary?.workspaceScopeContract?.proofId),
      includesFailureStateLedger: Boolean(exportSummary.hostedKernel?.failureStateLedger),
      redactionPolicy: "tenant-boundary-proofs-only"
    }
  };
}

function buildExportSummary({
  now,
  request,
  policyFingerprint,
  analyticsCounters,
  readiness,
  operationalHealth,
    roleSelection,
    capabilityNegotiation,
    externalHandoff,
    tenantBoundaryGate
}) {
  return {
    schema: "scheduler.model-policy.analytics-export.v1",
    exportedAt: now,
    taskId: request.taskId,
    requestedBy: request.requestedBy,
    policyFingerprint,
    status: readiness.dispatchable ? "dispatchable" : readiness.state,
    selectedModelId: readiness.selectedModelId,
    fallbackModelId: readiness.fallbackModelId,
    candidateTotals: {
      total: analyticsCounters.totalCandidates,
      accepted: analyticsCounters.acceptedCandidates,
      rejected: analyticsCounters.rejectedCandidates,
      fallbackEligible: analyticsCounters.fallbackEligibleCandidates
    },
    healthTotals: analyticsCounters.healthCounts,
    violationTotals: analyticsCounters.violationCounts,
    warningCount: analyticsCounters.warningCount,
    commandReceiptTotals: analyticsCounters.commandReceiptCounts,
    roleProviderCoverage: {
      ready: roleSelection.ready,
      requiredRoles: roleSelection.requiredRoles,
      blockedRequiredRoles: roleSelection.blockedRequiredRoles,
      fallbackRoles: roleSelection.dispatchPlan.fallbackRoles,
      assignmentStates: analyticsCounters.roleAssignmentCounts,
      activeProviderCounts: analyticsCounters.providerAssignmentCounts.active,
      fallbackProviderCounts: analyticsCounters.providerAssignmentCounts.fallback,
      multiRoleProviders: analyticsCounters.providerAssignmentCounts.multiRoleProviders,
      activeModelsByRole: roleSelection.activeModelsByRole,
      activeProvidersByRole: roleSelection.activeProvidersByRole,
      workspaceBoundaryByRole: roleSelection.workspaceBoundaryByRole
    },
    hostedKernel: {
      state: operationalHealth.state,
      blockedModels: operationalHealth.blockedModels,
      degradedModels: operationalHealth.degradedModels,
      failureStateLedger: operationalHealth.failureStateLedger,
      recoveryPlans: operationalHealth.recoveryPlans
    },
    roleSelection,
    providerContract: {
      contractReady: capabilityNegotiation.contractReady,
      providerNegotiationReady: capabilityNegotiation.providerNegotiationReady,
      providerRoleContractReady: capabilityNegotiation.providerRoleContractReady,
      acceptedOfferCount: capabilityNegotiation.acceptedOfferCount,
      negotiatedOfferCount: capabilityNegotiation.negotiatedOfferCount,
      roleReadyOfferCount: capabilityNegotiation.roleReadyOfferCount,
      readyRequiredRoles: capabilityNegotiation.readyRequiredRoles,
      blockedRoleContractRoles: capabilityNegotiation.blockedRoleContractRoles,
      selectedOfferModelId: capabilityNegotiation.selectedOfferModelId,
      handoffState: externalHandoff.state,
      handoffProtocol: externalHandoff.handoffProtocol,
      syncMode: externalHandoff.syncMode,
      ackMode: externalHandoff.ackMode,
      callbackRoute: externalHandoff.callbackRoute,
      authMode: externalHandoff.authMode,
      providerHandshakeState: externalHandoff.providerHandshake?.state || null,
      roleContractState: externalHandoff.roleContract?.state || null,
      providerRoleContracts: externalHandoff.providerRoleContracts,
      roleContract: externalHandoff.roleContract
    },
    tenantBoundary: {
      state: tenantBoundaryGate.state,
      tenantId: tenantBoundaryGate.tenantId,
      requestedTenantId: tenantBoundaryGate.requestedTenantId,
      workspaceId: tenantBoundaryGate.workspaceId,
      requestedWorkspaceId: tenantBoundaryGate.requestedWorkspaceId,
      pass: tenantBoundaryGate.pass,
      blockingReasons: tenantBoundaryGate.blockingReasons,
      permissionProofs: tenantBoundaryGate.permissionProofs,
      roleBindingProofs: tenantBoundaryGate.roleBindingProofs,
      roleBindingWarnings: tenantBoundaryGate.roleBindingWarnings,
      workspacePolicy: tenantBoundaryGate.workspacePolicy,
      requestedResources: tenantBoundaryGate.requestedResources,
      resourceGrants: tenantBoundaryGate.resourceGrants,
      workspaceScopeContract: tenantBoundaryGate.workspaceScopeContract,
      auditTenantRoute: tenantBoundaryGate.auditTenantRoute,
      auditHandoff: tenantBoundaryGate.auditHandoff,
      proofId: tenantBoundaryGate.proofId
    },
    lifecycle: {
      dispatchBlocked: readiness.lifecycle.dispatchBlocked,
      reason: readiness.lifecycle.reason,
      nextAction: readiness.lifecycle.nextAction
    }
  };
}

function buildReportingTimeline({ now, request, readiness, operationalHealth, commandResult, historySnapshot, roleSelection }) {
  const timeline = [
    {
      at: now,
      type: "policy-evaluated",
      status: readiness.state,
      taskId: request.taskId,
      selectedModelId: readiness.selectedModelId,
      fallbackModelId: readiness.fallbackModelId
    },
    {
      at: now,
      type: "health-assessed",
      status: operationalHealth.state,
      blockedModels: operationalHealth.blockedModels,
      degradedModels: operationalHealth.degradedModels
    },
    {
      at: now,
      type: "role-selection-assessed",
      status: roleSelection.ready ? "ready" : "blocked",
      requiredRoles: roleSelection.requiredRoles,
      blockedRequiredRoles: roleSelection.blockedRequiredRoles,
      fallbackRoles: roleSelection.dispatchPlan.fallbackRoles,
      activeProvidersByRole: roleSelection.activeProvidersByRole
    }
  ];

  if (commandResult.auditEvent.commandType !== "preview" || commandResult.idempotentReplay) {
    timeline.push({
      at: now,
      type: commandResult.idempotentReplay ? "command-replayed" : "command-applied",
      status: commandResult.status,
      commandId: commandResult.commandId,
      commandType: commandResult.auditEvent.commandType,
      problems: commandResult.problems
    });
  }

  timeline.push({
    at: historySnapshot.generatedAt,
    type: "analytics-snapshotted",
    status: historySnapshot.status,
    totalCandidates: historySnapshot.counters.totalCandidates,
    acceptedCandidates: historySnapshot.counters.acceptedCandidates,
    appliedReceiptCount: historySnapshot.commandRollup.appliedReceiptCount,
    roleSelectionReady: historySnapshot.roleCoverage.ready
  });

  return timeline;
}

function buildReportingState({ now, request, readiness, analyticsTrendReport, analyticsExportManifest, reportingTimeline }) {
  const latestEvent = reportingTimeline.at(-1) || null;
  const attentionFlags = analyticsTrendReport.reportFlags.filter((flag) =>
    [
      "blocked_candidate_increase",
      "accepted_candidate_drop",
      "health_state_changed",
      "role_readiness_changed",
      "required_role_blocked"
    ].includes(flag)
  );

  return {
    schema: "scheduler.model-policy.reporting-state.v1",
    generatedAt: now,
    taskId: request.taskId,
    state: attentionFlags.length
      ? "attention-required"
      : readiness.dispatchable
        ? "dispatch-report-ready"
        : "preview-report-ready",
    latestEventType: latestEvent?.type || null,
    latestEventAt: latestEvent?.at || null,
    trendState: analyticsTrendReport.state,
    exportReady: analyticsExportManifest.ready,
    exportRoute: analyticsExportManifest.route,
    attentionFlags,
    operatorVisible: request.clientState.visibleToUser,
    recommendedReportAction: attentionFlags.length
      ? "scheduler.modelPolicy.analytics.review"
      : analyticsExportManifest.ready
        ? "scheduler.modelPolicy.analytics.export"
        : "scheduler.modelPolicy.preview"
  };
}

function buildNextSteps({ validationSummary, selected, fallback, lifecycleState, tenantBoundaryGate }) {
  if (!tenantBoundaryGate.pass) {
    return [
      {
        id: "request-tenant-access",
        label: "Request tenant access",
        action: "scheduler.modelPolicy.requestTenantAccess",
        enabled: true,
        reason: tenantBoundaryGate.blockingReasons.join(", ")
      },
      {
        id: "preview-after-tenant-access",
        label: "Preview after tenant access",
        action: "scheduler.modelPolicy.preview",
        enabled: true,
        reason: "recompute hosted-kernel readiness after tenant boundary requirements are satisfied"
      }
    ];
  }

  if (lifecycleState.dispatchBlocked) {
    return [
      lifecycleState.nextAction,
      {
        id: "preview-after-lifecycle-change",
        label: "Preview after lifecycle change",
        action: "scheduler.modelPolicy.preview",
        enabled: !lifecycleState.validationErrors.length,
        reason: lifecycleState.validationErrors.length
          ? "settings validation must pass before preview can be accepted"
          : "recompute hosted-kernel readiness after lifecycle state changes"
      }
    ];
  }

  if (selected) {
    return [
      {
        id: "accept-preview",
        label: "Accept preview",
        action: "scheduler.modelPolicy.accept",
        enabled: true,
        reason: `${selected.id} satisfies the active model policy`
      },
      {
        id: "run-readiness-proof",
        label: "Run readiness proof",
        action: "scheduler.modelPolicy.proveReadiness",
        enabled: true,
        reason: "captures audit evidence before hosted-kernel dispatch"
      }
    ];
  }

  return [
    {
      id: "revise-policy",
      label: "Revise policy",
      action: "scheduler.modelPolicy.edit",
      enabled: true,
      reason: validationSummary.warnings.includes("fallback_required")
        ? "no candidate satisfies all constraints"
        : "policy cannot be accepted yet"
    },
    {
      id: "accept-fallback",
      label: "Accept fallback",
      action: "scheduler.modelPolicy.acceptFallback",
      enabled: Boolean(fallback),
      reason: fallback ? `${fallback.id} is the highest scoring fallback` : "no fallback candidate is available"
    }
  ];
}

function buildClientReadinessBadge({ readiness, validationSummary, externalHandoff, actionableErrors }) {
  const severity = actionableErrors.some((error) => error.severity === "error")
    ? "error"
    : validationSummary.warnings.length
      ? "warning"
      : readiness.dispatchable
        ? "success"
        : "info";
  const label = readiness.dispatchable
    ? "Ready for hosted-kernel dispatch"
    : readiness.lifecycle.dispatchBlocked
      ? "Lifecycle action required"
      : readiness.acceptanceRequired
        ? "Operator acceptance required"
        : "Preview blocked";

  return {
    schema: "scheduler.model-policy.readiness-badge.v1",
    severity,
    label,
    state: readiness.state,
    dispatchable: readiness.dispatchable,
    acceptanceRequired: readiness.acceptanceRequired,
    handoffState: externalHandoff.state,
    primaryReason: actionableErrors[0]?.code || readiness.lifecycle.reason || externalHandoff.state
  };
}

function buildValidationGroups({ validationSummary, actionableErrors, lifecycleState }) {
  const errorItems = [
    ...validationSummary.errors.map((code) => ({
      code,
      source: code.startsWith("workspace_") || code.startsWith("workspace_scope")
        ? "workspace-boundary"
        : code.startsWith("required_role") || code.startsWith("role_workspace_boundary")
          ? "role-selection"
        : code.startsWith("missing_permission") ||
            code.startsWith("tenant_") ||
            code.startsWith("cross_tenant") ||
            code.startsWith("cross_workspace")
          ? "tenant-boundary"
          : "lifecycle-settings",
      message:
        code.startsWith("workspace_") || code.startsWith("workspace_scope")
          ? "Workspace isolation requirements must be satisfied before provider dispatch."
          : code.startsWith("required_role") || code.startsWith("role_workspace_boundary")
            ? "Every required scheduler role must have an eligible provider/model assignment before dispatch."
          : code.startsWith("missing_permission") || code.startsWith("tenant_") || code.startsWith("cross_")
            ? "Tenant permissions must be corrected before this preview can be accepted."
            : "Lifecycle settings must be corrected before this preview can be accepted."
    })),
    ...actionableErrors
      .filter((error) => error.severity === "error")
      .map((error) => ({
        code: error.code,
        source: "hosted-kernel",
        message: error.message,
        action: error.action
      }))
  ];
  const warningItems = [
    ...validationSummary.warnings.map((code) => ({
      code,
      source: code.startsWith("hosted_kernel")
        ? "hosted-kernel"
        : code.startsWith("required_role")
          ? "role-selection"
        : code.startsWith("role_binding") || code.startsWith("tenant_boundary")
          ? "tenant-boundary"
          : "policy",
      message: code === "preview_label_missing" ? "A user-visible preview label was not supplied." : "Review this warning before accepting."
    })),
    ...actionableErrors
      .filter((error) => error.severity === "warning")
      .map((error) => ({
        code: error.code,
        source: "hosted-kernel",
        message: error.message,
        action: error.action
      }))
  ];

  return {
    schema: "scheduler.model-policy.validation-groups.v1",
    pass: errorItems.length === 0,
    lifecycleReason: lifecycleState.reason,
    errors: errorItems,
    warnings: warningItems,
    counts: {
      errors: errorItems.length,
      warnings: warningItems.length,
      acceptedCandidates: validationSummary.acceptedCount,
      rejectedCandidates: validationSummary.rejectedCount
    }
  };
}

function buildAcceptancePayload({
  command,
  acceptance,
  readiness,
  selected,
  fallback,
  policyFingerprint,
  externalHandoff,
  acceptanceTruth
}) {
  const modelId = acceptance.acceptedModelId || selected?.id || fallback?.id || null;
  const acceptEnabled =
    Boolean(modelId) &&
    readiness.dispatchable &&
    externalHandoff.state !== "blocked" &&
    (!acceptanceTruth.acceptRequested || acceptanceTruth.pass);
  return {
    schema: "scheduler.model-policy.acceptance-payload.v1",
    mode: acceptance.mode,
    currentDecision: acceptance.decision,
    acceptEnabled,
    acceptanceTruth,
    defaultCommand: {
      type: acceptEnabled ? "accept" : "preview",
      modelId,
      policyFingerprint,
      expectedHandoffState: externalHandoff.state,
      previousCommandId: command.id || null
    },
    proofRequirements: {
      requirePolicyFingerprint: true,
      requireIdempotencyKey: Boolean(externalHandoff.dispatchKey),
      requireProviderContract: externalHandoff.state !== "blocked",
      requiredScopes: externalHandoff.requiredScopes,
      eligibleModelIds: acceptanceTruth.eligibleModelIds,
      roleHandoffManifestId: externalHandoff.roleHandoffManifest?.manifestId || null,
      requiredRoles: externalHandoff.roleHandoffManifest?.requiredRoles || [],
      roleFallbacksRequireReview: Boolean(externalHandoff.roleHandoffManifest?.fallbackRoles?.length),
      currentPolicyFingerprint: policyFingerprint
    }
  };
}

function buildPreviewAcceptanceReadinessContract({
  now,
  request,
  preview,
  readiness,
  validationSummary,
  validationGroups,
  acceptance,
  acceptancePayload,
  externalHandoff,
  dispatchEnvelope,
  clientRuntimeGate,
  tenantBoundaryGate,
  acceptanceTruth,
  policyFingerprint
}) {
  const validationPass = validationGroups.pass && validationSummary.ready;
  const providerReady = externalHandoff.state !== "blocked" && Boolean(externalHandoff.modelId);
  const acceptanceReady = acceptancePayload.acceptEnabled && validationPass && clientRuntimeGate.pass && tenantBoundaryGate.pass;
  const dispatchReady = dispatchEnvelope.invocationReady && acceptance.decision === "accepted-command";
  const blockingReasons = [
    ...(validationPass ? [] : validationGroups.errors.map((item) => `validation:${item.code}`)),
    ...(providerReady ? [] : externalHandoff.blockedReasons.map((reason) => `provider:${reason}`)),
    ...(clientRuntimeGate.pass ? [] : clientRuntimeGate.blockingReasons.map((reason) => `client-runtime:${reason}`)),
    ...(tenantBoundaryGate.pass ? [] : tenantBoundaryGate.blockingReasons.map((reason) => `tenant-boundary:${reason}`)),
    ...(acceptanceReady ? [] : acceptance.requiresHumanReview ? ["acceptance:operator-review-required"] : [])
  ];
  const stage =
    dispatchReady
      ? "dispatch-ready"
      : acceptanceReady
        ? "acceptance-ready"
        : providerReady && validationPass
          ? "preview-ready"
          : "action-required";
  const primaryRoute =
    stage === "dispatch-ready"
      ? "scheduler.modelPolicy.dispatch"
      : stage === "acceptance-ready"
        ? "scheduler.modelPolicy.accept"
        : !tenantBoundaryGate.pass
          ? "scheduler.modelPolicy.requestTenantAccess"
          : !clientRuntimeGate.pass && externalHandoff.state !== "blocked"
            ? "scheduler.modelPolicy.configureClientRuntime"
            : "scheduler.modelPolicy.preview";

  return {
    schema: "scheduler.model-policy.preview-acceptance-readiness.v1",
    generatedAt: now,
    taskId: request.taskId,
    visibleToUser: request.clientState.visibleToUser,
    title: preview.title,
    summary: preview.summary,
    stage,
    state: readiness.dispatchable ? "dispatchable" : readiness.state,
    primaryRoute,
    primaryAction:
      stage === "dispatch-ready"
        ? "dispatch-hosted-kernel-model"
        : stage === "acceptance-ready"
          ? "accept-preview"
          : primaryRoute === "scheduler.modelPolicy.requestTenantAccess"
            ? "request-tenant-access"
            : primaryRoute === "scheduler.modelPolicy.configureClientRuntime"
              ? "configure-client-runtime"
              : "review-preview",
    model: {
      selectedModelId: readiness.selectedModelId,
      fallbackModelId: readiness.fallbackModelId,
      activeModelId: externalHandoff.modelId,
      provider: externalHandoff.provider,
      endpoint: externalHandoff.endpoint
    },
    gates: [
      {
        id: "validation",
        label: "Validation",
        pass: validationPass,
        route: "scheduler.modelPolicy.preview",
        errors: validationGroups.errors,
        warnings: validationGroups.warnings,
        counts: validationGroups.counts
      },
      {
        id: "provider-handoff",
        label: "Hosted-kernel handoff",
        pass: providerReady,
        route: externalHandoff.state === "blocked" ? "scheduler.modelPolicy.preview" : externalHandoff.handoffProtocol,
        state: externalHandoff.state,
        proofId: dispatchEnvelope.proofId,
        blockedReasons: providerReady ? [] : externalHandoff.blockedReasons
      },
      {
        id: "tenant-boundary",
        label: "Tenant boundary",
        pass: tenantBoundaryGate.pass,
        route: tenantBoundaryGate.pass ? tenantBoundaryGate.auditTenantRoute : "scheduler.modelPolicy.requestTenantAccess",
        proofId: tenantBoundaryGate.proofId,
        workspaceScopeProofId: tenantBoundaryGate.workspaceScopeContract.proofId,
        blockedReasons: tenantBoundaryGate.blockingReasons
      },
      {
        id: "client-runtime",
        label: "Client runtime",
        pass: clientRuntimeGate.pass,
        route: clientRuntimeGate.pass ? clientRuntimeGate.proofSinkRoute : "scheduler.modelPolicy.configureClientRuntime",
        state: clientRuntimeGate.state,
        requiredScopes: clientRuntimeGate.requiredScopes,
        missingScopes: clientRuntimeGate.missingScopes,
        blockedReasons: clientRuntimeGate.blockingReasons
      },
      {
        id: "acceptance",
        label: "Operator acceptance",
        pass: acceptanceReady || dispatchReady,
        route: "scheduler.modelPolicy.accept",
        decision: acceptance.decision,
        acceptEnabled: acceptancePayload.acceptEnabled,
        requiresHumanReview: acceptance.requiresHumanReview,
        defaultCommand: acceptancePayload.defaultCommand
      },
      {
        id: "dispatch-preflight",
        label: "Dispatch preflight",
        pass: dispatchReady,
        route: "scheduler.modelPolicy.dispatch",
        invocationReady: dispatchEnvelope.invocationReady,
        proofId: dispatchEnvelope.proofId,
        failures: dispatchEnvelope.preflight.failures
      }
    ],
    routePayloads: {
      preview: {
        taskId: request.taskId,
        policyFingerprint,
        correlationId: request.clientState.correlationId
      },
      accept: acceptanceReady
        ? {
            ...acceptancePayload.defaultCommand,
            dispatchKey: externalHandoff.dispatchKey,
            proofId: dispatchEnvelope.proofId,
            roleHandoffManifestId: externalHandoff.roleHandoffManifest?.manifestId || null,
            roleHandoffManifest: externalHandoff.roleHandoffManifest
          }
        : null,
      dispatch: dispatchReady
        ? {
            taskId: request.taskId,
            modelId: externalHandoff.modelId,
            dispatchKey: externalHandoff.dispatchKey,
            proofId: dispatchEnvelope.proofId,
            roleHandoffManifestId: externalHandoff.roleHandoffManifest?.manifestId || null,
            roleHandoffManifest: externalHandoff.roleHandoffManifest,
            providerInvocation: dispatchEnvelope.providerInvocation
          }
        : null
    },
    blockingReasons: [...new Set(blockingReasons)],
    proof: {
      policyFingerprint,
      dispatchProofId: dispatchEnvelope.proofId,
      tenantBoundaryProofId: tenantBoundaryGate.proofId,
      workspaceScopeProofId: tenantBoundaryGate.workspaceScopeContract.proofId,
      acceptanceTruthProofId: acceptanceTruth.proofId
    }
  };
}

function buildRoutePreviewContract({
  now,
  request,
  readiness,
  validationSummary,
  validationGroups,
  previewAcceptanceReadiness,
  acceptancePayload,
  externalHandoff,
  dispatchEnvelope,
  clientRuntimeGate,
  tenantBoundaryGate,
  acceptanceTruth
}) {
  const routeStates = previewAcceptanceReadiness.gates.map((gate) => ({
    id: gate.id,
    route: gate.route,
    pass: gate.pass,
    state: gate.state || (gate.pass ? "ready" : "blocked"),
    blockingCount:
      (Array.isArray(gate.blockedReasons) ? gate.blockedReasons.length : 0) +
      (Array.isArray(gate.errors) ? gate.errors.length : 0) +
      (Array.isArray(gate.failures) ? gate.failures.length : 0)
  }));
  const failedRoutes = routeStates.filter((route) => !route.pass);
  const acceptPayloadReady = Boolean(previewAcceptanceReadiness.routePayloads.accept);
  const dispatchPayloadReady = Boolean(previewAcceptanceReadiness.routePayloads.dispatch);
  const nextRoute =
    failedRoutes[0]?.route ||
    (dispatchPayloadReady
      ? "scheduler.modelPolicy.dispatch"
      : acceptPayloadReady
        ? "scheduler.modelPolicy.accept"
        : previewAcceptanceReadiness.primaryRoute);
  const nextStepId =
    failedRoutes[0]?.id ||
    (dispatchPayloadReady ? "dispatch-preflight" : acceptPayloadReady ? "acceptance" : "preview");

  return {
    schema: "scheduler.model-policy.route-preview-contract.v1",
    generatedAt: now,
    taskId: request.taskId,
    visibleToUser: request.clientState.visibleToUser,
    state: failedRoutes.length
      ? "route-action-required"
      : dispatchPayloadReady
        ? "dispatch-route-ready"
        : acceptPayloadReady
          ? "accept-route-ready"
          : "preview-route-ready",
    nextStep: {
      id: nextStepId,
      route: nextRoute,
      action: previewAcceptanceReadiness.primaryAction,
      reason: failedRoutes[0]?.state || previewAcceptanceReadiness.stage,
      enabled:
        nextRoute === "scheduler.modelPolicy.accept"
          ? acceptPayloadReady
          : nextRoute === "scheduler.modelPolicy.dispatch"
            ? dispatchPayloadReady
            : true
    },
    readiness: {
      state: readiness.state,
      dispatchable: readiness.dispatchable,
      acceptanceRequired: readiness.acceptanceRequired,
      selectedModelId: readiness.selectedModelId,
      fallbackModelId: readiness.fallbackModelId,
      handoffState: externalHandoff.state,
      invocationReady: dispatchEnvelope.invocationReady
    },
    validation: {
      pass: validationGroups.pass && validationSummary.ready,
      ready: validationSummary.ready,
      errorCount: validationGroups.counts.errors,
      warningCount: validationGroups.counts.warnings,
      acceptedCandidateCount: validationSummary.acceptedCount,
      rejectedCandidateCount: validationSummary.rejectedCount,
      errors: validationGroups.errors.map((item) => item.code),
      warnings: validationGroups.warnings.map((item) => item.code)
    },
    acceptance: {
      acceptEnabled: acceptancePayload.acceptEnabled,
      defaultCommand: acceptancePayload.defaultCommand,
      commandRequirements: acceptancePayload.proofRequirements,
      truthState: acceptanceTruth.state,
      truthPass: acceptanceTruth.pass,
      proofId: acceptanceTruth.proofId,
      blockingReasons: acceptanceTruth.blockingReasons
    },
    gates: {
      routeStates,
      failedRouteIds: failedRoutes.map((route) => route.id),
      clientRuntime: {
        pass: clientRuntimeGate.pass,
        state: clientRuntimeGate.state,
        missingScopes: clientRuntimeGate.missingScopes,
        proofSinkRoute: clientRuntimeGate.proofSinkRoute
      },
      tenantBoundary: {
        pass: tenantBoundaryGate.pass,
        state: tenantBoundaryGate.state,
        missingPermissions: tenantBoundaryGate.missingPermissions,
        proofId: tenantBoundaryGate.proofId,
        workspaceScopeProofId: tenantBoundaryGate.workspaceScopeContract.proofId
      }
    },
    routePayloads: previewAcceptanceReadiness.routePayloads
  };
}

function buildWorkflowHandoff({
  now,
  request,
  readiness,
  validationGroups,
  lifecycleState,
  externalHandoff,
  acceptancePayload,
  dispatchEnvelope,
  clientRuntimeGate,
  tenantBoundaryGate,
  acceptanceTruth
}) {
  const clientState = request.clientState;
  const blockedByValidation = validationGroups.errors.length > 0;
  const blockedByLifecycle = lifecycleState.dispatchBlocked;
  const blockedByClientRuntime = !clientRuntimeGate.pass && externalHandoff.state !== "blocked";
  const blockedByTenantBoundary = !tenantBoundaryGate.pass;
  const needsOperator = readiness.acceptanceRequired && !acceptancePayload.acceptEnabled;
  const workflowState = blockedByValidation
    ? "blocked-validation"
    : blockedByTenantBoundary
      ? "blocked-tenant-boundary"
    : blockedByClientRuntime
      ? "blocked-client-runtime"
      : externalHandoff.state === "blocked"
      ? "blocked-provider-handoff"
      : externalHandoff.state === "awaiting-operator-acceptance" || needsOperator
        ? "awaiting-operator-acceptance"
        : externalHandoff.state === "ready-for-provider"
          ? "ready-for-dispatch"
          : "preview-ready";
  const ownerRoute =
    workflowState === "ready-for-dispatch"
      ? "scheduler.modelPolicy.dispatch"
      : workflowState === "awaiting-operator-acceptance"
        ? "scheduler.modelPolicy.accept"
        : workflowState === "blocked-validation"
          ? "scheduler.modelPolicy.edit"
          : workflowState === "blocked-tenant-boundary"
            ? "scheduler.modelPolicy.requestTenantAccess"
          : workflowState === "blocked-client-runtime"
            ? "scheduler.modelPolicy.configureClientRuntime"
            : "scheduler.modelPolicy.preview";
  const primaryAction =
    workflowState === "ready-for-dispatch"
      ? "dispatch-hosted-kernel-model"
      : workflowState === "awaiting-operator-acceptance"
        ? "accept-preview"
        : workflowState === "blocked-validation"
          ? "resolve-validation"
          : workflowState === "blocked-tenant-boundary"
            ? "request-tenant-access"
          : workflowState === "blocked-client-runtime"
            ? "resolve-client-runtime"
            : "review-preview";
  const stateToken = stableStringify({
    taskId: request.taskId,
    workspaceId: clientState.workspaceId,
    route: ownerRoute,
    modelId: externalHandoff.modelId,
    handoffState: externalHandoff.state,
    policyFingerprint: acceptancePayload.defaultCommand.policyFingerprint,
    roleHandoffManifestId: externalHandoff.roleHandoffManifest?.manifestId || null
  });

  return {
    schema: "scheduler.model-policy.workflow-handoff.v1",
    generatedAt: now,
    state: workflowState,
    stateToken,
    acceptanceTruth: {
      state: acceptanceTruth.state,
      pass: acceptanceTruth.pass,
      proofId: acceptanceTruth.proofId,
      commandModelId: acceptanceTruth.commandModelId,
      eligibleModelIds: acceptanceTruth.eligibleModelIds,
      blockingReasons: acceptanceTruth.blockingReasons
    },
    origin: {
      sourceSurface: clientState.sourceSurface,
      currentRoute: clientState.currentRoute,
      returnRoute: clientState.returnRoute,
      sessionId: clientState.sessionId,
      workspaceId: clientState.workspaceId,
      tenantId: clientState.tenantBoundary.tenantId,
      requestedTenantId: clientState.tenantBoundary.requestedTenantId,
      requestedWorkspaceId: clientState.tenantBoundary.requestedWorkspaceId,
      correlationId: clientState.correlationId,
      pendingActionId: clientState.pendingActionId,
      urgency: clientState.urgency,
      visibleToUser: clientState.visibleToUser
    },
    destination: {
      ownerSurface: "scheduler.model-policy",
      route: ownerRoute,
      mode: clientState.handoffMode,
      primaryAction,
      label:
        workflowState === "ready-for-dispatch"
          ? "Dispatch hosted-kernel model"
          : workflowState === "awaiting-operator-acceptance"
          ? "Accept hosted-kernel preview"
          : workflowState === "blocked-validation"
            ? "Resolve model-policy validation"
            : workflowState === "blocked-tenant-boundary"
              ? "Request tenant access"
            : workflowState === "blocked-client-runtime"
              ? "Resolve client handoff requirements"
              : "Review hosted-kernel preview"
    },
    dispatchEnvelope: {
      modelId: externalHandoff.modelId,
      provider: externalHandoff.provider,
      endpoint: externalHandoff.endpoint,
      handoffProtocol: externalHandoff.handoffProtocol,
      syncMode: externalHandoff.syncMode,
      ackMode: externalHandoff.ackMode,
      callbackRoute: externalHandoff.callbackRoute,
      authMode: externalHandoff.authMode,
      syncMetadata: externalHandoff.syncMetadata,
      providerHandshake: externalHandoff.providerHandshake,
      roleContract: externalHandoff.roleContract,
      roleHandoffManifest: externalHandoff.roleHandoffManifest,
      providerRoleContracts: externalHandoff.providerRoleContracts,
      blockedRoleContractRoles: externalHandoff.blockedRoleContractRoles,
      dispatchKey: externalHandoff.dispatchKey,
      idempotencyHeader: externalHandoff.idempotencyHeader,
      requiredScopes: externalHandoff.requiredScopes,
      proofRequired: externalHandoff.proofRequired,
      blockedReasons: externalHandoff.blockedReasons,
      invocationReady: dispatchEnvelope.invocationReady,
      proofId: dispatchEnvelope.proofId,
      preflight: dispatchEnvelope.preflight,
      providerInvocation: dispatchEnvelope.providerInvocation
    },
    clientRuntimeGate,
    tenantBoundaryGate,
    commands: [
      {
        id: "preview",
        action: "scheduler.modelPolicy.preview",
        enabled: true,
        route: "scheduler.modelPolicy.preview"
      },
      {
        id: "accept",
        action: "scheduler.modelPolicy.accept",
        enabled: !blockedByValidation && !blockedByClientRuntime && !blockedByTenantBoundary && externalHandoff.state !== "blocked",
        route: "scheduler.modelPolicy.accept",
        payload: acceptancePayload.defaultCommand
      },
      {
        id: "request-tenant-access",
        action: "scheduler.modelPolicy.requestTenantAccess",
        enabled: blockedByTenantBoundary,
        route: "scheduler.modelPolicy.requestTenantAccess",
        payload: {
          tenantId: tenantBoundaryGate.tenantId,
          requestedTenantId: tenantBoundaryGate.requestedTenantId,
          workspaceId: tenantBoundaryGate.requestedWorkspaceId,
          requiredPermissions: tenantBoundaryGate.requiredPermissions,
          missingPermissions: tenantBoundaryGate.missingPermissions,
          blockingReasons: tenantBoundaryGate.blockingReasons,
          permissionProofs: tenantBoundaryGate.permissionProofs,
          roleBindingProofs: tenantBoundaryGate.roleBindingProofs,
          roleBindingWarnings: tenantBoundaryGate.roleBindingWarnings,
          workspacePolicy: tenantBoundaryGate.workspacePolicy,
          requestedResources: tenantBoundaryGate.requestedResources,
          resourceGrants: tenantBoundaryGate.resourceGrants,
          workspaceScopeContract: tenantBoundaryGate.workspaceScopeContract,
          auditTenantRoute: tenantBoundaryGate.auditTenantRoute,
          auditHandoff: tenantBoundaryGate.auditHandoff,
          proofId: tenantBoundaryGate.proofId
        }
      },
      {
        id: "configure-client-runtime",
        action: "scheduler.modelPolicy.configureClientRuntime",
        enabled: blockedByClientRuntime,
        route: "scheduler.modelPolicy.configureClientRuntime",
        payload: {
          taskId: request.taskId,
          blockingReasons: clientRuntimeGate.blockingReasons,
          missingScopes: clientRuntimeGate.missingScopes,
          requiredProtocol: clientRuntimeGate.requiredProtocol,
          proofSinkRoute: clientRuntimeGate.proofSinkRoute
        }
      },
      {
        id: "configure-lifecycle",
        action: lifecycleState.nextAction.action,
        enabled: blockedByLifecycle,
        route: "scheduler.modelPolicy.configureLifecycle",
        payload: {
          taskId: request.taskId,
          reason: lifecycleState.reason,
          validationErrors: lifecycleState.validationErrors,
          validationWarnings: lifecycleState.validationWarnings,
          currentSettings: {
            enabled: lifecycleState.enabled,
            pauseActive: lifecycleState.pauseActive,
            pausedUntil: lifecycleState.pausedUntil,
            scheduleEnabled: lifecycleState.scheduleEnabled,
            scheduleWindow: lifecycleState.scheduleWindow,
            activeDispatches: lifecycleState.activeDispatches,
            maxConcurrentDispatches: lifecycleState.maxConcurrentDispatches
          },
          commandEffect: lifecycleState.lifecycleCommandEffect,
          scheduleCommandValidation: lifecycleState.scheduleCommandValidation,
          suggestedCommands: [
            {
              type: lifecycleState.reason === "policy_disabled" ? "enable" : "resume",
              enabled: ["policy_disabled", "policy_paused"].includes(lifecycleState.reason)
            },
            {
              type: "set-schedule",
              enabled: ["outside_dispatch_window", "settings_invalid"].includes(lifecycleState.reason),
              schedule: {
                enabled: true,
                window: lifecycleState.scheduleWindow,
                allowManualOverride: true
              }
            }
          ]
        }
      },
      {
        id: "dispatch",
        action: "scheduler.modelPolicy.dispatch",
        enabled: workflowState === "ready-for-dispatch" && clientRuntimeGate.pass && tenantBoundaryGate.pass,
        route: "scheduler.modelPolicy.dispatch",
        payload: {
          taskId: request.taskId,
          modelId: externalHandoff.modelId,
          dispatchKey: externalHandoff.dispatchKey,
          requiredScopes: externalHandoff.requiredScopes,
          proofId: dispatchEnvelope.proofId,
          workspaceScopeProofId: tenantBoundaryGate.workspaceScopeContract.proofId,
          workspaceProviderClaims: tenantBoundaryGate.workspaceScopeContract.providerClaims,
          providerHandshake: externalHandoff.providerHandshake,
          roleContract: externalHandoff.roleContract,
          roleHandoffManifestId: externalHandoff.roleHandoffManifest?.manifestId || null,
          roleHandoffManifest: externalHandoff.roleHandoffManifest,
          syncMetadata: externalHandoff.syncMetadata,
          providerInvocation: dispatchEnvelope.providerInvocation
        }
      }
    ]
  };
}

function buildExplainableNextStepContract({
  acceptance,
  readiness,
  validationGroups,
  lifecycleState,
  externalHandoff,
  clientRuntimeGate,
  tenantBoundaryGate,
  acceptanceTruth
}) {
  return {
    schema: "scheduler.model-policy.next-step-contract.v1",
    generatedForState: readiness.dispatchable ? "dispatchable" : readiness.state,
    primaryActionId:
      tenantBoundaryGate.pass === false
        ? "request-tenant-access"
        : clientRuntimeGate.pass === false && externalHandoff.state !== "blocked"
          ? "configure-client-runtime"
          : acceptance.controls.find((control) => control.enabled)?.id || null,
    acceptanceTruth: {
      pass: acceptanceTruth.pass,
      state: acceptanceTruth.state,
      proofId: acceptanceTruth.proofId,
      blockingReasons: acceptanceTruth.blockingReasons
    },
    controls: [
      ...acceptance.controls.map((control) => ({
        ...control,
        requiresValidationPass: control.action === "scheduler.modelPolicy.accept",
        requiresHandoffReady: ["scheduler.modelPolicy.accept", "scheduler.modelPolicy.dispatch"].includes(control.action),
        blockedBy: control.enabled
          ? [
              ...(!clientRuntimeGate.pass && control.action === "scheduler.modelPolicy.accept"
                ? ["client_runtime_handoff_blocked"]
                : []),
              ...(!tenantBoundaryGate.pass && control.action === "scheduler.modelPolicy.accept"
                ? ["tenant_boundary_blocked"]
                : [])
            ]
          : [
              ...(validationGroups.pass ? [] : ["validation_errors"]),
              ...(externalHandoff.state === "blocked" ? ["provider_handoff_blocked"] : []),
              ...(!clientRuntimeGate.pass && externalHandoff.state !== "blocked" ? ["client_runtime_handoff_blocked"] : []),
              ...(!tenantBoundaryGate.pass ? ["tenant_boundary_blocked"] : [])
            ]
      })),
      {
        id: "configure-lifecycle",
        label: lifecycleState.nextAction.id === "dispatch-model-policy" ? "Lifecycle settings ready" : "Configure lifecycle",
        action: lifecycleState.nextAction.action,
        enabled: lifecycleState.dispatchBlocked,
        reason: lifecycleState.dispatchBlocked
          ? lifecycleState.reason
          : "lifecycle settings permit hosted-kernel dispatch",
        blockedBy: lifecycleState.dispatchBlocked ? lifecycleState.validationErrors : []
      },
      {
        id: "request-tenant-access",
        label: "Request tenant access",
        action: "scheduler.modelPolicy.requestTenantAccess",
        enabled: !tenantBoundaryGate.pass,
        reason: tenantBoundaryGate.pass
          ? "tenant boundary permits this handoff"
          : tenantBoundaryGate.blockingReasons.join(", ")
      },
      {
        id: "configure-client-runtime",
        label: "Resolve client handoff requirements",
        action: "scheduler.modelPolicy.configureClientRuntime",
        enabled: !clientRuntimeGate.pass && externalHandoff.state !== "blocked",
        reason: clientRuntimeGate.pass
          ? "client runtime can receive the hosted-kernel handoff"
          : clientRuntimeGate.blockingReasons.join(", ")
      }
    ],
    routeHints: {
      previewRoute: "scheduler.modelPolicy.preview",
      acceptRoute: "scheduler.modelPolicy.accept",
      proofRoute: "scheduler.modelPolicy.proveReadiness",
      lifecycleRoute: "scheduler.modelPolicy.configureLifecycle",
      handoffRoute: externalHandoff.handoffProtocol,
      clientRuntimeRoute: "scheduler.modelPolicy.configureClientRuntime",
      tenantAccessRoute: "scheduler.modelPolicy.requestTenantAccess",
      proofSinkRoute: clientRuntimeGate.proofSinkRoute,
      auditTenantRoute: tenantBoundaryGate.auditTenantRoute,
      tenantAuditHandoffRoute: tenantBoundaryGate.auditHandoff.route
    }
  };
}

function buildClientInteractionContract({
  now,
  request,
  command,
  preview,
  readiness,
  validationSummary,
  acceptance,
  selected,
  fallback,
  policyFingerprint,
  externalHandoff,
  dispatchEnvelope,
  actionableErrors,
  lifecycleState,
  clientRuntimeGate,
  tenantBoundaryGate,
  acceptanceTruth
}) {
  const readinessBadge = buildClientReadinessBadge({ readiness, validationSummary, externalHandoff, actionableErrors });
  const validationGroups = buildValidationGroups({ validationSummary, actionableErrors, lifecycleState });
  const acceptancePayload = buildAcceptancePayload({
    command,
    acceptance,
    readiness,
    selected,
    fallback,
    policyFingerprint,
    externalHandoff,
    acceptanceTruth
  });
  const previewAcceptanceReadiness = buildPreviewAcceptanceReadinessContract({
    now,
    request,
    preview,
    readiness,
    validationSummary,
    validationGroups,
    acceptance,
    acceptancePayload,
    externalHandoff,
    dispatchEnvelope,
    clientRuntimeGate,
    tenantBoundaryGate,
    acceptanceTruth,
    policyFingerprint
  });
  const workflowHandoff = buildWorkflowHandoff({
    now,
    request,
    readiness,
    validationGroups,
    lifecycleState,
    externalHandoff,
    acceptancePayload,
    dispatchEnvelope,
    clientRuntimeGate,
    tenantBoundaryGate,
    acceptanceTruth
  });
  const nextSteps = buildExplainableNextStepContract({
    acceptance,
    readiness,
    validationGroups,
    lifecycleState,
    externalHandoff,
    clientRuntimeGate,
    tenantBoundaryGate,
    acceptanceTruth
  });
  const routePreviewContract = buildRoutePreviewContract({
    now,
    request,
    readiness,
    validationSummary,
    validationGroups,
    previewAcceptanceReadiness,
    acceptancePayload,
    externalHandoff,
    dispatchEnvelope,
    clientRuntimeGate,
    tenantBoundaryGate,
    acceptanceTruth
  });

  return {
    schema: "scheduler.model-policy.client-interaction.v1",
    previewTitle: preview.title,
    previewSummary: preview.summary,
    selectedModelId: readiness.selectedModelId,
    fallbackModelId: readiness.fallbackModelId,
    readinessBadge,
    validationGroups,
    acceptancePayload,
    previewAcceptanceReadiness,
    routePreviewContract,
    workflowHandoff,
    nextSteps,
    acceptanceTruth,
    clientRuntimeGate,
    tenantBoundaryGate,
    dispatchEnvelope
  };
}

function resolveRestartStatus({ readiness, persistedState, policyFingerprint }) {
  const currentStatus = readiness.dispatchable ? "dispatchable" : readiness.state;
  const previousStatus =
    persistedState.policyFingerprint === policyFingerprint && STATUS_RANK.has(persistedState.status)
      ? persistedState.status
      : "unknown";
  const currentRank = STATUS_RANK.get(currentStatus) ?? 0;
  const previousRank = STATUS_RANK.get(previousStatus) ?? 0;

  if (previousRank > currentRank && persistedState.lastDecision?.type === "accept") {
    return {
      status: previousStatus,
      source: "persisted-accepted-decision",
      recoveredModelId: persistedState.lastDecision.modelId || persistedState.selectedModelId,
      reason: "matching persisted acceptance outranks the recomputed preview"
    };
  }

  return {
    status: currentStatus,
    source: "recomputed-preview",
    recoveredModelId: null,
    reason:
      previousStatus === "unknown"
        ? "no matching persisted policy decision"
        : "recomputed preview is at least as ready as persisted state"
  };
}

function buildCurrentRoleRecoveryCheckpoint(roleSelection) {
  return normalizePersistedRoleCheckpoint({
    ready: roleSelection.ready,
    requiredRoles: roleSelection.requiredRoles,
    blockedRequiredRoles: roleSelection.blockedRequiredRoles,
    activeModelsByRole: roleSelection.activeModelsByRole,
    activeProvidersByRole: roleSelection.activeProvidersByRole,
    dispatchPlan: {
      fallbackRoles: roleSelection.dispatchPlan.fallbackRoles
    },
    assignments: roleSelection.assignments
  });
}

function buildRoleRecoveryContract({ persistedCheckpoint, currentCheckpoint, policyFingerprint }) {
  const persistedRoles = new Set(persistedCheckpoint.requiredRoles);
  const currentRoles = new Set(currentCheckpoint.requiredRoles);
  const missingRoles = persistedCheckpoint.requiredRoles.filter((role) => !currentRoles.has(role));
  const addedRoles = currentCheckpoint.requiredRoles.filter((role) => !persistedRoles.has(role));
  const modelDrift = currentCheckpoint.requiredRoles
    .filter((role) => persistedCheckpoint.activeModelsByRole[role] !== currentCheckpoint.activeModelsByRole[role])
    .map((role) => ({
      role,
      persistedModelId: persistedCheckpoint.activeModelsByRole[role] || null,
      currentModelId: currentCheckpoint.activeModelsByRole[role] || null
    }));
  const providerDrift = currentCheckpoint.requiredRoles
    .filter((role) => persistedCheckpoint.activeProvidersByRole[role] !== currentCheckpoint.activeProvidersByRole[role])
    .map((role) => ({
      role,
      persistedProvider: persistedCheckpoint.activeProvidersByRole[role] || null,
      currentProvider: currentCheckpoint.activeProvidersByRole[role] || null
    }));
  const fallbackChanged =
    stableStringify(persistedCheckpoint.fallbackRoles) !== stableStringify(currentCheckpoint.fallbackRoles);
  const checkpointMatches =
    persistedCheckpoint.present &&
    persistedCheckpoint.ready &&
    currentCheckpoint.ready &&
    !missingRoles.length &&
    !addedRoles.length &&
    !modelDrift.length &&
    !providerDrift.length &&
    !fallbackChanged;
  const state = !persistedCheckpoint.present
    ? "role-checkpoint-missing"
    : !persistedCheckpoint.ready
      ? "persisted-role-checkpoint-blocked"
      : !currentCheckpoint.ready
        ? "current-role-selection-blocked"
        : checkpointMatches
          ? "role-checkpoint-restored"
          : "role-checkpoint-drifted";

  return {
    schema: "scheduler.model-policy.role-recovery.v1",
    policyFingerprint,
    state,
    restartCompatible: checkpointMatches,
    persistedCheckpointId: persistedCheckpoint.checkpointId,
    currentCheckpointId: currentCheckpoint.checkpointId,
    persistedReady: persistedCheckpoint.ready,
    currentReady: currentCheckpoint.ready,
    missingRoles,
    addedRoles,
    modelDrift,
    providerDrift,
    fallbackChanged,
    statusSemantics: checkpointMatches
      ? "persisted role assignments match the recomputed planner, compact worker, verifier, and reviewer bindings"
      : "restart recovery must use recomputed role assignments before preserving dispatch readiness",
    persistedCheckpoint,
    currentCheckpoint
  };
}

function buildRecoveryContract({
  now,
  request,
  persistedState,
  policyFingerprint,
  recovered,
  commandResult,
  persistedStatus,
  roleSelection,
  readiness
}) {
  const matchingReceipts = persistedState.commandReceipts.filter(
    (receipt) => receipt.policyFingerprint === policyFingerprint
  );
  const activeCommandReceipt = commandResult.commandReceipt || null;
  const roleRecovery = buildRoleRecoveryContract({
    persistedCheckpoint: persistedState.roleCheckpoint,
    currentCheckpoint: buildCurrentRoleRecoveryCheckpoint(roleSelection),
    policyFingerprint
  });
  const acceptedReceipt = matchingReceipts
    .filter((receipt) => receipt.accepted && receipt.status === "dispatchable")
    .at(-1) || null;
  const commandKnown = Boolean(activeCommandReceipt || matchingReceipts.some((receipt) => receipt.commandId === commandResult.commandId));
  const recomputedStatus = readiness.dispatchable ? "dispatchable" : readiness.state;
  const statusAfterRecovery =
    roleRecovery.restartCompatible || recovered.source !== "persisted-accepted-decision"
      ? persistedStatus
      : recomputedStatus;
  const state = persistedState.recoveryIssues.length
    ? "recovered-with-warnings"
    : roleRecovery.state === "role-checkpoint-drifted"
      ? "recomputed-role-selection-after-restart"
    : commandResult.idempotentReplay && activeCommandReceipt
      ? "idempotent-replay-confirmed"
    : acceptedReceipt && recovered.source === "persisted-accepted-decision"
      && roleRecovery.restartCompatible
        ? "accepted-decision-restored"
        : recovered.source === "recomputed-preview"
          ? "recomputed-from-current-input"
          : "recovery-blocked";
  const statusSemantics =
    roleRecovery.state === "role-checkpoint-drifted"
      ? "role assignment drift forces recomputed readiness even when command receipts match"
      : recovered.source === "persisted-accepted-decision"
        ? "matching accepted receipt may preserve a higher readiness status after restart"
      : commandResult.idempotentReplay
        ? "duplicate command returns the persisted command receipt without reapplying side effects"
        : "current input was recomputed and may replace stale persisted readiness";
  const receiptSummaries = matchingReceipts.slice(-6).map((receipt) => ({
    commandId: receipt.commandId,
    type: receipt.type,
    status: receipt.status,
    modelId: receipt.modelId,
    applied: receipt.applied,
    accepted: receipt.accepted,
    lifecycleChanged: receipt.lifecycleChanged,
    decidedAt: receipt.decidedAt,
    recoveryProofId: receipt.recoveryProofId
  }));

  return {
    schema: "scheduler.model-policy.restart-recovery.v1",
    generatedAt: now,
    taskId: request.taskId,
    policyFingerprint,
    persistedStatus,
    statusAfterRecovery,
    restartSafe:
      persistedState.policyFingerprint === policyFingerprint &&
      !persistedState.recoveryIssues.length &&
      roleRecovery.restartCompatible,
    recovered: persistedState.recovered,
    state,
    statusSource: recovered.source,
    statusSemantics,
    roleRecovery,
    recoveredModelId: recovered.recoveredModelId,
    reason: recovered.reason,
    issues: persistedState.recoveryIssues,
    idempotency: {
      commandId: commandResult.commandId,
      replay: commandResult.idempotentReplay,
      commandKnown,
      receiptProofId: activeCommandReceipt?.recoveryProofId || null,
      appliedThisRun: commandResult.applied
    },
    restoredAcceptedDecision: acceptedReceipt
      ? {
          commandId: acceptedReceipt.commandId,
          modelId: acceptedReceipt.modelId,
          decidedAt: acceptedReceipt.decidedAt,
          recoveryProofId: acceptedReceipt.recoveryProofId
        }
      : null,
    receiptCount: persistedState.commandReceipts.length,
    matchingReceiptCount: matchingReceipts.length,
    receiptSummaries,
    proofId: stableStringify({
      taskId: request.taskId,
      policyFingerprint,
      persistedStatus,
      recoveredSource: recovered.source,
      commandId: commandResult.commandId,
      commandReceiptProofId: activeCommandReceipt?.recoveryProofId || null,
      acceptedReceiptProofId: acceptedReceipt?.recoveryProofId || null,
      roleRecoveryState: roleRecovery.state,
      statusAfterRecovery,
      issues: persistedState.recoveryIssues
    })
  };
}

function applyPolicyCommand({
  command,
  selected,
  fallback,
  readiness,
  persistedState,
  policyFingerprint,
  acceptanceTruth,
  now,
  operationalHealth,
  lifecycleSettings,
  lifecycleState,
  lifecycleCommandEffect
}) {
  const commandId =
    command.id ||
    stableStringify({
      type: command.type,
      modelId: command.modelId,
      commandPolicyFingerprint: command.policyFingerprint,
      dispatchKey: command.dispatchKey,
      reason: command.reason,
      pauseUntil: command.pauseUntil,
      schedule: command.schedule,
      policyFingerprint
    });
  const idempotentReplay = persistedState.appliedCommandIds.includes(commandId);
  const replayReceipt = idempotentReplay
    ? persistedState.commandReceipts.find((receipt) => receipt.commandId === commandId) || null
    : null;
  const replayDecision =
    replayReceipt?.decision ||
    (idempotentReplay && persistedState.lastDecision?.commandId === commandId ? persistedState.lastDecision : null);
  const acceptRequested = command.type === "accept";
  const targetModelId = acceptRequested ? command.modelId : command.modelId || selected?.id || fallback?.id || null;
  const targetCandidate = [selected, fallback].filter(Boolean).find((candidate) => candidate.id === targetModelId) || null;
  const clearsLifecycleValidation = command.type === "enable" || command.type === "resume";
  const problems = replayReceipt ? [...replayReceipt.problems] : clearsLifecycleValidation ? [] : [...lifecycleState.validationErrors];
  let nextLifecycleSettings = replayReceipt?.lifecycleSettings || lifecycleSettings;
  let scheduleCommandResult =
    lifecycleCommandEffect?.scheduleCommandResult ||
    (command.type === "set-schedule" ? applyLifecycleScheduleCommand(lifecycleSettings, command.schedule) : null);

  if (!replayDecision) {
    if (acceptRequested && acceptanceTruth && !acceptanceTruth.pass) {
      problems.push(...acceptanceTruth.blockingReasons);
    }
    if (acceptRequested && !targetCandidate && !problems.includes("acceptance_model_not_in_current_preview")) {
      problems.push("accepted_model_not_available");
    }
    if (acceptRequested && targetCandidate && !readiness.dispatchable) {
      problems.push("readiness_not_dispatchable");
    }
    if (acceptRequested && targetCandidate && !targetCandidate.accepted && !readiness.dispatchable) {
      problems.push("accepted_model_not_dispatchable");
    }
    if (acceptRequested && targetCandidate && operationalHealth.blockedModels.includes(targetCandidate.id)) {
      problems.push("hosted_kernel_health_blocking_dispatch");
    }
    if (acceptRequested && lifecycleState.dispatchBlocked) problems.push(lifecycleState.reason);
    if (command.type === "hold" && !command.reason) problems.push("hold_reason_required");
    if (command.type === "disable" && !command.reason) problems.push("disable_reason_required");
    if (command.type === "set-schedule" && scheduleCommandResult && !scheduleCommandResult.validation.valid) {
      problems.push(...scheduleCommandResult.validation.problems);
    }
    if (command.type === "pause" && !command.reason) problems.push("pause_reason_required");
    if (command.type === "pause" && command.pauseUntil && !Number.isFinite(Date.parse(command.pauseUntil))) {
      problems.push("invalid_pause_until");
    }
    if (lifecycleCommandEffect?.mutationRequested && !lifecycleCommandEffect.valid) {
      problems.push(...lifecycleCommandEffect.problems);
    }
    if (!LIFECYCLE_COMMAND_TYPES.has(command.type)) problems.push("unsupported_command_type");

    if (!problems.length) {
      if (lifecycleCommandEffect?.mutationRequested) {
        nextLifecycleSettings = lifecycleCommandEffect.settings;
      }
    }
  }

  const accepted = replayDecision ? replayDecision.type === "accept" : command.type === "accept" && problems.length === 0;
  const held = command.type === "hold" && problems.length === 0;
  const rejected = command.type === "reject" && problems.length === 0;
  const lifecycleChanged =
    replayReceipt?.lifecycleChanged === true ||
    (!replayDecision && ["enable", "disable", "pause", "resume", "set-schedule"].includes(command.type) && problems.length === 0);
  const status =
    replayReceipt?.status ||
    replayDecision?.status ||
    (accepted ? "dispatchable" : held ? "needs-operator-acceptance" : rejected ? "blocked" : readiness.state);
  const decision =
    replayDecision || {
      commandId,
      type: command.type,
      modelId: accepted ? targetModelId : null,
      status,
      policyFingerprint,
      decidedAt: now
    };
  const applied = !idempotentReplay && problems.length === 0 && command.type !== "preview";
  const commandReceipt = applied
    ? {
        schema: "scheduler.model-policy.command-receipt.v1",
        commandId,
        type: command.type,
        status,
        modelId: decision.modelId,
        policyFingerprint,
        decidedAt: decision.decidedAt,
        applied,
        accepted,
        lifecycleChanged,
        problems: [...new Set(problems)],
        lifecycleSettings: lifecycleChanged ? nextLifecycleSettings : null,
        decision,
        persistedAt: now,
        recoveryProofId: stableStringify({
          commandId,
          type: command.type,
          status,
          modelId: decision.modelId,
          policyFingerprint,
          lifecycleChanged,
          lifecycleSettings: lifecycleChanged ? nextLifecycleSettings : null
        })
      }
    : replayReceipt;

  return {
    commandId,
    idempotentReplay,
    applied,
    accepted,
    lifecycleChanged,
    lifecycleSettings: nextLifecycleSettings,
    status,
    problems: [...new Set(problems)],
    decision,
    commandReceipt,
    auditEvent: {
      proofType: "scheduler.model-policy.command.v1",
      generatedAt: now,
      commandId,
      commandType: command.type,
      idempotentReplay,
      replaySource: replayReceipt ? "persisted-command-receipt" : replayDecision ? "persisted-last-decision" : null,
      appliedStatus: status,
      replayedDecisionAt: replayDecision?.decidedAt || null,
      receiptProofId: commandReceipt?.recoveryProofId || null,
      operationalHealthState: operationalHealth.state,
      lifecycleState: {
        dispatchBlocked: lifecycleState.dispatchBlocked,
        reason: lifecycleState.reason,
        changed: lifecycleChanged,
        commandEffect: lifecycleCommandEffect,
        scheduleCommand: scheduleCommandResult
          ? {
              applied: lifecycleChanged && scheduleCommandResult.applied,
              validation: scheduleCommandResult.validation,
              nextSchedule: scheduleCommandResult.applied ? scheduleCommandResult.settings.schedule : lifecycleSettings.schedule
            }
          : null
      },
      problems: [...new Set(problems)]
    }
  };
}

export function describeModelPolicySurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const policy = normalizePolicy(input.policy);
  const request = {
    taskId: typeof input.taskId === "string" && input.taskId.trim() ? input.taskId.trim() : null,
    userVisibleLabel:
      typeof input.userVisibleLabel === "string" && input.userVisibleLabel.trim()
        ? input.userVisibleLabel.trim()
        : null,
    requestedBy: typeof input.requestedBy === "string" && input.requestedBy.trim() ? input.requestedBy.trim() : "system",
    clientState: normalizeClientState(input.clientState, now)
  };
  const catalog = Array.isArray(input.modelCatalog) && input.modelCatalog.length ? input.modelCatalog : DEFAULT_MODEL_CATALOG;
  const evaluated = catalog
    .map(normalizeCandidate)
    .map((candidate) => evaluateCandidate(candidate, policy))
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
  const healthSignals = normalizeHealthSignals(input.operationalHealth);
  const operationalHealth = buildOperationalHealth({ evaluated, healthSignals, now });
  const roleSelection = buildRoleSelectionMatrix({ evaluated, policy, operationalHealth, request });
  const selected = selectPrimaryCandidate({ evaluated, operationalHealth });
  const fallback = selected ? null : selectFallbackCandidate({ evaluated, operationalHealth });
  const selectedHealth = selected ? operationalHealth.reports.find((report) => report.modelId === selected.id) : null;
  const fallbackHealth = fallback ? operationalHealth.reports.find((report) => report.modelId === fallback.id) : null;
  const primaryHealth = selectedHealth || fallbackHealth;
  const activeDegradedMode =
    primaryHealth?.degradedMode === true || roleSelection.dispatchPlan.degradedFallbackRoles.length > 0;
  const command = normalizeCommand(input.command);
  const persistedState = normalizePersistedState(input.persistedState);
  const baseLifecycleSettings = normalizeLifecycleSettings(input.lifecycleSettings || persistedState.lifecycleSettings);
  const lifecycleCommandEffect = buildLifecycleCommandEffect(baseLifecycleSettings, command, now);
  const lifecycleSettings = lifecycleCommandEffect.settings;
  const lifecycleState = buildLifecycleState({ settings: lifecycleSettings, command, now, lifecycleCommandEffect });
  const capabilityNegotiation = buildCapabilityNegotiation({
    evaluated,
    policy,
    operationalHealth,
    lifecycleState,
    runtime: request.clientState.runtime,
    roleSelection,
    now
  });
  const readiness = {
    state: primaryHealth?.dispatchBlocked
      ? "blocked"
      : !roleSelection.ready
        ? "blocked"
      : lifecycleState.dispatchBlocked
        ? "blocked"
      : !capabilityNegotiation.providerRoleContractReady
        ? "blocked"
      : selected
        ? activeDegradedMode
          ? "needs-operator-acceptance"
          : "ready"
        : fallback && policy.allowFallback
          ? "needs-operator-acceptance"
          : "blocked",
    selectedModelId: selected?.id || null,
    fallbackModelId: fallback?.id || null,
    acceptanceRequired:
      policy.acceptanceMode === "operator" ||
      !selected ||
      activeDegradedMode ||
      roleSelection.dispatchPlan.requiresOperatorReview,
    dispatchable:
      !primaryHealth?.dispatchBlocked &&
      roleSelection.ready &&
      !lifecycleState.dispatchBlocked &&
      capabilityNegotiation.contractReady &&
      capabilityNegotiation.providerRoleContractReady &&
      (Boolean(selected) || Boolean(fallback && policy.allowFallback && policy.acceptanceMode === "automatic")),
    degradedMode: activeDegradedMode,
    retryAfterMs: primaryHealth?.retry?.retryAfterMs || null,
    providerContract: {
      contractReady: capabilityNegotiation.contractReady,
      providerNegotiationReady: capabilityNegotiation.providerNegotiationReady,
      selectedOfferModelId: capabilityNegotiation.selectedOfferModelId,
      fallbackOfferModelId: capabilityNegotiation.fallbackOfferModelId,
      negotiatedOfferCount: capabilityNegotiation.negotiatedOfferCount,
      providerRoleContractReady: capabilityNegotiation.providerRoleContractReady,
      roleReadyOfferCount: capabilityNegotiation.roleReadyOfferCount
    },
    lifecycle: {
      dispatchBlocked: lifecycleState.dispatchBlocked,
      reason: lifecycleState.reason,
      nextAction: lifecycleState.nextAction
    }
  };
  const policyFingerprint = makePolicyFingerprint({ request, policy });
  const recovered = resolveRestartStatus({ readiness, persistedState, policyFingerprint });
  const acceptanceTruth = buildAcceptanceTruthContract({
    now,
    command,
    selected,
    fallback,
    readiness,
    policyFingerprint,
    capabilityNegotiation
  });
  const commandResult = applyPolicyCommand({
    command,
    selected,
    fallback,
    readiness,
    persistedState,
    policyFingerprint,
    acceptanceTruth,
    now,
    operationalHealth,
    lifecycleSettings,
    lifecycleState,
    lifecycleCommandEffect
  });
  const externalHandoff = buildExternalHandoff({
    now,
    request,
    policyFingerprint,
    readiness,
    commandResult,
    capabilityNegotiation,
    roleSelection
  });
  if (!roleSelection.ready) {
    readiness.state = "blocked";
    readiness.dispatchable = false;
    externalHandoff.state = "blocked";
    externalHandoff.blockedReasons = [
      ...new Set([
        ...externalHandoff.blockedReasons,
        ...roleSelection.blockedRequiredRoles.map((role) => `required_role_blocked:${role}`)
      ])
    ];
  }
  const tenantBoundaryGate = buildTenantBoundaryGate({ now, request, command, externalHandoff });
  if (!tenantBoundaryGate.pass) {
    readiness.state = "blocked";
    readiness.dispatchable = false;
    externalHandoff.state = "blocked";
    externalHandoff.blockedReasons = [...new Set([...externalHandoff.blockedReasons, ...tenantBoundaryGate.blockingReasons])];
    if (commandResult.accepted) {
      commandResult.accepted = false;
      commandResult.applied = false;
      commandResult.status = "blocked";
      commandResult.problems = [...new Set([...commandResult.problems, ...tenantBoundaryGate.blockingReasons])];
      commandResult.decision = {
        ...commandResult.decision,
        modelId: null,
        status: "blocked"
      };
      commandResult.commandReceipt = null;
      commandResult.auditEvent.appliedStatus = "blocked";
      commandResult.auditEvent.receiptProofId = null;
      commandResult.auditEvent.problems = commandResult.problems;
    }
  }
  const clientRuntimeGate = buildClientRuntimeGate({ now, request, externalHandoff });
  const validationSummary = buildValidationSummary({
    evaluated,
    policy,
    request,
    operationalHealth,
    lifecycleState,
    capabilityNegotiation,
    tenantBoundaryGate,
    roleSelection,
    acceptanceTruth
  });
  const persistedStatus = tenantBoundaryGate.pass
    ? commandResult.status === readiness.state
      ? recovered.status
      : commandResult.status
    : "blocked";
  const recoveryContract = buildRecoveryContract({
    now,
    request,
    persistedState,
    policyFingerprint,
    recovered: tenantBoundaryGate.pass
      ? recovered
      : {
          status: "blocked",
          source: "tenant-boundary-gate",
          recoveredModelId: null,
          reason: tenantBoundaryGate.blockingReasons.join(", ")
        },
    commandResult,
    persistedStatus,
    roleSelection,
    readiness
  });
  const analyticsCounters = buildAnalyticsCounters({
    evaluated,
    readiness,
    operationalHealth,
    commandResult,
    validationSummary,
    lifecycleState,
    roleSelection,
    persistedState
  });
  const historySnapshot = buildAnalyticsSnapshot({
    now,
    request,
    readiness,
    operationalHealth,
    commandResult,
    policyFingerprint,
    analyticsCounters,
    roleSelection
  });
  const analyticsHistory = appendAnalyticsHistory(persistedState.analyticsHistory, historySnapshot);
  const exportSummary = buildExportSummary({
    now,
    request,
    policyFingerprint,
    analyticsCounters,
    readiness,
    operationalHealth,
    roleSelection,
    capabilityNegotiation,
    externalHandoff,
    tenantBoundaryGate
  });
  const reportingTimeline = buildReportingTimeline({
    now,
    request,
    readiness,
    operationalHealth,
    commandResult,
    historySnapshot,
    roleSelection
  });
  const analyticsTrendReport = buildAnalyticsTrendReport({
    now,
    request,
    policyFingerprint,
    analyticsHistory
  });
  const analyticsExportManifest = buildAnalyticsExportManifest({
    now,
    request,
    analyticsHistory,
    exportSummary,
    trendReport: analyticsTrendReport,
    reportingTimeline
  });
  const reportingState = buildReportingState({
    now,
    request,
    readiness,
    analyticsTrendReport,
    analyticsExportManifest,
    reportingTimeline
  });
  const dispatchEnvelope = buildHostedKernelDispatchEnvelope({
    now,
    request,
    policy,
    policyFingerprint,
    readiness,
    commandResult,
    externalHandoff,
    capabilityNegotiation,
    lifecycleState,
    operationalHealth,
    roleSelection,
    validationSummary,
    clientRuntimeGate,
    tenantBoundaryGate
  });
  const persistedSnapshot = {
    schema: "scheduler.model-policy.state.v1",
    status: recoveryContract.statusAfterRecovery,
    selectedModelId: commandResult.accepted ? commandResult.decision.modelId : selected?.id || null,
    fallbackModelId: fallback?.id || null,
    policyFingerprint,
    roleSelection,
    roleRecovery: recoveryContract.roleRecovery,
    lifecycleSettings: commandResult.lifecycleSettings,
    lifecycleCommandEffect,
    acceptanceTruth,
    externalHandoff,
    clientRuntimeGate,
    tenantBoundaryGate,
    dispatchEnvelope: {
      schema: dispatchEnvelope.schema,
      state: dispatchEnvelope.state,
      proofId: dispatchEnvelope.proofId,
      invocationReady: dispatchEnvelope.invocationReady,
      preflight: dispatchEnvelope.preflight,
      auditProof: dispatchEnvelope.auditProof
    },
    appliedCommandIds: commandResult.applied
      ? [...new Set([...persistedState.appliedCommandIds, commandResult.commandId])]
      : persistedState.appliedCommandIds,
    commandReceipts: commandResult.applied
      ? appendCommandReceipt(persistedState.commandReceipts, commandResult.commandReceipt)
      : persistedState.commandReceipts,
    recoveryContract,
    recoveryIssues: recoveryContract.issues,
    lastDecision: commandResult.applied ? commandResult.decision : persistedState.lastDecision,
    analyticsHistory,
    analyticsTrendReport,
    analyticsExportManifest,
    reportingState
  };
  const recovery = {
    restartSafe: recoveryContract.restartSafe,
    recovered: persistedState.recovered,
    status: tenantBoundaryGate.pass ? recoveryContract.statusAfterRecovery : "blocked",
    source: tenantBoundaryGate.pass ? recovered.source : "tenant-boundary-gate",
    recoveredModelId: tenantBoundaryGate.pass ? recovered.recoveredModelId : null,
    reason: tenantBoundaryGate.pass ? recovered.reason : tenantBoundaryGate.blockingReasons.join(", "),
    contract: recoveryContract
  };
  const acceptance = {
    mode: policy.acceptanceMode,
    decision: !tenantBoundaryGate.pass
      ? "tenant-boundary-blocked"
      : commandResult.accepted
        ? "accepted-command"
        : selected
          ? "accept"
          : fallback && policy.allowFallback
            ? "preview-fallback"
            : "reject",
    acceptedModelId: tenantBoundaryGate.pass ? (commandResult.accepted ? commandResult.decision.modelId : selected?.id || null) : null,
    requiresHumanReview: !commandResult.accepted && (readiness.acceptanceRequired || !tenantBoundaryGate.pass),
    controls: buildNextSteps({ validationSummary, selected, fallback, lifecycleState, tenantBoundaryGate })
  };
  const preview = {
    title: request.userVisibleLabel || "Scheduler model policy preview",
    summary: !tenantBoundaryGate.pass
      ? "Tenant boundary requirements must be resolved before hosted-kernel dispatch"
      : !roleSelection.ready
        ? `Required scheduler roles blocked: ${roleSelection.blockedRequiredRoles.join(", ")}`
      : selected
      ? `${selected.id} is ready for hosted-kernel dispatch`
      : fallback
        ? `${fallback.id} is available as a fallback but policy constraints are unmet`
        : "No available model can satisfy the current policy",
    roleSelection,
    candidates: evaluated.map((candidate) => ({
      id: candidate.id,
      provider: candidate.provider,
      score: candidate.score,
      accepted: candidate.accepted,
      violations: candidate.violations,
      health: operationalHealth.reports.find((report) => report.modelId === candidate.id)?.state || "unknown",
      providerContract: {
        endpoint: candidate.serviceContract.endpoint,
        handoffProtocol: candidate.serviceContract.handoffProtocol,
        syncMode: candidate.serviceContract.syncMode,
        ackMode: candidate.serviceContract.syncMetadata.ackMode,
        callbackRoute: candidate.serviceContract.syncMetadata.callbackRoute,
        authMode: candidate.serviceContract.syncMetadata.authMode,
        watermark: candidate.serviceContract.syncMetadata.watermark,
        roleCapabilities: candidate.serviceContract.roleCapabilities,
        roleDispatchBindings: candidate.serviceContract.roleDispatchBindings,
        roleDispatchRoutes: candidate.serviceContract.roleDispatchRoutes,
        roleContract:
          capabilityNegotiation.offers.find((offer) => offer.modelId === candidate.id)?.roleContract || null,
        ready: candidate.serviceContract.ready
      },
      explain: candidate.explain
    }))
  };
  const actionableErrors = buildActionableErrors({ selected, fallback, operationalHealth, lifecycleState });
  const clientInteraction = buildClientInteractionContract({
    now,
    request,
    command,
    preview,
    readiness,
    validationSummary,
    acceptance,
    selected,
    fallback,
    policyFingerprint,
    externalHandoff,
    dispatchEnvelope,
    actionableErrors,
    lifecycleState,
    clientRuntimeGate,
    tenantBoundaryGate,
    acceptanceTruth
  });
  const audit = {
    proofType: "scheduler.model-policy.preview.v1",
    generatedAt: now,
    request,
    validationSummary,
    acceptanceTruth,
    readiness,
    acceptanceDecision: acceptance.decision,
    policyFingerprint,
    recoveryStatus: recovery.status,
    recoveryContract,
    roleSelection,
    operationalHealth,
    lifecycleState,
    lifecycleCommandEffect,
    capabilityNegotiation,
    externalHandoff,
    clientRuntimeGate,
    tenantBoundaryGate,
    dispatchEnvelope,
    actionableErrors,
    previewAcceptanceReadiness: clientInteraction.previewAcceptanceReadiness,
    routePreviewContract: clientInteraction.routePreviewContract,
    clientInteraction,
    command: commandResult.auditEvent,
    analytics: {
      counters: analyticsCounters,
      historySnapshot,
      exportSummary,
      reportingTimeline,
      trendReport: analyticsTrendReport,
      exportManifest: analyticsExportManifest,
      reportingState
    }
  };
  const analytics = {
    schema: "scheduler.model-policy.analytics.v1",
    generatedAt: now,
    counters: analyticsCounters,
    latestSnapshot: historySnapshot,
    history: analyticsHistory,
    exportSummary,
    exportManifest: analyticsExportManifest,
    trendReport: analyticsTrendReport,
    reportingTimeline,
    reportingState
  };

  return {
    ok: true,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'scheduler.model-policy.preview.v1',
    policy,
    request,
    preview,
    readiness,
    roleSelection,
    clientInteraction,
    previewAcceptanceReadiness: clientInteraction.previewAcceptanceReadiness,
    routePreviewContract: clientInteraction.routePreviewContract,
    capabilityNegotiation,
    externalHandoff,
    clientRuntimeGate,
    tenantBoundaryGate,
    dispatchEnvelope,
    lifecycleSettings: commandResult.lifecycleSettings,
    lifecycleState,
    lifecycleCommandEffect,
    operationalHealth,
    actionableErrors,
    recovery,
    roleRecovery: recoveryContract.roleRecovery,
    command: commandResult,
    persistedState: persistedSnapshot,
    analytics,
    acceptance,
    acceptanceTruth,
    validationSummary,
    audit,
    evidence: Array.isArray(input.evidence) ? [...input.evidence, audit, commandResult.auditEvent] : [audit, commandResult.auditEvent]
  };
}

export default describeModelPolicySurface;
