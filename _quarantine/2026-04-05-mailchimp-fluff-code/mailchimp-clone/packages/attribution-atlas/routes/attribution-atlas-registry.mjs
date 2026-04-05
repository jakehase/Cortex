import { buildAttributionAtlasSnapshot, createAttributionAtlasRouteSummary } from '../service-attribution-atlas.mjs';

export function createAttributionAtlasRegistryRoutes(basePath = '/registry/attribution-atlas') {
  const snapshot = buildAttributionAtlasSnapshot();
  return [
    { id: 'attribution-atlas.registry.summary', method: 'GET', path: basePath, summary: createAttributionAtlasRouteSummary(snapshot) },
    { id: 'attribution-atlas.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'attribution-atlas.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

