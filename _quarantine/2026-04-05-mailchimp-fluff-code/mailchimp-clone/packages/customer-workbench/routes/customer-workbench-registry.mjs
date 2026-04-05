import { buildCustomerWorkbenchSnapshot, createCustomerWorkbenchRouteSummary } from '../service-customer-workbench.mjs';

export function createCustomerWorkbenchRegistryRoutes(basePath = '/registry/customer-workbench') {
  const snapshot = buildCustomerWorkbenchSnapshot();
  return [
    { id: 'customer-workbench.registry.summary', method: 'GET', path: basePath, summary: createCustomerWorkbenchRouteSummary(snapshot) },
    { id: 'customer-workbench.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'customer-workbench.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

