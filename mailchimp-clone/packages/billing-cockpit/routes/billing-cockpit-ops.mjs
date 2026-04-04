import { buildBillingCockpitSnapshot, createBillingCockpitReadinessBoard } from '../service-billing-cockpit.mjs';

export function createBillingCockpitOpsRoutes(basePath = '/ops/billing-cockpit') {
  const snapshot = buildBillingCockpitSnapshot();
  return [
    { id: 'billing-cockpit.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createBillingCockpitReadinessBoard(snapshot) },
    { id: 'billing-cockpit.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'billing-cockpit.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

