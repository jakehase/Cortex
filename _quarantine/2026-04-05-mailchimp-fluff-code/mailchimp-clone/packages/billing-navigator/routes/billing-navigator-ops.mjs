import { buildBillingNavigatorSnapshot, createBillingNavigatorReadinessBoard } from '../service-billing-navigator.mjs';

export function createBillingNavigatorOpsRoutes(basePath = '/ops/billing-navigator') {
  const snapshot = buildBillingNavigatorSnapshot();
  return [
    { id: 'billing-navigator.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createBillingNavigatorReadinessBoard(snapshot) },
    { id: 'billing-navigator.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'billing-navigator.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

