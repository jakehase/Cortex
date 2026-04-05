import { buildAcquisitionSentinelSnapshot, createAcquisitionSentinelReadinessBoard } from '../service-acquisition-sentinel.mjs';

export function createAcquisitionSentinelOpsRoutes(basePath = '/ops/acquisition-sentinel') {
  const snapshot = buildAcquisitionSentinelSnapshot();
  return [
    { id: 'acquisition-sentinel.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAcquisitionSentinelReadinessBoard(snapshot) },
    { id: 'acquisition-sentinel.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'acquisition-sentinel.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

