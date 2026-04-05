import { buildAdvocacyWatchtowerSnapshot, createAdvocacyWatchtowerRouteSummary } from '../service-advocacy-watchtower.mjs';

export function createAdvocacyWatchtowerRegistryRoutes(basePath = '/registry/advocacy-watchtower') {
  const snapshot = buildAdvocacyWatchtowerSnapshot();
  return [
    { id: 'advocacy-watchtower.registry.summary', method: 'GET', path: basePath, summary: createAdvocacyWatchtowerRouteSummary(snapshot) },
    { id: 'advocacy-watchtower.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'advocacy-watchtower.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

