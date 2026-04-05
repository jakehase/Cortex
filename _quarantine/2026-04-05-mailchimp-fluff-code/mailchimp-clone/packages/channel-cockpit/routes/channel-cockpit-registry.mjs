import { buildChannelCockpitSnapshot, createChannelCockpitRouteSummary } from '../service-channel-cockpit.mjs';

export function createChannelCockpitRegistryRoutes(basePath = '/registry/channel-cockpit') {
  const snapshot = buildChannelCockpitSnapshot();
  return [
    { id: 'channel-cockpit.registry.summary', method: 'GET', path: basePath, summary: createChannelCockpitRouteSummary(snapshot) },
    { id: 'channel-cockpit.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'channel-cockpit.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

