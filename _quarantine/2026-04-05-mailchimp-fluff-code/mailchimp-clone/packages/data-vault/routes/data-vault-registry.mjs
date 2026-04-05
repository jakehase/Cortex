import { buildDataVaultSnapshot, createDataVaultRouteSummary } from '../service-data-vault.mjs';

export function createDataVaultRegistryRoutes(basePath = '/registry/data-vault') {
  const snapshot = buildDataVaultSnapshot();
  return [
    { id: 'data-vault.registry.summary', method: 'GET', path: basePath, summary: createDataVaultRouteSummary(snapshot) },
    { id: 'data-vault.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'data-vault.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

