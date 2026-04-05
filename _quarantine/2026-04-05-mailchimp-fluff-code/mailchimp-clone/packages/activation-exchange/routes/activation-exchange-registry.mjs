import { buildActivationExchangeSnapshot, createActivationExchangeRouteSummary } from '../service-activation-exchange.mjs';

export function createActivationExchangeRegistryRoutes(basePath = '/registry/activation-exchange') {
  const snapshot = buildActivationExchangeSnapshot();
  return [
    { id: 'activation-exchange.registry.summary', method: 'GET', path: basePath, summary: createActivationExchangeRouteSummary(snapshot) },
    { id: 'activation-exchange.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'activation-exchange.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

