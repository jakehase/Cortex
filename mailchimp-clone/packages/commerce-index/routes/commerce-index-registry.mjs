import { buildCommerceIndexSnapshot, createCommerceIndexRouteSummary } from '../service-commerce-index.mjs';

export function createCommerceIndexRegistryRoutes(basePath = '/registry/commerce-index') {
  const snapshot = buildCommerceIndexSnapshot();
  return [
    { id: 'commerce-index.registry.summary', method: 'GET', path: basePath, summary: createCommerceIndexRouteSummary(snapshot) },
    { id: 'commerce-index.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'commerce-index.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

