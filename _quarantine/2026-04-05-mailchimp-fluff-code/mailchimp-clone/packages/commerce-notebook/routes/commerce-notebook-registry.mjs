import { buildCommerceNotebookSnapshot, createCommerceNotebookRouteSummary } from '../service-commerce-notebook.mjs';

export function createCommerceNotebookRegistryRoutes(basePath = '/registry/commerce-notebook') {
  const snapshot = buildCommerceNotebookSnapshot();
  return [
    { id: 'commerce-notebook.registry.summary', method: 'GET', path: basePath, summary: createCommerceNotebookRouteSummary(snapshot) },
    { id: 'commerce-notebook.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'commerce-notebook.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

