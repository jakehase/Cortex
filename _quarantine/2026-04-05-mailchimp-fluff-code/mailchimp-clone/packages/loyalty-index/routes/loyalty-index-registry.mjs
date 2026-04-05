import { buildLoyaltyIndexSnapshot, createLoyaltyIndexRouteSummary } from '../service-loyalty-index.mjs';

export function createLoyaltyIndexRegistryRoutes(basePath = '/registry/loyalty-index') {
  const snapshot = buildLoyaltyIndexSnapshot();
  return [
    { id: 'loyalty-index.registry.summary', method: 'GET', path: basePath, summary: createLoyaltyIndexRouteSummary(snapshot) },
    { id: 'loyalty-index.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'loyalty-index.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

