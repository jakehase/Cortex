import { buildExperimentationWatchtowerSnapshot, createExperimentationWatchtowerRouteSummary } from '../service-experimentation-watchtower.mjs';

export function createExperimentationWatchtowerDashboardRoutes(basePath = '/experimentation-watchtower') {
  const snapshot = buildExperimentationWatchtowerSnapshot();
  return [
    { id: 'experimentation-watchtower.dashboard.overview', method: 'GET', path: basePath, summary: createExperimentationWatchtowerRouteSummary(snapshot) },
    { id: 'experimentation-watchtower.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'experimentation-watchtower.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

