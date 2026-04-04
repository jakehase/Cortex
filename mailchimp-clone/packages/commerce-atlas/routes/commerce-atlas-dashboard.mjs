import { buildCommerceAtlasSnapshot, createCommerceAtlasRouteSummary } from '../service-commerce-atlas.mjs';

export function createCommerceAtlasDashboardRoutes(basePath = '/commerce-atlas') {
  const snapshot = buildCommerceAtlasSnapshot();
  return [
    { id: 'commerce-atlas.dashboard.overview', method: 'GET', path: basePath, summary: createCommerceAtlasRouteSummary(snapshot) },
    { id: 'commerce-atlas.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'commerce-atlas.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

