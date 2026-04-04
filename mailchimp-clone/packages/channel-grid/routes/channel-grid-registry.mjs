import { buildChannelGridSnapshot, createChannelGridRouteSummary } from '../service-channel-grid.mjs';

export function createChannelGridRegistryRoutes(basePath = '/registry/channel-grid') {
  const snapshot = buildChannelGridSnapshot();
  return [
    { id: 'channel-grid.registry.summary', method: 'GET', path: basePath, summary: createChannelGridRouteSummary(snapshot) },
    { id: 'channel-grid.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'channel-grid.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

