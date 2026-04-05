import { buildAttributionVaultSnapshot, createAttributionVaultRouteSummary } from '../service-attribution-vault.mjs';

export function createAttributionVaultRegistryRoutes(basePath = '/registry/attribution-vault') {
  const snapshot = buildAttributionVaultSnapshot();
  return [
    { id: 'attribution-vault.registry.summary', method: 'GET', path: basePath, summary: createAttributionVaultRouteSummary(snapshot) },
    { id: 'attribution-vault.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'attribution-vault.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

