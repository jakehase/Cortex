import { buildActivationAdvisorSnapshot, createActivationAdvisorRouteSummary } from '../service-activation-advisor.mjs';

export function createActivationAdvisorDashboardRoutes(basePath = '/activation-advisor') {
  const snapshot = buildActivationAdvisorSnapshot();
  return [
    { id: 'activation-advisor.dashboard.overview', method: 'GET', path: basePath, summary: createActivationAdvisorRouteSummary(snapshot) },
    { id: 'activation-advisor.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'activation-advisor.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

