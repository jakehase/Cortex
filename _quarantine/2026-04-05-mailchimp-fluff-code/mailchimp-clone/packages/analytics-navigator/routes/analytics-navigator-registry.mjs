import { buildAnalyticsNavigatorSnapshot, createAnalyticsNavigatorRouteSummary } from '../service-analytics-navigator.mjs';

export function createAnalyticsNavigatorRegistryRoutes(basePath = '/registry/analytics-navigator') {
  const snapshot = buildAnalyticsNavigatorSnapshot();
  return [
    { id: 'analytics-navigator.registry.summary', method: 'GET', path: basePath, summary: createAnalyticsNavigatorRouteSummary(snapshot) },
    { id: 'analytics-navigator.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'analytics-navigator.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

