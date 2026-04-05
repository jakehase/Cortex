import { buildBillingNavigatorSnapshot, createBillingNavigatorRouteSummary } from '../service-billing-navigator.mjs';

export function createBillingNavigatorRegistryRoutes(basePath = '/registry/billing-navigator') {
  const snapshot = buildBillingNavigatorSnapshot();
  return [
    { id: 'billing-navigator.registry.summary', method: 'GET', path: basePath, summary: createBillingNavigatorRouteSummary(snapshot) },
    { id: 'billing-navigator.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'billing-navigator.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

