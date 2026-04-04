import { buildExperimentationStudioSnapshot, createExperimentationStudioRouteSummary } from '../service-experimentation-studio.mjs';

export function createExperimentationStudioRegistryRoutes(basePath = '/registry/experimentation-studio') {
  const snapshot = buildExperimentationStudioSnapshot();
  return [
    { id: 'experimentation-studio.registry.summary', method: 'GET', path: basePath, summary: createExperimentationStudioRouteSummary(snapshot) },
    { id: 'experimentation-studio.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'experimentation-studio.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

