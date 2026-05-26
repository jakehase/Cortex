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
