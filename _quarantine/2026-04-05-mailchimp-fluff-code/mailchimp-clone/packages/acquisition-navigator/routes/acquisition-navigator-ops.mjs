import { buildAcquisitionNavigatorSnapshot, createAcquisitionNavigatorReadinessBoard } from '../service-acquisition-navigator.mjs';

export function createAcquisitionNavigatorOpsRoutes(basePath = '/ops/acquisition-navigator') {
  const snapshot = buildAcquisitionNavigatorSnapshot();
  return [
    { id: 'acquisition-navigator.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAcquisitionNavigatorReadinessBoard(snapshot) },
    { id: 'acquisition-navigator.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'acquisition-navigator.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

