import { buildLoyaltyScorecardSnapshot, createLoyaltyScorecardRouteSummary } from '../service-loyalty-scorecard.mjs';

export function createLoyaltyScorecardDashboardRoutes(basePath = '/loyalty-scorecard') {
  const snapshot = buildLoyaltyScorecardSnapshot();
  return [
    { id: 'loyalty-scorecard.dashboard.overview', method: 'GET', path: basePath, summary: createLoyaltyScorecardRouteSummary(snapshot) },
    { id: 'loyalty-scorecard.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'loyalty-scorecard.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

