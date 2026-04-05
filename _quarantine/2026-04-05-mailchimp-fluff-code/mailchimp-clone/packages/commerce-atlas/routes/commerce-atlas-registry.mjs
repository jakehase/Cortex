import { buildCommerceAtlasSnapshot, createCommerceAtlasRouteSummary } from '../service-commerce-atlas.mjs';

export function createCommerceAtlasRegistryRoutes(basePath = '/registry/commerce-atlas') {
  const snapshot = buildCommerceAtlasSnapshot();
  return [
    { id: 'commerce-atlas.registry.summary', method: 'GET', path: basePath, summary: createCommerceAtlasRouteSummary(snapshot) },
    { id: 'commerce-atlas.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'commerce-atlas.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

