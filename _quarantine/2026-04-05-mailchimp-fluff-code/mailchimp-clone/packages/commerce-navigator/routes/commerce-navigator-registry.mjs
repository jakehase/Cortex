import { buildCommerceNavigatorSnapshot, createCommerceNavigatorRouteSummary } from '../service-commerce-navigator.mjs';

export function createCommerceNavigatorRegistryRoutes(basePath = '/registry/commerce-navigator') {
  const snapshot = buildCommerceNavigatorSnapshot();
  return [
    { id: 'commerce-navigator.registry.summary', method: 'GET', path: basePath, summary: createCommerceNavigatorRouteSummary(snapshot) },
    { id: 'commerce-navigator.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'commerce-navigator.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

