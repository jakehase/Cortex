import { buildCollaborationExchangeSnapshot, createCollaborationExchangeRouteSummary } from '../service-collaboration-exchange.mjs';

export function createCollaborationExchangeRegistryRoutes(basePath = '/registry/collaboration-exchange') {
  const snapshot = buildCollaborationExchangeSnapshot();
  return [
    { id: 'collaboration-exchange.registry.summary', method: 'GET', path: basePath, summary: createCollaborationExchangeRouteSummary(snapshot) },
    { id: 'collaboration-exchange.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'collaboration-exchange.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

