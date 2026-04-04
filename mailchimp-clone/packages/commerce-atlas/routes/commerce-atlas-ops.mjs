import { buildCommerceAtlasSnapshot, createCommerceAtlasReadinessBoard } from '../service-commerce-atlas.mjs';

export function createCommerceAtlasOpsRoutes(basePath = '/ops/commerce-atlas') {
  const snapshot = buildCommerceAtlasSnapshot();
  return [
    { id: 'commerce-atlas.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCommerceAtlasReadinessBoard(snapshot) },
    { id: 'commerce-atlas.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'commerce-atlas.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

