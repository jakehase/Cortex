import { buildEcommerceExchangeSnapshot, createEcommerceExchangeRouteSummary } from '../service-ecommerce-exchange.mjs';

export function createEcommerceExchangeDashboardRoutes(basePath = '/ecommerce-exchange') {
  const snapshot = buildEcommerceExchangeSnapshot();
  return [
    { id: 'ecommerce-exchange.dashboard.overview', method: 'GET', path: basePath, summary: createEcommerceExchangeRouteSummary(snapshot) },
    { id: 'ecommerce-exchange.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'ecommerce-exchange.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

