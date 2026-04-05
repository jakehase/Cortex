import { buildCollaborationStudioSnapshot, createCollaborationStudioRouteSummary } from '../service-collaboration-studio.mjs';

export function createCollaborationStudioRegistryRoutes(basePath = '/registry/collaboration-studio') {
  const snapshot = buildCollaborationStudioSnapshot();
  return [
    { id: 'collaboration-studio.registry.summary', method: 'GET', path: basePath, summary: createCollaborationStudioRouteSummary(snapshot) },
    { id: 'collaboration-studio.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'collaboration-studio.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

