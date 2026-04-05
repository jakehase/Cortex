import { buildInsightsGridSnapshot, createInsightsGridRouteSummary } from '../service-insights-grid.mjs';

export function createInsightsGridRegistryRoutes(basePath = '/registry/insights-grid') {
  const snapshot = buildInsightsGridSnapshot();
  return [
    { id: 'insights-grid.registry.summary', method: 'GET', path: basePath, summary: createInsightsGridRouteSummary(snapshot) },
    { id: 'insights-grid.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'insights-grid.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

