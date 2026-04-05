import { buildBillingCockpitSnapshot, createBillingCockpitRouteSummary } from '../service-billing-cockpit.mjs';

export function createBillingCockpitDashboardRoutes(basePath = '/billing-cockpit') {
  const snapshot = buildBillingCockpitSnapshot();
  return [
    { id: 'billing-cockpit.dashboard.overview', method: 'GET', path: basePath, summary: createBillingCockpitRouteSummary(snapshot) },
    { id: 'billing-cockpit.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'billing-cockpit.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

