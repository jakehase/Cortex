import { buildDataPlannerSnapshot, createDataPlannerRouteSummary } from '../service-data-planner.mjs';

export function createDataPlannerRegistryRoutes(basePath = '/registry/data-planner') {
  const snapshot = buildDataPlannerSnapshot();
  return [
    { id: 'data-planner.registry.summary', method: 'GET', path: basePath, summary: createDataPlannerRouteSummary(snapshot) },
    { id: 'data-planner.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'data-planner.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

