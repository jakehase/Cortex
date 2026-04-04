import { buildCustomerNotebookSnapshot, createCustomerNotebookReadinessBoard } from '../service-customer-notebook.mjs';

export function createCustomerNotebookOpsRoutes(basePath = '/ops/customer-notebook') {
  const snapshot = buildCustomerNotebookSnapshot();
  return [
    { id: 'customer-notebook.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCustomerNotebookReadinessBoard(snapshot) },
    { id: 'customer-notebook.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'customer-notebook.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

