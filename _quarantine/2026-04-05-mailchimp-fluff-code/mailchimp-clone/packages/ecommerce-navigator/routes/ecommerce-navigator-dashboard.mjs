import { buildEcommerceNavigatorSnapshot, createEcommerceNavigatorRouteSummary } from '../service-ecommerce-navigator.mjs';

export function createEcommerceNavigatorDashboardRoutes(basePath = '/ecommerce-navigator') {
  const snapshot = buildEcommerceNavigatorSnapshot();
  return [
    { id: 'ecommerce-navigator.dashboard.overview', method: 'GET', path: basePath, summary: createEcommerceNavigatorRouteSummary(snapshot) },
    { id: 'ecommerce-navigator.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'ecommerce-navigator.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

