import { buildAnalyticsWatchtowerSnapshot, createAnalyticsWatchtowerReadinessBoard } from '../service-analytics-watchtower.mjs';

export function createAnalyticsWatchtowerOpsRoutes(basePath = '/ops/analytics-watchtower') {
  const snapshot = buildAnalyticsWatchtowerSnapshot();
  return [
    { id: 'analytics-watchtower.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAnalyticsWatchtowerReadinessBoard(snapshot) },
    { id: 'analytics-watchtower.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'analytics-watchtower.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

