import { buildAttributionPlannerSnapshot, createAttributionPlannerRouteSummary } from '../service-attribution-planner.mjs';

export function createAttributionPlannerDashboardRoutes(basePath = '/attribution-planner') {
  const snapshot = buildAttributionPlannerSnapshot();
  return [
    { id: 'attribution-planner.dashboard.overview', method: 'GET', path: basePath, summary: createAttributionPlannerRouteSummary(snapshot) },
    { id: 'attribution-planner.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'attribution-planner.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

