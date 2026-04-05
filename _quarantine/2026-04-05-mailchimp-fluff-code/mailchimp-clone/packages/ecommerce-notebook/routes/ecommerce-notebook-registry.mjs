import { buildEcommerceNotebookSnapshot, createEcommerceNotebookRouteSummary } from '../service-ecommerce-notebook.mjs';

export function createEcommerceNotebookRegistryRoutes(basePath = '/registry/ecommerce-notebook') {
  const snapshot = buildEcommerceNotebookSnapshot();
  return [
    { id: 'ecommerce-notebook.registry.summary', method: 'GET', path: basePath, summary: createEcommerceNotebookRouteSummary(snapshot) },
    { id: 'ecommerce-notebook.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'ecommerce-notebook.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

