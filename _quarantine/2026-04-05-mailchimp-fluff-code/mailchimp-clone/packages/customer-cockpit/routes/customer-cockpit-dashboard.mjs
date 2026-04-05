import { buildCustomerCockpitSnapshot, createCustomerCockpitRouteSummary } from '../service-customer-cockpit.mjs';

export function createCustomerCockpitDashboardRoutes(basePath = '/customer-cockpit') {
  const snapshot = buildCustomerCockpitSnapshot();
  return [
    { id: 'customer-cockpit.dashboard.overview', method: 'GET', path: basePath, summary: createCustomerCockpitRouteSummary(snapshot) },
    { id: 'customer-cockpit.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'customer-cockpit.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

