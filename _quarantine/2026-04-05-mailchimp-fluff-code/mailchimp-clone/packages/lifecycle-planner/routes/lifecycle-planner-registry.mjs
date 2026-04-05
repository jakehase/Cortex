import { buildLifecyclePlannerSnapshot, createLifecyclePlannerRouteSummary } from '../service-lifecycle-planner.mjs';

export function createLifecyclePlannerRegistryRoutes(basePath = '/registry/lifecycle-planner') {
  const snapshot = buildLifecyclePlannerSnapshot();
  return [
    { id: 'lifecycle-planner.registry.summary', method: 'GET', path: basePath, summary: createLifecyclePlannerRouteSummary(snapshot) },
    { id: 'lifecycle-planner.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'lifecycle-planner.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

