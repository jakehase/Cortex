import { buildBillingAtlasSnapshot, createBillingAtlasRouteSummary } from '../service-billing-atlas.mjs';

export function createBillingAtlasRegistryRoutes(basePath = '/registry/billing-atlas') {
  const snapshot = buildBillingAtlasSnapshot();
  return [
    { id: 'billing-atlas.registry.summary', method: 'GET', path: basePath, summary: createBillingAtlasRouteSummary(snapshot) },
    { id: 'billing-atlas.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'billing-atlas.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

