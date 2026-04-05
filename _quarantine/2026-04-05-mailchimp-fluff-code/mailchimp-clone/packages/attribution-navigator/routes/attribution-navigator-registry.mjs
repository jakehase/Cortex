import { buildAttributionNavigatorSnapshot, createAttributionNavigatorRouteSummary } from '../service-attribution-navigator.mjs';

export function createAttributionNavigatorRegistryRoutes(basePath = '/registry/attribution-navigator') {
  const snapshot = buildAttributionNavigatorSnapshot();
  return [
    { id: 'attribution-navigator.registry.summary', method: 'GET', path: basePath, summary: createAttributionNavigatorRouteSummary(snapshot) },
    { id: 'attribution-navigator.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'attribution-navigator.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

