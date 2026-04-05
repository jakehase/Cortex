import { buildCommerceGridSnapshot, createCommerceGridReadinessBoard } from '../service-commerce-grid.mjs';

export function createCommerceGridOpsRoutes(basePath = '/ops/commerce-grid') {
  const snapshot = buildCommerceGridSnapshot();
  return [
    { id: 'commerce-grid.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCommerceGridReadinessBoard(snapshot) },
    { id: 'commerce-grid.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'commerce-grid.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

