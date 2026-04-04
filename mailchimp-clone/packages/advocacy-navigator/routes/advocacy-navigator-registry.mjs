import { buildAdvocacyNavigatorSnapshot, createAdvocacyNavigatorRouteSummary } from '../service-advocacy-navigator.mjs';

export function createAdvocacyNavigatorRegistryRoutes(basePath = '/registry/advocacy-navigator') {
  const snapshot = buildAdvocacyNavigatorSnapshot();
  return [
    { id: 'advocacy-navigator.registry.summary', method: 'GET', path: basePath, summary: createAdvocacyNavigatorRouteSummary(snapshot) },
    { id: 'advocacy-navigator.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'advocacy-navigator.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

