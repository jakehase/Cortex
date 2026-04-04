import { buildCollaborationNotebookSnapshot, createCollaborationNotebookReadinessBoard } from '../service-collaboration-notebook.mjs';

export function createCollaborationNotebookOpsRoutes(basePath = '/ops/collaboration-notebook') {
  const snapshot = buildCollaborationNotebookSnapshot();
  return [
    { id: 'collaboration-notebook.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCollaborationNotebookReadinessBoard(snapshot) },
    { id: 'collaboration-notebook.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'collaboration-notebook.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

