import { buildLifecycleVaultSnapshot, createLifecycleVaultRouteSummary } from '../service-lifecycle-vault.mjs';

export function createLifecycleVaultDashboardRoutes(basePath = '/lifecycle-vault') {
  const snapshot = buildLifecycleVaultSnapshot();
  return [
    { id: 'lifecycle-vault.dashboard.overview', method: 'GET', path: basePath, summary: createLifecycleVaultRouteSummary(snapshot) },
    { id: 'lifecycle-vault.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'lifecycle-vault.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

