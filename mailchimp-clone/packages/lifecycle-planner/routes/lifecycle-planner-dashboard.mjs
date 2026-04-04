import { buildLifecyclePlannerSnapshot, createLifecyclePlannerRouteSummary } from '../service-lifecycle-planner.mjs';

export function createLifecyclePlannerDashboardRoutes(basePath = '/lifecycle-planner') {
  const snapshot = buildLifecyclePlannerSnapshot();
  return [
    { id: 'lifecycle-planner.dashboard.overview', method: 'GET', path: basePath, summary: createLifecyclePlannerRouteSummary(snapshot) },
    { id: 'lifecycle-planner.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'lifecycle-planner.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

