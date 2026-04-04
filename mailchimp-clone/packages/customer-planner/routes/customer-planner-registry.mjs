import { buildCustomerPlannerSnapshot, createCustomerPlannerRouteSummary } from '../service-customer-planner.mjs';

export function createCustomerPlannerRegistryRoutes(basePath = '/registry/customer-planner') {
  const snapshot = buildCustomerPlannerSnapshot();
  return [
    { id: 'customer-planner.registry.summary', method: 'GET', path: basePath, summary: createCustomerPlannerRouteSummary(snapshot) },
    { id: 'customer-planner.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'customer-planner.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

