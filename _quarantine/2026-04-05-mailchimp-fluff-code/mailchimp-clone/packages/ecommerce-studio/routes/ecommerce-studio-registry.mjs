import { buildEcommerceStudioSnapshot, createEcommerceStudioRouteSummary } from '../service-ecommerce-studio.mjs';

export function createEcommerceStudioRegistryRoutes(basePath = '/registry/ecommerce-studio') {
  const snapshot = buildEcommerceStudioSnapshot();
  return [
    { id: 'ecommerce-studio.registry.summary', method: 'GET', path: basePath, summary: createEcommerceStudioRouteSummary(snapshot) },
    { id: 'ecommerce-studio.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'ecommerce-studio.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

