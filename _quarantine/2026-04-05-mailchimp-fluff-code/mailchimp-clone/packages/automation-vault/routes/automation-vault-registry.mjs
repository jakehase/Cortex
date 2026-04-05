import { buildAutomationVaultSnapshot, createAutomationVaultRouteSummary } from '../service-automation-vault.mjs';

export function createAutomationVaultRegistryRoutes(basePath = '/registry/automation-vault') {
  const snapshot = buildAutomationVaultSnapshot();
  return [
    { id: 'automation-vault.registry.summary', method: 'GET', path: basePath, summary: createAutomationVaultRouteSummary(snapshot) },
    { id: 'automation-vault.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'automation-vault.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

