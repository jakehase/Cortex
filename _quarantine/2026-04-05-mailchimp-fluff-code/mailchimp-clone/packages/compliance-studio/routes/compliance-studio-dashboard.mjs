import { buildComplianceStudioSnapshot, createComplianceStudioRouteSummary } from '../service-compliance-studio.mjs';

export function createComplianceStudioDashboardRoutes(basePath = '/compliance-studio') {
  const snapshot = buildComplianceStudioSnapshot();
  return [
    { id: 'compliance-studio.dashboard.overview', method: 'GET', path: basePath, summary: createComplianceStudioRouteSummary(snapshot) },
    { id: 'compliance-studio.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'compliance-studio.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

