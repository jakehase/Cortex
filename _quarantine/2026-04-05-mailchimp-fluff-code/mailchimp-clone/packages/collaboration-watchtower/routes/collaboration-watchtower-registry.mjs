import { buildCollaborationWatchtowerSnapshot, createCollaborationWatchtowerRouteSummary } from '../service-collaboration-watchtower.mjs';

export function createCollaborationWatchtowerRegistryRoutes(basePath = '/registry/collaboration-watchtower') {
  const snapshot = buildCollaborationWatchtowerSnapshot();
  return [
    { id: 'collaboration-watchtower.registry.summary', method: 'GET', path: basePath, summary: createCollaborationWatchtowerRouteSummary(snapshot) },
    { id: 'collaboration-watchtower.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'collaboration-watchtower.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

