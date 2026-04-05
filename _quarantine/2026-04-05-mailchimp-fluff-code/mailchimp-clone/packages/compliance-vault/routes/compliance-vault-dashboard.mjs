import { buildComplianceVaultSnapshot, createComplianceVaultRouteSummary } from '../service-compliance-vault.mjs';

export function createComplianceVaultDashboardRoutes(basePath = '/compliance-vault') {
  const snapshot = buildComplianceVaultSnapshot();
  return [
    { id: 'compliance-vault.dashboard.overview', method: 'GET', path: basePath, summary: createComplianceVaultRouteSummary(snapshot) },
    { id: 'compliance-vault.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'compliance-vault.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

