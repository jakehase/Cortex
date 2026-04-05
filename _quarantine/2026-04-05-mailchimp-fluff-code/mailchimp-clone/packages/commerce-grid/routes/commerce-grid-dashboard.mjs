import { buildCommerceGridSnapshot, createCommerceGridRouteSummary } from '../service-commerce-grid.mjs';

export function createCommerceGridDashboardRoutes(basePath = '/commerce-grid') {
  const snapshot = buildCommerceGridSnapshot();
  return [
    { id: 'commerce-grid.dashboard.overview', method: 'GET', path: basePath, summary: createCommerceGridRouteSummary(snapshot) },
    { id: 'commerce-grid.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'commerce-grid.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

