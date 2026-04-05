import { buildAutomationWorkbenchSnapshot, createAutomationWorkbenchRouteSummary } from '../service-automation-workbench.mjs';

export function createAutomationWorkbenchRegistryRoutes(basePath = '/registry/automation-workbench') {
  const snapshot = buildAutomationWorkbenchSnapshot();
  return [
    { id: 'automation-workbench.registry.summary', method: 'GET', path: basePath, summary: createAutomationWorkbenchRouteSummary(snapshot) },
    { id: 'automation-workbench.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'automation-workbench.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

