import { buildAnalyticsIndexSnapshot, createAnalyticsIndexReadinessBoard } from '../service-analytics-index.mjs';

export function createAnalyticsIndexOpsRoutes(basePath = '/ops/analytics-index') {
  const snapshot = buildAnalyticsIndexSnapshot();
  return [
    { id: 'analytics-index.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAnalyticsIndexReadinessBoard(snapshot) },
    { id: 'analytics-index.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'analytics-index.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

