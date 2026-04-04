import { buildExperimentationIndexSnapshot, createExperimentationIndexRouteSummary } from '../service-experimentation-index.mjs';

export function createExperimentationIndexDashboardRoutes(basePath = '/experimentation-index') {
  const snapshot = buildExperimentationIndexSnapshot();
  return [
    { id: 'experimentation-index.dashboard.overview', method: 'GET', path: basePath, summary: createExperimentationIndexRouteSummary(snapshot) },
    { id: 'experimentation-index.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'experimentation-index.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

