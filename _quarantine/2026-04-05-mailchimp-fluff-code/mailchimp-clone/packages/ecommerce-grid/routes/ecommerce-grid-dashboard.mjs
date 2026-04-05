import { buildEcommerceGridSnapshot, createEcommerceGridRouteSummary } from '../service-ecommerce-grid.mjs';

export function createEcommerceGridDashboardRoutes(basePath = '/ecommerce-grid') {
  const snapshot = buildEcommerceGridSnapshot();
  return [
    { id: 'ecommerce-grid.dashboard.overview', method: 'GET', path: basePath, summary: createEcommerceGridRouteSummary(snapshot) },
    { id: 'ecommerce-grid.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'ecommerce-grid.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

