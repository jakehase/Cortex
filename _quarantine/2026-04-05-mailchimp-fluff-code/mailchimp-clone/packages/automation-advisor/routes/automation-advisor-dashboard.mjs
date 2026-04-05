import { buildAutomationAdvisorSnapshot, createAutomationAdvisorRouteSummary } from '../service-automation-advisor.mjs';

export function createAutomationAdvisorDashboardRoutes(basePath = '/automation-advisor') {
  const snapshot = buildAutomationAdvisorSnapshot();
  return [
    { id: 'automation-advisor.dashboard.overview', method: 'GET', path: basePath, summary: createAutomationAdvisorRouteSummary(snapshot) },
    { id: 'automation-advisor.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'automation-advisor.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

