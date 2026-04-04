import { buildAdvocacyNotebookSnapshot, createAdvocacyNotebookRouteSummary } from '../service-advocacy-notebook.mjs';

export function createAdvocacyNotebookRegistryRoutes(basePath = '/registry/advocacy-notebook') {
  const snapshot = buildAdvocacyNotebookSnapshot();
  return [
    { id: 'advocacy-notebook.registry.summary', method: 'GET', path: basePath, summary: createAdvocacyNotebookRouteSummary(snapshot) },
    { id: 'advocacy-notebook.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'advocacy-notebook.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

