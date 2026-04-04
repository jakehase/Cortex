import { buildAnalyticsStudioSnapshot, createAnalyticsStudioReadinessBoard } from '../service-analytics-studio.mjs';

export function createAnalyticsStudioOpsRoutes(basePath = '/ops/analytics-studio') {
  const snapshot = buildAnalyticsStudioSnapshot();
  return [
    { id: 'analytics-studio.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAnalyticsStudioReadinessBoard(snapshot) },
    { id: 'analytics-studio.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'analytics-studio.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

