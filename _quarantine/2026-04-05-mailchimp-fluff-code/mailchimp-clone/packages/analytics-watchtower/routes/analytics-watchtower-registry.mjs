import { buildAnalyticsWatchtowerSnapshot, createAnalyticsWatchtowerRouteSummary } from '../service-analytics-watchtower.mjs';

export function createAnalyticsWatchtowerRegistryRoutes(basePath = '/registry/analytics-watchtower') {
  const snapshot = buildAnalyticsWatchtowerSnapshot();
  return [
    { id: 'analytics-watchtower.registry.summary', method: 'GET', path: basePath, summary: createAnalyticsWatchtowerRouteSummary(snapshot) },
    { id: 'analytics-watchtower.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'analytics-watchtower.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

