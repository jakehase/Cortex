import { buildBenchmarkNotebookSnapshot, createBenchmarkNotebookRouteSummary } from '../service-benchmark-notebook.mjs';

export function createBenchmarkNotebookDashboardRoutes(basePath = '/benchmark-notebook') {
  const snapshot = buildBenchmarkNotebookSnapshot();
  return [
    { id: 'benchmark-notebook.dashboard.overview', method: 'GET', path: basePath, summary: createBenchmarkNotebookRouteSummary(snapshot) },
    { id: 'benchmark-notebook.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'benchmark-notebook.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

