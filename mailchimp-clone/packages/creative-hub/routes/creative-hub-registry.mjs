import { buildCreativeHubSnapshot, createCreativeHubRouteSummary } from '../service-creative-hub.mjs';

export function createCreativeHubRegistryRoutes(basePath = '/registry/creative-hub') {
  const snapshot = buildCreativeHubSnapshot();
  return [
    { id: 'creative-hub.registry.summary', method: 'GET', path: basePath, summary: createCreativeHubRouteSummary(snapshot) },
    { id: 'creative-hub.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'creative-hub.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

