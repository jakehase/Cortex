import { buildLifecycleNotebookSnapshot, createLifecycleNotebookRouteSummary } from '../service-lifecycle-notebook.mjs';

export function createLifecycleNotebookRegistryRoutes(basePath = '/registry/lifecycle-notebook') {
  const snapshot = buildLifecycleNotebookSnapshot();
  return [
    { id: 'lifecycle-notebook.registry.summary', method: 'GET', path: basePath, summary: createLifecycleNotebookRouteSummary(snapshot) },
    { id: 'lifecycle-notebook.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'lifecycle-notebook.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

