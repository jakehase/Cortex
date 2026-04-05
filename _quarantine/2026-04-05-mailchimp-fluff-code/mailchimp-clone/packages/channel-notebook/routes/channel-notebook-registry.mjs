import { buildChannelNotebookSnapshot, createChannelNotebookRouteSummary } from '../service-channel-notebook.mjs';

export function createChannelNotebookRegistryRoutes(basePath = '/registry/channel-notebook') {
  const snapshot = buildChannelNotebookSnapshot();
  return [
    { id: 'channel-notebook.registry.summary', method: 'GET', path: basePath, summary: createChannelNotebookRouteSummary(snapshot) },
    { id: 'channel-notebook.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'channel-notebook.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

