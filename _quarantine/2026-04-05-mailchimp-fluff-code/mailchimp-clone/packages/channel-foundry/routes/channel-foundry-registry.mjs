import { buildChannelFoundrySnapshot, createChannelFoundryRouteSummary } from '../service-channel-foundry.mjs';

export function createChannelFoundryRegistryRoutes(basePath = '/registry/channel-foundry') {
  const snapshot = buildChannelFoundrySnapshot();
  return [
    { id: 'channel-foundry.registry.summary', method: 'GET', path: basePath, summary: createChannelFoundryRouteSummary(snapshot) },
    { id: 'channel-foundry.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'channel-foundry.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

