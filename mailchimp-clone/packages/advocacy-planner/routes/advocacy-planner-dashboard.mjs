import { buildAdvocacyPlannerSnapshot, createAdvocacyPlannerRouteSummary } from '../service-advocacy-planner.mjs';

export function createAdvocacyPlannerDashboardRoutes(basePath = '/advocacy-planner') {
  const snapshot = buildAdvocacyPlannerSnapshot();
  return [
    { id: 'advocacy-planner.dashboard.overview', method: 'GET', path: basePath, summary: createAdvocacyPlannerRouteSummary(snapshot) },
    { id: 'advocacy-planner.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'advocacy-planner.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

