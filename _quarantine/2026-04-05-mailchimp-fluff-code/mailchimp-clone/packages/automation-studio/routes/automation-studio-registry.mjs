import { buildAutomationStudioSnapshot, createAutomationStudioRouteSummary } from '../service-automation-studio.mjs';

export function createAutomationStudioRegistryRoutes(basePath = '/registry/automation-studio') {
  const snapshot = buildAutomationStudioSnapshot();
  return [
    { id: 'automation-studio.registry.summary', method: 'GET', path: basePath, summary: createAutomationStudioRouteSummary(snapshot) },
    { id: 'automation-studio.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'automation-studio.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

