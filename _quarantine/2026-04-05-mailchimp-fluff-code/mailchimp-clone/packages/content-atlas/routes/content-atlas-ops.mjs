import { buildContentAtlasSnapshot, createContentAtlasReadinessBoard } from '../service-content-atlas.mjs';

export function createContentAtlasOpsRoutes(basePath = '/ops/content-atlas') {
  const snapshot = buildContentAtlasSnapshot();
  return [
    { id: 'content-atlas.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createContentAtlasReadinessBoard(snapshot) },
    { id: 'content-atlas.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'content-atlas.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

