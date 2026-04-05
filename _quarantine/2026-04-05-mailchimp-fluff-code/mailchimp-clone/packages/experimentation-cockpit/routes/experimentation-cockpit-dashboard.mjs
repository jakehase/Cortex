import { buildExperimentationCockpitSnapshot, createExperimentationCockpitRouteSummary } from '../service-experimentation-cockpit.mjs';

export function createExperimentationCockpitDashboardRoutes(basePath = '/experimentation-cockpit') {
  const snapshot = buildExperimentationCockpitSnapshot();
  return [
    { id: 'experimentation-cockpit.dashboard.overview', method: 'GET', path: basePath, summary: createExperimentationCockpitRouteSummary(snapshot) },
    { id: 'experimentation-cockpit.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'experimentation-cockpit.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

