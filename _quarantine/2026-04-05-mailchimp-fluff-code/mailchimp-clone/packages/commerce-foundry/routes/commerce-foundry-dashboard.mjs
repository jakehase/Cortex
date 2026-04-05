import { buildCommerceFoundrySnapshot, createCommerceFoundryRouteSummary } from '../service-commerce-foundry.mjs';

export function createCommerceFoundryDashboardRoutes(basePath = '/commerce-foundry') {
  const snapshot = buildCommerceFoundrySnapshot();
  return [
    { id: 'commerce-foundry.dashboard.overview', method: 'GET', path: basePath, summary: createCommerceFoundryRouteSummary(snapshot) },
    { id: 'commerce-foundry.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'commerce-foundry.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

