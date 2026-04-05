import { buildIntegrationsNotebookSnapshot, createIntegrationsNotebookRouteSummary } from '../service-integrations-notebook.mjs';

export function createIntegrationsNotebookRegistryRoutes(basePath = '/registry/integrations-notebook') {
  const snapshot = buildIntegrationsNotebookSnapshot();
  return [
    { id: 'integrations-notebook.registry.summary', method: 'GET', path: basePath, summary: createIntegrationsNotebookRouteSummary(snapshot) },
    { id: 'integrations-notebook.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'integrations-notebook.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

