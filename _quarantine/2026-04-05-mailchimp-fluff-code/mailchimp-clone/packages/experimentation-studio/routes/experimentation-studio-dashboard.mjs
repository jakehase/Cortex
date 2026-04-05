import { buildExperimentationStudioSnapshot, createExperimentationStudioRouteSummary } from '../service-experimentation-studio.mjs';

export function createExperimentationStudioDashboardRoutes(basePath = '/experimentation-studio') {
  const snapshot = buildExperimentationStudioSnapshot();
  return [
    { id: 'experimentation-studio.dashboard.overview', method: 'GET', path: basePath, summary: createExperimentationStudioRouteSummary(snapshot) },
    { id: 'experimentation-studio.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'experimentation-studio.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

