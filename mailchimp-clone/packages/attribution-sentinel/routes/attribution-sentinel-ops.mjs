import { buildAttributionSentinelSnapshot, createAttributionSentinelReadinessBoard } from '../service-attribution-sentinel.mjs';

export function createAttributionSentinelOpsRoutes(basePath = '/ops/attribution-sentinel') {
  const snapshot = buildAttributionSentinelSnapshot();
  return [
    { id: 'attribution-sentinel.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAttributionSentinelReadinessBoard(snapshot) },
    { id: 'attribution-sentinel.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'attribution-sentinel.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

