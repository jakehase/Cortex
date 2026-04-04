import { buildInsightsStudioSnapshot, createInsightsStudioRouteSummary } from '../service-insights-studio.mjs';

export function createInsightsStudioDashboardRoutes(basePath = '/insights-studio') {
  const snapshot = buildInsightsStudioSnapshot();
  return [
    { id: 'insights-studio.dashboard.overview', method: 'GET', path: basePath, summary: createInsightsStudioRouteSummary(snapshot) },
    { id: 'insights-studio.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'insights-studio.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

