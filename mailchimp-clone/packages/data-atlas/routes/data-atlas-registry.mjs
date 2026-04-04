import { buildDataAtlasSnapshot, createDataAtlasRouteSummary } from '../service-data-atlas.mjs';

export function createDataAtlasRegistryRoutes(basePath = '/registry/data-atlas') {
  const snapshot = buildDataAtlasSnapshot();
  return [
    { id: 'data-atlas.registry.summary', method: 'GET', path: basePath, summary: createDataAtlasRouteSummary(snapshot) },
    { id: 'data-atlas.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'data-atlas.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

