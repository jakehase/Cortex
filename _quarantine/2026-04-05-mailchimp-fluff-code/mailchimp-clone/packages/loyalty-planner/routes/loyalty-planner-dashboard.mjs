import { buildLoyaltyPlannerSnapshot, createLoyaltyPlannerRouteSummary } from '../service-loyalty-planner.mjs';

export function createLoyaltyPlannerDashboardRoutes(basePath = '/loyalty-planner') {
  const snapshot = buildLoyaltyPlannerSnapshot();
  return [
    { id: 'loyalty-planner.dashboard.overview', method: 'GET', path: basePath, summary: createLoyaltyPlannerRouteSummary(snapshot) },
    { id: 'loyalty-planner.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'loyalty-planner.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

