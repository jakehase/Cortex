import { buildEcommerceNavigatorSnapshot, createEcommerceNavigatorReadinessBoard } from '../service-ecommerce-navigator.mjs';

export function createEcommerceNavigatorOpsRoutes(basePath = '/ops/ecommerce-navigator') {
  const snapshot = buildEcommerceNavigatorSnapshot();
  return [
    { id: 'ecommerce-navigator.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createEcommerceNavigatorReadinessBoard(snapshot) },
    { id: 'ecommerce-navigator.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'ecommerce-navigator.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

