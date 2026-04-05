import { buildAttributionNotebookSnapshot, createAttributionNotebookRouteSummary } from '../service-attribution-notebook.mjs';

export function createAttributionNotebookRegistryRoutes(basePath = '/registry/attribution-notebook') {
  const snapshot = buildAttributionNotebookSnapshot();
  return [
    { id: 'attribution-notebook.registry.summary', method: 'GET', path: basePath, summary: createAttributionNotebookRouteSummary(snapshot) },
    { id: 'attribution-notebook.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'attribution-notebook.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

