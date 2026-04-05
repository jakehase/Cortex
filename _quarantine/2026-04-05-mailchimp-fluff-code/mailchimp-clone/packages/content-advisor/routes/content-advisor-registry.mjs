import { buildContentAdvisorSnapshot, createContentAdvisorRouteSummary } from '../service-content-advisor.mjs';

export function createContentAdvisorRegistryRoutes(basePath = '/registry/content-advisor') {
  const snapshot = buildContentAdvisorSnapshot();
  return [
    { id: 'content-advisor.registry.summary', method: 'GET', path: basePath, summary: createContentAdvisorRouteSummary(snapshot) },
    { id: 'content-advisor.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'content-advisor.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

