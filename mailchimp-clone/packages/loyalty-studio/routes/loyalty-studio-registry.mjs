import { buildLoyaltyStudioSnapshot, createLoyaltyStudioRouteSummary } from '../service-loyalty-studio.mjs';

export function createLoyaltyStudioRegistryRoutes(basePath = '/registry/loyalty-studio') {
  const snapshot = buildLoyaltyStudioSnapshot();
  return [
    { id: 'loyalty-studio.registry.summary', method: 'GET', path: basePath, summary: createLoyaltyStudioRouteSummary(snapshot) },
    { id: 'loyalty-studio.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'loyalty-studio.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

