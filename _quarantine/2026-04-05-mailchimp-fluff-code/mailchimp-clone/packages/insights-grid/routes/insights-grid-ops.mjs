import { buildInsightsGridSnapshot, createInsightsGridReadinessBoard } from '../service-insights-grid.mjs';

export function createInsightsGridOpsRoutes(basePath = '/ops/insights-grid') {
  const snapshot = buildInsightsGridSnapshot();
  return [
    { id: 'insights-grid.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createInsightsGridReadinessBoard(snapshot) },
    { id: 'insights-grid.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'insights-grid.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

