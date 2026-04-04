import { buildAdvocacyExchangeSnapshot, createAdvocacyExchangeRouteSummary } from '../service-advocacy-exchange.mjs';

export function createAdvocacyExchangeRegistryRoutes(basePath = '/registry/advocacy-exchange') {
  const snapshot = buildAdvocacyExchangeSnapshot();
  return [
    { id: 'advocacy-exchange.registry.summary', method: 'GET', path: basePath, summary: createAdvocacyExchangeRouteSummary(snapshot) },
    { id: 'advocacy-exchange.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'advocacy-exchange.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

