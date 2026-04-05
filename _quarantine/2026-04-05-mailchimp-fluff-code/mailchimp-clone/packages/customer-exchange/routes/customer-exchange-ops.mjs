import { buildCustomerExchangeSnapshot, createCustomerExchangeReadinessBoard } from '../service-customer-exchange.mjs';

export function createCustomerExchangeOpsRoutes(basePath = '/ops/customer-exchange') {
  const snapshot = buildCustomerExchangeSnapshot();
  return [
    { id: 'customer-exchange.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCustomerExchangeReadinessBoard(snapshot) },
    { id: 'customer-exchange.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'customer-exchange.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

