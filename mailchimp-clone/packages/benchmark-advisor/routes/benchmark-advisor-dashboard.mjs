import { buildBenchmarkAdvisorSnapshot, createBenchmarkAdvisorRouteSummary } from '../service-benchmark-advisor.mjs';

export function createBenchmarkAdvisorDashboardRoutes(basePath = '/benchmark-advisor') {
  const snapshot = buildBenchmarkAdvisorSnapshot();
  return [
    { id: 'benchmark-advisor.dashboard.overview', method: 'GET', path: basePath, summary: createBenchmarkAdvisorRouteSummary(snapshot) },
    { id: 'benchmark-advisor.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'benchmark-advisor.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

