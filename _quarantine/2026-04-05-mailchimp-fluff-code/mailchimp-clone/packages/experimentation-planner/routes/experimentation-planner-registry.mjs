import { buildExperimentationPlannerSnapshot, createExperimentationPlannerRouteSummary } from '../service-experimentation-planner.mjs';

export function createExperimentationPlannerRegistryRoutes(basePath = '/registry/experimentation-planner') {
  const snapshot = buildExperimentationPlannerSnapshot();
  return [
    { id: 'experimentation-planner.registry.summary', method: 'GET', path: basePath, summary: createExperimentationPlannerRouteSummary(snapshot) },
    { id: 'experimentation-planner.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'experimentation-planner.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

