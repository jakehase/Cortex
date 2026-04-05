import { buildCommerceExchangeSnapshot, createCommerceExchangeRouteSummary } from '../service-commerce-exchange.mjs';

export function createCommerceExchangeRegistryRoutes(basePath = '/registry/commerce-exchange') {
  const snapshot = buildCommerceExchangeSnapshot();
  return [
    { id: 'commerce-exchange.registry.summary', method: 'GET', path: basePath, summary: createCommerceExchangeRouteSummary(snapshot) },
    { id: 'commerce-exchange.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'commerce-exchange.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

