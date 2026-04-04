import { buildLifecycleExchangeSnapshot, createLifecycleExchangeRouteSummary } from '../service-lifecycle-exchange.mjs';

export function createLifecycleExchangeRegistryRoutes(basePath = '/registry/lifecycle-exchange') {
  const snapshot = buildLifecycleExchangeSnapshot();
  return [
    { id: 'lifecycle-exchange.registry.summary', method: 'GET', path: basePath, summary: createLifecycleExchangeRouteSummary(snapshot) },
    { id: 'lifecycle-exchange.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'lifecycle-exchange.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

