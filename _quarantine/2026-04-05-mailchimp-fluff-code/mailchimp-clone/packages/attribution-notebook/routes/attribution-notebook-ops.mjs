import { buildAttributionNotebookSnapshot, createAttributionNotebookReadinessBoard } from '../service-attribution-notebook.mjs';

export function createAttributionNotebookOpsRoutes(basePath = '/ops/attribution-notebook') {
  const snapshot = buildAttributionNotebookSnapshot();
  return [
    { id: 'attribution-notebook.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAttributionNotebookReadinessBoard(snapshot) },
    { id: 'attribution-notebook.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'attribution-notebook.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

