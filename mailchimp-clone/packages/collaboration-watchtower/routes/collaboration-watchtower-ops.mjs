import { buildCollaborationWatchtowerSnapshot, createCollaborationWatchtowerReadinessBoard } from '../service-collaboration-watchtower.mjs';

export function createCollaborationWatchtowerOpsRoutes(basePath = '/ops/collaboration-watchtower') {
  const snapshot = buildCollaborationWatchtowerSnapshot();
  return [
    { id: 'collaboration-watchtower.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCollaborationWatchtowerReadinessBoard(snapshot) },
    { id: 'collaboration-watchtower.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'collaboration-watchtower.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

