import { buildBillingIndexSnapshot, createBillingIndexRouteSummary } from '../service-billing-index.mjs';

export function createBillingIndexRegistryRoutes(basePath = '/registry/billing-index') {
  const snapshot = buildBillingIndexSnapshot();
  return [
    { id: 'billing-index.registry.summary', method: 'GET', path: basePath, summary: createBillingIndexRouteSummary(snapshot) },
    { id: 'billing-index.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'billing-index.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

