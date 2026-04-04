import { buildExperimentationNavigatorSnapshot, createExperimentationNavigatorRouteSummary } from '../service-experimentation-navigator.mjs';

export function createExperimentationNavigatorRegistryRoutes(basePath = '/registry/experimentation-navigator') {
  const snapshot = buildExperimentationNavigatorSnapshot();
  return [
    { id: 'experimentation-navigator.registry.summary', method: 'GET', path: basePath, summary: createExperimentationNavigatorRouteSummary(snapshot) },
    { id: 'experimentation-navigator.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'experimentation-navigator.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

