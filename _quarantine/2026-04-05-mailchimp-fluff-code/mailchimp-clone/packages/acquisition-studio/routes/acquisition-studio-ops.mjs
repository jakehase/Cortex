import { buildAcquisitionStudioSnapshot, createAcquisitionStudioReadinessBoard } from '../service-acquisition-studio.mjs';

export function createAcquisitionStudioOpsRoutes(basePath = '/ops/acquisition-studio') {
  const snapshot = buildAcquisitionStudioSnapshot();
  return [
    { id: 'acquisition-studio.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAcquisitionStudioReadinessBoard(snapshot) },
    { id: 'acquisition-studio.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'acquisition-studio.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

