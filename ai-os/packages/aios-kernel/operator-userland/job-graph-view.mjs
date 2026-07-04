export const surfaceId = "aios_operator-userland_job-graph-view_088";
export const surfaceGroup = "operator-userland";
export const surfaceName = "job-graph-view";

const TERMINAL_STATUSES = new Set(['complete', 'completed', 'failed', 'cancelled', 'canceled']);
const ACTIVE_STATUSES = new Set(['running', 'active', 'in_progress', 'queued', 'pending', 'blocked']);
const FAILURE_STATUSES = new Set(['failed', 'error', 'timeout']);
const REQUIRED_PROVIDER_CAPABILITIES = [
  'job_graph.snapshot.read',
  'job_graph.accept.submit',
  'job_graph.proof.export',
  'job_graph.lifecycle.dispatch'
];
const MAILCHIMP_PROVIDER_KINDS = new Set([
  'mailchimp',
  'mailchimp_marketing',
  'mailchimp_transactional'
]);
const MAILCHIMP_REQUIRED_CAPABILITIES = [
  'mailchimp.audience.sync',
  'mailchimp.campaign.handoff',
  'mailchimp.merge_fields.write',
  'mailchimp.webhook.ack'
];
const MAILCHIMP_HANDOFF_STATES = new Set([
  'missing',
  'draft',
  'queued',
  'syncing',
  'ready',
  'accepted',
  'failed',
  'paused'
]);
const MAILCHIMP_SYNC_ENTITY_KEYS = [
  'audience',
  'campaign',
  'template',
  'merge_field',
  'segment',
  'webhook'
];
const LIFECYCLE_CONTROL_KINDS = new Set([
  'focus_job',
  'disable_job',
  'enable_job',
  'schedule_retry',
  'cancel_job'
]);
const LIFECYCLE_SCHEDULE_MODES = new Set([
  'bounded_backoff',
  'operator_window',
  'immediate',
  'paused'
]);
const COMMAND_APPLIED_STATUSES = new Set([
  'applied',
  'complete',
  'completed',
  'succeeded',
  'acknowledged',
  'already_applied'
]);
const COMMAND_IN_FLIGHT_STATUSES = new Set([
  'pending',
  'queued',
  'dispatching',
  'in_flight',
  'sent',
  'unknown'
]);
const COMMAND_FAILED_STATUSES = new Set([
  'failed',
  'error',
  'timeout',
  'rejected'
]);
const DEFAULT_COMMAND_RECOVERY_TTL_MS = 300000;
const ROLE_RANK = new Map([
  ['viewer', 1],
  ['operator', 2],
  ['maintainer', 3],
  ['admin', 4],
  ['owner', 5]
]);
const SCOPE_WRITE_PERMISSIONS = new Set([
  'job_graph:accept',
  'job_graph:lifecycle:write',
  'kernel:workspace:write'
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function normalizeStringList(value) {
  const values = Array.isArray(value) ? value : [value];
  return values
    .map((entry) => firstString(entry))
    .filter(Boolean);
}

function normalizeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : fallback;
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'enabled', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'disabled', 'off'].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeTimestamp(...values) {
  for (const value of values) {
    const text = firstString(value);
    const timestamp = Date.parse(text);
    if (Number.isFinite(timestamp)) {
      return new Date(timestamp).toISOString();
    }
  }
  return null;
}

function normalizeDurationMs(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
}

function ratio(numerator, denominator) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : 0;
}

function incrementCounter(counters, key, amount = 1) {
  const counterKey = firstString(key, 'unknown');
  counters[counterKey] = (counters[counterKey] || 0) + amount;
  return counters;
}

function roleRank(role) {
  return ROLE_RANK.get(firstString(role, 'viewer').toLowerCase()) || 0;
}

function normalizeWorkspaceGrant(raw, index) {
  const roles = normalizeStringList(raw?.roles || raw?.scopedRoles || raw?.workspaceRoles);
  const role = firstString(raw?.role, raw?.workspaceRole, roles[0], 'viewer').toLowerCase();
  const permissions = normalizeStringList(raw?.permissions || raw?.scopedPermissions || raw?.workspacePermissions)
    .map((permission) => permission.toLowerCase());
  const maxRoleRank = Math.max(roleRank(role), ...roles.map(roleRank), 0);
  const explicitWrite = normalizeBoolean(raw?.canWrite ?? raw?.write ?? raw?.allowWrite, false);
  const canWrite =
    explicitWrite ||
    permissions.includes('job_graph:accept') ||
    permissions.includes('job_graph:lifecycle:write') ||
    permissions.includes('kernel:workspace:write') ||
    maxRoleRank >= roleRank('operator');

  return {
    grantId: firstString(raw?.grantId, raw?.id, `workspace-grant-${index + 1}`),
    tenantId: firstString(raw?.tenantId, raw?.tenant, raw?.scope?.tenantId),
    workspaceId: firstString(raw?.workspaceId, raw?.workspace, raw?.scope?.workspaceId),
    roles: Array.from(new Set([role, ...roles.map((entry) => entry.toLowerCase())])).filter(Boolean),
    permissions: Array.from(new Set(permissions)).sort(),
    canWrite,
    maxRoleRank
  };
}

function collectWorkspaceGrantInputs(input, principal, request) {
  const runtime = input.clientRuntime || {};
  return [
    ...asArray(principal.workspaceGrants || principal.grants || principal.scopedGrants),
    ...asArray(input.workspaceGrants || input.scopedGrants || input.accessGrants),
    ...asArray(request.workspaceGrants || request.scopedGrants || request.accessGrants),
    ...asArray(runtime.workspaceGrants || runtime.scopedGrants || runtime.accessGrants)
  ];
}

function normalizeWorkspaceGrants(input, principal, request) {
  return collectWorkspaceGrantInputs(input, principal, request)
    .map(normalizeWorkspaceGrant)
    .filter((grant) => grant.workspaceId || grant.tenantId)
    .sort((left, right) =>
      firstString(left.tenantId).localeCompare(firstString(right.tenantId)) ||
      firstString(left.workspaceId).localeCompare(firstString(right.workspaceId)) ||
      left.grantId.localeCompare(right.grantId)
    );
}

function grantMatchesScope(grant, tenantId, workspaceId, accessContext) {
  const tenantMatches = !tenantId
    ? true
    : grant.tenantId
      ? grant.tenantId === tenantId
      : accessContext.tenantId === tenantId;
  const workspaceMatches = !workspaceId || !grant.workspaceId || grant.workspaceId === workspaceId;
  return tenantMatches && workspaceMatches;
}

function workspaceGrantForScope(accessContext, tenantId, workspaceId, { requireWrite = false } = {}) {
  return accessContext.workspaceGrants.find((grant) =>
    grantMatchesScope(grant, tenantId, workspaceId, accessContext) &&
    (!requireWrite || grant.canWrite)
  ) || null;
}

function normalizeAccessContext(input) {
  const request = input.request || input.clientRequest || {};
  const principal = input.principal || input.operator || input.user || request.principal || {};
  const permissions = new Set(normalizeStringList(principal.permissions || input.permissions || request.permissions));
  const roles = normalizeStringList(principal.roles || input.roles || request.roles);
  const primaryRole = firstString(principal.role, input.role, request.role, roles[0], 'viewer').toLowerCase();
  const maxRoleRank = Math.max(roleRank(primaryRole), ...roles.map(roleRank), 0);
  const workspaceGrants = normalizeWorkspaceGrants(input, principal, request);

  return {
    contract: 'hosted-kernel-job-graph-access-context.v1',
    principalId: firstString(principal.id, principal.userId, principal.operatorId, input.principalId, 'anonymous'),
    tenantId: firstString(input.tenantId, request.tenantId, principal.tenantId),
    workspaceId: firstString(input.workspaceId, request.workspaceId, principal.workspaceId),
    roles: Array.from(new Set([primaryRole, ...roles])).filter(Boolean),
    permissions: Array.from(permissions).sort(),
    workspaceGrants,
    workspaceGrantCount: workspaceGrants.length,
    canCrossTenant: permissions.has('kernel:tenant:read_all') || maxRoleRank >= roleRank('owner'),
    canViewAllWorkspaces: permissions.has('kernel:workspace:read_all') || maxRoleRank >= roleRank('admin'),
    canWriteAllWorkspaces: permissions.has('kernel:workspace:write_all') || maxRoleRank >= roleRank('owner'),
    canBindUnscopedGraph: permissions.has('kernel:scope:bind_unscoped') || maxRoleRank >= roleRank('maintainer'),
    canAcceptGraph: permissions.has('job_graph:accept') || maxRoleRank >= roleRank('operator'),
    writePermissions: Array.from(SCOPE_WRITE_PERMISSIONS).filter((permission) => permissions.has(permission)).sort(),
    maxRoleRank
  };
}

function normalizeStatus(value) {
  const status = firstString(value, 'unknown').toLowerCase().replace(/\s+/g, '_');
  if (status === 'done') return 'complete';
  if (status === 'in-progress') return 'in_progress';
  return status;
}

function normalizeNode(raw, index) {
  const id = firstString(raw?.id, raw?.jobId, raw?.name, `job-${index + 1}`);
  const status = normalizeStatus(raw?.status || raw?.state || raw?.phase);
  const label = firstString(raw?.label, raw?.title, raw?.name, id);
  const owner = firstString(raw?.owner, raw?.agent, raw?.surfaceGroup, surfaceGroup);
  const proofCount = asArray(raw?.proof || raw?.proofs || raw?.evidence).length;
  const blockers = asArray(raw?.blockers).map((blocker) => String(blocker)).filter(Boolean);
  const requiredRole = firstString(raw?.requiredRole, raw?.minimumRole, raw?.access?.requiredRole, 'viewer').toLowerCase();
  const failureSource = raw?.failure || raw?.error || raw?.lastError || {};
  const retrySource = raw?.retry || raw?.retryPolicy || {};
  const retryAttempts = normalizeInteger(raw?.retryAttempts ?? raw?.attempts ?? retrySource.attempts, 0);
  const maxRetryAttempts = normalizeInteger(raw?.maxRetryAttempts ?? retrySource.maxAttempts, 3);
  const failureCode = firstString(failureSource.code, failureSource.errorCode, raw?.failureCode);
  const failureMessage = firstString(failureSource.message, failureSource.reason, raw?.failureMessage);
  const createdAt = normalizeTimestamp(raw?.createdAt, raw?.created, raw?.timestamps?.createdAt);
  const startedAt = normalizeTimestamp(raw?.startedAt, raw?.started, raw?.timestamps?.startedAt);
  const completedAt = normalizeTimestamp(raw?.completedAt, raw?.finishedAt, raw?.completed, raw?.timestamps?.completedAt);
  const updatedAt = normalizeTimestamp(raw?.updatedAt, raw?.lastUpdatedAt, raw?.timestamps?.updatedAt, completedAt, startedAt, createdAt);
  const durationMs = normalizeDurationMs(raw?.durationMs ?? raw?.elapsedMs ?? raw?.timing?.durationMs);
  const lifecycleSource = raw?.lifecycle || raw?.controls || {};
  const lifecycleEnabled = normalizeBoolean(
    lifecycleSource.enabled ?? raw?.lifecycleEnabled ?? raw?.enabled,
    !normalizeBoolean(lifecycleSource.disabled ?? raw?.lifecycleDisabled ?? raw?.disabled, false)
  );

  return {
    id,
    label,
    status,
    owner,
    tenantId: firstString(raw?.tenantId, raw?.tenant, raw?.scope?.tenantId),
    workspaceId: firstString(raw?.workspaceId, raw?.workspace, raw?.scope?.workspaceId),
    requiredRole,
    proofCount,
    blockers,
    failure: {
      code: failureCode || null,
      message: failureMessage || null,
      retryAttempts,
      maxRetryAttempts,
      retryAfter: firstString(raw?.retryAfter, retrySource.retryAfter, failureSource.retryAfter),
      retryable: raw?.retryable !== false && retrySource.retryable !== false
    },
    lifecycle: {
      contract: 'hosted-kernel-job-lifecycle-state.v1',
      enabled: lifecycleEnabled,
      status: lifecycleEnabled ? 'enabled' : 'disabled',
      reason: firstString(lifecycleSource.reason, lifecycleSource.disabledReason, raw?.disabledReason) || null,
      actor: firstString(lifecycleSource.actor, lifecycleSource.updatedBy, raw?.lifecycleActor) || null,
      updatedAt: normalizeTimestamp(lifecycleSource.updatedAt, lifecycleSource.changedAt, raw?.lifecycleUpdatedAt, updatedAt),
      scheduledFor: normalizeTimestamp(lifecycleSource.scheduledFor, raw?.scheduledFor, retrySource.scheduledFor),
      disabledAt: normalizeTimestamp(lifecycleSource.disabledAt, raw?.disabledAt),
      enableRequiresProof: normalizeBoolean(lifecycleSource.enableRequiresProof, true)
    },
    timeline: {
      createdAt,
      startedAt,
      completedAt,
      updatedAt,
      durationMs
    },
    isTerminal: TERMINAL_STATUSES.has(status),
    isActive: ACTIVE_STATUSES.has(status),
    isFailure: FAILURE_STATUSES.has(status) || Boolean(failureCode || failureMessage)
  };
}

function normalizeEdge(raw, index) {
  const from = firstString(raw?.from, raw?.source, raw?.parent);
  const to = firstString(raw?.to, raw?.target, raw?.child);

  return {
    id: firstString(raw?.id, `edge-${index + 1}`),
    from,
    to,
    tenantId: firstString(raw?.tenantId, raw?.tenant, raw?.scope?.tenantId),
    workspaceId: firstString(raw?.workspaceId, raw?.workspace, raw?.scope?.workspaceId),
    relation: firstString(raw?.relation, raw?.type, 'depends_on'),
    endpointState: !from && !to
      ? 'missing_both_endpoints'
      : !from
        ? 'missing_source'
        : !to
          ? 'missing_target'
          : 'complete'
  };
}

function duplicateEntries(items, valueFor, fieldName) {
  const counts = new Map();
  for (const item of items) {
    const value = firstString(valueFor(item));
    if (value) counts.set(value, (counts.get(value) || 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([value, count]) => ({ field: fieldName, value, count }))
    .sort((left, right) => left.value.localeCompare(right.value));
}

function malformedEdgeEvidence(edge) {
  const missingEndpoints = [
    ...(!edge.from ? ['from'] : []),
    ...(!edge.to ? ['to'] : [])
  ];

  return {
    edgeId: edge.id,
    from: edge.from || null,
    to: edge.to || null,
    relation: edge.relation,
    tenantId: edge.tenantId || null,
    workspaceId: edge.workspaceId || null,
    endpointState: edge.endpointState,
    missingEndpoints,
    reason: edge.endpointState
  };
}

function buildGraphIntegrity({ allNodes, allEdges, nodes, edges, deniedEdges, malformedEdges, danglingEdges, topology }) {
  const duplicateNodeIds = duplicateEntries(nodes, (node) => node.id, 'node.id');
  const duplicateInputNodeIds = duplicateEntries(allNodes, (node) => node.id, 'input.node.id');
  const duplicateEdgeIds = duplicateEntries(edges, (edge) => edge.id, 'edge.id');
  const duplicateInputEdgeIds = duplicateEntries(allEdges, (edge) => edge.id, 'input.edge.id');
  const hiddenDependencyCount = deniedEdges.filter((entry) => entry.reason === 'endpoint_out_of_scope').length;
  const droppedDependencyCount = malformedEdges.length + danglingEdges.length + deniedEdges.length;
  const structuralIssueCodes = [
    ...(malformedEdges.length > 0 ? ['malformed_dependency_endpoint'] : []),
    ...(danglingEdges.length > 0 ? ['dangling_dependency'] : []),
    ...(topology.cycles.length > 0 ? ['cyclic_dependency'] : []),
    ...(duplicateNodeIds.length > 0 ? ['duplicate_visible_job_id'] : []),
    ...(duplicateEdgeIds.length > 0 ? ['duplicate_visible_dependency_id'] : [])
  ];
  const executableDependencyCount = topology.proof.scopedEdgeCount;
  const visibleDependencyLossless =
    malformedEdges.length === 0 &&
    danglingEdges.length === 0 &&
    hiddenDependencyCount === 0 &&
    duplicateNodeIds.length === 0 &&
    duplicateEdgeIds.length === 0;

  return {
    contract: 'hosted-kernel-job-graph-integrity.v1',
    status: structuralIssueCodes.length === 0 ? 'lossless' : 'lossy',
    lossless: visibleDependencyLossless && topology.acyclic,
    executableDependencyCount,
    droppedDependencyCount,
    hiddenDependencyCount,
    malformedDependencyCount: malformedEdges.length,
    danglingDependencyCount: danglingEdges.length,
    duplicateVisibleJobIdCount: duplicateNodeIds.length,
    duplicateVisibleDependencyIdCount: duplicateEdgeIds.length,
    duplicateInputJobIdCount: duplicateInputNodeIds.length,
    duplicateInputDependencyIdCount: duplicateInputEdgeIds.length,
    structuralIssueCodes,
    malformedDependencies: malformedEdges.map(malformedEdgeEvidence),
    danglingDependencies: danglingEdges.map((edge) => ({
      edgeId: edge.id,
      from: edge.from,
      to: edge.to,
      relation: edge.relation,
      missingEndpoints: [
        ...(!nodes.some((node) => node.id === edge.from) ? ['from'] : []),
        ...(!nodes.some((node) => node.id === edge.to) ? ['to'] : [])
      ]
    })),
    duplicateNodeIds,
    duplicateInputNodeIds,
    duplicateEdgeIds,
    duplicateInputEdgeIds,
    handoffClaims: {
      dependencyTruth: visibleDependencyLossless ? 'complete_visible_dependencies' : 'lossy_visible_dependencies',
      executableDependencyCount,
      droppedDependencyCount,
      structuralIssueCodes
    }
  };
}

function boundaryDenialForNode(node, accessContext) {
  if (node.tenantId && accessContext.tenantId && node.tenantId !== accessContext.tenantId && !accessContext.canCrossTenant) {
    return 'tenant_mismatch';
  }
  if (node.workspaceId && accessContext.workspaceId && node.workspaceId !== accessContext.workspaceId && !accessContext.canViewAllWorkspaces) {
    return 'workspace_mismatch';
  }
  if (roleRank(node.requiredRole) > accessContext.maxRoleRank) {
    return 'insufficient_role';
  }
  return '';
}

function boundaryDenialForEdge(edge, accessContext) {
  if (edge.tenantId && accessContext.tenantId && edge.tenantId !== accessContext.tenantId && !accessContext.canCrossTenant) {
    return 'tenant_mismatch';
  }
  if (edge.workspaceId && accessContext.workspaceId && edge.workspaceId !== accessContext.workspaceId && !accessContext.canViewAllWorkspaces) {
    return 'workspace_mismatch';
  }
  return '';
}

function buildScopePolicy(nodes, edges, accessContext) {
  const missingTenantJobIds = nodes.filter((node) => !node.tenantId).map((node) => node.id).sort();
  const missingWorkspaceJobIds = nodes.filter((node) => !node.workspaceId).map((node) => node.id).sort();
  const missingTenantEdgeIds = edges.filter((edge) => !edge.tenantId).map((edge) => edge.id).sort();
  const missingWorkspaceEdgeIds = edges.filter((edge) => !edge.workspaceId).map((edge) => edge.id).sort();
  const tenantIds = Array.from(new Set(nodes.map((node) => node.tenantId).filter(Boolean))).sort();
  const workspaceIds = Array.from(new Set(nodes.map((node) => node.workspaceId).filter(Boolean))).sort();
  const tenantScopeKnown = Boolean(accessContext.tenantId);
  const workspaceScopeKnown = Boolean(accessContext.workspaceId);
  const hasUnscopedJobs = missingTenantJobIds.length > 0 || missingWorkspaceJobIds.length > 0;
  const hasUnscopedEdges = missingTenantEdgeIds.length > 0 || missingWorkspaceEdgeIds.length > 0;
  const needsScopeBinding =
    (tenantScopeKnown && missingTenantJobIds.length > 0) ||
    (workspaceScopeKnown && missingWorkspaceJobIds.length > 0) ||
    (tenantScopeKnown && missingTenantEdgeIds.length > 0) ||
    (workspaceScopeKnown && missingWorkspaceEdgeIds.length > 0);
  const hasMixedTenantView = tenantIds.length > 1 && !accessContext.canCrossTenant;
  const hasMixedWorkspaceView = workspaceIds.length > 1 && !accessContext.canViewAllWorkspaces;
  const effectiveTenantId = accessContext.tenantId || tenantIds[0] || null;
  const effectiveWorkspaceId = accessContext.workspaceId || workspaceIds[0] || null;
  const matchedWorkspaceGrant = workspaceGrantForScope(accessContext, effectiveTenantId, effectiveWorkspaceId) || null;
  const matchedWorkspaceWriteGrant = workspaceGrantForScope(accessContext, effectiveTenantId, effectiveWorkspaceId, { requireWrite: true }) || null;
  const workspaceWriteAuthorized = accessContext.canWriteAllWorkspaces || Boolean(matchedWorkspaceWriteGrant);
  const unsafeReasons = [
    ...(!tenantScopeKnown ? ['tenant_scope_missing'] : []),
    ...(!workspaceScopeKnown ? ['workspace_scope_missing'] : []),
    ...(needsScopeBinding && !accessContext.canBindUnscopedGraph ? ['unscoped_records_require_binding'] : []),
    ...(hasMixedTenantView ? ['mixed_tenant_visible_set'] : []),
    ...(hasMixedWorkspaceView ? ['mixed_workspace_visible_set'] : []),
    ...(!workspaceWriteAuthorized ? ['workspace_write_grant_missing'] : [])
  ];
  const writeBlockedReasons = [
    ...unsafeReasons,
    ...(!accessContext.canAcceptGraph ? ['accept_permission_missing'] : [])
  ];

  return {
    contract: 'hosted-kernel-job-graph-scope-policy.v1',
    effectiveTenantId,
    effectiveWorkspaceId,
    tenantScopeKnown,
    workspaceScopeKnown,
    tenantIds,
    workspaceIds,
    hasUnscopedJobs,
    hasUnscopedEdges,
    canBindUnscopedGraph: accessContext.canBindUnscopedGraph,
    workspaceWriteAuthorized,
    canWriteScopedGraph: writeBlockedReasons.length === 0,
    writeBlockedReasons,
    workspaceGrant: {
      required: !accessContext.canWriteAllWorkspaces,
      matchedGrantId: matchedWorkspaceGrant?.grantId || null,
      matchedWriteGrantId: matchedWorkspaceWriteGrant?.grantId || null,
      matchedWorkspaceId: matchedWorkspaceGrant?.workspaceId || null,
      matchedTenantId: matchedWorkspaceGrant?.tenantId || null,
      matchedGrantRoles: matchedWorkspaceGrant?.roles || [],
      matchedGrantPermissions: matchedWorkspaceGrant?.permissions || []
    },
    missingScope: {
      jobIdsWithoutTenant: missingTenantJobIds,
      jobIdsWithoutWorkspace: missingWorkspaceJobIds,
      edgeIdsWithoutTenant: missingTenantEdgeIds,
      edgeIdsWithoutWorkspace: missingWorkspaceEdgeIds
    },
    handoffClaims: {
      tenantId: effectiveTenantId,
      workspaceId: effectiveWorkspaceId,
      principalId: accessContext.principalId,
      writePermissions: accessContext.writePermissions,
      workspaceGrantId: matchedWorkspaceWriteGrant?.grantId || null,
      isolation: writeBlockedReasons.length === 0 ? 'scoped_write_allowed' : 'scoped_write_blocked'
    }
  };
}

function buildTopology(nodes, edges) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const scopedEdges = edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
  const incoming = new Map(nodes.map((node) => [node.id, []]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));

  for (const edge of scopedEdges) {
    incoming.get(edge.to)?.push(edge.from);
    outgoing.get(edge.from)?.push(edge.to);
  }

  const roots = nodes
    .filter((node) => incoming.get(node.id).length === 0)
    .map((node) => node.id)
    .sort();
  const leaves = nodes
    .filter((node) => outgoing.get(node.id).length === 0)
    .map((node) => node.id)
    .sort();
  const readyQueue = nodes
    .filter((node) => !node.isTerminal && !node.isFailure && node.blockers.length === 0)
    .filter((node) => incoming.get(node.id).every((dependencyId) =>
      nodes.some((candidate) => candidate.id === dependencyId && candidate.isTerminal)
    ))
    .map((node) => node.id)
    .sort();
  const blockedByDependencies = nodes
    .map((node) => ({
      jobId: node.id,
      waitingOn: incoming.get(node.id).filter((dependencyId) =>
        !nodes.some((candidate) => candidate.id === dependencyId && candidate.isTerminal)
      )
    }))
    .filter((entry) => entry.waitingOn.length > 0);
  const visitState = new Map();
  const cycles = [];
  const stack = [];

  function visit(jobId) {
    const state = visitState.get(jobId);
    if (state === 'done') return;
    if (state === 'visiting') {
      const cycleStart = stack.indexOf(jobId);
      const cyclePath = cycleStart >= 0 ? [...stack.slice(cycleStart), jobId] : [jobId, jobId];
      const cycleKey = cyclePath.join('>');
      if (!cycles.some((cycle) => cycle.key === cycleKey)) {
        cycles.push({
          key: cycleKey,
          jobIds: cyclePath,
          edgeCount: Math.max(0, cyclePath.length - 1)
        });
      }
      return;
    }

    visitState.set(jobId, 'visiting');
    stack.push(jobId);
    for (const dependentId of outgoing.get(jobId) || []) {
      visit(dependentId);
    }
    stack.pop();
    visitState.set(jobId, 'done');
  }

  for (const node of nodes) visit(node.id);

  return {
    contract: 'hosted-kernel-job-graph-topology.v1',
    acyclic: cycles.length === 0,
    roots,
    leaves,
    readyQueue,
    blockedByDependencies,
    cycles: cycles.map(({ jobIds, edgeCount }) => ({ jobIds, edgeCount })),
    proof: {
      scopedEdgeCount: scopedEdges.length,
      dependencyBlockedJobCount: blockedByDependencies.length,
      readyQueueCount: readyQueue.length,
      cycleCount: cycles.length
    }
  };
}

function normalizeRequestState(input, graph) {
  const request = input.request || input.clientRequest || {};
  const requestedJobId = firstString(
    input.selectedJobId,
    input.focusJobId,
    request.selectedJobId,
    request.focusJobId,
    request.jobId
  );
  const fallbackJob = graph.blockedNodes[0] || graph.activeNodes[0] || graph.nodes[0] || null;
  const selectedJob = graph.nodes.find((node) => node.id === requestedJobId) || fallbackJob;
  const mode = firstString(input.mode, request.mode, selectedJob?.status === 'blocked' ? 'triage' : 'review');

  return {
    requestId: firstString(input.requestId, request.id, request.requestId, `${surfaceId}:request`),
    sessionId: firstString(input.sessionId, request.sessionId, input.clientSessionId, ''),
    mode,
    selectedJobId: selectedJob?.id || null,
    requestedJobId: requestedJobId || null,
    selectedJobFound: !requestedJobId || Boolean(graph.nodes.find((node) => node.id === requestedJobId)),
    source: firstString(input.source, request.source, 'hosted-kernel-client'),
    operatorIntent: firstString(input.intent, request.intent, mode === 'triage' ? 'resolve_blockers' : 'review_graph')
  };
}

function buildGraph(input) {
  const accessContext = normalizeAccessContext(input);
  const rawNodes = asArray(input.nodes || input.jobs || input.graph?.nodes || input.graph?.jobs);
  const rawEdges = asArray(input.edges || input.dependencies || input.graph?.edges || input.graph?.dependencies);
  const allNodes = rawNodes.map(normalizeNode);
  const deniedNodes = allNodes
    .map((node) => ({ node, reason: boundaryDenialForNode(node, accessContext) }))
    .filter((entry) => entry.reason);
  const deniedNodeIds = new Set(deniedNodes.map((entry) => entry.node.id));
  const nodes = allNodes.filter((node) => !deniedNodeIds.has(node.id));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const allEdges = rawEdges.map(normalizeEdge);
  const malformedEdges = allEdges.filter((edge) => edge.endpointState !== 'complete');
  const completeEdges = allEdges.filter((edge) => edge.endpointState === 'complete');
  const deniedEdges = completeEdges
    .map((edge) => {
      const reason = boundaryDenialForEdge(edge, accessContext);
      if (reason) return { edge, reason };
      if (deniedNodeIds.has(edge.from) || deniedNodeIds.has(edge.to)) return { edge, reason: 'endpoint_out_of_scope' };
      return { edge, reason: '' };
    })
    .filter((entry) => entry.reason);
  const deniedEdgeIds = new Set(deniedEdges.map((entry) => entry.edge.id));
  const edges = completeEdges.filter((edge) => !deniedEdgeIds.has(edge.id));
  const danglingEdges = edges.filter((edge) => !nodeIds.has(edge.from) || !nodeIds.has(edge.to));
  const blockedNodes = nodes.filter((node) => node.status === 'blocked' || node.blockers.length > 0);
  const activeNodes = nodes.filter((node) => node.isActive && node.status !== 'blocked');
  const terminalNodes = nodes.filter((node) => node.isTerminal);
  const proofBackedNodes = nodes.filter((node) => node.proofCount > 0);
  const topology = buildTopology(nodes, edges);
  const integrity = buildGraphIntegrity({
    allNodes,
    allEdges,
    nodes,
    edges,
    deniedEdges,
    malformedEdges,
    danglingEdges,
    topology
  });
  const boundary = {
    contract: 'hosted-kernel-job-graph-boundary.v1',
    accessContext,
    scopePolicy: buildScopePolicy(nodes, edges, accessContext),
    inputNodeCount: allNodes.length,
    inputEdgeCount: allEdges.length,
    visibleNodeCount: nodes.length,
    visibleEdgeCount: edges.length,
    deniedNodes: deniedNodes.map(({ node, reason }) => ({
      jobId: node.id,
      tenantId: node.tenantId || null,
      workspaceId: node.workspaceId || null,
      requiredRole: node.requiredRole,
      reason
    })),
    deniedEdges: deniedEdges.map(({ edge, reason }) => ({
      edgeId: edge.id,
      from: edge.from,
      to: edge.to,
      tenantId: edge.tenantId || null,
      workspaceId: edge.workspaceId || null,
      reason
    })),
    malformedEdges: malformedEdges.map(malformedEdgeEvidence),
    integrity: {
      contract: integrity.contract,
      status: integrity.status,
      lossless: integrity.lossless,
      malformedDependencyCount: integrity.malformedDependencyCount,
      danglingDependencyCount: integrity.danglingDependencyCount,
      duplicateVisibleJobIdCount: integrity.duplicateVisibleJobIdCount,
      duplicateVisibleDependencyIdCount: integrity.duplicateVisibleDependencyIdCount,
      structuralIssueCodes: integrity.structuralIssueCodes,
      handoffClaims: integrity.handoffClaims
    }
  };

  return {
    nodes,
    edges,
    malformedEdges,
    danglingEdges,
    blockedNodes,
    activeNodes,
    terminalNodes,
    proofBackedNodes,
    topology,
    integrity,
    boundary
  };
}

function normalizeHealthStatus(value) {
  const status = normalizeStatus(value);
  if (status === 'ok' || status === 'healthy') return 'healthy';
  if (status === 'warn' || status === 'warning') return 'degraded';
  if (status === 'down' || status === 'fatal') return 'critical';
  return status === 'unknown' ? 'healthy' : status;
}

function retryPlanForNode(node, now) {
  const attempts = node.failure.retryAttempts;
  const maxAttempts = node.failure.maxRetryAttempts;
  const canRetry = node.isFailure && node.failure.retryable && attempts < maxAttempts && node.blockers.length === 0;
  const backoffSeconds = canRetry ? Math.min(900, 30 * (2 ** attempts)) : null;
  const nowMs = Date.parse(now);
  const nextRetryAt = node.failure.retryAfter || (
    backoffSeconds === null || !Number.isFinite(nowMs)
      ? null
      : new Date(nowMs + backoffSeconds * 1000).toISOString()
  );

  return {
    jobId: node.id,
    status: node.status,
    owner: node.owner,
    attempts,
    maxAttempts,
    retryable: canRetry,
    exhausted: node.isFailure && attempts >= maxAttempts,
    backoffSeconds,
    nextRetryAt,
    failureCode: node.failure.code,
    failureMessage: node.failure.message
  };
}

function normalizeCapabilityList(provider) {
  return Array.from(new Set(normalizeStringList(
    provider?.capabilities ||
    provider?.supportedCapabilities ||
    provider?.contract?.capabilities ||
    provider?.features
  ).map((capability) => capability.toLowerCase()))).sort();
}

function normalizeMailchimpEntitySync(raw, entityKey) {
  const source = raw?.[entityKey] || raw?.[`${entityKey}Sync`] || {};
  const count = normalizeInteger(
    source.count ??
    source.syncedCount ??
    source.total ??
    raw?.[`${entityKey}Count`] ??
    raw?.[`${entityKey}SyncedCount`],
    0
  );
  const lastSyncedAt = normalizeTimestamp(
    source.lastSyncedAt,
    source.syncedAt,
    source.updatedAt,
    raw?.[`${entityKey}LastSyncedAt`]
  );
  return {
    entity: entityKey,
    count,
    cursor: firstString(source.cursor, source.syncCursor, raw?.[`${entityKey}Cursor`]) || null,
    lastSyncedAt,
    stale: normalizeBoolean(source.stale, false),
    externalId: firstString(source.id, source.externalId, raw?.[`${entityKey}Id`]) || null
  };
}

function collectMailchimpSource(raw) {
  return raw?.mailchimp ||
    raw?.mailchimpMarketing ||
    raw?.serviceContract?.mailchimp ||
    raw?.contract?.mailchimp ||
    raw?.integration?.mailchimp ||
    {};
}

function inferMailchimpEnabled(raw, kind, capabilities) {
  const source = collectMailchimpSource(raw);
  return Boolean(
    source.enabled !== false &&
    (
      MAILCHIMP_PROVIDER_KINDS.has(kind) ||
      firstString(raw?.externalSystem, raw?.system, source.externalSystem).toLowerCase().includes('mailchimp') ||
      capabilities.some((capability) => capability.startsWith('mailchimp.')) ||
      firstString(source.audienceId, source.listId, source.campaignId, source.serverPrefix)
    )
  );
}

function normalizeMailchimpProviderContract(raw, provider, now) {
  const source = collectMailchimpSource(raw);
  const handoffSource = source.handoff || raw?.mailchimpHandoff || raw?.handoff?.mailchimp || {};
  const syncSource = source.sync || source.syncMetadata || raw?.mailchimpSync || raw?.sync?.mailchimp || {};
  const audienceId = firstString(
    source.audienceId,
    source.listId,
    raw?.audienceId,
    raw?.listId,
    handoffSource.audienceId
  );
  const campaignId = firstString(
    source.campaignId,
    raw?.campaignId,
    handoffSource.campaignId,
    handoffSource.externalCampaignId
  );
  const templateId = firstString(source.templateId, raw?.templateId, handoffSource.templateId);
  const serverPrefix = firstString(source.serverPrefix, source.datacenter, raw?.serverPrefix, raw?.dc);
  const lastSyncedAt = normalizeTimestamp(
    syncSource.lastSyncedAt,
    syncSource.syncedAt,
    source.lastSyncedAt,
    raw?.mailchimpLastSyncedAt,
    provider.sync.lastSyncedAt
  );
  const nowMs = Date.parse(now);
  const syncMs = Date.parse(lastSyncedAt || '');
  const maxSyncAgeMs = normalizeInteger(syncSource.maxAgeMs ?? source.maxSyncAgeMs ?? provider.sync.maxSyncAgeMs, provider.sync.maxSyncAgeMs);
  const syncAgeMs = Number.isFinite(nowMs) && Number.isFinite(syncMs) ? Math.max(0, nowMs - syncMs) : null;
  const externalState = firstString(
    handoffSource.externalState,
    handoffSource.state,
    source.externalState,
    raw?.mailchimpExternalState,
    provider.handoff.externalState,
    'missing'
  ).toLowerCase();
  const normalizedExternalState = MAILCHIMP_HANDOFF_STATES.has(externalState) ? externalState : 'unknown';
  const entitySync = MAILCHIMP_SYNC_ENTITY_KEYS.map((entityKey) => normalizeMailchimpEntitySync(syncSource, entityKey));
  const syncedEntityCount = entitySync.filter((entry) => entry.count > 0 || entry.lastSyncedAt || entry.cursor).length;
  const webhookAckMode = firstString(
    source.webhookAckMode,
    handoffSource.webhookAckMode,
    raw?.webhookAckMode,
    provider.handoff.ackMode
  ).toLowerCase();
  const blockedReasons = [
    ...(!audienceId ? ['mailchimp_audience_id_missing'] : []),
    ...(!serverPrefix ? ['mailchimp_server_prefix_missing'] : []),
    ...(syncAgeMs === null || syncAgeMs > maxSyncAgeMs ? ['mailchimp_sync_stale'] : []),
    ...(!campaignId && normalizeBoolean(handoffSource.requiresCampaignId ?? source.requiresCampaignId, true) ? ['mailchimp_campaign_id_missing'] : []),
    ...(normalizedExternalState === 'failed' ? ['mailchimp_external_state_failed'] : []),
    ...(normalizedExternalState === 'paused' ? ['mailchimp_external_state_paused'] : []),
    ...(!['at_least_once', 'exactly_once', 'manual_ack'].includes(webhookAckMode) ? ['mailchimp_webhook_ack_mode_unsupported'] : [])
  ];

  return {
    contract: 'mailchimp-job-graph-provider-contract.v1',
    enabled: true,
    product: 'mailchimp',
    audienceId: audienceId || null,
    campaignId: campaignId || null,
    templateId: templateId || null,
    serverPrefix: serverPrefix || null,
    externalSystem: firstString(source.externalSystem, raw?.externalSystem, 'mailchimp-marketing'),
    webhookAckMode,
    sync: {
      contract: 'mailchimp-job-graph-sync-metadata.v1',
      lastSyncedAt,
      maxSyncAgeMs,
      syncAgeMs,
      stale: syncAgeMs === null || syncAgeMs > maxSyncAgeMs,
      cursor: firstString(syncSource.cursor, source.cursor, raw?.mailchimpCursor, provider.sync.cursor) || null,
      generation: firstString(syncSource.generation, syncSource.version, provider.sync.generation) || null,
      entitySync,
      syncedEntityCount
    },
    handoff: {
      contract: 'mailchimp-job-graph-external-handoff.v1',
      commandSink: firstString(
        handoffSource.commandSink,
        source.commandSink,
        raw?.mailchimpCommandSink,
        provider.handoff.commandSink
      ) || null,
      returnRoute: firstString(handoffSource.returnRoute, source.returnRoute, provider.handoff.returnRoute),
      externalState: normalizedExternalState,
      externalStateRaw: externalState,
      idempotencyField: firstString(handoffSource.idempotencyField, source.idempotencyField, 'X-Mailchimp-Webhook-Id'),
      campaignStatusField: firstString(handoffSource.campaignStatusField, source.campaignStatusField, 'status'),
      mergeFieldNamespace: firstString(source.mergeFieldNamespace, handoffSource.mergeFieldNamespace, 'AIOS'),
      requiresDoubleOptIn: normalizeBoolean(source.requiresDoubleOptIn ?? handoffSource.requiresDoubleOptIn, false)
    },
    blockedReasons
  };
}

function normalizeProviderContract(raw, index, now) {
  const sync = raw?.sync || raw?.syncMetadata || raw?.lastSync || {};
  const handoffSource = raw?.handoff || raw?.externalHandoff || {};
  const capabilities = normalizeCapabilityList(raw);
  const lastSyncedAt = normalizeTimestamp(sync.lastSyncedAt, sync.syncedAt, sync.updatedAt, raw?.lastSyncedAt);
  const nowMs = Date.parse(now);
  const syncMs = Date.parse(lastSyncedAt || '');
  const maxSyncAgeMs = normalizeInteger(sync.maxAgeMs ?? raw?.maxSyncAgeMs, 300000);
  const syncAgeMs = Number.isFinite(nowMs) && Number.isFinite(syncMs) ? Math.max(0, nowMs - syncMs) : null;
  const stale = syncAgeMs === null ? lastSyncedAt === null : syncAgeMs > maxSyncAgeMs;

  const provider = {
    providerId: firstString(raw?.providerId, raw?.id, raw?.name, `hosted-kernel-provider-${index + 1}`),
    displayName: firstString(raw?.displayName, raw?.label, raw?.name, 'Hosted kernel provider'),
    kind: firstString(raw?.kind, raw?.type, raw?.providerType, 'hosted_kernel').toLowerCase(),
    endpoint: firstString(raw?.endpoint, raw?.baseUrl, raw?.url) || null,
    capabilities,
    sync: {
      contract: 'hosted-kernel-job-graph-provider-sync.v1',
      cursor: firstString(sync.cursor, sync.syncCursor, raw?.cursor) || null,
      generation: firstString(sync.generation, sync.version, raw?.generation, raw?.version) || null,
      lastSyncedAt,
      maxSyncAgeMs,
      syncAgeMs,
      stale
    },
    handoff: {
      contract: 'hosted-kernel-job-graph-provider-handoff.v1',
      externalSystem: firstString(raw?.externalSystem, raw?.system, handoffSource.externalSystem, 'hosted-kernel'),
      commandSink: firstString(raw?.commandSink, handoffSource.commandSink, raw?.queueName, raw?.topic) || null,
      returnRoute: firstString(raw?.returnRoute, handoffSource.returnRoute, '/operator-userland/job-graph-view'),
      correlationIdField: firstString(raw?.correlationIdField, handoffSource.correlationIdField, 'requestId'),
      ackMode: firstString(handoffSource.ackMode, raw?.ackMode, 'at_least_once').toLowerCase(),
      externalState: firstString(handoffSource.state, handoffSource.status, raw?.externalState, 'unknown').toLowerCase(),
      handoffTtlMs: normalizeInteger(handoffSource.ttlMs ?? raw?.handoffTtlMs, 600000),
      supportsDryRun: normalizeBoolean(handoffSource.supportsDryRun ?? raw?.supportsDryRun, false)
    }
  };

  provider.mailchimp = inferMailchimpEnabled(raw, provider.kind, provider.capabilities)
    ? normalizeMailchimpProviderContract(raw, provider, now)
    : {
        contract: 'mailchimp-job-graph-provider-contract.v1',
        enabled: false,
        product: 'mailchimp',
        blockedReasons: ['mailchimp_contract_not_declared']
      };

  return provider;
}

function providerCapabilityDelta(provider) {
  const supported = new Set(provider.capabilities);
  const missingCapabilities = REQUIRED_PROVIDER_CAPABILITIES.filter((capability) => !supported.has(capability));
  const missingMailchimpCapabilities = provider.mailchimp?.enabled
    ? MAILCHIMP_REQUIRED_CAPABILITIES.filter((capability) => !supported.has(capability))
    : [];
  const extraCapabilities = provider.capabilities.filter((capability) => !REQUIRED_PROVIDER_CAPABILITIES.includes(capability));
  const effectiveCommandSink = provider.mailchimp?.enabled
    ? firstString(provider.mailchimp.handoff?.commandSink, provider.handoff.commandSink)
    : provider.handoff.commandSink;
  const blockedReasons = [
    ...missingCapabilities.map((capability) => `missing:${capability}`),
    ...missingMailchimpCapabilities.map((capability) => `missing:${capability}`),
    ...(provider.mailchimp?.enabled ? provider.mailchimp.blockedReasons : []),
    ...(provider.sync.stale ? ['sync_stale'] : []),
    ...(!effectiveCommandSink ? ['command_sink_missing'] : []),
    ...(provider.handoff.handoffTtlMs < 1000 ? ['handoff_ttl_too_short'] : [])
  ];

  return {
    contract: 'hosted-kernel-job-graph-provider-capability-delta.v1',
    providerId: provider.providerId,
    supportedCapabilities: provider.capabilities,
    missingCapabilities,
    missingMailchimpCapabilities,
    extraCapabilities,
    syncFresh: !provider.sync.stale,
    handoffBound: Boolean(effectiveCommandSink),
    effectiveCommandSink: effectiveCommandSink || null,
    mailchimpReady: !provider.mailchimp?.enabled || (missingMailchimpCapabilities.length === 0 && provider.mailchimp.blockedReasons.length === 0),
    blockedReasons,
    score:
      (REQUIRED_PROVIDER_CAPABILITIES.length - missingCapabilities.length) * 10 +
      (provider.mailchimp?.enabled ? (MAILCHIMP_REQUIRED_CAPABILITIES.length - missingMailchimpCapabilities.length) * 4 : 0) +
      (provider.sync.stale ? 0 : 5) +
      (provider.handoff.commandSink ? 3 : 0) +
      (provider.mailchimp?.enabled && provider.mailchimp.blockedReasons.length === 0 ? 4 : 0) +
      Math.min(extraCapabilities.length, 3)
  };
}

function buildProviderNegotiationPlan(providers, selectedProvider, requestState) {
  const candidateProviders = providers
    .map((provider) => {
      const delta = providerCapabilityDelta(provider);
      return {
        providerId: provider.providerId,
        displayName: provider.displayName,
        kind: provider.kind,
        status: delta.blockedReasons.length === 0 ? 'ready' : 'blocked',
        score: delta.score,
        missingCapabilities: delta.missingCapabilities,
        blockedReasons: delta.blockedReasons,
        sync: {
          cursor: provider.sync.cursor,
          generation: provider.sync.generation,
          lastSyncedAt: provider.sync.lastSyncedAt,
          syncAgeMs: provider.sync.syncAgeMs,
          stale: provider.sync.stale
        },
        handoff: {
          commandSink: delta.effectiveCommandSink,
          externalSystem: provider.handoff.externalSystem,
          returnRoute: provider.handoff.returnRoute,
          ackMode: provider.handoff.ackMode,
          externalState: provider.handoff.externalState,
          handoffTtlMs: provider.handoff.handoffTtlMs
        },
        mailchimp: provider.mailchimp?.enabled
          ? {
              product: provider.mailchimp.product,
              audienceId: provider.mailchimp.audienceId,
              campaignId: provider.mailchimp.campaignId,
              serverPrefix: provider.mailchimp.serverPrefix,
              syncStale: provider.mailchimp.sync.stale,
              syncedEntityCount: provider.mailchimp.sync.syncedEntityCount,
              externalState: provider.mailchimp.handoff.externalState,
              blockedReasons: provider.mailchimp.blockedReasons
            }
          : {
              product: 'mailchimp',
              enabled: false,
              blockedReasons: provider.mailchimp?.blockedReasons || ['mailchimp_contract_not_declared']
            }
      };
    })
    .sort((left, right) => right.score - left.score || left.providerId.localeCompare(right.providerId));
  const selectedDelta = selectedProvider ? providerCapabilityDelta(selectedProvider) : null;
  const recommendedProvider = candidateProviders.find((provider) => provider.status === 'ready') || candidateProviders[0] || null;
  const handoffPhase = !selectedProvider
    ? 'provider_missing'
    : selectedDelta.blockedReasons.length === 0
      ? 'ready_to_dispatch'
      : selectedDelta.blockedReasons.includes('sync_stale')
        ? 'refresh_required'
        : selectedDelta.blockedReasons.includes('command_sink_missing')
          ? 'bind_command_sink'
          : 'capability_upgrade_required';

  return {
    contract: 'hosted-kernel-job-graph-provider-negotiation-plan.v1',
    requestId: requestState.requestId,
    selectedProviderId: selectedProvider?.providerId || null,
    recommendedProviderId: recommendedProvider?.providerId || null,
    handoffPhase,
    selected: selectedDelta,
    candidateProviders,
    proof: {
      requiredCapabilities: REQUIRED_PROVIDER_CAPABILITIES,
      readyProviderIds: candidateProviders.filter((provider) => provider.status === 'ready').map((provider) => provider.providerId),
      blockedProviderIds: candidateProviders.filter((provider) => provider.status !== 'ready').map((provider) => provider.providerId),
      commandSinkBoundProviderIds: candidateProviders
        .filter((provider) => provider.handoff.commandSink)
        .map((provider) => provider.providerId)
    }
  };
}

function collectProviderInputs(input) {
  const runtime = input.clientRuntime || {};
  const integrations = input.integrations || input.integrationContracts || {};
  return [
    ...asArray(input.integrationProviders || input.providers || input.serviceProviders),
    ...asArray(input.providerContracts || input.serviceContracts),
    ...asArray(runtime.integrationProviders || runtime.providerContracts),
    ...asArray(integrations.providers || integrations.contracts)
  ];
}

function buildProviderContracts(input, requestState, now) {
  const rawProviders = collectProviderInputs(input);
  const providers = (rawProviders.length ? rawProviders : [{
    providerId: 'hosted-kernel-default',
    displayName: 'Hosted kernel default provider',
    capabilities: REQUIRED_PROVIDER_CAPABILITIES,
    sync: { lastSyncedAt: now, cursor: requestState.requestId },
    handoff: { commandSink: 'hosted-kernel.job-graph.commands', externalSystem: 'hosted-kernel' }
  }]).map((provider, index) => normalizeProviderContract(provider, index, now));
  const capableProvider = providers.find((provider) =>
    !provider.sync.stale &&
    Boolean(provider.handoff.commandSink) &&
    REQUIRED_PROVIDER_CAPABILITIES.every((capability) => provider.capabilities.includes(capability))
  );
  const selectedProviderId = firstString(
    input.providerId,
    input.integrationProviderId,
    input.request?.providerId,
    capableProvider?.providerId,
    providers[0]?.providerId
  );
  const selectedProvider = providers.find((provider) => provider.providerId === selectedProviderId) || providers[0] || null;
  const supportedCapabilities = selectedProvider ? selectedProvider.capabilities : [];
  const missingCapabilities = REQUIRED_PROVIDER_CAPABILITIES.filter((capability) => !supportedCapabilities.includes(capability));
  const selectedCapabilityDelta = selectedProvider ? providerCapabilityDelta(selectedProvider) : null;
  const negotiationPlan = buildProviderNegotiationPlan(providers, selectedProvider, requestState);
  const negotiable = Boolean(selectedProvider) && selectedCapabilityDelta.blockedReasons.length === 0;
  const blockedReasons = selectedProvider
    ? selectedCapabilityDelta.blockedReasons
    : ['provider_missing'];
  const negotiationStatus = negotiable
    ? 'ready'
    : selectedProvider?.mailchimp?.enabled && selectedProvider.mailchimp.blockedReasons.length > 0
      ? 'mailchimp_contract_blocked'
    : selectedProvider?.sync.stale
      ? 'sync_stale'
      : selectedProvider && !selectedCapabilityDelta?.handoffBound
        ? 'command_sink_missing'
        : missingCapabilities.length > 0
          ? 'missing_capabilities'
          : 'provider_missing';

  return {
    contract: 'hosted-kernel-job-graph-provider-contracts.v1',
    requiredCapabilities: REQUIRED_PROVIDER_CAPABILITIES,
    providers,
    selectedProviderId: selectedProvider?.providerId || null,
    negotiation: {
      status: negotiationStatus,
      negotiable,
      supportedCapabilities,
      missingCapabilities,
      missingMailchimpCapabilities: selectedCapabilityDelta?.missingMailchimpCapabilities || [],
      staleProviderIds: providers.filter((provider) => provider.sync.stale).map((provider) => provider.providerId),
      staleMailchimpProviderIds: providers
        .filter((provider) => provider.mailchimp?.enabled && provider.mailchimp.sync.stale)
        .map((provider) => provider.providerId),
      blockedReasons,
      recommendedProviderId: negotiationPlan.recommendedProviderId,
      handoffPhase: negotiationPlan.handoffPhase
    },
    negotiationPlan,
    externalHandoff: selectedProvider
      ? {
          status: negotiable ? 'handoff_ready' : 'handoff_blocked',
          providerId: selectedProvider.providerId,
          commandSink: selectedCapabilityDelta?.effectiveCommandSink || null,
          externalSystem: selectedProvider.handoff.externalSystem,
          correlationId: `${surfaceId}:${requestState.requestId}:${selectedProvider.providerId}`,
          returnRoute: selectedProvider.handoff.returnRoute,
          syncCursor: selectedProvider.sync.cursor,
          correlationIdField: selectedProvider.handoff.correlationIdField,
          ackMode: selectedProvider.handoff.ackMode,
          externalState: selectedProvider.handoff.externalState,
          handoffTtlMs: selectedProvider.handoff.handoffTtlMs,
          handoffPhase: negotiationPlan.handoffPhase,
          mailchimp: selectedProvider.mailchimp?.enabled
            ? {
                contract: selectedProvider.mailchimp.handoff.contract,
                audienceId: selectedProvider.mailchimp.audienceId,
                campaignId: selectedProvider.mailchimp.campaignId,
                templateId: selectedProvider.mailchimp.templateId,
                serverPrefix: selectedProvider.mailchimp.serverPrefix,
                commandSink: selectedProvider.mailchimp.handoff.commandSink,
                externalSystem: selectedProvider.mailchimp.externalSystem,
                externalState: selectedProvider.mailchimp.handoff.externalState,
                syncCursor: selectedProvider.mailchimp.sync.cursor,
                syncGeneration: selectedProvider.mailchimp.sync.generation,
                webhookAckMode: selectedProvider.mailchimp.webhookAckMode,
                idempotencyField: selectedProvider.mailchimp.handoff.idempotencyField,
                mergeFieldNamespace: selectedProvider.mailchimp.handoff.mergeFieldNamespace,
                blockedReasons: selectedProvider.mailchimp.blockedReasons
              }
            : null,
          blockedReasons
        }
      : {
          status: 'handoff_blocked',
          providerId: null,
          commandSink: null,
          externalSystem: null,
          correlationId: `${surfaceId}:${requestState.requestId}:unbound-provider`,
          returnRoute: '/operator-userland/job-graph-view',
          syncCursor: null,
          correlationIdField: 'requestId',
          ackMode: 'at_least_once',
          externalState: 'missing',
          handoffTtlMs: 0,
          handoffPhase: 'provider_missing',
          mailchimp: null,
          blockedReasons: ['provider_missing']
        }
  };
}

function normalizeRuntimeErrors(input) {
  const health = input.operationalHealth || input.kernelHealth || input.health || input.clientRuntime?.health || {};
  return asArray(input.errors || input.runtimeErrors || health.errors || input.clientRuntime?.errors)
    .map((error, index) => ({
      code: firstString(error?.code, error?.errorCode, `runtime_error_${index + 1}`),
      severity: firstString(error?.severity, error?.level, 'error').toLowerCase(),
      message: firstString(error?.message, error?.reason, 'Hosted kernel runtime reported an error.'),
      jobId: firstString(error?.jobId, error?.nodeId, error?.targetJobId) || null,
      retryable: error?.retryable === true,
      source: firstString(error?.source, error?.component, 'hosted-kernel-runtime')
    }));
}

function healthGate(code, passed, severity, message, details = {}) {
  return {
    code,
    passed: Boolean(passed),
    severity: passed ? 'none' : severity,
    message,
    writeBlocking: !passed && ['error', 'critical'].includes(severity),
    details
  };
}

function severityRank(severity) {
  if (severity === 'critical') return 4;
  if (severity === 'error') return 3;
  if (severity === 'warning') return 2;
  if (severity === 'info') return 1;
  return 0;
}

function healthGateAction(gate) {
  if (gate.code === 'runtime_status') return 'inspect_runtime_health';
  if (gate.code === 'graph_validation') return 'repair_graph_validation';
  if (gate.code === 'topology_integrity') return 'repair_dependency_topology';
  if (gate.code === 'provider_contract') return gate.details?.negotiationStatus === 'sync_stale'
    ? 'refresh_provider_contract'
    : 'bind_provider_handoff';
  if (gate.code === 'retry_capacity') return 'manual_repair_failed_jobs';
  if (gate.code === 'retry_unblocked') return 'clear_retry_blockers';
  if (gate.code === 'retry_backoff_window') return 'inspect_retry_policy';
  if (gate.code === 'command_recovery') return 'reconcile_persisted_commands';
  return 'inspect_operational_health';
}

function healthGateOwner(gate) {
  if (gate.code === 'provider_contract') return 'integration_provider';
  if (gate.code === 'runtime_status') return 'hosted_kernel_runtime';
  if (gate.code === 'command_recovery') return 'job_graph_persistence';
  if (gate.code.startsWith('retry_')) return 'job_lifecycle';
  if (gate.code === 'graph_validation' || gate.code === 'topology_integrity') return 'job_graph';
  return 'operator';
}

function incidentFromGate(gate, index, now) {
  return {
    incidentId: `${surfaceId}:health:${gate.code}:${index + 1}`,
    source: 'health_gate',
    code: gate.code,
    severity: gate.severity,
    action: healthGateAction(gate),
    owner: healthGateOwner(gate),
    message: gate.message,
    writeBlocking: gate.writeBlocking,
    openedAt: now,
    targetJobIds: normalizeStringList([
      ...(gate.details?.failedJobIds || []),
      ...(gate.details?.retryableJobIds || []),
      ...(gate.details?.exhaustedJobIds || []),
      ...(gate.details?.blockedRetryableJobIds || [])
    ]),
    evidence: gate.details || {}
  };
}

function incidentFromRuntimeError(error, index, now) {
  return {
    incidentId: `${surfaceId}:runtime-error:${error.code}:${index + 1}`,
    source: error.source,
    code: error.code,
    severity: error.severity === 'fatal' ? 'critical' : error.severity,
    action: error.retryable ? 'retry_runtime_operation' : 'inspect_runtime_error',
    owner: 'hosted_kernel_runtime',
    message: error.message,
    writeBlocking: ['critical', 'fatal', 'error'].includes(error.severity),
    openedAt: now,
    targetJobIds: error.jobId ? [error.jobId] : [],
    evidence: {
      retryable: error.retryable,
      jobId: error.jobId
    }
  };
}

function incidentFromFailedJob(node, retryPlan, now) {
  const exhausted = Boolean(retryPlan?.exhausted);
  const retryable = Boolean(retryPlan?.retryable);
  return {
    incidentId: `${surfaceId}:failed-job:${node.id}`,
    source: node.owner,
    code: node.failure.code || `job_${node.status}`,
    severity: exhausted ? 'error' : 'warning',
    action: retryable ? 'schedule_retry' : exhausted ? 'manual_repair_failed_job' : 'inspect_failed_job',
    owner: 'job_lifecycle',
    message: node.failure.message || `${node.label} is in ${node.status} state.`,
    writeBlocking: exhausted,
    openedAt: now,
    targetJobIds: [node.id],
    evidence: {
      jobId: node.id,
      status: node.status,
      attempts: retryPlan?.attempts ?? node.failure.retryAttempts,
      maxAttempts: retryPlan?.maxAttempts ?? node.failure.maxRetryAttempts,
      nextRetryAt: retryPlan?.nextRetryAt || null,
      blockers: node.blockers
    }
  };
}

function buildIncidentResponse(graph, validation, providerContracts, runtimeStatus, runtimeErrors, retryQueue, exhaustedFailures, healthGates, now) {
  const retryPlansByJobId = new Map([
    ...retryQueue.map((plan) => [plan.jobId, plan]),
    ...exhaustedFailures.map((plan) => [plan.jobId, plan])
  ]);
  const failedNodes = graph.nodes.filter((node) => node.isFailure);
  const gateIncidents = healthGates
    .filter((gate) => !gate.passed)
    .map((gate, index) => incidentFromGate(gate, index, now));
  const runtimeIncidents = runtimeErrors.map((error, index) => incidentFromRuntimeError(error, index, now));
  const failedJobIncidents = failedNodes.map((node) =>
    incidentFromFailedJob(node, retryPlansByJobId.get(node.id) || retryPlanForNode(node, now), now)
  );
  const providerBlocked = providerContracts?.negotiation && !providerContracts.negotiation.negotiable;
  const providerIncident = providerBlocked
    ? [{
        incidentId: `${surfaceId}:provider:${providerContracts.selectedProviderId || 'unbound'}`,
        source: 'provider_contract',
        code: `provider_${providerContracts.negotiation.status}`,
        severity: providerContracts.negotiation.status === 'sync_stale' ? 'error' : 'warning',
        action: providerContracts.negotiation.status === 'sync_stale' ? 'refresh_provider_contract' : 'bind_provider_handoff',
        owner: 'integration_provider',
        message: 'Selected provider contract is blocking hosted-kernel handoff.',
        writeBlocking: true,
        openedAt: now,
        targetJobIds: [],
        evidence: {
          providerId: providerContracts.selectedProviderId,
          missingCapabilities: providerContracts.negotiation.missingCapabilities,
          blockedReasons: providerContracts.negotiation.blockedReasons,
          recommendedProviderId: providerContracts.negotiation.recommendedProviderId
        }
      }]
    : [];
  const validationIncidents = validation.issues
    .filter((issue) => issue.severity === 'error')
    .map((issue, index) => ({
      incidentId: `${surfaceId}:validation:${issue.code}:${index + 1}`,
      source: 'graph_validation',
      code: issue.code,
      severity: 'error',
      action: 'repair_graph_validation',
      owner: 'job_graph',
      message: issue.message,
      writeBlocking: true,
      openedAt: now,
      targetJobIds: normalizeStringList([issue.jobId]),
      evidence: {
        edgeId: issue.edgeId || null,
        from: issue.from || null,
        to: issue.to || null,
        reason: issue.reason || null
      }
    }));
  const incidents = [
    ...gateIncidents,
    ...runtimeIncidents,
    ...failedJobIncidents,
    ...providerIncident,
    ...validationIncidents
  ]
    .sort((left, right) =>
      severityRank(right.severity) - severityRank(left.severity) ||
      Number(right.writeBlocking) - Number(left.writeBlocking) ||
      left.code.localeCompare(right.code)
    );
  const primaryIncident = incidents[0] || null;
  const writeBlockingIncidents = incidents.filter((incident) => incident.writeBlocking);
  const retryNext = retryQueue[0] || null;
  const recoveryChecklist = [
    ...(runtimeStatus !== 'healthy' ? ['restore_runtime_health'] : []),
    ...(validation.valid ? [] : ['repair_validation_errors']),
    ...(!graph.integrity.lossless || !graph.topology.acyclic ? ['repair_dependency_integrity'] : []),
    ...(providerBlocked ? ['negotiate_provider_contract'] : []),
    ...(exhaustedFailures.length > 0 ? ['repair_exhausted_failures'] : []),
    ...(retryQueue.length > 0 ? ['wait_for_retry_backoff'] : [])
  ];

  return {
    contract: 'hosted-kernel-job-graph-incident-response.v1',
    generatedAt: now,
    status: writeBlockingIncidents.length > 0
      ? 'write_blocked'
      : incidents.length > 0
        ? 'operator_attention'
        : 'clear',
    primaryIncident,
    incidentCount: incidents.length,
    writeBlockingIncidentCount: writeBlockingIncidents.length,
    incidents,
    recoveryChecklist: Array.from(new Set(recoveryChecklist)),
    retryBackoff: {
      nextRetryAt: retryNext?.nextRetryAt || null,
      nextRetryJobId: retryNext?.jobId || null,
      retryableJobIds: retryQueue.map((plan) => plan.jobId),
      exhaustedJobIds: exhaustedFailures.map((plan) => plan.jobId)
    },
    commandSafety: {
      allowReadOnlyInspection: true,
      allowRetryScheduling: writeBlockingIncidents.every((incident) => incident.action === 'manual_repair_failed_job') && retryQueue.length > 0,
      allowAcceptance: incidents.length === 0,
      holdExternalHandoff: writeBlockingIncidents.length > 0 || providerBlocked
    },
    escalation: {
      required: writeBlockingIncidents.length > 0,
      owners: Array.from(new Set(writeBlockingIncidents.map((incident) => incident.owner))).sort(),
      codes: writeBlockingIncidents.map((incident) => incident.code)
    }
  };
}

function summarizeHealthGates(graph, validation, providerContracts, runtimeStatus, runtimeErrors, retryQueue, exhaustedFailures, commandRecovery = null) {
  const validationErrors = validation.issues.filter((issue) => issue.severity === 'error');
  const criticalRuntimeErrors = runtimeErrors.filter((error) => ['critical', 'fatal'].includes(error.severity));
  const providerNegotiation = providerContracts?.negotiation || null;
  const providerHandoff = providerContracts?.externalHandoff || null;
  const staleProviderIds = providerNegotiation?.staleProviderIds || [];
  const missingCapabilities = providerNegotiation?.missingCapabilities || [];
  const failedNodes = graph.nodes.filter((node) => node.isFailure);
  const blockedRetryableFailures = failedNodes.filter((node) =>
    node.failure.retryable && node.blockers.length > 0 && node.failure.retryAttempts < node.failure.maxRetryAttempts
  );

  return [
    healthGate(
      'runtime_status',
      runtimeStatus === 'healthy',
      runtimeStatus === 'critical' ? 'critical' : 'warning',
      runtimeStatus === 'healthy'
        ? 'Hosted-kernel runtime is healthy.'
        : 'Hosted-kernel runtime is not healthy.',
      { runtimeStatus, criticalRuntimeErrorCodes: criticalRuntimeErrors.map((error) => error.code) }
    ),
    healthGate(
      'graph_validation',
      validationErrors.length === 0,
      'critical',
      validationErrors.length === 0
        ? 'Graph validation has no blocking errors.'
        : 'Graph validation has blocking errors that prevent hosted-kernel writes.',
      { errorCodes: validationErrors.map((issue) => issue.code) }
    ),
    healthGate(
      'topology_integrity',
      graph.topology.acyclic && graph.integrity.lossless,
      'critical',
      graph.topology.acyclic && graph.integrity.lossless
        ? 'Graph topology is acyclic and all dependency endpoints are visible and executable.'
        : 'Graph topology has cycles, malformed dependencies, duplicate identifiers, or dangling dependencies.',
      {
        cycleCount: graph.topology.cycles.length,
        danglingDependencyIds: graph.danglingEdges.map((edge) => edge.id),
        malformedDependencyIds: graph.malformedEdges.map((edge) => edge.id),
        duplicateNodeIds: graph.integrity.duplicateNodeIds.map((entry) => entry.value),
        duplicateDependencyIds: graph.integrity.duplicateEdgeIds.map((entry) => entry.value),
        structuralIssueCodes: graph.integrity.structuralIssueCodes
      }
    ),
    healthGate(
      'provider_contract',
      providerNegotiation ? providerNegotiation.negotiable : true,
      providerNegotiation?.status === 'sync_stale' ? 'error' : 'warning',
      providerNegotiation?.negotiable || !providerNegotiation
        ? 'Selected provider contract is ready for hosted-kernel handoff.'
        : 'Selected provider contract cannot receive hosted-kernel handoff.',
      {
        selectedProviderId: providerContracts?.selectedProviderId || null,
        negotiationStatus: providerNegotiation?.status || 'not_evaluated',
        handoffStatus: providerHandoff?.status || 'not_evaluated',
        missingCapabilities,
        missingMailchimpCapabilities: providerNegotiation?.missingMailchimpCapabilities || [],
        staleProviderIds,
        staleMailchimpProviderIds: providerNegotiation?.staleMailchimpProviderIds || [],
        mailchimpExternalState: providerHandoff?.mailchimp?.externalState || null,
        mailchimpAudienceId: providerHandoff?.mailchimp?.audienceId || null,
        mailchimpCampaignId: providerHandoff?.mailchimp?.campaignId || null
      }
    ),
    healthGate(
      'retry_capacity',
      exhaustedFailures.length === 0,
      'error',
      exhaustedFailures.length === 0
        ? 'No failed jobs have exhausted retry capacity.'
        : 'One or more failed jobs exhausted retry capacity and require manual repair.',
      { exhaustedJobIds: exhaustedFailures.map((plan) => plan.jobId) }
    ),
    healthGate(
      'retry_unblocked',
      blockedRetryableFailures.length === 0,
      'warning',
      blockedRetryableFailures.length === 0
        ? 'Retryable failed jobs are not blocked by operator blockers.'
        : 'Retryable failed jobs still have blockers that must be cleared before scheduling.',
      { blockedRetryableJobIds: blockedRetryableFailures.map((node) => node.id) }
    ),
    healthGate(
      'retry_backoff_window',
      failedNodes.length === 0 || retryQueue.length > 0 || exhaustedFailures.length > 0 || blockedRetryableFailures.length > 0,
      'warning',
      failedNodes.length === 0
        ? 'No failed jobs require retry scheduling.'
        : 'Failed jobs have an explicit retry, exhaustion, or blocker state.',
      {
        failedJobIds: failedNodes.map((node) => node.id),
        retryableJobIds: retryQueue.map((plan) => plan.jobId)
      }
    ),
    healthGate(
      'command_recovery',
      !commandRecovery || commandRecovery.restartSafe,
      commandRecovery?.failedCommandIds?.length > 0 || commandRecovery?.staleCommandIds?.length > 0 ? 'error' : 'warning',
      !commandRecovery || commandRecovery.restartSafe
        ? 'Persisted command state is restart-safe for hosted-kernel replay.'
        : 'Persisted command state requires reconciliation before hosted-kernel writes resume.',
      {
        recoveryStatus: commandRecovery?.status || 'not_evaluated',
        inFlightCommandIds: commandRecovery?.inFlightCommandIds || [],
        staleCommandIds: commandRecovery?.staleCommandIds || [],
        failedCommandIds: commandRecovery?.failedCommandIds || [],
        unknownCommandIds: commandRecovery?.unknownCommandIds || [],
        blockedReasons: commandRecovery?.blockedReasons || []
      }
    )
  ];
}

function buildOperationalHealth(graph, validation, input, now, providerContracts = null, commandRecovery = null) {
  const health = input.operationalHealth || input.kernelHealth || input.health || input.clientRuntime?.health || {};
  const runtimeStatus = normalizeHealthStatus(health.status || health.state);
  const runtimeErrors = normalizeRuntimeErrors(input);
  const failedNodes = graph.nodes.filter((node) => node.isFailure);
  const retryQueue = failedNodes
    .map((node) => retryPlanForNode(node, now))
    .filter((plan) => plan.retryable)
    .sort((left, right) => firstString(left.nextRetryAt).localeCompare(firstString(right.nextRetryAt)));
  const exhaustedFailures = failedNodes
    .map((node) => retryPlanForNode(node, now))
    .filter((plan) => plan.exhausted);
  const healthGates = summarizeHealthGates(
    graph,
    validation,
    providerContracts,
    runtimeStatus,
    runtimeErrors,
    retryQueue,
    exhaustedFailures,
    commandRecovery
  );
  const blockingHealthGates = healthGates.filter((gate) => gate.writeBlocking);
  const warningHealthGates = healthGates.filter((gate) => !gate.passed && !gate.writeBlocking);
  const hasCriticalRuntimeError = runtimeErrors.some((error) => ['critical', 'fatal'].includes(error.severity));
  const degradedMode = runtimeStatus !== 'healthy' || failedNodes.length > 0 || validation.issueCount > 0 || healthGates.some((gate) => !gate.passed);
  const critical = runtimeStatus === 'critical' || hasCriticalRuntimeError || validation.valid === false || healthGates.some((gate) => gate.severity === 'critical');
  const status = critical ? 'critical' : degradedMode ? 'degraded' : 'healthy';
  const fallbackMode = status === 'healthy'
    ? 'full_control'
    : critical
      ? 'repair_only'
      : retryQueue.length > 0
        ? 'retry_backoff_monitor'
        : 'read_only_triage';
  const nextRetryAt = retryQueue[0]?.nextRetryAt || null;
  const retryHorizon = retryQueue.length > 0
    ? {
        nextRetryAt,
        retryableJobIds: retryQueue.map((plan) => plan.jobId),
        maxBackoffSeconds: Math.max(...retryQueue.map((plan) => plan.backoffSeconds || 0)),
        exhaustedJobIds: exhaustedFailures.map((plan) => plan.jobId)
      }
    : {
        nextRetryAt: null,
        retryableJobIds: [],
        maxBackoffSeconds: 0,
        exhaustedJobIds: exhaustedFailures.map((plan) => plan.jobId)
      };
  const synthesizedRuntimeError = runtimeStatus !== 'healthy' && runtimeErrors.length === 0
    ? [{
        code: `kernel_${runtimeStatus}`,
        severity: runtimeStatus === 'critical' ? 'error' : 'warning',
        message: `Hosted kernel runtime is ${runtimeStatus}.`,
        jobId: null,
        source: 'hosted-kernel-runtime',
        action: 'inspect_runtime_health'
      }]
    : [];
  const actionableErrors = [
    ...synthesizedRuntimeError,
    ...runtimeErrors.map((error) => ({
      code: error.code,
      severity: error.severity === 'critical' ? 'error' : error.severity,
      message: error.message,
      jobId: error.jobId,
      source: error.source,
      action: error.retryable ? 'retry_runtime_operation' : 'inspect_runtime_error'
    })),
    ...failedNodes.map((node) => ({
      code: node.failure.code || `job_${node.status}`,
      severity: 'error',
      message: node.failure.message || `${node.label} is in ${node.status} state.`,
      jobId: node.id,
      source: node.owner,
      action: retryQueue.some((plan) => plan.jobId === node.id) ? 'schedule_retry' : 'manual_repair_required'
    }))
  ];
  const degradedReasons = [
    ...blockingHealthGates.map((gate) => gate.code),
    ...warningHealthGates.map((gate) => gate.code)
  ];
  const incidentResponse = buildIncidentResponse(
    graph,
    validation,
    providerContracts,
    runtimeStatus,
    runtimeErrors,
    retryQueue,
    exhaustedFailures,
    healthGates,
    now
  );

  return {
    contract: 'hosted-kernel-job-graph-operational-health.v1',
    status,
    degradedMode,
    degradedReasons,
    fallbackMode,
    readOnly: status !== 'healthy' || blockingHealthGates.length > 0,
    writeBlockedReasons: blockingHealthGates.map((gate) => gate.code),
    runtimeStatus,
    failedJobCount: failedNodes.length,
    retryableJobCount: retryQueue.length,
    exhaustedFailureCount: exhaustedFailures.length,
    retryQueue,
    exhaustedFailures,
    retryHorizon,
    healthGates,
    actionableErrors,
    incidentResponse,
    proof: {
      generatedAt: now,
      gateCount: healthGates.length,
      blockingGateCodes: blockingHealthGates.map((gate) => gate.code),
      warningGateCodes: warningHealthGates.map((gate) => gate.code),
      providerId: providerContracts?.selectedProviderId || null,
      providerNegotiationStatus: providerContracts?.negotiation?.status || 'not_evaluated',
      commandRecoveryStatus: commandRecovery?.status || 'not_evaluated',
      commandRecoveryRestartSafe: commandRecovery?.restartSafe ?? true,
      validationIssueCount: validation.issueCount,
      incidentResponseStatus: incidentResponse.status,
      primaryIncidentCode: incidentResponse.primaryIncident?.code || null
    }
  };
}

function dependenciesFor(graph, jobId) {
  if (!jobId) return [];
  return graph.edges
    .filter((edge) => edge.to === jobId)
    .map((edge) => ({
      edgeId: edge.id,
      jobId: edge.from,
      relation: edge.relation,
      resolved: graph.nodes.some((node) => node.id === edge.from && node.isTerminal)
    }));
}

function dependentsFor(graph, jobId) {
  if (!jobId) return [];
  return graph.edges
    .filter((edge) => edge.from === jobId)
    .map((edge) => ({
      edgeId: edge.id,
      jobId: edge.to,
      relation: edge.relation,
      waiting: graph.nodes.some((node) => node.id === edge.to && !node.isTerminal)
    }));
}

function normalizeCommandIdList(value) {
  return asArray(value)
    .map((command) => firstString(command?.id, command?.commandId, command?.idempotencyKey, command))
    .filter(Boolean);
}

function normalizeCommandStatus(value) {
  const status = normalizeStatus(value);
  if (status === 'done') return 'completed';
  if (status === 'success') return 'succeeded';
  if (status === 'acked') return 'acknowledged';
  if (status === 'in-flight') return 'in_flight';
  return status;
}

function normalizePersistedCommandRecord(raw, index, now, fallbackTtlMs = DEFAULT_COMMAND_RECOVERY_TTL_MS) {
  const commandId = firstString(raw?.commandId, raw?.id, raw?.idempotencyKey, raw);
  const status = normalizeCommandStatus(raw?.status || raw?.dispatchStatus || raw?.state || raw?.phase || 'unknown');
  const createdAt = normalizeTimestamp(raw?.createdAt, raw?.queuedAt, raw?.capturedAt, raw?.savedAt, raw?.timestamp);
  const dispatchedAt = normalizeTimestamp(raw?.dispatchedAt, raw?.sentAt, raw?.startedAt, raw?.updatedAt);
  const completedAt = normalizeTimestamp(raw?.completedAt, raw?.acknowledgedAt, raw?.finishedAt, raw?.appliedAt);
  const updatedAt = normalizeTimestamp(raw?.updatedAt, raw?.lastUpdatedAt, completedAt, dispatchedAt, createdAt);
  const expiresAt = normalizeTimestamp(raw?.expiresAt, raw?.ttlExpiresAt, raw?.deadlineAt);
  const ttlMs = normalizeInteger(raw?.ttlMs ?? raw?.commandTtlMs ?? raw?.dispatchTtlMs, fallbackTtlMs);
  const basisAt = dispatchedAt || createdAt || updatedAt;
  const nowMs = Date.parse(now);
  const basisMs = Date.parse(basisAt || '');
  const expiresMs = Date.parse(expiresAt || '');
  const ageMs = Number.isFinite(nowMs) && Number.isFinite(basisMs) ? Math.max(0, nowMs - basisMs) : null;
  const deadlineExceeded =
    Number.isFinite(nowMs) &&
    (
      (Number.isFinite(expiresMs) && expiresMs <= nowMs) ||
      (ageMs !== null && ttlMs > 0 && ageMs > ttlMs)
    );
  const applied = COMMAND_APPLIED_STATUSES.has(status);
  const failed = COMMAND_FAILED_STATUSES.has(status);
  const inFlight = !applied && !failed && COMMAND_IN_FLIGHT_STATUSES.has(status);
  const restartSafeStatus = applied
    ? 'already_applied'
    : failed
      ? 'failed_requires_review'
      : deadlineExceeded
        ? 'stale_requires_reconciliation'
        : inFlight
          ? 'in_flight_resume_pending'
          : 'unknown_requires_review';

  return {
    contract: 'hosted-kernel-job-graph-persisted-command.v1',
    commandId,
    idempotencyKey: firstString(raw?.idempotencyKey, raw?.dedupeKey, commandId),
    kind: firstString(raw?.kind, raw?.type, raw?.commandKind, 'unknown'),
    targetId: firstString(raw?.targetId, raw?.jobId, raw?.snapshotId, raw?.payload?.jobId, raw?.payload?.snapshotId) || null,
    status,
    restartSafeStatus,
    applied,
    failed,
    inFlight,
    stale: deadlineExceeded,
    ageMs,
    ttlMs,
    createdAt,
    dispatchedAt,
    completedAt,
    updatedAt,
    expiresAt,
    source: firstString(raw?.source, raw?.sink, raw?.commandSink, 'persisted_state'),
    sequence: normalizeInteger(raw?.sequence ?? raw?.index, index + 1)
  };
}

function collectPersistedCommandRecords(input, now) {
  const runtime = input.clientRuntime || {};
  const persisted = input.persistedState || input.savedState || runtime.persistedState || {};
  const commandState = persisted.commandState || persisted.commandRecovery || runtime.commandState || input.commandState || {};
  const fallbackTtlMs = normalizeInteger(
    commandState.commandTtlMs ??
    commandState.ttlMs ??
    input.lifecycleSettings?.commandTtlMs ??
    input.clientRuntime?.lifecycleSettings?.commandTtlMs,
    DEFAULT_COMMAND_RECOVERY_TTL_MS
  );
  const rawRecords = [
    ...asArray(persisted.commandLog || persisted.commands),
    ...asArray(commandState.commands || commandState.inFlight || commandState.pending || commandState.ledger),
    ...asArray(runtime.commandLog || runtime.commands || runtime.pendingCommands),
    ...asArray(input.commandLog || input.commands || input.pendingCommands),
    ...asArray(persisted.snapshots || persisted.snapshotLedger || persisted.recoveryLog)
      .flatMap((snapshot) => asArray(snapshot?.commands || snapshot?.commandLog))
  ];
  const recordsByCommandId = new Map();

  rawRecords
    .map((record, index) => normalizePersistedCommandRecord(record, index, now, fallbackTtlMs))
    .filter((record) => record.commandId)
    .sort((left, right) =>
      firstString(left.updatedAt, left.createdAt).localeCompare(firstString(right.updatedAt, right.createdAt)) ||
      left.sequence - right.sequence
    )
    .forEach((record) => {
      recordsByCommandId.set(record.commandId, record);
    });

  return Array.from(recordsByCommandId.values())
    .sort((left, right) =>
      firstString(left.updatedAt, left.createdAt).localeCompare(firstString(right.updatedAt, right.createdAt)) ||
      left.commandId.localeCompare(right.commandId)
    );
}

function normalizeCommandHistory(input) {
  const now = input.now || new Date().toISOString();
  const persisted = input.persistedState || input.savedState || input.clientRuntime?.persistedState || {};
  const persistedRecords = collectPersistedCommandRecords(input, now);
  const appliedRecordIds = persistedRecords
    .filter((record) => record.applied)
    .map((record) => record.commandId);
  const legacyStringCommandIds = [
    ...asArray(persisted.commandLog || persisted.commands || input.commandLog),
    ...asArray(input.clientRuntime?.commandLog || input.clientRuntime?.commands)
  ]
    .filter((entry) => typeof entry === 'string')
    .map((entry) => firstString(entry))
    .filter(Boolean);
  const snapshotCommandIds = asArray(persisted.snapshots || persisted.snapshotLedger || persisted.recoveryLog)
    .flatMap((snapshot) => normalizeCommandIdList(snapshot?.commandIds));
  return Array.from(new Set([...appliedRecordIds, ...legacyStringCommandIds, ...snapshotCommandIds]));
}

function buildCommandRecoveryState(input, requestState, now) {
  const records = collectPersistedCommandRecords(input, now);
  const appliedRecords = records.filter((record) => record.applied);
  const failedRecords = records.filter((record) => record.failed);
  const staleRecords = records.filter((record) => record.stale && !record.applied);
  const inFlightRecords = records.filter((record) => record.inFlight && !record.stale);
  const unknownRecords = records.filter((record) => record.restartSafeStatus === 'unknown_requires_review');
  const replayableRecords = inFlightRecords.filter((record) => !failedRecords.some((failed) => failed.idempotencyKey === record.idempotencyKey));
  const status = staleRecords.length > 0 || failedRecords.length > 0 || unknownRecords.length > 0
    ? 'recovery_review_required'
    : inFlightRecords.length > 0
      ? 'resume_in_flight'
      : appliedRecords.length > 0
        ? 'stable_with_history'
        : 'empty';
  const blockedReasons = [
    ...(staleRecords.length > 0 ? ['stale_in_flight_commands'] : []),
    ...(failedRecords.length > 0 ? ['failed_persisted_commands'] : []),
    ...(unknownRecords.length > 0 ? ['unknown_persisted_command_status'] : [])
  ];

  return {
    contract: 'hosted-kernel-job-graph-command-recovery.v1',
    requestId: requestState.requestId,
    generatedAt: now,
    status,
    restartSafe: blockedReasons.length === 0,
    replayAllowed: blockedReasons.length === 0,
    records,
    appliedCommandIds: appliedRecords.map((record) => record.commandId),
    inFlightCommandIds: inFlightRecords.map((record) => record.commandId),
    staleCommandIds: staleRecords.map((record) => record.commandId),
    failedCommandIds: failedRecords.map((record) => record.commandId),
    unknownCommandIds: unknownRecords.map((record) => record.commandId),
    blockedReasons,
    replayQueue: replayableRecords.map((record) => ({
      commandId: record.commandId,
      idempotencyKey: record.idempotencyKey,
      kind: record.kind,
      targetId: record.targetId,
      dispatchStatus: record.status,
      restartSafeStatus: record.restartSafeStatus,
      replayable: true
    })),
    claims: {
      commandCount: records.length,
      appliedCount: appliedRecords.length,
      inFlightCount: inFlightRecords.length,
      staleCount: staleRecords.length,
      failedCount: failedRecords.length,
      unknownCount: unknownRecords.length,
      oldestInFlightAt: inFlightRecords[0]?.createdAt || inFlightRecords[0]?.dispatchedAt || null
    }
  };
}

function normalizePersistedSnapshot(raw, index) {
  const routeState = raw?.routeState || {};
  const query = routeState.query || raw?.query || {};
  const totals = raw?.totals || raw?.preview?.totals || {};
  const savedAt = normalizeTimestamp(raw?.savedAt, raw?.capturedAt, raw?.generatedAt, raw?.updatedAt, raw?.timestamp);
  const commandIds = normalizeCommandIdList(raw?.commandIds || raw?.commands || raw?.commandLog);

  return {
    contract: 'hosted-kernel-job-graph-persisted-snapshot.v1',
    snapshotId: firstString(raw?.snapshotId, raw?.id, `persisted-snapshot-${index + 1}`),
    fingerprint: firstString(raw?.fingerprint, raw?.graphFingerprint),
    savedAt,
    selectedJobId: firstString(raw?.selectedJobId, query.selectedJobId, raw?.focusJobId),
    mode: firstString(raw?.mode, query.mode),
    requestId: firstString(raw?.requestId, query.requestId),
    restartStatus: firstString(raw?.restartStatus, raw?.status, 'unknown'),
    readinessLevel: firstString(raw?.readinessLevel, raw?.readiness?.level, 'unknown'),
    valid: raw?.valid === undefined ? null : normalizeBoolean(raw.valid, false),
    totals: {
      jobs: normalizeInteger(totals.jobs ?? totals.visibleJobs ?? raw?.visibleJobs, 0),
      dependencies: normalizeInteger(totals.dependencies ?? totals.visibleDependencies ?? raw?.visibleDependencies, 0),
      blocked: normalizeInteger(totals.blocked ?? totals.blockedJobs ?? raw?.blockedJobs, 0),
      failed: normalizeInteger(totals.failed ?? totals.failedJobs ?? raw?.failedJobs, 0),
      proofBacked: normalizeInteger(totals.proofBacked ?? totals.proofBackedJobs ?? raw?.proofBackedJobs, 0)
    },
    commandIds
  };
}

function collectPersistedSnapshots(input, persisted) {
  const runtime = input.clientRuntime || {};
  const currentSnapshotLike = persisted.snapshotId || persisted.fingerprint || persisted.graphFingerprint
    ? [persisted]
    : [];
  return [
    ...currentSnapshotLike,
    ...asArray(persisted.snapshots || persisted.snapshotLedger || persisted.recoveryLog),
    ...asArray(runtime.persistedSnapshots || runtime.snapshotLedger),
    ...asArray(input.persistedSnapshots || input.snapshotLedger)
  ]
    .map(normalizePersistedSnapshot)
    .filter((snapshot) => snapshot.snapshotId || snapshot.fingerprint || snapshot.selectedJobId)
    .sort((left, right) => firstString(left.savedAt).localeCompare(firstString(right.savedAt)));
}

function classifyRestartRecovery({ validation, readiness, persistedGraphChanged, recoveredFromPersistedSelection, stalePersistedSelection, matchingSnapshot, latestSnapshot }) {
  const reasons = [];

  if (!validation.valid) reasons.push('validation_failed');
  if (!latestSnapshot) reasons.push('no_prior_snapshot');
  if (persistedGraphChanged) reasons.push('fingerprint_changed');
  if (stalePersistedSelection) reasons.push('selected_job_missing');
  if (recoveredFromPersistedSelection) reasons.push('selection_restored');
  if (matchingSnapshot?.valid === false) reasons.push('matching_snapshot_marked_invalid');
  if (readiness.ready) reasons.push('readiness_ready');

  const status = !validation.valid || matchingSnapshot?.valid === false
    ? 'restart_blocked_requires_repair'
    : stalePersistedSelection
      ? 'restart_recovered_with_focus_clear'
      : persistedGraphChanged
        ? 'restart_recovered_graph_drift'
        : recoveredFromPersistedSelection
          ? 'restart_recovered_selection'
          : latestSnapshot
            ? 'restart_stable'
            : 'restart_initialized';

  return {
    contract: 'hosted-kernel-job-graph-restart-recovery.v1',
    status,
    reasons,
    latestSnapshotId: latestSnapshot?.snapshotId || null,
    matchingSnapshotId: matchingSnapshot?.snapshotId || null,
    operatorReviewRequired: status !== 'restart_stable' && status !== 'restart_recovered_selection',
    replayMode: status === 'restart_blocked_requires_repair'
      ? 'hold_commands'
      : persistedGraphChanged || stalePersistedSelection
        ? 'reconcile_before_replay'
        : 'idempotent_replay_allowed'
  };
}

function buildStateFingerprint(graph, requestState) {
  const nodePart = graph.nodes
    .map((node) => `${node.id}:${node.status}:${node.proofCount}:${node.blockers.length}`)
    .sort()
    .join('|');
  const edgePart = graph.edges
    .map((edge) => `${edge.from}>${edge.to}:${edge.relation}`)
    .sort()
    .join('|');
  const integrityPart = [
    graph.integrity.status,
    graph.integrity.malformedDependencyCount,
    graph.integrity.danglingDependencyCount,
    graph.integrity.duplicateVisibleJobIdCount,
    graph.integrity.duplicateVisibleDependencyIdCount,
    ...graph.integrity.structuralIssueCodes
  ].join(':');
  return `${surfaceId}|${requestState.requestId}|${nodePart}|${edgePart}|${integrityPart}`;
}

function commandEnvelope(kind, requestState, payload, history) {
  const commandId = `${surfaceId}:${requestState.requestId}:${kind}:${payload.jobId || payload.snapshotId || 'graph'}`;
  const alreadyApplied = history.has(commandId);
  return {
    commandId,
    kind,
    idempotencyKey: commandId,
    alreadyApplied,
    dispatchStatus: alreadyApplied ? 'already_applied' : 'pending_dispatch',
    idempotencyScope: {
      surfaceId,
      requestId: requestState.requestId,
      targetId: payload.jobId || payload.snapshotId || 'graph'
    },
    payload
  };
}

function buildPersistedState(graph, validation, readiness, requestState, now, input, commandRecovery = null) {
  const persisted = input.persistedState || input.savedState || input.clientRuntime?.persistedState || {};
  const history = new Set(normalizeCommandHistory(input));
  const fingerprint = buildStateFingerprint(graph, requestState);
  const savedFingerprint = firstString(persisted.fingerprint, persisted.graphFingerprint);
  const savedSelectedJobId = firstString(persisted.selectedJobId, persisted.routeState?.query?.selectedJobId);
  const savedMode = firstString(persisted.mode, persisted.routeState?.query?.mode);
  const snapshotLedger = collectPersistedSnapshots(input, persisted);
  const latestSnapshot = snapshotLedger[snapshotLedger.length - 1] || null;
  const matchingSnapshot = snapshotLedger
    .slice()
    .reverse()
    .find((snapshot) => snapshot.fingerprint === fingerprint) || null;
  const recoveredFromPersistedSelection =
    !requestState.requestedJobId &&
    Boolean(savedSelectedJobId) &&
    graph.nodes.some((node) => node.id === savedSelectedJobId);
  const stalePersistedSelection =
    Boolean(savedSelectedJobId) &&
    !graph.nodes.some((node) => node.id === savedSelectedJobId);
  const persistedGraphChanged = Boolean(savedFingerprint) && savedFingerprint !== fingerprint;
  const selectedJobId = recoveredFromPersistedSelection ? savedSelectedJobId : requestState.selectedJobId;
  const mode = requestState.requestedJobId ? requestState.mode : firstString(savedMode, requestState.mode);
  const snapshotId = `${surfaceId}:${requestState.requestId}:${fingerprint.length}:${graph.nodes.length}:${graph.edges.length}`;
  const restartStatus = validation.valid
    ? persistedGraphChanged
      ? 'graph_changed_recovered'
      : recoveredFromPersistedSelection
        ? 'selection_recovered'
        : 'stable'
    : 'invalid_requires_repair';
  const restartRecovery = classifyRestartRecovery({
    validation,
    readiness,
    persistedGraphChanged,
    recoveredFromPersistedSelection,
    stalePersistedSelection,
    matchingSnapshot,
    latestSnapshot
  });
  const commands = [
    commandEnvelope('persist_graph_snapshot', requestState, {
      snapshotId,
      fingerprint,
      selectedJobId,
      mode,
      ready: readiness.ready
    }, history)
  ];

  if (selectedJobId && selectedJobId !== requestState.selectedJobId) {
    commands.push(commandEnvelope('restore_job_focus', requestState, {
      jobId: selectedJobId,
      mode,
      source: 'persisted_state'
    }, history));
  }

  if (stalePersistedSelection) {
    commands.push(commandEnvelope('clear_stale_job_focus', requestState, {
      jobId: savedSelectedJobId,
      replacementJobId: requestState.selectedJobId,
      source: 'missing_after_restart'
    }, history));
  }

  const recoveryLedgerEntry = {
    contract: 'hosted-kernel-job-graph-recovery-ledger-entry.v1',
    snapshotId,
    fingerprint,
    savedAt: now,
    selectedJobId,
    mode,
    restartStatus: restartRecovery.status,
    readinessLevel: readiness.level,
    valid: validation.valid,
    totals: {
      jobs: graph.nodes.length,
      dependencies: graph.edges.length,
      blocked: graph.blockedNodes.length,
      failed: graph.nodes.filter((node) => node.isFailure).length,
      proofBacked: graph.proofBackedNodes.length
    },
    commandIds: commands.map((command) => command.commandId)
  };

  return {
    contract: 'hosted-kernel-job-graph-persisted-state.v1',
    snapshotId,
    fingerprint,
    savedFingerprint: savedFingerprint || null,
    persistedGraphChanged,
    restartStatus,
    restartRecovery,
    selectedJobId,
    mode,
    recovered: {
      selectedJobId: recoveredFromPersistedSelection,
      clearedStaleSelection: stalePersistedSelection,
      fallbackSelectedJobId: requestState.selectedJobId
    },
    routeState: {
      pathname: '/operator-userland/job-graph-view',
      query: {
        requestId: requestState.requestId,
        selectedJobId,
        mode
      }
    },
    snapshotLedger: [...snapshotLedger.slice(-9), recoveryLedgerEntry],
    recoveryLedgerEntry,
    statusSemantics: {
      canResumeWithoutOperator: validation.valid && !stalePersistedSelection && (commandRecovery?.restartSafe ?? true),
      safeToReplayCommands:
        commands.every((command) => command.commandId === command.idempotencyKey) &&
        (commandRecovery?.replayAllowed ?? true),
      acceptanceMayBeSubmitted: readiness.ready && !persistedGraphChanged && (commandRecovery?.restartSafe ?? true),
      replayMode: commandRecovery && !commandRecovery.replayAllowed ? 'hold_commands' : restartRecovery.replayMode,
      operatorReviewRequired: restartRecovery.operatorReviewRequired || Boolean(commandRecovery && !commandRecovery.restartSafe),
      stableSnapshotMatched: Boolean(matchingSnapshot),
      latestSnapshotId: latestSnapshot?.snapshotId || null,
      commandRecoveryStatus: commandRecovery?.status || 'not_evaluated'
    },
    commandRecovery,
    commands,
    replayQueue: [
      ...(commandRecovery?.replayQueue || []),
      ...commands.map((command) => ({
        commandId: command.commandId,
        kind: command.kind,
        idempotencyKey: command.idempotencyKey,
        dispatchStatus: command.dispatchStatus,
        replayable:
          restartRecovery.replayMode === 'idempotent_replay_allowed' &&
          !command.alreadyApplied &&
          (commandRecovery?.replayAllowed ?? true),
        blockedReason: command.alreadyApplied
          ? 'already_applied'
          : commandRecovery && !commandRecovery.replayAllowed
            ? commandRecovery.status
            : restartRecovery.replayMode === 'idempotent_replay_allowed'
              ? null
              : restartRecovery.replayMode
      }))
    ],
    savedAt: now
  };
}

function summarizeValidation(graph) {
  const issues = [];
  const scopePolicy = graph.boundary.scopePolicy;

  if (graph.nodes.length === 0) {
    issues.push({
      code: 'empty_graph',
      severity: 'error',
      message: 'No jobs were supplied for the graph preview.'
    });
  }

  for (const edge of graph.danglingEdges) {
    issues.push({
      code: 'dangling_dependency',
      severity: 'error',
      message: `Dependency ${edge.id} references a missing job.`,
      edgeId: edge.id,
      from: edge.from,
      to: edge.to
    });
  }

  for (const edge of graph.malformedEdges) {
    issues.push({
      code: 'malformed_dependency_endpoint',
      severity: 'error',
      message: `Dependency ${edge.id} is missing a required endpoint.`,
      edgeId: edge.id,
      from: edge.from || null,
      to: edge.to || null,
      relation: edge.relation,
      endpointState: edge.endpointState,
      missingEndpoints: malformedEdgeEvidence(edge).missingEndpoints
    });
  }

  for (const duplicate of graph.integrity.duplicateNodeIds) {
    issues.push({
      code: 'duplicate_visible_job_id',
      severity: 'error',
      message: `Visible job id ${duplicate.value} appears ${duplicate.count} times.`,
      jobId: duplicate.value,
      count: duplicate.count
    });
  }

  for (const duplicate of graph.integrity.duplicateEdgeIds) {
    issues.push({
      code: 'duplicate_visible_dependency_id',
      severity: 'error',
      message: `Visible dependency id ${duplicate.value} appears ${duplicate.count} times.`,
      edgeId: duplicate.value,
      count: duplicate.count
    });
  }

  for (const cycle of graph.topology.cycles) {
    issues.push({
      code: 'cyclic_dependency',
      severity: 'error',
      message: `Dependency cycle detected across ${cycle.jobIds.length - 1} edges.`,
      jobIds: cycle.jobIds,
      edgeCount: cycle.edgeCount
    });
  }

  for (const denied of graph.boundary.deniedNodes) {
    issues.push({
      code: 'job_scope_denied',
      severity: denied.reason === 'insufficient_role' ? 'warning' : 'error',
      message: `Job ${denied.jobId} is outside the current operator boundary.`,
      jobId: denied.jobId,
      reason: denied.reason
    });
  }

  for (const denied of graph.boundary.deniedEdges) {
    issues.push({
      code: 'dependency_scope_denied',
      severity: denied.reason === 'endpoint_out_of_scope' ? 'warning' : 'error',
      message: `Dependency ${denied.edgeId} crosses the current operator boundary.`,
      edgeId: denied.edgeId,
      from: denied.from,
      to: denied.to,
      reason: denied.reason
    });
  }

  for (const reason of scopePolicy.writeBlockedReasons.filter((reason) => reason !== 'accept_permission_missing')) {
    issues.push({
      code: `scope_${reason}`,
      severity: reason.includes('missing') || reason.includes('mixed') ? 'error' : 'warning',
      message: 'The hosted-kernel graph cannot be handed off for scoped writes until tenant and workspace boundaries are explicit.',
      tenantId: scopePolicy.effectiveTenantId,
      workspaceId: scopePolicy.effectiveWorkspaceId,
      missingScope: scopePolicy.missingScope
    });
  }

  for (const node of graph.blockedNodes) {
    issues.push({
      code: 'blocked_job',
      severity: 'warning',
      message: `${node.label} is blocked before acceptance.`,
      jobId: node.id,
      blockers: node.blockers
    });
  }

  for (const node of graph.nodes.filter((entry) => entry.isFailure)) {
    issues.push({
      code: 'failed_job',
      severity: node.failure.retryAttempts >= node.failure.maxRetryAttempts ? 'error' : 'warning',
      message: node.failure.message || `${node.label} reported a failure state.`,
      jobId: node.id,
      failureCode: node.failure.code,
      retryAttempts: node.failure.retryAttempts,
      maxRetryAttempts: node.failure.maxRetryAttempts
    });
  }

  return {
    valid: !issues.some((issue) => issue.severity === 'error'),
    issueCount: issues.length,
    issues
  };
}

function normalizeLifecycleSettings(input) {
  const source = input.lifecycleSettings || input.settings?.lifecycle || input.clientRuntime?.lifecycleSettings || {};
  const minRetryDelayMs = normalizeInteger(source.minRetryDelayMs ?? source.retryDelayMs, 30000);
  const maxScheduledDelayMs = normalizeInteger(source.maxScheduledDelayMs ?? source.maxDelayMs, 86400000);
  const rawRequestedDelayMs = source.requestedDelayMs ?? source.scheduleDelayMs ?? input.request?.scheduleDelayMs;
  const requestedDelayMs = rawRequestedDelayMs === undefined ? null : normalizeInteger(rawRequestedDelayMs, 0);
  const scheduleMode = firstString(source.scheduleMode, source.mode, 'bounded_backoff').toLowerCase();
  const commandTtlMs = normalizeInteger(source.commandTtlMs ?? source.dispatchTtlMs, 300000);
  const defaultReason = firstString(source.defaultReason, source.reason, input.request?.reason, 'operator_lifecycle_command');
  const invalid = [];

  if (maxScheduledDelayMs < minRetryDelayMs) {
    invalid.push({
      code: 'schedule_window_inverted',
      severity: 'error',
      message: 'Lifecycle scheduling requires maxScheduledDelayMs to be greater than or equal to minRetryDelayMs.'
    });
  }

  if (requestedDelayMs !== null && requestedDelayMs > maxScheduledDelayMs) {
    invalid.push({
      code: 'requested_delay_exceeds_policy',
      severity: 'error',
      message: 'The requested lifecycle schedule delay exceeds the hosted-kernel policy window.',
      requestedDelayMs,
      maxScheduledDelayMs
    });
  }

  if (!LIFECYCLE_SCHEDULE_MODES.has(scheduleMode)) {
    invalid.push({
      code: 'unsupported_schedule_mode',
      severity: 'error',
      message: 'Lifecycle scheduling mode is not supported for hosted-kernel dispatch.',
      scheduleMode,
      supportedModes: Array.from(LIFECYCLE_SCHEDULE_MODES)
    });
  }

  if (commandTtlMs < 1000) {
    invalid.push({
      code: 'command_ttl_too_short',
      severity: 'error',
      message: 'Lifecycle command dispatch requires a commandTtlMs of at least 1000ms.',
      commandTtlMs
    });
  }

  return {
    contract: 'hosted-kernel-job-graph-lifecycle-settings.v1',
    controlsEnabled: normalizeBoolean(source.controlsEnabled ?? source.enabled, true),
    allowDisableTerminalJobs: normalizeBoolean(source.allowDisableTerminalJobs, false),
    allowCancelRunningJobs: normalizeBoolean(source.allowCancelRunningJobs, true),
    requireProofForEnable: normalizeBoolean(source.requireProofForEnable, true),
    dryRun: normalizeBoolean(source.dryRun ?? source.previewOnly, false),
    scheduleMode,
    minRetryDelayMs,
    maxScheduledDelayMs,
    requestedDelayMs,
    commandTtlMs,
    defaultReason,
    invalid
  };
}

function normalizeLifecycleActionRequest(input, selectedJob, settings) {
  const source =
    input.lifecycleCommand ||
    input.lifecycleAction ||
    input.request?.lifecycleCommand ||
    input.request?.lifecycleAction ||
    input.clientRuntime?.pendingLifecycleAction ||
    {};
  const rawKind = firstString(source.kind, source.action, source.commandKind, input.request?.action).toLowerCase();
  const kind = rawKind === 'retry_job' ? 'schedule_retry' : rawKind;
  const targetJobId = firstString(source.jobId, source.targetJobId, input.request?.targetJobId, selectedJob?.id);
  const requestedDelayMs = source.requestedDelayMs === undefined
    ? settings.requestedDelayMs
    : normalizeInteger(source.requestedDelayMs, settings.requestedDelayMs ?? settings.minRetryDelayMs);
  const problems = [];

  if (rawKind && !LIFECYCLE_CONTROL_KINDS.has(kind)) {
    problems.push({
      code: 'unsupported_lifecycle_action',
      severity: 'error',
      message: 'Requested lifecycle action is not exposed by the hosted-kernel job graph controls.',
      requestedKind: rawKind,
      supportedKinds: Array.from(LIFECYCLE_CONTROL_KINDS)
    });
  }

  if (targetJobId && selectedJob && targetJobId !== selectedJob.id) {
    problems.push({
      code: 'lifecycle_action_target_mismatch',
      severity: 'error',
      message: 'Requested lifecycle action targets a job outside the current selected-job dispatch context.',
      requestedJobId: targetJobId,
      selectedJobId: selectedJob.id
    });
  }

  if (requestedDelayMs !== null && requestedDelayMs > settings.maxScheduledDelayMs) {
    problems.push({
      code: 'lifecycle_action_delay_exceeds_policy',
      severity: 'error',
      message: 'Requested lifecycle action delay exceeds the configured hosted-kernel schedule window.',
      requestedDelayMs,
      maxScheduledDelayMs: settings.maxScheduledDelayMs
    });
  }

  return {
    contract: 'hosted-kernel-job-graph-lifecycle-action-request.v1',
    requested: Boolean(rawKind || source.jobId || source.targetJobId),
    kind: LIFECYCLE_CONTROL_KINDS.has(kind) ? kind : null,
    rawKind: rawKind || null,
    targetJobId: targetJobId || null,
    requestedDelayMs,
    reason: firstString(source.reason, source.message, settings.defaultReason),
    source: firstString(source.source, input.request?.source, 'operator-client'),
    problems
  };
}

function summarizeLifecycleSettings(settings) {
  const errorCodes = settings.invalid
    .filter((issue) => issue.severity === 'error')
    .map((issue) => issue.code);
  const warningCodes = settings.invalid
    .filter((issue) => issue.severity === 'warning')
    .map((issue) => issue.code);
  const controlsBlockedReasons = [
    ...errorCodes,
    ...(!settings.controlsEnabled ? ['controls_disabled_by_settings'] : []),
    ...(settings.scheduleMode === 'paused' ? ['retry_scheduling_paused'] : [])
  ];

  return {
    contract: 'hosted-kernel-job-graph-lifecycle-settings-validation.v1',
    valid: errorCodes.length === 0,
    status: errorCodes.length > 0
      ? 'invalid'
      : settings.controlsEnabled
        ? 'active'
        : 'controls_disabled',
    controlsEnabled: settings.controlsEnabled,
    scheduleMode: settings.scheduleMode,
    errorCodes,
    warningCodes,
    controlsBlockedReasons,
    proof: {
      minRetryDelayMs: settings.minRetryDelayMs,
      maxScheduledDelayMs: settings.maxScheduledDelayMs,
      requestedDelayMs: settings.requestedDelayMs,
      commandTtlMs: settings.commandTtlMs,
      dryRun: settings.dryRun
    }
  };
}

function buildLifecycleScheduleDecision(settings, actionRequest, retryPlan, now) {
  const nowMs = Date.parse(now);
  const requestedDelayMs = actionRequest.requestedDelayMs ?? settings.requestedDelayMs;
  const retryDelayMs = retryPlan?.backoffSeconds === null || retryPlan?.backoffSeconds === undefined
    ? null
    : retryPlan.backoffSeconds * 1000;
  const baseDelayMs = requestedDelayMs ?? retryDelayMs ?? settings.minRetryDelayMs;
  const normalizedDelayMs = normalizeInteger(baseDelayMs, settings.minRetryDelayMs);
  const issues = [];
  let effectiveDelayMs = normalizedDelayMs;
  let scheduleStatus = 'ready';

  if (settings.scheduleMode === 'paused') {
    scheduleStatus = 'paused';
    issues.push({
      code: 'retry_scheduling_paused',
      severity: 'error',
      message: 'Retry scheduling is paused by lifecycle settings.'
    });
  } else if (settings.scheduleMode === 'immediate') {
    effectiveDelayMs = 0;
  } else if (settings.scheduleMode === 'operator_window') {
    if (requestedDelayMs === null) {
      scheduleStatus = 'blocked';
      issues.push({
        code: 'operator_window_delay_required',
        severity: 'error',
        message: 'Operator-window scheduling requires an explicit requested delay.'
      });
    }
    if (normalizedDelayMs < settings.minRetryDelayMs) {
      scheduleStatus = 'blocked';
      issues.push({
        code: 'operator_window_delay_below_minimum',
        severity: 'error',
        message: 'Operator-window scheduling requires requestedDelayMs to satisfy minRetryDelayMs.',
        requestedDelayMs: normalizedDelayMs,
        minRetryDelayMs: settings.minRetryDelayMs
      });
    }
  } else if (settings.scheduleMode === 'bounded_backoff') {
    effectiveDelayMs = Math.max(settings.minRetryDelayMs, normalizedDelayMs, retryDelayMs || 0);
  }

  if (effectiveDelayMs > settings.maxScheduledDelayMs) {
    scheduleStatus = 'blocked';
    issues.push({
      code: 'effective_delay_exceeds_policy',
      severity: 'error',
      message: 'The effective lifecycle retry delay exceeds the configured schedule window.',
      effectiveDelayMs,
      maxScheduledDelayMs: settings.maxScheduledDelayMs
    });
  }

  const scheduledFor = Number.isFinite(nowMs)
    ? new Date(nowMs + Math.min(effectiveDelayMs, settings.maxScheduledDelayMs) ).toISOString()
    : null;
  const blockingReasons = issues
    .filter((issue) => issue.severity === 'error')
    .map((issue) => issue.code);

  return {
    contract: 'hosted-kernel-job-graph-lifecycle-schedule-decision.v1',
    mode: settings.scheduleMode,
    status: blockingReasons.length > 0 ? scheduleStatus : 'ready',
    requestedDelayMs,
    retryBackoffDelayMs: retryDelayMs,
    effectiveDelayMs,
    minRetryDelayMs: settings.minRetryDelayMs,
    maxScheduledDelayMs: settings.maxScheduledDelayMs,
    scheduledFor,
    issues,
    blockedReasons: blockingReasons,
    claims: {
      boundedByPolicy: effectiveDelayMs <= settings.maxScheduledDelayMs,
      usesRetryBackoff: Boolean(retryDelayMs !== null && effectiveDelayMs >= retryDelayMs),
      explicitOperatorDelay: requestedDelayMs !== null,
      generatedAt: now
    }
  };
}

function buildLifecycleDispatchPlan(controls, actionRequest, requestState, settings, scheduleDecision, now) {
  const selectedControl = controls.find((control) => control.kind === actionRequest.kind) || null;
  const selectedCommand = selectedControl?.command || null;
  const expiresAt = Number.isFinite(Date.parse(now))
    ? new Date(Date.parse(now) + settings.commandTtlMs).toISOString()
    : null;
  const blockedReasons = [
    ...actionRequest.problems.map((problem) => problem.code),
    ...(!actionRequest.requested ? ['no_requested_action'] : []),
    ...(actionRequest.requested && !selectedControl ? ['action_not_available'] : []),
    ...(selectedControl && !selectedControl.enabled ? [selectedControl.disabledReason || 'control_disabled'] : []),
    ...(actionRequest.kind === 'schedule_retry' ? scheduleDecision.blockedReasons : [])
  ];
  const dispatchable = actionRequest.requested && blockedReasons.length === 0 && Boolean(selectedCommand);

  return {
    contract: 'hosted-kernel-job-graph-lifecycle-dispatch-plan.v1',
    requestedAction: actionRequest,
    status: dispatchable
      ? settings.dryRun
        ? 'preview_ready'
        : 'dispatch_ready'
      : actionRequest.requested
        ? 'blocked'
        : 'idle',
    dispatchable,
    dryRun: settings.dryRun,
    selectedCommandId: dispatchable ? selectedCommand.commandId : null,
    idempotencyKey: dispatchable ? selectedCommand.idempotencyKey : null,
    expiresAt,
    scheduledFor: selectedCommand?.payload?.retryAfter || selectedCommand?.payload?.scheduledFor || scheduleDecision.scheduledFor,
    scheduleDecision,
    route: {
      pathname: '/operator-userland/job-graph-view',
      query: {
        requestId: requestState.requestId,
        selectedJobId: actionRequest.targetJobId,
        lifecycleAction: actionRequest.kind || actionRequest.rawKind || 'inspect'
      }
    },
    blockedReasons,
    proof: {
      generatedAt: now,
      commandTtlMs: settings.commandTtlMs,
      controlEnabled: Boolean(selectedControl?.enabled),
      alreadyApplied: Boolean(selectedCommand?.alreadyApplied),
      reason: actionRequest.reason,
      scheduleStatus: scheduleDecision.status
    }
  };
}

function transitionBlockedReasons(kind, selectedJob, settings, retryPlan, lifecycleWritable, scheduleDecision) {
  const reasons = [];
  const writeTransition = kind !== 'focus_job';

  if (!selectedJob) reasons.push('selected_job_missing');
  if (writeTransition && !settings.controlsEnabled) reasons.push('controls_disabled_by_settings');
  if (writeTransition && !lifecycleWritable) reasons.push('lifecycle_write_gate_blocked');
  if (settings.scheduleMode === 'paused' && kind === 'schedule_retry') reasons.push('retry_scheduling_paused');

  if (selectedJob) {
    if (kind === 'disable_job' && !selectedJob.lifecycle.enabled) reasons.push('job_already_disabled');
    if (kind === 'disable_job' && selectedJob.isTerminal && !settings.allowDisableTerminalJobs) reasons.push('terminal_disable_blocked');
    if (kind === 'enable_job' && selectedJob.lifecycle.enabled) reasons.push('job_already_enabled');
    if (
      kind === 'enable_job' &&
      settings.requireProofForEnable &&
      selectedJob.lifecycle.enableRequiresProof &&
      selectedJob.isTerminal &&
      selectedJob.proofCount === 0
    ) {
      reasons.push('enable_requires_proof');
    }
    if (kind === 'schedule_retry' && !retryPlan?.retryable) {
      reasons.push(retryPlan?.exhausted ? 'retry_attempts_exhausted' : 'job_not_retryable');
    }
    if (kind === 'schedule_retry') reasons.push(...scheduleDecision.blockedReasons);
    if (kind === 'cancel_job' && !selectedJob.isActive) reasons.push('job_not_active');
    if (kind === 'cancel_job' && !settings.allowCancelRunningJobs) reasons.push('cancel_disabled_by_settings');
  }

  return Array.from(new Set(reasons));
}

function transitionPatchFor(kind, selectedJob, settings, retryPlan, scheduleDecision, now) {
  if (!selectedJob) return null;
  if (kind === 'disable_job') {
    return {
      lifecycle: {
        enabled: false,
        status: 'disabled',
        reason: 'operator_requested_disable',
        disabledAt: now,
        updatedAt: now
      }
    };
  }
  if (kind === 'enable_job') {
    return {
      lifecycle: {
        enabled: true,
        status: 'enabled',
        reason: 'operator_requested_enable',
        disabledAt: null,
        updatedAt: now
      }
    };
  }
  if (kind === 'schedule_retry') {
    return {
      lifecycle: {
        ...selectedJob.lifecycle,
        scheduledFor: retryPlan?.nextRetryAt || scheduleDecision.scheduledFor,
        updatedAt: now
      },
      failure: {
        ...selectedJob.failure,
        retryAfter: retryPlan?.nextRetryAt || scheduleDecision.scheduledFor,
        retryAttempts: retryPlan?.attempts ?? selectedJob.failure.retryAttempts
      },
      schedule: {
        mode: settings.scheduleMode,
        requestedDelayMs: settings.requestedDelayMs,
        effectiveDelayMs: scheduleDecision.effectiveDelayMs,
        retryBackoffDelayMs: scheduleDecision.retryBackoffDelayMs,
        minRetryDelayMs: settings.minRetryDelayMs,
        maxScheduledDelayMs: settings.maxScheduledDelayMs,
        status: scheduleDecision.status
      }
    };
  }
  if (kind === 'cancel_job') {
    return {
      status: 'cancelled',
      lifecycle: {
        ...selectedJob.lifecycle,
        updatedAt: now,
        reason: 'operator_cancelled'
      }
    };
  }
  return {
    focus: {
      selectedJobId: selectedJob.id,
      mode: selectedJob.status === 'blocked' ? 'triage' : 'review'
    }
  };
}

function buildLifecycleTransitionState(controls, selectedJob, settings, retryPlan, lifecycleWritable, scheduleDecision, now) {
  const transitions = controls.map((control) => {
    const guardReasons = transitionBlockedReasons(control.kind, selectedJob, settings, retryPlan, lifecycleWritable, scheduleDecision);
    const controlReasons = control.enabled ? [] : [control.disabledReason || 'control_disabled'];
    const blockedReasons = Array.from(new Set([...guardReasons, ...controlReasons].filter(Boolean)));
    const patch = blockedReasons.length === 0 ? transitionPatchFor(control.kind, selectedJob, settings, retryPlan, scheduleDecision, now) : null;

    return {
      contract: 'hosted-kernel-job-lifecycle-transition.v1',
      kind: control.kind,
      targetJobId: selectedJob?.id || null,
      fromStatus: selectedJob?.status || null,
      fromLifecycleStatus: selectedJob?.lifecycle?.status || null,
      enabled: blockedReasons.length === 0 && Boolean(control.command),
      commandId: control.command?.commandId || null,
      blockedReasons,
      statePatch: patch,
      proof: {
        generatedAt: now,
        jobLifecycleEnabled: Boolean(selectedJob?.lifecycle?.enabled),
        jobProofCount: selectedJob?.proofCount || 0,
        retryable: Boolean(retryPlan?.retryable),
        scheduleMode: settings.scheduleMode
      }
    };
  });
  const enabledTransitions = transitions.filter((transition) => transition.enabled);
  const nextTransition = enabledTransitions.find((transition) => transition.kind !== 'focus_job') || enabledTransitions[0] || null;

  return {
    contract: 'hosted-kernel-job-lifecycle-transition-state.v1',
    selectedJobId: selectedJob?.id || null,
    lifecycleStatus: selectedJob?.lifecycle?.status || null,
    schedulePolicy: {
      mode: settings.scheduleMode,
      paused: settings.scheduleMode === 'paused',
      requestedDelayMs: settings.requestedDelayMs,
      effectiveDelayMs: scheduleDecision.effectiveDelayMs,
      retryBackoffDelayMs: scheduleDecision.retryBackoffDelayMs,
      minRetryDelayMs: settings.minRetryDelayMs,
      maxScheduledDelayMs: settings.maxScheduledDelayMs,
      scheduledFor: scheduleDecision.scheduledFor,
      status: scheduleDecision.status,
      blockedReasons: scheduleDecision.blockedReasons
    },
    transitions,
    nextTransition: nextTransition
      ? {
          kind: nextTransition.kind,
          commandId: nextTransition.commandId,
          targetJobId: nextTransition.targetJobId,
          statePatch: nextTransition.statePatch
        }
      : null,
    proof: {
      generatedAt: now,
      transitionCount: transitions.length,
      enabledTransitionKinds: enabledTransitions.map((transition) => transition.kind),
      blockedTransitionKinds: transitions
        .filter((transition) => !transition.enabled)
        .map((transition) => transition.kind)
    }
  };
}

function controlFor(kind, enabled, reason, command) {
  return {
    kind,
    enabled: Boolean(enabled),
    disabledReason: enabled ? null : reason,
    command: enabled && command ? command : null
  };
}

function buildLifecycleControls(graph, validation, readiness, requestState, operationalHealth, now, input) {
  const settings = normalizeLifecycleSettings(input);
  const settingsValidation = summarizeLifecycleSettings(settings);
  const selectedJob = graph.nodes.find((node) => node.id === requestState.selectedJobId) || null;
  const history = new Set(normalizeCommandHistory(input));
  const retryPlan = selectedJob ? retryPlanForNode(selectedJob, now) : null;
  const settingErrors = settings.invalid.filter((issue) => issue.severity === 'error');
  const lifecycleWritable =
    settings.controlsEnabled &&
    settingErrors.length === 0 &&
    validation.valid &&
    graph.boundary.accessContext.canAcceptGraph &&
    graph.boundary.scopePolicy.canWriteScopedGraph &&
    operationalHealth.status !== 'critical';
  const actionRequest = normalizeLifecycleActionRequest(input, selectedJob, settings);
  const scheduleDecision = buildLifecycleScheduleDecision(settings, actionRequest, retryPlan, now);
  const scheduledFor = scheduleDecision.scheduledFor;
  const lifecycleBlockedReasons = Array.from(new Set([
    ...settingsValidation.controlsBlockedReasons,
    ...(!validation.valid ? ['validation_failed'] : []),
    ...(!graph.boundary.accessContext.canAcceptGraph ? ['permission_denied'] : []),
    ...(!graph.boundary.scopePolicy.canWriteScopedGraph ? graph.boundary.scopePolicy.writeBlockedReasons : []),
    ...(operationalHealth.status === 'critical' ? ['critical_operational_health'] : [])
  ]));
  const basePayload = {
    requestId: requestState.requestId,
    jobId: selectedJob?.id || null,
    scheduleMode: settings.scheduleMode,
    scheduledFor,
    lifecyclePolicy: {
      settingsStatus: settingsValidation.status,
      scheduleStatus: scheduleDecision.status,
      effectiveDelayMs: scheduleDecision.effectiveDelayMs,
      commandTtlMs: settings.commandTtlMs
    }
  };
  const controls = [
    controlFor(
      'focus_job',
      Boolean(selectedJob),
      'No visible job is selected.',
      selectedJob && commandEnvelope('focus_lifecycle_job', requestState, { ...basePayload, jobId: selectedJob.id }, history)
    ),
    controlFor(
      'disable_job',
      lifecycleWritable && Boolean(selectedJob) && selectedJob.lifecycle.enabled && (!selectedJob.isTerminal || settings.allowDisableTerminalJobs),
      !selectedJob
        ? 'No visible job is selected.'
        : !selectedJob.lifecycle.enabled
          ? 'The selected job is already disabled in hosted-kernel lifecycle state.'
        : selectedJob.isTerminal && !settings.allowDisableTerminalJobs
          ? 'Terminal jobs are protected from disable controls by lifecycle settings.'
          : 'Lifecycle controls are disabled until validation, permissions, and hosted-kernel health pass.',
      selectedJob && commandEnvelope('disable_lifecycle_job', requestState, { ...basePayload, reason: 'operator_requested_disable' }, history)
    ),
    controlFor(
      'enable_job',
      lifecycleWritable &&
        Boolean(selectedJob) &&
        !selectedJob.lifecycle.enabled &&
        (!settings.requireProofForEnable || selectedJob.proofCount > 0 || !selectedJob.isTerminal),
      selectedJob?.lifecycle.enabled
        ? 'The selected job is already enabled in hosted-kernel lifecycle state.'
        : selectedJob && settings.requireProofForEnable && selectedJob.isTerminal && selectedJob.proofCount === 0
        ? 'Proof is required before re-enabling a terminal lifecycle job.'
        : 'Lifecycle controls are disabled until validation, permissions, and hosted-kernel health pass.',
      selectedJob && commandEnvelope('enable_lifecycle_job', requestState, { ...basePayload, reason: 'operator_requested_enable' }, history)
    ),
    controlFor(
      'schedule_retry',
      lifecycleWritable && scheduleDecision.blockedReasons.length === 0 && Boolean(retryPlan?.retryable),
      settings.scheduleMode === 'paused'
        ? 'Retry scheduling is paused by lifecycle settings.'
        : scheduleDecision.blockedReasons.length > 0
        ? 'Retry scheduling is blocked by lifecycle schedule policy.'
        : retryPlan?.exhausted
        ? 'Retry attempts are exhausted for this job.'
        : 'Only retryable failed jobs without blockers can be scheduled.',
      selectedJob && commandEnvelope('schedule_lifecycle_retry', requestState, {
        ...basePayload,
        retryAfter: retryPlan?.nextRetryAt || scheduledFor,
        attempts: retryPlan?.attempts ?? 0,
        maxAttempts: retryPlan?.maxAttempts ?? 0,
        scheduleDecision: {
          mode: scheduleDecision.mode,
          status: scheduleDecision.status,
          requestedDelayMs: scheduleDecision.requestedDelayMs,
          retryBackoffDelayMs: scheduleDecision.retryBackoffDelayMs,
          effectiveDelayMs: scheduleDecision.effectiveDelayMs,
          blockedReasons: scheduleDecision.blockedReasons
        }
      }, history)
    ),
    controlFor(
      'cancel_job',
      lifecycleWritable && Boolean(selectedJob?.isActive) && settings.allowCancelRunningJobs,
      selectedJob?.isActive && !settings.allowCancelRunningJobs
        ? 'Cancel controls are disabled by lifecycle settings.'
        : 'Only active jobs can be cancelled from the lifecycle toolbar.',
      selectedJob && commandEnvelope('cancel_lifecycle_job', requestState, { ...basePayload, reason: 'operator_cancelled' }, history)
    )
  ];
  const nextControl = controls.find((control) => control.enabled && control.kind !== 'focus_job') || controls.find((control) => control.enabled) || null;
  const dispatchPlan = buildLifecycleDispatchPlan(controls, actionRequest, requestState, settings, scheduleDecision, now);
  const transitionState = buildLifecycleTransitionState(
    controls,
    selectedJob,
    settings,
    retryPlan,
    lifecycleWritable,
    scheduleDecision,
    now
  );

  return {
    contract: 'hosted-kernel-job-graph-lifecycle-controls.v1',
    settings,
    settingsValidation,
    selectedJobId: selectedJob?.id || null,
    writable: lifecycleWritable,
    blockedReasons: lifecycleBlockedReasons,
    controls,
    commands: controls.map((control) => control.command).filter(Boolean),
    dispatchPlan,
    transitionState,
    scheduleDecision,
    nextAction: nextControl
      ? {
          kind: nextControl.kind,
          jobId: nextControl.command?.payload?.jobId || selectedJob?.id || null,
          enabled: nextControl.enabled,
          scheduledFor: nextControl.command?.payload?.retryAfter || nextControl.command?.payload?.scheduledFor || null,
          scheduleStatus: scheduleDecision.status,
          effectiveDelayMs: nextControl.kind === 'schedule_retry' ? scheduleDecision.effectiveDelayMs : null,
          dispatchStatus: dispatchPlan.status,
          statePatch: transitionState.nextTransition?.kind === nextControl.kind ? transitionState.nextTransition.statePatch : null
        }
      : {
          kind: 'inspect_lifecycle_blockers',
          jobId: selectedJob?.id || null,
          enabled: false,
          scheduledFor: null,
          scheduleStatus: scheduleDecision.status,
          effectiveDelayMs: null,
          dispatchStatus: dispatchPlan.status,
          statePatch: null
        },
    proof: {
      generatedAt: now,
      selectedJobStatus: selectedJob?.status || null,
      selectedJobLifecycleStatus: selectedJob?.lifecycle?.status || null,
      selectedJobProofCount: selectedJob?.proofCount || 0,
      retryable: Boolean(retryPlan?.retryable),
      requestedActionKind: actionRequest.kind,
      dispatchPlanStatus: dispatchPlan.status,
      transitionStateContract: transitionState.contract,
      settingsValidationStatus: settingsValidation.status,
      scheduleDecisionStatus: scheduleDecision.status,
      alreadyAppliedCommandIds: controls
        .map((control) => control.command)
        .filter((command) => command?.alreadyApplied)
        .map((command) => command.commandId)
    }
  };
}

function buildScopedMutationAuthorization(graph, validation, readiness, requestState, operationalHealth, providerContracts, lifecycleControls, acceptance, now) {
  const accessContext = graph.boundary.accessContext;
  const scopePolicy = graph.boundary.scopePolicy;
  const visibleJobIds = new Set(graph.nodes.map((node) => node.id));
  const selectedJob = graph.nodes.find((node) => node.id === requestState.selectedJobId) || null;
  const providerHandoff = providerContracts.externalHandoff;
  const baseBlockedReasons = [
    ...(!validation.valid ? ['validation_failed'] : []),
    ...(!scopePolicy.canWriteScopedGraph ? scopePolicy.writeBlockedReasons : []),
    ...(!accessContext.canAcceptGraph ? ['accept_permission_missing'] : []),
    ...(operationalHealth.readOnly ? ['operational_health_read_only'] : []),
    ...(!providerContracts.negotiation.negotiable ? [`provider_${providerContracts.negotiation.status}`] : [])
  ];

  function decision({ kind, requested, targetJobId, commandId, providerRequired = true, proofRequired = false, readinessRequired = false }) {
    const jobTargetRequired = Boolean(targetJobId);
    const targetOutOfScope = jobTargetRequired && !visibleJobIds.has(targetJobId);
    const target = targetJobId ? graph.nodes.find((node) => node.id === targetJobId) || null : null;
    const targetRoleBlocked = target ? roleRank(target.requiredRole) > accessContext.maxRoleRank : false;
    const targetTenantId = target?.tenantId || scopePolicy.effectiveTenantId;
    const targetWorkspaceId = target?.workspaceId || scopePolicy.effectiveWorkspaceId;
    const targetWriteGrant = workspaceGrantForScope(accessContext, targetTenantId, targetWorkspaceId, { requireWrite: true });
    const targetWorkspaceWriteBlocked = requested && targetWorkspaceId && !accessContext.canWriteAllWorkspaces && !targetWriteGrant;
    const blockedReasons = [
      ...baseBlockedReasons,
      ...(!requested ? ['mutation_not_requested'] : []),
      ...(readinessRequired && !readiness.ready ? ['readiness_not_ready'] : []),
      ...(proofRequired && graph.proofBackedNodes.length === 0 ? ['proof_missing'] : []),
      ...(providerRequired && providerHandoff.status !== 'handoff_ready' ? ['provider_handoff_blocked'] : []),
      ...(targetOutOfScope ? ['target_job_not_visible_in_scope'] : []),
      ...(targetRoleBlocked ? ['target_job_role_denied'] : []),
      ...(targetWorkspaceWriteBlocked ? ['target_workspace_write_grant_missing'] : [])
    ];
    const allowed = requested && blockedReasons.length === 0;

    return {
      contract: 'hosted-kernel-job-graph-mutation-decision.v1',
      kind,
      requested: Boolean(requested),
      allowed,
      status: allowed ? 'authorized' : requested ? 'blocked' : 'idle',
      commandId: commandId || null,
      targetJobId: targetJobId || null,
      targetTenantId,
      targetWorkspaceId,
      providerId: providerContracts.selectedProviderId,
      blockedReasons: Array.from(new Set(blockedReasons)).sort(),
      claims: {
        principalId: accessContext.principalId,
        tenantId: scopePolicy.effectiveTenantId,
        workspaceId: scopePolicy.effectiveWorkspaceId,
        targetTenantId,
        targetWorkspaceId,
        roles: accessContext.roles,
        writePermissions: accessContext.writePermissions,
        workspaceGrantId: targetWriteGrant?.grantId || scopePolicy.workspaceGrant.matchedWriteGrantId,
        commandSink: providerHandoff.commandSink,
        correlationId: providerHandoff.correlationId
      }
    };
  }

  const lifecycleAction = lifecycleControls.dispatchPlan.requestedAction;
  const decisions = [
    decision({
      kind: 'accept_graph_preview',
      requested: acceptance.accepted,
      targetJobId: selectedJob?.id || null,
      commandId: acceptance.acceptToken,
      proofRequired: true,
      readinessRequired: true
    }),
    decision({
      kind: 'dispatch_workflow_handoff',
      requested: readiness.ready || lifecycleControls.dispatchPlan.dispatchable,
      targetJobId: selectedJob?.id || null,
      commandId: providerHandoff.correlationId,
      proofRequired: readiness.ready
    }),
    decision({
      kind: lifecycleAction.kind || lifecycleAction.rawKind || 'lifecycle_action',
      requested: lifecycleAction.requested,
      targetJobId: lifecycleAction.targetJobId,
      commandId: lifecycleControls.dispatchPlan.selectedCommandId,
      providerRequired: true
    })
  ];
  const requestedDecisions = decisions.filter((entry) => entry.requested);
  const blockedRequestedDecisions = requestedDecisions.filter((entry) => !entry.allowed);
  const authorizationId = `${surfaceId}:${requestState.requestId}:mutation-auth:${requestedDecisions.length}:${blockedRequestedDecisions.length}`;

  return {
    contract: 'hosted-kernel-job-graph-scoped-mutation-authorization.v1',
    authorizationId,
    generatedAt: now,
    status: blockedRequestedDecisions.length > 0
      ? 'blocked'
      : requestedDecisions.length > 0
        ? 'authorized'
        : 'idle',
    allowsExternalHandoff: blockedRequestedDecisions.length === 0 && requestedDecisions.length > 0,
    allowsAcceptance: decisions.find((entry) => entry.kind === 'accept_graph_preview')?.allowed || false,
    allowsLifecycleDispatch: decisions.find((entry) => entry.kind === (lifecycleAction.kind || lifecycleAction.rawKind || 'lifecycle_action'))?.allowed || false,
    decisions,
    blockedReasons: Array.from(new Set(blockedRequestedDecisions.flatMap((entry) => entry.blockedReasons))).sort(),
    auditClaims: {
      principalId: accessContext.principalId,
      tenantId: scopePolicy.effectiveTenantId,
      workspaceId: scopePolicy.effectiveWorkspaceId,
      visibleJobIds: graph.nodes.map((node) => node.id).sort(),
      deniedJobIds: graph.boundary.deniedNodes.map((node) => node.jobId).sort(),
      deniedDependencyIds: graph.boundary.deniedEdges.map((edge) => edge.edgeId).sort(),
      providerId: providerContracts.selectedProviderId,
      providerHandoffStatus: providerHandoff.status,
      workspaceGrant: scopePolicy.workspaceGrant,
      validationValid: validation.valid,
      healthStatus: operationalHealth.status
    }
  };
}

function handoffActionForStatus(status) {
  if (status === 'ready_for_acceptance') return 'submit_acceptance_handoff';
  if (status === 'needs_proof') return 'open_proof_attachment';
  if (status === 'handoff_to_blocker_triage') return 'open_blocker_triage';
  if (status === 'retry_backoff_scheduled') return 'watch_retry_backoff';
  if (status === 'recover_selection') return 'restore_visible_selection';
  if (status === 'blocked_by_provider_contract') return 'refresh_provider_contract';
  if (status === 'blocked_by_permission') return 'request_acceptance_permission';
  if (status === 'blocked_by_scope') return 'bind_tenant_workspace_scope';
  if (status === 'blocked_by_operational_health') return 'open_runtime_repair';
  if (status === 'blocked_by_validation') return 'open_validation_panel';
  return 'inspect_graph_handoff';
}

function normalizeMailchimpWorkflowIntent(input, requestState, providerContracts, mailchimpPreview) {
  const runtime = input.clientRuntime || {};
  const request = input.request || input.clientRequest || {};
  const source =
    runtime.mailchimpWorkflow ||
    runtime.mailchimpHandoff ||
    input.mailchimpWorkflow ||
    input.mailchimpHandoff ||
    request.mailchimpWorkflow ||
    request.mailchimpHandoff ||
    {};
  const handoffMailchimp = providerContracts.externalHandoff.mailchimp || {};
  const previewMailchimp = mailchimpPreview.mailchimp || {};
  const rawAction = firstString(
    source.action,
    source.intent,
    source.kind,
    request.mailchimpAction,
    mailchimpPreview.acceptance.enabled ? 'accept_mailchimp_graph_preview' : 'review_mailchimp_preview'
  ).toLowerCase();
  const actionAliases = new Map([
    ['accept', 'accept_mailchimp_graph_preview'],
    ['handoff', 'dispatch_mailchimp_campaign_handoff'],
    ['dispatch', 'dispatch_mailchimp_campaign_handoff'],
    ['refresh', 'refresh_mailchimp_sync'],
    ['review', 'review_mailchimp_preview']
  ]);
  const action = actionAliases.get(rawAction) || rawAction;
  const audienceId = firstString(source.audienceId, source.listId, previewMailchimp.audienceId, handoffMailchimp.audienceId);
  const campaignId = firstString(source.campaignId, source.externalCampaignId, previewMailchimp.campaignId, handoffMailchimp.campaignId);
  const templateId = firstString(source.templateId, previewMailchimp.templateId, handoffMailchimp.templateId);
  const serverPrefix = firstString(source.serverPrefix, source.datacenter, previewMailchimp.serverPrefix, handoffMailchimp.serverPrefix);
  const segmentIds = normalizeStringList(source.segmentIds || source.segments || source.segmentId).sort();
  const mergeFieldUpdates = asArray(source.mergeFieldUpdates || source.mergeFields || source.mergeFieldWrites)
    .map((entry, index) => ({
      key: firstString(entry?.key, entry?.tag, entry?.name, `MERGE${index + 1}`).toUpperCase(),
      value: firstString(entry?.value, entry?.defaultValue, entry?.text),
      required: normalizeBoolean(entry?.required, false)
    }))
    .filter((entry) => entry.key);
  const requested = normalizeBoolean(
    source.requested ?? source.enabled ?? request.mailchimpRequested,
    action !== 'review_mailchimp_preview'
  );
  const dryRun = normalizeBoolean(source.dryRun ?? source.previewOnly ?? request.dryRun, false);
  const requiresOperatorReview = normalizeBoolean(
    source.requiresOperatorReview ?? source.reviewRequired,
    !mailchimpPreview.enabled
  );
  const unsupportedAction = ![
    'accept_mailchimp_graph_preview',
    'dispatch_mailchimp_campaign_handoff',
    'refresh_mailchimp_sync',
    'review_mailchimp_preview'
  ].includes(action);
  const problems = [
    ...(unsupportedAction ? ['unsupported_mailchimp_workflow_action'] : []),
    ...(audienceId && previewMailchimp.audienceId && audienceId !== previewMailchimp.audienceId ? ['mailchimp_audience_mismatch'] : []),
    ...(campaignId && previewMailchimp.campaignId && campaignId !== previewMailchimp.campaignId ? ['mailchimp_campaign_mismatch'] : []),
    ...(serverPrefix && previewMailchimp.serverPrefix && serverPrefix !== previewMailchimp.serverPrefix ? ['mailchimp_server_prefix_mismatch'] : []),
    ...(mergeFieldUpdates.some((entry) => entry.required && !entry.value) ? ['mailchimp_required_merge_field_value_missing'] : [])
  ];

  return {
    contract: 'mailchimp-job-graph-client-workflow-intent.v1',
    requested,
    action: unsupportedAction ? 'review_mailchimp_preview' : action,
    rawAction: rawAction || null,
    dryRun,
    requiresOperatorReview,
    source: firstString(source.source, requestState.source, 'operator-client'),
    audienceId: audienceId || null,
    campaignId: campaignId || null,
    templateId: templateId || null,
    serverPrefix: serverPrefix || null,
    segmentIds,
    mergeFieldUpdates,
    consent: {
      doubleOptIn: normalizeBoolean(source.doubleOptIn ?? source.requiresDoubleOptIn, previewMailchimp.requiresDoubleOptIn || false),
      consentField: firstString(source.consentField, source.marketingPermissionField, 'marketing_permissions'),
      source: firstString(source.consentSource, source.optInSource, 'operator_workflow')
    },
    problems
  };
}

function buildMailchimpWorkflowHandoff(mailchimpIntent, mailchimpPreview, providerContracts, scopedMutationAuthorization, requestState, workflowHandoff, history) {
  const handoffMailchimp = providerContracts.externalHandoff.mailchimp || null;
  const mailchimpReady = Boolean(mailchimpPreview.enabled && handoffMailchimp);
  const commandSink = handoffMailchimp?.commandSink || providerContracts.externalHandoff.commandSink;
  const handoffId = `${surfaceId}:${requestState.requestId}:mailchimp-workflow:${mailchimpIntent.action}:${mailchimpIntent.campaignId || mailchimpIntent.audienceId || 'unbound'}`;
  const routeQuery = {
    requestId: requestState.requestId,
    selectedJobId: workflowHandoff.targetJobId || requestState.selectedJobId,
    mode: mailchimpIntent.problems.length > 0 || !mailchimpReady ? 'triage' : requestState.mode,
    product: 'mailchimp',
    mailchimpAction: mailchimpIntent.action,
    panel: mailchimpReady ? 'acceptance' : 'provider'
  };
  const blockedReasons = Array.from(new Set([
    ...mailchimpIntent.problems,
    ...(!mailchimpIntent.requested ? ['mailchimp_workflow_not_requested'] : []),
    ...(!mailchimpReady ? mailchimpPreview.acceptance.blockedReasons : []),
    ...(!commandSink ? ['mailchimp_command_sink_missing'] : []),
    ...(!scopedMutationAuthorization.allowsExternalHandoff ? scopedMutationAuthorization.blockedReasons : []),
    ...(mailchimpIntent.requiresOperatorReview && mailchimpIntent.action !== 'review_mailchimp_preview' ? ['mailchimp_operator_review_required'] : [])
  ])).filter(Boolean).sort();
  const dispatchable =
    mailchimpIntent.requested &&
    !mailchimpIntent.dryRun &&
    blockedReasons.length === 0 &&
    ['accept_mailchimp_graph_preview', 'dispatch_mailchimp_campaign_handoff'].includes(mailchimpIntent.action);
  const command = commandEnvelope('dispatch_mailchimp_workflow_handoff', requestState, {
    snapshotId: handoffId,
    jobId: workflowHandoff.targetJobId || requestState.selectedJobId,
    product: 'mailchimp',
    action: mailchimpIntent.action,
    providerId: providerContracts.selectedProviderId,
    commandSink,
    correlationId: providerContracts.externalHandoff.correlationId,
    returnRoute: providerContracts.externalHandoff.returnRoute,
    audienceId: mailchimpIntent.audienceId,
    campaignId: mailchimpIntent.campaignId,
    templateId: mailchimpIntent.templateId,
    serverPrefix: mailchimpIntent.serverPrefix,
    segmentIds: mailchimpIntent.segmentIds,
    mergeFieldUpdates: mailchimpIntent.mergeFieldUpdates,
    consent: mailchimpIntent.consent,
    acceptance: mailchimpPreview.acceptance.payload,
    scopeClaims: mailchimpPreview.acceptance.payload?.scopeClaims || null,
    mutationAuthorizationId: scopedMutationAuthorization.authorizationId
  }, history);

  return {
    contract: 'mailchimp-job-graph-client-workflow-handoff.v1',
    handoffId,
    status: dispatchable
      ? 'dispatch_ready'
      : mailchimpIntent.dryRun
        ? 'preview_only'
        : blockedReasons.length > 0
          ? 'blocked'
          : 'review',
    requested: mailchimpIntent.requested,
    action: mailchimpIntent.action,
    dispatchable,
    dryRun: mailchimpIntent.dryRun,
    route: {
      pathname: '/operator-userland/job-graph-view',
      query: routeQuery
    },
    command: dispatchable
      ? {
          commandId: command.commandId,
          idempotencyKey: command.idempotencyKey,
          alreadyApplied: command.alreadyApplied,
          payload: command.payload
        }
      : null,
    provider: {
      providerId: providerContracts.selectedProviderId,
      commandSink,
      correlationId: providerContracts.externalHandoff.correlationId,
      handoffStatus: providerContracts.externalHandoff.status,
      mailchimpReady,
      externalState: handoffMailchimp?.externalState || null
    },
    target: {
      audienceId: mailchimpIntent.audienceId,
      campaignId: mailchimpIntent.campaignId,
      templateId: mailchimpIntent.templateId,
      serverPrefix: mailchimpIntent.serverPrefix,
      segmentIds: mailchimpIntent.segmentIds
    },
    blockedReasons,
    proof: {
      previewId: mailchimpPreview.previewId,
      previewStatus: mailchimpPreview.status,
      acceptanceEnabled: mailchimpPreview.acceptance.enabled,
      mutationAuthorizationStatus: scopedMutationAuthorization.status,
      mergeFieldUpdateCount: mailchimpIntent.mergeFieldUpdates.length,
      operatorReviewRequired: mailchimpIntent.requiresOperatorReview
    }
  };
}

function buildClientWorkflowHandoff(graph, requestState, operationalHealth, providerContracts, workflowHandoff, scopedMutationAuthorization, mailchimpPreview, input, now) {
  const runtime = input.clientRuntime || {};
  const handoffState = runtime.workflowHandoff || input.workflowHandoffState || input.handoffState || {};
  const history = new Set(normalizeCommandHistory(input));
  const completedHandoffs = new Set(normalizeStringList(handoffState.completedIds || handoffState.completedHandoffs));
  const dismissedHandoffs = new Set(normalizeStringList(handoffState.dismissedIds || handoffState.dismissedHandoffs));
  const selectedJob = graph.nodes.find((node) => node.id === requestState.selectedJobId) || null;
  const providerHandoff = providerContracts.externalHandoff;
  const action = handoffActionForStatus(workflowHandoff.status);
  const handoffId = `${surfaceId}:${requestState.requestId}:handoff:${workflowHandoff.status}:${workflowHandoff.targetJobId || 'graph'}`;
  const alreadyCompleted = completedHandoffs.has(handoffId);
  const dismissed = dismissedHandoffs.has(handoffId);
  const dispatchable =
    providerHandoff.status === 'handoff_ready' &&
    scopedMutationAuthorization.allowsExternalHandoff &&
    ['ready_for_acceptance', 'handoff_to_blocker_triage', 'retry_backoff_scheduled'].includes(workflowHandoff.status) &&
    !operationalHealth.readOnly;
  const routeQuery = {
    requestId: requestState.requestId,
    selectedJobId: workflowHandoff.targetJobId || requestState.selectedJobId,
    mode: workflowHandoff.status === 'handoff_to_blocker_triage' ? 'triage' : requestState.mode,
    handoff: workflowHandoff.status
  };
  const mailchimpIntent = normalizeMailchimpWorkflowIntent(input, requestState, providerContracts, mailchimpPreview);
  const mailchimpWorkflow = buildMailchimpWorkflowHandoff(
    mailchimpIntent,
    mailchimpPreview,
    providerContracts,
    scopedMutationAuthorization,
    requestState,
    workflowHandoff,
    history
  );
  const dispatchCommand = commandEnvelope('dispatch_workflow_handoff', requestState, {
    snapshotId: handoffId,
    jobId: workflowHandoff.targetJobId || selectedJob?.id || null,
    action,
    status: workflowHandoff.status,
    providerId: providerContracts.selectedProviderId,
    commandSink: providerHandoff.commandSink,
    correlationId: providerHandoff.correlationId,
    returnRoute: providerHandoff.returnRoute,
    mailchimp: providerHandoff.mailchimp,
    scopeClaims: graph.boundary.scopePolicy.handoffClaims,
    mutationAuthorizationId: scopedMutationAuthorization.authorizationId,
    payload: workflowHandoff.payload
  }, history);
  const queue = [
    {
      handoffId,
      action,
      label: workflowHandoff.label,
      status: workflowHandoff.status,
      targetJobId: workflowHandoff.targetJobId || null,
      dispatchable,
      alreadyCompleted,
      dismissed,
      commandId: dispatchCommand.commandId
    },
    ...(mailchimpWorkflow.requested
      ? [{
          handoffId: mailchimpWorkflow.handoffId,
          action: mailchimpWorkflow.action,
          label: mailchimpWorkflow.dispatchable
            ? 'Dispatch Mailchimp workflow handoff'
            : 'Review Mailchimp workflow handoff',
          status: mailchimpWorkflow.status,
          targetJobId: workflowHandoff.targetJobId || null,
          dispatchable: mailchimpWorkflow.dispatchable,
          alreadyCompleted: completedHandoffs.has(mailchimpWorkflow.handoffId),
          dismissed: dismissedHandoffs.has(mailchimpWorkflow.handoffId),
          commandId: mailchimpWorkflow.command?.commandId || null,
          product: 'mailchimp',
          blockedReasons: mailchimpWorkflow.blockedReasons
        }]
      : []),
    ...operationalHealth.retryQueue.slice(0, 3).map((plan) => ({
      handoffId: `${surfaceId}:${requestState.requestId}:retry:${plan.jobId}`,
      action: 'watch_retry_backoff',
      label: `Retry ${plan.jobId} after backoff`,
      status: 'retry_backoff_scheduled',
      targetJobId: plan.jobId,
      dispatchable: false,
      alreadyCompleted: false,
      dismissed: false,
      commandId: null,
      nextRetryAt: plan.nextRetryAt
    }))
  ];

  return {
    contract: 'hosted-kernel-job-graph-client-workflow-handoff.v1',
    generatedAt: now,
    handoffId,
    status: workflowHandoff.status,
    label: workflowHandoff.label,
    message: workflowHandoff.message,
    action,
    visible: !alreadyCompleted && !dismissed,
    dispatchable,
    targetJobId: workflowHandoff.targetJobId || null,
    route: {
      pathname: '/operator-userland/job-graph-view',
      query: routeQuery
    },
    provider: {
      providerId: providerContracts.selectedProviderId,
      status: providerHandoff.status,
      commandSink: providerHandoff.commandSink,
      externalSystem: providerHandoff.externalSystem,
      correlationId: providerHandoff.correlationId,
      mailchimp: providerHandoff.mailchimp,
      blockedReasons: providerHandoff.blockedReasons,
      scopeClaims: graph.boundary.scopePolicy.handoffClaims
    },
    mutationAuthorization: {
      authorizationId: scopedMutationAuthorization.authorizationId,
      status: scopedMutationAuthorization.status,
      allowsExternalHandoff: scopedMutationAuthorization.allowsExternalHandoff,
      blockedReasons: scopedMutationAuthorization.blockedReasons
    },
    dispatchRequest: dispatchable && !alreadyCompleted
      ? {
      commandId: dispatchCommand.commandId,
      idempotencyKey: dispatchCommand.idempotencyKey,
      alreadyApplied: dispatchCommand.alreadyApplied,
      payload: dispatchCommand.payload
    }
      : null,
    mailchimpWorkflow,
    queue,
    proof: {
      selectedJobId: selectedJob?.id || null,
      selectedJobProofCount: selectedJob?.proofCount || 0,
      completedHandoffCount: completedHandoffs.size,
      dismissedHandoffCount: dismissedHandoffs.size,
      readOnly: operationalHealth.readOnly,
      scopeWriteBlockedReasons: graph.boundary.scopePolicy.writeBlockedReasons,
      mailchimpWorkflowStatus: mailchimpWorkflow.status,
      mailchimpWorkflowRequested: mailchimpWorkflow.requested
    }
  };
}

function mailchimpGate(code, passed, action, message, evidence = {}) {
  return {
    code,
    passed: Boolean(passed),
    status: passed ? 'pass' : 'fail',
    action: passed ? null : action,
    message,
    evidence
  };
}

function mailchimpNextStepFromGate(gate, fallbackTarget, requestState) {
  if (!gate) {
    return {
      kind: 'accept_mailchimp_graph_preview',
      label: 'Accept Mailchimp graph preview',
      targetId: fallbackTarget,
      reason: 'Mailchimp provider, graph readiness, validation, and scoped mutation authorization are aligned.',
      routeQueryPatch: {
        selectedJobId: fallbackTarget,
        mode: requestState.mode,
        panel: 'acceptance',
        action: 'accept_mailchimp_graph_preview'
      }
    };
  }

  return {
    kind: gate.action,
    label: gate.message,
    targetId: firstString(gate.evidence?.targetId, gate.evidence?.providerId, fallbackTarget),
    reason: `Mailchimp acceptance is blocked by ${gate.code}.`,
    routeQueryPatch: {
      selectedJobId: fallbackTarget,
      mode: gate.code.includes('validation') || gate.code.includes('scope') ? 'triage' : requestState.mode,
      panel: gate.code.includes('provider') || gate.code.includes('mailchimp') ? 'provider' : 'readiness',
      action: gate.action
    }
  };
}

function buildMailchimpPreviewAcceptanceContract(graph, validation, readiness, acceptance, requestState, operationalHealth, providerContracts, scopedMutationAuthorization, nextSteps, now) {
  const selectedProvider = providerContracts.providers
    .find((provider) => provider.providerId === providerContracts.selectedProviderId) || null;
  const mailchimp = selectedProvider?.mailchimp || null;
  const handoffMailchimp = providerContracts.externalHandoff.mailchimp;
  const selectedJob = graph.nodes.find((node) => node.id === requestState.selectedJobId) || null;
  const acceptanceDecision = scopedMutationAuthorization.decisions
    .find((decision) => decision.kind === 'accept_graph_preview') || null;
  const mailchimpEnabled = Boolean(mailchimp?.enabled && handoffMailchimp);
  const mailchimpBlockedReasons = mailchimpEnabled
    ? Array.from(new Set([
        ...(mailchimp.blockedReasons || []),
        ...(providerContracts.negotiation.missingMailchimpCapabilities || [])
      ])).sort()
    : ['mailchimp_contract_not_declared'];
  const sync = mailchimp?.sync || {};
  const handoff = mailchimp?.handoff || {};
  const validationErrors = validation.issues.filter((issue) => issue.severity === 'error');
  const validationWarnings = validation.issues.filter((issue) => issue.severity !== 'error');
  const gates = [
    mailchimpGate(
      'mailchimp_contract_declared',
      mailchimpEnabled,
      'bind_mailchimp_provider_contract',
      'Select a provider with a declared Mailchimp handoff contract.',
      { providerId: providerContracts.selectedProviderId }
    ),
    mailchimpGate(
      'mailchimp_audience_bound',
      mailchimpEnabled && Boolean(mailchimp.audienceId),
      'bind_mailchimp_audience',
      'Bind a Mailchimp audience before accepting this graph preview.',
      { audienceId: mailchimp?.audienceId || null }
    ),
    mailchimpGate(
      'mailchimp_server_prefix_bound',
      mailchimpEnabled && Boolean(mailchimp.serverPrefix),
      'bind_mailchimp_server_prefix',
      'Bind the Mailchimp server prefix for command routing.',
      { serverPrefix: mailchimp?.serverPrefix || null }
    ),
    mailchimpGate(
      'mailchimp_campaign_bound',
      mailchimpEnabled && Boolean(mailchimp.campaignId),
      'bind_mailchimp_campaign',
      'Bind a Mailchimp campaign id before campaign handoff.',
      { campaignId: mailchimp?.campaignId || null }
    ),
    mailchimpGate(
      'mailchimp_sync_fresh',
      mailchimpEnabled && sync.stale === false,
      'refresh_mailchimp_sync',
      'Refresh Mailchimp sync metadata before accepting this graph preview.',
      {
        lastSyncedAt: sync.lastSyncedAt || null,
        syncAgeMs: sync.syncAgeMs ?? null,
        maxSyncAgeMs: sync.maxSyncAgeMs ?? null
      }
    ),
    mailchimpGate(
      'mailchimp_webhook_ack_supported',
      mailchimpEnabled && ['at_least_once', 'exactly_once', 'manual_ack'].includes(mailchimp.webhookAckMode),
      'configure_mailchimp_webhook_ack',
      'Configure a supported Mailchimp webhook acknowledgement mode.',
      { webhookAckMode: mailchimp?.webhookAckMode || null }
    ),
    mailchimpGate(
      'mailchimp_external_state_accepts_handoff',
      mailchimpEnabled && !['failed', 'paused', 'missing', 'unknown'].includes(handoff.externalState),
      'resolve_mailchimp_external_state',
      'Move the Mailchimp handoff out of missing, paused, failed, or unknown state.',
      { externalState: handoff.externalState || null }
    ),
    mailchimpGate(
      'provider_negotiation_ready',
      providerContracts.negotiation.negotiable,
      'negotiate_provider_contract',
      'Negotiate provider capabilities required for Mailchimp graph handoff.',
      {
        providerId: providerContracts.selectedProviderId,
        blockedReasons: providerContracts.negotiation.blockedReasons
      }
    ),
    mailchimpGate(
      'graph_validation_ready',
      validation.valid,
      'repair_graph_validation',
      'Resolve graph validation errors before Mailchimp acceptance.',
      { issueCodes: validationErrors.map((issue) => issue.code) }
    ),
    mailchimpGate(
      'acceptance_authorized',
      Boolean(acceptanceDecision?.allowed),
      'request_acceptance_authorization',
      'Resolve scoped mutation authorization before Mailchimp acceptance.',
      {
        authorizationId: scopedMutationAuthorization.authorizationId,
        blockedReasons: scopedMutationAuthorization.blockedReasons
      }
    ),
    mailchimpGate(
      'readiness_ready',
      readiness.ready && !operationalHealth.readOnly,
      operationalHealth.readOnly ? 'restore_operational_health' : 'prepare_acceptance',
      'Clear readiness or health blockers before Mailchimp acceptance.',
      {
        readinessLevel: readiness.level,
        readOnly: operationalHealth.readOnly,
        blockedReasons: readiness.reasons
      }
    )
  ];
  const failedGates = gates.filter((gate) => !gate.passed);
  const blockingReasons = Array.from(new Set([
    ...mailchimpBlockedReasons,
    ...failedGates.map((gate) => gate.code),
    ...scopedMutationAuthorization.blockedReasons,
    ...(operationalHealth.readOnly ? ['operational_health_read_only'] : [])
  ])).filter(Boolean).sort();
  const enabled = failedGates.length === 0 && Boolean(acceptance.acceptToken);
  const firstFailedGate = failedGates[0] || null;
  const fallbackNextStep = nextSteps[0] || null;
  const nextStep = firstFailedGate
    ? mailchimpNextStepFromGate(firstFailedGate, selectedJob?.id || surfaceName, requestState)
    : mailchimpNextStepFromGate(null, selectedJob?.id || surfaceName, requestState);
  const previewId = `${surfaceId}:${requestState.requestId}:mailchimp-preview:${providerContracts.selectedProviderId || 'provider'}:${failedGates.length}`;
  const status = enabled
    ? 'mailchimp_acceptance_ready'
    : !mailchimpEnabled
      ? 'mailchimp_provider_missing'
      : validationErrors.length > 0
        ? 'mailchimp_validation_blocked'
        : operationalHealth.readOnly
          ? 'mailchimp_read_only'
          : 'mailchimp_readiness_blocked';

  return {
    contract: 'mailchimp-job-graph-preview-acceptance.v1',
    previewId,
    generatedAt: now,
    status,
    enabled,
    route: {
      pathname: '/operator-userland/job-graph-view',
      query: {
        requestId: requestState.requestId,
        selectedJobId: selectedJob?.id || requestState.selectedJobId,
        mode: nextStep.routeQueryPatch.mode,
        preview: status,
        panel: enabled ? 'acceptance' : nextStep.routeQueryPatch.panel,
        product: 'mailchimp'
      }
    },
    provider: {
      providerId: providerContracts.selectedProviderId,
      contractDeclared: mailchimpEnabled,
      negotiationStatus: providerContracts.negotiation.status,
      handoffStatus: providerContracts.externalHandoff.status,
      commandSink: handoffMailchimp?.commandSink || providerContracts.externalHandoff.commandSink,
      returnRoute: handoff.returnRoute || providerContracts.externalHandoff.returnRoute,
      externalSystem: mailchimp?.externalSystem || 'mailchimp-marketing',
      blockedReasons: mailchimpBlockedReasons
    },
    mailchimp: mailchimpEnabled
      ? {
          audienceId: mailchimp.audienceId,
          campaignId: mailchimp.campaignId,
          templateId: mailchimp.templateId,
          serverPrefix: mailchimp.serverPrefix,
          webhookAckMode: mailchimp.webhookAckMode,
          externalState: handoff.externalState,
          externalStateRaw: handoff.externalStateRaw,
          mergeFieldNamespace: handoff.mergeFieldNamespace,
          idempotencyField: handoff.idempotencyField,
          requiresDoubleOptIn: handoff.requiresDoubleOptIn,
          sync: {
            cursor: sync.cursor,
            generation: sync.generation,
            lastSyncedAt: sync.lastSyncedAt,
            syncAgeMs: sync.syncAgeMs,
            maxSyncAgeMs: sync.maxSyncAgeMs,
            stale: sync.stale,
            syncedEntityCount: sync.syncedEntityCount,
            entitySync: sync.entitySync
          }
        }
      : null,
    validationSummary: {
      status: validation.valid ? 'valid' : 'invalid',
      issueCount: validation.issueCount,
      errorCount: validationErrors.length,
      warningCount: validationWarnings.length,
      blockingIssueCodes: validationErrors.map((issue) => issue.code),
      warningIssueCodes: validationWarnings.map((issue) => issue.code)
    },
    readinessSummary: {
      level: readiness.level,
      ready: readiness.ready,
      failedGates: gates.filter((gate) => !gate.passed).map((gate) => gate.code),
      graphReadyQueue: graph.topology.readyQueue,
      proofBackedJobIds: graph.proofBackedNodes.map((node) => node.id),
      blockedJobIds: graph.blockedNodes.map((node) => node.id)
    },
    gates,
    acceptance: {
      enabled,
      action: enabled ? 'accept_mailchimp_graph_preview' : 'hold_mailchimp_acceptance',
      acceptToken: enabled ? acceptance.acceptToken : null,
      authorizationId: scopedMutationAuthorization.authorizationId,
      commandSink: handoffMailchimp?.commandSink || providerContracts.externalHandoff.commandSink,
      correlationId: providerContracts.externalHandoff.correlationId,
      idempotencyKey: enabled
        ? `${surfaceId}:${requestState.requestId}:mailchimp:${mailchimp.audienceId}:${mailchimp.campaignId}`
        : null,
      blockedReasons: enabled ? [] : blockingReasons,
      payload: enabled
        ? {
            requestId: requestState.requestId,
            providerId: providerContracts.selectedProviderId,
            audienceId: mailchimp.audienceId,
            campaignId: mailchimp.campaignId,
            templateId: mailchimp.templateId,
            serverPrefix: mailchimp.serverPrefix,
            syncCursor: sync.cursor,
            syncGeneration: sync.generation,
            acceptToken: acceptance.acceptToken,
            scopeClaims: graph.boundary.scopePolicy.handoffClaims,
            mutationAuthorizationId: scopedMutationAuthorization.authorizationId
          }
        : null
    },
    explainableNextStep: {
      ...nextStep,
      fallbackKind: fallbackNextStep?.kind || null,
      fallbackReason: fallbackNextStep?.explain || null
    },
    proof: {
      product: 'mailchimp',
      selectedJobId: selectedJob?.id || null,
      providerId: providerContracts.selectedProviderId,
      failedGateCount: failedGates.length,
      passedGateCount: gates.length - failedGates.length,
      blockedReasons,
      healthStatus: operationalHealth.status,
      providerHandoffStatus: providerContracts.externalHandoff.status,
      mutationAuthorizationStatus: scopedMutationAuthorization.status
    }
  };
}

function buildClientRuntimeState(graph, validation, readiness, requestState, persistedState, operationalHealth, lifecycleControls, providerContracts, decisionPanel, workflowHandoff, clientWorkflowHandoff, scopedMutationAuthorization, analytics, clientPreview, mailchimpPreview) {
  const selectedNode = graph.nodes.find((node) => node.id === requestState.selectedJobId) || null;
  const unresolvedDependencies = dependenciesFor(graph, selectedNode?.id)
    .filter((dependency) => !dependency.resolved)
    .map((dependency) => dependency.jobId);
  const selectedDependencyBlock = graph.topology.blockedByDependencies
    .find((entry) => entry.jobId === selectedNode?.id) || null;
  const issueJobs = new Set(validation.issues.map((issue) => issue.jobId).filter(Boolean));

  return {
    contract: 'hosted-kernel-job-graph-client-state.v1',
    request: requestState,
    routeState: {
      pathname: '/operator-userland/job-graph-view',
      query: {
        requestId: requestState.requestId,
        selectedJobId: requestState.selectedJobId,
        mode: requestState.mode
      }
    },
    selectedJob: selectedNode
      ? {
          id: selectedNode.id,
          label: selectedNode.label,
          status: selectedNode.status,
          owner: selectedNode.owner,
          proofCount: selectedNode.proofCount,
          blockers: selectedNode.blockers,
          lifecycle: selectedNode.lifecycle,
          failure: selectedNode.isFailure ? selectedNode.failure : null,
          dependencies: dependenciesFor(graph, selectedNode.id),
          dependents: dependentsFor(graph, selectedNode.id),
          unresolvedDependencies,
          dependencyBlockedBy: selectedDependencyBlock?.waitingOn || [],
          hasValidationIssue: issueJobs.has(selectedNode.id)
        }
      : null,
    topology: {
      contract: graph.topology.contract,
      acyclic: graph.topology.acyclic,
      rootJobIds: graph.topology.roots,
      leafJobIds: graph.topology.leaves,
      readyQueue: graph.topology.readyQueue,
      cycleCount: graph.topology.cycles.length,
      dependencyBlockedJobCount: graph.topology.blockedByDependencies.length,
      integrityStatus: graph.integrity.status,
      lossless: graph.integrity.lossless,
      executableDependencyCount: graph.integrity.executableDependencyCount,
      malformedDependencyCount: graph.integrity.malformedDependencyCount,
      droppedDependencyCount: graph.integrity.droppedDependencyCount,
      structuralIssueCodes: graph.integrity.structuralIssueCodes
    },
    viewFlags: {
      showValidationPanel: validation.issueCount > 0,
      showProofPanel: graph.proofBackedNodes.length > 0 || Boolean(selectedNode?.isTerminal),
      showBlockedLane: graph.blockedNodes.length > 0,
      canSubmitAcceptance: readiness.ready && graph.boundary.accessContext.canAcceptGraph,
      showBoundaryPanel: graph.boundary.deniedNodes.length > 0 || graph.boundary.deniedEdges.length > 0,
      showScopeBindingPanel: !graph.boundary.scopePolicy.canWriteScopedGraph,
      showHealthPanel: operationalHealth.status !== 'healthy',
      readOnlyDegradedMode: operationalHealth.readOnly,
      showLifecycleControls: lifecycleControls.controls.length > 0,
      lifecycleControlsWritable: lifecycleControls.writable,
      showCommandRecoveryPanel: Boolean(persistedState.commandRecovery && !persistedState.commandRecovery.restartSafe)
    },
    providerContracts: {
      contract: providerContracts.contract,
      selectedProviderId: providerContracts.selectedProviderId,
      negotiationStatus: providerContracts.negotiation.status,
      recommendedProviderId: providerContracts.negotiation.recommendedProviderId,
      handoffPhase: providerContracts.negotiation.handoffPhase,
      missingCapabilities: providerContracts.negotiation.missingCapabilities,
      blockedReasons: providerContracts.negotiation.blockedReasons,
      externalHandoffStatus: providerContracts.externalHandoff.status,
      commandSink: providerContracts.externalHandoff.commandSink,
      syncCursor: providerContracts.externalHandoff.syncCursor,
      ackMode: providerContracts.externalHandoff.ackMode,
      externalState: providerContracts.externalHandoff.externalState,
      mailchimp: providerContracts.externalHandoff.mailchimp
        ? {
            audienceId: providerContracts.externalHandoff.mailchimp.audienceId,
            campaignId: providerContracts.externalHandoff.mailchimp.campaignId,
            templateId: providerContracts.externalHandoff.mailchimp.templateId,
            serverPrefix: providerContracts.externalHandoff.mailchimp.serverPrefix,
            externalState: providerContracts.externalHandoff.mailchimp.externalState,
            syncCursor: providerContracts.externalHandoff.mailchimp.syncCursor,
            webhookAckMode: providerContracts.externalHandoff.mailchimp.webhookAckMode,
            mergeFieldNamespace: providerContracts.externalHandoff.mailchimp.mergeFieldNamespace,
            blockedReasons: providerContracts.externalHandoff.mailchimp.blockedReasons
          }
        : null,
      candidateProviders: providerContracts.negotiationPlan.candidateProviders.map((provider) => ({
        providerId: provider.providerId,
        status: provider.status,
        score: provider.score,
        commandSink: provider.handoff.commandSink,
        stale: provider.sync.stale,
        mailchimp: provider.mailchimp,
        blockedReasons: provider.blockedReasons
      }))
    },
    workflowHandoff: {
      contract: clientWorkflowHandoff.contract,
      handoffId: clientWorkflowHandoff.handoffId,
      status: workflowHandoff.status,
      action: clientWorkflowHandoff.action,
      visible: clientWorkflowHandoff.visible,
      dispatchable: clientWorkflowHandoff.dispatchable,
      targetJobId: workflowHandoff.targetJobId,
      route: clientWorkflowHandoff.route,
      commandId: clientWorkflowHandoff.dispatchRequest?.commandId || null,
      providerId: clientWorkflowHandoff.provider.providerId,
      blockedReasons: clientWorkflowHandoff.provider.blockedReasons,
      queuedHandoffCount: clientWorkflowHandoff.queue.length,
      mailchimp: {
        contract: clientWorkflowHandoff.mailchimpWorkflow.contract,
        handoffId: clientWorkflowHandoff.mailchimpWorkflow.handoffId,
        status: clientWorkflowHandoff.mailchimpWorkflow.status,
        requested: clientWorkflowHandoff.mailchimpWorkflow.requested,
        action: clientWorkflowHandoff.mailchimpWorkflow.action,
        dispatchable: clientWorkflowHandoff.mailchimpWorkflow.dispatchable,
        dryRun: clientWorkflowHandoff.mailchimpWorkflow.dryRun,
        commandId: clientWorkflowHandoff.mailchimpWorkflow.command?.commandId || null,
        route: clientWorkflowHandoff.mailchimpWorkflow.route,
        providerId: clientWorkflowHandoff.mailchimpWorkflow.provider.providerId,
        audienceId: clientWorkflowHandoff.mailchimpWorkflow.target.audienceId,
        campaignId: clientWorkflowHandoff.mailchimpWorkflow.target.campaignId,
        templateId: clientWorkflowHandoff.mailchimpWorkflow.target.templateId,
        serverPrefix: clientWorkflowHandoff.mailchimpWorkflow.target.serverPrefix,
        segmentIds: clientWorkflowHandoff.mailchimpWorkflow.target.segmentIds,
        blockedReasons: clientWorkflowHandoff.mailchimpWorkflow.blockedReasons
      }
    },
    mutationAuthorization: {
      contract: scopedMutationAuthorization.contract,
      authorizationId: scopedMutationAuthorization.authorizationId,
      status: scopedMutationAuthorization.status,
      allowsExternalHandoff: scopedMutationAuthorization.allowsExternalHandoff,
      allowsAcceptance: scopedMutationAuthorization.allowsAcceptance,
      allowsLifecycleDispatch: scopedMutationAuthorization.allowsLifecycleDispatch,
      blockedReasons: scopedMutationAuthorization.blockedReasons,
      decisions: scopedMutationAuthorization.decisions.map((decision) => ({
        kind: decision.kind,
        requested: decision.requested,
        allowed: decision.allowed,
        status: decision.status,
        targetJobId: decision.targetJobId,
        targetTenantId: decision.targetTenantId,
        targetWorkspaceId: decision.targetWorkspaceId,
        commandId: decision.commandId,
        workspaceGrantId: decision.claims.workspaceGrantId,
        blockedReasons: decision.blockedReasons
      }))
    },
    clientPreview: {
      contract: clientPreview.contract,
      previewId: clientPreview.previewId,
      status: clientPreview.status,
      route: clientPreview.route,
      selectedJobId: clientPreview.selectedJob?.id || null,
      readinessLevel: clientPreview.readiness.level,
      readinessBlockedReasons: clientPreview.readiness.blockedReasons,
      validationStatus: clientPreview.validation.status,
      validationIssueCount: clientPreview.validation.issueCount,
      acceptanceEnabled: clientPreview.acceptance.enabled,
      acceptanceAction: clientPreview.acceptance.action,
      nextStepKind: clientPreview.explainableNextStep.kind,
      nextStepTarget: clientPreview.explainableNextStep.targetId,
      proofCards: clientPreview.previewCards
    },
    operationalHealth: {
      contract: operationalHealth.contract,
      status: operationalHealth.status,
      degradedMode: operationalHealth.degradedMode,
      fallbackMode: operationalHealth.fallbackMode,
      readOnly: operationalHealth.readOnly,
      degradedReasons: operationalHealth.degradedReasons,
      writeBlockedReasons: operationalHealth.writeBlockedReasons,
      retryableJobCount: operationalHealth.retryableJobCount,
      failedJobCount: operationalHealth.failedJobCount,
      actionableErrorCount: operationalHealth.actionableErrors.length,
      nextRetryAt: operationalHealth.retryHorizon.nextRetryAt,
      incidentResponseStatus: operationalHealth.incidentResponse.status,
      primaryIncidentCode: operationalHealth.incidentResponse.primaryIncident?.code || null,
      primaryIncidentAction: operationalHealth.incidentResponse.primaryIncident?.action || null,
      writeBlockingIncidentCount: operationalHealth.incidentResponse.writeBlockingIncidentCount,
      recoveryChecklist: operationalHealth.incidentResponse.recoveryChecklist,
      blockingGateCount: operationalHealth.healthGates.filter((gate) => gate.writeBlocking).length,
      warningGateCount: operationalHealth.healthGates.filter((gate) => !gate.passed && !gate.writeBlocking).length
    },
    reporting: {
      contract: analytics.reporting.contract,
      status: analytics.reporting.status,
      publishable: analytics.reporting.publishable,
      blockedReasons: analytics.reporting.blockedReasons,
      findingStatus: analytics.findings.status,
      findingCount: analytics.findings.counters.total,
      criticalFindingCount: analytics.findings.counters.critical,
      errorFindingCount: analytics.findings.counters.error,
      requestedFormats: analytics.reporting.request.formats,
      destinationKind: analytics.reporting.request.destination.kind,
      exportFiles: analytics.reporting.manifest.map((file) => ({
        exportKey: file.exportKey,
        filename: file.filename,
        rowCount: file.rowCount,
        contentType: file.contentType
      })),
      trend: analytics.reporting.trend,
      timelineLaneCount: analytics.reporting.timeline.lanes.length,
      retainedSnapshotCount: analytics.reporting.retention.retainedSnapshotCount
    },
    lifecycleControls: {
      contract: lifecycleControls.contract,
      selectedJobId: lifecycleControls.selectedJobId,
      writable: lifecycleControls.writable,
      blockedReasons: lifecycleControls.blockedReasons,
      settingsValidation: lifecycleControls.settingsValidation,
      nextAction: lifecycleControls.nextAction,
      transitionState: {
        contract: lifecycleControls.transitionState.contract,
        lifecycleStatus: lifecycleControls.transitionState.lifecycleStatus,
        schedulePolicy: lifecycleControls.transitionState.schedulePolicy,
        nextTransition: lifecycleControls.transitionState.nextTransition,
        enabledTransitionKinds: lifecycleControls.transitionState.proof.enabledTransitionKinds,
        blockedTransitionKinds: lifecycleControls.transitionState.proof.blockedTransitionKinds,
        transitions: lifecycleControls.transitionState.transitions.map((transition) => ({
          kind: transition.kind,
          targetJobId: transition.targetJobId,
          enabled: transition.enabled,
          commandId: transition.commandId,
          fromStatus: transition.fromStatus,
          fromLifecycleStatus: transition.fromLifecycleStatus,
          blockedReasons: transition.blockedReasons,
          statePatch: transition.statePatch
        }))
      },
    mailchimpPreview: {
      contract: mailchimpPreview.contract,
      previewId: mailchimpPreview.previewId,
      status: mailchimpPreview.status,
      enabled: mailchimpPreview.enabled,
      routePanel: mailchimpPreview.route.query.panel,
      providerId: mailchimpPreview.provider.providerId,
      contractDeclared: mailchimpPreview.provider.contractDeclared,
      audienceId: mailchimpPreview.mailchimp?.audienceId || null,
      campaignId: mailchimpPreview.mailchimp?.campaignId || null,
      serverPrefix: mailchimpPreview.mailchimp?.serverPrefix || null,
      externalState: mailchimpPreview.mailchimp?.externalState || null,
      syncStale: mailchimpPreview.mailchimp?.sync?.stale ?? null,
      syncedEntityCount: mailchimpPreview.mailchimp?.sync?.syncedEntityCount ?? 0,
      validationStatus: mailchimpPreview.validationSummary.status,
      validationIssueCount: mailchimpPreview.validationSummary.issueCount,
      readinessLevel: mailchimpPreview.readinessSummary.level,
      failedGates: mailchimpPreview.readinessSummary.failedGates,
      acceptanceEnabled: mailchimpPreview.acceptance.enabled,
      acceptanceAction: mailchimpPreview.acceptance.action,
      acceptanceAuthorizationId: mailchimpPreview.acceptance.authorizationId,
      blockedReasons: mailchimpPreview.acceptance.blockedReasons,
      nextStepKind: mailchimpPreview.explainableNextStep.kind,
      nextStepTargetId: mailchimpPreview.explainableNextStep.targetId,
      gateStatuses: mailchimpPreview.gates.map((gate) => ({
        code: gate.code,
        status: gate.status,
        action: gate.action
      }))
    },
      dispatchPlan: {
        contract: lifecycleControls.dispatchPlan.contract,
        status: lifecycleControls.dispatchPlan.status,
        dispatchable: lifecycleControls.dispatchPlan.dispatchable,
        dryRun: lifecycleControls.dispatchPlan.dryRun,
        requested: lifecycleControls.dispatchPlan.requestedAction.requested,
        requestedKind: lifecycleControls.dispatchPlan.requestedAction.kind,
        requestedJobId: lifecycleControls.dispatchPlan.requestedAction.targetJobId,
        selectedCommandId: lifecycleControls.dispatchPlan.selectedCommandId,
        scheduledFor: lifecycleControls.dispatchPlan.scheduledFor,
        expiresAt: lifecycleControls.dispatchPlan.expiresAt,
        scheduleDecision: lifecycleControls.dispatchPlan.scheduleDecision,
        blockedReasons: lifecycleControls.dispatchPlan.blockedReasons,
        route: lifecycleControls.dispatchPlan.route
      },
      controls: lifecycleControls.controls.map((control) => ({
        kind: control.kind,
        enabled: control.enabled,
        disabledReason: control.disabledReason,
        commandId: control.command?.commandId || null,
        alreadyApplied: Boolean(control.command?.alreadyApplied)
      }))
    },
    decisionPanel,
    boundary: {
      contract: graph.boundary.contract,
      principalId: graph.boundary.accessContext.principalId,
      tenantId: graph.boundary.accessContext.tenantId || null,
      workspaceId: graph.boundary.accessContext.workspaceId || null,
      visibleNodeCount: graph.boundary.visibleNodeCount,
      deniedNodeCount: graph.boundary.deniedNodes.length,
      deniedEdgeCount: graph.boundary.deniedEdges.length,
      malformedEdgeCount: graph.boundary.malformedEdges.length,
      canAcceptGraph: graph.boundary.accessContext.canAcceptGraph,
      canWriteScopedGraph: graph.boundary.scopePolicy.canWriteScopedGraph,
      scopeWriteBlockedReasons: graph.boundary.scopePolicy.writeBlockedReasons,
      effectiveTenantId: graph.boundary.scopePolicy.effectiveTenantId,
      effectiveWorkspaceId: graph.boundary.scopePolicy.effectiveWorkspaceId,
      workspaceGrant: graph.boundary.scopePolicy.workspaceGrant,
      integrity: graph.boundary.integrity
    },
    persistedState
  };
}

function buildWorkflowHandoff(graph, validation, readiness, acceptance, requestState, operationalHealth, providerContracts) {
  const selectedJob = graph.nodes.find((node) => node.id === requestState.selectedJobId) || null;
  const primaryBlockedJob = graph.blockedNodes[0] || null;
  const nextRetry = operationalHealth.retryQueue[0] || null;
  const blockingValidationIssues = validation.issues.filter((issue) => issue.severity === 'error');
  const blockingScopeOnly =
    blockingValidationIssues.length > 0 &&
    blockingValidationIssues.every((issue) => firstString(issue.code).startsWith('scope_'));

  if (operationalHealth.status === 'critical') {
    return {
      status: nextRetry ? 'retry_backoff_scheduled' : 'blocked_by_operational_health',
      label: nextRetry ? 'Wait for retry backoff' : 'Repair hosted-kernel health',
      message: nextRetry
        ? 'A failed job has an automatic retry window; acceptance remains read-only until the retry settles.'
        : 'The hosted kernel graph is in a critical health state and requires operator repair before acceptance.',
      targetJobId: nextRetry?.jobId || selectedJob?.id || null,
      payload: {
        requestId: requestState.requestId,
        healthStatus: operationalHealth.status,
        nextRetryAt: nextRetry?.nextRetryAt || null,
        actionableErrorCodes: operationalHealth.actionableErrors.map((error) => error.code)
      }
    };
  }

  if (!requestState.selectedJobFound) {
    return {
      status: 'recover_selection',
      label: 'Recover job selection',
      message: 'The requested job is not in the hosted kernel graph; the client should focus the next actionable job.',
      targetJobId: requestState.selectedJobId,
      payload: {
        requestId: requestState.requestId,
        fallbackJobId: selectedJob?.id || null
      }
    };
  }

  if (!graph.boundary.scopePolicy.canWriteScopedGraph && (blockingScopeOnly || validation.valid)) {
    return {
      status: 'blocked_by_scope',
      label: 'Bind tenant and workspace scope',
      message: 'The visible hosted-kernel graph must have an explicit tenant and workspace boundary before write handoff.',
      targetJobId: selectedJob?.id || null,
      payload: {
        requestId: requestState.requestId,
        tenantId: graph.boundary.scopePolicy.effectiveTenantId,
        workspaceId: graph.boundary.scopePolicy.effectiveWorkspaceId,
        blockedReasons: graph.boundary.scopePolicy.writeBlockedReasons,
        missingScope: graph.boundary.scopePolicy.missingScope,
        returnRoute: '/operator-userland/job-graph-view'
      }
    };
  }

  if (!validation.valid) {
    return {
      status: 'blocked_by_validation',
      label: 'Resolve graph validation',
      message: 'Acceptance is disabled until missing dependency references are fixed.',
      targetJobId: selectedJob?.id || null,
      payload: {
        requestId: requestState.requestId,
        issueCodes: validation.issues.map((issue) => issue.code),
        danglingDependencyIds: graph.danglingEdges.map((edge) => edge.id),
        malformedDependencyIds: graph.malformedEdges.map((edge) => edge.id),
        structuralIssueCodes: graph.integrity.structuralIssueCodes
      }
    };
  }

  if (!graph.boundary.accessContext.canAcceptGraph) {
    return {
      status: 'blocked_by_permission',
      label: 'Request graph acceptance permission',
      message: 'The current operator can review the scoped graph but cannot submit hosted-kernel acceptance.',
      targetJobId: selectedJob?.id || null,
      payload: {
        requestId: requestState.requestId,
        principalId: graph.boundary.accessContext.principalId,
        requiredPermission: 'job_graph:accept',
        returnRoute: '/operator-userland/job-graph-view'
      }
    };
  }

  if (!providerContracts.negotiation.negotiable) {
    return {
      status: 'blocked_by_provider_contract',
      label: 'Negotiate provider contract',
      message: 'The selected integration provider is not ready for hosted-kernel graph acceptance handoff.',
      targetJobId: selectedJob?.id || null,
      payload: {
        requestId: requestState.requestId,
        providerId: providerContracts.selectedProviderId,
        negotiationStatus: providerContracts.negotiation.status,
        missingCapabilities: providerContracts.negotiation.missingCapabilities,
        staleProviderIds: providerContracts.negotiation.staleProviderIds,
        returnRoute: '/operator-userland/job-graph-view'
      }
    };
  }

  if (primaryBlockedJob) {
    return {
      status: 'handoff_to_blocker_triage',
      label: 'Triage blocked job',
      message: 'The next operator workflow should resolve blockers before graph acceptance.',
      targetJobId: primaryBlockedJob.id,
      payload: {
        requestId: requestState.requestId,
        blockers: primaryBlockedJob.blockers,
        returnRoute: '/operator-userland/job-graph-view'
      }
    };
  }

  return {
    status: acceptance.accepted ? 'ready_for_acceptance' : 'needs_proof',
    label: acceptance.accepted ? 'Accept graph preview' : 'Attach proof before acceptance',
    message: acceptance.accepted
      ? 'The client can hand the accept token to the hosted-kernel approval workflow.'
      : 'At least one completed job needs proof before operator acceptance.',
    targetJobId: selectedJob?.id || graph.terminalNodes[0]?.id || null,
    payload: {
      requestId: requestState.requestId,
      acceptToken: acceptance.acceptToken,
      proofBackedJobIds: graph.proofBackedNodes.map((node) => node.id)
    }
  };
}

function buildPreview(graph) {
  return {
    title: 'Hosted kernel job graph preview',
    totals: {
      jobs: graph.nodes.length,
      dependencies: graph.edges.length,
      executableDependencies: graph.integrity.executableDependencyCount,
      malformedDependencies: graph.integrity.malformedDependencyCount,
      danglingDependencies: graph.integrity.danglingDependencyCount,
      droppedDependencies: graph.integrity.droppedDependencyCount,
      active: graph.activeNodes.length,
      blocked: graph.blockedNodes.length,
      terminal: graph.terminalNodes.length,
      proofBacked: graph.proofBackedNodes.length,
      deniedByBoundary: graph.boundary.deniedNodes.length,
      readyQueue: graph.topology.readyQueue.length,
      dependencyCycles: graph.topology.cycles.length
    },
    rows: graph.nodes.slice(0, 12).map((node) => ({
      id: node.id,
      label: node.label,
      status: node.status,
      owner: node.owner,
      proofCount: node.proofCount,
      dependencyCount: graph.edges.filter((edge) => edge.to === node.id).length,
      waitingOnDependencyCount: graph.topology.blockedByDependencies
        .find((entry) => entry.jobId === node.id)?.waitingOn.length || 0,
      canAccept: node.isTerminal && node.proofCount > 0
    }))
  };
}

function buildReadiness(graph, validation, operationalHealth, providerContracts, commandRecovery = null) {
  const hasProof = graph.proofBackedNodes.length > 0;
  const canAcceptGraph = graph.boundary.accessContext.canAcceptGraph;
  const healthAllowsAcceptance = operationalHealth.status === 'healthy';
  const providerAllowsAcceptance = providerContracts.negotiation.negotiable;
  const topologyAllowsAcceptance = graph.topology.acyclic && graph.integrity.lossless;
  const scopeAllowsAcceptance = graph.boundary.scopePolicy.canWriteScopedGraph;
  const workspaceWriteAuthorized = graph.boundary.scopePolicy.workspaceWriteAuthorized;
  const commandRecoveryAllowsAcceptance = commandRecovery?.restartSafe ?? true;
  const ready =
    validation.valid &&
    graph.nodes.length > 0 &&
    graph.blockedNodes.length === 0 &&
    hasProof &&
    canAcceptGraph &&
    healthAllowsAcceptance &&
    providerAllowsAcceptance &&
    topologyAllowsAcceptance &&
    scopeAllowsAcceptance &&
    workspaceWriteAuthorized &&
    commandRecoveryAllowsAcceptance;
  const reasons = [];

  if (graph.nodes.length === 0) reasons.push('Add at least one job to the graph.');
  if (!validation.valid) reasons.push('Resolve validation errors before accepting the preview.');
  if (graph.blockedNodes.length > 0) reasons.push('Clear blocked jobs before marking the graph ready.');
  if (!hasProof && graph.nodes.length > 0) reasons.push('Attach proof or evidence to at least one completed job.');
  if (!canAcceptGraph) reasons.push('Use an operator role or permission that can accept the job graph.');
  if (!healthAllowsAcceptance) reasons.push('Resolve hosted-kernel health errors or wait for scheduled retry backoff.');
  if (!providerAllowsAcceptance) reasons.push('Negotiate a synced provider contract with graph acceptance, proof export, and lifecycle dispatch capabilities.');
  if (!topologyAllowsAcceptance) reasons.push('Resolve malformed, duplicate, dangling, or cyclic dependencies before accepting the hosted-kernel graph.');
  if (!scopeAllowsAcceptance) reasons.push('Bind tenant and workspace scope before submitting hosted-kernel write handoff.');
  if (!workspaceWriteAuthorized) reasons.push('Attach a workspace write grant for the scoped tenant/workspace before hosted-kernel handoff.');
  if (!commandRecoveryAllowsAcceptance) reasons.push('Reconcile stale, failed, or unknown persisted commands before resuming hosted-kernel write handoff.');

  return {
    ready,
    level: ready ? 'ready' : validation.valid ? 'needs_attention' : 'invalid',
    reasons,
    gates: {
      hasJobs: graph.nodes.length > 0,
      dependenciesResolved: graph.integrity.lossless,
      dependencyEndpointsComplete: graph.malformedEdges.length === 0,
      dependencyIdsUnique: graph.integrity.duplicateEdgeIds.length === 0,
      jobIdsUnique: graph.integrity.duplicateNodeIds.length === 0,
      noBlockedJobs: graph.blockedNodes.length === 0,
      hasProof,
      canAcceptGraph,
      healthAllowsAcceptance,
      providerAllowsAcceptance,
      topologyAllowsAcceptance,
      scopeAllowsAcceptance,
      workspaceWriteAuthorized,
      commandRecoveryAllowsAcceptance,
      degradedMode: operationalHealth.degradedMode,
      tenantBoundaryClean: graph.boundary.deniedNodes.length === 0 && graph.boundary.deniedEdges.length === 0
    }
  };
}

function buildAcceptance(graph, readiness, providerContracts) {
  return {
    accepted: Boolean(readiness.ready),
    action: readiness.ready ? 'accept_graph_preview' : 'hold_for_operator_review',
    acceptToken: readiness.ready
      ? `${surfaceId}:${providerContracts.selectedProviderId}:${graph.boundary.scopePolicy.effectiveTenantId || 'tenant'}:${graph.boundary.scopePolicy.effectiveWorkspaceId || 'workspace'}:${graph.nodes.length}:${graph.edges.length}:${graph.integrity.executableDependencyCount}:${graph.proofBackedNodes.length}`
      : null,
    providerId: providerContracts.selectedProviderId,
    externalHandoff: providerContracts.externalHandoff,
    requiredBeforeAccept: readiness.reasons
  };
}

function summarizeCounters(graph, validation, readiness, operationalHealth) {
  const status = {};
  const owners = {};
  const blockers = {};
  const failures = {};
  const durations = graph.nodes
    .map((node) => node.timeline.durationMs)
    .filter((duration) => duration !== null)
    .sort((left, right) => left - right);

  for (const node of graph.nodes) {
    incrementCounter(status, node.status);
    incrementCounter(owners, node.owner);
    for (const blocker of node.blockers) incrementCounter(blockers, blocker);
    if (node.isFailure) incrementCounter(failures, node.failure.code || node.status);
  }

  return {
    contract: 'hosted-kernel-job-graph-analytics-counters.v1',
    totals: {
      visibleJobs: graph.nodes.length,
      visibleDependencies: graph.edges.length,
      executableDependencies: graph.integrity.executableDependencyCount,
      malformedDependencies: graph.integrity.malformedDependencyCount,
      danglingDependencies: graph.integrity.danglingDependencyCount,
      droppedDependencies: graph.integrity.droppedDependencyCount,
      activeJobs: graph.activeNodes.length,
      terminalJobs: graph.terminalNodes.length,
      blockedJobs: graph.blockedNodes.length,
      proofBackedJobs: graph.proofBackedNodes.length,
      failedJobs: operationalHealth.failedJobCount,
      validationIssues: validation.issueCount,
      readinessGateFailures: readiness.reasons.length,
      deniedJobs: graph.boundary.deniedNodes.length,
      deniedDependencies: graph.boundary.deniedEdges.length,
      duplicateVisibleJobIds: graph.integrity.duplicateVisibleJobIdCount,
      duplicateVisibleDependencyIds: graph.integrity.duplicateVisibleDependencyIdCount
    },
    byStatus: status,
    byOwner: owners,
    byBlocker: blockers,
    byFailureCode: failures,
    rates: {
      completion: ratio(graph.terminalNodes.length, graph.nodes.length),
      proofCoverage: ratio(graph.proofBackedNodes.length, graph.nodes.length),
      blocked: ratio(graph.blockedNodes.length, graph.nodes.length),
      boundaryDenial: ratio(graph.boundary.deniedNodes.length, graph.boundary.inputNodeCount),
      dependencyLoss: ratio(graph.integrity.droppedDependencyCount, graph.boundary.inputEdgeCount)
    },
    durationMs: {
      observedCount: durations.length,
      min: durations[0] ?? null,
      max: durations[durations.length - 1] ?? null,
      median: durations.length ? durations[Math.floor((durations.length - 1) / 2)] : null
    }
  };
}

function normalizeHistorySnapshot(raw, index) {
  const capturedAt = normalizeTimestamp(raw?.capturedAt, raw?.generatedAt, raw?.timestamp, raw?.at);
  const counters = raw?.counters || raw?.analyticsCounters || {};
  const totals = counters.totals || raw?.totals || {};

  return {
    snapshotId: firstString(raw?.snapshotId, raw?.id, `history-${index + 1}`),
    capturedAt,
    visibleJobs: normalizeInteger(totals.visibleJobs ?? raw?.visibleJobs ?? raw?.jobs, 0),
    activeJobs: normalizeInteger(totals.activeJobs ?? raw?.activeJobs, 0),
    blockedJobs: normalizeInteger(totals.blockedJobs ?? raw?.blockedJobs, 0),
    terminalJobs: normalizeInteger(totals.terminalJobs ?? raw?.terminalJobs, 0),
    failedJobs: normalizeInteger(totals.failedJobs ?? raw?.failedJobs, 0),
    proofBackedJobs: normalizeInteger(totals.proofBackedJobs ?? raw?.proofBackedJobs, 0),
    readinessLevel: firstString(raw?.readinessLevel, raw?.readiness?.level, 'unknown'),
    healthStatus: firstString(raw?.healthStatus, raw?.operationalHealth?.status, 'unknown')
  };
}

function collectHistoryInputs(input) {
  const persisted = input.persistedState || input.savedState || input.clientRuntime?.persistedState || {};
  return [
    ...asArray(input.analyticsHistory || input.historySnapshots || input.reportingHistory),
    ...asArray(input.clientRuntime?.analyticsHistory || input.clientRuntime?.historySnapshots),
    ...asArray(persisted.analyticsHistory || persisted.historySnapshots || persisted.reportingHistory)
  ];
}

function buildTimeline(graph, validation, readiness, operationalHealth, requestState, now) {
  const nodeEvents = graph.nodes.flatMap((node) => [
    node.timeline.createdAt ? { at: node.timeline.createdAt, kind: 'job_created', jobId: node.id, label: node.label } : null,
    node.timeline.startedAt ? { at: node.timeline.startedAt, kind: 'job_started', jobId: node.id, label: node.label } : null,
    node.timeline.completedAt ? { at: node.timeline.completedAt, kind: 'job_completed', jobId: node.id, label: node.label } : null,
    node.isFailure && node.timeline.updatedAt ? { at: node.timeline.updatedAt, kind: 'job_failure', jobId: node.id, label: node.failure.code || node.status } : null
  ]).filter(Boolean);
  const reportEvents = [
    {
      at: now,
      kind: readiness.ready ? 'readiness_ready' : 'readiness_blocked',
      jobId: requestState.selectedJobId,
      label: readiness.level
    },
    validation.issueCount > 0
      ? { at: now, kind: 'validation_reported', jobId: null, label: `${validation.issueCount} issues` }
      : null,
    operationalHealth.status !== 'healthy'
      ? { at: now, kind: 'health_reported', jobId: null, label: operationalHealth.status }
      : null
  ].filter(Boolean);

  return [...nodeEvents, ...reportEvents]
    .sort((left, right) => firstString(left.at).localeCompare(firstString(right.at)) || left.kind.localeCompare(right.kind))
    .slice(-50);
}

function analyticsSeverityRank(severity) {
  if (severity === 'critical') return 4;
  if (severity === 'error') return 3;
  if (severity === 'warning') return 2;
  if (severity === 'info') return 1;
  return 0;
}

function analyticsFinding(code, severity, message, evidence = {}, action = 'inspect_job_graph') {
  return {
    code,
    severity,
    message,
    action,
    evidence
  };
}

function buildAnalyticsFindings(graph, counters, validation, readiness, operationalHealth, history, now) {
  const current = history[history.length - 1] || null;
  const previous = history.length > 1 ? history[history.length - 2] : null;
  const findings = [];

  if (previous && current.blockedJobs > previous.blockedJobs) {
    findings.push(analyticsFinding(
      'blocked_jobs_increased',
      'warning',
      'Blocked job count increased since the previous analytics snapshot.',
      {
        fromSnapshotId: previous.snapshotId,
        toSnapshotId: current.snapshotId,
        previousBlockedJobs: previous.blockedJobs,
        currentBlockedJobs: current.blockedJobs,
        delta: current.blockedJobs - previous.blockedJobs
      },
      'open_blocker_triage'
    ));
  }

  if (previous && current.failedJobs > previous.failedJobs) {
    findings.push(analyticsFinding(
      'failed_jobs_increased',
      'error',
      'Failed job count increased since the previous analytics snapshot.',
      {
        fromSnapshotId: previous.snapshotId,
        toSnapshotId: current.snapshotId,
        previousFailedJobs: previous.failedJobs,
        currentFailedJobs: current.failedJobs,
        delta: current.failedJobs - previous.failedJobs
      },
      'inspect_failed_jobs'
    ));
  }

  if (previous && current.proofBackedJobs < previous.proofBackedJobs) {
    findings.push(analyticsFinding(
      'proof_coverage_regressed',
      'warning',
      'Proof-backed job count regressed compared with the prior analytics snapshot.',
      {
        fromSnapshotId: previous.snapshotId,
        toSnapshotId: current.snapshotId,
        previousProofBackedJobs: previous.proofBackedJobs,
        currentProofBackedJobs: current.proofBackedJobs,
        delta: current.proofBackedJobs - previous.proofBackedJobs
      },
      'review_proof_exports'
    ));
  }

  if (previous?.capturedAt) {
    const nowMs = Date.parse(now);
    const previousMs = Date.parse(previous.capturedAt);
    const historyAgeMs = Number.isFinite(nowMs) && Number.isFinite(previousMs) ? nowMs - previousMs : null;
    if (historyAgeMs !== null && historyAgeMs > 3600000) {
      findings.push(analyticsFinding(
        'history_snapshot_stale',
        'info',
        'The previous analytics snapshot is older than the reporting freshness window.',
        {
          previousSnapshotId: previous.snapshotId,
          previousCapturedAt: previous.capturedAt,
          historyAgeMs,
          freshnessWindowMs: 3600000
        },
        'refresh_analytics_history'
      ));
    }
  }

  if (validation.issueCount > 0) {
    findings.push(analyticsFinding(
      'validation_issues_present',
      validation.valid ? 'warning' : 'critical',
      'Validation issues are present in the exportable job graph report.',
      {
        valid: validation.valid,
        issueCount: validation.issueCount,
        issueCodes: Array.from(new Set(validation.issues.map((issue) => issue.code))).sort()
      },
      validation.valid ? 'review_validation_warnings' : 'repair_graph_validation'
    ));
  }

  if (operationalHealth.status !== 'healthy') {
    findings.push(analyticsFinding(
      'operational_health_degraded',
      operationalHealth.status === 'critical' ? 'critical' : 'warning',
      'Hosted-kernel operational health is reflected in the analytics report.',
      {
        status: operationalHealth.status,
        fallbackMode: operationalHealth.fallbackMode,
        degradedReasons: operationalHealth.degradedReasons,
        writeBlockedReasons: operationalHealth.writeBlockedReasons
      },
      'open_runtime_repair'
    ));
  }

  if (graph.boundary.deniedNodes.length > 0 || graph.boundary.deniedEdges.length > 0) {
    findings.push(analyticsFinding(
      'scope_boundary_denials_present',
      graph.boundary.scopePolicy.canWriteScopedGraph ? 'warning' : 'error',
      'The analytics report excludes records denied by tenant or workspace boundary checks.',
      {
        deniedJobCount: graph.boundary.deniedNodes.length,
        deniedDependencyCount: graph.boundary.deniedEdges.length,
        canWriteScopedGraph: graph.boundary.scopePolicy.canWriteScopedGraph,
        writeBlockedReasons: graph.boundary.scopePolicy.writeBlockedReasons
      },
      'review_scope_boundary'
    ));
  }

  if (!graph.integrity.lossless) {
    findings.push(analyticsFinding(
      'dependency_integrity_lossy',
      validation.valid ? 'warning' : 'critical',
      'The analytics report detected dependency records that cannot be executed as a complete visible graph.',
      {
        status: graph.integrity.status,
        malformedDependencyCount: graph.integrity.malformedDependencyCount,
        danglingDependencyCount: graph.integrity.danglingDependencyCount,
        droppedDependencyCount: graph.integrity.droppedDependencyCount,
        duplicateVisibleJobIdCount: graph.integrity.duplicateVisibleJobIdCount,
        duplicateVisibleDependencyIdCount: graph.integrity.duplicateVisibleDependencyIdCount,
        structuralIssueCodes: graph.integrity.structuralIssueCodes
      },
      validation.valid ? 'review_dependency_integrity' : 'repair_graph_validation'
    ));
  }

  return {
    contract: 'hosted-kernel-job-graph-analytics-findings.v1',
    generatedAt: now,
    status: findings.some((finding) => finding.severity === 'critical' || finding.severity === 'error')
      ? 'action_required'
      : findings.some((finding) => finding.severity === 'warning')
        ? 'watch'
        : 'clear',
    counters: {
      total: findings.length,
      critical: findings.filter((finding) => finding.severity === 'critical').length,
      error: findings.filter((finding) => finding.severity === 'error').length,
      warning: findings.filter((finding) => finding.severity === 'warning').length,
      info: findings.filter((finding) => finding.severity === 'info').length,
      visibleJobs: counters.totals.visibleJobs,
      readinessGateFailures: counters.totals.readinessGateFailures
    },
    findings: findings
      .sort((left, right) =>
        analyticsSeverityRank(right.severity) - analyticsSeverityRank(left.severity) ||
        left.code.localeCompare(right.code)
      ),
    exportRows: findings.map((finding) => ({
      code: finding.code,
      severity: finding.severity,
      action: finding.action,
      message: finding.message,
      evidence: JSON.stringify(finding.evidence)
    })),
    proof: {
      currentSnapshotId: current?.snapshotId || null,
      previousSnapshotId: previous?.snapshotId || null,
      readinessLevel: readiness.level,
      operationalHealthStatus: operationalHealth.status
    }
  };
}

function normalizeExportRequest(input) {
  const source = input.exportRequest || input.reportingRequest || input.request?.export || input.clientRuntime?.exportRequest || {};
  const formats = normalizeStringList(source.formats || source.format || source.types)
    .map((format) => format.toLowerCase())
    .filter((format) => ['csv', 'json', 'timeline'].includes(format));
  const destination = source.destination || source.sink || {};

  return {
    contract: 'hosted-kernel-job-graph-export-request.v1',
    requested: normalizeBoolean(source.requested ?? source.enabled, false),
    formats: formats.length ? Array.from(new Set(formats)).sort() : ['csv', 'json'],
    includeTimeline: normalizeBoolean(source.includeTimeline, true),
    includeDeniedScope: normalizeBoolean(source.includeDeniedScope, false),
    destination: {
      kind: firstString(destination.kind, destination.type, source.destinationKind, 'operator_download'),
      route: firstString(destination.route, destination.path, source.destinationRoute, '/operator-userland/job-graph-view/exports'),
      sinkId: firstString(destination.sinkId, destination.id, source.sinkId) || null
    },
    requestedBy: firstString(source.requestedBy, source.principalId, input.principal?.id, input.operator?.id, 'operator'),
    requestedAt: normalizeTimestamp(source.requestedAt, source.createdAt, input.now) || null
  };
}

function stableExportValue(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(stableExportValue);
  if (typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = stableExportValue(value[key]);
        return result;
      }, {});
  }
  return value;
}

function exportChecksum(value) {
  const text = JSON.stringify(stableExportValue(value));
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function exportPayloadForFile(file) {
  if (Array.isArray(file.rows)) {
    return {
      headers: file.headers || [],
      rows: file.rows
    };
  }
  return file.summary || file;
}

function classifyExportFile(key, file) {
  if (key.endsWith('Csv')) return 'csv';
  if (key.toLowerCase().includes('timeline')) return 'timeline';
  if (file.summary) return 'json';
  return 'artifact';
}

function buildExportManifestEntry(key, file, exports, exportRequest, now) {
  const payload = exportPayloadForFile(file);
  const rows = Array.isArray(file.rows) ? file.rows : [];
  const rowCount = Array.isArray(file.rows) ? file.rows.length : 1;
  const headerCount = Array.isArray(file.headers) ? file.headers.length : 0;
  const format = classifyExportFile(key, file);
  const contentType = format === 'csv'
    ? 'text/csv'
    : format === 'timeline'
      ? 'application/vnd.aios.job-graph.timeline+json'
      : 'application/json';
  const sampleRow = rows[0] || null;
  const containsScopeFilteredData =
    key === 'reportJson' ||
    rows.some((row) => row?.deniedJobCount > 0 || row?.deniedDependencyCount > 0 || row?.evidence);

  return {
    contract: 'hosted-kernel-job-graph-export-manifest-entry.v1',
    exportKey: key,
    filename: file.filename,
    format,
    contentType,
    schemaVersion: file.contract || exports.contract,
    route: exports.route,
    requestId: exports.requestId,
    generatedAt: now,
    rowCount,
    headerCount,
    checksum: exportChecksum(payload),
    empty: rowCount === 0,
    requested: exportRequest.formats.includes(format) || (format === 'timeline' && exportRequest.includeTimeline),
    destination: {
      kind: exportRequest.destination.kind,
      route: exportRequest.destination.route,
      sinkId: exportRequest.destination.sinkId
    },
    privacy: {
      includesDeniedScope: Boolean(exportRequest.includeDeniedScope && containsScopeFilteredData),
      containsEvidenceText: rows.some((row) => typeof row?.evidence === 'string' && row.evidence.length > 0),
      scope: exportRequest.includeDeniedScope ? 'operator_requested_scope_detail' : 'visible_graph_only'
    },
    sampleRow
  };
}

function buildHistoryRollup(history, counters, readiness, operationalHealth, now) {
  const ordered = history
    .filter((snapshot) => snapshot.capturedAt)
    .sort((left, right) => firstString(left.capturedAt).localeCompare(firstString(right.capturedAt)));
  const first = ordered[0] || null;
  const current = ordered[ordered.length - 1] || null;
  const previous = ordered.length > 1 ? ordered[ordered.length - 2] : null;
  const lastFive = ordered.slice(-5);
  const ageMs = first && current
    ? Date.parse(current.capturedAt) - Date.parse(first.capturedAt)
    : 0;
  const staleSnapshots = ordered.filter((snapshot) => {
    const capturedMs = Date.parse(snapshot.capturedAt);
    const nowMs = Date.parse(now);
    return Number.isFinite(capturedMs) && Number.isFinite(nowMs) && nowMs - capturedMs > 3600000;
  });
  const degradedSnapshots = ordered.filter((snapshot) =>
    snapshot.readinessLevel !== 'ready' || snapshot.healthStatus !== 'healthy'
  );
  const consecutiveDegradedCount = ordered
    .slice()
    .reverse()
    .findIndex((snapshot) => snapshot.readinessLevel === 'ready' && snapshot.healthStatus === 'healthy');
  const movingAverage = (field) => ratio(
    lastFive.reduce((total, snapshot) => total + normalizeInteger(snapshot[field], 0), 0),
    lastFive.length || 1
  );
  const peak = (field) => lastFive.reduce((result, snapshot) =>
    snapshot[field] > result.value
      ? { value: snapshot[field], snapshotId: snapshot.snapshotId, capturedAt: snapshot.capturedAt }
      : result,
  { value: 0, snapshotId: null, capturedAt: null });

  return {
    contract: 'hosted-kernel-job-graph-history-rollup.v1',
    generatedAt: now,
    snapshotCount: ordered.length,
    window: {
      firstSnapshotId: first?.snapshotId || null,
      firstCapturedAt: first?.capturedAt || null,
      currentSnapshotId: current?.snapshotId || null,
      currentCapturedAt: current?.capturedAt || null,
      observedWindowMs: Number.isFinite(ageMs) ? Math.max(0, ageMs) : 0
    },
    latestDelta: {
      fromSnapshotId: previous?.snapshotId || null,
      toSnapshotId: current?.snapshotId || null,
      visibleJobs: previous && current ? current.visibleJobs - previous.visibleJobs : 0,
      blockedJobs: previous && current ? current.blockedJobs - previous.blockedJobs : 0,
      failedJobs: previous && current ? current.failedJobs - previous.failedJobs : 0,
      proofBackedJobs: previous && current ? current.proofBackedJobs - previous.proofBackedJobs : 0,
      readinessChanged: Boolean(previous && current && previous.readinessLevel !== current.readinessLevel),
      healthChanged: Boolean(previous && current && previous.healthStatus !== current.healthStatus)
    },
    movingAverageLastFive: {
      blockedJobs: movingAverage('blockedJobs'),
      failedJobs: movingAverage('failedJobs'),
      proofBackedJobs: movingAverage('proofBackedJobs')
    },
    peaksLastFive: {
      blockedJobs: peak('blockedJobs'),
      failedJobs: peak('failedJobs')
    },
    freshness: {
      staleSnapshotCount: staleSnapshots.length,
      staleSnapshotIds: staleSnapshots.map((snapshot) => snapshot.snapshotId),
      freshnessWindowMs: 3600000
    },
    reliability: {
      currentReadinessLevel: readiness.level,
      currentHealthStatus: operationalHealth.status,
      degradedSnapshotCount: degradedSnapshots.length,
      consecutiveDegradedCount: consecutiveDegradedCount < 0 ? ordered.length : consecutiveDegradedCount,
      currentCompletionRate: counters.rates.completion,
      currentProofCoverageRate: counters.rates.proofCoverage
    }
  };
}

function buildReportingCommands(exportRequest, publishable, manifest, requestState, history, timeline, input) {
  const commandHistory = new Set(normalizeCommandHistory(input));
  const requestedManifest = manifest.filter((file) => file.requested);
  const commands = [];

  if (exportRequest.requested) {
    commands.push(commandEnvelope('prepare_job_graph_export_manifest', requestState, {
      snapshotId: `reporting:${requestState.requestId}:manifest`,
      formats: exportRequest.formats,
      destination: exportRequest.destination,
      fileCount: requestedManifest.length,
      checksums: requestedManifest.map((file) => ({
        exportKey: file.exportKey,
        checksum: file.checksum
      }))
    }, commandHistory));
  }

  if (publishable) {
    commands.push(commandEnvelope('publish_job_graph_export_bundle', requestState, {
      snapshotId: `reporting:${requestState.requestId}:publish`,
      destination: exportRequest.destination,
      manifestKeys: requestedManifest.map((file) => file.exportKey),
      historySnapshotCount: history.length,
      timelineEventCount: timeline.length
    }, commandHistory));
  }

  return commands;
}

function buildExportReadySummaries(graph, counters, validation, readiness, operationalHealth, requestState, analyticsFindings, now) {
  const ownerRows = Object.entries(counters.byOwner)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([owner, jobs]) => ({
      owner,
      jobs,
      activeJobs: graph.nodes.filter((node) => node.owner === owner && node.isActive).length,
      failedJobs: graph.nodes.filter((node) => node.owner === owner && node.isFailure).length,
      proofBackedJobs: graph.nodes.filter((node) => node.owner === owner && node.proofCount > 0).length
    }));
  const jobRows = graph.nodes.map((node) => ({
    jobId: node.id,
    label: node.label,
    status: node.status,
    owner: node.owner,
    proofCount: node.proofCount,
    blockerCount: node.blockers.length,
    failureCode: node.failure.code,
    durationMs: node.timeline.durationMs,
    updatedAt: node.timeline.updatedAt
  }));

  return {
    contract: 'hosted-kernel-job-graph-export-summaries.v1',
    generatedAt: now,
    route: '/operator-userland/job-graph-view',
    requestId: requestState.requestId,
    files: {
      jobCsv: {
        filename: `job-graph-${requestState.requestId}-jobs.csv`,
        headers: ['jobId', 'label', 'status', 'owner', 'proofCount', 'blockerCount', 'failureCode', 'durationMs', 'updatedAt'],
        rows: jobRows
      },
      ownerCsv: {
        filename: `job-graph-${requestState.requestId}-owners.csv`,
        headers: ['owner', 'jobs', 'activeJobs', 'failedJobs', 'proofBackedJobs'],
        rows: ownerRows
      },
      findingsCsv: {
        filename: `job-graph-${requestState.requestId}-findings.csv`,
        headers: ['code', 'severity', 'action', 'message', 'evidence'],
        rows: analyticsFindings.exportRows
      },
      reportJson: {
        filename: `job-graph-${requestState.requestId}-report.json`,
        summary: {
          counters,
          analyticsFindings: {
            contract: analyticsFindings.contract,
            status: analyticsFindings.status,
            counters: analyticsFindings.counters,
            findings: analyticsFindings.findings
          },
          readiness,
          operationalHealth: {
            status: operationalHealth.status,
            fallbackMode: operationalHealth.fallbackMode,
            degradedReasons: operationalHealth.degradedReasons,
            writeBlockedReasons: operationalHealth.writeBlockedReasons,
            incidentResponse: {
              status: operationalHealth.incidentResponse.status,
              incidentCount: operationalHealth.incidentResponse.incidentCount,
              writeBlockingIncidentCount: operationalHealth.incidentResponse.writeBlockingIncidentCount,
              primaryIncident: operationalHealth.incidentResponse.primaryIncident,
              recoveryChecklist: operationalHealth.incidentResponse.recoveryChecklist,
              commandSafety: operationalHealth.incidentResponse.commandSafety
            },
            retryableJobCount: operationalHealth.retryableJobCount,
            actionableErrorCount: operationalHealth.actionableErrors.length,
            nextRetryAt: operationalHealth.retryHorizon.nextRetryAt,
            blockingGateCodes: operationalHealth.proof.blockingGateCodes
          },
          validation: {
            valid: validation.valid,
            issueCount: validation.issueCount,
            issueCodes: validation.issues.map((issue) => issue.code)
          },
          topology: {
            contract: graph.topology.contract,
            acyclic: graph.topology.acyclic,
            rootJobIds: graph.topology.roots,
            leafJobIds: graph.topology.leaves,
            readyQueue: graph.topology.readyQueue,
            cycleCount: graph.topology.cycles.length,
            dependencyBlockedJobCount: graph.topology.blockedByDependencies.length,
            integrity: {
              contract: graph.integrity.contract,
              status: graph.integrity.status,
              lossless: graph.integrity.lossless,
              executableDependencyCount: graph.integrity.executableDependencyCount,
              malformedDependencyCount: graph.integrity.malformedDependencyCount,
              danglingDependencyCount: graph.integrity.danglingDependencyCount,
              droppedDependencyCount: graph.integrity.droppedDependencyCount,
              structuralIssueCodes: graph.integrity.structuralIssueCodes
            }
          }
        }
      }
    }
  };
}

function timelineLaneSummary(timeline) {
  const lanes = {};
  for (const event of timeline) {
    const lane = event.kind.startsWith('job_')
      ? 'jobs'
      : event.kind.startsWith('readiness_')
        ? 'readiness'
        : event.kind.startsWith('validation_')
          ? 'validation'
          : event.kind.startsWith('health_')
            ? 'health'
            : 'reporting';
    if (!lanes[lane]) lanes[lane] = { lane, eventCount: 0, firstAt: event.at, lastAt: event.at, kinds: {} };
    lanes[lane].eventCount += 1;
    lanes[lane].firstAt = firstString(lanes[lane].firstAt).localeCompare(firstString(event.at)) <= 0 ? lanes[lane].firstAt : event.at;
    lanes[lane].lastAt = firstString(lanes[lane].lastAt).localeCompare(firstString(event.at)) >= 0 ? lanes[lane].lastAt : event.at;
    incrementCounter(lanes[lane].kinds, event.kind);
  }
  return Object.values(lanes).sort((left, right) => left.lane.localeCompare(right.lane));
}

function buildReportingState(graph, counters, validation, readiness, operationalHealth, requestState, history, timeline, exports, analyticsFindings, now, input) {
  const exportRequest = normalizeExportRequest(input);
  const current = history[history.length - 1] || null;
  const previous = history.length > 1 ? history[history.length - 2] : null;
  const manifest = Object.entries(exports.files)
    .map(([key, file]) => buildExportManifestEntry(key, file, exports, exportRequest, now));
  const blockedReasons = [
    ...(!validation.valid ? ['validation_failed'] : []),
    ...(operationalHealth.status === 'critical' ? ['critical_operational_health'] : []),
    ...(!graph.boundary.scopePolicy.canWriteScopedGraph && exportRequest.includeDeniedScope ? ['scope_boundary_not_write_safe'] : [])
  ];
  const publishable = exportRequest.requested && blockedReasons.length === 0;
  const commands = buildReportingCommands(exportRequest, publishable, manifest, requestState, history, timeline, input);
  const pendingCommands = commands.filter((command) => !command.alreadyApplied);
  const historyRollup = buildHistoryRollup(history, counters, readiness, operationalHealth, now);
  const trend = previous && current
    ? {
        fromSnapshotId: previous.snapshotId,
        toSnapshotId: current.snapshotId,
        blockedJobDelta: current.blockedJobs - previous.blockedJobs,
        failedJobDelta: current.failedJobs - previous.failedJobs,
        proofBackedJobDelta: current.proofBackedJobs - previous.proofBackedJobs,
        readinessChanged: previous.readinessLevel !== current.readinessLevel,
        healthChanged: previous.healthStatus !== current.healthStatus
      }
    : {
        fromSnapshotId: null,
        toSnapshotId: current?.snapshotId || null,
        blockedJobDelta: 0,
        failedJobDelta: 0,
        proofBackedJobDelta: 0,
        readinessChanged: false,
        healthChanged: false
      };

  return {
    contract: 'hosted-kernel-job-graph-reporting-state.v1',
    generatedAt: now,
    status: publishable ? 'export_ready' : exportRequest.requested ? 'export_blocked' : 'idle',
    publishable,
    blockedReasons,
    request: exportRequest,
    manifest,
    retention: {
      historyLimit: 25,
      timelineLimit: 50,
      retainedSnapshotCount: history.length,
      retainedTimelineEventCount: timeline.length
    },
    timeline: {
      firstEventAt: timeline[0]?.at || null,
      lastEventAt: timeline[timeline.length - 1]?.at || null,
      lanes: timelineLaneSummary(timeline)
    },
    trend,
    historyRollup,
    commands,
    dispatch: {
      status: pendingCommands.length > 0
        ? publishable
          ? 'ready_to_publish'
          : 'ready_to_prepare'
        : commands.length > 0
          ? 'already_applied'
          : 'idle',
      pendingCommandCount: pendingCommands.length,
      pendingCommandIds: pendingCommands.map((command) => command.commandId),
      nextCommandId: pendingCommands[0]?.commandId || null,
      idempotencyKeys: commands.map((command) => command.idempotencyKey)
    },
    proof: {
      requestId: requestState.requestId,
      selectedJobId: requestState.selectedJobId,
      visibleJobCount: counters.totals.visibleJobs,
      validationIssueCount: validation.issueCount,
      operationalHealthStatus: operationalHealth.status,
      analyticsFindingStatus: analyticsFindings.status,
      analyticsFindingCount: analyticsFindings.counters.total,
      criticalFindingCount: analyticsFindings.counters.critical,
      exportFileCount: manifest.length,
      requestedExportFileCount: manifest.filter((file) => file.requested).length,
      checksumSet: manifest.map((file) => file.checksum).sort(),
      destinationKind: exportRequest.destination.kind
    }
  };
}

function buildAnalyticsReport(graph, validation, readiness, operationalHealth, requestState, now, input) {
  const counters = summarizeCounters(graph, validation, readiness, operationalHealth);
  const currentSnapshot = {
    snapshotId: `${surfaceId}:${requestState.requestId}:analytics:${graph.nodes.length}:${validation.issueCount}`,
    capturedAt: now,
    visibleJobs: counters.totals.visibleJobs,
    activeJobs: counters.totals.activeJobs,
    blockedJobs: counters.totals.blockedJobs,
    terminalJobs: counters.totals.terminalJobs,
    failedJobs: counters.totals.failedJobs,
    proofBackedJobs: counters.totals.proofBackedJobs,
    readinessLevel: readiness.level,
    healthStatus: operationalHealth.status
  };
  const history = [
    ...collectHistoryInputs(input).map(normalizeHistorySnapshot).filter((snapshot) => snapshot.capturedAt),
    currentSnapshot
  ].sort((left, right) => firstString(left.capturedAt).localeCompare(firstString(right.capturedAt))).slice(-25);
  const previous = history.length > 1 ? history[history.length - 2] : null;
  const timeline = buildTimeline(graph, validation, readiness, operationalHealth, requestState, now);
  const findings = buildAnalyticsFindings(graph, counters, validation, readiness, operationalHealth, history, now);
  const exports = buildExportReadySummaries(graph, counters, validation, readiness, operationalHealth, requestState, findings, now);

  return {
    contract: 'hosted-kernel-job-graph-analytics-report.v1',
    counters,
    history,
    deltas: {
      visibleJobs: previous ? currentSnapshot.visibleJobs - previous.visibleJobs : 0,
      activeJobs: previous ? currentSnapshot.activeJobs - previous.activeJobs : 0,
      blockedJobs: previous ? currentSnapshot.blockedJobs - previous.blockedJobs : 0,
      failedJobs: previous ? currentSnapshot.failedJobs - previous.failedJobs : 0,
      proofBackedJobs: previous ? currentSnapshot.proofBackedJobs - previous.proofBackedJobs : 0
    },
    timeline,
    findings,
    exports,
    reporting: buildReportingState(graph, counters, validation, readiness, operationalHealth, requestState, history, timeline, exports, findings, now, input)
  };
}

function buildNextSteps(graph, validation, readiness, operationalHealth, lifecycleControls, providerContracts) {
  const blockingValidationIssues = validation.issues.filter((issue) => issue.severity === 'error');
  const blockingScopeOnly =
    blockingValidationIssues.length > 0 &&
    blockingValidationIssues.every((issue) => firstString(issue.code).startsWith('scope_'));

  if (lifecycleControls.nextAction.enabled && lifecycleControls.nextAction.kind !== 'focus_job') {
    return [{
      kind: lifecycleControls.nextAction.kind,
      label: `Run ${lifecycleControls.nextAction.kind.replace(/_/g, ' ')} for the selected hosted-kernel job`,
      target: lifecycleControls.nextAction.jobId || surfaceName,
      explain: lifecycleControls.nextAction.scheduledFor
        ? 'Lifecycle settings produced a bounded scheduled command for the selected job.'
        : 'Lifecycle controls are writable and expose the next operator command for the selected job.'
    }];
  }

  if (operationalHealth.status !== 'healthy') {
    const incidentSteps = operationalHealth.incidentResponse.incidents
      .slice(0, 8)
      .map((incident) => ({
        kind: incident.action,
        label: incident.message,
        target: incident.targetJobIds[0] || surfaceName,
        explain: operationalHealth.retryQueue.some((plan) => incident.targetJobIds.includes(plan.jobId))
          ? 'The hosted kernel has scheduled a bounded retry; acceptance remains disabled during backoff.'
          : incident.writeBlocking
            ? 'This incident blocks hosted-kernel write handoff until it is repaired.'
            : 'Hosted-kernel health is degraded; review the incident before acceptance.'
      }));
    return incidentSteps.length
      ? incidentSteps
      : operationalHealth.actionableErrors.slice(0, 8).map((error) => ({
          kind: error.action,
          label: error.message,
          target: error.jobId || surfaceName,
          explain: operationalHealth.retryQueue.some((plan) => plan.jobId === error.jobId)
            ? 'The hosted kernel has scheduled a bounded retry; acceptance remains disabled during backoff.'
            : 'Hosted-kernel health must return to healthy before operator graph acceptance is enabled.'
        }));
  }

  if (!graph.boundary.scopePolicy.canWriteScopedGraph && (blockingScopeOnly || validation.valid)) {
    return [{
      kind: 'bind_scope',
      label: 'Bind tenant and workspace scope before hosted-kernel write handoff',
      target: graph.boundary.scopePolicy.effectiveWorkspaceId || graph.boundary.scopePolicy.effectiveTenantId || surfaceName,
      explain: 'Acceptance and lifecycle commands require an auditable tenant/workspace boundary.'
    }];
  }

  if (!validation.valid) {
    return validation.issues
      .filter((issue) => issue.severity === 'error')
      .map((issue) => ({
        kind: 'fix_validation',
        label: issue.message,
        target: issue.edgeId || surfaceName,
        explain: 'The hosted kernel preview cannot be accepted while graph references are unresolved.'
      }));
  }

  if (!providerContracts.negotiation.negotiable) {
    return [{
      kind: 'negotiate_provider_contract',
      label: `Negotiate ${providerContracts.selectedProviderId || 'hosted-kernel'} provider capabilities`,
      target: providerContracts.selectedProviderId || surfaceName,
      explain: providerContracts.negotiation.status === 'sync_stale'
        ? 'Provider sync metadata is stale; refresh before external acceptance handoff.'
        : 'The provider must expose graph acceptance, proof export, and lifecycle dispatch capabilities.'
    }];
  }

  if (!readiness.ready) {
    return readiness.reasons.map((reason, index) => ({
      kind: 'prepare_acceptance',
      label: reason,
      target: graph.blockedNodes[index]?.id || surfaceName,
      explain: 'Operator acceptance requires a preview that is unblocked and backed by proof.'
    }));
  }

  return [{
    kind: 'acceptance',
    label: 'Accept hosted kernel job graph preview',
    target: surfaceName,
    explain: 'All readiness gates passed; clients can submit the accept token to persist operator approval.'
  }];
}

function buildOperatorDecisionPanel(graph, validation, readiness, acceptance, requestState, operationalHealth, lifecycleControls, providerContracts, nextSteps, now) {
  const selectedJob = graph.nodes.find((node) => node.id === requestState.selectedJobId) || null;
  const blockingIssues = validation.issues.filter((issue) => issue.severity === 'error');
  const warningIssues = validation.issues.filter((issue) => issue.severity !== 'error');
  const gateEntries = Object.entries(readiness.gates).map(([gate, passed]) => ({
    gate,
    passed: Boolean(passed),
    label: gate.replace(/([A-Z])/g, ' $1').toLowerCase(),
    status: passed ? 'pass' : 'fail'
  }));
  const failedGateNames = gateEntries
    .filter((entry) => !entry.passed)
    .map((entry) => entry.gate);
  const primaryNextStep = nextSteps[0] || {
    kind: 'inspect_preview',
    label: 'Inspect hosted kernel graph preview',
    target: selectedJob?.id || surfaceName,
    explain: 'The preview needs operator review before a hosted-kernel action is available.'
  };
  const acceptDisabledReasons = [
    ...readiness.reasons,
    ...(!graph.boundary.accessContext.canAcceptGraph ? ['Current operator cannot submit graph acceptance.'] : []),
    ...(operationalHealth.readOnly ? ['Hosted-kernel health is read-only for operator acceptance.'] : []),
    ...(!providerContracts.negotiation.negotiable ? ['Selected provider contract is not ready for acceptance handoff.'] : []),
    ...(!graph.boundary.scopePolicy.canWriteScopedGraph ? ['Tenant/workspace scope is not safe for hosted-kernel write handoff.'] : [])
  ];

  return {
    contract: 'hosted-kernel-job-graph-operator-decision-panel.v1',
    generatedAt: now,
    route: {
      pathname: '/operator-userland/job-graph-view',
      query: {
        requestId: requestState.requestId,
        selectedJobId: requestState.selectedJobId,
        mode: requestState.mode,
        panel: readiness.ready ? 'acceptance' : validation.valid ? 'readiness' : 'validation'
      }
    },
    previewCard: {
      title: selectedJob ? selectedJob.label : 'Hosted kernel job graph',
      subtitle: selectedJob
        ? `${selectedJob.status} job owned by ${selectedJob.owner}`
        : `${graph.nodes.length} visible jobs in the hosted-kernel graph`,
      selectedJobId: selectedJob?.id || null,
      selectedStatus: selectedJob?.status || null,
      selectedOwner: selectedJob?.owner || null,
      totals: {
        jobs: graph.nodes.length,
        dependencies: graph.edges.length,
        blocked: graph.blockedNodes.length,
        failed: operationalHealth.failedJobCount,
        proofBacked: graph.proofBackedNodes.length,
        deniedByBoundary: graph.boundary.deniedNodes.length + graph.boundary.deniedEdges.length
      }
    },
    readinessSummary: {
      level: readiness.level,
      ready: readiness.ready,
      failedGates: failedGateNames,
      gates: gateEntries,
      explanation: readiness.ready
        ? 'All hosted-kernel readiness gates passed for this scoped graph.'
        : readiness.reasons[0] || 'The graph preview needs operator attention before acceptance.'
    },
    validationSummary: {
      valid: validation.valid,
      issueCount: validation.issueCount,
      blockingIssueCount: blockingIssues.length,
      warningIssueCount: warningIssues.length,
      visibleIssues: validation.issues.slice(0, 6).map((issue) => ({
        code: issue.code,
        severity: issue.severity,
        message: issue.message,
        target: issue.jobId || issue.edgeId || surfaceName
      }))
    },
    acceptanceCta: {
      enabled: acceptance.accepted && !operationalHealth.readOnly,
      action: acceptance.action,
      acceptToken: acceptance.acceptToken,
      providerId: acceptance.providerId,
      commandSink: acceptance.externalHandoff.commandSink,
      correlationId: acceptance.externalHandoff.correlationId,
      disabledReasons: acceptance.accepted && !operationalHealth.readOnly ? [] : acceptDisabledReasons,
      proofBackedJobIds: graph.proofBackedNodes.map((node) => node.id)
    },
    nextStep: {
      kind: primaryNextStep.kind,
      label: primaryNextStep.label,
      target: primaryNextStep.target,
      explain: primaryNextStep.explain,
      commandId: lifecycleControls.nextAction.enabled
        ? lifecycleControls.controls.find((control) => control.kind === lifecycleControls.nextAction.kind)?.command?.commandId || null
        : null,
      scheduledFor: lifecycleControls.nextAction.scheduledFor || operationalHealth.retryQueue[0]?.nextRetryAt || null
    },
    proof: {
      selectedJobProofCount: selectedJob?.proofCount || 0,
      proofBackedJobCount: graph.proofBackedNodes.length,
      evidenceRequirementMet: readiness.gates.hasProof,
      auditFields: ['requestId', 'selectedJobId', 'readiness.level', 'acceptance.acceptToken', 'providerContracts.selectedProviderId']
    }
  };
}

function buildClientPreviewAcceptanceContract(graph, validation, readiness, acceptance, requestState, operationalHealth, lifecycleControls, providerContracts, scopedMutationAuthorization, nextSteps, now) {
  const selectedJob = graph.nodes.find((node) => node.id === requestState.selectedJobId) || null;
  const validationErrors = validation.issues.filter((issue) => issue.severity === 'error');
  const validationWarnings = validation.issues.filter((issue) => issue.severity !== 'error');
  const failedGateEntries = Object.entries(readiness.gates)
    .filter(([, passed]) => !passed)
    .map(([gate]) => gate);
  const primaryNextStep = nextSteps[0] || {
    kind: 'inspect_graph',
    label: 'Inspect hosted kernel graph preview',
    target: selectedJob?.id || surfaceName,
    explain: 'No write action is currently available for the visible graph.'
  };
  const acceptanceDecision = scopedMutationAuthorization.decisions
    .find((decision) => decision.kind === 'accept_graph_preview') || null;
  const previewId = `${surfaceId}:${requestState.requestId}:client-preview:${graph.nodes.length}:${validation.issueCount}:${readiness.level}`;
  const status = readiness.ready && acceptanceDecision?.allowed
    ? 'acceptance_ready'
    : validationErrors.length > 0
      ? 'validation_blocked'
      : operationalHealth.readOnly
        ? 'read_only'
        : failedGateEntries.length > 0
          ? 'readiness_blocked'
          : 'review_required';
  const cards = [
    {
      key: 'graph',
      label: 'Graph',
      status: graph.nodes.length > 0 && graph.topology.acyclic && graph.integrity.lossless ? 'pass' : 'fail',
      value: graph.nodes.length,
      detail: graph.integrity.lossless
        ? `${graph.edges.length} dependencies, ${graph.topology.readyQueue.length} ready jobs`
        : `${graph.integrity.droppedDependencyCount} dependency issues, ${graph.topology.readyQueue.length} ready jobs`
    },
    {
      key: 'proof',
      label: 'Proof',
      status: readiness.gates.hasProof ? 'pass' : 'fail',
      value: graph.proofBackedNodes.length,
      detail: `${graph.terminalNodes.length} terminal jobs, ${graph.proofBackedNodes.length} proof-backed`
    },
    {
      key: 'scope',
      label: 'Scope',
      status: graph.boundary.scopePolicy.canWriteScopedGraph ? 'pass' : 'fail',
      value: graph.boundary.deniedNodes.length + graph.boundary.deniedEdges.length,
      detail: graph.boundary.scopePolicy.canWriteScopedGraph
        ? 'Tenant/workspace write boundary is ready'
        : graph.boundary.scopePolicy.writeBlockedReasons.join(', ')
    },
    {
      key: 'provider',
      label: 'Provider',
      status: providerContracts.negotiation.negotiable ? 'pass' : 'fail',
      value: providerContracts.negotiation.missingCapabilities.length,
      detail: providerContracts.negotiation.negotiable
        ? `${providerContracts.selectedProviderId} handoff ready`
        : providerContracts.negotiation.blockedReasons.join(', ')
    }
  ];

  return {
    contract: 'hosted-kernel-job-graph-client-preview-acceptance.v1',
    previewId,
    generatedAt: now,
    status,
    route: {
      pathname: '/operator-userland/job-graph-view',
      query: {
        requestId: requestState.requestId,
        selectedJobId: selectedJob?.id || requestState.selectedJobId,
        mode: requestState.mode,
        preview: status,
        panel: validationErrors.length > 0 ? 'validation' : readiness.ready ? 'acceptance' : 'readiness'
      }
    },
    selectedJob: selectedJob
      ? {
          id: selectedJob.id,
          label: selectedJob.label,
          status: selectedJob.status,
          owner: selectedJob.owner,
          proofCount: selectedJob.proofCount,
          blockerCount: selectedJob.blockers.length,
          dependencyCount: dependenciesFor(graph, selectedJob.id).length,
          dependentCount: dependentsFor(graph, selectedJob.id).length
        }
      : null,
    previewCards: cards,
    readiness: {
      level: readiness.level,
      ready: readiness.ready,
      failedGates: failedGateEntries,
      blockedReasons: readiness.reasons,
      gateCount: Object.keys(readiness.gates).length
    },
    validation: {
      status: validation.valid ? 'valid' : 'invalid',
      valid: validation.valid,
      issueCount: validation.issueCount,
      errorCount: validationErrors.length,
      warningCount: validationWarnings.length,
      topIssues: validation.issues.slice(0, 5).map((issue) => ({
        code: issue.code,
        severity: issue.severity,
        message: issue.message,
        targetId: issue.jobId || issue.edgeId || null
      }))
    },
    acceptance: {
      enabled: Boolean(acceptance.accepted && acceptanceDecision?.allowed && !operationalHealth.readOnly),
      action: acceptance.action,
      acceptToken: acceptance.acceptToken,
      providerId: acceptance.providerId,
      commandSink: acceptance.externalHandoff.commandSink,
      correlationId: acceptance.externalHandoff.correlationId,
      authorizationId: scopedMutationAuthorization.authorizationId,
      blockedReasons: Array.from(new Set([
        ...acceptance.requiredBeforeAccept,
        ...scopedMutationAuthorization.blockedReasons,
        ...(operationalHealth.readOnly ? ['operational_health_read_only'] : [])
      ])).filter(Boolean)
    },
    explainableNextStep: {
      kind: primaryNextStep.kind,
      label: primaryNextStep.label,
      targetId: primaryNextStep.target,
      reason: primaryNextStep.explain,
      commandId: lifecycleControls.nextAction.enabled
        ? lifecycleControls.controls.find((control) => control.kind === lifecycleControls.nextAction.kind)?.command?.commandId || null
        : null,
      routeQueryPatch: {
        selectedJobId: primaryNextStep.target === surfaceName ? selectedJob?.id || null : primaryNextStep.target,
        mode: primaryNextStep.kind.includes('validation') || primaryNextStep.kind.includes('scope') ? 'triage' : requestState.mode,
        action: primaryNextStep.kind
      }
    },
    proof: {
      proofBackedJobIds: graph.proofBackedNodes.map((node) => node.id),
      validationIssueCodes: validation.issues.map((issue) => issue.code),
      failedReadinessGates: failedGateEntries,
      mutationAuthorizationStatus: scopedMutationAuthorization.status,
      providerHandoffStatus: providerContracts.externalHandoff.status,
      healthStatus: operationalHealth.status
    }
  };
}

export function describeJobGraphViewSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const graph = buildGraph(input);
  const validationSummary = summarizeValidation(graph);
  const requestState = normalizeRequestState(input, graph);
  const providerContracts = buildProviderContracts(input, requestState, now);
  const commandRecovery = buildCommandRecoveryState(input, requestState, now);
  const operationalHealth = buildOperationalHealth(graph, validationSummary, input, now, providerContracts, commandRecovery);
  const readiness = buildReadiness(graph, validationSummary, operationalHealth, providerContracts, commandRecovery);
  const acceptance = buildAcceptance(graph, readiness, providerContracts);
  const lifecycleControls = buildLifecycleControls(graph, validationSummary, readiness, requestState, operationalHealth, now, input);
  const scopedMutationAuthorization = buildScopedMutationAuthorization(
    graph,
    validationSummary,
    readiness,
    requestState,
    operationalHealth,
    providerContracts,
    lifecycleControls,
    acceptance,
    now
  );
  const nextSteps = buildNextSteps(graph, validationSummary, readiness, operationalHealth, lifecycleControls, providerContracts);
  const decisionPanel = buildOperatorDecisionPanel(graph, validationSummary, readiness, acceptance, requestState, operationalHealth, lifecycleControls, providerContracts, nextSteps, now);
  const clientPreview = buildClientPreviewAcceptanceContract(
    graph,
    validationSummary,
    readiness,
    acceptance,
    requestState,
    operationalHealth,
    lifecycleControls,
    providerContracts,
    scopedMutationAuthorization,
    nextSteps,
    now
  );
  const mailchimpPreview = buildMailchimpPreviewAcceptanceContract(
    graph,
    validationSummary,
    readiness,
    acceptance,
    requestState,
    operationalHealth,
    providerContracts,
    scopedMutationAuthorization,
    nextSteps,
    now
  );
  const persistedState = buildPersistedState(graph, validationSummary, readiness, requestState, now, input, commandRecovery);
  const analytics = buildAnalyticsReport(graph, validationSummary, readiness, operationalHealth, requestState, now, input);
  const workflowHandoff = buildWorkflowHandoff(graph, validationSummary, readiness, acceptance, requestState, operationalHealth, providerContracts);
  const clientWorkflowHandoff = buildClientWorkflowHandoff(
    graph,
    requestState,
    operationalHealth,
    providerContracts,
    workflowHandoff,
    scopedMutationAuthorization,
    mailchimpPreview,
    input,
    now
  );
  const clientRuntime = buildClientRuntimeState(
    graph,
    validationSummary,
    readiness,
    requestState,
    persistedState,
    operationalHealth,
    lifecycleControls,
    providerContracts,
    decisionPanel,
    workflowHandoff,
    clientWorkflowHandoff,
    scopedMutationAuthorization,
    analytics,
    clientPreview,
    mailchimpPreview
  );
  const evidence = asArray(input.evidence);

  return {
    ok: validationSummary.valid,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'hosted-kernel-job-graph-preview.v1',
    route: '/operator-userland/job-graph-view',
    preview: buildPreview(graph),
    operationalHealth,
    analytics,
    readiness,
    acceptance,
    providerContracts,
    lifecycleControls,
    scopedMutationAuthorization,
    decisionPanel,
    clientPreview,
    mailchimpPreview,
    clientRuntime,
    workflowHandoff,
    clientWorkflowHandoff,
    validationSummary,
    nextSteps,
    audit: {
      proof: {
        evidenceCount: evidence.length,
        proofBackedJobIds: graph.proofBackedNodes.map((node) => node.id),
        danglingDependencyIds: graph.danglingEdges.map((edge) => edge.id),
        malformedDependencyIds: graph.malformedEdges.map((edge) => edge.id),
        dependencyTruth: graph.integrity.handoffClaims.dependencyTruth
      },
      boundary: {
        contract: graph.boundary.contract,
        principalId: graph.boundary.accessContext.principalId,
        tenantId: graph.boundary.accessContext.tenantId || null,
        workspaceId: graph.boundary.accessContext.workspaceId || null,
        roles: graph.boundary.accessContext.roles,
        permissions: graph.boundary.accessContext.permissions,
        workspaceGrants: graph.boundary.accessContext.workspaceGrants,
        scopePolicy: {
          contract: graph.boundary.scopePolicy.contract,
          effectiveTenantId: graph.boundary.scopePolicy.effectiveTenantId,
          effectiveWorkspaceId: graph.boundary.scopePolicy.effectiveWorkspaceId,
          canWriteScopedGraph: graph.boundary.scopePolicy.canWriteScopedGraph,
          canBindUnscopedGraph: graph.boundary.scopePolicy.canBindUnscopedGraph,
          workspaceWriteAuthorized: graph.boundary.scopePolicy.workspaceWriteAuthorized,
          workspaceGrant: graph.boundary.scopePolicy.workspaceGrant,
          writeBlockedReasons: graph.boundary.scopePolicy.writeBlockedReasons,
          missingScope: graph.boundary.scopePolicy.missingScope,
          handoffClaims: graph.boundary.scopePolicy.handoffClaims
        },
        visibleNodeCount: graph.boundary.visibleNodeCount,
        visibleEdgeCount: graph.boundary.visibleEdgeCount,
        deniedNodeIds: graph.boundary.deniedNodes.map((node) => node.jobId),
        deniedEdgeIds: graph.boundary.deniedEdges.map((edge) => edge.edgeId),
        malformedEdges: graph.boundary.malformedEdges,
        integrity: graph.boundary.integrity
      },
      topology: {
        contract: graph.topology.contract,
        acyclic: graph.topology.acyclic,
        rootJobIds: graph.topology.roots,
        leafJobIds: graph.topology.leaves,
        readyQueue: graph.topology.readyQueue,
        cycleCount: graph.topology.cycles.length,
        cycleJobIds: graph.topology.cycles.map((cycle) => cycle.jobIds),
        dependencyBlockedJobCount: graph.topology.blockedByDependencies.length,
        dependencyBlockedJobs: graph.topology.blockedByDependencies.map((entry) => ({
          jobId: entry.jobId,
          waitingOn: entry.waitingOn
        })),
        integrity: graph.integrity
      },
      request: {
        requestId: requestState.requestId,
        selectedJobId: requestState.selectedJobId,
        selectedJobFound: requestState.selectedJobFound,
        workflowHandoffStatus: workflowHandoff.status
      },
      clientWorkflowHandoff: {
        contract: clientWorkflowHandoff.contract,
        handoffId: clientWorkflowHandoff.handoffId,
        status: clientWorkflowHandoff.status,
        action: clientWorkflowHandoff.action,
        visible: clientWorkflowHandoff.visible,
        dispatchable: clientWorkflowHandoff.dispatchable,
        routeMode: clientWorkflowHandoff.route.query.mode,
        targetJobId: clientWorkflowHandoff.targetJobId,
        commandId: clientWorkflowHandoff.dispatchRequest?.commandId || null,
        alreadyApplied: Boolean(clientWorkflowHandoff.dispatchRequest?.alreadyApplied),
        queuedHandoffCount: clientWorkflowHandoff.queue.length,
        completedHandoffCount: clientWorkflowHandoff.proof.completedHandoffCount,
        dismissedHandoffCount: clientWorkflowHandoff.proof.dismissedHandoffCount,
        mailchimpWorkflow: {
          contract: clientWorkflowHandoff.mailchimpWorkflow.contract,
          handoffId: clientWorkflowHandoff.mailchimpWorkflow.handoffId,
          status: clientWorkflowHandoff.mailchimpWorkflow.status,
          requested: clientWorkflowHandoff.mailchimpWorkflow.requested,
          action: clientWorkflowHandoff.mailchimpWorkflow.action,
          dispatchable: clientWorkflowHandoff.mailchimpWorkflow.dispatchable,
          dryRun: clientWorkflowHandoff.mailchimpWorkflow.dryRun,
          commandId: clientWorkflowHandoff.mailchimpWorkflow.command?.commandId || null,
          alreadyApplied: Boolean(clientWorkflowHandoff.mailchimpWorkflow.command?.alreadyApplied),
          blockedReasons: clientWorkflowHandoff.mailchimpWorkflow.blockedReasons,
          audienceId: clientWorkflowHandoff.mailchimpWorkflow.target.audienceId,
          campaignId: clientWorkflowHandoff.mailchimpWorkflow.target.campaignId,
          routePanel: clientWorkflowHandoff.mailchimpWorkflow.route.query.panel
        }
      },
      scopedMutationAuthorization: {
        contract: scopedMutationAuthorization.contract,
        authorizationId: scopedMutationAuthorization.authorizationId,
        status: scopedMutationAuthorization.status,
        allowsExternalHandoff: scopedMutationAuthorization.allowsExternalHandoff,
        allowsAcceptance: scopedMutationAuthorization.allowsAcceptance,
        allowsLifecycleDispatch: scopedMutationAuthorization.allowsLifecycleDispatch,
        blockedReasons: scopedMutationAuthorization.blockedReasons,
        auditClaims: scopedMutationAuthorization.auditClaims,
        decisions: scopedMutationAuthorization.decisions.map((decision) => ({
          kind: decision.kind,
          requested: decision.requested,
          allowed: decision.allowed,
          status: decision.status,
          targetJobId: decision.targetJobId,
          targetTenantId: decision.targetTenantId,
          targetWorkspaceId: decision.targetWorkspaceId,
          providerId: decision.providerId,
          workspaceGrantId: decision.claims.workspaceGrantId,
          blockedReasons: decision.blockedReasons
        }))
      },
      providerContracts: {
        contract: providerContracts.contract,
        selectedProviderId: providerContracts.selectedProviderId,
        negotiationStatus: providerContracts.negotiation.status,
        recommendedProviderId: providerContracts.negotiation.recommendedProviderId,
        handoffPhase: providerContracts.negotiation.handoffPhase,
        requiredCapabilities: providerContracts.requiredCapabilities,
        missingCapabilities: providerContracts.negotiation.missingCapabilities,
        blockedReasons: providerContracts.negotiation.blockedReasons,
        staleProviderIds: providerContracts.negotiation.staleProviderIds,
        externalHandoffStatus: providerContracts.externalHandoff.status,
        externalSystem: providerContracts.externalHandoff.externalSystem,
        commandSink: providerContracts.externalHandoff.commandSink,
        correlationId: providerContracts.externalHandoff.correlationId,
        syncCursor: providerContracts.externalHandoff.syncCursor,
        ackMode: providerContracts.externalHandoff.ackMode,
        externalState: providerContracts.externalHandoff.externalState,
        handoffTtlMs: providerContracts.externalHandoff.handoffTtlMs,
        readyProviderIds: providerContracts.negotiationPlan.proof.readyProviderIds,
        blockedProviderIds: providerContracts.negotiationPlan.proof.blockedProviderIds,
        commandSinkBoundProviderIds: providerContracts.negotiationPlan.proof.commandSinkBoundProviderIds
      },
      persistence: {
        snapshotId: persistedState.snapshotId,
        restartStatus: persistedState.restartStatus,
        persistedGraphChanged: persistedState.persistedGraphChanged,
        commandRecoveryStatus: persistedState.commandRecovery?.status || 'not_evaluated',
        commandRecoveryRestartSafe: persistedState.commandRecovery?.restartSafe ?? true,
        inFlightCommandIds: persistedState.commandRecovery?.inFlightCommandIds || [],
        staleCommandIds: persistedState.commandRecovery?.staleCommandIds || [],
        failedCommandIds: persistedState.commandRecovery?.failedCommandIds || [],
        commandIds: persistedState.commands.map((command) => command.commandId),
        replaySkippedCommandIds: persistedState.commands
          .filter((command) => command.alreadyApplied)
          .map((command) => command.commandId)
      },
      operationalHealth: {
        contract: operationalHealth.contract,
        status: operationalHealth.status,
        readOnly: operationalHealth.readOnly,
        fallbackMode: operationalHealth.fallbackMode,
        degradedReasons: operationalHealth.degradedReasons,
        writeBlockedReasons: operationalHealth.writeBlockedReasons,
        failedJobCount: operationalHealth.failedJobCount,
        retryableJobCount: operationalHealth.retryableJobCount,
        exhaustedFailureCount: operationalHealth.exhaustedFailureCount,
        nextRetryAt: operationalHealth.retryHorizon.nextRetryAt,
        incidentResponseStatus: operationalHealth.incidentResponse.status,
        primaryIncidentCode: operationalHealth.incidentResponse.primaryIncident?.code || null,
        primaryIncidentAction: operationalHealth.incidentResponse.primaryIncident?.action || null,
        writeBlockingIncidentCount: operationalHealth.incidentResponse.writeBlockingIncidentCount,
        recoveryChecklist: operationalHealth.incidentResponse.recoveryChecklist,
        actionableErrorCodes: operationalHealth.actionableErrors.map((error) => error.code),
        incidentCodes: operationalHealth.incidentResponse.incidents.map((incident) => incident.code),
        escalationOwners: operationalHealth.incidentResponse.escalation.owners,
        healthGates: operationalHealth.healthGates.map((gate) => ({
          code: gate.code,
          passed: gate.passed,
          severity: gate.severity,
          writeBlocking: gate.writeBlocking
        })),
        proof: operationalHealth.proof
      },
      lifecycleControls: {
        contract: lifecycleControls.contract,
        writable: lifecycleControls.writable,
        selectedJobId: lifecycleControls.selectedJobId,
        blockedReasons: lifecycleControls.blockedReasons,
        nextAction: lifecycleControls.nextAction,
        dispatchPlan: {
          contract: lifecycleControls.dispatchPlan.contract,
          status: lifecycleControls.dispatchPlan.status,
          dispatchable: lifecycleControls.dispatchPlan.dispatchable,
          dryRun: lifecycleControls.dispatchPlan.dryRun,
          requestedActionKind: lifecycleControls.dispatchPlan.requestedAction.kind,
          requestedActionSource: lifecycleControls.dispatchPlan.requestedAction.source,
          selectedCommandId: lifecycleControls.dispatchPlan.selectedCommandId,
          idempotencyKey: lifecycleControls.dispatchPlan.idempotencyKey,
          scheduledFor: lifecycleControls.dispatchPlan.scheduledFor,
          expiresAt: lifecycleControls.dispatchPlan.expiresAt,
          blockedReasons: lifecycleControls.dispatchPlan.blockedReasons,
          problemCodes: lifecycleControls.dispatchPlan.requestedAction.problems.map((problem) => problem.code)
        },
        commandIds: lifecycleControls.commands.map((command) => command.commandId),
        alreadyAppliedCommandIds: lifecycleControls.proof.alreadyAppliedCommandIds,
        settingsInvalidCodes: lifecycleControls.settings.invalid.map((issue) => issue.code),
        transitionState: {
          contract: lifecycleControls.transitionState.contract,
          lifecycleStatus: lifecycleControls.transitionState.lifecycleStatus,
          schedulePolicy: lifecycleControls.transitionState.schedulePolicy,
          nextTransition: lifecycleControls.transitionState.nextTransition,
          enabledTransitionKinds: lifecycleControls.transitionState.proof.enabledTransitionKinds,
          blockedTransitionKinds: lifecycleControls.transitionState.proof.blockedTransitionKinds,
          transitions: lifecycleControls.transitionState.transitions.map((transition) => ({
            kind: transition.kind,
            enabled: transition.enabled,
            commandId: transition.commandId,
            fromStatus: transition.fromStatus,
            fromLifecycleStatus: transition.fromLifecycleStatus,
            blockedReasons: transition.blockedReasons,
            statePatch: transition.statePatch
          }))
        }
      },
      decisionPanel: {
        contract: decisionPanel.contract,
        panel: decisionPanel.route.query.panel,
        selectedJobId: decisionPanel.previewCard.selectedJobId,
        failedGates: decisionPanel.readinessSummary.failedGates,
        blockingIssueCount: decisionPanel.validationSummary.blockingIssueCount,
        acceptanceEnabled: decisionPanel.acceptanceCta.enabled,
        nextStepKind: decisionPanel.nextStep.kind,
        nextStepTarget: decisionPanel.nextStep.target
      },
      clientPreview: {
        contract: clientPreview.contract,
        previewId: clientPreview.previewId,
        status: clientPreview.status,
        routePanel: clientPreview.route.query.panel,
        selectedJobId: clientPreview.selectedJob?.id || null,
        readinessLevel: clientPreview.readiness.level,
        failedReadinessGates: clientPreview.readiness.failedGates,
        validationStatus: clientPreview.validation.status,
        validationIssueCount: clientPreview.validation.issueCount,
        acceptanceEnabled: clientPreview.acceptance.enabled,
        acceptanceAuthorizationId: clientPreview.acceptance.authorizationId,
        nextStepKind: clientPreview.explainableNextStep.kind,
        nextStepTargetId: clientPreview.explainableNextStep.targetId,
        cardStatuses: clientPreview.previewCards.map((card) => ({
          key: card.key,
          status: card.status,
          value: card.value
        }))
      },
      analytics: {
        contract: analytics.contract,
        snapshotCount: analytics.history.length,
        visibleJobs: analytics.counters.totals.visibleJobs,
        completionRate: analytics.counters.rates.completion,
        proofCoverageRate: analytics.counters.rates.proofCoverage,
        findingStatus: analytics.findings.status,
        findingCounters: analytics.findings.counters,
        findingCodes: analytics.findings.findings.map((finding) => finding.code),
        exportFiles: Object.values(analytics.exports.files).map((file) => file.filename),
        reporting: {
          contract: analytics.reporting.contract,
          status: analytics.reporting.status,
          publishable: analytics.reporting.publishable,
          blockedReasons: analytics.reporting.blockedReasons,
          requestedFormats: analytics.reporting.request.formats,
          destinationKind: analytics.reporting.request.destination.kind,
          manifest: analytics.reporting.manifest,
          retainedSnapshotCount: analytics.reporting.retention.retainedSnapshotCount,
          retainedTimelineEventCount: analytics.reporting.retention.retainedTimelineEventCount,
          timelineLanes: analytics.reporting.timeline.lanes.map((lane) => ({
            lane: lane.lane,
            eventCount: lane.eventCount,
            firstAt: lane.firstAt,
            lastAt: lane.lastAt,
            kinds: lane.kinds
          })),
          trend: analytics.reporting.trend,
          proof: analytics.reporting.proof
        }
      },
      generatedBy: surfaceId,
      inputContract: firstString(input.contract, input.schema, 'job-graph-input.v1')
    },
    evidence
  };
}

export default describeJobGraphViewSurface;
