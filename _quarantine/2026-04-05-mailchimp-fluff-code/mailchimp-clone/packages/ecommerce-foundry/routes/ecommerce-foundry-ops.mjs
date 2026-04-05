import { buildEcommerceFoundrySnapshot, createEcommerceFoundryReadinessBoard } from '../service-ecommerce-foundry.mjs';

export function createEcommerceFoundryOpsRoutes(basePath = '/ops/ecommerce-foundry') {
  const snapshot = buildEcommerceFoundrySnapshot();
  return [
    { id: 'ecommerce-foundry.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createEcommerceFoundryReadinessBoard(snapshot) },
    { id: 'ecommerce-foundry.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'ecommerce-foundry.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

