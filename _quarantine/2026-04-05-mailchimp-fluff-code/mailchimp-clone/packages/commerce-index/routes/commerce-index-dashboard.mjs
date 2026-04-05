import { buildCommerceIndexSnapshot, createCommerceIndexRouteSummary } from '../service-commerce-index.mjs';

export function createCommerceIndexDashboardRoutes(basePath = '/commerce-index') {
  const snapshot = buildCommerceIndexSnapshot();
  return [
    { id: 'commerce-index.dashboard.overview', method: 'GET', path: basePath, summary: createCommerceIndexRouteSummary(snapshot) },
    { id: 'commerce-index.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'commerce-index.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

