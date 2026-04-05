import { buildComplianceNavigatorSnapshot, createComplianceNavigatorRouteSummary } from '../service-compliance-navigator.mjs';

export function createComplianceNavigatorDashboardRoutes(basePath = '/compliance-navigator') {
  const snapshot = buildComplianceNavigatorSnapshot();
  return [
    { id: 'compliance-navigator.dashboard.overview', method: 'GET', path: basePath, summary: createComplianceNavigatorRouteSummary(snapshot) },
    { id: 'compliance-navigator.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'compliance-navigator.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

