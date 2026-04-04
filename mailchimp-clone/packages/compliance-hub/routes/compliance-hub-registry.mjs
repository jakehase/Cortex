import { buildComplianceHubSnapshot, createComplianceHubRouteSummary } from '../service-compliance-hub.mjs';

export function createComplianceHubRegistryRoutes(basePath = '/registry/compliance-hub') {
  const snapshot = buildComplianceHubSnapshot();
  return [
    { id: 'compliance-hub.registry.summary', method: 'GET', path: basePath, summary: createComplianceHubRouteSummary(snapshot) },
    { id: 'compliance-hub.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'compliance-hub.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

