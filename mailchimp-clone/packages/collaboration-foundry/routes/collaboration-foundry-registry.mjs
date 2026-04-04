import { buildCollaborationFoundrySnapshot, createCollaborationFoundryRouteSummary } from '../service-collaboration-foundry.mjs';

export function createCollaborationFoundryRegistryRoutes(basePath = '/registry/collaboration-foundry') {
  const snapshot = buildCollaborationFoundrySnapshot();
  return [
    { id: 'collaboration-foundry.registry.summary', method: 'GET', path: basePath, summary: createCollaborationFoundryRouteSummary(snapshot) },
    { id: 'collaboration-foundry.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'collaboration-foundry.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

