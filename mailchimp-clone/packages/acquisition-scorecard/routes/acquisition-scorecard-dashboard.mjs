import { buildAcquisitionScorecardSnapshot, createAcquisitionScorecardRouteSummary } from '../service-acquisition-scorecard.mjs';

export function createAcquisitionScorecardDashboardRoutes(basePath = '/acquisition-scorecard') {
  const snapshot = buildAcquisitionScorecardSnapshot();
  return [
    { id: 'acquisition-scorecard.dashboard.overview', method: 'GET', path: basePath, summary: createAcquisitionScorecardRouteSummary(snapshot) },
    { id: 'acquisition-scorecard.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'acquisition-scorecard.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

