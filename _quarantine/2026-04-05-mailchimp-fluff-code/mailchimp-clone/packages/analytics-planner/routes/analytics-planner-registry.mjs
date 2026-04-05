import { buildAnalyticsPlannerSnapshot, createAnalyticsPlannerRouteSummary } from '../service-analytics-planner.mjs';

export function createAnalyticsPlannerRegistryRoutes(basePath = '/registry/analytics-planner') {
  const snapshot = buildAnalyticsPlannerSnapshot();
  return [
    { id: 'analytics-planner.registry.summary', method: 'GET', path: basePath, summary: createAnalyticsPlannerRouteSummary(snapshot) },
    { id: 'analytics-planner.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'analytics-planner.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

