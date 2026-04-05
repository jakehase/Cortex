import { buildEcommerceAtlasSnapshot, createEcommerceAtlasRouteSummary } from '../service-ecommerce-atlas.mjs';

export function createEcommerceAtlasDashboardRoutes(basePath = '/ecommerce-atlas') {
  const snapshot = buildEcommerceAtlasSnapshot();
  return [
    { id: 'ecommerce-atlas.dashboard.overview', method: 'GET', path: basePath, summary: createEcommerceAtlasRouteSummary(snapshot) },
    { id: 'ecommerce-atlas.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'ecommerce-atlas.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

