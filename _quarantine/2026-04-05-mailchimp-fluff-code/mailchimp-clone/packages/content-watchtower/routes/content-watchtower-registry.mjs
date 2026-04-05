import { buildContentWatchtowerSnapshot, createContentWatchtowerRouteSummary } from '../service-content-watchtower.mjs';

export function createContentWatchtowerRegistryRoutes(basePath = '/registry/content-watchtower') {
  const snapshot = buildContentWatchtowerSnapshot();
  return [
    { id: 'content-watchtower.registry.summary', method: 'GET', path: basePath, summary: createContentWatchtowerRouteSummary(snapshot) },
    { id: 'content-watchtower.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'content-watchtower.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

