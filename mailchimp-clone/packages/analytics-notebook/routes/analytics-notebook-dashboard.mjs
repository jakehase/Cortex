import { buildAnalyticsNotebookSnapshot, createAnalyticsNotebookRouteSummary } from '../service-analytics-notebook.mjs';

export function createAnalyticsNotebookDashboardRoutes(basePath = '/analytics-notebook') {
  const snapshot = buildAnalyticsNotebookSnapshot();
  return [
    { id: 'analytics-notebook.dashboard.overview', method: 'GET', path: basePath, summary: createAnalyticsNotebookRouteSummary(snapshot) },
    { id: 'analytics-notebook.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'analytics-notebook.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

