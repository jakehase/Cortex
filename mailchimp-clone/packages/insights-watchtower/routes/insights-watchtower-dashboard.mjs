import { buildInsightsWatchtowerSnapshot, createInsightsWatchtowerRouteSummary } from '../service-insights-watchtower.mjs';

export function createInsightsWatchtowerDashboardRoutes(basePath = '/insights-watchtower') {
  const snapshot = buildInsightsWatchtowerSnapshot();
  return [
    { id: 'insights-watchtower.dashboard.overview', method: 'GET', path: basePath, summary: createInsightsWatchtowerRouteSummary(snapshot) },
    { id: 'insights-watchtower.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'insights-watchtower.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

