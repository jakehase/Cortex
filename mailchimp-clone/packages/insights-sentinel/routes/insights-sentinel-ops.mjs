import { buildInsightsSentinelSnapshot, createInsightsSentinelReadinessBoard } from '../service-insights-sentinel.mjs';

export function createInsightsSentinelOpsRoutes(basePath = '/ops/insights-sentinel') {
  const snapshot = buildInsightsSentinelSnapshot();
  return [
    { id: 'insights-sentinel.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createInsightsSentinelReadinessBoard(snapshot) },
    { id: 'insights-sentinel.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'insights-sentinel.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

