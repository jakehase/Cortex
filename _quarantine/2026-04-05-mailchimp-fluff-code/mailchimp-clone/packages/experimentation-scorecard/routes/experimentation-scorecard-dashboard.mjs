import { buildExperimentationScorecardSnapshot, createExperimentationScorecardRouteSummary } from '../service-experimentation-scorecard.mjs';

export function createExperimentationScorecardDashboardRoutes(basePath = '/experimentation-scorecard') {
  const snapshot = buildExperimentationScorecardSnapshot();
  return [
    { id: 'experimentation-scorecard.dashboard.overview', method: 'GET', path: basePath, summary: createExperimentationScorecardRouteSummary(snapshot) },
    { id: 'experimentation-scorecard.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'experimentation-scorecard.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

