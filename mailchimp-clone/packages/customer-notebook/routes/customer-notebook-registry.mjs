import { buildCustomerNotebookSnapshot, createCustomerNotebookRouteSummary } from '../service-customer-notebook.mjs';

export function createCustomerNotebookRegistryRoutes(basePath = '/registry/customer-notebook') {
  const snapshot = buildCustomerNotebookSnapshot();
  return [
    { id: 'customer-notebook.registry.summary', method: 'GET', path: basePath, summary: createCustomerNotebookRouteSummary(snapshot) },
    { id: 'customer-notebook.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'customer-notebook.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

