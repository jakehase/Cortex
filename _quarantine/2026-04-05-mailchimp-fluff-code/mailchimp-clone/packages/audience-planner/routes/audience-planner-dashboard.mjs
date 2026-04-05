import { buildAudiencePlannerSnapshot, createAudiencePlannerRouteSummary } from '../service-audience-planner.mjs';

export function createAudiencePlannerDashboardRoutes(basePath = '/audience-planner') {
  const snapshot = buildAudiencePlannerSnapshot();
  return [
    { id: 'audience-planner.dashboard.overview', method: 'GET', path: basePath, summary: createAudiencePlannerRouteSummary(snapshot) },
    { id: 'audience-planner.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'audience-planner.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

