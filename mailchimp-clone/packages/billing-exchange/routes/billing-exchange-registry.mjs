import { buildBillingExchangeSnapshot, createBillingExchangeRouteSummary } from '../service-billing-exchange.mjs';

export function createBillingExchangeRegistryRoutes(basePath = '/registry/billing-exchange') {
  const snapshot = buildBillingExchangeSnapshot();
  return [
    { id: 'billing-exchange.registry.summary', method: 'GET', path: basePath, summary: createBillingExchangeRouteSummary(snapshot) },
    { id: 'billing-exchange.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'billing-exchange.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

