import { buildCustomerExchangeSnapshot, createCustomerExchangeRouteSummary } from '../service-customer-exchange.mjs';

export function createCustomerExchangeDashboardRoutes(basePath = '/customer-exchange') {
  const snapshot = buildCustomerExchangeSnapshot();
  return [
    { id: 'customer-exchange.dashboard.overview', method: 'GET', path: basePath, summary: createCustomerExchangeRouteSummary(snapshot) },
    { id: 'customer-exchange.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'customer-exchange.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

