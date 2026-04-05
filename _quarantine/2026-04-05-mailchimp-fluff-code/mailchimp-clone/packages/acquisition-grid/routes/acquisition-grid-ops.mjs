import { buildAcquisitionGridSnapshot, createAcquisitionGridReadinessBoard } from '../service-acquisition-grid.mjs';

export function createAcquisitionGridOpsRoutes(basePath = '/ops/acquisition-grid') {
  const snapshot = buildAcquisitionGridSnapshot();
  return [
    { id: 'acquisition-grid.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAcquisitionGridReadinessBoard(snapshot) },
    { id: 'acquisition-grid.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'acquisition-grid.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

