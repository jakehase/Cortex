import { buildAdvocacyScorecardSnapshot, createAdvocacyScorecardRouteSummary } from '../service-advocacy-scorecard.mjs';

export function createAdvocacyScorecardDashboardRoutes(basePath = '/advocacy-scorecard') {
  const snapshot = buildAdvocacyScorecardSnapshot();
  return [
    { id: 'advocacy-scorecard.dashboard.overview', method: 'GET', path: basePath, summary: createAdvocacyScorecardRouteSummary(snapshot) },
    { id: 'advocacy-scorecard.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'advocacy-scorecard.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

