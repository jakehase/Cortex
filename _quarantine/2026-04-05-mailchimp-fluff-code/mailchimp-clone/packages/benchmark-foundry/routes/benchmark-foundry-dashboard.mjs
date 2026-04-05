import { buildBenchmarkFoundrySnapshot, createBenchmarkFoundryRouteSummary } from '../service-benchmark-foundry.mjs';

export function createBenchmarkFoundryDashboardRoutes(basePath = '/benchmark-foundry') {
  const snapshot = buildBenchmarkFoundrySnapshot();
  return [
    { id: 'benchmark-foundry.dashboard.overview', method: 'GET', path: basePath, summary: createBenchmarkFoundryRouteSummary(snapshot) },
    { id: 'benchmark-foundry.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'benchmark-foundry.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

