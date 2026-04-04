import { buildAutomationNavigatorSnapshot, createAutomationNavigatorRouteSummary } from '../service-automation-navigator.mjs';

export function createAutomationNavigatorRegistryRoutes(basePath = '/registry/automation-navigator') {
  const snapshot = buildAutomationNavigatorSnapshot();
  return [
    { id: 'automation-navigator.registry.summary', method: 'GET', path: basePath, summary: createAutomationNavigatorRouteSummary(snapshot) },
    { id: 'automation-navigator.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'automation-navigator.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

