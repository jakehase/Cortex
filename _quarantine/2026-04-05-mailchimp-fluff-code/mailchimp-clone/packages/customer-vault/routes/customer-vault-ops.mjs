import { buildCustomerVaultSnapshot, createCustomerVaultReadinessBoard } from '../service-customer-vault.mjs';

export function createCustomerVaultOpsRoutes(basePath = '/ops/customer-vault') {
  const snapshot = buildCustomerVaultSnapshot();
  return [
    { id: 'customer-vault.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCustomerVaultReadinessBoard(snapshot) },
    { id: 'customer-vault.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'customer-vault.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

