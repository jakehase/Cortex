import { buildLoyaltyNotebookSnapshot, createLoyaltyNotebookRouteSummary } from '../service-loyalty-notebook.mjs';

export function createLoyaltyNotebookRegistryRoutes(basePath = '/registry/loyalty-notebook') {
  const snapshot = buildLoyaltyNotebookSnapshot();
  return [
    { id: 'loyalty-notebook.registry.summary', method: 'GET', path: basePath, summary: createLoyaltyNotebookRouteSummary(snapshot) },
    { id: 'loyalty-notebook.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'loyalty-notebook.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

