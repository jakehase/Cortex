import { buildLifecycleSentinelSnapshot, createLifecycleSentinelReadinessBoard } from '../service-lifecycle-sentinel.mjs';

export function createLifecycleSentinelOpsRoutes(basePath = '/ops/lifecycle-sentinel') {
  const snapshot = buildLifecycleSentinelSnapshot();
  return [
    { id: 'lifecycle-sentinel.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLifecycleSentinelReadinessBoard(snapshot) },
    { id: 'lifecycle-sentinel.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'lifecycle-sentinel.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

