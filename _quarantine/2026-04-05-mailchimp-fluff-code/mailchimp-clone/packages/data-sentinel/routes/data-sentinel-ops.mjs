import { buildDataSentinelSnapshot, createDataSentinelReadinessBoard } from '../service-data-sentinel.mjs';

export function createDataSentinelOpsRoutes(basePath = '/ops/data-sentinel') {
  const snapshot = buildDataSentinelSnapshot();
  return [
    { id: 'data-sentinel.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createDataSentinelReadinessBoard(snapshot) },
    { id: 'data-sentinel.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'data-sentinel.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

