import { buildEcommerceAtlasSnapshot, createEcommerceAtlasReadinessBoard } from '../service-ecommerce-atlas.mjs';

export function createEcommerceAtlasOpsRoutes(basePath = '/ops/ecommerce-atlas') {
  const snapshot = buildEcommerceAtlasSnapshot();
  return [
    { id: 'ecommerce-atlas.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createEcommerceAtlasReadinessBoard(snapshot) },
    { id: 'ecommerce-atlas.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'ecommerce-atlas.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

