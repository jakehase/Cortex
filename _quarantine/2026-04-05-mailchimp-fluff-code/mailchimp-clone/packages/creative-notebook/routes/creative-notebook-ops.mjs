import { buildCreativeNotebookSnapshot, createCreativeNotebookReadinessBoard } from '../service-creative-notebook.mjs';

export function createCreativeNotebookOpsRoutes(basePath = '/ops/creative-notebook') {
  const snapshot = buildCreativeNotebookSnapshot();
  return [
    { id: 'creative-notebook.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCreativeNotebookReadinessBoard(snapshot) },
    { id: 'creative-notebook.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'creative-notebook.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

