import { buildAudienceStudioSnapshot, createAudienceStudioRouteSummary } from '../service-audience-studio.mjs';

export function createAudienceStudioRegistryRoutes(basePath = '/registry/audience-studio') {
  const snapshot = buildAudienceStudioSnapshot();
  return [
    { id: 'audience-studio.registry.summary', method: 'GET', path: basePath, summary: createAudienceStudioRouteSummary(snapshot) },
    { id: 'audience-studio.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'audience-studio.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

