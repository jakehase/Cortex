import { buildCreativeScorecardSnapshot, createCreativeScorecardRouteSummary } from '../service-creative-scorecard.mjs';

export function createCreativeScorecardDashboardRoutes(basePath = '/creative-scorecard') {
  const snapshot = buildCreativeScorecardSnapshot();
  return [
    { id: 'creative-scorecard.dashboard.overview', method: 'GET', path: basePath, summary: createCreativeScorecardRouteSummary(snapshot) },
    { id: 'creative-scorecard.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'creative-scorecard.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

