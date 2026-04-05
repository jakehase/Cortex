import { buildChannelConsoleSnapshot, createChannelConsoleRouteSummary } from '../service-channel-console.mjs';

export function createChannelConsoleRegistryRoutes(basePath = '/registry/channel-console') {
  const snapshot = buildChannelConsoleSnapshot();
  return [
    { id: 'channel-console.registry.summary', method: 'GET', path: basePath, summary: createChannelConsoleRouteSummary(snapshot) },
    { id: 'channel-console.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'channel-console.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

