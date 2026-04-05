import { buildAudienceIndexSnapshot, createAudienceIndexRouteSummary } from '../service-audience-index.mjs';

export function createAudienceIndexRegistryRoutes(basePath = '/registry/audience-index') {
  const snapshot = buildAudienceIndexSnapshot();
  return [
    { id: 'audience-index.registry.summary', method: 'GET', path: basePath, summary: createAudienceIndexRouteSummary(snapshot) },
    { id: 'audience-index.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'audience-index.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

