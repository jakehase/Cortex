import { buildAttributionScorecardSnapshot, createAttributionScorecardRouteSummary } from '../service-attribution-scorecard.mjs';

export function createAttributionScorecardDashboardRoutes(basePath = '/attribution-scorecard') {
  const snapshot = buildAttributionScorecardSnapshot();
  return [
    { id: 'attribution-scorecard.dashboard.overview', method: 'GET', path: basePath, summary: createAttributionScorecardRouteSummary(snapshot) },
    { id: 'attribution-scorecard.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'attribution-scorecard.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

