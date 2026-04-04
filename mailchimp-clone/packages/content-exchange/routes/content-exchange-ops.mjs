import { buildContentExchangeSnapshot, createContentExchangeReadinessBoard } from '../service-content-exchange.mjs';

export function createContentExchangeOpsRoutes(basePath = '/ops/content-exchange') {
  const snapshot = buildContentExchangeSnapshot();
  return [
    { id: 'content-exchange.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createContentExchangeReadinessBoard(snapshot) },
    { id: 'content-exchange.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'content-exchange.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

