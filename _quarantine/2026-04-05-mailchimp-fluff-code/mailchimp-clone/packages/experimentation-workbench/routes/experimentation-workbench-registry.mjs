import { buildExperimentationWorkbenchSnapshot, createExperimentationWorkbenchRouteSummary } from '../service-experimentation-workbench.mjs';

export function createExperimentationWorkbenchRegistryRoutes(basePath = '/registry/experimentation-workbench') {
  const snapshot = buildExperimentationWorkbenchSnapshot();
  return [
    { id: 'experimentation-workbench.registry.summary', method: 'GET', path: basePath, summary: createExperimentationWorkbenchRouteSummary(snapshot) },
    { id: 'experimentation-workbench.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'experimentation-workbench.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

