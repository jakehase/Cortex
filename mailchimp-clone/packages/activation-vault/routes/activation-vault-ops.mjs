import { buildActivationVaultSnapshot, createActivationVaultReadinessBoard } from '../service-activation-vault.mjs';

export function createActivationVaultOpsRoutes(basePath = '/ops/activation-vault') {
  const snapshot = buildActivationVaultSnapshot();
  return [
    { id: 'activation-vault.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createActivationVaultReadinessBoard(snapshot) },
    { id: 'activation-vault.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'activation-vault.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

