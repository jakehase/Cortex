import { buildEcommerceConsoleSnapshot, createEcommerceConsoleReadinessBoard } from '../service-ecommerce-console.mjs';

export function createEcommerceConsoleOpsRoutes(basePath = '/ops/ecommerce-console') {
  const snapshot = buildEcommerceConsoleSnapshot();
  return [
    { id: 'ecommerce-console.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createEcommerceConsoleReadinessBoard(snapshot) },
    { id: 'ecommerce-console.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'ecommerce-console.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

