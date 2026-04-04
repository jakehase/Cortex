import { buildActivationPlannerSnapshot, createActivationPlannerRouteSummary } from '../service-activation-planner.mjs';

export function createActivationPlannerRegistryRoutes(basePath = '/registry/activation-planner') {
  const snapshot = buildActivationPlannerSnapshot();
  return [
    { id: 'activation-planner.registry.summary', method: 'GET', path: basePath, summary: createActivationPlannerRouteSummary(snapshot) },
    { id: 'activation-planner.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'activation-planner.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

