import { buildCustomerStudioSnapshot, createCustomerStudioReadinessBoard } from '../service-customer-studio.mjs';

export function createCustomerStudioOpsRoutes(basePath = '/ops/customer-studio') {
  const snapshot = buildCustomerStudioSnapshot();
  return [
    { id: 'customer-studio.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCustomerStudioReadinessBoard(snapshot) },
    { id: 'customer-studio.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'customer-studio.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

