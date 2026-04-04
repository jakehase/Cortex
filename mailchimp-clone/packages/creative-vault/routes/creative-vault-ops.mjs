import { buildCreativeVaultSnapshot, createCreativeVaultReadinessBoard } from '../service-creative-vault.mjs';

export function createCreativeVaultOpsRoutes(basePath = '/ops/creative-vault') {
  const snapshot = buildCreativeVaultSnapshot();
  return [
    { id: 'creative-vault.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCreativeVaultReadinessBoard(snapshot) },
    { id: 'creative-vault.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'creative-vault.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

