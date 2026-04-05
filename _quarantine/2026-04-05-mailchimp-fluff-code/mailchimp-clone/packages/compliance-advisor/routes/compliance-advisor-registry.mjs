import { buildComplianceAdvisorSnapshot, createComplianceAdvisorRouteSummary } from '../service-compliance-advisor.mjs';

export function createComplianceAdvisorRegistryRoutes(basePath = '/registry/compliance-advisor') {
  const snapshot = buildComplianceAdvisorSnapshot();
  return [
    { id: 'compliance-advisor.registry.summary', method: 'GET', path: basePath, summary: createComplianceAdvisorRouteSummary(snapshot) },
    { id: 'compliance-advisor.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'compliance-advisor.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

