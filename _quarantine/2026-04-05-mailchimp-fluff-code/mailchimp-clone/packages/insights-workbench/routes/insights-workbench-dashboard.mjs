import { buildInsightsWorkbenchSnapshot, createInsightsWorkbenchRouteSummary } from '../service-insights-workbench.mjs';

export function createInsightsWorkbenchDashboardRoutes(basePath = '/insights-workbench') {
  const snapshot = buildInsightsWorkbenchSnapshot();
  return [
    { id: 'insights-workbench.dashboard.overview', method: 'GET', path: basePath, summary: createInsightsWorkbenchRouteSummary(snapshot) },
    { id: 'insights-workbench.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'insights-workbench.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

