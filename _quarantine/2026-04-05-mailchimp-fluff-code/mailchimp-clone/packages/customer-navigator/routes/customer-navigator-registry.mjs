import { buildCustomerNavigatorSnapshot, createCustomerNavigatorRouteSummary } from '../service-customer-navigator.mjs';

export function createCustomerNavigatorRegistryRoutes(basePath = '/registry/customer-navigator') {
  const snapshot = buildCustomerNavigatorSnapshot();
  return [
    { id: 'customer-navigator.registry.summary', method: 'GET', path: basePath, summary: createCustomerNavigatorRouteSummary(snapshot) },
    { id: 'customer-navigator.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'customer-navigator.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

