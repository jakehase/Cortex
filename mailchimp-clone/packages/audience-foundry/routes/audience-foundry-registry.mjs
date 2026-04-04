import { buildAudienceFoundrySnapshot, createAudienceFoundryRouteSummary } from '../service-audience-foundry.mjs';

export function createAudienceFoundryRegistryRoutes(basePath = '/registry/audience-foundry') {
  const snapshot = buildAudienceFoundrySnapshot();
  return [
    { id: 'audience-foundry.registry.summary', method: 'GET', path: basePath, summary: createAudienceFoundryRouteSummary(snapshot) },
    { id: 'audience-foundry.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'audience-foundry.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

