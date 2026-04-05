import { buildAnalyticsPlannerSnapshot, createAnalyticsPlannerRouteSummary } from '../service-analytics-planner.mjs';

export function createAnalyticsPlannerDashboardRoutes(basePath = '/analytics-planner') {
  const snapshot = buildAnalyticsPlannerSnapshot();
  return [
    { id: 'analytics-planner.dashboard.overview', method: 'GET', path: basePath, summary: createAnalyticsPlannerRouteSummary(snapshot) },
    { id: 'analytics-planner.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'analytics-planner.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

