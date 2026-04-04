import { buildCustomerStudioSnapshot, createCustomerStudioRouteSummary } from '../service-customer-studio.mjs';

export function createCustomerStudioRegistryRoutes(basePath = '/registry/customer-studio') {
  const snapshot = buildCustomerStudioSnapshot();
  return [
    { id: 'customer-studio.registry.summary', method: 'GET', path: basePath, summary: createCustomerStudioRouteSummary(snapshot) },
    { id: 'customer-studio.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'customer-studio.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

