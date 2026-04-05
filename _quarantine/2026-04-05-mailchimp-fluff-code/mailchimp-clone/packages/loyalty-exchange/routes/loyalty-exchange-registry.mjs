import { buildLoyaltyExchangeSnapshot, createLoyaltyExchangeRouteSummary } from '../service-loyalty-exchange.mjs';

export function createLoyaltyExchangeRegistryRoutes(basePath = '/registry/loyalty-exchange') {
  const snapshot = buildLoyaltyExchangeSnapshot();
  return [
    { id: 'loyalty-exchange.registry.summary', method: 'GET', path: basePath, summary: createLoyaltyExchangeRouteSummary(snapshot) },
    { id: 'loyalty-exchange.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'loyalty-exchange.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

