import { buildCommerceNavigatorSnapshot, createCommerceNavigatorRouteSummary } from '../service-commerce-navigator.mjs';

export function createCommerceNavigatorDashboardRoutes(basePath = '/commerce-navigator') {
  const snapshot = buildCommerceNavigatorSnapshot();
  return [
    { id: 'commerce-navigator.dashboard.overview', method: 'GET', path: basePath, summary: createCommerceNavigatorRouteSummary(snapshot) },
    { id: 'commerce-navigator.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'commerce-navigator.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

