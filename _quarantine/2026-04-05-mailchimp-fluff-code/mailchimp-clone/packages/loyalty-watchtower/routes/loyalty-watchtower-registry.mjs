import { buildLoyaltyWatchtowerSnapshot, createLoyaltyWatchtowerRouteSummary } from '../service-loyalty-watchtower.mjs';

export function createLoyaltyWatchtowerRegistryRoutes(basePath = '/registry/loyalty-watchtower') {
  const snapshot = buildLoyaltyWatchtowerSnapshot();
  return [
    { id: 'loyalty-watchtower.registry.summary', method: 'GET', path: basePath, summary: createLoyaltyWatchtowerRouteSummary(snapshot) },
    { id: 'loyalty-watchtower.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'loyalty-watchtower.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

