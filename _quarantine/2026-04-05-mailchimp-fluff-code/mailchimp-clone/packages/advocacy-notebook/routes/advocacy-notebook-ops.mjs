import { buildAdvocacyNotebookSnapshot, createAdvocacyNotebookReadinessBoard } from '../service-advocacy-notebook.mjs';

export function createAdvocacyNotebookOpsRoutes(basePath = '/ops/advocacy-notebook') {
  const snapshot = buildAdvocacyNotebookSnapshot();
  return [
    { id: 'advocacy-notebook.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAdvocacyNotebookReadinessBoard(snapshot) },
    { id: 'advocacy-notebook.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'advocacy-notebook.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

