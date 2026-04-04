import { buildCustomerAdvisorSnapshot, createCustomerAdvisorRouteSummary } from '../service-customer-advisor.mjs';

export function createCustomerAdvisorRegistryRoutes(basePath = '/registry/customer-advisor') {
  const snapshot = buildCustomerAdvisorSnapshot();
  return [
    { id: 'customer-advisor.registry.summary', method: 'GET', path: basePath, summary: createCustomerAdvisorRouteSummary(snapshot) },
    { id: 'customer-advisor.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'customer-advisor.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

