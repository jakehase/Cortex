import { buildDataNavigatorSnapshot, createDataNavigatorRouteSummary } from '../service-data-navigator.mjs';

export function createDataNavigatorRegistryRoutes(basePath = '/registry/data-navigator') {
  const snapshot = buildDataNavigatorSnapshot();
  return [
    { id: 'data-navigator.registry.summary', method: 'GET', path: basePath, summary: createDataNavigatorRouteSummary(snapshot) },
    { id: 'data-navigator.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'data-navigator.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

