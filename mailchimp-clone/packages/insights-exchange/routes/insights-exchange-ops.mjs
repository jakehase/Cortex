import { buildInsightsExchangeSnapshot, createInsightsExchangeReadinessBoard } from '../service-insights-exchange.mjs';

export function createInsightsExchangeOpsRoutes(basePath = '/ops/insights-exchange') {
  const snapshot = buildInsightsExchangeSnapshot();
  return [
    { id: 'insights-exchange.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createInsightsExchangeReadinessBoard(snapshot) },
    { id: 'insights-exchange.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'insights-exchange.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

