import { buildAutomationPlannerSnapshot, createAutomationPlannerRouteSummary } from '../service-automation-planner.mjs';

export function createAutomationPlannerDashboardRoutes(basePath = '/automation-planner') {
  const snapshot = buildAutomationPlannerSnapshot();
  return [
    { id: 'automation-planner.dashboard.overview', method: 'GET', path: basePath, summary: createAutomationPlannerRouteSummary(snapshot) },
    { id: 'automation-planner.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'automation-planner.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

