import { buildCommerceNotebookSnapshot, createCommerceNotebookReadinessBoard } from '../service-commerce-notebook.mjs';

export function createCommerceNotebookOpsRoutes(basePath = '/ops/commerce-notebook') {
  const snapshot = buildCommerceNotebookSnapshot();
  return [
    { id: 'commerce-notebook.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCommerceNotebookReadinessBoard(snapshot) },
    { id: 'commerce-notebook.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'commerce-notebook.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

