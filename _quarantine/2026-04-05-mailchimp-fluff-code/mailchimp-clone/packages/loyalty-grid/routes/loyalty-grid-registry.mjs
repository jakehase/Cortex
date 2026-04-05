import { buildLoyaltyGridSnapshot, createLoyaltyGridRouteSummary } from '../service-loyalty-grid.mjs';

export function createLoyaltyGridRegistryRoutes(basePath = '/registry/loyalty-grid') {
  const snapshot = buildLoyaltyGridSnapshot();
  return [
    { id: 'loyalty-grid.registry.summary', method: 'GET', path: basePath, summary: createLoyaltyGridRouteSummary(snapshot) },
    { id: 'loyalty-grid.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'loyalty-grid.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

