import { buildBillingPlannerSnapshot, createBillingPlannerRouteSummary } from '../service-billing-planner.mjs';

export function createBillingPlannerRegistryRoutes(basePath = '/registry/billing-planner') {
  const snapshot = buildBillingPlannerSnapshot();
  return [
    { id: 'billing-planner.registry.summary', method: 'GET', path: basePath, summary: createBillingPlannerRouteSummary(snapshot) },
    { id: 'billing-planner.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'billing-planner.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

