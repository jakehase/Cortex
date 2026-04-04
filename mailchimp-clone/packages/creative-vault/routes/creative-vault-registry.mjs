import { buildCreativeVaultSnapshot, createCreativeVaultRouteSummary } from '../service-creative-vault.mjs';

export function createCreativeVaultRegistryRoutes(basePath = '/registry/creative-vault') {
  const snapshot = buildCreativeVaultSnapshot();
  return [
    { id: 'creative-vault.registry.summary', method: 'GET', path: basePath, summary: createCreativeVaultRouteSummary(snapshot) },
    { id: 'creative-vault.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'creative-vault.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

