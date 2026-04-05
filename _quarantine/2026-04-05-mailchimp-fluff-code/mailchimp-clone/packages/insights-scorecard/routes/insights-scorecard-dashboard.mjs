import { buildInsightsScorecardSnapshot, createInsightsScorecardRouteSummary } from '../service-insights-scorecard.mjs';

export function createInsightsScorecardDashboardRoutes(basePath = '/insights-scorecard') {
  const snapshot = buildInsightsScorecardSnapshot();
  return [
    { id: 'insights-scorecard.dashboard.overview', method: 'GET', path: basePath, summary: createInsightsScorecardRouteSummary(snapshot) },
    { id: 'insights-scorecard.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'insights-scorecard.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

