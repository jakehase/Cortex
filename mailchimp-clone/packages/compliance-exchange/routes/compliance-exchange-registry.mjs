import { buildComplianceExchangeSnapshot, createComplianceExchangeRouteSummary } from '../service-compliance-exchange.mjs';

export function createComplianceExchangeRegistryRoutes(basePath = '/registry/compliance-exchange') {
  const snapshot = buildComplianceExchangeSnapshot();
  return [
    { id: 'compliance-exchange.registry.summary', method: 'GET', path: basePath, summary: createComplianceExchangeRouteSummary(snapshot) },
    { id: 'compliance-exchange.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'compliance-exchange.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

