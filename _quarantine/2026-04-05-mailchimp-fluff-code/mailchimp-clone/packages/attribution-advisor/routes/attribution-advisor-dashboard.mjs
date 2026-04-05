import { buildAttributionAdvisorSnapshot, createAttributionAdvisorRouteSummary } from '../service-attribution-advisor.mjs';

export function createAttributionAdvisorDashboardRoutes(basePath = '/attribution-advisor') {
  const snapshot = buildAttributionAdvisorSnapshot();
  return [
    { id: 'attribution-advisor.dashboard.overview', method: 'GET', path: basePath, summary: createAttributionAdvisorRouteSummary(snapshot) },
    { id: 'attribution-advisor.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'attribution-advisor.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

