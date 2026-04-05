import { buildInsightsHubSnapshot, createInsightsHubRouteSummary } from '../service-insights-hub.mjs';

export function createInsightsHubDashboardRoutes(basePath = '/insights-hub') {
  const snapshot = buildInsightsHubSnapshot();
  return [
    { id: 'insights-hub.dashboard.overview', method: 'GET', path: basePath, summary: createInsightsHubRouteSummary(snapshot) },
    { id: 'insights-hub.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'insights-hub.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

