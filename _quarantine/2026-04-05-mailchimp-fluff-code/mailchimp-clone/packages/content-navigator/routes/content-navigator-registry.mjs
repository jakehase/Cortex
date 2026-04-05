import { buildContentNavigatorSnapshot, createContentNavigatorRouteSummary } from '../service-content-navigator.mjs';

export function createContentNavigatorRegistryRoutes(basePath = '/registry/content-navigator') {
  const snapshot = buildContentNavigatorSnapshot();
  return [
    { id: 'content-navigator.registry.summary', method: 'GET', path: basePath, summary: createContentNavigatorRouteSummary(snapshot) },
    { id: 'content-navigator.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'content-navigator.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

