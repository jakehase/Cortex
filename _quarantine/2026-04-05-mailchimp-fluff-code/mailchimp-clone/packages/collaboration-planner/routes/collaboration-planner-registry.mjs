import { buildCollaborationPlannerSnapshot, createCollaborationPlannerRouteSummary } from '../service-collaboration-planner.mjs';

export function createCollaborationPlannerRegistryRoutes(basePath = '/registry/collaboration-planner') {
  const snapshot = buildCollaborationPlannerSnapshot();
  return [
    { id: 'collaboration-planner.registry.summary', method: 'GET', path: basePath, summary: createCollaborationPlannerRouteSummary(snapshot) },
    { id: 'collaboration-planner.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'collaboration-planner.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

