import { buildComplianceVaultSnapshot, createComplianceVaultRouteSummary } from '../service-compliance-vault.mjs';

export function createComplianceVaultRegistryRoutes(basePath = '/registry/compliance-vault') {
  const snapshot = buildComplianceVaultSnapshot();
  return [
    { id: 'compliance-vault.registry.summary', method: 'GET', path: basePath, summary: createComplianceVaultRouteSummary(snapshot) },
    { id: 'compliance-vault.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'compliance-vault.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

