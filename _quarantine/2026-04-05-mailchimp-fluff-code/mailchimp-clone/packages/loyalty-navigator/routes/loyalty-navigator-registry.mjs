import { buildLoyaltyNavigatorSnapshot, createLoyaltyNavigatorRouteSummary } from '../service-loyalty-navigator.mjs';

export function createLoyaltyNavigatorRegistryRoutes(basePath = '/registry/loyalty-navigator') {
  const snapshot = buildLoyaltyNavigatorSnapshot();
  return [
    { id: 'loyalty-navigator.registry.summary', method: 'GET', path: basePath, summary: createLoyaltyNavigatorRouteSummary(snapshot) },
    { id: 'loyalty-navigator.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'loyalty-navigator.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

