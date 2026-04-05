import { buildContentAdvisorSnapshot, createContentAdvisorRouteSummary } from '../service-content-advisor.mjs';

export function createContentAdvisorDashboardRoutes(basePath = '/content-advisor') {
  const snapshot = buildContentAdvisorSnapshot();
  return [
    { id: 'content-advisor.dashboard.overview', method: 'GET', path: basePath, summary: createContentAdvisorRouteSummary(snapshot) },
    { id: 'content-advisor.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'content-advisor.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

