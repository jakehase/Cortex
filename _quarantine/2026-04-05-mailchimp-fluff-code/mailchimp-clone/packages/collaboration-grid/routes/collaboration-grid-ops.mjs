import { buildCollaborationGridSnapshot, createCollaborationGridReadinessBoard } from '../service-collaboration-grid.mjs';

export function createCollaborationGridOpsRoutes(basePath = '/ops/collaboration-grid') {
  const snapshot = buildCollaborationGridSnapshot();
  return [
    { id: 'collaboration-grid.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCollaborationGridReadinessBoard(snapshot) },
    { id: 'collaboration-grid.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'collaboration-grid.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

