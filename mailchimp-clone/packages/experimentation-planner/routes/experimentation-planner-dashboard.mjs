import { buildExperimentationPlannerSnapshot, createExperimentationPlannerRouteSummary } from '../service-experimentation-planner.mjs';

export function createExperimentationPlannerDashboardRoutes(basePath = '/experimentation-planner') {
  const snapshot = buildExperimentationPlannerSnapshot();
  return [
    { id: 'experimentation-planner.dashboard.overview', method: 'GET', path: basePath, summary: createExperimentationPlannerRouteSummary(snapshot) },
    { id: 'experimentation-planner.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'experimentation-planner.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

