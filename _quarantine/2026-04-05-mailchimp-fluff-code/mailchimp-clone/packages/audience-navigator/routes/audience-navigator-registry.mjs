import { buildAudienceNavigatorSnapshot, createAudienceNavigatorRouteSummary } from '../service-audience-navigator.mjs';

export function createAudienceNavigatorRegistryRoutes(basePath = '/registry/audience-navigator') {
  const snapshot = buildAudienceNavigatorSnapshot();
  return [
    { id: 'audience-navigator.registry.summary', method: 'GET', path: basePath, summary: createAudienceNavigatorRouteSummary(snapshot) },
    { id: 'audience-navigator.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'audience-navigator.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

