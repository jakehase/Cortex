import { buildChannelSentinelSnapshot, createChannelSentinelRouteSummary } from '../service-channel-sentinel.mjs';

export function createChannelSentinelRegistryRoutes(basePath = '/registry/channel-sentinel') {
  const snapshot = buildChannelSentinelSnapshot();
  return [
    { id: 'channel-sentinel.registry.summary', method: 'GET', path: basePath, summary: createChannelSentinelRouteSummary(snapshot) },
    { id: 'channel-sentinel.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'channel-sentinel.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

