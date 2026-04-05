import { buildInsightsConsoleSnapshot, createInsightsConsoleRouteSummary } from '../service-insights-console.mjs';

export function createInsightsConsoleDashboardRoutes(basePath = '/insights-console') {
  const snapshot = buildInsightsConsoleSnapshot();
  return [
    { id: 'insights-console.dashboard.overview', method: 'GET', path: basePath, summary: createInsightsConsoleRouteSummary(snapshot) },
    { id: 'insights-console.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'insights-console.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

