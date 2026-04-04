import { buildBillingScorecardSnapshot, createBillingScorecardRouteSummary } from '../service-billing-scorecard.mjs';

export function createBillingScorecardDashboardRoutes(basePath = '/billing-scorecard') {
  const snapshot = buildBillingScorecardSnapshot();
  return [
    { id: 'billing-scorecard.dashboard.overview', method: 'GET', path: basePath, summary: createBillingScorecardRouteSummary(snapshot) },
    { id: 'billing-scorecard.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'billing-scorecard.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

