import { buildLoyaltyHubSnapshot, createLoyaltyHubRouteSummary } from '../service-loyalty-hub.mjs';

export function createLoyaltyHubRegistryRoutes(basePath = '/registry/loyalty-hub') {
  const snapshot = buildLoyaltyHubSnapshot();
  return [
    { id: 'loyalty-hub.registry.summary', method: 'GET', path: basePath, summary: createLoyaltyHubRouteSummary(snapshot) },
    { id: 'loyalty-hub.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'loyalty-hub.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

