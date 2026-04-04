import { buildAnalyticsWorkbenchSnapshot, createAnalyticsWorkbenchRouteSummary } from '../service-analytics-workbench.mjs';

export function createAnalyticsWorkbenchDashboardRoutes(basePath = '/analytics-workbench') {
  const snapshot = buildAnalyticsWorkbenchSnapshot();
  return [
    { id: 'analytics-workbench.dashboard.overview', method: 'GET', path: basePath, summary: createAnalyticsWorkbenchRouteSummary(snapshot) },
    { id: 'analytics-workbench.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'analytics-workbench.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

