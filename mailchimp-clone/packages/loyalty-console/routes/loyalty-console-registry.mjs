import { buildLoyaltyConsoleSnapshot, createLoyaltyConsoleRouteSummary } from '../service-loyalty-console.mjs';

export function createLoyaltyConsoleRegistryRoutes(basePath = '/registry/loyalty-console') {
  const snapshot = buildLoyaltyConsoleSnapshot();
  return [
    { id: 'loyalty-console.registry.summary', method: 'GET', path: basePath, summary: createLoyaltyConsoleRouteSummary(snapshot) },
    { id: 'loyalty-console.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'loyalty-console.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

