import { buildEcommerceIndexSnapshot, createEcommerceIndexReadinessBoard } from '../service-ecommerce-index.mjs';

export function createEcommerceIndexOpsRoutes(basePath = '/ops/ecommerce-index') {
  const snapshot = buildEcommerceIndexSnapshot();
  return [
    { id: 'ecommerce-index.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createEcommerceIndexReadinessBoard(snapshot) },
    { id: 'ecommerce-index.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'ecommerce-index.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

