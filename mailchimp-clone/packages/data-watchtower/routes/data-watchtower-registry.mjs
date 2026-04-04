import { buildDataWatchtowerSnapshot, createDataWatchtowerRouteSummary } from '../service-data-watchtower.mjs';

export function createDataWatchtowerRegistryRoutes(basePath = '/registry/data-watchtower') {
  const snapshot = buildDataWatchtowerSnapshot();
  return [
    { id: 'data-watchtower.registry.summary', method: 'GET', path: basePath, summary: createDataWatchtowerRouteSummary(snapshot) },
    { id: 'data-watchtower.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'data-watchtower.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

