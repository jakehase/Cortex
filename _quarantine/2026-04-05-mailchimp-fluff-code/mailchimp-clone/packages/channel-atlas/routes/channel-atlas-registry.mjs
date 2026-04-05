import { buildChannelAtlasSnapshot, createChannelAtlasRouteSummary } from '../service-channel-atlas.mjs';

export function createChannelAtlasRegistryRoutes(basePath = '/registry/channel-atlas') {
  const snapshot = buildChannelAtlasSnapshot();
  return [
    { id: 'channel-atlas.registry.summary', method: 'GET', path: basePath, summary: createChannelAtlasRouteSummary(snapshot) },
    { id: 'channel-atlas.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'channel-atlas.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

