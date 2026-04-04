import { buildAudienceAtlasSnapshot, createAudienceAtlasReadinessBoard } from '../service-audience-atlas.mjs';

export function createAudienceAtlasOpsRoutes(basePath = '/ops/audience-atlas') {
  const snapshot = buildAudienceAtlasSnapshot();
  return [
    { id: 'audience-atlas.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAudienceAtlasReadinessBoard(snapshot) },
    { id: 'audience-atlas.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'audience-atlas.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

