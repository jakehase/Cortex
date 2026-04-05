import { buildCollaborationWorkbenchSnapshot, createCollaborationWorkbenchReadinessBoard } from '../service-collaboration-workbench.mjs';

export function createCollaborationWorkbenchOpsRoutes(basePath = '/ops/collaboration-workbench') {
  const snapshot = buildCollaborationWorkbenchSnapshot();
  return [
    { id: 'collaboration-workbench.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCollaborationWorkbenchReadinessBoard(snapshot) },
    { id: 'collaboration-workbench.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'collaboration-workbench.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

