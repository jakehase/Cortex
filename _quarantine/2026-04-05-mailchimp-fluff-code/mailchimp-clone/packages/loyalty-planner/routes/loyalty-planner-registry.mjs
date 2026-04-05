import { buildLoyaltyPlannerSnapshot, createLoyaltyPlannerRouteSummary } from '../service-loyalty-planner.mjs';

export function createLoyaltyPlannerRegistryRoutes(basePath = '/registry/loyalty-planner') {
  const snapshot = buildLoyaltyPlannerSnapshot();
  return [
    { id: 'loyalty-planner.registry.summary', method: 'GET', path: basePath, summary: createLoyaltyPlannerRouteSummary(snapshot) },
    { id: 'loyalty-planner.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'loyalty-planner.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

