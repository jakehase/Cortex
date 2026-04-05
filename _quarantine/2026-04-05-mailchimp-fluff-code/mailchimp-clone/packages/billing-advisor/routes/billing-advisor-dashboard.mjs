import { buildBillingAdvisorSnapshot, createBillingAdvisorRouteSummary } from '../service-billing-advisor.mjs';

export function createBillingAdvisorDashboardRoutes(basePath = '/billing-advisor') {
  const snapshot = buildBillingAdvisorSnapshot();
  return [
    { id: 'billing-advisor.dashboard.overview', method: 'GET', path: basePath, summary: createBillingAdvisorRouteSummary(snapshot) },
    { id: 'billing-advisor.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'billing-advisor.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

