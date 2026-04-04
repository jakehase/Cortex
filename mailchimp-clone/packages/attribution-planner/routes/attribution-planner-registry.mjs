import { buildAttributionPlannerSnapshot, createAttributionPlannerRouteSummary } from '../service-attribution-planner.mjs';

export function createAttributionPlannerRegistryRoutes(basePath = '/registry/attribution-planner') {
  const snapshot = buildAttributionPlannerSnapshot();
  return [
    { id: 'attribution-planner.registry.summary', method: 'GET', path: basePath, summary: createAttributionPlannerRouteSummary(snapshot) },
    { id: 'attribution-planner.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'attribution-planner.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

