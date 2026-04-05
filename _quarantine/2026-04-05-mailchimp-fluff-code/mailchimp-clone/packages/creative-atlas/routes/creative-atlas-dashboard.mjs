import { buildCreativeAtlasSnapshot, createCreativeAtlasRouteSummary } from '../service-creative-atlas.mjs';

export function createCreativeAtlasDashboardRoutes(basePath = '/creative-atlas') {
  const snapshot = buildCreativeAtlasSnapshot();
  return [
    { id: 'creative-atlas.dashboard.overview', method: 'GET', path: basePath, summary: createCreativeAtlasRouteSummary(snapshot) },
    { id: 'creative-atlas.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'creative-atlas.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

