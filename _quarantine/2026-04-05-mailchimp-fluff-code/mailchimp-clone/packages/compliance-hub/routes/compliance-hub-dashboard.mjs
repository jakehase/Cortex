import { buildComplianceHubSnapshot, createComplianceHubRouteSummary } from '../service-compliance-hub.mjs';

export function createComplianceHubDashboardRoutes(basePath = '/compliance-hub') {
  const snapshot = buildComplianceHubSnapshot();
  return [
    { id: 'compliance-hub.dashboard.overview', method: 'GET', path: basePath, summary: createComplianceHubRouteSummary(snapshot) },
    { id: 'compliance-hub.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'compliance-hub.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

