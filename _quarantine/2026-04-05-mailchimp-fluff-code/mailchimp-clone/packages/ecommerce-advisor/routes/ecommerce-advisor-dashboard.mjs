import { buildEcommerceAdvisorSnapshot, createEcommerceAdvisorRouteSummary } from '../service-ecommerce-advisor.mjs';

export function createEcommerceAdvisorDashboardRoutes(basePath = '/ecommerce-advisor') {
  const snapshot = buildEcommerceAdvisorSnapshot();
  return [
    { id: 'ecommerce-advisor.dashboard.overview', method: 'GET', path: basePath, summary: createEcommerceAdvisorRouteSummary(snapshot) },
    { id: 'ecommerce-advisor.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'ecommerce-advisor.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

