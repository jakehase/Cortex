import { buildInsightsIndexSnapshot, createInsightsIndexRouteSummary } from '../service-insights-index.mjs';

export function createInsightsIndexDashboardRoutes(basePath = '/insights-index') {
  const snapshot = buildInsightsIndexSnapshot();
  return [
    { id: 'insights-index.dashboard.overview', method: 'GET', path: basePath, summary: createInsightsIndexRouteSummary(snapshot) },
    { id: 'insights-index.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'insights-index.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

