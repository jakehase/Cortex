import { buildCollaborationNavigatorSnapshot, createCollaborationNavigatorReadinessBoard } from '../service-collaboration-navigator.mjs';

export function createCollaborationNavigatorOpsRoutes(basePath = '/ops/collaboration-navigator') {
  const snapshot = buildCollaborationNavigatorSnapshot();
  return [
    { id: 'collaboration-navigator.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCollaborationNavigatorReadinessBoard(snapshot) },
    { id: 'collaboration-navigator.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'collaboration-navigator.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

