import { buildCustomerIndexSnapshot, createCustomerIndexReadinessBoard } from '../service-customer-index.mjs';

export function createCustomerIndexOpsRoutes(basePath = '/ops/customer-index') {
  const snapshot = buildCustomerIndexSnapshot();
  return [
    { id: 'customer-index.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCustomerIndexReadinessBoard(snapshot) },
    { id: 'customer-index.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'customer-index.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

