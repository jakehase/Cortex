import { buildCustomerCockpitSnapshot, createCustomerCockpitReadinessBoard } from '../service-customer-cockpit.mjs';

export function createCustomerCockpitOpsRoutes(basePath = '/ops/customer-cockpit') {
  const snapshot = buildCustomerCockpitSnapshot();
  return [
    { id: 'customer-cockpit.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCustomerCockpitReadinessBoard(snapshot) },
    { id: 'customer-cockpit.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'customer-cockpit.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

