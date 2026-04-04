import { buildDataAtlasSnapshot, createDataAtlasRouteSummary } from '../service-data-atlas.mjs';

export function createDataAtlasDashboardRoutes(basePath = '/data-atlas') {
  const snapshot = buildDataAtlasSnapshot();
  return [
    { id: 'data-atlas.dashboard.overview', method: 'GET', path: basePath, summary: createDataAtlasRouteSummary(snapshot) },
    { id: 'data-atlas.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'data-atlas.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

