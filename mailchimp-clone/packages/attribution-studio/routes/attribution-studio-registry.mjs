import { buildAttributionStudioSnapshot, createAttributionStudioRouteSummary } from '../service-attribution-studio.mjs';

export function createAttributionStudioRegistryRoutes(basePath = '/registry/attribution-studio') {
  const snapshot = buildAttributionStudioSnapshot();
  return [
    { id: 'attribution-studio.registry.summary', method: 'GET', path: basePath, summary: createAttributionStudioRouteSummary(snapshot) },
    { id: 'attribution-studio.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'attribution-studio.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

