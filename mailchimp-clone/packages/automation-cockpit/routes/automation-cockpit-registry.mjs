import { buildAutomationCockpitSnapshot, createAutomationCockpitRouteSummary } from '../service-automation-cockpit.mjs';

export function createAutomationCockpitRegistryRoutes(basePath = '/registry/automation-cockpit') {
  const snapshot = buildAutomationCockpitSnapshot();
  return [
    { id: 'automation-cockpit.registry.summary', method: 'GET', path: basePath, summary: createAutomationCockpitRouteSummary(snapshot) },
    { id: 'automation-cockpit.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'automation-cockpit.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

