import { buildAcquisitionVaultSnapshot, createAcquisitionVaultRouteSummary } from '../service-acquisition-vault.mjs';

export function createAcquisitionVaultDashboardRoutes(basePath = '/acquisition-vault') {
  const snapshot = buildAcquisitionVaultSnapshot();
  return [
    { id: 'acquisition-vault.dashboard.overview', method: 'GET', path: basePath, summary: createAcquisitionVaultRouteSummary(snapshot) },
    { id: 'acquisition-vault.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'acquisition-vault.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

