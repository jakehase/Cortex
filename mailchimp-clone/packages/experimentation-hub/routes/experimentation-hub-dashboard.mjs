import { buildExperimentationHubSnapshot, createExperimentationHubRouteSummary } from '../service-experimentation-hub.mjs';

export function createExperimentationHubDashboardRoutes(basePath = '/experimentation-hub') {
  const snapshot = buildExperimentationHubSnapshot();
  return [
    { id: 'experimentation-hub.dashboard.overview', method: 'GET', path: basePath, summary: createExperimentationHubRouteSummary(snapshot) },
    { id: 'experimentation-hub.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'experimentation-hub.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

