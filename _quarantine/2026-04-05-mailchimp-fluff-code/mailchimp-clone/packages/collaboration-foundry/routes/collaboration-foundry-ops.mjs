import { buildCollaborationFoundrySnapshot, createCollaborationFoundryReadinessBoard } from '../service-collaboration-foundry.mjs';

export function createCollaborationFoundryOpsRoutes(basePath = '/ops/collaboration-foundry') {
  const snapshot = buildCollaborationFoundrySnapshot();
  return [
    { id: 'collaboration-foundry.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCollaborationFoundryReadinessBoard(snapshot) },
    { id: 'collaboration-foundry.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'collaboration-foundry.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

