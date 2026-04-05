import { buildAutomationFoundrySnapshot, createAutomationFoundryRouteSummary } from '../service-automation-foundry.mjs';

export function createAutomationFoundryRegistryRoutes(basePath = '/registry/automation-foundry') {
  const snapshot = buildAutomationFoundrySnapshot();
  return [
    { id: 'automation-foundry.registry.summary', method: 'GET', path: basePath, summary: createAutomationFoundryRouteSummary(snapshot) },
    { id: 'automation-foundry.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'automation-foundry.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

