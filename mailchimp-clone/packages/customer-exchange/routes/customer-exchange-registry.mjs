import { buildCustomerExchangeSnapshot, createCustomerExchangeRouteSummary } from '../service-customer-exchange.mjs';

export function createCustomerExchangeRegistryRoutes(basePath = '/registry/customer-exchange') {
  const snapshot = buildCustomerExchangeSnapshot();
  return [
    { id: 'customer-exchange.registry.summary', method: 'GET', path: basePath, summary: createCustomerExchangeRouteSummary(snapshot) },
    { id: 'customer-exchange.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'customer-exchange.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

