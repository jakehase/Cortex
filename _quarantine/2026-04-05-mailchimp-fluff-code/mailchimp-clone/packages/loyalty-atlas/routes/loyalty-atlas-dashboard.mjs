import { buildLoyaltyAtlasSnapshot, createLoyaltyAtlasRouteSummary } from '../service-loyalty-atlas.mjs';

export function createLoyaltyAtlasDashboardRoutes(basePath = '/loyalty-atlas') {
  const snapshot = buildLoyaltyAtlasSnapshot();
  return [
    { id: 'loyalty-atlas.dashboard.overview', method: 'GET', path: basePath, summary: createLoyaltyAtlasRouteSummary(snapshot) },
    { id: 'loyalty-atlas.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'loyalty-atlas.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

