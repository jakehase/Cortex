import { buildActivationScorecardSnapshot, createActivationScorecardRouteSummary } from '../service-activation-scorecard.mjs';

export function createActivationScorecardDashboardRoutes(basePath = '/activation-scorecard') {
  const snapshot = buildActivationScorecardSnapshot();
  return [
    { id: 'activation-scorecard.dashboard.overview', method: 'GET', path: basePath, summary: createActivationScorecardRouteSummary(snapshot) },
    { id: 'activation-scorecard.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'activation-scorecard.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

