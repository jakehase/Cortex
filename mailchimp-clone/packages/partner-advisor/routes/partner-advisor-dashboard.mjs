import { buildPartnerAdvisorSnapshot, createPartnerAdvisorRouteSummary } from '../service-partner-advisor.mjs';

export function createPartnerAdvisorDashboardRoutes(basePath = '/partner-advisor') {
  const snapshot = buildPartnerAdvisorSnapshot();
  return [
    { id: 'partner-advisor.dashboard.overview', method: 'GET', path: basePath, summary: createPartnerAdvisorRouteSummary(snapshot) },
    { id: 'partner-advisor.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'partner-advisor.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

