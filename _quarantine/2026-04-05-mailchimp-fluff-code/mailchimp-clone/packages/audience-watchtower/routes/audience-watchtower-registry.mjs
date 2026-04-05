import { buildAudienceWatchtowerSnapshot, createAudienceWatchtowerRouteSummary } from '../service-audience-watchtower.mjs';

export function createAudienceWatchtowerRegistryRoutes(basePath = '/registry/audience-watchtower') {
  const snapshot = buildAudienceWatchtowerSnapshot();
  return [
    { id: 'audience-watchtower.registry.summary', method: 'GET', path: basePath, summary: createAudienceWatchtowerRouteSummary(snapshot) },
    { id: 'audience-watchtower.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'audience-watchtower.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

