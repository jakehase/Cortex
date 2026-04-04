import { buildAcquisitionPlannerSnapshot, createAcquisitionPlannerRouteSummary } from '../service-acquisition-planner.mjs';

export function createAcquisitionPlannerRegistryRoutes(basePath = '/registry/acquisition-planner') {
  const snapshot = buildAcquisitionPlannerSnapshot();
  return [
    { id: 'acquisition-planner.registry.summary', method: 'GET', path: basePath, summary: createAcquisitionPlannerRouteSummary(snapshot) },
    { id: 'acquisition-planner.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'acquisition-planner.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

