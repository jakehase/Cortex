import { buildCommerceWatchtowerSnapshot, createCommerceWatchtowerRouteSummary } from '../service-commerce-watchtower.mjs';

export function createCommerceWatchtowerRegistryRoutes(basePath = '/registry/commerce-watchtower') {
  const snapshot = buildCommerceWatchtowerSnapshot();
  return [
    { id: 'commerce-watchtower.registry.summary', method: 'GET', path: basePath, summary: createCommerceWatchtowerRouteSummary(snapshot) },
    { id: 'commerce-watchtower.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'commerce-watchtower.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

