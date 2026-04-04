import { buildActivationPlannerSnapshot, createActivationPlannerRouteSummary } from '../service-activation-planner.mjs';

export function createActivationPlannerDashboardRoutes(basePath = '/activation-planner') {
  const snapshot = buildActivationPlannerSnapshot();
  return [
    { id: 'activation-planner.dashboard.overview', method: 'GET', path: basePath, summary: createActivationPlannerRouteSummary(snapshot) },
    { id: 'activation-planner.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'activation-planner.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

