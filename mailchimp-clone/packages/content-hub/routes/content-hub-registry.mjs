import { buildContentHubSnapshot, createContentHubRouteSummary } from '../service-content-hub.mjs';

export function createContentHubRegistryRoutes(basePath = '/registry/content-hub') {
  const snapshot = buildContentHubSnapshot();
  return [
    { id: 'content-hub.registry.summary', method: 'GET', path: basePath, summary: createContentHubRouteSummary(snapshot) },
    { id: 'content-hub.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'content-hub.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

