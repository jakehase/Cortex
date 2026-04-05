import { buildAnalyticsGridSnapshot, createAnalyticsGridRouteSummary } from '../service-analytics-grid.mjs';

export function createAnalyticsGridDashboardRoutes(basePath = '/analytics-grid') {
  const snapshot = buildAnalyticsGridSnapshot();
  return [
    { id: 'analytics-grid.dashboard.overview', method: 'GET', path: basePath, summary: createAnalyticsGridRouteSummary(snapshot) },
    { id: 'analytics-grid.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'analytics-grid.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

