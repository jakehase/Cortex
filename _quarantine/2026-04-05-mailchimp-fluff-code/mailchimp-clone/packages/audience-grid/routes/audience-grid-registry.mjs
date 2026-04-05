import { buildAudienceGridSnapshot, createAudienceGridRouteSummary } from '../service-audience-grid.mjs';

export function createAudienceGridRegistryRoutes(basePath = '/registry/audience-grid') {
  const snapshot = buildAudienceGridSnapshot();
  return [
    { id: 'audience-grid.registry.summary', method: 'GET', path: basePath, summary: createAudienceGridRouteSummary(snapshot) },
    { id: 'audience-grid.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'audience-grid.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

