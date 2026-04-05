import { buildAnalyticsNavigatorSnapshot, createAnalyticsNavigatorRouteSummary } from '../service-analytics-navigator.mjs';

export function createAnalyticsNavigatorDashboardRoutes(basePath = '/analytics-navigator') {
  const snapshot = buildAnalyticsNavigatorSnapshot();
  return [
    { id: 'analytics-navigator.dashboard.overview', method: 'GET', path: basePath, summary: createAnalyticsNavigatorRouteSummary(snapshot) },
    { id: 'analytics-navigator.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'analytics-navigator.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

