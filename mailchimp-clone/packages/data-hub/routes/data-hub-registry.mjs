import { buildDataHubSnapshot, createDataHubRouteSummary } from '../service-data-hub.mjs';

export function createDataHubRegistryRoutes(basePath = '/registry/data-hub') {
  const snapshot = buildDataHubSnapshot();
  return [
    { id: 'data-hub.registry.summary', method: 'GET', path: basePath, summary: createDataHubRouteSummary(snapshot) },
    { id: 'data-hub.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'data-hub.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

