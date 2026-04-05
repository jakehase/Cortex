import { buildEcommerceIndexSnapshot, createEcommerceIndexRouteSummary } from '../service-ecommerce-index.mjs';

export function createEcommerceIndexRegistryRoutes(basePath = '/registry/ecommerce-index') {
  const snapshot = buildEcommerceIndexSnapshot();
  return [
    { id: 'ecommerce-index.registry.summary', method: 'GET', path: basePath, summary: createEcommerceIndexRouteSummary(snapshot) },
    { id: 'ecommerce-index.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'ecommerce-index.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

