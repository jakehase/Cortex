import { buildLoyaltyVaultSnapshot, createLoyaltyVaultReadinessBoard } from '../service-loyalty-vault.mjs';

export function createLoyaltyVaultOpsRoutes(basePath = '/ops/loyalty-vault') {
  const snapshot = buildLoyaltyVaultSnapshot();
  return [
    { id: 'loyalty-vault.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLoyaltyVaultReadinessBoard(snapshot) },
    { id: 'loyalty-vault.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'loyalty-vault.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

