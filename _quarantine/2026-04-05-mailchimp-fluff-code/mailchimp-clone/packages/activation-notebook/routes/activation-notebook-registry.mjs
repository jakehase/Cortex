import { buildActivationNotebookSnapshot, createActivationNotebookRouteSummary } from '../service-activation-notebook.mjs';

export function createActivationNotebookRegistryRoutes(basePath = '/registry/activation-notebook') {
  const snapshot = buildActivationNotebookSnapshot();
  return [
    { id: 'activation-notebook.registry.summary', method: 'GET', path: basePath, summary: createActivationNotebookRouteSummary(snapshot) },
    { id: 'activation-notebook.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'activation-notebook.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

