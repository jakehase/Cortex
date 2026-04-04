import { buildCommerceIndexSnapshot, createCommerceIndexReadinessBoard } from '../service-commerce-index.mjs';

export function createCommerceIndexOpsRoutes(basePath = '/ops/commerce-index') {
  const snapshot = buildCommerceIndexSnapshot();
  return [
    { id: 'commerce-index.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCommerceIndexReadinessBoard(snapshot) },
    { id: 'commerce-index.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'commerce-index.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

