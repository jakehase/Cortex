import { buildExperimentationHubSnapshot, createExperimentationHubRouteSummary } from '../service-experimentation-hub.mjs';

export function createExperimentationHubRegistryRoutes(basePath = '/registry/experimentation-hub') {
  const snapshot = buildExperimentationHubSnapshot();
  return [
    { id: 'experimentation-hub.registry.summary', method: 'GET', path: basePath, summary: createExperimentationHubRouteSummary(snapshot) },
    { id: 'experimentation-hub.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'experimentation-hub.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

