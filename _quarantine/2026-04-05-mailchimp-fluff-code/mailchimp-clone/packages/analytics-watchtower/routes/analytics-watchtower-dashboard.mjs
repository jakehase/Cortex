import { buildAnalyticsWatchtowerSnapshot, createAnalyticsWatchtowerRouteSummary } from '../service-analytics-watchtower.mjs';

export function createAnalyticsWatchtowerDashboardRoutes(basePath = '/analytics-watchtower') {
  const snapshot = buildAnalyticsWatchtowerSnapshot();
  return [
    { id: 'analytics-watchtower.dashboard.overview', method: 'GET', path: basePath, summary: createAnalyticsWatchtowerRouteSummary(snapshot) },
    { id: 'analytics-watchtower.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'analytics-watchtower.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

