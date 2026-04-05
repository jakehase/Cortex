import { buildDataVaultSnapshot, createDataVaultReadinessBoard } from '../service-data-vault.mjs';

export function createDataVaultOpsRoutes(basePath = '/ops/data-vault') {
  const snapshot = buildDataVaultSnapshot();
  return [
    { id: 'data-vault.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createDataVaultReadinessBoard(snapshot) },
    { id: 'data-vault.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'data-vault.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

