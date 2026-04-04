import { buildAudienceExchangeSnapshot, createAudienceExchangeReadinessBoard } from '../service-audience-exchange.mjs';

export function createAudienceExchangeOpsRoutes(basePath = '/ops/audience-exchange') {
  const snapshot = buildAudienceExchangeSnapshot();
  return [
    { id: 'audience-exchange.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAudienceExchangeReadinessBoard(snapshot) },
    { id: 'audience-exchange.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'audience-exchange.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

