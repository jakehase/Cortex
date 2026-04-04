import { buildDataExchangeSnapshot, createDataExchangeRouteSummary } from '../service-data-exchange.mjs';

export function createDataExchangeRegistryRoutes(basePath = '/registry/data-exchange') {
  const snapshot = buildDataExchangeSnapshot();
  return [
    { id: 'data-exchange.registry.summary', method: 'GET', path: basePath, summary: createDataExchangeRouteSummary(snapshot) },
    { id: 'data-exchange.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'data-exchange.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

