import { buildComplianceNavigatorSnapshot, createComplianceNavigatorRouteSummary } from '../service-compliance-navigator.mjs';

export function createComplianceNavigatorRegistryRoutes(basePath = '/registry/compliance-navigator') {
  const snapshot = buildComplianceNavigatorSnapshot();
  return [
    { id: 'compliance-navigator.registry.summary', method: 'GET', path: basePath, summary: createComplianceNavigatorRouteSummary(snapshot) },
    { id: 'compliance-navigator.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'compliance-navigator.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

