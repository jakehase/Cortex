import { buildCustomerConsoleSnapshot, createCustomerConsoleRouteSummary } from '../service-customer-console.mjs';

export function createCustomerConsoleRegistryRoutes(basePath = '/registry/customer-console') {
  const snapshot = buildCustomerConsoleSnapshot();
  return [
    { id: 'customer-console.registry.summary', method: 'GET', path: basePath, summary: createCustomerConsoleRouteSummary(snapshot) },
    { id: 'customer-console.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'customer-console.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

