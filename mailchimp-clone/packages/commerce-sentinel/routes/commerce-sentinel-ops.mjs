import { buildCommerceSentinelSnapshot, createCommerceSentinelReadinessBoard } from '../service-commerce-sentinel.mjs';

export function createCommerceSentinelOpsRoutes(basePath = '/ops/commerce-sentinel') {
  const snapshot = buildCommerceSentinelSnapshot();
  return [
    { id: 'commerce-sentinel.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCommerceSentinelReadinessBoard(snapshot) },
    { id: 'commerce-sentinel.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'commerce-sentinel.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

