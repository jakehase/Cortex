import { buildInsightsHubSnapshot, createInsightsHubRouteSummary } from '../service-insights-hub.mjs';

export function createInsightsHubRegistryRoutes(basePath = '/registry/insights-hub') {
  const snapshot = buildInsightsHubSnapshot();
  return [
    { id: 'insights-hub.registry.summary', method: 'GET', path: basePath, summary: createInsightsHubRouteSummary(snapshot) },
    { id: 'insights-hub.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'insights-hub.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

