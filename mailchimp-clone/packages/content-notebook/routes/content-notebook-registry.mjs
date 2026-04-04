import { buildContentNotebookSnapshot, createContentNotebookRouteSummary } from '../service-content-notebook.mjs';

export function createContentNotebookRegistryRoutes(basePath = '/registry/content-notebook') {
  const snapshot = buildContentNotebookSnapshot();
  return [
    { id: 'content-notebook.registry.summary', method: 'GET', path: basePath, summary: createContentNotebookRouteSummary(snapshot) },
    { id: 'content-notebook.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'content-notebook.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

