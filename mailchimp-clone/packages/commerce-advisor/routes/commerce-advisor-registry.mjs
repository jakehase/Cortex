import { buildCommerceAdvisorSnapshot, createCommerceAdvisorRouteSummary } from '../service-commerce-advisor.mjs';

export function createCommerceAdvisorRegistryRoutes(basePath = '/registry/commerce-advisor') {
  const snapshot = buildCommerceAdvisorSnapshot();
  return [
    { id: 'commerce-advisor.registry.summary', method: 'GET', path: basePath, summary: createCommerceAdvisorRouteSummary(snapshot) },
    { id: 'commerce-advisor.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'commerce-advisor.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

