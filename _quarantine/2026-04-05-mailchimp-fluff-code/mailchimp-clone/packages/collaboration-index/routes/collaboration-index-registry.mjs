import { buildCollaborationIndexSnapshot, createCollaborationIndexRouteSummary } from '../service-collaboration-index.mjs';

export function createCollaborationIndexRegistryRoutes(basePath = '/registry/collaboration-index') {
  const snapshot = buildCollaborationIndexSnapshot();
  return [
    { id: 'collaboration-index.registry.summary', method: 'GET', path: basePath, summary: createCollaborationIndexRouteSummary(snapshot) },
    { id: 'collaboration-index.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'collaboration-index.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

