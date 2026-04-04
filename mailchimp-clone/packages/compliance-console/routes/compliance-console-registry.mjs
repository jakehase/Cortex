import { buildComplianceConsoleSnapshot, createComplianceConsoleRouteSummary } from '../service-compliance-console.mjs';

export function createComplianceConsoleRegistryRoutes(basePath = '/registry/compliance-console') {
  const snapshot = buildComplianceConsoleSnapshot();
  return [
    { id: 'compliance-console.registry.summary', method: 'GET', path: basePath, summary: createComplianceConsoleRouteSummary(snapshot) },
    { id: 'compliance-console.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'compliance-console.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

