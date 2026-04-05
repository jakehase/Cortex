import { buildDeliverabilityExchangeSnapshot, createDeliverabilityExchangeRouteSummary } from '../service-deliverability-exchange.mjs';

export function createDeliverabilityExchangeRegistryRoutes(basePath = '/registry/deliverability-exchange') {
  const snapshot = buildDeliverabilityExchangeSnapshot();
  return [
    { id: 'deliverability-exchange.registry.summary', method: 'GET', path: basePath, summary: createDeliverabilityExchangeRouteSummary(snapshot) },
    { id: 'deliverability-exchange.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'deliverability-exchange.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

