import { buildIntegrationsPlannerSnapshot, createIntegrationsPlannerRouteSummary } from '../service-integrations-planner.mjs';

export function createIntegrationsPlannerDashboardRoutes(basePath = '/integrations-planner') {
  const snapshot = buildIntegrationsPlannerSnapshot();
  return [
    { id: 'integrations-planner.dashboard.overview', method: 'GET', path: basePath, summary: createIntegrationsPlannerRouteSummary(snapshot) },
    { id: 'integrations-planner.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'integrations-planner.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

