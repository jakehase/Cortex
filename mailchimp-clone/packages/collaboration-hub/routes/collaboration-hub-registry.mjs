import { buildCollaborationHubSnapshot, createCollaborationHubRouteSummary } from '../service-collaboration-hub.mjs';

export function createCollaborationHubRegistryRoutes(basePath = '/registry/collaboration-hub') {
  const snapshot = buildCollaborationHubSnapshot();
  return [
    { id: 'collaboration-hub.registry.summary', method: 'GET', path: basePath, summary: createCollaborationHubRouteSummary(snapshot) },
    { id: 'collaboration-hub.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'collaboration-hub.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

