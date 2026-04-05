import { buildEcommerceHubSnapshot, createEcommerceHubRouteSummary } from '../service-ecommerce-hub.mjs';

export function createEcommerceHubDashboardRoutes(basePath = '/ecommerce-hub') {
  const snapshot = buildEcommerceHubSnapshot();
  return [
    { id: 'ecommerce-hub.dashboard.overview', method: 'GET', path: basePath, summary: createEcommerceHubRouteSummary(snapshot) },
    { id: 'ecommerce-hub.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'ecommerce-hub.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

