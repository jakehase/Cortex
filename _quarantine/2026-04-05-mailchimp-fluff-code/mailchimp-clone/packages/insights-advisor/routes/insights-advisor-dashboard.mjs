import { buildInsightsAdvisorSnapshot, createInsightsAdvisorRouteSummary } from '../service-insights-advisor.mjs';

export function createInsightsAdvisorDashboardRoutes(basePath = '/insights-advisor') {
  const snapshot = buildInsightsAdvisorSnapshot();
  return [
    { id: 'insights-advisor.dashboard.overview', method: 'GET', path: basePath, summary: createInsightsAdvisorRouteSummary(snapshot) },
    { id: 'insights-advisor.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'insights-advisor.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

