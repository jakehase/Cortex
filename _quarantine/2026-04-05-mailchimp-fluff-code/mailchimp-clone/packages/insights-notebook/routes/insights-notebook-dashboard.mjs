import { buildInsightsNotebookSnapshot, createInsightsNotebookRouteSummary } from '../service-insights-notebook.mjs';

export function createInsightsNotebookDashboardRoutes(basePath = '/insights-notebook') {
  const snapshot = buildInsightsNotebookSnapshot();
  return [
    { id: 'insights-notebook.dashboard.overview', method: 'GET', path: basePath, summary: createInsightsNotebookRouteSummary(snapshot) },
    { id: 'insights-notebook.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'insights-notebook.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

