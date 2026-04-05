import { buildAnalyticsHubSnapshot, createAnalyticsHubRouteSummary } from '../service-analytics-hub.mjs';

export function createAnalyticsHubDashboardRoutes(basePath = '/analytics-hub') {
  const snapshot = buildAnalyticsHubSnapshot();
  return [
    { id: 'analytics-hub.dashboard.overview', method: 'GET', path: basePath, summary: createAnalyticsHubRouteSummary(snapshot) },
    { id: 'analytics-hub.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'analytics-hub.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

