import { buildAudienceHubSnapshot, createAudienceHubRouteSummary } from '../service-audience-hub.mjs';

export function createAudienceHubRegistryRoutes(basePath = '/registry/audience-hub') {
  const snapshot = buildAudienceHubSnapshot();
  return [
    { id: 'audience-hub.registry.summary', method: 'GET', path: basePath, summary: createAudienceHubRouteSummary(snapshot) },
    { id: 'audience-hub.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'audience-hub.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

