import { buildActivationVaultSnapshot, createActivationVaultRouteSummary } from '../service-activation-vault.mjs';

export function createActivationVaultDashboardRoutes(basePath = '/activation-vault') {
  const snapshot = buildActivationVaultSnapshot();
  return [
    { id: 'activation-vault.dashboard.overview', method: 'GET', path: basePath, summary: createActivationVaultRouteSummary(snapshot) },
    { id: 'activation-vault.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'activation-vault.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

