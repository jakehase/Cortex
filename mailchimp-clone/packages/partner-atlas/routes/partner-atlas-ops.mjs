import { buildPartnerAtlasSnapshot, createPartnerAtlasReadinessBoard } from '../service-partner-atlas.mjs';

export function createPartnerAtlasOpsRoutes(basePath = '/ops/partner-atlas') {
  const snapshot = buildPartnerAtlasSnapshot();
  return [
    { id: 'partner-atlas.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createPartnerAtlasReadinessBoard(snapshot) },
    { id: 'partner-atlas.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'partner-atlas.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

