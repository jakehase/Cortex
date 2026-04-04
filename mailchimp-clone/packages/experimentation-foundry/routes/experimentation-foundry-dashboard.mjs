import { buildExperimentationFoundrySnapshot, createExperimentationFoundryRouteSummary } from '../service-experimentation-foundry.mjs';

export function createExperimentationFoundryDashboardRoutes(basePath = '/experimentation-foundry') {
  const snapshot = buildExperimentationFoundrySnapshot();
  return [
    { id: 'experimentation-foundry.dashboard.overview', method: 'GET', path: basePath, summary: createExperimentationFoundryRouteSummary(snapshot) },
    { id: 'experimentation-foundry.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'experimentation-foundry.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

