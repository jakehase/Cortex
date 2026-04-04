import { buildCreativeWatchtowerSnapshot, createCreativeWatchtowerRouteSummary } from '../service-creative-watchtower.mjs';

export function createCreativeWatchtowerRegistryRoutes(basePath = '/registry/creative-watchtower') {
  const snapshot = buildCreativeWatchtowerSnapshot();
  return [
    { id: 'creative-watchtower.registry.summary', method: 'GET', path: basePath, summary: createCreativeWatchtowerRouteSummary(snapshot) },
    { id: 'creative-watchtower.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'creative-watchtower.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

