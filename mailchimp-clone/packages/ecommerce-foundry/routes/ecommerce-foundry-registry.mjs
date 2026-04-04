import { buildEcommerceFoundrySnapshot, createEcommerceFoundryRouteSummary } from '../service-ecommerce-foundry.mjs';

export function createEcommerceFoundryRegistryRoutes(basePath = '/registry/ecommerce-foundry') {
  const snapshot = buildEcommerceFoundrySnapshot();
  return [
    { id: 'ecommerce-foundry.registry.summary', method: 'GET', path: basePath, summary: createEcommerceFoundryRouteSummary(snapshot) },
    { id: 'ecommerce-foundry.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'ecommerce-foundry.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

