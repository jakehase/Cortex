import { buildCommerceStudioSnapshot, createCommerceStudioRouteSummary } from '../service-commerce-studio.mjs';

export function createCommerceStudioRegistryRoutes(basePath = '/registry/commerce-studio') {
  const snapshot = buildCommerceStudioSnapshot();
  return [
    { id: 'commerce-studio.registry.summary', method: 'GET', path: basePath, summary: createCommerceStudioRouteSummary(snapshot) },
    { id: 'commerce-studio.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'commerce-studio.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

