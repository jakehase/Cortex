import { buildAdvocacyGridSnapshot, createAdvocacyGridRouteSummary } from '../service-advocacy-grid.mjs';

export function createAdvocacyGridRegistryRoutes(basePath = '/registry/advocacy-grid') {
  const snapshot = buildAdvocacyGridSnapshot();
  return [
    { id: 'advocacy-grid.registry.summary', method: 'GET', path: basePath, summary: createAdvocacyGridRouteSummary(snapshot) },
    { id: 'advocacy-grid.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'advocacy-grid.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

