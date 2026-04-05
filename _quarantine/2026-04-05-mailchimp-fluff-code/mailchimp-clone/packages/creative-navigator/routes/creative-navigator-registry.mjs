import { buildCreativeNavigatorSnapshot, createCreativeNavigatorRouteSummary } from '../service-creative-navigator.mjs';

export function createCreativeNavigatorRegistryRoutes(basePath = '/registry/creative-navigator') {
  const snapshot = buildCreativeNavigatorSnapshot();
  return [
    { id: 'creative-navigator.registry.summary', method: 'GET', path: basePath, summary: createCreativeNavigatorRouteSummary(snapshot) },
    { id: 'creative-navigator.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'creative-navigator.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

