import { buildEcommerceVaultSnapshot, createEcommerceVaultReadinessBoard } from '../service-ecommerce-vault.mjs';

export function createEcommerceVaultOpsRoutes(basePath = '/ops/ecommerce-vault') {
  const snapshot = buildEcommerceVaultSnapshot();
  return [
    { id: 'ecommerce-vault.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createEcommerceVaultReadinessBoard(snapshot) },
    { id: 'ecommerce-vault.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'ecommerce-vault.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

