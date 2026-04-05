import { buildAnalyticsSentinelSnapshot, createAnalyticsSentinelRouteSummary } from '../service-analytics-sentinel.mjs';

export function createAnalyticsSentinelRegistryRoutes(basePath = '/registry/analytics-sentinel') {
  const snapshot = buildAnalyticsSentinelSnapshot();
  return [
    { id: 'analytics-sentinel.registry.summary', method: 'GET', path: basePath, summary: createAnalyticsSentinelRouteSummary(snapshot) },
    { id: 'analytics-sentinel.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'analytics-sentinel.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

