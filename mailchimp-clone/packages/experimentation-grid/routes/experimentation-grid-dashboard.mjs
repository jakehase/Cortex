import { buildExperimentationGridSnapshot, createExperimentationGridRouteSummary } from '../service-experimentation-grid.mjs';

export function createExperimentationGridDashboardRoutes(basePath = '/experimentation-grid') {
  const snapshot = buildExperimentationGridSnapshot();
  return [
    { id: 'experimentation-grid.dashboard.overview', method: 'GET', path: basePath, summary: createExperimentationGridRouteSummary(snapshot) },
    { id: 'experimentation-grid.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'experimentation-grid.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

