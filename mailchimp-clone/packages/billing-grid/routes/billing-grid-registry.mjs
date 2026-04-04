import { buildBillingGridSnapshot, createBillingGridRouteSummary } from '../service-billing-grid.mjs';

export function createBillingGridRegistryRoutes(basePath = '/registry/billing-grid') {
  const snapshot = buildBillingGridSnapshot();
  return [
    { id: 'billing-grid.registry.summary', method: 'GET', path: basePath, summary: createBillingGridRouteSummary(snapshot) },
    { id: 'billing-grid.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'billing-grid.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

