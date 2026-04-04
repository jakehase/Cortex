import { buildEcommerceGridSnapshot, createEcommerceGridRouteSummary } from '../service-ecommerce-grid.mjs';

export function createEcommerceGridRegistryRoutes(basePath = '/registry/ecommerce-grid') {
  const snapshot = buildEcommerceGridSnapshot();
  return [
    { id: 'ecommerce-grid.registry.summary', method: 'GET', path: basePath, summary: createEcommerceGridRouteSummary(snapshot) },
    { id: 'ecommerce-grid.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'ecommerce-grid.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

