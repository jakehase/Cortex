import { buildBillingNotebookSnapshot, createBillingNotebookReadinessBoard } from '../service-billing-notebook.mjs';

export function createBillingNotebookOpsRoutes(basePath = '/ops/billing-notebook') {
  const snapshot = buildBillingNotebookSnapshot();
  return [
    { id: 'billing-notebook.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createBillingNotebookReadinessBoard(snapshot) },
    { id: 'billing-notebook.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'billing-notebook.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

