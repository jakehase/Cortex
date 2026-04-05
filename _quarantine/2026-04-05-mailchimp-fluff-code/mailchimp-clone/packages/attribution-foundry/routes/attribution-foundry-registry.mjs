import { buildAttributionFoundrySnapshot, createAttributionFoundryRouteSummary } from '../service-attribution-foundry.mjs';

export function createAttributionFoundryRegistryRoutes(basePath = '/registry/attribution-foundry') {
  const snapshot = buildAttributionFoundrySnapshot();
  return [
    { id: 'attribution-foundry.registry.summary', method: 'GET', path: basePath, summary: createAttributionFoundryRouteSummary(snapshot) },
    { id: 'attribution-foundry.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'attribution-foundry.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

