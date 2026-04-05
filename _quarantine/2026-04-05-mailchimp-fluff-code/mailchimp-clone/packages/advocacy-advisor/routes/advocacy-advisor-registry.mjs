import { buildAdvocacyAdvisorSnapshot, createAdvocacyAdvisorRouteSummary } from '../service-advocacy-advisor.mjs';

export function createAdvocacyAdvisorRegistryRoutes(basePath = '/registry/advocacy-advisor') {
  const snapshot = buildAdvocacyAdvisorSnapshot();
  return [
    { id: 'advocacy-advisor.registry.summary', method: 'GET', path: basePath, summary: createAdvocacyAdvisorRouteSummary(snapshot) },
    { id: 'advocacy-advisor.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'advocacy-advisor.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

