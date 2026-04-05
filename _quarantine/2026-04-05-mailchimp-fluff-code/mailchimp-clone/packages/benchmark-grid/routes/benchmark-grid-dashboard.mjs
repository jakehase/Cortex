import { buildBenchmarkGridSnapshot, createBenchmarkGridRouteSummary } from '../service-benchmark-grid.mjs';

export function createBenchmarkGridDashboardRoutes(basePath = '/benchmark-grid') {
  const snapshot = buildBenchmarkGridSnapshot();
  return [
    { id: 'benchmark-grid.dashboard.overview', method: 'GET', path: basePath, summary: createBenchmarkGridRouteSummary(snapshot) },
    { id: 'benchmark-grid.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'benchmark-grid.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

