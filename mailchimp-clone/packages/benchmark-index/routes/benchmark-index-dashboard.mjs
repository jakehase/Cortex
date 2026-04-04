import { buildBenchmarkIndexSnapshot, createBenchmarkIndexRouteSummary } from '../service-benchmark-index.mjs';

export function createBenchmarkIndexDashboardRoutes(basePath = '/benchmark-index') {
  const snapshot = buildBenchmarkIndexSnapshot();
  return [
    { id: 'benchmark-index.dashboard.overview', method: 'GET', path: basePath, summary: createBenchmarkIndexRouteSummary(snapshot) },
    { id: 'benchmark-index.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'benchmark-index.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

