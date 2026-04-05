import { buildComplianceGridSnapshot, createComplianceGridRouteSummary } from '../service-compliance-grid.mjs';

export function createComplianceGridDashboardRoutes(basePath = '/compliance-grid') {
  const snapshot = buildComplianceGridSnapshot();
  return [
    { id: 'compliance-grid.dashboard.overview', method: 'GET', path: basePath, summary: createComplianceGridRouteSummary(snapshot) },
    { id: 'compliance-grid.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'compliance-grid.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

