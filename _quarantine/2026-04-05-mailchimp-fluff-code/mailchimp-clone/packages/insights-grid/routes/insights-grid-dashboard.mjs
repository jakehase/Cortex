import { buildInsightsGridSnapshot, createInsightsGridRouteSummary } from '../service-insights-grid.mjs';

export function createInsightsGridDashboardRoutes(basePath = '/insights-grid') {
  const snapshot = buildInsightsGridSnapshot();
  return [
    { id: 'insights-grid.dashboard.overview', method: 'GET', path: basePath, summary: createInsightsGridRouteSummary(snapshot) },
    { id: 'insights-grid.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'insights-grid.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

