import { buildBillingWatchtowerSnapshot, createBillingWatchtowerRouteSummary } from '../service-billing-watchtower.mjs';

export function createBillingWatchtowerRegistryRoutes(basePath = '/registry/billing-watchtower') {
  const snapshot = buildBillingWatchtowerSnapshot();
  return [
    { id: 'billing-watchtower.registry.summary', method: 'GET', path: basePath, summary: createBillingWatchtowerRouteSummary(snapshot) },
    { id: 'billing-watchtower.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'billing-watchtower.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

