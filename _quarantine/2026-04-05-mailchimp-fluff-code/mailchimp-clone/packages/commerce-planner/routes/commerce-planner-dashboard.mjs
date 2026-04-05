import { buildCommercePlannerSnapshot, createCommercePlannerRouteSummary } from '../service-commerce-planner.mjs';

export function createCommercePlannerDashboardRoutes(basePath = '/commerce-planner') {
  const snapshot = buildCommercePlannerSnapshot();
  return [
    { id: 'commerce-planner.dashboard.overview', method: 'GET', path: basePath, summary: createCommercePlannerRouteSummary(snapshot) },
    { id: 'commerce-planner.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'commerce-planner.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

