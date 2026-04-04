import { buildContentAtlasSnapshot, createContentAtlasRouteSummary } from '../service-content-atlas.mjs';

export function createContentAtlasRegistryRoutes(basePath = '/registry/content-atlas') {
  const snapshot = buildContentAtlasSnapshot();
  return [
    { id: 'content-atlas.registry.summary', method: 'GET', path: basePath, summary: createContentAtlasRouteSummary(snapshot) },
    { id: 'content-atlas.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'content-atlas.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

