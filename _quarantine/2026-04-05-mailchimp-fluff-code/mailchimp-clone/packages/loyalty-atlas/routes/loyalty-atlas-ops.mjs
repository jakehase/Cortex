import { buildLoyaltyAtlasSnapshot, createLoyaltyAtlasReadinessBoard } from '../service-loyalty-atlas.mjs';

export function createLoyaltyAtlasOpsRoutes(basePath = '/ops/loyalty-atlas') {
  const snapshot = buildLoyaltyAtlasSnapshot();
  return [
    { id: 'loyalty-atlas.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLoyaltyAtlasReadinessBoard(snapshot) },
    { id: 'loyalty-atlas.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'loyalty-atlas.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

