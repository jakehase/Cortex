import { buildEcommerceWatchtowerSnapshot, createEcommerceWatchtowerReadinessBoard } from '../service-ecommerce-watchtower.mjs';

export function createEcommerceWatchtowerOpsRoutes(basePath = '/ops/ecommerce-watchtower') {
  const snapshot = buildEcommerceWatchtowerSnapshot();
  return [
    { id: 'ecommerce-watchtower.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createEcommerceWatchtowerReadinessBoard(snapshot) },
    { id: 'ecommerce-watchtower.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'ecommerce-watchtower.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

