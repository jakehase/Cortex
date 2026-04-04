import { buildComplianceVaultSnapshot, createComplianceVaultReadinessBoard } from '../service-compliance-vault.mjs';

export function createComplianceVaultOpsRoutes(basePath = '/ops/compliance-vault') {
  const snapshot = buildComplianceVaultSnapshot();
  return [
    { id: 'compliance-vault.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createComplianceVaultReadinessBoard(snapshot) },
    { id: 'compliance-vault.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'compliance-vault.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

