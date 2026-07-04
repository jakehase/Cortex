import {
  buildMailchimpHandoffIdentity,
  compileMailchimpAdapterHandoff,
} from '../runtime/adapter-handoff.mjs';

const DEFAULT_CACHE_LIMIT = 128;
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const CACHE_LIFECYCLE_COMMANDS = new Set(['observe', 'enable', 'disable', 'refresh', 'evict_stale', 'export', 'hold']);
const CACHE_SCHEDULE_MODES = new Set(['manual', 'automatic', 'scheduled']);
const SYNC_CHECKPOINT_STATES = new Set(['ready', 'missing_cursor', 'stale', 'external_unlinked', 'local_only']);
const MAILCHIMP_RESOURCE_CAPABILITIES = Object.freeze({
  audience: ['audience.read', 'audience.write', 'member.read'],
  campaign: ['campaign.read', 'campaign.write', 'audience.read'],
  member: ['member.read', 'member.write', 'audience.read'],
  segment: ['segment.read', 'segment.write', 'audience.read'],
  template: ['template.read', 'template.write'],
  report: ['report.read', 'campaign.read'],
  automation: ['automation.read', 'automation.write'],
});
const MAILCHIMP_BOUNDARY_ROLE_GRANTS = Object.freeze({
  owner: ['tenant.admin', 'workspace.admin', 'audience.read', 'audience.write', 'campaign.read', 'campaign.write', 'member.read', 'member.write'],
  admin: ['workspace.admin', 'audience.read', 'audience.write', 'campaign.read', 'campaign.write', 'member.read', 'member.write'],
  marketer: ['audience.read', 'campaign.read', 'campaign.write', 'member.read', 'segment.read', 'template.read'],
  analyst: ['audience.read', 'campaign.read', 'member.read', 'report.read'],
  viewer: ['audience.read', 'campaign.read', 'member.read', 'report.read', 'template.read'],
  auditor: ['audit.read', 'audience.read', 'campaign.read', 'report.read'],
});
const COMPILE_CACHE_FAILURE_ACTIONS = Object.freeze({
  none: 'observe',
  stale_cache_entry: 'refresh_compile_cache',
  provider_sync_not_restart_safe: 'refresh_provider_sync_before_replay',
  export_not_ready: 'review_compile_cache_export',
  replay_barrier_closed: 'open_compile_cache_replay_barrier',
  retry_budget_exhausted: 'hold_for_operator',
  persisted_replay_not_restart_safe: 'rebuild_persisted_replay_state',
  lifecycle_controls_blocked: 'repair_compile_cache_lifecycle_settings',
});
const RECOVERY_COMMAND_OWNER_HINTS = Object.freeze({
  observe: 'runtime',
  reuse_compile_cache: 'runtime',
  resume_from_compile_cache: 'runtime',
  verify_cached_descriptor: 'runtime',
  deliver_compile_cache_export: 'runtime',
  refresh_compile_cache: 'compiler',
  repair_cached_descriptor: 'compiler',
  rebuild_persisted_replay_state: 'compiler',
  repair_compile_cache_lifecycle_settings: 'compiler',
  evict_stale_compile_cache_entries: 'compiler',
  export_compile_cache_summary: 'compiler',
  refresh_provider_sync_before_replay: 'provider',
  renegotiate_mailchimp_provider_capabilities: 'provider',
  relink_external_handoff: 'provider',
  repair_tenant_permissions: 'operator',
  request_compile_cache_acceptance: 'operator',
  hold_for_operator: 'operator',
  await_compile_cache_operator_release: 'operator',
  review_compile_cache_export: 'operator',
  open_compile_cache_replay_barrier: 'operator',
});

function compactString(value) {
  return String(value ?? '').trim();
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.floor(number));
}

function nowFrom(options = {}) {
  const value = Number(options.now ?? options.nowMs);
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : Date.now();
}

function stableList(value) {
  if (value == null) return [];
  const list = Array.isArray(value) ? value : String(value).split(',');
  return [...new Set(list.map(compactString).filter(Boolean))].sort();
}

function stableObjectList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === 'object')
    .map(cloneContract)
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function cloneContract(value) {
  if (Array.isArray(value)) return value.map(cloneContract);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((next, key) => {
    if (value[key] !== undefined) next[key] = cloneContract(value[key]);
    return next;
  }, {});
}

function stableHash(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(cloneContract(value));
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function normalizeBoundaryScope(source = {}) {
  const boundary = source.boundaryContract && typeof source.boundaryContract === 'object'
    ? source.boundaryContract
    : source.truthBoundary?.tenantBoundary && typeof source.truthBoundary.tenantBoundary === 'object'
      ? source.truthBoundary.tenantBoundary
      : source.boundaryScope && typeof source.boundaryScope === 'object'
        ? source.boundaryScope
        : {};
  const audit = boundary.audit && typeof boundary.audit === 'object' ? boundary.audit : {};
  return {
    protocol: 'aios.compile-cache-boundary-scope.mailchimp.v1',
    tenant: compactString(boundary.tenant || source.tenant),
    scope: compactString(boundary.scope || 'tenant') || 'tenant',
    workspace: compactString(boundary.workspace || source.workspace || source.workspaceId),
    allowedWorkspaces: stableList(boundary.allowedWorkspaces),
    roles: stableList(boundary.roles),
    roleGrants: normalizeBoundaryRoleGrants(boundary.roleGrants || boundary.rolePermissions),
    requiredGrants: stableList(boundary.requiredGrants),
    grants: stableList(boundary.grants),
    denied: stableList(boundary.denied),
    allowed: boundary.allowed !== false,
    blockedReasons: stableList(boundary.blockedReasons),
    audit: {
      channel: compactString(audit.channel || 'compile-cache'),
      handoffKey: compactString(audit.handoffKey),
      decision: compactString(audit.decision || (boundary.allowed === false ? 'block' : 'allow')),
      externalWriteSuppressed: audit.externalWriteSuppressed === true,
    },
  };
}

function boundaryMatches(entryBoundary = {}, requestedBoundary = {}) {
  const tenant = compactString(requestedBoundary.tenant);
  const workspace = compactString(requestedBoundary.workspace || requestedBoundary.workspaceId);
  const grants = stableList(requestedBoundary.grants || requestedBoundary.permissions);
  const tenantMatches = !tenant || !entryBoundary.tenant || tenant === entryBoundary.tenant;
  const requiredGrants = normalizeBoundaryGrantSet(entryBoundary);
  const missingGrants = grants.length === 0 ? [] : permissionSetCovers(requiredGrants, grants);
  const workspaceMatches = !workspace
    || !entryBoundary.workspace
    || workspace === entryBoundary.workspace
    || (Array.isArray(entryBoundary.allowedWorkspaces) && entryBoundary.allowedWorkspaces.includes(workspace));
  const grantsCover = requiredGrants.length === 0 || grants.length === 0 || missingGrants.length === 0;
  const blockedReasons = stableList([
    ...(tenantMatches ? [] : ['tenant_mismatch']),
    ...(workspaceMatches ? [] : ['workspace_mismatch']),
    ...(grantsCover ? [] : ['permission_scope_mismatch']),
    ...missingGrants.map((grant) => `permission_scope_missing:${grant}`),
    ...(entryBoundary.allowed === false ? ['cached_boundary_denied'] : []),
  ]);
  return { ok: blockedReasons.length === 0, blockedReasons };
}

function normalizeRuntimeBoundaryScope(runtime = {}) {
  const source = runtime.boundary && typeof runtime.boundary === 'object'
    ? runtime.boundary
    : runtime.tenantBoundary && typeof runtime.tenantBoundary === 'object'
      ? runtime.tenantBoundary
      : runtime.permissions && typeof runtime.permissions === 'object'
        ? runtime.permissions
        : {};
  const audit = source.audit && typeof source.audit === 'object' ? source.audit : {};
  return {
    tenant: compactString(source.tenant || source.tenantId || runtime.tenant),
    workspace: compactString(
      source.workspace
        || source.workspaceId
        || runtime.workspace
        || runtime.workspaceId
        || runtime.metadata?.workspace
        || runtime.metadata?.workspaceId,
    ),
    roles: stableList(source.roles || runtime.roles || runtime.role),
    grants: stableList(source.grants || source.permissions || runtime.permissionGrants || runtime.grants),
    denied: stableList(source.denied || source.denies || runtime.deniedPermissions || runtime.denies),
    allowedWorkspaces: stableList(source.allowedWorkspaces || source.workspaces || source.workspaceIds || runtime.workspaces),
    allowed: source.allowed !== false && runtime.allowed !== false,
    requireWorkspaceMatch: source.requireWorkspaceMatch === true || runtime.requireWorkspaceMatch === true,
    audit: {
      channel: compactString(audit.channel || source.auditChannel || runtime.auditChannel || 'compile-cache'),
      decision: compactString(audit.decision),
      handoffKey: compactString(audit.handoffKey),
    },
  };
}

function normalizeBoundaryGrantSet(boundary = {}) {
  return stableList([
    ...(Array.isArray(boundary.requiredGrants) ? boundary.requiredGrants : []),
    ...(Array.isArray(boundary.grants) ? boundary.grants : []),
  ]);
}

function normalizeBoundaryRoleGrants(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.keys(value).sort().reduce((next, role) => {
    const normalizedRole = compactString(role).toLowerCase();
    const grants = stableList(value[role]);
    if (normalizedRole && grants.length > 0) next[normalizedRole] = grants;
    return next;
  }, {});
}

function grantsForBoundaryRoles(roles = [], roleGrants = {}) {
  const normalizedRoles = stableList(roles).map((role) => role.toLowerCase());
  const normalizedRoleGrants = normalizeBoundaryRoleGrants(roleGrants);
  return stableList(normalizedRoles.flatMap((role) => [
    ...(MAILCHIMP_BOUNDARY_ROLE_GRANTS[role] || []),
    ...(normalizedRoleGrants[role] || []),
  ]));
}

function grantMatchesPermission(requiredGrant, availableGrant) {
  if (requiredGrant === availableGrant) return true;
  const required = compactString(requiredGrant);
  const available = compactString(availableGrant);
  if (!required || !available) return false;
  if (available === '*') return true;
  if (available.endsWith('.*')) return required.startsWith(available.slice(0, -1));
  if (required.endsWith('.read') && available.endsWith('.admin')) {
    return required.slice(0, required.indexOf('.')) === available.slice(0, available.indexOf('.'));
  }
  return false;
}

function permissionSetCovers(requiredGrants = [], availableGrants = []) {
  const available = stableList(availableGrants);
  return stableList(requiredGrants).filter((required) => (
    !available.some((grant) => grantMatchesPermission(required, grant))
  ));
}

function buildWorkspaceScopePolicy(cachedBoundary = {}, runtimeBoundary = {}) {
  const cachedScope = compactString(cachedBoundary.scope || 'tenant');
  const cachedWorkspace = compactString(cachedBoundary.workspace);
  const runtimeWorkspace = compactString(runtimeBoundary.workspace);
  const cachedAllowedWorkspaces = stableList(cachedBoundary.allowedWorkspaces);
  const runtimeAllowedWorkspaces = stableList(runtimeBoundary.allowedWorkspaces);
  const runtimeWorkspaceScoped = Boolean(
    runtimeWorkspace
      || runtimeAllowedWorkspaces.length > 0
      || runtimeBoundary.requireWorkspaceMatch === true,
  );
  const runtimeWorkspaceInAllowedSet = !runtimeWorkspace
    || runtimeAllowedWorkspaces.length === 0
    || runtimeAllowedWorkspaces.includes(runtimeWorkspace);
  const cacheWorkspaceInRuntimeSet = !cachedWorkspace
    || runtimeAllowedWorkspaces.length === 0
    || runtimeAllowedWorkspaces.includes(cachedWorkspace);
  const cachedAllowsRuntimeWorkspace = !runtimeWorkspace
    || !cachedWorkspace && cachedAllowedWorkspaces.length === 0
    || cachedWorkspace === runtimeWorkspace
    || cachedAllowedWorkspaces.includes(runtimeWorkspace);
  const workspaceRequired = cachedScope === 'workspace'
    || runtimeBoundary.requireWorkspaceMatch === true
    || cachedAllowedWorkspaces.length > 0;
  const blockedReasons = stableList([
    ...(workspaceRequired && !cachedWorkspace && cachedAllowedWorkspaces.length === 0 ? ['cached_workspace_scope_missing'] : []),
    ...(workspaceRequired && runtimeWorkspaceScoped && !runtimeWorkspace ? ['runtime_workspace_missing'] : []),
    ...(runtimeWorkspaceInAllowedSet ? [] : ['runtime_workspace_out_of_scope']),
    ...(cacheWorkspaceInRuntimeSet ? [] : ['cached_workspace_out_of_runtime_scope']),
    ...(cachedAllowsRuntimeWorkspace ? [] : ['workspace_scope_not_permitted']),
  ]);

  return {
    protocol: 'aios.compile-cache-workspace-scope-policy.mailchimp.v1',
    scope: cachedScope,
    workspaceRequired,
    cachedWorkspace,
    runtimeWorkspace,
    cachedAllowedWorkspaces,
    runtimeAllowedWorkspaces,
    runtimeWorkspaceScoped,
    runtimeWorkspaceInAllowedSet,
    cacheWorkspaceInRuntimeSet,
    cachedAllowsRuntimeWorkspace,
    blockedReasons,
  };
}

function evaluateBoundaryPermissions(cachedBoundary = {}, runtimeBoundary = {}) {
  const roleDerivedGrants = grantsForBoundaryRoles(runtimeBoundary.roles, cachedBoundary.roleGrants);
  const cachedRoleGrants = grantsForBoundaryRoles(cachedBoundary.roles, cachedBoundary.roleGrants);
  const runtimeExplicitGrants = stableList(runtimeBoundary.grants);
  const effectiveRuntimeGrants = stableList([
    ...runtimeExplicitGrants,
    ...roleDerivedGrants,
  ]);
  const runtimePermissionScoped = runtimeExplicitGrants.length > 0
    || roleDerivedGrants.length > 0
    || stableList(runtimeBoundary.roles).length > 0
    || stableList(runtimeBoundary.denied).length > 0
    || runtimeBoundary.allowed === false;
  const cachedRequiredGrants = normalizeBoundaryGrantSet(cachedBoundary);
  const effectiveRequiredGrants = stableList([
    ...cachedRequiredGrants,
    ...permissionSetCovers(cachedRequiredGrants, cachedRoleGrants),
  ]);
  const missingGrants = runtimePermissionScoped
    ? permissionSetCovers(effectiveRequiredGrants, effectiveRuntimeGrants)
    : [];
  const deniedRuntimeGrants = effectiveRequiredGrants.filter((grant) => (
    stableList(runtimeBoundary.denied).some((denied) => grantMatchesPermission(grant, denied))
  ));
  const deniedCachedGrants = effectiveRequiredGrants.filter((grant) => (
    stableList(cachedBoundary.denied).some((denied) => grantMatchesPermission(grant, denied))
  ));
  const workspacePolicy = buildWorkspaceScopePolicy(cachedBoundary, runtimeBoundary);
  const blockedReasons = stableList([
    ...missingGrants.map((grant) => `runtime_missing_grant:${grant}`),
    ...deniedRuntimeGrants.map((grant) => `runtime_denied_grant:${grant}`),
    ...deniedCachedGrants.map((grant) => `cached_denied_grant:${grant}`),
    ...workspacePolicy.blockedReasons,
  ]);

  return {
    protocol: 'aios.compile-cache-boundary-permission-evaluation.mailchimp.v1',
    ready: blockedReasons.length === 0,
    runtimePermissionScoped,
    requiredGrants: effectiveRequiredGrants,
    runtimeExplicitGrants,
    runtimeRoleDerivedGrants: roleDerivedGrants,
    runtimeEffectiveGrants: effectiveRuntimeGrants,
    cachedRoleDerivedGrants: cachedRoleGrants,
    missingGrants,
    deniedRuntimeGrants,
    deniedCachedGrants,
    workspacePolicy,
    blockedReasons,
  };
}

function classifyBoundaryAuditReason(reason) {
  const normalized = compactString(reason);
  if (!normalized) return {
    owner: 'runtime',
    action: 'reuse_boundary_scope',
    severity: 'info',
    category: 'clear',
  };
  if (normalized.includes('tenant') || normalized.includes('workspace')) {
    return {
      owner: normalized.includes('drift') ? 'runtime' : 'operator',
      action: normalized.includes('drift') ? 'switch_workspace_or_recompile' : 'repair_tenant_permissions',
      severity: 'error',
      category: 'isolation',
    };
  }
  if (normalized.includes('denied') || normalized.includes('missing_grant') || normalized.includes('permission')) {
    return {
      owner: 'operator',
      action: 'repair_tenant_permissions',
      severity: normalized.includes('denied') ? 'error' : 'warning',
      category: 'permission',
    };
  }
  if (normalized.includes('audit')) {
    return {
      owner: 'operator',
      action: 'append_compile_cache_boundary_audit',
      severity: 'warning',
      category: 'audit',
    };
  }
  return {
    owner: 'runtime',
    action: 'review_compile_cache_boundary',
    severity: 'warning',
    category: 'boundary',
  };
}

function buildBoundaryAuditDecisionRows({
  cachedBoundary,
  runtimeBoundary,
  permissionEvaluation,
  blockedReasons,
  state,
}) {
  const explicitRows = stableList(blockedReasons).map((reason, index) => {
    const classification = classifyBoundaryAuditReason(reason);
    return {
      rowId: `boundary:${index + 1}:${reason}`.replace(/[^a-zA-Z0-9_.:-]/g, '_'),
      reason,
      category: classification.category,
      owner: classification.owner,
      action: classification.action,
      severity: classification.severity,
      blocksReplay: true,
      restartSafe: !['isolation', 'permission'].includes(classification.category),
    };
  });
  const workspacePolicy = permissionEvaluation.workspacePolicy || {};
  const informationalRows = [
    {
      rowId: 'boundary:tenant',
      reason: cachedBoundary.tenant || runtimeBoundary.tenant ? 'tenant_scope_declared' : 'tenant_scope_missing',
      category: 'isolation',
      owner: cachedBoundary.tenant || runtimeBoundary.tenant ? 'runtime' : 'operator',
      action: cachedBoundary.tenant || runtimeBoundary.tenant ? 'reuse_boundary_scope' : 'repair_tenant_permissions',
      severity: cachedBoundary.tenant || runtimeBoundary.tenant ? 'info' : 'error',
      blocksReplay: !(cachedBoundary.tenant || runtimeBoundary.tenant),
      restartSafe: Boolean(cachedBoundary.tenant || runtimeBoundary.tenant),
    },
    {
      rowId: 'boundary:workspace-policy',
      reason: workspacePolicy.workspaceRequired ? 'workspace_scope_required' : 'workspace_scope_optional',
      category: 'isolation',
      owner: workspacePolicy.blockedReasons?.length > 0 ? 'operator' : 'runtime',
      action: workspacePolicy.blockedReasons?.length > 0 ? 'switch_workspace_or_recompile' : 'reuse_boundary_scope',
      severity: workspacePolicy.blockedReasons?.length > 0 ? 'error' : 'info',
      blocksReplay: workspacePolicy.blockedReasons?.length > 0,
      restartSafe: workspacePolicy.blockedReasons?.length === 0,
    },
    {
      rowId: 'boundary:permission-scope',
      reason: permissionEvaluation.runtimePermissionScoped ? 'runtime_permissions_scoped' : 'runtime_permissions_unscoped',
      category: 'permission',
      owner: permissionEvaluation.missingGrants?.length > 0 || permissionEvaluation.deniedRuntimeGrants?.length > 0 ? 'operator' : 'runtime',
      action: permissionEvaluation.ready ? 'reuse_boundary_scope' : 'repair_tenant_permissions',
      severity: permissionEvaluation.ready ? 'info' : 'error',
      blocksReplay: permissionEvaluation.ready !== true,
      restartSafe: permissionEvaluation.ready === true,
    },
  ];
  const rows = explicitRows.length > 0 ? explicitRows : informationalRows;
  const blocked = rows.filter((row) => row.blocksReplay === true || row.severity === 'error');
  const nextRow = blocked[0] || rows.find((row) => row.severity === 'warning') || rows[0] || null;

  return {
    rows,
    nextRow,
    counters: {
      rows: rows.length,
      blocked: blocked.length,
      warnings: rows.filter((row) => row.severity === 'warning').length,
      permissionRows: rows.filter((row) => row.category === 'permission').length,
      isolationRows: rows.filter((row) => row.category === 'isolation').length,
      restartUnsafe: rows.filter((row) => row.restartSafe === false).length,
    },
    state: blocked.length === 0 && state === 'boundary_ready' ? 'audit_ready' : 'audit_blocked',
  };
}

function buildBoundaryAuditHandoff({
  cachedBoundary,
  runtimeBoundary,
  permissionEvaluation,
  blockedReasons,
  state,
  nextAction,
}) {
  const rows = buildBoundaryAuditDecisionRows({
    cachedBoundary,
    runtimeBoundary,
    permissionEvaluation,
    blockedReasons,
    state,
  });
  const tenant = compactString(cachedBoundary.tenant || runtimeBoundary.tenant);
  const workspace = compactString(cachedBoundary.workspace || runtimeBoundary.workspace);
  const audit = cachedBoundary.audit || {};
  const handoffKey = compactString(
    runtimeBoundary.audit?.handoffKey
      || audit.handoffKey
      || stableList([
        tenant || 'unknown',
        workspace || 'all',
        cachedBoundary.scope || 'tenant',
        state,
      ]).join(':'),
  );
  const ready = state === 'boundary_ready'
    && blockedReasons.length === 0
    && rows.counters.blocked === 0;
  const auditRequired = state !== 'boundary_ready'
    || rows.counters.permissionRows > 0
    || rows.counters.isolationRows > 0
    || audit.externalWriteSuppressed === true;
  const primaryAction = ready
    ? auditRequired ? 'append_compile_cache_boundary_audit' : 'reuse_boundary_scope'
    : rows.nextRow?.action || nextAction || 'repair_tenant_permissions';

  return {
    protocol: 'aios.compile-cache-boundary-audit-handoff.mailchimp.v1',
    handoffKey,
    tenant,
    workspace,
    scope: compactString(cachedBoundary.scope || 'tenant'),
    state: rows.state,
    ready,
    auditRequired,
    auditAppendReady: ready && Boolean(handoffKey),
    replayAllowed: ready,
    restartSafe: ready,
    primaryAction,
    nextAction: primaryAction,
    owner: rows.nextRow?.owner || (ready ? 'runtime' : 'operator'),
    decision: ready ? 'allow' : 'block',
    blockedReasons: stableList(blockedReasons),
    rows: rows.rows,
    counters: rows.counters,
    route: {
      target: 'compile-cache-boundary-audit',
      idempotencyKey: `mailchimp-cache-boundary:${stableHash({
        handoffKey,
        tenant,
        workspace,
        state,
        blockedReasons,
      })}`,
      primaryAction,
      requiredBodyKeys: auditRequired ? ['handoffKey', 'decision', 'rows'] : ['handoffKey'],
    },
    clientPatch: {
      compileCacheBoundaryAuditState: rows.state,
      compileCacheBoundaryAuditReady: ready,
      compileCacheBoundaryAuditHandoffKey: handoffKey,
      compileCacheBoundaryAuditNextAction: primaryAction,
      compileCacheBoundaryAuditBlockedReasons: stableList(blockedReasons),
    },
    restartSemantics: {
      replaySafe: ready,
      duplicateCommandPolicy: 'dedupe-by-compile-cache-boundary-audit-handoff',
      resumeFromBoundaryAuditKey: handoffKey,
      externalWritesPerformed: false,
    },
  };
}

export function buildMailchimpCompileCacheBoundaryCheckpoint(source = {}, runtime = {}) {
  const descriptor = source.descriptor && typeof source.descriptor === 'object'
    ? source.descriptor
    : source.compileCache?.descriptor && typeof source.compileCache.descriptor === 'object'
      ? source.compileCache.descriptor
      : source;
  const cachedBoundary = source.boundaryScope && source.boundaryScope.protocol === 'aios.compile-cache-boundary-scope.mailchimp.v1'
    ? source.boundaryScope
    : source.compileCache?.boundaryScope && source.compileCache.boundaryScope.protocol === 'aios.compile-cache-boundary-scope.mailchimp.v1'
      ? source.compileCache.boundaryScope
      : normalizeBoundaryScope(descriptor);
  const runtimeBoundary = normalizeRuntimeBoundaryScope(runtime);
  const requestedBoundary = {
    tenant: runtimeBoundary.tenant,
    workspace: runtimeBoundary.workspace,
    grants: runtimeBoundary.grants,
    permissions: runtimeBoundary.grants,
  };
  const permissionEvaluation = evaluateBoundaryPermissions(cachedBoundary, runtimeBoundary);
  const boundaryMatch = boundaryMatches(cachedBoundary, requestedBoundary);
  const tenantDrift = Boolean(cachedBoundary.tenant && runtimeBoundary.tenant && cachedBoundary.tenant !== runtimeBoundary.tenant);
  const workspaceDrift = Boolean(
    cachedBoundary.workspace
      && runtimeBoundary.workspace
      && cachedBoundary.workspace !== runtimeBoundary.workspace
      && !cachedBoundary.allowedWorkspaces?.includes(runtimeBoundary.workspace),
  );
  const blockedReasons = stableList([
    ...(cachedBoundary.allowed === false ? ['cached_boundary_denied'] : []),
    ...(runtimeBoundary.allowed === false ? ['runtime_boundary_denied'] : []),
    ...boundaryMatch.blockedReasons,
    ...(tenantDrift ? ['runtime_tenant_drift'] : []),
    ...(workspaceDrift ? ['runtime_workspace_drift'] : []),
    ...permissionEvaluation.blockedReasons,
  ]);
  const state = blockedReasons.length === 0
    ? 'boundary_ready'
    : tenantDrift || workspaceDrift
      ? 'runtime_boundary_drift'
      : 'boundary_blocked';
  const nextAction = blockedReasons.length === 0
    ? 'reuse_boundary_scope'
    : tenantDrift || workspaceDrift
      ? 'switch_workspace_or_recompile'
      : 'repair_tenant_permissions';
  const auditHandoff = buildBoundaryAuditHandoff({
    cachedBoundary,
    runtimeBoundary,
    permissionEvaluation,
    blockedReasons,
    state,
    nextAction,
  });

  return {
    protocol: 'aios.compile-cache-boundary-checkpoint.mailchimp.v1',
    state,
    ready: blockedReasons.length === 0,
    restartSafe: blockedReasons.length === 0,
    replayAllowed: blockedReasons.length === 0,
    nextAction,
    tenant: compactString(cachedBoundary.tenant),
    workspace: compactString(cachedBoundary.workspace),
    runtimeTenant: runtimeBoundary.tenant,
    runtimeWorkspace: runtimeBoundary.workspace,
    scope: compactString(cachedBoundary.scope || 'tenant'),
    roles: stableList(cachedBoundary.roles),
    runtimeRoles: runtimeBoundary.roles,
    requiredGrants: permissionEvaluation.requiredGrants,
    runtimeGrants: runtimeBoundary.grants,
    runtimeEffectiveGrants: permissionEvaluation.runtimeEffectiveGrants,
    runtimeRoleDerivedGrants: permissionEvaluation.runtimeRoleDerivedGrants,
    denied: stableList([
      ...(Array.isArray(cachedBoundary.denied) ? cachedBoundary.denied : []),
      ...runtimeBoundary.denied,
    ]),
    allowedWorkspaces: stableList([
      ...(Array.isArray(cachedBoundary.allowedWorkspaces) ? cachedBoundary.allowedWorkspaces : []),
      ...runtimeBoundary.allowedWorkspaces,
    ]),
    permissionEvaluation,
    workspacePolicy: permissionEvaluation.workspacePolicy,
    blockedReasons,
    auditHandoff,
    exportRow: {
      artifactName: 'compile-cache-boundary-audit.json',
      rowId: `${auditHandoff.handoffKey}:${state}`.replace(/[^a-zA-Z0-9_.:-]/g, '_'),
      status: state,
      nextAction: auditHandoff.nextAction,
      readyForExport: true,
      blockedReasons,
    },
    clientPatch: {
      compileCacheBoundaryCheckpointState: state,
      compileCacheBoundaryCheckpointReady: blockedReasons.length === 0,
      compileCacheBoundaryCheckpointNextAction: nextAction,
      compileCacheBoundaryAuditHandoffKey: auditHandoff.handoffKey,
      compileCacheBoundaryAuditReady: auditHandoff.ready,
    },
    audit: {
      channel: compactString(runtimeBoundary.audit.channel || cachedBoundary.audit?.channel || 'compile-cache'),
      decision: blockedReasons.length === 0 ? 'allow' : 'block',
      handoffKey: runtimeBoundary.audit.handoffKey
        || cachedBoundary.audit?.handoffKey
        || stableList([
          cachedBoundary.tenant || runtimeBoundary.tenant || 'unknown',
          cachedBoundary.workspace || runtimeBoundary.workspace || 'all',
          cachedBoundary.scope || 'tenant',
        ]).join(':'),
      externalWriteSuppressed: blockedReasons.length > 0,
      cachedDecision: compactString(cachedBoundary.audit?.decision),
      runtimeDecision: runtimeBoundary.audit.decision,
    },
  };
}

function normalizeProviderServiceContractSource(source = {}) {
  const providerContract = source.providerContract && typeof source.providerContract === 'object'
    ? source.providerContract
    : {};
  const serviceContract = providerContract.serviceContract && typeof providerContract.serviceContract === 'object'
    ? providerContract.serviceContract
    : source.serviceContract && typeof source.serviceContract === 'object'
      ? source.serviceContract
      : {};
  const capabilityNegotiation = providerContract.capabilityNegotiation && typeof providerContract.capabilityNegotiation === 'object'
    ? providerContract.capabilityNegotiation
    : source.capabilityNegotiation && typeof source.capabilityNegotiation === 'object'
      ? source.capabilityNegotiation
      : {};
  const sync = providerContract.sync && typeof providerContract.sync === 'object'
    ? providerContract.sync
    : source.sync && typeof source.sync === 'object'
      ? source.sync
      : {};
  const externalHandoff = providerContract.externalHandoff && typeof providerContract.externalHandoff === 'object'
    ? providerContract.externalHandoff
    : source.externalHandoff && typeof source.externalHandoff === 'object'
      ? source.externalHandoff
      : {};
  const receipt = providerContract.receipt && typeof providerContract.receipt === 'object'
    ? providerContract.receipt
    : providerContract.providerReceipt && typeof providerContract.providerReceipt === 'object'
      ? providerContract.providerReceipt
      : source.providerReceipt && typeof source.providerReceipt === 'object'
        ? source.providerReceipt
        : source.receipt && typeof source.receipt === 'object'
          ? source.receipt
          : {};
  return {
    providerContract,
    serviceContract,
    capabilityNegotiation,
    sync,
    externalHandoff,
    receipt,
  };
}

function normalizeProviderReceiptContract(source = {}, receipt = {}, externalHandoff = {}) {
  const state = compactString(
    receipt.state
      || receipt.status
      || (receipt.receiptId || receipt.acknowledgedAt ? 'acknowledged' : 'missing'),
  ).toLowerCase().replaceAll('-', '_') || 'missing';
  const receiptId = compactString(receipt.receiptId || receipt.id || receipt.ackId || receipt.acknowledgementId);
  const externalRequestId = compactString(
    receipt.externalRequestId
      || receipt.providerRequestId
      || externalHandoff.requestId
      || source.externalRequestId
      || source.providerRequestId,
  );
  const required = receipt.required === true || source.receiptRequired === true;
  const acknowledged = (state === 'acknowledged' || receipt.acknowledged === true)
    && Boolean(receiptId || receipt.acknowledgedAt || receipt.ackAt);
  const failed = state === 'failed' || state === 'rejected';
  const blockedReasons = stableList([
    ...(Array.isArray(receipt.blockedReasons) ? receipt.blockedReasons : []),
    ...(failed ? [`provider_receipt_${state}`] : []),
    ...(required && !acknowledged ? ['provider_receipt_ack_missing'] : []),
    ...(externalRequestId && receipt.externalRequestId && externalHandoff.requestId
      && receipt.externalRequestId !== externalHandoff.requestId
      ? ['provider_receipt_external_request_mismatch']
      : []),
  ]);

  return {
    protocol: 'aios.compile-cache-provider-receipt.mailchimp.v1',
    state,
    receiptId,
    externalRequestId,
    idempotencyKey: compactString(receipt.idempotencyKey || receipt.idempotency || source.idempotencyKey),
    acknowledged,
    acknowledgedAt: compactString(receipt.acknowledgedAt || receipt.ackAt || receipt.receivedAt),
    required,
    restartSafe: acknowledged || (!required && !failed),
    syncCursor: compactString(receipt.syncCursor || receipt.cursor || source.syncCursor || source.cursor),
    artifactIds: stableList(receipt.artifactIds || receipt.artifacts),
    blockedReasons,
    audit: {
      channel: compactString(receipt.audit?.channel || receipt.auditChannel || 'compile-cache-provider-receipt'),
      decision: blockedReasons.length === 0 ? 'allow' : 'block',
      handoffKey: compactString(receipt.audit?.handoffKey || `${externalRequestId || 'local'}:${receiptId || 'missing'}`),
      externalWriteSuppressed: blockedReasons.length > 0,
    },
  };
}

function inferMailchimpResourceKind(value) {
  const text = compactString(value).toLowerCase().replaceAll('-', '_');
  if (!text) return '';
  if (text.includes('campaign')) return 'campaign';
  if (text.includes('member') || text.includes('subscriber') || text.includes('contact')) return 'member';
  if (text.includes('segment') || text.includes('tag')) return 'segment';
  if (text.includes('template')) return 'template';
  if (text.includes('report') || text.includes('analytics')) return 'report';
  if (text.includes('automation') || text.includes('journey')) return 'automation';
  if (text.includes('list') || text.includes('audience')) return 'audience';
  return text.split(/[.:_/]/).find((part) => MAILCHIMP_RESOURCE_CAPABILITIES[part]) || text;
}

function inferMailchimpResourceKinds(source = {}, serviceContract = {}, sync = {}) {
  const candidates = stableList([
    source.resource,
    source.syncResource,
    sync.resource,
    serviceContract.resource,
    serviceContract.primaryResource,
    serviceContract.entity,
    serviceContract.object,
    ...(Array.isArray(serviceContract.resources) ? serviceContract.resources : []),
    ...(Array.isArray(source.resources) ? source.resources : []),
    ...(Array.isArray(source.actions) ? source.actions : []),
    ...(Array.isArray(source.allowedActions) ? source.allowedActions : []),
    source.action,
    source.operation,
    source.route,
  ]);
  const inferred = stableList(candidates.map(inferMailchimpResourceKind).filter(Boolean));
  return inferred.length > 0 ? inferred : ['audience'];
}

function deriveMailchimpRequiredCapabilities(resourceKinds, source = {}, serviceContract = {}) {
  const declared = stableList([
    serviceContract.requiredCapability,
    ...(Array.isArray(serviceContract.requiredCapabilities) ? serviceContract.requiredCapabilities : []),
    ...(Array.isArray(source.requiredCapabilities) ? source.requiredCapabilities : []),
  ]);
  const fromResources = resourceKinds.flatMap((resource) => MAILCHIMP_RESOURCE_CAPABILITIES[resource] || [`${resource}.read`]);
  const writeRequested = serviceContract.write === true
    || source.write === true
    || stableList([source.action, source.operation, ...(Array.isArray(source.actions) ? source.actions : [])])
      .some((action) => /create|draft|send|update|write|delete|sync/.test(action));
  const withoutWrites = fromResources.filter((capability) => writeRequested || !capability.endsWith('.write'));
  return stableList([...declared, ...withoutWrites]);
}

function normalizeAvailableCapabilities(source = {}, capabilityNegotiation = {}) {
  const raw = stableList([
    ...(Array.isArray(capabilityNegotiation.available) ? capabilityNegotiation.available : []),
    ...(Array.isArray(capabilityNegotiation.availableCapabilities) ? capabilityNegotiation.availableCapabilities : []),
    ...(Array.isArray(capabilityNegotiation.granted) ? capabilityNegotiation.granted : []),
    ...(Array.isArray(capabilityNegotiation.grantedCapabilities) ? capabilityNegotiation.grantedCapabilities : []),
    ...(Array.isArray(source.capabilities) ? source.capabilities : []),
    ...(Array.isArray(source.availableCapabilities) ? source.availableCapabilities : []),
  ]);
  return raw.length > 0
    ? raw
    : stableList(Object.values(MAILCHIMP_RESOURCE_CAPABILITIES).flat());
}

function normalizeProviderServiceState(value) {
  const state = compactString(value).toLowerCase().replaceAll('-', '_');
  return ['online', 'degraded', 'offline', 'unknown'].includes(state) ? state : 'unknown';
}

function buildProviderServiceContinuity({
  provider,
  service,
  serviceState,
  externalState,
  externalRequestId,
  requiredCapabilities,
  missingCapabilities,
  syncCursor,
  receipt,
  blockedReasons,
}) {
  const receiptRequired = receipt.required === true
    || (externalState !== 'local_only' && requiredCapabilities.includes('external.write'));
  const receiptAcknowledged = receipt.acknowledged === true;
  const degradedReasons = stableList([
    ...(serviceState === 'offline' ? ['provider_service_offline'] : []),
    ...(serviceState === 'degraded' ? ['provider_service_degraded'] : []),
    ...(missingCapabilities.length > 0 ? ['provider_capabilities_missing'] : []),
    ...(externalState !== 'local_only' && !externalRequestId ? ['external_handoff_unlinked'] : []),
    ...(externalState !== 'local_only' && !syncCursor ? ['provider_sync_cursor_missing'] : []),
    ...(receiptRequired && !receiptAcknowledged ? ['provider_receipt_ack_missing'] : []),
    ...blockedReasons,
  ]);
  const externalWriteRequired = requiredCapabilities.includes('external.write')
    || receiptRequired
    || externalState !== 'local_only';
  const holdExternalWrite = serviceState === 'offline' && externalWriteRequired;
  const queueOnly = serviceState === 'degraded' && externalWriteRequired;
  const retryable = degradedReasons.length > 0
    && !holdExternalWrite
    && missingCapabilities.length === 0;
  const mode = degradedReasons.length === 0
    ? 'healthy'
    : holdExternalWrite
      ? 'hold_external_write'
      : queueOnly
        ? 'queue_without_dispatch'
        : retryable
          ? 'retry_after_provider_refresh'
          : 'blocked';
  const nextAction = mode === 'healthy'
    ? 'reuse_provider_contract'
    : holdExternalWrite
      ? 'hold_for_provider_recovery'
      : missingCapabilities.length > 0
        ? 'renegotiate_mailchimp_provider_capabilities'
        : externalState !== 'local_only' && !externalRequestId
          ? 'relink_external_handoff'
          : receiptRequired && !receiptAcknowledged
            ? 'refresh_provider_receipt'
            : 'refresh_provider_contract';
  const continuityKey = `mailchimp-cache-provider-continuity:${stableHash({
    provider,
    service,
    serviceState,
    externalState,
    externalRequestId,
    degradedReasons,
  })}`;

  return {
    protocol: 'aios.compile-cache-provider-continuity.mailchimp.v1',
    continuityKey,
    provider,
    service,
    serviceState,
    mode,
    healthy: mode === 'healthy',
    degraded: mode !== 'healthy',
    holdExternalWrite,
    queueOnly,
    retry: {
      retryable,
      retryAfterMs: retryable ? serviceState === 'degraded' ? 45000 : 30000 : 0,
      maxAttempts: retryable ? 4 : 0,
      backoffPolicy: retryable ? 'provider-continuity-exponential' : 'none',
    },
    nextAction,
    degradedReasons,
    clientPatch: {
      compileCacheProviderContinuityMode: mode,
      compileCacheProviderContinuityKey: continuityKey,
      compileCacheProviderContinuityNextAction: nextAction,
      compileCacheProviderContinuityRetryAfterMs: retryable ? serviceState === 'degraded' ? 45000 : 30000 : 0,
    },
    restartSemantics: {
      replaySafe: !holdExternalWrite,
      duplicateCommandPolicy: 'dedupe-by-compile-cache-provider-continuity-key',
      resumeFromContinuityKey: continuityKey,
      externalWritesPerformed: false,
    },
  };
}

function mergeProviderServiceContract(compiled, observed) {
  const requiredCapabilities = stableList([
    ...compiled.requiredCapabilities,
    ...observed.requiredCapabilities,
  ]);
  const availableCapabilities = stableList([
    ...compiled.availableCapabilities,
    ...observed.availableCapabilities,
  ]);
  const missingCapabilities = requiredCapabilities.filter((capability) => !availableCapabilities.includes(capability));
  const resourceKinds = stableList([...compiled.resourceKinds, ...observed.resourceKinds]);
  const externalState = observed.externalHandoff.state !== 'local_only'
    ? observed.externalHandoff.state
    : compiled.externalHandoff.state;
  const externalRequestId = observed.externalHandoff.requestId || compiled.externalHandoff.requestId;
  const receipt = observed.receipt.acknowledged || observed.receipt.required || observed.receipt.receiptId
    ? observed.receipt
    : compiled.receipt;
  const receiptRequired = receipt.required === true
    || (externalState !== 'local_only' && requiredCapabilities.includes('external.write'));
  const receiptBlockedReasons = stableList([
    ...(Array.isArray(receipt.blockedReasons) ? receipt.blockedReasons : []),
    ...(receiptRequired && receipt.acknowledged !== true ? ['provider_receipt_ack_missing'] : []),
  ]);
  const syncCursor = observed.sync.cursor || compiled.sync.cursor;
  const provider = observed.provider || compiled.provider;
  const service = observed.service || compiled.service;
  const serviceState = normalizeProviderServiceState(
    observed.serviceState && observed.serviceState !== 'unknown' ? observed.serviceState : compiled.serviceState,
  );
  const blockedReasons = stableList([
    ...(missingCapabilities.length > 0 ? ['provider_capabilities_missing'] : []),
    ...(compiled.capabilitySatisfied === false || observed.capabilitySatisfied === false ? ['provider_capability_negotiation_failed'] : []),
    ...(externalState !== 'local_only' && !externalRequestId ? ['external_handoff_unlinked'] : []),
    ...receiptBlockedReasons,
    ...compiled.blockedReasons,
    ...observed.blockedReasons,
  ]);
  const negotiationState = blockedReasons.length === 0
    ? 'satisfied'
    : missingCapabilities.length > 0
      ? 'missing_capabilities'
      : externalState !== 'local_only' && !externalRequestId
        ? 'external_handoff_unlinked'
        : 'blocked';
  const serviceContinuity = buildProviderServiceContinuity({
    provider,
    service,
    serviceState,
    externalState,
    externalRequestId,
    requiredCapabilities,
    missingCapabilities,
    syncCursor,
    receipt,
    blockedReasons,
  });

  return {
    protocol: 'aios.compile-cache-provider-service-contract.mailchimp.v1',
    provider,
    service,
    serviceState,
    resourceKinds,
    primaryResource: resourceKinds[0] || 'audience',
    requiredCapabilities,
    availableCapabilities,
    grantedCapabilities: requiredCapabilities.filter((capability) => availableCapabilities.includes(capability)),
    missingCapabilities,
    negotiation: {
      state: negotiationState,
      satisfied: blockedReasons.length === 0 && serviceContinuity.holdExternalWrite !== true,
      restartSafe: (blockedReasons.length === 0 || blockedReasons.every((reason) => reason === 'provider_capabilities_missing'))
        && serviceContinuity.restartSemantics.replaySafe === true,
      blockedReasons: stableList([
        ...blockedReasons,
        ...serviceContinuity.degradedReasons,
      ]),
      nextAction: blockedReasons.length === 0
        ? serviceContinuity.nextAction
        : missingCapabilities.length > 0
          ? 'renegotiate_mailchimp_provider_capabilities'
          : externalState !== 'local_only' && !externalRequestId
            ? 'relink_external_handoff'
            : 'refresh_provider_contract',
    },
    syncMetadata: {
      resource: observed.sync.resource || compiled.sync.resource || resourceKinds[0] || 'audience',
      cursor: syncCursor,
      cursorPartition: stableList([
        provider,
        service,
        resourceKinds[0] || 'audience',
        observed.sync.batchId || compiled.sync.batchId,
      ]).join(':'),
      lastSyncedAt: observed.sync.lastSyncedAt || compiled.sync.lastSyncedAt,
      batchId: observed.sync.batchId || compiled.sync.batchId,
      restartSafe: Boolean(syncCursor) || externalState === 'local_only',
    },
    externalHandoff: {
      state: externalState,
      requestId: externalRequestId,
      handoffKey: observed.externalHandoff.handoffKey || compiled.externalHandoff.handoffKey,
      linked: externalState !== 'local_only' && Boolean(externalRequestId),
      receiptRequired,
      receiptAcknowledged: receipt.acknowledged === true,
      receipt: {
        ...receipt,
        required: receiptRequired,
        restartSafe: receipt.restartSafe !== false && receiptBlockedReasons.length === 0,
        blockedReasons: receiptBlockedReasons,
      },
      routeState: blockedReasons.length === 0 ? 'ready' : 'needs_attention',
    },
    serviceContinuity,
    serviceObjects: stableObjectList([
      ...compiled.serviceObjects,
      ...observed.serviceObjects,
    ]),
  };
}

function normalizeMailchimpProviderServiceContract(source = {}) {
  const {
    providerContract,
    serviceContract,
    capabilityNegotiation,
    sync,
    externalHandoff,
    receipt,
  } = normalizeProviderServiceContractSource(source);
  const resourceKinds = inferMailchimpResourceKinds(source, serviceContract, sync);
  const requiredCapabilities = deriveMailchimpRequiredCapabilities(resourceKinds, source, serviceContract);
  const availableCapabilities = normalizeAvailableCapabilities(source, capabilityNegotiation);
  return {
    provider: compactString(providerContract.provider || source.provider || 'mailchimp') || 'mailchimp',
    service: compactString(providerContract.service || source.service || 'mailchimp-marketing') || 'mailchimp-marketing',
    serviceState: normalizeProviderServiceState(providerContract.serviceState || source.serviceState || source.status),
    resourceKinds,
    requiredCapabilities,
    availableCapabilities,
    capabilitySatisfied: capabilityNegotiation.satisfied !== false,
    blockedReasons: stableList(capabilityNegotiation.blockedReasons),
    sync: {
      resource: compactString(sync.resource || source.syncResource || source.resource || resourceKinds[0] || 'audience'),
      cursor: compactString(sync.cursor || source.syncCursor || source.cursor),
      lastSyncedAt: compactString(sync.lastSyncedAt || source.lastSyncedAt || source.syncedAt),
      batchId: compactString(sync.batchId || source.syncBatchId),
    },
    externalHandoff: {
      state: compactString(externalHandoff.state || source.externalHandoffState || (externalHandoff.requestId ? 'linked' : 'local_only'))
        .toLowerCase()
        .replaceAll('-', '_') || 'local_only',
      requestId: compactString(externalHandoff.requestId || source.externalRequestId || source.providerRequestId),
      handoffKey: compactString(externalHandoff.handoffKey || source.externalHandoffKey),
    },
    receipt: normalizeProviderReceiptContract(source, receipt, externalHandoff),
    serviceObjects: stableObjectList(serviceContract.objects || source.serviceObjects),
  };
}

export function buildMailchimpCompileCacheProviderServiceContract(source = {}, runtime = {}) {
  const compiled = normalizeMailchimpProviderServiceContract(source);
  const observed = normalizeMailchimpProviderServiceContract({
    providerContract: runtime.providerContract || source.providerContract,
    serviceContract: runtime.serviceContract || source.serviceContract,
    capabilityNegotiation: runtime.capabilityNegotiation || source.capabilityNegotiation,
    sync: runtime.sync,
    provider: runtime.provider,
    service: runtime.service,
    serviceState: runtime.serviceState || runtime.providerState || runtime.status,
    resource: runtime.resource,
    resources: runtime.resources,
    syncResource: runtime.syncResource,
    syncCursor: runtime.syncCursor,
    cursor: runtime.cursor,
    lastSyncedAt: runtime.lastSyncedAt,
    syncedAt: runtime.syncedAt,
    syncBatchId: runtime.syncBatchId,
    externalHandoff: runtime.externalHandoff || source.externalHandoff,
    externalHandoffState: runtime.externalHandoffState,
    externalRequestId: runtime.externalRequestId,
    providerRequestId: runtime.providerRequestId,
    externalHandoffKey: runtime.externalHandoffKey,
    providerReceipt: runtime.providerReceipt || runtime.receipt || source.providerReceipt,
    receiptRequired: runtime.receiptRequired,
    capabilities: runtime.capabilities,
    availableCapabilities: runtime.availableCapabilities,
    requiredCapabilities: runtime.requiredCapabilities,
    action: runtime.action,
    actions: runtime.actions,
    operation: runtime.operation,
    write: runtime.write,
  });
  return mergeProviderServiceContract(compiled, observed);
}

function normalizeProviderSyncSource(source = {}) {
  const providerContract = source.providerContract && typeof source.providerContract === 'object'
    ? source.providerContract
    : {};
  const externalHandoff = source.externalHandoff && typeof source.externalHandoff === 'object'
    ? source.externalHandoff
    : providerContract.externalHandoff && typeof providerContract.externalHandoff === 'object'
      ? providerContract.externalHandoff
      : {};
  const sync = source.sync && typeof source.sync === 'object'
    ? source.sync
    : providerContract.sync && typeof providerContract.sync === 'object'
      ? providerContract.sync
      : {};
  const capabilityNegotiation = providerContract.capabilityNegotiation && typeof providerContract.capabilityNegotiation === 'object'
    ? providerContract.capabilityNegotiation
    : source.capabilityNegotiation && typeof source.capabilityNegotiation === 'object'
      ? source.capabilityNegotiation
      : {};

  return {
    provider: compactString(providerContract.provider || source.provider || 'mailchimp') || 'mailchimp',
    service: compactString(providerContract.service || source.service || 'mailchimp-marketing') || 'mailchimp-marketing',
    externalState: compactString(
      externalHandoff.state
        || source.externalHandoffState
        || (externalHandoff.requestId ? 'linked' : 'local_only'),
    ).toLowerCase().replaceAll('-', '_') || 'local_only',
    externalRequestId: compactString(externalHandoff.requestId || source.externalRequestId || source.providerRequestId),
    cursor: compactString(sync.cursor || source.syncCursor || source.cursor),
    lastSyncedAt: compactString(sync.lastSyncedAt || source.lastSyncedAt || source.syncedAt),
    resource: compactString(sync.resource || source.syncResource || 'mailchimp') || 'mailchimp',
    batchId: compactString(sync.batchId || source.syncBatchId),
    requiredForExternalWrite: sync.requiredForExternalWrite === true
      || capabilityNegotiation.writeCapabilityRequested === true
      || (Array.isArray(source.capabilities) && source.capabilities.includes('external.write')),
    syncReady: sync.ready !== false,
    capabilitySatisfied: capabilityNegotiation.satisfied !== false,
  };
}

export function buildMailchimpCompileCacheProviderSyncCheckpoint(source = {}, runtime = {}) {
  const compiled = normalizeProviderSyncSource(source);
  const providerServiceContract = buildMailchimpCompileCacheProviderServiceContract(source, runtime);
  const observed = normalizeProviderSyncSource({
    providerContract: runtime.providerContract || source.providerContract,
    externalHandoff: runtime.externalHandoff || source.externalHandoff,
    sync: runtime.sync,
    provider: runtime.provider,
    service: runtime.service,
    externalHandoffState: runtime.externalHandoffState,
    externalRequestId: runtime.externalRequestId,
    providerRequestId: runtime.providerRequestId,
    syncCursor: runtime.syncCursor,
    cursor: runtime.cursor,
    lastSyncedAt: runtime.lastSyncedAt,
    syncedAt: runtime.syncedAt,
    syncResource: runtime.syncResource,
    syncBatchId: runtime.syncBatchId,
    capabilityNegotiation: runtime.capabilityNegotiation,
    capabilities: runtime.capabilities,
  });
  const externalState = observed.externalState !== 'local_only' ? observed.externalState : compiled.externalState;
  const externalRequestId = observed.externalRequestId || compiled.externalRequestId;
  const cursor = observed.cursor || compiled.cursor;
  const lastSyncedAt = observed.lastSyncedAt || compiled.lastSyncedAt;
  const requiredForExternalWrite = observed.requiredForExternalWrite || compiled.requiredForExternalWrite;
  const capabilitySatisfied = observed.capabilitySatisfied !== false
    && compiled.capabilitySatisfied !== false
    && providerServiceContract.negotiation.satisfied === true;
  const serviceContinuity = providerServiceContract.serviceContinuity || {};
  const linked = externalState !== 'local_only';
  const cursorRequired = requiredForExternalWrite || linked;
  const state = !linked && !cursorRequired
    ? 'local_only'
    : linked && !externalRequestId
      ? 'external_unlinked'
      : cursorRequired && !cursor
        ? 'missing_cursor'
        : observed.syncReady === false || compiled.syncReady === false
          ? 'stale'
          : 'ready';
  const restartSafe = (state === 'ready' || state === 'local_only')
    && serviceContinuity.restartSemantics?.replaySafe !== false;

  return {
    protocol: 'aios.compile-cache-provider-sync.mailchimp.v1',
    provider: observed.provider || compiled.provider,
    service: observed.service || compiled.service,
    resource: observed.resource || compiled.resource,
    state: SYNC_CHECKPOINT_STATES.has(state) ? state : 'stale',
    restartSafe,
    externalHandoffState: externalState,
    externalRequestId,
    cursor,
    cursorRequired,
    lastSyncedAt,
    batchId: observed.batchId || compiled.batchId,
    capabilitySatisfied,
    requiredForExternalWrite,
    providerServiceContract: cloneContract(providerServiceContract),
    replayPolicy: restartSafe
      ? 'reuse_checkpoint'
      : serviceContinuity.holdExternalWrite === true
        ? 'hold_for_provider_recovery'
      : state === 'external_unlinked'
        ? 'relink_external_handoff'
        : state === 'missing_cursor'
          ? 'refresh_provider_contract'
          : 'refresh_provider_sync_before_replay',
    blockedReasons: [
      ...(!capabilitySatisfied ? ['provider_capability_missing'] : []),
      ...providerServiceContract.negotiation.blockedReasons,
      ...stableList(serviceContinuity.degradedReasons),
      ...(linked && !externalRequestId ? ['external_request_missing'] : []),
      ...(cursorRequired && !cursor ? ['sync_cursor_missing'] : []),
      ...(state === 'stale' ? ['sync_checkpoint_stale'] : []),
    ].sort(),
  };
}

function normalizeCacheOptions(options = {}) {
  const ttlMs = positiveInteger(options.ttlMs ?? options.ttl ?? DEFAULT_TTL_MS, DEFAULT_TTL_MS);
  const maxEntries = positiveInteger(options.maxEntries ?? options.limit ?? DEFAULT_CACHE_LIMIT, DEFAULT_CACHE_LIMIT);
  const namespace = compactString(options.namespace || 'mailchimp');
  const tags = stableList(options.tags || options.cacheTags);
  return {
    ttlMs,
    maxEntries: Math.max(1, maxEntries),
    namespace,
    tags,
    freezeDescriptors: options.freezeDescriptors !== false,
  };
}

function makeEntry(identity, descriptor, options, now) {
  const diagnostics = Array.isArray(descriptor.diagnostics) ? descriptor.diagnostics : [];
  const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length;
  const warningCount = diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length;
  const expiresAt = options.ttlMs > 0 ? now + options.ttlMs : null;
  const providerSyncCheckpoint = buildMailchimpCompileCacheProviderSyncCheckpoint(descriptor);
  const providerServiceContract = providerSyncCheckpoint.providerServiceContract
    || buildMailchimpCompileCacheProviderServiceContract(descriptor);
  const boundaryScope = normalizeBoundaryScope(descriptor);
  const boundaryCheckpoint = buildMailchimpCompileCacheBoundaryCheckpoint({ descriptor, boundaryScope });
  return {
    protocol: 'aios.compile-cache-entry.mailchimp.v1',
    key: identity.cacheKey,
    namespace: options.namespace,
    tags: options.tags,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
    expiresAt,
    hits: 0,
    stale: false,
    identity: {
      protocol: identity.protocol,
      adapter: identity.adapter,
      language: identity.language,
      sourceKind: identity.sourceKind,
      sourceHash: identity.sourceHash,
      optionsHash: identity.optionsHash,
      contractHash: identity.contractHash,
      requestKey: identity.requestKey,
    },
    diagnostics: {
      total: diagnostics.length,
      errors: errorCount,
      warnings: warningCount,
    },
    providerSyncCheckpoint,
    providerServiceContract,
    boundaryScope,
    boundaryCheckpoint,
    descriptor: options.freezeDescriptors ? Object.freeze(cloneContract(descriptor)) : cloneContract(descriptor),
  };
}

function isExpired(entry, now) {
  return entry.expiresAt != null && now >= entry.expiresAt;
}

function normalizeWorkflowHandoffSource(source = {}, runtime = {}) {
  const descriptor = source.descriptor && typeof source.descriptor === 'object'
    ? source.descriptor
    : source.compileCache?.descriptor && typeof source.compileCache.descriptor === 'object'
      ? source.compileCache.descriptor
      : source;
  const compileCache = source.compileCache && typeof source.compileCache === 'object'
    ? source.compileCache
    : source;
  const providerSyncCheckpoint = compileCache.providerSyncCheckpoint && typeof compileCache.providerSyncCheckpoint === 'object'
    ? compileCache.providerSyncCheckpoint
    : source.providerSyncCheckpoint && typeof source.providerSyncCheckpoint === 'object'
      ? source.providerSyncCheckpoint
      : buildMailchimpCompileCacheProviderSyncCheckpoint(descriptor, runtime);
  const providerServiceContract = compileCache.providerServiceContract && typeof compileCache.providerServiceContract === 'object'
    ? compileCache.providerServiceContract
    : source.providerServiceContract && typeof source.providerServiceContract === 'object'
      ? source.providerServiceContract
      : providerSyncCheckpoint.providerServiceContract && typeof providerSyncCheckpoint.providerServiceContract === 'object'
        ? providerSyncCheckpoint.providerServiceContract
        : buildMailchimpCompileCacheProviderServiceContract(descriptor, runtime);
  const boundaryScope = compileCache.boundaryScope && typeof compileCache.boundaryScope === 'object'
    ? compileCache.boundaryScope
    : source.boundaryScope && typeof source.boundaryScope === 'object'
      ? source.boundaryScope
      : normalizeBoundaryScope(descriptor);
  const boundaryCheckpoint = compileCache.boundaryCheckpoint && typeof compileCache.boundaryCheckpoint === 'object'
    ? compileCache.boundaryCheckpoint
    : source.boundaryCheckpoint && typeof source.boundaryCheckpoint === 'object'
      ? source.boundaryCheckpoint
      : buildMailchimpCompileCacheBoundaryCheckpoint({ descriptor, boundaryScope }, runtime);
  const acceptance = runtime.acceptance && typeof runtime.acceptance === 'object'
    ? runtime.acceptance
    : runtime.operatorAcceptance && typeof runtime.operatorAcceptance === 'object'
      ? runtime.operatorAcceptance
      : compileCache.acceptance && typeof compileCache.acceptance === 'object'
        ? compileCache.acceptance
        : {};
  const request = runtime.request && typeof runtime.request === 'object'
    ? runtime.request
    : runtime.clientRequest && typeof runtime.clientRequest === 'object'
      ? runtime.clientRequest
      : compileCache.request && typeof compileCache.request === 'object'
        ? compileCache.request
        : {};
  const client = runtime.client && typeof runtime.client === 'object'
    ? runtime.client
    : runtime.clientState && typeof runtime.clientState === 'object'
      ? runtime.clientState
      : compileCache.client && typeof compileCache.client === 'object'
        ? compileCache.client
        : {};
  const lifecycleCommandCheckpoint = compileCache.lifecycleCommandCheckpoint
    && typeof compileCache.lifecycleCommandCheckpoint === 'object'
    ? compileCache.lifecycleCommandCheckpoint
    : source.lifecycleCommandCheckpoint && typeof source.lifecycleCommandCheckpoint === 'object'
      ? source.lifecycleCommandCheckpoint
      : runtime.lifecycleCommandCheckpoint && typeof runtime.lifecycleCommandCheckpoint === 'object'
        ? runtime.lifecycleCommandCheckpoint
        : client.lifecycleCommandCheckpoint && typeof client.lifecycleCommandCheckpoint === 'object'
          ? client.lifecycleCommandCheckpoint
          : {};

  return {
    namespace: compactString(compileCache.namespace || source.namespace || 'mailchimp'),
    cacheKey: compactString(compileCache.key || compileCache.cacheKey || source.key || source.cacheKey),
    requestKey: compactString(
      compileCache.requestKey
        || compileCache.identity?.requestKey
        || source.requestKey
        || source.identity?.requestKey,
    ),
    status: compactString(compileCache.status || source.status || (compileCache.replayed ? 'hit' : 'stored')),
    replayed: compileCache.replayed === true || source.replayed === true,
    stale: compileCache.stale === true || source.stale === true,
    ttlRemainingMs: compileCache.ttlRemainingMs ?? source.ttlRemainingMs ?? null,
    sourceHash: compactString(compileCache.sourceHash || compileCache.identity?.sourceHash || source.sourceHash || source.identity?.sourceHash),
    optionsHash: compactString(compileCache.optionsHash || compileCache.identity?.optionsHash || source.optionsHash || source.identity?.optionsHash),
    contractHash: compactString(compileCache.contractHash || compileCache.identity?.contractHash || source.contractHash || source.identity?.contractHash),
    diagnostics: compileCache.diagnostics && typeof compileCache.diagnostics === 'object'
      ? compileCache.diagnostics
      : source.diagnostics && typeof source.diagnostics === 'object'
        ? source.diagnostics
        : {},
    providerSyncCheckpoint,
    providerServiceContract,
    boundaryScope,
    boundaryCheckpoint,
    acceptance,
    request,
    client,
    lifecycleCommandCheckpoint,
  };
}

function normalizeWorkflowRequestAdoption(normalized = {}) {
  const request = normalized.request && typeof normalized.request === 'object' ? normalized.request : {};
  const client = normalized.client && typeof normalized.client === 'object' ? normalized.client : {};
  const providerSync = normalized.providerSyncCheckpoint || {};
  const providerContract = normalized.providerServiceContract || {};
  const boundaryCheckpoint = normalized.boundaryCheckpoint || {};
  const expectedHashes = {
    sourceHash: normalized.sourceHash,
    optionsHash: normalized.optionsHash,
    contractHash: normalized.contractHash,
  };
  const observedHashes = {
    sourceHash: compactString(request.sourceHash || request.source?.hash || client.sourceHash),
    optionsHash: compactString(request.optionsHash || request.options?.hash || client.optionsHash),
    contractHash: compactString(request.contractHash || request.contract?.hash || client.contractHash),
  };
  const hashMismatches = Object.keys(expectedHashes)
    .filter((key) => expectedHashes[key] && observedHashes[key] && expectedHashes[key] !== observedHashes[key])
    .map((key) => `request_${key.replace('Hash', '_hash')}_mismatch`);
  const requestedAction = compactString(request.action || request.operation || client.action || client.operation);
  const requestedResource = inferMailchimpResourceKind(
    request.resource
      || request.primaryResource
      || request.entity
      || client.resource
      || client.primaryResource,
  );
  const contractResourceKinds = stableList(providerContract.resourceKinds);
  const resourceMismatch = Boolean(
    requestedResource
      && contractResourceKinds.length > 0
      && !contractResourceKinds.includes(requestedResource),
  );
  const requestedCapabilities = stableList([
    request.requiredCapability,
    ...(Array.isArray(request.requiredCapabilities) ? request.requiredCapabilities : []),
    ...(Array.isArray(request.capabilities) ? request.capabilities : []),
    ...(requestedResource ? MAILCHIMP_RESOURCE_CAPABILITIES[requestedResource] || [`${requestedResource}.read`] : []),
  ]);
  const grantedCapabilities = stableList([
    ...(Array.isArray(providerContract.grantedCapabilities) ? providerContract.grantedCapabilities : []),
    ...(Array.isArray(providerContract.availableCapabilities) ? providerContract.availableCapabilities : []),
  ]);
  const capabilityGaps = requestedCapabilities.filter((capability) => (
    grantedCapabilities.length > 0 && !grantedCapabilities.includes(capability)
  ));
  const requestTenant = compactString(request.tenant || request.tenantId || client.tenant || client.tenantId);
  const requestWorkspace = compactString(request.workspace || request.workspaceId || client.workspace || client.workspaceId);
  const tenantMismatch = Boolean(
    requestTenant
      && boundaryCheckpoint.tenant
      && requestTenant !== boundaryCheckpoint.tenant
      && requestTenant !== boundaryCheckpoint.runtimeTenant,
  );
  const workspaceMismatch = Boolean(
    requestWorkspace
      && boundaryCheckpoint.workspace
      && requestWorkspace !== boundaryCheckpoint.workspace
      && requestWorkspace !== boundaryCheckpoint.runtimeWorkspace
      && !stableList(boundaryCheckpoint.allowedWorkspaces).includes(requestWorkspace),
  );
  const sessionId = compactString(request.sessionId || request.session || client.sessionId || client.session);
  const viewId = compactString(request.viewId || client.viewId || client.route || client.surface);
  const blockedReasons = stableList([
    ...hashMismatches,
    ...(resourceMismatch ? ['request_resource_not_in_contract'] : []),
    ...capabilityGaps.map((capability) => `request_capability_missing:${capability}`),
    ...(tenantMismatch ? ['request_tenant_mismatch'] : []),
    ...(workspaceMismatch ? ['request_workspace_mismatch'] : []),
  ]);
  const adoptionState = blockedReasons.length === 0
    ? sessionId || viewId || requestedAction
      ? 'adopted'
      : 'unbound'
    : hashMismatches.length > 0
      ? 'request_contract_drift'
      : tenantMismatch || workspaceMismatch
        ? 'boundary_mismatch'
        : 'capability_gap';
  const restartSafe = blockedReasons.length === 0
    || blockedReasons.every((reason) => reason.startsWith('request_capability_missing:'));

  return {
    protocol: 'aios.compile-cache-request-adoption.mailchimp.v1',
    state: adoptionState,
    adopted: adoptionState === 'adopted',
    restartSafe,
    sessionId,
    viewId,
    requestId: compactString(request.id || request.requestId || request.key || normalized.requestKey),
    requestedAction,
    requestedResource,
    expectedHashes,
    observedHashes,
    hashMismatches,
    requestedCapabilities,
    grantedCapabilities,
    capabilityGaps,
    tenant: requestTenant,
    workspace: requestWorkspace,
    blockedReasons,
    handoffKey: stableList([
      normalized.namespace,
      normalized.cacheKey,
      normalized.requestKey,
      sessionId,
      viewId,
      requestedAction,
      requestedResource,
    ]).join(':'),
    nextAction: blockedReasons.length === 0
      ? 'bind_client_runtime_state'
      : hashMismatches.length > 0
        ? 'recompile_request_contract'
        : tenantMismatch || workspaceMismatch
          ? 'switch_workspace_or_recompile'
          : 'renegotiate_mailchimp_provider_capabilities',
  };
}

function classifyWorkflowHandoffSeverity({ ready, workflowState, blockedReasons, adoption }) {
  if (ready) return 'info';
  if (workflowState === 'waiting_for_acceptance') return 'warning';
  if (adoption.state === 'request_contract_drift' || blockedReasons.includes('diagnostic_errors')) return 'error';
  if (blockedReasons.some((reason) => reason.includes('denied') || reason.includes('mismatch'))) return 'error';
  if (blockedReasons.some((reason) => reason.includes('missing') || reason.includes('stale'))) return 'warning';
  return 'warning';
}

function buildWorkflowStatusMessage({ ready, workflowState, primaryAction, providerSync, adoption }) {
  if (ready && adoption.adopted) return 'Mailchimp compile cache is bound to the current client request and ready to replay.';
  if (ready) return 'Mailchimp compile cache is ready; bind a client request before replay telemetry is attributed.';
  if (workflowState === 'waiting_for_acceptance') return 'Mailchimp compile cache is waiting for operator acceptance before replay.';
  if (adoption.state === 'request_contract_drift') return 'Current request contract differs from the cached Mailchimp descriptor.';
  if (adoption.state === 'boundary_mismatch') return 'Current client boundary does not match the cached Mailchimp tenant scope.';
  if (adoption.state === 'capability_gap') return 'Current request needs Mailchimp capabilities outside the cached provider contract.';
  if (providerSync.restartSafe === false) return 'Mailchimp provider sync must be refreshed before cached replay.';
  return `Mailchimp compile cache requires ${primaryAction || 'review_compile_cache_status'} before replay.`;
}

function normalizeClientWorkflowRouteIntent(normalized = {}, requestAdoption = {}) {
  const request = normalized.request && typeof normalized.request === 'object' ? normalized.request : {};
  const client = normalized.client && typeof normalized.client === 'object' ? normalized.client : {};
  const routeName = compactString(
    request.route
      || request.routeName
      || request.path
      || client.route
      || client.routeName
      || client.path
      || client.surface,
  );
  const workflowIntent = compactString(
    request.workflowIntent
      || request.intent
      || request.goal
      || client.workflowIntent
      || client.intent,
  );
  const transition = compactString(
    request.transition
      || request.nextRoute
      || client.transition
      || client.nextRoute,
  );
  const correlationId = compactString(
    request.correlationId
      || request.traceId
      || request.id
      || request.requestId
      || client.correlationId
      || client.traceId,
  );
  const routeKey = stableList([
    normalized.namespace,
    routeName || 'unknown-route',
    requestAdoption.sessionId || 'no-session',
    requestAdoption.viewId || 'no-view',
    workflowIntent || requestAdoption.requestedAction || 'observe',
    requestAdoption.requestedResource || 'mailchimp',
  ]).join(':');

  return {
    protocol: 'aios.compile-cache-client-route-intent.mailchimp.v1',
    routeName,
    workflowIntent,
    transition,
    correlationId,
    routeKey,
    sessionId: requestAdoption.sessionId,
    viewId: requestAdoption.viewId,
    requestId: requestAdoption.requestId,
    requestedAction: requestAdoption.requestedAction,
    requestedResource: requestAdoption.requestedResource,
    bound: requestAdoption.adopted === true,
  };
}

function normalizeLifecycleCommandCheckpoint(normalized = {}, requestAdoption = {}, runtime = {}) {
  const source = normalized.lifecycleCommandCheckpoint && typeof normalized.lifecycleCommandCheckpoint === 'object'
    ? normalized.lifecycleCommandCheckpoint
    : {};
  const request = normalized.request && typeof normalized.request === 'object' ? normalized.request : {};
  const client = normalized.client && typeof normalized.client === 'object' ? normalized.client : {};
  const runtimeCommand = runtime.clientCommand && typeof runtime.clientCommand === 'object'
    ? runtime.clientCommand
    : runtime.command && typeof runtime.command === 'object'
      ? runtime.command
      : {};
  const requestedCommand = compactString(
    source.requestedCommand
      || source.requestedAction
      || runtimeCommand.requestedAction
      || runtimeCommand.command
      || request.lifecycleCommand
      || request.command
      || client.lifecycleCommand
      || requestAdoption.requestedAction
      || 'observe',
  );
  const submitAction = compactString(
    source.submitAction
      || source.nextAction
      || runtimeCommand.submitAction
      || runtimeCommand.nextAction
      || requestedCommand,
  );
  const idempotencyKey = compactString(
    source.idempotencyKey
      || runtimeCommand.idempotencyKey
      || request.idempotencyKey
      || client.idempotencyKey
      || normalized.requestKey,
  );
  const acknowledgedCommands = stableList(
    runtime.acknowledgedCommands
      || runtime.acknowledgedCommandIds
      || client.acknowledgedCommands
      || request.acknowledgedCommands,
  );
  const blockedReasons = stableList([
    ...(Array.isArray(source.blockedReasons) ? source.blockedReasons : []),
    ...(Array.isArray(runtimeCommand.blockedReasons) ? runtimeCommand.blockedReasons : []),
    ...(runtimeCommand.restartSafe === false ? ['runtime_command_not_restart_safe'] : []),
    ...(source.restartSafe === false ? ['lifecycle_command_not_restart_safe'] : []),
    ...(source.controls?.operatorHold === true ? ['lifecycle_operator_hold'] : []),
    ...(!idempotencyKey && ['dispatch', 'resume'].includes(submitAction) ? ['lifecycle_command_missing_idempotency'] : []),
  ]);
  const acknowledged = source.acknowledged === true
    || acknowledgedCommands.includes(idempotencyKey)
    || acknowledgedCommands.includes(source.commandId)
    || acknowledgedCommands.includes(runtimeCommand.commandId);
  const observed = Boolean(
    source.protocol
      || source.checkpointKey
      || runtimeCommand.commandId
      || requestedCommand !== 'observe'
      || idempotencyKey,
  );
  const restartSafe = observed
    ? source.restartSafe !== false
      && runtimeCommand.restartSafe !== false
      && Boolean(idempotencyKey || !['dispatch', 'resume'].includes(submitAction))
      && blockedReasons.length === 0
    : true;
  const state = !observed
    ? 'unobserved'
    : blockedReasons.length > 0
      ? blockedReasons.includes('lifecycle_operator_hold') ? 'held' : 'blocked'
      : acknowledged
        ? 'acknowledged'
        : ['dispatch', 'resume'].includes(submitAction)
          ? 'ready_to_submit'
          : 'ready_to_queue';
  const checkpointKey = compactString(source.checkpointKey)
    || `mailchimp-lifecycle-command:${stableHash({
      namespace: normalized.namespace,
      cacheKey: normalized.cacheKey,
      requestKey: normalized.requestKey,
      requestId: requestAdoption.requestId,
      requestedCommand,
      submitAction,
      idempotencyKey,
      blockedReasons,
    })}`;

  return {
    protocol: 'aios.compile-cache-lifecycle-command-checkpoint.mailchimp.v1',
    checkpointKey,
    observed,
    state,
    requestedCommand,
    submitAction,
    idempotencyKey,
    commandId: compactString(source.commandId || runtimeCommand.commandId),
    acknowledged,
    restartSafe,
    replaySafe: restartSafe && state !== 'blocked' && state !== 'held',
    externalWrite: source.externalWrite === true || runtimeCommand.externalWrite === true,
    blockedReasons,
    schedule: source.schedule || runtimeCommand.schedule || null,
    controls: {
      enabled: source.controls?.enabled !== false,
      operatorHold: source.controls?.operatorHold === true,
      canSubmit: restartSafe && state !== 'held' && state !== 'blocked',
      canAcknowledge: Boolean(idempotencyKey) && state !== 'acknowledged',
      canReplay: restartSafe,
    },
    nextAction: state === 'unobserved'
      ? 'bind_client_runtime_state'
      : state === 'acknowledged'
        ? 'observe'
        : blockedReasons.includes('lifecycle_operator_hold')
          ? 'await_lifecycle_release'
          : blockedReasons.includes('lifecycle_command_missing_idempotency')
            ? 'attach_idempotency_key'
            : blockedReasons.length > 0
              ? 'repair_compile_cache_lifecycle_settings'
              : submitAction,
    clientPatch: {
      compileCacheLifecycleCommandCheckpointKey: checkpointKey,
      compileCacheLifecycleCommandState: state,
      compileCacheLifecycleCommandNextAction: state === 'acknowledged' ? 'observe' : submitAction,
      compileCacheLifecycleCommandRestartSafe: restartSafe,
      compileCacheLifecycleCommandBlockedReasons: blockedReasons,
    },
    restartSemantics: {
      replaySafe: restartSafe,
      duplicateCommandPolicy: 'dedupe-by-lifecycle-command-checkpoint',
      resumeFromCommandCheckpoint: checkpointKey,
      externalWritesPerformed: false,
    },
  };
}

function buildClientWorkflowActionQueue({
  ready,
  workflowState,
  primaryAction,
  routeState,
  severity,
  blockedReasons,
  requestAdoption,
  providerReplayHandoff,
  boundaryBlockedReasons,
  providerBlockedReasons,
  acceptanceRequired,
  acceptanceAccepted,
}) {
  const actions = [];
  const pushAction = ({
    action,
    reason,
    owner,
    route = routeState,
    enabled = true,
    blocking = true,
  }) => {
    const command = compactString(action);
    if (!command) return;
    actions.push({
      action: command,
      command,
      reason: compactString(reason || 'ready') || 'ready',
      owner: compactString(owner || inferRecoveryCommandOwner(command)),
      phase: inferRecoveryCommandPhase(command, workflowState),
      routeState: route,
      severity: blocking ? severity : 'info',
      blocking,
      enabled,
      handoffKey: requestAdoption.handoffKey,
    });
  };

  if (ready) {
    pushAction({
      action: primaryAction,
      reason: requestAdoption.adopted ? 'request_bound' : 'cache_ready',
      owner: 'runtime',
      route: 'ready',
      blocking: false,
    });
  } else {
    if (acceptanceRequired && !acceptanceAccepted) {
      pushAction({
        action: 'request_compile_cache_acceptance',
        reason: 'operator_acceptance_missing',
        owner: 'operator',
        route: 'acceptance_required',
      });
    }
    if (requestAdoption.state === 'request_contract_drift') {
      pushAction({
        action: requestAdoption.nextAction,
        reason: requestAdoption.hashMismatches[0] || 'request_contract_drift',
        owner: 'compiler',
      });
    }
    if (requestAdoption.state === 'boundary_mismatch' || boundaryBlockedReasons.length > 0) {
      pushAction({
        action: boundaryBlockedReasons.includes('runtime_boundary_drift')
          ? 'switch_workspace_or_recompile'
          : 'repair_tenant_permissions',
        reason: boundaryBlockedReasons[0] || requestAdoption.blockedReasons[0] || 'boundary_mismatch',
        owner: 'operator',
      });
    }
    if (requestAdoption.state === 'capability_gap' || providerBlockedReasons.length > 0) {
      pushAction({
        action: requestAdoption.state === 'capability_gap'
          ? requestAdoption.nextAction
          : providerReplayHandoff.nextAction || 'refresh_provider_sync_before_replay',
        reason: requestAdoption.capabilityGaps?.[0]
          ? `request_capability_missing:${requestAdoption.capabilityGaps[0]}`
          : providerBlockedReasons[0] || 'provider_sync_not_restart_safe',
        owner: 'provider',
      });
    }
    if (providerReplayHandoff.blockedReasons?.length > 0) {
      pushAction({
        action: providerReplayHandoff.nextAction || 'refresh_provider_sync_before_replay',
        reason: providerReplayHandoff.blockedReasons[0],
        owner: providerReplayHandoff.adapterRecoveryState?.owner || 'provider',
      });
    }
    pushAction({
      action: primaryAction,
      reason: blockedReasons[0] || 'needs_attention',
      owner: inferRecoveryCommandOwner(primaryAction),
      enabled: actions.length === 0,
    });
  }

  const byCommandAndReason = new Map();
  actions.forEach((action, index) => {
    const key = `${action.command}:${action.reason}`;
    const existing = byCommandAndReason.get(key);
    if (!existing || existing.index > index) byCommandAndReason.set(key, { ...action, index });
  });
  return [...byCommandAndReason.values()]
    .sort((left, right) => left.index - right.index)
    .map(({ index, ...action }, queueIndex) => ({
      ...action,
      index: queueIndex,
      idempotencyKey: stableList([
        action.handoffKey,
        action.command,
        action.reason,
        String(queueIndex),
      ]).join(':'),
    }));
}

function buildClientRuntimeAdoptionContract({
  normalized,
  ready,
  workflowState,
  routeState,
  primaryAction,
  severity,
  statusMessage,
  blockedReasons,
  requestAdoption,
  providerReplayHandoff,
  boundaryBlockedReasons,
  providerBlockedReasons,
  acceptanceRequired,
  acceptanceAccepted,
}) {
  const routeIntent = normalizeClientWorkflowRouteIntent(normalized, requestAdoption);
  const actionQueue = buildClientWorkflowActionQueue({
    ready,
    workflowState,
    primaryAction,
    routeState,
    severity,
    blockedReasons,
    requestAdoption,
    providerReplayHandoff,
    boundaryBlockedReasons,
    providerBlockedReasons,
    acceptanceRequired,
    acceptanceAccepted,
  });
  const focusedAction = actionQueue.find((action) => action.blocking) || actionQueue[0] || null;
  const visibleStatus = ready
    ? normalized.replayed ? 'cache_hit_ready' : 'cache_ready'
    : workflowState;
  const adoptionBlocked = requestAdoption.blockedReasons.length > 0;
  const providerBlocked = providerReplayHandoff.blockedReasons.length > 0 || providerBlockedReasons.length > 0;
  const boundaryBlocked = boundaryBlockedReasons.length > 0;
  const restartSafe = (ready || workflowState === 'waiting_for_acceptance') && requestAdoption.restartSafe;

  return {
    protocol: 'aios.compile-cache-client-runtime-adoption.mailchimp.v1',
    state: ready
      ? 'adopted_ready'
      : acceptanceRequired && !acceptanceAccepted
        ? 'awaiting_operator_acceptance'
        : adoptionBlocked
          ? requestAdoption.state
          : providerBlocked
            ? providerReplayHandoff.state
            : boundaryBlocked
              ? 'boundary_blocked'
              : workflowState,
    ready,
    visibleStatus,
    routeState,
    severity,
    message: statusMessage,
    routeIntent,
    focusedAction,
    actionQueue,
    handoff: {
      key: requestAdoption.handoffKey,
      requestId: requestAdoption.requestId,
      idempotencyKey: stableList([
        routeIntent.routeKey,
        workflowState,
        primaryAction,
        blockedReasons.join('|'),
      ]).join(':'),
      restartSafe,
      replayAllowed: ready && providerReplayHandoff.replayAllowed === true,
      externalWriteSuppressed: providerReplayHandoff.externalHandoff?.externalWriteSuppressed === true
        || blockedReasons.length > 0,
    },
    telemetry: {
      protocol: 'aios.compile-cache-client-runtime-telemetry.mailchimp.v1',
      namespace: normalized.namespace,
      cacheKey: normalized.cacheKey,
      requestKey: normalized.requestKey,
      status: normalized.status,
      replayed: normalized.replayed,
      routeKey: routeIntent.routeKey,
      sessionId: requestAdoption.sessionId,
      viewId: requestAdoption.viewId,
      correlationId: routeIntent.correlationId,
      primaryAction,
      providerReplayState: providerReplayHandoff.state,
      providerRecoveryOwner: providerReplayHandoff.adapterRecoveryState?.owner || inferRecoveryCommandOwner(primaryAction),
      adoptionState: requestAdoption.state,
      blockedReasonCount: blockedReasons.length,
      blockedReasons,
    },
  };
}

function buildClientWorkflowRepairReport({
  normalized,
  ready,
  workflowState,
  routeState,
  primaryAction,
  severity,
  statusMessage,
  blockedReasons,
  requestAdoption,
  providerReplayHandoff,
  boundaryBlockedReasons,
  providerBlockedReasons,
  acceptanceRequired,
  acceptanceAccepted,
  runtimeAdoption,
}) {
  const stale = normalized.stale === true;
  const routeIntent = runtimeAdoption.routeIntent || {};
  const focusedAction = runtimeAdoption.focusedAction || null;
  const actionQueue = Array.isArray(runtimeAdoption.actionQueue) ? runtimeAdoption.actionQueue : [];
  const blockingActions = actionQueue.filter((action) => action.blocking !== false);
  const disabledActions = actionQueue.filter((action) => action.enabled === false);
  const retryableActions = actionQueue.filter((action) => (
    ['provider', 'compiler', 'runtime'].includes(action.owner)
      && action.blocking !== false
      && action.command !== 'hold_for_operator'
  ));
  const requestBlocked = requestAdoption.blockedReasons.length > 0;
  const providerBlocked = providerReplayHandoff.blockedReasons.length > 0 || providerBlockedReasons.length > 0;
  const boundaryBlocked = boundaryBlockedReasons.length > 0;
  const repairState = ready
    ? 'no_repair_required'
    : acceptanceRequired && !acceptanceAccepted
      ? 'waiting_for_operator_acceptance'
      : requestBlocked
        ? requestAdoption.state
        : boundaryBlocked
          ? 'boundary_repair_required'
          : providerBlocked
            ? 'provider_repair_required'
            : stale
              ? 'compile_cache_refresh_required'
              : 'workflow_attention_required';
  const operatorVisible = acceptanceRequired
    || boundaryBlocked
    || blockedReasons.some((reason) => reason.includes('denied') || reason.includes('mismatch'));
  const retryAfterMs = ready
    ? 0
    : retryableActions.length > 0
      ? providerReplayHandoff.syncMetadata?.cursorFresh === false
        ? 60000
        : stale
          ? 15000
          : 30000
      : 0;
  const resumeToken = stableList([
    normalized.namespace,
    normalized.cacheKey || 'no-cache-key',
    routeIntent.routeKey || requestAdoption.handoffKey,
    repairState,
  ]).join(':');

  return {
    protocol: 'aios.compile-cache-client-workflow-repair.mailchimp.v1',
    state: repairState,
    ready,
    routeState,
    severity,
    message: statusMessage,
    primaryAction,
    recoveryCommand: ready ? 'observe' : primaryAction,
    resumeToken,
    statusRevision: stableList([
      normalized.contractHash || 'no-contract-hash',
      normalized.sourceHash || 'no-source-hash',
      normalized.optionsHash || 'no-options-hash',
      repairState,
      blockedReasons.join('|') || 'clear',
    ]).join(':'),
    operatorVisible,
    retry: {
      retryable: retryableActions.length > 0 && !operatorVisible,
      retryAfterMs,
      maxAttempts: retryableActions.length > 0 ? 3 : 0,
      nextAction: retryableActions[0]?.command || primaryAction,
      exhausted: false,
    },
    request: {
      adoptionState: requestAdoption.state,
      adopted: requestAdoption.adopted === true,
      requestId: requestAdoption.requestId,
      sessionId: requestAdoption.sessionId,
      viewId: requestAdoption.viewId,
      routeKey: routeIntent.routeKey || null,
      requestedAction: requestAdoption.requestedAction,
      requestedResource: requestAdoption.requestedResource,
      hashMismatches: requestAdoption.hashMismatches,
      capabilityGaps: requestAdoption.capabilityGaps,
      blockedReasons: requestAdoption.blockedReasons,
    },
    provider: {
      state: providerReplayHandoff.state,
      ready: providerReplayHandoff.ready === true,
      restartSafe: providerReplayHandoff.restartSafe === true,
      replayAllowed: providerReplayHandoff.replayAllowed === true,
      nextAction: providerReplayHandoff.nextAction,
      externalHandoffState: providerReplayHandoff.externalHandoff?.state || 'local_only',
      externalRequestId: providerReplayHandoff.externalHandoff?.requestId || '',
      cursorRequired: providerReplayHandoff.syncMetadata?.cursorRequired === true,
      cursorPresent: providerReplayHandoff.syncMetadata?.cursorPresent === true,
      blockedReasons: stableList([
        ...providerBlockedReasons,
        ...providerReplayHandoff.blockedReasons,
      ]),
    },
    boundary: {
      blocked: boundaryBlocked,
      nextAction: boundaryBlocked ? 'repair_tenant_permissions' : 'observe',
      blockedReasons: boundaryBlockedReasons,
    },
    acceptance: {
      required: acceptanceRequired,
      accepted: acceptanceAccepted,
      nextAction: acceptanceRequired && !acceptanceAccepted
        ? 'request_compile_cache_acceptance'
        : primaryAction,
      reason: acceptanceRequired && !acceptanceAccepted
        ? blockedReasons[0] || 'operator_acceptance_missing'
        : '',
    },
    focusedAction,
    actionQueue: actionQueue.map((action) => ({
      command: action.command,
      owner: action.owner,
      reason: action.reason,
      phase: action.phase,
      routeState: action.routeState,
      blocking: action.blocking !== false,
      enabled: action.enabled !== false,
      idempotencyKey: action.idempotencyKey,
    })),
    counters: {
      blockedReasons: blockedReasons.length,
      blockingActions: blockingActions.length,
      disabledActions: disabledActions.length,
      retryableActions: retryableActions.length,
      requestBlocked: requestBlocked ? 1 : 0,
      providerBlocked: providerBlocked ? 1 : 0,
      boundaryBlocked: boundaryBlocked ? 1 : 0,
    },
    clientPatch: {
      compileCacheWorkflowRepairState: repairState,
      compileCacheWorkflowRepairAction: primaryAction,
      compileCacheWorkflowRepairToken: resumeToken,
      compileCacheWorkflowRepairRetryAfterMs: retryAfterMs,
      compileCacheWorkflowRepairOperatorVisible: operatorVisible,
    },
    exportRow: {
      artifactName: 'compile-cache-client-workflow-repair.json',
      readyForExport: true,
      rowId: `${resumeToken}:repair-row`.replace(/[^a-zA-Z0-9_.:-]/g, '_'),
      status: repairState,
      nextAction: primaryAction,
      blockedReasons,
    },
    restartSemantics: {
      replaySafe: ready || repairState === 'waiting_for_operator_acceptance',
      duplicateCommandPolicy: 'dedupe-by-client-workflow-repair-token',
      resumeFromRepairToken: resumeToken,
      externalWritesPerformed: false,
    },
  };
}

function normalizeProviderReplayTimestamp(value) {
  const text = compactString(value);
  if (!text) return null;
  const numeric = Number(text);
  if (Number.isFinite(numeric)) return Math.max(0, Math.floor(numeric));
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : null;
}

export function buildMailchimpCompileCacheProviderReplayHandoff(source = {}, runtime = {}) {
  const providerSync = source.providerSyncCheckpoint && typeof source.providerSyncCheckpoint === 'object'
    ? source.providerSyncCheckpoint
    : {};
  const providerContract = source.providerServiceContract && typeof source.providerServiceContract === 'object'
    ? source.providerServiceContract
    : providerSync.providerServiceContract && typeof providerSync.providerServiceContract === 'object'
      ? providerSync.providerServiceContract
      : {};
  const boundaryCheckpoint = source.boundaryCheckpoint && typeof source.boundaryCheckpoint === 'object'
    ? source.boundaryCheckpoint
    : {};
  const requestAdoption = source.requestAdoption && typeof source.requestAdoption === 'object'
    ? source.requestAdoption
    : {};
  const syncMetadata = providerContract.syncMetadata && typeof providerContract.syncMetadata === 'object'
    ? providerContract.syncMetadata
    : {};
  const contractExternalHandoff = providerContract.externalHandoff && typeof providerContract.externalHandoff === 'object'
    ? providerContract.externalHandoff
    : {};
  const receipt = contractExternalHandoff.receipt && typeof contractExternalHandoff.receipt === 'object'
    ? contractExternalHandoff.receipt
    : {};
  const negotiation = providerContract.negotiation && typeof providerContract.negotiation === 'object'
    ? providerContract.negotiation
    : {};
  const now = nowFrom(runtime);
  const cursor = compactString(providerSync.cursor || syncMetadata.cursor || runtime.syncCursor || runtime.cursor);
  const cursorRequired = Boolean(providerSync.cursorRequired === true
    || syncMetadata.restartSafe === false
    || contractExternalHandoff.state && contractExternalHandoff.state !== 'local_only');
  const lastSyncedAt = compactString(providerSync.lastSyncedAt || syncMetadata.lastSyncedAt);
  const lastSyncedAtMs = normalizeProviderReplayTimestamp(lastSyncedAt);
  const maxCursorAgeMs = positiveInteger(
    runtime.providerSyncMaxAgeMs
      ?? runtime.syncMaxAgeMs
      ?? syncMetadata.maxAgeMs
      ?? providerSync.maxAgeMs,
    0,
  );
  const cursorAgeMs = lastSyncedAtMs == null ? null : Math.max(0, now - lastSyncedAtMs);
  const cursorFresh = maxCursorAgeMs <= 0 || cursorAgeMs == null || cursorAgeMs <= maxCursorAgeMs;
  const externalState = compactString(
    providerSync.externalHandoffState
      || contractExternalHandoff.state
      || (providerSync.externalRequestId || contractExternalHandoff.requestId ? 'linked' : 'local_only'),
  ).toLowerCase().replaceAll('-', '_') || 'local_only';
  const externalRequestId = compactString(providerSync.externalRequestId || contractExternalHandoff.requestId);
  const linked = externalState !== 'local_only';
  const receiptRequired = Boolean(contractExternalHandoff.receiptRequired === true
    || receipt.required === true
    || linked && contractExternalHandoff.receiptAcknowledged !== true);
  const receiptAcknowledged = contractExternalHandoff.receiptAcknowledged === true
    || receipt.acknowledged === true;
  const capabilitySatisfied = providerSync.capabilitySatisfied !== false
    && negotiation.satisfied !== false
    && stableList(providerContract.missingCapabilities).length === 0;
  const externalWriteSuppressed = linked && (!externalRequestId || receiptRequired && !receiptAcknowledged);
  const blockedReasons = stableList([
    ...(providerSync.restartSafe === false ? ['provider_sync_not_restart_safe'] : []),
    ...(capabilitySatisfied ? [] : ['provider_capability_negotiation_failed']),
    ...(linked && !externalRequestId ? ['external_handoff_unlinked'] : []),
    ...(cursorRequired && !cursor ? ['sync_cursor_missing'] : []),
    ...(cursorFresh ? [] : ['sync_cursor_stale']),
    ...(receiptRequired && !receiptAcknowledged ? ['provider_receipt_ack_missing'] : []),
    ...(boundaryCheckpoint.ready === false ? ['boundary_checkpoint_not_restart_safe'] : []),
    ...(requestAdoption.restartSafe === false ? ['request_adoption_not_restart_safe'] : []),
    ...(Array.isArray(providerSync.blockedReasons) ? providerSync.blockedReasons : []),
    ...(Array.isArray(negotiation.blockedReasons) ? negotiation.blockedReasons : []),
    ...(Array.isArray(receipt.blockedReasons) ? receipt.blockedReasons : []),
  ]);
  const state = blockedReasons.length === 0
    ? linked ? 'external_replay_ready' : 'local_replay_ready'
    : !capabilitySatisfied
      ? 'capability_negotiation_required'
      : linked && !externalRequestId
        ? 'external_handoff_unlinked'
        : receiptRequired && !receiptAcknowledged
          ? 'provider_receipt_required'
          : cursorRequired && !cursor
            ? 'sync_cursor_required'
            : !cursorFresh
              ? 'sync_cursor_stale'
              : 'provider_replay_blocked';
  const nextAction = blockedReasons.length === 0
    ? 'resume_from_compile_cache'
    : !capabilitySatisfied
      ? negotiation.nextAction || 'renegotiate_mailchimp_provider_capabilities'
      : linked && !externalRequestId
        ? 'relink_external_handoff'
        : receiptRequired && !receiptAcknowledged
          ? 'refresh_provider_sync_before_replay'
          : cursorRequired && !cursor || !cursorFresh
            ? 'refresh_provider_sync_before_replay'
            : boundaryCheckpoint.nextAction || requestAdoption.nextAction || 'refresh_provider_sync_before_replay';
  const handoffKey = compactString(contractExternalHandoff.handoffKey)
    || stableList([
      providerContract.provider || providerSync.provider || 'mailchimp',
      providerContract.service || providerSync.service || 'mailchimp-marketing',
      providerContract.primaryResource || providerSync.resource || syncMetadata.resource || 'audience',
      externalRequestId || 'local',
      cursor || 'no-cursor',
    ]).join(':');

  return {
    protocol: 'aios.compile-cache-provider-replay-handoff.mailchimp.v1',
    state,
    ready: blockedReasons.length === 0,
    restartSafe: blockedReasons.length === 0 || state === 'capability_negotiation_required',
    replayAllowed: blockedReasons.length === 0,
    nextAction,
    recoveryCommand: blockedReasons.length === 0 ? 'observe' : nextAction,
    provider: compactString(providerContract.provider || providerSync.provider || 'mailchimp'),
    service: compactString(providerContract.service || providerSync.service || 'mailchimp-marketing'),
    primaryResource: compactString(providerContract.primaryResource || providerSync.resource || syncMetadata.resource || 'audience'),
    resourceKinds: stableList(providerContract.resourceKinds),
    capabilityNegotiation: {
      state: compactString(negotiation.state || (capabilitySatisfied ? 'satisfied' : 'missing_capabilities')),
      satisfied: capabilitySatisfied,
      requiredCapabilities: stableList(providerContract.requiredCapabilities),
      grantedCapabilities: stableList(providerContract.grantedCapabilities || providerContract.availableCapabilities),
      missingCapabilities: stableList(providerContract.missingCapabilities),
      nextAction: compactString(negotiation.nextAction || (capabilitySatisfied ? 'reuse_provider_contract' : 'renegotiate_mailchimp_provider_capabilities')),
    },
    syncMetadata: {
      resource: compactString(syncMetadata.resource || providerSync.resource || providerContract.primaryResource || 'audience'),
      cursor,
      cursorRequired,
      cursorPresent: Boolean(cursor),
      lastSyncedAt,
      lastSyncedAtMs,
      maxAgeMs: maxCursorAgeMs,
      cursorAgeMs,
      cursorFresh,
      batchId: compactString(providerSync.batchId || syncMetadata.batchId),
      cursorPartition: compactString(syncMetadata.cursorPartition),
      restartSafe: providerSync.restartSafe === true && (!cursorRequired || Boolean(cursor)) && cursorFresh,
    },
    externalHandoff: {
      state: externalState,
      linked,
      requestId: externalRequestId,
      handoffKey,
      receiptRequired,
      receiptAcknowledged,
      externalWriteSuppressed,
      routeState: blockedReasons.length === 0 ? 'ready' : 'needs_attention',
      receipt: cloneContract(receipt),
    },
    adapterRecoveryState: {
      owner: inferRecoveryCommandOwner(nextAction),
      phase: inferRecoveryCommandPhase(nextAction, state),
      restartSafe: blockedReasons.length === 0,
      replaySafe: blockedReasons.length === 0,
      idempotencyKey: stableList([
        providerContract.provider || 'mailchimp',
        providerContract.service || 'mailchimp-marketing',
        externalRequestId || 'local',
        cursor || 'no-cursor',
        nextAction,
        blockedReasons.join('|'),
      ]).join(':'),
    },
    statusPayload: {
      protocol: 'aios.compile-cache-provider-replay-status.mailchimp.v1',
      state,
      severity: blockedReasons.length === 0 ? 'info' : state === 'capability_negotiation_required' ? 'warning' : 'error',
      provider: compactString(providerContract.provider || providerSync.provider || 'mailchimp'),
      service: compactString(providerContract.service || providerSync.service || 'mailchimp-marketing'),
      externalRequestId,
      handoffKey,
      nextAction,
      recoveryCommand: blockedReasons.length === 0 ? 'observe' : nextAction,
      blockedReasons,
    },
    blockedReasons,
  };
}

export function buildMailchimpCompileCacheClientWorkflowHandoff(source = {}, runtime = {}) {
  const normalized = normalizeWorkflowHandoffSource(source, runtime);
  const providerSync = normalized.providerSyncCheckpoint;
  const providerContract = normalized.providerServiceContract.protocol === 'aios.compile-cache-provider-service-contract.mailchimp.v1'
    ? normalized.providerServiceContract
    : buildMailchimpCompileCacheProviderServiceContract(normalized.providerServiceContract, runtime);
  const boundaryScope = normalized.boundaryScope.protocol === 'aios.compile-cache-boundary-scope.mailchimp.v1'
    ? normalized.boundaryScope
    : normalizeBoundaryScope(normalized.boundaryScope);
  const boundaryCheckpoint = normalized.boundaryCheckpoint.protocol === 'aios.compile-cache-boundary-checkpoint.mailchimp.v1'
    ? normalized.boundaryCheckpoint
    : buildMailchimpCompileCacheBoundaryCheckpoint({ boundaryScope }, runtime);
  const diagnostics = normalized.diagnostics;
  const diagnosticErrors = positiveInteger(diagnostics.errors ?? diagnostics.errorCount, 0);
  const providerBlockedReasons = stableList([
    ...(providerSync.restartSafe === false ? ['provider_sync_not_restart_safe'] : []),
    ...(providerSync.capabilitySatisfied === false ? ['provider_capability_missing'] : []),
    ...(Array.isArray(providerSync.blockedReasons) ? providerSync.blockedReasons : []),
    ...(providerContract.negotiation?.satisfied === false ? ['provider_service_contract_not_satisfied'] : []),
    ...(Array.isArray(providerContract.negotiation?.blockedReasons) ? providerContract.negotiation.blockedReasons : []),
  ]);
  const boundaryBlockedReasons = stableList([
    ...(boundaryScope.allowed === false ? ['tenant_boundary_denied'] : []),
    ...(Array.isArray(boundaryScope.blockedReasons) ? boundaryScope.blockedReasons : []),
    ...(boundaryCheckpoint.ready === false ? ['boundary_checkpoint_not_restart_safe'] : []),
    ...(Array.isArray(boundaryCheckpoint.blockedReasons) ? boundaryCheckpoint.blockedReasons : []),
  ]);
  const requestAdoption = normalizeWorkflowRequestAdoption({
    ...normalized,
    providerServiceContract: providerContract,
    boundaryCheckpoint,
  });
  const lifecycleCommandCheckpoint = normalizeLifecycleCommandCheckpoint(normalized, requestAdoption, runtime);
  const providerReplayHandoff = buildMailchimpCompileCacheProviderReplayHandoff({
    providerSyncCheckpoint: providerSync,
    providerServiceContract: providerContract,
    boundaryCheckpoint,
    requestAdoption,
  }, runtime);
  const acceptanceRequired = normalized.acceptance.required === true
    || providerBlockedReasons.includes('provider_sync_not_restart_safe')
    || providerReplayHandoff.restartSafe === false
    || providerSync.externalHandoffState === 'linked' && !providerSync.externalRequestId
    || requestAdoption.state === 'request_contract_drift';
  const acceptanceAccepted = !acceptanceRequired
    || normalized.acceptance.accepted === true
    || Boolean(compactString(normalized.acceptance.acceptedBy) && compactString(normalized.acceptance.acceptedAt));
  const blockedReasons = stableList([
    ...(normalized.stale ? ['stale_entry'] : []),
    ...(diagnosticErrors > 0 ? ['diagnostic_errors'] : []),
    ...providerBlockedReasons,
    ...boundaryBlockedReasons,
    ...requestAdoption.blockedReasons,
    ...providerReplayHandoff.blockedReasons,
    ...(lifecycleCommandCheckpoint.restartSafe === false ? ['lifecycle_command_checkpoint_not_restart_safe'] : []),
    ...(lifecycleCommandCheckpoint.state === 'held' ? ['lifecycle_command_checkpoint_held'] : []),
    ...(lifecycleCommandCheckpoint.state === 'blocked' ? lifecycleCommandCheckpoint.blockedReasons : []),
    ...(acceptanceRequired && !acceptanceAccepted ? ['operator_acceptance_missing'] : []),
  ]);
  const ready = blockedReasons.length === 0;
  const primaryAction = ready
    ? normalized.replayed
      ? 'verify_cached_descriptor'
      : 'reuse_compile_cache'
    : acceptanceRequired && !acceptanceAccepted
      ? 'request_compile_cache_acceptance'
      : boundaryBlockedReasons.length > 0
        ? 'repair_tenant_permissions'
          : providerBlockedReasons.length > 0
            ? providerReplayHandoff.nextAction || providerContract.negotiation?.nextAction || providerSync.replayPolicy || 'refresh_provider_sync_before_replay'
          : providerReplayHandoff.blockedReasons.length > 0
            ? providerReplayHandoff.nextAction || 'refresh_provider_sync_before_replay'
          : lifecycleCommandCheckpoint.state === 'held' || lifecycleCommandCheckpoint.state === 'blocked'
            ? lifecycleCommandCheckpoint.nextAction
          : normalized.stale
            ? 'refresh_compile_cache'
            : diagnosticErrors > 0
              ? 'repair_cached_descriptor'
              : requestAdoption.blockedReasons.length > 0
                ? requestAdoption.nextAction
              : 'review_compile_cache_status';
  const workflowState = ready
    ? 'ready'
    : acceptanceRequired && !acceptanceAccepted
      ? 'waiting_for_acceptance'
      : requestAdoption.state === 'request_contract_drift'
        ? 'request_contract_drift'
        : requestAdoption.state === 'boundary_mismatch'
          ? 'blocked_by_boundary'
          : requestAdoption.state === 'capability_gap'
            ? 'waiting_for_provider'
            : providerReplayHandoff.blockedReasons.length > 0
              ? 'waiting_for_provider'
      : providerBlockedReasons.length > 0
        ? 'waiting_for_provider'
        : boundaryBlockedReasons.length > 0
          ? 'blocked_by_boundary'
          : 'needs_attention';
  const routeState = ready
    ? 'ready'
    : workflowState === 'waiting_for_acceptance'
      ? 'acceptance_required'
      : 'needs_attention';
  const idempotencyParts = stableList([
    normalized.namespace,
    normalized.cacheKey,
    normalized.requestKey,
    normalized.contractHash,
    workflowState,
    primaryAction,
    blockedReasons.join('|'),
  ]);
  const severity = classifyWorkflowHandoffSeverity({
    ready,
    workflowState,
    blockedReasons,
    adoption: requestAdoption,
  });
  const statusMessage = buildWorkflowStatusMessage({
    ready,
    workflowState,
    primaryAction,
    providerSync,
    adoption: requestAdoption,
  });
  const runtimeAdoption = buildClientRuntimeAdoptionContract({
    normalized,
    ready,
    workflowState,
    routeState,
    primaryAction,
    severity,
    statusMessage,
    blockedReasons,
    requestAdoption,
    providerReplayHandoff,
    boundaryBlockedReasons,
    providerBlockedReasons,
    acceptanceRequired,
    acceptanceAccepted,
  });
  const workflowRepair = buildClientWorkflowRepairReport({
    normalized,
    ready,
    workflowState,
    routeState,
    primaryAction,
    severity,
    statusMessage,
    blockedReasons,
    requestAdoption,
    providerReplayHandoff,
    boundaryBlockedReasons,
    providerBlockedReasons,
    acceptanceRequired,
    acceptanceAccepted,
    runtimeAdoption,
  });

  return {
    protocol: 'aios.compile-cache-client-workflow-handoff.mailchimp.v1',
    namespace: normalized.namespace,
    cacheKey: normalized.cacheKey,
    requestKey: normalized.requestKey,
    status: normalized.status,
    replayed: normalized.replayed,
    ready,
    workflowState,
    statusRouteState: routeState,
    primaryAction,
    recoveryCommand: ready ? 'observe' : primaryAction,
    canReplayCachedDescriptor: ready,
    severity,
    statusMessage,
    workflowRepair,
    clientState: {
      visibleStatus: runtimeAdoption.visibleStatus,
      handoffStage: ready ? 'runtime_replay' : 'operator_or_provider_recovery',
      statusMessage,
      severity,
      ttlRemainingMs: normalized.ttlRemainingMs,
      stale: normalized.stale,
      diagnosticsVisible: diagnosticErrors > 0,
      requestBound: requestAdoption.adopted,
      requestBindingState: requestAdoption.state,
      providerReplayState: providerReplayHandoff.state,
      lifecycleCommandState: lifecycleCommandCheckpoint.state,
      lifecycleCommandNextAction: lifecycleCommandCheckpoint.nextAction,
      sessionId: requestAdoption.sessionId,
      viewId: requestAdoption.viewId,
      routeIntent: runtimeAdoption.routeIntent,
      focusedAction: runtimeAdoption.focusedAction,
      actionQueue: runtimeAdoption.actionQueue,
      workflowRepair: workflowRepair.clientPatch,
      lifecycleCommandCheckpoint: lifecycleCommandCheckpoint.clientPatch,
      telemetry: runtimeAdoption.telemetry,
      blockedReasons,
    },
    requestState: {
      sourceHash: normalized.sourceHash,
      optionsHash: normalized.optionsHash,
      contractHash: normalized.contractHash,
      idempotencyKey: idempotencyParts.join(':'),
      restartSafe: runtimeAdoption.handoff.restartSafe,
      replayed: normalized.replayed,
      adoption: requestAdoption,
      runtimeAdoption,
      workflowRepair,
      lifecycleCommandCheckpoint,
    },
    runtimeData: {
      provider: compactString(providerContract.provider || 'mailchimp'),
      service: compactString(providerContract.service || 'mailchimp-marketing'),
      primaryResource: compactString(providerContract.primaryResource || 'audience'),
      resourceKinds: stableList(providerContract.resourceKinds),
      providerSyncState: compactString(providerSync.state || 'unknown'),
      providerRestartSafe: providerSync.restartSafe === true,
      externalHandoffState: compactString(providerSync.externalHandoffState || 'local_only'),
      externalRequestId: compactString(providerSync.externalRequestId),
      cursorRequired: providerSync.cursorRequired === true,
      cursorPresent: Boolean(providerSync.cursor || providerSync.cursorPresent),
      providerReplayHandoff,
      lifecycleCommandCheckpoint,
      providerNextAction: compactString(providerContract.negotiation?.nextAction || providerSync.replayPolicy),
      adapterStatusPayload: {
        protocol: 'aios.compile-cache-adapter-status.mailchimp.v1',
        provider: compactString(providerContract.provider || 'mailchimp'),
        service: compactString(providerContract.service || 'mailchimp-marketing'),
        state: ready ? 'ready' : workflowState,
        severity,
        message: statusMessage,
        requestId: requestAdoption.requestId,
        sessionId: requestAdoption.sessionId,
        handoffKey: requestAdoption.handoffKey,
        externalRequestId: compactString(providerSync.externalRequestId),
        providerReplay: providerReplayHandoff.statusPayload,
        lifecycleCommandCheckpoint,
        nextAction: primaryAction,
        focusedAction: runtimeAdoption.focusedAction,
        actionQueue: runtimeAdoption.actionQueue,
        routeIntent: runtimeAdoption.routeIntent,
        clientTelemetry: runtimeAdoption.telemetry,
        workflowRepair,
        blockedReasons,
      },
      runtimeAdoption,
    },
    boundaryState: {
      tenant: compactString(boundaryScope.tenant),
      workspace: compactString(boundaryScope.workspace),
      runtimeTenant: compactString(boundaryCheckpoint.runtimeTenant),
      runtimeWorkspace: compactString(boundaryCheckpoint.runtimeWorkspace),
      scope: compactString(boundaryScope.scope || 'tenant'),
      allowed: boundaryScope.allowed !== false && boundaryCheckpoint.ready !== false,
      checkpointState: compactString(boundaryCheckpoint.state),
      restartSafe: boundaryCheckpoint.restartSafe === true,
      replayAllowed: boundaryCheckpoint.replayAllowed === true,
      nextAction: compactString(boundaryCheckpoint.nextAction),
      auditDecision: compactString(boundaryCheckpoint.audit?.decision || boundaryScope.audit?.decision),
      blockedReasons: boundaryBlockedReasons,
    },
    acceptance: {
      required: acceptanceRequired,
      accepted: acceptanceAccepted,
      acceptedBy: compactString(normalized.acceptance.acceptedBy),
      acceptedAt: compactString(normalized.acceptance.acceptedAt),
      reason: compactString(normalized.acceptance.reason || (acceptanceRequired ? blockedReasons[0] : '')),
    },
    nextSteps: runtimeAdoption.actionQueue.map((action) => ({
      action: action.command,
      reason: action.reason,
      owner: action.owner,
      handoffKey: action.handoffKey,
      routeState: action.routeState,
      phase: action.phase,
      idempotencyKey: action.idempotencyKey,
    })),
    runtimeAdoption,
    workflowRepair,
    providerReplayHandoff,
    lifecycleCommandCheckpoint,
    blockedReasons,
  };
}

function summarizeEntry(entry, now) {
  const providerSyncCheckpoint = cloneContract(entry.providerSyncCheckpoint);
  const providerServiceContract = cloneContract(
    entry.providerServiceContract
      || entry.providerSyncCheckpoint?.providerServiceContract
      || buildMailchimpCompileCacheProviderServiceContract(entry.descriptor),
  );
  const boundaryScope = cloneContract(entry.boundaryScope || normalizeBoundaryScope(entry.descriptor));
  const boundaryCheckpoint = cloneContract(
    entry.boundaryCheckpoint
      || buildMailchimpCompileCacheBoundaryCheckpoint({ descriptor: entry.descriptor, boundaryScope }),
  );
  const baseSummary = {
    key: entry.key,
    cacheKey: entry.key,
    namespace: entry.namespace,
    requestKey: entry.identity.requestKey,
    sourceHash: entry.identity.sourceHash,
    optionsHash: entry.identity.optionsHash,
    contractHash: entry.identity.contractHash,
    stale: entry.stale || isExpired(entry, now),
    replayed: entry.replayed === true,
    ttlRemainingMs: entry.expiresAt == null ? null : Math.max(0, entry.expiresAt - now),
    diagnostics: entry.diagnostics,
    providerSyncCheckpoint,
    providerServiceContract,
    boundaryScope,
    boundaryCheckpoint,
  };

  return {
    key: entry.key,
    namespace: entry.namespace,
    tags: entry.tags,
    sourceHash: entry.identity.sourceHash,
    optionsHash: entry.identity.optionsHash,
    contractHash: entry.identity.contractHash,
    requestKey: entry.identity.requestKey,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    lastAccessedAt: entry.lastAccessedAt,
    expiresAt: entry.expiresAt,
    ageMs: Math.max(0, now - entry.createdAt),
    ttlRemainingMs: entry.expiresAt == null ? null : Math.max(0, entry.expiresAt - now),
    hits: entry.hits,
    stale: entry.stale || isExpired(entry, now),
    diagnostics: entry.diagnostics,
    providerSyncCheckpoint,
    providerServiceContract,
    boundaryScope,
    boundaryCheckpoint,
    clientWorkflowHandoff: buildMailchimpCompileCacheClientWorkflowHandoff(baseSummary),
  };
}

function normalizeCacheEvent(event = {}, index = 0) {
  return {
    index,
    at: positiveInteger(event.at ?? event.time ?? event.timestamp, index),
    kind: compactString(event.kind || event.type || 'observed'),
    key: compactString(event.key),
    namespace: compactString(event.namespace),
    status: compactString(event.status || 'observed'),
    reason: compactString(event.reason),
    requestKey: compactString(event.requestKey),
    sourceHash: compactString(event.sourceHash),
    contractHash: compactString(event.contractHash),
  };
}

function summarizeCacheTimeline(events = []) {
  const normalized = events.map(normalizeCacheEvent);
  const latest = normalized[normalized.length - 1] || null;
  const first = normalized[0] || null;
  const byKind = normalized.reduce((counts, event) => {
    counts[event.kind] = (counts[event.kind] || 0) + 1;
    return counts;
  }, {});
  const byStatus = normalized.reduce((counts, event) => {
    counts[event.status] = (counts[event.status] || 0) + 1;
    return counts;
  }, {});

  return {
    totalEvents: normalized.length,
    firstAt: first?.at ?? null,
    latestAt: latest?.at ?? null,
    latestKind: latest?.kind || null,
    latestStatus: latest?.status || null,
    eventsByKind: byKind,
    eventsByStatus: byStatus,
    events: normalized,
  };
}

function normalizeAnalyticsCounters(counters = {}) {
  return {
    entries: positiveInteger(counters.entries, 0),
    staleEntries: positiveInteger(counters.staleEntries, 0),
    expiredEntries: positiveInteger(counters.expiredEntries, 0),
    totalEntryHits: positiveInteger(counters.totalEntryHits, 0),
    lookupEvents: positiveInteger(counters.lookupEvents, 0),
    hitEvents: positiveInteger(counters.hitEvents, 0),
    missEvents: positiveInteger(counters.missEvents, 0),
    storeEvents: positiveInteger(counters.storeEvents, 0),
    evictionEvents: positiveInteger(counters.evictionEvents, counters.evictEvents || 0),
    invalidationEvents: positiveInteger(counters.invalidationEvents, counters.invalidateEvents || 0),
    diagnosticErrors: positiveInteger(counters.diagnosticErrors, counters.errorEntries || 0),
    diagnosticWarnings: positiveInteger(counters.diagnosticWarnings, 0),
    diagnosticsTotal: positiveInteger(counters.diagnosticsTotal, 0),
    boundaryBlockedEntries: positiveInteger(counters.boundaryBlockedEntries, 0),
    providerBlockedEntries: positiveInteger(counters.providerBlockedEntries, 0),
    clientWorkflowBlockedEntries: positiveInteger(counters.clientWorkflowBlockedEntries, counters.workflowBlockedEntries || 0),
    clientWorkflowWaitingEntries: positiveInteger(counters.clientWorkflowWaitingEntries, counters.workflowWaitingEntries || 0),
  };
}

function deriveCacheReportingState(parts = {}) {
  const counters = normalizeAnalyticsCounters(parts.counters);
  const blockedReasons = stableList(parts.blockedReasons);
  const latestStatus = compactString(parts.latestStatus);
  const latestKind = compactString(parts.latestKind);
  const exportReady = parts.exportReady === true && blockedReasons.length === 0;
  const hasLookupTraffic = counters.lookupEvents > 0;
  const hasFailures = counters.diagnosticErrors > 0
    || counters.staleEntries > 0
    || counters.boundaryBlockedEntries > 0
    || counters.providerBlockedEntries > 0
    || blockedReasons.length > 0;

  return {
    state: exportReady
      ? 'export_ready'
      : hasFailures
        ? 'needs_attention'
        : hasLookupTraffic
          ? 'warming'
          : 'observing',
    exportReady,
    hasLookupTraffic,
    hasFailures,
    latestStatus: latestStatus || null,
    latestKind: latestKind || null,
    nextAction: exportReady
      ? 'deliver_compile_cache_export'
      : counters.staleEntries > 0
        ? 'refresh_compile_cache'
        : counters.diagnosticErrors > 0
          ? 'repair_cached_descriptor'
          : counters.boundaryBlockedEntries > 0
            ? 'repair_tenant_permissions'
            : counters.providerBlockedEntries > 0
              ? 'refresh_provider_sync_before_replay'
              : blockedReasons.includes('operator_acceptance_missing')
                ? 'request_compile_cache_acceptance'
                : hasLookupTraffic
                  ? 'observe_compile_cache_trend'
                  : 'observe',
  };
}

function buildCacheHistorySnapshots(events = [], baseCounters = {}) {
  const running = normalizeAnalyticsCounters(baseCounters);
  Object.keys(running).forEach((key) => { running[key] = 0; });

  return events.map((event, index) => {
    if (event.kind === 'lookup') {
      running.lookupEvents += 1;
      if (event.status === 'hit') running.hitEvents += 1;
      if (event.status === 'miss') running.missEvents += 1;
    }
    if (event.kind === 'store') running.storeEvents += 1;
    if (event.kind === 'evict') running.evictionEvents += 1;
    if (event.kind === 'invalidate') running.invalidationEvents += 1;

    return {
      sequence: index,
      at: event.at,
      kind: event.kind,
      status: event.status,
      key: event.key,
      reason: event.reason,
      requestKey: event.requestKey,
      counters: {
        lookupEvents: running.lookupEvents,
        hitEvents: running.hitEvents,
        missEvents: running.missEvents,
        storeEvents: running.storeEvents,
        evictionEvents: running.evictionEvents,
        invalidationEvents: running.invalidationEvents,
      },
      ratios: {
        hitRate: running.lookupEvents === 0 ? null : Number((running.hitEvents / running.lookupEvents).toFixed(4)),
      },
    };
  });
}

export function buildMailchimpCompileCacheHistoryReport(source = {}, options = {}) {
  const now = nowFrom(options);
  const namespace = compactString(source.namespace || source.snapshot?.namespace || 'mailchimp');
  const entries = Array.isArray(source.entries)
    ? source.entries
    : Array.isArray(source.snapshot?.entries)
      ? source.snapshot.entries
      : [];
  const analytics = source.analytics && typeof source.analytics === 'object'
    ? source.analytics
    : source.snapshot?.analytics && typeof source.snapshot.analytics === 'object'
      ? source.snapshot.analytics
      : {};
  const rawEvents = Array.isArray(source.events)
    ? source.events
    : Array.isArray(source.history?.events)
      ? source.history.events
      : [];
  const timeline = summarizeCacheTimeline(rawEvents);
  const counters = normalizeAnalyticsCounters({
    ...(analytics.counters || {}),
    entries: entries.length,
    staleEntries: entries.filter((entry) => entry.stale === true).length,
    expiredEntries: entries.filter((entry) => entry.expiresAt != null && now >= entry.expiresAt).length,
    totalEntryHits: entries.reduce((total, entry) => total + positiveInteger(entry.hits, 0), 0),
    boundaryBlockedEntries: entries.filter((entry) => (
      entry.boundaryScope?.allowed === false || entry.boundaryScope?.blockedReasons?.length > 0
    )).length,
    providerBlockedEntries: entries.filter((entry) => (
      entry.providerSyncCheckpoint?.restartSafe === false
        || entry.providerSyncCheckpoint?.blockedReasons?.length > 0
    )).length,
    clientWorkflowBlockedEntries: entries.filter((entry) => (
      entry.clientWorkflowHandoff?.ready === false || entry.clientWorkflowHandoff?.blockedReasons?.length > 0
    )).length,
    clientWorkflowWaitingEntries: entries.filter((entry) => (
      entry.clientWorkflowHandoff?.workflowState === 'waiting_for_acceptance'
    )).length,
  });
  const diagnosticEntries = entries.filter((entry) => (entry.diagnostics?.errors || 0) > 0);
  const blockedReasons = stableList([
    ...(counters.staleEntries > 0 ? ['stale_entries'] : []),
    ...(diagnosticEntries.length > 0 ? ['diagnostic_errors'] : []),
    ...(counters.boundaryBlockedEntries > 0 ? ['tenant_boundary_blocked'] : []),
    ...(counters.providerBlockedEntries > 0 ? ['provider_sync_not_restart_safe'] : []),
    ...(counters.clientWorkflowBlockedEntries > 0 ? ['client_workflow_handoff_blocked'] : []),
  ]);
  const exportReady = blockedReasons.length === 0;
  const snapshots = buildCacheHistorySnapshots(timeline.events, counters);
  const latestSnapshot = snapshots[snapshots.length - 1] || null;
  const reportingState = deriveCacheReportingState({
    counters,
    blockedReasons,
    exportReady,
    latestStatus: timeline.latestStatus,
    latestKind: timeline.latestKind,
  });

  return {
    protocol: 'aios.compile-cache-history.mailchimp.v1',
    namespace,
    generatedAt: now,
    exportReady,
    blockedReasons,
    counters,
    ratios: {
      hitRate: counters.lookupEvents === 0 ? null : Number((counters.hitEvents / counters.lookupEvents).toFixed(4)),
      staleEntryRate: counters.entries === 0 ? 0 : Number((counters.staleEntries / counters.entries).toFixed(4)),
      diagnosticEntryRate: counters.entries === 0 ? 0 : Number((diagnosticEntries.length / counters.entries).toFixed(4)),
    },
    timeline: {
      ...timeline,
      snapshotCount: snapshots.length,
      latestSnapshotAt: latestSnapshot?.at ?? null,
    },
    reportingState,
    snapshots,
    exportSummary: {
      ready: exportReady,
      nextAction: reportingState.nextAction,
      generatedAt: now,
      latestEventAt: timeline.latestAt,
      latestEventKind: timeline.latestKind,
      latestEventStatus: timeline.latestStatus,
      manifestEntryCount: entries.length,
    },
  };
}

function normalizeCacheLifecycleSettings(source = {}) {
  const controls = source.controls && typeof source.controls === 'object' ? source.controls : {};
  const schedule = source.schedule && typeof source.schedule === 'object' ? source.schedule : {};
  const rawCommand = compactString(
    source.command
      || source.nextCommand
      || controls.command
      || controls.nextCommand
      || 'observe',
  ).toLowerCase().replaceAll('-', '_');
  const rawMode = compactString(
    schedule.mode
      || source.scheduleMode
      || controls.scheduleMode
      || 'manual',
  ).toLowerCase().replaceAll('-', '_');

  return {
    enabled: source.enabled !== false && controls.enabled !== false,
    command: CACHE_LIFECYCLE_COMMANDS.has(rawCommand) ? rawCommand : rawCommand.replaceAll('_', '-'),
    schedule: {
      mode: CACHE_SCHEDULE_MODES.has(rawMode) ? rawMode : 'manual',
      runAt: compactString(schedule.runAt || schedule.nextRunAt || source.runAt || source.nextRunAt),
      timezone: compactString(schedule.timezone || source.timezone || 'UTC') || 'UTC',
      cooldownMs: positiveInteger(schedule.cooldownMs ?? source.cooldownMs ?? source.cooldown, 0),
    },
    controls: {
      allowRefresh: controls.allowRefresh !== false,
      allowEvictStale: controls.allowEvictStale !== false,
      allowExport: controls.allowExport !== false,
      requireCleanExport: controls.requireCleanExport !== false,
      operatorHold: controls.operatorHold === true || source.operatorHold === true,
    },
  };
}

function normalizeSnapshotForLifecycle(snapshot = {}, now = Date.now()) {
  const entries = Array.isArray(snapshot.entries) ? snapshot.entries : [];
  const analytics = snapshot.analytics && typeof snapshot.analytics === 'object' ? snapshot.analytics : {};
  const exportSummary = snapshot.exportSummary && typeof snapshot.exportSummary === 'object'
    ? snapshot.exportSummary
    : buildMailchimpCompileCacheExportSummary({
      protocol: snapshot.protocol || 'aios.compile-cache-snapshot.mailchimp.v1',
      namespace: snapshot.namespace || 'mailchimp',
      entries,
      analytics,
    });

  return {
    namespace: compactString(snapshot.namespace || 'mailchimp'),
    entries,
    analytics,
    exportSummary,
    now,
  };
}

function validateCacheLifecycleSettings(settings, snapshot) {
  const diagnostics = [];
  const scheduledAt = parseLifecycleScheduleTime(settings.schedule.runAt);
  if (!CACHE_LIFECYCLE_COMMANDS.has(settings.command)) {
    diagnostics.push({
      code: 'mailchimp.compile_cache.lifecycle.unsupported_command',
      severity: 'error',
      field: 'compileCache.lifecycle.command',
      message: `Unsupported Mailchimp compile cache lifecycle command "${settings.command}".`,
    });
  }
  if (settings.schedule.mode === 'scheduled' && !settings.schedule.runAt) {
    diagnostics.push({
      code: 'mailchimp.compile_cache.lifecycle.missing_schedule_time',
      severity: 'error',
      field: 'compileCache.lifecycle.schedule.runAt',
      message: 'Scheduled Mailchimp compile cache lifecycle commands require a runAt value.',
    });
  }
  if (settings.schedule.mode === 'scheduled' && settings.schedule.runAt && scheduledAt.valid === false) {
    diagnostics.push({
      code: 'mailchimp.compile_cache.lifecycle.invalid_schedule_time',
      severity: 'error',
      field: 'compileCache.lifecycle.schedule.runAt',
      message: 'Scheduled Mailchimp compile cache lifecycle commands require a parseable runAt value.',
    });
  }
  if (settings.enabled === false && ['refresh', 'evict_stale', 'export'].includes(settings.command)) {
    diagnostics.push({
      code: 'mailchimp.compile_cache.lifecycle.disabled_command_blocked',
      severity: 'warning',
      field: 'compileCache.lifecycle.enabled',
      message: `Compile cache command "${settings.command}" is held while cache lifecycle controls are disabled.`,
    });
  }
  if (settings.command === 'refresh' && settings.controls.allowRefresh === false) {
    diagnostics.push({
      code: 'mailchimp.compile_cache.lifecycle.refresh_disabled',
      severity: 'error',
      field: 'compileCache.lifecycle.controls.allowRefresh',
      message: 'Compile cache refresh is disabled by lifecycle controls.',
    });
  }
  if (settings.command === 'evict_stale' && settings.controls.allowEvictStale === false) {
    diagnostics.push({
      code: 'mailchimp.compile_cache.lifecycle.evict_stale_disabled',
      severity: 'error',
      field: 'compileCache.lifecycle.controls.allowEvictStale',
      message: 'Compile cache stale eviction is disabled by lifecycle controls.',
    });
  }
  if (settings.command === 'export' && settings.controls.allowExport === false) {
    diagnostics.push({
      code: 'mailchimp.compile_cache.lifecycle.export_disabled',
      severity: 'error',
      field: 'compileCache.lifecycle.controls.allowExport',
      message: 'Compile cache export is disabled by lifecycle controls.',
    });
  }
  if (
    settings.command === 'export'
    && settings.controls.requireCleanExport
    && snapshot.exportSummary.exportReady === false
  ) {
    diagnostics.push({
      code: 'mailchimp.compile_cache.lifecycle.export_not_clean',
      severity: 'warning',
      field: 'compileCache.lifecycle.controls.requireCleanExport',
      message: 'Compile cache export is waiting for stale entries or descriptor diagnostics to clear.',
    });
  }
  return diagnostics;
}

function parseLifecycleScheduleTime(value) {
  if (value == null || value === '') {
    return {
      raw: '',
      at: null,
      valid: true,
      source: 'empty',
    };
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return {
      raw: value,
      at: Math.max(0, Math.floor(value)),
      valid: true,
      source: 'epoch_ms',
    };
  }
  const raw = compactString(value);
  if (!raw) {
    return {
      raw,
      at: null,
      valid: true,
      source: 'empty',
    };
  }
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) {
    return {
      raw,
      at: Math.max(0, Math.floor(numeric)),
      valid: true,
      source: 'epoch_ms',
    };
  }
  const parsed = Date.parse(raw);
  return {
    raw,
    at: Number.isFinite(parsed) ? parsed : null,
    valid: Number.isFinite(parsed),
    source: 'date_time',
  };
}

function latestLifecycleActivityAt(snapshot = {}) {
  const candidates = [
    snapshot.analytics?.timeline?.latestAt,
    snapshot.exportSummary?.timeline?.latestAt,
    snapshot.exportSummary?.generatedAt,
    ...snapshot.entries.map((entry) => entry.updatedAt),
    ...snapshot.entries.map((entry) => entry.lastAccessedAt),
  ]
    .map((value) => Number(value))
    .filter(Number.isFinite)
    .map((value) => Math.max(0, Math.floor(value)));
  return candidates.length === 0 ? null : Math.max(...candidates);
}

function deriveLifecycleCandidateCommand(lifecycle, metrics) {
  if (lifecycle.command === 'observe' && lifecycle.schedule.mode === 'automatic') {
    if (metrics.diagnosticEntries.length > 0) return 'refresh';
    if (metrics.expiredEntries.length > 0) return 'evict_stale';
    if (metrics.staleEntries.length > 0) return 'refresh';
    if (metrics.exportReady && lifecycle.controls.allowExport) return 'export';
  }
  if (lifecycle.command === 'refresh' && lifecycle.controls.allowRefresh) return 'refresh';
  if (lifecycle.command === 'evict_stale' && lifecycle.controls.allowEvictStale) return 'evict_stale';
  if (lifecycle.command === 'export' && lifecycle.controls.allowExport) return 'export';
  return lifecycle.command;
}

function buildLifecycleExecutionPlan({
  lifecycle,
  snapshot,
  diagnostics,
  metrics,
  now,
}) {
  const scheduledAt = parseLifecycleScheduleTime(lifecycle.schedule.runAt);
  const latestActivityAt = latestLifecycleActivityAt(snapshot);
  const cooldownUntil = lifecycle.schedule.cooldownMs > 0 && latestActivityAt != null
    ? latestActivityAt + lifecycle.schedule.cooldownMs
    : null;
  const scheduleDue = lifecycle.schedule.mode === 'scheduled'
    ? scheduledAt.valid === true && scheduledAt.at != null && scheduledAt.at <= now
    : true;
  const cooldownDue = cooldownUntil == null || cooldownUntil <= now;
  const disabledForCommand = lifecycle.enabled === false && lifecycle.command !== 'enable';
  const operatorHold = lifecycle.controls.operatorHold === true && lifecycle.command !== 'enable';
  const settingsBlocked = diagnostics.some((diagnostic) => diagnostic.severity === 'error');
  const cleanExportBlocked = lifecycle.command === 'export'
    && lifecycle.controls.requireCleanExport
    && metrics.exportReady === false;
  const blockedReasons = stableList([
    ...(settingsBlocked ? ['invalid_lifecycle_settings'] : []),
    ...(disabledForCommand ? ['lifecycle_disabled'] : []),
    ...(operatorHold ? ['operator_hold'] : []),
    ...(cleanExportBlocked ? ['export_not_clean'] : []),
  ]);
  const deferredReasons = stableList([
    ...(lifecycle.schedule.mode === 'scheduled' && scheduledAt.valid === true && scheduledAt.at != null && scheduledAt.at > now
      ? ['schedule_not_due']
      : []),
    ...(lifecycle.schedule.mode === 'automatic' && !cooldownDue ? ['cooldown_active'] : []),
  ]);
  const candidateCommand = deriveLifecycleCandidateCommand(lifecycle, metrics);
  const executable = blockedReasons.length === 0 && deferredReasons.length === 0;
  const commandAction = candidateCommand === 'hold'
    ? 'hold_compile_cache'
    : candidateCommand === 'disable'
      ? 'disable_compile_cache_lifecycle'
      : candidateCommand === 'enable'
        ? 'enable_compile_cache_lifecycle'
        : candidateCommand === 'refresh'
          ? 'refresh_compile_cache'
          : candidateCommand === 'evict_stale'
            ? 'evict_stale_compile_cache_entries'
            : candidateCommand === 'export'
              ? 'export_compile_cache_summary'
              : 'reuse_compile_cache';
  const nextEligibleAt = blockedReasons.length > 0
    ? null
    : lifecycle.schedule.mode === 'scheduled'
      ? scheduledAt.at
      : cooldownUntil;
  const delayMs = nextEligibleAt == null ? 0 : Math.max(0, nextEligibleAt - now);

  return {
    protocol: 'aios.compile-cache-lifecycle-execution-plan.mailchimp.v1',
    state: blockedReasons.length > 0
      ? 'blocked'
      : deferredReasons.length > 0
        ? 'deferred'
        : candidateCommand === 'observe'
          ? 'idle'
          : 'due',
    executable,
    requestedCommand: lifecycle.command,
    candidateCommand,
    commandAction,
    nextAction: executable ? commandAction : deferredReasons.length > 0 ? 'wait_for_compile_cache_schedule' : null,
    schedule: {
      mode: lifecycle.schedule.mode,
      runAt: lifecycle.schedule.runAt || null,
      scheduledAt: scheduledAt.at,
      scheduleTimeSource: scheduledAt.source,
      scheduleTimeValid: scheduledAt.valid,
      timezone: lifecycle.schedule.timezone,
      due: scheduleDue,
      nextEligibleAt,
      delayMs,
    },
    cooldown: {
      cooldownMs: lifecycle.schedule.cooldownMs,
      latestActivityAt,
      cooldownUntil,
      due: cooldownDue,
      remainingMs: cooldownUntil == null ? 0 : Math.max(0, cooldownUntil - now),
    },
    blockedReasons,
    deferredReasons,
    idempotencyParts: stableList([
      snapshot.namespace,
      lifecycle.command,
      candidateCommand,
      lifecycle.schedule.mode,
      scheduledAt.at == null ? '' : `scheduled:${scheduledAt.at}`,
      cooldownUntil == null ? '' : `cooldown:${cooldownUntil}`,
      `entries:${snapshot.entries.length}`,
    ]),
  };
}

function deriveLifecycleEffectiveSettings(lifecycle, executionPlan) {
  const effectiveEnabled = lifecycle.command === 'enable'
    ? true
    : lifecycle.command === 'disable'
      ? false
      : lifecycle.enabled;
  const effectiveOperatorHold = lifecycle.command === 'hold'
    ? true
    : lifecycle.command === 'enable'
      ? false
      : lifecycle.controls.operatorHold;
  const effectiveMode = lifecycle.command === 'disable'
    ? 'manual'
    : lifecycle.schedule.mode;

  return {
    enabled: effectiveEnabled,
    command: executionPlan.candidateCommand,
    schedule: {
      ...lifecycle.schedule,
      mode: effectiveMode,
      runAt: lifecycle.command === 'disable' ? '' : lifecycle.schedule.runAt,
    },
    controls: {
      ...lifecycle.controls,
      operatorHold: effectiveOperatorHold,
    },
  };
}

function buildLifecycleMutationSet({
  lifecycle,
  executionPlan,
  metrics,
  diagnostics,
  effectiveSettings,
}) {
  const settingsMutation = [];
  if (lifecycle.command === 'enable' && lifecycle.enabled === false) {
    settingsMutation.push({
      path: 'compileCache.lifecycle.enabled',
      from: false,
      to: true,
      reason: 'enable_command',
    });
  }
  if (lifecycle.command === 'disable' && lifecycle.enabled === true) {
    settingsMutation.push({
      path: 'compileCache.lifecycle.enabled',
      from: true,
      to: false,
      reason: 'disable_command',
    });
  }
  if (lifecycle.command === 'hold' && lifecycle.controls.operatorHold === false) {
    settingsMutation.push({
      path: 'compileCache.lifecycle.controls.operatorHold',
      from: false,
      to: true,
      reason: 'hold_command',
    });
  }
  if (lifecycle.command === 'enable' && lifecycle.controls.operatorHold === true) {
    settingsMutation.push({
      path: 'compileCache.lifecycle.controls.operatorHold',
      from: true,
      to: false,
      reason: 'enable_command_releases_operator_hold',
    });
  }
  if (lifecycle.command === 'disable' && lifecycle.schedule.mode !== 'manual') {
    settingsMutation.push({
      path: 'compileCache.lifecycle.schedule.mode',
      from: lifecycle.schedule.mode,
      to: 'manual',
      reason: 'disable_command_stops_scheduler',
    });
  }
  if (lifecycle.command === 'disable' && lifecycle.schedule.runAt) {
    settingsMutation.push({
      path: 'compileCache.lifecycle.schedule.runAt',
      from: lifecycle.schedule.runAt,
      to: '',
      reason: 'disable_command_clears_pending_run',
    });
  }

  const cacheMutation = [
    ...(executionPlan.candidateCommand === 'refresh'
      ? stableList([
        ...metrics.staleEntries,
        ...metrics.expiredEntries,
        ...metrics.diagnosticEntries,
      ]).map((key) => ({
        operation: 'refresh_descriptor',
        key,
        reason: metrics.diagnosticEntries.includes(key)
          ? 'diagnostic_errors'
          : metrics.expiredEntries.includes(key)
            ? 'expired_entry'
            : 'stale_entry',
      }))
      : []),
    ...(executionPlan.candidateCommand === 'evict_stale'
      ? stableList([
        ...metrics.staleEntries,
        ...metrics.expiredEntries,
      ]).map((key) => ({
        operation: 'evict_entry',
        key,
        reason: metrics.expiredEntries.includes(key) ? 'expired_entry' : 'stale_entry',
      }))
      : []),
    ...(executionPlan.candidateCommand === 'export'
      ? [{
        operation: 'export_summary',
        key: '',
        reason: metrics.exportReady ? 'export_ready' : 'export_waiting_for_clean_cache',
      }]
      : []),
  ];

  return {
    settingsMutation,
    cacheMutation,
    diagnosticMutation: diagnostics
      .filter((diagnostic) => diagnostic.severity === 'error')
      .map((diagnostic) => ({
        operation: 'repair_lifecycle_setting',
        key: diagnostic.field,
        reason: diagnostic.code,
      })),
    effectiveSettings,
  };
}

function deriveLifecycleCommandWorkload(command, metrics = {}, mutations = {}) {
  const settingsMutation = Array.isArray(mutations.settingsMutation) ? mutations.settingsMutation : [];
  const cacheMutation = Array.isArray(mutations.cacheMutation) ? mutations.cacheMutation : [];
  const diagnosticMutation = Array.isArray(mutations.diagnosticMutation) ? mutations.diagnosticMutation : [];
  const staleEntries = stableList(metrics.staleEntries);
  const expiredEntries = stableList(metrics.expiredEntries);
  const diagnosticEntries = stableList(metrics.diagnosticEntries);

  if (command === 'refresh') {
    return {
      command,
      targetCount: stableList([...staleEntries, ...expiredEntries, ...diagnosticEntries]).length,
      mutationCount: cacheMutation.length,
      targetKinds: stableList([
        ...(staleEntries.length > 0 ? ['stale_entries'] : []),
        ...(expiredEntries.length > 0 ? ['expired_entries'] : []),
        ...(diagnosticEntries.length > 0 ? ['diagnostic_entries'] : []),
      ]),
      noWorkReasons: cacheMutation.length > 0 ? [] : ['no_refresh_targets'],
    };
  }

  if (command === 'evict_stale') {
    return {
      command,
      targetCount: stableList([...staleEntries, ...expiredEntries]).length,
      mutationCount: cacheMutation.length,
      targetKinds: stableList([
        ...(staleEntries.length > 0 ? ['stale_entries'] : []),
        ...(expiredEntries.length > 0 ? ['expired_entries'] : []),
      ]),
      noWorkReasons: cacheMutation.length > 0 ? [] : ['no_stale_entries_to_evict'],
    };
  }

  if (command === 'export') {
    return {
      command,
      targetCount: metrics.exportReady === true ? 1 : 0,
      mutationCount: cacheMutation.length,
      targetKinds: metrics.exportReady === true ? ['export_manifest'] : [],
      noWorkReasons: metrics.exportReady === true ? [] : ['export_not_ready'],
    };
  }

  if (['enable', 'disable', 'hold'].includes(command)) {
    return {
      command,
      targetCount: settingsMutation.length,
      mutationCount: settingsMutation.length,
      targetKinds: settingsMutation.length > 0 ? ['lifecycle_settings'] : [],
      noWorkReasons: settingsMutation.length > 0 ? [] : [`${command}_already_effective`],
    };
  }

  return {
    command,
    targetCount: diagnosticMutation.length,
    mutationCount: diagnosticMutation.length,
    targetKinds: diagnosticMutation.length > 0 ? ['lifecycle_diagnostics'] : [],
    noWorkReasons: command === 'observe' ? ['observe_only'] : [],
  };
}

function buildLifecycleActionState({
  namespace,
  lifecycle,
  plan,
  metrics,
  diagnostics,
  mutations,
  effectiveSettings,
}) {
  const candidateCommand = compactString(plan.candidateCommand || lifecycle.command || 'observe');
  const workload = deriveLifecycleCommandWorkload(candidateCommand, metrics, mutations);
  const errorCodes = diagnostics
    .filter((diagnostic) => diagnostic.severity === 'error')
    .map((diagnostic) => diagnostic.code);
  const warningCodes = diagnostics
    .filter((diagnostic) => diagnostic.severity === 'warning')
    .map((diagnostic) => diagnostic.code);
  const blockedReasons = stableList([
    ...(Array.isArray(plan.blockedReasons) ? plan.blockedReasons : []),
    ...errorCodes,
  ]);
  const deferredReasons = stableList(plan.deferredReasons);
  const noWorkReasons = stableList(workload.noWorkReasons);
  const noWork = plan.state !== 'blocked'
    && plan.state !== 'deferred'
    && candidateCommand !== 'observe'
    && workload.mutationCount === 0;
  const runnable = plan.executable === true
    && plan.state === 'due'
    && blockedReasons.length === 0
    && deferredReasons.length === 0
    && noWork === false
    && candidateCommand !== 'observe';
  const state = blockedReasons.length > 0
    ? 'blocked'
    : deferredReasons.length > 0
      ? 'deferred'
      : candidateCommand === 'observe'
        ? 'observing'
        : noWork
          ? 'no_work'
          : runnable
            ? 'ready_to_run'
            : 'accepted';
  const recoveryCommand = state === 'blocked'
    ? 'repair_compile_cache_lifecycle_settings'
    : state === 'deferred'
      ? 'wait_for_compile_cache_schedule'
      : state === 'no_work'
        ? 'observe'
        : runnable
          ? plan.commandAction
          : 'observe';
  const owner = state === 'blocked'
    ? 'compiler'
    : inferRecoveryCommandOwner(recoveryCommand);
  const routeState = state === 'blocked'
    ? 'blocked'
    : state === 'deferred'
      ? 'deferred'
      : runnable
        ? 'running'
        : 'ready';

  return {
    protocol: 'aios.compile-cache-lifecycle-action-state.mailchimp.v1',
    namespace: compactString(namespace || 'mailchimp'),
    state,
    accepted: blockedReasons.length === 0,
    runnable,
    noWork,
    requestedCommand: lifecycle.command,
    candidateCommand,
    commandAction: compactString(plan.commandAction || recoveryCommand),
    nextAction: recoveryCommand,
    recoveryCommand,
    owner,
    phase: inferRecoveryCommandPhase(recoveryCommand, state),
    routeState,
    effectiveSettings: {
      enabled: effectiveSettings.enabled,
      command: effectiveSettings.command,
      scheduleMode: effectiveSettings.schedule.mode,
      runAt: effectiveSettings.schedule.runAt || null,
      operatorHold: effectiveSettings.controls.operatorHold,
    },
    workload: {
      targetCount: workload.targetCount,
      mutationCount: workload.mutationCount,
      targetKinds: workload.targetKinds,
      noWorkReasons,
    },
    schedule: {
      mode: plan.schedule?.mode || lifecycle.schedule.mode,
      due: plan.schedule?.due !== false,
      nextEligibleAt: plan.schedule?.nextEligibleAt ?? null,
      delayMs: positiveInteger(plan.schedule?.delayMs, 0),
      cooldownRemainingMs: positiveInteger(plan.cooldown?.remainingMs, 0),
    },
    blockedReasons,
    deferredReasons,
    warnings: warningCodes,
    handoff: {
      statusRouteState: routeState,
      primaryAction: recoveryCommand,
      recoveryCommand,
      owner,
      restartSafe: blockedReasons.length === 0 && state !== 'blocked',
      externalWriteSuppressed: state === 'blocked' || state === 'deferred' || state === 'no_work',
    },
    idempotencyKey: stableList([
      compactString(namespace || 'mailchimp'),
      lifecycle.command,
      candidateCommand,
      state,
      recoveryCommand,
      blockedReasons.join('|'),
      deferredReasons.join('|'),
      noWorkReasons.join('|'),
    ]).join(':'),
  };
}

function buildLifecycleControlPlane({
  namespace,
  lifecycle,
  plan,
  actionState,
  mutations,
  diagnostics,
  effectiveSettings,
}) {
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === 'warning');
  const settingMutations = Array.isArray(mutations.settingsMutation) ? mutations.settingsMutation : [];
  const cacheMutations = Array.isArray(mutations.cacheMutation) ? mutations.cacheMutation : [];
  const diagnosticMutations = Array.isArray(mutations.diagnosticMutation) ? mutations.diagnosticMutation : [];
  const blockedReasons = stableList([
    ...stableList(actionState.blockedReasons),
    ...errors.map((diagnostic) => diagnostic.code),
  ]);
  const deferredReasons = stableList(actionState.deferredReasons);
  const state = blockedReasons.length > 0
    ? 'blocked'
    : deferredReasons.length > 0
      ? 'scheduled'
      : actionState.runnable === true
        ? 'ready_to_apply'
        : actionState.noWork === true
          ? 'no_work'
          : 'accepted';
  const primaryAction = state === 'ready_to_apply'
    ? actionState.commandAction
    : state === 'scheduled'
      ? 'wait_for_compile_cache_schedule'
      : state === 'blocked'
        ? 'repair_compile_cache_lifecycle_settings'
        : actionState.nextAction || 'observe';
  const controlKey = stableHash({
    namespace,
    command: lifecycle.command,
    candidateCommand: actionState.candidateCommand,
    state,
    routeState: actionState.routeState,
    effectiveSettings,
    blockedReasons,
    deferredReasons,
  });

  return {
    protocol: 'aios.compile-cache-lifecycle-control-plane.mailchimp.v1',
    namespace: compactString(namespace || 'mailchimp'),
    controlKey: `compile-cache-lifecycle:${controlKey}`,
    state,
    routeState: state === 'blocked'
      ? 'blocked'
      : state === 'scheduled'
        ? 'deferred'
        : state === 'ready_to_apply'
          ? 'ready'
          : 'observing',
    readyForRuntimeReuse: state !== 'blocked',
    readyForMutation: state === 'ready_to_apply',
    commandAccepted: blockedReasons.length === 0,
    requestedCommand: lifecycle.command,
    candidateCommand: actionState.candidateCommand,
    primaryAction,
    nextAction: primaryAction,
    schedule: {
      mode: plan.schedule?.mode || lifecycle.schedule.mode,
      due: plan.schedule?.due !== false,
      nextEligibleAt: plan.schedule?.nextEligibleAt ?? null,
      delayMs: positiveInteger(plan.schedule?.delayMs, 0),
      deferredReasons,
    },
    controls: {
      enabled: effectiveSettings.enabled !== false,
      operatorHold: effectiveSettings.controls?.operatorHold === true,
      allowRefresh: effectiveSettings.controls?.allowRefresh !== false,
      allowEvictStale: effectiveSettings.controls?.allowEvictStale !== false,
      allowExport: effectiveSettings.controls?.allowExport !== false,
      requireCleanExport: effectiveSettings.controls?.requireCleanExport === true,
    },
    mutations: {
      settings: settingMutations.length,
      cache: cacheMutations.length,
      diagnostics: diagnosticMutations.length,
      targetKinds: stableList([
        ...settingMutations.map((mutation) => mutation.targetKind || 'lifecycle_settings'),
        ...cacheMutations.map((mutation) => mutation.targetKind || 'compile_cache'),
        ...diagnosticMutations.map((mutation) => mutation.targetKind || 'lifecycle_diagnostics'),
      ]),
    },
    diagnostics: {
      errors: errors.map((diagnostic) => diagnostic.code).sort(),
      warnings: warnings.map((diagnostic) => diagnostic.code).sort(),
    },
    blockedReasons,
    deferredReasons,
    clientPatch: {
      compileCacheLifecycleControlState: state,
      compileCacheLifecycleControlKey: `compile-cache-lifecycle:${controlKey}`,
      compileCacheLifecycleControlNextAction: primaryAction,
      compileCacheLifecycleControlRouteState: state === 'scheduled' ? 'deferred' : actionState.routeState,
      compileCacheLifecycleControlBlockedReasons: blockedReasons,
    },
    restartSemantics: {
      replaySafe: state !== 'blocked' && effectiveSettings.controls?.operatorHold !== true,
      duplicateCommandPolicy: 'dedupe-by-compile-cache-lifecycle-control-key',
      resumeFromLifecycleControlKey: `compile-cache-lifecycle:${controlKey}`,
      externalWritesPerformed: false,
    },
  };
}

export function buildMailchimpCompileCacheLifecycleControlContract({
  namespace = 'mailchimp',
  lifecycle = {},
  executionPlan = {},
  metrics = {},
  diagnostics = [],
  now = Date.now(),
} = {}) {
  const normalizedLifecycle = normalizeCacheLifecycleSettings(lifecycle);
  const normalizedMetrics = {
    staleEntries: stableList(metrics.staleEntries),
    expiredEntries: stableList(metrics.expiredEntries),
    diagnosticEntries: stableList(metrics.diagnosticEntries),
    exportReady: metrics.exportReady === true,
  };
  const plan = executionPlan.protocol === 'aios.compile-cache-lifecycle-execution-plan.mailchimp.v1'
    ? executionPlan
    : buildLifecycleExecutionPlan({
      lifecycle: normalizedLifecycle,
      snapshot: { namespace, entries: [], analytics: {}, exportSummary: {}, now },
      diagnostics,
      metrics: normalizedMetrics,
      now,
    });
  const effectiveSettings = deriveLifecycleEffectiveSettings(normalizedLifecycle, plan);
  const mutations = buildLifecycleMutationSet({
    lifecycle: normalizedLifecycle,
    executionPlan: plan,
    metrics: normalizedMetrics,
    diagnostics,
    effectiveSettings,
  });
  const actionState = buildLifecycleActionState({
    namespace,
    lifecycle: normalizedLifecycle,
    plan,
    metrics: normalizedMetrics,
    diagnostics,
    mutations,
    effectiveSettings,
  });
  const controlPlane = buildLifecycleControlPlane({
    namespace,
    lifecycle: normalizedLifecycle,
    plan,
    actionState,
    mutations,
    diagnostics,
    effectiveSettings,
  });
  const mutatesSettings = mutations.settingsMutation.length > 0;
  const mutatesCache = mutations.cacheMutation.length > 0;
  const repairsSettings = mutations.diagnosticMutation.length > 0;
  const willRun = actionState.runnable === true;
  const willChangeState = willRun && (mutatesSettings || mutatesCache || repairsSettings);
  const commandAccepted = actionState.accepted === true;
  const nextState = actionState.state === 'blocked'
    ? 'blocked'
    : actionState.state === 'deferred'
      ? 'scheduled'
      : actionState.state === 'no_work'
        ? 'observing'
      : willChangeState
        ? 'mutating'
        : actionState.candidateCommand === 'observe'
          ? 'observing'
          : 'ready';
  const nextAction = actionState.nextAction;

  return {
    protocol: 'aios.compile-cache-lifecycle-control.mailchimp.v1',
    namespace: compactString(namespace || 'mailchimp'),
    generatedAt: now,
    commandAccepted,
    requested: {
      command: normalizedLifecycle.command,
      enabled: normalizedLifecycle.enabled,
      scheduleMode: normalizedLifecycle.schedule.mode,
      runAt: normalizedLifecycle.schedule.runAt || null,
      operatorHold: normalizedLifecycle.controls.operatorHold,
    },
    effective: {
      enabled: effectiveSettings.enabled,
      command: effectiveSettings.command,
      scheduleMode: effectiveSettings.schedule.mode,
      runAt: effectiveSettings.schedule.runAt || null,
      operatorHold: effectiveSettings.controls.operatorHold,
    },
    state: {
      current: plan.state,
      next: nextState,
      executable: plan.executable === true,
      willRun,
      willChangeState,
      mutatesSettings,
      mutatesCache,
      repairsSettings,
      nextAction,
      routeState: actionState.routeState,
    },
    controlPlane,
    actionState,
    schedule: {
      mode: plan.schedule?.mode || normalizedLifecycle.schedule.mode,
      due: plan.schedule?.due !== false,
      nextEligibleAt: plan.schedule?.nextEligibleAt ?? null,
      delayMs: positiveInteger(plan.schedule?.delayMs, 0),
      cooldownRemainingMs: positiveInteger(plan.cooldown?.remainingMs, 0),
    },
    metrics: {
      staleEntries: normalizedMetrics.staleEntries.length,
      expiredEntries: normalizedMetrics.expiredEntries.length,
      diagnosticEntries: normalizedMetrics.diagnosticEntries.length,
      exportReady: normalizedMetrics.exportReady,
    },
    mutations,
    blockedReasons: stableList([
      ...(Array.isArray(plan.blockedReasons) ? plan.blockedReasons : []),
      ...diagnostics
        .filter((diagnostic) => diagnostic.severity === 'error')
        .map((diagnostic) => diagnostic.code),
    ]),
    deferredReasons: stableList(plan.deferredReasons),
    idempotencyKey: stableList([
      compactString(namespace || 'mailchimp'),
      normalizedLifecycle.command,
      plan.candidateCommand,
      nextState,
      ...plan.idempotencyParts,
    ]).join(':'),
  };
}

function normalizePreviewEntry(entry = {}) {
  const diagnostics = entry.diagnostics && typeof entry.diagnostics === 'object' ? entry.diagnostics : {};
  const providerSyncCheckpoint = entry.providerSyncCheckpoint && typeof entry.providerSyncCheckpoint === 'object'
    ? entry.providerSyncCheckpoint
    : {};
  const providerServiceContract = entry.providerServiceContract && typeof entry.providerServiceContract === 'object'
    ? entry.providerServiceContract
    : providerSyncCheckpoint.providerServiceContract && typeof providerSyncCheckpoint.providerServiceContract === 'object'
      ? providerSyncCheckpoint.providerServiceContract
      : buildMailchimpCompileCacheProviderServiceContract(entry.descriptor || entry);
  const boundaryScope = entry.boundaryScope && typeof entry.boundaryScope === 'object'
    ? entry.boundaryScope
    : normalizeBoundaryScope(entry.descriptor || entry);
  const clientWorkflowHandoff = entry.clientWorkflowHandoff
    && entry.clientWorkflowHandoff.protocol === 'aios.compile-cache-client-workflow-handoff.mailchimp.v1'
    ? entry.clientWorkflowHandoff
    : buildMailchimpCompileCacheClientWorkflowHandoff({
      ...entry,
      providerSyncCheckpoint,
      providerServiceContract,
      boundaryScope,
    });

  return {
    key: compactString(entry.key || entry.cacheKey),
    requestKey: compactString(entry.requestKey || entry.identity?.requestKey),
    sourceHash: compactString(entry.sourceHash || entry.identity?.sourceHash),
    contractHash: compactString(entry.contractHash || entry.identity?.contractHash),
    stale: entry.stale === true,
    replayed: entry.replayed === true,
    ttlRemainingMs: entry.ttlRemainingMs ?? null,
    hits: positiveInteger(entry.hits, 0),
    diagnostics: {
      total: positiveInteger(diagnostics.total, 0),
      errors: positiveInteger(diagnostics.errors, 0),
      warnings: positiveInteger(diagnostics.warnings, 0),
    },
    providerSync: {
      state: compactString(providerSyncCheckpoint.state || 'unknown'),
      restartSafe: providerSyncCheckpoint.restartSafe === true,
      replayPolicy: compactString(providerSyncCheckpoint.replayPolicy),
      externalHandoffState: compactString(providerSyncCheckpoint.externalHandoffState || 'local_only'),
      cursorRequired: providerSyncCheckpoint.cursorRequired === true,
      cursorPresent: Boolean(providerSyncCheckpoint.cursor),
      capabilitySatisfied: providerSyncCheckpoint.capabilitySatisfied !== false,
      blockedReasons: stableList(providerSyncCheckpoint.blockedReasons),
    },
    providerContract: {
      provider: compactString(providerServiceContract.provider || 'mailchimp'),
      service: compactString(providerServiceContract.service || 'mailchimp-marketing'),
      primaryResource: compactString(providerServiceContract.primaryResource || 'audience'),
      resourceKinds: stableList(providerServiceContract.resourceKinds),
      requiredCapabilities: stableList(providerServiceContract.requiredCapabilities),
      grantedCapabilities: stableList(providerServiceContract.grantedCapabilities),
      missingCapabilities: stableList(providerServiceContract.missingCapabilities),
      negotiationState: compactString(providerServiceContract.negotiation?.state || 'satisfied'),
      negotiationSatisfied: providerServiceContract.negotiation?.satisfied !== false,
      nextAction: compactString(providerServiceContract.negotiation?.nextAction || 'reuse_provider_contract'),
      syncCursorPartition: compactString(providerServiceContract.syncMetadata?.cursorPartition),
      externalRouteState: compactString(providerServiceContract.externalHandoff?.routeState || 'ready'),
      blockedReasons: stableList(providerServiceContract.negotiation?.blockedReasons),
    },
    boundaryScope: {
      tenant: compactString(boundaryScope.tenant),
      scope: compactString(boundaryScope.scope || 'tenant'),
      workspace: compactString(boundaryScope.workspace),
      allowed: boundaryScope.allowed !== false,
      blockedReasons: stableList(boundaryScope.blockedReasons),
      auditDecision: compactString(boundaryScope.audit?.decision),
    },
    clientWorkflowHandoff,
  };
}

function buildMailchimpCompileCacheAcceptancePreview(source = {}, runtime = {}) {
  const readiness = source.readiness && typeof source.readiness === 'object' ? source.readiness : {};
  const acceptance = source.acceptance && typeof source.acceptance === 'object' ? source.acceptance : {};
  const validationSummary = source.validationSummary && typeof source.validationSummary === 'object'
    ? source.validationSummary
    : {};
  const providerSync = source.providerSyncCheckpoint && typeof source.providerSyncCheckpoint === 'object'
    ? source.providerSyncCheckpoint
    : {};
  const providerContract = source.providerServiceContract && typeof source.providerServiceContract === 'object'
    ? source.providerServiceContract
    : {};
  const boundaryScope = source.boundaryScope && typeof source.boundaryScope === 'object'
    ? source.boundaryScope
    : {};
  const lifecycle = source.lifecycle && typeof source.lifecycle === 'object' ? source.lifecycle : {};
  const exportSummary = source.exportSummary && typeof source.exportSummary === 'object' ? source.exportSummary : {};
  const history = source.history && typeof source.history === 'object' ? source.history : {};
  const entries = Array.isArray(source.entries) ? source.entries : [];
  const nextSteps = Array.isArray(source.nextSteps) ? source.nextSteps : [];
  const routeHints = source.routeHints && typeof source.routeHints === 'object' ? source.routeHints : {};
  const runtimeAcceptance = runtime.acceptance && typeof runtime.acceptance === 'object'
    ? runtime.acceptance
    : runtime.operatorAcceptance && typeof runtime.operatorAcceptance === 'object'
      ? runtime.operatorAcceptance
      : {};
  const counters = {
    ...(source.counters || {}),
    ...(validationSummary.counters || {}),
    ...(exportSummary.counters || {}),
  };
  const validationBlockedReasons = stableList([
    ...(Array.isArray(validationSummary.blockedReasons) ? validationSummary.blockedReasons : []),
    ...(Array.isArray(source.blockedReasons) ? source.blockedReasons : []),
    ...(Array.isArray(exportSummary.blockedReasons) ? exportSummary.blockedReasons : []),
    ...(Array.isArray(providerSync.blockedReasons) ? providerSync.blockedReasons : []),
    ...(Array.isArray(providerContract.negotiation?.blockedReasons) ? providerContract.negotiation.blockedReasons : []),
    ...(Array.isArray(boundaryScope.blockedReasons) ? boundaryScope.blockedReasons : []),
  ]);
  const acceptedBy = compactString(acceptance.acceptedBy || runtimeAcceptance.acceptedBy);
  const acceptedAt = compactString(acceptance.acceptedAt || runtimeAcceptance.acceptedAt);
  const acceptanceRequired = acceptance.required === true
    || validationBlockedReasons.includes('operator_acceptance_missing')
    || lifecycle.controls?.operatorHold === true;
  const accepted = acceptanceRequired
    ? acceptance.accepted === true || runtimeAcceptance.accepted === true || Boolean(acceptedBy && acceptedAt)
    : acceptance.accepted !== false;
  const readinessChecks = [
    {
      key: 'cache',
      label: 'Compile cache',
      ready: readiness.cacheReady === true,
      state: readiness.cacheReady === true ? 'ready' : 'blocked',
      blockedReasons: stableList([
        ...(validationBlockedReasons.includes('compile_cache_export_not_ready') ? ['compile_cache_export_not_ready'] : []),
        ...(validationBlockedReasons.includes('compile_cache_lifecycle_not_ready') ? ['compile_cache_lifecycle_not_ready'] : []),
        ...(validationBlockedReasons.includes('stale_entries') ? ['stale_entries'] : []),
        ...(validationBlockedReasons.includes('diagnostic_errors') ? ['diagnostic_errors'] : []),
      ]),
      nextAction: validationBlockedReasons.includes('diagnostic_errors')
        ? 'repair_cached_descriptor'
        : validationBlockedReasons.includes('stale_entries')
          ? 'refresh_compile_cache'
          : validationBlockedReasons.includes('compile_cache_lifecycle_not_ready')
            ? lifecycle.nextAction || 'review_compile_cache_lifecycle'
            : 'review_compile_cache_export',
    },
    {
      key: 'provider',
      label: 'Mailchimp provider',
      ready: readiness.providerReady === true,
      state: readiness.providerReady === true ? 'ready' : 'blocked',
      blockedReasons: stableList([
        ...(providerSync.restartSafe === false ? ['provider_sync_not_restart_safe'] : []),
        ...(providerSync.capabilitySatisfied === false ? ['provider_capability_missing'] : []),
        ...(providerContract.negotiation?.satisfied === false ? ['provider_service_contract_not_satisfied'] : []),
        ...stableList(providerSync.blockedReasons),
        ...stableList(providerContract.negotiation?.blockedReasons),
      ]),
      nextAction: providerContract.negotiation?.nextAction
        || providerSync.replayPolicy
        || 'refresh_provider_sync_before_replay',
    },
    {
      key: 'boundary',
      label: 'Tenant boundary',
      ready: readiness.boundaryReady === true || (boundaryScope.allowed !== false && stableList(boundaryScope.blockedReasons).length === 0),
      state: readiness.boundaryReady === true || (boundaryScope.allowed !== false && stableList(boundaryScope.blockedReasons).length === 0)
        ? 'ready'
        : 'blocked',
      blockedReasons: stableList([
        ...(boundaryScope.allowed === false ? ['tenant_boundary_denied'] : []),
        ...stableList(boundaryScope.blockedReasons),
      ]),
      nextAction: 'repair_tenant_permissions',
    },
    {
      key: 'acceptance',
      label: 'Operator acceptance',
      ready: !acceptanceRequired || accepted,
      state: !acceptanceRequired ? 'not_required' : accepted ? 'accepted' : 'waiting',
      blockedReasons: acceptanceRequired && !accepted ? ['operator_acceptance_missing'] : [],
      nextAction: acceptanceRequired && !accepted ? 'request_compile_cache_acceptance' : 'observe',
    },
  ];
  const failedChecks = readinessChecks.filter((check) => check.ready !== true);
  const primaryStep = nextSteps[0] || null;
  const firstFailedCheck = failedChecks[0] || null;
  const ready = readiness.ready === true && failedChecks.length === 0 && validationBlockedReasons.length === 0;
  const acceptanceState = ready
    ? 'ready'
    : acceptanceRequired && !accepted
      ? 'waiting_for_acceptance'
      : failedChecks.length > 0
        ? 'blocked'
        : accepted
          ? 'accepted'
          : 'review';
  const nextAction = ready
    ? source.replayed
      ? 'verify_cached_descriptor'
      : 'reuse_compile_cache'
    : acceptanceRequired && !accepted
      ? 'request_compile_cache_acceptance'
      : primaryStep?.action
        || firstFailedCheck?.nextAction
        || routeHints.primaryAction
        || 'review_compile_cache_status';
  const routeState = ready
    ? 'ready'
    : acceptanceState === 'waiting_for_acceptance'
      ? 'acceptance_required'
      : source.failed === true
        ? 'failed'
        : 'needs_attention';
  const previewWarnings = stableList([
    ...(positiveInteger(counters.staleEntries, 0) > 0 ? ['stale_entries_visible'] : []),
    ...(positiveInteger(counters.diagnosticEntries ?? counters.errorEntries, 0) > 0 ? ['diagnostics_visible'] : []),
    ...(history.reportingState?.hasFailures === true ? ['history_reports_failures'] : []),
    ...(exportSummary.reportingState?.hasLookupTraffic === false && positiveInteger(counters.lookupEvents, 0) === 0
      ? ['no_lookup_traffic_observed']
      : []),
  ]);

  return {
    protocol: 'aios.compile-cache-acceptance-preview.mailchimp.v1',
    namespace: compactString(source.namespace || 'mailchimp'),
    cacheKey: compactString(source.cacheKey),
    status: compactString(source.status || 'unknown'),
    replayed: source.replayed === true,
    state: acceptanceState,
    ready,
    accepted: !acceptanceRequired || accepted,
    acceptance: {
      required: acceptanceRequired,
      accepted: !acceptanceRequired || accepted,
      acceptedBy,
      acceptedAt,
      reason: compactString(acceptance.reason),
      canAccept: acceptanceRequired && !accepted && failedChecks.every((check) => (
        check.key === 'acceptance' || check.blockedReasons.length === 0 || check.key === 'cache'
      )),
      requiredBecause: stableList([
        ...(validationBlockedReasons.includes('operator_acceptance_missing') ? ['operator_acceptance_missing'] : []),
        ...(lifecycle.controls?.operatorHold === true ? ['operator_hold'] : []),
        ...(exportSummary.exportReady === false ? ['compile_cache_export_not_ready'] : []),
      ]),
    },
    validation: {
      ready: validationSummary.ready === true && validationBlockedReasons.length === 0,
      blockedReasons: validationBlockedReasons,
      warnings: previewWarnings,
      checks: readinessChecks.map((check) => ({
        key: check.key,
        label: check.label,
        state: check.state,
        ready: check.ready === true,
        blockedReasons: check.blockedReasons,
        nextAction: check.ready === true ? 'observe' : check.nextAction,
      })),
      counters: {
        entries: positiveInteger(counters.entries, entries.length),
        visibleEntries: entries.length,
        staleEntries: positiveInteger(counters.staleEntries, entries.filter((entry) => entry.stale === true).length),
        diagnosticEntries: positiveInteger(
          counters.diagnosticEntries ?? counters.errorEntries,
          entries.filter((entry) => entry.diagnostics?.errors > 0).length,
        ),
        providerBlockedEntries: positiveInteger(counters.providerBlockedEntries, 0),
        boundaryBlockedEntries: positiveInteger(counters.boundaryBlockedEntries, 0),
        lookupEvents: positiveInteger(counters.lookupEvents, 0),
      },
    },
    nextStep: {
      action: nextAction,
      reason: primaryStep?.reason || firstFailedCheck?.blockedReasons[0] || validationBlockedReasons[0] || 'ready',
      owner: primaryStep?.owner || (acceptanceRequired && !accepted ? 'operator' : firstFailedCheck?.key || 'runtime'),
      idempotencyKey: stableList([
        source.namespace || 'mailchimp',
        source.cacheKey,
        source.status,
        nextAction,
        acceptanceState,
        validationBlockedReasons.join('|'),
      ]).join(':'),
    },
    route: {
      statusRouteState: routeState,
      primaryAction: nextAction,
      recoveryCommand: ready ? 'observe' : routeHints.recoveryCommand || nextAction,
      canReplayCachedDescriptor: ready && routeHints.canReplayCachedDescriptor !== false,
      explainable: true,
    },
    preview: {
      title: `Mailchimp compile cache ${compactString(source.status || 'status')}`,
      summary: ready
        ? 'Ready to reuse the compiled Mailchimp handoff.'
        : acceptanceState === 'waiting_for_acceptance'
          ? 'Waiting for operator acceptance before the cached handoff can be reused.'
          : 'Compile cache handoff needs attention before replay.',
      visibleEntryKeys: entries.map((entry) => compactString(entry.key)).filter(Boolean).slice(0, 5),
      primaryResource: compactString(providerContract.primaryResource || entries[0]?.providerContract?.primaryResource || 'audience'),
      providerState: compactString(providerSync.state || 'unknown'),
      latestAt: history.timeline?.latestAt ?? exportSummary.timeline?.latestAt ?? null,
    },
  };
}

export function buildMailchimpCompileCacheAcceptanceChecklist(source = {}, runtime = {}) {
  const preview = source.protocol === 'aios.compile-cache-acceptance-preview.mailchimp.v1'
    ? source
    : source.acceptancePreview?.protocol === 'aios.compile-cache-acceptance-preview.mailchimp.v1'
      ? source.acceptancePreview
      : buildMailchimpCompileCacheAcceptancePreview(source, runtime);
  const checks = Array.isArray(preview.validation?.checks) ? preview.validation.checks : [];
  const nextSteps = Array.isArray(source.nextSteps)
    ? source.nextSteps
    : source.uiHandoff && Array.isArray(source.uiHandoff.nextSteps)
      ? source.uiHandoff.nextSteps
      : [];
  const acceptedBy = compactString(preview.acceptance?.acceptedBy || runtime.acceptance?.acceptedBy || runtime.operatorAcceptance?.acceptedBy);
  const acceptedAt = compactString(preview.acceptance?.acceptedAt || runtime.acceptance?.acceptedAt || runtime.operatorAcceptance?.acceptedAt);
  const acceptanceRequired = preview.acceptance?.required === true;
  const accepted = !acceptanceRequired || preview.acceptance?.accepted === true || Boolean(acceptedBy && acceptedAt);
  const checklistItems = checks.map((check, index) => {
    const blockedReasons = stableList(check.blockedReasons);
    const owner = check.key === 'provider'
      ? 'provider'
      : check.key === 'boundary' || check.key === 'acceptance'
        ? 'operator'
        : check.key === 'cache'
          ? 'compiler'
          : 'runtime';
    const nextAction = check.ready === true
      ? 'observe'
      : compactString(check.nextAction || nextSteps.find((step) => step.reason === blockedReasons[0])?.action || preview.nextStep?.action);
    const evidenceKey = stableList([
      preview.namespace || 'mailchimp',
      preview.cacheKey || 'no-cache',
      check.key || `check-${index + 1}`,
      check.state || 'unknown',
      nextAction,
      blockedReasons.join('|'),
    ]).join(':');

    return {
      index: index + 1,
      itemId: `mailchimp-cache-check:${stableHash(evidenceKey)}`,
      key: compactString(check.key || `check-${index + 1}`),
      label: compactString(check.label || check.key || `Check ${index + 1}`),
      state: compactString(check.state || (check.ready === true ? 'ready' : 'blocked')),
      ready: check.ready === true,
      blocking: check.ready !== true && blockedReasons.length > 0,
      owner,
      nextAction: nextAction || 'review_compile_cache_status',
      blockedReasons,
      evidenceKey,
    };
  });
  const nextStepItems = nextSteps
    .filter((step) => step && typeof step === 'object')
    .map((step, index) => ({
      index: checklistItems.length + index + 1,
      itemId: `mailchimp-cache-step:${stableHash({
        namespace: preview.namespace,
        cacheKey: preview.cacheKey,
        action: step.action,
        reason: step.reason,
        owner: step.owner,
      })}`,
      key: compactString(`step:${step.action || index + 1}`),
      label: compactString(step.action || 'next_step'),
      state: 'planned',
      ready: false,
      blocking: true,
      owner: compactString(step.owner || 'runtime'),
      nextAction: compactString(step.action || preview.nextStep?.action || 'review_compile_cache_status'),
      blockedReasons: stableList(step.reason),
      evidenceKey: stableList([
        preview.namespace || 'mailchimp',
        preview.cacheKey || 'no-cache',
        step.action,
        step.reason,
      ]).join(':'),
    }))
    .filter((step) => !checklistItems.some((item) => item.nextAction === step.nextAction));
  const items = [...checklistItems, ...nextStepItems]
    .map((item, index) => ({ ...item, index: index + 1 }));
  const blockingItems = items.filter((item) => item.blocking);
  const operatorItems = items.filter((item) => item.owner === 'operator' && item.ready !== true);
  const acceptanceToken = stableHash({
    namespace: preview.namespace,
    cacheKey: preview.cacheKey,
    state: preview.state,
    accepted,
    acceptedBy,
    acceptedAt,
    blockers: blockingItems.map((item) => [item.key, item.nextAction, item.blockedReasons]),
  });

  return {
    protocol: 'aios.compile-cache-acceptance-checklist.mailchimp.v1',
    namespace: compactString(preview.namespace || 'mailchimp'),
    cacheKey: compactString(preview.cacheKey),
    status: compactString(preview.status || 'unknown'),
    state: accepted && blockingItems.length === 0
      ? 'ready'
      : acceptanceRequired && !accepted
        ? 'waiting_for_acceptance'
        : blockingItems.length > 0
          ? 'blocked'
          : 'review',
    ready: accepted && blockingItems.length === 0,
    acceptance: {
      required: acceptanceRequired,
      accepted,
      acceptedBy,
      acceptedAt,
      canAccept: preview.acceptance?.canAccept === true && !accepted,
      token: acceptanceToken,
      requiredBecause: stableList(preview.acceptance?.requiredBecause),
      operatorItemCount: operatorItems.length,
    },
    counts: {
      total: items.length,
      ready: items.filter((item) => item.ready === true).length,
      blocking: blockingItems.length,
      operator: operatorItems.length,
      provider: items.filter((item) => item.owner === 'provider').length,
      compiler: items.filter((item) => item.owner === 'compiler').length,
    },
    items,
    blockingItems: blockingItems.map((item) => ({
      itemId: item.itemId,
      key: item.key,
      owner: item.owner,
      nextAction: item.nextAction,
      blockedReasons: item.blockedReasons,
    })),
    nextAction: blockingItems[0]?.nextAction || preview.route?.primaryAction || preview.nextStep?.action || 'observe',
    route: {
      statusRouteState: blockingItems.length === 0 && accepted ? 'ready' : preview.route?.statusRouteState || 'needs_attention',
      primaryAction: blockingItems[0]?.nextAction || preview.route?.primaryAction || preview.nextStep?.action || 'observe',
      recoveryCommand: blockingItems[0]?.nextAction || preview.route?.recoveryCommand || 'observe',
      acceptanceToken,
      explainable: true,
    },
  };
}

function normalizeDecisionMatrixRow(row = {}, index = 0, context = {}) {
  const key = compactString(row.key || `row-${index + 1}`);
  const blockedReasons = stableList(row.blockedReasons);
  const nextAction = normalizeRecoveryCommand(row.nextAction || row.recoveryCommand, row.ready ? 'observe' : context.fallbackAction);
  const owner = inferRecoveryCommandOwner(nextAction, row.owner);
  const ready = row.ready === true && blockedReasons.length === 0;
  const severity = ready
    ? 'info'
    : row.severity === 'error' || blockedReasons.some((reason) => (
      reason.includes('denied')
        || reason.includes('mismatch')
        || reason.includes('exhausted')
        || reason.includes('failed')
    ))
      ? 'error'
      : 'warning';
  const priority = ready
    ? 90 + index
    : row.priority != null
      ? positiveInteger(row.priority, index + 1)
      : owner === 'operator'
        ? 10 + index
        : owner === 'provider'
          ? 20 + index
          : owner === 'compiler'
            ? 30 + index
            : 40 + index;

  return {
    key,
    label: compactString(row.label || key),
    state: compactString(row.state || (ready ? 'ready' : 'blocked')),
    ready,
    severity,
    owner,
    phase: inferRecoveryCommandPhase(nextAction, row.state),
    nextAction,
    recoveryCommand: ready ? 'observe' : nextAction,
    routeState: compactString(row.routeState || (ready ? 'ready' : 'needs_attention')),
    blockedReasons,
    evidence: cloneContract(row.evidence || {}),
    priority,
    idempotencyKey: stableList([
      context.namespace || 'mailchimp',
      context.cacheKey || 'no-cache',
      key,
      row.state || (ready ? 'ready' : 'blocked'),
      nextAction,
      blockedReasons.join('|'),
    ]).join(':'),
  };
}

function compactDecisionActionQueue(rows = []) {
  const grouped = rows
    .filter((row) => row.ready !== true || row.nextAction !== 'observe')
    .reduce((groups, row) => {
      const key = stableList([row.owner, row.nextAction, row.blockedReasons.join('|')]).join(':');
      if (!groups[key]) {
        groups[key] = {
          owner: row.owner,
          action: row.nextAction,
          phase: row.phase,
          severity: row.severity,
          routeState: row.routeState,
          reasons: [],
          rowKeys: [],
          priority: row.priority,
          idempotencyKeys: [],
        };
      }
      groups[key].reasons = stableList([...groups[key].reasons, ...row.blockedReasons]);
      groups[key].rowKeys = stableList([...groups[key].rowKeys, row.key]);
      groups[key].idempotencyKeys = stableList([...groups[key].idempotencyKeys, row.idempotencyKey]);
      groups[key].priority = Math.min(groups[key].priority, row.priority);
      if (groups[key].severity !== 'error' && row.severity === 'error') groups[key].severity = 'error';
      return groups;
    }, {});

  return Object.keys(grouped)
    .sort()
    .map((key) => grouped[key])
    .sort((left, right) => left.priority - right.priority || left.action.localeCompare(right.action))
    .map((item, index) => ({
      index: index + 1,
      action: item.action,
      owner: item.owner,
      phase: item.phase,
      severity: item.severity,
      routeState: item.routeState,
      reasons: item.reasons,
      rowKeys: item.rowKeys,
      idempotencyKey: stableHash({
        action: item.action,
        owner: item.owner,
        reasons: item.reasons,
        rows: item.idempotencyKeys,
      }),
    }));
}

export function buildMailchimpCompileCacheDecisionMatrix(source = {}, runtime = {}) {
  const uiHandoff = source.uiHandoff && typeof source.uiHandoff === 'object' ? source.uiHandoff : {};
  const acceptancePreview = source.acceptancePreview && typeof source.acceptancePreview === 'object'
    ? source.acceptancePreview
    : uiHandoff.acceptancePreview && typeof uiHandoff.acceptancePreview === 'object'
      ? uiHandoff.acceptancePreview
      : {};
  const acceptanceChecklist = source.acceptanceChecklist && typeof source.acceptanceChecklist === 'object'
    ? source.acceptanceChecklist
    : uiHandoff.acceptanceChecklist && typeof uiHandoff.acceptanceChecklist === 'object'
      ? uiHandoff.acceptanceChecklist
      : {};
  const replayBarrier = source.replayBarrier && typeof source.replayBarrier === 'object'
    ? source.replayBarrier
    : uiHandoff.replayBarrier && typeof uiHandoff.replayBarrier === 'object'
      ? uiHandoff.replayBarrier
      : {};
  const persistedReplayState = source.persistedReplayState && typeof source.persistedReplayState === 'object'
    ? source.persistedReplayState
    : {};
  const persistedSnapshotState = source.persistedSnapshotState && typeof source.persistedSnapshotState === 'object'
    ? source.persistedSnapshotState
    : {};
  const recoveryJournal = source.recoveryJournal && typeof source.recoveryJournal === 'object' ? source.recoveryJournal : {};
  const operationalHealth = source.operationalHealth && typeof source.operationalHealth === 'object' ? source.operationalHealth : {};
  const exportPackage = source.exportPackage && typeof source.exportPackage === 'object' ? source.exportPackage : {};
  const providerReplayHandoff = source.providerReplayHandoff && typeof source.providerReplayHandoff === 'object'
    ? source.providerReplayHandoff
    : {};
  const clientWorkflowHandoff = source.clientWorkflowHandoff && typeof source.clientWorkflowHandoff === 'object'
    ? source.clientWorkflowHandoff
    : {};
  const lifecycleExecution = source.lifecycleExecution && typeof source.lifecycleExecution === 'object'
    ? source.lifecycleExecution
    : uiHandoff.lifecycleExecution && typeof uiHandoff.lifecycleExecution === 'object'
      ? uiHandoff.lifecycleExecution
      : {};
  const readiness = source.readiness && typeof source.readiness === 'object'
    ? source.readiness
    : uiHandoff.readiness && typeof uiHandoff.readiness === 'object'
      ? uiHandoff.readiness
      : {};
  const acceptance = source.acceptance && typeof source.acceptance === 'object'
    ? source.acceptance
    : uiHandoff.acceptance && typeof uiHandoff.acceptance === 'object'
      ? uiHandoff.acceptance
      : acceptancePreview.acceptance && typeof acceptancePreview.acceptance === 'object'
        ? acceptancePreview.acceptance
        : {};
  const validationSummary = source.validationSummary && typeof source.validationSummary === 'object'
    ? source.validationSummary
    : uiHandoff.validationSummary && typeof uiHandoff.validationSummary === 'object'
      ? uiHandoff.validationSummary
      : {};
  const routeHints = source.routeHints && typeof source.routeHints === 'object'
    ? source.routeHints
    : uiHandoff.routeHints && typeof uiHandoff.routeHints === 'object'
      ? uiHandoff.routeHints
      : {};
  const namespace = compactString(source.namespace || uiHandoff.namespace || acceptancePreview.namespace || 'mailchimp');
  const cacheKey = compactString(source.cacheKey || uiHandoff.cacheKey || acceptancePreview.cacheKey);
  const status = compactString(source.status || uiHandoff.status || acceptancePreview.status || 'unknown');
  const accepted = acceptance.accepted === true || acceptancePreview.acceptance?.accepted === true;
  const acceptanceRequired = acceptance.required === true || acceptancePreview.acceptance?.required === true;
  const rows = [
    normalizeDecisionMatrixRow({
      key: 'cache_readiness',
      label: 'Compile cache readiness',
      ready: readiness.ready === true || validationSummary.ready === true,
      state: readiness.ready === true || validationSummary.ready === true ? 'ready' : 'needs_attention',
      owner: 'compiler',
      nextAction: readiness.nextStep || routeHints.primaryAction || 'refresh_compile_cache',
      blockedReasons: stableList([
        ...(readiness.cacheReady === false ? ['compile_cache_not_ready'] : []),
        ...(Array.isArray(validationSummary.blockedReasons) ? validationSummary.blockedReasons : []),
      ]),
      evidence: {
        cacheReady: readiness.cacheReady === true,
        exportReady: readiness.exportReady === true,
        lifecycleReady: readiness.lifecycleReady === true,
        counters: validationSummary.counters || {},
      },
    }, 0, { namespace, cacheKey, fallbackAction: 'refresh_compile_cache' }),
    normalizeDecisionMatrixRow({
      key: 'provider_replay',
      label: 'Mailchimp provider replay',
      ready: providerReplayHandoff.ready === true || readiness.providerReady === true,
      state: providerReplayHandoff.state || (readiness.providerReady ? 'ready' : 'blocked'),
      owner: 'provider',
      nextAction: providerReplayHandoff.nextAction || routeHints.primaryAction || 'refresh_provider_sync_before_replay',
      blockedReasons: stableList([
        ...(readiness.providerReady === false ? ['provider_not_ready'] : []),
        ...(Array.isArray(providerReplayHandoff.blockedReasons) ? providerReplayHandoff.blockedReasons : []),
      ]),
      evidence: {
        restartSafe: providerReplayHandoff.restartSafe === true,
        replayAllowed: providerReplayHandoff.replayAllowed === true,
        externalHandoff: providerReplayHandoff.externalHandoff || null,
      },
    }, 1, { namespace, cacheKey, fallbackAction: 'refresh_provider_sync_before_replay' }),
    normalizeDecisionMatrixRow({
      key: 'tenant_boundary',
      label: 'Tenant boundary',
      ready: readiness.boundaryReady === true || clientWorkflowHandoff.boundaryState?.allowed === true,
      state: readiness.boundaryReady === true || clientWorkflowHandoff.boundaryState?.allowed === true ? 'allowed' : 'blocked',
      owner: 'operator',
      nextAction: clientWorkflowHandoff.boundaryState?.nextAction || 'repair_tenant_permissions',
      blockedReasons: stableList([
        ...(readiness.boundaryReady === false ? ['tenant_boundary_not_ready'] : []),
        ...(Array.isArray(clientWorkflowHandoff.boundaryState?.blockedReasons) ? clientWorkflowHandoff.boundaryState.blockedReasons : []),
      ]),
      evidence: clientWorkflowHandoff.boundaryState || {},
    }, 2, { namespace, cacheKey, fallbackAction: 'repair_tenant_permissions' }),
    normalizeDecisionMatrixRow({
      key: 'operator_acceptance',
      label: 'Operator acceptance',
      ready: !acceptanceRequired || accepted,
      state: !acceptanceRequired ? 'not_required' : accepted ? 'accepted' : 'waiting',
      owner: 'operator',
      nextAction: acceptanceChecklist.nextAction || acceptancePreview.nextStep?.action || 'request_compile_cache_acceptance',
      blockedReasons: acceptanceRequired && !accepted ? ['operator_acceptance_missing'] : [],
      evidence: {
        required: acceptanceRequired,
        accepted,
        acceptedBy: compactString(acceptance.acceptedBy || acceptancePreview.acceptance?.acceptedBy),
        token: compactString(acceptanceChecklist.acceptance?.token),
      },
    }, 3, { namespace, cacheKey, fallbackAction: 'request_compile_cache_acceptance' }),
    normalizeDecisionMatrixRow({
      key: 'replay_barrier',
      label: 'Replay barrier',
      ready: replayBarrier.open === true,
      state: replayBarrier.open === true ? 'open' : 'closed',
      owner: inferRecoveryCommandOwner(replayBarrier.recoveryCommand || replayBarrier.nextAction),
      nextAction: replayBarrier.recoveryCommand || replayBarrier.nextAction || 'open_compile_cache_replay_barrier',
      blockedReasons: stableList(replayBarrier.blockedReasons),
      evidence: {
        restartSafe: replayBarrier.restartSafe === true,
        canReplayCachedDescriptor: replayBarrier.canReplayCachedDescriptor === true,
        retry: replayBarrier.retry || null,
      },
    }, 4, { namespace, cacheKey, fallbackAction: 'open_compile_cache_replay_barrier' }),
    normalizeDecisionMatrixRow({
      key: 'persisted_replay',
      label: 'Persisted replay state',
      ready: !persistedReplayState.protocol
        || persistedReplayState.restartSafe === true && persistedReplayState.replaySafe !== false,
      state: persistedReplayState.state || (persistedReplayState.protocol ? 'unknown' : 'not_attached'),
      owner: inferRecoveryCommandOwner(persistedReplayState.recovery?.command || persistedReplayState.command?.nextAction),
      nextAction: persistedReplayState.recovery?.command || persistedReplayState.command?.nextAction || 'rebuild_persisted_replay_state',
      blockedReasons: stableList(persistedReplayState.blockedReasons),
      evidence: {
        restartSafe: persistedReplayState.restartSafe === true,
        replaySafe: persistedReplayState.replaySafe === true,
        command: persistedReplayState.command || null,
      },
    }, 5, { namespace, cacheKey, fallbackAction: 'rebuild_persisted_replay_state' }),
    normalizeDecisionMatrixRow({
      key: 'snapshot_restore',
      label: 'Snapshot restore',
      ready: !persistedSnapshotState.protocol || persistedSnapshotState.restartSafe === true,
      state: persistedSnapshotState.restoreMode
        || persistedSnapshotState.statusRouteState
        || (persistedSnapshotState.protocol ? 'unknown' : 'not_attached'),
      owner: inferRecoveryCommandOwner(persistedSnapshotState.recoveryCommand || persistedSnapshotState.nextAction),
      nextAction: persistedSnapshotState.recoveryCommand || persistedSnapshotState.nextAction || 'refresh_compile_cache',
      blockedReasons: stableList(persistedSnapshotState.blockedReasons),
      evidence: {
        restoreMode: persistedSnapshotState.restoreMode,
        counters: persistedSnapshotState.counters || {},
      },
    }, 6, { namespace, cacheKey, fallbackAction: 'refresh_compile_cache' }),
    normalizeDecisionMatrixRow({
      key: 'export_package',
      label: 'Export package',
      ready: exportPackage.exportReady === true || readiness.exportReady === true,
      state: exportPackage.exportReady === true || readiness.exportReady === true ? 'ready' : 'blocked',
      owner: 'runtime',
      nextAction: exportPackage.nextAction || 'review_compile_cache_export',
      blockedReasons: stableList(exportPackage.blockedReasons),
      evidence: {
        packageId: exportPackage.packageId,
        counters: exportPackage.counters || {},
      },
    }, 7, { namespace, cacheKey, fallbackAction: 'review_compile_cache_export' }),
    normalizeDecisionMatrixRow({
      key: 'lifecycle',
      label: 'Lifecycle controls',
      ready: readiness.lifecycleReady === true || lifecycleExecution.state === 'ready',
      state: lifecycleExecution.state || (readiness.lifecycleReady ? 'ready' : 'unknown'),
      owner: inferRecoveryCommandOwner(lifecycleExecution.nextAction),
      nextAction: lifecycleExecution.nextAction || 'repair_compile_cache_lifecycle_settings',
      blockedReasons: stableList([
        ...(readiness.lifecycleReady === false ? ['compile_cache_lifecycle_not_ready'] : []),
        ...(Array.isArray(lifecycleExecution.blockedReasons) ? lifecycleExecution.blockedReasons : []),
        ...(Array.isArray(lifecycleExecution.deferredReasons) ? lifecycleExecution.deferredReasons : []),
      ]),
      evidence: {
        executable: lifecycleExecution.executable === true,
        commandAccepted: lifecycleExecution.commandAccepted === true,
        willChangeState: lifecycleExecution.willChangeState === true,
      },
    }, 8, { namespace, cacheKey, fallbackAction: 'repair_compile_cache_lifecycle_settings' }),
    normalizeDecisionMatrixRow({
      key: 'operational_health',
      label: 'Operational health',
      ready: operationalHealth.failed !== true && operationalHealth.state !== 'failed',
      state: operationalHealth.state || 'unknown',
      owner: inferRecoveryCommandOwner(operationalHealth.recoveryCommand || operationalHealth.nextAction),
      nextAction: operationalHealth.recoveryCommand || operationalHealth.nextAction || 'observe',
      blockedReasons: stableList(operationalHealth.blockedReasons),
      evidence: {
        degradedMode: operationalHealth.degradedMode,
        retry: operationalHealth.retry || null,
      },
    }, 9, { namespace, cacheKey, fallbackAction: 'observe' }),
    normalizeDecisionMatrixRow({
      key: 'recovery_journal',
      label: 'Recovery journal',
      ready: recoveryJournal.restartSafe === true || recoveryJournal.state === 'empty',
      state: recoveryJournal.state || 'empty',
      owner: inferRecoveryCommandOwner(recoveryJournal.recoveryCommand || recoveryJournal.nextAction),
      nextAction: recoveryJournal.recoveryCommand || recoveryJournal.nextAction || 'observe',
      blockedReasons: stableList(recoveryJournal.blockedReasons),
      evidence: {
        counters: recoveryJournal.counters || {},
        replaySafe: recoveryJournal.replaySafe === true,
      },
    }, 10, { namespace, cacheKey, fallbackAction: 'observe' }),
  ].sort((left, right) => left.priority - right.priority || left.key.localeCompare(right.key));
  const blockingRows = rows.filter((row) => row.ready !== true);
  const actionQueue = compactDecisionActionQueue(blockingRows);
  const primaryAction = actionQueue[0]?.action
    || routeHints.primaryAction
    || (source.replayed || uiHandoff.replayed ? 'verify_cached_descriptor' : 'reuse_compile_cache');
  const routeState = blockingRows.length === 0
    ? 'ready'
    : blockingRows.some((row) => row.severity === 'error')
      ? 'blocked'
      : acceptanceRequired && !accepted
        ? 'acceptance_required'
        : 'needs_attention';

  return {
    protocol: 'aios.compile-cache-decision-matrix.mailchimp.v1',
    namespace,
    cacheKey,
    status,
    ready: blockingRows.length === 0,
    routeState,
    primaryAction,
    recoveryCommand: blockingRows.length === 0 ? 'observe' : primaryAction,
    blockedReasons: stableList(blockingRows.flatMap((row) => row.blockedReasons)),
    counts: {
      rows: rows.length,
      ready: rows.filter((row) => row.ready).length,
      blocking: blockingRows.length,
      operator: blockingRows.filter((row) => row.owner === 'operator').length,
      provider: blockingRows.filter((row) => row.owner === 'provider').length,
      compiler: blockingRows.filter((row) => row.owner === 'compiler').length,
      runtime: blockingRows.filter((row) => row.owner === 'runtime').length,
      errors: blockingRows.filter((row) => row.severity === 'error').length,
      warnings: blockingRows.filter((row) => row.severity === 'warning').length,
    },
    rows,
    blockingRows,
    actionQueue,
    route: {
      statusRouteState: routeState,
      primaryAction,
      recoveryCommand: blockingRows.length === 0 ? 'observe' : primaryAction,
      canReplayCachedDescriptor: blockingRows.length === 0 && routeHints.canReplayCachedDescriptor !== false,
      explainable: true,
    },
    preview: {
      summary: blockingRows.length === 0
        ? 'All Mailchimp compile cache handoff gates are ready.'
        : `${blockingRows.length} Mailchimp compile cache handoff gate${blockingRows.length === 1 ? '' : 's'} need attention.`,
      firstBlockingKey: blockingRows[0]?.key || '',
      firstBlockingOwner: blockingRows[0]?.owner || '',
      firstBlockingAction: blockingRows[0]?.nextAction || '',
    },
    idempotencyKey: stableHash({
      namespace,
      cacheKey,
      status,
      routeState,
      primaryAction,
      blockers: blockingRows.map((row) => [row.key, row.nextAction, row.blockedReasons]),
    }),
  };
}

function normalizeReplayBarrierSource(source = {}) {
  const handoff = source.uiHandoff && typeof source.uiHandoff === 'object' ? source.uiHandoff : {};
  const readiness = handoff.readiness && typeof handoff.readiness === 'object' ? handoff.readiness : {};
  const acceptance = handoff.acceptance && typeof handoff.acceptance === 'object' ? handoff.acceptance : {};
  const validationSummary = handoff.validationSummary && typeof handoff.validationSummary === 'object'
    ? handoff.validationSummary
    : {};
  const routeHints = handoff.routeHints && typeof handoff.routeHints === 'object' ? handoff.routeHints : {};
  const providerSyncCheckpoint = source.providerSyncCheckpoint && typeof source.providerSyncCheckpoint === 'object'
    ? source.providerSyncCheckpoint
    : handoff.preview?.providerSync && typeof handoff.preview.providerSync === 'object'
      ? handoff.preview.providerSync
      : {};
  const providerServiceContract = source.providerServiceContract && typeof source.providerServiceContract === 'object'
    ? source.providerServiceContract
    : providerSyncCheckpoint.providerServiceContract && typeof providerSyncCheckpoint.providerServiceContract === 'object'
      ? providerSyncCheckpoint.providerServiceContract
      : handoff.preview?.providerContract && typeof handoff.preview.providerContract === 'object'
        ? handoff.preview.providerContract
        : buildMailchimpCompileCacheProviderServiceContract(source);
  const boundaryScope = source.boundaryScope && typeof source.boundaryScope === 'object'
    ? source.boundaryScope
    : handoff.preview?.boundaryScope && typeof handoff.preview.boundaryScope === 'object'
      ? handoff.preview.boundaryScope
      : {};
  const blockedReasons = stableList([
    ...(Array.isArray(validationSummary.blockedReasons) ? validationSummary.blockedReasons : []),
    ...(Array.isArray(providerSyncCheckpoint.blockedReasons) ? providerSyncCheckpoint.blockedReasons : []),
    ...(Array.isArray(boundaryScope.blockedReasons) ? boundaryScope.blockedReasons : []),
  ]);

  return {
    cacheKey: compactString(source.cacheKey || handoff.cacheKey),
    status: compactString(source.status || handoff.status || 'unknown'),
    replayed: source.replayed === true || handoff.replayed === true,
    readiness: {
      ready: readiness.ready === true,
      cacheReady: readiness.cacheReady === true,
      providerReady: readiness.providerReady === true,
      exportReady: readiness.exportReady === true,
      lifecycleReady: readiness.lifecycleReady === true,
      nextStep: compactString(readiness.nextStep || routeHints.primaryAction),
    },
    acceptance: {
      required: acceptance.required === true,
      accepted: acceptance.accepted !== false && acceptance.required !== true
        ? true
        : acceptance.accepted === true,
      acceptedBy: compactString(acceptance.acceptedBy),
      acceptedAt: compactString(acceptance.acceptedAt),
      reason: compactString(acceptance.reason),
    },
    providerSyncCheckpoint: {
      state: compactString(providerSyncCheckpoint.state || 'stale'),
      restartSafe: providerSyncCheckpoint.restartSafe === true,
      replayPolicy: compactString(providerSyncCheckpoint.replayPolicy || 'refresh_provider_sync_before_replay'),
      externalHandoffState: compactString(providerSyncCheckpoint.externalHandoffState || 'local_only'),
      externalRequestId: compactString(providerSyncCheckpoint.externalRequestId),
      cursorRequired: providerSyncCheckpoint.cursorRequired === true,
      cursorPresent: Boolean(providerSyncCheckpoint.cursor || providerSyncCheckpoint.cursorPresent),
      capabilitySatisfied: providerSyncCheckpoint.capabilitySatisfied !== false,
      blockedReasons,
    },
    providerServiceContract,
    boundaryScope: {
      tenant: compactString(boundaryScope.tenant),
      scope: compactString(boundaryScope.scope || 'tenant'),
      workspace: compactString(boundaryScope.workspace),
      allowed: boundaryScope.allowed !== false,
      blockedReasons: stableList(boundaryScope.blockedReasons),
    },
    routeHints: {
      primaryAction: compactString(routeHints.primaryAction),
      recoveryCommand: compactString(routeHints.recoveryCommand),
      statusRouteState: compactString(routeHints.statusRouteState),
      canReplayCachedDescriptor: routeHints.canReplayCachedDescriptor === true,
    },
  };
}

export function buildMailchimpCompileCacheReplayBarrier(source = {}, runtime = {}) {
  const normalized = normalizeReplayBarrierSource(source);
  const runtimeControls = runtime.compileCacheReplay && typeof runtime.compileCacheReplay === 'object'
    ? runtime.compileCacheReplay
    : runtime.replayControls && typeof runtime.replayControls === 'object'
      ? runtime.replayControls
      : {};
  const attempts = positiveInteger(runtimeControls.attempts ?? runtime.replayAttempts, 0);
  const maxAttempts = Math.max(1, positiveInteger(runtimeControls.maxAttempts ?? runtime.maxReplayAttempts, 1));
  const retryAfterMs = positiveInteger(runtimeControls.retryAfterMs ?? runtimeControls.backoffMs ?? runtime.retryAfterMs, 0);
  const command = compactString(runtimeControls.command || runtimeControls.nextCommand || normalized.routeHints.primaryAction);
  const providerSync = normalized.providerSyncCheckpoint;
  const providerServiceContract = normalized.providerServiceContract
    && normalized.providerServiceContract.protocol === 'aios.compile-cache-provider-service-contract.mailchimp.v1'
    ? normalized.providerServiceContract
    : buildMailchimpCompileCacheProviderServiceContract(normalized.providerServiceContract || {});
  const boundaryBlocked = normalized.boundaryScope.allowed === false
    || normalized.boundaryScope.blockedReasons.length > 0;
  const acceptanceOpen = normalized.acceptance.required && !normalized.acceptance.accepted;
  const attemptBudgetExhausted = attempts >= maxAttempts;
  const providerBlocked = providerSync.restartSafe !== true
    || providerSync.capabilitySatisfied === false
    || providerServiceContract.negotiation?.satisfied === false
    || providerSync.blockedReasons.length > 0;
  const readinessBlocked = normalized.readiness.ready !== true
    || normalized.readiness.cacheReady !== true
    || normalized.readiness.providerReady !== true
    || normalized.readiness.exportReady !== true
    || normalized.readiness.lifecycleReady !== true;
  const blockedReasons = stableList([
    ...(providerBlocked ? ['provider_sync_not_restart_safe'] : []),
    ...(boundaryBlocked ? ['tenant_boundary_not_replay_safe'] : []),
    ...(providerSync.capabilitySatisfied === false ? ['provider_capability_missing'] : []),
    ...(providerServiceContract.negotiation?.satisfied === false ? ['provider_service_contract_not_satisfied'] : []),
    ...stableList(providerServiceContract.negotiation?.blockedReasons),
    ...providerSync.blockedReasons,
    ...normalized.boundaryScope.blockedReasons,
    ...(readinessBlocked ? ['handoff_readiness_not_satisfied'] : []),
    ...(normalized.readiness.cacheReady ? [] : ['compile_cache_not_ready']),
    ...(normalized.readiness.providerReady ? [] : ['provider_not_ready']),
    ...(normalized.readiness.exportReady ? [] : ['compile_cache_export_not_ready']),
    ...(normalized.readiness.lifecycleReady ? [] : ['compile_cache_lifecycle_not_ready']),
    ...(acceptanceOpen ? ['operator_acceptance_missing'] : []),
    ...(attemptBudgetExhausted ? ['replay_attempt_budget_exhausted'] : []),
  ]);
  const open = blockedReasons.length === 0;
  const nextAction = open
    ? normalized.replayed
      ? 'verify_cached_descriptor'
      : 'reuse_compile_cache'
    : acceptanceOpen
      ? 'request_compile_cache_acceptance'
      : attemptBudgetExhausted
        ? 'hold_for_operator'
        : providerBlocked
          ? providerSync.replayPolicy || 'refresh_provider_sync_before_replay'
          : normalized.readiness.nextStep || command || normalized.routeHints.recoveryCommand || 'refresh_compile_cache';

  return {
    protocol: 'aios.compile-cache-replay-barrier.mailchimp.v1',
    cacheKey: normalized.cacheKey,
    status: normalized.status,
    open,
    restartSafe: open && providerSync.restartSafe === true,
    canReplayCachedDescriptor: open,
    blockedReasons,
    nextAction,
    recoveryCommand: open ? 'observe' : nextAction,
    providerSync: {
      state: providerSync.state,
      restartSafe: providerSync.restartSafe,
      replayPolicy: providerSync.replayPolicy,
      externalHandoffState: providerSync.externalHandoffState,
      externalRequestId: providerSync.externalRequestId,
      cursorRequired: providerSync.cursorRequired,
      cursorPresent: providerSync.cursorPresent,
      capabilitySatisfied: providerSync.capabilitySatisfied,
    },
    providerContract: {
      provider: providerServiceContract.provider,
      service: providerServiceContract.service,
      primaryResource: providerServiceContract.primaryResource,
      resourceKinds: providerServiceContract.resourceKinds,
      requiredCapabilities: providerServiceContract.requiredCapabilities,
      grantedCapabilities: providerServiceContract.grantedCapabilities,
      missingCapabilities: providerServiceContract.missingCapabilities,
      negotiation: providerServiceContract.negotiation,
      syncMetadata: providerServiceContract.syncMetadata,
      externalHandoff: providerServiceContract.externalHandoff,
    },
    boundaryScope: normalized.boundaryScope,
    retry: {
      attempts,
      maxAttempts,
      retryAfterMs,
      exhausted: attemptBudgetExhausted,
      mode: retryAfterMs > 0 ? 'backoff' : 'immediate',
    },
    acceptance: normalized.acceptance,
    route: {
      statusRouteState: open ? 'ready' : 'blocked',
      primaryAction: nextAction,
      previousPrimaryAction: normalized.routeHints.primaryAction,
    },
  };
}

function normalizePersistedReplaySource(source = {}, runtime = {}) {
  const compileCache = source.compileCache && typeof source.compileCache === 'object'
    ? source.compileCache
    : source.protocol === 'aios.compile-cache-status.mailchimp.v1'
      ? source
      : {};
  const uiHandoff = source.uiHandoff && typeof source.uiHandoff === 'object'
    ? source.uiHandoff
    : compileCache.uiHandoff && typeof compileCache.uiHandoff === 'object'
      ? compileCache.uiHandoff
      : {};
  const replayBarrier = source.replayBarrier && typeof source.replayBarrier === 'object'
    ? source.replayBarrier
    : compileCache.replayBarrier && typeof compileCache.replayBarrier === 'object'
      ? compileCache.replayBarrier
      : buildMailchimpCompileCacheReplayBarrier({
        cacheKey: compileCache.cacheKey || source.cacheKey,
        status: compileCache.status || source.status,
        replayed: compileCache.replayed === true || source.replayed === true,
        providerSyncCheckpoint: compileCache.providerSyncCheckpoint || source.providerSyncCheckpoint,
        uiHandoff,
      }, runtime);
  const providerSyncCheckpoint = compileCache.providerSyncCheckpoint
    || source.providerSyncCheckpoint
    || replayBarrier.providerSync
    || uiHandoff.preview?.providerSync
    || {};
  const providerServiceContract = compileCache.providerServiceContract
    || source.providerServiceContract
    || providerSyncCheckpoint.providerServiceContract
    || replayBarrier.providerContract
    || uiHandoff.preview?.providerContract
    || {};
  const boundaryScope = compileCache.boundaryScope
    || source.boundaryScope
    || replayBarrier.boundaryScope
    || uiHandoff.preview?.boundaryScope
    || {};
  const runtimeReplay = runtime.compileCacheReplay && typeof runtime.compileCacheReplay === 'object'
    ? runtime.compileCacheReplay
    : runtime.replayControls && typeof runtime.replayControls === 'object'
      ? runtime.replayControls
      : {};
  const acceptance = uiHandoff.acceptance && typeof uiHandoff.acceptance === 'object'
    ? uiHandoff.acceptance
    : replayBarrier.acceptance && typeof replayBarrier.acceptance === 'object'
      ? replayBarrier.acceptance
      : {};
  const report = compileCache.report && typeof compileCache.report === 'object'
    ? compileCache.report
    : source.report && typeof source.report === 'object'
      ? source.report
      : {};

  return {
    namespace: compactString(compileCache.namespace || source.namespace || uiHandoff.namespace || 'mailchimp'),
    cacheKey: compactString(compileCache.cacheKey || source.cacheKey || uiHandoff.cacheKey || replayBarrier.cacheKey),
    requestKey: compactString(compileCache.requestKey || source.requestKey || runtime.requestKey),
    status: compactString(compileCache.status || source.status || uiHandoff.status || replayBarrier.status || 'unknown'),
    replayed: compileCache.replayed === true || source.replayed === true || uiHandoff.replayed === true,
    sourceHash: compactString(compileCache.sourceHash || source.sourceHash),
    optionsHash: compactString(compileCache.optionsHash || source.optionsHash),
    contractHash: compactString(compileCache.contractHash || source.contractHash),
    ttlRemainingMs: compileCache.ttlRemainingMs ?? source.ttlRemainingMs ?? null,
    stale: compileCache.stale === true || source.stale === true,
    exportReady: compileCache.exportReady !== false && report.exportReady !== false,
    providerSyncCheckpoint,
    providerServiceContract,
    boundaryScope,
    replayBarrier,
    uiHandoff,
    acceptance,
    runtimeReplay,
  };
}

function buildPersistedCommandKey(parts) {
  return stableList(parts).join(':');
}

function normalizeRecoveryCommand(command, fallback = 'observe') {
  const normalized = compactString(command || fallback).toLowerCase().replaceAll('-', '_');
  if (!normalized) return fallback;
  if (normalized === 'refresh_provider_contract') return 'refresh_provider_sync_before_replay';
  if (normalized === 'review_compile_cache_status') return 'inspect_compile_cache_resume_gate';
  if (normalized === 'deliver_export') return 'deliver_compile_cache_export';
  return normalized;
}

function inferRecoveryCommandOwner(command, explicitOwner = '') {
  const owner = compactString(explicitOwner);
  if (owner) return owner;
  const normalized = normalizeRecoveryCommand(command);
  if (RECOVERY_COMMAND_OWNER_HINTS[normalized]) return RECOVERY_COMMAND_OWNER_HINTS[normalized];
  if (normalized.includes('provider') || normalized.includes('handoff')) return 'provider';
  if (normalized.includes('acceptance') || normalized.includes('operator') || normalized.includes('tenant')) return 'operator';
  if (normalized.includes('compile') || normalized.includes('descriptor') || normalized.includes('lifecycle')) return 'compiler';
  return 'runtime';
}

function inferRecoveryCommandPhase(command, status = '') {
  const normalized = normalizeRecoveryCommand(command);
  const normalizedStatus = compactString(status);
  if (normalized === 'observe') return 'observe';
  if (normalized.includes('acceptance') || normalized.includes('hold')) return 'operator_gate';
  if (normalized.includes('provider') || normalized.includes('handoff')) return 'provider_recovery';
  if (normalized.includes('tenant')) return 'boundary_recovery';
  if (normalized.includes('rebuild') || normalized.includes('refresh') || normalized.includes('repair')) return 'state_recovery';
  if (normalized.includes('export')) return 'export';
  if (normalized.includes('reuse') || normalized.includes('resume') || normalized.includes('verify')) return 'replay';
  return normalizedStatus === 'blocked' || normalizedStatus === 'recovery_required' ? 'state_recovery' : 'observe';
}

function normalizeRecoveryJournalItem(item = {}, index = 0, context = {}) {
  const command = normalizeRecoveryCommand(item.command || item.nextAction || item.recoveryCommand, context.fallbackCommand);
  const key = compactString(item.key || item.cacheKey || context.cacheKey);
  const requestKey = compactString(item.requestKey || context.requestKey);
  const status = compactString(item.status || item.state || context.status || 'observed');
  const blockedReasons = stableList([
    ...(Array.isArray(item.blockedReasons) ? item.blockedReasons : []),
    ...(Array.isArray(context.blockedReasons) ? context.blockedReasons : []),
  ]);
  const idempotencyKey = compactString(item.idempotencyKey || item.commandKey) || buildPersistedCommandKey([
    context.namespace,
    key,
    requestKey,
    command,
    status,
    blockedReasons.join('|'),
  ]);

  return {
    sequence: index,
    command,
    owner: inferRecoveryCommandOwner(command, item.owner || context.owner),
    phase: inferRecoveryCommandPhase(command, status),
    key,
    requestKey,
    status,
    idempotencyKey,
    replaySafe: item.replaySafe === true || command === 'observe' || command === 'reuse_compile_cache',
    restartSafe: item.restartSafe !== false && !blockedReasons.includes('provider_sync_not_restart_safe'),
    blocking: item.blocking === true || blockedReasons.length > 0 || ['blocked', 'recovery_required'].includes(status),
    blockedReasons,
  };
}

function pushRecoveryJournalItem(items, item, context) {
  if (!item || typeof item !== 'object') return;
  const rawCommand = compactString(item.command || item.nextAction || item.recoveryCommand);
  const blockedReasons = stableList([
    ...(Array.isArray(item.blockedReasons) ? item.blockedReasons : []),
    ...(Array.isArray(context.blockedReasons) ? context.blockedReasons : []),
  ]);
  if (!rawCommand && !item.idempotencyKey && blockedReasons.length === 0 && !item.status && !item.state) return;
  items.push(normalizeRecoveryJournalItem(item, items.length, context));
}

function normalizeRecoveryJournalSource(source = {}) {
  const namespace = compactString(source.namespace || 'mailchimp');
  const cacheKey = compactString(source.cacheKey);
  const requestKey = compactString(source.requestKey);
  const commandLedger = Array.isArray(source.commandLedger)
    ? source.commandLedger
    : Array.isArray(source.persistedSnapshotState?.commandLedger)
      ? source.persistedSnapshotState.commandLedger
      : [];
  const nextSteps = Array.isArray(source.nextSteps)
    ? source.nextSteps
    : Array.isArray(source.uiHandoff?.nextSteps)
      ? source.uiHandoff.nextSteps
      : [];
  const items = [];
  const context = {
    namespace,
    cacheKey,
    requestKey,
    status: compactString(source.status || 'observed'),
  };

  for (const ledgerItem of commandLedger) {
    pushRecoveryJournalItem(items, ledgerItem, context);
  }
  for (const step of nextSteps) {
    pushRecoveryJournalItem(items, {
      command: step.action,
      owner: step.owner,
      status: 'planned',
      blockedReasons: stableList(step.reason),
    }, context);
  }
  pushRecoveryJournalItem(items, {
    command: source.persistedReplayState?.command?.nextAction || source.persistedReplayState?.recovery?.command,
    idempotencyKey: source.persistedReplayState?.command?.idempotencyKey,
    key: source.persistedReplayState?.cacheKey,
    requestKey: source.persistedReplayState?.requestKey,
    status: source.persistedReplayState?.state,
    replaySafe: source.persistedReplayState?.replaySafe,
    restartSafe: source.persistedReplayState?.restartSafe,
    blockedReasons: stableList(source.persistedReplayState?.blockedReasons),
  }, context);
  pushRecoveryJournalItem(items, {
    command: source.replayBarrier?.recoveryCommand || source.replayBarrier?.nextAction,
    key: source.replayBarrier?.cacheKey,
    status: source.replayBarrier?.open === true ? 'open' : 'blocked',
    replaySafe: source.replayBarrier?.canReplayCachedDescriptor,
    restartSafe: source.replayBarrier?.restartSafe,
    blockedReasons: stableList(source.replayBarrier?.blockedReasons),
  }, context);
  pushRecoveryJournalItem(items, {
    command: source.operationalHealth?.nextAction,
    status: source.operationalHealth?.state,
    restartSafe: source.operationalHealth?.failed !== true,
    blockedReasons: stableList(source.operationalHealth?.blockedReasons),
  }, context);
  pushRecoveryJournalItem(items, {
    command: source.exportPackage?.nextAction,
    status: source.exportPackage?.exportReady === true ? 'ready' : 'blocked',
    restartSafe: source.exportPackage?.exportReady !== false,
    blockedReasons: stableList(source.exportPackage?.blockedReasons),
  }, context);
  pushRecoveryJournalItem(items, {
    command: source.clientWorkflowHandoff?.recoveryCommand || source.clientWorkflowHandoff?.primaryAction,
    idempotencyKey: source.clientWorkflowHandoff?.requestState?.idempotencyKey,
    status: source.clientWorkflowHandoff?.workflowState,
    restartSafe: source.clientWorkflowHandoff?.requestState?.restartSafe,
    blockedReasons: stableList(source.clientWorkflowHandoff?.blockedReasons),
  }, context);
  pushRecoveryJournalItem(items, {
    command: source.lifecycle?.nextAction || source.lifecycle?.controlContract?.state?.nextAction,
    idempotencyKey: source.lifecycle?.nextState?.idempotencyKey || source.lifecycle?.controlContract?.idempotencyKey,
    status: source.lifecycle?.blocked === true ? 'blocked' : source.lifecycle?.nextState?.state,
    restartSafe: source.lifecycle?.blocked !== true,
    blockedReasons: stableList(source.lifecycle?.validationSummary?.blockedReasons),
  }, context);

  return { namespace, cacheKey, requestKey, items };
}

export function buildMailchimpCompileCacheRecoveryJournal(source = {}) {
  const normalized = normalizeRecoveryJournalSource(source);
  const byIdempotency = normalized.items.reduce((groups, item) => {
    const key = item.idempotencyKey || `sequence:${item.sequence}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
    return groups;
  }, {});
  const entries = Object.keys(byIdempotency).sort().map((idempotencyKey, index) => {
    const grouped = byIdempotency[idempotencyKey].sort((left, right) => left.sequence - right.sequence);
    const commands = stableList(grouped.map((item) => item.command));
    const owners = stableList(grouped.map((item) => item.owner));
    const phases = stableList(grouped.map((item) => item.phase));
    const blockedReasons = stableList(grouped.flatMap((item) => item.blockedReasons));
    const conflict = commands.length > 1 || owners.length > 1 && blockedReasons.length > 0;
    const primary = grouped.find((item) => item.blocking) || grouped[0];

    return {
      sequence: index,
      idempotencyKey,
      command: primary.command,
      commands,
      owner: primary.owner,
      owners,
      phase: primary.phase,
      phases,
      key: primary.key,
      requestKey: primary.requestKey,
      status: primary.status,
      replaySafe: grouped.every((item) => item.replaySafe !== false),
      restartSafe: conflict === false && grouped.every((item) => item.restartSafe !== false),
      blocking: grouped.some((item) => item.blocking),
      conflict,
      occurrenceCount: grouped.length,
      blockedReasons: stableList([
        ...blockedReasons,
        ...(conflict ? ['recovery_command_conflict'] : []),
      ]),
    };
  });
  const blockingEntries = entries.filter((entry) => entry.blocking || entry.conflict || entry.restartSafe === false);
  const primary = blockingEntries[0] || entries.find((entry) => entry.command !== 'observe') || entries[0] || null;
  const blockedReasons = stableList(entries.flatMap((entry) => entry.blockedReasons));

  return {
    protocol: 'aios.compile-cache-recovery-journal.mailchimp.v1',
    namespace: normalized.namespace,
    cacheKey: normalized.cacheKey,
    requestKey: normalized.requestKey,
    state: entries.length === 0
      ? 'empty'
      : blockedReasons.includes('recovery_command_conflict')
        ? 'conflict'
        : blockingEntries.length > 0
          ? 'recovery_required'
          : 'restart_safe',
    restartSafe: entries.every((entry) => entry.restartSafe !== false) && !blockedReasons.includes('recovery_command_conflict'),
    replaySafe: entries.length > 0 && entries.every((entry) => entry.replaySafe !== false),
    nextAction: primary?.command || 'observe',
    recoveryCommand: primary?.blocking || primary?.conflict ? primary.command : 'observe',
    blockedReasons,
    counters: {
      entries: entries.length,
      blockingEntries: blockingEntries.length,
      conflicts: entries.filter((entry) => entry.conflict).length,
      providerCommands: entries.filter((entry) => entry.owner === 'provider').length,
      operatorCommands: entries.filter((entry) => entry.owner === 'operator').length,
      compilerCommands: entries.filter((entry) => entry.owner === 'compiler').length,
      runtimeCommands: entries.filter((entry) => entry.owner === 'runtime').length,
    },
    entries,
  };
}

function normalizeHealthBlockedReasons(parts = {}) {
  return stableList([
    ...(parts.stale ? ['stale_entry'] : []),
    ...(parts.providerSyncCheckpoint?.restartSafe === false ? ['provider_sync_not_restart_safe'] : []),
    ...(parts.providerServiceContract?.negotiation?.satisfied === false ? ['provider_service_contract_not_satisfied'] : []),
    ...(parts.report?.exportReady === false ? ['compile_cache_export_not_ready'] : []),
    ...(parts.lifecycleDecision?.blocked === true ? ['compile_cache_lifecycle_blocked'] : []),
    ...(parts.lifecycleDecision?.refreshRecommended === true ? ['compile_cache_lifecycle_refresh_recommended'] : []),
    ...(parts.replayBarrier?.open === false ? ['compile_cache_replay_barrier_closed'] : []),
    ...(parts.persistedReplaySummary?.restartSafe === false ? ['compile_cache_persisted_replay_not_restart_safe'] : []),
    ...(parts.persistedReplaySummary?.retry?.exhausted === true || parts.replayBarrier?.retry?.exhausted === true
      ? ['replay_attempt_budget_exhausted']
      : []),
    ...(Array.isArray(parts.providerSyncCheckpoint?.blockedReasons) ? parts.providerSyncCheckpoint.blockedReasons : []),
    ...(Array.isArray(parts.providerServiceContract?.negotiation?.blockedReasons) ? parts.providerServiceContract.negotiation.blockedReasons : []),
    ...(Array.isArray(parts.report?.blockedReasons) ? parts.report.blockedReasons : []),
    ...(Array.isArray(parts.replayBarrier?.blockedReasons) ? parts.replayBarrier.blockedReasons : []),
    ...(Array.isArray(parts.persistedReplaySummary?.blockedReasons) ? parts.persistedReplaySummary.blockedReasons : []),
  ]);
}

function normalizeRetryStrategy(value) {
  const normalized = compactString(value).toLowerCase().replaceAll('-', '_');
  if (['fixed', 'linear', 'exponential', 'immediate'].includes(normalized)) return normalized;
  return 'fixed';
}

function finiteTimestamp(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (Number.isFinite(number)) return Math.max(0, Math.floor(number));
  const parsed = Date.parse(compactString(value));
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : null;
}

function deriveRetryDelayMs({ attempts, retryAfterMs, baseDelayMs, maxDelayMs, strategy }) {
  if (strategy === 'immediate') return 0;
  if (retryAfterMs > 0) return retryAfterMs;
  if (baseDelayMs <= 0) return 0;
  const attemptOrdinal = Math.max(1, attempts + 1);
  const rawDelay = strategy === 'exponential'
    ? baseDelayMs * (2 ** Math.max(0, attemptOrdinal - 1))
    : strategy === 'linear'
      ? baseDelayMs * attemptOrdinal
      : baseDelayMs;
  return maxDelayMs > 0 ? Math.min(rawDelay, maxDelayMs) : rawDelay;
}

function normalizeOperationalRetryWindow({
  source = {},
  runtime = {},
  persistedReplaySummary = {},
  replayBarrier = {},
  now,
} = {}) {
  const runtimeReplay = runtime.compileCacheReplay && typeof runtime.compileCacheReplay === 'object'
    ? runtime.compileCacheReplay
    : runtime.replayControls && typeof runtime.replayControls === 'object'
      ? runtime.replayControls
      : {};
  const sourceRetry = source.retry && typeof source.retry === 'object' ? source.retry : {};
  const persistedRetry = persistedReplaySummary.retry && typeof persistedReplaySummary.retry === 'object'
    ? persistedReplaySummary.retry
    : {};
  const barrierRetry = replayBarrier.retry && typeof replayBarrier.retry === 'object' ? replayBarrier.retry : {};
  const attempts = positiveInteger(
    runtimeReplay.attempts
      ?? sourceRetry.attempts
      ?? persistedRetry.attempts
      ?? barrierRetry.attempts,
    0,
  );
  const maxAttempts = Math.max(1, positiveInteger(
    runtimeReplay.maxAttempts
      ?? sourceRetry.maxAttempts
      ?? persistedRetry.maxAttempts
      ?? barrierRetry.maxAttempts,
    1,
  ));
  const retryAfterMs = positiveInteger(
    runtimeReplay.retryAfterMs
      ?? runtimeReplay.backoffMs
      ?? sourceRetry.retryAfterMs
      ?? sourceRetry.backoffMs
      ?? persistedRetry.retryAfterMs
      ?? persistedRetry.backoffMs
      ?? barrierRetry.retryAfterMs,
    0,
  );
  const baseDelayMs = positiveInteger(
    runtimeReplay.baseDelayMs
      ?? runtimeReplay.baseBackoffMs
      ?? sourceRetry.baseDelayMs
      ?? sourceRetry.baseBackoffMs
      ?? persistedRetry.baseDelayMs
      ?? barrierRetry.baseDelayMs,
    retryAfterMs,
  );
  const maxDelayMs = positiveInteger(
    runtimeReplay.maxDelayMs
      ?? runtimeReplay.maxBackoffMs
      ?? sourceRetry.maxDelayMs
      ?? sourceRetry.maxBackoffMs
      ?? persistedRetry.maxDelayMs
      ?? barrierRetry.maxDelayMs,
    0,
  );
  const strategy = normalizeRetryStrategy(
    runtimeReplay.strategy
      || runtimeReplay.backoffStrategy
      || sourceRetry.strategy
      || sourceRetry.backoffStrategy
      || persistedRetry.strategy
      || barrierRetry.strategy
      || (retryAfterMs > 0 ? 'fixed' : 'immediate'),
  );
  const lastAttemptAt = finiteTimestamp(
    runtimeReplay.lastAttemptAt
      ?? sourceRetry.lastAttemptAt
      ?? persistedRetry.lastAttemptAt
      ?? barrierRetry.lastAttemptAt,
  );
  const firstFailureAt = finiteTimestamp(
    runtimeReplay.firstFailureAt
      ?? sourceRetry.firstFailureAt
      ?? persistedRetry.firstFailureAt
      ?? barrierRetry.firstFailureAt,
  );
  const lastFailureAt = finiteTimestamp(
    runtimeReplay.lastFailureAt
      ?? sourceRetry.lastFailureAt
      ?? persistedRetry.lastFailureAt
      ?? barrierRetry.lastFailureAt
      ?? lastAttemptAt
      ?? firstFailureAt,
  );
  const exhausted = attempts >= maxAttempts
    || sourceRetry.exhausted === true
    || persistedRetry.exhausted === true
    || barrierRetry.exhausted === true;
  const delayMs = Math.max(0, Math.floor(deriveRetryDelayMs({
    attempts,
    retryAfterMs,
    baseDelayMs,
    maxDelayMs,
    strategy,
  })));
  const anchorAt = lastFailureAt ?? lastAttemptAt;
  const nextRetryAt = !exhausted && delayMs > 0 && anchorAt != null ? anchorAt + delayMs : null;
  const remainingMs = nextRetryAt == null ? 0 : Math.max(0, nextRetryAt - now);
  const backoffActive = !exhausted && remainingMs > 0;

  return {
    protocol: 'aios.compile-cache-operational-retry-window.mailchimp.v1',
    attempts,
    maxAttempts,
    retryAfterMs,
    baseDelayMs,
    maxDelayMs,
    strategy,
    delayMs,
    firstFailureAt,
    lastFailureAt,
    lastAttemptAt,
    nextRetryAt,
    remainingMs,
    exhausted,
    backoffActive,
    mode: exhausted
      ? 'exhausted'
      : backoffActive
        ? 'backoff'
        : delayMs > 0
          ? 'scheduled'
          : 'immediate',
  };
}

function buildOperationalRecoveryReadiness({ failureState, nextAction, retryWindow, blockedReasons }) {
  const hasFailure = failureState !== 'none';
  const owner = inferRecoveryCommandOwner(nextAction);
  const recoveryReady = hasFailure && !retryWindow.exhausted && !retryWindow.backoffActive;
  const status = !hasFailure
    ? 'not_required'
    : retryWindow.exhausted
      ? 'operator_hold'
      : retryWindow.backoffActive
        ? 'waiting_for_backoff'
        : 'ready_to_retry';

  return {
    protocol: 'aios.compile-cache-operational-recovery-readiness.mailchimp.v1',
    status,
    recoveryReady,
    owner,
    command: hasFailure ? nextAction || COMPILE_CACHE_FAILURE_ACTIONS[failureState] || 'refresh_compile_cache' : 'observe',
    nextRetryAt: retryWindow.nextRetryAt,
    remainingMs: retryWindow.remainingMs,
    blockedReasons: stableList([
      ...blockedReasons,
      ...(retryWindow.backoffActive ? ['retry_backoff_active'] : []),
      ...(retryWindow.exhausted ? ['replay_attempt_budget_exhausted'] : []),
    ]),
  };
}

function buildOperationalActionableErrors({ blockedReasons, failureState, nextAction, retryWindow, recoveryReadiness }) {
  return blockedReasons.map((reason) => ({
    code: `mailchimp.compile_cache.${reason}`,
    severity: retryWindow.exhausted || reason === 'replay_attempt_budget_exhausted' ? 'error' : 'warning',
    reason,
    action: nextAction || COMPILE_CACHE_FAILURE_ACTIONS[failureState] || 'refresh_compile_cache',
    owner: recoveryReadiness.owner,
    retryable: recoveryReadiness.recoveryReady,
    retryWindow: {
      status: recoveryReadiness.status,
      nextRetryAt: retryWindow.nextRetryAt,
      remainingMs: retryWindow.remainingMs,
      attempts: retryWindow.attempts,
      maxAttempts: retryWindow.maxAttempts,
    },
  }));
}

export function buildMailchimpCompileCacheOperationalHealthReport(source = {}, runtime = {}) {
  const now = nowFrom(runtime);
  const replayBarrier = source.replayBarrier && typeof source.replayBarrier === 'object' ? source.replayBarrier : {};
  const persistedReplaySummary = source.persistedReplaySummary && typeof source.persistedReplaySummary === 'object'
    ? source.persistedReplaySummary
    : source.persistedReplayState && typeof source.persistedReplayState === 'object'
      ? source.persistedReplayState
      : {};
  const providerSyncCheckpoint = source.providerSyncCheckpoint && typeof source.providerSyncCheckpoint === 'object'
    ? source.providerSyncCheckpoint
    : {};
  const providerServiceContract = source.providerServiceContract && typeof source.providerServiceContract === 'object'
    ? source.providerServiceContract
    : providerSyncCheckpoint.providerServiceContract && typeof providerSyncCheckpoint.providerServiceContract === 'object'
      ? providerSyncCheckpoint.providerServiceContract
      : {};
  const report = source.report && typeof source.report === 'object' ? source.report : {};
  const lifecycleDecision = source.lifecycleDecision && typeof source.lifecycleDecision === 'object'
    ? source.lifecycleDecision
    : source.lifecycle && typeof source.lifecycle === 'object'
      ? source.lifecycle
      : {};
  const stale = source.stale === true;
  const retryWindow = normalizeOperationalRetryWindow({
    source,
    runtime,
    persistedReplaySummary,
    replayBarrier,
    now,
  });
  const retryExhausted = retryWindow.exhausted;
  const blockedReasons = normalizeHealthBlockedReasons({
    stale,
    providerSyncCheckpoint,
    providerServiceContract,
    report,
    lifecycleDecision,
    replayBarrier,
    persistedReplaySummary,
  });
  const providerRestartSafe = providerSyncCheckpoint.restartSafe !== false;
  const providerContractSatisfied = providerServiceContract.negotiation?.satisfied !== false;
  const persistedRestartSafe = persistedReplaySummary.restartSafe !== false;
  const replayOpen = replayBarrier.open !== false;
  const exportReady = report.exportReady !== false;
  const lifecycleBlocked = lifecycleDecision.blocked === true || lifecycleDecision.refreshRecommended === true;
  const failureState = retryExhausted
    ? 'retry_budget_exhausted'
    : stale
      ? 'stale_cache_entry'
      : !providerRestartSafe
        ? 'provider_sync_not_restart_safe'
        : !providerContractSatisfied
          ? 'provider_sync_not_restart_safe'
          : !exportReady
            ? 'export_not_ready'
            : !replayOpen
              ? 'replay_barrier_closed'
              : !persistedRestartSafe
                ? 'persisted_replay_not_restart_safe'
                : lifecycleBlocked
                  ? 'lifecycle_controls_blocked'
                  : 'none';
  const nextAction = compactString(
    source.nextAction
      || persistedReplaySummary.nextAction
      || persistedReplaySummary.recovery?.command
      || replayBarrier.nextAction
      || lifecycleDecision.nextAction
      || COMPILE_CACHE_FAILURE_ACTIONS[failureState],
  );
  const degradedMode = failureState === 'none'
    ? 'normal'
    : retryExhausted
      ? 'operator_hold'
      : retryWindow.backoffActive
        ? 'backoff_wait'
      : ['provider_sync_not_restart_safe', 'persisted_replay_not_restart_safe'].includes(failureState)
        ? 'restart_protected'
        : failureState === 'export_not_ready'
          ? 'reporting_only'
          : 'local_repair';
  const healthBlockedReasons = stableList([
    ...blockedReasons,
    ...(retryWindow.backoffActive ? ['retry_backoff_active'] : []),
  ]);
  const recoveryReadiness = buildOperationalRecoveryReadiness({
    failureState,
    nextAction: nextAction || 'observe',
    retryWindow,
    blockedReasons: healthBlockedReasons,
  });
  const actionableErrors = buildOperationalActionableErrors({
    blockedReasons: healthBlockedReasons,
    failureState,
    nextAction,
    retryWindow,
    recoveryReadiness,
  });

  return {
    protocol: 'aios.compile-cache-operational-health.mailchimp.v1',
    generatedAt: now,
    state: failureState === 'none' ? 'healthy' : retryExhausted ? 'failed' : 'degraded',
    healthy: failureState === 'none',
    degraded: failureState !== 'none' && !retryExhausted,
    failed: retryExhausted,
    degradedMode,
    failureState,
    retryable: recoveryReadiness.recoveryReady,
    recoveryReady: recoveryReadiness.recoveryReady,
    nextAction: nextAction || 'observe',
    recoveryCommand: failureState === 'none' ? 'observe' : nextAction || COMPILE_CACHE_FAILURE_ACTIONS[failureState],
    blockedReasons: healthBlockedReasons,
    retry: {
      attempts: retryWindow.attempts,
      maxAttempts: retryWindow.maxAttempts,
      retryAfterMs: retryWindow.retryAfterMs,
      exhausted: retryWindow.exhausted,
      mode: retryWindow.mode,
      strategy: retryWindow.strategy,
      delayMs: retryWindow.delayMs,
      nextRetryAt: retryWindow.nextRetryAt,
      remainingMs: retryWindow.remainingMs,
      backoffActive: retryWindow.backoffActive,
      backoff: retryWindow.delayMs > 0
        ? {
          mode: retryWindow.strategy,
          retryAfterMs: retryWindow.retryAfterMs,
          baseDelayMs: retryWindow.baseDelayMs,
          maxDelayMs: retryWindow.maxDelayMs,
          nextRetryAt: retryWindow.nextRetryAt,
          remainingMs: retryWindow.remainingMs,
        }
        : null,
    },
    recoveryReadiness,
    adapterStatusPayload: {
      protocol: 'aios.compile-cache-operational-status.mailchimp.v1',
      state: failureState === 'none' ? 'healthy' : retryExhausted ? 'failed' : 'degraded',
      severity: retryExhausted ? 'error' : failureState === 'none' ? 'info' : 'warning',
      degradedMode,
      failureState,
      recoveryReady: recoveryReadiness.recoveryReady,
      nextAction: nextAction || 'observe',
      recoveryCommand: failureState === 'none' ? 'observe' : nextAction || COMPILE_CACHE_FAILURE_ACTIONS[failureState],
      owner: recoveryReadiness.owner,
      retry: {
        mode: retryWindow.mode,
        attempts: retryWindow.attempts,
        maxAttempts: retryWindow.maxAttempts,
        nextRetryAt: retryWindow.nextRetryAt,
        remainingMs: retryWindow.remainingMs,
      },
      blockedReasons: healthBlockedReasons,
    },
    providerSync: {
      state: compactString(providerSyncCheckpoint.state || 'unknown'),
      restartSafe: providerRestartSafe,
      replayPolicy: compactString(providerSyncCheckpoint.replayPolicy || 'refresh_provider_sync_before_replay'),
      externalHandoffState: compactString(providerSyncCheckpoint.externalHandoffState || 'local_only'),
      externalRequestId: compactString(providerSyncCheckpoint.externalRequestId),
      cursorRequired: providerSyncCheckpoint.cursorRequired === true,
      cursorPresent: Boolean(providerSyncCheckpoint.cursor || providerSyncCheckpoint.cursorPresent),
      capabilitySatisfied: providerSyncCheckpoint.capabilitySatisfied !== false,
    },
    providerContract: providerServiceContract.protocol === 'aios.compile-cache-provider-service-contract.mailchimp.v1'
      ? cloneContract(providerServiceContract)
      : buildMailchimpCompileCacheProviderServiceContract(providerServiceContract),
    actionableErrors,
  };
}

export function buildMailchimpCompileCachePersistedReplayState(source = {}, runtime = {}) {
  const normalized = normalizePersistedReplaySource(source, runtime);
  const providerSync = normalized.providerSyncCheckpoint || {};
  const providerServiceContract = normalized.providerServiceContract
    && normalized.providerServiceContract.protocol === 'aios.compile-cache-provider-service-contract.mailchimp.v1'
    ? normalized.providerServiceContract
    : buildMailchimpCompileCacheProviderServiceContract(normalized.providerServiceContract || providerSync.providerServiceContract || {});
  const boundaryScope = normalized.boundaryScope || {};
  const replayBarrier = normalized.replayBarrier || {};
  const uiHandoff = normalized.uiHandoff || {};
  const routeHints = uiHandoff.routeHints && typeof uiHandoff.routeHints === 'object' ? uiHandoff.routeHints : replayBarrier.route || {};
  const nextSteps = Array.isArray(uiHandoff.nextSteps) ? uiHandoff.nextSteps : [];
  const blockedReasons = stableList([
    ...(Array.isArray(uiHandoff.validationSummary?.blockedReasons) ? uiHandoff.validationSummary.blockedReasons : []),
    ...(Array.isArray(replayBarrier.blockedReasons) ? replayBarrier.blockedReasons : []),
    ...(Array.isArray(providerSync.blockedReasons) ? providerSync.blockedReasons : []),
    ...(normalized.stale ? ['stale_entry'] : []),
    ...(normalized.exportReady ? [] : ['compile_cache_export_not_ready']),
    ...(providerSync.restartSafe === false ? ['provider_sync_not_restart_safe'] : []),
    ...(providerServiceContract.negotiation?.satisfied === false ? ['provider_service_contract_not_satisfied'] : []),
    ...stableList(providerServiceContract.negotiation?.blockedReasons),
    ...(boundaryScope.allowed === false ? ['tenant_boundary_not_replay_safe'] : []),
    ...(Array.isArray(boundaryScope.blockedReasons) ? boundaryScope.blockedReasons : []),
    ...(replayBarrier.open === false ? ['compile_cache_replay_barrier_closed'] : []),
    ...(replayBarrier.retry?.exhausted === true ? ['replay_attempt_budget_exhausted'] : []),
    ...(normalized.acceptance.required === true && normalized.acceptance.accepted !== true ? ['operator_acceptance_missing'] : []),
  ]);
  const attempts = positiveInteger(
    normalized.runtimeReplay.attempts
      ?? replayBarrier.retry?.attempts
      ?? runtime.replayAttempts,
    0,
  );
  const maxAttempts = Math.max(1, positiveInteger(
    normalized.runtimeReplay.maxAttempts
      ?? replayBarrier.retry?.maxAttempts
      ?? runtime.maxReplayAttempts,
    1,
  ));
  const retryAfterMs = positiveInteger(
    normalized.runtimeReplay.retryAfterMs
      ?? normalized.runtimeReplay.backoffMs
      ?? replayBarrier.retry?.retryAfterMs
      ?? runtime.retryAfterMs,
    0,
  );
  const attemptBudgetExhausted = attempts >= maxAttempts || replayBarrier.retry?.exhausted === true;
  const canReplay = replayBarrier.canReplayCachedDescriptor === true
    && replayBarrier.open === true
    && providerSync.restartSafe !== false
    && !normalized.stale
    && blockedReasons.length === 0
    && !attemptBudgetExhausted;
  const nextAction = canReplay
    ? normalized.replayed
      ? 'verify_cached_descriptor'
      : 'reuse_compile_cache'
    : attemptBudgetExhausted
      ? 'hold_for_operator'
      : replayBarrier.recoveryCommand
        || replayBarrier.nextAction
        || routeHints.recoveryCommand
        || routeHints.primaryAction
        || nextSteps[0]?.action
        || 'refresh_compile_cache';
  const state = canReplay
    ? 'replay_ready'
    : attemptBudgetExhausted
      ? 'retry_budget_hold'
      : normalized.acceptance.required === true && normalized.acceptance.accepted !== true
        ? 'waiting_for_acceptance'
        : providerSync.restartSafe === false
          ? 'waiting_for_provider_sync'
          : normalized.stale
            ? 'waiting_for_refresh'
            : replayBarrier.open === false
              ? 'waiting_for_replay_barrier'
              : 'persisted_hold';
  const commandKeyParts = [
    normalized.namespace,
    normalized.requestKey,
    normalized.cacheKey,
    normalized.contractHash,
    providerSync.externalRequestId || providerSync.externalHandoffState,
    nextAction,
  ];
  const commandKey = buildPersistedCommandKey(commandKeyParts);

  return {
    protocol: 'aios.compile-cache-persisted-replay-state.mailchimp.v1',
    namespace: normalized.namespace,
    cacheKey: normalized.cacheKey,
    requestKey: normalized.requestKey,
    state,
    status: normalized.status,
    replayed: normalized.replayed,
    replaySafe: canReplay,
    restartSafe: canReplay || ['waiting_for_acceptance', 'persisted_hold', 'retry_budget_hold'].includes(state),
    command: {
      nextAction,
      idempotencyKey: commandKey,
      retryKey: buildPersistedCommandKey([...commandKeyParts, `attempt:${attempts}`]),
      replayKey: buildPersistedCommandKey([
        normalized.namespace,
        normalized.cacheKey,
        normalized.sourceHash,
        normalized.optionsHash,
        normalized.contractHash,
      ]),
      idempotent: Boolean(normalized.cacheKey || normalized.requestKey),
    },
    retry: {
      attempts,
      maxAttempts,
      retryAfterMs,
      exhausted: attemptBudgetExhausted,
      mode: retryAfterMs > 0 ? 'backoff' : 'immediate',
    },
    providerSync: {
      state: compactString(providerSync.state || 'stale'),
      restartSafe: providerSync.restartSafe === true,
      replayPolicy: compactString(providerSync.replayPolicy || 'refresh_provider_sync_before_replay'),
      externalHandoffState: compactString(providerSync.externalHandoffState || 'local_only'),
      externalRequestId: compactString(providerSync.externalRequestId),
      cursorRequired: providerSync.cursorRequired === true,
      cursorPresent: Boolean(providerSync.cursor || providerSync.cursorPresent),
      capabilitySatisfied: providerSync.capabilitySatisfied !== false,
      blockedReasons: stableList(providerSync.blockedReasons),
    },
    providerContract: {
      provider: providerServiceContract.provider,
      service: providerServiceContract.service,
      primaryResource: providerServiceContract.primaryResource,
      resourceKinds: providerServiceContract.resourceKinds,
      requiredCapabilities: providerServiceContract.requiredCapabilities,
      grantedCapabilities: providerServiceContract.grantedCapabilities,
      missingCapabilities: providerServiceContract.missingCapabilities,
      negotiation: providerServiceContract.negotiation,
      syncMetadata: providerServiceContract.syncMetadata,
      externalHandoff: providerServiceContract.externalHandoff,
    },
    boundaryScope: {
      tenant: compactString(boundaryScope.tenant),
      scope: compactString(boundaryScope.scope || 'tenant'),
      workspace: compactString(boundaryScope.workspace),
      allowed: boundaryScope.allowed !== false,
      blockedReasons: stableList(boundaryScope.blockedReasons),
    },
    acceptance: {
      required: normalized.acceptance.required === true,
      accepted: normalized.acceptance.accepted === true || normalized.acceptance.required !== true,
      acceptedBy: compactString(normalized.acceptance.acceptedBy),
      acceptedAt: compactString(normalized.acceptance.acceptedAt),
      reason: compactString(normalized.acceptance.reason),
    },
    blockedReasons,
    recovery: {
      required: !canReplay,
      command: canReplay ? 'observe' : nextAction,
      resumeAfter: canReplay ? 'checkpoint_replay' : state,
      routeState: canReplay ? 'ready' : 'blocked',
    },
  };
}

function normalizePersistedSnapshotSource(source = {}, runtime = {}) {
  const snapshot = source.protocol === 'aios.compile-cache-snapshot.mailchimp.v1'
    ? source
    : source.snapshot && typeof source.snapshot === 'object'
      ? source.snapshot
      : {};
  const compileCache = source.compileCache && typeof source.compileCache === 'object'
    ? source.compileCache
    : source.protocol === 'aios.compile-cache-status.mailchimp.v1'
      ? source
      : {};
  const entries = Array.isArray(snapshot.entries)
    ? snapshot.entries
    : Array.isArray(source.entries)
      ? source.entries
      : compileCache.cacheKey || compileCache.key
        ? [compileCache]
        : [];
  const analytics = snapshot.analytics && typeof snapshot.analytics === 'object'
    ? snapshot.analytics
    : source.analytics && typeof source.analytics === 'object'
      ? source.analytics
      : {};
  const exportSummary = snapshot.exportSummary && typeof snapshot.exportSummary === 'object'
    ? snapshot.exportSummary
    : source.exportSummary && typeof source.exportSummary === 'object'
      ? source.exportSummary
      : buildMailchimpCompileCacheExportSummary({
        protocol: 'aios.compile-cache-snapshot.mailchimp.v1',
        namespace: snapshot.namespace || source.namespace || compileCache.namespace || 'mailchimp',
        entries,
        analytics,
      });
  const lifecycle = snapshot.lifecycle && typeof snapshot.lifecycle === 'object'
    ? snapshot.lifecycle
    : source.lifecycle && typeof source.lifecycle === 'object'
      ? source.lifecycle
      : {};
  const history = snapshot.history && typeof snapshot.history === 'object'
    ? snapshot.history
    : source.history && typeof source.history === 'object'
      ? source.history
      : buildMailchimpCompileCacheHistoryReport({
        namespace: snapshot.namespace || source.namespace || compileCache.namespace || 'mailchimp',
        entries,
        analytics,
      }, { now: source.now ?? snapshot.generatedAt ?? runtime.now });
  return {
    namespace: compactString(snapshot.namespace || source.namespace || compileCache.namespace || 'mailchimp'),
    generatedAt: positiveInteger(snapshot.generatedAt ?? source.generatedAt ?? runtime.now, nowFrom(runtime)),
    ttlMs: positiveInteger(snapshot.ttlMs ?? source.ttlMs ?? runtime.ttlMs, DEFAULT_TTL_MS),
    limit: Math.max(1, positiveInteger(snapshot.limit ?? snapshot.maxEntries ?? source.limit ?? runtime.maxEntries, DEFAULT_CACHE_LIMIT)),
    entries,
    analytics,
    exportSummary,
    lifecycle,
    history,
  };
}

function normalizePersistedSnapshotEntry(entry = {}, index = 0, now = Date.now()) {
  const preview = normalizePreviewEntry(entry);
  const expiresAt = entry.expiresAt == null ? null : positiveInteger(entry.expiresAt, 0);
  const ttlRemainingMs = expiresAt == null
    ? preview.ttlRemainingMs
    : Math.max(0, expiresAt - now);
  const expired = expiresAt != null && now >= expiresAt;
  const providerRestartSafe = preview.providerSync.restartSafe === true;
  const workflowReady = preview.clientWorkflowHandoff.ready === true;
  const replaySafe = !preview.stale && !expired && providerRestartSafe && workflowReady;
  const blockedReasons = stableList([
    ...(preview.stale ? ['stale_entry'] : []),
    ...(expired ? ['expired_entry'] : []),
    ...(preview.diagnostics.errors > 0 ? ['diagnostic_errors'] : []),
    ...(providerRestartSafe ? [] : ['provider_sync_not_restart_safe']),
    ...(preview.providerContract.negotiationSatisfied ? [] : ['provider_service_contract_not_satisfied']),
    ...(preview.boundaryScope.allowed ? [] : ['tenant_boundary_not_replay_safe']),
    ...(workflowReady ? [] : ['client_workflow_handoff_blocked']),
    ...preview.providerSync.blockedReasons,
    ...preview.providerContract.blockedReasons,
    ...preview.boundaryScope.blockedReasons,
    ...stableList(preview.clientWorkflowHandoff.blockedReasons),
  ]);
  const recoveryCommand = replaySafe
    ? preview.replayed ? 'verify_cached_descriptor' : 'reuse_compile_cache'
    : expired || preview.stale
      ? 'refresh_compile_cache'
      : preview.diagnostics.errors > 0
        ? 'repair_cached_descriptor'
        : !providerRestartSafe
          ? preview.providerSync.replayPolicy || preview.providerContract.nextAction || 'refresh_provider_sync_before_replay'
          : !preview.boundaryScope.allowed || preview.boundaryScope.blockedReasons.length > 0
            ? 'repair_tenant_permissions'
            : preview.clientWorkflowHandoff.recoveryCommand || preview.clientWorkflowHandoff.primaryAction || 'review_compile_cache_status';

  return {
    index,
    key: preview.key,
    requestKey: preview.requestKey,
    sourceHash: preview.sourceHash,
    contractHash: preview.contractHash,
    createdAt: positiveInteger(entry.createdAt, now),
    updatedAt: positiveInteger(entry.updatedAt, now),
    lastAccessedAt: positiveInteger(entry.lastAccessedAt, now),
    expiresAt,
    ttlRemainingMs,
    hits: preview.hits,
    stale: preview.stale,
    expired,
    replaySafe,
    restartSafe: replaySafe || preview.clientWorkflowHandoff.workflowState === 'waiting_for_acceptance',
    status: replaySafe ? 'restorable' : 'recovery_required',
    recoveryCommand,
    blockedReasons,
    idempotencyKey: buildPersistedCommandKey([
      preview.key,
      preview.requestKey,
      preview.contractHash,
      recoveryCommand,
      blockedReasons.join('|'),
    ]),
    providerSync: preview.providerSync,
    providerContract: preview.providerContract,
    boundaryScope: preview.boundaryScope,
    clientWorkflowHandoff: preview.clientWorkflowHandoff,
  };
}

export function buildMailchimpCompileCachePersistedSnapshotState(source = {}, runtime = {}) {
  const normalized = normalizePersistedSnapshotSource(source, runtime);
  const now = positiveInteger(runtime.now ?? source.now ?? normalized.generatedAt, normalized.generatedAt);
  const entries = normalized.entries
    .map((entry, index) => normalizePersistedSnapshotEntry(entry, index, now))
    .sort((left, right) => left.key.localeCompare(right.key) || left.index - right.index);
  const restorableEntries = entries.filter((entry) => entry.replaySafe);
  const recoveryEntries = entries.filter((entry) => !entry.replaySafe);
  const blockedReasons = stableList([
    ...(normalized.exportSummary.exportReady === false ? ['compile_cache_export_not_ready'] : []),
    ...(normalized.lifecycle.blocked === true ? ['compile_cache_lifecycle_blocked'] : []),
    ...stableList(normalized.exportSummary.blockedReasons),
    ...recoveryEntries.flatMap((entry) => entry.blockedReasons),
  ]);
  const restartSafe = entries.length === restorableEntries.length
    && normalized.exportSummary.exportReady !== false
    && normalized.lifecycle.blocked !== true
    && blockedReasons.length === 0;
  const restoreMode = entries.length === 0
    ? 'cold_start'
    : restartSafe
      ? 'full_replay'
      : restorableEntries.length > 0
      ? 'partial_replay_with_recovery'
        : 'rebuild_before_replay';
  const primaryRecoveryCommand = restartSafe
    ? 'observe'
    : recoveryEntries.find((entry) => entry.recoveryCommand)?.recoveryCommand
      || normalized.lifecycle.nextAction
      || normalized.exportSummary.reportingState?.nextAction
      || 'refresh_compile_cache';
  const commandLedger = [
    ...entries.map((entry) => ({
      key: entry.key,
      requestKey: entry.requestKey,
      command: entry.recoveryCommand,
      idempotencyKey: entry.idempotencyKey,
      status: entry.status,
      replaySafe: entry.replaySafe,
      restartSafe: entry.restartSafe,
      blockedReasons: entry.blockedReasons,
    })),
    ...(normalized.lifecycle.controlContract?.idempotencyKey ? [{
      key: '',
      requestKey: '',
      command: normalized.lifecycle.nextAction || normalized.lifecycle.controlContract.state?.nextAction || 'review_compile_cache_lifecycle',
      idempotencyKey: normalized.lifecycle.controlContract.idempotencyKey,
      status: normalized.lifecycle.blocked ? 'blocked' : 'observed',
      replaySafe: normalized.lifecycle.blocked !== true,
      restartSafe: normalized.lifecycle.blocked !== true,
      blockedReasons: stableList(normalized.lifecycle.validationSummary?.blockedReasons),
    }] : []),
  ];
  const recoveryJournal = buildMailchimpCompileCacheRecoveryJournal({
    namespace: normalized.namespace,
    status: restoreMode,
    commandLedger,
    lifecycle: normalized.lifecycle,
  });

  return {
    protocol: 'aios.compile-cache-persisted-snapshot-state.mailchimp.v1',
    namespace: normalized.namespace,
    generatedAt: now,
    restoreMode,
    restartSafe: restartSafe && recoveryJournal.restartSafe !== false,
    replaySafe: entries.length > 0 && restartSafe && recoveryJournal.replaySafe !== false,
    statusRouteState: restoreMode === 'cold_start'
      ? 'cold_start'
      : restartSafe && recoveryJournal.restartSafe !== false
        ? 'ready'
        : 'recovery_required',
    nextAction: primaryRecoveryCommand,
    recoveryCommand: primaryRecoveryCommand,
    idempotencyKey: buildPersistedCommandKey([
      normalized.namespace,
      restoreMode,
      `entries:${entries.length}`,
      `restorable:${restorableEntries.length}`,
      blockedReasons.join('|'),
    ]),
    options: {
      ttlMs: normalized.ttlMs,
      limit: normalized.limit,
    },
    counters: {
      entries: entries.length,
      restorableEntries: restorableEntries.length,
      recoveryEntries: recoveryEntries.length,
      staleEntries: entries.filter((entry) => entry.stale).length,
      expiredEntries: entries.filter((entry) => entry.expired).length,
      providerBlockedEntries: entries.filter((entry) => entry.blockedReasons.includes('provider_sync_not_restart_safe')).length,
      boundaryBlockedEntries: entries.filter((entry) => entry.blockedReasons.includes('tenant_boundary_not_replay_safe')).length,
    },
    blockedReasons: stableList([
      ...blockedReasons,
      ...recoveryJournal.blockedReasons,
    ]),
    entries,
    commandLedger,
    recoveryJournal,
    restorePlan: {
      replayEntryKeys: restorableEntries.map((entry) => entry.key),
      recoverEntryKeys: recoveryEntries.map((entry) => entry.key),
      commands: stableList(commandLedger.map((item) => item.command)),
      restartSafeCommands: recoveryJournal.entries
        .filter((entry) => entry.restartSafe)
        .map((entry) => entry.idempotencyKey),
      conflictingCommands: recoveryJournal.entries
        .filter((entry) => entry.conflict)
        .map((entry) => entry.idempotencyKey),
      latestHistoryAt: normalized.history.timeline?.latestAt ?? normalized.exportSummary.timeline?.latestAt ?? null,
      exportReady: normalized.exportSummary.exportReady === true,
      lifecycleReady: normalized.lifecycle.blocked !== true,
    },
  };
}

function normalizeCompileCacheUiSource(source = {}) {
  const snapshot = source.protocol === 'aios.compile-cache-snapshot.mailchimp.v1'
    ? source
    : source.snapshot && typeof source.snapshot === 'object'
      ? source.snapshot
      : {};
  const compileCache = source.compileCache && typeof source.compileCache === 'object'
    ? source.compileCache
    : source.protocol === 'aios.compile-cache-status.mailchimp.v1'
      ? source
      : {};
  const entries = Array.isArray(snapshot.entries)
    ? snapshot.entries
    : Array.isArray(source.entries)
      ? source.entries
      : compileCache.cacheKey || compileCache.key
        ? [compileCache]
        : [];
  const analytics = snapshot.analytics && typeof snapshot.analytics === 'object'
    ? snapshot.analytics
    : compileCache.report && typeof compileCache.report === 'object'
      ? { counters: compileCache.report.counters || {}, timeline: compileCache.report.timeline || {} }
      : source.analytics && typeof source.analytics === 'object'
        ? source.analytics
        : {};
  const exportSummary = snapshot.exportSummary && typeof snapshot.exportSummary === 'object'
    ? snapshot.exportSummary
    : compileCache.report && typeof compileCache.report === 'object'
      ? compileCache.report
      : source.exportSummary && typeof source.exportSummary === 'object'
        ? source.exportSummary
        : buildMailchimpCompileCacheExportSummary({
          protocol: 'aios.compile-cache-snapshot.mailchimp.v1',
          namespace: snapshot.namespace || source.namespace || compileCache.namespace || 'mailchimp',
          entries,
          analytics,
        });
  const lifecycle = snapshot.lifecycle && typeof snapshot.lifecycle === 'object'
    ? snapshot.lifecycle
    : compileCache.lifecycle && typeof compileCache.lifecycle === 'object'
      ? compileCache.lifecycle
      : source.lifecycle && typeof source.lifecycle === 'object'
        ? source.lifecycle
        : buildMailchimpCompileCacheLifecycleDecision({
          protocol: 'aios.compile-cache-snapshot.mailchimp.v1',
          namespace: snapshot.namespace || source.namespace || compileCache.namespace || 'mailchimp',
          entries,
          analytics,
          exportSummary,
        }, source.lifecycleSettings || {});
  const history = snapshot.history && typeof snapshot.history === 'object'
    ? snapshot.history
    : compileCache.history && typeof compileCache.history === 'object'
      ? compileCache.history
      : source.history && typeof source.history === 'object'
        ? source.history
        : buildMailchimpCompileCacheHistoryReport({
          namespace: snapshot.namespace || source.namespace || compileCache.namespace || 'mailchimp',
          entries,
          analytics,
        }, { now: source.now ?? snapshot.generatedAt });
  const providerSyncCheckpoint = compileCache.providerSyncCheckpoint
    || source.providerSyncCheckpoint
    || entries.find((entry) => entry.providerSyncCheckpoint)?.providerSyncCheckpoint
    || {};
  const boundaryScope = compileCache.boundaryScope
    || source.boundaryScope
    || entries.find((entry) => entry.boundaryScope)?.boundaryScope
    || {};

  return {
    namespace: compactString(snapshot.namespace || source.namespace || compileCache.namespace || 'mailchimp'),
    cacheKey: compactString(compileCache.cacheKey || compileCache.key || entries[0]?.key),
    status: compactString(compileCache.status || source.cacheStatus || (entries.length > 0 ? 'compiled' : 'uncached')),
    replayed: compileCache.replayed === true || source.replayed === true,
    stale: compileCache.stale === true || entries.some((entry) => entry.stale === true),
    ttlRemainingMs: compileCache.ttlRemainingMs ?? entries[0]?.ttlRemainingMs ?? null,
    entries,
    analytics,
    exportSummary,
    lifecycle,
    history,
    providerSyncCheckpoint,
    boundaryScope,
  };
}

export function buildMailchimpCompileCacheUiHandoff(source = {}, runtime = {}) {
  const normalized = normalizeCompileCacheUiSource(source);
  const entries = normalized.entries.map(normalizePreviewEntry);
  const counters = {
    ...(normalized.analytics.counters || {}),
    ...(normalized.exportSummary.counters || {}),
  };
  const timeline = {
    ...(normalized.analytics.timeline || {}),
    ...(normalized.exportSummary.timeline || {}),
  };
  const providerSyncCheckpoint = normalized.providerSyncCheckpoint && normalized.providerSyncCheckpoint.protocol
    ? normalized.providerSyncCheckpoint
    : buildMailchimpCompileCacheProviderSyncCheckpoint(source, runtime);
  const providerServiceContract = providerSyncCheckpoint.providerServiceContract
    && providerSyncCheckpoint.providerServiceContract.protocol === 'aios.compile-cache-provider-service-contract.mailchimp.v1'
    ? providerSyncCheckpoint.providerServiceContract
    : buildMailchimpCompileCacheProviderServiceContract(source, runtime);
  const providerBlockedReasons = stableList(providerSyncCheckpoint.blockedReasons);
  const providerContractBlockedReasons = stableList(providerServiceContract.negotiation?.blockedReasons);
  const boundaryScope = normalized.boundaryScope && normalized.boundaryScope.protocol
    ? normalized.boundaryScope
    : normalizeBoundaryScope(normalized.boundaryScope || {});
  const boundaryBlockedReasons = stableList(boundaryScope.blockedReasons);
  const lifecycleBlockedReasons = stableList(normalized.lifecycle.validationSummary?.blockedReasons);
  const exportBlockedReasons = stableList(normalized.exportSummary.blockedReasons);
  const diagnosticEntries = entries.filter((entry) => entry.diagnostics.errors > 0).map((entry) => entry.key).filter(Boolean);
  const staleEntries = entries.filter((entry) => entry.stale).map((entry) => entry.key).filter(Boolean);
  const providerReady = providerSyncCheckpoint.restartSafe === true
    && providerSyncCheckpoint.capabilitySatisfied !== false
    && providerServiceContract.negotiation?.satisfied !== false
    && providerBlockedReasons.length === 0
    && providerContractBlockedReasons.length === 0;
  const boundaryReady = boundaryScope.allowed !== false && boundaryBlockedReasons.length === 0;
  const exportReady = normalized.exportSummary.exportReady === true
    && staleEntries.length === 0
    && diagnosticEntries.length === 0;
  const lifecycleReady = normalized.lifecycle.blocked !== true
    && normalized.lifecycle.refreshRecommended !== true;
  const acceptedBy = compactString(runtime.acceptance?.acceptedBy || runtime.operatorAcceptance?.acceptedBy);
  const acceptedAt = compactString(runtime.acceptance?.acceptedAt || runtime.operatorAcceptance?.acceptedAt);
  const acceptanceRequired = normalized.lifecycle.blocked === true
    || lifecycleBlockedReasons.includes('operator_hold')
    || providerSyncCheckpoint.restartSafe === false
    || exportReady === false;
  const accepted = runtime.acceptance?.accepted === true
    || runtime.operatorAcceptance?.accepted === true
    || Boolean(acceptedBy && acceptedAt);
  const ready = providerReady && boundaryReady && exportReady && lifecycleReady && (!acceptanceRequired || accepted);
  const nextSteps = [
    ...(boundaryReady ? [] : [{
      action: 'repair_tenant_permissions',
      reason: boundaryBlockedReasons[0] || 'tenant_boundary_not_replay_safe',
      owner: 'operator',
    }]),
    ...(providerReady ? [] : [{
      action: providerContractBlockedReasons.length > 0
        ? providerServiceContract.negotiation?.nextAction || 'renegotiate_mailchimp_provider_capabilities'
        : providerSyncCheckpoint.replayPolicy || 'refresh_provider_sync_before_replay',
      reason: providerContractBlockedReasons[0] || providerBlockedReasons[0] || 'provider_sync_checkpoint_not_restart_safe',
      owner: 'provider',
    }]),
    ...(staleEntries.length > 0 ? [{
      action: 'refresh_compile_cache',
      reason: 'stale_entries',
      owner: 'compiler',
    }] : []),
    ...(diagnosticEntries.length > 0 ? [{
      action: 'repair_cached_descriptor',
      reason: 'diagnostic_errors',
      owner: 'compiler',
    }] : []),
    ...(!exportReady && staleEntries.length === 0 && diagnosticEntries.length === 0 ? [{
      action: 'review_compile_cache_export',
      reason: exportBlockedReasons[0] || 'export_not_ready',
      owner: 'operator',
    }] : []),
    ...(!lifecycleReady ? [{
      action: normalized.lifecycle.nextAction || 'review_compile_cache_lifecycle',
      reason: lifecycleBlockedReasons[0] || 'lifecycle_refresh_recommended',
      owner: normalized.lifecycle.controls?.operatorHold ? 'operator' : 'compiler',
    }] : []),
    ...(acceptanceRequired && !accepted ? [{
      action: 'request_compile_cache_acceptance',
      reason: 'operator_acceptance_required',
      owner: 'operator',
    }] : []),
  ];

  if (nextSteps.length === 0) {
    nextSteps.push({
      action: normalized.replayed ? 'verify_cached_descriptor' : 'reuse_compile_cache',
      reason: 'ready',
      owner: 'runtime',
    });
  }
  const validationBlockedReasons = stableList([
    ...providerBlockedReasons,
    ...providerContractBlockedReasons,
    ...boundaryBlockedReasons,
    ...lifecycleBlockedReasons,
    ...exportBlockedReasons,
    ...(providerReady ? [] : ['provider_sync_not_ready']),
    ...(boundaryReady ? [] : ['tenant_boundary_not_ready']),
    ...(exportReady ? [] : ['compile_cache_export_not_ready']),
    ...(lifecycleReady ? [] : ['compile_cache_lifecycle_not_ready']),
    ...(acceptanceRequired && !accepted ? ['operator_acceptance_missing'] : []),
  ]);
  const replayBarrier = buildMailchimpCompileCacheReplayBarrier({
    cacheKey: normalized.cacheKey,
    status: normalized.status,
    replayed: normalized.replayed,
    providerSyncCheckpoint,
    providerServiceContract,
    uiHandoff: {
      cacheKey: normalized.cacheKey,
      status: normalized.status,
      replayed: normalized.replayed,
      readiness: {
        ready,
        cacheReady: exportReady && lifecycleReady,
        providerReady,
        boundaryReady,
        exportReady,
        lifecycleReady,
        nextStep: nextSteps[0]?.action || 'reuse_compile_cache',
      },
      acceptance: {
        required: acceptanceRequired,
        accepted: !acceptanceRequired || accepted,
        acceptedBy,
        acceptedAt,
        reason: acceptanceRequired
          ? providerSyncCheckpoint.restartSafe === false
            ? 'Provider sync checkpoint must be accepted or refreshed before replay.'
            : exportReady === false
              ? 'Compile cache export needs review before user-visible handoff.'
              : 'Compile cache lifecycle requires operator acceptance.'
          : '',
      },
      validationSummary: {
        blockedReasons: validationBlockedReasons,
      },
      routeHints: {
        primaryAction: nextSteps[0]?.action || 'reuse_compile_cache',
        recoveryCommand: ready
          ? 'observe'
          : nextSteps[0]?.action === 'request_compile_cache_acceptance'
            ? 'hold_for_operator'
            : nextSteps[0]?.action || 'refresh_compile_cache',
        statusRouteState: ready ? 'ready' : 'needs_attention',
      },
    },
  }, runtime);
  const acceptancePreview = buildMailchimpCompileCacheAcceptancePreview({
    namespace: normalized.namespace,
    cacheKey: normalized.cacheKey,
    status: normalized.status,
    replayed: normalized.replayed,
    entries,
    counters,
    readiness: {
      ready,
      cacheReady: exportReady && lifecycleReady,
      providerReady,
      boundaryReady,
      exportReady,
      lifecycleReady,
      nextStep: nextSteps[0]?.action || 'reuse_compile_cache',
    },
    acceptance: {
      required: acceptanceRequired,
      accepted: !acceptanceRequired || accepted,
      acceptedBy,
      acceptedAt,
      reason: acceptanceRequired
        ? providerSyncCheckpoint.restartSafe === false
          ? 'Provider sync checkpoint must be accepted or refreshed before replay.'
          : exportReady === false
            ? 'Compile cache export needs review before user-visible handoff.'
            : 'Compile cache lifecycle requires operator acceptance.'
        : '',
    },
    validationSummary: {
      ready,
      blockedReasons: validationBlockedReasons,
      counters: {
        entries: positiveInteger(counters.entries, entries.length),
        staleEntries: staleEntries.length || positiveInteger(counters.staleEntries, 0),
        diagnosticEntries: diagnosticEntries.length || positiveInteger(counters.errorEntries, 0),
        lookupEvents: positiveInteger(counters.lookupEvents, 0),
      },
    },
    nextSteps,
    providerSyncCheckpoint,
    providerServiceContract,
    boundaryScope,
    lifecycle: normalized.lifecycle,
    exportSummary: normalized.exportSummary,
    history: normalized.history,
    routeHints: {
      primaryAction: replayBarrier.route.primaryAction,
      recoveryCommand: replayBarrier.recoveryCommand,
      statusRouteState: replayBarrier.route.statusRouteState,
      canReplayCachedDescriptor: replayBarrier.canReplayCachedDescriptor,
    },
  }, runtime);
  const acceptanceChecklist = buildMailchimpCompileCacheAcceptanceChecklist({
    acceptancePreview,
    nextSteps,
  }, runtime);
  const decisionMatrix = buildMailchimpCompileCacheDecisionMatrix({
    namespace: normalized.namespace,
    cacheKey: normalized.cacheKey,
    status: normalized.status,
    replayed: normalized.replayed,
    readiness: {
      ready,
      cacheReady: exportReady && lifecycleReady,
      providerReady,
      boundaryReady,
      exportReady,
      lifecycleReady,
      nextStep: nextSteps[0]?.action || 'reuse_compile_cache',
    },
    acceptance: {
      required: acceptanceRequired,
      accepted: !acceptanceRequired || accepted,
      acceptedBy,
      acceptedAt,
      reason: acceptanceRequired
        ? providerSyncCheckpoint.restartSafe === false
          ? 'Provider sync checkpoint must be accepted or refreshed before replay.'
          : exportReady === false
            ? 'Compile cache export needs review before user-visible handoff.'
            : 'Compile cache lifecycle requires operator acceptance.'
        : '',
    },
    validationSummary: {
      ready,
      blockedReasons: validationBlockedReasons,
      counters: {
        entries: positiveInteger(counters.entries, entries.length),
        staleEntries: staleEntries.length || positiveInteger(counters.staleEntries, 0),
        diagnosticEntries: diagnosticEntries.length || positiveInteger(counters.errorEntries, 0),
        lookupEvents: positiveInteger(counters.lookupEvents, 0),
      },
    },
    acceptancePreview,
    acceptanceChecklist,
    replayBarrier,
    providerReplayHandoff: replayBarrier.providerReplayHandoff || {},
    clientWorkflowHandoff: entries[0]?.clientWorkflowHandoff || {},
    lifecycleExecution: {
      state: compactString(normalized.lifecycle.executionPlan?.state || (lifecycleReady ? 'ready' : 'blocked')),
      executable: normalized.lifecycle.executionPlan?.executable === true,
      nextAction: compactString(normalized.lifecycle.nextAction),
      blockedReasons: stableList(normalized.lifecycle.executionPlan?.blockedReasons),
      deferredReasons: stableList(normalized.lifecycle.executionPlan?.deferredReasons),
      commandAccepted: normalized.lifecycle.controlContract?.commandAccepted === true,
      willChangeState: normalized.lifecycle.controlContract?.state?.willChangeState === true,
    },
    routeHints: {
      primaryAction: acceptanceChecklist.route.primaryAction,
      statusRouteState: acceptanceChecklist.route.statusRouteState,
      recoveryCommand: acceptanceChecklist.route.recoveryCommand,
      canReplayCachedDescriptor: acceptancePreview.route.canReplayCachedDescriptor,
    },
  }, runtime);

  return {
    protocol: 'aios.compile-cache-ui-handoff.mailchimp.v1',
    namespace: normalized.namespace,
    cacheKey: normalized.cacheKey,
    status: normalized.status,
    replayed: normalized.replayed,
    preview: {
      title: `Mailchimp compile cache ${normalized.status || 'status'}`,
      cacheKey: normalized.cacheKey,
      namespace: normalized.namespace,
      entries: entries.slice(0, 5),
      totalEntries: positiveInteger(counters.entries, entries.length),
      staleEntries: positiveInteger(counters.staleEntries, staleEntries.length),
      errorEntries: positiveInteger(counters.errorEntries, diagnosticEntries.length),
      hitRate: normalized.analytics.ratios?.hitRate ?? normalized.exportSummary.ratios?.hitRate ?? null,
      latestAt: timeline.latestAt ?? null,
      latestKind: compactString(timeline.latestKind),
      latestStatus: compactString(timeline.latestStatus),
      reportingState: compactString(normalized.history.reportingState?.state),
      reportingNextAction: compactString(normalized.history.reportingState?.nextAction),
      historySnapshotCount: positiveInteger(normalized.history.timeline?.snapshotCount, 0),
      acceptanceState: acceptancePreview.state,
      previewSummary: acceptancePreview.preview.summary,
      checklistState: acceptanceChecklist.state,
      checklistBlockingItems: acceptanceChecklist.counts.blocking,
      decisionState: decisionMatrix.routeState,
      decisionSummary: decisionMatrix.preview.summary,
      decisionBlockingRows: decisionMatrix.counts.blocking,
      decisionPrimaryAction: decisionMatrix.primaryAction,
      providerSync: {
        state: compactString(providerSyncCheckpoint.state || 'stale'),
        restartSafe: providerSyncCheckpoint.restartSafe === true,
        replayPolicy: compactString(providerSyncCheckpoint.replayPolicy),
        externalHandoffState: compactString(providerSyncCheckpoint.externalHandoffState || 'local_only'),
        externalRequestId: compactString(providerSyncCheckpoint.externalRequestId),
        cursorRequired: providerSyncCheckpoint.cursorRequired === true,
        cursorPresent: Boolean(providerSyncCheckpoint.cursor),
        capabilitySatisfied: providerSyncCheckpoint.capabilitySatisfied !== false,
      },
      providerContract: {
        provider: providerServiceContract.provider,
        service: providerServiceContract.service,
        primaryResource: providerServiceContract.primaryResource,
        resourceKinds: providerServiceContract.resourceKinds,
        requiredCapabilities: providerServiceContract.requiredCapabilities,
        grantedCapabilities: providerServiceContract.grantedCapabilities,
        missingCapabilities: providerServiceContract.missingCapabilities,
        negotiationState: providerServiceContract.negotiation?.state,
        negotiationSatisfied: providerServiceContract.negotiation?.satisfied === true,
        nextAction: providerServiceContract.negotiation?.nextAction,
        syncCursorPartition: providerServiceContract.syncMetadata?.cursorPartition,
        externalRouteState: providerServiceContract.externalHandoff?.routeState,
        blockedReasons: providerContractBlockedReasons,
      },
      boundaryScope: {
        tenant: boundaryScope.tenant,
        scope: boundaryScope.scope,
        workspace: boundaryScope.workspace,
        allowed: boundaryScope.allowed !== false,
        auditDecision: compactString(boundaryScope.audit?.decision),
        blockedReasons: boundaryBlockedReasons,
      },
    },
    readiness: {
      ready,
      cacheReady: exportReady && lifecycleReady,
      providerReady,
      boundaryReady,
      exportReady,
      lifecycleReady,
      nextStep: nextSteps[0]?.action || 'reuse_compile_cache',
    },
    lifecycleExecution: {
      state: compactString(normalized.lifecycle.executionPlan?.state || (lifecycleReady ? 'ready' : 'blocked')),
      executable: normalized.lifecycle.executionPlan?.executable === true,
      command: compactString(normalized.lifecycle.command),
      candidateCommand: compactString(normalized.lifecycle.executionPlan?.candidateCommand || normalized.lifecycle.command),
      nextAction: compactString(normalized.lifecycle.nextAction),
      nextState: compactString(normalized.lifecycle.nextState?.state || normalized.lifecycle.controlContract?.state?.next),
      routeState: compactString(normalized.lifecycle.nextState?.routeState || normalized.lifecycle.controlContract?.state?.routeState),
      scheduleMode: compactString(normalized.lifecycle.schedule?.mode || normalized.lifecycle.executionPlan?.schedule?.mode),
      scheduleDue: normalized.lifecycle.executionPlan?.schedule?.due !== false,
      nextEligibleAt: normalized.lifecycle.executionPlan?.schedule?.nextEligibleAt ?? null,
      delayMs: positiveInteger(normalized.lifecycle.executionPlan?.schedule?.delayMs, 0),
      deferredReasons: stableList(normalized.lifecycle.executionPlan?.deferredReasons),
      commandAccepted: normalized.lifecycle.controlContract?.commandAccepted === true,
      willChangeState: normalized.lifecycle.controlContract?.state?.willChangeState === true,
      mutatesSettings: normalized.lifecycle.controlContract?.state?.mutatesSettings === true,
      mutatesCache: normalized.lifecycle.controlContract?.state?.mutatesCache === true,
      effective: normalized.lifecycle.controlContract?.effective || null,
      idempotencyKey: compactString(normalized.lifecycle.nextState?.idempotencyKey || normalized.lifecycle.controlContract?.idempotencyKey),
    },
    acceptance: {
      required: acceptanceRequired,
      accepted: !acceptanceRequired || accepted,
      acceptedBy,
      acceptedAt,
      reason: acceptanceRequired
        ? providerSyncCheckpoint.restartSafe === false
          ? 'Provider sync checkpoint must be accepted or refreshed before replay.'
          : exportReady === false
            ? 'Compile cache export needs review before user-visible handoff.'
            : 'Compile cache lifecycle requires operator acceptance.'
          : '',
      previewState: acceptancePreview.state,
      canAccept: acceptancePreview.acceptance.canAccept,
      requiredBecause: acceptancePreview.acceptance.requiredBecause,
      checklistToken: acceptanceChecklist.acceptance.token,
      checklistState: acceptanceChecklist.state,
    },
    validationSummary: {
      ready,
      blockedReasons: validationBlockedReasons,
      warnings: acceptancePreview.validation.warnings,
      checks: acceptancePreview.validation.checks,
      checklist: {
        state: acceptanceChecklist.state,
        ready: acceptanceChecklist.ready,
        counts: acceptanceChecklist.counts,
        blockingItems: acceptanceChecklist.blockingItems,
      },
      decisionMatrix: {
        ready: decisionMatrix.ready,
        routeState: decisionMatrix.routeState,
        counts: decisionMatrix.counts,
        blockingRows: decisionMatrix.blockingRows.map((row) => ({
          key: row.key,
          owner: row.owner,
          severity: row.severity,
          nextAction: row.nextAction,
          blockedReasons: row.blockedReasons,
        })),
      },
      counters: {
        entries: positiveInteger(counters.entries, entries.length),
        staleEntries: staleEntries.length || positiveInteger(counters.staleEntries, 0),
        diagnosticEntries: diagnosticEntries.length || positiveInteger(counters.errorEntries, 0),
        lookupEvents: positiveInteger(counters.lookupEvents, 0),
        hitEvents: positiveInteger(counters.hitEvents, 0),
        missEvents: positiveInteger(counters.missEvents, 0),
      },
    },
    nextSteps,
    routeHints: {
      primaryAction: decisionMatrix.route.primaryAction,
      statusRouteState: decisionMatrix.route.statusRouteState,
      recoveryCommand: decisionMatrix.route.recoveryCommand,
      canReplayCachedDescriptor: decisionMatrix.route.canReplayCachedDescriptor,
      acceptanceToken: acceptanceChecklist.route.acceptanceToken,
      decisionMatrixId: decisionMatrix.idempotencyKey,
    },
    acceptancePreview,
    acceptanceChecklist,
    decisionMatrix,
    replayBarrier,
  };
}

export function buildMailchimpCompileCacheLifecycleDecision(snapshot = {}, settings = {}) {
  const now = nowFrom(settings);
  const normalizedSnapshot = normalizeSnapshotForLifecycle(snapshot, now);
  const lifecycle = normalizeCacheLifecycleSettings(settings.lifecycle || settings.lifecycleSettings || settings);
  const diagnostics = validateCacheLifecycleSettings(lifecycle, normalizedSnapshot);
  const entries = normalizedSnapshot.entries;
  const staleEntries = entries.filter((entry) => entry.stale).map((entry) => entry.key).sort();
  const expiredEntries = entries
    .filter((entry) => entry.expiresAt != null && now >= entry.expiresAt)
    .map((entry) => entry.key)
    .sort();
  const diagnosticEntries = entries
    .filter((entry) => (entry.diagnostics?.errors || 0) > 0)
    .map((entry) => entry.key)
    .sort();
  const exportReady = normalizedSnapshot.exportSummary.exportReady === true
    && staleEntries.length === 0
    && diagnosticEntries.length === 0;
  const metrics = {
    staleEntries,
    expiredEntries,
    diagnosticEntries,
    exportReady,
  };
  const executionPlan = buildLifecycleExecutionPlan({
    lifecycle,
    snapshot: normalizedSnapshot,
    diagnostics,
    metrics,
    now,
  });
  const controlContract = buildMailchimpCompileCacheLifecycleControlContract({
    namespace: normalizedSnapshot.namespace,
    lifecycle,
    executionPlan,
    metrics,
    diagnostics,
    now,
  });
  const blocked = diagnostics.some((diagnostic) => diagnostic.severity === 'error')
    || (lifecycle.enabled === false && lifecycle.command !== 'enable')
    || (lifecycle.controls.operatorHold === true && lifecycle.command !== 'enable')
    || (lifecycle.command === 'export' && lifecycle.controls.requireCleanExport && !exportReady);
  const refreshRecommended = staleEntries.length > 0
    || expiredEntries.length > 0
    || diagnosticEntries.length > 0
    || exportReady === false;
  const nextAction = blocked
    ? lifecycle.controls.operatorHold
      ? 'await_compile_cache_operator_release'
      : lifecycle.enabled === false
        ? 'enable_compile_cache_lifecycle'
        : diagnostics.some((diagnostic) => diagnostic.severity === 'error')
          ? 'repair_compile_cache_lifecycle_settings'
          : 'review_compile_cache_export'
    : executionPlan.state === 'deferred'
      ? executionPlan.nextAction
    : executionPlan.candidateCommand !== 'observe'
      ? executionPlan.commandAction
    : lifecycle.command === 'hold'
      ? 'hold_compile_cache'
      : lifecycle.command === 'disable'
        ? 'disable_compile_cache_lifecycle'
        : lifecycle.command === 'enable'
          ? 'enable_compile_cache_lifecycle'
          : refreshRecommended && lifecycle.controls.allowRefresh
            ? 'refresh_compile_cache'
            : lifecycle.command === 'evict_stale' && lifecycle.controls.allowEvictStale
              ? 'evict_stale_compile_cache_entries'
              : lifecycle.command === 'export' && lifecycle.controls.allowExport
                ? 'export_compile_cache_summary'
                : 'reuse_compile_cache';

  return {
    protocol: 'aios.compile-cache-lifecycle.mailchimp.v1',
    namespace: normalizedSnapshot.namespace,
    enabled: lifecycle.enabled,
    command: lifecycle.command,
    nextAction,
    blocked,
    refreshRecommended,
    exportReady,
    schedule: {
      ...lifecycle.schedule,
      nextRunAt: lifecycle.schedule.runAt || null,
      scheduledAt: executionPlan.schedule.scheduledAt,
      due: executionPlan.schedule.due,
      nextEligibleAt: executionPlan.schedule.nextEligibleAt,
      delayMs: executionPlan.schedule.delayMs,
      cooldown: executionPlan.cooldown,
    },
    executionPlan,
    controlContract,
    controls: {
      ...lifecycle.controls,
      canEnable: true,
      canDisable: lifecycle.enabled === true,
      canRefresh: !blocked && executionPlan.executable && lifecycle.controls.allowRefresh,
      canEvictStale: !blocked && executionPlan.executable && lifecycle.controls.allowEvictStale && staleEntries.length > 0,
      canExport: !blocked && executionPlan.executable && lifecycle.controls.allowExport && exportReady,
      canRunNow: !blocked && executionPlan.executable,
      deferred: executionPlan.state === 'deferred',
      commandAccepted: controlContract.commandAccepted,
      mutatesSettings: controlContract.state.mutatesSettings,
      mutatesCache: controlContract.state.mutatesCache,
      willChangeState: controlContract.state.willChangeState,
    },
    nextState: {
      state: controlContract.state.next,
      routeState: controlContract.state.routeState,
      nextAction: controlContract.state.nextAction,
      idempotencyKey: controlContract.idempotencyKey,
      effectiveEnabled: controlContract.effective.enabled,
      effectiveOperatorHold: controlContract.effective.operatorHold,
    },
    validationSummary: {
      totalEntries: entries.length,
      staleEntries: staleEntries.length,
      expiredEntries: expiredEntries.length,
      diagnosticEntries: diagnosticEntries.length,
      diagnostics: diagnostics.length,
      blockedReasons: [
        ...(lifecycle.enabled === false ? ['lifecycle_disabled'] : []),
        ...(lifecycle.controls.operatorHold ? ['operator_hold'] : []),
        ...(staleEntries.length > 0 ? ['stale_entries'] : []),
        ...(expiredEntries.length > 0 ? ['expired_entries'] : []),
        ...(diagnosticEntries.length > 0 ? ['diagnostic_errors'] : []),
        ...executionPlan.blockedReasons,
        ...executionPlan.deferredReasons,
        ...diagnostics.map((diagnostic) => diagnostic.code),
      ].sort(),
    },
    diagnostics,
    staleEntryKeys: staleEntries,
    expiredEntryKeys: expiredEntries,
    diagnosticEntryKeys: diagnosticEntries,
  };
}

function buildCacheAnalytics(entries, events, now) {
  const summaries = entries.map((entry) => summarizeEntry(entry, now));
  const timeline = summarizeCacheTimeline(events);
  const hitEvents = timeline.eventsByStatus.hit || 0;
  const missEvents = timeline.eventsByStatus.miss || 0;
  const lookupEvents = hitEvents + missEvents;
  const staleEntries = summaries.filter((entry) => entry.stale).length;
  const expiredEntries = entries.filter((entry) => isExpired(entry, now)).length;
  const diagnosticTotals = summaries.reduce((totals, entry) => {
    totals.errors += entry.diagnostics.errors || 0;
    totals.warnings += entry.diagnostics.warnings || 0;
    totals.total += entry.diagnostics.total || 0;
    return totals;
  }, { errors: 0, warnings: 0, total: 0 });

  return {
    protocol: 'aios.compile-cache-analytics.mailchimp.v1',
    counters: {
      entries: summaries.length,
      staleEntries,
      expiredEntries,
      totalEntryHits: summaries.reduce((total, entry) => total + entry.hits, 0),
      lookupEvents,
      hitEvents,
      missEvents,
      storeEvents: timeline.eventsByKind.store || 0,
      evictionEvents: timeline.eventsByKind.evict || 0,
      invalidationEvents: timeline.eventsByKind.invalidate || 0,
      diagnosticErrors: diagnosticTotals.errors,
      diagnosticWarnings: diagnosticTotals.warnings,
      diagnosticsTotal: diagnosticTotals.total,
    },
    ratios: {
      hitRate: lookupEvents === 0 ? null : Number((hitEvents / lookupEvents).toFixed(4)),
      staleEntryRate: summaries.length === 0 ? 0 : Number((staleEntries / summaries.length).toFixed(4)),
    },
    timeline: {
      totalEvents: timeline.totalEvents,
      firstAt: timeline.firstAt,
      latestAt: timeline.latestAt,
      latestKind: timeline.latestKind,
      latestStatus: timeline.latestStatus,
      eventsByKind: timeline.eventsByKind,
      eventsByStatus: timeline.eventsByStatus,
    },
  };
}

function buildCompileCacheRecoveryCommandRows(entries = [], namespace = 'mailchimp') {
  return entries.flatMap((entry) => {
    const key = compactString(entry.key || entry.cacheKey || entry.identity?.cacheKey);
    const requestKey = compactString(entry.requestKey || entry.identity?.requestKey);
    const providerCheckpoint = entry.providerSyncCheckpoint || {};
    const providerContract = entry.providerServiceContract || providerCheckpoint.providerServiceContract || {};
    const boundary = entry.boundaryCheckpoint || entry.boundaryScope || {};
    const workflow = entry.clientWorkflowHandoff
      && entry.clientWorkflowHandoff.protocol === 'aios.compile-cache-client-workflow-handoff.mailchimp.v1'
      ? entry.clientWorkflowHandoff
      : buildMailchimpCompileCacheClientWorkflowHandoff(entry);
    const diagnostics = entry.diagnostics || {};
    const stale = entry.stale === true;
    const commands = [];
    const pushCommand = ({ command, reason, owner = null, severity = 'warning', restartSafe = true, replaySafe = false }) => {
      const normalizedCommand = compactString(command || 'observe');
      const normalizedReason = compactString(reason || 'observe');
      const rowId = stableList([
        namespace,
        key || requestKey || 'entry',
        normalizedCommand,
        normalizedReason,
      ]).join(':').replace(/[^a-zA-Z0-9_.:-]/g, '_');
      commands.push({
        rowId,
        entryKey: key,
        requestKey,
        command: normalizedCommand,
        owner: compactString(owner || RECOVERY_COMMAND_OWNER_HINTS[normalizedCommand] || 'compiler'),
        reason: normalizedReason,
        severity,
        restartSafe: restartSafe === true,
        replaySafe: replaySafe === true,
        idempotencyKey: `${rowId}:command`,
        resumeToken: `${rowId}:resume`,
        nextAction: normalizedCommand,
      });
    };

    if (stale || diagnostics.errors > 0) {
      pushCommand({
        command: 'refresh_compile_cache',
        reason: stale ? 'stale_entry' : 'diagnostic_errors',
        owner: 'compiler',
        severity: diagnostics.errors > 0 ? 'error' : 'warning',
        restartSafe: true,
      });
    }
    if (providerCheckpoint.restartSafe === false || providerCheckpoint.state === 'stale') {
      pushCommand({
        command: compactString(providerCheckpoint.replayPolicy || 'refresh_provider_sync_before_replay'),
        reason: 'provider_sync_not_restart_safe',
        owner: 'provider',
        restartSafe: false,
      });
    }
    if (providerContract.negotiation?.satisfied === false) {
      pushCommand({
        command: providerContract.negotiation?.nextAction || 'renegotiate_mailchimp_provider_capabilities',
        reason: 'provider_capability_negotiation_failed',
        owner: 'provider',
        restartSafe: providerContract.negotiation?.restartSafe === true,
      });
    }
    if (boundary.ready === false || boundary.allowed === false || boundary.replayAllowed === false) {
      pushCommand({
        command: boundary.nextAction || 'repair_tenant_permissions',
        reason: 'tenant_boundary_replay_blocked',
        owner: 'operator',
        severity: 'error',
        restartSafe: false,
      });
    }
    if (workflow.ready === false || stableList(workflow.blockedReasons).length > 0) {
      pushCommand({
        command: workflow.primaryAction || workflow.nextAction || 'inspect_compile_cache_resume_gate',
        reason: 'client_workflow_handoff_blocked',
        owner: workflow.owner || 'runtime',
        restartSafe: workflow.restartSemantics?.replaySafe === true || workflow.ready === true,
        replaySafe: workflow.ready === true,
      });
    }

    if (commands.length === 0) {
      pushCommand({
        command: 'reuse_compile_cache',
        reason: 'entry_replay_ready',
        owner: 'runtime',
        severity: 'info',
        restartSafe: true,
        replaySafe: true,
      });
    }

    return commands;
  }).sort((left, right) => left.rowId.localeCompare(right.rowId));
}

export function buildMailchimpCompileCacheRecoveryExportLane(snapshot = {}) {
  const namespace = compactString(snapshot.namespace || 'mailchimp');
  const entries = Array.isArray(snapshot.entries) ? snapshot.entries : [];
  const analytics = snapshot.analytics && typeof snapshot.analytics === 'object' ? snapshot.analytics : {};
  const rows = buildCompileCacheRecoveryCommandRows(entries, namespace);
  const blockedRows = rows.filter((row) => row.severity === 'error' || row.restartSafe === false);
  const waitingRows = rows.filter((row) => row.severity === 'warning' && row.restartSafe === true && row.replaySafe !== true);
  const readyRows = rows.filter((row) => row.replaySafe === true && row.restartSafe === true);
  const latestAt = analytics.timeline?.latestAt ?? snapshot.generatedAt ?? snapshot.now ?? null;
  const exportReady = blockedRows.length === 0;
  const nextRow = blockedRows[0] || waitingRows[0] || rows.find((row) => row.command !== 'reuse_compile_cache') || rows[0] || null;

  return {
    protocol: 'aios.compile-cache-recovery-export-lane.mailchimp.v1',
    namespace,
    exportReady,
    status: exportReady ? 'export_ready' : 'needs_recovery',
    nextAction: exportReady
      ? 'deliver_compile_cache_export'
      : nextRow?.command || 'review_compile_cache_export',
    nextRowId: nextRow?.rowId || null,
    blockedReasons: stableList([
      ...(blockedRows.length > 0 ? ['recovery_rows_block_export'] : []),
      ...blockedRows.map((row) => row.reason),
    ]),
    counters: {
      entries: entries.length,
      rows: rows.length,
      readyRows: readyRows.length,
      waitingRows: waitingRows.length,
      blockedRows: blockedRows.length,
      compilerOwnedRows: rows.filter((row) => row.owner === 'compiler').length,
      runtimeOwnedRows: rows.filter((row) => row.owner === 'runtime').length,
      providerOwnedRows: rows.filter((row) => row.owner === 'provider').length,
      operatorOwnedRows: rows.filter((row) => row.owner === 'operator').length,
    },
    timeline: {
      latestAt,
      latestKind: 'recovery-export-lane',
      latestStatus: exportReady ? 'ready' : 'blocked',
      rowCount: rows.length,
      rows: rows.map((row, index) => ({
        sequence: index,
        at: latestAt,
        id: row.rowId,
        command: row.command,
        status: row.replaySafe ? 'ready' : row.restartSafe ? 'waiting' : 'blocked',
        owner: row.owner,
        reason: row.reason,
      })),
    },
    rows,
  };
}

export function buildMailchimpCompileCacheExportSummary(snapshot = {}) {
  const entries = Array.isArray(snapshot.entries) ? snapshot.entries : [];
  const analytics = snapshot.analytics || {};
  const history = snapshot.history && typeof snapshot.history === 'object'
    ? snapshot.history
    : buildMailchimpCompileCacheHistoryReport(snapshot, { now: snapshot.now ?? snapshot.generatedAt });
  const counters = analytics.counters || {};
  const staleEntries = entries.filter((entry) => entry.stale).map((entry) => entry.key).sort();
  const errorEntries = entries
    .filter((entry) => (entry.diagnostics?.errors || 0) > 0)
    .map((entry) => entry.key)
    .sort();
  const boundaryBlockedEntries = entries
    .filter((entry) => entry.boundaryScope?.allowed === false || entry.boundaryScope?.blockedReasons?.length > 0)
    .map((entry) => entry.key)
    .sort();
  const providerBlockedEntries = entries
    .filter((entry) => {
      const providerContract = entry.providerServiceContract || entry.providerSyncCheckpoint?.providerServiceContract;
      return entry.providerSyncCheckpoint?.restartSafe === false
        || entry.providerSyncCheckpoint?.blockedReasons?.length > 0
        || providerContract?.negotiation?.satisfied === false
        || providerContract?.negotiation?.blockedReasons?.length > 0;
    })
    .map((entry) => entry.key)
    .sort();
  const clientWorkflowBlockedEntries = entries
    .filter((entry) => {
      const workflow = entry.clientWorkflowHandoff
        && entry.clientWorkflowHandoff.protocol === 'aios.compile-cache-client-workflow-handoff.mailchimp.v1'
        ? entry.clientWorkflowHandoff
        : buildMailchimpCompileCacheClientWorkflowHandoff(entry);
      return workflow.ready === false || workflow.blockedReasons.length > 0;
    })
    .map((entry) => entry.key)
    .sort();
  const clientWorkflowWaitingEntries = entries
    .filter((entry) => {
      const workflow = entry.clientWorkflowHandoff
        && entry.clientWorkflowHandoff.protocol === 'aios.compile-cache-client-workflow-handoff.mailchimp.v1'
        ? entry.clientWorkflowHandoff
        : buildMailchimpCompileCacheClientWorkflowHandoff(entry);
      return workflow.workflowState === 'waiting_for_acceptance';
    })
    .map((entry) => entry.key)
    .sort();
  const recoveryExportLane = snapshot.recoveryExportLane
    && snapshot.recoveryExportLane.protocol === 'aios.compile-cache-recovery-export-lane.mailchimp.v1'
    ? snapshot.recoveryExportLane
    : buildMailchimpCompileCacheRecoveryExportLane({
      namespace: snapshot.namespace || 'mailchimp',
      entries,
      analytics,
      generatedAt: snapshot.generatedAt,
      now: snapshot.now,
    });
  const exportReady = staleEntries.length === 0
    && errorEntries.length === 0
    && boundaryBlockedEntries.length === 0
    && providerBlockedEntries.length === 0
    && clientWorkflowBlockedEntries.length === 0
    && recoveryExportLane.exportReady === true;

  return {
    protocol: 'aios.compile-cache-export.mailchimp.v1',
    namespace: compactString(snapshot.namespace || 'mailchimp'),
    generatedFrom: snapshot.protocol || 'aios.compile-cache-snapshot.mailchimp.v1',
    exportReady,
    blockedReasons: [
      ...(staleEntries.length > 0 ? ['stale_entries'] : []),
      ...(errorEntries.length > 0 ? ['diagnostic_errors'] : []),
      ...(boundaryBlockedEntries.length > 0 ? ['tenant_boundary_blocked'] : []),
      ...(providerBlockedEntries.length > 0 ? ['provider_service_contract_blocked'] : []),
      ...(clientWorkflowBlockedEntries.length > 0 ? ['client_workflow_handoff_blocked'] : []),
      ...(recoveryExportLane.exportReady === false ? ['recovery_export_lane_blocked'] : []),
    ],
    counters: {
      entries: entries.length,
      staleEntries: staleEntries.length,
      errorEntries: errorEntries.length,
      boundaryBlockedEntries: boundaryBlockedEntries.length,
      totalEntryHits: counters.totalEntryHits || 0,
      lookupEvents: counters.lookupEvents || 0,
      hitEvents: counters.hitEvents || 0,
      missEvents: counters.missEvents || 0,
      storeEvents: counters.storeEvents || 0,
      evictionEvents: counters.evictionEvents || 0,
      invalidationEvents: counters.invalidationEvents || 0,
      providerBlockedEntries: history.counters?.providerBlockedEntries || 0,
      providerServiceBlockedEntries: providerBlockedEntries.length,
      boundaryBlockedEntries: boundaryBlockedEntries.length || history.counters?.boundaryBlockedEntries || 0,
      clientWorkflowBlockedEntries: clientWorkflowBlockedEntries.length || history.counters?.clientWorkflowBlockedEntries || 0,
      clientWorkflowWaitingEntries: clientWorkflowWaitingEntries.length || history.counters?.clientWorkflowWaitingEntries || 0,
      recoveryCommandRows: recoveryExportLane.counters.rows,
      recoveryReadyRows: recoveryExportLane.counters.readyRows,
      recoveryWaitingRows: recoveryExportLane.counters.waitingRows,
      recoveryBlockedRows: recoveryExportLane.counters.blockedRows,
    },
    timeline: {
      latestAt: history.timeline?.latestAt ?? analytics.timeline?.latestAt ?? null,
      latestKind: history.timeline?.latestKind || analytics.timeline?.latestKind || null,
      latestStatus: history.timeline?.latestStatus || analytics.timeline?.latestStatus || null,
      totalEvents: history.timeline?.totalEvents || analytics.timeline?.totalEvents || 0,
      snapshotCount: history.timeline?.snapshotCount || 0,
    },
    reportingState: {
      state: compactString(history.reportingState?.state || (exportReady ? 'export_ready' : 'needs_attention')),
      nextAction: compactString(history.reportingState?.nextAction || (exportReady ? 'deliver_compile_cache_export' : 'review_compile_cache_export')),
      hasLookupTraffic: history.reportingState?.hasLookupTraffic === true,
      hasFailures: history.reportingState?.hasFailures === true || !exportReady,
      recoveryLaneStatus: recoveryExportLane.status,
      recoveryLaneNextAction: recoveryExportLane.nextAction,
    },
    recoveryExportLane,
    entries: entries.map((entry) => ({
      key: entry.key,
      requestKey: entry.requestKey,
      stale: entry.stale,
      hits: entry.hits,
      diagnostics: entry.diagnostics,
      ttlRemainingMs: entry.ttlRemainingMs,
      providerSyncCheckpoint: entry.providerSyncCheckpoint || null,
      providerServiceContract: entry.providerServiceContract || entry.providerSyncCheckpoint?.providerServiceContract || null,
      boundaryScope: entry.boundaryScope || null,
      clientWorkflowHandoff: entry.clientWorkflowHandoff || buildMailchimpCompileCacheClientWorkflowHandoff(entry),
    })),
  };
}

function normalizeExportPackageSource(source = {}) {
  const snapshot = source.protocol === 'aios.compile-cache-snapshot.mailchimp.v1'
    ? source
    : source.snapshot && typeof source.snapshot === 'object'
      ? source.snapshot
      : {};
  const compileCache = source.compileCache && typeof source.compileCache === 'object'
    ? source.compileCache
    : source.protocol === 'aios.compile-cache-status.mailchimp.v1'
      ? source
      : {};
  const entries = Array.isArray(snapshot.entries)
    ? snapshot.entries
    : Array.isArray(source.entries)
      ? source.entries
      : compileCache.cacheKey || compileCache.key
        ? [compileCache]
        : [];
  const analytics = snapshot.analytics && typeof snapshot.analytics === 'object'
    ? snapshot.analytics
    : compileCache.analytics && typeof compileCache.analytics === 'object'
      ? compileCache.analytics
      : source.analytics && typeof source.analytics === 'object'
        ? source.analytics
        : {};
  const exportSummary = snapshot.exportSummary && typeof snapshot.exportSummary === 'object'
    ? snapshot.exportSummary
    : compileCache.exportSummary && typeof compileCache.exportSummary === 'object'
      ? compileCache.exportSummary
      : source.exportSummary && typeof source.exportSummary === 'object'
        ? source.exportSummary
        : buildMailchimpCompileCacheExportSummary({
          protocol: 'aios.compile-cache-snapshot.mailchimp.v1',
          namespace: snapshot.namespace || source.namespace || compileCache.namespace || 'mailchimp',
          entries,
          analytics,
        });
  const uiHandoff = compileCache.uiHandoff && typeof compileCache.uiHandoff === 'object'
    ? compileCache.uiHandoff
    : source.uiHandoff && typeof source.uiHandoff === 'object'
      ? source.uiHandoff
      : {};
  const lifecycle = snapshot.lifecycle && typeof snapshot.lifecycle === 'object'
    ? snapshot.lifecycle
    : compileCache.lifecycle && typeof compileCache.lifecycle === 'object'
      ? compileCache.lifecycle
      : source.lifecycle && typeof source.lifecycle === 'object'
        ? source.lifecycle
        : {};
  const history = snapshot.history && typeof snapshot.history === 'object'
    ? snapshot.history
    : compileCache.history && typeof compileCache.history === 'object'
      ? compileCache.history
      : source.history && typeof source.history === 'object'
        ? source.history
        : buildMailchimpCompileCacheHistoryReport({
          namespace: snapshot.namespace || source.namespace || compileCache.namespace || 'mailchimp',
          entries,
          analytics,
        }, { now: source.now ?? snapshot.generatedAt });

  return {
    namespace: compactString(snapshot.namespace || source.namespace || compileCache.namespace || 'mailchimp'),
    cacheKey: compactString(compileCache.cacheKey || compileCache.key || entries[0]?.key),
    status: compactString(compileCache.status || source.status || (entries.length > 0 ? 'compiled' : 'uncached')),
    replayed: compileCache.replayed === true || source.replayed === true,
    entries,
    analytics,
    exportSummary,
    history,
    uiHandoff,
    lifecycle,
  };
}

export function buildMailchimpCompileCacheExportPackage(source = {}, options = {}) {
  const normalized = normalizeExportPackageSource(source);
  const entries = normalized.entries.map(normalizePreviewEntry);
  const counters = {
    ...(normalized.analytics.counters || {}),
    ...(normalized.exportSummary.counters || {}),
    ...(normalized.history.counters || {}),
  };
  const timeline = summarizeCacheTimeline(
    Array.isArray(normalized.history.events)
      ? normalized.history.events
      : Array.isArray(normalized.history.timeline?.events)
        ? normalized.history.timeline.events
        : [],
  );
  const summaryTimeline = {
    ...(normalized.analytics.timeline || {}),
    ...(normalized.exportSummary.timeline || {}),
    ...(normalized.history.timeline || {}),
  };
  const acceptedBy = compactString(options.acceptance?.acceptedBy || normalized.uiHandoff.acceptance?.acceptedBy);
  const acceptedAt = compactString(options.acceptance?.acceptedAt || normalized.uiHandoff.acceptance?.acceptedAt);
  const acceptanceRequired = normalized.uiHandoff.acceptance?.required === true
    || normalized.exportSummary.exportReady === false
    || normalized.lifecycle.blocked === true;
  const accepted = options.acceptance?.accepted === true
    || normalized.uiHandoff.acceptance?.accepted === true
    || (!acceptanceRequired && normalized.uiHandoff.acceptance?.accepted !== false)
    || Boolean(acceptedBy && acceptedAt);
  const providerBlockedEntries = entries
    .filter((entry) => entry.providerSync.restartSafe !== true || entry.providerSync.blockedReasons.length > 0)
    .map((entry) => entry.key)
    .filter(Boolean)
    .sort();
  const boundaryBlockedEntries = entries
    .filter((entry) => entry.boundaryScope.allowed === false || entry.boundaryScope.blockedReasons.length > 0)
    .map((entry) => entry.key)
    .filter(Boolean)
    .sort();
  const clientWorkflowBlockedEntries = entries
    .filter((entry) => entry.clientWorkflowHandoff.ready === false || entry.clientWorkflowHandoff.blockedReasons.length > 0)
    .map((entry) => entry.key)
    .filter(Boolean)
    .sort();
  const clientWorkflowWaitingEntries = entries
    .filter((entry) => entry.clientWorkflowHandoff.workflowState === 'waiting_for_acceptance')
    .map((entry) => entry.key)
    .filter(Boolean)
    .sort();
  const staleEntries = entries.filter((entry) => entry.stale).map((entry) => entry.key).filter(Boolean).sort();
  const diagnosticEntries = entries
    .filter((entry) => entry.diagnostics.errors > 0)
    .map((entry) => entry.key)
    .filter(Boolean)
    .sort();
  const blockedReasons = stableList([
    ...(Array.isArray(normalized.exportSummary.blockedReasons) ? normalized.exportSummary.blockedReasons : []),
    ...(staleEntries.length > 0 ? ['stale_entries'] : []),
    ...(diagnosticEntries.length > 0 ? ['diagnostic_errors'] : []),
    ...(providerBlockedEntries.length > 0 ? ['provider_sync_not_restart_safe'] : []),
    ...(boundaryBlockedEntries.length > 0 ? ['tenant_boundary_blocked'] : []),
    ...(clientWorkflowBlockedEntries.length > 0 ? ['client_workflow_handoff_blocked'] : []),
    ...(normalized.lifecycle.blocked === true ? ['compile_cache_lifecycle_blocked'] : []),
    ...(acceptanceRequired && !accepted ? ['operator_acceptance_missing'] : []),
  ]);
  const exportReady = normalized.exportSummary.exportReady === true
    && blockedReasons.length === 0
    && (!acceptanceRequired || accepted);
  const latestAt = summaryTimeline.latestAt ?? timeline.latestAt ?? null;
  const latestKind = compactString(summaryTimeline.latestKind || timeline.latestKind);
  const latestStatus = compactString(summaryTimeline.latestStatus || timeline.latestStatus);
  const nextAction = exportReady
    ? 'deliver_compile_cache_export'
    : acceptanceRequired && !accepted
      ? 'request_compile_cache_acceptance'
      : providerBlockedEntries.length > 0
        ? 'refresh_provider_sync_before_replay'
        : staleEntries.length > 0
          ? 'refresh_compile_cache'
          : diagnosticEntries.length > 0
            ? 'repair_cached_descriptor'
            : normalized.lifecycle.nextAction || 'review_compile_cache_export';
  const packageReadiness = {
    ready: exportReady,
    cacheReady: normalized.exportSummary.exportReady === true
      && staleEntries.length === 0
      && diagnosticEntries.length === 0,
    providerReady: providerBlockedEntries.length === 0,
    boundaryReady: boundaryBlockedEntries.length === 0,
    exportReady: normalized.exportSummary.exportReady === true,
    lifecycleReady: normalized.lifecycle.blocked !== true,
    nextStep: nextAction,
  };
  const packageAcceptance = {
    required: acceptanceRequired,
    accepted: !acceptanceRequired || accepted,
    acceptedBy,
    acceptedAt,
    reason: compactString(options.acceptance?.reason || normalized.uiHandoff.acceptance?.reason),
  };
  const packageValidationSummary = {
    ready: exportReady,
    blockedReasons,
    counters: {
      entries: positiveInteger(counters.entries, entries.length),
      staleEntries: staleEntries.length || positiveInteger(counters.staleEntries, 0),
      diagnosticEntries: diagnosticEntries.length || positiveInteger(counters.errorEntries, 0),
      providerBlockedEntries: providerBlockedEntries.length,
      boundaryBlockedEntries: boundaryBlockedEntries.length,
      clientWorkflowBlockedEntries: clientWorkflowBlockedEntries.length,
      clientWorkflowWaitingEntries: clientWorkflowWaitingEntries.length,
      lookupEvents: positiveInteger(counters.lookupEvents, 0),
    },
  };
  const acceptancePreview = buildMailchimpCompileCacheAcceptancePreview({
    namespace: normalized.namespace,
    cacheKey: normalized.cacheKey,
    status: normalized.status,
    replayed: normalized.replayed,
    entries,
    counters: packageValidationSummary.counters,
    readiness: packageReadiness,
    acceptance: packageAcceptance,
    validationSummary: packageValidationSummary,
    nextSteps: exportReady
      ? [{
        action: 'deliver_compile_cache_export',
        reason: 'export_ready',
        owner: 'runtime',
      }]
      : [{
        action: nextAction,
        reason: blockedReasons[0] || 'export_not_ready',
        owner: acceptanceRequired && !accepted ? 'operator' : 'compiler',
      }],
    providerSyncCheckpoint: entries[0]?.providerSync || {},
    providerServiceContract: entries[0]?.providerContract || {},
    boundaryScope: entries[0]?.boundaryScope || {},
    lifecycle: normalized.lifecycle,
    exportSummary: normalized.exportSummary,
    history: normalized.history,
    routeHints: {
      primaryAction: nextAction,
      recoveryCommand: exportReady ? 'observe' : nextAction,
      statusRouteState: exportReady ? 'ready' : 'needs_attention',
      canReplayCachedDescriptor: exportReady,
    },
  }, options);
  const packageIdParts = stableList([
    normalized.namespace,
    normalized.cacheKey,
    latestAt == null ? '' : `latest:${latestAt}`,
    `entries:${entries.length}`,
    `blocked:${blockedReasons.join('|')}`,
  ]);

  return {
    protocol: 'aios.compile-cache-export-package.mailchimp.v1',
    namespace: normalized.namespace,
    packageId: packageIdParts.join(':') || `${normalized.namespace}:empty`,
    cacheKey: normalized.cacheKey,
    status: normalized.status,
    replayed: normalized.replayed,
    exportReady,
    format: 'json',
    redaction: 'descriptor-metadata',
    includesPayload: false,
    blockedReasons,
    nextAction,
    counters: {
      entries: positiveInteger(counters.entries, entries.length),
      staleEntries: staleEntries.length || positiveInteger(counters.staleEntries, 0),
      diagnosticEntries: diagnosticEntries.length || positiveInteger(counters.errorEntries, 0),
      providerBlockedEntries: providerBlockedEntries.length,
      boundaryBlockedEntries: boundaryBlockedEntries.length,
      clientWorkflowBlockedEntries: clientWorkflowBlockedEntries.length,
      clientWorkflowWaitingEntries: clientWorkflowWaitingEntries.length,
      totalEntryHits: positiveInteger(counters.totalEntryHits, 0),
      lookupEvents: positiveInteger(counters.lookupEvents, 0),
      hitEvents: positiveInteger(counters.hitEvents, 0),
      missEvents: positiveInteger(counters.missEvents, 0),
      storeEvents: positiveInteger(counters.storeEvents, 0),
      evictionEvents: positiveInteger(counters.evictionEvents, 0),
      invalidationEvents: positiveInteger(counters.invalidationEvents, 0),
      historySnapshots: positiveInteger(normalized.history.timeline?.snapshotCount, normalized.history.snapshots?.length || 0),
    },
    timeline: {
      totalEvents: positiveInteger(summaryTimeline.totalEvents, timeline.totalEvents),
      firstAt: summaryTimeline.firstAt ?? timeline.firstAt ?? null,
      latestAt,
      latestKind,
      latestStatus,
      eventsByKind: timeline.eventsByKind,
      eventsByStatus: timeline.eventsByStatus,
      historySnapshotCount: positiveInteger(normalized.history.timeline?.snapshotCount, timeline.totalEvents),
    },
    reporting: {
      state: compactString(normalized.history.reportingState?.state || normalized.exportSummary.reportingState?.state || (exportReady ? 'export_ready' : 'needs_attention')),
      nextAction: compactString(normalized.history.reportingState?.nextAction || normalized.exportSummary.reportingState?.nextAction),
      exportReady: normalized.history.exportReady === true || exportReady,
      latestSnapshot: normalized.history.snapshots?.at(-1) || null,
    },
    acceptance: {
      ...packageAcceptance,
      previewState: acceptancePreview.state,
      canAccept: acceptancePreview.acceptance.canAccept,
      requiredBecause: acceptancePreview.acceptance.requiredBecause,
    },
    acceptancePreview,
    manifests: {
      entries: entries.map((entry) => ({
        key: entry.key,
        requestKey: entry.requestKey,
        sourceHash: entry.sourceHash,
        contractHash: entry.contractHash,
        stale: entry.stale,
        ttlRemainingMs: entry.ttlRemainingMs,
        hits: entry.hits,
        diagnostics: entry.diagnostics,
        providerSync: entry.providerSync,
        boundaryScope: entry.boundaryScope,
        clientWorkflowHandoff: entry.clientWorkflowHandoff,
      })),
      staleEntryKeys: staleEntries,
      diagnosticEntryKeys: diagnosticEntries,
      providerBlockedEntryKeys: providerBlockedEntries,
      boundaryBlockedEntryKeys: boundaryBlockedEntries,
      clientWorkflowBlockedEntryKeys: clientWorkflowBlockedEntries,
      clientWorkflowWaitingEntryKeys: clientWorkflowWaitingEntries,
    },
  };
}

function normalizeStatusHandoffSource(source = {}) {
  const snapshot = source.protocol === 'aios.compile-cache-snapshot.mailchimp.v1'
    ? source
    : source.snapshot && typeof source.snapshot === 'object'
      ? source.snapshot
      : {};
  const compileCache = source.compileCache && typeof source.compileCache === 'object'
    ? source.compileCache
    : source.protocol === 'aios.compile-cache-status.mailchimp.v1'
      ? source
      : {};
  const entries = Array.isArray(snapshot.entries)
    ? snapshot.entries
    : Array.isArray(source.entries)
      ? source.entries
      : compileCache.cacheKey || compileCache.key
        ? [compileCache]
        : [];
  const analytics = snapshot.analytics && typeof snapshot.analytics === 'object'
    ? snapshot.analytics
    : compileCache.analytics && typeof compileCache.analytics === 'object'
      ? compileCache.analytics
      : source.analytics && typeof source.analytics === 'object'
        ? source.analytics
        : {};
  const exportSummary = snapshot.exportSummary && typeof snapshot.exportSummary === 'object'
    ? snapshot.exportSummary
    : compileCache.exportSummary && typeof compileCache.exportSummary === 'object'
      ? compileCache.exportSummary
      : source.exportSummary && typeof source.exportSummary === 'object'
        ? source.exportSummary
        : buildMailchimpCompileCacheExportSummary({
          protocol: 'aios.compile-cache-snapshot.mailchimp.v1',
          namespace: snapshot.namespace || source.namespace || compileCache.namespace || 'mailchimp',
          entries,
          analytics,
        });
  const lifecycle = snapshot.lifecycle && typeof snapshot.lifecycle === 'object'
    ? snapshot.lifecycle
    : compileCache.lifecycle && typeof compileCache.lifecycle === 'object'
      ? compileCache.lifecycle
      : source.lifecycle && typeof source.lifecycle === 'object'
        ? source.lifecycle
        : {};
  const history = snapshot.history && typeof snapshot.history === 'object'
    ? snapshot.history
    : compileCache.history && typeof compileCache.history === 'object'
      ? compileCache.history
      : source.history && typeof source.history === 'object'
        ? source.history
        : buildMailchimpCompileCacheHistoryReport({
          namespace: snapshot.namespace || source.namespace || compileCache.namespace || 'mailchimp',
          entries,
          analytics,
        }, { now: source.now ?? snapshot.generatedAt });

  return {
    namespace: compactString(snapshot.namespace || source.namespace || compileCache.namespace || 'mailchimp'),
    cacheKey: compactString(compileCache.cacheKey || compileCache.key || entries[0]?.key),
    requestKey: compactString(compileCache.requestKey || compileCache.identity?.requestKey || source.requestKey),
    status: compactString(compileCache.status || source.status || (entries.length > 0 ? 'compiled' : 'uncached')),
    replayed: compileCache.replayed === true || source.replayed === true,
    stale: compileCache.stale === true || entries.some((entry) => entry.stale === true),
    sourceHash: compactString(compileCache.sourceHash || compileCache.identity?.sourceHash || source.sourceHash),
    optionsHash: compactString(compileCache.optionsHash || compileCache.identity?.optionsHash || source.optionsHash),
    contractHash: compactString(compileCache.contractHash || compileCache.identity?.contractHash || source.contractHash),
    ttlRemainingMs: compileCache.ttlRemainingMs ?? entries[0]?.ttlRemainingMs ?? null,
    entries,
    analytics,
    exportSummary,
    history,
    exportPackage: compileCache.exportPackage || source.exportPackage || null,
    persistedSnapshotState: compileCache.persistedSnapshotState || source.persistedSnapshotState || snapshot.persistedSnapshotState || null,
    lifecycle,
    uiHandoff: compileCache.uiHandoff || source.uiHandoff || null,
    replayBarrier: compileCache.replayBarrier || source.replayBarrier || null,
    persistedReplayState: compileCache.persistedReplayState || source.persistedReplayState || null,
    operationalHealth: compileCache.operationalHealth || source.operationalHealth || null,
    clientWorkflowHandoff: compileCache.clientWorkflowHandoff || source.clientWorkflowHandoff || null,
    resumeEvidenceHandoff: compileCache.resumeEvidenceHandoff || source.resumeEvidenceHandoff || null,
    providerSyncCheckpoint: compileCache.providerSyncCheckpoint
      || source.providerSyncCheckpoint
      || entries.find((entry) => entry.providerSyncCheckpoint)?.providerSyncCheckpoint
      || {},
    providerServiceContract: compileCache.providerServiceContract
      || source.providerServiceContract
      || entries.find((entry) => entry.providerServiceContract)?.providerServiceContract
      || entries.find((entry) => entry.providerSyncCheckpoint?.providerServiceContract)?.providerSyncCheckpoint?.providerServiceContract
      || {},
    boundaryScope: compileCache.boundaryScope
      || source.boundaryScope
      || entries.find((entry) => entry.boundaryScope)?.boundaryScope
      || {},
  };
}

export function buildMailchimpCompileCacheResumeEvidenceHandoff(source = {}, runtime = {}) {
  const providerSyncCheckpoint = source.providerSyncCheckpoint && typeof source.providerSyncCheckpoint === 'object'
    ? source.providerSyncCheckpoint
    : {};
  const providerServiceContract = source.providerServiceContract && typeof source.providerServiceContract === 'object'
    ? source.providerServiceContract
    : {};
  const providerReplayHandoff = source.providerReplayHandoff && typeof source.providerReplayHandoff === 'object'
    ? source.providerReplayHandoff
    : {};
  const boundaryScope = source.boundaryScope && typeof source.boundaryScope === 'object'
    ? source.boundaryScope
    : {};
  const clientWorkflowHandoff = source.clientWorkflowHandoff && typeof source.clientWorkflowHandoff === 'object'
    ? source.clientWorkflowHandoff
    : {};
  const resumeGate = source.resumeGate && typeof source.resumeGate === 'object' ? source.resumeGate : {};
  const replayBarrier = source.replayBarrier && typeof source.replayBarrier === 'object' ? source.replayBarrier : {};
  const persistedReplayState = source.persistedReplayState && typeof source.persistedReplayState === 'object'
    ? source.persistedReplayState
    : {};
  const runtimeEvidence = runtime.resumeEvidence && typeof runtime.resumeEvidence === 'object'
    ? runtime.resumeEvidence
    : runtime.evidence && typeof runtime.evidence === 'object'
      ? runtime.evidence
      : {};
  const externalHandoff = providerServiceContract.externalHandoff || {};
  const receipt = externalHandoff.receipt || providerReplayHandoff.externalHandoff?.receipt || {};
  const boundaryState = clientWorkflowHandoff.boundaryState || {};
  const runtimeAcceptance = runtime.acceptance && typeof runtime.acceptance === 'object'
    ? runtime.acceptance
    : runtime.operatorAcceptance && typeof runtime.operatorAcceptance === 'object'
      ? runtime.operatorAcceptance
      : {};
  const externalState = compactString(
    providerSyncCheckpoint.externalHandoffState
      || externalHandoff.state
      || providerReplayHandoff.externalHandoff?.state
      || 'local_only',
  );
  const externalRequestId = compactString(
    providerSyncCheckpoint.externalRequestId
      || externalHandoff.requestId
      || providerReplayHandoff.externalHandoff?.requestId,
  );
  const receiptRequired = externalHandoff.receiptRequired === true
    || providerReplayHandoff.externalHandoff?.receiptRequired === true
    || receipt.required === true
    || (externalState !== 'local_only' && Boolean(externalRequestId));
  const receiptAcknowledged = externalHandoff.receiptAcknowledged === true
    || providerReplayHandoff.externalHandoff?.receiptAcknowledged === true
    || receipt.acknowledged === true
    || runtimeEvidence.providerReceiptAcknowledged === true;
  const boundaryAuditRequired = boundaryState.auditAppendReady === false
    || boundaryState.requiresAuditAppend === true
    || boundaryScope.audit?.externalWriteSuppressed === true
    || boundaryState.auditDecision === 'block';
  const boundaryAuditReady = boundaryAuditRequired !== true
    || boundaryState.auditAppendReady === true
    || boundaryScope.audit?.decision === 'allow'
    || runtimeEvidence.boundaryAuditAppended === true;
  const acceptanceRequired = resumeGate.acceptance?.required === true
    || clientWorkflowHandoff.acceptance?.required === true
    || replayBarrier.acceptance?.required === true;
  const acceptanceAccepted = !acceptanceRequired
    || resumeGate.acceptance?.accepted === true
    || clientWorkflowHandoff.acceptance?.accepted === true
    || replayBarrier.acceptance?.accepted === true
    || runtimeAcceptance.accepted === true
    || Boolean(compactString(runtimeAcceptance.acceptedBy) && compactString(runtimeAcceptance.acceptedAt));
  const cursorRequired = providerSyncCheckpoint.cursorRequired === true
    || providerReplayHandoff.syncMetadata?.cursorRequired === true;
  const cursor = compactString(
    providerSyncCheckpoint.cursor
      || providerReplayHandoff.syncMetadata?.cursor
      || runtimeEvidence.syncCursor,
  );
  const replayKey = compactString(
    persistedReplayState.replayKey
      || persistedReplayState.command?.replayKey
      || replayBarrier.replay?.replayKey
      || runtimeEvidence.replayKey,
  );
  const idempotencyKey = compactString(
    persistedReplayState.idempotencyKey
      || persistedReplayState.command?.idempotencyKey
      || replayBarrier.replay?.idempotencyKey
      || clientWorkflowHandoff.requestState?.idempotencyKey
      || runtimeEvidence.idempotencyKey,
  );
  const missingEvidence = stableList([
    ...(receiptRequired && !receiptAcknowledged ? ['provider_receipt_acknowledgement'] : []),
    ...(externalState !== 'local_only' && !externalRequestId ? ['external_request_id'] : []),
    ...(cursorRequired && !cursor ? ['provider_sync_cursor'] : []),
    ...(boundaryAuditReady ? [] : ['tenant_boundary_audit_append'] ),
    ...(acceptanceRequired && !acceptanceAccepted ? ['operator_acceptance'] : []),
    ...(replayBarrier.open === false ? ['replay_barrier_open'] : []),
    ...(persistedReplayState.restartSafe === false ? ['persisted_replay_restart_safe'] : []),
    ...stableList(providerReplayHandoff.blockedReasons).map((reason) => `provider_replay:${reason}`),
    ...stableList(resumeGate.blockedReasons).map((reason) => `resume_gate:${reason}`),
  ]);
  const state = missingEvidence.length === 0
    ? 'evidence_ready'
    : missingEvidence.includes('operator_acceptance')
      ? 'waiting_for_acceptance'
      : missingEvidence.includes('provider_receipt_acknowledgement')
        ? 'waiting_for_provider_receipt'
        : missingEvidence.includes('tenant_boundary_audit_append')
          ? 'waiting_for_boundary_audit'
          : missingEvidence.includes('provider_sync_cursor')
            ? 'waiting_for_provider_sync'
            : 'evidence_incomplete';
  const nextAction = state === 'evidence_ready'
    ? source.replayed ? 'verify_cached_descriptor' : 'resume_from_compile_cache'
    : state === 'waiting_for_acceptance'
      ? 'request_compile_cache_acceptance'
      : state === 'waiting_for_provider_receipt'
        ? 'refresh_provider_receipt'
        : state === 'waiting_for_boundary_audit'
          ? 'append_tenant_boundary_audit'
          : state === 'waiting_for_provider_sync'
            ? 'refresh_provider_sync_before_replay'
            : resumeGate.nextAction || providerReplayHandoff.nextAction || 'inspect_compile_cache_resume_gate';

  return {
    protocol: 'aios.compile-cache-resume-evidence-handoff.mailchimp.v1',
    namespace: compactString(source.namespace || 'mailchimp'),
    cacheKey: compactString(source.cacheKey),
    requestKey: compactString(source.requestKey),
    status: compactString(source.status || 'unknown'),
    state,
    ready: missingEvidence.length === 0,
    restartSafe: missingEvidence.length === 0
      || missingEvidence.every((item) => item === 'operator_acceptance' || item === 'tenant_boundary_audit_append'),
    replaySafe: missingEvidence.length === 0 && replayBarrier.canReplayCachedDescriptor !== false,
    nextAction,
    recoveryCommand: state === 'evidence_ready' ? 'observe' : nextAction,
    missingEvidence,
    evidence: {
      providerReceipt: {
        required: receiptRequired,
        acknowledged: receiptAcknowledged,
        receiptId: compactString(receipt.receiptId),
        externalRequestId,
        state: compactString(receipt.state || (receiptAcknowledged ? 'acknowledged' : 'missing')),
      },
      providerSync: {
        cursorRequired,
        cursorPresent: Boolean(cursor),
        cursor,
        checkpointState: compactString(providerSyncCheckpoint.state || providerReplayHandoff.syncMetadata?.state || 'unknown'),
      },
      tenantBoundary: {
        auditRequired: boundaryAuditRequired,
        auditReady: boundaryAuditReady,
        auditDecision: compactString(boundaryState.auditDecision || boundaryScope.audit?.decision),
        boundaryKey: compactString(boundaryState.boundaryKey || boundaryScope.audit?.handoffKey),
      },
      acceptance: {
        required: acceptanceRequired,
        accepted: acceptanceAccepted,
        acceptedBy: compactString(runtimeAcceptance.acceptedBy || resumeGate.acceptance?.acceptedBy || clientWorkflowHandoff.acceptance?.acceptedBy),
        acceptedAt: compactString(runtimeAcceptance.acceptedAt || resumeGate.acceptance?.acceptedAt || clientWorkflowHandoff.acceptance?.acceptedAt),
      },
      replay: {
        barrierOpen: replayBarrier.open === true,
        replayKey,
        idempotencyKey,
        persistedReplayState: compactString(persistedReplayState.state || 'unknown'),
      },
    },
    route: {
      target: 'compile-cache-resume-evidence',
      statusRouteState: missingEvidence.length === 0 ? 'ready' : 'needs_attention',
      primaryAction: nextAction,
      recoveryCommand: state === 'evidence_ready' ? 'observe' : nextAction,
      idempotencyKey: stableList([
        source.namespace || 'mailchimp',
        source.cacheKey,
        source.requestKey,
        state,
        nextAction,
        missingEvidence.join('|'),
      ]).join(':'),
    },
    clientPatch: {
      compileCacheResumeEvidenceState: state,
      compileCacheResumeEvidenceReady: missingEvidence.length === 0,
      compileCacheResumeEvidenceNextAction: nextAction,
      compileCacheResumeEvidenceMissing: missingEvidence,
    },
  };
}

function buildMailchimpCompileCacheClientExportCard({
  normalized,
  ready,
  nextAction,
  uiHandoff,
  acceptancePreview,
  replayBarrier,
  persistedReplayState,
  persistedSnapshotState,
  operationalHealth,
  exportPackage,
  recoveryExportLane,
  clientWorkflowHandoff,
  providerReplayHandoff,
  resumeGate,
  resumeEvidenceHandoff,
  recoveryJournal,
  decisionMatrix,
  blockedReasons,
}) {
  const acceptance = acceptancePreview.acceptance || uiHandoff.acceptance || {};
  const acceptanceRequired = acceptance.required === true
    || clientWorkflowHandoff.acceptance?.required === true
    || resumeGate.acceptance?.required === true;
  const acceptanceAccepted = acceptance.accepted === true
    || clientWorkflowHandoff.acceptance?.accepted === true
    || resumeGate.acceptance?.accepted === true;
  const exportRows = Array.isArray(exportPackage.entries) ? exportPackage.entries : [];
  const blockedExportRows = exportRows.filter((row) => row.ready === false || row.state === 'blocked');
  const recoveryRows = Array.isArray(recoveryExportLane.rows) ? recoveryExportLane.rows : [];
  const blockedRecoveryRows = recoveryRows.filter((row) => row.restartSafe === false || row.replaySafe === false);
  const clientBlockedReasons = stableList([
    ...blockedReasons,
    ...(acceptanceRequired && !acceptanceAccepted ? ['acceptance_required'] : []),
    ...(blockedExportRows.length > 0 ? ['export_package_rows_blocked'] : []),
    ...(blockedRecoveryRows.length > 0 ? ['recovery_export_rows_blocked'] : []),
    ...(decisionMatrix.counts?.blocking > 0 ? ['decision_matrix_blocking_actions'] : []),
  ]);
  const exportReady = exportPackage.exportReady === true
    && recoveryExportLane.exportReady === true
    && blockedExportRows.length === 0
    && blockedRecoveryRows.length === 0;
  const runtimeReady = ready === true
    && replayBarrier.canReplayCachedDescriptor === true
    && persistedReplayState.restartSafe === true
    && persistedSnapshotState.restartSafe === true
    && clientWorkflowHandoff.ready === true
    && providerReplayHandoff.ready === true
    && resumeGate.ready === true
    && resumeEvidenceHandoff.ready === true;
  const status = runtimeReady && exportReady
    ? acceptanceRequired && !acceptanceAccepted
      ? 'waiting_for_acceptance'
      : 'ready'
    : operationalHealth.failed === true
      ? 'failed'
      : clientBlockedReasons.length > 0
        ? 'blocked'
        : 'needs_attention';
  const primaryAction = status === 'ready'
    ? normalized.replayed
      ? 'verify_cached_descriptor'
      : 'reuse_compile_cache'
    : status === 'waiting_for_acceptance'
      ? 'request_compile_cache_acceptance'
      : nextAction || decisionMatrix.route?.primaryAction || 'review_compile_cache_status';
  const cardId = stableList([
    normalized.namespace,
    normalized.cacheKey || normalized.requestKey || 'compile-cache',
    status,
    exportPackage.packageId,
    recoveryExportLane.nextRowId,
  ]).join(':').replace(/[^a-zA-Z0-9_.:-]/g, '_');

  return {
    protocol: 'aios.compile-cache-client-export-card.mailchimp.v1',
    namespace: normalized.namespace,
    cacheKey: normalized.cacheKey,
    requestKey: normalized.requestKey,
    cardId,
    status,
    ready: status === 'ready',
    readyForClient: exportReady && clientBlockedReasons.length === 0,
    readyForRuntimeReplay: runtimeReady && clientBlockedReasons.length === 0,
    replayed: normalized.replayed,
    stale: normalized.stale,
    primaryAction,
    nextAction: primaryAction,
    route: {
      target: 'client-runtime',
      method: 'POST',
      path: `/mailchimp/compile-cache/${encodeURIComponent(normalized.cacheKey || normalized.requestKey || 'preview')}/client-export`,
      idempotencyKey: `${cardId}:route`,
      requiredBodyKeys: acceptanceRequired && !acceptanceAccepted
        ? ['accepted', 'acceptanceToken']
        : ['cacheKey', 'requestKey'],
    },
    acceptance: {
      required: acceptanceRequired,
      accepted: acceptanceAccepted,
      token: compactString(acceptance.token || acceptance.acceptanceToken || resumeGate.acceptance?.token),
      acceptedBy: compactString(acceptance.acceptedBy || resumeGate.acceptance?.acceptedBy),
      acceptedAt: compactString(acceptance.acceptedAt || resumeGate.acceptance?.acceptedAt),
      reason: compactString(acceptance.reason || (acceptanceRequired ? 'compile cache replay acceptance required' : '')),
    },
    validationSummary: {
      ready,
      exportReady,
      runtimeReady,
      blockedReasons: clientBlockedReasons,
      blockingActions: decisionMatrix.counts?.blocking || 0,
      recoveryRows: recoveryRows.length,
      blockedRecoveryRows: blockedRecoveryRows.length,
      exportRows: exportRows.length,
      blockedExportRows: blockedExportRows.length,
      operationalHealth: operationalHealth.state || (operationalHealth.failed ? 'failed' : 'unknown'),
      recoveryJournalState: recoveryJournal.state || 'unknown',
    },
    artifacts: {
      exportPackage: {
        packageId: compactString(exportPackage.packageId),
        exportReady: exportPackage.exportReady === true,
        nextAction: compactString(exportPackage.nextAction),
        blockedReasons: stableList(exportPackage.blockedReasons),
      },
      recoveryExportLane: {
        status: recoveryExportLane.status,
        exportReady: recoveryExportLane.exportReady === true,
        nextAction: recoveryExportLane.nextAction,
        blockedReasons: stableList(recoveryExportLane.blockedReasons),
        rows: recoveryRows.length,
      },
      clientWorkflow: {
        workflowState: clientWorkflowHandoff.workflowState,
        ready: clientWorkflowHandoff.ready === true,
        primaryAction: clientWorkflowHandoff.primaryAction,
        blockedReasons: stableList(clientWorkflowHandoff.blockedReasons),
      },
    },
    preview: {
      title: `Mailchimp compile cache ${normalized.replayed ? 'replay' : 'preview'}`,
      visibleStatus: status,
      primaryAction,
      secondaryAction: exportReady ? 'download_compile_cache_export' : 'review_compile_cache_export',
      explain: exportReady
        ? 'Compile cache export is deterministic and can be attached to the client runtime state.'
        : 'Compile cache export is held until replay, acceptance, and recovery rows are resolved.',
    },
    clientPatch: {
      compileCacheClientExportCardId: cardId,
      compileCacheClientExportStatus: status,
      compileCacheClientExportReady: status === 'ready',
      compileCacheClientExportNextAction: primaryAction,
      compileCacheClientExportAcceptanceRequired: acceptanceRequired && !acceptanceAccepted,
      compileCacheClientExportBlockedReasons: clientBlockedReasons,
    },
    restartSemantics: {
      replaySafe: runtimeReady || status === 'waiting_for_acceptance',
      duplicateCommandPolicy: 'dedupe-by-compile-cache-client-export-card',
      resumeFromCardId: cardId,
      cacheKey: normalized.cacheKey,
      requestKey: normalized.requestKey,
      externalWritesPerformed: false,
    },
  };
}

function buildMailchimpCompileCacheClientResumePacket({
  normalized,
  ready,
  nextAction,
  decisionMatrix,
  clientWorkflowHandoff,
  clientExportCard,
  resumeGate,
  resumeEvidenceHandoff,
  lifecycleCommandCheckpoint,
  providerReplayHandoff,
  operationalHealth,
  exportPackage,
  recoveryExportLane,
  blockedReasons,
}) {
  const evidenceMissing = stableList(resumeEvidenceHandoff.missingEvidence);
  const workflowBlockedReasons = stableList(clientWorkflowHandoff.blockedReasons);
  const exportBlockedReasons = stableList(clientExportCard.validationSummary?.blockedReasons);
  const lifecycleBlocked = lifecycleCommandCheckpoint.restartSafe === false
    || lifecycleCommandCheckpoint.state === 'held'
    || lifecycleCommandCheckpoint.state === 'blocked';
  const clientRuntimeBlockedReasons = stableList([
    ...blockedReasons,
    ...evidenceMissing.map((reason) => `resume_evidence:${reason}`),
    ...workflowBlockedReasons.map((reason) => `client_workflow:${reason}`),
    ...exportBlockedReasons.map((reason) => `client_export:${reason}`),
    ...(resumeGate.ready === false ? stableList(resumeGate.blockedReasons).map((reason) => `resume_gate:${reason}`) : []),
    ...(providerReplayHandoff.ready === false ? stableList(providerReplayHandoff.blockedReasons).map((reason) => `provider_replay:${reason}`) : []),
    ...(lifecycleBlocked ? stableList(lifecycleCommandCheckpoint.blockedReasons).map((reason) => `lifecycle_command:${reason}`) : []),
    ...(operationalHealth.failed === true ? ['operational_health_failed'] : []),
    ...(exportPackage.exportReady !== true ? ['export_package_not_ready'] : []),
    ...(recoveryExportLane.exportReady === false ? ['recovery_export_lane_not_ready'] : []),
  ]);
  const acceptance = clientExportCard.acceptance || clientWorkflowHandoff.acceptance || {};
  const acceptanceRequired = acceptance.required === true;
  const acceptanceAccepted = acceptance.accepted === true;
  const retryable = ready !== true
    && operationalHealth.failed !== true
    && !clientRuntimeBlockedReasons.some((reason) => (
      reason.includes('acceptance')
        || reason.includes('permission')
        || reason.includes('boundary')
        || reason.includes('operator')
    ));
  const retryAfterMs = retryable
    ? Math.max(
      positiveInteger(resumeGate.retry?.retryAfterMs, 0),
      positiveInteger(operationalHealth.retry?.retryAfterMs, 0),
      evidenceMissing.some((reason) => reason.includes('provider')) ? 30000 : 10000,
    )
    : 0;
  const state = ready === true && clientRuntimeBlockedReasons.length === 0
    ? normalized.replayed ? 'ready_to_verify_cached_descriptor' : 'ready_to_reuse_compile_cache'
    : acceptanceRequired && !acceptanceAccepted
      ? 'waiting_for_acceptance'
      : evidenceMissing.includes('provider_receipt_acknowledgement')
        ? 'waiting_for_provider_receipt'
        : evidenceMissing.includes('provider_sync_cursor')
          ? 'waiting_for_provider_sync'
          : evidenceMissing.includes('tenant_boundary_audit_append')
            ? 'waiting_for_boundary_audit'
            : lifecycleBlocked
              ? 'waiting_for_lifecycle_command'
              : retryable
                ? 'retryable_repair'
                : 'blocked';
  const primaryAction = state === 'ready_to_verify_cached_descriptor'
    ? 'verify_cached_descriptor'
    : state === 'ready_to_reuse_compile_cache'
      ? 'reuse_compile_cache'
      : state === 'waiting_for_acceptance'
        ? 'request_compile_cache_acceptance'
        : nextAction || decisionMatrix.route?.primaryAction || resumeEvidenceHandoff.nextAction || 'review_compile_cache_status';
  const packetId = stableList([
    normalized.namespace,
    normalized.cacheKey || normalized.requestKey || 'compile-cache',
    state,
    primaryAction,
    clientRuntimeBlockedReasons.join('|'),
  ]).join(':').replace(/[^a-zA-Z0-9_.:-]/g, '_');
  const resumeToken = stableList([
    normalized.cacheKey || normalized.requestKey || 'compile-cache',
    clientWorkflowHandoff.resumeToken || clientWorkflowHandoff.route?.idempotencyKey,
    resumeGate.restartResumeContract?.resumeToken || resumeGate.restartResumeContract?.route?.idempotencyKey,
    resumeEvidenceHandoff.route?.idempotencyKey,
    state,
  ]).join(':').replace(/[^a-zA-Z0-9_.:-]/g, '_');

  return {
    protocol: 'aios.compile-cache-client-resume-packet.mailchimp.v1',
    namespace: normalized.namespace,
    cacheKey: normalized.cacheKey,
    requestKey: normalized.requestKey,
    packetId,
    state,
    readyForClientRuntime: ready === true && clientRuntimeBlockedReasons.length === 0,
    readyForRuntimeReplay: ready === true
      && resumeGate.ready === true
      && resumeEvidenceHandoff.ready === true
      && providerReplayHandoff.ready === true,
    replayed: normalized.replayed,
    stale: normalized.stale,
    nextAction: primaryAction,
    resumeToken,
    statusRevision: stableHash({
      cacheKey: normalized.cacheKey,
      requestKey: normalized.requestKey,
      state,
      primaryAction,
      blockedReasons: clientRuntimeBlockedReasons,
    }),
    retry: {
      retryable,
      retryAfterMs,
      maxAttempts: retryable ? Math.max(1, positiveInteger(resumeGate.retry?.maxAttempts, 3)) : 0,
      nextAction: retryable ? primaryAction : 'hold_for_operator',
      exhausted: resumeGate.retry?.exhausted === true || operationalHealth.retry?.exhausted === true,
    },
    acceptance: {
      required: acceptanceRequired,
      accepted: acceptanceAccepted,
      token: compactString(acceptance.token || acceptance.acceptanceToken),
      acceptedBy: compactString(acceptance.acceptedBy),
      acceptedAt: compactString(acceptance.acceptedAt),
      reason: compactString(acceptance.reason),
    },
    evidence: {
      resumeGateReady: resumeGate.ready === true,
      resumeEvidenceReady: resumeEvidenceHandoff.ready === true,
      providerReplayReady: providerReplayHandoff.ready === true,
      clientWorkflowReady: clientWorkflowHandoff.ready === true,
      clientExportReady: clientExportCard.ready === true,
      lifecycleCommandRestartSafe: lifecycleCommandCheckpoint.restartSafe !== false,
      missingEvidence: evidenceMissing,
    },
    counters: {
      blockedReasons: clientRuntimeBlockedReasons.length,
      missingEvidence: evidenceMissing.length,
      decisionActions: decisionMatrix.actionQueue?.length || 0,
      decisionBlockingRows: decisionMatrix.counts?.blocking || 0,
      recoveryLaneRows: recoveryExportLane.counters?.rows || 0,
      recoveryLaneBlockedRows: recoveryExportLane.counters?.blockedRows || 0,
    },
    blockedReasons: clientRuntimeBlockedReasons,
    route: {
      target: 'client-runtime-resume',
      method: 'POST',
      path: `/mailchimp/compile-cache/${encodeURIComponent(normalized.cacheKey || normalized.requestKey || 'preview')}/resume`,
      idempotencyKey: `${packetId}:route`,
      primaryAction,
      recoveryCommand: ready ? 'observe' : primaryAction,
      requiredBodyKeys: acceptanceRequired && !acceptanceAccepted
        ? ['accepted', 'acceptanceToken', 'resumeToken']
        : ['cacheKey', 'requestKey', 'resumeToken'],
    },
    exportRow: {
      artifactName: 'compile-cache-client-resume-packet.json',
      rowId: packetId,
      status: state,
      nextAction: primaryAction,
      readyForExport: clientExportCard.readyForClient === true && clientRuntimeBlockedReasons.length === 0,
      blockedReasons: clientRuntimeBlockedReasons,
    },
    clientPatch: {
      compileCacheClientResumePacketId: packetId,
      compileCacheClientResumeState: state,
      compileCacheClientResumeReady: ready === true && clientRuntimeBlockedReasons.length === 0,
      compileCacheClientResumeNextAction: primaryAction,
      compileCacheClientResumeToken: resumeToken,
      compileCacheClientResumeRetryAfterMs: retryAfterMs,
      compileCacheClientResumeBlockedReasons: clientRuntimeBlockedReasons,
    },
    restartSemantics: {
      replaySafe: ready === true || state === 'waiting_for_acceptance',
      duplicateCommandPolicy: 'dedupe-by-compile-cache-client-resume-packet',
      resumeFromPacketId: packetId,
      resumeToken,
      statusRevision: stableHash({ packetId, state, primaryAction }),
      externalWritesPerformed: false,
    },
  };
}

function buildMailchimpCompileCacheClientExportTimeline({
  normalized,
  ready,
  nextAction,
  clientExportCard,
  clientResumePacket,
  replayCommandBundle,
  recoveryExportLane,
  exportPackage,
  decisionMatrix,
  lifecycleExecution,
}) {
  const exportEntries = Array.isArray(exportPackage.entries) ? exportPackage.entries : [];
  const recoveryRows = Array.isArray(recoveryExportLane.rows) ? recoveryExportLane.rows : [];
  const replayRows = Array.isArray(replayCommandBundle.rows) ? replayCommandBundle.rows : [];
  const decisionRows = Array.isArray(decisionMatrix.rows) ? decisionMatrix.rows : [];
  const rows = [
    {
      rowId: `${clientExportCard.cardId}:card`,
      phase: 'client-export-card',
      source: 'compile-cache-client-export-card',
      status: clientExportCard.status,
      ready: clientExportCard.ready === true,
      required: true,
      nextAction: clientExportCard.primaryAction,
      idempotencyKey: clientExportCard.route?.idempotencyKey,
      resumeToken: clientExportCard.restartSemantics?.resumeFromCardId,
      blockedReasons: stableList(clientExportCard.validationSummary?.blockedReasons),
    },
    {
      rowId: `${clientResumePacket.packetId}:resume`,
      phase: 'client-runtime-resume',
      source: 'compile-cache-client-resume-packet',
      status: clientResumePacket.state,
      ready: clientResumePacket.readyForClientRuntime === true,
      required: true,
      nextAction: clientResumePacket.nextAction,
      idempotencyKey: clientResumePacket.route?.idempotencyKey,
      resumeToken: clientResumePacket.resumeToken,
      blockedReasons: stableList(clientResumePacket.blockedReasons),
    },
    {
      rowId: `${replayCommandBundle.bundleKey}:commands`,
      phase: 'replay-command-bundle',
      source: 'compile-cache-replay-command-bundle',
      status: replayCommandBundle.status,
      ready: replayCommandBundle.ready === true,
      required: true,
      nextAction: replayCommandBundle.nextAction,
      idempotencyKey: replayCommandBundle.idempotencyKey,
      resumeToken: replayCommandBundle.restartSemantics?.resumeFromBundleKey || replayCommandBundle.bundleKey,
      blockedReasons: stableList(replayCommandBundle.blockedReasons),
    },
    ...exportEntries.map((entry) => ({
      rowId: compactString(entry.rowId || entry.entryKey || entry.key || `export:${entry.artifactName || 'entry'}`),
      phase: `export-package:${entry.artifactName || entry.entryKey || 'entry'}`,
      source: 'compile-cache-export-package',
      status: compactString(entry.state || entry.status || (entry.ready === false ? 'blocked' : 'ready')),
      ready: entry.ready !== false && entry.state !== 'blocked',
      required: entry.required !== false,
      nextAction: compactString(entry.nextAction || exportPackage.nextAction || 'deliver_compile_cache_export'),
      idempotencyKey: compactString(entry.idempotencyKey || exportPackage.packageId),
      resumeToken: compactString(entry.resumeToken || exportPackage.packageId),
      blockedReasons: stableList(entry.blockedReasons),
    })),
    ...recoveryRows.map((row) => ({
      rowId: compactString(row.rowId),
      phase: `recovery-export:${row.reason || row.command || 'row'}`,
      source: 'compile-cache-recovery-export-lane',
      status: row.restartSafe === false || row.replaySafe === false ? 'blocked' : 'ready',
      ready: row.restartSafe !== false && row.replaySafe !== false,
      required: true,
      nextAction: compactString(row.command || row.nextAction || recoveryExportLane.nextAction),
      idempotencyKey: compactString(row.idempotencyKey),
      resumeToken: compactString(row.resumeToken),
      blockedReasons: stableList([
        ...(row.restartSafe === false ? ['recovery_row_not_restart_safe'] : []),
        ...(row.replaySafe === false ? ['recovery_row_not_replay_safe'] : []),
      ]),
    })),
    ...replayRows.map((row) => ({
      rowId: compactString(row.rowId || row.commandId),
      phase: `replay-command:${row.command || row.action || 'row'}`,
      source: 'compile-cache-replay-command-bundle',
      status: compactString(row.status || (row.restartSafe === false ? 'blocked' : 'waiting')),
      ready: row.status === 'ready' || row.ready === true,
      required: true,
      nextAction: compactString(row.command || row.action || row.nextAction || replayCommandBundle.nextAction),
      idempotencyKey: compactString(row.idempotencyKey),
      resumeToken: compactString(row.resumeToken),
      blockedReasons: stableList(row.blockedReasons),
    })),
    ...decisionRows
      .filter((row) => row.ready === false || row.severity === 'error')
      .map((row) => ({
        rowId: compactString(row.key || row.rowId || `decision:${row.reason || row.nextAction}`),
        phase: `decision:${row.owner || 'runtime'}`,
        source: 'compile-cache-decision-matrix',
        status: row.ready === false || row.severity === 'error' ? 'blocked' : 'waiting',
        ready: row.ready === true,
        required: row.blocking !== false,
        nextAction: compactString(row.nextAction || decisionMatrix.route?.primaryAction),
        idempotencyKey: compactString(row.idempotencyKey || decisionMatrix.idempotencyKey),
        resumeToken: compactString(row.resumeToken || decisionMatrix.idempotencyKey),
        blockedReasons: stableList(row.blockedReasons || row.reason),
      })),
  ].filter((row) => row.rowId);
  const normalizedRows = rows.map((row, index) => ({
    ...row,
    order: index + 1,
    rowId: compactString(row.rowId).replace(/[^a-zA-Z0-9_.:-]/g, '_'),
    routeState: row.ready === true ? 'ready' : row.status === 'waiting' ? 'waiting' : 'needs_attention',
    owner: row.source?.includes('provider') ? 'provider' : row.source?.includes('decision') ? 'runtime' : 'compiler',
  }));
  const blockedRows = normalizedRows.filter((row) => row.required !== false && row.ready !== true);
  const waitingRows = normalizedRows.filter((row) => row.status === 'waiting' || row.routeState === 'waiting');
  const nextRow = blockedRows[0] || waitingRows[0] || normalizedRows.find((row) => row.ready !== true) || normalizedRows[0] || null;
  const status = blockedRows.length > 0
    ? 'blocked'
    : waitingRows.length > 0
      ? 'waiting'
      : ready === true
        ? 'runtime-ready'
        : 'client-ready';
  const timelineKey = stableList([
    normalized.namespace,
    normalized.cacheKey || normalized.requestKey || 'compile-cache',
    status,
    nextRow?.rowId,
    normalized.contractHash,
  ]).join(':').replace(/[^a-zA-Z0-9_.:-]/g, '_');

  return {
    protocol: 'aios.compile-cache-client-export-timeline.mailchimp.v1',
    namespace: normalized.namespace,
    cacheKey: normalized.cacheKey,
    requestKey: normalized.requestKey,
    timelineKey,
    status,
    ready: blockedRows.length === 0,
    readyForClient: clientExportCard.readyForClient === true && blockedRows.length === 0,
    readyForRuntimeReplay: clientResumePacket.readyForRuntimeReplay === true && blockedRows.length === 0,
    nextAction: status === 'runtime-ready'
      ? normalized.replayed ? 'verify_cached_descriptor' : 'reuse_compile_cache'
      : nextRow?.nextAction || nextAction || 'review_compile_cache_status',
    nextRowId: nextRow?.rowId || null,
    lifecycle: {
      state: lifecycleExecution.state,
      routeState: lifecycleExecution.routeState,
      nextAction: lifecycleExecution.nextAction,
      commandAccepted: lifecycleExecution.commandAccepted === true,
    },
    counters: {
      rows: normalizedRows.length,
      readyRows: normalizedRows.filter((row) => row.ready).length,
      blockedRows: blockedRows.length,
      waitingRows: waitingRows.length,
      exportPackageRows: exportEntries.length,
      recoveryRows: recoveryRows.length,
      replayCommandRows: replayRows.length,
      decisionRows: decisionRows.length,
    },
    rows: normalizedRows,
    route: {
      target: 'client-runtime-export-timeline',
      method: 'POST',
      path: `/mailchimp/compile-cache/${encodeURIComponent(normalized.cacheKey || normalized.requestKey || 'preview')}/client-export/timeline`,
      idempotencyKey: `${timelineKey}:route`,
      primaryAction: blockedRows.length > 0 ? nextRow?.nextAction || 'review_compile_cache_status' : 'deliver_compile_cache_export',
      requiredBodyKeys: blockedRows.length > 0 ? ['cacheKey', 'rowId'] : ['cacheKey', 'statusRevision'],
    },
    clientPatch: {
      compileCacheClientExportTimelineKey: timelineKey,
      compileCacheClientExportTimelineStatus: status,
      compileCacheClientExportTimelineReady: blockedRows.length === 0,
      compileCacheClientExportTimelineNextAction: nextRow?.nextAction || nextAction,
      compileCacheClientExportTimelineNextRowId: nextRow?.rowId || null,
      compileCacheClientExportTimelineBlockedRows: blockedRows.map((row) => row.rowId),
    },
    exportSummary: {
      artifactName: 'compile-cache-client-export-timeline.json',
      readyForExport: blockedRows.length === 0,
      rowIds: normalizedRows.map((row) => row.rowId),
      blockedRowIds: blockedRows.map((row) => row.rowId),
      waitingRowIds: waitingRows.map((row) => row.rowId),
    },
    restartSemantics: {
      replaySafe: blockedRows.length === 0 || status === 'waiting',
      duplicateCommandPolicy: 'dedupe-by-compile-cache-client-export-timeline',
      resumeFromTimelineKey: timelineKey,
      externalWritesPerformed: false,
    },
  };
}

export function buildMailchimpCompileCacheStatusHandoff(source = {}, runtime = {}) {
  const normalized = normalizeStatusHandoffSource(source);
  const recoveryExportLane = normalized.exportSummary.recoveryExportLane
    && normalized.exportSummary.recoveryExportLane.protocol === 'aios.compile-cache-recovery-export-lane.mailchimp.v1'
    ? normalized.exportSummary.recoveryExportLane
    : buildMailchimpCompileCacheRecoveryExportLane({
      namespace: normalized.namespace,
      entries: normalized.entries,
      analytics: normalized.analytics,
      generatedAt: normalized.exportSummary.generatedAt,
    });
  const baseSource = {
    protocol: 'aios.compile-cache-snapshot.mailchimp.v1',
    namespace: normalized.namespace,
    entries: normalized.entries,
    analytics: normalized.analytics,
    exportSummary: normalized.exportSummary,
    history: normalized.history,
    lifecycle: normalized.lifecycle,
    compileCache: {
      cacheKey: normalized.cacheKey,
      requestKey: normalized.requestKey,
      status: normalized.status,
      replayed: normalized.replayed,
      stale: normalized.stale,
      sourceHash: normalized.sourceHash,
      optionsHash: normalized.optionsHash,
      contractHash: normalized.contractHash,
      ttlRemainingMs: normalized.ttlRemainingMs,
      providerSyncCheckpoint: normalized.providerSyncCheckpoint,
      providerServiceContract: normalized.providerServiceContract,
      boundaryScope: normalized.boundaryScope,
      lifecycleCommandCheckpoint: normalized.entries[0]?.clientWorkflowHandoff?.lifecycleCommandCheckpoint
        || normalized.entries[0]?.lifecycleCommandCheckpoint
        || source.lifecycleCommandCheckpoint
        || source.compileCache?.lifecycleCommandCheckpoint
        || runtime.lifecycleCommandCheckpoint
        || {},
    },
  };
  const uiHandoff = normalized.uiHandoff && normalized.uiHandoff.protocol === 'aios.compile-cache-ui-handoff.mailchimp.v1'
    ? normalized.uiHandoff
    : buildMailchimpCompileCacheUiHandoff(baseSource, runtime);
  const replayBarrier = normalized.replayBarrier && normalized.replayBarrier.protocol === 'aios.compile-cache-replay-barrier.mailchimp.v1'
    ? normalized.replayBarrier
    : uiHandoff.replayBarrier || buildMailchimpCompileCacheReplayBarrier({
      cacheKey: normalized.cacheKey,
      status: normalized.status,
      replayed: normalized.replayed,
      providerSyncCheckpoint: normalized.providerSyncCheckpoint,
      providerServiceContract: normalized.providerServiceContract,
      boundaryScope: normalized.boundaryScope,
      uiHandoff,
    }, runtime);
  const persistedReplayState = normalized.persistedReplayState
    && normalized.persistedReplayState.protocol === 'aios.compile-cache-persisted-replay-state.mailchimp.v1'
    ? normalized.persistedReplayState
    : buildMailchimpCompileCachePersistedReplayState({
      ...baseSource,
      compileCache: {
        ...baseSource.compileCache,
        uiHandoff,
        replayBarrier,
        report: normalized.exportSummary,
        exportReady: normalized.exportSummary.exportReady,
      },
    }, runtime);
  const operationalHealth = normalized.operationalHealth
    && normalized.operationalHealth.protocol === 'aios.compile-cache-operational-health.mailchimp.v1'
    ? normalized.operationalHealth
    : buildMailchimpCompileCacheOperationalHealthReport({
      stale: normalized.stale,
      providerSyncCheckpoint: normalized.providerSyncCheckpoint,
      providerServiceContract: normalized.providerServiceContract,
      report: normalized.exportSummary,
      lifecycleDecision: normalized.lifecycle,
      replayBarrier,
      persistedReplaySummary: persistedReplayState,
    }, runtime);
  const exportPackage = normalized.exportPackage
    && normalized.exportPackage.protocol === 'aios.compile-cache-export-package.mailchimp.v1'
    ? normalized.exportPackage
    : buildMailchimpCompileCacheExportPackage({
      ...baseSource,
      compileCache: {
        ...baseSource.compileCache,
        uiHandoff,
        lifecycle: normalized.lifecycle,
        exportSummary: normalized.exportSummary,
      },
    }, runtime);
  const persistedSnapshotState = normalized.persistedSnapshotState
    && normalized.persistedSnapshotState.protocol === 'aios.compile-cache-persisted-snapshot-state.mailchimp.v1'
    ? normalized.persistedSnapshotState
    : buildMailchimpCompileCachePersistedSnapshotState({
      ...baseSource,
      exportSummary: normalized.exportSummary,
      lifecycle: normalized.lifecycle,
    }, runtime);
  const clientWorkflowHandoff = normalized.clientWorkflowHandoff
    && normalized.clientWorkflowHandoff.protocol === 'aios.compile-cache-client-workflow-handoff.mailchimp.v1'
    ? normalized.clientWorkflowHandoff
    : buildMailchimpCompileCacheClientWorkflowHandoff({
      namespace: normalized.namespace,
      cacheKey: normalized.cacheKey,
      requestKey: normalized.requestKey,
      status: normalized.status,
      replayed: normalized.replayed,
      stale: normalized.stale,
      sourceHash: normalized.sourceHash,
      optionsHash: normalized.optionsHash,
      contractHash: normalized.contractHash,
      ttlRemainingMs: normalized.ttlRemainingMs,
      diagnostics: normalized.entries[0]?.diagnostics || {},
      providerSyncCheckpoint: normalized.providerSyncCheckpoint,
      providerServiceContract: normalized.providerServiceContract,
      boundaryScope: normalized.boundaryScope,
      acceptance: uiHandoff.acceptance || {},
      lifecycleCommandCheckpoint: baseSource.compileCache.lifecycleCommandCheckpoint,
    }, runtime);
  const lifecycleCommandCheckpoint = clientWorkflowHandoff.lifecycleCommandCheckpoint
    && clientWorkflowHandoff.lifecycleCommandCheckpoint.protocol === 'aios.compile-cache-lifecycle-command-checkpoint.mailchimp.v1'
    ? clientWorkflowHandoff.lifecycleCommandCheckpoint
    : normalizeLifecycleCommandCheckpoint({
      namespace: normalized.namespace,
      cacheKey: normalized.cacheKey,
      requestKey: normalized.requestKey,
      client: runtime.client || runtime.clientState || {},
      request: runtime.request || runtime.clientRequest || {},
      lifecycleCommandCheckpoint: baseSource.compileCache.lifecycleCommandCheckpoint,
    }, clientWorkflowHandoff.requestState?.adoption || {}, runtime);
  const providerReplayHandoff = clientWorkflowHandoff.providerReplayHandoff
    && clientWorkflowHandoff.providerReplayHandoff.protocol === 'aios.compile-cache-provider-replay-handoff.mailchimp.v1'
    ? clientWorkflowHandoff.providerReplayHandoff
    : buildMailchimpCompileCacheProviderReplayHandoff({
      providerSyncCheckpoint: normalized.providerSyncCheckpoint,
      providerServiceContract: normalized.providerServiceContract,
      boundaryCheckpoint: clientWorkflowHandoff.boundaryState || {},
      requestAdoption: clientWorkflowHandoff.requestState?.adoption || {},
    }, runtime);
  const recoveryJournal = buildMailchimpCompileCacheRecoveryJournal({
    namespace: normalized.namespace,
    cacheKey: normalized.cacheKey,
    requestKey: normalized.requestKey,
    status: normalized.status,
    uiHandoff,
    replayBarrier,
    persistedReplayState,
    persistedSnapshotState,
    operationalHealth,
    exportPackage,
    clientWorkflowHandoff,
    lifecycle: normalized.lifecycle,
  });
  const resumeGate = buildMailchimpCompileCacheResumeGate({
    namespace: normalized.namespace,
    cacheKey: normalized.cacheKey,
    requestKey: normalized.requestKey,
    status: normalized.status,
    replayed: normalized.replayed,
    stale: normalized.stale,
    ttlRemainingMs: normalized.ttlRemainingMs,
    sourceHash: normalized.sourceHash,
    optionsHash: normalized.optionsHash,
    contractHash: normalized.contractHash,
    uiHandoff,
    replayBarrier,
    persistedReplayState,
    persistedSnapshotState,
    operationalHealth,
    exportPackage,
    clientWorkflowHandoff,
    providerSyncCheckpoint: normalized.providerSyncCheckpoint,
    providerServiceContract: normalized.providerServiceContract,
    boundaryScope: normalized.boundaryScope,
    lifecycle: normalized.lifecycle,
    exportSummary: normalized.exportSummary,
    providerReplayHandoff,
    recoveryJournal,
  }, runtime);
  const resumeEvidenceHandoff = normalized.resumeEvidenceHandoff
    && normalized.resumeEvidenceHandoff.protocol === 'aios.compile-cache-resume-evidence-handoff.mailchimp.v1'
    ? normalized.resumeEvidenceHandoff
    : buildMailchimpCompileCacheResumeEvidenceHandoff({
      namespace: normalized.namespace,
      cacheKey: normalized.cacheKey,
      requestKey: normalized.requestKey,
      status: normalized.status,
      replayed: normalized.replayed,
      providerSyncCheckpoint: normalized.providerSyncCheckpoint,
      providerServiceContract: normalized.providerServiceContract,
      boundaryScope: normalized.boundaryScope,
      clientWorkflowHandoff,
      providerReplayHandoff,
      replayBarrier,
      persistedReplayState,
      resumeGate,
    }, runtime);
  const acceptancePreview = uiHandoff.acceptancePreview
    || exportPackage.acceptancePreview
    || buildMailchimpCompileCacheAcceptancePreview({
      namespace: normalized.namespace,
      cacheKey: normalized.cacheKey,
      status: normalized.status,
      replayed: normalized.replayed,
      entries: normalized.entries.map(normalizePreviewEntry),
      readiness: uiHandoff.readiness || {},
      acceptance: uiHandoff.acceptance || {},
      validationSummary: uiHandoff.validationSummary || {},
      nextSteps: uiHandoff.nextSteps || [],
      providerSyncCheckpoint: normalized.providerSyncCheckpoint,
      providerServiceContract: normalized.providerServiceContract,
      boundaryScope: normalized.boundaryScope,
      lifecycle: normalized.lifecycle,
      exportSummary: normalized.exportSummary,
      history: normalized.history,
      routeHints: uiHandoff.routeHints || {},
    }, runtime);
  const providerContinuity = normalized.providerServiceContract.serviceContinuity || {};
  const blockedReasons = stableList([
    ...(Array.isArray(uiHandoff.validationSummary?.blockedReasons) ? uiHandoff.validationSummary.blockedReasons : []),
    ...(Array.isArray(acceptancePreview.validation?.blockedReasons) ? acceptancePreview.validation.blockedReasons : []),
    ...(Array.isArray(replayBarrier.blockedReasons) ? replayBarrier.blockedReasons : []),
    ...(Array.isArray(persistedReplayState.blockedReasons) ? persistedReplayState.blockedReasons : []),
    ...(Array.isArray(persistedSnapshotState.blockedReasons) ? persistedSnapshotState.blockedReasons : []),
    ...(Array.isArray(operationalHealth.blockedReasons) ? operationalHealth.blockedReasons : []),
    ...(Array.isArray(exportPackage.blockedReasons) ? exportPackage.blockedReasons : []),
    ...(Array.isArray(clientWorkflowHandoff.blockedReasons) ? clientWorkflowHandoff.blockedReasons : []),
    ...(Array.isArray(providerReplayHandoff.blockedReasons) ? providerReplayHandoff.blockedReasons : []),
    ...(Array.isArray(providerContinuity.degradedReasons) ? providerContinuity.degradedReasons : []),
    ...(providerContinuity.holdExternalWrite === true ? ['provider_continuity_hold_external_write'] : []),
    ...(lifecycleCommandCheckpoint.restartSafe === false ? ['lifecycle_command_checkpoint_not_restart_safe'] : []),
    ...(lifecycleCommandCheckpoint.state === 'held' ? ['lifecycle_command_checkpoint_held'] : []),
    ...(lifecycleCommandCheckpoint.state === 'blocked' ? lifecycleCommandCheckpoint.blockedReasons : []),
    ...(Array.isArray(resumeGate.blockedReasons) ? resumeGate.blockedReasons : []),
    ...(Array.isArray(resumeEvidenceHandoff.missingEvidence)
      ? resumeEvidenceHandoff.missingEvidence.map((reason) => `resume_evidence:${reason}`)
      : []),
    ...(Array.isArray(recoveryJournal.blockedReasons) ? recoveryJournal.blockedReasons : []),
    ...(Array.isArray(recoveryExportLane.blockedReasons) ? recoveryExportLane.blockedReasons : []),
  ]);
  const ready = resumeGate.ready === true
    && uiHandoff.readiness?.ready === true
    && replayBarrier.open === true
    && persistedReplayState.restartSafe === true
    && persistedSnapshotState.restartSafe === true
    && recoveryJournal.restartSafe === true
    && operationalHealth.failed !== true
    && exportPackage.exportReady === true
    && acceptancePreview.ready === true
    && clientWorkflowHandoff.ready === true
    && lifecycleCommandCheckpoint.restartSafe !== false
    && lifecycleCommandCheckpoint.state !== 'held'
    && lifecycleCommandCheckpoint.state !== 'blocked'
    && providerReplayHandoff.ready === true
    && providerContinuity.holdExternalWrite !== true
    && resumeEvidenceHandoff.ready === true
    && recoveryExportLane.exportReady === true
    && blockedReasons.length === 0;
  const nextAction = ready
    ? normalized.replayed
      ? 'verify_cached_descriptor'
      : 'reuse_compile_cache'
    : recoveryJournal.state === 'conflict'
      ? recoveryJournal.nextAction
      : lifecycleCommandCheckpoint.state === 'held' || lifecycleCommandCheckpoint.state === 'blocked'
        ? lifecycleCommandCheckpoint.nextAction
      : providerContinuity.holdExternalWrite === true
        ? providerContinuity.nextAction || 'hold_for_provider_recovery'
      : providerContinuity.degraded === true
        ? providerContinuity.nextAction || 'refresh_provider_contract'
      : resumeEvidenceHandoff.ready === false
        ? resumeEvidenceHandoff.nextAction
      : resumeGate.nextAction
      || acceptancePreview.nextStep?.action
      || operationalHealth.nextAction
      || persistedReplayState.recovery?.command
      || replayBarrier.recoveryCommand
      || uiHandoff.routeHints?.recoveryCommand
      || recoveryExportLane.nextAction
      || exportPackage.nextAction
      || 'refresh_compile_cache';
  const lifecycleExecution = {
    state: compactString(normalized.lifecycle.executionPlan?.state || (normalized.lifecycle.blocked ? 'blocked' : 'unknown')),
    executable: normalized.lifecycle.executionPlan?.executable === true,
    command: compactString(normalized.lifecycle.command),
    candidateCommand: compactString(normalized.lifecycle.executionPlan?.candidateCommand || normalized.lifecycle.command),
    nextAction: compactString(normalized.lifecycle.nextAction),
    nextState: compactString(normalized.lifecycle.nextState?.state || normalized.lifecycle.controlContract?.state?.next),
    routeState: compactString(normalized.lifecycle.nextState?.routeState || normalized.lifecycle.controlContract?.state?.routeState),
    scheduleMode: compactString(normalized.lifecycle.schedule?.mode || normalized.lifecycle.executionPlan?.schedule?.mode),
    scheduleDue: normalized.lifecycle.executionPlan?.schedule?.due !== false,
    nextEligibleAt: normalized.lifecycle.executionPlan?.schedule?.nextEligibleAt ?? null,
    delayMs: positiveInteger(normalized.lifecycle.executionPlan?.schedule?.delayMs, 0),
    deferredReasons: stableList(normalized.lifecycle.executionPlan?.deferredReasons),
    blockedReasons: stableList(normalized.lifecycle.executionPlan?.blockedReasons),
    commandAccepted: normalized.lifecycle.controlContract?.commandAccepted === true,
    willChangeState: normalized.lifecycle.controlContract?.state?.willChangeState === true,
    mutatesSettings: normalized.lifecycle.controlContract?.state?.mutatesSettings === true,
    mutatesCache: normalized.lifecycle.controlContract?.state?.mutatesCache === true,
    effective: normalized.lifecycle.controlContract?.effective || null,
    idempotencyKey: compactString(normalized.lifecycle.nextState?.idempotencyKey || normalized.lifecycle.controlContract?.idempotencyKey),
  };
  const decisionMatrix = buildMailchimpCompileCacheDecisionMatrix({
    namespace: normalized.namespace,
    cacheKey: normalized.cacheKey,
    status: normalized.status,
    replayed: normalized.replayed,
    uiHandoff,
    acceptancePreview,
    acceptanceChecklist: uiHandoff.acceptanceChecklist,
    replayBarrier,
    persistedReplayState,
    persistedSnapshotState,
    recoveryJournal,
    operationalHealth,
    exportPackage,
    providerReplayHandoff,
    providerContinuity,
    lifecycleCommandCheckpoint,
    clientWorkflowHandoff,
    lifecycleExecution,
    readiness: uiHandoff.readiness || {},
    acceptance: uiHandoff.acceptance || acceptancePreview.acceptance || {},
    validationSummary: uiHandoff.validationSummary || {},
    routeHints: {
      primaryAction: nextAction,
      statusRouteState: ready ? 'ready' : operationalHealth.failed ? 'failed' : 'needs_attention',
      recoveryCommand: ready ? 'observe' : nextAction,
      canReplayCachedDescriptor: ready,
    },
  }, runtime);
  const clientExportCard = buildMailchimpCompileCacheClientExportCard({
    normalized,
    ready,
    nextAction,
    uiHandoff,
    acceptancePreview,
    replayBarrier,
    persistedReplayState,
    persistedSnapshotState,
    operationalHealth,
    exportPackage,
    recoveryExportLane,
    clientWorkflowHandoff,
    providerReplayHandoff,
    lifecycleCommandCheckpoint,
    resumeGate,
    resumeEvidenceHandoff,
    recoveryJournal,
    decisionMatrix,
    blockedReasons,
  });
  const clientResumePacket = buildMailchimpCompileCacheClientResumePacket({
    normalized,
    ready,
    nextAction,
    decisionMatrix,
    clientWorkflowHandoff,
    clientExportCard,
    resumeGate,
    resumeEvidenceHandoff,
    lifecycleCommandCheckpoint,
    providerReplayHandoff,
    operationalHealth,
    exportPackage,
    recoveryExportLane,
    blockedReasons,
  });
  const replayCommandBundle = buildMailchimpCompileCacheReplayCommandBundle({
    normalized,
    ready,
    nextAction,
    decisionMatrix,
    clientResumePacket,
    resumeGate,
    resumeEvidenceHandoff,
    lifecycleCommandCheckpoint,
    providerReplayHandoff,
    replayBarrier,
    persistedReplayState,
    recoveryExportLane,
    blockedReasons,
  });
  const clientExportTimeline = buildMailchimpCompileCacheClientExportTimeline({
    normalized,
    ready,
    nextAction,
    clientExportCard,
    clientResumePacket,
    replayCommandBundle,
    recoveryExportLane,
    exportPackage,
    decisionMatrix,
    lifecycleExecution,
  });

  return {
    protocol: 'aios.compile-cache-status-handoff.mailchimp.v1',
    namespace: normalized.namespace,
    cacheKey: normalized.cacheKey,
    requestKey: normalized.requestKey,
    status: normalized.status,
    replayed: normalized.replayed,
    ready,
    statusRouteState: ready ? 'ready' : operationalHealth.failed ? 'failed' : 'needs_attention',
    nextAction,
    recoveryCommand: ready ? 'observe' : nextAction,
    blockedReasons,
    acceptancePreview,
    lifecycleExecution,
    decisionMatrix,
    clientExportCard,
    clientExportTimeline,
    clientResumePacket,
    replayCommandBundle,
    decisionRoute: {
      statusRouteState: decisionMatrix.route.statusRouteState,
      primaryAction: decisionMatrix.route.primaryAction,
      recoveryCommand: decisionMatrix.route.recoveryCommand,
      canReplayCachedDescriptor: decisionMatrix.route.canReplayCachedDescriptor,
      blockingRows: decisionMatrix.counts.blocking,
      actionCount: decisionMatrix.actionQueue.length,
      idempotencyKey: decisionMatrix.idempotencyKey,
    },
    replaySafe: replayBarrier.canReplayCachedDescriptor === true && persistedReplayState.replaySafe === true,
    restartSafe: replayBarrier.restartSafe === true
      && persistedReplayState.restartSafe === true
      && persistedSnapshotState.restartSafe === true
      && resumeGate.restartResumeContract?.restartSafe === true,
    resumeGate,
    restartResumeContract: resumeGate.restartResumeContract,
    recoveryJournal,
    providerReplayHandoff,
    providerContinuity,
    lifecycleCommandCheckpoint,
    resumeEvidenceHandoff,
    exportReady: exportPackage.exportReady === true,
    restoreMode: persistedSnapshotState.restoreMode,
    degradedMode: operationalHealth.degradedMode,
    reporting: {
      state: compactString(normalized.history.reportingState?.state || normalized.exportSummary.reportingState?.state),
      nextAction: compactString(normalized.history.reportingState?.nextAction || normalized.exportSummary.reportingState?.nextAction),
      exportReady: normalized.history.exportReady === true || normalized.exportSummary.exportReady === true,
      snapshotCount: positiveInteger(normalized.history.timeline?.snapshotCount, 0),
      latestAt: normalized.history.timeline?.latestAt ?? normalized.exportSummary.timeline?.latestAt ?? null,
      latestKind: compactString(normalized.history.timeline?.latestKind || normalized.exportSummary.timeline?.latestKind),
      latestStatus: compactString(normalized.history.timeline?.latestStatus || normalized.exportSummary.timeline?.latestStatus),
      recoveryLaneStatus: recoveryExportLane.status,
      recoveryLaneNextAction: recoveryExportLane.nextAction,
      recoveryLaneRows: recoveryExportLane.counters.rows,
      recoveryLaneBlockedRows: recoveryExportLane.counters.blockedRows,
      replayCommandBundleStatus: replayCommandBundle.status,
      replayCommandBundleRows: replayCommandBundle.counters.commands,
      replayCommandBundleBlockedRows: replayCommandBundle.counters.blocked,
      clientExportTimelineStatus: clientExportTimeline.status,
      clientExportTimelineRows: clientExportTimeline.counters.rows,
      clientExportTimelineBlockedRows: clientExportTimeline.counters.blockedRows,
    },
    uiHandoff,
    replayBarrier,
    persistedReplayState,
    persistedSnapshotState,
    operationalHealth,
    exportPackage,
    recoveryExportLane,
    clientWorkflowHandoff,
    clientExportTimeline,
    lifecycleCommandCheckpoint,
    resumeEvidenceHandoff,
    checkpoint: {
      providerState: compactString(normalized.providerSyncCheckpoint.state || 'unknown'),
      providerRestartSafe: normalized.providerSyncCheckpoint.restartSafe === true,
      providerContractState: compactString(normalized.providerServiceContract.negotiation?.state || 'unknown'),
      providerContractSatisfied: normalized.providerServiceContract.negotiation?.satisfied !== false,
      providerContinuityMode: compactString(providerContinuity.mode || 'unknown'),
      providerContinuityHealthy: providerContinuity.healthy === true,
      providerContinuityNextAction: compactString(providerContinuity.nextAction),
      providerReplayState: compactString(providerReplayHandoff.state || 'unknown'),
      providerReplayReady: providerReplayHandoff.ready === true,
      lifecycleCommandState: compactString(lifecycleCommandCheckpoint.state || 'unobserved'),
      lifecycleCommandRestartSafe: lifecycleCommandCheckpoint.restartSafe !== false,
      lifecycleCommandNextAction: compactString(lifecycleCommandCheckpoint.nextAction),
      resumeEvidenceState: compactString(resumeEvidenceHandoff.state || 'unknown'),
      resumeEvidenceReady: resumeEvidenceHandoff.ready === true,
      resumeEvidenceMissing: stableList(resumeEvidenceHandoff.missingEvidence),
      replayCommandBundleReady: replayCommandBundle.ready === true,
      replayCommandBundleNextAction: replayCommandBundle.nextAction,
      replayCommandBundleBlockedRows: replayCommandBundle.counters.blocked,
      clientExportTimelineReady: clientExportTimeline.ready === true,
      clientExportTimelineNextAction: clientExportTimeline.nextAction,
      clientExportTimelineNextRowId: clientExportTimeline.nextRowId,
      boundaryAllowed: normalized.boundaryScope.allowed !== false,
      ttlRemainingMs: normalized.ttlRemainingMs,
      sourceHash: normalized.sourceHash,
      optionsHash: normalized.optionsHash,
      contractHash: normalized.contractHash,
    },
  };
}

function normalizeRestartResumeRuntime(runtime = {}) {
  const resume = runtime.compileCacheResume && typeof runtime.compileCacheResume === 'object'
    ? runtime.compileCacheResume
    : runtime.resume && typeof runtime.resume === 'object'
      ? runtime.resume
      : {};
  const replay = runtime.compileCacheReplay && typeof runtime.compileCacheReplay === 'object'
    ? runtime.compileCacheReplay
    : runtime.replayControls && typeof runtime.replayControls === 'object'
      ? runtime.replayControls
      : {};
  const command = normalizeRecoveryCommand(
    resume.command
      || resume.nextAction
      || replay.command
      || replay.nextAction
      || runtime.resumeCommand
      || runtime.recoveryCommand
      || runtime.nextAction,
    '',
  );
  const acceptance = runtime.acceptance && typeof runtime.acceptance === 'object'
    ? runtime.acceptance
    : runtime.operatorAcceptance && typeof runtime.operatorAcceptance === 'object'
      ? runtime.operatorAcceptance
      : {};

  return {
    command,
    cacheKey: compactString(resume.cacheKey || runtime.cacheKey),
    requestKey: compactString(resume.requestKey || runtime.requestKey),
    sourceHash: compactString(resume.sourceHash || runtime.sourceHash),
    optionsHash: compactString(resume.optionsHash || runtime.optionsHash),
    contractHash: compactString(resume.contractHash || runtime.contractHash),
    replayKey: compactString(resume.replayKey || replay.replayKey || runtime.replayKey),
    idempotencyKey: compactString(resume.idempotencyKey || replay.idempotencyKey || runtime.idempotencyKey),
    attemptKey: compactString(resume.attemptKey || replay.attemptKey || runtime.attemptKey),
    accepted: acceptance.accepted === true || resume.accepted === true,
    acceptedBy: compactString(acceptance.acceptedBy || resume.acceptedBy),
    acceptedAt: compactString(acceptance.acceptedAt || resume.acceptedAt),
  };
}

function runtimeResumeValueMismatch(expected, observed, reason) {
  const expectedValue = compactString(expected);
  const observedValue = compactString(observed);
  return expectedValue && observedValue && expectedValue !== observedValue ? [reason] : [];
}

function commandCanResume(expectedCommand, observedCommand) {
  const expected = normalizeRecoveryCommand(expectedCommand, 'observe');
  const observed = normalizeRecoveryCommand(observedCommand, '');
  if (!observed) return true;
  if (observed === expected || observed === 'observe') return true;
  if (expected === 'resume_from_compile_cache' && observed === 'reuse_compile_cache') return true;
  if (expected === 'reuse_compile_cache' && observed === 'resume_from_compile_cache') return true;
  if (expected === 'verify_cached_descriptor' && observed === 'resume_from_compile_cache') return true;
  return false;
}

function normalizeReplayCommandBundleRow(item = {}, context = {}) {
  const command = normalizeRecoveryCommand(
    item.command
      || item.action
      || item.nextAction
      || item.recoveryCommand
      || context.fallbackCommand,
    context.fallbackCommand || 'observe',
  );
  const owner = compactString(item.owner || inferRecoveryCommandOwner(command));
  const phase = compactString(item.phase || inferRecoveryCommandPhase(command, item.status || context.status));
  const reason = compactString(item.reason || item.code || item.status || context.reason || 'status_handoff');
  const blockedReasons = stableList([
    ...(Array.isArray(item.blockedReasons) ? item.blockedReasons : []),
    ...(item.blocking === true ? [reason] : []),
    ...(item.restartSafe === false ? ['command_not_restart_safe'] : []),
  ]);
  const rowKey = compactString(item.rowId || item.commandId || item.idempotencyKey || [
    context.namespace || 'mailchimp',
    context.cacheKey || 'no-cache',
    context.requestKey || 'no-request',
    command,
    reason,
  ].join(':')).replace(/[^a-zA-Z0-9_.:-]/g, '_');
  const restartSafe = item.restartSafe !== false && blockedReasons.length === 0;
  const retryable = item.retry?.retryable === true
    || (restartSafe && owner !== 'operator' && command !== 'observe');

  return {
    rowId: rowKey,
    commandId: compactString(item.commandId || `${rowKey}:command`),
    command,
    owner,
    phase,
    reason,
    status: restartSafe
      ? item.ready === true || item.replaySafe === true || command === 'observe' ? 'ready' : 'waiting'
      : 'blocked',
    enabled: item.enabled !== false && restartSafe,
    blocking: item.blocking === true || blockedReasons.length > 0,
    restartSafe,
    replaySafe: item.replaySafe === true || (restartSafe && command === 'observe'),
    localOnly: item.localOnly !== false,
    idempotencyKey: compactString(item.idempotencyKey || rowKey),
    resumeToken: compactString(item.resumeToken || `${rowKey}:resume`),
    retry: {
      retryable,
      retryAfterMs: positiveInteger(item.retry?.retryAfterMs ?? item.retryAfterMs, context.retryAfterMs || 0),
      maxAttempts: positiveInteger(item.retry?.maxAttempts ?? item.maxAttempts, context.maxAttempts || 1),
      exhausted: item.retry?.exhausted === true,
    },
    schedule: item.schedule || context.schedule || null,
    blockedReasons,
  };
}

function buildMailchimpCompileCacheReplayCommandBundle({
  normalized,
  ready,
  nextAction,
  decisionMatrix,
  clientResumePacket,
  resumeGate,
  resumeEvidenceHandoff,
  lifecycleCommandCheckpoint,
  providerReplayHandoff,
  replayBarrier,
  persistedReplayState,
  recoveryExportLane,
  blockedReasons,
}) {
  const context = {
    namespace: normalized.namespace,
    cacheKey: normalized.cacheKey,
    requestKey: normalized.requestKey,
    status: normalized.status,
    fallbackCommand: ready ? (normalized.replayed ? 'verify_cached_descriptor' : 'reuse_compile_cache') : nextAction,
    reason: ready ? 'compile_cache_replay_ready' : 'compile_cache_replay_recovery',
    retryAfterMs: replayBarrier.retry?.retryAfterMs || persistedReplayState.retry?.retryAfterMs || 0,
    maxAttempts: replayBarrier.retry?.maxAttempts || persistedReplayState.retry?.maxAttempts || 1,
    schedule: normalized.lifecycle.schedule || null,
  };
  const rawRows = [
    ...(Array.isArray(decisionMatrix.actionQueue) ? decisionMatrix.actionQueue.map((row) => ({
      ...row,
      source: 'decision-matrix',
      command: row.command || row.action,
      reason: row.reason || row.status || 'decision_matrix',
      blocking: row.blocking,
    })) : []),
    ...(Array.isArray(recoveryExportLane.rows) ? recoveryExportLane.rows.map((row) => ({
      ...row,
      source: 'recovery-export-lane',
      command: row.command || row.nextAction,
      reason: row.reason || 'recovery_lane',
      blocking: row.restartSafe === false || row.replaySafe === false,
    })) : []),
    {
      source: 'resume-gate',
      command: resumeGate.recoveryCommand || resumeGate.nextAction,
      reason: resumeGate.failureState || resumeGate.routeState || 'resume_gate',
      owner: inferRecoveryCommandOwner(resumeGate.recoveryCommand || resumeGate.nextAction),
      restartSafe: resumeGate.restartSafe !== false,
      replaySafe: resumeGate.replaySafe === true,
      blocking: resumeGate.ready === false,
      blockedReasons: resumeGate.blockedReasons,
      retry: resumeGate.retry,
      idempotencyKey: resumeGate.restartResumeContract?.idempotencyKey,
      resumeToken: resumeGate.restartResumeContract?.keys?.replayKey,
    },
    {
      source: 'resume-evidence',
      command: resumeEvidenceHandoff.recoveryCommand || resumeEvidenceHandoff.nextAction,
      reason: resumeEvidenceHandoff.state || 'resume_evidence',
      owner: inferRecoveryCommandOwner(resumeEvidenceHandoff.recoveryCommand || resumeEvidenceHandoff.nextAction),
      restartSafe: resumeEvidenceHandoff.restartSafe !== false,
      replaySafe: resumeEvidenceHandoff.replaySafe === true,
      blocking: resumeEvidenceHandoff.ready === false,
      blockedReasons: stableList(resumeEvidenceHandoff.missingEvidence).map((item) => `missing:${item}`),
      idempotencyKey: resumeEvidenceHandoff.route?.idempotencyKey,
      resumeToken: resumeEvidenceHandoff.route?.resumeToken,
    },
    {
      source: 'client-resume-packet',
      command: clientResumePacket.nextAction,
      reason: clientResumePacket.state || 'client_resume',
      owner: inferRecoveryCommandOwner(clientResumePacket.nextAction),
      restartSafe: clientResumePacket.restartSemantics?.replaySafe !== false,
      replaySafe: clientResumePacket.readyForRuntimeReplay === true,
      blocking: clientResumePacket.readyForClientRuntime === false,
      blockedReasons: clientResumePacket.blockedReasons,
      retry: clientResumePacket.retry,
      idempotencyKey: clientResumePacket.route?.idempotencyKey || clientResumePacket.packetId,
      resumeToken: clientResumePacket.resumeToken,
    },
    {
      source: 'lifecycle-command-checkpoint',
      command: lifecycleCommandCheckpoint.nextAction || lifecycleCommandCheckpoint.submitAction,
      reason: lifecycleCommandCheckpoint.state || 'lifecycle_command',
      owner: inferRecoveryCommandOwner(lifecycleCommandCheckpoint.nextAction || lifecycleCommandCheckpoint.submitAction),
      restartSafe: lifecycleCommandCheckpoint.restartSafe !== false,
      replaySafe: lifecycleCommandCheckpoint.replaySafe !== false,
      blocking: lifecycleCommandCheckpoint.state === 'blocked' || lifecycleCommandCheckpoint.state === 'held',
      blockedReasons: lifecycleCommandCheckpoint.blockedReasons,
      idempotencyKey: lifecycleCommandCheckpoint.idempotencyKey || lifecycleCommandCheckpoint.checkpointKey,
      resumeToken: lifecycleCommandCheckpoint.checkpointKey,
    },
    {
      source: 'provider-replay-handoff',
      command: providerReplayHandoff.nextAction,
      reason: providerReplayHandoff.state || 'provider_replay',
      owner: providerReplayHandoff.adapterRecoveryState?.owner || inferRecoveryCommandOwner(providerReplayHandoff.nextAction),
      restartSafe: providerReplayHandoff.restartSafe !== false,
      replaySafe: providerReplayHandoff.replayAllowed === true,
      blocking: providerReplayHandoff.ready === false,
      blockedReasons: providerReplayHandoff.blockedReasons,
      idempotencyKey: providerReplayHandoff.route?.idempotencyKey,
      resumeToken: providerReplayHandoff.route?.resumeToken,
    },
  ];
  const rows = rawRows
    .filter((row) => compactString(row.command || row.action || row.nextAction || row.recoveryCommand))
    .map((row) => normalizeReplayCommandBundleRow(row, context))
    .reduce((unique, row) => {
      const key = row.idempotencyKey || row.rowId;
      if (unique.keys.has(key)) return unique;
      unique.keys.add(key);
      unique.items.push({ ...row, sequence: unique.items.length + 1 });
      return unique;
    }, { keys: new Set(), items: [] }).items;
  const blockingRows = rows.filter((row) => row.blocking || row.status === 'blocked');
  const retryableRows = rows.filter((row) => row.retry.retryable === true);
  const primary = blockingRows[0]
    || rows.find((row) => row.command === context.fallbackCommand)
    || rows[0]
    || normalizeReplayCommandBundleRow({ command: context.fallbackCommand, reason: context.reason }, context);
  const exportReady = ready || (blockingRows.length === 0 && rows.every((row) => row.restartSafe));
  const bundleKey = stableList([
    normalized.namespace,
    normalized.cacheKey,
    normalized.requestKey,
    normalized.contractHash,
    primary.command,
    rows.map((row) => row.idempotencyKey).join('|'),
  ]).join(':').replace(/[^a-zA-Z0-9_.:-]/g, '_');

  return {
    protocol: 'aios.compile-cache-replay-command-bundle.mailchimp.v1',
    bundleKey,
    namespace: normalized.namespace,
    cacheKey: normalized.cacheKey,
    requestKey: normalized.requestKey,
    status: exportReady ? 'ready' : 'blocked',
    ready: exportReady,
    replayed: normalized.replayed,
    nextAction: exportReady ? context.fallbackCommand : primary.command,
    recoveryCommand: exportReady ? 'observe' : primary.command,
    nextCommandId: primary.commandId,
    idempotencyKey: bundleKey,
    counters: {
      commands: rows.length,
      ready: rows.filter((row) => row.status === 'ready').length,
      waiting: rows.filter((row) => row.status === 'waiting').length,
      blocked: blockingRows.length,
      retryable: retryableRows.length,
      operator: rows.filter((row) => row.owner === 'operator').length,
      provider: rows.filter((row) => row.owner === 'provider').length,
      runtime: rows.filter((row) => row.owner === 'runtime').length,
    },
    blockedReasons: stableList([
      ...blockedReasons,
      ...blockingRows.flatMap((row) => row.blockedReasons.length > 0 ? row.blockedReasons : [row.reason]),
    ]),
    timeline: {
      rowCount: rows.length,
      latestCommandId: primary.commandId,
      latestCommand: primary.command,
      rows: rows.map((row) => ({
        sequence: row.sequence,
        rowId: row.rowId,
        commandId: row.commandId,
        command: row.command,
        owner: row.owner,
        phase: row.phase,
        status: row.status,
        reason: row.reason,
      })),
    },
    exportSummary: {
      artifactName: 'compile-cache-replay-command-bundle.json',
      ready: exportReady,
      rowId: primary.rowId,
      status: exportReady ? 'ready' : 'blocked',
      nextAction: exportReady ? context.fallbackCommand : primary.command,
      blockedReasons: stableList(blockingRows.flatMap((row) => row.blockedReasons)),
    },
    clientPatch: {
      compileCacheReplayCommandBundleKey: bundleKey,
      compileCacheReplayCommandBundleReady: exportReady,
      compileCacheReplayCommandBundleNextAction: exportReady ? context.fallbackCommand : primary.command,
      compileCacheReplayCommandBundleBlocked: blockingRows.length,
    },
    restartSemantics: {
      replaySafe: exportReady,
      duplicateCommandPolicy: 'dedupe-by-compile-cache-replay-command-bundle',
      resumeFromCommandBundle: bundleKey,
      externalWritesPerformed: false,
    },
    rows,
  };
}

function deriveRestartResumeExpectedCommand(source = {}) {
  const replayBarrier = source.replayBarrier && typeof source.replayBarrier === 'object' ? source.replayBarrier : {};
  const persistedReplayState = source.persistedReplayState && typeof source.persistedReplayState === 'object'
    ? source.persistedReplayState
    : {};
  const recoveryJournal = source.recoveryJournal && typeof source.recoveryJournal === 'object' ? source.recoveryJournal : {};
  const providerReplayHandoff = source.providerReplayHandoff && typeof source.providerReplayHandoff === 'object'
    ? source.providerReplayHandoff
    : {};
  const clientWorkflowHandoff = source.clientWorkflowHandoff && typeof source.clientWorkflowHandoff === 'object'
    ? source.clientWorkflowHandoff
    : {};
  const operationalHealth = source.operationalHealth && typeof source.operationalHealth === 'object'
    ? source.operationalHealth
    : {};

  if (persistedReplayState.replaySafe === true && replayBarrier.open === true) {
    return source.replayed ? 'verify_cached_descriptor' : 'resume_from_compile_cache';
  }
  return normalizeRecoveryCommand(
    recoveryJournal.recoveryCommand
      || recoveryJournal.nextAction
      || persistedReplayState.recovery?.command
      || persistedReplayState.command?.nextAction
      || replayBarrier.recoveryCommand
      || replayBarrier.nextAction
      || providerReplayHandoff.nextAction
      || operationalHealth.recoveryCommand
      || operationalHealth.nextAction
      || clientWorkflowHandoff.recoveryCommand
      || clientWorkflowHandoff.primaryAction,
    'refresh_compile_cache',
  );
}

export function buildMailchimpCompileCacheRestartResumeContract(source = {}, runtime = {}) {
  const runtimeResume = normalizeRestartResumeRuntime(runtime);
  const persistedReplayState = source.persistedReplayState && typeof source.persistedReplayState === 'object'
    ? source.persistedReplayState
    : {};
  const persistedSnapshotState = source.persistedSnapshotState && typeof source.persistedSnapshotState === 'object'
    ? source.persistedSnapshotState
    : {};
  const replayBarrier = source.replayBarrier && typeof source.replayBarrier === 'object' ? source.replayBarrier : {};
  const recoveryJournal = source.recoveryJournal && typeof source.recoveryJournal === 'object'
    ? source.recoveryJournal
    : buildMailchimpCompileCacheRecoveryJournal(source);
  const providerReplayHandoff = source.providerReplayHandoff && typeof source.providerReplayHandoff === 'object'
    ? source.providerReplayHandoff
    : {};
  const expectedCommand = deriveRestartResumeExpectedCommand({
    ...source,
    persistedReplayState,
    replayBarrier,
    recoveryJournal,
    providerReplayHandoff,
  });
  const persistedReplayKey = compactString(persistedReplayState.command?.replayKey || persistedReplayState.replayKey);
  const persistedIdempotencyKey = compactString(
    persistedReplayState.command?.idempotencyKey
      || persistedReplayState.idempotencyKey
      || replayBarrier.replay?.idempotencyKey,
  );
  const snapshotIdempotencyKey = compactString(persistedSnapshotState.idempotencyKey);
  const acceptedBy = compactString(runtimeResume.acceptedBy || source.acceptance?.acceptedBy);
  const acceptedAt = compactString(runtimeResume.acceptedAt || source.acceptance?.acceptedAt);
  const acceptanceRequired = source.acceptance?.required === true
    || replayBarrier.acceptance?.required === true
    || persistedReplayState.acceptance?.required === true;
  const acceptanceSatisfied = !acceptanceRequired
    || runtimeResume.accepted === true
    || source.acceptance?.accepted === true
    || replayBarrier.acceptance?.accepted === true
    || persistedReplayState.acceptance?.accepted === true
    || Boolean(acceptedBy && acceptedAt);
  const commandAccepted = commandCanResume(expectedCommand, runtimeResume.command);
  const journalConflict = recoveryJournal.state === 'conflict'
    || recoveryJournal.counters?.conflicts > 0
    || stableList(recoveryJournal.blockedReasons).includes('recovery_command_conflict');
  const snapshotRecovering = persistedSnapshotState.restoreMode === 'rebuild_before_replay'
    || persistedSnapshotState.statusRouteState === 'recovery_required';
  const replayPersisted = persistedReplayState.protocol === 'aios.compile-cache-persisted-replay-state.mailchimp.v1';
  const snapshotPersisted = persistedSnapshotState.protocol === 'aios.compile-cache-persisted-snapshot-state.mailchimp.v1';
  const blockedReasons = stableList([
    ...runtimeResumeValueMismatch(source.cacheKey, runtimeResume.cacheKey, 'runtime_resume_cache_key_mismatch'),
    ...runtimeResumeValueMismatch(source.requestKey, runtimeResume.requestKey, 'runtime_resume_request_key_mismatch'),
    ...runtimeResumeValueMismatch(source.sourceHash, runtimeResume.sourceHash, 'runtime_resume_source_hash_mismatch'),
    ...runtimeResumeValueMismatch(source.optionsHash, runtimeResume.optionsHash, 'runtime_resume_options_hash_mismatch'),
    ...runtimeResumeValueMismatch(source.contractHash, runtimeResume.contractHash, 'runtime_resume_contract_hash_mismatch'),
    ...runtimeResumeValueMismatch(persistedReplayKey, runtimeResume.replayKey, 'runtime_resume_replay_key_mismatch'),
    ...runtimeResumeValueMismatch(persistedIdempotencyKey, runtimeResume.idempotencyKey, 'runtime_resume_idempotency_key_mismatch'),
    ...(commandAccepted ? [] : ['runtime_resume_command_mismatch']),
    ...(acceptanceSatisfied ? [] : ['operator_acceptance_missing']),
    ...(journalConflict ? ['recovery_journal_conflict'] : []),
    ...(replayPersisted && persistedReplayState.restartSafe !== true ? ['persisted_replay_not_restart_safe'] : []),
    ...(snapshotPersisted && persistedSnapshotState.restartSafe === false ? ['persisted_snapshot_not_restart_safe'] : []),
    ...(snapshotRecovering && persistedSnapshotState.replaySafe !== true ? ['persisted_snapshot_recovery_required'] : []),
    ...(replayBarrier.open === false ? ['replay_barrier_closed'] : []),
    ...(providerReplayHandoff.restartSafe === false ? ['provider_replay_handoff_not_restart_safe'] : []),
    ...(Array.isArray(recoveryJournal.blockedReasons) ? recoveryJournal.blockedReasons : []),
  ]);
  const restartSafe = blockedReasons.length === 0
    && commandAccepted
    && (!replayPersisted || persistedReplayState.restartSafe === true)
    && (!snapshotPersisted || persistedSnapshotState.restartSafe !== false)
    && recoveryJournal.restartSafe !== false;
  const replaySafe = restartSafe
    && replayBarrier.canReplayCachedDescriptor !== false
    && persistedReplayState.replaySafe !== false
    && persistedSnapshotState.replaySafe !== false;
  const state = restartSafe
    ? replaySafe ? 'resume_ready' : 'restart_safe_recovery'
    : journalConflict
      ? 'journal_conflict'
      : !commandAccepted
        ? 'command_mismatch'
        : snapshotRecovering
          ? 'snapshot_recovery_required'
          : 'restart_blocked';
  const recoveryCommand = restartSafe
    ? 'observe'
    : journalConflict
      ? recoveryJournal.nextAction || 'rebuild_persisted_replay_state'
      : !commandAccepted
        ? expectedCommand
        : snapshotRecovering
          ? persistedSnapshotState.recoveryCommand || persistedSnapshotState.nextAction || 'refresh_compile_cache'
          : persistedReplayState.recovery?.command || replayBarrier.recoveryCommand || expectedCommand;

  return {
    protocol: 'aios.compile-cache-restart-resume-contract.mailchimp.v1',
    namespace: compactString(source.namespace || 'mailchimp'),
    cacheKey: compactString(source.cacheKey),
    requestKey: compactString(source.requestKey),
    state,
    restartSafe,
    replaySafe,
    commandAccepted,
    expectedCommand,
    observedCommand: runtimeResume.command,
    nextAction: restartSafe ? expectedCommand : recoveryCommand,
    recoveryCommand,
    routeState: restartSafe ? 'ready' : 'recovery_required',
    acceptance: {
      required: acceptanceRequired,
      accepted: acceptanceSatisfied,
      acceptedBy,
      acceptedAt,
    },
    keys: {
      replayKey: persistedReplayKey,
      observedReplayKey: runtimeResume.replayKey,
      idempotencyKey: persistedIdempotencyKey,
      observedIdempotencyKey: runtimeResume.idempotencyKey,
      snapshotIdempotencyKey,
      attemptKey: runtimeResume.attemptKey,
    },
    persisted: {
      replayState: compactString(persistedReplayState.state || 'not_attached'),
      replayRestartSafe: persistedReplayState.restartSafe === true,
      snapshotRestoreMode: compactString(persistedSnapshotState.restoreMode || 'not_attached'),
      snapshotRestartSafe: persistedSnapshotState.restartSafe !== false,
      recoveryJournalState: compactString(recoveryJournal.state || 'empty'),
      recoveryJournalRestartSafe: recoveryJournal.restartSafe !== false,
      replayBarrierOpen: replayBarrier.open === true,
    },
    blockedReasons,
    idempotencyKey: stableList([
      source.namespace || 'mailchimp',
      source.cacheKey,
      source.requestKey,
      source.contractHash,
      expectedCommand,
      runtimeResume.command,
      blockedReasons.join('|'),
    ]).join(':'),
  };
}

export function buildMailchimpCompileCacheResumeGate(source = {}, runtime = {}) {
  const uiHandoff = source.uiHandoff && typeof source.uiHandoff === 'object' ? source.uiHandoff : {};
  const replayBarrier = source.replayBarrier && typeof source.replayBarrier === 'object' ? source.replayBarrier : {};
  const persistedReplayState = source.persistedReplayState && typeof source.persistedReplayState === 'object'
    ? source.persistedReplayState
    : {};
  const persistedSnapshotState = source.persistedSnapshotState && typeof source.persistedSnapshotState === 'object'
    ? source.persistedSnapshotState
    : {};
  const operationalHealth = source.operationalHealth && typeof source.operationalHealth === 'object'
    ? source.operationalHealth
    : {};
  const exportPackage = source.exportPackage && typeof source.exportPackage === 'object' ? source.exportPackage : {};
  const clientWorkflowHandoff = source.clientWorkflowHandoff && typeof source.clientWorkflowHandoff === 'object'
    ? source.clientWorkflowHandoff
    : {};
  const providerReplayHandoff = source.providerReplayHandoff && typeof source.providerReplayHandoff === 'object'
    ? source.providerReplayHandoff
    : {};
  const providerSyncCheckpoint = source.providerSyncCheckpoint && typeof source.providerSyncCheckpoint === 'object'
    ? source.providerSyncCheckpoint
    : replayBarrier.providerSync && typeof replayBarrier.providerSync === 'object'
      ? replayBarrier.providerSync
      : {};
  const providerServiceContract = source.providerServiceContract && typeof source.providerServiceContract === 'object'
    ? source.providerServiceContract
    : providerSyncCheckpoint.providerServiceContract && typeof providerSyncCheckpoint.providerServiceContract === 'object'
      ? providerSyncCheckpoint.providerServiceContract
      : replayBarrier.providerContract && typeof replayBarrier.providerContract === 'object'
        ? replayBarrier.providerContract
        : {};
  const boundaryScope = source.boundaryScope && typeof source.boundaryScope === 'object'
    ? source.boundaryScope
    : replayBarrier.boundaryScope && typeof replayBarrier.boundaryScope === 'object'
      ? replayBarrier.boundaryScope
      : {};
  const lifecycle = source.lifecycle && typeof source.lifecycle === 'object' ? source.lifecycle : {};
  const acceptance = uiHandoff.acceptance && typeof uiHandoff.acceptance === 'object'
    ? uiHandoff.acceptance
    : replayBarrier.acceptance && typeof replayBarrier.acceptance === 'object'
      ? replayBarrier.acceptance
      : {};
  const runtimeAcceptance = runtime.acceptance && typeof runtime.acceptance === 'object'
    ? runtime.acceptance
    : runtime.operatorAcceptance && typeof runtime.operatorAcceptance === 'object'
      ? runtime.operatorAcceptance
      : {};
  const lifecycleControl = runtime.compileCacheLifecycle && typeof runtime.compileCacheLifecycle === 'object'
    ? runtime.compileCacheLifecycle
    : {};
  const providerRestartSafe = providerSyncCheckpoint.restartSafe === true;
  const providerCapabilitySatisfied = providerSyncCheckpoint.capabilitySatisfied !== false
    && providerServiceContract.negotiation?.satisfied !== false;
  const providerSyncReady = providerRestartSafe && providerCapabilitySatisfied;
  const providerReplayReady = providerReplayHandoff.ready !== false
    && providerReplayHandoff.restartSafe !== false
    && stableList(providerReplayHandoff.blockedReasons).length === 0;
  const boundaryAllowed = boundaryScope.allowed !== false;
  const replayOpen = replayBarrier.open === true;
  const replayRestartSafe = replayBarrier.restartSafe === true;
  const persistedReplayRestartSafe = persistedReplayState.restartSafe === true;
  const persistedSnapshotRestartSafe = persistedSnapshotState.restartSafe !== false;
  const exportReady = exportPackage.exportReady === true || source.exportSummary?.exportReady === true;
  const lifecycleReady = lifecycle.blocked !== true
    && lifecycle.refreshRecommended !== true
    && lifecycleControl.operatorHold !== true
    && lifecycle.controls?.operatorHold !== true;
  const healthReady = operationalHealth.failed !== true
    && operationalHealth.state !== 'failed'
    && operationalHealth.retry?.exhausted !== true;
  const acceptedBy = compactString(runtimeAcceptance.acceptedBy || acceptance.acceptedBy);
  const acceptedAt = compactString(runtimeAcceptance.acceptedAt || acceptance.acceptedAt);
  const acceptanceRequired = acceptance.required === true
    || replayBarrier.acceptance?.required === true
    || runtimeAcceptance.required === true
    || runtime.operatorApprovalRequired === true
    || lifecycle.controls?.operatorHold === true
    || lifecycleControl.operatorHold === true;
  const acceptanceSatisfied = !acceptanceRequired
    || runtimeAcceptance.accepted === true
    || acceptance.accepted === true
    || Boolean(acceptedBy && acceptedAt);
  const retryAttempts = positiveInteger(
    runtime.compileCacheReplay?.attempts
      ?? runtime.replayControls?.attempts
      ?? operationalHealth.retry?.attempts
      ?? replayBarrier.retry?.attempts,
    0,
  );
  const retryMaxAttempts = Math.max(1, positiveInteger(
    runtime.compileCacheReplay?.maxAttempts
      ?? runtime.replayControls?.maxAttempts
      ?? operationalHealth.retry?.maxAttempts
      ?? replayBarrier.retry?.maxAttempts,
    1,
  ));
  const retryAfterMs = positiveInteger(
    runtime.compileCacheReplay?.retryAfterMs
      ?? runtime.replayControls?.retryAfterMs
      ?? operationalHealth.retry?.retryAfterMs
      ?? replayBarrier.retry?.retryAfterMs,
    0,
  );
  const retryExhausted = retryAttempts >= retryMaxAttempts || replayBarrier.retry?.exhausted === true;
  const restartResumeContract = buildMailchimpCompileCacheRestartResumeContract({
    ...source,
    uiHandoff,
    replayBarrier,
    persistedReplayState,
    persistedSnapshotState,
    operationalHealth,
    exportPackage,
    clientWorkflowHandoff,
    providerReplayHandoff,
    providerSyncCheckpoint,
    providerServiceContract,
    boundaryScope,
    acceptance: {
      required: acceptanceRequired,
      accepted: acceptanceSatisfied,
      acceptedBy,
      acceptedAt,
      reason: compactString(acceptance.reason || runtimeAcceptance.reason),
    },
  }, runtime);
  const blockedReasons = stableList([
    ...(source.stale ? ['stale_entry'] : []),
    ...(providerRestartSafe ? [] : ['provider_sync_not_restart_safe']),
    ...(providerCapabilitySatisfied ? [] : ['provider_capability_missing']),
    ...(providerReplayReady ? [] : ['provider_replay_handoff_not_ready']),
    ...(boundaryAllowed ? [] : ['tenant_boundary_denied']),
    ...(replayOpen ? [] : ['replay_barrier_closed']),
    ...(replayRestartSafe ? [] : ['replay_barrier_not_restart_safe']),
    ...(persistedReplayRestartSafe ? [] : ['persisted_replay_not_restart_safe']),
    ...(persistedSnapshotRestartSafe ? [] : ['persisted_snapshot_not_restart_safe']),
    ...(exportReady ? [] : ['export_package_not_ready']),
    ...(lifecycleReady ? [] : ['lifecycle_controls_blocked']),
    ...(healthReady ? [] : ['operational_health_not_ready']),
    ...(acceptanceSatisfied ? [] : ['operator_acceptance_missing']),
    ...(retryExhausted ? ['retry_budget_exhausted'] : []),
    ...(Array.isArray(providerSyncCheckpoint.blockedReasons) ? providerSyncCheckpoint.blockedReasons : []),
    ...(Array.isArray(providerServiceContract.negotiation?.blockedReasons) ? providerServiceContract.negotiation.blockedReasons : []),
    ...(Array.isArray(providerReplayHandoff.blockedReasons) ? providerReplayHandoff.blockedReasons : []),
    ...(Array.isArray(boundaryScope.blockedReasons) ? boundaryScope.blockedReasons : []),
    ...(Array.isArray(replayBarrier.blockedReasons) ? replayBarrier.blockedReasons : []),
    ...(Array.isArray(persistedReplayState.blockedReasons) ? persistedReplayState.blockedReasons : []),
    ...(Array.isArray(exportPackage.blockedReasons) ? exportPackage.blockedReasons : []),
    ...(Array.isArray(clientWorkflowHandoff.blockedReasons) ? clientWorkflowHandoff.blockedReasons : []),
    ...restartResumeContract.blockedReasons,
  ]);
  const ready = blockedReasons.length === 0
    && providerSyncReady
    && providerReplayReady
    && replayOpen
    && replayRestartSafe
    && persistedReplayRestartSafe
    && persistedSnapshotRestartSafe
    && restartResumeContract.restartSafe === true
    && acceptanceSatisfied;
  const failureState = retryExhausted
    ? 'retry_budget_exhausted'
    : blockedReasons[0] || 'none';
  const nextAction = ready
    ? source.replayed ? 'verify_cached_descriptor' : 'resume_from_compile_cache'
    : acceptanceRequired && !acceptanceSatisfied
      ? 'request_compile_cache_acceptance'
      : retryExhausted
        ? 'hold_for_operator'
        : !boundaryAllowed
          ? 'repair_tenant_permissions'
          : !providerSyncReady
            ? providerSyncCheckpoint.replayPolicy || providerServiceContract.negotiation?.nextAction || 'refresh_provider_sync_before_replay'
            : !providerReplayReady
              ? providerReplayHandoff.nextAction || 'refresh_provider_sync_before_replay'
            : !replayOpen
              ? replayBarrier.recoveryCommand || replayBarrier.nextAction || 'open_compile_cache_replay_barrier'
              : !persistedReplayRestartSafe
                ? persistedReplayState.recovery?.command || persistedReplayState.nextAction || 'rebuild_persisted_replay_state'
                : !exportReady
                  ? exportPackage.nextAction || 'review_compile_cache_export'
                  : !lifecycleReady
                    ? lifecycle.nextAction || 'repair_compile_cache_lifecycle_settings'
                    : restartResumeContract.restartSafe !== true
                      ? restartResumeContract.recoveryCommand || restartResumeContract.nextAction
                    : operationalHealth.nextAction || clientWorkflowHandoff.primaryAction || 'inspect_compile_cache_resume_gate';
  const routeState = ready
    ? 'ready'
    : acceptanceRequired && !acceptanceSatisfied
      ? 'acceptance_required'
      : retryExhausted || operationalHealth.failed === true
        ? 'blocked'
        : 'needs_attention';

  return {
    protocol: 'aios.compile-cache-resume-gate.mailchimp.v1',
    namespace: compactString(source.namespace || 'mailchimp'),
    cacheKey: compactString(source.cacheKey),
    requestKey: compactString(source.requestKey),
    status: compactString(source.status || 'unknown'),
    ready,
    replaySafe: ready && replayBarrier.canReplayCachedDescriptor !== false,
    restartSafe: ready || (acceptanceRequired && !acceptanceSatisfied && retryExhausted === false),
    routeState,
    nextAction,
    recoveryCommand: ready ? 'observe' : nextAction,
    failureState,
    blockedReasons,
    acceptance: {
      required: acceptanceRequired,
      accepted: acceptanceSatisfied,
      acceptedBy,
      acceptedAt,
      reason: compactString(acceptance.reason || runtimeAcceptance.reason || (acceptanceRequired ? failureState : '')),
      canAccept: acceptanceRequired && !acceptanceSatisfied && !retryExhausted,
    },
    provider: {
      state: compactString(providerSyncCheckpoint.state || 'unknown'),
      restartSafe: providerRestartSafe,
      capabilitySatisfied: providerCapabilitySatisfied,
      replayPolicy: compactString(providerSyncCheckpoint.replayPolicy || 'refresh_provider_sync_before_replay'),
      externalHandoffState: compactString(providerSyncCheckpoint.externalHandoffState || 'local_only'),
      externalRequestId: compactString(providerSyncCheckpoint.externalRequestId),
      cursorRequired: providerSyncCheckpoint.cursorRequired === true,
      cursorPresent: Boolean(providerSyncCheckpoint.cursor || providerSyncCheckpoint.cursorPresent),
      missingCapabilities: stableList(providerServiceContract.missingCapabilities || providerServiceContract.negotiation?.missing),
      replayHandoffState: compactString(providerReplayHandoff.state || 'unknown'),
      replayHandoffReady: providerReplayReady,
      externalWriteSuppressed: providerReplayHandoff.externalHandoff?.externalWriteSuppressed === true,
    },
    replay: {
      barrierOpen: replayOpen,
      barrierRestartSafe: replayRestartSafe,
      persistedReplayRestartSafe,
      persistedSnapshotRestartSafe,
      restartResumeSafe: restartResumeContract.restartSafe === true,
      canReplayCachedDescriptor: replayBarrier.canReplayCachedDescriptor === true,
      replayKey: compactString(persistedReplayState.replayKey || persistedReplayState.command?.replayKey),
      idempotencyKey: stableList([
        source.namespace || 'mailchimp',
        source.cacheKey,
        source.requestKey,
        source.contractHash,
        nextAction,
        blockedReasons.join('|'),
      ]).join(':'),
    },
    retry: {
      attempts: retryAttempts,
      maxAttempts: retryMaxAttempts,
      retryAfterMs,
      exhausted: retryExhausted,
      mode: retryAfterMs > 0 ? 'backoff' : 'immediate',
    },
    restartResumeContract,
    preview: {
      title: `Mailchimp compile-cache resume for ${source.cacheKey || source.requestKey || 'uncached descriptor'}`,
      visibleStatus: ready ? 'resume_ready' : routeState,
      primaryAction: nextAction,
      ttlRemainingMs: source.ttlRemainingMs ?? null,
      exportReady,
      lifecycleReady,
      operationalHealthState: compactString(operationalHealth.state || (healthReady ? 'healthy' : 'degraded')),
      clientWorkflowState: compactString(clientWorkflowHandoff.workflowState || clientWorkflowHandoff.statusRouteState),
      boundaryState: boundaryAllowed ? 'allowed' : 'blocked',
      restartResumeState: restartResumeContract.state,
    },
  };
}

function touchEntry(entry, now) {
  return {
    ...entry,
    hits: entry.hits + 1,
    lastAccessedAt: now,
    stale: isExpired(entry, now),
  };
}

function pruneEntries(entries, maxEntries, now) {
  const live = entries
    .filter((entry) => !isExpired(entry, now))
    .sort((left, right) => {
      if (left.lastAccessedAt !== right.lastAccessedAt) return right.lastAccessedAt - left.lastAccessedAt;
      return right.updatedAt - left.updatedAt;
    });
  return live.slice(0, maxEntries);
}

function normalizeInitialEntries(entries = [], now = Date.now()) {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((entry) => entry?.protocol === 'aios.compile-cache-entry.mailchimp.v1' && entry.key)
    .map((entry) => ({
      ...entry,
      createdAt: positiveInteger(entry.createdAt, now),
      updatedAt: positiveInteger(entry.updatedAt, now),
      lastAccessedAt: positiveInteger(entry.lastAccessedAt, now),
      hits: positiveInteger(entry.hits, 0),
      stale: entry.stale === true || isExpired(entry, now),
      boundaryScope: entry.boundaryScope || normalizeBoundaryScope(entry.descriptor),
      providerServiceContract: entry.providerServiceContract
        || entry.providerSyncCheckpoint?.providerServiceContract
        || buildMailchimpCompileCacheProviderServiceContract(entry.descriptor),
      descriptor: cloneContract(entry.descriptor),
    }));
}

export function createMailchimpCompileCache(initialEntries = [], options = {}) {
  const cacheOptions = normalizeCacheOptions(options);
  const now = nowFrom(options);
  const entries = new Map();
  const events = [];
  const record = (event) => {
    events.push(normalizeCacheEvent({
      at: event.at ?? nowFrom({ now }),
      namespace: cacheOptions.namespace,
      ...event,
    }, events.length));
  };
  for (const entry of pruneEntries(normalizeInitialEntries(initialEntries, now), cacheOptions.maxEntries, now)) {
    entries.set(entry.key, entry);
  }
  record({
    at: now,
    kind: 'initialize',
    status: entries.size > 0 ? 'restored' : 'empty',
    reason: entries.size > 0 ? 'initial_entries' : 'cold_start',
  });

  return {
    protocol: 'aios.compile-cache.mailchimp.v1',
    options: cacheOptions,
    get size() {
      return entries.size;
    },
    has(key, readOptions = {}) {
      const current = nowFrom(readOptions);
      const entry = entries.get(compactString(key));
      return Boolean(entry && !isExpired(entry, current));
    },
    get(key, readOptions = {}) {
      const current = nowFrom(readOptions);
      const normalizedKey = compactString(key);
      const entry = entries.get(normalizedKey);
      if (!entry) {
        record({ at: current, kind: 'lookup', status: 'miss', key: normalizedKey, reason: 'missing' });
        return null;
      }
      if (isExpired(entry, current)) {
        entries.delete(normalizedKey);
        record({
          at: current,
          kind: 'lookup',
          status: 'miss',
          key: normalizedKey,
          reason: 'expired',
          requestKey: entry.identity.requestKey,
          sourceHash: entry.identity.sourceHash,
          contractHash: entry.identity.contractHash,
        });
        return null;
      }
      const boundaryDecision = boundaryMatches(
        entry.boundaryScope || normalizeBoundaryScope(entry.descriptor),
        readOptions.boundary || readOptions.tenantBoundary || {},
      );
      if (!boundaryDecision.ok) {
        record({
          at: current,
          kind: 'lookup',
          status: 'miss',
          key: normalizedKey,
          reason: `boundary:${boundaryDecision.blockedReasons[0]}`,
          requestKey: entry.identity.requestKey,
          sourceHash: entry.identity.sourceHash,
          contractHash: entry.identity.contractHash,
        });
        return null;
      }
      const touched = touchEntry(entry, current);
      entries.set(normalizedKey, touched);
      record({
        at: current,
        kind: 'lookup',
        status: 'hit',
        key: normalizedKey,
        requestKey: touched.identity.requestKey,
        sourceHash: touched.identity.sourceHash,
        contractHash: touched.identity.contractHash,
      });
      return {
        descriptor: cloneContract(touched.descriptor),
        entry: summarizeEntry(touched, current),
      };
    },
    set(identity, descriptor, writeOptions = {}) {
      const current = nowFrom(writeOptions);
      const mergedOptions = normalizeCacheOptions({ ...cacheOptions, ...writeOptions });
      const entry = makeEntry(identity, descriptor, mergedOptions, current);
      entries.set(entry.key, entry);
      const prunedEntries = pruneEntries([...entries.values()], mergedOptions.maxEntries, current);
      for (const stale of prunedEntries) {
        entries.set(stale.key, stale);
      }
      for (const key of entries.keys()) {
        if (!prunedEntries.some((entryItem) => entryItem.key === key)) {
          entries.delete(key);
          record({ at: current, kind: 'evict', status: 'removed', key, reason: 'limit_or_expiry' });
        }
      }
      record({
        at: current,
        kind: 'store',
        status: 'stored',
        key: entry.key,
        requestKey: entry.identity.requestKey,
        sourceHash: entry.identity.sourceHash,
        contractHash: entry.identity.contractHash,
      });
      return summarizeEntry(entry, current);
    },
    invalidate(key, invalidateOptions = {}) {
      const current = nowFrom(invalidateOptions);
      const normalizedKey = compactString(key);
      const removed = entries.delete(normalizedKey);
      record({
        at: current,
        kind: 'invalidate',
        status: removed ? 'removed' : 'missing',
        key: normalizedKey,
        reason: removed ? 'manual' : 'not_found',
      });
      return removed;
    },
    snapshot(snapshotOptions = {}) {
      const current = nowFrom(snapshotOptions);
      const summaries = [...entries.values()].map((entry) => summarizeEntry(entry, current));
      const analytics = buildCacheAnalytics([...entries.values()], events, current);
      const sortedEntries = summaries.sort((left, right) => left.key.localeCompare(right.key));
      const history = buildMailchimpCompileCacheHistoryReport({
        namespace: cacheOptions.namespace,
        entries: sortedEntries,
        analytics,
        events,
      }, { now: current });
      const baseSnapshot = {
        protocol: 'aios.compile-cache-snapshot.mailchimp.v1',
        namespace: cacheOptions.namespace,
        size: entries.size,
        limit: cacheOptions.maxEntries,
        ttlMs: cacheOptions.ttlMs,
        entries: sortedEntries,
        analytics,
        history,
      };
      const exportSummary = buildMailchimpCompileCacheExportSummary(baseSnapshot);
      const lifecycle = buildMailchimpCompileCacheLifecycleDecision({
        ...baseSnapshot,
        exportSummary,
      }, snapshotOptions);
      const persistedSnapshotState = buildMailchimpCompileCachePersistedSnapshotState({
        ...baseSnapshot,
        exportSummary,
        lifecycle,
      }, {
        ...snapshotOptions,
        now: current,
        ttlMs: cacheOptions.ttlMs,
        maxEntries: cacheOptions.maxEntries,
      });
      return {
        ...baseSnapshot,
        exportSummary,
        exportPackage: buildMailchimpCompileCacheExportPackage({
          ...baseSnapshot,
          exportSummary,
          lifecycle,
          persistedSnapshotState,
        }, snapshotOptions),
        lifecycle,
        persistedSnapshotState,
      };
    },
    exportSummary(summaryOptions = {}) {
      return buildMailchimpCompileCacheExportSummary(this.snapshot(summaryOptions));
    },
    exportPackage(packageOptions = {}) {
      return buildMailchimpCompileCacheExportPackage(this.snapshot(packageOptions), packageOptions);
    },
    lifecycleDecision(lifecycleOptions = {}) {
      return buildMailchimpCompileCacheLifecycleDecision(this.snapshot(lifecycleOptions), lifecycleOptions);
    },
  };
}

export function compileMailchimpWithCompileCache(input = {}, options = {}) {
  const cache = options.cache?.protocol === 'aios.compile-cache.mailchimp.v1'
    ? options.cache
    : createMailchimpCompileCache(options.initialEntries || [], options.cacheOptions || options);
  const now = nowFrom(options);
  const compileOptions = {
    allowedActions: options.allowedActions,
  };
  const identity = buildMailchimpHandoffIdentity(input, compileOptions);
  const cached = cache.get(identity.cacheKey, { now, boundary: options.boundary || options.tenantBoundary });

  if (cached) {
    const cacheSnapshot = cache.snapshot({ now });
    const providerSyncCheckpoint = buildMailchimpCompileCacheProviderSyncCheckpoint(cached.descriptor, options.runtime || options);
    const providerServiceContract = providerSyncCheckpoint.providerServiceContract
      || buildMailchimpCompileCacheProviderServiceContract(cached.descriptor, options.runtime || options);
    const uiHandoff = buildMailchimpCompileCacheUiHandoff({
      ...cacheSnapshot,
      compileCache: {
        ...cached.entry,
        status: 'hit',
        replayed: true,
        analytics: cacheSnapshot.analytics,
        exportSummary: cacheSnapshot.exportSummary,
        history: cacheSnapshot.history,
        providerSyncCheckpoint,
        providerServiceContract,
        boundaryScope: cached.entry.boundaryScope,
      },
    }, options.runtime || options);
    const exportPackage = buildMailchimpCompileCacheExportPackage({
      ...cacheSnapshot,
      compileCache: {
        ...cached.entry,
        status: 'hit',
        replayed: true,
        analytics: cacheSnapshot.analytics,
        exportSummary: cacheSnapshot.exportSummary,
        history: cacheSnapshot.history,
        uiHandoff,
        providerServiceContract,
      },
    }, options.runtime || options);
    const statusHandoff = buildMailchimpCompileCacheStatusHandoff({
      ...cacheSnapshot,
      compileCache: {
        ...cached.entry,
        status: 'hit',
        replayed: true,
        analytics: cacheSnapshot.analytics,
        exportSummary: cacheSnapshot.exportSummary,
        history: cacheSnapshot.history,
        lifecycle: cacheSnapshot.lifecycle,
        providerSyncCheckpoint,
        providerServiceContract,
        boundaryScope: cached.entry.boundaryScope,
        uiHandoff,
        exportPackage,
      },
    }, options.runtime || options);
    const clientWorkflowHandoff = statusHandoff.clientWorkflowHandoff;
    const clientExportCard = statusHandoff.clientExportCard;
    const clientResumePacket = statusHandoff.clientResumePacket;
    return {
      protocol: 'aios.compile-result.mailchimp.v1',
      cache,
      cacheStatus: 'hit',
    descriptor: {
      ...cached.descriptor,
      compileCache: {
        ...cached.entry,
        status: 'hit',
        replayed: true,
        analytics: cacheSnapshot.analytics,
        exportSummary: cacheSnapshot.exportSummary,
        history: cacheSnapshot.history,
        exportPackage,
        providerSyncCheckpoint,
        providerServiceContract,
        boundaryScope: cached.entry.boundaryScope,
        uiHandoff,
        replayBarrier: statusHandoff.replayBarrier,
        persistedReplayState: statusHandoff.persistedReplayState,
        operationalHealth: statusHandoff.operationalHealth,
        clientWorkflowHandoff,
        clientExportCard,
        clientResumePacket,
        resumeEvidenceHandoff: statusHandoff.resumeEvidenceHandoff,
        statusHandoff,
      },
    },
      identity,
      diagnostics: cached.descriptor.diagnostics || [],
    };
  }

  const descriptor = compileMailchimpAdapterHandoff(input, compileOptions);
  const providerSyncCheckpoint = buildMailchimpCompileCacheProviderSyncCheckpoint(descriptor, options.runtime || options);
  const providerServiceContract = providerSyncCheckpoint.providerServiceContract
    || buildMailchimpCompileCacheProviderServiceContract(descriptor, options.runtime || options);
  const boundaryScope = normalizeBoundaryScope(descriptor);
  const entry = cache.set(identity, {
    ...descriptor,
    compileCache: {
      key: identity.cacheKey,
      status: 'stored',
      replayed: false,
      sourceHash: identity.sourceHash,
      optionsHash: identity.optionsHash,
      contractHash: identity.contractHash,
      providerSyncCheckpoint,
      providerServiceContract,
      boundaryScope,
    },
  }, { now });
  const cacheSnapshot = cache.snapshot({ now });
  const uiHandoff = buildMailchimpCompileCacheUiHandoff({
    ...cacheSnapshot,
    compileCache: {
      ...entry,
      status: 'miss',
      replayed: false,
      analytics: cacheSnapshot.analytics,
      exportSummary: cacheSnapshot.exportSummary,
      history: cacheSnapshot.history,
      providerSyncCheckpoint,
      providerServiceContract,
      boundaryScope: entry.boundaryScope,
    },
  }, options.runtime || options);
  const exportPackage = buildMailchimpCompileCacheExportPackage({
    ...cacheSnapshot,
    compileCache: {
      ...entry,
      status: 'miss',
      replayed: false,
      analytics: cacheSnapshot.analytics,
      exportSummary: cacheSnapshot.exportSummary,
      history: cacheSnapshot.history,
      uiHandoff,
      providerServiceContract,
    },
  }, options.runtime || options);
  const statusHandoff = buildMailchimpCompileCacheStatusHandoff({
    ...cacheSnapshot,
    compileCache: {
      ...entry,
      status: 'miss',
      replayed: false,
      analytics: cacheSnapshot.analytics,
      exportSummary: cacheSnapshot.exportSummary,
      history: cacheSnapshot.history,
      lifecycle: cacheSnapshot.lifecycle,
      providerSyncCheckpoint,
      providerServiceContract,
      boundaryScope: entry.boundaryScope,
      uiHandoff,
      exportPackage,
    },
  }, options.runtime || options);
  const clientWorkflowHandoff = statusHandoff.clientWorkflowHandoff;
  const clientExportCard = statusHandoff.clientExportCard;
  const clientResumePacket = statusHandoff.clientResumePacket;

  return {
    protocol: 'aios.compile-result.mailchimp.v1',
    cache,
    cacheStatus: 'miss',
    descriptor: {
      ...descriptor,
      compileCache: {
        ...entry,
        status: 'miss',
        replayed: false,
        analytics: cacheSnapshot.analytics,
        exportSummary: cacheSnapshot.exportSummary,
        history: cacheSnapshot.history,
        exportPackage,
        providerSyncCheckpoint,
        providerServiceContract,
        boundaryScope: entry.boundaryScope,
        uiHandoff,
        replayBarrier: statusHandoff.replayBarrier,
        persistedReplayState: statusHandoff.persistedReplayState,
        operationalHealth: statusHandoff.operationalHealth,
        clientWorkflowHandoff,
        clientExportCard,
        clientResumePacket,
        resumeEvidenceHandoff: statusHandoff.resumeEvidenceHandoff,
        statusHandoff,
      },
    },
    identity,
    diagnostics: descriptor.diagnostics || [],
  };
}

export function assertMailchimpCompileCacheSelfCheck(options = {}) {
  const source = [
    'adapter: mailchimp',
    'action: campaign.draft',
    'tenant: demo',
    'truth: verified',
    'idempotencyKey: demo-draft-1',
    'verifier: preview',
  ].join('\n');
  const cache = createMailchimpCompileCache([], { now: 1, ttlMs: 1000, ...options });
  const first = compileMailchimpWithCompileCache(source, { cache, now: 1 });
  const second = compileMailchimpWithCompileCache(source, { cache, now: 2 });
  const exportSummary = cache.exportSummary({ now: 2 });
  const exportPackage = cache.exportPackage({ now: 2 });
  const lifecycle = cache.lifecycleDecision({ now: 2, command: 'export' });
  const statusHandoff = second.descriptor.compileCache.statusHandoff;
  const clientWorkflowHandoff = second.descriptor.compileCache.clientWorkflowHandoff;
  const clientExportCard = second.descriptor.compileCache.clientExportCard;
  const replayCommandBundle = statusHandoff.replayCommandBundle;
  const history = second.descriptor.compileCache.history;
  const ok = first.cacheStatus === 'miss'
    && second.cacheStatus === 'hit'
    && first.identity.cacheKey === second.identity.cacheKey
    && second.descriptor.compileCache.replayed === true
    && statusHandoff.protocol === 'aios.compile-cache-status-handoff.mailchimp.v1'
    && statusHandoff.ready === true
    && statusHandoff.statusRouteState === 'ready'
    && statusHandoff.nextAction === 'verify_cached_descriptor'
    && clientWorkflowHandoff.protocol === 'aios.compile-cache-client-workflow-handoff.mailchimp.v1'
    && clientWorkflowHandoff.ready === true
    && clientWorkflowHandoff.primaryAction === 'verify_cached_descriptor'
    && clientExportCard.protocol === 'aios.compile-cache-client-export-card.mailchimp.v1'
    && clientExportCard.ready === true
    && clientExportCard.primaryAction === 'verify_cached_descriptor'
    && clientExportCard.restartSemantics.externalWritesPerformed === false
    && replayCommandBundle.protocol === 'aios.compile-cache-replay-command-bundle.mailchimp.v1'
    && replayCommandBundle.ready === true
    && replayCommandBundle.restartSemantics.externalWritesPerformed === false
    && replayCommandBundle.counters.commands >= 1
    && statusHandoff.clientWorkflowHandoff.requestState.idempotencyKey === clientWorkflowHandoff.requestState.idempotencyKey
    && statusHandoff.operationalHealth.healthy === true
    && statusHandoff.persistedReplayState.restartSafe === true
    && second.descriptor.compileCache.analytics.counters.hitEvents === 1
    && second.descriptor.compileCache.analytics.counters.missEvents === 1
    && history.protocol === 'aios.compile-cache-history.mailchimp.v1'
    && history.reportingState.state === 'export_ready'
    && history.timeline.snapshotCount >= 3
    && statusHandoff.reporting.state === 'export_ready'
    && exportSummary.exportReady === true
    && exportSummary.reportingState.state === 'export_ready'
    && exportPackage.exportReady === true
    && exportPackage.reporting.state === 'export_ready'
    && exportPackage.counters.hitEvents === 1
    && lifecycle.nextAction === 'export_compile_cache_summary'
    && lifecycle.controlContract.protocol === 'aios.compile-cache-lifecycle-control.mailchimp.v1'
    && lifecycle.controlContract.state.next === 'mutating'
    && lifecycle.controlContract.state.mutatesCache === true
    && lifecycle.controlContract.mutations.cacheMutation[0]?.operation === 'export_summary';
  return {
    protocol: 'aios.compile-cache-self-check.mailchimp.v1',
    ok,
    firstStatus: first.cacheStatus,
    secondStatus: second.cacheStatus,
    cacheKey: first.identity.cacheKey,
    size: cache.size,
    exportReady: exportSummary.exportReady,
    history,
    exportPackage,
    lifecycle,
    replayCommandBundle,
    clientWorkflowHandoff,
    clientExportCard,
    statusHandoff,
    counters: exportSummary.counters,
    diagnostics: ok ? [] : [{
      code: 'mailchimp.compile_cache.self_check_failed',
      severity: 'error',
      message: 'Mailchimp compile cache did not produce deterministic miss-then-hit analytics/export/status handoff behavior.',
    }],
  };
}

export { DEFAULT_CACHE_LIMIT, DEFAULT_TTL_MS };
