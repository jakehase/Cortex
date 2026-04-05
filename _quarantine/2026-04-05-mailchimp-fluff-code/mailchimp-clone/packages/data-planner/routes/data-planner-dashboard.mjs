import { buildDataPlannerSnapshot, createDataPlannerRouteSummary } from '../service-data-planner.mjs';

export function createDataPlannerDashboardRoutes(basePath = '/data-planner') {
  const snapshot = buildDataPlannerSnapshot();
  return [
    { id: 'data-planner.dashboard.overview', method: 'GET', path: basePath, summary: createDataPlannerRouteSummary(snapshot) },
    { id: 'data-planner.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'data-planner.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

