import { buildInsightsConsoleSnapshot, createInsightsConsoleReadinessBoard } from '../service-insights-console.mjs';

export function createInsightsConsoleOpsRoutes(basePath = '/ops/insights-console') {
  const snapshot = buildInsightsConsoleSnapshot();
  return [
    { id: 'insights-console.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createInsightsConsoleReadinessBoard(snapshot) },
    { id: 'insights-console.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'insights-console.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

