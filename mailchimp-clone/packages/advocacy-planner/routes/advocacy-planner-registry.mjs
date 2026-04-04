import { buildAdvocacyPlannerSnapshot, createAdvocacyPlannerRouteSummary } from '../service-advocacy-planner.mjs';

export function createAdvocacyPlannerRegistryRoutes(basePath = '/registry/advocacy-planner') {
  const snapshot = buildAdvocacyPlannerSnapshot();
  return [
    { id: 'advocacy-planner.registry.summary', method: 'GET', path: basePath, summary: createAdvocacyPlannerRouteSummary(snapshot) },
    { id: 'advocacy-planner.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'advocacy-planner.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

