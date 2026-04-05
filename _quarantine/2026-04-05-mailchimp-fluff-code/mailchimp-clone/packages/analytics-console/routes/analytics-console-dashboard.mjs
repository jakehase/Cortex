import { buildAnalyticsConsoleSnapshot, createAnalyticsConsoleRouteSummary } from '../service-analytics-console.mjs';

export function createAnalyticsConsoleDashboardRoutes(basePath = '/analytics-console') {
  const snapshot = buildAnalyticsConsoleSnapshot();
  return [
    { id: 'analytics-console.dashboard.overview', method: 'GET', path: basePath, summary: createAnalyticsConsoleRouteSummary(snapshot) },
    { id: 'analytics-console.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'analytics-console.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

