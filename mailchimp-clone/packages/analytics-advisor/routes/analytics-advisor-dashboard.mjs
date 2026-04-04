import { buildAnalyticsAdvisorSnapshot, createAnalyticsAdvisorRouteSummary } from '../service-analytics-advisor.mjs';

export function createAnalyticsAdvisorDashboardRoutes(basePath = '/analytics-advisor') {
  const snapshot = buildAnalyticsAdvisorSnapshot();
  return [
    { id: 'analytics-advisor.dashboard.overview', method: 'GET', path: basePath, summary: createAnalyticsAdvisorRouteSummary(snapshot) },
    { id: 'analytics-advisor.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'analytics-advisor.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

