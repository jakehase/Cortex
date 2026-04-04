import { buildCommerceHubSnapshot, createCommerceHubRouteSummary } from '../service-commerce-hub.mjs';

export function createCommerceHubDashboardRoutes(basePath = '/commerce-hub') {
  const snapshot = buildCommerceHubSnapshot();
  return [
    { id: 'commerce-hub.dashboard.overview', method: 'GET', path: basePath, summary: createCommerceHubRouteSummary(snapshot) },
    { id: 'commerce-hub.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'commerce-hub.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

