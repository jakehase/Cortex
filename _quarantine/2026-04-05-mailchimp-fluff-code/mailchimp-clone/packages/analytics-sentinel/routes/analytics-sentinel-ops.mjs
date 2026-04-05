import { buildAnalyticsSentinelSnapshot, createAnalyticsSentinelReadinessBoard } from '../service-analytics-sentinel.mjs';

export function createAnalyticsSentinelOpsRoutes(basePath = '/ops/analytics-sentinel') {
  const snapshot = buildAnalyticsSentinelSnapshot();
  return [
    { id: 'analytics-sentinel.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAnalyticsSentinelReadinessBoard(snapshot) },
    { id: 'analytics-sentinel.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'analytics-sentinel.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

