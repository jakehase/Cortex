import { buildCustomerIndexSnapshot, createCustomerIndexRouteSummary } from '../service-customer-index.mjs';

export function createCustomerIndexRegistryRoutes(basePath = '/registry/customer-index') {
  const snapshot = buildCustomerIndexSnapshot();
  return [
    { id: 'customer-index.registry.summary', method: 'GET', path: basePath, summary: createCustomerIndexRouteSummary(snapshot) },
    { id: 'customer-index.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'customer-index.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

