import { buildEcommerceWatchtowerSnapshot, createEcommerceWatchtowerRouteSummary } from '../service-ecommerce-watchtower.mjs';

export function createEcommerceWatchtowerRegistryRoutes(basePath = '/registry/ecommerce-watchtower') {
  const snapshot = buildEcommerceWatchtowerSnapshot();
  return [
    { id: 'ecommerce-watchtower.registry.summary', method: 'GET', path: basePath, summary: createEcommerceWatchtowerRouteSummary(snapshot) },
    { id: 'ecommerce-watchtower.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'ecommerce-watchtower.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

