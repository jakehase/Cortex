import { buildBillingVaultSnapshot, createBillingVaultRouteSummary } from '../service-billing-vault.mjs';

export function createBillingVaultRegistryRoutes(basePath = '/registry/billing-vault') {
  const snapshot = buildBillingVaultSnapshot();
  return [
    { id: 'billing-vault.registry.summary', method: 'GET', path: basePath, summary: createBillingVaultRouteSummary(snapshot) },
    { id: 'billing-vault.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'billing-vault.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

