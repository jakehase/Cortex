import { buildCommerceExchangeSnapshot, createCommerceExchangeReadinessBoard } from '../service-commerce-exchange.mjs';

export function createCommerceExchangeOpsRoutes(basePath = '/ops/commerce-exchange') {
  const snapshot = buildCommerceExchangeSnapshot();
  return [
    { id: 'commerce-exchange.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCommerceExchangeReadinessBoard(snapshot) },
    { id: 'commerce-exchange.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'commerce-exchange.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

