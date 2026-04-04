import { buildAttributionWatchtowerSnapshot, createAttributionWatchtowerRouteSummary } from '../service-attribution-watchtower.mjs';

export function createAttributionWatchtowerRegistryRoutes(basePath = '/registry/attribution-watchtower') {
  const snapshot = buildAttributionWatchtowerSnapshot();
  return [
    { id: 'attribution-watchtower.registry.summary', method: 'GET', path: basePath, summary: createAttributionWatchtowerRouteSummary(snapshot) },
    { id: 'attribution-watchtower.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'attribution-watchtower.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

