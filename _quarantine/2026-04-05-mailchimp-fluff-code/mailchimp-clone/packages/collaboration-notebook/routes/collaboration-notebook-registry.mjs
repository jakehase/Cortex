import { buildCollaborationNotebookSnapshot, createCollaborationNotebookRouteSummary } from '../service-collaboration-notebook.mjs';

export function createCollaborationNotebookRegistryRoutes(basePath = '/registry/collaboration-notebook') {
  const snapshot = buildCollaborationNotebookSnapshot();
  return [
    { id: 'collaboration-notebook.registry.summary', method: 'GET', path: basePath, summary: createCollaborationNotebookRouteSummary(snapshot) },
    { id: 'collaboration-notebook.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'collaboration-notebook.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

