import { buildCustomerGridSnapshot, createCustomerGridRouteSummary } from '../service-customer-grid.mjs';

export function createCustomerGridRegistryRoutes(basePath = '/registry/customer-grid') {
  const snapshot = buildCustomerGridSnapshot();
  return [
    { id: 'customer-grid.registry.summary', method: 'GET', path: basePath, summary: createCustomerGridRouteSummary(snapshot) },
    { id: 'customer-grid.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'customer-grid.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

