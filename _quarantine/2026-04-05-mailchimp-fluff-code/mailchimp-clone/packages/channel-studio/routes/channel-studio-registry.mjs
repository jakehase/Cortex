import { buildChannelStudioSnapshot, createChannelStudioRouteSummary } from '../service-channel-studio.mjs';

export function createChannelStudioRegistryRoutes(basePath = '/registry/channel-studio') {
  const snapshot = buildChannelStudioSnapshot();
  return [
    { id: 'channel-studio.registry.summary', method: 'GET', path: basePath, summary: createChannelStudioRouteSummary(snapshot) },
    { id: 'channel-studio.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'channel-studio.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

