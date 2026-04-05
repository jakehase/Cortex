import { buildEcommerceHubSnapshot, createEcommerceHubReadinessBoard } from '../service-ecommerce-hub.mjs';

export function createEcommerceHubOpsRoutes(basePath = '/ops/ecommerce-hub') {
  const snapshot = buildEcommerceHubSnapshot();
  return [
    { id: 'ecommerce-hub.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createEcommerceHubReadinessBoard(snapshot) },
    { id: 'ecommerce-hub.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'ecommerce-hub.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

