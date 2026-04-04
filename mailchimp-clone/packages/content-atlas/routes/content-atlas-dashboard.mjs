import { buildContentAtlasSnapshot, createContentAtlasRouteSummary } from '../service-content-atlas.mjs';

export function createContentAtlasDashboardRoutes(basePath = '/content-atlas') {
  const snapshot = buildContentAtlasSnapshot();
  return [
    { id: 'content-atlas.dashboard.overview', method: 'GET', path: basePath, summary: createContentAtlasRouteSummary(snapshot) },
    { id: 'content-atlas.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'content-atlas.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

