import { buildDataStudioSnapshot, createDataStudioRouteSummary } from '../service-data-studio.mjs';

export function createDataStudioRegistryRoutes(basePath = '/registry/data-studio') {
  const snapshot = buildDataStudioSnapshot();
  return [
    { id: 'data-studio.registry.summary', method: 'GET', path: basePath, summary: createDataStudioRouteSummary(snapshot) },
    { id: 'data-studio.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'data-studio.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

