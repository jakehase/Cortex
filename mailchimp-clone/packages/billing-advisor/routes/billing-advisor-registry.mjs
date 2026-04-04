import { buildBillingAdvisorSnapshot, createBillingAdvisorRouteSummary } from '../service-billing-advisor.mjs';

export function createBillingAdvisorRegistryRoutes(basePath = '/registry/billing-advisor') {
  const snapshot = buildBillingAdvisorSnapshot();
  return [
    { id: 'billing-advisor.registry.summary', method: 'GET', path: basePath, summary: createBillingAdvisorRouteSummary(snapshot) },
    { id: 'billing-advisor.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'billing-advisor.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

