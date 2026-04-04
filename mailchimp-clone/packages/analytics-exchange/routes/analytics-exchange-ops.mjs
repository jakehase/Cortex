import { buildAnalyticsExchangeSnapshot, createAnalyticsExchangeReadinessBoard } from '../service-analytics-exchange.mjs';

export function createAnalyticsExchangeOpsRoutes(basePath = '/ops/analytics-exchange') {
  const snapshot = buildAnalyticsExchangeSnapshot();
  return [
    { id: 'analytics-exchange.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAnalyticsExchangeReadinessBoard(snapshot) },
    { id: 'analytics-exchange.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'analytics-exchange.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

