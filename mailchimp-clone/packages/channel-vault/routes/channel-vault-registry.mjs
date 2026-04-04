import { buildChannelVaultSnapshot, createChannelVaultRouteSummary } from '../service-channel-vault.mjs';

export function createChannelVaultRegistryRoutes(basePath = '/registry/channel-vault') {
  const snapshot = buildChannelVaultSnapshot();
  return [
    { id: 'channel-vault.registry.summary', method: 'GET', path: basePath, summary: createChannelVaultRouteSummary(snapshot) },
    { id: 'channel-vault.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'channel-vault.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

