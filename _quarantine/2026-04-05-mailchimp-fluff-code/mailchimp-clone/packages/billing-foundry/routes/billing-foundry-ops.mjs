import { buildBillingFoundrySnapshot, createBillingFoundryReadinessBoard } from '../service-billing-foundry.mjs';

export function createBillingFoundryOpsRoutes(basePath = '/ops/billing-foundry') {
  const snapshot = buildBillingFoundrySnapshot();
  return [
    { id: 'billing-foundry.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createBillingFoundryReadinessBoard(snapshot) },
    { id: 'billing-foundry.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'billing-foundry.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

