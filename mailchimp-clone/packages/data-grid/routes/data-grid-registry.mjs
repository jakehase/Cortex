import { buildDataGridSnapshot, createDataGridRouteSummary } from '../service-data-grid.mjs';

export function createDataGridRegistryRoutes(basePath = '/registry/data-grid') {
  const snapshot = buildDataGridSnapshot();
  return [
    { id: 'data-grid.registry.summary', method: 'GET', path: basePath, summary: createDataGridRouteSummary(snapshot) },
    { id: 'data-grid.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'data-grid.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

