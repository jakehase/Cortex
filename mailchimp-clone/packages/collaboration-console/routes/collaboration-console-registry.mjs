import { buildCollaborationConsoleSnapshot, createCollaborationConsoleRouteSummary } from '../service-collaboration-console.mjs';

export function createCollaborationConsoleRegistryRoutes(basePath = '/registry/collaboration-console') {
  const snapshot = buildCollaborationConsoleSnapshot();
  return [
    { id: 'collaboration-console.registry.summary', method: 'GET', path: basePath, summary: createCollaborationConsoleRouteSummary(snapshot) },
    { id: 'collaboration-console.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'collaboration-console.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

