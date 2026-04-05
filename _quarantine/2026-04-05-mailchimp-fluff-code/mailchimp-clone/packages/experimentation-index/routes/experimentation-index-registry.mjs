import { buildExperimentationIndexSnapshot, createExperimentationIndexRouteSummary } from '../service-experimentation-index.mjs';

export function createExperimentationIndexRegistryRoutes(basePath = '/registry/experimentation-index') {
  const snapshot = buildExperimentationIndexSnapshot();
  return [
    { id: 'experimentation-index.registry.summary', method: 'GET', path: basePath, summary: createExperimentationIndexRouteSummary(snapshot) },
    { id: 'experimentation-index.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'experimentation-index.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

