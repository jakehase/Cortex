import { buildCreativeSentinelSnapshot, createCreativeSentinelReadinessBoard } from '../service-creative-sentinel.mjs';

export function createCreativeSentinelOpsRoutes(basePath = '/ops/creative-sentinel') {
  const snapshot = buildCreativeSentinelSnapshot();
  return [
    { id: 'creative-sentinel.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCreativeSentinelReadinessBoard(snapshot) },
    { id: 'creative-sentinel.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'creative-sentinel.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

