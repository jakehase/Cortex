import { buildCustomerWatchtowerSnapshot, createCustomerWatchtowerRouteSummary } from '../service-customer-watchtower.mjs';

export function createCustomerWatchtowerRegistryRoutes(basePath = '/registry/customer-watchtower') {
  const snapshot = buildCustomerWatchtowerSnapshot();
  return [
    { id: 'customer-watchtower.registry.summary', method: 'GET', path: basePath, summary: createCustomerWatchtowerRouteSummary(snapshot) },
    { id: 'customer-watchtower.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'customer-watchtower.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

