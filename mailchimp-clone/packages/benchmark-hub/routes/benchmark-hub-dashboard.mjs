import { buildBenchmarkHubSnapshot, createBenchmarkHubRouteSummary } from '../service-benchmark-hub.mjs';

export function createBenchmarkHubDashboardRoutes(basePath = '/benchmark-hub') {
  const snapshot = buildBenchmarkHubSnapshot();
  return [
    { id: 'benchmark-hub.dashboard.overview', method: 'GET', path: basePath, summary: createBenchmarkHubRouteSummary(snapshot) },
    { id: 'benchmark-hub.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'benchmark-hub.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

