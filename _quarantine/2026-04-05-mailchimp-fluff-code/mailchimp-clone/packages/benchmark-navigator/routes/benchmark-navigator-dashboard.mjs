import { buildBenchmarkNavigatorSnapshot, createBenchmarkNavigatorRouteSummary } from '../service-benchmark-navigator.mjs';

export function createBenchmarkNavigatorDashboardRoutes(basePath = '/benchmark-navigator') {
  const snapshot = buildBenchmarkNavigatorSnapshot();
  return [
    { id: 'benchmark-navigator.dashboard.overview', method: 'GET', path: basePath, summary: createBenchmarkNavigatorRouteSummary(snapshot) },
    { id: 'benchmark-navigator.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'benchmark-navigator.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

