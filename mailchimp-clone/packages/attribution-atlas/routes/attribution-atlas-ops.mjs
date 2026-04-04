import { buildAttributionAtlasSnapshot, createAttributionAtlasReadinessBoard } from '../service-attribution-atlas.mjs';

export function createAttributionAtlasOpsRoutes(basePath = '/ops/attribution-atlas') {
  const snapshot = buildAttributionAtlasSnapshot();
  return [
    { id: 'attribution-atlas.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAttributionAtlasReadinessBoard(snapshot) },
    { id: 'attribution-atlas.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'attribution-atlas.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

