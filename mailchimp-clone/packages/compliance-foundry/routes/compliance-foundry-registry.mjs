import { buildComplianceFoundrySnapshot, createComplianceFoundryRouteSummary } from '../service-compliance-foundry.mjs';

export function createComplianceFoundryRegistryRoutes(basePath = '/registry/compliance-foundry') {
  const snapshot = buildComplianceFoundrySnapshot();
  return [
    { id: 'compliance-foundry.registry.summary', method: 'GET', path: basePath, summary: createComplianceFoundryRouteSummary(snapshot) },
    { id: 'compliance-foundry.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'compliance-foundry.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

