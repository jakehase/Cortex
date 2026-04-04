import { buildBillingIndexSnapshot, createBillingIndexReadinessBoard } from '../service-billing-index.mjs';

export function createBillingIndexOpsRoutes(basePath = '/ops/billing-index') {
  const snapshot = buildBillingIndexSnapshot();
  return [
    { id: 'billing-index.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createBillingIndexReadinessBoard(snapshot) },
    { id: 'billing-index.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'billing-index.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

