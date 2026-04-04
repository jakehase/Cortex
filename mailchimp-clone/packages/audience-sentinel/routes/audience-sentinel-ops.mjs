import { buildAudienceSentinelSnapshot, createAudienceSentinelReadinessBoard } from '../service-audience-sentinel.mjs';

export function createAudienceSentinelOpsRoutes(basePath = '/ops/audience-sentinel') {
  const snapshot = buildAudienceSentinelSnapshot();
  return [
    { id: 'audience-sentinel.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAudienceSentinelReadinessBoard(snapshot) },
    { id: 'audience-sentinel.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'audience-sentinel.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

