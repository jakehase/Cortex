import { buildInsightsHubSnapshot, createInsightsHubReadinessBoard } from '../service-insights-hub.mjs';

export function createInsightsHubOpsRoutes(basePath = '/ops/insights-hub') {
  const snapshot = buildInsightsHubSnapshot();
  return [
    { id: 'insights-hub.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createInsightsHubReadinessBoard(snapshot) },
    { id: 'insights-hub.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'insights-hub.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

