import { buildCreativeAtlasSnapshot, createCreativeAtlasReadinessBoard } from '../service-creative-atlas.mjs';

export function createCreativeAtlasOpsRoutes(basePath = '/ops/creative-atlas') {
  const snapshot = buildCreativeAtlasSnapshot();
  return [
    { id: 'creative-atlas.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCreativeAtlasReadinessBoard(snapshot) },
    { id: 'creative-atlas.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'creative-atlas.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

