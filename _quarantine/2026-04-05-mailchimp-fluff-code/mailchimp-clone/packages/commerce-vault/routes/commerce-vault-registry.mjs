import { buildCommerceVaultSnapshot, createCommerceVaultRouteSummary } from '../service-commerce-vault.mjs';

export function createCommerceVaultRegistryRoutes(basePath = '/registry/commerce-vault') {
  const snapshot = buildCommerceVaultSnapshot();
  return [
    { id: 'commerce-vault.registry.summary', method: 'GET', path: basePath, summary: createCommerceVaultRouteSummary(snapshot) },
    { id: 'commerce-vault.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'commerce-vault.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

