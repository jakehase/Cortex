import { buildComplianceAdvisorSnapshot, createComplianceAdvisorRouteSummary } from '../service-compliance-advisor.mjs';

export function createComplianceAdvisorDashboardRoutes(basePath = '/compliance-advisor') {
  const snapshot = buildComplianceAdvisorSnapshot();
  return [
    { id: 'compliance-advisor.dashboard.overview', method: 'GET', path: basePath, summary: createComplianceAdvisorRouteSummary(snapshot) },
    { id: 'compliance-advisor.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'compliance-advisor.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

