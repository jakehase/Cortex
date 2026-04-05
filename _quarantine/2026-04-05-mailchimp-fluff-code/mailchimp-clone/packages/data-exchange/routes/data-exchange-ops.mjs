import { buildDataExchangeSnapshot, createDataExchangeReadinessBoard } from '../service-data-exchange.mjs';

export function createDataExchangeOpsRoutes(basePath = '/ops/data-exchange') {
  const snapshot = buildDataExchangeSnapshot();
  return [
    { id: 'data-exchange.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createDataExchangeReadinessBoard(snapshot) },
    { id: 'data-exchange.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'data-exchange.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

