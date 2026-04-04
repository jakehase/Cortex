import { buildEcommerceExchangeSnapshot, createEcommerceExchangeRouteSummary } from '../service-ecommerce-exchange.mjs';

export function createEcommerceExchangeRegistryRoutes(basePath = '/registry/ecommerce-exchange') {
  const snapshot = buildEcommerceExchangeSnapshot();
  return [
    { id: 'ecommerce-exchange.registry.summary', method: 'GET', path: basePath, summary: createEcommerceExchangeRouteSummary(snapshot) },
    { id: 'ecommerce-exchange.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'ecommerce-exchange.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

