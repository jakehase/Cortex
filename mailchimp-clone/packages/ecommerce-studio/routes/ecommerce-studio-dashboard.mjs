import { buildEcommerceStudioSnapshot, createEcommerceStudioRouteSummary } from '../service-ecommerce-studio.mjs';

export function createEcommerceStudioDashboardRoutes(basePath = '/ecommerce-studio') {
  const snapshot = buildEcommerceStudioSnapshot();
  return [
    { id: 'ecommerce-studio.dashboard.overview', method: 'GET', path: basePath, summary: createEcommerceStudioRouteSummary(snapshot) },
    { id: 'ecommerce-studio.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'ecommerce-studio.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

