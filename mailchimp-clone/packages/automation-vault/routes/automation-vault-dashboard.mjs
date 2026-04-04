import { buildAutomationVaultSnapshot, createAutomationVaultRouteSummary } from '../service-automation-vault.mjs';

export function createAutomationVaultDashboardRoutes(basePath = '/automation-vault') {
  const snapshot = buildAutomationVaultSnapshot();
  return [
    { id: 'automation-vault.dashboard.overview', method: 'GET', path: basePath, summary: createAutomationVaultRouteSummary(snapshot) },
    { id: 'automation-vault.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'automation-vault.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

