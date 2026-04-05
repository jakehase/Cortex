import { buildCollaborationNavigatorSnapshot, createCollaborationNavigatorRouteSummary } from '../service-collaboration-navigator.mjs';

export function createCollaborationNavigatorRegistryRoutes(basePath = '/registry/collaboration-navigator') {
  const snapshot = buildCollaborationNavigatorSnapshot();
  return [
    { id: 'collaboration-navigator.registry.summary', method: 'GET', path: basePath, summary: createCollaborationNavigatorRouteSummary(snapshot) },
    { id: 'collaboration-navigator.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'collaboration-navigator.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

