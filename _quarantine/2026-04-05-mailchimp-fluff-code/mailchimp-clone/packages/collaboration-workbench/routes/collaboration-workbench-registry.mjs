import { buildCollaborationWorkbenchSnapshot, createCollaborationWorkbenchRouteSummary } from '../service-collaboration-workbench.mjs';

export function createCollaborationWorkbenchRegistryRoutes(basePath = '/registry/collaboration-workbench') {
  const snapshot = buildCollaborationWorkbenchSnapshot();
  return [
    { id: 'collaboration-workbench.registry.summary', method: 'GET', path: basePath, summary: createCollaborationWorkbenchRouteSummary(snapshot) },
    { id: 'collaboration-workbench.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'collaboration-workbench.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

