import { buildCustomerConsoleSnapshot, createCustomerConsoleReadinessBoard } from '../service-customer-console.mjs';

export function createCustomerConsoleOpsRoutes(basePath = '/ops/customer-console') {
  const snapshot = buildCustomerConsoleSnapshot();
  return [
    { id: 'customer-console.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCustomerConsoleReadinessBoard(snapshot) },
    { id: 'customer-console.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'customer-console.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

