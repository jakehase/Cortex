import { buildInsightsNavigatorSnapshot, createInsightsNavigatorRouteSummary } from '../service-insights-navigator.mjs';

export function createInsightsNavigatorRegistryRoutes(basePath = '/registry/insights-navigator') {
  const snapshot = buildInsightsNavigatorSnapshot();
  return [
    { id: 'insights-navigator.registry.summary', method: 'GET', path: basePath, summary: createInsightsNavigatorRouteSummary(snapshot) },
    { id: 'insights-navigator.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'insights-navigator.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

