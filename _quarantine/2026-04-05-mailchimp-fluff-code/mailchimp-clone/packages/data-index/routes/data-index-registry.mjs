import { buildDataIndexSnapshot, createDataIndexRouteSummary } from '../service-data-index.mjs';

export function createDataIndexRegistryRoutes(basePath = '/registry/data-index') {
  const snapshot = buildDataIndexSnapshot();
  return [
    { id: 'data-index.registry.summary', method: 'GET', path: basePath, summary: createDataIndexRouteSummary(snapshot) },
    { id: 'data-index.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'data-index.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

