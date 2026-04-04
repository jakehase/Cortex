import { buildAutomationIndexSnapshot, createAutomationIndexRouteSummary } from '../service-automation-index.mjs';

export function createAutomationIndexRegistryRoutes(basePath = '/registry/automation-index') {
  const snapshot = buildAutomationIndexSnapshot();
  return [
    { id: 'automation-index.registry.summary', method: 'GET', path: basePath, summary: createAutomationIndexRouteSummary(snapshot) },
    { id: 'automation-index.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'automation-index.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

