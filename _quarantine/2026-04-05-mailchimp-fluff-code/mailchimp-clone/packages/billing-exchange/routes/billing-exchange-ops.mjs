import { buildBillingExchangeSnapshot, createBillingExchangeReadinessBoard } from '../service-billing-exchange.mjs';

export function createBillingExchangeOpsRoutes(basePath = '/ops/billing-exchange') {
  const snapshot = buildBillingExchangeSnapshot();
  return [
    { id: 'billing-exchange.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createBillingExchangeReadinessBoard(snapshot) },
    { id: 'billing-exchange.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'billing-exchange.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

