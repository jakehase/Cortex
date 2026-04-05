import { buildCollaborationStudioSnapshot, createCollaborationStudioReadinessBoard } from '../service-collaboration-studio.mjs';

export function createCollaborationStudioOpsRoutes(basePath = '/ops/collaboration-studio') {
  const snapshot = buildCollaborationStudioSnapshot();
  return [
    { id: 'collaboration-studio.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCollaborationStudioReadinessBoard(snapshot) },
    { id: 'collaboration-studio.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'collaboration-studio.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

