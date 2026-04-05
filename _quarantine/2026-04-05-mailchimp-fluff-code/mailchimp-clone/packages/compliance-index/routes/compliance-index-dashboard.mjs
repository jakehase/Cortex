import { buildComplianceIndexSnapshot, createComplianceIndexRouteSummary } from '../service-compliance-index.mjs';

export function createComplianceIndexDashboardRoutes(basePath = '/compliance-index') {
  const snapshot = buildComplianceIndexSnapshot();
  return [
    { id: 'compliance-index.dashboard.overview', method: 'GET', path: basePath, summary: createComplianceIndexRouteSummary(snapshot) },
    { id: 'compliance-index.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'compliance-index.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

