import { buildCollaborationAtlasSnapshot, createCollaborationAtlasRouteSummary } from '../service-collaboration-atlas.mjs';

export function createCollaborationAtlasRegistryRoutes(basePath = '/registry/collaboration-atlas') {
  const snapshot = buildCollaborationAtlasSnapshot();
  return [
    { id: 'collaboration-atlas.registry.summary', method: 'GET', path: basePath, summary: createCollaborationAtlasRouteSummary(snapshot) },
    { id: 'collaboration-atlas.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'collaboration-atlas.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

