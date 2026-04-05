import { buildAnalyticsConsoleSnapshot, createAnalyticsConsoleRouteSummary } from '../service-analytics-console.mjs';

export function createAnalyticsConsoleRegistryRoutes(basePath = '/registry/analytics-console') {
  const snapshot = buildAnalyticsConsoleSnapshot();
  return [
    { id: 'analytics-console.registry.summary', method: 'GET', path: basePath, summary: createAnalyticsConsoleRouteSummary(snapshot) },
    { id: 'analytics-console.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'analytics-console.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

