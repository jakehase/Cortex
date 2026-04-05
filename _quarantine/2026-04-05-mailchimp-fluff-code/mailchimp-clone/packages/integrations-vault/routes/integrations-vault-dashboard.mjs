import { buildIntegrationsVaultSnapshot, createIntegrationsVaultRouteSummary } from '../service-integrations-vault.mjs';

export function createIntegrationsVaultDashboardRoutes(basePath = '/integrations-vault') {
  const snapshot = buildIntegrationsVaultSnapshot();
  return [
    { id: 'integrations-vault.dashboard.overview', method: 'GET', path: basePath, summary: createIntegrationsVaultRouteSummary(snapshot) },
    { id: 'integrations-vault.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'integrations-vault.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

