import { buildAudienceAdvisorSnapshot, createAudienceAdvisorRouteSummary } from '../service-audience-advisor.mjs';

export function createAudienceAdvisorRegistryRoutes(basePath = '/registry/audience-advisor') {
  const snapshot = buildAudienceAdvisorSnapshot();
  return [
    { id: 'audience-advisor.registry.summary', method: 'GET', path: basePath, summary: createAudienceAdvisorRouteSummary(snapshot) },
    { id: 'audience-advisor.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'audience-advisor.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

