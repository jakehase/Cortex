import { buildCommerceHubSnapshot, createCommerceHubRouteSummary } from '../service-commerce-hub.mjs';

export function createCommerceHubRegistryRoutes(basePath = '/registry/commerce-hub') {
  const snapshot = buildCommerceHubSnapshot();
  return [
    { id: 'commerce-hub.registry.summary', method: 'GET', path: basePath, summary: createCommerceHubRouteSummary(snapshot) },
    { id: 'commerce-hub.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'commerce-hub.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

