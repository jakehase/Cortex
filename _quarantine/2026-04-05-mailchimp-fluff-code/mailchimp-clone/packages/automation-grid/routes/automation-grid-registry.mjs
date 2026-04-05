import { buildAutomationGridSnapshot, createAutomationGridRouteSummary } from '../service-automation-grid.mjs';

export function createAutomationGridRegistryRoutes(basePath = '/registry/automation-grid') {
  const snapshot = buildAutomationGridSnapshot();
  return [
    { id: 'automation-grid.registry.summary', method: 'GET', path: basePath, summary: createAutomationGridRouteSummary(snapshot) },
    { id: 'automation-grid.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'automation-grid.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

