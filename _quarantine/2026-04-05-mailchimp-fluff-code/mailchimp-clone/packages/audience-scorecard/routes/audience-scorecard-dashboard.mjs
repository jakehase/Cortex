import { buildAudienceScorecardSnapshot, createAudienceScorecardRouteSummary } from '../service-audience-scorecard.mjs';

export function createAudienceScorecardDashboardRoutes(basePath = '/audience-scorecard') {
  const snapshot = buildAudienceScorecardSnapshot();
  return [
    { id: 'audience-scorecard.dashboard.overview', method: 'GET', path: basePath, summary: createAudienceScorecardRouteSummary(snapshot) },
    { id: 'audience-scorecard.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'audience-scorecard.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

