import { buildEcommerceNotebookSnapshot, createEcommerceNotebookReadinessBoard } from '../service-ecommerce-notebook.mjs';

export function createEcommerceNotebookOpsRoutes(basePath = '/ops/ecommerce-notebook') {
  const snapshot = buildEcommerceNotebookSnapshot();
  return [
    { id: 'ecommerce-notebook.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createEcommerceNotebookReadinessBoard(snapshot) },
    { id: 'ecommerce-notebook.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'ecommerce-notebook.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

