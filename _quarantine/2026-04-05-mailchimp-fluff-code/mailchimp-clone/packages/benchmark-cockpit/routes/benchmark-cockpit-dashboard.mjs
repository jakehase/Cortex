import { buildBenchmarkCockpitSnapshot, createBenchmarkCockpitRouteSummary } from '../service-benchmark-cockpit.mjs';

export function createBenchmarkCockpitDashboardRoutes(basePath = '/benchmark-cockpit') {
  const snapshot = buildBenchmarkCockpitSnapshot();
  return [
    { id: 'benchmark-cockpit.dashboard.overview', method: 'GET', path: basePath, summary: createBenchmarkCockpitRouteSummary(snapshot) },
    { id: 'benchmark-cockpit.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'benchmark-cockpit.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

