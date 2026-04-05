import { buildComplianceStudioSnapshot, createComplianceStudioRouteSummary } from '../service-compliance-studio.mjs';

export function createComplianceStudioRegistryRoutes(basePath = '/registry/compliance-studio') {
  const snapshot = buildComplianceStudioSnapshot();
  return [
    { id: 'compliance-studio.registry.summary', method: 'GET', path: basePath, summary: createComplianceStudioRouteSummary(snapshot) },
    { id: 'compliance-studio.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'compliance-studio.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

