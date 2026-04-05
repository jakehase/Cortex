import { buildCommerceStudioSnapshot, createCommerceStudioRouteSummary } from '../service-commerce-studio.mjs';

export function createCommerceStudioDashboardRoutes(basePath = '/commerce-studio') {
  const snapshot = buildCommerceStudioSnapshot();
  return [
    { id: 'commerce-studio.dashboard.overview', method: 'GET', path: basePath, summary: createCommerceStudioRouteSummary(snapshot) },
    { id: 'commerce-studio.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'commerce-studio.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

