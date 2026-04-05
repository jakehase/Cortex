import { buildDataNotebookSnapshot, createDataNotebookReadinessBoard } from '../service-data-notebook.mjs';

export function createDataNotebookOpsRoutes(basePath = '/ops/data-notebook') {
  const snapshot = buildDataNotebookSnapshot();
  return [
    { id: 'data-notebook.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createDataNotebookReadinessBoard(snapshot) },
    { id: 'data-notebook.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'data-notebook.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

