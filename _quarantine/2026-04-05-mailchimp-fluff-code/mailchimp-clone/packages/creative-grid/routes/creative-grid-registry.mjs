import { buildCreativeGridSnapshot, createCreativeGridRouteSummary } from '../service-creative-grid.mjs';

export function createCreativeGridRegistryRoutes(basePath = '/registry/creative-grid') {
  const snapshot = buildCreativeGridSnapshot();
  return [
    { id: 'creative-grid.registry.summary', method: 'GET', path: basePath, summary: createCreativeGridRouteSummary(snapshot) },
    { id: 'creative-grid.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'creative-grid.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

