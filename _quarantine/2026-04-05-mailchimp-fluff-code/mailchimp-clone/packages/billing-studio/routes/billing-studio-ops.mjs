import { buildBillingStudioSnapshot, createBillingStudioReadinessBoard } from '../service-billing-studio.mjs';

export function createBillingStudioOpsRoutes(basePath = '/ops/billing-studio') {
  const snapshot = buildBillingStudioSnapshot();
  return [
    { id: 'billing-studio.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createBillingStudioReadinessBoard(snapshot) },
    { id: 'billing-studio.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'billing-studio.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

