import { buildAutomationWatchtowerSnapshot, createAutomationWatchtowerRouteSummary } from '../service-automation-watchtower.mjs';

export function createAutomationWatchtowerRegistryRoutes(basePath = '/registry/automation-watchtower') {
  const snapshot = buildAutomationWatchtowerSnapshot();
  return [
    { id: 'automation-watchtower.registry.summary', method: 'GET', path: basePath, summary: createAutomationWatchtowerRouteSummary(snapshot) },
    { id: 'automation-watchtower.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'automation-watchtower.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

