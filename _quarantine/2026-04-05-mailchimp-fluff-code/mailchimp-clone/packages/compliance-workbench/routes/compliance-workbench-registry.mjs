import { buildComplianceWorkbenchSnapshot, createComplianceWorkbenchRouteSummary } from '../service-compliance-workbench.mjs';

export function createComplianceWorkbenchRegistryRoutes(basePath = '/registry/compliance-workbench') {
  const snapshot = buildComplianceWorkbenchSnapshot();
  return [
    { id: 'compliance-workbench.registry.summary', method: 'GET', path: basePath, summary: createComplianceWorkbenchRouteSummary(snapshot) },
    { id: 'compliance-workbench.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'compliance-workbench.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

