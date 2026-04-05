import { buildBenchmarkAtlasSnapshot, createBenchmarkAtlasRouteSummary } from '../service-benchmark-atlas.mjs';

export function createBenchmarkAtlasDashboardRoutes(basePath = '/benchmark-atlas') {
  const snapshot = buildBenchmarkAtlasSnapshot();
  return [
    { id: 'benchmark-atlas.dashboard.overview', method: 'GET', path: basePath, summary: createBenchmarkAtlasRouteSummary(snapshot) },
    { id: 'benchmark-atlas.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'benchmark-atlas.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

