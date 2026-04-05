import { buildAutomationVaultSnapshot, createAutomationVaultReadinessBoard } from '../service-automation-vault.mjs';

export function createAutomationVaultOpsRoutes(basePath = '/ops/automation-vault') {
  const snapshot = buildAutomationVaultSnapshot();
  return [
    { id: 'automation-vault.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAutomationVaultReadinessBoard(snapshot) },
    { id: 'automation-vault.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'automation-vault.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

