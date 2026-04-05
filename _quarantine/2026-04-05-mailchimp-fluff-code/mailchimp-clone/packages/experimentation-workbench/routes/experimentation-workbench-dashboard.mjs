import { buildExperimentationWorkbenchSnapshot, createExperimentationWorkbenchRouteSummary } from '../service-experimentation-workbench.mjs';

export function createExperimentationWorkbenchDashboardRoutes(basePath = '/experimentation-workbench') {
  const snapshot = buildExperimentationWorkbenchSnapshot();
  return [
    { id: 'experimentation-workbench.dashboard.overview', method: 'GET', path: basePath, summary: createExperimentationWorkbenchRouteSummary(snapshot) },
    { id: 'experimentation-workbench.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'experimentation-workbench.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

