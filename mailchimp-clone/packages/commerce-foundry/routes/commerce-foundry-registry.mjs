import { buildCommerceFoundrySnapshot, createCommerceFoundryRouteSummary } from '../service-commerce-foundry.mjs';

export function createCommerceFoundryRegistryRoutes(basePath = '/registry/commerce-foundry') {
  const snapshot = buildCommerceFoundrySnapshot();
  return [
    { id: 'commerce-foundry.registry.summary', method: 'GET', path: basePath, summary: createCommerceFoundryRouteSummary(snapshot) },
    { id: 'commerce-foundry.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'commerce-foundry.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

