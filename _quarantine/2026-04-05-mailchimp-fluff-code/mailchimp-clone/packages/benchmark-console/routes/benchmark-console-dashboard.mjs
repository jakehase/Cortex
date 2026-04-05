import { buildBenchmarkConsoleSnapshot, createBenchmarkConsoleRouteSummary } from '../service-benchmark-console.mjs';

export function createBenchmarkConsoleDashboardRoutes(basePath = '/benchmark-console') {
  const snapshot = buildBenchmarkConsoleSnapshot();
  return [
    { id: 'benchmark-console.dashboard.overview', method: 'GET', path: basePath, summary: createBenchmarkConsoleRouteSummary(snapshot) },
    { id: 'benchmark-console.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'benchmark-console.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

