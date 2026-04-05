import { buildAttributionAtlasSnapshot, createAttributionAtlasRouteSummary } from '../service-attribution-atlas.mjs';

export function createAttributionAtlasDashboardRoutes(basePath = '/attribution-atlas') {
  const snapshot = buildAttributionAtlasSnapshot();
  return [
    { id: 'attribution-atlas.dashboard.overview', method: 'GET', path: basePath, summary: createAttributionAtlasRouteSummary(snapshot) },
    { id: 'attribution-atlas.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'attribution-atlas.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

