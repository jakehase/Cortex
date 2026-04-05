import { buildCustomerScorecardSnapshot, createCustomerScorecardRouteSummary } from '../service-customer-scorecard.mjs';

export function createCustomerScorecardDashboardRoutes(basePath = '/customer-scorecard') {
  const snapshot = buildCustomerScorecardSnapshot();
  return [
    { id: 'customer-scorecard.dashboard.overview', method: 'GET', path: basePath, summary: createCustomerScorecardRouteSummary(snapshot) },
    { id: 'customer-scorecard.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'customer-scorecard.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

