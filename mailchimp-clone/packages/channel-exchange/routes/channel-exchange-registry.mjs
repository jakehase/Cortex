import { buildChannelExchangeSnapshot, createChannelExchangeRouteSummary } from '../service-channel-exchange.mjs';

export function createChannelExchangeRegistryRoutes(basePath = '/registry/channel-exchange') {
  const snapshot = buildChannelExchangeSnapshot();
  return [
    { id: 'channel-exchange.registry.summary', method: 'GET', path: basePath, summary: createChannelExchangeRouteSummary(snapshot) },
    { id: 'channel-exchange.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'channel-exchange.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

