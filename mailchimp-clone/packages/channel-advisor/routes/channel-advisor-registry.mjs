import { buildChannelAdvisorSnapshot, createChannelAdvisorRouteSummary } from '../service-channel-advisor.mjs';

export function createChannelAdvisorRegistryRoutes(basePath = '/registry/channel-advisor') {
  const snapshot = buildChannelAdvisorSnapshot();
  return [
    { id: 'channel-advisor.registry.summary', method: 'GET', path: basePath, summary: createChannelAdvisorRouteSummary(snapshot) },
    { id: 'channel-advisor.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'channel-advisor.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

