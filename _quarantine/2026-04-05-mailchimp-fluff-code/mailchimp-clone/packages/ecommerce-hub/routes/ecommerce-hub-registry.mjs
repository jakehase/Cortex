import { buildEcommerceHubSnapshot, createEcommerceHubRouteSummary } from '../service-ecommerce-hub.mjs';

export function createEcommerceHubRegistryRoutes(basePath = '/registry/ecommerce-hub') {
  const snapshot = buildEcommerceHubSnapshot();
  return [
    { id: 'ecommerce-hub.registry.summary', method: 'GET', path: basePath, summary: createEcommerceHubRouteSummary(snapshot) },
    { id: 'ecommerce-hub.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'ecommerce-hub.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

