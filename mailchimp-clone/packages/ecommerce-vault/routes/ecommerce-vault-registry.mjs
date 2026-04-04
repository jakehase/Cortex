import { buildEcommerceVaultSnapshot, createEcommerceVaultRouteSummary } from '../service-ecommerce-vault.mjs';

export function createEcommerceVaultRegistryRoutes(basePath = '/registry/ecommerce-vault') {
  const snapshot = buildEcommerceVaultSnapshot();
  return [
    { id: 'ecommerce-vault.registry.summary', method: 'GET', path: basePath, summary: createEcommerceVaultRouteSummary(snapshot) },
    { id: 'ecommerce-vault.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'ecommerce-vault.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

