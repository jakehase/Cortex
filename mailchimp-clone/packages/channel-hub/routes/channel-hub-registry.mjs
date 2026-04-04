import { buildChannelHubSnapshot, createChannelHubRouteSummary } from '../service-channel-hub.mjs';

export function createChannelHubRegistryRoutes(basePath = '/registry/channel-hub') {
  const snapshot = buildChannelHubSnapshot();
  return [
    { id: 'channel-hub.registry.summary', method: 'GET', path: basePath, summary: createChannelHubRouteSummary(snapshot) },
    { id: 'channel-hub.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'channel-hub.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

