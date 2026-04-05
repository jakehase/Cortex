import { buildCreativePlannerSnapshot, createCreativePlannerRouteSummary } from '../service-creative-planner.mjs';

export function createCreativePlannerRegistryRoutes(basePath = '/registry/creative-planner') {
  const snapshot = buildCreativePlannerSnapshot();
  return [
    { id: 'creative-planner.registry.summary', method: 'GET', path: basePath, summary: createCreativePlannerRouteSummary(snapshot) },
    { id: 'creative-planner.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'creative-planner.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

