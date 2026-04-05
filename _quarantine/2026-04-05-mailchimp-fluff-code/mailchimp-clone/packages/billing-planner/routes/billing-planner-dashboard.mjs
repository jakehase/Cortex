import { buildBillingPlannerSnapshot, createBillingPlannerRouteSummary } from '../service-billing-planner.mjs';

export function createBillingPlannerDashboardRoutes(basePath = '/billing-planner') {
  const snapshot = buildBillingPlannerSnapshot();
  return [
    { id: 'billing-planner.dashboard.overview', method: 'GET', path: basePath, summary: createBillingPlannerRouteSummary(snapshot) },
    { id: 'billing-planner.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'billing-planner.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

