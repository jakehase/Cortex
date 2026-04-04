import { buildCollaborationHubSnapshot, createCollaborationHubReadinessBoard } from '../service-collaboration-hub.mjs';

export function createCollaborationHubOpsRoutes(basePath = '/ops/collaboration-hub') {
  const snapshot = buildCollaborationHubSnapshot();
  return [
    { id: 'collaboration-hub.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCollaborationHubReadinessBoard(snapshot) },
    { id: 'collaboration-hub.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'collaboration-hub.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

