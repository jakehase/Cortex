import { buildChannelVaultSnapshot, createChannelVaultRouteSummary } from '../service-channel-vault.mjs';

export function createChannelVaultDashboardRoutes(basePath = '/channel-vault') {
  const snapshot = buildChannelVaultSnapshot();
  return [
    { id: 'channel-vault.dashboard.overview', method: 'GET', path: basePath, summary: createChannelVaultRouteSummary(snapshot) },
    { id: 'channel-vault.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'channel-vault.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

