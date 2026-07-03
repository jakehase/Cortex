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
  return {
    id: firstString(raw?.id, `edge-${index + 1}`),
    from: firstString(raw?.from, raw?.source, raw?.parent),
    to: firstString(raw?.to, raw?.target, raw?.child),
    tenantId: firstString(raw?.tenantId, raw?.tenant, raw?.scope?.tenantId),
    workspaceId: firstString(raw?.workspaceId, raw?.workspace, raw?.scope?.workspaceId),
    relation: firstString(raw?.relation, raw?.type, 'depends_on')
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
  const allEdges = rawEdges.map(normalizeEdge).filter((edge) => edge.from || edge.to);
  const deniedEdges = allEdges
    .map((edge) => {
      const reason = boundaryDenialForEdge(edge, accessContext);
      if (reason) return { edge, reason };
      if (deniedNodeIds.has(edge.from) || deniedNodeIds.has(edge.to)) return { edge, reason: 'endpoint_out_of_scope' };
      return { edge, reason: '' };
    })
    .filter((entry) => entry.reason);
  const deniedEdgeIds = new Set(deniedEdges.map((entry) => entry.edge.id));
  const edges = allEdges.filter((edge) => !deniedEdgeIds.has(edge.id));
  const danglingEdges = edges.filter((edge) => !nodeIds.has(edge.from) || !nodeIds.has(edge.to));
  const blockedNodes = nodes.filter((node) => node.status === 'blocked' || node.blockers.length > 0);
  const activeNodes = nodes.filter((node) => node.isActive && node.status !== 'blocked');
  const terminalNodes = nodes.filter((node) => node.isTerminal);
  const proofBackedNodes = nodes.filter((node) => node.proofCount > 0);
  const topology = buildTopology(nodes, edges);
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
    }))
  };

  return {
    nodes,
    edges,
    danglingEdges,
    blockedNodes,
    activeNodes,
    terminalNodes,
    proofBackedNodes,
    topology,
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

  return {
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
}

function providerCapabilityDelta(provider) {
  const supported = new Set(provider.capabilities);
  const missingCapabilities = REQUIRED_PROVIDER_CAPABILITIES.filter((capability) => !supported.has(capability));
  const extraCapabilities = provider.capabilities.filter((capability) => !REQUIRED_PROVIDER_CAPABILITIES.includes(capability));
  const blockedReasons = [
    ...missingCapabilities.map((capability) => `missing:${capability}`),
    ...(provider.sync.stale ? ['sync_stale'] : []),
    ...(!provider.handoff.commandSink ? ['command_sink_missing'] : []),
    ...(provider.handoff.handoffTtlMs < 1000 ? ['handoff_ttl_too_short'] : [])
  ];

  return {
    contract: 'hosted-kernel-job-graph-provider-capability-delta.v1',
    providerId: provider.providerId,
    supportedCapabilities: provider.capabilities,
    missingCapabilities,
    extraCapabilities,
    syncFresh: !provider.sync.stale,
    handoffBound: Boolean(provider.handoff.commandSink),
    blockedReasons,
    score:
      (REQUIRED_PROVIDER_CAPABILITIES.length - missingCapabilities.length) * 10 +
      (provider.sync.stale ? 0 : 5) +
      (provider.handoff.commandSink ? 3 : 0) +
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
          commandSink: provider.handoff.commandSink,
          externalSystem: provider.handoff.externalSystem,
          returnRoute: provider.handoff.returnRoute,
          ackMode: provider.handoff.ackMode,
          externalState: provider.handoff.externalState,
          handoffTtlMs: provider.handoff.handoffTtlMs
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
    : selectedProvider?.sync.stale
      ? 'sync_stale'
      : selectedProvider && !selectedProvider.handoff.commandSink
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
      staleProviderIds: providers.filter((provider) => provider.sync.stale).map((provider) => provider.providerId),
      blockedReasons,
      recommendedProviderId: negotiationPlan.recommendedProviderId,
      handoffPhase: negotiationPlan.handoffPhase
    },
    negotiationPlan,
    externalHandoff: selectedProvider
      ? {
          status: negotiable ? 'handoff_ready' : 'handoff_blocked',
          providerId: selectedProvider.providerId,
          commandSink: selectedProvider.handoff.commandSink,
          externalSystem: selectedProvider.handoff.externalSystem,
          correlationId: `${surfaceId}:${requestState.requestId}:${selectedProvider.providerId}`,
          returnRoute: selectedProvider.handoff.returnRoute,
          syncCursor: selectedProvider.sync.cursor,
          correlationIdField: selectedProvider.handoff.correlationIdField,
          ackMode: selectedProvider.handoff.ackMode,
          externalState: selectedProvider.handoff.externalState,
          handoffTtlMs: selectedProvider.handoff.handoffTtlMs,
          handoffPhase: negotiationPlan.handoffPhase,
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

function summarizeHealthGates(graph, validation, providerContracts, runtimeStatus, runtimeErrors, retryQueue, exhaustedFailures) {
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
      graph.topology.acyclic && graph.danglingEdges.length === 0,
      'critical',
      graph.topology.acyclic && graph.danglingEdges.length === 0
        ? 'Graph topology is acyclic and all dependency endpoints are visible.'
        : 'Graph topology has cycles or dangling dependencies.',
      {
        cycleCount: graph.topology.cycles.length,
        danglingDependencyIds: graph.danglingEdges.map((edge) => edge.id)
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
        staleProviderIds
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
    )
  ];
}

function buildOperationalHealth(graph, validation, input, now, providerContracts = null) {
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
    exhaustedFailures
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
    proof: {
      generatedAt: now,
      gateCount: healthGates.length,
      blockingGateCodes: blockingHealthGates.map((gate) => gate.code),
      warningGateCodes: warningHealthGates.map((gate) => gate.code),
      providerId: providerContracts?.selectedProviderId || null,
      providerNegotiationStatus: providerContracts?.negotiation?.status || 'not_evaluated',
      validationIssueCount: validation.issueCount
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

function normalizeCommandHistory(input) {
  const persisted = input.persistedState || input.savedState || input.clientRuntime?.persistedState || {};
  const persistedCommandIds = normalizeCommandIdList(persisted.commandLog || persisted.commands || input.commandLog);
  const snapshotCommandIds = asArray(persisted.snapshots || persisted.snapshotLedger || persisted.recoveryLog)
    .flatMap((snapshot) => normalizeCommandIdList(snapshot?.commandIds || snapshot?.commands || snapshot?.commandLog));
  return Array.from(new Set([...persistedCommandIds, ...snapshotCommandIds]));
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
  return `${surfaceId}|${requestState.requestId}|${nodePart}|${edgePart}`;
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

function buildPersistedState(graph, validation, readiness, requestState, now, input) {
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
      canResumeWithoutOperator: validation.valid && !stalePersistedSelection,
      safeToReplayCommands: commands.every((command) => command.commandId === command.idempotencyKey),
      acceptanceMayBeSubmitted: readiness.ready && !persistedGraphChanged,
      replayMode: restartRecovery.replayMode,
      operatorReviewRequired: restartRecovery.operatorReviewRequired,
      stableSnapshotMatched: Boolean(matchingSnapshot),
      latestSnapshotId: latestSnapshot?.snapshotId || null
    },
    commands,
    replayQueue: commands.map((command) => ({
      commandId: command.commandId,
      kind: command.kind,
      idempotencyKey: command.idempotencyKey,
      dispatchStatus: command.dispatchStatus,
      replayable: restartRecovery.replayMode === 'idempotent_replay_allowed' && !command.alreadyApplied,
      blockedReason: command.alreadyApplied
        ? 'already_applied'
        : restartRecovery.replayMode === 'idempotent_replay_allowed'
          ? null
          : restartRecovery.replayMode
    })),
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

function buildLifecycleDispatchPlan(controls, actionRequest, requestState, settings, scheduledFor, now) {
  const selectedControl = controls.find((control) => control.kind === actionRequest.kind) || null;
  const selectedCommand = selectedControl?.command || null;
  const expiresAt = Number.isFinite(Date.parse(now))
    ? new Date(Date.parse(now) + settings.commandTtlMs).toISOString()
    : null;
  const blockedReasons = [
    ...actionRequest.problems.map((problem) => problem.code),
    ...(!actionRequest.requested ? ['no_requested_action'] : []),
    ...(actionRequest.requested && !selectedControl ? ['action_not_available'] : []),
    ...(selectedControl && !selectedControl.enabled ? [selectedControl.disabledReason || 'control_disabled'] : [])
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
    scheduledFor: selectedCommand?.payload?.retryAfter || selectedCommand?.payload?.scheduledFor || scheduledFor,
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
      reason: actionRequest.reason
    }
  };
}

function transitionBlockedReasons(kind, selectedJob, settings, retryPlan, lifecycleWritable) {
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
    if (kind === 'cancel_job' && !selectedJob.isActive) reasons.push('job_not_active');
    if (kind === 'cancel_job' && !settings.allowCancelRunningJobs) reasons.push('cancel_disabled_by_settings');
  }

  return Array.from(new Set(reasons));
}

function transitionPatchFor(kind, selectedJob, settings, retryPlan, scheduledFor, now) {
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
        scheduledFor: retryPlan?.nextRetryAt || scheduledFor,
        updatedAt: now
      },
      failure: {
        ...selectedJob.failure,
        retryAfter: retryPlan?.nextRetryAt || scheduledFor,
        retryAttempts: retryPlan?.attempts ?? selectedJob.failure.retryAttempts
      },
      schedule: {
        mode: settings.scheduleMode,
        requestedDelayMs: settings.requestedDelayMs,
        minRetryDelayMs: settings.minRetryDelayMs,
        maxScheduledDelayMs: settings.maxScheduledDelayMs
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

function buildLifecycleTransitionState(controls, selectedJob, settings, retryPlan, lifecycleWritable, scheduledFor, now) {
  const transitions = controls.map((control) => {
    const guardReasons = transitionBlockedReasons(control.kind, selectedJob, settings, retryPlan, lifecycleWritable);
    const controlReasons = control.enabled ? [] : [control.disabledReason || 'control_disabled'];
    const blockedReasons = Array.from(new Set([...guardReasons, ...controlReasons].filter(Boolean)));
    const patch = blockedReasons.length === 0 ? transitionPatchFor(control.kind, selectedJob, settings, retryPlan, scheduledFor, now) : null;

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
      minRetryDelayMs: settings.minRetryDelayMs,
      maxScheduledDelayMs: settings.maxScheduledDelayMs,
      scheduledFor
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
  const selectedJob = graph.nodes.find((node) => node.id === requestState.selectedJobId) || null;
  const history = new Set(normalizeCommandHistory(input));
  const nowMs = Date.parse(now);
  const requestedDelayMs = settings.requestedDelayMs ?? settings.minRetryDelayMs;
  const scheduledFor = Number.isFinite(nowMs)
    ? new Date(nowMs + Math.min(requestedDelayMs, settings.maxScheduledDelayMs)).toISOString()
    : null;
  const settingErrors = settings.invalid.filter((issue) => issue.severity === 'error');
  const lifecycleWritable =
    settings.controlsEnabled &&
    settingErrors.length === 0 &&
    validation.valid &&
    graph.boundary.accessContext.canAcceptGraph &&
    graph.boundary.scopePolicy.canWriteScopedGraph &&
    operationalHealth.status !== 'critical';
  const basePayload = {
    requestId: requestState.requestId,
    jobId: selectedJob?.id || null,
    scheduleMode: settings.scheduleMode,
    scheduledFor
  };
  const retryPlan = selectedJob ? retryPlanForNode(selectedJob, now) : null;
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
      lifecycleWritable && settings.scheduleMode !== 'paused' && Boolean(retryPlan?.retryable),
      settings.scheduleMode === 'paused'
        ? 'Retry scheduling is paused by lifecycle settings.'
        : retryPlan?.exhausted
        ? 'Retry attempts are exhausted for this job.'
        : 'Only retryable failed jobs without blockers can be scheduled.',
      selectedJob && commandEnvelope('schedule_lifecycle_retry', requestState, {
        ...basePayload,
        retryAfter: retryPlan?.nextRetryAt || scheduledFor,
        attempts: retryPlan?.attempts ?? 0,
        maxAttempts: retryPlan?.maxAttempts ?? 0
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
  const actionRequest = normalizeLifecycleActionRequest(input, selectedJob, settings);
  const dispatchPlan = buildLifecycleDispatchPlan(controls, actionRequest, requestState, settings, scheduledFor, now);
  const transitionState = buildLifecycleTransitionState(
    controls,
    selectedJob,
    settings,
    retryPlan,
    lifecycleWritable,
    scheduledFor,
    now
  );

  return {
    contract: 'hosted-kernel-job-graph-lifecycle-controls.v1',
    settings,
    selectedJobId: selectedJob?.id || null,
    writable: lifecycleWritable,
    blockedReasons: [
      ...settingErrors.map((issue) => issue.code),
      ...(!settings.controlsEnabled ? ['settings_disabled'] : []),
      ...(!validation.valid ? ['validation_failed'] : []),
      ...(!graph.boundary.accessContext.canAcceptGraph ? ['permission_denied'] : []),
      ...(!graph.boundary.scopePolicy.canWriteScopedGraph ? graph.boundary.scopePolicy.writeBlockedReasons : []),
      ...(operationalHealth.status === 'critical' ? ['critical_operational_health'] : [])
    ],
    controls,
    commands: controls.map((control) => control.command).filter(Boolean),
    dispatchPlan,
    transitionState,
    nextAction: nextControl
      ? {
          kind: nextControl.kind,
          jobId: nextControl.command?.payload?.jobId || selectedJob?.id || null,
          enabled: nextControl.enabled,
          scheduledFor: nextControl.command?.payload?.retryAfter || nextControl.command?.payload?.scheduledFor || null,
          dispatchStatus: dispatchPlan.status,
          statePatch: transitionState.nextTransition?.kind === nextControl.kind ? transitionState.nextTransition.statePatch : null
        }
      : {
          kind: 'inspect_lifecycle_blockers',
          jobId: selectedJob?.id || null,
          enabled: false,
          scheduledFor: null,
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

function buildClientWorkflowHandoff(graph, requestState, operationalHealth, providerContracts, workflowHandoff, scopedMutationAuthorization, input, now) {
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
  const dispatchCommand = commandEnvelope('dispatch_workflow_handoff', requestState, {
    snapshotId: handoffId,
    jobId: workflowHandoff.targetJobId || selectedJob?.id || null,
    action,
    status: workflowHandoff.status,
    providerId: providerContracts.selectedProviderId,
    commandSink: providerHandoff.commandSink,
    correlationId: providerHandoff.correlationId,
    returnRoute: providerHandoff.returnRoute,
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
    queue,
    proof: {
      selectedJobId: selectedJob?.id || null,
      selectedJobProofCount: selectedJob?.proofCount || 0,
      completedHandoffCount: completedHandoffs.size,
      dismissedHandoffCount: dismissedHandoffs.size,
      readOnly: operationalHealth.readOnly,
      scopeWriteBlockedReasons: graph.boundary.scopePolicy.writeBlockedReasons
    }
  };
}

function buildClientRuntimeState(graph, validation, readiness, requestState, persistedState, operationalHealth, lifecycleControls, providerContracts, decisionPanel, workflowHandoff, clientWorkflowHandoff, scopedMutationAuthorization, analytics, clientPreview) {
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
      dependencyBlockedJobCount: graph.topology.blockedByDependencies.length
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
      lifecycleControlsWritable: lifecycleControls.writable
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
      candidateProviders: providerContracts.negotiationPlan.candidateProviders.map((provider) => ({
        providerId: provider.providerId,
        status: provider.status,
        score: provider.score,
        commandSink: provider.handoff.commandSink,
        stale: provider.sync.stale,
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
      queuedHandoffCount: clientWorkflowHandoff.queue.length
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
      canAcceptGraph: graph.boundary.accessContext.canAcceptGraph,
      canWriteScopedGraph: graph.boundary.scopePolicy.canWriteScopedGraph,
      scopeWriteBlockedReasons: graph.boundary.scopePolicy.writeBlockedReasons,
      effectiveTenantId: graph.boundary.scopePolicy.effectiveTenantId,
      effectiveWorkspaceId: graph.boundary.scopePolicy.effectiveWorkspaceId,
      workspaceGrant: graph.boundary.scopePolicy.workspaceGrant
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
        danglingDependencyIds: graph.danglingEdges.map((edge) => edge.id)
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

function buildReadiness(graph, validation, operationalHealth, providerContracts) {
  const hasProof = graph.proofBackedNodes.length > 0;
  const canAcceptGraph = graph.boundary.accessContext.canAcceptGraph;
  const healthAllowsAcceptance = operationalHealth.status === 'healthy';
  const providerAllowsAcceptance = providerContracts.negotiation.negotiable;
  const topologyAllowsAcceptance = graph.topology.acyclic;
  const scopeAllowsAcceptance = graph.boundary.scopePolicy.canWriteScopedGraph;
  const workspaceWriteAuthorized = graph.boundary.scopePolicy.workspaceWriteAuthorized;
  const ready = validation.valid && graph.nodes.length > 0 && graph.blockedNodes.length === 0 && hasProof && canAcceptGraph && healthAllowsAcceptance && providerAllowsAcceptance && topologyAllowsAcceptance && scopeAllowsAcceptance && workspaceWriteAuthorized;
  const reasons = [];

  if (graph.nodes.length === 0) reasons.push('Add at least one job to the graph.');
  if (!validation.valid) reasons.push('Resolve validation errors before accepting the preview.');
  if (graph.blockedNodes.length > 0) reasons.push('Clear blocked jobs before marking the graph ready.');
  if (!hasProof && graph.nodes.length > 0) reasons.push('Attach proof or evidence to at least one completed job.');
  if (!canAcceptGraph) reasons.push('Use an operator role or permission that can accept the job graph.');
  if (!healthAllowsAcceptance) reasons.push('Resolve hosted-kernel health errors or wait for scheduled retry backoff.');
  if (!providerAllowsAcceptance) reasons.push('Negotiate a synced provider contract with graph acceptance, proof export, and lifecycle dispatch capabilities.');
  if (!topologyAllowsAcceptance) reasons.push('Break dependency cycles before accepting the hosted-kernel graph.');
  if (!scopeAllowsAcceptance) reasons.push('Bind tenant and workspace scope before submitting hosted-kernel write handoff.');
  if (!workspaceWriteAuthorized) reasons.push('Attach a workspace write grant for the scoped tenant/workspace before hosted-kernel handoff.');

  return {
    ready,
    level: ready ? 'ready' : validation.valid ? 'needs_attention' : 'invalid',
    reasons,
    gates: {
      hasJobs: graph.nodes.length > 0,
      dependenciesResolved: graph.danglingEdges.length === 0,
      noBlockedJobs: graph.blockedNodes.length === 0,
      hasProof,
      canAcceptGraph,
      healthAllowsAcceptance,
      providerAllowsAcceptance,
      topologyAllowsAcceptance,
      scopeAllowsAcceptance,
      workspaceWriteAuthorized,
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
      ? `${surfaceId}:${providerContracts.selectedProviderId}:${graph.boundary.scopePolicy.effectiveTenantId || 'tenant'}:${graph.boundary.scopePolicy.effectiveWorkspaceId || 'workspace'}:${graph.nodes.length}:${graph.edges.length}:${graph.proofBackedNodes.length}`
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
      activeJobs: graph.activeNodes.length,
      terminalJobs: graph.terminalNodes.length,
      blockedJobs: graph.blockedNodes.length,
      proofBackedJobs: graph.proofBackedNodes.length,
      failedJobs: operationalHealth.failedJobCount,
      validationIssues: validation.issueCount,
      readinessGateFailures: readiness.reasons.length,
      deniedJobs: graph.boundary.deniedNodes.length,
      deniedDependencies: graph.boundary.deniedEdges.length
    },
    byStatus: status,
    byOwner: owners,
    byBlocker: blockers,
    byFailureCode: failures,
    rates: {
      completion: ratio(graph.terminalNodes.length, graph.nodes.length),
      proofCoverage: ratio(graph.proofBackedNodes.length, graph.nodes.length),
      blocked: ratio(graph.blockedNodes.length, graph.nodes.length),
      boundaryDenial: ratio(graph.boundary.deniedNodes.length, graph.boundary.inputNodeCount)
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
            dependencyBlockedJobCount: graph.topology.blockedByDependencies.length
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
  const manifest = Object.entries(exports.files).map(([key, file]) => ({
    exportKey: key,
    filename: file.filename,
    rowCount: Array.isArray(file.rows) ? file.rows.length : 1,
    headerCount: Array.isArray(file.headers) ? file.headers.length : 0,
    contentType: key.endsWith('Csv') ? 'text/csv' : 'application/json',
    route: exports.route,
    requestId: exports.requestId
  }));
  const blockedReasons = [
    ...(!validation.valid ? ['validation_failed'] : []),
    ...(operationalHealth.status === 'critical' ? ['critical_operational_health'] : []),
    ...(!graph.boundary.scopePolicy.canWriteScopedGraph && exportRequest.includeDeniedScope ? ['scope_boundary_not_write_safe'] : [])
  ];
  const publishable = exportRequest.requested && blockedReasons.length === 0;
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
    return operationalHealth.actionableErrors.slice(0, 8).map((error) => ({
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
      status: graph.nodes.length > 0 && graph.topology.acyclic && graph.danglingEdges.length === 0 ? 'pass' : 'fail',
      value: graph.nodes.length,
      detail: `${graph.edges.length} dependencies, ${graph.topology.readyQueue.length} ready jobs`
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
  const operationalHealth = buildOperationalHealth(graph, validationSummary, input, now, providerContracts);
  const readiness = buildReadiness(graph, validationSummary, operationalHealth, providerContracts);
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
  const persistedState = buildPersistedState(graph, validationSummary, readiness, requestState, now, input);
  const analytics = buildAnalyticsReport(graph, validationSummary, readiness, operationalHealth, requestState, now, input);
  const workflowHandoff = buildWorkflowHandoff(graph, validationSummary, readiness, acceptance, requestState, operationalHealth, providerContracts);
  const clientWorkflowHandoff = buildClientWorkflowHandoff(graph, requestState, operationalHealth, providerContracts, workflowHandoff, scopedMutationAuthorization, input, now);
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
    clientPreview
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
    clientRuntime,
    workflowHandoff,
    clientWorkflowHandoff,
    validationSummary,
    nextSteps,
    audit: {
      proof: {
        evidenceCount: evidence.length,
        proofBackedJobIds: graph.proofBackedNodes.map((node) => node.id),
        danglingDependencyIds: graph.danglingEdges.map((edge) => edge.id)
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
        deniedEdgeIds: graph.boundary.deniedEdges.map((edge) => edge.edgeId)
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
        }))
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
        dismissedHandoffCount: clientWorkflowHandoff.proof.dismissedHandoffCount
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
        actionableErrorCodes: operationalHealth.actionableErrors.map((error) => error.code),
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
