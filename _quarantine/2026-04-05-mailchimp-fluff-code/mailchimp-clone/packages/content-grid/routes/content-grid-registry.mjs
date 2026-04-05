import { buildContentGridSnapshot, createContentGridRouteSummary } from '../service-content-grid.mjs';

export function createContentGridRegistryRoutes(basePath = '/registry/content-grid') {
  const snapshot = buildContentGridSnapshot();
  return [
    { id: 'content-grid.registry.summary', method: 'GET', path: basePath, summary: createContentGridRouteSummary(snapshot) },
    { id: 'content-grid.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'content-grid.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

