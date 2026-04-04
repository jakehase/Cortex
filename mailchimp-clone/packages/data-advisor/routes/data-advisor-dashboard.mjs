import { buildDataAdvisorSnapshot, createDataAdvisorRouteSummary } from '../service-data-advisor.mjs';

export function createDataAdvisorDashboardRoutes(basePath = '/data-advisor') {
  const snapshot = buildDataAdvisorSnapshot();
  return [
    { id: 'data-advisor.dashboard.overview', method: 'GET', path: basePath, summary: createDataAdvisorRouteSummary(snapshot) },
    { id: 'data-advisor.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'data-advisor.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

