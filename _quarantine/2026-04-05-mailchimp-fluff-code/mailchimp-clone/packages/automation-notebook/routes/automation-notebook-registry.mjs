import { buildAutomationNotebookSnapshot, createAutomationNotebookRouteSummary } from '../service-automation-notebook.mjs';

export function createAutomationNotebookRegistryRoutes(basePath = '/registry/automation-notebook') {
  const snapshot = buildAutomationNotebookSnapshot();
  return [
    { id: 'automation-notebook.registry.summary', method: 'GET', path: basePath, summary: createAutomationNotebookRouteSummary(snapshot) },
    { id: 'automation-notebook.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'automation-notebook.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

