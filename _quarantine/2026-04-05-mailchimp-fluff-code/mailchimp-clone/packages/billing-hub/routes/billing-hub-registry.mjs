import { buildBillingHubSnapshot, createBillingHubRouteSummary } from '../service-billing-hub.mjs';

export function createBillingHubRegistryRoutes(basePath = '/registry/billing-hub') {
  const snapshot = buildBillingHubSnapshot();
  return [
    { id: 'billing-hub.registry.summary', method: 'GET', path: basePath, summary: createBillingHubRouteSummary(snapshot) },
    { id: 'billing-hub.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'billing-hub.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

