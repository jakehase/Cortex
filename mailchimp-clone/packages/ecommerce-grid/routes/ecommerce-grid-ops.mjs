import { buildEcommerceGridSnapshot, createEcommerceGridReadinessBoard } from '../service-ecommerce-grid.mjs';

export function createEcommerceGridOpsRoutes(basePath = '/ops/ecommerce-grid') {
  const snapshot = buildEcommerceGridSnapshot();
  return [
    { id: 'ecommerce-grid.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createEcommerceGridReadinessBoard(snapshot) },
    { id: 'ecommerce-grid.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'ecommerce-grid.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

