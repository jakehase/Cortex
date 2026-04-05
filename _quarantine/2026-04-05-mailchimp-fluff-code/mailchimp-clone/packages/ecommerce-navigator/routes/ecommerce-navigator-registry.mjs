import { buildEcommerceNavigatorSnapshot, createEcommerceNavigatorRouteSummary } from '../service-ecommerce-navigator.mjs';

export function createEcommerceNavigatorRegistryRoutes(basePath = '/registry/ecommerce-navigator') {
  const snapshot = buildEcommerceNavigatorSnapshot();
  return [
    { id: 'ecommerce-navigator.registry.summary', method: 'GET', path: basePath, summary: createEcommerceNavigatorRouteSummary(snapshot) },
    { id: 'ecommerce-navigator.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'ecommerce-navigator.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

