import { buildBillingGridSnapshot, createBillingGridReadinessBoard } from '../service-billing-grid.mjs';

export function createBillingGridOpsRoutes(basePath = '/ops/billing-grid') {
  const snapshot = buildBillingGridSnapshot();
  return [
    { id: 'billing-grid.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createBillingGridReadinessBoard(snapshot) },
    { id: 'billing-grid.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'billing-grid.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

