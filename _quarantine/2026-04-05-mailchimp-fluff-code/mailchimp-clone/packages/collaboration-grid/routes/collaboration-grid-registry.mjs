import { buildCollaborationGridSnapshot, createCollaborationGridRouteSummary } from '../service-collaboration-grid.mjs';

export function createCollaborationGridRegistryRoutes(basePath = '/registry/collaboration-grid') {
  const snapshot = buildCollaborationGridSnapshot();
  return [
    { id: 'collaboration-grid.registry.summary', method: 'GET', path: basePath, summary: createCollaborationGridRouteSummary(snapshot) },
    { id: 'collaboration-grid.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'collaboration-grid.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

