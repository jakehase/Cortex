import { buildAutomationAdvisorSnapshot, createAutomationAdvisorRouteSummary } from '../service-automation-advisor.mjs';

export function createAutomationAdvisorRegistryRoutes(basePath = '/registry/automation-advisor') {
  const snapshot = buildAutomationAdvisorSnapshot();
  return [
    { id: 'automation-advisor.registry.summary', method: 'GET', path: basePath, summary: createAutomationAdvisorRouteSummary(snapshot) },
    { id: 'automation-advisor.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'automation-advisor.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

