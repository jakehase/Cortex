import { buildCommerceHubSnapshot, createCommerceHubReadinessBoard } from '../service-commerce-hub.mjs';

export function createCommerceHubOpsRoutes(basePath = '/ops/commerce-hub') {
  const snapshot = buildCommerceHubSnapshot();
  return [
    { id: 'commerce-hub.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCommerceHubReadinessBoard(snapshot) },
    { id: 'commerce-hub.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'commerce-hub.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

