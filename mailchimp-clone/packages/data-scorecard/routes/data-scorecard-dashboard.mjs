import { buildDataScorecardSnapshot, createDataScorecardRouteSummary } from '../service-data-scorecard.mjs';

export function createDataScorecardDashboardRoutes(basePath = '/data-scorecard') {
  const snapshot = buildDataScorecardSnapshot();
  return [
    { id: 'data-scorecard.dashboard.overview', method: 'GET', path: basePath, summary: createDataScorecardRouteSummary(snapshot) },
    { id: 'data-scorecard.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'data-scorecard.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

