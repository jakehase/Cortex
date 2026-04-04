import { buildInsightsNavigatorSnapshot, createInsightsNavigatorRouteSummary } from '../service-insights-navigator.mjs';

export function createInsightsNavigatorDashboardRoutes(basePath = '/insights-navigator') {
  const snapshot = buildInsightsNavigatorSnapshot();
  return [
    { id: 'insights-navigator.dashboard.overview', method: 'GET', path: basePath, summary: createInsightsNavigatorRouteSummary(snapshot) },
    { id: 'insights-navigator.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'insights-navigator.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

