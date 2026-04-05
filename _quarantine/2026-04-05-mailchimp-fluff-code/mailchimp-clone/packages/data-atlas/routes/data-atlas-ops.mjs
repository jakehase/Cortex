import { buildDataAtlasSnapshot, createDataAtlasReadinessBoard } from '../service-data-atlas.mjs';

export function createDataAtlasOpsRoutes(basePath = '/ops/data-atlas') {
  const snapshot = buildDataAtlasSnapshot();
  return [
    { id: 'data-atlas.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createDataAtlasReadinessBoard(snapshot) },
    { id: 'data-atlas.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'data-atlas.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

