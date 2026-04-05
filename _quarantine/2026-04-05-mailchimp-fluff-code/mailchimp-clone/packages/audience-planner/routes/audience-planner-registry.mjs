import { buildAudiencePlannerSnapshot, createAudiencePlannerRouteSummary } from '../service-audience-planner.mjs';

export function createAudiencePlannerRegistryRoutes(basePath = '/registry/audience-planner') {
  const snapshot = buildAudiencePlannerSnapshot();
  return [
    { id: 'audience-planner.registry.summary', method: 'GET', path: basePath, summary: createAudiencePlannerRouteSummary(snapshot) },
    { id: 'audience-planner.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'audience-planner.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

