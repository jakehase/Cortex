import { buildCreativePlannerSnapshot, createCreativePlannerRouteSummary } from '../service-creative-planner.mjs';

export function createCreativePlannerDashboardRoutes(basePath = '/creative-planner') {
  const snapshot = buildCreativePlannerSnapshot();
  return [
    { id: 'creative-planner.dashboard.overview', method: 'GET', path: basePath, summary: createCreativePlannerRouteSummary(snapshot) },
    { id: 'creative-planner.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'creative-planner.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

