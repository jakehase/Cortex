import { buildBenchmarkWatchtowerSnapshot, createBenchmarkWatchtowerRouteSummary } from '../service-benchmark-watchtower.mjs';

export function createBenchmarkWatchtowerDashboardRoutes(basePath = '/benchmark-watchtower') {
  const snapshot = buildBenchmarkWatchtowerSnapshot();
  return [
    { id: 'benchmark-watchtower.dashboard.overview', method: 'GET', path: basePath, summary: createBenchmarkWatchtowerRouteSummary(snapshot) },
    { id: 'benchmark-watchtower.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'benchmark-watchtower.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

