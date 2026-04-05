import { buildCreativeAtlasSnapshot, createCreativeAtlasRouteSummary } from '../service-creative-atlas.mjs';

export function createCreativeAtlasRegistryRoutes(basePath = '/registry/creative-atlas') {
  const snapshot = buildCreativeAtlasSnapshot();
  return [
    { id: 'creative-atlas.registry.summary', method: 'GET', path: basePath, summary: createCreativeAtlasRouteSummary(snapshot) },
    { id: 'creative-atlas.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'creative-atlas.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

