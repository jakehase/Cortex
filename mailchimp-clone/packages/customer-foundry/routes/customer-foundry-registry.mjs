import { buildCustomerFoundrySnapshot, createCustomerFoundryRouteSummary } from '../service-customer-foundry.mjs';

export function createCustomerFoundryRegistryRoutes(basePath = '/registry/customer-foundry') {
  const snapshot = buildCustomerFoundrySnapshot();
  return [
    { id: 'customer-foundry.registry.summary', method: 'GET', path: basePath, summary: createCustomerFoundryRouteSummary(snapshot) },
    { id: 'customer-foundry.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'customer-foundry.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

