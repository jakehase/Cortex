import { buildEcommerceStudioSnapshot, createEcommerceStudioReadinessBoard } from '../service-ecommerce-studio.mjs';

export function createEcommerceStudioOpsRoutes(basePath = '/ops/ecommerce-studio') {
  const snapshot = buildEcommerceStudioSnapshot();
  return [
    { id: 'ecommerce-studio.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createEcommerceStudioReadinessBoard(snapshot) },
    { id: 'ecommerce-studio.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'ecommerce-studio.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

