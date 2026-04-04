import { buildCreativeAdvisorSnapshot, createCreativeAdvisorRouteSummary } from '../service-creative-advisor.mjs';

export function createCreativeAdvisorDashboardRoutes(basePath = '/creative-advisor') {
  const snapshot = buildCreativeAdvisorSnapshot();
  return [
    { id: 'creative-advisor.dashboard.overview', method: 'GET', path: basePath, summary: createCreativeAdvisorRouteSummary(snapshot) },
    { id: 'creative-advisor.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'creative-advisor.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

