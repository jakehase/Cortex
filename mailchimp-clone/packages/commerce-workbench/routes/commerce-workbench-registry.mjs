import { buildCommerceWorkbenchSnapshot, createCommerceWorkbenchRouteSummary } from '../service-commerce-workbench.mjs';

export function createCommerceWorkbenchRegistryRoutes(basePath = '/registry/commerce-workbench') {
  const snapshot = buildCommerceWorkbenchSnapshot();
  return [
    { id: 'commerce-workbench.registry.summary', method: 'GET', path: basePath, summary: createCommerceWorkbenchRouteSummary(snapshot) },
    { id: 'commerce-workbench.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'commerce-workbench.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

