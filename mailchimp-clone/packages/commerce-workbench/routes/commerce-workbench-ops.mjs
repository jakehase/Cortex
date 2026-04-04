import { buildCommerceWorkbenchSnapshot, createCommerceWorkbenchReadinessBoard } from '../service-commerce-workbench.mjs';

export function createCommerceWorkbenchOpsRoutes(basePath = '/ops/commerce-workbench') {
  const snapshot = buildCommerceWorkbenchSnapshot();
  return [
    { id: 'commerce-workbench.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCommerceWorkbenchReadinessBoard(snapshot) },
    { id: 'commerce-workbench.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'commerce-workbench.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

