import { buildExperimentationNotebookSnapshot, createExperimentationNotebookRouteSummary } from '../service-experimentation-notebook.mjs';

export function createExperimentationNotebookRegistryRoutes(basePath = '/registry/experimentation-notebook') {
  const snapshot = buildExperimentationNotebookSnapshot();
  return [
    { id: 'experimentation-notebook.registry.summary', method: 'GET', path: basePath, summary: createExperimentationNotebookRouteSummary(snapshot) },
    { id: 'experimentation-notebook.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'experimentation-notebook.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

