import { buildLifecycleNotebookSnapshot, createLifecycleNotebookReadinessBoard } from '../service-lifecycle-notebook.mjs';

export function createLifecycleNotebookOpsRoutes(basePath = '/ops/lifecycle-notebook') {
  const snapshot = buildLifecycleNotebookSnapshot();
  return [
    { id: 'lifecycle-notebook.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLifecycleNotebookReadinessBoard(snapshot) },
    { id: 'lifecycle-notebook.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'lifecycle-notebook.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

