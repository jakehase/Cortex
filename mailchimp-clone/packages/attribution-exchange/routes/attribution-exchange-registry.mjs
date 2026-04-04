import { buildAttributionExchangeSnapshot, createAttributionExchangeRouteSummary } from '../service-attribution-exchange.mjs';

export function createAttributionExchangeRegistryRoutes(basePath = '/registry/attribution-exchange') {
  const snapshot = buildAttributionExchangeSnapshot();
  return [
    { id: 'attribution-exchange.registry.summary', method: 'GET', path: basePath, summary: createAttributionExchangeRouteSummary(snapshot) },
    { id: 'attribution-exchange.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'attribution-exchange.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

