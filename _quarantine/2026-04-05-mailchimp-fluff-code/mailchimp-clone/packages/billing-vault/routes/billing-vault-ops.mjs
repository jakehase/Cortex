import { buildBillingVaultSnapshot, createBillingVaultReadinessBoard } from '../service-billing-vault.mjs';

export function createBillingVaultOpsRoutes(basePath = '/ops/billing-vault') {
  const snapshot = buildBillingVaultSnapshot();
  return [
    { id: 'billing-vault.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createBillingVaultReadinessBoard(snapshot) },
    { id: 'billing-vault.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'billing-vault.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

