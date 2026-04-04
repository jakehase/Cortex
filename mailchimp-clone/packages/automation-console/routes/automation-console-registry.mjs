import { buildAutomationConsoleSnapshot, createAutomationConsoleRouteSummary } from '../service-automation-console.mjs';

export function createAutomationConsoleRegistryRoutes(basePath = '/registry/automation-console') {
  const snapshot = buildAutomationConsoleSnapshot();
  return [
    { id: 'automation-console.registry.summary', method: 'GET', path: basePath, summary: createAutomationConsoleRouteSummary(snapshot) },
    { id: 'automation-console.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'automation-console.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

