import { buildCustomerHubSnapshot, createCustomerHubRouteSummary } from '../service-customer-hub.mjs';

export function createCustomerHubRegistryRoutes(basePath = '/registry/customer-hub') {
  const snapshot = buildCustomerHubSnapshot();
  return [
    { id: 'customer-hub.registry.summary', method: 'GET', path: basePath, summary: createCustomerHubRouteSummary(snapshot) },
    { id: 'customer-hub.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'customer-hub.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

