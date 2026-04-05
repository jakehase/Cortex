import { buildContentScorecardSnapshot, createContentScorecardRouteSummary } from '../service-content-scorecard.mjs';

export function createContentScorecardDashboardRoutes(basePath = '/content-scorecard') {
  const snapshot = buildContentScorecardSnapshot();
  return [
    { id: 'content-scorecard.dashboard.overview', method: 'GET', path: basePath, summary: createContentScorecardRouteSummary(snapshot) },
    { id: 'content-scorecard.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'content-scorecard.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

