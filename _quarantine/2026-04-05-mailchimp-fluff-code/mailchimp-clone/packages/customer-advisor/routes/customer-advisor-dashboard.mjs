import { buildCustomerAdvisorSnapshot, createCustomerAdvisorRouteSummary } from '../service-customer-advisor.mjs';

export function createCustomerAdvisorDashboardRoutes(basePath = '/customer-advisor') {
  const snapshot = buildCustomerAdvisorSnapshot();
  return [
    { id: 'customer-advisor.dashboard.overview', method: 'GET', path: basePath, summary: createCustomerAdvisorRouteSummary(snapshot) },
    { id: 'customer-advisor.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'customer-advisor.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

