import { buildEcommerceWorkbenchSnapshot, createEcommerceWorkbenchReadinessBoard } from '../service-ecommerce-workbench.mjs';

export function createEcommerceWorkbenchOpsRoutes(basePath = '/ops/ecommerce-workbench') {
  const snapshot = buildEcommerceWorkbenchSnapshot();
  return [
    { id: 'ecommerce-workbench.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createEcommerceWorkbenchReadinessBoard(snapshot) },
    { id: 'ecommerce-workbench.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'ecommerce-workbench.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

