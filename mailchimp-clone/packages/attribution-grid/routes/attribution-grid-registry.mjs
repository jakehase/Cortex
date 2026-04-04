import { buildAttributionGridSnapshot, createAttributionGridRouteSummary } from '../service-attribution-grid.mjs';

export function createAttributionGridRegistryRoutes(basePath = '/registry/attribution-grid') {
  const snapshot = buildAttributionGridSnapshot();
  return [
    { id: 'attribution-grid.registry.summary', method: 'GET', path: basePath, summary: createAttributionGridRouteSummary(snapshot) },
    { id: 'attribution-grid.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'attribution-grid.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

