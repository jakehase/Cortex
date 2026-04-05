import { buildAnalyticsIndexSnapshot, createAnalyticsIndexRouteSummary } from '../service-analytics-index.mjs';

export function createAnalyticsIndexDashboardRoutes(basePath = '/analytics-index') {
  const snapshot = buildAnalyticsIndexSnapshot();
  return [
    { id: 'analytics-index.dashboard.overview', method: 'GET', path: basePath, summary: createAnalyticsIndexRouteSummary(snapshot) },
    { id: 'analytics-index.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'analytics-index.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

