import { buildComplianceGridSnapshot, createComplianceGridRouteSummary } from '../service-compliance-grid.mjs';

export function createComplianceGridRegistryRoutes(basePath = '/registry/compliance-grid') {
  const snapshot = buildComplianceGridSnapshot();
  return [
    { id: 'compliance-grid.registry.summary', method: 'GET', path: basePath, summary: createComplianceGridRouteSummary(snapshot) },
    { id: 'compliance-grid.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'compliance-grid.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

