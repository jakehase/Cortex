import { buildCommerceExchangeSnapshot, createCommerceExchangeRouteSummary } from '../service-commerce-exchange.mjs';

export function createCommerceExchangeDashboardRoutes(basePath = '/commerce-exchange') {
  const snapshot = buildCommerceExchangeSnapshot();
  return [
    { id: 'commerce-exchange.dashboard.overview', method: 'GET', path: basePath, summary: createCommerceExchangeRouteSummary(snapshot) },
    { id: 'commerce-exchange.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'commerce-exchange.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

