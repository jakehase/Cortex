import { buildAnalyticsIndexSnapshot, createAnalyticsIndexRouteSummary } from '../service-analytics-index.mjs';

export function createAnalyticsIndexRegistryRoutes(basePath = '/registry/analytics-index') {
  const snapshot = buildAnalyticsIndexSnapshot();
  return [
    { id: 'analytics-index.registry.summary', method: 'GET', path: basePath, summary: createAnalyticsIndexRouteSummary(snapshot) },
    { id: 'analytics-index.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'analytics-index.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

