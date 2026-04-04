import { buildLoyaltyWorkbenchSnapshot, createLoyaltyWorkbenchRouteSummary } from '../service-loyalty-workbench.mjs';

export function createLoyaltyWorkbenchRegistryRoutes(basePath = '/registry/loyalty-workbench') {
  const snapshot = buildLoyaltyWorkbenchSnapshot();
  return [
    { id: 'loyalty-workbench.registry.summary', method: 'GET', path: basePath, summary: createLoyaltyWorkbenchRouteSummary(snapshot) },
    { id: 'loyalty-workbench.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'loyalty-workbench.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

