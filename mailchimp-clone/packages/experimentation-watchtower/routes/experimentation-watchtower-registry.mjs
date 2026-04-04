import { buildExperimentationWatchtowerSnapshot, createExperimentationWatchtowerRouteSummary } from '../service-experimentation-watchtower.mjs';

export function createExperimentationWatchtowerRegistryRoutes(basePath = '/registry/experimentation-watchtower') {
  const snapshot = buildExperimentationWatchtowerSnapshot();
  return [
    { id: 'experimentation-watchtower.registry.summary', method: 'GET', path: basePath, summary: createExperimentationWatchtowerRouteSummary(snapshot) },
    { id: 'experimentation-watchtower.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'experimentation-watchtower.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

