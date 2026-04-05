import { buildAcquisitionPlannerSnapshot, createAcquisitionPlannerRouteSummary } from '../service-acquisition-planner.mjs';

export function createAcquisitionPlannerDashboardRoutes(basePath = '/acquisition-planner') {
  const snapshot = buildAcquisitionPlannerSnapshot();
  return [
    { id: 'acquisition-planner.dashboard.overview', method: 'GET', path: basePath, summary: createAcquisitionPlannerRouteSummary(snapshot) },
    { id: 'acquisition-planner.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'acquisition-planner.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

