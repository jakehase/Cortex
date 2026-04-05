import { buildCreativeExchangeSnapshot, createCreativeExchangeReadinessBoard } from '../service-creative-exchange.mjs';

export function createCreativeExchangeOpsRoutes(basePath = '/ops/creative-exchange') {
  const snapshot = buildCreativeExchangeSnapshot();
  return [
    { id: 'creative-exchange.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCreativeExchangeReadinessBoard(snapshot) },
    { id: 'creative-exchange.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'creative-exchange.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

