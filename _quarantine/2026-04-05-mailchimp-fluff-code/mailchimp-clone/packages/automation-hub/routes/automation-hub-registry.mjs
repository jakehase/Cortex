import { buildAutomationHubSnapshot, createAutomationHubRouteSummary } from '../service-automation-hub.mjs';

export function createAutomationHubRegistryRoutes(basePath = '/registry/automation-hub') {
  const snapshot = buildAutomationHubSnapshot();
  return [
    { id: 'automation-hub.registry.summary', method: 'GET', path: basePath, summary: createAutomationHubRouteSummary(snapshot) },
    { id: 'automation-hub.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'automation-hub.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

