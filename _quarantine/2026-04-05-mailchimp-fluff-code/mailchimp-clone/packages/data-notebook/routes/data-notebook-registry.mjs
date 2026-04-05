import { buildDataNotebookSnapshot, createDataNotebookRouteSummary } from '../service-data-notebook.mjs';

export function createDataNotebookRegistryRoutes(basePath = '/registry/data-notebook') {
  const snapshot = buildDataNotebookSnapshot();
  return [
    { id: 'data-notebook.registry.summary', method: 'GET', path: basePath, summary: createDataNotebookRouteSummary(snapshot) },
    { id: 'data-notebook.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'data-notebook.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

