import { buildBenchmarkExchangeSnapshot, createBenchmarkExchangeRouteSummary } from '../service-benchmark-exchange.mjs';

export function createBenchmarkExchangeDashboardRoutes(basePath = '/benchmark-exchange') {
  const snapshot = buildBenchmarkExchangeSnapshot();
  return [
    { id: 'benchmark-exchange.dashboard.overview', method: 'GET', path: basePath, summary: createBenchmarkExchangeRouteSummary(snapshot) },
    { id: 'benchmark-exchange.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'benchmark-exchange.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

