import { buildEcommercePlannerSnapshot, createEcommercePlannerRouteSummary } from '../service-ecommerce-planner.mjs';

export function createEcommercePlannerDashboardRoutes(basePath = '/ecommerce-planner') {
  const snapshot = buildEcommercePlannerSnapshot();
  return [
    { id: 'ecommerce-planner.dashboard.overview', method: 'GET', path: basePath, summary: createEcommercePlannerRouteSummary(snapshot) },
    { id: 'ecommerce-planner.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'ecommerce-planner.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

