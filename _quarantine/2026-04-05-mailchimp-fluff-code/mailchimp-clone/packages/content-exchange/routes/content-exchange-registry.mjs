import { buildContentExchangeSnapshot, createContentExchangeRouteSummary } from '../service-content-exchange.mjs';

export function createContentExchangeRegistryRoutes(basePath = '/registry/content-exchange') {
  const snapshot = buildContentExchangeSnapshot();
  return [
    { id: 'content-exchange.registry.summary', method: 'GET', path: basePath, summary: createContentExchangeRouteSummary(snapshot) },
    { id: 'content-exchange.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'content-exchange.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

