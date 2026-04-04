import { buildBillingNotebookSnapshot, createBillingNotebookRouteSummary } from '../service-billing-notebook.mjs';

export function createBillingNotebookRegistryRoutes(basePath = '/registry/billing-notebook') {
  const snapshot = buildBillingNotebookSnapshot();
  return [
    { id: 'billing-notebook.registry.summary', method: 'GET', path: basePath, summary: createBillingNotebookRouteSummary(snapshot) },
    { id: 'billing-notebook.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'billing-notebook.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

