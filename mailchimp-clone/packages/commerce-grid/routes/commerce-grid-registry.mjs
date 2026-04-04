import { buildCommerceGridSnapshot, createCommerceGridRouteSummary } from '../service-commerce-grid.mjs';

export function createCommerceGridRegistryRoutes(basePath = '/registry/commerce-grid') {
  const snapshot = buildCommerceGridSnapshot();
  return [
    { id: 'commerce-grid.registry.summary', method: 'GET', path: basePath, summary: createCommerceGridRouteSummary(snapshot) },
    { id: 'commerce-grid.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'commerce-grid.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

