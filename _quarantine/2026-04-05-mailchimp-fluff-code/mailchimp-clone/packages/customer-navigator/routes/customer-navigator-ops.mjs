import { buildCustomerNavigatorSnapshot, createCustomerNavigatorReadinessBoard } from '../service-customer-navigator.mjs';

export function createCustomerNavigatorOpsRoutes(basePath = '/ops/customer-navigator') {
  const snapshot = buildCustomerNavigatorSnapshot();
  return [
    { id: 'customer-navigator.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCustomerNavigatorReadinessBoard(snapshot) },
    { id: 'customer-navigator.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'customer-navigator.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

