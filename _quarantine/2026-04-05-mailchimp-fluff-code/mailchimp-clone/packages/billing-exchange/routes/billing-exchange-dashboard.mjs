import { buildBillingExchangeSnapshot, createBillingExchangeRouteSummary } from '../service-billing-exchange.mjs';

export function createBillingExchangeDashboardRoutes(basePath = '/billing-exchange') {
  const snapshot = buildBillingExchangeSnapshot();
  return [
    { id: 'billing-exchange.dashboard.overview', method: 'GET', path: basePath, summary: createBillingExchangeRouteSummary(snapshot) },
    { id: 'billing-exchange.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'billing-exchange.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

