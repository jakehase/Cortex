import { buildCommerceNavigatorSnapshot, createCommerceNavigatorReadinessBoard } from '../service-commerce-navigator.mjs';

export function createCommerceNavigatorOpsRoutes(basePath = '/ops/commerce-navigator') {
  const snapshot = buildCommerceNavigatorSnapshot();
  return [
    { id: 'commerce-navigator.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCommerceNavigatorReadinessBoard(snapshot) },
    { id: 'commerce-navigator.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'commerce-navigator.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

