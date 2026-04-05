import { buildCustomerFoundrySnapshot, createCustomerFoundryRouteSummary } from '../service-customer-foundry.mjs';

export function createCustomerFoundryDashboardRoutes(basePath = '/customer-foundry') {
  const snapshot = buildCustomerFoundrySnapshot();
  return [
    { id: 'customer-foundry.dashboard.overview', method: 'GET', path: basePath, summary: createCustomerFoundryRouteSummary(snapshot) },
    { id: 'customer-foundry.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'customer-foundry.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

