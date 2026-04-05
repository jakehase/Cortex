import { buildContentNotebookSnapshot, createContentNotebookReadinessBoard } from '../service-content-notebook.mjs';

export function createContentNotebookOpsRoutes(basePath = '/ops/content-notebook') {
  const snapshot = buildContentNotebookSnapshot();
  return [
    { id: 'content-notebook.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createContentNotebookReadinessBoard(snapshot) },
    { id: 'content-notebook.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'content-notebook.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

