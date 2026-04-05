import { buildCommerceAdvisorSnapshot, createCommerceAdvisorRouteSummary } from '../service-commerce-advisor.mjs';

export function createCommerceAdvisorDashboardRoutes(basePath = '/commerce-advisor') {
  const snapshot = buildCommerceAdvisorSnapshot();
  return [
    { id: 'commerce-advisor.dashboard.overview', method: 'GET', path: basePath, summary: createCommerceAdvisorRouteSummary(snapshot) },
    { id: 'commerce-advisor.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'commerce-advisor.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

