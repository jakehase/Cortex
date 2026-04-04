import { buildCustomerWorkbenchSnapshot, createCustomerWorkbenchReadinessBoard } from '../service-customer-workbench.mjs';

export function createCustomerWorkbenchOpsRoutes(basePath = '/ops/customer-workbench') {
  const snapshot = buildCustomerWorkbenchSnapshot();
  return [
    { id: 'customer-workbench.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCustomerWorkbenchReadinessBoard(snapshot) },
    { id: 'customer-workbench.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'customer-workbench.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

