import { buildIntegrationsExchangeSnapshot, createIntegrationsExchangeRouteSummary } from '../service-integrations-exchange.mjs';

export function createIntegrationsExchangeRegistryRoutes(basePath = '/registry/integrations-exchange') {
  const snapshot = buildIntegrationsExchangeSnapshot();
  return [
    { id: 'integrations-exchange.registry.summary', method: 'GET', path: basePath, summary: createIntegrationsExchangeRouteSummary(snapshot) },
    { id: 'integrations-exchange.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'integrations-exchange.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

