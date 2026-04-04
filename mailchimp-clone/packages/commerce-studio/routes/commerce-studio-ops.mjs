import { buildCommerceStudioSnapshot, createCommerceStudioReadinessBoard } from '../service-commerce-studio.mjs';

export function createCommerceStudioOpsRoutes(basePath = '/ops/commerce-studio') {
  const snapshot = buildCommerceStudioSnapshot();
  return [
    { id: 'commerce-studio.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCommerceStudioReadinessBoard(snapshot) },
    { id: 'commerce-studio.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'commerce-studio.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

