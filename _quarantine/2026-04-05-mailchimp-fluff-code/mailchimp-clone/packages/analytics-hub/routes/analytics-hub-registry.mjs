import { buildAnalyticsHubSnapshot, createAnalyticsHubRouteSummary } from '../service-analytics-hub.mjs';

export function createAnalyticsHubRegistryRoutes(basePath = '/registry/analytics-hub') {
  const snapshot = buildAnalyticsHubSnapshot();
  return [
    { id: 'analytics-hub.registry.summary', method: 'GET', path: basePath, summary: createAnalyticsHubRouteSummary(snapshot) },
    { id: 'analytics-hub.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'analytics-hub.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

