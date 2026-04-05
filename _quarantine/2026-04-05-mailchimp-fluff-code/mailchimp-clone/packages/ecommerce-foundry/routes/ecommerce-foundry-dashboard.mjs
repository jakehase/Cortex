import { buildEcommerceFoundrySnapshot, createEcommerceFoundryRouteSummary } from '../service-ecommerce-foundry.mjs';

export function createEcommerceFoundryDashboardRoutes(basePath = '/ecommerce-foundry') {
  const snapshot = buildEcommerceFoundrySnapshot();
  return [
    { id: 'ecommerce-foundry.dashboard.overview', method: 'GET', path: basePath, summary: createEcommerceFoundryRouteSummary(snapshot) },
    { id: 'ecommerce-foundry.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'ecommerce-foundry.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

