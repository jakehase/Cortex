import { buildIntegrationsAdvisorSnapshot, createIntegrationsAdvisorRouteSummary } from '../service-integrations-advisor.mjs';

export function createIntegrationsAdvisorRegistryRoutes(basePath = '/registry/integrations-advisor') {
  const snapshot = buildIntegrationsAdvisorSnapshot();
  return [
    { id: 'integrations-advisor.registry.summary', method: 'GET', path: basePath, summary: createIntegrationsAdvisorRouteSummary(snapshot) },
    { id: 'integrations-advisor.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'integrations-advisor.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

