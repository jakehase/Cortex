import { buildChannelPlannerSnapshot, createChannelPlannerRouteSummary } from '../service-channel-planner.mjs';

export function createChannelPlannerRegistryRoutes(basePath = '/registry/channel-planner') {
  const snapshot = buildChannelPlannerSnapshot();
  return [
    { id: 'channel-planner.registry.summary', method: 'GET', path: basePath, summary: createChannelPlannerRouteSummary(snapshot) },
    { id: 'channel-planner.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'channel-planner.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

