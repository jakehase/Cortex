import { buildEcommerceAdvisorSnapshot, createEcommerceAdvisorRouteSummary } from '../service-ecommerce-advisor.mjs';

export function createEcommerceAdvisorRegistryRoutes(basePath = '/registry/ecommerce-advisor') {
  const snapshot = buildEcommerceAdvisorSnapshot();
  return [
    { id: 'ecommerce-advisor.registry.summary', method: 'GET', path: basePath, summary: createEcommerceAdvisorRouteSummary(snapshot) },
    { id: 'ecommerce-advisor.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'ecommerce-advisor.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

