import { buildEcommerceExchangeSnapshot, createEcommerceExchangeReadinessBoard } from '../service-ecommerce-exchange.mjs';

export function createEcommerceExchangeOpsRoutes(basePath = '/ops/ecommerce-exchange') {
  const snapshot = buildEcommerceExchangeSnapshot();
  return [
    { id: 'ecommerce-exchange.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createEcommerceExchangeReadinessBoard(snapshot) },
    { id: 'ecommerce-exchange.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'ecommerce-exchange.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

