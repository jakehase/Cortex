import { buildBillingFoundrySnapshot, createBillingFoundryRouteSummary } from '../service-billing-foundry.mjs';

export function createBillingFoundryDashboardRoutes(basePath = '/billing-foundry') {
  const snapshot = buildBillingFoundrySnapshot();
  return [
    { id: 'billing-foundry.dashboard.overview', method: 'GET', path: basePath, summary: createBillingFoundryRouteSummary(snapshot) },
    { id: 'billing-foundry.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'billing-foundry.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

