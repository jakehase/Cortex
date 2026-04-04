import { buildChannelWorkbenchSnapshot, createChannelWorkbenchRouteSummary } from '../service-channel-workbench.mjs';

export function createChannelWorkbenchRegistryRoutes(basePath = '/registry/channel-workbench') {
  const snapshot = buildChannelWorkbenchSnapshot();
  return [
    { id: 'channel-workbench.registry.summary', method: 'GET', path: basePath, summary: createChannelWorkbenchRouteSummary(snapshot) },
    { id: 'channel-workbench.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'channel-workbench.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

