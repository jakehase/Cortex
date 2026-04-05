import { buildCustomerGridSnapshot, createCustomerGridReadinessBoard } from '../service-customer-grid.mjs';

export function createCustomerGridOpsRoutes(basePath = '/ops/customer-grid') {
  const snapshot = buildCustomerGridSnapshot();
  return [
    { id: 'customer-grid.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCustomerGridReadinessBoard(snapshot) },
    { id: 'customer-grid.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'customer-grid.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

