import { buildAnalyticsStudioSnapshot, createAnalyticsStudioRouteSummary } from '../service-analytics-studio.mjs';

export function createAnalyticsStudioRegistryRoutes(basePath = '/registry/analytics-studio') {
  const snapshot = buildAnalyticsStudioSnapshot();
  return [
    { id: 'analytics-studio.registry.summary', method: 'GET', path: basePath, summary: createAnalyticsStudioRouteSummary(snapshot) },
    { id: 'analytics-studio.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'analytics-studio.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

