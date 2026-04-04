import { buildCommerceConsoleSnapshot, createCommerceConsoleRouteSummary } from '../service-commerce-console.mjs';

export function createCommerceConsoleRegistryRoutes(basePath = '/registry/commerce-console') {
  const snapshot = buildCommerceConsoleSnapshot();
  return [
    { id: 'commerce-console.registry.summary', method: 'GET', path: basePath, summary: createCommerceConsoleRouteSummary(snapshot) },
    { id: 'commerce-console.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'commerce-console.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

