import { buildChannelWatchtowerSnapshot, createChannelWatchtowerRouteSummary } from '../service-channel-watchtower.mjs';

export function createChannelWatchtowerRegistryRoutes(basePath = '/registry/channel-watchtower') {
  const snapshot = buildChannelWatchtowerSnapshot();
  return [
    { id: 'channel-watchtower.registry.summary', method: 'GET', path: basePath, summary: createChannelWatchtowerRouteSummary(snapshot) },
    { id: 'channel-watchtower.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'channel-watchtower.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

