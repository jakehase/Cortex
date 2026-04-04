import { buildBillingStudioSnapshot, createBillingStudioRouteSummary } from '../service-billing-studio.mjs';

export function createBillingStudioRegistryRoutes(basePath = '/registry/billing-studio') {
  const snapshot = buildBillingStudioSnapshot();
  return [
    { id: 'billing-studio.registry.summary', method: 'GET', path: basePath, summary: createBillingStudioRouteSummary(snapshot) },
    { id: 'billing-studio.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'billing-studio.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

