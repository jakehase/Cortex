import { buildCollaborationVaultSnapshot, createCollaborationVaultReadinessBoard } from '../service-collaboration-vault.mjs';

export function createCollaborationVaultOpsRoutes(basePath = '/ops/collaboration-vault') {
  const snapshot = buildCollaborationVaultSnapshot();
  return [
    { id: 'collaboration-vault.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCollaborationVaultReadinessBoard(snapshot) },
    { id: 'collaboration-vault.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'collaboration-vault.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

