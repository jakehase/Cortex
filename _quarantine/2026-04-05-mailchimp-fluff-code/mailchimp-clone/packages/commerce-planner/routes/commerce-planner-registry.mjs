import { buildCommercePlannerSnapshot, createCommercePlannerRouteSummary } from '../service-commerce-planner.mjs';

export function createCommercePlannerRegistryRoutes(basePath = '/registry/commerce-planner') {
  const snapshot = buildCommercePlannerSnapshot();
  return [
    { id: 'commerce-planner.registry.summary', method: 'GET', path: basePath, summary: createCommercePlannerRouteSummary(snapshot) },
    { id: 'commerce-planner.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'commerce-planner.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

