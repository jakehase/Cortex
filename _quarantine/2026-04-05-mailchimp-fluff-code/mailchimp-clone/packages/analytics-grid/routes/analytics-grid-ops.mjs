import { buildAnalyticsGridSnapshot, createAnalyticsGridReadinessBoard } from '../service-analytics-grid.mjs';

export function createAnalyticsGridOpsRoutes(basePath = '/ops/analytics-grid') {
  const snapshot = buildAnalyticsGridSnapshot();
  return [
    { id: 'analytics-grid.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAnalyticsGridReadinessBoard(snapshot) },
    { id: 'analytics-grid.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'analytics-grid.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

