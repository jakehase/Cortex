import { buildIntegrationsPlannerSnapshot, createIntegrationsPlannerRouteSummary } from '../service-integrations-planner.mjs';

export function createIntegrationsPlannerRegistryRoutes(basePath = '/registry/integrations-planner') {
  const snapshot = buildIntegrationsPlannerSnapshot();
  return [
    { id: 'integrations-planner.registry.summary', method: 'GET', path: basePath, summary: createIntegrationsPlannerRouteSummary(snapshot) },
    { id: 'integrations-planner.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'integrations-planner.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

