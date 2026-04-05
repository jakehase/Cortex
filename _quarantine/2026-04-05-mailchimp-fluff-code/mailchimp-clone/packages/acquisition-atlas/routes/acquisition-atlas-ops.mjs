import { buildAcquisitionAtlasSnapshot, createAcquisitionAtlasReadinessBoard } from '../service-acquisition-atlas.mjs';

export function createAcquisitionAtlasOpsRoutes(basePath = '/ops/acquisition-atlas') {
  const snapshot = buildAcquisitionAtlasSnapshot();
  return [
    { id: 'acquisition-atlas.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAcquisitionAtlasReadinessBoard(snapshot) },
    { id: 'acquisition-atlas.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'acquisition-atlas.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

