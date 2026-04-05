import { buildAttributionVaultSnapshot, createAttributionVaultReadinessBoard } from '../service-attribution-vault.mjs';

export function createAttributionVaultOpsRoutes(basePath = '/ops/attribution-vault') {
  const snapshot = buildAttributionVaultSnapshot();
  return [
    { id: 'attribution-vault.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAttributionVaultReadinessBoard(snapshot) },
    { id: 'attribution-vault.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'attribution-vault.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

