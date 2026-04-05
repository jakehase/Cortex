import { buildCustomerVaultSnapshot, createCustomerVaultRouteSummary } from '../service-customer-vault.mjs';

export function createCustomerVaultRegistryRoutes(basePath = '/registry/customer-vault') {
  const snapshot = buildCustomerVaultSnapshot();
  return [
    { id: 'customer-vault.registry.summary', method: 'GET', path: basePath, summary: createCustomerVaultRouteSummary(snapshot) },
    { id: 'customer-vault.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'customer-vault.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

