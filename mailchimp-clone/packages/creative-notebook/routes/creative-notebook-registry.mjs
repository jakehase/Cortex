import { buildCreativeNotebookSnapshot, createCreativeNotebookRouteSummary } from '../service-creative-notebook.mjs';

export function createCreativeNotebookRegistryRoutes(basePath = '/registry/creative-notebook') {
  const snapshot = buildCreativeNotebookSnapshot();
  return [
    { id: 'creative-notebook.registry.summary', method: 'GET', path: basePath, summary: createCreativeNotebookRouteSummary(snapshot) },
    { id: 'creative-notebook.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'creative-notebook.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

