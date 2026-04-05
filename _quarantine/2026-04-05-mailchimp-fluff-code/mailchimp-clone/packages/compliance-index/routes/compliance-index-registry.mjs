import { buildComplianceIndexSnapshot, createComplianceIndexRouteSummary } from '../service-compliance-index.mjs';

export function createComplianceIndexRegistryRoutes(basePath = '/registry/compliance-index') {
  const snapshot = buildComplianceIndexSnapshot();
  return [
    { id: 'compliance-index.registry.summary', method: 'GET', path: basePath, summary: createComplianceIndexRouteSummary(snapshot) },
    { id: 'compliance-index.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'compliance-index.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

