import { buildLifecycleAtlasSnapshot, createLifecycleAtlasRouteSummary } from '../service-lifecycle-atlas.mjs';

export function createLifecycleAtlasDashboardRoutes(basePath = '/lifecycle-atlas') {
  const snapshot = buildLifecycleAtlasSnapshot();
  return [
    { id: 'lifecycle-atlas.dashboard.overview', method: 'GET', path: basePath, summary: createLifecycleAtlasRouteSummary(snapshot) },
    { id: 'lifecycle-atlas.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'lifecycle-atlas.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

