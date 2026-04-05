import { buildEcommerceConsoleSnapshot, createEcommerceConsoleRouteSummary } from '../service-ecommerce-console.mjs';

export function createEcommerceConsoleRegistryRoutes(basePath = '/registry/ecommerce-console') {
  const snapshot = buildEcommerceConsoleSnapshot();
  return [
    { id: 'ecommerce-console.registry.summary', method: 'GET', path: basePath, summary: createEcommerceConsoleRouteSummary(snapshot) },
    { id: 'ecommerce-console.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'ecommerce-console.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

