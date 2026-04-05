import { buildCustomerAtlasSnapshot, createCustomerAtlasRouteSummary } from '../service-customer-atlas.mjs';

export function createCustomerAtlasDashboardRoutes(basePath = '/customer-atlas') {
  const snapshot = buildCustomerAtlasSnapshot();
  return [
    { id: 'customer-atlas.dashboard.overview', method: 'GET', path: basePath, summary: createCustomerAtlasRouteSummary(snapshot) },
    { id: 'customer-atlas.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'customer-atlas.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

