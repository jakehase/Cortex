import { buildInsightsIndexSnapshot, createInsightsIndexReadinessBoard } from '../service-insights-index.mjs';

export function createInsightsIndexOpsRoutes(basePath = '/ops/insights-index') {
  const snapshot = buildInsightsIndexSnapshot();
  return [
    { id: 'insights-index.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createInsightsIndexReadinessBoard(snapshot) },
    { id: 'insights-index.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'insights-index.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

