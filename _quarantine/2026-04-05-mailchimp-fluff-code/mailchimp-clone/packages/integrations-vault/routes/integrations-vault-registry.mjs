import { buildIntegrationsVaultSnapshot, createIntegrationsVaultRouteSummary } from '../service-integrations-vault.mjs';

export function createIntegrationsVaultRegistryRoutes(basePath = '/registry/integrations-vault') {
  const snapshot = buildIntegrationsVaultSnapshot();
  return [
    { id: 'integrations-vault.registry.summary', method: 'GET', path: basePath, summary: createIntegrationsVaultRouteSummary(snapshot) },
    { id: 'integrations-vault.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'integrations-vault.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

