import { buildBenchmarkWorkbenchSnapshot, createBenchmarkWorkbenchRouteSummary } from '../service-benchmark-workbench.mjs';

export function createBenchmarkWorkbenchDashboardRoutes(basePath = '/benchmark-workbench') {
  const snapshot = buildBenchmarkWorkbenchSnapshot();
  return [
    { id: 'benchmark-workbench.dashboard.overview', method: 'GET', path: basePath, summary: createBenchmarkWorkbenchRouteSummary(snapshot) },
    { id: 'benchmark-workbench.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'benchmark-workbench.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

