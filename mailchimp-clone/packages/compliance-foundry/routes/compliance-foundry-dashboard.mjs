import { buildComplianceFoundrySnapshot, createComplianceFoundryRouteSummary } from '../service-compliance-foundry.mjs';

export function createComplianceFoundryDashboardRoutes(basePath = '/compliance-foundry') {
  const snapshot = buildComplianceFoundrySnapshot();
  return [
    { id: 'compliance-foundry.dashboard.overview', method: 'GET', path: basePath, summary: createComplianceFoundryRouteSummary(snapshot) },
    { id: 'compliance-foundry.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'compliance-foundry.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

