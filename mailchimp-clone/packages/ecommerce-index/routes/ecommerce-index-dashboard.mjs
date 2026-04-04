import { buildEcommerceIndexSnapshot, createEcommerceIndexRouteSummary } from '../service-ecommerce-index.mjs';

export function createEcommerceIndexDashboardRoutes(basePath = '/ecommerce-index') {
  const snapshot = buildEcommerceIndexSnapshot();
  return [
    { id: 'ecommerce-index.dashboard.overview', method: 'GET', path: basePath, summary: createEcommerceIndexRouteSummary(snapshot) },
    { id: 'ecommerce-index.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'ecommerce-index.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

