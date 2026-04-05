import { buildCollaborationIndexSnapshot, createCollaborationIndexReadinessBoard } from '../service-collaboration-index.mjs';

export function createCollaborationIndexOpsRoutes(basePath = '/ops/collaboration-index') {
  const snapshot = buildCollaborationIndexSnapshot();
  return [
    { id: 'collaboration-index.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCollaborationIndexReadinessBoard(snapshot) },
    { id: 'collaboration-index.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'collaboration-index.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

