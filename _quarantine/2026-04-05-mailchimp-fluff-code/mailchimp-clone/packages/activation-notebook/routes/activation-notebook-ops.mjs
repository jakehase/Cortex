import { buildActivationNotebookSnapshot, createActivationNotebookReadinessBoard } from '../service-activation-notebook.mjs';

export function createActivationNotebookOpsRoutes(basePath = '/ops/activation-notebook') {
  const snapshot = buildActivationNotebookSnapshot();
  return [
    { id: 'activation-notebook.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createActivationNotebookReadinessBoard(snapshot) },
    { id: 'activation-notebook.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'activation-notebook.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

