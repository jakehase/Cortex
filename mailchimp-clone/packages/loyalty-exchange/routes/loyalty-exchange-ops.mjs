import { buildLoyaltyExchangeSnapshot, createLoyaltyExchangeReadinessBoard } from '../service-loyalty-exchange.mjs';

export function createLoyaltyExchangeOpsRoutes(basePath = '/ops/loyalty-exchange') {
  const snapshot = buildLoyaltyExchangeSnapshot();
  return [
    { id: 'loyalty-exchange.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLoyaltyExchangeReadinessBoard(snapshot) },
    { id: 'loyalty-exchange.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'loyalty-exchange.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

