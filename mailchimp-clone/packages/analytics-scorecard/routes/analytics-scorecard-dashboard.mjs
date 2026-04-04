import { buildAnalyticsScorecardSnapshot, createAnalyticsScorecardRouteSummary } from '../service-analytics-scorecard.mjs';

export function createAnalyticsScorecardDashboardRoutes(basePath = '/analytics-scorecard') {
  const snapshot = buildAnalyticsScorecardSnapshot();
  return [
    { id: 'analytics-scorecard.dashboard.overview', method: 'GET', path: basePath, summary: createAnalyticsScorecardRouteSummary(snapshot) },
    { id: 'analytics-scorecard.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'analytics-scorecard.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

