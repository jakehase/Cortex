import { buildAnalyticsHubSnapshot, createAnalyticsHubReadinessBoard } from '../service-analytics-hub.mjs';

export function createAnalyticsHubOpsRoutes(basePath = '/ops/analytics-hub') {
  const snapshot = buildAnalyticsHubSnapshot();
  return [
    { id: 'analytics-hub.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAnalyticsHubReadinessBoard(snapshot) },
    { id: 'analytics-hub.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'analytics-hub.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

