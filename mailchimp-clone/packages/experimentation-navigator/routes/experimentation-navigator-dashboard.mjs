import { buildExperimentationNavigatorSnapshot, createExperimentationNavigatorRouteSummary } from '../service-experimentation-navigator.mjs';

export function createExperimentationNavigatorDashboardRoutes(basePath = '/experimentation-navigator') {
  const snapshot = buildExperimentationNavigatorSnapshot();
  return [
    { id: 'experimentation-navigator.dashboard.overview', method: 'GET', path: basePath, summary: createExperimentationNavigatorRouteSummary(snapshot) },
    { id: 'experimentation-navigator.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'experimentation-navigator.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

