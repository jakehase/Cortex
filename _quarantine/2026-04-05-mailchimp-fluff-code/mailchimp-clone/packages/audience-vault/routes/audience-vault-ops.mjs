import { buildAudienceVaultSnapshot, createAudienceVaultReadinessBoard } from '../service-audience-vault.mjs';

export function createAudienceVaultOpsRoutes(basePath = '/ops/audience-vault') {
  const snapshot = buildAudienceVaultSnapshot();
  return [
    { id: 'audience-vault.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAudienceVaultReadinessBoard(snapshot) },
    { id: 'audience-vault.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'audience-vault.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

