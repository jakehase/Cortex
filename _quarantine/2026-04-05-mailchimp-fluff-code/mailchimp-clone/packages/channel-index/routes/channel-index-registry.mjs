import { buildChannelIndexSnapshot, createChannelIndexRouteSummary } from '../service-channel-index.mjs';

export function createChannelIndexRegistryRoutes(basePath = '/registry/channel-index') {
  const snapshot = buildChannelIndexSnapshot();
  return [
    { id: 'channel-index.registry.summary', method: 'GET', path: basePath, summary: createChannelIndexRouteSummary(snapshot) },
    { id: 'channel-index.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'channel-index.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

