import { buildContentPlannerSnapshot, createContentPlannerRouteSummary } from '../service-content-planner.mjs';

export function createContentPlannerDashboardRoutes(basePath = '/content-planner') {
  const snapshot = buildContentPlannerSnapshot();
  return [
    { id: 'content-planner.dashboard.overview', method: 'GET', path: basePath, summary: createContentPlannerRouteSummary(snapshot) },
    { id: 'content-planner.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'content-planner.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

