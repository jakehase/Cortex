import { buildAdvocacyVaultSnapshot, createAdvocacyVaultRouteSummary } from '../service-advocacy-vault.mjs';

export function createAdvocacyVaultRegistryRoutes(basePath = '/registry/advocacy-vault') {
  const snapshot = buildAdvocacyVaultSnapshot();
  return [
    { id: 'advocacy-vault.registry.summary', method: 'GET', path: basePath, summary: createAdvocacyVaultRouteSummary(snapshot) },
    { id: 'advocacy-vault.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'advocacy-vault.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

