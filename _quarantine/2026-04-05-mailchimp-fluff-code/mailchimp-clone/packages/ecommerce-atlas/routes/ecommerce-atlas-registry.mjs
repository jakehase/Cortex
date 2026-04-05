import { buildEcommerceAtlasSnapshot, createEcommerceAtlasRouteSummary } from '../service-ecommerce-atlas.mjs';

export function createEcommerceAtlasRegistryRoutes(basePath = '/registry/ecommerce-atlas') {
  const snapshot = buildEcommerceAtlasSnapshot();
  return [
    { id: 'ecommerce-atlas.registry.summary', method: 'GET', path: basePath, summary: createEcommerceAtlasRouteSummary(snapshot) },
    { id: 'ecommerce-atlas.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'ecommerce-atlas.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

