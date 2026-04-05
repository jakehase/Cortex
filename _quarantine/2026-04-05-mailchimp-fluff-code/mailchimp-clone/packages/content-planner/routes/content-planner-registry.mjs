import { buildContentPlannerSnapshot, createContentPlannerRouteSummary } from '../service-content-planner.mjs';

export function createContentPlannerRegistryRoutes(basePath = '/registry/content-planner') {
  const snapshot = buildContentPlannerSnapshot();
  return [
    { id: 'content-planner.registry.summary', method: 'GET', path: basePath, summary: createContentPlannerRouteSummary(snapshot) },
    { id: 'content-planner.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'content-planner.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

