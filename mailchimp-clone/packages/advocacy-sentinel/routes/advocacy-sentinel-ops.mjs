import { buildAdvocacySentinelSnapshot, createAdvocacySentinelReadinessBoard } from '../service-advocacy-sentinel.mjs';

export function createAdvocacySentinelOpsRoutes(basePath = '/ops/advocacy-sentinel') {
  const snapshot = buildAdvocacySentinelSnapshot();
  return [
    { id: 'advocacy-sentinel.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAdvocacySentinelReadinessBoard(snapshot) },
    { id: 'advocacy-sentinel.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'advocacy-sentinel.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

