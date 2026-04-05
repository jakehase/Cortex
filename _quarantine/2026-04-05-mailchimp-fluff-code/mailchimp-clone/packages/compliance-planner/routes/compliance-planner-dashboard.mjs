import { buildCompliancePlannerSnapshot, createCompliancePlannerRouteSummary } from '../service-compliance-planner.mjs';

export function createCompliancePlannerDashboardRoutes(basePath = '/compliance-planner') {
  const snapshot = buildCompliancePlannerSnapshot();
  return [
    { id: 'compliance-planner.dashboard.overview', method: 'GET', path: basePath, summary: createCompliancePlannerRouteSummary(snapshot) },
    { id: 'compliance-planner.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'compliance-planner.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

