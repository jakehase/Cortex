import { buildAnalyticsConsoleSnapshot, createAnalyticsConsoleReadinessBoard } from '../service-analytics-console.mjs';

export function createAnalyticsConsoleOpsRoutes(basePath = '/ops/analytics-console') {
  const snapshot = buildAnalyticsConsoleSnapshot();
  return [
    { id: 'analytics-console.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAnalyticsConsoleReadinessBoard(snapshot) },
    { id: 'analytics-console.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'analytics-console.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

