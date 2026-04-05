import { buildAudienceAdvisorSnapshot, createAudienceAdvisorRouteSummary } from '../service-audience-advisor.mjs';

export function createAudienceAdvisorDashboardRoutes(basePath = '/audience-advisor') {
  const snapshot = buildAudienceAdvisorSnapshot();
  return [
    { id: 'audience-advisor.dashboard.overview', method: 'GET', path: basePath, summary: createAudienceAdvisorRouteSummary(snapshot) },
    { id: 'audience-advisor.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'audience-advisor.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

