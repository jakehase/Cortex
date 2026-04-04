import { buildInsightsPlannerSnapshot, createInsightsPlannerRouteSummary } from '../service-insights-planner.mjs';

export function createInsightsPlannerDashboardRoutes(basePath = '/insights-planner') {
  const snapshot = buildInsightsPlannerSnapshot();
  return [
    { id: 'insights-planner.dashboard.overview', method: 'GET', path: basePath, summary: createInsightsPlannerRouteSummary(snapshot) },
    { id: 'insights-planner.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'insights-planner.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

