import { buildAnalyticsGridSnapshot, createAnalyticsGridRouteSummary } from '../service-analytics-grid.mjs';

export function createAnalyticsGridRegistryRoutes(basePath = '/registry/analytics-grid') {
  const snapshot = buildAnalyticsGridSnapshot();
  return [
    { id: 'analytics-grid.registry.summary', method: 'GET', path: basePath, summary: createAnalyticsGridRouteSummary(snapshot) },
    { id: 'analytics-grid.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'analytics-grid.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

