import { buildBillingAtlasSnapshot, createBillingAtlasRouteSummary } from '../service-billing-atlas.mjs';

export function createBillingAtlasDashboardRoutes(basePath = '/billing-atlas') {
  const snapshot = buildBillingAtlasSnapshot();
  return [
    { id: 'billing-atlas.dashboard.overview', method: 'GET', path: basePath, summary: createBillingAtlasRouteSummary(snapshot) },
    { id: 'billing-atlas.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'billing-atlas.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

