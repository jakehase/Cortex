import { buildBenchmarkPlannerSnapshot, createBenchmarkPlannerRouteSummary } from '../service-benchmark-planner.mjs';

export function createBenchmarkPlannerDashboardRoutes(basePath = '/benchmark-planner') {
  const snapshot = buildBenchmarkPlannerSnapshot();
  return [
    { id: 'benchmark-planner.dashboard.overview', method: 'GET', path: basePath, summary: createBenchmarkPlannerRouteSummary(snapshot) },
    { id: 'benchmark-planner.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'benchmark-planner.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

