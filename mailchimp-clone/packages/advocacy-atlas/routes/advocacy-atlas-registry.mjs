import { buildAdvocacyAtlasSnapshot, createAdvocacyAtlasRouteSummary } from '../service-advocacy-atlas.mjs';

export function createAdvocacyAtlasRegistryRoutes(basePath = '/registry/advocacy-atlas') {
  const snapshot = buildAdvocacyAtlasSnapshot();
  return [
    { id: 'advocacy-atlas.registry.summary', method: 'GET', path: basePath, summary: createAdvocacyAtlasRouteSummary(snapshot) },
    { id: 'advocacy-atlas.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'advocacy-atlas.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

