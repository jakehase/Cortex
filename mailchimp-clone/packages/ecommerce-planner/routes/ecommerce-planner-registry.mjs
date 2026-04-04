import { buildEcommercePlannerSnapshot, createEcommercePlannerRouteSummary } from '../service-ecommerce-planner.mjs';

export function createEcommercePlannerRegistryRoutes(basePath = '/registry/ecommerce-planner') {
  const snapshot = buildEcommercePlannerSnapshot();
  return [
    { id: 'ecommerce-planner.registry.summary', method: 'GET', path: basePath, summary: createEcommercePlannerRouteSummary(snapshot) },
    { id: 'ecommerce-planner.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'ecommerce-planner.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

