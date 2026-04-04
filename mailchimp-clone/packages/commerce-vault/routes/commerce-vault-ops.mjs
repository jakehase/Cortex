import { buildCommerceVaultSnapshot, createCommerceVaultReadinessBoard } from '../service-commerce-vault.mjs';

export function createCommerceVaultOpsRoutes(basePath = '/ops/commerce-vault') {
  const snapshot = buildCommerceVaultSnapshot();
  return [
    { id: 'commerce-vault.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCommerceVaultReadinessBoard(snapshot) },
    { id: 'commerce-vault.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'commerce-vault.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

