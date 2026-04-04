import { buildExperimentationConsoleSnapshot, createExperimentationConsoleRouteSummary } from '../service-experimentation-console.mjs';

export function createExperimentationConsoleDashboardRoutes(basePath = '/experimentation-console') {
  const snapshot = buildExperimentationConsoleSnapshot();
  return [
    { id: 'experimentation-console.dashboard.overview', method: 'GET', path: basePath, summary: createExperimentationConsoleRouteSummary(snapshot) },
    { id: 'experimentation-console.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'experimentation-console.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

