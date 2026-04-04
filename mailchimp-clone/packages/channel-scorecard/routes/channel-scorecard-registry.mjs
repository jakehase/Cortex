import { buildChannelScorecardSnapshot, createChannelScorecardRouteSummary } from '../service-channel-scorecard.mjs';

export function createChannelScorecardRegistryRoutes(basePath = '/registry/channel-scorecard') {
  const snapshot = buildChannelScorecardSnapshot();
  return [
    { id: 'channel-scorecard.registry.summary', method: 'GET', path: basePath, summary: createChannelScorecardRouteSummary(snapshot) },
    { id: 'channel-scorecard.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'channel-scorecard.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

