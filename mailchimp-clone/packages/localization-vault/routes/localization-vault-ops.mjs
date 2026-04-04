import { buildLocalizationVaultSnapshot, createLocalizationVaultReadinessBoard } from '../service-localization-vault.mjs';

export function createLocalizationVaultOpsRoutes(basePath = '/ops/localization-vault') {
  const snapshot = buildLocalizationVaultSnapshot();
  return [
    { id: 'localization-vault.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLocalizationVaultReadinessBoard(snapshot) },
    { id: 'localization-vault.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'localization-vault.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

