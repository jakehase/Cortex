import { buildAdvocacyVaultSnapshot, createAdvocacyVaultReadinessBoard } from '../service-advocacy-vault.mjs';

export function createAdvocacyVaultOpsRoutes(basePath = '/ops/advocacy-vault') {
  const snapshot = buildAdvocacyVaultSnapshot();
  return [
    { id: 'advocacy-vault.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAdvocacyVaultReadinessBoard(snapshot) },
    { id: 'advocacy-vault.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'advocacy-vault.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

