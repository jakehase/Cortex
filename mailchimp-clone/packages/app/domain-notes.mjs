export function teamPermissionNotes(state, workspaceId) {
  const memberships = state.db.memberships.filter((entry) => entry.workspaceId === workspaceId && entry.status === 'active');
  const invitations = state.db.invitations.filter((entry) => entry.workspaceId === workspaceId && entry.status === 'pending');
  const auditEvents = state.db.auditEvents.filter((entry) => entry.workspaceId === workspaceId && /team|member|invite|role|permission/i.test(entry.action || entry.detail || ''));
  return {
    owners: memberships.filter((entry) => entry.role === 'owner').length,
    admins: memberships.filter((entry) => entry.role === 'admin').length,
    members: memberships.filter((entry) => entry.role === 'member').length,
    pendingInvites: invitations.length,
    recentPermissionEvents: auditEvents.slice(0, 5)
  };
}

function evaluatePrimaryRuntimeAdoption(config, state = {}, actor = {}, input = {}) {
  const workspaceId = actor?.workspace?.id || actor?.workspaceId || input.workspaceId || 'workspace';
  const db = state.db || {};
  const now = input.now || new Date().toISOString();
  const campaigns = Array.isArray(db.campaigns) ? db.campaigns.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const contacts = Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const jobs = Array.isArray(db.jobs) ? db.jobs.filter((entry) => !['completed', 'failed', 'cancelled'].includes(entry.status) && (!entry.workspaceId || entry.workspaceId === workspaceId)) : [];
  const events = Array.isArray(db.auditEvents) ? db.auditEvents.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).slice(0, 5) : [];
  const workflowSignals = (config.workflowSignals || []).map((signal, index) => ({ id: signal, status: input.completedSignals?.includes?.(signal) ? 'complete' : index === 0 ? 'active' : 'pending', requestScoped: true, recoverable: signal.includes('recovery') || signal.includes('handoff') }));
  return {
    ...config,
    workspaceId,
    generatedAt: now,
    counters: { campaigns: campaigns.length, contacts: contacts.length, activeJobs: jobs.length, auditEvents: events.length },
    workflowSignals,
    nextAction: jobs.length > 0 ? 'monitor_runtime_handoff' : 'execute_next_product_workflow_step',
    requestResponseEvidence: { routeReady: true, stateRead: Boolean(db), persistedByCaller: Boolean(input.persistedByCaller), recoveryPath: workflowSignals.some((signal) => signal.recoverable) },
    auditEvent: { at: now, type: 'primary_runtime_adoption_evaluated', surfaceId: config.surfaceId, phaseId: config.phaseId, shardId: config.shardId }
  };
}


export function buildTeamRolesPermissionsContinuationWave001ClientAppRuntimeAdoptionPrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"team_roles_permissions","focusGroup":"team_roles_permissions","phaseId":"continuation_wave_001_client_app_runtime_adoption","phaseTitle":"continuation wave 001 — client application runtime adoption slice","shardId":"focus.team_roles_permissions::continuation-001#1#1","targetFile":"packages/app/domain-notes.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

