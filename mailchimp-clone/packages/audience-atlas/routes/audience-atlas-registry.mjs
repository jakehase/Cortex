import { buildAudienceAtlasSnapshot, createAudienceAtlasRouteSummary } from '../service-audience-atlas.mjs';

export function createAudienceAtlasRegistryRoutes(basePath = '/registry/audience-atlas') {
  const snapshot = buildAudienceAtlasSnapshot();
  return [
    { id: 'audience-atlas.registry.summary', method: 'GET', path: basePath, summary: createAudienceAtlasRouteSummary(snapshot) },
    { id: 'audience-atlas.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'audience-atlas.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

