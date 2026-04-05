import { buildBenchmarkScorecardSnapshot, createBenchmarkScorecardRouteSummary } from '../service-benchmark-scorecard.mjs';

export function createBenchmarkScorecardDashboardRoutes(basePath = '/benchmark-scorecard') {
  const snapshot = buildBenchmarkScorecardSnapshot();
  return [
    { id: 'benchmark-scorecard.dashboard.overview', method: 'GET', path: basePath, summary: createBenchmarkScorecardRouteSummary(snapshot) },
    { id: 'benchmark-scorecard.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'benchmark-scorecard.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

