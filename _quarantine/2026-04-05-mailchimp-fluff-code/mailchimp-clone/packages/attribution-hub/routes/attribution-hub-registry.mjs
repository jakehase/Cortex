import { buildAttributionHubSnapshot, createAttributionHubRouteSummary } from '../service-attribution-hub.mjs';

export function createAttributionHubRegistryRoutes(basePath = '/registry/attribution-hub') {
  const snapshot = buildAttributionHubSnapshot();
  return [
    { id: 'attribution-hub.registry.summary', method: 'GET', path: basePath, summary: createAttributionHubRouteSummary(snapshot) },
    { id: 'attribution-hub.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'attribution-hub.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

