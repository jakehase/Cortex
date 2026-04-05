import { buildAnalyticsStudioSnapshot, createAnalyticsStudioRouteSummary } from '../service-analytics-studio.mjs';

export function createAnalyticsStudioDashboardRoutes(basePath = '/analytics-studio') {
  const snapshot = buildAnalyticsStudioSnapshot();
  return [
    { id: 'analytics-studio.dashboard.overview', method: 'GET', path: basePath, summary: createAnalyticsStudioRouteSummary(snapshot) },
    { id: 'analytics-studio.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'analytics-studio.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

