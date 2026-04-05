import { buildAutomationPlannerSnapshot, createAutomationPlannerRouteSummary } from '../service-automation-planner.mjs';

export function createAutomationPlannerRegistryRoutes(basePath = '/registry/automation-planner') {
  const snapshot = buildAutomationPlannerSnapshot();
  return [
    { id: 'automation-planner.registry.summary', method: 'GET', path: basePath, summary: createAutomationPlannerRouteSummary(snapshot) },
    { id: 'automation-planner.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'automation-planner.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

