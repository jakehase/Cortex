import { buildAttributionIndexSnapshot, createAttributionIndexRouteSummary } from '../service-attribution-index.mjs';

export function createAttributionIndexRegistryRoutes(basePath = '/registry/attribution-index') {
  const snapshot = buildAttributionIndexSnapshot();
  return [
    { id: 'attribution-index.registry.summary', method: 'GET', path: basePath, summary: createAttributionIndexRouteSummary(snapshot) },
    { id: 'attribution-index.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'attribution-index.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

