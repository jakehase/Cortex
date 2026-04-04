import { buildAdvocacyAdvisorSnapshot, createAdvocacyAdvisorRouteSummary } from '../service-advocacy-advisor.mjs';

export function createAdvocacyAdvisorDashboardRoutes(basePath = '/advocacy-advisor') {
  const snapshot = buildAdvocacyAdvisorSnapshot();
  return [
    { id: 'advocacy-advisor.dashboard.overview', method: 'GET', path: basePath, summary: createAdvocacyAdvisorRouteSummary(snapshot) },
    { id: 'advocacy-advisor.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'advocacy-advisor.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

