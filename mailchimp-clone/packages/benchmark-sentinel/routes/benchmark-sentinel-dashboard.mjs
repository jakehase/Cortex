import { buildBenchmarkSentinelSnapshot, createBenchmarkSentinelRouteSummary } from '../service-benchmark-sentinel.mjs';

export function createBenchmarkSentinelDashboardRoutes(basePath = '/benchmark-sentinel') {
  const snapshot = buildBenchmarkSentinelSnapshot();
  return [
    { id: 'benchmark-sentinel.dashboard.overview', method: 'GET', path: basePath, summary: createBenchmarkSentinelRouteSummary(snapshot) },
    { id: 'benchmark-sentinel.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'benchmark-sentinel.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

