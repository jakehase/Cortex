import { buildAttributionExchangeSnapshot, createAttributionExchangeReadinessBoard } from '../service-attribution-exchange.mjs';

export function createAttributionExchangeOpsRoutes(basePath = '/ops/attribution-exchange') {
  const snapshot = buildAttributionExchangeSnapshot();
  return [
    { id: 'attribution-exchange.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAttributionExchangeReadinessBoard(snapshot) },
    { id: 'attribution-exchange.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'attribution-exchange.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

