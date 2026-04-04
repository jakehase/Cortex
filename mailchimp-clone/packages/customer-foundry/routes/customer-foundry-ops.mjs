import { buildCustomerFoundrySnapshot, createCustomerFoundryReadinessBoard } from '../service-customer-foundry.mjs';

export function createCustomerFoundryOpsRoutes(basePath = '/ops/customer-foundry') {
  const snapshot = buildCustomerFoundrySnapshot();
  return [
    { id: 'customer-foundry.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCustomerFoundryReadinessBoard(snapshot) },
    { id: 'customer-foundry.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'customer-foundry.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

