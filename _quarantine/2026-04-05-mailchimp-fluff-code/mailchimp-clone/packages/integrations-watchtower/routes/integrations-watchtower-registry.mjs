import { buildIntegrationsWatchtowerSnapshot, createIntegrationsWatchtowerRouteSummary } from '../service-integrations-watchtower.mjs';

export function createIntegrationsWatchtowerRegistryRoutes(basePath = '/registry/integrations-watchtower') {
  const snapshot = buildIntegrationsWatchtowerSnapshot();
  return [
    { id: 'integrations-watchtower.registry.summary', method: 'GET', path: basePath, summary: createIntegrationsWatchtowerRouteSummary(snapshot) },
    { id: 'integrations-watchtower.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'integrations-watchtower.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

