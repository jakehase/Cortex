import { buildChannelNavigatorSnapshot, createChannelNavigatorRouteSummary } from '../service-channel-navigator.mjs';

export function createChannelNavigatorRegistryRoutes(basePath = '/registry/channel-navigator') {
  const snapshot = buildChannelNavigatorSnapshot();
  return [
    { id: 'channel-navigator.registry.summary', method: 'GET', path: basePath, summary: createChannelNavigatorRouteSummary(snapshot) },
    { id: 'channel-navigator.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'channel-navigator.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

