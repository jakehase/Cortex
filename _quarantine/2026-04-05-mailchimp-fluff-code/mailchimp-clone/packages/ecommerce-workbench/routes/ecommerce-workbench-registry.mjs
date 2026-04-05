import { buildEcommerceWorkbenchSnapshot, createEcommerceWorkbenchRouteSummary } from '../service-ecommerce-workbench.mjs';

export function createEcommerceWorkbenchRegistryRoutes(basePath = '/registry/ecommerce-workbench') {
  const snapshot = buildEcommerceWorkbenchSnapshot();
  return [
    { id: 'ecommerce-workbench.registry.summary', method: 'GET', path: basePath, summary: createEcommerceWorkbenchRouteSummary(snapshot) },
    { id: 'ecommerce-workbench.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'ecommerce-workbench.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

