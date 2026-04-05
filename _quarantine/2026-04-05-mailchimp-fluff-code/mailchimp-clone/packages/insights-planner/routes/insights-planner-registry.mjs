import { buildInsightsPlannerSnapshot, createInsightsPlannerRouteSummary } from '../service-insights-planner.mjs';

export function createInsightsPlannerRegistryRoutes(basePath = '/registry/insights-planner') {
  const snapshot = buildInsightsPlannerSnapshot();
  return [
    { id: 'insights-planner.registry.summary', method: 'GET', path: basePath, summary: createInsightsPlannerRouteSummary(snapshot) },
    { id: 'insights-planner.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'insights-planner.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

