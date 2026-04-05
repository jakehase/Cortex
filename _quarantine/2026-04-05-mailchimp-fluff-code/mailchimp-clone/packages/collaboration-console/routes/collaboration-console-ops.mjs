import { buildCollaborationConsoleSnapshot, createCollaborationConsoleReadinessBoard } from '../service-collaboration-console.mjs';

export function createCollaborationConsoleOpsRoutes(basePath = '/ops/collaboration-console') {
  const snapshot = buildCollaborationConsoleSnapshot();
  return [
    { id: 'collaboration-console.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCollaborationConsoleReadinessBoard(snapshot) },
    { id: 'collaboration-console.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'collaboration-console.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

