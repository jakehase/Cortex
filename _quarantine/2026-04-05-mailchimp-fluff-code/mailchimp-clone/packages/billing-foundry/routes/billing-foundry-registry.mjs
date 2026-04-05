import { buildBillingFoundrySnapshot, createBillingFoundryRouteSummary } from '../service-billing-foundry.mjs';

export function createBillingFoundryRegistryRoutes(basePath = '/registry/billing-foundry') {
  const snapshot = buildBillingFoundrySnapshot();
  return [
    { id: 'billing-foundry.registry.summary', method: 'GET', path: basePath, summary: createBillingFoundryRouteSummary(snapshot) },
    { id: 'billing-foundry.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'billing-foundry.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

