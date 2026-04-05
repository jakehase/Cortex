import { buildExperimentationFoundrySnapshot, createExperimentationFoundryRouteSummary } from '../service-experimentation-foundry.mjs';

export function createExperimentationFoundryRegistryRoutes(basePath = '/registry/experimentation-foundry') {
  const snapshot = buildExperimentationFoundrySnapshot();
  return [
    { id: 'experimentation-foundry.registry.summary', method: 'GET', path: basePath, summary: createExperimentationFoundryRouteSummary(snapshot) },
    { id: 'experimentation-foundry.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'experimentation-foundry.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

