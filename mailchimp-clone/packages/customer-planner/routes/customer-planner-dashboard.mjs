import { buildCustomerPlannerSnapshot, createCustomerPlannerRouteSummary } from '../service-customer-planner.mjs';

export function createCustomerPlannerDashboardRoutes(basePath = '/customer-planner') {
  const snapshot = buildCustomerPlannerSnapshot();
  return [
    { id: 'customer-planner.dashboard.overview', method: 'GET', path: basePath, summary: createCustomerPlannerRouteSummary(snapshot) },
    { id: 'customer-planner.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'customer-planner.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

