import { createHash } from 'node:crypto';

export const surfaceId = "aios_operator-userland_approval-console_089";
export const surfaceGroup = "operator-userland";
export const surfaceName = "approval-console";

const APPROVAL_STATES = new Set(['requested', 'approved', 'denied', 'expired', 'cancelled']);
const DECISIONS = new Set(['approve', 'deny', 'defer']);
const LIFECYCLE_COMMANDS = new Set(['enable', 'disable', 'schedule', 'unschedule', 'resume', 'pause']);
const BOUNDARY_TRANSITION_KINDS = new Set(['local', 'workspace-transfer', 'tenant-transfer', 'tenant-workspace-transfer']);
const APPROVAL_IMPACT_TYPES = new Set(['external_write', 'destructive_action', 'privileged_kernel_change']);
const RISK_ORDER = { low: 1, medium: 2, high: 3, critical: 4 };
const ROLE_ORDER = { viewer: 1, reviewer: 2, approver: 3, tenant_admin: 4, kernel_admin: 5 };
const RISK_MIN_ROLE = { low: 'reviewer', medium: 'approver', high: 'tenant_admin', critical: 'kernel_admin' };
const IMPACT_REQUIREMENTS = {
  external_write: {
    minRisk: 'high',
    minRole: 'tenant_admin',
    requiresProof: true,
    requiredScopes: ['external:write'],
    label: 'External write'
  },
  destructive_action: {
    minRisk: 'critical',
    minRole: 'kernel_admin',
    requiresProof: true,
    requiredScopes: ['destructive:execute'],
    label: 'Destructive action'
  },
  privileged_kernel_change: {
    minRisk: 'critical',
    minRole: 'kernel_admin',
    requiresProof: true,
    requiredScopes: ['kernel:*'],
    label: 'Privileged kernel change'
  }
};
const LIFECYCLE_MIN_ROLE = {
  enable: 'tenant_admin',
  disable: 'tenant_admin',
  schedule: 'approver',
  unschedule: 'approver',
  resume: 'approver',
  pause: 'approver'
};
const LIFECYCLE_DEFAULTS = {
  enabled: true,
  schedulerEnabled: true,
  requireApprovalForEnable: true,
  requireProofForDisable: true,
  maxScheduledHours: 24
};
const EVIDENCE_TYPES = new Set(['operator-note', 'policy-check', 'kernel-proof', 'external-ticket', 'approval-log']);
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const JOURNAL_STATUSES = new Set(['staged', 'committed', 'failed']);
const JOURNAL_KINDS = new Set(['approval-resume', 'lifecycle-apply']);
const IMPACT_COMMAND_STATUSES = new Set(['staged', 'committed', 'failed', 'rolled_back', 'superseded']);
const FAILURE_SEVERITY_ORDER = { info: 1, warning: 2, degraded: 3, blocked: 4, critical: 5 };
const RETRY_DEFAULTS = {
  baseDelayMs: 30_000,
  maxDelayMs: 15 * 60_000,
  maxAttempts: 5
};
const PROVIDER_DEFAULT_CAPABILITIES = [
  'approval:decision',
  'audit:append',
  'handoff:resume',
  'proof:attach'
];
const PROVIDER_REQUIRED_FIELDS = ['providerId', 'protocol', 'endpoint', 'advertisedCapabilities', 'sync'];
const PROVIDER_ACK_STATES = new Set(['not_required', 'pending', 'accepted', 'rejected', 'expired']);
const PROVIDER_HANDOFF_MODES = new Set(['proofed-external-call', 'queued-dispatch', 'manual-export']);
const PROVIDER_DISPATCH_LANES = new Set(['interactive', 'background', 'operator-mediated']);
const PROVIDER_CAPABILITY_ALIASES = {
  'approval:decision': ['approval:*', 'operator:approval'],
  'audit:append': ['audit:*', 'ledger:append'],
  'handoff:resume': ['handoff:*', 'runtime:resume'],
  'proof:attach': ['proof:*', 'evidence:attach'],
  'boundary:review': ['boundary:*', 'tenant-boundary:review'],
  'lifecycle:apply': ['lifecycle:*', 'runtime:lifecycle']
};
const PROVIDER_IMPACT_RULES = {
  external_write: {
    providerCapability: 'external:write',
    proofRefs: ['approvalImpactProof', 'proofBundleProof'],
    allowedHandoffModes: ['proofed-external-call', 'queued-dispatch'],
    allowedDispatchLanes: ['interactive', 'background', 'operator-mediated'],
    barrier: 'external-egress-ledger'
  },
  destructive_action: {
    providerCapability: 'destructive:execute',
    proofRefs: ['approvalImpactProof', 'proofBundleProof', 'rollbackProof'],
    allowedHandoffModes: ['manual-export'],
    allowedDispatchLanes: ['operator-mediated'],
    barrier: 'destructive-change-ledger'
  },
  privileged_kernel_change: {
    providerCapability: 'kernel:*',
    proofRefs: ['approvalImpactProof', 'proofBundleProof', 'boundaryTransitionProof', 'kernelConfigDigest'],
    allowedHandoffModes: ['proofed-external-call', 'manual-export'],
    allowedDispatchLanes: ['operator-mediated'],
    barrier: 'kernel-control-plane-ledger'
  }
};
const IMPACT_PREVIEW_SECTION_COPY = {
  external_write: {
    title: 'External write destination',
    operatorPrompt: 'Confirm external destinations, payload class, and idempotency before dispatch.'
  },
  destructive_action: {
    title: 'Destructive action rollback',
    operatorPrompt: 'Confirm destructive targets, rollback plan, backup proof, and irreversibility.'
  },
  privileged_kernel_change: {
    title: 'Privileged kernel change',
    operatorPrompt: 'Confirm kernel subsystem, privilege scope, change window, and config digest.'
  }
};

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asString(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeRisk(value) {
  const risk = asString(value, 'medium').toLowerCase();
  return Object.hasOwn(RISK_ORDER, risk) ? risk : 'medium';
}

function normalizeState(value) {
  const state = asString(value, 'requested').toLowerCase();
  return APPROVAL_STATES.has(state) ? state : 'requested';
}

function normalizeDecision(value) {
  const decision = asString(value).toLowerCase();
  return DECISIONS.has(decision) ? decision : null;
}

function normalizeImpactType(value) {
  const impactType = asString(value).toLowerCase().replace(/[-\s]+/g, '_');
  const aliases = {
    externalwrite: 'external_write',
    external_writes: 'external_write',
    destructive: 'destructive_action',
    destructiveaction: 'destructive_action',
    kernelchange: 'privileged_kernel_change',
    privilegedkernelchange: 'privileged_kernel_change',
    privileged_kernel: 'privileged_kernel_change'
  };
  const normalized = aliases[impactType] || impactType;
  return APPROVAL_IMPACT_TYPES.has(normalized) ? normalized : null;
}

function normalizeLifecycleCommand(value) {
  const command = asString(value).toLowerCase();
  return LIFECYCLE_COMMANDS.has(command) ? command : null;
}

function normalizeBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeControlBoolean(source, keys, fallback) {
  for (const key of keys) {
    if (typeof source[key] === 'boolean') {
      return source[key];
    }
  }
  return fallback;
}

function normalizePositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeScope(value) {
  const scope = Array.isArray(value) ? value : [value];
  return [...new Set(scope
    .map((entry) => asString(entry))
    .filter(Boolean)
    .map((entry) => entry.toLowerCase()))]
    .slice(0, 12);
}

function normalizeIdList(value) {
  const ids = Array.isArray(value) ? value : [value];
  return [...new Set(ids
    .map((entry) => asString(entry))
    .filter(Boolean))]
    .slice(0, 50);
}

function normalizeRoles(value) {
  const roles = normalizeScope(value).filter((role) => Object.hasOwn(ROLE_ORDER, role));
  return roles.length ? roles : ['viewer'];
}

function strongestRole(roles) {
  return roles.reduce((strongest, role) => (
    ROLE_ORDER[role] > ROLE_ORDER[strongest] ? role : strongest
  ), 'viewer');
}

function roleMeets(actualRole, requiredRole) {
  return ROLE_ORDER[actualRole] >= ROLE_ORDER[requiredRole];
}

function normalizeBoundary(input) {
  const client = asObject(input.clientState);
  const runtime = asObject(input.runtime);
  const tenantId = asString(client.tenantId, asString(runtime.tenantId, asString(input.tenantId, 'default-tenant')));
  const workspaceId = asString(client.workspaceId, asString(runtime.workspaceId, asString(input.workspaceId, 'default-workspace')));
  return {
    tenantId,
    workspaceId,
    isolationKey: `${tenantId}:${workspaceId}`,
    allowCrossWorkspace: client.allowCrossWorkspace === true || runtime.allowCrossWorkspace === true,
    allowCrossTenant: client.allowCrossTenant === true || runtime.allowCrossTenant === true
  };
}

function normalizeOperator(input) {
  const client = asObject(input.clientState);
  const runtime = asObject(input.runtime);
  const operator = asObject(client.operator || runtime.operator || input.operator);
  const roles = normalizeRoles(operator.roles || client.roles || runtime.roles || input.roles);
  return {
    id: asString(operator.id, asString(client.operatorId, asString(input.operatorId))),
    roles,
    strongestRole: strongestRole(roles),
    permissions: normalizeScope(operator.permissions || client.permissions || runtime.permissions || input.permissions)
  };
}

function collectPermissionBindingInputs(input) {
  const client = asObject(input.clientState);
  const runtime = asObject(input.runtime);
  const operator = asObject(client.operator || runtime.operator || input.operator);
  if (Array.isArray(input.permissionBindings)) {
    return input.permissionBindings;
  }
  if (Array.isArray(input.workspacePermissions)) {
    return input.workspacePermissions;
  }
  if (Array.isArray(client.permissionBindings)) {
    return client.permissionBindings;
  }
  if (Array.isArray(runtime.permissionBindings)) {
    return runtime.permissionBindings;
  }
  if (Array.isArray(operator.permissionBindings)) {
    return operator.permissionBindings;
  }
  return [];
}

function normalizePermissionBindings(input, boundary, operator, now) {
  const nowMs = parseTime(now);
  return collectPermissionBindingInputs(input).slice(0, 50).map((entry, index) => {
    const raw = asObject(entry);
    const tenantId = asString(raw.tenantId, boundary.tenantId);
    const workspaceId = asString(raw.workspaceId, boundary.workspaceId);
    const role = strongestRole(normalizeRoles(raw.roles || raw.role || operator.roles));
    const permissions = normalizeScope(raw.permissions || raw.capabilities || operator.permissions);
    const expiresAt = asString(raw.expiresAt || raw.until);
    const expiresMs = expiresAt ? parseTime(expiresAt) : null;
    const proof = asString(raw.proof || raw.digest);
    const validation = [];

    if (!tenantId) {
      validation.push('permission.binding.tenantId.required');
    }
    if (!workspaceId) {
      validation.push('permission.binding.workspaceId.required');
    }
    if (expiresAt && expiresMs === null) {
      validation.push('permission.binding.expiresAt.invalid');
    }
    if (expiresMs !== null && nowMs !== null && expiresMs < nowMs) {
      validation.push('permission.binding.expired');
    }
    if (proof && !DIGEST_PATTERN.test(proof)) {
      validation.push('permission.binding.proof.sha256_required');
    }

    return {
      id: asString(raw.id || raw.bindingId, `${operator.id || 'operator'}:permission:${index + 1}`),
      tenantId,
      workspaceId,
      role,
      permissions,
      source: asString(raw.source || raw.issuer || raw.delegatedBy, 'operator-userland/permission-binding'),
      expiresAt,
      proof,
      active: validation.length === 0,
      validation,
      bindingProof: `sha256:${proofFor({ tenantId, workspaceId, role, permissions, expiresAt, source: raw.source || raw.issuer || raw.delegatedBy || '' })}`
    };
  });
}

function permissionBindingMatches(binding, tenantId, workspaceId, boundary) {
  const tenantMatches = binding.tenantId === tenantId || (binding.tenantId === '*' && boundary.allowCrossTenant);
  const workspaceMatches = binding.workspaceId === workspaceId || (binding.workspaceId === '*' && boundary.allowCrossWorkspace);
  return tenantMatches && workspaceMatches;
}

function evaluatePermissionBindings(request, clientState, targetTenantId, targetWorkspaceId, requiredRole) {
  const validation = [];
  const configured = clientState.permissionBoundary.bindings.length > 0;
  const matchingBindings = clientState.permissionBoundary.bindings.filter((binding) => (
    permissionBindingMatches(binding, targetTenantId, targetWorkspaceId, clientState.boundary)
  ));
  const activeBindings = matchingBindings.filter((binding) => binding.active);
  const strongestBindingRole = activeBindings.length
    ? strongestRole(activeBindings.map((binding) => binding.role))
    : null;
  const grantedPermissions = [...new Set(activeBindings.flatMap((binding) => binding.permissions))];
  const deniedScopes = request.scope.filter((scopeEntry) => !hasCapability(scopeEntry, grantedPermissions));

  if ((configured || clientState.permissionBoundary.requireExplicitWorkspaceGrant) && activeBindings.length === 0) {
    validation.push('permission.binding.target_grant_required');
  }
  if (configured && strongestBindingRole && !roleMeets(strongestBindingRole, requiredRole)) {
    validation.push(`permission.binding.role.${requiredRole}_required`);
  }
  if (configured && request.scope.length > 0 && deniedScopes.length > 0) {
    validation.push('permission.binding.scope_not_granted');
  }

  return {
    configured,
    required: clientState.permissionBoundary.requireExplicitWorkspaceGrant,
    matchedBindingIds: matchingBindings.map((binding) => binding.id),
    activeBindingIds: activeBindings.map((binding) => binding.id),
    strongestBindingRole,
    grantedPermissions,
    deniedScopes,
    validation
  };
}

function buildWorkspaceScopeContract(request, clientState, targetTenantId, targetWorkspaceId, permissionGrant, requiredRole) {
  const requestedTenantId = asString(request.tenantId, clientState.boundary.tenantId);
  const requestedWorkspaceId = asString(request.workspaceId, clientState.boundary.workspaceId);
  const transition = request.boundaryTransition;
  const transitionTargetTenantId = transition?.target.tenantId || requestedTenantId;
  const transitionTargetWorkspaceId = transition?.target.workspaceId || requestedWorkspaceId;
  const localTenant = targetTenantId === clientState.boundary.tenantId;
  const localWorkspace = targetWorkspaceId === clientState.boundary.workspaceId;
  const requestMatchesTransition = requestedTenantId === transitionTargetTenantId
    && requestedWorkspaceId === transitionTargetWorkspaceId;
  const requiresCrossTenantGrant = !localTenant;
  const requiresCrossWorkspaceGrant = localTenant && !localWorkspace;
  const requiresExplicitGrant = requiresCrossTenantGrant
    || requiresCrossWorkspaceGrant
    || clientState.permissionBoundary.requireExplicitWorkspaceGrant;
  const activeScopedBindings = clientState.permissionBoundary.bindings.filter((binding) => (
    binding.active && permissionGrant.activeBindingIds.includes(binding.id)
  ));
  const wildcardBindingIds = activeScopedBindings
    .filter((binding) => binding.tenantId === '*' || binding.workspaceId === '*')
    .map((binding) => binding.id);
  const exactBindingIds = activeScopedBindings
    .filter((binding) => binding.tenantId === targetTenantId && binding.workspaceId === targetWorkspaceId)
    .map((binding) => binding.id);
  const grantRoleSatisfied = permissionGrant.strongestBindingRole
    ? roleMeets(permissionGrant.strongestBindingRole, requiredRole)
    : false;
  const grantScopeSatisfied = request.scope.length === 0 || permissionGrant.deniedScopes.length === 0;
  const validation = [
    ...(!requestMatchesTransition ? ['workspace.scope.request_transition_mismatch'] : []),
    ...(requiresCrossTenantGrant && !clientState.boundary.allowCrossTenant ? ['workspace.scope.cross_tenant_disabled'] : []),
    ...(requiresCrossWorkspaceGrant && !clientState.boundary.allowCrossWorkspace ? ['workspace.scope.cross_workspace_disabled'] : []),
    ...(requiresExplicitGrant && permissionGrant.activeBindingIds.length === 0 ? ['workspace.scope.explicit_grant_required'] : []),
    ...(requiresCrossTenantGrant && exactBindingIds.length === 0 ? ['workspace.scope.cross_tenant_exact_grant_required'] : []),
    ...(requiresCrossWorkspaceGrant && exactBindingIds.length === 0 && wildcardBindingIds.length === 0 ? ['workspace.scope.cross_workspace_grant_required'] : []),
    ...(permissionGrant.strongestBindingRole && !grantRoleSatisfied ? [`workspace.scope.role.${requiredRole}_required`] : []),
    ...(permissionGrant.configured && !grantScopeSatisfied ? ['workspace.scope.permission_scope_not_granted'] : [])
  ];
  const scopeClass = requiresCrossTenantGrant
    ? 'cross_tenant'
    : requiresCrossWorkspaceGrant
      ? 'cross_workspace'
      : 'local_workspace';

  return {
    format: 'approval-console.workspace-scope-contract.v1',
    scopeClass,
    requested: {
      tenantId: requestedTenantId,
      workspaceId: requestedWorkspaceId,
      isolationKey: `${requestedTenantId}:${requestedWorkspaceId}`
    },
    target: {
      tenantId: targetTenantId,
      workspaceId: targetWorkspaceId,
      isolationKey: `${targetTenantId}:${targetWorkspaceId}`
    },
    source: {
      tenantId: clientState.boundary.tenantId,
      workspaceId: clientState.boundary.workspaceId,
      isolationKey: clientState.boundary.isolationKey
    },
    transitionTarget: {
      tenantId: transitionTargetTenantId,
      workspaceId: transitionTargetWorkspaceId,
      isolationKey: `${transitionTargetTenantId}:${transitionTargetWorkspaceId}`
    },
    requiresExplicitGrant,
    requiresCrossTenantGrant,
    requiresCrossWorkspaceGrant,
    requestMatchesTransition,
    exactBindingIds,
    wildcardBindingIds,
    activeBindingIds: permissionGrant.activeBindingIds,
    deniedScopes: permissionGrant.deniedScopes,
    grantRoleSatisfied,
    grantScopeSatisfied,
    safeForHandoff: validation.length === 0,
    operatorRepairHints: validation.map((reason) => ({
      reason,
      action: reason.includes('exact_grant')
        ? 'issue-exact-tenant-workspace-binding'
        : reason.includes('cross_tenant')
          ? 'enable-cross-tenant-transfer-with-kernel-admin-proof'
          : reason.includes('cross_workspace')
            ? 'issue-workspace-transfer-grant'
            : reason.includes('permission_scope')
              ? 'extend-binding-permissions-for-request-scope'
              : reason.includes('role.')
                ? 'delegate-required-approval-role'
                : 'align-request-and-boundary-transition-target'
    })),
    validation,
    proof: `sha256:${proofFor({
      requestId: request.id,
      scopeClass,
      requestedTenantId,
      requestedWorkspaceId,
      targetTenantId,
      targetWorkspaceId,
      transitionTargetTenantId,
      transitionTargetWorkspaceId,
      activeBindingIds: permissionGrant.activeBindingIds,
      deniedScopes: permissionGrant.deniedScopes,
      requiredRole
    })}`
  };
}

function normalizeBoundaryTransition(rawTransition, clientState, request, now) {
  const raw = asObject(rawTransition);
  const source = asObject(raw.source || raw.from);
  const target = asObject(raw.target || raw.to);
  const sourceTenantId = asString(source.tenantId || raw.sourceTenantId, clientState.boundary.tenantId);
  const sourceWorkspaceId = asString(source.workspaceId || raw.sourceWorkspaceId, clientState.boundary.workspaceId);
  const targetTenantId = asString(target.tenantId || raw.targetTenantId, request.tenantId || clientState.boundary.tenantId);
  const targetWorkspaceId = asString(target.workspaceId || raw.targetWorkspaceId, request.workspaceId || clientState.boundary.workspaceId);
  const crossTenant = sourceTenantId !== targetTenantId;
  const crossWorkspace = sourceWorkspaceId !== targetWorkspaceId;
  const requestedAt = asString(raw.requestedAt || raw.createdAt || raw.at, now);
  const requestedMs = requestedAt ? parseTime(requestedAt) : null;
  const kind = crossTenant && crossWorkspace
    ? 'tenant-workspace-transfer'
    : crossTenant
      ? 'tenant-transfer'
      : crossWorkspace
        ? 'workspace-transfer'
        : 'local';
  const declaredKind = asString(raw.kind || raw.type, kind);
  const proof = asString(raw.proof || raw.digest);
  const reason = asString(raw.reason || raw.justification || request.intent);
  const validation = [];

  if (!BOUNDARY_TRANSITION_KINDS.has(declaredKind)) {
    validation.push('boundary.transition.kind.unsupported');
  }
  if (declaredKind !== kind && BOUNDARY_TRANSITION_KINDS.has(declaredKind)) {
    validation.push('boundary.transition.kind_mismatch');
  }
  if (!sourceTenantId || !targetTenantId) {
    validation.push('boundary.transition.tenantId.required');
  }
  if (!sourceWorkspaceId || !targetWorkspaceId) {
    validation.push('boundary.transition.workspaceId.required');
  }
  if ((crossTenant || crossWorkspace) && !reason) {
    validation.push('boundary.transition.reason.required');
  }
  if (crossTenant && !clientState.boundary.allowCrossTenant) {
    validation.push('boundary.transition.cross_tenant_disabled');
  }
  if (crossWorkspace && !clientState.boundary.allowCrossWorkspace) {
    validation.push('boundary.transition.cross_workspace_disabled');
  }
  if (crossTenant && !roleMeets(clientState.operator.strongestRole, 'kernel_admin')) {
    validation.push('boundary.transition.role.kernel_admin_required');
  }
  if (crossWorkspace && !roleMeets(clientState.operator.strongestRole, 'tenant_admin')) {
    validation.push('boundary.transition.role.tenant_admin_required');
  }
  if (crossTenant && !proof) {
    validation.push('boundary.transition.proof_required');
  }
  if (proof && !DIGEST_PATTERN.test(proof)) {
    validation.push('boundary.transition.proof.sha256_required');
  }
  if (requestedAt && requestedMs === null) {
    validation.push('boundary.transition.requestedAt.invalid');
  }

  const transitionPayload = {
    sourceTenantId,
    sourceWorkspaceId,
    targetTenantId,
    targetWorkspaceId,
    kind,
    reason,
    requestedBy: asString(raw.requestedBy || raw.actor, request.requestedBy),
    requestedAt
  };

  return {
    format: 'approval-console.boundary-transition.v1',
    kind,
    declaredKind,
    source: {
      tenantId: sourceTenantId,
      workspaceId: sourceWorkspaceId,
      isolationKey: `${sourceTenantId}:${sourceWorkspaceId}`
    },
    target: {
      tenantId: targetTenantId,
      workspaceId: targetWorkspaceId,
      isolationKey: `${targetTenantId}:${targetWorkspaceId}`
    },
    crossTenant,
    crossWorkspace,
    changed: crossTenant || crossWorkspace,
    requestedBy: transitionPayload.requestedBy,
    requestedAt,
    reason,
    externalProof: proof,
    validation,
    allowed: validation.length === 0,
    proof: `sha256:${proofFor(transitionPayload)}`
  };
}

function hasCapability(scopeEntry, capabilities) {
  return capabilities.includes(scopeEntry) || capabilities.includes('*') || capabilities.includes('kernel:*');
}

function providerHasCapability(requiredCapability, advertisedCapabilities) {
  const alternatives = PROVIDER_CAPABILITY_ALIASES[requiredCapability] || [];
  return hasCapability(requiredCapability, advertisedCapabilities)
    || alternatives.some((capability) => hasCapability(capability, advertisedCapabilities));
}

function collectApprovalImpactInputs(raw, request) {
  const explicitTypes = normalizeScope(raw.impactTypes || raw.impacts || raw.approvalImpacts)
    .map(normalizeImpactType)
    .filter(Boolean);
  const singleExplicitType = normalizeImpactType(raw.impactType || raw.impact || raw.category);
  const actionText = `${request.action} ${request.target} ${request.intent} ${request.scope.join(' ')}`.toLowerCase();
  const externalTargets = normalizeIdList(raw.externalTargets || raw.externalWriteTargets || raw.destinations);
  const categories = new Set([
    ...explicitTypes,
    ...(singleExplicitType ? [singleExplicitType] : [])
  ]);
  const detectionReasons = [];

  if (raw.externalWrite === true || raw.externalWrites === true || externalTargets.length > 0 || /\b(webhook|external|third[-_\s]?party|api-write|publish|send|egress|outbound)\b/.test(actionText)) {
    categories.add('external_write');
    detectionReasons.push('impact.external_write.detected');
  }
  if (raw.destructive === true || raw.destructiveAction === true || /\b(delete|destroy|purge|drop|wipe|terminate|revoke|rotate-secret|reset)\b/.test(actionText)) {
    categories.add('destructive_action');
    detectionReasons.push('impact.destructive_action.detected');
  }
  if (raw.privilegedKernelChange === true || raw.kernelChange === true || /\b(kernel|scheduler|provider-contract|permission-boundary|root|tenant-admin|kernel-admin)\b/.test(actionText)) {
    categories.add('privileged_kernel_change');
    detectionReasons.push('impact.privileged_kernel_change.detected');
  }

  return {
    categories: [...categories],
    externalTargets,
    destructiveTargets: normalizeIdList(raw.destructiveTargets || raw.resourcesToDelete || raw.affectedResources),
    rollbackPlan: asString(raw.rollbackPlan || raw.recoveryPlan || raw.undoPlan),
    backupProof: asString(raw.backupProof || raw.snapshotProof || raw.rollbackProof),
    kernelChange: asObject(raw.kernelChange || raw.privilegedKernelChangeDetails || raw.kernelChangeContract),
    detectionReasons
  };
}

function normalizeExternalWriteContract(raw, request, impactInputs) {
  const endpointProof = asString(raw.endpointProof || raw.destinationProof || raw.externalTargetProof);
  const validation = [];

  if (impactInputs.categories.includes('external_write') && impactInputs.externalTargets.length === 0) {
    validation.push('approval.impact.external_write.targets_required');
  }
  if (endpointProof && !DIGEST_PATTERN.test(endpointProof)) {
    validation.push('approval.impact.external_write.endpoint_proof.sha256_required');
  }

  return {
    applies: impactInputs.categories.includes('external_write'),
    targets: impactInputs.externalTargets,
    writeMode: asString(raw.writeMode || raw.externalWriteMode || raw.deliveryMode, 'unspecified'),
    payloadClass: asString(raw.payloadClass || raw.dataClass || raw.egressClass, 'unspecified'),
    endpointProof,
    idempotencyKey: asString(
      raw.idempotencyKey || raw.externalIdempotencyKey,
      `${request.id}:external-write:${impactInputs.externalTargets.join('|') || 'unspecified'}`
    ),
    validation
  };
}

function normalizeDestructiveActionContract(raw, request, impactInputs) {
  const acknowledgement = asString(raw.destructiveAcknowledgement || raw.operatorAcknowledgement || raw.breakGlassReason);
  const validation = [];

  if (impactInputs.categories.includes('destructive_action') && impactInputs.destructiveTargets.length === 0) {
    validation.push('approval.impact.destructive_action.targets_required');
  }
  if (impactInputs.categories.includes('destructive_action') && !impactInputs.rollbackPlan) {
    validation.push('approval.impact.destructive_action.rollback_plan_required');
  }
  if (impactInputs.backupProof && !DIGEST_PATTERN.test(impactInputs.backupProof)) {
    validation.push('approval.impact.destructive_action.backup_proof.sha256_required');
  }

  return {
    applies: impactInputs.categories.includes('destructive_action'),
    targets: impactInputs.destructiveTargets,
    rollbackPlan: impactInputs.rollbackPlan,
    backupProof: impactInputs.backupProof,
    acknowledgement,
    irreversible: raw.irreversible === true || raw.recoverable === false,
    validation,
    proof: `sha256:${proofFor({
      requestId: request.id,
      targets: impactInputs.destructiveTargets,
      rollbackPlan: impactInputs.rollbackPlan,
      backupProof: impactInputs.backupProof,
      irreversible: raw.irreversible === true || raw.recoverable === false
    })}`
  };
}

function normalizeKernelChangeContract(raw, request, impactInputs) {
  const kernelChange = impactInputs.kernelChange;
  const subsystem = asString(kernelChange.subsystem || kernelChange.component || raw.kernelSubsystem);
  const privilegeScope = normalizeScope(kernelChange.privilegeScope || kernelChange.scope || raw.kernelPrivilegeScope);
  const changeWindow = asString(kernelChange.changeWindow || kernelChange.window || raw.kernelChangeWindow);
  const approverGroup = asString(kernelChange.approverGroup || kernelChange.ownerGroup || raw.kernelApproverGroup);
  const configDigest = asString(kernelChange.configDigest || kernelChange.digest || raw.kernelConfigDigest);
  const validation = [];

  if (impactInputs.categories.includes('privileged_kernel_change') && !subsystem) {
    validation.push('approval.impact.privileged_kernel_change.subsystem_required');
  }
  if (impactInputs.categories.includes('privileged_kernel_change') && privilegeScope.length === 0) {
    validation.push('approval.impact.privileged_kernel_change.privilege_scope_required');
  }
  if (impactInputs.categories.includes('privileged_kernel_change') && !changeWindow) {
    validation.push('approval.impact.privileged_kernel_change.change_window_required');
  }
  if (configDigest && !DIGEST_PATTERN.test(configDigest)) {
    validation.push('approval.impact.privileged_kernel_change.config_digest.sha256_required');
  }

  return {
    applies: impactInputs.categories.includes('privileged_kernel_change'),
    subsystem,
    privilegeScope,
    changeWindow,
    approverGroup,
    configDigest,
    validation,
    proof: `sha256:${proofFor({
      requestId: request.id,
      subsystem,
      privilegeScope,
      changeWindow,
      approverGroup,
      configDigest
    })}`
  };
}

function strongestRequiredRole(roles) {
  return roles.reduce((strongest, role) => (
    roleMeets(role, strongest) ? role : strongest
  ), 'viewer');
}

function highestRisk(risks) {
  return risks.reduce((highest, risk) => (
    RISK_ORDER[risk] > RISK_ORDER[highest] ? risk : highest
  ), 'low');
}

function buildApprovalImpactContract(raw, request) {
  const impactInputs = collectApprovalImpactInputs(raw, request);
  const requirements = impactInputs.categories.map((category) => IMPACT_REQUIREMENTS[category]);
  const externalWriteContract = normalizeExternalWriteContract(raw, request, impactInputs);
  const destructiveActionContract = normalizeDestructiveActionContract(raw, request, impactInputs);
  const privilegedKernelChangeContract = normalizeKernelChangeContract(raw, request, impactInputs);
  const requiredScopes = [...new Set(requirements.flatMap((requirement) => requirement.requiredScopes))];
  const requiredRole = requirements.length
    ? strongestRequiredRole(requirements.map((requirement) => requirement.minRole))
    : RISK_MIN_ROLE[request.risk] || 'approver';
  const minimumRisk = requirements.length
    ? highestRisk(requirements.map((requirement) => requirement.minRisk))
    : request.risk;
  const missingScopeContracts = requiredScopes.filter((scopeEntry) => (
    !request.scope.some((requestScope) => hasCapability(scopeEntry, [requestScope]))
  ));
  const validation = [
    ...(RISK_ORDER[request.risk] < RISK_ORDER[minimumRisk] ? [`approval.impact.risk.${minimumRisk}_required`] : []),
    ...missingScopeContracts.map((scopeEntry) => `approval.impact.scope_required:${scopeEntry}`),
    ...externalWriteContract.validation,
    ...destructiveActionContract.validation,
    ...privilegedKernelChangeContract.validation
  ];

  return {
    format: 'approval-console.approval-impact.v1',
    categories: impactInputs.categories,
    labels: impactInputs.categories.map((category) => IMPACT_REQUIREMENTS[category].label),
    primaryCategory: impactInputs.categories[0] || 'standard_approval',
    externalWrite: impactInputs.categories.includes('external_write'),
    destructiveAction: impactInputs.categories.includes('destructive_action'),
    privilegedKernelChange: impactInputs.categories.includes('privileged_kernel_change'),
    externalTargets: impactInputs.externalTargets,
    destructiveTargets: impactInputs.destructiveTargets,
    externalWriteContract,
    destructiveActionContract,
    privilegedKernelChangeContract,
    requiredRole,
    minimumRisk,
    requiresProof: requirements.some((requirement) => requirement.requiresProof),
    requiredScopes,
    missingScopeContracts,
    contractComplete: validation.length === 0,
    detectionReasons: impactInputs.detectionReasons,
    validation,
    proof: `sha256:${proofFor({
      requestId: request.id,
      action: request.action,
      target: request.target,
      categories: impactInputs.categories,
      externalWriteContract,
      destructiveActionContract,
      privilegedKernelChangeContract,
      requiredRole,
      minimumRisk,
      requiredScopes
    })}`
  };
}

function evaluateBoundaryPolicy(request, clientState) {
  const validation = [];
  const requiredRole = strongestRequiredRole([
    RISK_MIN_ROLE[request.risk] || 'approver',
    request.impact?.requiredRole || 'viewer'
  ]);
  const transition = request.boundaryTransition;
  const targetTenantId = transition?.target.tenantId || request.tenantId || clientState.boundary.tenantId;
  const targetWorkspaceId = transition?.target.workspaceId || request.workspaceId || clientState.boundary.workspaceId;
  const permissionGrant = evaluatePermissionBindings(request, clientState, targetTenantId, targetWorkspaceId, requiredRole);
  const workspaceScope = buildWorkspaceScopeContract(
    request,
    clientState,
    targetTenantId,
    targetWorkspaceId,
    permissionGrant,
    requiredRole
  );

  if (targetTenantId !== clientState.boundary.tenantId && !clientState.boundary.allowCrossTenant) {
    validation.push('approval.boundary.tenant_mismatch');
  }
  if (targetWorkspaceId !== clientState.boundary.workspaceId && !clientState.boundary.allowCrossWorkspace) {
    validation.push('approval.boundary.workspace_mismatch');
  }
  if ((request.state === 'approved' || request.decision === 'approve') && !roleMeets(clientState.operator.strongestRole, requiredRole)) {
    validation.push(`approval.role.${requiredRole}_required`);
  }
  if (request.scope.length === 0) {
    validation.push('approval.scope.required');
  }
  if (transition) {
    validation.push(...transition.validation);
  }
  if (request.impact) {
    validation.push(...request.impact.validation);
  }

  const availableCapabilities = [...new Set([
    ...clientState.capabilities,
    ...clientState.operator.permissions,
    ...permissionGrant.grantedPermissions
  ])];
  const deniedScopes = request.scope.filter((scopeEntry) => !hasCapability(scopeEntry, availableCapabilities));
  if (deniedScopes.length) {
    validation.push('approval.scope.capability_not_granted');
  }
  if (permissionGrant.required || permissionGrant.configured) {
    validation.push(...permissionGrant.validation);
  }
  validation.push(...workspaceScope.validation);

  return {
    requiredRole,
    operatorRole: clientState.operator.strongestRole,
    isolationKey: `${targetTenantId}:${targetWorkspaceId}`,
    tenantId: targetTenantId,
    workspaceId: targetWorkspaceId,
    grantedScopes: request.scope.filter((scopeEntry) => !deniedScopes.includes(scopeEntry)),
    deniedScopes,
    permissionGrant,
    workspaceScope,
    boundaryTransition: transition,
    boundaryClear: validation.length === 0,
    validation
  };
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function proofFor(payload) {
  return createHash('sha256').update(stableJson(payload)).digest('hex');
}

function approvalIntentDigestPayload(intent) {
  return {
    id: intent.requestId || intent.id,
    action: intent.action,
    target: intent.target,
    proofRequired: intent.proofRequired === true || intent.requiresProof === true,
    isolationKey: intent.isolationKey,
    boundaryTransitionProof: intent.boundaryTransition?.proof || ''
  };
}

function lifecycleIntentDigestPayload(intent) {
  return {
    id: intent.commandId || intent.id,
    command: intent.command,
    targetState: intent.targetState,
    scheduledFor: intent.scheduledFor,
    proofRequired: intent.proofRequired === true || intent.requiresProof === true,
    isolationKey: intent.isolationKey
  };
}

function normalizeEvidenceType(value) {
  const type = asString(value, 'operator-note').toLowerCase();
  return EVIDENCE_TYPES.has(type) ? type : 'operator-note';
}

function normalizeEvidenceItems(value, now, defaultSubjectId = '') {
  const source = Array.isArray(value) ? value : value ? [value] : [];
  return source.map((entry, index) => {
    const raw = asObject(entry);
    const subjectRequestId = asString(
      raw.subjectRequestId || raw.requestId || raw.approvalId,
      defaultSubjectId
    );
    const createdAt = asString(raw.createdAt || raw.at, now);
    const createdMs = parseTime(createdAt);
    const material = {
      subjectRequestId,
      type: normalizeEvidenceType(raw.type || raw.kind),
      source: asString(raw.source || raw.system, 'operator-userland/approval-console'),
      uri: asString(raw.uri || raw.url),
      digest: asString(raw.digest || raw.proof),
      summary: asString(raw.summary || raw.note || raw.reason)
    };
    const validation = [];

    if (!subjectRequestId) {
      validation.push('evidence.subject.required');
    }
    if (createdAt && createdMs === null) {
      validation.push('evidence.createdAt.invalid');
    }
    if (!material.uri && !material.digest && !material.summary) {
      validation.push('evidence.material.required');
    }
    if (material.digest && !DIGEST_PATTERN.test(material.digest)) {
      validation.push('evidence.digest.sha256_required');
    }

    return {
      id: asString(raw.id, `${subjectRequestId || 'global'}:evidence:${index + 1}`),
      ...material,
      createdAt,
      valid: validation.length === 0,
      validation,
      proof: `sha256:${proofFor({ ...material, createdAt })}`
    };
  });
}

function buildProofBundle(request, evidence, boundaryPolicy, now) {
  const matchingEvidence = evidence.filter((entry) => (
    entry.subjectRequestId === request.id || entry.subjectRequestId === request.clientRequestId
  ));
  const evidenceValidation = matchingEvidence.flatMap((entry) => entry.validation);
  const acceptedEvidence = matchingEvidence.filter((entry) => entry.valid);
  const required = request.requiresProof;
  const status = !required
    ? acceptedEvidence.length
      ? 'attached'
      : 'not_required'
    : acceptedEvidence.length
      ? 'satisfied'
      : 'missing';
  const payload = {
    requestId: request.id,
    clientRequestId: request.clientRequestId,
    required,
    status,
    action: request.action,
    target: request.target,
    risk: request.risk,
    state: request.state,
    decision: request.decision,
    isolationKey: boundaryPolicy.isolationKey,
    evidenceIds: acceptedEvidence.map((entry) => entry.id),
    generatedAt: now
  };

  return {
    format: 'approval-console.proof-bundle.v1',
    required,
    status,
    evidenceIds: matchingEvidence.map((entry) => entry.id),
    acceptedEvidenceIds: acceptedEvidence.map((entry) => entry.id),
    rejectedEvidenceIds: matchingEvidence
      .filter((entry) => !entry.valid)
      .map((entry) => entry.id),
    validation: [
      ...evidenceValidation,
      ...(required && acceptedEvidence.length === 0 ? ['approval.proof.evidence_required'] : [])
    ],
    proof: `sha256:${proofFor(payload)}`
  };
}

function normalizeWorkflowAcceptance(raw, request, impact, clientState, now) {
  const source = asObject(
    raw.workflowAcceptance
    || raw.handoffAcceptance
    || raw.operatorWorkflowAcceptance
    || raw.dispatchAcceptance
  );
  const acceptedImpactCategories = normalizeScope(
    source.acceptedImpactCategories
    || source.impactCategories
    || source.acceptedImpacts
  ).map(normalizeImpactType).filter(Boolean);
  const handoffMode = asString(source.handoffMode || source.mode || raw.handoffMode).toLowerCase();
  const dispatchLane = asString(source.dispatchLane || source.lane || raw.dispatchLane).toLowerCase();
  const acceptedBy = asString(source.acceptedBy || source.operatorId || request.decidedBy, clientState.operator.id);
  const acceptedAt = asString(source.acceptedAt || source.at || source.reviewedAt);
  const acceptedAtMs = acceptedAt ? parseTime(acceptedAt) : null;
  const proof = asString(source.proof || source.digest || source.acceptanceProof);
  const required = request.state === 'approved' && impact.categories.length > 0;
  const acceptanceStarted = Boolean(acceptedImpactCategories.length || handoffMode || dispatchLane || proof || acceptedAt);
  const validateAcceptance = required || acceptanceStarted;
  const missingCategories = impact.categories.filter((category) => !acceptedImpactCategories.includes(category));
  const modeViolations = impact.categories.filter((category) => (
    handoffMode && !PROVIDER_IMPACT_RULES[category].allowedHandoffModes.includes(handoffMode)
  ));
  const laneViolations = impact.categories.filter((category) => (
    dispatchLane && !PROVIDER_IMPACT_RULES[category].allowedDispatchLanes.includes(dispatchLane)
  ));
  const validation = [
    ...(required && !acceptedBy ? ['approval.workflow.acceptance.acceptedBy_required'] : []),
    ...(required && !acceptedAt ? ['approval.workflow.acceptance.acceptedAt_required'] : []),
    ...(required && !handoffMode ? ['approval.workflow.acceptance.handoffMode_required'] : []),
    ...(required && !dispatchLane ? ['approval.workflow.acceptance.dispatchLane_required'] : []),
    ...(acceptedAt && acceptedAtMs === null ? ['approval.workflow.acceptance.acceptedAt.invalid'] : []),
    ...(required && acceptedImpactCategories.length === 0 ? ['approval.workflow.acceptance.impact_categories_required'] : []),
    ...(validateAcceptance ? missingCategories.map((category) => `approval.workflow.acceptance.impact_not_accepted:${category}`) : []),
    ...modeViolations.map((category) => `approval.workflow.acceptance.handoffMode_not_allowed:${category}`),
    ...laneViolations.map((category) => `approval.workflow.acceptance.dispatchLane_not_allowed:${category}`),
    ...(proof && !DIGEST_PATTERN.test(proof) ? ['approval.workflow.acceptance.proof.sha256_required'] : [])
  ];
  const proofPayload = {
    requestId: request.id,
    clientRequestId: request.clientRequestId,
    acceptedBy,
    acceptedAt,
    acceptedImpactCategories,
    handoffMode,
    dispatchLane,
    impactProof: impact.proof
  };

  return {
    format: 'approval-console.workflow-acceptance.v1',
    required,
    accepted: required ? validation.length === 0 : acceptanceStarted && validation.length === 0,
    acceptedBy,
    acceptedAt,
    acceptedImpactCategories,
    missingImpactCategories: missingCategories,
    handoffMode,
    dispatchLane,
    allowedHandoffModes: [...new Set(impact.categories.flatMap((category) => PROVIDER_IMPACT_RULES[category].allowedHandoffModes))],
    allowedDispatchLanes: [...new Set(impact.categories.flatMap((category) => PROVIDER_IMPACT_RULES[category].allowedDispatchLanes))],
    proof,
    validation,
    acceptanceProof: `sha256:${proofFor(proofPayload)}`
  };
}

function buildApprovalWorkflowHandoff(approval, clientState, now) {
  const boundaryBlocked = !approval.boundaryPolicy.boundaryClear;
  const proofBlocked = approval.proofBundle.required && approval.proofBundle.status !== 'satisfied';
  const workflowAcceptanceBlocked = approval.workflowAcceptance.required && !approval.workflowAcceptance.accepted;
  const decisionNeeded = approval.state === 'requested';
  const approved = approval.valid && approval.state === 'approved';
  const deniedOrClosed = approval.state === 'denied' || approval.state === 'expired' || approval.state === 'cancelled';
  const resumeCandidate = approved && !boundaryBlocked && !proofBlocked && !workflowAcceptanceBlocked;
  const handoffBlocks = [
    ...approval.validation,
    ...(boundaryBlocked ? ['approval.workflow.boundary_hold'] : []),
    ...(proofBlocked ? ['approval.workflow.proof_required'] : []),
    ...(workflowAcceptanceBlocked ? [
      'approval.workflow.acceptance_required',
      ...approval.workflowAcceptance.validation
    ] : []),
    ...(decisionNeeded ? ['approval.workflow.operator_decision_required'] : [])
  ];
  const hardBlocks = handoffBlocks.filter((reason) => reason !== 'approval.workflow.operator_decision_required');
  const nextAction = deniedOrClosed
    ? `observe-${approval.state}`
    : boundaryBlocked
      ? 'repair-boundary-before-decision'
      : proofBlocked
        ? 'attach-proof-before-runtime-handoff'
        : workflowAcceptanceBlocked
          ? 'accept-impact-workflow-handoff'
        : decisionNeeded
          ? 'collect-operator-decision'
          : resumeCandidate
            ? 'stage-runtime-resume-preview'
            : 'repair-approval-contract';
  const displayState = deniedOrClosed
    ? 'closed'
    : resumeCandidate
      ? 'ready'
      : hardBlocks.length
        ? 'blocked'
        : 'waiting';
  const payload = {
    surfaceId,
    generatedAt: now,
    requestId: approval.id,
    clientRequestId: approval.clientRequestId,
    route: clientState.route,
    destination: clientState.handoffDestination,
    isolationKey: approval.boundaryPolicy.isolationKey,
    nextAction,
    displayState,
    proof: approval.proofBundle.proof,
    transitionProof: approval.boundaryTransition.proof,
    impactProof: approval.impact.proof,
    workflowAcceptanceProof: approval.workflowAcceptance.acceptanceProof,
    workspaceScopeProof: approval.boundaryPolicy.workspaceScope.proof
  };

  return {
    format: 'approval-console.approval-workflow-handoff.v1',
    requestId: approval.id,
    clientRequestId: approval.clientRequestId,
    previewId: `approval:${approval.id}`,
    route: clientState.route,
    destination: clientState.handoffDestination,
    isolationKey: approval.boundaryPolicy.isolationKey,
    nextAction,
    displayState,
    resumeCandidate,
    decisionRequired: decisionNeeded,
    operator: {
      id: clientState.operator.id,
      requiredRole: approval.boundaryPolicy.requiredRole,
      actualRole: approval.boundaryPolicy.operatorRole,
      roleSatisfied: roleMeets(approval.boundaryPolicy.operatorRole, approval.boundaryPolicy.requiredRole)
    },
    gates: {
      boundary: boundaryBlocked ? 'blocked' : 'passed',
      proof: proofBlocked ? 'blocked' : approval.proofBundle.required ? 'passed' : 'not_required',
      decision: decisionNeeded ? 'waiting' : approval.decision ? 'passed' : deniedOrClosed ? 'closed' : 'waiting',
      workflowAcceptance: workflowAcceptanceBlocked ? 'blocked' : approval.workflowAcceptance.required ? 'passed' : 'not_required',
      workspaceScope: approval.boundaryPolicy.workspaceScope.safeForHandoff ? 'passed' : 'blocked',
      runtime: resumeCandidate ? 'ready' : 'waiting'
    },
    handoffBlocks,
    hardBlocks,
    auditRefs: {
      proofBundleProof: approval.proofBundle.proof,
      boundaryTransitionProof: approval.boundaryTransition.proof,
      workspaceScopeProof: approval.boundaryPolicy.workspaceScope.proof,
      approvalImpactProof: approval.impact.proof,
      workflowAcceptanceProof: approval.workflowAcceptance.acceptanceProof,
      permissionBoundaryProof: clientState.permissionBoundary.proof,
      acceptedEvidenceIds: approval.proofBundle.acceptedEvidenceIds
    },
    workspaceScope: {
      format: approval.boundaryPolicy.workspaceScope.format,
      scopeClass: approval.boundaryPolicy.workspaceScope.scopeClass,
      source: approval.boundaryPolicy.workspaceScope.source,
      target: approval.boundaryPolicy.workspaceScope.target,
      requiresExplicitGrant: approval.boundaryPolicy.workspaceScope.requiresExplicitGrant,
      activeBindingIds: approval.boundaryPolicy.workspaceScope.activeBindingIds,
      deniedScopes: approval.boundaryPolicy.workspaceScope.deniedScopes,
      repairReasons: approval.boundaryPolicy.workspaceScope.validation,
      proof: approval.boundaryPolicy.workspaceScope.proof
    },
    workflowAcceptance: approval.workflowAcceptance,
    userVisibleWorkflow: {
      primaryAction: nextAction === 'stage-runtime-resume-preview'
        ? 'Review runtime resume preview'
        : nextAction === 'collect-operator-decision'
          ? 'Record approval decision'
          : nextAction === 'attach-proof-before-runtime-handoff'
            ? 'Attach required proof'
            : nextAction === 'accept-impact-workflow-handoff'
              ? 'Accept impact handoff'
            : nextAction === 'repair-boundary-before-decision'
              ? 'Repair tenant boundary hold'
              : deniedOrClosed
                ? `Observe ${approval.state} approval`
                : 'Repair approval request',
      label: resumeCandidate
        ? `${approval.action} is ready for hosted-kernel resume`
        : decisionNeeded
          ? `${approval.action} needs an operator decision`
          : proofBlocked
            ? `${approval.action} needs proof before handoff`
      : workflowAcceptanceBlocked
        ? `${approval.action} needs impact handoff acceptance`
        : !approval.boundaryPolicy.workspaceScope.safeForHandoff
          ? `${approval.action} needs workspace scope repair`
        : boundaryBlocked
          ? `${approval.action} is held by tenant/workspace policy`
              : `${approval.action} cannot be handed off yet`,
      destinationLabel: clientState.handoffDestination
    },
    proof: `sha256:${proofFor(payload)}`
  };
}

function approvalPreviewReviewSections(approval) {
  const previewId = `approval:${approval.id}`;
  const sections = [{
    id: `${previewId}:summary`,
    kind: 'summary',
    title: 'Approval summary',
    required: approval.workflowHandoff.resumeCandidate,
    proofRef: approval.workflowHandoff.proof,
    validation: [],
    operatorPrompt: 'Review requested action, target, risk, and tenant workspace boundary.'
  }];
  const workspaceScope = approval.boundaryPolicy.workspaceScope;
  sections.push({
    id: `${previewId}:workspace-scope`,
    kind: 'workspace_scope',
    title: 'Workspace scope boundary',
    required: approval.workflowHandoff.resumeCandidate || !workspaceScope.safeForHandoff,
    proofRef: workspaceScope.proof,
    validation: workspaceScope.validation,
    operatorPrompt: workspaceScope.safeForHandoff
      ? 'Confirm target tenant/workspace scope before runtime handoff.'
      : 'Repair workspace scope grants before runtime handoff.',
    fields: {
      scopeClass: workspaceScope.scopeClass,
      sourceIsolationKey: workspaceScope.source.isolationKey,
      targetIsolationKey: workspaceScope.target.isolationKey,
      requiresExplicitGrant: workspaceScope.requiresExplicitGrant,
      activeBindingIds: workspaceScope.activeBindingIds,
      deniedScopes: workspaceScope.deniedScopes,
      repairActions: workspaceScope.operatorRepairHints.map((hint) => hint.action)
    }
  });

  if (approval.impact.externalWrite) {
    const contract = approval.impact.externalWriteContract;
    sections.push({
      id: `${previewId}:impact:external_write`,
      kind: 'external_write',
      title: IMPACT_PREVIEW_SECTION_COPY.external_write.title,
      required: approval.workflowHandoff.resumeCandidate,
      proofRef: approval.impact.proof,
      validation: contract.validation,
      operatorPrompt: IMPACT_PREVIEW_SECTION_COPY.external_write.operatorPrompt,
      fields: {
        targets: contract.targets,
        writeMode: contract.writeMode,
        payloadClass: contract.payloadClass,
        endpointProof: contract.endpointProof,
        idempotencyKey: contract.idempotencyKey
      }
    });
  }

  if (approval.impact.destructiveAction) {
    const contract = approval.impact.destructiveActionContract;
    sections.push({
      id: `${previewId}:impact:destructive_action`,
      kind: 'destructive_action',
      title: IMPACT_PREVIEW_SECTION_COPY.destructive_action.title,
      required: true,
      proofRef: contract.proof,
      validation: contract.validation,
      operatorPrompt: IMPACT_PREVIEW_SECTION_COPY.destructive_action.operatorPrompt,
      fields: {
        targets: contract.targets,
        rollbackPlan: contract.rollbackPlan,
        backupProof: contract.backupProof,
        irreversible: contract.irreversible,
        acknowledgement: contract.acknowledgement
      }
    });
  }

  if (approval.impact.privilegedKernelChange) {
    const contract = approval.impact.privilegedKernelChangeContract;
    sections.push({
      id: `${previewId}:impact:privileged_kernel_change`,
      kind: 'privileged_kernel_change',
      title: IMPACT_PREVIEW_SECTION_COPY.privileged_kernel_change.title,
      required: true,
      proofRef: contract.proof,
      validation: contract.validation,
      operatorPrompt: IMPACT_PREVIEW_SECTION_COPY.privileged_kernel_change.operatorPrompt,
      fields: {
        subsystem: contract.subsystem,
        privilegeScope: contract.privilegeScope,
        changeWindow: contract.changeWindow,
        approverGroup: contract.approverGroup,
        configDigest: contract.configDigest
      }
    });
  }

  return sections.map((section) => ({
    ...section,
    acceptedWhen: section.required
      ? 'operator must include section id in previewAcceptance.acceptedSectionIds'
      : 'optional context section',
    proof: `sha256:${proofFor({
      requestId: approval.id,
      sectionId: section.id,
      kind: section.kind,
      required: section.required,
      proofRef: section.proofRef,
      fields: section.fields || {}
    })}`
  }));
}

function parseTime(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function incrementCounter(counters, key, amount = 1) {
  counters[key] = (counters[key] || 0) + amount;
}

function firstNonNull(values) {
  return values.find((value) => value !== null && value !== undefined) ?? null;
}

function normalizeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function severityForReason(reason) {
  if (reason.includes('.failed_intent') || reason.includes('checkpoint_repair_required')) {
    return 'critical';
  }
  if (reason.includes('provider.') || reason.includes('persistence.') || reason.includes('proof.')) {
    return 'blocked';
  }
  if (reason.includes('boundary.') || reason.includes('permission.')) {
    return 'degraded';
  }
  if (reason.includes('sync') || reason.includes('preview.acceptance')) {
    return 'warning';
  }
  return 'warning';
}

function strongestSeverity(severities) {
  return severities.reduce((strongest, severity) => (
    FAILURE_SEVERITY_ORDER[severity] > FAILURE_SEVERITY_ORDER[strongest] ? severity : strongest
  ), 'info');
}

function normalizeRetryPolicy(input) {
  const raw = asObject(input.retryPolicy || input.healthRetryPolicy || input.runtimeRetry);
  return {
    baseDelayMs: normalizePositiveNumber(raw.baseDelayMs || raw.baseDelay || raw.initialDelayMs, RETRY_DEFAULTS.baseDelayMs),
    maxDelayMs: normalizePositiveNumber(raw.maxDelayMs || raw.maxDelay, RETRY_DEFAULTS.maxDelayMs),
    maxAttempts: normalizeInteger(raw.maxAttempts || raw.attemptLimit, RETRY_DEFAULTS.maxAttempts)
  };
}

function computeRetryWindow(now, attempts, retryPolicy) {
  const cappedAttempts = Math.min(Math.max(attempts, 0), 10);
  const delayMs = Math.min(retryPolicy.maxDelayMs, retryPolicy.baseDelayMs * 2 ** cappedAttempts);
  const nowMs = parseTime(now);
  return {
    attempts,
    delayMs,
    nextRetryAt: nowMs === null ? '' : new Date(nowMs + delayMs).toISOString(),
    retryable: attempts < retryPolicy.maxAttempts,
    exhausted: attempts >= retryPolicy.maxAttempts
  };
}

function normalizeOperationalHealthSlo(input) {
  const raw = asObject(input.operationalHealth || input.health || input.healthSlo);
  return {
    providerSyncStaleMs: normalizePositiveNumber(raw.providerSyncStaleMs || raw.syncStaleMs, 10 * 60_000),
    ackGraceMs: normalizePositiveNumber(raw.ackGraceMs || raw.acknowledgementGraceMs, 2 * 60_000),
    maxRetryQueueDepth: normalizeInteger(raw.maxRetryQueueDepth || raw.retryQueueDepth, 25),
    maxActionableErrors: normalizeInteger(raw.maxActionableErrors || raw.errorLimit, 12)
  };
}

function retryBudgetByKind(retryQueue) {
  return Object.values(retryQueue.reduce((groups, entry) => {
    const existing = groups[entry.kind] || {
      kind: entry.kind,
      queued: 0,
      retryable: 0,
      exhausted: 0,
      nextRetryAt: ''
    };
    const currentNextMs = existing.nextRetryAt ? parseTime(existing.nextRetryAt) : null;
    const entryNextMs = entry.nextRetryAt ? parseTime(entry.nextRetryAt) : null;
    existing.queued += 1;
    existing.retryable += entry.retryable ? 1 : 0;
    existing.exhausted += entry.exhausted ? 1 : 0;
    if (entryNextMs !== null && (currentNextMs === null || entryNextMs < currentNextMs)) {
      existing.nextRetryAt = entry.nextRetryAt;
    }
    groups[entry.kind] = existing;
    return groups;
  }, {})).sort((left, right) => left.kind.localeCompare(right.kind));
}

function buildOperationalCircuitBreaker(now, status, failureStates, retryQueue, providerIntegration, clientRuntimeHandoff, healthSlo) {
  const nowMs = parseTime(now);
  const retryDue = retryQueue.filter((entry) => {
    const retryMs = entry.nextRetryAt ? parseTime(entry.nextRetryAt) : null;
    return entry.retryable && retryMs !== null && nowMs !== null && retryMs <= nowMs;
  });
  const exhausted = retryQueue.filter((entry) => entry.exhausted);
  const contractFailures = failureStates.filter((failure) => (
    failure.code === 'provider.capability.missing'
    || failure.code === 'provider.protocol.unsupported'
    || failure.code.includes('checkpoint_repair_required')
  ));
  const queueOverLimit = retryQueue.length > healthSlo.maxRetryQueueDepth;
  const state = status === 'critical' || exhausted.length || contractFailures.length || queueOverLimit
    ? 'open'
    : status === 'degraded' || status === 'blocked'
      ? retryDue.length
        ? 'half_open'
        : 'cooling_down'
      : 'closed';
  const suppressExternalHandoff = state === 'open'
    || providerIntegration.externalHandoff.state !== 'ready_for_external_handoff'
    || clientRuntimeHandoff.blockedReasons.length > 0;

  return {
    format: 'approval-console.operational-circuit-breaker.v1',
    state,
    suppressExternalHandoff,
    retryDueIds: retryDue.map((entry) => entry.id),
    exhaustedRetryIds: exhausted.map((entry) => entry.id),
    contractFailureCodes: contractFailures.map((failure) => failure.code),
    queueOverLimit,
    resetCondition: state === 'open'
      ? 'repair-contract-or-exhausted-retry-before-dispatch'
      : state === 'half_open'
        ? 'run-due-retry-and-refresh-provider-state'
        : state === 'cooling_down'
          ? 'wait-until-next-retry-window'
          : 'none',
    proof: `sha256:${proofFor({
      state,
      suppressExternalHandoff,
      retryDueIds: retryDue.map((entry) => entry.id),
      exhaustedRetryIds: exhausted.map((entry) => entry.id),
      externalState: providerIntegration.externalHandoff.state,
      nextAction: clientRuntimeHandoff.nextAction
    })}`
  };
}

function buildDegradedCapabilityMatrix(status, circuitBreaker, providerIntegration, persistedStateUpdate) {
  const providerDispatchReady = providerIntegration.externalHandoff.state === 'ready_for_external_handoff'
    && !circuitBreaker.suppressExternalHandoff;
  const checkpointWritable = persistedStateUpdate.commitStatus === 'commit_checkpoint'
    && persistedStateUpdate.validation.length === 0;

  return {
    format: 'approval-console.degraded-capabilities.v1',
    operatorReview: status !== 'critical',
    evidenceAttachment: status !== 'critical' && circuitBreaker.state !== 'open',
    previewAcceptance: status === 'healthy' || status === 'attention_required' || status === 'degraded',
    providerSyncRefresh: providerIntegration.negotiation.syncRequiredProviderIds.length > 0,
    providerAcknowledgement: providerIntegration.negotiation.ackRequiredProviderIds.length > 0,
    externalRuntimeDispatch: providerDispatchReady,
    checkpointCommit: checkpointWritable,
    readOnlyAuditExport: status === 'critical' || circuitBreaker.state === 'open',
    blockedCapabilities: [
      ...(!providerDispatchReady ? ['externalRuntimeDispatch'] : []),
      ...(!checkpointWritable ? ['checkpointCommit'] : []),
      ...(status === 'critical' ? ['operatorReview', 'evidenceAttachment'] : []),
      ...(circuitBreaker.state === 'open' ? ['evidenceAttachment'] : [])
    ],
    proof: `sha256:${proofFor({
      status,
      circuitState: circuitBreaker.state,
      providerDispatchReady,
      checkpointWritable,
      externalState: providerIntegration.externalHandoff.state
    })}`
  };
}

function buildImpactDegradedModePolicy(status, circuitBreaker, approvals, providerIntegration, persistedStateUpdate, retryQueue) {
  const degradedOrBlocked = status !== 'healthy' || circuitBreaker.state !== 'closed';
  const providerReady = providerIntegration.externalHandoff.state === 'ready_for_external_handoff'
    && !circuitBreaker.suppressExternalHandoff;
  const stagedImpactCommands = persistedStateUpdate.nextCheckpoint.impactCommands
    .filter((entry) => entry.status === 'staged');
  const failedImpactCommands = persistedStateUpdate.nextCheckpoint.impactCommands
    .filter((entry) => entry.status === 'failed');
  const retryByImpact = retryQueue.filter((entry) => entry.kind === 'impact-command');
  const requestPolicies = approvals
    .filter((approval) => approval.impact.categories.length > 0)
    .map((approval) => {
      const stagedCategories = stagedImpactCommands
        .filter((entry) => entry.requestId === approval.id)
        .map((entry) => entry.category);
      const failedCategories = failedImpactCommands
        .filter((entry) => entry.requestId === approval.id)
        .map((entry) => entry.category);
      const retryEntries = retryByImpact.filter((entry) => (
        entry.id.includes(`:${approval.id}`)
        || entry.target.includes(approval.id)
      ));
      const destructiveOrKernel = approval.impact.destructiveAction || approval.impact.privilegedKernelChange;
      const externalOnly = approval.impact.externalWrite && !destructiveOrKernel;
      const manualExportAllowed = degradedOrBlocked
        && approval.valid
        && approval.state === 'approved'
        && destructiveOrKernel
        && approval.workflowAcceptance.accepted
        && approval.proofBundle.status === 'satisfied';
      const dispatchAllowed = !degradedOrBlocked
        && providerReady
        && approval.workflowHandoff.resumeCandidate
        && stagedCategories.length === 0
        && failedCategories.length === 0;
      const blockedReasons = [
        ...(degradedOrBlocked ? ['impact.degraded_mode.active'] : []),
        ...(!providerReady ? ['impact.provider_dispatch_not_ready'] : []),
        ...(!approval.workflowHandoff.resumeCandidate ? ['impact.workflow_not_resume_candidate'] : []),
        ...stagedCategories.map((category) => `impact.command.staged:${category}`),
        ...failedCategories.map((category) => `impact.command.failed:${category}`),
        ...(retryEntries.some((entry) => entry.exhausted) ? ['impact.retry_budget_exhausted'] : []),
        ...(approval.impact.privilegedKernelChange && circuitBreaker.state !== 'closed' ? ['impact.kernel_change.requires_closed_circuit'] : []),
        ...(approval.impact.destructiveAction && degradedOrBlocked ? ['impact.destructive_action.requires_operator_export'] : [])
      ];
      const allowedDegradedActions = [
        'review-impact-contract',
        'attach-proof-evidence',
        ...(externalOnly ? ['refresh-provider-sync'] : []),
        ...(manualExportAllowed ? ['export-manual-impact-packet'] : []),
        ...(retryEntries.some((entry) => entry.retryable && !entry.exhausted) ? ['queue-impact-command-retry'] : [])
      ];

      return {
        requestId: approval.id,
        clientRequestId: approval.clientRequestId,
        categories: approval.impact.categories,
        state: approval.state,
        risk: approval.risk,
        dispatchAllowed,
        manualExportAllowed,
        degradedReviewOnly: degradedOrBlocked && !manualExportAllowed,
        stagedImpactCategories: stagedCategories,
        failedImpactCategories: failedCategories,
        retryQueueIds: retryEntries.map((entry) => entry.id),
        nextRetryAt: retryEntries
          .map((entry) => entry.nextRetryAt)
          .filter(Boolean)
          .sort()[0] || '',
        blockedReasons,
        allowedDegradedActions,
        operatorAction: dispatchAllowed
          ? 'dispatch-impact-command'
          : manualExportAllowed
            ? 'export-manual-impact-packet'
            : blockedReasons.includes('impact.retry_budget_exhausted')
              ? 'repair-impact-command-before-retry-reset'
              : approval.impact.privilegedKernelChange
                ? 'restore-closed-circuit-before-kernel-change'
                : approval.impact.destructiveAction
                  ? 'hold-destructive-action-for-manual-export'
                  : 'repair-impact-provider-readiness'
      };
    });
  const blockedRequestIds = requestPolicies
    .filter((policy) => !policy.dispatchAllowed)
    .map((policy) => policy.requestId);
  const manualExportRequestIds = requestPolicies
    .filter((policy) => policy.manualExportAllowed)
    .map((policy) => policy.requestId);

  return {
    format: 'approval-console.impact-degraded-mode-policy.v1',
    active: degradedOrBlocked && requestPolicies.length > 0,
    providerReady,
    circuitState: circuitBreaker.state,
    blockedRequestIds,
    manualExportRequestIds,
    dispatchAllowedRequestIds: requestPolicies
      .filter((policy) => policy.dispatchAllowed)
      .map((policy) => policy.requestId),
    reviewOnlyRequestIds: requestPolicies
      .filter((policy) => policy.degradedReviewOnly)
      .map((policy) => policy.requestId),
    requestPolicies,
    operatorSummary: blockedRequestIds.length
      ? `${blockedRequestIds.length} impact approval${blockedRequestIds.length === 1 ? '' : 's'} held by degraded-mode guardrails`
      : requestPolicies.length
        ? 'Impact approvals are dispatchable'
        : 'No impact approvals pending',
    proof: `sha256:${proofFor({
      status,
      circuitState: circuitBreaker.state,
      providerReady,
      requestPolicies: requestPolicies.map((policy) => ({
        requestId: policy.requestId,
        categories: policy.categories,
        dispatchAllowed: policy.dispatchAllowed,
        manualExportAllowed: policy.manualExportAllowed,
        blockedReasons: policy.blockedReasons,
        retryQueueIds: policy.retryQueueIds
      }))
    })}`
  };
}

function operatorRunbookForFailure(failure, retryQueue) {
  const matchingRetry = retryQueue.find((entry) => (
    entry.target === failure.providerId
    || failure.source.endsWith(`:${entry.target}`)
    || failure.code.includes(entry.reason)
  ));
  const retryInstruction = matchingRetry
    ? matchingRetry.exhausted
      ? 'retry-budget-exhausted'
      : `retry-after-${matchingRetry.nextRetryAt || 'next-window'}`
    : 'manual-repair-required';

  return {
    errorCode: failure.code,
    source: failure.source,
    severity: failure.severity,
    primaryAction: failure.action,
    retryInstruction,
      retryQueueId: matchingRetry ? matchingRetry.id : null,
      operatorMessage: failure.code.includes('capability')
        ? 'Provider contract is missing a capability required by the current approval or lifecycle handoff.'
      : failure.code.includes('ack')
        ? 'Provider acknowledgement must be accepted before the hosted-kernel handoff can continue.'
        : failure.code.includes('sync')
          ? 'Provider state is stale or behind the expected revision and must be refreshed.'
          : failure.code.includes('proof')
            ? 'Attach valid sha256 proof evidence before accepting the preview or committing the handoff.'
            : failure.code.includes('permission') || failure.code.includes('boundary')
              ? 'Repair tenant/workspace boundary grants before dispatching this request.'
              : failure.code.includes('journal') || failure.code.includes('checkpoint')
                ? 'Repair or replay the persisted intent journal before committing a new checkpoint.'
                : 'Repair the approval-console contract and refresh health.'
  };
}

function failureDomainForCode(code) {
  if (code.startsWith('provider.')) {
    return 'provider';
  }
  if (code.startsWith('approval.') || code.startsWith('evidence.')) {
    return 'approval';
  }
  if (code.startsWith('lifecycle.')) {
    return 'lifecycle';
  }
  if (code.startsWith('persistence.')) {
    return 'persistence';
  }
  if (code.startsWith('preview.')) {
    return 'preview-acceptance';
  }
  if (code.startsWith('permission.') || code.startsWith('boundary.')) {
    return 'tenant-boundary';
  }
  return 'runtime-handoff';
}

function capabilityBlockedByFailure(code) {
  if (code.includes('provider.') || code.includes('sync') || code.includes('ack')) {
    return 'externalRuntimeDispatch';
  }
  if (code.includes('persistence.') || code.includes('journal') || code.includes('checkpoint')) {
    return 'checkpointCommit';
  }
  if (code.includes('proof') || code.includes('evidence')) {
    return 'evidenceAttachment';
  }
  if (code.includes('preview.acceptance')) {
    return 'previewAcceptance';
  }
  if (code.includes('boundary') || code.includes('permission')) {
    return 'operatorReview';
  }
  return 'externalRuntimeDispatch';
}

function buildOperatorRemediationPlan(now, failureStates, retryQueue, circuitBreaker, degradedCapabilities, limit) {
  const nowMs = parseTime(now);
  const seen = new Set();
  const orderedFailures = [...failureStates].sort((left, right) => (
    FAILURE_SEVERITY_ORDER[right.severity] - FAILURE_SEVERITY_ORDER[left.severity]
    || left.source.localeCompare(right.source)
    || left.code.localeCompare(right.code)
  ));
  const steps = [];

  for (const failure of orderedFailures) {
    const dedupeKey = `${failure.source}:${failure.code}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    const retry = retryQueue.find((entry) => (
      entry.target === failure.providerId
      || failure.source.endsWith(`:${entry.target}`)
      || failure.code.includes(entry.reason)
      || entry.reason.includes(failure.code)
    ));
    const nextRetryMs = retry?.nextRetryAt ? parseTime(retry.nextRetryAt) : null;
    const retryDue = retry?.retryable === true && nextRetryMs !== null && nowMs !== null && nextRetryMs <= nowMs;
    const blockedCapability = capabilityBlockedByFailure(failure.code);
    const blockedByCircuit = circuitBreaker.state === 'open' && blockedCapability === 'externalRuntimeDispatch';

    steps.push({
      id: `remediate:${steps.length + 1}`,
      domain: failureDomainForCode(failure.code),
      code: failure.code,
      source: failure.source,
      severity: failure.severity,
      action: failure.action,
      blockedCapability,
      retryQueueId: retry ? retry.id : null,
      retryDue,
      nextRetryAt: retry ? retry.nextRetryAt : '',
      retryExhausted: retry?.exhausted === true,
      canAutoRetry: retry?.retryable === true && retry.exhausted !== true && !blockedByCircuit,
      requiresOperator: !retry || retry.exhausted === true || blockedByCircuit || FAILURE_SEVERITY_ORDER[failure.severity] >= FAILURE_SEVERITY_ORDER.blocked,
      degradedModeEligible: degradedCapabilities.blockedCapabilities.includes(blockedCapability) === false
        && failure.severity !== 'critical',
      handoffBlocking: blockedCapability === 'externalRuntimeDispatch' || blockedByCircuit,
      nextStep: retry?.exhausted === true
        ? 'reset-retry-budget-after-repair'
        : blockedByCircuit
          ? circuitBreaker.resetCondition
          : retryDue
            ? 'run-due-retry'
            : retry?.retryable === true
              ? 'wait-for-backoff-window'
              : failure.action
    });

    if (steps.length >= limit) {
      break;
    }
  }

  return {
    format: 'approval-console.operator-remediation-plan.v1',
    generatedAt: now,
    circuitState: circuitBreaker.state,
    stepCount: steps.length,
    autoRetryStepIds: steps.filter((step) => step.canAutoRetry).map((step) => step.id),
    operatorRequiredStepIds: steps.filter((step) => step.requiresOperator).map((step) => step.id),
    runtimeBlockingStepIds: steps.filter((step) => step.handoffBlocking).map((step) => step.id),
    degradedModeEligibleStepIds: steps.filter((step) => step.degradedModeEligible).map((step) => step.id),
    steps,
    proof: `sha256:${proofFor({
      generatedAt: now,
      circuitState: circuitBreaker.state,
      steps: steps.map(({ nextRetryAt: _nextRetryAt, ...step }) => step)
    })}`
  };
}

function normalizePersistedJournal(input, now, isolationKey) {
  const rawJournal = Array.isArray(input.journal)
    ? input.journal
    : Array.isArray(input.writeAheadLog)
      ? input.writeAheadLog
      : Array.isArray(input.pendingCommits)
        ? input.pendingCommits
        : [];
  const seen = new Set();

  return rawJournal.slice(0, 100).map((entry, index) => {
    const raw = asObject(entry);
    const kind = asString(raw.kind || raw.type, 'approval-resume');
    const status = asString(raw.status || raw.state, 'staged');
    const id = asString(raw.id || raw.intentId || raw.requestId || raw.commandId, `journal:${index + 1}`);
    const digest = asString(raw.digest || raw.intentDigest || raw.proof);
    const entryIsolationKey = asString(raw.isolationKey, isolationKey);
    const createdAt = asString(raw.createdAt || raw.stagedAt || raw.at, now);
    const lastAttemptAt = asString(raw.lastAttemptAt || raw.updatedAt || raw.committedAt);
    const createdMs = parseTime(createdAt);
    const lastAttemptMs = lastAttemptAt ? parseTime(lastAttemptAt) : null;
    const attempts = normalizeInteger(raw.attempts || raw.retryCount, 0);
    const validation = [];
    const replayKey = `${kind}:${id}:${digest}`;

    if (!JOURNAL_KINDS.has(kind)) {
      validation.push('persistence.journal.kind.unsupported');
    }
    if (!JOURNAL_STATUSES.has(status)) {
      validation.push('persistence.journal.status.unsupported');
    }
    if (!id) {
      validation.push('persistence.journal.id.required');
    }
    if (!digest || !DIGEST_PATTERN.test(digest)) {
      validation.push('persistence.journal.digest.sha256_required');
    }
    if (entryIsolationKey !== isolationKey) {
      validation.push('persistence.journal.isolationKey.mismatch');
    }
    if (createdAt && createdMs === null) {
      validation.push('persistence.journal.createdAt.invalid');
    }
    if (lastAttemptAt && lastAttemptMs === null) {
      validation.push('persistence.journal.lastAttemptAt.invalid');
    }
    if (seen.has(replayKey)) {
      validation.push('persistence.journal.duplicate_intent');
    }
    seen.add(replayKey);

    return {
      id,
      kind,
      status,
      digest,
      isolationKey: entryIsolationKey,
      attempts,
      createdAt,
      lastAttemptAt,
      replayable: validation.length === 0 && status === 'staged',
      committed: validation.length === 0 && status === 'committed',
      failed: validation.length === 0 && status === 'failed',
      validation,
      proof: `sha256:${proofFor({ id, kind, status, digest, entryIsolationKey, attempts, createdAt, lastAttemptAt })}`
    };
  });
}

function collectPersistedImpactCommandInputs(raw) {
  return Array.isArray(raw.impactCommands)
    ? raw.impactCommands
    : Array.isArray(raw.appliedImpactCommands)
      ? raw.appliedImpactCommands
      : Array.isArray(raw.impactCommandLedger)
        ? raw.impactCommandLedger
        : Array.isArray(raw.externalWriteCommands) || Array.isArray(raw.destructiveActionCommands) || Array.isArray(raw.kernelChangeCommands)
          ? [
            ...(Array.isArray(raw.externalWriteCommands) ? raw.externalWriteCommands : []),
            ...(Array.isArray(raw.destructiveActionCommands) ? raw.destructiveActionCommands : []),
            ...(Array.isArray(raw.kernelChangeCommands) ? raw.kernelChangeCommands : [])
          ]
          : [];
}

function normalizePersistedImpactCommands(raw, now, isolationKey) {
  const seen = new Set();
  return collectPersistedImpactCommandInputs(raw).slice(0, 100).map((entry, index) => {
    const source = asObject(entry);
    const category = normalizeImpactType(source.category || source.impactType || source.type);
    const status = asString(source.status || source.state, 'staged');
    const requestId = asString(source.requestId || source.approvalId || source.id);
    const idempotencyKey = asString(source.idempotencyKey || source.commandKey || source.externalIdempotencyKey);
    const commandDigest = asString(source.commandDigest || source.digest || source.intentDigest || source.proof);
    const targetDigest = asString(source.targetDigest || source.targetsDigest);
    const entryIsolationKey = asString(source.isolationKey, isolationKey);
    const stagedAt = asString(source.stagedAt || source.createdAt || source.at, now);
    const committedAt = asString(source.committedAt || source.appliedAt || source.updatedAt);
    const stagedMs = stagedAt ? parseTime(stagedAt) : null;
    const committedMs = committedAt ? parseTime(committedAt) : null;
    const proofRefs = {
      approvalImpactProof: asString(source.approvalImpactProof || asObject(source.proofRefs).approvalImpactProof),
      proofBundleProof: asString(source.proofBundleProof || asObject(source.proofRefs).proofBundleProof),
      boundaryTransitionProof: asString(source.boundaryTransitionProof || asObject(source.proofRefs).boundaryTransitionProof),
      rollbackProof: asString(source.rollbackProof || source.backupProof || asObject(source.proofRefs).rollbackProof),
      kernelConfigDigest: asString(source.kernelConfigDigest || source.configDigest || asObject(source.proofRefs).kernelConfigDigest)
    };
    const validation = [];
    const dedupeKey = `${category || 'unknown'}:${requestId}:${idempotencyKey || commandDigest}`;

    if (!category) {
      validation.push('persistence.impact.category.unsupported');
    }
    if (!IMPACT_COMMAND_STATUSES.has(status)) {
      validation.push('persistence.impact.status.unsupported');
    }
    if (!requestId) {
      validation.push('persistence.impact.requestId.required');
    }
    if (!idempotencyKey) {
      validation.push('persistence.impact.idempotencyKey.required');
    }
    if (!commandDigest || !DIGEST_PATTERN.test(commandDigest)) {
      validation.push('persistence.impact.commandDigest.sha256_required');
    }
    if (targetDigest && !DIGEST_PATTERN.test(targetDigest)) {
      validation.push('persistence.impact.targetDigest.sha256_required');
    }
    if (entryIsolationKey !== isolationKey) {
      validation.push('persistence.impact.isolationKey.mismatch');
    }
    if (stagedAt && stagedMs === null) {
      validation.push('persistence.impact.stagedAt.invalid');
    }
    if (committedAt && committedMs === null) {
      validation.push('persistence.impact.committedAt.invalid');
    }
    if (category === 'destructive_action' && status === 'committed' && !proofRefs.rollbackProof) {
      validation.push('persistence.impact.destructive.rollback_proof_required');
    }
    if (category === 'privileged_kernel_change' && status === 'committed' && !proofRefs.kernelConfigDigest) {
      validation.push('persistence.impact.kernel.config_digest_required');
    }
    for (const [proofRef, proofValue] of Object.entries(proofRefs)) {
      if (proofValue && !DIGEST_PATTERN.test(proofValue)) {
        validation.push(`persistence.impact.${proofRef}.sha256_required`);
      }
    }
    if (seen.has(dedupeKey)) {
      validation.push('persistence.impact.duplicate_command');
    }
    seen.add(dedupeKey);

    return {
      format: 'approval-console.persisted-impact-command.v1',
      id: asString(source.id || source.commandId, `${requestId || 'impact'}:${category || 'unknown'}:${index + 1}`),
      requestId,
      category,
      status: IMPACT_COMMAND_STATUSES.has(status) ? status : 'failed',
      idempotencyKey,
      commandDigest,
      targetDigest,
      barrier: asString(source.barrier || source.syncBarrier, category ? PROVIDER_IMPACT_RULES[category].barrier : 'impact-ledger'),
      isolationKey: entryIsolationKey,
      stagedAt,
      committedAt,
      proofRefs,
      replayable: validation.length === 0 && status === 'staged',
      committed: validation.length === 0 && status === 'committed',
      failed: validation.length === 0 && status === 'failed',
      terminal: validation.length === 0 && (status === 'committed' || status === 'rolled_back' || status === 'superseded'),
      validation,
      proof: `sha256:${proofFor({
        requestId,
        category,
        status,
        idempotencyKey,
        commandDigest,
        targetDigest,
        entryIsolationKey,
        proofRefs
      })}`
    };
  });
}

function normalizePersistedState(input, now, clientState) {
  const raw = asObject(input.persistedState || input.stateCheckpoint || input.recoveredState);
  const rawApplied = asObject(raw.applied || raw.appliedIntents);
  const rawDigests = asObject(raw.commandDigests || raw.intentDigests);
  const checkpointTenantId = asString(raw.tenantId, clientState.boundary.tenantId);
  const checkpointWorkspaceId = asString(raw.workspaceId, clientState.boundary.workspaceId);
  const checkpointIsolationKey = asString(raw.isolationKey, `${checkpointTenantId}:${checkpointWorkspaceId}`);
  const lastMaterializedAt = asString(raw.lastMaterializedAt || raw.generatedAt || raw.updatedAt);
  const lastMaterializedMs = lastMaterializedAt ? parseTime(lastMaterializedAt) : null;
  const nowMs = parseTime(now);
  const validation = [];
  const appliedApprovalIds = normalizeIdList(
    rawApplied.approvalIds || rawApplied.resumeIntentIds || raw.appliedApprovalIds || raw.resumeIntentIds
  );
  const appliedLifecycleCommandIds = normalizeIdList(
    rawApplied.lifecycleCommandIds || rawApplied.commandIds || raw.appliedLifecycleCommandIds || raw.lifecycleCommandIds
  );
  const commandDigests = Object.fromEntries(
    Object.entries(rawDigests)
      .map(([key, value]) => [asString(key), asString(value)])
      .filter(([key, value]) => key && value)
  );
  const journal = normalizePersistedJournal(raw, now, clientState.boundary.isolationKey);
  const journalValidation = journal.flatMap((entry) => entry.validation.map((reason) => `${entry.id}:${reason}`));
  const impactCommands = normalizePersistedImpactCommands(raw, now, clientState.boundary.isolationKey);
  const impactCommandValidation = impactCommands.flatMap((entry) => (
    entry.validation.map((reason) => `${entry.id}:${reason}`)
  ));

  if (lastMaterializedAt && lastMaterializedMs === null) {
    validation.push('persistence.lastMaterializedAt.invalid');
  }
  if (lastMaterializedMs !== null && nowMs !== null && lastMaterializedMs > nowMs) {
    validation.push('persistence.lastMaterializedAt.future');
  }
  if (checkpointIsolationKey !== clientState.boundary.isolationKey) {
    validation.push('persistence.isolationKey.mismatch');
  }
  if (raw.proof && !DIGEST_PATTERN.test(asString(raw.proof))) {
    validation.push('persistence.proof.sha256_required');
  }
  validation.push(...journalValidation);
  validation.push(...impactCommandValidation);

  const revision = normalizeInteger(raw.revision || raw.version, 0);
  const epoch = asString(raw.epoch || raw.bootId || raw.restartId, `${clientState.sessionId}:ephemeral`);
  const checkpoint = {
    format: 'approval-console.persisted-state.v1',
    revision,
    epoch,
    isolationKey: checkpointIsolationKey,
    tenantId: checkpointTenantId,
    workspaceId: checkpointWorkspaceId,
    lastMaterializedAt,
    appliedApprovalIds,
    appliedLifecycleCommandIds,
    commandDigests,
    journal,
    impactCommands,
    proof: asString(raw.proof)
  };

  return {
    ...checkpoint,
    present: Object.keys(raw).length > 0,
    recovered: Object.keys(raw).length > 0 && validation.length === 0,
    recoveryMode: Object.keys(raw).length === 0
      ? 'cold_start'
      : validation.length
        ? 'checkpoint_repair_required'
        : journal.some((entry) => entry.replayable) || impactCommands.some((entry) => entry.replayable)
          ? 'recover_inflight_commit'
        : appliedApprovalIds.length || appliedLifecycleCommandIds.length
          ? 'resume_from_checkpoint'
          : 'checkpoint_loaded',
    validation,
    nextRevision: revision + 1,
    checkpointProof: `sha256:${proofFor(checkpoint)}`
  };
}

function normalizeClientState(input, now) {
  const client = asObject(input.clientState);
  const runtime = asObject(input.runtime);
  const boundary = normalizeBoundary(input);
  const operator = normalizeOperator(input);
  const permissionBindings = normalizePermissionBindings(input, boundary, operator, now);
  const permissionValidation = permissionBindings.flatMap((binding) => (
    binding.validation.map((reason) => `${binding.id}:${reason}`)
  ));
  const permissionBoundary = {
    format: 'approval-console.permission-boundary.v1',
    requireExplicitWorkspaceGrant: client.requireExplicitWorkspaceGrant === true
      || runtime.requireExplicitWorkspaceGrant === true
      || input.requireExplicitWorkspaceGrant === true,
    bindings: permissionBindings,
    activeBindingIds: permissionBindings.filter((binding) => binding.active).map((binding) => binding.id),
    validation: permissionValidation,
    proof: `sha256:${proofFor({
      isolationKey: boundary.isolationKey,
      operatorId: operator.id,
      bindings: permissionBindings.map(({ validation: _validation, active: _active, ...binding }) => binding)
    })}`
  };
  return {
    clientId: asString(client.clientId, asString(input.clientId, 'anonymous-client')),
    sessionId: asString(client.sessionId, asString(input.sessionId, 'ephemeral-session')),
    requestId: asString(client.requestId, asString(input.requestId)),
    route: asString(client.route, 'operator-userland/approval-console'),
    capabilities: normalizeScope(client.capabilities || runtime.capabilities),
    boundary,
    operator,
    permissionBoundary,
    handoffDestination: asString(
      client.handoffDestination || runtime.handoffDestination,
      'hosted-kernel/request-runtime'
    )
  };
}

function normalizeLifecycleSettings(input, now) {
  const source = asObject(input.lifecycleSettings || input.settings);
  const schedule = asObject(source.schedule || input.schedule);
  const maintenance = asObject(source.maintenanceWindow);
  const controls = asObject(source.controls || input.lifecycleControls);
  const lockedCommands = new Set(normalizeScope(controls.disabledCommands || controls.lockedCommands || source.disabledCommands)
    .map(normalizeLifecycleCommand)
    .filter(Boolean));
  const validation = [];
  const maxScheduledHours = normalizePositiveNumber(source.maxScheduledHours, LIFECYCLE_DEFAULTS.maxScheduledHours);
  const minLeadMinutes = normalizePositiveNumber(source.minLeadMinutes, 5);
  const scheduleStartAt = asString(schedule.startAt || source.scheduleStartAt);
  const scheduleEndAt = asString(schedule.endAt || source.scheduleEndAt);
  const maintenanceUntil = asString(maintenance.until);
  const startMs = scheduleStartAt ? parseTime(scheduleStartAt) : null;
  const endMs = scheduleEndAt ? parseTime(scheduleEndAt) : null;
  const maintenanceUntilMs = maintenanceUntil ? parseTime(maintenanceUntil) : null;
  const nowMs = parseTime(now);
  const enabled = normalizeBoolean(source.enabled, LIFECYCLE_DEFAULTS.enabled);
  const schedulerEnabled = normalizeBoolean(source.schedulerEnabled, LIFECYCLE_DEFAULTS.schedulerEnabled);
  const maintenanceActive = normalizeBoolean(maintenance.active, false);
  const enableControl = normalizeControlBoolean(controls, ['enable', 'allowEnable', 'enableAllowed'], true) && !lockedCommands.has('enable');
  const disableControl = normalizeControlBoolean(controls, ['disable', 'allowDisable', 'disableAllowed'], true) && !lockedCommands.has('disable');
  const scheduleControl = normalizeControlBoolean(controls, ['schedule', 'allowSchedule', 'scheduleAllowed'], true) && !lockedCommands.has('schedule');
  const unscheduleControl = normalizeControlBoolean(controls, ['unschedule', 'allowUnschedule', 'unscheduleAllowed'], true) && !lockedCommands.has('unschedule');
  const pauseControl = normalizeControlBoolean(controls, ['pause', 'allowPause', 'pauseAllowed'], true) && !lockedCommands.has('pause');
  const resumeControl = normalizeControlBoolean(controls, ['resume', 'allowResume', 'resumeAllowed'], true) && !lockedCommands.has('resume');
  const configuredSchedule = Boolean(scheduleStartAt || scheduleEndAt || schedule.recurring === true);
  const activeScheduledWindow = startMs !== null && endMs !== null && nowMs !== null && startMs <= nowMs && nowMs <= endMs;

  if (scheduleStartAt && startMs === null) {
    validation.push('lifecycle.schedule.startAt.invalid');
  }
  if (scheduleEndAt && endMs === null) {
    validation.push('lifecycle.schedule.endAt.invalid');
  }
  if (startMs !== null && nowMs !== null && startMs < nowMs + minLeadMinutes * 60_000) {
    validation.push('lifecycle.schedule.lead_time_too_short');
  }
  if (startMs !== null && endMs !== null && endMs <= startMs) {
    validation.push('lifecycle.schedule.end_before_start');
  }
  if (startMs !== null && endMs !== null && endMs - startMs > maxScheduledHours * 60 * 60_000) {
    validation.push('lifecycle.schedule.window_too_long');
  }
  if (maintenanceUntil && maintenanceUntilMs === null) {
    validation.push('lifecycle.maintenance.until.invalid');
  }
  if (maintenanceActive && !maintenanceUntil) {
    validation.push('lifecycle.maintenance.until.required');
  }
  if (maintenanceUntilMs !== null && nowMs !== null && maintenanceUntilMs <= nowMs) {
    validation.push('lifecycle.maintenance.until.expired');
  }
  if (!schedulerEnabled && (scheduleStartAt || scheduleEndAt || schedule.recurring === true)) {
    validation.push('lifecycle.scheduler.disabled_with_schedule');
  }
  if (!enabled && !enableControl) {
    validation.push('lifecycle.controls.enable_required_to_recover');
  }
  if (schedulerEnabled && configuredSchedule && !scheduleControl && !unscheduleControl) {
    validation.push('lifecycle.controls.schedule_repair_control_required');
  }
  if (maintenanceActive && !resumeControl && !enableControl) {
    validation.push('lifecycle.controls.resume_or_enable_required_after_maintenance');
  }
  if (lockedCommands.has('enable') && lockedCommands.has('disable')) {
    validation.push('lifecycle.controls.enable_disable_both_locked');
  }

  return {
    enabled,
    schedulerEnabled,
    requireApprovalForEnable: normalizeBoolean(source.requireApprovalForEnable, LIFECYCLE_DEFAULTS.requireApprovalForEnable),
    requireProofForDisable: normalizeBoolean(source.requireProofForDisable, LIFECYCLE_DEFAULTS.requireProofForDisable),
    maxScheduledHours,
    minLeadMinutes,
    controls: {
      enable: enableControl,
      disable: disableControl,
      schedule: scheduleControl,
      unschedule: unscheduleControl,
      pause: pauseControl,
      resume: resumeControl,
      lockedCommands: [...lockedCommands],
      disabledCommands: Object.entries({
        enable: enableControl,
        disable: disableControl,
        schedule: scheduleControl,
        unschedule: unscheduleControl,
        pause: pauseControl,
        resume: resumeControl
      })
        .filter(([, allowed]) => !allowed)
        .map(([command]) => command),
      reason: asString(controls.reason || controls.lockReason)
    },
    schedule: {
      startAt: scheduleStartAt,
      endAt: scheduleEndAt,
      timezone: asString(schedule.timezone || source.timezone, 'UTC'),
      recurring: normalizeBoolean(schedule.recurring, false),
      configured: configuredSchedule,
      activeNow: activeScheduledWindow
    },
    maintenanceWindow: {
      active: maintenanceActive,
      reason: asString(maintenance.reason),
      until: maintenanceUntil
    },
    lifecycleMode: maintenanceActive
      ? 'maintenance'
      : activeScheduledWindow
        ? 'scheduled_window_active'
        : enabled
          ? 'enabled'
          : 'disabled',
    validation,
    valid: validation.length === 0
  };
}

function lifecycleCommandControl(settings, command) {
  return command && Object.hasOwn(settings.controls, command)
    ? settings.controls[command]
    : true;
}

function lifecycleCommandAvailability(settings, command, operatorRole = 'viewer') {
  const requiredRole = LIFECYCLE_MIN_ROLE[command] || 'approver';
  const allowedByControl = lifecycleCommandControl(settings, command);
  const roleSatisfied = roleMeets(operatorRole, requiredRole);
  const scheduleConfigured = settings.schedule.configured;
  const blockedReasons = [
    ...(!allowedByControl ? [`lifecycle.controls.${command}_disabled`] : []),
    ...(!roleSatisfied ? [`lifecycle.role.${requiredRole}_required`] : []),
    ...(settings.maintenanceWindow.active && (command === 'enable' || command === 'resume') ? ['lifecycle.maintenance.blocks_enable'] : []),
    ...(command === 'enable' && settings.enabled ? ['lifecycle.enable.already_enabled'] : []),
    ...(command === 'disable' && !settings.enabled ? ['lifecycle.disable.already_disabled'] : []),
    ...(command === 'pause' && !settings.enabled ? ['lifecycle.pause.already_paused'] : []),
    ...(command === 'resume' && settings.enabled ? ['lifecycle.resume.already_running'] : []),
    ...((command === 'schedule' || command === 'unschedule') && !settings.schedulerEnabled ? ['lifecycle.scheduler.disabled'] : []),
    ...(command === 'unschedule' && !scheduleConfigured ? ['lifecycle.unschedule.no_schedule_configured'] : [])
  ];

  return {
    command,
    available: blockedReasons.length === 0,
    requiredRole,
    roleSatisfied,
    controlEnabled: allowedByControl,
    blockedReasons,
    repairHint: blockedReasons.length === 0
      ? 'command-ready'
      : blockedReasons.some((reason) => reason.includes('role.'))
        ? 'switch-to-operator-with-required-role'
        : blockedReasons.some((reason) => reason.includes('controls.'))
          ? 'enable-lifecycle-control-in-settings'
          : blockedReasons.some((reason) => reason.includes('scheduler'))
            ? 'enable-scheduler-before-schedule-command'
            : blockedReasons.some((reason) => reason.includes('maintenance'))
              ? 'wait-for-or-clear-maintenance-window'
              : blockedReasons.some((reason) => reason.includes('already_') || reason.includes('no_schedule'))
                ? 'select-command-that-changes-current-state'
                : 'repair-lifecycle-settings'
  };
}

function buildLifecycleControlPanel(settings, operatorRole, commands = []) {
  const availability = [...LIFECYCLE_COMMANDS].map((command) => lifecycleCommandAvailability(settings, command, operatorRole));
  const availableCommands = availability.filter((entry) => entry.available).map((entry) => entry.command);
  const blockedCommands = availability.filter((entry) => !entry.available);
  const submittedCommandIds = commands
    .filter((command) => command.valid && !command.recoveredApplied)
    .map((command) => command.id);
  const pendingApprovalCommandIds = commands
    .filter((command) => command.valid && command.requiresApproval && !command.recoveredApplied)
    .map((command) => command.id);
  const executionReadyCommandIds = commands
    .filter((command) => command.valid && !command.requiresApproval && !command.recoveredApplied)
    .map((command) => command.id);
  const suggestedCommand = settings.maintenanceWindow.active
    ? null
    : !settings.enabled && availableCommands.includes('enable')
      ? 'enable'
      : settings.enabled && availableCommands.includes('pause')
        ? 'pause'
        : settings.schedulerEnabled && settings.schedule.configured && availableCommands.includes('unschedule')
          ? 'unschedule'
          : settings.schedulerEnabled && availableCommands.includes('schedule')
            ? 'schedule'
            : availableCommands[0] || null;

  return {
    format: 'approval-console.lifecycle-control-panel.v1',
    lifecycleMode: settings.lifecycleMode,
    availableCommands,
    blockedCommands: blockedCommands.map((entry) => ({
      command: entry.command,
      requiredRole: entry.requiredRole,
      blockedReasons: entry.blockedReasons,
      repairHint: entry.repairHint
    })),
    submittedCommandIds,
    pendingCommandIds: pendingApprovalCommandIds,
    executionReadyCommandIds,
    suggestedCommand,
    settingsRepairRequired: !settings.valid,
    nextOperatorAction: !settings.valid
      ? 'repair-lifecycle-settings'
      : executionReadyCommandIds.length
        ? 'apply-lifecycle-command'
        : pendingApprovalCommandIds.length
          ? 'request-lifecycle-approval'
        : suggestedCommand
          ? `offer-${suggestedCommand}-control`
          : 'observe-lifecycle',
    proof: `sha256:${proofFor({
      lifecycleMode: settings.lifecycleMode,
      availableCommands,
      blockedCommands: blockedCommands.map((entry) => [entry.command, entry.blockedReasons]),
      submittedCommandIds,
      pendingApprovalCommandIds,
      executionReadyCommandIds,
      suggestedCommand
    })}`
  };
}

function scheduleIntentState(settings, command, scheduledFor, now) {
  const scheduledMs = scheduledFor ? parseTime(scheduledFor) : null;
  const nowMs = parseTime(now);
  const startMs = settings.schedule.startAt ? parseTime(settings.schedule.startAt) : null;
  const endMs = settings.schedule.endAt ? parseTime(settings.schedule.endAt) : null;
  const validation = [];

  if (command === 'schedule' && !scheduledFor) {
    validation.push('lifecycle.schedule.scheduledFor.required');
  }
  if (scheduledFor && scheduledMs === null) {
    validation.push('lifecycle.schedule.scheduledFor.invalid');
  }
  if (scheduledMs !== null && nowMs !== null && scheduledMs < nowMs + settings.minLeadMinutes * 60_000) {
    validation.push('lifecycle.schedule.scheduledFor.lead_time_too_short');
  }
  if (scheduledMs !== null && startMs !== null && scheduledMs < startMs) {
    validation.push('lifecycle.schedule.scheduledFor.before_window');
  }
  if (scheduledMs !== null && endMs !== null && scheduledMs > endMs) {
    validation.push('lifecycle.schedule.scheduledFor.after_window');
  }

  return {
    scheduledMs,
    windowStartAt: settings.schedule.startAt,
    windowEndAt: settings.schedule.endAt,
    inConfiguredWindow: scheduledMs !== null
      && (startMs === null || scheduledMs >= startMs)
      && (endMs === null || scheduledMs <= endMs),
    validation
  };
}

function collectLifecycleCommands(input, settings, clientState, now) {
  const rawCommands = Array.isArray(input.lifecycleCommands)
    ? input.lifecycleCommands
    : Array.isArray(input.commands)
      ? input.commands
      : input.lifecycleCommand
        ? [input.lifecycleCommand]
        : [];

  return rawCommands.map((entry, index) => {
    const raw = asObject(entry);
    const command = normalizeLifecycleCommand(raw.command || raw.action || raw.type);
    const scheduledFor = asString(raw.scheduledFor || raw.at || raw.startAt);
    const scheduleState = scheduleIntentState(settings, command, scheduledFor, now);
    const validation = [];
    const requiredRole = command ? LIFECYCLE_MIN_ROLE[command] : 'approver';
    const availability = command
      ? lifecycleCommandAvailability(settings, command, clientState.operator.strongestRole)
      : null;

    if (!command) {
      validation.push('lifecycle.command.unsupported');
    }
    validation.push(...(availability ? availability.blockedReasons : []));
    validation.push(...scheduleState.validation);

    return {
      id: asString(raw.id, `${clientState.sessionId}:lifecycle:${index + 1}`),
      command,
      requestedBy: asString(raw.requestedBy || raw.actor, clientState.clientId),
      reason: asString(raw.reason || raw.intent, 'operator lifecycle control'),
      scheduledFor,
      targetState: command === 'enable' || command === 'resume'
        ? 'enabled'
        : command === 'disable' || command === 'pause'
          ? 'disabled'
          : 'scheduled',
      requiresApproval: command === 'enable' ? settings.requireApprovalForEnable : command === 'disable',
      requiresProof: command === 'disable' ? settings.requireProofForDisable : false,
      requiredRole,
      operatorRole: clientState.operator.strongestRole,
      controlsAllowed: command ? lifecycleCommandControl(settings, command) : false,
      availability,
      schedulePolicy: {
        windowStartAt: scheduleState.windowStartAt,
        windowEndAt: scheduleState.windowEndAt,
        inConfiguredWindow: scheduleState.inConfiguredWindow,
        minLeadMinutes: settings.minLeadMinutes,
        maxScheduledHours: settings.maxScheduledHours
      },
      valid: validation.length === 0,
      validation
    };
  });
}

function buildLifecycleState(now, clientState, settings, commands, persistedState) {
  const commandsWithRecovery = commands.map((command) => {
    const intentDigest = `sha256:${proofFor(lifecycleIntentDigestPayload({
      commandId: command.id,
      command: command.command,
      targetState: command.targetState,
      scheduledFor: command.scheduledFor,
      proofRequired: command.requiresProof,
      isolationKey: clientState.boundary.isolationKey
    }))}`;
    const persistedDigest = persistedState.commandDigests[command.id];
    const journalEntry = persistedState.journal.find((entry) => (
      entry.kind === 'lifecycle-apply' && entry.id === command.id && entry.digest === intentDigest
    ));
    const applied = persistedState.recovered && (
      persistedState.appliedLifecycleCommandIds.includes(command.id)
      || persistedDigest === intentDigest
      || journalEntry?.committed === true
    );
    const replayable = persistedState.recovered && journalEntry?.replayable === true && !applied;
    const failed = journalEntry?.failed === true;
    return {
      ...command,
      idempotencyKey: `${clientState.boundary.isolationKey}:lifecycle:${command.id}`,
      intentDigest,
      persistedJournalStatus: journalEntry ? journalEntry.status : 'absent',
      recoveredApplied: applied,
      recoveryReplayRequired: replayable,
      recoveryStatus: applied
        ? 'already_applied'
        : failed
          ? 'failed_requires_operator_review'
          : replayable
            ? 'commit_in_flight_replay_required'
        : persistedState.recoveryMode === 'checkpoint_repair_required'
          ? 'checkpoint_blocked'
          : 'pending'
    };
  });
  const invalidCommands = commandsWithRecovery.filter((command) => !command.valid);
  const pendingCommands = commandsWithRecovery.filter((command) => command.valid && command.requiresApproval && !command.recoveredApplied);
  const executableCommands = commandsWithRecovery.filter((command) => (
    command.valid
    && !command.requiresApproval
    && !command.recoveredApplied
    && command.recoveryStatus !== 'failed_requires_operator_review'
  ));
  const recoveredCommands = commandsWithRecovery.filter((command) => command.recoveredApplied);
  const replayRequiredCommands = commandsWithRecovery.filter((command) => command.recoveryReplayRequired);
  const latestCommand = commandsWithRecovery[0] || null;
  const scheduledCommands = commandsWithRecovery.filter((command) => command.command === 'schedule');
  const controlPanel = buildLifecycleControlPanel(settings, clientState.operator.strongestRole, commandsWithRecovery);
  const nextScheduledCommand = scheduledCommands
    .filter((command) => command.valid && !command.recoveredApplied && command.scheduledFor)
    .sort((left, right) => (parseTime(left.scheduledFor) ?? 0) - (parseTime(right.scheduledFor) ?? 0))[0] || null;
  const controlsBlockedCommands = commandsWithRecovery.filter((command) => command.validation.some((reason) => reason.startsWith('lifecycle.controls.')));
  const validation = [
    ...settings.validation,
    ...invalidCommands.flatMap((command) => command.validation),
    ...commandsWithRecovery
      .filter((command) => command.recoveryStatus === 'failed_requires_operator_review')
      .map((command) => `${command.id}:lifecycle.recovery.failed_intent`),
    ...persistedState.validation
  ];
  const commandProof = proofFor({
    now,
    isolationKey: clientState.boundary.isolationKey,
    settings,
    persistedRevision: persistedState.revision,
    commands: commandsWithRecovery.map(({ validation: _validation, ...command }) => command)
  });

  return {
    enabled: settings.enabled,
    schedulerEnabled: settings.schedulerEnabled,
    settings,
    settingsValid: settings.valid,
    validation,
    controls: settings.controls,
    controlPanel,
    scheduling: {
      configured: Boolean(settings.schedule.startAt || settings.schedule.endAt || settings.schedule.recurring),
      schedulerEnabled: settings.schedulerEnabled,
      windowStartAt: settings.schedule.startAt,
      windowEndAt: settings.schedule.endAt,
      recurring: settings.schedule.recurring,
      timezone: settings.schedule.timezone,
      nextScheduledCommandId: nextScheduledCommand ? nextScheduledCommand.id : null,
      blockedByControlsCommandIds: controlsBlockedCommands.map((command) => command.id)
    },
    commands: commandsWithRecovery,
    pendingCommandIds: pendingCommands.map((command) => command.id),
    executableCommandIds: executableCommands.map((command) => command.id),
    recoveredCommandIds: recoveredCommands.map((command) => command.id),
    replayRequiredCommandIds: replayRequiredCommands.map((command) => command.id),
    nextAction: !settings.valid
      ? 'repair-lifecycle-settings'
      : persistedState.validation.length
        ? 'repair-persisted-state'
      : replayRequiredCommands.length
        ? 'replay-lifecycle-command'
      : invalidCommands.length
        ? 'repair-lifecycle-command'
      : nextScheduledCommand
        ? 'await-scheduled-lifecycle-window'
      : pendingCommands.length
          ? 'request-lifecycle-approval'
          : executableCommands.length
            ? 'apply-lifecycle-command'
            : controlPanel.nextOperatorAction !== 'observe-lifecycle'
              ? controlPanel.nextOperatorAction
            : recoveredCommands.length
              ? 'observe-recovered-lifecycle'
            : settings.maintenanceWindow.active
              ? 'observe-maintenance-window'
              : 'observe-lifecycle',
    activeCommandId: latestCommand ? latestCommand.id : null,
    persistence: {
      recoveryMode: persistedState.recoveryMode,
      revision: persistedState.revision,
      nextRevision: persistedState.nextRevision,
      recoveredCommandIds: recoveredCommands.map((command) => command.id),
      replayRequiredCommandIds: replayRequiredCommands.map((command) => command.id),
      validation: persistedState.validation,
      checkpointProof: persistedState.checkpointProof
    },
    auditProof: `sha256:${commandProof}`
  };
}

function normalizeApprovalRequest(rawRequest, index, clientState, now) {
  const raw = asObject(rawRequest);
  const decision = normalizeDecision(raw.decision || raw.requestedDecision);
  const state = normalizeState(raw.state || (decision === 'approve' ? 'approved' : decision === 'deny' ? 'denied' : 'requested'));
  const risk = normalizeRisk(raw.risk || raw.riskLevel);
  const requestId = asString(raw.id, asString(raw.requestId, `${clientState.sessionId}:approval:${index + 1}`));
  const embeddedEvidence = normalizeEvidenceItems(raw.evidence, now, requestId);
  const request = {
    id: requestId,
    clientRequestId: asString(raw.clientRequestId, clientState.requestId),
    state,
    decision,
    action: asString(raw.action || raw.operation, 'hosted-kernel-action'),
    target: asString(raw.target || raw.resource, 'unspecified-target'),
    tenantId: asString(raw.tenantId, clientState.boundary.tenantId),
    workspaceId: asString(raw.workspaceId, clientState.boundary.workspaceId),
    intent: asString(raw.intent || raw.reason, 'operator approval required'),
    risk,
    scope: normalizeScope(raw.scope || raw.permissions),
    requestedBy: asString(raw.requestedBy || raw.actor, clientState.clientId),
    decidedBy: asString(raw.decidedBy || raw.operator),
    decidedAt: asString(raw.decidedAt || raw.decisionAt),
    createdAt: asString(raw.createdAt, now),
    expiresAt: asString(raw.expiresAt),
    requiresProof: raw.requiresProof === true || RISK_ORDER[risk] >= RISK_ORDER.high,
    evidence: embeddedEvidence
  };
  const impact = buildApprovalImpactContract(raw, request);
  const workflowAcceptance = normalizeWorkflowAcceptance(raw, request, impact, clientState, now);
  const requestWithImpact = {
    ...request,
    impact,
    workflowAcceptance,
    requiresProof: request.requiresProof || impact.requiresProof
  };

  const validation = [];
  if (!requestWithImpact.action || requestWithImpact.action === 'hosted-kernel-action') {
    validation.push('approval.action.missing');
  }
  if (!requestWithImpact.target || requestWithImpact.target === 'unspecified-target') {
    validation.push('approval.target.missing');
  }
  if ((state === 'approved' || state === 'denied') && !requestWithImpact.decidedBy) {
    validation.push('approval.decidedBy.required');
  }
  if (decision && state === 'requested') {
    validation.push('approval.state.decision_mismatch');
  }
  const requestWithBoundaryTransition = {
    ...requestWithImpact,
    boundaryTransition: normalizeBoundaryTransition(raw.boundaryTransition || raw.transition || raw.boundaryHandoff, clientState, requestWithImpact, now)
  };
  const boundaryPolicy = evaluateBoundaryPolicy(requestWithBoundaryTransition, clientState);
  const proofBundle = buildProofBundle(requestWithBoundaryTransition, embeddedEvidence, boundaryPolicy, now);
  validation.push(...boundaryPolicy.validation);
  validation.push(...proofBundle.validation);
  const approvalWithValidation = {
    ...requestWithBoundaryTransition,
    boundaryPolicy,
    proofBundle,
    valid: validation.length === 0,
    validation
  };

  return {
    ...approvalWithValidation,
    workflowHandoff: buildApprovalWorkflowHandoff(approvalWithValidation, clientState, now)
  };
}

function collectRequests(input, clientState, now) {
  const source = Array.isArray(input.requests)
    ? input.requests
    : Array.isArray(input.approvals)
      ? input.approvals
      : input.request
        ? [input.request]
      : [];
  return source.map((request, index) => normalizeApprovalRequest(request, index, clientState, now));
}

function attachGlobalEvidenceToApprovals(approvals, globalEvidence, clientState, now) {
  if (globalEvidence.length === 0) {
    return approvals;
  }

  return approvals.map((approval) => {
    const linkedEvidence = globalEvidence.filter((entry) => (
      entry.subjectRequestId === approval.id || entry.subjectRequestId === approval.clientRequestId
    ));
    if (linkedEvidence.length === 0) {
      return approval;
    }

    const evidenceById = new Map([
      ...approval.evidence.map((entry) => [entry.id, entry]),
      ...linkedEvidence.map((entry) => [entry.id, entry])
    ]);
    const evidence = [...evidenceById.values()];
    const proofBundle = buildProofBundle(approval, evidence, approval.boundaryPolicy, now);
    const nonProofValidation = approval.validation.filter((entry) => (
      !entry.startsWith('approval.proof.') && !entry.startsWith('evidence.')
    ));
    const validation = [...nonProofValidation, ...proofBundle.validation];

    const updatedApproval = {
      ...approval,
      evidence,
      proofBundle,
      valid: validation.length === 0,
      validation
    };

    return {
      ...updatedApproval,
      workflowHandoff: buildApprovalWorkflowHandoff(updatedApproval, clientState, now)
    };
  });
}

function approvalQueueState(approval) {
  if (approval.state === 'approved' && approval.valid) {
    return approval.workflowHandoff.resumeCandidate ? 'ready_for_handoff' : 'approved_blocked';
  }
  if (approval.state === 'requested') {
    if (!approval.boundaryPolicy.boundaryClear) {
      return 'blocked_by_boundary';
    }
    if (approval.proofBundle.required && approval.proofBundle.status !== 'satisfied') {
      return 'waiting_for_proof';
    }
    return approval.valid ? 'decision_ready' : 'contract_repair_required';
  }
  if (approval.state === 'denied' || approval.state === 'expired' || approval.state === 'cancelled') {
    return 'closed';
  }
  return approval.valid ? 'operator_review' : 'contract_repair_required';
}

function approvalQueueAction(queueState) {
  return {
    ready_for_handoff: 'stage-runtime-resume-preview',
    approved_blocked: 'repair-approved-handoff-blocker',
    blocked_by_boundary: 'repair-tenant-workspace-boundary',
    waiting_for_proof: 'attach-required-proof',
    decision_ready: 'record-operator-decision',
    contract_repair_required: 'repair-approval-request',
    operator_review: 'review-approval-request',
    closed: 'observe-closed-approval'
  }[queueState] || 'review-approval-request';
}

function approvalQueuePriority(approval, queueState) {
  const stateWeight = {
    ready_for_handoff: 0,
    blocked_by_boundary: 1,
    waiting_for_proof: 2,
    decision_ready: 3,
    approved_blocked: 4,
    contract_repair_required: 5,
    operator_review: 6,
    closed: 9
  }[queueState] ?? 7;
  return (stateWeight * 10) - (RISK_ORDER[approval.risk] || 0);
}

function buildApprovalActionQueue(approvals) {
  const items = approvals.map((approval) => {
    const queueState = approvalQueueState(approval);
    const blockingReasons = [
      ...approval.workflowHandoff.hardBlocks,
      ...approval.boundaryPolicy.deniedScopes.map((scopeEntry) => `approval.scope.denied:${scopeEntry}`),
      ...approval.proofBundle.rejectedEvidenceIds.map((evidenceId) => `approval.evidence.rejected:${evidenceId}`)
    ];
    return {
      requestId: approval.id,
      clientRequestId: approval.clientRequestId,
      queueState,
      priority: approvalQueuePriority(approval, queueState),
      nextAction: approvalQueueAction(queueState),
      action: approval.action,
      target: approval.target,
      risk: approval.risk,
      state: approval.state,
      decision: approval.decision,
      requiredRole: approval.boundaryPolicy.requiredRole,
      operatorRole: approval.boundaryPolicy.operatorRole,
      roleSatisfied: roleMeets(approval.boundaryPolicy.operatorRole, approval.boundaryPolicy.requiredRole),
      proofStatus: approval.proofBundle.status,
      boundaryStatus: approval.boundaryPolicy.boundaryClear ? 'clear' : 'held',
      impactCategory: approval.impact.primaryCategory,
      blockingReasons,
      acceptedEvidenceIds: approval.proofBundle.acceptedEvidenceIds,
      auditProofs: approval.workflowHandoff.auditRefs
    };
  }).sort((left, right) => (
    left.priority - right.priority
    || left.requestId.localeCompare(right.requestId)
  ));
  const openItems = items.filter((item) => item.queueState !== 'closed');
  const decisionReady = items.filter((item) => item.queueState === 'decision_ready');
  const handoffReady = items.filter((item) => item.queueState === 'ready_for_handoff');
  const approvedBlocked = items.filter((item) => item.queueState === 'approved_blocked');
  const boundaryBlocked = items.filter((item) => item.queueState === 'blocked_by_boundary');
  const proofWaiting = items.filter((item) => item.queueState === 'waiting_for_proof');

  return {
    format: 'approval-console.operator-action-queue.v1',
    itemCount: items.length,
    openCount: openItems.length,
    decisionReadyCount: decisionReady.length,
    handoffReadyCount: handoffReady.length,
    approvedBlockedCount: approvedBlocked.length,
    boundaryBlockedCount: boundaryBlocked.length,
    proofWaitingCount: proofWaiting.length,
    firstActionRequestId: openItems[0]?.requestId || null,
    firstAction: openItems[0]?.nextAction || 'observe',
    decisionReadyRequestIds: decisionReady.map((item) => item.requestId),
    handoffReadyRequestIds: handoffReady.map((item) => item.requestId),
    approvedBlockedRequestIds: approvedBlocked.map((item) => item.requestId),
    boundaryBlockedRequestIds: boundaryBlocked.map((item) => item.requestId),
    proofWaitingRequestIds: proofWaiting.map((item) => item.requestId),
    items,
    proof: `sha256:${proofFor({
      items: items.map(({ auditProofs: _auditProofs, ...item }) => item)
    })}`
  };
}

function buildHandoff(clientState, approvals, lifecycleState) {
  const pending = approvals.filter((approval) => approval.state === 'requested');
  const blocked = approvals.filter((approval) => !approval.valid);
  const boundaryBlocked = approvals.filter((approval) => !approval.boundaryPolicy.boundaryClear);
  const permissionBlocked = approvals.filter((approval) => approval.boundaryPolicy.permissionGrant.validation.length > 0);
  const transitionBlocked = approvals.filter((approval) => approval.boundaryTransition.changed && !approval.boundaryTransition.allowed);
  const operatorActionQueue = buildApprovalActionQueue(approvals);
  const focus = pending.find((approval) => approval.risk === 'critical') || pending[0] || blocked[0] || approvals[0];
  const lifecycleBlocked = lifecycleState.validation.length > 0;
  const permissionBoundaryBlocked = clientState.permissionBoundary.validation.length > 0;
  const lifecycleReady = lifecycleState.nextAction === 'apply-lifecycle-command';
  const lifecycleReplay = lifecycleState.nextAction === 'replay-lifecycle-command';
  const nextAction = permissionBoundaryBlocked
    ? 'repair-workspace-permission-bindings'
    : lifecycleBlocked
    ? lifecycleState.nextAction
    : lifecycleReady || lifecycleReplay
      ? lifecycleState.nextAction
      : boundaryBlocked.length
    ? 'hold-for-tenant-boundary-review'
      : blocked.length
      ? 'repair-approval-contract'
      : pending.length
        ? 'operator-review'
        : operatorActionQueue.handoffReadyCount
          ? 'resume-hosted-kernel'
          : operatorActionQueue.approvedBlockedCount
            ? 'repair-approved-handoff-blocker'
          : 'observe';

  return {
    route: clientState.route,
    destination: clientState.handoffDestination,
    nextAction,
    focusRequestId: focus ? focus.id : lifecycleState.activeCommandId,
    pendingCount: pending.length,
    invalidCount: blocked.length,
    boundaryHoldCount: boundaryBlocked.length,
    permissionHoldCount: permissionBlocked.length,
    transitionHoldCount: transitionBlocked.length,
    actionQueue: operatorActionQueue,
    actionQueueSummary: {
      firstAction: operatorActionQueue.firstAction,
      firstActionRequestId: operatorActionQueue.firstActionRequestId,
      openCount: operatorActionQueue.openCount,
      decisionReadyCount: operatorActionQueue.decisionReadyCount,
      handoffReadyCount: operatorActionQueue.handoffReadyCount,
      approvedBlockedCount: operatorActionQueue.approvedBlockedCount,
      boundaryBlockedCount: operatorActionQueue.boundaryBlockedCount,
      proofWaitingCount: operatorActionQueue.proofWaitingCount
    },
    approvedCount: approvals.filter((approval) => approval.state === 'approved').length,
    deniedCount: approvals.filter((approval) => approval.state === 'denied').length,
    tenantId: clientState.boundary.tenantId,
    workspaceId: clientState.boundary.workspaceId,
    isolationKey: clientState.boundary.isolationKey,
    auditHandoff: {
      destination: 'operator-userland/audit-ledger',
      proofRequired: boundaryBlocked.length > 0 || approvals.some((approval) => approval.requiresProof) || lifecycleState.commands.some((command) => command.requiresProof),
      blockedRequestIds: boundaryBlocked.map((approval) => approval.id),
      permissionBlockedRequestIds: permissionBlocked.map((approval) => approval.id),
      transitionBlockedRequestIds: transitionBlocked.map((approval) => approval.id),
      lifecycleCommandIds: lifecycleState.commands.map((command) => command.id)
    },
    lifecycleNextAction: lifecycleState.nextAction,
    userVisibleLabel: permissionBoundaryBlocked
      ? `${clientState.permissionBoundary.validation.length} workspace permission binding${clientState.permissionBoundary.validation.length === 1 ? '' : 's'} need repair`
      : lifecycleBlocked
      ? `${lifecycleState.validation.length} lifecycle setting${lifecycleState.validation.length === 1 ? '' : 's'} need operator repair`
      : lifecycleReplay
        ? 'Interrupted lifecycle command ready for restart-safe replay'
      : lifecycleReady
        ? 'Lifecycle command ready for hosted-kernel execution'
        : transitionBlocked.length
      ? `${transitionBlocked.length} boundary transition${transitionBlocked.length === 1 ? '' : 's'} need operator repair`
      : boundaryBlocked.length
      ? `${boundaryBlocked.length} approval${boundaryBlocked.length === 1 ? '' : 's'} held by tenant boundary policy`
      : operatorActionQueue.handoffReadyCount
        ? `${operatorActionQueue.handoffReadyCount} approval${operatorActionQueue.handoffReadyCount === 1 ? '' : 's'} ready for runtime handoff`
        : operatorActionQueue.approvedBlockedCount
          ? `${operatorActionQueue.approvedBlockedCount} approved approval${operatorActionQueue.approvedBlockedCount === 1 ? '' : 's'} need handoff repair`
          : operatorActionQueue.proofWaitingCount
          ? `${operatorActionQueue.proofWaitingCount} approval${operatorActionQueue.proofWaitingCount === 1 ? '' : 's'} waiting for proof`
          : operatorActionQueue.decisionReadyCount
            ? `${operatorActionQueue.decisionReadyCount} approval${operatorActionQueue.decisionReadyCount === 1 ? '' : 's'} ready for operator decision`
      : pending.length
        ? `${pending.length} approval${pending.length === 1 ? '' : 's'} waiting for operator review`
        : nextAction === 'resume-hosted-kernel'
          ? 'Approved request ready to return to hosted kernel'
          : 'No approval handoff waiting'
  };
}

function collectProviderContracts(input) {
  if (Array.isArray(input.providerContracts)) {
    return input.providerContracts;
  }
  if (Array.isArray(input.providers)) {
    return input.providers;
  }
  if (input.providerContract) {
    return [input.providerContract];
  }
  if (input.provider) {
    return [input.provider];
  }
  return [{}];
}

function requiredProviderCapabilities(approvals, handoff, lifecycleState) {
  const required = new Set(['approval:decision', 'audit:append']);
  if (handoff.nextAction === 'resume-hosted-kernel') {
    required.add('handoff:resume');
  }
  if (handoff.boundaryHoldCount > 0) {
    required.add('boundary:review');
  }
  if (approvals.some((approval) => approval.boundaryTransition.changed)) {
    required.add('boundary:review');
  }
  if (approvals.some((approval) => approval.requiresProof) || lifecycleState.commands.some((command) => command.requiresProof)) {
    required.add('proof:attach');
  }
  if (lifecycleState.nextAction === 'apply-lifecycle-command') {
    required.add('lifecycle:apply');
  }
  if (lifecycleState.nextAction === 'replay-lifecycle-command') {
    required.add('lifecycle:apply');
    required.add('handoff:resume');
  }
  for (const approval of approvals) {
    for (const scopeEntry of approval.impact.requiredScopes) {
      required.add(scopeEntry);
    }
    for (const scopeEntry of approval.scope) {
      required.add(scopeEntry);
    }
  }
  return [...required].sort();
}

function buildImpactProviderObligations(approvals) {
  return approvals.flatMap((approval) => (
    approval.impact.categories.map((category) => {
      const rule = PROVIDER_IMPACT_RULES[category];
      const contract = category === 'external_write'
        ? approval.impact.externalWriteContract
        : category === 'destructive_action'
          ? approval.impact.destructiveActionContract
          : approval.impact.privilegedKernelChangeContract;
      return {
        requestId: approval.id,
        clientRequestId: approval.clientRequestId,
        category,
        providerCapability: rule.providerCapability,
        allowedHandoffModes: rule.allowedHandoffModes,
        allowedDispatchLanes: rule.allowedDispatchLanes,
        requiredProofRefs: rule.proofRefs,
        syncBarrier: rule.barrier,
        targetCount: Array.isArray(contract.targets)
          ? contract.targets.length
          : category === 'privileged_kernel_change' && contract.subsystem
            ? 1
            : 0,
        targetDigest: `sha256:${proofFor({
          category,
          requestId: approval.id,
          externalTargets: approval.impact.externalWriteContract.targets,
          destructiveTargets: approval.impact.destructiveActionContract.targets,
          kernelSubsystem: approval.impact.privilegedKernelChangeContract.subsystem,
          kernelPrivilegeScope: approval.impact.privilegedKernelChangeContract.privilegeScope
        })}`,
        impactProof: approval.impact.proof,
        proofBundleProof: approval.proofBundle.proof,
        boundaryTransitionProof: approval.boundaryTransition.proof,
        rollbackProof: approval.impact.destructiveActionContract.backupProof,
        kernelConfigDigest: approval.impact.privilegedKernelChangeContract.configDigest
      };
    })
  ));
}

function normalizeProviderImpactSupport(rawProvider, rawContract) {
  const rawImpact = asObject(rawProvider.impactSupport || rawProvider.impactContract || rawContract.impactSupport);
  const supportedTypes = normalizeScope(rawImpact.supportedTypes || rawImpact.impactTypes || rawProvider.supportedImpactTypes);
  const acceptedProofRefs = normalizeIdList(rawImpact.acceptedProofRefs || rawImpact.proofRefs || [
    'approvalImpactProof',
    'proofBundleProof',
    'boundaryTransitionProof'
  ]);
  const validation = [];

  for (const impactType of supportedTypes) {
    if (!APPROVAL_IMPACT_TYPES.has(impactType)) {
      validation.push(`provider.impact.type.unsupported:${impactType}`);
    }
  }

  return {
    format: 'approval-console.provider-impact-support.v1',
    supportedTypes: supportedTypes.filter((impactType) => APPROVAL_IMPACT_TYPES.has(impactType)),
    acceptedProofRefs,
    maxExternalTargets: normalizePositiveNumber(rawImpact.maxExternalTargets || rawProvider.maxExternalTargets, 25),
    destructiveActionsRequireManualExport: normalizeBoolean(rawImpact.destructiveActionsRequireManualExport, true),
    privilegedKernelChangesRequireOperatorLane: normalizeBoolean(rawImpact.privilegedKernelChangesRequireOperatorLane, true),
    validation
  };
}

function evaluateProviderImpactReadiness(provider, impactObligations) {
  const validation = [...provider.impactSupport.validation];
  const statuses = impactObligations.map((obligation) => {
    const typeSupported = provider.impactSupport.supportedTypes.includes(obligation.category)
      || provider.advertisedCapabilities.includes('*')
      || provider.advertisedCapabilities.includes('kernel:*');
    const capabilitySatisfied = providerHasCapability(obligation.providerCapability, provider.advertisedCapabilities);
    const handoffModeAllowed = obligation.allowedHandoffModes.includes(provider.handoffMode);
    const dispatchLaneAllowed = obligation.allowedDispatchLanes.includes(provider.dispatchPolicy.lane);
    const proofRefsAccepted = obligation.requiredProofRefs.filter((proofRef) => {
      const value = obligation[proofRef];
      return !value || provider.impactSupport.acceptedProofRefs.includes(proofRef);
    });
    const proofRefsMissing = obligation.requiredProofRefs.filter((proofRef) => {
      const value = obligation[proofRef];
      return value && !provider.impactSupport.acceptedProofRefs.includes(proofRef);
    });
    const externalTargetLimitOk = obligation.category !== 'external_write'
      || obligation.targetCount <= provider.impactSupport.maxExternalTargets;
    const destructiveManualExportOk = obligation.category !== 'destructive_action'
      || !provider.impactSupport.destructiveActionsRequireManualExport
      || provider.handoffMode === 'manual-export';
    const kernelOperatorLaneOk = obligation.category !== 'privileged_kernel_change'
      || !provider.impactSupport.privilegedKernelChangesRequireOperatorLane
      || provider.dispatchPolicy.lane === 'operator-mediated';
    const blockingReasons = [
      ...(!typeSupported ? ['provider.impact.type_not_supported'] : []),
      ...(!capabilitySatisfied ? [`provider.impact.capability_missing:${obligation.providerCapability}`] : []),
      ...(!handoffModeAllowed ? [`provider.impact.handoffMode_not_allowed:${obligation.category}`] : []),
      ...(!dispatchLaneAllowed ? [`provider.impact.dispatchLane_not_allowed:${obligation.category}`] : []),
      ...proofRefsMissing.map((proofRef) => `provider.impact.proof_ref_not_accepted:${proofRef}`),
      ...(!externalTargetLimitOk ? ['provider.impact.external_target_limit_exceeded'] : []),
      ...(!destructiveManualExportOk ? ['provider.impact.destructive_manual_export_required'] : []),
      ...(!kernelOperatorLaneOk ? ['provider.impact.kernel_operator_lane_required'] : [])
    ];

    validation.push(...blockingReasons);

    return {
      requestId: obligation.requestId,
      category: obligation.category,
      syncBarrier: obligation.syncBarrier,
      targetDigest: obligation.targetDigest,
      providerCapability: obligation.providerCapability,
      typeSupported,
      capabilitySatisfied,
      handoffModeAllowed,
      dispatchLaneAllowed,
      proofRefsAccepted,
      proofRefsMissing,
      satisfied: blockingReasons.length === 0,
      blockingReasons
    };
  });

  return {
    format: 'approval-console.provider-impact-readiness.v1',
    obligationCount: impactObligations.length,
    satisfiedObligationCount: statuses.filter((status) => status.satisfied).length,
    blockedRequestIds: [...new Set(statuses
      .filter((status) => !status.satisfied)
      .map((status) => status.requestId))],
    syncBarriers: [...new Set(statuses.map((status) => status.syncBarrier))],
    statuses,
    validation,
    ready: validation.length === 0
  };
}

function normalizeProviderSync(rawProvider, rawGlobalSync, now) {
  const rawSync = asObject(rawProvider.sync || rawProvider.syncMetadata || rawGlobalSync);
  const lastSyncedAt = asString(rawSync.lastSyncedAt || rawProvider.lastSyncedAt);
  const lastSyncedMs = lastSyncedAt ? parseTime(lastSyncedAt) : null;
  const leaseUntil = asString(rawSync.leaseUntil || rawProvider.leaseUntil);
  const leaseUntilMs = leaseUntil ? parseTime(leaseUntil) : null;
  const nowMs = parseTime(now);
  const expectedRevision = normalizeInteger(rawSync.expectedRevision || rawProvider.expectedRevision, 0);
  const observedRevision = normalizeInteger(rawSync.observedRevision || rawSync.revision || rawProvider.revision, expectedRevision);
  const cursor = asString(rawSync.cursor || rawSync.syncCursor || rawProvider.syncCursor, 'approval-console:initial');
  const validation = [];

  if (lastSyncedAt && lastSyncedMs === null) {
    validation.push('provider.sync.lastSyncedAt.invalid');
  }
  if (leaseUntil && leaseUntilMs === null) {
    validation.push('provider.sync.leaseUntil.invalid');
  }
  if (expectedRevision > observedRevision) {
    validation.push('provider.sync.revision_behind');
  }
  if (leaseUntilMs !== null && nowMs !== null && leaseUntilMs < nowMs) {
    validation.push('provider.sync.lease_expired');
  }

  return {
    cursor,
    expectedRevision,
    observedRevision,
    generation: asString(rawSync.generation || rawSync.epoch || rawProvider.generation, 'provider-generation:ephemeral'),
    watermark: asString(rawSync.watermark || rawSync.commitWatermark || rawProvider.watermark),
    source: asString(rawSync.source || rawProvider.syncSource, 'hosted-kernel/provider-sync'),
    lastSyncedAt,
    leaseUntil,
    dirty: rawSync.dirty === true || expectedRevision > observedRevision,
    state: validation.length
      ? 'blocked'
      : expectedRevision === observedRevision && lastSyncedAt
        ? 'in_sync'
        : 'sync_required',
    validation
  };
}

function normalizeProviderSla(rawProvider, rawContract) {
  const rawSla = asObject(rawProvider.sla || rawProvider.serviceLevel || rawContract.sla);
  const ackTimeoutMs = normalizePositiveNumber(rawSla.ackTimeoutMs || rawSla.ackTimeout, 60_000);
  const maxHandoffAgeMs = normalizePositiveNumber(rawSla.maxHandoffAgeMs || rawSla.maxAgeMs, 5 * 60_000);
  const requiresAck = normalizeBoolean(rawSla.requiresAck || rawSla.requireAcknowledgement, true);
  const validation = [];

  if (ackTimeoutMs > maxHandoffAgeMs) {
    validation.push('provider.sla.ack_timeout_exceeds_handoff_age');
  }
  if (maxHandoffAgeMs < 1_000) {
    validation.push('provider.sla.max_handoff_age_too_short');
  }

  return {
    requiresAck,
    ackTimeoutMs,
    maxHandoffAgeMs,
    retryClass: asString(rawSla.retryClass || rawSla.retry, 'provider-sync'),
    validation
  };
}

function normalizeProviderAcknowledgement(rawProvider, rawContract, now) {
  const rawAck = asObject(rawProvider.acknowledgement || rawProvider.handoffAck || rawContract.acknowledgement);
  const state = asString(rawAck.state || rawAck.status, 'not_required').toLowerCase();
  const acknowledgedAt = asString(rawAck.acknowledgedAt || rawAck.acceptedAt || rawAck.at);
  const expiresAt = asString(rawAck.expiresAt || rawAck.deadlineAt);
  const acknowledgedMs = acknowledgedAt ? parseTime(acknowledgedAt) : null;
  const expiresMs = expiresAt ? parseTime(expiresAt) : null;
  const nowMs = parseTime(now);
  const proof = asString(rawAck.proof || rawAck.digest);
  const normalizedState = PROVIDER_ACK_STATES.has(state) ? state : 'pending';
  const validation = [];

  if (!PROVIDER_ACK_STATES.has(state)) {
    validation.push('provider.ack.state.unsupported');
  }
  if (acknowledgedAt && acknowledgedMs === null) {
    validation.push('provider.ack.acknowledgedAt.invalid');
  }
  if (expiresAt && expiresMs === null) {
    validation.push('provider.ack.expiresAt.invalid');
  }
  if (expiresMs !== null && nowMs !== null && expiresMs < nowMs && normalizedState === 'pending') {
    validation.push('provider.ack.expired');
  }
  if (proof && !DIGEST_PATTERN.test(proof)) {
    validation.push('provider.ack.proof.sha256_required');
  }

  return {
    state: normalizedState,
    acknowledgedBy: asString(rawAck.acknowledgedBy || rawAck.providerId),
    acknowledgedAt,
    expiresAt,
    proof,
    validation
  };
}

function normalizeProviderDispatchPolicy(rawProvider, rawContract, input) {
  const rawDispatch = asObject(rawProvider.dispatch || rawProvider.dispatchPolicy || rawContract.dispatch || input.providerDispatch);
  const lane = asString(rawDispatch.lane || rawDispatch.queue || rawProvider.dispatchLane, 'interactive').toLowerCase();
  const maxPayloadBytes = normalizePositiveNumber(rawDispatch.maxPayloadBytes || rawDispatch.maxBytes, 64 * 1024);
  const dedupeWindowMs = normalizePositiveNumber(rawDispatch.dedupeWindowMs || rawDispatch.idempotencyWindowMs, 10 * 60_000);
  const requireOperatorAcceptedPreview = normalizeBoolean(rawDispatch.requireOperatorAcceptedPreview, true);
  const requireIdempotencyKey = normalizeBoolean(rawDispatch.requireIdempotencyKey, true);
  const validation = [];

  if (!PROVIDER_DISPATCH_LANES.has(lane)) {
    validation.push('provider.dispatch.lane.unsupported');
  }
  if (maxPayloadBytes < 1024) {
    validation.push('provider.dispatch.maxPayloadBytes_too_small');
  }
  if (dedupeWindowMs < 1_000) {
    validation.push('provider.dispatch.dedupeWindow_too_short');
  }

  return {
    lane: PROVIDER_DISPATCH_LANES.has(lane) ? lane : 'operator-mediated',
    requireOperatorAcceptedPreview,
    requireIdempotencyKey,
    maxPayloadBytes,
    dedupeWindowMs,
    retryTopic: asString(rawDispatch.retryTopic || rawDispatch.topic, 'approval-console.provider-dispatch'),
    validation
  };
}

function buildProviderHandoffEnvelope(now, clientState, approvals, lifecycleState, handoff, selectedProvider, requiredCapabilities, impactObligations, externalState, acknowledgementRequired, acknowledgementSatisfied) {
  const approvedApprovalIds = approvals
    .filter((approval) => approval.valid && approval.state === 'approved')
    .map((approval) => approval.id);
  const executableLifecycleCommandIds = lifecycleState.commands
    .filter((command) => (
      command.valid
      && (lifecycleState.executableCommandIds.includes(command.id) || lifecycleState.replayRequiredCommandIds.includes(command.id))
    ))
    .map((command) => command.id);
  const dispatchPolicy = selectedProvider
    ? selectedProvider.dispatchPolicy
    : {
      lane: 'operator-mediated',
      requireOperatorAcceptedPreview: true,
      requireIdempotencyKey: true,
      maxPayloadBytes: 0,
      dedupeWindowMs: 0,
      retryTopic: 'approval-console.provider-dispatch',
      validation: ['provider.dispatch.contract_missing']
    };
  const idempotencyKey = `${clientState.boundary.isolationKey}:${selectedProvider?.providerId || 'missing-provider'}:${handoff.nextAction}:${[
    ...approvedApprovalIds,
    ...executableLifecycleCommandIds
  ].join('|') || 'observe'}`;
  const obligations = {
    capabilities: requiredCapabilities,
    impactObligations: impactObligations.map((obligation) => ({
      requestId: obligation.requestId,
      category: obligation.category,
      providerCapability: obligation.providerCapability,
      syncBarrier: obligation.syncBarrier,
      targetDigest: obligation.targetDigest,
      requiredProofRefs: obligation.requiredProofRefs
    })),
    syncCursor: selectedProvider ? selectedProvider.sync.cursor : 'approval-console:initial',
    syncGeneration: selectedProvider ? selectedProvider.sync.generation : 'provider-generation:ephemeral',
    acknowledgementRequired,
    acknowledgementSatisfied,
    proofRequired: handoff.auditHandoff.proofRequired,
    operatorAcceptedPreviewRequired: dispatchPolicy.requireOperatorAcceptedPreview
  };
  const dispatchable = externalState === 'ready_for_external_handoff'
    && selectedProvider
    && dispatchPolicy.validation.length === 0;
  const envelopePayload = {
    surfaceId,
    generatedAt: now,
    providerId: selectedProvider ? selectedProvider.providerId : null,
    destination: selectedProvider ? selectedProvider.endpoint : clientState.handoffDestination,
    isolationKey: clientState.boundary.isolationKey,
    nextAction: handoff.nextAction,
    approvedApprovalIds,
    executableLifecycleCommandIds,
    idempotencyKey,
    obligations
  };

  return {
    format: 'approval-console.provider-handoff-envelope.v1',
    dispatchState: dispatchable
      ? 'dispatchable'
      : externalState === 'waiting_for_operator_state'
        ? 'deferred_until_operator_state'
        : 'blocked_by_provider_contract',
    lane: dispatchPolicy.lane,
    retryTopic: dispatchPolicy.retryTopic,
    destination: envelopePayload.destination,
    providerId: envelopePayload.providerId,
    isolationKey: envelopePayload.isolationKey,
    nextAction: handoff.nextAction,
    idempotencyKey,
    replayProtection: {
      required: dispatchPolicy.requireIdempotencyKey,
      dedupeWindowMs: dispatchPolicy.dedupeWindowMs,
      keyProof: `sha256:${proofFor({ idempotencyKey, providerId: envelopePayload.providerId })}`
    },
    sync: {
      cursor: obligations.syncCursor,
      generation: obligations.syncGeneration,
      watermark: selectedProvider ? selectedProvider.sync.watermark : '',
      expectedRevision: selectedProvider ? selectedProvider.sync.expectedRevision : 0,
      observedRevision: selectedProvider ? selectedProvider.sync.observedRevision : 0,
      impactBarriers: [...new Set(impactObligations.map((obligation) => obligation.syncBarrier))]
    },
    obligations,
    impactReadiness: selectedProvider ? selectedProvider.impactReadiness : {
      format: 'approval-console.provider-impact-readiness.v1',
      obligationCount: impactObligations.length,
      satisfiedObligationCount: 0,
      blockedRequestIds: impactObligations.map((obligation) => obligation.requestId),
      syncBarriers: [...new Set(impactObligations.map((obligation) => obligation.syncBarrier))],
      statuses: [],
      validation: ['provider.impact.provider_missing'],
      ready: false
    },
    validation: [
      ...dispatchPolicy.validation,
      ...(selectedProvider ? selectedProvider.impactReadiness.validation : ['provider.impact.provider_missing'])
    ],
    payloadDigest: `sha256:${proofFor(envelopePayload)}`,
    proof: `sha256:${proofFor({ ...envelopePayload, dispatchState: externalState, lane: dispatchPolicy.lane })}`
  };
}

function normalizeProviderContract(rawContract, index, input, now, requiredCapabilities, impactObligations) {
  const raw = asObject(rawContract);
  const contract = asObject(raw.contract || raw.serviceContract);
  const sync = normalizeProviderSync(raw, input.sync || input.syncMetadata, now);
  const sla = normalizeProviderSla(raw, contract);
  const acknowledgement = normalizeProviderAcknowledgement(raw, contract, now);
  const dispatchPolicy = normalizeProviderDispatchPolicy(raw, contract, input);
  const impactSupport = normalizeProviderImpactSupport(raw, contract);
  const advertisedCapabilities = normalizeScope(
    raw.advertisedCapabilities || raw.capabilities || contract.capabilities || PROVIDER_DEFAULT_CAPABILITIES
  );
  const missingCapabilities = requiredCapabilities.filter((capability) => !providerHasCapability(capability, advertisedCapabilities));
  const handoffMode = asString(raw.handoffMode || contract.handoffMode, 'proofed-external-call');
  const validation = [...sync.validation, ...sla.validation, ...acknowledgement.validation, ...dispatchPolicy.validation];
  const providerId = asString(raw.providerId || raw.id || contract.providerId, `hosted-kernel-provider:${index + 1}`);
  const endpoint = asString(raw.endpoint || raw.route || contract.endpoint, 'hosted-kernel/request-runtime');
  const protocol = asString(raw.protocol || contract.protocol, 'approval-console.provider.v1');

  if (!providerId) {
    validation.push('provider.id.required');
  }
  if (!endpoint) {
    validation.push('provider.endpoint.required');
  }
  if (protocol !== 'approval-console.provider.v1') {
    validation.push('provider.protocol.unsupported');
  }
  if (!PROVIDER_HANDOFF_MODES.has(handoffMode)) {
    validation.push('provider.handoffMode.unsupported');
  }
  if (missingCapabilities.length) {
    validation.push('provider.capability.missing');
  }
  if (sla.requiresAck && acknowledgement.state === 'rejected') {
    validation.push('provider.ack.rejected');
  }

  const impactReadiness = evaluateProviderImpactReadiness({
    advertisedCapabilities,
    impactSupport,
    handoffMode,
    dispatchPolicy
  }, impactObligations);
  validation.push(...impactReadiness.validation);

  return {
    providerId,
    service: asString(raw.service || raw.kind || contract.service, 'hosted-kernel-runtime'),
    protocol,
    endpoint,
    version: asString(raw.version || contract.version, '1.0'),
    advertisedCapabilities,
    requiredCapabilities,
    missingCapabilities,
    sync,
    capabilityNegotiation: requiredCapabilities.map((capability) => ({
      capability,
      satisfied: providerHasCapability(capability, advertisedCapabilities),
      acceptedAlternatives: PROVIDER_CAPABILITY_ALIASES[capability] || []
    })),
    sla,
    acknowledgement,
    dispatchPolicy,
    impactSupport,
    impactReadiness,
    handoffMode,
    ready: validation.length === 0 && !sync.dirty,
    validation
  };
}

function buildProviderIntegration(now, clientState, approvals, lifecycleState, handoff, input) {
  const requiredCapabilities = requiredProviderCapabilities(approvals, handoff, lifecycleState);
  const impactObligations = buildImpactProviderObligations(approvals);
  const providers = collectProviderContracts(input).map((provider, index) => (
    normalizeProviderContract(provider, index, input, now, requiredCapabilities, impactObligations)
  ));
  const preferredProviderId = asString(input.preferredProviderId || asObject(input.providerContract).providerId);
  const selectedProvider = providers.find((provider) => provider.providerId === preferredProviderId)
    || providers.find((provider) => provider.ready)
    || providers[0];
  const blockedProviders = providers.filter((provider) => provider.validation.length > 0 || provider.sync.state === 'blocked');
  const syncRequiredProviders = providers.filter((provider) => provider.sync.state === 'sync_required' || provider.sync.dirty);
  const acknowledgementRequired = selectedProvider?.sla.requiresAck === true
    && (handoff.nextAction === 'resume-hosted-kernel'
      || handoff.nextAction === 'apply-lifecycle-command'
      || handoff.nextAction === 'replay-lifecycle-command');
  const acknowledgementSatisfied = !acknowledgementRequired
    || selectedProvider?.acknowledgement.state === 'accepted';
  const externalState = !selectedProvider
    ? 'provider_contract_missing'
    : selectedProvider.validation.length > 0
      ? 'provider_contract_blocked'
      : selectedProvider.sync.state !== 'in_sync'
        ? 'provider_sync_required'
        : acknowledgementRequired && !acknowledgementSatisfied
          ? selectedProvider.acknowledgement.state === 'expired'
            ? 'provider_ack_expired'
            : 'provider_ack_required'
        : handoff.nextAction === 'resume-hosted-kernel' || handoff.nextAction === 'apply-lifecycle-command' || handoff.nextAction === 'replay-lifecycle-command'
          ? 'ready_for_external_handoff'
          : 'waiting_for_operator_state';
  const handoffEnvelope = buildProviderHandoffEnvelope(
    now,
    clientState,
    approvals,
    lifecycleState,
    handoff,
    selectedProvider,
    requiredCapabilities,
    impactObligations,
    externalState,
    acknowledgementRequired,
    acknowledgementSatisfied
  );
  const payload = {
    surfaceId,
    generatedAt: now,
    isolationKey: clientState.boundary.isolationKey,
    handoffNextAction: handoff.nextAction,
    selectedProviderId: selectedProvider ? selectedProvider.providerId : null,
    requiredCapabilities,
    impactObligationCount: impactObligations.length,
    impactBlockedRequestIds: selectedProvider ? selectedProvider.impactReadiness.blockedRequestIds : [],
    approvalIds: approvals.map((approval) => approval.id),
    lifecycleCommandIds: lifecycleState.commands.map((command) => command.id),
    acknowledgementState: selectedProvider ? selectedProvider.acknowledgement.state : 'not_required',
    syncGeneration: selectedProvider ? selectedProvider.sync.generation : '',
    handoffEnvelopeProof: handoffEnvelope.proof
  };

  return {
    contractName: 'operator-userland.approval-console.provider.v1',
    requiredFields: PROVIDER_REQUIRED_FIELDS,
    requiredCapabilities,
    impactObligations,
    selectedProviderId: selectedProvider ? selectedProvider.providerId : null,
    providers,
    negotiation: {
      status: blockedProviders.length
        ? 'blocked'
        : syncRequiredProviders.length
          ? 'sync_required'
          : acknowledgementRequired && !acknowledgementSatisfied
            ? 'ack_required'
          : 'ready',
      blockedProviderIds: blockedProviders.map((provider) => provider.providerId),
      syncRequiredProviderIds: syncRequiredProviders.map((provider) => provider.providerId),
      ackRequiredProviderIds: acknowledgementRequired && !acknowledgementSatisfied && selectedProvider
        ? [selectedProvider.providerId]
        : [],
      dispatchReadyProviderIds: providers
        .filter((provider) => provider.ready && provider.dispatchPolicy.validation.length === 0)
        .map((provider) => provider.providerId),
      missingCapabilities: [...new Set(providers.flatMap((provider) => provider.missingCapabilities))].sort(),
      impactBlockedProviderIds: providers
        .filter((provider) => provider.impactReadiness.validation.length > 0)
        .map((provider) => provider.providerId),
      impactBlockedRequestIds: [...new Set(providers.flatMap((provider) => provider.impactReadiness.blockedRequestIds))].sort(),
      impactSyncBarriers: [...new Set(impactObligations.map((obligation) => obligation.syncBarrier))].sort()
    },
    externalHandoff: {
      state: externalState,
      destination: selectedProvider ? selectedProvider.endpoint : clientState.handoffDestination,
      providerId: selectedProvider ? selectedProvider.providerId : null,
      syncCursor: selectedProvider ? selectedProvider.sync.cursor : 'approval-console:initial',
      syncGeneration: selectedProvider ? selectedProvider.sync.generation : 'provider-generation:ephemeral',
      acknowledgement: selectedProvider ? selectedProvider.acknowledgement : { state: 'not_required', validation: [] },
      handoffMode: selectedProvider ? selectedProvider.handoffMode : 'proofed-external-call',
      ackRequired: acknowledgementRequired,
      ackSatisfied: acknowledgementSatisfied,
      serviceLevel: selectedProvider ? selectedProvider.sla : null,
      dispatchPolicy: selectedProvider ? selectedProvider.dispatchPolicy : handoffEnvelope.replayProtection,
      impactReadiness: selectedProvider ? selectedProvider.impactReadiness : handoffEnvelope.impactReadiness,
      handoffEnvelope,
      payloadFormat: 'approval-console.external-handoff.v1',
      payloadProof: `sha256:${proofFor(payload)}`
    }
  };
}

function impactCommandPlanForApproval(approval) {
  const commands = [];
  if (approval.impact.externalWrite) {
    const contract = approval.impact.externalWriteContract;
    commands.push({
      requestId: approval.id,
      category: 'external_write',
      idempotencyKey: contract.idempotencyKey,
      targetDigest: `sha256:${proofFor({
        requestId: approval.id,
        category: 'external_write',
        targets: contract.targets,
        writeMode: contract.writeMode,
        payloadClass: contract.payloadClass,
        endpointProof: contract.endpointProof
      })}`,
      barrier: PROVIDER_IMPACT_RULES.external_write.barrier,
      proofRefs: {
        approvalImpactProof: approval.impact.proof,
        proofBundleProof: approval.proofBundle.proof,
        boundaryTransitionProof: approval.boundaryTransition.proof,
        rollbackProof: '',
        kernelConfigDigest: ''
      }
    });
  }
  if (approval.impact.destructiveAction) {
    const contract = approval.impact.destructiveActionContract;
    commands.push({
      requestId: approval.id,
      category: 'destructive_action',
      idempotencyKey: `${approval.boundaryPolicy.isolationKey}:destructive:${approval.id}:${contract.proof}`,
      targetDigest: `sha256:${proofFor({
        requestId: approval.id,
        category: 'destructive_action',
        targets: contract.targets,
        rollbackPlan: contract.rollbackPlan,
        backupProof: contract.backupProof,
        irreversible: contract.irreversible
      })}`,
      barrier: PROVIDER_IMPACT_RULES.destructive_action.barrier,
      proofRefs: {
        approvalImpactProof: approval.impact.proof,
        proofBundleProof: approval.proofBundle.proof,
        boundaryTransitionProof: approval.boundaryTransition.proof,
        rollbackProof: contract.backupProof,
        kernelConfigDigest: ''
      }
    });
  }
  if (approval.impact.privilegedKernelChange) {
    const contract = approval.impact.privilegedKernelChangeContract;
    commands.push({
      requestId: approval.id,
      category: 'privileged_kernel_change',
      idempotencyKey: `${approval.boundaryPolicy.isolationKey}:kernel:${approval.id}:${contract.configDigest || contract.proof}`,
      targetDigest: `sha256:${proofFor({
        requestId: approval.id,
        category: 'privileged_kernel_change',
        subsystem: contract.subsystem,
        privilegeScope: contract.privilegeScope,
        changeWindow: contract.changeWindow,
        approverGroup: contract.approverGroup,
        configDigest: contract.configDigest
      })}`,
      barrier: PROVIDER_IMPACT_RULES.privileged_kernel_change.barrier,
      proofRefs: {
        approvalImpactProof: approval.impact.proof,
        proofBundleProof: approval.proofBundle.proof,
        boundaryTransitionProof: approval.boundaryTransition.proof,
        rollbackProof: '',
        kernelConfigDigest: contract.configDigest
      }
    });
  }

  return commands.map((command) => ({
    ...command,
    commandDigest: `sha256:${proofFor({
      requestId: command.requestId,
      category: command.category,
      idempotencyKey: command.idempotencyKey,
      targetDigest: command.targetDigest,
      barrier: command.barrier,
      proofRefs: command.proofRefs
    })}`
  }));
}

function buildClientRuntimeHandoff(now, clientState, approvals, lifecycleState, providerIntegration, baseHandoff, persistedState) {
  const approvalsWithRecovery = approvals.map((approval) => {
    const intentDigest = `sha256:${proofFor(approvalIntentDigestPayload({
      requestId: approval.id,
      action: approval.action,
      target: approval.target,
      proofRequired: approval.requiresProof,
      isolationKey: approval.boundaryPolicy.isolationKey,
      boundaryTransition: approval.boundaryTransition
    }))}`;
    const journalEntry = persistedState.journal.find((entry) => (
      entry.kind === 'approval-resume' && entry.id === approval.id && entry.digest === intentDigest
    ));
    const impactCommands = impactCommandPlanForApproval(approval);
    const impactRecovery = impactCommands.map((command) => {
      const persistedCommand = persistedState.impactCommands.find((entry) => (
        entry.requestId === approval.id
        && entry.category === command.category
        && entry.idempotencyKey === command.idempotencyKey
        && entry.commandDigest === command.commandDigest
      ));
      return {
        ...command,
        persistedStatus: persistedCommand ? persistedCommand.status : 'absent',
        persistedProof: persistedCommand ? persistedCommand.proof : '',
        recoveredApplied: persistedCommand?.committed === true || persistedCommand?.terminal === true,
        replayRequired: persistedCommand?.replayable === true,
        failed: persistedCommand?.failed === true
      };
    });
    const impactRecovered = impactCommands.length > 0 && impactRecovery.every((entry) => entry.recoveredApplied);
    const impactReplayable = impactRecovery.some((entry) => entry.replayRequired) && !impactRecovered;
    const impactFailed = impactRecovery.some((entry) => entry.failed);
    const recoveredApplied = persistedState.recovered && (
      persistedState.appliedApprovalIds.includes(approval.id)
      || persistedState.appliedApprovalIds.includes(approval.clientRequestId)
      || persistedState.commandDigests[approval.id] === intentDigest
      || journalEntry?.committed === true
      || impactRecovered
    );
    const replayable = persistedState.recovered && (journalEntry?.replayable === true || impactReplayable) && !recoveredApplied;
    const failed = journalEntry?.failed === true || impactFailed;
    return {
      ...approval,
      idempotencyKey: `${approval.boundaryPolicy.isolationKey}:approval:${approval.id}`,
      intentDigest,
      impactCommands: impactRecovery,
      persistedJournalStatus: journalEntry ? journalEntry.status : 'absent',
      recoveredApplied,
      recoveryReplayRequired: replayable,
      recoveryStatus: recoveredApplied
        ? 'already_resumed'
        : failed
          ? 'failed_requires_operator_review'
          : replayable
            ? 'commit_in_flight_replay_required'
        : persistedState.recoveryMode === 'checkpoint_repair_required'
          ? 'checkpoint_blocked'
          : 'pending'
    };
  });
  const resumableApprovals = approvalsWithRecovery.filter((approval) => (
    approval.valid
    && approval.state === 'approved'
    && approval.workflowHandoff.resumeCandidate
    && !approval.recoveredApplied
    && approval.recoveryStatus !== 'failed_requires_operator_review'
  ));
  const executableCommands = lifecycleState.commands.filter((command) => (
    command.valid && lifecycleState.executableCommandIds.includes(command.id) && !command.recoveredApplied
  ));
  const pendingApprovals = approvalsWithRecovery.filter((approval) => approval.state === 'requested');
  const recoveredApprovalIds = approvalsWithRecovery
    .filter((approval) => approval.recoveredApplied)
    .map((approval) => approval.id);
  const replayRequiredApprovalIds = approvalsWithRecovery
    .filter((approval) => approval.recoveryReplayRequired)
    .map((approval) => approval.id);
  const blockedReasons = [
    ...approvalsWithRecovery
      .filter((approval) => !approval.valid)
      .flatMap((approval) => approval.validation.map((reason) => `${approval.id}:${reason}`)),
    ...approvalsWithRecovery
      .filter((approval) => approval.recoveryStatus === 'failed_requires_operator_review')
      .map((approval) => `${approval.id}:approval.recovery.failed_intent`),
    ...approvalsWithRecovery
      .filter((approval) => approval.workflowAcceptance.required && !approval.workflowAcceptance.accepted)
      .flatMap((approval) => approval.workflowAcceptance.validation.length
        ? approval.workflowAcceptance.validation.map((reason) => `${approval.id}:${reason}`)
        : [`${approval.id}:approval.workflow.acceptance_required`]),
    ...clientState.permissionBoundary.validation.map((reason) => `permissionBoundary:${reason}`),
    ...lifecycleState.validation.map((reason) => `lifecycle:${reason}`),
    ...providerIntegration.negotiation.missingCapabilities.map((reason) => `provider.capability:${reason}`),
    ...providerIntegration.negotiation.impactBlockedRequestIds.map((requestId) => `provider.impact:${requestId}`)
  ];
  const providerReady = providerIntegration.externalHandoff.state === 'ready_for_external_handoff';
  const shouldResume = baseHandoff.nextAction === 'resume-hosted-kernel';
  const shouldApplyLifecycle = baseHandoff.nextAction === 'apply-lifecycle-command' || baseHandoff.nextAction === 'replay-lifecycle-command';
  const ready = providerReady && blockedReasons.length === 0 && (
    (shouldResume && resumableApprovals.length > 0) || (shouldApplyLifecycle && executableCommands.length > 0)
  );
  const resumeIntents = resumableApprovals.map((approval) => ({
    requestId: approval.id,
    clientRequestId: approval.clientRequestId,
    action: approval.action,
    target: approval.target,
    risk: approval.risk,
    impact: {
      format: approval.impact.format,
      categories: approval.impact.categories,
      primaryCategory: approval.impact.primaryCategory,
      externalWrite: approval.impact.externalWrite,
      destructiveAction: approval.impact.destructiveAction,
      privilegedKernelChange: approval.impact.privilegedKernelChange,
      externalTargets: approval.impact.externalTargets,
      requiredRole: approval.impact.requiredRole,
      minimumRisk: approval.impact.minimumRisk,
      requiredScopes: approval.impact.requiredScopes,
      proof: approval.impact.proof
    },
    impactCommands: approval.impactCommands.map((command) => ({
      requestId: command.requestId,
      category: command.category,
      idempotencyKey: command.idempotencyKey,
      commandDigest: command.commandDigest,
      targetDigest: command.targetDigest,
      barrier: command.barrier,
      proofRefs: command.proofRefs,
      persistedStatus: command.persistedStatus,
      persistedProof: command.persistedProof
    })),
    workflowAcceptance: {
      format: approval.workflowAcceptance.format,
      required: approval.workflowAcceptance.required,
      accepted: approval.workflowAcceptance.accepted,
      acceptedImpactCategories: approval.workflowAcceptance.acceptedImpactCategories,
      handoffMode: approval.workflowAcceptance.handoffMode,
      dispatchLane: approval.workflowAcceptance.dispatchLane,
      proof: approval.workflowAcceptance.acceptanceProof
    },
    decidedBy: approval.decidedBy,
    scope: approval.boundaryPolicy.grantedScopes,
    proofRequired: approval.requiresProof,
    isolationKey: approval.boundaryPolicy.isolationKey,
    workspaceScope: {
      format: approval.boundaryPolicy.workspaceScope.format,
      scopeClass: approval.boundaryPolicy.workspaceScope.scopeClass,
      target: approval.boundaryPolicy.workspaceScope.target,
      activeBindingIds: approval.boundaryPolicy.workspaceScope.activeBindingIds,
      grantRoleSatisfied: approval.boundaryPolicy.workspaceScope.grantRoleSatisfied,
      grantScopeSatisfied: approval.boundaryPolicy.workspaceScope.grantScopeSatisfied,
      proof: approval.boundaryPolicy.workspaceScope.proof
    },
    boundaryTransition: {
      format: approval.boundaryTransition.format,
      kind: approval.boundaryTransition.kind,
      sourceIsolationKey: approval.boundaryTransition.source.isolationKey,
      targetIsolationKey: approval.boundaryTransition.target.isolationKey,
      changed: approval.boundaryTransition.changed,
      proof: approval.boundaryTransition.proof
    }
  }));
  const commandIntents = executableCommands.map((command) => ({
    commandId: command.id,
    command: command.command,
    targetState: command.targetState,
    scheduledFor: command.scheduledFor,
    requestedBy: command.requestedBy,
    proofRequired: command.requiresProof,
    isolationKey: clientState.boundary.isolationKey
  }));
  const packet = {
    surfaceId,
    generatedAt: now,
    format: 'approval-console.client-runtime-handoff.v1',
    clientId: clientState.clientId,
    sessionId: clientState.sessionId,
    route: clientState.route,
    destination: providerIntegration.externalHandoff.destination,
    providerId: providerIntegration.selectedProviderId,
    isolationKey: clientState.boundary.isolationKey,
    nextAction: ready
      ? baseHandoff.nextAction
      : blockedReasons.length
        ? 'repair-before-runtime-handoff'
        : replayRequiredApprovalIds.length || lifecycleState.replayRequiredCommandIds.length || approvalsWithRecovery.some((approval) => approval.impactCommands.some((command) => command.replayRequired))
          ? 'replay-interrupted-runtime-intent'
        : recoveredApprovalIds.length || lifecycleState.recoveredCommandIds.length || approvalsWithRecovery.some((approval) => approval.impactCommands.some((command) => command.recoveredApplied))
          ? 'observe-recovered-runtime-state'
        : pendingApprovals.length
          ? 'wait-for-operator-decision'
          : providerReady
            ? 'observe-runtime-state'
            : providerIntegration.externalHandoff.state,
    resumeIntents,
    lifecycleCommandIntents: commandIntents,
    pendingRequestIds: pendingApprovals.map((approval) => approval.id),
    blockedReasons,
    syncCursor: providerIntegration.externalHandoff.syncCursor,
    persistence: {
      format: persistedState.format,
      recoveryMode: persistedState.recoveryMode,
      revision: persistedState.revision,
      nextRevision: persistedState.nextRevision,
      recoveredApprovalIds,
      recoveredLifecycleCommandIds: lifecycleState.recoveredCommandIds,
      replayRequiredApprovalIds,
      replayRequiredLifecycleCommandIds: lifecycleState.replayRequiredCommandIds,
      recoveredImpactCommandIds: approvalsWithRecovery
        .flatMap((approval) => approval.impactCommands)
        .filter((command) => command.recoveredApplied)
        .map((command) => `${command.requestId}:${command.category}`),
      replayRequiredImpactCommandIds: approvalsWithRecovery
        .flatMap((approval) => approval.impactCommands)
        .filter((command) => command.replayRequired)
        .map((command) => `${command.requestId}:${command.category}`),
      checkpointProof: persistedState.checkpointProof,
      validation: persistedState.validation
    }
  };

  return {
    ...packet,
    ready,
    proof: `sha256:${proofFor(packet)}`,
    userVisibleWorkflow: {
      primaryAction: ready
        ? shouldApplyLifecycle
          ? 'Apply lifecycle command'
          : 'Resume hosted kernel'
        : packet.nextAction === 'wait-for-operator-decision'
          ? 'Continue review'
        : packet.nextAction === 'repair-before-runtime-handoff'
            ? 'Repair blocked handoff'
            : packet.nextAction === 'replay-interrupted-runtime-intent'
              ? 'Replay interrupted handoff'
            : 'Sync provider runtime',
      resumeCount: resumeIntents.length,
      lifecycleCommandCount: commandIntents.length,
      recoveredCount: recoveredApprovalIds.length + lifecycleState.recoveredCommandIds.length,
      blockedCount: blockedReasons.length,
      destinationLabel: providerIntegration.externalHandoff.destination
    }
  };
}

function buildPersistedStateUpdate(now, clientState, lifecycleState, clientRuntimeHandoff, previewAcceptance, persistedState) {
  const previousApprovalIds = new Set(persistedState.appliedApprovalIds);
  const previousLifecycleCommandIds = new Set(persistedState.appliedLifecycleCommandIds);
  const previousDigests = { ...persistedState.commandDigests };
  const previousImpactCommands = persistedState.impactCommands.filter((entry) => entry.validation.length === 0);
  const accepted = previewAcceptance.acceptance.accepted;
  const runtimeReady = clientRuntimeHandoff.ready;
  const resumableIntents = clientRuntimeHandoff.resumeIntents.map((intent) => ({
    kind: 'approval-resume',
    id: intent.requestId,
    digest: `sha256:${proofFor(approvalIntentDigestPayload(intent))}`,
    previewId: `approval:${intent.requestId}`,
    impactCommands: intent.impactCommands
  }));
  const lifecycleIntents = clientRuntimeHandoff.lifecycleCommandIntents.map((intent) => ({
    kind: 'lifecycle-apply',
    id: intent.commandId,
    digest: `sha256:${proofFor(lifecycleIntentDigestPayload(intent))}`,
    previewId: `lifecycle:${intent.commandId}`
  }));
  const commitCandidates = [...resumableIntents, ...lifecycleIntents];
  const acceptedPreviewIds = new Set(previewAcceptance.acceptance.acceptedPreviewIds);
  const acceptedCommitCandidates = commitCandidates.filter((intent) => acceptedPreviewIds.has(intent.previewId));
  const blockedCommitCandidates = commitCandidates.filter((intent) => !acceptedPreviewIds.has(intent.previewId));
  const shouldCommit = runtimeReady && accepted && persistedState.validation.length === 0;
  const acceptedImpactCommands = acceptedCommitCandidates.flatMap((intent) => intent.impactCommands || []);
  const activeImpactKeys = new Set(acceptedImpactCommands.map((command) => (
    `${command.category}:${command.requestId}:${command.idempotencyKey}:${command.commandDigest}`
  )));

  for (const intent of acceptedCommitCandidates) {
    previousDigests[intent.id] = intent.digest;
    if (intent.kind === 'approval-resume') {
      previousApprovalIds.add(intent.id);
    } else {
      previousLifecycleCommandIds.add(intent.id);
    }
  }

  for (const id of clientRuntimeHandoff.persistence.recoveredApprovalIds) {
    previousApprovalIds.add(id);
  }
  for (const id of lifecycleState.recoveredCommandIds) {
    previousLifecycleCommandIds.add(id);
  }

  const existingJournal = persistedState.journal.filter((entry) => (
    entry.validation.length === 0
    && !acceptedCommitCandidates.some((intent) => intent.id === entry.id && intent.kind === entry.kind)
  ));
  const activeJournal = commitCandidates.map((intent) => ({
    id: intent.id,
    kind: intent.kind,
    status: shouldCommit && acceptedPreviewIds.has(intent.previewId) ? 'committed' : 'staged',
    digest: intent.digest,
    isolationKey: clientState.boundary.isolationKey,
    attempts: 0,
    createdAt: now,
    lastAttemptAt: shouldCommit ? now : '',
    previewId: intent.previewId,
      proof: `sha256:${proofFor({
        id: intent.id,
        kind: intent.kind,
        status: shouldCommit && acceptedPreviewIds.has(intent.previewId) ? 'committed' : 'staged',
      digest: intent.digest,
      isolationKey: clientState.boundary.isolationKey,
      createdAt: now
    })}`
  }));
  const retainedImpactCommands = previousImpactCommands
    .filter((entry) => !activeImpactKeys.has(`${entry.category}:${entry.requestId}:${entry.idempotencyKey}:${entry.commandDigest}`))
    .map(({ validation: _validation, replayable: _replayable, committed: _committed, failed: _failed, terminal: _terminal, ...entry }) => entry);
  const activeImpactCommands = acceptedImpactCommands.map((command) => {
    const status = shouldCommit ? 'committed' : 'staged';
    return {
      format: 'approval-console.persisted-impact-command.v1',
      id: `${command.requestId}:${command.category}:${proofFor({
        idempotencyKey: command.idempotencyKey,
        commandDigest: command.commandDigest
      }).slice(0, 12)}`,
      requestId: command.requestId,
      category: command.category,
      status,
      idempotencyKey: command.idempotencyKey,
      commandDigest: command.commandDigest,
      targetDigest: command.targetDigest,
      barrier: command.barrier,
      isolationKey: clientState.boundary.isolationKey,
      stagedAt: now,
      committedAt: shouldCommit ? now : '',
      proofRefs: command.proofRefs,
      proof: `sha256:${proofFor({
        requestId: command.requestId,
        category: command.category,
        status,
        idempotencyKey: command.idempotencyKey,
        commandDigest: command.commandDigest,
        targetDigest: command.targetDigest,
        proofRefs: command.proofRefs
      })}`
    };
  });
  const nextImpactCommands = [...retainedImpactCommands, ...activeImpactCommands].slice(-100);
  const nextJournal = [...existingJournal, ...activeJournal]
    .slice(-100)
    .map(({ validation: _validation, replayable: _replayable, committed: _committed, failed: _failed, ...entry }) => entry);
  const checkpoint = {
    format: 'approval-console.persisted-state.v1',
    revision: persistedState.nextRevision,
    epoch: persistedState.epoch,
    tenantId: clientState.boundary.tenantId,
    workspaceId: clientState.boundary.workspaceId,
    isolationKey: clientState.boundary.isolationKey,
    lastMaterializedAt: now,
    applied: {
      approvalIds: [...previousApprovalIds].sort(),
      lifecycleCommandIds: [...previousLifecycleCommandIds].sort()
    },
    commandDigests: Object.fromEntries(Object.entries(previousDigests).sort(([left], [right]) => left.localeCompare(right))),
    journal: nextJournal,
    impactCommands: nextImpactCommands,
    sourceCheckpointProof: persistedState.checkpointProof
  };
  const checkpointProof = `sha256:${proofFor(checkpoint)}`;
  const validation = [
    ...persistedState.validation,
    ...(runtimeReady && !accepted ? ['persistence.commit.preview_acceptance_required'] : []),
    ...blockedCommitCandidates.map((intent) => `${intent.previewId}:persistence.commit.preview_not_accepted`)
  ];
  const restartSafeStatus = validation.some((entry) => entry.startsWith('persistence.isolationKey') || entry.startsWith('persistence.lastMaterializedAt') || entry.startsWith('persistence.proof'))
    ? 'checkpoint_repair_required'
    : clientRuntimeHandoff.persistence.replayRequiredApprovalIds.length || lifecycleState.replayRequiredCommandIds.length || nextImpactCommands.some((entry) => entry.status === 'staged')
      ? 'replay_required'
    : shouldCommit
      ? 'commit_ready'
      : clientRuntimeHandoff.persistence.recoveredApprovalIds.length || lifecycleState.recoveredCommandIds.length
        ? 'idempotent_replay_suppressed'
        : runtimeReady
          ? 'awaiting_operator_acceptance'
          : clientRuntimeHandoff.nextAction === 'provider_sync_required'
            ? 'awaiting_provider_sync'
            : clientRuntimeHandoff.nextAction === 'provider_ack_required' || clientRuntimeHandoff.nextAction === 'provider_ack_expired'
              ? 'awaiting_provider_ack'
            : 'materialized';

  return {
    format: 'approval-console.persisted-state-update.v1',
    writePolicy: 'append_only_replace_by_revision',
    commitStatus: shouldCommit ? 'commit_checkpoint' : 'do_not_commit',
    restartSafeStatus,
    nextCheckpoint: {
      ...checkpoint,
      proof: checkpointProof
    },
    appliedApprovalIds: checkpoint.applied.approvalIds,
    appliedLifecycleCommandIds: checkpoint.applied.lifecycleCommandIds,
    committedIntentIds: shouldCommit ? acceptedCommitCandidates.map((intent) => intent.id) : [],
    stagedIntentIds: commitCandidates.map((intent) => intent.id),
    impactCommandIds: nextImpactCommands.map((entry) => entry.id),
    committedImpactCommandIds: nextImpactCommands.filter((entry) => entry.status === 'committed').map((entry) => entry.id),
    stagedImpactCommandIds: nextImpactCommands.filter((entry) => entry.status === 'staged').map((entry) => entry.id),
    suppressedReplayIds: [
      ...clientRuntimeHandoff.persistence.recoveredApprovalIds,
      ...lifecycleState.recoveredCommandIds
    ].sort(),
    validation,
    proof: `sha256:${proofFor({
      checkpoint,
      commitStatus: shouldCommit ? 'commit_checkpoint' : 'do_not_commit',
      restartSafeStatus,
      stagedIntentIds: commitCandidates.map((intent) => intent.id),
      impactCommandIds: nextImpactCommands.map((entry) => entry.id),
      validation
    })}`
  };
}

function buildOperationalHealth(now, input, clientState, approvals, lifecycleState, providerIntegration, clientRuntimeHandoff, previewAcceptance, persistedState, persistedStateUpdate) {
  const retryPolicy = normalizeRetryPolicy(input);
  const healthSlo = normalizeOperationalHealthSlo(input);
  const nowMs = parseTime(now);
  const providerFailures = providerIntegration.providers.flatMap((provider) => (
    provider.validation.map((reason) => ({
      code: reason,
      source: `provider:${provider.providerId}`,
      providerId: provider.providerId,
      action: reason === 'provider.capability.missing'
        ? 'register-provider-capability'
        : reason.startsWith('provider.sync.')
          ? 'refresh-provider-sync'
        : 'repair-provider-contract'
    }))
  ));
  const providerSloFailures = providerIntegration.providers.flatMap((provider) => {
    const failures = [];
    const lastSyncedMs = provider.sync.lastSyncedAt ? parseTime(provider.sync.lastSyncedAt) : null;
    const ackExpiresMs = provider.acknowledgement.expiresAt ? parseTime(provider.acknowledgement.expiresAt) : null;

    if (provider.sync.state === 'in_sync' && lastSyncedMs !== null && nowMs !== null && nowMs - lastSyncedMs > healthSlo.providerSyncStaleMs) {
      failures.push({
        code: 'provider.sync.stale_slo',
        source: `provider:${provider.providerId}`,
        providerId: provider.providerId,
        action: 'refresh-provider-sync'
      });
    }
    if (provider.acknowledgement.state === 'pending' && ackExpiresMs !== null && nowMs !== null && ackExpiresMs - nowMs <= healthSlo.ackGraceMs) {
      failures.push({
        code: 'provider.ack.grace_window',
        source: `provider:${provider.providerId}`,
        providerId: provider.providerId,
        action: 'obtain-provider-handoff-acknowledgement'
      });
    }

    return failures;
  });
  const providerAckFailures = providerIntegration.negotiation.ackRequiredProviderIds.map((providerId) => ({
    code: providerIntegration.externalHandoff.state === 'provider_ack_expired'
      ? 'provider.ack.expired'
      : 'provider.ack.required',
    source: `provider:${providerId}`,
    providerId,
    action: 'obtain-provider-handoff-acknowledgement'
  }));
  const approvalFailures = approvals.flatMap((approval) => (
    approval.validation.map((reason) => ({
      code: reason,
      source: `approval:${approval.id}`,
      requestId: approval.id,
      action: reason.includes('proof')
        ? 'attach-valid-proof'
        : reason.includes('boundary') || reason.includes('permission')
          ? 'repair-workspace-boundary'
          : 'repair-approval-request'
    }))
  ));
  const lifecycleFailures = lifecycleState.validation.map((reason) => ({
    code: reason,
    source: 'lifecycle',
    action: reason.includes('recovery.failed_intent')
      ? 'operator-review-failed-lifecycle-intent'
      : reason.includes('schedule')
        ? 'repair-lifecycle-schedule'
        : 'repair-lifecycle-state'
  }));
  const previewFailures = previewAcceptance.acceptance.validation.map((reason) => ({
    code: reason,
    source: 'preview-acceptance',
    action: reason.includes('risk_acknowledgement')
      ? 'acknowledge-high-risk-preview'
      : reason.includes('section_acceptance')
        ? 'accept-required-preview-sections'
      : reason.includes('proof_mismatch')
        ? 'refresh-preview-proof'
        : 'accept-ready-preview'
  }));
  const persistenceFailures = persistedStateUpdate.validation.map((reason) => ({
    code: reason,
    source: 'persistence',
    action: reason.includes('preview')
      ? 'complete-preview-acceptance-before-commit'
      : reason.includes('checkpoint')
        ? 'repair-persisted-checkpoint'
        : 'hold-checkpoint-commit'
  }));
  const failureStates = [
    ...providerFailures,
    ...providerSloFailures,
    ...providerAckFailures,
    ...approvalFailures,
    ...lifecycleFailures,
    ...previewFailures,
    ...persistenceFailures,
    ...clientRuntimeHandoff.blockedReasons.map((reason) => ({
      code: reason,
      source: 'client-runtime-handoff',
      action: 'repair-runtime-handoff-blocker'
    }))
  ].map((failure, index) => ({
    id: `${failure.source}:${index + 1}`,
    severity: severityForReason(failure.code),
    retryable: failure.source.startsWith('provider:') || failure.code.includes('sync') || failure.code.includes('replay') || failure.code.includes('grace_window'),
    ...failure
  }));
  const stagedJournalEntries = persistedStateUpdate.nextCheckpoint.journal.filter((entry) => entry.status === 'staged');
  const failedJournalEntries = persistedState.journal.filter((entry) => entry.failed);
  const stagedImpactCommands = persistedStateUpdate.nextCheckpoint.impactCommands.filter((entry) => entry.status === 'staged');
  const failedImpactCommands = persistedState.impactCommands.filter((entry) => entry.failed);
  const retryQueue = [
    ...providerIntegration.negotiation.syncRequiredProviderIds.map((providerId) => ({
      id: `provider:${providerId}`,
      kind: 'provider-sync',
      target: providerId,
      reason: 'provider.sync_required',
      attempts: 0
    })),
    ...providerIntegration.negotiation.ackRequiredProviderIds.map((providerId) => ({
      id: `provider-ack:${providerId}`,
      kind: 'provider-ack',
      target: providerId,
      reason: 'provider.ack_required',
      attempts: 0
    })),
    ...providerSloFailures.map((failure) => ({
      id: `${failure.code}:${failure.providerId}`,
      kind: failure.code === 'provider.sync.stale_slo' ? 'provider-sync' : 'provider-ack',
      target: failure.providerId,
      reason: failure.code,
      attempts: 0
    })),
    ...stagedJournalEntries.map((entry) => ({
      id: `${entry.kind}:${entry.id}`,
      kind: entry.kind,
      target: entry.id,
      reason: 'persistence.journal.staged',
      attempts: normalizeInteger(entry.attempts, 0)
    })),
    ...failedJournalEntries.map((entry) => ({
      id: `${entry.kind}:${entry.id}`,
      kind: entry.kind,
      target: entry.id,
      reason: 'persistence.journal.failed',
      attempts: normalizeInteger(entry.attempts, retryPolicy.maxAttempts)
    })),
    ...stagedImpactCommands.map((entry) => ({
      id: `impact:${entry.category}:${entry.requestId}`,
      kind: 'impact-command',
      target: entry.id,
      reason: `persistence.impact.${entry.category}.staged`,
      attempts: 0
    })),
    ...failedImpactCommands.map((entry) => ({
      id: `impact:${entry.category}:${entry.requestId}:failed`,
      kind: 'impact-command',
      target: entry.id,
      reason: `persistence.impact.${entry.category}.failed`,
      attempts: retryPolicy.maxAttempts
    }))
  ].map((entry) => ({
    ...entry,
    ...computeRetryWindow(now, entry.attempts, retryPolicy)
  }));
  const retryBudget = retryBudgetByKind(retryQueue);
  const severity = strongestSeverity(failureStates.map((failure) => failure.severity));
  const degradedModeActive = severity === 'degraded'
    || providerIntegration.externalHandoff.state === 'provider_sync_required'
    || providerIntegration.externalHandoff.state === 'provider_ack_required'
    || providerIntegration.externalHandoff.state === 'provider_ack_expired'
    || persistedStateUpdate.restartSafeStatus === 'awaiting_provider_sync';
  const status = severity === 'critical'
    || retryQueue.some((entry) => entry.exhausted)
    || retryQueue.length > healthSlo.maxRetryQueueDepth
    ? 'critical'
    : severity === 'blocked'
      ? 'blocked'
      : degradedModeActive
        ? 'degraded'
        : failureStates.length
          ? 'attention_required'
          : 'healthy';
  const circuitBreaker = buildOperationalCircuitBreaker(
    now,
    status,
    failureStates,
    retryQueue,
    providerIntegration,
    clientRuntimeHandoff,
    healthSlo
  );
  const degradedCapabilities = buildDegradedCapabilityMatrix(status, circuitBreaker, providerIntegration, persistedStateUpdate);
  const impactDegradedModePolicy = buildImpactDegradedModePolicy(
    status,
    circuitBreaker,
    approvals,
    providerIntegration,
    persistedStateUpdate,
    retryQueue
  );
  const remediationPlan = buildOperatorRemediationPlan(
    now,
    failureStates.filter((failure) => failure.severity !== 'info'),
    retryQueue,
    circuitBreaker,
    degradedCapabilities,
    healthSlo.maxActionableErrors
  );
  const actionableErrors = remediationPlan.steps.map((step) => ({
    code: step.code,
    source: step.source,
    severity: step.severity,
    action: step.action,
    retryable: step.canAutoRetry,
    retryDue: step.retryDue,
    nextRetryAt: step.nextRetryAt,
    retryExhausted: step.retryExhausted,
    blockedCapability: step.blockedCapability,
    nextStep: step.nextStep
  }));
  const operatorRunbook = actionableErrors.map((failure) => operatorRunbookForFailure(failure, retryQueue));
  const payload = {
    surfaceId,
    generatedAt: now,
    status,
    isolationKey: clientState.boundary.isolationKey,
    nextAction: clientRuntimeHandoff.nextAction,
    failureCodes: failureStates.map((failure) => failure.code),
    retryQueue: retryQueue.map(({ nextRetryAt, delayMs, exhausted, ...entry }) => entry),
    restartSafeStatus: persistedStateUpdate.restartSafeStatus,
    circuitBreakerState: circuitBreaker.state,
    degradedCapabilityBlocks: degradedCapabilities.blockedCapabilities,
    impactGuardrailBlockedRequestIds: impactDegradedModePolicy.blockedRequestIds,
    impactGuardrailManualExportRequestIds: impactDegradedModePolicy.manualExportRequestIds,
    remediationStepIds: remediationPlan.steps.map((step) => step.id),
    runtimeBlockingStepIds: remediationPlan.runtimeBlockingStepIds
  };

  return {
    format: 'approval-console.operational-health.v1',
    status,
    severity,
    healthSlo,
    degradedMode: {
      active: degradedModeActive,
      runtimeHandoffPaused: circuitBreaker.suppressExternalHandoff || degradedModeActive || status === 'blocked' || status === 'critical',
      allowOperatorReview: degradedCapabilities.operatorReview,
      impactGuardrailActive: impactDegradedModePolicy.active,
      impactBlockedRequestIds: impactDegradedModePolicy.blockedRequestIds,
      manualExportRequestIds: impactDegradedModePolicy.manualExportRequestIds,
      reason: circuitBreaker.state === 'open'
        ? 'operational_circuit_open'
        : degradedModeActive
        ? providerIntegration.externalHandoff.state
        : status === 'healthy'
          ? 'none'
          : 'blocking_failure_state'
    },
    degradedCapabilities,
    impactDegradedModePolicy,
    circuitBreaker,
    retryPolicy,
    retryBudget,
    retryQueue,
    failureStates,
    actionableErrors,
    operatorRunbook,
    remediationPlan,
    metrics: {
      failureCount: failureStates.length,
      retryableCount: retryQueue.filter((entry) => entry.retryable).length,
      exhaustedRetryCount: retryQueue.filter((entry) => entry.exhausted).length,
      autoRetryStepCount: remediationPlan.autoRetryStepIds.length,
      operatorRequiredStepCount: remediationPlan.operatorRequiredStepIds.length,
      runtimeBlockingStepCount: remediationPlan.runtimeBlockingStepIds.length,
      degradedModeEligibleStepCount: remediationPlan.degradedModeEligibleStepIds.length,
      blockedProviderCount: providerIntegration.negotiation.blockedProviderIds.length,
      ackRequiredProviderCount: providerIntegration.negotiation.ackRequiredProviderIds.length,
      staleProviderCount: providerSloFailures.filter((failure) => failure.code === 'provider.sync.stale_slo').length,
      ackGraceWindowCount: providerSloFailures.filter((failure) => failure.code === 'provider.ack.grace_window').length,
      retryBudgetKindCount: retryBudget.length,
      stagedIntentCount: stagedJournalEntries.length,
      failedIntentCount: failedJournalEntries.length
        + failedImpactCommands.length,
      stagedImpactCommandCount: stagedImpactCommands.length,
      committedImpactCommandCount: persistedStateUpdate.nextCheckpoint.impactCommands.filter((entry) => entry.status === 'committed').length,
      failedImpactCommandCount: failedImpactCommands.length,
      impactGuardrailBlockedCount: impactDegradedModePolicy.blockedRequestIds.length,
      impactManualExportEligibleCount: impactDegradedModePolicy.manualExportRequestIds.length,
      impactReviewOnlyCount: impactDegradedModePolicy.reviewOnlyRequestIds.length
    },
    proof: `sha256:${proofFor(payload)}`
  };
}

function buildPreviewAcceptance(now, clientState, approvals, lifecycleState, providerIntegration, clientRuntimeHandoff, input) {
  const rawAcceptance = asObject(input.previewAcceptance || input.acceptance || input.operatorAcceptance);
  const acceptedPreviewIds = normalizeIdList(rawAcceptance.acceptedPreviewIds || rawAcceptance.previewIds);
  const acceptedSectionIds = normalizeIdList(rawAcceptance.acceptedSectionIds || rawAcceptance.sectionIds || rawAcceptance.reviewedSectionIds);
  const acknowledgedRiskIds = normalizeIdList(rawAcceptance.acknowledgedRiskIds || rawAcceptance.riskIds);
  const clientProof = asString(rawAcceptance.proof || rawAcceptance.previewProof);
  const acceptedBy = asString(rawAcceptance.acceptedBy || rawAcceptance.operatorId, clientState.operator.id || clientState.clientId);
  const resumableRequestIds = new Set(clientRuntimeHandoff.resumeIntents.map((intent) => intent.requestId));
  const approvalCards = approvals.map((approval) => {
    const reviewSections = approvalPreviewReviewSections(approval);
    const requiredReviewSectionIds = reviewSections
      .filter((section) => section.required)
      .map((section) => section.id);

    return {
      previewId: `approval:${approval.id}`,
      kind: 'approval',
      requestId: approval.id,
      title: approval.action,
      target: approval.target,
      state: approval.state,
      risk: approval.risk,
      impactCategory: approval.impact.primaryCategory,
      impactLabels: approval.impact.labels,
      externalWrite: approval.impact.externalWrite,
      destructiveAction: approval.impact.destructiveAction,
      privilegedKernelChange: approval.impact.privilegedKernelChange,
      impactProof: approval.impact.proof,
      proofStatus: approval.proofBundle.status,
      validation: approval.validation,
      ready: resumableRequestIds.has(approval.id),
      reviewSections,
      requiredReviewSectionIds,
      acceptedReviewSectionIds: requiredReviewSectionIds.filter((sectionId) => acceptedSectionIds.includes(sectionId)),
      nextStep: approval.valid
        ? approval.state === 'approved'
          ? 'ready-for-runtime-resume'
          : approval.state === 'requested'
            ? 'await-operator-decision'
            : `observe-${approval.state}`
        : 'repair-approval-contract'
    };
  });
  const lifecycleCards = lifecycleState.commands.map((command) => ({
    previewId: `lifecycle:${command.id}`,
    kind: 'lifecycle-command',
    commandId: command.id,
    title: command.command || 'unsupported lifecycle command',
    target: command.targetState,
    state: command.recoveryStatus,
    risk: command.requiresProof ? 'high' : 'medium',
    proofStatus: command.requiresProof ? 'required' : 'not_required',
    validation: command.validation,
    ready: command.valid && lifecycleState.executableCommandIds.includes(command.id) && !command.recoveredApplied,
    nextStep: command.valid
      ? command.requiresApproval
        ? 'await-lifecycle-approval'
        : command.recoveredApplied
          ? 'observe-recovered-lifecycle'
          : 'ready-for-lifecycle-apply'
      : 'repair-lifecycle-command'
  }));
  const previewItems = [...approvalCards, ...lifecycleCards];
  const knownPreviewIds = new Set(previewItems.map((item) => item.previewId));
  const knownSectionIds = new Set(previewItems.flatMap((item) => item.reviewSections?.map((section) => section.id) || []));
  const readyItems = previewItems.filter((item) => item.ready);
  const blockedItems = previewItems.filter((item) => item.validation.length > 0);
  const requiredSectionIds = readyItems.flatMap((item) => item.requiredReviewSectionIds || []);
  const acceptedRequiredSectionIds = requiredSectionIds.filter((sectionId) => acceptedSectionIds.includes(sectionId));
  const missingRequiredSectionIds = requiredSectionIds.filter((sectionId) => !acceptedSectionIds.includes(sectionId));
  const highRiskReadyIds = readyItems
    .filter((item) => RISK_ORDER[item.risk] >= RISK_ORDER.high)
    .map((item) => item.previewId);
  const previewPayload = {
    surfaceId,
    generatedAt: now,
    format: 'approval-console.preview-acceptance.v1',
    isolationKey: clientState.boundary.isolationKey,
    providerId: providerIntegration.selectedProviderId,
    destination: clientRuntimeHandoff.destination,
    nextAction: clientRuntimeHandoff.nextAction,
    previewIds: readyItems.map((item) => item.previewId),
    blockedPreviewIds: blockedItems.map((item) => item.previewId),
    highRiskReadyIds,
    requiredSectionIds,
    runtimeProof: clientRuntimeHandoff.proof
  };
  const previewProof = `sha256:${proofFor(previewPayload)}`;
  const validation = [
    ...blockedItems.flatMap((item) => item.validation.map((reason) => `${item.previewId}:${reason}`)),
    ...(clientProof && clientProof !== previewProof ? ['preview.acceptance.proof_mismatch'] : []),
    ...acceptedPreviewIds
      .filter((previewId) => !knownPreviewIds.has(previewId))
      .map((previewId) => `${previewId}:preview.acceptance.unknown_preview`),
    ...acceptedSectionIds
      .filter((sectionId) => !knownSectionIds.has(sectionId))
      .map((sectionId) => `${sectionId}:preview.section_acceptance.unknown_section`),
    ...missingRequiredSectionIds
      .map((sectionId) => `${sectionId}:preview.section_acceptance.required`),
    ...acknowledgedRiskIds
      .filter((previewId) => !knownPreviewIds.has(previewId))
      .map((previewId) => `${previewId}:preview.risk_acknowledgement.unknown_preview`),
    ...highRiskReadyIds
      .filter((previewId) => !acknowledgedRiskIds.includes(previewId))
      .map((previewId) => `${previewId}:preview.risk_acknowledgement_required`)
  ];
  const missingAcceptedPreviewIds = clientRuntimeHandoff.ready
    ? readyItems
      .map((item) => item.previewId)
      .filter((previewId) => !acceptedPreviewIds.includes(previewId))
    : [];

  validation.push(...missingAcceptedPreviewIds.map((previewId) => `${previewId}:preview.acceptance.required`));

  return {
    ...previewPayload,
    proof: previewProof,
    items: previewItems,
    summary: {
      readyCount: readyItems.length,
      blockedCount: blockedItems.length,
      highRiskReadyCount: highRiskReadyIds.length,
      acceptedCount: acceptedPreviewIds.length,
      requiredSectionCount: requiredSectionIds.length,
      acceptedRequiredSectionCount: acceptedRequiredSectionIds.length,
      missingRequiredSectionCount: missingRequiredSectionIds.length,
      destinationLabel: clientRuntimeHandoff.userVisibleWorkflow.destinationLabel,
      primaryAction: clientRuntimeHandoff.userVisibleWorkflow.primaryAction
    },
    acceptance: {
      acceptedBy,
      acceptedAt: asString(rawAcceptance.acceptedAt || rawAcceptance.at, now),
      acceptedPreviewIds,
      acceptedSectionIds,
      acceptedRequiredSectionIds,
      missingRequiredSectionIds,
      acknowledgedRiskIds,
      clientProof,
      accepted: validation.length === 0 && clientRuntimeHandoff.ready,
      validation,
      nextStep: validation.length
        ? missingRequiredSectionIds.length
          ? 'accept-required-preview-sections'
          : 'repair-preview-acceptance'
        : clientRuntimeHandoff.ready
          ? clientRuntimeHandoff.nextAction
          : clientRuntimeHandoff.nextAction
    }
  };
}

function buildRoutePreviewReadiness(now, handoff, providerIntegration, clientRuntimeHandoff, previewAcceptance, persistedStateUpdate, operationalHealth) {
  const acceptanceValidation = previewAcceptance.acceptance.validation;
  const runtimeBlockers = clientRuntimeHandoff.blockedReasons;
  const persistenceValidation = persistedStateUpdate.validation;
  const providerBlockers = [
    ...providerIntegration.negotiation.missingCapabilities.map((capability) => `provider.capability:${capability}`),
    ...providerIntegration.negotiation.impactBlockedRequestIds.map((requestId) => `provider.impact:${requestId}`),
    ...providerIntegration.negotiation.syncRequiredProviderIds.map((providerId) => `provider.sync:${providerId}`),
    ...providerIntegration.negotiation.ackRequiredProviderIds.map((providerId) => `provider.ack:${providerId}`)
  ];
  const healthBlockers = operationalHealth.actionableErrors.map((error) => `${error.source}:${error.code}`);
  const readyToCommit = persistedStateUpdate.commitStatus === 'commit_checkpoint'
    && clientRuntimeHandoff.ready
    && previewAcceptance.acceptance.accepted
    && operationalHealth.degradedMode.runtimeHandoffPaused === false;
  const readinessGates = [
    {
      id: 'preview.visible',
      label: 'Preview visible',
      state: previewAcceptance.items.length > 0 ? 'passed' : 'waiting',
      blockingReasons: previewAcceptance.items.length > 0 ? [] : ['preview.items.empty']
    },
    {
      id: 'preview.accepted',
      label: 'Preview accepted',
      state: previewAcceptance.acceptance.accepted ? 'passed' : acceptanceValidation.length ? 'blocked' : 'waiting',
      blockingReasons: acceptanceValidation
    },
    {
      id: 'runtime.ready',
      label: 'Runtime handoff ready',
      state: clientRuntimeHandoff.ready ? 'passed' : runtimeBlockers.length ? 'blocked' : 'waiting',
      blockingReasons: runtimeBlockers
    },
    {
      id: 'provider.ready',
      label: 'Provider ready',
      state: providerIntegration.externalHandoff.state === 'ready_for_external_handoff' ? 'passed' : providerBlockers.length ? 'blocked' : 'waiting',
      blockingReasons: providerBlockers
    },
    {
      id: 'checkpoint.commit',
      label: 'Checkpoint commit',
      state: persistedStateUpdate.commitStatus === 'commit_checkpoint' ? 'passed' : persistenceValidation.length ? 'blocked' : 'waiting',
      blockingReasons: persistenceValidation
    },
    {
      id: 'operations.ready',
      label: 'Operational readiness',
      state: operationalHealth.degradedMode.runtimeHandoffPaused ? 'blocked' : operationalHealth.status === 'healthy' ? 'passed' : 'waiting',
      blockingReasons: operationalHealth.degradedMode.runtimeHandoffPaused ? healthBlockers : []
    }
  ];
  const blockedGateIds = readinessGates.filter((gate) => gate.state === 'blocked').map((gate) => gate.id);
  const waitingGateIds = readinessGates.filter((gate) => gate.state === 'waiting').map((gate) => gate.id);
  const firstActionableGate = readinessGates.find((gate) => gate.state === 'blocked') || readinessGates.find((gate) => gate.state === 'waiting') || null;
  const validationSummary = {
    totalCount: acceptanceValidation.length + runtimeBlockers.length + persistenceValidation.length + providerBlockers.length + healthBlockers.length,
    previewAcceptance: acceptanceValidation,
    runtimeHandoff: runtimeBlockers,
    provider: providerBlockers,
    persistence: persistenceValidation,
    operationalHealth: healthBlockers
  };
  const nextStep = readyToCommit
    ? 'commit-checkpoint-and-dispatch'
    : firstActionableGate?.id === 'preview.visible'
      ? 'load-preview-items'
      : firstActionableGate?.id === 'preview.accepted'
        ? previewAcceptance.acceptance.nextStep
        : firstActionableGate?.id === 'runtime.ready'
          ? clientRuntimeHandoff.nextAction
          : firstActionableGate?.id === 'provider.ready'
            ? providerIntegration.externalHandoff.state
            : firstActionableGate?.id === 'checkpoint.commit'
              ? persistedStateUpdate.restartSafeStatus
              : firstActionableGate?.id === 'operations.ready'
                ? operationalHealth.remediationPlan.steps[0]?.nextStep || operationalHealth.degradedMode.reason
                : handoff.nextAction;
  const payload = {
    surfaceId,
    generatedAt: now,
    format: 'approval-console.route-preview-readiness.v1',
    handoffNextAction: handoff.nextAction,
    runtimeNextAction: clientRuntimeHandoff.nextAction,
    providerState: providerIntegration.externalHandoff.state,
    accepted: previewAcceptance.acceptance.accepted,
    readyToCommit,
    blockedGateIds,
    waitingGateIds,
    nextStep
  };

  return {
    ...payload,
    panelState: readyToCommit
      ? 'ready'
      : blockedGateIds.length
        ? 'blocked'
        : waitingGateIds.length
          ? 'waiting'
          : 'observe',
    primaryCta: readyToCommit
      ? 'Commit and dispatch'
      : firstActionableGate?.id === 'preview.accepted'
        ? previewAcceptance.summary.primaryAction
        : firstActionableGate?.id === 'operations.ready'
          ? 'Repair operational blocker'
          : 'Refresh readiness',
    destinationLabel: clientRuntimeHandoff.userVisibleWorkflow.destinationLabel,
    focusRequestId: handoff.focusRequestId,
    readinessGates,
    validationSummary,
    previewSummary: previewAcceptance.summary,
    acceptedPreviewIds: previewAcceptance.acceptance.acceptedPreviewIds,
    dispatchEnvelopeProof: providerIntegration.externalHandoff.handoffEnvelope.proof,
    runtimeHandoffProof: clientRuntimeHandoff.proof,
    checkpointUpdateProof: persistedStateUpdate.proof,
    operationalHealthProof: operationalHealth.proof,
    proof: `sha256:${proofFor({ ...payload, validationSummary })}`
  };
}

function attachProviderHandoff(handoff, providerIntegration, clientRuntimeHandoff, previewAcceptance) {
  return {
    ...handoff,
    providerContract: {
      name: providerIntegration.contractName,
      selectedProviderId: providerIntegration.selectedProviderId,
      negotiationStatus: providerIntegration.negotiation.status,
      missingCapabilities: providerIntegration.negotiation.missingCapabilities,
      ackRequiredProviderIds: providerIntegration.negotiation.ackRequiredProviderIds,
      impactObligationCount: providerIntegration.impactObligations.length,
      impactBlockedProviderIds: providerIntegration.negotiation.impactBlockedProviderIds,
      impactBlockedRequestIds: providerIntegration.negotiation.impactBlockedRequestIds
    },
    externalHandoff: providerIntegration.externalHandoff,
    clientRuntimeHandoff: {
      format: clientRuntimeHandoff.format,
      ready: clientRuntimeHandoff.ready,
      nextAction: clientRuntimeHandoff.nextAction,
      destination: clientRuntimeHandoff.destination,
      providerId: clientRuntimeHandoff.providerId,
      proof: clientRuntimeHandoff.proof,
      resumeIntentIds: clientRuntimeHandoff.resumeIntents.map((intent) => intent.requestId),
      lifecycleCommandIntentIds: clientRuntimeHandoff.lifecycleCommandIntents.map((intent) => intent.commandId),
      blockedReasons: clientRuntimeHandoff.blockedReasons,
      persistence: clientRuntimeHandoff.persistence,
      userVisibleWorkflow: clientRuntimeHandoff.userVisibleWorkflow
    },
    previewAcceptance: {
      format: previewAcceptance.format,
      proof: previewAcceptance.proof,
      nextAction: previewAcceptance.nextAction,
      destination: previewAcceptance.destination,
      summary: previewAcceptance.summary,
      acceptance: previewAcceptance.acceptance
    }
  };
}

function buildAuditRecord(now, clientState, approvals, handoff, evidence, lifecycleState, providerIntegration, clientRuntimeHandoff, persistedState, previewAcceptance, persistedStateUpdate, operationalHealth) {
  const accepted = approvals.filter((approval) => approval.valid).map((approval) => approval.id);
  const rejected = approvals.filter((approval) => !approval.valid).map((approval) => ({
    id: approval.id,
    validation: approval.validation
  }));
  const payload = {
    surfaceId,
    generatedAt: now,
    client: clientState,
    approvals: approvals.map(({ validation, evidence: _evidence, ...approval }) => approval),
    handoff,
    lifecycle: {
      enabled: lifecycleState.enabled,
      schedulerEnabled: lifecycleState.schedulerEnabled,
      nextAction: lifecycleState.nextAction,
      activeCommandId: lifecycleState.activeCommandId,
      commandIds: lifecycleState.commands.map((command) => command.id),
      validation: lifecycleState.validation
    },
    provider: {
      selectedProviderId: providerIntegration.selectedProviderId,
      negotiationStatus: providerIntegration.negotiation.status,
      externalState: providerIntegration.externalHandoff.state,
      missingCapabilities: providerIntegration.negotiation.missingCapabilities,
      impactObligationCount: providerIntegration.impactObligations.length,
      impactBlockedProviderIds: providerIntegration.negotiation.impactBlockedProviderIds,
      impactBlockedRequestIds: providerIntegration.negotiation.impactBlockedRequestIds,
      impactSyncBarriers: providerIntegration.negotiation.impactSyncBarriers,
      ackRequiredProviderIds: providerIntegration.negotiation.ackRequiredProviderIds,
      acknowledgementState: providerIntegration.externalHandoff.acknowledgement.state,
      syncGeneration: providerIntegration.externalHandoff.syncGeneration,
      dispatchState: providerIntegration.externalHandoff.handoffEnvelope.dispatchState,
      dispatchLane: providerIntegration.externalHandoff.handoffEnvelope.lane,
      handoffEnvelopeProof: providerIntegration.externalHandoff.handoffEnvelope.proof
    },
    clientRuntimeHandoff: {
      format: clientRuntimeHandoff.format,
      ready: clientRuntimeHandoff.ready,
      nextAction: clientRuntimeHandoff.nextAction,
      destination: clientRuntimeHandoff.destination,
      proof: clientRuntimeHandoff.proof,
      resumeIntentIds: clientRuntimeHandoff.resumeIntents.map((intent) => intent.requestId),
      lifecycleCommandIntentIds: clientRuntimeHandoff.lifecycleCommandIntents.map((intent) => intent.commandId),
      blockedReasons: clientRuntimeHandoff.blockedReasons
    },
    previewAcceptance: {
      format: previewAcceptance.format,
      proof: previewAcceptance.proof,
      nextAction: previewAcceptance.nextAction,
      readyPreviewIds: previewAcceptance.previewIds,
      acceptedPreviewIds: previewAcceptance.acceptance.acceptedPreviewIds,
      requiredSectionIds: previewAcceptance.requiredSectionIds,
      acceptedSectionIds: previewAcceptance.acceptance.acceptedSectionIds,
      missingRequiredSectionIds: previewAcceptance.acceptance.missingRequiredSectionIds,
      accepted: previewAcceptance.acceptance.accepted,
      validation: previewAcceptance.acceptance.validation
    },
    persistence: {
      format: persistedState.format,
      recoveryMode: persistedState.recoveryMode,
      revision: persistedState.revision,
      nextRevision: persistedState.nextRevision,
      updateFormat: persistedStateUpdate.format,
      updateProof: persistedStateUpdate.proof,
      commitStatus: persistedStateUpdate.commitStatus,
      restartSafeStatus: persistedStateUpdate.restartSafeStatus,
      recoveredApprovalIds: clientRuntimeHandoff.persistence.recoveredApprovalIds,
      recoveredLifecycleCommandIds: lifecycleState.recoveredCommandIds,
      replayRequiredApprovalIds: clientRuntimeHandoff.persistence.replayRequiredApprovalIds,
      replayRequiredLifecycleCommandIds: lifecycleState.replayRequiredCommandIds,
      recoveredImpactCommandIds: clientRuntimeHandoff.persistence.recoveredImpactCommandIds,
      replayRequiredImpactCommandIds: clientRuntimeHandoff.persistence.replayRequiredImpactCommandIds,
      validation: persistedState.validation,
      checkpointProof: persistedState.checkpointProof
    },
    operationalHealth: {
      format: operationalHealth.format,
      status: operationalHealth.status,
      severity: operationalHealth.severity,
      degradedMode: operationalHealth.degradedMode,
      circuitBreaker: operationalHealth.circuitBreaker,
      degradedCapabilities: operationalHealth.degradedCapabilities,
      impactDegradedModePolicy: operationalHealth.impactDegradedModePolicy,
      retryBudget: operationalHealth.retryBudget,
      retryableCount: operationalHealth.metrics.retryableCount,
      exhaustedRetryCount: operationalHealth.metrics.exhaustedRetryCount,
      actionableErrorCodes: operationalHealth.actionableErrors.map((error) => error.code),
      remediationPlan: {
        format: operationalHealth.remediationPlan.format,
        proof: operationalHealth.remediationPlan.proof,
        stepCount: operationalHealth.remediationPlan.stepCount,
        autoRetryStepIds: operationalHealth.remediationPlan.autoRetryStepIds,
        operatorRequiredStepIds: operationalHealth.remediationPlan.operatorRequiredStepIds,
        runtimeBlockingStepIds: operationalHealth.remediationPlan.runtimeBlockingStepIds
      },
      proof: operationalHealth.proof
    },
    evidenceCount: evidence.length,
    boundarySummary: approvals.map((approval) => ({
      id: approval.id,
      isolationKey: approval.boundaryPolicy.isolationKey,
      requiredRole: approval.boundaryPolicy.requiredRole,
      operatorRole: approval.boundaryPolicy.operatorRole,
      deniedScopes: approval.boundaryPolicy.deniedScopes,
      permissionBindingIds: approval.boundaryPolicy.permissionGrant.activeBindingIds,
      permissionBindingRole: approval.boundaryPolicy.permissionGrant.strongestBindingRole,
      permissionDeniedScopes: approval.boundaryPolicy.permissionGrant.deniedScopes,
      transitionKind: approval.boundaryTransition.kind,
      transitionAllowed: approval.boundaryTransition.allowed,
      transitionProof: approval.boundaryTransition.proof,
      impactCategories: approval.impact.categories,
      impactMinimumRisk: approval.impact.minimumRisk,
      impactRequiredRole: approval.impact.requiredRole,
      impactRequiredScopes: approval.impact.requiredScopes,
      impactProof: approval.impact.proof
    })),
    workflowSummary: approvals.map((approval) => ({
      id: approval.id,
      format: approval.workflowHandoff.format,
      nextAction: approval.workflowHandoff.nextAction,
      displayState: approval.workflowHandoff.displayState,
      resumeCandidate: approval.workflowHandoff.resumeCandidate,
      decisionRequired: approval.workflowHandoff.decisionRequired,
      gates: approval.workflowHandoff.gates,
      handoffBlocks: approval.workflowHandoff.handoffBlocks,
      proof: approval.workflowHandoff.proof
    })),
    proofSummary: approvals.map((approval) => ({
      id: approval.id,
      status: approval.proofBundle.status,
      proof: approval.proofBundle.proof,
      evidenceIds: approval.proofBundle.acceptedEvidenceIds
    })),
    approvalImpactContracts: approvals.map((approval) => ({
      requestId: approval.id,
      format: approval.impact.format,
      categories: approval.impact.categories,
      primaryCategory: approval.impact.primaryCategory,
      externalWrite: approval.impact.externalWrite,
      destructiveAction: approval.impact.destructiveAction,
      privilegedKernelChange: approval.impact.privilegedKernelChange,
      externalTargets: approval.impact.externalTargets,
      minimumRisk: approval.impact.minimumRisk,
      requiredRole: approval.impact.requiredRole,
      requiredScopes: approval.impact.requiredScopes,
      missingScopeContracts: approval.impact.missingScopeContracts,
      validation: approval.impact.validation,
      proof: approval.impact.proof
    }))
  };

  return {
    event: 'approval-console.state.materialized',
    generatedAt: now,
    proof: `sha256:${proofFor(payload)}`,
    accepted,
    rejected,
    lifecycle: {
      proof: lifecycleState.auditProof,
      nextAction: lifecycleState.nextAction,
      activeCommandId: lifecycleState.activeCommandId,
      pendingCommandIds: lifecycleState.pendingCommandIds,
      executableCommandIds: lifecycleState.executableCommandIds,
      replayRequiredCommandIds: lifecycleState.replayRequiredCommandIds,
      rejectedCommandIds: lifecycleState.commands
        .filter((command) => !command.valid)
        .map((command) => command.id)
    },
    tenantBoundary: {
      isolationKey: clientState.boundary.isolationKey,
      heldRequestIds: approvals
        .filter((approval) => !approval.boundaryPolicy.boundaryClear)
        .map((approval) => approval.id),
      permissionBoundaryFormat: clientState.permissionBoundary.format,
      requireExplicitWorkspaceGrant: clientState.permissionBoundary.requireExplicitWorkspaceGrant,
      activeBindingIds: clientState.permissionBoundary.activeBindingIds,
      permissionBlockedRequestIds: approvals
        .filter((approval) => approval.boundaryPolicy.permissionGrant.validation.length > 0)
        .map((approval) => approval.id),
      transitionBlockedRequestIds: approvals
        .filter((approval) => approval.boundaryTransition.changed && !approval.boundaryTransition.allowed)
        .map((approval) => approval.id),
      transitionProofs: approvals
        .filter((approval) => approval.boundaryTransition.changed)
        .map((approval) => ({
          requestId: approval.id,
          kind: approval.boundaryTransition.kind,
          sourceIsolationKey: approval.boundaryTransition.source.isolationKey,
          targetIsolationKey: approval.boundaryTransition.target.isolationKey,
          proof: approval.boundaryTransition.proof
        })),
      validation: clientState.permissionBoundary.validation,
      proof: clientState.permissionBoundary.proof
    },
    approvalImpactContracts: payload.approvalImpactContracts,
    approvalWorkflowHandoffs: approvals.map((approval) => ({
      requestId: approval.id,
      format: approval.workflowHandoff.format,
      nextAction: approval.workflowHandoff.nextAction,
      displayState: approval.workflowHandoff.displayState,
      resumeCandidate: approval.workflowHandoff.resumeCandidate,
      decisionRequired: approval.workflowHandoff.decisionRequired,
      gates: approval.workflowHandoff.gates,
      handoffBlocks: approval.workflowHandoff.handoffBlocks,
      userVisibleWorkflow: approval.workflowHandoff.userVisibleWorkflow,
      auditRefs: approval.workflowHandoff.auditRefs,
      proof: approval.workflowHandoff.proof
    })),
    provider: {
      proof: `sha256:${proofFor(payload.provider)}`,
      selectedProviderId: providerIntegration.selectedProviderId,
      negotiationStatus: providerIntegration.negotiation.status,
      externalHandoffState: providerIntegration.externalHandoff.state,
      missingCapabilities: providerIntegration.negotiation.missingCapabilities,
      impactObligationCount: providerIntegration.impactObligations.length,
      impactBlockedProviderIds: providerIntegration.negotiation.impactBlockedProviderIds,
      impactBlockedRequestIds: providerIntegration.negotiation.impactBlockedRequestIds,
      ackRequiredProviderIds: providerIntegration.negotiation.ackRequiredProviderIds,
      acknowledgementState: providerIntegration.externalHandoff.acknowledgement.state,
      syncGeneration: providerIntegration.externalHandoff.syncGeneration
    },
    clientRuntimeHandoff: {
      proof: clientRuntimeHandoff.proof,
      ready: clientRuntimeHandoff.ready,
      nextAction: clientRuntimeHandoff.nextAction,
      destination: clientRuntimeHandoff.destination,
      providerId: clientRuntimeHandoff.providerId,
      resumeIntentIds: clientRuntimeHandoff.resumeIntents.map((intent) => intent.requestId),
      lifecycleCommandIntentIds: clientRuntimeHandoff.lifecycleCommandIntents.map((intent) => intent.commandId),
      blockedReasons: clientRuntimeHandoff.blockedReasons
    },
    previewAcceptance: {
      proof: previewAcceptance.proof,
      accepted: previewAcceptance.acceptance.accepted,
      nextStep: previewAcceptance.acceptance.nextStep,
      readyPreviewIds: previewAcceptance.previewIds,
      blockedPreviewIds: previewAcceptance.blockedPreviewIds,
      requiredSectionIds: previewAcceptance.requiredSectionIds,
      acceptedSectionIds: previewAcceptance.acceptance.acceptedSectionIds,
      missingRequiredSectionIds: previewAcceptance.acceptance.missingRequiredSectionIds,
      validation: previewAcceptance.acceptance.validation
    },
    persistence: {
      proof: `sha256:${proofFor(payload.persistence)}`,
      format: persistedState.format,
      recoveryMode: persistedState.recoveryMode,
      revision: persistedState.revision,
      nextRevision: persistedState.nextRevision,
      updateFormat: persistedStateUpdate.format,
      updateProof: persistedStateUpdate.proof,
      commitStatus: persistedStateUpdate.commitStatus,
      restartSafeStatus: persistedStateUpdate.restartSafeStatus,
      nextCheckpointProof: persistedStateUpdate.nextCheckpoint.proof,
      committedIntentIds: persistedStateUpdate.committedIntentIds,
      stagedIntentIds: persistedStateUpdate.stagedIntentIds,
      impactCommandIds: persistedStateUpdate.impactCommandIds,
      committedImpactCommandIds: persistedStateUpdate.committedImpactCommandIds,
      stagedImpactCommandIds: persistedStateUpdate.stagedImpactCommandIds,
      suppressedReplayIds: persistedStateUpdate.suppressedReplayIds,
      recoveredApprovalIds: clientRuntimeHandoff.persistence.recoveredApprovalIds,
      recoveredLifecycleCommandIds: lifecycleState.recoveredCommandIds,
      replayRequiredApprovalIds: clientRuntimeHandoff.persistence.replayRequiredApprovalIds,
      replayRequiredLifecycleCommandIds: lifecycleState.replayRequiredCommandIds,
      recoveredImpactCommandIds: clientRuntimeHandoff.persistence.recoveredImpactCommandIds,
      replayRequiredImpactCommandIds: clientRuntimeHandoff.persistence.replayRequiredImpactCommandIds,
      validation: persistedStateUpdate.validation,
      checkpointProof: persistedState.checkpointProof
    },
    operationalHealth: {
      proof: operationalHealth.proof,
      status: operationalHealth.status,
      severity: operationalHealth.severity,
      degradedMode: operationalHealth.degradedMode,
      circuitBreaker: operationalHealth.circuitBreaker,
      degradedCapabilities: operationalHealth.degradedCapabilities,
      impactDegradedModePolicy: operationalHealth.impactDegradedModePolicy,
      retryBudget: operationalHealth.retryBudget,
      retryPolicy: operationalHealth.retryPolicy,
      metrics: operationalHealth.metrics,
      actionableErrors: operationalHealth.actionableErrors,
      operatorRunbook: operationalHealth.operatorRunbook,
      remediationPlan: operationalHealth.remediationPlan
    },
    proofBundles: approvals.map((approval) => ({
      requestId: approval.id,
      format: approval.proofBundle.format,
      required: approval.proofBundle.required,
      status: approval.proofBundle.status,
      proof: approval.proofBundle.proof,
      acceptedEvidenceIds: approval.proofBundle.acceptedEvidenceIds,
      rejectedEvidenceIds: approval.proofBundle.rejectedEvidenceIds
    })),
    evidence
  };
}

function normalizeHistorySnapshots(input, now) {
  const rawSnapshots = Array.isArray(input.history)
    ? input.history
    : Array.isArray(input.snapshots)
      ? input.snapshots
      : [];
  const nowMs = parseTime(now);
  const seen = new Set();

  return rawSnapshots.map((entry, index) => {
    const snapshot = asObject(entry);
    const counts = asObject(snapshot.counts);
    const id = asString(snapshot.id, `history:${index + 1}`);
    const capturedAt = asString(snapshot.capturedAt || snapshot.generatedAt || snapshot.at, now);
    const capturedMs = parseTime(capturedAt);
    const pendingCount = normalizeInteger(counts.pending ?? snapshot.pendingCount, 0);
    const approvedCount = normalizeInteger(counts.approved ?? snapshot.approvedCount, 0);
    const deniedCount = normalizeInteger(counts.denied ?? snapshot.deniedCount, 0);
    const invalidCount = normalizeInteger(counts.invalid ?? snapshot.invalidCount, 0);
    const boundaryHoldCount = normalizeInteger(counts.boundaryHold ?? snapshot.boundaryHoldCount, 0);
    const externalWriteCount = normalizeInteger(counts.externalWrite ?? snapshot.externalWriteCount, 0);
    const destructiveActionCount = normalizeInteger(counts.destructiveAction ?? snapshot.destructiveActionCount, 0);
    const privilegedKernelChangeCount = normalizeInteger(counts.privilegedKernelChange ?? snapshot.privilegedKernelChangeCount, 0);
    const criticalImpactCount = normalizeInteger(counts.criticalImpact ?? snapshot.criticalImpactCount, 0);
    const proof = asString(snapshot.proof);
    const validation = [];

    if (!id) {
      validation.push('analytics.history.id.required');
    }
    if (seen.has(id)) {
      validation.push('analytics.history.id.duplicate');
    }
    seen.add(id);
    if (capturedMs === null) {
      validation.push('analytics.history.capturedAt.invalid');
    }
    if (capturedMs !== null && nowMs !== null && capturedMs > nowMs) {
      validation.push('analytics.history.capturedAt.future');
    }
    if (proof && !DIGEST_PATTERN.test(proof)) {
      validation.push('analytics.history.proof.sha256_required');
    }

    return {
      id: asString(snapshot.id, `history:${index + 1}`),
      capturedAt,
      source: asString(snapshot.source, 'approval-console.history'),
      pendingCount,
      approvedCount,
      deniedCount,
      invalidCount,
      boundaryHoldCount,
      externalWriteCount,
      destructiveActionCount,
      privilegedKernelChangeCount,
      criticalImpactCount,
      proof,
      validation,
      valid: validation.length === 0,
      snapshotProof: `sha256:${proofFor({
        id,
        capturedAt,
        pendingCount,
        approvedCount,
        deniedCount,
        invalidCount,
        boundaryHoldCount,
        externalWriteCount,
        destructiveActionCount,
        privilegedKernelChangeCount,
        criticalImpactCount
      })}`
    };
  });
}

function compareCount(current, previous, key) {
  return previous ? current[key] - previous[key] : current[key];
}

function trendDirection(delta) {
  return delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
}

function buildAnalyticsHistoryRollup(history) {
  const ordered = [...history].sort((left, right) => {
    const leftTime = parseTime(left.capturedAt) ?? 0;
    const rightTime = parseTime(right.capturedAt) ?? 0;
    return leftTime - rightTime || left.id.localeCompare(right.id);
  });
  const current = ordered.at(-1) || null;
  const previous = ordered.length > 1 ? ordered.at(-2) : null;
  const deltas = current ? {
    pendingCount: compareCount(current, previous, 'pendingCount'),
    approvedCount: compareCount(current, previous, 'approvedCount'),
    deniedCount: compareCount(current, previous, 'deniedCount'),
    invalidCount: compareCount(current, previous, 'invalidCount'),
    boundaryHoldCount: compareCount(current, previous, 'boundaryHoldCount'),
    externalWriteCount: compareCount(current, previous, 'externalWriteCount'),
    destructiveActionCount: compareCount(current, previous, 'destructiveActionCount'),
    privilegedKernelChangeCount: compareCount(current, previous, 'privilegedKernelChangeCount'),
    criticalImpactCount: compareCount(current, previous, 'criticalImpactCount')
  } : {};
  const historyValidation = ordered.flatMap((snapshot) => (
    snapshot.validation.map((reason) => `${snapshot.id}:${reason}`)
  ));
  const trend = Object.fromEntries(
    Object.entries(deltas).map(([key, delta]) => [key, trendDirection(delta)])
  );

  return {
    format: 'approval-console.analytics-history.v1',
    sampleCount: ordered.length,
    currentSnapshotId: current ? current.id : null,
    previousSnapshotId: previous ? previous.id : null,
    deltas,
    trend,
    validation: historyValidation,
    valid: historyValidation.length === 0,
    proof: `sha256:${proofFor({
      ordered: ordered.map(({ validation: _validation, valid: _valid, ...snapshot }) => snapshot),
      deltas,
      trend
    })}`
  };
}

function buildImpactAnalyticsSummary(approvals, persistedStateUpdate, providerIntegration, operationalHealth) {
  const impactApprovals = approvals.filter((approval) => approval.impact.categories.length > 0);
  const persistedCommands = persistedStateUpdate.nextCheckpoint.impactCommands;
  const providerBlockedRequestIds = new Set(providerIntegration.negotiation.impactBlockedRequestIds);
  const guardrailBlockedRequestIds = new Set(operationalHealth.degradedMode.impactBlockedRequestIds);
  const manualExportRequestIds = new Set(operationalHealth.degradedMode.manualExportRequestIds);
  const summaries = impactApprovals.map((approval) => {
    const commands = persistedCommands.filter((entry) => entry.requestId === approval.id);
    const categories = approval.impact.categories;
    const blockedReasons = [
      ...approval.impact.validation,
      ...approval.workflowHandoff.hardBlocks,
      ...(providerBlockedRequestIds.has(approval.id) ? ['analytics.impact.provider_blocked'] : []),
      ...(guardrailBlockedRequestIds.has(approval.id) ? ['analytics.impact.degraded_guardrail_blocked'] : [])
    ];

    return {
      requestId: approval.id,
      clientRequestId: approval.clientRequestId,
      categories,
      primaryCategory: approval.impact.primaryCategory,
      state: approval.state,
      risk: approval.risk,
      minimumRisk: approval.impact.minimumRisk,
      requiredRole: approval.impact.requiredRole,
      requiredScopes: approval.impact.requiredScopes,
      externalTargetCount: approval.impact.externalWriteContract.targets.length,
      destructiveTargetCount: approval.impact.destructiveActionContract.targets.length,
      kernelSubsystem: approval.impact.privilegedKernelChangeContract.subsystem,
      workflowDisplayState: approval.workflowHandoff.displayState,
      resumeCandidate: approval.workflowHandoff.resumeCandidate,
      providerBlocked: providerBlockedRequestIds.has(approval.id),
      degradedGuardrailBlocked: guardrailBlockedRequestIds.has(approval.id),
      manualExportEligible: manualExportRequestIds.has(approval.id),
      commandStatuses: commands.map((entry) => ({
        commandId: entry.id,
        category: entry.category,
        status: entry.status,
        barrier: entry.barrier,
        commandDigest: entry.commandDigest
      })),
      blockedReasons,
      exportDisposition: approval.workflowHandoff.resumeCandidate && !providerBlockedRequestIds.has(approval.id)
        ? 'runtime_dispatch_ready'
        : manualExportRequestIds.has(approval.id)
          ? 'manual_export_ready'
          : blockedReasons.length
            ? 'blocked'
            : 'review_required',
      proof: `sha256:${proofFor({
        requestId: approval.id,
        categories,
        state: approval.state,
        risk: approval.risk,
        commandStatuses: commands.map(({ id, category, status, commandDigest }) => ({ id, category, status, commandDigest })),
        providerBlocked: providerBlockedRequestIds.has(approval.id),
        degradedGuardrailBlocked: guardrailBlockedRequestIds.has(approval.id)
      })}`
    };
  });
  const counters = summaries.reduce((counts, summary) => {
    for (const category of summary.categories) {
      incrementCounter(counts.byCategory, category);
      if (summary.exportDisposition === 'blocked') {
        incrementCounter(counts.blockedByCategory, category);
      }
    }
    incrementCounter(counts.byDisposition, summary.exportDisposition);
    if (summary.manualExportEligible) {
      counts.manualExportEligible += 1;
    }
    if (summary.providerBlocked) {
      counts.providerBlocked += 1;
    }
    if (summary.degradedGuardrailBlocked) {
      counts.degradedGuardrailBlocked += 1;
    }
    return counts;
  }, {
    byCategory: {},
    blockedByCategory: {},
    byDisposition: {},
    manualExportEligible: 0,
    providerBlocked: 0,
    degradedGuardrailBlocked: 0
  });

  return {
    format: 'approval-console.impact-analytics-summary.v1',
    requestCount: summaries.length,
    counters,
    requestSummaries: summaries,
    exportColumns: [
      'requestId',
      'categories',
      'state',
      'risk',
      'minimumRisk',
      'requiredRole',
      'externalTargetCount',
      'destructiveTargetCount',
      'kernelSubsystem',
      'exportDisposition'
    ],
    readyForExport: summaries.every((summary) => summary.exportDisposition !== 'blocked'),
    proof: `sha256:${proofFor({
      summaries: summaries.map(({ proof: _proof, blockedReasons: _blockedReasons, ...summary }) => summary),
      counters
    })}`
  };
}

function buildApprovalAnalytics(now, clientState, approvals, handoff, evidence, input, lifecycleState, providerIntegration, persistedState, previewAcceptance, persistedStateUpdate, operationalHealth) {
  const stateCounts = {};
  const riskCounts = {};
  const impactCounts = {};
  const decisionCounts = { none: 0 };
  const rolePressure = {};
  const scopeCounts = {};
  const validationCounts = {};
  const reportRows = [];
  const timeline = [];
  let totalDecisionMs = 0;
  let decidedWithLatency = 0;
  let proofRequiredCount = 0;
  let proofReadyCount = 0;

  for (const approval of approvals) {
    incrementCounter(stateCounts, approval.state);
    incrementCounter(riskCounts, approval.risk);
    for (const category of approval.impact.categories) {
      incrementCounter(impactCounts, category);
    }
    if (approval.impact.categories.length === 0) {
      incrementCounter(impactCounts, 'standard_approval');
    }
    incrementCounter(decisionCounts, approval.decision || 'none');
    incrementCounter(rolePressure, approval.boundaryPolicy.requiredRole);
    for (const scopeEntry of approval.scope) {
      incrementCounter(scopeCounts, scopeEntry);
    }
    for (const validationEntry of approval.validation) {
      incrementCounter(validationCounts, validationEntry);
    }
    if (approval.requiresProof) {
      proofRequiredCount += 1;
      if (approval.proofBundle.status === 'satisfied') {
        proofReadyCount += 1;
      }
    }

    const createdMs = parseTime(approval.createdAt);
    const decidedMs = firstNonNull([
      parseTime(approval.decidedAt),
      approval.state === 'requested' ? null : parseTime(now)
    ]);
    if (createdMs !== null && decidedMs !== null && decidedMs >= createdMs) {
      totalDecisionMs += decidedMs - createdMs;
      decidedWithLatency += 1;
    }

    reportRows.push({
      requestId: approval.id,
      tenantId: approval.tenantId,
      workspaceId: approval.workspaceId,
      action: approval.action,
      target: approval.target,
      impactCategory: approval.impact.primaryCategory,
      impactCategories: approval.impact.categories,
      impactMinimumRisk: approval.impact.minimumRisk,
      impactRequiredRole: approval.impact.requiredRole,
      impactRequiredScopes: approval.impact.requiredScopes,
      impactProof: approval.impact.proof,
      state: approval.state,
      risk: approval.risk,
      decision: approval.decision,
      requiredRole: approval.boundaryPolicy.requiredRole,
      operatorRole: approval.boundaryPolicy.operatorRole,
      permissionBindingIds: approval.boundaryPolicy.permissionGrant.activeBindingIds,
      permissionBindingRole: approval.boundaryPolicy.permissionGrant.strongestBindingRole,
      boundaryTransitionKind: approval.boundaryTransition.kind,
      boundaryTransitionAllowed: approval.boundaryTransition.allowed,
      boundaryTransitionProof: approval.boundaryTransition.proof,
      boundaryClear: approval.boundaryPolicy.boundaryClear,
      workflowNextAction: approval.workflowHandoff.nextAction,
      workflowDisplayState: approval.workflowHandoff.displayState,
      workflowResumeCandidate: approval.workflowHandoff.resumeCandidate,
      workflowDecisionRequired: approval.workflowHandoff.decisionRequired,
      workflowHandoffBlocks: approval.workflowHandoff.handoffBlocks,
      workflowProof: approval.workflowHandoff.proof,
      validation: approval.validation,
      scope: approval.scope,
      proofRequired: approval.requiresProof,
      proofStatus: approval.proofBundle.status,
      proof: approval.proofBundle.proof
    });

    for (const category of approval.impact.categories) {
      const contract = category === 'external_write'
        ? approval.impact.externalWriteContract
        : category === 'destructive_action'
          ? approval.impact.destructiveActionContract
          : approval.impact.privilegedKernelChangeContract;
      timeline.push({
        at: now,
        kind: `approval.impact.${category}`,
        requestId: approval.id,
        label: `${IMPACT_REQUIREMENTS[category].label} contract ${approval.impact.contractComplete ? 'complete' : 'needs repair'}`,
        state: approval.state,
        risk: approval.risk,
        impactCategory: category,
        targetCount: Array.isArray(contract.targets)
          ? contract.targets.length
          : contract.subsystem
            ? 1
            : 0,
        proof: category === 'external_write' ? approval.impact.proof : contract.proof
      });
    }

    timeline.push({
      at: approval.createdAt,
      kind: 'approval.requested',
      requestId: approval.id,
      label: `${approval.risk} risk approval requested for ${approval.action}`,
      state: approval.state,
      risk: approval.risk
    });
    if (approval.state !== 'requested') {
      timeline.push({
        at: now,
        kind: `approval.${approval.state}`,
        requestId: approval.id,
        label: `${approval.state} by ${approval.decidedBy || clientState.operator.id || 'unknown-operator'}`,
        state: approval.state,
        risk: approval.risk
      });
    }
    if (!approval.boundaryPolicy.boundaryClear) {
      timeline.push({
        at: now,
        kind: 'approval.boundary_hold',
        requestId: approval.id,
        label: 'Held by tenant/workspace boundary policy',
        state: approval.state,
        risk: approval.risk
      });
    }
    timeline.push({
      at: now,
      kind: `approval.workflow.${approval.workflowHandoff.displayState}`,
      requestId: approval.id,
      label: approval.workflowHandoff.userVisibleWorkflow.label,
      state: approval.state,
      risk: approval.risk
    });
    if (approval.boundaryTransition.changed) {
      timeline.push({
        at: approval.boundaryTransition.requestedAt || now,
        kind: approval.boundaryTransition.allowed
          ? 'approval.boundary_transition.accepted'
          : 'approval.boundary_transition.blocked',
        requestId: approval.id,
        label: `${approval.boundaryTransition.kind} from ${approval.boundaryTransition.source.isolationKey} to ${approval.boundaryTransition.target.isolationKey}`,
        state: approval.state,
        risk: approval.risk
      });
    }
  }

  const currentSnapshot = {
    id: `${clientState.sessionId}:snapshot:${proofFor({ now, ids: approvals.map((approval) => approval.id), handoff: handoff.nextAction }).slice(0, 12)}`,
    capturedAt: now,
    source: 'approval-console.current',
    pendingCount: stateCounts.requested || 0,
    approvedCount: stateCounts.approved || 0,
    deniedCount: stateCounts.denied || 0,
    invalidCount: approvals.filter((approval) => !approval.valid).length,
    boundaryHoldCount: approvals.filter((approval) => !approval.boundaryPolicy.boundaryClear).length,
    externalWriteCount: approvals.filter((approval) => approval.impact.externalWrite).length,
    destructiveActionCount: approvals.filter((approval) => approval.impact.destructiveAction).length,
    privilegedKernelChangeCount: approvals.filter((approval) => approval.impact.privilegedKernelChange).length,
    criticalImpactCount: approvals.filter((approval) => (
      approval.impact.categories.length > 0 && RISK_ORDER[approval.impact.minimumRisk] >= RISK_ORDER.critical
    )).length,
    proof: `sha256:${proofFor({ now, clientId: clientState.clientId, stateCounts, riskCounts, validationCounts })}`,
    validation: [],
    valid: true,
    snapshotProof: `sha256:${proofFor({
      now,
      clientId: clientState.clientId,
      pendingCount: stateCounts.requested || 0,
      approvedCount: stateCounts.approved || 0,
      deniedCount: stateCounts.denied || 0,
      externalWriteCount: approvals.filter((approval) => approval.impact.externalWrite).length,
      destructiveActionCount: approvals.filter((approval) => approval.impact.destructiveAction).length,
      privilegedKernelChangeCount: approvals.filter((approval) => approval.impact.privilegedKernelChange).length
    })}`
  };
  const history = [...normalizeHistorySnapshots(input, now), currentSnapshot];
  const historyRollup = buildAnalyticsHistoryRollup(history);
  const impactAnalyticsSummary = buildImpactAnalyticsSummary(
    approvals,
    persistedStateUpdate,
    providerIntegration,
    operationalHealth
  );
  const exportColumns = [
    'requestId',
    'tenantId',
    'workspaceId',
    'action',
    'target',
    'impactCategory',
    'impactCategories',
    'impactMinimumRisk',
    'impactRequiredRole',
    'impactRequiredScopes',
    'impactProof',
    'impactExportDisposition',
    'state',
    'risk',
    'decision',
    'requiredRole',
    'operatorRole',
    'permissionBindingIds',
    'permissionBindingRole',
    'boundaryTransitionKind',
    'boundaryTransitionAllowed',
    'boundaryTransitionProof',
    'boundaryClear',
    'workflowNextAction',
    'workflowDisplayState',
    'workflowResumeCandidate',
    'workflowDecisionRequired',
    'workflowHandoffBlocks',
    'workflowProof',
    'validation',
    'scope',
    'proofRequired',
    'proofStatus',
    'proof'
  ];
  const exportPayload = {
    format: 'approval-console.analytics.v1',
    generatedAt: now,
    isolationKey: clientState.boundary.isolationKey,
    route: clientState.route,
    handoffNextAction: handoff.nextAction,
    rowCount: reportRows.length,
    columns: exportColumns,
    rows: reportRows.map((row) => {
      const impactSummary = impactAnalyticsSummary.requestSummaries.find((summary) => summary.requestId === row.requestId);
      return {
        ...row,
        impactExportDisposition: impactSummary ? impactSummary.exportDisposition : 'not_applicable'
      };
    })
  };
  const exportDigest = `sha256:${proofFor(exportPayload)}`;

  timeline.sort((left, right) => {
    const leftTime = parseTime(left.at) ?? 0;
    const rightTime = parseTime(right.at) ?? 0;
    return leftTime - rightTime || left.requestId.localeCompare(right.requestId);
  });

  return {
    counters: {
      totalRequests: approvals.length,
      byState: stateCounts,
      byRisk: riskCounts,
      byImpact: impactCounts,
      byDecision: decisionCounts,
      byRequiredRole: rolePressure,
      byScope: scopeCounts,
      byValidation: validationCounts,
      proofRequiredCount,
      proofReadyCount,
      evidenceCount: evidence.length,
      lifecycleCommandCount: lifecycleState.commands.length,
      lifecycleInvalidCount: lifecycleState.commands.filter((command) => !command.valid).length,
      providerCount: providerIntegration.providers.length,
      providerBlockedCount: providerIntegration.negotiation.blockedProviderIds.length,
      providerSyncRequiredCount: providerIntegration.negotiation.syncRequiredProviderIds.length,
      providerAckRequiredCount: providerIntegration.negotiation.ackRequiredProviderIds.length,
      providerImpactObligationCount: providerIntegration.impactObligations.length,
      providerImpactBlockedProviderCount: providerIntegration.negotiation.impactBlockedProviderIds.length,
      providerImpactBlockedRequestCount: providerIntegration.negotiation.impactBlockedRequestIds.length,
      impactAnalyticsRequestCount: impactAnalyticsSummary.requestCount,
      impactAnalyticsBlockedCount: impactAnalyticsSummary.counters.byDisposition.blocked || 0,
      impactAnalyticsManualExportEligibleCount: impactAnalyticsSummary.counters.manualExportEligible,
      externalWriteAnalyticsCount: impactAnalyticsSummary.counters.byCategory.external_write || 0,
      destructiveActionAnalyticsCount: impactAnalyticsSummary.counters.byCategory.destructive_action || 0,
      privilegedKernelChangeAnalyticsCount: impactAnalyticsSummary.counters.byCategory.privileged_kernel_change || 0,
      permissionBindingCount: clientState.permissionBoundary.bindings.length,
      activePermissionBindingCount: clientState.permissionBoundary.activeBindingIds.length,
      permissionBindingInvalidCount: clientState.permissionBoundary.validation.length,
      permissionHoldCount: approvals.filter((approval) => approval.boundaryPolicy.permissionGrant.validation.length > 0).length,
      boundaryTransitionCount: approvals.filter((approval) => approval.boundaryTransition.changed).length,
      boundaryTransitionBlockedCount: approvals.filter((approval) => approval.boundaryTransition.changed && !approval.boundaryTransition.allowed).length,
      recoveredApprovalCount: handoff.clientRuntimeHandoff.persistence.recoveredApprovalIds.length,
      recoveredLifecycleCommandCount: lifecycleState.recoveredCommandIds.length,
      replayRequiredApprovalCount: handoff.clientRuntimeHandoff.persistence.replayRequiredApprovalIds.length,
      replayRequiredLifecycleCommandCount: lifecycleState.replayRequiredCommandIds.length,
      stagedIntentCount: persistedStateUpdate.stagedIntentIds.length,
      committedIntentCount: persistedStateUpdate.committedIntentIds.length,
      impactCommandCount: persistedStateUpdate.impactCommandIds.length,
      stagedImpactCommandCount: persistedStateUpdate.stagedImpactCommandIds.length,
      committedImpactCommandCount: persistedStateUpdate.committedImpactCommandIds.length,
      recoveredImpactCommandCount: handoff.clientRuntimeHandoff.persistence.recoveredImpactCommandIds.length,
      replayRequiredImpactCommandCount: handoff.clientRuntimeHandoff.persistence.replayRequiredImpactCommandIds.length,
      suppressedReplayCount: persistedStateUpdate.suppressedReplayIds.length,
      previewReadyCount: previewAcceptance.summary.readyCount,
      previewBlockedCount: previewAcceptance.summary.blockedCount,
      previewAcceptedCount: previewAcceptance.summary.acceptedCount,
      previewRequiredSectionCount: previewAcceptance.summary.requiredSectionCount,
      previewAcceptedRequiredSectionCount: previewAcceptance.summary.acceptedRequiredSectionCount,
      previewMissingRequiredSectionCount: previewAcceptance.summary.missingRequiredSectionCount,
      operationalFailureCount: operationalHealth.metrics.failureCount,
      operationalRetryableCount: operationalHealth.metrics.retryableCount,
      operationalExhaustedRetryCount: operationalHealth.metrics.exhaustedRetryCount,
      averageDecisionMs: decidedWithLatency ? Math.round(totalDecisionMs / decidedWithLatency) : null
    },
    history,
    historyRollup,
    currentSnapshot,
    impactAnalyticsSummary,
    exportSummary: {
      ...exportPayload,
      impactSummaryProof: impactAnalyticsSummary.proof,
      proof: `sha256:${proofFor({ exportPayload, handoff, currentSnapshot, historyRollup, impactSummaryProof: impactAnalyticsSummary.proof })}`
    },
    exportManifest: {
      format: 'approval-console.analytics-export-manifest.v1',
      generatedAt: now,
      destination: 'operator-userland/analytics-ledger',
      contentType: 'application/json',
      rowCount: reportRows.length,
      columnCount: exportColumns.length,
      columns: exportColumns,
      contentDigest: exportDigest,
      historyProof: historyRollup.proof,
      impactSummaryProof: impactAnalyticsSummary.proof,
      operationalHealthProof: operationalHealth.proof,
      ready: reportRows.length > 0 && historyRollup.valid && impactAnalyticsSummary.readyForExport && operationalHealth.status !== 'critical',
      blockedReasons: [
        ...historyRollup.validation,
        ...(!impactAnalyticsSummary.readyForExport ? ['analytics.export.impact_summary_blocked'] : []),
        ...(operationalHealth.status === 'critical' ? ['analytics.export.operational_health_critical'] : [])
      ],
      proof: `sha256:${proofFor({ exportDigest, historyProof: historyRollup.proof, impactSummaryProof: impactAnalyticsSummary.proof, rowCount: reportRows.length })}`
    },
    timeline,
    reportingState: {
      status: handoff.nextAction === 'resume-hosted-kernel' ? 'ready_to_resume' : handoff.nextAction,
      staleHistory: history.length > 1 && !historyRollup.valid,
      blockedByValidation: Object.keys(validationCounts).length > 0 || historyRollup.validation.length > 0,
      blockedByBoundary: currentSnapshot.boundaryHoldCount > 0,
      operationalHealthStatus: operationalHealth.status,
      degradedModeActive: operationalHealth.degradedMode.active,
      exportReady: approvals.length > 0 && reportRows.every((row) => row.requestId && row.action && row.target),
      exportDigest,
      historyTrend: historyRollup.trend,
      impactExportReady: impactAnalyticsSummary.readyForExport,
      impactExportDispositionCounts: impactAnalyticsSummary.counters.byDisposition,
      nextReportDestination: 'operator-userland/analytics-ledger'
    },
    operationalHealthState: {
      format: operationalHealth.format,
      status: operationalHealth.status,
      severity: operationalHealth.severity,
      degradedMode: operationalHealth.degradedMode,
      circuitBreaker: operationalHealth.circuitBreaker,
      degradedCapabilities: operationalHealth.degradedCapabilities,
      impactDegradedModePolicy: operationalHealth.impactDegradedModePolicy,
      retryQueueDepth: operationalHealth.retryQueue.length,
      retryBudget: operationalHealth.retryBudget,
      actionableErrors: operationalHealth.actionableErrors,
      operatorRunbook: operationalHealth.operatorRunbook,
      remediationPlan: operationalHealth.remediationPlan,
      proof: operationalHealth.proof
    },
    providerState: {
      contractName: providerIntegration.contractName,
      selectedProviderId: providerIntegration.selectedProviderId,
      negotiationStatus: providerIntegration.negotiation.status,
      externalHandoffState: providerIntegration.externalHandoff.state,
      destination: providerIntegration.externalHandoff.destination,
      missingCapabilities: providerIntegration.negotiation.missingCapabilities,
      impactObligationCount: providerIntegration.impactObligations.length,
      impactBlockedProviderIds: providerIntegration.negotiation.impactBlockedProviderIds,
      impactBlockedRequestIds: providerIntegration.negotiation.impactBlockedRequestIds,
      impactSyncBarriers: providerIntegration.negotiation.impactSyncBarriers,
      syncRequiredProviderIds: providerIntegration.negotiation.syncRequiredProviderIds,
      ackRequiredProviderIds: providerIntegration.negotiation.ackRequiredProviderIds,
      acknowledgementState: providerIntegration.externalHandoff.acknowledgement.state,
      ackRequired: providerIntegration.externalHandoff.ackRequired,
      ackSatisfied: providerIntegration.externalHandoff.ackSatisfied,
      handoffMode: providerIntegration.externalHandoff.handoffMode,
      syncGeneration: providerIntegration.externalHandoff.syncGeneration,
      dispatchState: providerIntegration.externalHandoff.handoffEnvelope.dispatchState,
      dispatchLane: providerIntegration.externalHandoff.handoffEnvelope.lane,
      handoffEnvelopeProof: providerIntegration.externalHandoff.handoffEnvelope.proof
    },
    permissionBoundaryState: {
      format: clientState.permissionBoundary.format,
      requireExplicitWorkspaceGrant: clientState.permissionBoundary.requireExplicitWorkspaceGrant,
      activeBindingIds: clientState.permissionBoundary.activeBindingIds,
      invalidBindingCount: clientState.permissionBoundary.validation.length,
      validation: clientState.permissionBoundary.validation,
      proof: clientState.permissionBoundary.proof
    },
    clientRuntimeState: {
      format: handoff.clientRuntimeHandoff.format,
      ready: handoff.clientRuntimeHandoff.ready,
      nextAction: handoff.clientRuntimeHandoff.nextAction,
      destination: handoff.clientRuntimeHandoff.destination,
      providerId: handoff.clientRuntimeHandoff.providerId,
      proof: handoff.clientRuntimeHandoff.proof,
      resumeIntentCount: handoff.clientRuntimeHandoff.resumeIntentIds.length,
      lifecycleCommandIntentCount: handoff.clientRuntimeHandoff.lifecycleCommandIntentIds.length,
      blockedReasons: handoff.clientRuntimeHandoff.blockedReasons,
      userVisibleWorkflow: handoff.clientRuntimeHandoff.userVisibleWorkflow
    },
    previewAcceptanceState: {
      format: previewAcceptance.format,
      proof: previewAcceptance.proof,
      destination: previewAcceptance.destination,
      nextAction: previewAcceptance.nextAction,
      readyPreviewIds: previewAcceptance.previewIds,
      blockedPreviewIds: previewAcceptance.blockedPreviewIds,
      highRiskReadyIds: previewAcceptance.highRiskReadyIds,
      requiredSectionIds: previewAcceptance.requiredSectionIds,
      accepted: previewAcceptance.acceptance.accepted,
      acceptedPreviewIds: previewAcceptance.acceptance.acceptedPreviewIds,
      acceptedSectionIds: previewAcceptance.acceptance.acceptedSectionIds,
      missingRequiredSectionIds: previewAcceptance.acceptance.missingRequiredSectionIds,
      validation: previewAcceptance.acceptance.validation,
      nextStep: previewAcceptance.acceptance.nextStep,
      summary: previewAcceptance.summary
    },
    lifecycleState: {
      enabled: lifecycleState.enabled,
      schedulerEnabled: lifecycleState.schedulerEnabled,
      nextAction: lifecycleState.nextAction,
      controls: lifecycleState.controls,
      scheduling: lifecycleState.scheduling,
      pendingCommandIds: lifecycleState.pendingCommandIds,
      executableCommandIds: lifecycleState.executableCommandIds,
      recoveredCommandIds: lifecycleState.recoveredCommandIds,
      replayRequiredCommandIds: lifecycleState.replayRequiredCommandIds,
      rejectedCommandIds: lifecycleState.commands
        .filter((command) => !command.valid)
        .map((command) => command.id),
      auditProof: lifecycleState.auditProof
    },
    persistenceState: {
      format: persistedState.format,
      updateFormat: persistedStateUpdate.format,
      recoveryMode: persistedState.recoveryMode,
      revision: persistedState.revision,
      nextRevision: persistedState.nextRevision,
      recovered: persistedState.recovered,
      commitStatus: persistedStateUpdate.commitStatus,
      writePolicy: persistedStateUpdate.writePolicy,
      validation: persistedStateUpdate.validation,
      checkpointProof: persistedState.checkpointProof,
      nextCheckpointProof: persistedStateUpdate.nextCheckpoint.proof,
      updateProof: persistedStateUpdate.proof,
      appliedApprovalIds: persistedStateUpdate.appliedApprovalIds,
      appliedLifecycleCommandIds: persistedStateUpdate.appliedLifecycleCommandIds,
      committedIntentIds: persistedStateUpdate.committedIntentIds,
      stagedIntentIds: persistedStateUpdate.stagedIntentIds,
      impactCommandIds: persistedStateUpdate.impactCommandIds,
      committedImpactCommandIds: persistedStateUpdate.committedImpactCommandIds,
      stagedImpactCommandIds: persistedStateUpdate.stagedImpactCommandIds,
      suppressedReplayIds: persistedStateUpdate.suppressedReplayIds,
      replayRequiredApprovalIds: handoff.clientRuntimeHandoff.persistence.replayRequiredApprovalIds,
      replayRequiredLifecycleCommandIds: lifecycleState.replayRequiredCommandIds,
      recoveredImpactCommandIds: handoff.clientRuntimeHandoff.persistence.recoveredImpactCommandIds,
      replayRequiredImpactCommandIds: handoff.clientRuntimeHandoff.persistence.replayRequiredImpactCommandIds,
      journal: persistedStateUpdate.nextCheckpoint.journal,
      impactCommands: persistedStateUpdate.nextCheckpoint.impactCommands,
      restartSafeStatus: persistedStateUpdate.restartSafeStatus
    }
  };
}

export function describeApprovalConsoleSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const clientState = normalizeClientState(input, now);
  const persistedState = normalizePersistedState(input, now, clientState);
  const lifecycleSettings = normalizeLifecycleSettings(input, now);
  const lifecycleCommands = collectLifecycleCommands(input, lifecycleSettings, clientState, now);
  const lifecycle = buildLifecycleState(now, clientState, lifecycleSettings, lifecycleCommands, persistedState);
  const evidence = normalizeEvidenceItems(input.evidence, now);
  const approvals = attachGlobalEvidenceToApprovals(collectRequests(input, clientState, now), evidence, clientState, now);
  const baseHandoff = buildHandoff(clientState, approvals, lifecycle);
  const providerIntegration = buildProviderIntegration(now, clientState, approvals, lifecycle, baseHandoff, input);
  const clientRuntimeHandoff = buildClientRuntimeHandoff(now, clientState, approvals, lifecycle, providerIntegration, baseHandoff, persistedState);
  const previewAcceptance = buildPreviewAcceptance(now, clientState, approvals, lifecycle, providerIntegration, clientRuntimeHandoff, input);
  const persistedStateUpdate = buildPersistedStateUpdate(now, clientState, lifecycle, clientRuntimeHandoff, previewAcceptance, persistedState);
  const handoff = attachProviderHandoff(baseHandoff, providerIntegration, clientRuntimeHandoff, previewAcceptance);
  const operationalHealth = buildOperationalHealth(now, input, clientState, approvals, lifecycle, providerIntegration, clientRuntimeHandoff, previewAcceptance, persistedState, persistedStateUpdate);
  const routePreviewReadiness = buildRoutePreviewReadiness(now, handoff, providerIntegration, clientRuntimeHandoff, previewAcceptance, persistedStateUpdate, operationalHealth);
  const audit = buildAuditRecord(now, clientState, approvals, handoff, evidence, lifecycle, providerIntegration, clientRuntimeHandoff, persistedState, previewAcceptance, persistedStateUpdate, operationalHealth);
  const analytics = buildApprovalAnalytics(now, clientState, approvals, handoff, evidence, input, lifecycle, providerIntegration, persistedState, previewAcceptance, persistedStateUpdate, operationalHealth);

  return {
    ok: audit.rejected.length === 0 && lifecycle.validation.length === 0 && !['blocked', 'critical'].includes(operationalHealth.status),
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: {
      name: 'operator-userland.approval-console.v1',
      requiredRequestFields: ['id', 'action', 'target', 'intent', 'risk', 'state'],
      acceptedStates: [...APPROVAL_STATES],
      decisionValues: [...DECISIONS],
      roleValues: Object.keys(ROLE_ORDER),
      tenantBoundaryFields: ['tenantId', 'workspaceId', 'isolationKey', 'operator.roles', 'capabilities', 'permissionBoundary'],
      auditProof: 'sha256(stable client/request/handoff payload)',
      approvalImpactContract: {
        format: 'approval-console.approval-impact.v1',
        acceptedInputs: ['request.impactType', 'request.impactTypes', 'request.impacts', 'request.externalWrite', 'request.externalTargets', 'request.destructive', 'request.privilegedKernelChange', 'request.kernelChange'],
        impactTypes: [...APPROVAL_IMPACT_TYPES],
        fields: ['categories', 'labels', 'primaryCategory', 'externalWrite', 'destructiveAction', 'privilegedKernelChange', 'externalTargets', 'requiredRole', 'minimumRisk', 'requiresProof', 'requiredScopes', 'missingScopeContracts', 'detectionReasons', 'validation', 'proof'],
        enforcement: ['external writes require high risk, tenant_admin, proof, and external:write scope', 'destructive actions require critical risk, kernel_admin, proof, and destructive:execute scope', 'privileged kernel changes require critical risk, kernel_admin, proof, and kernel:* scope'],
        proof: 'sha256(stable action/target/impact requirement payload)'
      },
      boundaryTransitionContract: {
        format: 'approval-console.boundary-transition.v1',
        acceptedInputs: ['request.boundaryTransition', 'request.transition', 'request.boundaryHandoff'],
        kinds: [...BOUNDARY_TRANSITION_KINDS],
        fields: ['kind', 'declaredKind', 'source', 'target', 'crossTenant', 'crossWorkspace', 'changed', 'requestedBy', 'requestedAt', 'reason', 'externalProof', 'validation', 'allowed', 'proof'],
        enforcement: ['cross-tenant requires kernel_admin and proof', 'cross-workspace requires tenant_admin', 'cross-boundary reason required', 'disabled client boundary flags block transitions'],
        proof: 'sha256(stable source/target transition payload)'
      },
      permissionBoundaryContract: {
        format: clientState.permissionBoundary.format,
        acceptedInputs: ['permissionBindings', 'workspacePermissions', 'clientState.permissionBindings', 'runtime.permissionBindings', 'operator.permissionBindings'],
        fields: ['requireExplicitWorkspaceGrant', 'bindings', 'activeBindingIds', 'validation', 'proof'],
        bindingFields: ['id', 'tenantId', 'workspaceId', 'role', 'permissions', 'source', 'expiresAt', 'proof', 'bindingProof'],
        enforcement: ['target tenant/workspace grant lookup', 'binding role must satisfy risk role', 'binding permissions must cover requested scope'],
        proof: 'sha256(stable permission binding payload)'
      },
      lifecycleContract: {
        commands: [...LIFECYCLE_COMMANDS],
        settingsFields: ['enabled', 'schedulerEnabled', 'requireApprovalForEnable', 'requireProofForDisable', 'maxScheduledHours', 'minLeadMinutes', 'controls', 'schedule', 'maintenanceWindow'],
        controlFields: ['enable', 'disable', 'schedule', 'unschedule', 'pause', 'resume', 'disabledCommands', 'reason'],
        schedulingFields: ['configured', 'schedulerEnabled', 'windowStartAt', 'windowEndAt', 'recurring', 'timezone', 'nextScheduledCommandId', 'blockedByControlsCommandIds'],
        nextActions: ['repair-lifecycle-settings', 'repair-persisted-state', 'replay-lifecycle-command', 'repair-lifecycle-command', 'await-scheduled-lifecycle-window', 'request-lifecycle-approval', 'apply-lifecycle-command', 'observe-recovered-lifecycle', 'observe-maintenance-window', 'observe-lifecycle'],
        proof: 'sha256(stable lifecycle settings/commands payload)'
      },
      analyticsContract: {
        counters: ['totalRequests', 'byState', 'byRisk', 'byImpact', 'byDecision', 'byRequiredRole', 'byScope', 'byValidation', 'impactAnalyticsRequestCount', 'impactAnalyticsBlockedCount', 'impactAnalyticsManualExportEligibleCount', 'externalWriteAnalyticsCount', 'destructiveActionAnalyticsCount', 'privilegedKernelChangeAnalyticsCount', 'stagedIntentCount', 'committedIntentCount', 'impactCommandCount', 'stagedImpactCommandCount', 'committedImpactCommandCount', 'recoveredImpactCommandCount', 'replayRequiredImpactCommandCount', 'suppressedReplayCount'],
        historySnapshotFields: ['id', 'capturedAt', 'source', 'pendingCount', 'approvedCount', 'deniedCount', 'invalidCount', 'boundaryHoldCount', 'externalWriteCount', 'destructiveActionCount', 'privilegedKernelChangeCount', 'criticalImpactCount', 'proof', 'validation', 'valid', 'snapshotProof'],
        historyRollupFields: ['format', 'sampleCount', 'currentSnapshotId', 'previousSnapshotId', 'deltas', 'trend', 'validation', 'valid', 'proof'],
        impactSummaryFormat: 'approval-console.impact-analytics-summary.v1',
        impactSummaryFields: ['requestCount', 'counters', 'requestSummaries', 'exportColumns', 'readyForExport', 'proof'],
        impactSummaryDispositionValues: ['runtime_dispatch_ready', 'manual_export_ready', 'blocked', 'review_required'],
        exportFormat: 'approval-console.analytics.v1',
        exportManifestFormat: 'approval-console.analytics-export-manifest.v1',
        timelineEvents: ['approval.requested', 'approval.approved', 'approval.denied', 'approval.expired', 'approval.cancelled', 'approval.impact.external_write', 'approval.impact.destructive_action', 'approval.impact.privileged_kernel_change', 'approval.boundary_hold', 'approval.boundary_transition.accepted', 'approval.boundary_transition.blocked', 'approval.workflow.ready', 'approval.workflow.waiting', 'approval.workflow.blocked', 'approval.workflow.closed']
      },
      approvalWorkflowHandoffContract: {
        format: 'approval-console.approval-workflow-handoff.v1',
        fields: ['requestId', 'clientRequestId', 'previewId', 'route', 'destination', 'isolationKey', 'nextAction', 'displayState', 'resumeCandidate', 'decisionRequired', 'operator', 'gates', 'handoffBlocks', 'auditRefs', 'userVisibleWorkflow', 'proof'],
        displayStates: ['ready', 'blocked', 'waiting', 'closed'],
        gateFields: ['boundary', 'proof', 'decision', 'runtime'],
        gateStates: ['passed', 'blocked', 'waiting', 'ready', 'not_required', 'closed'],
        nextActions: ['stage-runtime-resume-preview', 'collect-operator-decision', 'attach-proof-before-runtime-handoff', 'repair-boundary-before-decision', 'repair-approval-contract', 'observe-denied', 'observe-expired', 'observe-cancelled'],
        auditRefFields: ['proofBundleProof', 'boundaryTransitionProof', 'approvalImpactProof', 'permissionBoundaryProof', 'acceptedEvidenceIds'],
        userVisibleWorkflowFields: ['primaryAction', 'label', 'destinationLabel'],
        proof: 'sha256(stable per-approval workflow handoff payload)'
      },
      providerContract: {
        name: providerIntegration.contractName,
        requiredFields: providerIntegration.requiredFields,
        requiredCapabilities: providerIntegration.requiredCapabilities,
        syncStates: ['in_sync', 'sync_required', 'blocked'],
        syncFields: ['cursor', 'expectedRevision', 'observedRevision', 'generation', 'watermark', 'source', 'lastSyncedAt', 'leaseUntil', 'dirty', 'state', 'validation'],
        acknowledgementStates: [...PROVIDER_ACK_STATES],
        handoffModes: [...PROVIDER_HANDOFF_MODES],
        dispatchLanes: [...PROVIDER_DISPATCH_LANES],
        impactSupportFormat: 'approval-console.provider-impact-support.v1',
        impactSupportFields: ['supportedTypes', 'acceptedProofRefs', 'maxExternalTargets', 'destructiveActionsRequireManualExport', 'privilegedKernelChangesRequireOperatorLane', 'validation'],
        impactReadinessFormat: 'approval-console.provider-impact-readiness.v1',
        impactReadinessFields: ['obligationCount', 'satisfiedObligationCount', 'blockedRequestIds', 'syncBarriers', 'statuses', 'validation', 'ready'],
        impactObligationFields: ['requestId', 'category', 'providerCapability', 'allowedHandoffModes', 'allowedDispatchLanes', 'requiredProofRefs', 'syncBarrier', 'targetCount', 'targetDigest', 'impactProof', 'proofBundleProof', 'boundaryTransitionProof'],
        impactSyncBarriers: providerIntegration.negotiation.impactSyncBarriers,
        externalHandoffStates: [
          'provider_contract_missing',
          'provider_contract_blocked',
          'provider_sync_required',
          'provider_ack_required',
          'provider_ack_expired',
          'ready_for_external_handoff',
          'waiting_for_operator_state'
        ],
        externalHandoffFields: ['state', 'destination', 'providerId', 'syncCursor', 'syncGeneration', 'acknowledgement', 'handoffMode', 'ackRequired', 'ackSatisfied', 'serviceLevel', 'dispatchPolicy', 'impactReadiness', 'handoffEnvelope', 'payloadFormat', 'payloadProof'],
        handoffEnvelopeFormat: 'approval-console.provider-handoff-envelope.v1',
        handoffEnvelopeFields: ['dispatchState', 'lane', 'retryTopic', 'destination', 'providerId', 'isolationKey', 'nextAction', 'idempotencyKey', 'replayProtection', 'sync', 'obligations', 'impactReadiness', 'payloadDigest', 'proof'],
        payloadFormat: providerIntegration.externalHandoff.payloadFormat,
        proof: 'sha256(stable provider negotiation/handoff payload)'
      },
      clientRuntimeHandoffContract: {
        format: clientRuntimeHandoff.format,
        fields: ['clientId', 'sessionId', 'route', 'destination', 'providerId', 'isolationKey', 'nextAction', 'resumeIntents', 'resumeIntents.impact', 'resumeIntents.impactCommands', 'lifecycleCommandIntents', 'blockedReasons', 'syncCursor', 'persistence', 'proof'],
        impactCommandFields: ['requestId', 'category', 'idempotencyKey', 'commandDigest', 'targetDigest', 'barrier', 'proofRefs', 'persistedStatus', 'persistedProof'],
        readyWhen: ['provider ready', 'no blocked reasons', 'approved resume or executable lifecycle intent present'],
        userVisibleWorkflowFields: ['primaryAction', 'resumeCount', 'lifecycleCommandCount', 'recoveredCount', 'blockedCount', 'destinationLabel'],
        proof: 'sha256(stable client runtime handoff packet)'
      },
      previewAcceptanceContract: {
        format: previewAcceptance.format,
        acceptedInputs: ['previewAcceptance', 'acceptance', 'operatorAcceptance'],
        fields: ['previewIds', 'blockedPreviewIds', 'highRiskReadyIds', 'requiredSectionIds', 'items', 'items.reviewSections', 'items.requiredReviewSectionIds', 'items.acceptedReviewSectionIds', 'items.impactCategory', 'items.impactProof', 'summary', 'acceptance', 'proof'],
        itemKinds: ['approval', 'lifecycle-command'],
        reviewSectionKinds: ['summary', 'external_write', 'destructive_action', 'privileged_kernel_change'],
        reviewSectionFields: ['id', 'kind', 'title', 'required', 'proofRef', 'validation', 'operatorPrompt', 'fields', 'acceptedWhen', 'proof'],
        acceptedSectionInputs: ['previewAcceptance.acceptedSectionIds', 'previewAcceptance.sectionIds', 'previewAcceptance.reviewedSectionIds'],
        acceptanceFields: ['acceptedBy', 'acceptedAt', 'acceptedPreviewIds', 'acceptedSectionIds', 'acceptedRequiredSectionIds', 'missingRequiredSectionIds', 'acknowledgedRiskIds', 'clientProof', 'accepted', 'validation', 'nextStep'],
        sectionAcceptanceRules: ['ready approval summary sections must be accepted', 'external write sections must be accepted before runtime resume', 'destructive action sections must be accepted before runtime resume', 'privileged kernel change sections must be accepted before runtime resume'],
        nextSteps: ['accept-required-preview-sections', 'repair-preview-acceptance', 'resume-hosted-kernel', 'apply-lifecycle-command', 'replay-lifecycle-command', 'observe-runtime-state', 'wait-for-operator-decision', 'replay-interrupted-runtime-intent', 'repair-workspace-permission-bindings'],
        proof: 'sha256(stable preview ids/readiness/runtime proof payload)'
      },
      routePreviewReadinessContract: {
        format: routePreviewReadiness.format,
        fields: ['panelState', 'primaryCta', 'destinationLabel', 'focusRequestId', 'readinessGates', 'validationSummary', 'previewSummary', 'acceptedPreviewIds', 'nextStep', 'proof'],
        panelStates: ['ready', 'blocked', 'waiting', 'observe'],
        gateFields: ['id', 'label', 'state', 'blockingReasons'],
        gateIds: ['preview.visible', 'preview.accepted', 'runtime.ready', 'provider.ready', 'checkpoint.commit', 'operations.ready'],
        gateStates: ['passed', 'blocked', 'waiting'],
        validationSummaryFields: ['totalCount', 'previewAcceptance', 'runtimeHandoff', 'provider', 'persistence', 'operationalHealth'],
        proofFields: ['dispatchEnvelopeProof', 'runtimeHandoffProof', 'checkpointUpdateProof', 'operationalHealthProof'],
        nextSteps: ['commit-checkpoint-and-dispatch', 'load-preview-items', 'accept-required-preview-sections', 'repair-preview-acceptance', 'resume-hosted-kernel', 'apply-lifecycle-command', 'replay-lifecycle-command', 'provider_sync_required', 'provider_ack_required', 'provider_ack_expired', 'awaiting_operator_acceptance', 'materialized'],
        proof: 'sha256(stable route preview readiness payload and grouped validation)'
      },
      persistedStateContract: {
        format: persistedState.format,
        acceptedInputs: ['persistedState', 'stateCheckpoint', 'recoveredState'],
        fields: ['revision', 'epoch', 'isolationKey', 'lastMaterializedAt', 'appliedApprovalIds', 'appliedLifecycleCommandIds', 'commandDigests', 'journal', 'impactCommands', 'proof'],
        journalFields: ['id', 'kind', 'status', 'digest', 'isolationKey', 'attempts', 'createdAt', 'lastAttemptAt', 'proof'],
        journalStatuses: [...JOURNAL_STATUSES],
        impactCommandFormat: 'approval-console.persisted-impact-command.v1',
        impactCommandAcceptedInputs: ['persistedState.impactCommands', 'persistedState.appliedImpactCommands', 'persistedState.impactCommandLedger', 'persistedState.externalWriteCommands', 'persistedState.destructiveActionCommands', 'persistedState.kernelChangeCommands'],
        impactCommandFields: ['id', 'requestId', 'category', 'status', 'idempotencyKey', 'commandDigest', 'targetDigest', 'barrier', 'isolationKey', 'stagedAt', 'committedAt', 'proofRefs', 'replayable', 'committed', 'failed', 'terminal', 'validation', 'proof'],
        impactCommandStatuses: [...IMPACT_COMMAND_STATUSES],
        impactCommandCategories: [...APPROVAL_IMPACT_TYPES],
        impactCommandRestartRules: ['committed impact commands suppress duplicate external/destructive/kernel execution', 'staged impact commands require restart replay', 'failed impact commands require operator review', 'destructive committed commands require rollbackProof', 'privileged kernel committed commands require kernelConfigDigest'],
        recoveryModes: ['cold_start', 'checkpoint_loaded', 'recover_inflight_commit', 'resume_from_checkpoint', 'checkpoint_repair_required'],
        updateFormat: persistedStateUpdate.format,
        updateFields: ['writePolicy', 'commitStatus', 'restartSafeStatus', 'nextCheckpoint', 'committedIntentIds', 'stagedIntentIds', 'impactCommandIds', 'committedImpactCommandIds', 'stagedImpactCommandIds', 'suppressedReplayIds', 'validation', 'proof'],
        commitStatuses: ['commit_checkpoint', 'do_not_commit'],
        restartSafeStatuses: ['materialized', 'commit_ready', 'replay_required', 'idempotent_replay_suppressed', 'awaiting_operator_acceptance', 'awaiting_provider_sync', 'awaiting_provider_ack', 'checkpoint_repair_required'],
        proof: 'sha256(stable persisted checkpoint payload)'
      },
      operationalHealthContract: {
        format: operationalHealth.format,
        acceptedInputs: ['retryPolicy', 'healthRetryPolicy', 'runtimeRetry', 'operationalHealth', 'health', 'healthSlo'],
        statuses: ['healthy', 'attention_required', 'degraded', 'blocked', 'critical'],
        failureStateFields: ['id', 'code', 'source', 'severity', 'action', 'retryable'],
        retryQueueFields: ['id', 'kind', 'target', 'reason', 'attempts', 'delayMs', 'nextRetryAt', 'retryable', 'exhausted'],
        retryBudgetFields: ['kind', 'queued', 'retryable', 'exhausted', 'nextRetryAt'],
        degradedModeFields: ['active', 'runtimeHandoffPaused', 'allowOperatorReview', 'reason'],
        degradedCapabilityFields: ['operatorReview', 'evidenceAttachment', 'previewAcceptance', 'providerSyncRefresh', 'providerAcknowledgement', 'externalRuntimeDispatch', 'checkpointCommit', 'readOnlyAuditExport', 'blockedCapabilities'],
        circuitBreakerFields: ['state', 'suppressExternalHandoff', 'retryDueIds', 'exhaustedRetryIds', 'contractFailureCodes', 'queueOverLimit', 'resetCondition', 'proof'],
        circuitBreakerStates: ['closed', 'cooling_down', 'half_open', 'open'],
        healthSloFields: ['providerSyncStaleMs', 'ackGraceMs', 'maxRetryQueueDepth', 'maxActionableErrors'],
        operatorRunbookFields: ['errorCode', 'source', 'severity', 'primaryAction', 'retryInstruction', 'retryQueueId', 'operatorMessage'],
        remediationPlanFormat: 'approval-console.operator-remediation-plan.v1',
        remediationPlanFields: ['generatedAt', 'circuitState', 'stepCount', 'autoRetryStepIds', 'operatorRequiredStepIds', 'runtimeBlockingStepIds', 'degradedModeEligibleStepIds', 'steps', 'proof'],
        remediationStepFields: ['id', 'domain', 'code', 'source', 'severity', 'action', 'blockedCapability', 'retryQueueId', 'retryDue', 'nextRetryAt', 'retryExhausted', 'canAutoRetry', 'requiresOperator', 'degradedModeEligible', 'handoffBlocking', 'nextStep'],
        actionableErrorFields: ['code', 'source', 'severity', 'action', 'retryable', 'retryDue', 'nextRetryAt', 'retryExhausted', 'blockedCapability', 'nextStep'],
        proof: 'sha256(stable operational health payload)'
      }
    },
    clientState,
    persistedState,
    persistedStateUpdate,
    lifecycle,
    approvals,
    handoff,
    providerIntegration,
    clientRuntimeHandoff,
    previewAcceptance,
    routePreviewReadiness,
    operationalHealth,
    audit,
    analytics,
    evidence
  };
}

export default describeApprovalConsoleSurface;
