import { buildCreativeAdvisorSnapshot, createCreativeAdvisorRouteSummary } from '../service-creative-advisor.mjs';

export function createCreativeAdvisorRegistryRoutes(basePath = '/registry/creative-advisor') {
  const snapshot = buildCreativeAdvisorSnapshot();
  return [
    { id: 'creative-advisor.registry.summary', method: 'GET', path: basePath, summary: createCreativeAdvisorRouteSummary(snapshot) },
    { id: 'creative-advisor.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'creative-advisor.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

