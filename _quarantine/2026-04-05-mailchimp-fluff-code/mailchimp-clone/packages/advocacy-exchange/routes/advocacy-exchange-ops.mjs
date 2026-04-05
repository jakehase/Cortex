import { buildAdvocacyExchangeSnapshot, createAdvocacyExchangeReadinessBoard } from '../service-advocacy-exchange.mjs';

export function createAdvocacyExchangeOpsRoutes(basePath = '/ops/advocacy-exchange') {
  const snapshot = buildAdvocacyExchangeSnapshot();
  return [
    { id: 'advocacy-exchange.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAdvocacyExchangeReadinessBoard(snapshot) },
    { id: 'advocacy-exchange.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'advocacy-exchange.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

