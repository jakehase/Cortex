import { buildCustomerScorecardSnapshot, createCustomerScorecardRouteSummary } from '../service-customer-scorecard.mjs';

export function createCustomerScorecardRegistryRoutes(basePath = '/registry/customer-scorecard') {
  const snapshot = buildCustomerScorecardSnapshot();
  return [
    { id: 'customer-scorecard.registry.summary', method: 'GET', path: basePath, summary: createCustomerScorecardRouteSummary(snapshot) },
    { id: 'customer-scorecard.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'customer-scorecard.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

