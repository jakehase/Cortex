import { buildAcquisitionIndexSnapshot, createAcquisitionIndexReadinessBoard } from '../service-acquisition-index.mjs';

export function createAcquisitionIndexOpsRoutes(basePath = '/ops/acquisition-index') {
  const snapshot = buildAcquisitionIndexSnapshot();
  return [
    { id: 'acquisition-index.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAcquisitionIndexReadinessBoard(snapshot) },
    { id: 'acquisition-index.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'acquisition-index.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

