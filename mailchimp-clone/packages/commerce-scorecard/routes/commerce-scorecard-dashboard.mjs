import { buildCommerceScorecardSnapshot, createCommerceScorecardRouteSummary } from '../service-commerce-scorecard.mjs';

export function createCommerceScorecardDashboardRoutes(basePath = '/commerce-scorecard') {
  const snapshot = buildCommerceScorecardSnapshot();
  return [
    { id: 'commerce-scorecard.dashboard.overview', method: 'GET', path: basePath, summary: createCommerceScorecardRouteSummary(snapshot) },
    { id: 'commerce-scorecard.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'commerce-scorecard.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

