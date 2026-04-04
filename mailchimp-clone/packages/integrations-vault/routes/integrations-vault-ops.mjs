import { buildIntegrationsVaultSnapshot, createIntegrationsVaultReadinessBoard } from '../service-integrations-vault.mjs';

export function createIntegrationsVaultOpsRoutes(basePath = '/ops/integrations-vault') {
  const snapshot = buildIntegrationsVaultSnapshot();
  return [
    { id: 'integrations-vault.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createIntegrationsVaultReadinessBoard(snapshot) },
    { id: 'integrations-vault.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'integrations-vault.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

