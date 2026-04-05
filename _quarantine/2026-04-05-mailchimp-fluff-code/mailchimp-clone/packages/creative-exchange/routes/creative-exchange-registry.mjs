import { buildCreativeExchangeSnapshot, createCreativeExchangeRouteSummary } from '../service-creative-exchange.mjs';

export function createCreativeExchangeRegistryRoutes(basePath = '/registry/creative-exchange') {
  const snapshot = buildCreativeExchangeSnapshot();
  return [
    { id: 'creative-exchange.registry.summary', method: 'GET', path: basePath, summary: createCreativeExchangeRouteSummary(snapshot) },
    { id: 'creative-exchange.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'creative-exchange.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

