import { buildAdvocacyAtlasSnapshot, createAdvocacyAtlasReadinessBoard } from '../service-advocacy-atlas.mjs';

export function createAdvocacyAtlasOpsRoutes(basePath = '/ops/advocacy-atlas') {
  const snapshot = buildAdvocacyAtlasSnapshot();
  return [
    { id: 'advocacy-atlas.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAdvocacyAtlasReadinessBoard(snapshot) },
    { id: 'advocacy-atlas.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'advocacy-atlas.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

