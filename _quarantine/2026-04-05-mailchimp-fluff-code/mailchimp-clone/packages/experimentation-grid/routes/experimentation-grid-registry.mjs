import { buildExperimentationGridSnapshot, createExperimentationGridRouteSummary } from '../service-experimentation-grid.mjs';

export function createExperimentationGridRegistryRoutes(basePath = '/registry/experimentation-grid') {
  const snapshot = buildExperimentationGridSnapshot();
  return [
    { id: 'experimentation-grid.registry.summary', method: 'GET', path: basePath, summary: createExperimentationGridRouteSummary(snapshot) },
    { id: 'experimentation-grid.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'experimentation-grid.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

