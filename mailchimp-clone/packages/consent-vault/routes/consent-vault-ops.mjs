import { buildConsentVaultSnapshot, createConsentVaultReadinessBoard } from '../service-consent-vault.mjs';

export function createConsentVaultOpsRoutes(basePath = '/ops/consent-vault') {
  const snapshot = buildConsentVaultSnapshot();
  return [
    { id: 'consent-vault.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createConsentVaultReadinessBoard(snapshot) },
    { id: 'consent-vault.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'consent-vault.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

