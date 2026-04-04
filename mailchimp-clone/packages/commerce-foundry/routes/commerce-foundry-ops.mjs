import { buildCommerceFoundrySnapshot, createCommerceFoundryReadinessBoard } from '../service-commerce-foundry.mjs';

export function createCommerceFoundryOpsRoutes(basePath = '/ops/commerce-foundry') {
  const snapshot = buildCommerceFoundrySnapshot();
  return [
    { id: 'commerce-foundry.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCommerceFoundryReadinessBoard(snapshot) },
    { id: 'commerce-foundry.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'commerce-foundry.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

