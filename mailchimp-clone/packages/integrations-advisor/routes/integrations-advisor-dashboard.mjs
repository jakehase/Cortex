import { buildIntegrationsAdvisorSnapshot, createIntegrationsAdvisorRouteSummary } from '../service-integrations-advisor.mjs';

export function createIntegrationsAdvisorDashboardRoutes(basePath = '/integrations-advisor') {
  const snapshot = buildIntegrationsAdvisorSnapshot();
  return [
    { id: 'integrations-advisor.dashboard.overview', method: 'GET', path: basePath, summary: createIntegrationsAdvisorRouteSummary(snapshot) },
    { id: 'integrations-advisor.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'integrations-advisor.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

