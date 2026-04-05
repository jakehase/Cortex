import { buildLoyaltyAdvisorSnapshot, createLoyaltyAdvisorRouteSummary } from '../service-loyalty-advisor.mjs';

export function createLoyaltyAdvisorDashboardRoutes(basePath = '/loyalty-advisor') {
  const snapshot = buildLoyaltyAdvisorSnapshot();
  return [
    { id: 'loyalty-advisor.dashboard.overview', method: 'GET', path: basePath, summary: createLoyaltyAdvisorRouteSummary(snapshot) },
    { id: 'loyalty-advisor.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'loyalty-advisor.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

